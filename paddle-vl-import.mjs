import {
  detectCitiesFromText,
  ExtractionCancelledError,
  inferIssueNumber,
  normalizeText,
  parseNotice,
} from "./parser.mjs";
import { parseOcrFields } from "./ocr-fields.mjs";

const PDF_PAGE_WIDTH = 595.276;
const PDF_PAGE_HEIGHT = 841.89;
const PADDLE_ENGINE = "paddleocr-vl-1.6";
const IGNORED_LABELS = new Set([
  "aside_text",
  "figure_title",
  "footer",
  "footer_image",
  "header",
  "header_image",
  "number",
  "vision_footnote",
]);
const TITLE_LABELS = new Set(["doc_title", "paragraph_title", "title"]);
const GENERIC_TITLES = new Set([
  "SA",
  "SARL",
  "SARL AU",
  "SARLAU",
  "SAS",
  "SOCIETE A RESPONSABILITE LIMITEE",
  "SOCIETE A RESPONSABILITE LIMITEE A ASSOCIE UNIQUE",
]);
const MONTHS = new Map([
  ["يناير", 1],
  ["فبراير", 2],
  ["مارس", 3],
  ["أبريل", 4],
  ["ابريل", 4],
  ["ماي", 5],
  ["يونيو", 6],
  ["يوليوز", 7],
  ["غشت", 8],
  ["شتنبر", 9],
  ["أكتوبر", 10],
  ["اكتوبر", 10],
  ["نونبر", 11],
  ["دجنبر", 12],
  ["janvier", 1],
  ["fevrier", 2],
  ["février", 2],
  ["mars", 3],
  ["avril", 4],
  ["mai", 5],
  ["juin", 6],
  ["juillet", 7],
  ["aout", 8],
  ["août", 8],
  ["septembre", 9],
  ["octobre", 10],
  ["novembre", 11],
  ["decembre", 12],
  ["décembre", 12],
]);

export function isPaddleVlPayload(value) {
  const pages = unwrapPages(value);
  return Boolean(
    pages?.length &&
    pages.some((page) => (
      Array.isArray(page?.prunedResult?.parsing_res_list) ||
      typeof page?.markdown?.text === "string"
    )),
  );
}

export async function extractPaddleVlFile(file, options = {}, callbacks = {}) {
  let decoded;
  try {
    decoded = JSON.parse(await file.text());
  } catch (error) {
    throw new Error(
      error instanceof SyntaxError
        ? "This is not valid UTF-8 JSON."
        : `The JSON could not be read: ${error?.message || "unknown error"}`,
    );
  }
  return extractPaddleVlPages(decoded, {
    ...options,
    inputFilename: file.name,
  }, callbacks);
}

export async function extractPaddleVlPages(value, options = {}, callbacks = {}) {
  const pages = unwrapPages(value);
  if (!isPaddleVlPayload(pages)) {
    throw new Error(
      "The file is not a PaddleOCR-VL JSON export with page parsing results.",
    );
  }

  const dimensions = detectDocumentDimensions(pages);
  const issueNumber =
    options.issueNumber ||
    inferIssueNumber(options.inputFilename) ||
    inferIssueNumber(options.sourceUrl);
  const publicationDate =
    options.publicationDate ||
    inferPublicationDate(pages) ||
    null;
  const originalPdfFilename =
    options.pdfFilename ||
    inferPdfFilename(options.inputFilename, issueNumber);
  const metadata = {
    filename: originalPdfFilename,
    issueNumber,
    publicationDate,
    sourceUrl: options.sourceUrl || null,
    includeRawText: options.includeRawText !== false,
    extractionEngine: PADDLE_ENGINE,
  };

  const records = [];
  const pending = [];
  let segmentCount = 0;
  let tablePages = 0;
  let unstructuredTablePages = 0;
  let inferredReferences = 0;

  const flushSegment = (
    reference = null,
    extraReasons = [],
    referenceInferred = false,
  ) => {
    if (!pending.length) return;
    const text = normalizeText(pending.map((block) => block.text).join("\n"));
    if (!text) {
      pending.length = 0;
      return;
    }

    segmentCount += 1;
    const reviewReasons = [
      ...new Set([
        ...pending.flatMap((block) => block.reviewReasons || []),
        ...extraReasons,
      ]),
    ];
    const companyNameHint = chooseCompanyTitle(pending);
    const record = parseNotice({
      text,
      pdfPages: unique(pending.map((block) => block.page)),
      printedPages: unique(
        pending.map((block) => block.printedPage).filter(Boolean),
      ),
      reference,
      referenceInferred,
      companyNameHint,
      sourceRegions: buildSourceRegions(pending, dimensions),
      reviewReasons,
    }, metadata);
    pending.length = 0;
    if (!record) return;

    enhancePaddleRecord(record, text, companyNameHint);
    records.push(record);
  };

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    if (callbacks.shouldCancel?.()) {
      throw new ExtractionCancelledError();
    }

    const pageNumber = pageIndex + 1;
    const page = pages[pageIndex];
    const printedPage = detectPrintedPage(page, issueNumber, dimensions);
    const pageResult = pageToBlocks(page, {
      pageNumber,
      printedPage,
      dimensions,
    });
    if (pageResult.hasTable) tablePages += 1;
    if (pageResult.hasUnstructuredTable) unstructuredTablePages += 1;

    for (const block of pageResult.blocks) {
      if (
        block.isTitle &&
        isMeaningfulTitle(block.text) &&
        hasCompleteTitledNotice(pending, metadata)
      ) {
        flushSegment();
      }

      const extractedParts = splitBlockAtReferences(
        block.text,
        pending.map((item) => item.text).join("\n"),
      );
      for (const extracted of extractedParts) {
        if (extracted.text) {
          pending.push({
            ...block,
            text: extracted.text,
          });
        }
        if (extracted.reference) {
          if (extracted.inferred) inferredReferences += 1;
          flushSegment(extracted.reference, [], extracted.inferred);
        }
      }
    }

    callbacks.onProgress?.({
      page: pageNumber,
      totalPages: pages.length,
      segments: segmentCount,
      records: records.length,
    });
    if (pageNumber % 4 === 0) await yieldToBrowser();
  }
  flushSegment();

  return {
    schema_version: "1.0.0",
    summary: {
      records: records.length,
      records_all_cities: records.length,
      segments_examined: segmentCount,
      document_pages: pages.length,
      records_needing_review: records.filter((record) => record.needs_review).length,
      city_filter: null,
      publication_date: publicationDate,
      filename: originalPdfFilename,
      input_filename: options.inputFilename || null,
      input_format: "paddleocr-vl-json",
      extraction_engine: PADDLE_ENGINE,
      table_pages: tablePages,
      unstructured_table_pages: unstructuredTablePages,
      inferred_notice_references: inferredReferences,
      records_without_notice_reference: records.filter(
        (record) => !record.source.notice_reference,
      ).length,
    },
    records,
  };
}

function unwrapPages(value) {
  if (Array.isArray(value)) return value;
  for (const key of ["pages", "results", "data"]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return null;
}

function pageToBlocks(page, {
  pageNumber,
  printedPage,
  dimensions,
}) {
  const sourceBlocks = Array.isArray(page?.prunedResult?.parsing_res_list)
    ? page.prunedResult.parsing_res_list
    : [];
  const blocks = [];
  let hasTable = false;
  let hasUnstructuredTable = false;

  for (const [sourceIndex, source] of sourceBlocks.entries()) {
    const label = String(source?.block_label || "text").toLowerCase();
    if (IGNORED_LABELS.has(label)) continue;
    const bbox = validBbox(source?.block_bbox)
      ? source.block_bbox.map(Number)
      : null;
    if (label === "table") {
      hasTable = true;
      const table = tableToBlocks(String(source?.block_content || ""), {
        bbox,
        pageNumber,
        printedPage,
        dimensions,
        sourceIndex,
      });
      blocks.push(...table.blocks);
      hasUnstructuredTable ||= table.unstructured;
      continue;
    }

    const text = cleanBlockText(source?.block_content);
    if (!text) continue;
    blocks.push(makeBlock({
      bbox,
      dimensions,
      isTitle: TITLE_LABELS.has(label),
      label,
      pageNumber,
      printedPage,
      sourceIndex,
      text,
    }));
  }

  if (!blocks.length && typeof page?.markdown?.text === "string") {
    const text = cleanBlockText(page.markdown.text);
    if (text) {
      blocks.push(makeBlock({
        bbox: null,
        dimensions,
        isTitle: false,
        label: "markdown",
        pageNumber,
        printedPage,
        reviewReasons: ["paddle_page_geometry_missing"],
        sourceIndex: 0,
        text,
      }));
    }
  }

  blocks.sort((left, right) => (
    right.column - left.column ||
    left.top - right.top ||
    left.sourceIndex - right.sourceIndex
  ));
  return { blocks, hasTable, hasUnstructuredTable };
}

function tableToBlocks(html, context) {
  const rows = parseTableRows(html);
  const bbox = context.bbox || [
    0,
    0,
    context.dimensions.width,
    context.dimensions.height,
  ];
  const tableWidth = Math.max(1, bbox[2] - bbox[0]);
  const wideTable = tableWidth / context.dimensions.width >= 0.58;
  const gridWidth = Math.max(0, ...rows.map((row) => row.length));

  if (!rows.length || gridWidth > 12 || (rows.length === 1 && gridWidth > 8)) {
    const text = htmlToText(html);
    return {
      blocks: text ? [makeBlock({
        ...context,
        bbox,
        isTitle: false,
        label: "table",
        reviewReasons: ["paddle_table_layout_unstructured"],
        text,
      })] : [],
      unstructured: true,
    };
  }

  const blocks = [];
  for (const [rowIndex, row] of rows.entries()) {
    const populated = row
      .map((cell, cellIndex) => ({ cell, cellIndex }))
      .filter(({ cell }) => cell?.text);
    const rowGroups = new Map();
    for (const { cell, cellIndex } of populated) {
      const relativeCenter = (cellIndex + Math.max(1, cell.colspan) / 2) /
        Math.max(1, gridWidth);
      const rawX = bbox[0] + relativeCenter * tableWidth;
      const column = wideTable
        ? clamp(Math.floor(relativeCenter * 4), 0, 3)
        : columnFromX(rawX, context.dimensions.width);
      if (!rowGroups.has(column)) rowGroups.set(column, []);
      rowGroups.get(column).push({ ...cell, cellIndex });
    }

    for (const [column, cells] of rowGroups) {
      const text = cells
        .toSorted((left, right) => right.cellIndex - left.cellIndex)
        .map((cell) => cell.text)
        .join(" ")
        .trim();
      if (!text) continue;
      const columnWidth = context.dimensions.width / 4;
      const rowHeight = (bbox[3] - bbox[1]) / Math.max(1, rows.length);
      const left = column * columnWidth;
      const right = left + columnWidth;
      const top = bbox[1] + rowIndex * rowHeight;
      const bottom = top + rowHeight;
      blocks.push(makeBlock({
        ...context,
        bbox: [left, top, right, bottom],
        isTitle: looksLikeTitle(text),
        label: "table_cell",
        reviewReasons: ["paddle_table_layout_reconstructed"],
        sourceIndex: context.sourceIndex * 10000 + rowIndex * 20 + column,
        text,
      }));
    }
  }
  return { blocks, unstructured: false };
}

function parseTableRows(html) {
  const rows = [];
  let activeSpans = [];
  const rowMatches = String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu);
  for (const rowMatch of rowMatches) {
    const row = [];
    const nextSpans = activeSpans.map((span) => (
      span && span.remaining > 1
        ? { remaining: span.remaining - 1 }
        : null
    ));
    let column = 0;
    const cellMatches = rowMatch[1].matchAll(
      /<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/giu,
    );
    for (const cellMatch of cellMatches) {
      while (activeSpans[column]) {
        row[column] = null;
        column += 1;
      }
      const attributes = cellMatch[1];
      const colspan = clamp(
        Number(attributes.match(/\bcolspan\s*=\s*["']?(\d+)/iu)?.[1]) || 1,
        1,
        12,
      );
      const rowspan = clamp(
        Number(attributes.match(/\browspan\s*=\s*["']?(\d+)/iu)?.[1]) || 1,
        1,
        100,
      );
      const text = htmlToText(cellMatch[2]);
      row[column] = { text, colspan };
      for (let offset = 0; offset < colspan; offset += 1) {
        if (offset) row[column + offset] = null;
        if (rowspan > 1) {
          nextSpans[column + offset] = { remaining: rowspan - 1 };
        }
      }
      column += colspan;
    }
    rows.push(row);
    activeSpans = nextSpans;
  }
  return rows;
}

function makeBlock({
  bbox,
  dimensions,
  isTitle,
  label,
  pageNumber,
  printedPage,
  reviewReasons = [],
  sourceIndex,
  text,
}) {
  const safeBbox = bbox || [
    dimensions.width * 0.75,
    dimensions.height * 0.08,
    dimensions.width,
    dimensions.height * 0.95,
  ];
  const centerX = (safeBbox[0] + safeBbox[2]) / 2;
  return {
    bbox: safeBbox,
    bottom: safeBbox[3],
    column: columnFromX(centerX, dimensions.width),
    isTitle,
    label,
    page: pageNumber,
    printedPage,
    reviewReasons,
    sourceIndex,
    text,
    top: safeBbox[1],
  };
}

function splitBlockAtReferences(text, pendingText) {
  const lines = normalizeText(text).split("\n").filter(Boolean);
  if (!lines.length) return [];
  const parts = [];
  let buffer = [];
  for (const sourceLine of lines) {
    const line = sourceLine.replace(/^#{1,6}\s*/u, "").trim();
    const explicit = line.match(
      /^(.*?)(?:^|\s)(\d{1,7})\s*([A-Z])\s*[.:،-]?$/iu,
    );
    if (explicit) {
      const prefix = explicit[1].trim();
      if (prefix) buffer.push(prefix);
      parts.push({
        text: buffer.join("\n"),
        reference: `${explicit[2]}${explicit[3].toUpperCase()}`,
        inferred: false,
      });
      buffer = [];
      continue;
    }

    const inferred = line.match(/^(?:ب\s*ـ?\s*)?(\d{1,4})1\s*[.:،-]?$/u);
    const context = normalizeText(`${pendingText}\n${buffer.join("\n")}`);
    if (
      inferred &&
      /(?:تم\s+(?:الإيداع|الايداع|التقييد)|بتاريخ.{0,70}تحت\s+رقم|تحت\s+رقم.{0,70}بتاريخ)/isu.test(
        context.slice(-700),
      )
    ) {
      parts.push({
        text: buffer.join("\n"),
        reference: `${inferred[1]}I`,
        inferred: true,
      });
      buffer = [];
      continue;
    }
    buffer.push(line);
  }
  if (buffer.length || !parts.length) {
    parts.push({
      text: buffer.join("\n"),
      reference: null,
      inferred: false,
    });
  }
  return parts;
}

function hasCompleteTitledNotice(blocks, metadata) {
  const lastTitle = blocks.findLastIndex(
    (block) => block.isTitle && isMeaningfulTitle(block.text),
  );
  if (lastTitle < 0) return false;
  const bodyAfterTitle = blocks
    .slice(lastTitle + 1)
    .some((block) => !block.isTitle && block.text.length >= 12);
  if (!bodyAfterTitle) return false;
  const text = blocks.map((block) => block.text).join("\n");
  return Boolean(parseNotice({
    text,
    companyNameHint: chooseCompanyTitle(blocks),
  }, {
    ...metadata,
    includeRawText: false,
  }));
}

function chooseCompanyTitle(blocks) {
  const candidates = blocks
    .filter((block) => block.isTitle)
    .map((block) => cleanTitle(block.text))
    .filter(isMeaningfulTitle);
  return candidates.at(-1) || null;
}

function isMeaningfulTitle(value) {
  const title = cleanTitle(value);
  if (
    title.length < 2 ||
    title.length > 160 ||
    !/\p{Script=Latin}/u.test(title)
  ) {
    return false;
  }
  const generic = title
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .replace(/[.]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toUpperCase();
  return !GENERIC_TITLES.has(generic);
}

function looksLikeTitle(value) {
  const text = cleanTitle(value);
  if (!isMeaningfulTitle(text) || /\p{Script=Arabic}/u.test(text)) return false;
  const letters = [...text].filter((character) => /\p{Script=Latin}/u.test(character));
  if (!letters.length) return false;
  const uppercase = letters.filter(
    (character) => character === character.toLocaleUpperCase(),
  ).length / letters.length;
  return uppercase >= 0.76;
}

function cleanTitle(value) {
  return normalizeText(value)
    .replace(/^#{1,6}\s*/u, "")
    .replace(/^[«"' .:،;-]+|[»"' .:،;-]+$/gu, "")
    .trim();
}

function enhancePaddleRecord(record, text, companyNameHint) {
  const fields = parseOcrFields({
    ocrText: text,
    companyName: companyNameHint || record.company.name,
  });
  prefer(record.company, "registered_address", fields.company.registered_address);
  fill(record.company, "legal_form", fields.company.legal_form);
  fill(
    record.company,
    "commercial_register_number",
    fields.company.commercial_register_number,
  );
  prefer(record.event, "business_purpose", fields.event.business_purpose);
  prefer(record.event, "branch_address", fields.event.branch_address);
  prefer(
    record.event,
    "manager_or_liquidator",
    fields.event.manager_or_liquidator,
  );
  fill(record.event, "decision_date", fields.event.decision_date);
  fill(record.event.filing, "court", fields.event.filing.court);
  fill(record.event.filing, "date", fields.event.filing.date);
  fill(record.event.filing, "number", fields.event.filing.number);
  fill(record.event, "capital_mad", fields.event.capital_mad);
  record.company.cities_mentioned = unique([
    ...(record.company.cities_mentioned || []),
    ...detectCitiesFromText([
      text,
      record.company.registered_address,
      record.event.branch_address,
      record.event.filing.court,
    ].filter(Boolean).join("\n")),
  ]);

  const stillMissing = new Map([
    ["commercial_register_number_missing", !record.company.commercial_register_number],
    ["legal_form_missing", !record.company.legal_form],
    ["event_date_missing", !record.event.decision_date],
    ["branch_address_missing", (
      record.event.types.includes("BRANCH_OPENING") &&
      !record.event.branch_address
    )],
    ["liquidator_missing", (
      record.event.types.some((type) => ["DISSOLUTION", "LIQUIDATION"].includes(type)) &&
      !record.event.manager_or_liquidator
    )],
    ["city_not_detected", !record.company.cities_mentioned.length],
  ]);
  record.review_reasons = record.review_reasons.filter(
    (reason) => stillMissing.get(reason) ?? true,
  );
  record.needs_review = record.review_reasons.length > 0 || record.confidence < 0.85;
}

function buildSourceRegions(blocks, dimensions) {
  const groups = new Map();
  for (const block of blocks) {
    if (!validBbox(block.bbox)) continue;
    const key = `${block.page}:${block.column}`;
    if (!groups.has(key)) {
      groups.set(key, {
        page: block.page,
        column: block.column,
        left: block.bbox[0],
        top: block.bbox[1],
        right: block.bbox[2],
        bottom: block.bbox[3],
        line_count: 0,
      });
    }
    const group = groups.get(key);
    group.left = Math.min(group.left, block.bbox[0]);
    group.top = Math.min(group.top, block.bbox[1]);
    group.right = Math.max(group.right, block.bbox[2]);
    group.bottom = Math.max(group.bottom, block.bbox[3]);
    group.line_count += Math.max(1, block.text.split("\n").length);
  }

  const scaleX = PDF_PAGE_WIDTH / dimensions.width;
  const scaleY = PDF_PAGE_HEIGHT / dimensions.height;
  return [...groups.values()].map((group) => ({
    page: group.page,
    column: group.column,
    left: round(group.left * scaleX),
    right: round(group.right * scaleX),
    top: round(PDF_PAGE_HEIGHT - group.top * scaleY),
    bottom: round(PDF_PAGE_HEIGHT - group.bottom * scaleY),
    line_count: group.line_count,
  }));
}

function detectDocumentDimensions(pages) {
  let minLeft = Infinity;
  let maxRight = 0;
  let maxBottom = 0;
  for (const page of pages) {
    const blocks = page?.prunedResult?.parsing_res_list || [];
    for (const block of blocks) {
      if (!validBbox(block?.block_bbox)) continue;
      const [left, , right, bottom] = block.block_bbox.map(Number);
      if (left > 0) minLeft = Math.min(minLeft, left);
      maxRight = Math.max(maxRight, right);
      maxBottom = Math.max(maxBottom, bottom);
    }
  }
  const margin = Number.isFinite(minLeft) ? clamp(minLeft, 20, 80) : 40;
  const width = Math.max(1000, Math.round(maxRight + margin));
  const height = Math.max(
    Math.round(width * Math.SQRT2),
    Math.round(maxBottom + width * 0.065),
  );
  return { width, height };
}

function detectPrintedPage(page, issueNumber, dimensions) {
  const candidates = (page?.prunedResult?.parsing_res_list || [])
    .filter((block) => (
      String(block?.block_label).toLowerCase() === "number" &&
      validBbox(block?.block_bbox) &&
      Number(block.block_bbox[1]) < dimensions.height * 0.14
    ))
    .flatMap((block) => String(block.block_content || "").match(/\b\d{3,6}\b/gu) || [])
    .filter((value) => value !== String(issueNumber || ""));
  return candidates.length
    ? candidates.toSorted((left, right) => Number(right) - Number(left))[0]
    : null;
}

function inferPublicationDate(pages) {
  const text = pages
    .slice(0, 3)
    .flatMap((page) => page?.prunedResult?.parsing_res_list || [])
    .filter((block) => String(block?.block_label).toLowerCase() === "header")
    .map((block) => String(block.block_content || ""))
    .join(" ");
  const monthNames = [...MONTHS.keys()]
    .toSorted((left, right) => right.length - left.length)
    .map(escapeRegex)
    .join("|");
  const patterns = [
    new RegExp(`\\b(20\\d{2})\\s+(${monthNames})\\s+(\\d{1,2})\\b`, "iu"),
    new RegExp(`\\b(\\d{1,2})\\s+(${monthNames})\\s+(20\\d{2})\\b`, "iu"),
  ];
  for (const [index, pattern] of patterns.entries()) {
    const match = normalizeText(text).match(pattern);
    if (!match) continue;
    const [year, monthName, day] = index === 0
      ? [match[1], match[2], match[3]]
      : [match[3], match[2], match[1]];
    const month = MONTHS.get(monthName.toLowerCase());
    if (!month) continue;
    const date = new Date(Date.UTC(Number(year), month - 1, Number(day)));
    if (
      date.getUTCFullYear() === Number(year) &&
      date.getUTCMonth() + 1 === month &&
      date.getUTCDate() === Number(day)
    ) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return null;
}

function inferPdfFilename(inputFilename, issueNumber) {
  const explicit = String(inputFilename || "").match(
    /(BOAL[_-]\d+(?:-bis)?\.pdf)/iu,
  )?.[1];
  if (explicit) return explicit;
  return issueNumber ? `BOAL_${issueNumber}.pdf` : "BOAL_issue.pdf";
}

function cleanBlockText(value) {
  const source = String(value ?? "");
  const text = /<\s*(?:table|tr|td|th)\b/iu.test(source)
    ? htmlToText(source)
    : source;
  return normalizeText(
    text
      .replace(/^#{1,6}\s*/gmu, "")
      .replace(/\r\n?/gu, "\n"),
  );
}

function htmlToText(value) {
  return decodeHtml(
    String(value ?? "")
      .replace(/<br\s*\/?>/giu, "\n")
      .replace(/<\/(?:p|div|li|tr|td|th)>/giu, "\n")
      .replace(/<[^>]+>/gu, " "),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function decodeHtml(value) {
  return String(value)
    .replace(/&#(\d+);/gu, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([\da-f]+);/giu, (_, number) => (
      String.fromCodePoint(Number.parseInt(number, 16))
    ))
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&apos;|&#39;/giu, "'");
}

function columnFromX(x, width) {
  return clamp(Math.floor((x / Math.max(1, width)) * 4), 0, 3);
}

function validBbox(value) {
  return (
    Array.isArray(value) &&
    value.length >= 4 &&
    value.slice(0, 4).every((coordinate) => Number.isFinite(Number(coordinate))) &&
    Number(value[2]) > Number(value[0]) &&
    Number(value[3]) > Number(value[1])
  );
}

function prefer(target, key, value) {
  if (value && (!target[key] || value.length < target[key].length * 1.6)) {
    target[key] = value;
  }
}

function fill(target, key, value) {
  if ((target[key] == null || target[key] === "") && value != null && value !== "") {
    target[key] = value;
  }
}

function unique(values) {
  return [...new Set(values)];
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function yieldToBrowser() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });
}
