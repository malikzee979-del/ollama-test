# Local Theft Auto — Unity port

A Unity port of the canvas game engine in
[`marketing/game.js`](../../marketing/game.js), now with a **Vice-City-style
third-person 3D renderer**: a chase camera behind the player/car, extruded
buildings with lit windows, 3D cars, pedestrians, streetlights and trees —
borrow cars, drift with the handbrake, grab amber packages, run delivery
jobs, outrun the local police.

The simulation still runs in the original 2D space with the **same hash
functions and 10×10 block rules** as the JS version (`JSRng` replays the JS
double math exactly), but the two engines have **deliberately diverged** in
places — world size (144 vs 96 tiles), weapon tone (lethal vs non-lethal),
mission sets, wanted escalation. The canonical divergence table lives in
[PARITY.md](PARITY.md); update it whenever either side changes a shared
constant or hashing rule. Only the presentation is 3D. All textures and
meshes are generated at runtime; audio uses the small real clips under
`Assets/Resources/Audio/` (attribution in [`Assets/Audio/CREDITS.md`](Assets/Audio/CREDITS.md)).

## Opening the project

1. Open **Unity Hub → Projects → Open** and select this folder
   (`unity/LocalTheftAuto`).
2. The project targets **Unity 6** (`6000.5.9f1` per
   `ProjectSettings/ProjectVersion.txt`). If you have a different editor
   installed, the Hub will offer to install that version or open with the
   one you have — any Unity 6 (or 2022.3) editor works.
3. Press **Play**. The shipped scene is intentionally empty — the whole
   game constructs itself at startup via `[RuntimeInitializeOnLoadMethod]`
   in `Assets/Scripts/LTA.Game.cs` (same spirit as the JS original's single
   IIFE).

## Controls

| Key | Action |
| --- | --- |
| `W A S D` / arrows | walk & drive |
| `E` | enter / exit a car |
| `Space` | handbrake (drift) |
| `F` / left click | fire (on foot, once armed; the SMG fires held) |
| `Q` | swap weapon (on foot, once you own more than one) |
| `Esc` / `P` | pause menu — settings, controls, restart, quit (gamepad: `Start` / `Back`) |

`Esc` freezes the city clock — missions, weather and the heat all wait — and
opens a pause menu over the still-lit street: master-volume settings (kept in
their own PlayerPrefs key, so they survive runs and even the start screen),
the full controls list, a restart that drops the save and respawns the whole
procedural city fresh, and quit. Dying now gets the same beat as an arrest: a
red **WASTED** overlay with its own low sting and slow orbit camera, then you
wake back on the home corner with the wanted level cleared — minus 20% of
your score and a handful of rounds — whether you went down on foot or behind
the wheel of a wreck.

Amber packages are +100. Gray crates with a red cross are ammo — the first
one also grants the pistol; teal crates grant the **SMG** (full-auto, low
damage per round), orange crates the **shotgun** (six pellets in a wide
cone, brutal up close). All guns share one ammo pool. Running over locals,
shooting, or stealing cars in front of witnesses raises your wanted stars;
at 3+ stars nearby cops return fire. The police forgive, eventually — or
thin the pursuit by shooting a cruiser down (a fresh one still spawns while
stars remain).

The two **gangs** (Reds and Blues) hold corners and fight each other — and
now they fight *you*: shoot or run one down and nearby crew members hold a
**vendetta**, hunting and shooting back for a while. Slain gangsters are
+25, often drop loose ammo, and a player dropped — on foot or in a car —
gets the WASTED screen and wakes back on the home corner. Every so often a **job** appears, one of four kinds:
**Delivery** (reach the pulsing blue marker before the countdown ends),
**Rampage** (wreck a handful of cars in time), **Steal** (a specific car is
marked cyan — steal that one and drive it to the drop-off), or **Gang War**
(drop N of a named crew before the clock runs out — they shoot back).
Reward scales with the job. Your best score is persisted (PlayerPrefs) and
shown on the start screen and in the HUD; position, health, arsenal, ammo
and score also autosave every few seconds and on quit, so closing mid-drive
picks back up close to where you left off (wanted level always resets to 0
on load).

The city is **night-locked**: `Cfg.NightTheme = true` skips the day half of the
480-second cycle entirely, so the key light behaves as a moon and the windows
and street lamps do most of the visible work. The full day/night machinery is
still there and still driven by the game clock — flip `Cfg.NightTheme` to
`false` to get the sweeping cycle back, or pin `GameState.TunDayOverride` to a
0..1 value at runtime to inspect any time of day without editing `Cfg`. Weather
does cycle: **clear alternates with rain** (looser tire grip, fog, rain
streaks, ambient patter). Buildings vary by **district** — taller/cooler
Downtown blocks, warmer Residential rows, flat-roofed Industrial blocks —
layered on top of the same JS-exact tile hashing, so the city's
road/building layout itself never changes.

## Code map

| File | Responsibility | JS counterpart |
| --- | --- | --- |
| `LTA.Core.cs` | constants, JS-exact hashing, tile map queries, game state, entity data | `blockHash`, `hash2`, `tileType`, `circleHitsBuilding`, globals |
| `LTA.Systems.cs` | spawning, traffic AI, pedestrians, police/wanted, pickups, particles | `spawnWorld`, `trafficStep`, `pedStep`, `copStep`, `lawStep`, `pickupStep`, `particlesStep` |
| `LTA.Player.cs` | on-foot + car physics (drift, damage, collisions), enter/exit | `playerStep`, `tryEnterExit` |
| `LTA.Sprites.cs` | runtime-baked 2D textures (circles, glows, cone, skid, vignette) for overlays/HUD | `drawLights`, effects |
| `LTA.Mesh3D.cs` | 3D mesh kit: face-shaded boxes, car/ped/tree/lamp/marker builders, JS→3D space mapping | — (new) |
| `LTA.CityRenderer.cs` | 3D city: baked ground textures on quads, extruded buildings with window textures + colliders, streetlights, trees | `drawTiles`, `drawBlocks`, `drawStreetProps` |
| `LTA.Hud.cs` | stars, score, speed, damage bar, ticker, BUSTED screen, minimap, start overlay | `drawHUD`, `buildMinimap`, `game.html` overlay |
| `LTA.Game.cs` | bootstrap, main loop, VC-style chase camera (yaw lag, building pull-in), 3D entity sync, visual pools | `frame()` |
| `LTA.Missions.cs` | timed jobs: Delivery, Rampage, Steal, Gang War (new, no JS counterpart) | — |
| `LTA.Audio.cs` | procedurally synthesized engine/siren/pickup/crash/bust/gunshot/rain audio (new) | — |
| `LTA.Audio3D.cs` | positional layer: per-car engine, cop siren, distant gunfire, footsteps, tire screech (new) | — |
| `LTA.Spatial.cs` | uniform spatial hash (`Spatial.Cars` / `Spatial.Peds`) for the proximity queries in `PlayerSys.Step` and the ped/car hit loops (new) | — |
| `LTA.Sky.cs` | procedural gradient skybox, driven from the day/night clock (new) | — |
| `Assets/Resources/LTA-Lit.shader` | **the live shader** — Lambert diffuse + Blinn-Phong specular, shadow caster, hemisphere ambient and the `_LtaDayNight` / `_LtaNightEmission` globals. Loaded by `MeshKit` and `CityRenderer` | — |
| `Assets/Resources/LTA-Sky.shader` | gradient skybox shader, loaded by `SkyKit` | — |
| `Assets/Resources/LTA-Opaque.shader` | legacy unlit vertex-color shader, **no longer loaded by any code** — kept only until it is confirmed unused by a build | — |

On-foot movement is screen-relative (W walks up the screen under the
rotating chase camera); in-car controls are car-relative as always. A dev
flag `-lta-shot=/abs/path.bmp` runs the game, hops into the nearest car,
and writes a screenshot before quitting — used for automated visual checks.

The simulation runs in the original pixel space with **y pointing down**,
exactly like the JS code; conversion to Unity's y-up space happens only
when GameObjects are placed (`P()` / `Rot()` helpers). This keeps every
gameplay constant readable against `marketing/game.js`.

## Deliberate deviations

- **BUSTED no longer freezes forever.** The JS original has a bug: the
  busted countdown lives inside `lawStep()`, but `frame()` stops calling it
  while `busted > 0`, so the BUSTED screen never ends. The port runs the
  countdown every frame while still freezing pursuit during the bust.
- **Minimap player marker** is a 3px dot with a heading pixel instead of a
  rotated canvas triangle — same information.
- **Rendering approximations:** building roofs keep the camera-parallax
  extrusion, wall faces, shadows, AC units and neon, but per-tile speckle
  is baked once per block instead of redrawn each frame; the headlight
  cones and streetlight glows are soft sprites rather than gradient fills.
  All colors and positions follow the JS drawing code.
- **Traffic cars face the way they drive.** In the JS, a car that U-turns
  off a building keeps its old sprite angle until the next intersection;
  the port re-aims the sprite immediately.

## Additions over the JS original

- **Four job types** (`LTA.Missions.cs`): Delivery (original — timed
  drop-off, reward scaled by distance), Rampage (wreck N cars before the
  clock runs out), Steal (a specific marked car must be driven to the
  drop-off), and Gang War (a contract to drop N members of a named crew
  before the clock runs out — they shoot back). HUD countdown + label per
  kind, blue minimap blip, cyan tint on the Steal target, crew-colored
  countdown on Gang War.
- **Three weapon tiers.** Ammo crates (gray, red cross) grant the pistol;
  teal crates the SMG (full-auto while held, cheaper damage, faster
  cooldown); orange crates the shotgun (six pellets spread across a wide
  cone). All share one ammo pool; `Q` swaps between owned guns on foot.
  Each crate kind has its own accent color and lid marking
  (`MeshKit.BuildWeaponPickup`). Civilians still die in one hit; gangsters,
  cops and cars take per-hit damage, and every shot fired is a crime.
- **Gang wars.** The Reds and Blues now matter to the player: attacking a
  gangster (gunfire or run-over) puts a vendetta on you — nearby crew
  members hunt and shoot the player for ~14s, through the existing
  `DamageCar` path (car health in a car, player health on foot). Slain
  gangsters pay +25, often drop loose ammo, and credit a running Gang War
  contract. A player gunned down on foot wakes back on the home corner.
  Covered by a second headless phase in `Assets/Editor/GangSimTest.cs`.
- **Wanted-level escalation:** at 3+ stars, nearby cops return fire —
  chip damage that scales with the wanted level, on top of the existing
  ramming/speed scaling.
- **Collision feedback:** pedestrians hit by a car get a short airborne
  toss along the impact direction instead of an instant squash; car-to-car
  hits now carry an actual velocity impulse, not just a positional
  separation push.
- **Day/night machinery** (a ~8-minute / 480 s clock) and **weather** (clear ↔
  rain, with fog, rain streaks and looser tire grip while it's raining),
  driven from the existing game clock. The day half is currently **switched
  off**: `Cfg.NightTheme = true` pins `dayAmount` to `Cfg.NightDayAmount`
  (0.10) so the city reads as Gotham after dark. The curve is intact and one
  flag away. The tint reaches the city through the `_LtaDayNight` /
  `_LtaAmbSky` / `_LtaAmbGround` / `_LtaNightEmission` globals set by
  `GameLoop.UpdateWorldFX` and read by `LTA-Lit.shader`, so every lit mesh
  picks it up for free; a real directional sun tracks the same clock — held at
  56° elevation as a cool moon while night-locked, with only its azimuth
  drifting — and `RenderSettings.fog` plus the `SkyKit` gradient skybox follow
  it. `GameState.TunDayOverride` lifts the night lock at runtime.
- **Three cosmetic districts** (`CityRenderer.District`): taller/cooler
  Downtown blocks, warmer/shorter Residential rows, flat muted Industrial
  blocks — a hash pair distinct from `BlockHash`, so the JS-exact
  road/building/park layout is untouched; only wall tint, height multiplier
  and roof palette vary.
- **Character pick** on the start screen: choose a skin tone and shirt
  color before driving; applied with a `MaterialPropertyBlock` re-tint, no
  mesh rebuild.
- **Save/load:** position, health, ammo, loadout and score autosave every
  5s and on quit (`PlayerPrefs`, JSON via `SaveData`); wanted level always
  resets to 0 on load so you never resume mid-chase.
- **Camera FOV kick:** field of view widens gently with speed and punches
  wider for an instant on a hard hit, on top of the existing boom-distance
  zoom and building pull-in.
- **Persistent high score** via PlayerPrefs.
- **Audio** (`LTA.Audio.cs`): engine loop whose pitch follows speed, a siren
  wail while cops are active, rain ambience while it's raining, and
  pickup/crash/busted/gunshot one-shots. These are now **real recordings** —
  15 clips in `Assets/Resources/Audio/`, sourced from OpenGameArt and listed
  with author and licence in [`Assets/Audio/CREDITS.md`](Assets/Audio/CREDITS.md)
  (two are CC-BY 3.0, which that file satisfies by attribution).
  `GameAudio.Load(name, bake)` probes `Resources.Load<AudioClip>` first and
  falls back to the original `Bake*` synthesis if a clip is missing, so the
  procedural path still works and a deleted clip only costs a warning.
- **Performance:** the city **streams**. Blocks are built nearest-first inside
  `CityRenderer.BuildRadius` (3000 units) and released past `EvictRadius`
  (3700), with the bake budget spread at 6 blocks on the first frame then 3
  per frame — the old `12 then 2` put twelve 576×576 CPU bakes (~15 MB of
  `SetPixels32`) into one frame and hitched. `BuildRadius` is bounded by
  `RenderSettings.fogEndDistance` (2600, or 1500 while raining), *not* by
  `cam.farClipPlane` (3200): everything past the fog wall is 100% fog colour,
  so geometry there is invisible and not worth the VRAM. `EvictRadius` carries
  the hysteresis — it must exceed `BuildRadius` by more than one block diagonal
  (~679) or a player sitting on the boundary builds and releases the same block
  every frame. Eviction destroys the block's root GameObject subtree, its baked
  ground/roof textures, and the `MeshKit` materials cached against them (in that
  order — releasing the material *after* destroying the texture would leave a
  dictionary entry pointing at a dead texture and magenta ground on rebuild);
  the shared `wallTex`/`shopTex` arrays are deliberately never touched.
  `CompactVisualLists()` prunes the `groundRenderers`, `lampLights` and
  `trafficSignals` lists that eviction leaves dangling. **Honest ceiling:** the
  city is only ~7200 units across while the fog wall sits at 2600, so a large
  fraction of it is inside view distance no matter what — eviction cuts roughly
  40–50% of the old always-resident ~335 MB, it cannot get near zero.
  Sparks/smoke/skids and cop visuals are pooled instead of destroyed; wall
  meshes reuse scratch buffers; the minimap redraws at ~10 Hz instead of every
  frame; SpriteRenderers are cached on entities instead of per-frame
  `GetComponent`.

## Where to take it next

Gameplay logic is data-only (`GameData` + systems), rendering is separate —
so you can keep extending missions, combat, districts or save games without
touching the physics/AI code. Natural starting points:

- Turf economics: holding or clearing a corner could pay a recurring score
  drip or spawn better crates — `PedEnt.Gang` and the spawn clusters in
  `Systems.SpawnWorld` already mark each turf.
- More districts or a distinct waterfront/park district: extend
  `CityRenderer.District` — it's already isolated from `CityMap.TileType`.
- Real art: swap `SpriteKit` bakes for imported sprites; the visual sync in
  `LTA.Game.cs` is the only place GameObjects are managed.
