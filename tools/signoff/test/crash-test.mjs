// Kills the sign-off server again and again while clicks are being saved, and starts it again.
// After every kill the ledger must be valid JSON and must hold every click the server acknowledged.
// Run:  node tools\signoff\test\crash-test.mjs [kills]     (40 kills when no number is given)
// It uses a throwaway COPY of some criteria in the temp folder. The real folders are only read.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeFixture, startServer, freePort, removeFolder, sleep, REAL_REPO } from './fixture.mjs';

const KILLS = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 40;
const NAME = 'Crash Test (not a real signature)';
const proposed = JSON.parse(fs.readFileSync(path.join(REAL_REPO, 'criteria', 'active.proposed.json'), 'utf8'));
const fx = makeFixture({ repoIds: [...proposed.active, ...proposed.reserves], waves: ['W101', 'W102', 'W103', 'W104', 'W105', 'W106', 'W107', 'W108'] });
const port = await freePort();
const dir = path.dirname(fx.ledger);
let server = await startServer(fx.env, port);
const HEAD = { 'Content-Type': 'application/json', 'X-Signoff': '1' };
const post = async (p, body) => { const r = await fetch(server.base + p, { method: 'POST', headers: HEAD, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
const list = async () => (await (await fetch(server.base + '/api/list')).json());

let failed = 0;
try {
  const first = await list();
  const ids = first.entries.filter(e => e.kind === 'criterion').map(e => e.id);
  const hashOf = Object.fromEntries(first.entries.map(e => [e.id, e.hash]));
  assert.equal((await post('/api/reviewer', { name: NAME })).status, 200);

  // What the server has acknowledged: id -> { decision, note }. A missing id means no decision.
  const acked = new Map();
  let next = 0, insideSave = 0, kept = 0, notKept = 0, clicks = 0;

  for (let round = 1; round <= KILLS; round++) {
    if (next > ids.length - 12) {                     // start again at the top: take every decision back first
      for (const id of [...acked.keys()]) { assert.equal((await post('/api/withdraw', { id })).status, 200); acked.delete(id); }
      next = 0;
    }
    const big = round % 2 === 0;
    if (big) {
      // Every second round the ledger is made large, so that a save is slow and a kill lands inside it more often.
      const l = JSON.parse(fs.readFileSync(fx.ledger, 'utf8'));
      l.padding_added_by_the_test = 'x'.repeat(16_000_000);
      fs.writeFileSync(fx.ledger, JSON.stringify(l, null, 2) + '\n');
    }
    const maybe = new Set();                          // clicks that were on their way when the server was killed
    let stop = false;
    // Each worker owns the ids it takes. No worker touches a click of another worker.
    const worker = async () => {
      while (!stop && next < ids.length) {
        const id = ids[next++];
        const roll = Math.random();
        maybe.add(id);
        try {
          if (roll < 0.7) {
            const r = await post('/api/sign', { id, file_hash: hashOf[id] });
            if (r.status !== 200) continue;
            acked.set(id, { decision: 'signed', note: '' });
          } else if (roll < 0.9) {
            const note = `Round ${round}: please change ${id}.\nSecond line.`;
            const r = await post('/api/change', { id, file_hash: hashOf[id], note });
            if (r.status !== 200) continue;
            acked.set(id, { decision: 'change', note });
          } else {
            const r = await post('/api/sign', { id, file_hash: hashOf[id] });
            if (r.status !== 200) continue;
            acked.set(id, { decision: 'signed', note: '' });
            const w = await post('/api/withdraw', { id });
            if (w.status !== 200) continue;
            acked.delete(id);
          }
          maybe.delete(id);
          clicks++;
        } catch { stop = true; }                      // the connection broke: this click was on its way
      }
    };
    const killer = (async () => { await sleep((big ? 40 : 15) + Math.random() * (big ? 450 : 300)); server.child.kill('SIGKILL'); })();
    await Promise.all([worker(), worker(), worker(), killer]);
    stop = true;
    await new Promise(resolve => { if (server.child.exitCode !== null || server.child.signalCode) resolve(); else { server.child.once('exit', resolve); setTimeout(resolve, 3000); } });

    try {
      const l = JSON.parse(fs.readFileSync(fx.ledger, 'utf8'));                 // 1. the ledger is valid JSON
      assert.equal(l.reviewer, NAME);
      for (const [id, want] of acked) {                                         // 2. every acknowledged click is there
        if (maybe.has(id)) continue;
        const e = l.entries[id];
        assert.ok(e, `${id}: acknowledged ${want.decision}, but not in the ledger`);
        assert.equal(e.decision, want.decision, id);
        assert.equal(e.note, want.note, id);
        assert.equal(e.file_hash, hashOf[id], id);
      }
      for (const id of Object.keys(l.entries)) assert.ok(acked.has(id) || maybe.has(id), `${id}: in the ledger but never acknowledged`);
      for (const id of maybe) {                                                 // a click on its way may or may not have been saved
        if (l.entries[id]) { acked.set(id, { decision: l.entries[id].decision, note: l.entries[id].note }); kept++; } else { acked.delete(id); notKept++; }
      }
      const temps = fs.readdirSync(dir).filter(n => n.includes('.tmp-'));       // a kill inside a save leaves its temporary file
      if (temps.length) insideSave++;
      for (const n of temps) fs.rmSync(path.join(dir, n));                      // so that the next round counts only its own
      if (big) { delete l.padding_added_by_the_test; fs.writeFileSync(fx.ledger, JSON.stringify(l, null, 2) + '\n'); }
      server = await startServer(fx.env, port);                                 // 3. it starts again and shows what the ledger holds
      assert.ok(!server.output().includes('put back'));
      const now = await list();
      assert.equal(now.reviewer, NAME);
      assert.equal(now.entries.filter(e => e.state === 'signed').length, [...acked.values()].filter(v => v.decision === 'signed').length);
      assert.equal(now.entries.filter(e => e.state === 'change').length, [...acked.values()].filter(v => v.decision === 'change').length);
    } catch (e) {
      failed++;
      console.log(`FAIL  round ${round}: ${e && e.message ? e.message : e}`);
      break;
    }
  }
  console.log(`${failed ? 'FAIL ' : 'ok   '} ${KILLS} kills in the middle of a click loop. ${clicks} clicks acknowledged. ` +
    `${insideSave} kills left a half-written temporary file (a kill inside a save). Clicks on their way at a kill: ${kept} saved, ${notKept} not saved.`);
  console.log(failed ? 'An acknowledged click was lost, or the ledger was damaged.' : 'After every kill the ledger was valid JSON and held every acknowledged click.');
} finally {
  const stopped = await server.stop();
  console.log(stopped ? 'The test server is stopped.' : 'WARNING: the test server still answers.');
  await sleep(200);
  removeFolder(fx.root);
}
process.exitCode = failed ? 1 : 0;
