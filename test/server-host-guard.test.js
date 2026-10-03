'use strict';

// Regression tests for the Host-header guard (server.js). HOST_ALLOWLIST is
// read into a module-level Set at require time, so — following the pattern
// in test/server.test.js — this file sets it before requiring '../server'
// (node --test runs each file in its own process). Loopback hosts are
// always allowed; this file proves the allowlist adds non-loopback ones.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.HOST_ALLOWLIST = 'mybox.local, other.host.example';
process.env.SESSIONS_DATA_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-chat-host-test-')), 'sessions.json');
process.env.AUTH_DB_FILE = path.join(process.env.SESSIONS_DATA_FILE, '..', 'auth.db');

const app = require('../server');

let server;
let port;

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  port = server.address().port;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(path.dirname(process.env.SESSIONS_DATA_FILE), { recursive: true, force: true });
});

// fetch/undici won't let us override the Host header, so drive node:http
// directly to control exactly what the server sees.
function requestWithHost(hostHeader, reqPath = '/api/auth/me') {
  const { request } = require('node:http');
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path: reqPath, headers: { Host: hostHeader } },
      (res) => {
        // Do NOT resume() here — the body is read by readBody() below.
        resolve({ status: res.statusCode, body: res });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

test('a Host in HOST_ALLOWLIST is accepted', async () => {
  const res = await requestWithHost('mybox.local');
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(await readBody(res.body)), { user: null });
});

async function readBody(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

test('a Host in HOST_ALLOWLIST with a port suffix is accepted', async () => {
  const res = await requestWithHost('other.host.example:9999');
  assert.equal(res.status, 200);
});

test('a Host outside loopback and the allowlist is rejected with 403', async () => {
  const res = await requestWithHost('evil.example');
  assert.equal(res.status, 403);
  const body = JSON.parse(await readBody(res.body));
  assert.match(body.error, /not allowed/i);
});

// Note: a request with *no* Host header can't be driven through node:http —
// Node's own HTTP parser answers HTTP/1.1 requests without Host with 400
// before any app middleware runs, which is the same safe outcome the guard
// would produce for that case (isAllowedHost returns false for a missing
// header).

test('loopback hosts remain allowed without any allowlist entry', async () => {
  const res = await requestWithHost(`127.0.0.1:${port}`);
  assert.equal(res.status, 200);
});
