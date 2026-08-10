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

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'sessions.json');

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

// List session summaries (no messages), newest-updated first.
function listSessions() {
  return Object.values(sessions)
    .map(toSummary)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

// Get a full session (including messages) by id, or undefined.
function getSession(id) {
  return sessions[id];
}

// Create a new, empty session. `title` defaults to "New chat" if omitted.
function createSession(title) {
  const now = new Date().toISOString();
  const session = {
    id: crypto.randomUUID(),
    title: typeof title === 'string' && title.trim() ? title.trim() : 'New chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  sessions[session.id] = session;
  persist();
  return session;
}

// Update a session's title and/or messages.
//   - `title`: replaces the title if provided.
//   - `messages`: replaces the full messages array if provided (each
//     message is normalized to { role, content, createdAt, attachments? }).
//   - `appendMessages`: appended after any `messages` replacement, same
//     normalization.
// Returns the updated session, or null if the id doesn't exist.
function updateSession(id, { title, messages, appendMessages } = {}) {
  const session = sessions[id];
  if (!session) return null;

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
    ...(msg.attachments !== undefined ? { attachments: msg.attachments } : {}),
  };
}

// Delete a session by id. Returns true if it existed and was deleted.
function deleteSession(id) {
  if (!sessions[id]) return false;
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
