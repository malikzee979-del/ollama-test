# Project TODO — Ollama Chat

The **single living backlog** for this repo. Health re-verified **2026-09-21**
against a live run of `npm test`, `npm run lint`, `npm audit`, `git ls-files`
and `git check-ignore -v`. The satellite read-through behind Phase 3 is still
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

## Health today (verified 2026-09-21)

| Check | Result |
| --- | --- |
| `npm test` | **Green** — 70/70 (`node --test`, 8 suites, ~2.5s) |
| `npm run lint` | **Green** — exit 0, 0 problems (fixed 2026-09-09 in `eslint.config.js`) |
| `npm audit --omit=dev` | **3 moderate** — `qs@6.15.3` under `express@4.22.2 → body-parser@1.20.6`. Now **two** advisories, not one: array-limit bypass (GHSA-x5fp-wj9c-mxmx) + `isBuffer` DoS (GHSA-4mjr-xmp4-gh2g). See 2.1 |
| `npm audit` (incl. dev) | **17 total — 1 critical, 13 high, 3 moderate.** Critical is `tar <=7.5.20`; the dev-side set is all in the `electron-builder 25.1.8` tree. See 2.6 |
| CI | **None** — no `.github/`; tests and lint run only when someone remembers |
| Git | **Only 14 files tracked, and 10 of those have uncommitted modifications.** The committed tree does not run — tracked `server.js` requires the untracked `./auth`. **This is the single biggest risk in the project.** See Phase 0 |
| `.gitignore` | **Weaker than previously documented.** Root file is 10 lines; `scratchpad/` (1.3G) is *not* ignored, and the ignores covering `.pixis/`, `unity/LocalTheftAuto/Library` and `mobile/build` live in **nested, untracked** `.gitignore` files that a fresh clone would not have. See 0.1 |
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

- [ ] **0.1 Harden the root `.gitignore`.** Verified 2026-09-21 with
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
        files in 0.3.
- [ ] **0.2 Decide the home of the loose root binaries.** `gameplay.webm`
      (4.7MB) and `busy_cyberworld_0.mp3` (460KB) most likely belong under
      `marketing/` as game assets — move them there, or ignore them.
      `PROJECT-overview.pdf` is generated output — ignore or delete.
      All three confirmed still untracked and un-ignored as of 2026-09-21.
- [ ] **0.3 Commit the working tree** in logical chunks: core app + tests;
      electron; mobile clients; marketing; unity; python_app; docs.
      Note that 10 of the 14 tracked files also **differ from HEAD**
      (`.gitignore`, `README.md`, `db.js`, `package.json`,
      `package-lock.json`, `public/app.js`, `public/index.html`,
      `public/style.css`, `qdrant.js`, `server.js`), so even the committed
      part of the tree is stale — this is a "commit everything", not just a
      "add the missing files".
      **Requires explicit owner sign-off — `AGENTS.md` forbids autonomous
      commits.** This is a recommendation, not an autonomous action.
- [ ] **0.4 Verify the clone.** `git clone` into a temp dir, then
      `npm ci && npm test` there. This is the only real proof Phase 0 worked.

Effort: **S**. The only true blocker in this plan.

## Phase 1 — CI (now unblocked; do immediately after Phase 0)

- [ ] **1.1 Add `.github/workflows/ci.yml`.** Node 22 (matches
      `engines >=22.5.0` and the `node:sqlite` requirement), then `npm ci`,
      `npm test`, `npm run lint`. The suite is hermetic by design — temp
      `AUTH_DB_FILE`/`SESSIONS_DATA_FILE`, fake Ollama, fake Qdrant client —
      so no external services are needed.
- [ ] **1.2 Add an audit gate, but only after 2.1 lands.**
      `npm audit --omit=dev --audit-level=high` would fail today on the `qs`
      advisory, so sequence it second or CI is red on day one.
- [ ] **Verify:** push a branch, watch the workflow pass.

Effort: **XS**. Converts a manual habit into an enforced invariant.

## Phase 2 — Security & hardening batch

All small, all testable against existing harnesses (`test/server.test.js`
signup-then-cookie pattern; `test/server-streaming.test.js` fake Ollama).

- [ ] **2.1 Close the production `qs` advisory without leaving Express 4.**
      Add `"overrides": { "qs": "^6.16.0" }` to `package.json`, then
      `npm install` to refresh the lockfile. Installed tree confirmed
      2026-09-21: `express@4.22.2 → body-parser@1.20.6 → qs@6.15.3` (plus a
      direct `qs@6.15.3` under express). **Two** advisories apply to that
      range now — GHSA-x5fp-wj9c-mxmx (array-limit bypass via bracket-key
      comma parsing) and GHSA-4mjr-xmp4-gh2g (`isBuffer` DoS).
      **Re-check the "cannot reach it" claim before acting:** `npm audit`
      now reports `fix available via npm audit fix` for the `--omit=dev` set,
      where the 2026-09-06 dry-run said it could not be fixed. Either way the
      override is the safe route — it pins the floor explicitly instead of
      depending on npm's resolver.
      **Deliberately stay on Express 4:** Express 5 removed array path routes,
      and `server.js:231` uses `app.get(['/', '/index.html'], ...)`. Revisit at
      4.x EOL.
- [ ] **2.2 Fix `parseCookies` (`server.js:110`).** Unguarded
      `decodeURIComponent` throws `URIError` on malformed cookies (`sid=%`).
      That middleware runs on *every* request, so a crafted cookie is a remote
      500. Reproduced 2026-09-06. Wrap the decode in try/catch, skip malformed
      values, **add a regression test**.
- [ ] **2.3 Evict stale IPs from the rate-limiter `hits` Map
      (`server.js:163`).** It filters timestamps but never deletes IP keys, so
      it grows unbounded. One-line fix inside `rateLimiter`, which is already
      shared by all four limiters.
- [ ] **2.4 Add a Host-header guard.** Any browser on the LAN — or a malicious
      web page via DNS rebinding — can hit cookie-authenticated endpoints.
      Reject unless `Host` is loopback (`localhost`, `127.0.0.1`, `[::1]`) or
      listed in a new `HOST_ALLOWLIST` env (comma-separated). ~15 lines, one
      403 path, mirrors the existing hand-rolled middleware style — no new
      dependency. **Document `HOST_ALLOWLIST` in the README Security-posture
      section in the same change**, since the default will surprise anyone
      serving the app on a LAN IP.
- [ ] **2.5 Validate `/api/chat` message shape.** `messages` is only checked to
      be an array; reuse the `isValidMessage` predicate already at
      `server.js:509` for clean 400s instead of opaque upstream errors.
- [ ] **2.6 Upgrade `electron-builder` 25 → 26.** Clears the **critical** `tar`
      hardlink path traversal plus **13 high** advisories in its tree (count
      re-measured 2026-09-21; `npm audit fix --force` names
      `electron-builder@26.15.3` as the resolution and flags it breaking).
      Dev-only tooling (`npm run dist`), so **do not let it block 2.1**. If the
      build config breaks, pin 25 and accept the dev-only risk. Also routine
      in-semver bumps: `electron 43.4.0 → ^43.6.0`, `eslint → ^10.10.0`,
      `globals → ^17.12.0`.
- [ ] **2.7 Close the "Qdrant reconnection loop" item as already-solved.**
      `ensureCollection()` re-runs on every upsert/search while
      `collectionReady` is false (`qdrant.js:28`, reset again at `:76`), so a
      Qdrant that starts
      *after* the server is picked up automatically on the next request. Add one
      test asserting 503-then-success across a fake-client flap (reuse
      `_setClientForTests`), then drop the item. **No new code path needed.**
- [ ] Per-username lockout after repeated failed logins (only per-IP today).
      Low priority for local-first.
- [ ] Password reset / "forgot password" — see `PLAN.md` Phase E.
      **Recommended shape: local/CLI reset** (`node auth.js --reset-password
      <username>`), matching this project's local-first, dependency-averse
      posture, rather than an emailed-token flow needing SMTP.

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

- [ ] **3.1.1 Observability is dead code.** `api.py` defines
      `logging_metrics_middleware` but `main.py` only registers
      `AuthMiddleware`. Consequence: `/api/metrics` always returns an empty
      snapshot and no `X-Request-Id` is ever emitted. **One-line fix** — do this
      regardless of Decision A.
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

- [ ] **4.1 Wire semantic memory into `/api/chat` (RAG).** *The highest-value
      feature work in the repo.* `/api/memory/index` and `/api/memory/search`
      are built and tested but **completely inert — nothing calls them**.
      Shape: an opt-in `useMemory` flag on the request → embed the latest user
      message → Qdrant search scoped to `req.user.id` → inject top-k as a system
      message, placed so `compaction.js`'s marker-scan still works. Auto-index
      each completed user/assistant turn via a shared helper factored out of the
      `/api/memory/index` path. **Fail open** in its own try/catch with a
      timeout like `COMPACTION_TIMEOUT_MS` — a Qdrant outage must never break
      normal chat. (`PLAN.md` C4)
- [ ] **4.2 Regenerate / edit a message.** Truncate `chat.messages` and re-call
      the existing `streamAssistantReply`; persist via `PATCH .../:id` with a
      full `messages` replace. **Linear history only** — true branching is a
      `db.js` schema change and explicitly out of scope. Check the interaction
      with attachments (regenerate must resend the same bytes). (`PLAN.md` C1)
- [ ] **4.3 Export chat as Markdown / JSON.** Frontend-only, least coupled of
      the Phase 4 items, so it can jump the queue. Blob + `<a download>`, no new
      dependency; Markdown reuses the existing `[Attached file: ...]` fenced
      format. (`PLAN.md` C2)
- [ ] **4.4 Chat search.** `db.js`: `searchSessions(userId, query)` as a linear
      case-insensitive substring scan (fine at documented scale — no index, no
      library). `server.js`: `GET /api/sessions/search?q=...`, per-user scoped
      like the other session routes. Frontend: sidebar search input.
      (`PLAN.md` C3)
- [ ] **4.5 Frontend testability.** `public/app.js` (1,201 lines) has **zero
      coverage**. Don't add vitest/jsdom — that breaks the no-build,
      minimal-deps philosophy. Extract the pure DOM-free helpers into a small
      plain script with a CommonJS export guard
      (`if (typeof module !== 'undefined') module.exports = {...}`), loadable by
      both `<script>` and `node --test`: message shaping incl. attachment
      folding, `ATTACHMENT_EXTENSIONS` + the 200KB/3-file caps, compaction-marker
      display, and settings load/defaults/merge. This is also the natural first
      cut of 5.1.
- [ ] **4.6 Small server-side coverage adds.** `GET /api/metrics` shape and
      counters are currently untested — no test file mentions the route. Same
      for `logger.js`'s format.
- [ ] **4.7 Image / vision input.** Parallel attachment path: allowlist
      `.png .jpg .jpeg .webp .gif`, base64 into Ollama's `images: [...]`,
      thumbnail chip, image-specific size cap. Verify `images` passes through
      `compactMessages()` unmodified — note the chars heuristic won't count
      base64 weight. Reuse `db.js`'s existing `attachments` passthrough with a
      `type: 'image'` discriminator. (`PLAN.md` D3)
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
- [ ] **5.3 Export/backup tooling** for `data/auth.db` and
      `data/sessions.json` — e.g. download sessions as JSON from Settings.
      Months of history can currently only be rescued by copying raw files.
      Pairs with 5.2.
- [ ] **5.4 UX safety & surfacing.** Confirm dialog for destructive/expensive
      actions (any logged-in user can `DELETE /api/models/:name` today —
      documented, but the dialog is cheap); surface the attachment limits
      in-app (plain-text-only, 200KB / 3 files — currently README-only);
      `X-Compacted: true` response header when `compactMessages()` actually
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
- [x] README documents every satellite project (mobile, mobile-rn, python_app,
      marketing, unity) with a repository-layout table — the old "not mentioned
      in README" item is obsolete.
