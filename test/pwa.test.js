'use strict';

// PWA support checks (7.16) — the manifest and service worker are plain
// static files with no build step, so these tests pin the contract that
// makes them work: the manifest is valid JSON with the fields Chrome needs
// for installability, the manifest is actually linked from index.html, and
// sw.js obeys the two rules that keep chat traffic live and honest (never
// caches /api/*, never caches non-GETs). runInWorker semantics can't be
// exercised under node --test; the syntax load here at least catches a
// broken file before it ships.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const pub = path.join(__dirname, '..', 'public');

test('manifest is valid JSON with installability fields', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pub, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'Ollama Chat');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 1, 'has at least one icon');
  for (const icon of manifest.icons) {
    assert.ok(icon.src && icon.type === 'image/svg+xml', 'icon entries reference the shipped SVGs');
    assert.ok(fs.existsSync(path.join(pub, icon.src)), `icon file exists: ${icon.src}`);
  }
});

test('index.html links the manifest and declares a theme color', () => {
  const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest"/);
  assert.match(html, /<meta name="theme-color"/);
});

test('sw.js parses as a script and never caches /api or non-GETs', () => {
  const src = fs.readFileSync(path.join(pub, 'sw.js'), 'utf8');
  // Syntax check: the worker top level only uses self/caches/fetch globals.
  new vm.Script(src, { filename: 'sw.js' });

  assert.match(src, /CACHE_VERSION/, 'has a versioned cache name');
  assert.match(src, /startsWith\('\/api\/'\)/, 'excludes /api/* from caching');
  assert.match(src, /req\.method !== 'GET'/, 'ignores non-GET requests');
  assert.match(src, /url\.origin !== self\.location\.origin/, 'only caches same-origin');

  // The precache list must only name files that actually ship.
  const listMatch = src.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  assert.ok(listMatch, 'declares APP_SHELL');
  const files = [...listMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(files.includes('/') && files.includes('/index.html'), 'precaches the shell entry');
  for (const f of files) {
    if (f === '/') continue;
    assert.ok(fs.existsSync(path.join(pub, f)), `APP_SHELL file exists: ${f}`);
  }
});

test('app.js registers the service worker fail-open', () => {
  const src = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
  assert.match(src, /serviceWorker' in navigator/, 'guards on SW support');
  assert.match(src, /\.register\('\/sw\.js'\)/, 'registers the worker');
  assert.match(src, /isSecureContext|location\.hostname === 'localhost'/, 'only registers in a secure context');
  assert.match(src, /register\('\/sw\.js'\)\.catch\(/, 'registration failure is swallowed');
});
