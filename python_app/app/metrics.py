"""In-memory metrics tracker. Port of metrics.js.

No external dependency, no persistence — counters/latencies reset on
process restart, which is fine for a small local proxy.
"""
import time
from typing import Dict

_started_at = time.time()

# key "METHOD route" -> { count, statusCounts: {status: count} }
_route_stats: Dict[str, dict] = {}
# key "METHOD route" -> { count, totalMs, minMs, maxMs }
_latency_stats: Dict[str, dict] = {}

_total_requests = 0
_upstream_error_count = 0  # responses with status 503


def record(route: str, method: str, status: int, duration_ms: float) -> None:
    global _total_requests, _upstream_error_count
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
    routes = {}
    for key, rs in _route_stats.items():
        ls = _latency_stats.get(key, {"count": 0, "totalMs": 0.0, "minMs": 0.0, "maxMs": 0.0})
        routes[key] = {
            "count": rs["count"],
            "statusCounts": rs["statusCounts"],
            "avgMs": round(ls["totalMs"] / ls["count"], 2) if ls["count"] else 0,
            "minMs": round(ls["minMs"], 2) if ls["count"] else 0,
            "maxMs": round(ls["maxMs"], 2) if ls["count"] else 0,
        }

    return {
        "totalRequests": _total_requests,
        "upstreamErrorCount": _upstream_error_count,
        "uptimeSeconds": round(time.time() - _started_at, 1),
        "routes": routes,
    }
