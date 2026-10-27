import FeaturePage from "../components/FeaturePage";

const HTML = `

  <section class="section page-hero ph-lean" aria-labelledby="page-h">
    <div class="hero-bg" aria-hidden="true">
      <div class="grid-floor"></div>
      <div class="hero-glow"></div>
    </div>
    <div class="wrap">
      <div class="ph-copy">
        <p class="eyebrow mono reveal"><span class="tick" aria-hidden="true"></span>combat</p>
        <h1 id="page-h" class="display reveal">One punch. <span class="grad">Maybe a bat. Never a gun.</span></h1>
        <p class="page-lede reveal">Combat in Local Theft Auto is shove-and-stun comedy, not a shooter: pedestrians panic and stagger back, police get briefly stunned rather than hurt, and the only upgrade you'll ever find lying in the street is a baseball bat.</p>
      </div>
      <div class="ph-instrument" aria-hidden="true">
        <div class="phi-keys"><i></i><i></i></div>
      </div>
    </div>
  </section>

  <section class="section" aria-label="Combat systems">
    <div class="wrap port reveal-depth">
      <div class="bento">
        <article class="b-cell span-4 reveal is-hero">
          <h3 class="b-title">The punch</h3>
          <p>On foot, press <span class="mono-inline">F</span> to swing in front of you. Anyone standing inside the reach and arc gets knocked back and startled — a short cooldown keeps it from becoming a machine gun.</p>
        </article>
        <article class="b-cell span-2 reveal">
          <h3 class="b-title">The bat</h3>
          <p>Pick one up from a weapon drop and every future swing reaches further and stuns a police officer more than twice as long — 2.5 seconds instead of 1.2.</p>
        </article>
      </div>
      <div class="ledger">
        <div class="ledger-row reveal">
          <span class="ledger-num" aria-hidden="true"></span>
          <div class="ledger-body">
            <h3 class="b-title">Pedestrians who panic</h3>
            <p>A hit ped doesn't just flinch — it flees for a few seconds at a raised panic speed, the same fear response a near-miss from a fast car or a nearby siren triggers.</p>
          </div>
        </div>
        <div class="ledger-row reveal">
          <span class="ledger-num" aria-hidden="true"></span>
          <div class="ledger-body">
            <h3 class="b-title">Cops that stun, not fall</h3>
            <p>Landing a hit on an officer freezes their pursuit briefly (their siren keeps flashing) — but it also adds a full star of wanted level, because assaulting an officer is exactly as serious as it sounds, locally.</p>
          </div>
        </div>
        <div class="ledger-row reveal">
          <span class="ledger-num" aria-hidden="true"></span>
          <div class="ledger-body">
            <h3 class="b-title">Rubbernecking</h3>
            <p>Nearby pedestrians who aren't already panicking will stop and stare at a recent crash or wreck instead of walking on — a small touch that makes the city feel like it's actually watching.</p>
          </div>
        </div>
        <div class="ledger-row reveal">
          <span class="ledger-num" aria-hidden="true"></span>
          <div class="ledger-body">
            <h3 class="b-title">Comedy, not gore</h3>
            <p>Nobody dies on screen. Peds "go down" and respawn elsewhere shortly after; the aesthetic stays a toy city the whole way through — deliberately, not as a technical limitation.</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="section" aria-labelledby="brawler-h">
    <div class="wrap tease-band reveal">
      <div>
        <h2 id="brawler-h" class="display">Land enough hits, <span class="grad">earn the achievement.</span></h2>
        <p>Every connecting punch or swing counts toward your lifetime stats, tracked right alongside steals and deliveries — throw enough of them and Brawler unlocks for good.</p>
      </div>
      <a class="ghost-link" href="progression.html">See every achievement <span aria-hidden="true">→</span></a>
    </div>
  </section>

  <section class="section closing" aria-labelledby="close-h">
    <div class="closing-bg" aria-hidden="true"><div class="grid-floor floor-up"></div></div>
    <div class="wrap closing-wrap">
      <p class="eyebrow mono reveal"><span class="tick" aria-hidden="true"></span>fists up</p>
      <h2 id="close-h" class="display closing-h reveal">Find the bat.<br><span class="grad">Swing first.</span></h2>
      <a class="nav-cta cta-big reveal" href="/game">▶ Play Local Theft Auto</a>
      <p class="closing-note mono reveal">F to punch or swing · weapon drops respawn elsewhere</p>
    </div>
  </section>

`;

export const metadata = { title: "Combat — punches, the bat, the stun pistol", description: "Local Theft Auto's combat: comedy shoves, a found bat and a non-lethal stun pistol." };

export default function Page() {
  return <FeaturePage title="Combat — punches, the bat, the stun pistol" description="Local Theft Auto's combat: comedy shoves, a found bat and a non-lethal stun pistol." html={HTML} />;
}
