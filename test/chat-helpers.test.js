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

test('attachmentError accepts a small PDF under the 10MB PDF cap', () => {
  assert.equal(helpers.attachmentError('paper.pdf', 1024, 0), null);
  assert.equal(helpers.attachmentError('REPORT.PDF', 10, 0), null, 'pdf extension match is case-insensitive');
});

test('attachmentError rejects PDFs over the 10MB cap (not the 200KB text cap)', () => {
  assert.match(helpers.attachmentError('paper.pdf', helpers.PDF_MAX_SIZE + 1, 0), /exceeds the 10 MB limit per PDF/);
  assert.equal(helpers.attachmentError('paper.pdf', helpers.PDF_MAX_SIZE, 0), null);
});

test('attachmentError rejects unsupported extensions but accepts images', () => {
  // .png used to be unsupported (text-only pipeline); it now takes the
  // image path, so the "unsupported" case needs a genuinely unknown type.
  assert.match(helpers.attachmentError('prog.exe', 10, 0), /not a supported file type/);
  assert.match(helpers.attachmentError('noext', 10, 0), /not a supported file type/);
  assert.equal(helpers.attachmentError('photo.png', 10, 0), null, 'images are allowed now');
  assert.equal(helpers.attachmentError('PIC.JPG', 10, 0), null, 'image extension match is case-insensitive');
});

test('attachmentError rejects images over the 4MB image cap (not the 200KB text cap)', () => {
  assert.match(helpers.attachmentError('photo.png', helpers.IMAGE_MAX_SIZE + 1, 0), /exceeds the 4 MB limit per image/);
  assert.equal(helpers.attachmentError('photo.png', helpers.IMAGE_MAX_SIZE, 0), null);
});

test('attachmentError rejects files over the 200KB cap, with sizes formatted', () => {
  const err = helpers.attachmentError('big.md', helpers.ATTACHMENT_MAX_SIZE + 1, 0);
  assert.equal(helpers.ATTACHMENT_MAX_SIZE, 200 * 1024);
  assert.match(err, /exceeds the 200 KB limit/);
});

test('attachmentError matches extensions case-insensitively', () => {
  assert.equal(helpers.attachmentError('UPPER.MD', 10, 0), null);
});

test('formatBytes renders human-readable units', () => {
  assert.equal(helpers.formatBytes(0), '0 B');
  assert.equal(helpers.formatBytes(512), '512 B');
  assert.equal(helpers.formatBytes(1024), '1 KB');
  assert.equal(helpers.formatBytes(1536), '1.5 KB');
  assert.equal(helpers.formatBytes(3.2 * 1024 * 1024), '3.2 MB');
  assert.equal(helpers.formatBytes(5 * 1024 ** 3), '5 GB');
  assert.equal(helpers.formatBytes(2 * 1024 ** 4), '2 TB');
  // Rounds to one decimal place instead of trailing into float noise.
  assert.equal(helpers.formatBytes(1024 * 1024 + 512 * 1024), '1.5 MB');
  assert.equal(helpers.formatBytes(undefined), '');
  assert.equal(helpers.formatBytes(null), '');
});

test('truncateMiddle keeps the start and end, replacing the middle with an ellipsis', () => {
  assert.equal(helpers.truncateMiddle('src/lib/very/deep/module.js', 15), 'src/lib…dule.js');
  // Even budget splits evenly; odd budget biases one extra char to the head.
  assert.equal(helpers.truncateMiddle('abcdefghij', 5), 'ab…ij');
  assert.equal(helpers.truncateMiddle('abcdefghij', 6), 'abc…ij');
  assert.equal(helpers.truncateMiddle('abcdefghij', 4), 'ab…j');
  // At or under max: returned unchanged.
  assert.equal(helpers.truncateMiddle('short', 10), 'short');
  assert.equal(helpers.truncateMiddle('exactly10!', 10), 'exactly10!');
  // Degenerate budgets.
  assert.equal(helpers.truncateMiddle('anything', 1), '…');
  assert.equal(helpers.truncateMiddle('anything', 0), '');
  assert.equal(helpers.truncateMiddle('anything', Infinity), '');
  // Null/undefined text collapses to ''; numbers are stringified.
  assert.equal(helpers.truncateMiddle(null, 5), '');
  assert.equal(helpers.truncateMiddle(undefined, 5), '');
  assert.equal(helpers.truncateMiddle(123456789, 7), '123…789');
});

test('slugify turns titles into URL-friendly slugs', () => {
  assert.equal(helpers.slugify('My Cool Chat'), 'my-cool-chat');
  // Lowercased; runs of whitespace/punctuation collapse to one hyphen.
  assert.equal(helpers.slugify('  Hello,   World!  '), 'hello-world');
  assert.equal(helpers.slugify('Q&A: tips & tricks'), 'q-a-tips-tricks');
  assert.equal(helpers.slugify('Version 2.0 — Notes'), 'version-2-0-notes');
  // No leading or trailing hyphens.
  assert.equal(helpers.slugify('--already-slug--'), 'already-slug');
  assert.equal(helpers.slugify('!!!'), '');
  assert.equal(helpers.slugify(''), '');
  assert.equal(helpers.slugify(null), '');
  assert.equal(helpers.slugify(undefined), '');
  assert.equal(helpers.slugify(42), '42');
});

test('wordCount counts words ignoring extra whitespace', () => {
  assert.equal(helpers.wordCount('hello world'), 2);
  // Leading/trailing and repeated whitespace collapse away.
  assert.equal(helpers.wordCount('  one   two\tthree\n\nfour  '), 4);
  assert.equal(helpers.wordCount('single'), 1);
  assert.equal(helpers.wordCount(''), 0);
  assert.equal(helpers.wordCount('   \t\n  '), 0);
  assert.equal(helpers.wordCount(null), 0);
  assert.equal(helpers.wordCount(undefined), 0);
  // Punctuation-attached tokens count as words; numbers count too.
  assert.equal(helpers.wordCount('well-done, yes.'), 2);
  assert.equal(helpers.wordCount(12345), 1);
});

test('capitalize uppercases the first letter of each word', () => {
  assert.equal(helpers.capitalize('hello world'), 'Hello World');
  // Rest of each word is untouched — acronyms stay intact.
  assert.equal(helpers.capitalize('fix the API keys'), 'Fix The API Keys');
  // Whitespace between words is preserved as-is.
  assert.equal(helpers.capitalize('  spaced   out\twords '), '  Spaced   Out\tWords ');
  assert.equal(helpers.capitalize('single'), 'Single');
  assert.equal(helpers.capitalize(''), '');
  assert.equal(helpers.capitalize('   '), '   ');
  assert.equal(helpers.capitalize(null), '');
  assert.equal(helpers.capitalize(undefined), '');
  assert.equal(helpers.capitalize(12345), '12345');
});

// --- message shaping --------------------------------------------------------

test('buildOllamaMessages routes image attachments to Ollama\'s images array, not a text block', () => {
  const chatMessages = [
    { role: 'user', content: 'what is in this picture?', attachments: [
      { name: 'photo.png', content: 'QUJD', size: 3, type: 'image' },
      { name: 'notes.txt', content: 'hello', size: 5 },
    ] },
  ];
  const msgs = helpers.buildOllamaMessages('', chatMessages);
  assert.equal(msgs.length, 1);
  assert.deepEqual(msgs[0].images, ['QUJD'], 'images must ride on the message as base64');
  assert.match(msgs[0].content, /Attached file: notes\.txt/, 'text attachments still fold into content');
  assert.doesNotMatch(msgs[0].content, /QUJD/, 'image bytes must not leak into the text content');

  // Image-only message: content stays the raw text, images still attached.
  const imgsOnly = helpers.buildOllamaMessages('', [
    { role: 'user', content: 'see attached', attachments: [
      { name: 'photo.png', content: 'QUJD', size: 3 },
    ] },
  ]);
  assert.equal(imgsOnly[0].content, 'see attached');
  assert.deepEqual(imgsOnly[0].images, ['QUJD']);

  // No images field when there are none — exactly the pre-image shape.
  const plain = helpers.buildOllamaMessages('', [{ role: 'user', content: 'hi' }]);
  assert.equal('images' in plain[0], false);
});

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
    responseCache: true,
    lastModel: '',
    autoRoute: false,
  });
});

test('normalizeSettings merges stored values onto defaults with coercion', () => {
  assert.deepEqual(
    helpers.normalizeSettings({ systemPrompt: 'hey', temperature: '0.2', numCtx: '8192', useMemory: true }),
    { systemPrompt: 'hey', temperature: 0.2, topP: 0.9, numCtx: 8192, useMemory: true, responseCache: true, lastModel: '', autoRoute: false }
  );
});

test('normalizeSettings honours an explicit responseCache opt-out', () => {
  assert.equal(helpers.normalizeSettings({ responseCache: false }).responseCache, false);
  assert.equal(helpers.normalizeSettings({}).responseCache, true, 'absent on old settings — defaults on');
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

// --- markdown rendering (extracted from app.js) ------------------------------

test('escapeHtml escapes the HTML-significant characters', () => {
  assert.equal(helpers.escapeHtml('<img src=x>&"q"'), '&lt;img src=x&gt;&amp;&quot;q&quot;');
});

test('renderMarkdown renders inline formatting and fenced code blocks', () => {
  const out = helpers.renderMarkdown('# not a heading\n\nplain **bold** and `code`');
  assert.equal(out.includes('<strong>bold</strong>'), true);
  assert.equal(out.includes('<code>code</code>'), true);
  assert.equal(out.includes('# not'), true, 'headings are not supported — literal pass-through');
  assert.match(out, /<p>/);
});

test('renderMarkdown escapes HTML so injected markup cannot execute', () => {
  const out = helpers.renderMarkdown('hello <img src=x onerror=alert(1)> world');
  assert.equal(out.includes('<img'), false, 'raw <img> must never survive');
  assert.equal(out.includes('&lt;img'), true);
});

test('renderMarkdown renders a fenced block with language and copy button, escaping its contents', () => {
  const out = helpers.renderMarkdown('```js\nconst a = "<b>leak</b>";\n```');
  assert.match(out, /data-lang="js"/);
  assert.match(out, /copy-btn/);
  assert.equal(out.includes('<b>leak</b>'), false, 'code contents must be escaped');
  assert.equal(out.includes('&lt;b&gt;leak&lt;/b&gt;'), true);
});

test('renderMarkdown keeps multi-paragraph text separated with <br> inside paragraphs', () => {
  const out = helpers.renderMarkdown('para one\nline two\n\npara two');
  assert.match(out, /<p>para one<br>line two<\/p>/);
  assert.match(out, /<p>para two<\/p>/);
});

// --- Response cache key (Phase 7.13) -----------------------------------------

test('cacheKeyFor is stable and order-sensitive over the request shape', () => {
  const base = { model: 'llama3', messages: [{ role: 'user', content: 'hi' }], options: { temperature: 0.8 }, serverId: 0 };
  assert.equal(helpers.cacheKeyFor(base), helpers.cacheKeyFor({ ...base, options: { ...base.options } }));

  // Any request-relevant change must change the key...
  assert.notEqual(helpers.cacheKeyFor(base), helpers.cacheKeyFor({ ...base, model: 'llama2' }));
  assert.notEqual(helpers.cacheKeyFor(base), helpers.cacheKeyFor({ ...base, messages: [...base.messages, { role: 'assistant', content: 'x' }] }));
  assert.notEqual(helpers.cacheKeyFor(base), helpers.cacheKeyFor({ ...base, serverId: 1 }));

  // ...but field order inside options must not (same sampling, same reply).
  assert.equal(
    helpers.cacheKeyFor({ model: 'm', messages: [], options: { a: 1, b: 2 }, serverId: 0 }),
    helpers.cacheKeyFor({ model: 'm', messages: [], options: { b: 2, a: 1 }, serverId: 0 })
  );
});

// --- Prompt shortcut variables (Phase 7.3) -----------------------------------

test('templateVariables extracts deduplicated first-appearance variable names', () => {
  assert.deepEqual(helpers.templateVariables('Translate to {{language}}: {{text}}'), ['language', 'text']);
  assert.deepEqual(helpers.templateVariables('{{x}} and {{ x }} and {{x}}'), ['x']);
  assert.deepEqual(helpers.templateVariables('no variables here'), []);
  assert.deepEqual(helpers.templateVariables(null), []);
});

// --- Diff highlighting (Phase 7.4) -------------------------------------------

test('renderMarkdown highlights ```diff lines as add/remove/hunk/context', () => {
  const out = helpers.renderMarkdown('```diff\n@@ -1,2 +1,2 @@\n-old line\n+new line\n context\n```');
  assert.match(out, /diff-hunk">@@ /);
  assert.match(out, /diff-remove">-old line</);
  assert.match(out, /diff-add">\+new line</);
  assert.match(out, /diff-ctx"> context</);
});

test('renderMarkdown treats +++/--- file headers as context, not add/remove', () => {
  const out = helpers.renderMarkdown('```diff\n--- a/file.js\n+++ b/file.js\n```');
  assert.equal(out.includes('diff-add'), false);
  assert.equal(out.includes('diff-remove'), false);
  assert.match(out, /diff-ctx">--- a\/file\.js</);
});

test('renderMarkdown escapes diff content before wrapping it in class spans', () => {
  const out = helpers.renderMarkdown('```diff\n+<img src=x onerror=alert(1)>\n```');
  assert.equal(out.includes('<img'), false);
  assert.match(out, /diff-add">\+&lt;img/);
});

test('renderMarkdown leaves non-diff code blocks untouched by diff classes', () => {
  const out = helpers.renderMarkdown('```js\n+not a diff\n```');
  assert.equal(out.includes('diff-add'), false);
  assert.equal(out.includes('+not a diff'), true);
});

// ---------- Auto model routing (7.11) ----------
test('suggestModel routes code-looking prompts to the coding model', () => {
  const models = [{ name: 'llama3:8b' }, { name: 'qwen2.5-coder:7b' }, { name: 'llama3:70b' }];
  assert.equal(helpers.suggestModel({ models, text: '```js\nconsole.log(1)\n```', currentModel: 'llama3:8b' }), 'qwen2.5-coder:7b');
  assert.equal(helpers.suggestModel({ models, text: 'write a function that sorts', currentModel: 'llama3:8b' }), 'qwen2.5-coder:7b');
});

test('suggestModel keeps the current model when it is already the coding model', () => {
  const models = [{ name: 'qwen2.5-coder:7b' }, { name: 'llama3:8b' }];
  assert.equal(helpers.suggestModel({ models, text: 'refactor this class', currentModel: 'qwen2.5-coder:7b' }), 'qwen2.5-coder:7b');
});

test('suggestModel prefers the smallest model for short prompts', () => {
  const models = [{ name: 'llama3:70b' }, { name: 'llama3:8b' }];
  assert.equal(helpers.suggestModel({ models, text: 'what is 2+2?', currentModel: 'llama3:70b' }), 'llama3:8b');
});

test('suggestModel prefers the largest model for long prompts', () => {
  const models = [{ name: 'llama3:8b' }, { name: 'llama3:70b' }];
  const long = 'x'.repeat(3000);
  assert.equal(helpers.suggestModel({ models, text: long, currentModel: 'llama3:8b' }), 'llama3:70b');
});

test('suggestModel falls back to the current model with no installed models or no signal', () => {
  assert.equal(helpers.suggestModel({ models: [], text: 'hi', currentModel: 'llama3:8b' }), 'llama3:8b');
  const models = [{ name: 'llama3:8b' }];
  assert.equal(helpers.suggestModel({ models, text: 'hello there friend', currentModel: 'llama3:8b' }), 'llama3:8b');
});

test('normalizeSettings keeps autoRoute (default off)', () => {
  assert.equal(helpers.normalizeSettings(null).autoRoute, false);
  assert.equal(helpers.normalizeSettings({ autoRoute: true }).autoRoute, true);
  assert.equal(helpers.normalizeSettings({ autoRoute: 'yes' }).autoRoute, false);
});

// ---------- Quantization advisor (7.12) ----------
test('quantizationSuggestions flags meaningfully smaller variants of the same base', () => {
  const installed = [
    { name: 'llama3.1:8b-q8', size: 8_000_000_000 },
    { name: 'llama3.1:8b-q4', size: 4_000_000_000 },
    { name: 'mistral:7b', size: 4_100_000_000 },
  ];
  const out = helpers.quantizationSuggestions(installed);
  assert.equal(out.length, 1);
  assert.equal(out[0].model, 'llama3.1:8b-q8');
  assert.equal(out[0].suggestion, 'llama3.1:8b-q4');
  assert.equal(out[0].savedPercent, 50);
});

test('quantizationSuggestions ignores small differences and missing sizes', () => {
  const installed = [
    { name: 'llama3.1:8b-q8', size: 8_000_000_000 },
    { name: 'llama3.1:8b-q7', size: 7_900_000_000 }, // only ~1% smaller
    { name: 'no-size' },
    null,
  ];
  assert.deepEqual(helpers.quantizationSuggestions(installed), []);
});

// ---------- Offline send queue (7.16 completion) ----------
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

test('offline queue roundtrips FIFO and drops malformed entries', () => {
  const storage = fakeStorage();
  assert.equal(helpers.offlineQueueCount(storage), 0);
  assert.equal(helpers.shiftOfflineSend(storage), undefined);

  helpers.enqueueOfflineSend(storage, { chatId: 'c1', text: 'first', queuedAt: 100 });
  helpers.enqueueOfflineSend(storage, { chatId: 'c2', text: 'second', queuedAt: 200 });
  assert.equal(helpers.offlineQueueCount(storage), 2);

  const first = helpers.shiftOfflineSend(storage);
  assert.equal(first.chatId, 'c1');
  assert.equal(helpers.offlineQueueCount(storage), 1);
  assert.equal(helpers.shiftOfflineSend(storage).chatId, 'c2');
  assert.equal(helpers.shiftOfflineSend(storage), undefined);
});

test('offline queue rejects entries without chatId, text, or finite queuedAt', () => {
  const storage = fakeStorage();
  helpers.enqueueOfflineSend(storage, { text: 'no chat' });
  helpers.enqueueOfflineSend(storage, { chatId: 'c1', text: '   ' });
  helpers.enqueueOfflineSend(storage, { chatId: 'c1', text: 'bad time', queuedAt: 'x' });
  helpers.enqueueOfflineSend(storage, null);
  assert.equal(helpers.offlineQueueCount(storage), 0);

  // queuedAt is optional — it defaults to Date.now()
  helpers.enqueueOfflineSend(storage, { chatId: 'c1', text: 'ok' });
  assert.equal(helpers.offlineQueueCount(storage), 1);
});

test('offline queue enforces its cap and sorts by queuedAt on load', () => {
  const storage = fakeStorage();
  for (let i = 0; i < helpers.OFFLINE_QUEUE_MAX + 5; i++) {
    helpers.enqueueOfflineSend(storage, { chatId: 'c' + i, text: 'm' + i, queuedAt: i });
  }
  assert.equal(helpers.offlineQueueCount(storage), helpers.OFFLINE_QUEUE_MAX);
  // Cap policy: the OLDEST overflow is dropped, the newest kept — the fresh
  // sends are the ones closest to what the user last typed, and the dropped
  // ones would have flushed first anyway (FIFO) had the connection held.
  const remaining = helpers.loadOfflineQueue(storage);
  assert.equal(remaining[0].chatId, 'c5');
  assert.equal(remaining[remaining.length - 1].chatId, 'c' + (helpers.OFFLINE_QUEUE_MAX + 4));
});

test('offline queue recovers from corrupt storage', () => {
  const storage = fakeStorage();
  storage.setItem(helpers.OFFLINE_QUEUE_KEY, '{not json');
  assert.deepEqual(helpers.loadOfflineQueue(storage), []);

  storage.setItem(helpers.OFFLINE_QUEUE_KEY, '{"chatId":"c1"}'); // object, not array
  assert.deepEqual(helpers.loadOfflineQueue(storage), []);

  storage.setItem(helpers.OFFLINE_QUEUE_KEY, JSON.stringify([
    { chatId: 'ok', text: 'fine', queuedAt: 5 },
    'garbage',
    { chatId: 'missing-text', queuedAt: 6 },
  ]));
  assert.equal(helpers.offlineQueueCount(storage), 1);
});
