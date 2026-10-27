import FeaturePage from "../components/FeaturePage";

const HTML = `

  <section class="section page-hero ph-split" aria-labelledby="page-h">
    <div class="hero-bg" aria-hidden="true">
      <div class="grid-floor"></div>
      <div class="hero-glow"></div>
    </div>
    <div class="wrap">
      <div class="ph-copy">
        <p class="eyebrow mono reveal"><span class="tick" aria-hidden="true"></span>missions &amp; heists</p>
        <h1 id="page-h" class="display reveal">A new job posts itself <span class="grad">the moment you're free.</span></h1>
        <p class="page-lede reveal">Six mission types share one contract board. Whenever you're not already on a job, the game offers you a fresh one on a timer — a marker appears in the world and on the minimap, and a deadline starts ticking.</p>
      </div>
      <div class="ph-spec" aria-hidden="true">
        <span class="s-jobs"></span>
        <span class="s-slot"></span>
        <span class="s-weight"></span>
      </div>
    </div>
  </section>

  <section class="section" aria-label="Mission types">
    <div class="wrap port reveal-depth">
      <div class="job-board">
        <div class="ledger">
          <div class="ledger-row reveal">
            <span class="app-tag mono">delivery</span>
            <div class="ledger-body">
              <h3 class="b-title">Delivery run</h3>
              <p>Reach a marker placed well across the city before the clock runs out. The baseline job — weighted to show up most often — with a reward that scales with the distance you had to cover.</p>
            </div>
          </div>
          <div class="ledger-row reveal">
            <span class="app-tag mono">circuit</span>
            <div class="ledger-body">
              <h3 class="b-title">Checkpoint circuit</h3>
              <p>Four to six checkpoints, spaced apart so the route actually crosses the city, each with its own deadline pressure baked into one overall timer. Clear them all before time expires.</p>
            </div>
          </div>
          <div class="ledger-row reveal">
            <span class="app-tag mono">steal</span>
            <div class="ledger-body">
              <h3 class="b-title">Steal contract</h3>
              <p>One specific parked car is marked — not any car, that car. Get to it and take it within 60 seconds before someone else does, or it's gone.</p>
            </div>
          </div>
          <div class="ledger-row reveal">
            <span class="app-tag mono">ram</span>
            <div class="ledger-body">
              <h3 class="b-title">Ram job</h3>
              <p>A moving target vehicle is marked for wrecking. Run it off the road within 45 seconds — a straightforward, aggressive contract with a shorter fuse.</p>
            </div>
          </div>
          <div class="ledger-row reveal">
            <span class="app-tag mono">escort</span>
            <div class="ledger-body">
              <h3 class="b-title">VIP escort</h3>
              <p>Reach a VIP on foot at a pickup marker, then get them safely to a destination marker across town. Drive carelessly near them and the contract fails outright — this is the one job where speed and caution actually compete with each other.</p>
            </div>
          </div>
        </div>
        <div class="job-note reveal">
          <h3 class="b-title">One shared slot</h3>
          <p>Only one mission is ever active at a time. Fail or finish it, and the board waits a short cooldown before offering the next.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- ============================================= how rewards scale -->
  <section class="section" aria-labelledby="pay-h">
    <div class="wrap privacy-grid">
      <div class="privacy-copy">
        <h2 id="pay-h" class="display reveal-scan">Rewards <span class="grad">scale with the risk.</span></h2>
        <ul class="proof-list">
          <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text">Delivery and circuit payouts grow with the distance you actually had to travel — a marker across the map pays more than one around the corner.</span></li>
          <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text">Steal, ram and escort contracts pay a flat bounty, because the difficulty there is in finding and reaching one specific target, not the distance.</span></li>
          <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text">Every completed mission also counts toward your lifetime delivery total — five of them unlocks the Courier achievement.</span></li>
          <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text">Score earned here is the only thing that pays for a garage-saved car's fuel or a paint shop's silence — missions fund your evasion.</span></li>
        </ul>
      </div>
      <div class="app-card reveal" style="max-width: 420px;">
        <span class="app-tag mono">contract board</span>
        <h3 class="b-title">Six slots, one active job</h3>
        <p>Delivery is weighted to appear roughly twice as often as any other type, so most sessions still feel like the original game — the other five are the escalation on top.</p>
        <code class="mono app-cmd">delivery · delivery · circuit · steal · ram · escort</code>
      </div>
    </div>
  </section>

  <section class="section closing" aria-labelledby="close-h">
    <div class="closing-bg" aria-hidden="true"><div class="grid-floor floor-up"></div></div>
    <div class="wrap closing-wrap">
      <p class="eyebrow mono reveal"><span class="tick" aria-hidden="true"></span>the board is posting</p>
      <h2 id="close-h" class="display closing-h reveal">Take the job.<br><span class="grad">Beat the clock.</span></h2>
      <a class="nav-cta cta-big reveal" href="/game">▶ Play Local Theft Auto</a>
      <p class="closing-note mono reveal">One active mission · a fresh one posts automatically</p>
    </div>
  </section>

`;

export const metadata = { title: "Missions — deliveries, circuits, steal contracts, escorts", description: "The contract board: six mission types that post themselves between crimes." };

export default function Page() {
  return <FeaturePage title="Missions — deliveries, circuits, steal contracts, escorts" description="The contract board: six mission types that post themselves between crimes." html={HTML} />;
}
