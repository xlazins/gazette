import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import {
  boldCompanyName,
  noticeReference,
  noticeRegions,
  pageContentToLines,
} from "../page-layout.mjs";
import { parseOcrFields } from "../ocr-fields.mjs";

const [pdfPath, targetReference, outputDirectory] = process.argv.slice(2);
const pdfjsPath = process.env.PDFJS_PATH;
const nodeModulesPath = process.env.CODEX_NODE_MODULES;

if (
  !pdfPath ||
  !targetReference ||
  !outputDirectory ||
  !pdfjsPath ||
  !nodeModulesPath
) {
  console.error(
    "Usage: PDFJS_PATH=... CODEX_NODE_MODULES=... node tools/ocr-notice.mjs " +
    "issue.pdf NOTICE_REFERENCE output-directory",
  );
  process.exitCode = 1;
} else {
  const require = createRequire(import.meta.url);
  const canvasModule = require(path.join(nodeModulesPath, "@napi-rs/canvas"));
  const {
    createWorker,
    OEM,
    PSM,
  } = require(path.join(nodeModulesPath, "tesseract.js"));
  globalThis.DOMMatrix = canvasModule.DOMMatrix;
  globalThis.ImageData = canvasModule.ImageData;
  globalThis.Path2D = canvasModule.Path2D;

  const pdfjs = await import(pathToFileURL(pdfjsPath).href);
  const bytes = fs.readFileSync(pdfPath);
  const document = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    stopAtErrors: false,
    useSystemFonts: true,
  }).promise;
  const segment = await locateNotice(document, targetReference);
  if (!segment) {
    await document.destroy();
    throw new Error(`Notice ${targetReference} was not found`);
  }

  fs.mkdirSync(outputDirectory, { recursive: true });
  const cachePath = path.resolve(
    process.env.OCR_CACHE_PATH || "tools/.ocr-cache",
  );
  fs.mkdirSync(cachePath, { recursive: true });
  const languages = (process.env.OCR_LANGS || "ara+eng").split("+");
  const worker = await createWorker(languages, OEM.LSTM_ONLY, {
    cachePath,
    logger: ({ status, progress }) => {
      if (progress === 1 || progress === 0) {
        console.error(`${status}: ${Math.round(progress * 100)}%`);
      }
    },
  });
  await worker.setParameters({
    tessedit_pageseg_mode: process.env.OCR_PSM || PSM.SINGLE_COLUMN,
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });

  const scale = 4;
  const renderedPages = new Map();
  const ocrRegions = [];
  for (const [index, region] of segment.regions.entries()) {
    let rendered = renderedPages.get(region.page);
    if (!rendered) {
      rendered = await renderPage(document, region.page, scale, canvasModule);
      renderedPages.set(region.page, rendered);
    }
    const image = cropRegion(rendered, region, scale, canvasModule);
    const imagePath = path.resolve(
      outputDirectory,
      `${targetReference}-part-${index + 1}-page-${region.page}.png`,
    );
    fs.writeFileSync(imagePath, image);
    const result = await worker.recognize(image);
    ocrRegions.push({
      ...region,
      image_path: imagePath,
      confidence: Math.round(result.data.confidence * 10) / 10,
      text: result.data.text.trim(),
    });
  }

  const embeddedText = segment.lines
    .map((line) => line.readingText)
    .join("\n");
  const ocrText = ocrRegions.map((region) => region.text).join("\n");
  const result = {
    reference: targetReference,
    company_name: segment.companyName,
    pages: [...new Set(segment.lines.map((line) => line.page))],
    regions: ocrRegions,
    ocr_text: ocrText,
    embedded_text: embeddedText,
    fields: parseOcrFields({
      ocrText,
      embeddedText,
      companyName: segment.companyName,
    }),
    exact_tokens: {
      dates: uniqueMatches(
        embeddedText,
        /\b20\d{2}[./-]\d{1,2}[./-]\d{1,2}\b|\b\d{1,2}[./-]\d{1,2}[./-]20\d{2}\b/g,
      ),
      numbers: uniqueMatches(
        embeddedText,
        /\b\d[\d.,/ -]{1,18}\d\b|\b\d{2,}\b/g,
      ),
    },
  };
  console.log(JSON.stringify(result, null, 2));

  await worker.terminate();
  for (const rendered of renderedPages.values()) rendered.page.cleanup();
  await document.destroy();
}

async function locateNotice(document, targetReference) {
  let pendingLines = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines = pageContentToLines(content, {
      pageNumber,
      pageWidth: page.view[2],
      pageHeight: page.view[3],
    });
    page.cleanup();
    for (const line of lines) {
      const reference = noticeReference(line.text);
      if (!reference) {
        pendingLines.push(line);
        continue;
      }
      if (reference === targetReference) {
        return {
          companyName: boldCompanyName(pendingLines),
          lines: pendingLines,
          regions: noticeRegions(pendingLines),
        };
      }
      pendingLines = [];
    }
  }
  return null;
}

async function renderPage(document, pageNumber, scale, canvasModule) {
  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = canvasModule.createCanvas(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height),
  );
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvasContext: context,
    viewport,
  }).promise;
  return { page, canvas, pageHeight: page.view[3] };
}

function cropRegion(rendered, region, scale, canvasModule) {
  const left = Math.floor(region.left * scale);
  const right = Math.ceil(region.right * scale);
  const top = Math.floor((rendered.pageHeight - region.top) * scale);
  const bottom = Math.ceil((rendered.pageHeight - region.bottom) * scale);
  const crop = canvasModule.createCanvas(right - left, bottom - top);
  const context = crop.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, crop.width, crop.height);
  context.drawImage(
    rendered.canvas,
    left,
    top,
    right - left,
    bottom - top,
    0,
    0,
    right - left,
    bottom - top,
  );
  return crop.toBuffer("image/png");
}

function uniqueMatches(value, pattern) {
  return [...new Set(
    [...value.matchAll(pattern)].map((match) => match[0].trim()),
  )];
}
