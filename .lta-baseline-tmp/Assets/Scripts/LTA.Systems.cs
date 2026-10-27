/* ==========================================================================
   Local Theft Auto — gameplay systems, ported 1:1 from marketing/game.js.
   These operate on plain data (GameData). GameObjects are owned by the
   visual sync pass in LTA.Game.cs, which creates/destroys them as the
   entity lists change.
   ========================================================================== */
using System.Collections.Generic;
using UnityEngine;

namespace LocalTheftAuto
{
    public static class Systems
    {
        // Reusable scratch buffers for spatial-grid queries (LTA.Spatial.cs).
        // Every call site fully consumes its results before the next
        // QueryFresh, so a single list per grid type is safe.
        static readonly List<int> carScratch = new List<int>();
        static readonly List<int> pedScratch = new List<int>();

        /* ---------------------------------------------------- spawning */

        public static CarEnt MakeCar(float x, float y, int dir, bool parked)
        {
            var c = new CarEnt();
            c.X = x; c.Y = y;
            c.Dir = dir;
            c.A = dir * Mathf.PI / 2f;
            c.Speed = parked ? 0f : 70f + Random.value * 50f;
            c.Cruise = 80f + Random.value * 50f;
            c.Color = Cfg.CarPaints[Random.Range(0, Cfg.CarPaints.Length)];
            c.Parked = parked;
            c.Health = 100f;
            // Realism pass (Phase 3): seed the body type ONCE so the mesh
            // (BuildCar seed%3) and physics (CarEnt.BodyType) always agree.
            c.Seed = Random.Range(0, int.MaxValue);
            return c;
        }

        public static void SpawnWorld(GameData d)
        {
            for (int i = 0; i < Cfg.TrafficCars; i++)
            {
                Vector2 c = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Road));
                d.Cars.Add(MakeCar(c.x, c.y, Random.Range(0, 4), false));
            }
            for (int i = 0; i < Cfg.ParkedCars; i++)
            {
                Vector2 c = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Road));
                d.Cars.Add(MakeCar(c.x + 13f, c.y + 13f, Random.Range(0, 4), true));
            }
            for (int i = 0; i < Cfg.PedCount; i++)
            {
                Vector2 c = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Side));
                d.Peds.Add(new PedEnt
                {
                    X = c.x, Y = c.y,
                    Dir = Random.Range(0, 4),
                    Speed = 26f + Random.value * 18f,
                    Shirt = Cfg.CarColors[Random.Range(0, Cfg.CarColors.Length)],
                    Skin = Random.Range(0, Cfg.Skins.Length),
                    Phase = Random.value * 6.28f,
                    StrideMult = Random.Range(Cfg.PedStrideMultMin, Cfg.PedStrideMultMax)
                });
            }
            // Park crowds — these belong to the park block they spawn in and
            // mill around inside it instead of following the sidewalk grid.
            for (int i = 0; i < Cfg.ParkPedCount; i++)
            {
                Vector2Int t = CityMap.RandTileOf(Cfg.Park);
                Vector2 c = CityMap.TileCenter(t);
                d.Peds.Add(new PedEnt
                {
                    X = c.x, Y = c.y,
                    Kind = PedKind.ParkGoer,
                    ParkBx = t.x / Cfg.BlockTiles,
                    ParkBy = t.y / Cfg.BlockTiles,
                    Dir = Random.Range(0, 4),
                    Speed = Cfg.ParkWanderSpeed,
                    WanderAngle = Random.value * Mathf.PI * 2f,
                    WanderT = Random.value * 2.5f,
                    Shirt = Cfg.CarColors[Random.Range(0, Cfg.CarColors.Length)],
                    Skin = Random.Range(0, Cfg.Skins.Length),
                    Phase = Random.value * 6.28f,
                    StrideMult = Random.Range(Cfg.PedStrideMultMin, Cfg.PedStrideMultMax)
                });
            }

            // Gangs — spawned as RIVAL CLUSTERS on shared turf rather than
            // scattered individually. Scattered gangsters would each wander
            // alone and almost never meet; seeding both factions on the same
            // corner means a firefight kicks off there immediately.
            int turfs = Mathf.Max(1, Cfg.GangCount / 4);
            for (int g = 0; g < turfs; g++)
            {
                Vector2 turf = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Side, Cfg.Park));
                for (int k = 0; k < 4; k++)
                {
                    int gang = k % 2;
                    // tight cluster: rivals need to start well inside
                    // GangFireRange or the fight never gets going
                    float ang = Random.value * Mathf.PI * 2f;
                    float rad = 25f + Random.value * 55f;
                    float gx = turf.x + Mathf.Cos(ang) * rad;
                    float gy = turf.y + Mathf.Sin(ang) * rad;
                    if (CityMap.CircleHitsBuilding(gx, gy, 10f)) { gx = turf.x; gy = turf.y; }
                    d.Peds.Add(new PedEnt
                    {
                        X = gx, Y = gy,
                        Kind = PedKind.Gangster,
                        Gang = gang,
                        Health = Cfg.GangHealth,
                        Dir = Random.Range(0, 4),
                        Speed = Cfg.GangSpeed,
                        Shirt = Cfg.GangColors[gang],
                        Skin = Random.Range(0, Cfg.Skins.Length),
                        Phase = Random.value * 6.28f,
                        StrideMult = Random.Range(Cfg.PedStrideMultMin, Cfg.PedStrideMultMax)
                    });
                }
            }

            for (int i = 0; i < Cfg.PackageCount; i++)
            {
                Vector2 c = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Road, Cfg.Side));
                d.Packages.Add(new PackageEnt { X = c.x, Y = c.y, Phase = Random.value * 6.28f });
            }
            for (int i = 0; i < Cfg.WeaponPickupCount; i++)
            {
                Vector2 c = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Road, Cfg.Side));
                d.Weapons.Add(new WeaponEnt { X = c.x, Y = c.y, Phase = Random.value * 6.28f, Gun = Cfg.CratePistol });
            }
            // Gang wars: the heavier tiers are rarer finds out in the city.
            for (int i = 0; i < Cfg.SmgPickupCount; i++)
            {
                Vector2 c = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Road, Cfg.Side));
                d.Weapons.Add(new WeaponEnt { X = c.x, Y = c.y, Phase = Random.value * 6.28f, Gun = Cfg.CrateSmg });
            }
            for (int i = 0; i < Cfg.ShotgunPickupCount; i++)
            {
                Vector2 c = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Road, Cfg.Side));
                d.Weapons.Add(new WeaponEnt { X = c.x, Y = c.y, Phase = Random.value * 6.28f, Gun = Cfg.CrateShotgun });
            }
        }

        /* ---------------------------------------------------- traffic */

        struct LaneTarget { public bool HasX, HasY, Inter; public float X, Y; }

        // Realism pass (Phase 7): pulled the body of the old CarEnt-only
        // overload out into a plain (x,y,dir) version so CopStep can share
        // exactly the same lane-snap math traffic already uses instead of
        // duplicating it — a cop follows lanes exactly like a civilian car,
        // it just picks turns differently at each intersection.
        static LaneTarget LaneTargets(float x, float y, int dir)
        {
            int tx = Mathf.FloorToInt(x / Cfg.Tile), ty = Mathf.FloorToInt(y / Cfg.Tile);
            int rx = tx % Cfg.BlockTiles, ry = ty % Cfg.BlockTiles;
            var lt = new LaneTarget();
            lt.Inter = rx < 3 && ry < 3;
            if (!lt.Inter)
            {
                if (dir == 0) { lt.HasY = true; lt.Y = (ty - ry + 2.5f) * Cfg.Tile; }
                else if (dir == 2) { lt.HasY = true; lt.Y = (ty - ry + 0.5f) * Cfg.Tile; }
                else if (dir == 1) { lt.HasX = true; lt.X = (tx - rx + 2.5f) * Cfg.Tile; }
                else { lt.HasX = true; lt.X = (tx - rx + 0.5f) * Cfg.Tile; }
            }
            return lt;
        }

        static LaneTarget LaneTargets(CarEnt c) { return LaneTargets(c.X, c.Y, c.Dir); }

        static bool ProbeAhead(GameData d, CarEnt c, float dist)
        {
            float px = c.X + Cfg.Dx[c.Dir] * dist, py = c.Y + Cfg.Dy[c.Dir] * dist;
            // spatial hash: this used to scan every car in the city for every
            // car every frame (O(C^2)); query the grid for the probe circle
            // instead — same exact 30px check, far fewer candidates
            Spatial.Cars.QueryFresh(d, d.Cars, px, py, 30f, carScratch);
            for (int i = 0; i < carScratch.Count; i++)
            {
                CarEnt o = d.Cars[carScratch[i]];
                if (o == c || o.Parked) continue;
                float dx = o.X - px, dy = o.Y - py;
                if (dx * dx + dy * dy < 30f * 30f) return true;
            }
            if (d.Player.InCar != null && d.Player.InCar != c)
            {
                float ax = d.Player.InCar.X - px, ay = d.Player.InCar.Y - py;
                if (ax * ax + ay * ay < 30f * 30f) return true;
            }
            if (d.Player.InCar == null)
            {
                float bx = d.Player.X - px, by = d.Player.Y - py;
                if (bx * bx + by * by < 40f * 40f) return true;
            }
            return false;
        }

        public static void TrafficStep(GameData d, CarEnt c, float dt)
        {
            if (c.Parked || c.IsPlayer || c.Wrecked) return;
            LaneTarget lt = LaneTargets(c);
            if (lt.Inter)
            {
                if (!c.Decided)
                {
                    c.Decided = true;
                    // straight is twice as likely as each turn
                    int[] opts = new int[4]; int n = 0;
                    if (CityMap.DirValid(c.X, c.Y, c.Dir)) { opts[n++] = c.Dir; opts[n++] = c.Dir; }
                    int r = (c.Dir + 1) % 4, l = (c.Dir + 3) % 4;
                    if (CityMap.DirValid(c.X, c.Y, r)) opts[n++] = r;
                    if (CityMap.DirValid(c.X, c.Y, l)) opts[n++] = l;
                    if (n > 0) c.Dir = opts[Random.Range(0, n)];
                    c.A = c.Dir * Mathf.PI / 2f;
                }
            }
            else
            {
                c.Decided = false;
                float k = Mathf.Min(1f, 4f * dt);
                if (lt.HasX) c.X += (lt.X - c.X) * k;
                if (lt.HasY) c.Y += (lt.Y - c.Y) * k;
            }

            // Realism pass (Phase 5): traffic lights. A car approaching a
            // block-corner crossing on red for its direction brakes before
            // the stop line; a car already past the line (or mid-crossing)
            // is committed and goes. Player cars are exempt — lights govern
            // AI traffic only. Stateless: the phase is recomputed from the
            // block hash + clock with the SAME function the renderer uses,
            // so what the light SHOWS is exactly what the AI OBEYS.
            bool atRed = false;
            {
                int txx = Mathf.FloorToInt(c.X / Cfg.Tile);
                int tyy = Mathf.FloorToInt(c.Y / Cfg.Tile);
                int cbx = txx / Cfg.BlockTiles, cby = tyy / Cfg.BlockTiles;
                int rxx = txx % Cfg.BlockTiles, ryy = tyy % Cfg.BlockTiles;
                float line = 0f, dist = float.MaxValue;
                // stop line = the near edge of the crossing zone (rx/ry in
                // [0,3)) along the travel direction; dist < 0 means already
                // inside the box -> committed.
                if (c.Dir == 0) { if (rxx >= 3) { cbx++; line = cbx * Cfg.BlockTiles * Cfg.Tile; dist = line - c.X; } }
                else if (c.Dir == 2) { line = cbx * Cfg.BlockTiles * Cfg.Tile + 3f * Cfg.Tile; dist = c.X - line; }
                else if (c.Dir == 1) { if (ryy >= 3) { cby++; line = cby * Cfg.BlockTiles * Cfg.Tile; dist = line - c.Y; } }
                else { line = cby * Cfg.BlockTiles * Cfg.Tile + 3f * Cfg.Tile; dist = c.Y - line; }
                if (dist >= 0f && dist < Cfg.LightStopDist)
                    atRed = TrafficLights.Stop(cbx, cby, c.Dir, (float)d.State.Time);
            }

            c.Brake = ProbeAhead(d, c, 56f) || atRed;
            // Realism pass (Phase 3): per-body-type cruise multiplier so a
            // van-shaped car cruises slower than a sedan in traffic too,
            // matching its (slower) player accel feel.
            float target = c.Brake ? 0f : c.Cruise * Cfg.BodyCruiseMult[c.BodyType];
            // Realism pass (Phase 14): traffic now speeds up and slows down
            // with the SAME per-body accel/brake figures the player's car
            // uses (LTA.Player.cs), instead of a generic 4x/1.2x exponential
            // blend — a van in traffic takes as long to get rolling, and
            // needs as much road to stop, as a van the player is driving.
            if (target < c.Speed)
                c.Speed = Mathf.Max(target, c.Speed - Cfg.BodyBrake[c.BodyType] * dt);
            else if (target > c.Speed)
            {
                float band = Mathf.Lerp(1f, Cfg.PowerBandFloor, Mathf.Clamp01(c.Speed / Cfg.BodyTopSpeed[c.BodyType]));
                c.Speed = Mathf.Min(target, c.Speed + Cfg.BodyAccel[c.BodyType] * band * dt);
            }
            float nx = c.X + Cfg.Dx[c.Dir] * c.Speed * dt;
            float ny = c.Y + Cfg.Dy[c.Dir] * c.Speed * dt;
            if (!CityMap.CircleHitsBuilding(nx, ny, 14f)) { c.X = nx; c.Y = ny; }
            else
            {
                // Fix over the JS original: keep the sprite facing the travel
                // direction when a car U-turns off a building (in the JS the
                // car visibly drives backwards until the next intersection).
                c.Dir = (c.Dir + 2) % 4;
                c.A = c.Dir * Mathf.PI / 2f;
            }
        }

        /* ------------------------------------------------------- peds */

        public static void PedStep(GameData d, PedEnt p, float dt)
        {
            if (p.Dead)
            {
                p.Timer -= dt;
                // short airborne toss right after death, then settle — see
                // FlingVx/FlingVy comment on PedEnt
                if (p.FlingT > 0f)
                {
                    p.FlingT = Mathf.Max(0f, p.FlingT - dt);
                    float fnx = p.X + p.FlingVx * dt, fny = p.Y + p.FlingVy * dt;
                    if (!CityMap.CircleHitsBuilding(fnx, fny, 8f)) { p.X = fnx; p.Y = fny; }
                    p.FlingVx *= Mathf.Max(0f, 1f - 3.2f * dt);
                    p.FlingVy *= Mathf.Max(0f, 1f - 3.2f * dt);
                }
                return;
            }
            p.Phase += dt * (p.Panic > 0 ? 16f : 8f) * p.StrideMult;
            if (p.Panic > 0) p.Panic -= dt;
            else
            {
                // Realism pass (Phase 6): near-miss awareness. Any moving
                // car can spook a ped now — AI traffic included, not only
                // "the player's car" as a special case (d.Cars already
                // holds the player's car while it's driven, so this
                // subsumes the old check) — and the reaction scales with
                // how close the near-miss actually was instead of a flat
                // flinch/no-flinch threshold at one fixed radius. A car
                // grazing the outer edge of PedNearMissRadius barely
                // registers; inside PedPanicRadius it's a full flinch.
                float bestAmount = 0f;
                int bestDir = p.Dir;
                // spatial hash: only cars whose cell overlaps the awareness
                // radius are candidates; the exact distSq check below is
                // unchanged from the old full scan
                Spatial.Cars.QueryFresh(d, d.Cars, p.X, p.Y, Cfg.PedNearMissRadius, carScratch);
                for (int ci = 0; ci < carScratch.Count; ci++)
                {
                    CarEnt c = d.Cars[carScratch[ci]];
                    if (c.Parked || c.Wrecked) continue;
                    float speed = Mathf.Abs(c.Speed);
                    if (speed < Cfg.PedNearMissSpeed) continue;
                    float dx = p.X - c.X, dy = p.Y - c.Y;
                    float distSq = dx * dx + dy * dy;
                    if (distSq >= Cfg.PedNearMissRadius * Cfg.PedNearMissRadius) continue;
                    float dist = Mathf.Sqrt(distSq);
                    float prox = Mathf.Clamp01(1f - (dist - Cfg.PedPanicRadius) /
                        Mathf.Max(1f, Cfg.PedNearMissRadius - Cfg.PedPanicRadius));
                    // faster traffic reads as more threatening at the same distance
                    float speedT = Mathf.Clamp01(speed / 220f);
                    float amount = prox * (0.5f + 0.5f * speedT);
                    if (amount > bestAmount)
                    {
                        bestAmount = amount;
                        bestDir = Mathf.Abs(dx) > Mathf.Abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
                    }
                }
                if (bestAmount > 0.02f)
                {
                    p.Panic = Mathf.Lerp(Cfg.PedPanicMin, Cfg.PedPanicMax, bestAmount);
                    p.Dir = bestDir;
                }
            }
            // Realism pass (Phase 6): crowd-scare propagation. A panicking
            // ped has a small per-second chance to spook ONE nearby calm
            // neighbour (not every neighbour at once — that would flash the
            // whole cluster into panic in a single frame and read as a
            // scripted event rather than a scare rippling outward).
            if (p.Panic > 0f && Random.value < Cfg.CrowdScareChancePerSec * dt)
            {
                float scareSq = Cfg.CrowdScareRadius * Cfg.CrowdScareRadius;
                Spatial.Peds.QueryFresh(d, d.Peds, p.X, p.Y, Cfg.CrowdScareRadius, pedScratch);
                for (int oi = 0; oi < pedScratch.Count; oi++)
                {
                    PedEnt o = d.Peds[pedScratch[oi]];
                    if (o == p || o.Dead || o.Panic > 0f) continue;
                    float odx = o.X - p.X, ody = o.Y - p.Y;
                    if (odx * odx + ody * ody < scareSq)
                    {
                        o.Panic = Cfg.PedPanicMin;
                        o.Dir = p.Dir;
                        break;
                    }
                }
            }
            // Kind-specific behaviour. Panic above is shared — a speeding car
            // scatters park crowds and gangsters too — but where they go next
            // differs, and neither of them uses the sidewalk grid.
            if (p.Kind == PedKind.Gangster) { GangStep(d, p, dt); return; }
            if (p.Kind == PedKind.ParkGoer) { ParkWander(p, dt); return; }

            float sp = p.Panic > 0 ? 85f : p.Speed;
            float nx = p.X + Cfg.Dx[p.Dir] * sp * dt;
            float ny = p.Y + Cfg.Dy[p.Dir] * sp * dt;
            if (CityMap.TypeAtPx(nx, ny) == Cfg.Side) { p.X = nx; p.Y = ny; }
            else
            {
                int[] opts = new int[4]; int n = 0;
                for (int dir = 0; dir < 4; dir++)
                    if (CityMap.TypeAtPx(p.X + Cfg.Dx[dir] * 30f, p.Y + Cfg.Dy[dir] * 30f) == Cfg.Side)
                        opts[n++] = dir;
                p.Dir = n > 0 ? opts[Random.Range(0, n)] : (p.Dir + 2) % 4;
            }
        }

        // Park-goers roam freely inside the park block that owns them rather
        // than following the sidewalk grid: pick a heading, hold it a second
        // or two, then turn. Bouncing off the block edge back toward the
        // middle is what makes it read as loitering and playing in the park
        // instead of commuting through it.
        static void ParkWander(PedEnt p, float dt)
        {
            p.WanderT -= dt;
            if (p.WanderT <= 0f)
            {
                p.WanderAngle += (Random.value - 0.5f) * 2.4f;
                p.WanderT = 0.8f + Random.value * 2.2f;
            }

            float sp = p.Panic > 0 ? 78f : p.Speed;
            float nx = p.X + Mathf.Cos(p.WanderAngle) * sp * dt;
            float ny = p.Y + Mathf.Sin(p.WanderAngle) * sp * dt;

            int btx = Mathf.FloorToInt(nx / Cfg.Tile) / Cfg.BlockTiles;
            int bty = Mathf.FloorToInt(ny / Cfg.Tile) / Cfg.BlockTiles;
            bool home = btx == p.ParkBx && bty == p.ParkBy;

            if (home && CityMap.TypeAtPx(nx, ny) == Cfg.Park)
            {
                p.X = nx; p.Y = ny;
            }
            else
            {
                // turn back toward the centre of the home park block
                float cx = (p.ParkBx * Cfg.BlockTiles + Cfg.BlockTiles * 0.5f) * Cfg.Tile;
                float cy = (p.ParkBy * Cfg.BlockTiles + Cfg.BlockTiles * 0.5f) * Cfg.Tile;
                p.WanderAngle = Mathf.Atan2(cy - p.Y, cx - p.X) + (Random.value - 0.5f) * 0.8f;
                p.WanderT = 0.6f + Random.value * 0.8f;
            }

            p.Dir = AngleToDir(p.WanderAngle);
        }

        // Snap a free heading onto the 4-way facing the ped visuals use.
        static int AngleToDir(float a)
        {
            float c = Mathf.Cos(a), s = Mathf.Sin(a);
            if (Mathf.Abs(c) > Mathf.Abs(s)) return c > 0 ? 0 : 2;
            return s > 0 ? 1 : 3;
        }

        /* ------------------------------------------------------- gangs */

        // Two rival gangs holding turf and shooting at each other. Driven from
        // PedStep so gangsters inherit the whole existing ped pipeline — the
        // death toss, the squashed rest pose, respawn, the lot — and the only
        // extra state is a faction, health and a firing cooldown.
        //
        // Deliberately simple: pick the nearest living rival each step, close
        // to firing range, then trade shots on a stagger. Nothing here paths
        // around buildings, so a rival on the far side of a block is advanced
        // on until the collision check stops the move and the fight stalls
        // there — which looks like taking cover, and never walks through a wall.
        //
        // Gang wars: while a vendetta is live (the player attacked one of
        // theirs — see AggroGang) the PLAYER outranks any rival as a target,
        // until chased too far or the grudge runs out.
        static void GangStep(GameData d, PedEnt p, float dt)
        {
            double t = d.State.Time;
            if (p.MuzzleT > 0f) p.MuzzleT = Mathf.Max(0f, p.MuzzleT - dt);

            PedEnt target = null;
            float bestSq = Cfg.GangSightRange * Cfg.GangSightRange;
            // spatial hash: rivals are found inside GangSightRange, so only
            // peds in cells overlapping that circle are worth measuring
            Spatial.Peds.QueryFresh(d, d.Peds, p.X, p.Y, Cfg.GangSightRange, pedScratch);
            for (int i = 0; i < pedScratch.Count; i++)
            {
                PedEnt o = d.Peds[pedScratch[i]];
                if (o == p || o.Dead || o.Kind != PedKind.Gangster || o.Gang == p.Gang) continue;
                float ox = o.X - p.X, oy = o.Y - p.Y;
                float sq = ox * ox + oy * oy;
                if (sq < bestSq) { bestSq = sq; target = o; }
            }

            // The player as a target: live grudge, and still roughly nearby
            // (a vendetta doesn't chase across the whole city).
            float pdx = d.Player.X - p.X, pdy = d.Player.Y - p.Y;
            float pdSq = pdx * pdx + pdy * pdy;
            float chaseCap = Cfg.GangSightRange * 1.5f;
            bool huntPlayer = t < p.VendettaUntil && pdSq < chaseCap * chaseCap;
            // prefer the player when there's no rival, or the player is
            // meaningfully closer than the nearest rival
            bool aimPlayer = huntPlayer && (target == null || pdSq < bestSq * 1.44f);

            if (target == null && !aimPlayer)
            {
                // nobody to fight — hang around the corner
                p.WanderT -= dt;
                if (p.WanderT <= 0f)
                {
                    p.WanderAngle += (Random.value - 0.5f) * 2.6f;
                    p.WanderT = 1f + Random.value * 2f;
                }
                float wsp = p.Panic > 0 ? 78f : 18f;
                float wx = p.X + Mathf.Cos(p.WanderAngle) * wsp * dt;
                float wy = p.Y + Mathf.Sin(p.WanderAngle) * wsp * dt;
                if (!CityMap.CircleHitsBuilding(wx, wy, 8f)) { p.X = wx; p.Y = wy; }
                else p.WanderAngle += 2.2f;
                p.Dir = AngleToDir(p.WanderAngle);
                return;
            }

            float tdx = aimPlayer ? pdx : target.X - p.X;
            float tdy = aimPlayer ? pdy : target.Y - p.Y;
            float dist = Mathf.Sqrt(Mathf.Max(0.0001f, tdx * tdx + tdy * tdy));
            float ang = Mathf.Atan2(tdy, tdx);
            p.Dir = AngleToDir(ang);

            // MOVEMENT — close to a comfortable firing distance and hold there.
            // Deliberately independent of the firing check below. These were
            // once an if/else, which meant anyone outside fire range only ever
            // advanced and never shot; combined with there being no pathing, a
            // rival on the far side of a building stalled the fight for good.
            // The headless sim test caught it: 0 kills, 19/48 ever firing.
            float hold = Cfg.GangFireRange * 0.7f;
            if (dist > hold)
            {
                float sp = p.Panic > 0 ? 78f : p.Speed;
                float mx = Mathf.Cos(ang) * sp * dt;
                float my = Mathf.Sin(ang) * sp * dt;
                if (!CityMap.CircleHitsBuilding(p.X + mx, p.Y + my, 8f))
                {
                    p.X += mx; p.Y += my;
                }
                else
                {
                    // Blocked. Slide along the obstruction rather than grinding
                    // into it, so a firefight works its way around a corner
                    // instead of freezing against a wall.
                    float side = ang + Mathf.PI * 0.5f;
                    float sx = Mathf.Cos(side) * sp * dt;
                    float sy = Mathf.Sin(side) * sp * dt;
                    if (!CityMap.CircleHitsBuilding(p.X + sx, p.Y + sy, 8f)) { p.X += sx; p.Y += sy; }
                    else if (!CityMap.CircleHitsBuilding(p.X - sx, p.Y - sy, 8f)) { p.X -= sx; p.Y -= sy; }
                }
            }

            // FIRING — whenever the current target is inside range and the
            // cooldown is up, whether or not this one is still closing the gap.
            if (dist <= Cfg.GangFireRange && t - p.LastShotAt > Cfg.GangFireCooldown)
            {
                // stagger the next shot so a whole gang never volleys in lockstep
                p.LastShotAt = t + Random.value * 0.3;
                p.MuzzleT = 0.08f;

                AddSparks(d, p.X + Mathf.Cos(ang) * 12f, p.Y + Mathf.Sin(ang) * 12f, 3);

                if (aimPlayer)
                {
                    // the player IS the target — DamageCar handles both
                    // "in a car" and "on foot" (it always hits p.Health and
                    // syncs the car when there is one)
                    AddSparks(d, d.Player.X, d.Player.Y, 4);
                    DamageCar(d, Cfg.GangPlayerDamage, d.Player.X, d.Player.Y);
                    return;
                }

                AddSparks(d, target.X, target.Y, 4);

                target.Health -= Cfg.GangDamage;
                if (target.Health <= 0f) KillGangster(d, target, ang);

                // Stray rounds. Standing in the middle of a firefight should
                // hurt, so project the player onto the line of fire and check
                // how far off it they are.
                float sx = d.Player.X - p.X, sy = d.Player.Y - p.Y;
                float along = sx * Mathf.Cos(ang) + sy * Mathf.Sin(ang);
                if (along > 0f && along < dist)
                {
                    float perp = Mathf.Abs(-sx * Mathf.Sin(ang) + sy * Mathf.Cos(ang));
                    if (perp < Cfg.GangStrayRange)
                        DamageCar(d, Cfg.GangStrayDamage, d.Player.X, d.Player.Y);
                }
            }
        }

        static void KillGangster(GameData d, PedEnt v, float fromAngle)
        {
            v.Dead = true;
            v.Timer = 7f;
            v.FlingT = 0.35f;
            v.FlingVx = Mathf.Cos(fromAngle) * 95f;
            v.FlingVy = Mathf.Sin(fromAngle) * 95f;
            AddSmoke(d, v.X, v.Y);
        }

        public static void RespawnDeadPeds(GameData d)
        {
            for (int k = 0; k < d.Peds.Count; k++)
            {
                PedEnt p = d.Peds[k];
                if (p.Dead && p.Timer <= 0f)
                {
                    // Come back as what you were: park-goers back into a park
                    // (re-homed to whichever block they land in), gangsters
                    // back on turf at full health so the war keeps running.
                    if (p.Kind == PedKind.ParkGoer)
                    {
                        Vector2Int t = CityMap.RandTileOf(Cfg.Park);
                        Vector2 pc = CityMap.TileCenter(t);
                        p.X = pc.x; p.Y = pc.y;
                        p.ParkBx = t.x / Cfg.BlockTiles;
                        p.ParkBy = t.y / Cfg.BlockTiles;
                        p.WanderAngle = Random.value * Mathf.PI * 2f;
                    }
                    else if (p.Kind == PedKind.Gangster)
                    {
                        Vector2 gc = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Side, Cfg.Park));
                        p.X = gc.x; p.Y = gc.y;
                        p.Health = Cfg.GangHealth;
                        p.LastShotAt = -1e9;
                        p.MuzzleT = 0f;
                        // a fresh face holds no grudges
                        p.VendettaUntil = -1e9;
                    }
                    else
                    {
                        Vector2 c = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Side));
                        p.X = c.x; p.Y = c.y;
                    }
                    p.Dead = false;
                }
            }
        }

        /* ----------------------------------------------------- police */

        // Realism pass (Phase 7): road-following pursuit. Cops used to seek
        // the player in a straight Atan2 line, happy to drive through
        // buildings and cut every corner — replaced with the SAME
        // lane-snapping TrafficStep gives ordinary traffic, plus a cheap
        // greedy heuristic at each intersection: of the turns the road
        // actually allows, pick whichever bearing is closest to "toward the
        // player" (no real pathfinding — consistent with the existing gang
        // AI's deliberately-simple style; it's not going to route around a
        // whole block, but it will always be ON a road).
        public static void CopStep(GameData d, CopEnt c, float dt, double t)
        {
            // A parked roadblock cop doesn't chase — it just sits across the
            // lane, flashers going, waiting for the player to hit it or the
            // spike strip next to it. Still eligible for return fire below.
            if (c.Roadblock)
            {
                c.Speed = 0f;
                c.Flash = Mathf.FloorToInt((float)t * 7f) % 2;
            }
            else
            {
                LaneTarget lt = LaneTargets(c.X, c.Y, c.Dir);
                if (lt.Inter)
                {
                    if (!c.Decided)
                    {
                        c.Decided = true;
                        float tx = d.Player.X + d.Player.Vx * 0.35f;
                        float ty = d.Player.Y + d.Player.Vy * 0.35f;
                        float want = Mathf.Atan2(ty - c.Y, tx - c.X);
                        int best = c.Dir; float bestDiff = float.MaxValue;
                        for (int turn = 0; turn < 4; turn++)
                        {
                            if (!CityMap.DirValid(c.X, c.Y, turn)) continue;
                            float diff = Mathf.Abs(Mathf.DeltaAngle(want * Mathf.Rad2Deg, turn * 90f));
                            if (diff < bestDiff) { bestDiff = diff; best = turn; }
                        }
                        c.Dir = best;
                        c.A = c.Dir * Mathf.PI / 2f;
                    }
                }
                else
                {
                    c.Decided = false;
                    float k = Mathf.Min(1f, 4f * dt);
                    if (lt.HasX) c.X += (lt.X - c.X) * k;
                    if (lt.HasY) c.Y += (lt.Y - c.Y) * k;
                }

                // wanted-level escalation: backup drives faster the more
                // stars are showing, same read as the JS original but with a
                // visible top end instead of a flat pursuit speed
                float sp = 155f + d.State.Wanted * 10f;
                // Realism pass (Phase 14): cops used to snap straight to the
                // pursuit speed every frame — zero inertia, unlike every
                // other car in the sim. They're always Sedan (Cfg.BodySedan),
                // so they now spool up/brake with the same accel/brake
                // figures a player-driven sedan gets.
                if (sp < c.Speed)
                    c.Speed = Mathf.Max(sp, c.Speed - Cfg.BodyBrake[Cfg.BodySedan] * dt);
                else if (sp > c.Speed)
                {
                    float band = Mathf.Lerp(1f, Cfg.PowerBandFloor, Mathf.Clamp01(c.Speed / Cfg.BodyTopSpeed[Cfg.BodySedan]));
                    c.Speed = Mathf.Min(sp, c.Speed + Cfg.BodyAccel[Cfg.BodySedan] * band * dt);
                }
                float nx = c.X + Cfg.Dx[c.Dir] * c.Speed * dt;
                float ny = c.Y + Cfg.Dy[c.Dir] * c.Speed * dt;
                if (!CityMap.CircleHitsBuilding(nx, ny, 14f)) { c.X = nx; c.Y = ny; }
                else { c.Dir = (c.Dir + 2) % 4; c.A = c.Dir * Mathf.PI / 2f; }
                c.Flash = Mathf.FloorToInt((float)t * 7f) % 2;
            }

            // at 3+ stars, cops in range take potshots — chip damage, not a
            // one-shot, so the fight stays about outrunning them
            float dx = c.X - d.Player.X, dy = c.Y - d.Player.Y;
            float distSq = dx * dx + dy * dy;
            if (d.State.Wanted >= 3 && distSq < 200f * 200f && distSq > 40f * 40f
                && t - c.LastShotAt > 1.1)
            {
                c.LastShotAt = t;
                DamageCar(d, 6f + d.State.Wanted * 1.5f, d.Player.X, d.Player.Y);
            }

            // Realism pass (Phase 7): ramming. Cops and the player are
            // separate entity lists (CopEnt vs CarEnt) so — unlike car-car
            // traffic — they never physically collided before this; only
            // ranged chip damage above. At high Wanted, a cop that's driven
            // right up against the player nudges them, on a per-cop cooldown
            // so it reads as occasional deliberate contact, not a constant
            // shove from every cop touching the player at once.
            if (d.State.Wanted >= Cfg.RamMinWanted && !c.Roadblock
                && d.Player.InCar != null && t - c.RammedAt > Cfg.RamCooldown)
            {
                float dist = Mathf.Sqrt(Mathf.Max(0.0001f, distSq));
                if (dist < 32f)
                {
                    c.RammedAt = t;
                    CarEnt pc = d.Player.InCar;
                    float nxo = -dx / dist, nyo = -dy / dist; // from cop toward player
                    pc.Vx += nxo * Cfg.RamImpulse; pc.Vy += nyo * Cfg.RamImpulse;
                    DamageCar(d, Cfg.RamDamage, pc.X, pc.Y);
                }
            }
        }

        // Realism pass (Phase 7): drop a stationary roadblock (one cop
        // parked across a lane) plus a spike strip beside it, somewhere
        // ahead of the player's predicted path. Reuses the existing
        // cop-spawn throttle pattern (LawStep already rate-limits ordinary
        // spawns the same way) so this can't fire every frame.
        static void TrySpawnRoadblock(GameData d, double t)
        {
            var s = d.State;
            var p = d.Player;
            if (s.Wanted < Cfg.RamMinWanted) return;
            if (t - s.LastRoadblockAt < Cfg.RoadblockCooldown) return;

            float headA = p.InCar != null ? p.InCar.A : Mathf.Atan2(p.Vy, p.Vx);
            int dir = Mathf.RoundToInt(headA / (Mathf.PI / 2f)) & 3;
            float px = p.X + Cfg.Dx[dir] * Cfg.RoadblockLeadDist;
            float py = p.Y + Cfg.Dy[dir] * Cfg.RoadblockLeadDist;

            // walk along the lane looking for an actual road tile near that
            // lead point — the straight projection can land in a building
            for (float back = 0f; back < 220f; back += Cfg.Tile)
            {
                float qx = px - Cfg.Dx[dir] * back, qy = py - Cfg.Dy[dir] * back;
                if (CityMap.TypeAtPx(qx, qy) != Cfg.Road) continue;

                s.LastRoadblockAt = t;
                var cop = new CopEnt { X = qx, Y = qy, A = (dir + 1) * Mathf.PI / 2f, Dir = (dir + 1) % 4, Roadblock = true };
                d.Cops.Add(cop);
                d.SpikeStrips.Add(new SpikeStripEnt { X = qx, Y = qy, A = headA });
                s.Say("Roadblock ahead. The local police mean it this time.");
                return;
            }
        }

        // Realism pass (Phase 7): apply/expire the spike-strip handling
        // penalty and consume a strip the player's car drives over. Purely a
        // gameplay effect (speed/grip multiplier), never damage — matches
        // the plan's "forces a penalty, not damage" acceptance note.
        public static void SpikeStep(GameData d, float dt)
        {
            var p = d.Player;
            if (p.SpikePenalty > 0f) p.SpikePenalty = Mathf.Max(0f, p.SpikePenalty - dt / Cfg.SpikePenaltyDuration);
            if (p.InCar == null) return;
            CarEnt car = p.InCar;
            for (int i = 0; i < d.SpikeStrips.Count; i++)
            {
                SpikeStripEnt sp = d.SpikeStrips[i];
                if (sp.Spent) continue;
                float dx = car.X - sp.X, dy = car.Y - sp.Y;
                if (dx * dx + dy * dy < Cfg.SpikeHitRadius * Cfg.SpikeHitRadius)
                {
                    sp.Spent = true;
                    p.SpikePenalty = 1f;
                    d.State.Say("Tires shredded. Handling's shot for a few seconds.");
                }
            }
        }

        // One deliberate deviation from the JS original, which has a bug:
        // there, lawStep() contains the busted countdown but the main loop
        // stops calling it while busted > 0, so "BUSTED" freezes forever.
        // Here the countdown always runs while started; pursuit is frozen
        // during the bust exactly like the JS intended.
        public static void LawStep(GameData d, double t, float dt)
        {
            var s = d.State;
            var p = d.Player;

            // pursuit/spawn/roadblock gate — frozen during the BUSTED beat
            // (as before) and during the WASTED beat (the player is being
            // respawned; there is nothing to pursue and nobody to arrest)
            if (s.Busted <= 0f && s.Wasted <= 0f)
            {
                if (s.Wanted > 0 && t - s.LastCrime > 7.0 && t - s.LastDecay > 4.0)
                {
                    s.LastDecay = t;
                    s.Wanted -= 1;
                    if (s.Wanted == 0) s.Say("The heat cooled down. Locally.");
                }
                while (d.Cops.Count < s.Wanted && t - s.LastCopSpawn > s.TunCopSpawnInterval)
                {
                    s.LastCopSpawn = t;
                    float ang = Random.value * Mathf.PI * 2f;
                    for (float r = 700f; r < 1400f; r += 100f)
                    {
                        float x = p.X + Mathf.Cos(ang) * r;
                        float y = p.Y + Mathf.Sin(ang) * r;
                        if (CityMap.TypeAtPx(x, y) == Cfg.Road)
                        {
                            int dir = Random.Range(0, 4);
                            d.Cops.Add(new CopEnt { X = x, Y = y, Dir = dir, A = dir * Mathf.PI / 2f });
                            break;
                        }
                    }
                }
                // Realism pass (Phase 7): roadblocks/spike strips at Wanted>=3.
                TrySpawnRoadblock(d, t);
                if (s.Wanted == 0 && d.Cops.Count > 0) d.Cops.Clear();
                if (s.Wanted == 0 && d.SpikeStrips.Count > 0) d.SpikeStrips.Clear();

                for (int i = d.Cops.Count - 1; i >= 0; i--)
                {
                    CopEnt cop = d.Cops[i];
                    if (cop.Health <= 0f)
                    {
                        // one cruiser down — a fresh one still spawns while
                        // wanted stars remain, so this thins the pack rather
                        // than clearing the wanted level
                        AddSparks(d, cop.X, cop.Y, 8);
                        AddSmoke(d, cop.X, cop.Y);
                        d.Cops.RemoveAt(i);
                        continue;
                    }
                    CopStep(d, cop, dt, t);
                    float dx = cop.X - p.X, dy = cop.Y - p.Y;
                    // never arrest a corpse — the WASTED beat owns the player now
                    if (dx * dx + dy * dy < 36f * 36f && s.Busted <= 0f && s.Wasted <= 0f)
                    {
                        s.Busted = 2.4f;
                        s.Say("BUSTED. Processed, fined, and released — entirely on this machine.");
                    }
                }
            }

            if (s.Busted > 0f)
            {
                s.Busted -= dt;
                if (s.Busted <= 0f)
                {
                    s.Wanted = 0;
                    d.Cops.Clear();
                    d.SpikeStrips.Clear();
                    if (p.InCar != null)
                    {
                        p.InCar.IsPlayer = false;
                        p.InCar.Parked = true;
                        p.InCar.Speed = 0f; p.InCar.Vx = 0f; p.InCar.Vy = 0f;
                        p.InCar = null;
                    }
                    p.X = s.Spawn.x; p.Y = s.Spawn.y;
                    p.Vx = 0f; p.Vy = 0f;
                    p.Health = 100f;
                    p.SpikePenalty = 0f;
                }
            }

            // WASTED screen-hold timer, mirroring the Busted countdown above.
            // Deliberate ordering difference from the arrest: KillPlayer
            // teleports IMMEDIATELY and uses Wasted purely as a screen-hold
            // timer, whereas the arrest resolves (teleports) only when its
            // countdown expires. Don't "fix" one into the other — an
            // immediate teleport under a frozen overlay avoids a visible pop
            // when it lifts. The dt here is GameLoop's simDt, so a pause
            // freezes this exactly like the Busted countdown.
            if (s.Wasted > 0f)
            {
                s.Wasted -= dt;
                if (s.Wasted <= 0f) s.Wasted = 0f;
            }
        }

        /* ---------------------------------------------------- pickups */

        public static void PickupStep(GameData d)
        {
            var s = d.State;
            for (int i = 0; i < d.Packages.Count; i++)
            {
                PackageEnt pk = d.Packages[i];
                float dx = pk.X - d.Player.X, dy = pk.Y - d.Player.Y;
                if (dx * dx + dy * dy < 30f * 30f)
                {
                    s.Score += 100;
                    s.Say("Package secured. +100. It was always going to stay on this machine.");
                    Vector2 c = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Road, Cfg.Side));
                    pk.X = c.x; pk.Y = c.y;
                }
            }
        }

        public static void WeaponPickupStep(GameData d)
        {
            var p = d.Player;
            for (int i = 0; i < d.Weapons.Count; i++)
            {
                WeaponEnt w = d.Weapons[i];
                float dx = w.X - p.X, dy = w.Y - p.Y;
                if (dx * dx + dy * dy < 30f * 30f)
                {
                    bool firstGun = !p.HasGun;
                    p.Ammo = Mathf.Min(Cfg.AmmoMax, p.Ammo + Cfg.AmmoPerPickup[w.Gun]);
                    if (w.Gun == Cfg.CrateSmg)
                    {
                        p.OwnsSmg = true;
                        p.Weapon = WeaponKind.Smg;
                        d.State.Say(p.OwnsPistol || p.OwnsShotgun
                            ? "SMG acquired. Q swaps weapons, left click / F to fire."
                            : "SMG acquired. Hold left click / F to fire, on foot.");
                    }
                    else if (w.Gun == Cfg.CrateShotgun)
                    {
                        p.OwnsShotgun = true;
                        p.Weapon = WeaponKind.Shotgun;
                        d.State.Say(p.OwnsPistol || p.OwnsSmg
                            ? "Shotgun acquired. Q swaps weapons, left click / F to fire."
                            : "Shotgun acquired. Left click / F to fire, on foot.");
                    }
                    else
                    {
                        p.OwnsPistol = true;
                        if (p.Weapon == WeaponKind.None) p.Weapon = WeaponKind.Pistol;
                        d.State.Say(firstGun
                            ? "Sidearm acquired. Left click / F to fire, on foot."
                            : "Ammo +" + Cfg.AmmoPerPickup[w.Gun] + ".");
                    }
                    Vector2 c = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Road, Cfg.Side));
                    w.X = c.x; w.Y = c.y;
                }
            }
        }

        // Gang wars: cycle Q through the guns the player owns. Called from
        // PlayerSys.Step while on foot (firing is on-foot only, so the swap
        // lives there too).
        public static void CycleWeapon(PlayerState p)
        {
            WeaponKind[] owned =
            {
                WeaponKind.Pistol, WeaponKind.Smg, WeaponKind.Shotgun
            };
            bool[] owns = { p.OwnsPistol, p.OwnsSmg, p.OwnsShotgun };
            int cur = -1;
            for (int i = 0; i < 3; i++) if (owns[i] && owned[i] == p.Weapon) cur = i;
            for (int step = 1; step <= 3; step++)
            {
                int next = (cur + step) % 3;
                if (owns[next])
                {
                    if (owned[next] != p.Weapon) p.Weapon = owned[next];
                    return;
                }
            }
        }

        /* ---------------------------------------------------- weapons */

        // The player's side of the gang war: three tiers (pistol/SMG/shotgun)
        // sharing one ammo pool, all driven through this one function.
        // Cone checks run in the original 2D JS plane (x right, y down) —
        // the camera-relative render is 3D but the sim stays 2D, same as
        // everything else in this file. Civilians still die in one hit;
        // gangsters, cops and cars take the per-weapon damage stat, and the
        // shotgun scatters its pellets across a wider cone. Hitting a
        // gangster (killing or not) starts a vendetta — see AggroGang.
        public static void FireWeapon(GameData d, double t)
        {
            var p = d.Player;
            if (p.Weapon == WeaponKind.None || p.Ammo <= 0) return;
            int wi = (int)p.Weapon - 1;
            if (t - p.LastFireAt < Cfg.WeaponCooldown[wi]) return;
            p.LastFireAt = t;
            p.Ammo--;

            AddSparks(d, p.X + Mathf.Cos(p.A) * 14f, p.Y + Mathf.Sin(p.A) * 14f, 4);

            int pellets = Cfg.WeaponPellets[wi];
            float range = Cfg.WeaponRange[wi];
            float halfCone = Cfg.WeaponConeDeg[wi] * 0.5f * Mathf.Deg2Rad;
            float damage = Cfg.WeaponDamage[wi];

            for (int n = 0; n < pellets; n++)
            {
                // single-shot guns fire straight down p.A; the shotgun
                // spreads its pellets across the full cone, one random
                // bearing each. A pellet is a ray: it hits the NEAREST
                // valid target whose bearing stays inside a narrow band
                // around its own angle.
                float shotAng = pellets == 1 ? p.A : p.A + (Random.value * 2f - 1f) * halfCone;
                float narrow = pellets == 1 ? halfCone : 7f * Mathf.Deg2Rad;
                FirePellet(d, shotAng, narrow, range, damage, t);
            }
        }

        static void FirePellet(GameData d, float shotAng, float halfConeRad, float range, float damage, double t)
        {
            var p = d.Player;
            var s = d.State;

            // peds first — same priority order as the original
            // single-pistol code (peds, then cops, then cars). Within each
            // class the NEAREST target in the cone is hit, not the first one
            // found in list order: with the shotgun's wide cone a distant
            // ped standing behind a close one used to eat the pellet, and
            // FireWeapon's own comment ("hits the NEAREST valid target")
            // describes the intended behaviour.
            PedEnt hitPed = null; float bestPed = float.MaxValue;
            for (int i = 0; i < d.Peds.Count; i++)
            {
                PedEnt ped = d.Peds[i];
                if (ped.Dead) continue;
                float cd = ConeDist(p.X, p.Y, shotAng, ped.X, ped.Y, halfConeRad, range);
                if (cd >= 0f && cd < bestPed) { bestPed = cd; hitPed = ped; }
            }
            if (hitPed != null)
            {
                PedEnt ped = hitPed;
                if (ped.Kind == PedKind.Gangster)
                {
                    ped.Health -= damage;
                    AggroGang(d, ped.Gang, t);
                    if (ped.Health <= 0f) PlayerKillsGangster(d, ped, shotAng);
                    else AddSparks(d, ped.X, ped.Y, 4);
                }
                else
                {
                    ped.Dead = true; ped.Timer = 6f;
                    ped.FlingVx = Mathf.Cos(shotAng) * 140f; ped.FlingVy = Mathf.Sin(shotAng) * 140f;
                    s.Say("Shots fired. The local police heard that.");
                }
                s.Wanted = Mathf.Min(5, s.Wanted + 1);
                s.LastCrime = s.Time;
                return;
            }
            CopEnt hitCop = null; float bestCop = float.MaxValue;
            for (int i = 0; i < d.Cops.Count; i++)
            {
                CopEnt cop = d.Cops[i];
                float cd = ConeDist(p.X, p.Y, shotAng, cop.X, cop.Y, halfConeRad, range);
                if (cd >= 0f && cd < bestCop) { bestCop = cd; hitCop = cop; }
            }
            if (hitCop != null)
            {
                hitCop.Health -= damage;
                AddSparks(d, hitCop.X, hitCop.Y, 5);
                return;
            }
            CarEnt hitCar = null; float bestCar = float.MaxValue;
            for (int i = 0; i < d.Cars.Count; i++)
            {
                CarEnt c = d.Cars[i];
                if (c.Wrecked || c.IsPlayer) continue;
                float cd = ConeDist(p.X, p.Y, shotAng, c.X, c.Y, halfConeRad, range);
                if (cd >= 0f && cd < bestCar) { bestCar = cd; hitCar = c; }
            }
            if (hitCar != null) DamageCar(d, damage, hitCar.X, hitCar.Y);
        }

        // Like InCone, but returns the target's distance (or -1 when it is
        // outside the cone/range) so callers can pick the nearest valid
        // target instead of the first match.
        static float ConeDist(float px, float py, float shotAng, float tx, float ty, float halfConeRad, float range)
        {
            float dx = tx - px, dy = ty - py;
            float dist = Mathf.Sqrt(dx * dx + dy * dy);
            if (dist > range || dist < 0.01f) return -1f;
            float ang = Mathf.Atan2(dy, dx);
            float diff = Mathf.Abs(Mathf.DeltaAngle(ang * Mathf.Rad2Deg, shotAng * Mathf.Rad2Deg));
            return diff * Mathf.Deg2Rad <= halfConeRad ? dist : -1f;
        }

        static bool InCone(float px, float py, float shotAng, float tx, float ty, float halfConeRad, float range)
        {
            float dx = tx - px, dy = ty - py;
            float dist = Mathf.Sqrt(dx * dx + dy * dy);
            if (dist > range || dist < 0.01f) return false;
            float ang = Mathf.Atan2(dy, dx);
            float diff = Mathf.Abs(Mathf.DeltaAngle(ang * Mathf.Rad2Deg, shotAng * Mathf.Rad2Deg));
            return diff * Mathf.Deg2Rad <= halfConeRad;
        }

        // Gang wars: attacking a gangster turns the nearby members of that
        // gang onto the player for a while. Announced once, when the first
        // member of this grudge picks up the news.
        public static void AggroGang(GameData d, int gang, double t)
        {
            bool announced = false;
            float rSq = Cfg.VendettaRange * Cfg.VendettaRange;
            for (int i = 0; i < d.Peds.Count; i++)
            {
                PedEnt o = d.Peds[i];
                if (o.Dead || o.Kind != PedKind.Gangster || o.Gang != gang) continue;
                float dx = o.X - d.Player.X, dy = o.Y - d.Player.Y;
                if (dx * dx + dy * dy > rSq) continue;
                bool fresh = t >= o.VendettaUntil;
                o.VendettaUntil = t + Cfg.VendettaDuration;
                if (fresh && !announced)
                {
                    announced = true;
                    d.State.Say("The " + Cfg.GangNames[gang] + " saw that. They'll be coming for you.");
                }
            }
        }

        // A gangster dropped by the PLAYER — gunfire or a run-over. On top
        // of the usual death toss: score, the occasional pocketed ammo,
        // gang-war mission credit, and a vendetta on the rest of the crew.
        public static void PlayerKillsGangster(GameData d, PedEnt v, float fromAngle)
        {
            var s = d.State;
            KillGangster(d, v, fromAngle);
            s.Score += Cfg.GangKillScore;
            AggroGang(d, v.Gang, s.Time);

            if (s.MissionOn && s.MissionKind == MissionKind.GangWar && v.Gang == s.GangWarGang)
            {
                s.GangWarCount++;
                if (s.GangWarCount < s.GangWarGoal)
                    s.Say(Cfg.GangNames[v.Gang] + " down " + s.GangWarCount + "/" + s.GangWarGoal + ".");
            }
            else if (Random.value < Cfg.GangDropChance)
            {
                d.Player.Ammo = Mathf.Min(Cfg.AmmoMax, d.Player.Ammo + Cfg.GangDropAmmo);
                s.Say("Pocketed his ammo. +" + Cfg.GangDropAmmo + ".");
            }
        }

        /* ---------------------------------------------------- effects */

        public static void AddSparks(GameData d, float x, float y, int n)
        {
            for (int i = 0; i < n; i++)
            {
                d.Particles.Add(new ParticleEnt
                {
                    X = x, Y = y, Kind = ParticleEnt.Spark,
                    Vx = (Random.value - 0.5f) * 220f,
                    Vy = (Random.value - 0.5f) * 220f,
                    Life = 0.35f
                });
            }
        }

        public static void AddSmoke(GameData d, float x, float y)
        {
            d.Particles.Add(new ParticleEnt
            {
                X = x, Y = y, Kind = ParticleEnt.Smoke,
                Vx = (Random.value - 0.5f) * 20f,
                Vy = -30f,
                R = 5f + Random.value * 6f,
                Life = 1.1f
            });
        }

        /* ------------------------------------------------------ wasted */

        public const float WastedHold = 2.6f;      // matches Busted's 2.4s beat, slightly longer
        public const int WastedPenaltyPct = 20;    // Stage 1: score penalty; Stage 3 reinterprets as cash

        // One consequence path for every player death, on foot or in a car.
        // Mirrors the arrest resolution in LawStep so both read as the same
        // beat: freeze the sim, eject, clear the heat, respawn on the home
        // corner — but it costs score and ammo instead of a fine.
        //
        // The ONLY call site is GameLoop.Update, after the sim block —
        // deliberately NOT the end of DamageCar: DamageCar runs from inside
        // CopStep while LawStep iterates d.Cops backwards, and the
        // d.Cops.Clear() below would be a collection mutation during
        // iteration. Letting GameLoop be the single trigger is exactly why
        // the arrest path is structured the same way.
        //
        // This is also the in-car-death fix: the old death branch in
        // GameLoop required InCar == null, so DamageCar could leave the
        // player sitting at 0 HP inside a wreck forever. The eject below
        // handles the wreck; the countdown in LawStep holds the WASTED
        // screen (on simDt, so pause freezes it).
        public static void KillPlayer(GameData d, string reason)
        {
            var s = d.State; var p = d.Player;
            if (s.Wasted > 0f || s.Busted > 0f) return;      // never stack
            if (s.GodMode) return;                           // see DamageCar

            s.Wasted = WastedHold;
            s.Shake = Mathf.Min(14f, s.Shake + 8f);

            // eject from the wreck the same way the arrest resolution does
            if (p.InCar != null)
            {
                p.InCar.IsPlayer = false; p.InCar.Parked = true;
                p.InCar.Speed = 0f; p.InCar.Vx = 0f; p.InCar.Vy = 0f;
                p.InCar = null;
            }

            // the consequence: wanted clears (you "died locally"), but it costs
            s.Score = Mathf.Max(0, s.Score - s.Score * WastedPenaltyPct / 100);
            s.Wanted = 0;
            d.Cops.Clear();
            d.SpikeStrips.Clear();

            p.Health = 100f;
            p.X = s.Spawn.x; p.Y = s.Spawn.y;
            p.Vx = 0f; p.Vy = 0f;              // the arrest path zeroes these; the old on-foot branch forgot to
            p.Ammo = Mathf.Max(0, p.Ammo - 12);
            p.SpikePenalty = 0f;
            s.Say(reason);
        }

        public static void DamageCar(GameData d, float amount, float x, float y)
        {
            var p = d.Player;
            // GodMode (GameState): keep the impact feedback — sparks and shake
            // are what make a hit readable while testing — but take no damage,
            // so the car never wrecks and KillPlayer is never reached.
            if (d.State.GodMode)
            {
                AddSparks(d, x, y, 6);
                return;
            }
            p.Health = Mathf.Max(0f, p.Health - amount);
            if (p.InCar != null) p.InCar.Health = p.Health;
            AddSparks(d, x, y, 6);
            d.State.Shake = Mathf.Min(14f, d.State.Shake + amount * 0.6f);
            if (p.Health <= 0f && p.InCar != null && !p.InCar.Wrecked)
            {
                p.InCar.Wrecked = true;
                d.State.Say("The car is done. On foot from here.");
            }
        }

        // called whenever a non-player car becomes wrecked (Player.cs
        // ramming, or the pistol) — feeds the Rampage mission (LTA.Missions.cs)
        public static void RegisterWreck(GameData d)
        {
            var s = d.State;
            if (s.MissionOn && s.MissionKind == MissionKind.Rampage)
            {
                s.RampageCount++;
                if (s.RampageCount < s.RampageGoal)
                    s.Say("Wrecked " + s.RampageCount + "/" + s.RampageGoal + ".");
            }
        }

        /* ---------------------------------------------------- weather */

        // Clear/rain alternates on the game clock; a light gameplay cost
        // (looser grip) accompanies the atmosphere so it isn't purely
        // cosmetic. GameLoop reads d.State.Weather to drive fog/rain visuals.
        public static void WeatherStep(GameData d, double t)
        {
            var s = d.State;

            // TunForceWeather (GameState): -1 = follow the clock below, 0 = pin
            // Clear, 1 = pin Rain. Pinning leaves NextWeatherAt / WeatherEnds
            // untouched, so un-pinning resumes the normal cycle instead of
            // firing an immediate transition.
            if (s.TunForceWeather >= 0)
            {
                s.Weather = s.TunForceWeather >= 1 ? Weather.Rain : Weather.Clear;
                return;
            }

            if (s.Weather == Weather.Clear)
            {
                if (t >= s.NextWeatherAt)
                {
                    s.Weather = Weather.Rain;
                    s.WeatherEnds = t + 45.0 + Random.value * 30.0;
                    s.Say("Rain rolling in. Roads are slicker.");
                }
            }
            else if (t >= s.WeatherEnds)
            {
                s.Weather = Weather.Clear;
                s.NextWeatherAt = t + 60.0 + Random.value * 60.0;
                s.Say("Skies clearing up.");
            }
        }

        // exhaust puffs — the inline block inside the JS frame()
        public static void ExhaustStep(GameData d, float dt, float camX, float camY, float viewW, float viewH)
        {
            for (int i = 0; i < d.Cars.Count; i++)
            {
                CarEnt c = d.Cars[i];
                if (c.Parked || c.Wrecked || c.Speed < 35f) continue;
                if (Random.value > dt * 1.5f) continue;
                float exX = c.X - Mathf.Cos(c.A) * 20f, exY = c.Y - Mathf.Sin(c.A) * 20f;
                float sx = exX - camX, sy = exY - camY;
                if (sx < -40f || sy < -40f || sx > viewW + 40f || sy > viewH + 40f) continue;
                d.Particles.Add(new ParticleEnt
                {
                    X = exX, Y = exY, Kind = ParticleEnt.Puff, R = 2.5f, Life = 0.6f,
                    Vx = -Mathf.Cos(c.A) * 14f + (Random.value - 0.5f) * 10f,
                    Vy = -Mathf.Sin(c.A) * 14f + (Random.value - 0.5f) * 10f
                });
            }
        }

        // Realism pass (Phase 8): tire spray on wet roads — moving cars kick
        // up a splash while State.Weather == Rain, mirroring ExhaustStep's
        // shape (same view-culling, same "roll the dice this frame" gate)
        // so it costs nothing extra when it's not raining.
        public static void SplashStep(GameData d, float dt, float camX, float camY, float viewW, float viewH)
        {
            if (d.State.Weather != Weather.Rain) return;
            for (int i = 0; i < d.Cars.Count; i++)
            {
                CarEnt c = d.Cars[i];
                if (c.Parked || c.Wrecked || c.Speed < Cfg.SplashMinSpeed) continue;
                if (CityMap.TypeAtPx(c.X, c.Y) != Cfg.Road) continue;
                float speedT = Mathf.Clamp01(c.Speed / 260f);
                if (Random.value > dt * Cfg.SplashChancePerSec * speedT) continue;
                float sx = c.X - camX, sy = c.Y - camY;
                if (sx < -40f || sy < -40f || sx > viewW + 40f || sy > viewH + 40f) continue;
                float backX = -Mathf.Cos(c.A) * 16f, backY = -Mathf.Sin(c.A) * 16f;
                d.Particles.Add(new ParticleEnt
                {
                    X = c.X + backX, Y = c.Y + backY, Kind = ParticleEnt.Splash,
                    R = 1.5f, Life = Cfg.SplashLife,
                    Vx = backX * 1.4f + (Random.value - 0.5f) * 24f,
                    Vy = backY * 1.4f + (Random.value - 0.5f) * 24f
                });
            }
        }

        public static void ParticlesStep(GameData d, float dt)
        {
            for (int i = d.Particles.Count - 1; i >= 0; i--)
            {
                ParticleEnt p = d.Particles[i];
                p.Life -= dt;
                p.X += p.Vx * dt; p.Y += p.Vy * dt;
                if (p.Kind == ParticleEnt.Smoke) p.R += 14f * dt;
                if (p.Kind == ParticleEnt.Puff) p.R += 7f * dt;
                if (p.Kind == ParticleEnt.Splash) p.R += 10f * dt;
                if (p.Life <= 0f) d.Particles.RemoveAt(i);
            }
            for (int i = d.Skids.Count - 1; i >= 0; i--)
            {
                d.Skids[i].Life -= dt;
                if (d.Skids[i].Life <= 0f) d.Skids.RemoveAt(i);
            }
        }
    }
}
