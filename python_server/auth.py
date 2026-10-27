"""Local authentication, backed by SQLite via Python's built-in `sqlite3`
module (stdlib, no native compilation needed — see db.py for why this
project avoids extra deps). Two tables: `users` (username + salted/hashed
password) and `sessions` (opaque bearer tokens handed out as an httpOnly
cookie after signup/login).

Besides gating access to the app, the user id issued here is also used by
db.py (chat sessions) and the /api/memory/* routes in main.py to scope
that data per-user, so separate accounts don't see each other's chat
history or semantic memory.
"""

from __future__ import annotations

import getpass
import hashlib
import hmac
import os
import re
import secrets
import shutil
import sqlite3
import sys
import time
from datetime import datetime, timedelta, timezone
from threading import Lock

SESSION_COOKIE = "sid"
SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000  # 30 days
SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000

# DB_FILE is overridable via AUTH_DB_FILE so tests can point at an isolated
# temp file instead of the real local data/auth.db — unset, behavior is
# unchanged.
DB_FILE = os.environ.get("AUTH_DB_FILE") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "data", "auth.db"
)
DATA_DIR = os.path.dirname(DB_FILE)

os.makedirs(DATA_DIR, exist_ok=True)

_conn = sqlite3.connect(DB_FILE)
_conn.row_factory = sqlite3.Row
_conn.executescript(
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
_conn.commit()

# sqlite3 connections are not thread-safe by default; the server runs with
# threads (uvicorn's threadpool for sync endpoints), so serialize access.
_db_lock = Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# --- password hashing (scrypt, built into Python's hashlib) ---------------


def _scrypt_available() -> bool:
    return hasattr(hashlib, "scrypt")


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    if _scrypt_available():
        digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=64)
        return f"scrypt:{salt.hex()}:{digest.hex()}"
    # Some Python builds (e.g. macOS system 3.9 against an OpenSSL without
    # scrypt) lack hashlib.scrypt; fall back to PBKDF2-SHA256. The scheme
    # prefix tells verify_password how to check, so scrypt-hashed rows
    # created by the Node server or a different Python keep verifying.
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000, dklen=64)
    return f"pbkdf2:{salt.hex()}:{digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    parts = str(stored).split(":")
    if len(parts) != 3 or not parts[1] or not parts[2]:
        return False
    scheme, salt_hex, hash_hex = parts
    try:
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
    except ValueError:
        return False
    if scheme == "scrypt":
        if not _scrypt_available():
            return False
        actual = hashlib.scrypt(
            password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=len(expected)
        )
    elif scheme == "pbkdf2":
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, 200_000, dklen=len(expected)
        )
    else:
        return False
    return hmac.compare_digest(actual, expected)


# --- users ------------------------------------------------------------------

USERNAME_RE = re.compile(r"^[a-zA-Z0-9_.-]{3,32}$")


def validate_credentials(username: object, password: object) -> str | None:
    if not isinstance(username, str) or not USERNAME_RE.fullmatch(username):
        return 'Username must be 3-32 characters: letters, numbers, "_", "." or "-".'
    if not isinstance(password, str) or len(password) < 8:
        return "Password must be at least 8 characters."
    return None


def _to_public_user(row) -> dict:
    return {"id": row["id"], "username": row["username"], "createdAt": row["created_at"]}


def get_user_by_username(username: str):
    with _db_lock:
        return _conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()


def get_user_by_id(user_id: int):
    with _db_lock:
        return _conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


class AuthError(Exception):
    """Error with a user-facing message (invalid input, or username taken)."""


def create_user(username: object, password: object) -> dict:
    validation_error = validate_credentials(username, password)
    if validation_error:
        raise AuthError(validation_error)

    if get_user_by_username(username):
        raise AuthError("That username is already taken.")

    password_hash = hash_password(password)
    created_at = _now_iso()
    with _db_lock:
        cur = _conn.execute(
            "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
            (username, password_hash, created_at),
        )
        _conn.commit()
        user_id = cur.lastrowid
    return {"id": user_id, "username": username, "createdAt": created_at}


def verify_user(username: object, password: object) -> dict | None:
    row = get_user_by_username(username)
    if row is None:
        return None
    if not verify_password(password, row["password_hash"]):
        return None
    return _to_public_user(row)


# --- sessions -----------------------------------------------------------------


def create_session(user_id: int) -> dict:
    token = secrets.token_hex(32)
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(milliseconds=SESSION_TTL_MS)
    with _db_lock:
        _conn.execute(
            "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (token, user_id, now.isoformat().replace("+00:00", "Z"),
             expires_at.isoformat().replace("+00:00", "Z")),
        )
        _conn.commit()
    return {"token": token, "expiresAt": expires_at}


def _parse_iso(ts: str) -> float:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()


def get_user_by_session_token(token: str | None) -> dict | None:
    if not token:
        return None
    with _db_lock:
        session = _conn.execute(
            "SELECT * FROM sessions WHERE token = ?", (token,)
        ).fetchone()
        if session is None:
            return None
        if _parse_iso(session["expires_at"]) < time.time():
            _conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
            _conn.commit()
            return None
        user = _conn.execute(
            "SELECT * FROM users WHERE id = ?", (session["user_id"],)
        ).fetchone()
    return _to_public_user(user) if user else None


def delete_session(token: str) -> None:
    with _db_lock:
        _conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        _conn.commit()


def prune_expired_sessions() -> int:
    with _db_lock:
        cur = _conn.execute(
            "DELETE FROM sessions WHERE expires_at < ?", (_now_iso(),)
        )
        _conn.commit()
        return cur.rowcount


def reset_password(username: str, new_password: str) -> dict:
    """Reset a user's password and revoke all of their sessions. Used by the
    CLI entry point at the bottom of this file."""
    validation_error = validate_credentials(username, new_password)
    if validation_error:
        raise AuthError(validation_error)

    row = get_user_by_username(username)
    if row is None:
        raise AuthError(f'No user named "{username}".')

    with _db_lock:
        _conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (hash_password(new_password), row["id"]),
        )
        _conn.execute("DELETE FROM sessions WHERE user_id = ?", (row["id"],))
        _conn.commit()
    return _to_public_user(row)


# --- login lockout (per username + IP) ---------------------------------------
#
# main.py rate-limits /api/auth/login per client IP, but that leaves two
# holes: an attacker can spray one username from many IPs, or spray many
# usernames from one IP that never trips the per-IP cap. This adds the
# missing dimension: failed logins are counted per (username, ip) pair, and
# once one pair accumulates LOCKOUT_MAX_FAILURES within the window, further
# attempts for that pair are refused until the window drains.
#
# Keyed on username+IP rather than username alone on purpose — a global
# username lock would hand anyone a one-liner DoS. Same in-memory
# fixed-window shape as main.py's rate limiter; resets on restart.

LOCKOUT_WINDOW_MS = 15 * 60 * 1000  # 15 minutes
LOCKOUT_MAX_FAILURES = 5

_failed_login_attempts: dict[str, list[float]] = {}
_failed_login_lock = Lock()
_last_lockout_sweep = 0.0


def _lockout_key(username: object, ip: str | None) -> str:
    # Case-fold the username: credentials are compared case-sensitively by
    # SQLite here, but a spray usually isn't case-consistent.
    return f"{str(username).lower()}|{ip or 'unknown'}"


def _sweep_failed_logins(now_ms: float) -> None:
    global _last_lockout_sweep
    if now_ms - _last_lockout_sweep < LOCKOUT_WINDOW_MS:
        return
    _last_lockout_sweep = now_ms
    for key, stamps in list(_failed_login_attempts.items()):
        alive = [t for t in stamps if now_ms - t < LOCKOUT_WINDOW_MS]
        if alive:
            _failed_login_attempts[key] = alive
        else:
            del _failed_login_attempts[key]


def login_lock_remaining(username: object, ip: str | None) -> dict | None:
    """Return None while the pair is under the failure threshold, or a dict
    carrying the seconds until the lock drains (for the Retry-After header)."""
    key = _lockout_key(username, ip)
    now_ms = time.time() * 1000
    with _failed_login_lock:
        _sweep_failed_logins(now_ms)
        stamps = [t for t in _failed_login_attempts.get(key, []) if now_ms - t < LOCKOUT_WINDOW_MS]
        if len(stamps) < LOCKOUT_MAX_FAILURES:
            return None
        return {"retryAfterSec": -(-int(LOCKOUT_WINDOW_MS - (now_ms - stamps[0])) // 1000)}


def record_login_failure(username: object, ip: str | None) -> None:
    key = _lockout_key(username, ip)
    now_ms = time.time() * 1000
    with _failed_login_lock:
        stamps = [t for t in _failed_login_attempts.get(key, []) if now_ms - t < LOCKOUT_WINDOW_MS]
        stamps.append(now_ms)
        _failed_login_attempts[key] = stamps


def clear_login_failures(username: object, ip: str | None) -> None:
    with _failed_login_lock:
        _failed_login_attempts.pop(_lockout_key(username, ip), None)


# --- CLI: local password reset + auth.db backup ------------------------------
#
#   python -m auth --reset-password <username>
#   python -m auth --backup-authdb [dest-dir]
#
# Run on the host, so it can only ever be invoked by someone with shell
# access — no network, no SMTP. Only runs when this file is executed
# directly, never when it's imported.

if __name__ == "__main__":
    args = sys.argv[1:]

    if args and args[0] == "--backup-authdb":
        dest_dir = args[1] if len(args) > 1 else os.path.join(DATA_DIR, "backups")
        try:
            if not os.path.exists(DB_FILE):
                raise AuthError(f"No auth database found at {DB_FILE}.")
            os.makedirs(dest_dir, exist_ok=True)
            stamp = datetime.now(timezone.utc).isoformat().replace(":", "-").replace(".", "-")
            target = os.path.join(dest_dir, f"auth-{stamp}.db")
            _conn.commit()
            shutil.copyfile(DB_FILE, target)
            print(f"Backed up {DB_FILE} -> {target}")
            sys.exit(0)
        except AuthError as err:
            print(err.message if isinstance(err, AuthError) else str(err), file=sys.stderr)
            sys.exit(1)

    username = args[1] if args and args[0] == "--reset-password" else None
    if not username or not args or args[0] != "--reset-password":
        print("Usage: python -m auth --reset-password <username>")
        print("       python -m auth --backup-authdb [dest-dir]")
        sys.exit(1)

    new_password = getpass.getpass(f'New password for "{username}": ')
    confirmed = getpass.getpass("Confirm new password: ")
    if new_password != confirmed:
        print("Passwords do not match; nothing changed.", file=sys.stderr)
        sys.exit(1)

    try:
        user = reset_password(username, new_password)
        print(f'Password reset for "{user["username"]}"; all existing sessions were revoked.')
    except AuthError as err:
        print(str(err), file=sys.stderr)
        sys.exit(1)
