'use strict';

// Integration tests for server.js: the new size/robustness validation on
// /api/sessions/:id PATCH and /api/memory/index, plus the compaction
// timeout added to summarizeWithOllama().
//
// server.js's db.js and auth.js modules each open their storage once at
// require-time, so — following the pattern in test/db.test.js and
// test/auth.test.js — this file points SESSIONS_DATA_FILE and AUTH_DB_FILE
// at isolated temp files before requiring '../server'. Since server.js only
// binds a port when run directly (require.main === module), requiring it
// here just gives us the Express `app` to start ourselves on an ephemeral
// port.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-chat-server-test-'));
process.env.SESSIONS_DATA_FILE = path.join(tmpDir, 'sessions.json');
process.env.AUTH_DB_FILE = path.join(tmpDir, 'auth.db');

const app = require('../server');

let server;
let baseUrl;
let sessionCookie;
let sessionId;

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'servertestuser', password: 'password123' }),
  });
  assert.equal(signupRes.status, 201);
  const setCookie = signupRes.headers.get('set-cookie');
  assert.ok(setCookie, 'signup must set a session cookie');
  sessionCookie = setCookie.split(';')[0];

  const sessionRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: JSON.stringify({ title: 'Test session' }),
  });
  assert.equal(sessionRes.status, 201);
  const session = await sessionRes.json();
  sessionId = session.id;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function patchSession(body) {
  return fetch(`${baseUrl}/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: JSON.stringify(body),
  });
}

test('PATCH /api/sessions/:id rejects a "messages" array over MAX_SESSION_MESSAGES', async () => {
  const messages = Array.from({ length: 1001 }, () => ({ role: 'user', content: 'hi' }));
  const res = await patchSession({ messages });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /messages.*1000/i);
});

test('PATCH /api/sessions/:id rejects an "appendMessages" array over MAX_SESSION_MESSAGES', async () => {
  const appendMessages = Array.from({ length: 1001 }, () => ({ role: 'user', content: 'hi' }));
  const res = await patchSession({ appendMessages });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /appendMessages.*1000/i);
});

test('PATCH /api/sessions/:id rejects a message whose content exceeds MAX_MESSAGE_CONTENT_CHARS', async () => {
  const res = await patchSession({ messages: [{ role: 'user', content: 'x'.repeat(1000001) }] });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /content.*1000000/i);
});

test('PATCH /api/sessions/:id rejects a "title" over MAX_SESSION_TITLE_CHARS', async () => {
  const res = await patchSession({ title: 'x'.repeat(201) });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /title.*200/i);
});

test('PATCH /api/sessions/:id still reports shape errors before size errors', async () => {
  // A single malformed item in an otherwise-oversized array should still
  // surface the shape-validation message, not a size message.
  const messages = [{ role: 'user' }]; // missing "content"
  const res = await patchSession({ messages });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /role.*content/i);
});

test('PATCH /api/sessions/:id accepts a well-formed, within-limits update', async () => {
  const res = await patchSession({ title: 'Renamed', messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.title, 'Renamed');
});

test('POST /api/memory/index rejects a batch over MAX_MEMORY_BATCH', async () => {
  const items = Array.from({ length: 101 }, (_, i) => ({ text: `message ${i}` }));
  const res = await fetch(`${baseUrl}/api/memory/index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: JSON.stringify(items),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /batch.*100/i);
});

test('POST /api/memory/index rejects an item whose text exceeds MAX_MEMORY_TEXT_CHARS', async () => {
  const res = await fetch(`${baseUrl}/api/memory/index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: JSON.stringify({ text: 'x'.repeat(100001) }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /text.*100000/i);
});

test('POST /api/memory/index still reports missing-text errors before size errors', async () => {
  const res = await fetch(`${baseUrl}/api/memory/index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: JSON.stringify([{ text: 'ok' }, { foo: 'bar' }]),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /non-empty "text"/i);
});

test('summarizeWithOllama() surfaces a clear message when the request times out', async (t) => {
  // COMPACTION_TIMEOUT_MS is read into a module-level constant at require
  // time (so a real hung request can't stall the streaming /api/chat call
  // indefinitely); that means its value can't be changed from a test after
  // the fact. Instead of waiting out a real (30s default) timeout, mock
  // global fetch to reject the same way a real fetch does when its
  // AbortSignal.timeout() fires — a DOMException-like error named
  // "TimeoutError" — and assert summarizeWithOllama() turns that into its
  // clear, chat-safe error message (which compactMessages() then catches
  // and fails open on).
  t.mock.method(globalThis, 'fetch', (_url, opts) => {
    assert.ok(opts && opts.signal, 'summarizeWithOllama must pass an abort signal to fetch');
    const err = new Error('The operation was aborted due to timeout');
    err.name = 'TimeoutError';
    return Promise.reject(err);
  });

  try {
    await assert.rejects(
      () => app.summarizeWithOllama([{ role: 'user', content: 'hi' }], 'llama3'),
      (err) => {
        assert.match(err.message, /timed out after \d+ms/i);
        return true;
      }
    );
  } finally {
    t.mock.restoreAll();
  }
});

// --- rate limiting (pull / model delete / memory index) -----------------
//
// The fixed-window limiters are shared process-wide state, so these tests
// send requests until one comes back 429 rather than assuming a fresh
// budget (earlier tests in this file already consume some of it).

// Sends requests via `fn` until one returns 429, then sends one more and
// asserts it is also 429 and carries a Retry-After header.
async function exhaustRateLimit(fn) {
  let saw429 = false;
  for (let i = 0; i < 60 && !saw429; i += 1) {
    const res = await fn();
    if (res.status === 429) saw429 = true;
  }
  assert.ok(saw429, 'expected a 429 response once the limit was exceeded');
  const res = await fn();
  assert.equal(res.status, 429);
  const retryAfter = res.headers.get('retry-after');
  assert.ok(retryAfter, '429 must carry a Retry-After header');
  assert.ok(Number(retryAfter) > 0);
}

test('POST /api/pull is rate-limited per IP', async () => {
  // Empty model names are rejected with a 400 before any upstream fetch,
  // but still count against the limiter — so this exercises the limit
  // without ever contacting Ollama.
  await exhaustRateLimit(() =>
    fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({ name: '' }),
    })
  );
});

test('DELETE /api/models/:name is rate-limited per IP', async (t) => {
  // The delete route has no body validation, so its handler would fetch
  // the real OLLAMA_HOST — intercept only those upstream calls, letting
  // the test's own requests to the app go through to the real fetch.
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, opts) => {
    if (String(url).startsWith(baseUrl)) return realFetch(url, opts);
    return Promise.resolve({
      status: 503,
      ok: false,
      async text() {
        return 'mock down';
      },
    });
  });

  await exhaustRateLimit(() =>
    fetch(`${baseUrl}/api/models/some-model`, {
      method: 'DELETE',
      headers: { Cookie: sessionCookie },
    })
  );
});

test('POST /api/memory/index is rate-limited per IP', async () => {
  // Empty-text items are rejected with a 400 before any embed/upsert, but
  // still count against the limiter.
  await exhaustRateLimit(() =>
    fetch(`${baseUrl}/api/memory/index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({ text: '' }),
    })
  );
});
