/* ==========================================================================
   Local Theft Auto — HUD + start overlay, built in code with uGUI.
   Mirrors drawHUD() and the game.html overlay: wanted stars, score,
   speed, damage bar, ticker, BUSTED screen, vignette and the 150px
   minimap (same base colors and blips as buildMinimap()).
   ========================================================================== */
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace LocalTheftAuto
{
    public class Hud : MonoBehaviour
    {
        const int Mm = 150;

        GameData data;

        Text[] stars = new Text[5];
        Text scoreText, speedText, missionText, ammoText, compassArrow, compassDist;
        Text statsText;   // F19 slice: lifetime stats line, pause menu only
        Text comboText;   // F19 slice: live ×2/×3/×4 style-combo readout
        Image barBack, barFill;
        RawImage minimap;
        Image mmFrame;
        Text ticker; Image tickerBg;
        GameObject bustedPanel;
        GameObject wastedPanel;
        GameObject startPanel;

        // pause menu — one dim panel, three mutually-exclusive pages
        GameObject pausePanel;
        GameObject pageMain, pageSettings, pageControls, pageDebug;
        Text volumeText;

        enum MenuPage { Main, Settings, Controls, Debug }
        MenuPage page = MenuPage.Main;

        // T3: live readouts for the debug page's tuner rows (keyed by row
        // name; refreshed in RefreshTunRows whenever the page is shown or
        // a stepper fires so no row ever shows a stale value)
        readonly System.Collections.Generic.Dictionary<string, Text> tunRowValues =
            new System.Collections.Generic.Dictionary<string, Text>();

        Texture2D mmTex;
        Color32[] mmBase;
        Color32[] mmWork;
        int mmTick;    // minimap refresh throttle counter

        // character pick on the start screen — applied to data.Player and
        // the on-foot mesh when "Start driving" is pressed
        int pendingSkin;
        Color pendingShirt = Cfg.Hex("#ffb224");
        Image[] skinSwatches;
        Image[] shirtSwatches;
        static readonly Color[] ShirtChoices =
        {
            Cfg.Hex("#ffb224"), Cfg.Hex("#5b8bd0"), Cfg.Hex("#7fae6a"), Cfg.Hex("#9a6bbf")
        };

        static Color Amber { get { return Cfg.Hex("#ffb224"); } }

        // The controls list, shared by the start overlay (FIRST 5 LINES ONLY
        // — its layout budget predates the extra rows: more lines at 26px
        // spacing would collide with the start button at y=-150) and the
        // pause menu's Controls page (full list, its own budget). The
        // (text, color) pairs carry the amber/red accents the old index
        // checks encoded.
        public static readonly (string text, Color color)[] ControlLines =
        {
            ("W A S D  /  arrows \u2014 walk & drive", new Color(1f, 1f, 1f, 0.75f)),
            ("E \u2014 enter / exit a car", new Color(1f, 1f, 1f, 0.75f)),
            ("SPACE \u2014 handbrake", new Color(1f, 1f, 1f, 0.75f)),
            ("\u25cf  collect the amber packages", Amber),
            ("\u2605  don't run over the locals", Cfg.Hex("#ff5252")),
            ("F / LMB \u2014 fire  \u00b7  Q \u2014 swap gun", new Color(1f, 1f, 1f, 0.75f)),
            ("ESC / P \u2014 pause menu", new Color(1f, 1f, 1f, 0.75f)),
        };
        const int StartOverlayLines = 5;   // today's exact start-overlay layout
        public const string GamepadHint = "gamepad: stick steers  |  A handbrake  |  X enter/exit  |  RB fire  |  Y swap gun  |  Start/Back pause";

        public void Init(GameData d)
        {
            data = d;
            SpriteKit.Init();
            BuildMinimapBase();
            BuildUi();
        }

        /* -------------------------------------------------- ui factory */

        static RectTransform Rt(GameObject go) { return (RectTransform)go.transform; }

        static GameObject UiImage(string name, Transform parent, Color c)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var img = go.AddComponent<Image>();
            img.color = c;
            img.raycastTarget = false;
            return go;
        }

        static Text UiText(string name, Transform parent, string s, int size, Color c, TextAnchor anchor)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var t = go.AddComponent<Text>();
            t.font = SpriteKit.GameFont();
            t.text = s;
            t.fontSize = size;
            t.color = c;
            t.alignment = anchor;
            t.horizontalOverflow = HorizontalWrapMode.Overflow;
            t.verticalOverflow = VerticalWrapMode.Overflow;
            t.raycastTarget = false;
            return t;
        }

        void BuildUi()
        {
            // uGUI buttons only receive clicks through an EventSystem, and the
            // shipped scene is intentionally empty — so make one here.
            if (EventSystem.current == null)
            {
                var esGo = new GameObject("EventSystem");
                esGo.transform.SetParent(transform, false);
                esGo.AddComponent<EventSystem>();
                esGo.AddComponent<StandaloneInputModule>();
            }

            var canvasGo = new GameObject("HUD Canvas");
            canvasGo.transform.SetParent(transform, false);
            var canvas = canvasGo.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvas.sortingOrder = 100;
            canvasGo.AddComponent<CanvasScaler>();
            canvasGo.AddComponent<GraphicRaycaster>();
            var root = canvasGo.transform;

            // (the 2D version drew a screen vignette here; in the 3D chase view
            // it read as a dark smear sliding along the road, so it is gone)

            // wanted stars
            for (int i = 0; i < 5; i++)
            {
                stars[i] = UiText("star" + i, root, "\u2605", 18, Color.white, TextAnchor.UpperLeft);
                TopLeft(Rt(stars[i].gameObject), 16 + i * 22, 12);
            }
            scoreText = UiText("score", root, "", 13, Cfg.Hex("#e9edf4"), TextAnchor.UpperLeft);
            TopLeft(Rt(scoreText.gameObject), 16, 40);
            // F19 slice: live style-combo readout (×2/×3/×4) — amber like the
            // score, hidden except while a combo window is open.
            comboText = UiText("combo", root, "", 13, Amber, TextAnchor.UpperLeft);
            comboText.fontStyle = FontStyle.Bold;
            TopLeft(Rt(comboText.gameObject), 16, 22);
            comboText.gameObject.SetActive(false);
            speedText = UiText("speed", root, "", 13, Cfg.Hex("#e9edf4"), TextAnchor.UpperLeft);
            TopLeft(Rt(speedText.gameObject), 16, 58);
            missionText = UiText("mission", root, "", 13, Cfg.Hex("#4fb4ff"), TextAnchor.UpperLeft);
            TopLeft(Rt(missionText.gameObject), 16, 96);
            ammoText = UiText("ammo", root, "", 13, Cfg.Hex("#e05252"), TextAnchor.UpperLeft);
            TopLeft(Rt(ammoText.gameObject), 16, 114);

            // mission compass: top-center bearing arrow + distance readout
            // for the mission kinds that have a map coordinate (driven in
            // Refresh). The arrow glyph rotates to point at the objective;
            // the pair hides entirely when no mission has a target point.
            compassArrow = UiText("compass-arrow", root, "▲", 16, Cfg.Hex("#4fb4ff"), TextAnchor.MiddleCenter);
            var art = Rt(compassArrow.gameObject);
            art.anchorMin = new Vector2(0.5f, 1); art.anchorMax = new Vector2(0.5f, 1); art.pivot = new Vector2(0.5f, 0.5f);
            art.anchoredPosition = new Vector2(0, -56);
            art.sizeDelta = new Vector2(40, 24);
            compassDist = UiText("compass-dist", root, "", 12, Cfg.Hex("#4fb4ff"), TextAnchor.MiddleCenter);
            var drt = Rt(compassDist.gameObject);
            drt.anchorMin = new Vector2(0.5f, 1); drt.anchorMax = new Vector2(0.5f, 1); drt.pivot = new Vector2(0.5f, 0.5f);
            drt.anchoredPosition = new Vector2(0, -76);
            drt.sizeDelta = new Vector2(160, 20);
            compassArrow.gameObject.SetActive(false);
            compassDist.gameObject.SetActive(false);

            // damage bar
            barBack = UiImage("bar-back", root, new Color(1, 1, 1, 0.14f)).GetComponent<Image>();
            TopLeft(Rt(barBack.gameObject), 16, 80);
            Rt(barBack.gameObject).sizeDelta = new Vector2(96, 6);
            var fillGo = UiImage("bar-fill", barBack.transform, Cfg.Hex("#7fae6a"));
            barFill = fillGo.GetComponent<Image>();
            var fr = Rt(fillGo);
            fr.anchorMin = new Vector2(0, 1); fr.anchorMax = new Vector2(0, 1); fr.pivot = new Vector2(0, 1);
            fr.anchoredPosition = Vector2.zero;
            fr.sizeDelta = new Vector2(96, 6);

            // minimap + frame
            mmFrame = UiImage("mm-frame", root, new Color(1, 1, 1, 0.22f)).GetComponent<Image>();
            var mr = Rt(mmFrame.gameObject);
            mr.anchorMin = new Vector2(1, 1); mr.anchorMax = new Vector2(1, 1); mr.pivot = new Vector2(1, 1);
            mr.anchoredPosition = new Vector2(-13, -13);
            mr.sizeDelta = new Vector2(Mm + 2, Mm + 2);
            var mmGo = new GameObject("minimap");
            mmGo.transform.SetParent(mmFrame.transform, false);
            minimap = mmGo.AddComponent<RawImage>();
            minimap.texture = mmTex;
            minimap.raycastTarget = false;
            var mmr = Rt(mmGo);
            mmr.anchorMin = Vector2.zero; mmr.anchorMax = Vector2.zero; mmr.pivot = Vector2.zero;
            mmr.anchoredPosition = new Vector2(1, 1);
            mmr.sizeDelta = new Vector2(Mm, Mm);

            // ticker
            tickerBg = UiImage("ticker-bg", root, new Color(7f / 255f, 9f / 255f, 13f / 255f, 0.72f)).GetComponent<Image>();
            var tr = Rt(tickerBg.gameObject);
            tr.anchorMin = new Vector2(0.5f, 0); tr.anchorMax = new Vector2(0.5f, 0); tr.pivot = new Vector2(0.5f, 0);
            tr.anchoredPosition = new Vector2(0, 16);
            tr.sizeDelta = new Vector2(100, 28);
            ticker = UiText("ticker", tickerBg.transform, "", 13, Cfg.Hex("#ffcf6e"), TextAnchor.MiddleCenter);
            Stretch(Rt(ticker.gameObject));

            // BUSTED overlay
            bustedPanel = UiImage("busted", root, new Color(7f / 255f, 9f / 255f, 13f / 255f, 0.6f));
            Stretch(Rt(bustedPanel));
            var bt = UiText("busted-title", bustedPanel.transform, "BUSTED", 52, Cfg.Hex("#ff5252"), TextAnchor.MiddleCenter);
            bt.fontStyle = FontStyle.Bold;
            var btr = Rt(bt.gameObject);
            btr.anchorMin = new Vector2(0.5f, 0.5f); btr.anchorMax = new Vector2(0.5f, 0.5f);
            btr.anchoredPosition = new Vector2(0, 26); btr.sizeDelta = new Vector2(600, 60);
            var bs = UiText("busted-sub", bustedPanel.transform, "processed locally, released locally", 14, Cfg.Hex("#e9edf4"), TextAnchor.MiddleCenter);
            var bsr = Rt(bs.gameObject);
            bsr.anchorMin = new Vector2(0.5f, 0.5f); bsr.anchorMax = new Vector2(0.5f, 0.5f);
            bsr.anchoredPosition = new Vector2(0, -12); bsr.sizeDelta = new Vector2(600, 20);
            bustedPanel.SetActive(false);

            // touch controls (built only where the device reports touch —
            // desktop builds are untouched): a hold-to-brake button and an
            // enter/exit button feeding the same paths SPACE / E use.
            // Steering/throttle is a left-half drag and firing a right-half
            // touch — see TouchInput in LTA.Player.cs.
            if (Input.touchSupported)
            {
                MakeTouchButton(root, "touch-brake", "BRAKE", new Vector2(-30, 30), true);
                MakeTouchButton(root, "touch-enter", "IN / OUT", new Vector2(-30, 110), false);
            }

            // Pause menu + WASTED overlay, built AFTER the touch buttons so
            // the (raycast-blocking) pause panel covers them while open, and
            // BEFORE the start overlay so the start screen stays topmost in
            // sibling draw order (the two are never visible at the same
            // time — pause only exists once Started).
            BuildPauseOverlay(root);

            BuildStartOverlay(root);
        }

        void BuildStartOverlay(Transform root)
        {
            startPanel = UiImage("start-overlay", root, new Color(7f / 255f, 9f / 255f, 13f / 255f, 0.86f));
            Stretch(Rt(startPanel));
            var p = startPanel.transform;

            var kicker = UiText("kicker", p, "a toy city \u00b7 no network \u00b7 no pixels leave your machine", 13, new Color(1, 1, 1, 0.45f), TextAnchor.MiddleCenter);
            PlaceCenter(kicker, 150);
            var title = UiText("title", p, "Local Theft Auto", 52, Cfg.Hex("#e9edf4"), TextAnchor.MiddleCenter);
            title.fontStyle = FontStyle.Bold;
            PlaceCenter(title, 90);

            // first StartOverlayLines of the shared controls list — the full
            // array (weapons + pause bindings) lives on the pause menu's
            // Controls page; see ControlLines for the layout-collision note
            for (int i = 0; i < StartOverlayLines && i < ControlLines.Length; i++)
            {
                var line = UiText("key" + i, p, ControlLines[i].text, 15, ControlLines[i].color, TextAnchor.MiddleCenter);
                PlaceCenter(line, 10 - i * 26);
            }

            // gamepad hint (the bindings live in LTA.Player.cs — the
            // keyboard list above is unchanged)
            var padHint = UiText("pad-hint", p, GamepadHint, 12, new Color(1, 1, 1, 0.45f), TextAnchor.MiddleCenter);
            PlaceCenter(padHint, -112);

            MakeMenuButton(p, "start-button", "Start driving", -150, StartGame);

            var note = UiText("note", p, "pedestrians respawn \u00b7 the police forgive, eventually", 12, new Color(1, 1, 1, 0.35f), TextAnchor.MiddleCenter);
            PlaceCenter(note, -210);

            BuildCharacterPicker(p);

            if (data.State.HighScore > 0)
            {
                var best = UiText("best", p, "best score " + data.State.HighScore.ToString("D6"), 13, Amber, TextAnchor.MiddleCenter);
                PlaceCenter(best, -240);
            }
        }

        /* --------------------------------------- pause menu + WASTED */

        void BuildPauseOverlay(Transform root)
        {
            // ---- WASTED overlay: mirrors the BUSTED panel verbatim (same
            // dim, same bold 52pt title at y=26, same 14pt subtitle at
            // y=-12, same #ff5252 red) so the two beats read as siblings.
            wastedPanel = UiImage("wasted", root, new Color(7f / 255f, 9f / 255f, 13f / 255f, 0.6f));
            Stretch(Rt(wastedPanel));
            var wt = UiText("wasted-title", wastedPanel.transform, "WASTED", 52, Cfg.Hex("#ff5252"), TextAnchor.MiddleCenter);
            wt.fontStyle = FontStyle.Bold;
            var wtr = Rt(wt.gameObject);
            wtr.anchorMin = new Vector2(0.5f, 0.5f); wtr.anchorMax = new Vector2(0.5f, 0.5f);
            wtr.anchoredPosition = new Vector2(0, 26); wtr.sizeDelta = new Vector2(600, 60);
            var wsub = UiText("wasted-sub", wastedPanel.transform, "locally deceased \u00b7 respawned on the home corner", 14, Cfg.Hex("#e9edf4"), TextAnchor.MiddleCenter);
            var wsr = Rt(wsub.gameObject);
            wsr.anchorMin = new Vector2(0.5f, 0.5f); wsr.anchorMax = new Vector2(0.5f, 0.5f);
            wsr.anchoredPosition = new Vector2(0, -12); wsr.sizeDelta = new Vector2(600, 20);
            wastedPanel.SetActive(false);

            // ---- pause menu: one dim panel with three mutually-exclusive
            // pages toggled by SetActive — simpler z-order reasoning than
            // three overlapping full-screen panels, and back-navigation is
            // one SetActive pair.
            pausePanel = UiImage("pause", root, new Color(7f / 255f, 9f / 255f, 13f / 255f, 0.86f));
            Stretch(Rt(pausePanel));
            // the panel itself must swallow pointer events while open, or
            // clicks/taps would fall through to the touch controls and the
            // city behind (FirePressed's IsPointerOverGameObject guard
            // relies on this too)
            pausePanel.GetComponent<Image>().raycastTarget = true;
            var p = pausePanel.transform;

            var title = UiText("pause-title", p, "PAUSED", 40, Amber, TextAnchor.MiddleCenter);
            title.fontStyle = FontStyle.Bold;
            PlaceCenter(title, 220);

            pageMain = MakePage(p, "page-main");
            pageSettings = MakePage(p, "page-settings");
            pageControls = MakePage(p, "page-controls");
            pageDebug = MakePage(p, "page-debug");
            MakeMenuButton(pageMain.transform, "resume", "RESUME", 60, () => SetPaused(false));
            MakeMenuButton(pageMain.transform, "settings", "SETTINGS", 6, () => ShowPage(MenuPage.Settings));
            MakeMenuButton(pageMain.transform, "controls", "CONTROLS", -48, () => ShowPage(MenuPage.Controls));
            MakeMenuButton(pageMain.transform, "restart", "RESTART", -102, () =>
            {
                if (GameLoop.Active != null) GameLoop.Active.RestartRun();
            });
            MakeMenuButton(pageMain.transform, "quit", "QUIT", -156, QuitToDesktop);

            // F19 slice: lifetime stats/achievements readout under the buttons.
            // Re-read every time the pause menu is shown (see ShowPage) — the
            // values only move while driving, never while the menu is open.
            statsText = UiText("stats", pageMain.transform, "", 12, new Color(1, 1, 1, 0.45f), TextAnchor.MiddleCenter);
            PlaceCenter(statsText, -196);

            // settings page — master volume as −/+ steppers, NOT a Slider:
            // the project has no Selectable plumbing beyond Button, and a
            // Slider needs background/fill/handle RectTransforms that don't
            // exist. 10% steps with a live readout between.
            var volLabel = UiText("vol-label", pageSettings.transform, "MASTER VOLUME", 14, new Color(1, 1, 1, 0.6f), TextAnchor.MiddleCenter);
            PlaceCenter(volLabel, 74);
            var minus = MakeMenuButton(pageSettings.transform, "vol-down", "\u2212", 24, () => StepVolume(-0.1f));
            Rt(minus.gameObject).sizeDelta = new Vector2(44, 44);
            Rt(minus.gameObject).anchoredPosition = new Vector2(-110, 24);
            volumeText = UiText("vol-value", pageSettings.transform, "", 18, Cfg.Hex("#e9edf4"), TextAnchor.MiddleCenter);
            PlaceCenter(volumeText, 24);
            var plus = MakeMenuButton(pageSettings.transform, "vol-up", "+", 24, () => StepVolume(0.1f));
            Rt(plus.gameObject).sizeDelta = new Vector2(44, 44);
            Rt(plus.gameObject).anchoredPosition = new Vector2(110, 24);
            MakeMenuButton(pageSettings.transform, "reset-settings", "RESET TO DEFAULTS", -46, () =>
            {
                SettingsStore.ResetToDefaults();
                RefreshVolumeText();
            });
            MakeMenuButton(pageSettings.transform, "back-settings", "BACK", -106, () => ShowPage(MenuPage.Main));

            // controls page — the FULL shared list (the start overlay shows
            // only its first 5 lines) plus the gamepad hint
            for (int i = 0; i < ControlLines.Length; i++)
            {
                var line = UiText("ctl" + i, pageControls.transform, ControlLines[i].text, 15, ControlLines[i].color, TextAnchor.MiddleCenter);
                PlaceCenter(line, 180 - i * 26);
            }
            var ctlPad = UiText("ctl-pad", pageControls.transform, GamepadHint, 12, new Color(1, 1, 1, 0.45f), TextAnchor.MiddleCenter);
            PlaceCenter(ctlPad, 180 - ControlLines.Length * 26 - 8);
            MakeMenuButton(pageControls.transform, "back-controls", "BACK", -110, () => ShowPage(MenuPage.Main));

            // debug page (T3) — live steppers for the Tun* multipliers +
            // GodMode toggle, so the runtime-tuning fields declared for
            // this have their write-side. Menu entry appears on the main
            // page only under debug builds (see ApplyPage/debug button).
            BuildDebugPage(p);

            pausePanel.SetActive(false);
            ApplyPage();
            RefreshVolumeText();
        }

        static GameObject MakePage(Transform parent, string name)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            Stretch(Rt(go));
            return go;
        }

        // Amber menu button — factored from the start overlay's "Start
        // driving" block so the pause-menu buttons are literally the same
        // widget: same Amber fill, same hover/press ColorBlock, same 220x44
        // size, same bold 16pt #0a0d12 stretched label.
        Button MakeMenuButton(Transform parent, string name, string label, float y, System.Action onClick)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var img = go.AddComponent<Image>();
            img.color = Amber;
            var btn = go.AddComponent<Button>();
            var cb = btn.colors;
            cb.normalColor = Color.white; cb.highlightedColor = new Color(1, 1, 1, 0.9f);
            cb.pressedColor = new Color(1, 1, 1, 0.8f); cb.selectedColor = Color.white;
            btn.colors = cb;
            var r = Rt(go);
            r.anchorMin = new Vector2(0.5f, 0.5f); r.anchorMax = new Vector2(0.5f, 0.5f);
            r.anchoredPosition = new Vector2(0, y);
            r.sizeDelta = new Vector2(220, 44);
            var t = UiText("label", go.transform, label, 16, Cfg.Hex("#0a0d12"), TextAnchor.MiddleCenter);
            t.fontStyle = FontStyle.Bold;
            Stretch(Rt(t.gameObject));
            btn.onClick.AddListener(() => onClick());
            return btn;
        }

        // Called by GameLoop (which owns the Esc/P/gamepad key read) and by
        // the menu's own RESUME button. Key read in GameLoop, panel state
        // here — GameLoop owns the frame, Hud owns pixels.
        public void SetPaused(bool v)
        {
            data.State.Paused = v;
            pausePanel.SetActive(v && data.State.Started);
            if (v)
            {
                // PlayerSys.Step (which polls touches) is skipped while
                // paused — clear the touch layer so a pre-pause drag or a
                // queued IN/OUT tap doesn't survive the menu and fire on
                // resume
                TouchInput.Reset();
                page = MenuPage.Main;
                ApplyPage();
                RefreshVolumeText();
                if (statsText != null) statsText.text = StatsSys.StatsLine();
            }
            else
            {
                // the click/press that closed the menu must not also pull
                // the trigger on the first simulated frame (plan §2.2i)
                PlayerSys.SwallowFireFrame = true;
            }
        }

        void ShowPage(MenuPage pg)
        {
            page = pg;
            ApplyPage();
        }

        void ApplyPage()
        {
            pageMain.SetActive(page == MenuPage.Main);
            pageSettings.SetActive(page == MenuPage.Settings);
            pageControls.SetActive(page == MenuPage.Controls);
            pageDebug.SetActive(page == MenuPage.Debug);
            if (page == MenuPage.Debug) RefreshTunRows();
        }

        void StepVolume(float delta)
        {
            // snap to whole 10% steps so repeated presses can't drift;
            // GameLoop applies AudioListener.volume every frame, so the
            // change is audible immediately
            SettingsStore.MasterVolume = Mathf.Round((SettingsStore.MasterVolume + delta) * 10f) / 10f;
            RefreshVolumeText();
        }

        void RefreshVolumeText()
        {
            if (volumeText != null)
                volumeText.text = Mathf.RoundToInt(SettingsStore.MasterVolume * 100f) + "%";
        }

        /* -------------------------------------------------------- T3: debug page */

        // The write-side for the Tun*/GodMode fields declared in GameState
        // (their read sites already live in PlayerSys.Step / LawStep /
        // WeatherStep / UpdateWorldFX). Same −/+ stepper pattern as master
        // volume — 10% steps, live readout, no new widget types. Values are
        // clamped defensively: TunCopSpawnInterval lives on the same
        // hats, so keep every multiplier in [0.1, 3].
        const float TunStep = 0.1f;

        GameObject debugButton;   // main-page entry, active only in debug builds
        int sbSpawnBody = -1;     // T19: last body type the spawn button made

        void BuildDebugPage(Transform p)
        {
            var label = UiText("debug-title", pageDebug.transform, "DEBUG TUNING", 26, Amber, TextAnchor.MiddleCenter);
            label.fontStyle = FontStyle.Bold;
            PlaceCenter(label, 200);

            TunRow(pageDebug.transform, "tun-accel", "accel", () => data.State.TunAccel,
                   v => data.State.TunAccel = Mathf.Clamp(v, 0.1f, 3f));
            TunRow(pageDebug.transform, "tun-top", "top speed", () => data.State.TunTopSpeed,
                   v => data.State.TunTopSpeed = Mathf.Clamp(v, 0.1f, 3f));
            TunRow(pageDebug.transform, "tun-grip", "grip", () => data.State.TunGrip,
                   v => data.State.TunGrip = Mathf.Clamp(v, 0.1f, 3f));
            TunRow(pageDebug.transform, "tun-cop", "cop spawn", () => data.State.TunCopSpawnInterval,
                   v => data.State.TunCopSpawnInterval = Mathf.Clamp(v, 0.1f, 3f));

            // day-of-time override: 10% steps over [0,1], walked from −1 by
            // first pressing − (−1 sentinel = follow the clock)
            TunRow(pageDebug.transform, "tun-day", "day amount", () =>
                       data.State.TunDayOverride < 0f ? -1f : Mathf.Round(data.State.TunDayOverride * 10f) / 10f,
                   v => data.State.TunDayOverride = Mathf.Clamp(v, -1f, 1f));

            // weather pin: cycles Auto → Clear → Rain → Fog → Auto (values −1/0/1/2)
            MakeDebugButton(pageDebug.transform, "tun-weather", "weather: auto", 24, () =>
            {
                var s = data.State;
                s.TunForceWeather = (s.TunForceWeather + 2) % 4 - 1;   // −1 → 0 → 1 → 2 → −1
                RefreshTunRows();
            });

            MakeDebugButton(pageDebug.transform, "tun-god", "god mode: off", -46, () =>
            {
                data.State.GodMode = !data.State.GodMode;
                RefreshTunRows();
            });

            // ---- T19: sandbox cheats ----
            // teleport to the nearest garage tile — instant, works on foot
            // or in a car (an in-car teleport brings the car along)
            MakeDebugButton(pageDebug.transform, "sb-tp-garage", "TP: nearest garage", -146, () =>
            {
                var s = data.State;
                var p = data.Player;
                int baseTx = Mathf.FloorToInt(p.X / Cfg.Tile);
                int baseTy = Mathf.FloorToInt(p.Y / Cfg.Tile);
                for (int ring = 1; ring <= 24; ring++)
                for (int bx = -ring; bx <= ring; bx++)
                for (int by = -ring; by <= ring; by++)
                {
                    if (Mathf.Max(Mathf.Abs(bx), Mathf.Abs(by)) != ring) continue;   // ring sweep: nearest first
                    int tx = (baseTx / Cfg.BlockTiles + bx) * Cfg.BlockTiles + 3;
                    int ty = (baseTy / Cfg.BlockTiles + by) * Cfg.BlockTiles + 3;
                    if (!CityMap.IsGarage(tx, ty) && !CityMap.IsGarage(tx, ty - Cfg.BlockTiles + 9)
                        && !CityMap.IsGarage(tx - Cfg.BlockTiles + 3, ty)) continue;
                    // land on the ROAD beside the garage corner, not inside it
                    var c = CityMap.TileCenter(new Vector2Int(tx, ty));
                    float nx = c.x + Cfg.Tile / 2f, ny = c.y;
                    if (p.InCar != null) { p.InCar.X = nx; p.InCar.Y = ny; p.InCar.Speed = 0f; p.InCar.Vx = p.InCar.Vy = 0f; }
                    p.X = nx; p.Y = ny;
                    s.Say("Teleported to the nearest garage.");
                    return;
                }
                s.Say("No garage found nearby.");
            });

            // time skip: jump the game clock +6h so day/night and the
            // weather clock can be inspected without waiting
            MakeDebugButton(pageDebug.transform, "sb-skip-time", "SKIP +6 HOURS", -192, () =>
            {
                var s = data.State;
                s.Time += Cfg.DayLength / 4.0;
                s.NextWeatherAt = s.Time + 5.0;   // let weather re-roll soon after the jump
                s.Say("Time skips. The light changes.");
            });

            // spawn one drivable car of the next body type right beside the
            // player (parked) — cycles sedan → hatch → van → bike → sedan
            MakeDebugButton(pageDebug.transform, "sb-spawn", "SPAWN NEXT BODY", -238, () =>
            {
                var s = data.State;
                sbSpawnBody = (sbSpawnBody + 1) % 4;
                CarEnt c = Systems.MakeCar(
                    data.Player.X + 40f, data.Player.Y + 40f, 0, true);
                for (int i = 0; i < 64 && c.BodyType != sbSpawnBody; i++)
                    c.Seed = UnityEngine.Random.Range(0, int.MaxValue);
                c.Color = Cfg.CarPaints[UnityEngine.Random.Range(0, Cfg.CarPaints.Length)];
                data.Cars.Add(c);
                s.Say("Spawned a " + new[] { "sedan", "hatch", "van", "bike" }[sbSpawnBody] + ". Parked, yours to take.");
            });

            MakeDebugButton(pageDebug.transform, "reset-tun", "RESET NEUTRAL", -284, () =>
            {
                var s = data.State;
                s.TunAccel = s.TunTopSpeed = s.TunGrip = 1f;
                s.TunCopSpawnInterval = 1.5f;
                s.TunForceWeather = -1;
                s.TunDayOverride = -1f;
                s.GodMode = false;
                RefreshTunRows();
            });
            MakeDebugButton(pageDebug.transform, "back-debug", "BACK", -330, () => ShowPage(MenuPage.Main));

            // main-page entry. In non-debug builds the button exists but
            // stays inactive — cheap to keep, honest to hide.
            debugButton = MakeMenuButton(pageMain.transform, "debug", "DEBUG", -210, () => ShowPage(MenuPage.Debug)).gameObject;
        }

        // one label + −/+ steppers + live readout row; the value getter is a
        // Func so RefreshTunRows can re-read the live state each refresh
        void TunRow(Transform parent, string name, string what, System.Func<float> get, System.Action<float> set)
        {
            var label = UiText(name + "-label", parent, what, 14, new Color(1, 1, 1, 0.6f), TextAnchor.MiddleLeft);
            var lr = Rt(label.gameObject);
            lr.anchorMin = new Vector2(0.5f, 0.5f); lr.anchorMax = new Vector2(0.5f, 0.5f);
            lr.anchoredPosition = new Vector2(-160, 130 - tunRowValues.Count * 36);
            lr.sizeDelta = new Vector2(140, 20);

            var minusB = MakeDebugButton(parent, name + "-down", "\u2212", 130 - tunRowValues.Count * 36, () =>
            {
                set(Mathf.Round((get() - TunStep) * 100f) / 100f);
                RefreshTunRows();
            });
            Rt(minusB.gameObject).sizeDelta = new Vector2(36, 32);
            Rt(minusB.gameObject).anchoredPosition = new Vector2(-30, 130 - tunRowValues.Count * 36);

            var val = UiText(name + "-val", parent, "", 15, Cfg.Hex("#e9edf4"), TextAnchor.MiddleCenter);
            var vr = Rt(val.gameObject);
            vr.anchorMin = new Vector2(0.5f, 0.5f); vr.anchorMax = new Vector2(0.5f, 0.5f);
            vr.anchoredPosition = new Vector2(50, 130 - tunRowValues.Count * 36);
            vr.sizeDelta = new Vector2(70, 20);
            tunRowValues[name] = val;

            var plusB = MakeDebugButton(parent, name + "-up", "+", 130 - tunRowValues.Count * 36, () =>
            {
                set(Mathf.Round((get() + TunStep) * 100f) / 100f);
                RefreshTunRows();
            });
            Rt(plusB.gameObject).sizeDelta = new Vector2(36, 32);
            Rt(plusB.gameObject).anchoredPosition = new Vector2(140, 130 - tunRowValues.Count * 36);
        }

        // same Amber widget as MakeMenuButton but wider (the labels are long)
        // and with the readout refresh folded in: a stepper press and its
        // readout update land in the same frame, no observer plumbing.
        Button MakeDebugButton(Transform parent, string name, string label, float y, System.Action onClick)
        {
            var btn = MakeMenuButton(parent, name, label, y, onClick);
            Rt(btn.gameObject).sizeDelta = new Vector2(260, 36);
            var t = Rt(btn.gameObject).GetComponentInChildren<Text>();
            t.fontSize = 14;
            return btn;
        }

        void RefreshTunRows()
        {
            if (pageDebug == null) return;
            var s = data.State;
            SetRow("tun-accel", s.TunAccel == 1f ? "1.0 (neutral)" : s.TunAccel.ToString("0.00"));
            SetRow("tun-top", s.TunTopSpeed == 1f ? "1.0 (neutral)" : s.TunTopSpeed.ToString("0.00"));
            SetRow("tun-grip", s.TunGrip == 1f ? "1.0 (neutral)" : s.TunGrip.ToString("0.00"));
            SetRow("tun-cop", s.TunCopSpawnInterval.ToString("0.0") + "s");
            SetRow("tun-day", s.TunDayOverride < 0f ? "auto" : Mathf.Round(s.TunDayOverride * 10f) / 10f + "");
            SetRow("tun-weather", s.TunForceWeather < 0 ? "weather: auto"
                        : (s.TunForceWeather == 0 ? "weather: clear"
                          : s.TunForceWeather == 1 ? "weather: rain" : "weather: fog"));
            SetRow("tun-god", s.GodMode ? "god mode: ON" : "god mode: off");
        }

        void SetRow(string key, string text)
        {
            Text t;
            if (tunRowValues.TryGetValue(key, out t) && t != null) t.text = text;
        }

        static void QuitToDesktop()
        {
            // Application.Quit() is a no-op in the editor and would read as
            // a dead button — stop play mode there instead.
#if UNITY_EDITOR
            UnityEditor.EditorApplication.isPlaying = false;
#else
            Application.Quit();
#endif
        }

        void BuildCharacterPicker(Transform p)
        {
            var label = UiText("look-label", p, "pick a look", 12, new Color(1, 1, 1, 0.5f), TextAnchor.MiddleCenter);
            PlaceCenter(label, -270);

            skinSwatches = new Image[Cfg.Skins.Length];
            for (int i = 0; i < Cfg.Skins.Length; i++)
            {
                int idx = i;
                var sw = MakeSwatch(p, "skin" + i, Cfg.Skins[i], -70 + i * 30, -292);
                skinSwatches[i] = sw.GetComponent<Image>();
                sw.GetComponent<Button>().onClick.AddListener(() => { pendingSkin = idx; RefreshPickerHighlight(); });
            }
            shirtSwatches = new Image[ShirtChoices.Length];
            for (int i = 0; i < ShirtChoices.Length; i++)
            {
                int idx = i;
                var sw = MakeSwatch(p, "shirt" + i, ShirtChoices[i], 20 + i * 30, -292);
                shirtSwatches[i] = sw.GetComponent<Image>();
                sw.GetComponent<Button>().onClick.AddListener(() => { pendingShirt = ShirtChoices[idx]; RefreshPickerHighlight(); });
            }
            RefreshPickerHighlight();
        }

        GameObject MakeSwatch(Transform parent, string name, Color c, float x, float y)
        {
            var go = UiImage(name, parent, c);
            go.GetComponent<Image>().raycastTarget = true;
            var btn = go.AddComponent<Button>();
            var r = Rt(go);
            r.anchorMin = new Vector2(0.5f, 0.5f); r.anchorMax = new Vector2(0.5f, 0.5f);
            r.anchoredPosition = new Vector2(x, y);
            r.sizeDelta = new Vector2(22, 22);
            return go;
        }

        void RefreshPickerHighlight()
        {
            if (skinSwatches == null) return;
            for (int i = 0; i < skinSwatches.Length; i++)
                skinSwatches[i].transform.localScale = i == pendingSkin ? Vector3.one * 1.35f : Vector3.one;
            for (int i = 0; i < shirtSwatches.Length; i++)
                shirtSwatches[i].transform.localScale = ShirtChoices[i] == pendingShirt ? Vector3.one * 1.35f : Vector3.one;
        }

        void MakeTouchButton(Transform root, string name, string label, Vector2 pos, bool hold)
        {
            var go = new GameObject(name);
            go.transform.SetParent(root, false);
            var img = go.AddComponent<Image>();
            img.color = new Color(1f, 1f, 1f, 0.18f);
            img.raycastTarget = true;
            var r = Rt(go);
            r.anchorMin = new Vector2(1, 0); r.anchorMax = new Vector2(1, 0); r.pivot = new Vector2(1, 0);
            r.anchoredPosition = pos;
            r.sizeDelta = new Vector2(120, 64);
            var t = UiText("label", go.transform, label, 15, new Color(1, 1, 1, 0.8f), TextAnchor.MiddleCenter);
            Stretch(Rt(t.gameObject));
            if (hold)
            {
                var hb = go.AddComponent<HoldButton>();
                hb.OnHold = v => TouchInput.Handbrake = v;
            }
            else
            {
                var btn = go.AddComponent<Button>();
                btn.onClick.AddListener(() => TouchInput.EnterExitQueued = true);
            }
        }

        // touch-only handbrake: a Button onClick cannot express "held down",
        // so this takes the pointer down/up directly and writes TouchInput.
        class HoldButton : MonoBehaviour, IPointerDownHandler, IPointerUpHandler
        {
            public System.Action<bool> OnHold;
            public void OnPointerDown(PointerEventData e) { if (OnHold != null) OnHold(true); }
            public void OnPointerUp(PointerEventData e) { if (OnHold != null) OnHold(false); }
        }

        void StartGame()
        {
            if (data.State.Started) return;
            data.State.Started = true;
            data.Player.SkinIndex = pendingSkin;
            data.Player.ShirtColor = pendingShirt;
            if (GameLoop.Active != null) GameLoop.Active.RetintPlayer();
            startPanel.SetActive(false);
            data.State.Say("Find a car and press E \u2014 or walk. Watch for witnesses.");
        }

        static void Stretch(RectTransform r)
        {
            r.anchorMin = Vector2.zero; r.anchorMax = Vector2.one;
            r.offsetMin = Vector2.zero; r.offsetMax = Vector2.zero;
        }

        static void TopLeft(RectTransform r, float x, float y)
        {
            r.anchorMin = new Vector2(0, 1); r.anchorMax = new Vector2(0, 1);
            r.pivot = new Vector2(0, 1);
            r.anchoredPosition = new Vector2(x, -y);
            r.sizeDelta = new Vector2(400, 24);
        }

        static void PlaceCenter(Text t, float yOffset)
        {
            var r = Rt(t.gameObject);
            r.anchorMin = new Vector2(0.5f, 0.5f); r.anchorMax = new Vector2(0.5f, 0.5f);
            r.anchoredPosition = new Vector2(0, yOffset);
            r.sizeDelta = new Vector2(900, 26);
        }

        /* ----------------------------------------------------- minimap */

        void BuildMinimapBase()
        {
            mmTex = new Texture2D(Mm, Mm, TextureFormat.RGBA32, false);
            mmTex.filterMode = FilterMode.Point;
            mmTex.wrapMode = TextureWrapMode.Clamp;
            float s = Mm / (float)Cfg.World;
            var px = new Color32[Mm * Mm];
            var bg = new Color(10f / 255f, 13f / 255f, 18f / 255f, 0.9f);
            var road = Cfg.Hex("#39414f");
            var park = Cfg.Hex("#20361f");
            var water = Cfg.Hex("#123a52");
            for (int y = 0; y < Mm; y++)
                for (int x = 0; x < Mm; x++)
                    px[y * Mm + x] = bg;
            for (int ty = 0; ty < Cfg.World; ty++)
            {
                for (int tx = 0; tx < Cfg.World; tx++)
                {
                    int t = CityMap.TileType(tx, ty);
                    if (t != Cfg.Road && t != Cfg.Park && t != Cfg.Water) continue;
                    Color c = t == Cfg.Road ? road : t == Cfg.Park ? park : water;
                    int x0 = Mathf.FloorToInt(tx * s), y0 = Mathf.FloorToInt(ty * s);
                    int w = Mathf.CeilToInt(s), h = Mathf.CeilToInt(s);
                    for (int y = y0; y < y0 + h && y < Mm; y++)
                        for (int x = x0; x < x0 + w && x < Mm; x++)
                            if (x >= 0 && y >= 0) px[y * Mm + x] = c;
                }
            }
            mmBase = px;
            mmWork = new Color32[Mm * Mm];
            mmTex.SetPixels32(px);
            // keep the minimap readable: it is rewritten every frame
            mmTex.Apply(false, false);
        }

        void RefreshMinimap()
        {
            System.Array.Copy(mmBase, mmWork, mmBase.Length);
            float s = Mm / (float)Cfg.World;

            for (int i = 0; i < data.Packages.Count; i++)
                Blit(data.Packages[i].X / Cfg.Tile * s, data.Packages[i].Y / Cfg.Tile * s, 3, Amber);
            for (int i = 0; i < data.Cops.Count; i++)
                Blit(data.Cops[i].X / Cfg.Tile * s, data.Cops[i].Y / Cfg.Tile * s, 4, Cfg.Hex("#ff5252"));
            // Slice 2: the mission blip tracks the live target (ram car / VIP),
                // same dispatch as the compass and world marker.
                Vector2 mmTarget;
                if (MissionSys.MissionTarget(data, out mmTarget))
                    Blit(mmTarget.x / Cfg.Tile * s, mmTarget.y / Cfg.Tile * s, 4, Cfg.Hex("#4fb4ff"));

            // player arrow: a 3px body plus one pixel ahead
            float px = data.Player.X / Cfg.Tile * s;
            float py = data.Player.Y / Cfg.Tile * s;
            Blit(px, py, 3, Color.white);
            Blit(px + Mathf.Cos(data.Player.A) * 3f, py + Mathf.Sin(data.Player.A) * 3f, 2, Color.white);

            mmTex.SetPixels32(mmWork);
            // keep the minimap readable: it is rewritten every frame
            mmTex.Apply(false, false);
        }

        void Blit(float fx, float fy, int size, Color c)
        {
            int x0 = Mathf.RoundToInt(fx - size / 2f);
            int y0 = Mathf.RoundToInt(Mm - fy - size / 2f - 1); // minimap is drawn y-up on screen
            for (int y = y0; y < y0 + size; y++)
                for (int x = x0; x < x0 + size; x++)
                    if ((uint)x < (uint)Mm && (uint)y < (uint)Mm)
                        mmWork[y * Mm + x] = c;
        }

        /* ------------------------------------------------------ refresh */

        public void Refresh()
        {
            var s = data.State;
            var p = data.Player;

            // keyboard fallback for the start overlay
            if (!s.Started && (Input.GetKeyDown(KeyCode.Return) || Input.GetKeyDown(KeyCode.Space)
                || Input.GetKeyDown(KeyCode.JoystickButton0)))
                StartGame();

            // the game can also be started programmatically (dev screenshot
            // mode sets Started before the HUD exists) — keep the overlay honest
            if (s.Started && startPanel.activeSelf) startPanel.SetActive(false);

            // F19 slice: live style-combo readout. Decay is sim-time based, so
            // the ×N badge lives while the combo window (4s) is open and fades
            // out on its own — no extra timer plumbing needed.
            int mult = StatsSys.ComboMult;
            comboText.gameObject.SetActive(s.Started && mult > 1);
            if (mult > 1) comboText.text = "\u00d7" + mult + " style";

            for (int i = 0; i < 5; i++)
                stars[i].color = i < s.Wanted ? Amber : new Color(1, 1, 1, 0.16f);

            scoreText.text = s.HighScore > 0
                ? "SCORE " + s.Score.ToString("D6") + "  \u00b7  BEST " + s.HighScore.ToString("D6")
                : "SCORE " + s.Score.ToString("D6");

            if (s.MissionOn)
            {
                int left = Mathf.Max(0, Mathf.CeilToInt((float)(s.MissionEnds - s.Time)));
                string label;
                switch (s.MissionKind)
                {
                    case MissionKind.Rampage:
                        label = "RAMPAGE " + s.RampageCount + "/" + s.RampageGoal;
                        break;
                    case MissionKind.Steal:
                        label = "STEAL & DELIVER";
                        break;
                    case MissionKind.GangWar:
                        label = Cfg.GangNames[s.GangWarGang].ToUpper() + " DOWN "
                            + s.GangWarCount + "/" + s.GangWarGoal;
                        break;
                    case MissionKind.Circuit:
                        label = "CIRCUIT " + s.CircuitIndex + "/"
                            + (s.CircuitCps != null ? s.CircuitCps.Count : 0);
                        break;
                    case MissionKind.Ram:
                        label = "WRECK THE MARKED CAR";
                        break;
                    case MissionKind.Escort:
                        label = s.VipFollowing ? "ESCORT TO THE MARKER" : "PICK UP THE VIP";
                        break;
                    default:
                        label = "DELIVERY";
                        break;
                }
                missionText.text = label + "  +" + s.MissionReward + "  \u00b7  " + left + "s";
                // gang-war contracts wear the targeted crew's color
                missionText.color = left <= 5 ? Cfg.Hex("#ff5252")
                    : s.MissionKind == MissionKind.GangWar ? Cfg.GangColors[s.GangWarGang]
                    : Cfg.Hex("#4fb4ff");
            }
            else missionText.text = "";

            // mission compass: bearing arrow + distance for every kind that has a
            // pointable target (Slice 2: MissionTarget is the single
            // dispatch, same contract as SyncMission's world marker —
            // Rampage/GangWar have no fixed point). Bearing is measured
            // against the ACTUAL chase-camera yaw (GameLoop.CamYaw), not the
            // player heading: the camera lags through swings and the arrow
            // must match the screen, not the sim.
            Vector2 compassTarget;
            bool compass = MissionSys.MissionTarget(data, out compassTarget);
            compassArrow.gameObject.SetActive(compass);
            compassDist.gameObject.SetActive(compass);
            if (compass)
            {
                float mdx = compassTarget.x - p.X, mdy = compassTarget.y - p.Y;
                float mlen = Mathf.Sqrt(mdx * mdx + mdy * mdy);
                // JS plane -> Unity XZ (z = -jsY); signed angle from the
                // camera forward, positive = screen right (Unity yaw is
                // clockwise seen from above). uGUI Z rotation runs the other
                // way, so the up-pointing glyph is turned by -theta.
                float yawRad = (GameLoop.Active != null ? GameLoop.Active.CamYaw : 90f) * Mathf.Deg2Rad;
                float fwdX = Mathf.Sin(yawRad), fwdZ = Mathf.Cos(yawRad);
                float ux = mdx, uz = -mdy;
                if (mlen > 0.001f) { ux /= mlen; uz /= mlen; }
                float theta = Mathf.Atan2(fwdZ * ux - fwdX * uz, fwdX * ux + fwdZ * uz);
                compassArrow.transform.localEulerAngles = new Vector3(0f, 0f, -theta * Mathf.Rad2Deg);
                // same px->display conversion (x0.5) the speed readout uses
                compassDist.text = Mathf.RoundToInt(mlen * 0.5f) + " m";
                compassArrow.color = missionText.color;
                compassDist.color = missionText.color;
            }

            // gang wars: name the gun in hand, and hint the swap key once
            // the player owns more than one
            if (p.Weapon != WeaponKind.None)
            {
                string name = p.Weapon == WeaponKind.Smg ? "SMG"
                    : p.Weapon == WeaponKind.Shotgun ? "SHOTGUN" : "PISTOL";
                int owned = (p.OwnsPistol ? 1 : 0) + (p.OwnsSmg ? 1 : 0) + (p.OwnsShotgun ? 1 : 0);
                ammoText.text = name + "  AMMO " + p.Ammo + (owned > 1 ? "  [Q]" : "");
            }
            else ammoText.text = "";

            // the health bar now shows on foot too: gang vendettas and stray
            // rounds chip PlayerState.Health out of the car (gunfire can even
            // waste you), and that damage was invisible until you got back
            // behind the wheel. Gated on Started so it stays off the start
            // overlay, same as before.
            barBack.gameObject.SetActive(s.Started);
            barFill.color = p.Health > 40f ? Cfg.Hex("#7fae6a") : Cfg.Hex("#ff5252");
            ((RectTransform)barFill.transform).sizeDelta = new Vector2(96f * p.Health / 100f, 6f);

            if (p.InCar != null)
            {
                speedText.color = Cfg.Hex("#e9edf4");
                speedText.text = Mathf.Abs(Mathf.RoundToInt(p.InCar.Speed * 0.5f)) + " km/h";
            }
            else
            {
                speedText.color = new Color(233f / 255f, 237f / 255f, 244f / 255f, 0.5f);
                speedText.text = "on foot \u2014 E near a car";
            }

            // rewriting a 150x150 texture every frame is wasted work for a
            // radar; ~10 Hz is indistinguishable and much cheaper
            if (mmTick++ % 6 == 0) RefreshMinimap();

            bool showTicker = s.Time < s.TickerUntil;
            tickerBg.gameObject.SetActive(showTicker);
            if (showTicker)
            {
                ticker.text = s.TickerMsg;
                float w = ticker.preferredWidth + 32f;
                ((RectTransform)tickerBg.transform).sizeDelta = new Vector2(w, 28f);
            }

            bustedPanel.SetActive(s.Busted > 0f);
            wastedPanel.SetActive(s.Wasted > 0f);
            // the pause can also be flipped while this Refresh isn't looking
            // — keep the panel honest, same defensive pattern as the start
            // overlay above
            if (s.Paused && !pausePanel.activeSelf) pausePanel.SetActive(s.Started);
        }
    }
}
