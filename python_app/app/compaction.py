"""Chat/context compaction. Port of compaction.js.

When a conversation's message history grows too large for a model's
context window, this module summarizes the older turns via an injected
async `summarize` callable and replaces them with a single compact system
message, while keeping the most recent turns verbatim.

Has no knowledge of Ollama/HTTP/streaming — operates purely on the
in-memory `messages` list and an injected `summarize` coroutine function,
which keeps it trivially unit-testable without a live LLM.
"""
from typing import Awaitable, Callable, List, Optional

from . import logger

MARKER = "[compacted-summary]"

DEFAULTS = {
    "keep_recent": 8,
    "max_messages": 40,
    # No real tokenizer here — rough chars/4 ~= tokens heuristic.
    "max_chars": 24000,
}


def _total_chars(messages: List[dict]) -> int:
    return sum(len(m.get("content", "")) for m in messages if isinstance(m.get("content"), str))


def _is_marker_message(m: dict) -> bool:
    return bool(m) and m.get("role") == "system" and isinstance(m.get("content"), str) and m["content"].startswith(MARKER)


def _strip_marker(content: str) -> str:
    return content[len(MARKER):].strip()


async def compact_messages(
    messages: List[dict],
    summarize: Callable[[List[dict]], Awaitable[str]],
    keep_recent: int = DEFAULTS["keep_recent"],
    max_messages: int = DEFAULTS["max_messages"],
    max_chars: int = DEFAULTS["max_chars"],
) -> List[dict]:
    if not isinstance(messages, list):
        return messages

    should_compact = len(messages) > max_messages or _total_chars(messages) > max_chars
    if not should_compact:
        return messages

    if summarize is None:
        logger.warn('[compaction] compact_messages called without a "summarize" function; skipping compaction.')
        return messages

    marker_idx = -1
    for i in range(len(messages) - 1, -1, -1):
        if _is_marker_message(messages[i]):
            marker_idx = i
            break

    existing_summary: Optional[str] = _strip_marker(messages[marker_idx]["content"]) if marker_idx != -1 else None
    after_marker = messages if marker_idx == -1 else messages[marker_idx + 1:]

    recent_count = min(keep_recent, len(after_marker))
    to_summarize = after_marker[: len(after_marker) - recent_count]
    recent = after_marker[len(after_marker) - recent_count:]

    if not to_summarize:
        return messages

    try:
        new_summary_text = await summarize(to_summarize)
    except Exception as err:  # noqa: BLE001 - fail open, never break the actual chat request
        logger.warn(f"[compaction] summarize() failed, skipping compaction for this request: {err}")
        return messages

    if not isinstance(new_summary_text, str) or not new_summary_text.strip():
        logger.warn("[compaction] summarize() returned an empty summary, skipping compaction for this request.")
        return messages

    merged_summary = (
        f"{existing_summary}\n\n{new_summary_text.strip()}" if existing_summary else new_summary_text.strip()
    )

    return [{"role": "system", "content": f"{MARKER} {merged_summary}"}, *recent]
