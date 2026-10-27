'use strict';

// Integration tests for council mode (TODO 7.5): POST /api/council runs
// every member model in parallel, then a synthesis pass merges the answers.
// Runs against a fake Ollama (node:http) so no real Ollama is contacted —
// OLLAMA_HOST is pointed at the fake before ../server is required (each
// node --test file is its own process).

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-chat-council-test-'));
process.env.SESSIONS_DATA_FILE = path.join(tmpDir, 'sessions.json');
process.env.AUTH_DB_FILE = path.join(tmpDir, 'auth.db');
process.env.AUX_DATA_FILE = path.join(tmpDir, 'aux.json');

// Non-streaming /api/chat responses keyed by requested model: member models
// answer "member answer for X"; the synthesizer model returns a merged reply
// when the prompt contains the members' answers (proving the synthesis call
// saw them). Streaming chat is never used by /api/council.
const ollamaServer = http.createServer(async (req, res) => {
  const rawChunks = [];
  for await (const chunk of req) rawChunks.push(chunk);
  const body = JSON.parse(Buffer.concat(rawChunks).toString('utf8') || '{}');

  if (req.url !== '/api/chat') {
    res.writeHead(404);
    res.end('{}');
    return;
  }

  const model = body.model;
  if (model === 'synth-model') {
    // The synthesis prompt carries the ORIGINAL member prompt (the member-broken
// failure test only sends "prompt"), so match the member ANSWERS — each
// successful member contributes one "member answer for X" line — rather than
// the per-model headers.
const sawMembers = (body.messages[1].content.match(/member answer for /g) || []).length;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      message: { role: 'assistant', content: sawMembers ? 'merged answer' : 'synthesizer saw nothing' },
      eval_count: 10,
      eval_duration: 1000000,
    }));
    return;
  }
  if (model === 'member-broken' || model === 'member-broken2') {
    res.writeHead(500);
    res.end('boom');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    message: { role: 'assistant', content: `member answer for ${model}` },
    eval_count: 5,
    eval_duration: 1000000,
  }));
});

// server.js reads OLLAMA_HOST at require time, and the fake Ollama's port
// is only knowable after it listens — so ../server is required inside
// test.before, after the listen callback has set OLLAMA_HOST.
let app;

let server;
let baseUrl;
let cookie;

test.before(async () => {
  await new Promise((resolve) => ollamaServer.listen(0, '127.0.0.1', resolve));
  process.env.OLLAMA_HOST = `http://127.0.0.1:${ollamaServer.address().port}`;
  app = require('../server');

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'counciluser', password: 'password123' }),
  });
  assert.equal(res.status, 201);
  cookie = res.headers.get('set-cookie').split(';')[0];
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => ollamaServer.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function withAuth(url, options = {}) {
  return fetch(`${baseUrl}${url}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(options.headers || {}) },
  });
}

test('council answers with every member, then synthesizes a merged reply', async () => {
  const res = await withAuth('/api/council', {
    method: 'POST',
    body: JSON.stringify({
      model: ['member-a', 'member-b'],
      prompt: 'What is the answer?',
      synthesizer: 'synth-model',
    }),
  });
  assert.equal(res.status, 200);
  const { results, synthesis } = await res.json();
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((r) => r.content), ['member answer for member-a', 'member answer for member-b']);
  assert.equal(results.every((r) => r.error === null), true);
  assert.equal(synthesis.model, 'synth-model');
  assert.equal(synthesis.error, null);
  assert.equal(synthesis.content, 'merged answer');
});

test('a failing member is isolated; the council still synthesizes', async () => {
  const res = await withAuth('/api/council', {
    method: 'POST',
    body: JSON.stringify({
      model: ['member-a', 'member-broken'],
      prompt: 'prompt',
      synthesizer: 'synth-model',
    }),
  });
  const { results, synthesis } = await res.json();
  assert.match(results.find((r) => r.model === 'member-broken').error, /boom|500/);
  assert.equal(results.find((r) => r.model === 'member-a').content, 'member answer for member-a');
  // Only the successful member feeds the synthesizer — and it still merges.
  assert.equal(synthesis.content, 'merged answer');
});

test('validation: too few models, too many, missing prompt/synthesizer', async () => {
  const cases = [
    { model: ['member-a'], prompt: 'x', synthesizer: 'synth-model' },
    { model: ['a', 'b', 'c', 'd', 'e'], prompt: 'x', synthesizer: 'synth-model' },
    { model: ['member-a', 'member-b'], prompt: '   ', synthesizer: 'synth-model' },
    { model: ['member-a', 'member-b'], prompt: 'x' },
  ];
  for (const body of cases) {
    const res = await withAuth('/api/council', { method: 'POST', body: JSON.stringify(body) });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('all members failing yields a synthesis error, not a 500', async () => {
  const res = await withAuth('/api/council', {
    method: 'POST',
    body: JSON.stringify({
      model: ['member-broken', 'member-broken2'],
      prompt: 'x',
      synthesizer: 'synth-model',
    }),
  });
  assert.equal(res.status, 200);
  const { results, synthesis } = await res.json();
  assert.equal(results.every((r) => r.error), true);
  assert.equal(synthesis.error, 'No council member produced an answer, so there is nothing to synthesize.');
});
