"""Simple in-memory fixed-window rate limiter, keyed by client IP.

Port of the rateLimiter() factory in server.js. Only guards the auth
endpoints; resets on restart, which is fine for its purpose.
"""
import time
from typing import Dict, List


class RateLimitExceeded(Exception):
    def __init__(self, retry_after_sec: int):
        super().__init__("Too many attempts. Please wait and try again.")
        self.retry_after_sec = retry_after_sec


class RateLimiter:
    def __init__(self, window_ms: int, max_hits: int):
        self.window_ms = window_ms
        self.max_hits = max_hits
        self._hits: Dict[str, List[float]] = {}

    def check(self, ip: str) -> None:
        now = time.time() * 1000
        timestamps = [t for t in self._hits.get(ip, []) if now - t < self.window_ms]
        if len(timestamps) >= self.max_hits:
            retry_after_sec = int((self.window_ms - (now - timestamps[0])) / 1000) + 1
            raise RateLimitExceeded(retry_after_sec)
        timestamps.append(now)
        self._hits[ip] = timestamps


auth_rate_limiter = RateLimiter(window_ms=5 * 60 * 1000, max_hits=10)
