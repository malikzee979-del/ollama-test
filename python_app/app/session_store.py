"""Minimal file-based JSON store for chat sessions. Port of db.js.

Persistence model: the whole sessions map is kept in memory and written to
disk on every mutation. Writes are atomic (write to a temp file, then
rename over the real file) so a crash mid-write can't corrupt the store.

Sessions are scoped per-user (see auth_store.py): every read/write below
takes a `user_id` and only ever touches sessions owned by that user.
"""
import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from . import config, logger

_lock = threading.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SessionStore:
    def __init__(self, data_file: Optional[str] = None):
        self.data_file = Path(data_file or config.SESSIONS_DATA_FILE)
        self.data_file.parent.mkdir(parents=True, exist_ok=True)
        self._sessions: dict = self._load()

    def _load(self) -> dict:
        if not self.data_file.exists():
            return {}
        try:
            raw = self.data_file.read_text(encoding="utf-8")
            if not raw.strip():
                return {}
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except Exception as err:  # noqa: BLE001 - mirrors db.js's fail-open behavior
            logger.error(f"[db] Failed to read {self.data_file}, starting with an empty store: {err}")
            return {}

    def _persist(self) -> None:
        tmp_file = self.data_file.with_suffix(f".{os.getpid()}.{int(datetime.now().timestamp() * 1000)}.tmp")
        tmp_file.write_text(json.dumps(self._sessions, indent=2), encoding="utf-8")
        tmp_file.replace(self.data_file)

    @staticmethod
    def _to_summary(session: dict) -> dict:
        return {
            "id": session["id"],
            "title": session["title"],
            "createdAt": session["createdAt"],
            "updatedAt": session["updatedAt"],
        }

    @staticmethod
    def _normalize_message(msg: dict) -> dict:
        out = {
            "role": msg["role"],
            "content": msg["content"],
            "createdAt": msg.get("createdAt") or _now_iso(),
        }
        if "attachments" in msg and msg["attachments"] is not None:
            out["attachments"] = msg["attachments"]
        return out

    def list_sessions(self, user_id) -> list:
        with _lock:
            items = [s for s in self._sessions.values() if s.get("userId") == user_id]
            items.sort(key=lambda s: s["updatedAt"], reverse=True)
            return [self._to_summary(s) for s in items]

    def get_session(self, session_id: str, user_id) -> Optional[dict]:
        with _lock:
            session = self._sessions.get(session_id)
            return session if session and session.get("userId") == user_id else None

    def create_session(self, user_id, title: Optional[str] = None) -> dict:
        with _lock:
            now = _now_iso()
            session = {
                "id": str(uuid.uuid4()),
                "userId": user_id,
                "title": title.strip() if isinstance(title, str) and title.strip() else "New chat",
                "createdAt": now,
                "updatedAt": now,
                "messages": [],
            }
            self._sessions[session["id"]] = session
            self._persist()
            return session

    def update_session(
        self,
        session_id: str,
        user_id,
        title: Optional[str] = None,
        messages: Optional[list] = None,
        append_messages: Optional[list] = None,
    ) -> Optional[dict]:
        with _lock:
            session = self._sessions.get(session_id)
            if not session or session.get("userId") != user_id:
                return None

            if isinstance(title, str) and title.strip():
                session["title"] = title.strip()
            if isinstance(messages, list):
                session["messages"] = [self._normalize_message(m) for m in messages]
            if isinstance(append_messages, list) and append_messages:
                session["messages"].extend(self._normalize_message(m) for m in append_messages)
            session["updatedAt"] = _now_iso()

            self._persist()
            return session

    def delete_session(self, session_id: str, user_id) -> bool:
        with _lock:
            session = self._sessions.get(session_id)
            if not session or session.get("userId") != user_id:
                return False
            del self._sessions[session_id]
            self._persist()
            return True


store = SessionStore()
