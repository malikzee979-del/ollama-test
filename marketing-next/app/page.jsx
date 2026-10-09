import { Nav, Footer, ChatWidget } from "./components/Chrome";
import Hero3D from "./components/Hero3D";

/* MUNICIPAL — complete redesign. The site is made of city-planner paper +
   street signage: warm paper ground, ink type, signal-red road paint as the
   scarce accent. One signature: dashed lane-paint seams (kept + promoted). */
export default function Home() {
  return (
    <>
      <Nav />
      <main id="main">
        {/* ============== HERO — the poster: ink headline + live 3D city plate */}
        <section className="section hero" aria-labelledby="hero-h">
          <div className="wrap hero-grid">
            <div className="hero-copy">
              <p className="eyebrow mono"><span className="tick" aria-hidden="true"></span>now playable · zero network</p>
              <h1 id="hero-h" className="display">A whole city. <span className="accent">Zero bytes leave your machine.</span></h1>
              <p className="lede">Local Theft Auto is a top-down, GTA-style city rendered on one &lt;canvas&gt;: lane-disciplined traffic, panicking pedestrians, a police force that pursues with lead prediction, six mission types, and a garage that remembers your car. No server, no accounts, no telemetry — <strong>the only thing you can steal is the high score.</strong></p>
              <div className="cta-row">
                <a className="nav-cta cta-big" href="/game">&#9654; Start driving</a>
                <a className="cta-quiet" href="/world">See the city up close <span aria-hidden="true">&rarr;</span></a>
              </div>
              <ul className="hero-meta mono" aria-label="Key facts">
                <li>0 install</li>
                <li>60fps canvas</li>
                <li>0 bytes out</li>
              </ul>
            </div>
            <div className="hero-stage">
              <Hero3D />
              <p className="hero-stage-cap mono" aria-hidden="true">fig. 01 — the live city · drag it</p>
            </div>
          </div>
        </section>

        {/* ============== FACT BAND — counter strip between paint rules */}
        <section className="section facts" aria-label="Local Theft Auto in numbers">
          <div className="wrap">
            <dl className="fact-band">
              <div className="fact">
                <dt className="fact-label mono">bytes of gameplay sent to a server</dt>
                <dd className="fact-num display"><span>0</span></dd>
              </div>
              <div className="fact">
                <dt className="fact-label mono">mission types on the contract board</dt>
                <dd className="fact-num display"><span>6</span></dd>
              </div>
              <div className="fact">
                <dt className="fact-label mono">wanted stars before a helicopter joins in</dt>
                <dd className="fact-num display"><span>4</span></dd>
              </div>
              <div className="fact">
                <dt className="fact-label mono">frames per second on a plain &lt;canvas&gt;</dt>
                <dd className="fact-num display"><span>60</span></dd>
              </div>
            </dl>
          </div>
        </section>

        <div className="street-thread" aria-hidden="true"><i /></div>

        {/* ============== FEATURES — ledger: full-width ink rows, zero cards */}
        <section className="section features" aria-labelledby="tease-features-h">
          <div className="wrap">
            <div className="sec-head">
              <p className="eyebrow mono"><span className="tick" aria-hidden="true"></span>every system, one page each</p>
              <h2 id="tease-features-h" className="display">One city. <span className="accent">Seven ways to break the law in it.</span></h2>
            </div>
            <div className="ledger">
              {[
                ["01", "The open world", "96×96 tiles of hashed city, deterministic on every reload: a river with real bridges, a stadium block, parks, sidewalks, and four corner services tucked into the grid.", "/world", "Explore the city"],
                ["02", "Vehicles & driving", "Drift-on-handbrake physics, per-car handling rolls, headlights and brake lights, damage and wrecks, gas stations that repair for cash.", "/driving", "See how driving feels"],
                ["03", "Missions & heists", "Delivery runs, checkpoint circuits, steal contracts, ram jobs and a VIP escort — a new job posts itself whenever you're between crimes.", "/missions", "Read the contract board"],
                ["04", "The wanted system", "Zero to five stars, roadblocks from three, a helicopter from four. Hide in a park, respray at the paint shop, or bribe the corner mart.", "/wanted", "Learn to evade"],
                ["05", "Combat", "A punch on foot, a bat if you find one, pedestrians who scatter and cops who get briefly stunned — comedy, not gore.", "/combat", "See the moveset"],
                ["06", "Progression", "A high score, five achievements, lifetime stats, and a garage that saves your car's paint and handling to this browser between runs.", "/progression", "Check the save file"],
                ["07", "Controls & accessibility", "Full keyboard scheme, on-screen touch pads on phones, three difficulty knobs, and a peaceful mode that turns the heat off entirely.", "/controls", "See every key"],
              ].map(([n, t, d, href, cta]) => (
                <div className="ledger-row" key={n}>
                  <span className="ledger-num mono" aria-hidden="true">{n}</span>
                  <div className="ledger-body">
                    <h3 className="b-title">{t}</h3>
                    <p>{d}</p>
                  </div>
                  <a className="b-more" href={href}>{cta} <span aria-hidden="true">&rarr;</span></a>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="street-thread" aria-hidden="true"><i /></div>

        {/* ============== PRIVACY — statement band on ink ground (the dark turn) */}
        <section className="section band" aria-labelledby="tease-privacy-h">
          <div className="band-lane" aria-hidden="true"></div>
          <div className="wrap band-wrap">
            <h2 id="tease-privacy-h" className="display band-h">No server to reach, <span className="band-accent">so nothing to leak.</span></h2>
            <p className="band-p">The whole simulation — traffic, police, missions, physics — runs in one script tag in your tab. Progress is saved to this browser&rsquo;s <span className="mono-inline">localStorage</span> and nowhere else.</p>
            <a className="band-link" href="/wanted">See how the police work <span aria-hidden="true">&rarr;</span></a>
          </div>
        </section>

        <div className="street-thread" aria-hidden="true"><i /></div>

        {/* ============== PLAY — sticky split: heading pinned, key plates right */}
        <section className="section apps" aria-labelledby="tease-play-h">
          <div className="wrap apps-grid">
            <div className="apps-head">
              <p className="eyebrow mono"><span className="tick" aria-hidden="true"></span>three ways to play</p>
              <h2 id="tease-play-h" className="display">Keyboard, touchscreen, <span className="accent">or just watch.</span></h2>
              <p className="apps-note">The same single file serves every device: the overlay adapts, the save follows the browser, nothing is rebuilt for phones.</p>
            </div>
            <div className="apps-list">
              <div className="ledger-row">
                <div className="ledger-body">
                  <span className="app-tag mono">desktop</span>
                  <h3 className="b-title">WASD and a mouse-free HUD</h3>
                  <p>Walk, drive, punch, honk and pause — every action has a key, and the overlay lists all of them before you start.</p>
                </div>
                <code className="mono app-cmd ledger-meta">W A S D · E · F · SPACE</code>
              </div>
              <div className="ledger-row">
                <div className="ledger-body">
                  <span className="app-tag mono">phone</span>
                  <h3 className="b-title">On-screen touch pads</h3>
                  <p>Coarse-pointer devices get a D-pad plus action buttons overlaid on the canvas automatically — no separate mobile build.</p>
                </div>
                <code className="mono app-cmd ledger-meta">no install · same file</code>
              </div>
              <div className="ledger-row">
                <div className="ledger-body">
                  <span className="app-tag mono">endless</span>
                  <h3 className="b-title">A run that never really ends</h3>
                  <p>Getting busted resets your wanted level, not your progress — score, stats and achievements persist until you press R.</p>
                </div>
                <code className="mono app-cmd ledger-meta">R — fresh city, same save</code>
              </div>
              <a className="ghost-link" href="/progression">See what gets saved <span aria-hidden="true">&rarr;</span></a>
            </div>
          </div>
        </section>

        <div className="street-thread" aria-hidden="true"><i /></div>

        {/* ============== CLOSING — statement close, one road-paint CTA */}
        <section id="run" className="section closing" aria-labelledby="run-h">
          <div className="wrap closing-wrap">
            <p className="eyebrow mono"><span className="tick" aria-hidden="true"></span>the engine is idling</p>
            <h2 id="run-h" className="display closing-h">Steal the wheel.<br /><span className="accent">Keep the high score.</span></h2>
            <a className="nav-cta cta-big" href="/game">&#9654; Play Local Theft Auto</a>
            <p className="closing-note">Runs in any modern browser · no build step · nothing leaves this tab</p>
          </div>
        </section>
      </main>
      <Footer />
      <ChatWidget />
    </>
  );
}
