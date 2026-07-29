from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

from .models import (
    CompanyRecord,
    EventRecord,
    FilingRecord,
    ParsedNotice,
    RawNoticeSegment,
    SourceRecord,
)
from .normalize import compact_lines, fold_arabic, normalize_date, normalize_text


EVENT_RULES: list[tuple[str, tuple[str, ...]]] = [
    (
        "CONTINUATION_AFTER_LOSSES",
        (
            r"عدم\s+حل.*الاستمرار\s+في\s+النشاط",
            r"continuation\s+de\s+l.?activit",
        ),
    ),
    (
        "REMOVAL_FROM_REGISTER",
        (
            r"التشطيب\s+(?:النهائي\s+)?من\s+السجل\s+التجاري",
            r"radiation\s+(?:definitive\s+)?du\s+registre",
        ),
    ),
    (
        "LIQUIDATION_CLOSED",
        (
            r"(?:اغلاق|قفل|اختتام|ختم)\s+(?:ال\w+\s+)?(?:اعمال\s+)?التصفيه",
            r"cloture\s+(?:definitive\s+)?de\s+(?:la\s+)?liquidation",
        ),
    ),
    (
        "DISSOLUTION",
        (
            r"(?:حل|انحلال)\s+(?:مسبق|مبكر)?\s*(?:لل)?شركه",
            r"حل\s+الشركه\s+قبل\s+الاوان",
            r"dissolution\s+(?:anticipee\s+)?(?:de\s+la\s+)?societe",
        ),
    ),
    (
        "LIQUIDATION",
        (
            r"(?:تعيين|تسميه).{0,40}(?:مصفي|مصفية)",
            r"تصفية\s+(?:لل)?شركه",
            r"mise\s+en\s+liquidation",
        ),
    ),
    (
        "BRANCH_OPENING",
        (
            r"انشاء\s+فرع",
            r"فتح\s+فرع",
            r"creation\s+d.?une\s+succursale",
        ),
    ),
    (
        "INCORPORATION",
        (
            r"تاسيس\s+(?:ال)?شركه",
            r"اعلان\s+عن\s+تاسيس",
            r"constitution\s+(?:d.?une\s+)?societe",
        ),
    ),
    (
        "BUSINESS_PURPOSE_CHANGE",
        (
            r"(?:تغيير|تعديل).{0,30}غرض\s+(?:ال)?شركه",
            r"modification\s+de\s+l.?objet\s+social",
        ),
    ),
    (
        "REGISTERED_OFFICE_CHANGE",
        (
            r"(?:تحويل|تغيير).{0,35}المقر\s+الاجتماعي",
            r"transfert\s+(?:du\s+)?siege\s+social",
        ),
    ),
    (
        "LEGAL_FORM_CHANGE",
        (
            r"تغيير\s+الشكل\s+القانوني",
            r"transformation\s+(?:de\s+la\s+)?forme\s+juridique",
        ),
    ),
    (
        "CAPITAL_CHANGE",
        (
            r"(?:رفع|زياده|تخفيض).{0,30}راسما?ل",
            r"(?:augmentation|reduction)\s+(?:du\s+)?capital",
        ),
    ),
    (
        "MANAGER_CHANGE",
        (
            r"(?:تعيين|استقاله|عزل|تغيير).{0,35}(?:مسير|مدير)",
            r"(?:nomination|demission|revocation).{0,30}(?:gerant|administrateur)",
        ),
    ),
    (
        "SHARE_TRANSFER",
        (
            r"(?:تفويت|تحويل).{0,30}(?:حصص|اسهم)",
            r"cession\s+(?:de\s+)?(?:parts|actions)",
        ),
    ),
]

CITY_PATTERNS: dict[str, tuple[str, ...]] = {
    "Settat": (r"سطات", r"\bsettat\b"),
    "Casablanca": (r"الدار\s+البيضاء", r"\bcasablanca\b"),
    "Rabat": (r"\bالرباط\b", r"\brabat\b"),
    "Marrakech": (r"\bمراكش\b", r"\bmarrakech\b"),
    "Tangier": (r"\bطنجه\b", r"\btanger\b", r"\btangier\b"),
    "Fes": (r"\bفاس\b", r"\bfes\b", r"\bfez\b"),
    "Meknes": (r"\bمكناس\b", r"\bmeknes\b"),
    "Agadir": (r"\bاكادير\b", r"\bagadir\b"),
    "Kenitra": (r"\bالقنيطره\b", r"\bkenitra\b"),
    "El Jadida": (r"الجديده", r"\bel\s+jadida\b"),
    "Mohammedia": (r"المحمديه", r"\bmohammedia\b"),
    "Beni Mellal": (r"بني\s+ملال", r"\bbeni\s+mellal\b"),
    "Oujda": (r"\bوجده\b", r"\boujda\b"),
    "Safi": (r"\bاسفي\b", r"\bsafi\b"),
    "Khouribga": (r"\bخريبكه\b", r"\bkhouribga\b"),
    "Berrechid": (r"\bبرشيد\b", r"\bberrechid\b"),
}

MONTH_NUMBERS = {
    "يناير": 1,
    "فبراير": 2,
    "مارس": 3,
    "ابريل": 4,
    "ماي": 5,
    "يونيو": 6,
    "يوليوز": 7,
    "غشت": 8,
    "شتنبر": 9,
    "اكتوبر": 10,
    "نونبر": 11,
    "دجنبر": 12,
    "janvier": 1,
    "fevrier": 2,
    "mars": 3,
    "avril": 4,
    "mai": 5,
    "juin": 6,
    "juillet": 7,
    "aout": 8,
    "septembre": 9,
    "octobre": 10,
    "novembre": 11,
    "decembre": 12,
}

LEGAL_FORM_RULES: list[tuple[str, str]] = [
    (r"\bS\.?\s*A\.?\s*R\.?\s*L\.?\s*A\.?\s*U\.?\b|\bSARLAU\b|\bSARL\s+AU\b", "SARL AU"),
    (r"\bS\.?\s*A\.?\s*R\.?\s*L\.?\b|\bSARL\b", "SARL"),
    (r"\bS\.?\s*A\.?\s*S\.?\b|\bSAS\b", "SAS"),
    (r"\bS\.?\s*A\.?\b|\bSA\b", "SA"),
    (
        r"شركه\s+ذات\s+مسووليه\s+محدوده.{0,40}(?:ال)?شريك\s+(?:ال)?وحيد",
        "SARL AU",
    ),
    (r"شركه\s+لوت\s+مسواذيه\s+مح.{0,40}وذشريك\s+وذوحي", "SARL AU"),
    (r"شركه\s+ذات\s+مسووليه\s+محدوده", "SARL"),
    (r"شركه\s+لوت\s+مسواذيه\s+مح", "SARL"),
    (r"شركه\s+مساهمه", "SA"),
]

GENERIC_LATIN_LINES = {
    "SARL",
    "SARLAU",
    "SARL AU",
    "S.A.R.L",
    "S.A.R.L.AU",
    "SA",
    "S.A",
    "SAS",
    "RC",
    "ICE",
    "MAROC",
    "MOROCCO",
}

SUSPECT_FONT_MAPPING_TERMS = ("وذشريك", "وذوحي", "مسواذيه", "لوت")


class GazetteNoticeParser:
    def __init__(
        self,
        pdf_path: str | Path,
        issue_number: str | None = None,
        publication_date: str | None = None,
        source_url: str | None = None,
        include_raw_text: bool = True,
    ):
        self.pdf_path = str(Path(pdf_path).resolve())
        self.issue_number = issue_number
        self.publication_date = publication_date
        self.source_url = source_url
        self.include_raw_text = include_raw_text

    def parse(self, segment: RawNoticeSegment) -> ParsedNotice | None:
        text = normalize_text(segment.text)
        truncated = False
        if len(text) > 20_000:
            text = text[-20_000:]
            truncated = True

        folded = fold_arabic(text)
        suspect_font_mapping = sum(term in folded for term in SUSPECT_FONT_MAPPING_TERMS) >= 2
        event_types = self._event_types(folded)
        company_name = self._company_name(text)
        if not event_types:
            return None

        lines = compact_lines(text)
        legal_form = self._legal_form(text)
        register_number = self._register_number(lines, company_name)
        dates = self._dates(text)
        cities = self._cities(folded)
        registered_address = self._field_block(
            lines,
            required_terms=("اجتماعي",),
            max_following=3,
        )
        purpose = self._field_block(
            lines,
            required_terms=("غرض", "ايجاز"),
            max_following=8,
        )
        branch_address = (
            self._branch_address(lines) if "BRANCH_OPENING" in event_types else None
        )
        manager = self._manager_or_liquidator(lines)
        filing = self._filing(lines, dates)
        capital = self._capital(text)

        review_reasons: list[str] = []
        if truncated:
            review_reasons.append("notice_text_trimmed_after_20000_characters")
        if "\ufffd" in text:
            review_reasons.append("source_text_has_unmapped_glyphs")
        if suspect_font_mapping:
            review_reasons.append("source_text_has_suspect_font_mapping")
        if company_name is None:
            review_reasons.append("company_name_missing")
        if register_number is None:
            review_reasons.append("commercial_register_number_missing")
        if legal_form is None:
            review_reasons.append("legal_form_missing")
        if not dates:
            review_reasons.append("event_date_missing")
        if "BRANCH_OPENING" in event_types and branch_address is None:
            review_reasons.append("branch_address_missing")
        if (
            any(event in event_types for event in ("DISSOLUTION", "LIQUIDATION"))
            and manager is None
        ):
            review_reasons.append("liquidator_missing")
        if not cities:
            review_reasons.append("city_not_detected")

        confidence = 0.30
        confidence += 0.25 if company_name else 0
        confidence += 0.15 if register_number else 0
        confidence += 0.10 if legal_form else 0
        confidence += 0.10 if dates else 0
        confidence += 0.05 if cities else 0
        confidence += 0.05 if (branch_address or purpose or manager) else 0
        if "\ufffd" in text or suspect_font_mapping:
            confidence -= 0.10
        confidence = round(max(0.0, min(confidence, 1.0)), 2)

        source = SourceRecord(
            series="BOAL",
            issue_number=self.issue_number,
            publication_date=self.publication_date,
            pdf_path=self.pdf_path,
            source_url=self.source_url,
            pdf_pages=segment.pdf_pages,
            printed_pages=segment.printed_pages,
            notice_reference=segment.reference,
        )
        company = CompanyRecord(
            name=company_name,
            legal_form=legal_form,
            commercial_register_number=register_number,
            registered_address=registered_address,
            cities_mentioned=cities,
        )
        event = EventRecord(
            primary_type=event_types[0],
            types=event_types,
            decision_date=dates[0] if dates else None,
            effective_date=dates[1] if len(dates) > 1 else None,
            business_purpose=purpose,
            capital_mad=capital,
            branch_address=branch_address,
            manager_or_liquidator=manager,
            filing=filing,
        )
        return ParsedNotice(
            source=source,
            company=company,
            event=event,
            confidence=confidence,
            needs_review=bool(review_reasons) or confidence < 0.85,
            review_reasons=review_reasons,
            raw_text=text if self.include_raw_text else None,
        )

    def _event_types(self, folded: str) -> list[str]:
        found: list[str] = []
        for event_type, patterns in EVENT_RULES:
            if any(re.search(pattern, folded, re.IGNORECASE | re.DOTALL) for pattern in patterns):
                found.append(event_type)
        if "CONTINUATION_AFTER_LOSSES" in found and "DISSOLUTION" in found:
            found.remove("DISSOLUTION")
        return found

    def _company_name(self, text: str) -> str | None:
        lines = compact_lines(text)
        candidates: list[tuple[str, int]] = []
        for index, line in enumerate(lines):
            cleaned = re.sub(r"\s+", " ", line).strip(" .,:;-")
            if not (2 <= len(cleaned) <= 100):
                continue
            if not re.fullmatch(r"[A-Za-zÀ-ÖØ-öø-ÿ0-9&'()./+\- ]+", cleaned):
                continue
            letters = [char for char in cleaned if char.isalpha()]
            if not letters:
                continue
            uppercase_ratio = sum(char.isupper() for char in letters) / len(letters)
            if uppercase_ratio < 0.75:
                continue
            if cleaned.upper() in GENERIC_LATIN_LINES:
                continue
            if re.fullmatch(r"\d+\s*[A-Z]", cleaned):
                continue
            candidates.append((cleaned, index))

        if candidates:
            counts = Counter(value for value, _ in candidates)

            def score(candidate: tuple[str, int]) -> tuple[int, int, int]:
                value, index = candidate
                local_score = counts[value] * 2
                if self._legal_form(lines[index]):
                    local_score += 5
                if index + 1 < len(lines) and self._legal_form(lines[index + 1]):
                    local_score += 7
                if index > 0 and self._event_types(fold_arabic(lines[index - 1])):
                    local_score += 4
                if index + 1 < len(lines) and self._event_types(fold_arabic(lines[index + 1])):
                    local_score += 3
                return (
                    local_score,
                    0 if self._legal_form_only(value) else 1,
                    len(value),
                )

            return max(
                candidates,
                key=score,
            )[0]

        for index, line in enumerate(lines):
            folded_line = fold_arabic(line)
            if "تسميه" not in folded_line:
                continue
            after_colon = line.split(":", 1)[1].strip() if ":" in line else ""
            if self._valid_arabic_name(after_colon):
                return after_colon
            if index + 1 < len(lines):
                candidate = lines[index + 1].strip(" .,:;-")
                if self._valid_arabic_name(candidate):
                    return candidate
        return None

    def _valid_arabic_name(self, value: str) -> bool:
        if not (2 <= len(value) <= 100) or not re.search(r"[\u0600-\u06ff]", value):
            return False
        folded = fold_arabic(value)
        return not any(
            term in folded
            for term in ("تسميتها", "تسميه", "مختصر", "الاقتضاء", "متبوعه")
        )

    def _legal_form_only(self, value: str) -> bool:
        compact = re.sub(r"[^A-Z]", "", value.upper())
        return compact in {"SARL", "SARLAU", "SA", "SAS"}

    def _legal_form(self, text: str) -> str | None:
        folded = fold_arabic(text)
        for pattern, label in LEGAL_FORM_RULES:
            target = text.upper() if pattern.startswith(r"\b") else folded
            if re.search(pattern, target, re.IGNORECASE | re.DOTALL):
                return label
        return None

    def _register_number(self, lines: list[str], company_name: str | None) -> str | None:
        joined = "\n".join(lines)
        explicit_patterns = (
            r"(?:رقم\s+)?(?:التقييد\s+في\s+)?السجل\s+التجاري[^\d]{0,25}(\d{2,10})",
            r"(?:registre\s+de\s+commerce|registre\s+commercial|\bRC\b)[^\d]{0,15}(\d{2,10})",
        )
        for pattern in explicit_patterns:
            match = re.search(pattern, joined, re.IGNORECASE)
            if match:
                return match.group(1)

        if not company_name:
            return None
        company_index = next(
            (index for index, line in enumerate(lines) if company_name in line), 0
        )
        date_index = next(
            (
                index
                for index, line in enumerate(lines[company_index + 1 :], company_index + 1)
                if re.search(r"20\d{2}", line)
            ),
            min(len(lines), company_index + 30),
        )
        candidates: list[str] = []
        window = lines[company_index + 1 : date_index]
        for index, line in enumerate(window):
            match = re.fullmatch(r"\D*(\d{2,10})\D*", line)
            if not match:
                continue
            context_lines = window[max(0, index - 2) : index + 1]
            context = " ".join(fold_arabic(value) for value in context_lines)
            current = fold_arabic(line)
            has_register_label = (
                current.startswith("رقم")
                or any(
                    value.startswith("رقم")
                    for value in (fold_arabic(item) for item in context_lines[:-1])
                )
                or "السجل" in context
                or "registre" in context
            )
            if not has_register_label:
                continue
            value = match.group(1)
            number = int(value)
            if 1900 <= number <= 2100 or number <= 31:
                continue
            candidates.append(value)
        return max(candidates, key=lambda value: int(value)) if candidates else None

    def _dates(self, text: str) -> list[str]:
        normalized = re.sub(r"\s*/\s*", "/", text)
        values: list[str] = []
        for raw in re.findall(r"20\d{2}/\d{1,2}/\d{1,2}", normalized):
            value = normalize_date(raw)
            if value and value not in values:
                values.append(value)
        folded = fold_arabic(text)
        month_pattern = "|".join(
            re.escape(month) for month in sorted(MONTH_NUMBERS, key=len, reverse=True)
        )
        word_date_patterns = (
            rf"\b(20\d{{2}})\s*({month_pattern})\s*([0-3]?\d)(?!\d)",
            rf"\b([0-3]?\d)\s*({month_pattern})\s*(20\d{{2}})(?!\d)",
        )
        for pattern_index, pattern in enumerate(word_date_patterns):
            for match in re.finditer(pattern, folded):
                if pattern_index == 0:
                    year, month_name, day = match.groups()
                else:
                    day, month_name, year = match.groups()
                month = MONTH_NUMBERS[month_name]
                value = normalize_date(f"{year}/{month}/{day}")
                if value and value not in values:
                    values.append(value)
        return values

    def _cities(self, folded: str) -> list[str]:
        return [
            city
            for city, patterns in CITY_PATTERNS.items()
            if any(re.search(pattern, folded, re.IGNORECASE) for pattern in patterns)
        ]

    def _field_block(
        self,
        lines: list[str],
        required_terms: tuple[str, ...],
        max_following: int,
    ) -> str | None:
        for index, line in enumerate(lines):
            folded_line = fold_arabic(line)
            if not all(term in folded_line for term in required_terms):
                continue
            values: list[str] = []
            if ":" in line:
                after_colon = line.split(":", 1)[1].strip(" -")
                if after_colon:
                    values.append(after_colon)
            for following in lines[index + 1 : index + 1 + max_following]:
                if self._looks_like_label(following):
                    break
                values.append(following)
            value = " ".join(values).strip(" .,:;-")
            return value or None
        return None

    def _looks_like_label(self, line: str) -> bool:
        folded = fold_arabic(line)
        return (
            folded.startswith("رقم")
            or any(
                term in folded
                for term in (
                    "السجل التجاري",
                    "غرض الشركه",
                    "راس مال",
                    "راسمال",
                    "بمقتضي",
                    "تم الايداع",
                    "انشاء فرع",
                    "تاسيس شركه",
                    "حل الشركه",
                    "حل شركه",
                )
            )
        )

    def _branch_address(self, lines: list[str]) -> str | None:
        event_indexes = [
            index for index, line in enumerate(lines) if "انشاء فرع" in fold_arabic(line)
        ]
        if not event_indexes:
            return None
        start = event_indexes[-1]
        start_folded = fold_arabic(lines[start])
        collecting = any(
            term in start_folded
            for term in ("كائن", "كاائن", "كاين", "العنوان التالي")
        )
        values: list[str] = []
        if collecting and ":" in lines[start]:
            suffix = lines[start].split(":", 1)[1].strip(" -")
            if suffix:
                values.append(suffix)
        for line in lines[start + 1 : start + 12]:
            folded_line = fold_arabic(line)
            if any(term in folded_line for term in ("المسير", "ولمسير", "تم الايداع")):
                break
            if not collecting and (
                "كائن" in folded_line
                or "كاائن" in folded_line
                or "كاين" in folded_line
                or "العنوان التالي" in folded_line
            ):
                collecting = True
                if ":" in line:
                    suffix = line.split(":", 1)[1].strip(" -")
                    if suffix:
                        values.append(suffix)
                continue
            if collecting:
                values.append(line)
        value = " ".join(values).strip(" .,:;-")
        return value or None

    def _manager_or_liquidator(self, lines: list[str]) -> str | None:
        for index, line in enumerate(lines):
            folded_line = fold_arabic(line)
            if not any(term in folded_line for term in ("المسير", "ولمسير", "مصفي", "مصفية")):
                continue
            value = line
            value = re.sub(
                r"^.*?(?:من\s+طرف|تعيين|بصفته|بصفتها)\s*",
                "",
                value,
                flags=re.IGNORECASE,
            )
            value = re.sub(r"السيد(?:ة)?\s*(?:\([^)]*\))?\s*", "", value)
            value = re.sub(r"^(?:وذسي|السي)\s*", "", value)
            if len(value.strip(" .,:;-")) < 3 and index + 1 < len(lines):
                value = lines[index + 1]
            value = value.strip(" .,:;-")
            folded_value = fold_arabic(value)
            if (
                re.search(r"\b\d{5}\b", value)
                or any(
                    term in folded_value
                    for term in (
                        "عنوان",
                        "شارع",
                        "تجزيه",
                        "المغرب",
                        "سطات",
                        "الدار البيضاء",
                    )
                )
            ):
                continue
            return value or None
        return None

    def _filing(self, lines: list[str], dates: list[str]) -> FilingRecord:
        court = None
        number = None
        filing_index = None
        for index, line in enumerate(lines):
            folded_line = fold_arabic(line)
            if "المحكمه" in folded_line or "محكمة" in line:
                court = line.strip(" .,:;-")
            if "ايداع" in folded_line:
                filing_index = index
        if filing_index is not None:
            tail = " ".join(lines[filing_index : filing_index + 5])
            match = re.search(r"تحت\s+رقم\s*[:\-]?\s*(\d{1,10})", tail)
            if match:
                number = match.group(1)
        return FilingRecord(
            court=court,
            date=dates[-1] if len(dates) > 1 else None,
            number=number,
        )

    def _capital(self, text: str) -> int | None:
        normalized = normalize_text(text)
        patterns = (
            r"(?:رأس\s*مال|رأسمال|راسمال)[^\d]{0,30}([\d .]{3,20})\s*(?:درهم|د\.?\s*م)",
            r"capital[^\d]{0,20}([\d .]{3,20})\s*(?:dhs?|mad)",
        )
        for pattern in patterns:
            match = re.search(pattern, normalized, re.IGNORECASE)
            if not match:
                continue
            digits = re.sub(r"\D", "", match.group(1))
            if digits:
                return int(digits)
        return None
