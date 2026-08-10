// Chat/context compaction.
//
// When a conversation's message history grows too large for a model's
// context window, this module summarizes the older turns via an injected
// LLM-calling function and replaces them with a single compact system
// message, while keeping the most recent turns verbatim.
//
// This module has no knowledge of Ollama, HTTP, or streaming — it operates
// purely on the in-memory `messages` array and an injected `summarize`
// function, which keeps it trivially unit-testable without a live LLM.

'use strict';

// Stable, greppable marker prefix used to tag the summary message we
// generate, so a later compaction pass can recognize it and avoid
// re-summarizing content that's already been folded into a summary.
const MARKER = '[compacted-summary]';

const DEFAULTS = {
  keepRecent: 8,
  maxMessages: 40,
  // No real tokenizer dependency here — this is a rough chars/4 ~= tokens
  // heuristic. ~24000 chars ~= ~6000 tokens, a conservative slice of a
  // typical local model's context window, left generous on purpose since
  // this is just a "should we bother compacting" trigger, not a hard cap.
  maxChars: 24000,
};

function totalChars(messages) {
  let sum = 0;
  for (const m of messages) {
    sum += (m && typeof m.content === 'string') ? m.content.length : 0;
  }
  return sum;
}

function isMarkerMessage(m) {
  return !!m && m.role === 'system' && typeof m.content === 'string' && m.content.startsWith(MARKER);
}

function stripMarker(content) {
  return content.slice(MARKER.length).trim();
}

/**
 * Compact a message history by summarizing older turns and keeping the most
 * recent ones verbatim.
 *
 * @param {object} opts
 * @param {Array<{role: string, content: string}>} opts.messages - Standard
 *   chat messages array.
 * @param {number} [opts.keepRecent=8] - Number of most recent messages to
 *   always keep verbatim (never summarized).
 * @param {number} [opts.maxMessages=40] - Compact if messages.length
 *   exceeds this.
 * @param {number} [opts.maxChars=24000] - Compact if total content length
 *   (chars, roughly chars/4 ~= tokens) exceeds this.
 * @param {(messagesToSummarize: Array<{role: string, content: string}>) =>
 *   Promise<string>} opts.summarize - Injected async function that returns
 *   a summary string for the given slice of messages. In production this
 *   calls the LLM; in tests it can be a mock.
 * @returns {Promise<Array<{role: string, content: string}>>} A new
 *   messages array (summary + recent messages) if compaction triggered and
 *   succeeded, otherwise the original `messages` array unchanged.
 */
async function compactMessages({
  messages,
  keepRecent = DEFAULTS.keepRecent,
  maxMessages = DEFAULTS.maxMessages,
  maxChars = DEFAULTS.maxChars,
  summarize,
} = {}) {
  if (!Array.isArray(messages)) return messages;

  const shouldCompact = messages.length > maxMessages || totalChars(messages) > maxChars;
  if (!shouldCompact) return messages;

  if (typeof summarize !== 'function') {
    console.warn('[compaction] compactMessages called without a "summarize" function; skipping compaction.');
    return messages;
  }

  // Find the last existing summary marker (we always emit it as the first
  // message of a compacted array, but scan defensively in case callers
  // pass something else in).
  let markerIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (isMarkerMessage(messages[i])) {
      markerIdx = i;
      break;
    }
  }

  const existingSummary = markerIdx === -1 ? null : stripMarker(messages[markerIdx].content);
  // Only messages after the existing summary need to ever be considered —
  // anything before it has already been folded into `existingSummary` and
  // must not be re-summarized from scratch.
  const afterMarker = markerIdx === -1 ? messages : messages.slice(markerIdx + 1);

  const recentCount = Math.min(keepRecent, afterMarker.length);
  const toSummarize = afterMarker.slice(0, afterMarker.length - recentCount);
  const recent = afterMarker.slice(afterMarker.length - recentCount);

  if (toSummarize.length === 0) {
    // Nothing new to fold in (e.g. everything left is within keepRecent) —
    // compacting further would mean summarizing messages we're supposed to
    // keep verbatim, so leave things as-is.
    return messages;
  }

  let newSummaryText;
  try {
    newSummaryText = await summarize(toSummarize);
  } catch (err) {
    // Fail open: never let a compaction/summarization failure break the
    // actual chat request.
    console.warn('[compaction] summarize() failed, skipping compaction for this request:', err && err.message ? err.message : err);
    return messages;
  }

  if (typeof newSummaryText !== 'string' || !newSummaryText.trim()) {
    console.warn('[compaction] summarize() returned an empty summary, skipping compaction for this request.');
    return messages;
  }

  const mergedSummary = existingSummary
    ? `${existingSummary}\n\n${newSummaryText.trim()}`
    : newSummaryText.trim();

  return [
    { role: 'system', content: `${MARKER} ${mergedSummary}` },
    ...recent,
  ];
}

module.exports = { compactMessages, MARKER, DEFAULTS };
