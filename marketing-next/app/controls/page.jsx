import FeaturePage from "../components/FeaturePage";

const HTML = `

  <section class="section page-hero ph-split" aria-labelledby="page-h">
    <div class="hero-bg" aria-hidden="true">
      <div class="grid-floor"></div>
      <div class="hero-glow"></div>
    </div>
    <div class="wrap">
      <div class="ph-copy">
        <p class="eyebrow mono reveal"><span class="tick" aria-hidden="true"></span>controls &amp; accessibility</p>
        <h1 id="page-h" class="display reveal">Keyboard, touchscreen, <span class="grad">or turn the whole thing down.</span></h1>
        <p class="page-lede reveal">Every action maps to one key, coarse-pointer devices get on-screen touch pads automatically, and three pause-menu knobs let you tune the city's traffic, police aggression, or switch off the wanted system entirely.</p>
      </div>
      <div class="ph-spec" aria-hidden="true">
        <span class="s-keys"></span>
        <span class="s-knobs"></span>
        <span class="s-mute"></span>
      </div>
    </div>
  </section>

  <!-- ==================================================== keyboard -->
  <section class="section features" aria-labelledby="keys-h">
    <div class="wrap port reveal-depth">
      <div class="sec-head reveal-depth">
        <span class="ch-num" aria-hidden="true">01</span>
        <p class="eyebrow mono reveal"><span class="tick" aria-hidden="true"></span>keyboard</p>
        <h2 id="keys-h" class="display reveal-scan">Every key, <span class="grad">listed before you start.</span></h2>
      </div>
      <ul class="game-keys key-sheet" aria-label="Full control scheme" style="font-size: 1rem;">
        <li><span class="key mono">W A S D</span> / <span class="key mono">← ↑ ↓ →</span> walk on foot, drive in a car</li>
        <li><span class="key mono">E</span> enter or exit the nearest car</li>
        <li><span class="key mono">SPACE</span> handbrake — the key to every drift</li>
        <li><span class="key mono">F</span> punch, or swing the bat if you're carrying one</li>
        <li><span class="key mono">H</span> honk the horn</li>
        <li><span class="key mono">P</span> pause — opens the settings panel below</li>
        <li><span class="key mono">M</span> mute or unmute all sound</li>
        <li><span class="key mono">R</span> restart — new city, score to zero, save untouched</li>
        <li><span class="key mono">1</span> / <span class="key mono">2</span> / <span class="key mono">3</span> while paused: traffic density, police aggression, peaceful mode</li>
      </ul>
    </div>
  </section>

  <!-- ================================================= pause-menu knobs -->
  <section class="section" aria-label="Difficulty settings">
    <div class="wrap port is-warm reveal-depth">
      <div class="bento is-joined">
        <article class="b-cell span-4 reveal">
          <h3 class="b-title">Traffic density — key 1</h3>
          <p>Cycles moving and parked car counts, plus pedestrian population, between 0.5×, 1× and 1.5× the default. Takes effect on your next restart, so you can plan a quieter or busier city ahead of time.</p>
        </article>
        <article class="b-cell span-4 reveal">
          <h3 class="b-title">Police aggression — key 2</h3>
          <p>Scales cop speed, spawn rate and helicopter closing speed between 0.5×, 1× and 1.5×. Takes effect immediately — you'll feel a more or less aggressive pursuit on your very next crime.</p>
        </article>
        <article class="b-cell span-4 reveal">
          <h3 class="b-title">Peaceful mode — key 3</h3>
          <p>Turns the wanted system off entirely: heat drops to zero, every cop despawns, and no future crime raises it again until you toggle it back. A genuinely different, lower-stakes way to explore the same city.</p>
        </article>
      </div>
    </div>
  </section>

  <!-- ======================================================= touch -->
  <section class="section" aria-labelledby="touch-h">
    <div class="wrap tease-band reveal">
      <div>
        <h2 id="touch-h" class="display">On a phone or tablet? <span class="grad">The pads show up on their own.</span></h2>
        <p>Any coarse-pointer device automatically gets a D-pad on the left for movement and action buttons on the right — accelerate, steer, brake, handbrake, enter/exit, and punch. No separate mobile build, no app store; the same file adapts.</p>
      </div>
      <a class="ghost-link" href="/game">Try it on your phone <span aria-hidden="true">→</span></a>
    </div>
  </section>

  <!-- =================================================== accessibility -->
  <section class="section" aria-labelledby="access-h">
    <div class="wrap privacy-grid">
      <div class="privacy-copy">
        <h2 id="access-h" class="display reveal">Built to <span class="grad">stand down gracefully.</span></h2>
        <ul class="proof-list">
          <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text">Pausing the tab pauses the game — the simulation checks page visibility and stops advancing while you're elsewhere.</span></li>
          <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text">Every control is keyboard-first and listed on the start overlay before you ever press a key.</span></li>
          <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text">Sound is a single, sticky mute toggle — no separate volume sliders to hunt for.</span></li>
          <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text">Peaceful mode exists specifically for players who want the driving and the city without the pursuit.</span></li>
        </ul>
      </div>
      <div class="app-card reveal" style="max-width: 420px;">
        <span class="app-tag mono">no install, ever</span>
        <h3 class="b-title">It's one HTML file</h3>
        <p>The whole game is a canvas element, an overlay, and one script tag. Open it directly from disk or from any static file server — there's nothing to install, register or configure.</p>
        <code class="mono app-cmd">open marketing/game.html</code>
      </div>
    </div>
  </section>

  <section class="section closing" aria-labelledby="close-h">
    <div class="closing-bg" aria-hidden="true"><div class="grid-floor floor-up"></div></div>
    <div class="wrap closing-wrap">
      <p class="eyebrow mono reveal"><span class="tick" aria-hidden="true"></span>your hands, your rules</p>
      <h2 id="close-h" class="display closing-h reveal">Pick your setup.<br><span class="grad">Start driving.</span></h2>
      <a class="nav-cta cta-big reveal" href="/game">▶ Play Local Theft Auto</a>
      <p class="closing-note mono reveal">Keyboard or touch · three difficulty knobs · one mute key</p>
    </div>
  </section>

`;

export const metadata = { title: "Controls — every key, plus touch pads and difficulty knobs", description: "Every control in Local Theft Auto: keyboard, touch, and the three difficulty settings." };

export default function Page() {
  return <FeaturePage title="Controls — every key, plus touch pads and difficulty knobs" description="Every control in Local Theft Auto: keyboard, touch, and the three difficulty settings." html={HTML} />;
}
