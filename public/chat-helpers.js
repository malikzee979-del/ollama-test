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
  const dot = name.lastIndexOf('.');
  const ext = dot === -1 ? '' : name.slice(dot).toLowerCase();
  if (!ATTACHMENT_EXTENSIONS.includes(ext)) {
    return `"${name}" is not a supported file type. Plain-text files only (${ATTACHMENT_EXTENSIONS.join(', ')}).`;
  }
  if (size > ATTACHMENT_MAX_SIZE) {
    return `"${name}" is ${formatBytes(size)}, which exceeds the ${formatBytes(ATTACHMENT_MAX_SIZE)} limit per file.`;
  }
  return null;
}

// ---------- Message shaping ----------
// Builds the messages array sent to /api/chat: an optional system prompt
// first, then the chat's messages with attachments folded into a fenced
// "[Attached file: ...]" block appended to the message content.
function buildOllamaMessages(systemPrompt, chatMessages) {
  const msgs = [];
  if (systemPrompt && systemPrompt.trim()) {
    msgs.push({ role: 'system', content: systemPrompt.trim() });
  }
  for (const m of chatMessages) {
    let content = m.content;
    if (m.attachments && m.attachments.length) {
      const blocks = m.attachments
        .map((a) => `[Attached file: ${a.name}]\n\`\`\`\n${a.content}\n\`\`\``)
        .join('\n\n');
      content = content ? `${content}\n\n${blocks}` : blocks;
    }
    msgs.push({ role: m.role, content });
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
  formatBytes,
  attachmentError,
  buildOllamaMessages,
  CHARS_PER_TOKEN,
  estimateChatTokens,
  formatTokens,
  defaultSettings,
  normalizeSettings,
  chatToMarkdown,
  chatToJson,
  exportFilename,
};

// Loaded as a plain <script> in the browser: publish one global. Loaded via
// require in the test suite: export through CommonJS instead. The typeof
// guard keeps the browser branch from referencing `module` at all.
if (typeof module !== 'undefined') {
  module.exports = ChatHelpers;
} else if (typeof window !== 'undefined') {
  window.ChatHelpers = ChatHelpers;
}
