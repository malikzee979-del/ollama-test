/* Integrated sim checks for turf economics against the REAL world and the
   REAL step sequence (LTA.Systems.cs) — the same headless pattern as
   PoliceSimTest/GangSimTest/MissionSimTest (-executeMethod, throw on fail).

   TurfSimTest exercises TurfStep's contracts in isolation with a hand-built
   turf. This test closes the other half: it drives Systems.SpawnWorld (which
   is where the turf wiring lives) and the actual per-frame step order used by
   GameLoop, so the wiring is checked against a real procedural city and the
   new TurfStep call is exercised inside the full pipeline (no scene, no
   GameObjects — all these steps are data-only).

   Pins:
     1. SpawnWorld creates exactly GangCount/4 turfs, each referencing exactly
        four living gangsters, and the turf crews partition the gangster set
        exactly (no dup, no miss), 2v2 balanced per turf;
     2. the integrated step loop (with TurfStep in place) runs for 30 frames
        without throwing and keeps the turf count stable;
     3. clearing a turf through the REAL gameplay path
        (Systems.PlayerKillsGangster, not by hand-setting Dead) marks it
        cleared, drops one SMG crate on the corner, and pays the lump.

   Run with:
     Unity -quit -batchmode -projectPath <project> -executeMethod
     GameLoopSimTest.Run
*/
using System.Collections.Generic;
using UnityEngine;
using LocalTheftAuto;

public static class GameLoopSimTest
{
    static int checksPassed;

    static void Check(bool cond, string what)
    {
        if (!cond) throw new System.Exception("GameLoopSimTest FAIL: " + what);
        checksPassed++;
    }

    public static void Run()
    {
        SpawnWorld_WiresTurfs();
        FullStepLoop_DoesNotThrow();
        RealKillPath_ClearsTurf();

        Debug.Log("GameLoopSimTest: " + checksPassed + " checks passed");
    }

    static TurfEnt TurfOf(GameData d, int pedIdx)
    {
        for (int i = 0; i < d.Turfs.Count; i++)
        {
            int[] idxs = d.Turfs[i].GangsterIdx;
            for (int k = 0; k < idxs.Length; k++) if (idxs[k] == pedIdx) return d.Turfs[i];
        }
        return null;
    }

    static void SpawnWorld_WiresTurfs()
    {
        var d = new GameData();
        Systems.SpawnWorld(d);

        int expected = Mathf.Max(1, Cfg.GangCount / 4);
        Check(d.Turfs.Count == expected, "SpawnWorld creates exactly GangCount/4 turfs (" + d.Turfs.Count + ")");

        var gangsters = new List<int>();
        for (int i = 0; i < d.Peds.Count; i++) if (d.Peds[i].Kind == PedKind.Gangster) gangsters.Add(i);
        Check(gangsters.Count == Cfg.GangCount, "SpawnWorld spawns exactly GangCount gangsters (" + gangsters.Count + ")");

        foreach (var turf in d.Turfs)
        {
            Check(turf.GangsterIdx != null && turf.GangsterIdx.Length == 4, "each turf references exactly 4 gangsters");
            foreach (var gi in turf.GangsterIdx)
            {
                Check(gi >= 0 && gi < d.Peds.Count, "turf gangster index is in range");
                Check(d.Peds[gi].Kind == PedKind.Gangster, "turf gangster is actually a gangster");
            }
        }

        // the turf crews must partition the gangster set exactly
        var covered = new HashSet<int>();
        foreach (var turf in d.Turfs)
            foreach (var gi in turf.GangsterIdx)
                Check(covered.Add(gi), "turf gangsters are unique across turfs");
        foreach (var g in gangsters)
            Check(covered.Contains(g), "every gangster belongs to exactly one turf");

        // each turf holds a balanced 2v2 cluster (the k % 2 seeding)
        foreach (var turf in d.Turfs)
        {
            int red = 0, blue = 0;
            foreach (var gi in turf.GangsterIdx) { if (d.Peds[gi].Gang == 0) red++; else blue++; }
            Check(red == 2 && blue == 2, "turf holds a balanced 2v2 cluster");
        }
    }

    static void FullStepLoop_DoesNotThrow()
    {
        var d = new GameData();
        var s = d.State;
        Systems.SpawnWorld(d);
        s.Started = true;
        int before = d.Turfs.Count;
        float dt = 1f / 60f;
        try
        {
            for (int step = 0; step < 30; step++)
            {
                s.Time += dt;
                double t = s.Time;
                // the exact order GameLoop uses (player physics omitted —
                // it needs the chase-camera yaw and Input, neither is sim
                // state, and it is not what this test exercises)
                Systems.SpikeStep(d, dt);
                Systems.GasStationStep(d, dt);
                Systems.GarageStep(d, dt);
                for (int i = 0; i < d.Cars.Count; i++) Systems.TrafficStep(d, d.Cars[i], dt);
                Systems.WreckStep(d, dt);
                for (int j = 0; j < d.Peds.Count; j++) Systems.PedStep(d, d.Peds[j], dt);
                Systems.RespawnDeadPeds(d);
                Systems.PickupStep(d);
                Systems.WeaponPickupStep(d);
                Systems.TurfStep(d, t, dt);   // <-- the call this feature adds
                Systems.WeatherStep(d, t);
                MissionSys.Step(d, t);
                Systems.ParticlesStep(d, dt);
                Systems.LawStep(d, t, dt);
            }
        }
        catch (System.Exception ex)
        {
            throw new System.Exception("GameLoopSimTest FAIL: integrated step loop threw: " + ex.Message, ex);
        }
        Check(d.Turfs.Count == before, "turf count is stable across 30 integrated steps");
    }

    static void RealKillPath_ClearsTurf()
    {
        var d = new GameData();
        var s = d.State;
        Systems.SpawnWorld(d);
        s.Started = true;

        TurfEnt turf = d.Turfs[0];
        Check(turf != null && TurfOf(d, turf.GangsterIdx[0]) == turf, "turf ownership is resolvable from a crew member");
        int weaponsBefore = d.Weapons.Count;
        int scoreBefore = s.Score;

        // kill the whole crew through the REAL gameplay path — this also
        // raises wanted, fires the vendetta, and may drop loose ammo, none of
        // which should interfere with the turf reward below
        foreach (var gi in turf.GangsterIdx)
            Systems.PlayerKillsGangster(d, d.Peds[gi], 0f);

        // the integrated step the game loop runs (TurfStep, as in GameLoop)
        s.Time += 1f / 60f;
        Systems.TurfStep(d, s.Time, 1f / 60f);

        Check(turf.Cleared, "real kill path marks the turf cleared");
        Check(turf.CrateDropped, "real kill path drops the crate");
        Check(d.Weapons.Count == weaponsBefore + 1, "exactly one crate is added on clear");
        Check(s.Score - scoreBefore >= Cfg.TurfClearScore, "clear pays at least the lump (" + (s.Score - scoreBefore) + " >= " + Cfg.TurfClearScore + ")");

        WeaponEnt crate = d.Weapons[d.Weapons.Count - 1];
        Check(Mathf.Approximately(crate.X, turf.X) && Mathf.Approximately(crate.Y, turf.Y), "crate lands on the turf corner");
        Check(crate.Gun == Cfg.CrateSmg, "crate is the SMG reward");
    }
}