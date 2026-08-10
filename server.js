const express = require('express');
const path = require('path');
const os = require('os');
const { compactMessages, DEFAULTS: COMPACTION_DEFAULTS } = require('./compaction');

const app = express();
const PORT = process.env.PORT || 4173;
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

// Chat compaction settings — see README.md "Chat compaction" section.
const COMPACTION_MAX_MESSAGES = Number(process.env.COMPACTION_MAX_MESSAGES) || COMPACTION_DEFAULTS.maxMessages;
const COMPACTION_MAX_CHARS = Number(process.env.COMPACTION_MAX_CHARS) || COMPACTION_DEFAULTS.maxChars;
const COMPACTION_KEEP_RECENT = Number(process.env.COMPACTION_KEEP_RECENT) || COMPACTION_DEFAULTS.keepRecent;
const COMPACTION_MODEL = process.env.COMPACTION_MODEL || null;

// Calls Ollama's non-streaming chat endpoint to produce a concise summary
// of a slice of older messages. Injected into compactMessages() so the
// compaction logic itself stays free of any HTTP/Ollama specifics.
async function summarizeWithOllama(messagesToSummarize, model) {
  const summaryModel = COMPACTION_MODEL || model;
  const r = await fetch(`${OLLAMA_HOST}/api/chat`, {
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
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Ollama summarization request failed (status ${r.status}): ${text}`);
  }
  const data = await r.json();
  return (data && data.message && data.message.content) || '';
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// System memory info, used by the frontend to warn before running a model
// that likely won't fit — this is what almost took the machine down before:
// a model whose weights exceed available RAM causes heavy swap thrashing
// rather than a clean "out of memory" error.
app.get('/api/system', (_req, res) => {
  res.json({
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
  });
});

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
  try {
    const r = await fetch(`${OLLAMA_HOST}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: req.body.model }),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// Streaming chat proxy. Forwards newline-delimited JSON chunks from Ollama
// straight through to the browser as they arrive.
app.post('/api/chat', async (req, res) => {
  const { model, messages, options, keep_alive } = req.body || {};

  if (!model) return res.status(400).json({ error: 'Missing "model" in request body.' });
  if (!Array.isArray(messages)) return res.status(400).json({ error: '"messages" must be an array.' });

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
      body: JSON.stringify({ model, messages: compactedMessages, options, keep_alive, stream: true }),
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
    }
  } catch (err) {
    // Client likely disconnected or upstream dropped; nothing more to do.
  } finally {
    if (!res.writableEnded) res.end();
  }
});

// Pull a model with streaming progress.
app.post('/api/pull', async (req, res) => {
  const { name } = req.body || {};

  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Missing "name" in request body.' });
  }
  const trimmedName = name.trim();
  // Ollama model tags are single tokens like "llama3:8b" — reject anything
  // with whitespace or control characters, which can't be a valid tag and
  // would otherwise be forwarded verbatim to the upstream Ollama API.
  if (/[\s\x00-\x1F\x7F]/.test(trimmedName)) {
    return res.status(400).json({ error: 'Invalid "name": must not contain whitespace or control characters.' });
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
app.delete('/api/models/:name', async (req, res) => {
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

app.listen(PORT, () => {
  console.log(`Ollama Chat running at http://localhost:${PORT}`);
  console.log(`Proxying Ollama at ${OLLAMA_HOST}`);
});
