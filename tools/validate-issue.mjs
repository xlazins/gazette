import fs from "node:fs";
import { pathToFileURL } from "node:url";

import { extractGazetteFile } from "../parser.mjs";

const pdfPath = process.argv[2];
const pdfjsPath = process.env.PDFJS_PATH;
const targets = new Set(process.argv.slice(3));

if (!pdfPath || !pdfjsPath) {
  console.error(
    "Usage: PDFJS_PATH=... node tools/validate-issue.mjs issue.pdf [NAME_OR_REF...]",
  );
  process.exitCode = 1;
} else {
  globalThis.requestAnimationFrame = (callback) => setImmediate(callback);
  const pdfjs = await import(pathToFileURL(pdfjsPath).href);
  const bytes = fs.readFileSync(pdfPath);
  const payload = await extractGazetteFile({
    name: pdfPath.split(/[\\/]/).at(-1),
    arrayBuffer: async () => bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ),
  }, {
    includeRawText: true,
  }, pdfjs);

  const multiPage = payload.records.filter(
    (record) => record.source.pdf_pages.length > 1,
  );
  const previousPath = new URL("../data/BOAL_5922_all.json", import.meta.url);
  let comparison = null;
  if (fs.existsSync(previousPath)) {
    const previous = JSON.parse(fs.readFileSync(previousPath, "utf8"));
    const currentReferences = new Set(
      payload.records.map((record) => record.source.notice_reference),
    );
    const previousReferences = new Set(
      previous.records.map((record) => record.source.notice_reference),
    );
    comparison = {
      missing_from_current: [...previousReferences].filter(
        (reference) => !currentReferences.has(reference),
      ),
      new_in_current: [...currentReferences].filter(
        (reference) => !previousReferences.has(reference),
      ),
    };
    comparison.new_current_records = payload.records
      .filter(
        (record) => comparison.new_in_current.includes(
          record.source.notice_reference,
        ),
      )
      .map((record) => ({
        reference: record.source.notice_reference,
        company: record.company.name,
        event: record.event.primary_type,
        pages: record.source.pdf_pages,
      }));
  }
  console.log(JSON.stringify({
    summary: payload.summary,
    multiPageRecords: multiPage.length,
    comparison,
    targets: payload.records
      .filter((record) => (
        targets.has(record.company.name) ||
        targets.has(record.source.notice_reference)
      ))
      .map((record) => ({
        reference: record.source.notice_reference,
        pages: record.source.pdf_pages,
        regions: record.source.regions,
        company: record.company,
        event: record.event,
        reviewReasons: record.review_reasons,
        rawFirstLines: record.raw_text?.split("\n").slice(0, 12),
      })),
  }, null, 2));
}
