# "LTA: DISPATCH" — the structural evolution of the Local Theft Auto marketing site

**Iteration 2.** `marketing/REDESIGN_PLAN.md` documents iteration 1 ("HOLOGRID OS"), which is
fully implemented and is the **baseline** for this plan — this document does not repeat it.
V1 was a *surface* pass: iridescence, glass, projection, atmosphere. V2 is a *structure* pass:
the site stops being a stack of identical glass-card sections and starts reading as the city's
own **dispatch console** — documents instead of cards, a persistent rail that turns each page
into a journey, and one signature entrance motion used deliberately instead of fifteen ambient
loops fighting for attention.

---

## 0. Baseline audit — what is verified present (do NOT re-implement)

Everything below was confirmed in the actual code (not the V1 doc's claims). Line numbers refer
to `marketing/marketing.css` (2,355 lines) and `marketing/main.js` (687 lines) as of this writing.

**Tokens & atmosphere (CSS):**
- HOLOGRID tokens `--holo-mag/--holo-grad/--holo-soft/--fringe/--glass-hi/--scanlines/--dur-slow/--ease-holo` — css 120–132.
- Gradient-mesh drift `body::before` (css ~145–171) + CRT refresh band `body::after` (css 174–195).
- `.noise` overlay with scanlines layer (css ~222–234).
- 3-stop `.grad` gradient text + `holo-pan` drift on `.display .grad` (css 243–266).

**Signature effects (CSS):**
- Radar ring plane behind `.hero`/`.page-hero` titles (css 559–579); hero parallax vars `--hpx/--hpy` (css 580–590).
- Seam packets: `.hero::after` right→left, `.closing::after` left→right (css 630–680).
- Projector cone + emitter pool `.hero-stage::after` with `holo-flicker` (css 771–795).
- HUD brackets `bracket-breathe`, `frame-pulse` on `.demo-card`/`.game-frame` (css 821–855).
- Chips float (css ~880–905); marquee tri-color diamonds (css 914–957).
- Fact band readout bars + `fact-pop` (css 958–1006).
- Fringe + hover sheen on `.b-cell`/`.app-card`/`.tease-band` (css 1013–1050, 1162–1205, 1717–1750).
- Loopback halos + `offset-path` runner (css 1107–1161); timeline `node-ping` (css 1229–1283).
- `.qa[open]` fringe + hairline glow (css 1318–1322); resting glow on `h1.display/.closing-h` (css 1345–1347).
- Chat launcher iridescent conic ring `::before` (css 1435–1462); chat head fringe; `status-breathe` (css 1512–1530).
- `.cta-big` `cta-breathe` (css 1916–1925); wanted `star-flicker` in hero banners only (css 1928–1945).
- Mock-city scanlines + `scan-sweep` band (css 2019–2045).
- "HUD layer II" block (css 2047–2290): `#bgfx` styles, sliding `.nav-indicator`, `.cursor-dot` ring+dot near-state, `.nav-progress`, `is-past-hero` densification, cursor spotlight `.spot-on::before`, 3-stop conic sweep borders (idle on the two hero frames, hover-only on panels), `.holo-tilt`, hover glitch keyframes.

**Behaviors (main.js):**
- Nav menu/Esc/outside-click (25–44); `.nav-progress` created at runtime + `onScroll` rAF driving `is-scrolled`/`is-past-hero`/progress scaleX (47–78).
- Reveal IntersectionObserver — one uniform `translateY(18px)` fade (79–94); count-ups + `.is-done` pop (95–132); loopback draw-on (133–158); copy buttons with fallback (159–191); hero card pointer tilt (192–220).
- `#bgfx` canvas: starfield + data motes + perspective grid with scroll-coupled row phase + signal pulse rings, dpr cap 1.5, hidden-tab pause, `reduced` gate (221–407).
- Delegated cursor spotlight + `.holo-tilt` tagging with 6°/5° angles (408–460); sliding nav indicator (461–504); hero parallax feed (505–534); custom cursor dot (535–574).
- **Dead code:** the "hero typing loop" (main.js 575–686) targets `#demoCard`/`.demo-turn`, which exist in **no** HTML file (verified by grep). It is inert.

**Hard hooks, verified, must never break:**
- `game.js` lines 24/27/28/422/443: `#gameCanvas`, `#gameOverlay` (+ `.is-hidden`), `#gameStart`, `.touch-btn[data-key]`, `#gameStats`.
- `chat.js` lines 18–29: `.chat-widget` (+ `.is-open`), `#chatLauncher`, `#chatPanel`, `#chatClose`, `#chatStatus[data-state]`, `#chatSub`, `#chatModel`, `#chatLog`, `#chatForm`, `#chatInput`, `#chatSend`, `#chatStop`.
- All 11 pages share a byte-near-identical shell: `<canvas id="bgfx">`, `.cursor-dot`, `.nav-indicator`, `.skip`, `.noise`, `#nav`, chat widget, then `main.js` + `chat.js` (+ `game.js` on game.html only).

**Layout inventory (what each page actually is today):**
| Page | Body between hero and closing |
|---|---|
| index | marquee → facts band → 7-cell bento → tease-band → 3 app-cards + ghost-link |
| about | 7-cell bento → privacy-grid + loopback → `.path` 4 steps |
| world | **9-cell bento** → 4-cell bento (shops) → privacy-grid + legend-list |
| missions | 6-cell bento (4×span-3 + span-4 + span-2) → privacy-grid + app-card |
| wanted | 7-cell bento → 3-cell bento (span-4) → tease-band |
| combat | 6-cell bento (all span-3) → tease-band |
| progression | facts band → proof-list (achievements) → privacy-grid + app-card |
| controls | `.game-keys` list → 3-cell bento (span-4) → tease-band + app-card |
| driving | 7-cell bento → privacy-grid + app-card |
| faq | 9× `details.qa` |
| game | game-frame → 6-cell bento (uniform span-2) |

---

## 1. Diagnosis — where the current execution reads generic

1. **Layout monotony is the dominant weakness.** Ten inner pages with the identical skeleton:
   same `.page-hero` (radar + grid floor + eyebrow/h1/lede) → 1–3 `.section` blocks of `.bento`
   glass cards → optional `.tease-band` → identical centered `.closing`. Every block sits in the
   same 1200px `.wrap` with the same padding. wanted.html runs two bento sections back-to-back;
   game.html is a uniform 6×span-2 grid. The core rhythm rule — *never repeat the same section
   skeleton consecutively* — is violated on every page.
2. **Cookie-cutter card grids.** ~45 `.b-cell` panels site-wide, all with the identical surface
   recipe (fringe + sheen + conic hover sweep + spotlight + tilt + lift). Span widths vary
   (2/3/4) but every surface shouts at the same volume — no hierarchy inside any grid. World's
   9 span-3 cells leave an orphaned half-row (grid-discipline failure).
3. **Weak type hierarchy.** One formula repeats ~20 times: mono eyebrow-with-tick + display h2
   with `.grad` span, all h2s at the same `clamp(1.9rem, 4.4vw, 3.2rem)`, all card titles at
   1.14rem. No oversized anchor moments, no numbering, no spec-sheet voice, no editorial scale
   contrast. Mono is confined to kickers and labels.
4. **Flat mid-page seams.** Only hero/closing get seam hairlines + packets. Body sections meet
   at unmodified edges separated only by padding (or the same `--bg-band` stripe on
   facts/setup). Nothing straddles a boundary; there is no chapter structure.
5. **Motion budget is spent on ambience, not storytelling.** ~16 infinite loops run per page
   (mesh, band, radar, floor, bgfx, rings, brackets, chips, marquee, ticks, brand, node pings,
   star flicker, cta breathe, launcher ring, grad pan), yet the *only* reveal is one uniform
   translateY fade and nothing is scroll-driven except the bgfx row phase. Nothing reads as
   "the signature moment"; V1's effects are each tasteful and collectively undifferentiated.
6. **Identical page heroes.** All ten inner heroes share one composition; only wanted.html adds
   anything page-specific (the star meter).

**Conclusion:** the next-gen move is not another treatment of the panels — it is re-organizing
what the sections *are*, giving each page a chaptered structure, and concentrating motion into
one deliberate scroll idea.

---

## 2. Direction: "LTA: DISPATCH"

One-sentence concept: **the site reads as the city's dispatch console — content arrives as
documents (ledgers, spec sheets, job boards, an escalation ladder), a persistent dispatch rail
threads every page top to bottom, and sections materialize with a one-shot scan-decode instead
of fading up.**

Seam metaphor (per the section-seams discipline, Law 2): **"the dispatch trace"** — the cyan
signal thread already present in the site (seam packets, nav indicator, radar, grid floor)
becomes a literal continuous line down each page, with numbered stations at section seams and a
terminal brand mark at the closing. Every new seam element must survive the test *"is this
still the dispatch trace?"*

### 2.1 The four signature moves

**S1 — The dispatch rail (the Continuum Pattern; the one hero idea).**
A 1px vertical cyan hairline fixed in the left margin (desktop ≥1100px only), running the full
content height, with:
- a brighter **fill segment** whose `scaleY` tracks scroll progress through `<main>` (the page's
  own readout — distinct from the nav's tiny progress bar, which stays);
- one **station node per body section** (a 7px rotated square, the site's diamond motif),
  positioned at each section's top seam; the station for the section currently at/above
  viewport center becomes `.is-now` and emits a one-shot ping (reuse the `node-ping` visual);
- a **terminal node** (11px rotated square, solid cyan — the `brand-dot` motif) at the closing
  seam: the thread visibly ends, the page never "just stops".
Implementation: shipped markup is one aria-hidden div in each shell; main.js builds stations at
runtime exactly the way it already builds `.nav-progress` (precedent: main.js 47–54) and
positions them with `getBoundingClientRect` exactly the way `.nav-indicator` is positioned
(precedent: main.js 461–504). Without JS the rail renders as a static full-height hairline —
static completeness preserved.

**S2 — Scan-decode entrance (the one reveal upgrade, used on chapter heads only).**
Section headings stop fading up: `.sec-head h2` switches from `.reveal` to `.reveal-scan` —
hidden state is `clip-path: inset(-5% 0 104% 0)` plus a 2px cyan scan bar (the h2's own
`::after`) parked at the clip edge; `.in-view` runs `decode-in` once (0.7s, `--ease-holo`):
the clip retracts downward while the scan bar rides the edge and fades. Same vocabulary as the
mock-city `scan-sweep` (css 2019–2045) — the site's surfaces are "scanned into" the dispatch
feed. Body cards/lists keep the existing translate reveal; ledger rows get their own one-shot
hairline draw (S3). Reduced motion: explicit rule leaves the clip fully open (finished state,
never blank).

**S3 — Document layouts replace card grids (layout-recipes discipline).**
New shared components, all vanilla CSS, all hairline-based, none boxed:
- `.ledger` — full-width rows, each a grid: mono index (CSS counter `01`… — generated numbers,
  not copy) | content block | trailing meta chip. Row height ≥88px, hairline top per row, hover
  steps the row background one tone (`rgba(56,240,255,0.03)`), and on `.in-view` the hairline
  draws left→right once (`::before` scaleX, stagger via `:nth-child` transition-delays).
- `.job-board` (missions) — ledger variant whose index column is the mission-type stamp
  (existing `.app-tag` mono: delivery/circuit/steal/ram/escort) in a bordered chip; the
  leftover "One shared slot" cell becomes a full-width `.job-note` strip under the rows —
  the remainder is designed, never orphaned.
- `.ladder` (wanted) — escalation rows with a stepped `padding-left` on desktop
  (`calc(var(--step) * 22px)`, `--step` 0–3 via nth-child) so heat literally climbs down the
  page; rows 3–4 (roadblocks/helicopter — named as such in the existing copy) get the danger
  hairline accent (`--danger-glow` at 25%) while all text stays unchanged. Mobile: steps
  collapse to 0.
- `.split-sticky` (about features) — left column carries the sec-head, `position: sticky;
  top: 120px`; right column is the seven items as stacked text blocks with hairline tops. No
  boxes at all.
- `.bento.is-joined` (world shops, controls knobs, wanted evasion) — one bordered container;
  cells lose individual borders/backgrounds and are separated by interior hairlines only
  (grid discipline: hairline separators, not boxes).
- `.key-sheet` (controls) — the existing `.game-keys` `<ul>` becomes a two-column spec table:
  keys column (existing `.key` chips, unchanged) | action column, hairline rows. Scoped to a
  new `.key-sheet` class added to that `<ul>` so the **game overlay's** `.game-keys` (game.html)
  keeps its exact current styling.
- `.spec-legend` (world tile legend) — `.legend-list` restyled to 3-column rows: swatch |
  tile name (mono) | description; same `<ul>`, CSS only.

**S4 — Panel hierarchy re-budget (concentrate the holo treatment, retire perpetual panel motion).**
Today every `.b-cell/.app-card/.tease-band` carries fringe + sheen + backdrop-filter + conic
hover sweep + spotlight + tilt. V2 splits them:
- `.is-hero` panels — at most **one per grid** (two for index's features bento): keep the full
  V1 treatment unchanged.
- default/`.is-quiet` panels — lose the fringe layer, lose `backdrop-filter` (biggest perf win:
  ~10 blurred elements removed from index alone), border drops to `--line`, keep spotlight +
  lift + a quiet hover border-color step. Conic sweep stays on `.is-hero` only.
- `.holo-tilt` is retired from quiet panels (CSS gate: `.holo-tilt:not(.is-hero)` gets plain
  translate) — main.js keeps tagging unchanged, so the JS delta for this is zero.
- One deliberate ambient subtraction to make the signature read: `holo-pan` gradient drift is
  re-scoped from all `.display .grad` to `.hero .grad, .closing .grad` only (css 256–259).
  Everything else (radar, packets, projector, bgfx, brackets, marquee, node-ping, star-flicker,
  cta-breathe, launcher ring) stays — those are the atmosphere; the panels stop competing with it.

### 2.2 Chapter headers — the type-hierarchy move

Every body `.sec-head` gains an oversized **ghost chapter numeral**: a `.ch-num` span shipped in
HTML (`aria-hidden="true"`, decorative structure — like page numbers, not content), display
face, `clamp(4.5rem, 9vw, 8.5rem)`, transparent fill with `-webkit-text-stroke: 1px
rgba(56,240,255,0.14)` (solid `rgba(56,240,255,0.05)` fallback where stroke is unsupported),
absolutely positioned right-aligned behind the h2, `pointer-events:none`. Numbers match each
page's real section order (01, 02, 03…). The eyebrow copy stays byte-identical; the tick stays.
Result: each section reads as a chapter, the display face gets a true oversized moment, and the
eyebrow+h2 formula no longer carries the whole hierarchy alone.

### 2.3 Chrome refinements (deliberately minor — the nav is already strong)

- Nav: unchanged structure (it is the floating-pill recipe, already behavior-complete). Only
  touch: on JS pages `.nav-menu a.is-active` gets quiet bracket markers (`[ WORLD ]`) —
  dispatch-console voice, rendered via pseudo-elements guarded by `html.js` and dropped below
  1080px where the dropdown uses weight/color. DOM text untouched.
- Footer "Quick start" column: the three key lines adopt `.key`-chip styling for consistency
  with the game overlay (CSS only; same text). Footer otherwise stays quiet by design — it is
  where the rail terminates, which is its new signature role.
- FAQ: `details.qa` get a CSS-counter index (`summary::before`, `decimal-leading-zero`, mono,
  faint) so the console reads as numbered entries. Numbering, not new content.
- Chat widget, game frame, overlay, touch pads: **zero changes** beyond what they inherit.

### 2.4 What explicitly does NOT change

All copy; all anchors; nav structure; marquee content; fact values; wanted-star semantics;
tile-legend hex values (game art); amber package color; font files; favicon; theme-color;
`game.js` and every hook in §0; `chat.js` and every hook in §0; the V1 atmosphere layer
(mesh, band, noise, radar, bgfx, projector, packets, brackets, sweeps on hero frames); the
reveal/count-up/loopback/copy/tilt/indicator/cursor systems' plumbing.

---

## 3. Constraint handling (hard requirements from the brief)

| Constraint | How V2 honors it |
|---|---|
| All copy/content identical | HTML edits are **structural rewraps only**: same words, possibly in different elements/classes. No text added, removed, or reworded. The only "new text" is (a) `aria-hidden` chapter numerals and (b) CSS counters — decorative structure, nothing fabricated (no testimonials/stats/facts). |
| Zero new dependencies / no build step / no WebGL | Vanilla CSS + edits to existing `main.js`. No new files served, no `<script>`/`<link>` additions, no libraries. |
| `game.js` untouched, hooks intact | game.js is not edited; game.html's `#gameCanvas/#gameOverlay/#gameStart/#gameStats/.touch-btn` markup and classes unchanged; the `.key-sheet` restyle is scoped to a class that exists only on controls.html's list. Verification includes a full play test (§6). |
| `chat.js` untouched, hooks intact | chat.js not edited; chat widget markup unchanged on all pages; only inherited token/panel effects apply as today. |
| `prefers-reduced-motion` disables all new animation | Every new effect gets an entry in the extended block at css 2291–2355 (§4.4); the rail renders statically complete; scan-decode rests fully open; hairlines rest drawn; main.js gates station pings/fill updates on the existing `reduced` flag (main.js 22). |
| Mobile/responsive keeps working (390px & 1440px) | Rail hidden <1100px; ladder steps collapse <900px; ledger rows stack <700px (same breakpoints as existing grids); sticky-split degrades to stacked columns <900px (mirrors the existing `.privacy-grid` MQ); all new components use the existing spacing scale. Screenshots at both widths, §6. |
| No emoji as UI icons | No glyphs added anywhere. Pre-existing geometric characters (▶ ▲ ◀ ▼ ⊘ ★) stay untouched in existing markup only (nav CTA, touch pads, wanted stars, game overlay). |
| Focus indicators + keyboard operability (WCAG 2.2 AA floor) | No new interactive elements. Rail and ghost numerals are `aria-hidden`. `.reveal-scan` only changes hidden-state geometry of elements already revealed by the existing system; keyboard focus order untouched; `:focus-visible` rule (css 205–209) unchanged. `details/summary`, links, buttons keep semantics through every rewrap. |
| No commits/pushes; no config changes | Implementation must not run git commit/push and must not touch eslint config (marketing/** being outside lint scope is pre-existing; new JS follows main.js's ES5-ish IIFE style: `var`, function expressions, no arrows). |

**Decision to flag (not a deviation):** V1 targeted zero HTML edits; V2 necessarily edits HTML,
because restructuring layouts is the point. The guardrail that replaces "zero edits" is:
*text content byte-identical before/after* — verified mechanically in §6.

---

## 4. File-by-file implementation plan

### 4.1 `marketing/marketing.css` — token + existing-rule edits

1. **Tokens (append inside `:root`, css 120–132 block):**
   ```css
   --hair: rgba(148, 163, 208, 0.10);      /* ledger/row hairlines, quieter than --line */
   --ch-stroke: rgba(56, 240, 255, 0.14);  /* ghost chapter numeral stroke */
   --rail-x: clamp(10px, 2.2vw, 30px);     /* dispatch rail left offset */
   --dur-scan: 700ms;
   ```
2. **Re-scope grad drift (css 256–259):** change selector `.display .grad` →
   `.hero .display .grad, .closing .grad` (ambient subtraction, §2.1-S4).
3. **Panel hierarchy on `.b-cell` (css 1013–1050):** move the fringe/sheen `background-image`
   stack, `backdrop-filter`, and `--glass-hi` shadow into a new `.b-cell.is-hero` modifier;
   base `.b-cell` becomes: `background-color: var(--panel)` only, `border: 1px solid var(--line)`,
   no backdrop-filter, hover keeps lift + `border-color: var(--line-cyan)` (no sheen pan).
   Same split applied to `.app-card` (css 1162–1205) and `.tease-band` (css 1717–1750) — tease
   bands default to the full treatment site-wide (one per page; each is its band's set-piece).
   Mirror in the panel-sweep selector list (css 2223–2256): hover conic only on `.is-hero`
   variants; and in `.holo-tilt` (css 2257–2266): add
   `.holo-tilt:not(.is-hero) { transform: translateY(var(--lift, 0px)); }`.
4. **Heading reveal variant:** add `.reveal-scan` next to the `.reveal` rules (css 323–332):
   ```css
   html.js .reveal-scan:not(.in-view) { opacity: 0; clip-path: inset(-5% 0 104% 0); }
   .reveal-scan { transition: clip-path var(--dur-scan) var(--ease-holo), opacity 0.3s var(--ease); position: relative; }
   html.js .reveal-scan::after { /* 2px cyan scan bar riding the clip edge; fades at rest */ }
   ```
5. **Nav active brackets (css ~418–425, `.nav-menu a.is-active`):** guard with `html.js` and
   `min-width: 1081px`; render via `::before`/`::after` (`content: "[ "` / `" ]"`, cyan at
   0.7 opacity). The existing no-JS underline lives under `html:not(.js)` and the mobile MQ
   already zeroes `::after` — confirm the bracket rule is excluded below 1080px.
6. **Footer quick-start keycaps (css 1392–1398, `.footer-cmd`):** add a `.footer-key` modifier
   class (HTML edit) styled like `.key` (css 1806–1813) but quiet (no glow).

### 4.2 `marketing/marketing.css` — new "HUD layer III — DISPATCH" block

Append after the HUD layer II glitch block (~css 2290, before the reduced-motion block), in the
same accretion style as layer II:

1. **Rail:** `.rail { position: fixed; left: var(--rail-x); top: 0; bottom: 0; width: 1px;
   z-index: 40; pointer-events: none; }` + `.rail-line` (full height, `--line-cyan` at 40%) +
   `.rail-fill` (cyan gradient, `transform-origin: top`, `transform: scaleY(var(--rail-f, 0))`,
   no transition — driven per-frame), `.rail-station` (7px rotated square, `--line-cyan-strong`
   border, dark fill), `.rail-station.is-now` (cyan fill + one-shot `station-ping` box-shadow
   ring reusing `node-ping` values), `.rail-terminal` (11px solid cyan rotated square).
   Hide below 1100px via MQ.
2. **Chapter heads:** `.sec-head { position: relative; }`, `.ch-num { position: absolute;
   right: 0; top: -0.35em; font: 800 clamp(4.5rem, 9vw, 8.5rem)/1 var(--font-display);
   color: transparent; -webkit-text-stroke: 1px var(--ch-stroke); pointer-events: none;
   user-select: none; z-index: 0; }` with a solid-faint fallback via `@supports not
   (-webkit-text-stroke: 1px black)`. Keep `.sec-head h2 { position: relative; z-index: 1; }`.
3. **Ledger:** `.ledger { display: flex; flex-direction: column; }`, `.ledger-row { display:
   grid; grid-template-columns: 64px minmax(0,1fr) auto; gap: var(--s4) var(--s5);
   align-items: baseline; padding-block: var(--s5); position: relative; }` with `::before`
   hairline (`scaleX(0)→1` on `.in-view`, `transition-delay` staggered via `:nth-child`),
   `.ledger-num` mono faint via `counter(ledger, decimal-leading-zero)`, row hover background
   step, mobile MQ stacks columns.
4. **Job-board / ladder / split-sticky / joined bento / key-sheet / spec-legend** — per §2.1-S3
   specs. Ladder danger rows: `.ladder-row.is-alert { border-left-color: var(--danger-glow); }`
   (class added in HTML on exactly the roadblocks + helicopter rows — structure, not copy).
5. **FAQ counter:** `.faq-list { counter-reset: qa; } .qa summary::before { counter-increment:
   qa; content: counter(qa, decimal-leading-zero); ... mono, faint, flex-none; }` — adjust
   summary layout to `[index | question | plus]`.

### 4.3 `marketing/main.js` — behavior additions

All in the existing IIFE style; three touch points:

1. **Reveal selector (line 80):** `document.querySelectorAll(".reveal")` →
   `document.querySelectorAll(".reveal, .reveal-scan")`. No other change — same IO, same
   thresholds. The reduced/no-JS path (lines 81–83) already adds `in-view` to every match, so
   scan-decode heads land finished without JS.
2. **Rail fill inside the existing `onScroll` rAF (lines 62–78):** after the progress-fill
   line, compute the fraction of `<main>` scrolled (`(y - mainTop) / (mainH - vh)`, clamped)
   and set `railFill.style.transform = "scaleY(" + f.toFixed(4) + ")"`. One extra style write
   in an already-running rAF; `mainTop/mainH` cached alongside `measureHero` (lines 55–61) and
   refreshed on the same resize listener. Under `reduced`: set `scaleY(1)` once, skip updates.
3. **Rail stations block (insert after the nav-indicator section, ~line 505):** if
   `document.querySelector(".rail")` exists: create one `.rail-station` per
   `main > .section` that is not `.hero`/`.page-hero`/`.closing`, plus one `.rail-terminal`
   at the closing's top; position them absolutely inside `.rail` from
   `section.getBoundingClientRect().top + scrollY - railTop` (same pattern as
   `placeIndicator`, lines 470–478); recompute on resize/load/fonts.ready/scroll-tick (reuse
   the `indKick` rAF-guard pattern). On each scroll tick, mark the last station whose offset ≤
   `scrollY + vh*0.5` as `.is-now` (one-shot ping via CSS animation; stations stay lit once
   crossed until the next takes over). Gate animation on `!reduced`; reduced shows stations
   placed, fill full, no ping — CSS block handles the rest.
4. **Optional cleanup (step 0, §5):** delete the dead typing loop (lines 575–686). Verified
   inert: no HTML contains `#demoCard` or `.demo-turn`. Zero behavior change; shrinks main.js
   by ~110 lines. Update the file header comment (lines 1–16) accordingly.

### 4.4 Reduced-motion extension (css 2291–2355 block, append)

```css
/* DISPATCH layer — everything stands down */
.rail-fill { transform: scaleY(1); }                     /* thread shown complete */
.rail-station { animation: none !important; }
.reveal-scan { clip-path: none !important; opacity: 1 !important; }
html.js .reveal-scan::after { display: none; }
.ledger-row::before { transform: none !important; transition: none !important; } /* drawn */
```
Note: the ladder indent and ghost numerals are layout, not motion — they stay under reduced
motion; only animated entries need kill rules. Static completeness is preserved.

### 4.5 HTML edits — per page (all 11)

Shared shell edit (every page, identical):
- After `<span class="nav-indicator">`, add:
  `<div class="rail" aria-hidden="true"><i class="rail-line"></i><i class="rail-fill"></i></div>`.

Per page (rewrap-only; every word preserved; every id/`data-*`/ARIA preserved):

1. **index.html** — features bento: add `is-hero` to the first two `.b-cell` (open world,
   vehicles). "Three ways to play": rewrap the three `app-card` articles into a `.ledger`
   (row = existing svg icon + `app-tag` + `b-title` + `p` + `app-cmd` chip; svg `aria-hidden`
   preserved). Chapter numerals 01/02 on the two sec-heads. Marquee, facts, tease-band, hero,
   closing: untouched.
2. **about.html** — features bento → `.split-sticky`: left column = sec-head (+ chapter 01),
   right column = seven stacked items (b-title + p) with hairline tops. Loopback section, setup
   path, closing: untouched.
3. **world.html** — 9-cell systems bento → `.ledger` (rows 01–09; fixes today's orphaned
   half-row). Shops bento → `.bento.is-joined` 2×2 with interior hairlines (content untouched).
   Tile legend list gets class `spec-legend` (CSS-only restyle). Chapters 01–03.
4. **missions.html** — mission bento → `.job-board`: five job rows (each keeps its `app-tag`
   stamp, b-title, p), the span-2 "One shared slot" cell → full-width `.job-note` strip below
   the rows. Rewards section untouched. Chapters 01–02.
5. **wanted.html** — escalation bento → `.ladder` (7 rows; `is-alert` on the roadblocks +
   helicopter rows; steps on rows 1–4). Evasion bento → 3 quiet columns in a `.bento.is-joined`
   with mono indices. Page-hero star meter: CSS-only emphasis — bump `.page-hero
   .wanted-meter .star` font-size to 1.4rem and add a faint track line behind via
   `.page-hero .wanted-meter::before` (no markup change). Chapters 01–02.
6. **combat.html** — bento → `.ledger`. Tease-band untouched. Chapter 01.
7. **progression.html** — facts band untouched; achievements `proof-list` gets `.medal-list`
   class: `strong` names step up to the display face (1.05rem, uppercase) — CSS only, same
   markup; save-file section untouched. Chapters 01–02.
8. **controls.html** — the `.game-keys` ul gains class `key-sheet`; its inline `style`
   attributes stay; CSS renders it as the spec table. Difficulty bento (3×span-4) →
   `.bento.is-joined` row of three. Tease-band + app-card untouched. Chapters 01–03.
9. **driving.html** — 7-cell bento kept as grid but re-budgeted: first cell `is-hero`, rest
   quiet (spans already fill 3 rows — no rewrap; this page demonstrates hierarchy alone).
   Physics section untouched. Chapters 01–02.
10. **faq.html** — no markup change (counter is CSS). Verify summary spacing at 390px.
11. **game.html** — under-the-hood bento → `.ledger` compact variant (rows keep their `b-more`
    links — those are the page's cross-nav and must keep focus styles). **Game frame, overlay,
    touch pads, stats: zero edits.** Chapter numerals on the one sec-head only.

### 4.6 Rhythm check after conversion (section-seams discipline)

No page repeats a skeleton consecutively after these conversions:
- index: hero → marquee → counter-band → **grid (hierarchized)** → band → **ledger** → closing ✓
- about: hero → **sticky-split** → anchored-split + diagram → numbered-path → closing ✓
- world: hero → **ledger** → **joined grid** → spec split → closing ✓
- missions: hero → **job-board** → split + panel → closing ✓
- wanted: hero + meter → **ladder** → **joined trio** → band → closing ✓
- ground changes (`--bg-band`) remain at ≤2 per page (facts/setup only, as today) ✓
- each page's typographic climax is its h1; ghost numerals are texture, not competition ✓

---

## 5. Ordered shippable steps

Each step is independently shippable and leaves the site valid:

0. **(Optional but recommended)** Delete the dead typing loop (main.js 575–686) + fix file
   header comment. Zero behavior change.
1. **Tokens + panel re-budget** (css §4.1.1–4.1.3 + the holo-tilt gate): add `is-hero` to
   index's two lead cells so the page doesn't go flat; everything else quiets automatically.
   Ship. Backdrop-filter element count drops immediately (measure, §6).
2. **Scan-decode + chapter heads** (css §4.1.4, §4.2.2; main.js §4.3.1; HTML: add `.ch-num`
   spans + swap `.reveal`→`.reveal-scan` on sec-head h2s, all pages). Ship.
3. **Dispatch rail** (css §4.2.1, §4.4; main.js §4.3.2–4.3.3; HTML: rail div in all 11 shells).
   Ship — this is the visible signature landing.
4. **Document components** (css §4.2.3–4.2.5): ledger, job-board, ladder, split-sticky, joined
   grid, key-sheet, spec-legend, faq counter, nav brackets, footer keycaps — CSS lands inert
   until pages adopt it. Ship.
5. **Conversion pass A (identity pages):** missions (job-board), wanted (ladder), index
   (ledger trio + grid hierarchy). Ship.
6. **Conversion pass B:** world, controls, combat, about, driving, progression, game, faq.
   Ship per page if preferred — each is self-contained.
7. **Reduced-motion + focus/keyboard audit** (§4.4, §6 checks). Ship.
8. **Verification + polish pass** (§6 full run; tune ladder steps, ghost-numeral collisions,
   rail offsets at 1100–1280px widths).

---

## 6. Verification plan

**Serve:** `cd marketing && python3 -m http.server 8000` → http://localhost:8000 (any static
server works; no build).

**Copy integrity (the V2 guardrail):** before starting and after each conversion pass, capture
`document.body.innerText` for all 11 pages (DevTools console or a headless script) and diff —
must be byte-identical modulo whitespace introduced by rewraps. Also re-run:
`grep -o 'href="[^h#][^"]*"' marketing/*.html | sort -u` and confirm every target exists.

**Visual:** screenshots of all 11 pages at **1440×900** and **390×844**. Desktop checklist:
rail visible with correct station count per page (index: 4 stations + terminal), one lit
`.is-now` mid-page, terminal node at closing; scan-decode caught mid-sweep on first scroll;
ghost numerals not colliding with h2 at 1440; ledger hairlines drawn; ladder stepping; no
fringe/sheen on quiet cells; exactly one `is-hero` panel per converted grid. Mobile checklist:
rail hidden, nav dropdown opens/closes (Esc + outside tap), ledger rows stack, ladder flat,
hero stage stacks, chips contained, chat panel fits, game frame 3:4.

**Interaction regression:**
- Nav: indicator travels on hover/focus; active page shows brackets + weight; mobile menu works.
- Chat widget: launcher opens panel; status dot cycles checking→error cleanly with Ollama
  stopped (expected state, not regression); with Ollama running, model list + streaming work.
- Game (game.html): Start → drive with WASD/arrows; E enter/exit; SPACE handbrake; F punch;
  H horn; P pause (then 1/2/3 knobs); M mute; R restart; touch pads appear under coarse-pointer
  emulation and respond; `#gameStats` updates; overlay `.is-hidden` toggling intact; the new
  ledger below the frame never captures pointer events meant for the canvas.
- About: copy button copies `npm install && npm start`; loopback draws on scroll.
- FAQ: every details opens/closes, focus lands on summary, counter renders.

**Reduced motion:** DevTools → Rendering → Emulate `prefers-reduced-motion: reduce`. Assert:
`#bgfx` hidden; band/radar/cone/packets gone (V1 contract still holds); rail shows full fill +
static stations; scan-decode heads fully visible; ledger hairlines drawn; reveals landed;
ladder keeps its indent (layout, not motion). Identical to static-completeness with JS disabled
(test one page with JS off: rail hairline renders, everything readable).

**Performance sanity:** record 5s of scrolling on index.html — bgfx frame cost < ~3ms, no
dropped frames, no layout thrash from the rail (it writes one transform per rAF tick, same
pattern as the existing progress bar). Count blurred elements before/after:
`grep -c "backdrop-filter:" marketing/marketing.css` for rule count, plus a runtime
`getComputedStyle` sweep counting elements with an effective backdrop-filter — expect a net
decrease (quiet panels lose blur). Lighthouse best-practices spot check on index and game.
`npm run lint` output must be unchanged (marketing/** is outside eslint scope — pre-existing;
do not fix via config edits).

**No commits, no pushes** unless explicitly asked.

---

## 7. Risks & open questions

- **Rewrap regressions are the top risk** (this is the first iteration that edits page HTML).
  Mitigation: rewraps move existing nodes without deleting any; the innerText diff in §6 is the
  gate; do pass A before pass B so the riskiest patterns (ledger, ladder) are proven on three
  pages before the rest copy them.
- **Ghost numeral collisions** with long h2s at ~1100–1280px: numerals sit right-aligned at
  0.14-alpha stroke — if any page's h2 runs under it, drop that page's numeral (one span),
  never shrink the h2.
- **Rail at 1100–1240px** can approach the 1200px wrap: `--rail-x` clamp plus the 1100px hide
  MQ cover it; verify at exactly 1100/1200/1280 during step 8.
- **`clip-path` reveal on h2 containing `.grad` spans**: gradient text + clip is compositor-
  friendly in current Chromium/Safari/Firefox, but verify Safari renders the clipped gradient
  (webkit prefix already handled for background-clip; clip-path needs none). Fallback if broken:
  `.reveal-scan` degrades to the standard translate reveal (one selector change).
- **CSS counters on `summary::before`** may be announced by screen readers as ordinals — judged
  acceptable (list numbering), but if review objects, swap to `aria-hidden` spans shipped in
  HTML instead (pure presentation either way).
- **Perceived "loss" from quiet panels:** the holo treatment concentrates into one hero panel
  per grid + tease bands + the two hero frames, which still carry the full sweep. If any page
  reads emptied, promote one more cell to `is-hero` — the knob is one class.
- Dead typing loop removal (step 0) is optional; if kept, it stays inert — nothing in V2
  depends on it either way.

---

## Delivery note

This plan was produced for `marketing/REDESIGN_PLAN_V2.md` per the task brief. If the harness
blocked writing into `marketing/`, copy this file there verbatim — it is the complete V2 plan
and references REDESIGN_PLAN.md as the baseline without repeating it.
