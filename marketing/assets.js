/* Local Theft Auto — pre-rendered sprite factory (realism phase 3).
   Bakes the per-frame procedural vector passes (drawCarBody / ped circles)
   into offscreen canvases built lazily per variant, then drawn rotated per
   frame. Kills per-frame shape construction and adds baked lighting:
   sheen, rim light, glass, door trim, hubcaps.

   This file deliberately knows nothing about game.js's closures — game.js
   probes window.LTA_SPRITES and falls back to its own vector drawing when
   this file is absent (headless test harness, offline file edge cases).
   Collision radii are art-invariant: sprites are drawn to the same
   40×22-ish car footprint and ~7px ped body the physics circles expect. */
(function () {
  "use strict";

  function shadeHex(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.min(255, Math.round(((n >> 16) & 255) * f));
    var g = Math.min(255, Math.round(((n >> 8) & 255) * f));
    var b = Math.min(255, Math.round((n & 255) * f));
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  function makeCanvas(w, h) {
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }

  function works() {
    try {
      var c = makeCanvas(2, 2);
      var g = c.getContext && c.getContext("2d");
      return !!(g && g.fillRect);
    } catch (e) { return false; }
  }
  var CAN = works();

  /* Silhouettes: [length, width, corner radius]. All stay within the
     14px-radius collision circle's visual envelope (≤44px long). */
  var BODIES = {
    sedan: [40, 22, 5],
    hatch: [36, 20, 6],
    van:   [44, 24, 3]
  };

  function drawCarLocal(g, color, body, wrecked) {
    var d = BODIES[body] || BODIES.sedan;
    var L = d[0], H = d[1], R = d[2];
    var bodyCol = wrecked ? "#2b2b2b" : color;
    var dark = shadeHex(bodyCol, 0.55);
    var light = shadeHex(bodyCol, 1.28);

    // baked soft shadow (same rgba ellipse the vector pass drew)
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.beginPath(); g.ellipse(2, 4, L / 2 + 1, H / 2 + 1, 0, 0, Math.PI * 2); g.fill();

    // tires
    g.fillStyle = "#0a0c10";
    var rear = -L / 2 + 4, front = L / 2 - 11;
    g.fillRect(rear, -H / 2 - 1.5, 8, 3.5); g.fillRect(rear, H / 2 - 2, 8, 3.5);
    g.fillRect(front, -H / 2 - 1.5, 8, 3.5); g.fillRect(front, H / 2 - 2, 8, 3.5);
    // hubcaps
    g.fillStyle = "#8a929d";
    g.fillRect(rear + 2.5, -H / 2 - 0.5, 1.6, 1.6); g.fillRect(rear + 2.5, H / 2 - 1, 1.6, 1.6);
    g.fillRect(front + 2.5, -H / 2 - 0.5, 1.6, 1.6); g.fillRect(front + 2.5, H / 2 - 1, 1.6, 1.6);

    // body
    g.fillStyle = bodyCol;
    if (g.roundRect) { g.beginPath(); g.roundRect(-L / 2, -H / 2, L, H, R); g.fill(); }
    else g.fillRect(-L / 2, -H / 2, L, H);

    // baked sheen (roof highlight → underbody falloff)
    var sheen = g.createLinearGradient(0, -H / 2, 0, H / 2);
    sheen.addColorStop(0, "rgba(255,255,255,0.26)");
    sheen.addColorStop(0.45, "rgba(255,255,255,0.04)");
    sheen.addColorStop(1, "rgba(0,0,0,0.30)");
    g.fillStyle = sheen;
    if (g.roundRect) { g.beginPath(); g.roundRect(-L / 2, -H / 2, L, H, R); g.fill(); }
    else g.fillRect(-L / 2, -H / 2, L, H);

    // rim light along the leading edge — reads as streetlight from above
    g.strokeStyle = light;
    g.lineWidth = 1.4;
    g.beginPath();
    if (g.roundRect) g.roundRect(-L / 2 + 1, -H / 2 + 1, L - 2, H - 2, R - 1);
    else g.rect(-L / 2 + 1, -H / 2 + 1, L - 2, H - 2);
    g.stroke();

    // glass: windshield + rear + slim side windows
    g.fillStyle = "rgba(10,14,20,0.82)";
    if (body === "van") {
      g.fillRect(L / 2 - 9, -H / 2 + 3, 6, H - 6);
      g.fillRect(-L / 2 + 4, -H / 2 + 3, 5, H - 6);
    } else if (body === "hatch") {
      g.fillRect(L / 2 - 8, -H / 2 + 2.5, 5, H - 5);
      g.fillRect(-L / 2 + 4, -H / 2 + 2.5, 4, H - 5);
    } else {
      g.fillRect(L / 2 - 10, -H / 2 + 2.5, 6, H - 5);
      g.fillRect(-L / 2 + 6, -H / 2 + 2.5, 4, H - 5);
      g.fillRect(L / 2 - 18, -H / 2 + 2.5, 5, H - 5);
    }
    g.fillStyle = "rgba(160,200,255,0.14)"; // glass catch-light
    if (body !== "van") g.fillRect(L / 2 - 10, -H / 2 + 2.5, 6, 4);

    // door trim
    g.strokeStyle = dark;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-L / 2 + 3, -H / 2 + 2);
    g.lineTo(-L / 2 + 3, H / 2 - 2);
    g.moveTo(L / 2 - 12, -H / 2 + 2);
    g.lineTo(L / 2 - 12, H / 2 - 2);
    g.stroke();

    if (body === "van") { // roof rack rails
      g.strokeStyle = shadeHex(bodyCol, 0.4);
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(-L / 2 + 6, -H / 2 + 5); g.lineTo(L / 2 - 14, -H / 2 + 5);
      g.moveTo(-L / 2 + 6, H / 2 - 5); g.lineTo(L / 2 - 14, H / 2 - 5);
      g.stroke();
    }

    // mirrors
    g.fillStyle = bodyCol;
    g.fillRect(L / 2 - 18, -H / 2 - 2.5, 3, 2.5);
    g.fillRect(L / 2 - 18, H / 2, 3, 2.5);
  }

  /* Ped sprite, facing +x. Shadow + shirt body + head + fabric shading are
     baked; the animated feet stay with the per-frame draw so walking still
     reads. Head "up" shading baked as a slight forward catch-light. */
  function drawPedLocal(g, shirt, skin) {
    g.fillStyle = "rgba(0,0,0,0.30)";
    g.beginPath(); g.ellipse(1.5, 2, 7.5, 3.5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = shirt;                        // torso
    g.beginPath(); g.arc(0, 0, 7, 0, Math.PI * 2); g.fill();
    var sheen = g.createRadialGradient(-2, -2, 1, 0, 0, 7.5);  // soft top-light
    sheen.addColorStop(0, "rgba(255,255,255,0.30)");
    sheen.addColorStop(0.6, "rgba(255,255,255,0)");
    sheen.addColorStop(1, "rgba(0,0,0,0.28)");
    g.fillStyle = sheen;
    g.beginPath(); g.arc(0, 0, 7, 0, Math.PI * 2); g.fill();
    g.strokeStyle = shadeHex(shirt, 0.55);      // outline keeps it crisp at zoom
    g.lineWidth = 1;
    g.beginPath(); g.arc(0, 0, 6.6, 0, Math.PI * 2); g.stroke();
    g.fillStyle = skin;                         // head slightly forward of center
    g.beginPath(); g.arc(2.4, 0, 3.4, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(0,0,0,0.35)";           // hair cap (rear half)
    g.beginPath(); g.arc(1.2, 0, 3.2, Math.PI / 2, Math.PI * 1.5); g.fill();
  }

  function cache(key, dict, build) {
    if (!(key in dict)) dict[key] = build();
    return dict[key];
  }

  var carCache = {}, pedCache = {};
  var API = {
    car: CAN ? function (color, body, wrecked) {
      var k = color + "|" + body + "|" + (wrecked ? 1 : 0);
      return cache(k, carCache, function () {
        var c = makeCanvas(56, 40);
        var g = c.getContext("2d");
        g.translate(26, 17); // sprite handles the shadow offset: center back a touch
        drawCarLocal(g, color, body, !!wrecked);
        return c;
      });
    } : null,
    ped: CAN ? function (shirt, skin) {
      var k = shirt + "|" + skin;
      return cache(k, pedCache, function () {
        var c = makeCanvas(22, 22);
        var g = c.getContext("2d");
        g.translate(9, 9);
        drawPedLocal(g, shirt, skin);
        return c;
      });
    } : null
  };

  if (typeof window !== "undefined") window.LTA_SPRITES = API;
})();
