"""Minimal file-based JSON store for chat sessions.

Why hand-rolled JSON instead of a dependency: this project's stated
philosophy is "no build step, minimal deps". A tiny synchronous JSON-file
store keeps the near-zero-extra-dependency footprint (stdlib `json` +
`os` only), needs no database server, and is more than sufficient for a
single-user local app with a handful of chat sessions.

Persistence model: the whole sessions dict is kept in memory and written
to disk on every mutation. Writes are atomic (write to a temp file, then
rename over the real file) so a crash mid-write can't corrupt the store.
A lock serializes access across request-handler threads.
"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from datetime import datetime, timezone

# DATA_FILE is overridable via SESSIONS_DATA_FILE so tests can point at an
# isolated temp file instead of the real local data/sessions.json — unset,
# behavior is unchanged.
DATA_FILE = os.environ.get("SESSIONS_DATA_FILE") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "data", "sessions.json"
)
DATA_DIR = os.path.dirname(DATA_FILE)

_lock = threading.Lock()


def _ensure_data_dir() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _load() -> dict:
    _ensure_data_dir()
    if not os.path.exists(DATA_FILE):
        return {}
    try:
        with open(DATA_FILE, encoding="utf-8") as f:
            raw = f.read()
        if not raw.strip():
            return {}
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except (OSError, ValueError) as err:
        # Corrupt or unreadable data file: don't crash the server, start
        # empty instead. The bad file is left on disk in case manual
        # recovery is wanted.
        print(f"[db] Failed to read {DATA_FILE}, starting with an empty store: {err}")
        return {}


def _persist(sessions: dict) -> None:
    _ensure_data_dir()
    tmp_file = f"{DATA_FILE}.{os.getpid()}.{int(time.time() * 1000)}.tmp"
    with open(tmp_file, "w", encoding="utf-8") as f:
        json.dump(sessions, f, indent=2)
    os.replace(tmp_file, DATA_FILE)


_sessions: dict = _load()


def _to_summary(session: dict) -> dict:
    return {
        "id": session["id"],
        "title": session["title"],
        "createdAt": session["createdAt"],
        "updatedAt": session["updatedAt"],
    }


def _sorted_summaries(matching: list[dict]) -> list[dict]:
    matching.sort(key=lambda s: _parse_iso(s["updatedAt"]), reverse=True)
    return [_to_summary(s) for s in matching]


def _parse_iso(ts: str) -> float:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()


# Sessions are scoped per-user (see auth.py): every read/write below takes
# a `user_id` and only ever touches sessions owned by that user, so one
# account can never see or modify another account's chat history through
# these APIs. Sessions created before per-user scoping existed (no
# `userId` field) are owned by no one and won't be returned here.


def list_sessions(user_id) -> list[dict]:
    """Session summaries (no messages) owned by `user_id`, newest-updated first."""
    with _lock:
        matching = [s for s in _sessions.values() if s.get("userId") == user_id]
        return _sorted_summaries(matching)


def search_sessions(user_id, query: str) -> list[dict]:
    """Search the user's sessions by a case-insensitive substring over the
    title and message contents. Returns the same summaries as
    list_sessions (newest-updated first) for every matching session."""
    q = str(query).strip().lower()
    if not q:
        return []
    with _lock:
        matching = [
            s
            for s in _sessions.values()
            if s.get("userId") == user_id
            and (
                (isinstance(s.get("title"), str) and q in s["title"].lower())
                or any(
                    isinstance(m.get("content"), str) and q in m["content"].lower()
                    for m in (s.get("messages") or [])
                    if isinstance(m, dict)
                )
            )
        ]
        return _sorted_summaries(matching)


def get_session(session_id: str, user_id) -> dict | None:
    """Full session (including messages) by id, scoped to `user_id`.
    Returns None if it doesn't exist or belongs to a different user."""
    with _lock:
        session = _sessions.get(session_id)
        if session and session.get("userId") == user_id:
            return session
        return None


def create_session(user_id, title: object) -> dict:
    """Create a new, empty session owned by `user_id`. `title` defaults to
    "New chat" if omitted/blank."""
    now = _now_iso()
    session = {
        "id": str(uuid.uuid4()),
        "userId": user_id,
        "title": title.strip() if isinstance(title, str) and title.strip() else "New chat",
        "createdAt": now,
        "updatedAt": now,
        "messages": [],
    }
    with _lock:
        _sessions[session["id"]] = session
        _persist(_sessions)
    return session


def _normalize_message(msg: dict) -> dict:
    normalized = {
        "role": msg["role"],
        "content": msg["content"],
        "createdAt": msg.get("createdAt") or _now_iso(),
    }
    # The model that produced an assistant message is display metadata (the
    # UI shows "llama3" as the message author); anything else unknown is
    # dropped.
    if isinstance(msg.get("model"), str) and msg["model"]:
        normalized["model"] = msg["model"]
    if "attachments" in msg:
        normalized["attachments"] = msg["attachments"]
    return normalized


def update_session(session_id: str, user_id, *, title=None, messages=None, append_messages=None) -> dict | None:
    """Update a session's title and/or messages. Scoped to `user_id`.

      - title: replaces the title if a non-blank string is provided.
      - messages: replaces the full messages array if provided.
      - append_messages: appended after any messages replacement.

    Returns the updated session, or None if the id doesn't exist or
    belongs to a different user."""
    with _lock:
        session = _sessions.get(session_id)
        if not session or session.get("userId") != user_id:
            return None

        if isinstance(title, str) and title.strip():
            session["title"] = title.strip()
        if isinstance(messages, list):
            session["messages"] = [_normalize_message(m) for m in messages]
        if isinstance(append_messages, list) and append_messages:
            session["messages"].extend(_normalize_message(m) for m in append_messages)
        session["updatedAt"] = _now_iso()

        _persist(_sessions)
        return session


def delete_session(session_id: str, user_id) -> bool:
    """Delete a session by id, scoped to `user_id`. Returns True if it
    existed (and was owned by `user_id`) and was deleted."""
    with _lock:
        session = _sessions.get(session_id)
        if not session or session.get("userId") != user_id:
            return False
        del _sessions[session_id]
        _persist(_sessions)
        return True


def export_sessions(user_id) -> list[dict]:
    """Full export for the user's own data: every session *including*
    messages, newest-updated first, ready to be served as JSON
    (GET /api/export)."""
    with _lock:
        matching = [s for s in _sessions.values() if s.get("userId") == user_id]
        matching.sort(key=lambda s: _parse_iso(s["updatedAt"]), reverse=True)
        return [json.loads(json.dumps(s)) for s in matching]  # deep copy
