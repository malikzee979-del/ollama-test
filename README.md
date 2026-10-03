# Ollama Chat

A small local web UI for chatting with models served by [Ollama](https://ollama.com).
It's a thin Express proxy in front of your local Ollama instance plus a static
frontend — nothing you type or generate leaves your machine.

The repo also contains several companion implementations of the same app, all
talking to the same local Ollama: an Electron desktop shell, Flutter and
React Native mobile clients, a full Python port of the web app, plus a static
marketing site (with a small browser game) and a Unity port of that game.
See [Repository layout](#repository-layout) below.

## Repository layout

| Path | What it is |
| --- | --- |
| `/` (root) | The core app: Node/Express server (`server.js`) + static web frontend (`public/`). Everything below builds on or reimplements it. |
| `electron/` | Desktop wrapper — runs the same server as a native window ([Electron](#desktop-app-electron)). |
| `mobile/` | Native iOS/Android client built with [Flutter](#mobile-app-flutter). |
| `mobile-rn/` | A second mobile client, rebuilt with Expo/[React Native](#mobile-app-react-native). |
| `python_app/` | Full [Python port](#python-edition) of the web app (FastAPI + NiceGUI). |
| `marketing/` | Static [marketing site](#marketing-site) for the app, plus the "Local Theft Auto" browser canvas game (`game.html`/`game.js`). |
| `unity/LocalTheftAuto/` | [Unity 3D port](#unity-port--local-theft-auto) of the canvas game. |
| `scratchpad/` | Throwaway debug/demo scripts from development — not part of the product; lint ignores it. |
| `test/` | `node --test` suite for the core app (see [Tests](#tests)). |
| `PLAN.md` / `TODO.md` | Roadmap plan and verified improvement backlog. |

## Prerequisites

- Node.js >= 22.5.0 (uses the built-in `node:sqlite` module for auth — see
  [Authentication](#authentication))
- [Ollama](https://ollama.com) installed and running locally (`ollama serve`,
  or the Ollama desktop app running in the background)
- At least one model pulled (e.g. `ollama pull llama3`), or pull one from the
  app's Settings modal once it's running

## Security posture

This app has **no authentication beyond the local account system described
below**, is rate-limited only on the auth, model-management, and
memory-index endpoints, and is designed to run on a trusted local machine
or network — do not expose it directly to the internet. `/api/pull` and
`DELETE /api/models/:name` in particular let any logged-in user pull or
delete models on the host with no extra confirmation.

## Setup

```bash
npm install
npm start        # or: npm run dev   (uses `node --watch` for auto-restart)
```

By default the server listens on **port 4173** and proxies to Ollama at
**http://127.0.0.1:11434**. Both are configurable via environment variables:

```bash
PORT=8080 OLLAMA_HOST=http://127.0.0.1:11434 npm start
```

Then open `http://localhost:4173` (or your chosen `PORT`) in a browser.

## Tests

```bash
npm test        # node:test suite (no extra test framework)
npm run lint    # ESLint (flat config, separate browser + node environments)
```

Runs the project's test suite via Node's built-in `node:test` runner (no
extra test framework dependency). Covers `auth.js` (account creation,
credential verification, session issuance/expiry), `db.js` (chat session
CRUD and per-user scoping), `qdrant.js` (against a fake injected client, so
Qdrant itself is never contacted), `compaction.js`, `embeddings.js`
(fetch-mocked embed/404-fallback/shape/error paths), and integration tests
for `server.js` (session/memory request validation, the compaction
timeout, per-IP rate limiting, and the streaming proxy routes — including
abort-on-disconnect — against a fake local Ollama, so no real Ollama
instance is ever contacted). Tests that touch storage point
`AUTH_DB_FILE` / `SESSIONS_DATA_FILE` at isolated temp files rather than
the real `./data`, so running them never touches your local accounts or
chat history.

The companion projects have their own checks where applicable:
`mobile-rn/e2e/flow.mjs` drives the full React Native flow against a live
server + emulator (see its section below), and `mobile/` has its own
`test/` and `integration_test/` suites run via `flutter test`.

## Desktop app (Electron)

The same server + frontend can also run as a native desktop app instead of
a browser tab, via [Electron](https://www.electronjs.org). It's a thin
shell: on launch it spawns `server.js` as a child process (same as
`npm start`), waits for it to come up, then opens a native window pointing
at it. Closing the window stops the server child process too.

```bash
npm install
npm run electron        # launches the desktop app for local use
```

To build a distributable installer/binary (`.app`/`.dmg` on macOS, `.exe`
via NSIS on Windows, `.AppImage` on Linux) using
[electron-builder](https://www.electron.build):

```bash
npm run dist
```

Output goes to `./dist`. Ollama itself must still be installed and running
on the machine the app is used on — the desktop app doesn't bundle or
manage Ollama, only this chat UI. `PORT`/`OLLAMA_HOST` env vars still apply
the same way as with `npm start`.

## Mobile clients

There are **two** native mobile clients in this repo, both thin clients that
talk to a server you run elsewhere on the same network (or wherever it's
reachable) — a phone can't reach its own `localhost` the way a laptop can,
so neither app wraps the server locally. The server address is typed in on
first launch.

Both reimplement, natively, the parts of the web frontend needed for a
usable mobile chat client: signup/login (against `/api/auth/*`), listing
and creating chat sessions (`/api/sessions*`), picking an installed model
(`/api/models`), and streaming chat (`/api/chat`). Neither covers model
pull/delete, attachments, or semantic memory search — those remain
web/desktop-only for now.

The server itself needs no changes to support either client: it already
listens on all interfaces, and CORS doesn't apply to native HTTP clients
(that's a browser-only restriction) — only browser access is scoped by
[Security posture](#security-posture).

Because the configured server URL is almost always plain HTTP on a LAN
rather than HTTPS, both apps relax their platform transport security,
scoped to the app only and appropriate for a tool meant to stay on a
trusted local network (see [Security posture](#security-posture)): the
Flutter app sets `android:usesCleartextTraffic="true"` and disables iOS App
Transport Security (`NSAllowsArbitraryLoads`); the React Native app relies
on each platform's defaults plus platform cookie jars for the session
cookie.

### Mobile app (Flutter)

[`mobile/`](mobile/) is the original native client, built with
[Flutter](https://flutter.dev).

```bash
cd mobile
flutter pub get
flutter run          # launches on a connected device/simulator
```

On first launch, the app asks for the server's address — e.g.
`http://192.168.1.42:4173`, using the machine's LAN IP, not `localhost`.
The phone and the server must be able to reach each other on the network
(same Wi-Fi, typically); this address can be changed later from the
settings icon on the login/chat-list screens.

Building and running on an actual iOS device/simulator requires a full
Xcode install (`xcode-select --install` alone isn't enough) and
CocoaPods; Android requires Android Studio/the Android SDK. Once those
are set up:

```bash
flutter build apk          # Android APK
flutter build ipa          # iOS, requires a valid Apple signing setup
```

### Mobile app (React Native)

[`mobile-rn/`](mobile-rn/) is a second client — the same thin native client
rebuilt with [Expo](https://expo.dev) + React Navigation, feature-for-feature
with the Flutter app: server setup (ping-before-save), signup/login against
`/api/auth/*`, the session register, the model picker, and streaming chat
over the server's NDJSON `/api/chat` proxy. Details and deliberate
differences (platform cookie jars instead of manual `sid` capture, per-weight
IBM Plex font families) are documented in [`mobile-rn/README.md`](mobile-rn/README.md).

```bash
cd mobile-rn
npm install
npx expo run:android     # builds + installs on a running Android emulator
# or: npx expo run:ios   (requires Xcode)
```

On first launch, enter the server's address — for an Android emulator that's
`http://10.0.2.2:4173` (the host machine's loopback), for a real phone the
machine's LAN IP.

It also has an end-to-end test that drives the full flow (server setup →
signup → chat with a real streaming reply → persistence → delete → logout →
log back in) against the live server + Ollama via adb on a running emulator:

```bash
npm start                # in the repo root: Ollama Chat server on :4173
cd mobile-rn
node e2e/flow.mjs        # requires the Pixel_8_API_35 emulator booted
```

## Python edition

[`python_app/`](python_app/) is a complete Python port of the web app —
frontend and backend — rewritten end-to-end while the Node version at the
repo root is untouched. Stack: [FastAPI](https://fastapi.tiangolo.com)
backend, [NiceGUI](https://nicegui.io) UI authored in Python, SQLite for
accounts/sessions, a JSON file for chat history, and `qdrant-client` for
the optional semantic-memory store — the same technology choices as the
Node version. Full details, the module-by-module mapping, and the one
intentional behavior difference (NiceGUI's server-side `app.storage.user`
replaces browser `localStorage` as the UI's chat store) are documented in
[`python_app/README.md`](python_app/README.md).

```bash
cd python_app
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
PORT=4173 OLLAMA_HOST=http://127.0.0.1:11434 ./.venv/bin/python -m app.main
```

Requires Python 3.9+ (developed/tested against 3.12) and a locally running
Ollama, same as the Node version. Accounts live in a **separate** SQLite
database under `python_app/data/` — not shared with the Node version's
`data/auth.db`. The Electron desktop app and mobile clients were out of
scope for the port.

## Marketing site

[`marketing/`](marketing/) is a static, hand-written marketing site — no
build step, no framework, no network calls. It's now built around **Local
Theft Auto** (`game.html`/`game.js`), a self-contained 2.5D canvas
mini-game (one IIFE, zero assets, zero network): drive a city with
lane-disciplined traffic, panicking pedestrians, drift physics, a wanted
system with pursuing police, six mission types, and a garage that saves
your car. It's a bonus project, not part of the chat product — but it's
the codebase the Unity port below is built from.

Pages: home (`index.html`), `game.html` (play it), one dedicated page per
game system — `world.html`, `driving.html`, `missions.html`,
`wanted.html`, `combat.html`, `progression.html`, `controls.html` — plus
`faq.html` and `about.html` (the original Ollama Chat marketing content:
features, privacy posture, the three apps, and setup steps). Open
`index.html` directly in a browser or serve the directory with any static
file server.

## Unity port — Local Theft Auto

[`unity/LocalTheftAuto/`](unity/LocalTheftAuto/) ports the canvas game
engine to Unity with a Vice-City-style third-person 3D renderer: chase
camera, extruded buildings with lit windows, 3D cars/pedestrians/
streetlights, three job types (delivery/rampage/steal), a sidearm,
day/night and weather cycles, cosmetic building districts, and procedural
audio. The simulation still runs in the original 2D space with the same
constants and hash functions as the JS version — only the presentation is
3D, and every texture and mesh is still generated at runtime. Audio is the
one exception: it now uses 15 real recordings under
`unity/LocalTheftAuto/Assets/Resources/Audio/`, with the original procedural
synthesis kept as a per-clip fallback. Sources, authors and licences are in
[`unity/LocalTheftAuto/Assets/Audio/CREDITS.md`](unity/LocalTheftAuto/Assets/Audio/CREDITS.md)
— two clips are CC-BY 3.0 and that file is their required attribution.

Open it in **Unity Hub → Open → `unity/LocalTheftAuto`** (targets Unity 6
LTS; any Unity 6 or 2022.3 editor works) and press Play — the game
constructs itself at startup. Full code map, controls, and deliberate
deviations are in [`unity/LocalTheftAuto/README.md`](unity/LocalTheftAuto/README.md).

## Authentication

Every page and API route (except the routes below) requires a logged-in
session. On first run, create an account from `/signup.html`; you'll be
redirected to `/login.html` afterwards for any new session, or straight into
the app right after signing up.

- Accounts and sessions are stored locally in SQLite at `./data/auth.db`
  (via Node's built-in `node:sqlite`, no native compilation needed), using
  `data/` which is already git-ignored.
- Passwords are hashed with scrypt (salted, via Node's `crypto` module) —
  never stored or logged in plain text.
- Sessions are opaque bearer tokens in an `HttpOnly`, `SameSite=Lax` cookie,
  valid for 30 days; expired sessions are pruned lazily on lookup and also
  swept every 6 hours.
- Set `COOKIE_SECURE=1` to also mark the session cookie `Secure` if you put
  this behind HTTPS; left unset (the default), it works over plain HTTP,
  which is how this app runs locally by default.
- `/api/auth/login` and `/api/auth/signup` are rate-limited per IP (10
  requests / 5 minutes) to slow down brute-forcing or signup spam, as are
  `/api/pull` (5 / 15 minutes), `DELETE /api/models/:name` (10 / 5
  minutes), and `/api/memory/index` (20 / 5 minutes) — pulling a model is
  the most expensive action the app can trigger on the host, and deleting
  models or indexing memory should stay bounded too.
- Chat sessions (`/api/sessions/*`) and semantic memory
  (`/api/memory/index`, `/api/memory/search`) are scoped per-user: one
  account can never read, modify, or delete another account's data through
  these APIs.
- This gates the app to logged-in users; it is not designed to defend
  against a hostile network — see [Security posture](#security-posture).

| Route | Method | Description |
| --- | --- | --- |
| `/api/auth/signup` | POST | Creates an account and logs in; body: `{ username, password }`. Username: 3-32 chars, letters/numbers/`_`/`.`/`-`. Password: 8+ chars. Rate-limited. |
| `/api/auth/login` | POST | Logs in; body: `{ username, password }`. Rate-limited. |
| `/api/auth/logout` | POST | Clears the current session. |
| `/api/auth/me` | GET | Returns `{ user }` (or `{ user: null }` if not logged in); never requires auth itself. |

## API routes

| Route | Method | Description |
| --- | --- | --- |
| `/api/health` | GET | Checks that Ollama is reachable; returns `{ ok, ollama }` or `{ ok: false, error }`. |
| `/api/models` | GET | Lists locally installed models (proxies Ollama's `/api/tags`, raw `{ models: [...] }` shape). |
| `/api/show` | POST | Returns details for a given model (params, template, etc.); body: `{ model }`. |
| `/api/chat` | POST | Streaming chat proxy; forwards newline-delimited JSON chunks from Ollama as they arrive. Aborts the upstream request if the client disconnects. |
| `/api/pull` | POST | Pulls a model with streaming progress; body: `{ name }`. Aborts the upstream pull if the client disconnects. |
| `/api/models/:name` | DELETE | Deletes an installed model by name. |
| `/api/metrics` | GET | Returns an in-memory observability snapshot (see [Observability](#observability)). |
| `/api/memory/index` | POST | Embeds text and stores it in Qdrant for semantic search; body: `{ id, text, metadata }` (or an array of such objects to batch). Batches over 100 items and a single item's `text` over 100,000 chars are rejected with a 400. |
| `/api/memory/search` | POST | Embeds a query and returns the most similar indexed messages from Qdrant; body: `{ query, limit }`. |

## Chat history (local database)

The server persists chat sessions in a JSON file under
`./data/sessions.json` (created on first use; the whole `data/` directory is
git-ignored, so chat content never gets committed). This is the frontend's
chat-history store — the web UI reads and writes `/api/sessions/*` for
every chat it creates, sends messages to, clears, or deletes. Sessions are
scoped to the logged-in user (see [Authentication](#authentication)) — the
`/api/sessions/*` routes below all require and filter by `req.user`.
Writes are batched (one append for the user message, one for the completed
assistant reply), so a streaming response never triggers per-chunk disk
writes.

### Migration from localStorage history

Chats created before the server-session store existed were kept in the
browser's `localStorage`. On first load after the switch, if the account
has no server-side sessions and this browser still holds localStorage
chats, a banner offers a one-time import into the account (each local chat
is created as a session and its messages appended). Dismissing the banner
imports nothing and leaves the localStorage data untouched, so the prompt
simply returns on the next load — nothing is ever deleted automatically.

A session looks like:

```json
{
  "id": "b3f1...",
  "title": "New chat",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "messages": [
    { "role": "user", "content": "hi", "createdAt": "2024-01-01T00:00:00.000Z" }
  ]
}
```

| Route | Method | Description |
| --- | --- | --- |
| `/api/sessions` | GET | Lists session summaries: `{ sessions: [{ id, title, createdAt, updatedAt }] }` (messages omitted). |
| `/api/sessions` | POST | Creates a new session; body: `{ title? }`. Returns the full new session (201). |
| `/api/sessions/:id` | GET | Returns the full session, including `messages`. 404 if the id doesn't exist. |
| `/api/sessions/:id` | PATCH | Updates a session; body: `{ title?, messages?, appendMessages? }`. `messages` replaces the full array, `appendMessages` appends to it (both can be combined: replace then append). Returns the updated session. 400 on malformed messages, 404 if the id doesn't exist. Size-capped: titles over 200 chars, over 1000 messages, or a message `content` over 1,000,000 chars are rejected with a 400. |
| `/api/sessions/:id` | DELETE | Deletes a session; returns `{ ok: true }`. 404 if the id doesn't exist. |

## Semantic memory (Qdrant)

The `/api/memory/index` and `/api/memory/search` endpoints add optional
semantic search / RAG over past chat messages, backed by
[Qdrant](https://qdrant.tech) as the vector store. **Qdrant here only stores
vectors and metadata payloads for similarity search — it is not the primary
chat-history store** (that's a separate feature). These endpoints are not
wired into `/api/chat` automatically; nothing calls them unless you do.
Indexed points are tagged with the indexing user's id and search filters by
it, so semantic memory is also scoped per-user.

### Endpoints

- `POST /api/memory/index`
  Body: `{ "id": "optional-id", "text": "message text", "metadata": { "role": "user", "..." : "..." } }`,
  or an array of such objects to index several messages in one call. `id` is
  optional — a UUID is generated if omitted. Embeds `text` with Ollama and
  upserts the resulting vector into Qdrant with `metadata` as the payload.
  Returns `{ ok: true, indexed: <count> }`.

- `POST /api/memory/search`
  Body: `{ "query": "search text", "limit": 5 }` (`limit` optional, defaults
  to 5). Embeds `query` and returns the closest matches from Qdrant:
  `{ "results": [{ "id", "score", "payload" }, ...] }`.

Both endpoints return `503 { "error": "..." }` if Qdrant or the Ollama
embeddings call is unavailable — they never crash the server. If the Qdrant
collection is deleted externally while the server is running, the next
upsert/search detects it, recreates the collection, and retries once. A
dimension mismatch (e.g. `EMBEDDING_MODEL` changed to a model producing
different-sized vectors, or `EMBEDDING_DIM` changed after the collection
already existed) fails with an explicit error naming both dimensions rather
than an opaque Qdrant error.

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `QDRANT_URL` | `http://127.0.0.1:6333` | Qdrant REST endpoint. |
| `QDRANT_COLLECTION` | `chat_messages` | Qdrant collection used for message vectors; created automatically on first use. |
| `EMBEDDING_DIM` | `768` | Vector size for the Qdrant collection; must match your embedding model's output dimension. |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Ollama model used to generate embeddings (must be pulled, e.g. `ollama pull nomic-embed-text`). |

### Local dev setup

Run Qdrant locally with Docker:

```bash
docker run -p 6333:6333 qdrant/qdrant
```

If Qdrant isn't reachable, the server logs a single startup warning and
keeps running normally — every other route is unaffected, and the two
memory endpoints simply respond with a `503` until Qdrant is available.

## Chat compaction

Long conversations can grow past a model's context window. Before each
`/api/chat` request is forwarded to Ollama, the server runs the outgoing
`messages` array through `compactMessages()` (see `compaction.js`), which
summarizes older turns into a single compact system message and keeps the
most recent turns verbatim. This is purely a pre-processing step on the
outgoing request — it does not change the streaming response behavior.

Compaction triggers only when the conversation exceeds a message-count or
character-count threshold (character count is a rough `chars/4 ≈ tokens`
heuristic, not a real tokenizer). When it triggers, older messages are
summarized via a small non-streaming call to Ollama's `/api/chat`
(`stream: false`), and the result is tagged with a stable `[compacted-summary]`
marker so a later compaction pass can find it and merge new material into
it instead of re-summarizing the whole conversation from scratch. The
summarization call is bounded by `COMPACTION_TIMEOUT_MS` (default 30s), so a
hung Ollama can't stall the otherwise-streaming chat request indefinitely. If
the summarization call fails or times out for any reason, compaction is skipped
and the original messages are sent through unchanged (fail open) — a compaction
error never breaks the chat request.

Configurable via environment variables:

```bash
COMPACTION_MAX_MESSAGES=40   # compact once the conversation exceeds this many messages
COMPACTION_MAX_CHARS=24000   # or once total message content exceeds this many characters
COMPACTION_KEEP_RECENT=8     # number of most recent messages always kept verbatim
COMPACTION_MODEL=llama3      # model used for the summarization call itself (defaults to the request's model)
COMPACTION_TIMEOUT_MS=30000  # how long the summarization call may take before it's aborted
```

## Attachments

The composer's 📎 button lets you attach plain-text files to a message —
supported extensions: `.txt .md .markdown .json .csv .tsv .log .js .ts .py
.html .css .yaml .yml .xml .sh`. Files are read entirely client-side and
folded into the prompt sent to Ollama as fenced `[Attached file: name]` blocks
appended to your message content; nothing is uploaded to a server route.
Limits: 200KB per file, 3 files per message. Attachments are stored
alongside the rest of the chat in the server-side session store
(`/api/sessions/*`), so they persist across reloads like normal messages.
Binary formats (PDF, DOCX, images, etc.) aren't supported.

## Model management

The Settings modal lets you manage models without leaving the app, organized
into "Chat defaults", "Model management", and "Danger zone" sections:

- **Pull a new model** — wired to `POST /api/pull`, which streams progress
  updates back to the UI as Ollama downloads the model.
- **Delete an installed model** — wired to `DELETE /api/models/:name`.

Press **Escape** or click outside the modal to close it; it also returns
focus to the button that opened/closed it, for keyboard users.

## Accessibility & keyboard use

- All icon-only buttons (attach, refresh models, close settings, sidebar
  toggle, stop) have `aria-label`s for screen readers.
- Keyboard focus is always visible (a focus ring appears when tabbing,
  hidden for mouse clicks).
- **Enter** sends a message (Shift+Enter for a newline); **Escape** closes
  the Settings modal; the model-pull field submits on **Enter** too.
- While a response is streaming, an animated cursor and "typing" dots
  indicate activity, and the **Stop** button is clearly labeled for
  cancelling generation.

## Observability

In keeping with the "thin proxy, minimal deps" approach, request logging and
metrics are hand-rolled (`logger.js` / `metrics.js`) instead of pulling in
winston/pino/morgan.

- Every request gets a short random request id, returned as the
  `X-Request-Id` response header.
- On response finish, one structured, single-line log entry is printed to
  stdout, e.g. `[2026-08-10T12:00:00.000Z] INFO GET /api/health 200 1.2ms id=a1b2c3d4e5f6`.
  Only method, route, status, duration, and request id are logged — request
  and response bodies (including chat content) are never logged.
- `GET /api/metrics` returns an in-memory JSON snapshot: total request count,
  total upstream Ollama error count (503s), per-route request counts broken
  down by status code, average/min/max latency per route, process uptime,
  and `process.memoryUsage()`. Metrics live only in memory and reset on
  restart.
