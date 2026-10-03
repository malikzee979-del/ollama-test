# Ollama Chat

## Overview

A small local web UI for chatting with models served by [Ollama](https://ollama.com).
It is a thin Express proxy in front of a local Ollama instance plus a static
frontend — nothing you type or generate leaves the machine. Every page and
API route requires a logged-in local account (SQLite-backed auth). The same
server + frontend can also run as a native desktop app via Electron, and a
separate Flutter mobile client (`./mobile`) talks to a server running
elsewhere on the network.

## Tech stack

- Runtime: Node.js >= 22.5.0, CommonJS, no build step
- Server: Express 4 (thin proxy to Ollama's HTTP API)
- Vector store: `@qdrant/js-client-rest` (semantic memory / RAG)
- Node built-ins: `node:sqlite` (auth store), `node:crypto` (scrypt password hashing), `node:test` (test runner)
- Frontend: plain HTML/CSS/JavaScript (no framework, no bundler)
- Desktop: Electron 43 shell + electron-builder (`npm run electron`, `npm run dist`)
- Mobile: Flutter/Dart client (`./mobile`)

## Structure

```
.
├── server.js         # main Express app + proxy, auth gate on routes/pages
├── auth.js           # signup/login, sessions, scrypt hashing, rate limiting
├── db.js             # file-based session persistence (JSON), per-user scoped
├── compaction.js      # chat compaction / summarization
├── embeddings.js      # Ollama embedding helper
├── qdrant.js          # vector store client + retry/dimension guards
├── logger.js          # structured request logging
├── metrics.js         # in-memory observability snapshot
├── public/            # web frontend (app.js, auth.js, style.css,
│                       #   index/login/signup HTML, fonts/)
├── electron/           # desktop shell (main.js spawns server.js)
├── mobile/             # Flutter client (lib/, android/, ios/, macos/, linux/, windows/, web/)
├── test/               # node:test suites (auth, compaction, db, qdrant, server)
├── scratchpad/         # throwaway debug/demo scripts and screenshots
├── data/               # git-ignored runtime data (auth.db, sessions.json)
├── TODO.md             # improvement backlog
└── opencode.json       # opencode agent/tooling config
```

## Key files

- `server.js` (648 lines) — Express app and Ollama proxy: serves `public/`,
  forwards `/api/chat` (streaming), `/api/models`, `/api/show`, `/api/pull`,
  `DELETE /api/models/:name`, plus session, memory, system, and metrics
  endpoints. Every route except `/api/auth/*` requires a logged-in session.
  Includes input-size validation and a `require.main === module` listen guard.
- `auth.js` (166 lines) — account/session management with scrypt hashing,
  `node:sqlite` storage, opaque bearer-token cookies (30-day, HttpOnly,
  SameSite=Lax), per-IP rate limiting on login/signup, and periodic expired-
  session pruning.
- `db.js` (164 lines) — file-based JSON persistence for chat sessions
  (`./data/sessions.json`), scoped per-user.
- `compaction.js` (136 lines) — `compactMessages()` summarizes older turns
  into a single compact system message before forwarding to Ollama; bounded
  by a timeout and fails open on error/timeout.
- `embeddings.js` (53 lines) — wraps Ollama's embeddings API for semantic
  search.
- `qdrant.js` (124 lines) — Qdrant client wrapper: ensures the collection
  exists, retries once if it is deleted externally, and guards against
  dimension/vector-size mismatches.
- `logger.js` (29 lines) / `metrics.js` (57 lines) — hand-rolled request
  logging (request id, single-line stdout entries) and in-memory metrics
  (`GET /api/metrics`).
- `public/app.js` (1,014 lines) — the chat UI (composer, streaming, model
  management, attachments, localStorage history).
- `public/auth.js` (69 lines) — client-side login/signup form handling.
- `public/style.css` (866 lines) — styling; IBM Plex fonts bundled locally
  under `public/fonts/`.
- `electron/main.js` (128 lines) — desktop shell that spawns `server.js` as a
  child process and opens a native window.
- `mobile/lib/` — Flutter client (signup/login, session list, model pick,
  streaming chat); does not yet cover model pull/delete, attachments, or
  semantic memory search.
- `test/` — 5 `node:test` suites (auth, compaction, db, qdrant, server).
- `TODO.md` — living improvement backlog (architecture gaps, correctness,
  testing, auth, ops, frontend, docs), tracking what has and hasn't been
  addressed since the initial read-through.

## Stats

- Server source: 8 JavaScript modules, ~1,377 lines (`server.js`, `auth.js`,
  `compaction.js`, `db.js`, `embeddings.js`, `qdrant.js`, `logger.js`, `metrics.js`)
- Frontend: ~1,949 lines (`app.js` 1,014, `style.css` 866, `auth.js` 69, plus
  index/login/signup HTML)
- Tests: 5 suites, ~795 lines — 44 tests passing as of this update
  (`auth`, `compaction`, `db`, `qdrant`, `server`)
- Electron shell: 1 file, 128 lines
- Flutter client: ~1,372 lines of Dart across `mobile/lib/`
- Primary languages: JavaScript, HTML, CSS, Dart (plus platform scaffolding
  in Kotlin/Swift/C++ for the mobile/desktop shells)
- Runtime deps: 2 (`express`, `@qdrant/js-client-rest`); dev deps: Electron +
  electron-builder
- Working tree has pending local changes not yet committed: `auth.js`,
  `electron/`, `mobile/`, `test/`, `public/auth.js`, `public/login.html`,
  `public/signup.html`, `public/fonts/`, `scratchpad/`, `TODO.md`,
  `opencode.json`, plus modifications to `server.js`, `db.js`, `qdrant.js`,
  `public/app.js`, `public/index.html`, `public/style.css`, and `README.md`.

## Recent activity

- 14eed3e merge: ui-improvements (modernized UI, accessibility, attachments)
- ce9dcaa merge: chat-compaction (summarize old turns before forwarding to Ollama)
- 30f3ea6 merge: qdrant-rag (semantic memory over chat text)
- 6d6c65a merge: observability (structured logging, /api/metrics)
- 8219749 merge: local-db (server-side chat session persistence)
- d036fde feat: add chat context compaction for /api/chat
- 28950cd feat(ui): modernize chat UI and improve accessibility
- 2975390 feat: add Qdrant-backed semantic memory (embedding + vector search)
- 1887e1a Add lightweight observability: structured logging, in-memory metrics, /api/metrics
- ebb84b0 feat: add file-based local DB for server-side chat session persistence

*Note: local authentication (`auth.js`, `node:sqlite`), the Electron desktop
shell, the Flutter mobile client, and the full `test/` suite exist in the
current working tree but are not yet reflected in the commit history above —
they are uncommitted local work.*

Generated with opencode
