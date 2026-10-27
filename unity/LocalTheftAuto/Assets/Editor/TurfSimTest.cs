/* Turf-economics sim checks for the clear/hold rewards (LTA.Systems.cs
   TurfStep) — the same headless pattern as PoliceSimTest/GangSimTest/
   MissionSimTest (-executeMethod, plain bool checks, throw on fail).

   Pins the sim contracts the HUD reads:
     1. a turf whose whole crew is dead pays the lump exactly once and drops
        one crate on the corner;
     2. the lump is never paid twice for the same wipe;
     3. a cleared turf held by the player pays a drip, and only after one
        full TurfHoldInterval has elapsed on the sim clock;
     4. the hold drip is distance-gated — a player outside TurfHoldRadius
        gets nothing;
     5. a respawned crew re-arms the turf: clearing again pays a fresh lump;
     6. a turf is never "cleared" while any of its gangsters is alive.

   Run with:
     Unity -quit -batchmode -projectPath <project> -executeMethod
     TurfSimTest.Run
   (Quit code 0 = all checks passed; a Fail prints the failing check and
   exits non-zero through the exception.)
*/
using UnityEngine;
using LocalTheftAuto;

public static class TurfSimTest
{
    static int checksPassed;

    static void Check(bool cond, string what)
    {
        if (!cond) throw new System.Exception("TurfSimTest FAIL: " + what);
        checksPassed++;
    }

    public static void Run()
    {
        Clear_PaysLumpOnceAndDropsCrate();
        Clear_IsNeverPaidTwice();
        Hold_PaysDripAfterInterval();
        Hold_IsDistanceGated();
        Respawn_ReArms();
        Alive_CrewNeverCountsAsCleared();

        Debug.Log("TurfSimTest: " + checksPassed + " checks passed");
    }

    // Build a GameData with exactly one turf at (100,100) and its four
    // gangsters, none dead. Returns the turf so tests can flip its crew.
    static TurfEnt MakeTurf(GameData d, out PedEnt[] crew)
    {
        crew = new PedEnt[4];
        for (int k = 0; k < 4; k++)
        {
            crew[k] = new PedEnt { Kind = PedKind.Gangster, Gang = k % 2 };
            d.Peds.Add(crew[k]);
        }
        int[] idx = { 0, 1, 2, 3 };
        TurfEnt turf = new TurfEnt
        {
            X = 100f, Y = 100f,
            Bx = 1, By = 1,
            GangsterIdx = idx,
            Cleared = false,
            CrateDropped = false,
            LastDrip = -1e9
        };
        d.Turfs.Add(turf);
        d.Player.X = 100f; d.Player.Y = 100f;   // standing on the turf
        return turf;
    }

    static int WeaponCount(GameData d) { return d.Weapons.Count; }

    static void Clear_PaysLumpOnceAndDropsCrate()
    {
        var d = new GameData();
        PedEnt[] crew;
        TurfEnt turf = MakeTurf(d, out crew);
        int baseScore = d.State.Score;
        int baseWeapons = WeaponCount(d);

        // crew alive — nothing paid
        Systems.TurfStep(d, 0.0, 0.016f);
        Check(d.State.Score == baseScore, "alive crew: no score before wipe");
        Check(!turf.Cleared, "alive crew: turf not cleared");

        // kill the whole crew
        for (int k = 0; k < 4; k++) crew[k].Dead = true;
        Systems.TurfStep(d, 1.0, 0.016f);

        Check(d.State.Score == baseScore + Cfg.TurfClearScore, "wipe pays exactly one lump");
        Check(turf.Cleared, "wipe marks the turf cleared");
        Check(turf.CrateDropped, "wipe drops the crate");
        Check(WeaponCount(d) == baseWeapons + 1, "wipe adds exactly one crate");
        // the crate lands on the corner, kind = SMG
        WeaponEnt crate = d.Weapons[baseWeapons];
        Check(Mathf.Approximately(crate.X, 100f) && Mathf.Approximately(crate.Y, 100f), "crate spawns on the turf corner");
        Check(crate.Gun == Cfg.CrateSmg, "crate is the SMG reward");
    }

    static void Clear_IsNeverPaidTwice()
    {
        var d = new GameData();
        PedEnt[] crew;
        TurfEnt turf = MakeTurf(d, out crew);
        int baseScore = d.State.Score;
        for (int k = 0; k < 4; k++) crew[k].Dead = true;

        Systems.TurfStep(d, 1.0, 0.016f);
        int afterFirst = d.State.Score;
        Check(afterFirst == baseScore + Cfg.TurfClearScore, "first wipe paid the lump");

        // Move the player OUT of the hold radius so only the lump is under
        // test — a cleared turf the player stands on legitimately earns the
        // hold drip (covered by Hold_PaysDripAfterInterval), and this check
        // is specifically about the lump not firing a second time.
        d.Player.X = 100f + Cfg.TurfHoldRadius * 3f;
        d.Player.Y = 100f;

        // keep stepping with the crew still dead — the lump must not repeat
        Systems.TurfStep(d, 2.0, 0.016f);
        Systems.TurfStep(d, 3.0, 0.016f);
        Check(d.State.Score == afterFirst, "lump is never paid twice");
    }

    static void Hold_PaysDripAfterInterval()
    {
        var d = new GameData();
        PedEnt[] crew;
        TurfEnt turf = MakeTurf(d, out crew);
        int baseScore = d.State.Score;
        for (int k = 0; k < 4; k++) crew[k].Dead = true;

        // bank the clear at t=0 (lump), then measure drip independently
        Systems.TurfStep(d, 0.0, 0.016f);
        int afterClear = d.State.Score;

        // within one interval of the clear — no drip yet (last tick was the lump)
        Systems.TurfStep(d, Cfg.TurfHoldInterval * 0.5, 0.016f);
        Check(d.State.Score == afterClear, "no drip before one full interval");

        // past one interval on the sim clock — one drip
        Systems.TurfStep(d, Cfg.TurfHoldInterval + 0.001, 0.016f);
        Check(d.State.Score == afterClear + Cfg.TurfHoldScore, "one drip after one interval");

        // another interval — another drip
        Systems.TurfStep(d, 2 * Cfg.TurfHoldInterval + 0.001, 0.016f);
        Check(d.State.Score == afterClear + 2 * Cfg.TurfHoldScore, "second drip after a second interval");

        // holding the same interval twice does NOT double-pay
        int before = d.State.Score;
        Systems.TurfStep(d, 2 * Cfg.TurfHoldInterval + 0.002, 0.016f);
        Check(d.State.Score == before, "no drip inside the interval window");
        Check(turf.Cleared, "turf still cleared while held");
    }

    static void Hold_IsDistanceGated()
    {
        var d = new GameData();
        PedEnt[] crew;
        MakeTurf(d, out crew);
        for (int k = 0; k < 4; k++) crew[k].Dead = true;

        // put the player well outside TurfHoldRadius
        d.Player.X = 100f + Cfg.TurfHoldRadius * 3f;
        d.Player.Y = 100f;
        Systems.TurfStep(d, 0.0, 0.016f);   // bank the clear
        int afterClear = d.State.Score;

        // hold an interval while out of range — nothing
        Systems.TurfStep(d, Cfg.TurfHoldInterval + 0.001, 0.016f);
        Systems.TurfStep(d, 2 * Cfg.TurfHoldInterval + 0.001, 0.016f);
        Check(d.State.Score == afterClear, "no drip while outside the hold radius");

        // move back inside — the drip resumes
        d.Player.X = 100f; d.Player.Y = 100f;
        Systems.TurfStep(d, 3 * Cfg.TurfHoldInterval + 0.001, 0.016f);
        Check(d.State.Score == afterClear + Cfg.TurfHoldScore, "drip resumes once back inside");
    }

    static void Respawn_ReArms()
    {
        var d = new GameData();
        PedEnt[] crew;
        TurfEnt turf = MakeTurf(d, out crew);
        for (int k = 0; k < 4; k++) crew[k].Dead = true;

        int baseScore = d.State.Score;
        Systems.TurfStep(d, 0.0, 0.016f);
        Check(d.State.Score == baseScore + Cfg.TurfClearScore, "first wipe paid");
        Check(turf.Cleared && turf.CrateDropped, "first wipe cleared + dropped crate");

        // the crew respawns (RespawnDeadPeds revives them)
        for (int k = 0; k < 4; k++) crew[k].Dead = false;
        Systems.TurfStep(d, 1.0, 0.016f);   // now contested again
        Check(!turf.Cleared, "respawned crew re-arms the turf");
        Check(!turf.CrateDropped, "respawned crew re-arms the crate too");

        // clear it a second time — a fresh lump
        for (int k = 0; k < 4; k++) crew[k].Dead = true;
        Systems.TurfStep(d, 2.0, 0.016f);
        Check(d.State.Score == baseScore + 2 * Cfg.TurfClearScore, "re-clear pays a fresh lump");
        Check(turf.CrateDropped, "re-clear drops a fresh crate");
    }

    static void Alive_CrewNeverCountsAsCleared()
    {
        var d = new GameData();
        PedEnt[] crew;
        TurfEnt turf = MakeTurf(d, out crew);
        // three dead, one alive — NOT a wipe
        crew[0].Dead = crew[1].Dead = crew[2].Dead = true;
        crew[3].Dead = false;
        int baseScore = d.State.Score;

        Systems.TurfStep(d, 0.0, 0.016f);
        Check(d.State.Score == baseScore, "partial wipe pays nothing");
        Check(!turf.Cleared, "partial wipe does not clear the turf");

        // the last one dies — only now is it a wipe
        crew[3].Dead = true;
        Systems.TurfStep(d, 1.0, 0.016f);
        Check(d.State.Score == baseScore + Cfg.TurfClearScore, "full wipe (all four) pays");
        Check(turf.Cleared, "full wipe clears the turf");
    }
}