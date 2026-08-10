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

## Memory-fit warning

Loading a model whose weights don't fit in available RAM doesn't fail
cleanly — it typically causes heavy swap thrashing that can make the whole
machine unresponsive, instead of a clean out-of-memory error. To help avoid
that, the UI calls `GET /api/system` to check total/free RAM and warns you if
a selected model's on-disk size is close to or exceeds free memory. This is
a warning only, not a hard block — you can still proceed if you know what
you're doing.

## Attachments

The composer's 📎 button lets you attach plain-text files to a message —
supported extensions: `.txt .md .markdown .json .csv .tsv .log .js .ts .py
.html .css .yaml .yml .xml .sh`. Files are read entirely client-side and
folded into the prompt sent to Ollama as fenced `[Attached file: name]` blocks
appended to your message content; nothing is uploaded to a server route.
Limits: 200KB per file, 3 files per message. Attachments are stored alongside
the rest of the chat in `localStorage`, so they persist across reloads like
normal messages. Binary formats (PDF, DOCX, images, etc.) aren't supported.

## Model management

The Settings modal lets you manage models without leaving the app:

- **Pull a new model** — wired to `POST /api/pull`, which streams progress
  updates back to the UI as Ollama downloads the model.
- **Delete an installed model** — wired to `DELETE /api/models/:name`.
