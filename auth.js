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
  CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
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

// --- login lockout (per username + IP) -------------------------------------
//
// server.js rate-limits /api/auth/login per client IP, but that leaves two
// holes: an attacker can spray one username from many IPs, or spray many
// usernames from one IP that never trips the per-IP cap. This adds the
// missing dimension: failed logins are counted per (username, ip) pair, and
// once one pair accumulates LOCKOUT_MAX_FAILURES within the window, further
// attempts for that pair are refused until the window drains.
//
// Keyed on username+IP rather than username alone on purpose — a global
// username lock would hand anyone a one-liner DoS: type a victim's name in
// five times from any IP and their account cannot log in at all for the
// window. Per-pair still stops the spraying patterns above while leaving
// legitimate distributed use untouched.
//
// Same in-memory fixed-window shape as server.js's rateLimiter (Map of
// timestamp arrays, opportunistic sweep) — resets on restart, which is
// acceptable for the same reasons documented there.

const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_MAX_FAILURES = 5;

const failedLoginAttempts = new Map(); // `${usernameLower}|${ip}` -> [timestamps]
let lastLockoutSweep = 0;

function lockoutKey(username, ip) {
  // Case-fold the username: credentials are compared case-sensitively by
  // SQLite here, but a spray usually isn't case-consistent, and folding
  // keeps one username from getting five windows' worth of attempts by
  // alternating "Alice" and "alice".
  return `${String(username).toLowerCase()}|${ip || 'unknown'}`;
}

function sweepFailedLogins(now) {
  if (now - lastLockoutSweep < LOCKOUT_WINDOW_MS) return;
  lastLockoutSweep = now;
  for (const [key, stamps] of failedLoginAttempts) {
    const alive = stamps.filter((t) => now - t < LOCKOUT_WINDOW_MS);
    if (alive.length > 0) failedLoginAttempts.set(key, alive);
    else failedLoginAttempts.delete(key);
  }
}

// Returns null while the pair is under the failure threshold, or an object
// carrying the seconds until the lock drains (for the Retry-After header).
function loginLockRemaining(username, ip) {
  const key = lockoutKey(username, ip);
  const now = Date.now();
  sweepFailedLogins(now);
  const stamps = (failedLoginAttempts.get(key) || []).filter((t) => now - t < LOCKOUT_WINDOW_MS);
  if (stamps.length < LOCKOUT_MAX_FAILURES) return null;
  return { retryAfterSec: Math.ceil((LOCKOUT_WINDOW_MS - (now - stamps[0])) / 1000) };
}

// Count one failed attempt. Old stamps are dropped inline so a long-running
// attacker cycling above the threshold can't accumulate a stale trailing
// window (the sweeper would also handle it, but only once per window).
function recordLoginFailure(username, ip) {
  const key = lockoutKey(username, ip);
  const now = Date.now();
  const stamps = (failedLoginAttempts.get(key) || []).filter((t) => now - t < LOCKOUT_WINDOW_MS);
  stamps.push(now);
  failedLoginAttempts.set(key, stamps);
}

// A successful login clears the pair entirely: five spaced-out failures a
// week apart must never add up to a lock.
function clearLoginFailures(username, ip) {
  failedLoginAttempts.delete(lockoutKey(username, ip));
}

// --- API tokens (TODO 7.14) ------------------------------------------------
// Personal API keys so scripts can call /api/* without a browser cookie.
// Unlike sessions they never expire on their own, are listed without their
// secret (only a prefix is kept for display), and are revoked explicitly.
// The full token is returned exactly once, at creation.

const API_TOKEN_PREFIX = 'oc_';
const MAX_API_TOKENS = 50;
const MAX_API_TOKEN_NAME_CHARS = 60;

function createApiToken(userId, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Token name must be a non-empty string.');
  if (trimmed.length > MAX_API_TOKEN_NAME_CHARS) {
    throw new Error(`Token name must not exceed ${MAX_API_TOKEN_NAME_CHARS} characters.`);
  }
  const count = db.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ?').get(userId).n;
  if (count >= MAX_API_TOKENS) {
    throw new Error(`At most ${MAX_API_TOKENS} API tokens are kept; delete one first.`);
  }
  const id = crypto.randomUUID();
  const token = API_TOKEN_PREFIX + crypto.randomBytes(24).toString('base64url');
  const createdAt = new Date().toISOString();
  db.prepare('INSERT INTO api_tokens (id, user_id, name, token, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id, userId, trimmed, token, createdAt
  );
  return { id, name: trimmed, token, createdAt, prefix: token.slice(0, 8) };
}

// Public listing shape: never includes the secret itself.
function listApiTokens(userId) {
  return db
    .prepare('SELECT id, name, token, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId)
    .map((row) => ({
      id: row.id,
      name: row.name,
      prefix: `${API_TOKEN_PREFIX}${row.token.slice(API_TOKEN_PREFIX.length, API_TOKEN_PREFIX.length + 6)}`,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at || null,
    }));
}

function deleteApiToken(userId, id) {
  const result = db.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').run(id, userId);
  return result.changes > 0;
}

// Bearer-token lookup. Touches last_used_at (best-effort) so the UI can
// show which keys scripts are actually using.
function getUserByApiToken(token) {
  if (typeof token !== 'string' || !token.startsWith(API_TOKEN_PREFIX)) return null;
  const row = db.prepare('SELECT t.user_id, t.id AS token_id, t.last_used_at FROM api_tokens t WHERE t.token = ?').get(token);
  if (!row) return null;
  const user = getUserById(row.user_id);
  if (!user) return null;
  try {
    db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), row.token_id);
  } catch {
    // last_used_at is display metadata; a failure here must not fail auth.
  }
  return toPublicUser(user);
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
  // API tokens (7.14)
  API_TOKEN_PREFIX,
  createApiToken,
  listApiTokens,
  deleteApiToken,
  getUserByApiToken,
  // login lockout (see the section comment above)
  LOCKOUT_WINDOW_MS,
  LOCKOUT_MAX_FAILURES,
  loginLockRemaining,
  recordLoginFailure,
  clearLoginFailures,
};

// --- CLI: local password reset + auth.db backup --------------------------
//
//   node auth.js --reset-password <username>
//   node auth.js --backup-authdb [dest-dir]
//
// Run on the host, so it can only ever be invoked by someone with shell
// access — no network, no SMTP. Only runs when this file is executed
// directly, never when it's required by server.js or the tests.
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

  // Copies the live auth.db to a timestamped file. SQLite's own backup
  // would be the gold standard, but node:sqlite's DatabaseSync doesn't
  // expose it — a plain copy is safe here because this server writes
  // sessions rarely (login/signup/prune), and the copy is taken at an
  // instant: worst case a half-landed session insert is lost, never users.
  function backupAuthDb(destDir) {
    if (!fs.existsSync(DB_FILE)) {
      throw new Error(`No auth database found at ${DB_FILE}.`);
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(destDir, `auth-${stamp}.db`);
    fs.copyFileSync(DB_FILE, target);
    return target;
  }

  (async () => {
    const args = process.argv.slice(2);

    if (args[0] === '--backup-authdb') {
      // Default destination: data/backups next to the live db.
      const destDir = args[1] || path.join(path.dirname(DB_FILE), 'backups');
      try {
        fs.mkdirSync(destDir, { recursive: true });
        const target = backupAuthDb(destDir);
        console.log(`Backed up ${DB_FILE} -> ${target}`);
        process.exit(0);
      } catch (err) {
        console.error(err.message);
        process.exit(1);
      }
    }

    const username = args[0] === '--reset-password' ? args[1] : args[0];
    if (!username || args[0] !== '--reset-password') {
      console.error('Usage: node auth.js --reset-password <username>');
      console.error('       node auth.js --backup-authdb [dest-dir]');
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
