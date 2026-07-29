from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any

from .models import ParsedNotice, SCHEMA_VERSION
from .parser import GazetteNoticeParser
from .pdf_issue import PypdfIssueExtractor


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="boal-extract",
        description="Extract structured company events from Moroccan BOAL PDFs.",
    )
    parser.add_argument("pdf", type=Path, help="Path to a BOAL PDF")
    parser.add_argument("-o", "--output", type=Path, help="Output file path")
    parser.add_argument("--format", choices=("json", "jsonl", "csv"), default="json")
    parser.add_argument("--issue-number", help="BOAL issue number; inferred from filename")
    parser.add_argument("--publication-date", help="ISO date, for example 2026-04-29")
    parser.add_argument("--source-url", help="Official SGG PDF URL")
    parser.add_argument("--start-page", type=int, default=1, help="First PDF page, 1-based")
    parser.add_argument("--end-page", type=int, help="Last PDF page, inclusive")
    parser.add_argument("--city", help="Keep records mentioning this detected city")
    parser.add_argument("--min-confidence", type=float, default=0.0)
    parser.add_argument(
        "--without-raw-text",
        action="store_true",
        help="Omit notice text from the output",
    )
    parser.add_argument(
        "--include-incomplete",
        action="store_true",
        help="Attempt to parse the final segment even without a notice reference",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.pdf.is_file():
        print(f"error: PDF not found: {args.pdf}", file=sys.stderr)
        return 2
    if not 0 <= args.min_confidence <= 1:
        print("error: --min-confidence must be between 0 and 1", file=sys.stderr)
        return 2

    extractor = PypdfIssueExtractor(args.pdf, args.issue_number)
    issue_number = args.issue_number or extractor.issue_number
    notice_parser = GazetteNoticeParser(
        pdf_path=args.pdf,
        issue_number=issue_number,
        publication_date=args.publication_date,
        source_url=args.source_url,
        include_raw_text=not args.without_raw_text,
    )

    records: list[ParsedNotice] = []
    segment_count = 0
    for segment in extractor.iter_segments(
        start_page=args.start_page,
        end_page=args.end_page,
        include_incomplete=args.include_incomplete,
    ):
        segment_count += 1
        record = notice_parser.parse(segment)
        if record is None or record.confidence < args.min_confidence:
            continue
        if args.city and not _matches_city(record, args.city):
            continue
        records.append(record)

    output = args.output or args.pdf.with_suffix(f".notices.{args.format}")
    output.parent.mkdir(parents=True, exist_ok=True)
    _write_output(output, args.format, records, segment_count, extractor.page_count)
    print(
        f"extracted {len(records)} records from {segment_count} notice segments "
        f"({args.start_page}-{args.end_page or extractor.page_count} of "
        f"{extractor.page_count} pages) -> {output}"
    )
    return 0


def _matches_city(record: ParsedNotice, requested: str) -> bool:
    needle = requested.casefold()
    return any(needle == city.casefold() for city in record.company.cities_mentioned)


def _write_output(
    output: Path,
    output_format: str,
    records: list[ParsedNotice],
    segment_count: int,
    document_pages: int,
) -> None:
    dictionaries = [record.to_dict() for record in records]
    if output_format == "json":
        payload = {
            "schema_version": SCHEMA_VERSION,
            "summary": {
                "records": len(records),
                "segments_examined": segment_count,
                "document_pages": document_pages,
                "records_needing_review": sum(record.needs_review for record in records),
            },
            "records": dictionaries,
        }
        output.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return

    if output_format == "jsonl":
        with output.open("w", encoding="utf-8", newline="\n") as stream:
            for record in dictionaries:
                stream.write(json.dumps(record, ensure_ascii=False) + "\n")
        return

    rows = [_flatten_csv(record) for record in dictionaries]
    fieldnames = list(rows[0]) if rows else [
        "company_name",
        "event_type",
        "issue_number",
        "pdf_pages",
        "confidence",
    ]
    with output.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def _flatten_csv(record: dict[str, Any]) -> dict[str, Any]:
    source = record["source"]
    company = record["company"]
    event = record["event"]
    filing = event["filing"]
    return {
        "company_name": company["name"],
        "legal_form": company["legal_form"],
        "commercial_register_number": company["commercial_register_number"],
        "registered_address": company["registered_address"],
        "cities_mentioned": "|".join(company["cities_mentioned"]),
        "event_type": event["primary_type"],
        "event_types": "|".join(event["types"]),
        "decision_date": event["decision_date"],
        "effective_date": event["effective_date"],
        "business_purpose": event["business_purpose"],
        "capital_mad": event["capital_mad"],
        "branch_address": event["branch_address"],
        "manager_or_liquidator": event["manager_or_liquidator"],
        "filing_court": filing["court"],
        "filing_date": filing["date"],
        "filing_number": filing["number"],
        "issue_number": source["issue_number"],
        "publication_date": source["publication_date"],
        "pdf_pages": "|".join(str(page) for page in source["pdf_pages"]),
        "printed_pages": "|".join(source["printed_pages"]),
        "notice_reference": source["notice_reference"],
        "source_url": source["source_url"],
        "confidence": record["confidence"],
        "needs_review": record["needs_review"],
        "review_reasons": "|".join(record["review_reasons"]),
    }
