'use strict';

// Integration tests for server.js's streaming proxy routes — /api/chat,
// /api/pull — and DELETE /api/models/:name, run against a fake Ollama
// implemented with node:http so no real Ollama instance is ever contacted.
//
// server.js reads OLLAMA_HOST once at require time, so the fake is started
// first, OLLAMA_HOST is pointed at it, and only then is ../server required.
// This is safe because node --test runs each test file in its own process,
// so the override can't leak into other suites. SESSIONS_DATA_FILE and
// AUTH_DB_FILE are pointed at temp files before requiring too, following
// the pattern in test/server.test.js (db.js/auth.js open their storage at
// require time).

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const qdrant = require('../qdrant');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-chat-stream-test-'));
process.env.SESSIONS_DATA_FILE = path.join(tmpDir, 'sessions.json');
process.env.AUTH_DB_FILE = path.join(tmpDir, 'auth.db');

// --- fake Ollama --------------------------------------------------------
//
// Mimics the ndjson streaming shape of Ollama's /api/chat and /api/pull,
// plus the non-streaming DELETE /api/delete. Every incoming request is
// recorded (with its parsed JSON body) so tests can assert what the proxy
// forwarded. `holdNextChat` makes the next /api/chat response write exactly
// one chunk and then stay open forever, which is what the
// abort-on-disconnect test needs to observe the proxy tearing the upstream
// request down.

function createFakeOllama() {
  const state = {
    holdNextChat: false,
    chatRequests: [], // { body, closed }
    summarizeRequests: [], // { body } — non-streaming /api/chat calls
    embedRequests: [], // { body } — /api/embed calls (memory retrieval)
    pullRequests: [], // { body }
    deleteRequests: [], // { name }
  };

  const server = http.createServer(async (req, res) => {
    const rawChunks = [];
    for await (const chunk of req) rawChunks.push(chunk);
    const raw = Buffer.concat(rawChunks).toString('utf8');
    const body = raw ? JSON.parse(raw) : null;

    if (req.url === '/api/chat' && body && body.stream === false) {
      // A non-streaming /api/chat call is only ever the compaction
      // summarizer (server.js summarizeWithOllama), which expects a single
      // JSON body rather than the ndjson stream below.
      state.summarizeRequests.push({ body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: { role: 'assistant', content: 'a summary of earlier turns' } }));
      return;
    }

    if (req.url === '/api/chat') {
      let resolveClosed;
      const closed = new Promise((resolve) => {
        resolveClosed = resolve;
      });
      // The upstream connection being torn down shows up as 'close' on the
      // response; the request's 'close' is also wired defensively (which
      // event fires first varies by Node version/termination path).
      req.on('close', resolveClosed);
      res.on('close', resolveClosed);
      state.chatRequests.push({ body, closed });

      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      const line = (content, done) =>
        `${JSON.stringify({ model: body.model, message: { role: 'assistant', content }, done })}\n`;
      res.write(line('chunk-one', false));
      if (state.holdNextChat) {
        // Keep the response open without ending; the test aborts its
        // client fetch and then awaits `closed`.
        state.holdNextChat = false;
        return;
      }
      res.write(line('chunk-two', true));
      res.end();
      return;
    }

    if (req.url === '/api/embed') {
      // The embeddings endpoint used by semantic-memory retrieval. A fixed
      // 768-dim vector (EMBEDDING_DIM's default) so qdrant.upsertPoint's
      // dimension guard passes in the auto-index tests.
      state.embedRequests.push({ body });
      const vector = Array.from({ length: 768 }, () => 0.1);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ embeddings: [vector] }));
      return;
    }

    if (req.url === '/api/pull') {
      state.pullRequests.push({ body });
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(`${JSON.stringify({ status: 'pulling manifest' })}\n`);
      res.write(`${JSON.stringify({ status: 'success' })}\n`);
      res.end();
      return;
    }

    if (req.url === '/api/delete') {
      state.deleteRequests.push({ name: body && body.name });
      if (body && body.name === 'missing-model') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'model not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `unexpected path ${req.url}` }));
  });

  return { state, server };
}

const fake = createFakeOllama();

// Listen first, then point OLLAMA_HOST at the bound port (which is only
// known after listening), then require the app — OLLAMA_HOST must be set
// before ../server is loaded.
let app;
let appServer;
let baseUrl;
let sessionCookie;
let userId;

test.before(async () => {
  await new Promise((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
  process.env.OLLAMA_HOST = `http://127.0.0.1:${fake.server.address().port}`;
  // Require only after OLLAMA_HOST points at the fake.
  app = require('../server');

  appServer = app.listen(0);
  await new Promise((resolve) => appServer.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${appServer.address().port}`;

  const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'streamtestuser', password: 'password123' }),
  });
  assert.equal(signupRes.status, 201);
  const setCookie = signupRes.headers.get('set-cookie');
  assert.ok(setCookie, 'signup must set a session cookie');
  sessionCookie = setCookie.split(';')[0];
  userId = (await signupRes.json()).user.id;
});

test.after(async () => {
  await new Promise((resolve) => appServer.close(resolve));
  await new Promise((resolve) => fake.server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function authHeaders() {
  return { 'Content-Type': 'application/json', Cookie: sessionCookie };
}

// --- /api/chat ------------------------------------------------------------

test('POST /api/chat forwards the request and streams ndjson chunks back verbatim', async () => {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      model: 'llama3',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
        { role: 'user', content: 'how are you' },
      ],
    }),
  });

  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/x-ndjson/);

  const text = await res.text();
  const lines = text.split('\n').filter((l) => l.trim());
  assert.equal(lines.length, 2);
  const parsed = lines.map((l) => JSON.parse(l));
  assert.deepEqual(
    parsed.map((c) => c.message.content),
    ['chunk-one', 'chunk-two']
  );
  assert.equal(parsed[1].done, true);

  // The proxy must have forwarded the model and the full messages array.
  assert.equal(fake.state.chatRequests.length, 1);
  const forwarded = fake.state.chatRequests[0].body;
  assert.equal(forwarded.model, 'llama3');
  assert.equal(forwarded.messages.length, 3);
  assert.equal(forwarded.messages[0].role, 'user');
  assert.equal(forwarded.stream, true);
});

// --- compaction surfaced to the client (X-Compacted) ----------------------

test('POST /api/chat does not set X-Compacted for a short conversation', async () => {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });
  await res.text();

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-compacted'), null);
});

test('POST /api/chat sets X-Compacted when older turns were folded into a summary', async () => {
  const before = fake.state.summarizeRequests.length;
  // Over COMPACTION_MAX_MESSAGES (40), so compactMessages() summarizes the
  // older turns via the fake's non-streaming branch.
  const messages = [];
  for (let i = 0; i < 50; i += 1) {
    messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `turn ${i}` });
  }

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ model: 'llama3', messages }),
  });
  await res.text();

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-compacted'), 'true');
  assert.equal(fake.state.summarizeRequests.length, before + 1, 'the summarizer must have been called once');

  // The forwarded stream request carries the summary plus the recent turns,
  // not the original 50 messages.
  const forwarded = fake.state.chatRequests[fake.state.chatRequests.length - 1].body;
  assert.ok(forwarded.messages.length < messages.length);
  assert.equal(forwarded.messages[0].role, 'system');
  assert.match(forwarded.messages[0].content, /a summary of earlier turns/);
});

test('POST /api/chat aborts the upstream request when the client disconnects', async () => {
  // Make the fake write one chunk and then hold the response open, so the
  // only way its request ends is the proxy aborting it after we hang up.
  fake.state.holdNextChat = true;

  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      model: 'llama3',
      messages: [{ role: 'user', content: 'long story' }],
    }),
    signal: controller.signal,
  });

  const reader = res.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  assert.match(new TextDecoder().decode(first.value), /chunk-one/);

  // Hang up mid-stream; server.js must then abort its own request to the
  // fake Ollama rather than leaving it generating in the background.
  controller.abort();
  reader.cancel().catch(() => {});

  const held = fake.state.chatRequests[fake.state.chatRequests.length - 1];
  await withTimeout(held.closed, 3000, 'the upstream request to be aborted');
});

// --- /api/pull -----------------------------------------------------------

test('POST /api/pull forwards the model name and streams progress back', async () => {
  const res = await fetch(`${baseUrl}/api/pull`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name: 'tinyllama' }),
  });

  assert.equal(res.status, 200);
  const text = await res.text();
  const lines = text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.status), ['pulling manifest', 'success']);

  assert.equal(fake.state.pullRequests.length, 1);
  assert.equal(fake.state.pullRequests[0].body.name, 'tinyllama');
  assert.equal(fake.state.pullRequests[0].body.stream, true);
});

// --- DELETE /api/models/:name --------------------------------------------

test('DELETE /api/models/:name forwards the name and returns ok on success', async () => {
  const res = await fetch(`${baseUrl}/api/models/llama3`, {
    method: 'DELETE',
    headers: authHeaders(),
  });

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(fake.state.deleteRequests.length, 1);
  assert.equal(fake.state.deleteRequests[0].name, 'llama3');
});

test('DELETE /api/models/:name passes the upstream failure through', async () => {
  const res = await fetch(`${baseUrl}/api/models/missing-model`, {
    method: 'DELETE',
    headers: authHeaders(),
  });

  assert.equal(res.status, 404);
  const body = await res.json();
  // The proxy surfaces the upstream body as its error message.
  assert.match(body.error, /model not found/);
});

// --- auth gate -----------------------------------------------------------

test('POST /api/chat requires a logged-in session', async () => {
  const before = fake.state.chatRequests.length;
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama3', messages: [{ role: 'user', content: 'hi' }] }),
  });

  assert.equal(res.status, 401);
  assert.equal(fake.state.chatRequests.length, before, 'no upstream request may be made');
});

// --- semantic memory (useMemory) ------------------------------------------
//
// The fake Qdrant client implements just what qdrant.js calls:
// collectionExists/getCollection (ensureCollection), upsert, search.

function createFakeQdrant(overrides = {}) {
  const state = { upserts: [], searches: [] };
  const client = {
    async collectionExists() {
      return { exists: true };
    },
    async getCollection() {
      return { config: { params: { vectors: { size: 768 } } } };
    },
    async upsert(collection, { points }) {
      state.upserts.push(...points);
      return {};
    },
    async search(collection, params) {
      state.searches.push(params);
      return (overrides.searchResults || []).map((r, i) => ({
        id: i + 1,
        score: 0.9 - i * 0.1,
        payload: r,
      }));
    },
  };
  return { state, client };
}

test('POST /api/chat with useMemory injects retrieved memory and auto-indexes the turn', async () => {
  const fakeQdrant = createFakeQdrant({
    searchResults: [{ text: 'the user likes the color blue', userId: 'someone' }],
  });
  qdrant._setClientForTests(fakeQdrant.client);

  try {
    const embedsBefore = fake.state.embedRequests.length;
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        model: 'llama3',
        messages: [{ role: 'user', content: 'what is my favorite color?' }],
        useMemory: true,
      }),
    });
    const text = await res.text();
    assert.equal(res.status, 200, `stream failed: ${text}`);

    // Retrieval happened against the latest user message.
    assert.equal(fake.state.embedRequests.length, embedsBefore + 1);
    assert.equal(fakeQdrant.state.searches.length, 1);
    assert.deepEqual(fakeQdrant.state.searches[0].filter.must, [
      { key: 'userId', match: { value: userId } },
    ]);

    // The forwarded upstream request carries the injected memory system
    // message ahead of the user's message.
    const forwarded = fake.state.chatRequests[fake.state.chatRequests.length - 1].body;
    assert.equal(forwarded.messages[0].role, 'system');
    assert.match(forwarded.messages[0].content, /\[retrieved-memory\]/);
    assert.match(forwarded.messages[0].content, /the user likes the color blue/);
    assert.equal(forwarded.messages[1].role, 'user');

    // The completed turn was auto-indexed: both the user's message and the
    // full assistant reply, each with the indexing user's id.
    await withTimeout(
      (async () => {
        for (let i = 0; i < 50 && fakeQdrant.state.upserts.length < 2; i += 1) {
          await new Promise((r) => setTimeout(r, 50));
        }
      })(),
      5000,
      'the turn to be auto-indexed'
    );
    assert.equal(fakeQdrant.state.upserts.length, 2);
    assert.equal(fakeQdrant.state.upserts[0].payload.text, 'what is my favorite color?');
    assert.equal(fakeQdrant.state.upserts[0].payload.userId, userId);
    assert.equal(fakeQdrant.state.upserts[0].payload.role, 'user');
    assert.equal(fakeQdrant.state.upserts[1].payload.role, 'assistant');
    assert.match(fakeQdrant.state.upserts[1].payload.text, /chunk-onechunk-two/);
  } finally {
    qdrant._setClientForTests(null);
  }
});

test('POST /api/chat with useMemory fails open when retrieval errors', async () => {
  const fakeQdrant = createFakeQdrant();
  fakeQdrant.client.search = async () => {
    throw new Error('qdrant down');
  };
  qdrant._setClientForTests(fakeQdrant.client);

  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        model: 'llama3',
        messages: [{ role: 'user', content: 'hello again' }],
        useMemory: true,
      }),
    });

    // The chat itself must stream normally, with no memory message and no
    // error surfaced to the client.
    assert.equal(res.status, 200);
    const lines = (await res.text()).split('\n').filter((l) => l.trim());
    assert.deepEqual(lines.map((l) => JSON.parse(l).message.content), ['chunk-one', 'chunk-two']);
    const forwarded = fake.state.chatRequests[fake.state.chatRequests.length - 1].body;
    assert.equal(forwarded.messages.length, 1);
    assert.equal(forwarded.messages[0].role, 'user');

    // Drain this request's fire-and-forget auto-index (the turn IS indexed
    // even though retrieval failed) so its async embeds can't leak into the
    // next test's assertions.
    await withTimeout(
      (async () => {
        for (let i = 0; i < 50 && fakeQdrant.state.upserts.length < 2; i += 1) {
          await new Promise((r) => setTimeout(r, 50));
        }
      })(),
      5000,
      'the auto-index to drain'
    );
  } finally {
    qdrant._setClientForTests(null);
  }
});

test('POST /api/chat without useMemory never contacts the memory stack', async () => {
  const fakeQdrant = createFakeQdrant();
  qdrant._setClientForTests(fakeQdrant.client);

  try {
    const embedsBefore = fake.state.embedRequests.length;
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        model: 'llama3',
        messages: [{ role: 'user', content: 'plain chat' }],
      }),
    });
    await res.text();
    assert.equal(res.status, 200);
    assert.equal(fake.state.embedRequests.length, embedsBefore, 'no embeddings call');
    assert.equal(fakeQdrant.state.searches.length, 0, 'no qdrant searches');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(fakeQdrant.state.upserts.length, 0, 'no auto-indexing');
  } finally {
    qdrant._setClientForTests(null);
  }
});
