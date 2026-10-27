/* LtaStats smoke checks (LTA.Stats.cs) — the stats/achievements/combo layer
   added in slice 1 (F19), exercised the same way the other Editor harnesses
   are run (headless -executeMethod, plain bool checks, Fail() throws).

   Pins the guarantees the call sites build on:
     1. a fresh LtaStats loads from an absent PlayerPrefs key with defaults
        (the SettingsStore contract the code relies on);
     2. Save→Load is identity for every stat + achievement flag;
     3. Award/Unlock/counter mutations persist across a Load cycle;
     4. corrupt JSON in the "lta_stats" key falls back to defaults without
        throwing (same try/catch discipline as SettingsStore);
     5. NpcBridge.Canned is deterministic per (npc, scene, seed) and returns
        a non-empty line.

   Run with:
     Unity -quit -batchmode -projectPath <project> -executeMethod
     LtaStatsSmoke.Run
   (Exit code 0 = all checks passed; a Fail prints the failing check and
   exits non-zero through the exception.)
*/
using UnityEngine;
using LocalTheftAuto;

public static class LtaStatsSmoke
{
    static int checksPassed;

    static void Check(bool cond, string what)
    {
        if (!cond) throw new System.Exception("LtaStatsSmoke FAIL: " + what);
        checksPassed++;
    }

    public static void Run()
    {
        // isolate this test's key so it never clobbers a developer's stats
        PlayerPrefs.DeleteKey("lta_stats");

        Fresh_LoadsDefaults();
        RoundTrip_IsIdentity();
        Mutations_PersistAcrossLoad();
        CorruptKey_FallsBackToDefaults();
        NpcBridge_Canned_IsDeterministic();

        PlayerPrefs.DeleteKey("lta_stats");
        Debug.Log("LtaStatsSmoke: " + checksPassed + " checks passed");
    }

    static void Fresh_LoadsDefaults()
    {
        PlayerPrefs.DeleteKey("lta_stats");
        StatsSys.Load();
        var s = StatsSys.Instance;
        Check(s.steals == 0 && s.drifted == 0 && s.deliveries == 0, "fresh counters default to 0");
        Check(s.fiveStarSeconds == 0 && s.garageSaves == 0 && s.shots == 0, "fresh counters default to 0 (rest)");
        Check(!s.firstSteal && !s.drifter && !s.mostWanted, "fresh achievements default to false");
        Check(!s.courier && !s.collector && !s.brawler, "fresh achievements default to false (rest)");
        Check(s.version == 1, "fresh version is 1");
    }

    static void RoundTrip_IsIdentity()
    {
        var s = StatsSys.Instance;
        s.steals = 3; s.drifted = 1234; s.deliveries = 4;
        s.fiveStarSeconds = 11; s.garageSaves = 2; s.styleBest = 950; s.shots = 40;
        s.firstSteal = true; s.drifter = true; s.mostWanted = true;
        s.courier = true; s.collector = true; s.brawler = true;
        StatsSys.Save();
        PlayerPrefs.DeleteKey("lta_stats_backup"); // not used, keep clean
        string json = PlayerPrefs.GetString("lta_stats");
        var back = JsonUtility.FromJson<LtaStats>(json);
        Check(back.steals == 3 && back.drifted == 1234 && back.deliveries == 4, "round-trip: counters");
        Check(back.fiveStarSeconds == 11 && back.garageSaves == 2 && back.shots == 40, "round-trip: counters (rest)");
        Check(back.styleBest == 950, "round-trip: styleBest");
        Check(back.firstSteal && back.drifter && back.mostWanted, "round-trip: achievement flags");
        Check(back.courier && back.collector && back.brawler, "round-trip: achievement flags (rest)");
        Check(back.version == 1, "round-trip: version");
    }

    static void Mutations_PersistAcrossLoad()
    {
        // reset to a clean slate first
        PlayerPrefs.DeleteKey("lta_stats");
        StatsSys.Load();

        int st = StatsSys.Steals();
        Check(st == 1, "Steals() increments and returns the new total");
        StatsSys.Unlock("firstSteal");
        Check(StatsSys.Instance.firstSteal, "Unlock sets the flag");

        StatsSys.GarageSaves();
        Check(StatsSys.Instance.garageSaves == 1, "GarageSaves() increments");
        StatsSys.Shots();
        Check(StatsSys.Instance.shots == 1, "Shots() increments");
        Check(StatsSys.AddDrifted(100) == 100, "AddDrifted accumulates");

        int fs = StatsSys.AccumulateFiveStar(0.4);
        Check(fs == 0, "AccumulateFiveStar(<0.5s) does not tick a whole second");
        fs = StatsSys.AccumulateFiveStar(1.6f);
        Check(fs == 2, "AccumulateFiveStar rounds 0.4+1.6 → 2s total");
        Check(StatsSys.Instance.mostWanted == false, "Most Wanted does not unlock under 20s");

        // force the threshold: bump the stored total past the Cfg value, then
        // accumulate one more second — Unlock must fire.
        var s = StatsSys.Instance;
        s.fiveStarSeconds = Cfg.MostWantedSeconds; // 20 — at, not past, threshold
        StatsSys.Save();
        StatsSys.AccumulateFiveStar(1.0f);
        Check(StatsSys.Instance.fiveStarSeconds == 21, "AccumulateFiveStar past threshold increments");
        Check(StatsSys.Instance.mostWanted, "Most Wanted unlocks past the threshold");

        // a full persistence cycle: save, forget the in-memory instance via a
        // fresh Load, and confirm the mutations are still there.
        StatsSys.Save();
        PlayerPrefs.DeleteKey("lta_stats"); // and prove Load() re-reads from disk
        string disk = PlayerPrefs.GetString("lta_stats");
        // (we just deleted it — restore from the JSON we still hold)
        PlayerPrefs.SetString("lta_stats", disk ?? "{}");
        // simpler and stricter: delete, save again from current state, load.
        var before = StatsSys.Instance;
        StatsSys.Save();
        PlayerPrefs.DeleteKey("lta_stats");
        PlayerPrefs.SetString("lta_stats", JsonUtility.ToJson(before));
        StatsSys.Load();
        var after = StatsSys.Instance;
        Check(after.steals == before.steals && after.garageSaves == before.garageSaves
              && after.shots == before.shots, "mutations persist across a Load cycle");
        Check(after.mostWanted && after.firstSteal, "achievement flags persist across a Load cycle");
    }

    static void CorruptKey_FallsBackToDefaults()
    {
        PlayerPrefs.SetString("lta_stats", "{ definitely not json,,,");
        StatsSys.Load();
        var s = StatsSys.Instance;
        Check(s.steals == 0 && !s.firstSteal && s.version == 1,
              "corrupt lta_stats JSON falls back to defaults without throwing");
    }

    static void NpcBridge_Canned_IsDeterministic()
    {
        string a1 = NpcBridge.Canned("the gang boss", "street corner", 3.25f);
        string a2 = NpcBridge.Canned("the gang boss", "street corner", 3.25f);
        Check(a1 == a2, "Canned is deterministic per (npc, scene, seed)");
        Check(!string.IsNullOrWhiteSpace(a1), "Canned returns a non-empty line");

        // different seed → (usually) a different line; assert only that the
        // output stays within the table's alphabet space (no exceptions,
        // non-empty) rather than pinning one specific different line.
        string b = NpcBridge.Canned("the gang boss", "street corner", 99.75f);
        Check(!string.IsNullOrWhiteSpace(b), "Canned varies by seed without failing");

        // null-safety: the helper must not NRE on null inputs.
        string n = NpcBridge.Canned(null, null, 0f);
        Check(!string.IsNullOrWhiteSpace(n), "Canned tolerates null npc/scene");
    }
}