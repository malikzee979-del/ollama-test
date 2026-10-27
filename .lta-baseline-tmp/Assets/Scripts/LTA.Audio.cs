/* ==========================================================================
   Local Theft Auto — audio: real recorded clips + 2D UI one-shots.
   Clips are real recordings loaded from Assets/Resources/Audio (see
   CREDITS.md next to them). The Bake* helpers further down synthesize
   every clip in code and remain as the fallback for any missing file,
   keeping the game self-sufficient. This file owns:
     - the clip loader (Load) + a positional one-shot helper, and
     - the 2D "you" one-shots: pickups, getting busted, the rain bed.
   Crashes and the player's own gunfire are played positionally at the
   player's car via PlayPositional (they ARE the camera). Per-car engines,
   per-cop sirens, footsteps, tire screech and the ambient city bed live in
   LTA.Audio3D.cs. GameLoop calls Step() once per frame; events are
   detected by watching the game state (score jump = pickup, shake jump =
   crash), so the simulation code stays comparable with marketing/game.js.
   ========================================================================== */
using UnityEngine;

namespace LocalTheftAuto
{
    public static class GameAudio
    {
        const int Rate = 22050;

        static AudioSource fx, rain;
        static AudioClip pickupClip, crashClip, bustClip, wastedClip, pistolClip, shotgunClip, rainClip;

        static int lastScore;
        static float lastShake;
        static bool wasBusted;
        static bool wasWasted;
        static int lastAmmo;
        static Weather lastWeather;

        public static void Init(GameData d)
        {
            if (fx != null) return;   // survives soft re-init; rebuilt after domain reload

            var go = new GameObject("audio");

            fx = go.AddComponent<AudioSource>();
            rain = go.AddComponent<AudioSource>();

            if (pickupClip == null)
            {
                // Real recordings first (Assets/Resources/Audio, see
                // CREDITS.md next to them); the synthesized bakes below are
                // the fallback so the game still sounds complete if a clip
                // is missing.
                pickupClip = Load("pickup", BakePickup);
                crashClip = Load("crash", BakeCrash);
                bustClip = Load("busted", BakeBust);
                wastedClip = Load("wasted", BakeWasted);
                pistolClip = Load("gun-pistol", BakeGunshot);
                shotgunClip = Load("gun-shotgun", BakeGunshot);
                rainClip = Load("rain", BakeRain);
            }

            rain.clip = rainClip; rain.loop = true; rain.volume = 0f; rain.Play();

            lastScore = d.State.Score;
            lastShake = d.State.Shake;
            wasBusted = d.State.Busted > 0f;
            wasWasted = d.State.Wasted > 0f;
            lastAmmo = d.Player.Ammo;
            lastWeather = d.State.Weather;
        }

        // Restart support (GameLoop.RestartRun): Init() early-returns while
        // fx is alive, but the restart's root sweep destroys the "audio"
        // GameObject at end of frame — AFTER InitGame has already skipped
        // the rebuild. Dropping the references here (the sweep destroys the
        // old object) lets the next Init build a fresh 2D layer instead of
        // silently losing every one-shot sound. Cached clips are assets, not
        // scene objects — they stay.
        public static void Reset()
        {
            fx = null;
            rain = null;
        }

        public static void Step(GameData d, float dt)
        {
            if (fx == null) return;
            var s = d.State;
            var p = d.Player;

            // rain ambience fades in/out with the weather state
            float rTarget = s.Weather == Weather.Rain ? 0.18f : 0f;
            rain.volume = Mathf.MoveTowards(rain.volume, rTarget, 0.5f * dt);

            // event one-shots, detected from state changes. Crashes and the
            // player's own gunfire are played AT the player (they ARE the
            // camera — the car/ped they're aimed at is right there), so a
            // positional PlayClipAtPoint reads correctly; pickup and bust
            // stay 2D UI feedback.
            if (s.Score > lastScore) fx.PlayOneShot(pickupClip, 0.55f);
            lastScore = s.Score;

            if (s.Shake > lastShake + 1.5f)
                AudioSource.PlayClipAtPoint(crashClip, MeshKit.V3(p.X, p.Y, 0f),
                    Mathf.Clamp01(0.25f + s.Shake / 14f * 0.5f));
            lastShake = s.Shake;

            if (p.Ammo < lastAmmo)
            {
                // per-weapon fire sound: the shotgun's boom is its own
                // recording; pistol and SMG share the pistol crack (the SMG
                // plays slightly brighter/faster). Crashes and the player's
                // own gunfire play AT the player — they ARE the camera.
                AudioClip clip;
                float pitch;
                if (p.Weapon == WeaponKind.Shotgun) { clip = shotgunClip; pitch = 1f; }
                else if (p.Weapon == WeaponKind.Smg) { clip = pistolClip; pitch = 1.18f; }
                else { clip = pistolClip; pitch = 1f; }
                PlayPositional(clip, MeshKit.V3(p.X, p.Y, 0f), 0.5f, pitch);
            }
            lastAmmo = p.Ammo;

            bool busted = s.Busted > 0f;
            if (busted && !wasBusted) fx.PlayOneShot(bustClip, 0.7f);
            wasBusted = busted;

            // parallel WASTED sting — same edge-detector pattern as the bust
            bool wasted = s.Wasted > 0f;
            if (wasted && !wasWasted) fx.PlayOneShot(wastedClip, 0.75f);
            wasWasted = wasted;
        }

        /* --------------------------------------------------- clip helpers */

        // Real recording from Assets/Resources/Audio, or the synthesized
        // fallback if the clip is missing. `bake` is deferred so a missing
        // file costs nothing but the Resources.Load probe.
        public static AudioClip Load(string name, System.Func<AudioClip> bake)
        {
            var clip = Resources.Load<AudioClip>("Audio/" + name);
            if (clip != null) return clip;
            Debug.LogWarning("[GameAudio] no Audio/" + name + " — using synth fallback");
            return bake();
        }

        // AudioSource.PlayClipAtPoint, plus a pitch argument — used for the
        // per-weapon gunshots (SMG plays the pistol crack brighter).
        static void PlayPositional(AudioClip clip, Vector3 pos, float vol, float pitch = 1f)
        {
            if (clip == null) return;
            var go = new GameObject("one-shot-audio");
            go.transform.position = pos;
            var src = go.AddComponent<AudioSource>();
            src.clip = clip;
            src.volume = vol;
            src.pitch = pitch;
            src.spatialBlend = 1f;
            src.rolloffMode = AudioRolloffMode.Logarithmic;
            src.minDistance = 1f;
            src.maxDistance = 500f;
            src.Play();
            Object.Destroy(go, clip.length / Mathf.Max(0.01f, pitch));
        }

        /* --------------------------------------------------- synthesis */

        public static AudioClip MakeClip(string name, float[] data)
        {
            var clip = AudioClip.Create(name, data.Length, 1, Rate, false);
            clip.SetData(data, 0);
            return clip;
        }

        // 1s seamless loop: two detuned saws plus a little noise. baseFreq
        // varies the engine character per body type — Audio3D bakes a
        // sedan/hatch/van/cop set off this (van: low rumble; hatch: revvier).
        public static AudioClip BakeEngine(float baseFreq = 55f)
        {
            var data = new float[Rate];
            var rng = new System.Random(1234);
            for (int i = 0; i < data.Length; i++)
            {
                float t = i / (float)Rate;
                float saw1 = 2f * (t * baseFreq % 1f) - 1f;
                float saw2 = 2f * (t * baseFreq * 2f % 1f) - 1f;
                float noise = (float)(rng.NextDouble() * 2.0 - 1.0);
                data[i] = 0.45f * saw1 + 0.25f * saw2 + 0.08f * noise;
            }
            return MakeClip("engine", data);
        }

        // 2s seamless wail: sine carrier swept 620..940 Hz by a 0.5 Hz LFO
        public static AudioClip BakeSiren()
        {
            var data = new float[Rate * 2];
            double phase = 0.0;
            for (int i = 0; i < data.Length; i++)
            {
                float t = i / (float)Rate;
                double f = 780.0 + 160.0 * Mathf.Sin(2f * Mathf.PI * 0.5f * t);
                phase += 2.0 * Mathf.PI * f / Rate;
                data[i] = 0.8f * (float)System.Math.Sin(phase);
            }
            return MakeClip("siren", data);
        }

        // quick two-note chime
        static AudioClip BakePickup()
        {
            var data = new float[(int)(Rate * 0.22f)];
            for (int i = 0; i < data.Length; i++)
            {
                float t = i / (float)Rate;
                float f = t < 0.1f ? 880f : 1318f;
                float env = Mathf.Exp(-t * 14f) * (t < 0.1f ? 1f : Mathf.Exp(-(t - 0.1f) * 10f) + 0.6f);
                data[i] = 0.6f * Mathf.Sin(2f * Mathf.PI * f * t) * Mathf.Clamp01(env);
            }
            return MakeClip("pickup", data);
        }

        // filtered noise burst with exponential decay
        static AudioClip BakeCrash()
        {
            var data = new float[(int)(Rate * 0.35f)];
            var rng = new System.Random(99);
            float prev = 0f;
            for (int i = 0; i < data.Length; i++)
            {
                float t = i / (float)Rate;
                float n = (float)(rng.NextDouble() * 2.0 - 1.0);
                prev = prev * 0.6f + n * 0.4f;   // crude low-pass, less hiss
                data[i] = prev * Mathf.Exp(-t * 11f);
            }
            return MakeClip("crash", data);
        }

        // short crack + tail, filtered noise with a fast decay
        public static AudioClip BakeGunshot()
        {
            var data = new float[(int)(Rate * 0.18f)];
            var rng = new System.Random(555);
            float prev = 0f;
            for (int i = 0; i < data.Length; i++)
            {
                float t = i / (float)Rate;
                float n = (float)(rng.NextDouble() * 2.0 - 1.0);
                prev = prev * 0.35f + n * 0.65f;   // brighter/tighter than the crash noise
                float snap = Mathf.Exp(-t * 55f);
                float tail = Mathf.Exp(-t * 9f) * 0.3f;
                data[i] = prev * (snap + tail);
            }
            return MakeClip("gunshot", data);
        }

        // 2s seamless rain loop: broadband filtered noise, gently amplitude
        // modulated so it doesn't read as a static hiss
        static AudioClip BakeRain()
        {
            var data = new float[Rate * 2];
            var rng = new System.Random(2024);
            float prev = 0f;
            for (int i = 0; i < data.Length; i++)
            {
                float t = i / (float)Rate;
                float n = (float)(rng.NextDouble() * 2.0 - 1.0);
                prev = prev * 0.82f + n * 0.18f;   // low-pass toward a soft patter
                float mod = 0.85f + 0.15f * Mathf.Sin(2f * Mathf.PI * 0.3f * t);
                data[i] = prev * 1.6f * mod;
            }
            return MakeClip("rain", data);
        }

        // descending "caught" sting
        static AudioClip BakeBust()
        {
            var data = new float[(int)(Rate * 0.6f)];
            double phase = 0.0;
            for (int i = 0; i < data.Length; i++)
            {
                float t = i / (float)Rate;
                double f = Mathf.Lerp(320f, 140f, t / 0.6f);
                phase += 2.0 * Mathf.PI * f / Rate;
                data[i] = 0.5f * (float)System.Math.Sin(phase) * Mathf.Exp(-t * 3f);
            }
            return MakeClip("bust", data);
        }

        // low "down" sting for the WASTED screen — BakeBust's darker cousin:
        // a sub sweep under a detuned minor-third pair, with a filtered-noise
        // thud on the front like the moment of impact. Synthesized (no
        // recording ships for it); Load() picks up a real "wasted" clip if
        // one ever lands in Resources/Audio.
        static AudioClip BakeWasted()
        {
            var data = new float[(int)(Rate * 0.9f)];
            var rng = new System.Random(13);
            double phaseLo = 0.0, phaseHi = 0.0;
            float prev = 0f;
            for (int i = 0; i < data.Length; i++)
            {
                float t = i / (float)Rate;
                double fLo = Mathf.Lerp(160f, 55f, t / 0.9f);
                double fHi = Mathf.Lerp(239f, 110f, t / 0.9f);   // minor third above, sagging with the sweep
                phaseLo += 2.0 * Mathf.PI * fLo / Rate;
                phaseHi += 2.0 * Mathf.PI * fHi / Rate;
                float env = Mathf.Exp(-t * 2.4f);
                float tone = (0.5f * (float)System.Math.Sin(phaseLo) + 0.28f * (float)System.Math.Sin(phaseHi)) * env;
                float n = (float)(rng.NextDouble() * 2.0 - 1.0);
                prev = prev * 0.5f + n * 0.5f;                   // crude low-pass thud
                data[i] = tone + prev * Mathf.Exp(-t * 16f) * 0.55f;
            }
            return MakeClip("wasted", data);
        }
    }
}
