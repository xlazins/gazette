from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


SCHEMA_VERSION = "1.0.0"


@dataclass(slots=True)
class RawNoticeSegment:
    text: str
    pdf_pages: list[int]
    printed_pages: list[str]
    reference: str | None


@dataclass(slots=True)
class SourceRecord:
    series: str
    issue_number: str | None
    publication_date: str | None
    pdf_path: str
    source_url: str | None
    pdf_pages: list[int]
    printed_pages: list[str]
    notice_reference: str | None


@dataclass(slots=True)
class CompanyRecord:
    name: str | None
    legal_form: str | None
    commercial_register_number: str | None
    registered_address: str | None
    cities_mentioned: list[str] = field(default_factory=list)


@dataclass(slots=True)
class FilingRecord:
    court: str | None = None
    date: str | None = None
    number: str | None = None


@dataclass(slots=True)
class EventRecord:
    primary_type: str
    types: list[str]
    decision_date: str | None = None
    effective_date: str | None = None
    business_purpose: str | None = None
    capital_mad: int | None = None
    branch_address: str | None = None
    manager_or_liquidator: str | None = None
    filing: FilingRecord = field(default_factory=FilingRecord)


@dataclass(slots=True)
class ParsedNotice:
    source: SourceRecord
    company: CompanyRecord
    event: EventRecord
    confidence: float
    needs_review: bool
    review_reasons: list[str]
    raw_text: str | None

    def to_dict(self) -> dict[str, Any]:
        return {"schema_version": SCHEMA_VERSION, **asdict(self)}
