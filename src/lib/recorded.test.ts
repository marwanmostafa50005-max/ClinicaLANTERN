import { describe, expect, it } from 'vitest';
import type { StateResponse } from '../../shared/types.ts';
import {
  RecordingPlayer,
  RECORDING_FORMAT,
  parseRecording,
  playWaitMs,
  type RecordedRun,
} from './recorded.ts';

const baseResponse = (): StateResponse => ({
  state: { version: 1, cases: [], findings: [], letters: [], jobs: [], activity: [] },
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
});

function recording(frames: RecordedRun['frames']): RecordedRun {
  return {
    format: RECORDING_FORMAT,
    title: 'Test',
    about: 'A test run.',
    recordedAt: '2026-11-18T12:00:00.000Z',
    madeHow: 'A test.',
    criteria: [],
    frames,
  };
}

describe('parseRecording', () => {
  it('accepts a good recording', () => {
    const data = recording([
      { afterMs: 0, note: '', response: baseResponse() },
      { afterMs: 500, note: 'A note.', response: baseResponse() },
    ]);
    const parsed = parseRecording(data);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.recording.frames).toHaveLength(2);
  });

  it('refuses a wrong format', () => {
    const parsed = parseRecording({ ...recording([{ afterMs: 0, note: '', response: baseResponse() }]), format: 'other' });
    expect(parsed.ok).toBe(false);
  });

  it('refuses a recording with no frames', () => {
    expect(parseRecording({ ...recording([]), frames: [] }).ok).toBe(false);
  });

  it('refuses a frame that is not marked recorded', () => {
    const bad = baseResponse();
    const notRecorded = { ...bad, recorded: false };
    expect(parseRecording(recording([{ afterMs: 0, note: '', response: notRecorded }])).ok).toBe(false);
  });
});

describe('RecordingPlayer', () => {
  const run = recording([
    { afterMs: 0, note: '', response: baseResponse() },
    { afterMs: 300, note: 'Step two.', response: baseResponse() },
    { afterMs: 400, note: '', response: baseResponse() },
  ]);

  it('steps forward, stops at the last frame and starts again', () => {
    const player = new RecordingPlayer(run);
    expect(player.frameIndex).toBe(0);
    expect(player.next()).toBe(true);
    expect(player.frameIndex).toBe(1);
    expect(player.frameNote()).toBe('Step two.');
    expect(player.next()).toBe(true);
    expect(player.frameIndex).toBe(2);
    expect(player.next()).toBe(false);
    expect(player.frameIndex).toBe(2);
    player.startAgain();
    expect(player.frameIndex).toBe(0);
  });
});

describe('playWaitMs', () => {
  it('cuts a wait above two seconds and gives the caption in whole seconds', () => {
    const { ms, caption } = playWaitMs(41_000);
    expect(ms).toBe(2000);
    expect(caption).toBe('Shortened. Real time: 41 seconds.');
  });

  it('keeps a short wait and gives no caption', () => {
    const { ms, caption } = playWaitMs(1500);
    expect(ms).toBe(1500);
    expect(caption).toBeNull();
  });
});