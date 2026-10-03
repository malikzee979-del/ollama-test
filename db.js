// Minimal file-based JSON store for chat sessions.
//
// Why hand-rolled JSON instead of a dependency: this project's stated
// philosophy is "no build step, minimal deps" (see README/package.json —
// a single `express` dependency, no bundler). better-sqlite3 requires a
// native compiled addon (node-gyp/prebuild-install), which is exactly the
// kind of install-time risk this project avoids; lowdb's current major
// version is ESM-only, which doesn't fit this CommonJS (`"type":
// "commonjs"`) codebase without extra ceremony. A tiny synchronous
// JSON-file store keeps the zero-extra-dependency footprint, needs no
// native build step, and is more than sufficient for a single-user local
// app with a handful of chat sessions.
//
// Persistence model: the whole sessions map is kept in memory and written
// to disk on every mutation. Writes are atomic (write to a temp file, then
// rename over the real file) so a crash mid-write can't corrupt the store.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// DATA_FILE is overridable via SESSIONS_DATA_FILE so tests can point at an
// isolated temp file instead of the real local data/sessions.json (see
// test/db.test.js) — unset, behavior is unchanged from before.
const DATA_FILE = process.env.SESSIONS_DATA_FILE || path.join(__dirname, 'data', 'sessions.json');
const DATA_DIR = path.dirname(DATA_FILE);

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function load() {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    // Corrupt or unreadable data file: don't crash the server, start empty
    // instead. The bad file is left on disk in case manual recovery is
    // wanted.
    console.error(`[db] Failed to read ${DATA_FILE}, starting with an empty store: ${err.message}`);
    return {};
  }
}

function persist() {
  ensureDataDir();
  const tmpFile = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(sessions, null, 2));
  fs.renameSync(tmpFile, DATA_FILE);
}

// In-memory map of id -> session, loaded once at module init.
let sessions = load();

function toSummary(session) {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

// Sessions are scoped per-user (see auth.js): every read/write below takes
// a `userId` and only ever touches sessions owned by that user, so one
// account can never see or modify another account's chat history through
// these APIs. Sessions created before per-user scoping existed (no
// `userId` field) are owned by no one and won't be returned here.

// List session summaries (no messages) owned by `userId`, newest-updated
// first.
function listSessions(userId) {
  return Object.values(sessions)
    .filter((s) => s.userId === userId)
    .map(toSummary)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

// Get a full session (including messages) by id, scoped to `userId`.
// Returns undefined if it doesn't exist or belongs to a different user.
function getSession(id, userId) {
  const session = sessions[id];
  return session && session.userId === userId ? session : undefined;
}

// Create a new, empty session owned by `userId`. `title` defaults to
// "New chat" if omitted.
function createSession(userId, title) {
  const now = new Date().toISOString();
  const session = {
    id: crypto.randomUUID(),
    userId,
    title: typeof title === 'string' && title.trim() ? title.trim() : 'New chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  sessions[session.id] = session;
  persist();
  return session;
}

// Update a session's title and/or messages. Scoped to `userId`.
//   - `title`: replaces the title if provided.
//   - `messages`: replaces the full messages array if provided (each
//     message is normalized to { role, content, createdAt, model?, attachments? }).
//   - `appendMessages`: appended after any `messages` replacement, same
//     normalization.
// Returns the updated session, or null if the id doesn't exist or belongs
// to a different user.
function updateSession(id, userId, { title, messages, appendMessages } = {}) {
  const session = sessions[id];
  if (!session || session.userId !== userId) return null;

  if (typeof title === 'string' && title.trim()) {
    session.title = title.trim();
  }
  if (Array.isArray(messages)) {
    session.messages = messages.map(normalizeMessage);
  }
  if (Array.isArray(appendMessages) && appendMessages.length) {
    session.messages.push(...appendMessages.map(normalizeMessage));
  }
  session.updatedAt = new Date().toISOString();

  persist();
  return session;
}

function normalizeMessage(msg) {
  return {
    role: msg.role,
    content: msg.content,
    createdAt: msg.createdAt || new Date().toISOString(),
    // The model that produced an assistant message is display metadata
    // (the UI shows "llama3" as the message author); anything else unknown
    // is dropped.
    ...(typeof msg.model === 'string' && msg.model ? { model: msg.model } : {}),
    ...(msg.attachments !== undefined ? { attachments: msg.attachments } : {}),
  };
}

// Delete a session by id, scoped to `userId`. Returns true if it existed
// (and was owned by `userId`) and was deleted.
function deleteSession(id, userId) {
  const session = sessions[id];
  if (!session || session.userId !== userId) return false;
  delete sessions[id];
  persist();
  return true;
}

module.exports = {
  DATA_FILE,
  listSessions,
  getSession,
  createSession,
  updateSession,
  deleteSession,
};
