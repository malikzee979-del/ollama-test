# Ollama Chat

A small local web UI for chatting with models served by [Ollama](https://ollama.com).
It's a thin Express proxy in front of your local Ollama instance plus a static
frontend — nothing you type or generate leaves your machine.

## Prerequisites

- Node.js >= 18
- [Ollama](https://ollama.com) installed and running locally (`ollama serve`,
  or the Ollama desktop app running in the background)
- At least one model pulled (e.g. `ollama pull llama3`), or pull one from the
  app's Settings modal once it's running

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

## API routes

| Route | Method | Description |
| --- | --- | --- |
| `/api/system` | GET | Returns `{ totalMemory, freeMemory }` (bytes) from the host, used for the memory-fit warning. |
| `/api/health` | GET | Checks that Ollama is reachable; returns `{ ok, ollama }` or `{ ok: false, error }`. |
| `/api/models` | GET | Lists locally installed models (proxies Ollama's `/api/tags`, raw `{ models: [...] }` shape). |
| `/api/show` | POST | Returns details for a given model (params, template, etc.); body: `{ model }`. |
| `/api/chat` | POST | Streaming chat proxy; forwards newline-delimited JSON chunks from Ollama as they arrive. Aborts the upstream request if the client disconnects. |
| `/api/pull` | POST | Pulls a model with streaming progress; body: `{ name }`. Aborts the upstream pull if the client disconnects. |
| `/api/models/:name` | DELETE | Deletes an installed model by name. |
| `/api/metrics` | GET | Returns an in-memory observability snapshot (see [Observability](#observability)). |
| `/api/memory/index` | POST | Embeds text and stores it in Qdrant for semantic search; body: `{ id, text, metadata }` (or an array of such objects to batch). |
| `/api/memory/search` | POST | Embeds a query and returns the most similar indexed messages from Qdrant; body: `{ query, limit }`. |

## Chat history (local database)

The server can also persist chat sessions itself, in a JSON file under
`./data/sessions.json` (created on first use; the whole `data/` directory is
git-ignored, so chat content never gets committed). This is separate from —
and not currently wired up to — the frontend's existing localStorage-based
history; the two will be reconciled in a later change.

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
| `/api/sessions/:id` | PATCH | Updates a session; body: `{ title?, messages?, appendMessages? }`. `messages` replaces the full array, `appendMessages` appends to it (both can be combined: replace then append). Returns the updated session. 400 on malformed messages, 404 if the id doesn't exist. |
| `/api/sessions/:id` | DELETE | Deletes a session; returns `{ ok: true }`. 404 if the id doesn't exist. |

## Semantic memory (Qdrant)

The `/api/memory/index` and `/api/memory/search` endpoints add optional
semantic search / RAG over past chat messages, backed by
[Qdrant](https://qdrant.tech) as the vector store. **Qdrant here only stores
vectors and metadata payloads for similarity search — it is not the primary
chat-history store** (that's a separate feature). These endpoints are not
wired into `/api/chat` automatically; nothing calls them unless you do.

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
embeddings call is unavailable — they never crash the server.

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

## Memory-fit warning

Loading a model whose weights don't fit in available RAM doesn't fail
cleanly — it typically causes heavy swap thrashing that can make the whole
machine unresponsive, instead of a clean out-of-memory error. To help avoid
that, the UI calls `GET /api/system` to check total/free RAM and warns you if
a selected model's on-disk size is close to or exceeds free memory. This is
a warning only, not a hard block — you can still proceed if you know what
you're doing.

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
it instead of re-summarizing the whole conversation from scratch. If the
summarization call fails for any reason, compaction is skipped and the
original messages are sent through unchanged (fail open) — a compaction
error never breaks the chat request.

Configurable via environment variables:

```bash
COMPACTION_MAX_MESSAGES=40   # compact once the conversation exceeds this many messages
COMPACTION_MAX_CHARS=24000   # or once total message content exceeds this many characters
COMPACTION_KEEP_RECENT=8     # number of most recent messages always kept verbatim
COMPACTION_MODEL=llama3      # model used for the summarization call itself (defaults to the request's model)
```

## Model management

The Settings modal lets you manage models without leaving the app:

- **Pull a new model** — wired to `POST /api/pull`, which streams progress
  updates back to the UI as Ollama downloads the model.
- **Delete an installed model** — wired to `DELETE /api/models/:name`.

## Observability

In keeping with the "thin proxy, minimal deps" approach, request logging and
metrics are hand-rolled (`logger.js` / `metrics.js`) instead of pulling in
winston/pino/morgan.

- Every request gets a short random request id, returned as the
  `X-Request-Id` response header.
- On response finish, one structured, single-line log entry is printed to
  stdout, e.g. `[2026-08-10T12:00:00.000Z] INFO GET /api/system 200 1.2ms id=a1b2c3d4e5f6`.
  Only method, route, status, duration, and request id are logged — request
  and response bodies (including chat content) are never logged.
- `GET /api/metrics` returns an in-memory JSON snapshot: total request count,
  total upstream Ollama error count (503s), per-route request counts broken
  down by status code, average/min/max latency per route, process uptime,
  and `process.memoryUsage()`. Metrics live only in memory and reset on
  restart.
