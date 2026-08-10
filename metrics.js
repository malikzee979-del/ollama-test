// In-memory metrics tracker. No external dependency, no persistence —
// counters/latencies reset whenever the process restarts, which is fine for
// a small local proxy that just wants a quick /api/metrics snapshot.

const startedAt = Date.now();

// Keyed by "METHOD route" -> { count, statusCounts: { [status]: count } }
const routeStats = new Map();

// Keyed by "METHOD route" -> { count, totalMs, minMs, maxMs }
const latencyStats = new Map();

let totalRequests = 0;
let upstreamErrorCount = 0; // responses with status 503 (Ollama unreachable/errored)

function record({ route, method, status, durationMs }) {
  totalRequests += 1;
  if (status === 503) upstreamErrorCount += 1;

  const key = `${method} ${route}`;

  const rs = routeStats.get(key) || { count: 0, statusCounts: {} };
  rs.count += 1;
  rs.statusCounts[status] = (rs.statusCounts[status] || 0) + 1;
  routeStats.set(key, rs);

  const ls = latencyStats.get(key) || { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0 };
  ls.count += 1;
  ls.totalMs += durationMs;
  ls.minMs = Math.min(ls.minMs, durationMs);
  ls.maxMs = Math.max(ls.maxMs, durationMs);
  latencyStats.set(key, ls);
}

function snapshot() {
  const routes = {};
  for (const [key, rs] of routeStats.entries()) {
    const ls = latencyStats.get(key) || { count: 0, totalMs: 0, minMs: 0, maxMs: 0 };
    routes[key] = {
      count: rs.count,
      statusCounts: rs.statusCounts,
      avgMs: ls.count ? Number((ls.totalMs / ls.count).toFixed(2)) : 0,
      minMs: ls.count ? Number(ls.minMs.toFixed(2)) : 0,
      maxMs: ls.count ? Number(ls.maxMs.toFixed(2)) : 0,
    };
  }

  return {
    totalRequests,
    upstreamErrorCount,
    uptimeSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
    memoryUsage: process.memoryUsage(),
    routes,
  };
}

module.exports = { record, snapshot };
