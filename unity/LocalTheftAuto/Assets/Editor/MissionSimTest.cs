/* Mission sim checks for the three Slice 2 kinds (circuit, ram, escort) —
   the same headless pattern as PoliceSimTest/GangSimTest/TrafficSimTest
   (-executeMethod, plain bool checks, throw on fail).

   Pins the sim contracts the HUD/marker rely on:
     1. Circuit advances CircuitIndex per checkpoint and completes at the
        last one, refreshing MissionX/MissionY as it goes;
     2. Ram completes when the target car is marked wrecked (and not before);
     3. Escort: pickup requires the player on foot within range, the VIP
        follows on the sim clock, delivery completes at the marker, and a
        dead VIP ends the job;
     4. ClearTargets detaches the VIP from d.Peds and nulls every reference;
     5. MissionTarget dispatch: Ram follows the live car, Escort follows
        the VIP before pickup and the destination after, Rampage has none.

   Run with:
     Unity -quit -batchmode -projectPath <project> -executeMethod
     MissionSimTest.Run
*/
using UnityEngine;
using LocalTheftAuto;

public static class MissionSimTest
{
    static int checksPassed;

    static void Check(bool cond, string what)
    {
        if (!cond) throw new System.Exception("MissionSimTest FAIL: " + what);
        checksPassed++;
    }

    public static void Run()
    {
        var d = new GameData();
        var s = d.State;

        Circuit_AdvancesAndCompletes();
        Ram_WaitsForWreck();
        Escort_FullFlow(d);
        Escort_DeadVipEndsJob(d);
        ClearTargets_Detaches(d);
        CheckTargetDispatch(d);

        Debug.Log("MissionSimTest: " + checksPassed + " checks passed");
    }

    static void Circuit_AdvancesAndCompletes()
    {
        var d = new GameData();
        var s = d.State;
        d.Player.X = 0f; d.Player.Y = 0f;

        // build a 3-checkpoint circuit by hand (same shape SpawnCircuit writes)
        s.MissionOn = true;
        s.MissionKind = MissionKind.Circuit;
        s.CircuitCps = new System.Collections.Generic.List<Vector2>
        {
            new Vector2(100f, 100f),
            new Vector2(500f, 500f),
            new Vector2(900f, 900f)
        };
        s.CircuitIndex = 0;
        s.MissionX = 100f; s.MissionY = 100f;
        s.MissionEnds = 999.0;
        s.MissionReward = 500;

        // not at the first checkpoint yet — no progress
        MissionSys.Step(d, 1.0);
        Check(s.MissionOn && s.CircuitIndex == 0, "circuit: stays at cp 0 while away from it");

        // drive onto cp 0 → advances, marker moves to cp 1
        d.Player.X = 100f; d.Player.Y = 100f;
        MissionSys.Step(d, 2.0);
        Check(s.CircuitIndex == 1, "circuit: hitting cp 0 advances the index");
        Check(s.MissionX == 500f && s.MissionY == 500f, "circuit: marker follows to cp 1");

        // skip to cp 1, hit it, then cp 2 → complete
        d.Player.X = 500f; d.Player.Y = 500f;
        MissionSys.Step(d, 3.0);
        Check(s.CircuitIndex == 2, "circuit: hitting cp 1 advances the index");
        d.Player.X = 900f; d.Player.Y = 900f;
        int scoreBefore = s.Score;
        MissionSys.Step(d, 4.0);
        Check(!s.MissionOn, "circuit: last checkpoint ends the mission");
        Check(s.Score == scoreBefore + 500, "circuit: reward is paid on completion");
        Check(s.CircuitCps == null, "circuit: targets cleared on completion path");
    }

    static void Ram_WaitsForWreck()
    {
        var d = new GameData();
        var s = d.State;

        var car = new CarEnt { X = 200f, Y = 200f, IsPlayer = false, Parked = false, Wrecked = false };
        d.Cars.Add(car);

        s.MissionOn = true;
        s.MissionKind = MissionKind.Ram;
        s.RamTarget = car;
        s.MissionX = car.X; s.MissionY = car.Y;
        s.MissionEnds = 999.0;
        s.MissionReward = 300;

        // not wrecked yet — mission stays live
        MissionSys.Step(d, 1.0);
        Check(s.MissionOn, "ram: still live while the target is intact");

        // wreck the car (as the player collision pass does) → complete
        car.Wrecked = true;
        int scoreBefore = s.Score;
        MissionSys.Step(d, 2.0);
        Check(!s.MissionOn, "ram: wrecking the target completes the mission");
        Check(s.Score == scoreBefore + 300, "ram: reward is paid");
        Check(s.RamTarget == null, "ram: target detached after completion");
    }

    static void Escort_FullFlow(GameData d)
    {
        var s = d.State;
        // valid positions from the city generator (same as the other sim
        // tests) — arbitrary coordinates may land inside a building block,
        // where the VIP's building-collision check correctly blocks movement
        Vector2 vipC = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Side));
        Vector2 destC = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Road, Cfg.Side));
        d.Player.X = vipC.x - 60f; d.Player.Y = vipC.y; d.Player.A = 0f;

        var vip = new PedEnt { X = vipC.x, Y = vipC.y, Dead = false };
        d.Peds.Add(vip);

        s.MissionOn = true;
        s.MissionKind = MissionKind.Escort;
        s.Vip = vip;
        s.VipFollowing = false;
        s.MissionX = destC.x; s.MissionY = destC.y;
        s.MissionEnds = 999.0;
        s.MissionReward = 400;

        // 60 away, outside the 40 pickup radius — no pickup
        d.Player.InCar = null;
        MissionSys.VipStep(d, 1.0, 1f);
        Check(!s.VipFollowing, "escort: not picked up from beyond the pickup radius");

        // in a car AT the VIP → still no pickup (driving past doesn't count)
        var car = new CarEnt();
        d.Player.X = vipC.x; d.Player.Y = vipC.y;
        d.Player.InCar = car;
        MissionSys.VipStep(d, 2.0, 1f);
        Check(!s.VipFollowing, "escort: pickup is foot-only");

        // on foot within radius → following starts
        d.Player.InCar = null;
        MissionSys.VipStep(d, 3.0, 1f);
        Check(s.VipFollowing, "escort: on-foot pickup starts the follow");
        Check(vip.Dead == false, "escort: VIP untouched by pickup");

        // follow: stand ~50 ahead on the road and verify the VIP closes the
        // gap over several sim steps (95 u/s for 1s = ~95 units; even with
        // the 34-unit stop band and any blocked axis it must move)
        Vector2 ahead = CityMap.TileCenter(CityMap.RandTileOf(Cfg.Road));
        d.Player.X = ahead.x; d.Player.Y = ahead.y;
        float startDist = Mathf.Sqrt((ahead.x - vip.X) * (ahead.x - vip.X) + (ahead.y - vip.Y) * (ahead.y - vip.Y));
        for (int f = 0; f < 60; f++) MissionSys.VipStep(d, 4.0 + f / 60f, 1f / 60f);
        float endDist = Mathf.Sqrt((ahead.x - vip.X) * (ahead.x - vip.X) + (ahead.y - vip.Y) * (ahead.y - vip.Y));
        Check(endDist < startDist, "escort: VIP walks toward the player while following");

        // walk the VIP to the marker → delivery completes
        vip.X = s.MissionX; vip.Y = s.MissionY;
        int scoreBefore = s.Score;
        MissionSys.Step(d, 6.0);
        Check(!s.MissionOn, "escort: VIP at the marker completes the mission");
        Check(s.Score == scoreBefore + 400, "escort: reward is paid");
    }

    static void Escort_DeadVipEndsJob(GameData d)
    {
        var s = d.State;
        var vip = new PedEnt { X = 10f, Y = 10f, Dead = true };
        d.Peds.Add(vip);

        s.MissionOn = true;
        s.MissionKind = MissionKind.Escort;
        s.Vip = vip;
        s.VipFollowing = false;
        s.MissionX = 300f; s.MissionY = 300f;
        s.MissionEnds = 999.0;
        s.MissionReward = 400;

        MissionSys.Step(d, 1.0);
        Check(!s.MissionOn, "escort: a dead VIP ends the job");
        Check(s.Vip == null, "escort: dead VIP detached from state");
        Check(!d.Peds.Contains(vip), "escort: dead VIP removed from the ped list");
    }

    static void ClearTargets_Detaches(GameData d)
    {
        var s = d.State;
        var vip = new PedEnt { X = 5f, Y = 5f };
        var car = new CarEnt { X = 9f, Y = 9f };
        d.Peds.Add(vip);
        d.Cars.Add(car);

        s.StealTarget = car;
        s.RamTarget = car;
        s.Vip = vip;
        s.VipFollowing = true;
        s.CircuitCps = new System.Collections.Generic.List<Vector2> { new Vector2(1f, 1f) };
        s.CircuitIndex = 2;

        MissionSys.ClearTargets(d, s);

        Check(s.StealTarget == null && s.RamTarget == null, "clear: car targets nulled");
        Check(s.Vip == null && !s.VipFollowing, "clear: VIP detached");
        Check(s.CircuitCps == null && s.CircuitIndex == 0, "clear: circuit state reset");
        Check(!d.Peds.Contains(vip), "clear: VIP removed from the ped list");
        Check(d.Cars.Contains(car), "clear: cars stay in traffic (only the VIP is removed)");
    }

    static void CheckTargetDispatch(GameData d)
    {
        var s = d.State;
        Vector2 target;

        // no mission → no target
        Check(!MissionSys.MissionTarget(d, out target), "target: no mission, no target");

        // rampage → no pointable target
        s.MissionOn = true;
        s.MissionKind = MissionKind.Rampage;
        Check(!MissionSys.MissionTarget(d, out target), "target: rampage has no pointable target");

        // ram → live car position, not the stale marker
        var car = new CarEnt { X = 42f, Y = 84f };
        d.Cars.Add(car);
        s.MissionKind = MissionKind.Ram;
        s.RamTarget = car;
        s.MissionX = 0f; s.MissionY = 0f;   // stale spawn position
        Check(MissionSys.MissionTarget(d, out target), "target: ram has a target");
        Check(target.x == 42f && target.y == 84f, "target: ram follows the live car");

        // escort before pickup → the VIP; after → the destination
        var vip = new PedEnt { X = 7f, Y = 9f };
        d.Peds.Add(vip);
        s.MissionKind = MissionKind.Escort;
        s.Vip = vip;
        s.VipFollowing = false;
        s.MissionX = 500f; s.MissionY = 600f;
        Check(MissionSys.MissionTarget(d, out target), "target: escort has a target");
        Check(target.x == 7f && target.y == 9f, "target: escort points at the VIP pre-pickup");
        s.VipFollowing = true;
        Check(MissionSys.MissionTarget(d, out target), "target: escort still has a target post-pickup");
        Check(target.x == 500f && target.y == 600f, "target: escort points at the destination post-pickup");

        s.MissionOn = false;
    }
}