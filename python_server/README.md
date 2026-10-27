# Ollama Chat — Python server

Full-parity Python port of the Node.js `server.js` + its modules (`auth.js`,
`db.js`, `embeddings.js`, `compaction.js`, `logger.js`, `metrics.js`,
`qdrant.js`). Same routes, same env vars, same response shapes, same
security behavior (host-header guard, per-user scoping, rate limits,
login lockout, fail-open memory/compaction, ndjson streaming proxy).

## Run

```bash
cd python_server
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python main.py            # or: uvicorn main:app --port 4173
```

Serves on `http://localhost:4173` and proxies Ollama at
`http://127.0.0.1:11434`, same as the Node server. The frontend in
`../public/` is served statically after login, so the existing UI works
unchanged.

## Environment variables (identical to the Node version)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4173` | Listen port |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama base URL |
| `HOST_ALLOWLIST` | — | Extra allowed Host headers (comma-separated) |
| `COOKIE_SECURE` | — | `1` marks the session cookie Secure (HTTPS only) |
| `AUTH_DB_FILE` | `data/auth.db` | SQLite users/sessions DB |
| `SESSIONS_DATA_FILE` | `data/sessions.json` | Chat-session JSON store |
| `QDRANT_URL` | `http://127.0.0.1:6333` | Qdrant for semantic memory |
| `QDRANT_COLLECTION` | `chat_messages` | Collection name |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Ollama embeddings model |
| `EMBEDDING_DIM` | `768` | Vector size |
| `COMPACTION_MAX_MESSAGES` / `_MAX_CHARS` / `_KEEP_RECENT` / `_MODEL` / `_TIMEOUT_MS` | `40` / `24000` / `8` / — / `30000` | Chat compaction |
| `MEMORY_TOP_K` / `MEMORY_TIMEOUT_MS` | `5` / `3000` | Memory retrieval |

## CLI

```bash
python -m auth --reset-password <username>   # reset + revoke sessions
python -m auth --backup-authdb [dest-dir]    # copy the SQLite auth DB
```

## Tests

Not ported yet — the Node suite under `../test/` still covers the JS
server. The Python modules keep the same test seams (injectable
`summarize`, `AUTH_DB_FILE`/`SESSIONS_DATA_FILE` overrides,
`qdrant_store._set_client_for_tests`).
