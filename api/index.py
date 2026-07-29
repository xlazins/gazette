from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler
from typing import Any
from urllib.parse import parse_qs, urlsplit

from api.companies import filter_records, load_dataset


SERVICE_INFO = {
    "service": "Morocco BOAL Gazette Extractor",
    "status": "ok",
    "schema_version": "1.0.0",
    "endpoints": {
        "companies": "/api/companies",
        "companies_query": (
            "/api/companies?city=Settat&event=DISSOLUTION&company=SAFRES&"
            "min_confidence=0.8&limit=100&offset=0"
        ),
    },
}


def route_request(request_path: str) -> tuple[int, dict[str, Any], bool]:
    parsed = urlsplit(request_path)
    path = parsed.path.rstrip("/") or "/"
    if path in {"/", "/api"}:
        return 200, SERVICE_INFO, True
    if path == "/api/companies":
        dataset = load_dataset()
        records, total, offset = filter_records(
            dataset["records"],
            parse_qs(parsed.query),
        )
        return (
            200,
            {
                "schema_version": dataset["schema_version"],
                "dataset": dataset["summary"],
                "pagination": {
                    "total": total,
                    "offset": offset,
                    "returned": len(records),
                },
                "records": records,
            },
            True,
        )
    return 404, {"error": "Endpoint not found"}, False


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        try:
            status, payload, cache = route_request(self.path)
        except (TypeError, ValueError) as error:
            status, payload, cache = 400, {"error": str(error)}, False
        except (OSError, json.JSONDecodeError):
            status, payload, cache = (
                500,
                {"error": "Gazette dataset is unavailable"},
                False,
            )

        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header(
            "Cache-Control",
            (
                "public, s-maxage=300, stale-while-revalidate=86400"
                if cache
                else "no-store"
            ),
        )
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
