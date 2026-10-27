# Project TODO — Ollama Chat

The **single living backlog** for this repo. Health re-verified **2026-10-07**
against a live run of `npm test`, `npm run lint`, `npm audit --omit=dev`,
`npm audit --json` and `git status`. The satellite read-through behind Phase 3 is still
the **2026-09-14** one and was not re-audited.

Supersedes the 2026-09-12 revision of this file, and **absorbs
`PLAN-improvements.md`** (2026-09-06), whose still-live content is folded in
below. `PLAN.md` remains the feature roadmap and is referenced from Phase 4.

## Planning-doc map

| Doc | Role | Status |
| --- | --- | --- |
| `TODO.md` (this file) | The living backlog — everything actionable, prioritized | **Current** |
| `PLAN.md` | Feature roadmap (phases A–E), open product decisions, commit breakdown | Current; phase B has landed |
| `PLAN-improvements.md` | Health & quality plan, 2026-09-06 | **Superseded** — kept for its verification history and trade-off reasoning |

If you add work, add it here. Don't start a fourth plan.

## Health today (verified 2026-10-07)

| Check | Result |
| --- | --- |
| `npm test` | **Green** — 120/120 (`node --test`, 12 suites, ~2s) |
| `npm run lint` | **Green** — exit 0, 0 problems (fixed 2026-09-09 in `eslint.config.js`) |
| `npm audit --omit=dev` | **0 vulnerabilities** — cleared 2026-10-03 via an `undici: ^7.29.1` override (the `@qdrant/js-client-rest@1.19.0` pin dragged in a vulnerable undici); re-cleared 2026-10-07 via `npm audit fix` after a critical `proxy-addr` advisory (IP spoofing, GHSA-jqcg-44mw-7w3h) regressed in; `proxy-addr` now at 2.0.8. See 2.1 |
| `npm audit` (incl. dev) | **10 total — 0 critical, 2 high, 8 moderate**, all dev-side (electron-builder 26 tree; the 2026-09-21 critical `tar` set is gone post-2.6). See 2.6 |
| CI | **Active** — `.github/workflows/ci.yml` (Node 22, npm ci, lint, test) + an audit job (`npm audit --omit=dev --audit-level=high`, added 2026-10-07). |
| Git | **Healthy** — committed in chunks 2026-10-03 (404 files tracked; core, electron, docs+CI, satellites). Fresh-clone `npm ci && npm test` verified green. See Phase 0 |
| `.gitignore` | **Hardened** — root file now covers `scratchpad/`, `.idea/`, `.vscode/`, `.pixis/`, the root binaries, and `.DS_Store` (2026-10-03) |
| Satellites | `python_app` has four real behavioural defects and zero tests; `mobile/` renders a retired design. See Phase 3 *(from the 2026-09-14 read-through; not re-verified)* |

Both quality gates are green, which means **CI is now a pure win** — it no
longer has any prerequisite work. That reordering is the main change from the
2026-09-06 plan, which had CI gated behind making lint pass.

---

## Phase 0 — Repo safety net (blocking; do first)

**Why:** everything else in this plan sits on uncommitted ground. `git ls-files`
returns 14 files. Untracked: `auth.js` (required by tracked `server.js` at
runtime — a fresh clone cannot start), all of `test/`, `eslint.config.js`,
`electron/`, `mobile/`, `mobile-rn/`, `marketing/`, `python_app/`, `unity/`,
`public/auth.js`, the login/signup pages, the fonts, and all four planning docs.
Meanwhile ~4GB of build artifacts (`unity/.../Library` 1.7G, `scratchpad` 1.3G,
`mobile/build` 1.1G) are *not* ignored and are one `git add .` away.

- [x] **0.1 Harden the root `.gitignore`** (done 2026-10-03). Verified 2026-09-21 with
      `git check-ignore -v`: the root file is only **10 lines** (`node_modules/`,
      `.env`, `.env.local`, `*.log`, `.DS_Store`, `data/`, four `python_app/`
      entries, `.nicegui/`). Add `scratchpad/`, `.idea/`, `.vscode/`,
      `.opencode/`, `.pixis/`, `dist/`, and
      `unity/LocalTheftAuto/{Library,Logs,Builds,UserSettings}/`.

      Two corrections to the previous wording of this item:
      - **`scratchpad/` is not ignored** (1.3G) — the old "already covered"
        claim was wrong. `data/`, `node_modules/` and `python_app/.venv/`
        genuinely are covered.
      - `.pixis/`, `unity/LocalTheftAuto/Library` and `mobile/build` *are*
        currently ignored, but only by **nested `.gitignore` files that are
        themselves untracked** (`.pixis/.gitignore:1`,
        `unity/LocalTheftAuto/.gitignore:2`, `mobile/.gitignore:33`). A fresh
        clone gets none of them, so ~4GB of artifacts comes back. Hoist the
      load-bearing patterns into the root file here, and commit the nested
      files in 0.3. Landed: root file now covers `scratchpad/`, `.idea/`,
      `.vscode/`, `.pixis/`, the root binaries, and `.DS_Store`; the nested
      `.gitignore` files shipped with their satellites in 0.3. The `.vscode/`
      settings file stays untracked by choice.
- [x] **0.2 Decide the home of the loose root binaries** (decided 2026-10-03:
      ignored in place; relocation to `marketing/` deferred — see 5.2-style
      cleanup). `gameplay.webm`
      (4.7MB) and `busy_cyberworld_0.mp3` (460KB) most likely belong under
      `marketing/` as game assets — move them there, or ignore them.
      `PROJECT-overview.pdf` is generated output — ignore or delete.
      All three confirmed still untracked and un-ignored as of 2026-09-21.
      Now ignored (`/gameplay.webm`, `/busy_cyberworld_0.mp3`); the generated
      `PROJECT-overview.pdf` stays untracked pending deletion.
- [x] **0.3 Commit the working tree** (done 2026-10-03, owner-approved) in
      logical chunks: core app + tests;
      electron; mobile clients; marketing; unity; python_app; docs.
      Note that 10 of the 14 tracked files also **differ from HEAD**
      (`.gitignore`, `README.md`, `db.js`, `package.json`,
      `package-lock.json`, `public/app.js`, `public/index.html`,
      `public/style.css`, `qdrant.js`, `server.js`), so even the committed
      part of the tree is stale — this is a "commit everything", not just a
      "add the missing files".
      **Requires explicit owner sign-off — `AGENTS.md` forbids autonomous
      commits.** This is a recommendation, not an autonomous action. Four
      chunks landed: core+tests, electron, docs+CI, satellites (404 files).
- [x] **0.4 Verify the clone** (verified 2026-10-03, 75/75 then; suite has
      since grown to 84). `git clone` into a temp dir, then
      `npm ci && npm test` there. This is the only real proof Phase 0 worked.

Effort: **S**. The only true blocker in this plan.

## Phase 1 — CI (now unblocked; do immediately after Phase 0)

- [x] **1.1 Add `.github/workflows/ci.yml`** (existed untracked; committed
      2026-10-03 in the docs+CI chunk). Node 22 (matches
      `engines >=22.5.0` and the `node:sqlite` requirement), then `npm ci`,
      `npm test`, `npm run lint`. The suite is hermetic by design — temp
      `AUTH_DB_FILE`/`SESSIONS_DATA_FILE`, fake Ollama, fake Qdrant client —
      so no external services are needed.
- [x] **1.2 Add an audit gate** (done 2026-10-07). Second CI job running
      `npm audit --omit=dev --audit-level=high`. It would have caught the
      `proxy-addr` critical regression that slipped in after 2026-10-03.
- [ ] **Verify:** push a branch, watch the workflow pass.

Effort: **XS**. Converts a manual habit into an enforced invariant.

## Phase 2 — Security & hardening batch

All small, all testable against existing harnesses (`test/server.test.js`
signup-then-cookie pattern; `test/server-streaming.test.js` fake Ollama).

- [x] **2.1 Close the production advisories without leaving Express 4**
      (done 2026-10-03, but the fix turned out to be `undici`, not `qs`):
      `qs` already resolved to 6.16.0 via `express@4.22.3 → body-parser`,
      so no qs override was needed. The runtime advisories were ten undici
      ones (1 high + 1 moderate) dragged in by `@qdrant/js-client-rest@1.19.0`
      pinning `undici@7.29.0`; cleared with `"overrides": { "undici":
      "^7.29.1" }` (first fixed patch release) rather than the audit's
      `--force` path of downgrading the qdrant client to the API-breaking
      1.18.0. `npm audit --omit=dev` → 0.
      **Deliberately stay on Express 4:** Express 5 removed array path routes,
      and `server.js:231` uses `app.get(['/', '/index.html'], ...)`. Revisit at
      4.x EOL.
- [x] **2.2 Fix `parseCookies` (`server.js:110`)** (done 2026-10-03 with
      regression test). Unguarded
      `decodeURIComponent` throws `URIError` on malformed cookies (`sid=%`).
      That middleware runs on *every* request, so a crafted cookie is a remote
      500. Reproduced 2026-09-06. Wrap the decode in try/catch, skip malformed
      values, **add a regression test**.
- [x] **2.3 Evict stale IPs from the rate-limiter `hits` Map**
      (done 2026-10-03 with test). The "one-line" delete-on-empty idea was a
      no-op — the triggering request immediately re-adds the key — so the fix
      is an opportunistic sweep, at most once per window, inside
      `rateLimiter` (shared by all four limiters).
- [x] **2.4 Add a Host-header guard** (done 2026-10-03 with tests and README
      Security-posture documentation; `test/server-host-guard.test.js` covers
      the allowlist). Any browser on the LAN — or a malicious
      web page via DNS rebinding — can hit cookie-authenticated endpoints.
      Reject unless `Host` is loopback (`localhost`, `127.0.0.1`, `[::1]`) or
      listed in a new `HOST_ALLOWLIST` env (comma-separated). ~15 lines, one
      403 path, mirrors the existing hand-rolled middleware style — no new
      dependency. **Document `HOST_ALLOWLIST` in the README Security-posture
      section in the same change**, since the default will surprise anyone
      serving the app on a LAN IP.
- [x] **2.5 Validate `/api/chat` message shape** (done 2026-10-03 with
      regression tests; the predicate is now hoisted to module scope). `messages` is only checked to
      be an array; reuse the `isValidMessage` predicate already at
      `server.js:509` for clean 400s instead of opaque upstream errors.
- [x] **2.6 Upgrade `electron-builder` 25 → 26** (done 2026-10-03, commit
      `7a69157`, with routine in-semver bumps: electron `^43.6.0`,
      eslint `^10.x`, globals `^17.x`). The critical `tar` and 13-high set are
      gone; what remains in `npm audit` is 10 dev-side advisories (2 high,
      8 moderate) in the electron-builder 26 tree — tracked, non-blocking.
      If the build config breaks, pin 25 and accept the dev-only risk.
- [x] **2.7 Close the "Qdrant reconnection loop" item as already-solved**
      (verified 2026-10-07). `ensureCollection()` re-runs on every
      upsert/search while `collectionReady` is false (`qdrant.js:28`, reset
      again at `:76`), so a Qdrant that starts *after* the server is picked up
      automatically on the next request. The flap test exists at
      `test/qdrant.test.js:191` asserting 503-then-success via
      `_setClientForTests`. **No code was needed.**
- [x] Per-username lockout after repeated failed logins (landed 2026-10-07).
      Failed logins counted per (username, IP) pair in `auth.js`
      (`loginLockRemaining` / `recordLoginFailure` / `clearLoginFailures`),
      wired into the login route before any DB/scrypt work, 429 with
      `Retry-After` at 5 failures / 15 minutes. Deliberately per-pair, not
      per-username-globally: a global lock would make one attacker able to
      DoS any account by failing five times. Success clears the pair.
      Tested in `test/auth.test.js`.
- [x] Password reset / "forgot password" (done 2026-10-03, commit `cff031b`):
      **local/CLI reset** — `node auth.js --reset-password <username>` —
      matching this project's local-first, dependency-averse posture, rather
      than an emailed-token flow needing SMTP.

Effort: **S** total. Verify: `npm audit --omit=dev` → 0; new tests green;
`npm run dist` still builds.

## Phase 3 — Satellite correctness *(new track)*

The previous plans treated the satellites as one optional line ("python_app has
no tests"). A full read-through found real behavioural defects. Ranked by
severity.

### Two product decisions gate this phase

> **Decision A — is `python_app` a maintained port or a demonstration?**
> If maintained: fix all of 3.1 and add pytest smoke tests. If it's a
> demonstration: say so in its README and fix only the one-liner (3.1.1).
> Don't harden a proof of concept.
>
> **Decision B — do both mobile clients survive?** `mobile/` (Flutter) and
> `mobile-rn/` (React Native) are feature-for-feature duplicates. Answer this
> *before* investing in 3.2: theming a client you're about to delete is wasted
> work.

### 3.1 `python_app` — four defects

- [x] **3.1.1 Observability is dead code** (fixed 2026-10-07). `main.py` now
      registers `logging_metrics_middleware` (defined in `api.py`) after
      `AuthMiddleware`; verified statically (import wiring + syntax via the
      venv). `/api/metrics` is live and `X-Request-Id` is emitted. The
      remaining 3.1.x items stay open, still gated on Decision A.
- [ ] **3.1.2 UI login never sets the `sid` cookie** (`pages/login.py`), so a
      browser UI session cannot authenticate against the REST `/api/sessions`
      and `/api/memory` endpoints the app itself ships.
- [ ] **3.1.3 `stop_streaming()` is a no-op** (`pages/chat.py`) — it only hides
      the button; `state["stream_task"]` is set but never used, so Ollama keeps
      generating. This is the same class of bug the Node version fixed in commit
      `df636e6`.
- [ ] **3.1.4 The UI chat path bypasses compaction.** `pages/chat.py` calls
      `ollama_client.stream_chat` directly, so `compact_messages` never runs and
      long conversations overflow the context window — in the Python UI only.
- [ ] Smaller: dead `try/except OllamaError` around `StreamingResponse` in
      `api.py` (generators raise only when iterated, after headers are sent, so
      upstream mid-stream 4xx/5xx can't become JSON errors); rate limiting
      missing on pull/delete/memory-index (Node has all three);
      `STORAGE_SECRET` defaults to `"dev-secret-change-me"`; deprecated
      `@app.on_event("startup")`; unused `AuthError` import in `login.py`.
- [ ] **No tests exist for the Python app at all.** If Decision A is
      "maintained", add pytest smoke tests covering auth, the streaming proxy,
      and compaction. `_set_client_for_tests` already survives in
      `qdrant_store.py`, so the injection pattern ports over.

### 3.2 `mobile/` (Flutter) — design drift

- [ ] **`theme.dart` renders a retired design.** It explicitly ports the *old
      console* aesthetic: `BorderRadius.zero` throughout, hairline borders,
      tmux-style status rail, block cursor, square LEDs. The web UI was
      redesigned to the rounded neutral vocabulary afterwards, and `mobile-rn`
      already follows the new one. So `mobile/` is the only client rendering a
      design the project has moved off. Effort **M** (`theme.dart` is 367 LOC) —
      **gated on Decision B**.
- [ ] `mobile/README.md` and the `pubspec.yaml` description are still the stock
      "A new Flutter project" template.
- [ ] `test/widget_test.dart` is one 23-line smoke test. `integration_test/` and
      `tool/live_e2e_test.dart` are solid but both need a live server + Ollama.
- [ ] The Flutter client also lacks model pull/delete, attachments, and
      semantic-memory search — all web/desktop-only today.
- [ ] Platform config is correct for LAN HTTP (`usesCleartextTraffic`,
      `NSAllowsArbitraryLoads`) — no action, verified.

### 3.3 `mobile-rn/` — smaller items

- [ ] No `ios/` directory has ever been prebuilt, though the README documents
      `npx expo run:ios`. Either prebuild it or correct the README.
- [ ] `ChatScreen.tsx` reads `messagesRef.current` right after its `finally`
      block, but the ref only updates on re-render — on abort it can persist
      slightly stale content.
- [ ] `toggleTheme` cycles dark↔light only, dropping a persisted `'system'`
      mode; `setThemeMode` is defined but unused by any screen.
- [ ] Contradictory copy: `SignupScreen` says "There is no server to register
      with" while `AuthMeta` on the same flow says "Local SQLite / scrypt
      hashed / No network". Both are inherited web copy and both are wrong for a
      client-server app.
- [ ] Verified correct, no action: platform cookie jars instead of manual `sid`
      capture; per-weight IBM Plex families; ChatGPT-style tokens in
      `src/theme/design.ts`; `e2e/flow.mjs` coverage.

### 3.4 `unity/LocalTheftAuto/` — doc drift

- [ ] The README claims "no binary assets", but `Assets/Resources/Audio/` holds
      14 real wav/ogg clips with an `Assets/Audio/CREDITS.md`. `LTA.Audio.cs:136`
      loads them with a synth fallback. **Fix the sentence, not the code.**

### 3.5 Shared harness & scratch

- [ ] `mobile-rn/e2e/flow.mjs` hardcodes
      `/opt/homebrew/share/android-commandlinetools/platform-tools/adb`. Make it
      an `ANDROID_ADB` env var with a `which adb` fallback if anyone else is
      ever meant to run it.
- [ ] `scratchpad/` — prune it or keep it permanently ignored (already lint-
      and git-ignored once 0.1 lands).

Effort: **S–M**. Verify: each python_app fix needs a smoke test; Flutter theming
is visual and needs a simulator; the mobile-rn items are unit-checkable.

## Phase 4 — Features on the canonical store

Carried from `PLAN.md` Phase C. **The Phase B gate is cleared** — sessions are
now the source of truth and localStorage survives only as a one-time migration
source behind a confirm banner.

- [x] **4.1 Wire semantic memory into `/api/chat` (RAG)** (landed 2026-10,
      commit `b42195e`; entry was stale). Opt-in `useMemory` flag → embed the
      latest user message → Qdrant search scoped to `req.user.id` → injected
      as a system message via `injectMemoryMessage` (server.js), placed so
      `compaction.js`'s marker-scan still works. Each completed turn is
      auto-indexed; the path fails open inside its own try/catch. (`PLAN.md` C4)
- [x] **4.2 Regenerate / edit a message** (landed — `public/app.js`
      `regenerateMessage`, linear-history truncate-and-replay).
      Truncate `chat.messages` and re-call
      the existing `streamAssistantReply`; persist via `PATCH .../:id` with a
      full `messages` replace. **Linear history only** — true branching is a
      `db.js` schema change and explicitly out of scope. Check the interaction
      with attachments (regenerate must resend the same bytes). (`PLAN.md` C1)
- [x] **4.3 Export chat as Markdown / JSON** (landed — `public/app.js`
      `chatToMarkdown` / `chatToJson`). Frontend-only, least coupled of
      the Phase 4 items, so it can jump the queue. Blob + `<a download>`, no new
      dependency; Markdown reuses the existing `[Attached file: ...]` fenced
      format. (`PLAN.md` C2)
- [x] **4.4 Chat search** (landed 2026-10, commit `d956872`; entry was stale).
      `db.js searchSessions(userId, query)` — linear case-insensitive
      substring scan — exposed as `GET /api/sessions/search?q=...` (per-user
      scoped), with a sidebar search input in the frontend. (`PLAN.md` C3)
- [ ] **4.5 Frontend testability.** First cut landed —
      `public/chat-helpers.js` (166 LOC, CommonJS export guard, loaded by both
      `<script>` and `node --test`, covered by `test/chat-helpers.test.js`).
      This phase-2 item keeps it moving: extract the *next* stateless chunks
      from `public/app.js` (1,472 lines) with the same pattern rather than
      splitting into ES modules now (5.1 is "always last").
- [x] **4.6 Small server-side coverage adds.** Logger format, metrics
      aggregation, and now the *server-level* `/api/metrics` route
      (auth-gate + JSON shape over HTTP, `test/server.test.js`). Done
      2026-10-07.
- [x] **4.7 Image / vision input** (landed 2026-10-07). Parallel attachment
      path: allowlist `.png .jpg .jpeg .webp .gif` (`IMAGE_EXTENSIONS` in
      chat-helpers.js), 4MB per-image cap, base64 into Ollama's
      `images: [...]` via `buildOllamaMessages` (text attachments keep the
      fenced-block path), thumbnail chips in the composer and sent messages,
      and a `type: 'image'` discriminator on the persisted attachment.
      Server-side: `/api/chat` and the PATCH routes validate the `images`
      array shape before forwarding. `compactMessages()` was already
      passthrough-safe (spread, not rebuild) — pinned by a test; note the
      chars heuristic indeed does not count base64 weight (documented in
      test/compaction.test.js). (`PLAN.md` D3)
- [ ] **4.8 PDF text extraction.** Client-side, vendored pdf.js UMD under
      `public/vendor/` — no live CDN, which keeps "nothing leaves your machine"
      true. DOCX explicitly out of scope. Lowest priority. (`PLAN.md` D4)

## Phase 5 — Structural debt (deferred, with explicit triggers)

- [ ] **5.1 Split `public/app.js` into ES modules.** *Always last* — every other
      frontend item touches the monolith. It already has 16 labeled
      `// ----------` section boundaries mapping cleanly onto the proposed
      `state/render/models/attachments/chat-stream/settings-modal/main`
      modules. Native ES modules, no build step. Shared mutable state (`el`,
      `chats`, `settings`) moving into an explicit `state.js` is a real design
      decision, not a mechanical split. One module per commit, app fully working
      after each. (`PLAN.md` D5)
- [ ] **5.2 `db.js` storage ceiling.** The whole sessions map lives in memory
      and the entire `sessions.json` is rewritten on every mutation.
      `data/sessions.json` is 47KB today, so this is fine. **Trigger to act:
      file > ~5MB, or visibly slow PATCHes.** Migration path is `node:sqlite`,
      reusing `auth.js`'s exact patterns (env-overridable path, prepared
      statements, temp-file tests) — no new dependency, keeps the
      native-build-free stance. Document `sessions.json` format stability
      guarantees (or the lack of them) either way.
- [x] **5.3 Export/backup tooling** (landed 2026-10-07). Auth-scoped
      `GET /api/export` returns every owned session incl. full messages as
      a `Content-Disposition` JSON download, backed by `db.exportSessions`;
      the Settings modal has a "Download my data" button;
      `node auth.js --backup-authdb [dest-dir]` copies `data/auth.db` to a
      timestamped file (default `data/backups/`). Session-level Markdown/
      JSON export (`4.3`) was already available per-chat.
- [ ] **5.4 UX safety & surfacing.** Confirm dialog for destructive/expensive
      actions (any logged-in user can `DELETE /api/models/:name` today —
      documented, but the dialog is cheap); surface the attachment limits
      in-app (plain-text-only, 200KB / 3 files — currently README-only);
      **landed 2026-09 (see Done):** the `X-Compacted: true` response header when `compactMessages()` actually
      changed the array, plus a subtle "earlier turns were summarized" note
      instead of fully silent compaction; a context-window meter using the
      exported `chars/4 ≈ tokens` heuristic against `settings.numCtx`; review
      error/empty states (what the UI shows when `/api/models` or `/api/health`
      fail) for friendliness, not just non-crashing. (`PLAN.md` D1)
- [ ] **5.5 Per-chat settings presets.** Global named presets
      `{ name, systemPrompt, temperature, topP, numCtx }`, each chat storing
      which preset it last used. Persist `settings` on the session (small
      `db.js` extension) now that Phase B has landed. (`PLAN.md` D2)
- [ ] **5.6 Optional:** structured/JSON log output (`logger.js` is plain text);
      persist `/api/metrics` (in-memory only, resets on restart).

## Phase 6 — Doc hygiene

- [x] **6.1 Consolidate the planning docs** (done 2026-09-14): this file is now
      the single backlog; `PLAN-improvements.md` is marked superseded with its
      live content folded in above; `PLAN.md` records that its Phase B has
      landed. Two docs plus this backlog, not four overlapping ones.
- [ ] **6.2 Add a CONTRIBUTING.md** if outside contributions are expected.
- [ ] **6.3 Keep this file honest.** When you finish an item, move it to Done
      with a date. When a verification number changes (test count, audit
      result), update the Health table in the same commit — stale health claims
      are how the previous three docs drifted apart.

## Phase 7 — Feature backlog (2026-10-14 round 2)

Fresh 20-feature wishlist, recorded here per 6.1 ("if you add work, add it
here"). None of these duplicate the shipped round 1 list in `FEATURES.md`.
Unchecked = not started. Priorities are suggestions; owner input welcome.

### Chat & UX
- [ ] **7.1 Branching conversations.** Fork from any message into a tree of
      branches. Note: `db.js` schema change — 4.2 explicitly declared linear
      history in scope-avoidance; this lifts that.
- [x] **7.2 Message reactions & tags.** Reaction half landed 2026-10-14:
      👍/👎 on any completed assistant reply (second click on the active one
      clears it), persisted as a coerced `reaction` field via db.js
      normalizeMessage (only 'up'/'down' survive a write), so the choice
      survives a reload. Tags not built — the same field shape would carry
      them, but the UI is undecided.
- [x] **7.3 Prompt shortcuts toolbar.** Clickable chips (Summarize,
      Translate, Explain code, Brainstorm, Proofread) above the composer;
      fills the composer, never auto-sends; `{{variables}}` prompted for
      first (extraction via `templateVariables` in chat-helpers.js). Landed
      2026-10-14: `renderShortcutBar`/`applyShortcut` in app.js,
      `.shortcut-chip` in style.css.
- [x] **7.4 Inline code-diff view.** Landed 2026-10-14 (simplified shape):
      `renderMarkdown` gives ` ```diff ` fenced blocks per-line coloring —
      `+` additions, `-` removals, `@@` hunk headers, `--- /+++` file
      headers as context — via `renderDiffCode` in chat-helpers.js. Content
      is escaped before class spans wrap it, so diff text can't inject
      markup; non-diff blocks are untouched. Not an interactive
      apply/copy-diff editor — that larger shape stays open.
- [ ] **7.5 Multi-model "council" mode.** One prompt → several models, answers
      merged into a combined reply; extends `POST /api/compare`.

### Knowledge & memory
- [ ] **7.6 PDF/OCR ingestion for RAG.** Scanned PDFs and screenshots into the
      document library. Absorbs **4.8** (pdf.js is already a dev dep); OCR
      needs a pick (tesseract.js?) — owner decision.
- [x] **7.7 RAG citations.** Landed 2026-10-14: server.js collects the
      document retrieval hits and returns them base64-encoded in an
      `X-Citations` response header (only when `useDocuments` is on; pure
      mapping in `citations.js`, `MAX_CITATIONS` 12, snippet cap 200 chars);
      app.js attaches them to the assistant message, db.js persists a
      well-formed `citations` array, and the UI renders a collapsed
      "Sources (n)" block. Malformed header fails open (no citations).
- [x] **7.8 Memory editing UI.** Landed 2026-10-15: qdrant.js gains
      `listPoints` (scroll by userId filter, paginated), `deletePoint`
      (id + userId filter), and `updatePointText` (retrieve scoped by
      owner, re-embed, upsert preserving metadata); routes
      `GET/DELETE/PATCH /api/memory/points[/:id]` (rate-limited, per-user
      scoped); Settings → "Stored memory" viewer with inline edit (Save
      re-embeds) and confirm-guarded delete, paginated via next page.
      A guessed id can never touch another account's point.
- [x] **7.9 URL summarizer.** Landed 2026-10-15: POST `/api/summarize-url`
      fetches a client-supplied page server-side with a deliberate SSRF
      posture — http(s) only, no embedded credentials, all resolved
      addresses must be public (private/loopback/link-local refused),
      redirects not followed, 2MB body cap, HTML/plain-text only — then
      strips to text and summarizes via Ollama with the chosen model.
      Audited as `url.summarize`. Settings → "Summarize a web page" puts
      the result in the composer via "Use as prompt" (never auto-sent).

### Models & performance
- [ ] **7.10 Model health dashboard.** Ollama status, loaded models,
      VRAM/RAM, pull history.
- [x] **7.11 Auto model routing.** Landed (client-side; verified 2026-10-21):
      pure `suggestModel({models, text, currentModel})` in `chat-helpers.js`
      (code-detected prompts route to the largest `coder`-family model,
      short prompts to the smallest installed, long ones to the largest —
      keeping the current model when it already fits), covered by
      `test/chat-helpers.test.js`. Settings → "Auto model routing" checkbox
      (`#autoRoute`); when on, the send path re-picks the model per prompt
      (`app.js` ~1318). No server route needed — the installed-model list is
      already client-visible.
- [x] **7.12 Quantization advisor.** Landed (verified 2026-10-21): pure
      `quantizationSuggestions(installed)` in `chat-helpers.js` — groups
      installed models by shared base name and suggests a same-family
      variant that is ≥30% smaller on disk, returning saved bytes/percent;
      rendered in the model-health modal (`app.js` ~2903).
- [x] **7.13 Response caching.** Landed 2026-10-14: in-browser LRU (50
      entries, tab-lifetime) keyed by `cacheKeyFor` — model + full
      Ollama-shaped conversation prefix + sampling options + serverId, with
      key-order-insensitive option objects. Hits replay the reply instantly
      with a "· cached" role badge and short-circuit to persistence;
      regenerate and edit bypass the cache (a cached regenerate would be a
      no-op). Opt-out checkbox in Settings ("Cache identical responses");
      hit/miss/stored counts in the stats modal.

### Platform & integrations
- [ ] **7.14 API tokens.** Personal API keys so scripts can call `/api/chat`
      without browser-cookie auth. Security review needed (2.x discipline).
- [ ] **7.15 Webhook triggers.** Fire configurable HTTP hooks on events (pull
      finished, new session). SSRF guard required — see the multi-server
      fallback note in FEATURES.md.
- [x] **7.16 PWA support.** Landed 2026-10-21 (offline shell + installability;
      queued messages deliberately out — see below): `public/manifest.webmanifest`
      (standalone display, SVG icons) + `public/icon.svg` / `icon-maskable.svg`;
      `public/sw.js` precaches the app shell cache-first with background
      refresh, serves navigations network-first with the cached shell as the
      offline fallback, and **never caches `/api/*` or non-GETs** — offline chat
      shows the app's existing error banner rather than a stale replay.
      Registration in app.js is fail-open and secure-context-only.
      Pinned by `test/pwa.test.js` (manifest shape, index.html link,
      sw.js cache rules, fail-open registration).
      **Offline send queue (the "queued messages" half) landed 2026-10-21:**
      a send that fails at the network level (`TypeError`, no response) is
      parked in localStorage via pure helpers in chat-helpers.js
      (`enqueueOfflineSend`/`shiftOfflineSend`/`offlineQueueCount`, storage
      injected — 20-entry FIFO, text-only, attachments/images excluded) and
      the UI says the message is queued. Flush triggers: the browser
      `online` event and a successful `/api/health` poll — deliberately not
      every send completion, which against a still-down server would be a
      hot retry loop. Regenerate/edit is never queued (bypassCache).
      Covered by four tests in `test/chat-helpers.test.js` (roundtrip,
      validation, cap — the cap drops the OLDEST overflow, keeping the
      newest — and corrupt-storage recovery).
- [x] **7.17 Keyboard-only navigation + ARIA audit.** Partial pass landed
      2026-10-21. Already in place before this pass (verified, not assumed):
      modals carry `role="dialog"`/`aria-modal`, settings + command palette
      handle Escape and manage focus, every icon-only composer/top-bar button
      has `title` + `aria-label`, the export menu is a real `role="menu"`,
      visually-hidden labels back the model select and composer. This pass
      added: a shared Escape handler for the stats / metrics / model-health /
      compare overlays (the only dialogs without one), and keyboard
      reachability for sidebar chat items — they were `div onclick`, i.e.
      invisible to keyboard users; now `role="button"` + `tabindex` +
      Enter/Space activation + `aria-current` on the open chat +
      `:focus-visible` outline. **Completion landed 2026-10-21:** a shared
      focus trap (one Tab handler — while exactly one overlay is open, Tab
      cycles inside it and focus that escaped the dialog is pulled back to
      its first focusable), and Arrow-key roving in the chat list
      (Up/Down moves focus between chat items). Focus restoration on close
      (hideModal → opener) was also added for the four simple overlays in
      the same pass. Still open if a deeper pass is wanted: Arrow-key
      roving does not wrap at the list ends, and the palette's own list
      navigates separately.

### Data & safety
- [x] **7.18 Scheduled session cleanup.** Landed 2026-10-14: db.js
      `cleanupPreview`/`deleteSessionsOlderThan` (stale = updatedAt before
      an ISO cutoff the caller computes; per-user scoped); GET
      `/api/cleanup/preview?days=N` and POST `/api/cleanup` (days 1–3650,
      refuses without `{ confirm: true }`, audited as `session.cleanup`);
      Settings → Data gets preview list + delete UI with a confirm.
- [ ] **7.19 Encrypted-at-rest chat store.** Optional passphrase-based
      encryption of session data in `data/`. Migration path needed.
- [x] **7.20 Usage reports.** Landed 2026-10-14: on-demand GET
      `/api/usage-report` computed from the user's own session store
      (sessions/messages, user vs assistant counts, estimated tokens via
      the chars/4 heuristic, last-7-days slice, per-model breakdown, top 5
      largest chats); Settings → Data renders it ("Generate usage report").
      No email — the report is in-app only, so nothing ever leaves the
      machine.

### Still-open round-1 halves (from FEATURES.md "out of scope" table)
- [ ] **7.21 Wire `marketing/game.js` and the Unity port to `/api/game-npc`.**
- [ ] **7.22 Offline-first sync for the mobile clients** (Flutter/RN).

---

## Execution order

```
0.1 gitignore → 0.3 commit (needs owner sign-off) → 0.4 verify clone → 1.1 CI
                                                                      ↘ 2.x security batch
   then, in parallel:   Decision A (python_app: maintained or demo?)  → 3.1
                        Decision B (which mobile client survives?)     → 3.2
                        4.1 RAG wiring (highest feature value)
   last:                5.x structural, one commit per item
```

Phases 0–2 need no product decision and can start immediately. Phases 3.1/3.2
are gated on Decisions A and B.

## Open decisions (owner input needed)

| # | Decision | Recommendation | Blocks |
| --- | --- | --- | --- |
| A | Is `python_app` maintained or a demonstration? | Decide; if maintained, add tests | 3.1 |
| B | Do both `mobile/` and `mobile-rn/` survive? | Pick one to invest in | 3.2 |
| 1 | Migration UX: auto-import vs confirm prompt | **Done — confirm prompt shipped** | — |
| 2 | Password reset: emailed tokens vs local/CLI | Local/CLI | Phase 2 |
| 3 | Presets: global named vs per-chat snapshots | Global named | 5.5 |
| 4 | Edit/regenerate: linear vs true branching | Linear | 4.2 |
| 5 | DOCX extraction in scope? | No — PDF only | 4.8 |

## Reusable assets (don't rebuild these)

| Asset | Path | Reuse for |
| --- | --- | --- |
| Fake-Ollama HTTP harness | `test/server-streaming.test.js:44-116` | any new proxy/streaming test |
| Temp-DB env isolation | `AUTH_DB_FILE` / `SESSIONS_DATA_FILE` (`auth.js:20`, `db.js:25`) | all new server tests |
| Fake Qdrant injection | `qdrant.js:21` (`_setClientForTests`) | 2.7 flap test |
| `isValidMessage` predicate | `server.js:509` | 2.5 chat validation |
| `rateLimiter` factory | `server.js:163` | 2.3 — fix eviction in one place |
| `node:sqlite` usage pattern | `auth.js:12-43` | 5.2 `db.js` migration |
| ESLint per-env block structure | `eslint.config.js:31-55` (node + browser blocks) | any new lint environment |
| Atomic write (tmp + rename) | `db.js:53-58` | any future persistence change |
| Section-comment boundaries | `public/app.js` (`// ----------`) | 4.5 extraction, 5.1 split |
| Dependency-injected side effects | `compaction.js` `summarize` param | keeping new modules testable |

## Done (kept for history)

- [x] **Health table re-verified 2026-09-21** (`npm test` 70/70, `npm run lint`
      clean, `npm audit` both scopes, `git ls-files`, `git check-ignore -v`).
      Corrected three stale claims in the process: `scratchpad/` was *not*
      git-ignored, the artifact ignores live in untracked nested `.gitignore`
      files, and the dev-dependency advisory count is 13 high (not 11).
- [x] **Planning docs consolidated** into this backlog; `PLAN-improvements.md`
      superseded, `PLAN.md` phase-B status recorded (2026-09-14).
- [x] `npm run lint` green — `.pixis/`, `marketing/`, `mobile-rn/`, `unity/`,
      `scratchpad/` now ignored in `eslint.config.js` (2026-09-09).
- [x] Sessions are the source of truth; one-time localStorage→account import
      banner with explicit confirm (`PLAN.md` Phase B — **landed**).
- [x] Automated backend suite: auth, db, compaction, qdrant (fake client),
      embeddings (fetch-mocked), server integration, server-streaming, game —
      **70/70 green** as of 2026-09-14.
- [x] Rate limits on expensive routes (`/api/pull`, model delete,
      `/api/memory/index`) with 429-path tests.
- [x] Local accounts (scrypt, `node:sqlite`), HttpOnly session cookies,
      per-user scoping of both sessions and semantic memory, session pruning
      (lazy + 6-hourly).
- [x] `compactMessages()` bounded by `COMPACTION_TIMEOUT_MS`, fail-open.
- [x] `qdrant.js` rechecks/recreates a deleted collection and retries once;
      dimension/model mismatch fails with an explicit error naming both sizes.
- [x] `/api/show` validates `req.body.model`; `/api/pull` name length capped and
      control-char rejected.
- [x] Abort-on-disconnect fixed — `req.on('close')` → `res.on('close')`
      (commit `df636e6`); the old code aborted every request immediately.
- [x] ChatGPT-style design system in `public/style.css`, mirrored by
      `mobile-rn/src/theme/design.ts`.
- [x] **Phase 0 + Phase 2 landed 2026-10-03** (owner-approved): working tree
      committed in four chunks (404 files) with fresh-clone verification;
      `.gitignore` hardened; host guard + `HOST_ALLOWLIST`;
      `parseCookies` try/catch; rate-limiter sweep; `/api/chat` message-shape
      validation; `undici ^7.29.1` override → `npm audit --omit=dev` clean.
      Suite at 84/84 (9 suites), including the new
      `test/server-host-guard.test.js`.
- [x] **4.2 Regenerate/edit, 4.3 Markdown/JSON export, 5.4 compaction
      surfacing** — landed prior to the 2026-10-03 reconciliation; previously
      listed as open in error.
- [x] README documents every satellite project (mobile, mobile-rn, python_app,
      marketing, unity) with a repository-layout table — the old "not mentioned
      in README" item is obsolete.
- [x] **Unity: turf economics** (landed 2026-10-20). Each gang cluster's corner
      is now a `TurfEnt` (`LTA.Core.cs`); `Systems.TurfStep` pays a lump for
      clearing a turf's whole crew (drops one SMG crate on the corner) and a
      recurring drip for standing inside a cleared turf, both on the sim clock.
      `SpawnWorld` tracks each turf's crew; the dropped crate reuses the
      existing `SyncWeapons` visual pool. Verified headless in
      `Assets/Editor/TurfSimTest.cs` (27 checks; caught and fixed a `LastDrip`
      sentinel that made a fresh clear fire an immediate drip).
