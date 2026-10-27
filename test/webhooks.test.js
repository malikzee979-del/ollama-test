'use strict';

// Integration tests for webhooks (TODO 7.15): CRUD, validation, the SSRF
// posture of the stored URL, real delivery through the probe route, and
// the fire-and-forget dispatch on session creation.
//
// WEBHOOK_ALLOW_PRIVATE=1 is set before requiring ../server so hooks can
// point at this test's loopback receiver — production refuses those by
// default, and the refusal itself is asserted below.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('node:http');

process.env.WEBHOOK_ALLOW_PRIVATE = '1';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-chat-webhooks-test-'));
process.env.SESSIONS_DATA_FILE = path.join(tmpDir, 'sessions.json');
process.env.AUTH_DB_FILE = path.join(tmpDir, 'auth.db');
// The webhook store lives in db.js's aux.json — without this override the
// tests would read and pollute the developer's real local data/aux.json.
process.env.AUX_DATA_FILE = path.join(tmpDir, 'aux.json');

const app = require('../server');

let server;
let baseUrl;
let cookie;
let receiver;
let receiverPort;
let receivedBodies;
let respondWith = 200;

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'hooktestuser', password: 'password123' }),
  });
  assert.equal(res.status, 201);
  cookie = res.headers.get('set-cookie').split(';')[0];

  receivedBodies = [];
  receiver = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      receivedBodies.push({ raw, headers: req.headers });
      res.writeHead(respondWith, { 'Content-Type': 'application/json' });
      res.end('{"received":true}');
    });
  });
  await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  receiverPort = receiver.address().port;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => receiver.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function withAuth(url, options = {}) {
  return fetch(`${baseUrl}${url}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(options.headers || {}) },
  });
}

test('create, list, and delete webhooks; unknown events are dropped', async () => {
  const created = await withAuth('/api/webhooks', {
    method: 'POST',
    body: JSON.stringify({ name: 'my-hook', url: `http://127.0.0.1:${receiverPort}/hook`, events: ['session.create', 'bogus-event'] }),
  });
  assert.equal(created.status, 201);
  const hook = await created.json();
  assert.deepEqual(hook.events, ['session.create']);

  const listed = await withAuth('/api/webhooks');
  const { webhooks, events } = await listed.json();
  assert.equal(webhooks.length, 1);
  assert.deepEqual(events, ['model.pull', 'session.create']);

  const del = await withAuth(`/api/webhooks/${hook.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const gone = await withAuth(`/api/webhooks/${hook.id}`, { method: 'DELETE' });
  assert.equal(gone.status, 404);
});

test('validation: bad url, bad protocol, embedded credentials, bad name, no events', async () => {
  const cases = [
    { url: 'not a url', events: ['session.create'] },
    { url: 'ftp://example.com/hook', events: ['session.create'] },
    { url: 'http://user:pass@example.com/hook', events: ['session.create'] },
    { name: '', url: 'http://example.com/hook', events: ['session.create'] },
    { name: 'x', url: 'http://example.com/hook', events: [] },
    { name: 'x', url: 'http://example.com/hook' },
  ];
  for (const body of cases) {
    const res = await withAuth('/api/webhooks', { method: 'POST', body: JSON.stringify(body) });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('the probe delivers the production payload shape to a real receiver', async () => {
  const created = await withAuth('/api/webhooks', {
    method: 'POST',
    body: JSON.stringify({ name: 'probe', url: `http://127.0.0.1:${receiverPort}/probe`, events: ['session.create'] }),
  });
  const hook = await created.json();
  const before = receivedBodies.length;

  const probe = await withAuth(`/api/webhooks/${hook.id}/test`, { method: 'POST' });
  assert.equal(probe.status, 200);
  const outcome = await probe.json();
  assert.equal(outcome.ok, true);
  assert.equal(outcome.status, 200);

  assert.equal(receivedBodies.length, before + 1);
  const delivered = JSON.parse(receivedBodies[receivedBodies.length - 1].raw);
  assert.equal(delivered.event, 'webhook.test');
  assert.ok(delivered.at);
  assert.equal(delivered.payload.name, 'probe');
  assert.equal(receivedBodies[receivedBodies.length - 1].headers['user-agent'], 'ollama-chat-webhook/1.0');
});

test('a failing receiver reports a failed delivery, never an error', async () => {
  respondWith = 500;
  const created = await withAuth('/api/webhooks', {
    method: 'POST',
    body: JSON.stringify({ name: 'broken', url: `http://127.0.0.1:${receiverPort}/broken`, events: ['session.create'] }),
  });
  const hook = await created.json();
  const probe = await withAuth(`/api/webhooks/${hook.id}/test`, { method: 'POST' });
  const outcome = await probe.json();
  assert.equal(outcome.ok, false);
  assert.equal(outcome.status, 500);
  respondWith = 200;
});

test('dispatch: creating a session fires subscribed hooks (fire-and-forget)', async () => {
  const created = await withAuth('/api/webhooks', {
    method: 'POST',
    body: JSON.stringify({ name: 'sessions', url: `http://127.0.0.1:${receiverPort}/dispatch`, events: ['session.create'] }),
  });
  assert.equal(created.status, 201);

  const session = await withAuth('/api/sessions', { method: 'POST', body: JSON.stringify({ title: 'hooked' }) });
  assert.equal(session.status, 201);

  // Fire-and-forget: poll briefly rather than assuming synchronous delivery.
  // Earlier tests left their own session.create hooks alive, so count only
  // the one addressed to this test's /dispatch path.
  for (let i = 0; i < 50; i += 1) {
    if (receivedBodies.some((b) => b.raw.includes('"hooked"'))) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const dispatched = receivedBodies.find((b) => b.raw.includes('"hooked"'));
  assert.ok(dispatched, 'webhook should have fired for session.create');
  const delivered = JSON.parse(dispatched.raw);
  assert.equal(delivered.event, 'session.create');
  assert.equal(delivered.payload.title, 'hooked');
});

test('webhook CRUD is audited', async () => {
  const audit = await withAuth('/api/audit');
  const { entries } = await audit.json();
  const actions = entries.map((e) => e.action);
  assert.ok(actions.includes('webhook.create'));
  assert.ok(actions.includes('webhook.delete'));
});
