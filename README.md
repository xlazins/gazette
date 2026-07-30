# Morocco BOAL Gazette Extractor

Standalone, local-first conversion of PaddleOCR-VL results and Moroccan `BOAL`
Gazette PDFs into structured company legal events. It does not call an AI API
or a paid data provider.

## Browser Tool

For the highest-accuracy workflow:

1. Run the official BOAL PDF through PaddleOCR-VL 1.6 manually.
2. Download PaddleOCR's complete JSON result.
3. Upload that JSON to this site.
4. Review, filter and export the resulting company-event records.

Issue number and publication date are inferred from the JSON filename and page
headers when possible. The application:

- reads `prunedResult.parsing_res_list`, not Paddle's mixed page-level Markdown;
- reconstructs four-column pages in right-to-left reading order using block
  coordinates;
- transposes Paddle table-layout pages back into column streams and flags
  affected records for review;
- separates notices using printed reference markers and bold company headings;
- records when an `I` suffix was inferred from Paddle's common `...1` reading;
- classifies company events and extracts evidence fields;
- retains notices from every detected city, with city filtering after extraction;
- provides review flags and the exact PaddleOCR notice transcript;
- exports the result as structured JSON or UTF-8 CSV.

The JSON never leaves the browser. Direct PDF upload and official SGG-link
processing remain available as a fallback. For PDFs, the existing browser
pipeline reads the embedded text layer and can selectively run local Tesseract
OCR. SGG's BulletinOfficiel HTML page is only an index; the legal notices remain
inside the linked PDF.

## What It Produces

Each notice becomes an event record with:

- official issue, PDF page, printed page, notice reference and source URL;
- company name, legal form, commercial-register number and registered address;
- event type or types, including incorporation, branch opening, registered
  office change, capital change, management change, dissolution, liquidation,
  liquidation closure and removal from the register;
- dates, business purpose, capital, branch address, manager or liquidator, and
  legal filing details when present;
- confidence, review reasons, the original notice text and OCR provenance.

The output is evidence-oriented. Missing or damaged fields remain `null`; the
extractor does not invent values.

The record contract is available at
[`schema/notice.schema.json`](schema/notice.schema.json).

## Install And Run

Python 3.11 or newer is required.

```powershell
python -m pip install -e .
python -m gazette_extractor `
  "path\to\BOAL_5922.pdf" `
  --issue-number 5922 `
  --publication-date 2026-04-29 `
  --source-url "https://www.sgg.gov.ma/BO/AR/3111/2026/BOAL_5922.pdf" `
  --city Settat `
  --format json `
  --output ".\data\BOAL_5922_settat.json"
```

Remove `--city Settat` to retain all detected cities.

For a fast page-level check:

```powershell
python -m gazette_extractor `
  "path\to\BOAL_5922.pdf" `
  --start-page 332 `
  --end-page 332 `
  --format json `
  --output ".\data\page-332.json"
```

## Output Formats

- `json`: run summary and a `records` array.
- `jsonl`: one complete event record per line for database ingestion.
- `csv`: flattened UTF-8 spreadsheet export.

## Vercel Deployment And API

This repository can be imported directly from GitHub into Vercel. It exposes:

- `GET /` - the PDF upload and extraction tool;
- `GET /api` - service status and endpoint discovery;
- `GET /api/companies` - all checked records;
- `GET /api/companies?city=Settat`;
- `GET /api/companies?event=DISSOLUTION`;
- `GET /api/companies?company=KLEAT`;
- `GET /api/companies?q=8523&min_confidence=0.8`;
- `GET /api/companies?needs_review=true&limit=100&offset=0`.

API responses are UTF-8 JSON with permissive read-only CORS headers. The API
serves preprocessed data; interactive PDF extraction runs in the browser.

## Import Boundary

The supported Paddle input is the complete JSON array exported by
PaddleOCR-VL, with one object per PDF page. The importer requires either
`prunedResult.parsing_res_list` or `markdown.text` page data. Coordinate blocks
are preferred. Output-image URLs are intentionally ignored because they are
remote, temporary processing artifacts.

BOAL issues have four-column pages and notice-ending references such as `677I`.
The importer carries unfinished notices into the next column or page and stores
their physical fragments in `source.regions`. Paddle sometimes recognizes the
letter `I` as the digit `1`; those references are normalized and marked with
`source.notice_reference_inferred: true`.

Some pages are returned by Paddle as a single HTML table instead of coordinate
blocks. The importer reconstructs reasonable column streams from table cells
and adds `paddle_table_layout_reconstructed` to the affected records. Pathological
table pages are retained as text where possible and explicitly flagged.

PDF.js, Tesseract.js, Tesseract.js Core and the language models are vendored
under the Apache-2.0 license in `vendor/`; license notices are in
`vendor/licenses/`.

## Real-Issue Validation

The browser extractor was run across every page of official issue 5922:

- 709 PDF pages;
- 1,941 completed notice segments;
- 1,486 company-event records retained across all cities;
- 420 retained records span more than one PDF page;
- KLEAT identified as a branch opening, RC `8523`, dated `2026-02-26`;
- SAFRES identified as a dissolution, RC `5059`, dated `2026-03-27`;
- the legal advertiser `FORMAFID CONSEIL` is not mistaken for SAFRES;
- cross-page notice `42P` retains its complete purpose and filing section;
- Settat postal code `26000` is not accepted as a commercial-register number.

Using the supplied PaddleOCR-VL 1.6 JSON for issue 5922, the importer validates:

- all 709 page objects and the 2026-04-29 publication date;
- KLEAT as a branch opening, RC `8523`, dated `2026-02-26`, including its
  branch address, manager and filing;
- SAFRES as a dissolution, RC `5059`, including its liquidator and filing;
- notices that continue across page boundaries;
- UTF-8 Arabic without depending on the PDF's damaged text encoding.
