from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path

from pypdf import PdfReader

from .models import RawNoticeSegment
from .normalize import normalize_text


NOTICE_END_RE = re.compile(r"^\s*(\d{1,7})\s*([A-Z])\s*$")
NUMBER_RE = re.compile(r"\b\d{3,6}\b")


class PypdfIssueExtractor:
    """Extract BOAL notice-sized text segments from the PDF text layer.

    BOAL body pages use four columns read from right to left. The SGG PDFs'
    internal text stream generally follows that order. A short reference such
    as ``677I`` or ``22P`` terminates each legal notice, including notices that
    continue into another column or page.
    """

    def __init__(self, pdf_path: str | Path, issue_number: str | None = None):
        self.pdf_path = Path(pdf_path)
        self.issue_number = issue_number or self._issue_from_filename()
        self.reader = PdfReader(str(self.pdf_path))

    @property
    def page_count(self) -> int:
        return len(self.reader.pages)

    def iter_segments(
        self,
        start_page: int = 1,
        end_page: int | None = None,
        include_incomplete: bool = False,
    ) -> Iterator[RawNoticeSegment]:
        if start_page < 1:
            raise ValueError("start_page must be at least 1")
        end_page = min(end_page or self.page_count, self.page_count)
        if start_page > end_page:
            raise ValueError("start_page must not be after end_page")

        pending: list[str] = []
        pending_pages: list[int] = []
        pending_printed_pages: list[str] = []

        for page_number in range(start_page, end_page + 1):
            page_text = normalize_text(self.reader.pages[page_number - 1].extract_text() or "")
            printed_page = self._printed_page(page_text)

            for line in page_text.splitlines():
                marker = NOTICE_END_RE.fullmatch(line)
                if marker:
                    text = "\n".join(pending).strip()
                    if text:
                        yield RawNoticeSegment(
                            text=text,
                            pdf_pages=pending_pages.copy(),
                            printed_pages=pending_printed_pages.copy(),
                            reference=f"{marker.group(1)}{marker.group(2)}",
                        )
                    pending.clear()
                    pending_pages.clear()
                    pending_printed_pages.clear()
                    continue

                if not line.strip():
                    continue
                pending.append(line)
                if page_number not in pending_pages:
                    pending_pages.append(page_number)
                if printed_page and printed_page not in pending_printed_pages:
                    pending_printed_pages.append(printed_page)

        if include_incomplete and pending:
            yield RawNoticeSegment(
                text="\n".join(pending).strip(),
                pdf_pages=pending_pages,
                printed_pages=pending_printed_pages,
                reference=None,
            )

    def _issue_from_filename(self) -> str | None:
        match = re.search(r"BOAL[_-](\d+(?:-bis)?)", self.pdf_path.stem, re.IGNORECASE)
        return match.group(1) if match else None

    def _printed_page(self, page_text: str) -> str | None:
        header = "\n".join(page_text.splitlines()[:5])
        candidates: list[int] = []
        for value in NUMBER_RE.findall(header):
            number = int(value)
            if (
                value == self.issue_number
                or 1300 <= number <= 2100
                or number >= 100_000
            ):
                continue
            candidates.append(number)
        return str(max(candidates)) if candidates else None
