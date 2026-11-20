// Takes pictures of the sign-off page with Microsoft Edge, without a window, at 1366 x 768.
// Run:  node tools\signoff\test\screens.mjs
// The pictures are made from a throwaway COPY of some criteria. They go to tools\signoff\screens.
// With --real it also takes one picture of the page reading the REAL folders. That run only reads:
// it uses a ledger in the temp folder and clicks nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeFixture, startServer, freePort, removeFolder, sleep, TOOL, REAL_REPO, REAL_WAVES } from './fixture.mjs';

const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p));
const OUT = path.join(TOOL, 'screens');
const WIDTH = 1366;
const HEIGHT = 768;

async function waitForFile(file, timeoutMs = 30000) {
  const until = Date.now() + timeoutMs;
  let size = -1;
  while (Date.now() < until) {
    let now = -1;
    try { now = fs.statSync(file).size; } catch { now = -1; }
    if (now > 0 && now === size) return true;
    size = now;
    await sleep(250);
  }
  return false;
}

function pngSize(file) {
  const head = fs.readFileSync(file).subarray(0, 24);
  return head.toString('latin1', 1, 4) === 'PNG' ? `${head.readUInt32BE(16)} x ${head.readUInt32BE(20)}` : 'not a PNG';
}

/** One picture of one address. Edge returns before the file is written, so the file is waited for. */
async function picture(name, address) {
  const file = path.join(OUT, name);
  try { fs.unlinkSync(file); } catch { /* there was none */ }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'signoff-edge-'));
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--force-device-scale-factor=1', `--user-data-dir=${profile}`, '--virtual-time-budget=4000',
    `--window-size=${WIDTH},${HEIGHT}`, `--screenshot=${file}`, address
  ], { stdio: 'ignore', windowsHide: true });
  await new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); setTimeout(resolve, 60000).unref(); });
  const ok = await waitForFile(file);
  if (child.exitCode === null) { try { child.kill(); } catch { /* gone */ } }
  await sleep(300);
  removeFolder(profile);
  console.log(`${ok ? 'saved ' : 'FAILED'} ${file}${ok ? '  ' + pngSize(file) : ''}`);
  return ok;
}

if (!EDGE) {
  console.error('Microsoft Edge was not found. No pictures were taken.');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
let failed = 0;
const shot = async (name, address) => { if (!(await picture(name, address))) failed++; };

// ---------- pictures from the copy ----------
const proposed = JSON.parse(fs.readFileSync(path.join(REAL_REPO, 'criteria', 'active.proposed.json'), 'utf8'));
const fx = makeFixture({ repoIds: [...proposed.active, ...proposed.reserves], waves: ['W101', 'W108', 'W114', 'W116', 'W133', 'W151'] });
const server = await startServer(fx.env, await freePort());
const base = server.base;
const post = async (p, body) => (await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signoff': '1' }, body: JSON.stringify(body) })).json();
const hashOf = async id => (await (await fetch(base + '/api/criterion?id=' + id)).json()).hash;
try {
  await shot('00-first-visit-name.png', base + '/');

  await post('/api/reviewer', { name: 'A. Reviewer (test)' });
  for (const id of ['STOPP-B3', 'STOPP-B13', 'STOPP-D18', 'EU7-F02', 'EU7-F03']) await post('/api/sign', { id, file_hash: await hashOf(id) });
  await post('/api/change', { id: 'STOPP-C14', file_hash: await hashOf('STOPP-C14'), note: 'Add diltiazem to Group B.\nStrike Ranexa: it is not sold here.' });
  // One file changes after it was signed, as a repair would change it: the urgency, and one more brand.
  const changed = path.join(fx.waves, 'W101', 'criteria', 'EU7-F02', 'criterion.json');
  const repaired = JSON.parse(fs.readFileSync(changed, 'utf8'));
  repaired.urgency = 'same_day';
  Object.values(repaired.medicine_groups[0].brands)[0].push('Example brand');
  fs.writeFileSync(changed, JSON.stringify(repaired, null, 2) + '\n');
  // Another signed file is only laid out again (other line ends and spacing). Its words are the same.
  const relaid = path.join(fx.waves, 'W101', 'criteria', 'EU7-F03', 'criterion.json');
  fs.writeFileSync(relaid, JSON.stringify(JSON.parse(fs.readFileSync(relaid, 'utf8')), null, 4).replace(/\n/g, '\r\n'));
  // A result and a second opinion appear, as they will from the build board.
  fs.writeFileSync(fx.summary, JSON.stringify({ criteria: [
    { id: 'OPTIMISE-T2-22', wave: 'W116', result: 'NOT PASSING', reason: 'The history with no TSH line was not reported as a possible finding.', run: 'W116-1' },
    { id: 'OPTIMISE-T2-19', wave: 'W116', result: 'PASS', reason: '', run: 'W116-1' }
  ] }));
  fs.writeFileSync(path.join(fx.gemini, 'W116.json'), JSON.stringify([
    { criterion: 'OPTIMISE-T2-22', verdict: 'doubt', points: ['An antidepressant supply does not prove depression.', 'A TSH below 0.4 is treated as no finding. Check that.'] }
  ]));

  await shot('01-first-ten.png', base + '/#STOPP-C10');
  await shot('02-needs-a-fact.png', base + '/#OPTIMISE-T2-22');
  await shot('03-not-drafted.png', base + '/#OPTIMISE-T2-16');
  await shot('04-show-the-rows.png', base + '/?show=rows#STOPP-C10');
  await shot('05-needs-a-change-box.png', base + '/?show=change#STOPP-L2');
  await shot('06-signed.png', base + '/#STOPP-B13');
  await shot('07-change-asked.png', base + '/#STOPP-C14');
  await shot('08-look-again.png', base + '/#EU7-F02');
  await shot('09-long-statement.png', base + '/#EU7-F57');
  await shot('11-same-words-new-layout.png', base + '/#EU7-F03');
} finally {
  const stopped = await server.stop();
  console.log(stopped ? 'The test server is stopped.' : 'WARNING: the test server still answers.');
  removeFolder(fx.root);
}

// ---------- one picture of the real folders, read only ----------
if (process.argv.includes('--real')) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'signoff-real-'));
  const ledger = path.join(tmp, 'ledger.json');
  fs.writeFileSync(ledger, JSON.stringify({ reviewer: 'Not signed in (read-only check)', entries: {} }));
  const hub = path.join(path.dirname(REAL_REPO), 'ClinicaLANTERN-AgentHub', 'fireup');
  const real = await startServer({
    SIGNOFF_REPO: REAL_REPO, SIGNOFF_WAVES: REAL_WAVES, SIGNOFF_BOARD: path.join(hub, 'w', 'kimiwork', 'waves'), SIGNOFF_LEDGER: ledger,
    SIGNOFF_RUN0: path.join(path.dirname(REAL_REPO), 'ClinicaLANTERN-Lantern-runtime', 'run0', 'results', 'results.json'),
    SIGNOFF_SUMMARY: path.join(hub, 'runs', 'waves', 'summary.json'), SIGNOFF_GEMINI: path.join(hub, 'gemini', 'reviews')
  }, await freePort());
  try {
    await shot('10-real-folders-read-only.png', real.base + '/');
  } finally {
    const stopped = await real.stop();
    console.log(stopped ? 'The read-only server is stopped.' : 'WARNING: the read-only server still answers.');
    removeFolder(tmp);
  }
}

console.log(failed ? `${failed} pictures failed.` : 'All pictures were taken.');
process.exitCode = failed ? 1 : 0;
