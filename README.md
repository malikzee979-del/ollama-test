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

## Memory-fit warning

Loading a model whose weights don't fit in available RAM doesn't fail
cleanly — it typically causes heavy swap thrashing that can make the whole
machine unresponsive, instead of a clean out-of-memory error. To help avoid
that, the UI calls `GET /api/system` to check total/free RAM and warns you if
a selected model's on-disk size is close to or exceeds free memory. This is
a warning only, not a hard block — you can still proceed if you know what
you're doing.

## Model management

The Settings modal lets you manage models without leaving the app:

- **Pull a new model** — wired to `POST /api/pull`, which streams progress
  updates back to the UI as Ollama downloads the model.
- **Delete an installed model** — wired to `DELETE /api/models/:name`.
