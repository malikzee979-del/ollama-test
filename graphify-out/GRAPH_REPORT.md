# Graph Report - ollama-project  (2026-10-05)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2070 nodes · 4224 edges · 111 communities (83 shown, 28 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 153 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d9568725`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 69
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 102

## God Nodes (most connected - your core abstractions)
1. `GameData` - 71 edges
2. `GameLoop` - 71 edges
3. `MeshKit` - 57 edges
4. `Hud` - 43 edges
5. `CityRenderer` - 40 edges
6. `frame()` - 38 edges
7. `Systems` - 36 edges
8. `say()` - 32 edges
9. `chat_page()` - 31 edges
10. `AppState` - 28 edges

## Surprising Connections (you probably didn't know these)
- `signup()` --uses--> `AuthError`  [INFERRED]
  python_app/app/api.py → python_app/app/auth_store.py
- `login()` --uses--> `RateLimitExceeded`  [INFERRED]
  python_app/app/api.py → python_app/app/rate_limit.py
- `signup()` --uses--> `RateLimitExceeded`  [INFERRED]
  python_app/app/api.py → python_app/app/rate_limit.py
- `wWinMain()` --calls--> `CreateAndAttachConsole()`  [INFERRED]
  mobile/windows/runner/main.cpp → mobile/windows/runner/utils.cpp
- `build` --references--> `AppState`  [EXTRACTED]
  mobile/lib/main.dart → mobile/lib/app_state.dart

## Import Cycles
- None detected.

## Communities (111 total, 28 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (9): CityRenderer, LampPole, PBuf, JSRng, MB, MeshKit, CarPaint, Emissive (+1 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (85): App(), fontAssets, Root(), Stack, devDependencies, @types/react, typescript, main (+77 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (11): LocalTheftAuto, BuildGame, GangSimTest, PlayGame, PoliceSimTest, SetupURP, SetupURPAssets, GameBootstrap (+3 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (7): HoldButton, Hud, Amber, MenuPage, Controls, Main, Settings

### Community 4 - "Community 4"
Cohesion: 0.10
Nodes (57): apiRequest(), applyTheme(), autoResizeTextarea(), buildAttachmentChip(), buildMessageRow(), bumpSummary(), closeSettings(), createChat() (+49 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (35): accent, accentContrast, accentHover, accentLine, accentSoft, bg, bgElevated, bgElevated2 (+27 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (14): Cocoa, Flutter, FlutterMacOS, Foundation, AppDelegate, SceneDelegate, RunnerTests, RegisterGeneratedPlugins() (+6 more)

### Community 7 - "Community 7"
Cohesion: 0.05
Nodes (37): _activeStreamClient, build, _buildComposer, _buildMessageRow, _buildTranscript, _composerFocused, _controller, createState (+29 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (29): blockHash(), circleHitsBuilding(), copStep(), despawnHeli(), despawnRoadblocks(), dirValid(), district(), drawBlocks() (+21 more)

### Community 9 - "Community 9"
Cohesion: 0.06
Nodes (31): _Avatar, _EmptyMotd, _FactRow, _MessageContent, _ModelRow, _EmptyRegister, _LedgerRow, _StatusRail (+23 more)

### Community 10 - "Community 10"
Cohesion: 0.06
Nodes (31): ApiClient, ApiException, appendMessages, baseUrl, _captureCookie, chatStream, _clearCookie, _cookie (+23 more)

### Community 11 - "Community 11"
Cohesion: 0.15
Nodes (28): chat_page(), build_message_row(), build_ollama_messages(), check_memory_for_selected_model(), clear_chat(), close_settings(), confirm_delete_all(), create_chat() (+20 more)

### Community 13 - "Community 13"
Cohesion: 0.08
Nodes (26): AppState, _hostLabel, _loadAll, _send, _openServerSetup, _openSignup, appState, build (+18 more)

### Community 14 - "Community 14"
Cohesion: 0.07
Nodes (31): com.unity.2d.sprite, com.unity.burst, com.unity.collections, com.unity.ext.nunit, com.unity.mathematics, com.unity.modules.physics, com.unity.modules.physicscore2d, com.unity.modules.terrain (+23 more)

### Community 15 - "Community 15"
Cohesion: 0.15
Nodes (22): _clear_session_cookie(), create_session(), delete_model(), delete_session(), get_current_user(), get_session(), health_check(), _is_valid_message() (+14 more)

### Community 16 - "Community 16"
Cohesion: 0.13
Nodes (27): adb(), adbBuf(), assistantNode, back(), dumpNodes(), failed, find(), hasUserMsg (+19 more)

### Community 17 - "Community 17"
Cohesion: 0.07
Nodes (20): embed(), app, auth, authRateLimiter, { compactMessages, DEFAULTS: COMPACTION_DEFAULTS, MARKER: COMPACTION_MARKER }, crypto, db, embeddings (+12 more)

### Community 18 - "Community 18"
Cohesion: 0.09
Nodes (14): fl_register_plugins(), main(), first_frame_cb(), my_application_activate(), my_application_class_init(), my_application_dispose(), my_application_init(), my_application_local_command_line() (+6 more)

### Community 19 - "Community 19"
Cohesion: 0.10
Nodes (22): CarVisual, Cfg, PackageEnt, PedKind, Civilian, Gangster, ParkGoer, PedVisual (+14 more)

### Community 20 - "Community 20"
Cohesion: 0.07
Nodes (21): assert, auth, { DatabaseSync }, fs, os, path, test, tmpDir (+13 more)

### Community 21 - "Community 21"
Cohesion: 0.12
Nodes (28): audioStep(), drawCar(), drawCarBody(), drawCop(), drawHeli(), drawHUD(), drawLights(), drawLookSwatches() (+20 more)

### Community 22 - "Community 22"
Cohesion: 0.14
Nodes (28): circuitMissionStep(), completeMission(), cycleCops(), cycleShirt(), cycleSkin(), cycleTraffic(), deliveryMissionStep(), escortMissionStep() (+20 more)

### Community 23 - "Community 23"
Cohesion: 0.20
Nodes (4): GameData, ParticleEnt, PedEnt, Systems

### Community 24 - "Community 24"
Cohesion: 0.11
Nodes (4): GameLoop, Active, CamYaw, PkgVis

### Community 25 - "Community 25"
Cohesion: 0.09
Nodes (13): build, main, OllamaChatApp, _Root, build, _buildCard, _busy, createState (+5 more)

### Community 26 - "Community 26"
Cohesion: 0.10
Nodes (5): AuthError, _on_startup(), _prune_sessions_periodically(), login_page(), signup_page()

### Community 27 - "Community 27"
Cohesion: 0.11
Nodes (19): bgfxFrame(), bgfxResize(), bgfxSeed(), bgfxStart(), cdKick(), cdTick(), countUp(), done() (+11 more)

### Community 28 - "Community 28"
Cohesion: 0.13
Nodes (7): SpriteKit, Circle, Cone, Glow, Vignette, White, WhiteTex

### Community 29 - "Community 29"
Cohesion: 0.15
Nodes (16): createUser(), crypto, DATA_DIR, { DatabaseSync }, db, fs, getUserById(), getUserBySessionToken() (+8 more)

### Community 30 - "Community 30"
Cohesion: 0.09
Nodes (21): backgroundColor, backgroundImage, foregroundImage, monochromeImage, adaptiveIcon, package, predictiveBackGestureEnabled, expo (+13 more)

### Community 31 - "Community 31"
Cohesion: 0.10
Nodes (13): _client, init, initializing, isConfigured, isLoggedIn, logout, _prefsThemeKey, setServerUrl (+5 more)

### Community 33 - "Community 33"
Cohesion: 0.12
Nodes (12): assert, helpers, test, assert, embeddings, test, assert, logger (+4 more)

### Community 34 - "Community 34"
Cohesion: 0.11
Nodes (4): FlutterWindow, flutter_controller_, FlutterWindow::FlutterWindow(), project_

### Community 35 - "Community 35"
Cohesion: 0.12
Nodes (19): depth, source, version, dependencies, depth, source, version, dependencies (+11 more)

### Community 36 - "Community 36"
Cohesion: 0.16
Nodes (15): createSession(), crypto, DATA_DIR, deleteSession(), ensureDataDir(), fs, listSessions(), load() (+7 more)

### Community 37 - "Community 37"
Cohesion: 0.18
Nodes (5): Scale(), Win32Window::Win32Window(), WindowClassRegistrar, class_registered_, instance_

### Community 38 - "Community 38"
Cohesion: 0.22
Nodes (7): GameState, MissionKind, Delivery, GangWar, Rampage, Steal, MissionSys

### Community 39 - "Community 39"
Cohesion: 0.14
Nodes (6): get_metrics(), logging_metrics_middleware(), record(), snapshot(), RateLimiter, RateLimitExceeded

### Community 41 - "Community 41"
Cohesion: 0.23
Nodes (9): chat(), delete_model(), health(), list_models(), OllamaError, show_model(), stream_chat(), stream_pull() (+1 more)

### Community 42 - "Community 42"
Cohesion: 0.17
Nodes (16): addEvent(), addSmoke(), awardStyle(), axisInput(), endBust(), panicNear(), playerStep(), pushScoreHash() (+8 more)

### Community 43 - "Community 43"
Cohesion: 0.22
Nodes (9): compact_messages(), _is_marker_message(), _strip_marker(), _total_chars(), error(), _format(), info(), _timestamp() (+1 more)

### Community 44 - "Community 44"
Cohesion: 0.27
Nodes (12): addAssistant(), addError(), addMsg(), addSystem(), addUser(), loadModels(), pin(), setStatus() (+4 more)

### Community 45 - "Community 45"
Cohesion: 0.13
Nodes (14): ChatMessage, ChatSessionFull, ChatSessionSummary, ChatUser, content, fromJson, id, messages (+6 more)

### Community 46 - "Community 46"
Cohesion: 0.14
Nodes (15): dependencies, depth, source, version, depth, dependencies, depth, source (+7 more)

### Community 47 - "Community 47"
Cohesion: 0.13
Nodes (15): dependencies, depth, source, version, dependencies, depth, source, version (+7 more)

### Community 48 - "Community 48"
Cohesion: 0.22
Nodes (9): compactMessages(), DEFAULTS, estimateTokens(), isMarkerMessage(), stripMarker(), totalChars(), assert, { compactMessages, estimateTokens, MARKER, DEFAULTS, CHARS_PER_TOKEN } (+1 more)

### Community 49 - "Community 49"
Cohesion: 0.21
Nodes (6): TrafficSimTest, CarEnt, BodyType, TrafficLights, Spatial, LaneTarget

### Community 50 - "Community 50"
Cohesion: 0.16
Nodes (14): addSparks(), angleDiff(), damageCar(), playTone(), sfxBust(), sfxCrash(), sfxDryClick(), sfxHorn() (+6 more)

### Community 51 - "Community 51"
Cohesion: 0.14
Nodes (10): Point, x, y, Size, height, width, Win32Window, child_content_ (+2 more)

### Community 52 - "Community 52"
Cohesion: 0.21
Nodes (7): ensure_collection(), search_by_vector(), _set_client_for_tests(), upsert_point(), _do(), user_filter(), _with_collection_retry()

### Community 53 - "Community 53"
Cohesion: 0.14
Nodes (9): assert, fake, fs, http, os, path, qdrant, test (+1 more)

### Community 54 - "Community 54"
Cohesion: 0.17
Nodes (11): build, _buildCard, _busy, _confirm, createState, _error, _password, _signup (+3 more)

### Community 56 - "Community 56"
Cohesion: 0.17
Nodes (8): { app, BrowserWindow, shell }, http, path, REPO_ROOT, { spawn }, startServer(), waitForServer(), electron

### Community 57 - "Community 57"
Cohesion: 0.19
Nodes (4): wWinMain(), CreateAndAttachConsole(), GetCommandLineArguments(), Utf8FromUtf16()

### Community 58 - "Community 58"
Cohesion: 0.23
Nodes (10): ChatScreen, _ChatScreenState, _MarchingBlocks, _MarchingBlocksState, LoginScreen, _LoginScreenState, BlockCursor, _BlockCursorState (+2 more)

### Community 59 - "Community 59"
Cohesion: 0.17
Nodes (10): build, _checking, _controller, createState, _error, initState, onSaved, _save (+2 more)

### Community 60 - "Community 60"
Cohesion: 0.15
Nodes (13): dependencies, expo, expo-font, expo-status-bar, @expo/vector-icons, react, react-native, @react-native-async-storage/async-storage (+5 more)

### Community 61 - "Community 61"
Cohesion: 0.15
Nodes (12): description, engines, node, main, name, overrides, undici, type (+4 more)

### Community 62 - "Community 62"
Cohesion: 0.15
Nodes (13): build, appId, directories, files, linux, mac, productName, win (+5 more)

### Community 63 - "Community 63"
Cohesion: 0.21
Nodes (8): ATTACHMENT_EXTENSIONS, attachmentError(), buildOllamaMessages(), ChatHelpers, defaultSettings(), estimateChatTokens(), formatBytes(), normalizeSettings()

### Community 64 - "Community 64"
Cohesion: 0.15
Nodes (9): requestWithHost(), app, assert, fs, os, path, test, text() (+1 more)

### Community 65 - "Community 65"
Cohesion: 0.21
Nodes (10): assert, code, fs, loadGame(), makeCanvas(), makeCtx(), makeTouchBtn(), path (+2 more)

### Community 66 - "Community 66"
Cohesion: 0.17
Nodes (4): deadline, main, timeout, waitFor

### Community 72 - "Community 72"
Cohesion: 0.18
Nodes (10): background_color, description, display, icons, name, orientation, prefer_related_applications, short_name (+2 more)

### Community 73 - "Community 73"
Cohesion: 0.18
Nodes (11): dependencies, depth, source, url, version, dependencies, depth, source (+3 more)

### Community 74 - "Community 74"
Cohesion: 0.18
Nodes (11): dependencies, depth, source, version, dependencies, depth, source, version (+3 more)

### Community 75 - "Community 75"
Cohesion: 0.18
Nodes (11): dependencies, depth, source, version, dependencies, depth, source, version (+3 more)

### Community 78 - "Community 78"
Cohesion: 0.31
Nodes (7): client, ensureCollection(), { QdrantClient }, searchByVector(), upsertPoint(), withCollectionRetry(), @qdrant/js-client-rest

### Community 79 - "Community 79"
Cohesion: 0.24
Nodes (5): assert, notFoundError(), search(), test, upsert()

### Community 81 - "Community 81"
Cohesion: 0.20
Nodes (10): dependencies, depth, source, version, dependencies, depth, source, version (+2 more)

### Community 84 - "Community 84"
Cohesion: 0.90
Nodes (7): drawStreetProps(), evasionStep(), hash2(), isGarage(), isGasStation(), isMart(), isPaintShop()

### Community 85 - "Community 85"
Cohesion: 0.29
Nodes (7): scripts, dev, dist, electron, lint, start, test

### Community 87 - "Community 87"
Cohesion: 0.60
Nodes (5): error(), format(), info(), timestamp(), warn()

### Community 88 - "Community 88"
Cohesion: 0.33
Nodes (3): latencyStats, routeStats, startedAt

### Community 89 - "Community 89"
Cohesion: 0.33
Nodes (6): devDependencies, electron, electron-builder, eslint, @eslint/js, globals

### Community 90 - "Community 90"
Cohesion: 0.60
Nodes (3): LtaSettings, SettingsStore, MasterVolume

### Community 92 - "Community 92"
Cohesion: 0.33
Nodes (6): dependencies, depth, source, version, dependencies, com.unity.2d.sprite

### Community 93 - "Community 93"
Cohesion: 0.33
Nodes (6): dependencies, depth, source, url, version, com.unity.nuget.mono-cecil

### Community 94 - "Community 94"
Cohesion: 0.33
Nodes (6): dependencies, depth, source, url, version, com.unity.searcher

### Community 96 - "Community 96"
Cohesion: 0.40
Nodes (4): compilerOptions, strict, extends, expo/tsconfig.base

### Community 97 - "Community 97"
Cohesion: 0.40
Nodes (5): dependencies, depth, source, version, com.unity.modules.audio

### Community 98 - "Community 98"
Cohesion: 0.50
Nodes (3): globals, @eslint/js, globals

### Community 100 - "Community 100"
Cohesion: 0.67
Nodes (3): dependencies, express, @qdrant/js-client-rest

## Knowledge Gaps
- **543 isolated node(s):** `Props`, `Props`, `Props`, `Props`, `Props` (+538 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 835 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **28 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `GameLoop` connect `Community 24` to `Community 0`, `Community 2`, `Community 3`, `Community 70`, `Community 80`, `Community 19`, `Community 23`, `Community 83`, `Community 55`, `Community 91`, `Community 28`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `GameData` (e.g. with `.Run()` and `.Run()`) actually correct?**
  _`GameData` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Props`, `Props`, `Props` to the rest of the system?**
  _543 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05107794361525705 - nodes in this community are weakly interconnected._
- **Why does `GameData` connect `Community 23` to `Community 0`, `Community 3`, `Community 68`, `Community 69`, `Community 38`, `Community 70`, `Community 12`, `Community 80`, `Community 49`, `Community 19`, `Community 83`, `Community 86`, `Community 24`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.053312008529921365 - nodes in this community are weakly interconnected._
- **Why does `CityRenderer` connect `Community 0` to `Community 2`, `Community 3`, `Community 70`, `Community 19`, `Community 24`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._