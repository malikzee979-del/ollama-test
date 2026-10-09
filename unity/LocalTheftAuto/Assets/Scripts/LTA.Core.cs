/* ==========================================================================
   Local Theft Auto — Unity port of marketing/game.js
   Core: constants, JS-exact hashing, city map queries, state, entity data.

   The simulation runs in the ORIGINAL coordinate space of the JS game:
   pixels, x -> right, y -> DOWN. Conversion to Unity space (y up) happens
   only at render time (see LTA.Game.cs / ToUnity()). Every gameplay
   constant below is copied 1:1 from marketing/game.js so the port plays
   exactly like the canvas version.
   ========================================================================== */
using System.Collections.Generic;
using UnityEngine;

namespace LocalTheftAuto
{
    /* ------------------------------------------------------------ JS math */

    // marketing/game.js does its hashing in JS Numbers (doubles) and then
    // truncates with `| 0` / `>>> 0`. To reproduce the exact same city we
    // replay the double math instead of using C# int arithmetic (the
    // intermediate products overflow 2^53, where double rounding matters).
    public static class JSRng
    {
        private static int ToInt32(double d)
        {
            d %= 4294967296.0;
            if (d < 0) d += 4294967296.0;
            return unchecked((int)(uint)d);
        }

        // hash2(x, y)
        public static double Hash2(int x, int y)
        {
            int h = ToInt32((double)x * 374761393.0 + (double)y * 668265263.0);
            h = ToInt32(unchecked(h ^ (h >> 13)) * 1274126177.0);
            return (uint)(h ^ (h >> 16)) / 4294967295.0;
        }

        // blockHash(bx, by)
        public static double BlockHash(int bx, int by)
        {
            int h = ToInt32((double)(bx * 7 + 1) * 374761393.0 + (double)(by * 13 + 2) * 668265263.0);
            h = ToInt32(unchecked(h ^ (h >> 13)) * 1274126177.0);
            return (uint)(h ^ (h >> 16)) / 4294967295.0;
        }
    }

    /* ------------------------------------------------------------ config */

    public static class Cfg
    {
        public const int Tile = 48;
        public const int World = 144;         // 144x144 tiles — a real city, not one neighborhood
        public const int BlockTiles = 10;     // one city block per 10x10 tiles

        // tile types
        public const int Road = 0, Side = 1, Bldg = 2, Park = 3, Water = 4;

        // one river block-row cuts across the whole city; every north-south
        // avenue that crosses it becomes a bridge (its Road/Side lanes just
        // keep going), everything else in the band is open water. Placed a
        // bit off-center so the two halves of town don't feel symmetric.
        public const int RiverBlockRow = 6;                       // by index that is all river
        public const int RiverY0 = RiverBlockRow * BlockTiles;    // first river tile row
        public const int RiverY1 = RiverY0 + BlockTiles;          // exclusive

        // direction vectors: 0=+x 1=+y(down) 2=-x 3=-y, angle = dir * PI/2
        public static readonly int[] Dx = { 1, 0, -1, 0 };
        public static readonly int[] Dy = { 0, 1, 0, -1 };

        public static readonly Color[] CarColors =
        {
            Hex("#c8553d"), Hex("#5b8bd0"), Hex("#7fae6a"), Hex("#c9a227"),
            Hex("#9a6bbf"), Hex("#d0d4da"), Hex("#4fb0a5"), Hex("#8a4f6d")
        };

        // Car paint — deliberately SEPARATE from CarColors above: CarColors
        // doubles as the pedestrian shirt palette and is meant to stay varied
        // and colourful, while real traffic is dominated by white, black,
        // grey and silver (entries repeated below to weight the random pick),
        // with only a few deeper accents. Don't merge the two arrays back.
        public static readonly Color[] CarPaints =
        {
            Hex("#f2f3f5"), Hex("#e9e6de"), Hex("#d7dbe0"), Hex("#b9bfc6"),   // whites + silver
            Hex("#8f959c"), Hex("#565c64"), Hex("#2c3036"), Hex("#121519"),   // greys + blacks
            Hex("#1f3a5f"), Hex("#66242c"), Hex("#2a4634"), Hex("#c9b891")    // navy, maroon, green, champagne
        };

        public static readonly Color[] Skins =
        {
            Hex("#e6c9a8"), Hex("#c9a06f"), Hex("#8d6b4b"), Hex("#f0d9bf")
        };

        // roof albedo (tar/gravel ~0.28, concrete ~0.45) — these were
        // near-black for the old unlit renderer; real lighting needs real
        // reflectance or every rooftop reads as a void from above
        public static readonly Color[] RoofPalette =
        {
            Hex("#4c535e"), Hex("#515863"), Hex("#565d69"), Hex("#494f59")
        };

        // Counts from spawnWorld(). Scaled up with the map — the original
        // numbers were tuned for a 96-tile world with 100 blocks; at 144
        // tiles the same crowd spread over 225 blocks left the city feeling
        // deserted.
        public const int TrafficCars = 95;
        public const int ParkedCars = 55;
        public const int PedCount = 120;         // civilians walking the sidewalks
        public const int PackageCount = 6;
        public const int WeaponPickupCount = 4;

        // Park crowds: people who live inside a park block rather than
        // walking the sidewalk grid — they mill about, loiter and play.
        public const int ParkPedCount = 60;
        public const float ParkWanderSpeed = 20f;

        // Two rival gangs holding corners and shooting at each other. They
        // reuse PedEnt (and therefore the existing visual, death, toss and
        // respawn paths) with a faction tag instead of being their own type.
        public const int GangCount = 48;             // total across both gangs
        public const float GangSightRange = 300f;    // start advancing on a rival
        public const float GangFireRange = 190f;     // close enough to shoot
        public const float GangFireCooldown = 0.85f;
        public const float GangDamage = 34f;
        public const float GangSpeed = 42f;
        public const float GangHealth = 100f;
        // stray rounds hurt the player if they wander into a firefight
        public const float GangStrayRange = 46f;
        public const float GangStrayDamage = 7f;

        public static readonly Color[] GangColors =
        {
            Hex("#d43b3b"),   // gang 1 — reds
            Hex("#3f6fd8")    // gang 2 — blues
        };

        public static readonly string[] GangNames = { "Reds", "Blues" };

        // ---- Gang wars: vendetta + drops ----
        // Attack a gangster (shoot or run over) and nearby members of that
        // gang return fire on the player for a while. VendettaRange is how
        // far the news carries; VendettaDuration how long the grudge lasts.
        public const float VendettaRange = 700f;
        public const float VendettaDuration = 14f;
        public const float GangPlayerDamage = 12f;   // per hit on the player, via DamageCar
        public const int GangKillScore = 25;         // score for each gangster the player drops
        public const float GangDropChance = 0.45f;   // chance a slain gangster drops loose ammo
        public const int GangDropAmmo = 6;
        public const float GangWarAggroSight = 380f; // vendetta gangsters engage the player inside this

        // ---- weapons (Systems.FireWeapon) ----
        // Three tiers sharing one ammo pool, indexed by WeaponKind - 1
        // (0 = Pistol, 1 = SMG, 2 = Shotgun). Civilians still die in one
        // hit from anything; gangsters, cops and vehicles take Health
        // damage per hit, the shotgun spreading it across pellets.
        public static readonly float[] WeaponDamage = { 40f, 22f, 16f };    // shotgun: per pellet
        public static readonly float[] WeaponConeDeg = { 26f, 32f, 48f };
        public static readonly float[] WeaponRange = { 260f, 240f, 170f };
        public static readonly float[] WeaponCooldown = { 0.22f, 0.09f, 0.75f };
        public static readonly int[] WeaponPellets = { 1, 1, 6 };
        public static readonly bool[] WeaponAuto = { false, true, false };  // SMG fires held
        public static readonly int[] AmmoPerPickup = { 12, 30, 12 };        // per crate kind
        public const int AmmoMax = 120;   // an SMG chews through 60 in five seconds

        // crate kinds on the ground (WeaponEnt.Gun): ammo/pistol, SMG, shotgun
        public const int CratePistol = 0, CrateSmg = 1, CrateShotgun = 2;
        public const int SmgPickupCount = 2;
        public const int ShotgunPickupCount = 2;

        // day/night cycle, in game-clock seconds (LawStep etc. use the same clock)
        public const double DayLength = 480.0;      // one full day/night cycle

        // Night theme. The city is meant to read as Gotham after dark, so
        // the day half of the cycle is skipped entirely: the key light
        // behaves as a moon and the city's own windows and street lamps do
        // most of the visible work. Set NightTheme = false to get the old
        // sweeping day/night cycle back — nothing else needs changing, and
        // this is purely presentational (the game clock still runs normally,
        // so missions, wanted-level decay and cop spawns are unaffected).
        public const bool NightTheme = true;
        public const float NightDayAmount = 0.10f;  // where on the old day curve night sits

        // ---- Realism pass: post FX (SetupPostFx, LTA.Game.cs) ----
        // Depth of field is the one item here expensive enough to want an
        // explicit kill switch — camera/chromatic aberration/grain are cheap
        // full-screen passes, DoF's bokeh math is not. First thing to cut if
        // a perf pass finds the frame budget tight.
        public const bool EnableDoF = false;
        public const float MotionBlurIntensity = 0.35f;
        public const float ChromaticAberrationIntensity = 0.18f;
        public const float FilmGrainIntensity = 0.15f;

        // ---- Realism pass: wet-road material (CityRenderer) ----
        // Rain already lowers WeatherGrip for handling; this is the matching
        // visual cue — a second, glossier/darker ground material swapped in
        // per visible block while State.Weather == Rain.
        public const float WetGloss = 0.85f;
        public const float WetSpecStrength = 1.6f;
        public const float WetAlbedoDarken = 0.78f;   // multiplier, <1 = darker

        // ---- Realism pass: near-player real-time shadows (Phase 2) ----
        // Lamp/headlight lights are all shadowless by default (hundreds of
        // them — shadowed punctual lights are the most expensive light type
        // in URP). This lets the 1-2 lamps nearest the player and the
        // player's own headlights cast shadows anyway, for contact shadows
        // where they matter. Master switch first — if a perf pass regresses
        // frame time, kill the whole feature here before touching individual
        // call sites.
        public const bool EnablePunctualShadows = true;
        public const int NearLampShadowCount = 2;   // how many lamps closest to the player cast

        // ---- Realism pass: realtime reflection probe (Phase 12) ----
        // The Phase 2 "sheen" is a hemisphere-ambient lookup pretending to be
        // a reflection. This is a real one: a single probe following the
        // player, re-rendered on a timer with Unity's own face time-slicing,
        // blended into LTA/Lit through the _LtaReflBlend global.
        //
        // It is the most expensive thing in the realism work — a probe render
        // draws the scene six more times, and time slicing spreads that cost
        // rather than removing it. This is the FIRST item to cut if a perf
        // pass regresses: set EnableReflectionProbe false and the shader falls
        // straight back to the Phase 2 fake with no other change.
        public const bool EnableReflectionProbe = true;
        public const int ReflectionProbeResolution = 128;   // per cube face
        public const float ReflectionProbeInterval = 0.5f;  // seconds between re-renders
        public const float ReflectionProbeFar = 1800f;      // shorter than the camera's 3200
        public const float ReflectionProbeHeight = 120f;    // above the player, clear of the car roof
        public const float ReflectionProbeBlend = 0.75f;    // how far toward the probe to lerp

        // ---- Realism pass: headlight shafts in air (Phase 13) ----
        // The existing headlight cone is a sprite lying FLAT on the road — a
        // pool of light, not a beam. These are two crossed additive cones
        // standing in the air in front of the car, the standard cheap
        // volumetric fake. Alpha is deliberately low: a beam you can clearly
        // see in clear weather looks like a fog machine, so the base value is
        // barely-there and rain is what makes it obvious.
        public const bool EnableLightShafts = true;
        public const float ShaftAlphaBase = 0.055f;   // clear night
        public const float ShaftAlphaRainMax = 3.4f;  // multiplier at full rainIntensity

        // ---- Realism pass: per-body-type driving stats (Phase 3) ----
        // Body type is derived from CarEnt.Seed so the MESH silhouette
        // (MeshKit.BuildCar picks Sedan/Hatch/Van/Bike off the same seed) and
        // the PHYSICS always agree — a car that looks like a van drives like
        // a van. Cop cars are always Sedan (both mesh and physics). Indexed
        // by BodySedan / BodyHatch / BodyVan / BodyBike.
        // T11: BodyBike — narrow, fast, twitchy. Its Seed branch is
        // (seed % 8) == 4 so bikes are ~12.5% of spawned traffic, and the
        // leftover sedans/hatches/vans keep their original 0/1/2 branches.
        public const int BodySedan = 0, BodyHatch = 1, BodyVan = 2, BodyBike = 3;
        public static readonly float[] BodyAccel = { 250f, 300f, 200f, 380f };      // units/s^2 — hatch nippy, bike launch hardest
        public static readonly float[] BodyTopSpeed = { 280f, 250f, 305f, 340f };  // bike tops out highest
        public static readonly float[] BodyReverse = { -95f, -90f, -80f, -40f };   // bikes barely reverse
        public static readonly float[] BodyGrip = { 8f, 9f, 6f, 10.5f };           // cornering grip — bike leans and bites… until it doesn't
        public static readonly float[] BodyHandbrakeGrip = { 2.2f, 2.4f, 1.8f, 1.4f }; // handbrake on a bike = slide out
        public static readonly float[] BodyMass = { 1f, 0.8f, 1.5f, 0.45f };       // used for crash impulses — a bike LOSES head-ons
        public static readonly float[] BodyCruiseMult = { 1f, 0.95f, 1.15f, 0.9f }; // AI traffic cruise factor
        // T11: half-width for car-car push / probe tests. Cars share the
        // historical 30f flat circle; the bike is genuinely narrower.
        public static readonly float[] BodyRadius = { 30f, 30f, 30f, 16f };

        // ---- Realism pass: braking and power band (Phase 14) ----
        // Brakes are a separate, much stronger deceleration than the engine's
        // own accel — real cars stop far faster than they build speed. Roughly
        // 1.8-2x the matching BodyAccel entry, van braking hardest relative to
        // its own (weak) accel since it has the most mass to shed. The bike
        // brakes hard per-kilo (two wheels, no engine block to carry) but its
        // short wheelbase means the rear is always threatening to pass the front.
        public static readonly float[] BodyBrake = { 480f, 520f, 420f, 620f };
        // PowerBandFloor: fraction of full accel left once a car is right at
        // its top speed — engines lose pull near the limiter instead of
        // shoving flat-out acceleration all the way to the cap.
        public const float PowerBandFloor = 0.35f;
        // Fraction of forward speed already "sideways" before a slide starts
        // bleeding momentum, and how hard it bleeds past that point.
        public const float SlideSpeedLossStart = 0.35f;
        public const float SlideSpeedLossRate = 1.6f;

        // ---- Realism pass: breakable streetlights (Phase 14) ----
        // Street lamps used to be pure decoration — a car could drive
        // straight through the pole. Now a hard enough hit snaps it: the
        // pole topples over toward the direction of impact and its light
        // goes dark, same beat as running through a lamppost in a GTA-style
        // game, instead of an invisible-wall or a no-op.
        public const float LampBreakRadius = 16f;      // strike radius around the pole base
        public const float LampBreakMinSpeed = 65f;    // car speed needed to snap it
        public const float LampFallDuration = 0.55f;   // seconds to topple to resting angle
        public const float LampFallAngle = 92f;         // slightly past horizontal — reads as "down"
        public const float LampBreakSpeedLoss = 0.85f; // struck car keeps this fraction of speed
        public const float LampBreakShake = 3f;         // camera-shake bump on impact

        // ---- Realism pass: surface-based grip (Phase 3) ----
        // Grass (Cfg.Park) is loose: multiply grip when the car is on it,
        // and make the skid-mark trigger more eager there (feeds the
        // tire-screech audio hook in Phase 4).
        public const float GrassGrip = 0.72f;
        public const float SteeringFalloffStart = 200f;  // steering authority tapers above this speed
        public const float SteeringFalloffWidth = 120f;  // how fast the taper bites

        // ---- Realism pass: damaged-paint tint (Phase 3) ----
        // Cars below full health darken toward this grime color instead of
        // snapping between pristine white and the wrecked tint — a "dented
        // fender" intermediate state keyed off health fraction.
        public static readonly Color DamageTint = new Color(0.55f, 0.55f, 0.60f);

        // ---- Realism pass: traffic lights (Phase 5) ----
        // One full red+green cycle in seconds; green is the first fraction
        // of each half-cycle, then a short amber. Player cars are exempt —
        // this governs AI traffic only (see Systems.TrafficStep).
        public const float LightCycle = 9f;
        public const float LightGreenFrac = 0.55f;
        public const float LightAmber = 1.1f;
        public const float LightStopDist = 110f;    // px before the stop line to start braking
        public const float LightUpdateRadius = 1100f; // px; only these signals update their lenses

        // ---- Realism pass: pedestrian awareness & animation (Phase 6) ----
        // Any moving car can spook a ped now, not just the player's — and the
        // reaction scales with how close the near-miss actually was rather
        // than being a flat flinch/no-flinch threshold. NearMissRadius is the
        // outer edge (barely notices); PanicRadius is where it flinches hard.
        public const float PedNearMissSpeed = 70f;    // a car below this never registers as a threat
        public const float PedNearMissRadius = 170f;  // outer edge of awareness
        public const float PedPanicRadius = 70f;      // inside this it's a full flinch regardless of scaling
        public const float PedPanicMin = 0.5f;        // shortest panic duration, at the edge of NearMissRadius
        public const float PedPanicMax = 1.8f;        // longest panic duration, at/inside PanicRadius
        // Crowd-scare: each panicking ped has this chance PER SECOND to spook
        // an unpanicked neighbour within CrowdScareRadius — lets a scare
        // ripple through a cluster without every ped in the city noticing at
        // once (there's no line-of-sight model, so radius + low odds stand in).
        public const float CrowdScareRadius = 55f;
        public const float CrowdScareChancePerSec = 0.9f;
        // Walk-cycle variety: stride RATE varies per ped (assigned at spawn)
        // so a crowd's legs don't all swing in lockstep; bob/sway are driven
        // off the same Phase accumulator so they stay in sync with the feet.
        public const float PedStrideMultMin = 0.85f;
        public const float PedStrideMultMax = 1.2f;
        public const float PedBobAmp = 0.9f;          // vertical bob, world units
        public const float PedSwayDeg = 3.5f;         // torso side-to-side lean, degrees

        // ---- Realism pass: police realism (Phase 7) ----
        // Road-following pursuit reuses the same lane-snap math TrafficStep
        // already gives ordinary traffic (see Systems.LaneTargets) but picks
        // turns at each intersection with a greedy heuristic toward the
        // player's bearing instead of TrafficStep's weighted-random pick —
        // see CopStep in LTA.Systems.cs.

        // Roadblocks: at Wanted>=3, occasionally convert one newly-spawned
        // cop into a stationary roadblock ahead of the player instead of a
        // chaser, plus a spike strip laid across the same lane.
        public const float RoadblockCooldown = 14f;   // seconds between roadblock attempts
        public const float RoadblockLeadDist = 420f;  // how far ahead of the player, along its heading, to place one
        public const float SpikeSpeedPenalty = 0.45f; // multiplies top speed/accel while active
        public const float SpikeGripPenalty = 0.55f;  // multiplies grip while active
        public const float SpikePenaltyDuration = 5f; // seconds the penalty lasts after a hit
        public const float SpikeHitRadius = 26f;

        // Ramming: cops nudge the player on contact at high Wanted, gated by
        // a per-cop cooldown so it reads as occasional deliberate contact
        // rather than being shoved every frame two boxes overlap.
        public const int RamMinWanted = 3;
        public const float RamCooldown = 3.5f;
        public const float RamImpulse = 70f;
        public const float RamDamage = 5f;

        // ---- Realism pass: final polish (Phase 8) ----
        // Splash: a moving car kicks up spray on wet road tiles, building on
        // Phase 1's wet-road material swap and the existing particle pool
        // (ParticleEnt.Splash, same shape as Puff/Smoke — see
        // Systems.AddSplash/ParticlesStep and GameLoop.SyncParticles).
        public const float SplashMinSpeed = 40f;    // below this, no wake
        public const float SplashChancePerSec = 9f; // scales with speed, capped
        public const float SplashLife = 0.5f;

        // Rain density: heavier and more variable than the flat pool from
        // Phase 1's placeholder rain. RainDropCount below is the CEILING the
        // drop pool allocates at; GameLoop scales how many of those are
        // actually active/visible per rain event (RainIntensityMin..Max) so
        // back-to-back storms don't all look identical.
        public const int RainDropCountMax = 220;
        public const float RainIntensityMin = 0.55f;
        public const float RainIntensityMax = 1f;
        public const float RainStreakAlpha = 0.34f;   // at intensity 1; scales down with intensity

        public static Color Hex(string s)
        {
            Color c;
            ColorUtility.TryParseHtmlString(s, out c);
            return c;
        }
    }

    /* --------------------------------------------------------------- map */

    public static class CityMap
    {
        // T8: the corner-tile service scheme, ported from the JS original's
        // isGasStation/isPaintShop/isGarage (game.js:460-478). Same math,
        // same rejection pattern — each service excludes the corners the
        // others claimed so no two ever share a tile, and each gates on a
        // distinct Hash2 salt so placement stays deterministic across
        // reloads (parity: identical to the JS placement at equal coords;
        // Unity's larger 144-tile world simply has more of them).
        public static bool IsCorner(int tx, int ty)
        {
            int rx = tx % Cfg.BlockTiles, ry = ty % Cfg.BlockTiles;
            return (rx == 3 || rx == 9) && (ry == 3 || ry == 9);
        }

        public static bool IsGasStation(int tx, int ty)
        {
            if (!IsCorner(tx, ty)) return false;
            return JSRng.Hash2(tx * 71, ty * 73) < 0.045;
        }

        public static bool IsPaintShop(int tx, int ty)
        {
            if (!IsCorner(tx, ty)) return false;
            if (IsGasStation(tx, ty)) return false;
            return JSRng.Hash2(tx * 59, ty * 61) < 0.045;
        }

        public static bool IsGarage(int tx, int ty)
        {
            if (!IsCorner(tx, ty)) return false;
            if (IsGasStation(tx, ty) || IsPaintShop(tx, ty)) return false;
            return JSRng.Hash2(tx * 47, ty * 53) < 0.045;
        }

        public static bool IsMart(int tx, int ty)
        {
            if (!IsCorner(tx, ty)) return false;
            if (IsGasStation(tx, ty) || IsPaintShop(tx, ty) || IsGarage(tx, ty)) return false;
            return JSRng.Hash2(tx * 83, ty * 89) < 0.045;
        }

        public static int TileType(int tx, int ty)
        {
            if (tx < 0 || ty < 0 || tx >= Cfg.World || ty >= Cfg.World) return Cfg.Bldg;
            int rx = tx % Cfg.BlockTiles, ry = ty % Cfg.BlockTiles;

            // river band: cuts across the whole city regardless of the
            // usual per-block road/park/building split. Every north-south
            // avenue (the same rx<3/rx==3 lanes that already run the length
            // of the map) keeps going straight through as a bridge; the
            // rest of the band is open water.
            if (ty >= Cfg.RiverY0 && ty < Cfg.RiverY1)
            {
                if (rx < 3) return Cfg.Road;
                if (rx == 3) return Cfg.Side;
                return Cfg.Water;
            }

            if (rx < 3 || ry < 3) return Cfg.Road;
            if (rx == 3 || rx == 9 || ry == 3 || ry == 9) return Cfg.Side;
            return JSRng.BlockHash(tx / Cfg.BlockTiles, ty / Cfg.BlockTiles) < 0.16 ? Cfg.Park : Cfg.Bldg;
        }

        // true for a block whose whole tile-row range sits inside the
        // river band — CityRenderer uses this to skip normal building/park
        // generation and lay down water + bridge deck instead.
        public static bool IsRiverBlock(int by)
        {
            int y0 = by * Cfg.BlockTiles, y1 = y0 + Cfg.BlockTiles;
            return y0 >= Cfg.RiverY0 && y1 <= Cfg.RiverY1;
        }

        public static int TypeAtPx(float x, float y)
        {
            return TileType(Mathf.FloorToInt(x / Cfg.Tile), Mathf.FloorToInt(y / Cfg.Tile));
        }

        public static bool CircleHitsBuilding(float x, float y, float r)
        {
            int minTx = Mathf.FloorToInt((x - r) / Cfg.Tile), maxTx = Mathf.FloorToInt((x + r) / Cfg.Tile);
            int minTy = Mathf.FloorToInt((y - r) / Cfg.Tile), maxTy = Mathf.FloorToInt((y + r) / Cfg.Tile);
            for (int ty = minTy; ty <= maxTy; ty++)
            {
                for (int tx = minTx; tx <= maxTx; tx++)
                {
                    int t = TileType(tx, ty);
                    if (t != Cfg.Bldg && t != Cfg.Water) continue;
                    float cx = Mathf.Max(tx * Cfg.Tile, Mathf.Min(x, tx * Cfg.Tile + Cfg.Tile));
                    float cy = Mathf.Max(ty * Cfg.Tile, Mathf.Min(y, ty * Cfg.Tile + Cfg.Tile));
                    float dx = x - cx, dy = y - cy;
                    if (dx * dx + dy * dy < r * r) return true;
                }
            }
            return false;
        }

        public static Vector2Int RandTileOf(params int[] types)
        {
            for (;;)
            {
                int tx = 2 + Random.Range(0, Cfg.World - 4);
                int ty = 2 + Random.Range(0, Cfg.World - 4);
                int t = TileType(tx, ty);
                for (int i = 0; i < types.Length; i++)
                    if (types[i] == t) return new Vector2Int(tx, ty);
            }
        }

        public static Vector2 TileCenter(Vector2Int t)
        {
            return new Vector2((t.x + 0.5f) * Cfg.Tile, (t.y + 0.5f) * Cfg.Tile);
        }

        public static bool DirValid(float x, float y, int d)
        {
            return TypeAtPx(x + Cfg.Dx[d] * Cfg.Tile * 1.6f, y + Cfg.Dy[d] * Cfg.Tile * 1.6f) == Cfg.Road;
        }
    }

    // Realism pass (Phase 5): stateless traffic-light phase logic — the one
    // source of truth shared by the traffic AI, the renderer's live lenses
    // and the headless TrafficSimTest. Everything is recomputed from the
    // block hash + game clock, so there is no stored state to desync, and
    // the lights the player SEES always match the lights the AI OBEYS.
    public static class TrafficLights
    {
        public const int Red = 0, Amber = 1, Green = 2;

        // Phase (0/1/2 = red/amber/green) a car heading in JS dir `d` sees
        // at the block-corner crossing (bx, by) at game time `time`.
        // East-west approaches (dir 0/2) share a green band, north-south
        // (dir 1/3) get the other half of the cycle. Each crossing's phase
        // offset comes from its block hash, so adjacent crossings don't
        // cycle in lockstep.
        public static int Phase(int bx, int by, int d, float time)
        {
            double off = JSRng.BlockHash(bx, by);
            double p = (time + off * Cfg.LightCycle) % Cfg.LightCycle;
            bool ew = d == 0 || d == 2;
            if (!ew) p = (p + Cfg.LightCycle * 0.5) % Cfg.LightCycle;
            if (p < Cfg.LightCycle * Cfg.LightGreenFrac) return Green;
            if (p < Cfg.LightCycle * Cfg.LightGreenFrac + Cfg.LightAmber) return Amber;
            return Red;
        }

        // Should a car approaching in JS dir `d` hold at this crossing?
        // Amber counts as go — a car that has committed shouldn't slam on.
        public static bool Stop(int bx, int by, int d, float time)
        {
            return Phase(bx, by, d, time) == Red;
        }
    }

    /* ---------------------------------------------------------- entities */

    public class CarEnt
    {
        public float X, Y, A;
        public int Dir;
        public float Speed, Cruise;
        public Color Color;
        public bool Parked, IsPlayer, Brake, Decided, Wrecked;
        public float Health = 100f;
        public float Vx, Vy;
        public CarVisual Vis;
        // Realism pass (Phase 3): set once at spawn, drives BOTH the mesh
        // silhouette (BuildCar) and the per-body-type physics lookup so a
        // car that looks like a van handles like one. Branch on Seed:
        // %8==4 → bike, else %3 picks car (0/1/2) so 3/4 of seeds keep
        // the original car mix and bikes land at ~12.5% of traffic.
        public int Seed;

        public int BodyType
        {
            get
            {
                if ((Seed & 7) == 4) return Cfg.BodyBike;
                return Seed % 3;   // follows MeshKit.BuildCar's car pick
            }
        }
    }

    // What a ped does with its life. Kept on PedEnt rather than split into
    // separate entity types so park-goers and gangsters inherit the whole
    // existing pipeline for free — visuals, the death toss, the squashed
    // rest pose, respawn and the minimap.
    public enum PedKind { Civilian, ParkGoer, Gangster }

    public class PedEnt
    {
        public float X, Y;
        public int Dir;
        public float Speed, Panic, Phase;
        public Color Shirt;
        public int Skin;
        public bool Dead;
        public float Timer;
        // toss on death (car hit or gunshot): a short airborne arc instead
        // of an instant squash, for readable collision feedback
        public float FlingVx, FlingVy, FlingT;
        public PedVisual Vis;

        // Realism pass (Phase 6): per-ped stride-rate multiplier, assigned
        // once at spawn, so a crowd's legs don't all swing in lockstep.
        // Default 1f keeps any code path that forgets to set it looking
        // exactly like the old fixed-rate walk cycle instead of freezing.
        public float StrideMult = 1f;

        public PedKind Kind;

        // ParkGoer: free wander inside the park block it was spawned in,
        // rather than following the sidewalk grid.
        public int ParkBx, ParkBy;        // the park block this one belongs to
        public float WanderT;             // seconds until it picks a new heading
        public float WanderAngle;

        // Gangster: faction, condition and firing cooldown. Target is
        // resolved fresh each step, so a dead rival is never held onto.
        public int Gang;                  // index into Cfg.GangColors
        public float Health = Cfg.GangHealth;
        public double LastShotAt = -1e9;
        public float MuzzleT;             // >0 for a few frames after firing

        // Gang wars: while the game clock is below this, the gangster
        // hunts the PLAYER instead of rivals — set when the player attacks
        // a member of this gang (see Systems.AggroGang).
        public double VendettaUntil = -1e9;
    }

    public class CopEnt
    {
        public float X, Y, A, Speed;
        public int Flash;
        public float Health = 100f;
        // T9: SWAT unit at 5★ — a heavier cruiser that takes roughly double the
        // punishment and drives faster. The initializer stays the stock
        // 100f; a SWAT spawn overrides with SwatHealth, and everything that
        // reads cop health keeps working unchanged (the flag is the delta).
        public bool Swat;
        public double LastShotAt = -1e9;   // return-fire cooldown, wanted >= 3
        public CarVisual Vis;

        // Realism pass (Phase 7): road-following pursuit. Cops now snap to
        // lanes and pick turns at intersections the same way ordinary
        // traffic does (see Systems.LaneTargets/CopLaneStep) instead of an
        // Atan2 straight-line seek that drove through buildings. Dir/Decided
        // mirror CarEnt's fields so the shared lane-snapping code can treat
        // a cop like any other car; a cop just re-decides its turn choice
        // every time (greedy toward the player's bearing) instead of once.
        public int Dir;
        public bool Decided;

        // Roadblock: a cop that has parked itself across a lane ahead of the
        // player's predicted path instead of chasing. Stationary, but still
        // takes damage/rams like any other cop car.
        public bool Roadblock;
        public double RammedAt = -1e9;     // cooldown so ramming reads as occasional, not constant
    }

    // Realism pass (Phase 7): a spike strip laid across a lane as part of a
    // roadblock at Wanted >= 3. Purely a gameplay trigger — driving over it
    // (checked in PlayerSys.Step) forces a temporary handling/speed penalty
    // on the player's car rather than doing damage, then the strip is spent.
    public class SpikeStripEnt
    {
        public float X, Y, A;   // A = lane heading, for the visual only
        public bool Spent;
        public GameObject Go;
    }

    public class PackageEnt
    {
        public float X, Y, Phase;
        public GameObject Go;
    }

    // ammo crates — same spawn/pickup shape as PackageEnt, distinct visual.
    // Gun names the crate kind (Cfg.CratePistol/Smg/Shotgun): pistol crates
    // are the original ammo boxes; the other two grant their weapon.
    public class WeaponEnt
    {
        public float X, Y, Phase;
        public int Gun;
        public GameObject Go;
    }

    public class ParticleEnt
    {
        // Realism pass (Phase 8): Splash reuses this same entity/pool
        // pipeline (see Systems.ParticlesStep/AddSplash and
        // GameLoop.SyncParticles) rather than a new list — a wheel-kicked
        // spray of drops has the same "spawn, move, fade, die" shape smoke
        // and puffs already have.
        public const byte Spark = 0, Smoke = 1, Puff = 2, Splash = 3;
        public float X, Y, Vx, Vy, Life, R;
        public byte Kind;
        public GameObject Go;
        public SpriteRenderer Sr;   // cached; avoids GetComponent every frame
    }

    public class SkidEnt
    {
        public float X, Y, A, Life;
        public GameObject Go;
        public SpriteRenderer Sr;   // cached; avoids GetComponent every frame
    }

    // the three gun tiers; WeaponKind - 1 indexes the Cfg.Weapon* stat arrays
    public enum WeaponKind { None = 0, Pistol = 1, Smg = 2, Shotgun = 3 }

        public class PlayerState
        {
            // T8: how long the player has been sitting on a gas-station tile —
            // the drive-in repair charges after GasStationSeconds, mirroring
            // game.js's gasTimer (>2s hold) so the purchase is deliberate
            public float GasTimer;
            public bool GasDone;
            // T16: the same hold pattern for the garage tile — parking 2s
            // stores the current car's build (stats/color/health) as the
            // owned ride (GarageStore, like game.js saveGarage)
            public float GarageTimer;
            public bool GarageDone;
            public float X, Y, A;
        public float Vx, Vy;
        public CarEnt InCar;
        public float Health = 100f;

        // weapon (Systems.FireWeapon / PlayerSys.Step). Weapon is the gun
        // currently in hand (None = unarmed); the Owns flags are the
        // arsenal Q cycles through. Ammo is one shared pool.
        public WeaponKind Weapon = WeaponKind.None;
        public bool OwnsPistol, OwnsSmg, OwnsShotgun;
        public int Ammo;
        public double LastFireAt = -1e9;

        // save files and old call sites still talk about "has a gun"
        public bool HasGun { get { return Weapon != WeaponKind.None; } }

        // cosmetic pick from the start screen (LTA.Hud.cs)
        public int SkinIndex;
        public Color ShirtColor = Cfg.Hex("#ffb224");

        // Realism pass (Phase 7): a temporary handling/speed penalty from
        // driving over a spike strip — decays on its own rather than being
        // a hard blowout, so it reads as "car fighting you" not "car stuck".
        public float SpikePenalty;
    }

    public enum MissionKind { Delivery, Rampage, Steal, GangWar }

    public enum Weather { Clear, Rain, Fog }   // T10: Fog is the third state

    public class GameState
    {
        public bool Started;
        public int Wanted, Score;
        public double LastCrime = -1e9;
        public double LastDecay;
        public double LastCopSpawn;

        // T5 witness-based crime reporting: a crime is reported only if a
        // living, non-panicked ped is near enough to see it. Until ReportAt
        // elapses the reporter is "on their way to the phone" — killing the
        // reporter inside the window cancels the report and the stars never
        // rise. One pending report at a time; a NEW crime while one is
        // pending re-arms the delay from now (report never silently drops
        // — the total wait can only get longer, never shorter).
        public PedEnt Reporter;                  // the ped on their way to report
        public double ReportAt = -1e9;           // game-clock time the stars land
        public bool ReportPending;

        public float Busted;
        public float Wasted;              // >0 while the WASTED screen holds; counted down in LawStep (on simDt, so a pause freezes it)
        public bool Paused;               // set via Hud.SetPaused; gates simDt in GameLoop.Update
        public float Shake;
        public double Time;                 // game clock, seconds, clamped-dt
        public string TickerMsg = "Welcome to the local city. Borrow a car, grab the amber packages.";
        public double TickerUntil = 6.0;
        public Vector2 Spawn;

        // jobs (LTA.Missions.cs) — delivery (original), plus rampage,
        // steal-a-marked-car and gang war, the newer kinds
        public bool MissionOn;
        public MissionKind MissionKind;
        public float MissionX, MissionY;
        public double MissionEnds;      // deadline on the game clock
        public double NextMissionAt;    // when the next job is offered
        public int MissionReward;
        // T7 steal-damage-cap variant: a harsher steal contract that only
        // pays if the mark still runs (health above this). 0 = no cap
        // (classic steal). Set at spawn; read in StepSteal.
        public int StealMaxDamagePct;
        // T7 reward ladder: lifetime completed jobs, persisted with the
        // save (SaveData.completedJobs, default 0 for old saves — the
        // JsonUtility contract). All mission kinds bump it.
        public int CompletedJobs;
        public int RampageGoal, RampageCount;     // cars to wreck / wrecked so far
        public CarEnt StealTarget;                // the specific car to steal + deliver
        public int GangWarGoal, GangWarCount;     // gangsters to drop / dropped so far
        public int GangWarGang;                   // the faction this contract is on

        public int HighScore;           // persisted via PlayerPrefs

        // weather (LTA.Systems.cs WeatherStep, driven from GameLoop)
        public Weather Weather = Weather.Clear;
        public double NextWeatherAt = 40.0;
        public double WeatherEnds;
        public float WeatherGrip = 1f;    // multiplies car grip; set each frame by GameLoop

        // Realism pass (Phase 7): roadblock throttle, mirrors LastCopSpawn's
        // pattern so a roadblock can't be thrown down every single frame
        // once Wanted >= 3.
        public double LastRoadblockAt = -1e9;

        // Runtime tuning overrides — Stage 2's F1 debug panel will drive
        // these; declared now (plan §1A) so adding the panel is a pure
        // read-site edit. EVERY field carries a C# initializer so the three
        // headless harnesses (which do `new GameData()` with no scene) read
        // neutral defaults: multipliers of exactly 1f are bit-identical in
        // the physics reads and the -1 sentinels are inert. A missing
        // initializer would default to 0f and silently zero acceleration —
        // keep them all.
        public float TunAccel = 1f, TunTopSpeed = 1f, TunGrip = 1f;
        public float TunCopSpawnInterval = 1.5f;   // was a literal in Systems.LawStep
        public int TunForceWeather = -1;           // -1 = auto, 0 = Clear, 1 = Rain, 2 = Fog
        public float TunDayOverride = -1f;         // -1 = follow Cfg.NightTheme, else 0..1 dayAmount
        public bool GodMode;

        public void Say(string msg)
        {
            TickerMsg = msg;
            TickerUntil = Time + 4.0;
        }
    }

    public class GameData
    {
        public readonly List<CarEnt> Cars = new List<CarEnt>();
        public readonly List<CopEnt> Cops = new List<CopEnt>();
        public readonly List<PedEnt> Peds = new List<PedEnt>();
        public readonly List<PackageEnt> Packages = new List<PackageEnt>();
        public readonly List<WeaponEnt> Weapons = new List<WeaponEnt>();
        public readonly List<ParticleEnt> Particles = new List<ParticleEnt>();
        public readonly List<SkidEnt> Skids = new List<SkidEnt>();
        public readonly List<SpikeStripEnt> SpikeStrips = new List<SpikeStripEnt>();
        public readonly PlayerState Player = new PlayerState();
        public readonly GameState State = new GameState();
    }

    // JSON-serializable snapshot for save/load (LTA.Game.cs). Deliberately
    // small: position, progress and loadout — not the whole procedural
    // world, which regenerates identically from the same tile hashes.
    [System.Serializable]
    public class SaveData
    {
        public float px, py, pa;
        public float health;
        public int ammo;
        public bool hasGun;     // legacy: owns at least the pistol
        public int weapon;      // WeaponKind in hand when saved
        public bool ownsSmg, ownsShotgun;
        public int score;
        public int wanted;
        public int highScore;
        // T7 reward ladder: lifetime completed jobs. Absent in old saves →
        // 0 by the JsonUtility contract (the tier naturally re-earns).
        public int completedJobs;
        // T16: the owned ride, saved by parking on a garage tile 2s
        // (garage world trigger — like game.js saveGarage in lta-garage).
        // Absent in old saves → invalid → no owned car spawns.
        public bool hasGarageCar;
        public int gBody;                        // Cfg.Body* index (Cfg.Body*)
        public float gR, gG, gB;                 // paint
        public float gHealth;
        public bool valid;      // guards against reading an empty PlayerPrefs string
    }

    // Persistent user settings, stored under their OWN PlayerPrefs key —
    // deliberately not part of SaveData: SaveGame() refuses to write before
    // State.Started, and volume must be changeable (and savable) from the
    // start overlay. JsonUtility leaves absent fields at their C#
    // initializer values, so old or partial JSON deserialises with
    // masterVolume = 1f — no migration code needed; `version` is here for
    // the day that stops being true.
    [System.Serializable]
    public class LtaSettings
    {
        public float masterVolume = 1f;
        public bool muted;
        public int version;
    }

    // Load/write wrapper around LtaSettings. GameLoop.Update applies
    // AudioListener.volume = MasterVolume every frame — AudioListener.volume
    // is the only multiplier that reaches PlayClipAtPoint one-shots (crash,
    // footsteps, tire screech, distant gunfire), and per-frame application
    // gives the settings screen live preview with no extra plumbing.
    // T6: GetInt/SetInt back simple non-serialized values (the radio
    // station) onto their OWN PlayerPrefs keys — deliberately NOT fields on
    // LtaSettings, because adding fields there would need a version bump on
    // the shape comment and the radio station is not a "setting" in the
    // settings-page sense (no stepper on that page drives it).
    public static class SettingsStore
    {
        const string Key = "lta_settings";
        static LtaSettings loaded;

        // T6: small int values keyed separately; a corrupt or absent key
        // reads back the caller's default
        public static int GetInt(string slot, int fallback)
        {
            return PlayerPrefs.GetInt(slot, fallback);
        }

        public static void SetInt(string slot, int value)
        {
            PlayerPrefs.SetInt(slot, value);
            PlayerPrefs.Save();
        }

        public static float MasterVolume
        {
            get { return Current().muted ? 0f : Current().masterVolume; }
            set { Current().masterVolume = Mathf.Clamp01(value); Save(); }
        }

        public static LtaSettings Current()
        {
            if (loaded == null)
            {
                LtaSettings s = null;
                try
                {
                    string json = PlayerPrefs.GetString(Key, null);
                    if (!string.IsNullOrEmpty(json)) s = JsonUtility.FromJson<LtaSettings>(json);
                }
                catch (System.Exception) { s = null; }   // corrupt key — fall back to defaults
                loaded = s ?? new LtaSettings();
                loaded.masterVolume = Mathf.Clamp01(loaded.masterVolume);
            }
            return loaded;
        }

        public static void Save()
        {
            PlayerPrefs.SetString(Key, JsonUtility.ToJson(Current()));
            PlayerPrefs.Save();
        }

        public static void ResetToDefaults()
        {
            loaded = new LtaSettings();
            Save();
        }
    }

    // Realism pass (Phase 5): a procedural traffic signal with live lenses.
    // Built once per sidewalk corner; the phase update (CityRenderer) tints
    // the three lenses every frame using the SAME stateless function the
    // traffic AI consults, so what the light shows is what cars obey.
    public class TrafficSignal
    {
        public GameObject Root;
        public MeshRenderer LensR, LensA, LensG;
        public int CornerBx, CornerBy;   // block-corner crossing this signal serves
        public int Facing;               // 0..3 JS dir the lenses face (the traffic they govern)
    }

    // visual holder types for the 3D renderer; built in LTA.Mesh3D.cs
    public class CarVisual
    {
        public GameObject Root;
        public MeshRenderer Body;
        public GameObject Lights;          // headlight pool on the road
        public MeshRenderer BrakeA, BrakeB;
        public MeshRenderer SirenA, SirenB; // cops only (lightbar)
        public SpriteRenderer SirenGlow;    // cops only
        public Transform[] Wheels;          // spun by the sync pass
        public Color BaseColor;
        // Realism pass: the two real headlight spots. Kept so the sync pass
        // can shadow the PLAYER's headlights only (Phase 2) — the player is
        // the only car whose beams deserve the cost of a shadowed spot.
        public Light[] Beams;
        // Realism pass (Phase 13): two crossed additive cone sprites standing
        // in the air in front of the headlights. Children of Lights, so the
        // existing parked/wrecked gating switches them off for free. Null when
        // Cfg.EnableLightShafts is off.
        public SpriteRenderer[] Shafts;

        // Realism pass (Phase 3): body-roll/suspension state. PrevFwd/PrevLat
        // are last frame's velocity along/across the car heading, used to
        // derive acceleration; Roll/Pitch are smoothed lean angles (degrees)
        // applied to the BODY sub-mesh only, so wheels stay grounded while
        // the cabin leans under cornering/accel/brake.
        public float PrevFwd, PrevLat, Roll, Pitch;
    }

    public class PedVisual
    {
        public GameObject Root;
        public MeshRenderer Body;
        public MeshRenderer Head;
        public Transform LegA, LegB;   // swing pivots
        public Transform ArmA, ArmB;
        // T13: per-ped proportions + panic cower. HeightScale comes from the
        // same build hash as the outfit so a ped's look stays deterministic;
        // CowerT (0 = normal, 1 = fully crouched) drives the cower blend in
        // GameLoop.SyncPeds.
        public float HeightScale = 1f;
        public float CowerT;   // sync-pass state, not set by BuildPed
    }
}
