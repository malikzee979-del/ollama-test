'use strict';

// Tests for citations.js (Phase 7.7): the pure Qdrant-hit → citation-list
// mapping that /api/chat serializes into the X-Citations header.

const test = require('node:test');
const assert = require('node:assert/strict');

const { citationsFromResults, MAX_CITATIONS, SNIPPET_MAX_CHARS } = require('../citations');

test('maps document hits to citations with docName, chunk, score, snippet', () => {
  const citations = citationsFromResults([
    { score: 0.91, payload: { text: 'The warranty lasts two years.', kind: 'document', docName: 'manual.txt', chunk: 3 } },
  ]);
  assert.deepEqual(citations, [
    { docName: 'manual.txt', chunk: 3, score: 0.91, snippet: 'The warranty lasts two years.' },
  ]);
});

test('drops hits without usable text payloads', () => {
  const citations = citationsFromResults([
    null,
    { score: 1 },
    { score: 0.5, payload: {} },
    { score: 0.5, payload: { text: '   ' } },
    { score: 0.4, payload: { text: 'real text', docName: 'd.txt', chunk: 0 } },
  ]);
  assert.equal(citations.length, 1);
  assert.equal(citations[0].docName, 'd.txt');
});

test('fills a placeholder docName and nulls for missing chunk/score', () => {
  const [c] = citationsFromResults([{ payload: { text: 'legacy point' } }]);
  assert.equal(c.docName, '(untitled document)');
  assert.equal(c.chunk, null);
  assert.equal(c.score, null);
});

test('truncates long snippets with an ellipsis', () => {
  const long = 'x'.repeat(SNIPPET_MAX_CHARS + 50);
  const [c] = citationsFromResults([{ score: 1, payload: { text: long, docName: 'big.txt' } }]);
  assert.equal(c.snippet.length, SNIPPET_MAX_CHARS + 1); // + the ellipsis
  assert.ok(c.snippet.endsWith('…'));
});

test('caps the list at MAX_CITATIONS and tolerates non-array input', () => {
  const hits = Array.from({ length: MAX_CITATIONS + 5 }, (_, i) => ({
    score: i / 100,
    payload: { text: `chunk ${i}`, docName: 'd.txt', chunk: i },
  }));
  assert.equal(citationsFromResults(hits).length, MAX_CITATIONS);
  assert.deepEqual(citationsFromResults(null), []);
  assert.deepEqual(citationsFromResults('nope'), []);
});
