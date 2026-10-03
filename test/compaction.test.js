'use strict';

// Tests for compaction.js's compactMessages(): purely in-memory logic, no
// filesystem/network involved, driven entirely through the injected
// `summarize` function per its own design (see the module's doc comment).

const test = require('node:test');
const assert = require('node:assert/strict');
const { compactMessages, estimateTokens, MARKER, DEFAULTS, CHARS_PER_TOKEN } = require('../compaction');

function msg(role, content) {
  return { role, content };
}

test('returns the original array unchanged when under both thresholds', async () => {
  const messages = [msg('user', 'hi'), msg('assistant', 'hello')];
  let called = false;
  const result = await compactMessages({
    messages,
    summarize: async () => {
      called = true;
      return 'summary';
    },
  });
  assert.equal(result, messages, 'must be the same array reference when no compaction happens');
  assert.equal(called, false, 'summarize must not be called when compaction does not trigger');
});

test('triggers on message-count threshold and keeps the most recent messages verbatim', async () => {
  const messages = [];
  for (let i = 0; i < 10; i++) messages.push(msg('user', `msg${i}`));

  const result = await compactMessages({
    messages,
    maxMessages: 5,
    keepRecent: 3,
    summarize: async (toSummarize) => `summarized ${toSummarize.length} messages`,
  });

  assert.equal(result.length, 4); // 1 summary + 3 kept recent
  assert.equal(result[0].role, 'system');
  assert.ok(result[0].content.startsWith(MARKER));
  assert.ok(result[0].content.includes('summarized 7 messages'));
  assert.deepEqual(result.slice(1), messages.slice(-3));
});

test('triggers on char-count threshold even with few messages', async () => {
  const longContent = 'x'.repeat(1000);
  const messages = [msg('user', longContent), msg('assistant', longContent), msg('user', 'short')];

  const result = await compactMessages({
    messages,
    maxMessages: 100,
    maxChars: 1500,
    keepRecent: 1,
    summarize: async () => 'condensed summary',
  });

  assert.equal(result.length, 2);
  assert.equal(result[0].content, `${MARKER} condensed summary`);
  assert.deepEqual(result[1], messages[2]);
});

test('merges a new summary with an existing [compacted-summary] marker instead of re-summarizing from scratch', async () => {
  const messages = [
    { role: 'system', content: `${MARKER} earlier events happened` },
    msg('user', 'a'),
    msg('assistant', 'b'),
    msg('user', 'c'),
    msg('assistant', 'd'),
  ];

  let summarizedSlice;
  const result = await compactMessages({
    messages,
    maxMessages: 3,
    keepRecent: 1,
    summarize: async (toSummarize) => {
      summarizedSlice = toSummarize;
      return 'new events happened';
    },
  });

  // Only messages after the marker should have been passed to summarize —
  // never re-summarizing what's already folded into the existing summary.
  assert.equal(summarizedSlice.length, 3);
  assert.deepEqual(summarizedSlice, [msg('user', 'a'), msg('assistant', 'b'), msg('user', 'c')]);

  assert.equal(result[0].content, `${MARKER} earlier events happened\n\nnew events happened`);
  assert.deepEqual(result[1], msg('assistant', 'd'));
});

test('fails open (returns original messages) when summarize() throws', async () => {
  const messages = [];
  for (let i = 0; i < 50; i++) messages.push(msg('user', `msg${i}`));

  const result = await compactMessages({
    messages,
    summarize: async () => {
      throw new Error('ollama unreachable');
    },
  });

  assert.equal(result, messages);
});

test('fails open when summarize() returns an empty string', async () => {
  const messages = [];
  for (let i = 0; i < 50; i++) messages.push(msg('user', `msg${i}`));

  const result = await compactMessages({
    messages,
    summarize: async () => '   ',
  });

  assert.equal(result, messages);
});

test('does nothing when everything left after the marker is within keepRecent', async () => {
  const messages = [
    { role: 'system', content: `${MARKER} old stuff` },
    msg('user', 'a'),
    msg('assistant', 'b'),
  ];

  let called = false;
  const result = await compactMessages({
    messages,
    maxMessages: 1, // force shouldCompact = true
    keepRecent: 5, // but everything after the marker fits within keepRecent
    summarize: async () => {
      called = true;
      return 'x';
    },
  });

  assert.equal(result, messages);
  assert.equal(called, false);
});

test('skips compaction (with a warning, not a throw) when no summarize function is provided', async () => {
  const messages = [];
  for (let i = 0; i < 50; i++) messages.push(msg('user', `msg${i}`));
  const result = await compactMessages({ messages });
  assert.equal(result, messages);
});

test('non-array input is returned unchanged', async () => {
  const notAnArray = null;
  const result = await compactMessages({ messages: notAnArray, summarize: async () => 'x' });
  assert.equal(result, notAnArray);
});

test('DEFAULTS match the documented values', () => {
  assert.equal(DEFAULTS.keepRecent, 8);
  assert.equal(DEFAULTS.maxMessages, 40);
  assert.equal(DEFAULTS.maxChars, 24000);
});

// estimateTokens() is the shared chars/4 heuristic: the UI's context meter
// mirrors it so the number shown to the user is the one this module's
// compaction trigger is reasoning about.
test('estimateTokens counts a string at roughly four characters per token', () => {
  assert.equal(CHARS_PER_TOKEN, 4);
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  // Rounds up: a partial token still occupies a token.
  assert.equal(estimateTokens('abcde'), 2);
});

test('estimateTokens sums the content of a messages array', () => {
  const messages = [msg('user', 'a'.repeat(400)), msg('assistant', 'b'.repeat(400))];
  assert.equal(estimateTokens(messages), 200);
});

test('estimateTokens returns 0 for unrecognized input', () => {
  assert.equal(estimateTokens(null), 0);
  assert.equal(estimateTokens(undefined), 0);
  assert.equal(estimateTokens(42), 0);
});

// --- injected memory messages (RAG) ---------------------------------------
//
// server.js injects a `[retrieved-memory]` system message into the outgoing
// messages array — either at index 0, or right after a leading
// compacted-summary marker. These tests pin the interaction contract: the
// memory message must never be mistaken for the compaction marker, and a
// later compaction pass must still find the real summary and keep the
// memory message (which sits before the marker) untouched.

test('compactMessages finds the marker when a memory message precedes it', async () => {
  const memory = { role: 'system', content: '[retrieved-memory] Relevant excerpts:\n- the user likes blue' };
  const summary = { role: 'system', content: `${MARKER} a summary of earlier turns` };
  const messages = [
    memory,
    summary,
    ...Array.from({ length: 50 }, (_, i) => msg(i % 2 === 0 ? 'user' : 'assistant', `turn ${i}`)),
  ];

  const result = await compactMessages({ messages, summarize: async () => 'a newer summary' });

  // The compaction pass must find the REAL marker (index 1), not the memory
  // message (index 0), and fold everything after it — including future
  // re-injected memory — correctly.
  assert.equal(result[0].content.startsWith(MARKER), true, 'the summary must stay first');
  assert.match(result[0].content, /a newer summary/);
  // The memory message sat before the marker, so it must never be
  // re-summarized into the summary text.
  assert.doesNotMatch(result[0].content, /the user likes blue/);
});

test('compactMessages never summarizes a trailing memory-only conversation', async () => {
  // A fresh conversation that is just [memory, user] is under every limit
  // anyway; this guards the shape server.js injects on a short chat.
  const messages = [
    { role: 'system', content: '[retrieved-memory] Relevant excerpts:\n- the user likes blue' },
    msg('user', 'hello'),
  ];
  const result = await compactMessages({ messages, summarize: async () => 'should not run' });
  assert.equal(result, messages);
});
