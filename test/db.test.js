'use strict';

// Tests for db.js: chat session CRUD and — most importantly — the
// per-user scoping that keeps one account from reading/modifying/deleting
// another account's chat history (see README's "Chat history" section).
//
// db.js reads its data file path once at require-time, and keeps the
// whole store in memory, so each test file gets an isolated temp file via
// SESSIONS_DATA_FILE and a fresh require of the module.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-chat-db-test-'));
process.env.SESSIONS_DATA_FILE = path.join(tmpDir, 'sessions.json');

const db = require('../db');

// Synchronous sleep so two operations land in distinct milliseconds —
// needed because updatedAt/createdAt use millisecond ISO timestamps and
// this machine can easily run two statements within the same millisecond.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('createSession creates an empty session owned by the given user', () => {
  const session = db.createSession(1, 'My chat');
  assert.equal(session.userId, 1);
  assert.equal(session.title, 'My chat');
  assert.deepEqual(session.messages, []);
  assert.ok(session.id);
  assert.ok(session.createdAt);
  assert.equal(session.createdAt, session.updatedAt);
});

test('createSession defaults the title to "New chat" when omitted or blank', () => {
  assert.equal(db.createSession(1).title, 'New chat');
  assert.equal(db.createSession(1, '   ').title, 'New chat');
});

test('listSessions only returns sessions owned by the given user, newest-updated first', () => {
  const a = db.createSession(2, 'user2 chat A');
  const b = db.createSession(2, 'user2 chat B');
  db.createSession(3, 'user3 chat');

  const listed = db.listSessions(2);
  assert.equal(listed.length, 2);
  assert.ok(listed.every((s) => !('messages' in s)), 'summaries must omit messages');
  assert.deepEqual(new Set(listed.map((s) => s.id)), new Set([a.id, b.id]));

  // Explicitly bump b's updatedAt past a's so ordering (newest-updated
  // first) is unambiguous instead of relying on two same-millisecond
  // createSession() calls to land in a particular order.
  sleepSync(5);
  db.updateSession(b.id, 2, { title: 'user2 chat B (touched)' });
  const reordered = db.listSessions(2);
  assert.equal(reordered[0].id, b.id);
  assert.equal(reordered[1].id, a.id);

  const listedForUser3 = db.listSessions(3);
  assert.equal(listedForUser3.length, 1);
  assert.notEqual(listedForUser3[0].id, a.id);
  assert.notEqual(listedForUser3[0].id, b.id);
});

test('getSession scoping: returns undefined for a wrong user or missing id', () => {
  const session = db.createSession(4, 'scoped chat');
  assert.equal(db.getSession(session.id, 4).id, session.id);
  assert.equal(db.getSession(session.id, 999), undefined);
  assert.equal(db.getSession('does-not-exist', 4), undefined);
});

test('updateSession replaces title/messages and appends messages, scoped to the owner', () => {
  const session = db.createSession(5, 'to update');

  const updated = db.updateSession(session.id, 5, {
    title: 'renamed',
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(updated.title, 'renamed');
  assert.equal(updated.messages.length, 1);
  assert.equal(updated.messages[0].role, 'user');
  assert.equal(updated.messages[0].content, 'hi');
  assert.ok(updated.messages[0].createdAt, 'normalizeMessage should stamp createdAt');

  const appended = db.updateSession(session.id, 5, {
    appendMessages: [{ role: 'assistant', content: 'hello back' }],
  });
  assert.equal(appended.messages.length, 2);
  assert.equal(appended.messages[1].content, 'hello back');

  // Wrong user: must not be able to update another account's session.
  assert.equal(db.updateSession(session.id, 999, { title: 'hijacked' }), null);
  assert.equal(db.getSession(session.id, 5).title, 'renamed');
});

test('normalizeMessage drops unknown fields but keeps model and attachments', () => {
  const session = db.createSession(6, 'attachments test');
  const updated = db.updateSession(session.id, 6, {
    messages: [
      {
        role: 'assistant',
        content: 'see attached',
        model: 'llama3',
        attachments: [{ name: 'a.txt' }],
        junk: 'should-be-dropped',
      },
    ],
  });
  const msg = updated.messages[0];
  assert.equal(msg.role, 'assistant');
  assert.equal(msg.content, 'see attached');
  assert.equal(msg.model, 'llama3');
  assert.equal('junk' in msg, false);
  assert.deepEqual(msg.attachments, [{ name: 'a.txt' }]);
});

test('deleteSession scoping: only the owner can delete, and only once', () => {
  const session = db.createSession(7, 'to delete');
  assert.equal(db.deleteSession(session.id, 999), false, 'wrong user must not delete');
  assert.ok(db.getSession(session.id, 7), 'session must still exist');
  assert.equal(db.deleteSession(session.id, 7), true);
  assert.equal(db.getSession(session.id, 7), undefined);
  assert.equal(db.deleteSession(session.id, 7), false, 'deleting twice returns false');
});

test('persists to disk and survives a fresh module load (simulating a restart)', () => {
  const session = db.createSession(8, 'persisted chat');
  const raw = fs.readFileSync(process.env.SESSIONS_DATA_FILE, 'utf8');
  const onDisk = JSON.parse(raw);
  assert.ok(onDisk[session.id], 'session must be written to the data file');
  assert.equal(onDisk[session.id].userId, 8);
});

test('a corrupt data file is recovered from by starting with an empty store', () => {
  const corruptFile = path.join(tmpDir, 'corrupt-sessions.json');
  fs.writeFileSync(corruptFile, '{ not valid json ][');
  process.env.SESSIONS_DATA_FILE = corruptFile;
  delete require.cache[require.resolve('../db')];
  const freshDb = require('../db');
  assert.deepEqual(freshDb.listSessions(1), []);
  // Restore the module cache/env for any tests that might run after this
  // in the same process.
  delete require.cache[require.resolve('../db')];
  process.env.SESSIONS_DATA_FILE = path.join(tmpDir, 'sessions.json');
  require('../db');
});
