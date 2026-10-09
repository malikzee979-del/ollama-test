# Local Theft Auto — Unity: 20 Tasks To Do (`unity/LocalTheftAuto`)

**Status of this doc:** pure backlog, no game source changed while writing it.
Every task is grounded in the tree as of 2026-10: what I actually read this session
(`PLAN-gameplay-next.md`, `PARITY.md`, `.pixis/plans/lta-progression-and-memory.md`,
and greps across `Assets/Scripts/`). Line references use `::` symbol-level anchors so
they survive small edits.

**Relation to existing plans.** `PLAN-gameplay-next.md` is the authoritative Stage 1–4
plan; `lta-progression-and-memory.md` supersedes its Stage 3 economy section and adds
the memory work. Stage 1 (pause/WASTED/controls) and that doc's phases 0–2 are
**already landed** (grep-verified: `Paused`, `Wasted`, `SettingsStore`,
`Systems.KillPlayer`, texture eviction). This doc is the **next 20**, in priority
order — it does not re-plan what landed.

**House rules honored throughout (from `AGENTS.md` + standing plans):**

- **No config-file edits.** `ProjectSettings/`, `Packages/`, `Assets/Settings/LTA-URP*`
  are never touched; all new state is code-side.
- **Legacy `UnityEngine.UI.Text`, never TextMeshPro.** All new HUD labels go through
  the existing `Hud.UiText()` helper (`LTA.Hud.cs`).
- **Zero binary assets.** Every texture, mesh and sound stays runtime-generated.
- **No `git commit`** — the whole `unity/` tree is still untracked.

---

## The 20 tasks

### T1 — Save round-trip unit test (do this before everything else)

**Why first.** Many tasks below add a field or a save key. The likeliest way to lose
two days is a silent save corruption: a new field without a default initializer
read as `0f`/`false` from an old save. `SaveData` already carries `cash` and owned
cars; there is **no test pinning the old-save deserialization path**
(`JsonUtility.FromJson<SaveData>` at `LTA.Core.cs`, absent fields get defaults).

**Category:** tests. **Effort:** ~half a day. **Risk:** none.

**Do:** create `Assets/Tests/EditMode/SaveRoundTripTest.cs` (only `Assets/Editor/`
exists today — create the `Tests/` folder):
1. `Fresh_IsValid` — a fresh `SaveData()` is valid.
2. `AbsentFields_DeserializeDefaults` — serialize, delete a key from the JSON,
   deserialize, confirm the default initializer ran (`cash == 0`, no nulls).
3. `OldShape_StillLoads` — hand-written pre-progression JSON (no `cash`) loads with
   no throw and `valid` true.
4. `RoundTrip_IsIdentity` — full round-trip with cash/owned cars/achievements is
   bit-equal.

**Verify:** all four green; every task below that adds a save field re-runs them.

---

### T2 — Wire the dead `Tun*` / `GodMode` tuning fields

**Why.** Declared at `LTA.Core.cs` with the comment *"Stage 2's F1 debug panel will
drive these; declared now so adding the panel is a pure read-site edit"* — grep says
**zero read sites** exist. Dead public fields that promise runtime tuning are worse
than absent.

**Category:** hygiene. **Effort:** ~half a day. **Risk:** low.

**Do:** `PlayerSys.Step` multiplies `Cfg.BodyAccel[body]` by `s.TunAccel` (mirrors
for `TunTopSpeed`, `TunGrip`, `TunHandbrakeGrip`); `LawStep` cop-spawn throttle reads
`TunCopSpawnInterval`; weather chooser reads `TunForceWeather`; `UpdateWorldFX`
day-fraction reads `TunDayOverride`; `DamageCar`/`KillPlayer` early-return under
`GodMode`.

**Verify:** `PlayGame.Enter` — driving untouched at the neutral `1f` defaults.

---

### T3 — Publish the F1 debug panel the fields were declared for

**Why.** T2's write side. Drive the tuners from an overlay instead of the editor.

**Category:** dev tools. **Effort:** ~1 day. **Risk:** none.

**Do:** in `LTA.Hud.cs`, add `MenuPage.Debug` behind a debug define; reuse
`Hud.BuildPauseOverlay()`'s page machinery and the settings page's +/- steppers to
render the `Tun*` fields and a GodMode toggle. All labels via `Hud.UiText()`.

---

### T4 — In-car death path check

**Why.** The original brief found that the death branch required `InCar == null`, so
a player wrecked at 0 HP sat in the wreck indefinitely. Stage 1's `KillPlayer` may
have resolved it — **verify in the current tree** (`grep -n "InCar == null"
Assets/Scripts/LTA.Game.cs`); if the guard still requires on-foot death, replace it
with: eject the player, zero velocity, `Wrecked = true`, call `Systems.KillPlayer`.

**Category:** bug. **Effort:** ~half a day. **Risk:** low.

**Verify:** crash that zeroes health while driving → WASTED screen fires, no frozen
wreck. If already fixed: close with a one-line `PARITY.md` note.

---

### T5 — Witness-based crime reporting

**Why.** Only car theft checks for witnesses (`LTA.Player.cs` `TryEnterExit`, 130px
radius). Running over a ped and firing a weapon raise stars omnisciently.
`lta-progression-and-memory.md` §3.1 has the design settled.

**Category:** gameplay. **Effort:** ~1–2 days. **Risk:** medium (tuning).

**Do:** extract `Systems.PedWitness(x, y, radius)` (reuses `Spatial.Peds.QueryFresh`
and `PedEnt.Panic`); raise stars only when a living, non-panicked ped is within
radius; give the reporter a short delay during which killing them suppresses the
report. Route the run-over branch and `FireWeapon` through it.

---

### T6 — Vehicle radio (port from the JS original)

**Why.** `marketing/game.js` has a vehicle radio; Unity has none. `GameAudio` already
synthesizes its clips, so the radio is: a generated jingle per station, played on the
existing music channel, station persisted in `SettingsStore`, keys bound to two free
KeyCodes (e.g. `[` `]`).

**Category:** audio. **Effort:** ~1 day. **Risk:** none.

---

### T7 — Mission variant: steal contracts with a damage cap, and a reward-tier ladder

**Why.** `MissionSys` has a clean `Spawn`/`Complete`/`NextMissionAt` shape and four
mission kinds. Cheapest new depth: one steal-contract variant with
`maxReturnDamage`, and rewards scaling with lifetime completed missions.

**Category:** missions. **Effort:** ~1 day.

---

### T8 — Gas stations as a cash sink: drive-in repair for a price

**Why.** `SaveData.cash` earns faster than it can currently be spent. Gas-station
blocks already exist procedurally; a drive-in trigger that charges cash to repair
makes the honest in-world sink without inventing new content.

**Category:** progression. **Effort:** ~half a day. **Risk:** low.

---

### T9 — Five-star held tier: the SWAT cruiser

**Why.** Unity has roadblocks only; the standing plan records a faster, armoured
cruiser at 5★ as cheap — a new `CopEnt` flag reusing the existing cop visuals and
lane math. (Helicopter explicitly out of scope.)

**Category:** wanted. **Effort:** ~1 day. **Risk:** low.

---

### T10 — Fog as the third weather state

**Why.** Standing plan 4.2, nearly free: `RenderSettings.fog*` is already driven
per-frame by `UpdateWorldFX`. Fog weather = tighter fog distance, slower traffic, no
rain streaks. Tune together with the texture eviction radius, and set
`TunForceWeather = 2` ready from T2.

**Category:** atmosphere. **Effort:** ~half a day. **Risk:** low.

---

### T11 — Motorbike as a fourth body type

**Why.** Standing plan 4.1. `CarEnt.BodyType` is `Seed % 3` → `% 4`; add one row each
to the `Cfg.Body*` tables and a `MeshKit.BuildCar` silhouette case. The one
non-trivial edit: the hard-coded `14f` collision radius (`LTA.Player.cs`) must become
body-type-dependent.

**Category:** vehicles. **Effort:** ~1 day.

---

### T12 — Pay off the `ResetAudio3DStatics` reflection hack

**Why.** `GameLoop.ResetAudio3DStatics()` reaches into `Audio3D`'s private statics
by string name; every lookup null-guarded, so a rename would silently lose positional
audio on restart. The in-code marker already says to replace it. Add
`Audio3D.Reset()`, move the body, delete the reflection.

**Category:** hygiene. **Effort:** ~half a day. **Risk:** effectively none.

---

### T13 — Ped variety: speed tiers, palettes, cower pose

**Why.** All peds behave and look identically. Add 3 walk-speed tiers and 2 palette
variants keyed off the existing deterministic ped hash (parity contract: seeded, not
random), and give stationary panicked peds a cower pose instead of only running.

**Category:** world. **Effort:** ~half a day.

---

### T14 — Chase-music intensity model

**Why.** Tie a rising synthesized tension layer's amplitude and interval to
`State.Wanted` — the procedural equivalent of a chase score. Sells the star system
better than HUD polish.

**Category:** audio. **Effort:** ~half a day.

---

### T15 — Mission-board street signage

**Why.** Everything exists in the world. Paint one street-side sign near mission
markers teasing the current contract type ("DELIVERY" / "STEAL"), so the world
answers "why is this marker here" at a glance.

**Category:** world. **Effort:** ~1 day.

---

### T16 — Garage: enter the building (world trigger, not menu-only)

**Why.** Verify how the garage interaction currently opens; the target is a
world-side trigger on the garage block (walk in on foot or drive in) that opens the
garage view. Ownership should round-trip through the world, not just the pause
overlay.

**Category:** progression. **Effort:** ~1 day. **Risk:** low.

---

### T17 — Skybox: sunset / night / dawn ramp + real starfield

**Why.** `LTA.Sky.cs` already grades day/night. Extend it to a three-stop city-sky
ramp (sunset band, night band, dawn band) and add a generated starfield visible only
at night.

**Category:** atmosphere. **Effort:** ~1 day.

---

### T18 — Ambient audio per district

**Why.** Districts (Downtown / Residential / Industrial) landed but sound identical.
One looped noise buffer per district, crossfaded at boundaries, generated the same
way the engine loops are built in `GameAudio`.

**Category:** audio. **Effort:** ~1 day.

---

### T19 — Sandbox cheats page (teleport, weather lock, time skip, spawn bodies)

**Why.** After T3, the fun side of the debug page: teleport to garage/spawn, lock
weather, skip 6 hours, spawn one car of each body type. All operate on live `State`
fields; nothing extra saved. Makes testing tasks T8–T18 far cheaper.

**Category:** dev tools / sandbox. **Effort:** ~half a day. **Depends:** T3.

---

### T20 — `PARITY.md` upkeep in the same session as each change

**Why.** `PARITY.md` ground rule #2: *"update this table in the same change as any
port."* The tasks above add several new divergences/variations (radio, SWAT,
fog weather, damage-cap steals). Updating rows as each task lands avoids a
catch-up wipe at the end.

**Category:** documentation. **Effort:** continuous, ~10 min per task.

---

## Sequencing suggestion

| Order | Tasks | Why |
|---|---|---|
| Week 1 | T1, T2, T4, T12, T20 | hygiene + tests + bug fallout-free ground; everything else builds on a safety net |
| Week 2 | T3, T19, T8, T6 | tools first (they make the rest testable), then cheap feel |
| Week 3+ | T5, T7, T9, T10, T11, T13–T18 | gameplay depth & atmosphere, biggest payoff items last at full steam |

## Verification playbook

- Headless screenshot harness: `-lta-shot=` runs (`ShotRoutine`, `PlayGame.Enter`)
  after each gameplay task — this is the project's existing visual verification path
  and never touches project config.
- After any save-shape change: run the T1 EditMode tests.
- After any audio change: `-lta-shot=` proves no hang (the watchdog `Invoke` is on
  unscaled time, and paused audio must not deadlock it).
- `git status --porcelain unity/` is `?? unity/` — commit nothing (rule honored).
