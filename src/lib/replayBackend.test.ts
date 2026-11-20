import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RECORDING_FORMAT, RecordingPlayer, type RecordedRun } from './recorded.ts';
import {
  NO_IMPORT,
  RECORDED_BUTTONS_OFF,
  replayBackend,
  replayControl,
} from './replayBackend.ts';

const baseFrame = () => ({
  afterMs: 0,
  note: '',
  response: {
    state: { version: 1 as const, cases: [], findings: [], letters: [], jobs: [], activity: [] },
    counts: {
      historiesScreened: 0,
      findingsConfirmed: 0,
      accepted: 0,
      bypassed: 0,
      lettersReady: 0,
      lettersSent: 0,
      repliesRecorded: 0,
      closed: 0,
      overdue: 0,
      bellBadge: 0,
      letterBadge: 0,
    },
    now: { stage: null, text: 'Idle' },
    serverTime: '2026-11-18T12:00:00.000Z',
    recorded: true,
  },
});

const testRun: RecordedRun = {
  format: RECORDING_FORMAT,
  title: 'Test',
  about: 'About.',
  recordedAt: '2026-11-18T12:00:00.000Z',
  madeHow: 'A test recording.',
  criteria: [{ id: 'ONE', label: 'One', family: '', title: '', statement: 's', statement_origin: 'entrant', source: { document: '', citation: '', licence: '', licence_status: 'proposed', credit: '' }, plain_summary: '', medicine_groups: [], rule_for_models: '', cannot_be_seen: '', ask_the_gp: '', urgency: 'routine', draft: true, signed_by_clinical_reviewer: null }],
  frames: [
    baseFrame(),
    { ...baseFrame(), afterMs: 400, note: 'Next.', response: { ...baseFrame().response, now: { stage: 'screen', text: 'Screening' } } },
  ],
};

describe('replayBackend', () => {
  it('getState gives the frame the player is on with recorded true', async () => {
    replayControl.loadRecording(testRun);
    const state = await replayBackend.getState();
    expect(state.recorded).toBe(true);
    expect(state.now.text).toBe('Idle');
    replayControl.nextFrame();
    expect((await replayBackend.getState()).now.text).toBe('Screening');
  });

  it('getCriteria gives the recording criteria', async () => {
    replayControl.loadRecording(testRun);
    const list = await replayBackend.getCriteria();
    expect(list[0]?.id).toBe('ONE');
  });

  it('refuses every call that would change something', async () => {
    replayControl.loadRecording(testRun);
    await expect(replayBackend.importCase({ fileName: 'x.csv', source: 'csv', csvText: 'a' })).rejects.toThrow(NO_IMPORT);
    await expect(replayBackend.decideFinding('F0001', { action: 'accept' })).rejects.toThrow(RECORDED_BUTTONS_OFF);
    await expect(replayBackend.saveLetter('T0001', { subject: 's', body: 'b' })).rejects.toThrow(RECORDED_BUTTONS_OFF);
    await expect(replayBackend.resetDemo()).rejects.toThrow(RECORDED_BUTTONS_OFF);
    await expect(replayBackend.markFindingSeen('F0001')).resolves.toBeUndefined();
  });

  it('does not call fetch with /api', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const text = readFileSync(join(dir, 'replayBackend.ts'), 'utf8');
    expect(/fetch\s*\(\s*[`'"][^`'"]*\/api/i.test(text)).toBe(false);
    expect(new RecordingPlayer(testRun).frameCount).toBe(2);
  });
});