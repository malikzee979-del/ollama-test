"use client";
/* Site chrome — React ports of the blur-hairline nav + sitemap-grid footer
   (chrome recipes), styled against the sunset-noir tokens in marketing.css.
   .is-scrolled adds the translucent blurred bar state after 8px. */
import { useEffect, useRef } from "react";

export function Nav() {
  const navRef = useRef(null);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    const menuBtn = nav.querySelector("[data-menu-btn]");
    const menu = nav.querySelector(".nav-menu");
    const onBtn = () => {
      const open = menu.classList.toggle("is-open");
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    };
    menuBtn.addEventListener("click", onBtn);
    const onDoc = (e) => { if (!nav.contains(e.target)) menu.classList.remove("is-open"); };
    document.addEventListener("click", onDoc);
    const onKey = (e) => { if (e.key === "Escape") menu.classList.remove("is-open"); };
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll);
      menuBtn.removeEventListener("click", onBtn);
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  const links = [
    ["/world", "World"], ["/driving", "Vehicles"], ["/missions", "Missions"],
    ["/wanted", "Wanted"], ["/combat", "Combat"], ["/progression", "Progression"],
    ["/faq", "FAQ"],
  ];
  return (
    <header id="nav" ref={navRef}>
      <div className="nav-shell">
        <a className="brand" href="/" aria-label="Local Theft Auto — home">
          <span className="brand-dot" aria-hidden="true" />
          <span className="brand-name">Local&nbsp;Theft&nbsp;Auto</span>
        </a>
        <nav className="nav-menu" aria-label="Primary">
          {links.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
        </nav>
        <a className="nav-cta" href="/game">▶ Play now</a>
        <button className="menu-btn" data-menu-btn aria-label="Menu" aria-expanded="false"><span /><span /></button>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
        <div className="footer-brand">
          <p className="brand footer-logo"><span className="brand-dot" aria-hidden="true" /><span className="brand-name">Local Theft Auto</span></p>
          <p className="footer-desc">A top-down city that runs entirely in your browser tab. One canvas, one script, zero network calls — the only thing you can steal is the high score.</p>
        </div>
        <nav className="footer-col" aria-label="The game">
          <p className="footer-h mono">The game</p>
          <a href="/world">World</a>
          <a href="/driving">Vehicles</a>
          <a href="/missions">Missions</a>
          <a href="/wanted">Wanted</a>
        </nav>
        <nav className="footer-col" aria-label="Playing">
          <p className="footer-h mono">Playing</p>
          <a href="/combat">Combat</a>
          <a href="/progression">Progression</a>
          <a href="/controls">Controls</a>
          <a href="/faq">FAQ</a>
        </nav>
        <div className="footer-col">
          <p className="footer-h mono">Quick start</p>
          <p className="footer-cmd mono">WASD — walk / drive</p>
          <p className="footer-cmd mono">E — enter or exit a car</p>
          <p className="footer-cmd mono">F — punch or swing</p>
          <a className="footer-cmd mono" href="/game">Open game →</a>
        </div>
      </div>
      <div className="wrap footer-legal">
        <p className="mono">© 2026 Local Theft Auto — local by design. Built inside the <a href="/about">Ollama Chat</a> project.</p>
        <a className="mono" href="#top">Back to top ↑</a>
      </div>
    </footer>
  );
}

/* Holo-grid + starfield night atmosphere on the shared #bgfx canvas —
   sunset-noir palette (warm stars, amber grid). */
/* MUNICIPAL: no stars, no neon horizon — a faint ink planning grid on a
   fixed canvas, static under reduced motion, muted enough to sit behind
   paper-colored panels without fighting the type. */
export function BackgroundFx() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    let raf = 0, t = 0;
    function size() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    size();
    window.addEventListener("resize", size);
    function tick() {
      raf = requestAnimationFrame(tick);
      t += 0.0022;
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      // sparse ink survey marks, drifting very slowly (city-planner pins)
      ctx.fillStyle = "rgba(20,22,28,0.08)";
      for (let i = 0; i < 24; i += 1) {
        const sx = ((i * 911) % 997) / 997 * w;
        const sy = ((i * 613) % 991) / 991 * h;
        const drift = Math.sin(t * 2 + i) * 6;
        ctx.fillRect(sx, sy + drift, 2.5, 2.5);
      }
    }
    tick();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", size); };
  }, []);
  return <canvas id="bgfx" ref={ref} aria-hidden="true" />;
}

export { default as ChatWidget } from "./ChatWidget";
