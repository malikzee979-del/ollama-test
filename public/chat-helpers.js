// Pure, DOM-free helpers shared by public/app.js (loaded as a plain
// <script> before it, exposing a single `ChatHelpers` global) and
// test/chat-helpers.test.js (loaded via require through the CommonJS guard
// at the bottom). There is no build step (see TODO 5.1), so anything added
// here must stay free of document/window/localStorage references — the DOM
// and storage glue stays in app.js.
'use strict';

// ---------- Attachments ----------
const ATTACHMENT_EXTENSIONS = [
  '.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.log',
  '.js', '.ts', '.py', '.html', '.css', '.yaml', '.yml', '.xml', '.sh',
];
const ATTACHMENT_MAX_SIZE = 200 * 1024; // 200KB per file
const ATTACHMENT_MAX_COUNT = 3; // per message

// Images take a parallel path: sent to vision models via Ollama's
// per-message `images: []` array instead of a fenced text block, so they
// get a bigger cap (they become base64 long strings, but models read them
// efficiently — a few MB is normal for a photo) and a different extension
// allowlist. Not in ATTACHMENT_EXTENSIONS: those are read as text, and an
// image read as text is garbage.
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const IMAGE_MAX_SIZE = 4 * 1024 * 1024; // 4MB per image

// PDFs take a third path: pdf.js (vendored, public/vendor/) extracts the
// text client-side and the result rides along as the attachment's content,
// exactly like a text file — the model never sees the binary. Slightly
// above the text cap because a PDF's bytes are mostly structure, and the
// extracted text of a big-but-legal PDF lands in the same size range as a
// 200KB text file.
const PDF_EXTENSIONS = ['.pdf'];
const PDF_MAX_SIZE = 10 * 1024 * 1024; // 10MB per file

function isPdfAttachment(name) {
  return PDF_EXTENSIONS.includes(extensionOf(name));
}

const IMAGE_MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function isImageAttachment(name) {
  return IMAGE_EXTENSIONS.includes(extensionOf(name));
}

// MIME type for the data: URL used to render image thumbnails; defaults to
// a generic type for anything unrecognized (callers gate on
// isImageAttachment first, so this only fires on a corrupt list entry).
function imageMimeType(name) {
  return IMAGE_MIME_TYPES[extensionOf(name)] || 'application/octet-stream';
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i += 1;
  }
  return `${Math.round(val * 10) / 10} ${units[i]}`;
}

// Shortens long text by replacing the middle with "…", keeping the start and
// end so identifiers like file paths ("src/lib/very/deep/module.js") stay
// recognizable from both ends. Splitting the remaining budget (max minus the
// ellipsis itself) with ceil on the head keeps the odd leftover character at
// the front, matching the visual bias of most UIs. Text at or under max is
// returned unchanged; non-finite max, or max < 1, yields ''.
function truncateMiddle(text, max) {
  const str = String(text ?? '');
  if (!Number.isFinite(max) || max < 1) return '';
  if (str.length <= max) return str;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${str.slice(0, head)}…${tail > 0 ? str.slice(str.length - tail) : ''}`;
}

// Returns the user-facing error message for a would-be attachment, or null
// if it is acceptable. `pendingCount` is how many attachments are already
// staged on the message.
function attachmentError(name, size, pendingCount) {
  if (pendingCount >= ATTACHMENT_MAX_COUNT) {
    return `You can attach at most ${ATTACHMENT_MAX_COUNT} files per message.`;
  }
  const isImage = isImageAttachment(name);
  const isPdf = isPdfAttachment(name);
  if (!isImage && !isPdf && !ATTACHMENT_EXTENSIONS.includes(extensionOf(name))) {
    return `"${name}" is not a supported file type. Plain-text files (${ATTACHMENT_EXTENSIONS.join(', ')}), PDFs, or images (${IMAGE_EXTENSIONS.join(', ')}) only.`;
  }
  const cap = isImage ? IMAGE_MAX_SIZE : isPdf ? PDF_MAX_SIZE : ATTACHMENT_MAX_SIZE;
  if (size > cap) {
    const kind = isImage ? 'image' : isPdf ? 'PDF' : 'file';
    return `"${name}" is ${formatBytes(size)}, which exceeds the ${formatBytes(cap)} limit per ${kind}.`;
  }
  return null;
}

// Turns a title into a URL-friendly slug: lowercase, whitespace and runs of
// punctuation collapse into a single hyphen, with no leading/trailing
// hyphens. Mirrors the slug logic in exportFilename (no build step, so the
// two are duplicated — keep them in sync). Empty or all-punctuation input
// yields '' so callers can fall back to a default.
function slugify(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Counts words in a string, ignoring extra whitespace: any run of non-
// whitespace characters is one word, so leading/trailing/multiple spaces,
// tabs, and newlines all collapse. Empty or whitespace-only input yields 0.
function wordCount(text) {
  const matches = String(text ?? '').match(/\S+/g);
  return matches ? matches.length : 0;
}

// Uppercases the first letter of each whitespace-separated word, leaving the
// rest of each word untouched (so "AI chat" stays "AI Chat", not "Ai Chat").
// Runs of whitespace between words are preserved as-is.
function capitalize(text) {
  return String(text ?? '').replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1));
}

function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

// ---------- Message shaping ----------
// Builds the messages array sent to /api/chat: an optional system prompt
// first, then the chat's messages with attachments folded in. Text
// attachments become a fenced "[Attached file: ...]" block appended to the
// message content; image attachments go to Ollama's per-message `images: []`
// array (base64) — that is the shape vision models read, and it's what
// `compactMessages` passes through untouched when it rebuilds messages.
function buildOllamaMessages(systemPrompt, chatMessages) {
  const msgs = [];
  if (systemPrompt && systemPrompt.trim()) {
    msgs.push({ role: 'system', content: systemPrompt.trim() });
  }
  for (const m of chatMessages) {
    let content = m.content;
    if (m.attachments && m.attachments.length) {
      const blocks = m.attachments
        .filter((a) => !isImageAttachment(a.name))
        .map((a) => `[Attached file: ${a.name}]\n\`\`\`\n${a.content}\n\`\`\``)
        .join('\n\n');
      if (blocks) content = content ? `${content}\n\n${blocks}` : blocks;
    }
    const msg = { role: m.role, content };
    if (m.attachments && m.attachments.length) {
      // Only decode once here and on the server: the base64 payload rides
      // along in the persisted message, so both sides can rebuild it.
      const images = m.attachments
        .filter((a) => isImageAttachment(a.name))
        .map((a) => a.content);
      if (images.length) msg.images = images;
    }
    msgs.push(msg);
  }
  return msgs;
}

// Mirrors compaction.js's CHARS_PER_TOKEN heuristic (chars/4 ≈ tokens) so
// the figure shown in the context meter is the same one the server's
// compaction trigger reasons about. There is no build step, so the constant
// is duplicated rather than imported — keep the two in sync.
const CHARS_PER_TOKEN = 4;

function estimateChatTokens(systemPrompt, chatMessages) {
  let chars = 0;
  for (const msg of buildOllamaMessages(systemPrompt, chatMessages)) chars += msg.content.length;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

function formatTokens(count) {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

// ---------- Settings ----------
function defaultSettings() {
  return { systemPrompt: '', temperature: 0.8, topP: 0.9, numCtx: 4096, useMemory: false, responseCache: true, lastModel: '', autoRoute: false };
}

// Merges a stored settings object (localStorage JSON, possibly older or
// partial) onto the defaults with per-field coercion, so a corrupt or
// stale value can never leak NaN/undefined into a live setting.
function normalizeSettings(stored) {
  const defaults = defaultSettings();
  if (!stored || typeof stored !== 'object') return defaults;
  return {
    systemPrompt: typeof stored.systemPrompt === 'string' ? stored.systemPrompt : defaults.systemPrompt,
    temperature: Number.isFinite(Number(stored.temperature)) ? Number(stored.temperature) : defaults.temperature,
    topP: Number.isFinite(Number(stored.topP)) ? Number(stored.topP) : defaults.topP,
    numCtx: Number.isFinite(Number(stored.numCtx)) && Number(stored.numCtx) > 0 ? Number(stored.numCtx) : defaults.numCtx,
    useMemory: stored.useMemory === true,
    // Absent on older stored settings — default ON (opt-out, not opt-in),
    // matching how a fresh install sees the checkbox.
    responseCache: stored.responseCache !== false,
    lastModel: typeof stored.lastModel === 'string' ? stored.lastModel : defaults.lastModel,
    autoRoute: stored.autoRoute === true,
  };
}

// ---------- Response cache key (Phase 7.13) ----------
// A stable string that identifies "would regenerating produce the same
// reply": same model, same conversation prefix as the model sees it (the
// buildOllamaMessages output, so system prompt and attachments are
// included), same sampling options, same server. Keying on what is sent —
// not on what is stored — is what makes a cache hit trustworthy.
//
// JSON.stringify alone would make the key depend on object key insertion
// order ({a:1,b:2} vs {b:2,a:1} are the same request but different
// strings), so object keys are sorted before serializing. Arrays keep
// their order — message order changes the request.
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().map((k) => [k, stableValue(value[k])]);
  }
  return value === undefined ? null : value;
}

function cacheKeyFor({ model, messages, options, serverId }) {
  return JSON.stringify([
    model || '',
    stableValue(messages || []),
    stableValue(options || {}),
    serverId || 0,
  ]);
}

// ---------- Prompt shortcuts (Phase 7.3) ----------
// Extracts {{variable}} placeholders from a shortcut/library template, in
// first-appearance order, deduplicated. Pure so the tests can pin the
// regex behaviour (whitespace inside braces, unknown chars in names).
function templateVariables(text) {
  const matches = String(text || '').match(/{{\s*([\w.-]+)\s*}}/g) || [];
  const seen = new Set();
  const vars = [];
  for (const m of matches) {
    const name = m.replace(/[{}]/g, '').trim();
    if (!seen.has(name)) {
      seen.add(name);
      vars.push(name);
    }
  }
  return vars;
}


// ---------- Markdown rendering ----------
// Moved here from app.js: both functions are pure string→string — no DOM,
// no storage — so they're testable without jsdom. app.js still calls them
// by these names via its ChatHelpers destructure.

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Per-line diff highlighting for a ```diff block: lines starting with
// "+" become additions, "-" removals, "@@" hunk headers. Everything else
// stays a context line. Pure string→HTML — each line is escaped before its
// class span is wrapped around it, so no diff content can inject markup.
function renderDiffCode(code) {
  const line = (cls, text) => `<span class="diff-${cls}">${escapeHtml(text)}</span>`;
  return code
    .split('\n')
    .map((l) => {
      if (/^\+\+\+ |^--- /.test(l)) {
        // File headers are diff metadata, not additions/removals — color
        // them as context even though they start with +/-.
        return line('ctx', l);
      }
      if (l.startsWith('+')) return line('add', l);
      if (l.startsWith('-')) return line('remove', l);
      if (l.startsWith('@@')) return line('hunk', l);
      return line('ctx', l);
    })
    .join('\n');
}

// Minimal, dependency-free markdown: fenced code blocks, inline code,
// bold/italic, and paragraph breaks. A fenced block tagged `diff` gets
// per-line added/removed highlighting (7.4); every other language renders
// exactly as before.
function renderMarkdown(text) {
  const blocks = [];
  let working = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = blocks.length;
    blocks.push({ lang, code });
    return `\u0000CODE${idx}\u0000`;
  });

  working = escapeHtml(working);

  working = working
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');

  const paragraphs = working.split(/\n{2,}/).map((p) => {
    // NUL (\u0000) is used as a placeholder for code blocks after HTML
    // escaping — it can never appear in the escaped text itself.
    // eslint-disable-next-line no-control-regex
    if (/^\u0000CODE\d+\u0000$/.test(p.trim())) return p.trim();
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  });
  working = paragraphs.join('\n');

  // eslint-disable-next-line no-control-regex -- see note above.
  working = working.replace(/\u0000CODE(\d+)\u0000/g, (_, idx) => {
    const { lang, code } = blocks[Number(idx)];
    // ```diff blocks get per-line added/removed coloring (7.4); every other
    // language renders as one escaped block, exactly as before.
    const body = lang === 'diff' ? renderDiffCode(code).replace(/\n$/, '') : escapeHtml(code).replace(/\n$/, '');
    return `<div class="pre-wrap"><pre><code data-lang="${escapeHtml(lang)}">${body}</code></pre><button class="copy-btn" type="button">Copy</button></div>`;
  });

  return working;
}
// ---------- Export ----------
function chatToMarkdown(chat) {
  const lines = [`# ${chat.title}`, ''];
  for (const msg of chat.messages) {
    lines.push(`## ${msg.role === 'user' ? 'You' : msg.model || 'Assistant'}`, '');
    if (msg.content) lines.push(msg.content, '');
    for (const att of msg.attachments || []) {
      lines.push(`[Attached file: ${att.name}]`, '```', att.content, '```', '');
    }
  }
  return lines.join('\n');
}

function chatToJson(chat) {
  return JSON.stringify(
    {
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      messages: chat.messages,
    },
    null,
    2
  );
}

function exportFilename(chat, extension) {
  const slug = (chat.title || 'chat')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'chat';
  return `${slug}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

// ---------- Auto model routing (Phase 7.11) ----------
// Rules-based pick of which installed model should answer a given prompt.
// Pure so the tests can pin the heuristics; app.js calls it before sending
// when the "Auto model routing" setting is on.
//
// Heuristics, in priority order:
//   1. Code-looking prompts (code fences or code keywords) route to a
//      coding model when one is installed (name matches CODE_MODEL_RE).
//   2. Otherwise: prefer the largest parameter count for long prompts,
//      the smallest for short quick questions — bigger models are slower
//      to load and generate, and "what's 2+2" doesn't need 70B.
//   3. Fall back to the caller's current model when no rule fires.
// Only installed models are ever suggested (names array is the source of
// truth), and the current model always wins ties.
const CODE_MODEL_RE = /(code|coder|starcoder|codellama|deepseek-coder|qwen2\.5-coder|codegemma)/i;
const CODE_PROMPT_RE = /```|\bfunction\b|\bclass\b|\bimplement\b|\brefactor\b|\bdebug\b|\bregex\b|\bsql\b|\bapi\b|;\s*$/i;
const PARAM_RE = /(\d+(?:\.\d+)?)\s*[bbs]/i; // "8b", "70B", "1.5s(b)" tag variants

function paramSizeOf(modelName) {
  const m = PARAM_RE.exec(String(modelName || ''));
  return m ? parseFloat(m[1]) : 0;
}

function suggestModel({ models, text, currentModel }) {
  const names = (models || []).map((m) => (typeof m === 'string' ? m : m.name)).filter(Boolean);
  if (!names.length) return currentModel || '';
  const body = String(text || '');
  const isCode = CODE_PROMPT_RE.test(body);
  const codeModels = names.filter((n) => CODE_MODEL_RE.test(n));
  if (isCode && codeModels.length) {
    // Prefer the currently-selected one among code models to avoid
    // needless switching mid-conversation.
    if (codeModels.includes(currentModel)) return currentModel;
    return codeModels.sort((a, b) => paramSizeOf(b) - paramSizeOf(a))[0];
  }
  const longPrompt = body.length > 2000;
  const candidates = longPrompt
    ? [...names].sort((a, b) => paramSizeOf(b) - paramSizeOf(a))
    : [...names].sort((a, b) => paramSizeOf(a) - paramSizeOf(b));
  return candidates[0] || currentModel || '';
}

// ---------- Quantization advisor (Phase 7.12) ----------
// Suggests smaller installed variants of the same base model. A variant is
// a name that shares the base ("llama3.1:8b" vs "llama3.1:8b-q4_0" or
// "llama3.1:8b-instruct-q4_K_M") and is meaningfully smaller on disk —
// otherwise the suggestion is noise. Pure; app.js renders its output in
// the model health modal.
function quantizationSuggestions(installed) {
  const list = (installed || []).filter((m) => m && typeof m.name === 'string' && typeof m.size === 'number');
  const suggestions = [];
  for (const model of list) {
    // Base = everything before the first variant-ish suffix token.
    const base = model.name.replace(/[-_:](q\d[\w_]*|fph?\d|instruct-q[\w_]*|latest)$/i, '').replace(/[-_](q[\w]*)$/i, '');
    const relatives = list.filter((m) => m.name !== model.name && m.name.startsWith(base) && m.size < model.size * 0.7);
    if (!relatives.length) continue;
    const smallest = relatives.reduce((a, b) => (b.size < a.size ? b : a));
    suggestions.push({
      model: model.name,
      suggestion: smallest.name,
      savedBytes: model.size - smallest.size,
      savedPercent: Math.round((1 - smallest.size / model.size) * 100),
    });
  }
  return suggestions;
}

// ---------- Offline send queue (7.16 completion) ----------
// When a send fails at the network level (server unreachable), the outgoing
// message is parked locally and flushed automatically once connectivity
// returns. The queue is small, text-only, and strictly FIFO — a chat with
// attachments or slash commands is never queued (those need live state that
// may not exist after a reload). Pure here: storage is injected so node
// --test can exercise it without localStorage.
const OFFLINE_QUEUE_KEY = 'ollama_chat_offline_queue';
const OFFLINE_QUEUE_MAX = 20;

function isValidQueuedSend(entry) {
  return Boolean(
    entry &&
    typeof entry === 'object' &&
    typeof entry.chatId === 'string' && entry.chatId.length > 0 &&
    typeof entry.text === 'string' && entry.text.trim().length > 0 &&
    typeof entry.queuedAt === 'number' && Number.isFinite(entry.queuedAt)
  );
}

// Load + sanitize: corrupt or absent storage yields [], stale/malformed
// entries are dropped, and the cap is enforced on read as well as write.
function loadOfflineQueue(storage) {
  let raw;
  try {
    raw = storage.getItem(OFFLINE_QUEUE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(isValidQueuedSend)
    .sort((a, b) => a.queuedAt - b.queuedAt)
    .slice(0, OFFLINE_QUEUE_MAX);
}

function saveOfflineQueue(storage, queue) {
  try {
    storage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue.slice(0, OFFLINE_QUEUE_MAX)));
  } catch {
    // Persistence refused (quota/private mode) — the queue simply doesn't
    // survive the reload; the in-memory copy keeps working this session.
  }
}

// Append (FIFO) with the cap applied on write; returns the new queue.
function enqueueOfflineSend(storage, entry) {
  const queue = loadOfflineQueue(storage);
  const candidate = {
    chatId: String((entry && entry.chatId) || ''),
    text: String((entry && entry.text) || ''),
    // Absent queuedAt defaults to now; a PRESENT-but-invalid one is passed
    // through unchanged so isValidQueuedSend rejects the entry — silently
    // repairing it could reorder the flush sequence.
    queuedAt: entry && entry.queuedAt !== undefined ? entry.queuedAt : Date.now(),
  };
  if (!isValidQueuedSend(candidate)) return queue;
  queue.push(candidate);
  if (queue.length > OFFLINE_QUEUE_MAX) queue.splice(0, queue.length - OFFLINE_QUEUE_MAX);
  saveOfflineQueue(storage, queue);
  return queue;
}

// Take the oldest entry off the queue and persist the remainder. Returns
// the entry, or undefined when the queue is empty.
function shiftOfflineSend(storage) {
  const queue = loadOfflineQueue(storage);
  const first = queue[0];
  if (!first) return undefined;
  saveOfflineQueue(storage, queue.slice(1));
  return first;
}

function offlineQueueCount(storage) {
  return loadOfflineQueue(storage).length;
}

const ChatHelpers = {
  ATTACHMENT_EXTENSIONS,
  ATTACHMENT_MAX_SIZE,
  ATTACHMENT_MAX_COUNT,
  IMAGE_EXTENSIONS,
  IMAGE_MAX_SIZE,
  isPdfAttachment,
  PDF_EXTENSIONS,
  PDF_MAX_SIZE,
  formatBytes,
  truncateMiddle,
  slugify,
  wordCount,
  capitalize,
  attachmentError,
  isImageAttachment,
  imageMimeType,
  buildOllamaMessages,
  CHARS_PER_TOKEN,
  estimateChatTokens,
  formatTokens,
  defaultSettings,
  normalizeSettings,
  cacheKeyFor,
  templateVariables,
  chatToMarkdown,
  chatToJson,
  exportFilename,
  escapeHtml,
  renderMarkdown,
  suggestModel,
  quantizationSuggestions,
  OFFLINE_QUEUE_KEY,
  OFFLINE_QUEUE_MAX,
  loadOfflineQueue,
  enqueueOfflineSend,
  shiftOfflineSend,
  offlineQueueCount,
};

// Loaded as a plain <script> in the browser: publish one global. Loaded via
// require in the test suite: export through CommonJS instead. The typeof
// guard keeps the browser branch from referencing `module` at all.
if (typeof module !== 'undefined') {
  module.exports = ChatHelpers;
} else if (typeof window !== 'undefined') {
  window.ChatHelpers = ChatHelpers;
}
