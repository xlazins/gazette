from __future__ import annotations

import re
import unicodedata


ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
ARABIC_DIACRITICS_RE = re.compile(r"[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]")


def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).translate(ARABIC_DIGITS)
    text = text.replace("\u00a0", " ").replace("\u200f", "").replace("\u200e", "")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return text.strip()


def fold_arabic(text: str) -> str:
    text = normalize_text(text)
    text = ARABIC_DIACRITICS_RE.sub("", text).replace("ـ", "")
    text = re.sub("[إأآٱ]", "ا", text)
    text = text.replace("ى", "ي").replace("ؤ", "و").replace("ئ", "ي")
    text = text.replace("ة", "ه")
    return re.sub(r"\s+", " ", text).strip().lower()


def normalize_date(value: str) -> str | None:
    value = re.sub(r"\s*/\s*", "/", value.translate(ARABIC_DIGITS))
    match = re.fullmatch(r"(20\d{2})/(\d{1,2})/(\d{1,2})", value)
    if not match:
        return None
    year, month, day = (int(part) for part in match.groups())
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


def compact_lines(text: str) -> list[str]:
    return [line.strip() for line in normalize_text(text).splitlines() if line.strip()]
