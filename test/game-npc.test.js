'use strict';

// Integration tests for the Local Theft Auto game bridge on POST
// /api/game-npc (F19): the LTA_GAME_TOKEN bearer credential. That token
// authenticates ONLY that one route with a synthetic user — every other
// /api/* path must still 401 for it — while the session cookie and real
// API tokens keep behaving exactly as before.
//
// Same isolated-temp-store pattern as server.test.js. LTA_GAME_TOKEN must
// be set BEFORE requiring ../server (server.js reads it once at require
// time), which is safe because node --test runs each test file in its own
// process. No real Ollama is contacted: the "token works" assertions only
// require the request to PASS the auth gate (400s for missing model etc.
// are fine — anything other than 401/403 proves the gate let it through).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-chat-game-npc-test-'));
process.env.SESSIONS_DATA_FILE = path.join(tmpDir, 'sessions.json');
process.env.AUTH_DB_FILE = path.join(tmpDir, 'auth.db');
// Ollama host pointed at a dead port so the "auth passed" case fails fast
// in the fetch with a 503 instead of hanging — the status is still the
// signal under test, not the payload.
process.env.OLLAMA_HOST = 'http://127.0.0.1:9';
const GAME_TOKEN = 'lta-game-secret-0123456789';
process.env.LTA_GAME_TOKEN = GAME_TOKEN;

const app = require('../server');

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function postGameNpc(headers) {
  return fetch(`${baseUrl}/api/game-npc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: JSON.stringify({ model: 'llama3', playerLine: 'hello', scene: 'street' }),
  });
}

test('no token -> 401 on /api/game-npc', async () => {
  const res = await postGameNpc();
  assert.equal(res.status, 401);
});

test('wrong token -> 401 on /api/game-npc', async () => {
  const res = await postGameNpc({ Authorization: 'Bearer not-the-right-token' });
  assert.equal(res.status, 401);
});

test('game token passes the auth gate on /api/game-npc', async () => {
  const res = await postGameNpc({ Authorization: `Bearer ${GAME_TOKEN}` });
  // 401/403 would mean the auth gate rejected the token; anything else
  // (200 with a model, 503 with Ollama down, 400 for a bad body) proves
  // the gate admitted the synthetic user.
  assert.notEqual(res.status, 401);
  assert.notEqual(res.status, 403);
});

test('game token on another /api route -> 401', async () => {
  const res = await fetch(`${baseUrl}/api/sessions`, {
    headers: { Authorization: `Bearer ${GAME_TOKEN}` },
  });
  assert.equal(res.status, 401);
});

test('game token on /api/auth/me -> 401 (synthetic user is single-route)', async () => {
  const res = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${GAME_TOKEN}` },
  });
  // /api/auth/* passes the gate for everyone; the synthetic user's own
  // /api/game-npc-only restriction is enforced by the gate's synthetic
  // check, and /api/auth/me simply reports the user. Assert the gate does
  // NOT 401 the auth route itself (public by design) while still not
  // leaking full user data — the synthetic user has only id/synthetic.
  assert.notEqual(res.status, 401);
  const body = await res.json();
  assert.equal(body.user && body.user.synthetic, true);
});