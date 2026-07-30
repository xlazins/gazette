import {
  normalizeOcrText,
  parseOcrFields,
} from "./ocr-fields.mjs?v=20260730-3";
import { detectCitiesFromText } from "./parser.mjs?v=20260730-3";

const OCR_SCALE = 4;
const OCR_PADDING = 18;
const OCR_DATABASE = "boal-extractor-ocr";
const OCR_STORE = "results";
const OCR_DATABASE_VERSION = 1;
const SOURCE_MAPPING_REASONS = new Set([
  "source_text_has_unmapped_glyphs",
  "source_text_has_suspect_font_mapping",
]);

export class ArabicOcrEngine {
  constructor({ onProgress = null } = {}) {
    this.onProgress = onProgress;
    this.worker = null;
    this.workerPromise = null;
  }

  async recognizeRecord(pdfDocument, record) {
    const regions = validRegions(record);
    if (!regions.length) {
      throw new Error("This notice has no geometric source regions to read.");
    }

    const worker = await this.ensureWorker();
    const ocrRegions = [];
    for (const [index, region] of regions.entries()) {
      this.report({
        status: "rendering notice",
        progress: index / regions.length,
        part: index + 1,
        parts: regions.length,
      });
      const page = await pdfDocument.getPage(region.page);
      try {
        const canvas = await renderRegion(page, region);
        const result = await worker.recognize(canvas);
        ocrRegions.push({
          page: region.page,
          column: region.column,
          confidence: roundOne(result.data.confidence),
          text: normalizeOcrText(result.data.text),
        });
        canvas.width = 1;
        canvas.height = 1;
      } finally {
        page.cleanup();
      }
    }

    const text = normalizeOcrText(
      ocrRegions.map((region) => region.text).join("\n"),
    );
    const confidence = weightedConfidence(ocrRegions);
    return {
      status: "complete",
      engine: "tesseract.js",
      engine_version: "7.0.0",
      languages: ["ara", "eng"],
      confidence,
      processed_at: new Date().toISOString(),
      regions: ocrRegions,
      text,
      fields: parseOcrFields({
        ocrText: text,
        embeddedText: record.raw_text || "",
        companyName: record.company.name,
      }),
    };
  }

  async ensureWorker() {
    if (this.worker) return this.worker;
    if (!this.workerPromise) {
      this.workerPromise = this.createWorker();
    }
    try {
      this.worker = await this.workerPromise;
      return this.worker;
    } catch (error) {
      this.workerPromise = null;
      throw error;
    }
  }

  async createWorker() {
    this.report({ status: "loading OCR engine", progress: 0 });
    const { default: Tesseract } = await import(
      "./vendor/tesseract.esm.min.js"
    );
    const { createWorker, OEM, PSM } = Tesseract;
    const worker = await createWorker(["ara", "eng"], OEM.LSTM_ONLY, {
      workerPath: new URL(
        "./vendor/tesseract.worker.min.js",
        import.meta.url,
      ).href,
      corePath: new URL("./vendor/tesseract-core/", import.meta.url).href,
      langPath: new URL("./vendor/tessdata/", import.meta.url).href,
      gzip: false,
      logger: (message) => this.report(message),
    });
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_COLUMN,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
    });
    return worker;
  }

  report(message) {
    this.onProgress?.(message);
  }

  async terminate() {
    const worker = this.worker;
    this.worker = null;
    this.workerPromise = null;
    if (worker) await worker.terminate();
  }
}

export function mergeOcrResult(record, ocr) {
  const fields = ocr?.fields;
  if (!fields) return record;
  const missingBeforeOcr = {
    registerNumber: !record.company.commercial_register_number,
    decisionDate: !record.event.decision_date,
    manager: !record.event.manager_or_liquidator,
    filingDate: !record.event.filing.date,
    filingNumber: !record.event.filing.number,
    cities: !record.company.cities_mentioned?.length,
  };

  const originalReviewReasons = (record.review_reasons || []).filter(
    (reason) => !reason.startsWith("ocr_"),
  );
  record.ocr = {
    ...ocr,
    source_review_reasons: originalReviewReasons.filter((reason) => (
      SOURCE_MAPPING_REASONS.has(reason)
    )),
  };

  replaceProse(record.company, "registered_address", fields.company.registered_address);
  replaceProse(record.event, "business_purpose", fields.event.business_purpose);
  replaceProse(record.event, "branch_address", fields.event.branch_address);
  replacePersonName(
    record.event,
    "manager_or_liquidator",
    fields.event.manager_or_liquidator,
  );
  replaceProse(record.event.filing, "court", fields.event.filing.court);

  fillMissing(record.company, "legal_form", fields.company.legal_form);
  fillMissing(
    record.company,
    "commercial_register_number",
    fields.company.commercial_register_number,
  );
  fillMissing(record.event, "decision_date", fields.event.decision_date);
  fillMissing(record.event, "capital_mad", fields.event.capital_mad);
  fillMissing(record.event.filing, "date", fields.event.filing.date);
  fillMissing(record.event.filing, "number", fields.event.filing.number);
  record.company.cities_mentioned = [...new Set([
    ...(record.company.cities_mentioned || []),
    ...detectCitiesFromText([
      ocr.text,
      record.company.registered_address,
      record.event.branch_address,
      record.event.filing.court,
    ].filter(Boolean).join("\n")),
  ])];

  const confidence = Number(ocr.confidence) || 0;
  const resolvedMapping = confidence >= 55 && Boolean(ocr.text);
  const reviewReasons = originalReviewReasons.filter((reason) => {
    if (resolvedMapping && SOURCE_MAPPING_REASONS.has(reason)) return false;
    if (reason === "commercial_register_number_missing") {
      return !record.company.commercial_register_number;
    }
    if (reason === "legal_form_missing") return !record.company.legal_form;
    if (reason === "event_date_missing") return !record.event.decision_date;
    if (reason === "branch_address_missing") return !record.event.branch_address;
    if (reason === "liquidator_missing") {
      return !record.event.manager_or_liquidator;
    }
    if (reason === "city_not_detected") {
      return !record.company.cities_mentioned.length;
    }
    return true;
  });
  if (confidence < 55 && !reviewReasons.includes("ocr_confidence_low")) {
    reviewReasons.push("ocr_confidence_low");
  }
  for (const [wasMissing, value, reason] of [
    [
      missingBeforeOcr.registerNumber,
      record.company.commercial_register_number,
      "ocr_commercial_register_number_needs_review",
    ],
    [
      missingBeforeOcr.decisionDate,
      record.event.decision_date,
      "ocr_event_date_needs_review",
    ],
    [
      missingBeforeOcr.manager,
      record.event.manager_or_liquidator,
      "ocr_manager_name_needs_review",
    ],
    [
      missingBeforeOcr.filingDate,
      record.event.filing.date,
      "ocr_filing_date_needs_review",
    ],
    [
      missingBeforeOcr.filingNumber,
      record.event.filing.number,
      "ocr_filing_number_needs_review",
    ],
    [
      missingBeforeOcr.cities,
      record.company.cities_mentioned.length,
      "ocr_city_detection_needs_review",
    ],
  ]) {
    if (wasMissing && value && !reviewReasons.includes(reason)) {
      reviewReasons.push(reason);
    }
  }
  for (const [reason, value] of [
    ["ocr_registered_address_needs_review", record.company.registered_address],
    ["ocr_business_purpose_needs_review", record.event.business_purpose],
    ["ocr_branch_address_needs_review", record.event.branch_address],
    ["ocr_manager_name_needs_review", fields.event.manager_or_liquidator],
    ["ocr_filing_court_needs_review", record.event.filing.court],
  ]) {
    if (hasMixedArabicArtifact(value) && !reviewReasons.includes(reason)) {
      reviewReasons.push(reason);
    }
  }

  record.review_reasons = [...new Set(reviewReasons)];
  record.needs_review = record.review_reasons.length > 0;
  if (confidence >= 75) {
    record.confidence = Math.max(record.confidence, record.needs_review ? 0.85 : 0.9);
  } else if (confidence >= 55) {
    record.confidence = Math.max(record.confidence, 0.82);
  }
  return record;
}

export function needsArabicOcr(record) {
  if (record.ocr?.status === "complete") return false;
  if (!validRegions(record).length) return false;
  return (
    record.review_reasons?.some((reason) => SOURCE_MAPPING_REASONS.has(reason)) ||
    /[\u0600-\u06ff]/u.test(record.raw_text || "")
  );
}

export function documentCacheKey(file, payload) {
  const summary = payload?.summary || {};
  return [
    "v1",
    summary.filename || file?.name || "document",
    file?.size || 0,
    summary.publication_date || "",
    payload?.records?.[0]?.source?.issue_number || "",
  ].join("|");
}

export function recordCacheKey(record) {
  return [
    record.source.notice_reference || "",
    record.source.pdf_pages?.join("-") || "",
    record.company.name || "",
  ].join("|");
}

export async function saveOcrResult(documentKey, record, ocr) {
  const database = await openOcrDatabase();
  await transactionPromise(
    database,
    "readwrite",
    (store) => store.put({
      key: `${documentKey}::${recordCacheKey(record)}`,
      document_key: documentKey,
      record_key: recordCacheKey(record),
      ocr,
    }),
  );
}

export async function loadOcrResults(documentKey) {
  const database = await openOcrDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(OCR_STORE, "readonly");
    const index = transaction.objectStore(OCR_STORE).index("document_key");
    const request = index.getAll(documentKey);
    request.onsuccess = () => {
      resolve(new Map(
        request.result.map((entry) => [entry.record_key, entry.ocr]),
      ));
    };
    request.onerror = () => reject(request.error);
  });
}

async function renderRegion(page, region) {
  const scale = OCR_SCALE;
  const width = Math.max(
    1,
    Math.ceil((region.right - region.left) * scale) + OCR_PADDING * 2,
  );
  const height = Math.max(
    1,
    Math.ceil((region.top - region.bottom) * scale) + OCR_PADDING * 2,
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);

  const viewport = page.getViewport({ scale });
  const cropLeft = Math.floor(region.left * scale);
  const cropTop = Math.floor((page.view[3] - region.top) * scale);
  await page.render({
    canvasContext: context,
    viewport,
    transform: [
      1,
      0,
      0,
      1,
      -cropLeft + OCR_PADDING,
      -cropTop + OCR_PADDING,
    ],
  }).promise;
  return canvas;
}

function validRegions(record) {
  return (record.source?.regions || []).filter((region) => (
    Number.isInteger(region.page) &&
    Number.isFinite(region.left) &&
    Number.isFinite(region.right) &&
    Number.isFinite(region.top) &&
    Number.isFinite(region.bottom) &&
    region.right > region.left &&
    region.top > region.bottom
  ));
}

function replaceProse(target, key, value) {
  if (typeof value === "string" && value.trim()) {
    target[key] = value.trim();
  }
}

function fillMissing(target, key, value) {
  if ((target[key] == null || target[key] === "") && value != null && value !== "") {
    target[key] = value;
  }
}

function replacePersonName(target, key, value) {
  const current = String(target[key] || "").trim();
  if (!current || /[\ufffd\d]/u.test(current)) {
    replaceProse(target, key, value);
  }
}

function hasMixedArabicArtifact(value) {
  const text = String(value || "");
  return /[\u0600-\u06ff]/u.test(text) && /\b[a-z]{1,5}\b/iu.test(text);
}

function weightedConfidence(regions) {
  const withText = regions.filter((region) => region.text);
  if (!withText.length) return 0;
  const weighted = withText.reduce((total, region) => (
    total + region.confidence * Math.max(1, region.text.length)
  ), 0);
  const characters = withText.reduce(
    (total, region) => total + Math.max(1, region.text.length),
    0,
  );
  return roundOne(weighted / characters);
}

function roundOne(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function openOcrDatabase() {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error("This browser does not support local OCR storage."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OCR_DATABASE, OCR_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.createObjectStore(OCR_STORE, { keyPath: "key" });
      store.createIndex("document_key", "document_key", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionPromise(database, mode, action) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(OCR_STORE, mode);
    action(transaction.objectStore(OCR_STORE));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
