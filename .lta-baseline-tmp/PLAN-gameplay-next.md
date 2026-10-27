# Local Theft Auto — Next Gameplay Stages (Implementation Plan)

**Target:** `unity/LocalTheftAuto`, Unity 6000.5.9f1, URP, all-procedural (one near-empty scene, zero prefabs).
**Status of this doc:** plan only. No game source was modified while writing it.
**Location:** `unity/LocalTheftAuto/PLAN-gameplay-next.md` (an identical copy of `.pixis/plans/lta-gameplay-next-stages.md`). It does not collide with `REALISM-PLAN.md` or `README.md`, the only other `.md` files in that directory.

---

## 0. Read this first

### 0.1 `REALISM-PLAN.md` is stale — do not plan from it

`unity/LocalTheftAuto/REALISM-PLAN.md` (dated Aug 25) claims the renderer is unlit and has no lights. Both are false in the current tree:

- `GameLoop.InitGame()` creates a real directional sun with soft shadows at `LTA.Game.cs:183-191` (`sun.shadows = LightShadows.Soft; RenderSettings.sun = sun;`) and an explicit `AudioListener` at `:165`.
- `GameLoop.SetupPostFx()` (`LTA.Game.cs:270`) builds a URP `Volume` in code with tonemapping/bloom/CA/grain/DoF.
- `Assets/Resources/LTA-Lit.shader` exists as the lit replacement; `LTA.Mesh3D.cs:218` refers to the *old* `Shade()` helper in the past tense ("the old Shade() helper … because the shader was unlit").

Phases 1 and 3 have landed. **Treat `REALISM-PLAN.md` as a historical record, not a backlog.** Consider a one-line "SUPERSEDED" banner on it in a later pass — not as part of this work, since it is a doc edit nobody asked for.

### 0.2 Snapshot before touching anything

```
$ git status --porcelain unity/
?? unity/
```

The **entire `unity/` tree is untracked** — never committed. There is no git history to fall back on for any of the ~8,400 lines under `Assets/`. Before starting Stage 1:

```bash
cp -R unity/LocalTheftAuto/Assets /path/outside/repo/LTA-Assets-snapshot-$(date +%Y%m%d)
```

Do **not** fix this with `git add`/`git commit` — `AGENTS.md` forbids committing unless explicitly asked, and project memory records the same rule. Take a filesystem copy.

### 0.3 House rules that shape this plan

- **Legacy `UnityEngine.UI.Text`, not TextMeshPro.** Every label in `LTA.Hud.cs` is built by the private helper `UiText()` (`LTA.Hud.cs:67-81`), which does `go.AddComponent<Text>()` and `t.font = SpriteKit.GameFont()` (`LTA.Sprites.cs:130`). All new UI stays on legacy `Text`. TMP would mean authoring/importing a font atlas asset — a new binary dependency in a project that generates every asset in code — for zero functional gain. **If anyone proposes TMP, reject it.**
- **Never modify config files.** Nothing here touches `ProjectSettings/`, `Packages/`, or `Assets/Settings/LTA-URP*`. All new state is code-side.
- **Never `git commit`.**

---

## 1. Verified state of the code (what I actually read)

### 1.1 The frame loop, exactly

`GameLoop.Update()` — `LTA.Game.cs:654-726`:

| Line | Statement |
|---|---|
| 662 | `float dt = Mathf.Min(0.05f, Time.unscaledDeltaTime);` |
| 663 | `data.State.Time += dt;` |
| 664 | `double t = data.State.Time;` |
| 667 | `if (s.Shake > 0f) s.Shake = Mathf.Max(0f, s.Shake - 36f * dt);` |
| 669 | `if (s.Started)` |
| 671 | `if (s.Busted <= 0f)` → **gates the entire sim block** |
| 672-685 | `PlayerSys.EnterExitPressed/TryEnterExit`, `PlayerSys.Step`, `Systems.SpikeStep`, `TrafficStep` loop, `ExhaustStep`, `SplashStep`, `PedStep` loop, `RespawnDeadPeds`, `PickupStep`, `WeaponPickupStep`, `WeatherStep`, `MissionSys.Step`, `ParticlesStep` |
| 687 | `Systems.LawStep(data, t, dt);` — **outside** the Busted gate, deliberately; its own comment at `LTA.Systems.cs:762-766` says this fixes a JS-original bug where BUSTED froze forever |
| 693-699 | the on-foot death branch |
| 702-706 | `if (s.Score > s.HighScore)` → `PlayerPrefs.SetInt("lta_highscore", …)` |
| 709-712 | `GameAudio.Step`, `Audio3D.Step`, `UpdateWorldFX(dt)`, `StepCamera(dt)` |
| 714 | `city.Sync(playerX, playerY, State.Weather == Weather.Rain, (float)State.Time)` |
| 715-724 | `SyncCars(dt) SyncCops(dt) SyncPeds() SyncPlayer(t) SyncPackages(t) SyncWeapons(t) SyncMission(t) SyncParticles() SyncSkids() SyncSpikeStrips()` |
| 725 | `hud.Refresh();` |

Two facts drive the whole pause design:

1. **`dt` is `Time.unscaledDeltaTime`.** The project deliberately runs on unscaled time. `Time.timeScale = 0` would *not* pause the simulation at all.
2. **`State.Time` is the single game clock.** Read by `MissionSys.Step` (`t > s.MissionEnds`, `LTA.Missions.cs:33`), `WeatherStep` (`t >= s.NextWeatherAt`, `LTA.Systems.cs:1167`), `LawStep`'s wanted-decay and cop-spawn throttles (`LTA.Systems.cs:774, 780`), `TrySpawnRoadblock`, the traffic-light phase, `SyncMission`'s marker rotation and `UpdateWorldFX`'s day fraction.

### 1.2 `Time.timeScale` is actively dangerous here — verified

Three things run on **scaled** time and break under `timeScale = 0`:

- `AutoSaveLoop()` — `LTA.Game.cs:556`: `var wait = new WaitForSeconds(5f);` → autosave silently stops.
- `Invoke("ForceQuit", 25f)` — `LTA.Game.cs:250`: the **watchdog for the headless screenshot harness**. At `timeScale = 0` it never fires.
- `ShotRoutine()` — `LTA.Game.cs:571, 602`: `WaitForSeconds(1.2f)` / `WaitForSeconds(0.5f)` never complete, so `Application.Quit()` at `:603` is never reached.

Net effect: a `timeScale`-based pause turns `-lta-shot=` runs into **hangs** instead of clean exits. Strongest single argument for `simDt`, and worth having on the record.

### 1.3 The death path today

`LTA.Game.cs:693-699`:

```csharp
if (data.Player.Health <= 0f && data.Player.InCar == null && s.Busted <= 0f)
{
    var pp = data.Player;
    pp.Health = 100f;
    pp.X = s.Spawn.x; pp.Y = s.Spawn.y;
    s.Wanted = 0;
    s.Say("Wasted — locally. You come to back on your home corner.");
}
```

Confirmed problems:

- Same-frame heal + teleport + wanted-reset. No screen, no penalty, no sound, no camera beat.
- **`p.Vx`/`p.Vy` are not zeroed** (the arrest path at `LTA.Systems.cs:836` *does*) — the player can arrive at spawn still carrying velocity.
- **In-car death is unreachable.** `Systems.DamageCar` (`LTA.Systems.cs:1130-1143`) clamps `p.Health` to `0f`, mirrors it onto `p.InCar.Health`, sets `p.InCar.Wrecked = true` — then returns. The `:693` guard requires `InCar == null`, so a player wrecked at 0 HP **sits in the wreck at 0 HP indefinitely**. `PlayerSys.Step` keeps driving the wreck (`LTA.Player.cs:205-208` decays a wrecked car's speed but still steers), and `p.Health = best.Health` on the *next* enter (`LTA.Player.cs:136`) is what eventually heals them — via some other car they happen to board. Every `DamageCar` caller can produce this: cop potshots (`LTA.Systems.cs:680`), cop ramming (`:700`), gang vendetta fire (`:537`), gang stray rounds (`:555`), crash impact (`LTA.Player.cs:232`), car-car collision (`:332`).
- Contrast the arrest path, which is correct and is the template to copy: `s.Busted = 2.4f` at `LTA.Systems.cs:818`, counted down at `:824-829`, resolved with eject/teleport/velocity-zero, drawn by `bustedPanel.SetActive(s.Busted > 0f)` at `LTA.Hud.cs:575`, framed by the arrest-orbit camera at `LTA.Game.cs:765`, sounded by the `wasBusted` edge detector at `LTA.Audio.cs:103-105`.

### 1.4 The `Busted` guard census (complete — grep-verified)

**Bold** = must become `Busted <= 0f && Wasted <= 0f` (or the `> 0f` dual) in Stage 1.

| Site | Code | Action |
|---|---|---|
| **`LTA.Game.cs:671`** | `if (s.Busted <= 0f)` — the whole sim gate | **add `&& s.Wasted <= 0f`** |
| **`LTA.Game.cs:693`** | death-branch guard | replaced entirely by `KillPlayer` |
| **`LTA.Game.cs:765`** | `if (data.State.Busted > 0f)` — arrest-orbit camera in `StepCamera` | **add `\|\| data.State.Wasted > 0f`**, or branch to a distinct wasted framing |
| **`LTA.Player.cs:105`** | `if (s.Busted > 0f) return;` in `TryEnterExit` | **add `\|\| s.Wasted > 0f`** |
| **`LTA.Systems.cs:772`** | `if (s.Busted <= 0f)` — pursuit/spawn/roadblock gate in `LawStep` | **add `&& s.Wasted <= 0f`** |
| **`LTA.Systems.cs:816`** | `… && s.Busted <= 0f` — the arrest trigger itself | **add `&& s.Wasted <= 0f`** (never arrest a corpse) |
| `LTA.Systems.cs:824-829` | the busted countdown | mirror with a new `Wasted` countdown block |
| **`LTA.Hud.cs:575`** | `bustedPanel.SetActive(s.Busted > 0f)` | add parallel `wastedPanel.SetActive(s.Wasted > 0f)` |
| **`LTA.Audio.cs:29, 60, 103-105`** | `static bool wasBusted` edge detector → `bustClip` | add parallel `wasWasted` → new wasted sting |
| `Assets/Editor/PoliceSimTest.cs:61, 68, 70` | harness reads/forces `Busted` | no change needed; see §5.3 |

**Correction to the brief:** `Systems.FireWeapon` (`LTA.Systems.cs:940`) has **no** `Busted` guard and needs none. Its only caller is `LTA.Player.cs:346`, inside `PlayerSys.Step`, called from `LTA.Game.cs:672` — already inside the `:671` gate. Same for `CycleWeapon` (`LTA.Player.cs:341`). A guard there would be dead code. **`:671` is the single choke point; guard there.**

**Two sites the brief did not list, found by grep:** `LTA.Game.cs:765` (`StepCamera` arrest orbit) and `LTA.Audio.cs:29/60/103-105` (bust sound edge detector). Without parallel `Wasted` handling, the WASTED screen arrives silent and statically framed.

### 1.5 Input surface — what is free

Every bound `KeyCode` (grep-verified across all 20 scripts): `W A S D`, `UpArrow DownArrow LeftArrow RightArrow`, `Space`, `Q`, `E`, `F`, `Return`, `JoystickButton0` (A/cross), `JoystickButton2` (X/square), `JoystickButton3` (Y/triangle), `JoystickButton5` (RB). Plus `Input.GetMouseButtonDown(0)` / `GetMouseButton(0)` for fire (`LTA.Player.cs:73, 82`) and `Input.GetAxis("Horizontal"/"Vertical")` for the pad stick (`:34-60`).

**Free and safe:** `Escape`, `P`, `F1`–`F12`, `Tab`, `M`, `R`, `G`, `H`, `JoystickButton7` (Start), `JoystickButton6` (Back/Select).

`Return`/`Space`/`JoystickButton0` are **not** free: `LTA.Hud.cs:452-456` uses them as the start-overlay keyboard fallback, and `Space`/`JoystickButton0` are the handbrake (`LTA.Player.cs:65-70`).

---

## 2. The pause-gating decision

### 2.1 Verdict: `simDt` is correct. Adopt it, with three amendments.

The proposal — `float simDt = s.Paused ? 0f : dt`, advance `State.Time` by `simDt`, pass `simDt` to sim systems, keep `Sync*` and `hud.Refresh()` on real `dt` — is right, and §1.2 shows the alternatives are worse:

- **`Time.timeScale = 0` is disqualified** (§1.2): the loop reads `Time.unscaledDeltaTime`, so it wouldn't even pause the sim, and it breaks autosave and hangs the screenshot watchdog.
- **Early-`return` from `Update()` is disqualified:** it skips `hud.Refresh()` (`:725`), so the pause overlay never draws; skips `city.Sync`/`Sync*`, so the world tears or freezes with stale `MeshRenderer` transforms; and skips `GameAudio.Step`, leaving engine loops stuck at their last volume.
- **`simDt` is disqualified from nothing.** It keeps the render half alive (the dimmed overlay shows the frozen city behind it — the look we want), freezes `State.Time` (mission deadlines, weather timers, wanted decay, cop-spawn throttles all hold), and is a one-line change at `:663`.

Three amendments:

**(a) `LawStep` must receive `simDt`, not `dt`.** `LTA.Game.cs:687` sits *outside* the `:671` gate on purpose. If it keeps real `dt`, the `Busted` countdown (`LTA.Systems.cs:826`) keeps running during a pause and the player can pause out of an arrest — the bust resolves behind the menu and teleports them on resume. Passing `simDt` makes `s.Busted -= 0f`, and frozen `t` stops the decay/spawn throttles. **Easiest thing in this whole plan to get wrong.**

**(b) `Shake` decay at `:667` must use `simDt`.** Otherwise a crash's screen shake keeps offsetting the camera behind the overlay. (Check how `StepCamera` consumes `Shake` when implementing — if the offset also derives from `State.Time`, freezing both is doubly safe.)

**(c) Keep `StepCamera(dt)`, `UpdateWorldFX(dt)`, `GameAudio.Step(dt)`, `Audio3D.Step(dt)` on real `dt`.** Presentation, not simulation. `StepCamera` on real `dt` lets the camera settle to rest framing instead of snapping; `UpdateWorldFX` keeps skybox/fog material properties valid (it re-derives `s.WeatherGrip`, a pure function of frozen state — harmless); audio keeps its `MoveTowards` fades smooth. `city.Sync` already takes `(float)data.State.Time`, so its animated bits (traffic-light lenses) freeze for free.

### 2.2 Input hazards `simDt` does not solve

**(i) Mouse click-through fires the weapon.** `PlayerSys.FirePressed()` includes `Input.GetMouseButtonDown(0)` (`LTA.Player.cs:73`). uGUI `Button` clicks on the pause menu *also* register as mouse-down. On the frame the player clicks RESUME, `s.Paused` flips false and the sim block at `:672` runs in the same `Update()` with mouse-down true → a round is discharged. Take both fixes:
  - Toggle pause at the top of `Update()`, and when unpausing set a one-shot `swallowFireFrame` flag consumed in `PlayerSys.Step`.
  - Belt-and-braces: add `EventSystem.current != null && EventSystem.current.IsPointerOverGameObject()` to `FirePressed()` (`LTA.Player.cs:71-77`). Correct regardless of pause, and stops shooting through any future UI. Needs `using UnityEngine.EventSystems;` in `LTA.Player.cs`.

**(ii) Never bind Resume to `Space` or `JoystickButton0`.** Both are the handbrake (`LTA.Player.cs:66-67`), held not tapped, so an unpause would immediately grab it. Bind **`Escape` and `P`** (toggle), **`JoystickButton7`/`JoystickButton6`** for gamepad. `Return` as a resume-confirm is acceptable — it also triggers the start-overlay fallback at `LTA.Hud.cs:453`, but that path is guarded by `!s.Started` and the pause menu only exists when `Started`.

**(iii) `TouchInput.Poll()` lives inside `PlayerSys.Step`** (`LTA.Player.cs:168`). Skipping `Step` while paused leaves a pre-pause touch drag stuck in `TouchInput.AxisX/AxisY`, and `TouchInput.EnterExitQueued` set during the pause (by the on-screen IN/OUT button at `LTA.Hud.cs:330`) survives to fire on resume. **Fix:** in the pause-toggle handler call a new `TouchInput.Reset()` zeroing `AxisX`, `AxisY`, `Handbrake`, `FireDown`, `FireHeld`, `EnterExitQueued`.

### 2.3 Shape of the change in `Update()`

```csharp
float dt = Mathf.Min(0.05f, Time.unscaledDeltaTime);

// pause toggle FIRST — before anything reads input for the sim
bool wantPause = Input.GetKeyDown(KeyCode.Escape) || Input.GetKeyDown(KeyCode.P)
              || Input.GetKeyDown(KeyCode.JoystickButton7) || Input.GetKeyDown(KeyCode.JoystickButton6);
if (wantPause && s.Started && s.Busted <= 0f && s.Wasted <= 0f) TogglePause();

float simDt = s.Paused ? 0f : dt;          // <-- the gate
data.State.Time += simDt;                  // was: += dt   (:663)
double t = data.State.Time;

if (s.Shake > 0f) s.Shake = Mathf.Max(0f, s.Shake - 36f * simDt);   // was dt (:667)

if (s.Started)
{
    if (s.Busted <= 0f && s.Wasted <= 0f && !s.Paused)              // was :671
    {
        …unchanged sim calls, all already take dt → pass simDt…
    }
    Systems.LawStep(data, t, simDt);                                  // was dt (:687)
    …KillPlayer / Wasted countdown…
}

GameAudio.Step(data, dt);   Audio3D.Step(data, dt);                   // unchanged, real dt
UpdateWorldFX(dt);          StepCamera(dt);                           // unchanged, real dt
city.Sync(…);               Sync*(…);        hud.Refresh();           // unchanged
```

The sim calls at `:672-685` already take a `dt` parameter — pass `simDt`. Since `simDt == dt` whenever not paused, this is behaviour-preserving. Because `s.Paused` is folded into the `:671` condition, passing `simDt` there is belt-and-braces; but `LawStep` at `:687` is *outside* that condition, so `simDt` there **is** load-bearing (amendment (a)).

---

## 3. Stage 1 — Pause, Settings, WASTED, Controls

> **LANDED (verified 2026-09-10).** Everything in §3 is in the tree: the `simDt`
> pause gate (`LTA.Game.cs:689`), `GameState.Paused` / `GameState.Wasted`,
> `Hud.SetPaused` + the pause/settings/controls pages, `wastedPanel`,
> `SettingsStore` + `AudioListener.volume`, `GameLoop.RestartRun`,
> `Systems.KillPlayer` as the single unified death-consequence site, and the
> full `Busted`-guard census from §1.4. The `PARITY.md` rows that still said
> "Stage 1 designed, unlanded" have been corrected. **Read §3 as history, not
> backlog.** The live work is
> `.pixis/plans/lta-progression-and-memory.md`.
>
> One part did *not* land: the `Tun*` / `GodMode` fields that 1A added as
> Stage 2's home exist in `GameState` but have **zero read sites** anywhere in
> `Assets/`. That gap is Phase 0.3 of the live plan.

**Effort:** ~2.5 days. **Payoff:** high — the four most visible "this is a game, not a tech demo" gaps. **Risk:** medium, concentrated in §2 (frame-loop gating) and §1.4 (guard census).

Build order: 1A → 1B → 1D → 1C → 1E. Each step is independently playable.

### 1A. `GameState` fields — `LTA.Core.cs`

Insert after `public float Busted;` (`LTA.Core.cs:627`):

```csharp
public float Wasted;              // >0 for WastedHold seconds while the WASTED screen shows
public bool  Paused;              // set by the pause menu; gates simDt in GameLoop.Update
```

Insert after `LastRoadblockAt` (`LTA.Core.cs:658`) — these are Stage 2's home, but adding them now costs nothing and saves an edit:

```csharp
// runtime tuning overrides, all default-neutral so the headless harnesses
// (which construct GameData directly) behave bit-identically to today
public float TunAccel = 1f, TunTopSpeed = 1f, TunGrip = 1f;
public float TunCopSpawnInterval = 1.5f;   // was a literal at LTA.Systems.cs:780
public int   TunForceWeather = -1;         // -1 = auto, 0 = Clear, 1 = Rain (2 = Fog in Stage 4)
public float TunDayOverride = -1f;         // -1 = follow Cfg.NightTheme, else 0..1 dayAmount
public bool  GodMode;
```

Why field initializers on `GameState` and not statics: `GameData` constructs it via `public readonly GameState State = new GameState();` (`LTA.Core.cs:679`), so all three headless harnesses — which do `var d = new GameData(); Systems.SpawnWorld(d);` with no scene (`GangSimTest.cs:25-26`, `PoliceSimTest.cs:30-31`, `TrafficSimTest.cs:26-27`) — get neutral defaults for free. Full justification in §4.2.

`enum Weather { Clear, Rain }` (`LTA.Core.cs:217`) stays as-is for Stage 1. Fog is Stage 4.

### 1B. `KillPlayer` — the unified consequence helper

Put it in `LTA.Systems.cs` next to `DamageCar` (`:1130`): `Systems` produces the condition and already owns the arrest-resolution logic in `LawStep`.

```csharp
public const float WastedHold = 2.6f;          // matches Busted's 2.4f beat, slightly longer
public const int   WastedPenaltyPct = 20;      // Stage 1: score penalty; Stage 3 reinterprets as cash

// One consequence path for on-foot death, in-car death and (optionally) arrest.
// Mirrors the arrest resolution at LTA.Systems.cs:824-845 so both read as the
// same beat to the player.
public static void KillPlayer(GameData d, string reason)
{
    var s = d.State; var p = d.Player;
    if (s.Wasted > 0f || s.Busted > 0f) return;      // never stack

    s.Wasted = WastedHold;
    s.Shake  = Mathf.Min(14f, s.Shake + 8f);

    // eject from a wreck the same way the arrest path does (:830-835)
    if (p.InCar != null)
    {
        p.InCar.IsPlayer = false; p.InCar.Parked = true;
        p.InCar.Speed = 0f; p.InCar.Vx = 0f; p.InCar.Vy = 0f;
        p.InCar = null;
    }

    // the consequence: wanted clears (you "died locally"), but it costs
    s.Score  = Mathf.Max(0, s.Score - s.Score * WastedPenaltyPct / 100);
    s.Wanted = 0;
    d.Cops.Clear();
    d.SpikeStrips.Clear();

    p.Health = 100f;
    p.X = s.Spawn.x; p.Y = s.Spawn.y;
    p.Vx = 0f; p.Vy = 0f;              // the arrest path does this at :836; :693 forgot to
    p.Ammo = Mathf.Max(0, p.Ammo - 12);
    p.SpikePenalty = 0f;
    s.Say(reason);
}
```

Then the countdown, immediately after the existing busted countdown (`LTA.Systems.cs:824-845`) inside `LawStep`:

```csharp
if (s.Wasted > 0f)
{
    s.Wasted -= dt;      // dt here is simDt from Game.cs:687 — freezes under pause
    if (s.Wasted <= 0f) s.Wasted = 0f;
}
```

Note the ordering difference from arrest: `KillPlayer` teleports **immediately** and uses `Wasted` purely as a screen-hold timer, whereas `LawStep`'s arrest teleports **when the countdown expires**. Either reads fine; immediate-teleport-under-a-frozen-screen is simpler and avoids a visible pop when the overlay lifts. **Say so in a code comment** so nobody "fixes" it into an inconsistency.

**Call sites:**

1. Replace `LTA.Game.cs:693-699` entirely:
   ```csharp
   if (data.Player.Health <= 0f && s.Busted <= 0f && s.Wasted <= 0f)
       Systems.KillPlayer(data, "Wasted — locally. You come to back on your home corner.");
   ```
   **The `InCar == null` condition is dropped** — that is the in-car-death fix. `KillPlayer` handles the eject.

2. Tempting but **do not**: trigger from the end of `Systems.DamageCar` (`LTA.Systems.cs:1136-1141`) after `p.InCar.Wrecked = true`. `DamageCar` is called from six sites including cop potshots and gang fire, and two of them (`:680`, `:700`) run from inside `CopStep`, which `LawStep` calls while iterating `d.Cops` **backwards** (`LTA.Systems.cs:802-822`). `KillPlayer` does `d.Cops.Clear()` — that is a collection mutation during iteration, i.e. a crash or silently skipped cops. **Let `Game.cs:693` be the only trigger.** It runs after the sim block, which is exactly why the arrest path is structured the same way. Record this as a deliberate decision.

### 1C. Pause + Settings + Controls UI — `LTA.Hud.cs`

All new UI goes **inside `LTA.Hud.cs`**, not a new file. The reusable helpers the brief points at — `UiImage` (`:57`), `UiText` (`:67`), `Rt` (`:55`), `Stretch` (`:355`), `TopLeft` (`:363`), `PlaceCenter` (`:371`), `MakeSwatch` (`:288`), `MakeTouchButton` (`:311`) — are all **`private static` members of `Hud`**. A separate file cannot call them without promoting them, which is a larger and riskier edit than adding ~260 lines to a 578-line file. If `LTA.Hud.cs` passes ~900 lines, extract them *then* into a new `LTA.Ui.cs` `UiKit` static class as a separate, purely mechanical refactor.

**Step 1 — extract the controls list.** `LTA.Hud.cs:216-222` holds:

```csharp
string[] keys =
{
    "W A S D  /  arrows \u2014 walk & drive",
    "E \u2014 enter / exit a car",
    "SPACE \u2014 handbrake",
    "\u25cf  collect the amber packages",
    "\u2605  don't run over the locals"
};
```

and `:232` holds the gamepad hint. Promote both to class-level statics:

```csharp
public static readonly string[] ControlLines = { … };
public const string GamepadHint = "gamepad: stick steers  |  A handbrake  |  X enter/exit  |  RB fire  |  Y swap gun";
```

Add rows for the weapons and the new menus so Controls is complete without inventing content: `F / LMB — fire`, `Q — swap gun`, `ESC / P — pause`.

**Layout hazard, verified:** the start overlay places lines at `10 - i * 26` (`:227`), pad hint at `-112`, button at `-150`, note at `-210`, picker label at `-270`, swatches at `-292`. Going from 5 lines to 8 puts the last line at `10 - 7*26 = -172`, **colliding with the button at `-150`**. Fix: keep the start overlay showing only the first 5 lines (preserving today's exact layout) and show the full array on the pause-menu Controls page, which has its own layout budget. Also preserve the per-line colouring at `:225-226` (`i == 3` amber, `i == 4` red) — a `(string text, Color color)[]` is cleaner than index checks and is a two-line change.

**Step 2 — build the panels.** In `BuildUi()`, after the BUSTED overlay block (`LTA.Hud.cs:167-183`) and **before** `BuildStartOverlay(root)` (`:203`):

```csharp
BuildPauseOverlay(root);     // pausePanel, settingsPanel, controlsPanel, wastedPanel
```

Sibling order under a `Canvas` is draw order; the canvas is `sortingOrder = 100` (`:113`). Building these after `bustedPanel` puts them above it — defensive only, since §2.3 blocks the toggle while `Busted > 0f`.

Copy the `bustedPanel` construction verbatim as the template (`:167-183`): `UiImage("wasted", root, new Color(7f/255f, 9f/255f, 13f/255f, 0.6f))` → `Stretch(Rt(...))` → bold 52pt title via `UiText` with `fontStyle = FontStyle.Bold` → 14pt subtitle → `SetActive(false)`. Use `Cfg.Hex("#ff5252")` for the WASTED title (same red as BUSTED and the low-health bar at `:568`) and `Amber` (`:43`) for pause accents, matching the start button at `:236-252`.

**Step 3 — buttons.** Factor the "Start driving" button block (`LTA.Hud.cs:236-252`) into a local helper so five buttons don't cost 5×17 lines:

```csharp
Button MakeMenuButton(Transform parent, string name, string label, float y, System.Action onClick)
```

preserving exactly: `img.color = Amber`, the `ColorBlock` with `normalColor = Color.white` / highlighted `0.9` / pressed `0.8`, `sizeDelta = (220, 44)`, and the `#0a0d12` bold 16pt stretched label.

**Do not** introduce `UnityEngine.UI.Slider` for volume — the project has no `Selectable` transition setup beyond `Button`, and a `Slider` needs background/fill/handle RectTransform plumbing that doesn't exist. Use two `MakeMenuButton`s (`−` / `+`) stepping master volume in 10% increments with a `UiText` readout between them. Reuses proven code and is gamepad/touch friendly.

**Step 4 — menu structure.** One `pausePanel` with three mutually-exclusive pages (`main`, `settings`, `controls`) toggled by `SetActive`, not three overlapping full-screen panels. Simpler z-order reasoning; back-navigation is one `SetActive` pair.

- **Main:** RESUME / SETTINGS / CONTROLS / RESTART (`GameLoop.Active.RestartRun()`, see 1E) / QUIT. For QUIT use `Application.Quit()` with an editor guard — `Application.Quit()` is a **no-op in the editor** and would read as a dead button:
  ```csharp
  #if UNITY_EDITOR
      UnityEditor.EditorApplication.isPlaying = false;
  #else
      Application.Quit();
  #endif
  ```
- **Settings:** Master Volume `−`/`+` + readout; optional SFX toggle (`AudioListener.volume` alone satisfies the brief); "Reset to defaults".
- **Controls:** full `ControlLines` + `GamepadHint`, laid out at `y = 180 - i * 26` inside the page.

**Step 5 — wire the toggle.**

```csharp
public void SetPaused(bool v)
{
    data.State.Paused = v;
    pausePanel.SetActive(v && data.State.Started);
    if (v) { TouchInput.Reset(); page = Page.Main; ApplyPage(); }
}
```

`GameLoop` owns the Esc/P read (§2.3) and calls `hud.SetPaused(...)`. Keeping the *key read* in `GameLoop` and the *panel state* in `Hud` matches the existing split: `GameLoop` owns the frame, `Hud` owns pixels. The one exception is the existing start-overlay fallback at `LTA.Hud.cs:452-456`, which reads keys inside `Refresh()` — leave it alone.

**Step 6 — `Refresh()` tail**, alongside `:575`:

```csharp
bustedPanel.SetActive(s.Busted > 0f);
wastedPanel.SetActive(s.Wasted > 0f);
if (s.Paused && !pausePanel.activeSelf) pausePanel.SetActive(s.Started);
```

That last line is the same defensive pattern already used for the start overlay at `:459` ("the game can also be started programmatically … keep the overlay honest").

### 1D. Master volume — `AudioListener.volume` + a settings store

**Use `AudioListener.volume`.** Not merely "a clean insertion point" — the *only* correct one. Four audio paths go through `AudioSource.PlayClipAtPoint`, which spawns a throwaway GameObject the caller never keeps a reference to:

- `LTA.Audio.cs:84` — crash clip
- `LTA.Audio3D.cs:164` — footstep clips
- `LTA.Audio3D.cs:175` — tire screech
- `LTA.Audio3D.cs:194` — distant gunshots

Per-source `.volume` writes (the only volume code today: `LTA.Audio.cs:56, 73, 130` and `LTA.Audio3D.cs:70, 204, 221`) cannot reach those. `AudioListener.volume` is a global multiplier at the single listener on the camera (`LTA.Game.cs:165`) and catches everything, including `PlayClipAtPoint` and `fx.PlayOneShot`.

```csharp
// LTA.Game.cs, in Update() after the pause toggle — one line, always applied
AudioListener.volume = SettingsStore.MasterVolume;
```

Applying every frame rather than only on change is free, and makes the settings screen's live preview work with no extra plumbing.

**Persistence — a separate `PlayerPrefs` key, NOT `SaveData`.** The brief suggests mirroring the `SaveData` pattern at `LTA.Game.cs:510-555`; the *shape* is right but the *container* must differ, for a concrete reason: `SaveGame()` begins with `if (data == null || !data.State.Started) return;` (`LTA.Game.cs:541`). Any volume change made from the **start overlay** — before `Started` is true — would never save, and `AutoSaveLoop` (`:555-560`) plus `OnApplicationQuit` (`:562-565`) are the only writers. Settings must persist independently of run state.

So: `[System.Serializable] class LtaSettings { public float masterVolume = 1f; public bool muted; public int version; }` in `LTA.Core.cs` next to `SaveData` (`:687-700`), stored under its own key `"lta_settings"` with the same `JsonUtility.ToJson` / `FromJson` + try/catch guard used at `LTA.Game.cs:512-519`. Back-compat precedent: `hasGun` → `OwnsPistol` at `LTA.Game.cs:526`. For settings, `JsonUtility` already leaves absent fields at their C# initializer value, so a missing `masterVolume` deserialises to `1f` — no migration code needed. Add the `version` int anyway; one field, and it makes a future migration possible.

Write on change (from the settings screen) and in `OnApplicationQuit`. Do **not** add it to `SaveGame()`.

### 1E. Restart — one new `GameLoop` method

`GameLoop.RecoverFromDomainReload()` (`LTA.Game.cs:728-742`) already does what a restart needs: destroy stray roots, destroy children, clear all six visual-ownership dictionaries and pools, null `playerVis`, call `InitGame()`.

```csharp
public void RestartRun()
{
    PlayerPrefs.DeleteKey(SaveKey);      // don't immediately reload the run we just abandoned
    RecoverFromDomainReload();
}
```

`SaveKey` is a `GameLoop` member (used at `:512` and `:551`), so it is in scope. **Hazard:** `RecoverFromDomainReload` calls `InitGame()`, which calls `LoadGame(data)` (`:155`) — hence `DeleteKey` first, otherwise RESTART silently restores the position/score/ammo of the run being restarted.

**Second hazard:** `GameAudio.Init` early-returns `if (fx != null)` (`LTA.Audio.cs:36`), and `Audio3D` keeps static dictionaries keyed by `CarVisual`/`CopEnt` (`LTA.Audio3D.cs:37-42`). After a restart those keys are destroyed objects. `Audio3D.DestroySrc` (`:247`) exists for exactly this; confirm the restart path clears `carEngine`/`copEngine`/`copSiren`, or add an `Audio3D.Reset()` that destroys all pooled sources and clears the three dictionaries. **Highest-risk item in Stage 1** — build RESTART last and test it in isolation. If it proves messy, ship Stage 1 without it; QUIT + reload-from-save already covers the need.

### Stage 1 risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `LawStep` keeps real `dt`, pause resolves an arrest | High if overlooked | Player teleports on resume | §2.3(a); test §5.1 item 2 |
| Mouse click-through fires weapon on Resume | High | Visible bug, wastes ammo | §2.2(i) — both fixes |
| Start-overlay layout collision from extra control lines | High | Overlapping text | §1C step 1 — first 5 only; screenshot check |
| `KillPlayer` from inside `DamageCar` clears `d.Cops` mid-iteration | Crash | `InvalidOperationException` / skipped cops | §1B — trigger only from `Game.cs:693` |
| RESTART leaves stale `Audio3D` statics | Medium | Leaked sources, ghost engine loops | §1E — `Audio3D.Reset()`, or defer RESTART |
| Pause UI in a new file can't reach `UiImage`/`UiText` | Certain | Compile error | §1C — build inside `LTA.Hud.cs` |
| QUIT does nothing in the editor | Certain | Looks broken | §1C step 4 — `isPlaying = false` guard |
| New `GameState` field breaks a harness | Very low | — | §5.3 |

---

## 4. Stage 2 — F1 runtime debug panel

**Effort:** ~1.5 days. **Payoff:** very high — the force multiplier for Stages 3 and 4, since every tuning question currently costs a code edit plus a full play session. **Risk:** low, *if* the `Cfg` question is answered as in §4.2.

### 4.1 It must be a child of the `GameLoop` GameObject, and IMGUI

`RecoverFromDomainReload()` (`LTA.Game.cs:730-732`) destroys **every root GameObject in the active scene that isn't `gameObject`**:

```csharp
var roots = SceneManager.GetActiveScene().GetRootGameObjects();
for (int i = 0; i < roots.Length; i++)
    if (roots[i] != gameObject) Destroy(roots[i]);
```

A debug panel created as its own root (`new GameObject("debug")`) is destroyed on the first domain reload. Create it the way `CityRenderer` and `Hud` are created — `gameObject.AddComponent<DebugPanel>()` from `InitGame()` next to `LTA.Game.cs:217-218`, behind `#if UNITY_EDITOR || DEVELOPMENT_BUILD` so release builds strip it. Confirm `Assets/Editor/BuildGame.cs` (27 lines) does not set `development`, or the panel ships.

**Use IMGUI (`OnGUI`), not uGUI.** `grep OnGUI` returns zero hits, so it is a new pattern here — but the right one: (1) ~12 sliders/toggles/buttons is ~60 lines in IMGUI versus ~400 lines of `RectTransform` plumbing with this project's hand-built helpers; (2) IMGUI needs no `EventSystem` and cannot collide with the HUD canvas at `sortingOrder = 100`; (3) it is dev-only and never ships, so inconsistency with the amber uGUI theme is irrelevant. Keep *player-facing* menus (Stage 1) on uGUI where the theme matters.

New file: `Assets/Scripts/LTA.Debug.cs`, `namespace LocalTheftAuto`, `class DebugPanel : MonoBehaviour`. It needs `data`, a **private** `GameLoop` field (`LTA.Game.cs:34`). Add `public GameData Data { get { return data; } }` next to the existing `CamYaw` (`:113`) and `Active` (`:133`) properties — that file already exposes exactly this kind of read-only hook for the HUD's benefit, so it is an established pattern, not a new breach of encapsulation.

### 4.2 The `Cfg` question — the brief's premise is half wrong, which changes the answer

The brief says the tunables are "`static readonly` arrays in `Cfg` (`LTA.Core.cs:156-225`) which cannot be mutated at runtime", and asks me to choose between plain `static` fields and `GameState` multipliers.

**Correction:** `static readonly` on an array field makes the **reference** immutable, not the elements. `Cfg.BodyAccel[0] = 500f;` **compiles and runs today.** All of `WeaponDamage`, `WeaponConeDeg`, `WeaponRange`, `WeaponCooldown`, `BodyAccel`, `BodyTopSpeed`, `BodyReverse`, `BodyGrip`, `BodyHandbrakeGrip`, `BodyMass`, `BodyCruiseMult` (`LTA.Core.cs:156-162, 219-225`) are element-mutable right now.

What genuinely cannot be mutated are the **`const` scalars**, and those are the majority of the interesting tunables: `DayLength` (`:171`), `NightTheme` / `NightDayAmount` (`:179-180`), `GrassGrip` / `SteeringFalloffStart` / `SteeringFalloffWidth` (`:234-236`), `GangHealth` / `GangDamage` / `GangSightRange` (`:120-128`), `RoadblockCooldown` / `SpikeSpeedPenalty` / `RamDamage` (`:285-298`), `LightCycle` (`:244`), `PedNearMissRadius` (`:256`), and the spawn counts `TrafficCars` / `PedCount` / `GangCount` (`:105-120`). `const` is compile-time-folded into every read site; there is no runtime lever at all.

**Decision: add mutable override/multiplier fields on `GameState`, applied at the read sites. Do NOT convert `Cfg`'s `const`s to `static`.** Four reasons, in weight order:

1. **The const→static conversion cascades.** `Cfg.RiverY0 = RiverBlockRow * BlockTiles` and `RiverY1 = RiverY0 + BlockTiles` (`LTA.Core.cs:59-60`) are `const` expressions over other `const`s. Making any of them `static` forces the dependents `static` too, and the river geometry is read throughout `CityMap` and `CityRenderer`. A "quick" conversion is not quick.
2. **It destroys a documented invariant.** `LTA.Core.cs:8-10`: *"Every gameplay constant below is copied 1:1 from marketing/game.js so the port plays exactly like the canvas version."* That audit trail is the project's main defence against silent tuning drift. Mutable `Cfg` means the numbers in the file no longer describe the game.
3. **Statics leak across runs and across harnesses.** The three headless tests run in the same editor process and read `Cfg` directly (`PoliceSimTest.cs:63` reads `Cfg.Dx`; `GangSimTest.cs:62-63` reads `Cfg.GangSightRange`/`GangFireRange`). A panel that writes `Cfg.BodyGrip[0] = 20f` is still in effect when the next harness runs, producing a "flaky" test that is actually contaminated state. `GameState` fields die with their `GameData`.
4. **Every read site already has `d` or `s` in scope**, so multipliers cost no plumbing:

   | Tunable | Read site | `s`/`d` available? |
   |---|---|---|
   | accel / top speed / reverse / grip | `LTA.Player.cs:191-195` | yes — `var s = d.State` at `:170` |
   | body mass (crash impulse) | `LTA.Player.cs:312-313` | yes |
   | AI cruise multiplier | `LTA.Systems.cs:255` | yes — `d` is the first param |
   | cop spawn interval | `LTA.Systems.cs:780` (literal `1.5`) | yes — `var s = d.State` at `:769` |
   | cop pursuit speed | `LTA.Systems.cs:663` (literal `155f + Wanted * 10f`) | yes |
   | damage taken | `LTA.Systems.cs:1130-1143` (`DamageCar`) | yes |
   | day amount | `UpdateWorldFX`, `LTA.Game.cs:38-45` | yes — `var s = data.State` |
   | weather | `LTA.Systems.cs:1162` (`WeatherStep`) | yes |

   Concretely, `LTA.Player.cs:191-195` becomes:
   ```csharp
   float accel      = Cfg.BodyAccel[body]         * spikeSpeedMul * s.TunAccel;
   float topSpeed   = Cfg.BodyTopSpeed[body]      * spikeSpeedMul * s.TunTopSpeed;
   float reverseSpd = Cfg.BodyReverse[body]       * spikeSpeedMul * s.TunTopSpeed;
   float gripBase   = Cfg.BodyGrip[body]          * spikeGripMul  * s.TunGrip;
   float gripHand   = Cfg.BodyHandbrakeGrip[body] * spikeGripMul  * s.TunGrip;
   ```
   With `Tun* == 1f` this is bit-identical to today (float multiply by exactly 1.0f), so shipped feel and harnesses are untouched.

**The one place `Cfg` element-mutation stays tempting and should still be refused:** the `Body*` arrays. It works, but it has no "restore defaults" story (you must remember the original values) and it violates reason 3. Multipliers are self-resetting: `TunGrip = 1f`.

### 4.3 Panel contents and the specific blocker for each

| Control | Implementation | Blocker to resolve |
|---|---|---|
| Time of day (0..1 slider) | `s.TunDayOverride` read in `UpdateWorldFX` | **`Cfg.NightTheme` is `const bool` (`LTA.Core.cs:179`)**, so the ternary at `LTA.Game.cs:41-43` is compile-time folded to the night branch. The override must be tested **before** that ternary: `float dayAmount = s.TunDayOverride >= 0f ? s.TunDayOverride : (Cfg.NightTheme ? Cfg.NightDayAmount : Mathf.Cos(…));` |
| Force weather (auto/clear/rain) | `s.TunForceWeather` checked at the top of `WeatherStep` (`LTA.Systems.cs:1162`), early-returning after assigning `s.Weather` | Must also drive `s.WeatherGrip`, set in `UpdateWorldFX` (`LTA.Game.cs:~68`), **not** `WeatherStep` — verify the two agree or rain visuals and grip desync |
| Set wanted (0-5) | `s.Wanted = v; s.LastCrime = s.Time;` | Setting `LastCrime` is essential — without it the decay at `LTA.Systems.cs:774` fires immediately. `PoliceSimTest.cs:65` does exactly this and comments why |
| Teleport to objective | `p.X = s.MissionX; p.Y = s.MissionY;` | **If `p.InCar != null` you must move the car too** (`p.InCar.X/Y`) and zero `Speed`/`Vx`/`Vy` — when driving, the player's position *is* the car's. Also run `CityMap.CircleHitsBuilding(x, y, 14f)` (`LTA.Core.cs:367`) and fall back to `CityMap.TileCenter(CityMap.RandTileOf(Cfg.Road, Cfg.Side))` (`:386, 398`), or you can teleport into a skyscraper |
| God mode | `s.GodMode` early-return at the top of `Systems.DamageCar` (`LTA.Systems.cs:1130`) | One line, one site — all six damage paths funnel through `DamageCar` (§1.3) |
| Handling multipliers | §4.2 | — |
| Cop spawn rate | `s.TunCopSpawnInterval` replacing the literal `1.5` at `LTA.Systems.cs:780` | Literal, not a `Cfg` const — trivial |
| Screenshot | `GameLoop.CaptureTo(path)` | **`static void` and private (`LTA.Game.cs:608`)** — promote to `public static`. **And it must run at end-of-frame:** `ReadPixels` mid-`Update` reads an incomplete backbuffer. Route through a coroutine exactly as `ShotRoutine` does (`LTA.Game.cs:597-601`: `yield return new WaitForEndOfFrame(); CaptureTo(shotPath);`) |
| Frame stats | `Time.unscaledDeltaTime`, `d.Cars.Count`, `d.Peds.Count`, `d.Cops.Count`, `d.Particles.Count`, `d.Skids.Count` | Read-only, zero risk — **build this first**, it validates the panel plumbing |

Also add **"Reset tuning"** (restore every `Tun*` to its initializer value) and **"Dump state"** (`Debug.Log(JsonUtility.ToJson(s))`). Both are one-liners and both save real time.

### Stage 2 risks

Low. The main failure mode is a multiplier applied at one read site and missed at its sibling — e.g. `TunGrip` on `BodyGrip` but not `BodyHandbrakeGrip` (`LTA.Player.cs:194-195`), which makes the handbrake feel unrelated to the slider. The §4.2 table is the checklist; work down it row by row. Second-order: `Audio3D.cs:103` derives engine pitch from `spdN` (normalised speed), so `TunTopSpeed = 3` makes every engine scream at max pitch. Cosmetic — expect it, don't chase it as a bug.

---

## 5. Verification

### 5.1 Manual — `PlayGame.Enter`

```bash
/Applications/Unity/Hub/Editor/6000.5.9f1/Unity.app/Contents/MacOS/Unity \
  -projectPath /Users/bilalahmed/Documents/ollama-project/unity/LocalTheftAuto \
  -executeMethod PlayGame.Enter
```
Confirm the exact editor path under `/Applications/Unity/Hub/Editor/` — I did not verify the install location. `PlayGame.Enter` (`Assets/Editor/PlayGame.cs:8-17`) defers one tick via `EditorApplication.delayCall`, then enters play mode.

Stage 1 checklist, in this order — each item targets a specific hazard above:

1. **Mission freeze.** Note the HUD countdown (`LTA.Hud.cs:475-497` renders `MissionEnds - Time`). Esc for 30s. Resume. The countdown must read the value it had at pause. *Fails if `State.Time` still advances at `:663`.*
2. **Arrest freeze.** Get busted (Wanted ≥ 1, let a cop within 36 units — `LTA.Systems.cs:816`). During the BUSTED overlay, Esc must be **ignored** (§2.3 gates the toggle on `Busted <= 0f`). Then temporarily allow pause during bust and confirm the 2.4s countdown does not advance. *Fails if `LawStep` at `:687` still gets `dt`.*
3. **Weather/wanted freeze.** Pause during rain for 60s; rain must not clear (`WeatherEnds`, `LTA.Systems.cs:1173`). Pause at 4 stars for 60s; must still be 4 on resume (decay at `:774`).
4. **Click-through.** Arm the pistol (walk over a crate — `WeaponPickupStep`, `LTA.Systems.cs:866`), open pause, click RESUME with the mouse. Ammo must not decrease. *Fails without §2.2(i).*
5. **Handbrake.** Unpause with Esc, not Space; confirm no lurch. Then deliberately try Space and confirm it *does* grab the handbrake — expected, and the reason Space is not a resume binding.
6. **WASTED on foot.** Let a gang vendetta (`Systems.AggroGang`, `LTA.Systems.cs:1059`) gun you down. Overlay appears, holds ~2.6s, red screen, sting plays, camera does something deliberate rather than snapping. Score drops. Ammo drops. On lift: at `s.Spawn`, 100 HP, 0 stars, **zero velocity** (walk, don't slide).
7. **WASTED in a car — the regression that matters.** Ram a wall at speed until `DamageCar` wrecks you (`LTA.Player.cs:232`), or take cop potshots at ≥3 stars (`LTA.Systems.cs:680`) until HP hits 0 while driving. Today this leaves you sitting in a wreck at 0 HP forever (§1.3). After the fix: ejected, WASTED screen shown.
8. **Volume.** Settings → master volume to 0. Every sound must stop, **including** crashes, footsteps, tire screech and distant gunfire — those four go through `PlayClipAtPoint` (§1D) and are what a per-source implementation would miss. Drive into a wall at 0 volume to test the crash path specifically.
9. **Settings persistence from the start overlay.** Set volume to 30% **before** pressing "Start driving", quit, relaunch. Must still be 30%. *Fails if settings live in `SaveData` (§1D).*
10. **Controls page layout.** Screenshot the start overlay; confirm no overlap between the key list and the button — the collision predicted in §1C.
11. **RESTART** (last, only if 1-10 pass). Fresh spawn, no restored save, no duplicate engine loops (listen for a phasing/chorusing engine — indicates leaked `Audio3D` statics, §1E).

**Headless UI screenshots** — the project already has the harness, and it is the fastest layout check: `InitGame` reads `-lta-shot=/abs/path` (`LTA.Game.cs:246-249`), forces `Started = true`, and `ShotRoutine` (`:569-604`) writes hand-rolled BMPs via `CaptureTo`. Add a sibling flag `-lta-shot-ui=pause` that sets `s.Paused = true` (and separately `s.Wasted = WastedHold`) before the capture, so each new overlay can be screenshotted in batchmode with nobody at the keyboard. ~10 lines added to an existing routine; pays for itself immediately.

### 5.2 Headless regression harnesses

```bash
U=/Applications/Unity/Hub/Editor/6000.5.9f1/Unity.app/Contents/MacOS/Unity
P=/Users/bilalahmed/Documents/ollama-project/unity/LocalTheftAuto
$U -quit -batchmode -projectPath $P -executeMethod GangSimTest.Run
$U -quit -batchmode -projectPath $P -executeMethod PoliceSimTest.Run
$U -quit -batchmode -projectPath $P -executeMethod TrafficSimTest.Run
```

Run all three **before** Stage 1 to capture baseline output, then after each step. They log to stdout and `Logs/`. `PoliceSimTest` matters most here: it drives `Systems.LawStep` directly (`PoliceSimTest.cs:70`) and counts `bustedEvents` (`:62, 70`) — a wrong `Wasted` guard at `LTA.Systems.cs:816` drops `bustedEvents` to 0 and the test's own assertion catches it. `GangSimTest` exercises `DamageCar` indirectly through gang fire (`LTA.Systems.cs:537, 555`), so a bad `GodMode` early-return shows up as an unexpected death-count change.

None of the three touches `Hud`, `GameLoop.Update`, or `AudioListener`, so Stage 1's UI work is invisible to them — which is precisely why the §5.1 manual checklist is not optional.

### 5.3 Why new `GameState` fields cannot break the harnesses

All three construct `var d = new GameData();` (`GangSimTest.cs:25`, `PoliceSimTest.cs:30`, `TrafficSimTest.cs:26`), and `GameData` initialises `public readonly GameState State = new GameState();` (`LTA.Core.cs:679`). Every field added in §1A/§4.2 carries a C# initializer (`Wasted`/`Paused` default to `0f`/`false`; the `Tun*` fields to neutral). No harness sets them, so all read neutral:

- `Wasted == 0f` → every `&& s.Wasted <= 0f` guard is true → identical to today.
- `Paused == false` → `simDt == dt` → identical.
- `Tun* == 1f` → float multiply by exactly 1.0f → bit-identical.
- `TunForceWeather == -1`, `TunDayOverride == -1f`, `GodMode == false` → all inert.

`PoliceSimTest.cs:61` does `if (s.Busted <= 0f) s.Wanted = 4;` — it reads `Busted`, never `Wasted`, and its `bustedEvents` counter is unaffected. **The only ways a harness breaks:** a guard written `||` instead of `&&`, or a `Tun*` field missing its initializer (an un-initialised `float` is `0f`, which zeroes all acceleration and makes `PoliceSimTest`'s "cops make measurable progress" assertion fail loudly — a good failure, but confusing at 2am). Put a comment on the field block saying exactly this.

---

## 6. Stage 3 — Spendable cash, garage, ownable cars

**Effort:** ~4 days once the design questions are answered; **unbounded until they are**. **Payoff:** high — the only thing that gives `Score` a purpose beyond a leaderboard. **Risk:** high, and mostly *design* risk rather than code risk.

### 6.1 The blocking collision: `Score` is already three different things

Grep-verified, `Score` currently serves as:

1. **A leaderboard number** — `s.HighScore` compared and written to `PlayerPrefs.SetInt("lta_highscore")` at `LTA.Game.cs:702-705`, read back at `:151`, persisted in `SaveData.score` / `SaveData.highScore` (`LTA.Core.cs:695-696`), displayed as `SCORE nnnnnn · BEST nnnnnn` at `LTA.Hud.cs:467-469` and on the start overlay at `:257`.
2. **An audio trigger** — `GameAudio.Step` plays the pickup chime on any increase: `if (s.Score > lastScore) fx.PlayOneShot(pickupClip, 0.55f); lastScore = s.Score;` (`LTA.Audio.cs:80-81`). A purchase *decreases* `Score`; the edge detector handles that correctly (fires only on increase, re-baselines every frame), so no bug — and the chime then reads as "money in", which is fine.
3. **A mission reward sink** — `s.Score += s.MissionReward` (`LTA.Missions.cs:104`), `+= 100` per package (`LTA.Systems.cs:858`), `+= Cfg.GangKillScore` per gangster (`:1086`).

If `Score` *becomes* spendable, buying something **permanently lowers your BEST**, and high score's leaderboard meaning collapses (you could top a score simply by never spending). **This decision gates everything else in Stage 3.**

### 6.2 Design decisions the user must answer before this can be built

1. **One number or two?** (a) `Score` becomes cash and `HighScore` freezes as "peak cash ever held" — simplest, one field, but "BEST" stops meaning skill. (b) Keep `Score` as the immutable skill leaderboard and add a separate `Cash` that missions/packages/kills *also* increment (each `Score +=` site gains a parallel `Cash +=`). **Recommend (b)** — it leaves the existing HUD, the `lta_highscore` PlayerPrefs key, the audio trigger and all four harness-visible behaviours untouched, making Stage 3 purely additive. Cost: four call sites get a second line.
2. **What does the garage sell?** Very different implementation costs:
   - *Cosmetic only* (paint from `Cfg.CarPaints`, `LTA.Core.cs:82`) — cheapest; `MeshKit.Tint` exists and `GameLoop.RetintPlayer()` (`:138`) is the precedent for re-tinting without a rebuild.
   - *Ownable specific cars* — needs a persisted owned-vehicle list and somewhere to park them. There is **no garage building concept** in the city: `Cfg` has `Road/Side/Bldg/Park/Water` tile types (`LTA.Core.cs:53`) and `CityRenderer` generates blocks procedurally. A garage needs either a designated tile/block (new `Cfg` const + `CityMap` query + a `MeshKit` building variant) or a "summon a car to your position" model (no building at all).
   - *Permanent upgrades* (top speed, armour, ammo capacity beyond `Cfg.AmmoMax = 120` at `LTA.Core.cs:163`) — these multiply into the `Cfg.Body*` reads, so they want the same `GameState` multiplier plumbing as Stage 2's `Tun*` fields. **Build Stage 2 first and reuse it.**
3. **Where does the player spend it?** A physical drive-to location (needs the garage building, plus a reach check — reuse the 42-unit `ReachR` pattern from `MissionSys.StepDelivery`, `LTA.Missions.cs:20, 60`) or a menu opened from the pause screen (zero world work, less GTA)? Physical is more in keeping and reuses `MeshKit.BuildMarker(Color tint)` (`LTA.Mesh3D.cs:978`); a menu is about a third of the effort.
4. **What is the price scale?** Current rewards: package `+100`, mission `200-350+` (`LTA.Missions.cs:145, 160, 205, 240`), gangster `+25` (`Cfg.GangKillScore`), and Stage 1 adds a 20% death penalty. Prices must sit against those numbers or the shop is trivial or unreachable.
5. **Do owned cars persist across sessions?** If yes, `SaveData` (`LTA.Core.cs:687-700`) needs new fields and a migration path following the `hasGun` → `OwnsPistol` precedent at `LTA.Game.cs:526`. If owned cars are identified by `CarEnt.Seed`, note cars are regenerated procedurally each run by `Systems.SpawnWorld` (`LTA.Systems.cs:39`) — a persisted seed may not correspond to a live `CarEnt`. `s.StealTarget` (`LTA.Core.cs:648`) is the existing precedent for holding a reference that can go stale, and `LTA.Missions.cs:86-92` handles exactly that. **Recommend persisting body type + paint, not identity**, and spawning a fresh car of that spec on demand.
6. **Does buying reduce `Wanted`?** (Bribe / respray.) Cheap — `s.Wanted = 0; d.Cops.Clear();` is the body of the arrest resolution at `LTA.Systems.cs:828-829` — and very GTA, but it changes the difficulty curve the 5-star system was tuned around.
7. **Does the WASTED penalty take cash or score?** Stage 1's `KillPlayer` (§1B) penalises `s.Score` by 20%. Under decision 1(b) that should probably become a `Cash` penalty so death doesn't corrupt the leaderboard. **Answer this together with question 1.**

### 6.3 Build order once answered (assuming recommended 1(b) + physical garage)

1. `GameState.Cash` (int) + `SaveData.cash` with back-compat default 0 — `LTA.Core.cs`, `LTA.Game.cs:510-555`.
2. Parallel `Cash +=` at the four `Score +=` sites: `LTA.Systems.cs:858`, `:1086`, `LTA.Missions.cs:104`, plus the `KillPlayer` penalty from §1B.
3. HUD cash readout — one more `UiText` in `BuildUi()` near `scoreText` (`LTA.Hud.cs:118-119`), positioned with `TopLeft` at `y = 132` (below `ammoText` at `:120`).
4. Garage location: pick a fixed block. The city is deterministic from `JSRng.BlockHash` (`LTA.Core.cs:38-44`), so a hardcoded block index is stable across runs — the same property `data.State.Spawn = CityMap.TileCenter(new Vector2Int(41, 40))` at `LTA.Game.cs:152` relies on.
5. Marker + reach check reusing `MeshKit.BuildMarker` and the `ReachR` pattern.
6. Shop UI as a fourth page on the Stage 1 `pausePanel` page-switcher, or a dedicated panel shown only inside the garage zone.
7. Purchase application: Stage 2 `Tun*` multipliers for upgrades, `MeshKit.Tint` for paint.
8. Save/load round-trip test.

---

## 7. Stage 4 — Depth and variety

**Effort:** ~5 days total; the four items are independent and can ship in any order. **Payoff:** medium-high. **Risk:** the motorbike is the dangerous one.

Suggested order, cheapest-and-safest first: **4C (witnesses) → 4B (fog) → 4A (mission chains) → 4D (motorbike).**

### 4A. Multi-stage mission chains with a drive-to giver

Today `MissionSys.Spawn` (`LTA.Missions.cs:109`) rolls a job on a pure clock — `if (t >= s.NextMissionAt) Spawn(d, t);` (`:29`) — with no location, no acceptance, and no fail/retry state. A blown Steal job just prints "job's off" and reschedules (`:86-92`).

- New `GameState` fields: `GiverX/GiverY` (float), `GiverActive` (bool), `ChainStage` (int), `ChainLength` (int), `MissionFailed` (bool), `MissionsCompleted` (int).
- **No new `MissionKind` member needed** — a chain is a sequence of existing kinds. Keep `enum MissionKind { Delivery, Rampage, Steal, GangWar }` (`LTA.Core.cs:215`) and drive the sequence from `ChainStage`.
- Replace the clock-only trigger at `:29`: roll a *giver location* on the clock, then require the player to reach it (reuse `ReachR = 42f`, `LTA.Missions.cs:20`) before `Spawn` fires. Marker via a second `GameObject` alongside `missionGo` (`LTA.Game.cs:226-231`) — copy that whole construction/`SyncMission` pair (`:1064-1080`).
- Add a real fail state: `StepSteal`'s "job's off" (`:86-92`) and the timeout at `:33-40` currently just reschedule. Set `MissionFailed = true`, apply a cooldown/penalty, and surface it via the existing `missionText` (`LTA.Hud.cs:475-497`) plus a red state.
- **Difficulty ramp:** the constants are all literals in `LTA.Missions.cs` — `RampageGoal = 3 + Random.Range(0, 3)` (`:155`), `MissionEnds = t + 35.0` (`:157`), gang goal `4 + Random.Range(0, 3)` (`:177`), reward formulas (`:145, 160, 205, 240`). Scale by `ChainStage` or `MissionsCompleted`. Worth also scaling by `s.Wanted` so a hot player gets harder jobs.
- **Risk:** `s.StealTarget` holds a live `CarEnt` reference (`LTA.Core.cs:648`) that can be wrecked or recycled. A *chain* holds that reference across multiple stages, widening the stale window. `StepSteal` already null-checks (`:86`), so the pattern is established — but every chain stage capturing an entity reference needs the same guard.

### 4B. Third weather state: fog

`enum Weather { Clear, Rain }` is at `LTA.Core.cs:217`. Every consumer found by grep:

| Site | Code | Change needed |
|---|---|---|
| `LTA.Core.cs:651-655` | `Weather`, `NextWeatherAt`, `WeatherEnds`, `WeatherGrip` on `GameState` | add `Fog` transitions |
| `LTA.Systems.cs:1162-1181` | `WeatherStep` — a two-branch `if (Clear) … else …` | becomes three-way; needs a transition table, not nested ifs |
| `UpdateWorldFX`, `LTA.Game.cs:~50-70` | `bool raining = s.Weather == Weather.Rain;` then lerps sky/fog, sets `RenderSettings.fogEndDistance = raining ? 1500f : 2600f` and `s.WeatherGrip = raining ? Lerp(0.74, 0.62, rainIntensity) : 1f` | add a fog branch pulling `fogEndDistance` far down (~500-700) and nudging `WeatherGrip` slightly |
| `LTA.Game.cs:714` | `city.Sync(…, data.State.Weather == Weather.Rain, …)` | **the third parameter is a `bool`** — this is the real work. Widen it to a `Weather` enum or a second bool, and update `CityRenderer.Sync` plus the wet-material swap (`Cfg.WetGloss`/`WetSpecStrength`/`WetAlbedoDarken`, `LTA.Core.cs:196-198`) to match |
| `LTA.Game.cs:~85` | `if (raining)` gates `rainRoot.SetActive` and `StepRain(dt)` | fog must NOT activate the rain particle root |
| `LTA.Audio.cs:31, 60, 72-73` | `static Weather lastWeather`; rain ambience target `s.Weather == Weather.Rain ? 0.18f : 0f` | add a fog ambience (wind?) or leave silent |
| `LTA.Audio3D.cs:203-204` | `aTarget = d.State.Weather == Weather.Rain ? 0.015f : 0.07f` | decide the fog duck level |
| `SkyKit.Apply` (`LTA.Sky.cs`, 45 lines) | skybox from sky/fog colours | follows for free — `UpdateWorldFX` already feeds it |

**Hazard:** `WeatherStep`'s current shape is a two-state toggle where `NextWeatherAt` and `WeatherEnds` mean different things in each branch. Adding a third state to that shape produces a combinatorial mess. **Rewrite it as an explicit transition table** (`static readonly Weather[] NextFrom = …` plus per-state durations) rather than adding a third `else if`. ~25 lines replacing a 20-line function, and it makes Stage 2's `TunForceWeather` trivial to honour at the same time.

**Cheap win:** fog is nearly free visually because `RenderSettings.fog` is already `true` with `FogMode.Linear` (`LTA.Game.cs:203-206`) and `UpdateWorldFX` already writes `fogColor`/`fogEndDistance` every frame. The work is almost entirely state-machine plumbing, not rendering.

### 4C. Witness-based crime reporting

Today the wanted level has exactly three trigger sites, all grep-verified: `LTA.Systems.cs:1005` (gunfire hitting a ped), `LTA.Player.cs:148` (carjack witnessed within 130px), `LTA.Player.cs:287` (running someone over). Bystanders otherwise never report anything.

The infrastructure already exists:
- `PedEnt.Panic` (`LTA.Core.cs:474`) — set to `2f` on a witnessed carjack (`LTA.Player.cs:144`), and computed continuously by the near-miss system at `LTA.Systems.cs:318-331` (`p.Panic = Mathf.Lerp(Cfg.PedPanicMin, Cfg.PedPanicMax, bestAmount)`).
- Crowd-scare propagation at `LTA.Systems.cs:340-351`, gated by `Cfg.CrowdScareRadius = 55f` / `CrowdScareChancePerSec = 0.9f` (`LTA.Core.cs:265-266`). Copy this rate-limited-probability shape exactly for the report roll.
- The wanted bump itself is a two-liner repeated at all three sites: `s.Wanted = Mathf.Min(5, s.Wanted + 1); s.LastCrime = s.Time;`. Extract into `Systems.ReportCrime(GameData d, int stars, string msg)` and call it from all four places.

**The critical design trap:** `Panic` is set by *any* fast-moving car (`Cfg.PedNearMissSpeed = 70f`, `LTA.Core.cs:255`) and by *any* nearby panic (`:340-351`) — including AI traffic and gang-on-gang violence. If a report simply rolls on "nearby ped has `Panic > 0`", then **ordinary traffic and the two gangs' constant shootout generate an infinite wanted level**, and the player sits at 5 stars for reasons they cannot attribute. It would also silently change what `GangSimTest` observes, since that harness measures panic behaviour over 60 simulated seconds (`GangSimTest.cs:68-80`).

**Fix:** add a distinct, player-attributable flag rather than reusing `Panic`. `PedEnt.WitnessT` (double, init `-1e9`, matching the existing `LastShotAt`/`VendettaUntil`/`RammedAt` idiom at `LTA.Core.cs:504, 512, 534`), set **only** at player-caused crime sites — the carjack witness loop (`LTA.Player.cs:139-145`), the run-over (`:287`), gunfire (`LTA.Systems.cs:1005`). Then `PedStep` rolls a report for peds with `t < WitnessT + WitnessMemory` inside `WitnessReportRadius`, rate-limited by a new `s.LastWitnessReport` throttle following the `s.LastCopSpawn` pattern (`LTA.Systems.cs:780`). Three new `Cfg` consts: `WitnessMemory`, `WitnessReportRadius`, `WitnessReportChancePerSec`.

**Second trap:** a report must not fire while the ped is dead, and must not double-count. Check `p.Dead` (as `:347` does) and require `PedKind.Civilian` or `ParkGoer` — **exclude `PedKind.Gangster`**, or the two gangs' war (`Cfg.GangCount = 48` peds shooting each other continuously) becomes a wanted-level generator.

### 4D. Fourth vehicle body type (motorbike)

**Riskiest item in Stage 4; schedule last.** `CarEnt.BodyType` is `Seed % 3` (`LTA.Core.cs:462`), and *every* `Body*` array in `Cfg` has exactly **3 elements** (`LTA.Core.cs:219-225`). Changing `% 3` to `% 4` without lengthening all seven arrays produces an `IndexOutOfRangeException` — and it crashes the headless harnesses too, because `PoliceSimTest.cs:41` builds a car via `Systems.MakeCar(...)` and `TrafficSimTest` steps every spawned car through `TrafficStep`, which reads `Cfg.BodyCruiseMult[c.BodyType]` at `LTA.Systems.cs:255`.

Checklist, in order:

1. `Cfg`: add `BodyBike = 3` next to `BodySedan/Hatch/Van` (`LTA.Core.cs:218`) and extend **all seven** arrays — `BodyAccel`, `BodyTopSpeed`, `BodyReverse`, `BodyGrip`, `BodyHandbrakeGrip`, `BodyMass`, `BodyCruiseMult`. A bike wants high accel, low mass, low grip (slides), high cruise mult.
2. `CarEnt.BodyType` (`LTA.Core.cs:462`): `Seed % 3` → `Seed % 4`. This changes the body distribution of **every car in the city**, so ~25% of traffic becomes bikes. Consider `Seed % 10 < 2 ? 3 : Seed % 3` to keep bikes rarer — traffic that is a quarter motorbikes will look wrong.
3. `MeshKit.BuildCar` — the comment at `LTA.Core.cs:214-216` is explicit that mesh silhouette and physics **must** agree ("a car that looks like a van drives like a van"), repeated at `LTA.Systems.cs:33-34`. `BuildCar` currently picks Sedan/Hatch/Van off the same seed. A bike needs a genuinely new builder (two wheels, no cabin, a rider) — the bulk of the work, in `LTA.Mesh3D.cs` (1218 lines). `CarVisual` (`LTA.Core.cs:712-731`) has `Transform[] Wheels` spun by the sync pass; a bike has 2, not 4 — verify every `Wheels` iteration is length-agnostic.
4. `Audio3D.cs:103` — `SetSrc(CarSrc(c.Vis, c.BodyType), …)`, and `CarSrc` does `s.clip = engineClips[Mathf.Clamp(bodyType, 0, 3)]` (`:231`). The clamp already permits index 3, so **verify `engineClips` actually has 4 entries**; if it has 3, the clamp either maps a bike onto the wrong clip or throws. Either way a bike wants a distinct engine note — the clips are hand-baked waveform synthesis in `LTA.Audio3D.cs`, so this means writing a new bake function.
5. `LTA.Player.cs:312-313` — crash impulse uses `Cfg.BodyMass[car.BodyType]` / `[o.BodyType]`. A 0.4-mass bike gets launched by everything. Arguably correct and fun; decide deliberately rather than discovering it.
6. Cop cars are **always Sedan** (`LTA.Core.cs:216-217`) — do not let the bike branch apply to `isCop`. Check `Systems.MakeCar` (`LTA.Systems.cs:22`) and `SpawnWorld` (`:39`).
7. **Verify with all three harnesses.** This is the one change in the entire plan that can hard-crash a headless test, and it does so at the first `TrafficStep` call.

**Alternative worth considering:** make the bike a `Seed % 4 == 3` case that reuses the Hatch mesh scaled down with no roof, rather than a new `MeshKit` builder. It loses silhouette distinctness (violating the documented mesh/physics agreement) but is roughly a fifth of the work and fully reversible. Present both to the user.

---

## 8. Cross-stage risk register

| # | Risk | Stage | Severity | Resolution |
|---|---|---|---|---|
| R1 | `LawStep` keeps real `dt`; a pause resolves an arrest or decays wanted | 1 | High | §2.3(a) — pass `simDt`; test §5.1 item 2 |
| R2 | Mouse click-through discharges the weapon on Resume | 1 | Medium | §2.2(i) — `IsPointerOverGameObject` + swallow frame |
| R3 | `KillPlayer` called from `DamageCar` clears `d.Cops` during `LawStep`'s iteration | 1 | Crash | §1B — trigger only from `Game.cs:693`, after the sim block |
| R4 | RESTART leaks `Audio3D` static source dictionaries | 1 | Medium | §1E — add `Audio3D.Reset()`; or defer RESTART |
| R5 | Start-overlay text collides with the Start button | 1 | Cosmetic | §1C — first 5 lines only; screenshot check |
| R6 | Debug panel created as a scene root is destroyed by `RecoverFromDomainReload` | 2 | Certain if overlooked | §4.1 — `gameObject.AddComponent<DebugPanel>()` |
| R7 | `CaptureTo` called mid-frame reads an incomplete backbuffer | 2 | Low | §4.3 — `WaitForEndOfFrame` coroutine |
| R8 | `Cfg.NightTheme` is `const`, so the day/night slider does nothing | 2 | Certain if overlooked | §4.3 — test `TunDayOverride` before the ternary |
| R9 | Tuning written into `Cfg` arrays leaks into the headless harnesses | 2 | High (flaky tests) | §4.2 — `GameState` multipliers, never `Cfg` writes |
| R10 | A `Tun*` field missing its initializer zeroes all acceleration | 2/4 | High, but loud | §5.3 — initializers + comment |
| R11 | `Score` becomes spendable and destroys the leaderboard meaning | 3 | High (design) | §6.2 question 1 — recommend a separate `Cash` |
| R12 | Persisted owned-car identity references a dead `CarEnt` | 3 | Medium | §6.2 question 5 — persist spec, not identity |
| R13 | Witness reporting keys off `Panic`, so AI traffic and gang wars generate wanted | 4 | High | §4C — new `WitnessT` flag, civilians only |
| R14 | `Weather` gaining a third state breaks `city.Sync`'s `bool` parameter | 4 | Medium | §4B — widen the parameter, rewrite `WeatherStep` as a table |
| R15 | `Seed % 4` indexes 3-element `Body*` arrays → `IndexOutOfRangeException`, harnesses too | 4 | Crash | §4D — extend all seven arrays before changing the modulus |
| R16 | No git history for `unity/`; a bad multi-file edit is unrecoverable | all | High | §0.2 — filesystem snapshot before Stage 1 |

---

## 9. Suggested sequencing

```
snapshot (§0.2)
  └─ Stage 1A  GameState fields                       [~1h,  zero risk]
     Stage 1B  KillPlayer + Wasted countdown          [~3h,  fixes in-car death]
     Stage 1D  AudioListener.volume + settings store  [~2h,  independent of 1B/1C]
     Stage 1C  pause/settings/controls UI             [~1d,  needs §2 gating]
     Stage 1E  RESTART                                [~3h,  do last, optional]
     ── run §5.1 + §5.2 ──
  └─ Stage 2   DebugPanel + Tun* read sites           [~1.5d]
     ── run §5.2; the panel now makes Stages 3-4 tunable ──
  └─ §6.2 answered by the user
     Stage 3   Cash + garage                          [~4d]
  └─ Stage 4C  witnesses  →  4B fog  →  4A chains  →  4D motorbike
```

Stage 1B and 1D are independent and can be built in either order. Stage 2 should not be deferred past Stage 1 — it is what makes Stages 3 and 4 cheap to tune, and §4.2's `Tun*` fields are the same plumbing Stage 3's upgrades need.
