# "HOLOGRID OS" — the next-gen holographic redesign of the Local Theft Auto marketing site

> Deliverable note: this document is the redesign plan. If the repo wants it checked in as
> `marketing/REDESIGN_PLAN.md`, the implementer copies this file there as step 0 (the only
> new file in `marketing/` is that copy — all code changes below are edits to existing files).

**Scope guardrails (from the brief, verified against the code):**

- All copy/content stays identical. Only the visual/motion layer changes.
- Zero new dependencies, no build step, no WebGL library. Vanilla CSS/JS only.
- `marketing/game.js` gameplay logic is untouched. Its DOM hooks (`#gameCanvas`, `#gameOverlay`
  + `.is-hidden`, `#gameStart`, `#gameStats`, `.touch-btn[data-key]` — game.js lines 24–28, 422,
  443, 448) keep working.
- `marketing/chat.js` untouched. Its hooks (`.chat-widget.is-open`, `#chatLauncher`,
  `#chatPanel`, `#chatStatus[data-state]`, etc.) keep working.
- `prefers-reduced-motion` must kill every new animation, and every new JS behavior gates on the
  existing `reduced` flag (main.js line 22).
- **Target: zero HTML edits.** All 11 pages share byte-near-identical shells and reference only
  `marketing.css` + `main.js` + `chat.js`, so the entire redesign rides CSS + one JS file and
  propagates to every page automatically. Both pseudo-element slots on cards are already taken
  (`::before` = cursor spotlight, `::after` = conic sweep) — the plan accounts for that.

---

## 1. Visual direction: "HOLOGRID OS"

The current skin is a *night-city HUD*: flat glass panels on a dark field with neon accents.
The evolution: the whole site reads as a **holographic operating system being projected** —
every surface is a floating hologram with specular edges, iridescent interference, a projector
light source beneath the hero, and an atmosphere with visible depth layers (motes, pulse rings,
a slow radar sweep behind page titles). Same vocabulary (cyan/violet, mono kickers, brackets),
pushed one technology generation forward: iridescence, refraction, projection, depth.

### 1.1 Token changes (marketing.css `:root`, lines ~72–140)

Changed:

| Token | Current | New | Why |
|---|---|---|---|
| `--bg-0` | `#05070d` | `#04060d` | near-black with slightly bluer cast, deeper contrast for glows |
| `--bg-1` | `#0a0e1a` | `#090d1c` | keeps band separation vs. new bg-0 |
| `--panel` | `rgba(13,18,32,0.55)` | `rgba(11,16,30,0.58)` | marginally denser glass so sheens read |
| `--cyan` | `#38f0ff` | keep | primary accent stays — it IS the brand |
| `--violet` | `#7c5cff` | keep | secondary stays |

Added (new custom properties):

```css
--holo-mag:   #ff5cd0;               /* third iridescent stop — used ONLY inside gradients,
                                        never as a semantic color; danger stays #ff3b5c */
--holo-grad:  linear-gradient(115deg, #5af6ff, #8f6bff 52%, #ff5cd0);
--holo-soft:  linear-gradient(115deg, rgba(90,246,255,.5), rgba(143,107,255,.5) 52%, rgba(255,92,208,.45));
--fringe:     repeating-linear-gradient(115deg,
                rgba(90,246,255,.045) 0 1px, transparent 1px 8px,
                rgba(255,92,208,.035) 8px 9px, transparent 9px 16px);
--glass-hi:   inset 0 1px 0 rgba(255,255,255,.08), inset 0 0 28px rgba(90,246,255,.05);
--scanlines:  repeating-linear-gradient(0deg, rgba(255,255,255,.016) 0 1px, transparent 1px 3px);
--dur-slow:   600ms;
--ease-holo:  cubic-bezier(0.22, 1, 0.36, 1);   /* long-tail settle for holo motion */
```

Stays exactly as-is: `--danger*`, `--amber` (game package color), `--green`, spacing scale,
radii, fonts (Bricolage Grotesque / IBM Plex Sans / Mono — already self-hosted, no new faces).

### 1.2 The nine signature effects (specific, with where they live)

1. **Iridescent conic borders everywhere the sweep already lives.** The existing `--hud-sweep`
   conic ring (marketing.css ~1760–1840) currently uses cyan→violet stops. Recolor both rules
   (`.demo-card::before/.game-frame::before` and `.b-cell::after/.app-card::after/
   .tease-band::after/.fact-band::after`) to a 3-stop iridescent arc including
   `rgba(255,92,208,.7)`. One-stop addition per rule — instantly "next-gen" at zero extra cost.

2. **Idle sweep on the two hero frames.** `.demo-card` (index hero) and `.game-frame`
   (game.html) get the sweep arc permanently visible at `opacity: .28`, spinning slowly
   (animation-duration 7s, `running`), brightening to `opacity: 1` on hover/focus-within
   (keep the existing 2.8s duration there). Cards keep hover-only activation (perf: never run
   20+ simultaneous conic animations). Reduced-motion: opacity 0 (already in the kill block).

3. **Holographic sheen on panels.** Since both pseudos of `.b-cell/.app-card/.tease-band` are
   taken, the sheen goes on the element itself: add `var(--fringe)` as a second
   `background-image` layer over the panel gradient (subtle interference fringe, always on),
   and on `:hover` transition `background-position` of a wide soft diagonal highlight painted as
   a third layer. Paint-only, small surfaces, no new elements, no pseudo conflict.

4. **Glass refraction.** Every glass panel (`.b-cell`, `.app-card`, `.tease-band`, `.loopback`,
   `.chat-panel`, `.nav-shell`) gains `--glass-hi` added into its `box-shadow` list, and
   `backdrop-filter` gets `saturate(1.3)` where not already present. No *new* blur surfaces —
   backdrop-filter is the site's most expensive effect; the count of blurred elements is frozen.

5. **The projector.** The hero demo card becomes an explicit hologram: new CSS on
   `.hero-stage::after` — an upward light cone (`clip-path: polygon(...)`, vertical
   cyan→transparent gradient, ~7% opacity) plus an elliptical "emitter pool" glow under the
   card, with a slow 4s opacity flicker (`holo-flicker`: .55↔.7, never below .5). The chips and
   rings already float above it; the tilt already sells the 3D. CSS-only, no markup.

6. **Atmosphere upgrade on the existing `#bgfx` canvas** (main.js bgfx section, lines ~233–330):
   - **Data motes:** ~24 slow-rising particles (normalized coords like the existing stars,
     small parallax by `z`, colors cyan/violet/25% magenta). Total particle budget stays < 100.
   - **Signal pulse rings:** every ~4s an ellipse ring spawns at the vanishing point and expands
     across the floor grid, fading out; max 2 alive. Two `stroke()` calls — negligible.
   - **Scroll-coupled drift:** `gPhase` (floor row movement) gets an additive term from
     `window.scrollY` (read inside the existing rAF via a cached value set by one passive scroll
     listener), so the grid flows as you scroll. The site suddenly feels physically connected.
   - Keep: dpr cap 1.5, `document.hidden` pause, no per-frame allocations, no start under
     `reduced`.

7. **Radar depth behind page heroes.** `.page-hero .hero-bg::before` — a giant faint
   `repeating-radial-gradient` ring set (3% cyan), centered low, rotating 80s linear via
   `transform: rotate()` (compositor-cheap), masked to fade at edges. Gives all 10 inner-page
   banners a holographic-radar depth plane behind the title. `.hero` gets the same layer.

8. **Scanline + refresh-band accents, sparingly.**
   - The existing `.noise` overlay (fixed, z-90) gains `var(--scanlines)` as a second
     background-image — global CRT texture at ~1.5% white, static.
   - New `body::after`: one CRT refresh band (20%-tall gradient stripe, opacity .04) travelling
     top→bottom every 9s. Fixed, pointer-events none, z-89. Hidden outright under reduced motion.

9. **Data packets on section seams.** The closing section's top hairline (`.closing::before`)
   gets a companion: `.closing::after` — a 40px gradient dash animated left→right along the seam
   via `offset-path: path("M0 0 H 100%")` inside an `@supports (offset-path: ...)` guard
   (exactly the pattern already used for `.lb-runner`, marketing.css ~960), 7s loop, opacity .5.
   The hero bottom seam gets the same packet mirrored. One packet per bookend seam — that's all.

### 1.3 Type & micro-detail upgrades

- `.grad` (gradient text): add `--holo-mag` as the third gradient stop, `background-size: 200%`,
  and a slow 7s alternate `holo-pan` background-position drift on `.display .grad` only.
  The `@supports (background-clip: text)` guard stays; solid-cyan fallback unchanged.
- `h1.display` / `.closing-h`: add a resting `text-shadow: 0 0 34px rgba(56,240,255,.18)` glow.
  Existing hover-glitch keyframes stay (they're already tasteful).
- `.eyebrow .tick`: slow 2.4s glow-pulse animation (`tick-pulse`).
- `.brand-dot`: slow rotate+glow pulse (6s) — the logo mark feels powered.
- `.fact-num`: keep count-up + `.is-done` pop; add a faint always-on underline "readout bar"
  under each fact via `.fact::after` (2px cyan→violet gradient, 30% width, centered).

### 1.4 What explicitly does NOT change

- All copy, all anchors, nav structure, footer content, chat widget behavior, game canvas and
  overlay, touch pads, wanted-star semantics (red-pink), tile-legend colors (game art),
  amber package color, font files, favicon, theme-color meta.
- The reveal system's thresholds/timing, count-up easing, loopback draw-on, copy buttons,
  nav indicator mechanics, marquee (ticker stays — only recolor diamonds to include magenta).

---

## 2. Technical approach

**Decision: extend `marketing.css` and `main.js` in place. No new CSS/JS files.**

Considered and rejected:
- *New `holo.css`/`fx.js` files:* requires editing `<head>`/`<script>` in all 11 HTML files,
  splits one design system across two token sources, and doubles the reduced-motion audit
  surface. The existing files already contain a layered system ("Night City HUD" base +
  "HUD layer II" additive block) built for exactly this kind of accretion.
- *WebGL/three.js/particles.js:* forbidden by the brief (no deps); the 2D canvas bgfx already
  proves 60fps is achievable with plain `arc()`/lines.
- *Per-page HTML decoration:* rejected in favor of pseudo-elements and background layers, keeping
  HTML edits at zero so regression risk on content/SEO/ARIA is zero.

**How the motion system extends current plumbing (main.js):**
- Every new canvas behavior slots into the existing `bgfx` IIFE section (same resize/seed/frame
  skeleton, same `document.hidden` pause, same `reduced` gate, same dpr cap).
- No new IntersectionObservers needed — reveal/count-up/loopback observers are untouched.
- The sheen/glare position reuses the already-fed `--spot-x/--spot-y` vars — zero new JS for it.
- The only new listener is one passive `scroll` handler caching `scrollY` for the bgfx phase.
- All DOM hooks keep their names; `chat.js`/`game.js` see no difference.

**Performance budget (enforced in review):**
- bgfx frame cost stays < ~3ms (≤ 100 particles, ≤ 4 strokes/frame for grid+rings).
- No new `backdrop-filter` surfaces; no animated `filter`/`width`/`height`; all new animations
  are `transform`/`opacity`/`background-position` on bounded surfaces.
- Conic sweeps idle only on 2 frames site-wide; hover-only everywhere else.
- The three `steps()` glitch animations stay hover-one-shot (no infinite text repaints).

**Reduced-motion contract:** every effect in §1 gets an entry in the final
`@media (prefers-reduced-motion: reduce)` block (marketing.css ~1975–2035): hide
`body::after` band, radar rings, seam packets, projector cone, idle sweep; freeze sheen pan,
gradient pan, tick/brand pulses; and main.js simply never starts the upgraded bgfx (existing
gate). Static completeness is preserved — the site already ships fully styled with zero JS.

**Lint note:** `eslint.config.js` does not include `marketing/**` (pre-existing: `npm run lint`
already reports marketing files as unconfigured). This plan adds no config changes (per project
convention: don't touch config files); new JS stays consistent with main.js's existing
ES5-ish IIFE style (var, function expressions) so no tooling surprises.

---

## 3. Component-by-component changes

| Component | Selectors (marketing.css) | Change |
|---|---|---|
| Nav bar | `#nav .nav-shell` (~280) | + `--glass-hi`, + `saturate(1.3)`; `is-past-hero` state gets iridescent 1px top edge via existing border-color swap to `--line-cyan-strong` + faint `--holo-soft` shadow |
| Brand mark | `.brand-dot` (~305) | slow rotate/pulse keyframe |
| Nav links | `.nav-menu a`, `.nav-indicator` | indicator gradient gains magenta stop; link hover color unchanged |
| Scroll progress | `.nav-progress i` (~1735) | gradient gains magenta stop |
| Primary CTA | `.nav-cta`, `.cta-big` (~330, ~1660) | overflow hidden + `::after`? **pseudo free here** → hover shine-sweep streak (translateX -130%→130%, .7s); `.cta-big` gets 3s breathing glow (`cta-breathe` on box-shadow) |
| Hero section | `.hero`, `.hero-bg`, `.grid-floor` (~420) | radar layer via `.hero .hero-bg::before`; grid-floor line color keeps cyan; projector cone on `.hero-stage::after` |
| Hero demo card | `.demo-card` (~560) | idle sweep (§1.2-2), brackets get 3s opacity breathe, mock-city keeps scanlines/sweep |
| Chips | `.chip` (~715) | + `--glass-hi`; keep float/translateZ |
| Marquee | `.marquee*` (~755) | diamonds alternate cyan/violet/magenta via `:nth-child(3n)`; text stays cyan |
| Fact band | `.facts`, `.fact`, `.fact-num` (~785) | readout underline bar; `.fact-num` text-shadow unchanged; numbers keep cyan |
| Cards/panels | `.b-cell`, `.app-card`, `.tease-band` (~825, ~990, ~1470) | fringe+sheen backgrounds (§1.2-3), `--glass-hi`, iridescent conic recolor, tilt angles up: `--ry` 5→6deg, `--rx` 4→5deg in main.js spotlight section |
| Proof list / honest | `.proof-mark`, `.honest` (~895) | mark gets tick-pulse glow; border-left violet unchanged |
| Loopback diagram | `.loopback` (~920) | + `--glass-hi`; runner/halo unchanged (already animated) |
| Setup timeline | `.path::before`, `.step .node` (~1040) | node pulse ring (`node-ping` box-shadow expand 2.6s, staggered by `:nth-child`) |
| FAQ rows | `.qa`, `.qa summary` (~1100) | open-state gets left hairline glow + faint fringe background on `[open]` |
| Page-hero banners | `.page-hero` (~1430) | radar layer (§1.2-7); h1 glow; seam packet below (§1.2-9) |
| Closing | `.closing` (~1085) | seam packet; `floor-up` grid keeps |
| Footer | `.site-footer` (~1130) | quiet on purpose — only `--glass-hi`-style hairline glow on the top border; no motion |
| Chat widget | `.chat-launcher`, `.chat-panel` (~1200) | launcher: always-on slow iridescent conic ring (`::before` is free) at .35 opacity; panel: `--glass-hi`, head gets fringe |
| Game frame | `.game-frame`, `.game-overlay`, `.key` (~1500) | idle sweep (§1.2-2); overlay backdrop keeps blur(6px); `.key` chips get `--glass-hi`. **Canvas/touch markup untouched.** |
| Wanted meter | `.wanted-meter` (~1690) | `.star.is-on` gets 1.8s flicker pulse only inside `.page-hero` (wanted.html) |
| Cursor dot | `.cursor-dot` (~1710) | becomes ring+dot: add 22px ring via box-shadow spread with stronger lag — tweak existing lerp constants (`cdS` near-state 2.4→2.6) in main.js; native cursor still shown |

---

## 4. Page-by-page task list

Because markup is shared, all pages inherit everything automatically. Per-page work is
**verify + page-specific tuning**:

1. **index.html** — hero: projector cone alignment under `#tiltCard`, chips don't clip cone;
   marquee recolor; fact band bars; mock-city HUD untouched. *Highest visual scrutiny page.*
2. **about.html** — loopback SVG keeps draw-on + runner; `.path` node pings; `.cmd` copy button
   still works; honest footnote styling.
3. **world.html** — legend dots keep exact game-art hex values; radar layer behind page-hero.
4. **missions.html** — contract-board `.app-card` (line ~106) sheen; bento sweep recolor.
5. **wanted.html** — standalone `.wanted-meter` in page-hero (line 55) star flicker; tease-band.
6. **combat.html** — tease-band + mono-inline chips; nothing unique otherwise.
7. **progression.html** — fact band (second usage site) + the four `app-cmd` key cards.
8. **controls.html** — `.game-keys`/`.key` used *outside* the game overlay (lines 65–74):
   confirm `.key` styling changes read well in plain section context; tease-band; app-card.
9. **driving.html** — privacy-grid/honest; bento.
10. **faq.html** — `details.qa` open/close affordance, spotlight on `.qa` (it's in the
    `spotHosts` list in main.js), seam packet on closing.
11. **game.html** — *functional gate:* `.game-frame` idle sweep + brackets must stay
    `pointer-events: none` (they are pseudo-elements — verify no input capture on canvas);
    overlay → start → drive (WASD), P pause, touch pads on coarse pointer; sweep never blocks
    `#gameStart` focus ring.

**HTML edits required: none.** (The only file addition anywhere is the optional copy of this plan
to `marketing/REDESIGN_PLAN.md`.)

**Implementation order:** (1) tokens → (2) atmosphere: mesh stops, noise scanlines,
`body::after` band, bgfx canvas upgrade → (3) panels: fringe/sheen/glass-hi/conic recolor →
(4) frames: idle sweep, projector, brackets breathe → (5) hero/radar/packets → (6) type &
micro (grad pan, tick/brand pulses, CTA shine) → (7) chat/footer polish → (8) extend
reduced-motion block → (9) per-page verification pass. Each step is independently shippable.

---

## 5. Verification plan

Serve statically (no build): `cd marketing && python3 -m http.server 8000` (or `npx serve`).

**Visual — screenshots of all 11 pages at both viewports** (1440×900 desktop, 390×844 phone):
index, about, world, missions, wanted, combat, progression, controls, driving, faq, game.
Check at desktop: idle sweep visible on hero frame, projector cone, sheen/fringe on cards,
radar layer behind page-hero title, seam packet. Check at mobile: nav dropdown still opens,
hero stage stacks, chips don't overflow, game-frame goes 3:4, chat panel fits.

**Interaction regression:**
- Nav: hover/focus indicator travels; mobile menu opens/closes (Esc, outside-click).
- Chat widget: launcher opens panel; with Ollama *not* running, error state renders cleanly
  (this is expected behavior, not a regression); with Ollama running, streaming works.
- Game: Start driving → car responds to WASD/arrows, E enters/exits, P pauses, R restarts;
  touch pads appear on a coarse-pointer emulation; `#gameStats` updates.
- About: copy button copies `npm install && npm start`; loopback draws on scroll.
- Links: `grep -o 'href="[^h#][^"]*"' marketing/*.html | sort -u` — every listed file exists.

**Reduced motion:** DevTools → Rendering → Emulate `prefers-reduced-motion: reduce`.
Assert: no canvas (#bgfx hidden), no band/radar/packet/cone, reveals land finished, gradients
static, everything readable — identical to the static-completeness contract in main.js's header.

**Performance:** DevTools Performance record, 5s scroll on index.html: bgfx frames < 3ms,
no dropped frames, no layout thrash; Lighthouse best-practices sanity on one page. Confirm
backdrop-filter element count unchanged (grep `backdrop-filter` before/after).

**Static checks:** `npm run lint` output unchanged vs. before the redesign (marketing is outside
lint scope — pre-existing state, do not "fix" via config edits). No commits/pushes unless asked.

---

## Risks & open questions

- **Panel pseudo-element saturation** is the main constraint; the background-layer sheen is the
  workaround. If the fringe reads as dirt on any panel, drop fringe there and keep sheen only.
- **`background-clip: text` + animated background-position** on `.grad`: verified pattern, but
  confirm on Safari (webkit prefix already handled by existing `@supports` block).
- **Idle conic animation on 2 frames** is cheap, but if profiling shows paint cost on low-end
  hardware, the fallback is hover-only (one `animation-play-state` line).
- Magenta `--holo-mag` is deliberately confined to gradient stops so the danger-red and
  amber semantics can never be confused.
- The dead `#demoCard` typing-loop block in main.js (lines ~520–616, targets an element that no
  longer exists in any page) is inert; leave it out of scope for this visual pass.
