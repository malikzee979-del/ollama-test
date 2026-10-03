# Implementation plan — Ollama Chat roadmap

Ordered, phased plan for the feature backlog agreed in this session. One
structural decision drives the whole ordering, so it is stated up front.

> Status note: this plan was written after **Phase A had already landed**
> (lint + streaming/embeddings tests + rate limits, all verified green).
> Phase A items are marked done below rather than listed as future work.
>
> **Updated 2026-09-14: Phase B has also landed.** `/api/sessions/*` is now the
> canonical chat store and `public/app.js` reads and writes it for every chat;
> `localStorage` survives only as a one-time migration source behind an explicit
> confirm banner. The gate on Phase C is therefore **cleared** — C1–C4 can be
> built.
>
> This file remains the **feature roadmap**: the ordering rationale, the open
> product decisions, and the suggested commit-size breakdown below. For current
> repo health, security hardening, and the satellite projects, work from
> **`TODO.md`**, which is the single living backlog and now carries this plan's
> Phase C/D/E items as its Phase 4 and Phase 5. (`PLAN-improvements.md` is
> superseded.)

## The key decision: two chat histories

> **Resolved 2026-09-14.** The decision below was taken and Phase B has landed:
> `/api/sessions/*` is canonical, `public/app.js` calls it for every chat, and
> `localStorage` is a one-time migration source behind a confirm banner. Kept as
> the rationale for why Phase C is ordered the way it is.

The app has **two sources of truth** for chat history today: the frontend's
`localStorage` store (`public/app.js`) and the server-side `/api/sessions/*`
store (`db.js`). They are unrelated — the frontend never calls the session
routes. Regenerate/edit, export, search, and RAG wiring all need *one*
canonical message store to attach to.

**Decision: make `/api/sessions/*` (db.js) the source of truth.** It is
already implemented, tested, and per-user scoped; localStorage becomes a
one-time migration source plus a client cache. This is the biggest and
riskiest change in the plan (a rewrite of `public/app.js`'s persistence
layer), so it gets its own phase and its own multi-commit effort.

## Phase A — Foundation ✅ (done)

- [x] ESLint: flat config (`eslint.config.js`), `npm run lint`, separate
      node + browser environments; `mobile/`, `python_app/`, `scratchpad/`
      ignored; intentional empty-catch/control-char-regex sites documented.
- [x] `test/embeddings.test.js` — fetch-mocked `/api/embed` happy path,
      legacy `{embedding}` shape, 404 fallback to `/api/embeddings`,
      failure propagation, malformed-shape guards.
- [x] `test/server-streaming.test.js` — fake Ollama (`node:http` ndjson):
      chat chunk passthrough + forwarded body, abort-on-disconnect, pull
      progress, delete success/failure, auth gate.
- [x] Rate limiting on `/api/pull` (5/15 min), `DELETE /api/models/:name`
      (10/5 min), `/api/memory/index` (20/5 min) + 429/`Retry-After` tests.

## Phase B — Resolve the two-histories problem *(gate for Phase C)*

**B1. Sessions become canonical; localStorage migrates.**
- Rewrite `public/app.js`'s state layer (`chats`, `loadChats`/`saveChats`,
  `getActiveChat`, `createChat`, `deleteChat`, `renderChatList`) to call
  `POST/GET/PATCH/DELETE /api/sessions*` instead of localStorage.
- Batch writes: append the user message once on send, the completed
  assistant message once when the stream ends — **not** per chunk — so
  `db.js`'s full-file-rewrite `persist()` stays at ~2 writes per turn.
- Migration UX: on first load after the switch, if localStorage has chats
  and the account has zero server-side sessions, offer a confirm-then-
  import step (POST each local chat as a session + `appendMessages`).
  Never silently delete un-migrated localStorage; allow skip-and-retry.
- *Open decision:* auto-import vs. confirm prompt. **Recommend: explicit
  confirm prompt.**

**B2. `db.js` write-amplification ceiling.**
- Documented for now, not solved: `persist()` rewrites the whole file per
  mutation. Fine at "handful of sessions" scale; revisit (per-session
  files, or `node:sqlite` like `auth.js` already uses) only if sessions
  become heavy. Do not block this phase on it.

## Phase C — Features on the canonical store (in order)

**C1. Regenerate / edit a message.**
- Frontend: per-message "Regenerate" (last assistant turn) and "Edit"
  (user turn) actions that truncate `chat.messages` and re-call the
  existing `streamAssistantReply`; persist via `PATCH .../:id` with a full
  `messages` replace.
- Linear history only. True branching is a `db.js` schema change (tree
  structure) and is explicitly out of scope unless re-approved.
- Check interaction with image attachments (regenerate must resend the
  same `images` bytes).

**C2. Export chat as Markdown / JSON.**
- Frontend-only; read from whichever store is canonical (least coupled of
  the C features, can jump ahead if needed). Blob + `<a download>`, no new
  dependency. Markdown export reuses the existing `[Attached file: ...]`
  fenced-block format for attachments.

**C3. Chat search.**
- `db.js`: add `searchSessions(userId, query)` — linear case-insensitive
  substring scan over the in-memory map (fine at documented scale; no
  search index/library). `server.js`: `GET /api/sessions/search?q=...`,
  per-user scoped like the other session routes. Frontend: sidebar search
  input.

**C4. Wire semantic memory into `/api/chat` (RAG).**
- `server.js` `/api/chat`: if the body carries `useMemory`, embed the
  latest user message, search Qdrant scoped to `req.user.id`, and inject
  top-k results as a system message (placed so `compaction.js`'s
  marker-scan still works). Auto-index each completed user/assistant turn
  via the same embed+upsert path `/api/memory/index` uses (factor into a
  shared helper).
- **Fail open:** wrap memory search/index in their own try/catch — a
  Qdrant outage must never break normal chat (same philosophy as
  `compaction.js`). Bound the embed call with a timeout like
  `COMPACTION_TIMEOUT_MS`.

## Phase D — Independent frontend features

**D1. Context window meter + surfaced compaction.**
- Export the `chars/4 ≈ tokens` heuristic from `compaction.js`; render an
  "approx. tokens" meter near the composer against `settings.numCtx`.
- `/api/chat` sets an `X-Compacted: true` response header when
  `compactMessages()` actually changed the array; frontend shows a subtle
  "earlier turns were summarized" note.

**D2. Per-chat settings presets.**
- Global named presets `{ name, systemPrompt, temperature, topP, numCtx }`
  in settings; each chat stores which preset (by id) it was last using.
- *Open decision:* global named presets vs per-chat snapshots. **Recommend:
  global named presets.**
- If Phase B has landed, persist `settings` on the session (small `db.js`
  extension); otherwise localStorage-only and migrated later.

**D3. Image / vision input.**
- Parallel attachment path (separate from the text pipeline): allowlist
  `.png .jpg .jpeg .webp .gif`, read as base64, populate Ollama's
  `images: [...]` per message; thumbnail chip instead of text chip;
  image-specific size cap (200KB text cap is too small for images).
- Server: pass `images` through `compactMessages()` unmodified (verify);
  note the chars heuristic won't count base64 image weight.
- Reuse `db.js`'s existing `attachments` passthrough with a
  `type: 'image'` discriminator rather than a new field.

**D4. PDF text extraction.**
- Client-side, vendored pdf.js UMD under `public/vendor/` (no live CDN —
  keeps "nothing leaves your machine" true). DOCX explicitly out of scope
  for this pass. Lowest priority; revisit scope after D3.

**D5. Split `public/app.js` into modules.**
- **Always last** — every other frontend feature touches the monolith.
- Native ES modules (`<script type="module">`), no build step. Suggested
  boundaries follow the file's own section comments: `state.js`,
  `render.js`, `models.js`, `attachments.js`, `chat-stream.js`,
  `settings-modal.js`, `main.js`. Shared mutable state (`el`, `chats`,
  `settings`) moves into an explicit `state.js` module — a real design
  decision, not a mechanical split. One module per commit, app fully
  working after each.

## Phase E — Password reset (fully independent)

- `auth.js`: `reset_tokens` table + `createResetToken` /
  `getUserByResetToken` / `resetPassword`, mirroring the sessions pattern;
  expiry like sessions. Routes `POST /api/auth/forgot-password` and
  `POST /api/auth/reset-password`, rate-limited with the auth limiter;
  `public/forgot-password.html` + link from login.
- *Open decision:* real emailed-token flow (new SMTP dep + config) vs.
  local/CLI reset (`node auth.js --reset-password <username>`).
  **Recommend: local/CLI reset** — matches this project's local-first,
  dependency-averse posture.

## Ordering summary

1. Phase A first (done).
2. **Phase B is the hard gate** — must land before C1–C4.
3. Phase C in listed order (C2 is least coupled and can jump ahead).
4. Phase D has no hard dependency on B (except D2's optional persistence
   extension); D5 always last among frontend work.
5. Phase E can slot in anywhere.

## Suggested commit-size breakdown (after Phase A)

1. `public/app.js`: localStorage CRUD → `/api/sessions/*` calls (B1a core)
2. Migration prompt UI + one-time import logic (B1b, separate from 1)
3. Edit/regenerate UI + truncate-and-replace logic (C1)
4. Export Markdown/JSON (C2)
5. `db.js` + `server.js`: `GET /api/sessions/search` (C3a)
6. `public/app.js`: search UI (C3b)
7. `server.js`: RAG wiring into `/api/chat`, fail-open + tests (C4)
8. `server.js`: `X-Compacted` header + test (D1a)
9. `public/app.js`: context meter + compaction note (D1b)
10. Settings presets, frontend first pass (D2a), `db.js` extension if needed (D2b)
11. Image attachment pipeline, frontend + server passthrough (D3)
12. Password reset: `auth.js` → routes → frontend → tests (E, 2–3 commits)
13. PDF extraction via vendored pdf.js (D4, optional)
14. `app.js` module split, one module per commit (D5, last)

## Open decisions (owner input needed before coding)

| # | Decision | Recommendation |
| --- | --- | --- |
| 1 | Migration UX: auto-import vs confirm prompt | Confirm prompt |
| 2 | Password reset: emailed tokens vs local/CLI | Local/CLI |
| 3 | Presets: global named vs per-chat snapshots | Global named |
| 4 | Edit/regenerate: linear vs true branching | Linear |
| 5 | DOCX extraction in scope? | No — PDF only |
