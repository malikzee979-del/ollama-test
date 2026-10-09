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
  return `${Math.round(val * 10) / 10}${units[i]}`;
}

// Returns the user-facing error message for a would-be attachment, or null
// if it is acceptable. `pendingCount` is how many attachments are already
// staged on the message.
function attachmentError(name, size, pendingCount) {
  if (pendingCount >= ATTACHMENT_MAX_COUNT) {
    return `You can attach at most ${ATTACHMENT_MAX_COUNT} files per message.`;
  }
  const isImage = isImageAttachment(name);
  if (!isImage && !ATTACHMENT_EXTENSIONS.includes(extensionOf(name))) {
    return `"${name}" is not a supported file type. Plain-text files (${ATTACHMENT_EXTENSIONS.join(', ')}) or images (${IMAGE_EXTENSIONS.join(', ')}) only.`;
  }
  const cap = isImage ? IMAGE_MAX_SIZE : ATTACHMENT_MAX_SIZE;
  if (size > cap) {
    return `"${name}" is ${formatBytes(size)}, which exceeds the ${formatBytes(cap)} limit per ${isImage ? 'image' : 'file'}.`;
  }
  return null;
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
  return { systemPrompt: '', temperature: 0.8, topP: 0.9, numCtx: 4096, useMemory: false, lastModel: '' };
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
    lastModel: typeof stored.lastModel === 'string' ? stored.lastModel : defaults.lastModel,
  };
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

// Minimal, dependency-free markdown: fenced code blocks, inline code,
// bold/italic, and paragraph breaks.
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
    const escaped = escapeHtml(code).replace(/\n$/, '');
    return `<div class="pre-wrap"><pre><code data-lang="${escapeHtml(lang)}">${escaped}</code></pre><button class="copy-btn" type="button">Copy</button></div>`;
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

const ChatHelpers = {
  ATTACHMENT_EXTENSIONS,
  ATTACHMENT_MAX_SIZE,
  ATTACHMENT_MAX_COUNT,
  IMAGE_EXTENSIONS,
  IMAGE_MAX_SIZE,
  formatBytes,
  attachmentError,
  isImageAttachment,
  imageMimeType,
  buildOllamaMessages,
  CHARS_PER_TOKEN,
  estimateChatTokens,
  formatTokens,
  defaultSettings,
  normalizeSettings,
  chatToMarkdown,
  chatToJson,
  exportFilename,
  escapeHtml,
  renderMarkdown,
};

// Loaded as a plain <script> in the browser: publish one global. Loaded via
// require in the test suite: export through CommonJS instead. The typeof
// guard keeps the browser branch from referencing `module` at all.
if (typeof module !== 'undefined') {
  module.exports = ChatHelpers;
} else if (typeof window !== 'undefined') {
  window.ChatHelpers = ChatHelpers;
}
