# Feature build-out — all 20 requested features

Status of the 20-feature list against the core web app (server + `public/`),
which is the scope that was approved. Verified 2026-10-14: `npm test` 140/140
pass, `npm run lint` clean.

## Implemented in this build (new code)

| # | Feature | Where |
| --- | --- | --- |
| 3 | RAG document chat | `POST /api/documents` (chunk + embed into Qdrant, `kind: 'document'`); `useDocuments` flag on `POST /api/chat`; indexing UI in Settings → "Document library (RAG)" |
| 4 | Model comparison | `POST /api/compare` (parallel, ≤4 models, per-model error isolation, tok/s); Compare modal in the top bar |
| 6 | System prompt presets | Settings → "System preset" (save/load/delete; localStorage, matching how settings are stored) |
| 7 | Voice input & TTS output | Mic button (Web Speech API dictation, hidden where unsupported); "Speak" action on assistant replies (speechSynthesis) |
| 9 | Token usage stats | Stats modal in the top bar (message counts, estimated tokens, context window, per-model breakdown) |
| 10 (share half) | Read-only share links | `POST /api/sessions/:id/share` (re-sharing revokes the old token), public `GET /api/share/:token`, read-only `public/share.html` |
| 12 (auto-pull half) | One-click pull on missing model | 404 from `/api/chat` renders an error banner with a "Pull <model>" action |
| 13 | Slash commands + palette | `/model`, `/system`, `/clear`, `/new`, `/help` in the composer; Cmd/Ctrl+K command palette |
| 14 | Pinned facts | Pins CRUD (`/api/pins`), injected ahead of semantic-memory excerpts on memory-enabled chats; UI in Settings |
| 16 | Multi-server support | `OLLAMA_HOSTS` env var, `GET /api/servers`, per-chat `serverId`; unknown ids fall back to the primary (no SSRF) |
| 17 | Prompt library with variables | Settings → "Prompt library"; `{{variables}}` filled in on use |
| 19 (bridge half) | Game NPC bridge | `POST /api/game-npc` — capped (60 tokens), rate-limited NPC-dialogue endpoint for the game clients |
| 20 | Audit log | Bounded per-user record (pulls, deletes, exports, shares, doc indexing) in `data/aux.json`; `GET /api/audit`; viewer in Settings |

## Already existed before this build (verified present, unchanged)

| # | Feature | Evidence |
| --- | --- | --- |
| 1 | Streaming + markdown rendering + code copy | `streamAssistantReply`, `renderMarkdown` in `public/app.js` / `public/chat-helpers.js` |
| 2 | Multi-conversation sidebar with search | `renderChatList`, `GET /api/sessions/search` |
| 5 | Regenerate / edit last message | `regenerateMessage`, `startEditingMessage` (linear history by design — PLAN.md C1) |
| 10 (export half) | Markdown/JSON export + full-data download | `chatToMarkdown`/`chatToJson`, `GET /api/export` |
| 11 | Image + text attachments | `attachments`/`images` plumbing in `public/app.js` and `server.js` |
| 12 (progress half) | Model pull with streaming progress | `pullModel` in `public/app.js`, `POST /api/pull` |
| 15 | Auto conversation compaction + context meter | `compaction.js`, `X-Compacted` header, context meter UI |
| 18 | Dark/light theme | `toggleTheme`, `themeToggle*` in `public/app.js` + `index.html` |

## Explicitly out of the approved scope

| # | Feature | Why not here |
| --- | --- | --- |
| 8 | Offline-first mobile clients | Mobile (Flutter/RN) clients — the approved scope was the core web app only |
| 19 (game wiring half) | Wiring the game to `/api/game-npc` | The endpoint ships; calling it from `marketing/game.js` and the Unity port touches those satellites, outside the core-app scope |

Say the word and the mobile offline-sync and game wiring halves can be built as a follow-up.
