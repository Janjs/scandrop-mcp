from __future__ import annotations

import argparse
import sys
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main() -> None:
    parser = argparse.ArgumentParser(description="Run scandrop FastAPI debug server.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")
    args = parser.parse_args()

    uvicorn.run("scandrop.api:app", host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
