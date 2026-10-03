'use strict';

// Tests for metrics.js — the in-memory /api/metrics tracker. The module is
// a singleton with module-level state, so each test records under its own
// unique route keys instead of assuming a fresh counter.

const test = require('node:test');
const assert = require('node:assert/strict');
const metrics = require('../metrics');

test('record() aggregates per-route counts, status counts, and latency stats', () => {
  const key = { route: '/api/test-aggregate', method: 'GET' };

  metrics.record({ ...key, status: 200, durationMs: 100 });
  metrics.record({ ...key, status: 200, durationMs: 200 });
  metrics.record({ ...key, status: 404, durationMs: 300 });

  const snap = metrics.snapshot();
  const route = snap.routes['GET /api/test-aggregate'];

  assert.ok(route, 'the route key must appear in the snapshot');
  assert.equal(route.count, 3);
  assert.deepEqual(route.statusCounts, { 200: 2, 404: 1 });
  assert.equal(route.minMs, 100);
  assert.equal(route.maxMs, 300);
  assert.equal(route.avgMs, 200);
});

test('snapshot() exposes totalRequests, uptimeSeconds, and memoryUsage', () => {
  const before = metrics.snapshot().totalRequests;
  metrics.record({ route: '/api/test-totals', method: 'GET', status: 200, durationMs: 1 });
  const snap = metrics.snapshot();

  assert.equal(snap.totalRequests, before + 1);
  assert.ok(Number.isFinite(snap.uptimeSeconds) && snap.uptimeSeconds >= 0);
  assert.ok(snap.memoryUsage && typeof snap.memoryUsage.heapUsed === 'number');
});

test('upstreamErrorCount counts only 503 responses', () => {
  const before = metrics.snapshot().upstreamErrorCount;
  metrics.record({ route: '/api/test-503', method: 'GET', status: 503, durationMs: 1 });
  metrics.record({ route: '/api/test-503', method: 'GET', status: 500, durationMs: 1 });
  metrics.record({ route: '/api/test-503', method: 'GET', status: 503, durationMs: 1 });

  assert.equal(metrics.snapshot().upstreamErrorCount, before + 2);
});

test('latency values are rounded to two decimals in the snapshot', () => {
  metrics.record({ route: '/api/test-rounding', method: 'GET', status: 200, durationMs: 1.23456 });
  metrics.record({ route: '/api/test-rounding', method: 'GET', status: 200, durationMs: 2.34567 });

  const route = metrics.snapshot().routes['GET /api/test-rounding'];
  // (1.23456 + 2.34567) / 2 = 1.790115 → 1.79
  assert.equal(route.avgMs, 1.79);
  assert.equal(route.minMs, 1.23);
  assert.equal(route.maxMs, 2.35);
});
