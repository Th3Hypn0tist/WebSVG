#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import mimetypes
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / "demo"
INPUT = DEMO / "input"


def input_inventory() -> dict:
    INPUT.mkdir(parents=True, exist_ok=True)
    files = sorted(p.name for p in INPUT.iterdir() if p.is_file())
    json_files = [name for name in files if name.lower().endswith(".json")]
    svg_files = [name for name in files if name.lower().endswith(".svg")]

    if len(json_files) != 1:
        return {
            "ok": False,
            "error": "demo/input must contain exactly one JSON manifest",
            "json_files": json_files,
            "svg_files": svg_files,
        }

    return {
        "ok": True,
        "manifest": json_files[0],
        "svg_files": svg_files,
        "files": files,
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if urlparse(self.path).path == "/demo/api/input":
            payload = json.dumps(input_inventory(), ensure_ascii=False, indent=2).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        return super().do_GET()


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the WebSVG browser demo.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    mimetypes.add_type("image/svg+xml", ".svg")
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"WebSVG demo: http://{args.host}:{args.port}/demo/")
    print(f"Input folder: {INPUT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
