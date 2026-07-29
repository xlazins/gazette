# Morocco BOAL Gazette Extractor

Standalone, local-first extraction of company legal events from Morocco's
`BOAL` Gazette PDFs. It does not call an AI API or a paid data provider.

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

## Vercel API

This repository can be imported directly from GitHub into Vercel. It exposes:

- `GET /` - service status and endpoint discovery;
- `GET /api/companies` - all checked records;
- `GET /api/companies?event=DISSOLUTION`;
- `GET /api/companies?company=KLEAT`;
- `GET /api/companies?q=8523&min_confidence=0.8`;
- `GET /api/companies?needs_review=true&limit=100&offset=0`.

Responses are UTF-8 JSON with permissive read-only CORS headers. The API serves
preprocessed data; it does not run the 709-page PDF extractor during a request.

## Current Boundary

BOAL PDFs have four-column pages and notice-ending references such as `677I`.
The parser uses those references to preserve notices that cross columns or
pages. Some SGG issues contain damaged Arabic Unicode mappings even though the
PDF looks correct. Those records are emitted with review flags and source text.

The next reliability layer is optional local Arabic OCR using Tesseract. It
should be invoked only for pages whose embedded text fails quality checks,
keeping normal extraction fast and fully free.

## Real-Issue Validation

The extractor was run across every page of official issue 5922:

- 709 PDF pages;
- 1,941 completed notice segments;
- 17 records mentioning Settat;
- KLEAT identified as a branch opening, RC `8523`, dated `2026-02-26`;
- SAFRES identified as a dissolution, RC `5059`, dated `2026-03-27`;
- the legal advertiser `FORMAFID CONSEIL` is not mistaken for SAFRES;
- Settat postal code `26000` is not accepted as a commercial-register number.

All 17 Settat records remain reviewable because this issue's Arabic text layer
uses a damaged font mapping. Names, dates and register numbers can still be
high-confidence, while affected addresses and personal names remain flagged or
`null`. The checked output is in `data/BOAL_5922_settat.json`.
