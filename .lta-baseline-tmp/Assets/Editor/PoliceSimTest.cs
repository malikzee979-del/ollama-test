/* Headless simulation check for police pursuit (Phase 7 realism pass).

   Cops now follow roads — the same lane-snapping TrafficStep already gives
   ordinary traffic, plus a cheap greedy heuristic at each intersection that
   picks whichever open turn best matches the player's bearing — instead of
   the old straight-line Atan2 seek that was happy to drive through
   buildings. This is the single riskiest item in the whole realism plan (a
   chase that doesn't chase properly is immediately noticeable), so it ships
   with its own regression test rather than relying on manual play alone.

   There is no scripted input replay here — instead a decoy CarEnt is driven
   by the SAME TrafficStep AI every ordinary traffic car uses (road-following,
   turns at intersections, brakes for lights/traffic) and mirrored onto
   Player.X/Y/Vx/Vy each frame, so CopStep chases it exactly as it would
   chase a real driving player, without this test needing its own pathing
   or input code.

   Run with:
     Unity -quit -batchmode -projectPath <project> -executeMethod PoliceSimTest.Run
*/
using UnityEditor;
using UnityEngine;
using LocalTheftAuto;

public static class PoliceSimTest
{
    public static void Run()
    {
        var d = new GameData();
        Systems.SpawnWorld(d);

        // Scripted player path: a decoy car driven by ordinary TrafficStep AI.
        // Deliberately slower than a chasing cop's pursuit speed (~155-195
        // units/s) so "cops make measurable progress" has a fair chance
        // against the lane-following heuristic's lack of real pathfinding.
        Vector2 startTile = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Road));
        CarEnt decoy = Systems.MakeCar(startTile.x, startTile.y, Random.Range(0, 4), false);
        decoy.Speed = decoy.Cruise = 130f;
        d.Player.X = decoy.X; d.Player.Y = decoy.Y;

        var s = d.State;
        s.Started = true;
        s.Wanted = 4; // fixed, sustained pursuit for the length of the test

        const float dt = 1f / 60f;
        const int steps = 90 * 60; // 90 simulated seconds

        float initialDist = -1f;
        float minDist = float.MaxValue;
        double speedSum = 0; int speedSamples = 0;
        int bustedEvents = 0;
        int roadblockSamples = 0;

        for (int f = 0; f < steps; f++)
        {
            d.State.Time += dt;
            double t = d.State.Time;
            // keep Wanted from decaying or zeroing out mid-test — pursuit is
            // what's under test, not the decay/mission economy around it
            s.LastCrime = t;
            if (s.Busted <= 0f) s.Wanted = 4;

            Systems.TrafficStep(d, decoy, dt);
            d.Player.Vx = Cfg.Dx[decoy.Dir] * decoy.Speed;
            d.Player.Vy = Cfg.Dy[decoy.Dir] * decoy.Speed;
            d.Player.X = decoy.X; d.Player.Y = decoy.Y;

            bool wasBusted = s.Busted > 0f;
            Systems.LawStep(d, t, dt);
            if (s.Busted > 0f && !wasBusted) bustedEvents++;

            for (int i = 0; i < d.Cops.Count; i++)
            {
                CopEnt cop = d.Cops[i];
                if (cop.Roadblock) { roadblockSamples++; continue; }
                float dx = cop.X - d.Player.X, dy = cop.Y - d.Player.Y;
                float dist = Mathf.Sqrt(dx * dx + dy * dy);
                if (initialDist < 0f) initialDist = dist;
                if (dist < minDist) minDist = dist;
                speedSum += cop.Speed; speedSamples++;
            }
        }

        float avgSpeed = speedSamples > 0 ? (float)(speedSum / speedSamples) : 0f;
        float closed = initialDist >= 0f ? initialDist - minDist : 0f;

        Debug.Log(string.Format(
            "[PoliceSim] initialDist={0:F0} minDist={1:F0} closed={2:F0} avgCopSpeed={3:F0} bustedEvents={4} roadblockSamples={5}",
            initialDist, minDist, closed, avgSpeed, bustedEvents, roadblockSamples));

        bool ok = true;
        if (initialDist < 0f) { Debug.LogError("[PoliceSim] FAIL: no cops ever spawned"); ok = false; }
        // "measurable progress": either the gap meaningfully closed at some
        // point, or a bust actually happened (which is obviously progress).
        // No real pathfinding here, so this is a low bar deliberately — it's
        // meant to catch "cops never get anywhere near the player", not to
        // grade chase quality.
        if (closed < 150f && bustedEvents == 0)
        {
            Debug.LogError("[PoliceSim] FAIL: cops made no measurable progress closing distance");
            ok = false;
        }
        if (speedSamples > 0 && avgSpeed < 40f)
        {
            Debug.LogError("[PoliceSim] FAIL: cops averaged near-zero speed (stuck against geometry?)");
            ok = false;
        }
        if (roadblockSamples == 0)
        {
            Debug.LogError("[PoliceSim] FAIL: no roadblock ever appeared at Wanted>=3");
            ok = false;
        }

        Debug.Log(ok ? "[PoliceSim] PASS" : "[PoliceSim] FAILED");
        if (!ok) EditorApplication.Exit(1);
    }
}
