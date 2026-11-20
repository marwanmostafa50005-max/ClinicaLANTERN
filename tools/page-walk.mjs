// Walks through the real page in a real browser, the way the pharmacist does, with the real models:
//   a clean start, a CSV import, the bell, Accept, the letter (edit, tick, sent, reply, close),
//   the near miss, a PDF with text, a bypass, a picture of a printed history and a scanned PDF of two
//   pages (Model 1 reads the rows, the rows are confirmed on the page), and the page at phone width.
// It clicks and types through headless Microsoft Edge, takes pictures (live-walk-*.png) and checks
// what the server recorded after each step. Fictional patients only. No real person.
//
//   1. Start Ollama and the server first (docs/RUNNING.md):   npm start
//   2. Run:   node tools/page-walk.mjs [--base http://127.0.0.1:8787] [--shots docs/screens] [--out file.json]
//                                      [--no-scan]       leave out the picture and the scanned PDF (saves about 6 minutes)
//                                      [--no-scan-pdf]   leave out the scanned PDF only (saves about 3 minutes)
//                                      [--steps loop,near,pdf,picture,scan-pdf,phone]   walk only the steps named
//
// It starts a clean demo first (the server keeps the old state as a dated backup).
// It never clicks Print, Copy or the email link: those would reach the printer, the clipboard and
// the email program of this computer. The print layout is checked by saving it as a PDF instead.
// It ends with code 0 when every check passed, 1 when a check failed, 2 when it could not run.
// Importing this file does not start Edge. The walk runs only when this file is the one that was started.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EDGE_OPTIONS, findEdge, newProfile, removeFolder, ROOT, sleep } from './edge.mjs';
import { findingLines } from '../shared/lines.ts';
import { letterFindingIds } from '../shared/patient-letter.ts';

/** The value after a named option. A missing value, or another option in that place, keeps the fallback. */
export function takeOption(argv, name, fallback) {
  const at = argv.indexOf(name);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback;
}

/** The server address. A trailing slash is dropped. With no --base, the address is port 8787. */
export function serverBase(argv) {
  return takeOption(argv, '--base', 'http://127.0.0.1:8787').replace(/\/+$/, '');
}

export const ALL_STEPS = ['loop', 'near', 'pdf', 'picture', 'scan-pdf', 'phone'];

/** The steps this walk will run, in walk order. An unknown name is left out. */
export function stepsOf(argv) {
  const chosen = new Set(
    takeOption(argv, '--steps', ALL_STEPS.join(',')).split(',').map(s => s.trim()).filter(s => ALL_STEPS.includes(s))
  );
  if (argv.includes('--no-scan')) chosen.delete('picture');
  if (argv.includes('--no-scan') || argv.includes('--no-scan-pdf')) chosen.delete('scan-pdf');
  return ALL_STEPS.filter(step => chosen.has(step));
}

const args = process.argv.slice(2);
const option = (name, fallback) => takeOption(args, name, fallback);
const BASE = serverBase(args);
const SHOT_DIR = path.resolve(ROOT, option('--shots', 'docs/screens'));
const OUT = option('--out', '');
const CRITERION = option('--criterion', 'DEMO-NSAID-ANTICOAG');
const STEPS = new Set(stepsOf(args));
const DEMO = path.join(ROOT, 'cases', '_demo');
const FICTIONAL_LINE = 'Fictional patient. No real person.';

const started = performance.now();
const record = { startedAt: new Date().toISOString(), base: BASE, checks: [], shots: [], timings: {}, pageErrors: [], failedRequests: [] };
const since = () => Math.round((performance.now() - started) / 100) / 10;
const secondsFrom = t0 => Math.round((performance.now() - t0) / 100) / 10;
const say = text => console.log(`+${since().toFixed(1).padStart(6)} s  ${text}`);

function check(name, ok, detail = '') {
  record.checks.push({ name, ok: Boolean(ok), detail });
  say(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`);
  return Boolean(ok);
}

async function getState() {
  const res = await fetch(BASE + '/api/state', { cache: 'no-store' });
  return res.json();
}

// ---------- a small client for the browser's remote control (Chrome DevTools Protocol) ----------

class Remote {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.waiting = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const entry = this.waiting.get(message.id);
        if (!entry) return;
        this.waiting.delete(message.id);
        if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
        else entry.resolve(message.result);
      } else {
        for (const fn of this.listeners.get(message.method) ?? []) fn(message.params);
      }
    });
  }

  static open(address) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(address);
      socket.addEventListener('open', () => resolve(new Remote(socket)));
      socket.addEventListener('error', () => reject(new Error('The browser did not accept the connection.')));
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), fn]);
  }

  close() {
    try { this.socket.close(); } catch { /* already closed */ }
  }
}

let edgeProcess = null;
let profile = '';
let page = null;          // the remote control of the page
let debugPort = 0;

async function startBrowser() {
  const edge = findEdge();
  if (!edge) throw new Error('Microsoft Edge was not found on this computer.');
  profile = newProfile('walk-edge');
  edgeProcess = spawn(edge, [
    ...EDGE_OPTIONS, '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', `--user-data-dir=${profile}`, '--remote-debugging-port=0',
    '--window-size=1366,768', 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
  // Edge writes the port it chose into its profile folder.
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  if (!fs.existsSync(portFile)) throw new Error('Edge did not start its remote control.');
  await sleep(200);
  debugPort = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
  let target = null;
  for (let i = 0; i < 50 && !target; i++) {
    const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(r => r.json()).catch(() => []);
    target = list.find(t => t.type === 'page' && t.url === 'about:blank') ?? null;
    if (!target) await sleep(100);
  }
  if (!target) throw new Error('Edge opened no page.');
  page = await Remote.open(target.webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Log.enable');
  await page.send('Network.enable');
  await page.send('DOM.enable');

  page.on('Runtime.exceptionThrown', p => record.pageErrors.push(`Error on the page: ${p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? 'unknown'}`.slice(0, 400)));
  page.on('Runtime.consoleAPICalled', p => {
    if (p.type === 'error') record.pageErrors.push(`Console error: ${(p.args ?? []).map(a => a.value ?? a.description ?? '').join(' ')}`.slice(0, 400));
  });
  page.on('Log.entryAdded', p => {
    if (p.entry?.level === 'error') record.pageErrors.push(`Browser log: ${p.entry.text} ${p.entry.url ?? ''}`.slice(0, 400));
  });
  page.on('Network.responseReceived', p => {
    if (p.response?.status >= 400) record.failedRequests.push(`${p.response.status} ${new URL(p.response.url).pathname}`);
  });
  page.on('Network.loadingFailed', p => {
    if (!p.canceled) record.failedRequests.push(`failed: ${p.errorText ?? ''} (${p.type ?? ''})`);
  });
  // A page with unsaved edits asks before it is left. The walk always agrees.
  page.on('Page.javascriptDialogOpening', () => void page.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}));

  // Small helpers that live in the page: find what is visible, by words.
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__w = {
      vis: el => !!el && el.getClientRects().length > 0,
      all: sel => [...document.querySelectorAll(sel)].filter(el => window.__w.vis(el)),
      words: el => (el.textContent || '').replace(/\\s+/g, ' ').trim(),
      byText: (sel, text, exact) => window.__w.all(sel).find(el => exact ? window.__w.words(el) === text : window.__w.words(el).includes(text)) || null,
      text: sel => { const el = window.__w.all(sel)[0]; return el ? window.__w.words(el) : null; },
      middle: el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, off: el.disabled === true }; },
      inReach: el => { const m = window.__w.middle(el); if (m.x < 0 || m.y < 0 || m.x > window.innerWidth || m.y > window.innerHeight) return false;
        const hit = document.elementFromPoint(m.x, m.y); return !!hit && (hit === el || el.contains(hit) || hit.contains(el)); },
      point: async el => {
        // The page is scrolled only when the element cannot be clicked where it is, as a person would do.
        if (!window.__w.inReach(el)) {
          el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
          await Promise.race([new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))), new Promise(done => setTimeout(done, 300))]);
        }
        return window.__w.middle(el);
      }
    };`
  });
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
}

async function stopBrowser() {
  try {
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then(r => r.json());
    const browser = await Remote.open(version.webSocketDebuggerUrl);
    await Promise.race([browser.send('Browser.close'), sleep(1500)]);
    browser.close();
  } catch { /* it is stopped below */ }
  page?.close();
  for (let i = 0; i < 60 && edgeProcess && edgeProcess.exitCode === null; i++) await sleep(100);
  if (edgeProcess && edgeProcess.exitCode === null) {
    try { edgeProcess.kill(); } catch { /* already gone */ }
  }
  await sleep(500);
  if (profile) await removeFolder(profile);
}

// ---------- what the walk can do on the page ----------

async function js(expression) {
  const result = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(`The page could not run a step: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
  return result.result.value;
}

async function waitFor(what, test, timeoutSeconds = 60) {
  const t0 = performance.now();
  for (;;) {
    const value = await test();
    if (value) return value;
    if ((performance.now() - t0) / 1000 > timeoutSeconds) throw new Error(`Timed out waiting for: ${what}`);
    await sleep(200);
  }
}

const waitForJs = (what, expression, timeoutSeconds = 60) => waitFor(what, () => js(expression), timeoutSeconds);

/** A real mouse click in the middle of the element the expression finds. */
async function click(what, expression) {
  const t0 = performance.now();
  const at = await waitFor(`${what} to be on the page`, () => js(`(() => { const el = ${expression}; return el ? window.__w.point(el) : null; })()`), 20);
  if (at.off) throw new Error(`${what} is switched off and cannot be clicked.`);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 });
  await sleep(150);
  if (performance.now() - t0 > 2000) say(`        (the click on "${what}" took ${secondsFrom(t0)} s)`);
}

const button = (text, exact = true) => `window.__w.byText('button', ${JSON.stringify(text)}, ${exact})`;

/** Types text at the end of a text box, through the browser's own text input. */
async function typeAtEnd(what, selector, text) {
  const t0 = performance.now();
  const found = await js(`(async () => { const el = window.__w.all(${JSON.stringify(selector)})[0]; if (!el) return false; await window.__w.point(el); el.focus({ preventScroll: true }); el.setSelectionRange(el.value.length, el.value.length); return true; })()`);
  if (!found) throw new Error(`${what} was not found on the page.`);
  await page.send('Input.insertText', { text });
  await sleep(150);
  if (performance.now() - t0 > 2000) say(`        (typing into ${what} took ${secondsFrom(t0)} s)`);
}

async function chooseFile(fileName) {
  const { root } = await page.send('DOM.getDocument', { depth: 1 });
  const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.panel--import input[type="file"]' });
  if (!nodeId) throw new Error('The file box of the import panel was not found.');
  await page.send('DOM.setFileInputFiles', { nodeId, files: [path.join(DEMO, fileName)] });
}

async function setSize(width, height, phone = false) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: phone });
}

async function go(route) {
  await page.send('Page.navigate', { url: BASE + route });
  await waitForJs('the page to show the status line', `(() => { const t = window.__w && window.__w.text('.status-text'); return t && t !== 'Starting' ? t : null; })()`, 30);
  await sleep(300);
}

async function shot(name) {
  const size = await js('({ w: window.innerWidth, h: window.innerHeight })');
  const file = path.join(SHOT_DIR, `live-walk-${name}-${size.w}x${size.h}.png`);
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await sleep(350);            // lets a short animation end
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  record.shots.push(path.relative(ROOT, file).split(path.sep).join('/'));
  say(`        picture: ${path.relative(ROOT, file)}`);
}

const noSidewaysScroll = () => js('document.documentElement.scrollWidth <= window.innerWidth + 1');
const openPanel = name => click(`the ${name} icon`, `document.querySelector('.orb-wrap--${name} .orb')`);
const backToMain = async () => {
  await click('Back to the main page', `document.querySelector('.panel-close')`);
  await waitForJs('the main page', `!document.querySelector('.panel')`, 15);
};
const badge = name => js(`window.__w.text('#orb-badge-${name}')`);
const statusLine = () => js(`window.__w.text('.status-text')`);

async function importFile(fileName) {
  const doneWords = `${fileName} was imported`;
  if (!(await js(`!!document.querySelector('.panel--import')`))) await openPanel('import');
  await waitForJs('the import panel', `!!document.querySelector('.panel--import .dropzone')`, 15);
  const before = (await getState()).state.cases.length;
  await chooseFile(fileName);
  await waitFor(`${fileName} to be imported`, async () => {
    const error = await js(`window.__w.text('.panel--import .note--error')`);
    if (error) throw new Error(`The page refused ${fileName}: ${error}`);
    return (await js(`(window.__w.text('.panel--import .note--ok') || '').includes(${JSON.stringify(doneWords)})`)) && (await getState()).state.cases.length === before + 1;
  }, 120);
  const s = await getState();
  return s.state.cases[s.state.cases.length - 1];
}

const findingOfCase = (s, caseId) => s.state.findings.find(f => f.caseId === caseId && f.criterionId === CRITERION);
/** The one letter that holds this finding. A later point keeps the first finding's id on the letter. */
const letterHolding = (letters, findingId) => (letters ?? []).find(letter => letterFindingIds(letter).includes(findingId));

async function waitForConfirmed(caseId, timeoutSeconds = 300) {
  return waitFor(`the finding of ${caseId} to be confirmed`, async () => {
    const s = await getState();
    const c = s.state.cases.find(x => x.id === caseId);
    const f = findingOfCase(s, caseId);
    if (c?.screening.status === 'done' && !f) throw new Error(`Model 1 suspected nothing on ${c.fileName}.`);
    if (f && f.state === 'not_confirmed') throw new Error(`Model 2 did not confirm the finding on ${c.fileName}.`);
    return f && f.state === 'confirmed' ? f : null;
  }, timeoutSeconds);
}

// ---------- the walk ----------

async function walk() {
  say(`ClinicaLANTERN page walk against ${BASE}. Fictional patients only.`);
  const criteria = await fetch(BASE + '/api/criteria').then(r => r.json());
  const criterion = Array.isArray(criteria) ? criteria.find(c => c.id === CRITERION) : null;
  if (!criterion) throw new Error(`The criterion ${CRITERION} is not in use on this server. See docs/RUNNING.md.`);

  await startBrowser();
  await setSize(1366, 768);
  await go('/');
  check('the page opens and shows the hero and the three round icons',
    await js(`!!document.querySelector('.hero-mark') && window.__w.all('.orb').length === 3 && window.__w.text('.purpose') === 'A Pharmacist-in-the-loop Clinical Decision Support System' && window.__w.text('.slogan') === 'See what routine dispensing can miss.'`));
  const sizes = await js(`window.__w.all('.orb-disc').map(el => Math.round(el.getBoundingClientRect().width))`);
  const heroShare = await js(`Math.round(100 * document.querySelector('.hero').getBoundingClientRect().height / window.innerHeight)`);
  check('each round icon is at least 160 points across and the hero takes half of the first screen or more',
    sizes.length === 3 && sizes.every(w => w >= 160) && heroShare >= 50, `icons ${sizes.join(', ')}; hero ${heroShare}% of the screen`);
  check('the page says the patient is fictional', (await js(`document.body.innerText.includes(${JSON.stringify(FICTIONAL_LINE)})`)) === true);

  // ----- a clean start, with the page's own button -----
  await click('Start a clean demo', button('Start a clean demo'));
  await click('Yes, start clean', button('Yes, start clean'));
  await waitFor('the clean state', async () => (await getState()).state.cases.length === 0, 15);
  await js('window.scrollTo(0, 0)');
  const clean = await getState();
  check('"Start a clean demo" on the page empties the state', clean.state.cases.length === 0 && clean.state.findings.length === 0 && clean.state.letters.length === 0 &&
    clean.state.activity.some(a => a.kind === 'reset'), `${clean.state.activity.length} log entry`);
  await sleep(1200);
  check('the counts on the page are all 0 and the status line says Idle',
    (await js(`window.__w.all('.count-value').map(el => el.textContent.trim()).join(',')`)) === '0,0,0,0,0,0,0,0' && (await statusLine()) === 'Idle');

  if (STEPS.has('loop')) await stepLoop(criterion);
  if (STEPS.has('near')) await stepNearMiss();
  if (STEPS.has('pdf')) await stepPdf();
  if (STEPS.has('picture')) await scanRoute('positive-scan.png', 1, 'scan', '16-scan');
  if (STEPS.has('scan-pdf')) await scanRoute('positive-scan.pdf', 2, 'scanPdf', '17-scan-pdf');
  if (STEPS.has('phone')) await stepPhone();
  await endChecks();
}

// ----- step "loop": a CSV import, the notification, the bell, Accept, the letter, the closed loop -----
async function stepLoop(criterion) {
  let t = performance.now();
  await openPanel('import');
  await shot('01-import-panel-empty');
  const csvCase = await importFile('positive.csv');
  check('a CSV chosen in the import panel is imported', csvCase.source === 'csv' && csvCase.lines.length === 45 && csvCase.fileName === 'positive.csv',
    `${csvCase.id}, ${csvCase.patient.label}, ${csvCase.lines.length} lines`);
  await shot('02-csv-imported');
  await backToMain();
  await waitFor('Mantle or Lumen to show on the status line', async () => /^(Mantle|Lumen) is/.test((await statusLine()) ?? ''), 60);
  const seenStatus = await statusLine();
  check('the status line on the page says what the model is doing', /^Mantle is screening: criterion \d+ of \d+|^Lumen is double-checking/.test(seenStatus ?? ''), seenStatus ?? '');

  // ----- the notification: badge and pop-up -----
  const finding = await waitForConfirmed(csvCase.id);
  await waitFor('the red badge on the bell', async () => {
    const text = await badge('bell');
    return text != null && Number(text) >= 1;
  }, 20);
  await waitForJs('the pop-up message', `!!window.__w.byText('.popup--bell', 'A finding was confirmed', false)`, 20);
  record.timings.csvImportToBellBadge = secondsFrom(t);
  check('a confirmed finding raises the red badge on the bell and a pop-up message', true, `${record.timings.csvImportToBellBadge} s after the import`);
  await shot('03-finding-notification');

  // ----- the bell panel -----
  await click('Open the bell (in the pop-up)', `window.__w.byText('.popup--bell button', 'Open the bell', true)`);
  await waitForJs('the finding card', `!!document.querySelector('.panel--bell .finding')`, 15);
  await waitFor('the bell badge to clear', async () => (await getState()).counts.bellBadge === 0, 15);
  const focus = `[data-finding-focus="${finding.id}"]`;
  const card = await js(`(() => { const f = document.querySelector(${JSON.stringify(focus)}); return {
    label: window.__w.words(f.querySelector('.finding-label')), statement: window.__w.words(f.querySelector('.criterion-text')),
    credit: window.__w.words(f.querySelector('.credit')), hits: [...f.querySelectorAll('.line--hit .line-id')].map(e => e.textContent.trim()),
    text: f.innerText }; })()`);
  // The page shows the lines of both models, by the one rule the letter and the scorer use too.
  const shownLines = findingLines(finding).all;
  check('the bell panel shows the criterion label, its source text and its credit line',
    card.label === criterion.label && card.statement === criterion.statement && card.credit === criterion.source.credit);
  check('the bell panel highlights the lines the two models cited', JSON.stringify(card.hits) === JSON.stringify(shownLines) && card.hits.includes('L036') && card.hits.includes('L041'),
    card.hits.join(', '));
  check('the bell panel shows what Model 2 said matches and what cannot be seen',
    card.text.includes(finding.check.whatMatches) && card.text.includes(finding.check.whatCannotBeSeen));
  check('opening the bell cleared its badge', (await badge('bell')) === null);
  await shot('04-bell-panel');
  await click('Show the whole history', `window.__w.byText(${JSON.stringify(focus + ' .link-btn')}, 'Show the whole history', false)`);
  const whole = await js(`(() => { const f = document.querySelector(${JSON.stringify(focus)}); return { lines: f.querySelectorAll('.line').length, hits: f.querySelectorAll('.line--hit').length }; })()`);
  check('the whole history is one click away, with the matching lines marked', whole.lines === 45 && whole.hits === shownLines.length, `${whole.lines} lines, ${whole.hits} marked`);

  // ----- Accept -----
  const countsAtAccept = (await getState()).counts;
  t = performance.now();
  await click('Accept', `window.__w.byText(${JSON.stringify(focus + ' button')}, 'Accept', true)`);
  await waitForJs('the receipt', `!!window.__w.byText('.receipt', 'accepted', false)`, 15);
  const afterAccept = await getState();
  const accepted = afterAccept.state.findings.find(f => f.id === finding.id);
  const letterId = letterHolding(afterAccept.state.letters, finding.id)?.id;
  check('Accept on the page records the decision and queues the letter', accepted?.state === 'accepted' && Boolean(letterId), `letter ${letterId}`);
  await shot('05-accepted');

  // A second confirmed finding of this patient, when one is already waiting, joins the same letter.
  // The demo history has one criterion, so this step says so and goes on with one point.
  const second = afterAccept.state.findings.find(f => f.caseId === finding.caseId && f.id !== finding.id && f.state === 'confirmed');
  let pointCount = 1;
  if (second) {
    await click('Accept the next finding', `window.__w.byText(${JSON.stringify(`[data-finding-focus="${second.id}"] button`)}, 'Accept', true)`);
    await waitFor('the second finding to join the letter', async () => {
      const held = letterHolding((await getState()).state.letters, second.id);
      return held?.id === letterId && letterFindingIds(held).length === 2;
    }, 20);
    pointCount = 2;
    check('a second accept joins the same letter', true, `letter ${letterId}, 2 points`);
  } else {
    check('this history had one confirmed finding, so the letter has one point', true, csvCase.fileName);
  }

  // ----- the letter -----
  await click('Open the letters', `window.__w.byText('.receipt .link-btn', 'Open the letters', true)`);
  await waitForJs('the letter panel', `!!document.querySelector('.panel--letter')`, 15);
  if (await js(`(() => { const t = document.querySelector('.panel--letter')?.innerText ?? ''; return t.includes('is writing this letter') || t.includes('A point of this letter is still being written.'); })()`)) {
    await shot('06-letter-being-written');
  }
  await waitForJs('the letter to be ready to review', `(() => { const b = document.querySelector('.panel--letter textarea.letter-body'); const chip = window.__w.text('.letter-top .chip'); return !!b && b.value.includes('Dear Doctor') && chip === 'Ready to review'; })()`, 180);
  record.timings.acceptToLetterOnPage = secondsFrom(t);
  await waitFor('the letter badge to clear', async () => (await getState()).counts.letterBadge === 0, 15);
  const editor = await js(`({ subject: document.querySelector('.panel--letter .subject-input').value, body: document.querySelector('.panel--letter textarea.letter-body').value,
    chip: window.__w.text('.letter-top .chip'), trail: window.__w.text('.trail') })`);
  check('the letter Model 3 wrote is in the editor', editor.subject.length > 5 && editor.body.includes(criterion.statement) && editor.body.includes(FICTIONAL_LINE) &&
    (pointCount === 1 || editor.body.includes('I raise 2 points')) &&
    editor.chip === 'Ready to review' && /Drafted by Model 3|Built from the template/.test(editor.trail ?? ''), `${record.timings.acceptToLetterOnPage} s after Accept. Subject: ${editor.subject}`);
  const readyState = await getState();
  const heldReady = readyState.state.letters.find(l => l.id === letterId);
  check('one letter is ready for however many points were accepted',
    Boolean(heldReady) && letterFindingIds(heldReady).length === pointCount && readyState.counts.lettersReady === countsAtAccept.lettersReady + 1,
    `${pointCount} ${pointCount === 1 ? 'point' : 'points'}, lettersReady ${readyState.counts.lettersReady}`);
  if (pointCount > 1) {
    const heading = await js(`window.__w.text('.panel--letter .letter-for')`);
    const rowWhat = await js(`window.__w.text('.panel--letter .letter-row-what')`);
    check('the header and the list say how many points',
      (heading ?? '').includes(`${pointCount} points`) && rowWhat === `${pointCount} points`, `${heading ?? ''} / ${rowWhat ?? ''}`);
  }
  await shot('07-letter-ready');

  const addition = '\n\nP.S. Added by the pharmacist in the page walk.';
  await typeAtEnd('the letter editor', '.panel--letter textarea.letter-body', addition);
  await waitForJs('the words "Changes not saved yet"', `window.__w.text('.save-state') === 'Changes not saved yet'`, 10);
  await click('Save changes', button('Save changes'));
  await waitFor('the edit to reach the server', async () => (await getState()).state.letters.find(l => l.id === letterId)?.editedByPharmacist === true, 15);
  const edited = (await getState()).state.letters.find(l => l.id === letterId);
  check('an edit typed in the editor is saved on the server', edited.body.includes(addition.trim()) && edited.body.trimEnd().endsWith('PHA0002761764') && edited.draft.body !== edited.body &&
    (await js(`window.__w.text('.save-state')`)) === 'All changes saved');

  await click('the tick box', `document.querySelector('.panel--letter .agree-row input[type="checkbox"]')`);
  await waitFor('the patient agreement on the server', async () => Boolean((await getState()).state.letters.find(l => l.id === letterId)?.patientAgreed), 15);
  check('the tick box records that the patient agrees', true);

  // The page opens the preview and keeps that preview's token. A second preview from this script would make the token stale.
  await click('Preview letter', button('Preview letter'));
  await waitFor('a preview is recorded before Mark as sent', async () => Boolean((await getState()).state.letters.find(l => l.id === letterId)?.previewHash), 15);
  await waitForJs('the preview page', `!!window.__w.byText('button', 'Mark as sent', true)`, 15);

  // The button opens this address from code. The walk reads it and does not click it.
  const mail = await js(`document.querySelector('.panel--letter [data-mailto]')?.getAttribute('data-mailto') ?? ''`);
  const mailBody = decodeURIComponent((mail.split('&body=')[1] ?? ''));
  check('"Open in my email program" is a mailto link with the subject and a short cover note, and no address',
    mail.startsWith('mailto:?subject=') && decodeURIComponent(mail.slice('mailto:?subject='.length).split('&')[0]) === editor.subject &&
    mailBody.includes('Dear Doctor') && mailBody.includes(FICTIONAL_LINE) && !mailBody.includes('Dispensing lines'), `${mail.length} characters`);

  // The print layout, saved as a PDF. Nothing is sent to a printer.
  const printFile = path.join(SHOT_DIR, 'live-walk-print-letter-a4.pdf');
  const printed = await page.send('Page.printToPDF', { preferCSSPageSize: true, printBackground: false });
  fs.writeFileSync(printFile, Buffer.from(printed.data, 'base64'));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(printFile)), verbosity: pdfjs.VerbosityLevel.ERRORS });
  const doc = await task.promise;
  let printedText = '';
  let a4 = true;
  for (let n = 1; n <= doc.numPages; n++) {
    const p = await doc.getPage(n);
    const view = p.getViewport({ scale: 1 });
    if (Math.abs(view.width - 595) > 2 || Math.abs(view.height - 842) > 2) a4 = false;
    printedText += (await p.getTextContent()).items.map(i => ('str' in i ? i.str : '')).join(' ') + '\n';
  }
  const printedPages = doc.numPages;
  await task.destroy().catch(() => {});
  record.timings.printedPages = printedPages;
  check('Print shows only the letter, on A4', a4 && printedText.includes('Dear Doctor') && printedText.includes('Added by the pharmacist in the page walk') &&
    printedText.includes(FICTIONAL_LINE) && !printedText.includes('Mark as sent') && !printedText.includes('Back to the main page') && !printedText.includes('Letters to the doctor'),
    `${printedPages} A4 ${printedPages === 1 ? 'page' : 'pages'}: ${path.relative(ROOT, printFile)}`);

  await click('Mark as sent', button('Mark as sent'));
  await click('On paper', button('On paper'));
  await waitFor('the letter to be sent', async () => (await getState()).state.letters.find(l => l.id === letterId)?.status === 'sent', 15);
  await waitForJs('the Sent chip', `window.__w.text('.letter-top .chip') === 'Sent'`, 10);
  check('"Mark as sent" on the page records how the letter went out', (await getState()).state.letters.find(l => l.id === letterId)?.sentBy === 'print');
  await shot('08-letter-sent');
  await click("Record the doctor's reply", button("Record the doctor's reply"));
  await click('the outcome', `window.__w.byText('.outcome', 'The doctor will review the patient', true)`);
  await typeAtEnd('the reply note', '.panel--letter .inline-form textarea', 'Page walk: the practice rang back. The doctor will review the patient next week.');
  await shot('09-reply-form');
  await click('Save the reply', button('Save the reply'));
  await waitFor('the reply on the server', async () => (await getState()).state.letters.find(l => l.id === letterId)?.status === 'reply_recorded', 15);
  check("the doctor's reply is recorded from the page", (await getState()).state.letters.find(l => l.id === letterId)?.reply?.outcome === 'will_review');
  await click('Close the case', button('Close the case'));
  await waitFor('the case to be closed', async () => (await getState()).state.letters.find(l => l.id === letterId)?.status === 'closed', 15);
  await waitForJs('the Closed chip', `window.__w.text('.letter-top .chip') === 'Closed'`, 10);
  check('"Close the case" on the page closes the loop', (await js(`window.__w.text('.next-step')`)) === 'This case is closed. The loop is complete.');
  await shot('10-letter-closed');
  await backToMain();
  const countLine = pointCount === 2 ? '1,2,2,0,1,1,1,0' : '1,1,1,0,1,1,1,0';
  const countWords = pointCount === 2
    ? '1 screened, 2 confirmed, 2 accepted, 0 bypassed, 1 sent, 1 reply, 1 closed, 0 overdue'
    : '1 screened, 1 confirmed, 1 accepted, 0 bypassed, 1 sent, 1 reply, 1 closed, 0 overdue';
  await waitForJs('the counts', `window.__w.all('.count-value').map(el => el.textContent.trim()).join(',') === ${JSON.stringify(countLine)}`, 15);
  check('the counts on the main page show the closed loop', true, countWords);
  await shot('11-main-loop-closed');
}

// ----- step "near": the near miss -----
async function stepNearMiss() {
  const t = performance.now();
  const nearCase = await importFile('near-miss.csv');
  await waitFor('the near miss to be screened', async () => {
    const s = await getState();
    return s.state.cases.find(c => c.id === nearCase.id)?.screening.status === 'done' && !s.state.jobs.some(j => j.status === 'queued' || j.status === 'running');
  }, 300);
  record.timings.nearMissOnPage = secondsFrom(t);
  await waitForJs('the near miss card', `!!window.__w.byText('.panel--import .case', 'No finding was suspected', false)`, 15);
  const nearState = await getState();
  check('the near miss ends clear on the page', !nearState.state.findings.some(f => f.caseId === nearCase.id) && nearState.counts.bellBadge === 0,
    `${record.timings.nearMissOnPage} s`);
  await shot('12-near-miss-clear');
  await backToMain();
}

// ----- step "pdf": a PDF with text inside, then a bypass -----
async function stepPdf() {
  const t = performance.now();
  const pdfCase = await importFile('positive.pdf');
  const supplyLines = pdfCase.lines.filter(l => /^\d{2}\/\d{2}\/\d{4} \| /.test(l.text));
  const notes = await js(`window.__w.text('.panel--import .note--ok')`);
  check('a PDF with text is read by the page, one row for each printed row, with no model',
    pdfCase.source === 'pdf-text' && pdfCase.transcriptionConfirmed === true && supplyLines.length === 45 && !pdfCase.cannotAssess &&
    supplyLines.some(l => l.text === '21/08/2026 | Celebrex | 200 mg | capsule | 30 | 2 | Take ONE capsule daily with food | Dr G. Sample'),
    `${pdfCase.lines.length} lines, ${supplyLines.length} of them supplies. The page said: ${notes}`);
  await shot('13-pdf-imported');
  const pdfFinding = await waitForConfirmed(pdfCase.id);
  record.timings.pdfImportToConfirmed = secondsFrom(t);
  const celebrexInPdf = pdfCase.lines.filter(l => l.text.includes('Celebrex')).map(l => l.id);
  const xareltoInPdf = pdfCase.lines.filter(l => l.text.includes('Xarelto')).map(l => l.id);
  check('the same finding is confirmed from the PDF, with a Celebrex line and a Xarelto line cited',
    celebrexInPdf.length === 2 && findingLines(pdfFinding).all.some(id => celebrexInPdf.includes(id)) && findingLines(pdfFinding).all.some(id => xareltoInPdf.includes(id)),
    `${record.timings.pdfImportToConfirmed} s. Celebrex is on ${celebrexInPdf.join(', ')}; Model 1 cited ${pdfFinding.screen.lineIds.join(', ')}; Model 2 cited ${pdfFinding.check.lineIds.join(', ')}`);
  // The pop-up shows over the import panel. It must go away when the bell is opened by its icon.
  await waitForJs('the pop-up message', `!!window.__w.byText('.popup--bell', 'A finding was confirmed', false)`, 20);
  await backToMain();
  await openPanel('bell');
  await waitForJs('the finding card', `!!document.querySelector('.panel--bell .finding')`, 15);
  check('a pop-up about findings goes away when the bell is opened by its icon', (await js(`window.__w.all('.popup--bell').length`)) === 0);
  await shot('14-pdf-finding');
  await click('Bypass', button('Bypass'));
  const reason = 'Page walk: the doctor already knows and has a plan.';
  await typeAtEnd('the reason box', '.panel--bell .bypass-form textarea', reason);
  await shot('15-bypass-reason');
  await click('Bypass this finding', button('Bypass this finding'));
  await waitFor('the bypass on the server', async () => (await getState()).state.findings.find(f => f.id === pdfFinding.id)?.state === 'bypassed', 15);
  const bypassed = (await getState()).state.findings.find(f => f.id === pdfFinding.id);
  check('Bypass on the page keeps the reason and queues no letter', bypassed.decision?.reason === reason && !letterHolding((await getState()).state.letters, pdfFinding.id) &&
    Boolean(await js(`!!window.__w.byText('.receipt', 'bypassed', false)`)));
  await backToMain();
}

// ----- steps "picture" and "scan-pdf": a history that arrives as pictures. Model 1 reads the rows, the pharmacist confirms them -----
/** One history that arrives as pictures: a picture file, or a PDF whose pages are pictures. */
async function scanRoute(fileName, pages, key, shots) {
  const { parseCsv } = await import('../pipeline/index.ts');
  const truth = parseCsv(fs.readFileSync(path.join(DEMO, 'positive.csv'), 'utf8')).lines.map(l => l.text);
  const waitingAfter = (await getState()).counts.bellBadge + 1;
  let t0 = performance.now();
  const scanCase = await importFile(fileName);
  const said = await js(`window.__w.text('.panel--import .note--ok')`);
  check(`${fileName} is sent as ${pages === 1 ? 'a page image' : pages + ' page images'} and nothing is screened before the rows are checked`,
    scanCase.source === 'pdf-image' && scanCase.transcriptionConfirmed === false && scanCase.screening.status === 'not_started', `${scanCase.id}. The page said: ${said}`);
  await waitForJs('the card to say Model 1 is reading', `!!window.__w.byText('.panel--import .case', 'Model 1', false)`, 15);
  await shot(`${shots}-being-read`);
  await backToMain();
  const reading = /^Mantle is reading a scanned page/;
  await waitFor('the status line to say a scan is read', async () => reading.test((await statusLine()) ?? '') || (await getState()).state.cases.find(c => c.id === scanCase.id)?.lines.length > 0, 60);
  const readingLines = new Set();
  await waitFor('Model 1 to read the rows', async () => {
    const line = await statusLine();
    if (reading.test(line ?? '')) readingLines.add(line);
    const c = (await getState()).state.cases.find(x => x.id === scanCase.id);
    if (c?.cannotAssess) throw new Error(`${fileName} could not be read: ${c.cannotAssess}`);
    return c?.lines.length > 0;
  }, 900);
  record.timings[`${key}ImportToRowsRead`] = secondsFrom(t0);
  await waitFor('the badge on the magnifying glass', async () => (await badge('import')) === '1', 20);
  await waitForJs('the pop-up message', `!!window.__w.byText('.popup--import', 'rows from the scan are ready', false)`, 20);
  check(`${fileName}: when the rows are read, the magnifying glass gets a badge and a pop-up asks for a check`, true,
    `${record.timings[`${key}ImportToRowsRead`]} s to read ${pages === 1 ? 'the page' : 'the ' + pages + ' pages'}. Status line while reading: ${[...readingLines].join(' / ')}`);
  await shot(`${shots}-rows-ready`);
  await click('Check the rows (in the pop-up)', `window.__w.byText('.popup--import button', 'Check the rows', true)`);
  await waitForJs('the rows to check', `!!document.querySelector('.panel--import .scan-check')`, 15);
  const shown = await js(`[...document.querySelectorAll('.panel--import .scan-check .line .line-text')].map(el => el.textContent.replace(/\\s+/g, ' ').trim())`);
  const exact = truth.filter((row, i) => shown[i] === row).length;
  record.timings[`${key}RowsExact`] = `${exact} of ${truth.length}`;
  record[`${key}RowsThatDiffer`] = truth.map((row, i) => (shown[i] === row ? null : { row: i + 1, printed: row, read: shown[i] ?? '(nothing)' })).filter(Boolean);
  const pictures = await js(`document.querySelectorAll('.panel--import .scan-check .scan-pages img').length`);
  check(`${fileName}: the rows Model 1 read are shown beside the ${pages === 1 ? 'picture' : 'pictures'}, to be checked`, shown.length > 0 && pictures === pages &&
    (await js(`!!window.__w.byText('.panel--import .scan-check h5', 'Read from a scan: please check', true)`)),
    `${shown.length} rows shown, ${exact} of ${truth.length} exactly as printed, ${pictures} ${pictures === 1 ? 'picture' : 'pictures'}`);
  await shot(`${shots}-check-rows`);
  // The pictures can be shown at full size, so the print in them can be read and compared.
  await click('Show the picture larger', `window.__w.byText('.scan-check .link-btn', 'larger', false)`);
  const large = await js(`(() => { const img = document.querySelector('.scan-check .scan-pages img'); return { shown: Math.round(img.getBoundingClientRect().width), real: img.naturalWidth }; })()`);
  check(`${fileName}: the ${pages === 1 ? 'picture' : 'pictures'} can be shown at full size`, large.shown >= large.real - 2, `${large.shown} of ${large.real} points wide`);
  await shot(`${shots}-picture-larger`);
  await click('Show the picture smaller', `window.__w.byText('.scan-check .link-btn', 'smaller', false)`);
  t0 = performance.now();
  await click('The rows are right. Start screening', button('The rows are right. Start screening', false));
  const scanFinding = await waitForConfirmed(scanCase.id);
  record.timings[`${key}ConfirmToFinding`] = secondsFrom(t0);
  const scanLines = (await getState()).state.cases.find(c => c.id === scanCase.id).lines;
  const celebrexInScan = scanLines.filter(l => l.text.includes('Celebrex')).map(l => l.id);
  const xareltoInScan = scanLines.filter(l => l.text.includes('Xarelto')).map(l => l.id);
  check(`${fileName}: after the rows are confirmed the history is screened and the finding is confirmed, with a Celebrex line and a Xarelto line cited`,
    celebrexInScan.length === 2 && findingLines(scanFinding).all.some(id => celebrexInScan.includes(id)) && findingLines(scanFinding).all.some(id => xareltoInScan.includes(id)) &&
    (pages === 1 || scanLines.some(l => l.page === pages)),
    `${record.timings[`${key}ConfirmToFinding`]} s. Celebrex is on ${celebrexInScan.join(', ')}; Model 2 cited ${scanFinding.check.lineIds.join(', ')}`);
  await backToMain();
  await waitFor('the red badge on the bell', async () => (await badge('bell')) === String(waitingAfter), 20);
  await shot(`${shots}-finding-waiting`);
}

// ----- step "phone": the page at phone width -----
async function stepPhone() {
  await setSize(390, 844, true);
  const phone = [];
  for (const [name, route] of [['20-main', '/'], ['21-import-panel', '/?panel=import'], ['22-letter-panel', '/?panel=letter'], ['23-bell-panel', '/?panel=bell']]) {
    await go(route);
    await sleep(800);
    phone.push(await noSidewaysScroll());
    await shot(name);
  }
  check('at phone width (390 by 844) nothing scrolls sideways, on the main page and in the three panels', phone.every(Boolean), phone.join(', '));
  await setSize(1366, 768);
  await go('/');
  await sleep(800);
  check('at 1366 by 768 nothing scrolls sideways', await noSidewaysScroll());
  await shot('24-main-end');
}

// ----- at the end: errors on the page, and anything in the page that is not the app -----
async function endChecks() {
  const final = await getState();
  record.counts = final.counts;
  check('the page raised no error and no call to the server failed', record.pageErrors.length === 0 && record.failedRequests.length === 0,
    [...record.pageErrors, ...record.failedRequests].join(' | ') || 'none');
  // A browser extension can draw its own things into a page. The pictures must show only the app.
  const strangers = await js(`[...document.documentElement.children].filter(e => !['HEAD', 'BODY'].includes(e.tagName)).map(e => e.tagName.toLowerCase())
    .concat([...document.body.children].filter(e => !(e.id === 'root' || e.tagName === 'NOSCRIPT' || e.tagName === 'SCRIPT' || e.classList.contains('print-sheet'))).map(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')))`);
  check('nothing from outside the app is drawn into the page', strangers.length === 0, strangers.join(', ') || 'only the app');
}

const calledDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (calledDirectly) {
  let code = 2;
  try {
    await walk();
    record.passed = record.checks.every(c => c.ok);
    code = record.passed ? 0 : 1;
    say(record.passed ? `ALL ${record.checks.length} CHECKS PASSED.` : `FAILED: ${record.checks.filter(c => !c.ok).map(c => c.name).join('; ')}`);
    say(`Timings: ${JSON.stringify(record.timings)}`);
  } catch (e) {
    record.error = e instanceof Error ? e.message : String(e);
    console.error('The page walk stopped:', record.error);
    if (page) {
      try { await shot('stopped-here'); } catch { /* no picture then */ }
    }
    if (record.pageErrors.length + record.failedRequests.length > 0) console.error([...record.pageErrors, ...record.failedRequests].join('\n'));
  }
  await stopBrowser();
  record.finishedAt = new Date().toISOString();
  record.seconds = since();
  if (OUT) {
    try {
      fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
      fs.writeFileSync(path.resolve(OUT), JSON.stringify(record, null, 1));
      say(`Written: ${OUT}`);
    } catch (e) {
      console.error('The record could not be written:', e instanceof Error ? e.message : e);
    }
  }
  process.exit(code);
}
