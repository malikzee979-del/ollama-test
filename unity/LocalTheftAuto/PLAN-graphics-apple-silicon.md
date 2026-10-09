# Local Theft Auto — Graphics Plan: Apple Silicon / Metal

> **CLOSED (2026-10-03) — decision made, nothing to build.** The plan's own
> conclusion (bottom of this file) is *do not build the native MTLFX
> temporal-scaler plugin*; STP + Forward+ (already configured in
> `Assets/Settings/LTA-URP.asset`) covers the use case. Kept as a
> decision record only.

**Target:** `unity/LocalTheftAuto`, Unity `6000.5.9f1`, URP 17.5, Forward+, all-procedural.
**Machine this plan is calibrated for:** MacBook Pro, **Apple M4**, 16 GB unified memory,
**built-in Liquid Retina XDR** display, macOS 26.6.2. Unity `6000.5.9f1` is installed at
`/Applications/Unity/Hub/Editor/6000.5.9f1` — the exact project version, so every phase
below is buildable and verifiable locally.

---

## 0. Read this first

### 0.1 The honest answer to "can we use Apple's graphics?"

**You already are.** Unity has exactly one graphics backend on macOS: Metal. There is no
OpenGL path to switch away from and no "enable Metal" button to press. Every frame this
game draws today is already Metal command buffers on the M4 GPU.

So the question is not *whether* to use Apple's graphics stack — it is **which Metal and
Apple-silicon capabilities the project currently leaves switched off.** I audited the
config and found the answer is: most of the interesting ones. Three are literally set to
`0` in `ProjectSettings`.

Two expectations to correct up front:

- **MetalFX is not available to this project without native code.** Apple's MetalFX
  (`MTLFXTemporalScaler`, the DLSS-equivalent) is a first-class framework on macOS 13+ /
  M-series, but **Unity does not expose it on macOS in URP**. The only integrations that
  exist are a third-party Asset Store plugin (~$35) or writing an Objective-C++ native
  rendering plugin yourself. Unity's own equivalent is **STP**, a software compute-shader
  upscaler that runs perfectly well on Metal. STP is Phase 4; MetalFX is Appendix A, and
  my recommendation is not to bother.
- **Nothing here makes it photoreal.** `REALISM-PLAN.md` already made this argument
  correctly and it still holds: procedural boxes with runtime-generated textures have a
  ceiling, and that ceiling is "very good stylised night city", not GTA V. This plan
  raises image *quality, correctness and presentation* — it does not author art.

### 0.2 What the audit actually found

Verified by reading the files, not inferred:

| # | Finding | Evidence | Impact |
|---|---------|----------|--------|
| 1 | **Project is in Gamma color space.** | `ProjectSettings.asset` → `m_ActiveColorSpace: 0` | All PBR lighting math in `LTA-Lit.shader` — GGX, Fresnel, energy conservation — is being performed on sRGB-encoded values. It is wrong by construction. |
| 2 | **Lights do not use linear intensity.** | `GraphicsSettings.asset` → `m_LightsUseLinearIntensity: 0` | Consequence of #1. Light falloff and additive blending of the street-lamp cluster are incorrect. |
| 3 | **HDR display output is off.** | `ProjectSettings.asset` → `useHDRDisplay: 0` | You have an **XDR display** (1600 nits peak) and the game is rendering to SDR. ACES tonemaps a night city's lamps and headlights down into 0–1 and clips them to paper white. |
| 4 | **Metal Display Link is off.** | `ProjectSettings.asset` → `metalUseMetalDisplayLink: 0` | No `CAMetalDisplayLink` frame pacing. On a ProMotion panel this is the difference between smooth adaptive 120 Hz and judder. |
| 5 | **Color grading is LDR while the buffer is HDR.** | `LTA-URP.asset` → `m_SupportsHDR: 1` but `m_ColorGradingMode: 0` | The grading LUT clamps to 0–1 *before* ACES sees the values. The `postExposure: 1.5` hack in `SetupPostFx` is compensating for this. |
| 6 | **GPU Resident Drawer disabled.** | `LTA-URP.asset` → `m_GPUResidentDrawerMode: 0` | URP 17's BatchRendererGroup instancing is off. The static city is paying full per-renderer CPU cost. |
| 7 | **Anti-aliasing is SMAA + MSAA 4×, no temporal.** | `LTA.Game.cs:318`, `LTA-URP.asset` → `m_MSAA: 4` | Paying for both a spatial post-AA pass and 4× MSAA. Neither fixes the specular/bloom shimmer that a GGX night city with hundreds of point lights actually suffers from. |
| 8 | **No MotionVectors pass in the custom shader.** | `LTA-Lit.shader` has `ForwardLit` / `ShadowCaster` / `DepthOnly` / `DepthNormals` only | **This is the blocker for TAA and STP.** Both need per-pixel motion. Also why `MotionBlur` is stuck on `CameraOnly`. |
| 9 | **Intermediate texture forced always-on.** | `LTA-Renderer.asset` → `m_IntermediateTextureMode: 1` | Forces a full-screen copy and defeats URP's native-render-pass merging. On a TBDR GPU this is the single most wasteful setting in the file — it pushes traffic through system memory that could have stayed in tile memory. |
| 10 | **No opaque texture.** | `LTA-URP.asset` → `m_RequireOpaqueTexture: 0` | Screen-space reflections for wet roads and puddles are impossible. Phase 12's reflection probe is the workaround. |
| 11 | ~~**SSAO is at minimum quality.**~~ **This was wrong — corrected during implementation.** The quality enums were already fine: `BlurQuality: 0` is *High* (bilateral) and `Samples: 1` is *Medium*. The real defect is `Radius: 0.035`. | `LTA-Renderer.asset` | Radius is in **world units**, in a world whose blocks are 480 units across. At 0.035 the AO kernel is microscopic, so AO was invisible no matter what the sample count said. |
| 12 | **Reflection probe blending and box projection off.** | `LTA-URP.asset` → both `0` | The single realtime probe pops rather than blends, and its cubemap is not parallax-corrected to the street. |

### 0.3 The dependency that reorders everything

Unity's documentation is unambiguous on two points:

> *"You can only use HDR Output with a linear color space."*
> *"URP only supports HDR Output on the following platforms: … **macOS devices that use Metal** …"*

So the XDR payoff (#3) is **gated on** the color-space migration (#1). That is why Linear
is Phase 1 and not a nice-to-have — it is the door everything else goes through. It is
also the riskiest change in the plan, which is an uncomfortable but unavoidable ordering.

### 0.4 House rules that constrain this work

- **`PLAN-gameplay-next.md` §0.3 says "Never modify config files."** This plan
  deliberately violates that rule, because the whole point is settings that only exist in
  `ProjectSettings/` and `Assets/Settings/`. That constraint was scoped to *that* plan's
  gameplay work. Flagging it explicitly so the contradiction is a decision, not an
  accident.
- **The entire `unity/` tree is untracked in git.** There is no history to fall back on.
  Take a filesystem snapshot before Phase 1 (§0.5).
- **Never `git commit`** (`AGENTS.md`).
- **No new packages, no binary assets.** Everything stays procedural and code-built.

### 0.5 Snapshot before touching anything

```bash
cp -R unity/LocalTheftAuto/Assets unity/LocalTheftAuto/ProjectSettings \
  ~/LTA-snapshot-$(date +%Y%m%d-%H%M)/
```

---

## 1. Verification harness (set this up first)

The project already has the mechanism, which is why this plan is checkable rather than
hopeful. `LTA.Game.cs` parses `-lta-shot=/abs/path.png`, forces `runInBackground`, starts
the sim and quits via a 25 s watchdog.

**Baseline, before any edit:**

```bash
/Applications/Unity/Hub/Editor/6000.5.9f1/Unity.app/Contents/MacOS/Unity \
  -quit -batchmode -projectPath unity/LocalTheftAuto \
  -executeMethod BuildGame.Build -logFile /tmp/lta-build.log
```

```bash
unity/LocalTheftAuto/Builds/LocalTheftAuto.app/Contents/MacOS/LocalTheftAuto \
  -lta-shot=/tmp/lta-baseline.png
```

Keep `/tmp/lta-baseline.png`. Every phase gets its own shot and gets compared against the
previous one **as an image**, not as a diff of the code.

The three existing headless sim tests (`TrafficSimTest`, `PoliceSimTest`, `GangSimTest`)
are logic regression guards. They will not catch a graphics regression — but a phase that
breaks them has broken something it had no business touching, so they stay in the loop.

**Known limitation, stated plainly:** a screenshot captured from a Metal offscreen
readback is **SDR**. It will verify geometry, exposure, color, AA and shading. It
**cannot** verify the HDR/EDR output of Phase 2 — nits above paper white do not survive
into a PNG. Phase 2's payoff has to be judged by eye on the XDR panel, plus the numeric
readout from `HDROutputSettings`. I will say so again when we get there rather than
claiming a screenshot proved it.

---

## 2. Phase 1 — Linear color space *(the foundation, and the risky one)*

**Why first:** it is a prerequisite for HDR output, it makes every existing lighting
calculation correct rather than approximately-correct, and every subsequent phase's
tuning would have to be redone if it landed later.

**What it changes:** in Linear space, Unity converts sRGB textures and material color
properties on read. It does **not** convert mesh vertex colors — those are handed to the
shader raw. This project stores **pure albedo in vertex colors** (`LTA.Mesh3D.cs`: *"vertex
color is now pure albedo"*), authored as hex sRGB through `Cfg.Hex()`. Left alone, every
surface in the city would be interpreted as linear and render washed out and too bright.

**The saving grace:** it funnels through very few places.

| Change | File | Note |
|---|---|---|
| `m_ActiveColorSpace: 0` → `1` | `ProjectSettings/ProjectSettings.asset` | |
| `m_LightsUseLinearIntensity: 0` → `1` | `ProjectSettings/GraphicsSettings.asset` | Must move with the above |
| Convert vertex colors at the choke point | `LTA.Mesh3D.cs` — `MB.Quad()` and `MB.Tri()` | Two methods. Apply `.linear` where `cc` is assigned. Every procedural mesh in the city is built through these. |
| Audit sprite/`SpriteRenderer` tint colors | `LTA.Sprites.cs`, `LTA.Game.cs` | ~172 `Hex(`/`new Color(` call sites exist; most are material properties (auto-converted) or sprite tints (also converted). The mesh path is the one that is not. |
| Verify the height map stays linear | `LTA.CityRenderer.cs:1395` | Already correct — `new Texture2D(S, S, RGBA32, true, true)`, the trailing `true` is `linear`. Height data must *not* be sRGB. Do not touch. |
| Re-tune `postExposure` | `LTA.Game.cs` `SetupPostFx` | The `1.5` EV lift exists to compensate for LDR grading + gamma. In linear + HDR grading it will be too hot. Expect to land near `0.0`–`0.5`. |
| `m_ColorGradingMode: 0` → `1` (HDR) | `Assets/Settings/LTA-URP.asset` | Lets ACES see values above 1.0 instead of a pre-clamped LUT. |

**Risk: high.** This is the "magenta or washed-out screen" phase. It is also reversible in
one setting plus one commit-free file restore, which is what the §0.5 snapshot is for.

**Verify:** build + shot. Compare against baseline. Expect: correct mid-tone falloff,
shadows that are no longer crushed, lamps that roll off instead of clipping. If the city
is uniformly *brighter and flatter*, the vertex-color conversion was missed.

---

## 3. Phase 2 — HDR / EDR output on the XDR display

**This is the headline Apple-silicon win**, and the one that will look most obviously
different on your specific machine. A night city with hundreds of emissive windows,
headlight cones and sodium street lamps is precisely the content HDR exists for. Right now
ACES is compressing all of it into SDR paper white.

| Change | File |
|---|---|
| `useHDRDisplay: 0` → `1` (Use HDR Display Output) | `ProjectSettings/ProjectSettings.asset` |
| Allow HDR Display Output + swap-chain bit depth (10-bit; 16-bit if the M4 reports it) | `ProjectSettings/ProjectSettings.asset` |
| `m_HDRColorBufferPrecision: 0` → consider `1` (64-bit) | `Assets/Settings/LTA-URP.asset` — only if banding shows in the sky gradient |
| Drive tonemapping from display capabilities | `LTA.Game.cs` `SetupPostFx` |

In `SetupPostFx`, the ACES `Tonemapping` override gains min/max/paper-white nits, read at
runtime from `HDROutputSettings.main` rather than hardcoded, with a graceful fall back to
the current SDR path when `HDROutputSettings.available` is false (external non-HDR monitor,
or the app moved to a different display).

One real consequence to handle: **the HUD.** URP drives unlit material brightness from the
Paper White value in HDR mode. `LTA.Hud.cs` builds every label with legacy
`UnityEngine.UI.Text` on an overlay canvas. Left unmanaged, the wanted stars and score
readout will either glow like a light source or look dim against the graded scene. Budget
a pass on HUD brightness here.

**Risk: medium.** Contained, and gated behind a runtime capability check.

**Verify:** *by eye on the XDR panel* — the screenshot harness cannot see this, as stated
in §1. Supporting evidence from `Window > Analysis > Rendering Debugger > Rendering > HDR
Output`, which tabulates the negotiated nit values.

---

## 4. Phase 3 — Metal Display Link and ProMotion pacing

Cheap, low-risk, and it is felt in the hands rather than seen in a screenshot.

| Change | File |
|---|---|
| `metalUseMetalDisplayLink: 0` → `1` | `ProjectSettings/ProjectSettings.asset` |
| Frame-rate policy for a 120 Hz adaptive panel | `LTA.Game.cs` |

`CAMetalDisplayLink` lets Metal pace presentation against the actual display refresh
instead of Unity's default timer. On a ProMotion panel that means the variable refresh rate
is driven correctly rather than fought.

Note the current state is contradictory: `QualitySettings.asset` has `vSyncCount: 0` on the
Very Low/Low tiers and `1` on Medium and above, while `LTA.Game.cs` never sets
`Application.targetFrameRate` at all. Under URP the quality-tier AA values are ignored
anyway. Make the intent explicit in code rather than leaving it to whichever tier happens
to be active.

Also relevant to feel: `GameLoop.Update()` clamps `dt` to `Time.unscaledDeltaTime` capped at
`0.05`. At a real 120 fps that is fine, but verify the chase camera's smoothing constants in
`StepCamera` are framerate-independent — camera lerps tuned at 60 fps behave differently at
120, and this would show up as the camera feeling "tighter" for no obvious reason.

**Risk: low.** **Verify:** frame-time graph in the Unity Profiler; the shot harness is
irrelevant here.

---

## 5. Phase 4 — Temporal AA, then STP upscaling

Phase 1 must land first (temporal accumulation in gamma space is wrong twice over).

### 5.1 The prerequisite: a MotionVectors pass

`LTA-Lit.shader` has no `MotionVectors` pass, so URP has no per-object motion for the
hundreds of moving cars, cops and pedestrians. This blocks TAA, blocks STP, and is why
`MotionBlur` is limited to `CameraOnly`.

Add a `MotionVectors` pass to `LTA-Lit.shader`. The meshes have positions, normals, UVs and
vertex colors but **no tangents**, which is fine — motion vectors need previous-frame object
position, not tangent space. The pass is mechanical: previous and current clip position,
output the delta.

### 5.2 Then the AA swap

| Change | File |
|---|---|
| `AntialiasingMode.SubpixelMorphologicalAntiAliasing` → `TemporalAntiAliasing` | `LTA.Game.cs:318` |
| `m_MSAA: 4` → `1` (off) | `Assets/Settings/LTA-URP.asset` |
| Upgrade `MotionBlur` from `CameraOnly` to full | `LTA.Game.cs` `SetupPostFx` |

MSAA and TAA together is paying twice; TAA supersedes it and additionally fixes the
specular aliasing and bloom crawl that MSAA cannot touch, because those are shading
aliasing, not geometric aliasing. For a night city full of tiny bright GGX highlights that
is the dominant artifact.

**Caveat worth stating:** TAA on a fast-moving chase camera produces ghosting behind moving
objects. With correct motion vectors it is usually acceptable; if it is not, the fallback is
back to SMAA, and STP becomes unavailable with it.

### 5.3 Then, optionally, STP

Once TAA is working, STP is nearly free to try: `m_UpscalingFilter` on the URP asset, with
`m_RenderScale` below 1.0. STP requires compute shaders / Shader Model 5.0, which Metal on
M4 satisfies comfortably. It implicitly enables TAA, which §5.2 has already done properly.

Honest framing: on an M4 rendering procedural boxes, **you are unlikely to be GPU-bound at
all**, so upscaling buys little. Its real value is at native XDR resolution (3024×1964), a
lot of pixels for a bloom-and-SSAO-heavy pipeline. Treat as measure-first.

---

## 6. Phase 5 — TBDR-aware tuning (the genuinely Apple-specific part)

Apple silicon GPUs are **tile-based deferred renderers**. Their performance model differs
from the immediate-mode desktop GPUs URP defaults are tuned for: render targets live in
fast on-chip tile memory, and the expensive thing is flushing them to system memory. Three
current settings work against that.

| Change | File | Why it matters on TBDR |
|---|---|---|
| `m_IntermediateTextureMode: 1` (Always) → `0` (Auto) | `Assets/Settings/LTA-Renderer.asset` | **Highest-value item here.** "Always" forces a full-screen intermediate copy every frame and prevents URP from merging passes into a single native render pass. On a tile GPU that is a needless round trip to memory. |
| `m_GPUResidentDrawerMode: 0` → `1` (Instanced Drawing) | `Assets/Settings/LTA-URP.asset` | BRG instancing for the static city. Prerequisites are already met: SRP Batcher on, Forward+. Caveat: it benefits *static* renderers most; the per-frame-moved cars/peds/particles see less. Measure. |
| `m_StoreActionsOptimization: 0` | `Assets/Settings/LTA-URP.asset` | Controls whether Unity emits `DontCare` store actions. Discarding a target you never read is close to free on desktop and a real saving on tile memory. |

Secondary quality items, once the above frees headroom:

- **SSAO**: `Samples: 1` → higher, `BlurQuality: 0` → better, and reconsider
  `Radius: 0.035` against a world with 480-unit blocks and 1400-unit towers. AO is what
  gives kerbs, doorways and building creases contact — currently it is nearly invisible.
- **Reflection probe**: enable `m_ReflectionProbeBlending` and
  `m_ReflectionProbeBoxProjection`. Box projection in particular makes the single realtime
  probe's reflections track the street geometry instead of sitting at infinity.
- **`m_RequireOpaqueTexture: 1`**: unlocks true screen-space reflections in puddles and wet
  asphalt — the single biggest "it rained and the city looks real" cue. Costs a color copy;
  now affordable if the drawer and pass-merging work landed.

**Measure with Apple's own tooling**, which is the other half of "using Apple's graphics":
Xcode's **Metal Debugger / GPU frame capture** against the built `.app`, and **Instruments →
Metal System Trace**. These show actual tile memory traffic, pass merging and shader
occupancy — things the Unity Profiler only approximates.

---

## 7. Sequencing summary

| Phase | Work | Risk | Verifiable by screenshot? |
|---|---|---|---|
| 0 | Snapshot + baseline shot | none | — |
| 1 | **Linear color space** + HDR grading + vertex-color conversion | **high** | yes |
| 2 | HDR/EDR output on XDR | medium | **no — by eye** |
| 3 | Metal Display Link + ProMotion | low | no — profiler |
| 4 | MotionVectors pass → TAA → (STP) | medium | yes |
| 5 | TBDR tuning, SSAO, SSR, probes | low–medium | yes |

Each phase: change → build → shot → **look at the image** → keep or revert. No phase
starts before the previous one has been looked at.

---

## 8. Implementation record — what actually landed

All phases implemented and built against Unity `6000.5.9f1`. Every build succeeded with
zero compile and zero shader errors. Measurements are from the harness's deterministic
on-foot frame, sampled every 4th pixel.

| Frame | Mean luma | Clipped | Near-white | Crushed |
|---|---|---|---|---|
| Baseline (gamma, SMAA+MSAA4) | 41.46 | 0.01% | 0.45% | 0.15% |
| After Phase 1 (linear + HDR grading) | 53.09 | **0.00%** | 0.07% | **0.00%** |
| After Phase 4 (TAA, MSAA off) | 47.33 | 0.00% | 0.00% | 0.00% |
| After Phase 5 (AO radius fix) | 44.53 | 0.00% | 0.00% | 0.00% |
| After Phase 5b (GPU Resident Drawer) | 42.63 | 0.00% | 0.00% | 0.00% |

### 8.1 Phase 1 — done, and the exposure hack turned out to be justified

Linear landed with no wash-out, which confirms the vertex-color conversion at
`MB.Quad`/`MB.Tri`/`QuadMeshXZ` caught every albedo path. The plan predicted
`postExposure: 1.5` would now be too hot. **It was not, and it was left alone** — the
measurement shows clipping *falling* from 0.01% to 0.00% and crushed blacks from 0.15% to
0.00% while mean luminance rose. More range in use at both ends is the opposite of
over-exposure, so the 1.5 EV lift was doing real work, not compensating for the bug.

### 8.2 Phase 2 — HDR is active, but two things need your eyes

`HDR output active=True … gamut=HDR10`. Getting there needed one thing the plan missed:
`useHDRDisplay: 1` alone is not enough. `available` went true but `active` stayed false and
the panel reported 100 nits until `HDROutputSettings.RequestHDRModeChange(true)` was called
explicitly, and because that is asynchronous the nit values have to be re-read a few frames
later — hence `HdrSettleRoutine`.

Two caveats that are **not** resolved:

1. **macOS reports contradictory limits.** `paperWhite=160` but `maxToneMapLuminance=100` —
   a peak dimmer than paper white, which cannot be true. The EDR headroom is not coming
   through the Metal swapchain query. The code detects the contradiction and overrides to a
   conservative 1000-nit ceiling. **This override is unverified by measurement** and is the
   most likely thing to need adjusting by eye.
2. **The game opens on the wrong display.** The Samsung C34H89x ultrawide is the macOS
   *Main Display*; the XDR panel is secondary, so HDR does nothing unless the player is
   launched with `-monitor 2` or the XDR panel is made primary in System Settings.

### 8.3 Phase 4 — and the trap it uncovered

The `MotionVectors` pass uses URP's own `ObjectMotionVectors.hlsl`, with the
`UnityPerMaterial` CBUFFER duplicated byte-identically so the SRP Batcher does not reject
the shader. TAA replaced SMAA and MSAA went to off.

**Enabling HDR output silently destroyed the verification harness.** `CaptureTo()` does
`Texture2D.ReadPixels` into an RGB24 texture, which cannot read an HDR-encoded swapchain:
every frame captured after HDR went live was a *flat uniform grey*, mean exactly 205.00 with
0% clipped and 0% dark. That is a blank image, not a bright one — and it would have been
easy to misread as "Phase 4 blew out the exposure". `ConfigureHdrOutput` now stays on SDR
whenever `-lta-shot=` is present, so the harness keeps working; pass `-lta-hdr` alongside it
to deliberately exercise the HDR path.

### 8.4 Phase 5 — AO was the real win

`m_IntermediateTextureMode` → Auto, reflection probe blending and box projection on, AO
radius `0.035` → `2` and samples to High. AO is now visible as contact darkening under the
player, at tree bases and along kerb and sidewalk joints. The Resident Drawer reports
`GPU Resident Drawer created.` with no BatchRendererGroup warnings.

### 8.5 Not done, deliberately

- **STP upscaling** (§5.3) — measure first. On an M4 drawing procedural boxes there is
  probably no GPU bound to clear.
- **`m_RequireOpaqueTexture: 1`** for true wet-road SSR — the largest remaining *visual*
  item, and the natural next step.
- **Per-object MotionBlur** — the MotionVectors pass now makes it possible, but it was left
  on `CameraOnly` rather than changing feel without you seeing it.
- **HUD paper-white pass** — needs the HDR path judged on the XDR panel first.
- **MetalFX** — see Appendix A. Still not recommended.

### 8.6 How to see it yourself

```bash
unity/LocalTheftAuto/Builds/LocalTheftAuto.app/Contents/MacOS/LocalTheftAuto -monitor 2
```

Rebuild and re-shoot at any time with:

```bash
/Applications/Unity/Hub/Editor/6000.5.9f1/Unity.app/Contents/MacOS/Unity -quit -batchmode -nographics -projectPath unity/LocalTheftAuto -executeMethod BuildGame.Build -logFile /tmp/lta-build.log
```

---

## Appendix A — MetalFX, honestly

If native MetalFX is wanted regardless, the shape of the work is:

1. An Objective-C++ Unity **native rendering plugin** wrapping `MTLFXTemporalScaler`.
2. Hand it color, depth **and motion vectors** — so §5.1 is a prerequisite for this too.
3. Hook it in at the right point via a URP `ScriptableRenderPass`, after rendering and
   before post-processing, with jitter applied to the camera projection.

Against that: it is a native plugin in a project whose defining constraint is zero
dependencies and no binary assets; it locks the renderer to Apple platforms; and STP already
gets most of the benefit with none of it. On an M4 running procedural geometry, it would
most likely be solving a bottleneck that does not exist.

**Recommendation: do not build it.** Revisit only if Phase 5 profiling shows a real GPU
bound at native XDR resolution that STP fails to clear.
