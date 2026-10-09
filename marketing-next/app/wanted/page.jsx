import FeaturePage from "../components/FeaturePage";

const HTML = `

  <section class="section page-hero ph-gauge" aria-labelledby="page-h">
    <div class="hero-bg" aria-hidden="true">
      <div class="grid-floor"></div>
      <div class="hero-glow"></div>
    </div>
    <div class="wrap">
      <p class="eyebrow mono reveal"><span class="tick" aria-hidden="true"></span>the wanted system</p>
      <h1 id="page-h" class="display reveal">Local police, <span class="grad">enforcing local law.</span></h1>
      <p class="page-lede reveal">Every crime — running someone over, being spotted stealing a car, assaulting an officer — adds heat. Heat brings cops, cops escalate to roadblocks and a helicopter, and none of it goes anywhere near a real network. It's still entirely a local, in-browser simulation.</p>
      <p class="wanted-meter reveal" aria-label="Wanted level example: three stars">
        <span class="star is-on">★</span><span class="star is-on">★</span><span class="star is-on">★</span><span class="star">★</span><span class="star">★</span>
      </p>
    </div>
  </section>

  <section class="section" aria-label="Wanted escalation">
    <div class="wrap port is-warm reveal-depth">
      <div class="ladder">
        <div class="ladder-row reveal">
          <h3 class="b-title">Five stars of heat</h3>
          <p>Wanted level runs 0–5. It rises one star per fresh crime (up to the cap) and decays one star at a time once you've stayed clean for a few seconds — faster in a park, slower under a circling helicopter.</p>
        </div>
        <div class="ladder-row reveal">
          <h3 class="b-title">Cops that predict, not chase</h3>
          <p>Police steer toward where you're <em>about</em> to be, not where you are — lead prediction that makes a straight-line escape much harder than it looks.</p>
        </div>
        <div class="ladder-row reveal is-alert">
          <h3 class="b-title">Roadblocks at three stars</h3>
          <p>Once wanted hits three, parked cruisers start appearing ahead of your direction of travel, forcing you off your line instead of just chasing from behind.</p>
        </div>
        <div class="ladder-row reveal is-alert">
          <h3 class="b-title">A helicopter at four</h3>
          <p>Four stars brings a helicopter that tracks you from above and actively suppresses your heat decay while it's nearby — the strongest reason to break line of sight.</p>
        </div>
        <div class="ladder-row reveal">
          <h3 class="b-title">What actually raises heat</h3>
          <p>A pedestrian hit, a witnessed car theft, or landing a hit on an officer — the last one alone can push you a full star in one swing.</p>
        </div>
        <div class="ladder-row reveal">
          <h3 class="b-title">Getting busted</h3>
          <p>Let a cop close within arm's reach and it's over for this pursuit: wanted resets to zero, you're returned to spawn on foot — but score, stats and achievements are untouched.</p>
        </div>
        <div class="ladder-row reveal">
          <h3 class="b-title">Difficulty is a dial, not fixed</h3>
          <p>Police aggression is a settings knob (0.5×/1×/1.5×) cycled from the pause menu — it scales cop speed, spawn rate, and how fast a helicopter closes in.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- =============================================== ways to evade -->
  <section class="section features" aria-labelledby="evade-h">
    <div class="wrap port reveal-depth">
      <div class="sec-head reveal-depth">
        <span class="ch-num" aria-hidden="true">02</span>
        <p class="eyebrow mono reveal"><span class="tick" aria-hidden="true"></span>three ways to cool off</p>
        <h2 id="evade-h" class="display reveal-scan">Getting away is a choice, <span class="grad">not just outrunning them.</span></h2>
      </div>
      <div class="bento is-joined">
        <article class="b-cell span-4 reveal">
          <h3 class="b-title">Go to ground in a park</h3>
          <p>Standing in a park with no cop nearby quadruples the rate your heat decays — the fastest, cheapest way to cool down, provided you can shake a tail long enough to reach one.</p>
        </article>
        <article class="b-cell span-4 reveal">
          <h3 class="b-title">Pay the paint shop</h3>
          <p>Two seconds parked at a paint shop drops two stars instantly and gives your car a new color — a fresh coat and new plates the local police apparently can't see through.</p>
        </article>
        <article class="b-cell span-4 reveal">
          <h3 class="b-title">Bribe the corner mart</h3>
          <p>On foot, with enough score, the corner mart will quietly remove one star for a flat fee — and lets your cooldown timer resume immediately instead of waiting out the usual grace period.</p>
        </article>
      </div>
    </div>
  </section>

  <section class="section" aria-labelledby="peace-h">
    <div class="wrap tease-band reveal">
      <div>
        <h2 id="peace-h" class="display">Or just <span class="grad">turn the heat off.</span></h2>
        <p>Peaceful mode is one keypress away in the pause menu: wanted drops to zero, every cop despawns, and no crime ever raises heat again until you flip it back — a whole different way to enjoy the same city.</p>
      </div>
      <a class="ghost-link" href="controls.html">See the pause-menu settings <span aria-hidden="true">→</span></a>
    </div>
  </section>

  <section class="section closing" aria-labelledby="close-h">
    <div class="closing-bg" aria-hidden="true"><div class="grid-floor floor-up"></div></div>
    <div class="wrap closing-wrap">
      <p class="eyebrow mono reveal"><span class="tick" aria-hidden="true"></span>the sirens are close</p>
      <h2 id="close-h" class="display closing-h reveal">Lose them.<br><span class="grad">Locally.</span></h2>
      <a class="nav-cta cta-big reveal" href="game.html">▶ Play Local Theft Auto</a>
      <p class="closing-note mono reveal">0–5 stars · roadblocks at 3 · a helicopter at 4</p>
    </div>
  </section>

`;

export const metadata = { title: "The wanted system — five stars, roadblocks, a helicopter", description: "How the police escalate in Local Theft Auto, and every way to lose the heat." };

export default function Page() {
  return <FeaturePage title="The wanted system — five stars, roadblocks, a helicopter" description="How the police escalate in Local Theft Auto, and every way to lose the heat." html={HTML} />;
}
