# Local Theft Auto — JS ↔ Unity parity table

Canonical record of where the two engines agree and where they have
**deliberately diverged**. Rule: silent drift is forbidden — every divergence
gets a row here, and every row gets a decision. Maintained per
`.pixis/plans/lta-whole-game-improvements.md` §4.

- JS original: `marketing/game.js` (single IIFE, canvas, `WORLD = 96` tiles)
- Unity port: `unity/LocalTheftAuto` (URP, procedural, `Cfg.World = 144` tiles)

## The parity contract (what must stay 1:1)

- `blockHash` / `hash2` / `tileType` hashing and the 10×10 block rules —
  `LTA.Core.cs` (`JSRng`, `CityMap.TileType`) replays the JS double math
  exactly. Any JS change to these must be mirrored in `LTA.Core.cs` in the
  same session, or recorded below as a divergence.
- Core movement/physics constants read against `marketing/game.js` (the sim
  runs in the original pixel space, y down).
- Storage keys are append-only on both sides: JS `lta-best`, `lta-stats`,
  `lta-achievements`, `lta-muted`, `lta-settings`, `lta-garage`; Unity
  `lta_highscore` + autosave keys.

## Accepted divergences (decided 2026-09-09)

| Area | JS | Unity | Decision |
| --- | --- | --- | --- |
| **World size** | 96×96 tiles | 144×144 tiles (`Cfg.World`) | **Accept divergence.** The "shared city layout" claim is false and has been removed from both READMEs/comments. Hash *functions* stay 1:1; world extent does not. |
| **Weapon tone** | Non-lethal: bat + stun pistol, comedic framing | Lethal: pistol/SMG/shotgun, gang kills pay +25 | **Keep both tones engine-local.** Converging would gut one version's identity (non-lethal-in-Unity kills the Gang War mission; lethal-in-JS abandons its framing). |
| **River landmark** | Fixed 4-tile-wide *column* (`RIVER_TX_MIN/MAX = 46/49`) with free bridges per block row | Different scheme: a river *block row* (`Cfg.RiverY0/Y1`) | Accept — each is a hand-placed landmark in its own layout. |
| **Stadium landmark** | 20×20-tile solid bowl (`STADIUM`) | None | Accept (JS-only landmark). |

## Feature matrix (port direction when parity is wanted)

| Feature | JS | Unity | Direction to port |
| --- | --- | --- | --- |
| Missions | 7: delivery, circuit, steal, ram, rampage, escort/VIP | 4: delivery, rampage, steal, gang war | Circuit/Ram/Escort → Unity (Phase 2 A6); Gang War needs gangs — deferred |
| Gangs + vendetta | ❌ | ✅ | Optional → JS; **deferred** (fights non-lethal tone, week of work) |
| Wanted escalation | roadblocks ≥3★, heli ≥4★, SWAT ≥5★, hideouts | ✅ T9: SWAT cruisers at 5★ (220 HP, +30 top speed, alternate spawns, ticker warning) — roadblocks already landed | Heli + hideouts → Unity |
| Weather/rain (grip, fog) | ❌ | ✅ — T10 added Fog as a third state: rotation cycle (rain 70% / fog 30%), tighter fog distance in `UpdateWorldFX`, flat 0.9 grip, traffic cruise ×0.75, debug-pin value 2 | ✅ (Unity-only; fog optional when porting) |
| Body types | 3 (sedan/hatch/van via seed%3) | ✅ T11: 4th body — motorbike (seed branch `(seed & 7) == 4`, ~12.5% of traffic; `Cfg.Body*` 4th entries + `BodyRadius`; narrow mesh in `BuildBike`; per-body push radius; dedicated engine clip) | → JS (bike optional when porting) |
| Witness-based crime reporting | seed only (`panicNear`, steal witness) | ✅ T5: full system — crimes only raise stars when a living ped witnesses them; the reporter can be stopped during the 2.5s report window | Unity ahead here; JS port optional |
| Pistons/audio architecture | n/a | T12: restart path uses a real `Audio3D.Reset()` (reflection hack removed) | parity (Unity-internal cleanup) |
| Ped variety | uniform | ✅ T13: hashed outfit palettes (already landed) + hashed height tiers (0.9–1.12) + panic cower pose (arms up, hunch, eased in/out) | → JS optional |
| Chase audio | none | ✅ T14: procedural tension bed (drone + tick + dissonant second), volume ramps with Wanted 1–5★, pitch bend up, muted during BUSTED/WASTED | → JS optional |
| Mission signage | none | ✅ T15: mission-blue signboard meshes beside the active delivery/steal marker, hidden with it | → JS optional |
| District ambience | one city bed | ✅ T18: per-district baked loops (residential brown noise / downtown hum+honks / industrial throb+clank) crossfaded on boundary cross | → JS optional |
| Districts (Downtown/Residential/Industrial) | ❌ | ✅ | → JS (Phase 2 A2, draw-only) |
| Economy | garage save, paint shop, gas, mart | ✅ T8 gas drive-in repair (2s hold / −150); T16 garage world trigger (2s hold on a garage tile saves body/paint/health into `lta_save_json`, owned car respawns near start via ring rejection-sampling) | Paint shop + mart → Unity (Phase 3A remains) |
| Achievements/stats/settings menu | ✅ | settings ✅ — Stage 1 **landed** (`SettingsStore`, pause-menu settings page); stats/achievements ❌ | stats/achievements → Unity |
| Rival score `#s=` URL hash | ✅ | ❌ (PlayerPrefs high score) | Low priority |
| Style combos/pops | ✅ | ❌ | → Unity (Phase 2 A3) |
| Ped customizer (skin/shirt) | ❌ | ✅ (`LTA.Hud.cs` swatches) | → JS (Phase 2 A4) |
| Pause / WASTED screen | ✅ (pause `P`) | ✅ — Stage 1 **landed**: pause menu (`Esc`/`P`), settings + controls pages, WASTED screen, restart | parity |
| Touch + gamepad | touch ✅, gamepad ❌ | both ✅ | Gamepad → JS (Phase 4, optional) |
| Day/night cycle | ✅ | ✅ | parity |
| Autosave mid-run | ❌ (best/stats only) | ✅ (PlayerPrefs) | → JS (Phase 3B, new key `lta-save`) |
| Witness-based crime reporting | seed only (`panicNear`, steal witness) | ❌ (instant stars) | JS first (canonical), then Unity (Phase 3C) |
| Multi-stage mission chains | ❌ | ❌ | JS first, then Unity (Phase 3D) |

## Ground rules

1. Sim features that touch shared logic land **JS first** (witness reporting,
   mission chains) — JS is the smaller codebase and the port's design
   contract is "copy the JS sim". Presentation-only features (districts, rain
   visuals, style pops) may land engine-local.
2. Update this table in the same change as any port or new divergence.
3. Marketing copy (mission counts, feature claims in `game.html`'s ledger and
   `missions.html`) must stay truthful after each wave — see
   `.pixis/scratch/game-feature-deltas.md` for the deltas workflow.
