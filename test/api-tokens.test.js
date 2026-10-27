'use strict';

// Integration tests for API tokens (TODO 7.14): creation, one-time-secret
// listing shape, bearer-token auth on /api/* routes, revocation, and
// validation errors. Same isolated-temp-store pattern as server.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-chat-tokens-test-'));
process.env.SESSIONS_DATA_FILE = path.join(tmpDir, 'sessions.json');
process.env.AUTH_DB_FILE = path.join(tmpDir, 'auth.db');
// Token CRUD writes audit entries (token.create / token.delete) which live
// in db.js's aux.json — keep tests off the developer's real local store.
process.env.AUX_DATA_FILE = path.join(tmpDir, 'aux.json');

const app = require('../server');

let server;
let baseUrl;
let cookie;

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'tokentestuser', password: 'password123' }),
  });
  assert.equal(res.status, 201);
  cookie = res.headers.get('set-cookie').split(';')[0];
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function withAuth(url, options = {}) {
  return fetch(`${baseUrl}${url}`, { ...options, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(options.headers || {}) } });
}

test('create token returns the secret once and lists only a prefix', async () => {
  const created = await withAuth('/api/tokens', { method: 'POST', body: JSON.stringify({ name: 'my-script' }) });
  assert.equal(created.status, 201);
  const token = await created.json();
  assert.match(token.token, /^oc_[A-Za-z0-9_-]+$/);
  assert.equal(token.name, 'my-script');

  const listed = await withAuth('/api/tokens');
  const { tokens } = await listed.json();
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].id, token.id);
  assert.ok(!JSON.stringify(tokens).includes(token.token), 'listing must never include the full secret');
  assert.ok(tokens[0].prefix.startsWith('oc_'));
  assert.equal(tokens[0].lastUsedAt, null);
});

test('bearer token authenticates /api routes without a cookie', async () => {
  const created = await withAuth('/api/tokens', { method: 'POST', body: JSON.stringify({ name: 'bearer-user' }) });
  const { token } = await created.json();

  // No cookie at all — the token is the only credential.
  const res = await fetch(`${baseUrl}/api/sessions`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.sessions));

  // last_used_at is stamped on successful bearer use.
  const listed = await withAuth('/api/tokens');
  const { tokens } = await listed.json();
  const used = tokens.find((t) => t.name === 'bearer-user');
  assert.ok(used.lastUsedAt, 'bearer use should stamp last_used_at');
});

test('a bearer token cannot render the app pages', async () => {
  const created = await withAuth('/api/tokens', { method: 'POST', body: JSON.stringify({ name: 'page-guard' }) });
  const { token } = await created.json();
  const res = await fetch(`${baseUrl}/`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' });
  assert.equal(res.status, 302, 'page routes stay behind the cookie flow');
});

test('invalid and malformed bearer tokens are rejected', async () => {
  const bad = await fetch(`${baseUrl}/api/sessions`, { headers: { Authorization: 'Bearer oc_totally-fake' } });
  assert.equal(bad.status, 401);
  const malformed = await fetch(`${baseUrl}/api/sessions`, { headers: { Authorization: 'oc_not-a-bearer' } });
  assert.equal(malformed.status, 401);
  const revoked = await withAuth('/api/sessions');
  assert.equal(revoked.status, 200, 'cookie still works independently');
});

test('token validation: empty name, overlong name', async () => {
  const empty = await withAuth('/api/tokens', { method: 'POST', body: JSON.stringify({ name: '   ' }) });
  assert.equal(empty.status, 400);
  const long = await withAuth('/api/tokens', { method: 'POST', body: JSON.stringify({ name: 'x'.repeat(61) }) });
  assert.equal(long.status, 400);
});

test('revoke removes the token and its access immediately', async () => {
  const created = await withAuth('/api/tokens', { method: 'POST', body: JSON.stringify({ name: 'doomed' }) });
  const { token, id } = await created.json();
  const alive = await fetch(`${baseUrl}/api/sessions`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(alive.status, 200);

  const del = await withAuth(`/api/tokens/${id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);

  const dead = await fetch(`${baseUrl}/api/sessions`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(dead.status, 401);

  const gone = await withAuth(`/api/tokens/${id}`, { method: 'DELETE' });
  assert.equal(gone.status, 404);
});

test('token CRUD is audited', async () => {
  const created = await withAuth('/api/tokens', { method: 'POST', body: JSON.stringify({ name: 'audited' }) });
  const { id } = await created.json();
  await withAuth(`/api/tokens/${id}`, { method: 'DELETE' });
  const audit = await withAuth('/api/audit');
  const { entries } = await audit.json();
  const actions = entries.map((e) => e.action);
  assert.ok(actions.includes('token.create'));
  assert.ok(actions.includes('token.delete'));
});
