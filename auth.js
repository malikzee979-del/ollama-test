// Local authentication, backed by SQLite via Node's built-in `node:sqlite`
// module (stable since Node 22.5, no native compilation needed — see
// db.js for why this project avoids deps like better-sqlite3). Two tables:
// `users` (username + salted/hashed password) and `sessions` (opaque
// bearer tokens handed out as an httpOnly cookie after signup/login).
//
// Besides gating access to the app, the user id issued here is also used
// by db.js (chat sessions) and the /api/memory/* routes in server.js to
// scope that data per-user, so separate accounts don't see each other's
// chat history or semantic memory.

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// DB_FILE is overridable via AUTH_DB_FILE so tests can point at an
// isolated temp file instead of the real local data/auth.db (see
// test/auth.test.js) — unset, behavior is unchanged from before.
const DB_FILE = process.env.AUTH_DB_FILE || path.join(__dirname, 'data', 'auth.db');
const DATA_DIR = path.dirname(DB_FILE);

const SESSION_COOKIE = 'sid';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// --- password hashing (scrypt, built into Node's crypto module) --------

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split(':');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// --- users ---------------------------------------------------------------

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

function validateCredentials(username, password) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'Username must be 3-32 characters: letters, numbers, "_", "." or "-".';
  }
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  return null;
}

function toPublicUser(row) {
  return { id: row.id, username: row.username, createdAt: row.created_at };
}

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// Creates a user. Throws an Error with a user-facing message on failure
// (invalid input, or username already taken).
function createUser(username, password) {
  const validationError = validateCredentials(username, password);
  if (validationError) throw new Error(validationError);

  if (getUserByUsername(username)) {
    throw new Error('That username is already taken.');
  }

  const passwordHash = hashPassword(password);
  const createdAt = new Date().toISOString();
  const result = db
    .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(username, passwordHash, createdAt);
  return toPublicUser({ id: result.lastInsertRowid, username, created_at: createdAt });
}

// Verifies credentials. Returns the public user record, or null.
function verifyUser(username, password) {
  const row = getUserByUsername(username);
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  return toPublicUser(row);
}

// --- sessions --------------------------------------------------------------

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    new Date(now).toISOString(),
    new Date(now + SESSION_TTL_MS).toISOString()
  );
  return { token, expiresAt: new Date(now + SESSION_TTL_MS) };
}

// Looks up the user for a session token, pruning it if expired. Returns
// the public user record, or null if the token is missing/invalid/expired.
function getUserBySessionToken(token) {
  if (!token) return null;
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  const user = getUserById(session.user_id);
  return user ? toPublicUser(user) : null;
}

function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// Removes all expired session rows. Expired sessions are also pruned
// lazily whenever they're looked up (see getUserBySessionToken), but that
// only catches tokens someone actually presents again; a session that's
// simply abandoned (browser closed, cookie cleared) would otherwise sit in
// the table forever. Called periodically from server.js.
function pruneExpiredSessions() {
  const result = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  return result.changes;
}

// Resets a user's password. Used by the CLI entry point at the bottom of
// this file (`node auth.js --reset-password <username>`) — the recommended
// local-first alternative to an emailed-token flow. Throws an Error with a
// user-facing message on invalid input or an unknown username. Revokes all
// of the user's sessions: whoever asked for the reset may not be the only
// one holding a live cookie.
function resetPassword(username, newPassword) {
  const validationError = validateCredentials(username, newPassword);
  if (validationError) throw new Error(validationError);

  const row = getUserByUsername(username);
  if (!row) throw new Error(`No user named "${username}".`);

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), row.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
  return toPublicUser(row);
}

module.exports = {
  DB_FILE,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createUser,
  verifyUser,
  resetPassword,
  createSession,
  getUserBySessionToken,
  deleteSession,
  pruneExpiredSessions,
};

// --- CLI: local password reset ------------------------------------------
//
//   node auth.js --reset-password <username>
//
// Run on the host, so it can only ever be invoked by someone with shell
// access — no network, no SMTP. Prompts for the new password twice (input
// muted), validates it with the same rules as signup, and revokes the
// user's existing sessions. Only runs when this file is executed directly,
// never when it's required by server.js or the tests.
if (require.main === module) {
  const readline = require('readline');

  function promptHiddenTwice(firstPrompt, secondPrompt) {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
      // Mute the echo: redraw whatever readline writes as asterisks so the
      // password never appears on screen (or in terminal scrollback).
      rl.stdoutMuted = true;
      rl._writeToOutput = (stringToWrite) => rl.output.write(rl.stdoutMuted ? '*' : stringToWrite);
      // Both prompts share one interface — a second interface on the same
      // stdin after the first closes swallows buffered input.
      rl.question(firstPrompt, (first) => {
        rl.question(secondPrompt, (second) => {
          rl.close();
          resolve([first, second]);
        });
      });
    });
  }

  (async () => {
    const args = process.argv.slice(2);
    const username = args[0] === '--reset-password' ? args[1] : args[0];
    if (!username || args[0] !== '--reset-password') {
      console.error('Usage: node auth.js --reset-password <username>');
      process.exit(1);
    }

    const [newPassword, confirmed] = await promptHiddenTwice(
      `New password for "${username}": `,
      'Confirm new password: '
    );
    if (newPassword !== confirmed) {
      console.error('Passwords do not match; nothing changed.');
      process.exit(1);
    }

    try {
      const user = resetPassword(username, newPassword);
      console.log(`Password reset for "${user.username}"; all existing sessions were revoked.`);
      process.exit(0);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  })();
}
