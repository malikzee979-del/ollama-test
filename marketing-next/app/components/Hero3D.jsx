"use client";
/* The Three.js hero city as a React client island. Same scene as the
   standalone three-hero.js (city blocks, emissive windows, lane traffic,
   flashing police cruiser, drag-orbit, scroll rise), with graceful
   fallback: if WebGL is missing or prefers-reduced-motion is set, render
   the existing CSS mock-city card instead and never touch WebGL. */
import { useEffect, useRef } from "react";

export default function Hero3D() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      try {
        var requestOk = true;
        const THREE = await import("three");
        if (disposed) return;
        const probe = document.createElement("canvas");
        const gl = probe.getContext("webgl2") || probe.getContext("webgl");
        if (!gl) return;

        const PAL = {
          bg: 0xf6f1e7,            /* daylight paper sky */
          asphalt: 0x3a3f49,       /* daylight asphalt */
          sidewalk: 0xcfc6b4,
          building: 0x8a8378,      /* warm concrete blocks */
          buildingLit: 0xd92b1c,   /* signal-red signs instead of lit windows */
          neonA: 0x1a7f4e,         /* park green */
          neonB: 0xf2b705,         /* lane paint yellow */
          carCols: [0xd92b1c, 0x2d5e8e, 0x2f7d54, 0xd9a21b, 0x7a6bb0, 0xe8e4da],
          police: 0xffffff,
        };

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        let W = mount.clientWidth || 640, H = mount.clientHeight || 480;
        renderer.setSize(W, H);
        renderer.domElement.className = "hero3d-canvas";
        mount.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.fog = new THREE.Fog(0xf6f1e7, 170, 420);
        const camera = new THREE.PerspectiveCamera(38, W / H, 0.5, 500);

        scene.add(new THREE.AmbientLight(0xffffff, 1.15));
        const key = new THREE.DirectionalLight(0xfff4e0, 2.0);
        key.position.set(40, 60, 20);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0xe8dcc0, 0.7);
        rim.position.set(-50, 30, -30);
        scene.add(rim);

        const city = new THREE.Group();
        scene.add(city);

        const ROAD_W = 7, GRID = 8, SPACING = 20;
        const ground = new THREE.Mesh(
          new THREE.PlaneGeometry(SPACING * GRID + 80, SPACING * GRID + 80),
          new THREE.MeshStandardMaterial({ color: PAL.asphalt, roughness: 0.95 })
        );
        ground.rotation.x = -Math.PI / 2;
        city.add(ground);

        const blockMat = new THREE.MeshStandardMaterial({ color: PAL.sidewalk, roughness: 0.9 });
        const plateGeo = new THREE.BoxGeometry(SPACING - ROAD_W, 0.6, SPACING - ROAD_W);
        const buildingMat = new THREE.MeshStandardMaterial({ color: PAL.building, roughness: 0.65, metalness: 0.08 });
        const windowMat = new THREE.MeshStandardMaterial({ color: 0x11141a, emissive: PAL.buildingLit, emissiveIntensity: 1.6, roughness: 0.4 });
        const neonMatA = new THREE.MeshStandardMaterial({ color: 0x11141a, emissive: PAL.neonA, emissiveIntensity: 2.2 });
        const neonMatB = new THREE.MeshStandardMaterial({ color: 0x11141a, emissive: PAL.neonB, emissiveIntensity: 2.2 });

        const BUILD_KINDS = [3, 5, 8, 6, 11, 4, 7, 9, 5, 12];
        function buildingAt(bx, bz) {
          const h = ((bx * 73856093) ^ (bz * 19349663)) >>> 0;
          const heightTiles = BUILD_KINDS[h % BUILD_KINDS.length];
          const w = SPACING - ROAD_W - 8;
          const g = new THREE.Group();
          const body = new THREE.Mesh(new THREE.BoxGeometry(w, heightTiles * 2, w), buildingMat);
          body.position.y = heightTiles;
          g.add(body);
          const winY = heightTiles * 0.9;
          const win1 = new THREE.Mesh(new THREE.BoxGeometry(w * 1.01, heightTiles * 0.5, w * 0.34), windowMat);
          win1.position.y = winY;
          const win2 = win1.clone();
          win2.rotation.y = Math.PI / 2;
          win2.position.y = winY;
          g.add(win1, win2);
          if (heightTiles >= 6) {
            const n = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.35, 0.35), h % 3 === 0 ? neonMatA : neonMatB);
            n.position.y = heightTiles * 2 + 0.2;
            g.add(n);
          }
          return g;
        }
        for (let gi = 0; gi < GRID; gi += 1) {
          for (let gj = 0; gj < GRID; gj += 1) {
            const cx = (gi - (GRID - 1) / 2) * SPACING;
            const cz = (gj - (GRID - 1) / 2) * SPACING;
            const plate = new THREE.Mesh(plateGeo, blockMat);
            plate.position.set(cx, 0.3, cz);
            city.add(plate);
            if ((gi * 31 + gj * 17) % 7 === 3) {
              const park = new THREE.Mesh(
                new THREE.BoxGeometry(SPACING - ROAD_W - 8, 0.3, SPACING - ROAD_W - 8),
                new THREE.MeshStandardMaterial({ color: 0x2b4a35, roughness: 1 })
              );
              park.position.set(cx, 0.5, cz);
              city.add(park);
            } else {
              const b = buildingAt(gi, gj);
              b.position.set(cx, 0.6, cz);
              city.add(b);
            }
          }
        }

        function makeCar(color) {
          const g = new THREE.Group();
          const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 4.6),
            new THREE.MeshStandardMaterial({ color: color, roughness: 0.35, metalness: 0.35 }));
          body.position.y = 0.75;
          const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 2.2),
            new THREE.MeshStandardMaterial({ color: 0x10131a, roughness: 0.2, metalness: 0.5 }));
          cabin.position.set(0, 1.5, -0.2);
          const hl = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.25, 0.15),
            new THREE.MeshStandardMaterial({ color: 0xfff2cc, emissive: 0xfff2cc, emissiveIntensity: 1.8 }));
          hl.position.set(0, 0.7, 2.32);
          const tl = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.25, 0.15),
            new THREE.MeshStandardMaterial({ color: 0xff5c47, emissive: 0xff5c47, emissiveIntensity: 1.4 }));
          tl.position.set(0, 0.7, -2.32);
          g.add(body, cabin, hl, tl);
          return g;
        }
        const traffic = [];
        for (let i = 0; i < 26; i += 1) {
          const c = makeCar(PAL.carCols[i % PAL.carCols.length]);
          const axis = i % 2, lane = (i % 4 < 2) ? 1 : -1;
          const r = Math.floor(i / 4) % (GRID + 1) - GRID / 2;
          c.userData = { axis: axis, lane: lane, road: r * SPACING, speed: 22 + (i % 5) * 4 };
          traffic.push(c);
          city.add(c);
        }
        const SPAN = GRID * SPACING;
        const HALF = SPAN / 2;
        function trafficPos(c, t) {
          const d = c.userData;
          if (d.axis === 0) {
            c.position.set(((t * d.speed * d.lane) % SPAN + SPAN) % SPAN - HALF, 0, d.road + d.lane * ROAD_W / 4);
            c.rotation.y = d.lane > 0 ? 0 : Math.PI;
          } else {
            c.position.set(d.road - d.lane * ROAD_W / 4, 0, (((t * d.speed) % SPAN + SPAN) % SPAN) - HALF);
            c.rotation.y = d.lane > 0 ? Math.PI / 2 : -Math.PI / 2;
          }
        }
        const cop = makeCar(PAL.police);
        const barA = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.5),
          new THREE.MeshStandardMaterial({ color: 0x11141a, emissive: PAL.neonA, emissiveIntensity: 2.4 }));
        barA.position.set(-0.4, 2.0, -0.2);
        const barB = barA.clone();
        barB.material = new THREE.MeshStandardMaterial({ color: 0x11141a, emissive: PAL.neonB, emissiveIntensity: 2.4 });
        barB.position.x = 0.4;
        cop.add(barA, barB);
        city.add(cop);

        const camOrbit = { a: 0.7, h: 60, r: 118, auto: true };
        function placeCamera() {
          camera.position.set(Math.sin(camOrbit.a) * camOrbit.r, camOrbit.h, Math.cos(camOrbit.a) * camOrbit.r);
          camera.lookAt(0, 4, 0);
        }
        placeCamera();

        let dragging = false, px = 0, lastPointerT = 0;
        function pointerDown(e) { dragging = true; px = e.clientX; camOrbit.auto = false; }
        function pointerMove(e) {
          if (!dragging) return;
          camOrbit.a += (e.clientX - px) * 0.006;
          px = e.clientX;
          lastPointerT = performance.now();
        }
        function pointerUp() {
          dragging = false;
          setTimeout(function () { if (performance.now() - lastPointerT > 2400) camOrbit.auto = true; }, 2600);
          lastPointerT = performance.now();
        }
        renderer.domElement.addEventListener("pointerdown", pointerDown);
        window.addEventListener("pointermove", pointerMove);
        window.addEventListener("pointerup", pointerUp);
        renderer.domElement.style.touchAction = "pan-y";

        const heroSection = document.querySelector(".hero");
        function scrollDrift() {
          if (!heroSection) return;
          const rect = heroSection.getBoundingClientRect();
          const vis = Math.max(0, Math.min(1, 1 - rect.top / Math.max(1, rect.height)));
          camOrbit.h = 60 - vis * 18;
        }
        window.addEventListener("scroll", scrollDrift, { passive: true });

        var requestOkRef = requestOk;
        const clock = new THREE.Clock();
        let raf = 0;
        function tick() {
          if (disposed) return;
          raf = requestAnimationFrame(tick);
          if (document.hidden) return;
          const dt = Math.min(clock.getDelta(), 0.05);
          const t = clock.elapsedTime;
          if (camOrbit.auto && !dragging) camOrbit.a += dt * 0.05;
          for (let i = 0; i < traffic.length; i += 1) trafficPos(traffic[i], t);
          const copT = t * 14;
          barA.material.emissiveIntensity = 1.2 + (Math.floor(copT) % 2) * 1.6;
          barB.material.emissiveIntensity = 1.2 + (1 - Math.floor(copT) % 2) * 1.6;
          cop.rotation.y = Math.PI / 2 + Math.sin(t * 0.4) * 0.4;
          scrollDrift();
          placeCamera();
          renderer.render(scene, camera);
        }
        tick();

        function onResize() {
          W = mount.clientWidth || 640; H = mount.clientHeight || 480;
          camera.aspect = W / H;
          camera.updateProjectionMatrix();
          renderer.setSize(W, H);
        }
        window.addEventListener("resize", onResize);

        cleanup = () => {
          disposed = true;
          cancelAnimationFrame(raf);
          renderer.domElement.removeEventListener("pointerdown", pointerDown);
          window.removeEventListener("pointermove", pointerMove);
          window.removeEventListener("pointerup", pointerUp);
          window.removeEventListener("scroll", scrollDrift);
          window.removeEventListener("resize", onResize);
          renderer.dispose();
          if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
        };
      } catch (err) {
        // module load or WebGL init failed — CSS fallback card stays visible
      }
    })();

    return () => { cleanup(); };
  }, []);

  return (
    <div className="tilt" id="tiltCard">
      <div ref={mountRef} className="hero3d" aria-label="3D night city with moving traffic — drag to rotate" />
      <div className="demo-card">
        <div className="demo-bar">
          <span className="demo-lights" aria-hidden="true"><i></i><i></i><i></i></span>
          <span className="demo-title mono">local theft auto — night shift</span>
          <span className="demo-model mono">3★ wanted</span>
        </div>
        <div className="mock-city" aria-hidden="true">
          <div className="mock-hud">
            <span className="wanted-meter" aria-hidden="true">
              <span className="star is-on">★</span><span className="star is-on">★</span><span className="star is-on">★</span><span className="star">★</span><span className="star">★</span>
            </span>
            <span className="mock-mini"></span>
          </div>
          <div className="mock-skyline">
            <i></i><i style={{ height: "70%" }}></i><i style={{ height: "45%" }}></i><i style={{ height: "85%" }}></i><i style={{ height: "55%" }}></i><i style={{ height: "95%" }}></i><i style={{ height: "40%" }}></i><i style={{ height: "65%" }}></i><i style={{ height: "50%" }}></i><i style={{ height: "80%" }}></i>
          </div>
          <div className="mock-road"></div>
        </div>
        <div className="mock-foot mono">
          <span>SCORE <strong>4,280</strong></span>
          <span>BEST <strong>9,150</strong></span>
        </div>
      </div>
      <span className="chip chip-a mono" aria-hidden="true">0 bytes out</span>
      <span className="chip chip-b mono" aria-hidden="true">localStorage saves</span>
      <span className="chip chip-c mono" aria-hidden="true">drag the city — it's 3D</span>
    </div>
  );
}
