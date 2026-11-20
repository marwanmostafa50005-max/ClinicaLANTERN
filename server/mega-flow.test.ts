// M01 mega flow: one patient, every criterion in use, fake models only.
// Written by Cursor on the coordinator's order C-MEGA-FLOW-1 (20 November 2026); run, mended in two places and gated by the coordinator.
// IT RUNS ONLY ON DEMAND: set LANTERN_MEGA_FLOW=1 (PowerShell: $env:LANTERN_MEGA_FLOW='1'; npx vitest run server/mega-flow.test.ts).
// Why not in every npm test: the pack under server/fixtures/mega was built against the criteria of 20 November 12:23.
// The final audit renames questions and changes criteria all day, so the pack must be built again before it is compared.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../pipeline/config.ts';
import { loadCriteriaReport } from '../pipeline/criteria.ts';
import type { CaseRecord, Finding, PharmacistQuestion } from '../shared/types.ts';
import { hasFailedCriteria, hasOpenJob, Engine } from './engine.ts';
import { PageImages } from './images.ts';
import {
  answerBodyFor,
  buildAnswerMap,
  createMegaPipeline,
  type MegaExpected,
  type MegaStats
} from './mega-fakes.ts';
import { StateStore } from './store.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'mega');
const CSV_PATH = path.join(FIXTURE, 'M01-dispense-history.csv');
const EXPECTED_PATH = path.join(FIXTURE, 'M01_EXPECTED.json');
const RUN_ON_DEMAND = process.env.LANTERN_MEGA_FLOW === '1';

let dataDir = '';
let engine: Engine;
let store: StateStore;
let expected: MegaExpected;
let csvText: string;
let answerMap: Map<string, import('./mega-fakes.ts').AnswerSpec>;
let stats: MegaStats;
let criteriaLoaded: number;
let caseId: string;
let t0: number;
let countsLine = '';
let expectedFileFault = '';

function theCase(): CaseRecord {
  const c = engine.state.cases.find(item => item.id === caseId) ?? engine.state.cases[0];
  if (!c) throw new Error('No history was imported.');
  return c;
}

function openQuestions(c: CaseRecord): PharmacistQuestion[] {
  return (c.questions ?? []).filter(q => q.status === 'open');
}

function importQuestions(c: CaseRecord): PharmacistQuestion[] {
  return (c.questions ?? []).filter(q => q.source !== 'possible');
}

// This on-demand flow still answers one question, waits until the engine is idle, and looks again.
// Answers during an unrelated screen are allowed; K-ASK-9b covers 30 rapid answers in engine.test.ts.
async function answerAllOpen(): Promise<number> {
  let answered = 0;
  for (let round = 0; round < 200; round++) {
    await engine.whenIdle();
    const c = theCase();
    const open = openQuestions(c);
    if (open.length === 0) return answered;
    engine.answerQuestion(c.id, open[0].id, answerBodyFor(open[0], answerMap));
    answered++;
  }
  throw new Error('Too many rounds answering questions.');
}

function findingFor(criterionId: string): Finding | undefined {
  return engine.state.findings.find(f => f.criterionId === criterionId);
}

(RUN_ON_DEMAND ? describe : describe.skip)('M01 mega flow', () => {
  beforeAll(async () => {
    t0 = Date.now();
    expected = JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf8')) as MegaExpected;
    csvText = fs.readFileSync(CSV_PATH, 'utf8');
    answerMap = buildAnswerMap(expected);
    const lineFaults: string[] = [];
    for (const f of expected.expected_findings) {
      for (const id of f.lines) {
        const n = Number(id.replace(/^L/, ''));
        if (!Number.isFinite(n) || n < 1 || n > expected.lines) lineFaults.push(`${f.criterion}:${id}`);
      }
    }
    if (lineFaults.length > 0) {
      expectedFileFault = `M01_EXPECTED.json cites lines not in the import: ${lineFaults.join(', ')}.`;
    }

    const load = await loadCriteriaReport(repoRoot);
    const tenProblem = load.problems.find(p => load.activeIds.includes(p.id));
    if (tenProblem) throw new Error(tenProblem.error);
    criteriaLoaded = load.criteria.length;
    if (criteriaLoaded === 0) throw new Error('No criteria loaded.');

    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-mega-'));
    store = new StateStore(dataDir);
    store.load();
    stats = { screen: 0, check: 0, letter: 0, transcribe: 0, warm: 0 };
    const { pipeline } = createMegaPipeline(expected, stats, () => engine?.state.cases[0]);

    engine = new Engine({
      cfg: loadConfig(repoRoot),
      store,
      pipeline,
      images: new PageImages(path.join(dataDir, 'images')),
      loadCriteria: async () => load,
      warmup: false,
      modelsUp: async () => true
    });
    await engine.start();
  });

  it('loads every criterion in use and imports the dispense history', async () => {
    expect(expectedFileFault, expectedFileFault).toBe('');
    const listed = JSON.parse(fs.readFileSync(path.join(repoRoot, 'criteria', 'active.json'), 'utf8')) as { active: string[]; further?: string[] };
    const listCount = new Set([...listed.active, ...(listed.further ?? [])]).size;
    expect(criteriaLoaded).toBe(listCount);   // every criterion the list names is loaded: the list decides, not a number written here

    const result = await engine.importCase({ fileName: 'M01-dispense-history.csv', source: 'csv', csvText });
    caseId = result.caseId;
    expect(theCase().lines).toHaveLength(expected.lines);
    expect(theCase().patient.sex).toBe('M');
  });

  it('drives screen and check jobs through the fake first and second models only', async () => {
    await engine.whenIdle();
    // A criterion that waits on a question is not screened until the answer comes, so the first pass makes fewer
    // calls than there are criteria: screened and waiting together are every criterion in use.
    const waitingNow = theCase().screening.criteria.filter(r => r.status === 'waiting').length;
    expect(stats.screen + waitingNow).toBeGreaterThanOrEqual(criteriaLoaded);
    expect(stats.check).toBeGreaterThan(0);
    expect(stats.transcribe).toBe(0);
  });

  it('finishes the first pass: every criterion screened or waiting, import questions, record findings at the bell', async () => {
    const c = theCase();
    const runs = c.screening.criteria;
    expect(runs).toHaveLength(criteriaLoaded);
    const lost = runs.filter(r => r.status !== 'clear' && r.status !== 'suspected' && r.status !== 'waiting' && r.status !== 'failed');
    expect(lost.map(r => `${r.criterionId}:${r.status}`)).toEqual([]);
    for (const run of runs) {
      expect(['clear', 'suspected', 'waiting', 'failed']).toContain(run.status);
    }
    const waiting = runs.filter(r => r.status === 'waiting');
    const screened = runs.filter(r => r.status !== 'waiting');
    expect(waiting.length + screened.length).toBe(criteriaLoaded);

    const questions = importQuestions(c);
    const want = expected.questions_at_import.map(q => ({ what: q.what, kind: q.kind }));
    expect(questions.map(q => ({ what: q.what, kind: q.kind })).sort((a, b) => a.what.localeCompare(b.what)))
      .toEqual(want.sort((a, b) => a.what.localeCompare(b.what)));

    for (const exp of expected.expected_findings.filter(f => f.kind === 'R')) {
      const f = findingFor(exp.criterion);
      expect(f, `Kind R finding missing for ${exp.criterion}`).toBeDefined();
      expect(f?.state).toBe('confirmed');
    }
  });

  it('answers every open question from the expected pack until none remain', async () => {
    await answerAllOpen();
    await engine.whenIdle();

    const c = theCase();
    expect(openQuestions(c)).toEqual([]);
    for (const run of c.screening.criteria) {
      expect(run.status).not.toBe('waiting');
    }

    for (const exp of expected.expected_findings) {
      if (exp.kind === 'R') continue;
      const f = findingFor(exp.criterion);
      expect(f, `Expected finding after answers: ${exp.criterion}`).toBeDefined();
      expect(f?.state).toBe('confirmed');
    }
  });

  it('matches final findings and leaves clear criteria without findings', async () => {
    await engine.whenIdle();
    expect(openQuestions(theCase())).toEqual([]);
    expect(hasOpenJob(engine.state, 'screen', caseId)).toBe(false);
    expect(hasOpenJob(engine.state, 'check', caseId)).toBe(false);
    expect(hasOpenJob(engine.state, 'letter', caseId)).toBe(false);
    expect(engine.state.jobs.some(j => j.status === 'queued' || j.status === 'running' || j.status === 'failed')).toBe(false);
    expect(hasFailedCriteria(theCase())).toBe(false);

    const suspected = engine.state.findings.filter(f => f.state === 'suspected');
    expect(suspected).toEqual([]);

    for (const exp of expected.expected_findings) {
      const f = findingFor(exp.criterion);
      expect(f, exp.criterion).toBeDefined();
      expect(f?.state).toBe('confirmed');
      expect([...(f?.check?.lineIds ?? f?.screen.lineIds ?? [])].sort()).toEqual([...exp.lines].sort());
    }

    for (const clear of expected.touched_no_finding) {
      expect(findingFor(clear.criterion), clear.criterion).toBeUndefined();
    }
  });

  it('accepts every confirmed finding and runs the fake letter model', async () => {
    const confirmed = engine.state.findings.filter(f => f.state === 'confirmed');
    for (const f of confirmed) {
      engine.decide(f.id, { action: 'accept' });
    }
    await engine.whenIdle();

    const accepted = engine.state.findings.filter(f => f.state === 'accepted');
    expect(accepted.length).toBe(expected.expected_findings.length);

    for (const f of accepted) {
      const exp = expected.expected_findings.find(x => x.criterion === f.criterionId);
      const letter = engine.state.letters.find(l => l.findingId === f.id);
      expect(letter, f.criterionId).toBeDefined();
      expect(letter?.status).not.toBe('drafting');
      expect(letter?.body.length).toBeGreaterThan(0);
      for (const lineId of exp?.lines ?? []) {
        const text = theCase().lines.find(l => l.id === lineId)?.text;
        expect(text, lineId).toBeDefined();
        expect(letter?.body).toContain(text!);
      }
    }
    const failedLetters = engine.state.jobs.filter(j => j.stage === 'letter' && j.status === 'failed');
    expect(failedLetters).toEqual([]);
  });

  it.todo('all accepted findings of the patient are in ONE letter');

  it('used only the fake models and prints the run counts', async () => {
    expect(stats.transcribe).toBe(0);
    expect(stats.warm).toBe(0);
    const questions = theCase().questions?.length ?? 0;
    const findings = engine.state.findings.length;
    const letters = engine.state.letters.length;
    const seconds = Math.round((Date.now() - t0) / 1000);
    countsLine = `criteria=${criteriaLoaded} screen=${stats.screen} check=${stats.check} letter=${stats.letter} questions=${questions} findings=${findings} letters=${letters} seconds=${seconds}`;
    console.log(countsLine);
    expect(stats.screen).toBeGreaterThan(0);
    expect(stats.check).toBeGreaterThan(0);
    expect(stats.letter).toBeGreaterThan(0);
    expect(seconds).toBeLessThan(90);
  });
});

afterAll(() => {
  if (countsLine) process.stdout.write(`\nMEGA_COUNTS ${countsLine}\n`);
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});