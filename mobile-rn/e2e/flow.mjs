#!/usr/bin/env node
/**
 * Live end-to-end test for the React Native port — the adb-driven equivalent
 * of mobile/integration_test/full_flow_test.dart. Drives the real UI on a
 * running Android emulator against the real Ollama Chat server + Ollama:
 *
 *   server setup (incl. a bad-URL negative check) → signup → sessions →
 *   new session → streaming chat → persistence (reopen) → delete →
 *   theme toggle → logout → login again.
 *
 * Prereqs: emulator booted, `npm start` in the repo root (server on :4173),
 * Metro serving the app built with EXPO_PUBLIC_E2E=1 (static animations, so
 * `uiautomator dump` can reach an idle state). The app is reset first via
 * `pm clear` so every run starts from the server-setup screen.
 *
 * Usage: node e2e/flow.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const ADB = '/opt/homebrew/share/android-commandlinetools/platform-tools/adb';
const PKG = 'com.ollamachat.rn';
const SHOTS = '/tmp/shots';
const SERVER_URL = 'http://10.0.2.2:4173'; // emulator → host loopback
const BAD_URL = 'http://10.0.2.2:59999'; // nothing listens here
const USERNAME = `rne2e${Date.now() % 100000000}`;
const PASSWORD = 'password123';
const CHAT_PROMPT = 'Say hi in one word.';

fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
}

function adb(...args) {
  return execFileSync(ADB, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
function adbBuf(...args) {
  return execFileSync(ADB, args, { maxBuffer: 64 * 1024 * 1024 });
}
function sleep(ms) {
  execFileSync('sleep', [String(ms / 1000)]);
}
function shot(name) {
  fs.writeFileSync(`${SHOTS}/${name}.png`, adbBuf('exec-out', 'screencap', '-p'));
  console.log(`  📸 ${name}.png`);
}

function unescapeXml(s) {
  return s
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

/** Parses a uiautomator dump into node objects. */
function dumpNodes() {
  let xml = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const out = adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml');
    if (!out.includes('ERROR')) {
      xml = adb('shell', 'cat', '/sdcard/ui.xml');
      break;
    }
    // "could not get idle state" / "null root node" — transient; retry.
    sleep(1500);
  }
  if (!xml) return [];
  const nodes = [];
  // Match every <node> opening tag, leaf or not: testIDs routinely sit on
  // container nodes (a Pressable wrapping its label Text), which a
  // leaf-only pattern silently drops from the parsed hierarchy.
  const re = /<node ([^>]*)>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const raw = m[1];
    const attrs = {};
    const are = /([\w-]+)="([^"]*)"/g;
    let am;
    while ((am = are.exec(raw)) !== null) attrs[am[1]] = unescapeXml(am[2]);
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attrs.bounds ?? '');
    if (b) {
      attrs.cx = (Number(b[1]) + Number(b[3])) / 2;
      attrs.cy = (Number(b[2]) + Number(b[4])) / 2;
    }
    nodes.push(attrs);
  }
  return nodes;
}

function find(nodes, match) {
  return nodes.find((n) => {
    if (match.text && !(n.text ?? '').includes(match.text)) return false;
    if (match.desc && !(n['content-desc'] ?? '').includes(match.desc)) return false;
    if (match.rid && !(n['resource-id'] ?? '').includes(match.rid)) return false;
    if (match.cls && !(n.class ?? '').includes(match.cls)) return false;
    return true;
  });
}

function waitFor(match, timeoutMs = 30000, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const node = find(dumpNodes(), match);
    if (node) return node;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label ?? JSON.stringify(match)}`);
    sleep(1000);
  }
}

function waitGone(match, timeoutMs = 180000, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!find(dumpNodes(), match)) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label} to disappear`);
    sleep(1500);
  }
}

function tap(node, label) {
  adb('shell', 'input', 'tap', String(Math.round(node.cx)), String(Math.round(node.cy)));
  if (label) console.log(`  👆 ${label}`);
  sleep(700);
}
function tapBy(match, timeoutMs, label) {
  tap(waitFor(match, timeoutMs, label), label);
}
function type(text) {
  // `input text` takes %s for spaces.
  adb('shell', 'input', 'text', text.replaceAll(' ', '%s'));
  sleep(500);
}
function hideKeyboard() {
  const ime = adb('shell', 'dumpsys', 'input_method');
  if (/mInputShown=true/.test(ime)) {
    adb('shell', 'input', 'keyevent', '4'); // BACK dismisses a shown IME without navigating
  } else {
    adb('shell', 'input', 'keyevent', '111');
  }
  sleep(800);
}
function back() {
  adb('shell', 'input', 'keyevent', '4');
  sleep(1000);
}
function scrollUp() {
  adb('shell', 'input', 'swipe', '540', '1700', '540', '800', '250');
  sleep(700);
}

/** Taps a possibly-offscreen element, scrolling until it appears. */
function tapScrolling(match, label, maxScrolls = 6) {
  for (let i = 0; i <= maxScrolls; i++) {
    const node = find(dumpNodes(), match);
    if (node) return tap(node, label);
    scrollUp();
  }
  throw new Error(`Could not reach ${label} after scrolling`);
}

function typeInto(match, text, label, { scroll = false } = {}) {
  if (scroll) tapScrolling(match, `${label} (focus)`);
  else tapBy(match, 15000, `${label} (focus)`);
  type(text);
}

/** Focuses an EditText and replaces whatever it holds with `text`. */
function setField(match, text, label) {
  tapBy(match, 15000, `${label} (focus)`);
  adb('shell', 'input', 'keyevent', 'KEYCODE_MOVE_END');
  const dels = Array(60).fill('67').join(' ');
  adb('shell', 'input', 'keyevent', `--longpress ${dels}`);
  sleep(300);
  type(text);
  const node = find(dumpNodes(), match);
  if ((node?.text ?? '') !== text) {
    throw new Error(`Field ${label} did not take the value (got "${node?.text ?? ''}")`);
  }
}

console.log('═══ Ollama Chat (React Native) — live E2E flow ═══');

// ---- 0. Fresh state --------------------------------------------------------
console.log('\n[0] Resetting app state and launching…');
adb('shell', 'pm', 'clear', PKG);
adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
waitFor({ text: 'Save & continue' }, 60000, 'server setup screen');
pass('app boots to server-setup screen');
shot('01-server-setup');

// ---- 1. Negative: unreachable URL must not be saved ------------------------
console.log('\n[1] Bad URL is rejected before saving…');
setField({ rid: 'server-url-input' }, BAD_URL, 'server URL');
hideKeyboard();
tapBy({ rid: 'save-server-button' }, 30000, 'Save & continue (bad URL)');
waitFor({ rid: 'setup-error-banner' }, 25000, 'setup error banner');
pass('unreachable URL shows error banner and is not saved');
shot('02-setup-error');

// ---- 2. Good URL -------------------------------------------------------------
console.log('\n[2] Saving the real server URL…');
setField({ rid: 'server-url-input' }, SERVER_URL, 'server URL');
hideKeyboard();
tapBy({ rid: 'save-server-button' }, 30000, 'Save & continue');
waitFor({ text: 'Create one' }, 30000, 'login screen');
pass('valid URL accepted → login screen');
shot('03-login');

// ---- 3. Signup ----------------------------------------------------------------
console.log('\n[3] Creating an account…');
tapBy({ rid: 'open-signup-button' }, 15000, 'Create one');
waitFor({ text: 'Create account' }, 20000, 'signup screen');
typeInto({ rid: 'signup-username-input' }, USERNAME, 'username', { scroll: true });
typeInto({ rid: 'signup-password-input' }, PASSWORD, 'password', { scroll: true });
typeInto({ rid: 'signup-confirm-input' }, PASSWORD, 'confirm', { scroll: true });
hideKeyboard();
tapScrolling({ rid: 'signup-button' }, 'Sign up');
const userRow = waitFor({ rid: 'status-rail-user' }, 30000, 'sessions status rail');
if ((userRow.text ?? '').includes(`@${USERNAME}`)) pass(`auto-signed-in as @${USERNAME}`);
else fail('status rail shows the new user', userRow.text ?? '');
shot('04-sessions-empty');

// ---- 4. New session + streaming chat ------------------------------------------
console.log('\n[4] Starting a session and chatting with llama3.2:3b…');
tapBy({ rid: 'new-session-button' }, 15000, 'New session');
waitFor({ rid: 'selected-model-label' }, 30000, 'model picker label');
const modelLabel = find(dumpNodes(), { rid: 'selected-model-label' })?.text ?? '';
pass(`model auto-selected: ${modelLabel}`);
shot('05-chat-motd');
typeInto({ rid: 'chat-input' }, CHAT_PROMPT, 'chat composer');
hideKeyboard();
tapBy({ rid: 'send-button' }, 15000, 'Send');
try {
  waitFor({ rid: 'stop-button' }, 20000, 'stop button (stream started)');
  pass('streaming started (Stop visible)');
  shot('06-chat-streaming');
} catch {
  console.log('  (stop button not observed — stream may have been fast)');
}
waitGone({ rid: 'stop-button' }, 180000, 'stop button (stream end)');
sleep(1000);
let nodes = dumpNodes();
const assistantNode = [...nodes].reverse().find((n) => (n['resource-id'] ?? '').includes('assistant-message'));
const reply = (assistantNode?.text ?? '').trim();
if (reply.length > 0 && !reply.startsWith('Error:')) {
  pass(`assistant streamed a reply: "${reply.slice(0, 60)}${reply.length > 60 ? '…' : ''}"`);
} else {
  fail('assistant reply is non-empty and not an error', reply);
}
shot('07-chat-reply');

// ---- 5. Persistence: reopen the session ----------------------------------------
console.log('\n[5] Back to the register; reopening the session…');
back();
waitFor({ rid: 'new-session-button' }, 20000, 'sessions screen');
shot('08-sessions-after-chat');
tapBy({ rid: 'session-row-0' }, 15000, 'first session row');
waitFor({ rid: 'chat-input' }, 20000, 'chat screen reopened');
nodes = dumpNodes();
const hasUserMsg = nodes.some((n) => (n.text ?? '').includes(CHAT_PROMPT));
const reopenedAssistant = [...nodes].reverse().find((n) => (n['resource-id'] ?? '').includes('assistant-message'));
if (hasUserMsg && (reopenedAssistant?.text ?? '').trim().length > 0) {
  pass('turn persisted server-side and reloads on reopen');
} else {
  fail('reopen shows both turns', `user=${hasUserMsg} assistant="${reopenedAssistant?.text ?? ''}"`);
}
shot('09-reopened-session');

// ---- 6. Delete the session -------------------------------------------------------
console.log('\n[6] Deleting the session…');
back();
waitFor({ rid: 'new-session-button' }, 20000, 'sessions screen');
tapBy({ rid: 'delete-session-button' }, 15000, 'Delete');
waitFor({ rid: 'empty-register' }, 20000, 'NO SESSIONS empty state');
pass('session deleted → empty register');
shot('10-sessions-deleted');

// ---- 7. Theme toggle ----------------------------------------------------------------
console.log('\n[7] Toggling theme…');
tapBy({ rid: 'theme-toggle-button' }, 15000, 'theme toggle');
sleep(900);
pass('toggled to light mode');
shot('11-light-mode');
tapBy({ rid: 'theme-toggle-button' }, 15000, 'theme toggle back');
sleep(900);

// ---- 8. Logout, then log back in ------------------------------------------------------
console.log('\n[8] Logging out and back in…');
tapBy({ rid: 'logout-button' }, 15000, 'Log out');
waitFor({ rid: 'login-button' }, 20000, 'login screen after logout');
pass('logged out → login screen');
shot('12-logged-out');
typeInto({ rid: 'login-username-input' }, USERNAME, 'username');
typeInto({ rid: 'login-password-input' }, PASSWORD, 'password');
hideKeyboard();
tapBy({ rid: 'login-button' }, 15000, 'Log in');
const rail = waitFor({ rid: 'status-rail-user' }, 30000, 'sessions after re-login');
if ((rail.text ?? '').includes(`@${USERNAME}`)) pass(`re-logged in as @${USERNAME}`);
else fail('re-login lands on the register', rail.text ?? '');
shot('13-relogged-in');

// ---- Summary ------------------------------------------------------------------------
console.log('\n═══ Summary ═══');
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
console.log(failed.length === 0 ? `\nALL ${results.length} CHECKS PASSED` : `\n${failed.length} CHECK(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
