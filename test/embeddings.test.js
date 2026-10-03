'use strict';

// Tests for embeddings.js. No real Ollama is contacted: global fetch is
// mocked per test via t.mock.method() (the same pattern test/server.test.js
// uses for summarizeWithOllama), and the assertions cover the URL/body of
// each upstream call plus embeddings.js's response-shape and error handling:
// the /api/embed happy path, the 404 fallback to the older /api/embeddings
// endpoint, malformed-response guards, and non-200 propagation.

const test = require('node:test');
const assert = require('node:assert/strict');

const embeddings = require('../embeddings');

// Minimal Response stand-in: embeddings.js only touches status/ok/json/text.
function mockResponse({ status = 200, json, text = '' }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return json;
    },
    async text() {
      return text;
    },
  };
}

// Installs the fetch mock for one test and returns the recorded calls as
// [{ url, body }] so tests can assert what was sent upstream.
function mockFetch(t, responder) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const body = opts && typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    calls.push({ url: String(url), body });
    return responder(url, opts, calls);
  });
  return calls;
}

test('embed() calls /api/embed and returns the first vector from { embeddings: [[...]] }', async (t) => {
  const calls = mockFetch(t, () => mockResponse({ json: { embeddings: [[0.1, 0.2, 0.3]] } }));

  const vector = await embeddings.embed('some text');

  assert.deepEqual(vector, [0.1, 0.2, 0.3]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${embeddings.OLLAMA_HOST}/api/embed`);
  assert.equal(calls[0].body.model, embeddings.EMBEDDING_MODEL);
  assert.equal(calls[0].body.input, 'some text');
});

test('embed() accepts the older { embedding: [...] } shape from /api/embed', async (t) => {
  mockFetch(t, () => mockResponse({ json: { embedding: [0.4, 0.5] } }));

  const vector = await embeddings.embed('some text');

  assert.deepEqual(vector, [0.4, 0.5]);
});

test('embed() falls back to /api/embeddings when /api/embed returns 404', async (t) => {
  const calls = mockFetch(t, (url) => {
    if (String(url).endsWith('/api/embed')) {
      return mockResponse({ status: 404 });
    }
    return mockResponse({ json: { embedding: [0.7, 0.8] } });
  });

  const vector = await embeddings.embed('fallback text');

  assert.deepEqual(vector, [0.7, 0.8]);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.endsWith('/api/embed'));
  assert.ok(calls[1].url.endsWith('/api/embeddings'));
  // The legacy endpoint takes `prompt`, not `input`.
  assert.equal(calls[1].body.prompt, 'fallback text');
  assert.equal(calls[1].body.input, undefined);
});

test('embed() throws a status-carrying error when the 404 fallback also fails', async (t) => {
  mockFetch(t, (url) => {
    if (String(url).endsWith('/api/embed')) {
      return mockResponse({ status: 404 });
    }
    return mockResponse({ status: 503, text: 'embeddings service down' });
  });

  await assert.rejects(() => embeddings.embed('x'), /Ollama embeddings request failed \(503\): embeddings service down/);
});

test('embed() throws on a non-404, non-ok response from /api/embed', async (t) => {
  mockFetch(t, () => mockResponse({ status: 500, text: 'internal error' }));

  await assert.rejects(() => embeddings.embed('x'), /Ollama embed request failed \(500\): internal error/);
});

test('embed() throws on a malformed response shape from /api/embed', async (t) => {
  mockFetch(t, () => mockResponse({ json: { unexpected: true } }));

  await assert.rejects(() => embeddings.embed('x'), /Unexpected response shape from \/api\/embed/);
});

test('embed() throws on a malformed response shape from the /api/embeddings fallback', async (t) => {
  mockFetch(t, (url) => {
    if (String(url).endsWith('/api/embed')) {
      return mockResponse({ status: 404 });
    }
    return mockResponse({ json: { unexpected: true } });
  });

  await assert.rejects(() => embeddings.embed('x'), /Unexpected response shape from \/api\/embeddings/);
});
