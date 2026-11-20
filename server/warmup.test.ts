// The warm-up job. No model is called: warmModel is a stand-in.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { testConfig, testCriterion } from '../pipeline/testkit.ts';
import type { Job } from '../shared/types.ts';
import { getHealth } from './api.ts';
import { Engine, type PipelineFns } from './engine.ts';
import { PageImages } from './images.ts';
import { StateStore } from './store.ts';
import { HELD_FOR_MODELS, MODELS_NOT_RUNNING } from './view.ts';

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function open(warmup: boolean, warmModel?: PipelineFns['warmModel']): Engine {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-warmup-'));
  made.push(dir);
  const store = new StateStore(dir);
  store.load();
  const unused = async (): Promise<never> => {
    throw new Error('This step was not part of the warm-up.');
  };
  const pipeline: PipelineFns = {
    screenCriterion: unused,
    checkFinding: unused,
    draftLetter: unused,
    transcribePageImage: unused,
    warmModel
  };
  return new Engine({
    cfg: testConfig,
    store,
    pipeline,
    images: new PageImages(path.join(dir, 'images')),
    loadCriteria: async () => [],
    warmup,
    modelsUp: async () => false,
    holdDelayMs: 60_000
  });
}

describe('warm-up', () => {
  it('asks Model 1 through the queue when nothing is queued, and the status line names Mantle', async () => {
    let seen = '';
    const engine = open(true, async () => {
      seen = engine.stateResponse().now.text;
      return { ok: true };
    });
    await engine.start();
    await engine.whenIdle();
    expect(seen).toBe('Warming up Mantle');
    expect(engine.stateResponse().now.text).toBe('Idle');
    expect(engine.modelsNote).toBeUndefined();
    expect(engine.state.activity.map(row => row.text)).toContain('Mantle is warm.');
    expect(engine.state.jobs.some(job => job.warmup && job.status === 'done')).toBe(true);
  });

  it('stays up when the warm-up cannot reach the models, and says so', async () => {
    const engine = open(true, async () => ({ ok: false, error: 'The local model server did not answer.' }));
    await engine.start();
    await engine.whenIdle();
    expect(engine.stateResponse().now.text).toBe(MODELS_NOT_RUNNING);
    expect(engine.modelsNote).toBe(MODELS_NOT_RUNNING);
    expect(engine.state.activity.map(row => row.text)).toContain(
      'The local models are not running. The server is up. Screening starts when they answer.'
    );
  });

  it('does not warm up when a history is already queued', async () => {
    let warmed = 0;
    const engine = open(true, async () => {
      warmed += 1;
      return { ok: true };
    });
    const waiting: Job = { id: 'J0001', stage: 'screen', caseId: 'C0001', status: 'queued' };
    engine.state.jobs.push(waiting);
    await engine.start();
    await engine.whenIdle();
    expect(warmed).toBe(0);
    expect(engine.state.jobs.some(job => job.warmup)).toBe(false);
  });

  it('stays up when the warm-up throws, and when the warm-up step is not connected', async () => {
    const thrown = open(true, async () => {
      throw new Error('The model server closed the call.');
    });
    await thrown.start();
    await thrown.whenIdle();
    expect(thrown.stateResponse().now.text).toBe(MODELS_NOT_RUNNING);
    expect(thrown.modelsNote).toBe(MODELS_NOT_RUNNING);
    expect(thrown.state.jobs.some(job => job.warmup && job.status === 'failed')).toBe(true);

    const missing = open(true);
    await missing.start();
    await missing.whenIdle();
    expect(missing.stateResponse().now.text).toBe(MODELS_NOT_RUNNING);
    expect(missing.state.activity.map(row => row.text)).toContain(
      'The local models are not running. The server is up. Screening starts when they answer.'
    );
  });

  it('drops a warm-up that is still running when a clean demo starts, and warms up again', async () => {
    let release: (value: { ok: true }) => void = () => undefined;
    let calls = 0;
    const engine = open(true, () => {
      calls += 1;
      if (calls === 1) return new Promise(resolve => { release = resolve; });
      return Promise.resolve({ ok: true });
    });
    await engine.start();
    const until = Date.now() + 1000;
    while (engine.stateResponse().now.text !== 'Warming up Mantle' && Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(engine.stateResponse().now.text).toBe('Warming up Mantle');
    await engine.reset();
    expect(engine.state.cases).toEqual([]);
    expect(engine.state.activity.some(row => row.text === 'Mantle is warm.')).toBe(false);
    expect(engine.state.activity.some(row => row.text.startsWith('A clean demo was started.'))).toBe(true);
    release({ ok: true });
    await engine.whenIdle();
    expect(calls).toBe(2);
    expect(engine.stateResponse().now.text).toBe('Idle');
    expect(engine.modelsNote).toBeUndefined();
    expect(engine.state.activity.filter(row => row.text === 'Mantle is warm.')).toHaveLength(1);
    expect(engine.state.jobs.filter(job => job.warmup && job.status === 'done')).toHaveLength(1);
  });

  it('does nothing when warm-up is off, which is how the tests start the server', async () => {
    let warmed = 0;
    const engine = open(false, async () => {
      warmed += 1;
      return { ok: true };
    });
    await engine.start();
    await engine.whenIdle();
    expect(warmed).toBe(0);
    expect(engine.stateResponse().now.text).toBe('Idle');
    expect(engine.state.jobs).toEqual([]);
  });

  it('returns to Idle after a history is screened, when the warm-up could not reach the models', async () => {
    const engine = openPharmacy(async () => screenHit(), async () => checkHit());
    await engine.start();
    await engine.whenIdle();
    expect(engine.stateResponse().now.text).toBe(MODELS_NOT_RUNNING);
    expect(engine.modelsNote).toBe(MODELS_NOT_RUNNING);

    await engine.importCase({ fileName: 'positive.csv', source: 'csv', csvText: CSV });
    await engine.whenIdle();
    expect(engine.state.jobs.some(job => job.warmup && job.status === 'failed')).toBe(true);
    expect(engine.state.jobs.some(job => !job.warmup && job.stage === 'screen' && job.status === 'done')).toBe(true);
    expect(engine.state.jobs.some(job => job.stage === 'check' && job.status === 'done')).toBe(true);
    expect(engine.stateResponse().now.text).toBe('Idle');
    expect(engine.modelsNote).toBeUndefined();

    const health = await getHealth(testConfig, stubOllamaUp);
    if (engine.modelsNote) health.modelsNote = engine.modelsNote;
    expect(health.ollama).toBe('up');
    expect(health.modelsNote).toBeUndefined();
  });

  it('keeps the models-not-running line when a real step still cannot reach the models', async () => {
    const engine = openPharmacy(
      async () => ({ ok: false, error: 'The local model server did not answer.' }),
      async () => checkHit()
    );
    await engine.start();
    await engine.whenIdle();
    expect(engine.modelsNote).toBe(MODELS_NOT_RUNNING);
    await engine.importCase({ fileName: 'positive.csv', source: 'csv', csvText: CSV });
    const until = Date.now() + 2000;
    let held = false;
    while (Date.now() < until) {
      held = engine.state.jobs.some(job => !job.warmup && job.status === 'queued' && job.detail === HELD_FOR_MODELS);
      if (held) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(held).toBe(true);
    expect(engine.modelsNote).toBe(MODELS_NOT_RUNNING);
    expect(engine.stateResponse().now.text).toBe('The local models are not running. This step starts again when they answer.');
  });
});

const CSV = [
  'patient_ref,patient_age,patient_sex,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber',
  'F-001,72,F,2026-08-08,,Xarelto,20 mg,tablet,28,5,Take ONE tablet daily with food,Dr F. Example',
  'F-001,72,F,2026-08-21,,Celebrex,200 mg,capsule,30,2,Take ONE capsule daily with food,Dr G. Sample'
].join('\r\n');

function screenHit(): Awaited<ReturnType<PipelineFns['screenCriterion']>> {
  return {
    ok: true, suspected: true,
    result: {
      lineIds: ['L001', 'L002'], medicines: ['celecoxib', 'rivaroxaban'], reason: 'Both are supplied.',
      linesVerified: true, missingFacts: [], model: 'lantern-screen', at: '2026-11-18T00:00:00.000Z', seconds: 1
    }
  };
}

function checkHit(): Awaited<ReturnType<PipelineFns['checkFinding']>> {
  return {
    confirmed: true, lineIds: ['L001', 'L002'], whatMatches: 'Celebrex and Xarelto.', whatCannotBeSeen: 'Kidney function.',
    completed: true, model: 'lantern-check', at: '2026-11-18T00:00:10.000Z', seconds: 2
  };
}

/** Ollama answers 200. No call leaves this process. */
const stubOllamaUp = (async (url: string | URL | Request) => {
  const path = String(url);
  const body = path.endsWith('/api/version')
    ? { version: '0.40.15' }
    : { models: [{ name: 'lantern-screen:latest' }, { name: 'lantern-check:latest' }, { name: 'lantern-letter:latest' }] };
  return new Response(JSON.stringify(body), { status: 200 });
}) as typeof fetch;

/** A pharmacy server: warm-up failed, then a stand-in screen and check. modelsUp stays false. */
function openPharmacy(
  screenCriterion: PipelineFns['screenCriterion'],
  checkFinding: PipelineFns['checkFinding']
): Engine {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-warmup-'));
  made.push(dir);
  const store = new StateStore(dir);
  store.load();
  const pipeline: PipelineFns = {
    screenCriterion,
    checkFinding,
    draftLetter: async () => {
      throw new Error('This step was not part of the warm-up.');
    },
    transcribePageImage: async () => {
      throw new Error('This step was not part of the warm-up.');
    },
    warmModel: async () => ({ ok: false, error: 'The local model server did not answer.' })
  };
  return new Engine({
    cfg: testConfig,
    store,
    pipeline,
    images: new PageImages(path.join(dir, 'images')),
    loadCriteria: async () => [testCriterion],
    warmup: true,
    modelsUp: async () => false,
    holdDelayMs: 60_000
  });
}
