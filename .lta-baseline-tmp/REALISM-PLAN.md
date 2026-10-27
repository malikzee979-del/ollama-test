# Local Theft Auto — Realism Overhaul Plan

> **SUPERSEDED (2026-09-09).** Phases 1 & 3 of this plan landed: a real
> directional sun with soft shadows (`LTA.Game.cs`), a URP post-FX Volume
> built in code (`SetupPostFx`), and `Assets/Resources/LTA-Lit.shader` all
> exist in the current tree. Treat this document as history, not backlog —
> the live plan is `PLAN-gameplay-next.md` (see its §0.1).

## Why it doesn't look realistic

The problem is not the building shapes. I have been adding geometry detail
(setback tiers, spires, octagonal limbs) inside a renderer that **structurally
cannot produce a realistic image**. Verified in the code:

| # | Finding | Evidence |
|---|---------|----------|
| 1 | **The shader is unlit.** There is no lighting math at all — the fragment shader is `tex2D(_MainTex, uv) * color * dayNightTint`. | [LTA-Opaque.shader](Assets/Resources/LTA-Opaque.shader) |
| 2 | **No mesh has normals.** `MB.Build()` sets vertices, colors, UVs, triangles and bounds — nothing else. `RecalculateNormals` appears nowhere in the project. | [LTA.Mesh3D.cs](Assets/Scripts/LTA.Mesh3D.cs) |
| 3 | **There are no lights in the scene.** `m_Sun: {fileID: 0}`, no `Light` component is ever created in code. | [Main.unity](Assets/Scenes/Main.unity) |
| 4 | **Shadows are explicitly switched off** on every renderer the mesh kit creates. | `ShadowCastingMode.Off`, `receiveShadows = false` in [LTA.Mesh3D.cs:247](Assets/Scripts/LTA.Mesh3D.cs:247) |
| 5 | **"Lighting" is faked as a constant per face.** `Shade(n)` multiplies each face's vertex color by a fixed number derived from its normal direction, baked in at mesh-build time. | `Shade()` in [LTA.Mesh3D.cs](Assets/Scripts/LTA.Mesh3D.cs) |
| 6 | **Textures are hand-baked pixel art.** Walls are 64×64 at `FilterMode.Point`. No normal, roughness, metallic or AO maps exist. | `BakeWallTex` in [LTA.CityRenderer.cs](Assets/Scripts/LTA.CityRenderer.cs) |
| 7 | **No modern render pipeline.** No URP/HDRP, no post-processing package — bare built-in modules only. | [manifest.json](Packages/manifest.json) |
| 8 | **The world is flat.** The simulation is 2-D (x, y in pixels, y down); ground is a plane at height 0. | [LTA.Core.cs](Assets/Scripts/LTA.Core.cs) |

Consequences you can see on screen: nothing casts a shadow, so objects float
instead of sitting on the ground; every surface is a flat block of colour with
no falloff, so form reads as cardboard; there is no specular response, so
nothing looks like glass, metal or wet asphalt; and there is no ambient
occlusion, so no crease, corner or contact point is darkened.

**No amount of extra geometry fixes any of those eight items.** That is why the
last three rounds of work didn't move the needle, and you're right to call it.

## The honest ceiling

Photoreal GTA V / Arkham Knight looks come from *authored art assets* — modelled
and UV-unwrapped buildings, photo-sourced PBR texture sets, rigged and
motion-captured characters. That is an art-production problem, not a coding
problem, and it cannot be reached by procedural code that generates boxes at
runtime.

What is realistically reachable here, in order:

- **"Believable stylised city at night"** — real lighting, shadows, wet
  reflective roads, glowing windows, fog and bloom. Very achievable.
- **"Looks like a real game from 2010"** — the above plus PBR materials, decent
  texture resolution, denser geometry. Achievable with significant work.
- **"Photoreal"** — needs bought or authored 3-D assets. Out of scope for
  procedural generation.

This plan targets the first, then the second.

---

## The fork in the road (decide this first)

Everything below depends on one choice:

### Option A — Stay on built-in, write a lit shader
Keep the current pipeline, replace `LTA/Opaque` with a lit shader that does
real diffuse + specular + shadow receive.

- **Pro:** incremental, low risk, reversible; every existing material call site
  keeps working (materials are created in code from one `Resources.Load`).
- **Con:** no modern post-processing (SSAO, tonemapping, bloom) without the
  legacy Post Processing v2 package; hand-written lighting.

### Option B — Migrate to URP
Add URP, convert the generated materials to `Universal Render Pipeline/Lit`.

- **Pro:** real PBR, shadows, SSAO, bloom, tonemapping, colour grading via a
  Volume — the single biggest visual jump available.
- **Con:** a genuine migration. Every material is code-generated, and the whole
  "bake lighting into vertex colours" model has to be unwound or it will
  double-darken. Real risk of a magenta/black screen mid-way.

**My recommendation: A first, then B.** Phase 1 below is where ~70% of the
perceived realism gain lives, it is cheap, and it is safe. Do it, look at it,
then decide whether B is worth the migration risk.

---

## Phase 1 — Real lighting and shadows (biggest single win)

**Goal:** objects sit in the world, surfaces have falloff, the sun casts shadows.

1. **Generate normals.** In `MB.Build()`, call `RecalculateNormals()` (or write
   the true normal per face while building, which is cheaper and gives crisp
   flat-shaded facets). `QuadMeshXZ` and the hand-built meshes need the same.
2. **Stop baking fake light into vertex colours.** `Shade(n)` currently bakes a
   fixed brightness per face. Once real lighting exists this double-shades.
   Keep vertex colour as pure albedo tint; delete the `Shade()` multiply.
3. **Write `LTA/Lit`** — replace the unlit fragment with Lambert diffuse +
   Blinn-Phong specular, `ShadowCaster` pass, and `LIGHTPROBE`/ambient term.
   Keep `_LtaDayNight` so the existing day/night tint still drives it.
4. **Add a real directional sun** in `GameLoop.Start()`: one `Light`, type
   `Directional`, with `shadows = Soft`. Drive its colour, intensity and
   *angle* from the existing day/night clock in
   [LTA.Game.cs:237](Assets/Scripts/LTA.Game.cs:237) — a sun that moves and
   reddens at dusk is worth more than any geometry change.
5. **Turn shadows back on** — remove the `ShadowCastingMode.Off` /
   `receiveShadows = false` lines in the mesh kit.
6. **Raise shadow quality** in QualitySettings (`shadowDistance` is currently
   15–150 depending on tier; the city needs ~800+ for the tower shadows to land).

**Verify:** stand a car next to a tower at midday and at dusk — the tower
shadow should fall across the road and the car, and rotate over the day cycle.

**Risk:** medium. If step 2 is skipped everything goes muddy; if step 1 is
skipped everything goes flat black.

## Phase 2 — Materials that read as materials

**Goal:** asphalt, glass, concrete and car paint stop looking like the same
substance.

1. **Per-surface material response.** Add `_Smoothness`/`_Metallic` to
   `LTA/Lit` and set them per material: road (wet, high spec), glass (very
   high), concrete (matte), car paint (glossy + slight metallic).
2. **Bump texture resolution and filtering.** Wall textures are 64×64 `Point` —
   raise to 256×256, enable mipmaps, use `Bilinear`/`Trilinear` and anisotropic
   filtering. Point-filtered 64px is a hard realism ceiling.
3. **Generate normal maps from the baked art.** The wall/road bakes already
   know where window recesses, curbs and panel joints are — emit a companion
   normal map from the same generator so those details catch the light instead
   of being painted-on.
4. **Wet road / reflection cue.** The game already has a rain state
   ([LTA.Systems.cs](Assets/Scripts/LTA.Systems.cs)) — drive road smoothness
   and a reflection tint from it so rain visibly changes the surface.

## Phase 3 — Post-processing and atmosphere

**Goal:** the frame stops looking like raw untonemapped output.

*Requires URP (Option B) or the legacy Post Processing v2 package.*

1. **Tonemapping (ACES)** — the single biggest "looks like a real game" switch.
2. **Bloom** — street lights, neon, window lights, the spire warning lights.
3. **SSAO** — contact darkening in every corner, doorway and under every car.
   This does more for "solid, real" than any geometry.
4. **Colour grading LUT** — a cold, desaturated Gotham grade.
5. **Motion blur + subtle vignette/chromatic aberration** at speed.
6. **Height fog** replacing the current linear distance fog — a city with fog
   pooling in the streets and towers rising out of it is the Gotham shot.

## Phase 4 — World and geometry realism

**Goal:** the city stops being a perfect grid of identical lots.

1. **Elevation.** The single biggest "not a board game" change — and the most
   invasive, because the sim is 2-D. A height field would need to feed car
   physics, ped movement and collision. **I would not start here**; do Phases
   1–3 first, and treat this as its own project.
2. **Break the grid.** Every block is currently an identical 10×10 tile cell
   with one 5×5 lot in the middle. Real cities have varied lot sizes, multiple
   buildings per block, alleys, irregular parcels, and roads that aren't all
   the same width. This is a `CityMap`/`TileType` rewrite.
3. **Street-level density.** Realism reads at eye level: kerbs, drains, traffic
   lights, signage, awnings, fire escapes, parked-car variety, litter, puddles,
   power lines. Currently there are only lamps and trees.
4. **Real bridge elevation** — the current river crossing is a flat at-grade
   causeway because the sim is flat; a proper raised deck depends on item 1.

## Phase 5 — Characters and vehicles

**Goal:** stop them reading as jointed toys.

1. **Skinned meshes instead of rigid segments.** Peds are currently a hierarchy
   of rigid prisms rotated at pivots; real deformation needs a skinned mesh
   with a bone rig. This is the correct fix for "looks like Lego" and it is a
   substantial rewrite of `BuildPed`.
2. **Better animation.** One sine-wave leg swing drives everything today. Real
   walk cycles, idles, turn-in-place, entering/exiting cars.
3. **Vehicle detail** — proper wheel wells, suspension travel, working lights,
   reflective glass, interior shells.

---

## Suggested order of work

| Order | Phase | Effort | Visual payoff | Risk |
|-------|-------|--------|---------------|------|
| 1 | Phase 1 — lighting + shadows | Medium | **Very high** | Medium |
| 2 | Phase 3 — tonemap + bloom + SSAO | Medium | **Very high** | Medium (needs pipeline decision) |
| 3 | Phase 2 — materials + textures | Medium | High | Low |
| 4 | Phase 4.2/4.3 — break grid, street detail | High | High | Low |
| 5 | Phase 5 — skinned characters | High | Medium | Medium |
| 6 | Phase 4.1 — elevation | Very high | Medium | **High** |

## Things worth flagging before we start

- **JS parity is already broken.** The core files say every constant is copied
  1:1 from `marketing/game.js` so the port plays identically. Changing `World`
  from 96 to 144 last round already broke that. If parity still matters to you,
  say so — it constrains a lot of Phase 4.
- **Memory.** Ground textures are ~1.3 MB each and the map is now 225 blocks
  (~300 MB of ground texture alone). Phase 2's resolution bump multiplies that.
  Texture compression and/or block eviction should land alongside Phase 2.
- **This is a lot of work.** Phases 1–3 are a realistic near-term target and
  will change how the game looks completely. Phases 4–5 are each their own
  project.

## What I need from you

1. **Option A or Option B** (built-in lit shader, or migrate to URP)?
2. **Start with Phase 1**, or a different order?
3. Does **JS parity** still matter?
