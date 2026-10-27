/* ==========================================================================
   Local Theft Auto — lifetime stats, achievements and style-combo scoring.
   Ported from marketing/game.js (STATS_DEFAULTS, ACHIEVEMENTS, unlockAch,
   statsLine, the style-combo "awardStyle" block, completeMission).

   Persistence: a SEPARATE PlayerPrefs key ("lta_stats"), deliberately not
   part of SaveData — that's a project decision for this slice, and it means
   no SaveData migration is needed. Same JsonUtility + try/catch discipline
   as SettingsStore (LTA.Core.cs): old/partial/corrupt JSON deserializes to
   the C# field defaults and never throws.

   The combo (style pts/combo/mult/lastHit) lives here too, keyed off the
   game's SIM time (GameState.Time) so a pause freezes it — the JS original
   keyed it off wall-clock now(), which a pause would have advanced; using
   sim time is the correct 1:1 port because sim time is the game's clock.

   All stat mutation goes through the static API below. Call sites are
   read-only: they call Award/Unlock/AddStat and read StatsLine().
   ========================================================================== */
using UnityEngine;

namespace LocalTheftAuto
{
    // The serializable snapshot (stats + achievement flags + version).
    [System.Serializable]
    public class LtaStats
    {
        // STATS_DEFAULTS (game.js:293)
        public int steals;
        public int drifted;          // px of skid laid (JS units)
        public int deliveries;
        public int fiveStarSeconds;  // seconds spent at 5 stars
        public int garageSaves;
        public int styleBest;        // highest style pts in a single run
        public int shots;

        // One bool per achievement (ACHIEVEMENTS, game.js ~350)
        public bool firstSteal;
        public bool drifter;
        public bool mostWanted;
        public bool courier;
        public bool collector;
        public bool brawler;

        public int version = 1;

        // How many achievements exist, for the "n/6" readout.
        public const int TotalAchievements = 6;

        public void Reset()
        {
            steals = 0; drifted = 0; deliveries = 0; fiveStarSeconds = 0;
            garageSaves = 0; styleBest = 0; shots = 0;
            firstSteal = false; drifter = false; mostWanted = false;
            courier = false; collector = false; brawler = false;
            version = 1;
        }
    }

    public static class StatsSys
    {
        const string Key = "lta_stats";

        // Thresholds — copied from the JS call sites (see game.js comments).
        const int DrifterDrifted = 5000;        // "5km of skid marks" (JS px)
        const int MostWantedSeconds = 20;       // "survived 20s at 5 stars"
        const int CourierDeliveries = 5;        // "5 deliveries completed"
        const float StyleComboWindow = 4f;      // awardStyle STYLE_WINDOW
        const int StyleMaxMult = 4;

        // The single mutable instance. Combo is held on this object too but
        // NOT serialized into the save: it is per-run presentation state, so
        // it resets on a fresh run (see ResetRun) and never round-trips.
        static LtaStats stats;
        static float comboPts;      // style.pts
        static int comboCount;      // style.combo
        static int comboMult;       // style.mult
        static double comboLastHit; // style.lastHit (sim time); -1e9 = idle

        /* ------------------------------------------------------------ state */

        static LtaStats Current()
        {
            if (stats == null) Load();
            return stats;
        }

        public static LtaStats Instance { get { return Current(); } }

        // The current combo multiplier (1..4) — the HUD reads this to show the
        // ×2/×3/×4 readout while a combo is active.
        public static int ComboMult
        {
            get
            {
                // decay on read so the HUD never shows a stale multiplier
                DecayCombo(Current());
                return comboMult;
            }
        }

        /* ------------------------------------------------------ combo/award */

        // Decay the combo against the CURRENT sim time. No-ops while paused
        // because GameState.Time only advances when the sim steps.
        public static void DecayCombo(LtaStats s)
        {
            double now = CurrentSimTime();
            if (comboCount > 0 && now - comboLastHit >= StyleComboWindow)
            {
                comboCount = 0;
                comboMult = 1;
            }
        }

        static double CurrentSimTime()
        {
            // The sim clock; falls back to 0 (never decays) if there's no
            // running game (e.g. headless tests) so combo math stays stable.
            return GameLoop.Active != null ? GameLoop.Active.SimTime : 0.0;
        }

        // awardStyle (game.js:393). base is the raw event value (near-miss 25,
        // roadblock 150, drift chunks), label the pop-up text, (x, y) the world
        // position of the event for the HUD pop (this port drops the on-screen
        // pop pool; the multiplier feeds the score readout instead).
        public static void Award(int baseValue, string label, float x, float y)
        {
            var s = Current();
            double now = CurrentSimTime();
            comboCount = (now - comboLastHit < StyleComboWindow) ? comboCount + 1 : 1;
            comboMult = Mathf.Min(StyleMaxMult, comboCount);
            int pts = baseValue * comboMult;
            comboPts += pts;
            comboLastHit = now;

            // score feeds through the same path the missions use
            if (GameLoop.Active != null)
            {
                var g = GameLoop.Active.Data;
                if (g != null) g.State.Score += pts;
            }

            if ((int)comboPts > s.styleBest) { s.styleBest = (int)comboPts; Save(); }
        }

        // Reset the per-run combo and the style-best accumulator when a run
        // starts (the JS resets style.pts on newRun/bust; styleBest is the
        // LIFETIME record and is kept). Call from GameLoop on run start/restart.
        public static void ResetRun()
        {
            comboPts = 0;
            comboCount = 0;
            comboMult = 1;
            comboLastHit = -1e9;
        }

        /* ------------------------------------------------------- achievements */

        // unlockAch (game.js:359). No-op when already unlocked; persists and
        // says the unlock line.
        public static void Unlock(string id)
        {
            var s = Current();
            if (GetFlag(s, id)) return;
            SetFlag(s, id);
            Save();
            // Ticker line, same path as every other game message. Only exists
            // once a run is going — unlocks during headless tests are silent.
            var g = GameLoop.Active;
            if (g != null && g.Data != null)
                g.Data.State.Say("Achievement unlocked: " + ACHIEVEMENTS[id]);
        }

        static bool GetFlag(LtaStats s, string id)
        {
            switch (id)
            {
                case "firstSteal": return s.firstSteal;
                case "drifter": return s.drifter;
                case "mostWanted": return s.mostWanted;
                case "courier": return s.courier;
                case "collector": return s.collector;
                case "brawler": return s.brawler;
                default: return false;
            }
        }

        static void SetFlag(LtaStats s, string id)
        {
            switch (id)
            {
                case "firstSteal": s.firstSteal = true; break;
                case "drifter": s.drifter = true; break;
                case "mostWanted": s.mostWanted = true; break;
                case "courier": s.courier = true; break;
                case "collector": s.collector = true; break;
                case "brawler": s.brawler = true; break;
            }
        }

        // ACHIEVEMENTS (game.js ~350)
        static string ACH(string id)
        {
            switch (id)
            {
                case "firstSteal": return "First Steal — borrowed your first car.";
                case "drifter": return "Drifter — 5km of skid marks.";
                case "mostWanted": return "Most Wanted — survived 20s at 5 stars.";
                case "courier": return "Courier — 5 deliveries completed.";
                case "collector": return "Collector — saved your first car to the garage.";
                case "brawler": return "Brawler — threw your first punch.";
                default: return "Achievement";
            }
        }
        static readonly System.Collections.Generic.Dictionary<string, string> ACHIEVEMENTS =
            new System.Collections.Generic.Dictionary<string, string>
        {
            { "firstSteal", ACH("firstSteal") },
            { "drifter", ACH("drifter") },
            { "mostWanted", ACH("mostWanted") },
            { "courier", ACH("courier") },
            { "collector", ACH("collector") },
            { "brawler", ACH("brawler") },
        };

        /* ---------------------------------------------------------- counters */

        // AddStat helpers — one per stat, all go through Save() so a mutation
        // is never lost. Each returns the updated value for call sites that
        // want it (e.g. to compare against an achievement threshold).
        public static int Steals() { var s = Current(); s.steals++; Save(); return s.steals; }
        public static int AddDrifted(int px) { var s = Current(); s.drifted += px; Save(); return s.drifted; }
        public static int Deliveries() { var s = Current(); s.deliveries++; Save(); return s.deliveries; }
        public static int AddFiveStarSeconds(int sec) { var s = Current(); s.fiveStarSeconds += sec; Save(); return s.fiveStarSeconds; }
        // F19: 5★ survival — accumulate dt as whole seconds (matches the JS
        // integer field) and unlock Most Wanted past the threshold. Returns
        // the new total so a caller that wants a custom check can compare.
        public static int AccumulateFiveStar(double dt)
        {
            int add = Mathf.RoundToInt((float)dt);
            if (add <= 0) return Current().fiveStarSeconds;
            var s = Current();
            s.fiveStarSeconds += add;
            if (s.fiveStarSeconds > Cfg.MostWantedSeconds) Unlock("mostWanted");
            Save();
            return s.fiveStarSeconds;
        }
        public static int GarageSaves() { var s = Current(); s.garageSaves++; Save(); return s.garageSaves; }
        public static int Shots() { var s = Current(); s.shots++; Save(); return s.shots; }

        /* ---------------------------------------------------------- readout */

        // statsLine (game.js:366). The HUD shows this in the pause overlay.
        public static string StatsLine()
        {
            var s = Current();
            int n = 0;
            if (s.firstSteal) n++;
            if (s.drifter) n++;
            if (s.mostWanted) n++;
            if (s.courier) n++;
            if (s.collector) n++;
            if (s.brawler) n++;
            int highScore = 0;
            if (GameLoop.Active != null && GameLoop.Active.Data != null)
                highScore = GameLoop.Active.Data.State.HighScore;
            return "BEST " + highScore + " \u00b7 " + s.steals + " steals \u00b7 "
                 + s.deliveries + " deliveries \u00b7 "
                 + n + "/" + LtaStats.TotalAchievements + " achievements";
        }

        /* ------------------------------------------------------- persistence */

        public static void Load()
        {
            LtaStats s = null;
            try
            {
                string json = PlayerPrefs.GetString(Key, null);
                if (!string.IsNullOrEmpty(json)) s = JsonUtility.FromJson<LtaStats>(json);
            }
            catch (System.Exception) { s = null; }   // corrupt key — fall back to defaults
            stats = s ?? new LtaStats();
        }

        public static void Save()
        {
            PlayerPrefs.SetString(Key, JsonUtility.ToJson(Current()));
            PlayerPrefs.Save();
        }
    }
}