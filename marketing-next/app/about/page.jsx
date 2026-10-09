import FeaturePage from "../components/FeaturePage";

const HTML = `

  <section class="section page-hero ph-lean" aria-labelledby="page-h">
    <div class="hero-bg" aria-hidden="true">
      <div class="grid-floor"></div>
      <div class="hero-glow"></div>
    </div>
    <div class="wrap">
      <div class="ph-copy">
        <p class="eyebrow mono reveal"><span class="tick" aria-hidden="true"></span>the other project in this repo</p>
        <h1 id="page-h" class="display reveal">Local Theft Auto lives inside <span class="grad">Ollama Chat.</span></h1>
        <p class="page-lede reveal">Ollama Chat is a small local web UI for chatting with models served by <a href="https://ollama.com" rel="noopener">Ollama</a> — a thin Express proxy plus a clean conversational frontend, with nothing you type or generate leaving your machine. Local Theft Auto is a standalone bonus canvas game that happens to ship in the same codebase, using the little chat widget in the corner of this site as its one link back.</p>
      </div>
      <div class="ph-instrument" aria-hidden="true">
        <div class="phi-rings"><i></i><i></i><i></i></div>
      </div>
    </div>
  </section>

  <!-- ==================================================== features -->
  <section class="section features" aria-labelledby="feat-h">
    <div class="wrap split-sticky port reveal-depth">
      <div class="sec-head reveal-depth">
        <span class="ch-num" aria-hidden="true">01</span>
        <p class="eyebrow mono reveal"><span class="tick" aria-hidden="true"></span>what’s inside ollama chat</p>
        <h2 id="feat-h" class="display reveal-scan">A local assistant, <span class="grad">fully stacked.</span></h2>
      </div>
      <div class="split-list">
        <article class="reveal">
          <h3 class="b-title">Streaming chat</h3>
          <p>Replies arrive token by token as Ollama produces them. Stop mid-stream any time — the server aborts upstream the moment you disconnect.</p>
        </article>
        <article class="reveal">
          <h3 class="b-title">Model management</h3>
          <p>Pull new models with live progress in the UI, switch your default, delete what you don't use — all from the Settings modal.</p>
        </article>
        <article class="reveal">
          <h3 class="b-title">Semantic memory</h3>
          <p>Ollama embeds, Qdrant indexes, everything stays local. Off until you call it.</p>
        </article>
        <article class="reveal">
          <h3 class="b-title">Chat compaction</h3>
          <p>Long conversations get older turns summarized so they fit the context window; recent messages stay verbatim.</p>
        </article>
        <article class="reveal">
          <h3 class="b-title">Attachments</h3>
          <p>Clip <span class="mono-inline">.md</span>, <span class="mono-inline">.csv</span>, <span class="mono-inline">.py</span> and other text files onto a message — read in your browser, no upload route exists.</p>
        </article>
        <article class="reveal">
          <h3 class="b-title">Accounts that stay local</h3>
          <p>Scrypt-hashed passwords, HttpOnly session cookies, SQLite via Node's built-in driver. Your sessions are scoped to you alone.</p>
        </article>
        <article class="reveal">
          <h3 class="b-title">Three ways in</h3>
          <p>A browser tab (<span class="mono-inline">npm start</span>), a native Electron desktop app, and a Flutter mobile client for iOS/Android over your LAN.</p>
        </article>
      </div>
    </div>
  </section>

  <!-- ==================================================== privacy -->
  <section class="section" aria-label="Privacy">
    <div class="wrap privacy-grid">
      <div class="privacy-copy">
        <h2 class="display reveal">Private by architecture, <span class="grad">not by policy.</span></h2>
        <ul class="proof-list">
          <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text">Your words travel to <span class="mono-inline">127.0.0.1</span> and back — the proxy's only upstream is your local Ollama.</span></li>
          <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text">Passwords hashed with scrypt; sessions ride HttpOnly, SameSite cookies valid for 30 days.</span></li>
          <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text">Chats and memory are scoped per user, stored in a git-ignored <span class="mono-inline">./data</span> folder.</span></li>
          <li class="reveal"><span class="proof-mark" aria-hidden="true"></span><span class="proof-text">Logs carry method, route, status, duration. Never message bodies.</span></li>
        </ul>
        <p class="honest lede-serif reveal">The honest footnote: Ollama Chat is built for a trusted machine or local network, not the open internet — that's stated plainly in the README, not implied by silence.</p>
      </div>
      <figure class="loopback reveal">
        <svg viewBox="0 0 560 300" role="img" aria-label="Diagram of a request's journey: from your browser to the proxy on port 4173, to Ollama on port 11434, and straight back — all inside one machine.">
          <rect class="lb-machine" x="14" y="14" width="532" height="272" rx="22"/>
          <text class="lb-cap" x="38" y="50">your machine</text>
          <circle class="lb-halo" cx="110" cy="160" r="44"/>
          <circle class="lb-node" cx="110" cy="160" r="30"/>
          <text class="lb-label" x="110" y="222">you</text>
          <circle class="lb-halo" cx="280" cy="160" r="44"/>
          <circle class="lb-node" cx="280" cy="160" r="30"/>
          <text class="lb-label" x="280" y="222">proxy :4173</text>
          <circle class="lb-halo" cx="450" cy="160" r="44"/>
          <circle class="lb-node" cx="450" cy="160" r="30"/>
          <text class="lb-label" x="450" y="222">ollama :11434</text>
          <path class="lb-path" id="lbOut" d="M144 146 C 190 112, 236 112, 248 142 M 312 142 C 340 110, 400 110, 418 144" fill="none"/>
          <path class="lb-path lb-back" id="lbBack" d="M418 178 C 380 208, 180 208, 142 176" fill="none"/>
          <circle class="lb-runner" r="5"/>
        </svg>
        <figcaption class="mono">The whole journey of a chat request. The furthest it ever goes is your own hardware.</figcaption>
      </figure>
    </div>
  </section>

  <!-- ==================================================== setup -->
  <section id="steps" class="section setup" aria-labelledby="steps-h">
    <div class="wrap port is-warm reveal-depth">
      <div class="sec-head reveal-depth">
        <span class="ch-num" aria-hidden="true">02</span>
        <p class="eyebrow mono reveal"><span class="tick" aria-hidden="true"></span>from zero to chatting</p>
        <h2 id="steps-h" class="display reveal-scan">Four steps. <span class="grad">All of them local.</span></h2>
      </div>
      <ol class="path">
        <li class="step reveal">
          <span class="node" aria-hidden="true"></span>
          <div class="step-body">
            <h3 class="b-title">Start Ollama</h3>
            <p>Install <a href="https://ollama.com" rel="noopener">Ollama</a> if you haven't, then run it — or just keep the Ollama desktop app open in the background.</p>
            <code class="mono step-code">ollama serve</code>
          </div>
        </li>
        <li class="step reveal">
          <span class="node" aria-hidden="true"></span>
          <div class="step-body">
            <h3 class="b-title">Pull a model</h3>
            <p>Any model Ollama serves will do. You can also pull and delete models later from the app's Settings modal.</p>
            <code class="mono step-code">ollama pull llama3</code>
          </div>
        </li>
        <li class="step reveal">
          <span class="node" aria-hidden="true"></span>
          <div class="step-body">
            <h3 class="b-title">Run Ollama Chat</h3>
            <p>One command installs and starts the server — a thin proxy on port 4173 in front of Ollama on 11434.</p>
            <div class="cmd" data-copy="npm install && npm start">
              <span class="cmd-prompt mono" aria-hidden="true">$</span>
              <code class="mono">npm install &amp;&amp; npm start</code>
              <button class="copy-btn" type="button" aria-label="Copy command: npm install and npm start">
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="5" y="5" width="8.5" height="8.5" rx="1.6"/><path d="M11 5V3.6A1.6 1.6 0 0 0 9.4 2H3.6A1.6 1.6 0 0 0 2 3.6v5.8A1.6 1.6 0 0 0 3.6 11H5"/></svg>
              </button>
            </div>
          </div>
        </li>
        <li class="step reveal">
          <span class="node" aria-hidden="true"></span>
          <div class="step-body">
            <h3 class="b-title">Open and sign up</h3>
            <p>Create your local account once — then every session, chat and memory index is scoped to you on this machine. Requires Node.js ≥ 22.5.</p>
            <code class="mono step-code">http://localhost:4173</code>
          </div>
        </li>
      </ol>
    </div>
  </section>

  <section class="section closing" aria-labelledby="close-h">
    <div class="closing-bg" aria-hidden="true"><div class="grid-floor floor-up"></div></div>
    <div class="wrap closing-wrap">
      <p class="eyebrow mono reveal"><span class="tick" aria-hidden="true"></span>two projects, one repo</p>
      <h2 id="close-h" class="display closing-h reveal">Chat with a model.<br><span class="grad">Or go steal a car.</span></h2>
      <div class="cta-row" style="justify-content: center;">
        <a class="nav-cta cta-big reveal" href="game.html">▶ Play Local Theft Auto</a>
      </div>
      <p class="closing-note mono reveal">github.com — one repository, two front doors</p>
    </div>
  </section>

`;

export const metadata = { title: "About — the Ollama Chat project behind the game", description: "Local Theft Auto is part of the Ollama Chat project: a local-first chat app and its game." };

export default function Page() {
  return <FeaturePage title="About — the Ollama Chat project behind the game" description="Local Theft Auto is part of the Ollama Chat project: a local-first chat app and its game." html={HTML} />;
}
