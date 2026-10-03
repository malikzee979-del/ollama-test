'use strict';

// Tests for logger.js — the tiny leveled logger. Output is captured by
// mocking the console methods (node:test's built-in t.mock, no mocking
// dependency) and asserting the single-line "[ISO timestamp] LEVEL message"
// shape the module documents.

const test = require('node:test');
const assert = require('node:assert/strict');
const logger = require('../logger');

test('info() writes a single-line, timestamped INFO entry to stdout', (t) => {
  const calls = t.mock.method(console, 'log', () => {});
  logger.info('hello', 'world');
  t.mock.restoreAll();

  assert.equal(calls.mock.callCount(), 1);
  const line = calls.mock.calls[0].arguments[0];
  assert.match(line, /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] INFO hello world$/);
});

test('warn() and error() use their respective levels and streams', (t) => {
  const warnCalls = t.mock.method(console, 'warn', () => {});
  const errorCalls = t.mock.method(console, 'error', () => {});

  logger.warn('careful');
  logger.error('boom');
  t.mock.restoreAll();

  assert.match(warnCalls.mock.calls[0].arguments[0], / WARN careful$/);
  assert.match(errorCalls.mock.calls[0].arguments[0], / ERROR boom$/);
});

test('non-string arguments are JSON.stringify-ed, not stringified via toString', (t) => {
  const calls = t.mock.method(console, 'log', () => {});
  logger.info({ req: 'POST /api/chat', ms: 12.5 });
  t.mock.restoreAll();

  const line = calls.mock.calls[0].arguments[0];
  // `[object Object]` would make the entry unparsable; the module promises
  // JSON for anything non-string.
  assert.match(line, /INFO \{"req":"POST \/api\/chat","ms":12\.5\}$/);
  assert.doesNotMatch(line, /\[object Object\]/);
});

test('multiple arguments are joined with single spaces', (t) => {
  const calls = t.mock.method(console, 'log', () => {});
  logger.info('GET', '/api/health', 200, { ok: true });
  t.mock.restoreAll();

  const line = calls.mock.calls[0].arguments[0];
  assert.match(line, /INFO GET \/api\/health 200 \{"ok":true\}$/);
});
