'use strict';

// Headless smoke test for marketing/game.js — promoted from the throwaway
// harness at .pixis/scratch/game-smoke.js (see the game-improvements plan,
// item Q5). game.js is a browser-only, zero-dependency IIFE with no module
// exports, so this stubs just enough DOM/canvas surface for it to run under
// node:test, evals the source, and drives it via the same global listeners
// a real browser would call.
//
// This is a regression net for the whole file, not a feature-by-feature
// spec: it proves the requestAnimationFrame loop keeps re-arming itself
// (never throws, never stalls) across start, walking, driving and
// handbraking, which is exactly the class of bug Q1 fixed (the BUSTED
// screen used to freeze the loop's simulation branch forever).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '..', 'marketing', 'game.js'), 'utf8');

function makeCtx(textLog) {
  const grad = { addColorStop() {} };
  const store = { roundRect: undefined };
  return new Proxy(store, {
    get(t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => grad;
      if (prop === 'measureText') return () => ({ width: 42 });
      // A1/A4 tests observe the game through what it prints on the canvas
      // (ticker messages, pause-panel labels) — record fillText when asked.
      if (prop === 'fillText' && textLog) return (s) => { textLog.push(String(s)); };
      if (prop in t) return t[prop];
      return function () {};
    },
    set(t, prop, v) { t[prop] = v; return true; }
  });
}
function makeCanvas(textLog) {
  return {
    width: 0, height: 0,
    getContext: () => makeCtx(textLog),
    parentNode: { getBoundingClientRect: () => ({ width: 960, height: 540 }) }
  };
}

// The on-screen touch pad, mirrored from marketing/game.html's
// .game-frame (left pad: WASD; right pad: handbrake/E/F/P/M/H). Kept in
// sync by hand — the touch-layout assertions below pin both sides to it.
const TOUCH_KEYS = ['w', 'a', 'd', 's', ' ', 'e', 'f', 'p', 'm', 'h'];

function makeTouchBtn(key) {
  const btn = {
    handlers: {},
    getAttribute(name) { return name === 'data-key' ? key : null; },
    addEventListener(type, fn) { btn.handlers[type] = fn; },
    press() { if (btn.handlers.pointerdown) btn.handlers.pointerdown({ preventDefault() {} }); },
    release() { if (btn.handlers.pointerup) btn.handlers.pointerup({ preventDefault() {} }); }
  };
  return btn;
}

/** Builds a fresh set of DOM/window/rAF stubs and evals game.js against
 * them, returning handles the test can drive. Each call gets its own
 * listener map and rAF cell, so tests don't leak state into each other.
 *
 * B4 scaffolding: options.seed pre-populates the localStorage backing
 * store before the game boots (old-shape save tests); options.hash sets
 * window.location.hash (rival-score tests). Element stubs now record
 * textContent writes and classList changes so tests can observe them,
 * and document.querySelectorAll('.touch-btn') returns real button stubs
 * (it used to be an empty list, so the touch handler loop never ran). */
function loadGame(options) {
  const opts = options || {};
  const listeners = {};
  const elements = {};
  function el(id) {
    if (elements[id]) return elements[id];
    const classes = new Set();
    const node = {
      id,
      textContent: '',
      classes,
      classList: {
        add(c) { classes.add(c); },
        remove(c) { classes.delete(c); },
        contains(c) { return classes.has(c); }
      },
      addEventListener(type, fn) { listeners[id + ':' + type] = fn; }
    };
    elements[id] = node;
    return node;
  }
  const textLog = [];
  const canvasEl = makeCanvas(textLog);
  const touchBtns = TOUCH_KEYS.map(makeTouchBtn);
  let rafCb = null;
  let hidden = false;
  global.document = {
    getElementById(id) { return id === 'gameCanvas' ? canvasEl : el(id); },
    createElement() { return makeCanvas(); },
    addEventListener(type, fn) { listeners['document:' + type] = fn; },
    querySelectorAll(sel) { return sel === '.touch-btn' ? touchBtns : []; },
    get hidden() { return hidden; }
  };
  const localStorageStub = (function () {
    const backing = Object.assign({}, opts.seed || {});
    return {
      getItem: (k) => (k in backing ? backing[k] : null),
      setItem: (k, v) => { backing[k] = String(v); },
      backing
    };
  })();
  const replaceStateCalls = [];
  global.window = {
    addEventListener(type, fn) { listeners['window:' + type] = fn; },
    devicePixelRatio: 1,
    // game.js only ever reads/writes window.localStorage (never the bare
    // global) — alias it to the same backing store so tests that inspect
    // localStorage.getItem(...) see what the game actually persisted.
    localStorage: localStorageStub,
    location: { hash: opts.hash || '' },
    history: { replaceState(_s, _t, url) { replaceStateCalls.push(url); } }
  };
  global.localStorage = localStorageStub;
  global.requestAnimationFrame = (cb) => { rafCb = cb; };
  global.performance = { now: () => Date.now() };

  eval(code);

  const touch = {};
  TOUCH_KEYS.forEach((k, i) => { touch[k] = touchBtns[i]; });

  return {
    listeners,
    canvasEl,
    elements,
    touch,
    textLog,
    replaceStateCalls,
    storage: localStorageStub,
    setHidden(v) { hidden = v; },
    pump(n) {
      for (let i = 0; i < n; i += 1) {
        const cb = rafCb; rafCb = null;
        if (!cb) throw new Error('rAF chain broke after ' + i + ' frame(s)');
        cb();
      }
    }
  };
}

test('game boots, starts, and keeps its animation loop alive through play', () => {
  const g = loadGame();
  assert.equal(typeof g.listeners['gameStart:click'], 'function', 'start button handler registered');
  assert.equal(typeof g.listeners['window:keydown'], 'function', 'keydown handler registered');
  assert.equal(typeof g.listeners['window:keyup'], 'function', 'keyup handler registered');

  g.pump(60); // idle behind the start overlay
  assert.ok(g.canvasEl.width > 0 && g.canvasEl.height > 0, 'resize() sized the canvas');

  g.listeners['gameStart:click']();
  g.listeners['window:keydown']({ key: 'w', preventDefault() {} });
  g.pump(120); // walk
  g.listeners['window:keyup']({ key: 'w' });

  g.listeners['window:keydown']({ key: 'e', preventDefault() {} }); // try enter a car
  g.listeners['window:keyup']({ key: 'e' });

  g.listeners['window:keydown']({ key: 'w', preventDefault() {} });
  g.listeners['window:keydown']({ key: 'd', preventDefault() {} });
  g.pump(240); // drive-ish

  g.listeners['window:keydown']({ key: ' ', preventDefault() {} }); // handbrake
  g.pump(120);

  // Long-run: the loop must keep re-arming requestAnimationFrame no matter
  // what state the sim is in (this is the class of bug Q1 fixed — the
  // BUSTED overlay used to stop the loop's simulation branch forever).
  g.pump(600);
});

test('pause (P) and tab-hide stop simulation without breaking the rAF loop', () => {
  const g = loadGame();
  g.pump(10);
  g.listeners['gameStart:click']();
  g.pump(10);

  g.listeners['window:keydown']({ key: 'p', preventDefault() {} });
  g.pump(60); // paused; loop must still keep re-arming itself
  g.listeners['window:keydown']({ key: 'p', preventDefault() {} });
  g.pump(30); // unpaused

  assert.equal(typeof g.listeners['document:visibilitychange'], 'function', 'visibilitychange handler registered');
  g.setHidden(true);
  g.listeners['document:visibilitychange']();
  g.pump(60);
  g.setHidden(false);
  g.listeners['document:visibilitychange']();
  g.pump(30);
});

test('settings (1/2/3 while paused) persist to localStorage and the loop survives', () => {
  const g = loadGame();
  g.pump(5);
  g.listeners['gameStart:click']();
  g.pump(5);

  g.listeners['window:keydown']({ key: 'p', preventDefault() {} });
  g.pump(5); // paused

  g.listeners['window:keydown']({ key: '1', preventDefault() {} });
  g.listeners['window:keyup']({ key: '1' });
  g.listeners['window:keydown']({ key: '2', preventDefault() {} });
  g.listeners['window:keyup']({ key: '2' });
  g.listeners['window:keydown']({ key: '3', preventDefault() {} });
  g.listeners['window:keyup']({ key: '3' });
  g.pump(30);

  const saved = JSON.parse(global.localStorage.getItem('lta-settings'));
  assert.equal(saved.traffic, 1.5, 'traffic cycled from 1x to 1.5x');
  assert.equal(saved.cops, 1.5, 'cop aggression cycled from 1x to 1.5x');
  assert.equal(saved.peaceful, true, 'peaceful mode toggled on');

  g.listeners['window:keydown']({ key: 'p', preventDefault() {} });
  g.listeners['window:keyup']({ key: 'p' });
  g.pump(60); // unpaused, peaceful mode active — loop must keep re-arming

  assert.equal(typeof g.elements.gameStats.textContent, 'string', 'stats line was written to the element stub');
  assert.ok(g.elements.gameStats.textContent.includes('BEST'), 'stats line looks like the real statsLine() output');
});

test('touch buttons (B0): P/M/H pads register and behave like their keys', () => {
  const g = loadGame();
  // every pad button from game.html's .game-frame got a handler wired up
  for (const k of TOUCH_KEYS) {
    assert.equal(typeof g.touch[k].handlers.pointerdown, 'function', 'pointerdown wired for "' + k + '"');
    assert.equal(typeof g.touch[k].handlers.pointerup, 'function', 'pointerup wired for "' + k + '"');
  }

  g.pump(5);
  g.touch.m.press(); // muted before start is ignored, like the keyboard
  g.pump(5);
  g.listeners['gameStart:click']();
  g.pump(5);

  g.touch.m.press(); g.touch.m.release();
  assert.equal(g.storage.getItem('lta-muted'), '1', 'touch M mutes (persisted)');
  g.touch.m.press(); g.touch.m.release();
  assert.equal(g.storage.getItem('lta-muted'), '0', 'touch M unmutes again');

  // touch P pauses — observable through the keys effect on the sim: the
  // 1/2/3 settings keys only cycle while paused.
  g.touch.p.press(); g.touch.p.release();
  g.pump(5);
  g.listeners['window:keydown']({ key: '1', preventDefault() {} });
  g.listeners['window:keyup']({ key: '1' });
  assert.equal(JSON.parse(g.storage.getItem('lta-settings')).traffic, 1.5, 'while touch-paused, 1 cycles traffic');

  g.touch.p.press(); g.touch.p.release(); // resume
  g.pump(5);
  g.listeners['window:keydown']({ key: '1', preventDefault() {} });
  g.listeners['window:keyup']({ key: '1' });
  assert.equal(JSON.parse(g.storage.getItem('lta-settings')).traffic, 1.5, 'unpaused, 1 no longer cycles');
  g.pump(60); // loop intact through all of it
});

test('touch layout (B0): game.html has exactly one F button plus P/M/H', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'marketing', 'game.html'), 'utf8');
  assert.equal((html.match(/data-key="f"/g) || []).length, 1, 'duplicate F touch button removed');
  for (const k of ['p', 'm', 'h']) {
    assert.ok(html.includes('data-key="' + k + '"'), 'touch ' + k.toUpperCase() + ' button present');
  }
});

test('3,000 frames of input churn keep the rAF chain and saves intact', () => {
  const g = loadGame();
  g.pump(10);
  g.listeners['gameStart:click']();

  // deterministic LCG so the churn is reproducible
  let seed = 20260825;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const churn = ['w', 'a', 's', 'd', 'arrowup', 'arrowleft', ' ', 'e', 'f', 'h', 'p', 'm', 'r', '1', '2', '3'];
  const held = {};
  for (let i = 0; i < 3000; i += 1) {
    if (rnd() < 0.3) {
      const k = churn[Math.floor(rnd() * churn.length)];
      if (held[k]) {
        g.listeners['window:keyup']({ key: k });
        held[k] = false;
      } else {
        g.listeners['window:keydown']({ key: k, preventDefault() {} });
        held[k] = true;
      }
    }
    g.pump(1);
  }
  // bust freeze was the original loop-stall bug: even if a bust happened
  // mid-churn, the countdown must have run in frame() and the loop kept
  // re-arming — pump() above already proves that. Saves must be uncorrupted.
  for (const key of ['lta-best', 'lta-muted', 'lta-settings', 'lta-stats', 'lta-achievements', 'lta-garage']) {
    const raw = g.storage.getItem(key);
    if (raw == null) continue;
    assert.ok(!raw.includes('NaN') && !raw.includes('undefined'), key + ' has no NaN/undefined');
    if (raw[0] === '{') JSON.parse(raw); // throws if the JSON is corrupt
  }
});

test('old-shape lta-stats save merges without NaN (STATS_DEFAULTS)', () => {
  // the pre-B2 save shape: only the original five fields
  const oldShape = JSON.stringify({ steals: 3, drifted: 1234.5, deliveries: 2, fiveStarSeconds: 5, garageSaves: 1 });
  const g = loadGame({ seed: { 'lta-stats': oldShape, 'lta-best': '750' } });
  g.pump(10);
  const line = g.elements.gameStats.textContent;
  assert.ok(!line.includes('NaN'), 'stats line has no NaN, got: ' + line);
  assert.ok(line.includes('BEST 750'), 'old best still read');
  assert.ok(line.includes('3 steals'), 'old steals carried over');
  g.listeners['gameStart:click']();
  g.pump(120); // live sim touching stats fields — still no NaN written back
  const saved = JSON.parse(g.storage.getItem('lta-stats'));
  assert.equal(typeof saved.styleBest, 'number', 'new fields merged into the save');
  assert.ok(!JSON.stringify(saved).includes('NaN'), 're-saved stats stay NaN-free');
});

test('rival score hash (B9): #s=N shows on the start overlay', () => {
  const g = loadGame({ hash: '#s=5000' });
  g.pump(5);
  const line = g.elements.gameStats.textContent;
  assert.ok(line.includes('RIVAL 5000 to beat'), 'rival score surfaced, got: ' + line);
  assert.ok(line.includes('BEST'), 'regular stats line still present');

  const none = loadGame();
  none.pump(5);
  assert.ok(!none.elements.gameStats.textContent.includes('RIVAL'), 'no rival text without a hash');
});

test('weather (A1): the rain cycle rolls in and clears over simulated game time', () => {
  const g = loadGame();
  g.pump(5);
  g.listeners['gameStart:click']();
  g.pump(2);

  // Swap in a controllable clock: frame() reads performance.now() per call
  // and caps dt at 0.05, so advancing 50ms per pumped frame makes game time
  // deterministic. ~40s of game time is when the first storm must arrive
  // (weatherStep mirrors Unity's NextWeatherAt = 40); rain then lasts
  // 45–75s before "Skies clearing up".
  let ms = Date.now();
  global.performance = { now: () => ms };
  const step = (n) => { for (let i = 0; i < n; i += 1) { ms += 50; g.pump(1); } };

  step(820); // > 41s of game time
  assert.ok(
    g.textLog.some((s) => s.includes('Rain rolling in')),
    'rain announced within ~41s of simulated game time'
  );

  step(1600); // > 80s more: even the longest 75s storm must have ended
  assert.ok(
    g.textLog.some((s) => s.includes('Skies clearing up')),
    'skies cleared after the 45–75s rain window'
  );
});

test('customizer (A4): old-shape lta-settings merges with the new skin/shirt keys', () => {
  // the pre-A4 save shape: only traffic/cops/peaceful
  const oldShape = JSON.stringify({ traffic: 0.5, cops: 1.5, peaceful: true });
  const g = loadGame({ seed: { 'lta-settings': oldShape } });
  g.pump(5);
  g.listeners['gameStart:click']();
  g.pump(5);

  g.listeners['window:keydown']({ key: 'p', preventDefault() {} });
  g.pump(5); // paused — swatch picker drawn on the panel

  // keys 4/5 cycle skin/shirt while paused, same edge-trigger shape as 1/2/3
  g.listeners['window:keydown']({ key: '4', preventDefault() {} });
  g.listeners['window:keyup']({ key: '4' });
  g.listeners['window:keydown']({ key: '5', preventDefault() {} });
  g.listeners['window:keyup']({ key: '5' });
  g.pump(10);

  const saved = JSON.parse(g.storage.getItem('lta-settings'));
  assert.equal(saved.traffic, 0.5, 'old traffic value preserved');
  assert.equal(saved.cops, 1.5, 'old cops value preserved');
  assert.equal(saved.peaceful, true, 'old peaceful flag preserved');
  assert.equal(saved.skin, 1, 'skin cycled 0 → 1 and round-tripped');
  assert.equal(saved.shirt, 1, 'shirt cycled 0 → 1 and round-tripped');

  g.listeners['window:keydown']({ key: 'p', preventDefault() {} });
  g.listeners['window:keyup']({ key: 'p' });
  g.pump(60); // unpaused with the new picks applied — loop must keep re-arming

  // a fresh boot with no seed defaults the new keys and keeps them numeric
  const fresh = loadGame();
  fresh.pump(5);
  fresh.listeners['gameStart:click']();
  fresh.listeners['window:keydown']({ key: 'p', preventDefault() {} });
  fresh.pump(5);
  fresh.listeners['window:keydown']({ key: '4', preventDefault() {} });
  fresh.listeners['window:keyup']({ key: '4' });
  const freshSaved = JSON.parse(fresh.storage.getItem('lta-settings'));
  assert.equal(freshSaved.skin, 1, 'fresh save: skin cycles from the default 0');
  assert.equal(freshSaved.shirt, 0, 'fresh save: shirt stays at the default 0');
  assert.ok(!JSON.stringify(freshSaved).includes('NaN'), 'no NaN in the merged settings');
});
