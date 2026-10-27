import FeaturePage from "../components/FeaturePage";

const HTML = `

  <section class="section page-hero ph-gauge" aria-labelledby="page-h">
    <div class="hero-bg" aria-hidden="true">
      <div class="grid-floor"></div>
      <div class="hero-glow"></div>
    </div>
    <div class="wrap">
      <p class="eyebrow mono reveal"><span class="tick" aria-hidden="true"></span>progression</p>
      <h1 id="page-h" class="display reveal">Getting busted<br><span class="grad">doesn't erase you.</span></h1>
      <p class="page-lede reveal">This is an endless game: pressing R starts a fresh city and resets your score, but your best run, lifetime stats and unlocked achievements survive it, along with any car you've saved to the garage — all of it living in this browser's <span class="mono-inline">localStorage</span>, nowhere else.</p>
      <div class="mem-strip" aria-hidden="true"><i class="k-best"></i><i class="k-stats"></i><i class="k-ach"></i><i class="k-garage"></i></div>
    </div>
  </section>

  <section class="section facts" aria-label="What persists">
    <div class="wrap">
      <dl class="fact-band">
        <div class="fact reveal">
          <dt class="fact-label mono">achievements to unlock</dt>
          <dd class="fact-num display"><span data-count="5">5</span></dd>
        </div>
        <div class="fact reveal">
          <dt class="fact-label mono">localStorage keys used, total</dt>
          <dd class="fact-num display"><span data-count="4">4</span></dd>
        </div>
        <div class="fact reveal">
          <dt class="fact-label mono">deliveries needed for Courier</dt>
          <dd class="fact-num display"><span data-count="5">5</span></dd>
        </div>
        <div class="fact reveal">
          <dt class="fact-label mono">servers that ever see your save</dt>
          <dd class="fact-num display"><span data-count="0">0</span></dd>
        </div>
      </dl>
    </div>
  </section>

  <!-- ==================================================== achievements -->
  <section class="section features" aria-labelledby="ach-h">
    <div class="wrap port reveal-depth">
      <div class="sec-head reveal-depth">
        <span class="ch-num" aria-hidden="true">01</span>
        <p class="eyebrow mono reveal"><span class="tick" aria-hidden="true"></span>five to chase</p>
        <h2 id="ach-h" class="display reveal-scan">Achievements, <span class="grad">unlocked once, kept forever.</span></h2>
      </div>
      <ul class="proof-list medal-list">
        <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text"><strong>First Steal</strong> — borrow your first car.</span></li>
        <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text"><strong>Drifter</strong> — lay down 5 kilometers of skid marks across every drift you've ever pulled.</span></li>
        <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text"><strong>Most Wanted</strong> — survive 20 total seconds at five stars.</span></li>
        <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text"><strong>Courier</strong> — complete 5 missions.</span></li>
        <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text"><strong>Collector</strong> — save your first car to the garage.</span></li>
      </ul>
    </div>
  </section>

  <!-- ======================================================= save data -->
  <section class="section" aria-labelledby="save-h">
    <div class="wrap privacy-grid">
      <div class="privacy-copy">
        <h2 id="save-h" class="display reveal">What's actually <span class="grad">in your save.</span></h2>
        <ul class="proof-list">
          <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text">Your all-time best score — shown on the HUD stat line every run, never reset by R.</span></li>
          <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text">Lifetime stats: total steals, deliveries, distance drifted, seconds spent at five stars, and cars saved to the garage.</span></li>
          <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text">Which of the five achievements you've unlocked, permanently.</span></li>
          <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text">Your garage-saved car's accel, top speed, grip, paint color and health — one JSON object, one car.</span></li>
        </ul>
        <p class="honest reveal">The honest footnote: it's <span class="mono-inline">localStorage</span>, scoped to this browser on this machine. Clear site data, switch browsers, or open a private window, and it's gone — there's no account or cloud sync to fall back on.</p>
      </div>
      <div class="app-card reveal" style="max-width: 420px;">
        <span class="app-tag mono">on disk, sort of</span>
        <h3 class="b-title">Four keys, nothing else</h3>
        <p>The entire save file is four small <span class="mono-inline">localStorage</span> entries — best score, lifetime stats, unlocked achievements, and the garage car. No account, no cloud, no sync service to trust.</p>
        <code class="mono app-cmd">lta-best</code>
        <code class="mono app-cmd">lta-stats</code>
        <code class="mono app-cmd">lta-achievements</code>
        <code class="mono app-cmd">lta-garage</code>
      </div>
    </div>
  </section>

  <section class="section closing" aria-labelledby="close-h">
    <div class="closing-bg" aria-hidden="true"><div class="grid-floor floor-up"></div></div>
    <div class="wrap closing-wrap">
      <p class="eyebrow mono reveal"><span class="tick" aria-hidden="true"></span>your best run is waiting</p>
      <h2 id="close-h" class="display closing-h reveal">Beat your best.<br><span class="grad">It remembers.</span></h2>
      <a class="nav-cta cta-big reveal" href="/game">▶ Play Local Theft Auto</a>
      <p class="closing-note mono reveal">R for a fresh city · your save always comes along</p>
    </div>
  </section>

`;

export const metadata = { title: "Progression — high score, achievements, the garage", description: "What Local Theft Auto saves in your browser: score, stats, achievements, your garage car." };

export default function Page() {
  return <FeaturePage title="Progression — high score, achievements, the garage" description="What Local Theft Auto saves in your browser: score, stats, achievements, your garage car." html={HTML} />;
}
