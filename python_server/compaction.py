"""Chat/context compaction.

When a conversation's message history grows too large for a model's
context window, this module summarizes the older turns via an injected
LLM-calling function and replaces them with a single compact system
message, while keeping the most recent turns verbatim.

This module has no knowledge of Ollama, HTTP, or streaming — it operates
purely on the in-memory `messages` list and an injected `summarize`
coroutine, which keeps it trivially unit-testable without a live LLM.
"""

from __future__ import annotations

import asyncio
from typing import Awaitable, Callable, Sequence

import logger

# Stable, greppable marker prefix used to tag the summary message we
# generate, so a later compaction pass can recognize it and avoid
# re-summarizing content that's already been folded into a summary.
MARKER = "[compacted-summary]"

# No real tokenizer dependency (see DEFAULTS["maxChars"] below): 4
# characters per token is the rough ratio this module's trigger is
# calibrated on, and it is exported so anything else showing a token
# figure to the user — the frontend's context meter — reports the same
# numbers the compaction trigger is reasoning about.
CHARS_PER_TOKEN = 4

DEFAULTS = {
    "keepRecent": 8,
    "maxMessages": 40,
    # No real tokenizer dependency here — this is a rough chars/4 ~= tokens
    # heuristic. ~24000 chars ~= ~6000 tokens, a conservative slice of a
    # typical local model's context window.
    "maxChars": 24000,
}

SummarizeFn = Callable[[Sequence[dict]], Awaitable[str]]


def total_chars(messages: Sequence[dict]) -> int:
    total = 0
    for m in messages:
        if m and isinstance(m.get("content"), str):
            total += len(m["content"])
    return total


def estimate_tokens(input_: object) -> int:
    """Rough token estimate for a string or a messages array, using the
    CHARS_PER_TOKEN heuristic above. Deliberately an estimate: it is used
    for "should we compact" judgements, never as a hard cap."""
    if isinstance(input_, str):
        return -(-len(input_) // CHARS_PER_TOKEN)
    if isinstance(input_, (list, tuple)):
        return -(-total_chars(input_) // CHARS_PER_TOKEN)
    return 0


def _is_marker_message(m: object) -> bool:
    return (
        isinstance(m, dict)
        and m.get("role") == "system"
        and isinstance(m.get("content"), str)
        and m["content"].startswith(MARKER)
    )


def _strip_marker(content: str) -> str:
    return content[len(MARKER):].strip()


async def compact_messages(
    *,
    messages: list[dict],
    keep_recent: int = DEFAULTS["keepRecent"],
    max_messages: int = DEFAULTS["maxMessages"],
    max_chars: int = DEFAULTS["maxChars"],
    summarize: SummarizeFn | None = None,
) -> list[dict]:
    """Compact a message history by summarizing older turns and keeping the
    most recent ones verbatim.

    Returns a NEW messages list (summary + recent messages) if compaction
    triggered and succeeded, otherwise the original `messages` list object
    unchanged (so callers can use an identity check for "did compaction
    happen", exactly like the JS version).
    """
    if not isinstance(messages, list):
        return messages

    should_compact = len(messages) > max_messages or total_chars(messages) > max_chars
    if not should_compact:
        return messages

    if not callable(summarize):
        logger.warn(
            "[compaction] compact_messages called without a 'summarize' function; skipping compaction."
        )
        return messages

    # Find the last existing summary marker (we always emit it as the first
    # message of a compacted array, but scan defensively in case callers
    # pass something else in).
    marker_idx = -1
    for i in range(len(messages) - 1, -1, -1):
        if _is_marker_message(messages[i]):
            marker_idx = i
            break

    existing_summary = (
        None if marker_idx == -1 else _strip_marker(messages[marker_idx]["content"])
    )
    # Only messages after the existing summary need to ever be considered —
    # anything before it has already been folded into `existing_summary` and
    # must not be re-summarized from scratch.
    after_marker = messages if marker_idx == -1 else messages[marker_idx + 1:]

    recent_count = min(keep_recent, len(after_marker))
    to_summarize = after_marker[: len(after_marker) - recent_count]
    recent = after_marker[len(after_marker) - recent_count:]

    if not to_summarize:
        # Nothing new to fold in (e.g. everything left is within
        # keep_recent) — compacting further would mean summarizing messages
        # we're supposed to keep verbatim, so leave things as-is.
        return messages

    try:
        new_summary_text = await summarize(to_summarize)
    except Exception as err:
        # Fail open: never let a compaction/summarization failure break the
        # actual chat request.
        logger.warn(
            "[compaction] summarize() failed, skipping compaction for this request:",
            str(err),
        )
        return messages

    if not isinstance(new_summary_text, str) or not new_summary_text.strip():
        logger.warn(
            "[compaction] summarize() returned an empty summary, skipping compaction for this request."
        )
        return messages

    merged_summary = (
        f"{existing_summary}\n\n{new_summary_text.strip()}"
        if existing_summary
        else new_summary_text.strip()
    )

    return [
        {"role": "system", "content": f"{MARKER} {merged_summary}"},
        *recent,
    ]
