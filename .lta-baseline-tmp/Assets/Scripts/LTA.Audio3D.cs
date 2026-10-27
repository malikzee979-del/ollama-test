/* ==========================================================================
   Local Theft Auto — positional 3D audio (realism pass, Phase 4).
   Every car gets a real AudioSource so traffic actually sounds like it's
   driving past — with per-body-type engine tones (van rumbles, hatch
   revs) and Doppler shift from Unity's transform tracking, which is free
   once each source is parented to its car. Cops get positional sirens
   plus a V8 idle. One-shots (distant gunfire from firefights, tire
   screech, footsteps) are played at their world position. An ambient city
   bed sits under everything and ducks when rain takes over.

   Cost control: Unity's voice-priority virtualization drops far,
   low-priority sources out of the DSP mix automatically, and Step() also
   gates every source by an audible radius and zeroes volume beyond it.
   GameLoop calls Init() after GameAudio.Init() and Step() each frame.
   ========================================================================== */
using System.Collections.Generic;
using UnityEngine;

namespace LocalTheftAuto
{
    public static class Audio3D
    {
        const int Rate = 22050;
        const float AudibleRadius = 260f;   // px; beyond this a car engine is silent
        const float SirenRadius = 420f;     // sirens carry further
        const float GunshotRadius = 460f;   // firefights are heard from across a street

        // per-body-type engine base frequency, indexed by Cfg.Body*; [3] = cop
        static readonly float[] EngineFreq = { 55f, 64f, 42f, 52f };

        static AudioSource ambient;
        static AudioClip ambientClip;
        static AudioClip[] engineClips = new AudioClip[4];
        static AudioClip sirenClip, gunshotClip, screechClip;
        static AudioClip[] footClips = new AudioClip[2];   // 0 concrete, 1 grass

        static readonly Dictionary<CarVisual, AudioSource> carEngine =
            new Dictionary<CarVisual, AudioSource>();
        static readonly Dictionary<CopEnt, AudioSource> copEngine =
            new Dictionary<CopEnt, AudioSource>();
        static readonly Dictionary<CopEnt, AudioSource> copSiren =
            new Dictionary<CopEnt, AudioSource>();

        static float footPhase;      // walk-cycle accumulator, drives footstep ticks
        static int lastSkidCount;    // grows -> a skid was just laid (tire screech)
        static int lastSparkCount;   // grows -> someone just fired (positional gunshot)
        static float nextSparkGun;   // gate so a volley doesn't stack 30 shots

        public static void Init(GameData d)
        {
            if (ambient != null) return;   // survives soft re-init; rebuilt after domain reload

            // Real recordings (Assets/Resources/Audio — see CREDITS.md there)
            // with the synthesized bakes as fallback if a clip is missing.
            engineClips[0] = GameAudio.Load("engine-sedan", () => GameAudio.BakeEngine(EngineFreq[0]));
            engineClips[1] = GameAudio.Load("engine-hatch", () => GameAudio.BakeEngine(EngineFreq[1]));
            engineClips[2] = GameAudio.Load("engine-van", () => GameAudio.BakeEngine(EngineFreq[2]));
            engineClips[3] = GameAudio.Load("engine-cop", () => GameAudio.BakeEngine(EngineFreq[3]));
            sirenClip = GameAudio.Load("siren", GameAudio.BakeSiren);
            gunshotClip = GameAudio.Load("gun-pistol", GameAudio.BakeGunshot);
            footClips[0] = GameAudio.Load("step-concrete", () => BakeFootstep(false));
            footClips[1] = GameAudio.Load("step-grass", () => BakeFootstep(true));
            screechClip = GameAudio.Load("skid", BakeScreech);

            ambientClip = GameAudio.Load("ambience", BakeAmbient);
            var go = new GameObject("ambient");
            ambient = go.AddComponent<AudioSource>();
            ambient.clip = ambientClip;
            ambient.loop = true;
            ambient.volume = 0f;
            ambient.spatialBlend = 0f;
            ambient.Play();

            lastSkidCount = d.Skids.Count;
            lastSparkCount = d.Particles.Count;
        }

        public static void Step(GameData d, float dt)
        {
            if (ambient == null) return;
            var p = d.Player;
            float px = p.X, py = p.Y;

            // ---- per-car engines (player's own is the "hero" engine) ----
            for (int i = 0; i < d.Cars.Count; i++)
            {
                CarEnt c = d.Cars[i];
                if (c.Vis == null) continue;
                float dx = c.X - px, dy = c.Y - py;
                float dist = Mathf.Sqrt(dx * dx + dy * dy);
                float spdN = c.Wrecked ? 0f : Mathf.Clamp01(Mathf.Abs(c.Speed) / 280f);

                float vol = 0f;
                if (c.IsPlayer && !c.Wrecked)
                {
                    vol = 0.14f + 0.14f * spdN;   // the camera is in this car
                }
                else if (dist < AudibleRadius && spdN > 0.02f)
                {
                    float a = 1f - Mathf.Clamp01(dist / AudibleRadius);
                    vol = (0.05f + 0.10f * spdN) * a * a;
                }
                SetSrc(CarSrc(c.Vis, c.BodyType), vol, 0.6f + 0.9f * spdN);
            }

            // ---- cops: engine + positional siren ----
            for (int i = 0; i < d.Cops.Count; i++)
            {
                CopEnt cp = d.Cops[i];
                if (cp.Vis == null) continue;
                float dx = cp.X - px, dy = cp.Y - py;
                float dist = Mathf.Sqrt(dx * dx + dy * dy);
                float spdN = Mathf.Clamp01(Mathf.Abs(cp.Speed) / 280f);

                float eVol = 0f;
                if (dist < AudibleRadius && spdN > 0.02f)
                {
                    float a = 1f - Mathf.Clamp01(dist / AudibleRadius);
                    eVol = (0.05f + 0.10f * spdN) * a * a;
                }
                SetSrc(CopSrc(copEngine, cp, false), eVol, 0.6f + 0.9f * spdN);

                float sVol = 0f;
                if (dist < SirenRadius)
                {
                    float a = 1f - Mathf.Clamp01(dist / SirenRadius);
                    sVol = 0.15f * a * a;
                }
                SetSrc(CopSrc(copSiren, cp, true), sVol, 1f);
            }

            // prune cop sources whose CopEnt was removed from d.Cops
            if (copEngine.Count > d.Cops.Count || copSiren.Count > d.Cops.Count)
            {
                List<CopEnt> gone = null;
                foreach (var kv in copEngine)
                {
                    bool alive = false;
                    for (int i = 0; i < d.Cops.Count; i++)
                        if (d.Cops[i] == kv.Key) { alive = true; break; }
                    if (!alive) (gone ?? (gone = new List<CopEnt>())).Add(kv.Key);
                }
                if (gone != null)
                {
                    for (int i = 0; i < gone.Count; i++)
                    {
                        DestroySrc(copEngine, gone[i]);
                        DestroySrc(copSiren, gone[i]);
                    }
                }
            }

            // ---- footstep ticks, tied to the on-foot walk and the surface ----
            if (p.InCar == null)
            {
                float spdF = Mathf.Sqrt(p.Vx * p.Vx + p.Vy * p.Vy);
                if (spdF > 10f)
                {
                    footPhase += dt * 2.2f;              // brisk cadence, ~2 steps/s
                    if (footPhase >= 1f)
                    {
                        footPhase -= 1f;
                        int surf = CityMap.TypeAtPx(p.X, p.Y) == Cfg.Park ? 1 : 0;
                        AudioSource.PlayClipAtPoint(footClips[surf], MeshKit.V3(p.X, p.Y, 0f), 0.28f);
                    }
                }
            }

            // ---- tire screech: skids are laid only by the player's car, so a
            //      new skid mark means the player is sliding right now ----
            if (d.Skids.Count > lastSkidCount)
            {
                float sx = p.InCar != null ? p.InCar.X : p.X;
                float sy = p.InCar != null ? p.InCar.Y : p.Y;
                AudioSource.PlayClipAtPoint(screechClip, MeshKit.V3(sx, sy, 0f), 0.5f);
            }
            lastSkidCount = d.Skids.Count;

            // ---- firefight gunfire: any new Spark particle is a muzzle flash
            //      from a gangster or cop (the player's own shots are handled
            //      by GameAudio's ammo detection and produce sparks at the
            //      player's muzzle, <60px away — skipped here). ----
            if (d.Particles.Count > lastSparkCount && sTime(d) >= nextSparkGun)
            {
                for (int i = lastSparkCount; i < d.Particles.Count; i++)
                {
                    ParticleEnt q = d.Particles[i];
                    if (q.Kind != ParticleEnt.Spark) continue;
                    float dx = q.X - px, dy = q.Y - py;
                    float dist = Mathf.Sqrt(dx * dx + dy * dy);
                    if (dist > 60f && dist < GunshotRadius)
                    {
                        float vol = 0.5f * (1f - dist / GunshotRadius) + 0.08f;
                        AudioSource.PlayClipAtPoint(gunshotClip, MeshKit.V3(q.X, q.Y, 0f), vol);
                        nextSparkGun = sTime(d) + 0.13f;   // don't stack a volley
                        break;
                    }
                }
            }
            lastSparkCount = d.Particles.Count;

            // ---- ambient city bed, ducked when rain takes over the mix ----
            float aTarget = d.State.Weather == Weather.Rain ? 0.015f : 0.07f;
            ambient.volume = Mathf.MoveTowards(ambient.volume, aTarget, 0.4f * dt);
        }

        /* ---------------------------------------------------- helpers */

        static float sTime(GameData d) { return (float)d.State.Time; }

        // set volume/pitch, starting/stopping the loop so idle sources
        // (parked cars, far traffic) consume no voice.
        static void SetSrc(AudioSource s, float vol, float pitch)
        {
            if (vol <= 0.001f)
            {
                if (s.isPlaying) s.Stop();
                return;
            }
            if (!s.isPlaying) s.Play();
            s.volume = vol;
            s.pitch = pitch;
        }

        static AudioSource CarSrc(CarVisual v, int bodyType)
        {
            AudioSource s;
            if (carEngine.TryGetValue(v, out s) && s != null) return s;
            s = NewEntitySrc("carEngine", v.Root.transform, true);
            s.priority = 96;
            s.clip = engineClips[Mathf.Clamp(bodyType, 0, 3)];
            carEngine[v] = s;
            return s;
        }

        static AudioSource CopSrc(Dictionary<CopEnt, AudioSource> table, CopEnt cp, bool siren)
        {
            AudioSource s;
            if (table.TryGetValue(cp, out s) && s != null) return s;
            s = NewEntitySrc(siren ? "copSiren" : "copEngine", cp.Vis.Root.transform, true);
            s.priority = siren ? 32 : 96;
            s.clip = siren ? sirenClip : engineClips[3];
            table[cp] = s;
            return s;
        }

        static void DestroySrc(Dictionary<CopEnt, AudioSource> table, CopEnt key)
        {
            AudioSource s;
            if (table.TryGetValue(key, out s))
            {
                if (s != null) Object.Destroy(s.gameObject);
                table.Remove(key);
            }
        }

        // a positional loop source parented to an entity so it follows the
        // car automatically (and Unity computes doppler from its motion).
        static AudioSource NewEntitySrc(string name, Transform parent, bool loop)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var s = go.AddComponent<AudioSource>();
            s.spatialBlend = 1f;
            s.rolloffMode = AudioRolloffMode.Logarithmic;
            s.minDistance = 6f;
            s.maxDistance = 480f;
            s.dopplerLevel = 0.6f;
            s.playOnAwake = false;
            s.loop = loop;
            return s;
        }

        /* --------------------------------------------------- synthesis */

        // deep brown-noise swell with a slow amplitude wobble — the city's
        // constant low hum, deliberately beneath the engine/siren layer
        static AudioClip BakeAmbient()
        {
            var data = new float[Rate * 2];
            var rng = new System.Random(777);
            float prev = 0f;
            for (int i = 0; i < data.Length; i++)
            {
                float t = i / (float)Rate;
                float n = (float)(rng.NextDouble() * 2.0 - 1.0);
                prev = prev * 0.94f + n * 0.06f;
                float mod = 0.8f + 0.2f * Mathf.Sin(2f * Mathf.PI * 0.05f * t);
                data[i] = prev * 1.4f * mod;
            }
            return GameAudio.MakeClip("ambient", data);
        }

        // 80ms transient: concrete = brighter scuff, grass = heavy low-pass
        static AudioClip BakeFootstep(bool grass)
        {
            var data = new float[(int)(Rate * 0.08f)];
            var rng = new System.Random(grass ? 42 : 7);
            float prev = 0f;
            for (int i = 0; i < data.Length; i++)
            {
                float t = i / (float)Rate;
                float n = (float)(rng.NextDouble() * 2.0 - 1.0);
                float cut = grass ? 0.1f : 0.5f;
                prev = prev * (1f - cut) + n * cut;
                data[i] = prev * Mathf.Exp(-t * 60f) * (grass ? 1.4f : 1f);
            }
            return GameAudio.MakeClip(grass ? "step-grass" : "step-concrete", data);
        }

        // ~0.9s band-passed noise that swells then dies — a tire sliding
        static AudioClip BakeScreech()
        {
            var data = new float[(int)(Rate * 0.9f)];
            var rng = new System.Random(314);
            float prev = 0f;
            for (int i = 0; i < data.Length; i++)
            {
                float t = i / (float)Rate;
                float n = (float)(rng.NextDouble() * 2.0 - 1.0);
                prev = prev * 0.45f + n * 0.55f;
                float env = Mathf.Sin(Mathf.Clamp01(t / 0.12f) * Mathf.PI);  // attack
                env *= Mathf.Clamp01((0.9f - t) / 0.6f);                    // decay
                data[i] = prev * 1.6f * env * 0.8f;
            }
            return GameAudio.MakeClip("screech", data);
        }
    }
}
