const express = require('express');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const auth = require('./auth');
const logger = require('./logger');
const metrics = require('./metrics');
const qdrant = require('./qdrant');
const embeddings = require('./embeddings');
const { compactMessages, DEFAULTS: COMPACTION_DEFAULTS, MARKER: COMPACTION_MARKER } = require('./compaction');
const { citationsFromResults } = require('./citations');

const app = express();
const PORT = process.env.PORT || 4173;
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

// Optional game bridge credential (Slice 1, F19). When set, the Local Theft
// Auto game (Unity port) authenticates to POST /api/game-npc with
// `Authorization: Bearer <LTA_GAME_TOKEN>` instead of a user session. It is
// a synthetic user that is ONLY valid for the game-npc endpoint — every
// other /api/* route still 401s (see the auth gate below). Unset, nothing
// changes: cookie and API-token auth behave exactly as before.
const LTA_GAME_TOKEN = process.env.LTA_GAME_TOKEN;

// Multi-server support (F16): a comma-separated OLLAMA_HOSTS env var lists
// extra Ollama instances (e.g. "work-laptop:11434,home-server:11434"). The
// first entry is the primary; every client-visible server gets a stable
// index clients pass back as `serverId`. Only these exact URLs are ever
// proxied to — a request naming an unknown server falls back to the
// primary rather than becoming an SSRF primitive.
const OLLAMA_SERVERS = (process.env.OLLAMA_HOSTS || OLLAMA_HOST)
  .split(',')
  .map((h) => h.trim().replace(/\/+$/, ''))
  .filter(Boolean);

function resolveOllamaHost(serverId) {
  if (serverId === undefined || serverId === null || serverId === '') return OLLAMA_SERVERS[0];
  const idx = Number(serverId);
  return Number.isInteger(idx) && idx >= 0 && idx < OLLAMA_SERVERS.length
    ? OLLAMA_SERVERS[idx]
    : OLLAMA_SERVERS[0];
}

// Request logging + metrics. Registered first so it wraps every route,
// including the streaming ones below. It never buffers or rewrites the
// response body — it only attaches a response header and a 'finish'
// listener — so it can't interfere with streaming. It never logs request
// or response bodies (chat content must never end up in logs), only
// method/path/status/duration/request-id.
app.use((req, res, next) => {
  const requestId = crypto.randomBytes(6).toString('hex');
  res.setHeader('X-Request-Id', requestId);
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    // Prefer the matched route pattern (e.g. "/api/models/:name") over the
    // raw path so metrics/logs don't fragment per model name; falls back to
    // the raw path for unmatched routes (404s).
    const route = (req.route && req.baseUrl + req.route.path) || req.path;

    logger.info(
      `${req.method} ${route} ${res.statusCode} ${durationMs.toFixed(1)}ms id=${requestId}`
    );
    metrics.record({ route, method: req.method, status: res.statusCode, durationMs });
  });

  next();
});

// Chat compaction settings — see README.md "Chat compaction" section.
const COMPACTION_MAX_MESSAGES = Number(process.env.COMPACTION_MAX_MESSAGES) || COMPACTION_DEFAULTS.maxMessages;
const COMPACTION_MAX_CHARS = Number(process.env.COMPACTION_MAX_CHARS) || COMPACTION_DEFAULTS.maxChars;
const COMPACTION_KEEP_RECENT = Number(process.env.COMPACTION_KEEP_RECENT) || COMPACTION_DEFAULTS.keepRecent;
const COMPACTION_MODEL = process.env.COMPACTION_MODEL || null;

// Size caps for /api/sessions/:id PATCH bodies, beyond the global 10mb JSON
// limit — bounds how large a single session/title/message can grow.
const MAX_SESSION_TITLE_CHARS = 200;
const MAX_SESSION_MESSAGES = 1000;
const MAX_MESSAGE_CONTENT_CHARS = 1000000;

// Batch/size caps for /api/memory/index.
const MAX_MEMORY_BATCH = 100;
const MAX_MEMORY_TEXT_CHARS = 100000;

// Semantic-memory retrieval for /api/chat, behind the opt-in `useMemory`
// request flag. Top-k excerpts are injected as one system message and the
// completed turn is auto-indexed afterwards; both paths fail open (see
// /api/chat below) so a Qdrant/embeddings outage never breaks normal chat.
const MEMORY_TOP_K = Number(process.env.MEMORY_TOP_K) || 5;
const MEMORY_TIMEOUT_MS = Number(process.env.MEMORY_TIMEOUT_MS) || 3000;
const MEMORY_MARKER = '[retrieved-memory]';

// Ollama's non-streaming summarization call (below) has no inherent
// timeout; without one, a hung Ollama would stall the otherwise-streaming
// /api/chat request indefinitely before the real response even starts.
const COMPACTION_TIMEOUT_MS = Number(process.env.COMPACTION_TIMEOUT_MS) || 30000;

// Calls Ollama's non-streaming chat endpoint to produce a concise summary
// of a slice of older messages. Injected into compactMessages() so the
// compaction logic itself stays free of any HTTP/Ollama specifics.
async function summarizeWithOllama(messagesToSummarize, model) {
  const summaryModel = COMPACTION_MODEL || model;
  let r;
  try {
    r = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: summaryModel,
        stream: false,
        messages: [
          {
            role: 'system',
            content:
              'Summarize the following conversation turns concisely and factually. ' +
              'Capture key facts, decisions made, and any unresolved questions. ' +
              'Do not add commentary or restate this instruction; output only the summary.',
          },
          ...messagesToSummarize,
        ],
      }),
      signal: AbortSignal.timeout(COMPACTION_TIMEOUT_MS),
    });
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new Error(`Ollama summarization timed out after ${COMPACTION_TIMEOUT_MS}ms.`, { cause: err });
    }
    throw err;
  }
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Ollama summarization request failed (status ${r.status}): ${text}`);
  }
  const data = await r.json();
  return (data && data.message && data.message.content) || '';
}

// Host-header guard. A page on another origin can make this server's
// cookie-authenticated endpoints fire cross-origin via DNS rebinding (the
// browser resolves a hostile domain to 127.0.0.1 and the cookie rides
// along). Rejecting any Host outside loopback closes that; additional
// hosts — e.g. a LAN hostname so another machine can reach the app — go in
// HOST_ALLOWLIST as a comma-separated list.
const HOST_ALLOWLIST = new Set(
  (process.env.HOST_ALLOWLIST || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
);

function isAllowedHost(hostHeader) {
  if (typeof hostHeader !== 'string' || !hostHeader.trim()) return false;
  let host = hostHeader.trim().toLowerCase();
  // Strip the port. IPv6 arrives bracketed ("[::1]:4173"); for anything
  // else only strip a trailing :port when the remainder is colon-free, so
  // an unbracketed "::1" survives intact.
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end !== -1) host = host.slice(1, end);
  } else {
    const m = /^(.+):(\d+)$/.exec(host);
    if (m && !m[1].includes(':')) host = m[1];
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '::ffff:127.0.0.1') {
    return true;
  }
  return HOST_ALLOWLIST.has(host);
}

// Registered right after request logging (so rejections are still logged)
// and before cookie parsing / every route, including static files.
app.use((req, res, next) => {
  if (!isAllowedHost(req.headers.host)) {
    return res.status(403).json({
      error: `Host "${req.headers.host || '(missing)'}" is not allowed. Add it to HOST_ALLOWLIST if this is intentional.`,
    });
  }
  next();
});

app.use(express.json({ limit: '10mb' }));

// --- Auth (local, SQLite-backed) ---------------------------------------
// No cookie-parser dependency: cookies are simple enough to parse by hand,
// and this keeps the project's minimal-deps footprint (see db.js).

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (name) {
      // decodeURIComponent throws URIError on malformed percent-encoding
      // (e.g. `Cookie: sid=%`); a single hostile cookie header must not turn
      // every request into a 500, so skip the malformed pair instead.
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        // Intentionally empty: a bad value is indistinguishable from absent.
      }
    }
  }
  return cookies;
}

function setSessionCookie(res, token, expiresAt) {
  const parts = [
    `${auth.SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
  ];
  // Only mark the cookie Secure when actually served over HTTPS — this app
  // runs over plain HTTP on localhost by default, and Secure would stop
  // the browser from ever sending the cookie back in that case.
  if (process.env.COOKIE_SECURE === '1') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${auth.SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
  );
}

// Attaches req.user (or leaves it undefined) based on the session cookie —
// or, for scripts, an `Authorization: Bearer <token>` API token (7.14).
// The cookie wins when both are present; a bearer token is only ever an
// API path (page routes need the cookie flow), and an invalid one is
// simply ignored so the auth gate answers 401 as usual.
//
// Third credential: LTA_GAME_TOKEN (F19). A secret that, when set in the
// environment, lets the Local Theft Auto game call POST /api/game-npc with
// a synthetic user that the auth gate admits ONLY on that one route
// (see the gate below). Compared with timingSafeEqual to keep the match
// constant-time against timing probes. LTA_GAME_TOKEN itself is read once
// at the top of this file.
const LTA_GAME_ROUTE = '/api/game-npc';
function bearerGameToken(req) {
  if (!LTA_GAME_TOKEN) return false;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice('Bearer '.length).trim());
  const expected = Buffer.from(LTA_GAME_TOKEN);
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}
app.use((req, res, next) => {
  const cookies = parseCookies(req);
  const token = cookies[auth.SESSION_COOKIE];
  req.sessionToken = token;
  req.user = token ? auth.getUserBySessionToken(token) : null;
  if (!req.user) {
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ') && req.path.startsWith('/api/')) {
      req.user = auth.getUserByApiToken(header.slice('Bearer '.length).trim());
    }
  }
  if (!req.user && bearerGameToken(req)) {
    req.user = { id: 'lta-game', synthetic: true };
  }
  next();
});

// Simple in-memory fixed-window rate limiter, keyed by client IP. Guards
// the auth endpoints (brute-forcing a password, or hammering signup to
// fill the users table) and the model-management / memory-index routes
// (pulling is expensive on the host, and indexing should stay bounded).
// Deliberately dependency-free (see db.js for why this project avoids
// adding packages for small needs); resets on restart, which is fine for
// its purpose.
function rateLimiter({ windowMs, max }) {
  const hits = new Map(); // ip -> [timestamps]
  let lastSweep = 0;
  const middleware = (req, res, next) => {
    const now = Date.now();
    // Opportunistic sweep, at most once per window: a key whose last request
    // is long gone would otherwise sit in `hits` forever, so `hits` grows
    // without bound as clients churn. The sweep is cheap here (the map only
    // ever holds one entry per IP) and evicts dormant keys on the next
    // request after their window drains.
    if (now - lastSweep > windowMs) {
      lastSweep = now;
      for (const [key, stamps] of hits) {
        const alive = stamps.filter((t) => now - t < windowMs);
        if (alive.length > 0) hits.set(key, alive);
        else hits.delete(key);
      }
    }
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const timestamps = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (timestamps.length >= max) {
      const retryAfterSec = Math.ceil((windowMs - (now - timestamps[0])) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({ error: 'Too many attempts. Please wait and try again.' });
    }
    timestamps.push(now);
    hits.set(ip, timestamps);
    next();
  };
  // Test-only handle: lets the suite assert eviction without a clock.
  middleware.hits = hits;
  return middleware;
}

const authRateLimiter = rateLimiter({ windowMs: 5 * 60 * 1000, max: 10 });

// Looser limits for the model-management and memory routes: pulling a
// model downloads gigabytes onto the host (the most expensive action this
// app can trigger), deleting is destructive, and memory indexing embeds +
// upserts per item. All still bounded, just less aggressively than auth.
const modelPullRateLimiter = rateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });
const modelDeleteRateLimiter = rateLimiter({ windowMs: 5 * 60 * 1000, max: 10 });
const memoryIndexRateLimiter = rateLimiter({ windowMs: 5 * 60 * 1000, max: 20 });

// Signup: create a user and immediately log them in (sets the session
// cookie), same as most local-first apps' first-run flow.
app.post('/api/auth/signup', authRateLimiter, (req, res) => {
  const { username, password } = req.body || {};
  try {
    const user = auth.createUser(username, password);
    const { token, expiresAt } = auth.createSession(user.id);
    setSessionCookie(res, token, expiresAt);
    res.status(201).json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', authRateLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Missing "username" or "password".' });
  }
  // Per-username+IP lockout (see auth.js): the per-IP limiter above can't
  // see a single-username spray from many IPs, or a many-username spray
  // that stays under the per-IP cap. Check before touching the DB so a
  // locked pair burns no scrypt work either.
  const lock = auth.loginLockRemaining(username, req.ip || req.socket.remoteAddress);
  if (lock) {
    res.setHeader('Retry-After', String(lock.retryAfterSec));
    return res.status(429).json({ error: 'Too many failed attempts for this account. Please wait and try again.' });
  }
  const user = auth.verifyUser(username, password);
  if (!user) {
    auth.recordLoginFailure(username, req.ip || req.socket.remoteAddress);
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  // Successful login clears the pair's history so spaced-out failures
  // never accumulate into a lock.
  auth.clearLoginFailures(username, req.ip || req.socket.remoteAddress);
  const { token, expiresAt } = auth.createSession(user.id);
  setSessionCookie(res, token, expiresAt);
  res.json({ user });
});

app.post('/api/auth/logout', (req, res) => {
  if (req.sessionToken) auth.deleteSession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.user || null });
});

// --- Shared chat links (F10) ---------------------------------------------
// Public, token-gated, read-only view of a single session. Registered
// BEFORE the auth gate below: the token is the credential, and the only
// thing it ever returns is that one session's title and messages.

app.get('/api/share/:token', (req, res) => {
  try {
    const session = db.getSessionByShareToken(req.params.token);
    if (!session) return res.status(404).json({ error: 'This share link is invalid or was revoked.' });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Everything below this point (both pages and API routes) requires a
// logged-in session, except the static assets needed to render the
// login/signup pages themselves and the /api/auth/* routes above.
const PUBLIC_ASSETS = new Set(['/login.html', '/signup.html', '/auth.js', '/style.css', '/share.html', '/chat-helpers.js']);

app.get(['/', '/index.html'], (req, res, next) => {
  if (!req.user) return res.redirect('/login.html');
  next();
});

app.use((req, res, next) => {
  // Self-hosted fonts are referenced by style.css's @font-face rules, and
  // style.css itself is public (needed to render the login/signup pages
  // before a session exists) — so the font files it points at must be
  // public too, or the login/signup pages would render with the fallback
  // system font instead of the ones actually declared.
  const isPublicFont = req.path.startsWith('/fonts/') && req.path.endsWith('.woff2');
  // The synthetic game bridge user (LTA_GAME_TOKEN) is admitted ONLY on the
// game NPC route; every other /api/* path still answers 401 for it.
if (req.user && req.user.synthetic && req.path !== LTA_GAME_ROUTE) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  if (req.user || req.path.startsWith('/api/auth/') || PUBLIC_ASSETS.has(req.path) || isPublicFont) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  res.redirect('/login.html');
});

app.use(express.static(path.join(__dirname, 'public')));

// Simple health check that also verifies Ollama is reachable.
app.get('/api/health', async (_req, res) => {
  try {
    const r = await fetch(`${OLLAMA_HOST}/api/version`);
    if (!r.ok) throw new Error(`status ${r.status}`);
    const data = await r.json();
    res.json({ ok: true, ollama: data });
  } catch (err) {
    res.status(503).json({ ok: false, error: `Cannot reach Ollama at ${OLLAMA_HOST}: ${err.message}` });
  }
});

// In-memory observability snapshot: per-route request counts/latencies,
// total requests, total upstream (Ollama) error count, uptime, and memory.
app.get('/api/metrics', (_req, res) => {
  res.json(metrics.snapshot());
});

// --- Model health (7.10) ---------------------------------------------------
// One aggregate snapshot for the dashboard: Ollama version, installed
// models with on-disk size, currently loaded models with VRAM/RAM figures
// (Ollama's /api/ps), and this account's pull history from the audit log.
// Read-only and cheap; failures degrade per-section rather than 500-ing
// the whole snapshot.

app.get('/api/models/health', async (req, res) => {
  const out = { ollama: null, installed: [], loaded: [], pulls: [] };

  const [versionRes, tagsRes, psRes] = await Promise.allSettled([
    fetch(`${OLLAMA_HOST}/api/version`, { signal: AbortSignal.timeout(5000) }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`)))),
    fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(5000) }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`)))),
    fetch(`${OLLAMA_HOST}/api/ps`, { signal: AbortSignal.timeout(5000) }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`)))),
  ]);

  if (versionRes.status === 'fulfilled') out.ollama = versionRes.value;
  if (tagsRes.status === 'fulfilled') {
    out.installed = (tagsRes.value.models || []).map((m) => ({
      name: m.name,
      size: m.size || null,
      parameterSize: (m.details && m.details.parameter_size) || null,
      quantization: (m.details && m.details.quantization_level) || null,
      modifiedAt: m.modified_at || null,
    }));
  }
  if (psRes.status === 'fulfilled') {
    out.loaded = (psRes.value.models || []).map((m) => ({
      name: m.name,
      size: m.size || null,
      sizeVram: m.size_vram || 0,
      expiresAt: m.expires_at || null,
      contextLength: (m.context_window ?? null),
    }));
  }
  // Pull history is the account's own audit trail — newest first, capped.
  out.pulls = db
    .listAudit(req.user.id)
    .filter((e) => e.action === 'model.pull')
    .slice(0, 20);

  res.json(out);
});

// List locally installed models.
app.get('/api/models', async (_req, res) => {
  try {
    const r = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!r.ok) throw new Error(`status ${r.status}`);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(503).json({ error: `Cannot reach Ollama at ${OLLAMA_HOST}: ${err.message}` });
  }
});

// Show info for a given model (params, template, etc.)
app.post('/api/show', async (req, res) => {
  const { model } = req.body || {};
  if (typeof model !== 'string' || !model.trim()) {
    return res.status(400).json({ error: 'Missing "model" in request body.' });
  }
  try {
    const r = await fetch(`${OLLAMA_HOST}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// Streaming chat proxy. Forwards newline-delimited JSON chunks from Ollama
// straight through to the browser as they arrive.
// Shape check shared by /api/sessions/:id PATCH and /api/chat: every
// message must carry a string "role" and a string "content".
// A chat message is valid if role/content are strings and — when present —
// `images` is an array of non-empty base64 strings (Ollama's vision input
// shape; empty strings would be forwarded upstream and rejected by Ollama
// with an opaque error, so they're rejected here with a clear one).
const isValidImages = (imgs) => Array.isArray(imgs) && imgs.length > 0
  && imgs.every((i) => typeof i === 'string' && i.length > 0);
const isValidMessage = (m) => m
  && typeof m === 'object'
  && typeof m.role === 'string'
  && typeof m.content === 'string'
  && (m.images === undefined || isValidImages(m.images));

// Race a memory retrieval promise against MEMORY_TIMEOUT_MS. Neither
// embeddings.embed nor qdrant.searchByVector accepts an abort signal, so
// the timeout here only bounds how long /api/chat waits — a hung call is
// simply ignored rather than cancelled.
async function raceWithMemoryTimeout(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Memory retrieval timed out after ${MEMORY_TIMEOUT_MS}ms`)),
          MEMORY_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Inject a memory system message into the outgoing messages array. If a
// compacted-summary message leads the array, the memory goes right after it
// so the summary stays first; compaction.js's marker scan runs from the end
// and only recognizes its own MARKER prefix, so the memory message never
// displaces or shadows an existing summary either way.
function injectMemoryMessage(messages, memoryContent) {
  const memoryMessage = { role: 'system', content: memoryContent };
  if (
    messages.length > 0 &&
    messages[0].role === 'system' &&
    typeof messages[0].content === 'string' &&
    messages[0].content.startsWith(COMPACTION_MARKER)
  ) {
    return [messages[0], memoryMessage, ...messages.slice(1)];
  }
  return [memoryMessage, ...messages];
}

// Shared plumbing for the two ndjson streaming proxies (/api/chat and
// /api/pull): fetches the upstream Ollama endpoint with an abort signal tied
// to the client connection (browser aborts tear the upstream request down),
// validates the response, sets the ndjson headers, and pumps chunks through
// with an EPIPE guard. Routes customize via `onChunk`/`onDone` observers —
// e.g. /api/chat accumulates the assistant reply for memory auto-indexing.
// Returns { aborted: true } if the client hung up before the upstream
// request was even made; upstream/status errors are answered on `res`
// directly.
async function pipeUpstreamNdjson({ res, path: upstreamPath, body, onChunk, onDone, host }) {
  const upstreamHost = host || OLLAMA_HOST;
  const upstreamController = new AbortController();
  res.on('close', () => upstreamController.abort());

  let upstream;
  try {
    upstream = await fetch(`${upstreamHost}${upstreamPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: upstreamController.signal,
    });
  } catch (err) {
    if (upstreamController.signal.aborted) {
      if (!res.writableEnded) res.end();
      return { aborted: true };
    }
    res.status(503).json({ error: `Cannot reach Ollama at ${upstreamHost}: ${err.message}` });
    return { failed: true };
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    res.status(upstream.status || 502).json({ error: text || 'Upstream error from Ollama.' });
    return { failed: true };
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  // If the client goes away mid-stream, writing further chunks can raise an
  // EPIPE/ECONNRESET 'error' event on the response; without a listener that
  // would bubble up as an unhandled exception and crash the process.
  res.on('error', () => {});

  const reader = upstream.body.getReader();
  res.on('close', () => reader.cancel().catch(() => {}));

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
      if (onChunk) onChunk(value);
    }
  } catch (err) {
    // Client likely disconnected or upstream dropped; nothing more to do.
  } finally {
    if (onDone) onDone();
    if (!res.writableEnded) res.end();
  }
  return { streamed: true };
}

app.post('/api/chat', async (req, res) => {
  const { model, messages, options, keep_alive, useMemory, useDocuments, serverId } = req.body || {};

  if (!model) return res.status(400).json({ error: 'Missing "model" in request body.' });
  if (!Array.isArray(messages)) return res.status(400).json({ error: '"messages" must be an array.' });
  if (!messages.every(isValidMessage)) {
    return res.status(400).json({ error: 'Each item in "messages" must have string "role" and "content".' });
  }

  // Pre-process the outgoing messages: if the conversation has grown too
  // large, fold older turns into a compact summary before forwarding to
  // Ollama. This is purely a transformation of the `messages` array sent
  // upstream — it does not touch or alter the streaming response below.
  const compactedMessages = await compactMessages({
    messages,
    keepRecent: COMPACTION_KEEP_RECENT,
    maxMessages: COMPACTION_MAX_MESSAGES,
    maxChars: COMPACTION_MAX_CHARS,
    summarize: (msgs) => summarizeWithOllama(msgs, model),
  });

  // compactMessages() returns the original array reference untouched when
  // it decides not to compact (or when summarization fails open), so an
  // identity check is exactly "did older turns get folded into a summary".
  // Surfaced as a response header so the UI can tell the user their
  // earlier context was summarized rather than silently dropped.
  const wasCompacted = compactedMessages !== messages;

  // Opt-in semantic memory retrieval (useMemory). Embed the latest user
  // message, search this user's indexed memory, and inject the top-k
  // excerpts as one system message. Entirely fail-open, mirroring
  // compaction: any retrieval failure — Qdrant down, embeddings model
  // missing, timeout — is logged and the chat proceeds without memory.
  let messagesToSend = compactedMessages;
  // Raw retrieval hits, kept for the citation header (7.7) — populated on
  // every successful retrieval, but only surfaced to the client when the
  // request was document-grounded (useDocuments), where provenance is the
  // point. Plain memory excerpts are the user's own past chats; a citation
  // list there would be noise.
  let retrievalResults = null;
  const lastUser = [...messages].reverse().find((m) => m.role === 'user' && m.content.trim());
  if (useMemory === true && req.user && lastUser) {
    // Pinned facts (F14) always lead the memory system message: the user
    // pinned them deliberately, so they outrank statistical similarity.
    try {
      const pins = db.listPins(req.user.id);
      if (pins.length) {
        const pinContent = `${MEMORY_MARKER} Facts the user has pinned for every conversation:\n`
          + pins.map((p) => `- ${p.text}`).join('\n');
        messagesToSend = injectMemoryMessage(messagesToSend, pinContent);
      }
    } catch (err) {
      console.warn('[memory] pin injection failed, continuing:', err && err.message ? err.message : err);
    }
    try {
      const results = await raceWithMemoryTimeout((async () => {
        const vector = await embeddings.embed(lastUser.content);
        // useDocuments (F3) scopes retrieval to indexed documents instead of
        // past chat turns. Document points always carry kind='document'; the
        // default path excludes them via must_not so legacy points (indexed
        // before kinds existed, no kind field) keep matching past chats.
        const kindFilter = useDocuments === true
          ? { must: [{ key: 'kind', match: { value: 'document' } }] }
          : { must_not: [{ is_null: { key: 'kind' } }, { key: 'kind', match: { value: 'document' } }] };
        return qdrant.searchByVector(vector, {
          limit: MEMORY_TOP_K,
          filter: {
            must: [{ key: 'userId', match: { value: req.user.id } }],
            ...kindFilter,
          },
        });
      })());
      retrievalResults = Array.isArray(results) ? results : [];
      const excerpts = retrievalResults
        .map((r) => r && r.payload && r.payload.text)
        .filter((t) => typeof t === 'string' && t.trim())
        .map((t) => `- ${t.length > 2000 ? `${t.slice(0, 2000)}…` : t}`);
      if (excerpts.length > 0) {
        const memoryContent = `${MEMORY_MARKER} Earlier messages from this user's past chats that look relevant `
          + 'to the latest question (semantic search; may be imperfect):\n'
          + excerpts.join('\n');
        messagesToSend = injectMemoryMessage(messagesToSend, memoryContent);
      }
    } catch (err) {
      console.warn('[memory] retrieval failed, continuing without memory:', err && err.message ? err.message : err);
    }
  }

  // The streaming plumbing (fetch, ndjson headers, chunk pump) is shared
  // with /api/pull via pipeUpstreamNdjson. This route only supplies the
  // memory-specific observers: onChunk accumulates the assistant's reply
  // from the ndjson stream (parse errors are ignored — indexing is
  // best-effort) so the completed turn can be auto-indexed below, exactly
  // like a manual /api/memory/index call would.
  const memoryDecoder = useMemory === true || useDocuments === true ? new TextDecoder() : null;
  let ndjsonBuffer = '';
  let assistantText = '';
  const autoIndexCompletedTurn = () => {
    if (useMemory !== true || !req.user) return;
    const items = [{ text: lastUser.content, metadata: { role: 'user', kind: 'message' } }];
    if (assistantText.trim()) items.push({ text: assistantText, metadata: { role: 'assistant', kind: 'message' } });
    indexMemoryItems(items, req.user.id).catch((err) => {
      console.warn('[memory] auto-index failed:', err && err.message ? err.message : err);
    });
  };

  // X-Compacted must be set before the first byte is written, which
  // pipeUpstreamNdjson does only after its own setHeader calls — but the
  // header is set here (before the call) so the helper stays response-shape
  // agnostic.
  if (wasCompacted) res.setHeader('X-Compacted', 'true');

  // Citations (7.7): when the reply was grounded in indexed documents, the
  // retrieved chunks ride back in an X-Citations header (base64 — snippets
  // are arbitrary text and headers must stay latin-1). Set here, before the
  // first byte, for the same reason as X-Compacted. Only sent on completed
  // retrievals; a failed retrieval fails open with no header at all.
  if (useDocuments === true && retrievalResults) {
    const citations = citationsFromResults(retrievalResults);
    if (citations.length) {
      res.setHeader('X-Citations', Buffer.from(JSON.stringify(citations), 'utf8').toString('base64'));
    }
  }

  await pipeUpstreamNdjson({
    res,
    path: '/api/chat',
    body: { model, messages: messagesToSend, options, keep_alive, stream: true },
    host: resolveOllamaHost(serverId),
    onChunk:
      memoryDecoder
        ? (value) => {
            ndjsonBuffer += memoryDecoder.decode(value, { stream: true });
            const lines = ndjsonBuffer.split('\n');
            ndjsonBuffer = lines.pop();
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const obj = JSON.parse(line);
                if (obj && obj.message && typeof obj.message.content === 'string') {
                  assistantText += obj.message.content;
                }
              } catch {
                // Partial or malformed line — indexing is best-effort; skip it.
              }
            }
          }
        : undefined,
    onDone: autoIndexCompletedTurn,
  });
});

// List every configured Ollama server (F16 multi-server). The index a
// client sees here is the `serverId` it passes back on /api/chat.
app.get('/api/servers', (req, res) => {
  res.json({
    servers: OLLAMA_SERVERS.map((url, id) => ({ id, url })),
    active: 0,
  });
});

// --- Pinned facts (F14) -------------------------------------------------
// Short user-pinned statements injected into every memory-enabled chat.
// Same per-user scoping as the session routes.

app.get('/api/pins', (req, res) => {
  try {
    res.json({ pins: db.listPins(req.user.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pins', (req, res) => {
  const { text } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Missing "text" in request body.' });
  }
  try {
    res.status(201).json(db.addPin(req.user.id, text));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/pins/:id', (req, res) => {
  try {
    if (!db.deletePin(req.user.id, req.params.id)) {
      return res.status(404).json({ error: `No pin with id "${req.params.id}".` });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- API tokens (7.14) ----------------------------------------------------
// Personal keys for script access (`Authorization: Bearer oc_...`) on any
// /api/* route. CRUD only — the secret is shown exactly once at creation,
// and listing never returns it. Rate-limited (they gate auth) and audited
// like the other sensitive actions.

const apiTokenRateLimiter = rateLimiter({ windowMs: 5 * 60 * 1000, max: 20 });

app.get('/api/tokens', apiTokenRateLimiter, (req, res) => {
  try {
    res.json({ tokens: auth.listApiTokens(req.user.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tokens', apiTokenRateLimiter, (req, res) => {
  const { name } = req.body || {};
  try {
    const token = auth.createApiToken(req.user.id, name);
    db.addAudit(req.user.id, 'token.create', token.name);
    // 201 with the one-time secret; every later read shows only the prefix.
    res.status(201).json(token);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/tokens/:id', apiTokenRateLimiter, (req, res) => {
  try {
    if (!auth.deleteApiToken(req.user.id, req.params.id)) {
      return res.status(404).json({ error: `No token with id "${req.params.id}".` });
    }
    db.addAudit(req.user.id, 'token.delete', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Webhooks (7.15) -------------------------------------------------------
// Per-user HTTP hooks fired on app events (model pull finished, new session
// created). Same SSRF posture as /api/summarize-url — a webhook URL is a
// client-supplied destination, so it only speaks http(s), refuses embedded
// credentials, must resolve to a public address (checked at every fire,
// since DNS can change after the config was saved), and never follows
// redirects. Firing is fire-and-forget: a slow or dead receiver must never
// delay the user's own action. WEBHOOK_ALLOW_PRIVATE=1 skips the
// public-address check — a documented escape hatch for pointing hooks at
// local receivers (and used by the test suite).

// test escape hatch for local receivers (see the section comment above).
const WEBHOOK_ALLOW_PRIVATE = process.env.WEBHOOK_ALLOW_PRIVATE === '1';

async function webhookUrlAllowed(hostname) {
  if (WEBHOOK_ALLOW_PRIVATE) return;
  await assertPublicHost(hostname);
}

const WEBHOOK_FIRE_TIMEOUT_MS = Number(process.env.WEBHOOK_FIRE_TIMEOUT_MS) || 5000;

app.get('/api/webhooks', (req, res) => {
  res.json({ webhooks: db.listWebhooks(req.user.id), events: db.WEBHOOK_EVENTS });
});

app.post('/api/webhooks', async (req, res) => {
  const { name, url, events } = req.body || {};
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    return res.status(400).json({ error: 'Invalid "url".' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return res.status(400).json({ error: 'Only http(s) webhook URLs are supported.' });
  }
  if (parsed.username || parsed.password) {
    return res.status(400).json({ error: 'Webhook URLs with embedded credentials are not supported.' });
  }
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Missing "name" in request body.' });
  }
  try {
    await webhookUrlAllowed(parsed.hostname);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    const webhook = db.addWebhook(req.user.id, { name, url: parsed.href, events });
    db.addAudit(req.user.id, 'webhook.create', webhook.name);
    res.status(201).json(webhook);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/webhooks/:id', (req, res) => {
  try {
    if (!db.deleteWebhook(req.user.id, req.params.id)) {
      return res.status(404).json({ error: `No webhook with id "${req.params.id}".` });
    }
    db.addAudit(req.user.id, 'webhook.delete', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delivery probe so the user can verify a receiver works without doing a
// real pull or creating a chat. Runs the exact production path (same
// guards, same payload shape) with a synthetic event.
app.post('/api/webhooks/:id/test', async (req, res) => {
  const webhook = db.listWebhooks(req.user.id).find((w) => w.id === req.params.id);
  if (!webhook) return res.status(404).json({ error: `No webhook with id "${req.params.id}".` });
  const outcome = await fireWebhook(webhook, 'webhook.test', { name: webhook.name, synthetic: true });
  res.json(outcome);
});

// Fire-and-forget delivery to one webhook. Everything is bounded: no
// redirect following, a hard timeout, a tiny response read. Returns a
// plain outcome object — never throws — because callers (the test route
// answers with it; the event hooks below only log it).
async function fireWebhook(webhook, event, payload) {
  let parsed;
  try {
    parsed = new URL(webhook.url);
  } catch {
    return { ok: false, error: 'invalid stored URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'unsupported protocol' };
  }
  try {
    await webhookUrlAllowed(parsed.hostname);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  try {
    const r = await fetch(parsed.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'ollama-chat-webhook/1.0' },
      body: JSON.stringify({ event, at: new Date().toISOString(), payload }),
      redirect: 'error',
      signal: AbortSignal.timeout(WEBHOOK_FIRE_TIMEOUT_MS),
    });
    await r.text().catch(() => '');
    return { ok: r.ok, status: r.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Deliver an event to every webhook subscribed to it. Runs detached from
// the request that caused the event (Promise, no await): a webhook outage
// must never delay a pull or a chat creation. Failures are logged and
// otherwise swallowed.
function dispatchWebhookEvent(userId, event, payload) {
  const hooks = db.webhooksForEvent(userId, event);
  if (!hooks.length) return;
  for (const webhook of hooks) {
    fireWebhook(webhook, event, payload)
      .then((outcome) => {
        if (!outcome.ok) {
          console.warn(`[webhook] "${webhook.name}" delivery for ${event} failed:`, outcome.error || outcome.status);
        }
      })
      .catch((err) => {
        console.warn(`[webhook] "${webhook.name}" delivery for ${event} failed:`, err && err.message ? err.message : err);
      });
  }
}

// --- Audit log (F20) -----------------------------------------------------
// Read-only view of the user's own audit trail; entries are appended by the
// sensitive routes below (pull, delete, export, share).

app.get('/api/audit', (req, res) => {
  try {
    res.json({ entries: db.listAudit(req.user.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Session cleanup (Phase 7.18) ---------------------------------------
// Retention with a dry-run preview: GET returns what a cleanup at that age
// WOULD delete; POST actually deletes. The preview is the dry run — the
// destructive call is separate, audited, and requires an explicit confirm
// flag so a stray client retry can't wipe history.

// Bounds on the retention age: at least a day (deleting "older than now"
// is a footgun), at most 10 years.
const MIN_CLEANUP_DAYS = 1;
const MAX_CLEANUP_DAYS = 3650;
// How many session summaries a preview lists alongside the full count.
const CLEANUP_PREVIEW_LIMIT = 50;

// Same summary shape db.js's toSummary produces for listSessions — the
// preview list must stay bounded even when the stale set is huge.
function toSessionSummary(s) {
  return { id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt };
}

function cleanupCutoffFromDays(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function parseCleanupDays(raw) {
  const days = Number(raw);
  if (!Number.isFinite(days) || days < MIN_CLEANUP_DAYS || days > MAX_CLEANUP_DAYS) {
    return { error: `"days" must be a number between ${MIN_CLEANUP_DAYS} and ${MAX_CLEANUP_DAYS}.` };
  }
  return { days, cutoff: cleanupCutoffFromDays(days) };
}

app.get('/api/cleanup/preview', (req, res) => {
  const parsed = parseCleanupDays(req.query.days);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  try {
    // Count over the full stale set, list a capped page of it — a preview
    // that says "3" when cleanup would delete 30 is a lie the user acts on.
    const stale = db.sessionsOlderThan(req.user.id, parsed.cutoff);
    const sessions = stale.slice(0, CLEANUP_PREVIEW_LIMIT).map(toSessionSummary);
    res.json({ days: parsed.days, cutoff: parsed.cutoff, count: stale.length, sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cleanup', (req, res) => {
  const { days, confirm } = req.body || {};
  const parsed = parseCleanupDays(days);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  if (confirm !== true) {
    return res.status(400).json({ error: 'Refusing to delete without { confirm: true } — preview with GET /api/cleanup/preview first.' });
  }
  try {
    const deleted = db.deleteSessionsOlderThan(req.user.id, parsed.cutoff);
    db.addAudit(req.user.id, 'session.cleanup', `${deleted} sessions older than ${parsed.days} days`);
    res.json({ ok: true, deleted, cutoff: parsed.cutoff });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Usage report (Phase 7.20) -------------------------------------------
// A self-serve summary of the user's own corpus, computed on demand from
// the session store — no counters to maintain, nothing to go stale.
// Token figures reuse the chars/4 heuristic the context meter already
// documents as an estimate.

app.get('/api/usage-report', (req, res) => {
  try {
    const sessions = db.exportSessions(req.user.id);
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    let userMessages = 0;
    let assistantMessages = 0;
    let chars = 0;
    let charsLastWeek = 0;
    const byModel = new Map();
    const topChats = [];

    for (const s of sessions) {
      let sessionChars = 0;
      for (const m of s.messages || []) {
        if (typeof m.content !== 'string') continue;
        chars += m.content.length;
        sessionChars += m.content.length;
        if (new Date(m.createdAt || s.updatedAt).getTime() >= weekAgo) charsLastWeek += m.content.length;
        if (m.role === 'user') userMessages += 1;
        if (m.role === 'assistant') {
          assistantMessages += 1;
          const key = m.model || 'unknown';
          byModel.set(key, (byModel.get(key) || 0) + 1);
        }
      }
      if ((s.messages || []).length) topChats.push({ id: s.id, title: s.title, messages: s.messages.length, estimatedTokens: Math.ceil(sessionChars / 4) });
    }

    topChats.sort((a, b) => b.messages - a.messages);

    res.json({
      generatedAt: new Date().toISOString(),
      totals: {
        sessions: sessions.length,
        messages: userMessages + assistantMessages,
        userMessages,
        assistantMessages,
        estimatedTokens: Math.ceil(chars / 4),
        estimatedTokensLastWeek: Math.ceil(charsLastWeek / 4),
      },
      byModel: [...byModel].map(([model, messages]) => ({ model, messages })).sort((a, b) => b.messages - a.messages),
      topChats: topChats.slice(0, 5),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Model comparison (F4) ----------------------------------------------
// Non-streaming on purpose: comparison wants whole answers side by side,
// not token-by-token. All models run concurrently; one model failing is
// that column's error, not the whole request's. Per-request cap keeps a
// client from fanning one prompt out to dozens of loads.
const COMPARE_MAX_MODELS = 4;
const COMPARE_TIMEOUT_MS = Number(process.env.COMPARE_TIMEOUT_MS) || 120000;

app.post('/api/compare', async (req, res) => {
  const { model: models, prompt, options, serverId } = req.body || {};
  if (!Array.isArray(models) || models.length < 2) {
    return res.status(400).json({ error: '"model" must be an array of at least 2 model names.' });
  }
  if (models.length > COMPARE_MAX_MODELS) {
    return res.status(400).json({ error: `"model" must hold at most ${COMPARE_MAX_MODELS} models.` });
  }
  if (models.some((m) => typeof m !== 'string' || !m.trim())) {
    return res.status(400).json({ error: 'Every entry in "model" must be a model name string.' });
  }
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'Missing "prompt" in request body.' });
  }

  const host = resolveOllamaHost(serverId);
  const askOne = async (model) => {
    const startedAt = Date.now();
    try {
      const r = await fetch(`${host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [{ role: 'user', content: prompt }],
          options,
        }),
        signal: AbortSignal.timeout(COMPARE_TIMEOUT_MS),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(text || `status ${r.status}`);
      }
      const data = await r.json();
      return {
        model,
        content: (data && data.message && data.message.content) || '',
        evalCount: (data && data.eval_count) || null,
        evalDuration: (data && data.eval_duration) || null,
        durationMs: Date.now() - startedAt,
        error: null,
      };
    } catch (err) {
      return { model, content: '', evalCount: null, evalDuration: null, durationMs: Date.now() - startedAt, error: err.message };
    }
  };

  const results = await Promise.all(models.map(askOne));
  res.json({ results });
});

// --- Council mode (7.5) ----------------------------------------------------
// One prompt → several models in parallel → a synthesis model merges the
// answers into one. Built directly on /api/compare's per-model plumbing:
// same cap, same per-model error isolation. The synthesizer sees each
// member's answer (or its error) and produces the merged reply; if the
// synthesis call itself fails, the per-model results still come back so
// nothing is lost.
const COUNCIL_TIMEOUT_MS = Number(process.env.COUNCIL_TIMEOUT_MS) || 180000;

app.post('/api/council', async (req, res) => {
  const { model: models, prompt, synthesizer, options, serverId } = req.body || {};
  if (!Array.isArray(models) || models.length < 2) {
    return res.status(400).json({ error: '"model" must be an array of at least 2 model names.' });
  }
  if (models.length > COMPARE_MAX_MODELS) {
    return res.status(400).json({ error: `"model" must hold at most ${COMPARE_MAX_MODELS} models.` });
  }
  if (models.some((m) => typeof m !== 'string' || !m.trim())) {
    return res.status(400).json({ error: 'Every entry in "model" must be a model name string.' });
  }
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'Missing "prompt" in request body.' });
  }
  if (typeof synthesizer !== 'string' || !synthesizer.trim()) {
    return res.status(400).json({ error: 'Missing "synthesizer" in request body.' });
  }

  const host = resolveOllamaHost(serverId);

  // Same shape /api/compare's askOne produces — shared intentionally so the
  // client renders council members and compare columns identically.
  const askOne = async (model) => {
    const startedAt = Date.now();
    try {
      const r = await fetch(`${host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [{ role: 'user', content: prompt }],
          options,
        }),
        signal: AbortSignal.timeout(COUNCIL_TIMEOUT_MS),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(text || `status ${r.status}`);
      }
      const data = await r.json();
      return {
        model,
        content: (data && data.message && data.message.content) || '',
        evalCount: (data && data.eval_count) || null,
        evalDuration: (data && data.eval_duration) || null,
        durationMs: Date.now() - startedAt,
        error: null,
      };
    } catch (err) {
      return { model, content: '', evalCount: null, evalDuration: null, durationMs: Date.now() - startedAt, error: err.message };
    }
  };

  const results = await Promise.all(models.map(askOne));

  const successful = results.filter((r) => !r.error && r.content.trim());
  let synthesis;
  if (successful.length) {
    const members = successful
      .map((r) => `--- Answer from ${r.model} ---\n${r.content}`)
      .join('\n\n');
    try {
      const sr = await fetch(`${host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: synthesizer.trim(),
          stream: false,
          messages: [
            {
              role: 'system',
              content:
                'You are the synthesis step of a model council. Several local models answered the same user prompt. ' +
                'Merge their answers into one: keep what is correct and useful, resolve contradictions, credit notable ' +
                'unique points, and drop duplication or error. Output only the merged answer.',
            },
            {
              role: 'user',
              content: `Original prompt:\n${prompt}\n\nMember answers:\n${members}`,
            },
          ],
          options: { ...(options || {}), num_predict: (options && options.num_predict) || 1024 },
        }),
        signal: AbortSignal.timeout(COUNCIL_TIMEOUT_MS),
      });
      if (!sr.ok) throw new Error(`synthesis status ${sr.status}`);
      const data = await sr.json();
      synthesis = {
        model: synthesizer.trim(),
        content: (data && data.message && data.message.content) || '',
        error: null,
      };
    } catch (err) {
      // Synthesis failing is not fatal: the member answers stand on their own.
      synthesis = { model: synthesizer.trim(), content: '', error: `Synthesis failed: ${err.message}` };
    }
  } else {
    synthesis = { model: synthesizer.trim(), content: '', error: 'No council member produced an answer, so there is nothing to synthesize.' };
  }

  res.json({ results, synthesis });
});

// --- Document RAG (F3) ---------------------------------------------------
// Documents are indexed into the same Qdrant collection as chat memory,
// tagged payload.kind = 'document' so a memory search (kind: 'message' or
// absent, for legacy points) never returns document chunks and vice versa.
// Chat grounding happens through the existing useMemory path plus the
// `useDocuments` flag below.

const MAX_DOCUMENT_CHARS = 500000;

app.post('/api/documents', memoryIndexRateLimiter, async (req, res) => {
  const { name, text } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Missing "name" in request body.' });
  }
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Missing "text" in request body.' });
  }
  if (text.length > MAX_DOCUMENT_CHARS) {
    return res.status(400).json({ error: `"text" must not exceed ${MAX_DOCUMENT_CHARS} characters.` });
  }

  // Chunk on blank lines, then greedily pack to ~2000 chars so embeddings
  // see coherent slices without Silo-sized inputs.
  const paragraphs = text.split(/\n\s*\n/);
  const chunks = [];
  let current = '';
  for (const para of paragraphs) {
    if (current && current.length + para.length + 2 > 2000) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  try {
    await indexMemoryItems(
      chunks.map((chunk, i) => ({
        text: chunk,
        metadata: { kind: 'document', docName: name.trim().slice(0, 200), chunk: i },
      })),
      req.user.id
    );
    db.addAudit(req.user.id, 'document.index', `${name.trim()} (${chunks.length} chunks)`);
    res.json({ ok: true, name: name.trim(), chunks: chunks.length });
  } catch (err) {
    res.status(503).json({ error: `Document indexing failed: ${err.message}` });
  }
});

// --- Game NPC bridge (F19) ----------------------------------------------
// A small, non-streaming, tightly-capped endpoint the "Local Theft Auto"
// game (marketing/game.js, Unity port) can call for NPC dialogue. Bounded
// output (num_predict) keeps latency and host load predictable for a game
// loop; rate-limited like the other expensive routes.
const gameNpcRateLimiter = rateLimiter({ windowMs: 60 * 1000, max: 20 });

app.post('/api/game-npc', gameNpcRateLimiter, async (req, res) => {
  const { model, npc, playerLine, scene } = req.body || {};
  if (typeof model !== 'string' || !model.trim()) {
    return res.status(400).json({ error: 'Missing "model" in request body.' });
  }
  if (typeof playerLine !== 'string' || !playerLine.trim()) {
    return res.status(400).json({ error: 'Missing "playerLine" in request body.' });
  }
  const npcName = typeof npc === 'string' ? npc.trim().slice(0, 100) : 'the NPC';
  const sceneNote = typeof scene === 'string' ? scene.trim().slice(0, 300) : '';

  try {
    const r = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.trim(),
        stream: false,
        messages: [
          {
            role: 'system',
            content:
              `You are ${npcName}, an NPC in a stealth-comedy video game. ` +
              'Reply with ONE short in-character line (under 30 words), no stage directions, no quotes. ' +
              (sceneNote ? `Scene: ${sceneNote}. ` : ''),
          },
          { role: 'user', content: playerLine.trim().slice(0, 500) },
        ],
        options: { temperature: 1.1, num_predict: 60 },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return res.status(r.status).json({ error: text || 'Upstream error from Ollama.' });
    }
    const data = await r.json();
    res.json({ line: (data && data.message && data.message.content) || '' });
  } catch (err) {
    res.status(503).json({ error: `Cannot reach Ollama at ${OLLAMA_HOST}: ${err.message}` });
  }
});

// Pull a model with streaming progress.
app.post('/api/pull', modelPullRateLimiter, async (req, res) => {
  const { name } = req.body || {};

  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Missing "name" in request body.' });
  }
  const trimmedName = name.trim();
  // Ollama model tags are single tokens like "llama3:8b" — reject anything
  // with whitespace or control characters, which can't be a valid tag and
  // would otherwise be forwarded verbatim to the upstream Ollama API.
  // eslint-disable-next-line no-control-regex -- the control-char range is the whole point of this check.
  if (/[\s\x00-\x1F\x7F]/.test(trimmedName)) {
    return res.status(400).json({ error: 'Invalid "name": must not contain whitespace or control characters.' });
  }
  if (trimmedName.length > 256) {
    return res.status(400).json({ error: 'Invalid "name": must not exceed 256 characters.' });
  }

  await pipeUpstreamNdjson({
    res,
    path: '/api/pull',
    body: { name: trimmedName, stream: true },
  });
});

// Audit the sensitive routes (F20): pulling/deleting models touches the
// host's disk, exporting and sharing move chat data out of the account.
app.use('/api/pull', (req, res, next) => {
  if (req.method === 'POST') {
    res.on('finish', () => {
      if (res.statusCode < 400) {
        db.addAudit(req.user.id, 'model.pull', req.body && req.body.name);
        // Webhook event (7.15): pull finished. Fire-and-forget — never
        // delays the pull response that has already gone out.
        dispatchWebhookEvent(req.user.id, 'model.pull', { model: req.body && req.body.name });
      }
    });
  }
  next();
});

app.use('/api/models/:name', (req, res, next) => {
  if (req.method === 'DELETE') {
    res.on('finish', () => {
      if (res.statusCode < 400) db.addAudit(req.user.id, 'model.delete', req.params.name);
    });
  }
  next();
});

// Delete a model.
app.delete('/api/models/:name', modelDeleteRateLimiter, async (req, res) => {
  try {
    const r = await fetch(`${OLLAMA_HOST}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: req.params.name }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return res.status(r.status).json({ error: text || 'Failed to delete model.' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// --- Chat history (local database) -----------------------------------
// Server-side persistence for chat sessions, stored in a JSON file under
// ./data/. This is separate from (and currently unused by) the frontend's
// existing localStorage-based history; see README for details.
//
// Every route here is scoped to req.user.id (see db.js) so one account can
// never read, modify, or delete another account's sessions — this only
// works because everything below the auth gate in this file already
// requires req.user to be set.

// List sessions (summaries only — no messages).
app.get('/api/sessions', (req, res) => {
  try {
    res.json({ sessions: db.listSessions(req.user.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export the user's own data: every session including full messages, as a
// JSON download (TODO 5.3 — the "rescue months of history without copying
// raw files" path). Response headers make the browser download it instead
// of rendering it, under a stable filename. Per-user scoped like every
// other /api/* route, so an account only ever gets back what it owns.
app.get('/api/export', (req, res) => {
  try {
    const sessions = db.exportSessions(req.user.id);
    db.addAudit(req.user.id, 'session.export', `${sessions.length} sessions`);
    const payload = JSON.stringify(
      { exportedAt: new Date().toISOString(), app: 'ollama-chat', sessions },
      null,
      2
    );
    const filename = `ollama-chat-export-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new session.
app.post('/api/sessions', (req, res) => {
  const { title } = req.body || {};
  if (title !== undefined && typeof title !== 'string') {
    return res.status(400).json({ error: '"title" must be a string.' });
  }
  try {
    const session = db.createSession(req.user.id, title);
    // Webhook event (7.15): new session. Fire-and-forget — a slow receiver
    // must not delay the creation response.
    dispatchWebhookEvent(req.user.id, 'session.create', { sessionId: session.id, title: session.title });
    res.status(201).json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search the user's sessions by a case-insensitive substring over titles
// and message contents. Registered BEFORE /api/sessions/:id so "search"
// can never be mistaken for a session id.
app.get('/api/sessions/search', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) return res.status(400).json({ error: 'Missing "q" query parameter.' });
  try {
    res.json({ sessions: db.searchSessions(req.user.id, q) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a single session, including its full messages.
app.get('/api/sessions/:id', (req, res) => {
  try {
    const session = db.getSession(req.params.id, req.user.id);
    if (!session) return res.status(404).json({ error: `No session with id "${req.params.id}".` });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a session's title and/or messages (replace or append).
app.patch('/api/sessions/:id', (req, res) => {
  const { title, messages, appendMessages } = req.body || {};

  if (title !== undefined && typeof title !== 'string') {
    return res.status(400).json({ error: '"title" must be a string.' });
  }
  if (messages !== undefined && !Array.isArray(messages)) {
    return res.status(400).json({ error: '"messages" must be an array.' });
  }
  if (appendMessages !== undefined && !Array.isArray(appendMessages)) {
    return res.status(400).json({ error: '"appendMessages" must be an array.' });
  }
  if (Array.isArray(messages) && !messages.every(isValidMessage)) {
    return res.status(400).json({ error: 'Each item in "messages" must have string "role" and "content".' });
  }
  if (Array.isArray(appendMessages) && !appendMessages.every(isValidMessage)) {
    return res.status(400).json({ error: 'Each item in "appendMessages" must have string "role" and "content".' });
  }

  // Size limits: shape checks above run first so a malformed item still
  // reports the shape error rather than a confusing size error.
  if (typeof title === 'string' && title.length > MAX_SESSION_TITLE_CHARS) {
    return res.status(400).json({ error: `"title" must not exceed ${MAX_SESSION_TITLE_CHARS} characters.` });
  }
  if (Array.isArray(messages) && messages.length > MAX_SESSION_MESSAGES) {
    return res.status(400).json({ error: `"messages" must not exceed ${MAX_SESSION_MESSAGES} items.` });
  }
  if (Array.isArray(appendMessages) && appendMessages.length > MAX_SESSION_MESSAGES) {
    return res.status(400).json({ error: `"appendMessages" must not exceed ${MAX_SESSION_MESSAGES} items.` });
  }
  if (Array.isArray(messages) && messages.some((m) => m.content.length > MAX_MESSAGE_CONTENT_CHARS)) {
    return res.status(400).json({ error: `Each message "content" in "messages" must not exceed ${MAX_MESSAGE_CONTENT_CHARS} characters.` });
  }
  if (Array.isArray(appendMessages) && appendMessages.some((m) => m.content.length > MAX_MESSAGE_CONTENT_CHARS)) {
    return res.status(400).json({ error: `Each message "content" in "appendMessages" must not exceed ${MAX_MESSAGE_CONTENT_CHARS} characters.` });
  }

  try {
    const session = db.updateSession(req.params.id, req.user.id, { title, messages, appendMessages });
    if (!session) return res.status(404).json({ error: `No session with id "${req.params.id}".` });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a session.
app.delete('/api/sessions/:id', (req, res) => {
  try {
    const deleted = db.deleteSession(req.params.id, req.user.id);
    if (!deleted) return res.status(404).json({ error: `No session with id "${req.params.id}".` });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a share link for a session (F10). Returns an unguessable token
// the read-only /share.html page renders; sharing again revokes the old
// token, which is the documented revoke path.
app.post('/api/sessions/:id/share', (req, res) => {
  try {
    const token = db.createShareToken(req.params.id, req.user.id);
    if (!token) return res.status(404).json({ error: `No session with id "${req.params.id}".` });
    db.addAudit(req.user.id, 'session.share', req.params.id);
    res.json({ url: `/share.html?token=${token}`, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Semantic memory over past chat messages, backed by Qdrant for vector
// search. Qdrant stores vectors + metadata payloads only — it is not the
// primary chat-history store. Both routes degrade gracefully: if Qdrant or
// the embeddings call fails, they return 503 rather than crashing.
//
// Every point is tagged with the indexing user's id and search is filtered
// to that same id, so one account's indexed messages are never returned in
// another account's search results — same scoping principle as the
// /api/sessions routes above.

// Shared by the /api/memory/index route and /api/chat's auto-indexing of
// completed turns. Embeds and upserts each item sequentially; the item's
// text is stored in the payload (not just embedded), so semantic search can
// return the excerpt itself rather than an opaque vector match.
async function indexMemoryItems(items, userId) {
  for (const item of items) {
    const vector = await embeddings.embed(item.text);
    await qdrant.upsertPoint({
      id: item.id ?? crypto.randomUUID(),
      vector,
      payload: { ...(item.metadata || {}), text: item.text, userId },
    });
  }
  return items.length;
}

// Index one message (or an array of them) for later semantic search.
// Body: { id, text, metadata } or an array of such objects.
app.post('/api/memory/index', memoryIndexRateLimiter, async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [req.body];

  if (items.length > MAX_MEMORY_BATCH) {
    return res.status(400).json({ error: `Batch must not exceed ${MAX_MEMORY_BATCH} items.` });
  }

  for (const item of items) {
    if (!item || typeof item.text !== 'string' || !item.text.trim()) {
      return res.status(400).json({ error: 'Each item requires a non-empty "text" field.' });
    }
    if (item.text.length > MAX_MEMORY_TEXT_CHARS) {
      return res.status(400).json({ error: `Each item's "text" must not exceed ${MAX_MEMORY_TEXT_CHARS} characters.` });
    }
  }

  try {
    const indexed = await indexMemoryItems(items, req.user.id);
    res.json({ ok: true, indexed });
  } catch (err) {
    res.status(503).json({ error: `Semantic memory indexing failed: ${err.message}` });
  }
});

// --- Memory editing (Phase 7.8) -------------------------------------------
// View / edit / delete the user's own stored semantic-memory points. Same
// per-user scoping as search: every operation filters on payload.userId, so
// a guessed id can never touch another account's memory. Rate-limited like
// the other memory routes.

const MEMORY_PAGE_SIZE = 50;

app.get('/api/memory/points', memoryIndexRateLimiter, async (req, res) => {
  const offset = typeof req.query.offset === 'string' && req.query.offset ? req.query.offset : undefined;
  try {
    const page = await qdrant.listPoints({ userId: req.user.id, limit: MEMORY_PAGE_SIZE, offset });
    res.json(page);
  } catch (err) {
    res.status(503).json({ error: `Semantic memory unavailable: ${err.message}` });
  }
});

app.delete('/api/memory/points/:id', memoryIndexRateLimiter, async (req, res) => {
  try {
    await qdrant.deletePoint({ id: req.params.id, userId: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ error: `Semantic memory unavailable: ${err.message}` });
  }
});

app.patch('/api/memory/points/:id', memoryIndexRateLimiter, async (req, res) => {
  const { text } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Missing "text" in request body.' });
  }
  if (text.length > MAX_MEMORY_TEXT_CHARS) {
    return res.status(400).json({ error: `"text" must not exceed ${MAX_MEMORY_TEXT_CHARS} characters.` });
  }
  try {
    // Re-embed through the shared embeddings module so the updated point
    // stays searchable with the collection's dimensionality.
    const updated = await qdrant.updatePointText({
      id: req.params.id,
      userId: req.user.id,
      text: text.trim(),
      embed: (t) => embeddings.embed(t),
    });
    if (!updated) return res.status(404).json({ error: `No memory point with id "${req.params.id}".` });
    res.json(updated);
  } catch (err) {
    res.status(503).json({ error: `Semantic memory unavailable: ${err.message}` });
  }
});

// --- URL summarizer (Phase 7.9) -------------------------------------------
// Fetches a web page server-side, strips it to text, and summarizes it with
// the chosen model. SSRF posture: this is the one route that fetches a
// *client-supplied* URL, so it only speaks http(s), refuses embedded
// credentials, refuses hostnames that resolve to private/loopback/
// link-local addresses (checked across ALL resolved records), does not
// follow redirects (a public host can't bounce the fetch at an internal
// one after the check), and caps the body size. A page therefore can't be
// used to reach Ollama, Qdrant, this app, or LAN services.

const URL_FETCH_TIMEOUT_MS = Number(process.env.URL_FETCH_TIMEOUT_MS) || 15000;
const URL_MAX_BYTES = 2 * 1024 * 1024; // 2MB of HTML is plenty for a summary

function isPrivateAddress(address, family) {
  if (family === 6) {
    const v6 = address.toLowerCase();
    if (v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')) return true;
    // IPv4-mapped IPv6 (::ffff:127.0.0.1 etc.) — check the embedded v4.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    if (mapped) return isPrivateAddress(mapped[1], 4);
    return false;
  }
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => Number.isNaN(n))) return true;
  const [a, b] = octets;
  return (
    a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127) // CGNAT
    || (a === 169 && b === 254) // link-local
    || (a === 172 && b >= 16 && b <= 31) // RFC1918 (incl. docker's 172.17/16)
    || (a === 192 && b === 168)
    || a >= 224 // multicast + reserved
  );
}

// Resolves every address the hostname maps to and requires ALL of them to
// be public — one private A/AAAA record is enough to refuse.
async function assertPublicHost(hostname) {
  const lookup = await new Promise((resolve, reject) => {
    require('dns').lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });
  if (!lookup.length) throw new Error('Host resolved to no addresses.');
  for (const { address, family } of lookup) {
    if (isPrivateAddress(address, family)) {
      throw new Error(`"${hostname}" resolves to a private address (${address}); refusing to fetch it.`);
    }
  }
}

// HTML → readable-ish text: drop script/style blocks and tags, collapse
// whitespace, decode the handful of entities that change meaning.
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

app.post('/api/summarize-url', memoryIndexRateLimiter, async (req, res) => {
  const { url, model } = req.body || {};
  if (typeof model !== 'string' || !model.trim()) {
    return res.status(400).json({ error: 'Missing "model" in request body.' });
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid "url".' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return res.status(400).json({ error: 'Only http(s) URLs are supported.' });
  }
  if (parsed.username || parsed.password) {
    return res.status(400).json({ error: 'URLs with embedded credentials are not supported.' });
  }

  try {
    await assertPublicHost(parsed.hostname);

    // redirect: 'error' so a public host can't bounce the fetch at an
    // internal one after the SSRF check has passed.
    const r = await fetch(parsed.href, {
      redirect: 'error',
      signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'ollama-chat-url-summarizer/1.0' },
    });
    if (!r.ok) {
      return res.status(502).json({ error: `Fetch failed with status ${r.status}.` });
    }
    const contentType = r.headers.get('content-type') || '';
    if (!/text\/html|text\/plain|application\/xhtml/.test(contentType)) {
      return res.status(400).json({ error: `Unsupported content type "${contentType}" — only HTML or plain text pages.` });
    }
    const raw = await r.text();
    const body = raw.length > URL_MAX_BYTES ? raw.slice(0, URL_MAX_BYTES) : raw;
    const text = contentType.includes('text/plain') ? body.replace(/\s+/g, ' ').trim() : htmlToText(body);
    if (!text) {
      return res.status(400).json({ error: 'No readable text found on that page.' });
    }

    const sr = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.trim(),
        stream: false,
        messages: [
          { role: 'system', content: 'Summarize the following web page faithfully and concisely. Capture the main points; do not editorialize or add commentary beyond the summary.' },
          { role: 'user', content: text.slice(0, 200000) },
        ],
        options: { num_predict: 500 },
      }),
      signal: AbortSignal.timeout(COMPACTION_TIMEOUT_MS),
    });
    if (!sr.ok) {
      const errText = await sr.text().catch(() => '');
      return res.status(502).json({ error: `Ollama summarization failed: ${errText || `status ${sr.status}`}` });
    }
    const data = await sr.json();
    db.addAudit(req.user.id, 'url.summarize', parsed.hostname);
    res.json({ summary: (data && data.message && data.message.content) || '', url: parsed.href, chars: text.length });
  } catch (err) {
    if (err && /redirect/.test(err.message || '')) {
      return res.status(502).json({ error: 'That URL redirects to another host; cross-origin redirects are not followed.' });
    }
    res.status(503).json({ error: `Fetch failed: ${err.message}` });
  }
});

// Search past indexed messages by semantic similarity.
// Body: { query, limit }.
app.post('/api/memory/search', async (req, res) => {
  const { query, limit } = req.body || {};
  if (typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'Missing "query" in request body.' });
  }

  try {
    const vector = await embeddings.embed(query);
    const results = await qdrant.searchByVector(vector, {
      limit: limit || 5,
      filter: { must: [{ key: 'userId', match: { value: req.user.id } }] },
    });
    res.json({ results });
  } catch (err) {
    res.status(503).json({ error: `Semantic memory search failed: ${err.message}` });
  }
});

// Only bind a port and start background intervals when this file is run
// directly (`node server.js` / `npm start`), not when it's required — e.g.
// by tests, which need the `app` instance without a listening server.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Ollama Chat running at http://localhost:${PORT}`);
    console.log(`Proxying Ollama at ${OLLAMA_HOST}`);

    // Non-fatal startup check: warn once if Qdrant isn't reachable, but never
    // block or crash the server on it.
    qdrant.checkConnection().then((result) => {
      if (!result.ok) {
        console.warn(`Warning: Qdrant unreachable at ${qdrant.QDRANT_URL} (semantic memory endpoints will return 503 until it's available): ${result.error}`);
      }
    });

    // Prune expired login sessions on startup, then every 6 hours — keeps
    // the sessions table from growing unbounded with abandoned tokens (see
    // auth.js pruneExpiredSessions for why lazy pruning alone isn't enough).
    auth.pruneExpiredSessions();
    setInterval(() => auth.pruneExpiredSessions(), 6 * 60 * 60 * 1000);
  });
}

// Exposed for tests only (e.g. asserting the compaction timeout behavior
// without spinning up a real Ollama instance); not used by any route above.
app.summarizeWithOllama = summarizeWithOllama;

// Test-only: the rate-limiter factory, so the suite can assert key eviction
// without waiting out a real window.
app.rateLimiterForTests = rateLimiter;

module.exports = app;
