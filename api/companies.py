from __future__ import annotations

import json
from functools import lru_cache
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit


DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "BOAL_5922_all.json"
MAX_PAGE_SIZE = 500


@lru_cache(maxsize=1)
def load_dataset() -> dict[str, Any]:
    with DATA_PATH.open(encoding="utf-8") as stream:
        return json.load(stream)


def filter_records(
    records: list[dict[str, Any]],
    parameters: dict[str, list[str]],
) -> tuple[list[dict[str, Any]], int, int]:
    event = _first(parameters, "event")
    company = _first(parameters, "company")
    city = _first(parameters, "city")
    query = _first(parameters, "q")
    review = _parse_bool(_first(parameters, "needs_review"))
    min_confidence = _parse_float(_first(parameters, "min_confidence"), default=0.0)
    limit = min(
        MAX_PAGE_SIZE,
        max(1, _parse_int(_first(parameters, "limit"), default=100)),
    )
    offset = max(0, _parse_int(_first(parameters, "offset"), default=0))

    filtered: list[dict[str, Any]] = []
    for record in records:
        record_company = record["company"]
        record_event = record["event"]
        if event and event.casefold() not in {
            value.casefold() for value in record_event["types"]
        }:
            continue
        if company and company.casefold() not in (record_company["name"] or "").casefold():
            continue
        if city and city.casefold() not in {
            value.casefold() for value in record_company.get("cities_mentioned", [])
        }:
            continue
        if review is not None and record["needs_review"] is not review:
            continue
        if record["confidence"] < min_confidence:
            continue
        if query and query.casefold() not in _searchable_text(record).casefold():
            continue
        filtered.append(record)

    return filtered[offset : offset + limit], len(filtered), offset


def _searchable_text(record: dict[str, Any]) -> str:
    company = record["company"]
    event = record["event"]
    values = [
        company["name"],
        company["commercial_register_number"],
        company["registered_address"],
        event["primary_type"],
        event["business_purpose"],
        event["branch_address"],
        event["manager_or_liquidator"],
    ]
    return " ".join(str(value) for value in values if value)


def _first(parameters: dict[str, list[str]], key: str) -> str | None:
    values = parameters.get(key)
    return values[0].strip() if values and values[0].strip() else None


def _parse_bool(value: str | None) -> bool | None:
    if value is None:
        return None
    lowered = value.casefold()
    if lowered in {"true", "1", "yes"}:
        return True
    if lowered in {"false", "0", "no"}:
        return False
    raise ValueError("needs_review must be true or false")


def _parse_float(value: str | None, default: float) -> float:
    parsed = float(value) if value is not None else default
    if not 0 <= parsed <= 1:
        raise ValueError("min_confidence must be between 0 and 1")
    return parsed


def _parse_int(value: str | None, default: int) -> int:
    return int(value) if value is not None else default


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        try:
            parameters = parse_qs(urlsplit(self.path).query)
            dataset = load_dataset()
            records, total, offset = filter_records(dataset["records"], parameters)
            payload = {
                "schema_version": dataset["schema_version"],
                "dataset": dataset["summary"],
                "pagination": {
                    "total": total,
                    "offset": offset,
                    "returned": len(records),
                },
                "records": records,
            }
            self._send_json(200, payload, cache=True)
        except (TypeError, ValueError) as error:
            self._send_json(400, {"error": str(error)})
        except (OSError, json.JSONDecodeError):
            self._send_json(500, {"error": "Gazette dataset is unavailable"})

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _send_json(
        self,
        status: int,
        payload: dict[str, Any],
        cache: bool = False,
    ) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        if cache:
            self.send_header(
                "Cache-Control",
                "public, s-maxage=300, stale-while-revalidate=86400",
            )
        else:
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)
