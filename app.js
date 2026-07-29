import * as pdfjs from "./vendor/pdf.min.mjs";
import {
  ExtractionCancelledError,
  extractGazetteFile,
  inferIssueNumber,
} from "./parser.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "./vendor/pdf.worker.min.mjs",
  import.meta.url,
).href;

const elements = {
  form: document.querySelector("#extract-form"),
  fileInput: document.querySelector("#pdf-input"),
  dropZone: document.querySelector("#drop-zone"),
  dropTitle: document.querySelector("#drop-title"),
  dropDetail: document.querySelector("#drop-detail"),
  issueNumber: document.querySelector("#issue-number"),
  publicationDate: document.querySelector("#publication-date"),
  sourceUrl: document.querySelector("#source-url"),
  city: document.querySelector("#city"),
  onlyCity: document.querySelector("#only-city"),
  includeRaw: document.querySelector("#include-raw"),
  extractButton: document.querySelector("#extract-button"),
  runStatus: document.querySelector("#run-status"),
  statusTitle: document.querySelector("#status-title"),
  statusDetail: document.querySelector("#status-detail"),
  progressBar: document.querySelector("#progress-bar"),
  pageProgress: document.querySelector("#page-progress"),
  recordProgress: document.querySelector("#record-progress"),
  cancelButton: document.querySelector("#cancel-button"),
  formError: document.querySelector("#form-error"),
  results: document.querySelector("#results-section"),
  statRecords: document.querySelector("#stat-records"),
  statReview: document.querySelector("#stat-review"),
  statSegments: document.querySelector("#stat-segments"),
  statPages: document.querySelector("#stat-pages"),
  search: document.querySelector("#record-search"),
  eventFilter: document.querySelector("#event-filter"),
  reviewFilter: document.querySelector("#review-filter"),
  visibleCount: document.querySelector("#visible-count"),
  recordBody: document.querySelector("#record-body"),
  emptyState: document.querySelector("#empty-state"),
  exportJson: document.querySelector("#export-json"),
  exportCsv: document.querySelector("#export-csv"),
  dialog: document.querySelector("#record-dialog"),
  dialogReference: document.querySelector("#dialog-reference"),
  dialogTitle: document.querySelector("#dialog-title"),
  dialogBody: document.querySelector("#dialog-body"),
  closeDialog: document.querySelector("#close-dialog"),
};

const state = {
  file: null,
  payload: null,
  cancelled: false,
  running: false,
};

const EVENT_LABELS = {
  CONTINUATION_AFTER_LOSSES: "Activity continued",
  REMOVAL_FROM_REGISTER: "Register removal",
  LIQUIDATION_CLOSED: "Liquidation closed",
  DISSOLUTION: "Dissolution",
  LIQUIDATION: "Liquidation",
  BRANCH_OPENING: "Branch opening",
  INCORPORATION: "Incorporation",
  BUSINESS_PURPOSE_CHANGE: "Purpose change",
  REGISTERED_OFFICE_CHANGE: "Office change",
  LEGAL_FORM_CHANGE: "Legal form change",
  CAPITAL_CHANGE: "Capital change",
  MANAGER_CHANGE: "Manager change",
  SHARE_TRANSFER: "Share transfer",
};

elements.fileInput.addEventListener("change", () => {
  selectFile(elements.fileInput.files?.[0] ?? null);
});

for (const eventName of ["dragenter", "dragover"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!state.running) elements.dropZone.classList.add("is-dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  });
}

elements.dropZone.addEventListener("drop", (event) => {
  if (state.running) return;
  selectFile(event.dataTransfer?.files?.[0] ?? null);
});

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.file || state.running) return;
  await runExtraction();
});

elements.cancelButton.addEventListener("click", () => {
  state.cancelled = true;
  elements.statusTitle.textContent = "Stopping extraction";
  elements.statusDetail.textContent = "Finishing the current page";
  elements.cancelButton.disabled = true;
});

for (const control of [elements.search, elements.eventFilter, elements.reviewFilter]) {
  control.addEventListener("input", renderRecords);
}

elements.exportJson.addEventListener("click", exportJson);
elements.exportCsv.addEventListener("click", exportCsv);
elements.closeDialog.addEventListener("click", () => elements.dialog.close());
elements.dialog.addEventListener("click", (event) => {
  if (event.target === elements.dialog) elements.dialog.close();
});

function selectFile(file) {
  hideError();
  if (!file) {
    state.file = null;
    elements.extractButton.disabled = true;
    elements.dropZone.classList.remove("has-file");
    elements.dropTitle.textContent = "Choose a PDF or drop it here";
    elements.dropDetail.textContent = "Official SGG BOAL issues are supported";
    return;
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    showError("Select a PDF document.");
    return;
  }
  state.file = file;
  elements.extractButton.disabled = false;
  elements.dropZone.classList.add("has-file");
  elements.dropTitle.textContent = file.name;
  elements.dropDetail.textContent = `${formatBytes(file.size)} - ready to extract`;
  if (!elements.issueNumber.value) {
    elements.issueNumber.value = inferIssueNumber(file.name) ?? "";
  }
}

async function runExtraction() {
  state.running = true;
  state.cancelled = false;
  state.payload = null;
  hideError();
  elements.results.hidden = true;
  elements.runStatus.hidden = false;
  elements.cancelButton.hidden = false;
  elements.cancelButton.disabled = false;
  elements.extractButton.disabled = true;
  elements.fileInput.disabled = true;
  elements.statusTitle.textContent = "Reading document";
  elements.statusDetail.textContent = "Loading the PDF text layer";
  elements.progressBar.value = 0;
  elements.pageProgress.textContent = "Page 0 of 0";
  elements.recordProgress.textContent = "0 records";

  try {
    const payload = await extractGazetteFile(
      state.file,
      {
        issueNumber: elements.issueNumber.value.trim(),
        publicationDate: elements.publicationDate.value || null,
        sourceUrl: elements.sourceUrl.value.trim() || null,
        city: elements.city.value.trim(),
        onlyCity: elements.onlyCity.checked,
        includeRawText: elements.includeRaw.checked,
      },
      pdfjs,
      {
        shouldCancel: () => state.cancelled,
        onProgress: ({ page, totalPages, segments, records }) => {
          elements.statusTitle.textContent = "Extracting company notices";
          elements.statusDetail.textContent = `${segments.toLocaleString()} notice segments examined`;
          elements.progressBar.value = Math.round((page / totalPages) * 100);
          elements.pageProgress.textContent = `Page ${page.toLocaleString()} of ${totalPages.toLocaleString()}`;
          elements.recordProgress.textContent = `${records.toLocaleString()} records`;
        },
      },
    );
    state.payload = payload;
    elements.statusTitle.textContent = "Extraction complete";
    elements.statusDetail.textContent = `${payload.summary.records.toLocaleString()} records retained from ${payload.summary.segments_examined.toLocaleString()} notice segments`;
    elements.progressBar.value = 100;
    elements.cancelButton.hidden = true;
    renderResults();
  } catch (error) {
    if (error instanceof ExtractionCancelledError) {
      elements.runStatus.hidden = true;
      showError("Extraction was cancelled. No partial file was saved.");
    } else {
      console.error(error);
      elements.runStatus.hidden = true;
      showError(
        error?.name === "PasswordException"
          ? "This PDF is password protected and cannot be read."
          : `The PDF could not be extracted: ${error?.message || "unknown error"}`,
      );
    }
  } finally {
    state.running = false;
    elements.extractButton.disabled = !state.file;
    elements.fileInput.disabled = false;
  }
}

function renderResults() {
  const { summary, records } = state.payload;
  elements.statRecords.textContent = summary.records.toLocaleString();
  elements.statReview.textContent = summary.records_needing_review.toLocaleString();
  elements.statSegments.textContent = summary.segments_examined.toLocaleString();
  elements.statPages.textContent = summary.document_pages.toLocaleString();
  elements.search.value = "";
  elements.reviewFilter.value = "";
  elements.eventFilter.replaceChildren(new Option("All events", ""));
  const events = [...new Set(records.map((record) => record.event.primary_type))].sort();
  for (const event of events) {
    elements.eventFilter.add(new Option(EVENT_LABELS[event] ?? titleCase(event), event));
  }
  renderRecords();
  elements.results.hidden = false;
  elements.results.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderRecords() {
  const records = state.payload?.records ?? [];
  const query = elements.search.value.trim().toLowerCase();
  const event = elements.eventFilter.value;
  const review = elements.reviewFilter.value;
  const filtered = records.filter((record) => {
    if (event && record.event.primary_type !== event) return false;
    if (review === "review" && !record.needs_review) return false;
    if (review === "ready" && record.needs_review) return false;
    if (!query) return true;
    return searchableText(record).toLowerCase().includes(query);
  });

  elements.recordBody.replaceChildren();
  filtered.forEach((record) => {
    const row = document.createElement("tr");
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `Open ${record.company.name || "unnamed company"} record`);
    row.append(
      companyCell(record),
      textCell(EVENT_LABELS[record.event.primary_type] ?? titleCase(record.event.primary_type), "event-badge"),
      textCell(record.company.commercial_register_number),
      textCell(record.event.decision_date),
      textCell(record.company.cities_mentioned.join(", ")),
      confidenceCell(record),
      textCell(sourceLabel(record)),
    );
    row.addEventListener("click", () => openRecord(record));
    row.addEventListener("keydown", (eventKey) => {
      if (eventKey.key === "Enter" || eventKey.key === " ") {
        eventKey.preventDefault();
        openRecord(record);
      }
    });
    elements.recordBody.append(row);
  });

  elements.visibleCount.textContent = `${filtered.length.toLocaleString()} shown`;
  elements.emptyState.hidden = filtered.length > 0;
}

function companyCell(record) {
  const cell = document.createElement("td");
  const wrapper = document.createElement("div");
  wrapper.className = "company-cell";
  const name = document.createElement("strong");
  name.textContent = record.company.name || "Name not detected";
  name.dir = "auto";
  const form = document.createElement("span");
  form.textContent = record.company.legal_form || "Legal form unknown";
  wrapper.append(name, form);
  cell.append(wrapper);
  return cell;
}

function textCell(value, className) {
  const cell = document.createElement("td");
  const text = value || "-";
  if (className) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    cell.append(span);
  } else {
    cell.textContent = text;
    cell.dir = "auto";
  }
  return cell;
}

function confidenceCell(record) {
  const cell = document.createElement("td");
  const wrapper = document.createElement("div");
  wrapper.className = "confidence-cell";
  const score = document.createElement("span");
  score.textContent = `${Math.round(record.confidence * 100)}%`;
  const badge = document.createElement("span");
  badge.className = `review-badge${record.needs_review ? "" : " ready"}`;
  badge.textContent = record.needs_review ? "Review" : "Ready";
  wrapper.append(score, badge);
  cell.append(wrapper);
  return cell;
}

function openRecord(record) {
  elements.dialogReference.textContent = [
    record.source.notice_reference ? `Notice ${record.source.notice_reference}` : "Notice",
    record.source.pdf_pages.length ? `PDF page ${record.source.pdf_pages.join(", ")}` : null,
  ].filter(Boolean).join(" - ");
  elements.dialogTitle.textContent = record.company.name || "Name not detected";
  elements.dialogTitle.dir = "auto";
  elements.dialogBody.replaceChildren(
    detailSection("Company", [
      ["Legal form", record.company.legal_form],
      ["Commercial register", record.company.commercial_register_number],
      ["Cities mentioned", record.company.cities_mentioned.join(", ")],
      ["Registered address", record.company.registered_address],
    ]),
    detailSection("Event", [
      ["Primary event", EVENT_LABELS[record.event.primary_type] ?? titleCase(record.event.primary_type)],
      ["Decision date", record.event.decision_date],
      ["Effective date", record.event.effective_date],
      ["Business purpose", record.event.business_purpose],
      ["Capital (MAD)", formatNumber(record.event.capital_mad)],
      ["Branch address", record.event.branch_address],
      ["Manager or liquidator", record.event.manager_or_liquidator],
    ]),
    detailSection("Filing and source", [
      ["Court", record.event.filing.court],
      ["Filing date", record.event.filing.date],
      ["Filing number", record.event.filing.number],
      ["Issue", record.source.issue_number],
      ["Publication date", record.source.publication_date],
      ["Printed page", record.source.printed_pages.join(", ")],
      ["Confidence", `${Math.round(record.confidence * 100)}%`],
      ["Source URL", record.source.source_url],
    ]),
  );

  if (record.review_reasons.length) {
    const section = document.createElement("section");
    section.className = "detail-section";
    const heading = document.createElement("h3");
    heading.textContent = "Review flags";
    const list = document.createElement("ul");
    list.className = "review-list";
    for (const reason of record.review_reasons) {
      const item = document.createElement("li");
      item.textContent = reason.replaceAll("_", " ");
      list.append(item);
    }
    section.append(heading, list);
    elements.dialogBody.append(section);
  }

  if (record.raw_text) {
    const section = document.createElement("section");
    section.className = "detail-section";
    const heading = document.createElement("h3");
    heading.textContent = "Extracted notice text";
    const raw = document.createElement("pre");
    raw.className = "raw-text";
    raw.dir = "auto";
    raw.textContent = record.raw_text;
    section.append(heading, raw);
    elements.dialogBody.append(section);
  }
  elements.dialog.showModal();
}

function detailSection(title, pairs) {
  const section = document.createElement("section");
  section.className = "detail-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const list = document.createElement("dl");
  list.className = "detail-grid";
  for (const [label, value] of pairs) {
    const wrapper = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = value || "-";
    detail.dir = "auto";
    wrapper.append(term, detail);
    list.append(wrapper);
  }
  section.append(heading, list);
  return section;
}

function exportJson() {
  if (!state.payload) return;
  download(
    JSON.stringify(state.payload, null, 2),
    outputFilename("json"),
    "application/json;charset=utf-8",
  );
}

function exportCsv() {
  if (!state.payload) return;
  const headers = [
    "company_name", "legal_form", "commercial_register_number", "registered_address",
    "cities_mentioned", "event_type", "event_types", "decision_date", "effective_date",
    "business_purpose", "capital_mad", "branch_address", "manager_or_liquidator",
    "filing_court", "filing_date", "filing_number", "issue_number", "publication_date",
    "pdf_pages", "printed_pages", "notice_reference", "source_url", "confidence",
    "needs_review", "review_reasons", "raw_text",
  ];
  const rows = state.payload.records.map((record) => [
    record.company.name,
    record.company.legal_form,
    record.company.commercial_register_number,
    record.company.registered_address,
    record.company.cities_mentioned.join("|"),
    record.event.primary_type,
    record.event.types.join("|"),
    record.event.decision_date,
    record.event.effective_date,
    record.event.business_purpose,
    record.event.capital_mad,
    record.event.branch_address,
    record.event.manager_or_liquidator,
    record.event.filing.court,
    record.event.filing.date,
    record.event.filing.number,
    record.source.issue_number,
    record.source.publication_date,
    record.source.pdf_pages.join("|"),
    record.source.printed_pages.join("|"),
    record.source.notice_reference,
    record.source.source_url,
    record.confidence,
    record.needs_review,
    record.review_reasons.join("|"),
    record.raw_text,
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  download(`\ufeff${csv}`, outputFilename("csv"), "text/csv;charset=utf-8");
}

function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function outputFilename(extension) {
  const issue = state.payload?.records[0]?.source.issue_number || "issue";
  const city = state.payload?.summary.city_filter || "all-cities";
  return `BOAL_${safeFilename(issue)}_${safeFilename(city)}.${extension}`;
}

function searchableText(record) {
  return [
    record.company.name,
    record.company.legal_form,
    record.company.commercial_register_number,
    record.company.registered_address,
    record.company.cities_mentioned.join(" "),
    record.event.primary_type,
    record.event.business_purpose,
    record.event.branch_address,
    record.event.manager_or_liquidator,
    record.source.notice_reference,
  ].filter(Boolean).join(" ");
}

function sourceLabel(record) {
  if (record.source.notice_reference) return record.source.notice_reference;
  if (record.source.pdf_pages.length) return `p. ${record.source.pdf_pages.join(", ")}`;
  return "-";
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatNumber(value) {
  return typeof value === "number" ? value.toLocaleString() : null;
}

function titleCase(value) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function safeFilename(value) {
  return String(value).replace(/[^A-Za-z0-9_-]+/g, "-");
}

function showError(message) {
  elements.formError.textContent = message;
  elements.formError.hidden = false;
}

function hideError() {
  elements.formError.hidden = true;
  elements.formError.textContent = "";
}
