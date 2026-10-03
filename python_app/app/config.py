"""Central place for environment-driven configuration.

Mirrors the environment variables read across the original Node.js
project (server.js, qdrant.js, embeddings.js) so behavior/defaults match.
"""
import os
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent  # python_app/
DATA_DIR = Path(os.environ.get("DATA_DIR") or (APP_DIR / "data"))

PORT = int(os.environ.get("PORT", "4173"))
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")

AUTH_DB_FILE = os.environ.get("AUTH_DB_FILE") or str(DATA_DIR / "auth.db")
SESSIONS_DATA_FILE = os.environ.get("SESSIONS_DATA_FILE") or str(DATA_DIR / "sessions.json")

QDRANT_URL = os.environ.get("QDRANT_URL", "http://127.0.0.1:6333")
QDRANT_COLLECTION = os.environ.get("QDRANT_COLLECTION", "chat_messages")
EMBEDDING_DIM = int(os.environ.get("EMBEDDING_DIM", "768"))
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "nomic-embed-text")

# Chat compaction settings (see app/compaction.py).
COMPACTION_MAX_MESSAGES = int(os.environ.get("COMPACTION_MAX_MESSAGES", "40"))
COMPACTION_MAX_CHARS = int(os.environ.get("COMPACTION_MAX_CHARS", "24000"))
COMPACTION_KEEP_RECENT = int(os.environ.get("COMPACTION_KEEP_RECENT", "8"))
COMPACTION_MODEL = os.environ.get("COMPACTION_MODEL") or None
COMPACTION_TIMEOUT_MS = int(os.environ.get("COMPACTION_TIMEOUT_MS", "30000"))

# Size caps, matching server.js.
MAX_SESSION_TITLE_CHARS = 200
MAX_SESSION_MESSAGES = 1000
MAX_MESSAGE_CONTENT_CHARS = 1_000_000
MAX_MEMORY_BATCH = 100
MAX_MEMORY_TEXT_CHARS = 100_000

# NiceGUI browser-storage signing secret. Override in production via env var.
STORAGE_SECRET = os.environ.get("STORAGE_SECRET", "dev-secret-change-me")

COOKIE_SECURE = os.environ.get("COOKIE_SECURE") == "1"

DATA_DIR.mkdir(parents=True, exist_ok=True)
