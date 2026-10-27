"""Tiny leveled logger. No external dependency — just structured,
timestamped, single-line entries to stdout/stderr. Deliberately dumb:
this project's philosophy is "thin proxy, minimal deps", so this isn't
trying to be loguru/structlog, just enough structure to grep/parse logs.
"""

import json
import sys
from datetime import datetime, timezone


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _format(level: str, *args) -> str:
    message = " ".join(
        a if isinstance(a, str) else json.dumps(a) for a in args
    )
    return f"[{_timestamp()}] {level} {message}"


def info(*args) -> None:
    print(_format("INFO", *args), flush=True)


def warn(*args) -> None:
    print(_format("WARN", *args), file=sys.stderr, flush=True)


def error(*args) -> None:
    print(_format("ERROR", *args), file=sys.stderr, flush=True)
