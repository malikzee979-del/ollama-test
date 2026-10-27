/* Slice 3 checks: truck & sports car (G) + wreckage lifecycle (H) —
   same headless pattern as MissionSimTest (-executeMethod, throw on fail).

   Pins the slice's load-bearing invariants:
     1. CarEnt.BodyType seed mapping — the two NEW branches (%8==5 sports,
        %8==6 truck) plus the unchanged bike and %3 car branches, so the
        whole 0..7 distribution is sedanhatchvanbikesportstruck;
     2. mesh and physics agree for every seed: BuildCar must take the SAME
        new branches (bike → 2 wheels, sports/truck → car with a distinct
        silhouette vs the original three profiles);
     3. the Cfg Body* arrays index 0..5 with the truck heaviest and slowest,
        the sports car fastest, every array exactly 6 entries;
     4. WreckStep: near wrecks smoke, far wrecks don't, wrecks age out at
        Cfg.WreckLinger and player wrecks are never removed;
     5. traffic brakes for a wrecked car in ProbeAhead (wrecks are query
        hits that aren't parked).

   Run with:
     Unity -quit -batchmode -nographics -projectPath <project> \
     -executeMethod VehicleWreckSimTest.Run
*/
using UnityEngine;
using LocalTheftAuto;

public static class VehicleWreckSimTest
{
    static int checksPassed;

    static void Check(bool cond, string what)
    {
        if (!cond) throw new System.Exception("VehicleWreckSimTest FAIL: " + what);
        checksPassed++;
    }

    public static void Run()
    {
        BodyType_Mapping();
        Arrays_SixEntriesAndOrdering();
        Mesh_Physics_AgreePerSeed();
        Wreck_Lifecycle();
        Wreck_ProbeAhead();

        Debug.Log("VehicleWreckSimTest: " + checksPassed + " checks passed");
    }

    /* ---- 1: the seed→body map, incl. the two NEW branches ---- */

    static void BodyType_Mapping()
    {
        // m==4 bike, m==5 sports, m==6 truck — the explicit branches
        Check(new CarEnt { Seed = 4 }.BodyType == Cfg.BodyBike, "seed 4 → bike");
        Check(new CarEnt { Seed = 5 }.BodyType == Cfg.BodySports, "seed 5 → sports");
        Check(new CarEnt { Seed = 6 }.BodyType == Cfg.BodyTruck, "seed 6 → truck");
        // m==0..3,7 fall through to the ORIGINAL Seed%3 branch, unchanged
        Check(new CarEnt { Seed = 0 }.BodyType == 0, "seed 0 → sedan (Seed%3)");
        Check(new CarEnt { Seed = 1 }.BodyType == 1, "seed 1 → hatch (Seed%3)");
        Check(new CarEnt { Seed = 2 }.BodyType == 2, "seed 2 → van (Seed%3)");
        Check(new CarEnt { Seed = 3 }.BodyType == 0, "seed 3 → sedan (3%3)");
        Check(new CarEnt { Seed = 7 }.BodyType == 1, "seed 7 → hatch (7%3)");
        // seeds 16..19 fall through the branch back to Seed%3 (m==0..3);
        // note 12..14 are caught by the m==4/5/6 branches (bike/sports/truck)
        Check(new CarEnt { Seed = 15 }.BodyType == 0, "seed 15 → sedan (15&7==7, 15%3)");
        Check(new CarEnt { Seed = 16 }.BodyType == 1, "seed 16 → hatch (16&7==0, 16%3)");
        Check(new CarEnt { Seed = 17 }.BodyType == 2, "seed 17 → van (17&7==1, 17%3)");
        Check(new CarEnt { Seed = 18 }.BodyType == 0, "seed 18 → sedan (18&7==2, 18%3)");
        Check(new CarEnt { Seed = 21 }.BodyType == 5, "seed 21 → sports (21&7==5)");
        Check(new CarEnt { Seed = 22 }.BodyType == 4, "seed 22 → truck (22&7==6)");
    }

    /* ---- 2: physics constants — 6 bodies, sane ordering ---- */

    static void Arrays_SixEntriesAndOrdering()
    {
        Check(Cfg.BodyAccel.Length == 6 && Cfg.BodyTopSpeed.Length == 6, "BodyAccel/TopSpeed have 6 entries");
        Check(Cfg.BodyReverse.Length == 6 && Cfg.BodyGrip.Length == 6, "BodyReverse/Grip have 6 entries");
        Check(Cfg.BodyHandbrakeGrip.Length == 6 && Cfg.BodyMass.Length == 6, "BodyHandbrakeGrip/Mass have 6 entries");
        Check(Cfg.BodyCruiseMult.Length == 6 && Cfg.BodyRadius.Length == 6, "BodyCruiseMult/Radius have 6 entries");
        Check(Cfg.BodyBrake.Length == 6, "BodyBrake has 6 entries (extended with truck/sports)");
        // truck: slowest off the line, slowest top, heaviest, widest
        Check(Cfg.BodyAccel[Cfg.BodyTruck] == 180f, "truck: lowest accel (180)");
        Check(Cfg.BodyTopSpeed[Cfg.BodyTruck] == 235f, "truck: lowest top speed (235)");
        Check(Cfg.BodyMass[Cfg.BodyTruck] == 2.2f, "truck: heaviest (2.2)");
        Check(Cfg.BodyRadius[Cfg.BodyTruck] == 34f, "truck: widest (34)");
        // sports: fastest off the line, fastest top, lightest after the bike
        Check(Cfg.BodyAccel[Cfg.BodySports] == 330f, "sports: fastest car accel (330)");
        Check(Cfg.BodyTopSpeed[Cfg.BodySports] == 420f, "sports: fastest top speed (420)");
        Check(Cfg.BodyMass[Cfg.BodySports] == 0.7f, "sports: light (0.7)");
        // originals untouched at their indices
        Check(Cfg.BodyAccel[Cfg.BodySedan] == 250f && Cfg.BodyAccel[Cfg.BodyHatch] == 300f
            && Cfg.BodyAccel[Cfg.BodyVan] == 200f && Cfg.BodyAccel[Cfg.BodyBike] == 380f,
            "original four bodies keep their accel values");
    }

    /* ---- 3: mesh silhouette agrees with the physics for every seed ---- */

    static void Mesh_Physics_AgreePerSeed()
    {
        // the three ORIGINAL profiles, by roof height and rear z
        //   sedan roof 13.2 zR -20 | hatch roof 12.9 zR -17 | van roof 14.4 zR -19
        // the two NEW ones: sports roof 10.6 zR -18 | truck roof 16.5 zR -26
        int[] expectRoof = { 13, 12, 14, 0, 10, 16 };   // per body; 0 = bike (no roof)
        int[] expectZR =   { -20, -17, -19, 0, -18, -26 };
        for (int body = 0; body < 6; body++)
        {
            CarEnt seedFor = FirstSeedWithBody(body);
            var v = MeshKit.BuildCar(Color.red, false, seedFor.Seed);
            Check(v != null, "BuildCar returns for body " + body);
            if (body == Cfg.BodyBike)
            {
                Check(v.Wheels.Length == 2, "bike mesh: 2 wheels");
                continue;
            }
            Check(v.Wheels.Length == 4, "body " + body + " mesh: 4 wheels (car assembly)");
        }
        Check(BikeVsCarDiffer(), "bike silhouette differs from a sedan's");
        Check(SilhouetteDistinct(Cfg.BodySedan, Cfg.BodySports), "sports silhouette ≠ sedan");
        Check(SilhouetteDistinct(Cfg.BodySedan, Cfg.BodyTruck), "truck silhouette ≠ sedan");
        Check(SilhouetteDistinct(Cfg.BodySports, Cfg.BodyTruck), "sports silhouette ≠ truck");
    }

    static CarEnt FirstSeedWithBody(int body)
    {
        for (int seed = 0; seed < 16; seed++)
            if (new CarEnt { Seed = seed }.BodyType == body) return new CarEnt { Seed = seed };
        throw new System.Exception("VehicleWreckSimTest: no seed maps to body " + body);
    }

    // true when two bodies' car silhouettes differ in roof height or length
    static bool SilhouetteDistinct(int a, int b)
    {
        float[] r = { Roof(a), Roof(b) };
        float[] z = { ZR(a), ZR(b) };
        return Mathf.Abs(r[0] - r[1]) > 0.5f || Mathf.Abs(z[0] - z[1]) > 0.5f;
    }

    // read the silhouette off the generated body mesh: max y = roof,
    // min z = tail (car profile is front→back along z)
    static float Roof(int body)
    {
        var v = MeshKit.BuildCar(Color.red, false, FirstSeedWithBody(body).Seed);
        var m = v.Body.GetComponent<MeshFilter>().sharedMesh;
        float maxY = float.NegativeInfinity;
        foreach (var p in m.vertices) maxY = Mathf.Max(maxY, p.y);
        return Mathf.RoundToInt(maxY);
    }

    static float ZR(int body)
    {
        var v = MeshKit.BuildCar(Color.red, false, FirstSeedWithBody(body).Seed);
        var m = v.Body.GetComponent<MeshFilter>().sharedMesh;
        float minZ = float.PositiveInfinity;
        foreach (var p in m.vertices) minZ = Mathf.Min(minZ, p.z);
        return Mathf.RoundToInt(minZ);
    }

    static bool BikeVsCarDiffer()
    {
        var bike = MeshKit.BuildCar(Color.red, false, 4);
        var sed = MeshKit.BuildCar(Color.red, false, 0);
        return bike.Body.GetComponent<MeshFilter>().sharedMesh.vertexCount
            != sed.Body.GetComponent<MeshFilter>().sharedMesh.vertexCount
            || bike.Wheels.Length != sed.Wheels.Length;
    }

    /* ---- 4: wreckage lifecycle — smoke near, quiet far, ages out ---- */

    static void Wreck_Lifecycle()
    {
        var d = new GameData();
        var s = d.State;
        s.Time = 100.0;
        // a fresh traffic wreck close to the player, one far away, and the
        // player's own wreck (must never be removed from the list)
        var near = MakeWrecked(d, 20f, 0f);
        var far = MakeWrecked(d, 5000f, 0f);
        var playerCar = Systems.MakeCar(6000f, 6000f, 0, false);
        playerCar.IsPlayer = true;
        playerCar.Wrecked = true;
        playerCar.WreckedAt = s.Time;
        d.Cars.Add(playerCar);
        d.Player.X = 0f; d.Player.Y = 0f;

        int before = d.Particles.Count;
        // hammer the sim for 20 seconds of game time
        for (int i = 0; i < 200; i++)
        {
            s.Time += 0.1;
            Systems.WreckStep(d, 0.1f);
        }
        int smokes = d.Particles.Count - before;
        Check(smokes > 0, "wrecks smoke while the player is near (got " + smokes + " particles)");

        // far wreck: reset and run with the player parked at the origin —
        // every wreck must be outside WreckSmokeRadius, so nothing is emitted
        var d2 = new GameData();
        d2.State.Time = 100.0;
        d2.Player.X = 0f; d2.Player.Y = 0f;
        d2.Cars.Add(MakeWrecked(d2, 5000f, 0f));
        int before2 = d2.Particles.Count;
        for (int i = 0; i < 200; i++)
        {
            d2.State.Time += 0.1;
            Systems.WreckStep(d2, 0.1f);
        }
        Check(d2.Particles.Count == before2, "wrecks beyond WreckSmokeRadius stay quiet");

        // ageing: nothing at 44s, the near one is gone by 46s, the player's
        // own wreck stays put regardless
        s.Time = 100.0;
        near.WreckedAt = s.Time;
        for (int i = 0; i < 440; i++) { s.Time += 0.1; Systems.WreckStep(d, 0.1f); }
        Check(d.Cars.Contains(near), "wreck still present at 44s (WreckLinger=45)");
        for (int i = 0; i < 20; i++) { s.Time += 0.1; Systems.WreckStep(d, 0.1f); }
        Check(!d.Cars.Contains(near), "wreck removed at ~46s");
        Check(!d.Cars.Contains(far), "far wreck also ages out (linger is time, not distance)");
        Check(d.Cars.Contains(playerCar), "player's own wreck is never removed by WreckStep");
    }

    static CarEnt MakeWrecked(GameData d, float x, float y)
    {
        var c = Systems.MakeCar(x, y, 0, false);
        c.Wrecked = true;
        c.Speed = 0f;
        c.WreckedAt = d.State.Time;
        d.Cars.Add(c);
        return c;
    }

    /* ---- 5: traffic brakes for a wreck in ProbeAhead ---- */

    static void Wreck_ProbeAhead()
    {
        var d = new GameData();
        Vector2 tile = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Road));
        var c = Systems.MakeCar(tile.x, tile.y, 1, false);   // dir 1 = +y
        c.Wrecked = false;
        d.Cars.Add(c);

        // an unwrecked car 56px ahead — the probe must already see this
        var live = Systems.MakeCar(tile.x, tile.y + 56f, 1, false);
        d.Cars.Add(live);
        Check(Systems.ProbeAhead(d, c, 56f), "probe: car ahead is detected");

        // make it wrecked — it must STILL be detected (wrecks are obstacles)
        live.Wrecked = true;
        live.Speed = 0f;
        live.WreckedAt = d.State.Time;
        Check(Systems.ProbeAhead(d, c, 56f), "probe: wrecked car ahead is still detected");

        // with nothing ahead at all, the probe is clear. Advance the clock so the
        // spatial hash rebuilds over the trimmed list (it caches per
        // d.State.Time; the real sim moves Time every frame).
        d.Cars.Remove(live);
        d.Cars.Remove(c);
        d.State.Time += 1.0;
        Check(!Systems.ProbeAhead(d, c, 56f), "probe: clear road stays clear");
    }
}