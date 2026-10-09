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

// --- security hardening --------------------------------------------------

test('a malformed percent-encoded cookie does not crash the request', async () => {
  // `sid=%` used to throw URIError inside parseCookies() and 500 every
  // request carrying it; the malformed pair must be skipped instead.
  const res = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: 'sid=%; broken=%zz' },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { user: null });
});

test('POST /api/chat rejects a messages array with malformed items', async () => {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: JSON.stringify({ model: 'llama3', messages: [{ role: 'user' }] }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /role.*content/i);
});

test('POST /api/chat rejects non-object message items', async () => {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: JSON.stringify({ model: 'llama3', messages: ['hello'] }),
  });
  assert.equal(res.status, 400);
});

test('rateLimiter evicts a key once its window is empty', () => {
  // app.rateLimiterForTests is a test-only export of the factory; the
  // middleware instance carries its hits Map so eviction can be asserted
  // without waiting out a real window. The triggering request comes from a
  // different IP than the seeded stale key — a request from the same IP
  // would legitimately refresh the key.
  const limiter = app.rateLimiterForTests({ windowMs: 50, max: 2 });
  const now = Date.now();
  limiter.hits.set('dormant-ip', [now - 60_000]); // all timestamps out of window
  let called = false;
  limiter({ ip: 'fresh-ip' }, {}, () => {
    called = true;
  });
  assert.ok(called, 'a fresh ip must not be limited');
  assert.ok(!limiter.hits.has('dormant-ip'), 'the dormant key must be swept from the map');
  assert.ok(limiter.hits.has('fresh-ip'), 'the fresh ip must be recorded');
});

test('requests with a disallowed Host header are rejected', async () => {
  // The Host header can't be overridden through fetch/undici, so use
  // node:http directly.
  const { request } = require('node:http');
  const port = server.address().port;
  const status = await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/auth/me', headers: { Host: 'evil.example' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
});

// --- chat search ------------------------------------------------------------

test('GET /api/sessions/search finds sessions by title and content, per user', async () => {
  // The before() hook already created "Test session" (later renamed
  // "Renamed" by the PATCH test) and appended "hello" as a message.
  const titleRes = await fetch(`${baseUrl}/api/sessions/search?q=renamed`, {
    headers: { Cookie: sessionCookie },
  });
  assert.equal(titleRes.status, 200);
  const titleBody = await titleRes.json();
  assert.ok(titleBody.sessions.some((s) => s.id === sessionId), 'title match must include the session');
  assert.equal('messages' in titleBody.sessions[0], false, 'summaries only, no messages');

  const contentRes = await fetch(`${baseUrl}/api/sessions/search?q=HELLO`, {
    headers: { Cookie: sessionCookie },
  });
  assert.equal(contentRes.status, 200);
  const contentBody = await contentRes.json();
  assert.ok(contentBody.sessions.some((s) => s.id === sessionId), 'content match must be case-insensitive');
});

test('GET /api/sessions/search rejects a missing query and yields nothing for other users', async () => {
  const missing = await fetch(`${baseUrl}/api/sessions/search`, { headers: { Cookie: sessionCookie } });
  assert.equal(missing.status, 400);

  const nomatch = await fetch(`${baseUrl}/api/sessions/search?q=zzz-no-such-content`, {
    headers: { Cookie: sessionCookie },
  });
  assert.equal(nomatch.status, 200);
  assert.deepEqual(await nomatch.json(), { sessions: [] });

  // "search" must never be treated as a session id by /api/sessions/:id.
  const asId = await fetch(`${baseUrl}/api/sessions/search`, { headers: { Cookie: sessionCookie } });
  assert.equal(asId.status, 400);
});

// --- GET /api/metrics (server-level) -----------------------------------------
//
// metrics.test.js covers the aggregation math in isolation; this asserts the
// actual HTTP surface: auth-gated, and the JSON shape matches what the
// frontend (and any local Dashboard consumer) expects.

test('GET /api/metrics requires a session', async () => {
  const anon = await fetch(`${baseUrl}/api/metrics`);
  assert.equal(anon.status, 401);
  assert.deepEqual(await anon.json(), { error: 'Authentication required.' });
});

test('GET /api/metrics returns the documented snapshot shape for a logged-in user', async () => {
  const res = await fetch(`${baseUrl}/api/metrics`, { headers: { Cookie: sessionCookie } });
  assert.equal(res.status, 200);
  const body = await res.json();
  for (const key of ['totalRequests', 'upstreamErrorCount', 'uptimeSeconds', 'memoryUsage', 'routes']) {
    assert.ok(key in body, `snapshot must include ${key}`);
  }
  // The middleware records a request when its response finishes, so a
  // response's own snapshot never contains its own hit — but the anonymous
  // 401 probe in the previous test already registered the route key.
  assert.ok('GET /api/metrics' in body.routes, 'the metrics route itself must appear in the route table');
  const entry = body.routes['GET /api/metrics'];
  assert.ok(entry.count >= 1);
  assert.ok(entry.statusCounts['401'] >= 1, 'the unauthenticated probe must be counted with its real status');
  assert.equal(entry.count, Object.values(entry.statusCounts).reduce((a, b) => a + b, 0), 'statusCounts must partition the count');
  for (const l of ['avgMs', 'minMs', 'maxMs']) assert.ok(typeof entry[l] === 'number');
});

// --- GET /api/export (data export, TODO 5.3) ---------------------------------

test('GET /api/export requires a session', async () => {
  const anon = await fetch(`${baseUrl}/api/export`);
  assert.equal(anon.status, 401);
});

test('GET /api/export downloads the signed-in user\'s full sessions as JSON', async () => {
  const res = await fetch(`${baseUrl}/api/export`, { headers: { Cookie: sessionCookie } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  assert.match(res.headers.get('content-disposition') || '', /attachment; filename="ollama-chat-export-\d{4}-\d{2}-\d{2}\.json"/);

  const body = await res.json();
  assert.equal(body.app, 'ollama-chat');
  assert.ok(typeof body.exportedAt === 'string');
  assert.ok(Array.isArray(body.sessions));
  const own = body.sessions.find((s) => s.id === sessionId);
  assert.ok(own, 'the export must include this user\'s session');
  assert.ok(Array.isArray(own.messages), 'export carries full messages, unlike the sidebar summaries');
});
