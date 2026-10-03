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

const app = express();
const PORT = process.env.PORT || 4173;
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

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

// Attaches req.user (or leaves it undefined) based on the session cookie.
// Runs on every request so both API routes and page routes can use it.
app.use((req, res, next) => {
  const cookies = parseCookies(req);
  const token = cookies[auth.SESSION_COOKIE];
  req.sessionToken = token;
  req.user = token ? auth.getUserBySessionToken(token) : null;
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
  const user = auth.verifyUser(username, password);
  if (!user) return res.status(401).json({ error: 'Invalid username or password.' });
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

// Everything below this point (both pages and API routes) requires a
// logged-in session, except the static assets needed to render the
// login/signup pages themselves and the /api/auth/* routes above.
const PUBLIC_ASSETS = new Set(['/login.html', '/signup.html', '/auth.js', '/style.css']);

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
const isValidMessage = (m) => m && typeof m === 'object' && typeof m.role === 'string' && typeof m.content === 'string';

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

app.post('/api/chat', async (req, res) => {
  const { model, messages, options, keep_alive, useMemory } = req.body || {};

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
  const lastUser = [...messages].reverse().find((m) => m.role === 'user' && m.content.trim());
  if (useMemory === true && req.user && lastUser) {
    try {
      const results = await raceWithMemoryTimeout((async () => {
        const vector = await embeddings.embed(lastUser.content);
        return qdrant.searchByVector(vector, {
          limit: MEMORY_TOP_K,
          filter: { must: [{ key: 'userId', match: { value: req.user.id } }] },
        });
      })());
      const excerpts = (Array.isArray(results) ? results : [])
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

  // Tied to the client connection: if the browser aborts (Stop button, tab
  // close, network drop), this immediately tears down the upstream request
  // to Ollama too, instead of leaving it to generate in the background where
  // it keeps burning CPU/RAM the user was trying to reclaim.
  const upstreamController = new AbortController();
  res.on('close', () => upstreamController.abort());

  let upstream;
  try {
    upstream = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: messagesToSend, options, keep_alive, stream: true }),
      signal: upstreamController.signal,
    });
  } catch (err) {
    if (upstreamController.signal.aborted) return res.end();
    return res.status(503).json({ error: `Cannot reach Ollama at ${OLLAMA_HOST}: ${err.message}` });
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return res.status(upstream.status || 502).json({ error: text || 'Upstream error from Ollama.' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  if (wasCompacted) res.setHeader('X-Compacted', 'true');
  // If the client goes away mid-stream, writing further chunks can raise an
  // EPIPE/ECONNRESET 'error' event on the response; without a listener that
  // would bubble up as an unhandled exception and crash the process.
  res.on('error', () => {});

  const reader = upstream.body.getReader();
  res.on('close', () => reader.cancel().catch(() => {}));

  // When useMemory is on, accumulate the assistant's reply from the ndjson
  // stream (parse errors are ignored — indexing is best-effort) so the
  // completed turn can be auto-indexed below, exactly like a manual
  // /api/memory/index call would.
  const memoryDecoder = useMemory === true ? new TextDecoder() : null;
  let ndjsonBuffer = '';
  let assistantText = '';
  const autoIndexCompletedTurn = () => {
    if (useMemory !== true || !req.user) return;
    const items = [{ text: lastUser.content, metadata: { role: 'user' } }];
    if (assistantText.trim()) items.push({ text: assistantText, metadata: { role: 'assistant' } });
    indexMemoryItems(items, req.user.id).catch((err) => {
      console.warn('[memory] auto-index failed:', err && err.message ? err.message : err);
    });
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
      if (memoryDecoder) {
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
    }
  } catch (err) {
    // Client likely disconnected or upstream dropped; nothing more to do.
  } finally {
    autoIndexCompletedTurn();
    if (!res.writableEnded) res.end();
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

  const upstreamController = new AbortController();
  res.on('close', () => upstreamController.abort());

  let upstream;
  try {
    upstream = await fetch(`${OLLAMA_HOST}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmedName, stream: true }),
      signal: upstreamController.signal,
    });
  } catch (err) {
    if (upstreamController.signal.aborted) return res.end();
    return res.status(503).json({ error: `Cannot reach Ollama at ${OLLAMA_HOST}: ${err.message}` });
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return res.status(upstream.status || 502).json({ error: text || 'Upstream error from Ollama.' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  // See /api/chat: guard against unhandled 'error' events from writing to a
  // response whose client has already disconnected.
  res.on('error', () => {});

  const reader = upstream.body.getReader();
  res.on('close', () => reader.cancel().catch(() => {}));

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch (err) {
    // ignore
  } finally {
    if (!res.writableEnded) res.end();
  }
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

// Create a new session.
app.post('/api/sessions', (req, res) => {
  const { title } = req.body || {};
  if (title !== undefined && typeof title !== 'string') {
    return res.status(400).json({ error: '"title" must be a string.' });
  }
  try {
    const session = db.createSession(req.user.id, title);
    res.status(201).json(session);
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
