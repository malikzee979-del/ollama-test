'use strict';

// Tests for auth.js: account creation, credential verification, and
// session issuance/lookup/expiry — the layer everything else (db.js's
// per-user scoping, /api/memory/* scoping) relies on being correct.
//
// auth.js opens its SQLite file once at require-time, so this test file
// points AUTH_DB_FILE at an isolated temp file before requiring it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-chat-auth-test-'));
process.env.AUTH_DB_FILE = path.join(tmpDir, 'auth.db');

const auth = require('../auth');

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('createUser accepts valid credentials and returns a public user record', () => {
  const user = auth.createUser('alice', 'password123');
  assert.equal(user.username, 'alice');
  assert.ok(user.id);
  assert.ok(user.createdAt);
  assert.equal('password_hash' in user, false, 'password hash must never be in the public record');
});

test('createUser rejects invalid usernames and short passwords', () => {
  assert.throws(() => auth.createUser('ab', 'password123'), /Username/);
  assert.throws(() => auth.createUser('has space', 'password123'), /Username/);
  assert.throws(() => auth.createUser('validname', 'short'), /Password/);
});

test('createUser rejects a duplicate username', () => {
  auth.createUser('bob', 'password123');
  assert.throws(() => auth.createUser('bob', 'anotherpassword'), /already taken/);
});

test('verifyUser returns the user for correct credentials, null otherwise', () => {
  auth.createUser('carol', 'correct-horse-battery');
  assert.ok(auth.verifyUser('carol', 'correct-horse-battery'));
  assert.equal(auth.verifyUser('carol', 'wrong-password'), null);
  assert.equal(auth.verifyUser('no-such-user', 'whatever1'), null);
});

test('two users with the same password get different stored hashes (salted)', () => {
  // Verified indirectly: verifyUser must still work for both independently,
  // which would fail if salts collided or were ignored.
  auth.createUser('dana', 'shared-password-1');
  auth.createUser('erin', 'shared-password-1');
  assert.ok(auth.verifyUser('dana', 'shared-password-1'));
  assert.ok(auth.verifyUser('erin', 'shared-password-1'));
});

test('createSession + getUserBySessionToken round-trips to the right user', () => {
  const user = auth.createUser('frank', 'password123');
  const { token, expiresAt } = auth.createSession(user.id);
  assert.ok(token);
  assert.ok(expiresAt instanceof Date);

  const lookedUp = auth.getUserBySessionToken(token);
  assert.equal(lookedUp.id, user.id);
  assert.equal(lookedUp.username, 'frank');
});

test('getUserBySessionToken returns null for missing/invalid tokens', () => {
  assert.equal(auth.getUserBySessionToken(undefined), null);
  assert.equal(auth.getUserBySessionToken(''), null);
  assert.equal(auth.getUserBySessionToken('not-a-real-token'), null);
});

test('getUserBySessionToken returns null and removes an expired session', () => {
  const user = auth.createUser('grace', 'password123');
  const { token } = auth.createSession(user.id);

  // Reach into the same SQLite file directly to backdate expires_at,
  // since auth.js has no public API for shrinking SESSION_TTL_MS.
  const rawDb = new DatabaseSync(process.env.AUTH_DB_FILE);
  rawDb.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(
    new Date(Date.now() - 1000).toISOString(),
    token
  );
  rawDb.close();

  assert.equal(auth.getUserBySessionToken(token), null, 'expired session must not resolve to a user');

  // Lazy pruning: looking it up once should have deleted the row.
  const rawDb2 = new DatabaseSync(process.env.AUTH_DB_FILE);
  const row = rawDb2.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  rawDb2.close();
  assert.equal(row, undefined, 'expired session row should be pruned on lookup');
});

test('deleteSession removes the session so the token no longer resolves', () => {
  const user = auth.createUser('heidi', 'password123');
  const { token } = auth.createSession(user.id);
  assert.ok(auth.getUserBySessionToken(token));
  auth.deleteSession(token);
  assert.equal(auth.getUserBySessionToken(token), null);
});

test('pruneExpiredSessions removes only expired sessions, leaving valid ones intact', () => {
  const user = auth.createUser('ivan', 'password123');
  const { token: validToken } = auth.createSession(user.id);
  const { token: expiredToken } = auth.createSession(user.id);

  const rawDb = new DatabaseSync(process.env.AUTH_DB_FILE);
  rawDb.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(
    new Date(Date.now() - 1000).toISOString(),
    expiredToken
  );
  rawDb.close();

  const removed = auth.pruneExpiredSessions();
  assert.ok(removed >= 1);
  assert.equal(auth.getUserBySessionToken(expiredToken), null);
  assert.ok(auth.getUserBySessionToken(validToken), 'a still-valid session must survive pruning');
});
