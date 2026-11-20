import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EDGE_OPTIONS, findEdge, newProfile, removeFolder, ROOT, sleep } from '../../tools/edge.mjs';
import { normalizeConfig } from '../../pipeline/config.ts';
import { readCriterion } from '../../pipeline/criteria.ts';
import { handleApi, sendJson } from '../../server/api.ts';
import { Engine } from '../../server/engine.ts';
import { PageImages } from '../../server/images.ts';
import { StateStore } from '../../server/store.ts';
import { serveStatic } from '../../server/static.ts';
import { makeOwnedDataDir, removeOwnedDataDir, standInHealth } from './walk-safety.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const port = Number(option('--port', '8813'));
const base = `http://127.0.0.1:${port}`;
const requestedDataDir = option('--data', '');
let dataDir = '';
const shots = path.resolve(option('--shots', path.join(here, 'page-walk-shots')));
const out = path.resolve(option('--out', path.join(shots, 'walk.json')));
const history = path.join(ROOT, 'cases', 'BRISNIK-HR-I1', 'pos-nofact.csv');
const reports = path.join(here, 'page-reports');
const record = { startedAt: new Date().toISOString(), base, checks: [], scenarios: {}, uploads: [], pageErrors: [], failedRequests: [], screenCalls: [], pathologyReadCalls: 0, standInHealthResponses: 0, cleanup: {} };
let readerKind = 'clean';

function check(name, ok, detail = '') {
  record.checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

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
        clearTimeout(entry.timer);
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
      const timer = setTimeout(() => {
        try { socket.close(); } catch {}
        reject(new Error('The browser connection timed out.'));
      }, 5000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(new Remote(socket)); });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('The browser did not accept the connection.')); });
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`Browser control timed out: ${method}`));
      }, 20000);
      this.waiting.set(id, { resolve, reject, method, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), fn]);
  }
  close() {
    try { this.socket.close(); } catch {}
  }
}

let edgeProcess;
let profile = '';
let debugPort = 0;
let page;

async function startBrowser() {
  const edge = findEdge();
  if (!edge) throw new Error('Microsoft Edge was not found.');
  profile = newProfile('k-path-3-edge');
  const { spawn } = await import('node:child_process');
  edgeProcess = spawn(edge, [
    ...EDGE_OPTIONS, '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', `--user-data-dir=${profile}`, '--remote-debugging-port=0',
    '--window-size=1366,768', 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  if (!fs.existsSync(portFile)) throw new Error('Edge did not start its remote control.');
  debugPort = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(r => r.json()).catch(() => []);
    target = list.find(item => item.type === 'page' && item.url === 'about:blank');
    if (!target) await sleep(100);
  }
  if (!target) throw new Error('Edge opened no page.');
  page = await Remote.open(target.webSocketDebuggerUrl);
  for (const method of ['Page.enable', 'Runtime.enable', 'Log.enable', 'Network.enable', 'DOM.enable', 'Debugger.enable']) await page.send(method);
  await page.send('Debugger.setPauseOnExceptions', { state: 'all' });
  page.on('Debugger.paused', p => {
    (record.caughtExceptions ??= []).push({
      reason: p.reason,
      description: p.data?.exception?.description ?? p.data?.description ?? p.data?.className ?? '',
      functionName: p.callFrames?.[0]?.functionName ?? '',
      url: p.callFrames?.[0]?.url ?? ''
    });
    void page.send('Debugger.resume');
  });
  page.on('Runtime.exceptionThrown', p => record.pageErrors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? 'unknown'));
  page.on('Runtime.consoleAPICalled', p => {
    if (p.type === 'error') record.pageErrors.push((p.args ?? []).map(a => a.value ?? a.description ?? '').join(' '));
  });
  page.on('Log.entryAdded', p => {
    if (p.entry?.level === 'error') record.pageErrors.push(`${p.entry.text} ${p.entry.url ?? ''}`);
  });
  page.on('Network.responseReceived', p => {
    if (p.response?.status >= 400) record.failedRequests.push(`${p.response.status} ${new URL(p.response.url).pathname}`);
  });
  page.on('Network.requestWillBeSent', p => {
    if (!p.request?.url?.includes('/pathology') || !p.request.postData) return;
    try {
      const body = JSON.parse(p.request.postData);
      record.uploads.push({
        fileName: body.fileName,
        keys: Object.keys(body),
        textPages: body.pages?.length ?? 0,
        imagePages: body.pageImages?.length ?? 0,
        pageNumbers: body.pageNumbers
      });
    } catch {}
  });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__w = {
    vis: el => !!el && el.getClientRects().length > 0,
    all: sel => (typeof sel === 'string' ? [...document.querySelectorAll(sel)] : [...sel]).filter(el => window.__w.vis(el)),
    words: el => (el?.textContent || '').replace(/\\s+/g, ' ').trim(),
    byText: (sel, text, exact) => window.__w.all(sel).find(el => exact ? window.__w.words(el) === text : window.__w.words(el).includes(text)) || null,
    card: what => window.__w.all('.panel--bell article.finding').find(el => window.__w.words(el.querySelector('.finding-label')) === what) || null,
    middle: el => { const r = el.getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2, off:el.disabled===true }; },
    point: async el => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
      if (!(hit && (hit === el || el.contains(hit) || hit.contains(el)))) {
        el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
        await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
      }
      return window.__w.middle(el);
    }
  };` });
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
}

async function stopBrowser() {
  const cleanup = { errors: [], browserStopped: !edgeProcess, profileRemoved: !profile };
  if (debugPort) {
    try {
      const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(2000) }).then(r => r.json());
      const browser = await Remote.open(version.webSocketDebuggerUrl);
      await Promise.race([browser.send('Browser.close'), sleep(1500)]);
      browser.close();
    } catch (error) {
      cleanup.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  try { page?.close(); } catch (error) { cleanup.errors.push(String(error)); }
  const exited = () => !edgeProcess || edgeProcess.exitCode !== null || edgeProcess.signalCode !== null;
  for (let i = 0; i < 60 && !exited(); i++) await sleep(100);
  if (!exited()) {
    try { edgeProcess.kill(); } catch (error) { cleanup.errors.push(String(error)); }
  }
  for (let i = 0; i < 60 && !exited(); i++) await sleep(100);
  cleanup.browserStopped = exited();
  if (profile) cleanup.profileRemoved = await removeFolder(profile) && !fs.existsSync(profile);
  record.cleanup.browser = cleanup;
}

async function js(expression) {
  const result = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(what, test, timeoutSeconds = 30) {
  const started = performance.now();
  for (;;) {
    const value = await test();
    if (value) return value;
    if ((performance.now() - started) / 1000 > timeoutSeconds) throw new Error(`Timed out: ${what}`);
    await sleep(150);
  }
}

async function click(what, expression) {
  const at = await waitFor(what, () => js(`(async () => { const el = ${expression}; return el ? await window.__w.point(el) : null; })()`));
  if (at.off) throw new Error(`${what} is disabled.`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await page.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, ...(type === 'mouseMoved' ? {} : { button: 'left', clickCount: 1 }) });
  }
  await sleep(150);
}

async function type(what, selector, text) {
  const found = await js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); el.setSelectionRange(el.value.length, el.value.length); return true; })()`);
  if (!found) throw new Error(`Missing ${what}`);
  await page.send('Input.insertText', { text });
  await sleep(100);
}

async function shot(name) {
  fs.mkdirSync(shots, { recursive: true });
  await sleep(200);
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(shots, `${name}.png`), Buffer.from(data, 'base64'));
}

async function state() {
  return fetch(`${base}/api/state`, { cache: 'no-store' }).then(r => r.json());
}

async function go(route) {
  await page.send('Page.navigate', { url: base + route });
  await waitFor('page', () => js(`!!window.__w && !!document.querySelector('.status-text')`));
  await sleep(300);
}

async function choose(selector, file) {
  const { root } = await page.send('DOM.getDocument', { depth: 1 });
  const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) throw new Error(`File input not found: ${selector}`);
  await page.send('DOM.setFileInputFiles', { nodeId, files: [file] });
}

async function importHistory() {
  await go('/');
  await click('import icon', `document.querySelector('.orb-wrap--import .orb')`);
  await waitFor('import panel', () => js(`!!document.querySelector('.panel--import input[type="file"]')`));
  await choose('.panel--import input[type="file"]', history);
  await waitFor('history and possible-finding questions', async () => {
    const snap = await state();
    const c = snap.state.cases[0];
    return c?.screening.status === 'done' && (c.questions ?? []).some(q => q.what === 'Serum sodium') &&
      (c.questions ?? []).some(q => q.kind === 'condition');
  });
  await go('/?panel=bell');
  await waitFor('question cards', () => js(`!!window.__w.card('Serum sodium')`));
}

async function enablePdfWorkerForDownstreamWalk() {
  const assets = fs.readdirSync(path.join(ROOT, 'dist', 'assets'));
  const pdfAsset = assets.filter(name => /^pdf-.*\.js$/.test(name))
    .sort((a, b) => fs.statSync(path.join(ROOT, 'dist', 'assets', b)).size - fs.statSync(path.join(ROOT, 'dist', 'assets', a)).size)[0];
  const workerAsset = assets.find(name => /^pdf\.worker.*\.mjs$/.test(name));
  if (!pdfAsset || !workerAsset) throw new Error('Built PDF module or worker asset is missing.');
  const result = await js(`(async () => { const m = await import('/assets/${pdfAsset}'); if (!m.GlobalWorkerOptions) return Object.keys(m); m.GlobalWorkerOptions.workerSrc = '/assets/${workerAsset}'; return true; })()`);
  if (result !== true) throw new Error(`PDF module has no GlobalWorkerOptions export: ${JSON.stringify(result)}`);
  record.downstreamWorkerWorkaround = { pdfAsset, workerAsset, note: 'Browser runtime only; no source or built file changed. The unmodified failure is preserved separately.' };
}

async function cleanSodium() {
  await go('/?panel=bell');
  await waitFor('open Serum sodium card', () => js(`(() => { const c=window.__w.card('Serum sodium'); return c && c.innerText.includes('Type the result'); })()`));
  await enablePdfWorkerForDownstreamWalk();
  return (await state()).state.cases[0].questions.find(q => q.what === 'Serum sodium');
}

async function openUpload(qid) {
  await click('Upload the pathology test', `window.__w.byText(window.__w.card('Serum sodium').querySelectorAll('button'), 'Upload the pathology test', true)`);
  await waitFor('file picker', () => js(`!!document.querySelector('#${qid}-pathology-file')`));
}

async function visibleCard(what = 'Serum sodium') {
  return js(`window.__w.card(${JSON.stringify(what)})?.innerText ?? ''`);
}

function saveScenario(name, visible, extra = {}) {
  record.scenarios[name] = { visible, ...extra };
}

let server;
let engine;
try {
  dataDir = makeOwnedDataDir(requestedDataDir, path.join(ROOT, 'data', 'tmp'));
  record.dataDir = dataDir;
  const ids = ['BRISNIK-HR-I1', 'BRISNIK-HR-M1'];
  const criteria = ids.map(id => readCriterion(JSON.parse(fs.readFileSync(path.join(ROOT, 'criteria', id, 'criterion.json'), 'utf8')), id));
  const store = new StateStore(dataDir);
  store.load();
  const pipeline = {
    screenCriterion: async (_cfg, _patient, lines, criterion) => {
      record.screenCalls.push({ criterion: criterion.id, at: new Date().toISOString() });
      const lineIds = lines.filter(line => /venlafaxine|Efexor/i.test(line.text)).slice(0, 1).map(line => line.id);
      const missingFacts = (criterion.needs_facts ?? []).filter(fact => {
        if (fact.what !== 'Serum sodium') return true;
        return !lines.some(line => line.text.includes('| RESULT | Serum sodium') && !line.text.includes('Taken back by the pharmacist'));
      }).map(fact => fact.what);
      return { ok: true, suspected: true, result: {
        lineIds: lineIds.length ? lineIds : ['L001'], medicines: [], missingFacts,
        reason: missingFacts.length ? `The record does not show: ${missingFacts.join(', ')}.` : 'The supplied antidepressant and recorded result meet this stand-in finding.',
        linesVerified: true, model: 'stand-in-screen', at: new Date().toISOString(), seconds: 0.01
      } };
    },
    checkFinding: async (_cfg, _patient, _lines, _criterion, finding) => ({
      confirmed: true, lineIds: finding.screen.lineIds, whatMatches: 'The stand-in finding is retained for the page walk.',
      whatCannotBeSeen: 'Nothing further in this stand-in check.', completed: true,
      model: 'stand-in-check', at: new Date().toISOString(), seconds: 0.01
    }),
    draftLetter: async () => { throw new Error('No letter step belongs to this walk.'); },
    transcribePageImage: async () => { throw new Error('No history scan belongs to this walk.'); },
    transcribePathologyPage: async () => {
      record.pathologyReadCalls++;
      return { ok: true, lines: readerKind === 'cumulative'
        ? ['FICTIONAL CUMULATIVE PATHOLOGY', 'Collected: 02/03/2026 08:15', 'Sodium 138 139 mmol/L (135-145)']
        : ['FICTIONAL PATHOLOGY', 'Collected: 12/03/2026 08:15', 'Sodium 128 mmol/L (135-145) L', 'Potassium 4.4 mmol/L (3.5-5.2)'] };
    }
  };
  engine = new Engine({
    cfg: normalizeConfig({ conditionMarkers: false, ollamaBase: 'http://127.0.0.1:1' }), store, pipeline,
    images: new PageImages(path.join(dataDir, 'images')), loadCriteria: async () => criteria,
    warmup: false, modelsUp: async () => true, now: () => new Date('2026-11-20T22:00:00+10:00')
  });
  record.modelService = engine.cfg.ollamaBase;
  await engine.start();
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (pathname === '/api/health') {
      record.standInHealthResponses++;
      sendJson(res, 200, standInHealth(engine.cfg));
      return;
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) return void handleApi(engine, req, res, pathname);
    serveStatic(path.join(ROOT, 'dist'), req, res, pathname);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  console.log(`Application with stand-in models: ${base}; data: ${dataDir}`);

  await startBrowser();
  await importHistory();
  const initial = await state();
  const initialCase = initial.state.cases[0];
  check('import opens Serum sodium and a non-pathology condition question',
    initialCase.questions.some(q => q.what === 'Serum sodium' && q.pathology?.tests?.[0]?.key === 'sodium') &&
    initialCase.questions.some(q => q.kind === 'condition' && !q.pathology));

  // (a) Text PDF, confirmation, exact record line, screening again, take-back.
  let q = await cleanSodium();
  const callsBefore = record.screenCalls.filter(call => call.criterion === 'BRISNIK-HR-I1').length;
  await openUpload(q.id);
  await choose(`#${q.id}-pathology-file`, path.join(reports, 'text-sodium.pdf'));
  await waitFor('text reading or refusal', () => js(`window.__w.card('Serum sodium').innerText.includes('USE THIS RESULT') || !!document.querySelector('.panel--bell .finding-part > .note--error')`));
  const textUploadError = await js(`window.__w.words(document.querySelector('.panel--bell .finding-part > .note--error'))`);
  if (textUploadError) throw new Error(`Text upload refused: ${textUploadError}`);
  let visible = await visibleCard();
  saveScenario('a-text-pdf-before-use', visible);
  await shot('a-text-pdf');
  check('(a) shows the Sodium row, collection date, original line/page and text reader',
    visible.includes('Sodium 128 mmol/L') && visible.includes('Sample collected 12 March 2026') &&
    visible.includes('Line of the report (page 1): "Sodium 128 mmol/L (135-145) L"') &&
    visible.includes('Read by: the text of the document'));
  await click('USE THIS RESULT', `window.__w.byText(window.__w.card('Serum sodium').querySelectorAll('button'), 'USE THIS RESULT', true)`);
  await waitFor('answer and second screening', async () => {
    const snap = await state();
    return snap.state.cases[0].questions.find(item => item.id === q.id)?.status === 'answered' &&
      snap.state.cases[0].screening.status === 'done' && record.screenCalls.filter(call => call.criterion === 'BRISNIK-HR-I1').length > callsBefore;
  });
  const answered = await state();
  const answeredCase = answered.state.cases[0];
  const answeredQ = answeredCase.questions.find(item => item.id === q.id);
  const answerLine = answeredCase.lines.find(line => line.id === answeredQ.answer.lineId)?.text ?? '';
  const expectedLine = '2026-03-12 | RESULT | Serum sodium 128 mmol/L (laboratory range 135 to 145). Read from the uploaded pathology test "text-sodium.pdf" (page 1; the line of the report: "Sodium 128 mmol/L (135-145) L") and confirmed by the pharmacist at the counter on 20 November 2026.';
  record.scenarios['a-text-pdf-before-use'].recordLine = answerLine;
  record.scenarios['a-text-pdf-before-use'].screenCallsBefore = callsBefore;
  record.scenarios['a-text-pdf-before-use'].screenCallsAfter = record.screenCalls.filter(call => call.criterion === 'BRISNIK-HR-I1').length;
  check('(a) USE THIS RESULT writes the exact sourced record line', answerLine === expectedLine, answerLine);
  check('(a) the history is screened again', record.screenCalls.filter(call => call.criterion === 'BRISNIK-HR-I1').length === callsBefore + 1);
  await click('Take this answer back', `window.__w.byText(window.__w.card('Serum sodium').querySelectorAll('button'), 'Take this answer back', true)`);
  await waitFor('question open after take-back', async () => (await state()).state.cases[0].questions.find(item => item.id === q.id)?.status === 'open');
  const takenBack = (await state()).state.cases[0].lines.find(line => line.id === answeredQ.answer.lineId)?.text ?? '';
  record.scenarios['a-text-pdf-before-use'].takenBackLine = takenBack;
  check('(a) take-back reopens the question and marks the line taken back', takenBack.endsWith('Taken back by the pharmacist at the counter.'));

  // (b) Blank original page 1, scanned result on original page 2.
  q = await cleanSodium();
  readerKind = 'clean';
  const readsBefore = record.pathologyReadCalls;
  const uploadsBefore = record.uploads.length;
  await openUpload(q.id);
  await choose(`#${q.id}-pathology-file`, path.join(reports, 'blank-then-scan.pdf'));
  await waitFor('scan reading', () => js(`window.__w.card('Serum sodium').innerText.includes('USE THIS RESULT')`));
  visible = await visibleCard();
  const scanUpload = record.uploads[uploadsBefore];
  saveScenario('b-blank-then-scan', visible, { upload: scanUpload, readCalls: record.pathologyReadCalls - readsBefore });
  await shot('b-blank-then-scan');
  check('(b) the stand-in reading model reads the lines twice', record.pathologyReadCalls - readsBefore === 2 && visible.includes('Read by: the reading model, twice, and both readings agreed'));
  check('(b) the browser sends original pageNumbers', Array.isArray(scanUpload?.pageNumbers) && scanUpload.pageNumbers.length === 1 && scanUpload.pageNumbers[0] === 2, JSON.stringify(scanUpload ?? null));
  check('(b) pharmacist sees ORIGINAL page 2', visible.includes('Line of the report (page 2): "Sodium 128 mmol/L (135-145) L"'), visible.match(/Line of the report \(page \d+\)[^\n]*/)?.[0] ?? 'no line');

  // (c) Cumulative picture: no value, every reason, typed draft retained.
  q = await cleanSodium();
  await type('typed value', `#${q.id}-value`, '777');
  await type('typed unit', `#${q.id}-unit`, 'typed-unit');
  await type('typed date', `#${q.id}-date`, '2026-03-09');
  readerKind = 'cumulative';
  await openUpload(q.id);
  await choose(`#${q.id}-pathology-file`, path.join(here, 'cumulative.png'));
  await waitFor('cumulative abstention', () => js(`window.__w.card('Serum sodium').innerText.includes('No Sodium result was found')`));
  visible = await visibleCard();
  const draftC = await js(`({value:document.querySelector('#${q.id}-value')?.value,unit:document.querySelector('#${q.id}-unit')?.value,date:document.querySelector('#${q.id}-date')?.value})`);
  saveScenario('c-cumulative-picture', visible, { draft: draftC });
  await shot('c-cumulative-picture');
  check('(c) no reading is offered and every abstention is shown',
    !visible.includes('USE THIS RESULT') && visible.includes('No Sodium result was found in this document. Type the result from the report.') && visible.includes('more than one number'));
  check('(c) typed form stays open with prior typing', draftC.value === '777' && draftC.unit === 'typed-unit' && draftC.date === '2026-03-09', JSON.stringify(draftC));

  // (d) Eleven pages: refusal and no lost draft.
  q = await cleanSodium();
  await type('typed value', `#${q.id}-value`, '888');
  await type('typed unit', `#${q.id}-unit`, 'kept-unit');
  await type('typed date', `#${q.id}-date`, '2026-03-08');
  await openUpload(q.id);
  await choose(`#${q.id}-pathology-file`, path.join(reports, 'eleven-pages.pdf'));
  await waitFor('eleven-page refusal', () => js(`window.__w.card('Serum sodium').parentElement.innerText.includes('The pathology test has more than 10 pages')`));
  const errorD = await js(`window.__w.words(document.querySelector('.panel--bell .finding-part > .note--error'))`);
  const draftD = await js(`({value:document.querySelector('#${q.id}-value')?.value,unit:document.querySelector('#${q.id}-unit')?.value,date:document.querySelector('#${q.id}-date')?.value})`);
  visible = await visibleCard();
  saveScenario('d-eleven-pages', visible, { error: errorD, draft: draftD });
  await shot('d-eleven-pages');
  check('(d) refusal uses the page/server sentence', errorD === 'The pathology test has more than 10 pages. Upload only the pages that hold the result.', errorD);
  check('(d) typed form remains with nothing lost', draftD.value === '888' && draftD.unit === 'kept-unit' && draftD.date === '2026-03-08', JSON.stringify(draftD));

  // (e) An overlong line beside a readable Sodium row.
  q = await cleanSodium();
  await openUpload(q.id);
  await choose(`#${q.id}-pathology-file`, path.join(reports, 'long-line.pdf'));
  await waitFor('long-line reading', () => js(`window.__w.card('Serum sodium').innerText.includes('USE THIS RESULT')`));
  visible = await visibleCard();
  saveScenario('e-long-line', visible);
  await shot('e-long-line');
  check('(e) readable Sodium row is offered and skipped long line is named',
    visible.includes('Sodium 128 mmol/L') && visible.includes('Line of the report (page 1): "Sodium 128 mmol/L (135-145) L"') &&
    visible.includes('One line on page 1 is too long to be a result row and was not read.'));

  // (f) Condition question has no upload way.
  await go('/?panel=bell');
  const conditionWhat = 'Persistent sleeping disturbance (for example insomnia or restless legs syndrome) or agitation';
  await waitFor('condition question', () => js(`!!window.__w.card(${JSON.stringify(conditionWhat)})`));
  visible = await visibleCard(conditionWhat);
  saveScenario('f-condition-question', visible);
  await shot('f-condition-question');
  check('(f) non-pathology condition question shows no upload way', !visible.includes('Upload the pathology test') && !visible.includes('path-O-finder'));

  check('no unexpected page errors', record.pageErrors.length === 0, record.pageErrors.join(' | '));
  check('no failed HTTP requests', record.failedRequests.length === 0, record.failedRequests.join(' | '));
} catch (error) {
  record.error = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(record.error);
  if (page) {
    try { record.visibleAtStop = await js(`document.querySelector('.panel--bell')?.innerText ?? document.body.innerText`); } catch {}
    try { await shot('stopped-here'); } catch {}
  }
} finally {
  await stopBrowser();
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  record.cleanup.serverStopped = !server || !server.listening;
  if (dataDir) record.cleanup.dataRemoved = await removeOwnedDataDir(dataDir);
  check('health came from the stand-in, with real Ollama unreachable by configuration',
    record.standInHealthResponses > 0 && record.modelService === 'http://127.0.0.1:1');
  check('owned browser, profile, server and data were stopped or removed',
    record.cleanup.browser?.browserStopped === true && record.cleanup.browser?.profileRemoved === true &&
    record.cleanup.serverStopped === true && record.cleanup.dataRemoved === true,
    JSON.stringify(record.cleanup));
  record.finishedAt = new Date().toISOString();
  record.passed = !record.error && record.checks.every(item => item.ok);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(record, null, 2) + '\n');
  console.log(`Written: ${out}`);
  console.log(`${record.checks.filter(item => item.ok).length}/${record.checks.length} checks passed`);
  process.exit(record.passed ? 0 : 1);
}
