# Morocco BOAL Gazette Extractor

Standalone, local-first extraction of company legal events from Morocco's
`BOAL` Gazette PDFs. It does not call an AI API or a paid data provider.

## Browser Tool

Open the deployed site, select an official BOAL PDF or paste its direct SGG
link, and start extraction. Issue number and publication date are inferred when
possible and can be overridden under optional metadata. The application:

- reads the PDF text layer locally with Mozilla PDF.js;
- reconstructs the four columns in right-to-left reading order;
- separates notices using the numbered marker at the lower-left of each box;
- identifies the subject from its bold Latin company-name heading;
- classifies company events and extracts evidence fields;
- retains notices from every detected city, with city filtering after extraction;
- provides review flags, machine text and exact notice-box renderings;
- exports the result as structured JSON or UTF-8 CSV.

An uploaded PDF never leaves the browser. A pasted official link is downloaded
through a restricted same-origin Vercel rewrite and processed locally after it
arrives. SGG's BulletinOfficiel HTML page is only an index; the legal notices
remain inside the linked PDF. The city filter means "mentioned anywhere in the
notice"; a match can therefore come from a registered office, branch,
shareholder or representative address.

## What It Produces

Each notice becomes an event record with:

- official issue, PDF page, printed page, notice reference and source URL;
- company name, legal form, commercial-register number and registered address;
- event type or types, including incorporation, branch opening, registered
  office change, capital change, management change, dissolution, liquidation,
  liquidation closure and removal from the register;
- dates, business purpose, capital, branch address, manager or liquidator, and
  legal filing details when present;
- confidence, review reasons and the original notice text.

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

## Current Boundary

BOAL PDFs have four-column pages and notice-ending references such as `677I`.
The parser orders the columns geometrically, carries an unfinished box into the
next column or page, and stores every physical fragment in `source.regions`.
The browser record dialog renders those fragments in order, so a notice split
at a page boundary remains one reviewable company record.

Some SGG issues contain damaged Arabic Unicode mappings even though the printed
page is correct. `tools/ocr-notice.mjs` is the focused accuracy utility for
those records: it locates a notice by reference, renders all of its stored
regions, runs free local Arabic OCR, and combines the OCR prose with exact
dates and numbers retained by the embedded PDF text. `ocr-fields.mjs` then
extracts labeled fields without a generative model. The browser uploader does
not yet run OCR over an entire issue because doing so synchronously for
thousands of boxes would be slow; damaged records remain explicitly flagged.

PDF.js is vendored under the Apache-2.0 license in `vendor/`.

## Real-Issue Validation

The browser extractor was run across every page of official issue 5922:

- 709 PDF pages;
- 1,941 completed notice segments;
- 1,486 company-event records retained across all cities;
- 425 retained records span more than one PDF page;
- KLEAT identified as a branch opening, RC `8523`, dated `2026-02-26`;
- SAFRES identified as a dissolution, RC `5059`, dated `2026-03-27`;
- the legal advertiser `FORMAFID CONSEIL` is not mistaken for SAFRES;
- cross-page notice `42P` retains its complete purpose and filing section;
- Settat postal code `26000` is not accepted as a commercial-register number.

Records affected by this issue's damaged Arabic text layer remain reviewable.
Names, dates and register numbers can still be high-confidence, while affected
addresses and personal names remain flagged or `null`. The API dataset contains
the same all-city extraction and accepts `city` as a query filter.
