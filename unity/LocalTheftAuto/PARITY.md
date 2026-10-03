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
| Wanted escalation | roadblocks ≥3★, heli ≥4★, SWAT ≥5★, hideouts | roadblocks only | Heli/SWAT/hideouts → Unity (Phase 2 A5) |
| Weather/rain (grip, fog) | ❌ | ✅ | → JS (Phase 2 A1) |
| Districts (Downtown/Residential/Industrial) | ❌ | ✅ | → JS (Phase 2 A2, draw-only) |
| Economy | garage save, paint shop, gas, mart | ❌ | → Unity (Phase 3A, merges PLAN-gameplay-next Stage 3) |
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
