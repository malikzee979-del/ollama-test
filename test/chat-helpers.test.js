'use strict';

// Tests for public/chat-helpers.js — the DOM-free frontend helpers. The
// file is loaded here through its CommonJS export guard, exactly the way
// public/app.js loads it as a plain <script> in the browser (via the
// window.ChatHelpers global), so one copy of the logic is exercised by
// both environments.

const test = require('node:test');
const assert = require('node:assert/strict');
const helpers = require('../public/chat-helpers');

// --- attachments ----------------------------------------------------------

test('attachmentError accepts a small, plain-text file with room remaining', () => {
  assert.equal(helpers.attachmentError('notes.txt', 1024, 0), null);
  assert.equal(helpers.attachmentError('script.py', 10, 2), null);
});

test('attachmentError rejects a file once the per-message cap is reached', () => {
  const err = helpers.attachmentError('notes.txt', 10, helpers.ATTACHMENT_MAX_COUNT);
  assert.match(err, /at most 3 files/);
});

test('attachmentError rejects unsupported extensions', () => {
  const err = helpers.attachmentError('photo.png', 10, 0);
  assert.match(err, /not a supported file type/);
  assert.match(helpers.attachmentError('noext', 10, 0), /not a supported file type/);
});

test('attachmentError rejects files over the 200KB cap, with sizes formatted', () => {
  const err = helpers.attachmentError('big.md', helpers.ATTACHMENT_MAX_SIZE + 1, 0);
  assert.equal(helpers.ATTACHMENT_MAX_SIZE, 200 * 1024);
  assert.match(err, /exceeds the 200KB limit/);
});

test('attachmentError matches extensions case-insensitively', () => {
  assert.equal(helpers.attachmentError('UPPER.MD', 10, 0), null);
});

test('formatBytes renders human-readable units', () => {
  assert.equal(helpers.formatBytes(0), '0B');
  assert.equal(helpers.formatBytes(512), '512B');
  assert.equal(helpers.formatBytes(1024), '1KB');
  assert.equal(helpers.formatBytes(1536), '1.5KB');
  assert.equal(helpers.formatBytes(undefined), '');
});

// --- message shaping --------------------------------------------------------

test('buildOllamaMessages puts a trimmed system prompt first, then the messages', () => {
  const msgs = helpers.buildOllamaMessages('  Be concise.  ', [
    { role: 'user', content: 'hi' },
  ]);
  assert.deepEqual(msgs, [
    { role: 'system', content: 'Be concise.' },
    { role: 'user', content: 'hi' },
  ]);
});

test('buildOllamaMessages omits empty system prompts and folds attachments into fenced blocks', () => {
  const msgs = helpers.buildOllamaMessages('', [
    { role: 'user', content: 'what is this?', attachments: [{ name: 'a.txt', content: 'FILE-A' }] },
    { role: 'user', content: '', attachments: [{ name: 'b.md', content: 'FILE-B' }, { name: 'c.txt', content: 'FILE-C' }] },
    { role: 'user', content: 'plain' },
  ]);
  assert.equal(msgs.length, 3);
  assert.equal(msgs[0].content, 'what is this?\n\n[Attached file: a.txt]\n```\nFILE-A\n```');
  // A message with no text of its own sends only the attachment blocks.
  assert.equal(msgs[1].content, '[Attached file: b.md]\n```\nFILE-B\n```\n\n[Attached file: c.txt]\n```\nFILE-C\n```');
  assert.equal(msgs[2].content, 'plain');
});

test('estimateChatTokens uses the shared chars/4 heuristic across system prompt and messages', () => {
  assert.equal(helpers.CHARS_PER_TOKEN, 4);
  const messages = [{ role: 'user', content: 'a'.repeat(100) }];
  assert.equal(helpers.estimateChatTokens('b'.repeat(100), messages), 50);
  // Rounds up: a partial token still occupies a token.
  assert.equal(helpers.estimateChatTokens('b', [{ role: 'user', content: 'a' }]), 1);
});

test('formatTokens abbreviates large counts', () => {
  assert.equal(helpers.formatTokens(999), '999');
  assert.equal(helpers.formatTokens(1000), '1.0k');
  assert.equal(helpers.formatTokens(4096), '4.1k');
});

// --- settings ---------------------------------------------------------------

test('defaultSettings matches the documented defaults', () => {
  assert.deepEqual(helpers.defaultSettings(), {
    systemPrompt: '',
    temperature: 0.8,
    topP: 0.9,
    numCtx: 4096,
    useMemory: false,
    lastModel: '',
  });
});

test('normalizeSettings merges stored values onto defaults with coercion', () => {
  assert.deepEqual(
    helpers.normalizeSettings({ systemPrompt: 'hey', temperature: '0.2', numCtx: '8192', useMemory: true }),
    { systemPrompt: 'hey', temperature: 0.2, topP: 0.9, numCtx: 8192, useMemory: true, lastModel: '' }
  );
});

test('normalizeSettings falls back per-field on corrupt values', () => {
  assert.deepEqual(
    helpers.normalizeSettings({ temperature: NaN, topP: 'abc', numCtx: -5, systemPrompt: 42, useMemory: 'yes' }),
    helpers.defaultSettings()
  );
  assert.deepEqual(helpers.normalizeSettings(null), helpers.defaultSettings());
  assert.deepEqual(helpers.normalizeSettings('garbage'), helpers.defaultSettings());
});

// --- export -----------------------------------------------------------------

test('chatToMarkdown renders title, role headings, content, and fenced attachments', () => {
  const md = helpers.chatToMarkdown({
    title: 'Test chat',
    messages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi', model: 'llama3' },
      { role: 'user', content: 'and this?', attachments: [{ name: 'x.txt', content: 'X' }] },
    ],
  });
  assert.equal(
    md,
    '# Test chat\n\n## You\n\nhello\n\n## llama3\n\nhi\n\n## You\n\nand this?\n\n[Attached file: x.txt]\n```\nX\n```\n'
  );
});

test('chatToJson round-trips the session fields', () => {
  const chat = { id: '1', title: 't', createdAt: 'c', updatedAt: 'u', messages: [{ role: 'user', content: 'x' }] };
  assert.deepEqual(JSON.parse(helpers.chatToJson(chat)), chat);
});

test('exportFilename slugs the title and stamps the date', () => {
  const name = helpers.exportFilename({ title: '  Hello, World! --  ' }, 'md');
  assert.match(name, /^hello-world-\d{4}-\d{2}-\d{2}\.md$/);
  assert.match(helpers.exportFilename({ title: '' }, 'json'), /^chat-\d{4}-\d{2}-\d{2}\.json$/);
});
