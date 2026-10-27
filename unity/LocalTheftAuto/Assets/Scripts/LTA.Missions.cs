/* ==========================================================================
   Local Theft Auto — timed jobs.
   Three kinds now, all sharing the same offer/timer/reward shape:
     Delivery — reach a blue drop-off marker before the clock runs out
                (original job type).
     Rampage  — wreck a handful of cars before the clock runs out.
     Steal    — a specific car is marked; steal it and drive it to the
                drop-off before the clock runs out.
   Pure simulation here — visuals (blue marker, HUD countdown/minimap blip,
   the "steal this one" tint) live in LTA.Game.cs / LTA.Hud.cs.
   ========================================================================== */
using UnityEngine;

namespace LocalTheftAuto
{
    public static class MissionSys
    {
        const float MinDist = 1200f;    // don't offer jobs next door
        const float ReachR = 42f;

        public static void Step(GameData d, double t)
        {
            var s = d.State;
            var p = d.Player;

            if (!s.MissionOn)
            {
                if (s.NextMissionAt <= 0.0) s.NextMissionAt = t + 8.0;   // first offer
                if (t >= s.NextMissionAt) Spawn(d, t);
                return;
            }

            if (t > s.MissionEnds)
            {
                s.MissionOn = false;
                ClearTargets(d, s);
                s.NextMissionAt = t + 15.0;
                s.Say("Too late. The job went to a faster local.");
                return;
            }

            switch (s.MissionKind)
            {
                case MissionKind.Delivery:
                    StepDelivery(d, s, p, t);
                    break;
                case MissionKind.Rampage:
                    StepRampage(d, s, t);
                    break;
                case MissionKind.Steal:
                    StepSteal(d, s, p, t);
                    break;
                case MissionKind.GangWar:
                    StepGangWar(d, s, t);
                    break;
                case MissionKind.Circuit:
                    StepCircuit(d, s, p, t);
                    break;
                case MissionKind.Ram:
                    StepRam(d, s, t);
                    break;
                case MissionKind.Escort:
                    StepEscort(d, s, t);
                    break;
            }
        }

        // VIP movement (JS vipStep): the VIP stays put until the player
        // reaches them ON FOOT, then walks behind the player toward the
        // destination at VipFollowSpeed. dt is simDt so a pause freezes the
        // VIP mid-step, like every other entity.
        public static void VipStep(GameData d, double t, float dt)
        {
            var s = d.State;
            var vip = s.Vip;
            if (!s.MissionOn || s.MissionKind != MissionKind.Escort || vip == null || vip.Dead) return;
            vip.Phase += dt * 8f;
            var p = d.Player;
            if (!s.VipFollowing)
            {
                float dx = p.X - vip.X, dy = p.Y - vip.Y;
                // pickup is foot-only — driving past doesn't count (JS !player.inCar)
                if (dx * dx + dy * dy < Cfg.EscortPickupR * Cfg.EscortPickupR && p.InCar == null)
                {
                    s.VipFollowing = true;
                    s.Say("VIP is following you. Get them to the blue marker.");
                }
                return;
            }
            float fxDx = p.X - vip.X, fxDy = p.Y - vip.Y;
            float dist = Mathf.Sqrt(fxDx * fxDx + fxDy * fxDy);
            if (dist > 34f)
            {
                float sp = Cfg.VipFollowSpeed;
                float nx = vip.X + fxDx / dist * sp * dt;
                float ny = vip.Y + fxDy / dist * sp * dt;
                // axis-separated building check, same as the JS original
                if (!CityMap.CircleHitsBuilding(nx, vip.Y, 8f)) vip.X = nx;
                if (!CityMap.CircleHitsBuilding(vip.X, ny, 8f)) vip.Y = ny;
            }
        }

        static void StepDelivery(GameData d, GameState s, PlayerState p, double t)
        {
            float dx = s.MissionX - p.X, dy = s.MissionY - p.Y;
            if (dx * dx + dy * dy < ReachR * ReachR)
            {
                Complete(d, s, t, "Delivered. +" + s.MissionReward + ". The customer tips locally.");
            }
        }

        static void StepRampage(GameData d, GameState s, double t)
        {
            if (s.RampageCount >= s.RampageGoal)
                Complete(d, s, t, "Rampage complete. +" + s.MissionReward + ". The insurance adjusters are local too.");
        }

        static void StepGangWar(GameData d, GameState s, double t)
        {
            if (s.GangWarCount >= s.GangWarGoal)
                Complete(d, s, t, "The " + Cfg.GangNames[s.GangWarGang] + " got the message. +" + s.MissionReward + ".");
        }

        // Circuit (JS circuitMissionStep): hit checkpoints in order; the
        // current one is kept in MissionX/MissionY for the marker/HUD.
        static void StepCircuit(GameData d, GameState s, PlayerState p, double t)
        {
            var cps = s.CircuitCps;
            if (cps == null || cps.Count == 0) return;
            float dx = s.MissionX - p.X, dy = s.MissionY - p.Y;
            if (dx * dx + dy * dy < ReachR * ReachR)
            {
                s.CircuitIndex++;
                if (s.CircuitIndex >= cps.Count)
                {
                    Complete(d, s, t, "Circuit complete. +" + s.MissionReward + ". All stops hit, filed locally.");
                }
                else
                {
                    s.MissionX = cps[s.CircuitIndex].x;
                    s.MissionY = cps[s.CircuitIndex].y;
                    s.Say("Checkpoint " + s.CircuitIndex + "/" + cps.Count + ".");
                }
            }
        }

        // Ram (JS ramMissionStep): wreck the target car before it escapes.
        // Any wreck does it — player-caused or not, matching the JS original
        // which only checks targetCar.wrecked.
        static void StepRam(GameData d, GameState s, double t)
        {
            var target = s.RamTarget;
            if (target == null) return;
            if (target.Wrecked)
            {
                ClearTargets(d, s);
                Complete(d, s, t, "Contract complete. +" + s.MissionReward + ". That car's not going anywhere.");
            }
        }

        // Escort (JS escortMissionStep): the VIP walks to the destination
        // while following; deliver them within EscortDeliverR. A dead VIP
        // ends the job (no fail message spam — the run continues).
        static void StepEscort(GameData d, GameState s, double t)
        {
            var vip = s.Vip;
            if (vip == null || vip.Dead)
            {
                s.MissionOn = false;
                ClearTargets(d, s);
                s.NextMissionAt = t + 15.0;
                return;
            }
            if (s.VipFollowing)
            {
                float dx = s.MissionX - vip.X, dy = s.MissionY - vip.Y;
                if (dx * dx + dy * dy < Cfg.EscortDeliverR * Cfg.EscortDeliverR)
                {
                    ClearTargets(d, s);
                    Complete(d, s, t, "VIP delivered safely. +" + s.MissionReward + ".");
                }
            }
        }

        static void StepSteal(GameData d, GameState s, PlayerState p, double t)
        {
            // the mark can be wrecked or vanish (still in traffic) — either
            // way the job is blown, no partial credit
            if (s.StealTarget == null || s.StealTarget.Wrecked)
            {
                s.MissionOn = false;
                s.StealTarget = null;
                s.NextMissionAt = t + 15.0;
                s.Say("That car isn't going anywhere now. Job's off.");
                return;
            }
            if (p.InCar != s.StealTarget) return;   // must be driving THAT car
            float dx = s.MissionX - p.X, dy = s.MissionY - p.Y;
            if (dx * dx + dy * dy < ReachR * ReachR)
            {
                // T7: the pristine variant (StealMaxDamagePct > 0) only pays
                // if the mark arrived with health above the cap. A failed
                // cap means no reward and the offer clock resets longer —
                // scraping the car costs the job's value, not its reward.
                if (s.StealMaxDamagePct > 0 && s.StealTarget.Health < s.StealMaxDamagePct)
                {
                    s.MissionOn = false;
                    s.StealTarget = null;
                    s.NextMissionAt = t + 22.0;
                    s.Say("Delivered — but the bodywork's wrecked. Pristine job pays nothing.");
                    return;
                }
                s.StealTarget = null;
                Complete(d, s, t, "Delivered as ordered. +" + s.MissionReward + ". No questions asked, locally.");
            }
        }

        // Central completion: every kind routes its finish through here so the
        // per-kind entity references (circuit list, ram car, VIP ped) are
        // ALWAYS detached — no completion path can leak them.
        static void Complete(GameData d, GameState s, double t, string msg)
        {
            ClearTargets(d, s);
            s.MissionOn = false;
            s.Score += s.MissionReward;
            s.CompletedJobs++;          // T7 ladder: every kind bumps it
            s.NextMissionAt = t + 12.0;
            s.Say(msg);
            // F19: completed jobs count as deliveries for the lifetime
            // delivery stat + Courier achievement (JS completeMission /
            // stats.deliveries >= 5 unlockAch("courier")).
            if (StatsSys.Deliveries() >= Cfg.CourierDeliveries)
                StatsSys.Unlock("courier");
        }

        static void Spawn(GameData d, double t)
        {
            var s = d.State;
            // Weights follow the JS original's MISSION_TYPES table
            // ("delivery","delivery","circuit","steal","ram","escort","rampage"),
            // plus GangWar — a Unity-only kind (no JS counterpart) — which
            // keeps its prior share so the total still sums to 1.
            float roll = Random.value;
            MissionKind kind = roll < 0.30f ? MissionKind.Delivery
                             : roll < 0.45f ? MissionKind.Circuit
                             : roll < 0.60f ? MissionKind.Steal
                             : roll < 0.72f ? MissionKind.Ram
                             : roll < 0.84f ? MissionKind.Escort
                             : roll < 0.93f ? MissionKind.Rampage
                             : MissionKind.GangWar;

            // Kinds that need setup fall back to Delivery when the setup
            // can't be satisfied right now (no target car, no gang left…).
            if (kind == MissionKind.Steal && !TrySpawnSteal(d, t)) kind = MissionKind.Delivery;
            if (kind == MissionKind.Ram && !TrySpawnRam(d, t)) kind = MissionKind.Delivery;
            if (kind == MissionKind.GangWar && !TrySpawnGangWar(d, t)) kind = MissionKind.Delivery;

            switch (kind)
            {
                case MissionKind.Rampage: SpawnRampage(d, t); break;
                case MissionKind.Circuit: SpawnCircuit(d, t); break;
                case MissionKind.Escort: SpawnEscort(d, t); break;
                default: SpawnDelivery(d, t); break;
            }
        }

        // Circuit (JS offerCircuitMission): 4..6 ordered checkpoints, each
        // at least CircuitMinGap from the previous one. Reward scales with
        // the total route distance; the deadline assumes ~150 u/s.
        static void SpawnCircuit(GameData d, double t)
        {
            var s = d.State;
            int n = 4 + Random.Range(0, 3);   // 4..6
            var cps = new System.Collections.Generic.List<Vector2>();
            float lastX = d.Player.X, lastY = d.Player.Y;
            float totalDist = 0f;
            for (int i = 0; i < n; i++)
            {
                Vector2 c = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Road, Cfg.Side));
                for (int tries = 1; tries < 30; tries++)
                {
                    float gapDx = c.x - lastX, gapDy = c.y - lastY;
                    if (Mathf.Sqrt(gapDx * gapDx + gapDy * gapDy) >= Cfg.CircuitMinGap) break;
                    c = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Road, Cfg.Side));
                }
                float ddx = c.x - lastX, ddy = c.y - lastY;
                totalDist += Mathf.Sqrt(ddx * ddx + ddy * ddy);
                cps.Add(c);
                lastX = c.x; lastY = c.y;
            }

            s.MissionOn = true;
            s.MissionKind = MissionKind.Circuit;
            s.CircuitCps = cps;
            s.CircuitIndex = 0;
            s.MissionX = cps[0].x;
            s.MissionY = cps[0].y;
            s.MissionEnds = t + totalDist / 150f + 12f;
            s.MissionReward = 300 + Mathf.RoundToInt(totalDist / 20f) * 10;
            s.Say("Circuit: " + n + " checkpoints before time runs out. +" + s.MissionReward + ".");
        }

        // Ram (JS offerRamMission): target a MOVING car; wreck it before the
        // deadline. Falls back to Delivery when no car is driving.
        static bool TrySpawnRam(GameData d, double t)
        {
            CarEnt best = null; float bestD = 0f;
            for (int tries = 0; tries < 12; tries++)
            {
                if (d.Cars.Count == 0) return false;
                CarEnt cand = d.Cars[Random.Range(0, d.Cars.Count)];
                if (cand.Wrecked || cand.IsPlayer || cand.Parked) continue;
                float dx = cand.X - d.Player.X, dy = cand.Y - d.Player.Y;
                float dist = dx * dx + dy * dy;
                if (dist > bestD) { bestD = dist; best = cand; }
            }
            if (best == null) return false;

            var s = d.State;
            s.MissionOn = true;
            s.MissionKind = MissionKind.Ram;
            s.RamTarget = best;
            // marker sits on the target car; the HUD/minimap read it live
            // through MissionTarget() below (the car keeps moving)
            s.MissionX = best.X;
            s.MissionY = best.Y;
            s.MissionEnds = t + 45.0;
            s.MissionReward = 300;
            s.Say("Contract: wreck that car before it gets away. +" + s.MissionReward + ".");
            return true;
        }

        // Escort (JS offerEscortMission): spawn the VIP ped on a SIDE tile,
        // pick a destination >= 600 away, the player picks them up on foot,
        // then the VIP walks to the marker. Reuses PedEnt (visual/death/
        // respawn pipeline for free) — same design call as gangsters.
        static void SpawnEscort(GameData d, double t)
        {
            var s = d.State;
            Vector2 pc = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Side));
            Vector2 dc = pc;
            for (int tries = 1; tries < 30; tries++)
            {
                dc = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Road, Cfg.Side));
                float ddx = dc.x - pc.x, ddy = dc.y - pc.y;
                if (Mathf.Sqrt(ddx * ddx + ddy * ddy) >= 600f) break;
            }

            var vip = new PedEnt
            {
                X = pc.x, Y = pc.y,
                Dir = Random.Range(0, 4),
                Speed = Cfg.VipFollowSpeed,
                Shirt = Cfg.CarColors[Random.Range(0, Cfg.CarColors.Length)],
                Skin = Random.Range(0, Cfg.Skins.Length),
                Phase = Random.value * 6.28f,
                StrideMult = Random.Range(Cfg.PedStrideMultMin, Cfg.PedStrideMultMax),
                Kind = PedKind.Civilian
            };
            d.Peds.Add(vip);

            s.MissionOn = true;
            s.MissionKind = MissionKind.Escort;
            s.Vip = vip;
            s.VipFollowing = false;
            s.MissionX = dc.x;
            s.MissionY = dc.y;
            float dist = Mathf.Sqrt((dc.x - pc.x) * (dc.x - pc.x) + (dc.y - pc.y) * (dc.y - pc.y));
            s.MissionEnds = t + dist / 90f + 30f;
            s.MissionReward = 400;
            s.Say("Escort: reach the VIP on foot (marker), then walk them to the blue marker. +" + s.MissionReward + ".");
        }

        // Detach every per-mission entity reference so a finished/expired
        // mission can't leak its VIP back into the ped list or hold a dead
        // CarEnt. The VIP is REMOVED from d.Peds (it was added for the
        // mission, not part of the city population).
        public static void ClearTargets(GameData d, GameState s)
        {
            s.StealTarget = null;
            s.RamTarget = null;
            s.CircuitCps = null;
            s.CircuitIndex = 0;
            if (s.Vip != null)
            {
                d.Peds.Remove(s.Vip);
                s.Vip = null;
            }
            s.VipFollowing = false;
        }

        // Single source of truth for "where is the mission pointing" — the
        // HUD minimap blip, compass and the world marker all read through
        // this (mirrors the JS missionTargetPos dispatch). Returns false
        // when there is no pointable target (Rampage/GangWar have none).
        public static bool MissionTarget(GameData d, out Vector2 target)
        {
            target = default;
            var s = d.State;
            if (!s.MissionOn) return false;
            switch (s.MissionKind)
            {
                case MissionKind.Rampage:
                case MissionKind.GangWar:
                    return false;
                case MissionKind.Ram:
                    // follow the LIVE car position, not the spawn marker
                    target = s.RamTarget != null ? new Vector2(s.RamTarget.X, s.RamTarget.Y)
                                                 : new Vector2(s.MissionX, s.MissionY);
                    return true;
                case MissionKind.Escort:
                    // before pickup, point at the VIP; after, at the dest
                    if (!s.VipFollowing && s.Vip != null && !s.Vip.Dead)
                        target = new Vector2(s.Vip.X, s.Vip.Y);
                    else
                        target = new Vector2(s.MissionX, s.MissionY);
                    return true;
                default:
                    target = new Vector2(s.MissionX, s.MissionY);
                    return true;
            }
        }

        static void SpawnDelivery(GameData d, double t)
        {
            var s = d.State;
            for (int tries = 0; tries < 40; tries++)
            {
                Vector2 c = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Road, Cfg.Side));
                float dx = c.x - d.Player.X, dy = c.y - d.Player.Y;
                float dist = Mathf.Sqrt(dx * dx + dy * dy);
                if (dist < MinDist && tries < 39) continue;

                s.MissionOn = true;
                s.MissionKind = MissionKind.Delivery;
                s.MissionX = c.x;
                s.MissionY = c.y;
                // generous on foot, tight in a car: ~dist at 140 px/s + slack
                float seconds = dist / 140f + 10f;
                s.MissionEnds = t + seconds;
                s.MissionReward = 250 + Mathf.RoundToInt(dist / 20f) * 10;
                s.Say("Delivery job: reach the blue marker. +" + s.MissionReward + " if you hurry.");
                return;
            }
        }

        static void SpawnRampage(GameData d, double t)
        {
            var s = d.State;
            s.MissionOn = true;
            s.MissionKind = MissionKind.Rampage;
            s.RampageGoal = 3 + Random.Range(0, 3);   // 3..5
            s.RampageCount = 0;
            s.MissionEnds = t + 35.0;
            s.MissionReward = 200 + s.RampageGoal * 80;
            s.Say("Rampage: wreck " + s.RampageGoal + " cars in 35s. +" + s.MissionReward + ".");
        }

        // Gang wars: a contract on one of the two crews. Needs enough of the
        // target gang alive at offer time to be finishable (gangsters also
        // die to their rivals while the clock runs, so pad the goal a bit).
        // Returns false — and the offer falls back to a Delivery — when
        // neither gang has enough members left.
        static bool TrySpawnGangWar(GameData d, double t)
        {
            var s = d.State;
            int goal = 4 + Random.Range(0, 3);   // 4..6
            int[] alive = new int[Cfg.GangNames.Length];
            for (int i = 0; i < d.Peds.Count; i++)
            {
                PedEnt p = d.Peds[i];
                if (p.Dead || p.Kind != PedKind.Gangster) continue;
                alive[p.Gang]++;
            }

            // prefer gangs that can actually supply the goal; if both can,
            // pick at random
            int gang = -1;
            if (alive[0] >= goal && alive[1] >= goal) gang = Random.Range(0, 2);
            else if (alive[0] >= goal) gang = 0;
            else if (alive[1] >= goal) gang = 1;
            else
            {
                // nobody has a full crew — take the bigger one and shrink
                // the contract to fit
                if (alive[0] < 2 && alive[1] < 2) return false;
                gang = alive[0] >= alive[1] ? 0 : 1;
                goal = Mathf.Max(2, alive[gang]);
            }

            s.MissionOn = true;
            s.MissionKind = MissionKind.GangWar;
            s.GangWarGang = gang;
            s.GangWarGoal = goal;
            s.GangWarCount = 0;
            s.MissionEnds = t + 50.0;
            s.MissionReward = 300 + goal * 70;
            s.Say("Gang war: drop " + goal + " of the " + Cfg.GangNames[gang]
                + " in 50s. +" + s.MissionReward + ". They shoot back.");
            return true;
        }

        // returns false if no suitable target car could be found (falls
        // back to a Delivery job in that case)
        static bool TrySpawnSteal(GameData d, double t)
        {
            if (d.Cars.Count == 0) return false;
            var s = d.State;
            CarEnt best = null; float bestD = 0f;
            for (int tries = 0; tries < 12; tries++)
            {
                CarEnt cand = d.Cars[Random.Range(0, d.Cars.Count)];
                if (cand.Wrecked || cand.IsPlayer) continue;
                float dx = cand.X - d.Player.X, dy = cand.Y - d.Player.Y;
                float dist = dx * dx + dy * dy;
                if (dist > bestD) { bestD = dist; best = cand; }
            }
            if (best == null) return false;

            for (int tries = 0; tries < 40; tries++)
            {
                Vector2 c = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Road, Cfg.Side));
                float dx = c.x - best.X, dy = c.y - best.Y;
                float dist = Mathf.Sqrt(dx * dx + dy * dy);
                if (dist < MinDist * 0.6f && tries < 39) continue;

                s.MissionOn = true;
                s.MissionKind = MissionKind.Steal;
                s.StealTarget = best;
                s.MissionX = c.x;
                s.MissionY = c.y;
                float seconds = dist / 130f + 16f;
                s.MissionEnds = t + seconds;

                // T7: one in three steal contracts is a "pristine" job —
                // deliver the mark with at least 70% health left. Pays the
                // tier bonus (below) on top of the distance rate, and the
                // offer text says so. Classic steals leave the cap at 0.
                bool pristine = Random.value < 0.333f;
                s.StealMaxDamagePct = pristine ? 70 : 0;

                // T7 reward tier: rewards scale with lifetime completions
                // (PristineFactor — every completed job of any kind bumps
                // the ladder, capped so late-game pay stays sane)
                int tier = RewardTier(s.CompletedJobs);
                int rate = 350 + Mathf.RoundToInt(dist / 18f) * 10;
                s.MissionReward = Mathf.RoundToInt(rate * (1f + tier * RewardTierStep));
                if (pristine) s.MissionReward += 150;
                s.Say(pristine
                    ? "Pristine steal: deliver it with the bodywork intact (70%+). +"
                      + s.MissionReward + ". Don't scrape it."
                    : "Steal that marked car and deliver it. +" + s.MissionReward + ".");
                return true;
            }
            return false;
        }

        /* ------------------------------------------------ T7: reward tiers */

        // lifetime completed jobs, persisted with the save (SaveData field,
        // kept out of the per-run counters deliberately)
        public const float RewardTierStep = 0.25f;   // +25% reward per tier
        public const int RewardTierMax = 5;

        public static int RewardTier(int completedJobs)
        {
            // tier 0 at <5 jobs, tier 5 at 120+: the ladder is early-game
            // acceleration, not an infinite escalator
            int tier = completedJobs / 25;
            return Mathf.Min(RewardTierMax, tier);
        }
    }
}
