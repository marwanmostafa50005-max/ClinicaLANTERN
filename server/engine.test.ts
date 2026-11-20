import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppState, CheckResult, Criterion, Finding, Job, LanternConfig, Letter, LetterDraft, ScreenResult } from '../shared/types.ts';
import { assembleLetter, citedLineIds, letterMessages, MIXED_WRITING_LINE } from '../pipeline/letter.ts';
import { linesById } from '../pipeline/history.ts';
import { letterFindingIds } from '../shared/patient-letter.ts';
import { testConfig, testCriterion } from '../pipeline/testkit.ts';
import { linesForModels, PHARMACIST_MARK, TAKEN_BACK_MARK } from './questions.ts';
import { addJob, ApiError, Engine, hasFailedCriteria, hasOpenJob, pickNextJob, queueChecks, recoverAfterRestart, type PipelineFns } from './engine.ts';
import { PageImages } from './images.ts';
import { emptyState, StateStore } from './store.ts';
import { computeCounts, computeNow, HELD_FOR_MODELS, PASS_NOT_FINISHED } from './view.ts';

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const ONE: Criterion = { ...testCriterion, id: 'ONE', label: 'Criterion one' };
const TWO: Criterion = { ...testCriterion, id: 'TWO', label: 'Criterion two' };
const THREE: Criterion = { ...testCriterion, id: 'THREE', label: 'Criterion three' };
const FOUR: Criterion = { ...testCriterion, id: 'FOUR', label: 'Criterion four' };

const CSV = [
  'patient_ref,patient_age,patient_sex,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber',
  'F-001,72,F,2026-08-08,,Xarelto,20 mg,tablet,28,5,Take ONE tablet daily with food,Dr F. Example',
  'F-001,72,F,2026-08-21,,Celebrex,200 mg,capsule,30,2,Take ONE capsule daily with food,Dr G. Sample'
].join('\r\n');

function screenResult(lineIds: string[]): ScreenResult {
  return { lineIds, medicines: ['celecoxib', 'rivaroxaban'], reason: 'Both are supplied.', linesVerified: lineIds.length > 0, missingFacts: [], model: 'lantern-screen', at: '2026-11-18T00:00:00.000Z', seconds: 1 };
}

function checkResult(confirmed: boolean, completed = true): CheckResult {
  return { confirmed, lineIds: confirmed ? ['L001', 'L002'] : [], whatMatches: 'Celebrex and Xarelto.', whatCannotBeSeen: 'Kidney function.', completed, model: 'lantern-check', at: '2026-11-18T00:00:10.000Z', seconds: 2 };
}

function letterDraft(): LetterDraft {
  return { subject: 'Review request', body: 'Fictional patient. No real person.\n\nThe letter text.', origin: 'model', checkNotes: [], model: 'lantern-letter', at: '2026-11-18T00:01:00.000Z', seconds: 2 };
}

interface Rig {
  engine: Engine;
  store: StateStore;
  dir: string;
  calls: string[];
  clock: { now: Date };
  pipeline: PipelineFns;
  behaviour: {
    screen: (criterion: Criterion) => Awaited<ReturnType<PipelineFns['screenCriterion']>> | Promise<Awaited<ReturnType<PipelineFns['screenCriterion']>>>;
    check: (finding: ScreenResult, criterion: Criterion) => CheckResult | Promise<CheckResult>;
    letter: (finding: Finding) => LetterDraft | Promise<LetterDraft>;
    transcribe: (image: string) => Awaited<ReturnType<PipelineFns['transcribePageImage']>> | ReturnType<PipelineFns['transcribePageImage']>;
    criteria: () => Criterion[];
  };
}

function rig(options: {
  dir?: string;
  criteria?: Criterion[];
  cfg?: LanternConfig;
  activeIds?: string[];
  modelsUp?: () => Promise<boolean>;
  holdDelayMs?: number;
} = {}): Rig {
  const dir = options.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-engine-'));
  if (!options.dir) made.push(dir);
  const store = new StateStore(dir);
  store.load();
  const calls: string[] = [];
  const clock = { now: new Date('2026-11-18T01:00:00.000Z') };
  const behaviour: Rig['behaviour'] = {
    screen: criterion => criterion.id === 'ONE'
      ? { ok: true, suspected: true, result: screenResult(['L001', 'L002']) }
      : { ok: true, suspected: false, result: screenResult([]) },
    check: () => checkResult(true),
    letter: () => letterDraft(),
    transcribe: () => ({ ok: true, rows: ['2026-08-08 | Xarelto 20 mg tablet | qty 28', '2026-08-21 | Celebrex 200 mg capsule | qty 30'] }),
    criteria: () => options.criteria ?? [ONE, TWO]
  };
  const pipeline: PipelineFns = {
    screenCriterion: async (_cfg, _patient, _lines, criterion) => {
      calls.push(`screen ${criterion.id}`);
      return behaviour.screen(criterion);
    },
    checkFinding: async (_cfg, _patient, _lines, criterion, screen) => {
      calls.push(`check ${criterion.id}`);
      return behaviour.check(screen, criterion);
    },
    draftLetter: async (_cfg, _patient, _lines, criterion, finding) => {
      calls.push(`letter ${criterion.id}`);
      return behaviour.letter(finding);
    },
    transcribePageImage: async (_cfg, image) => {
      calls.push(`transcribe ${image}`);
      return behaviour.transcribe(image);
    }
  };
  const engine = new Engine({
    cfg: options.cfg ?? testConfig, store, pipeline,
    images: new PageImages(path.join(dir, 'images')),
    loadCriteria: async () => options.activeIds
      ? { criteria: behaviour.criteria(), activeIds: options.activeIds }
      : behaviour.criteria(),
    now: () => clock.now,
    saveRetryMs: 15,
    modelsUp: options.modelsUp ?? (async () => false),
    holdDelayMs: options.holdDelayMs ?? 60_000
  });
  return { engine, store, dir, calls, clock, behaviour, pipeline };
}

async function importCsv(r: Rig, fileName = 'positive.csv'): Promise<string> {
  const { caseId } = await r.engine.importCase({ fileName, source: 'csv', csvText: CSV });
  return caseId;
}

async function expectApiError(run: () => unknown, status: number, words?: string): Promise<void> {
  let caught: unknown;
  try {
    await run();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(ApiError);
  expect((caught as ApiError).status).toBe(status);
  if (words) expect((caught as ApiError).message).toContain(words);
}

// ---------- the queue ----------

describe('picking the next job', () => {
  const job = (id: string, stage: Job['stage'], status: Job['status'] = 'queued'): Job => ({ id, stage, caseId: 'C0001', status });

  it('takes the oldest queued job when no model is in memory', () => {
    expect(pickNextJob([job('J1', 'check', 'done'), job('J2', 'letter'), job('J3', 'screen')], null)?.id).toBe('J2');
    expect(pickNextJob([job('J1', 'check', 'done')], null)).toBeNull();
  });

  it('stays with the model that is in memory while it has work', () => {
    const jobs = [job('J1', 'check'), job('J2', 'letter'), job('J3', 'screen'), job('J4', 'check')];
    expect(pickNextJob(jobs, 'screen')?.id).toBe('J3');
    expect(pickNextJob(jobs, 'check')?.id).toBe('J1');
    expect(pickNextJob(jobs, 'letter')?.id).toBe('J2');
    expect(pickNextJob([job('J1', 'check'), job('J2', 'letter')], 'screen')?.id).toBe('J1');
  });

  it('runs a letter, a check and a screen of the ten before a screen of further criteria', () => {
    const further: Job = { id: 'J4', stage: 'screen', caseId: 'C0001', status: 'queued', band: 'further' };
    const jobs = [further, job('J1', 'letter'), job('J2', 'check'), job('J3', 'screen')];
    expect(pickNextJob(jobs, null)?.id).toBe('J1');
    expect(pickNextJob(jobs, 'check')?.id).toBe('J2');
    expect(pickNextJob(jobs, 'screen')?.id).toBe('J3');
    expect(pickNextJob([further], null)?.id).toBe('J4');
    expect(pickNextJob([further], 'screen')?.id).toBe('J4');
  });

  it('screens every waiting history with Model 1 before Model 2 checks anything', async () => {
    const r = rig();
    // Each screen call takes a moment, so the second history is imported while the first is being screened.
    r.behaviour.screen = async criterion => {
      await new Promise(resolve => setTimeout(resolve, 5));
      return criterion.id === 'ONE'
        ? { ok: true, suspected: true, result: screenResult(['L001', 'L002']) }
        : { ok: true, suspected: false, result: screenResult([]) };
    };
    await r.engine.start();
    await importCsv(r, 'first.csv');
    await importCsv(r, 'second.csv');
    await r.engine.whenIdle();
    expect(r.calls).toEqual(['screen ONE', 'screen TWO', 'screen ONE', 'screen TWO', 'check ONE', 'check ONE']);
  });

  it('never runs two model jobs at the same moment', async () => {
    const r = rig();
    let running = 0;
    let most = 0;
    const hold = async (): Promise<void> => {
      running++;
      most = Math.max(most, running);
      await new Promise(resolve => setTimeout(resolve, 20));
      running--;
    };
    r.behaviour.screen = async criterion => {
      await hold();
      return criterion.id === 'ONE'
        ? { ok: true, suspected: true, result: screenResult(['L001', 'L002']) }
        : { ok: true, suspected: false, result: screenResult([]) };
    };
    r.behaviour.check = async () => {
      await hold();
      return checkResult(true);
    };
    await r.engine.start();
    await importCsv(r);
    await importCsv(r, 'second.csv');
    await r.engine.whenIdle();
    expect(most).toBe(1);
    expect(r.calls.filter(call => call.startsWith('screen') || call.startsWith('check')).length).toBeGreaterThan(1);
  });
});

describe('the queue helpers', () => {
  function finding(id: string, caseId: string, state: Finding['state']): Finding {
    return {
      id, caseId, criterionId: 'ONE', state, possible: false,
      screen: screenResult(['L001']), seenByPharmacist: false
    };
  }

  function oneCase(statuses: Array<'clear' | 'suspected' | 'failed' | 'waiting'>): AppState['cases'][number] {
    return {
      id: 'C0001', fileName: 'positive.csv', importedAt: '2026-11-18T00:00:00.000Z', source: 'csv',
      patient: { label: 'Fictional patient F-001' },
      lines: [{ id: 'L001', text: '2026-08-08 | Xarelto 20 mg tablet' }],
      transcriptionConfirmed: true, parts: 1,
      screening: {
        status: 'done',
        criteria: statuses.map((status, i) => ({ criterionId: `N${i}`, status }))
      }
    };
  }

  it('a failed criterion is the only mark that a finished screening did not complete', () => {
    expect(hasFailedCriteria(oneCase(['clear', 'suspected', 'waiting']))).toBe(false);
    expect(hasFailedCriteria(oneCase([]))).toBe(false);
    expect(hasFailedCriteria(oneCase(['clear', 'failed']))).toBe(true);
  });

  it('an open job is queued or running, for that stage, that case and that finding', () => {
    const state = emptyState();
    const job = addJob(state, 'check', 'C0001', 'F0001');
    expect(job).toMatchObject({ stage: 'check', caseId: 'C0001', findingId: 'F0001', status: 'queued' });
    expect(hasOpenJob(state, 'check', 'C0001', 'F0001')).toBe(true);
    expect(hasOpenJob(state, 'check', 'C0001')).toBe(false);
    expect(hasOpenJob(state, 'screen', 'C0001', 'F0001')).toBe(false);
    expect(hasOpenJob(state, 'check', 'C0002', 'F0001')).toBe(false);
    expect(hasOpenJob(state, 'check', 'C0001', 'F0002')).toBe(false);
    job.status = 'running';
    expect(hasOpenJob(state, 'check', 'C0001', 'F0001')).toBe(true);
    job.status = 'done';
    expect(hasOpenJob(state, 'check', 'C0001', 'F0001')).toBe(false);
    job.status = 'failed';
    expect(hasOpenJob(state, 'check', 'C0001', 'F0001')).toBe(false);
    const screen = addJob(state, 'screen', 'C0001');
    expect(screen.findingId).toBeUndefined();
    expect(hasOpenJob(state, 'screen', 'C0001')).toBe(true);
    expect(hasOpenJob(state, 'screen', 'C0001', 'F0001')).toBe(false);
  });

  it('queues one second check for each suspected finding of that case, and not twice', () => {
    const state = emptyState();
    state.findings.push(
      finding('F0001', 'C0001', 'suspected'),
      finding('F0002', 'C0001', 'confirmed'),
      finding('F0003', 'C0001', 'not_confirmed'),
      finding('F0004', 'C0001', 'accepted'),
      finding('F0005', 'C0001', 'bypassed'),
      finding('F0006', 'C0002', 'suspected'),
      finding('F0007', 'C0001', 'suspected')
    );
    expect(queueChecks(state, 'C0001')).toBe(2);
    expect(state.jobs.map(j => [j.stage, j.caseId, j.findingId, j.status])).toEqual([
      ['check', 'C0001', 'F0001', 'queued'],
      ['check', 'C0001', 'F0007', 'queued']
    ]);
    expect(queueChecks(state, 'C0001')).toBe(0);
    state.jobs[0].status = 'running';
    expect(queueChecks(state, 'C0001')).toBe(0);
    state.jobs[0].status = 'done';
    expect(queueChecks(state, 'C0001')).toBe(1);
    expect(state.jobs.filter(j => j.findingId === 'F0001' && j.status === 'queued')).toHaveLength(1);
    state.jobs.find(j => j.findingId === 'F0001' && j.status === 'queued')!.status = 'failed';
    expect(queueChecks(state, 'C0001')).toBe(1);
    expect(queueChecks(state, 'C0009')).toBe(0);
  });

  it('does not drop a job that is still queued or running when it shortens the finished list', () => {
    const state = emptyState();
    const running = addJob(state, 'screen', 'C0001');
    running.status = 'running';
    for (let i = 0; i < 320; i++) addJob(state, 'letter', 'C0001').status = 'done';
    const queued = addJob(state, 'check', 'C0002', 'F0001');
    expect(state.jobs.filter(j => j.status === 'done')).toHaveLength(300);
    expect(state.jobs.some(j => j.id === running.id && j.status === 'running')).toBe(true);
    expect(state.jobs.some(j => j.id === queued.id && j.status === 'queued' && j.findingId === 'F0001')).toBe(true);
    expect(state.jobs.filter(j => j.status === 'done').every(j => j.stage === 'letter')).toBe(true);
  });

  it('ignores a job that is not queued, and a further screen does not jump a letter', () => {
    const running: Job = { id: 'J1', stage: 'screen', caseId: 'C0001', status: 'running' };
    const letter: Job = { id: 'J2', stage: 'letter', caseId: 'C0001', status: 'queued' };
    const further: Job = { id: 'J3', stage: 'screen', caseId: 'C0001', status: 'queued', band: 'further' };
    expect(pickNextJob([running, letter, further], 'screen')?.id).toBe('J2');
    expect(pickNextJob([running], null)).toBeNull();
    expect(pickNextJob([further, { ...letter, status: 'done' }], 'letter')?.id).toBe('J3');
  });
});

// ---------- restart ----------

describe('after a restart', () => {
  function interruptedState(): AppState {
    const state = emptyState();
    state.cases.push({
      id: 'C0001', fileName: 'positive.csv', importedAt: '2026-11-18T00:00:00.000Z', source: 'csv',
      patient: { label: 'Fictional patient F-001' },
      lines: [{ id: 'L001', text: '2026-08-08 | Xarelto 20 mg tablet' }, { id: 'L002', text: '2026-08-21 | Celebrex 200 mg capsule' }],
      transcriptionConfirmed: true, parts: 1,
      screening: {
        status: 'running', startedAt: '2026-11-18T00:00:01.000Z',
        criteria: [
          { criterionId: 'ONE', status: 'suspected', seconds: 5 },
          { criterionId: 'TWO', status: 'running' },
          { criterionId: 'THREE', status: 'waiting' }
        ]
      }
    });
    state.findings.push({ id: 'F0001', caseId: 'C0001', criterionId: 'ONE', state: 'suspected', possible: false, screen: screenResult(['L001', 'L002']), seenByPharmacist: false });
    state.jobs.push({ id: 'J0001', stage: 'screen', caseId: 'C0001', status: 'running', detail: 'criterion 2 of 3' });
    return state;
  }

  it('a job left running becomes interrupted and a new screening job is queued', () => {
    const state = interruptedState();
    recoverAfterRestart(state, '2026-11-18T02:00:00.000Z');
    expect(state.jobs[0]).toMatchObject({ id: 'J0001', status: 'failed', detail: 'Interrupted. The server stopped while this was running.' });
    expect(state.jobs[1]).toMatchObject({ id: 'J0002', stage: 'screen', caseId: 'C0001', status: 'queued' });
    expect(state.jobs).toHaveLength(2);
    expect(state.cases[0].screening.status).toBe('interrupted');
    expect(state.cases[0].screening.criteria.map(c => c.status)).toEqual(['suspected', 'waiting', 'waiting']);
    expect(state.findings).toHaveLength(1);                       // the finished criterion keeps its finding
    expect(state.activity[0]).toMatchObject({
      kind: 'error', caseId: 'C0001',
      text: 'The server stopped while Mantle was screening positive.csv. Screening picks up at criterion 2 of 3.'
    });
  });

  it('keeps a disputed finding, both of its views, and a preview across a restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-engine-'));
    made.push(dir);
    const before = new StateStore(dir);
    const state = emptyState();
    state.cases.push({
      id: 'C0001', fileName: 'positive.csv', importedAt: '2026-11-18T00:00:00.000Z', source: 'csv',
      patient: { label: 'Fictional patient F-001' },
      lines: [{ id: 'L001', text: '2026-08-08 | Xarelto 20 mg tablet | Dr A. Example' }],
      transcriptionConfirmed: true, parts: 1,
      screening: { status: 'done', criteria: [{ criterionId: 'ONE', status: 'suspected' }] }
    });
    state.findings.push({
      id: 'F0001', caseId: 'C0001', criterionId: 'ONE', state: 'not_confirmed', possible: false,
      screen: { ...screenResult(['L001']), reason: 'Mantle suspected the pair.' },
      check: { ...checkResult(false), lineIds: ['L001'], whatMatches: 'Lumen turned it back.' },
      seenByPharmacist: false
    });
    state.letters.push({
      id: 'T0001', findingId: 'F0009', caseId: 'C0001', status: 'ready',
      subject: 'Review', body: 'Fictional patient. No real person.\n\nThe letter.',
      editedByPharmacist: false, seenByPharmacist: false,
      previewedAt: '2026-11-18T03:00:00.000Z', previewHash: 'abc123',
      closingLine: 'Drafted by a local AI model. Read by the pharmacist before sending.',
      signatureName: 'Marwan Morsy', signatureTitle: 'Pharmacy Manager', signatureRegistration: 'PHA0002761764'
    });
    before.state = state;
    before.save();
    const r = rig({ dir, criteria: [ONE] });
    await r.engine.start();
    const f = r.engine.state.findings[0];
    expect(f.state).toBe('not_confirmed');
    expect(f.screen.lineIds).toEqual(['L001']);
    expect(f.screen.reason).toBe('Mantle suspected the pair.');
    expect(f.check?.whatMatches).toBe('Lumen turned it back.');
    expect(f.check?.lineIds).toEqual(['L001']);
    expect(r.engine.state.letters[0]).toMatchObject({
      previewedAt: '2026-11-18T03:00:00.000Z', previewHash: 'abc123', signatureName: 'Marwan Morsy'
    });
    expect(r.engine.stateResponse().disputedWaiting).toBe(1);
  });

  it('doing it twice changes nothing more', () => {
    const state = interruptedState();
    recoverAfterRestart(state, '2026-11-18T02:00:00.000Z');
    const once = JSON.stringify(state);
    recoverAfterRestart(state, '2026-11-18T02:00:00.000Z');
    expect(JSON.stringify(state)).toBe(once);
  });

  it('screening resumes from the first criterion not finished, then the checks run', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-engine-'));
    made.push(dir);
    const before = new StateStore(dir);
    before.state = interruptedState();
    before.save();

    const r = rig({ dir, criteria: [ONE, TWO, THREE] });
    r.behaviour.screen = criterion => criterion.id === 'THREE'
      ? { ok: true, suspected: true, result: screenResult(['L002']) }
      : { ok: true, suspected: false, result: screenResult([]) };
    await r.engine.start();
    await r.engine.whenIdle();

    expect(r.calls).toEqual(['screen TWO', 'screen THREE', 'check ONE', 'check THREE']);   // ONE is not screened again
    const c = r.engine.state.cases[0];
    expect(c.screening.status).toBe('done');
    expect(c.screening.criteria.map(x => x.status)).toEqual(['suspected', 'clear', 'suspected']);
    expect(c.screening.startedAt).toBe('2026-11-18T00:00:01.000Z');
    expect(r.engine.state.findings.map(f => [f.id, f.criterionId, f.state])).toEqual([['F0001', 'ONE', 'confirmed'], ['F0002', 'THREE', 'confirmed']]);
    // What is on disk is what is in memory.
    const reread = new StateStore(dir);
    reread.load();
    expect(reread.state).toEqual(r.engine.state);
  });

  it('a check or a letter that was running starts again', () => {
    const state = interruptedState();
    state.cases[0].screening.status = 'done';
    state.cases[0].screening.criteria.forEach(c => { if (c.status !== 'suspected') c.status = 'clear'; });
    state.jobs = [
      { id: 'J0001', stage: 'screen', caseId: 'C0001', status: 'done' },
      { id: 'J0002', stage: 'check', caseId: 'C0001', findingId: 'F0001', status: 'running' }
    ];
    recoverAfterRestart(state, '2026-11-18T02:00:00.000Z');
    expect(state.jobs.map(j => [j.id, j.stage, j.status])).toEqual([
      ['J0001', 'screen', 'done'], ['J0002', 'check', 'failed'], ['J0003', 'check', 'queued']
    ]);
    expect(state.jobs[2].findingId).toBe('F0001');

    const withLetter = emptyState();
    withLetter.letters.push({ id: 'T0001', findingId: 'F0001', caseId: 'C0001', status: 'drafting', subject: '', body: '', editedByPharmacist: false, seenByPharmacist: false });
    withLetter.jobs.push({ id: 'J0005', stage: 'letter', caseId: 'C0001', findingId: 'F0001', status: 'running' });
    recoverAfterRestart(withLetter, '2026-11-18T02:00:00.000Z');
    expect(withLetter.jobs.map(j => [j.id, j.stage, j.status])).toEqual([['J0005', 'letter', 'failed'], ['J0006', 'letter', 'queued']]);
  });

  it('work that lost its job gets one again, and finished work is left alone', () => {
    const state = interruptedState();
    state.jobs = [];
    state.cases[0].screening.status = 'done';
    state.cases[0].screening.criteria.forEach(c => { if (c.status !== 'suspected') c.status = 'clear'; });
    recoverAfterRestart(state, '2026-11-18T02:00:00.000Z');
    expect(state.jobs.map(j => [j.stage, j.findingId, j.status])).toEqual([['check', 'F0001', 'queued']]);
    expect(state.activity).toEqual([]);

    const waiting = interruptedState();
    waiting.jobs = [];
    waiting.cases[0].screening.status = 'waiting';
    waiting.cases[0].cannotAssess = 'No row has a date that can be read.';
    recoverAfterRestart(waiting, '2026-11-18T02:00:00.000Z');
    expect(waiting.jobs).toEqual([]);                             // a history that cannot be assessed is never screened
  });

  it('keeps the list of finished jobs short', () => {
    const state = emptyState();
    for (let i = 0; i < 320; i++) addJob(state, 'screen', 'C0001').status = 'done';
    addJob(state, 'check', 'C0001', 'F0001');
    expect(state.jobs.length).toBeLessThanOrEqual(302);
    expect(state.jobs[state.jobs.length - 1]).toMatchObject({ id: 'J0321', stage: 'check', status: 'queued' });
  });

  it('a stop in the middle of ten criteria resumes on a new engine and loses nothing', async () => {
    const ten: Criterion[] = Array.from({ length: 10 }, (_, i) => ({
      ...testCriterion, id: `N${String(i + 1).padStart(2, '0')}`, label: `Criterion ${i + 1}`
    }));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-engine-'));
    made.push(dir);
    const state = emptyState();
    state.cases.push({
      id: 'C0001', fileName: 'positive.csv', importedAt: '2026-11-18T00:00:00.000Z', source: 'csv',
      patient: { label: 'Fictional patient F-001' },
      lines: [{ id: 'L001', text: '2026-08-08 | Xarelto 20 mg tablet' }, { id: 'L002', text: '2026-08-21 | Celebrex 200 mg capsule' }],
      transcriptionConfirmed: true, parts: 1,
      screening: {
        status: 'running', startedAt: '2026-11-18T00:00:01.000Z',
        criteria: ten.map((criterion, i) => ({
          criterionId: criterion.id,
          status: i === 0 ? 'suspected' : i < 3 ? 'clear' : i === 3 ? 'running' : 'waiting'
        }))
      }
    });
    state.findings.push({
      id: 'F0001', caseId: 'C0001', criterionId: 'N01', state: 'suspected', possible: false,
      screen: screenResult(['L001', 'L002']), seenByPharmacist: false
    });
    state.jobs.push({ id: 'J0001', stage: 'screen', caseId: 'C0001', status: 'running', detail: 'criterion 4 of 10' });
    const before = new StateStore(dir);
    before.state = state;
    before.save();

    const r = rig({ dir, criteria: ten });
    r.behaviour.screen = criterion => criterion.id === 'N05'
      ? { ok: true, suspected: true, result: screenResult(['L002']) }
      : { ok: true, suspected: false, result: screenResult([]) };
    await r.engine.start();
    await r.engine.whenIdle();

    expect(r.calls.filter(call => call.startsWith('screen'))).toEqual(
      ['N04', 'N05', 'N06', 'N07', 'N08', 'N09', 'N10'].map(id => `screen ${id}`)
    );
    const c = r.engine.state.cases[0];
    expect(c.screening.status).toBe('done');
    expect(c.screening.criteria.map(run => run.status)).toEqual([
      'suspected', 'clear', 'clear', 'clear', 'suspected', 'clear', 'clear', 'clear', 'clear', 'clear'
    ]);
    expect(r.engine.state.findings.map(f => [f.id, f.criterionId, f.state])).toEqual([
      ['F0001', 'N01', 'confirmed'], ['F0002', 'N05', 'confirmed']
    ]);
    expect(r.engine.state.activity.some(a => a.text.includes('Screening picks up at criterion 4 of 10.'))).toBe(true);
  });

  it('a stop during a second check runs that check once on a new engine', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-engine-'));
    made.push(dir);
    const state = interruptedState();
    state.cases[0].screening.status = 'done';
    state.cases[0].screening.criteria = [
      { criterionId: 'ONE', status: 'suspected' },
      { criterionId: 'TWO', status: 'clear' }
    ];
    state.jobs = [
      { id: 'J0001', stage: 'screen', caseId: 'C0001', status: 'done' },
      { id: 'J0002', stage: 'check', caseId: 'C0001', findingId: 'F0001', status: 'running' }
    ];
    const before = new StateStore(dir);
    before.state = state;
    before.save();

    const r = rig({ dir });
    await r.engine.start();
    await r.engine.whenIdle();
    expect(r.calls).toEqual(['check ONE']);
    expect(r.engine.state.findings).toHaveLength(1);
    expect(r.engine.state.findings[0]).toMatchObject({ id: 'F0001', state: 'confirmed' });
    expect(r.engine.state.activity.some(a => a.text === 'The server stopped during a second check. The check starts again.')).toBe(true);
  });

  it('a stop during a letter drafts that letter once on a new engine', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-engine-'));
    made.push(dir);
    const state = emptyState();
    state.cases.push({
      id: 'C0001', fileName: 'positive.csv', importedAt: '2026-11-18T00:00:00.000Z', source: 'csv',
      patient: { label: 'Fictional patient F-001' },
      lines: [{ id: 'L001', text: '2026-08-08 | Xarelto 20 mg tablet' }, { id: 'L002', text: '2026-08-21 | Celebrex 200 mg capsule' }],
      transcriptionConfirmed: true, parts: 1,
      screening: { status: 'done', criteria: [{ criterionId: 'ONE', status: 'suspected' }] }
    });
    state.findings.push({
      id: 'F0001', caseId: 'C0001', criterionId: 'ONE', state: 'accepted', possible: false,
      screen: screenResult(['L001', 'L002']), seenByPharmacist: true,
      decision: { action: 'accept', by: 'Marwan Morsy', at: '2026-11-18T00:05:00.000Z' }
    });
    state.letters.push({
      id: 'T0001', findingId: 'F0001', caseId: 'C0001', status: 'drafting',
      subject: '', body: '', editedByPharmacist: false, seenByPharmacist: false
    });
    state.jobs.push({ id: 'J0001', stage: 'letter', caseId: 'C0001', findingId: 'F0001', status: 'running' });
    const before = new StateStore(dir);
    before.state = state;
    before.save();

    const r = rig({ dir, criteria: [ONE] });
    await r.engine.start();
    await r.engine.whenIdle();
    expect(r.calls).toEqual(['letter ONE']);
    expect(r.engine.state.letters).toHaveLength(1);
    expect(r.engine.state.letters[0]).toMatchObject({ id: 'T0001', status: 'ready', subject: 'Review request' });
    expect(r.engine.state.activity.some(a => a.text === 'The server stopped while a letter was being written. The letter is drafted again.')).toBe(true);
  });

  it('a stop while a scan is being read starts the reading again and does not screen it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-engine-'));
    made.push(dir);
    new PageImages(path.join(dir, 'images')).save('C0001', ['PAGEONE', 'PAGETWO']);
    const state = emptyState();
    state.cases.push({
      id: 'C0001', fileName: 'scan.pdf', importedAt: '2026-11-18T00:00:00.000Z', source: 'pdf-image',
      patient: { label: 'Fictional patient F-001' },
      lines: [], transcriptionConfirmed: false, pages: 2, parts: 1,
      screening: { status: 'not_started', criteria: [] }
    });
    state.jobs.push({ id: 'J0001', stage: 'screen', caseId: 'C0001', status: 'running', detail: 'page 1 of 2' });
    const before = new StateStore(dir);
    before.state = state;
    before.save();

    const r = rig({ dir });
    r.behaviour.transcribe = image => ({
      ok: true,
      rows: [image === 'PAGEONE'
        ? '2026-08-08 | Xarelto 20 mg tablet | qty 28'
        : '2026-08-21 | Celebrex 200 mg capsule | qty 30']
    });
    await r.engine.start();
    await r.engine.whenIdle();
    expect(r.calls).toEqual(['transcribe PAGEONE', 'transcribe PAGETWO']);
    const c = r.engine.state.cases[0];
    expect(c.lines.map(l => l.id)).toEqual(['L001', 'L002']);
    expect(c.transcriptionConfirmed).toBe(false);
    expect(c.screening.status).toBe('not_started');
    expect(r.engine.state.findings).toEqual([]);
    expect(r.engine.state.activity.some(a =>
      a.text === 'The server stopped while Mantle was reading the scan of scan.pdf. The reading starts again.')).toBe(true);
  });

  it('a possible finding and its missing facts survive a restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-engine-'));
    made.push(dir);
    const state = emptyState();
    state.cases.push({
      id: 'C0001', fileName: 'pos-nofact.csv', importedAt: '2026-11-18T00:00:00.000Z', source: 'csv',
      patient: { label: 'Fictional patient F-001' },
      lines: [{ id: 'L001', text: '2026-08-08 | Lanoxin 62.5 microgram tablet | qty 200' }],
      transcriptionConfirmed: true, parts: 1,
      screening: { status: 'done', criteria: [{ criterionId: 'ONE', status: 'suspected' }] }
    });
    state.findings.push({
      id: 'F0001', caseId: 'C0001', criterionId: 'ONE', state: 'suspected', possible: true,
      screen: { ...screenResult(['L001']), missingFacts: ['eGFR'], linesVerified: true },
      seenByPharmacist: false
    });
    state.jobs.push({ id: 'J0001', stage: 'check', caseId: 'C0001', findingId: 'F0001', status: 'running' });
    const before = new StateStore(dir);
    before.state = state;
    before.save();

    const r = rig({ dir, criteria: [ONE] });
    await r.engine.start();
    await r.engine.whenIdle();
    expect(r.engine.state.findings).toHaveLength(1);
    expect(r.engine.state.findings[0]).toMatchObject({
      id: 'F0001', possible: true, state: 'confirmed', screen: { missingFacts: ['eGFR'] }
    });
    const reread = new StateStore(dir);
    reread.load();
    expect(reread.state.findings[0]).toMatchObject({ possible: true, screen: { missingFacts: ['eGFR'] } });
  });
});

// ---------- the whole path ----------

describe('one history from import to a closed letter', () => {
  it('walks every step and keeps the counts right', async () => {
    const r = rig();
    await r.engine.start();
    expect(r.engine.stateResponse().now).toEqual({ stage: null, text: 'Idle' });

    const caseId = await importCsv(r);
    expect(caseId).toBe('C0001');
    await r.engine.whenIdle();

    let s = r.engine.stateResponse();
    expect(s.recorded).toBe(false);
    expect(s.state.cases[0]).toMatchObject({
      id: 'C0001', fileName: 'positive.csv', source: 'csv', transcriptionConfirmed: true, parts: 1,
      patient: { label: 'Fictional patient F-001', age: 72, sex: 'F' }
    });
    expect(s.state.cases[0].lines.map(l => l.id)).toEqual(['L001', 'L002']);
    expect(s.state.cases[0].screening.status).toBe('done');
    expect(s.state.cases[0].screening.criteria.map(c => [c.criterionId, c.status])).toEqual([['ONE', 'suspected'], ['TWO', 'clear']]);
    expect(s.state.findings).toHaveLength(1);
    expect(s.state.findings[0]).toMatchObject({ id: 'F0001', caseId: 'C0001', criterionId: 'ONE', state: 'confirmed', seenByPharmacist: false });
    expect(s.counts).toMatchObject({ historiesScreened: 1, findingsConfirmed: 1, accepted: 0, bypassed: 0, bellBadge: 1, letterBadge: 0 });
    expect(s.now.text).toBe('Idle');

    r.engine.markFindingSeen('F0001');
    expect(r.engine.stateResponse().counts.bellBadge).toBe(0);

    r.engine.decide('F0001', { action: 'accept' });
    expect(r.engine.state.findings[0]).toMatchObject({ state: 'accepted', decision: { action: 'accept', by: 'Marwan Morsy' } });
    expect(r.engine.state.letters[0]).toMatchObject({ id: 'T0001', findingId: 'F0001', status: 'drafting' });
    await r.engine.whenIdle();

    s = r.engine.stateResponse();
    expect(s.state.letters[0]).toMatchObject({ status: 'ready', subject: 'Review request', editedByPharmacist: false, seenByPharmacist: false });
    expect(s.state.letters[0].draft).toMatchObject({ origin: 'model', checkNotes: [] });
    expect(s.counts).toMatchObject({ accepted: 1, lettersReady: 1, letterBadge: 1, lettersSent: 0 });
    expect(r.calls).toEqual(['screen ONE', 'screen TWO', 'check ONE', 'letter ONE']);

    r.engine.markLetterSeen('T0001');
    expect(r.engine.stateResponse().counts.letterBadge).toBe(0);

    r.engine.editLetter('T0001', { subject: 'Review request, edited', body: 'Fictional patient. No real person.\r\n\r\nEdited text.', expectedRevision: 0 });
    expect(r.engine.state.letters[0].subject).toBe('Review request, edited');
    expect(r.engine.state.letters[0].body.startsWith('Fictional patient. No real person.\n\nEdited text.')).toBe(true);
    expect(r.engine.state.letters[0].body.endsWith('Marwan Morsy\nPharmacy Manager\nPHA0002761764')).toBe(true);
    expect(r.engine.state.letters[0].editedByPharmacist).toBe(true);
    expect(r.engine.state.letters[0].draft?.body).toContain('The letter text.');     // the first draft is kept

    r.engine.agree('T0001', {});
    expect(r.engine.state.letters[0].patientAgreed).toEqual({ at: '2026-11-18T01:00:00.000Z' });

    const sentPreview = r.engine.previewLetter('T0001');
    r.engine.markSent('T0001', { by: 'print', previewToken: sentPreview.previewToken });
    expect(r.engine.state.letters[0]).toMatchObject({ status: 'sent', sentBy: 'print', sentAt: '2026-11-18T01:00:00.000Z', dueAt: '2026-11-25T01:00:00.000Z' });
    expect(r.engine.stateResponse().counts).toMatchObject({ lettersReady: 0, lettersSent: 1, overdue: 0 });

    r.clock.now = new Date('2026-11-26T01:00:00.000Z');          // eight days later, no reply
    expect(r.engine.stateResponse().counts.overdue).toBe(1);

    r.engine.recordReply('T0001', { outcome: 'will_review', note: ' The doctor will see the patient next week. ' });
    expect(r.engine.state.letters[0]).toMatchObject({ status: 'reply_recorded', reply: { outcome: 'will_review', note: 'The doctor will see the patient next week.' } });
    expect(r.engine.stateResponse().counts).toMatchObject({ repliesRecorded: 1, overdue: 0, closed: 0 });

    r.engine.closeLetter('T0001');
    expect(r.engine.state.letters[0]).toMatchObject({ status: 'closed', closedAt: '2026-11-26T01:00:00.000Z' });
    expect(r.engine.stateResponse().counts).toMatchObject({
      historiesScreened: 1, findingsConfirmed: 1, accepted: 1, bypassed: 0, lettersReady: 0,
      lettersSent: 1, repliesRecorded: 1, closed: 1, overdue: 0, bellBadge: 0, letterBadge: 0
    });

    // Every step is in the activity log, and the saved file matches.
    const kinds = r.engine.state.activity.map(a => a.kind);
    for (const kind of ['import', 'screen', 'check', 'decision', 'letter', 'letter_status']) expect(kinds).toContain(kind);
    const reread = new StateStore(r.dir);
    reread.load();
    expect(reread.state).toEqual(r.engine.state);
    expect(r.engine.state.jobs.every(j => j.status === 'done')).toBe(true);
  });

  it('does not keep a date of birth the pharmacist types into the subject or the letter', async () => {
    const r = rig();
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    r.engine.decide('F0001', { action: 'accept' });
    await r.engine.whenIdle();
    r.engine.state.cases[0].patient.dateOfBirth = '1954-03-15';
    r.engine.editLetter('T0001', {
      subject: 'Review, DOB: 15/03/1954',
      body: [
        'Fictional patient. No real person.',
        '',
        'Please review.',
        'Born 15 March 1954.',
        'Seen 15/03/1954.',
        '1954-03-15 | Warfarin 5 mg',
        '2026-08-21 | Atorvastatin 20 mg'
      ].join('\n'),
      expectedRevision: 0
    });
    const saved = r.engine.state.letters[0];
    expect(saved.subject).toBe('Review');
    expect(saved.body).toContain('Please review.');
    expect(saved.body).toContain('1954-03-15 | Warfarin 5 mg');
    expect(saved.body).toContain('2026-08-21 | Atorvastatin 20 mg');
    expect(saved.body).not.toMatch(/DOB|Born|15\/03\/1954|15 March 1954/);
    expect(saved.body).toContain('Marwan Morsy');
  });

  it('says in plain words what is running', async () => {
    const r = rig({ criteria: [ONE, TWO, THREE] });
    const seen: string[] = [];
    r.behaviour.screen = criterion => {
      seen.push(r.engine.stateResponse().now.text);
      return criterion.id === 'TWO'
        ? { ok: true, suspected: true, result: screenResult(['L002']) }
        : { ok: true, suspected: false, result: screenResult([]) };
    };
    r.behaviour.check = () => {
      seen.push(r.engine.stateResponse().now.text);
      return checkResult(true);
    };
    r.behaviour.letter = () => {
      seen.push(r.engine.stateResponse().now.text);
      return letterDraft();
    };
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    r.engine.decide('F0001', { action: 'accept' });
    await r.engine.whenIdle();
    expect(seen).toEqual([
      `Mantle is screening: criterion 1 of 3. ${PASS_NOT_FINISHED}`,
      `Mantle is screening: criterion 2 of 3. ${PASS_NOT_FINISHED}`,
      `Mantle is screening: criterion 3 of 3. ${PASS_NOT_FINISHED}`,
      'Lumen is double-checking 1 finding',
      'Ogee is writing 1 letter'
    ]);
    expect(r.engine.stateResponse().now).toEqual({ stage: null, text: 'Idle' });
  });
});

// ---------- failures are never "no finding" ----------

describe('when a model call fails', () => {
  it('a criterion that could not be screened is marked failed, with the reason', async () => {
    const r = rig();
    r.behaviour.screen = criterion => criterion.id === 'ONE'
      ? { ok: false, error: 'Tried twice. The model took too long to answer.' }
      : { ok: true, suspected: false, result: screenResult([]) };
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    const runs = r.engine.state.cases[0].screening.criteria;
    expect(runs[0]).toMatchObject({ criterionId: 'ONE', status: 'failed', error: 'Could not be screened. Tried twice. The model took too long to answer.' });
    expect(runs[1].status).toBe('clear');
    expect(r.engine.state.findings).toEqual([]);
    expect(r.engine.state.activity.some(a => a.kind === 'error' && a.text.includes('This is not a clear result.'))).toBe(true);
  });

  it('a pipeline function that throws is treated the same way', async () => {
    const r = rig();
    r.behaviour.screen = () => { throw new Error('boom'); };
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    expect(r.engine.state.cases[0].screening.criteria.map(c => c.status)).toEqual(['failed', 'failed']);
    expect(r.engine.state.cases[0].screening.status).toBe('done');
  });

  it('a second check that did not complete still sends the finding to the bell', async () => {
    const r = rig();
    r.behaviour.check = () => checkResult(false, false);
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    const f = r.engine.state.findings[0];
    expect(f.state).toBe('confirmed');
    expect(f.check).toMatchObject({ confirmed: false, completed: false });
    // It waits under the bell, but Model 2 confirmed nothing, so it is not counted as confirmed.
    expect(r.engine.stateResponse().counts).toMatchObject({ findingsConfirmed: 0, bellBadge: 1 });
    expect(r.engine.state.activity.some(a => a.text.includes('second check not completed'))).toBe(true);
  });

  it('a finding the second check turns down stays visible as not confirmed, and can still be decided', async () => {
    const r = rig();
    r.behaviour.check = () => checkResult(false);
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    expect(r.engine.state.findings[0].state).toBe('not_confirmed');
    expect(r.engine.stateResponse().counts).toMatchObject({ findingsConfirmed: 0, bellBadge: 0 });
    r.engine.decide('F0001', { action: 'bypass', reason: 'Seen. Agree with the second check.' });
    expect(r.engine.state.findings[0].state).toBe('bypassed');
  });

  it('a history that cannot be read is never screened', async () => {
    const r = rig();
    await r.engine.start();
    const { caseId } = await r.engine.importCase({ fileName: 'bad.csv', source: 'csv', csvText: 'dispense_date,brand\nsoon,Celebrex\n' });
    await r.engine.whenIdle();
    const c = r.engine.state.cases.find(x => x.id === caseId)!;
    expect(c.cannotAssess).toBe('No row has a date that can be read.');
    expect(c.screening.status).toBe('not_started');
    expect(r.calls).toEqual([]);
    expect(r.engine.state.jobs).toEqual([]);
    expect(r.engine.stateResponse().counts.historiesScreened).toBe(0);
  });

  it('an import is refused when the criteria cannot be loaded', async () => {
    const r = rig();
    r.behaviour.criteria = () => { throw new Error('Criterion ONE could not be read.'); };
    await r.engine.start();
    await expectApiError(() => importCsv(r), 503, 'Criterion ONE could not be read.');
    expect(r.engine.state.cases).toEqual([]);
  });
});

const SERVER_DOWN = 'Tried twice. The local model server did not answer.';

async function until(pred: () => boolean): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > 4000) throw new Error('timed out waiting for the queue');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

/** A probe the test opens. release() sticks, so it still counts if the worker asks a moment later. */
function holdGate(): { modelsUp: () => Promise<boolean>; release: (up: boolean) => void } {
  let settled: boolean | null = null;
  const waiters: Array<(up: boolean) => void> = [];
  return {
    modelsUp: () => {
      if (settled !== null) return Promise.resolve(settled);
      return new Promise<boolean>(resolve => { waiters.push(resolve); });
    },
    release(up: boolean) {
      settled = up;
      for (const resolve of waiters.splice(0)) resolve(up);
    }
  };
}

describe('a job is held while the model server is down', () => {
  it('the status line warns, and the history is not counted as screened', () => {
    const state = emptyState();
    state.jobs.push({ id: 'J0001', stage: 'screen', caseId: 'C0001', status: 'queued', detail: HELD_FOR_MODELS });
    expect(computeNow(state, {}, testConfig.modelNames)).toEqual({
      stage: 'screen',
      text: 'The local models are not running. This step starts again when they answer.'
    });
  });

  it('holds the screening and runs it when the server answers', async () => {
    const gate = holdGate();
    const r = rig({ modelsUp: gate.modelsUp });
    let down = true;
    r.behaviour.screen = () => down
      ? { ok: false, error: SERVER_DOWN }
      : { ok: true, suspected: false, result: screenResult([]) };
    await r.engine.start();
    await importCsv(r);
    await until(() => r.engine.state.jobs.some(j => j.detail === HELD_FOR_MODELS));
    const snap = r.engine.state;
    expect(snap.jobs.filter(j => j.stage === 'screen').map(j => j.status)).toEqual(['queued']);
    expect(snap.jobs.some(j => j.status === 'failed')).toBe(false);
    expect(snap.cases[0].screening.status).not.toBe('done');
    expect(snap.cases[0].screening.criteria.every(run => run.status === 'waiting')).toBe(true);
    expect(snap.findings).toEqual([]);
    expect(computeCounts(snap, r.clock.now).historiesScreened).toBe(0);
    expect(computeNow(snap, {}, testConfig.modelNames).text).toBe('The local models are not running. This step starts again when they answer.');
    expect(snap.activity.some(a => a.kind === 'error' && a.text.includes('not running') && a.text.includes('not a clear result'))).toBe(true);
    expect(snap.activity.some(a => a.text.includes('nothing suspected'))).toBe(false);
    await expectApiError(() => r.engine.screenAgain('C0001'), 409, 'already being screened');

    down = false;
    gate.release(true);
    await r.engine.whenIdle();
    expect(r.calls.filter(call => call.startsWith('screen'))).toEqual(['screen ONE', 'screen ONE', 'screen TWO']);
    expect(r.engine.state.cases[0].screening.criteria.map(run => run.status)).toEqual(['clear', 'clear']);
    expect(r.engine.state.cases[0].screening.status).toBe('done');
    expect(r.engine.stateResponse().counts.historiesScreened).toBe(1);
    expect(r.engine.state.activity.some(a => a.text.includes('The local models are answering again.'))).toBe(true);
  });

  it('holds a second check, and the finding is not shown as turned back', async () => {
    const gate = holdGate();
    const r = rig({ modelsUp: gate.modelsUp });
    let down = true;
    r.behaviour.check = () => down
      ? {
        ...checkResult(false, false),
        whatMatches: 'The second check did not finish, so this finding is shown without it. Tried twice. The local model server did not answer.'
      }
      : checkResult(true);
    await r.engine.start();
    await importCsv(r);
    await until(() => r.engine.state.jobs.some(j => j.stage === 'check' && j.detail === HELD_FOR_MODELS));
    const finding = r.engine.state.findings[0];
    expect(finding.state).toBe('suspected');
    expect(finding.check).toBeUndefined();
    expect(r.engine.stateResponse().counts.bellBadge).toBe(0);
    expect(r.engine.state.activity.some(a => a.text.includes('not dismissed'))).toBe(true);

    down = false;
    gate.release(true);
    await r.engine.whenIdle();
    expect(r.engine.state.findings[0].state).toBe('confirmed');
    expect(r.engine.state.findings[0].check).toMatchObject({ confirmed: true, completed: true });
  });

  it('holds a letter, and does not build it from the template', async () => {
    const gate = holdGate();
    const r = rig({ modelsUp: gate.modelsUp });
    let down = true;
    r.behaviour.letter = () => down
      ? {
        subject: 'Review request',
        body: 'This text must not be kept.',
        origin: 'template',
        templateReason: 'no_answer',
        checkNotes: ['The letter model did not answer. Tried twice. The local model server did not answer.'],
        model: 'lantern-letter',
        at: '2026-11-18T00:01:00.000Z',
        seconds: 1
      }
      : letterDraft();
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    r.engine.decide('F0001', { action: 'accept' });
    await until(() => r.engine.state.jobs.some(j => j.stage === 'letter' && j.detail === HELD_FOR_MODELS));
    expect(r.engine.state.letters[0].status).toBe('drafting');
    expect(r.engine.state.letters[0].draft).toBeUndefined();
    expect(r.engine.state.letters[0].body).not.toContain('must not be kept');

    down = false;
    gate.release(true);
    await r.engine.whenIdle();
    expect(r.engine.state.letters[0]).toMatchObject({ status: 'ready', draft: { origin: 'model' } });
  });

  it('holds the reading of a scan, and does not mark the history as one that cannot be assessed', async () => {
    const gate = holdGate();
    const r = rig({ modelsUp: gate.modelsUp });
    let down = true;
    r.behaviour.transcribe = () => down
      ? { ok: false, error: SERVER_DOWN }
      : { ok: true, rows: ['2026-08-08 | Xarelto 20 mg tablet | qty 28', '2026-08-21 | Celebrex 200 mg capsule | qty 30'] };
    await r.engine.start();
    await r.engine.importCase({ fileName: 'scan.pdf', source: 'pdf-image', pageImages: ['AAAA'] });
    await until(() => r.engine.state.jobs.some(j => j.detail === HELD_FOR_MODELS));
    expect(r.engine.state.cases[0].cannotAssess).toBeUndefined();
    expect(r.engine.state.cases[0].lines).toEqual([]);
    expect(r.engine.state.jobs[0].status).toBe('queued');

    down = false;
    gate.release(true);
    await r.engine.whenIdle();
    expect(r.engine.state.cases[0].cannotAssess).toBeUndefined();
    expect(r.engine.state.cases[0].lines).toHaveLength(2);
    expect(r.engine.state.cases[0].transcriptionConfirmed).toBe(false);
    expect(r.calls).toEqual(['transcribe AAAA', 'transcribe AAAA']);
  });

  it('a restart keeps the waiting job, and runs it when the server answers', async () => {
    const gate = holdGate();
    const r = rig({ modelsUp: gate.modelsUp });
    r.behaviour.screen = () => ({ ok: false, error: SERVER_DOWN });
    await r.engine.start();
    await importCsv(r);
    await until(() => r.engine.state.jobs.some(j => j.detail === HELD_FOR_MODELS));

    const next = rig({ dir: r.dir, modelsUp: async () => true });
    next.behaviour.screen = () => ({ ok: true, suspected: false, result: screenResult([]) });
    await next.engine.start();
    await next.engine.whenIdle();
    expect(next.engine.state.cases[0].screening.criteria.map(run => run.status)).toEqual(['clear', 'clear']);
    expect(next.engine.state.cases[0].screening.status).toBe('done');
    expect(next.engine.state.jobs.some(j => j.status === 'failed')).toBe(false);
  });
});

// ---------- the pharmacist's decisions ----------

describe('decisions', () => {
  async function withConfirmedFinding(): Promise<Rig> {
    const r = rig();
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    return r;
  }

  it('bypass needs a short reason and writes it to the activity log', async () => {
    const r = await withConfirmedFinding();
    await expectApiError(() => r.engine.decide('F0001', { action: 'bypass' }), 400, 'reason');
    await expectApiError(() => r.engine.decide('F0001', { action: 'bypass', reason: '   ' }), 400);
    r.engine.decide('F0001', { action: 'bypass', reason: 'Short course. The doctor already knows.' });
    expect(r.engine.state.findings[0]).toMatchObject({ state: 'bypassed', decision: { action: 'bypass', reason: 'Short course. The doctor already knows.' } });
    expect(r.engine.state.letters).toEqual([]);
    expect(r.engine.state.activity[r.engine.state.activity.length - 1]).toMatchObject({
      kind: 'decision', findingId: 'F0001',
      text: 'The pharmacist bypassed the finding for Criterion one. Reason: Short course. The doctor already knows.'
    });
    expect(r.engine.stateResponse().counts).toMatchObject({ bypassed: 1, accepted: 0, bellBadge: 0 });
  });

  it('a decision is made once', async () => {
    const r = await withConfirmedFinding();
    r.engine.decide('F0001', { action: 'accept' });
    r.engine.decide('F0001', { action: 'accept' });               // the same again changes nothing
    expect(r.engine.state.letters).toHaveLength(1);
    await expectApiError(() => r.engine.decide('F0001', { action: 'bypass', reason: 'Changed my mind.' }), 409, 'already accepted');
    await r.engine.whenIdle();
  });

  it('refuses a decision that is not accept or bypass, and a finding that is not there', async () => {
    const r = await withConfirmedFinding();
    await expectApiError(() => r.engine.decide('F0001', { action: 'maybe' }), 400);
    await expectApiError(() => r.engine.decide('F0404', { action: 'accept' }), 404);
    await expectApiError(() => r.engine.markFindingSeen('F0404'), 404);
  });

  it('refuses a decision while the second check is still to come', async () => {
    const r = rig();
    let release: (value: CheckResult) => void = () => undefined;
    r.behaviour.check = () => new Promise<CheckResult>(resolve => { release = resolve; });
    await r.engine.start();
    await importCsv(r);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(r.engine.state.findings[0].state).toBe('suspected');
    await expectApiError(() => r.engine.decide('F0001', { action: 'accept' }), 409, 'second check has not finished');
    release(checkResult(true));
    await r.engine.whenIdle();
    expect(r.engine.state.findings[0].state).toBe('confirmed');
  });
});

// ---------- letters ----------

describe('letters', () => {
  async function withReadyLetter(): Promise<Rig> {
    const r = rig();
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    r.engine.decide('F0001', { action: 'accept' });
    await r.engine.whenIdle();
    return r;
  }

  it('keep to the order ready, sent, reply recorded, closed', async () => {
    const r = await withReadyLetter();
    await expectApiError(() => r.engine.recordReply('T0001', { outcome: 'changed', note: '' }), 409, 'after the letter is marked as sent');
    await expectApiError(() => r.engine.markSent('T0001', { by: 'fax' }), 400);
    const sentPreview = r.engine.previewLetter('T0001');
    r.engine.markSent('T0001', { by: 'email', previewToken: sentPreview.previewToken });
    r.engine.markSent('T0001', { by: 'email' });                  // the same again changes nothing
    await expectApiError(() => r.engine.markSent('T0001', { by: 'print' }), 409, 'already marked as sent');
    await expectApiError(() => r.engine.editLetter('T0001', { subject: 'x', body: 'y' }), 409, 'already sent');
    await expectApiError(() => r.engine.agree('T0001', {}), 409);
    await expectApiError(() => r.engine.recordReply('T0001', { outcome: 'perhaps', note: '' }), 400);
    r.engine.recordReply('T0001', { outcome: 'changed', note: 'Celecoxib stopped.' });
    r.engine.recordReply('T0001', { outcome: 'not_changed', note: 'Corrected: no change.' });   // a reply can be corrected
    expect(r.engine.state.letters[0].reply).toMatchObject({ outcome: 'not_changed', note: 'Corrected: no change.' });
    r.engine.closeLetter('T0001');
    r.engine.closeLetter('T0001');
    await expectApiError(() => r.engine.recordReply('T0001', { outcome: 'changed', note: '' }), 409, 'closed');
    expect(r.engine.state.letters[0].status).toBe('closed');
  });

  it('records whether the patient agreed, and lets the tick be removed before sending', async () => {
    const r = await withReadyLetter();
    r.engine.agree('T0001', { note: 'Spoke at the counter.' });
    expect(r.engine.state.letters[0].patientAgreed).toMatchObject({ note: 'Spoke at the counter.' });
    r.engine.agree('T0001', { agreed: false });
    expect(r.engine.state.letters[0].patientAgreed).toBeUndefined();
    const sentPreview = r.engine.previewLetter('T0001');
    r.engine.markSent('T0001', { by: 'print', previewToken: sentPreview.previewToken });
    const last = r.engine.state.activity[r.engine.state.activity.length - 1];
    expect(last.text).toBe('Letter T0001 was marked as sent by print. Patient agreement was not recorded. A reply is due in 7 days.');
  });

  it('refuse an empty text, a missing subject and a letter that is not there', async () => {
    const r = await withReadyLetter();
    await expectApiError(() => r.engine.editLetter('T0001', { subject: 'x', body: '   ' }), 400);
    await expectApiError(() => r.engine.editLetter('T0001', { body: 'text only' }), 400);
    await expectApiError(() => r.engine.editLetter('T0404', { subject: 'x', body: 'y' }), 404);
    await expectApiError(() => r.engine.closeLetter('T0404'), 404);
  });

  it('cannot be edited, sent or closed while the model is still writing', async () => {
    const r = rig();
    let release: (value: LetterDraft) => void = () => undefined;
    r.behaviour.letter = () => new Promise<LetterDraft>(resolve => { release = resolve; });
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    r.engine.decide('F0001', { action: 'accept' });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(r.engine.stateResponse().now.text).toBe('Ogee is writing 1 letter');
    await expectApiError(() => r.engine.editLetter('T0001', { subject: 'x', body: 'y' }), 409, 'still being written');
    await expectApiError(() => r.engine.markSent('T0001', { by: 'print' }), 409);
    await expectApiError(() => r.engine.closeLetter('T0001'), 409);
    release(letterDraft());
    await r.engine.whenIdle();
    expect(r.engine.state.letters[0].status).toBe('ready');
  });

  it('refuses to mark a letter sent until that exact text was previewed', async () => {
    const r = await withReadyLetter();
    const letter = r.engine.state.letters[0];
    expect(letter.previewedAt).toBeUndefined();
    expect(letter.body.endsWith('Marwan Morsy\nPharmacy Manager\nPHA0002761764')).toBe(true);
    expect(letter.closingLine).toBe('Drafted by a local AI model. Read by the pharmacist before sending.');
    await expectApiError(() => r.engine.markSent('T0001', { by: 'print' }), 409, 'has not been previewed');
    expect(r.engine.state.letters[0].status).toBe('ready');

    const preview = r.engine.previewLetter('T0001');
    expect(preview.text).toBe(r.engine.state.letters[0].body);
    expect(preview.emailDraft.fits).toBe(true);
    expect(preview.emailDraft.coverNote).toBe(false);
    expect(preview.emailDraft.text).toBe(preview.text);
    expect(preview.emailDraft).not.toHaveProperty('to');
    expect(r.engine.state.letters[0].previewHash).toHaveLength(64);

    r.engine.editLetter('T0001', { subject: letter.subject, body: preview.text + '\n\nOne more line.', expectedRevision: 0 });
    expect(r.engine.state.letters[0].previewedAt).toBeUndefined();
    expect(r.engine.state.letters[0].previewHash).toBeUndefined();
    expect(r.engine.state.letters[0].body.endsWith('PHA0002761764')).toBe(true);
    await expectApiError(() => r.engine.markSent('T0001', { by: 'print' }), 409, 'has not been previewed');

    const again = r.engine.previewLetter('T0001');
    r.engine.markSent('T0001', { by: 'print', previewToken: again.previewToken });
    expect(r.engine.state.letters[0].status).toBe('sent');
    expect(again.text.endsWith('PHA0002761764')).toBe(true);

    const src = fs.readFileSync(new URL('./engine.ts', import.meta.url), 'utf8');
    const sets = src.match(/status = 'sent'/g) ?? [];
    expect(sets).toEqual(["status = 'sent'"]);
  });

  it('does not mark an earlier preview as sent after another preview', async () => {
    const r = await withReadyLetter();
    const first = r.engine.previewLetter('T0001');
    const letter = r.engine.state.letters[0];
    r.engine.editLetter('T0001', { subject: letter.subject, body: letter.body + '\n\nA second window.', expectedRevision: 0 });
    const second = r.engine.previewLetter('T0001');
    await expectApiError(
      () => r.engine.markSent('T0001', { by: 'print', previewToken: first.previewToken }),
      409,
      'not the copy'
    );
    expect(r.engine.state.letters[0].status).toBe('ready');
    expect(r.engine.state.letters[0].body).toBe(second.text);
    r.engine.markSent('T0001', { by: 'print', previewToken: second.previewToken });
    expect(r.engine.state.letters[0].status).toBe('sent');
    expect(r.engine.state.letters[0].sentBy).toBe('print');
    expect(r.engine.state.letters[0].body).toBe(second.text);
  });

  it('does not mark an earlier preview as sent after only the subject changes', async () => {
    const r = await withReadyLetter();
    const first = r.engine.previewLetter('T0001');
    const letter = r.engine.state.letters[0];
    const nextSubject = `${letter.subject} (second window)`;
    r.engine.editLetter('T0001', { subject: nextSubject, body: letter.body, expectedRevision: 0 });
    const second = r.engine.previewLetter('T0001');
    expect(second.previewToken).not.toBe(first.previewToken);
    await expectApiError(
      () => r.engine.markSent('T0001', { by: 'email', previewToken: first.previewToken }),
      409,
      'not the copy'
    );
    expect(r.engine.state.letters[0].status).toBe('ready');
    expect(r.engine.state.letters[0].subject).toBe(nextSubject);
    r.engine.markSent('T0001', { by: 'email', previewToken: second.previewToken });
    expect(r.engine.state.letters[0].status).toBe('sent');
    expect(r.engine.state.letters[0].subject).toBe(nextSubject);
  });

  it('does not let an earlier window replace a newer draft', async () => {
    const r = await withReadyLetter();
    const opened = r.engine.state.letters[0].body;
    const subject = r.engine.state.letters[0].subject;
    r.engine.editLetter('T0001', { subject, body: `${opened}\n\nFirst window.`, expectedRevision: 0 });
    expect(r.engine.state.letters[0].draftRevision).toBe(1);
    const newer = r.engine.state.letters[0].body;
    await expectApiError(
      () => r.engine.editLetter('T0001', { subject, body: `${opened}\n\nStale window.`, expectedRevision: 0 }),
      409,
      'not the latest copy'
    );
    await expectApiError(
      () => r.engine.editLetter('T0001', { subject: 'No revision', body: `${opened}\n\nNo revision.` }),
      409,
      'not the latest copy'
    );
    expect(r.engine.state.letters[0].body).toBe(newer);
    expect(r.engine.state.letters[0].draftRevision).toBe(1);
    r.engine.editLetter('T0001', { subject: 'Second window', body: newer, expectedRevision: 1 });
    expect(r.engine.state.letters[0].subject).toBe('Second window');
    expect(r.engine.state.letters[0].body).toBe(newer);
    expect(r.engine.state.letters[0].draftRevision).toBe(2);
  });

  it('does not drop the end of a letter that is past the length limit', async () => {
    const r = await withReadyLetter();
    const opened = r.engine.state.letters[0].body;
    const subject = r.engine.state.letters[0].subject;
    const tooLong = `${'y'.repeat(200_000)}\nmore`;
    await expectApiError(
      () => r.engine.editLetter('T0001', { subject, body: tooLong, expectedRevision: 0 }),
      400,
      'longer than 200,000'
    );
    expect(r.engine.state.letters[0].body).toBe(opened);
    expect(r.engine.state.letters[0].subject).toBe(subject);
    expect(r.engine.state.letters[0].draftRevision ?? 0).toBe(0);
    await expectApiError(
      () => r.engine.editLetter('T0001', { subject: `${'S'.repeat(300)} and more`, body: opened, expectedRevision: 0 }),
      400,
      'longer than 300'
    );
    expect(r.engine.state.letters[0].subject).toBe(subject);
    expect(r.engine.state.letters[0].body).toBe(opened);
    // A subject and a letter that sit on the limit are kept in full.
    const atCap = 'y'.repeat(200_000);
    r.engine.editLetter('T0001', { subject: `  ${'S'.repeat(300)}  `, body: atCap, expectedRevision: 0 });
    expect(r.engine.state.letters[0].subject).toBe('S'.repeat(300));
    expect(r.engine.state.letters[0].body.startsWith(atCap)).toBe(true);
    expect(r.engine.state.letters[0].draftRevision).toBe(1);
  });

  it('does not give a saved template letter a later pharmacist\'s signature', async () => {
    const r = rig();
    const signed = 'Marwan Morsy\nPharmacy Manager\nPHA0002761764';
    const body = `Fictional patient. No real person.\n\nPlease review this medicine.\n\nYours sincerely,\n\n${signed}`;
    r.engine.state.letters.push({
      id: 'T0001', findingId: 'F0001', caseId: 'C0001', status: 'ready',
      subject: 'Review', body,
      editedByPharmacist: false, seenByPharmacist: false,
      draft: {
        subject: 'Review', body, origin: 'template', templateReason: 'error',
        checkNotes: [], model: 'test', at: '2026-11-20T00:00:00.000Z', seconds: 0
      },
      closingLine: '',
      signatureName: 'Marwan Morsy',
      signatureTitle: 'Pharmacy Manager',
      signatureRegistration: 'PHA0002761764'
    });
    r.engine.cfg = {
      ...r.engine.cfg,
      pharmacy: {
        ...r.engine.cfg.pharmacy,
        pharmacist: 'A Later Pharmacist',
        pharmacistTitle: 'Locum Pharmacist',
        registration: 'PHA9999999999'
      }
    };
    const preview = r.engine.previewLetter('T0001');
    expect(preview.text).toContain(signed);
    expect(preview.text).not.toContain('A Later Pharmacist');
    expect(preview.text).not.toContain('PHA9999999999');
    expect(preview.text.split('Yours sincerely,').length - 1).toBe(1);
    expect(r.engine.state.letters[0].signatureName).toBe('Marwan Morsy');
    expect(r.engine.state.letters[0].closingLine).toBe('');
  });

  it('does not assign today\'s signature when a saved letter has none', async () => {
    const r = rig();
    const body = 'Fictional patient. No real person.\n\nPlease review this medicine.';
    r.engine.state.letters.push({
      id: 'T0001', findingId: 'F0001', caseId: 'C0001', status: 'ready',
      subject: 'Review', body,
      editedByPharmacist: false, seenByPharmacist: false
    });
    r.engine.cfg = {
      ...r.engine.cfg,
      pharmacy: {
        ...r.engine.cfg.pharmacy,
        pharmacist: 'A Later Pharmacist',
        pharmacistTitle: 'Locum Pharmacist',
        registration: 'PHA9999999999'
      }
    };
    await expectApiError(() => r.engine.previewLetter('T0001'), 409, 'no saved signature');
    expect(r.engine.state.letters[0].body).toBe(body);
    expect(r.engine.state.letters[0].signatureName).toBeUndefined();
    r.engine.editLetter('T0001', { subject: 'Review', body, expectedRevision: 0 });
    expect(r.engine.state.letters[0].signatureName).toBe('A Later Pharmacist');
    expect(r.engine.state.letters[0].body).toContain('A Later Pharmacist');
    expect(r.engine.state.letters[0].body.split('A Later Pharmacist').length - 1).toBe(1);
  });

  it('a long letter gets a cover note in the email draft, and the draft has no address', async () => {
    const r = rig();
    r.behaviour.letter = () => ({ ...letterDraft(), body: 'Fictional patient. No real person.\n\n' + 'word '.repeat(500) });
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    r.engine.decide('F0001', { action: 'accept' });
    await r.engine.whenIdle();
    const preview = r.engine.previewLetter('T0001');
    expect(preview.text.length).toBeGreaterThan(1800);
    expect(preview.emailDraft.coverNote).toBe(true);
    expect(preview.emailDraft.fits).toBe(false);
    expect(preview.emailDraft.text).toContain('copy it from the preview');
    expect(JSON.stringify(preview.emailDraft)).not.toContain('@');
  });
});

// ---------- other ways in ----------

describe('PDF imports', () => {
  it('rows from a PDF with text are screened at once', async () => {
    const r = rig();
    await r.engine.start();
    await r.engine.importCase({
      fileName: 'C:\\Users\\someone\\history.pdf', source: 'pdf-text',
      rows: ['Example Pharmacy (FICTIONAL)', '2026-08-08 Xarelto 20 mg tablet 28', '2026-08-21 Celebrex 200 mg capsule 30'],
      patient: { label: 'F-003', age: 80 }
    });
    await r.engine.whenIdle();
    const c = r.engine.state.cases[0];
    expect(c.fileName).toBe('history.pdf');
    expect(c.patient).toEqual({ label: 'Fictional patient F-003', age: 80 });
    expect(c.lines.map(l => l.text)).toEqual(['2026-08-08 Xarelto 20 mg tablet 28', '2026-08-21 Celebrex 200 mg capsule 30']);
    expect(c.screening.status).toBe('done');
  });

  it('a text PDF keeps the column names, drops the title rows, and names the patient from the file', async () => {
    const r = rig();
    await r.engine.start();
    await r.engine.importCase({
      fileName: 'positive.pdf', source: 'pdf-text',
      patient: { label: 'F-999' },
      rows: [
        'Dispensing history',
        'Example Community Pharmacy (fictional). Patient: Fictional patient F-001. Age 72. Female.',
        'Fictional patient. No real person.',
        'Date | Medicine | Strength | Form | Qty | Repeats | Directions | Prescriber',
        '08/08/2026 | Xarelto | 20 mg | tablet | 28 | 5 | Take ONE tablet daily with food | Dr F. Example',
        '21/08/2026 | Celebrex (celecoxib) | 200 mg | capsule | 30 | 2 | Take ONE capsule daily with food | Dr G. Sample'
      ]
    });
    await r.engine.whenIdle();
    const c = r.engine.state.cases[0];
    expect(c.patient).toEqual({ label: 'Fictional patient F-001', age: 72, sex: 'F', ageFrom: 'record' });
    expect(c.lines.map(l => l.text)).toEqual([
      '2026-08-08 | Xarelto 20 mg tablet | qty 28 | repeats 5 | Take ONE tablet daily with food | Dr F. Example',
      '2026-08-21 | Celebrex (celecoxib) 200 mg capsule | qty 30 | repeats 2 | Take ONE capsule daily with food | Dr G. Sample'
    ]);
    expect(c.lines.some(l => /dispensing history|no real person|^Date \|/i.test(l.text))).toBe(false);
    expect(c.screening.status).toBe('done');
  });

  it('a scan is read by Model 1 first, and screened only after the pharmacist confirms the rows', async () => {
    const r = rig();
    await r.engine.start();
    const { caseId } = await r.engine.importCase({ fileName: 'scan.pdf', source: 'pdf-image', pageImages: ['data:image/png;base64,AAAA', 'BBBB'] });
    expect(fs.readdirSync(path.join(r.dir, 'images')).sort()).toEqual(['C0001-p001.b64', 'C0001-p002.b64']);
    await r.engine.whenIdle();

    let c = r.engine.state.cases[0];
    expect(r.calls).toEqual(['transcribe AAAA', 'transcribe BBBB']);        // nothing screened yet
    expect(c.transcriptionConfirmed).toBe(false);
    expect(c.screening.status).toBe('not_started');
    expect(c.lines.map(l => [l.id, l.page])).toEqual([['L001', 1], ['L002', 1], ['L003', 2], ['L004', 2]]);
    expect(JSON.stringify(r.engine.state)).not.toContain('AAAA');            // images are not kept in the state

    r.engine.confirmTranscription(caseId, {});
    await r.engine.whenIdle();
    c = r.engine.state.cases[0];
    expect(c.transcriptionConfirmed).toBe(true);
    expect(c.screening.status).toBe('done');
    expect(r.calls.slice(2)).toEqual(['screen ONE', 'screen TWO', 'check ONE']);
    expect(fs.readdirSync(path.join(r.dir, 'images'))).toEqual([]);          // removed once confirmed
  });

  it('a text PDF uses its date of birth and reports a conflicting printed age', async () => {
    const r = rig();
    await r.engine.start();
    await r.engine.importCase({
      fileName: 'dob.pdf', source: 'pdf-text', rows: [
        'Patient: Fictional patient F-100. Age 80. DOB 15/08/1952.',
        'Date | Medicine | Strength | Form | Qty | Repeats | Directions | Prescriber',
        '08/08/2026 | Xarelto | 20 mg | tablet | 28 | 5 | Take ONE | Dr A. Example',
        '21/08/2026 | Celebrex | 200 mg | capsule | 30 | 2 | Take ONE | Dr B. Example'
      ]
    });
    const c = r.engine.state.cases[0];
    expect(c.patient).toEqual({
      label: 'Fictional patient F-100', dateOfBirth: '1952-08-15', age: 74, ageFrom: 'date_of_birth'
    });
    expect(c.cannotAssess).toContain(
      'The age in the file (80) does not match the date of birth (age 74 at the last supply). The date of birth was used.'
    );
  });

  it('a scanned history uses its transcribed date of birth at the latest supply', async () => {
    const r = rig();
    r.behaviour.transcribe = () => ({
      ok: true,
      rows: ['2026-08-08 | Xarelto 20 mg tablet | qty 28', '2026-08-21 | Celebrex 200 mg capsule | qty 30'],
      patient: { dateOfBirth: '1952-08-15', age: 80, sex: 'F' }
    });
    await r.engine.start();
    await r.engine.importCase({ fileName: 'dob-scan.pdf', source: 'pdf-image', pageImages: ['AAAA'] });
    await r.engine.whenIdle();
    const c = r.engine.state.cases[0];
    expect(c.patient).toEqual({
      label: 'Fictional patient', dateOfBirth: '1952-08-15', age: 74, ageFrom: 'date_of_birth', sex: 'F'
    });
    expect(c.scanNotes).toContain(
      'The age in the file (80) does not match the date of birth (age 74 at the last supply). The date of birth was used.'
    );
  });

  it('does not confirm a scan that printed two dates of birth as one patient', async () => {
    const r = rig();
    let page = 0;
    r.behaviour.transcribe = () => {
      page += 1;
      return {
        ok: true,
        rows: page === 1
          ? ['2026-08-08 | Xarelto 20 mg tablet | qty 28']
          : ['2026-08-21 | Celebrex 200 mg capsule | qty 30'],
        patient: { dateOfBirth: page === 1 ? '1952-08-15' : '1961-01-01', sex: 'F' }
      };
    };
    await r.engine.start();
    const { caseId } = await r.engine.importCase({ fileName: 'two-patients.pdf', source: 'pdf-image', pageImages: ['AAAA', 'BBBB'] });
    await r.engine.whenIdle();
    const before = r.engine.state.cases[0];
    expect(before.transcriptionConfirmed).toBe(false);
    expect(before.scanNotes?.some(note => note.includes('more than one date of birth'))).toBe(true);
    await expectApiError(() => r.engine.confirmTranscription(caseId, {}), 409, 'more than one date of birth');
    const after = r.engine.state.cases[0];
    expect(after.transcriptionConfirmed).toBe(false);
    expect(after.screening.status).toBe('not_started');
    expect(after.scanNotes?.some(note => note.includes('more than one date of birth'))).toBe(true);
    expect(after.patient.dateOfBirth).toBeUndefined();
    expect(r.engine.state.jobs.some(job => job.stage === 'screen' && (job.status === 'queued' || job.status === 'running'))).toBe(false);
  });

  it('recomputes a scanned patient age after the pharmacist corrects the latest supply date', async () => {
    const r = rig();
    r.behaviour.transcribe = () => ({
      ok: true,
      rows: ['2026-08-08 | Xarelto 20 mg tablet | qty 28', '2026-08-21 | Celebrex 200 mg capsule | qty 30'],
      patient: { dateOfBirth: '1952-08-15', age: 74, sex: 'F' }
    });
    await r.engine.start();
    const { caseId } = await r.engine.importCase({ fileName: 'dob-scan.pdf', source: 'pdf-image', pageImages: ['AAAA'] });
    await r.engine.whenIdle();
    r.engine.confirmTranscription(caseId, {
      rows: ['2026-08-08 | Xarelto 20 mg tablet | qty 28', '2027-08-21 | Celebrex 200 mg capsule | qty 30']
    });
    await r.engine.whenIdle();
    expect(r.engine.state.cases[0].patient).toEqual({
      label: 'Fictional patient', dateOfBirth: '1952-08-15', age: 75, ageFrom: 'date_of_birth', sex: 'F'
    });
  });

  it('keeps the printed age fallback when a scanned date of birth gives no age at confirmation', async () => {
    const r = rig();
    r.behaviour.transcribe = () => ({
      ok: true,
      rows: ['2026-08-21 | Celebrex 200 mg capsule | qty 30'],
      patient: { dateOfBirth: '2026-08-22', age: 5, sex: 'F' }
    });
    await r.engine.start();
    const { caseId } = await r.engine.importCase({ fileName: 'dob-scan.pdf', source: 'pdf-image', pageImages: ['AAAA'] });
    await r.engine.whenIdle();
    expect(r.engine.state.cases[0].patient.age).toBe(5);
    expect(r.engine.state.cases[0].patient.ageFrom).toBe('record');
    r.engine.confirmTranscription(caseId, {});
    await r.engine.whenIdle();
    expect(r.engine.state.cases[0].patient).toEqual({
      label: 'Fictional patient', dateOfBirth: '2026-08-22', age: 5, ageFrom: 'record', sex: 'F'
    });
  });

  it('the rows cannot be confirmed while Model 1 is still reading the pages', async () => {
    const r = rig();
    type Read = Awaited<ReturnType<PipelineFns['transcribePageImage']>>;
    let release: (value: Read) => void = () => undefined;
    r.behaviour.transcribe = () => new Promise<Read>(resolve => { release = resolve; });
    await r.engine.start();
    const { caseId } = await r.engine.importCase({ fileName: 'scan.pdf', source: 'pdf-image', pageImages: ['AAAA'] });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(r.engine.stateResponse().now.text).toBe('Mantle is reading a scanned page: page 1 of 1');
    await expectApiError(() => r.engine.confirmTranscription(caseId, { rows: ['2026-08-08 | Xarelto 20 mg tablet'] }), 409, 'still being read');
    release({ ok: true, rows: ['2026-08-08 | Xarelto 20 mg tablet | qty 28', '2026-08-21 | Celebrex 200 mg capsule | qty 30'] });
    await r.engine.whenIdle();
    expect(r.engine.state.cases[0].lines).toHaveLength(2);
    r.engine.confirmTranscription(caseId, {});
    await r.engine.whenIdle();
    expect(r.engine.state.cases[0].screening.status).toBe('done');
  });

  it('the pharmacist can correct the rows when confirming', async () => {
    const r = rig();
    await r.engine.start();
    const { caseId } = await r.engine.importCase({ fileName: 'scan.pdf', source: 'pdf-image', pageImages: ['AAAA'] });
    await r.engine.whenIdle();
    r.engine.confirmTranscription(caseId, { rows: ['2026-08-08 | Xarelto 20 mg tablet | qty 28', '2026-08-21 | Celebrex 200 mg capsule | qty 30', '2026-09-08 | Xarelto 20 mg tablet | qty 28'] });
    await r.engine.whenIdle();
    expect(r.engine.state.cases[0].lines.map(l => l.id)).toEqual(['L001', 'L002', 'L003']);
    expect(r.engine.state.cases[0].screening.status).toBe('done');
  });

  it('a page that could not be read means "cannot assess", never "no findings"', async () => {
    const r = rig();
    r.behaviour.transcribe = () => ({ ok: false, error: 'Tried twice. The model took too long to answer.' });
    await r.engine.start();
    const { caseId } = await r.engine.importCase({ fileName: 'scan.pdf', source: 'pdf-image', pageImages: ['AAAA'] });
    await r.engine.whenIdle();
    const c = r.engine.state.cases[0];
    expect(c.cannotAssess).toBe('Page 1 of the scan could not be read. Tried twice. The model took too long to answer.');
    expect(c.screening.status).toBe('not_started');
    await expectApiError(() => r.engine.confirmTranscription(caseId, {}), 409, 'cannot be assessed');
    expect(r.calls).toEqual(['transcribe AAAA']);
  });

  it('an interrupted scan does not attach the earlier patient\'s pages to the next patient', async () => {
    const r = rig();
    await r.engine.start();
    const images = new PageImages(path.join(r.dir, 'images'));
    images.save('C0001', ['EARLIER-ONE', 'EARLIER-TWO']);
    r.behaviour.transcribe = image => ({ ok: true, rows: [`2026-08-08 | ${image}`] });
    await r.engine.importCase({ fileName: 'later.pdf', source: 'pdf-image', pageImages: ['LATER'] });
    await r.engine.whenIdle();
    expect(r.calls.filter(call => call.startsWith('transcribe'))).toEqual(['transcribe LATER']);
    const lines = r.engine.state.cases[0].lines.map(line => line.text).join('\n');
    expect(lines).not.toContain('EARLIER');
    expect(lines).toContain('LATER');
  });

  it('refuses an import with nothing in it', async () => {
    const r = rig();
    await r.engine.start();
    await expectApiError(() => r.engine.importCase({ fileName: 'x', source: 'fax' }), 400);
    await expectApiError(() => r.engine.importCase({ fileName: 'x.csv', source: 'csv' }), 400, 'CSV text is missing');
    await expectApiError(() => r.engine.importCase({ fileName: 'x.pdf', source: 'pdf-text' }), 400);
    await expectApiError(() => r.engine.importCase({ fileName: 'x.pdf', source: 'pdf-image', pageImages: [] }), 400);
    await expectApiError(() => r.engine.confirmTranscription('C0404', {}), 404);
  });
});

// ---------- reset ----------

describe('reset', () => {
  it('starts clean, keeps a dated backup and drops the result of a job that was running', async () => {
    const r = rig();
    let release: (value: CheckResult) => void = () => undefined;
    r.behaviour.check = () => new Promise<CheckResult>(resolve => { release = resolve; });
    await r.engine.start();
    await importCsv(r);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(r.engine.state.findings).toHaveLength(1);

    r.clock.now = new Date(2026, 10, 18, 7, 15, 2);
    const { backup } = await r.engine.reset();
    expect(backup).toBe('state-2026-11-18T07-15-02.json');
    expect(fs.existsSync(path.join(r.dir, 'backups', backup!))).toBe(true);
    expect(r.engine.state.cases).toEqual([]);
    expect(r.engine.state.findings).toEqual([]);
    expect(r.engine.state.activity.map(a => a.kind)).toEqual(['reset']);

    release(checkResult(true));                                   // the old job comes back after the reset
    await r.engine.whenIdle();
    expect(r.engine.state.findings).toEqual([]);
    expect(r.engine.state.jobs).toEqual([]);

    // The engine still works after a reset. The new history is not given the ids of the one that was cleared.
    r.behaviour.check = () => checkResult(true);
    expect(await importCsv(r)).not.toBe('C0001');
    await r.engine.whenIdle();
    expect(r.engine.state.findings[0].id).not.toBe('F0001');
    expect(r.engine.state.findings[0].state).toBe('confirmed');
  });

  it('a decision saved before a reset does not accept the new patient\'s finding', async () => {
    const r = rig();
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    const earlier = r.engine.state.findings[0].id;
    expect(earlier).toBe('F0001');
    await r.engine.reset();
    await importCsv(r, 'second.csv');
    await r.engine.whenIdle();
    const later = r.engine.state.findings[0];
    expect(later.id).not.toBe(earlier);
    await expectApiError(() => r.engine.decide(earlier, { action: 'accept' }), 404, 'not found');
    expect(later.state).toBe('confirmed');
    expect(later.decision).toBeUndefined();
    expect(r.engine.state.letters).toEqual([]);
  });
});

describe('one patient is never joined to another', () => {
  function parkedCase(id: string, label: string, line: string): AppState['cases'][number] {
    return {
      id, fileName: `${id}.csv`, importedAt: '2026-11-20T00:00:00.000Z', source: 'csv',
      patient: { label }, lines: [{ id: 'L001', text: line }],
      transcriptionConfirmed: true, parts: 1,
      screening: { status: 'done', criteria: [{ criterionId: 'ONE', status: 'suspected' }] }
    };
  }

  it('a saved check that names one history and another history\'s finding is set aside', async () => {
    const r = rig();
    await r.engine.start();
    await r.engine.whenIdle();
    r.engine.state.cases.push(
      parkedCase('C0001', 'Fictional patient AAA', 'AAA supply'),
      parkedCase('C0002', 'Fictional patient BBB', 'BBB supply')
    );
    r.engine.state.findings.push({
      id: 'F0001', caseId: 'C0002', criterionId: 'ONE', state: 'suspected', possible: false,
      screen: screenResult(['L001']), seenByPharmacist: false
    });
    r.engine.state.jobs.push({ id: 'J0099', stage: 'check', caseId: 'C0001', findingId: 'F0001', status: 'queued' });
    r.engine.kick();
    await r.engine.whenIdle();
    expect(r.calls.some(call => call.startsWith('check'))).toBe(false);
    expect(r.engine.state.findings[0].check).toBeUndefined();
    expect(r.engine.state.findings[0].state).toBe('suspected');
    expect(r.engine.state.findings[0].caseId).toBe('C0002');
    expect(r.engine.state.cases[0].lines[0].text).toBe('AAA supply');
    expect(r.engine.state.cases[1].lines[0].text).toBe('BBB supply');
    const job = r.engine.state.jobs.find(item => item.id === 'J0099');
    expect(job?.status).toBe('failed');
    expect(r.engine.state.activity.some(item => item.kind === 'error' && /set aside/i.test(item.text))).toBe(true);
  });

  it('a saved letter step that names one history and another history\'s finding is set aside', async () => {
    const r = rig();
    await r.engine.start();
    await r.engine.whenIdle();
    r.engine.state.cases.push(
      parkedCase('C0001', 'Fictional patient AAA', 'AAA supply'),
      parkedCase('C0002', 'Fictional patient BBB', 'BBB supply')
    );
    r.engine.state.findings.push({
      id: 'F0001', caseId: 'C0002', criterionId: 'ONE', state: 'accepted', possible: false,
      screen: screenResult(['L001']), seenByPharmacist: true,
      decision: { action: 'accept', by: 'The pharmacist on duty', at: '2026-11-20T00:00:00.000Z' }
    });
    r.engine.state.letters.push({
      id: 'T0001', findingId: 'F0001', caseId: 'C0002', status: 'drafting',
      subject: '', body: '', editedByPharmacist: false, seenByPharmacist: false
    });
    r.engine.state.jobs.push({ id: 'J0098', stage: 'letter', caseId: 'C0001', findingId: 'F0001', status: 'queued' });
    r.engine.kick();
    await r.engine.whenIdle();
    expect(r.calls.some(call => call.startsWith('letter'))).toBe(false);
    expect(r.engine.state.letters[0]).toMatchObject({ status: 'drafting', body: '', caseId: 'C0002' });
    expect(r.engine.state.jobs.find(item => item.id === 'J0098')?.status).toBe('failed');
  });

  it('a check and a letter use the criterion text the history was screened under', async () => {
    const r = rig({ criteria: [{ ...ONE, statement: 'VERSION ONE statement' }] });
    let checked = '';
    let lettered = '';
    r.behaviour.screen = async () => {
      r.behaviour.criteria = () => [{ ...ONE, statement: 'VERSION TWO statement' }];
      await r.engine.refreshCriteria();
      return { ok: true, suspected: true, result: screenResult(['L001', 'L002']) };
    };
    r.behaviour.check = (_screen, criterion) => {
      checked = criterion.statement;
      return checkResult(true);
    };
    r.pipeline.draftLetter = async (_cfg, _patient, _lines, criterion) => {
      lettered = criterion.statement;
      return letterDraft();
    };
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    expect(checked).toBe('VERSION ONE statement');
    r.engine.decide(r.engine.state.findings[0].id, { action: 'accept' });
    await r.engine.whenIdle();
    expect(lettered).toBe('VERSION ONE statement');
    expect(r.engine.state.letters[0].body).not.toContain('VERSION TWO');
  });
});

// ---------- counts and the "now" line on their own ----------

describe('counts and the now line', () => {
  it('are zero and idle for an empty state', () => {
    const counts = computeCounts(emptyState(), new Date());
    expect(Object.values(counts).every(n => n === 0)).toBe(true);
    expect(computeNow(emptyState())).toEqual({ stage: null, text: 'Idle' });
  });

  it('say how many findings and letters are waiting, and which page of a scan is being read', () => {
    const state = emptyState();
    const finding = (id: string): Finding => ({ id, caseId: 'C0001', criterionId: 'ONE', state: 'suspected', possible: false, screen: screenResult(['L001']), seenByPharmacist: false });
    state.findings.push(finding('F0001'), finding('F0002'));
    state.jobs.push({ id: 'J0001', stage: 'check', caseId: 'C0001', findingId: 'F0001', status: 'running' });
    expect(computeNow(state, {}, testConfig.modelNames).text).toBe('Lumen is double-checking 2 findings');

    const scan = emptyState();
    scan.cases.push({
      id: 'C0001', fileName: 'scan.pdf', importedAt: '', source: 'pdf-image', patient: { label: 'Fictional patient' }, lines: [],
      transcriptionConfirmed: false, parts: 1, screening: { status: 'not_started', criteria: [] }
    });
    scan.jobs.push({ id: 'J0001', stage: 'screen', caseId: 'C0001', status: 'running' }, { id: 'J0002', stage: 'screen', caseId: 'C0002', status: 'queued' });
    expect(computeNow(scan, { page: 2, pages: 3 }, testConfig.modelNames).text).toBe('Mantle is reading a scanned page: page 2 of 3. 1 more history is waiting');

    const queued = emptyState();
    queued.jobs.push({ id: 'J0001', stage: 'letter', caseId: 'C0001', findingId: 'F0001', status: 'queued' });
    expect(computeNow(queued)).toEqual({ stage: 'letter', text: 'Starting the next step' });
  });
});

// ---------- the review of 18 November: what the reviewers proved, as tests ----------

const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

describe('a criterion that could not be screened is never "no finding"', () => {
  it('does not count the history as screened, and the log never says "nothing suspected"', async () => {
    const r = rig();
    r.behaviour.screen = () => ({ ok: false, error: 'Tried twice. The model took too long to answer.' });
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    const snap = r.engine.stateResponse();
    expect(snap.counts.historiesScreened).toBe(0);
    expect(snap.state.cases[0].screening.criteria.map(c => c.status)).toEqual(['failed', 'failed']);
    const last = snap.state.activity[snap.state.activity.length - 1];
    expect(last.kind).toBe('error');
    expect(last.text).toBe(
      'Mantle could not fully screen positive.csv: 2 criteria of 2 could not be screened. This is not a clear result. ' +
      'Use "Screen again" on the history when the models are running.');
    expect(snap.state.activity.some(a => a.text.includes('nothing suspected'))).toBe(false);
    expect(snap.state.jobs[0].detail).toBe('0 of 2 criteria screened, 2 could not be screened');
  });

  it('"Screen again" screens only what has no result, without a second import', async () => {
    const r = rig();
    let modelsDown = true;
    r.behaviour.screen = criterion => {
      if (modelsDown && criterion.id === 'TWO') return { ok: false, error: 'Tried twice. The local model server answered with error 500: CUDA error.' };
      return criterion.id === 'ONE'
        ? { ok: true, suspected: true, result: screenResult(['L001', 'L002']) }
        : { ok: true, suspected: false, result: screenResult([]) };
    };
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    expect(r.engine.stateResponse().counts.historiesScreened).toBe(0);
    expect(r.engine.state.activity.some(a => a.text.includes(
      '1 criterion of 2 could not be screened. 1 suspected finding goes to the second check. This is not a clear result.'))).toBe(true);
    await expectApiError(() => r.engine.screenAgain('C0404'), 404);

    modelsDown = false;
    const c = r.engine.screenAgain('C0001');
    expect(c.screening.criteria[0].status).toBe('suspected');            // it keeps its result
    expect(c.screening.criteria[1]).toMatchObject({ status: 'running' }); // the failed one is on its way again
    expect(c.screening.criteria[1].error).toBeUndefined();
    await r.engine.whenIdle();
    expect(r.calls.filter(x => x.startsWith('screen'))).toEqual(['screen ONE', 'screen TWO', 'screen TWO']);   // ONE keeps its result
    expect(r.engine.state.cases).toHaveLength(1);
    expect(r.engine.state.findings).toHaveLength(1);                     // the finding is not made twice
    expect(r.engine.state.cases[0].screening.criteria.map(x => [x.status, x.error])).toEqual([['suspected', undefined], ['clear', undefined]]);
    expect(r.engine.stateResponse().counts.historiesScreened).toBe(1);
    await expectApiError(() => r.engine.screenAgain('C0001'), 409, 'nothing to screen again');
  });

  it('keeps what Model 1 wrote for a criterion it called clear', async () => {
    const r = rig();
    r.behaviour.screen = criterion => criterion.id === 'ONE'
      ? { ok: true, suspected: true, result: screenResult(['L001', 'L002']) }
      : { ok: true, suspected: false, result: { ...screenResult([]), reason: 'Xarelto is supplied, but no NSAID is in the history.' } };
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    const runs = r.engine.state.cases[0].screening.criteria;
    expect(runs[1]).toMatchObject({ status: 'clear', reason: 'Xarelto is supplied, but no NSAID is in the history.' });
    expect(runs[0].reason).toBeUndefined();                              // a suspected criterion keeps it on its finding
  });
});

describe('a second check that is not a plain yes or no', () => {
  it('a "no" that names the proving lines still reaches the bell, marked unclear, and is not counted as confirmed', async () => {
    const r = rig();
    r.behaviour.check = () => ({ ...checkResult(false), lineIds: ['L001', 'L002'], unclear: true });
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    expect(r.engine.state.findings[0].state).toBe('confirmed');
    expect(r.engine.stateResponse().counts).toMatchObject({ findingsConfirmed: 0, bellBadge: 1 });
    expect(r.engine.state.activity.some(a => a.kind === 'check' && a.text.includes('marked "second check unclear"'))).toBe(true);
    expect(r.engine.state.jobs.find(j => j.stage === 'check')?.detail).toBe('second check unclear');
  });

  it('a finding in the grey list can still be accepted, and then gets its letter', async () => {
    const r = rig();
    r.behaviour.check = () => checkResult(false);
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    expect(r.engine.state.findings[0].state).toBe('not_confirmed');
    expect(r.engine.stateResponse().disputedWaiting).toBe(1);
    await expectApiError(() => r.engine.decide('F0001', { action: 'accept' }), 400, 'accepting this finding anyway');
    r.engine.decide('F0001', { action: 'accept', reason: 'The lines are enough. I will write to the doctor.' });
    await r.engine.whenIdle();
    expect(r.engine.state.findings[0].state).toBe('accepted');
    expect(r.engine.state.letters[0]).toMatchObject({ findingId: 'F0001', status: 'ready' });
    expect(r.engine.state.activity.some(a => a.text.includes('The two models disagreed') && a.text.includes('accepted it anyway'))).toBe(true);
    expect(r.engine.stateResponse().disputedWaiting).toBe(0);
  });

  it('dismiss closes a disputed finding with no letter', async () => {
    const r = rig();
    r.behaviour.check = () => checkResult(false);
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    const finding = r.engine.state.findings[0];
    expect(finding.state).toBe('not_confirmed');
    expect(finding.screen.reason).toBe('Both are supplied.');
    expect(finding.check?.whatMatches).toBe('Celebrex and Xarelto.');
    r.engine.decide('F0001', { action: 'dismiss', reason: 'The supplies are months apart.' });
    expect(r.engine.state.findings[0].state).toBe('not_confirmed');
    expect(r.engine.state.findings[0].decision).toMatchObject({ action: 'dismiss', reason: 'The supplies are months apart.' });
    expect(r.engine.state.letters).toEqual([]);
    expect(r.engine.stateResponse().disputedWaiting).toBe(0);
    expect(r.engine.state.activity.some(a => a.text.includes('dismissed it') && a.text.includes('No letter was written.'))).toBe(true);
    r.engine.decide('F0001', { action: 'dismiss' });
    await expectApiError(() => r.engine.decide('F0001', { action: 'accept', reason: 'Changed my mind.' }), 409);
  });
});

describe('one failed write of the state file does not strand the work', () => {
  /** Makes the store throw on the writes the test picks, as it does when another program holds the file. */
  function failWrites(r: Rig, fails: (n: number) => boolean): { count: () => number } {
    const real = r.store.save.bind(r.store);
    let n = 0;
    r.store.save = () => {
      n++;
      if (fails(n)) throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
      real();
    };
    return { count: () => n };
  }

  function onDisk(r: Rig): AppState {
    const reread = new StateStore(r.dir);
    reread.load();
    return reread.state;
  }

  it('A: the write just after a job is marked running fails. The job still runs', async () => {
    const r = rig();
    await r.engine.start();                    // write 1
    failWrites(r, n => n === 2);               // write 1 here is the import, write 2 marks the job as running
    await importCsv(r);
    await r.engine.whenIdle();
    expect(r.engine.state.cases[0].screening.status).toBe('done');
    expect(r.engine.state.findings[0].state).toBe('confirmed');
    expect(r.engine.state.jobs.every(j => j.status === 'done')).toBe(true);
    expect(r.engine.stateResponse().now.text).toBe('Idle');
    const notes = r.engine.state.activity.filter(a => a.kind === 'error').map(a => a.text);
    expect(notes[0]).toContain('The state file could not be written.');
    expect(notes[1]).toBe('The state file can be written again. Nothing was lost.');
    expect(onDisk(r)).toEqual(r.engine.state);
  });

  it('B: the write of a criterion result fails. Every criterion is still screened and the finding is checked', async () => {
    const r = rig({ criteria: [ONE, TWO, THREE] });
    await r.engine.start();
    failWrites(r, n => n === 5);
    await importCsv(r);
    await r.engine.whenIdle();
    const c = r.engine.state.cases[0];
    expect(c.screening.status).toBe('done');
    expect(c.screening.criteria.map(x => x.status)).toEqual(['suspected', 'clear', 'clear']);
    expect(r.calls).toEqual(['screen ONE', 'screen TWO', 'screen THREE', 'check ONE']);
    expect(r.engine.state.findings[0].state).toBe('confirmed');
    expect(onDisk(r)).toEqual(r.engine.state);
  });

  it('C: the write fails when the pharmacist accepts. The decision is refused and the file is unchanged', async () => {
    const r = rig();
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    const before = fs.readFileSync(path.join(r.dir, 'state.json'));
    failWrites(r, n => n === 1);
    await expectApiError(() => r.engine.decide('F0001', { action: 'accept' }), 503, 'could not be written');
    expect(r.engine.state.findings[0].state).toBe('confirmed');
    expect(r.engine.state.letters).toEqual([]);
    expect(fs.readFileSync(path.join(r.dir, 'state.json')).equals(before)).toBe(true);
    r.store.save = StateStore.prototype.save.bind(r.store);
    const f = r.engine.decide('F0001', { action: 'accept' });
    expect(f.state).toBe('accepted');
    expect(onDisk(r).findings[0].state).toBe('accepted');
    expect(onDisk(r).letters).toHaveLength(1);
  });

  it('does not acknowledge an import when the state file cannot be written', async () => {
    const r = rig();
    await r.engine.start();
    const before = fs.readFileSync(path.join(r.dir, 'state.json'));
    failWrites(r, () => true);
    await expectApiError(() => importCsv(r), 503, 'could not be written');
    expect(r.engine.state.cases).toEqual([]);
    expect(fs.readFileSync(path.join(r.dir, 'state.json')).equals(before)).toBe(true);
    expect(fs.existsSync(path.join(r.dir, 'pins', 'C0001.json'))).toBe(false);
    r.store.save = StateStore.prototype.save.bind(r.store);
    const id = await importCsv(r);
    expect(r.engine.state.cases.map(c => c.id)).toEqual([id]);
    expect(onDisk(r).cases.map(c => c.id)).toEqual([id]);
  });

  it('does not keep a scan when the import could not be written', async () => {
    const r = rig();
    await r.engine.start();
    failWrites(r, () => true);
    await expectApiError(
      () => r.engine.importCase({ fileName: 'scan.pdf', source: 'pdf-image', pageImages: ['AAAA'] }),
      503,
      'could not be written'
    );
    expect(r.engine.state.cases).toEqual([]);
    expect(new PageImages(path.join(r.dir, 'images')).list('C0001')).toEqual([]);
    expect(fs.existsSync(path.join(r.dir, 'pins', 'C0001.json'))).toBe(false);
  });

  it('keeps trying while the file cannot be written, and writes it as soon as it can', async () => {
    const r = rig();
    await r.engine.start();
    let held = true;
    failWrites(r, n => held && n > 1);                                   // the import is written; every later write is held
    await importCsv(r);
    await r.engine.whenIdle();
    expect(r.engine.state.findings[0].state).toBe('confirmed');          // the screening went on in memory
    expect(r.engine.state.activity.filter(a => a.text.includes('could not be written'))).toHaveLength(1);   // said once, not on every step
    expect(onDisk(r).cases).toHaveLength(1);                             // the import reached the file
    expect(onDisk(r).findings).toEqual([]);                              // the screening had not, yet
    held = false;
    await pause(80);                                                     // the server tries again by itself
    expect(r.engine.state.activity.some(a => a.text === 'The state file can be written again. Nothing was lost.')).toBe(true);
    expect(onDisk(r)).toEqual(r.engine.state);
  });

  it('a job that waits with no worker is started when the page next asks for the state', async () => {
    const r = rig();
    await r.engine.start();
    const kick = r.engine.kick.bind(r.engine);
    r.engine.kick = () => undefined;                                     // a slip: the job is queued and nobody starts the worker
    await importCsv(r);
    await pause(10);
    expect(r.calls).toEqual([]);
    r.engine.kick = kick;
    r.engine.stateResponse();                                            // the page asks every second
    await r.engine.whenIdle();
    expect(r.engine.state.cases[0].screening.status).toBe('done');
  });
});

describe('a step that stops with an error nobody expected', () => {
  it('is started again by itself, with no restart', async () => {
    const r = rig();
    await r.engine.start();
    const list = r.engine.images.list.bind(r.engine.images);
    let once = true;
    r.engine.images.list = (caseId: string) => {
      if (once) {
        once = false;
        throw new Error('the disk did not answer');
      }
      return list(caseId);
    };
    await r.engine.importCase({ fileName: 'scan.pdf', source: 'pdf-image', pageImages: ['AAAA'] });
    await r.engine.whenIdle();
    expect(r.engine.state.cases[0].lines).toHaveLength(2);              // read on the second try
    const texts = r.engine.state.activity.map(a => a.text);
    expect(texts).toContain('A step stopped with an error. the disk did not answer');
    expect(texts).toContain('The step for scan.pdf is started again.');
  });

  it('a screening that keeps stopping is tried three times, left as interrupted, and "Screen again" picks it up', async () => {
    const r = rig();
    let broken = true;
    // An answer the engine cannot use stops the whole step, not only the model call.
    r.behaviour.screen = () => (broken ? (null as never) : { ok: true, suspected: false, result: screenResult([]) });
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    expect(r.calls).toEqual(['screen ONE', 'screen ONE', 'screen ONE']);            // the first try and two more
    expect(r.engine.state.jobs.map(j => [j.stage, j.status])).toEqual([['screen', 'failed'], ['screen', 'failed'], ['screen', 'failed']]);
    const c = r.engine.state.cases[0];
    expect(c.screening.status).toBe('interrupted');
    expect(c.screening.criteria.map(x => x.status)).toEqual(['waiting', 'waiting']);
    expect(r.engine.stateResponse().counts.historiesScreened).toBe(0);
    expect(r.engine.stateResponse().now.text).toBe('Idle');

    broken = false;
    r.engine.screenAgain('C0001');
    await r.engine.whenIdle();
    expect(r.engine.state.cases[0].screening.status).toBe('done');
    expect(r.engine.stateResponse().counts.historiesScreened).toBe(1);
  });

  it('an answer of the second check that cannot be read is never "not confirmed": the finding goes to the bell', async () => {
    const r = rig();
    r.behaviour.check = () => null as unknown as CheckResult;
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    const f = r.engine.state.findings[0];
    expect(f.state).toBe('confirmed');
    expect(f.check).toMatchObject({ completed: false, confirmed: false, lineIds: ['L001', 'L002'] });
    expect(r.engine.stateResponse().counts.bellBadge).toBe(1);
  });

  it('a check that keeps stopping never leaves the finding waiting: after three tries it goes to the bell, marked not completed', async () => {
    const r = rig();
    await r.engine.start();
    r.engine.state.cases.push({
      id: 'C0001', fileName: 'positive.csv', importedAt: '2026-11-18T00:00:00.000Z', source: 'csv',
      patient: { label: 'Fictional patient F-001' }, lines: [{ id: 'L001', text: '2026-08-08 | Xarelto 20 mg tablet' }],
      transcriptionConfirmed: true, parts: 1, screening: { status: 'done', criteria: [{ criterionId: 'ONE', status: 'suspected' }] }
    });
    r.engine.state.findings.push({ id: 'F0001', caseId: 'C0001', criterionId: 'ONE', state: 'suspected', possible: false, screen: screenResult(['L001']), seenByPharmacist: false });
    const stopped = (r.engine as unknown as { afterJobError(job: Job, e: unknown): void }).afterJobError.bind(r.engine);
    const job = (): Job => ({ id: 'J0009', stage: 'check', caseId: 'C0001', findingId: 'F0001', status: 'running' });

    stopped(job(), new Error('boom'));
    expect(r.engine.state.findings[0].state).toBe('suspected');
    expect(r.engine.state.jobs.filter(j => j.stage === 'check' && j.status === 'queued')).toHaveLength(1);   // queued again, no restart needed
    stopped(job(), new Error('boom'));
    stopped(job(), new Error('boom'));
    const f = r.engine.state.findings[0];
    expect(f.state).toBe('confirmed');
    expect(f.check).toMatchObject({ completed: false, confirmed: false, lineIds: ['L001'] });
    expect(f.check?.whatMatches).toBe('The second check did not finish, so this finding is shown without it. boom');
  });

  it('a letter that keeps stopping is built from the template when the criterion is known', async () => {
    const r = rig();
    r.behaviour.letter = () => null as never;
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    r.engine.decide('F0001', { action: 'accept' });
    await r.engine.whenIdle();
    expect(r.calls.filter(x => x === 'letter ONE')).toHaveLength(3);
    const letter = r.engine.state.letters[0];
    expect(letter.status).toBe('ready');
    expect(letter.body).toContain(`Criterion one: ${testCriterion.statement}`);
    expect(letter.body).toContain(`Source: ${testCriterion.source.credit}`);
    expect(letter.body).toContain('Fictional patient. No real person.');
    expect(letter.body).toContain('What a dispensing history cannot show');
    expect(letter.body).toContain(testCriterion.cannot_be_seen);
    expect(letter.body).toContain('Xarelto');
    expect(letter.body).toContain('Celebrex');
    expect(letter.body).not.toContain('Please write it by hand');
    expect(letter.body).not.toContain('Drafted by a local AI model');
    expect(letter.body.trimEnd().endsWith('Marwan Morsy\nPharmacy Manager\nPHA0002761764')).toBe(true);
    expect(letter.draft).toMatchObject({ origin: 'template', templateReason: 'error' });
  });

  it('a letter step that throws is built from the template when the criterion is known', async () => {
    const r = rig();
    r.behaviour.letter = () => { throw new Error('boom'); };
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    r.engine.decide('F0001', { action: 'accept' });
    await r.engine.whenIdle();
    expect(r.calls.filter(x => x === 'letter ONE')).toHaveLength(1);
    const letter = r.engine.state.letters[0];
    expect(letter.status).toBe('ready');
    expect(letter.body).toContain(testCriterion.statement);
    expect(letter.body).not.toContain('Please write it by hand');
    expect(letter.draft).toMatchObject({ origin: 'template', templateReason: 'error' });
    expect(letter.draft?.checkNotes[0]).toContain('boom');
  });

  it('a last-resort letter says to write it by hand when the criterion is not loaded', async () => {
    const r = rig();
    await r.engine.start();
    r.engine.state.cases.push({
      id: 'C0001', fileName: 'positive.csv', importedAt: '2026-11-18T00:00:00.000Z', source: 'csv',
      patient: { label: 'Fictional patient F-001' }, lines: [{ id: 'L001', text: '2026-08-08 | Xarelto 20 mg tablet' }],
      transcriptionConfirmed: true, parts: 1, screening: { status: 'done', criteria: [] }
    });
    r.engine.state.findings.push({
      id: 'F0009', caseId: 'C0001', criterionId: 'GONE', state: 'accepted', possible: false,
      screen: screenResult(['L001']), seenByPharmacist: true,
      decision: { action: 'accept', by: 'pharmacist', at: '2026-11-18T00:00:00.000Z' }
    });
    r.engine.state.letters.push({
      id: 'T0009', findingId: 'F0009', caseId: 'C0001', status: 'drafting',
      subject: '', body: '', editedByPharmacist: false, seenByPharmacist: false
    });
    const stopped = (r.engine as unknown as { afterJobError(job: Job, e: unknown): void }).afterJobError.bind(r.engine);
    const job = (): Job => ({ id: 'J0009', stage: 'letter', caseId: 'C0001', findingId: 'F0009', status: 'running' });
    stopped(job(), new Error('boom'));
    stopped(job(), new Error('boom'));
    stopped(job(), new Error('boom'));
    const letter = r.engine.state.letters[0];
    expect(letter.status).toBe('ready');
    expect(letter.body).toContain('Please write it by hand');
    expect(letter.body).toContain('Fictional patient. No real person.');
    expect(letter.body).not.toContain(testCriterion.statement);
    expect(letter.body.trimEnd().endsWith('Marwan Morsy\nPharmacy Manager\nPHA0002761764')).toBe(true);
    expect(letter.draft).toMatchObject({ origin: 'template', templateReason: 'error' });
  });
});

describe('a long history', () => {
  const cfg: LanternConfig = { ...testConfig, maxLinesPerCall: 10, overlapLines: 3 };

  function longCsv(rows: number): string {
    const out = ['patient_ref,patient_age,patient_sex,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber'];
    for (let i = 0; i < rows; i++) {
      out.push(`F-009,70,M,2026-${String((i % 9) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')},metformin,Diabex XR,1000 mg,tablet,60,4,Take ONE tablet twice a day,Dr F. Example`);
    }
    return out.join('\r\n');
  }

  it('is read part by part for every criterion, and each criterion gets its result at the end', async () => {
    const r = rig({ cfg, criteria: [ONE, TWO] });
    const order: string[] = [];
    const said: string[] = [];
    r.pipeline.screenHistory = async (_cfg, _patient, _lines, criteria, hooks) => {
      for (let p = 1; p <= 3; p++) {
        for (let c = 0; c < criteria.length; c++) {
          hooks.onStep?.({ part: p, parts: 3, criterion: c + 1, criteria: criteria.length });
          order.push(`part ${p} ${criteria[c].id}`);
          said.push(r.engine.stateResponse().now.text);
        }
      }
      const outcomes = criteria.map((criterion): Awaited<ReturnType<PipelineFns['screenCriterion']>> => criterion.id === 'ONE'
        ? { ok: true, suspected: true, result: { ...screenResult(['L002', 'L022']), listedLineIds: ['L002', 'L022'] } }
        : { ok: true, suspected: false, result: screenResult([]) });
      outcomes.forEach((outcome, c) => {
        hooks.onStep?.({ part: 0, parts: 3, criterion: c + 1, criteria: criteria.length });
        said.push(r.engine.stateResponse().now.text);
        hooks.onResult?.(c, outcome, 3.24);
      });
      return outcomes;
    };
    await r.engine.start();
    await r.engine.importCase({ fileName: 'long.csv', source: 'csv', csvText: longCsv(24) });
    await r.engine.whenIdle();

    // The parts are the outer loop: each part is read once and reused for the next criterion.
    expect(order).toEqual(['part 1 ONE', 'part 1 TWO', 'part 2 ONE', 'part 2 TWO', 'part 3 ONE', 'part 3 TWO']);
    expect(r.calls.filter(x => x.startsWith('screen'))).toEqual([]);     // not one criterion at a time
    expect(said[0]).toBe(`Mantle is screening: criterion 1 of 2 (long history, part 1 of 3). ${PASS_NOT_FINISHED}`);
    // The long reader stores no result until the end, so the count stays at the first criterion
    // until that result is written. The second criterion's parts are still "1 of 2".
    expect(said[3]).toBe(`Mantle is screening: criterion 1 of 2 (long history, part 2 of 3). ${PASS_NOT_FINISHED}`);
    expect(said[7]).toBe(`Mantle is screening: criterion 2 of 2 (long history, reading the listed lines together). ${PASS_NOT_FINISHED}`);
    const c = r.engine.state.cases[0];
    expect(c.parts).toBe(3);
    expect(c.screening.status).toBe('done');
    expect(c.screening.criteria.map(x => [x.status, x.seconds])).toEqual([['suspected', 3.2], ['clear', 3.2]]);
    expect(r.engine.state.findings[0]).toMatchObject({ criterionId: 'ONE', state: 'confirmed', screen: { listedLineIds: ['L002', 'L022'] } });
    expect(r.engine.state.activity[0].text).toBe(
      'History imported: long.csv, 24 lines. Screening is queued. It is long. Mantle reads it in 3 overlapping parts, then reads the lines that matter together.');
  });

  it('a criterion with no result after the long reading is "could not be screened", never clear', async () => {
    const r = rig({ cfg, criteria: [ONE, TWO] });
    r.pipeline.screenHistory = async (_cfg, _patient, _lines, _criteria, hooks) => {
      hooks.onResult?.(0, { ok: true, suspected: false, result: screenResult([]) }, 1);
      throw new Error('the reading stopped');
    };
    await r.engine.start();
    await r.engine.importCase({ fileName: 'long.csv', source: 'csv', csvText: longCsv(24) });
    await r.engine.whenIdle();
    const runs = r.engine.state.cases[0].screening.criteria;
    expect(runs.map(x => x.status)).toEqual(['clear', 'failed']);
    expect(runs[1].error).toContain('the reading stopped');
    expect(r.engine.stateResponse().counts.historiesScreened).toBe(0);
  });

  it('restarts a batched screening when an answer changes a later criterion', async () => {
    const r = rig({ cfg, criteria: [ONE, TWO] });
    const calls: string[][] = [];
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let call = 0;
    r.pipeline.screenHistory = async (_cfg, _patient, lines, criteria, hooks) => {
      const thisCall = call++;
      calls.push(lines.map(line => line.text));
      const outcomes = criteria.map(criterion => ({
        ok: true as const,
        suspected: false,
        result: { ...screenResult([]), reason: `${thisCall === 0 ? 'stale' : 'fresh'} ${criterion.id}` }
      }));
      if (thisCall === 0) {
        hooks.onStep?.({ part: 1, parts: 3, criterion: 1, criteria: criteria.length });
        await held;
      }
      outcomes.forEach((outcome, index) => {
        if (thisCall > 0 || index > 0) {
          hooks.onStep?.({ part: 0, parts: 3, criterion: index + 1, criteria: criteria.length });
        }
        hooks.onResult?.(index, outcome, 1);
      });
      return outcomes;
    };
    await r.engine.start();
    await r.engine.importCase({ fileName: 'long.csv', source: 'csv', csvText: longCsv(24) });
    const c = r.engine.state.cases[0];
    c.questions = [{
      id: 'Q0001', key: 'condition:counter fact', kind: 'condition', what: 'Counter fact',
      meets: 'the patient has it', criterionIds: ['TWO'], findingIds: [], source: 'possible', status: 'open',
      options: [
        { words: 'Yes', effect: 'meets' },
        { words: 'No', effect: 'does_not_meet' },
        { words: 'Not known', effect: 'unknown' }
      ],
      needsValue: false
    }];

    r.engine.answerQuestion(c.id, 'Q0001', { option: 'Yes' });
    release();
    await r.engine.whenIdle();

    expect(calls).toHaveLength(2);
    expect(calls[1].some(line => line.includes('CONDITION | Counter fact. The patient has this.'))).toBe(true);
    expect(c.screening.criteria.find(run => run.criterionId === 'TWO')).toMatchObject({
      status: 'clear', reason: 'fresh TWO'
    });
    expect(c.screening.status).toBe('done');
  });

  it('is screened one criterion at a time when the pipeline has no long-history step', async () => {
    const r = rig({ cfg, criteria: [ONE, TWO] });
    await r.engine.start();
    await r.engine.importCase({ fileName: 'long.csv', source: 'csv', csvText: longCsv(24) });
    await r.engine.whenIdle();
    expect(r.calls).toEqual(['screen ONE', 'screen TWO', 'check ONE']);
  });

  it('is refused in plain words when it is too long for the prototype, and is not screened in part', async () => {
    const r = rig();
    await r.engine.start();
    const { caseId } = await r.engine.importCase({ fileName: 'ten-years.csv', source: 'csv', csvText: longCsv(1001) });
    await r.engine.whenIdle();
    const c = r.engine.state.cases.find(x => x.id === caseId)!;
    expect(c.cannotAssess).toBe(
      'This history has 1001 lines. The prototype screens up to 1000 lines in one history. ' +
      'Import a shorter period of the same patient, for example the last two years.');
    expect(c.screening.status).toBe('not_started');
    expect(r.calls).toEqual([]);
    expect(r.engine.state.jobs).toEqual([]);
    // 1,000 lines are still taken.
    const ok = await r.engine.importCase({ fileName: 'long.csv', source: 'csv', csvText: longCsv(1000) });
    await r.engine.whenIdle();
    expect(r.engine.state.cases.find(x => x.id === ok.caseId)?.cannotAssess).toBeUndefined();
  });
});

describe('a scan: nothing is dropped without a word', () => {
  it('a page that gives no rows is shown to the pharmacist, and the case keeps the number of pages', async () => {
    const r = rig();
    r.behaviour.transcribe = image => image === 'BBBB'
      ? { ok: true, rows: [] }
      : { ok: true, rows: [image === 'AAAA' ? '2026-08-08 | Xarelto 20 mg tablet | qty 28' : '2026-09-08 | Xarelto 20 mg tablet | qty 28'] };
    await r.engine.start();
    await r.engine.importCase({ fileName: 'scan.pdf', source: 'pdf-image', pageImages: ['AAAA', 'BBBB', 'CCCC'] });
    await r.engine.whenIdle();
    const c = r.engine.state.cases[0];
    expect(c.pages).toBe(3);
    expect(c.lines.map(l => l.page)).toEqual([1, 3]);
    expect(c.scanNotes).toEqual(['Page 2: no rows were read. Look at the picture of page 2. If it holds supplies, do not confirm.']);
    const texts = r.engine.state.activity.map(a => a.text);
    expect(texts).toContain('Mantle read no rows from page 2 of scan.pdf. Please check that page against the paper before confirming.');
    expect(texts).toContain(
      'Mantle read 2 rows from 3 pages of the scan of scan.pdf (page 1: 1 row, page 2: no rows, page 3: 1 row). Read from a scan: please check the rows before screening.');
  });

  it('an overlong row from a scan keeps its directions and is not confirmed or screened until the pharmacist shortens it', async () => {
    const tail = 'TAKE WITH FOOD AT NIGHT';
    const row = `2026-08-08 | Xarelto 20 mg tablet | ${'x'.repeat(1000)} ${tail}`;
    const r = rig();
    let screened = '';
    r.pipeline.screenCriterion = async (_cfg, _patient, lines) => {
      screened = lines.map(line => line.text).join('\n');
      r.calls.push('screen ONE');
      return { ok: true, suspected: false, result: screenResult([]) };
    };
    r.behaviour.transcribe = () => ({ ok: true, rows: [row] });
    await r.engine.start();
    const { caseId } = await r.engine.importCase({ fileName: 'scan.pdf', source: 'pdf-image', pageImages: ['AAAA'] });
    await r.engine.whenIdle();
    const stored = r.engine.state.cases[0].lines[0].text;
    expect(stored).toContain(tail);
    expect(r.engine.state.cases[0].scanNotes?.some(note => note.includes('too long'))).toBe(true);
    await expectApiError(() => r.engine.confirmTranscription(caseId, {}), 409, 'too long');
    await expectApiError(() => r.engine.confirmTranscription(caseId, { rows: [row] }), 409, 'too long');
    expect(r.engine.state.cases[0].lines[0].text).toContain(tail);
    expect(r.engine.state.cases[0].transcriptionConfirmed).toBe(false);
    expect(r.calls.some(call => call.startsWith('screen'))).toBe(false);

    const fixed = `2026-08-08 | Xarelto 20 mg tablet | ${tail}`;
    r.engine.confirmTranscription(caseId, { rows: [fixed] });
    await r.engine.whenIdle();
    expect(r.engine.state.cases[0].lines[0].text).toBe(fixed);
    expect(screened).toContain(tail);
    expect(r.engine.state.cases[0].screening.status).toBe('done');
  });

  it('a row whose date cannot be read is marked, and the rows cannot be confirmed until it is corrected', async () => {
    const r = rig();
    r.behaviour.transcribe = () => ({
      ok: true,
      rows: ['2026-08-08 | Xarelto 20 mg tablet | qty 28', '21/O8/2026 | Celebrex 200 mg capsule | qty 30', 'Lipitor 40 mg tablet | qty 30']
    });
    await r.engine.start();
    const { caseId } = await r.engine.importCase({ fileName: 'scan.pdf', source: 'pdf-image', pageImages: ['AAAA'] });
    await r.engine.whenIdle();
    const c = r.engine.state.cases[0];
    expect(c.scanNotes).toEqual(['Line L002: the date "21/O8/2026" cannot be read.', 'Line L003 has no date.']);
    // The same rows in a CSV file give "Cannot assess". Here the pharmacist can still put them right.
    await expectApiError(() => r.engine.confirmTranscription(caseId, {}), 409, 'Line L002: the date "21/O8/2026" cannot be read.');
    expect(c.transcriptionConfirmed).toBe(false);
    expect(c.cannotAssess).toBeUndefined();
    expect(r.calls.some(x => x.startsWith('screen'))).toBe(false);

    r.engine.confirmTranscription(caseId, {
      rows: ['2026-08-08 | Xarelto 20 mg tablet | qty 28', '2026-08-21 | Celebrex 200 mg capsule | qty 30', '2026-08-06 | Lipitor 40 mg tablet | qty 30']
    });
    await r.engine.whenIdle();
    expect(r.engine.state.cases[0].screening.status).toBe('done');
    expect(r.engine.state.cases[0].scanNotes).toBeUndefined();
  });

  it('the page pictures can be fetched from the server until the rows are confirmed', async () => {
    const r = rig();
    const png = Buffer.from('not a real picture, only bytes').toString('base64');
    await r.engine.start();
    const { caseId } = await r.engine.importCase({ fileName: 'scan.pdf', source: 'pdf-image', pageImages: [png] });
    await r.engine.whenIdle();
    expect(r.engine.pageImage(caseId, 1)?.toString()).toBe('not a real picture, only bytes');
    expect(r.engine.pageImage(caseId, 2)).toBeNull();
    expect(r.engine.pageImage('C0404', 1)).toBeNull();
    expect(r.engine.pageImage(caseId, 0)).toBeNull();
    r.engine.confirmTranscription(caseId, {});
    expect(r.engine.pageImage(caseId, 1)).toBeNull();                    // removed once confirmed, as before
  });

  it('a scan the pharmacist will not confirm can be discarded: it is kept in the list, marked as not screened', async () => {
    const r = rig();
    await r.engine.start();
    const { caseId } = await r.engine.importCase({ fileName: 'blurred.pdf', source: 'pdf-image', pageImages: ['AAAA'] });
    await r.engine.whenIdle();
    const c = r.engine.discardScan(caseId);
    expect(c.cannotAssess).toBe('The pharmacist discarded this scan. Its rows were not confirmed, so it was not screened.');
    expect(fs.readdirSync(path.join(r.dir, 'images'))).toEqual([]);
    expect(r.engine.state.activity.some(a => a.text === 'The pharmacist discarded the scan blurred.pdf. It was not screened.')).toBe(true);
    await expectApiError(() => r.engine.confirmTranscription(caseId, {}), 409, 'cannot be assessed');
    const csv = await importCsv(r);
    await expectApiError(() => r.engine.discardScan(csv), 409, 'Only a scan');
  });
});

describe('a clean start while a model call is running', () => {
  it('stops that call at once', async () => {
    const r = rig();
    let signalSeen: AbortSignal | undefined;
    r.pipeline.checkFinding = (_cfg, _patient, _lines, _criterion, _screen, signal) => {
      signalSeen = signal;
      return new Promise<CheckResult>(resolve => signal?.addEventListener('abort', () => resolve(checkResult(false, false))));
    };
    await r.engine.start();
    await importCsv(r);
    await pause(20);
    expect(signalSeen?.aborted).toBe(false);
    await r.engine.reset();
    expect(signalSeen?.aborted).toBe(true);
    await r.engine.whenIdle();
    expect(r.engine.state.findings).toEqual([]);                         // the stopped call left nothing behind
    // The next import starts right away.
    r.pipeline.checkFinding = async () => checkResult(true);
    await importCsv(r);
    await r.engine.whenIdle();
    expect(r.engine.state.findings[0].state).toBe('confirmed');
  });
});

describe('a letter built from the template', () => {
  it.each([
    ['no_answer', 'Ogee did not answer, so the letter was built from the template.'],
    ['checks_failed', 'The model draft did not pass its checks, so the letter was built from the template.'],
    ['error', 'The draft could not be made, so the letter was built from the template.']
  ] as const)('says in the log what happened: %s', async (templateReason, words) => {
    const r = rig();
    r.behaviour.letter = () => ({ ...letterDraft(), origin: 'template', templateReason, checkNotes: ['x'] });
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    r.engine.decide('F0001', { action: 'accept' });
    await r.engine.whenIdle();
    expect(r.engine.state.activity.some(a => a.kind === 'letter' && a.text === `The letter for Criterion one on positive.csv is ready. ${words}`)).toBe(true);
  });
});

describe('a state that cannot be picked up', () => {
  it('is kept as a backup and a clean state is started: the server starts, it never crashes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-engine-'));
    made.push(dir);
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ version: 1, cases: [{}], findings: [], letters: [], jobs: [], activity: [] }));
    const r = rig({ dir });
    await r.engine.start();
    expect(r.engine.state.cases).toEqual([]);
    expect(r.engine.state.activity[0]).toMatchObject({ kind: 'error' });
    expect(r.engine.state.activity[0].text).toContain('The saved state could not be read. It was kept as state-unreadable-');
    expect(r.engine.stateResponse().now.text).toBe('Idle');
    expect(fs.readdirSync(path.join(dir, 'backups')).some(name => name.startsWith('state-unreadable-'))).toBe(true);
  });

  it('does not replace a damaged state file when the backup cannot be written', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-engine-'));
    made.push(dir);
    const original = '{"version":1,"cases":[';
    fs.writeFileSync(path.join(dir, 'state.json'), original);
    fs.writeFileSync(path.join(dir, 'backups'), 'not a directory');
    const r = rig({ dir });
    await r.engine.start();
    expect(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).toBe(original);
    expect(r.engine.state.activity.some(a => a.text.includes('left as it is'))).toBe(true);
  });
});

// ---------- the first ten, then further criteria in blocks (G06) ----------

function standIn(id: string): Criterion {
  return { ...testCriterion, id, label: `Criterion ${id}` };
}

function numbered(prefix: string, count: number): Criterion[] {
  return Array.from({ length: count }, (_, i) => standIn(`${prefix}${String(i + 1).padStart(2, '0')}`));
}

describe('the first ten are screened and checked before further criteria', () => {
  it('screens thirty criteria in blocks, and the checks of a block come before the next block', async () => {
    const ten = numbered('T', 10);
    const further = numbered('F', 20);
    const criteria = [...ten, ...further];
    const suspect = new Set(['T01', 'F05', 'F10']);
    const r = rig({ criteria, activeIds: ten.map(c => c.id), cfg: { ...testConfig, screenBlockSize: 5 } });
    const texts: string[] = [];
    r.behaviour.screen = criterion => {
      texts.push(r.engine.stateResponse().now.text);
      return suspect.has(criterion.id)
        ? { ok: true, suspected: true, result: screenResult(['L002']) }
        : { ok: true, suspected: false, result: screenResult([]) };
    };
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();

    const screen = (id: string) => `screen ${id}`;
    const ids = (list: Criterion[], from: number, to: number): string[] =>
      list.slice(from - 1, to).map(c => screen(c.id));
    expect(r.calls).toEqual([
      ...ids(ten, 1, 10),
      'check T01',
      ...ids(further, 1, 5),
      'check F05',
      ...ids(further, 6, 10),
      'check F10',
      ...ids(further, 11, 20)
    ]);
    expect(texts).toEqual(Array.from({ length: 30 }, (_, i) => `Mantle is screening: criterion ${i + 1} of 30. ${PASS_NOT_FINISHED}`));
    const runs = r.engine.state.cases[0].screening.criteria;
    expect(runs).toHaveLength(30);
    expect(runs.every(run => run.status === 'clear' || run.status === 'suspected')).toBe(true);
    expect(r.engine.state.cases[0].screening.status).toBe('done');
    expect(r.engine.state.jobs.every(job => job.status === 'done')).toBe(true);
    expect(r.engine.criteria.map(c => c.id)).toEqual(criteria.map(c => c.id));
    expect(r.engine.firstTenIds).toEqual(ten.map(c => c.id));
  });

  it('screens one history against 413 criteria, and the state file can be read back', async () => {
    const ten = numbered('T', 10);
    const further = numbered('F', 403);
    const criteria = [...ten, ...further];
    const r = rig({ criteria, activeIds: ten.map(c => c.id) });
    const texts: string[] = [];
    r.behaviour.screen = () => {
      texts.push(r.engine.stateResponse().now.text);
      return { ok: true, suspected: false, result: screenResult([]) };
    };
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();

    expect(r.calls).toHaveLength(413);
    expect(texts).toEqual(Array.from({ length: 413 }, (_, i) => `Mantle is screening: criterion ${i + 1} of 413. ${PASS_NOT_FINISHED}`));
    const runs = r.engine.state.cases[0].screening.criteria;
    expect(runs).toHaveLength(413);
    expect(runs.every(run => run.status === 'clear')).toBe(true);
    expect(r.engine.state.cases[0].screening.status).toBe('done');
    const size = fs.statSync(r.store.file).size;
    console.log(`STATE SIZE one history against 413 stand-in criteria: ${size} bytes`);
    const reread = new StateStore(r.dir);
    reread.load();
    expect(reread.state.cases[0].screening.criteria).toHaveLength(413);
    expect(reread.state.cases[0].screening.status).toBe('done');
  }, 120000);

  it('screens the ten of both histories before the further criteria of either', async () => {
    const r = rig({
      criteria: [ONE, TWO, THREE, FOUR],
      activeIds: ['ONE', 'TWO'],
      cfg: { ...testConfig, screenBlockSize: 5 }
    });
    r.behaviour.screen = async criterion => {
      await new Promise(resolve => setTimeout(resolve, 5));
      return criterion.id === 'ONE' || criterion.id === 'THREE'
        ? { ok: true, suspected: true, result: screenResult(['L001', 'L002']) }
        : { ok: true, suspected: false, result: screenResult([]) };
    };
    await r.engine.start();
    await importCsv(r, 'first.csv');
    await importCsv(r, 'second.csv');
    await r.engine.whenIdle();
    expect(r.calls).toEqual([
      'screen ONE', 'screen TWO', 'screen ONE', 'screen TWO',
      'check ONE', 'check ONE',
      'screen THREE', 'screen FOUR', 'check THREE',
      'screen THREE', 'screen FOUR', 'check THREE'
    ]);
  });

  it('writes the letter for an accepted finding before the next further criterion is screened', async () => {
    const FUR1: Criterion = { ...testCriterion, id: 'FUR1', label: 'Further one' };
    const FUR2: Criterion = { ...testCriterion, id: 'FUR2', label: 'Further two' };
    const r = rig({ criteria: [ONE, FUR1, FUR2], activeIds: ['ONE'], cfg: { ...testConfig, screenBlockSize: 1 } });
    r.behaviour.screen = criterion => {
      if (criterion.id === 'FUR1') r.engine.decide('F0001', { action: 'accept' });
      return criterion.id === 'ONE'
        ? { ok: true, suspected: true, result: screenResult(['L001', 'L002']) }
        : { ok: true, suspected: false, result: screenResult([]) };
    };
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    expect(r.calls).toEqual(['screen ONE', 'check ONE', 'screen FUR1', 'letter ONE', 'screen FUR2']);
    expect(r.engine.state.letters[0]).toMatchObject({ status: 'ready' });
    expect(r.engine.state.cases[0].screening.status).toBe('done');
  });

  it('marks a further criterion that could not be screened, and the run goes on', async () => {
    const r = rig({ criteria: [ONE, THREE], activeIds: ['ONE'] });
    r.behaviour.screen = criterion => criterion.id === 'THREE'
      ? { ok: false, error: 'Tried twice. The model took too long to answer.' }
      : { ok: true, suspected: false, result: screenResult([]) };
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    expect(r.calls).toEqual(['screen ONE', 'screen THREE']);
    expect(r.engine.state.cases[0].screening.criteria.map(run => run.status)).toEqual(['clear', 'failed']);
    expect(r.engine.state.cases[0].screening.status).toBe('done');
    expect(r.engine.state.cases[0].screening.criteria[1].error).toContain('Could not be screened.');
    expect(r.engine.state.findings).toEqual([]);
  });

  it('a stop during further criteria does not screen the ten again', async () => {
    const ten = numbered('T', 10);
    const further = ['F1', 'F2', 'F3', 'F4'].map(standIn);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-engine-'));
    made.push(dir);
    const state = emptyState();
    state.cases.push({
      id: 'C0001', fileName: 'positive.csv', importedAt: '2026-11-18T00:00:00.000Z', source: 'csv',
      patient: { label: 'Fictional patient F-001' },
      lines: [{ id: 'L001', text: '2026-08-08 | Xarelto 20 mg tablet' }, { id: 'L002', text: '2026-08-21 | Celebrex 200 mg capsule' }],
      transcriptionConfirmed: true, parts: 1,
      screening: {
        status: 'running', startedAt: '2026-11-18T00:00:01.000Z',
        criteria: [
          ...ten.map(criterion => ({ criterionId: criterion.id, status: 'clear' as const })),
          { criterionId: 'F1', status: 'clear' as const },
          { criterionId: 'F2', status: 'running' as const },
          { criterionId: 'F3', status: 'waiting' as const },
          { criterionId: 'F4', status: 'waiting' as const }
        ]
      }
    });
    state.jobs.push({ id: 'J0001', stage: 'screen', caseId: 'C0001', status: 'running', detail: 'criterion 12 of 14' });
    const before = new StateStore(dir);
    before.state = state;
    before.save();

    const r = rig({ dir, criteria: [...ten, ...further], activeIds: ten.map(c => c.id) });
    await r.engine.start();
    await r.engine.whenIdle();
    expect(r.calls).toEqual(['screen F2', 'screen F3', 'screen F4']);
    const runs = r.engine.state.cases[0].screening.criteria;
    expect(runs.slice(0, 11).every(run => run.status === 'clear')).toBe(true);
    expect(runs.slice(11).map(run => run.status)).toEqual(['clear', 'clear', 'clear']);
    expect(r.engine.state.cases[0].screening.status).toBe('done');
  });
});

describe('criteria with a listed medicine are screened first', () => {
  function med(id: string, ingredient: string, brand: string, ask?: 'always'): Criterion {
    return {
      ...testCriterion,
      id,
      label: id,
      medicine_groups: [{
        key: 'A',
        name: ingredient,
        ingredients: [ingredient],
        brands: { [ingredient]: [brand] }
      }],
      ...(ask ? {
        needs_facts: [{
          kind: 'condition' as const,
          what: 'A fact the record does not show',
          meets: 'it is recorded',
          ask_when: ask
        }]
      } : {})
    };
  }

  const criteria = [
    med('NONE-TEN', 'metformin', 'Diaformin'),
    med('ASK', 'codeine', 'Panadeine', 'always'),
    med('LITH', 'lithium', 'Lithicarb'),
    med('NONE-FUR', 'aspirin', 'Aspro'),
    med('XAR', 'rivaroxaban', 'Xarelto'),
    med('CEL', 'celecoxib', 'Celebrex')
  ];

  const threeCsv = [
    'patient_ref,patient_age,patient_sex,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber',
    'F-001,72,F,2026-08-08,rivaroxaban,Xarelto,20 mg,tablet,28,5,one daily,Dr A. Example',
    'F-001,72,F,2026-08-21,celecoxib,Celebrex,200 mg,capsule,30,2,one daily,Dr A. Example',
    'F-001,72,F,2026-08-22,lithium,Lithicarb,450 mg,tablet,100,2,one daily,Dr A. Example'
  ].join('\r\n');

  it('screens the three listed medicines first, then an answered ask-when question, then the rest, and leaves none out', async () => {
    const r = rig({ criteria, activeIds: ['NONE-TEN', 'XAR'], cfg: { ...testConfig, screenBlockSize: 20 } });
    const texts: string[] = [];
    r.behaviour.screen = () => {
      texts.push(r.engine.stateResponse().now.text);
      return { ok: true, suspected: false, result: screenResult([]) };
    };
    await r.engine.start();
    await r.engine.importCase({ fileName: 'three.csv', source: 'csv', csvText: threeCsv });
    await r.engine.whenIdle();

    expect(r.calls).toEqual(['screen XAR', 'screen LITH', 'screen CEL', 'screen NONE-TEN', 'screen NONE-FUR']);
    expect(texts[0]).toBe(`Mantle is screening: criterion 1 of 6. ${PASS_NOT_FINISHED}`);
    expect(texts[4]).toBe(`Mantle is screening: criterion 5 of 6. ${PASS_NOT_FINISHED}`);
    const asked = r.engine.state.cases[0].questions?.find(item => item.criterionIds.includes('ASK'));
    expect(asked?.status).toBe('open');
    r.engine.answerQuestion(r.engine.state.cases[0].id, asked?.id ?? '', { option: 'Yes' });
    await r.engine.whenIdle();

    expect(r.calls.filter(call => call.startsWith('screen'))).toEqual([
      'screen XAR', 'screen LITH', 'screen CEL', 'screen NONE-TEN', 'screen NONE-FUR', 'screen ASK'
    ]);
    const runs = r.engine.state.cases[0].screening.criteria;
    expect(runs.map(run => run.criterionId)).toEqual(criteria.map(item => item.id));
    expect(runs.every(run => run.status === 'clear')).toBe(true);
    const line = r.engine.state.cases[0].lines.find(item => item.text.includes('pharmacist at the counter'));
    expect(line?.text).toContain('| CONDITION | A fact the record does not show.');
    expect(line?.text).not.toContain('| CONDITION | Yes.');
    expect(asked?.answer?.words).toBe('Yes');
  });

  it('a stop in the middle goes on where it was and does not screen a finished criterion again', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-engine-'));
    made.push(dir);
    const state = emptyState();
    state.cases.push({
      id: 'C0001', fileName: 'three.csv', importedAt: '2026-11-19T00:00:00.000Z', source: 'csv',
      patient: { label: 'Fictional patient F-001', age: 72 },
      lines: [
        { id: 'L001', text: '2026-08-08 | Xarelto 20 mg tablet' },
        { id: 'L002', text: '2026-08-21 | Celebrex 200 mg capsule' },
        { id: 'L003', text: '2026-08-22 | Lithicarb 450 mg tablet' }
      ],
      transcriptionConfirmed: true, parts: 1,
      questions: [{
        id: 'Q0001',
        key: 'condition\na fact the record does not show',
        kind: 'condition',
        what: 'A fact the record does not show',
        meets: 'it is recorded',
        criterionIds: ['ASK'],
        findingIds: [],
        source: 'patient',
        status: 'open',
        options: [
          { words: 'Yes', effect: 'meets' },
          { words: 'No', effect: 'does_not_meet' },
          { words: 'Not known', effect: 'unknown' }
        ],
        needsValue: false
      }],
      screening: {
        status: 'running', startedAt: '2026-11-19T00:00:01.000Z',
        criteria: [
          { criterionId: 'NONE-TEN', status: 'waiting' },
          { criterionId: 'ASK', status: 'waiting' },
          { criterionId: 'LITH', status: 'running' },
          { criterionId: 'NONE-FUR', status: 'waiting' },
          { criterionId: 'XAR', status: 'clear' },
          { criterionId: 'CEL', status: 'waiting' }
        ]
      }
    });
    state.jobs.push({ id: 'J0001', stage: 'screen', caseId: 'C0001', status: 'running', detail: 'criterion 2 of 6' });
    const before = new StateStore(dir);
    before.state = state;
    before.save();

    const r = rig({ dir, criteria, activeIds: ['NONE-TEN', 'XAR'], cfg: { ...testConfig, screenBlockSize: 20 } });
    r.behaviour.screen = () => ({ ok: true, suspected: false, result: screenResult([]) });
    await r.engine.start();
    await r.engine.whenIdle();

    expect(r.calls).toEqual(['screen LITH', 'screen CEL', 'screen NONE-TEN', 'screen NONE-FUR']);
    const runs = r.engine.state.cases[0].screening.criteria;
    expect(runs.find(run => run.criterionId === 'XAR')?.status).toBe('clear');
    expect(runs.find(run => run.criterionId === 'ASK')?.status).toBe('waiting');
    expect(runs.filter(run => run.criterionId !== 'ASK').every(run => run.status === 'clear')).toBe(true);
    expect(r.engine.state.cases[0].screening.status).not.toBe('done');
  });
});

describe('the demo clock', () => {
  it('refuses a number that is not a whole number of days and changes nothing', async () => {
    const r = rig();
    await r.engine.start();
    await expectApiError(() => r.engine.setDemoClock({ days: -1 }), 400, 'whole number');
    await expectApiError(() => r.engine.setDemoClock({}), 400, 'whole number');
    expect(r.engine.stateResponse().now.text).toBe('Idle');
    expect(r.engine.stateResponse().serverTime).toBe('2026-11-18T01:00:00.000Z');
    expect(fs.existsSync(path.join(r.dir, 'demo-clock.json'))).toBe(false);
  });

  it('two letters, a reply, and the clock eight days ahead', async () => {
    const r = rig();
    await r.engine.start();
    await importCsv(r, 'one.csv');
    await importCsv(r, 'two.csv');
    await r.engine.whenIdle();
    expect(r.engine.state.findings.map(f => f.id)).toEqual(['F0001', 'F0002']);

    r.engine.decide('F0001', { action: 'accept' });
    r.engine.decide('F0002', { action: 'accept' });
    await r.engine.whenIdle();
    const firstSent = r.engine.previewLetter('T0001');
    const secondSent = r.engine.previewLetter('T0002');
    r.engine.markSent('T0001', { by: 'print', previewToken: firstSent.previewToken });
    r.engine.markSent('T0002', { by: 'email', previewToken: secondSent.previewToken });
    r.engine.recordReply('T0001', { outcome: 'will_review', note: 'Seen next week.' });
    r.engine.closeLetter('T0001');

    const moved = r.engine.setDemoClock({ days: 8 });
    const s = r.engine.stateResponse();
    expect(s.state.letters.map(l => l.status)).toEqual(['closed', 'sent']);
    expect(s.counts).toMatchObject({ lettersSent: 2, repliesRecorded: 1, closed: 1, overdue: 1 });
    expect(s.now.text).toBe('Idle Demo clock: 8 days ahead.');
    expect(s.serverTime).toBe('2026-11-26T01:00:00.000Z');
    expect(moved.serverTime).toBe(s.serverTime);
    expect(s.state.activity.some(a => a.text === 'The demo clock was moved 8 days ahead.')).toBe(true);

    const again = new Engine({
      cfg: testConfig, store: r.store, pipeline: r.pipeline,
      images: new PageImages(path.join(r.dir, 'images')),
      loadCriteria: async () => [ONE, TWO],
      now: () => r.clock.now
    });
    expect(again.stateResponse().serverTime).toBe('2026-11-26T01:00:00.000Z');
    expect(again.stateResponse().now.text).toBe('Idle Demo clock: 8 days ahead.');

    r.engine.setDemoClock({ days: 1 });
    expect(r.engine.stateResponse().now.text).toBe('Idle Demo clock: 1 day ahead.');
    const lines = r.engine.state.activity.length;
    r.engine.setDemoClock({ days: 1 });
    expect(r.engine.state.activity).toHaveLength(lines);

    await r.engine.reset();
    expect(r.engine.stateResponse().now.text).toBe('Idle');
    expect(r.engine.stateResponse().serverTime).toBe('2026-11-18T01:00:00.000Z');
    expect(JSON.parse(fs.readFileSync(path.join(r.dir, 'demo-clock.json'), 'utf8'))).toEqual({ days: 0 });
    expect(r.engine.state.activity.map(a => a.text)[0]).toBe('The demo clock is back to the real date.');
  });
});

describe('one letter for the patient', () => {
  const SAME: Criterion = { ...TWO, urgency: 'same_day' };
  const POSS: Criterion = { ...THREE, label: 'Criterion three' };

  function draftFor(r: Rig, finding: Finding): LetterDraft {
    const criterion = finding.criterionId === 'TWO' ? SAME : finding.criterionId === 'THREE' ? POSS : ONE;
    const cited = finding.criterionId === 'TWO'
      ? [{ id: 'B1', text: '2026-08-02 | Beta 5 mg tablet | qty 30 | Dr A. One' }]
      : finding.criterionId === 'THREE'
        ? [{ id: 'G1', text: '2026-08-03 | Gamma 1 mg tablet | qty 28 | Dr B. Two' }]
        : [
            { id: 'A1', text: '2026-08-01 | Alpha 10 mg tablet | qty 28 | Dr A. One' },
            { id: 'A2', text: '2026-09-01 | Alpha 10 mg tablet | qty 28 | Dr A. One' }
          ];
    const subject = finding.criterionId === 'TWO' ? 'Beta today' : finding.criterionId === 'THREE' ? 'Possible finding, gamma' : 'Alpha review';
    const patient = r.engine.state.cases.find(item => item.id === finding.caseId)?.patient ?? { label: 'Fictional patient' };
    const origin = finding.criterionId === 'TWO' ? 'template' as const : 'model' as const;
    const body = assembleLetter({
      cfg: testConfig, patient, criterion, cited,
      paragraphs: {
        subject,
        finding_paragraph: `The finding for ${subject}.`,
        evidence_paragraph: `The supplies for ${subject} are listed below.`,
        request_paragraph: `Please review ${subject}.`
      },
      origin, when: new Date(2026, 10, 18, 9, 30),
      missingFacts: finding.criterionId === 'THREE' ? ['eGFR'] : undefined
    });
    return { subject, body, origin, checkNotes: [], model: 'lantern-letter', at: '2026-11-18T00:01:00.000Z', seconds: 1 };
  }

  function arm(r: Rig): { id: string; bytes: string }[] {
    const sent: { id: string; bytes: string }[] = [];
    const real = r.pipeline.draftLetter.bind(r.pipeline);
    r.pipeline.draftLetter = async (cfg, patient, lines, criterion, finding, signal) => {
      const cited = linesById(lines, citedLineIds(finding));
      sent.push({
        id: finding.id,
        bytes: JSON.stringify(letterMessages(patient, criterion, finding, cited, lines))
      });
      expect(criterion.id).toBe(finding.criterionId);
      return real(cfg, patient, lines, criterion, finding, signal);
    };
    r.behaviour.screen = () => ({ ok: true, suspected: true, result: screenResult(['L001', 'L002']) });
    r.behaviour.letter = finding => draftFor(r, finding);
    return sent;
  }

  async function threeFindings(r: Rig): Promise<void> {
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    const ids = ['ONE', 'TWO', 'THREE'].map(id => r.engine.state.findings.find(f => f.criterionId === id)!.id);
    r.engine.decide(ids[0], { action: 'accept' });
    r.engine.decide(ids[1], { action: 'accept' });
    r.engine.decide(ids[2], { action: 'accept' });
    await r.engine.whenIdle();
  }

  it('joins three accepted findings into one letter, and the counts count letters', async () => {
    const r = rig({ criteria: [ONE, SAME, POSS] });
    const sent = arm(r);
    await threeFindings(r);

    expect(r.engine.state.letters).toHaveLength(1);
    const letter = r.engine.state.letters[0];
    const ids = ['ONE', 'TWO', 'THREE'].map(id => r.engine.state.findings.find(f => f.criterionId === id)!.id);
    expect(letterFindingIds(letter)).toEqual(ids);
    expect(letter.status).toBe('ready');
    expect(letter.subject).toBe('3 points for this patient');
    expect(letter.body.split('Dear Doctor,').length - 1).toBe(1);
    expect(letter.body.split('Yours sincerely,').length - 1).toBe(1);
    expect(letter.body.split('PHA0002761764').length - 1).toBe(1);
    expect(letter.body.startsWith(testConfig.pharmacy.name)).toBe(true);
    expect(letter.body).toContain('1. Alpha review');
    expect(letter.body).toContain('2. Beta today');
    expect(letter.body).toContain('3. Possible finding, gamma');
    expect(letter.body).toContain('Please review Alpha review.');
    expect(letter.body).toContain('Please review Beta today.');
    expect(letter.body).toContain('Please review Possible finding, gamma.');
    const dear = letter.body.indexOf('Dear Doctor,');
    expect(letter.body.slice(0, dear)).toContain('Point 2: Beta today');
    expect(letter.body.slice(0, dear)).not.toContain('The record we hold does not show');
    expect(letter.body.indexOf('3. Possible finding, gamma')).toBeLessThan(letter.body.indexOf('The record we hold does not show: eGFR.'));
    expect(letter.body).toContain('To: Dr A. One');
    expect(letter.body).not.toContain(testConfig.doctor.practice);
    expect(letter.body).toContain(MIXED_WRITING_LINE);
    expect(letter.body).not.toContain('Drafted by a local AI model. Read by the pharmacist before sending.');
    expect(letter.points?.map(point => point.draft?.subject)).toEqual(['Alpha review', 'Beta today', 'Possible finding, gamma']);
    expect(r.calls.filter(call => call.startsWith('letter'))).toEqual(['letter ONE', 'letter TWO', 'letter THREE']);
    expect(sent.map(item => item.id)).toEqual(ids);
    const history = r.engine.state.cases[0];
    const modelLines = linesForModels(history.lines);
    for (const finding of r.engine.state.findings) {
      const criterion = finding.criterionId === 'TWO' ? SAME : finding.criterionId === 'THREE' ? POSS : ONE;
      const bytes = JSON.stringify(letterMessages(history.patient, criterion, finding, linesById(modelLines, citedLineIds(finding)), modelLines));
      expect(sent.find(item => item.id === finding.id)?.bytes).toBe(bytes);
      expect(bytes).not.toContain('numbered below');
    }
    expect(r.engine.state.activity.some(a => a.kind === 'decision' && a.text.includes('next letter'))).toBe(false);
    expect(r.engine.stateResponse().counts).toMatchObject({ accepted: 3, lettersReady: 1, lettersSent: 0 });

    const case2 = await importCsv(r, 'two.csv');
    await r.engine.whenIdle();
    const extra = r.engine.state.findings.find(f => f.caseId === case2 && f.criterionId === 'ONE')!;
    r.engine.decide(extra.id, { action: 'accept' });
    await r.engine.whenIdle();
    expect(r.engine.state.letters).toHaveLength(2);
    expect(r.engine.state.letters[1].subject).toBe('Alpha review');
    expect(r.engine.state.letters[1].findingIds).toEqual([extra.id]);
    expect(r.engine.stateResponse().counts).toMatchObject({ accepted: 4, lettersReady: 2, lettersSent: 0 });

    const preview = r.engine.previewLetter('T0001');
    const stripped = preview.text
      .replaceAll(MIXED_WRITING_LINE, '')
      .replaceAll('PHA0002761764', '')
      .replaceAll('Yours sincerely,', '');
    r.engine.editLetter('T0001', { subject: letter.subject, body: stripped, expectedRevision: 0 });
    expect(r.engine.state.letters[0].previewedAt).toBeUndefined();
    expect(r.engine.state.letters[0].previewHash).toBeUndefined();
    expect(r.engine.state.letters[0].body).toContain(MIXED_WRITING_LINE);
    expect(r.engine.state.letters[0].body).toContain('PHA0002761764');
    expect(r.engine.state.letters[0].body).toContain('Yours sincerely,');
    expect(r.engine.state.letters[0].body.split('PHA0002761764').length - 1).toBe(1);

    r.engine.agree('T0001', {});
    const sentPreview = r.engine.previewLetter('T0001');
    r.engine.markSent('T0001', { by: 'print', previewToken: sentPreview.previewToken });
    await expectApiError(
      () => r.engine.recordReply('T0001', { outcome: 'will_review', points: [{ findingId: 'F9999', outcome: 'changed' }] }),
      400, 'not on this letter'
    );
    expect(r.engine.state.letters[0].reply).toBeUndefined();
    r.engine.recordReply('T0001', {
      outcome: 'will_review', note: ' Seen. ',
      points: [
        { findingId: ids[0], outcome: 'will_review' },
        { findingId: ids[1], outcome: 'changed', note: ' Beta stopped. ' }
      ]
    });
    expect(r.engine.state.letters[0].reply).toEqual({
      at: '2026-11-18T01:00:00.000Z', outcome: 'will_review', note: 'Seen.',
      points: [{ findingId: ids[1], outcome: 'changed', note: 'Beta stopped.' }]
    });
    expect(r.engine.state.activity.some(a => a.text.includes("The doctor's reply to letter T0001 was recorded: the doctor will review the patient. One point differs"))).toBe(true);
    r.engine.closeLetter('T0001');
    expect(r.engine.state.letters[0].status).toBe('closed');
    expect(r.engine.stateResponse().counts).toMatchObject({
      accepted: 4, lettersReady: 1, lettersSent: 1, repliesRecorded: 1, closed: 1
    });

    const reread = new StateStore(r.dir);
    reread.load();
    expect(reread.state.letters).toEqual(r.engine.state.letters);

    const next = rig({ dir: r.dir, criteria: [ONE, SAME, POSS] });
    await next.engine.start();
    await next.engine.whenIdle();
    expect(next.engine.state.letters).toHaveLength(2);
    expect(letterFindingIds(next.engine.state.letters[0])).toEqual(ids);
    expect(next.engine.state.letters[0].reply?.points).toEqual([{ findingId: ids[1], outcome: 'changed', note: 'Beta stopped.' }]);
    expect(next.calls.filter(call => call.startsWith('letter'))).toEqual([]);
  });

  it('will not agree, preview or send while a point is still being written', async () => {
    const r = rig({ criteria: [ONE, SAME, POSS] });
    let release: (value: LetterDraft) => void = () => undefined;
    arm(r);
    r.behaviour.letter = finding => finding.criterionId === 'THREE'
      ? new Promise<LetterDraft>(resolve => { release = resolve; })
      : draftFor(r, finding);
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    const ids = ['ONE', 'TWO', 'THREE'].map(id => r.engine.state.findings.find(f => f.criterionId === id)!.id);
    r.engine.decide(ids[0], { action: 'accept' });
    r.engine.decide(ids[1], { action: 'accept' });
    r.engine.decide(ids[2], { action: 'accept' });
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(r.engine.state.letters).toHaveLength(1);
    expect(r.engine.state.letters[0].status).toBe('drafting');
    expect(r.engine.state.letters[0].body).toContain('Being written');
    await expectApiError(() => r.engine.agree('T0001', {}), 409, 'still being written');
    await expectApiError(() => r.engine.previewLetter('T0001'), 409, 'still being written');
    await expectApiError(() => r.engine.markSent('T0001', { by: 'print' }), 409, 'still being written');
    release(draftFor(r, r.engine.state.findings.find(f => f.id === ids[2])!));
    await r.engine.whenIdle();
    expect(r.engine.state.letters[0].status).toBe('ready');
    expect(r.engine.state.letters[0].body).not.toContain('Being written');
    expect(r.engine.state.letters[0].body).toContain('Please review Possible finding, gamma.');
  });

  it('starts the next letter when a finding is accepted after the letter was sent', async () => {
    const r = rig({ criteria: [ONE, SAME, POSS] });
    arm(r);
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    const first = r.engine.state.findings.find(f => f.criterionId === 'ONE')!.id;
    r.engine.decide(first, { action: 'accept' });
    await r.engine.whenIdle();
    const sentPreview = r.engine.previewLetter('T0001');
    r.engine.markSent('T0001', { by: 'email', previewToken: sentPreview.previewToken });
    const kept = r.engine.state.letters[0].body;
    const second = r.engine.state.findings.find(f => f.criterionId === 'TWO')!.id;
    const third = r.engine.state.findings.find(f => f.criterionId === 'THREE')!.id;
    r.engine.decide(second, { action: 'accept' });
    r.engine.decide(third, { action: 'accept' });
    await r.engine.whenIdle();
    expect(r.engine.state.letters).toHaveLength(2);
    expect(r.engine.state.letters[0].body).toBe(kept);
    expect(r.engine.state.letters[0].status).toBe('sent');
    expect(r.engine.state.letters[1]).toMatchObject({ afterSent: true, status: 'ready', findingId: second });
    expect(letterFindingIds(r.engine.state.letters[1])).toEqual([second, third]);
    expect(r.engine.state.letters[1].body).toContain('2. Possible finding, gamma');
    expect(r.engine.state.activity.some(a => a.text.includes('This is the next letter for this patient.'))).toBe(true);
    expect(r.engine.stateResponse().counts).toMatchObject({ accepted: 3, lettersReady: 1, lettersSent: 1 });
  });

  it('loads an old state of several letters for one patient as one letter and drafts nothing again', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-engine-'));
    made.push(dir);
    const patient = { label: 'Fictional patient F-001', age: 72, sex: 'F' };
    const one = assembleLetter({
      cfg: testConfig, patient, criterion: ONE,
      cited: [{ id: 'A1', text: '2026-08-01 | Alpha 10 mg tablet | qty 28 | Dr A. One' }],
      paragraphs: {
        subject: 'Alpha review', finding_paragraph: 'The finding for alpha.',
        evidence_paragraph: 'The supplies for alpha.', request_paragraph: 'Please review alpha.'
      },
      origin: 'model', when: new Date(2026, 10, 18, 9, 30)
    });
    const two = assembleLetter({
      cfg: testConfig, patient, criterion: SAME,
      cited: [{ id: 'B1', text: '2026-08-02 | Beta 5 mg tablet | qty 30 | Dr A. One' }],
      paragraphs: {
        subject: 'Beta today', finding_paragraph: 'The finding for beta.',
        evidence_paragraph: 'The supplies for beta.', request_paragraph: 'Please review beta today.'
      },
      origin: 'template', when: new Date(2026, 10, 18, 9, 30)
    });
    const letter = (id: string, findingId: string, subject: string, body: string, origin: 'model' | 'template'): Letter => ({
      id, findingId, caseId: 'C0001', status: 'ready', subject, body,
      draft: { subject, body, origin, checkNotes: [], model: 'lantern-letter', at: '2026-11-18T00:01:00.000Z', seconds: 1 },
      editedByPharmacist: false, seenByPharmacist: true
    });
    const prep = new StateStore(dir);
    prep.load();
    prep.state = {
      version: 1,
      cases: [{
        id: 'C0001', fileName: 'old.csv', importedAt: '2026-11-18T00:00:00.000Z', source: 'csv', patient,
        lines: [{ id: 'L001', text: '2026-08-01 | Alpha 10 mg tablet | qty 28 | Dr A. One' }],
        transcriptionConfirmed: true, parts: 1, screening: { status: 'done', criteria: [] }
      }],
      findings: [],
      letters: [
        letter('T0001', 'F0001', 'Alpha review', one, 'model'),
        letter('T0002', 'F0002', 'Beta today', two, 'template')
      ],
      jobs: [], activity: [], issued: { C: 1, F: 2, T: 2, J: 0 }
    };
    prep.save();

    const r = rig({ dir, criteria: [ONE, SAME] });
    await r.engine.start();
    await r.engine.whenIdle();
    expect(r.calls.filter(call => call.startsWith('letter'))).toEqual([]);
    expect(r.engine.state.letters).toHaveLength(1);
    expect(letterFindingIds(r.engine.state.letters[0])).toEqual(['F0001', 'F0002']);
    expect(r.engine.state.letters[0].body).toContain('Please review alpha.');
    expect(r.engine.state.letters[0].body).toContain('Please review beta today.');
    expect(r.engine.state.letters[0].body.split('Dear Doctor,').length - 1).toBe(1);
    expect(r.engine.state.letters[0].points?.[0].draft?.at).toBe('2026-11-18T00:01:00.000Z');
    expect(r.engine.state.issued?.T).toBe(2);
  });

  /** An answered question whose take-back puts the named criterion's finding back, or removes it. */
  function answerToTakeBack(r: Rig, criterionId: string, held: Finding | null): void {
    const c = r.engine.state.cases[0];
    c.lines.push({
      id: 'L900',
      text: `no date | CONDITION | Heart failure. The patient has this. ${PHARMACIST_MARK}`
    });
    c.questions = [{
      id: 'Q0001',
      key: 'condition:heart failure',
      kind: 'condition',
      what: 'Heart failure',
      meets: 'the patient has it',
      criterionIds: [criterionId],
      findingIds: [],
      source: 'possible',
      status: 'answered',
      options: [
        { words: 'Yes', effect: 'meets' },
        { words: 'No', effect: 'does_not_meet' },
        { words: 'Not known', effect: 'unknown' }
      ],
      needsValue: false,
      answer: { lineId: 'L900', words: 'Yes', effect: 'meets', at: '2026-11-18T00:00:00.000Z' },
      heldFindings: held ? [held] : []
    }];
  }

  it('takes the point out of the letter when the answer it rested on is taken back', async () => {
    const r = rig({ criteria: [ONE, SAME, POSS] });
    arm(r);
    await threeFindings(r);
    const ids = ['ONE', 'TWO', 'THREE'].map(id => r.engine.state.findings.find(f => f.criterionId === id)!.id);
    r.engine.agree('T0001', {});
    r.engine.previewLetter('T0001');
    expect(r.engine.state.letters[0].patientAgreed).toBeDefined();
    expect(r.engine.state.letters[0].previewedAt).toBeDefined();

    answerToTakeBack(r, 'TWO', null);
    r.engine.takeBackQuestion(r.engine.state.cases[0].id, 'Q0001');

    const letter = r.engine.state.letters[0];
    expect(r.engine.state.findings.some(f => f.id === ids[1])).toBe(false);
    expect(letterFindingIds(letter)).toEqual([ids[0], ids[2]]);
    expect(letter.body).not.toContain('Beta today');
    expect(letter.body).not.toContain('Please review Beta today.');
    expect(letter.body).toContain('Please review Alpha review.');
    expect(letter.body).toContain('Please review Possible finding, gamma.');
    expect(letter.previewedAt).toBeUndefined();
    expect(letter.previewHash).toBeUndefined();
    expect(letter.patientAgreed).toBeUndefined();
    expect(letter.withdrawnNote).toBeUndefined();
    await expectApiError(() => r.engine.markSent('T0001', { by: 'print' }), 409);
    const preview = r.engine.previewLetter('T0001');
    expect(preview.text).not.toContain('Beta today');
    r.engine.agree('T0001', {});
    expect(r.engine.state.letters[0].patientAgreed).toBeDefined();
    expect(r.engine.state.cases[0].lines.some(line => line.text.includes(TAKEN_BACK_MARK))).toBe(true);
    expect(r.engine.state.activity.some(a => a.kind === 'letter_status' && a.text.includes('taken back'))).toBe(true);
  });

  it('says the point is withdrawn when the only finding goes back to a possible finding', async () => {
    const r = rig({ criteria: [ONE] });
    arm(r);
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    const finding = r.engine.state.findings.find(f => f.criterionId === 'ONE')!;
    r.engine.decide(finding.id, { action: 'accept' });
    await r.engine.whenIdle();
    r.engine.agree('T0001', {});
    r.engine.previewLetter('T0001');
    const held = structuredClone(finding);
    held.state = 'confirmed';
    held.possible = true;
    delete held.decision;
    answerToTakeBack(r, 'ONE', held);
    r.engine.takeBackQuestion(r.engine.state.cases[0].id, 'Q0001');

    expect(r.engine.state.findings.find(f => f.id === finding.id)?.state).toBe('confirmed');
    expect(r.engine.state.findings.find(f => f.id === finding.id)?.possible).toBe(true);
    const letter = r.engine.state.letters[0];
    expect(letter.body).toContain('withdrawn');
    expect(letter.body).not.toContain('Please review Alpha review.');
    expect(letter.previewedAt).toBeUndefined();
    expect(letter.patientAgreed).toBeUndefined();
    await expectApiError(() => r.engine.agree('T0001', {}), 409, 'withdrawn');
    await expectApiError(() => r.engine.previewLetter('T0001'), 409, 'withdrawn');
    await expectApiError(() => r.engine.markSent('T0001', { by: 'print' }), 409, 'withdrawn');
  });

  it('does not change a letter already marked as sent, and says the answer was taken back', async () => {
    const r = rig({ criteria: [ONE, SAME] });
    arm(r);
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    const one = r.engine.state.findings.find(f => f.criterionId === 'ONE')!;
    const two = r.engine.state.findings.find(f => f.criterionId === 'TWO')!;
    r.engine.decide(one.id, { action: 'accept' });
    r.engine.decide(two.id, { action: 'accept' });
    await r.engine.whenIdle();
    const sentPreview = r.engine.previewLetter('T0001');
    r.engine.markSent('T0001', { by: 'print', previewToken: sentPreview.previewToken });
    const kept = r.engine.state.letters[0].body;
    answerToTakeBack(r, 'TWO', null);
    r.engine.takeBackQuestion(r.engine.state.cases[0].id, 'Q0001');
    expect(r.engine.state.letters[0].status).toBe('sent');
    expect(r.engine.state.letters[0].body).toBe(kept);
    expect(r.engine.state.letters[0].body).toContain('Please review Beta today.');
    expect(r.engine.state.letters[0].withdrawnNote).toContain('taken back');
    expect(r.engine.state.letters[0].withdrawnNote).toContain('not changed');
  });

  it('does not join a draft that arrives after the answer was taken back', async () => {
    const r = rig({ criteria: [ONE, SAME] });
    let release: (value: LetterDraft) => void = () => undefined;
    arm(r);
    r.behaviour.letter = finding => finding.criterionId === 'TWO'
      ? new Promise<LetterDraft>(resolve => { release = resolve; })
      : draftFor(r, finding);
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    const one = r.engine.state.findings.find(f => f.criterionId === 'ONE')!;
    const two = r.engine.state.findings.find(f => f.criterionId === 'TWO')!;
    r.engine.decide(one.id, { action: 'accept' });
    r.engine.decide(two.id, { action: 'accept' });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(r.engine.state.letters[0].status).toBe('drafting');
    expect(r.engine.state.jobs.some(job => job.stage === 'letter' && job.findingId === two.id && job.status === 'running')).toBe(true);

    answerToTakeBack(r, 'TWO', null);
    r.engine.takeBackQuestion(r.engine.state.cases[0].id, 'Q0001');
    expect(r.engine.state.findings.some(f => f.id === two.id)).toBe(false);
    expect(letterFindingIds(r.engine.state.letters[0])).toEqual([one.id]);
    expect(r.engine.stateResponse().now.text).not.toMatch(/writing/i);

    release(draftFor(r, two));
    await r.engine.whenIdle();
    expect(letterFindingIds(r.engine.state.letters[0])).toEqual([one.id]);
    expect(r.engine.state.letters[0].body).not.toContain('Please review Beta today.');
    expect(r.engine.state.letters[0].body).not.toContain('Beta today');
    expect(r.engine.state.letters[0].points?.some(point => point.findingId === two.id)).toBe(false);
    expect(r.engine.state.activity.some(a => a.text.includes('not joined'))).toBe(true);
  });

  function openQuestion(r: Rig, criterionId: string): void {
    const c = r.engine.state.cases[0];
    c.questions = [{
      id: 'Q0001',
      key: 'condition:heart failure',
      kind: 'condition',
      what: 'Heart failure',
      meets: 'the patient has it',
      criterionIds: [criterionId],
      findingIds: [],
      source: 'possible',
      status: 'open',
      options: [
        { words: 'Yes', effect: 'meets' },
        { words: 'No', effect: 'does_not_meet' },
        { words: 'Not known', effect: 'unknown' }
      ],
      needsValue: false
    }];
  }

  it('writes a remaining point again when its draft quotes a line that was taken back', async () => {
    const r = rig({ criteria: [ONE, SAME] });
    arm(r);
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    const one = r.engine.state.findings.find(f => f.criterionId === 'ONE')!;
    const two = r.engine.state.findings.find(f => f.criterionId === 'TWO')!;
    r.engine.decide(one.id, { action: 'accept' });
    r.engine.decide(two.id, { action: 'accept' });
    await r.engine.whenIdle();
    const quote = `Pharmacist line QUOTE-HEART-FAILURE-LINE-900 recorded at the counter for this patient. ${PHARMACIST_MARK}`;
    const point = r.engine.state.letters[0].points!.find(item => item.findingId === one.id)!;
    point.draft!.body = `${point.draft!.body}\n${quote}`;
    answerToTakeBack(r, 'TWO', null);
    const line = r.engine.state.cases[0].lines.find(item => item.id === 'L900')!;
    line.text = quote;
    r.engine.takeBackQuestion(r.engine.state.cases[0].id, 'Q0001');
    const letter = r.engine.state.letters[0];
    expect(letterFindingIds(letter)).toEqual([one.id]);
    expect(letter.body).not.toContain('QUOTE-HEART-FAILURE-LINE-900');
    expect(letter.points?.find(item => item.findingId === one.id)?.draft?.origin).toBe('template');
    expect(letter.points?.find(item => item.findingId === one.id)?.draft?.checkNotes.some(note => note.includes('taken back'))).toBe(true);
    expect(r.calls.filter(call => call.startsWith('letter'))).toEqual(['letter ONE', 'letter TWO']);
  });

  it('clears the withdrawn note once the letter matches the findings again', async () => {
    const r = rig({ criteria: [ONE, SAME, POSS] });
    arm(r);
    await threeFindings(r);
    answerToTakeBack(r, 'TWO', null);
    r.engine.takeBackQuestion(r.engine.state.cases[0].id, 'Q0001');
    const letter = r.engine.state.letters[0];
    expect(letterFindingIds(letter).length).toBe(2);
    expect(letterFindingIds(letter).every(id => r.engine.state.findings.find(f => f.id === id)?.state === 'accepted')).toBe(true);
    expect(letter.withdrawnNote).toBeUndefined();
    expect(r.engine.state.activity.some(a => a.kind === 'letter_status' && a.text.includes('taken back'))).toBe(true);
    r.engine.previewLetter('T0001');
    expect(r.engine.state.letters[0].withdrawnNote).toBeUndefined();
  });

  it('takes a later point out of the letter when its question is answered again', async () => {
    const r = rig({ criteria: [ONE, SAME, POSS] });
    arm(r);
    await threeFindings(r);
    const ids = ['ONE', 'TWO', 'THREE'].map(id => r.engine.state.findings.find(f => f.criterionId === id)!.id);
    r.engine.previewLetter('T0001');
    openQuestion(r, 'TWO');
    r.engine.answerQuestion(r.engine.state.cases[0].id, 'Q0001', { option: 'Yes' });

    const letter = r.engine.state.letters[0];
    expect(letter).toBeTruthy();
    expect(letterFindingIds(letter)).toEqual([ids[0], ids[2]]);
    expect(letter.body).not.toContain('Beta today');
    expect(letter.body).toContain('Please review Alpha review.');
    expect(letter.body).toContain('Please review Possible finding, gamma.');
    expect(letter.previewedAt).toBeUndefined();
    await r.engine.whenIdle();
  });

  it('keeps the other points when the first finding is the one whose question is answered again', async () => {
    const r = rig({ criteria: [ONE, SAME, POSS] });
    arm(r);
    await threeFindings(r);
    const ids = ['ONE', 'TWO', 'THREE'].map(id => r.engine.state.findings.find(f => f.criterionId === id)!.id);
    openQuestion(r, 'ONE');
    r.engine.answerQuestion(r.engine.state.cases[0].id, 'Q0001', { option: 'Yes' });

    expect(r.engine.state.letters).toHaveLength(1);
    const letter = r.engine.state.letters[0];
    expect(letterFindingIds(letter)).toEqual([ids[1], ids[2]]);
    expect(letter.body).not.toContain('Please review Alpha review.');
    expect(letter.body).toContain('Please review Beta today.');
    expect(letter.body).toContain('Please review Possible finding, gamma.');
    await r.engine.whenIdle();
  });
});


describe('answering while other criteria are being screened', () => {
  type Outcome = Awaited<ReturnType<PipelineFns['screenCriterion']>>;

  function deferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>(res => { resolve = res; });
    return { promise, resolve };
  }

  function clear(): Outcome {
    return { ok: true, suspected: false, result: screenResult([]) };
  }

  function suspected(fact?: string): Outcome {
    return {
      ok: true,
      suspected: true,
      result: { ...screenResult(['L001', 'L002']), missingFacts: fact ? [fact] : [] }
    };
  }

  function standing(id: string): Criterion {
    return {
      ...testCriterion,
      id,
      label: id,
      needs_facts: [{ kind: 'condition', what: `Fact for ${id}`, meets: 'the patient has it', ask_when: 'always' }]
    };
  }

  async function caught(run: () => unknown): Promise<unknown> {
    try {
      await run();
      return undefined;
    } catch (error) {
      return error;
    }
  }

  it('accepts an ask-when answer during another criterion\'s first pass and screens its criterion in that pass', async () => {
    const r = rig({ criteria: [ONE, standing('ASK')] });
    const started = deferred<void>();
    const first = deferred<Outcome>();
    r.behaviour.screen = criterion => {
      if (criterion.id === 'ONE') {
        started.resolve();
        return first.promise;
      }
      return clear();
    };
    await r.engine.start();
    await importCsv(r);
    await started.promise;
    const c = r.engine.state.cases[0];
    const q = c.questions?.find(item => item.criterionIds.includes('ASK'))!;

    const error = await caught(() => r.engine.answerQuestion(c.id, q.id, { option: 'Yes' }));
    first.resolve(clear());
    await r.engine.whenIdle();

    expect(error).toBeUndefined();
    expect(q.status).toBe('answered');
    expect(r.calls).toEqual(['screen ONE', 'screen ASK']);
    expect(c.screening.criteria.find(run => run.criterionId === 'ASK')?.status).toBe('clear');
    expect(c.screening.status).toBe('done');
  });

  it('takes three answers in a row into one further screen and one round of second checks', async () => {
    const r = rig({ criteria: [ONE, TWO, THREE] });
    r.behaviour.screen = criterion => suspected(`Fact for ${criterion.id}`);
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    const c = r.engine.state.cases[0];
    const questions = (c.questions ?? []).filter(q => q.source === 'possible');
    expect(questions).toHaveLength(3);
    const oldJobs = new Set(r.engine.state.jobs.map(job => job.id));
    r.calls.length = 0;
    r.behaviour.screen = () => suspected();

    const errors: unknown[] = [];
    for (const q of questions) {
      const error = await caught(() => r.engine.answerQuestion(c.id, q.id, { option: 'Yes' }));
      if (error !== undefined) errors.push(error);
    }
    await r.engine.whenIdle();

    expect(errors).toEqual([]);
    const newScreens = r.engine.state.jobs.filter(job => job.stage === 'screen' && !oldJobs.has(job.id));
    expect(newScreens).toHaveLength(1);
    expect(r.calls).toEqual([
      'screen ONE', 'screen TWO', 'screen THREE',
      'check ONE', 'check TWO', 'check THREE'
    ]);
  });

  it('refuses a possible-finding answer only while its own second check is open, then accepts it', async () => {
    const r = rig({ criteria: [ONE, TWO] });
    const started = deferred<void>();
    const check = deferred<CheckResult>();
    r.behaviour.screen = criterion => criterion.id === 'ONE' ? suspected('Heart failure') : clear();
    r.behaviour.check = () => {
      started.resolve();
      return check.promise;
    };
    await r.engine.start();
    await importCsv(r);
    await started.promise;
    const c = r.engine.state.cases[0];
    const q = (c.questions ?? []).find(item => item.source === 'possible')!;

    const error = await caught(() => r.engine.answerQuestion(c.id, q.id, { option: 'Yes' }));
    check.resolve(checkResult(true));
    await r.engine.whenIdle();

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).message).toContain('second check for this finding');
    r.behaviour.screen = () => clear();
    r.engine.answerQuestion(c.id, q.id, { option: 'Yes' });
    await r.engine.whenIdle();
    expect(q.status).toBe('answered');
  });

  it('keeps answers over an unrelated in-flight result and restores shared-criterion findings and runs on take-back', async () => {
    const criteria = [ONE, TWO, THREE];
    const r = rig({ criteria });
    const started = deferred<void>();
    const unrelated = deferred<Outcome>();
    let answering = false;
    r.behaviour.screen = criterion => {
      if (!answering) {
        if (criterion.id === 'THREE') return { ok: false, error: 'Planted screening failure.' };
        return suspected(`Fact for ${criterion.id}`);
      }
      if (criterion.id === 'THREE') {
        started.resolve();
        return unrelated.promise;
      }
      return suspected();
    };
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    const c = r.engine.state.cases[0];
    const beforeFindings = structuredClone(r.engine.state.findings);
    const beforeRuns = structuredClone(c.screening.criteria);
    const questions = (c.questions ?? []).filter(q => q.source === 'possible');
    expect(questions.map(q => q.criterionIds)).toEqual([['ONE'], ['TWO']]);
    questions[1].criterionIds = ['ONE', 'TWO'];

    answering = true;
    r.engine.screenAgain(c.id);
    await started.promise;
    const firstError = await caught(() => r.engine.answerQuestion(c.id, questions[0].id, { option: 'Yes' }));
    const secondError = await caught(() => r.engine.answerQuestion(c.id, questions[1].id, { option: 'Yes' }));
    const saved = new StateStore(r.dir);
    saved.load();
    const savedStatuses = saved.state.cases[0].questions?.map(q => q.status);
    unrelated.resolve(clear());
    await r.engine.whenIdle();

    expect([firstError, secondError]).toEqual([undefined, undefined]);
    expect(savedStatuses).toEqual(['answered', 'answered']);
    expect(questions.map(q => q.status)).toEqual(['answered', 'answered']);
    expect(c.screening.criteria.find(run => run.criterionId === 'THREE')?.status).toBe('clear');

    r.engine.takeBackQuestion(c.id, questions[1].id);
    r.engine.takeBackQuestion(c.id, questions[0].id);
    const byId = (findings: Finding[]): Finding[] => [...findings].sort((a, b) => a.id.localeCompare(b.id));
    expect(byId(r.engine.state.findings)).toEqual(byId(beforeFindings));
    expect(c.screening.criteria.filter(run => run.criterionId !== 'THREE')).toEqual(
      beforeRuns.filter(run => run.criterionId !== 'THREE')
    );
    expect(questions.every(q => q.status === 'open' && !q.heldFindings && !q.heldRuns)).toBe(true);
  });
  it('accepts 30 rapid answers during one screening, coalesces the queue, and finishes every criterion', async () => {
    const criteria = [ONE, ...Array.from({ length: 30 }, (_, index) => standing(`ASK-${String(index + 1).padStart(2, '0')}`))];
    const r = rig({ criteria });
    const started = deferred<void>();
    const first = deferred<Outcome>();
    r.behaviour.screen = criterion => {
      if (criterion.id === 'ONE') {
        started.resolve();
        return first.promise;
      }
      return clear();
    };
    await r.engine.start();
    await importCsv(r);
    await started.promise;
    const c = r.engine.state.cases[0];
    const questions = (c.questions ?? []).filter(q => q.source === 'patient');
    expect(questions).toHaveLength(30);

    const errors: unknown[] = [];
    for (const q of questions) {
      const error = await caught(() => r.engine.answerQuestion(c.id, q.id, { option: 'Yes' }));
      if (error !== undefined) errors.push(error);
    }
    first.resolve(clear());
    await r.engine.whenIdle();

    expect(errors).toEqual([]);
    expect(questions.every(q => q.status === 'answered')).toBe(true);
    expect(r.engine.state.jobs.filter(job => job.stage === 'screen')).toHaveLength(2);
    expect(r.calls.filter(call => call.startsWith('screen'))).toHaveLength(31);
    expect(c.screening.criteria.every(run => run.status === 'clear')).toBe(true);
    expect(c.screening.status).toBe('done');
    expect(r.engine.state.jobs.some(job => job.status === 'queued' || job.status === 'running')).toBe(false);
  });

  it('gives every re-screened criterion all counter lines after 145 lines grow past 150', async () => {
    const ids = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];
    const criteria = ids.map(id => ({ ...testCriterion, id, label: id }));
    const r = rig({ criteria, cfg: { ...testConfig, maxLinesPerCall: 150, overlapLines: 30 } });
    const rows = ['patient_ref,patient_age,patient_sex,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber'];
    for (let i = 0; i < 145; i++) {
      rows.push(`F-145,70,M,2026-${String((i % 9) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')},metformin,Diabex XR,1000 mg,tablet,60,4,Take ONE tablet twice a day,Dr F. Example`);
    }
    const inputs: { criterionId: string; lineIds: string[]; lineCount: number }[] = [];
    let capture = false;
    const realScreen = r.pipeline.screenCriterion;
    r.pipeline.screenCriterion = async (cfg, patient, lines, criterion, signal) => {
      if (capture) inputs.push({ criterionId: criterion.id, lineIds: lines.map(line => line.id), lineCount: lines.length });
      return realScreen(cfg, patient, lines, criterion, signal);
    };
    r.behaviour.screen = criterion => suspected(`Fact for ${criterion.id}`);
    await r.engine.start();
    await r.engine.importCase({ fileName: 'growing.csv', source: 'csv', csvText: rows.join('\r\n') });
    await r.engine.whenIdle();
    const c = r.engine.state.cases[0];
    expect(c.lines).toHaveLength(145);
    expect(c.parts).toBe(1);
    const questions = (c.questions ?? []).filter(q => q.source === 'possible');
    expect(questions.map(q => q.criterionIds)).toEqual(ids.map(id => [id]));

    const started = deferred<void>();
    const first = deferred<Outcome>();
    let hold = true;
    r.behaviour.screen = criterion => {
      if (criterion.id === 'ONE' && hold) {
        hold = false;
        started.resolve();
        return first.promise;
      }
      return clear();
    };
    capture = true;
    r.engine.answerQuestion(c.id, questions[0].id, { option: 'Yes' });
    await started.promise;
    for (const q of questions.slice(1)) r.engine.answerQuestion(c.id, q.id, { option: 'Yes' });
    expect(c.lines).toHaveLength(151);
    first.resolve(clear());
    await r.engine.whenIdle();

    const answerLineIds = questions.map(q => q.answer!.lineId);
    for (const id of ids.slice(1)) {
      const calls = inputs.filter(input => input.criterionId === id);
      expect(calls).toHaveLength(1);
      expect(calls[0].lineCount).toBe(151);
      expect(calls[0].lineIds).toEqual(expect.arrayContaining(answerLineIds));
    }
    expect(c.screening.criteria.every(run => run.status === 'clear')).toBe(true);
    expect(c.screening.status).toBe('done');
  });

  it('recovers persisted answers on a restart during screening without repeating or leaving work running', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-engine-'));
    made.push(dir);
    const criteria = [ONE, standing('ASK')];
    const before = rig({ dir, criteria });
    const started = deferred<void>();
    const held = deferred<Outcome>();
    before.behaviour.screen = criterion => {
      if (criterion.id === 'ONE') {
        started.resolve();
        return held.promise;
      }
      return clear();
    };
    await before.engine.start();
    await importCsv(before);
    await started.promise;
    const interrupted = before.engine.state.cases[0];
    const question = interrupted.questions!.find(q => q.criterionIds.includes('ASK'))!;
    before.engine.answerQuestion(interrupted.id, question.id, { option: 'Yes' });
    const saved = new StateStore(dir);
    saved.load();
    const savedQuestion = saved.state.cases[0].questions!.find(q => q.id === question.id)!;
    expect(savedQuestion.status).toBe('answered');
    expect(saved.state.cases[0].lines.some(line => line.id === savedQuestion.answer!.lineId)).toBe(true);

    const after = rig({ dir, criteria });
    after.behaviour.screen = () => clear();
    await after.engine.start();
    await after.engine.whenIdle();

    const recovered = after.engine.state.cases[0];
    expect(after.calls.filter(call => call.startsWith('screen'))).toEqual(['screen ONE', 'screen ASK']);
    expect(recovered.questions!.find(q => q.id === question.id)?.answer).toEqual(savedQuestion.answer);
    expect(recovered.lines.some(line => line.id === savedQuestion.answer!.lineId)).toBe(true);
    expect(recovered.screening.criteria.every(run => run.status === 'clear')).toBe(true);
    expect(recovered.screening.status).toBe('done');
    expect(after.engine.state.jobs.some(job => job.status === 'queued' || job.status === 'running')).toBe(false);
    expect(recovered.screening.criteria.some(run => run.status === 'running')).toBe(false);
  });
});


describe('Not known releases an ask-when criterion', () => {
  function criterion(): Criterion {
    return {
      ...testCriterion,
      id: 'ASK',
      label: 'Ask-when criterion',
      needs_facts: [{ kind: 'condition', what: 'Fact for ASK', meets: 'the patient has it', ask_when: 'always' }]
    };
  }

  function outcome(missingFacts: string[]): Awaited<ReturnType<PipelineFns['screenCriterion']>> {
    return {
      ok: true,
      suspected: true,
      result: { ...screenResult(['L001', 'L002']), missingFacts }
    };
  }

  async function answeredNotKnown() {
    const r = rig({ criteria: [criterion()] });
    r.behaviour.screen = () => outcome(['Fact for ASK']);
    await r.engine.start();
    await importCsv(r);
    await r.engine.whenIdle();
    const c = r.engine.state.cases[0];
    const q = (c.questions ?? []).find(item => item.criterionIds.includes('ASK'))!;
    expect(q.status).toBe('open');
    expect(r.calls).toEqual([]);
    r.engine.answerQuestion(c.id, q.id, { option: 'Not known' });
    await r.engine.whenIdle();
    return { r, c, qid: q.id };
  }

  it('screens the criterion and keeps the fake model\'s possible finding', async () => {
    const { r, c } = await answeredNotKnown();
    expect(r.calls).toEqual(['screen ASK', 'check ASK']);
    const finding = r.engine.state.findings.find(item => item.criterionId === 'ASK');
    expect(finding?.possible).toBe(true);
    expect(finding?.screen.missingFacts).toEqual(['Fact for ASK']);
    expect(finding?.state).toBe('confirmed');
    expect(c.lines.some(line => line.text.includes('Fact for ASK: not known. Entered by the pharmacist at the counter.'))).toBe(true);
  });

  it('leaves nothing waiting and finishes the history', async () => {
    const { r, c } = await answeredNotKnown();
    expect(c.screening.criteria.every(run => run.status !== 'waiting' && run.status !== 'running')).toBe(true);
    expect(c.screening.status).toBe('done');
    expect(r.engine.state.jobs.some(job => job.status === 'queued' || job.status === 'running')).toBe(false);
    expect(r.engine.stateResponse().now.text).toBe('Idle');
  });

  it('screens a reopened question answered Yes again and replaces the possible finding', async () => {
    const { r, c, qid } = await answeredNotKnown();
    r.engine.reopenQuestion(c.id, qid);
    r.behaviour.screen = () => outcome([]);
    r.engine.answerQuestion(c.id, qid, { option: 'Yes' });
    await r.engine.whenIdle();

    expect(r.calls.filter(call => call === 'screen ASK')).toHaveLength(2);
    const findings = r.engine.state.findings.filter(item => item.criterionId === 'ASK');
    expect(findings).toHaveLength(1);
    expect(findings[0].possible).toBe(false);
    expect(findings[0].screen.missingFacts).toEqual([]);
    expect(c.questions?.find(q => q.id === qid)?.status).toBe('answered');
    expect(c.screening.status).toBe('done');
  });
});
