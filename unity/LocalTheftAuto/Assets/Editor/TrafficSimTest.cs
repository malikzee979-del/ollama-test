/* Headless regression for the traffic-light right-of-way system (Phase 5).

   Steps the real traffic AI for a few simulated minutes with no scene, no
   rendering and no visuals, then asserts the three failure modes a
   screenshot cannot catch:
     - cars actually stop on red (the gate engages),
     - stopped cars release and move again when their light goes green
       (no stuck queue / deadlock),
     - the road network does not permanently gridlock (mean speed stays sane).

   The gate is the code path in Systems.TrafficStep; the light phase comes
   from TrafficLights, the same stateless function the renderer uses, so a
   green-vs-red disagreement between what cars obey and what the light shows
   would surface here too.

   Run with:
     Unity -quit -batchmode -projectPath <project> -executeMethod TrafficSimTest.Run
*/
using UnityEditor;
using UnityEngine;
using LocalTheftAuto;

public static class TrafficSimTest
{
    public static void Run()
    {
        var d = new GameData();
        Systems.SpawnWorld(d);

        int n = d.Cars.Count, active = 0;
        for (int i = 0; i < n; i++)
            if (!d.Cars[i].Parked && !d.Cars[i].Wrecked) active++;
        Debug.Log(string.Format("[Traffic] spawned cars={0} (active={1})", n, active));

        float[] x0 = new float[n], y0 = new float[n];
        bool[] wasStopped = new bool[n];
        float[] stopElapsed = new float[n];
        bool[] stopAtRed = new bool[n];
        for (int i = 0; i < n; i++) { x0[i] = d.Cars[i].X; y0[i] = d.Cars[i].Y; }

        int redStops = 0, redReleases = 0;
        double speedSum = 0; long speedSamples = 0;

        const float dt = 1f / 60f;
        const int steps = 180 * 60;          // 3 simulated minutes
        for (int s = 0; s < steps; s++)
        {
            d.State.Time += dt;
            for (int i = 0; i < n; i++)
            {
                CarEnt c = d.Cars[i];
                if (c.Parked || c.IsPlayer || c.Wrecked) continue;

                // Latch stop/release transitions BEFORE stepping so the
                // before/after straddles the frame, like GangSimTest does.
                bool stopped = c.Speed < 5f;
                bool atRed = AtRed(c, d);
                if (stopped)
                {
                    if (!wasStopped[i])
                    {
                        stopElapsed[i] = 0f;
                        stopAtRed[i] = atRed;
                        if (atRed) redStops++;
                    }
                    else stopElapsed[i] += dt;
                }
                else if (wasStopped[i] && stopAtRed[i] && stopElapsed[i] > 1f)
                {
                    redReleases++;
                }
                wasStopped[i] = stopped;

                Systems.TrafficStep(d, c, dt);
                speedSum += Mathf.Abs(c.Speed);
                speedSamples++;
            }
        }

        double meanSpeed = speedSum / speedSamples;
        int moved = 0;
        for (int i = 0; i < n; i++)
        {
            CarEnt c = d.Cars[i];
            if (c.Parked) continue;
            float dx = c.X - x0[i], dy = c.Y - y0[i];
            if (dx * dx + dy * dy > 200f * 200f) moved++;
        }
        Debug.Log(string.Format(
            "[Traffic] meanSpeed={0:F1} redStops={1} redReleases={2} movedFar={3}/{4}",
            meanSpeed, redStops, redReleases, moved, active));

        bool ok = true;
        if (redStops == 0) { Debug.LogError("[Traffic] FAIL: no car ever stopped at a red light"); ok = false; }
        if (redReleases < redStops / 2)
        {
            Debug.LogError(string.Format(
                "[Traffic] FAIL: red stops not releasing on green ({0}/{1})", redReleases, redStops));
            ok = false;
        }
        if (meanSpeed < 20)
        {
            Debug.LogError("[Traffic] FAIL: traffic gridlocked (meanSpeed " + meanSpeed.ToString("F1") + ")");
            ok = false;
        }

        Debug.Log(ok ? "[Traffic] PASS" : "[Traffic] FAILED");
        if (!ok) EditorApplication.Exit(1);
    }

    // Is car c within LightStopDist of a crossing stop line AND its light
    // red? Mirrors the gate in Systems.TrafficStep so the test measures the
    // exact condition the AI is acting on.
    static bool AtRed(CarEnt c, GameData d)
    {
        int txx = Mathf.FloorToInt(c.X / Cfg.Tile);
        int tyy = Mathf.FloorToInt(c.Y / Cfg.Tile);
        int cbx = txx / Cfg.BlockTiles, cby = tyy / Cfg.BlockTiles;
        int rxx = txx % Cfg.BlockTiles, ryy = tyy % Cfg.BlockTiles;
        float line = 0f, dist = float.MaxValue;
        if (c.Dir == 0) { if (rxx >= 3) { cbx++; line = cbx * Cfg.BlockTiles * Cfg.Tile; dist = line - c.X; } }
        else if (c.Dir == 2) { line = cbx * Cfg.BlockTiles * Cfg.Tile + 3f * Cfg.Tile; dist = c.X - line; }
        else if (c.Dir == 1) { if (ryy >= 3) { cby++; line = cby * Cfg.BlockTiles * Cfg.Tile; dist = line - c.Y; } }
        else { line = cby * Cfg.BlockTiles * Cfg.Tile + 3f * Cfg.Tile; dist = c.Y - line; }
        return dist >= 0f && dist < Cfg.LightStopDist
            && TrafficLights.Stop(cbx, cby, c.Dir, (float)d.State.Time);
    }
}
