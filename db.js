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

// Search the user's sessions by a case-insensitive substring over the
// title and message contents. Returns the same summaries as listSessions
// (newest-updated first) for every matching session. A linear scan is
// deliberate — fine at the documented scale (see TODO 5.2's storage
// ceiling); no index, no dependency.
function searchSessions(userId, query) {
  const q = String(query).trim().toLowerCase();
  if (!q) return [];
  return Object.values(sessions)
    .filter((s) => s.userId === userId)
    .filter((s) => {
      if (typeof s.title === 'string' && s.title.toLowerCase().includes(q)) return true;
      return (s.messages || []).some(
        (m) => typeof m.content === 'string' && m.content.toLowerCase().includes(q)
      );
    })
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
    // Citations (7.7): the document chunks a document-grounded reply drew
    // from, captured at send time so provenance survives a reload. Shape
    // is enforced client-side (citations.js's citation list); anything
    // that isn't an array of plain objects is dropped rather than stored.
    ...(Array.isArray(msg.citations) && msg.citations.every((c) => c && typeof c === 'object')
      ? { citations: msg.citations.map((c) => ({ ...c })) }
      : {}),
    // Reaction (7.2): a single user-set marker on an assistant reply
    // ('up' | 'down'). Coerced rather than trusted — anything else is
    // dropped, so a hostile PATCH body can't smuggle fields in.
    ...(msg.reaction === 'up' || msg.reaction === 'down' ? { reaction: msg.reaction } : {}),
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

// Full export for the user's own data: every session *including* messages,
// newest-updated first, ready to be served as JSON (GET /api/export). This
// is the "months of history can only be rescued by copying raw files"
// escape hatch (TODO 5.3) — unlike listSessions, which returns summaries
// for the sidebar, this hands back everything the user owns.
function exportSessions(userId) {
  return Object.values(sessions)
    .filter((s) => s.userId === userId)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

// --- Session cleanup (Phase 7.18): retention with a dry-run preview ------
// A session is "old" when its updatedAt predates the cutoff — updatedAt is
// what the sidebar sorts by, so it's the honest "last touched" signal.
// Both functions take an ISO cutoff string the caller computes, keeping
// time out of here (testable without a clock).

function sessionsOlderThan(userId, cutoffIso) {
  const cutoff = new Date(cutoffIso);
  if (Number.isNaN(cutoff.getTime())) return [];
  return Object.values(sessions)
    .filter((s) => s.userId === userId && new Date(s.updatedAt) < cutoff)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

// Preview only: summaries of what a cleanup at this cutoff would delete.
// Session summaries (no messages) keep the response bounded even when the
// user has months of long chats.
function cleanupPreview(userId, cutoffIso, limit) {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : 50;
  return sessionsOlderThan(userId, cutoffIso)
    .slice(0, cap)
    .map(toSummary);
}

// Delete every session of `userId` updated before `cutoffIso`. Returns the
// number deleted. Only ever touches the caller's own sessions, like every
// other mutation here.
function deleteSessionsOlderThan(userId, cutoffIso) {
  const doomed = sessionsOlderThan(userId, cutoffIso);
  for (const s of doomed) delete sessions[s.id];
  if (doomed.length) persist();
  return doomed.length;
}

// --- Per-user auxiliary stores (pinned facts, audit log, share tokens) ---
// These live in a second JSON file so the sessions file keeps its exact
// shape (and its migration/test expectations) untouched.

const AUX_FILE = process.env.AUX_DATA_FILE || path.join(__dirname, 'data', 'aux.json');
const MAX_AUDIT_ENTRIES = 500;
const MAX_PIN_CHARS = 2000;
const MAX_PINS = 200;

let aux = (() => {
  try {
    if (fs.existsSync(AUX_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(AUX_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (err) {
    console.error(`[db] Failed to read ${AUX_FILE}, starting with an empty store: ${err.message}`);
  }
  return {};
})();

function persistAux() {
  const dir = path.dirname(AUX_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpFile = `${AUX_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(aux, null, 2));
  fs.renameSync(tmpFile, AUX_FILE);
}

// --- Pinned facts (F14): short user-pinned statements injected into every
// chat that runs with memory enabled. Scoped per user like sessions.

function listPins(userId) {
  const pins = aux.pins && aux.pins[userId];
  return Array.isArray(pins) ? pins : [];
}

function addPin(userId, text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Pin text must be a non-empty string.');
  if (trimmed.length > MAX_PIN_CHARS) {
    throw new Error(`Pin text must not exceed ${MAX_PIN_CHARS} characters.`);
  }
  if (!aux.pins) aux.pins = {};
  const pins = aux.pins[userId] || [];
  if (pins.length >= MAX_PINS) {
    throw new Error(`At most ${MAX_PINS} pins are kept; delete one first.`);
  }
  const pin = { id: crypto.randomUUID(), text: trimmed, createdAt: new Date().toISOString() };
  pins.push(pin);
  aux.pins[userId] = pins;
  persistAux();
  return pin;
}

function deletePin(userId, id) {
  const pins = (aux.pins && aux.pins[userId]) || [];
  const next = pins.filter((p) => p.id !== id);
  if (next.length === pins.length) return false;
  aux.pins[userId] = next;
  persistAux();
  return true;
}

// --- Audit log (F20): a bounded, local-only record of sensitive actions
// (model pull/delete, session export, share creation). Newest first.

function addAudit(userId, action, detail) {
  if (!aux.audit) aux.audit = {};
  const entries = aux.audit[userId] || [];
  entries.unshift({
    id: crypto.randomUUID(),
    action: String(action).slice(0, 100),
    detail: typeof detail === 'string' ? detail.slice(0, 300) : '',
    at: new Date().toISOString(),
  });
  aux.audit[userId] = entries.slice(0, MAX_AUDIT_ENTRIES);
  persistAux();
}

function listAudit(userId) {
  const entries = aux.audit && aux.audit[userId];
  return Array.isArray(entries) ? entries : [];
}

// --- Share tokens (F10): an unguessable token that renders one session
// read-only, without login. The token maps to (sessionId, userId); reads
// through it never expose anything but that one session's messages.

function createShareToken(sessionId, userId) {
  const session = sessions[sessionId];
  if (!session || session.userId !== userId) return null;
  if (!aux.shares) aux.shares = {};
  // One token per session: re-sharing replaces the old token so a leaked
  // link can be revoked simply by sharing again.
  for (const [token, share] of Object.entries(aux.shares)) {
    if (share.sessionId === sessionId && share.userId === userId) delete aux.shares[token];
  }
  const token = crypto.randomBytes(24).toString('base64url');
  aux.shares[token] = { sessionId, userId, createdAt: new Date().toISOString() };
  persistAux();
  return token;
}

function getSessionByShareToken(token) {
  const share = aux.shares && aux.shares[token];
  if (!share) return null;
  const session = sessions[share.sessionId];
  if (!session) return null;
  return { title: session.title, messages: session.messages, createdAt: session.createdAt };
}

// --- Webhooks (TODO 7.15): per-user HTTP hooks fired on app events -------
// Config only lives here; firing (with its SSRF guard) is server.js's job.
// Per-user scoped like every other aux store.

const MAX_WEBHOOKS = 20;
const WEBHOOK_EVENTS = ['model.pull', 'session.create'];
const MAX_WEBHOOK_URL_CHARS = 500;

function listWebhooks(userId) {
  const hooks = aux.webhooks && aux.webhooks[userId];
  return Array.isArray(hooks) ? hooks : [];
}

function addWebhook(userId, { name, url, events }) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('Webhook name must be a non-empty string.');
  if (trimmedName.length > 100) throw new Error('Webhook name must not exceed 100 characters.');
  const trimmedUrl = String(url || '').trim();
  if (!trimmedUrl) throw new Error('Webhook URL must be a non-empty string.');
  if (trimmedUrl.length > MAX_WEBHOOK_URL_CHARS) {
    throw new Error(`Webhook URL must not exceed ${MAX_WEBHOOK_URL_CHARS} characters.`);
  }
  const eventList = Array.isArray(events) ? events.filter((e) => WEBHOOK_EVENTS.includes(e)) : [];
  if (!eventList.length) {
    throw new Error(`Pick at least one event to trigger on (${WEBHOOK_EVENTS.join(', ')}).`);
  }
  if (!aux.webhooks) aux.webhooks = {};
  const hooks = aux.webhooks[userId] || [];
  if (hooks.length >= MAX_WEBHOOKS) {
    throw new Error(`At most ${MAX_WEBHOOKS} webhooks are kept; delete one first.`);
  }
  const webhook = {
    id: crypto.randomUUID(),
    name: trimmedName,
    url: trimmedUrl,
    events: [...new Set(eventList)],
    createdAt: new Date().toISOString(),
  };
  hooks.push(webhook);
  aux.webhooks[userId] = hooks;
  persistAux();
  return webhook;
}

function deleteWebhook(userId, id) {
  const hooks = (aux.webhooks && aux.webhooks[userId]) || [];
  const next = hooks.filter((w) => w.id !== id);
  if (next.length === hooks.length) return false;
  aux.webhooks[userId] = next;
  persistAux();
  return true;
}

// The webhooks due to fire for one event, resolved to a plain array copy —
// callers hand it to async fire logic and must not observe later mutations.
function webhooksForEvent(userId, event) {
  return listWebhooks(userId)
    .filter((w) => w.events.includes(event))
    .map((w) => ({ ...w }));
}

module.exports = {
  DATA_FILE,
  listSessions,
  searchSessions,
  getSession,
  createSession,
  updateSession,
  deleteSession,
  exportSessions,
  sessionsOlderThan,
  cleanupPreview,
  deleteSessionsOlderThan,
  listPins,
  addPin,
  deletePin,
  listWebhooks,
  addWebhook,
  deleteWebhook,
  webhooksForEvent,
  WEBHOOK_EVENTS,
  addAudit,
  listAudit,
  createShareToken,
  getSessionByShareToken,
};
