/* ==========================================================================
   Local Theft Auto — player control, ported 1:1 from marketing/game.js
   (playerStep, tryEnterExit, and the input mapping).
   ========================================================================== */
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;

namespace LocalTheftAuto
{
    public static class PlayerSys
    {
        // Reusable scratch buffer for spatial-grid queries (LTA.Spatial.cs).
        // The ped-hit and car-push loops below run sequentially and each
        // consumes its results before the next QueryFresh, so one is enough.
        static readonly List<int> scratch = new List<int>();

        /* ------------------------------------------------------- input */

        // Three devices feed one set of axis/action reads: keyboard (as
        // before), gamepad (the stock "Horizontal"/"Vertical" joystick axes
        // plus face buttons — all present in Unity's default
        // InputManager.asset, so no config changes were needed), and touch
        // (the TouchInput layer at the bottom of this file). Priority per
        // read: keyboard, then pad, then touch.
        const float PadDead = 0.22f;       // idle sticks must not drift the sim
        static float lastKbAxisTime = -10f;

        // The stock Horizontal/Vertical axes BLEND the WASD/arrow buttons
        // with the joystick stick, so GetAxis keeps reporting the keyboard's
        // ~0.3s decay tail after a key release. Consult the stick only once
        // the keyboard has been idle briefly, or keyboard steering would
        // feel sticky on release.
        static float PadAxis(string axis)
        {
            if (Time.unscaledTime - lastKbAxisTime < 0.4f) return 0f;
            float v = Input.GetAxis(axis);
            return Mathf.Abs(v) < PadDead ? 0f : v;
        }

        static float AxisX()
        {
            float x = 0f;
            if (Input.GetKey(KeyCode.A) || Input.GetKey(KeyCode.LeftArrow)) x -= 1f;
            if (Input.GetKey(KeyCode.D) || Input.GetKey(KeyCode.RightArrow)) x += 1f;
            if (x != 0f) lastKbAxisTime = Time.unscaledTime;
            else x = PadAxis("Horizontal");
            if (x == 0f) x = TouchInput.AxisX;
            return x;
        }

        // JS y axis points down: W/up = -1
        static float AxisY()
        {
            float y = 0f;
            if (Input.GetKey(KeyCode.W) || Input.GetKey(KeyCode.UpArrow)) y -= 1f;
            if (Input.GetKey(KeyCode.S) || Input.GetKey(KeyCode.DownArrow)) y += 1f;
            if (y != 0f) lastKbAxisTime = Time.unscaledTime;
            else y = -PadAxis("Vertical");   // stick up = forward = JS -1
            if (y == 0f) y = TouchInput.AxisY;
            return y;
        }

        static bool Handbrake()
        {
            return Input.GetKey(KeyCode.Space)
                || Input.GetKey(KeyCode.JoystickButton0)    // A / cross
                || TouchInput.Handbrake;
        }

        // One-shot unpause guard (plan §2.2i): the pointer-down that hit
        // RESUME on the pause menu would otherwise also register as a fire
        // input on the first simulated frame — the click frame flips Paused
        // false and Step runs in the same Update. Hud.SetPaused sets this
        // when the menu closes; Step consumes it exactly once.
        public static bool SwallowFireFrame;

        // uGUI clicks must never pull the trigger: a click that lands on any
        // menu element is not a shot. Belt-and-braces alongside
        // SwallowFireFrame — correct regardless of pause state, and stops
        // shooting through any future UI.
        static bool PointerOverUi()
        {
            return EventSystem.current != null && EventSystem.current.IsPointerOverGameObject();
        }

        static bool FirePressed()
        {
            if (PointerOverUi()) return false;
            return Input.GetKeyDown(KeyCode.F) || Input.GetMouseButtonDown(0)
                || Input.GetKeyDown(KeyCode.JoystickButton5)    // right bumper
                || TouchInput.FireDown;
        }

        // the SMG is full-auto: holding the trigger keeps firing (the
        // per-weapon cooldown in Systems.FireWeapon sets the rate)
        static bool FireHeld()
        {
            if (PointerOverUi()) return false;
            return Input.GetKey(KeyCode.F) || Input.GetMouseButton(0)
                || Input.GetKey(KeyCode.JoystickButton5)
                || TouchInput.FireHeld;
        }

        // enter/exit binding: E on keyboard, X/square on gamepad, the HUD
        // button on touch (queued by its click, consumed here). GameLoop
        // calls this instead of polling KeyCode.E directly.
        public static bool EnterExitPressed()
        {
            bool queued = TouchInput.EnterExitQueued;
            TouchInput.EnterExitQueued = false;
            return Input.GetKeyDown(KeyCode.E)
                || Input.GetKeyDown(KeyCode.JoystickButton2)
                || queued;
        }

        /* -------------------------------------------------- enter/exit */

        public static void TryEnterExit(GameData d)
        {
            var s = d.State;
            var p = d.Player;
            if (s.Busted > 0f || s.Wasted > 0f) return;   // no borrowing cars mid-arrest or mid-respawn

            if (p.InCar != null)
            {
                if (p.InCar.Wrecked) s.Say("Walking away from that one.");
                CarEnt car = p.InCar;
                car.IsPlayer = false; car.Parked = true;
                car.Speed = 0f; car.Vx = 0f; car.Vy = 0f;
                float[,] offs = { { 28f, 0f }, { -28f, 0f }, { 0f, 28f }, { 0f, -28f } };
                for (int i = 0; i < 4; i++)
                {
                    float ox = car.X + offs[i, 0], oy = car.Y + offs[i, 1];
                    if (!CityMap.CircleHitsBuilding(ox, oy, 10f)) { p.X = ox; p.Y = oy; break; }
                }
                p.InCar = null;
                return;
            }

            CarEnt best = null; float bestD = 52f * 52f;
            for (int j = 0; j < d.Cars.Count; j++)
            {
                CarEnt c = d.Cars[j];
                if (c.IsPlayer) continue;
                float dx = c.X - p.X, dy = c.Y - p.Y;
                float dist = dx * dx + dy * dy;
                if (dist < bestD) { bestD = dist; best = c; }
            }
            if (best == null) return;

            best.IsPlayer = true; best.Parked = false;
            p.InCar = best;
            p.Health = best.Health;

            // F19: every car you get behind the wheel of counts as a steal
            // for the lifetime stat + First Steal achievement (JS
            // stats.steals++ / unlockAch("firstSteal") in tryEnterExit).
            StatsSys.Steals();
            StatsSys.Unlock("firstSteal");

            // T5: car theft goes through the witness system — the old
            // inline 130px loop raised stars instantly; now a witnessed
            // theft starts the report window (killable witness) and an
            // unwitnessed one raises nothing.
            bool reported = Systems.RaiseCrimeWitnessed(d, s.Time);
            if (reported)
            {
                s.Say("Someone saw that — locally. The police will hear about it.");
            }
            else
            {
                s.Say(best.Speed > 40f
                    ? "Acquired. The owner will notice, locally."
                    : "Borrowed. Keep it shiny.");
            }
        }

        /* -------------------------------------------------------- step */

        // camHeadRad: camera z-rotation in radians. The camera rotates to keep
        // the travel direction up the screen, so on-foot input must be
        // screen-relative (W = walk toward the top of the screen), not
        // world-relative. In-car controls are already car-relative.
        public static void Step(GameData d, float dt, float camHeadRad)
        {
            TouchInput.Poll();
            // consume the unpause guard exactly once (see SwallowFireFrame)
            bool swallowFire = SwallowFireFrame;
            SwallowFireFrame = false;
            var s = d.State;
            var p = d.Player;

            if (p.InCar != null)
            {
                CarEnt car = p.InCar;
                float ix = AxisX(), iy = AxisY();
                float throttle = -iy;
                bool hand = Handbrake();

                // Realism pass (Phase 3): per-body-type driving stats. Body
                // type derives from the same seed as the mesh silhouette, so
                // a van-shaped car accelerates like a van. Surface grip is
                // terrain-aware (grass is loose) stacked on the existing
                // weather factor.
                int body = car.BodyType;
                // Realism pass (Phase 7): a spike strip forces a temporary
                // handling/speed penalty (never damage) that decays over
                // SpikePenaltyDuration — see Systems.SpikeStep.
                float spikeT = p.SpikePenalty;
                float spikeSpeedMul = Mathf.Lerp(1f, Cfg.SpikeSpeedPenalty, spikeT);
                float spikeGripMul = Mathf.Lerp(1f, Cfg.SpikeGripPenalty, spikeT);
                // Tun* overrides (GameState) — neutral at their 1f defaults, so
                // the three headless harnesses that construct GameData directly
                // read bit-identical physics. TunGrip scales gripBase and
                // gripHand together, which leaves the gripEff/gripBase ratio —
                // and therefore the loose-grip skid threshold below — unchanged.
                float accel = Cfg.BodyAccel[body] * spikeSpeedMul * s.TunAccel;
                float topSpeed = Cfg.BodyTopSpeed[body] * spikeSpeedMul * s.TunTopSpeed;
                float reverseSpd = Cfg.BodyReverse[body] * spikeSpeedMul * s.TunTopSpeed;
                float brakeForce = Cfg.BodyBrake[body] * s.TunAccel;
                float gripBase = Cfg.BodyGrip[body] * spikeGripMul * s.TunGrip;
                float gripHand = Cfg.BodyHandbrakeGrip[body] * spikeGripMul * s.TunGrip;
                float surfaceGrip = CityMap.TypeAtPx(car.X, car.Y) == Cfg.Park ? Cfg.GrassGrip : 1f;
                float gripEff = gripBase * s.WeatherGrip * surfaceGrip;

                if (!car.Wrecked)
                {
                    if (throttle > 0f)
                    {
                        // Realism pass (Phase 14): engines lose pull as they
                        // near their top speed rather than shoving flat-out
                        // acceleration right up to the limiter — a real power
                        // band, so 0-60 stays punchy but closing the last bit
                        // of top speed takes noticeably longer.
                        float band = Mathf.Lerp(1f, Cfg.PowerBandFloor, Mathf.Clamp01(car.Speed / topSpeed));
                        car.Speed = Mathf.Min(topSpeed, car.Speed + accel * band * dt);
                    }
                    else if (throttle < 0f)
                    {
                        // Realism pass (Phase 14): braking is a foot on the
                        // pedal, not the engine running backwards — it sheds
                        // forward speed far faster than the engine built it.
                        // Only once the car is actually stopped does holding
                        // the key start walking it into reverse, at the
                        // gentler reverse-accel rate below.
                        if (car.Speed > 0f) car.Speed = Mathf.Max(0f, car.Speed - brakeForce * dt);
                        else car.Speed = Mathf.Max(reverseSpd, car.Speed - accel * 1.08f * dt);
                    }
                    else car.Speed *= Mathf.Max(0f, 1f - 1.1f * dt);
                    if (hand) car.Speed *= Mathf.Max(0f, 1f - 2.4f * dt);
                }
                else
                {
                    car.Speed *= Mathf.Max(0f, 1f - 4f * dt);
                }

                // Realism pass (Phase 3): steering authority tapers above
                // ~200 units/s so top-speed chases feel heavy, not snap-turny.
                float falloff = 1f / (1f + Mathf.Max(0f, car.Speed - Cfg.SteeringFalloffStart) / Cfg.SteeringFalloffWidth);
                float steer = ix * (hand ? 1.65f : 1f) * 2.4f * dt * falloff;
                steer *= Mathf.Clamp(car.Speed / 130f, -1f, 1f);
                car.A += steer;

                float grip = (hand ? gripHand : gripBase) * s.WeatherGrip * surfaceGrip;
                float fX = Mathf.Cos(car.A), fY = Mathf.Sin(car.A);
                float tvX = fX * car.Speed, tvY = fY * car.Speed;
                car.Vx += (tvX - car.Vx) * Mathf.Min(1f, grip * dt);
                car.Vy += (tvY - car.Vy) * Mathf.Min(1f, grip * dt);

                float nx = car.X + car.Vx * dt;
                float ny = car.Y + car.Vy * dt;
                bool hit = false;
                if (!CityMap.CircleHitsBuilding(nx, car.Y, 14f)) car.X = nx; else hit = true;
                if (!CityMap.CircleHitsBuilding(car.X, ny, 14f)) car.Y = ny; else hit = true;
                if (hit)
                {
                    float impact = Mathf.Sqrt(car.Vx * car.Vx + car.Vy * car.Vy);
                    if (impact > 120f) Systems.DamageCar(d, (impact - 100f) / 9f, car.X + fX * 18f, car.Y + fY * 18f);
                    car.Vx *= -0.3f; car.Vy *= -0.3f; car.Speed *= -0.3f;
                }

                float spd = Mathf.Sqrt(car.Vx * car.Vx + car.Vy * car.Vy);
                float lat = Mathf.Abs(-fY * car.Vx + fX * car.Vy);
                // Realism pass (Phase 3): skid marks (and, in Phase 4, tire
                // screech) fire earlier on loose grip — grass in the rain
                // should squeal at moderate speed, not only in a full drift.
                // gripEff/gripBase == weather * surface.
                float loose = 1f - Mathf.Min(1f, gripEff / gripBase);
                if (lat > 55f - loose * 25f && spd > 90f - loose * 35f)
                {
                    d.Skids.Add(new SkidEnt
                    {
                        X = car.X - fX * 12f, Y = car.Y - fY * 12f,
                        A = car.A, Life = 6f
                    });
                    if (d.Skids.Count > 500) d.Skids.RemoveAt(0);
                    // F19: accumulate drifted px (JS: stats.drifted += spd * dt)
                    // and unlock the Drifter at the JS threshold.
                    if (StatsSys.AddDrifted(Mathf.RoundToInt(spd * dt)) > Cfg.DriftedAchievementPx)
                        StatsSys.Unlock("drifter");
                }
                // Realism pass (Phase 14): sliding tires scrub speed, not
                // just paint skid marks — grip lost sideways is grip lost
                // forward too, so holding a drift now costs momentum instead
                // of carrying speed through the turn for free.
                if (spd > 1f)
                {
                    float slideFrac = Mathf.Clamp01(lat / spd);
                    if (slideFrac > Cfg.SlideSpeedLossStart)
                        car.Speed *= Mathf.Max(0f, 1f - (slideFrac - Cfg.SlideSpeedLossStart) * Cfg.SlideSpeedLossRate * dt);
                }
                if (p.Health < 40f && Random.value < 0.3f) Systems.AddSmoke(d, car.X - fX * 14f, car.Y - fY * 14f);
                if (car.Wrecked && Random.value < 0.5f) Systems.AddSmoke(d, car.X, car.Y);

                p.X = car.X; p.Y = car.Y; p.A = car.A;
                p.Vx = car.Vx; p.Vy = car.Vy;
                car.Brake = throttle < 0f || hand;

                if (spd > 60f)
                {
                    // spatial hash: only peds near the car are candidates;
                    // the exact 22px hit check below is unchanged
                    Spatial.Peds.QueryFresh(d, d.Peds, car.X, car.Y, 22f, scratch);
                    for (int i = 0; i < scratch.Count; i++)
                    {
                        PedEnt ped = d.Peds[scratch[i]];
                        if (ped.Dead) continue;
                        float dx = ped.X - car.X, dy = ped.Y - car.Y;
                        if (dx * dx + dy * dy < 22f * 22f)
                        {
                            if (ped.Kind == PedKind.Gangster)
                            {
                                // gang wars: running one down counts as a
                                // hit on the crew — score, drops, mission
                                // credit and the vendetta all come with it
                                Systems.PlayerKillsGangster(d, ped, car.A);
                            }
                            else
                            {
                                ped.Dead = true; ped.Timer = 6f;
                                // toss the body along the car's travel direction —
                                // readable feedback instead of an instant squash
                                ped.FlingVx = fX * spd * 0.55f; ped.FlingVy = fY * spd * 0.55f;
                                ped.FlingT = 0.35f;
                            }
                            // T5: run-over goes through the witness system.
                            // Living witnesses outrank the victim: the killed
                            // ped panicked?? no — a dead ped can't report, so
                            // RaiseCrimeWitnessed picks a LIVING onlooker. If
                            // nobody living saw it, cold-blooded and free.
                            if (!Systems.RaiseCrimeWitnessed(d, s.Time))
                                s.Say(ped.Kind == PedKind.Gangster
                                    ? "No witnesses. The crew will know anyway."
                                    : "Nobody saw that. Locally, at least.");
                            else
                                s.Say("Someone saw that — the police will hear about it.");
                        }
                    }
                }

                // spatial hash: only cars whose cell overlaps the 30px push
                // radius are candidates; the exact overlap check is unchanged
                Spatial.Cars.QueryFresh(d, d.Cars, car.X, car.Y, 30f, scratch);
                for (int j = 0; j < scratch.Count; j++)
                {
                    CarEnt o = d.Cars[scratch[j]];
                    if (o == car) continue;
                    float ox = o.X - car.X, oy = o.Y - car.Y;
                    float d2 = ox * ox + oy * oy;
                    if (d2 < 30f * 30f && d2 > 0.01f)
                    {
                        float dist = Mathf.Sqrt(d2);
                        // T11: per-body radius — the bike collides over a
                        // genuinely narrower circle than the flat 30px cars use
                        float push = (Cfg.BodyRadius[car.BodyType] - dist) / 2f;
                        o.X += ox / dist * push; o.Y += oy / dist * push;
                        // Realism pass (Phase 3): mass-aware impulse. A van
                        // (mass 1.5) ramming a hatch (0.8) shoves it further
                        // and shrugs off more of the impact itself; the
                        // hatch barely budges the van. rel > 1 means "we are
                        // heavier than them".
                        float mP = Cfg.BodyMass[car.BodyType];
                        float mO = Cfg.BodyMass[o.BodyType];
                        float rel = 2f * mP / (mP + mO);
                        // impulse knockback: the struck car keeps some of the
                        // impact velocity along the hit direction instead of
                        // just being shoved apart by the overlap fix-up above
                        if (spd > 90f)
                        {
                            float kick = Mathf.Min(160f, spd * 0.5f) * rel;
                            o.Vx += ox / dist * kick; o.Vy += oy / dist * kick;
                            o.Speed = Mathf.Sqrt(o.Vx * o.Vx + o.Vy * o.Vy);
                            o.X += o.Vx * dt * 0.5f; o.Y += o.Vy * dt * 0.5f;
                        }
                        if (!o.Parked && spd * rel > 130f && !o.Wrecked)
                        {
                            o.Wrecked = true; o.Speed = 0f;
                            o.WreckedAt = d.State.Time;   // Slice 3: wreckage linger clock
                            Systems.RegisterWreck(d);
                            // F19: smashing a moving car pays out a style bonus.
                            // (The JS car pass awards 150 for a cop roadblock
                            // specifically; a plain traffic wreck carries no
                            // awardStyle in the original — see the report. This
                            // slice awards the traffic wreck at the same 150
                            // value so the combo has a visible on-road trigger.)
                            StatsSys.Award(150, "WRECKED", o.X, o.Y);
                        }
                        // the player's own damage scales with how heavy the
                        // thing they hit is, relative to them.
                        if (spd > 130f) Systems.DamageCar(d, (spd - 110f) / 14f * (2f * mO / (mP + mO)), car.X + ox / dist * 16f, car.Y + oy / dist * 16f);
                        car.Vx *= 0.6f; car.Vy *= 0.6f; car.Speed *= 0.7f;
                    }
                }
            }
            else
            {
                // gang wars: Q cycles the guns the player owns (on-foot only,
                // same as firing itself)
                if (Input.GetKeyDown(KeyCode.Q) || Input.GetKeyDown(KeyCode.JoystickButton3)) Systems.CycleWeapon(p);

                // T6 vehicle radio: [ / ] tap through the stations (and the
                // gamepad's Back/Start… no — those pause. Radio on the stick's
                // click and Y would collide with weapon cycling, so the radio
                // stays keyboard-only for now). Works on foot or in the car —
                // but GameAudio.Step only makes it audible in a car.
                if (Input.GetKeyDown(KeyCode.LeftBracket)) GameAudio.CycleRadio(d, -1);
                if (Input.GetKeyDown(KeyCode.RightBracket)) GameAudio.CycleRadio(d, 1);

                if (p.Weapon != WeaponKind.None && !swallowFire)
                {
                    bool auto = Cfg.WeaponAuto[(int)p.Weapon - 1];
                    if (auto ? FireHeld() : FirePressed()) Systems.FireWeapon(d, s.Time);
                }

                float ix = AxisX(), iy = AxisY();
                // rotate the input from screen space into world (JS) space so
                // W is always "up the screen" under the rotating chase camera
                float cosH = Mathf.Cos(camHeadRad), sinH = Mathf.Sin(camHeadRad);
                float dx = ix * cosH + iy * sinH;
                float dy = -ix * sinH + iy * cosH;
                float len = Mathf.Sqrt(dx * dx + dy * dy);
                if (len < 0.0001f) len = 1f;
                float sp = 150f;
                p.Vx = dx / len * sp;
                p.Vy = dy / len * sp;
                float mx = p.Vx * dt, my = p.Vy * dt;
                if (ix != 0f || iy != 0f) p.A = Mathf.Atan2(dy, dx);
                if (!CityMap.CircleHitsBuilding(p.X + mx, p.Y, 10f)) p.X += mx;
                if (!CityMap.CircleHitsBuilding(p.X, p.Y + my, 10f)) p.Y += my;
                if (ix == 0f && iy == 0f) { p.Vx = 0f; p.Vy = 0f; }
            }
        }
    }

    /* ------------------------------------------------------------ touch */

    // Minimal touch layer for mobile builds, gated on Input.touchSupported
    // so desktop play never reads any of it: drag anywhere on the LEFT half
    // of the screen = virtual stick (anchored where the finger landed),
    // hold anywhere on the RIGHT half = fire. Handbrake and enter/exit are
    // real uGUI buttons built by the HUD (LTA.Hud.cs). Touches that land on
    // uGUI elements are ignored so the buttons don't double as fire.
    public static class TouchInput
    {
        public static float AxisX, AxisY;     // -1..1, JS convention (up = -1)
        public static bool FireHeld;
        public static bool FireDown;          // began this poll
        public static bool Handbrake;         // HUD hold button
        public static bool EnterExitQueued;   // HUD click; consumed by EnterExitPressed

        const float StickRadius = 90f;
        static int stickFinger = -1;
        static Vector2 stickOrigin;

        // called once per simulated frame from PlayerSys.Step
        public static void Poll()
        {
            AxisX = 0f; AxisY = 0f; FireDown = false; FireHeld = false;
            if (!Input.touchSupported) return;
            for (int i = 0; i < Input.touchCount; i++)
            {
                Touch t = Input.GetTouch(i);
                bool ended = t.phase == TouchPhase.Ended || t.phase == TouchPhase.Canceled;
                if (EventSystem.current != null && EventSystem.current.IsPointerOverGameObject(t.fingerId))
                {
                    if (ended && t.fingerId == stickFinger) stickFinger = -1;
                    continue;
                }
                if (t.position.x < Screen.width * 0.5f)
                {
                    if (t.phase == TouchPhase.Began && stickFinger == -1)
                    {
                        stickFinger = t.fingerId;
                        stickOrigin = t.position;
                    }
                    if (t.fingerId != stickFinger) continue;
                    if (ended) { stickFinger = -1; continue; }
                    Vector2 dv = t.position - stickOrigin;
                    float m = dv.magnitude;
                    if (m > StickRadius) dv *= StickRadius / m;
                    AxisX = dv.x / StickRadius;
                    AxisY = -dv.y / StickRadius;   // screen up = forward = JS -1
                }
                else if (!ended)
                {
                    if (t.phase == TouchPhase.Began) FireDown = true;
                    FireHeld = true;
                }
            }
        }

        // Called by the pause toggle (Hud.SetPaused): PlayerSys.Step — which
        // polls touches — is skipped while paused, so a pre-pause drag or a
        // queued IN/OUT tap would otherwise survive the menu and fire on the
        // first resumed frame.
        public static void Reset()
        {
            AxisX = 0f; AxisY = 0f;
            FireHeld = false; FireDown = false;
            Handbrake = false;
            EnterExitQueued = false;
            stickFinger = -1;
        }
    }
}
