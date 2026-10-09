import FeaturePage from "../components/FeaturePage";

const HTML = `

  <section class="section page-hero ph-lean" aria-labelledby="page-h">
    <div class="hero-bg" aria-hidden="true">
      <div class="grid-floor"></div>
      <div class="hero-glow"></div>
    </div>
    <div class="wrap">
      <div class="ph-copy">
        <p class="eyebrow mono reveal"><span class="tick" aria-hidden="true"></span>fair questions</p>
        <h1 id="page-h" class="display reveal">Before you press start.</h1>
        <p class="page-lede reveal">The questions worth asking of any browser game, answered plainly.</p>
      </div>
      <div class="ph-instrument" aria-hidden="true">
        <div class="phi-tabs"><i></i><i></i><i></i></div>
      </div>
    </div>
  </section>

  <section class="section faq" aria-labelledby="faq-h">
    <div class="wrap faq-wrap">
      <h2 id="faq-h" class="sr-only">Frequently asked questions</h2>
      <div class="faq-list">
        <details class="qa reveal">
          <summary>Do I need to install anything, or make an account?</summary>
          <p>No. Open <span class="mono-inline">game.html</span> in a browser — from a static file server, or straight from disk over <span class="mono-inline">file://</span> — and press Start. There's no signup, no download, no dependency to fetch.</p>
        </details>
        <details class="qa reveal">
          <summary>Does it need a network connection?</summary>
          <p>No. The entire simulation — world, traffic, police, missions, physics, audio — runs in one script tag. The only network requests the page ever makes are the ones your browser makes for the page's own files.</p>
        </details>
        <details class="qa reveal">
          <summary>Where does my progress get saved?</summary>
          <p>In this browser's <span class="mono-inline">localStorage</span>, under four small keys: best score, lifetime stats, unlocked achievements, and your garage-saved car. See <a href="progression.html">Progression</a> for exactly what each one holds.</p>
        </details>
        <details class="qa reveal">
          <summary>Can I lose my save?</summary>
          <p>Yes — clearing site data, switching browsers, or opening a private/incognito window all leave it behind. There's no account or cloud sync backing it up; it's local storage in the literal sense.</p>
        </details>
        <details class="qa reveal">
          <summary>Does it work on my phone?</summary>
          <p>Yes. Any coarse-pointer device automatically gets on-screen touch pads over the canvas — a D-pad and action buttons — no separate mobile build required. See <a href="controls.html">Controls</a> for the full layout.</p>
        </details>
        <details class="qa reveal">
          <summary>What happens when I get busted?</summary>
          <p>Your wanted level resets to zero and you're placed back at spawn on foot — but your score, lifetime stats and achievements are untouched. It's an endless game; busts are a setback, not a game over.</p>
        </details>
        <details class="qa reveal">
          <summary>Is the wanted system too aggressive for a casual run?</summary>
          <p>Tune it down — police aggression is a pause-menu setting (0.5×/1×/1.5×), or switch on peaceful mode to remove the wanted system entirely. See <a href="controls.html">Controls</a>.</p>
        </details>
        <details class="qa reveal">
          <summary>Is the city the same every time I play?</summary>
          <p>The tile layout is deterministic — same river, same stadium, same block pattern every load, since it's computed from a hash function rather than stored. Traffic, pedestrians, missions and cops are randomized fresh each run.</p>
        </details>
        <details class="qa reveal">
          <summary>Is this part of Ollama Chat?</summary>
          <p>It ships inside the same repository as a bonus project, built by the same person, but it's a fully separate, standalone page with no dependency on the chat app or on Ollama running anywhere. See <a href="about.html">About</a> for the connection.</p>
        </details>
      </div>
    </div>
  </section>

  <section class="section closing" aria-labelledby="close-h">
    <div class="closing-bg" aria-hidden="true"><div class="grid-floor floor-up"></div></div>
    <div class="wrap closing-wrap">
      <p class="eyebrow mono reveal"><span class="tick" aria-hidden="true"></span>no more questions?</p>
      <h2 id="close-h" class="display closing-h reveal">Good.<br><span class="grad">Go steal a car.</span></h2>
      <a class="nav-cta cta-big reveal" href="game.html">▶ Play Local Theft Auto</a>
      <p class="closing-note mono reveal">No install · no account · no network</p>
    </div>
  </section>

`;

export const metadata = { title: "FAQ — how it runs, what it saves, why it's local", description: "Questions about Local Theft Auto answered: storage, privacy, ports, troubleshooting." };

export default function Page() {
  return <FeaturePage title="FAQ — how it runs, what it saves, why it's local" description="Questions about Local Theft Auto answered: storage, privacy, ports, troubleshooting." html={HTML} />;
}
