# Local Theft Auto — Realism Implementation Plan

Scope: all four pillars the user asked for — **visual/lighting, driving physics,
world/AI, audio** — pushed toward a heavier, more cinematic look even at some
cost to performance and to the current "retro homage" vibe.

## Progress
- **Phase 1 ✅** Post FX (motion blur, CA, film grain, DoF-switch), day/night,
  wet-road material swap, procedural gradient skybox.
- **Phase 2 ✅** Reflection-vector sheen in `LTA-Lit.shader`, player-headlight
  shadows + nearest-2-lamp soft shadows (`CityRenderer.StepLampLights`).
- **Phase 3 ✅** Per-body-type stats (seed-derived, mesh+physics agree),
  body roll/pitch (body sub-mesh only), grass grip + eager skids, mass-aware
  crash impulses + damage tint, steering falloff above 200.
- **Phase 4 ✅** Positional audio: `LTA.Audio3D.cs` (per-car engines, per-cop
  sirens, doppler 0.6, firefight gunfire from spark particles, footsteps,
  tire screech, ambient bed), explicit `AudioListener` on the camera,
  `GameAudio` slimmed to synth helpers + 2D UI one-shots.
- **Phase 5 ✅** Stateless traffic lights (`TrafficLights.Phase`, per-block
  hash-offset cycle), live emissive lens tinting in `CityRenderer`, AI red-light
  stop gate in `TrafficStep` (player exempt), verified by new `TrafficSimTest`.
- **Phase 6 ✅** Near-miss panic (any moving car, distance/speed-scaled, not
  just the player's), crowd-scare propagation between peds, walk-cycle
  variety (per-ped `StrideMult`, bob + torso sway), and a real bug fix:
  `SyncPeds`'s alive branch never set `Root.transform.position` — walking
  peds were visually frozen at spawn. Extended `GangSimTest` with a bounded
  panic-event assertion (phantom fast cars, since the headless sim has no
  player).
- **Phase 7 ✅** Road-following pursuit (cops share `TrafficStep`'s lane-snap
  math, greedy-turn-toward-player heuristic at intersections instead of the
  old wall-cutting `Atan2` seek), roadblocks + spike strips at Wanted≥3
  (handling/speed penalty, not damage), cop-vs-player ramming (new — cops and
  the player were previously unable to physically collide at all), and an
  arrest-beat camera cut (slow low orbit) replacing the frozen chase-cam
  during BUSTED. New `Assets/Editor/PoliceSimTest.cs` (decoy car driven by
  real `TrafficStep` AI, chased by real `CopStep`) — the single riskiest item
  in the plan, shipped with its own regression test.
- **Phase 8 ✅** Tire-spray splash particles on wet roads (new
  `ParticleEnt.Splash`, same pool/step shape as exhaust puffs), heavier and
  per-storm-variable rain density (streak count/length/opacity all scale off
  one `rainIntensity` rolled per rain event, not per frame — plus a matching
  variable grip penalty), full integration pass re-running all three headless
  sim tests AND a real `BuildGame.Build` player build.

**All 8 phases complete.** Every phase re-verified together after Phase 8:
`GangSimTest` PASS, `TrafficSimTest` PASS, `PoliceSimTest` PASS, and a full
StandaloneOSX player build succeeded (113.9MB, ~12s). Pixel/manual feel
(lighting, audio mix, camera cuts, rain look) still requires the user's own
display — the headless tests catch logic regressions, not aesthetics.

---

# Phases 9–13 — Material response (2026-09-23)

A second realism wave, added after the eight above. Different target: phases
1–8 were mostly **post-processing and content**, and that seam is now mined
out — `SetupPostFx` already runs ACES, bloom, colour grading, white balance,
vignette, motion blur, chromatic aberration, film grain and optional DoF, and
there is nothing left worth adding to it. What remained untouched was the
**material response** — how surfaces answer light in the first place.

Same constraints as before: all procedural, zero binary assets, no changes to
`ProjectSettings/`, `Packages/` or `Assets/Settings/LTA-URP*`.

## Status

- **Phase 9 ✅** Texture filtering parity — mip chains, bilinear and aniso 8 on
  the four city bakes; car body texture raised from aniso 3 to 8.
- **Phase 10 ✅** GGX + Smith + Schlick Fresnel replacing Blinn-Phong, plus a
  `_Metallic` property; car paint is the only non-zero user (0.25).
- **Phase 11 ✅** Procedural height fields for the wall and shopfront bakes,
  applied by derivative bump mapping (no tangents needed).
- **Phase 12 ✅** One realtime reflection probe, face-time-sliced, blended into
  the shader through a `_LtaReflBlend` global with a hard kill switch.
- **Phase 13a ✅** Airborne headlight shafts, opacity driven by rain intensity.
- **Phase 13b ⛔ NOT DONE** — shadow distance. Requires editing the URP asset;
  out of scope until explicitly approved. See below.

**Verification status: incomplete — see §Verification. The C# compiles clean,
but nothing here has been run, and the shader has never been compiled.**

## Phase 9 — Texture filtering parity

The city's four bake functions built textures with `mipChain: false` and
`FilterMode.Point`, while `LTA.Mesh3D.cs` had already moved the car body
texture to mips + bilinear + aniso 3. That inconsistency was the loudest
artefact left in the frame: an 8×8 window grid tiled up a 1400-unit tower,
point-sampled with no mips, sparkles violently at distance.

Changed, all to `mipChain: true` / `Bilinear` / `anisoLevel = 8` /
`Apply(true, true)`:

| Site | Texture |
|---|---|
| `LTA.CityRenderer.cs` `GetGroundTex` | 576² per-block ground |
| `LTA.CityRenderer.cs` `GetRoofTex` | 240² per-block roof |
| `LTA.CityRenderer.cs` `BakeShopTex` | 128² shopfront band |
| `LTA.CityRenderer.cs` `BakeWallTex` | 128² tower wall |
| `LTA.Mesh3D.cs` `CarBodyTex` | aniso 3 → 8 only |

Note the first argument of `Apply` is `updateMipmaps` — it has to flip to
`true` as well, or the chain is allocated and left empty. Cost is ~33% more
texture memory per cached block.

## Phase 10 — GGX, Fresnel and metals

`LTA-Lit.shader` used `pow(saturate(dot(N,h)), _Gloss*_Gloss*190+2)` for both
the main light and every additional light. Replaced with `LtaSpecGGX()`:
Trowbridge-Reitz D, Filament's fast correlated Smith visibility, Schlick F.

The Fresnel term is the point of the exercise, not the lobe shape. The old
model had no grazing-angle response at all, which is why wet asphalt and glass
never read as wet asphalt or glass. The fake sky sheen is now weighted by a
Fresnel factor rather than `_Gloss²`, so it is weakest head-on and strongest at
the silhouette — the way a real reflection behaves.

New `_Metallic` property: F0 lerps from 0.04 to albedo, and the diffuse lobe is
scaled by `(1 - _Metallic)`. Only `MeshKit.CarPaint` sets it (0.25), so a red
car now throws a red highlight under a street lamp instead of a white one.

**Expected follow-up:** GGX is energy-normalised and the old lobe was not, so
overall brightness will have shifted. `SetupPostFx`'s
`grade.postExposure.value = 1.5f` exists precisely because ACES crushed this
night scene once already; budget a rebalancing pass once someone can see it.

## Phase 11 — Height fields and derivative bump mapping

Every surface was albedo-only, so concrete and glass responded to light
identically. Added `BakeWallHeight()` and `BakeShopHeight()` — same grid, same
cell size, same feature coordinates as their albedo counterparts — sampled as
`_BumpMap` and applied with `LtaBumpNormal()`.

Two decisions worth keeping:

1. **Derivative bump, not tangent-space normal mapping.** `MB.Build()` writes
   positions, colours, UVs, triangles, normals and bounds — and no tangents.
   Mikkelsen's surface-gradient method needs only the world position and the
   height sample, both already available.
2. **Explicit height, not albedo luminance.** The bright texels in the wall
   texture are the *lit windows*, so a luminance-derived height would emboss
   lit windows and leave dark ones flat — relief varying by whether someone is
   home. The masonry is modelled deliberately instead.

Defaults are `"black"` and `_BumpScale = 0`, so any material that does not opt
in is bit-identical to before. Height textures are built linear
(`new Texture2D(..., true, true)`) because they are data, not colour.

## Phase 12 — Realtime reflection probe

The Phase 2 sheen was, by its own comment, a "cheap stand-in for a reflection
probe". This adds the real thing: one `ReflectionProbe`, `Realtime` +
`ViaScripting` + `IndividualFaces`, 128px, moved to the player every frame by
`GameLoop.StepReflectionProbe` and re-rendered every 0.5s.

The shader samples `unity_SpecCube0` at a roughness-derived mip and lerps from
the hemisphere fake toward it by the `_LtaReflBlend` global. The blend ramps in
with `MoveTowards` rather than snapping, because the cube is blank until one
render completes and a hard cut is a visible pop.

**This is the most expensive item in either realism wave** — a probe render
draws the scene six more times, and time slicing spreads that cost rather than
removing it. `Cfg.EnableReflectionProbe = false` drops the whole feature and
the shader falls straight back to the Phase 2 fake. Cut this first.

## Phase 13a — Airborne light shafts

The existing headlight cone sprite lies flat on the road: a pool, not a beam.
Added two cone sprites crossed at 90° about the beam axis (45°/135°, so neither
is coplanar with the road pool), children of `v.Lights` so the existing
parked/wrecked gating switches them off for free.

Alpha-blended rather than additive, deliberately: additive needs a material on
a shader outside `Resources/`, and shader stripping would drop it from a player
build. `SirenGlow` already establishes low-alpha sprites as this project's way
of faking light, and Bloom does the rest.

Opacity scales off the same per-storm `rainIntensity` the drop count and grip
penalty use — barely visible on a clear night, obvious in a downpour, because
what a beam actually lights is water in the air.

## Phase 13b — NOT DONE

`m_ShadowDistance` is 1100 while towers reach 1400, so tower shadows are culled
before they land. Fixing it means editing `Assets/Settings/LTA-URP.asset`, which
§0.3 of `PLAN-gameplay-next.md` and this project's standing rules both fence
off. When approved, the change belongs in `Assets/Editor/SetupURPAssets.cs`
(which generates both pipeline assets via `SerializedObject`) and that script
gets re-run — never hand-edited YAML.

## Rejected

- **TAA** — no per-object motion vectors. `SetupPostFx` picks
  `MotionBlurMode.CameraOnly` for that exact reason; TAA would smear every
  moving car.
- **Screen-space reflections** — not available in URP 17 without a custom render
  pass. Phase 12 gets most of the benefit for a fraction of the work.
- **Authored PBR texture sets** — breaks the zero-binary-assets constraint the
  whole codebase is built on, and `REALISM-PLAN.md`'s "honest ceiling" section
  is right that this is where photoreal actually lives.

## Verification — INCOMPLETE

| Check | Result |
|---|---|
| Snapshot before editing | ✅ `.pixis/scratch/LTA-Assets-snapshot-20260923` |
| C# compile (`.pixis/scratch/compile-check.sh`) | ✅ clean; one pre-existing `CS0162` at `LTA.Game.cs:378` |
| **Shader compile** | ⛔ **never run** |
| `BuildGame.Build` | ⛔ **never run** |
| `GangSimTest` / `TrafficSimTest` / `PoliceSimTest` | ⛔ **never run** |
| `-lta-shot` before/after stills | ⛔ **never captured** |

Cause: the Unity Editor on this machine has no valid licence. Batch mode exits
198 with `No valid Unity Editor license found` and
`'com.unity.editor.headless' was not found` before it reaches any
`-executeMethod`. Nothing here is a judgement that the code is correct — it is
a statement that it has not been checked.

**Highest-risk unverified items, in order:**

1. **The shader has never been compiled.** Phases 10–12 rewrote the lighting
   maths and added two new sampler lookups. A single HLSL error means every
   surface in the game renders magenta.
2. **Bump inversion.** If the surface-gradient sign is wrong, all relief reads
   inside-out — the classic failure of this technique.
3. **Exposure after GGX.** See Phase 10; the night grade was tuned against the
   old non-normalised lobe.
4. **Probe cost.** Unmeasured. `Cfg.EnableReflectionProbe = false` is the exit.

Once a licence is available, the order is: `BuildGame.Build` (catches the
shader), then the three harnesses (catch recompile damage — none of this
touches sim state, so any movement there means something went wrong), then
`-lta-shot` stills for items 2 and 3.



Context that shapes this plan:
- `REALISM-PLAN.md` (already in the repo) shows Phases 1–3 of an *earlier*
  realism pass are done: URP + Forward+, a real lit shader with normals, a
  real directional sun with shadows, SSAO, ACES tonemap, bloom, color grading,
  vignette. We build on top of that, not from scratch.
- Everything is procedural, zero binary assets — no new art pipeline, only
  code/shader changes, following the codebase's existing conventions
  (`LTA.<Area>.cs` files, `Cfg` constants, static system classes).
- The simulation (`GameData`/`Cfg` gameplay constants/`Systems.*`/`PlayerSys`)
  is currently a byte-for-byte port of `marketing/game.js`. Physics/AI changes
  below intentionally break that parity — expected, per the user's direction —
  but each such change gets called out in comments the way the codebase
  already documents its deliberate deviations (e.g. the BUSTED-freeze fix).
- Verification tools that already exist and that this plan reuses:
  `Assets/Editor/GangSimTest.cs` (headless ped/gang regression),
  `Assets/Editor/PlayGame.cs` (manual feel-testing), `Assets/Editor/BuildGame.cs`
  (compile/build safety net), and the `-lta-shot=/path.bmp` flag (headless
  screenshot for visual verification without a human watching a live window).

## Build order

Ordered by impact-for-risk and by dependency (car-type variance before body
roll, wet-road hook before puddles, traffic lights before road-following
police). Each phase has its own acceptance check so a regression is caught
before the next phase builds on it.

| Phase | Theme | Risk |
|---|---|---|
| 1 | Post FX + day/night + wet-road shader hook + procedural sky | Low |
| 2 | Car-paint reflection sheen + near-lamp/headlight shadows | Medium |
| 3 | Driving physics: per-body-type stats, body roll/suspension, surface grip, richer crashes, steering falloff | Medium-High |
| 4 | Positional 3D audio, doppler, per-vehicle engines, ambient bed, surface sounds | Medium |
| 5 | Traffic lights + right-of-way | High |
| 6 | Pedestrian awareness (near-miss, crowd-scare) + walk-cycle variety | Medium |
| 7 | Police realism: road-following pursuit, roadblocks, ramming, arrest beat | High |
| 8 | Puddles/splash particles, heavier rain, final integration pass | Low-Medium |

---

## Phase 1 — Visual polish (low risk)

1. **Day/night**: `Cfg.NightTheme` (`LTA.Core.cs`) is currently locked `true`
   (permanent "just after dusk"). A/B it: temporarily flip to `false`,
   `-lta-shot` a few seeded times of day, compare against the current locked
   night look, then decide with the user which becomes default (the existing
   emissive/window-glow tuning was built around night, so day may need a
   small touch-up pass — flag this rather than silently rebalancing).
2. **Post FX additions** in `GameLoop.SetupPostFx()` (`LTA.Game.cs`): add
   `MotionBlur` (camera mode only, modest intensity — object motion blur
   would need motion vectors we don't have), `ChromaticAberration` (subtle),
   `FilmGrain` (low). `DepthOfField` is optional/expensive — gate it behind a
   new `Cfg.EnableDoF` so it's the first thing to cut if perf suffers.
3. **Wet-road reflectivity**: give ground materials a second "wet" variant
   (higher `_Gloss`/`_SpecStrength`, slightly darker albedo) and swap
   `sharedMaterial` on visible ground quads in `CityRenderer.Sync` when
   `GameData.State.Weather == Weather.Rain` — no shader edits needed, just a
   second cached material per ground texture.
4. **Procedural sky**: new `Assets/Resources/LTA-Sky.shader` +
   `Assets/Scripts/LTA.Sky.cs` — a cheap gradient skybox (horizon→zenith,
   soft sun/moon disc from the sun's existing transform) replacing the flat
   `CameraClearFlags.SolidColor`, fed by the same `sky`/`fog` colors
   `UpdateWorldFX` already computes.

**Acceptance**: `-lta-shot` shows rolled-off highlights with visible bloom,
an actual sky gradient instead of a flat color, glossy dark roads only while
raining, and blur/grain visible during the shot routine's driving segment.
`GangSimTest` and `BuildGame.Build` still pass.

## Phase 2 — Reflection & shadow polish (medium risk)

1. **Car paint sheen**: cheapest option — no reflection probe, no cubemap.
   Add a reflection-vector term to `LTA-Lit.shader` that reuses the existing
   `_LtaAmbSky`/`_LtaAmbGround` hemisphere lerp (lerp by reflected-Y instead
   of normal-Y), weighted by `_Gloss`. Reads as a moving sky highlight on
   paint/glass with zero new textures and no per-frame camera renders.
2. **Near-player real-time shadows**: lamp and headlight point/spot lights
   are all `LightShadows.None` today (hundreds of them, by design). Add a
   tight exception in `CityRenderer.StepLampLights`: only the 1–2 lamps
   nearest the player get `Soft` shadows (cleared when a different lamp
   becomes nearest), and the player's own two headlights get `Hard` shadows
   (O(1), never more than one player car). Must be profiled — shadowed
   lights are the most expensive light type in URP; drop this item first if
   frame time regresses.

**Acceptance**: visible moving sheen on car paint at night; the lamp directly
overhead and the player's headlights cast a soft contact shadow; frame time
recorded and compared against a Phase-1 baseline.

## Phase 3 — Driving physics (medium-high risk, biggest feel change)

1. **Per-body-type stats**: `MeshKit.BuildCar` already silhouettes cars as
   Sedan/Hatch/Van (`seed % 3`) purely visually. Add a matching
   `CarBodyType` on `CarEnt`, derived from the *same* seed so mesh and
   physics always agree, with per-type `Cfg` constants for accel/top
   speed/grip (van: slower accel, higher top speed less grip; hatch:
   quicker, lower top speed). `PlayerSys.Step`'s hardcoded 250/280/-95/8/2.2
   constants become per-car lookups. Traffic cruise speed gets the same
   multiplier so it's consistent in AI traffic too.
2. **Body roll / suspension** (pure visual, zero sim risk): track
   previous-frame velocity per `CarVisual`, roll the **body sub-mesh only**
   (not the root, so wheels stay grounded) a few degrees under lateral
   acceleration, pitch it slightly under heavy accel/brake. Isolated to
   `SyncCars` — cannot desync from the JS sim, cannot break `GangSimTest`.
3. **Surface-based grip**: extend the existing rain-only `WeatherGrip`
   multiply in `PlayerSys.Step` with a terrain lookup (`CityMap.TypeAtPx`) —
   full grip on road/sidewalk, reduced on `Cfg.Park` grass. Wire the existing
   skid-mark trigger to fire more readily at low effective grip (feeds
   Phase 4's tire-screech audio).
4. **Richer crashes**: factor relative mass (from item 1) into the existing
   car-car impulse/knockback math so a van hitting a hatch sends it further
   and takes less damage itself; add an intermediate "damaged" paint tint
   keyed off health fraction instead of only the binary wrecked/not state.
5. **Speed-sensitive steering falloff**: taper steering authority above
   ~200 units/s so high-speed chases feel heavier instead of snap-turny.

**Acceptance**: no automated test for "feel" — gate this on a manual
`PlayGame` checklist: steal each body type back-to-back and confirm they're
distinguishable; corner/brake and see body lean/dive; drive onto grass and
feel looser handling with skid/screech; ram two different body types and see
mass matter; hold full lock at top speed and feel the falloff. `GangSimTest`
re-run as a safety check (unaffected, but confirms nothing broke on
recompile).

## Phase 4 — Positional audio (medium risk, high atmosphere payoff)

1. **Per-entity 3D audio**: give every `CarVisual` (traffic, cops, player) a
   pooled `AudioSource` (spatial blend 1, log rolloff, doppler on), attached
   at `MeshKit.BuildCar` time. Control cost via Unity's own voice-priority
   virtualization (low priority for distant traffic) plus a simple
   audible-radius gate in the existing per-frame `SyncCars`/`SyncCops` loops.
   Convert the single global siren/gunshot/crash sources to positional
   (`AudioSource.PlayClipAtPoint` for one-shots, per-cop sources for sirens).
   Add an explicit `AudioListener` on the main camera if one isn't already
   implicitly present.
2. **Doppler**: mostly free once (1) exists — Unity computes it from
   transform movement automatically; just tune `dopplerLevel` (~0.6, not
   higher — too cartoonish).
3. **Per-vehicle engine tones**: bake 3–4 engine clip variants (sedan/hatch/
   van/cop) parameterized off the existing `BakeEngine` synthesis, matched to
   the same body-type index as the mesh/physics so a van always sounds like
   a van. Currently only the *player's* engine has any sound — this closes
   the biggest audio gap (NPC traffic is silent today).
4. **Ambient city bed**: one more low, filtered-noise loop (same synthesis
   technique as the existing rain bake) always playing at low volume,
   crossfaded down when it's raining hard.
5. **Surface-based tire/footstep sounds**: tire screech tied to the
   low-grip skid trigger from Phase 3.3; footsteps (concrete vs grass) tied
   to the existing on-foot walk-cycle phase and `CityMap.TypeAtPx`.

**Acceptance**: manual `PlayGame` with stereo audio — sound direction/
distance reads correctly, passing traffic has audible engine variety, a
firefight sounds directionally located, there's a constant subtle ambience,
tire/footstep audio responds to surface. No automated audio test proposed.

## Phase 5 — Traffic lights & right-of-way (high risk)

1. Add a **stateless, hash-derived** traffic-light phase function
   (per-intersection phase offset via the existing `JSRng.BlockHash`, plus
   the game clock) — consistent with the codebase's "recompute, don't store"
   style, no new persistent state needed.
2. Wire it into `Systems.TrafficStep`'s intersection-decision block: a red
   light gates the same braking path `ProbeAhead` already uses, so red-light
   queuing reuses existing car-following behavior.
3. Make `BuildTrafficLight` (currently a static lit-lens picked once at
   spawn) live-updatable for nearby intersections only, mirroring the
   existing distance-culled lamp-light update pattern.
4. Player is **not** forced to stop at red — this is traffic-AI-only, matching
   the "cars stop on red" framing (not a player-control restriction).

**New file**: `Assets/Editor/TrafficSimTest.cs` — a headless regression test
(same spirit as `GangSimTest`) that steps traffic for simulated minutes with
no rendering and asserts no permanent gridlock, cars actually stop on red and
release on green. This is the riskiest single item so far — road-AI deadlocks
are the classic failure mode — hence a dedicated headless test before relying
on manual play.

**Acceptance**: `TrafficSimTest` passes; manual observation confirms cars
visibly stop/go with the lens color at multiple intersections; `GangSimTest`
still passes unmodified.

## Phase 6 — Pedestrian awareness & animation (medium risk)

1. Extend the panic trigger beyond ">110 speed within 110 units of the
   player's own car": react to *any* car (including traffic) whose predicted
   path passes close, scaled by how close the near-miss actually was.
2. Local crowd-scare propagation: a panicking ped has a chance to panic
   nearby peds too.
3. Walk-cycle variety: small vertical bob/torso sway added to
   `AnimatePed`/`SyncPeds`, plus a per-ped stride-rate multiplier so a crowd
   doesn't move in visual lockstep.

Extend `GangSimTest` with a bounded panic-event assertion (catches both
"broke panic" and "everyone panics forever").

**Acceptance**: extended `GangSimTest` passes; a near-miss (not just a fast
direct hit) visibly triggers a flinch; a crowd no longer reads as clones.

## Phase 7 — Police realism (high risk, biggest AI rewrite)

1. **Road-following pursuit**: give cops the same lane-snapping `TrafficStep`
   already gives ordinary traffic, layered with a cheap greedy heuristic at
   each intersection (pick the open turn whose bearing best matches the
   player's direction — no real pathfinding, consistent with the existing
   gang AI's deliberately-simple style) instead of today's straight-line
   `Atan2` seek that ignores roads and buildings.
2. **Roadblocks/spike strips** at Wanted ≥ 3: spawn 1–2 stationary cop cars +
   a spike strip ahead of the player's predicted path (rate-limited, reusing
   the existing cop-spawn throttle pattern); driving over the strip forces a
   speed/handling penalty rather than damage.
3. **Ramming**: important architecture note surfaced during design — cops
   (`CopEnt`) and player/traffic (`CarEnt`) are separate lists today, so cops
   *cannot* currently physically collide with the player at all (only
   ranged chip damage). Add a small cop-vs-player collision check inside
   `LawStep`, mirroring the existing car-car impulse logic, gated to high
   wanted levels with a cooldown so it reads as occasional deliberate
   contact, not constant unfair ramming.
4. **Arrest beat**: keep the existing bust/freeze/teleport logic exactly as
   is (it already has a deliberate bug-fix vs. the JS original — don't touch
   that), but dress up the frozen window with a short camera cut/converging
   cop visuals instead of just holding the normal chase-cam framing.

**New file**: `Assets/Editor/PoliceSimTest.cs` — headless test asserting cops
make measurable progress closing distance on a scripted player path and don't
get permanently stuck. This is the single riskiest item in the whole plan
(a chase that doesn't chase properly is immediately noticeable) — ships with
its own regression test before manual play is relied on.

**Acceptance**: `PoliceSimTest` passes; manual play shows cops following
roads during a chase, a roadblock appearing ahead at high wanted with a real
mechanical effect, occasional-not-constant ramming, and a more cinematic
arrest.

## Phase 8 — Final polish pass (low-medium risk)

1. Puddle sheen + splash particles building on Phase 1's wet-ground material
   work and the existing particle pool pattern.
2. Heavier/variable rain density (`RainDropCount`, streak length/opacity).
3. Full integration pass: re-run `GangSimTest`, `TrafficSimTest`,
   `PoliceSimTest`, `BuildGame.Build`, and a manual playtest checklist
   covering day/night, rain, all car types on all surfaces, a full
   wanted-level chase through a roadblock, a gang firefight, and an on-foot
   audio walk. Final perf pass against the Phase-1 baseline; if degraded,
   cut in this order: DoF → near-lamp shadows → motion blur → NPC engine
   audio voice budget → (last resort) SSAO/shadow distance, since those
   predate this plan and are load-bearing for the existing look.

---

## New files this plan creates
- `Assets/Resources/LTA-Sky.shader`, `Assets/Scripts/LTA.Sky.cs` (Phase 1)
- `Assets/Scripts/LTA.Audio3D.cs` (Phase 4)
- `Assets/Editor/TrafficSimTest.cs` (Phase 5)
- `Assets/Editor/PoliceSimTest.cs` (Phase 7)

## Performance guardrail
Target is "runs fine on a low-mid Mac." Every expensive addition above states
its own cost-control (voice virtualization/audible-radius gating for audio,
distance-culled shadow exceptions for lights, camera-only motion blur, an
`EnableDoF` kill switch). Record a frame-time baseline after Phase 1 and
re-check it after Phases 2, 3, and 7 — the three phases most likely to move it.
