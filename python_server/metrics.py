"""In-memory metrics tracker. No external dependency, no persistence —
counters/latencies reset whenever the process restarts, which is fine for
a small local proxy that just wants a quick /api/metrics snapshot.
"""

import os
import time
from threading import Lock

_started_at = time.time()

_lock = Lock()

# Keyed by "METHOD route" -> { count, statusCounts: { status: count } }
_route_stats: dict = {}

# Keyed by "METHOD route" -> { count, totalMs, minMs, maxMs }
_latency_stats: dict = {}

_total_requests = 0
_upstream_error_count = 0  # responses with status 503 (Ollama unreachable/errored)


def record(*, route: str, method: str, status: int, duration_ms: float) -> None:
    global _total_requests, _upstream_error_count
    with _lock:
        _total_requests += 1
        if status == 503:
            _upstream_error_count += 1

        key = f"{method} {route}"

        rs = _route_stats.setdefault(key, {"count": 0, "statusCounts": {}})
        rs["count"] += 1
        rs["statusCounts"][str(status)] = rs["statusCounts"].get(str(status), 0) + 1

        ls = _latency_stats.setdefault(
            key, {"count": 0, "totalMs": 0.0, "minMs": float("inf"), "maxMs": 0.0}
        )
        ls["count"] += 1
        ls["totalMs"] += duration_ms
        ls["minMs"] = min(ls["minMs"], duration_ms)
        ls["maxMs"] = max(ls["maxMs"], duration_ms)


def snapshot() -> dict:
    with _lock:
        routes = {}
        for key, rs in _route_stats.items():
            ls = _latency_stats.get(key) or {"count": 0, "totalMs": 0.0, "minMs": 0.0, "maxMs": 0.0}
            count = ls["count"]
            routes[key] = {
                "count": rs["count"],
                "statusCounts": rs["statusCounts"],
                "avgMs": round(ls["totalMs"] / count, 2) if count else 0,
                "minMs": round(ls["minMs"], 2) if count else 0,
                "maxMs": round(ls["maxMs"], 2) if count else 0,
            }

        return {
            "totalRequests": _total_requests,
            "upstreamErrorCount": _upstream_error_count,
            "uptimeSeconds": round(time.time() - _started_at, 1),
            "memoryUsage": {
                # Closest analogue of Node's process.memoryUsage().
                "rss": _rss_bytes(),
            },
            "routes": routes,
        }


def _rss_bytes() -> int:
    try:
        # Same source of truth /proc/<pid>/status gives, without psutil.
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) * 1024
    except OSError:
        pass
    try:
        import resource

        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
    except Exception:
        return 0
