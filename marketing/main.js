/* ==========================================================================
   Ollama Chat — marketing site behaviors
   Nav states · scroll reveals · fact count-ups · the self-typing hero
   chat (the one signature moment) · loopback path draw · copy buttons.

   Holo-Grid layer: the shared #bgfx canvas (drifting perspective grid +
   starfield), a sliding nav glow bar, cursor spotlight + tilt on panels,
   hero parallax depth, a glow-pulse on landed count-ups and an optional
   cursor glow dot.

   DISPATCH layer (v2): a persistent left-margin rail with a scroll-tracking
   fill and per-section station nodes (the Continuum Pattern), plus a
   scan-decode reveal for chapter headings (.reveal-scan, alongside the
   existing .reveal fade). Structural, not surface — see
   marketing/REDESIGN_PLAN_V2.md.

   Static completeness first: the shipped HTML already shows the full
   chat transcript, drawn diagram, and finished numbers. Every behavior
   below is additive — and all of it stands down under
   prefers-reduced-motion or when JavaScript never runs.
   ========================================================================== */
(function () {
  "use strict";

  document.documentElement.classList.add("js");

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------ nav */
  var nav = document.getElementById("nav");
  var menuBtn = nav.querySelector("[data-menu-btn]");

  function setMenu(open) {
    nav.classList.toggle("is-open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
  }
  menuBtn.addEventListener("click", function () {
    setMenu(!nav.classList.contains("is-open"));
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && nav.classList.contains("is-open")) setMenu(false);
  });
  document.addEventListener("click", function (e) {
    if (nav.classList.contains("is-open") && !nav.contains(e.target)) setMenu(false);
  });
  nav.querySelectorAll(".nav-menu a").forEach(function (link) {
    link.addEventListener("click", function () { setMenu(false); });
  });

  /* ------------------------------------ scroll progress bar + nav depth */
  var progress = document.createElement("span");
  progress.className = "nav-progress";
  progress.setAttribute("aria-hidden", "true");
  var progressFill = document.createElement("i");
  progress.appendChild(progressFill);
  nav.appendChild(progress);

  var pageHero = document.querySelector(".hero, .page-hero");
  var pastHeroAt = 480;
  function measureHero() {
    if (pageHero) {
      pastHeroAt = Math.max(120, pageHero.offsetTop + pageHero.offsetHeight - 96);
    }
  }
  measureHero();
  window.addEventListener("resize", measureHero);

  /* ---------------------------------------------------------- dispatch rail */
  /* The rail (shipped as a static full-height hairline in every shell) gets
     a scroll-tracking fill plus one station node per body section and a
     terminal node at the closing — same runtime-build pattern as the nav
     progress bar and nav indicator above/below. Static without JS: the
     hairline alone still reads as a complete design. */
  var rail = document.querySelector(".rail");
  var railFill = rail ? rail.querySelector(".rail-fill") : null;
  var mainEl = document.getElementById("main");
  var railMainTop = 0, railMainH = 0;
  var railStations = [];
  function railMeasure() {
    if (!mainEl) return;
    var r = mainEl.getBoundingClientRect();
    railMainTop = r.top + window.scrollY;
    railMainH = mainEl.offsetHeight;
    if (rail) {
      railStations.forEach(function (st) {
        var sr = st.section.getBoundingClientRect();
        st.top = sr.top + window.scrollY - railMainTop;
        st.el.style.top = st.top + "px";
      });
    }
  }
  function railBuild() {
    if (!rail || !mainEl) return;
    var sections = Array.prototype.slice.call(mainEl.querySelectorAll(":scope > .section"));
    sections.forEach(function (sec) {
      if (sec.classList.contains("hero") || sec.classList.contains("page-hero") ||
          sec.classList.contains("closing")) return;
      var node = document.createElement("i");
      node.className = "rail-station";
      node.setAttribute("aria-hidden", "true");
      rail.appendChild(node);
      railStations.push({ section: sec, el: node, top: 0 });
    });
    var closingSec = mainEl.querySelector(".closing");
    if (closingSec) {
      var term = document.createElement("i");
      term.className = "rail-terminal";
      term.setAttribute("aria-hidden", "true");
      rail.appendChild(term);
      railStations.push({ section: closingSec, el: term, top: 0, terminal: true });
    }
    railMeasure();
  }
  if (rail) {
    railBuild();
    window.addEventListener("resize", railMeasure);
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(railMeasure);
    }
    window.addEventListener("load", railMeasure);
  }
  if (rail && reduced) {
    if (railFill) railFill.style.transform = "scaleY(1)";
  }

  /* SHROUD: the two corner plates float ±6px against scroll, fed from the
     same onScroll rAF as the spine fill (one cached fraction, no extra
     listeners). Static without JS; gated on reduced motion. */
  var plateTL = document.querySelector(".shroud-plate-tl");
  var plateBR = document.querySelector(".shroud-plate-br");

  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var y = window.scrollY;
      nav.classList.toggle("is-scrolled", y > 8);
      nav.classList.toggle("is-past-hero", y > pastHeroAt);
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var f = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
      progressFill.style.transform = "scaleX(" + f.toFixed(4) + ")";
      if (plateTL && plateBR && !reduced) {
        var so = (f - 0.5) * 12;   /* one beat: -6px … +6px over the page */
        plateTL.style.transform = "translate3d(0, " + so.toFixed(2) + "px, 0)";
        plateBR.style.transform = "translate3d(0, " + (-so).toFixed(2) + "px, 0)";
      }
      if (rail && railFill && !reduced) {
        var vh = window.innerHeight;
        var denom = railMainH - vh;
        var rf = denom > 0 ? Math.min(1, Math.max(0, (y - railMainTop) / denom)) : 0;
        railFill.style.transform = "scaleY(" + rf.toFixed(4) + ")";
        var cross = y + vh * 0.5;
        for (var si = 0; si < railStations.length; si += 1) {
          var st = railStations[si];
          var passed = (railMainTop + st.top) <= cross;
          if (passed && !st.el.classList.contains("is-now")) {
            railStations.forEach(function (o) { o.el.classList.remove("is-now"); });
            st.el.classList.add("is-now");
          }
        }
      }
      ticking = false;
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* --------------------------------------------------------------- reveal */
  /* SHROUD: .reveal-depth joins the reveal wiring — the depth-settle
     entrance for port wrappers and sec-heads (rows/lists keep the fade).
     Reduced/no-JS paths add .in-view to every match, so depth sections
     land finished without motion or JavaScript. */
  var reveals = Array.prototype.slice.call(document.querySelectorAll(".reveal, .reveal-scan, .reveal-depth"));
  if (reduced || !("IntersectionObserver" in window)) {
    reveals.forEach(function (el) { el.classList.add("in-view"); });
  } else {
    var revealIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          revealIO.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    reveals.forEach(function (el) { revealIO.observe(el); });
  }

  /* -------------------------------------------------- ledger row draw-on */
  /* Reuses the same reveal wiring as chapter heads: each .ledger-row draws
     its top hairline once, staggered by the CSS nth-child transition-delay
     already on the rule. */
  var ledgerRows = Array.prototype.slice.call(document.querySelectorAll(".ledger-row"));
  if (ledgerRows.length) {
    if (reduced || !("IntersectionObserver" in window)) {
      ledgerRows.forEach(function (el) { el.classList.add("in-view"); });
    } else {
      var ledgerIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            ledgerIO.unobserve(entry.target);
          }
        });
      }, { threshold: 0.2, rootMargin: "0px 0px -6% 0px" });
      ledgerRows.forEach(function (el) { ledgerIO.observe(el); });
    }
  }

  /* ------------------------------------------------------------ count-ups */
  function countUp(el) {
    var target = parseInt(el.getAttribute("data-count"), 10) || 0;
    if (target === 0) { el.textContent = "0"; return; }
    var dur = 1100;
    var start = null;
    function frame(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      /* easeOutQuart — fast launch, long settle, reads as a meter landing */
      var eased = 1 - Math.pow(1 - p, 4);
      el.textContent = String(Math.round(eased * target));
      if (p < 1) {
        requestAnimationFrame(frame);
      } else {
        /* one-shot glow pulse on the readout, CSS side (.fact-pop) */
        var num = el.closest ? el.closest(".fact-num") : null;
        if (num) num.classList.add("is-done");
      }
    }
    requestAnimationFrame(frame);
  }
  var counters = Array.prototype.slice.call(document.querySelectorAll("[data-count]"));
  if (!reduced && "IntersectionObserver" in window) {
    var countIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          countUp(entry.target);
          countIO.unobserve(entry.target);
        }
      });
    }, { threshold: 0.6 });
    counters.forEach(function (el) {
      el.textContent = "0";
      countIO.observe(el);
    });
  }

  /* -------------------------------------------- loopback diagram draw-on */
  var loopback = document.querySelector(".loopback");
  if (loopback) {
    var paths = Array.prototype.slice.call(loopback.querySelectorAll(".lb-path"));
    if (!reduced) {
      paths.forEach(function (path, i) {
        var len = path.getTotalLength();
        path.style.strokeDasharray = String(len);
        path.style.strokeDashoffset = String(len);
        path.style.transition = "stroke-dashoffset 1.4s cubic-bezier(0.6,0,0.2,1) " + (i * 0.7 + 0.2) + "s";
      });
      var loopIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            loopback.classList.add("in-view");
            paths.forEach(function (path) { path.style.strokeDashoffset = "0"; });
            loopIO.unobserve(loopback);
          }
        });
      }, { threshold: 0.4 });
      loopIO.observe(loopback);
    } else {
      loopback.classList.add("in-view");
    }
  }

  /* ------------------------------------------------------- copy buttons */
  document.querySelectorAll(".cmd").forEach(function (cmd) {
    var btn = cmd.querySelector(".copy-btn");
    if (!btn) return;
    var original = btn.getAttribute("aria-label");
    btn.addEventListener("click", function () {
      var text = cmd.getAttribute("data-copy") || "";
      function done() {
        btn.classList.add("is-copied");
        btn.setAttribute("aria-label", "Copied");
        window.setTimeout(function () {
          btn.classList.remove("is-copied");
          btn.setAttribute("aria-label", original);
        }, 1600);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () { fallback(); });
      } else {
        fallback();
      }
      function fallback() {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); done(); } catch (e) { /* clipboard unavailable */ }
        document.body.removeChild(ta);
      }
    });
  });

  /* ------------------------------------------- pointer tilt, hero card */
  var tilt = document.getElementById("tiltCard");
  var stage = document.querySelector(".hero-stage");
  if (tilt && stage && !reduced && window.matchMedia("(pointer: fine)").matches) {
    var tTX = 0, tTY = 0, cX = 0, cY = 0, tiltRaf = null;
    function tiltTick() {
      cX += (tTX - cX) * 0.12;
      cY += (tTY - cY) * 0.12;
      tilt.style.transform = "rotateX(" + cX.toFixed(2) + "deg) rotateY(" + cY.toFixed(2) + "deg)";
      if (Math.abs(tTX - cX) > 0.05 || Math.abs(tTY - cY) > 0.05) {
        tiltRaf = requestAnimationFrame(tiltTick);
      } else {
        tiltRaf = null;
      }
    }
    function kick() { if (tiltRaf === null) tiltRaf = requestAnimationFrame(tiltTick); }
    stage.addEventListener("pointermove", function (e) {
      var r = stage.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width - 0.5;
      var py = (e.clientY - r.top) / r.height - 0.5;
      tTY = px * 10;   /* rotateY follows horizontal travel */
      tTX = -py * 8;   /* rotateX follows vertical travel */
      kick();
    });
    stage.addEventListener("pointerleave", function () {
      tTX = 0; tTY = 0; kick();
    });
  }

  /* ------------------------- atmosphere — holo-grid + starfield on #bgfx */
  /* The shared <canvas id="bgfx"> (shipped in every page's markup, right
     after <body>) draws a perspective grid drifting toward the horizon plus
     a faint twinkling starfield above it, parallaxed by the mouse on fine
     pointers. HOLOGRID upgrade adds slow-rising data motes, signal pulse
     rings expanding from the vanishing point, and a scroll-coupled drift of
     the floor rows. No per-frame allocations; pauses while the tab is
     hidden; never started under prefers-reduced-motion. */
  var bgfx = document.getElementById("bgfx");
  if (bgfx && !reduced) {
    var bctx = bgfx.getContext("2d");
    var bW = 0, bH = 0;
    var stars = [];
    var motes = [];
    var finePtr = window.matchMedia("(pointer: fine)").matches;
    var gMX = 0, gMY = 0, gTX = 0, gTY = 0;
    /* cached scroll position — one passive listener feeds the floor drift */
    var gScrollT = 0, gScrollM = 0;

    function bgfxResize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      bW = window.innerWidth;
      bH = window.innerHeight;
      bgfx.width = Math.round(bW * dpr);
      bgfx.height = Math.round(bH * dpr);
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      bgfxSeed();
    }
    function bgfxSeed() {
      var count = Math.round(Math.min(70, Math.max(24, (bW * bH) / 22000)));
      stars = [];
      for (var i = 0; i < count; i += 1) {
        stars.push({
          x: Math.random(),            /* normalized; resize just re-scales */
          y: Math.random(),
          z: 0.3 + Math.random() * 0.7,   /* depth: size, twinkle, parallax */
          r: 0.5 + Math.random() * 1.1,
          tw: Math.random() * 6.283,
          ts: 0.006 + Math.random() * 0.016,
          violet: Math.random() < 0.25
        });
      }
      /* data motes: 24 slow risers, cyan/violet/25% magenta — the whole
         canvas particle budget stays under 100 */
      motes = [];
      for (var m = 0; m < 24; m += 1) {
        var roll = Math.random();
        motes.push({
          x: Math.random(),
          y: Math.random(),
          z: 0.3 + Math.random() * 0.7,
          r: 0.7 + Math.random() * 1.2,
          sp: 0.0005 + Math.random() * 0.001,
          tint: roll < 0.25 ? 2 : (roll < 0.5 ? 1 : 0)  /* 0 cyan, 1 violet, 2 magenta */
        });
      }
    }

    /* signal pulse rings — preallocated pool of 2, no per-frame garbage */
    var rings = [{ on: false, t: 0 }, { on: false, t: 0 }];
    var ringClock = 0;

    var gRaf = null;
    var gPrev = 0;
    var gPhase = 0;
    function bgfxFrame(now) {
      if (document.hidden) { gRaf = null; return; }
      var dt = Math.min(3, (now - gPrev) / 16.7);
      gPrev = now;
      gPhase = (gPhase + 0.0016 * dt) % 1;   /* slow drift of the floor rows */
      gScrollM += (gScrollT - gScrollM) * 0.08;   /* eased scroll coupling */
      gMX += (gTX - gMX) * 0.04;
      gMY += (gTY - gMY) * 0.04;
      bctx.clearRect(0, 0, bW, bH);

      var horizon = bH * 0.58 + gMY * 14;

      /* starfield above the horizon */
      for (var i = 0; i < stars.length; i += 1) {
        var s = stars[i];
        s.tw += s.ts * dt;
        var sx = s.x * bW + gMX * 30 * s.z;
        var sy = s.y * horizon;
        var sa = (0.1 + 0.14 * (0.5 + 0.5 * Math.sin(s.tw))) * s.z;
        bctx.beginPath();
        bctx.arc(sx, sy, s.r * (0.5 + s.z * 0.6), 0, 6.283);
        bctx.fillStyle = s.violet
          ? "rgba(157, 107, 255, " + sa.toFixed(3) + ")"
          : "rgba(56, 240, 255, " + sa.toFixed(3) + ")";
        bctx.fill();
      }

      /* data motes drifting up through the air, small parallax by depth */
      for (var mI = 0; mI < motes.length; mI += 1) {
        var mo = motes[mI];
        mo.y -= mo.sp * dt;
        if (mo.y < -0.02) { mo.y = 1.02; mo.x = Math.random(); }
        var mx = mo.x * bW + gMX * 44 * mo.z;
        var my = mo.y * bH;
        bctx.beginPath();
        bctx.arc(mx, my, mo.r * mo.z, 0, 6.283);
        bctx.fillStyle = mo.tint === 2
          ? "rgba(255, 92, 208, " + (0.16 * mo.z).toFixed(3) + ")"
          : (mo.tint === 1
            ? "rgba(157, 107, 255, " + (0.18 * mo.z).toFixed(3) + ")"
            : "rgba(56, 240, 255, " + (0.18 * mo.z).toFixed(3) + ")");
        bctx.fill();
      }

      /* perspective floor: rows accelerate toward the viewer, columns
         converge on a vanishing point that follows the pointer. Row phase
         is scroll-coupled — the grid flows as you scroll. */
      var vx = bW / 2 + gMX * 40;
      var rows = 22, cols = 15;
      var rowPhase = (gPhase + gScrollM * 0.0012) % 1;
      if (rowPhase < 0) rowPhase += 1;
      bctx.lineWidth = 1;
      bctx.strokeStyle = "rgba(56, 240, 255, 0.055)";
      bctx.beginPath();
      for (var rI = 0; rI <= rows; rI += 1) {
        var t = (rI + rowPhase) / rows;
        var y = horizon + (bH - horizon) * t * t;
        bctx.moveTo(0, y);
        bctx.lineTo(bW, y);
      }
      bctx.stroke();
      bctx.strokeStyle = "rgba(56, 240, 255, 0.045)";
      bctx.beginPath();
      var spread = bW / cols;
      for (var cI = -cols; cI <= cols; cI += 1) {
        bctx.moveTo(vx + cI * spread * 0.08, horizon);
        bctx.lineTo(vx + cI * spread * 1.6, bH);
      }
      bctx.stroke();

      /* signal pulse rings: spawn every ~4s at the vanishing point, max
         2 alive, one stroke each — an ellipse flattening reads "floor" */
      ringClock += dt * 16.7;
      if (ringClock > 4000) {
        ringClock = 0;
        for (var rj = 0; rj < rings.length; rj += 1) {
          if (!rings[rj].on) { rings[rj].on = true; rings[rj].t = 0; break; }
        }
      }
      for (var rk = 0; rk < rings.length; rk += 1) {
        var rg = rings[rk];
        if (!rg.on) continue;
        rg.t += (dt * 16.7) / 3200;
        if (rg.t >= 1) { rg.on = false; continue; }
        var rr = rg.t * bW * 0.62;
        bctx.beginPath();
        bctx.ellipse(vx, horizon + 6, rr, rr * 0.3, 0, 0, 6.283);
        bctx.strokeStyle = "rgba(56, 240, 255, " + (0.16 * (1 - rg.t)).toFixed(3) + ")";
        bctx.stroke();
      }

      gRaf = requestAnimationFrame(bgfxFrame);
    }
    function bgfxStart() {
      if (gRaf === null && !document.hidden) {
        gPrev = performance.now();
        gRaf = requestAnimationFrame(bgfxFrame);
      }
    }
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        if (gRaf !== null) { cancelAnimationFrame(gRaf); gRaf = null; }
      } else {
        bgfxStart();
      }
    });
    if (finePtr) {
      window.addEventListener("pointermove", function (e) {
        gTX = e.clientX / bW - 0.5;
        gTY = e.clientY / bH - 0.5;
      }, { passive: true });
    }
    window.addEventListener("scroll", function () {
      gScrollT = window.scrollY || 0;
    }, { passive: true });
    gScrollT = window.scrollY || 0;
    gScrollM = gScrollT;
    window.addEventListener("resize", bgfxResize);
    bgfxResize();
    bgfxStart();
  }

  /* ------------------------------------------- cursor spotlight on cards */
  /* One delegated pointermove sets --spot-x/--spot-y on the hovered host;
     the visible glow is a CSS radial-gradient on ::before (see marketing.css,
     "HUD layer II"). Fine pointers only; skipped under reduced motion. */
  if (!reduced && window.matchMedia("(pointer: fine)").matches) {
    var spotHosts = Array.prototype.slice.call(
      document.querySelectorAll(".hero-stage, .b-cell, .app-card, .qa, .tease-band")
    );
    spotHosts.forEach(function (el) { el.classList.add("spot-on"); });
    /* the panel hosts also get the cursor tilt; --rx/--ry are composed with
       the lift in CSS (.holo-tilt), so hover + tilt + reveal never fight */
    var tiltHosts = Array.prototype.slice.call(
      document.querySelectorAll(".b-cell, .app-card, .tease-band")
    );
    tiltHosts.forEach(function (el) { el.classList.add("holo-tilt"); });
    function resetTilt(el) {
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
    }
    var spotActive = null;
    document.addEventListener("pointermove", function (e) {
      var host = e.target instanceof Element ? e.target.closest(".spot-on") : null;
      if (host) {
        var r = host.getBoundingClientRect();
        host.style.setProperty("--spot-x", (e.clientX - r.left).toFixed(1) + "px");
        host.style.setProperty("--spot-y", (e.clientY - r.top).toFixed(1) + "px");
        if (host.classList.contains("holo-tilt")) {
          var nx = (e.clientX - r.left) / r.width - 0.5;
          var ny = (e.clientY - r.top) / r.height - 0.5;
          /* HOLOGRID: tilt angles up a notch — 5→6deg yaw, 4→5deg pitch */
          host.style.setProperty("--ry", (nx * 6).toFixed(2) + "deg");
          host.style.setProperty("--rx", (-ny * 5).toFixed(2) + "deg");
        }
        if (spotActive !== host) {
          if (spotActive) { spotActive.classList.remove("is-spot"); resetTilt(spotActive); }
          host.classList.add("is-spot");
          spotActive = host;
        }
      } else if (spotActive) {
        spotActive.classList.remove("is-spot");
        resetTilt(spotActive);
        spotActive = null;
      }
    }, { passive: true });
    document.addEventListener("pointerout", function (e) {
      if (spotActive && !e.relatedTarget) {
        spotActive.classList.remove("is-spot");
        resetTilt(spotActive);
        spotActive = null;
      }
    }, { passive: true });
  }

  /* ------------------------------------ sliding nav indicator (holo bar) */
  /* One fixed 2px glow bar travels between nav links on hover/focus and
     rests on the active page link; positioned from getBoundingClientRect so
     it tracks the keyboard-accessible menu exactly. Hidden by CSS under
     1080px where the menu becomes a dropdown. */
  var navIndicator = document.querySelector(".nav-indicator");
  if (nav && navIndicator) {
    var indLinks = Array.prototype.slice.call(
      nav.querySelectorAll(".nav-menu a:not(.nav-cta)")
    );
    var indActive = nav.querySelector(".nav-menu a.is-active");
    var indTarget = null;
    var indRaf = null;

    function placeIndicator(link) {
      if (!link) { navIndicator.classList.remove("is-on"); return; }
      var r = link.getBoundingClientRect();
      if (r.width === 0) { navIndicator.classList.remove("is-on"); return; }
      navIndicator.style.width = Math.round(r.width) + "px";
      navIndicator.style.transform =
        "translate(" + Math.round(r.left) + "px, " + Math.round(r.bottom - 2) + "px)";
      navIndicator.classList.add("is-on");
    }
    function indSync() {
      indRaf = null;
      placeIndicator(indTarget || indActive);
    }
    function indKick() { if (indRaf === null) indRaf = requestAnimationFrame(indSync); }

    indLinks.forEach(function (link) {
      link.addEventListener("pointerenter", function () { indTarget = link; indKick(); });
      link.addEventListener("focus", function () { indTarget = link; indKick(); });
      link.addEventListener("blur", function () { indTarget = null; indKick(); });
    });
    nav.addEventListener("pointerleave", function () { indTarget = null; indKick(); });
    window.addEventListener("resize", indKick);
    window.addEventListener("scroll", indKick, { passive: true });
    window.addEventListener("load", indKick);
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(indKick);
    }
    indKick();
  }

  /* ------------------------------- hero parallax depth (holo-grid layers) */
  /* Feeds --hpx/--hpy (-1..1) on the hero section; CSS shifts .hero-bg slow
     and opposite, .stage-depth rings mid-rate, while the existing tilt on
     the demo card stays in front. Fine pointers, stands down if reduced. */
  var heroSec = document.querySelector(".hero, .page-hero");
  if (heroSec && !reduced && window.matchMedia("(pointer: fine)").matches) {
    var hpX = 0, hpY = 0, hpTX = 0, hpTY = 0, hpRaf = null;
    function heroTick() {
      hpX += (hpTX - hpX) * 0.08;
      hpY += (hpTY - hpY) * 0.08;
      heroSec.style.setProperty("--hpx", hpX.toFixed(3));
      heroSec.style.setProperty("--hpy", hpY.toFixed(3));
      if (Math.abs(hpTX - hpX) > 0.004 || Math.abs(hpTY - hpY) > 0.004) {
        hpRaf = requestAnimationFrame(heroTick);
      } else {
        hpRaf = null;
      }
    }
    function heroKick() { if (hpRaf === null) hpRaf = requestAnimationFrame(heroTick); }
    heroSec.addEventListener("pointermove", function (e) {
      var r = heroSec.getBoundingClientRect();
      hpTX = ((e.clientX - r.left) / r.width - 0.5) * 2;
      hpTY = ((e.clientY - r.top) / r.height - 0.5) * 2;
      heroKick();
    }, { passive: true });
    heroSec.addEventListener("pointerleave", function () {
      hpTX = 0; hpTY = 0; heroKick();
    });
  }

  /* --------------------------------------------- custom cursor glow dot */
  /* A pointer-events:none glow dot trailing the pointer, scaling up near
     interactive elements. Enabled only on pointer:fine without reduced
     motion; the native cursor stays, so nothing about clicking or keyboard
     access changes. */
  var cursorDot = document.querySelector(".cursor-dot");
  if (cursorDot && !reduced && window.matchMedia("(pointer: fine)").matches) {
    document.documentElement.classList.add("cursor-on");
    var cdX = -100, cdY = -100, cdTX = -100, cdTY = -100;
    var cdS = 1, cdTS = 1, cdRaf = null;
    function cdTick() {
      cdX += (cdTX - cdX) * 0.35;
      cdY += (cdTY - cdY) * 0.35;
      cdS += (cdTS - cdS) * 0.15;   /* HOLOGRID: extra lag so the ring trails */
      cursorDot.style.transform = "translate3d(" + cdX.toFixed(1) + "px, " +
        cdY.toFixed(1) + "px, 0) scale(" + cdS.toFixed(2) + ")";
      if (Math.abs(cdTX - cdX) > 0.2 || Math.abs(cdTY - cdY) > 0.2 ||
          Math.abs(cdTS - cdS) > 0.01) {
        cdRaf = requestAnimationFrame(cdTick);
      } else {
        cdRaf = null;
      }
    }
    function cdKick() { if (cdRaf === null) cdRaf = requestAnimationFrame(cdTick); }
    window.addEventListener("pointermove", function (e) {
      cdTX = e.clientX;
      cdTY = e.clientY;
      cursorDot.classList.add("is-live");
      var near = e.target instanceof Element
        ? e.target.closest("a, button, summary, select, input, .b-cell, .app-card")
        : null;
      cursorDot.classList.toggle("is-near", !!near);
      cdTS = near ? 2.6 : 1;   /* HOLOGRID: near-state ring a touch wider */
      cdKick();
    }, { passive: true });
    document.addEventListener("pointerleave", function () {
      cursorDot.classList.remove("is-live");
    });
  }
})();
