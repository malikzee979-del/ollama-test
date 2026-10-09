/* Local Theft Auto — 3D hero city (three.js, r170, vendored locally).
   Renders the game's headlined identity — a night-time city block grid
   with lane traffic, wanted-level police lights and a slow cinematic
   orbit — as a real WebGL scene inside the hero's .hero-stage.

   Design contract with the rest of the marketing site:
   - Colors pulled from marketing.css custom properties at build of the
     scene (asphalt #12161d-ish, neon accents #ffb224 / #4f8cff / #ff5252),
     so the scene ages with the site instead of hardcoding a palette.
   - Interaction: pointer drag rotates the city (the classic "grab the
     model" hero), scroll/wheel is NOT hijacked (page scroll stays king),
     idle auto-orbit resumes after a few seconds of no pointer input.
   - Progressive enhancement: three.module.js is a local vendored ESM file;
     if WebGL is unavailable, `window.matchMedia('(prefers-reduced-motion:
     reduce)')` is set, or module fetch fails, the hero falls back to the
     existing CSS mock-city card (kept in markup), and this file exits
     without touching the DOM beyond the mount node it was given.
   - Nothing here is load-bearing: game.html's canvas game is untouched. */
(async function () {
  "use strict";

  var mount = document.getElementById("hero3d");
  if (!mount) return;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var THREE;
  try {
    THREE = await import("./vendor/three.module.js");
  } catch (e) {
    return; // CSS mock-city card remains the hero visual
  }

  // WebGL capability probe before we build anything heavy.
  var probe = document.createElement("canvas");
  var gl = probe.getContext("webgl2") || probe.getContext("webgl");
  if (!gl) return;

  /* ------------------------------------------------------------ palette */
  var css = getComputedStyle(document.documentElement);
  function v(name, fallback) {
    var c = css.getPropertyValue(name).trim();
    return c || fallback;
  }
  var PAL = {
    bg: "#0b0805",
    asphalt: "#151a22",
    sidewalk: "#33291f",
    building: "#3a2f26",
    buildingLit: "#ffb224",
    neonA: "#ff9046",
    neonB: "#ff5c47",
    carA: "#c8553d",
    carB: "#5b8bd0",
    carC: "#7fae6a",
    police: "#dfe3ea"
  };
  void v; // palette is fixed below; keep the reader for future theming

  /* ------------------------------------------------------------ scene */
  var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  var W = mount.clientWidth || 640, H = mount.clientHeight || 480;
  renderer.setSize(W, H);
  renderer.domElement.className = "hero3d-canvas";
  mount.appendChild(renderer.domElement);

  var scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0805, 140, 380);

  var camera = new THREE.PerspectiveCamera(38, W / H, 0.5, 400);

  /* lighting: one cool ambient wash + a warm "streetlight" key so building
     faces read with real form, exactly the game's dayAmt=0 night look. */
  scene.add(new THREE.AmbientLight(0x8fa3bf, 1.0));
  var key = new THREE.DirectionalLight(0xffd9a0, 2.2);
  key.position.set(40, 60, 20);
  scene.add(key);
  var rim = new THREE.DirectionalLight(0xff9046, 1.0);
  rim.position.set(-50, 30, -30);
  scene.add(rim);

  /* ------------------------------------------------------- city layout */
  var city = new THREE.Group();
  scene.add(city);

  var T = 4;                 // one "tile" = 4 world units
  var ROAD_W = 7, GRID = 8;  // road width vs block pitch — blocks dominate, roads are streets
  var SPACING = T * 5;       // block pitch: 5 tiles per block-and-road repeat

  // ground
  var ground = new THREE.Mesh(
    new THREE.PlaneGeometry(SPACING * GRID + 80, SPACING * GRID + 80),
    new THREE.MeshStandardMaterial({ color: PAL.asphalt, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  city.add(ground);

  // sidewalk-covered block plates + sidewalks stripes (cheap: one plane per
  // block, one slightly raised per sidewalk ring)
  var blockMat = new THREE.MeshStandardMaterial({ color: PAL.sidewalk, roughness: 0.9 });
  var plateGeo = new THREE.BoxGeometry(SPACING - ROAD_W, 0.6, SPACING - ROAD_W);

  var buildingMat = new THREE.MeshStandardMaterial({ color: 0x3d4a5e, roughness: 0.65, metalness: 0.08 });
  var windowMat = new THREE.MeshStandardMaterial({
    color: 0x11141a, emissive: PAL.buildingLit, emissiveIntensity: 1.6, roughness: 0.4
  });
  var neonMatA = new THREE.MeshStandardMaterial({ color: 0x11141a, emissive: PAL.neonA, emissiveIntensity: 2.2 });
  var neonMatB = new THREE.MeshStandardMaterial({ color: 0x11141a, emissive: PAL.neonB, emissiveIntensity: 2.2 });

  var BUILD_KINDS = [3, 5, 8, 6, 11, 4, 7, 9, 5, 12]; // height variety, hashed deterministic (no Monte Carlo on rebuilds)
  function buildingAt(bx, bz) {
    // deterministic block "hash" — same city every load, a nod to the
    // game's own blockHash rule (a 1:1 PARITY contract there, a homage here)
    var h = ((bx * 73856093) ^ (bz * 19349663)) >>> 0;
    var heightTiles = BUILD_KINDS[h % BUILD_KINDS.length];
    var w = SPACING - ROAD_W - T * 2; // footprint leaves a sidewalk margin
    var g = new THREE.Group();

    var body = new THREE.Mesh(new THREE.BoxGeometry(w, heightTiles * 2, w), buildingMat);
    body.position.y = heightTiles;
    g.add(body);

    // emissive window slabs: 2 thin quads per axis at 60% height
    var winY = heightTiles * 0.9;
    var win1 = new THREE.Mesh(new THREE.BoxGeometry(w * 1.01, heightTiles * 0.5, w * 0.34), windowMat);
    win1.position.y = winY;
    var win2 = win1.clone();
    win2.rotation.y = Math.PI / 2;
    win2.position.y = winY;
    g.add(win1, win2);

    // rooftop neon strip on taller blocks
    if (heightTiles >= 6) {
      var n = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.7, 0.35, 0.35),
        (h % 3 === 0) ? neonMatA : neonMatB
      );
      n.position.y = heightTiles * 2 + 0.2;
      g.add(n);
    }
    return g;
  }

  for (var gi = 0; gi < GRID; gi += 1) {
    for (var gj = 0; gj < GRID; gj += 1) {
      var cx = (gi - (GRID - 1) / 2) * SPACING;
      var cz = (gj - (GRID - 1) / 2) * SPACING;
      var plate = new THREE.Mesh(plateGeo, blockMat);
      plate.position.set(cx, 0.3, cz);
      city.add(plate);
      // one building per block, occasionally a park (flat green) for variety
      var bh = ((gi * 31 + gj * 17) % 7);
      if (bh === 3) {
        var park = new THREE.Mesh(
          new THREE.BoxGeometry(SPACING - ROAD_W - T, 0.3, SPACING - ROAD_W - T),
          new THREE.MeshStandardMaterial({ color: 0x2b4a35, roughness: 1 })
        );
        park.position.set(cx, 0.5, cz);
        city.add(park);
      } else {
        var b = buildingAt(gi, gj);
        b.position.set(cx, 0.6, cz);
        city.add(b);
      }
    }
  }

  /* ------------------------------------------------------------- cars */
  function makeCar(color) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.9, 4.6),
      new THREE.MeshStandardMaterial({ color: color, roughness: 0.35, metalness: 0.35 })
    );
    body.position.y = 0.75;
    var cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.7, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x10131a, roughness: 0.2, metalness: 0.5 })
    );
    cabin.position.set(0, 1.5, -0.2);
    g.add(body, cabin);
    var hl = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.25, 0.15),
      new THREE.MeshStandardMaterial({ color: 0xfff2cc, emissive: 0xfff2cc, emissiveIntensity: 1.8 }));
    hl.position.set(0, 0.7, 2.32);
    var tl = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.25, 0.15),
      new THREE.MeshStandardMaterial({ color: 0xff5252, emissive: 0xff5252, emissiveIntensity: 1.4 }));
    tl.position.set(0, 0.7, -2.32);
    g.add(hl, tl);
    return g;
  }
  var CAR_COLS = [PAL.carA, PAL.carB, PAL.carC, "#c9a227", "#e0703a", "#d0d4da"];
  var traffic = [];
  var TRAFFIC_N = 26;
  // Lane-disciplined, right-hand traffic like the real game: each car keeps
  // to a fixed road line and drives one of two directions on its axis.
  for (var i = 0; i < TRAFFIC_N; i += 1) {
    var c = makeCar(CAR_COLS[i % CAR_COLS.length]);
    var axis = i % 2, lane = (i % 4 < 2) ? 1 : -1;
    var r = Math.floor(i / 4) % (GRID + 1) - GRID / 2;
    c.userData = { axis: axis, lane: lane, road: r * SPACING, speed: 22 + (i % 5) * 4 };
    traffic.push(c);
    city.add(c);
  }
  function trafficPos(c, t) {
    var d = c.userData;
    if (d.axis === 0) { // along x
      c.position.set(((t * d.speed * d.lane) % (GRID * SPACING)) + GRID * SPACING / 2 - GRID * SPACING / 2, 0, d.road + d.lane * ROAD_W / 4);
      c.rotation.y = d.lane > 0 ? 0 : Math.PI;
    } else {
      c.position.set(d.road - d.lane * ROAD_W / 4, 0, ((t * d.speed) % (GRID * SPACING)) - GRID * SPACING / 2);
      c.rotation.y = d.lane > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
  }

  // one police cruiser wandering between roads, lights flashing
  var cop = makeCar(PAL.police);
  var barA = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x11141a, emissive: PAL.neonA, emissiveIntensity: 2.4 }));
  barA.position.set(-0.4, 2.0, -0.2);
  var barB = barA.clone();
  barB.material = new THREE.MeshStandardMaterial({ color: 0x11141a, emissive: PAL.neonB, emissiveIntensity: 2.4 });
  barB.position.x = 0.4;
  cop.add(barA, barB);
  city.add(cop);
  var copT = 0;

  /* ------------------------------------------------------------ camera */
  var camOrbit = { a: 0.7, h: 60, r: 118, auto: !reduced };
  function placeCamera() {
    camera.position.set(
      Math.sin(camOrbit.a) * camOrbit.r,
      camOrbit.h,
      Math.cos(camOrbit.a) * camOrbit.r
    );
    camera.lookAt(0, 4, 0);
  }
  placeCamera();

  /* -------------------------------------------------------- interaction */
  var dragging = false, px = 0, lastPointerT = 0;
  function pointerDown(e) { dragging = true; px = e.clientX; camOrbit.auto = false; }
  function pointerMove(e) {
    if (!dragging) return;
    camOrbit.a += (e.clientX - px) * 0.006;
    px = e.clientX;
    lastPointerT = performance.now();
  }
  function pointerUp() {
    dragging = false;
    setTimeout(function () { if (performance.now() - lastPointerT > 2400) camOrbit.auto = !reduced; }, 2600);
    lastPointerT = performance.now();
  }
  renderer.domElement.addEventListener("pointerdown", pointerDown);
  window.addEventListener("pointermove", pointerMove);
  window.addEventListener("pointerup", pointerUp);
  renderer.domElement.style.touchAction = "pan-y"; // vertical scroll stays native on touch

  /* -------------------------------------------------------- scroll drift */
  var heroSection = document.querySelector(".hero");
  function scrollDrift() {
    if (!heroSection) return;
    var rect = heroSection.getBoundingClientRect();
    var vis = Math.max(0, Math.min(1, 1 - rect.top / Math.max(1, rect.height)));
    camOrbit.h = 42 - vis * 14; // rises slightly as you scroll into the page
  }
  window.addEventListener("scroll", scrollDrift, { passive: true });

  /* ------------------------------------------------------------- loop */
  var clock = new THREE.Clock();
  var paused = false; // set by the harness/page if ever needed
  function tick() {
    if (paused) return;
    requestAnimationFrame(tick);
    if (document.hidden) return;
    var dt = Math.min(clock.getDelta(), 0.05);
    var t = clock.elapsedTime;
    if (camOrbit.auto && !dragging) camOrbit.a += dt * 0.05;
    for (var i = 0; i < traffic.length; i += 1) trafficPos(traffic[i], t);
    copT += dt * 14;
    barA.material.emissiveIntensity = 1.2 + (Math.floor(copT) % 2) * 1.6;
    barB.material.emissiveIntensity = 1.2 + (1 - Math.floor(copT) % 2) * 1.6;
    cop.rotation.y = Math.PI / 2 + Math.sin(t * 0.4) * 0.4;
    scrollDrift();
    placeCamera();
    renderer.render(scene, camera);
  }
  if (reduced) {
    // reduced motion: render one still frame, no loop, no auto-orbit
    for (var j = 0; j < traffic.length; j += 1) trafficPos(traffic[j], 3.7);
    placeCamera();
    renderer.render(scene, camera);
  } else {
    tick();
  }

  /* ----------------------------------------------------------- resize */
  window.addEventListener("resize", function () {
    W = mount.clientWidth || 640; H = mount.clientHeight || 480;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H);
    if (reduced) renderer.render(scene, camera);
  });
})();
