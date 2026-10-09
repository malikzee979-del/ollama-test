import FeaturePage from "../components/FeaturePage";

const HTML = `

  <section class="section page-hero ph-split" aria-labelledby="page-h">
    <div class="hero-bg" aria-hidden="true">
      <div class="grid-floor"></div>
      <div class="hero-glow"></div>
    </div>
    <div class="wrap">
      <div class="ph-copy">
        <p class="eyebrow mono reveal"><span class="tick" aria-hidden="true"></span>vehicles &amp; driving</p>
        <h1 id="page-h" class="display reveal">Every car drives <span class="grad">a little differently.</span></h1>
        <p class="page-lede reveal">Cars aren't interchangeable props. Each one rolls its own acceleration, top speed and grip the moment you steal it, on top of drift-on-handbrake physics, real damage, and lane-disciplined traffic that actually reacts to you.</p>
      </div>
      <div class="ph-spec" aria-hidden="true">
        <span class="s-accel"></span>
        <span class="s-top"></span>
        <span class="s-grip"></span>
      </div>
    </div>
  </section>

  <section class="section" aria-label="Driving systems">
    <div class="wrap port reveal-depth">
      <div class="bento">
        <article class="b-cell span-4 reveal is-hero">
          <h3 class="b-title">Handling that varies per car</h3>
          <p>Acceleration, top speed and grip each roll independently on theft — an owner comment ("this one's got a tune", "floaty suspension", "feels quick") hints at what you just took, before you've even pulled away.</p>
        </article>
        <article class="b-cell span-2 reveal">
          <h3 class="b-title">Drift on the handbrake</h3>
          <p>Hold space and grip drops hard: the car keeps its momentum while you point it somewhere new, laying skid marks whenever lateral speed and total speed both cross a threshold — real drifting, not a canned animation.</p>
        </article>
        <article class="b-cell span-2 reveal">
          <h3 class="b-title">Damage &amp; wrecks</h3>
          <p>Hard impacts — walls, other cars, high-speed collisions — chip away a shared health bar for you and your ride. Hit zero and the car wrecks: it still rolls, but it's done as a getaway vehicle.</p>
        </article>
        <article class="b-cell span-2 reveal">
          <h3 class="b-title">Headlights, brakes, smoke</h3>
          <p>Headlight cones sweep the road at night, brake lights flare under hard stops, and a damaged engine trails exhaust smoke — sparks fly on every real impact.</p>
        </article>
        <article class="b-cell span-2 reveal">
          <h3 class="b-title">Lane-disciplined traffic</h3>
          <p>NPC drivers keep to the right lane, brake for whatever's ahead of them, and yield to you on foot — they're not just wandering obstacles, they're following the same rules you are.</p>
        </article>
        <article class="b-cell span-3 reveal">
          <h3 class="b-title">Enter, exit, borrow</h3>
          <p>Walk up to any car and press <span class="mono-inline">E</span> to take it — parked or moving. A watching pedestrian calls it in immediately; an empty street means a clean getaway.</p>
        </article>
        <article class="b-cell span-3 reveal">
          <h3 class="b-title">The garage remembers</h3>
          <p>Park your current car at the garage tile for two seconds and its rolled stats, paint and health save to this browser — the same car is waiting near your spawn point on your next run.</p>
        </article>
      </div>
    </div>
  </section>

  <!-- =========================================== how the physics feel -->
  <section class="section" aria-labelledby="feel-h">
    <div class="wrap privacy-grid">
      <div class="privacy-copy">
        <h2 id="feel-h" class="display reveal-scan">The physics, <span class="grad">in plain terms.</span></h2>
        <ul class="proof-list">
          <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text">Throttle and brake accelerate or reverse the car; letting off coasts it down with natural drag.</span></li>
          <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text">Steering authority scales with speed — you can't spin the wheel like a go-kart at highway speed.</span></li>
          <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text">Velocity chases where the car is pointed, at a rate set by grip — the handbrake cuts that grip so momentum and heading disagree, which is what a drift is.</span></li>
          <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text">Impacts above a speed threshold convert directly into damage and a hard bounce-back, not a wall you simply stop against.</span></li>
        </ul>
        <p class="honest reveal">The honest footnote: it's an arcade model tuned for feel, not a simulation — the same trade-off most top-down driving games make.</p>
      </div>
      <div class="app-card reveal" style="max-width: 420px;">
        <span class="app-tag mono">under the hood</span>
        <h3 class="b-title">One car, five numbers</h3>
        <p>Every vehicle carries just <span class="mono-inline">accel</span>, <span class="mono-inline">topSpeed</span>, <span class="mono-inline">gripMul</span>, a color and a health value. That's the entire personality of a car — simple enough to save whole to <span class="mono-inline">localStorage</span> for the garage.</p>
        <code class="mono app-cmd">{ accel, topSpeed, gripMul, color, health }</code>
      </div>
    </div>
  </section>

  <section class="section closing" aria-labelledby="close-h">
    <div class="closing-bg" aria-hidden="true"><div class="grid-floor floor-up"></div></div>
    <div class="wrap closing-wrap">
      <p class="eyebrow mono reveal"><span class="tick" aria-hidden="true"></span>find one and floor it</p>
      <h2 id="close-h" class="display closing-h reveal">Steal a car.<br><span class="grad">See what it's got.</span></h2>
      <a class="nav-cta cta-big reveal" href="game.html">▶ Play Local Theft Auto</a>
      <p class="closing-note mono reveal">E to enter · SPACE to drift · every car rolls different</p>
    </div>
  </section>

`;

export const metadata = { title: "Vehicles & driving — drift physics, handling rolls, wrecks", description: "How Local Theft Auto's cars drive: handbrake drifts, per-car handling rolls, damage and repair." };

export default function Page() {
  return <FeaturePage title="Vehicles & driving — drift physics, handling rolls, wrecks" description="How Local Theft Auto's cars drive: handbrake drifts, per-car handling rolls, damage and repair." html={HTML} />;
}
