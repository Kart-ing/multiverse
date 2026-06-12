"""Tiny control endpoint for PRD B/C integration."""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .benchmark import make_orchestrator
from .orchestrator import Orchestrator


class ControlServer:
    def __init__(self, orchestrator: Orchestrator) -> None:
        self.orchestrator = orchestrator

    def handler(self) -> type[BaseHTTPRequestHandler]:
        orchestrator = self.orchestrator

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                if self.path == "/tasks":
                    self._json(
                        [
                            {"task_id": task.task_id, "title": task.title, "prompt": task.prompt}
                            for task in orchestrator.tasks.values()
                        ]
                    )
                    return
                self.send_error(404)

            def do_POST(self) -> None:
                payload = self._read_json()
                if self.path == "/run":
                    task_id = payload["task_id"]
                    result = orchestrator.run(task_id, speculation=payload.get("speculation", True))
                    self._json({"run_id": result["run_id"]})
                    return
                if self.path == "/fork_at":
                    children = orchestrator.fork_at(payload["branch_id"], int(payload["step_idx"]), n=int(payload.get("n", 2)))
                    self._json({"children": children})
                    return
                self.send_error(404)

            def log_message(self, fmt: str, *args: Any) -> None:
                return

            def _read_json(self) -> dict[str, Any]:
                length = int(self.headers.get("content-length", "0"))
                if length == 0:
                    return {}
                return json.loads(self.rfile.read(length).decode("utf-8"))

            def _json(self, payload: Any) -> None:
                encoded = json.dumps(payload, sort_keys=True).encode("utf-8")
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

        return Handler


def serve(host: str = "127.0.0.1", port: int = 8787, base_dir: str | Path = ".multiverse-control") -> None:
    orchestrator = make_orchestrator(Path(base_dir), run_id="run_control")
    httpd = ThreadingHTTPServer((host, port), ControlServer(orchestrator).handler())
    print(f"control server listening on http://{host}:{port}")
    httpd.serve_forever()


if __name__ == "__main__":
    serve()

