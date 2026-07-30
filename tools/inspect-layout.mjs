import fs from "node:fs";
import { pathToFileURL } from "node:url";

const pdfPath = process.argv[2];
const pages = process.argv.slice(3).map(Number).filter(Number.isInteger);
const pdfjsPath = process.env.PDFJS_PATH;

if (!pdfPath || !pages.length || !pdfjsPath) {
  console.error(
    "Usage: PDFJS_PATH=... node tools/inspect-layout.mjs issue.pdf PAGE...",
  );
  process.exitCode = 1;
} else {
  const pdfjs = await import(pathToFileURL(pdfjsPath).href);
  const {
    boldCompanyName,
    noticeReference,
    noticeRegions,
    pageContentToLines,
  } = await import("../page-layout.mjs");
  const bytes = fs.readFileSync(pdfPath);
  const document = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    stopAtErrors: false,
    useSystemFonts: true,
  }).promise;

  let pendingLines = [];
  for (const pageNumber of pages) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    if (process.env.RECORD) {
      const lines = pageContentToLines(content, {
        pageNumber,
        pageWidth: page.view[2],
        pageHeight: page.view[3],
      });
      for (const line of lines) {
        const reference = noticeReference(line.text);
        if (reference) {
          if (reference === process.env.RECORD) {
            console.log(JSON.stringify({
              reference,
              pages: [...new Set(pendingLines.map((entry) => entry.page))],
              lineCount: pendingLines.length,
              companyName: boldCompanyName(pendingLines),
              regions: noticeRegions(pendingLines),
              ...(process.env.SUMMARY === "1"
                ? { text: pendingLines.map((entry) => entry.readingText) }
                : {
                    first: pendingLines.slice(0, 30),
                    last: pendingLines.slice(-30),
                  }),
            }, null, 2));
          }
          pendingLines = [];
        } else if (line.text.trim()) {
          pendingLines.push(line);
        }
      }
      page.cleanup();
      continue;
    }
    const sourceItems = content.items
      .filter((item) => typeof item.str === "string");
    const items = sourceItems
      .filter((item) => item.str.trim())
      .map((item, index) => ({
        index,
        text: item.str,
        x: Math.round(item.transform[4] * 10) / 10,
        y: Math.round(item.transform[5] * 10) / 10,
        width: Math.round(item.width * 10) / 10,
        height: Math.round(item.height * 10) / 10,
        dir: item.dir,
        fontName: item.fontName,
        hasEOL: Boolean(item.hasEOL),
      }));

    const markerIndexes = items
      .map((item, index) => (
        /^\s*\d{1,7}\s*[A-Z]\s*$/.test(item.text) ? index : null
      ))
      .filter((index) => index !== null);
    console.log(JSON.stringify({
      page: pageNumber,
      width: page.view[2],
      height: page.view[3],
      itemCount: items.length,
      ...(process.env.DETAIL === "1" ? {
        first: items.slice(0, 40),
        last: items.slice(-40),
      } : {}),
      markers: items.filter((item) => /^\s*\d{1,7}\s*[A-Z]\s*$/.test(item.text)),
      markerContexts: markerIndexes.map((index) => items.slice(
        Math.max(0, index - 10),
        Math.min(items.length, index + 11),
      )),
      sourceEolCount: sourceItems.filter((item) => item.hasEOL).length,
      styles: content.styles,
    }, null, 2));
    page.cleanup();
  }

  await document.destroy();
}
