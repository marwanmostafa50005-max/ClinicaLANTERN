import { describe, expect, it } from 'vitest';
import type { Activity, HealthResponse, StateResponse } from '../../shared/types.ts';
import { latestProblem, modelsWords } from './health.ts';

const names = { screen: 'lantern-screen', check: 'lantern-check', letter: 'lantern-letter' };
const up: HealthResponse = { ollama: 'up', version: '0.40.15', models: { screen: true, check: true, letter: true }, names };

function snapWith(activity: Activity[], serverTime: string): StateResponse {
  return {
    state: { version: 1, cases: [], findings: [], letters: [], jobs: [], activity },
    counts: {
      historiesScreened: 0, findingsConfirmed: 0, accepted: 0, bypassed: 0, lettersReady: 0, lettersSent: 0,
      repliesRecorded: 0, closed: 0, overdue: 0, bellBadge: 0, letterBadge: 0,
    },
    now: { stage: null, text: 'Idle' },
    serverTime,
    recorded: false,
  };
}

describe('the words about the local models', () => {
  it('says the models are ready when all three are there', () => {
    expect(modelsWords(up)).toEqual({ text: 'The three local models are ready.', ok: true });
  });

  it('says in plain words that nothing can be screened, and how to start the models', () => {
    const words = modelsWords({ ollama: 'down', models: { screen: false, check: false, letter: false }, names });
    expect(words?.ok).toBe(false);
    expect(words?.text).toBe(
      'The local models are not running. A history cannot be screened until they are. Start them with start-ollama.ps1 (step 1 of docs\\RUNNING.md).');
  });

  it('names a model that is missing', () => {
    const words = modelsWords({ ...up, models: { screen: true, check: false, letter: true } });
    expect(words).toEqual({ text: 'The model server is running, but a model is missing: lantern-check.', ok: false });
  });

  it('says nothing before the first answer', () => {
    expect(modelsWords(null)).toBeNull();
  });
});

describe('the newest problem, for the first screen', () => {
  const NOW = '2026-11-18T10:00:00.000Z';

  it('is the newest "Problem" entry of the activity log while it is fresh', () => {
    const snap = snapWith([
      { at: '2026-11-18T09:50:00.000Z', kind: 'error', text: 'An older problem.' },
      { at: '2026-11-18T09:58:00.000Z', kind: 'error', text: 'Model 1 could not read page 2 of scan.pdf. The history was not screened.' },
      { at: '2026-11-18T09:59:00.000Z', kind: 'import', text: 'History imported: positive.csv, 45 lines.' },
    ], NOW);
    expect(latestProblem(snap)?.text).toBe('Model 1 could not read page 2 of scan.pdf. The history was not screened.');
  });

  it('is nothing when there is no problem, when it is old, or when the entry says the problem is over', () => {
    expect(latestProblem(null)).toBeNull();
    expect(latestProblem(snapWith([{ at: '2026-11-18T09:59:00.000Z', kind: 'screen', text: 'Model 1 finished.' }], NOW))).toBeNull();
    expect(latestProblem(snapWith([{ at: '2026-11-18T09:30:00.000Z', kind: 'error', text: 'Half an hour ago.' }], NOW))).toBeNull();
    expect(latestProblem(snapWith([
      { at: '2026-11-18T09:58:00.000Z', kind: 'error', text: 'The state file could not be written.' },
      { at: '2026-11-18T09:58:02.000Z', kind: 'error', text: 'The state file can be written again. Nothing was lost.' },
    ], NOW))).toBeNull();
  });

  it('shows a saved state that could not be read on start', () => {
    const text = 'The saved state could not be read. It was kept as state-unreadable-2026-11-18T09-59-58.json and a clean state was started.';
    expect(latestProblem(snapWith([{ at: '2026-11-18T09:59:58.000Z', kind: 'error', text }], NOW))?.text).toBe(text);
  });
});
