// Test helper: builds a throwaway copy of a few criteria in the temp folder, and starts and stops
// the sign-off server against it. Nothing here writes into the real folders.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { contentParts } from '../lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TOOL = path.resolve(HERE, '..');
export const REAL_REPO = path.resolve(TOOL, '..', '..');
// The runtime sits beside the founder's home, not beside this nested clone. Walk up until it is found.
function runtimeDir() {
  let dir = REAL_REPO;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'ClinicaLANTERN-Lantern-runtime');
    if (fs.existsSync(path.join(candidate, 'waves-claude'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(path.dirname(REAL_REPO), 'ClinicaLANTERN-Lantern-runtime');
}
const RUNTIME = runtimeDir();
export const REAL_WAVES = path.join(RUNTIME, 'waves-claude');
export const REAL_RUN0 = path.join(RUNTIME, 'run0', 'results', 'results.json');

const NEVER = ['sealed', 'holdout', 'review-card', 'founder-review-queue', 'synthetic_cases.py'];
const safe = src => !NEVER.some(word => src.toLowerCase().includes(word));
const copy = (from, to) => fs.cpSync(from, to, { recursive: true, filter: safe });

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/**
 * A copy of some criteria. repoIds: criteria copied from the repository (with their histories).
 * waves: wave folders copied whole from waves-claude.
 */
export function makeFixture({ repoIds, waves }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'signoff-test-'));
  const repo = path.join(root, 'repo');
  const wavesDir = path.join(root, 'waves');
  const board = path.join(root, 'board');
  for (const dir of [path.join(repo, 'criteria', '_extract'), path.join(repo, 'cases'), path.join(repo, 'docs'), path.join(repo, 'public'), wavesDir, board,
    path.join(root, 'gemini', 'reviews'), path.join(root, 'runs'), path.join(root, 'results'), path.join(root, 'audit')]) fs.mkdirSync(dir, { recursive: true });
  const ids = [];
  for (const id of repoIds) {
    copy(path.join(REAL_REPO, 'criteria', id), path.join(repo, 'criteria', id));
    if (fs.existsSync(path.join(REAL_REPO, 'cases', id))) copy(path.join(REAL_REPO, 'cases', id), path.join(repo, 'cases', id));
    ids.push(id);
  }
  for (const name of ['active.json', 'active.proposed.json']) fs.copyFileSync(path.join(REAL_REPO, 'criteria', name), path.join(repo, 'criteria', name));
  for (const wave of waves) {
    copy(path.join(REAL_WAVES, wave), path.join(wavesDir, wave));
    ids.push(...fs.readdirSync(path.join(wavesDir, wave, 'criteria')));
  }
  for (const id of ids) {
    const extract = path.join(REAL_REPO, 'criteria', '_extract', `${id}.json`);
    if (fs.existsSync(extract)) fs.copyFileSync(extract, path.join(repo, 'criteria', '_extract', `${id}.json`));
  }
  fs.copyFileSync(path.join(REAL_REPO, 'docs', 'CRITERIA_SHEET.md'), path.join(repo, 'docs', 'CRITERIA_SHEET.md'));
  fs.copyFileSync(path.join(REAL_REPO, 'public', 'mark.svg'), path.join(repo, 'public', 'mark.svg'));
  if (fs.existsSync(REAL_RUN0)) fs.copyFileSync(REAL_RUN0, path.join(root, 'results', 'results.json'));
  const paths = {
    root, repo, waves: wavesDir, board,
    ledger: path.join(root, 'signoff', 'ledger.json'),
    run0: path.join(root, 'results', 'results.json'),
    summary: path.join(root, 'runs', 'summary.json'),
    gemini: path.join(root, 'gemini', 'reviews'),
    audit: path.join(root, 'audit', 'AUDIT_BY_CRITERION.json')
  };
  const env = {
    SIGNOFF_REPO: paths.repo, SIGNOFF_WAVES: paths.waves, SIGNOFF_BOARD: paths.board, SIGNOFF_LEDGER: paths.ledger,
    SIGNOFF_RUN0: paths.run0, SIGNOFF_SUMMARY: paths.summary, SIGNOFF_GEMINI: paths.gemini, SIGNOFF_AUDIT: paths.audit
  };
  const uniqueIds = [...new Set(ids)];
  const audit = {};
  const criterionFile = id => {
    const repoFile = path.join(repo, 'criteria', id, 'criterion.json');
    if (fs.existsSync(repoFile)) return repoFile;
    if (!fs.existsSync(wavesDir)) return null;
    for (const wave of fs.readdirSync(wavesDir)) {
      const f = path.join(wavesDir, wave, 'criteria', id, 'criterion.json');
      if (fs.existsSync(f)) return f;
    }
    return null;
  };
  for (const id of uniqueIds) {
    if (id === 'DEMO-NSAID-ANTICOAG') continue;
    let parts = null;
    const file = criterionFile(id);
    if (file) {
      try { parts = contentParts(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))); } catch { parts = null; }
    }
    audit[id] = {
      final: 'SOUND', audit_complete: true,
      note_for_founder: 'Final test: PASSED on 2026-11-19 (planted findings caught 2 of 2, disputed 0, false flags 0). Ready for sign-off.',
      needs_rescore: false, points: [],
      final_test: { state: 'PASSED', text: 'Final test: PASSED on 2026-11-19 (planted findings caught 2 of 2, disputed 0, false flags 0).' },
      ...(parts ? { parts } : {})
    };
  }
  fs.writeFileSync(paths.audit, JSON.stringify(audit, null, 2) + '\n');
  return { ...paths, env, ids: uniqueIds };
}

/** Starts server.mjs with the given settings. Resolves when it is listening. */
export async function startServer(env, port) {
  const child = spawn(process.execPath, [path.join(TOOL, 'server.mjs')], {
    env: { ...process.env, ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  const until = Date.now() + 15000;
  while (!out.includes('Open this address')) {
    if (child.exitCode !== null) throw new Error(`The server stopped at once:\n${out}`);
    if (Date.now() > until) { child.kill(); throw new Error(`The server did not start in time:\n${out}`); }
    await sleep(50);
  }
  const base = `http://127.0.0.1:${port}`;
  return {
    child, base, port,
    output: () => out,
    async stop() {
      if (child.exitCode === null) {
        child.kill();
        await new Promise(resolve => { child.once('exit', resolve); setTimeout(resolve, 3000); });
      }
      // Proof that it is stopped: nothing answers on the port any more.
      try {
        await fetch(base + '/api/list', { signal: AbortSignal.timeout(1500) });
        return false;
      } catch {
        return true;
      }
    }
  };
}

/** Runs apply.mjs and returns its exit code and what it printed. */
export function runApply(env, args = []) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(TOOL, 'apply.mjs'), ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('exit', code => resolve({ code, out }));
  });
}

export function removeFolder(dir) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return true; } catch { /* try again */ }
  }
  return false;
}
