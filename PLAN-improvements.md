# PLAN-improvements — Ollama Chat health & quality plan

> ## ⚠️ Superseded 2026-09-14 — do not work from this file
>
> This plan's live content has been folded into **`TODO.md`**, which is now the
> single living backlog for the repo. Work from there.
>
> Kept for two things `TODO.md` does not reproduce: the **verification history**
> below (what was measured on 2026-09-06 — the lint breakdown by source file,
> the `npm audit` dependency chains, the `npm audit fix --dry-run` result) and
> the **trade-off reasoning** (the six "Trade-offs considered" entries explaining
> *why* each decision went the way it did).
>
> Status of this document's own phases as of 2026-09-14:
> - **Phase 1.1 (make lint green) — DONE** 2026-09-09. `eslint.config.js` now
>   ignores `.pixis/**`, `mobile-rn/**`, `marketing/**`, `unity/**`,
>   `scratchpad/**`; `npm run lint` exits 0. The 3,046-error table below and the
>   per-file fix list in 1.1 are historical. Note this went further than 1.1
>   proposed — `marketing/**` ended up ignored rather than linted, so trade-off
>   #2 was resolved the other way.
> - **Phase 2.4 (Qdrant reconnection) — resolved by design**, as this doc
>   already argued; the flap test is still owed. Now `TODO.md` 2.7.
> - **Phase 3.3 (refresh TODO.md) — DONE**; the stale items it lists are
>   corrected there.
> - **Phase 4.6 (satellite hygiene) — expanded.** The read-through that
>   produced `TODO.md` Phase 3 found four real defects in `python_app` and
>   design drift in `mobile/`, well beyond "has no tests". See `TODO.md` 3.1–3.5.
> - Everything else carries over to `TODO.md` phases 0, 2, 4, 5.
>
> Test count has also moved: **70/70**, not the 68/68 recorded below. The
> `npm audit` figures have *not* been re-run since 2026-09-06 — re-run them
> before acting on 2.1/2.2.

Written 2026-09-06 after a full read-through of the current tree and verified
runs of `npm test` (68/68 green), `npm run lint` (3,046 errors — all outside
core code), `npm audit`, and `npm outdated`. Complements `PLAN.md` (feature
roadmap) and refreshes `TODO.md` (partially stale — see Phase 3.3).

## What this project is

Ollama Chat: a local-first web UI for chatting with models served by a local
Ollama. Core = a thin Express 4 proxy (`server.js`, 646 lines) + a
framework-free vanilla-JS frontend (`public/`), with SQLite-backed local
accounts (`auth.js`, via `node:sqlite`), a JSON-file per-user session store
(`db.js`), chat-context compaction (`compaction.js`), optional Qdrant-backed
semantic memory (`qdrant.js` + `embeddings.js`), and hand-rolled
observability (`logger.js`, `metrics.js`). Two runtime deps (`express`,
`@qdrant/js-client-rest`). Satellite projects in-repo: Electron desktop
shell (`electron/`), Flutter client (`mobile/`), Expo/React Native client
(`mobile-rn/`), full Python FastAPI/NiceGUI port (`python_app/`), marketing
site + "Local Theft Auto" canvas game (`marketing/`), and a Unity port of
that game (`unity/`).

## Verified health today (2026-09-06)

| Check | Result |
| --- | --- |
| `npm test` | **Green** — 68/68 (`node --test`, 8 suites incl. `game.test.js`) |
| `npm run lint` | **Red** — 3,046 errors / 21 warnings, **zero in core code**. Sources: `.pixis/scratch/**` (2,633 in vendored `bundle.js` alone), `marketing/{main,chat,game}.js` (browser globals: 181 `no-undef` + 15 real), `mobile-rn/e2e/flow.mjs` (19 `no-undef`) |
| `npm audit --omit=dev` | 3 moderate: `express 4.22.2 → body-parser 1.20.6 → qs 6.15.3` (qs DoS GHSA-4mjr-xmp4-gh2g + array-limit bypass). Fixed in qs 6.16.0, but express pins `qs ~6.15.1`, so `npm audit fix` **cannot** reach it (verified via `--dry-run`) |
| `npm audit` (incl. dev) | +11 high, +1 critical — all in the `electron-builder 25.1.8` tree (critical: `tar` hardlink path traversal; high: `electron-updater` credential leak, `node-gyp`, etc.). Fix = `electron-builder 26.15.3` (semver-major) |
| CI | **None** — no `.github/`; tests/lint run only when someone remembers |
| Git | **Only 14 files tracked.** Untracked: `auth.js` (required by tracked `server.js` at runtime — a fresh clone cannot start), all of `test/`, `electron/`, `mobile/`, `mobile-rn/`, `marketing/`, `python_app/`, `eslint.config.js`, `public/auth.js`, login/signup pages, fonts, TODO/PLAN/AGENTS docs. ~4GB of build artifacts (`unity/Library` 1.7G, `scratchpad` 1.3G, `mobile/build` 1.1G) are *not* git-ignored and would be swept in by a careless `git add .` |
| Code-level | `parseCookies` (`server.js:110`) throws `URIError` on malformed cookies (`sid=%`) — reproduced; every request runs this middleware, so a crafted cookie yields a 500. Rate-limiter `hits` Map (`server.js:163`) never evicts stale IPs. No RAG wiring in `/api/chat` (memory endpoints built but inert) |

## Priority summary (impact vs. effort)

| # | Improvement | Impact | Effort | Phase |
| --- | --- | --- | --- | --- |
| 1 | Git safety net: harden `.gitignore`, commit the working tree | Critical (everything is one disk failure away) | S | 0 |
| 2 | Lint green: ignores/config blocks in `eslint.config.js` + ~15 tiny fixes | High (restores signal on core code) | S | 1 |
| 3 | CI: minimal GitHub Actions (Node 22, test + lint) | High (enforces 2 forever) | S | 1 |
| 4 | Fix prod advisory: npm `overrides` for `qs ^6.16.0` | Medium-High (security, cheap) | XS | 2 |
| 5 | `electron-builder` 25→26 (+ patch bumps) — clears critical dev-dep vulns | Medium (dev-only tooling) | S-M | 2 |
| 6 | Server hardening batch: cookie parse, limiter eviction, Host-header guard | Medium | S | 2 |
| 7 | Frontend testability: extract pure helpers from `public/app.js` + tests | Medium (only uncovered product code) | M | 3 |
| 8 | Refresh stale `TODO.md`; small doc fixes | Low-Medium | XS | 3 |
| 9 | Structural: `app.js` module split, `db.js` ceiling, export/backup, UX confirms | Varies | M-L each | 4 (deferred) |

---

## Phase 0 — Repo safety net (do first; highest impact)

**Why:** only 14 files are committed; the entire auth module, test suite,
five satellite projects, and both auth pages exist only in the working tree.
`server.js` (tracked) does `require('./auth')` (line 5) — the committed
state of the repo does not run. Meanwhile ~4GB of build artifacts are one
`git add .` away from being committed.

**0.1 Harden `.gitignore`** (file: `.gitignore`)
Add: `.idea/`, `.vscode/`, `.opencode/`, `.pixis/`, `dist/`,
`unity/LocalTheftAuto/Library/`, `unity/LocalTheftAuto/Logs/`,
`unity/LocalTheftAuto/Builds/`, `unity/LocalTheftAuto/UserSettings/`.
(`scratchpad/`, `mobile/build`, `node_modules/`, `data/` are already
covered.) Decide the home of the three loose root binaries:
`gameplay.webm` (4.7MB) and `busy_cyberworld_0.mp3` (460KB) most likely
belong under `marketing/` (game assets — move them there), or ignore them;
`PROJECT-overview.pdf` is generated output — ignore or delete.

**0.2 Commit the working tree** — in logical chunks (core app + tests;
electron; mobile clients; marketing; python_app; docs).
*Constraint:* `AGENTS.md` says never commit unless explicitly asked, so this
is a recommendation requiring owner sign-off, not an autonomous action.
*Verify:* `git clone` the repo into a temp dir, `npm ci && npm test` there.

## Phase 1 — Restore quality signal (lint + CI)

**1.1 Make `npm run lint` green** (file: `eslint.config.js`)
Verified error sources dictate the fix:
- Add to top-level `ignores`: `.pixis/**` (scratch + 150k-line vendored
  `bundle.js` — never lint this) and `mobile-rn/**` (separate Expo/TS
  project with its own toolchain, same treatment as `mobile/**`/`python_app/**`).
- Add a browser-env block for `marketing/*.js` (`sourceType: 'script'`,
  `globals: globals.browser`) — this alone clears 181 of 196 errors there
  (all `no-undef` browser globals). `marketing/game.js` is exercised by
  `test/game.test.js`, so it *should* stay linted rather than ignored.
- Fix the ~15 remaining real findings: `no-unused-vars` in `marketing/game.js`
  (9), `main.js` (1), `chat.js` (2); `no-useless-assignment` in `game.js` (6).
  All are mechanical; none change game behavior (re-run `test/game.test.js`).
*Reuse:* the existing two-block structure in `eslint.config.js` (node vs
browser `languageOptions`) — the marketing block copies the `public/**/*.js`
block verbatim.
*Verify:* `npm run lint` exits 0; `npm test` still green.

**1.2 Add CI** (new file: `.github/workflows/ci.yml`)
Minimal GitHub Actions: Node 22 (matches `engines >=22.5.0` and the
`node:sqlite` requirement), `npm ci`, `npm test`, `npm run lint`. Tests are
hermetic by design (temp `AUTH_DB_FILE`/`SESSIONS_DATA_FILE`, fake Ollama,
fake Qdrant client — no external services needed). Optionally add
`npm audit --omit=dev --audit-level=high` as a gate *after* Phase 2.1 lands
(it would fail today on the qs advisory).
*Verify:* push a branch, watch the workflow pass.

## Phase 2 — Dependencies & security

**2.1 Close the production advisory without leaving Express 4**
(file: `package.json`)
- Add `"overrides": { "qs": "^6.16.0" }` (npm 11 supports this natively),
  then `npm install` to refresh the lockfile. This is needed because
  `express 4.22.2` pins `qs ~6.15.1` / `body-parser ~1.20.5`, and no newer
  Express 4.x exists — `npm audit fix` provably cannot fix it (verified:
  dry-run only bumps `@xmldom/xmldom`).
- **Deliberately stay on Express 4.** Express 5.2.1 removed array path
  routes, and `server.js:231` uses `app.get(['/', '/index.html'], ...)`.
  Express 4.22.2 is the maintained latest-4.x; revisit only when 4.x is EOL.
*Verify:* `npm audit --omit=dev` reports 0 vulnerabilities; `npm test` green
(the server integration suites exercise body parsing and routing).

**2.2 Dev-dependency bumps** (files: `package.json`, `package-lock.json`)
- `electron-builder ^25.1.8 → ^26.15.3` (semver-major) — clears the
  **critical** `tar` hardlink-path-traversal and 10 more high advisories in
  its tree. Dev-only (used by `npm run dist`), but critical-severity
  supply-chain exposure in a tool that builds installers deserves fixing.
- Routine in-semver bumps: `electron 43.4.0 → ^43.6.0`, `eslint → ^10.10.0`,
  `globals → ^17.12.0`. Electron 44 (major) can wait.
*Verify:* `npm audit` clean or near-clean; `npm run dist` produces an
installer (config schema is stable across 25→26, but the build is the real
test); `npm run electron` smoke test.
*Fallback:* if electron-builder 26 breaks the build config, pin 25 and
accept the dev-only risk — do not block Phase 2.1 on it.

**2.3 Server hardening batch** (file: `server.js` — all small, all tested)
1. **Cookie parsing crash** — `parseCookies` (line 110) calls
   `decodeURIComponent` unguarded; `sid=%` throws `URIError` (reproduced),
   turning any request with a crafted cookie into a 500. Wrap the decode in
   try/catch and skip malformed values.
2. **Rate-limiter memory** — the `hits` Map (line 163) never deletes stale
   IPs. Delete the key when its filtered timestamp list is empty (one-line
   change inside `rateLimiter`).
3. **DNS-rebinding / Host-header guard** *(recommended)* — the README warns
   the app must not face hostile networks, but any browser on the LAN (or a
   malicious web page via DNS rebinding) can hit cookie-authenticated
   endpoints. Add a small middleware early in `server.js` that rejects
   requests whose `Host` is not in an allowlist: `localhost`, `127.0.0.1`,
   `[::1]`, plus `HOST_ALLOWLIST` env (comma-separated) for LAN IPs.
   ~15 lines, one 403 path, mirrors the existing hand-rolled middleware
   style (no new dependency).
4. **`/api/chat` message-shape validation** *(optional)* — `messages` is
   only checked to be an array (line 309); add the same
   `role`/`content` string-shape check `PATCH /api/sessions/:id` already has
   (line 509) for clean 400s instead of opaque upstream errors.
*Reuse:* the `isValidMessage` predicate already defined at `server.js:509`;
the test patterns in `test/server.test.js` (temp DBs + ephemeral port).
*Verify:* new `node:test` cases in `test/server.test.js` (malformed cookie
returns 200/401-not-500; foreign Host returns 403); `npm test` green.

**2.4 Qdrant "reconnection" — verify and close, don't build**
TODO.md asks for a reconnect loop, but the code already recovers:
`ensureCollection()` runs on every upsert/search while `collectionReady` is
false (`qdrant.js:30-31`), so a Qdrant that starts after the server is
picked up on the next request automatically. Action: add one test asserting
503-then-success across a fake-client flap (reuse `_setClientForTests`),
then mark the TODO done. No new code path needed.

## Phase 3 — Testing gaps & docs

**3.1 Frontend testability without a framework**
(files: `public/app.js`, new `public/chat-helpers.js`, new
`test/frontend-helpers.test.js`)
`public/app.js` (1,195 lines) has zero coverage. Don't add vitest/jsdom —
that breaks the no-build, minimal-deps philosophy. Instead extract the pure,
DOM-free helpers into a small plain script with a CommonJS export guard
(`if (typeof module !== 'undefined') module.exports = {...}`), loadable by
both `<script>` and `node --test`:
- `buildOllamaMessages(chat, systemPrompt)` incl. attachment folding
  (`app.js:889-905` — the `[Attached file: …]` fenced-block format),
- attachment validation rules (`ATTACHMENT_EXTENSIONS`, 200KB/3-file caps,
  `app.js:40-45`),
- settings load/defaults/merge (`app.js:150-185` area).
This is the first incremental step of PLAN.md's D5 split and de-risks it.
*Verify:* new `node:test` suite green; app still works from `npm start`
(helpers loaded via `<script>` before `app.js` in `index.html`).

**3.2 Small server-side coverage adds** (file: `test/server.test.js` or new
`test/observability.test.js`)
- `GET /api/metrics` shape + counters (currently untested — no test file
  even mentions it); `logger.js` format.
- The 2.3 hardening regressions (cookie, Host header).
*Reuse:* the existing signup-then-use-session-cookie harness in
`test/server.test.js:28-40`.

**3.3 Refresh `TODO.md`** — several entries are stale (verified):
- "60/60 passing" → 68/68; "2,778 problems" → 3,046 (and the file list
  changed: `.pixis/scratch/mkt-orig/*` and more shroud scripts now appear).
- "`mobile-rn/`, `marketing/`, `python_app/` not mentioned in README" —
  **done**: the current README documents all of them (sections exist);
  same for the Flutter-section concern.
- Qdrant reconnect item → resolved-by-design (see 2.4).
- Add: qs override, Host-header guard, `parseCookies` fix once landed.

## Phase 4 — Structural debt (deliberately deferred)

Each is real but not urgent; order only matters within the group:

- **4.1 Split `public/app.js` into ES modules** (PLAN.md D5, "always last").
  The file already has 16 labeled section boundaries (`State`, `Rendering`,
  `Models`, `Sending messages`, …) mapping to the proposed
  `state/render/models/attachments/chat-stream/settings-modal/main` modules.
  Do only after Phases 1-3 settle, one module per commit.
- **4.2 `db.js` storage ceiling.** Whole-file rewrite per mutation is fine
  today (`data/sessions.json` = 47KB). Trigger to act: file > ~5MB or
  visibly slow PATCHes. Migration path: `node:sqlite`, reusing the exact
  patterns of `auth.js` (env-overridable DB path, prepared statements,
  temp-file tests) — no new dependency, keeps the native-build-free stance.
- **4.3 Chat-history export/backup.** `GET /api/sessions/export` returning
  the caller's sessions as a JSON download + a Settings button. Cheap
  insurance for months of local history (TODO item; pairs with 4.2).
- **4.4 UX safety & surfacing.** Confirm dialog on model delete (any
  logged-in user can `DELETE /api/models/:name` today — documented, but the
  dialog is cheap); surface attachment limits in-app; `X-Compacted` header +
  compaction note (PLAN.md D1).
- **4.5 RAG wiring into `/api/chat`** — the top feature item in TODO.md and
  PLAN.md C4. Feature work, not health work: keep it in PLAN.md's phase C
  order (after the canonical-store work it depends on is stable).
- **4.6 Satellite hygiene (optional):** `python_app/` has no tests (add
  pytest smoke tests if the port stays first-class); decide the
  Flutter-vs-React-Native duplication (TODO item — a product decision, not
  a code one).

## Existing code & patterns to reuse

| Asset | Path | Reuse it for |
| --- | --- | --- |
| Fake-Ollama HTTP harness | `test/server-streaming.test.js:36-95` | any new proxy/streaming test |
| Temp-DB env isolation (`AUTH_DB_FILE`, `SESSIONS_DATA_FILE`) | `test/server.test.js:22-24`, `auth.js:20`, `db.js:25` | all new server tests |
| Fake Qdrant injection | `qdrant.js:21` (`_setClientForTests`) | 2.4 flap test |
| `isValidMessage` predicate | `server.js:509` | 2.3.4 chat validation |
| `rateLimiter` factory | `server.js:163` | already shared; fix eviction in one place |
| `node:sqlite` usage pattern | `auth.js:12-43` | future `db.js` migration (4.2) |
| ESLint per-env block structure | `eslint.config.js:25-51` | marketing browser block (1.1) |
| Atomic write (tmp + rename) | `db.js:53-58` | any future persistence change |
| Section-comment boundaries | `public/app.js` (`// ----------`) | module split (4.1), helper extraction (3.1) |

## Trade-offs considered

1. **Express 4 + `overrides` vs. Express 5.** Express 5 fixes qs natively
   but breaks `app.get([...])` (server.js:231) and changes `req.body`
   semantics; Express 4.22.2 is still the maintained tip of 4.x. The
   override gets the security fix in ~3 lines with zero behavior risk.
   Winner: **stay on 4, override qs**; revisit at 4.x EOL.
2. **Ignore `marketing/**` vs. lint it.** `test/game.test.js` actively
   regression-tests `marketing/game.js`, so ignoring it would drop signal on
   tested code. Winner: **browser-env block + ~15 mechanical fixes**; ignore
   only `.pixis/**` (vendored/scratch) and `mobile-rn/**` (own toolchain).
3. **Frontend tests: framework vs. extraction.** vitest+jsdom would cover
   the DOM but adds a build-step-shaped dependency to a deliberately
   build-free project. Winner: **extract pure helpers with a CommonJS
   guard** — testable under `node --test`, zero deps, and it's the natural
   first cut of the D5 module split.
4. **`db.js` → SQLite now vs. later.** The write-amplification ceiling is
   documented and not yet felt (47KB store); migrating now buys nothing and
   risks the one store holding user history. Winner: **later, with an
   explicit trigger** (size/latency), reusing `auth.js` patterns.
5. **CI audit gate.** Gating on `npm audit` today would be red for a
   moderate, locally-scoped qs DoS and dev-only electron-builder issues.
   Winner: **land the fixes first (2.1/2.2), then gate** at
   `--omit=dev --audit-level=high`.
6. **Host-header guard vs. staying zero-config.** A guard could break a
   user reaching the app via a LAN hostname. Winner: **guard with an env
   escape hatch** (`HOST_ALLOWLIST`), defaulting to loopback only — matches
   the documented "trusted machine" posture.

## Risks & genuinely ambiguous items

- **Committing the working tree (0.2) needs explicit owner approval**
  (`AGENTS.md` forbids unrequested commits). Until it happens, every other
  improvement sits on uncommitted ground — this is the plan's only
  blocking dependency.
- **electron-builder 25→26** is a major bump; if `npm run dist` breaks on
  config schema, fall back to pinning 25 (dev-only exposure) rather than
  blocking the security batch.
- **qs 6.16 compatibility** with body-parser 1.20.6 is expected to be
  drop-in (same major), but the override forces a version body-parser never
  tested against — the existing server test suite (which exercises JSON body
  parsing on every route) is the verification net.
- **Host allowlist defaults** may surprise users serving the app on a LAN
  IP; document `HOST_ALLOWLIST` in the README Security-posture section in
  the same change.

## Verification checklist (narrowest useful per phase)

| Phase | Command / check |
| --- | --- |
| 0 | Fresh `git clone` → `npm ci && npm test` passes |
| 1 | `npm run lint` exits 0; `npm test` 68+ green; CI workflow green on a branch |
| 2 | `npm audit --omit=dev` → 0 vulns; `npm test` green; `npm run dist` builds; new hardening tests pass |
| 3 | `npm test` includes frontend-helper + metrics/logger suites, all green; TODO.md statuses match reality |
| 4 | Per-item: module split keeps `npm test` + manual chat flow green after each commit |
