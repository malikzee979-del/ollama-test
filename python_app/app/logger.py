"""Tiny leveled logger. Port of logger.js.

No external dependency — structured, timestamped, single-line entries to
stdout/stderr. Deliberately dumb: just enough structure to grep/parse logs.
"""
import json
import sys
from datetime import datetime, timezone


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _format(level: str, args) -> str:
    parts = []
    for a in args:
        parts.append(a if isinstance(a, str) else json.dumps(a, default=str))
    return f"[{_timestamp()}] {level} {' '.join(parts)}"


def info(*args) -> None:
    print(_format("INFO", args), file=sys.stdout)


def warn(*args) -> None:
    print(_format("WARN", args), file=sys.stderr)


def error(*args) -> None:
    print(_format("ERROR", args), file=sys.stderr)
