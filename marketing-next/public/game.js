/* ==========================================================================
   Local Theft Auto — realism pass.
   Still one canvas, one IIFE, zero network. What got more real:

   City   — merged building blocks with roofs, AC units, neon signs and
            drop shadows; parks with trees; sidewalks with curbs; zebra
            crosswalks; streetlight glow pools; per-tile asphalt variance.
   Cars   — lane-disciplined right-hand traffic that brakes for what's
            ahead and yields to you on foot; headlight cones, tail and
            brake lights; the player car now has drift-on-handbrake
            physics, skid marks, damage, smoke and a wreck state.
   Peds   — walk cycles, skin/shirt variety, and panic: they run from a
            fast car. A pedestrian who watches you steal a parked car
            calls the local police.
   Law    — police pursue with lead prediction under flashing sirens.
   HUD    — wanted stars, score, speed, a damage bar, and a minimap.
   Look   — 2.5D buildings with camera-parallax roofs, worn asphalt and
            sidewalk joints, glowing headlights and neon, exhaust puffs,
            impact shake and a soft vignette.
   ========================================================================== */
(function () {
  "use strict";

  var canvas = document.getElementById("gameCanvas");
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext("2d");
  var overlay = document.getElementById("gameOverlay");
  var startBtn = document.getElementById("gameStart");
  if (!overlay || !startBtn) return;

  /* ---------------------------------------------------------- world map */
  var TILE = 48;
  var WORLD = 96;
  var ROAD = 0, SIDE = 1, BLDG = 2, PARK = 3, WATER = 4;

  /* ------------------------------------------------------------ landmarks */
  // Two fixed, hand-placed anchors on top of the otherwise-repeating 10x10
  // hashed block grid — mental-map landmarks (item 5). Both are expressed
  // as tileType overrides so every consumer (collision, traffic, peds,
  // minimap, spawn placement) gets them "for free" and correctly, instead
  // of needing separate landmark-aware code paths everywhere.
  //
  // River: a fixed 4-tile-wide world column. Only tiles that would
  // otherwise be SIDE/PARK/BLDG turn to WATER — the always-present
  // rx<3||ry<3 through-roads are left untouched, so every block row gives
  // the river a natural bridge for free and the traffic grid (laneTargets,
  // dirValid) never sees a missing road.
  //
  // Stadium: a fixed 2x2-block footprint. Only tiles that would otherwise
  // be PARK/BLDG turn solid (BLDG) — same reasoning, the road grid through
  // that footprint is left alone. drawBlocks renders this block range as a
  // bespoke stadium bowl instead of a generic building (see
  // isStadiumBlock/drawStadiumBlock below).
  //
  // NOTE — Unity parity: unity/LocalTheftAuto/Assets/Scripts/LTA.Core.cs
  // replays tileType's hash functions and 10x10 block rules exactly, but the
  // two engines have deliberately diverged elsewhere: Unity's world is
  // 144x144 tiles (this file is 96x96), its river is a block-row scheme
  // rather than this fixed column, and it has no stadium. The full
  // divergence table lives in unity/LocalTheftAuto/PARITY.md — update it
  // whenever either side changes a shared constant or hashing rule.
  var RIVER_TX_MIN = 46, RIVER_TX_MAX = 49;
  function inRiver(tx) { return tx >= RIVER_TX_MIN && tx <= RIVER_TX_MAX; }
  var STADIUM = { txMin: 60, txMax: 79, tyMin: 10, tyMax: 29 };
  function inStadium(tx, ty) {
    return tx >= STADIUM.txMin && tx <= STADIUM.txMax && ty >= STADIUM.tyMin && ty <= STADIUM.tyMax;
  }
  function isStadiumBlock(bx, by) {
    return bx >= Math.floor(STADIUM.txMin / 10) && bx <= Math.floor(STADIUM.txMax / 10) &&
      by >= Math.floor(STADIUM.tyMin / 10) && by <= Math.floor(STADIUM.tyMax / 10);
  }

  function blockHash(bx, by) {
    var h = (bx * 7 + 1) * 374761393 + (by * 13 + 2) * 668265263 | 0;
    h = ((h ^ (h >> 13)) * 1274126177) | 0;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }
  function hash2(x, y) {
    var h = (x * 374761393 + y * 668265263) | 0;
    h = ((h ^ (h >> 13)) * 1274126177) | 0;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }
  function tileType(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= WORLD || ty >= WORLD) return BLDG;
    var rx = tx % 10, ry = ty % 10;
    if (rx < 3 || ry < 3) return ROAD;
    if (inRiver(tx)) return WATER;
    if (rx === 3 || rx === 9 || ry === 3 || ry === 9) return SIDE;
    if (inStadium(tx, ty)) return BLDG;
    if (blockHash(Math.floor(tx / 10), Math.floor(ty / 10)) < 0.16) return PARK;
    return BLDG;
  }
  function typeAtPx(x, y) { return tileType(Math.floor(x / TILE), Math.floor(y / TILE)); }

  function circleHitsBuilding(x, y, r) {
    var minTx = Math.floor((x - r) / TILE), maxTx = Math.floor((x + r) / TILE);
    var minTy = Math.floor((y - r) / TILE), maxTy = Math.floor((y + r) / TILE);
    for (var ty = minTy; ty <= maxTy; ty += 1) {
      for (var tx = minTx; tx <= maxTx; tx += 1) {
        var tt = tileType(tx, ty);
        if (tt !== BLDG && tt !== WATER) continue;
        var cx = Math.max(tx * TILE, Math.min(x, tx * TILE + TILE));
        var cy = Math.max(ty * TILE, Math.min(y, ty * TILE + TILE));
        var dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy < r * r) return true;
      }
    }
    return false;
  }
  function randTileOf(types) {
    for (;;) {
      var tx = 2 + Math.floor(Math.random() * (WORLD - 4));
      var ty = 2 + Math.floor(Math.random() * (WORLD - 4));
      if (types.indexOf(tileType(tx, ty)) !== -1) return { tx: tx, ty: ty };
    }
  }
  function tileCenter(t) { return { x: (t.tx + 0.5) * TILE, y: (t.ty + 0.5) * TILE }; }

  /* ---------------------------------------------------------- entities */
  var DIRS = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
  var CAR_COLORS = ["#c8553d", "#5b8bd0", "#7fae6a", "#c9a227", "#9a6bbf", "#d0d4da", "#4fb0a5", "#8a4f6d"];
  var SKINS = ["#e6c9a8", "#c9a06f", "#8d6b4b", "#f0d9bf"];
  // Realism phase 3 — visual-only silhouette variety, rolled per car and
  // drawn by the sprite factory (assets.js BODIES). Purely cosmetic: only
  // drawCarBody reads it, physics never sees it.
  var CAR_BODIES = ["sedan", "sedan", "hatch", "van"]; // weighted: mostly sedans

  var cars = [], cops = [], peds = [], packages = [], weaponDrops = [];
  var skids = [], particles = [];
  // Crash/wreck sites peds nearby turn to gawk at (S7 rubbernecking).
  // Capped small — this is a handful of distance checks per ped per
  // frame, not a growing search.
  var events = [];
  function addEvent(x, y) {
    events.push({ x: x, y: y, life: 6 });
    if (events.length > 4) events.shift();
  }
  function panicNear(x, y, r) {
    for (var i = 0; i < peds.length; i += 1) {
      var p = peds[i];
      if (p.dead) continue;
      var dx = p.x - x, dy = p.y - y;
      if (dx * dx + dy * dy < r * r) p.panic = Math.max(p.panic, 1.2);
    }
  }

  /* Realism phase 1 — visibility-aware witness. A ped only spots a crime
     if (a) the player is roughly in the ped's heading cone (~120° total)
     and (b) something solid isn't standing between ped and player (a cheap
     ray walk sampling typeAtPx every 24 px, skipping BLDG/WATER). Vision
     comes from DIRS[p.dir] — peds have no free heading — so the cone is
     intentionally generous. Radius from the caller stays the outer bound
     (cheap reject before the cone math). */
  var SEE_CONE = 0.6; // ~±69° at the half-plane — generous but not omniscient
  function blockedByBuilding(ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 24) return false;
    var steps = Math.floor(dist / 24);
    for (var i = 1; i < steps; i += 1) {
      var tt = typeAtPx(ax + dx * (i / steps), ay + dy * (i / steps));
      if (tt === BLDG || tt === WATER) return true;
    }
    return false;
  }
  function citizenCanSee(p, px, py, maxR) {
    var dx = px - p.x, dy = py - p.y;
    var d = dx * dx + dy * dy;
    if (d >= maxR * maxR) return false;
    var ang = Math.atan2(dy, dx);
    if (angleDiff(ang, p.dir * Math.PI / 2) > SEE_CONE) return false;
    return !blockedByBuilding(p.x, p.y, px, py);
  }
  /* First live ped (other than `exclude`) whose sight model catches the
     crime at (px, py) — shared by the carjack, punch and shoot sites. */
  function spotCrime(px, py, r, exclude) {
    for (var i = 0; i < peds.length; i += 1) {
      var w = peds[i];
      if (w.dead || w === exclude) continue;
      if (citizenCanSee(w, px, py, r)) return w;
    }
    return null;
  }
  function witnessReaction(w) {
    panicNear(w.x, w.y, 80);
    alertWitness(w.x, w.y);
    if (settings.peaceful) return false;
    wanted = Math.min(5, wanted + 1);
    lastCrime = now();
    say("Someone saw you! The police are on their way.");
    return true;
  }

  function makeCar(x, y, dir, parked) {
    return {
      x: x, y: y, a: dir * Math.PI / 2, dir: dir,
      speed: parked ? 0 : 70 + Math.random() * 50,
      cruise: 80 + Math.random() * 50,
      color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
      parked: !!parked, player: false, brake: false, decided: false,
      health: 100, wrecked: false, vx: 0, vy: 0,
      // handling variety: every car drives a little differently once
      // driven — not just traffic-cruise flavor. accel/topSpeed/gripMul
      // multiply the base constants in playerStep.
      accel: 0.85 + Math.random() * 0.3,
      topSpeed: 0.86 + Math.random() * 0.24,
      gripMul: 0.82 + Math.random() * 0.38,
      body: CAR_BODIES[Math.floor(Math.random() * CAR_BODIES.length)] // realism phase 3
    };
  }
  function spawnWorld() {
    var i, t, c;
    // scaled by settings.traffic (item 10, S1) — 1x keeps the original
    // 16/9/26 counts exactly; packages stay fixed regardless of density.
    var trafficMul = settings.traffic || 1;
    var movingCars = Math.max(1, Math.round(16 * trafficMul));
    var parkedCars = Math.max(1, Math.round(9 * trafficMul));
    var pedCount = Math.min(48, Math.max(1, Math.round(26 * trafficMul)));
    for (i = 0; i < movingCars; i += 1) { t = randTileOf([ROAD]); c = tileCenter(t); cars.push(makeCar(c.x, c.y, Math.floor(Math.random() * 4), false)); }
    for (i = 0; i < parkedCars; i += 1) { t = randTileOf([ROAD]); c = tileCenter(t); cars.push(makeCar(c.x + 13, c.y + 13, Math.floor(Math.random() * 4), true)); }
    // ~30% of the time, drop a 3-5 ped crowd on one corner instead of a
    // single walker — capped at pedCount total either way (item 7).
    var pedsLeft = pedCount;
    while (pedsLeft > 0) {
      var clusterSize = Math.min(pedsLeft, Math.random() < 0.3 ? 3 + Math.floor(Math.random() * 3) : 1);
      t = randTileOf([SIDE]); c = tileCenter(t);
      for (var k = 0; k < clusterSize; k += 1) {
        peds.push({
          x: c.x + (Math.random() - 0.5) * 26, y: c.y + (Math.random() - 0.5) * 26,
          dir: Math.floor(Math.random() * 4),
          speed: 26 + Math.random() * 18, panic: 0, gawk: 0,
          shirt: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
          skin: Math.floor(Math.random() * SKINS.length),
          dead: false, timer: 0, phase: Math.random() * 6.28
        });
      }
      pedsLeft -= clusterSize;
    }
    for (i = 0; i < 6; i += 1) { t = randTileOf([ROAD, SIDE]); c = tileCenter(t); packages.push({ x: c.x, y: c.y, phase: Math.random() * 6.28 }); }
    for (i = 0; i < 2; i += 1) { t = randTileOf([ROAD, SIDE]); c = tileCenter(t); weaponDrops.push({ x: c.x, y: c.y, phase: Math.random() * 6.28, kind: "bat" }); }
    // B5 — one stun pistol alongside the two bats. Same drop shape, new
    // kind field; pickupStep reads it to decide what F becomes.
    t = randTileOf([ROAD, SIDE]); c = tileCenter(t);
    weaponDrops.push({ x: c.x, y: c.y, phase: Math.random() * 6.28, kind: "pistol" });
  }

  /* ---------------------------------------------------------- state */
  var spawn = tileCenter({ tx: 41, ty: 40 });
  var player = { x: spawn.x, y: spawn.y, a: 0, vx: 0, vy: 0, inCar: null, health: 100, punchCd: 0, punchAnim: 0, weapon: null, ammo: 0 };
  var wanted = 0, score = 0;
  var BEST_KEY = "lta-best";
  // B9 — shareable score: #s=12345 in the URL is a "rival score to beat",
  // shown on the start overlay; on a new best (and at bust) the hash is
  // rewritten via history.replaceState so the URL can be copied/shared.
  // No network anywhere in this path; both ends fail silent on file://
  // variants that restrict hash/history access.
  var rivalScore = (function () {
    try {
      var m = window.location && window.location.hash && window.location.hash.match(/[#&]s=(\d+)/);
      return m ? Math.min(9999999, parseInt(m[1], 10) || 0) : 0;
    } catch (err) { return 0; }
  })();
  function pushScoreHash(v) {
    try {
      if (window.history && window.history.replaceState) window.history.replaceState(null, "", "#s=" + v);
    } catch (err) { /* private mode / restrictive file:// hosts */ }
  }
  function loadBest() {
    try {
      var v = window.localStorage && window.localStorage.getItem(BEST_KEY);
      return v ? Math.max(0, parseInt(v, 10) || 0) : 0;
    } catch (err) { return 0; }
  }
  var best = loadBest();
  function saveBest() {
    if (score <= best) return;
    best = score;
    try { window.localStorage && window.localStorage.setItem(BEST_KEY, String(best)); } catch (err) { /* private mode, file://, etc. */ }
    pushScoreHash(best);
  }

  /* -------------------------------------------------- stats & achievements */
  var STATS_KEY = "lta-stats", ACH_KEY = "lta-achievements";
  function loadJSON(key, fallback) {
    try {
      var v = window.localStorage && window.localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (err) { return fallback; }
  }
  function saveJSON(key, value) {
    try { window.localStorage && window.localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* ignore */ }
  }
  var STATS_DEFAULTS = { steals: 0, drifted: 0, deliveries: 0, fiveStarSeconds: 0, garageSaves: 0, styleBest: 0, shots: 0 };
  var stats = Object.assign({}, STATS_DEFAULTS, loadJSON(STATS_KEY, {}));
  var achievements = loadJSON(ACH_KEY, {});
  // Persist the merged shape once at boot so newly-added fields (styleBest,
  // shots) are written into older saves instead of being re-defaulted on
  // every load — saveStats is hoisted, safe to call this early.
  saveStats();

  /* -------------------------------------------------------------- settings */
  // Player-tunable knobs, cycled with 1/2/3 while paused (see the PAUSED
  // panel in drawHUD and the keydown handler below). New key (lta-settings)
  // — never reshapes the older lta-best/lta-stats/lta-achievements saves.
  var SETTINGS_KEY = "lta-settings";
  var TRAFFIC_LEVELS = [0.5, 1, 1.5];
  var COP_LEVELS = [0.5, 1, 1.5];
  // A4 — ped customizer. SHIRT_CHOICES mirrors LTA.Hud.cs's ShirtChoices
  // exactly (same four colors, same order); skin tones reuse the SKINS
  // array above, which already matches Unity's Cfg.Skins 1:1. Persisted as
  // INDICES inside lta-settings under additive keys only (skin/shirt) — the
  // existing traffic/cops/peaceful shape is never reshaped, per the
  // old-shape-merge discipline pinned in test/game.test.js.
  var SHIRT_CHOICES = ["#ffb224", "#5b8bd0", "#7fae6a", "#9a6bbf"];
  var settings = Object.assign({ traffic: 1, cops: 1, peaceful: false, skin: 0, shirt: 0 }, loadJSON(SETTINGS_KEY, {}));
  // normalize in case an old or hand-edited save carries junk for the new keys
  settings.skin = Math.max(0, Math.min(SKINS.length - 1, settings.skin | 0));
  settings.shirt = Math.max(0, Math.min(SHIRT_CHOICES.length - 1, settings.shirt | 0));
  function saveSettings() { saveJSON(SETTINGS_KEY, settings); }
  function cycleTraffic() {
    var i = TRAFFIC_LEVELS.indexOf(settings.traffic);
    settings.traffic = TRAFFIC_LEVELS[(i + 1) % TRAFFIC_LEVELS.length];
    saveSettings();
    say("Traffic density " + settings.traffic + "x — takes effect on next restart (R).");
  }
  function cycleCops() {
    var i = COP_LEVELS.indexOf(settings.cops);
    settings.cops = COP_LEVELS[(i + 1) % COP_LEVELS.length];
    saveSettings();
    say("Police aggression " + settings.cops + "x.");
  }
  function togglePeaceful() {
    settings.peaceful = !settings.peaceful;
    saveSettings();
    if (settings.peaceful) { wanted = 0; cops.length = 0; }
    say(settings.peaceful ? "Peaceful mode on — no heat, no cops." : "Peaceful mode off.");
  }
  // A4 — pause-menu look cycling (keys 4/5), same shape as the knobs above;
  // the on-canvas swatch picker in drawHUD does the same thing by pointer.
  function cycleSkin() {
    settings.skin = (settings.skin + 1) % SKINS.length;
    saveSettings();
    say("Skin tone " + (settings.skin + 1) + "/" + SKINS.length + ".");
  }
  function cycleShirt() {
    settings.shirt = (settings.shirt + 1) % SHIRT_CHOICES.length;
    saveSettings();
    say("Shirt " + (settings.shirt + 1) + "/" + SHIRT_CHOICES.length + ".");
  }
  var ACHIEVEMENTS = {
    firstSteal: "First Steal — borrowed your first car.",
    drifter: "Drifter — 5km of skid marks.",
    mostWanted: "Most Wanted — survived 20s at 5 stars.",
    courier: "Courier — 5 deliveries completed.",
    collector: "Collector — saved your first car to the garage.",
    brawler: "Brawler — threw your first punch."
  };
  function saveStats() { saveJSON(STATS_KEY, stats); }
  function unlockAch(id) {
    if (achievements[id]) return;
    achievements[id] = true;
    saveJSON(ACH_KEY, achievements);
    say("Achievement unlocked: " + ACHIEVEMENTS[id]);
  }
  function statsLine() {
    var n = Object.keys(achievements).length;
    var line = "BEST " + best + " · " + stats.steals + " steals · " + stats.deliveries +
      " deliveries · " + n + "/" + Object.keys(ACHIEVEMENTS).length + " achievements";
    // B9 — a score linked in via #s=N becomes the target on the overlay.
    if (rivalScore > 0) line += " · RIVAL " + rivalScore + " to beat";
    return line;
  }
  var lastCrime = -1e9, lastDecay = 0, lastCopSpawn = 0, lastRoadblockCheck = 0;
  var heli = null;
  // Per-run recap counters (item 8, S10) — reset in resetRun/endBust,
  // surfaced on the BUSTED/PAUSED overlays instead of plain text.
  var runStats = { steals: 0, deliveries: 0, peakWanted: 0, startedAt: 0 };

  /* -------------------------------------------------- style scoring (B2) */
  // A "juice" layer on top of the economy: small event-driven bonuses for
  // showy driving — near-misses with moving traffic, sustained drifts,
  // wrecking roadblocks — chained through a 4s combo window into a ×1–×4
  // multiplier that feeds straight into score. All awards fire inside
  // existing loops (playerStep's car collision pass, the skid-lay check);
  // the pop-ups share the particles' one-shot rise+fade shape and the
  // pool is hard-capped at 6.
  var STYLE_WINDOW = 4;
  var style = { pts: 0, combo: 0, mult: 1, lastHit: -1e9, driftAcc: 0 };
  var stylePops = [];
  // Set every frame a skid is being laid — audioStep turns it into the
  // B7 screech-loop gain; nothing else reads it.
  var lastSkidAt = -1e9;
  function awardStyle(base, label, x, y) {
    var t = now();
    style.combo = (t - style.lastHit < STYLE_WINDOW) ? style.combo + 1 : 1;
    style.mult = Math.min(4, style.combo);
    var pts = base * style.mult;
    style.pts += pts;
    score += pts;
    saveBest();
    style.lastHit = t;
    if (style.pts > stats.styleBest) { stats.styleBest = style.pts; saveStats(); }
    stylePops.push({ x: x, y: y, txt: "+" + pts + " " + label + (style.mult > 1 ? " ×" + style.mult : ""), life: 1.4 });
    if (stylePops.length > 6) stylePops.shift();
  }
  /* Realism phase 1 — witness feedback: a red "!" pop over the ped who
     spotted the crime, riding the same rise+fade renderer as style pops
     (warn flag → red instead of gold). One ping per spotted crime. */
  function alertWitness(x, y) {
    stylePops.push({ x: x, y: y - 18, txt: "!", life: 1.4, warn: true });
    if (stylePops.length > 6) stylePops.shift();
    // pan the grunt to where the witness stands on screen (−1..+1)
    var pan = Math.max(-1, Math.min(1, ((x - cam.x) - view.w / 2) / (view.w / 2)));
    sfxWitness(pan);
  }
  function stylePopsStep(dt) {
    for (var i = stylePops.length - 1; i >= 0; i -= 1) {
      stylePops[i].life -= dt;
      if (stylePops[i].life <= 0) stylePops.splice(i, 1);
    }
    if (style.combo > 0 && now() - style.lastHit >= STYLE_WINDOW) { style.combo = 0; style.mult = 1; }
  }
  function completeMission(reward) {
    score += reward;
    saveBest();
    stats.deliveries += 1;
    saveStats();
    runStats.deliveries += 1;
    if (stats.deliveries >= 5) unlockAch("courier");
  }
  var busted = 0, started = false, shake = 0, paused = false;
  var mission = null, nextMissionAt = 1e15;
  var vip = null; // active only while mission.type === "escort"
  var paintTimer = 0, paintDone = false;

  /* --------------------------------------------------------------- garage */
  // A second special corner tile, cloned from the paint shop with a
  // different hash salt so the two never land on the same corner. Parking
  // your current car here for 2s saves its rolled accel/topSpeed/gripMul
  // and paint to localStorage (new key — never reshapes lta-best/-stats/
  // -achievements) so it survives a restart (R) or a bust, instead of
  // being abandoned like every other stolen car.
  var GARAGE_KEY = "lta-garage";
  var garage = loadJSON(GARAGE_KEY, null);
  var garageTimer = 0, garageDone = false;
  function saveGarage(car) {
    garage = {
      accel: car.accel, topSpeed: car.topSpeed, gripMul: car.gripMul,
      color: car.color, health: car.health
    };
    saveJSON(GARAGE_KEY, garage);
  }
  function isGarage(tx, ty) {
    var rx = tx % 10, ry = ty % 10;
    if (!((rx === 3 || rx === 9) && (ry === 3 || ry === 9))) return false;
    if (isPaintShop(tx, ty)) return false;
    return hash2(tx * 53, ty * 59) < 0.045;
  }
  /* ---------------------------------------------------------------- shops */
  // Two more corner-tile services, same rejection pattern as the paint
  // shop/garage above (each excludes the corners already claimed by the
  // others so no two ever land on the same tile). Score is the only
  // currency in this game — both shops spend it, giving it a sink beyond
  // the high-score board.
  function isGasStation(tx, ty) {
    var rx = tx % 10, ry = ty % 10;
    if (!((rx === 3 || rx === 9) && (ry === 3 || ry === 9))) return false;
    if (isPaintShop(tx, ty) || isGarage(tx, ty)) return false;
    return hash2(tx * 71, ty * 73) < 0.045;
  }
  function isMart(tx, ty) {
    var rx = tx % 10, ry = ty % 10;
    if (!((rx === 3 || rx === 9) && (ry === 3 || ry === 9))) return false;
    if (isPaintShop(tx, ty) || isGarage(tx, ty) || isGasStation(tx, ty)) return false;
    return hash2(tx * 83, ty * 89) < 0.045;
  }
  var gasTimer = 0, gasDone = false, martTimer = 0, martDone = false;

  function hasOwnedCar() {
    for (var i = 0; i < cars.length; i += 1) { if (cars[i].owned) return true; }
    return false;
  }
  function spawnGarageCar() {
    if (!garage || hasOwnedCar()) return;
    // rejection-sample a ROAD tile near spawn — same ring trick lawStep
    // uses to place cops, just centered on the player's spawn point.
    for (var tries = 0; tries < 60; tries += 1) {
      var ang = Math.random() * Math.PI * 2;
      var r = 80 + Math.random() * 500;
      var x = spawn.x + Math.cos(ang) * r, y = spawn.y + Math.sin(ang) * r;
      if (typeAtPx(x, y) === ROAD) {
        var car = makeCar(x, y, Math.floor(Math.random() * 4), true);
        car.accel = garage.accel; car.topSpeed = garage.topSpeed; car.gripMul = garage.gripMul;
        car.color = garage.color; car.health = garage.health;
        car.owned = true;
        cars.push(car);
        return;
      }
    }
  }

  /* endless mode: score/wanted persist across busts (no game-over), but
     R lets the player deliberately start a fresh run — new world layout,
     score back to zero, stats/achievements untouched. */
  function resetRun() {
    cars.length = 0; cops.length = 0; peds.length = 0; packages.length = 0; weaponDrops.length = 0;
    skids.length = 0; particles.length = 0;
    spawnWorld();
    spawnGarageCar();
    wanted = 0; score = 0;
    lastCrime = -1e9; lastDecay = 0; lastCopSpawn = 0; lastRoadblockCheck = 0; heli = null;
    busted = 0; shake = 0; paused = false;
    mission = null; nextMissionAt = now() + 8; vip = null;
    runStats = { steals: 0, deliveries: 0, peakWanted: 0, startedAt: now() };
    style.pts = 0; style.combo = 0; style.mult = 1; style.lastHit = -1e9; style.driftAcc = 0;
    stylePops.length = 0;
    paintTimer = 0; paintDone = false;
    garageTimer = 0; garageDone = false;
    gasTimer = 0; gasDone = false; martTimer = 0; martDone = false;
    player.x = spawn.x; player.y = spawn.y; player.a = 0;
    player.vx = 0; player.vy = 0; player.inCar = null; player.health = 100;
    say(garage ? "Fresh start. Your saved ride is parked near spawn." : "Fresh start. Same city, new crimes.");
  }
  var ticker = { msg: "Welcome to the local city. Borrow a car, grab the amber packages.", until: 6 };
  var cam = { x: player.x - 480, y: player.y - 270 };
  var camZoom = 1, zoomKick = 0;
  var camA = 0; // realism phase 2 — target-lean rotation (radians, capped ±0.17)
  // Nearest ped (or car/cop when none) within r of a point — feeds the
  // camera's target-lean. Trivially cheap: ≤ ~90 entity distance checks,
  // once per frame while on foot.
  function nearestTarget(x, y, r) {
    var best = null, bestD = r * r;
    for (var i = 0; i < peds.length; i += 1) {
      var p = peds[i], dx = p.x - x, dy = p.y - y, d = dx * dx + dy * dy;
      if (!p.dead && d < bestD) { bestD = d; best = p; }
    }
    if (best) return best;
    for (var j = 0; j < cops.length; j += 1) {
      var c = cops[j], cdx = c.x - x, cdy = c.y - y, cd = cdx * cdx + cdy * cdy;
      if (cd < bestD) { bestD = cd; best = c; }
    }
    if (best) return best;
    for (var k = 0; k < cars.length; k += 1) {
      var v = cars[k], vx = v.x - x, vy = v.y - y, vd = vx * vx + vy * vy;
      if (!v.wrecked && vd < bestD) { bestD = vd; best = v; }
    }
    return best;
  }
  var view = { w: 960, h: 540 };
  spawnWorld();

  /* day/night cycle: a slow phase that eases the city between its tuned
     night look (dayAmt 0, unchanged from before) and a paler dawn/dusk
     wash (dayAmt near 1) — never full daylight, so the neon-and-headlight
     art direction stays intact. One full cycle is a deliberately long
     240s so most of a play session reads as "night" the way it always did. */
  var dayPhase = 0, dayAmt = 0;
  var DAY_CYCLE = 240;

  /* ------------------------------------------------------- weather (A1) */
  // Clear/rain alternates on the clock, ported from Unity's WeatherStep
  // (LTA.Systems.cs): first storm rolls in ~40s after boot, rain lasts
  // 45–75s, then 60–120s of clear before the next one — same numbers. The
  // only gameplay cost is looser car grip: weatherGrip mirrors Unity's
  // State.WeatherGrip = lerp(0.74, 0.62, rainIntensity). Everything else is
  // presentation — capped rain-streak particles riding the existing
  // particles array, a wet-road tint in drawTiles, shorter headlight cones
  // in drawLights. Non-lethal, comedic tone unchanged: rain never spawns an
  // entity, it just makes the city slicker and prettier.
  //
  // Parity note: weatherGrip is a JS-local multiplier applied at the
  // playerStep use-site. tileType/blockHash/hash2 and every shared physics
  // constant LTA.Core.cs mirrors are untouched.
  var weatherRain = false;
  var rainIntensity = 1;    // rolled once per rain event, like Unity's variable storms
  var nextWeatherAt = -1;   // armed on the first weatherStep call
  var weatherEnds = 0;
  var weatherGrip = 1;
  var RAIN_MAX = 90;        // hard cap on live "rain" particles
  function weatherStep(t) {
    if (nextWeatherAt < 0) nextWeatherAt = t + 40; // Unity: NextWeatherAt = 40
    if (!weatherRain) {
      if (t >= nextWeatherAt) {
        weatherRain = true;
        rainIntensity = 0.35 + Math.random() * 0.65;
        weatherEnds = t + 45 + Math.random() * 30;
        say("Rain rolling in. Roads are slicker.");
      }
    } else if (t >= weatherEnds) {
      weatherRain = false;
      nextWeatherAt = t + 60 + Math.random() * 60;
      say("Skies clearing up.");
    }
    weatherGrip = weatherRain ? 0.74 - 0.12 * rainIntensity : 1;
  }
  function rainStep(dt) {
    if (!weatherRain) return;
    var alive = 0;
    for (var i = 0; i < particles.length; i += 1) if (particles[i].kind === "rain") alive += 1;
    if (alive >= RAIN_MAX) return;
    // stochastic per-frame gate, same shape as frame()'s exhaust-puff spawn
    if (Math.random() > dt * 70 * rainIntensity) return;
    particles.push({
      x: cam.x - 40 + Math.random() * (view.w + 80),
      y: cam.y - 30 + Math.random() * 80,
      kind: "rain",
      vx: -136,  // ~12° slant, matching Unity's streak tilt
      vy: 640,   // Unity StepRain fall speed
      life: 0.95
    });
  }

  function now() { return performance.now() / 1000; }
  function say(msg) { ticker.msg = msg; ticker.until = now() + 4; }

  /* ---------------------------------------------------------- input */
  var keys = {};
  var GAME_KEYS = ["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "w", "a", "s", "d", "f"];
  window.addEventListener("keydown", function (e) {
    var k = e.key.toLowerCase();
    if (started && GAME_KEYS.indexOf(k) !== -1) e.preventDefault();
    if (!started) return;
    if (k === "p" && !keys.p) togglePause();
    if (k === "m" && !keys.m) setMuted(!muted);
    if (k === "r" && !keys.r) resetRun();
    if (paused) {
      if (k === "1" && !keys["1"]) cycleTraffic();
      if (k === "2" && !keys["2"]) cycleCops();
      if (k === "3" && !keys["3"]) togglePeaceful();
      if (k === "4" && !keys["4"]) cycleSkin();
      if (k === "5" && !keys["5"]) cycleShirt();
    }
    if (busted > 0 || paused) { keys[k] = true; return; }
    if (k === "e" && !keys.e) tryEnterExit();
    if (k === "f" && !keys.f) tryAttack();
    if (k === "h" && !keys.h) sfxHorn();
    keys[k] = true;
  });
  window.addEventListener("keyup", function (e) { keys[e.key.toLowerCase()] = false; });
  if (typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && started && !paused) togglePause();
    });
  }
  function togglePause() {
    paused = !paused;
    say(paused ? "Paused. Press P to resume." : "Back in it.");
  }

  /* on-screen buttons for touch/coarse-pointer devices: set/clear the
     same `keys` flags axisInput() and the "e" edge-trigger already read,
     so no simulation code needs to know these exist. P/M/H are routed
     through the same edge-trigger branch as the keydown handler — mobile
     used to have no pause/mute/horn at all (B0). */
  var touchBtns = typeof document.querySelectorAll === "function" ? document.querySelectorAll(".touch-btn") : [];
  for (var tbi = 0; tbi < touchBtns.length; tbi += 1) {
    (function (btn) {
      var k = btn.getAttribute("data-key");
      var press = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        if (!started) return;
        if (k === "e" && !keys.e) tryEnterExit();
        else if (k === "f" && !keys.f) tryAttack();
        else if (k === "p" && !keys.p) togglePause();
        else if (k === "m" && !keys.m) setMuted(!muted);
        else if (k === "h" && !keys.h) sfxHorn();
        keys[k] = true;
      };
      var release = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        keys[k] = false;
      };
      btn.addEventListener("pointerdown", press);
      btn.addEventListener("pointerup", release);
      btn.addEventListener("pointercancel", release);
      btn.addEventListener("pointerleave", release);
    })(touchBtns[tbi]);
  }

  /* A4 — pause-screen swatch picker: taps/clicks on the canvas hit-test
     the swatch rects drawLookSwatches rebuilt on the last paused frame.
     Guarded like the visibilitychange handler above — the headless test
     canvas stub has no addEventListener and never needs one. */
  if (typeof canvas.addEventListener === "function" && typeof canvas.getBoundingClientRect === "function") {
    canvas.addEventListener("pointerdown", function (e) {
      if (!started || !paused || busted > 0) return;
      var rect = canvas.getBoundingClientRect();
      var px = (e.clientX || 0) - rect.left, py = (e.clientY || 0) - rect.top;
      for (var i = 0; i < lookSwatches.length; i += 1) {
        var s = lookSwatches[i];
        if (px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h) {
          if (s.kind === "skin") {
            settings.skin = s.idx;
            say("Skin tone " + (s.idx + 1) + "/" + SKINS.length + ".");
          } else {
            settings.shirt = s.idx;
            say("Shirt " + (s.idx + 1) + "/" + SHIRT_CHOICES.length + ".");
          }
          saveSettings();
          return;
        }
      }
    });
  }

  var statsEl = document.getElementById("gameStats");
  if (statsEl) statsEl.textContent = statsLine();

  startBtn.addEventListener("click", function () {
    started = true;
    overlay.classList.add("is-hidden");
    nextMissionAt = now() + 8;
    runStats.startedAt = now();
    initAudio();
    say("Find a car and press E — or walk. Watch for witnesses.");
  });

  function axisInput() {
    var x = 0, y = 0;
    if (keys.a || keys.arrowleft) x -= 1;
    if (keys.d || keys.arrowright) x += 1;
    if (keys.w || keys.arrowup) y -= 1;
    if (keys.s || keys.arrowdown) y += 1;
    return { x: x, y: y };
  }

  /* ---------------------------------------------------------- audio */
  // Zero-asset procedural sound (WebAudio): an engine hum pitched by
  // speed, a two-tone siren whose presence follows the cop count, and a
  // handful of short one-shots. Nodes are created once and reused every
  // frame — never allocated inside the animation loop. The AudioContext
  // is created on the start-button gesture to satisfy autoplay policies.
  var audioCtx = null, masterGain = null;
  var engineOsc = null, engineGain = null, engineOsc2 = null, engineGain2 = null, engineFilter = null;
  var sirenOsc = null, sirenGain = null, sirenOn = false;
  var heliOsc = null, heliGain = null;
  var skidGain = null; // B7 — band-passed noise loop for tire screech
  var noiseBuffer = null;
  var muted = (function () {
    try { return window.localStorage && window.localStorage.getItem("lta-muted") === "1"; }
    catch (err) { return false; }
  })();
  function setMuted(v) {
    muted = v;
    if (masterGain) masterGain.gain.value = muted ? 0 : 0.16;
    try { window.localStorage && window.localStorage.setItem("lta-muted", muted ? "1" : "0"); } catch (err) { /* ignore */ }
  }
  function initAudio() {
    if (audioCtx) {
      if (audioCtx.state === "suspended") audioCtx.resume();
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = muted ? 0 : 0.16;
    masterGain.connect(audioCtx.destination);

    engineOsc = audioCtx.createOscillator();
    engineOsc.type = "sawtooth";
    engineOsc.frequency.value = 60;
    // Realism phase 4 — lowpass on the engine chain: audioStep opens its
    // cutoff with revs so the tone brightens on each gear shift instead of
    // only rising in pitch.
    engineFilter = audioCtx.createBiquadFilter ? audioCtx.createBiquadFilter() : null;
    if (engineFilter) {
      engineFilter.type = "lowpass";
      engineFilter.frequency.value = 400;
      engineGain = audioCtx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter).connect(engineGain).connect(masterGain);
    } else {
      engineGain = audioCtx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineGain).connect(masterGain);
    }
    engineOsc.start();
    // Realism phase 4 — detuned second oscillator under the engine hum,
    // driven with the same gear-band shape (audioStep mirrors the primary
    // osc's frequency offset). Two slightly-out-of-phase saws read as an
    // engine block rather than one tone.
    engineOsc2 = audioCtx.createOscillator();
    engineOsc2.type = "sawtooth";
    engineOsc2.frequency.value = 63;
    engineGain2 = audioCtx.createGain();
    engineGain2.gain.value = 0;
    engineOsc2.connect(engineGain2).connect(masterGain);
    engineOsc2.start();

    sirenOsc = audioCtx.createOscillator();
    sirenOsc.type = "sine";
    sirenOsc.frequency.value = 700;
    sirenGain = audioCtx.createGain();
    sirenGain.gain.value = 0;
    sirenOsc.connect(sirenGain).connect(masterGain);
    sirenOsc.start();

    heliOsc = audioCtx.createOscillator();
    heliOsc.type = "sawtooth";
    heliOsc.frequency.value = 45;
    heliGain = audioCtx.createGain();
    heliGain.gain.value = 0;
    heliOsc.connect(heliGain).connect(masterGain);
    heliOsc.start();

    // One white-noise buffer, built once and reused forever — layered
    // under sfxCrash for a richer collision crunch (S10 item 8), and
    // looped through a band-pass for the B7 tire-screech bed.
    var bufSize = Math.max(1, Math.floor(audioCtx.sampleRate * 0.3));
    noiseBuffer = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
    var noiseData = noiseBuffer.getChannelData(0);
    for (var ni = 0; ni < bufSize; ni += 1) noiseData[ni] = Math.random() * 2 - 1;

    // B7 — skid screech: the noise buffer looped through a band-pass, its
    // gain chasing the skid-lay rate. Nodes made once here; audioStep only
    // mutates the gain, so nothing is allocated per frame.
    var skidSrc = audioCtx.createBufferSource();
    skidSrc.buffer = noiseBuffer;
    skidSrc.loop = true;
    var skidBand = audioCtx.createBiquadFilter();
    skidBand.type = "bandpass";
    skidBand.frequency.value = 950;
    skidBand.Q.value = 0.9;
    skidGain = audioCtx.createGain();
    skidGain.gain.value = 0;
    skidSrc.connect(skidBand).connect(skidGain).connect(masterGain);
    skidSrc.start();
  }
  function playTone(freq, dur, type, gainAmt, pan) {
    if (!audioCtx || muted) return;
    var o = audioCtx.createOscillator();
    var g = audioCtx.createGain();
    o.type = type || "square";
    o.frequency.value = freq;
    g.gain.value = gainAmt || 0.5;
    // Realism phase 4 — spatial SFX: stereo pan by screen-relative x
    // (−1..+1) when the browser exposes StereoPannerNode; mono otherwise.
    var dest = masterGain;
    if (pan != null && audioCtx.createStereoPanner) {
      var panner = audioCtx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(panner);
      dest = panner;
    }
    o.connect(g).connect(dest);
    var t0 = audioCtx.currentTime;
    g.gain.setValueAtTime(g.gain.value, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }
  function sfxPickup() { playTone(880, 0.12, "square", 0.35); playTone(1320, 0.14, "square", 0.25); }
  function sfxCrash() {
    playTone(90, 0.28, "sawtooth", 0.6);
    if (audioCtx && !muted && noiseBuffer) {
      var src = audioCtx.createBufferSource();
      src.buffer = noiseBuffer;
      var g = audioCtx.createGain();
      var t0 = audioCtx.currentTime;
      g.gain.setValueAtTime(0.25, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
      src.connect(g).connect(masterGain);
      src.start(t0);
      src.stop(t0 + 0.25);
    }
  }
  function sfxBust() { playTone(220, 0.5, "sawtooth", 0.5); }
  function sfxHorn() { playTone(300, 0.25, "square", 0.3); playTone(304, 0.25, "square", 0.22); }
  function sfxEnter() { playTone(440, 0.08, "triangle", 0.3); }
  function sfxPunch() { playTone(160, 0.09, "square", 0.4); }
  function sfxHonk() { playTone(392, 0.13, "square", 0.12); playTone(398, 0.13, "square", 0.09); }
  function sfxWitness(pan) { playTone(1040, 0.09, "square", 0.22, pan); playTone(880, 0.12, "square", 0.18, pan); }
  function audioStep(t) {
    if (!audioCtx) return;
    var wantEngine = player.inCar && !player.inCar.wrecked ? Math.min(1, Math.abs(player.inCar.speed) / 260) : 0;
    engineGain.gain.value += (wantEngine * 0.22 - engineGain.gain.value) * 0.15;
    engineGain2.gain.value = engineGain.gain.value * 0.6;
    // B7 — gear steps instead of a pure linear pitch: rev up inside each
    // of three bands (split at 0.33/0.66 of top speed), drop back on the
    // shift, so the hum reads like a gearbox, not a synth sweep.
    var spdAbs = Math.abs(player.inCar ? player.inCar.speed : 0);
    var frac = Math.min(1, spdAbs / 280);
    var gear = frac < 0.33 ? 0 : frac < 0.66 ? 1 : 2;
    var bandLo = gear * 0.33, bandHi = gear === 2 ? 1 : (gear + 1) * 0.33;
    var bandFrac = Math.max(0, Math.min(1, (frac - bandLo) / (bandHi - bandLo)));
    engineOsc.frequency.value = 55 + gear * 30 + bandFrac * 58;
    // Realism phase 4 — detuned twin + revs-opened lowpass brighten the
    // tone on each shift rather than just raising pitch.
    engineOsc2.frequency.value = engineOsc.frequency.value * 1.007;
    if (engineFilter) engineFilter.frequency.value = 400 + wantEngine * frac * 1400;
    heliGain.gain.value += ((heli ? 0.14 : 0) - heliGain.gain.value) * 0.15;
    // B7 — screech follows the skid-lay rate (lastSkidAt is stamped by
    // playerStep every frame a skid mark is laid).
    var wantScreech = player.inCar && (now() - lastSkidAt < 0.12) ? 0.12 : 0;
    skidGain.gain.value += (wantScreech - skidGain.gain.value) * 0.25;
    var wantSiren = cops.length > 0 && busted <= 0;
    sirenGain.gain.value += ((wantSiren ? 0.18 : 0) - sirenGain.gain.value) * 0.2;
    // Realism phase 4 — deeper, slower wail at 4–5 stars: same oscillator,
    // pitch and tempo drop as the response escalates.
    var hiStars = wanted >= 4;
    sirenOsc.frequency.value = Math.floor(t * (hiStars ? 2 : 3)) % 2 ? (hiStars ? 640 : 880) : (hiStars ? 480 : 660);
  }

  /* ------------------------------------------------------- enter/exit */
  function tryEnterExit() {
    if (busted > 0) return;
    if (player.inCar) {
      sfxEnter();
      if (player.inCar.wrecked) say("Walking away from that one.");
      var car = player.inCar;
      car.player = false; car.parked = true; car.speed = 0; car.vx = 0; car.vy = 0;
      var offs = [[28, 0], [-28, 0], [0, 28], [0, -28]];
      for (var i = 0; i < offs.length; i += 1) {
        var ox = car.x + offs[i][0], oy = car.y + offs[i][1];
        if (!circleHitsBuilding(ox, oy, 10)) { player.x = ox; player.y = oy; break; }
      }
      player.inCar = null;
      return;
    }
    var best = null, bestD = 52 * 52;
    for (var j = 0; j < cars.length; j += 1) {
      var c = cars[j];
      if (c.player) continue;
      // B3 — carjacking: a moving car qualifies only while slow enough to
      // grab onto (speed < 70); parked cars stay open at any time.
      if (!c.parked && Math.abs(c.speed) >= 70) continue;
      var dx = c.x - player.x, dy = c.y - player.y;
      var d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = c; }
    }
    if (!best) return;
    sfxEnter();
    stats.steals += 1;
    saveStats();
    runStats.steals += 1;
    unlockAch("firstSteal");
    var jacked = !best.parked && !best.wrecked;
    if (jacked) {
      // B3 — the driver goes flying. Reuse a dead ped slot when one is
      // free so the array stays capped; only grow as a last resort.
      var ejected = null;
      for (var ep = 0; ep < peds.length; ep += 1) {
        if (peds[ep].dead) { ejected = peds[ep]; break; }
      }
      if (!ejected && peds.length < 64) {
        ejected = {
          x: 0, y: 0, dir: 0, speed: 26, panic: 0, gawk: 0,
          shirt: CAR_COLORS[0], skin: 0, dead: false, timer: 0, phase: 0
        };
        peds.push(ejected);
      }
      if (ejected) {
        ejected.x = best.x; ejected.y = best.y;
        ejected.dir = Math.floor(Math.random() * 4);
        ejected.speed = 26 + Math.random() * 18;
        ejected.shirt = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
        ejected.skin = Math.floor(Math.random() * SKINS.length);
        ejected.dead = false; ejected.timer = 0;
        ejected.panic = 3; ejected.gawk = 0;
        ejected.phase = Math.random() * 6.28;
      }
      addEvent(best.x, best.y);
      panicNear(best.x, best.y, 80);
      if (!settings.peaceful) { wanted = Math.min(5, wanted + 1); lastCrime = now(); }
    }
    best.player = true; best.parked = false;
    player.inCar = best;
    player.health = best.health;
    var seen = false;
    // Realism phase 1 — the witness radius widens only when the player is
    // on screen; off-screen spots nearby keep the modest radius so a
    // parking-lot jacking behind a building stays risky but fair.
    var onScreen = inView(best.x - cam.x, best.y - cam.y, 40);
    var witness = spotCrime(player.x, player.y, onScreen ? 160 : 110, null);
    seen = !!witness;
    if (seen) witnessReaction(witness);
    if (!seen || settings.peaceful) {
      var flavor = best.accel > 1.05 ? " This one's got a tune."
        : best.gripMul < 0.95 ? " Floaty suspension."
        : best.topSpeed > 1.02 ? " Feels quick."
        : "";
      var msg = jacked ? "Carjacked. The owner hit the asphalt — they noticed." + flavor
        : (best.speed > 40 ? "Acquired. The owner will notice, locally." : "Borrowed. Keep it shiny.") + flavor;
      if (seen && settings.peaceful) msg = "Someone saw that, but peaceful mode looked away." + flavor;
      say(msg);
    }
    if (mission && mission.type === "steal" && mission.targetCar === best) {
      score += mission.reward;
      saveBest();
      stats.deliveries += 1;
      saveStats();
      if (stats.deliveries >= 5) unlockAch("courier");
      say("Contract fulfilled — that's the one. +" + mission.reward + ".");
      mission = null;
      nextMissionAt = now() + 12;
    }
  }

  /* ------------------------------------------------------------ combat */
  // Shove/stun comedy, not gore — peds panic and stagger back, cops get
  // briefly stunned (copStep's stunUntil guard). Peaceful mode (S1) mutes
  // the wanted/panic side effects, same as every other crime in the game.
  //
  // F is contextual (B5): one attack key for every weapon — bare hands
  // and bat swing through tryPunch, the stun pistol through tryShoot.
  function tryAttack() {
    if (player.weapon === "pistol" && !player.inCar) tryShoot();
    else tryPunch();
  }
  function angleDiff(a, b) {
    var d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d);
  }
  function tryPunch() {
    if (busted > 0 || player.inCar || player.punchCd > 0) return;
    player.punchCd = 0.4;
    player.punchAnim = 0.15;
    sfxPunch();
    var reach = 34, arc = 0.9, hit = false, pedHit = false;
    for (var i = 0; i < peds.length; i += 1) {
      var p = peds[i];
      if (p.dead) continue;
      var dx = p.x - player.x, dy = p.y - player.y;
      if (Math.hypot(dx, dy) < reach && angleDiff(Math.atan2(dy, dx), player.a) < arc) {
        p.panic = Math.max(p.panic, 3);
        p.x += Math.cos(player.a) * 20; p.y += Math.sin(player.a) * 20;
        hit = true; pedHit = true;
      }
    }
    for (var j = 0; j < cops.length; j += 1) {
      var c = cops[j];
      var cdx = c.x - player.x, cdy = c.y - player.y;
      if (Math.hypot(cdx, cdy) < reach && angleDiff(Math.atan2(cdy, cdx), player.a) < arc) {
        c.stunUntil = now() + (player.weapon === "bat" ? 2.5 : 1.2);
        hit = true;
        if (!settings.peaceful) {
          wanted = Math.min(5, wanted + 1); lastCrime = now();
          say("Assaulting an officer. The local police are furious.");
        }
      }
    }
    if (hit) {
      stats.punches = (stats.punches || 0) + 1;
      saveStats();
      unlockAch("brawler");
      // Realism phase 1 — shoving a civilian only turns criminal when
      // someone (possibly the shove-order crowd, possibly a bystander)
      // actually spots it; the officer site above stays unconditional
      // because the cop is their own witness. Last on purpose: its say()
      // is the more urgent of the two messages this block can fire, and
      // the single-slot ticker keeps whichever ran latest.
      if (pedHit && !settings.peaceful) {
        var onScreen = inView(player.x - cam.x, player.y - cam.y, 40);
        var w = spotCrime(player.x, player.y, onScreen ? 160 : 110, null);
        if (w) witnessReaction(w);
      }
    }
  }

  /* B5 — stun pistol. Non-lethal framing keeps the comedy voice: cops get
     the same stunUntil treatment a punch gives (3s), peds panic and hop
     back, nobody dies. The shot is one raycast along the facing angle —
     a fast step per distance slice against cops and peds — and its tracer
     rides the capped tracers[] pool (≤4) stepped in particlesStep. */
  var tracers = [];
  function sfxShot() { playTone(520, 0.06, "square", 0.4); playTone(180, 0.08, "sawtooth", 0.3); }
  function sfxDryClick() { playTone(1400, 0.03, "square", 0.2); }
  function tryShoot() {
    if (busted > 0 || player.inCar || player.punchCd > 0) return;
    player.punchCd = 0.35;
    player.punchAnim = 0.12;
    if (player.ammo <= 0) {
      sfxDryClick();
      say("Click. Empty clip — find another pistol.");
      return;
    }
    player.ammo -= 1;
    stats.shots = (stats.shots || 0) + 1;
    saveStats();
    sfxShot();
    var fx = Math.cos(player.a), fy = Math.sin(player.a);
    var endX = player.x + fx * 380, endY = player.y + fy * 380;
    var RANGE = 380, STEP = 14;
    var hit = false;
    for (var d = STEP; d <= RANGE && !hit; d += STEP) {
      var px = player.x + fx * d, py = player.y + fy * d;
      if (circleHitsBuilding(px, py, 2)) { endX = px; endY = py; break; }
      for (var i = 0; i < cops.length; i += 1) {
        var c = cops[i];
        var cdx = c.x - px, cdy = c.y - py;
        if (cdx * cdx + cdy * cdy < 16 * 16) {
          c.stunUntil = now() + 3;
          endX = c.x; endY = c.y;
          hit = true;
          if (!settings.peaceful) {
            wanted = Math.min(5, wanted + 1); lastCrime = now();
            say("Stunned an officer. The local police take that personally.");
          }
          break;
        }
      }
      if (hit) break;
      for (var p = 0; p < peds.length; p += 1) {
        var pd = peds[p];
        if (pd.dead) continue;
        var dx = pd.x - px, dy = pd.y - py;
        if (dx * dx + dy * dy < 12 * 12) {
          pd.panic = Math.max(pd.panic, 3);
          pd.x += fx * 14; pd.y += fy * 14;
          endX = pd.x; endY = pd.y;
          hit = true;
          break;
        }
      }
    }
    tracers.push({ x1: player.x + fx * 8, y1: player.y + fy * 8, x2: endX, y2: endY, life: 0.16 });
    if (tracers.length > 4) tracers.shift();
    // Realism phase 1 — a wild shot only becomes a crime when a witness
    // catches it; a lone shot into the wall of an empty alley stays quiet.
    if (!hit && !settings.peaceful) {
      var onScreen = inView(player.x - cam.x, player.y - cam.y, 40);
      var w = spotCrime(player.x, player.y, onScreen ? 200 : 130, null);
      if (w) witnessReaction(w);
    }
  }

  /* ---------------------------------------------------------- traffic */
  function laneTargets(c) {
    var tx = Math.floor(c.x / TILE), ty = Math.floor(c.y / TILE);
    var rx = tx % 10, ry = ty % 10;
    var inter = rx < 3 && ry < 3;
    var tX = null, tY = null;
    if (!inter) {
      if (c.dir === 0) tY = (ty - ry + 2.5) * TILE;
      else if (c.dir === 2) tY = (ty - ry + 0.5) * TILE;
      else if (c.dir === 1) tX = (tx - rx + 2.5) * TILE;
      else tX = (tx - rx + 0.5) * TILE;
    }
    return { x: tX, y: tY, inter: inter };
  }
  function dirValid(x, y, d) {
    return typeAtPx(x + DIRS[d].x * TILE * 1.6, y + DIRS[d].y * TILE * 1.6) === ROAD;
  }
  function probeAhead(c, dist) {
    var px = c.x + DIRS[c.dir].x * dist, py = c.y + DIRS[c.dir].y * dist;
    for (var i = 0; i < cars.length; i += 1) {
      var o = cars[i];
      if (o === c || o.parked) continue;
      var dx = o.x - px, dy = o.y - py;
      if (dx * dx + dy * dy < 30 * 30) return true;
    }
    if (player.inCar && player.inCar !== c) {
      var ax = player.inCar.x - px, ay = player.inCar.y - py;
      if (ax * ax + ay * ay < 30 * 30) return true;
    }
    if (!player.inCar) {
      var bx = player.x - px, by = player.y - py;
      if (bx * bx + by * by < 40 * 40) return true;
    }
    return false;
  }
  function trafficStep(c, dt) {
    if (c.parked || c.player || c.wrecked) return;
    var lt = laneTargets(c);
    if (lt.inter) {
      if (!c.decided) {
        c.decided = true;
        var opts = [];
        if (dirValid(c.x, c.y, c.dir)) opts.push(c.dir, c.dir);
        var r = (c.dir + 1) % 4, l = (c.dir + 3) % 4;
        if (dirValid(c.x, c.y, r)) opts.push(r);
        if (dirValid(c.x, c.y, l)) opts.push(l);
        if (opts.length) c.dir = opts[Math.floor(Math.random() * opts.length)];
        c.a = c.dir * Math.PI / 2;
      }
    } else {
      c.decided = false;
      if (lt.x != null) c.x += (lt.x - c.x) * Math.min(1, 4 * dt);
      if (lt.y != null) c.y += (lt.y - c.y) * Math.min(1, 4 * dt);
    }
    c.brake = probeAhead(c, 56);
    var target = c.brake ? 0 : c.cruise;
    c.speed += (target - c.speed) * Math.min(1, (target < c.speed ? 4 : 1.2) * dt);
    var nx = c.x + DIRS[c.dir].x * c.speed * dt;
    var ny = c.y + DIRS[c.dir].y * c.speed * dt;
    if (!circleHitsBuilding(nx, ny, 14)) { c.x = nx; c.y = ny; }
    else c.dir = (c.dir + 2) % 4;
  }

  /* ---------------------------------------------------------- peds */
  function pedStep(p, dt) {
    if (p.dead) { p.timer -= dt; return; }
    p.phase += dt * (p.panic > 0 ? 16 : 8);
    if (p.panic > 0) {
      p.panic -= dt;
      p.gawk = 0;
    } else if (player.inCar && Math.abs(player.inCar.speed) > 110) {
      var dx = p.x - player.inCar.x, dy = p.y - player.inCar.y;
      if (dx * dx + dy * dy < 110 * 110) {
        p.panic = 1.6;
        p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
      }
    } else {
      // cop reaction: flee sideways from a nearby siren, same shape as
      // the fast-car dodge above.
      for (var ci = 0; ci < cops.length; ci += 1) {
        var cdx = p.x - cops[ci].x, cdy = p.y - cops[ci].y;
        if (cdx * cdx + cdy * cdy < 120 * 120) {
          p.panic = 1.2;
          p.dir = Math.abs(cdx) > Math.abs(cdy) ? (cdx > 0 ? 0 : 2) : (cdy > 0 ? 1 : 3);
          break;
        }
      }
    }
    // rubbernecking: a calm ped near a recent crash/wreck event stops and
    // faces it instead of walking on — capped events array, so this is a
    // handful of distance checks per ped per frame, not a search of state.
    if (p.panic <= 0) {
      var gawkAt = null, gawkD = 150 * 150;
      for (var e = 0; e < events.length; e += 1) {
        var ex = events[e].x - p.x, ey = events[e].y - p.y;
        var ed = ex * ex + ey * ey;
        if (ed < gawkD) { gawkD = ed; gawkAt = events[e]; }
      }
      p.gawk = gawkAt ? 1 : 0;
    }
    var sp = p.panic > 0 ? 85 : (p.gawk ? 0 : p.speed);
    var nx = p.x + DIRS[p.dir].x * sp * dt;
    var ny = p.y + DIRS[p.dir].y * sp * dt;
    if (sp > 0) p.moveA = Math.atan2(DIRS[p.dir].y, DIRS[p.dir].x); // realism phase 3 — true heading for sprite rotation
    if (typeAtPx(nx, ny) === SIDE) { p.x = nx; p.y = ny; }
    else {
      var opts = [];
      for (var d = 0; d < 4; d += 1) {
        if (typeAtPx(p.x + DIRS[d].x * 30, p.y + DIRS[d].y * 30) === SIDE) opts.push(d);
      }
      p.dir = opts.length ? opts[Math.floor(Math.random() * opts.length)] : (p.dir + 2) % 4;
    }
  }

  /* ---------------------------------------------------------- police */
  function copStep(c, dt, t) {
    if (c.stunUntil && t < c.stunUntil) {
      // punched/batted (S8 combat) — briefly stops steering and moving,
      // same shape as the mid-corner freeze below, just from the player.
      c.flash = Math.floor(t * 7) % 2;
      return;
    }
    var want;
    if (t < c.avoidUntil) {
      // mid-corner: keep steering toward whichever orthogonal direction
      // was open when we hit the corner, instead of re-aiming straight
      // at the (now blocked) lead-predicted target every frame.
      want = c.a + (c.avoidDir ? 1 : -1) * Math.PI / 2;
    } else {
      var tx = player.x + player.vx * 0.35;
      var ty = player.y + player.vy * 0.35;
      want = Math.atan2(ty - c.y, tx - c.x);
    }
    var diff = want - c.a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    c.a += Math.max(-3 * dt, Math.min(3 * dt, diff));
    var sp = (155 + wanted * 10) * settings.cops * (c.swat ? 1.2 : 1);
    var nx = c.x + Math.cos(c.a) * sp * dt;
    var ny = c.y + Math.sin(c.a) * sp * dt;
    var blocked = false;
    if (!circleHitsBuilding(nx, c.y, 14)) c.x = nx; else blocked = true;
    if (!circleHitsBuilding(c.x, ny, 14)) c.y = ny; else blocked = true;
    if (blocked && t >= c.avoidUntil) {
      // probe one car-length ahead on each orthogonal heading and turn
      // toward whichever side is actually open, instead of scraping
      // along the wall the way a straight lead-pursuit does.
      var leftA = c.a - Math.PI / 2, rightA = c.a + Math.PI / 2;
      var probeDist = 32;
      var leftOpen = !circleHitsBuilding(c.x + Math.cos(leftA) * probeDist, c.y + Math.sin(leftA) * probeDist, 14);
      var rightOpen = !circleHitsBuilding(c.x + Math.cos(rightA) * probeDist, c.y + Math.sin(rightA) * probeDist, 14);
      if (leftOpen || rightOpen) {
        c.avoidDir = leftOpen && (!rightOpen || Math.random() < 0.5) ? 0 : 1;
        c.avoidUntil = t + 0.5;
      }
    }
    c.speed = sp;
    c.flash = Math.floor(t * 7) % 2;
  }

  /* ---------------------------------------------------------- player */
  function addSparks(x, y, n) {
    for (var i = 0; i < n; i += 1) {
      particles.push({
        x: x, y: y, kind: "spark",
        vx: (Math.random() - 0.5) * 220, vy: (Math.random() - 0.5) * 220,
        life: 0.35
      });
    }
  }
  function addSmoke(x, y) {
    particles.push({ x: x, y: y, kind: "smoke", vx: (Math.random() - 0.5) * 20, vy: -30, r: 5 + Math.random() * 6, life: 1.1 });
  }
  function damageCar(amount, x, y) {
    player.health = Math.max(0, player.health - amount);
    if (player.inCar) player.inCar.health = player.health;
    addSparks(x, y, 6);
    sfxCrash();
    shake = Math.min(14, shake + amount * 0.6);
    zoomKick = Math.min(0.1, zoomKick + amount * 0.004);
    if (player.health <= 0 && player.inCar && !player.inCar.wrecked) {
      player.inCar.wrecked = true;
      say("The car is done. On foot from here.");
    }
  }

  function playerStep(dt) {
    if (player.punchCd > 0) player.punchCd -= dt;
    if (player.punchAnim > 0) player.punchAnim -= dt;
    if (player.inCar) {
      var car = player.inCar;
      var inp = axisInput();
      var throttle = -inp.y;
      var topSpeed = 280 * car.topSpeed;
      if (!car.wrecked) {
        if (throttle > 0) car.speed = Math.min(topSpeed, car.speed + 250 * car.accel * dt);
        else if (throttle < 0) car.speed = Math.max(-95 * car.topSpeed, car.speed - 270 * car.accel * dt);
        else car.speed *= Math.max(0, 1 - 1.1 * dt);
        if (keys[" "]) car.speed *= Math.max(0, 1 - 2.4 * dt);
      } else {
        car.speed *= Math.max(0, 1 - 4 * dt);
      }
      var steer = inp.x * (keys[" "] ? 1.65 : 1) * 2.4 * dt;
      // Realism phase 2 — inverted-U steering curve replaces the linear
      // speed/130 scale: poor authority at a standstill and at full chat,
      // crispest mid-corner where a car actually turns, like a real chassis.
      var spdAbs = Math.abs(car.speed) / topSpeed;
      var steerCurve = Math.sin(Math.min(1, spdAbs / 0.45) * Math.PI / 2) * (spdAbs > 0.55 ? 1 - 0.45 * ((spdAbs - 0.55) / 0.45) : 1);
      steer *= steerCurve;
      car.a += steer;

      // Realism phase 2 — throttle weight transfer: easing a ±1 "weight"
      // value toward the pedal and letting it modulate grip a little means
      // braking tucks the nose in and full throttle washes out slightly —
      // a feel change only, no constant the drift/skid paths rely on.
      car.weight = (car.weight || 0) + (throttle - (car.weight || 0)) * Math.min(1, 3 * dt);
      // A1 — weatherGrip is a JS-local multiplier (see the weather section):
      // rain loosens handling exactly where Unity's PlayerSys.Step applies
      // State.WeatherGrip, without touching any shared physics constant.
      var grip = (keys[" "] ? 2.2 : 8) * car.gripMul * weatherGrip * (1 - 0.25 * Math.abs(car.weight));
      var fX = Math.cos(car.a), fY = Math.sin(car.a);
      var tvX = fX * car.speed, tvY = fY * car.speed;
      car.vx += (tvX - car.vx) * Math.min(1, grip * dt);
      car.vy += (tvY - car.vy) * Math.min(1, grip * dt);

      var nx = car.x + car.vx * dt;
      var ny = car.y + car.vy * dt;
      var hit = false;
      if (!circleHitsBuilding(nx, car.y, 14)) car.x = nx; else hit = true;
      if (!circleHitsBuilding(car.x, ny, 14)) car.y = ny; else hit = true;
      if (hit) {
        var impact = Math.hypot(car.vx, car.vy);
        if (impact > 120) damageCar((impact - 100) / 9, car.x + fX * 18, car.y + fY * 18);
        car.vx *= -0.3; car.vy *= -0.3; car.speed *= -0.3;
      }
      var spd = Math.hypot(car.vx, car.vy);
      var lat = Math.abs(-fY * car.vx + fX * car.vy);
      if (lat > 55 && spd > 90) {
        skids.push({ x: car.x - fX * 12, y: car.y - fY * 12, a: car.a, life: 6 });
        if (skids.length > 500) skids.shift();
        stats.drifted += spd * dt;
        if (stats.drifted > 5000) unlockAch("drifter");
        // B2 — a sustained drift chains style points (+2/s), banked in
        // 10-point chunks so pop-ups stay sparse; lastSkidAt also drives
        // the B7 screech gain in audioStep.
        style.driftAcc += 2 * dt;
        if (style.driftAcc >= 10) {
          awardStyle(Math.round(style.driftAcc), "DRIFT", car.x, car.y);
          style.driftAcc = 0;
        }
        lastSkidAt = now();
      }
      if (player.health < 40 && Math.random() < 0.3) addSmoke(car.x - fX * 14, car.y - fY * 14);
      if (car.wrecked && Math.random() < 0.5) addSmoke(car.x, car.y);

      player.x = car.x; player.y = car.y; player.a = car.a;
      player.vx = car.vx; player.vy = car.vy;
      car.brake = throttle < 0 || keys[" "];

      if (spd > 60) {
        for (var i = 0; i < peds.length; i += 1) {
          var p = peds[i];
          if (p.dead) continue;
          var dx = p.x - car.x, dy = p.y - car.y;
          if (dx * dx + dy * dy < 22 * 22) {
            p.dead = true; p.timer = 6;
            addEvent(p.x, p.y);
            panicNear(p.x, p.y, 80);
            if (!settings.peaceful) {
              wanted = Math.min(5, wanted + 1); lastCrime = now();
              say("Pedestrian down. The local police are now locally interested.");
            }
          }
        }
        if (mission && mission.type === "escort" && vip && !vip.dead) {
          var vdx = vip.x - car.x, vdy = vip.y - car.y;
          if (vdx * vdx + vdy * vdy < 22 * 22) {
            vip.dead = true;
            say("The VIP didn't make it. Contract failed.");
            mission = null;
            nextMissionAt = now() + 15;
          }
        }
      }
      for (var j = 0; j < cars.length; j += 1) {
        var o = cars[j];
        if (o === car) continue;
        var ox = o.x - car.x, oy = o.y - car.y;
        var d2 = ox * ox + oy * oy;
        if (d2 < 30 * 30 && d2 > 0.01) {
          var d = Math.sqrt(d2);
          var push = (30 - d) / 2;
          o.x += ox / d * push; o.y += oy / d * push;
          if ((!o.parked || o.roadblock) && spd > 130 && !o.wrecked) {
            o.wrecked = true; o.speed = 0; addEvent(o.x, o.y); panicNear(o.x, o.y, 90);
            // B2 — smashing through a roadblock pays out big; the rampage
            // counter (B6) also books every wreck the player causes.
            if (o.roadblock) awardStyle(150, "ROADBLOCK DOWN", o.x, o.y);
            if (mission && mission.type === "rampage") mission.count += 1;
          }
          if (spd > 130) damageCar((spd - 110) / 14, car.x + ox / d * 16, car.y + oy / d * 16);
          car.vx *= 0.6; car.vy *= 0.6; car.speed *= 0.7;
        } else if (!o.parked && !o.wrecked && d2 < 56 * 56) {
          // B2 — near miss: threading within ~26px of a moving car's body
          // (56px center-to-center minus the 30px contact radius) at high
          // relative speed, without contact. A per-car cooldown keeps one
          // long parallel run from spamming the combo.
          var tvx = DIRS[o.dir].x * o.speed, tvy = DIRS[o.dir].y * o.speed;
          var rel = Math.hypot(car.vx - tvx, car.vy - tvy);
          if (rel > 140 && now() - (o.grazeT || 0) > 1.5) {
            o.grazeT = now();
            awardStyle(25, "NEAR MISS", o.x, o.y);
            if (Math.random() < 0.5) sfxHonk(); // B7 — startled traffic
          }
        }
      }
    } else {
      var in2 = axisInput();
      var len = Math.hypot(in2.x, in2.y) || 1;
      var sp = 150;
      player.vx = (in2.x / len) * sp;
      player.vy = (in2.y / len) * sp;
      var mx = player.vx * dt, my = player.vy * dt;
      if (in2.x || in2.y) player.a = Math.atan2(in2.y, in2.x);
      if (!circleHitsBuilding(player.x + mx, player.y, 10)) player.x += mx;
      if (!circleHitsBuilding(player.x, player.y + my, 10)) player.y += my;
      if (!in2.x && !in2.y) { player.vx = 0; player.vy = 0; }
    }
  }

  /* ---------------------------------------------------------- pickups */
  function pickupStep() {
    for (var i = 0; i < packages.length; i += 1) {
      var pk = packages[i];
      var dx = pk.x - player.x, dy = pk.y - player.y;
      if (dx * dx + dy * dy < 30 * 30) {
        score += 100;
        saveBest();
        say("Package secured. +100. It was always going to stay on this machine.");
        var t = randTileOf([ROAD, SIDE]);
        var c = tileCenter(t);
        pk.x = c.x; pk.y = c.y;
      }
    }
    if (!player.inCar) {
      for (var j = 0; j < weaponDrops.length; j += 1) {
        var wd = weaponDrops[j];
        var wdx = wd.x - player.x, wdy = wd.y - player.y;
        if (wdx * wdx + wdy * wdy < 30 * 30 && player.weapon !== wd.kind) {
          player.weapon = wd.kind;
          if (wd.kind === "pistol") player.ammo = 8; // B5 — fresh 8-round clip
          sfxPickup();
          say(wd.kind === "pistol"
            ? "Stun pistol, 8 rounds. F fires it — it only stings, honest."
            : "Picked up a bat. Punches land harder now.");
          var t2 = randTileOf([ROAD, SIDE]);
          var c2 = tileCenter(t2);
          wd.x = c2.x; wd.y = c2.y;
        }
      }
    }
  }

  /* ------------------------------------------------------- missions */
  // Seven mission types share this one `mission` slot (mission.type),
  // offered/stepped/drawn through a small dispatch in offerMission /
  // missionStep / drawMission. Delivery is the original baseline and
  // stays weighted highest so the pacing doesn't change by default.
  var MISSION_TYPES = ["delivery", "delivery", "circuit", "steal", "ram", "escort", "rampage"];
  function offerDeliveryMission(t) {
    var target = null, dist = 0, tries = 0;
    do {
      target = randTileOf([ROAD, SIDE]);
      var c = tileCenter(target);
      dist = Math.hypot(c.x - player.x, c.y - player.y);
      tries += 1;
    } while (dist < 1200 && tries < 40);
    var c2 = tileCenter(target);
    dist = Math.hypot(c2.x - player.x, c2.y - player.y);
    mission = {
      type: "delivery",
      x: c2.x, y: c2.y, phase: Math.random() * 6.28,
      deadline: t + dist / 140 + 10,
      reward: 250 + Math.round(dist / 20) * 10
    };
    say("Delivery job posted — reach the blue marker before time runs out.");
  }
  function offerCircuitMission(t) {
    var n = 4 + Math.floor(Math.random() * 3);
    var checkpoints = [];
    var last = { x: player.x, y: player.y };
    var totalDist = 0;
    for (var i = 0; i < n; i += 1) {
      var target = null, tries = 0, c = null;
      do {
        target = randTileOf([ROAD, SIDE]);
        c = tileCenter(target);
        tries += 1;
      } while (Math.hypot(c.x - last.x, c.y - last.y) < 400 && tries < 30);
      totalDist += Math.hypot(c.x - last.x, c.y - last.y);
      checkpoints.push(c);
      last = c;
    }
    mission = {
      type: "circuit",
      checkpoints: checkpoints, cpIndex: 0, phase: Math.random() * 6.28,
      deadline: t + totalDist / 150 + 12,
      reward: 300 + Math.round(totalDist / 20) * 10
    };
    say("Checkpoint circuit posted — " + checkpoints.length + " stops before time runs out.");
  }
  function offerStealMission(t) {
    var candidates = [];
    for (var i = 0; i < cars.length; i += 1) {
      var c = cars[i];
      if (c.parked && !c.player && !c.owned && !c.wrecked) candidates.push(c);
    }
    if (!candidates.length) return false;
    mission = {
      type: "steal",
      targetCar: candidates[Math.floor(Math.random() * candidates.length)],
      phase: Math.random() * 6.28,
      deadline: t + 60,
      reward: 350
    };
    say("Contract posted — steal that specific car (marker) before it's gone.");
    return true;
  }
  function offerRamMission(t) {
    var candidates = [];
    for (var i = 0; i < cars.length; i += 1) {
      var c = cars[i];
      if (!c.parked && !c.player && !c.wrecked) candidates.push(c);
    }
    if (!candidates.length) return false;
    mission = {
      type: "ram",
      targetCar: candidates[Math.floor(Math.random() * candidates.length)],
      phase: Math.random() * 6.28,
      deadline: t + 45,
      reward: 300
    };
    say("Contract: wreck that car (marker) before it gets away.");
    return true;
  }
  function offerRampageMission(t) {
    // B6 — wreck N cars in T seconds. Reuses the collision-wreck branch in
    // playerStep, which books every wreck the player causes into
    // mission.count while a rampage is live. Needs live traffic to offer.
    var candidates = 0;
    for (var i = 0; i < cars.length; i += 1) {
      var c = cars[i];
      if (!c.parked && !c.player && !c.wrecked) candidates += 1;
    }
    if (candidates < 3) return false;
    var need = Math.min(candidates, 3 + Math.floor(Math.random() * 2));
    mission = {
      type: "rampage",
      need: need, count: 0,
      phase: Math.random() * 6.28,
      deadline: t + 40,
      reward: 380
    };
    say("Rampage posted — wreck " + need + " cars in 40 seconds. Style optional.");
    return true;
  }
  function offerEscortMission(t) {
    var pickTile = randTileOf([SIDE]);
    var pc = tileCenter(pickTile);
    var destTile = null, tries = 0, dc = null;
    do {
      destTile = randTileOf([ROAD, SIDE]);
      dc = tileCenter(destTile);
      tries += 1;
    } while (Math.hypot(dc.x - pc.x, dc.y - pc.y) < 600 && tries < 30);
    vip = { x: pc.x, y: pc.y, phase: Math.random() * 6.28, dead: false, following: false };
    mission = {
      type: "escort",
      dx: dc.x, dy: dc.y, phase: Math.random() * 6.28,
      deadline: t + Math.hypot(dc.x - pc.x, dc.y - pc.y) / 90 + 30,
      reward: 400
    };
    say("VIP escort — reach them on foot (marker), then walk them to the blue marker.");
  }
  function offerMission(t) {
    var type = MISSION_TYPES[Math.floor(Math.random() * MISSION_TYPES.length)];
    if (type === "circuit") { offerCircuitMission(t); return; }
    if (type === "steal" && offerStealMission(t)) return;
    if (type === "ram" && offerRamMission(t)) return;
    if (type === "rampage" && offerRampageMission(t)) return;
    if (type === "escort") { offerEscortMission(t); return; }
    offerDeliveryMission(t);
  }
  function deliveryMissionStep(t) {
    var dx = mission.x - player.x, dy = mission.y - player.y;
    if (dx * dx + dy * dy < 42 * 42) {
      completeMission(mission.reward);
      say("Delivery complete. +" + mission.reward + ". Filed locally.");
      mission = null;
      nextMissionAt = t + 12;
      return;
    }
    if (t > mission.deadline) {
      say("Delivery missed. No harm done, no network involved.");
      mission = null;
      nextMissionAt = t + 15;
    }
  }
  function circuitMissionStep(t) {
    var cp = mission.checkpoints[mission.cpIndex];
    var dx = cp.x - player.x, dy = cp.y - player.y;
    if (dx * dx + dy * dy < 42 * 42) {
      mission.cpIndex += 1;
      if (mission.cpIndex >= mission.checkpoints.length) {
        completeMission(mission.reward);
        say("Circuit complete. +" + mission.reward + ". Filed locally.");
        mission = null;
        nextMissionAt = t + 12;
      } else {
        say("Checkpoint " + mission.cpIndex + "/" + mission.checkpoints.length + ".");
      }
      return;
    }
    if (t > mission.deadline) {
      say("Circuit missed. No harm done, no network involved.");
      mission = null;
      nextMissionAt = t + 15;
    }
  }
  function stealMissionStep(t) {
    if (mission.targetCar.wrecked) {
      say("Contract failed — that car's totaled now.");
      mission = null;
      nextMissionAt = t + 15;
      return;
    }
    if (t > mission.deadline) {
      say("Contract expired. The car moved on without you.");
      mission = null;
      nextMissionAt = t + 15;
    }
  }
  function ramMissionStep(t) {
    if (mission.targetCar.wrecked) {
      completeMission(mission.reward);
      say("Contract complete. +" + mission.reward + ". That car's not going anywhere.");
      mission = null;
      nextMissionAt = t + 12;
      return;
    }
    if (t > mission.deadline) {
      say("Contract expired. It got away.");
      mission = null;
      nextMissionAt = t + 15;
    }
  }
  function rampageMissionStep(t) {
    if (mission.count >= mission.need) {
      completeMission(mission.reward);
      say("Rampage complete — " + mission.count + " wrecks. +" + mission.reward + ". The city sighs.");
      mission = null;
      nextMissionAt = t + 12;
      return;
    }
    if (t > mission.deadline) {
      say("Rampage fizzled — " + mission.count + "/" + mission.need + " wrecks. Underwhelming.");
      mission = null;
      nextMissionAt = t + 15;
    }
  }
  function escortMissionStep(t) {
    if (!vip || vip.dead) { mission = null; return; }
    if (vip.following) {
      var dx = mission.dx - vip.x, dy = mission.dy - vip.y;
      if (dx * dx + dy * dy < 46 * 46) {
        completeMission(mission.reward);
        say("VIP delivered safely. +" + mission.reward + ".");
        mission = null; vip = null;
        nextMissionAt = t + 14;
        return;
      }
    }
    if (t > mission.deadline) {
      say("Escort timed out. The VIP walked off.");
      mission = null; vip = null;
      nextMissionAt = t + 15;
    }
  }
  function vipStep(dt) {
    if (!mission || mission.type !== "escort" || !vip || vip.dead) return;
    vip.phase += dt * 8;
    if (!vip.following) {
      var dx0 = player.x - vip.x, dy0 = player.y - vip.y;
      if (dx0 * dx0 + dy0 * dy0 < 40 * 40 && !player.inCar) {
        vip.following = true;
        say("VIP is following you. Get them to the blue marker.");
      }
      return;
    }
    var dx = player.x - vip.x, dy = player.y - vip.y;
    var dist = Math.hypot(dx, dy);
    if (dist > 34) {
      var sp = 95;
      var nx = vip.x + (dx / dist) * sp * dt;
      var ny = vip.y + (dy / dist) * sp * dt;
      if (!circleHitsBuilding(nx, vip.y, 8)) vip.x = nx;
      if (!circleHitsBuilding(vip.x, ny, 8)) vip.y = ny;
    }
  }
  function missionStep(t) {
    if (busted > 0) return;
    if (!mission) {
      if (t >= nextMissionAt) offerMission(t);
      return;
    }
    if (mission.type === "circuit") { circuitMissionStep(t); return; }
    if (mission.type === "steal") { stealMissionStep(t); return; }
    if (mission.type === "ram") { ramMissionStep(t); return; }
    if (mission.type === "rampage") { rampageMissionStep(t); return; }
    if (mission.type === "escort") { escortMissionStep(t); return; }
    deliveryMissionStep(t);
  }

  /* The one place that resolves "where is the current mission pointing"
     (B1) — drawMission's marker, the minimap blip and the off-screen
     objective arrow all read through this instead of each carrying their
     own copy of the dispatch. Writes into the caller's out object so the
     render loop never allocates; returns null when there is no pointable
     target (no mission, dead VIP, rampage has no fixed spot). */
  var missionTargetScratch = { x: 0, y: 0 };
  function missionTargetPos(out) {
    if (!mission) return null;
    if (mission.type === "circuit") {
      var cp = mission.checkpoints[mission.cpIndex];
      out.x = cp.x; out.y = cp.y;
      return out;
    }
    if (mission.type === "steal" || mission.type === "ram") {
      if (!mission.targetCar) return null;
      out.x = mission.targetCar.x; out.y = mission.targetCar.y;
      return out;
    }
    if (mission.type === "escort") {
      if (!vip || vip.dead) return null;
      if (vip.following) { out.x = mission.dx; out.y = mission.dy; }
      else { out.x = vip.x; out.y = vip.y; }
      return out;
    }
    if (mission.type === "rampage") return null; // no fixed target — count wrecks
    out.x = mission.x; out.y = mission.y;
    return out;
  }

  /* ---------------------------------------------------------- law */
  function inHideout() {
    if (typeAtPx(player.x, player.y) !== PARK) return false;
    for (var i = 0; i < cops.length; i += 1) {
      var dx = cops[i].x - player.x, dy = cops[i].y - player.y;
      if (dx * dx + dy * dy < 400 * 400) return false;
    }
    return true;
  }
  function evasionStep(dt) {
    var tx = Math.floor(player.x / TILE), ty = Math.floor(player.y / TILE);
    var atShop = player.inCar && !player.inCar.wrecked && isPaintShop(tx, ty);
    if (atShop) {
      paintTimer += dt;
      if (!paintDone && paintTimer > 2 && wanted > 0) {
        wanted = Math.max(0, wanted - 2);
        player.inCar.color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
        if (player.inCar.owned) saveGarage(player.inCar);
        say("Fresh coat, new plates. The paint shop doesn't ask questions.");
        paintDone = true;
      }
    } else {
      paintTimer = 0; paintDone = false;
    }

    var atGarage = player.inCar && !player.inCar.wrecked && isGarage(tx, ty);
    if (atGarage) {
      garageTimer += dt;
      if (!garageDone && garageTimer > 2) {
        player.inCar.owned = true;
        saveGarage(player.inCar);
        stats.garageSaves = (stats.garageSaves || 0) + 1;
        saveStats();
        unlockAch("collector");
        say("Saved to the garage. It'll be waiting next time, tuning and all.");
        garageDone = true;
      }
    } else {
      garageTimer = 0; garageDone = false;
    }

    var atGas = player.inCar && !player.inCar.wrecked && isGasStation(tx, ty);
    if (atGas) {
      gasTimer += dt;
      if (!gasDone && gasTimer > 2 && score >= 150 && (player.health < 100 || player.inCar.health < 100)) {
        score -= 150;
        player.health = 100;
        player.inCar.health = 100;
        if (player.inCar.owned) saveGarage(player.inCar);
        sfxPickup();
        say("Full repair, -150. The gas station takes cash, not questions.");
        gasDone = true;
      }
    } else {
      gasTimer = 0; gasDone = false;
    }

    var atMart = !player.inCar && isMart(tx, ty);
    if (atMart) {
      martTimer += dt;
      if (!martDone && martTimer > 2 && wanted > 0 && score >= 300) {
        score -= 300;
        wanted = Math.max(0, wanted - 1);
        lastCrime = now() - 8; // lets decay resume immediately instead of waiting out the usual cooldown
        sfxPickup();
        say("Paid the clerk to forget your face. -300, -1 star.");
        martDone = true;
      }
    } else {
      martTimer = 0; martDone = false;
    }
  }
  function roadblockCount() {
    var n = 0;
    for (var i = 0; i < cars.length; i += 1) { if (cars[i].roadblock) n += 1; }
    return n;
  }
  function spawnRoadblock() {
    var heading = (player.vx || player.vy) ? Math.atan2(player.vy, player.vx) : player.a;
    for (var tries = 0; tries < 30; tries += 1) {
      var dist = 350 + Math.random() * 300;
      var spread = (Math.random() - 0.5) * 0.6;
      var x = player.x + Math.cos(heading + spread) * dist;
      var y = player.y + Math.sin(heading + spread) * dist;
      if (typeAtPx(x, y) === ROAD) {
        var rb = makeCar(x, y, Math.floor(Math.random() * 4), true);
        rb.roadblock = true;
        rb.color = "#dfe3ea";
        cars.push(rb);
        return;
      }
    }
  }
  function despawnRoadblocks() {
    for (var i = cars.length - 1; i >= 0; i -= 1) {
      if (cars[i].roadblock && !cars[i].player) cars.splice(i, 1);
    }
  }
  function spawnHeli() {
    if (heli) return;
    var ang = Math.random() * Math.PI * 2;
    heli = { x: player.x + Math.cos(ang) * 700, y: player.y + Math.sin(ang) * 700, vx: 0, vy: 0 };
  }
  function despawnHeli() { heli = null; }
  function heliStep(dt) {
    if (!heli) return;
    var dx = player.x - heli.x, dy = player.y - heli.y;
    var dist = Math.hypot(dx, dy) || 1;
    var topSpeed = 290 * settings.cops;
    var tvx = (dx / dist) * topSpeed, tvy = (dy / dist) * topSpeed;
    heli.vx += (tvx - heli.vx) * Math.min(1, 1.6 * dt);
    heli.vy += (tvy - heli.vy) * Math.min(1, 1.6 * dt);
    heli.x += heli.vx * dt; heli.y += heli.vy * dt;
  }
  function lawStep(t, dt) {
    if (settings.peaceful) {
      if (wanted > 0 || cops.length) { wanted = 0; cops.length = 0; }
      despawnRoadblocks(); despawnHeli();
      return;
    }
    if (wanted >= 5) {
      stats.fiveStarSeconds += dt;
      if (stats.fiveStarSeconds > 20) unlockAch("mostWanted");
    }
    var heliActive = heli && Math.hypot(heli.x - player.x, heli.y - player.y) < 260;
    var decayGap = (inHideout() ? 1 : 4) * settings.cops * (heliActive ? 4 : 1);
    if (wanted > 0 && t - lastCrime > 7 && t - lastDecay > decayGap) {
      lastDecay = t;
      wanted -= 1;
      if (wanted === 0) say("The heat cooled down. Locally.");
    }
    while (cops.length < wanted && t - lastCopSpawn > 1.5 / settings.cops) {
      lastCopSpawn = t;
      var ang = Math.random() * Math.PI * 2;
      // B8 — at 5 stars the response tightens: SWAT variants spawn in a
      // closer ring (600–1000 instead of 700–1400) and run ×1.2 speed.
      var swat = wanted >= 5;
      var rStart = swat ? 600 : 700, rEnd = swat ? 1000 : 1400;
      for (var r = rStart; r < rEnd; r += 100) {
        var x = player.x + Math.cos(ang) * r;
        var y = player.y + Math.sin(ang) * r;
        if (typeAtPx(x, y) === ROAD) { cops.push({ x: x, y: y, a: 0, speed: 0, flash: 0, avoidDir: 0, avoidUntil: 0, stunUntil: 0, swat: swat }); break; }
      }
    }
    if (wanted >= 5) {
      for (var sw = 0; sw < cops.length; sw += 1) cops[sw].swat = true;
    }
    if (wanted === 0 && cops.length) cops.length = 0;
    // escalation (item 4): roadblocks from 3 stars, a helicopter from 4 —
    // both scale/gate with settings.cops and vanish once heat drops back.
    if (wanted >= 3 && roadblockCount() < 3 && t - lastRoadblockCheck > 4) {
      lastRoadblockCheck = t;
      spawnRoadblock();
    }
    if (wanted < 3 && roadblockCount() > 0) despawnRoadblocks();
    if (wanted >= 4) spawnHeli(); else despawnHeli();
    for (var i = 0; i < cops.length; i += 1) {
      copStep(cops[i], dt, t);
      var dx = cops[i].x - player.x, dy = cops[i].y - player.y;
      if (dx * dx + dy * dy < 36 * 36 && busted <= 0) {
        busted = 2.4;
        sfxBust();
        say("BUSTED. Processed, fined, and released — entirely on this machine.");
      }
    }
  }

  /* the bust countdown runs from frame() even while the sim is frozen for
     the bust (see the "known bug" note in the improvement plan: this used
     to live inside lawStep, which frame() stops calling once busted > 0,
     so the BUSTED screen never used to end). */
  function endBust() {
    wanted = 0; cops.length = 0;
    if (player.inCar) {
      player.inCar.player = false; player.inCar.parked = true;
      player.inCar.speed = 0; player.inCar.vx = 0; player.inCar.vy = 0;
      player.inCar = null;
    }
    player.x = spawn.x; player.y = spawn.y; player.vx = 0; player.vy = 0;
    player.health = 100;
    pushScoreHash(Math.max(best, score)); // B9 — bust prints your number into the URL
  }

  function particlesStep(dt) {
    for (var i = particles.length - 1; i >= 0; i -= 1) {
      var p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === "smoke") p.r += 14 * dt;
      if (p.kind === "puff") p.r += 7 * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (var s = skids.length - 1; s >= 0; s -= 1) {
      skids[s].life -= dt;
      if (skids[s].life <= 0) skids.splice(s, 1);
    }
    // B5 — pistol tracers are 4-frame line particles, same lifecycle shape.
    for (var tr = tracers.length - 1; tr >= 0; tr -= 1) {
      tracers[tr].life -= dt;
      if (tracers[tr].life <= 0) tracers.splice(tr, 1);
    }
    for (var e = events.length - 1; e >= 0; e -= 1) {
      events[e].life -= dt;
      if (events[e].life <= 0) events.splice(e, 1);
    }
  }

  /* ---------------------------------------------------------- minimap */
  var MM = 150;
  var mmCanvas = document.createElement("canvas");
  mmCanvas.width = MM; mmCanvas.height = MM;
  (function buildMinimap() {
    var m = mmCanvas.getContext("2d");
    var s = MM / WORLD;
    m.fillStyle = "rgba(10,13,18,0.9)";
    m.fillRect(0, 0, MM, MM);
    for (var ty = 0; ty < WORLD; ty += 1) {
      for (var tx = 0; tx < WORLD; tx += 1) {
        var t = tileType(tx, ty);
        if (t === ROAD) m.fillStyle = "#39414f";
        else if (t === PARK) m.fillStyle = "#20361f";
        else if (t === WATER) m.fillStyle = "#0d2740";
        else continue;
        m.fillRect(tx * s, ty * s, Math.ceil(s), Math.ceil(s));
      }
    }
  })();

  /* ---------------------------------------------------------- drawing */
  function resize() {
    var rect = canvas.parentNode.getBoundingClientRect();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    view.w = rect.width; view.h = rect.height;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  function inView(x, y, pad) {
    // camZoom < 1 (S10 speed zoom-out) widens the visible world rect in
    // screen space, so every culling check needs the same extra pad or
    // entities pop in/out near the edges — computed once here so every
    // drawX() call site benefits without touching them individually.
    var p = pad + (camZoom < 1 ? (1 / camZoom - 1) * Math.max(view.w, view.h) : 0);
    return x > -p && y > -p && x < view.w + p && y < view.h + p;
  }

  function drawTiles() {
    var minTx = Math.max(0, Math.floor(cam.x / TILE));
    var maxTx = Math.min(WORLD - 1, Math.floor((cam.x + view.w) / TILE));
    var minTy = Math.max(0, Math.floor(cam.y / TILE));
    var maxTy = Math.min(WORLD - 1, Math.floor((cam.y + view.h) / TILE));
    for (var ty = minTy; ty <= maxTy; ty += 1) {
      for (var tx = minTx; tx <= maxTx; tx += 1) {
        var type = tileType(tx, ty);
        var x = tx * TILE - cam.x, y = ty * TILE - cam.y;
        var rx = tx % 10, ry = ty % 10;
        if (type === ROAD) {
          ctx.fillStyle = hash2(tx, ty) > 0.5 ? "#12161d" : "#141821";
          ctx.fillRect(x, y, TILE, TILE);
          // worn patches, asphalt speckle and the occasional manhole
          if (hash2(tx * 5, ty * 13) > 0.85) {
            ctx.fillStyle = "rgba(0,0,0,0.20)";
            ctx.fillRect(x + 5 + hash2(tx, ty * 3) * 14, y + 6 + hash2(tx * 3, ty) * 14, 20, 13);
          }
          ctx.fillStyle = "rgba(255,255,255,0.035)";
          ctx.fillRect(x + 8 + hash2(tx * 11, ty * 7) * 26, y + 6 + hash2(tx, ty * 9) * 30, 5, 3);
          ctx.fillRect(x + 6 + hash2(tx * 19, ty * 23) * 28, y + 8 + hash2(tx * 7, ty * 17) * 28, 4, 3);
          if (hash2(tx * 17, ty * 19) > 0.955 && rx >= 1 && ry >= 1) {
            ctx.fillStyle = "rgba(255,255,255,0.06)";
            ctx.beginPath(); ctx.arc(x + TILE / 2, y + TILE / 2, 5.5, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = "rgba(0,0,0,0.45)";
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(x + TILE / 2, y + TILE / 2, 5.5, 0, Math.PI * 2); ctx.stroke();
          }
          ctx.fillStyle = "rgba(255,255,255,0.13)";
          if (rx === 1 && ry >= 3 && ty % 2 === 0) ctx.fillRect(x + TILE / 2 - 1, y + 6, 2, TILE - 12);
          if (ry === 1 && rx >= 3 && tx % 2 === 0) ctx.fillRect(x + 6, y + TILE / 2 - 1, TILE - 12, 2);
          if ((rx < 3 && (ry === 3 || ry === 9)) || (ry < 3 && (rx === 3 || rx === 9))) {
            ctx.fillStyle = "rgba(255,255,255,0.16)";
            if (rx < 3) { for (var i = 0; i < 4; i += 1) ctx.fillRect(x + 4 + i * 12, y + 4, 6, TILE - 8); }
            else { for (var k = 0; k < 4; k += 1) ctx.fillRect(x + 4, y + 4 + k * 12, TILE - 8, 6); }
          }
          ctx.fillStyle = "rgba(255,255,255,0.10)";
          if (tileType(tx, ty - 1) === SIDE) ctx.fillRect(x, y, TILE, 2);
          if (tileType(tx, ty + 1) === SIDE) ctx.fillRect(x, y + TILE - 2, TILE, 2);
          if (tileType(tx - 1, ty) === SIDE) ctx.fillRect(x, y, 2, TILE);
          if (tileType(tx + 1, ty) === SIDE) ctx.fillRect(x + TILE - 2, y, 2, TILE);
          // A1 — wet-road sheen while raining: a cool tint whose strength
          // follows the storm intensity (Unity swaps in a glossier/darker
          // wet-ground material per block; this is the 2D equivalent).
          if (weatherRain) {
            ctx.fillStyle = "rgba(96,128,170," + (0.05 + 0.06 * rainIntensity).toFixed(3) + ")";
            ctx.fillRect(x, y, TILE, TILE);
          }
        } else if (type === SIDE) {
          ctx.fillStyle = "#1d232e";
          ctx.fillRect(x, y, TILE, TILE);
          ctx.strokeStyle = "rgba(0,0,0,0.28)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x + TILE / 2 + 0.5, y); ctx.lineTo(x + TILE / 2 + 0.5, y + TILE);
          ctx.moveTo(x, y + TILE / 2 + 0.5); ctx.lineTo(x + TILE, y + TILE / 2 + 0.5);
          ctx.stroke();
          ctx.strokeStyle = "rgba(255,255,255,0.05)";
          ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
        } else if (type === PARK) {
          ctx.fillStyle = "#152a19";
          ctx.fillRect(x, y, TILE, TILE);
          if (hash2(tx * 3, ty * 3) > 0.6) {
            ctx.fillStyle = "#1a3320";
            ctx.fillRect(x + 8, y + 8, TILE - 16, TILE - 16);
          }
        } else if (type === WATER) {
          ctx.fillStyle = hash2(tx, ty) > 0.5 ? "#0a2035" : "#0c2740";
          ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = "rgba(140,190,255,0.06)";
          ctx.fillRect(x + 4 + hash2(tx * 11, ty * 7) * 30, y + 4 + hash2(tx * 3, ty * 13) * 30, 7, 2);
          ctx.fillRect(x + 2 + hash2(tx * 19, ty * 23) * 30, y + 20 + hash2(tx * 7, ty * 17) * 20, 6, 2);
        }
      }
    }
  }

  function drawStadiumBlock(x0, y0, w, h) {
    // bespoke render for the fixed 2x2-block stadium footprint (see
    // isStadiumBlock/STADIUM above) — a bowl + four floodlights instead
    // of the generic building extrusion every other block gets.
    var cx = x0 + w / 2, cy = y0 + h / 2;
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath(); ctx.ellipse(cx + 6, cy + 8, w / 2 + 6, h / 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#1b222c";
    ctx.beginPath(); ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#16321c";
    ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(4, w / 2 - 26), Math.max(4, h / 2 - 26), 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(6, w / 2 - 10), Math.max(6, h / 2 - 10), 0, 0, Math.PI * 2); ctx.stroke();
    var corners = [[x0 + 14, y0 + 14], [x0 + w - 14, y0 + 14], [x0 + 14, y0 + h - 14], [x0 + w - 14, y0 + h - 14]];
    for (var i = 0; i < corners.length; i += 1) {
      var px = corners[i][0], py = corners[i][1];
      ctx.fillStyle = "#0b0d11";
      ctx.fillRect(px - 3, py - 24, 6, 24);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(255,246,214,0.10)";
      ctx.beginPath(); ctx.arc(px, py - 26, 22, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#fff6d6";
      ctx.beginPath(); ctx.arc(px, py - 26, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  /* ------------------------------------------------------ districts (A2) */
  // Cosmetic block classification ported from Unity's CityRenderer.District:
  // a hash pair DISTINCT from blockHash (same function, salted coords
  // bx*17+3 / by*11+5 — exactly Unity's inputs) so the road/sidewalk/
  // building/park occupancy blockHash decides is untouched and the parity
  // contract with LTA.Core.cs holds. Draw-layer only, inside drawBlocks:
  // Downtown blocks extrude taller with cooler roofs and more neon,
  // Residential rows sit lower with warmer roofs, Industrial blocks stay
  // flat, muted and neon-free. The 0.38/0.72 thresholds mirror Unity's
  // District() exactly.
  var DIST_RESIDENTIAL = 0, DIST_DOWNTOWN = 1, DIST_INDUSTRIAL = 2;
  function district(bx, by) {
    var h = blockHash(bx * 17 + 3, by * 11 + 5);
    if (h < 0.38) return DIST_RESIDENTIAL;
    if (h < 0.72) return DIST_DOWNTOWN;
    return DIST_INDUSTRIAL;
  }
  var DIST_PALETTES = [
    ["#201a14", "#241d16", "#271f18", "#1d1812"],  // residential — warm (Unity lerps toward #6d5a3f)
    ["#141c2c", "#16202e", "#182536", "#131a25"],  // downtown — cool blue
    ["#17191d", "#191b1f", "#1a1d21", "#15171a"]   // industrial — flat muted gray (Unity lerps toward #4b5058)
  ];

  function drawBlocks() {
    var minBx = Math.max(0, Math.floor(cam.x / (TILE * 10)) - 1);
    var maxBx = Math.min(Math.floor(WORLD / 10), Math.floor((cam.x + view.w) / (TILE * 10)) + 1);
    var minBy = Math.max(0, Math.floor(cam.y / (TILE * 10)) - 1);
    var maxBy = Math.min(Math.floor(WORLD / 10), Math.floor((cam.y + view.h) / (TILE * 10)) + 1);
    for (var by = minBy; by <= maxBy; by += 1) {
      for (var bx = minBx; bx <= maxBx; bx += 1) {
        var x0 = (bx * 10 + 4) * TILE - cam.x;
        var y0 = (by * 10 + 4) * TILE - cam.y;
        var w = 5 * TILE, h = 5 * TILE;
        if (x0 + w + 90 < 0 || y0 + h + 90 < 0 || x0 - 90 > view.w || y0 - 90 > view.h) continue;
        if (isStadiumBlock(bx, by)) { drawStadiumBlock(x0, y0, w, h); continue; }
        var bh = blockHash(bx, by);
        if (bh < 0.16) {
          for (var i = 0; i < 6; i += 1) {
            var th = hash2(bx * 31 + i, by * 17 + i);
            var px = x0 + 20 + th * (w - 40);
            var py = y0 + 20 + hash2(bx * 13 + i, by * 29 + i) * (h - 40);
            ctx.fillStyle = "rgba(0,0,0,0.35)";
            ctx.beginPath(); ctx.ellipse(px + 3, py + 4, 12, 6, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#1f4a26";
            ctx.beginPath(); ctx.arc(px, py, 11, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#2a5f31";
            ctx.beginPath(); ctx.arc(px - 3, py - 3, 6, 0, Math.PI * 2); ctx.fill();
          }
          continue;
        }
        // 2.5D extrusion: the roof shifts away from screen center, exposing
        // the two wall faces that look toward the camera.
        // A2 — the district shapes the fake-height lift (Downtown spires,
        // Residential low rows, Industrial slabs), mirroring Unity's
        // per-district heightMul bands (1.8+h*1.3 / ~1.0 / 0.55).
        var dist = district(bx, by);
        var lift = dist === DIST_DOWNTOWN ? 0.05 + bh * 0.075
          : dist === DIST_INDUSTRIAL ? 0.012 + bh * 0.014
          : 0.02 + bh * 0.032;
        var ox = (x0 + w / 2 - view.w / 2) * lift;
        var oy = (y0 + h / 2 - view.h / 2) * lift;
        var rx0 = x0 + ox, ry0 = y0 + oy;
        ctx.fillStyle = "rgba(0,0,0,0.42)";
        ctx.fillRect(x0 + 7, y0 + 9, w, h);
        if (ox > 0.5 || ox < -0.5) {
          var fx = ox > 0 ? x0 : x0 + w;
          ctx.fillStyle = "#121822";
          ctx.beginPath();
          ctx.moveTo(fx, y0); ctx.lineTo(fx, y0 + h);
          ctx.lineTo(fx + ox, y0 + h + oy); ctx.lineTo(fx + ox, y0 + oy);
          ctx.closePath(); ctx.fill();
        }
        if (oy > 0.5 || oy < -0.5) {
          var fy = oy > 0 ? y0 : y0 + h;
          ctx.fillStyle = "#0d1219";
          ctx.beginPath();
          ctx.moveTo(x0, fy); ctx.lineTo(x0 + w, fy);
          ctx.lineTo(x0 + w + ox, fy + oy); ctx.lineTo(x0 + ox, fy + oy);
          ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = DIST_PALETTES[dist][Math.floor(bh * DIST_PALETTES[dist].length)];
        ctx.fillRect(rx0, ry0, w, h);
        ctx.strokeStyle = "rgba(255,255,255,0.07)";
        ctx.strokeRect(rx0 + 6.5, ry0 + 6.5, w - 13, h - 13);
        // A2 — industrial roofs stay flat: one utility box, no clutter.
        var n = dist === DIST_INDUSTRIAL ? 1 : 2 + Math.floor(bh * 3);
        for (var q = 0; q < n; q += 1) {
          var qx = rx0 + 16 + hash2(bx * 7 + q, by * 5 + q) * (w - 56);
          var qy = ry0 + 16 + hash2(bx * 3 + q, by * 11 + q) * (h - 56);
          ctx.fillStyle = "rgba(0,0,0,0.30)";
          ctx.fillRect(qx + 2, qy + 3, 22, 16);
          ctx.fillStyle = "#232c3a";
          ctx.fillRect(qx, qy, 22, 16);
          ctx.fillStyle = "rgba(255,255,255,0.08)";
          ctx.fillRect(qx + 3, qy + 3, 16, 4);
        }
        // A2 — neon density follows the district: Downtown lights up early
        // ("more neon" in Unity's District comment), Residential rarely,
        // Industrial never (threshold 1.1 is unreachable).
        var neonAt = dist === DIST_DOWNTOWN ? 0.68 : dist === DIST_RESIDENTIAL ? 0.88 : 1.1;
        if (bh > neonAt) {
          var neon = bh > neonAt + 0.08 ? "rgba(79,180,255,0.75)" : "rgba(255,178,36,0.75)";
          ctx.fillStyle = neon;
          ctx.fillRect(rx0 + 14, ry0 + h - 6, w - 28, 3);
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.fillStyle = bh > neonAt + 0.08 ? "rgba(79,180,255,0.10)" : "rgba(255,178,36,0.10)";
          ctx.fillRect(rx0 + 10, ry0 + h - 16, w - 20, 20);
          ctx.restore();
        }
      }
    }
  }

  function isPaintShop(tx, ty) {
    var rx = tx % 10, ry = ty % 10;
    if (!((rx === 3 || rx === 9) && (ry === 3 || ry === 9))) return false;
    return hash2(tx * 31, ty * 37) < 0.05;
  }

  function drawStreetProps() {
    var minTx = Math.max(0, Math.floor(cam.x / TILE));
    var maxTx = Math.min(WORLD - 1, Math.floor((cam.x + view.w) / TILE));
    var minTy = Math.max(0, Math.floor(cam.y / TILE));
    var maxTy = Math.min(WORLD - 1, Math.floor((cam.y + view.h) / TILE));
    for (var ty = minTy; ty <= maxTy; ty += 1) {
      for (var tx = minTx; tx <= maxTx; tx += 1) {
        if (tileType(tx, ty) !== SIDE) continue;
        var rx = tx % 10, ry = ty % 10;
        var corner = (rx === 3 || rx === 9) && (ry === 3 || ry === 9);
        var x = tx * TILE - cam.x, y = ty * TILE - cam.y;
        if (corner && isPaintShop(tx, ty)) {
          ctx.fillStyle = "rgba(200,90,220,0.9)";
          ctx.fillRect(x + 6, y + 6, TILE - 12, TILE - 12);
          ctx.strokeStyle = "rgba(255,255,255,0.5)";
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 6, y + 6, TILE - 12, TILE - 12);
          ctx.fillStyle = "#fff";
          ctx.font = "10px 'IBM Plex Mono', monospace";
          ctx.textAlign = "center";
          ctx.fillText("PAINT", x + TILE / 2, y + TILE / 2 - 5);
          ctx.textAlign = "left";
        } else if (corner && isGarage(tx, ty)) {
          ctx.fillStyle = "rgba(90,200,140,0.9)";
          ctx.fillRect(x + 6, y + 6, TILE - 12, TILE - 12);
          ctx.strokeStyle = "rgba(255,255,255,0.5)";
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 6, y + 6, TILE - 12, TILE - 12);
          ctx.fillStyle = "#fff";
          ctx.font = "10px 'IBM Plex Mono', monospace";
          ctx.textAlign = "center";
          ctx.fillText("GARAGE", x + TILE / 2, y + TILE / 2 - 5);
          ctx.textAlign = "left";
        } else if (corner && isGasStation(tx, ty)) {
          ctx.fillStyle = "rgba(90,150,220,0.9)";
          ctx.fillRect(x + 6, y + 6, TILE - 12, TILE - 12);
          ctx.strokeStyle = "rgba(255,255,255,0.5)";
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 6, y + 6, TILE - 12, TILE - 12);
          ctx.fillStyle = "#fff";
          ctx.font = "10px 'IBM Plex Mono', monospace";
          ctx.textAlign = "center";
          ctx.fillText("GAS", x + TILE / 2, y + TILE / 2 - 5);
          ctx.textAlign = "left";
        } else if (corner && isMart(tx, ty)) {
          ctx.fillStyle = "rgba(90,205,210,0.9)";
          ctx.fillRect(x + 6, y + 6, TILE - 12, TILE - 12);
          ctx.strokeStyle = "rgba(255,255,255,0.5)";
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 6, y + 6, TILE - 12, TILE - 12);
          ctx.fillStyle = "#fff";
          ctx.font = "10px 'IBM Plex Mono', monospace";
          ctx.textAlign = "center";
          ctx.fillText("MART", x + TILE / 2, y + TILE / 2 - 5);
          ctx.textAlign = "left";
        } else if (corner && hash2(tx, ty) < 0.6) {
          // streetlights dim during the dawn/dusk phase (dayAmt) instead
          // of switching off — the city is never fully daylit.
          var glowAmt = 0.10 * (1 - dayAmt * 0.6);
          var gx = x + (rx === 3 ? -20 : TILE + 20);
          var gy = y + (ry === 3 ? -20 : TILE + 20);
          var g = ctx.createRadialGradient(gx, gy, 4, gx, gy, 80);
          g.addColorStop(0, "rgba(255,214,140," + glowAmt.toFixed(3) + ")");
          g.addColorStop(1, "rgba(255,214,140,0)");
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(gx, gy, 80, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#ffd68c";
          ctx.beginPath(); ctx.arc(x + TILE / 2, y + TILE / 2, 2.4, 0, Math.PI * 2); ctx.fill();
        } else if (!corner && hash2(tx * 5, ty * 5) < 0.12) {
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          ctx.beginPath(); ctx.ellipse(x + TILE / 2 + 3, y + TILE / 2 + 4, 12, 6, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#1f4a26";
          ctx.beginPath(); ctx.arc(x + TILE / 2, y + TILE / 2, 10, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }

  function drawSkids() {
    for (var i = 0; i < skids.length; i += 1) {
      var s = skids[i];
      var x = s.x - cam.x, y = s.y - cam.y;
      if (!inView(x, y, 20)) continue;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(s.a);
      ctx.globalAlpha = Math.min(0.5, s.life / 8);
      ctx.fillStyle = "#000";
      ctx.fillRect(-3, -8, 6, 3);
      ctx.fillRect(-3, 5, 6, 3);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i += 1) {
      var p = particles[i];
      var x = p.x - cam.x, y = p.y - cam.y;
      if (!inView(x, y, 30)) continue;
      if (p.kind === "smoke") {
        ctx.fillStyle = "rgba(160,166,178," + (0.28 * Math.max(0, p.life)).toFixed(2) + ")";
        ctx.beginPath(); ctx.arc(x, y, p.r, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === "puff") {
        ctx.fillStyle = "rgba(150,156,168," + (0.12 * Math.max(0, p.life)).toFixed(2) + ")";
        ctx.beginPath(); ctx.arc(x, y, p.r, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === "rain") {
        // A1 — rain streaks: thin cool lines whose alpha/length follow the
        // storm intensity (Unity: color 0.75/0.82/0.92 @ RainStreakAlpha
        // 0.34, scaled 0.6–1 by intensity; streak length lerps 16→26).
        var rl = 0.02 + 0.012 * rainIntensity;
        ctx.strokeStyle = "rgba(191,209,235," + (0.34 * (0.6 + 0.4 * rainIntensity) * Math.min(1, p.life * 4)).toFixed(3) + ")";
        ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - p.vx * rl, y - p.vy * rl); ctx.stroke();
      } else {
        ctx.strokeStyle = "rgba(255,196,80," + Math.max(0, Math.min(1, p.life * 2.4)).toFixed(2) + ")";
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - p.vx * 0.03, y - p.vy * 0.03); ctx.stroke();
      }
    }
    // B5 — stun tracers.
    for (var q = 0; q < tracers.length; q += 1) {
      var tr = tracers[q];
      var tx = tr.x1 - cam.x, ty = tr.y1 - cam.y;
      if (!inView(tx, ty, 420)) continue;
      ctx.strokeStyle = "rgba(255,240,180," + Math.max(0, Math.min(1, tr.life / 0.16)).toFixed(2) + ")";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tr.x2 - cam.x, tr.y2 - cam.y); ctx.stroke();
    }
  }

  function drawLights(x, y, a, braking) {
    // A1 — rain cuts the headlight throw by ~30% (Unity shortens
    // RenderSettings.fogEndDistance 2600→1500 while raining; this is the
    // 2D equivalent — every car and cop cone reads shorter on wet roads).
    var range = weatherRain ? 100 : 140;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a);
    ctx.globalCompositeOperation = "lighter";
    var g = ctx.createLinearGradient(0, 0, range, 0);
    g.addColorStop(0, "rgba(255,240,200,0.16)");
    g.addColorStop(1, "rgba(255,240,200,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(14, -8); ctx.lineTo(range, -34); ctx.lineTo(range, 34); ctx.lineTo(14, 8);
    ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#fff2c8";
    ctx.fillRect(17, -9, 3, 5);
    ctx.fillRect(17, 4, 3, 5);
    ctx.fillStyle = braking ? "#ff4444" : "rgba(255,68,68,0.55)";
    ctx.fillRect(-21, -9, 3, 5);
    ctx.fillRect(-21, 4, 3, 5);
    if (braking) {
      ctx.fillStyle = "rgba(255,68,68,0.25)";
      ctx.beginPath(); ctx.arc(-24, 0, 10, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawCarBody(x, y, a, color, wrecked, body) {
    // Realism phase 3 — pre-rendered sprite path when marketing/assets.js
    // is loaded; falls back to the old per-frame vector pass otherwise
    // (headless test harness, file-less edge cases). Same transform origin
    // and visual footprint either way, so collision circles don't move.
    var sp = window.LTA_SPRITES && window.LTA_SPRITES.car && window.LTA_SPRITES.car(color, body || "sedan", wrecked);
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a);
    if (sp) { ctx.drawImage(sp, -sp.width / 2, -sp.height / 2); ctx.restore(); return; }
    var bodyCol = wrecked ? "#2b2b2b" : color; // vector fallback path
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(2, 4, 21, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#0a0c10";
    ctx.fillRect(-16, -12.5, 8, 3.5); ctx.fillRect(-16, 9, 8, 3.5);
    ctx.fillRect(9, -12.5, 8, 3.5); ctx.fillRect(9, 9, 8, 3.5);
    ctx.fillStyle = bodyCol;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(-20, -11, 40, 22, 5); ctx.fill(); }
    else ctx.fillRect(-20, -11, 40, 22);
    // specular sheen across the body
    var sheen = ctx.createLinearGradient(0, -11, 0, 11);
    sheen.addColorStop(0, "rgba(255,255,255,0.22)");
    sheen.addColorStop(0.45, "rgba(255,255,255,0.03)");
    sheen.addColorStop(1, "rgba(0,0,0,0.28)");
    ctx.fillStyle = sheen;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(-20, -11, 40, 22, 5); ctx.fill(); }
    else ctx.fillRect(-20, -11, 40, 22);
    ctx.fillStyle = "rgba(10,14,20,0.78)";
    ctx.fillRect(4, -8, 8, 16);
    ctx.fillRect(-14, -8, 6, 16);
    ctx.fillStyle = "rgba(160,200,255,0.12)";
    ctx.fillRect(4, -8, 8, 5);
    // mirrors
    ctx.fillStyle = body;
    ctx.fillRect(2, -13.5, 3, 2.5);
    ctx.fillRect(2, 11, 3, 2.5);
    ctx.restore();
  }

  function drawCar(c) {
    var x = c.x - cam.x, y = c.y - cam.y;
    if (!inView(x, y, 140)) return;
    if (!c.parked) drawLights(x, y, c.a, c.brake);
    drawCarBody(x, y, c.a, c.color, c.wrecked, c.body);
    if (c.roadblock) {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(c.a);
      ctx.fillStyle = "rgba(255,178,36,0.85)";
      ctx.fillRect(-20, -4, 40, 3);
      ctx.fillRect(-20, 1, 40, 3);
      ctx.restore();
    }
  }
  function drawHeli(t) {
    if (!heli) return;
    var x = heli.x - cam.x, y = heli.y - cam.y;
    if (!inView(x, y, 200)) return;
    var g = ctx.createRadialGradient(x, y, 4, x, y, 140);
    g.addColorStop(0, "rgba(255,250,210,0.14)");
    g.addColorStop(1, "rgba(255,250,210,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, 140, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "#0b0d11";
    ctx.beginPath(); ctx.ellipse(0, 0, 12, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.rotate(t * 14);
    ctx.fillStyle = "rgba(200,210,225,0.5)";
    ctx.fillRect(-20, -1, 40, 2);
    ctx.fillRect(-1, -20, 2, 40);
    ctx.restore();
    ctx.fillStyle = Math.floor(t * 7) % 2 ? "#ff5252" : "#4f8cff";
    ctx.beginPath(); ctx.arc(0, 8, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawCop(c, t) {
    var x = c.x - cam.x, y = c.y - cam.y;
    if (!inView(x, y, 140)) return;
    drawLights(x, y, c.a, false);
    ctx.save();
    ctx.translate(x, y); ctx.rotate(c.a);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(2, 4, 21, 12, 0, 0, Math.PI * 2); ctx.fill();
    // B8 — SWAT at 5★: dark body, single lightbar strip instead of the
    // white-paint dual siren pods.
    ctx.fillStyle = c.swat ? "#1a1f2b" : "#dfe3ea";
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(-20, -11, 40, 22, 5); ctx.fill(); }
    else ctx.fillRect(-20, -11, 40, 22);
    ctx.fillStyle = c.swat ? "#2b3242" : "#141821";
    ctx.fillRect(-4, -11, 8, 22);
    if (c.swat) {
      ctx.fillStyle = Math.floor(t * 9) % 2 ? "#ff5252" : "#4f8cff";
      ctx.fillRect(-7, -3, 14, 6);
    }
    ctx.restore();
    var siren = Math.floor(t * 7) % 2;
    var g = ctx.createRadialGradient(x, y, 2, x, y, 46);
    g.addColorStop(0, siren ? "rgba(255,82,82,0.30)" : "rgba(79,140,255,0.30)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, 46, 0, Math.PI * 2); ctx.fill();
    if (!c.swat) {
      ctx.fillStyle = siren ? "#ff5252" : "#4f8cff";
      ctx.fillRect(x - 5, y - 4, 4, 8);
      ctx.fillStyle = siren ? "#4f8cff" : "#ff5252";
      ctx.fillRect(x + 1, y - 4, 4, 8);
    }
  }

  function drawPed(p) {
    var x = p.x - cam.x, y = p.y - cam.y;
    if (!inView(x, y, 30)) return;
    if (p.dead) {
      ctx.fillStyle = "rgba(143,154,171,0.5)";
      ctx.beginPath(); ctx.ellipse(x, y, 10, 5, 0.6, 0, Math.PI * 2); ctx.fill();
      return;
    }
    var step = Math.sin(p.phase * 6) * 3;
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(x + 2, y + 3, 8, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#20242c";
    ctx.beginPath(); ctx.arc(x + step, y + 5, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x - step, y + 5, 2.4, 0, Math.PI * 2); ctx.fill();
    // Realism phase 3 — sprite path when marketing/assets.js is loaded:
    // the ped now actually rotates to its last-move heading (p.moveA,
    // tracked in pedStep) instead of always face-down. Falls back to the
    // original vector pass when the sprite factory is absent.
    var sp = window.LTA_SPRITES && window.LTA_SPRITES.ped && window.LTA_SPRITES.ped(p.shirt, SKINS[p.skin]);
    if (sp) {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(p.moveA || 0);
      ctx.drawImage(sp, -sp.width / 2, -sp.height / 2);
      ctx.restore();
      return;
    }
    ctx.fillStyle = p.shirt;
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = SKINS[p.skin];
    ctx.beginPath(); ctx.arc(x, y - 1, 3.4, 0, Math.PI * 2); ctx.fill();
  }

  function drawVip() {
    if (!mission || mission.type !== "escort" || !vip || vip.dead) return;
    var x = vip.x - cam.x, y = vip.y - cam.y;
    if (!inView(x, y, 30)) return;
    var step = Math.sin(vip.phase) * 3;
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(x + 2, y + 3, 8, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#20242c";
    ctx.beginPath(); ctx.arc(x + step, y + 5, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x - step, y + 5, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#e6c9a8";
    ctx.beginPath(); ctx.arc(x, y - 1, 3.4, 0, Math.PI * 2); ctx.fill();
  }

  function drawPlayer(t) {
    if (player.inCar) return;
    var x = player.x - cam.x, y = player.y - cam.y;
    var moving = player.vx !== 0 || player.vy !== 0;
    var step = Math.sin(t * 10) * (moving ? 3 : 0);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(x + 2, y + 3, 8, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#20242c";
    ctx.beginPath(); ctx.arc(x + step, y + 5, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x - step, y + 5, 2.4, 0, Math.PI * 2); ctx.fill();
    // A4 — the player's on-foot ped wears the pause-menu picks (persisted
    // as settings.skin/settings.shirt); NPCs keep their random rolls.
    // Realism phase 3 — sprite path, rotated to the player's actual facing
    // angle (free-angle, unlike peds' cardinal headings).
    var sp = window.LTA_SPRITES && window.LTA_SPRITES.ped &&
      window.LTA_SPRITES.ped(SHIRT_CHOICES[settings.shirt], SKINS[settings.skin]);
    if (sp) {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(player.a + Math.PI / 2);
      ctx.drawImage(sp, -sp.width / 2, -sp.height / 2);
      ctx.restore();
    } else {
      ctx.fillStyle = SHIRT_CHOICES[settings.shirt];
      ctx.beginPath(); ctx.arc(x, y, 7.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = SKINS[settings.skin];
      ctx.beginPath(); ctx.arc(x + Math.cos(player.a) * 2, y + Math.sin(player.a) * 2 - 1, 3.4, 0, Math.PI * 2); ctx.fill();
    }
    if (player.punchAnim > 0) {
      var reach = player.weapon === "bat" ? 22 : 14;
      ctx.strokeStyle = player.weapon === "bat" ? "rgba(200,160,90,0.9)" : "rgba(255,224,180,0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(player.a) * 6, y + Math.sin(player.a) * 6);
      ctx.lineTo(x + Math.cos(player.a) * (6 + reach), y + Math.sin(player.a) * (6 + reach));
      ctx.stroke();
    }
  }
  function drawWeaponDrops(t) {
    for (var i = 0; i < weaponDrops.length; i += 1) {
      var wd = weaponDrops[i];
      var x = wd.x - cam.x, y = wd.y - cam.y;
      if (!inView(x, y, 40)) continue;
      var pulse = 0.6 + 0.4 * Math.sin(t * 3 + wd.phase);
      ctx.save();
      ctx.translate(x, y);
      if (wd.kind === "pistol") {
        // B5 — stun pistol glyph: slide + grip, cool-blue glow so it reads
        // as non-lethal next to the amber bat.
        ctx.shadowColor = "rgba(140,190,255,0.9)";
        ctx.shadowBlur = 12 * pulse;
        ctx.fillStyle = "rgba(160,190,225," + (0.65 + 0.35 * pulse).toFixed(2) + ")";
        ctx.fillRect(-7, -5, 14, 5);
        ctx.fillRect(-3, 0, 5, 8);
      } else {
        ctx.rotate(Math.PI / 5);
        ctx.shadowColor = "rgba(200,160,90,0.9)";
        ctx.shadowBlur = 12 * pulse;
        ctx.fillStyle = "rgba(200,160,90," + (0.6 + 0.4 * pulse).toFixed(2) + ")";
        ctx.fillRect(-3, -10, 6, 20);
      }
      ctx.restore();
    }
  }

  function drawPackages(t) {
    for (var i = 0; i < packages.length; i += 1) {
      var pk = packages[i];
      var x = pk.x - cam.x, y = pk.y - cam.y;
      if (!inView(x, y, 40)) continue;
      var pulse = 0.6 + 0.4 * Math.sin(t * 3 + pk.phase);
      ctx.save();
      ctx.translate(x, y); ctx.rotate(Math.PI / 4);
      ctx.shadowColor = "rgba(255,178,36,0.9)";
      ctx.shadowBlur = 14 * pulse;
      ctx.fillStyle = "rgba(255,178,36," + (0.55 + 0.45 * pulse).toFixed(2) + ")";
      ctx.fillRect(-7, -7, 14, 14);
      ctx.restore();
    }
  }

  function drawMission(t) {
    var tp = missionTargetPos(missionTargetScratch);
    if (!tp) return;
    var mx = tp.x, my = tp.y;
    if (mission.type === "steal" || mission.type === "ram") my -= 30;
    else if (mission.type === "escort" && vip && !vip.following) my -= 26;
    var x = mx - cam.x, y = my - cam.y;
    if (!inView(x, y, 60)) return;
    var pulse = 0.6 + 0.4 * Math.sin(t * 4 + mission.phase);
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = "rgba(79,140,255,0.9)";
    ctx.shadowBlur = 18 * pulse;
    ctx.fillStyle = "rgba(79,140,255," + (0.55 + 0.45 * pulse).toFixed(2) + ")";
    ctx.beginPath();
    ctx.moveTo(0, -12); ctx.lineTo(10, 4); ctx.lineTo(-10, 4); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /* B1 — off-screen objective arrow. When the active mission target leaves
     the screen, clamp a pulsing chevron to the viewport edge pointing at
     it, with a mono distance readout (world px / 8 ≈ "meters"). Screen
     space, so it draws after the world/vignette and before the HUD. */
  var ARROW_MARGIN = 40;
  function drawObjectiveArrow(t) {
    if (!started || busted > 0 || paused) return;
    var tp = missionTargetPos(missionTargetScratch);
    if (!tp) return;
    var sx = tp.x - cam.x, sy = tp.y - cam.y;
    if (sx > ARROW_MARGIN && sy > ARROW_MARGIN && sx < view.w - ARROW_MARGIN && sy < view.h - ARROW_MARGIN) return;
    var cx = view.w / 2, cy = view.h / 2;
    var dx = sx - cx, dy = sy - cy;
    var scaleX = dx > 0 ? (view.w - ARROW_MARGIN - cx) / dx : dx < 0 ? (ARROW_MARGIN - cx) / dx : Infinity;
    var scaleY = dy > 0 ? (view.h - ARROW_MARGIN - cy) / dy : dy < 0 ? (ARROW_MARGIN - cy) / dy : Infinity;
    var k = Math.min(scaleX, scaleY);
    var ax = cx + dx * k, ay = cy + dy * k;
    var ang = Math.atan2(dy, dx);
    var pulse = 0.65 + 0.35 * Math.sin(t * 6);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    ctx.shadowColor = "rgba(79,140,255,0.9)";
    ctx.shadowBlur = 10 * pulse;
    ctx.fillStyle = "rgba(79,140,255," + (0.6 + 0.4 * pulse).toFixed(2) + ")";
    ctx.beginPath();
    ctx.moveTo(11, 0); ctx.lineTo(-7, -9); ctx.lineTo(-3, 0); ctx.lineTo(-7, 9);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    var meters = Math.round(Math.hypot(tp.x - player.x, tp.y - player.y) / 8);
    ctx.font = "11px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(7,9,13,0.66)";
    var label = meters + "m";
    var lw = ctx.measureText(label).width + 12;
    var lx = Math.max(lw / 2 + 4, Math.min(view.w - lw / 2 - 4, ax));
    var ly = Math.max(4, Math.min(view.h - 20, ay + 13));
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(lx - lw / 2, ly, lw, 16, 8); ctx.fill(); }
    else ctx.fillRect(lx - lw / 2, ly, lw, 16);
    ctx.fillStyle = "#9dc2ff";
    ctx.fillText(label, lx, ly + 2);
    ctx.textAlign = "left";
  }

  /* B2 — floating style pop-ups. World-anchored, so apply the same
     around-center zoom transform the world draw uses before rising and
     fading them out, one-shot like particles. */
  function drawStylePops() {
    ctx.font = "12px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (var i = 0; i < stylePops.length; i += 1) {
      var p = stylePops[i];
      var sx = p.x - cam.x, sy = p.y - cam.y;
      var x = view.w / 2 + (sx - view.w / 2) * camZoom;
      var y = view.h / 2 + (sy - view.h / 2) * camZoom - (1.4 - p.life) * 30;
      if (!inView(x, y, 60)) continue;
      // warn pops (phase 1 witness alert) are red and bolder than the
      // gold style bonuses so a spotted crime reads at a glance.
      var alpha = Math.min(1, Math.max(0, p.life)).toFixed(2);
      ctx.fillStyle = p.warn ? "rgba(255,74,64," + alpha + ")" : "rgba(255,178,36," + alpha + ")";
      if (p.warn) ctx.font = "bold 16px 'IBM Plex Mono', monospace";
      ctx.fillText(p.txt, x, y);
      if (p.warn) ctx.font = "12px 'IBM Plex Mono', monospace";
    }
    ctx.textAlign = "left";
  }

  function drawVignette() {
    var g = ctx.createRadialGradient(
      view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.42,
      view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.72
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0," + (0.40 * (1 - dayAmt * 0.3)).toFixed(2) + ")");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, view.h);
    if (dayAmt > 0.02) {
      // dawn/dusk wash: a soft warm tint that never overpowers the neon
      // night look — see the dayAmt note above spawnWorld().
      ctx.fillStyle = "rgba(255,196,140," + (dayAmt * 0.10).toFixed(3) + ")";
      ctx.fillRect(0, 0, view.w, view.h);
    }
    // Realism phase 4 — stealth-detected pulse: a brief red rim-breathe on
    // the vignette right after a witnessed crime, so the alert registers
    // even if the "!" pop is off-screen (player in a car, for example).
    var sinceCrime = now() - lastCrime;
    if (started && !settings.peaceful && sinceCrime < 0.8 && wanted > 0) {
      var pulse = (1 - sinceCrime / 0.8) * 0.16;
      var rg = ctx.createRadialGradient(
        view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.30,
        view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.66
      );
      rg.addColorStop(0, "rgba(255,74,64,0)");
      rg.addColorStop(1, "rgba(255,74,64," + pulse.toFixed(3) + ")");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, view.w, view.h);
    }
  }

  /* A4 — skin/shirt swatch rows for the PAUSED panel, mirroring
     LTA.Hud.cs BuildCharacterPicker (4 skin circles + 4 shirt circles,
     the current pick wears a highlight ring). Rebuilds lookSwatches every
     paused frame so the canvas pointerdown handler hit-tests live rects. */
  var lookSwatches = [];
  function drawLookSwatches(cx, cy) {
    lookSwatches.length = 0;
    var i, x;
    ctx.font = "10px 'IBM Plex Mono', monospace";
    ctx.fillStyle = "rgba(233,237,244,0.45)";
    ctx.fillText("skin", cx - 60, cy - 20);
    ctx.fillText("shirt", cx + 60, cy - 20);
    for (i = 0; i < SKINS.length; i += 1) {
      x = cx - 96 + i * 24;
      ctx.fillStyle = SKINS[i];
      ctx.beginPath(); ctx.arc(x, cy, 8, 0, Math.PI * 2); ctx.fill();
      if (i === settings.skin) {
        ctx.strokeStyle = "#e9edf4";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, cy, 11, 0, Math.PI * 2); ctx.stroke();
      }
      lookSwatches.push({ kind: "skin", idx: i, x: x - 12, y: cy - 12, w: 24, h: 24 });
    }
    for (i = 0; i < SHIRT_CHOICES.length; i += 1) {
      x = cx + 24 + i * 24;
      ctx.fillStyle = SHIRT_CHOICES[i];
      ctx.beginPath(); ctx.arc(x, cy, 8, 0, Math.PI * 2); ctx.fill();
      if (i === settings.shirt) {
        ctx.strokeStyle = "#e9edf4";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, cy, 11, 0, Math.PI * 2); ctx.stroke();
      }
      lookSwatches.push({ kind: "shirt", idx: i, x: x - 12, y: cy - 12, w: 24, h: 24 });
    }
  }

  function drawHUD() {
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.font = "18px 'IBM Plex Mono', monospace";
    for (var i = 0; i < 5; i += 1) {
      var starFill = i < wanted ? "#ffb224" : "rgba(255,255,255,0.16)";
      // Realism phase 4 — fresh-alert flash: the top earned star blinks
      // hard for 1.2s after any witnessed crime, then settles.
      if (i === wanted - 1 && now() - lastCrime < 1.2) {
        starFill = Math.floor(now() * 8) % 2 ? "#ff5252" : "#ffb224";
      }
      ctx.fillStyle = starFill;
      ctx.fillText("★", 16 + i * 22, 14);
    }
    ctx.fillStyle = "#e9edf4";
    ctx.font = "13px 'IBM Plex Mono', monospace";
    ctx.fillText("SCORE " + String(score).padStart(6, "0"), 16, 40);
    ctx.fillStyle = "rgba(233,237,244,0.55)";
    ctx.fillText("BEST " + String(Math.max(best, score)).padStart(6, "0"), 16, 58);
    ctx.fillStyle = "#e9edf4";
    if (player.inCar) {
      ctx.fillText(Math.abs(Math.round(player.inCar.speed * 0.5)) + " km/h", 16, 76);
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.fillRect(16, 98, 96, 6);
      ctx.fillStyle = player.health > 40 ? "#7fae6a" : "#ff5252";
      ctx.fillRect(16, 98, 96 * player.health / 100, 6);
    } else {
      ctx.fillStyle = "rgba(233,237,244,0.5)";
      var fLabel = player.weapon === "pistol" ? "fire stun pistol (" + player.ammo + ")"
        : player.weapon === "bat" ? "swing the bat" : "punch";
      ctx.fillText("on foot — E near a car · F to " + fLabel, 16, 76);
    }
    if (mission) {
      var left = Math.max(0, mission.deadline - now());
      var missionLabel = mission.type === "circuit"
        ? "CIRCUIT " + (mission.cpIndex + 1) + "/" + mission.checkpoints.length
        : mission.type === "steal" ? "CONTRACT"
        : mission.type === "ram" ? "TAKEDOWN"
        : mission.type === "escort" ? (vip && vip.following ? "ESCORT" : "FIND VIP")
        : mission.type === "rampage" ? "RAMPAGE " + mission.count + "/" + mission.need
        : "DELIVERY";
      ctx.fillStyle = left < 5 ? "#ff5252" : "#4f8cff";
      ctx.fillText(missionLabel + " " + left.toFixed(1) + "s", 16, 94);
    }
    // B2 — combo meter: visible while the 4s style window is live.
    if (style.combo > 0 && now() - style.lastHit < STYLE_WINDOW) {
      ctx.fillStyle = "#ffb224";
      ctx.fillText("STYLE ×" + style.mult + " · " + style.pts + " pts", 16, 112);
    }
    var mx = view.w - MM - 14, my = 14;
    ctx.drawImage(mmCanvas, mx, my);
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.strokeRect(mx + 0.5, my + 0.5, MM - 1, MM - 1);
    var s = MM / WORLD;
    ctx.fillStyle = "#ffb224";
    for (var p = 0; p < packages.length; p += 1) {
      ctx.fillRect(mx + packages[p].x / TILE * s - 1.5, my + packages[p].y / TILE * s - 1.5, 3, 3);
    }
    ctx.fillStyle = "#ff5252";
    for (var c = 0; c < cops.length; c += 1) {
      ctx.fillRect(mx + cops[c].x / TILE * s - 2, my + cops[c].y / TILE * s - 2, 4, 4);
    }
    if (heli) {
      ctx.fillStyle = "#7fe0ff";
      ctx.fillRect(mx + heli.x / TILE * s - 2, my + heli.y / TILE * s - 2, 4, 4);
    }
    if (mission) {
      var blip = missionTargetPos(missionTargetScratch);
      if (blip) {
        ctx.fillStyle = "#4f8cff";
        ctx.fillRect(mx + blip.x / TILE * s - 2, my + blip.y / TILE * s - 2, 4, 4);
      }
    }
    ctx.save();
    ctx.translate(mx + player.x / TILE * s, my + player.y / TILE * s);
    ctx.rotate(player.a);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(-3, -3); ctx.lineTo(-3, 3); ctx.closePath(); ctx.fill();
    ctx.restore();

    if (now() < ticker.until) {
      ctx.fillStyle = "rgba(7,9,13,0.72)";
      ctx.font = "13px 'IBM Plex Mono', monospace";
      var w = ctx.measureText(ticker.msg).width + 32;
      var x = (view.w - w) / 2;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, view.h - 44, w, 28, 14); ctx.fill(); }
      else ctx.fillRect(x, view.h - 44, w, 28);
      ctx.fillStyle = "#ffcf6e";
      ctx.fillText(ticker.msg, x + 16, view.h - 36);
    }
    if (paused && busted <= 0) {
      ctx.fillStyle = "rgba(7,9,13,0.6)";
      ctx.fillRect(0, 0, view.w, view.h);
      ctx.fillStyle = "#e9edf4";
      ctx.font = "700 40px 'Bricolage Grotesque', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", view.w / 2, view.h / 2 - 20);
      ctx.fillStyle = "rgba(233,237,244,0.7)";
      ctx.font = "14px 'IBM Plex Mono', monospace";
      ctx.fillText("press P to resume", view.w / 2, view.h / 2 + 18);
      ctx.font = "13px 'IBM Plex Mono', monospace";
      ctx.fillStyle = "rgba(233,237,244,0.55)";
      ctx.fillText(
        "1 traffic " + settings.traffic + "x  ·  2 police " + settings.cops + "x  ·  3 peaceful " + (settings.peaceful ? "ON" : "off"),
        view.w / 2, view.h / 2 + 46
      );
      // A4 — ped customizer: 4/5 cycle skin/shirt, or tap a swatch.
      ctx.fillText("4 skin  ·  5 shirt  ·  or tap a swatch", view.w / 2, view.h / 2 + 68);
      drawLookSwatches(view.w / 2, view.h / 2 + 98);
      ctx.fillText(runRecapLine(), view.w / 2, view.h / 2 + 128);
      ctx.textAlign = "left";
    }
    if (busted > 0) {
      ctx.fillStyle = "rgba(7,9,13,0.6)";
      ctx.fillRect(0, 0, view.w, view.h);
      ctx.fillStyle = "#ff5252";
      ctx.font = "700 52px 'Bricolage Grotesque', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("BUSTED", view.w / 2, view.h / 2 - 26);
      ctx.fillStyle = "#e9edf4";
      ctx.font = "14px 'IBM Plex Mono', monospace";
      ctx.fillText("processed locally, released locally", view.w / 2, view.h / 2 + 12);
      ctx.fillStyle = "rgba(233,237,244,0.6)";
      ctx.font = "13px 'IBM Plex Mono', monospace";
      ctx.fillText(runRecapLine(), view.w / 2, view.h / 2 + 38);
      ctx.textAlign = "left";
    }
  }
  function runRecapLine() {
    var mins = Math.max(0, now() - runStats.startedAt);
    return "run: " + String(score).padStart(6, "0") + " score · " + runStats.steals + " steals · " +
      runStats.deliveries + " jobs · peak " + runStats.peakWanted + "★ · " + mins.toFixed(0) + "s";
  }

  /* ---------------------------------------------------------- loop */
  var last = now();
  function frame() {
    var t = now();
    var dt = Math.min(0.05, t - last);
    last = t;
    if (shake > 0) shake = Math.max(0, shake - 36 * dt);
    if (zoomKick > 0) zoomKick = Math.max(0, zoomKick - 0.25 * dt);
    if (started && !paused) {
      dayPhase = (dayPhase + dt * (Math.PI * 2 / DAY_CYCLE)) % (Math.PI * 2);
      dayAmt = Math.max(0, Math.sin(dayPhase));
      weatherStep(t); // A1 — clear/rain cycle on the same clock as dayPhase
    }

    if (started && busted > 0) {
      busted -= dt;
      if (busted <= 0) endBust();
    } else if (started && !paused) {
      playerStep(dt);
      for (var i = 0; i < cars.length; i += 1) trafficStep(cars[i], dt);
      for (var ex = 0; ex < cars.length; ex += 1) {
        var ec = cars[ex];
        if (ec.parked || ec.wrecked || ec.speed < 35) continue;
        if (Math.random() > dt * 1.5) continue;
        var exX = ec.x - Math.cos(ec.a) * 20, exY = ec.y - Math.sin(ec.a) * 20;
        if (!inView(exX - cam.x, exY - cam.y, 40)) continue;
        particles.push({
          x: exX, y: exY, kind: "puff", r: 2.5, life: 0.6,
          vx: -Math.cos(ec.a) * 14 + (Math.random() - 0.5) * 10,
          vy: -Math.sin(ec.a) * 14 + (Math.random() - 0.5) * 10
        });
      }
      for (var j = 0; j < peds.length; j += 1) pedStep(peds[j], dt);
      vipStep(dt);
      heliStep(dt);
      for (var k = 0; k < peds.length; k += 1) {
        if (peds[k].dead && peds[k].timer <= 0) {
          var tt = randTileOf([SIDE]); var cc = tileCenter(tt);
          peds[k].x = cc.x; peds[k].y = cc.y; peds[k].dead = false;
        }
      }
      pickupStep();
      missionStep(t);
      evasionStep(dt);
      lawStep(t, dt);
      rainStep(dt); // A1 — capped rain streaks ride the existing particles array
      particlesStep(dt);
      stylePopsStep(dt);
      if (wanted > runStats.peakWanted) runStats.peakWanted = wanted;
    }
    audioStep(t);

    // Realism phase 2 — steering-weighted camera. The lookahead multiplier
    // grows with speed (heavier at pace, exact at rest) and biases toward
    // the steering direction while turning fast, so the car feels like it
    // has inertia instead of orbiting the camera's dead center.
    var lookMul = player.inCar ? 0.22 + Math.min(1, Math.abs(player.inCar.speed) / 280) * 0.16 : 0.22;
    var lookX = player.x + player.vx * lookMul;
    var lookY = player.y + player.vy * lookMul;
    if (player.inCar && Math.abs(player.inCar.speed) > 120) {
      // peek into the turn: nudge the aim point ~40px toward the car's
      // steering side, eased per frame so it never snaps.
      var carAim = player.inCar;
      var peek = axisInput().x * 40;
      lookX += Math.cos(carAim.a + Math.PI / 2) * peek;
      lookY += Math.sin(carAim.a + Math.PI / 2) * peek;
    }
    cam.x += (lookX - view.w / 2 - cam.x) * Math.min(1, 5 * dt);
    cam.y += (lookY - view.h / 2 - cam.y) * Math.min(1, 5 * dt);
    cam.x = Math.max(0, Math.min(WORLD * TILE - view.w, cam.x));
    cam.y = Math.max(0, Math.min(WORLD * TILE - view.h, cam.y));

    // Realism phase 2 — target-lean rotation: while on foot (or parked),
    // the camera drifts up to ±10° toward the nearest ped/car/cop so the
    // world subtly orients on whatever the player might act on. Lerped,
    // never snapped; drawn only inside the world transform so HUD and
    // minimap stay level.
    var camATarget = 0;
    if (!player.inCar) {
      var near = nearestTarget(player.x, player.y, 300);
      if (near) {
        var at = Math.atan2(near.y - player.y, near.x - player.x);
        var cut = at - player.a;
        while (cut > Math.PI) cut -= Math.PI * 2;
        while (cut < -Math.PI) cut += Math.PI * 2;
        camATarget = Math.max(-0.17, Math.min(0.17, cut * 0.35));
      }
    }
    camA += (camATarget - camA) * Math.min(1, 2.5 * dt);
    if (Math.abs(camA) < 0.002) camA = 0;

    var speedFrac = (player.inCar && !player.inCar.wrecked) ? Math.min(1, Math.abs(player.inCar.speed) / 280) : 0;
    var zoomTarget = 1 - speedFrac * 0.08 - zoomKick;
    camZoom += (zoomTarget - camZoom) * Math.min(1, 3 * dt);

    ctx.fillStyle = "#0a0d12";
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    if (camA !== 0) {
      // target-lean rotation wraps the existing cam-relative draws: turn
      // the whole world a few degrees around the screen center, then undo
      // before HUD/vignette run (they sit after ctx.restore()).
      ctx.translate(view.w / 2, view.h / 2);
      ctx.rotate(camA);
      ctx.translate(-view.w / 2, -view.h / 2);
    }
    if (camZoom !== 1) {
      ctx.translate(view.w / 2, view.h / 2);
      ctx.scale(camZoom, camZoom);
      ctx.translate(-view.w / 2, -view.h / 2);
    }
    drawTiles();
    drawBlocks();
    drawStreetProps();
    drawSkids();
    drawPackages(t);
    drawWeaponDrops(t);
    drawMission(t);
    for (var p = 0; p < peds.length; p += 1) drawPed(peds[p]);
    drawVip();
    for (var c = 0; c < cars.length; c += 1) drawCar(cars[c]);
    for (var q = 0; q < cops.length; q += 1) drawCop(cops[q], t);
    drawHeli(t);
    drawParticles();
    drawPlayer(t);
    ctx.restore();
    drawVignette();
    drawObjectiveArrow(t);
    drawStylePops();
    drawHUD();

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
