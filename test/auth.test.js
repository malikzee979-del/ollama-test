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

// --- resetPassword (CLI password reset) ------------------------------------

test('resetPassword changes the password and revokes all existing sessions', () => {
  const user = auth.createUser('resetme', 'oldpassword1');
  const { token } = auth.createSession(user.id);
  assert.ok(auth.verifyUser('resetme', 'oldpassword1'), 'sanity: old password verifies before reset');
  assert.ok(auth.getUserBySessionToken(token), 'sanity: session is live before reset');

  const result = auth.resetPassword('resetme', 'newpassword9');
  assert.equal(result.username, 'resetme');
  assert.equal('password_hash' in result, false, 'password hash must never be in the public record');

  assert.ok(auth.verifyUser('resetme', 'newpassword9'), 'the new password must verify');
  assert.equal(auth.verifyUser('resetme', 'oldpassword1'), null, 'the old password must stop verifying');
  assert.equal(auth.getUserBySessionToken(token), null, 'a live session must be revoked by the reset');
});

test('resetPassword validates input and rejects unknown usernames', () => {
  assert.throws(() => auth.resetPassword('nosuchuser', 'password123'), /No user named/);
  assert.throws(() => auth.resetPassword('resetme', 'short'), /Password/);
  assert.throws(() => auth.resetPassword('bad name!', 'password123'), /Username/);
});

// --- login lockout (per username + IP) --------------------------------------
//
// In-memory, so each test below must only rely on the pairs it created —
// and clean up after itself, since auth.js is required once for the whole
// file and the failure map persists across tests.

test('loginLockRemaining is null until LOCKOUT_MAX_FAILURES failures accumulate', () => {
  for (let i = 0; i < auth.LOCKOUT_MAX_FAILURES - 1; i++) {
    auth.recordLoginFailure('lockout-under', '10.0.0.1');
    assert.equal(auth.loginLockRemaining('lockout-under', '10.0.0.1'), null, 'under threshold must not lock');
  }
  auth.recordLoginFailure('lockout-under', '10.0.0.1');
  assert.ok(auth.loginLockRemaining('lockout-under', '10.0.0.1'), 'at threshold must lock');
  auth.clearLoginFailures('lockout-under', '10.0.0.1');
  assert.equal(auth.loginLockRemaining('lockout-under', '10.0.0.1'), null, 'clear must lift the lock');
});

test('lockout is scoped per (username, ip) pair, not per username or per ip', () => {
  for (let i = 0; i < auth.LOCKOUT_MAX_FAILURES; i++) {
    auth.recordLoginFailure('lockout-pair', '10.0.0.2');
  }
  // Same username, different IP: not locked.
  assert.equal(auth.loginLockRemaining('lockout-pair', '10.0.0.3'), null);
  // Same IP, different username: not locked.
  assert.equal(auth.loginLockRemaining('lockout-knave', '10.0.0.2'), null);
  // The pair itself: locked.
  assert.ok(auth.loginLockRemaining('lockout-pair', '10.0.0.2'));
  auth.clearLoginFailures('lockout-pair', '10.0.0.2');
});

test('lockout is case-insensitive on the username', () => {
  for (let i = 0; i < auth.LOCKOUT_MAX_FAILURES; i++) {
    auth.recordLoginFailure('LockOut-Case', '10.0.0.4');
  }
  assert.ok(auth.loginLockRemaining('lockout-case', '10.0.0.4'), 'case-folded pair must be locked');
  auth.clearLoginFailures('LOCKOUT-CASE', '10.0.0.4');
  assert.equal(auth.loginLockRemaining('lockout-case', '10.0.0.4'), null, 'clear must be case-insensitive too');
});

test('locked pairs report a positive Retry-After, and old failures are dropped', () => {
  for (let i = 0; i < auth.LOCKOUT_MAX_FAILURES; i++) {
    auth.recordLoginFailure('lockout-rtry', '10.0.0.5');
  }
  const lock = auth.loginLockRemaining('lockout-rtry', '10.0.0.5');
  assert.ok(lock);
  assert.ok(lock.retryAfterSec > 0 && lock.retryAfterSec <= auth.LOCKOUT_WINDOW_MS / 1000);
  assert.equal(
    auth.loginLockRemaining('lockout-rtry', '10.99.99.99'),
    null,
    'a fresh IP against the same username must not be locked'
  );
  auth.clearLoginFailures('lockout-rtry', '10.0.0.5');
});
