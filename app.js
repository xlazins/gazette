import * as pdfjs from "./vendor/pdf.min.mjs";
import {
  ExtractionCancelledError,
  extractGazetteFile,
  inferIssueNumber,
} from "./parser.mjs";
import {
  httpDateToIso,
  officialPdfSource,
  parseContentRange,
} from "./source-url.mjs";

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
  cityFilter: document.querySelector("#city-filter"),
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
  activeFile: null,
  viewerDocumentPromise: null,
  pageRenderTask: null,
  dialogRecord: null,
  dialogPageIndex: 0,
  dialogZoom: 1,
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
const PDF_DOWNLOAD_CHUNK_SIZE = 2 * 1024 * 1024;

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
  if (
    state.running ||
    (!state.file && !elements.sourceUrl.value.trim())
  ) {
    return;
  }
  await runExtraction();
});

elements.cancelButton.addEventListener("click", () => {
  state.cancelled = true;
  elements.statusTitle.textContent = "Stopping extraction";
  elements.statusDetail.textContent = "Finishing the current page";
  elements.cancelButton.disabled = true;
});

for (const control of [
  elements.search,
  elements.cityFilter,
  elements.eventFilter,
  elements.reviewFilter,
]) {
  control.addEventListener("input", renderRecords);
}

elements.sourceUrl.addEventListener("input", () => {
  hideError();
  if (elements.sourceUrl.value.trim() && state.file) {
    state.file = null;
    elements.fileInput.value = "";
    elements.dropZone.classList.remove("has-file");
    elements.dropTitle.textContent = "Choose a PDF or drop it here";
    elements.dropDetail.textContent = "Official SGG BOAL issues are supported";
  }
  state.activeFile = null;
  resetViewerDocument();
  const inferredIssue = inferIssueNumber(elements.sourceUrl.value);
  if (!elements.issueNumber.value && inferredIssue) {
    elements.issueNumber.value = inferredIssue;
  }
  updateExtractButton();
});

elements.exportJson.addEventListener("click", exportJson);
elements.exportCsv.addEventListener("click", exportCsv);
elements.closeDialog.addEventListener("click", () => elements.dialog.close());
elements.dialog.addEventListener("click", (event) => {
  if (event.target === elements.dialog) elements.dialog.close();
});
elements.dialog.addEventListener("close", () => {
  state.dialogRecord = null;
  state.pageRenderTask?.cancel?.();
  state.pageRenderTask = null;
});

function selectFile(file) {
  hideError();
  resetViewerDocument();
  state.activeFile = null;
  if (!file) {
    state.file = null;
    elements.dropZone.classList.remove("has-file");
    elements.dropTitle.textContent = "Choose a PDF or drop it here";
    elements.dropDetail.textContent = "Official SGG BOAL issues are supported";
    updateExtractButton();
    return;
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    state.file = null;
    showError("Select a PDF document.");
    updateExtractButton();
    return;
  }
  state.file = file;
  elements.sourceUrl.value = "";
  elements.dropZone.classList.add("has-file");
  elements.dropTitle.textContent = file.name;
  elements.dropDetail.textContent = `${formatBytes(file.size)} - ready to extract`;
  if (!elements.issueNumber.value) {
    elements.issueNumber.value = inferIssueNumber(file.name) ?? "";
  }
  updateExtractButton();
}

function updateExtractButton() {
  elements.extractButton.disabled =
    state.running ||
    (!state.file && !elements.sourceUrl.value.trim());
}

async function downloadOfficialPdf(value) {
  const source = officialPdfSource(value);
  elements.statusTitle.textContent = "Downloading official issue";
  elements.statusDetail.textContent = source.filename;

  const chunks = [];
  let loaded = 0;
  let total = null;
  let fallbackPublicationDate = null;
  let expectedEtag = null;

  while (total === null || loaded < total) {
    if (state.cancelled) throw new ExtractionCancelledError();
    const end = loaded + PDF_DOWNLOAD_CHUNK_SIZE - 1;
    const response = await fetch(source.fetchUrl, {
      headers: {
        Range: `bytes=${loaded}-${end}`,
      },
    });
    if (!response.ok) {
      throw new Error(`The official PDF returned ${response.status}.`);
    }

    if (!fallbackPublicationDate) {
      fallbackPublicationDate = httpDateToIso(
        response.headers.get("last-modified"),
      );
    }
    const etag = response.headers.get("etag");
    if (expectedEtag && etag && etag !== expectedEtag) {
      throw new Error("The official PDF changed during download. Try again.");
    }
    expectedEtag ||= etag;

    const contentRange = parseContentRange(
      response.headers.get("content-range"),
    );
    if (response.status === 206) {
      if (!contentRange || contentRange.start !== loaded) {
        throw new Error("The official server returned an invalid PDF range.");
      }
      total ??= contentRange.total;
      if (total !== contentRange.total) {
        throw new Error("The official PDF size changed during download.");
      }
    } else if (loaded === 0 && response.status === 200) {
      total = Number(response.headers.get("content-length")) || null;
    } else {
      throw new Error("The official server does not support PDF ranges.");
    }

    const chunk = await response.blob();
    if (
      loaded === 0 &&
      chunk.type &&
      !chunk.type.toLowerCase().includes("application/pdf")
    ) {
      throw new Error("The official link did not return a PDF document.");
    }
    if (!chunk.size) {
      throw new Error("The official server returned an empty PDF range.");
    }
    chunks.push(chunk);
    loaded += chunk.size;
    if (total !== null && loaded > total) {
      throw new Error("The official server returned too much PDF data.");
    }

    elements.progressBar.value = total
      ? Math.round((loaded / total) * 100)
      : 0;
    elements.pageProgress.textContent = total
      ? `${formatBytes(loaded)} of ${formatBytes(total)}`
      : `${formatBytes(loaded)} downloaded`;
    elements.statusDetail.textContent = `${source.filename} - ${elements.progressBar.value}%`;

    if (response.status === 200) {
      total = loaded;
    }
  }

  return {
    file: new File(chunks, source.filename, {
      type: "application/pdf",
    }),
    originalUrl: source.originalUrl,
    fallbackPublicationDate,
  };
}

function resetViewerDocument() {
  state.pageRenderTask?.cancel?.();
  state.pageRenderTask = null;
  const existingDocument = state.viewerDocumentPromise;
  state.viewerDocumentPromise = null;
  existingDocument
    ?.then((document) => document.destroy())
    .catch(() => {});
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
  elements.sourceUrl.disabled = true;
  elements.statusTitle.textContent = "Reading document";
  elements.statusDetail.textContent = "Loading the PDF text layer";
  elements.progressBar.value = 0;
  elements.pageProgress.textContent = "Page 0 of 0";
  elements.recordProgress.textContent = "0 records";

  try {
    const sourceUrl = elements.sourceUrl.value.trim();
    const source = state.file
      ? {
          file: state.file,
          originalUrl: sourceUrl || null,
          fallbackPublicationDate: null,
        }
      : await downloadOfficialPdf(sourceUrl);
    state.activeFile = source.file;
    resetViewerDocument();
    if (!elements.issueNumber.value) {
      elements.issueNumber.value = inferIssueNumber(source.file.name) ?? "";
    }
    const payload = await extractGazetteFile(
      source.file,
      {
        issueNumber: elements.issueNumber.value.trim(),
        publicationDate: elements.publicationDate.value || null,
        fallbackPublicationDate: source.fallbackPublicationDate,
        sourceUrl: source.originalUrl,
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
    if (!elements.publicationDate.value && payload.summary.publication_date) {
      elements.publicationDate.value = payload.summary.publication_date;
    }
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
    elements.fileInput.disabled = false;
    elements.sourceUrl.disabled = false;
    updateExtractButton();
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
  elements.cityFilter.replaceChildren(new Option("All cities", ""));
  const cities = [...new Set(
    records.flatMap((record) => record.company.cities_mentioned),
  )].sort((a, b) => a.localeCompare(b));
  for (const city of cities) {
    elements.cityFilter.add(new Option(city, city));
  }
  if (records.some((record) => !record.company.cities_mentioned.length)) {
    elements.cityFilter.add(new Option("City not detected", "__unknown__"));
  }
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
  const city = elements.cityFilter.value;
  const event = elements.eventFilter.value;
  const review = elements.reviewFilter.value;
  const filtered = records.filter((record) => {
    if (
      city === "__unknown__" &&
      record.company.cities_mentioned.length
    ) {
      return false;
    }
    if (
      city &&
      city !== "__unknown__" &&
      !record.company.cities_mentioned.includes(city)
    ) {
      return false;
    }
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
  state.dialogRecord = record;
  state.dialogPageIndex = 0;
  state.dialogZoom = 1;
  elements.dialogReference.textContent = [
    record.source.notice_reference ? `Notice ${record.source.notice_reference}` : "Notice",
    record.source.pdf_pages.length ? `PDF page ${record.source.pdf_pages.join(", ")}` : null,
  ].filter(Boolean).join(" - ");
  elements.dialogTitle.textContent = record.company.name || "Name not detected";
  elements.dialogTitle.dir = "auto";
  const sourceSection = createSourcePageSection(record);
  elements.dialogBody.replaceChildren(
    ...[
      sourceSection,
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
    ].filter(Boolean),
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
    const section = document.createElement("details");
    section.className = "detail-section machine-text-section";
    const heading = document.createElement("summary");
    heading.textContent = "Machine text layer";
    const raw = document.createElement("pre");
    raw.className = "raw-text";
    raw.dir = containsArabic(record.raw_text) ? "rtl" : "auto";
    if (raw.dir === "rtl") raw.lang = "ar";
    raw.textContent = record.raw_text;
    section.append(heading, raw);
    elements.dialogBody.append(section);
  }
  elements.dialog.showModal();
  if (sourceSection) {
    requestAnimationFrame(() => renderDialogSourcePage());
  }
}

function createSourcePageSection(record) {
  const sources = sourceSlices(record);
  if (!state.activeFile || !sources.length) return null;

  const section = document.createElement("section");
  section.className = "detail-section source-page-section";

  const header = document.createElement("div");
  header.className = "source-page-header";
  const heading = document.createElement("h3");
  heading.textContent = "Original notice";
  const controls = document.createElement("div");
  controls.className = "page-controls";

  const previous = pageToolButton("Previous notice fragment", "\u2039", () => {
    state.dialogPageIndex = Math.max(0, state.dialogPageIndex - 1);
    renderDialogSourcePage();
  });
  previous.dataset.pageAction = "previous";
  const pageLabel = document.createElement("span");
  pageLabel.className = "page-label";
  pageLabel.dataset.pageLabel = "";
  const next = pageToolButton("Next notice fragment", "\u203a", () => {
    state.dialogPageIndex = Math.min(
      sources.length - 1,
      state.dialogPageIndex + 1,
    );
    renderDialogSourcePage();
  });
  next.dataset.pageAction = "next";
  const zoomOut = pageToolButton("Zoom out", "\u2212", () => {
    state.dialogZoom = Math.max(0.7, state.dialogZoom - 0.15);
    renderDialogSourcePage();
  });
  const zoomIn = pageToolButton("Zoom in", "+", () => {
    state.dialogZoom = Math.min(2, state.dialogZoom + 0.15);
    renderDialogSourcePage();
  });
  controls.append(previous, pageLabel, next, zoomOut, zoomIn);
  header.append(heading, controls);

  const viewport = document.createElement("div");
  viewport.className = "source-page-viewport";
  const status = document.createElement("span");
  status.className = "source-page-status";
  status.dataset.pageStatus = "";
  status.textContent = "Rendering source notice";
  const canvas = document.createElement("canvas");
  canvas.dataset.pageCanvas = "";
  canvas.setAttribute("aria-label", "Original Gazette notice");
  viewport.append(status, canvas);
  section.append(header, viewport);
  return section;
}

function pageToolButton(label, symbol, action) {
  const button = document.createElement("button");
  button.className = "page-tool";
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.textContent = symbol;
  button.addEventListener("click", action);
  return button;
}

async function renderDialogSourcePage() {
  const record = state.dialogRecord;
  const section = elements.dialogBody.querySelector(".source-page-section");
  if (!record || !section || !state.activeFile) return;

  const sources = sourceSlices(record);
  const source = sources[state.dialogPageIndex];
  const pageNumber = source?.page;
  if (!source || !pageNumber) return;
  const canvas = section.querySelector("[data-page-canvas]");
  const status = section.querySelector("[data-page-status]");
  const label = section.querySelector("[data-page-label]");
  const previous = section.querySelector('[data-page-action="previous"]');
  const next = section.querySelector('[data-page-action="next"]');
  previous.disabled = state.dialogPageIndex === 0;
  next.disabled = state.dialogPageIndex === sources.length - 1;
  label.textContent = sources.length > 1
    ? `${state.dialogPageIndex + 1} / ${sources.length} · PDF ${pageNumber}`
    : `PDF ${pageNumber}`;
  status.hidden = false;
  status.textContent = `Rendering notice from PDF page ${pageNumber}`;
  canvas.hidden = true;

  let renderTask = null;
  try {
    state.pageRenderTask?.cancel?.();
    if (!state.viewerDocumentPromise) {
      state.viewerDocumentPromise = state.activeFile.arrayBuffer().then((buffer) => (
        pdfjs.getDocument({
          data: new Uint8Array(buffer),
          stopAtErrors: false,
          useSystemFonts: true,
        }).promise
      ));
    }
    const pdfDocument = await state.viewerDocumentPromise;
    const page = await pdfDocument.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(320, section.clientWidth - 4);
    const sourceWidth = source.region
      ? source.region.right - source.region.left
      : baseViewport.width;
    const fitScale = Math.min(
      source.region ? 3.2 : 1.5,
      availableWidth / sourceWidth,
    );
    const displayScale = fitScale * state.dialogZoom;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const renderViewport = page.getViewport({
      scale: displayScale * pixelRatio,
    });
    const context = canvas.getContext("2d", { alpha: false });
    if (source.region) {
      const renderScale = displayScale * pixelRatio;
      const cropLeft = Math.floor(source.region.left * renderScale);
      const cropTop = Math.floor(
        (page.view[3] - source.region.top) * renderScale,
      );
      const cropWidth = Math.ceil(
        (source.region.right - source.region.left) * renderScale,
      );
      const cropHeight = Math.ceil(
        (source.region.top - source.region.bottom) * renderScale,
      );
      canvas.width = cropWidth;
      canvas.height = cropHeight;
      canvas.style.width = `${Math.ceil(cropWidth / pixelRatio)}px`;
      canvas.style.height = `${Math.ceil(cropHeight / pixelRatio)}px`;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, cropWidth, cropHeight);
      renderTask = page.render({
        canvasContext: context,
        viewport: renderViewport,
        transform: [1, 0, 0, 1, -cropLeft, -cropTop],
      });
    } else {
      canvas.width = Math.ceil(renderViewport.width);
      canvas.height = Math.ceil(renderViewport.height);
      canvas.style.width = `${Math.floor(renderViewport.width / pixelRatio)}px`;
      canvas.style.height = `${Math.floor(renderViewport.height / pixelRatio)}px`;
      renderTask = page.render({
        canvasContext: context,
        viewport: renderViewport,
      });
    }
    state.pageRenderTask = renderTask;
    await renderTask.promise;
    if (record !== state.dialogRecord) return;
    canvas.hidden = false;
    status.hidden = true;
    page.cleanup();
  } catch (error) {
    if (error?.name === "RenderingCancelledException") return;
    console.error(error);
    status.textContent = "The source page could not be rendered.";
  } finally {
    if (state.pageRenderTask === renderTask) {
      state.pageRenderTask = null;
    }
  }
}

function sourceSlices(record) {
  const regions = Array.isArray(record.source.regions)
    ? record.source.regions.filter(
        (region) => (
          Number.isInteger(region.page) &&
          Number.isFinite(region.left) &&
          Number.isFinite(region.right) &&
          Number.isFinite(region.top) &&
          Number.isFinite(region.bottom)
        ),
      )
    : [];
  if (regions.length) {
    return regions.map((region) => ({ page: region.page, region }));
  }
  return record.source.pdf_pages
    .filter((page) => Number.isInteger(page))
    .map((page) => ({ page, region: null }));
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

function containsArabic(value) {
  return /[\u0600-\u06ff]/u.test(String(value ?? ""));
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
