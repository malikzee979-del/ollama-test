/* ==========================================================================
   Local Theft Auto — bootstrap, main loop, Vice-City-style chase camera and
   3D visual sync. The simulation still runs in the original 2D JS space
   (see LTA.Core.cs); this file maps entity state onto 3D visuals built by
   MeshKit and drives a third-person follow camera: behind the player,
   above the roofline of the car, swinging around with your heading and
   pulling in when a building blocks the view.
   ========================================================================== */
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;

namespace LocalTheftAuto
{
    public static class GameBootstrap
    {
        static bool booted;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot()
        {
            if (booted) return;
            booted = true;
            var go = new GameObject("Local Theft Auto");
            go.AddComponent<GameLoop>();
        }
    }

    public class GameLoop : MonoBehaviour
    {
        GameData data;
        Camera cam;
        Light sun;                   // real directional sun (see UpdateWorldFX)
        CityRenderer city;
        Hud hud;

        PedVisual playerVis;

        // visual ownership for entities that come and go
        readonly List<CopEnt> copOwners = new List<CopEnt>();
        readonly List<ParticleEnt> partOwners = new List<ParticleEnt>();
        readonly List<SkidEnt> skidOwners = new List<SkidEnt>();
        readonly List<SpikeStripEnt> spikeOwners = new List<SpikeStripEnt>();
        readonly HashSet<CopEnt> liveCops = new HashSet<CopEnt>();
        readonly HashSet<ParticleEnt> liveParts = new HashSet<ParticleEnt>();
        readonly HashSet<SkidEnt> liveSkids = new HashSet<SkidEnt>();
        readonly HashSet<SpikeStripEnt> liveSpikes = new HashSet<SpikeStripEnt>();

        // pools — short-lived visuals are recycled instead of Destroy/new
        readonly Stack<GameObject> sparkPool = new Stack<GameObject>();
        readonly Stack<GameObject> puffPool = new Stack<GameObject>();
        readonly Stack<GameObject> skidPool = new Stack<GameObject>();
        readonly Stack<CarVisual> copVisPool = new Stack<CarVisual>();

        class PkgVis { public GameObject Root; public Transform Box; public SpriteRenderer Glow; }
        readonly Dictionary<PackageEnt, PkgVis> packageVis = new Dictionary<PackageEnt, PkgVis>();
        readonly Dictionary<WeaponEnt, GameObject> weaponVis = new Dictionary<WeaponEnt, GameObject>();

        GameObject missionGo;
        GameObject missionBoard;          // T15: street sign beside the marker
        SpriteRenderer missionBoardGlow;
        SpriteRenderer[] missionBeams;
        SpriteRenderer missionGlow;
        static readonly Color MissionBlue = Cfg.Hex("#4fb4ff");
        static readonly Color StealCyan = Cfg.Hex("#5cf0d0");

        // weather + day/night — rain is a small pool of falling streak
        // sprites (not Unity's ParticleSystem component, which needs a
        // package this project doesn't otherwise reference)
        GameObject rainRoot;
        Transform[] rainDrops;
        float[] rainDropH;
        SpriteRenderer[] rainSr;
        const int RainDropCount = Cfg.RainDropCountMax;
        // Realism pass (Phase 8): heavier/variable rain. Rolled once per rain
        // EVENT (see UpdateWorldFX) rather than every frame, so one storm
        // reads as consistently lighter or heavier than the last instead of
        // flickering between densities frame to frame. Scales both how many
        // of the pooled drops are actually active and each streak's
        // opacity/length — a light drizzle isn't just "fewer of the same
        // drop", it's visibly thinner too.
        float rainIntensity = 1f;
        static readonly int LtaDayNightId = Shader.PropertyToID("_LtaDayNight");
        // LTA/Lit globals: hemisphere ambient + the night window-glow ramp
        static readonly int LtaAmbSkyId = Shader.PropertyToID("_LtaAmbSky");
        static readonly int LtaAmbGroundId = Shader.PropertyToID("_LtaAmbGround");
        static readonly int LtaNightEmissionId = Shader.PropertyToID("_LtaNightEmission");
        // Sky and aerial haze. Lifted well off near-black: with real
        // lighting the fog color is what distant geometry fades INTO, so a
        // black fog reads as a void swallowing the skyline instead of
        // atmosphere. Overcast grey-blue by day, deep blue at night.
        static readonly Color DaySky = Cfg.Hex("#47546c");
        static readonly Color NightSky = Cfg.Hex("#111c33");
        static readonly Color DayFog = Cfg.Hex("#4b5568");
        // Night haze, not black. Distant towers fade INTO the fog color, so
        // a near-black night fog swallows the skyline entirely; a lifted
        // blue keeps the far towers reading as silhouettes against it.
        static readonly Color NightFog = Cfg.Hex("#1b2742");

        // save/load (LTA.Core.cs SaveData)
        const string SaveKey = "lta_save_json";

        static readonly Color WreckTint = new Color(0.30f, 0.30f, 0.32f);
        static readonly Color DeadTint = new Color(0.55f, 0.58f, 0.64f);
        static readonly Color SirenRed = Cfg.Hex("#ff5252");
        static readonly Color SirenBlue = Cfg.Hex("#4f8cff");
        static readonly Color TailDim = new Color(0.55f, 0.10f, 0.10f);
        static readonly Color TailBright = new Color(1f, 0.30f, 0.30f);

        // chase camera state
        float camYaw = 90f;          // degrees around Y; 90 = facing +x (east)
        public float CamYaw { get { return camYaw; } }   // read by the HUD mission compass
        float camBoom = 190f;        // smoothed camera boom length (px)
        Vector3 camPos;
        DepthOfField dof;             // null unless Cfg.EnableDoF
        // Kept so HdrSettleRoutine can re-grade the ACES preset once the HDR
        // swapchain has actually come up, a few frames after SetupPostFx runs.
        Tonemapping toneMap;
        // Phase 12: realtime reflection probe, null unless
        // Cfg.EnableReflectionProbe. Follows the player; re-rendered on a
        // timer rather than every frame, with Unity slicing each render
        // across faces so no single frame pays for all six.
        ReflectionProbe reflProbe;
        float reflNextRender;
        // Phase 13: current light-shaft opacity, recomputed once per frame in
        // UpdateWorldFX and applied to every car in SyncCars. Held here rather
        // than recomputed per car because it is the same value for all of them.
        float shaftAlpha = Cfg.ShaftAlphaBase;
        static readonly int LtaReflBlendId = Shader.PropertyToID("_LtaReflBlend");
        string shotPath;             // dev screenshot mode (-lta-shot=/path.png)

        /* ------------------------------------------------------- setup */

        void Awake()
        {
            if (FindObjectsByType<GameLoop>().Length > 1)
            {
                Destroy(gameObject);
                return;
            }
            active = this;
            if (data == null) InitGame();
        }

        static GameLoop active;
        public static GameLoop Active { get { return active; } }

        // re-tints the on-foot player mesh after a start-screen cosmetic
        // pick (LTA.Hud.cs) — cheap, since MeshKit.Tint is just a
        // MaterialPropertyBlock write, no rebuild needed
        public void RetintPlayer()
        {
            if (playerVis == null || data == null) return;
            MeshKit.Tint(playerVis.Body, data.Player.ShirtColor);
            MeshKit.Tint(playerVis.Head, Cfg.Skins[data.Player.SkinIndex]);
        }

        void InitGame()
        {
            ConfigureFramePacing();

            SpriteKit.Init();
            MeshKit.Init();

            data = new GameData();
            data.State.HighScore = PlayerPrefs.GetInt("lta_highscore", 0);
            data.State.Spawn = CityMap.TileCenter(new Vector2Int(41, 40));
            data.Player.X = data.State.Spawn.x;
            data.Player.Y = data.State.Spawn.y;
            Systems.SpawnWorld(data);
            Systems.SpawnGarageCar(data);   // T16: the owned ride waits near start
            LoadGame(data);                 // after load, so the save's garage snapshot rules the spawn

            var camGo = new GameObject("Main Camera");
            camGo.tag = "MainCamera";
            cam = camGo.AddComponent<Camera>();
            // Realism pass (Phase 4): explicit listener on the camera. Unity
            // does NOT auto-add one to runtime-created cameras, and with no
            // listener in the scene every AudioSource ignores spatialization —
            // the positional engine/siren layer would be pointless.
            camGo.AddComponent<AudioListener>();
            // Realism pass: a procedural gradient skybox (LTA.Sky.cs) instead
            // of a flat solid color — cam.backgroundColor is now only a
            // fallback for the brief window before the skybox material is
            // wired up in UpdateWorldFX's first call.
            cam.clearFlags = CameraClearFlags.Skybox;
            cam.backgroundColor = DaySky;
            SkyKit.Apply(DaySky, DaySky, Vector3.up, Color.white, 1f, 1f, Color.clear);
            cam.fieldOfView = 60f;
            cam.nearClipPlane = 5f;
            cam.farClipPlane = 3200f;

            SetupPostFx();

            // A real directional sun. The renderer previously had no lights
            // at all — every surface was flat albedo — so this plus the
            // LTA/Lit shader is what actually gives the city form, contact
            // shadows and time-of-day.
            var sunGo = new GameObject("sun");
            sun = sunGo.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.shadows = LightShadows.Soft;
            sun.shadowStrength = 0.82f;
            sun.shadowBias = 0.03f;
            sun.shadowNormalBias = 0.45f;
            sun.shadowNearPlane = 2f;
            RenderSettings.sun = sun;

            // Phase 12: one realtime reflection probe, parented to nothing and
            // moved to the player every frame by StepReflectionProbe.
            //
            // ViaScripting + IndividualFaces is the whole cost-control story:
            // Unity renders one cube face per invocation instead of six in a
            // single frame, so the spike is amortised. The box is large enough
            // to enclose everything the player can see reflected, because this
            // probe is the only one in the scene and anything outside its
            // bounds falls back to the skybox cube.
            if (Cfg.EnableReflectionProbe)
            {
                var reflGo = new GameObject("refl-probe");
                reflGo.transform.SetParent(transform, false);
                reflProbe = reflGo.AddComponent<ReflectionProbe>();
                reflProbe.mode = ReflectionProbeMode.Realtime;
                reflProbe.refreshMode = ReflectionProbeRefreshMode.ViaScripting;
                reflProbe.timeSlicingMode = ReflectionProbeTimeSlicingMode.IndividualFaces;
                reflProbe.clearFlags = ReflectionProbeClearFlags.Skybox;
                reflProbe.resolution = Cfg.ReflectionProbeResolution;
                reflProbe.hdr = true;
                reflProbe.shadowDistance = 0f;      // probe faces never need shadows
                reflProbe.nearClipPlane = 5f;
                reflProbe.farClipPlane = Cfg.ReflectionProbeFar;
                reflProbe.size = new Vector3(4000f, 2000f, 4000f);
                reflProbe.importance = 1;
                reflProbe.intensity = 1f;
            }
            // 0 until the probe has actually rendered once — before that the
            // cube is blank and blending toward it would flatten every glossy
            // surface to black.
            Shader.SetGlobalFloat(LtaReflBlendId, 0f);

            // Shadow distance/resolution/cascades and the additional-light
            // budget all live on the URP asset now (Assets/Settings/LTA-URP,
            // generated by Editor/SetupURPAssets.cs) — the built-in
            // QualitySettings equivalents are ignored under URP. They are set
            // there to 1100 units with 4 cascades, because this city's blocks
            // are 480 units across and its towers reach 1400, so the stock
            // 15-150 range would never get a tower shadow down to the street.

            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = DayFog;
            RenderSettings.fogStartDistance = 900f;
            RenderSettings.fogEndDistance = 2600f;
            Shader.SetGlobalColor(LtaDayNightId, Color.white);
            // seed the lit-shader globals so frame 0 isn't rendered black
            Shader.SetGlobalColor(LtaAmbSkyId, Cfg.Hex("#8fa8c8"));
            Shader.SetGlobalColor(LtaAmbGroundId, Cfg.Hex("#2a2a26"));
            Shader.SetGlobalFloat(LtaNightEmissionId, 0.5f);

            city = gameObject.AddComponent<CityRenderer>();
            city.Init();

            BuildRain();

            hud = gameObject.AddComponent<Hud>();
            hud.Init(data);

            playerVis = MeshKit.BuildPed(Cfg.Hex("#ffb224"), Cfg.Hex("#e6c9a8"), 0);
            playerVis.Root.name = "player";

            // mission drop-off marker: VC-style translucent blue column
            missionGo = MeshKit.BuildMarker(MissionBlue);
            missionBeams = new SpriteRenderer[2];
            missionBeams[0] = missionGo.transform.Find("beam0").GetComponent<SpriteRenderer>();
            missionBeams[1] = missionGo.transform.Find("beam1").GetComponent<SpriteRenderer>();
            missionGlow = missionGo.transform.Find("glow").GetComponent<SpriteRenderer>();
            missionGo.SetActive(false);

            // T15: signboard beside the marker — built once here, shown/hidden
            // and repositioned with the marker in SyncMission
            missionBoard = MeshKit.BuildMissionBoard(MissionBlue);
            missionBoardGlow = missionBoard.transform.Find("cap-glow").GetComponent<SpriteRenderer>();
            missionBoard.SetActive(false);

            camPos = MeshKit.V3(data.Player.X, data.Player.Y, 0f) + new Vector3(-100f, 70f, 0f);

            GameAudio.Init(data);
            Audio3D.Init(data);
            StartCoroutine(AutoSaveLoop());

            // headless-ish visual verification: -lta-shot=/abs/path.png
            shotPath = null;
            var args = System.Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length; i++)
                if (args[i].StartsWith("-lta-shot="))
                    shotPath = args[i].Substring("-lta-shot=".Length);
            if (!string.IsNullOrEmpty(shotPath))
            {
                // keep simulating without window focus, and never hang the
                // harness: a watchdog quits even if the routine stalls
                Application.runInBackground = true;
                data.State.Started = true;
                StartCoroutine(ShotRoutine());
                Invoke("ForceQuit", 25f);
            }
        }

        void ForceQuit()
        {
            Application.Quit();
        }

        /* ------------------------------------------------- post-processing */

        // The URP post stack, built in code like everything else here rather
        // than as a serialized VolumeProfile asset.
        //
        // Tonemapping is the single biggest item: without it the renderer
        // hands raw linear values to the display, so every lamp head and lit
        // window clips flat to white the moment it passes 1.0. ACES rolls
        // highlights off the way a camera does, which is most of the
        // difference between "rendered" and "filmed". Bloom then lets those
        // highlights bleed, which is what actually sells a night city.
        void SetupPostFx()
        {
            var camData = cam.GetUniversalAdditionalCameraData();
            camData.renderPostProcessing = true;
            camData.renderShadows = true;
            // TAA rather than SMAA, now that LTA-Lit.shader has a MotionVectors
            // pass to feed it. SMAA is a spatial edge filter: it can only fix
            // geometric aliasing. The dominant artifact in this scene is not
            // geometry, it is SHADING — hundreds of small GGX highlights on car
            // paint and wet asphalt, plus everything above the bloom threshold,
            // all crawling and fizzing as the camera swings. Only a temporal
            // filter touches that. MSAA is switched off in LTA-URP.asset in the
            // same change: it also only solves geometric edges, so running both
            // was paying twice for the lesser half of the problem.
            camData.antialiasing = AntialiasingMode.TemporalAntiAliasing;
            camData.antialiasingQuality = AntialiasingQuality.High;

            var go = new GameObject("post-fx");
            go.transform.SetParent(transform, false);
            var volume = go.AddComponent<Volume>();
            volume.isGlobal = true;
            volume.priority = 1f;

            var profile = ScriptableObject.CreateInstance<VolumeProfile>();
            volume.sharedProfile = profile;

            var tone = profile.Add<Tonemapping>(true);
            tone.mode.value = TonemappingMode.ACES;
            ConfigureHdrOutput(tone);

            var bloom = profile.Add<Bloom>(true);
            bloom.threshold.value = 0.75f;   // only lamps/windows/headlights bleed
            bloom.intensity.value = 0.55f;
            bloom.scatter.value = 0.70f;
            bloom.tint.value = new Color(1f, 0.95f, 0.85f);

            // cold, slightly crushed Gotham grade.
            // The exposure lift is doing real work: ACES rolls off highlights
            // but also pulls midtones down hard, and almost every value in a
            // night scene already sits low (0.05-0.2). Without ~1.5 EV back
            // the whole city renders near-black once tonemapping is on.
            var grade = profile.Add<ColorAdjustments>(true);
            grade.postExposure.value = 1.5f;
            grade.contrast.value = 10f;
            grade.saturation.value = -6f;

            var wb = profile.Add<WhiteBalance>(true);
            wb.temperature.value = -14f;        // push blue

            var vig = profile.Add<Vignette>(true);
            vig.intensity.value = 0.30f;
            vig.smoothness.value = 0.55f;

            // Realism pass: push the frame from "rendered" toward "filmed".
            // Camera-mode motion blur only (no per-object motion vectors to
            // spend on) — cheap, and the chase cam already swings/leans, so
            // a light touch is enough; overdo it and it fights the FOV kick.
            var blur = profile.Add<MotionBlur>(true);
            blur.mode.value = MotionBlurMode.CameraOnly;
            blur.quality.value = MotionBlurQuality.Low;
            blur.intensity.value = Cfg.MotionBlurIntensity;

            var ca = profile.Add<ChromaticAberration>(true);
            ca.intensity.value = Cfg.ChromaticAberrationIntensity;

            var grain = profile.Add<FilmGrain>(true);
            grain.type.value = FilmGrainLookup.Thin1;
            grain.intensity.value = Cfg.FilmGrainIntensity;

            // Optional and expensive — see Cfg.EnableDoF. Focus distance is
            // re-driven every frame from StepCamera's boom length so the
            // player's own car stays sharp regardless of the day's chase
            // distance/height tuning.
            if (Cfg.EnableDoF)
            {
                dof = profile.Add<DepthOfField>(true);
                dof.mode.value = DepthOfFieldMode.Gaussian;
                dof.gaussianStart.value = 40f;
                dof.gaussianEnd.value = 220f;
                dof.gaussianMaxRadius.value = 0.8f;
            }
        }

        // Frame pacing on Apple silicon.
        //
        // ProjectSettings now has metalUseMetalDisplayLink enabled, which puts
        // presentation on CAMetalDisplayLink — Metal paces frames against the
        // display's actual refresh instead of Unity's own timer. That is the
        // thing that makes a ProMotion panel's variable refresh behave.
        //
        // The frame-rate policy has to be stated in code because the project's
        // settings contradict each other and neither wins cleanly: the quality
        // tiers carry vSyncCount 0 on Very Low/Low and 1 from Medium up, while
        // nothing ever set Application.targetFrameRate at all. Under URP the
        // tiers' own AA values are ignored anyway, so leaving frame pacing to
        // whichever tier happened to be active was never deliberate.
        //
        // vSyncCount 1 + targetFrameRate -1 hands pacing to the display link
        // and lets it run at whatever the panel is currently doing — 120Hz on
        // the built-in ProMotion display, 100Hz on the external ultrawide —
        // rather than pinning a number that is wrong on one of them.
        static void ConfigureFramePacing()
        {
            QualitySettings.vSyncCount = 1;
            Application.targetFrameRate = -1;
        }

        // HDR (EDR) display output — the Apple-silicon payoff.
        //
        // Unity's only macOS backend is Metal, and URP supports HDR Output on
        // "macOS devices that use Metal" provided the project is in LINEAR
        // color space (it is now — see ProjectSettings m_ActiveColorSpace).
        // On a Liquid Retina XDR panel this is what finally lets a sodium lamp,
        // a headlight and a lit window be genuinely brighter than paper white
        // instead of all three clipping to the same SDR white.
        //
        // Everything here is capability-driven, never hardcoded: on an external
        // SDR monitor, or if the user drags the window to a non-HDR display,
        // HDROutputSettings.main.available goes false and we leave the SDR
        // tonemapping path exactly as it was.
        void ConfigureHdrOutput(Tonemapping tone)
        {
            toneMap = tone;

            // The screenshot harness and HDR output are mutually exclusive.
            // CaptureTo() does Texture2D.ReadPixels into an RGB24 texture; once
            // the swapchain is HDR-encoded that readback returns a flat grey
            // frame (measured: every shot after HDR went live had a uniform
            // mean of 205 with zero clipped and zero dark pixels — a blank
            // image, not a bright one). Since -lta-shot exists purely to
            // produce comparable SDR frames, it wins by default; pass
            // -lta-hdr alongside it to deliberately test the HDR path instead.
            var argv = System.Environment.GetCommandLineArgs();
            bool capturing = false, forceHdr = false;
            for (int i = 0; i < argv.Length; i++)
            {
                if (argv[i].StartsWith("-lta-shot=")) capturing = true;
                if (argv[i] == "-lta-hdr") forceHdr = true;
            }
            if (capturing && !forceHdr)
            {
                Debug.Log("[LTA] -lta-shot set: staying on SDR so ReadPixels returns a real frame.");
                return;
            }

            var hdr = HDROutputSettings.main;
            if (hdr == null || !hdr.available)
            {
                Debug.Log("[LTA] HDR output unavailable — staying on the SDR ACES path.");
                return;
            }

            // Let URP negotiate paper white and the brightness limits with the
            // display rather than guessing. detectBrightnessLimits already
            // defaults true; paper-white detection does not, and without it
            // every unlit surface (the whole HUD) is graded against a fixed
            // 300-nit assumption that the XDR panel does not share.
            tone.detectPaperWhite.value = true;
            tone.detectBrightnessLimits.value = true;

            // `available` only means the display could do HDR — the swapchain
            // is still SDR until someone asks. Without this request the panel
            // reports max=100 nits and `active` stays false, which is exactly
            // what the first run of this code measured on the XDR display.
            // The mode change is asynchronous, so the real nit values are not
            // readable on this frame; HdrSettleRoutine picks them up once the
            // swapchain has actually flipped.
            if (!hdr.active) hdr.RequestHDRModeChange(true);
            StartCoroutine(HdrSettleRoutine());
        }

        // Waits for the HDR swapchain to come up, then grades against what the
        // display actually reports. Bounded, because RequestHDRModeChange can
        // legitimately never complete (display does not support it, or the
        // window was dragged to an SDR monitor mid-request) and this must not
        // spin forever in that case.
        IEnumerator HdrSettleRoutine()
        {
            var hdr = HDROutputSettings.main;
            for (int f = 0; f < 120 && hdr != null && !hdr.active; f++)
                yield return null;

            if (hdr == null || !hdr.active)
            {
                Debug.Log("[LTA] HDR mode change did not take — remaining on SDR ACES.");
                yield break;
            }

            // Pick the ACES range-reduction preset that matches the panel.
            // The built-in XDR display peaks around 1600 nits, which lands
            // between the 1000- and 2000-nit presets; bucket on what the
            // display actually reports instead of assuming this machine.
            float maxNits = hdr.maxToneMapLuminance > 0 ? hdr.maxToneMapLuminance : 1000f;

            // Sanity-check what the display told us. macOS can report
            // paperWhite=160 but max=100 — a peak dimmer than paper white,
            // which is self-contradictory and means the EDR headroom did not
            // come through the Metal swapchain query. The old response was
            // to trust "it's really an XDR panel" and grade to a hardcoded
            // 1000 nits — but when the swapchain genuinely has only 100
            // nits of headroom (different monitor, auto-brightness, a
            // driver-side EDR drop), grading to 1000 on a 100-nit output
            // crushes the whole frame to near-black. Trust the numbers:
            // fall back to SDR ACES with detected limits, which always
            // produces a readable frame, and log the choice.
            if (maxNits <= hdr.paperWhiteNits)
            {
                Debug.LogWarning($"[LTA] Display reported max={maxNits} <= paperWhite=" +
                                 $"{hdr.paperWhiteNits}; no real HDR headroom — " +
                                 "falling back to SDR grading.");
                hdr.RequestHDRModeChange(false);
                if (toneMap != null)
                {
                    toneMap.detectBrightnessLimits.value = true;
                    toneMap.detectPaperWhite.value = true;
                }
                yield break;
            }

            if (toneMap != null)
                toneMap.acesPreset.value =
                    maxNits >= 3000f ? HDRACESPreset.ACES4000Nits :
                    maxNits >= 1500f ? HDRACESPreset.ACES2000Nits :
                                       HDRACESPreset.ACES1000Nits;

            Debug.Log($"[LTA] HDR output active={hdr.active} " +
                      $"paperWhite={hdr.paperWhiteNits}nits " +
                      $"min={hdr.minToneMapLuminance} max={maxNits} " +
                      $"gamut={hdr.displayColorGamut} " +
                      $"preset={(toneMap != null ? toneMap.acesPreset.value.ToString() : "n/a")}");
        }

        /* -------------------------------------------------- weather fx */

        // A hand-rolled rain effect: a pool of thin falling streak sprites
        // instead of Unity's ParticleSystem component, which needs a
        // package this project doesn't otherwise reference (kept the
        // zero-extra-dependency spirit of the rest of the renderer).
        void BuildRain()
        {
            rainRoot = new GameObject("rain");
            rainRoot.transform.SetParent(transform, false);
            rainDrops = new Transform[RainDropCount];
            rainDropH = new float[RainDropCount];
            rainSr = new SpriteRenderer[RainDropCount];
            for (int i = 0; i < RainDropCount; i++)
            {
                var go = new GameObject("drop");
                go.transform.SetParent(rainRoot.transform, false);
                var sr = go.AddComponent<SpriteRenderer>();
                sr.sprite = SpriteKit.White;
                sr.color = new Color(0.75f, 0.82f, 0.92f, Cfg.RainStreakAlpha);
                go.transform.localRotation = Quaternion.Euler(12f, 0f, 0f);
                go.transform.localScale = new Vector3(1.1f, 26f, 1f);
                rainDrops[i] = go.transform;
                rainSr[i] = sr;
                rainDropH[i] = Random.value * 400f;
            }
            rainRoot.SetActive(false);
        }

        void StepRain(float dt)
        {
            Vector3 camPos = cam.transform.position;
            // Realism pass (Phase 8): only the first floor(count*intensity)
            // pooled drops are shown/moved this storm — cheap density
            // control with no per-frame allocation, and streak length/alpha
            // scale with the same intensity so a light rain reads as
            // thinner, not just sparser.
            int activeCount = Mathf.Max(1, Mathf.RoundToInt(RainDropCount * rainIntensity));
            float streakLen = Mathf.Lerp(16f, 26f, rainIntensity);
            float streakAlpha = Cfg.RainStreakAlpha * Mathf.Lerp(0.6f, 1f, rainIntensity);
            for (int i = 0; i < rainDrops.Length; i++)
            {
                bool active = i < activeCount;
                if (rainDrops[i].gameObject.activeSelf != active) rainDrops[i].gameObject.SetActive(active);
                if (!active) continue;
                var sr = rainSr[i];
                sr.color = new Color(sr.color.r, sr.color.g, sr.color.b, streakAlpha);
                rainDrops[i].localScale = new Vector3(1.1f, streakLen, 1f);
                rainDropH[i] -= 640f * dt;
                if (rainDropH[i] < 0f)
                {
                    rainDropH[i] = 380f + Random.value * 40f;
                    float ang = Random.value * Mathf.PI * 2f, r = Random.value * 260f;
                    rainDrops[i].localPosition = new Vector3(Mathf.Cos(ang) * r, 0f, Mathf.Sin(ang) * r);
                }
                var lp = rainDrops[i].localPosition;
                rainDrops[i].position = new Vector3(camPos.x + lp.x, rainDropH[i], camPos.z + lp.z);
            }
        }

        // day/night tint, sky/fog color, rain toggle, weather-driven grip.
        // All purely presentational except State.WeatherGrip, which
        // PlayerSys.Step reads to loosen handling in the rain.
        void UpdateWorldFX(float dt)
        {
            var s = data.State;
            double frac = (s.Time % Cfg.DayLength) / Cfg.DayLength;   // 0..1
            // Night-locked (Cfg.NightTheme): the city stays in one deliberate
            // after-dark state instead of sweeping through a day. Flip
            // Cfg.NightTheme off to restore the original cycle — everything
            // downstream still reads dayAmount exactly as before.
            // TunDayOverride (GameState): -1 = follow Cfg.NightTheme, else pin
            // dayAmount to 0..1 directly. It also lifts the night lock on the
            // sun's elevation and azimuth below, so daylight can be inspected at
            // runtime without editing Cfg.
            bool nightLocked = Cfg.NightTheme && s.TunDayOverride < 0f;
            float dayAmount = s.TunDayOverride >= 0f
                ? Mathf.Clamp01(s.TunDayOverride)
                : nightLocked
                    ? Cfg.NightDayAmount
                    : Mathf.Clamp01(0.5f + 0.5f * Mathf.Cos((float)((frac - 0.25) * Mathf.PI * 2f)));
            Color sky = Color.Lerp(NightSky, DaySky, dayAmount);
            Color fog = Color.Lerp(NightFog, DayFog, dayAmount);
            // Gentler than it used to be: the sun's own intensity and the
            // hemisphere ambient now carry most of the day/night swing, so
            // this tint only has to nudge hue. Left at the old 0.42 it
            // would double-dim against real lighting and crush night to black.
            Color tint = Color.Lerp(new Color(0.74f, 0.78f, 0.92f), Color.white, dayAmount);

            bool raining = s.Weather == Weather.Rain;
            if (raining)
            {
                sky = Color.Lerp(sky, Cfg.Hex("#161c22"), 0.6f);
                fog = Color.Lerp(fog, Cfg.Hex("#0e1216"), 0.5f);
                tint *= 0.9f;
            }

            // T10: fog weather — very tight fog distance (sightlines short
            // enough that you cannot read a block ahead), a milky ground-
            // matched fog color, and grip barely affected (fog is a visibility
            // cost, not a wet-road cost). Fog end distance (900) sits well
            // INSIDE the texture build radius (~3600), so no unloaded block
            // can pop in through the murk — that per-lane interaction with
            // CityRenderer's eviction was the one hazard in this design
            // (progression plan Phase 4.2's warning).
            bool foggy = s.Weather == Weather.Fog;
            if (foggy)
            {
                sky = Color.Lerp(sky, Cfg.Hex("#c9c3b4"), 0.7f);
                fog = Cfg.Hex("#c9c3b4");
                tint *= 0.96f;
            }

            cam.backgroundColor = sky;
            RenderSettings.fogColor = fog;
            RenderSettings.fogEndDistance = raining ? 1500f : foggy ? 900f : 2600f;
            Shader.SetGlobalColor(LtaDayNightId, tint);
            // Realism pass (Phase 8): grip loosens a bit further in a heavier
            // storm instead of one flat number for all rain — a light
            // drizzle (low rainIntensity) barely nicks handling, a downpour
            // nicks it more, matching the now-variable rain visuals.
            // T10: fog costs a flat 0.9 grip — noticeable but minor.
            s.WeatherGrip = raining
                ? Mathf.Lerp(0.74f, 0.62f, rainIntensity)
                : foggy ? 0.9f : 1f;

            // Phase 13: airborne light shafts are barely visible on a clear
            // night and obvious in a downpour, because what a beam actually
            // lights up is the water in the air. Scales off the same
            // per-storm rainIntensity the drop count and grip penalty use, so
            // a heavy storm reads heavy in every channel at once.
            shaftAlpha = Cfg.ShaftAlphaBase *
                (raining ? Mathf.Lerp(1f, Cfg.ShaftAlphaRainMax, rainIntensity) : 1f);

            if (sun != null)
            {
                // Night-locked: the key light is a high, cool moon. Left on
                // the day curve at this dayAmount it would sit at roughly
                // -10 degrees — raking in horizontally from below the
                // horizon, which throws long wrong-looking shadows up the
                // fronts of buildings. Held at 56 degrees it reads as
                // moonlight and gives clean downward contact shadows.
                // The azimuth still drifts slowly so the city isn't frozen.
                float elev = nightLocked ? 56f : Mathf.Lerp(-10f, 64f, dayAmount);
                float azim = nightLocked ? 35f + (float)frac * 60f
                                         : (float)(frac * 360.0) + 35f;
                sun.transform.rotation = Quaternion.Euler(elev, azim, 0f);

                float lowSun = 1f - Mathf.Clamp01(dayAmount * 1.7f);
                Color warm = Color.Lerp(Cfg.Hex("#fff3e0"), Cfg.Hex("#ffa863"), lowSun);
                Color moon = Cfg.Hex("#8fa6d4");
                sun.color = Color.Lerp(moon, warm, dayAmount);
                // night end lifted well off the old 0.18: moonlight still has
                // to carry all the form now that there is no day to fall back on
                sun.intensity = Mathf.Lerp(0.55f, 1.35f, dayAmount) * (raining ? 0.55f : 1f);
                sun.shadowStrength = Mathf.Lerp(0.45f, 0.85f, dayAmount);
            }

            // hemisphere ambient — replaces the old baked per-face brightness.
            // The night end is deliberately a lifted blue rather than near
            // black: with no sun, ambient is what keeps surfaces facing away
            // from the moon readable instead of solid silhouette.
            Color ambSky = Color.Lerp(Cfg.Hex("#26334d"), Cfg.Hex("#93aacb"), dayAmount);
            Color ambGnd = Color.Lerp(Cfg.Hex("#101520"), Cfg.Hex("#2b2a24"), dayAmount);
            if (raining)
            {
                ambSky = Color.Lerp(ambSky, Cfg.Hex("#3b434e"), 0.45f);
                ambGnd = Color.Lerp(ambGnd, Cfg.Hex("#171a1e"), 0.45f);
            }
            Shader.SetGlobalColor(LtaAmbSkyId, ambSky);
            Shader.SetGlobalColor(LtaAmbGroundId, ambGnd);
            // windows light up as the sun goes down
            Shader.SetGlobalFloat(LtaNightEmissionId, Mathf.Clamp01(1f - dayAmount * 1.15f));

            if (rainRoot != null)
            {
                if (raining != rainRoot.activeSelf)
                {
                    rainRoot.SetActive(raining);
                    // Realism pass (Phase 8): roll a new density once per
                    // rain EVENT (on the clear->rain edge), not every frame —
                    // see the rainIntensity field comment.
                    if (raining) rainIntensity = Random.Range(Cfg.RainIntensityMin, Cfg.RainIntensityMax);
                }
                if (raining) StepRain(dt);
            }

            // Procedural skybox: reuse the sky/fog colors already computed
            // above (fog IS the horizon color distant geometry fades into,
            // so feeding it in as the horizon keeps the skybox seamless with
            // RenderSettings.fog) and the sun's own facing for the disc.
            // transform.forward is the direction light TRAVELS; the disc
            // wants the direction FROM the camera TO the sun, i.e. the
            // negation.
            Vector3 sunDirWS = sun != null ? -sun.transform.forward : Vector3.up;
            Color sunDiscColor = sun != null ? sun.color : Color.white;
            // T17: sunset/dawn band + starfield. Band color picks warm sunset
            // vs cool dawn from the sun's azimuth relative to the camera
            // heading (west = warm orange leaving, east = pale pink coming);
            // elevation from the sun's own declination drives the fade.
            float sunElevN = Mathf.Clamp01((sun != null
                ? Vector3.Dot(sunDirWS, Vector3.up) : 1f) / 0.9f);
            bool duskSide = Mathf.Cos((float)((frac * 360.0 - 90.0) * Mathf.Deg2Rad)) < 0f;
            Color bandC = duskSide ? Cfg.Hex("#ff9a4d") : Cfg.Hex("#ffb3c2");
            SkyKit.Apply(sky, fog, sunDirWS, sunDiscColor, dayAmount, sunElevN, bandC);

            StepReflectionProbe(dt);
        }

        // Phase 12. Keeps the single realtime probe over the player and
        // re-renders it on a timer.
        //
        // Deliberately on real dt, not simDt: this is presentation, like
        // StepCamera and UpdateWorldFX itself. A paused game still draws, so
        // the reflection still has to be valid — and RenderProbe() during a
        // pause is harmless because nothing in the world is moving to be
        // reflected differently.
        void StepReflectionProbe(float dt)
        {
            if (reflProbe == null) return;

            var p = data.Player;
            reflProbe.transform.position = MeshKit.V3(p.X, p.Y, Cfg.ReflectionProbeHeight);

            reflNextRender -= dt;
            if (reflNextRender > 0f) return;
            reflNextRender = Cfg.ReflectionProbeInterval;

            // RenderProbe() with IndividualFaces time slicing queues the work
            // rather than doing it inline, so this call is cheap; the cost
            // lands spread over the next several frames.
            reflProbe.RenderProbe();

            // Ramp the blend in on the first render instead of snapping — the
            // cube is blank until one render has completed, and a hard cut
            // from the hemisphere fake to a real reflection is a visible pop.
            Shader.SetGlobalFloat(LtaReflBlendId,
                Mathf.MoveTowards(Shader.GetGlobalFloat(LtaReflBlendId),
                                  Cfg.ReflectionProbeBlend, 0.15f));
        }

        /* -------------------------------------------------- save/load */

        void LoadGame(GameData d)
        {
            string json = PlayerPrefs.GetString(SaveKey, null);
            if (string.IsNullOrEmpty(json)) return;
            SaveData sd;
            try { sd = JsonUtility.FromJson<SaveData>(json); }
            catch (System.Exception) { return; }
            if (sd == null || !sd.valid) return;

            d.Player.X = sd.px; d.Player.Y = sd.py; d.Player.A = sd.pa;
            d.Player.Health = Mathf.Clamp(sd.health, 1f, 100f);
            d.Player.Ammo = Mathf.Max(0, sd.ammo);
            // gang wars: the arsenal round-trips too. Old saves only know
            // hasGun — treat that as owning the pistol.
            d.Player.OwnsPistol = sd.hasGun;
            d.Player.OwnsSmg = sd.ownsSmg;
            d.Player.OwnsShotgun = sd.ownsShotgun;
            d.Player.Weapon = (WeaponKind)Mathf.Clamp(sd.weapon, 0, 3);
            if (d.Player.Weapon == WeaponKind.None && d.Player.OwnsPistol)
                d.Player.Weapon = WeaponKind.Pistol;
            if (d.Player.Weapon == WeaponKind.Smg && !d.Player.OwnsSmg) d.Player.Weapon = WeaponKind.None;
            if (d.Player.Weapon == WeaponKind.Shotgun && !d.Player.OwnsShotgun) d.Player.Weapon = WeaponKind.None;
            if (d.Player.Weapon == WeaponKind.Pistol && !d.Player.OwnsPistol) d.Player.Weapon = WeaponKind.None;
            d.State.Score = Mathf.Max(0, sd.score);
            d.State.CompletedJobs = Mathf.Max(0, sd.completedJobs);   // T7 ladder resumes
            // T16: the garage's owned ride round-trips (fresh snapshot from
            // the last garage save; no owned car without one)
            Systems.GarageStored = sd.hasGarageCar;
            if (sd.hasGarageCar)
            {
                Systems.gBody = Mathf.Clamp(sd.gBody, 0, 3);
                Systems.gR = sd.gR; Systems.gG = sd.gG; Systems.gB = sd.gB;
                Systems.gHealth = Mathf.Clamp(sd.gHealth, 20f, 100f);
            }
            d.State.Wanted = 0;   // never resume with cops already on you
            if (sd.highScore > d.State.HighScore) d.State.HighScore = sd.highScore;
        }

        void SaveGame()
        {
            if (data == null || !data.State.Started) return;
            var p = data.Player;
            var sd = new SaveData
            {
                px = p.X, py = p.Y, pa = p.A,
                health = p.Health, ammo = p.Ammo, hasGun = p.HasGun,
                weapon = (int)p.Weapon, ownsSmg = p.OwnsSmg, ownsShotgun = p.OwnsShotgun,
                score = data.State.Score, wanted = data.State.Wanted,
                highScore = data.State.HighScore,
                completedJobs = data.State.CompletedJobs,   // T7 reward ladder persists
                // T16: the garage's owned ride persists with the run
                hasGarageCar = Systems.GarageStored,
                gBody = Systems.gBody,
                gR = Systems.gR, gG = Systems.gG, gB = Systems.gB,
                gHealth = Systems.gHealth,
                valid = true
            };
            PlayerPrefs.SetString(SaveKey, JsonUtility.ToJson(sd));
            PlayerPrefs.Save();
        }

        IEnumerator AutoSaveLoop()
        {
            var wait = new WaitForSeconds(5f);
            while (true)
            {
                yield return wait;
                SaveGame();
            }
        }

        void OnApplicationQuit()
        {
            SaveGame();
            SettingsStore.Save();   // settings persist independently of run state
        }

        IEnumerator ShotRoutine()
        {
            yield return new WaitForSeconds(1.2f);

            // first frame: on foot, for checking the player/ped models
            yield return new WaitForEndOfFrame();
            CaptureTo(shotPath + ".foot.bmp");

            // hop into the nearest car and roll forward so the shot shows the
            // driving chase view (car mesh, headlights, camera swing)
            var pl = data.Player;
            CarEnt best = null; float bd = float.MaxValue;
            for (int i = 0; i < data.Cars.Count; i++)
            {
                CarEnt c = data.Cars[i];
                float dx = c.X - pl.X, dy = c.Y - pl.Y;
                float d = dx * dx + dy * dy;
                if (d < bd) { bd = d; best = c; }
            }
            if (best != null)
            {
                pl.X = best.X + 20f; pl.Y = best.Y;
                PlayerSys.TryEnterExit(data);
                // frame-bounded so a throttled/unfocused player can't stall it
                for (int f = 0; f < 150 && pl.InCar != null; f++)
                {
                    pl.InCar.Speed = 190f;   // stand-in for holding W
                    yield return null;
                }
            }

            yield return new WaitForEndOfFrame();
            CaptureTo(shotPath);
            yield return new WaitForSeconds(0.5f);
            Application.Quit();
        }

        // hand-rolled BMP: the ScreenCapture/ImageConversion modules are
        // not available in this project, and BMP needs no encoder
        static void CaptureTo(string path)
        {
            var tex = new Texture2D(Screen.width, Screen.height, TextureFormat.RGB24, false);
            tex.ReadPixels(new Rect(0, 0, Screen.width, Screen.height), 0, 0);
            tex.Apply(false, false);
            WriteBmp(path, tex);
            Destroy(tex);
        }

        static void WriteBmp(string path, Texture2D tex)
        {
            int w = tex.width, h = tex.height;
            var px = tex.GetPixels32();   // row 0 = bottom, matches BMP order
            int rowBytes = w * 3;
            int pad = (4 - rowBytes % 4) % 4;
            int dataSize = (rowBytes + pad) * h;
            var b = new byte[54 + dataSize];
            b[0] = (byte)'B'; b[1] = (byte)'M';
            WriteLE(b, 2, 54 + dataSize);
            WriteLE(b, 10, 54);
            WriteLE(b, 14, 40);
            WriteLE(b, 18, w);
            WriteLE(b, 22, h);
            b[26] = 1; b[28] = 24;
            WriteLE(b, 34, dataSize);
            int o = 54;
            for (int y = 0; y < h; y++)
            {
                for (int x = 0; x < w; x++)
                {
                    var c = px[y * w + x];
                    b[o++] = c.b; b[o++] = c.g; b[o++] = c.r;
                }
                o += pad;
            }
            System.IO.File.WriteAllBytes(path, b);
        }

        static void WriteLE(byte[] b, int off, int v)
        {
            b[off] = (byte)v; b[off + 1] = (byte)(v >> 8);
            b[off + 2] = (byte)(v >> 16); b[off + 3] = (byte)(v >> 24);
        }

        /* ------------------------------------------------------- frame */

        void Update()
        {
            if (data == null)
            {
                RecoverFromDomainReload();
                return;
            }

            float dt = Mathf.Min(0.05f, Time.unscaledDeltaTime);
            var s = data.State;

            // Pause toggle FIRST — before anything reads input for the sim
            // (plan §2.3). Bound to Escape/P and the gamepad Start/Back
            // buttons; never Space/Return/JoystickButton0, which are
            // handbrake-, fire- and start-overlay-adjacent and would click
            // straight through the menu. Gated so the BUSTED/WASTED beats
            // play out uninterrupted.
            bool wantPause = Input.GetKeyDown(KeyCode.Escape) || Input.GetKeyDown(KeyCode.P)
                || Input.GetKeyDown(KeyCode.JoystickButton7) || Input.GetKeyDown(KeyCode.JoystickButton6);
            if (wantPause && s.Started && s.Busted <= 0f && s.Wasted <= 0f)
                hud.SetPaused(!s.Paused);

            // Master volume, applied every frame: AudioListener.volume is the
            // only multiplier that reaches PlayClipAtPoint one-shots (crash,
            // footsteps, tire screech, distant gunfire), and per-frame
            // application gives the settings screen live preview for free.
            AudioListener.volume = SettingsStore.MasterVolume;

            // simDt is the pause gate (plan §2.1). Time.timeScale would be
            // actively dangerous here: this loop reads unscaledDeltaTime (so
            // the sim wouldn't even pause), and timeScale = 0 stalls the
            // autosave coroutine and hangs the screenshot watchdog's
            // scaled-time waits. Instead: the game clock and every sim system
            // take simDt (0 while paused); presentation below keeps real dt
            // so the frozen city still renders behind the menu, the camera
            // settles instead of snapping, and audio fades stay smooth.
            float simDt = s.Paused ? 0f : dt;
            s.Time += simDt;
            double t = s.Time;

            if (s.Shake > 0f) s.Shake = Mathf.Max(0f, s.Shake - 36f * simDt);

            if (s.Started)
            {
                if (s.Busted <= 0f && s.Wasted <= 0f && !s.Paused)
                {
                    if (PlayerSys.EnterExitPressed()) PlayerSys.TryEnterExit(data);
                    PlayerSys.Step(data, simDt, -camYaw * Mathf.Deg2Rad);
                    Systems.SpikeStep(data, simDt);
                    Systems.GasStationStep(data, simDt);   // T8: drive-in repair sink
                    Systems.GarageStep(data, simDt);       // T16: garage world trigger
                    for (int i = 0; i < data.Cars.Count; i++) Systems.TrafficStep(data, data.Cars[i], simDt);
                    Systems.ExhaustStep(data, simDt, data.Player.X - 1000f, data.Player.Y - 800f, 2000f, 1600f);
                    Systems.SplashStep(data, simDt, data.Player.X - 1000f, data.Player.Y - 800f, 2000f, 1600f);
                    for (int j = 0; j < data.Peds.Count; j++) Systems.PedStep(data, data.Peds[j], simDt);
                    Systems.RespawnDeadPeds(data);
                    Systems.PickupStep(data);
                    Systems.WeaponPickupStep(data);
                    Systems.WeatherStep(data, t);
                    MissionSys.Step(data, t);
                    Systems.ParticlesStep(data, simDt);
                }
                // LawStep stays OUTSIDE the gate (its own comment explains
                // why — the JS original froze BUSTED forever) but takes
                // simDt: with real dt, a pause would run the Busted/Wasted
                // countdowns behind the menu and an arrest would resolve
                // (teleport!) while the player is reading the settings.
                Systems.LawStep(data, t, simDt);

                // Unified death consequence — on foot OR in a car. The old
                // branch here required InCar == null, so Systems.DamageCar
                // could leave the player sitting at 0 HP inside a wreck
                // forever; KillPlayer ejects from the wreck itself, so that
                // condition is deliberately gone. This is the ONLY trigger
                // site: DamageCar runs from inside CopStep while LawStep
                // iterates d.Cops backwards, and KillPlayer clears that list.
                if (data.Player.Health <= 0f && s.Busted <= 0f && s.Wasted <= 0f)
                    Systems.KillPlayer(data, "Wasted — locally. You come to back on your home corner.");

                if (s.Score > s.HighScore)
                {
                    s.HighScore = s.Score;
                    PlayerPrefs.SetInt("lta_highscore", s.HighScore);
                }
            }

            GameAudio.Step(data, dt);
            Audio3D.Step(data, dt);
            UpdateWorldFX(dt);
            StepCamera(dt);

            city.Sync(data, data.Player.X, data.Player.Y, data.State.Weather == Weather.Rain, (float)data.State.Time, dt);
            SyncCars(dt);
            SyncCops(dt);
            SyncPeds(dt);
            SyncPlayer((float)t);
            SyncPackages((float)t);
            SyncWeapons((float)t);
            SyncMission((float)t);
            SyncParticles();
            SyncSkids();
            SyncSpikeStrips();
            hud.Refresh();
        }

        void RecoverFromDomainReload()
        {
            active = this;
            var roots = SceneManager.GetActiveScene().GetRootGameObjects();
            for (int i = 0; i < roots.Length; i++)
                if (roots[i] != gameObject) Destroy(roots[i]);
            for (int i = transform.childCount - 1; i >= 0; i--)
                Destroy(transform.GetChild(i).gameObject);
            copOwners.Clear(); partOwners.Clear(); skidOwners.Clear(); spikeOwners.Clear();
            packageVis.Clear(); weaponVis.Clear();
            sparkPool.Clear(); puffPool.Clear(); skidPool.Clear(); copVisPool.Clear();
            playerVis = null;
            InitGame();
        }

        // RESTART from the pause menu (plan §1E). RecoverFromDomainReload
        // already does the heavy lifting — sweep stray roots, clear the
        // visual-ownership tables, re-run InitGame — so a restart is that
        // path plus two hazards handled up front:
        //   1. InitGame calls LoadGame, so the abandoned run's save must be
        //      deleted FIRST or RESTART silently restores it.
        //   2. GameAudio/Audio3D cache statics (sources, entity-keyed tables,
        //      a game-clock gate) that outlive the world they were built
        //      for; their Init()s early-return while those caches look
        //      alive, and the root sweep destroys the objects at end of
        //      frame — AFTER InitGame has already skipped the rebuild. Left
        //      alone, a restart would silently lose every sound.
        public void RestartRun()
        {
            PlayerPrefs.DeleteKey(SaveKey);
            StopAllCoroutines();          // the old AutoSaveLoop; InitGame starts a fresh one
            GameAudio.Reset();
            Audio3D.Reset();              // T12: proper reset inside Audio3D itself
            RecoverFromDomainReload();
        }

        /* ------------------------------------------------ chase camera */

        static float YawDegJs(float aJs)
        {
            // JS heading -> Unity yaw of the same direction
            return Mathf.Atan2(Mathf.Cos(aJs), -Mathf.Sin(aJs)) * Mathf.Rad2Deg;
        }

        // Realism pass (Phase 7): arrest-beat camera cut. The bust/freeze/
        // teleport logic in LawStep is untouched (including its deliberate
        // fix over the JS original — see the comment there); this only
        // dresses up the frozen window with a slow low orbit instead of
        // holding the normal chase-cam framing, so getting busted reads as a
        // deliberate cinematic beat rather than the game just stalling.
        float arrestOrbit;

        void StepCamera(float dt)
        {
            var p = data.Player;
            bool inCar = p.InCar != null;
            float spd = Mathf.Sqrt(p.Vx * p.Vx + p.Vy * p.Vy);

            // the arrest orbit doubles as the WASTED framing: both are
            // frozen-sim beats that deserve a deliberate cinematic camera
            // instead of the normal chase framing. KillPlayer teleports
            // immediately, so the orbit settles over the respawn corner
            // under the overlay rather than snapping.
            if (data.State.Busted > 0f || data.State.Wasted > 0f)
            {
                arrestOrbit += dt * 22f; // slow, deliberate — not a snap-cut spin
                Vector3 arrestFocus = MeshKit.V3(p.X, p.Y, inCar ? 12f : 15f);
                Vector3 arrestEye = arrestFocus + Vector3.up * 34f
                    + Quaternion.Euler(0f, arrestOrbit, 0f) * new Vector3(0f, 0f, -70f);
                camPos = Vector3.Lerp(camPos, arrestEye, Mathf.Min(1f, 5f * dt));
                cam.transform.position = camPos;
                cam.transform.rotation = Quaternion.LookRotation(arrestFocus - camPos, Vector3.up);
                cam.fieldOfView = Mathf.Lerp(cam.fieldOfView, 42f, Mathf.Min(1f, 4f * dt));
                return;
            }
            arrestOrbit = 0f;

            // swing behind the direction of travel, with lag
            if (inCar || spd > 1f)
            {
                float target = YawDegJs(p.A);
                camYaw = Mathf.LerpAngle(camYaw, target, Mathf.Min(1f, 4f * dt));
            }

            float dist = (inCar ? 175f : 115f) + 45f * Mathf.Clamp01(spd / 280f);
            float height = inCar ? 82f : 58f;
            Vector3 fwd = Quaternion.Euler(0f, camYaw, 0f) * Vector3.forward;
            Vector3 focus = MeshKit.V3(p.X, p.Y, inCar ? 12f : 15f);
            Vector3 eye = focus + Vector3.up * 12f;
            Vector3 back = (-fwd * dist + Vector3.up * (height - 12f)).normalized;
            float fullLen = (-fwd * dist + Vector3.up * (height - 12f)).magnitude;

            // Building avoidance without snapping: cast a thick ray back from
            // the player, then SMOOTH the boom length — pull in quickly when a
            // wall interrupts, relax back slowly, so corners never cause jumps.
            float allowed = fullLen;
            RaycastHit hit;
            if (Physics.SphereCast(eye, 7f, back, out hit, fullLen))
                allowed = Mathf.Max(24f, hit.distance - 4f);
            float pullRate = allowed < camBoom ? 12f : 1.6f;
            camBoom = Mathf.Lerp(camBoom, allowed, Mathf.Min(1f, pullRate * dt));

            Vector3 desired = eye + back * camBoom;
            camPos = Vector3.Lerp(camPos, desired, Mathf.Min(1f, 6f * dt));

            Vector3 shake = Vector3.zero;
            if (data.State.Shake > 0f)
            {
                shake = new Vector3((Random.value - 0.5f) * data.State.Shake,
                                    (Random.value - 0.5f) * data.State.Shake * 0.5f,
                                    (Random.value - 0.5f) * data.State.Shake);
            }

            cam.transform.position = camPos + shake;
            cam.transform.rotation = Quaternion.LookRotation(focus + fwd * 55f - camPos, Vector3.up);

            if (dof != null)
            {
                // keep the player sharp regardless of boom length: focus
                // starts falling off a little past the car/player itself
                float focusDist = Vector3.Distance(camPos, focus);
                dof.gaussianStart.value = focusDist + 15f;
                dof.gaussianEnd.value = focusDist + 200f;
            }

            // FOV kick: widens gently with speed for a sense of pace, and
            // punches wider for an instant on a hard hit (State.Shake)
            float speedFov = 60f + 8f * Mathf.Clamp01(spd / 260f);
            float hitFov = Mathf.Min(10f, data.State.Shake * 0.5f);
            cam.fieldOfView = Mathf.Lerp(cam.fieldOfView, speedFov + hitFov, Mathf.Min(1f, 5f * dt));
        }

        /* ------------------------------------------------------ visuals */

        static void SpinWheels(CarVisual v, float speed, float dt)
        {
            if (v.Wheels == null) return;
            float deg = speed * dt / 3.2f * Mathf.Rad2Deg;   // wheel radius 3.2
            for (int w = 0; w < v.Wheels.Length; w++)
                v.Wheels[w].Rotate(deg, 0f, 0f, Space.Self);
        }

        void SyncCars(float dt)
        {
            var s = data.State;
            bool stealActive = s.MissionOn && s.MissionKind == MissionKind.Steal && s.StealTarget != null;
            float stealPulse = 0.55f + 0.45f * Mathf.Sin((float)s.Time * 5f);
            for (int i = 0; i < data.Cars.Count; i++)
            {
                CarEnt c = data.Cars[i];
                // Realism pass (Phase 3): build off the entity's own seed so
                // the mesh silhouette and the per-body-type physics always
                // agree (previously the list index, which neither traffic AI
                // nor the physics path could read).
                if (c.Vis == null) c.Vis = MeshKit.BuildCar(c.Color, false, c.Seed);
                var v = c.Vis;
                v.Root.transform.position = MeshKit.V3(c.X, c.Y, 0f);
                v.Root.transform.rotation = MeshKit.YawJs(c.A);
                v.Lights.SetActive(!c.Parked && !c.Wrecked);
                ApplyShafts(v);
                Color tint = c.Wrecked ? WreckTint : Color.white;
                // Realism pass (Phase 3): intermediate "dented fender" state —
                // paint dirties as health drops instead of snapping pristine
                // -> wrecked. DamageTint is a cold gray so it reads as grime.
                if (!c.Wrecked && c.Health < 75f)
                    tint = Color.Lerp(tint, Cfg.DamageTint, (1f - Mathf.Clamp01(c.Health / 75f)) * 0.85f);
                if (!c.Wrecked && stealActive && s.StealTarget == c)
                    tint = Color.Lerp(Color.white, StealCyan, stealPulse);
                MeshKit.Tint(v.Body, tint);
                bool braking = c.Brake && !c.Parked && !c.Wrecked;
                MeshKit.Tint(v.BrakeA, braking ? TailBright : TailDim);
                MeshKit.Tint(v.BrakeB, braking ? TailBright : TailDim);
                if (!c.Parked && !c.Wrecked) SpinWheels(v, c.Speed, dt);

                // Realism pass (Phase 3): body roll/pitch — pure visual, on
                // the BODY sub-mesh only so the wheels (children of Root)
                // stay grounded while the cabin leans under cornering and
                // accel/brake. Derived from acceleration (finite difference
                // of velocity along/across the heading), smoothed.
                if (dt > 0f)
                {
                    float fX = Mathf.Cos(c.A), fY = Mathf.Sin(c.A);
                    float fwd = c.Vx * fX + c.Vy * fY;
                    float latV = -fY * c.Vx + fX * c.Vy;
                    float fwdA = (fwd - v.PrevFwd) / dt;
                    float latA = (latV - v.PrevLat) / dt;
                    v.PrevFwd = fwd; v.PrevLat = latV;
                    // roll outwards (away from turn) under lateral accel;
                    // pitch back on accel, nose-dive on brake.
                    float rollT = Mathf.Clamp(-latA * 0.028f, -8f, 8f);
                    float pitchT = Mathf.Clamp(-fwdA * 0.02f, -5f, 5f);
                    float k = Mathf.Min(1f, 12f * dt);
                    v.Roll = Mathf.Lerp(v.Roll, rollT, k);
                    v.Pitch = Mathf.Lerp(v.Pitch, pitchT, k);
                    v.Body.transform.localRotation = Quaternion.Euler(v.Pitch, 0f, v.Roll);
                }

                // Realism pass: the player's own headlights cast hard shadows
                // (only ever 0-1 player cars, so this is O(1)); everyone else
                // stays shadowless. Property is set every frame but only
                // changes when the player enters/exits, which is fine.
                if (v.Beams != null && Cfg.EnablePunctualShadows)
                {
                    LightShadows bs = c.IsPlayer && !c.Wrecked ? LightShadows.Hard : LightShadows.None;
                    if (v.Beams[0].shadows != bs || v.Beams[1].shadows != bs)
                    {
                        v.Beams[0].shadows = bs;
                        v.Beams[1].shadows = bs;
                    }
                }
            }
        }

        void SyncCops(float dt)
        {
            Quaternion bill = cam.transform.rotation;
            liveCops.Clear();
            for (int i = 0; i < data.Cops.Count; i++)
            {
                CopEnt c = data.Cops[i];
                liveCops.Add(c);
                if (c.Vis == null)
                {
                    if (copVisPool.Count > 0)
                    {
                        c.Vis = copVisPool.Pop();
                        c.Vis.Root.SetActive(true);
                    }
                    else
                    {
                        c.Vis = MeshKit.BuildCar(Color.white, true, 0);
                    }
                    copOwners.Add(c);
                }
                var v = c.Vis;
                v.Root.transform.position = MeshKit.V3(c.X, c.Y, 0f);
                v.Root.transform.rotation = MeshKit.YawJs(c.A);
                v.Lights.SetActive(true);
                ApplyShafts(v);
                bool red = c.Flash == 0;
                MeshKit.Tint(v.SirenA, red ? SirenRed : SirenBlue);
                MeshKit.Tint(v.SirenB, red ? SirenBlue : SirenRed);
                Color g = red ? SirenRed : SirenBlue;
                v.SirenGlow.color = new Color(g.r, g.g, g.b, 0.35f);
                v.SirenGlow.transform.rotation = bill;
                SpinWheels(v, c.Speed, dt);
            }
            for (int i = copOwners.Count - 1; i >= 0; i--)
            {
                if (!liveCops.Contains(copOwners[i]))
                {
                    copOwners[i].Vis.Root.SetActive(false);
                    copVisPool.Push(copOwners[i].Vis);
                    copOwners[i].Vis = null;
                    copOwners.RemoveAt(i);
                }
            }
        }

        // Phase 13: push the current weather-driven shaft opacity onto one
        // car's pair of shaft sprites. No-ops when the feature is compiled
        // out (Shafts stays null) so neither sync loop needs its own guard.
        void ApplyShafts(CarVisual v)
        {
            if (v.Shafts == null) return;
            for (int i = 0; i < v.Shafts.Length; i++)
            {
                var sr = v.Shafts[i];
                if (sr == null) continue;
                Color c = sr.color;
                if (c.a != shaftAlpha) sr.color = new Color(c.r, c.g, c.b, shaftAlpha);
            }
        }

        // walk cycle: legs stride, arms swing opposite
        static void AnimatePed(PedVisual v, float swingDeg)
        {
            v.LegA.localRotation = Quaternion.Euler(swingDeg, 0f, 0f);
            v.LegB.localRotation = Quaternion.Euler(-swingDeg, 0f, 0f);
            v.ArmA.localRotation = Quaternion.Euler(-swingDeg * 0.7f, 0f, 0f);
            v.ArmB.localRotation = Quaternion.Euler(swingDeg * 0.7f, 0f, 0f);
        }

        void SyncPeds(float dt)
        {
            for (int i = 0; i < data.Peds.Count; i++)
            {
                PedEnt p = data.Peds[i];
                if (p.Vis == null) p.Vis = MeshKit.BuildPed(p.Shirt, Cfg.Skins[p.Skin], 0);
                var v = p.Vis;

                if (p.Dead)
                {
                    if (p.FlingT > 0f)
                    {
                        // brief airborne arc right after impact — tumbling,
                        // not yet the squashed rest pose
                        float lift = Mathf.Sin((0.35f - p.FlingT) / 0.35f * Mathf.PI) * 16f;
                        v.Root.transform.position = MeshKit.V3(p.X, p.Y, lift);
                        v.Root.transform.rotation = Quaternion.Euler(70f * (1f - p.FlingT / 0.35f), 0f, 0f);
                        v.Root.transform.localScale = Vector3.one;
                        MeshKit.Tint(v.Body, DeadTint);
                        MeshKit.Tint(v.Head, DeadTint);
                        continue;
                    }
                    // squashed flat + gray, reads as a body on the pavement
                    v.Root.transform.position = MeshKit.V3(p.X, p.Y, 0f);
                    v.Root.transform.rotation = Quaternion.identity;
                    v.Root.transform.localScale = new Vector3(1.25f, 0.16f, 1.25f);
                    MeshKit.Tint(v.Body, DeadTint);
                    MeshKit.Tint(v.Head, DeadTint);
                }
                else
                {
                    // T13: per-ped height + panic cower. Scale carries the
                    // build hash's HeightScale normally; while panicked the
                    // visual squashes toward a crouch and the limbs fold up
                    // (arms to head, slight forward hunch) before easing
                    // back — CowerT interpolates in and out, so it reads as
                    // ducking rather than snapping between poses.
                    float cowerTarget = p.Panic > 0f ? 1f : 0f;
                    v.CowerT = Mathf.MoveTowards(v.CowerT, cowerTarget, Mathf.Min(1f, 5f * dt));
                    float cower = v.CowerT;
                    v.Root.transform.localScale = new Vector3(
                        1f, v.HeightScale * Mathf.Lerp(1f, 0.55f, cower), 1f);
                    MeshKit.Tint(v.Body, Color.white);
                    MeshKit.Tint(v.Head, Color.white);
                    // Realism pass (Phase 6): the alive branch never actually
                    // moved the visual — only rotation/pose were synced, so a
                    // walking ped's mesh sat frozen at its spawn point while
                    // its simulation X/Y (and the minimap dot) walked around
                    // it. Position was simply missing here; add it.
                    // Bob/sway ride on the SAME Phase value that drives the
                    // stride below (Phase already carries this ped's
                    // StrideMult — see PedStep) so a lift/lean always lands
                    // on a footfall instead of drifting out of sync with the
                    // legs. ×1.05 gives ~1.3 Hz / ~2.7 Hz base stride cycles —
                    // human cadence. (The old ×6 was tuned for 2D feet dots
                    // and looked like a 7.6 Hz scramble on full-body
                    // characters.)
                    float cyclePhase = p.Phase * 1.05f;
                    float bob = Mathf.Abs(Mathf.Sin(cyclePhase)) * Cfg.PedBobAmp * (1f - cower * 0.85f);
                    v.Root.transform.position = MeshKit.V3(p.X, p.Y, bob);
                    float sway = Mathf.Sin(cyclePhase) * Cfg.PedSwayDeg * (p.Panic > 0 ? 1.4f : 1f);
                    v.Root.transform.rotation = MeshKit.YawJs(p.Dir * Mathf.PI / 2f)
                        * Quaternion.Euler(cower * 16f, 0f, sway);
                    // swing interpolates the walk cycle into the "arms over
                    // the head" cower hold as CowerT rises
                    AnimatePed(v, Mathf.Lerp(Mathf.Sin(cyclePhase) * 22f, 125f, cower));
                }
            }
        }

        void SyncPlayer(float t)
        {
            var p = data.Player;
            bool onFoot = p.InCar == null;
            playerVis.Root.SetActive(onFoot);
            if (!onFoot) return;
            playerVis.Root.transform.position = MeshKit.V3(p.X, p.Y, 0f);
            playerVis.Root.transform.rotation = MeshKit.YawJs(p.A);
            bool moving = p.Vx != 0f || p.Vy != 0f;
            // 8 rad/s ≈ 1.3 Hz stride — brisk but human for the 150 px/s jog
            AnimatePed(playerVis, Mathf.Sin(t * 8f) * (moving ? 26f : 0f));
        }

        void SyncPackages(float t)
        {
            for (int i = 0; i < data.Packages.Count; i++)
            {
                PackageEnt pk = data.Packages[i];
                PkgVis v;
                if (!packageVis.TryGetValue(pk, out v))
                {
                    v = new PkgVis();
                    v.Root = MeshKit.BuildPackage();
                    v.Box = v.Root.transform.Find("box");
                    v.Glow = v.Root.transform.Find("glow").GetComponent<SpriteRenderer>();
                    packageVis[pk] = v;
                }
                v.Root.transform.position = MeshKit.V3(pk.X, pk.Y, 0f);
                v.Box.localRotation = Quaternion.Euler(0f, t * 90f + pk.Phase * 60f, 0f);
                float pulse = 0.6f + 0.4f * Mathf.Sin(t * 3f + pk.Phase);
                v.Glow.color = new Color(1f, 178f / 255f, 36f / 255f, 0.5f * pulse);
            }
        }

        void SyncWeapons(float t)
        {
            for (int i = 0; i < data.Weapons.Count; i++)
            {
                WeaponEnt w = data.Weapons[i];
                GameObject go;
                if (!weaponVis.TryGetValue(w, out go))
                {
                    go = MeshKit.BuildWeaponPickup(w.Gun);
                    weaponVis[w] = go;
                }
                go.transform.position = MeshKit.V3(w.X, w.Y, 0f);
                go.transform.rotation = Quaternion.Euler(0f, t * 70f + w.Phase * 60f, 0f);
            }
        }

        // marker + drop-off beam: shown for Delivery and Steal (both have a
        // real MissionX/Y drop-off); Rampage and Gang War have no location,
        // so no marker.
        void SyncMission(float t)
        {
            var s = data.State;
            bool showMarker = s.MissionOn
                && s.MissionKind != MissionKind.Rampage
                && s.MissionKind != MissionKind.GangWar;
            missionGo.SetActive(showMarker);
            if (showMarker)
            {
                missionGo.transform.position = MeshKit.V3(s.MissionX, s.MissionY, 0f);
                // T15: board stands a fixed offset off the marker so it never
                // hides the beam; yaws to face the camera like a rooftop sign
                float boardAng = Mathf.Atan2(data.Player.Y - s.MissionY, data.Player.X - s.MissionX);
                float boardDist = Cfg.Tile * 0.9f;
                missionBoard.SetActive(true);
                missionBoard.transform.position = MeshKit.V3(
                    s.MissionX + Mathf.Cos(boardAng) * boardDist,
                    s.MissionY + Mathf.Sin(boardAng) * boardDist, 0f);
                missionBoard.transform.rotation = Quaternion.Euler(0f, t * 30f, 0f);
                float pulse = 0.55f + 0.45f * Mathf.Sin(t * 4f);
                missionBoardGlow.color = new Color(MissionBlue.r, MissionBlue.g, MissionBlue.b, 0.32f * pulse);
                missionBeams[0].color = new Color(MissionBlue.r, MissionBlue.g, MissionBlue.b, 0.18f + 0.16f * pulse);
                missionBeams[1].color = missionBeams[0].color;
                missionGlow.color = new Color(MissionBlue.r, MissionBlue.g, MissionBlue.b, 0.5f * pulse);
            }
            else
            {
                missionBoard.SetActive(false);   // T15: hide with the marker
            }
        }

        void SyncParticles()
        {
            Quaternion bill = cam.transform.rotation;
            liveParts.Clear();
            for (int i = 0; i < data.Particles.Count; i++)
            {
                ParticleEnt p = data.Particles[i];
                liveParts.Add(p);
                if (p.Go == null)
                {
                    var pool = p.Kind == ParticleEnt.Spark ? sparkPool : puffPool;
                    if (pool.Count > 0)
                    {
                        p.Go = pool.Pop();
                        p.Go.SetActive(true);
                    }
                    else
                    {
                        p.Go = SpriteKit.BuildParticle(p.Kind);
                    }
                    p.Sr = p.Go.GetComponent<SpriteRenderer>();
                    partOwners.Add(p);
                }
                var tr = p.Go.transform;
                var sr = p.Sr;
                tr.rotation = bill;   // billboard toward the camera
                if (p.Kind == ParticleEnt.Spark)
                {
                    float len = Mathf.Sqrt(p.Vx * p.Vx + p.Vy * p.Vy) * 0.03f;
                    tr.position = MeshKit.V3(p.X, p.Y, 6f);
                    tr.localScale = new Vector3(Mathf.Max(2f, len), 1.6f, 1f);
                    sr.color = new Color(1f, 196f / 255f, 80f / 255f, Mathf.Clamp01(p.Life * 2.4f));
                }
                else if (p.Kind == ParticleEnt.Smoke)
                {
                    tr.position = MeshKit.V3(p.X, p.Y, 10f + (1.1f - p.Life) * 30f);
                    tr.localScale = new Vector3(p.R * 2f / 32f, p.R * 2f / 32f, 1f);
                    sr.color = new Color(160f / 255f, 166f / 255f, 178f / 255f, 0.28f * Mathf.Max(0f, p.Life));
                }
                else if (p.Kind == ParticleEnt.Splash)
                {
                    // Realism pass (Phase 8): tire spray — pale blue-white,
                    // low to the ground and quick to fade, distinct from the
                    // warmer/slower exhaust Puff it shares a pool with.
                    tr.position = MeshKit.V3(p.X, p.Y, 3f);
                    tr.localScale = new Vector3(p.R * 2f / 32f, p.R * 2f / 32f, 1f);
                    sr.color = new Color(198f / 255f, 214f / 255f, 226f / 255f, 0.22f * Mathf.Max(0f, p.Life / Cfg.SplashLife));
                }
                else
                {
                    tr.position = MeshKit.V3(p.X, p.Y, 5f);
                    tr.localScale = new Vector3(p.R * 2f / 32f, p.R * 2f / 32f, 1f);
                    sr.color = new Color(150f / 255f, 156f / 255f, 168f / 255f, 0.12f * Mathf.Max(0f, p.Life));
                }
            }
            for (int i = partOwners.Count - 1; i >= 0; i--)
            {
                if (!liveParts.Contains(partOwners[i]))
                {
                    ParticleEnt dead = partOwners[i];
                    dead.Go.SetActive(false);
                    dead.Go.transform.rotation = Quaternion.identity;
                    if (dead.Kind == ParticleEnt.Spark)
                    {
                        dead.Go.transform.localScale = new Vector3(3f, 3f, 1f);
                        sparkPool.Push(dead.Go);
                    }
                    else
                    {
                        puffPool.Push(dead.Go);
                    }
                    dead.Go = null;
                    dead.Sr = null;
                    partOwners.RemoveAt(i);
                }
            }
        }

        void SyncSkids()
        {
            liveSkids.Clear();
            for (int i = 0; i < data.Skids.Count; i++)
            {
                SkidEnt sk = data.Skids[i];
                liveSkids.Add(sk);
                if (sk.Go == null)
                {
                    if (skidPool.Count > 0)
                    {
                        sk.Go = skidPool.Pop();
                        sk.Go.SetActive(true);
                    }
                    else
                    {
                        sk.Go = SpriteKit.BuildSkid();
                    }
                    sk.Sr = sk.Go.GetComponent<SpriteRenderer>();
                    skidOwners.Add(sk);
                }
                sk.Go.transform.position = MeshKit.V3(sk.X, sk.Y, 0.3f);
                sk.Go.transform.rotation = Quaternion.Euler(0f, YawDegJs(sk.A), 0f) * Quaternion.Euler(90f, 0f, 0f);
                sk.Sr.color = new Color(0f, 0f, 0f, Mathf.Min(0.5f, sk.Life / 8f));
            }
            for (int i = skidOwners.Count - 1; i >= 0; i--)
            {
                if (!liveSkids.Contains(skidOwners[i]))
                {
                    skidOwners[i].Go.SetActive(false);
                    skidPool.Push(skidOwners[i].Go);
                    skidOwners[i].Go = null;
                    skidOwners[i].Sr = null;
                    skidOwners.RemoveAt(i);
                }
            }
        }

        // Realism pass (Phase 7): spike strips are few and short-lived (one
        // per roadblock, cleared with the cops when Wanted hits 0), so this
        // skips the pooling the higher-churn skid marks use — plain
        // create/destroy is plenty cheap at this volume.
        void SyncSpikeStrips()
        {
            liveSpikes.Clear();
            for (int i = 0; i < data.SpikeStrips.Count; i++)
            {
                SpikeStripEnt sp = data.SpikeStrips[i];
                liveSpikes.Add(sp);
                if (sp.Go == null)
                {
                    sp.Go = MeshKit.BuildSpikeStrip(MeshKit.V3(sp.X, sp.Y, 0f), sp.A);
                    spikeOwners.Add(sp);
                }
                sp.Go.SetActive(!sp.Spent);
            }
            for (int i = spikeOwners.Count - 1; i >= 0; i--)
            {
                if (!liveSpikes.Contains(spikeOwners[i]))
                {
                    Destroy(spikeOwners[i].Go);
                    spikeOwners.RemoveAt(i);
                }
            }
        }
    }
}
