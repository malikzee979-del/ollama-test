"use client";
/* Client island for the game page. Injects the original game.html shell
   (canvas + touch pads + overlay) verbatim and loads the untouched
   game.js/assets.js from /public. React never owns the game's DOM —
   game.js is a self-teaming IIFE that expects this exact markup at load. */
import { useEffect } from "react";

const SHELL = `
<section class="section page-hero ph-lean" aria-labelledby="page-h">
  <div class="hero-bg" aria-hidden="true">
    <div class="grid-floor"></div>
    <div class="hero-glow"></div>
  </div>
  <div class="wrap">
    <div class="ph-copy">
      <p class="eyebrow mono"><span class="tick" aria-hidden="true"></span>now playable · zero network</p>
      <h1 id="page-h" class="display">Local Theft Auto. <span class="grad">Your crimes never leave the machine.</span></h1>
      <p class="page-lede">A top-down city rendered entirely in your browser: cars to borrow, amber packages to collect, pedestrians to respect, and a local police force that enforces local law. No server, no telemetry — the only thing you can steal is the high score.</p>
    </div>
  </div>
</section>

<section class="section game-section" aria-label="Local Theft Auto game">
  <div class="wrap">
    <div class="port game-port">
      <div class="game-frame">
        <canvas id="gameCanvas" aria-label="Local Theft Auto: a top-down city driving game. Use the keyboard to play."></canvas>
        <div class="game-touch" id="gameTouch" aria-hidden="true">
          <div class="touch-pad touch-pad-left">
            <button class="touch-btn touch-up" type="button" data-key="w" aria-label="Accelerate">▲</button>
            <button class="touch-btn touch-left" type="button" data-key="a" aria-label="Steer left">◀</button>
            <button class="touch-btn touch-right" type="button" data-key="d" aria-label="Steer right">▶</button>
            <button class="touch-btn touch-down" type="button" data-key="s" aria-label="Brake / reverse">▼</button>
          </div>
          <div class="touch-pad touch-pad-right">
            <button class="touch-btn touch-brake" type="button" data-key=" " aria-label="Handbrake">⊘</button>
            <button class="touch-btn touch-action" type="button" data-key="e" aria-label="Enter or exit vehicle">E</button>
            <button class="touch-btn touch-punch" type="button" data-key="f" aria-label="Punch, swing or shoot">F</button>
            <button class="touch-btn touch-pause" type="button" data-key="p" aria-label="Pause or resume">P</button>
            <button class="touch-btn touch-mute" type="button" data-key="m" aria-label="Mute or unmute">M</button>
            <button class="touch-btn touch-horn" type="button" data-key="h" aria-label="Horn">H</button>
          </div>
        </div>
        <div class="game-overlay" id="gameOverlay">
          <p class="game-kicker mono">a toy city · no network · no pixels leave your machine</p>
          <h2 class="display game-title">Local Theft Auto</h2>
          <ul class="game-keys" aria-label="Controls">
            <li><span class="key mono">W A S D</span> / <span class="key mono">← ↑ ↓ →</span> walk &amp; drive</li>
            <li><span class="key mono">E</span> enter / exit a car</li>
            <li><span class="key mono">SPACE</span> handbrake &middot; <span class="key mono">F</span> punch / swing &middot; <span class="key mono">H</span> horn</li>
            <li><span class="key mono">P</span> pause &middot; <span class="key mono">M</span> mute &middot; <span class="key mono">R</span> restart &middot; touch: pads &amp; <span class="key mono">P</span>/<span class="key mono">M</span>/<span class="key mono">H</span> buttons</li>
            <li><span class="key mono">1 2 3</span> while paused: traffic &middot; police &middot; peaceful mode &middot; <span class="key mono">4 5</span> skin &amp; shirt</li>
            <li><span class="key key-amber mono">●</span> collect the amber packages</li>
            <li><span class="key key-red mono">★</span> don’t run over the locals</li>
          </ul>
          <button class="nav-cta game-start" id="gameStart" type="button">Start driving</button>
          <p class="game-stats mono" id="gameStats"></p>
        </div>
      </div>
    </div>
    <p class="game-note mono">rendered on &lt;canvas&gt; at 60fps · pedestrians respawn · the police forgive, eventually</p>
  </div>
</section>`;

export default function GameMount() {
  useEffect(() => {
    // Replace the whole app shell so body children match game.html's
    // layout; game.js expects its canvas + overlay to exist at eval time.
    const app = document.getElementById("game-app");
    if (app) app.innerHTML = SHELL;
    const s1 = document.createElement("script");
    s1.src = "/assets.js";
    document.body.appendChild(s1);
    const s2 = document.createElement("script");
    s2.src = "/game.js";
    document.body.appendChild(s2);
    return () => { s1.remove(); s2.remove(); };
  }, []);
  return <main id="main"><div id="game-app" dangerouslySetInnerHTML={{ __html: SHELL }} /></main>;
}
