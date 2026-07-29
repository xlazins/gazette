from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler


SERVICE_INFO = {
    "service": "Morocco BOAL Gazette Extractor",
    "status": "ok",
    "schema_version": "1.0.0",
    "endpoints": {
        "companies": "/api/companies",
        "companies_query": (
            "/api/companies?event=DISSOLUTION&company=SAFRES&"
            "min_confidence=0.8&limit=100&offset=0"
        ),
    },
}


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        body = json.dumps(SERVICE_INFO, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=300")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
