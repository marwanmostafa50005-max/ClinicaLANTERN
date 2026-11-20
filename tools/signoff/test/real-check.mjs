// Starts the sign-off server against the REAL folders, on a spare port, and only READS:
// the list, every criterion and every test history. It never signs and never posts anything.
// Run:  node tools\signoff\test\real-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { startServer, freePort, REAL_REPO } from './fixture.mjs';

const signoffDir = path.join(REAL_REPO, 'docs', 'signoff');
const snapshot = dir => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String).sort().map(n => {
  const st = fs.statSync(path.join(dir, n));
  return `${n}|${st.size}|${st.mtimeMs}`;
}).join('\n') : '(no folder)');
const before = snapshot(signoffDir);

// No SIGNOFF_ variable is set: these are the real, default folders.
const env = Object.fromEntries(Object.keys(process.env).filter(k => k.startsWith('SIGNOFF_')).map(k => [k, '']));
const server = await startServer(env, await freePort());
let bad = 0;
try {
  console.log(server.output().trim().split('\n').slice(0, 6).join('\n'));
  const get = async p => {
    const r = await fetch(server.base + p);
    const body = await r.json();
    if (r.status !== 200) { bad++; console.log(`  ${r.status} ${p}: ${body.message}`); }
    return body;
  };
  let t = performance.now();
  const list = await get('/api/list');
  const listMs = Math.round(performance.now() - t);
  const c = list.counts;
  const tally = list.tally;
  console.log(`\nListed: ${list.entries.length}. Expected by the extract files: ${tally.expected}.`);
  console.log(`  ${tally.repo} in the repository, ${tally.board + tally.boardRepair} on the build board, ${tally.drafts} drafts in the waves, ${tally.notDrafted} not drafted.`);
  console.log(`  First ten: ${list.entries.filter(e => e.set === 'ten').length}. Reserves: ${list.entries.filter(e => e.set === 'reserve').length}. Further: ${list.entries.filter(e => e.set === 'further').length}. (${tally.setsFrom})`);
  console.log(`  Left out: ${tally.leftOut.map(x => x.id).join(', ') || 'none'}. Missing: ${tally.missing.join(', ') || 'none'}. Notes: ${tally.problems.join(' | ') || 'none'}.`);
  console.log(`  Counts: ${c.signed} signed, ${c.change} to change, ${c.left} left, ${c.notDrafted} not drafted (sum ${c.signed + c.change + c.left + c.notDrafted}).`);
  console.log(`  Scored: ${list.entries.filter(e => e.result === 'pass').length} PASS, ${list.entries.filter(e => e.result === 'fail').length} not passing, ${list.entries.filter(e => e.result === 'none').length} not scored. Second opinions: ${list.entries.filter(e => e.opinion).length}.`);
  console.log(`  Unique numbers: ${new Set(list.entries.map(e => e.id)).size}. Files that cannot be read: ${list.entries.filter(e => e.bad).length}. With doubts: ${list.entries.filter(e => e.doubts).length}.`);

  t = performance.now();
  let histories = 0, rows = 0, noHistory = 0, worst = 0, noDoubt = 0;
  for (const e of list.entries) {
    const t1 = performance.now();
    const d = await get('/api/criterion?id=' + encodeURIComponent(e.id));
    worst = Math.max(worst, performance.now() - t1);
    if (!d.doubts || !d.doubts.list.length) noDoubt++;
    if (e.kind === 'criterion' && !(d.criterion && d.criterion.statement && d.criterion.rule)) { bad++; console.log('  no statement or rule shown for ' + e.id); }
    if (e.kind === 'not_drafted' && !(d.notDrafted && d.notDrafted.reason)) { bad++; console.log('  no reason shown for ' + e.id); }
    const hs = d.histories ? d.histories.list : [];
    if (e.kind === 'criterion' && hs.length === 0) noHistory++;
    for (const h of hs) {
      const data = await get(`/api/history?id=${encodeURIComponent(e.id)}&folder=${encodeURIComponent(h.folder)}&file=${encodeURIComponent(h.file)}`);
      histories++;
      rows += data.lines ? data.lines.length : 0;
      if (h.kind === 'positive' && data.lines && !data.lines.some(l => l.cited)) { bad++; console.log(`  no planted line marked in ${h.folder}/${h.file} for ${e.id}`); }
    }
  }
  const allMs = Math.round(performance.now() - t);
  const search = await get('/api/search-index');
  console.log(`\nRead every criterion (${list.entries.length}) and every test history (${histories} histories, ${rows} rows).`);
  console.log(`  Requests that failed or showed nothing: ${bad}. Criteria with no test history: ${noHistory}. Entries with no doubts shown: ${noDoubt}.`);
  console.log(`  Time: the list ${listMs} ms, one criterion at most ${Math.round(worst)} ms, everything ${allMs} ms. Search texts: ${Object.keys(search.texts).length}.`);
} finally {
  const stopped = await server.stop();
  console.log(stopped ? '\nThe server is stopped.' : '\nWARNING: the server still answers.');
}
const after = snapshot(signoffDir);
console.log(before === after ? `Nothing was written: ${signoffDir} is as it was (${before === '(no folder)' ? 'it does not exist' : 'unchanged'}).` : `WARNING: ${signoffDir} changed during a read-only check.`);
process.exitCode = bad || before !== after ? 1 : 0;
