# Ollama Chat — Python edition

A complete Python port of the web app (frontend + backend) from the
project root — same local chat UI for [Ollama](https://ollama.com) models,
rewritten end-to-end in Python. The Node/Express + hand-written HTML/CSS/JS
version at the repo root is untouched; this lives entirely under
`python_app/` as an independent implementation. The Electron desktop app
and Flutter mobile app were explicitly out of scope and are not ported.

## Stack

- **Backend:** [FastAPI](https://fastapi.tiangolo.com) (async, needed for
  the streaming `/api/chat` and `/api/pull` proxies).
- **Frontend:** [NiceGUI](https://nicegui.io) — the entire UI (login,
  signup, chat, settings) is authored in Python; no hand-written HTML/CSS/JS.
  NiceGUI itself is built on FastAPI/Starlette, so both live in one process
  and one `app` instance.
- **Storage:** SQLite (`sqlite3`, stdlib) for accounts/sessions, a JSON
  file for chat history, [qdrant-client](https://github.com/qdrant/qdrant-client)
  for the optional semantic-memory vector store — same technology choices
  as the original Node version.

## Project layout

```
python_app/
  app/
    config.py          env vars (PORT, OLLAMA_HOST, QDRANT_URL, ...)
    logger.py           port of logger.js
    metrics.py           port of metrics.js
    auth_store.py         port of auth.js (SQLite users/sessions, scrypt hashing)
    session_store.py       port of db.js (JSON-file chat session store)
    compaction.py            port of compaction.js
    embeddings.py             port of embeddings.js
    qdrant_store.py            port of qdrant.js
    ollama_client.py            async httpx client for the local Ollama API
    rate_limit.py                 port of the in-memory rate limiter in server.js
    api.py                          FastAPI routes mirroring every /api/* route in server.js
    main.py                          app entrypoint: wires auth middleware + API + UI pages
    pages/
      login.py, signup.py, chat.py    NiceGUI pages (the "frontend")
  requirements.txt
  data/                 auth.db + sessions.json (git-ignored, created on first run)
```

## Setup

```bash
cd python_app
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
```

Requires Python 3.9+ (developed/tested against 3.12). Ollama itself must
already be installed and running locally (`ollama serve`), same as the
Node version.

## Run

```bash
cd python_app
PORT=4173 OLLAMA_HOST=http://127.0.0.1:11434 ./.venv/bin/python -m app.main
```

Then open `http://localhost:4173`. First run redirects to `/signup` to
create a local account (same account system as the original — separate
SQLite database under `python_app/data/`, not shared with the Node
version's `data/auth.db`).

## What's ported 1:1

- **Auth**: SQLite `users`/`sessions` tables, scrypt password hashing,
  30-day opaque bearer session tokens, per-route rate limiting on
  `/api/auth/*`, periodic expired-session pruning.
- **Chat proxy**: streaming `/api/chat` (NDJSON passthrough from Ollama),
  chat compaction (`compaction.py`) that folds old turns into a summary
  once a conversation grows past the message/char thresholds.
- **Model management**: `/api/models`, `/api/show`, streaming `/api/pull`
  with progress, `DELETE /api/models/:name`.
- **System/health/metrics**: `/api/system` (RAM, used for the "this model
  might not fit" warning), `/api/health` (Ollama reachability), `/api/metrics`
  (in-memory per-route counters/latencies).
- **Chat history backend**: full `/api/sessions*` CRUD, scoped per user,
  identical semantics to `db.js` (kept as a documented, independently
  testable REST API — see note below on how the UI itself persists chats).
- **Semantic memory**: `/api/memory/index` and `/api/memory/search`,
  backed by Qdrant + Ollama embeddings, same collection/dimension
  validation and graceful 503-on-failure behavior as `qdrant.js`.

## One intentional behavior difference: chat persistence in the UI

The original browser frontend keeps chat history in `localStorage` (the
`/api/sessions` backend exists but — per the original README — is unused
by the browser UI). NiceGUI is server-rendered, so there is no
browser-side `localStorage` to reuse. The Python UI stores chats/settings
in `app.storage.user` — NiceGUI's server-side, per-browser JSON storage,
tied to a signed browser cookie — which is the direct functional analog
of `localStorage` in this architecture. The full `/api/sessions` REST API
is still implemented and available for any client that wants
server-authoritative, cross-device chat history.

## Visual differences

The UI is rebuilt with NiceGUI's Quasar-based components (top bar, nav
drawer, chat bubbles, dialogs) rather than the original's hand-styled
HTML/CSS. Functionally equivalent (model picker, streaming replies,
attachments, settings modal with system prompt/temperature/top-p/num_ctx,
model pull/delete, memory-pressure warning, dark mode, per-chat sidebar),
but it will not look pixel-identical to `public/style.css`.

## Not ported (out of scope)

- `electron/` (desktop wrapper) and `mobile/` (Flutter app) — the task was
  scoped to the web app only.
- The Node test suite (`test/*.test.js`) — not translated to pytest in
  this pass; the modules were ported with matching behavior/semantics
  (see docstrings referencing the original `.js` file each port comes from).
