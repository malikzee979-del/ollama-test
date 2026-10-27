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
                s.StealTarget = null;
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
            }
        }

        static void StepDelivery(GameData d, GameState s, PlayerState p, double t)
        {
            float dx = s.MissionX - p.X, dy = s.MissionY - p.Y;
            if (dx * dx + dy * dy < ReachR * ReachR)
            {
                Complete(s, t, "Delivered. +" + s.MissionReward + ". The customer tips locally.");
            }
        }

        static void StepRampage(GameData d, GameState s, double t)
        {
            if (s.RampageCount >= s.RampageGoal)
                Complete(s, t, "Rampage complete. +" + s.MissionReward + ". The insurance adjusters are local too.");
        }

        static void StepGangWar(GameData d, GameState s, double t)
        {
            if (s.GangWarCount >= s.GangWarGoal)
                Complete(s, t, "The " + Cfg.GangNames[s.GangWarGang] + " got the message. +" + s.MissionReward + ".");
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
                s.StealTarget = null;
                Complete(s, t, "Delivered as ordered. +" + s.MissionReward + ". No questions asked, locally.");
            }
        }

        static void Complete(GameState s, double t, string msg)
        {
            s.MissionOn = false;
            s.Score += s.MissionReward;
            s.NextMissionAt = t + 12.0;
            s.Say(msg);
        }

        static void Spawn(GameData d, double t)
        {
            var s = d.State;
            // weight Delivery highest so the original job still dominates;
            // Rampage, Steal and Gang War need a bit more setup (a target,
            // several wrecks, living gangsters) so they show up less often
            float roll = Random.value;
            MissionKind kind = roll < 0.45f ? MissionKind.Delivery
                             : roll < 0.68f ? MissionKind.Rampage
                             : roll < 0.84f ? MissionKind.Steal
                             : MissionKind.GangWar;

            if (kind == MissionKind.Steal && !TrySpawnSteal(d, t)) kind = MissionKind.Delivery;
            if (kind == MissionKind.GangWar && !TrySpawnGangWar(d, t)) kind = MissionKind.Delivery;
            if (kind == MissionKind.Rampage) { SpawnRampage(d, t); return; }
            if (kind == MissionKind.Delivery) SpawnDelivery(d, t);
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
                s.MissionReward = 350 + Mathf.RoundToInt(dist / 18f) * 10;
                s.Say("Steal that marked car and deliver it. +" + s.MissionReward + ".");
                return true;
            }
            return false;
        }
    }
}
