/* Headless simulation check for the crowd/gang systems.

   Runs the real spawn and the real per-ped step for a minute of simulated
   time with no scene, no rendering and no visuals, then asserts that the
   gang war is actually happening rather than just compiling. Catches the
   failure mode a screenshot cannot: gangsters that spawn correctly, look
   correct, and never engage.

   Particles are plain data (AddSparks/AddSmoke only append to a list), so
   this is safe without a scene; the list is drained periodically because
   nothing is consuming it here.

   Run with:
     Unity -quit -batchmode -projectPath <project> -executeMethod GangSimTest.Run
*/
using UnityEditor;
using UnityEngine;
using LocalTheftAuto;

public static class GangSimTest
{
    public static void Run()
    {
        var d = new GameData();
        Systems.SpawnWorld(d);

        int gangsters = 0, civilians = 0, parkGoers = 0;
        float startHealth = 0f;
        for (int i = 0; i < d.Peds.Count; i++)
        {
            PedEnt p = d.Peds[i];
            if (p.Kind == PedKind.Gangster) { gangsters++; startHealth += p.Health; }
            else if (p.Kind == PedKind.ParkGoer) parkGoers++;
            else civilians++;
        }

        Debug.Log(string.Format(
            "[GangSim] spawned: peds={0} (civilian={1} park={2} gang={3}) cars={4}",
            d.Peds.Count, civilians, parkGoers, gangsters, d.Cars.Count));

        // Diagnostic: can a gangster even SEE a rival at spawn? If most of
        // them start with nobody in range the problem is the spawn, not the
        // combat loop.
        int noRival = 0, inSightOnly = 0, inFireRange = 0;
        for (int i = 0; i < d.Peds.Count; i++)
        {
            PedEnt p = d.Peds[i];
            if (p.Kind != PedKind.Gangster) continue;
            float best = float.MaxValue;
            for (int j = 0; j < d.Peds.Count; j++)
            {
                PedEnt o = d.Peds[j];
                if (o == p || o.Kind != PedKind.Gangster || o.Gang == p.Gang) continue;
                float dx = o.X - p.X, dy = o.Y - p.Y;
                float dd = Mathf.Sqrt(dx * dx + dy * dy);
                if (dd < best) best = dd;
            }
            if (best > Cfg.GangSightRange) noRival++;
            else if (best > Cfg.GangFireRange) inSightOnly++;
            else inFireRange++;
        }
        Debug.Log(string.Format(
            "[GangSim] at spawn: inFireRange={0} inSightOnly={1} noRivalWithin{2}={3}",
            inFireRange, inSightOnly, Cfg.GangSightRange, noRival));

        const float dt = 1f / 60f;
        const int steps = 60 * 60;          // 60 simulated seconds
        int deaths = 0;

        // A gangster dies during its KILLER's step, not its own, so the
        // before/after comparison has to straddle the whole frame rather than
        // sit inside the per-ped call. And RespawnDeadPeds clears LastShotAt,
        // so "has ever fired" has to latch before that wipes the evidence.
        bool[] wasDead = new bool[d.Peds.Count];
        bool[] everFired = new bool[d.Peds.Count];
        // Realism pass (Phase 6): panic is now driven by near-miss proximity
        // to ANY moving car plus crowd-scare propagation, not just "the
        // player's car at high speed" — so a regression here could mean
        // either extreme: panic never fires (the trigger broke) or panic
        // never stops (a feedback loop where propagation keeps re-triggering
        // itself). Track both a transition count and a running total of
        // simultaneously-panicking peds to catch either failure mode.
        bool[] wasPanicking = new bool[d.Peds.Count];
        int panicEvents = 0;
        int panicSampleSum = 0, panicSamples = 0;

        // No player car in this headless sim, so seed a few fast "phantom"
        // cars driving through pedestrian-dense areas — otherwise the new
        // near-miss trigger has nothing to react to and panicEvents would
        // stay zero for a reason that has nothing to do with a regression.
        for (int i = 0; i < 6; i++)
        {
            Vector2 c = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Road));
            CarEnt phantom = Systems.MakeCar(c.x, c.y, Random.Range(0, 4), false);
            phantom.Speed = 260f; phantom.Cruise = 260f;
            d.Cars.Add(phantom);
        }

        for (int s = 0; s < steps; s++)
        {
            d.State.Time += dt;

            for (int i = 0; i < d.Peds.Count; i++) wasDead[i] = d.Peds[i].Dead;
            for (int i = 0; i < d.Peds.Count; i++) wasPanicking[i] = d.Peds[i].Panic > 0f;
            for (int i = 0; i < d.Cars.Count; i++) Systems.TrafficStep(d, d.Cars[i], dt);
            for (int i = 0; i < d.Peds.Count; i++) Systems.PedStep(d, d.Peds[i], dt);

            int panickingNow = 0;
            for (int i = 0; i < d.Peds.Count; i++)
            {
                PedEnt p = d.Peds[i];
                if (p.Kind != PedKind.Gangster) continue;
                if (p.LastShotAt > -1e8) everFired[i] = true;
                if (!wasDead[i] && p.Dead) deaths++;
            }
            for (int i = 0; i < d.Peds.Count; i++)
            {
                bool now = d.Peds[i].Panic > 0f;
                if (now && !wasPanicking[i]) panicEvents++;
                if (now) panickingNow++;
            }
            // sample every 30 steps (2/sec) rather than every frame — plenty
            // of resolution for "did it settle" without inflating the sum
            if (s % 30 == 0) { panicSampleSum += panickingNow; panicSamples++; }

            Systems.RespawnDeadPeds(d);
            // nothing consumes particles here
            if (d.Particles.Count > 4000) d.Particles.Clear();
        }

        int fired = 0, offPark = 0;
        float endHealth = 0f;
        for (int i = 0; i < d.Peds.Count; i++)
        {
            PedEnt p = d.Peds[i];
            if (p.Kind == PedKind.Gangster)
            {
                endHealth += p.Health;
                if (p.LastShotAt > -1e8) fired++;
            }
            else if (p.Kind == PedKind.ParkGoer && !p.Dead)
            {
                if (CityMap.TypeAtPx(p.X, p.Y) != Cfg.Park) offPark++;
            }
        }

        Debug.Log(string.Format(
            "[GangSim] after 60s: gangKills={0} gangstersThatFired={1}/{2} healthPool {3:F0}->{4:F0}",
            deaths, fired, gangsters, startHealth, endHealth));
        Debug.Log(string.Format(
            "[GangSim] park-goers still on park tiles: {0}/{1}",
            parkGoers - offPark, parkGoers));

        float avgPanicking = panicSamples > 0 ? (float)panicSampleSum / panicSamples : 0f;
        Debug.Log(string.Format(
            "[GangSim] panic: events={0} avgPanickingAtOnce={1:F1}/{2}",
            panicEvents, avgPanicking, d.Peds.Count));

        /* ---- Phase 2: the player joins the war (vendetta + Gang War job) ----

           Headless check for the gang-vs-player layer: put the player on a
           quiet sidewalk with a pistol, ring them with six members of one
           gang, open a Gang War contract on that gang, and fire at them
           every frame for 20 simulated seconds. Asserts that attacking a
           gangster trips the vendetta, that the hunted crew shoots back,
           and that mission credit lands on the kills. */
        Vector2 arena = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Side));
        var pl = d.Player;
        pl.X = arena.x; pl.Y = arena.y;
        pl.Health = 100f;
        pl.Ammo = Cfg.AmmoMax;
        pl.Weapon = WeaponKind.Pistol;
        pl.OwnsPistol = true;

        int[] aliveNow = new int[Cfg.GangNames.Length];
        for (int i = 0; i < d.Peds.Count; i++)
        {
            PedEnt p = d.Peds[i];
            if (p.Dead || p.Kind != PedKind.Gangster) continue;
            aliveNow[p.Gang]++;
        }
        int missionGang = aliveNow[1] > aliveNow[0] ? 1 : 0;

        // six fresh members of the contract gang, in a ring at firing range.
        // No rivals are spawned with them, so while the vendetta is live the
        // player is unambiguously their only target.
        for (int i = 0; i < 6; i++)
        {
            float ra = i * Mathf.PI * 2f / 6f;
            d.Peds.Add(new PedEnt
            {
                X = pl.X + Mathf.Cos(ra) * 130f,
                Y = pl.Y + Mathf.Sin(ra) * 130f,
                Kind = PedKind.Gangster,
                Gang = missionGang,
                Health = Cfg.GangHealth,
                Speed = Cfg.GangSpeed,
                Shirt = Cfg.GangColors[missionGang],
                StrideMult = 1f
            });
        }

        var st = d.State;
        st.MissionOn = true;
        st.MissionKind = MissionKind.GangWar;
        st.GangWarGang = missionGang;
        st.GangWarGoal = 3;
        st.GangWarCount = 0;
        st.MissionEnds = st.Time + 20.0;

        bool vendettaTriggered = false;
        float warStartHealth = pl.Health;
        const int warSteps = 20 * 60;
        for (int ws = 0; ws < warSteps; ws++)
        {
            d.State.Time += dt;

            // aim at the nearest living member of the contract gang, then fire
            PedEnt prey = null; float preySq = float.MaxValue;
            for (int i = 0; i < d.Peds.Count; i++)
            {
                PedEnt p = d.Peds[i];
                if (p.Dead || p.Kind != PedKind.Gangster || p.Gang != missionGang) continue;
                float ddx = p.X - pl.X, ddy = p.Y - pl.Y;
                float sq = ddx * ddx + ddy * ddy;
                if (sq < preySq) { preySq = sq; prey = p; }
            }
            if (prey != null)
            {
                pl.A = Mathf.Atan2(prey.Y - pl.Y, prey.X - pl.X);
                pl.Ammo = Cfg.AmmoMax;   // sustained fire for the whole phase
                Systems.FireWeapon(d, d.State.Time);
            }

            for (int i = 0; i < d.Peds.Count; i++)
            {
                PedEnt p = d.Peds[i];
                if (p.Kind == PedKind.Gangster && p.VendettaUntil > d.State.Time)
                    vendettaTriggered = true;
                Systems.PedStep(d, p, dt);
            }
            Systems.RespawnDeadPeds(d);
            if (d.Particles.Count > 4000) d.Particles.Clear();
        }

        float playerDamage = warStartHealth - pl.Health;
        bool gangWarOk = st.GangWarCount >= 1;
        Debug.Log(string.Format(
            "[GangSim] player war: vendettaTriggered={0} gangWarKills={1} playerDamageTaken={2:F0}",
            vendettaTriggered, st.GangWarCount, playerDamage));

        bool ok = true;
        if (gangsters == 0) { Debug.LogError("[GangSim] FAIL: no gangsters spawned"); ok = false; }
        if (fired == 0) { Debug.LogError("[GangSim] FAIL: no gangster ever fired"); ok = false; }
        if (deaths == 0) { Debug.LogError("[GangSim] FAIL: gang war produced no casualties"); ok = false; }
        if (parkGoers > 0 && offPark > parkGoers / 2)
        {
            Debug.LogError("[GangSim] FAIL: most park-goers wandered off their park");
            ok = false;
        }
        // Realism pass (Phase 6): bounded panic assertion. "0" means the
        // near-miss trigger broke (phantom cars are driving right through
        // the ped crowds and nobody flinches); a huge average means
        // crowd-scare propagation runaway (once someone panics, everyone
        // stays panicked forever). Neither is a hard physical bound — just
        // wide enough to only fire on an actual break in either direction.
        if (panicEvents == 0)
        {
            Debug.LogError("[GangSim] FAIL: no ped ever panicked (near-miss trigger broke)");
            ok = false;
        }
        if (avgPanicking > d.Peds.Count * 0.6f)
        {
            Debug.LogError("[GangSim] FAIL: most of the city panicking at once (crowd-scare runaway)");
            ok = false;
        }
        // Gang wars: the player-facing layer. Each failure names the piece
        // that broke — aggro, return fire, or mission credit.
        if (!vendettaTriggered)
        {
            Debug.LogError("[GangSim] FAIL: attacking a gangster never tripped a vendetta");
            ok = false;
        }
        if (vendettaTriggered && playerDamage <= 0f)
        {
            Debug.LogError("[GangSim] FAIL: a vendetta crew at firing range never hurt the player");
            ok = false;
        }
        if (!gangWarOk)
        {
            Debug.LogError("[GangSim] FAIL: gang war contract never credited a kill");
            ok = false;
        }

        Debug.Log(ok ? "[GangSim] PASS" : "[GangSim] FAILED");
        if (!ok) EditorApplication.Exit(1);
    }
}
