"""Local authentication, backed by SQLite (stdlib `sqlite3`). Port of auth.js.

Two tables: `users` (username + salted/hashed password) and `sessions`
(opaque bearer tokens handed out after signup/login). The user id issued
here is also used by session_store.py (chat sessions) to scope data
per-user, so separate accounts don't see each other's chat history.
"""
import hashlib
import os
import re
import secrets
import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from . import config

SESSION_COOKIE = "sid"
SESSION_TTL = timedelta(days=30)

USERNAME_RE = re.compile(r"^[a-zA-Z0-9_.-]{3,32}$")

_lock = threading.Lock()


@dataclass
class PublicUser:
    id: int
    username: str
    created_at: str

    def to_dict(self) -> dict:
        return {"id": self.id, "username": self.username, "createdAt": self.created_at}


class AuthError(Exception):
    """User-facing validation/credential error."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class AuthStore:
    def __init__(self, db_file: Optional[str] = None):
        self.db_file = db_file or config.AUTH_DB_FILE
        Path(self.db_file).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.db_file, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            """
        )
        self._conn.commit()

    # --- password hashing (scrypt, via hashlib, stdlib) -----------------

    @staticmethod
    def _hash_password(password: str) -> str:
        salt = os.urandom(16)
        digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=64)
        return f"scrypt:{salt.hex()}:{digest.hex()}"

    @staticmethod
    def _verify_password(password: str, stored: str) -> bool:
        try:
            scheme, salt_hex, hash_hex = stored.split(":")
        except ValueError:
            return False
        if scheme != "scrypt" or not salt_hex or not hash_hex:
            return False
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
        actual = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=len(expected))
        return secrets.compare_digest(actual, expected)

    @staticmethod
    def _validate_credentials(username: str, password: str) -> Optional[str]:
        if not isinstance(username, str) or not USERNAME_RE.match(username):
            return 'Username must be 3-32 characters: letters, numbers, "_", "." or "-".'
        if not isinstance(password, str) or len(password) < 8:
            return "Password must be at least 8 characters."
        return None

    @staticmethod
    def _to_public_user(row: sqlite3.Row) -> PublicUser:
        return PublicUser(id=row["id"], username=row["username"], created_at=row["created_at"])

    def get_user_by_username(self, username: str) -> Optional[sqlite3.Row]:
        return self._conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()

    def get_user_by_id(self, user_id: int) -> Optional[sqlite3.Row]:
        return self._conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()

    # --- users -----------------------------------------------------------

    def create_user(self, username: str, password: str) -> PublicUser:
        with _lock:
            error = self._validate_credentials(username, password)
            if error:
                raise AuthError(error)
            if self.get_user_by_username(username):
                raise AuthError("That username is already taken.")

            password_hash = self._hash_password(password)
            created_at = _now_iso()
            cur = self._conn.execute(
                "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
                (username, password_hash, created_at),
            )
            self._conn.commit()
            return PublicUser(id=cur.lastrowid, username=username, created_at=created_at)

    def verify_user(self, username: str, password: str) -> Optional[PublicUser]:
        row = self.get_user_by_username(username)
        if not row:
            return None
        if not self._verify_password(password, row["password_hash"]):
            return None
        return self._to_public_user(row)

    # --- sessions ----------------------------------------------------------

    def create_session(self, user_id: int):
        token = secrets.token_hex(32)
        now = datetime.now(timezone.utc)
        expires_at = now + SESSION_TTL
        self._conn.execute(
            "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (token, user_id, now.isoformat(), expires_at.isoformat()),
        )
        self._conn.commit()
        return token, expires_at

    def get_user_by_session_token(self, token: Optional[str]) -> Optional[PublicUser]:
        if not token:
            return None
        session = self._conn.execute("SELECT * FROM sessions WHERE token = ?", (token,)).fetchone()
        if not session:
            return None
        expires_at = datetime.fromisoformat(session["expires_at"])
        if expires_at < datetime.now(timezone.utc):
            self._conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
            self._conn.commit()
            return None
        user = self.get_user_by_id(session["user_id"])
        return self._to_public_user(user) if user else None

    def delete_session(self, token: str) -> None:
        self._conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        self._conn.commit()

    def prune_expired_sessions(self) -> int:
        now = datetime.now(timezone.utc).isoformat()
        cur = self._conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
        self._conn.commit()
        return cur.rowcount


# Module-level singleton, mirroring auth.js's module-scoped `db`.
store = AuthStore()
