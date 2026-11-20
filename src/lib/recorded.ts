// Types and pure logic for a recorded real run, played frame by frame in the judges' view.
import type { Criterion, StateResponse } from '../../shared/types.ts';

export const RECORDING_FORMAT = 'clinicalantern-recorded-run-1';
export const MAX_FRAME_WAIT_MS = 2000;

/** One entry in recorded/index.json beside the built replay copy. */
export interface RecordedIndexEntry {
  file: string;
  title: string;
  about: string;
}

export interface RecordedIndex {
  runs: RecordedIndexEntry[];
}

export interface RecordedFrame {
  /** Milliseconds since the frame before; the first frame is 0. */
  afterMs: number;
  /** Empty, or one plain sentence for a step a script entered for the pharmacist. */
  note: string;
  response: StateResponse;
}

export interface RecordedRun {
  format: string;
  title: string;
  about: string;
  recordedAt: string;
  madeHow: string;
  criteria: Criterion[];
  frames: RecordedFrame[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** The wait before the next frame while the run is playing. Long waits are cut to two seconds. */
export function playWaitMs(afterMs: number): { ms: number; caption: string | null } {
  const safe = Number.isFinite(afterMs) && afterMs > 0 ? afterMs : 0;
  if (safe <= MAX_FRAME_WAIT_MS) return { ms: safe, caption: null };
  const seconds = Math.round(safe / 1000);
  return { ms: MAX_FRAME_WAIT_MS, caption: `Shortened. Real time: ${seconds} seconds.` };
}

/** Refuse a file that is not a valid recording (docs/SPEC.md and packet P05 point 12). */
export function parseRecording(data: unknown): { ok: true; recording: RecordedRun } | { ok: false; message: string } {
  if (!isObject(data)) return { ok: false, message: 'This file is not a recorded run the page can read.' };
  if (data.format !== RECORDING_FORMAT) {
    return { ok: false, message: 'This file is not in the recorded-run format this copy expects.' };
  }
  if (!Array.isArray(data.frames) || data.frames.length === 0) {
    return { ok: false, message: 'This recording has no frames to play.' };
  }
  for (const frame of data.frames) {
    if (!isObject(frame) || !isObject(frame.response) || frame.response.recorded !== true) {
      return { ok: false, message: 'This recording has a frame that is not marked as a recorded run.' };
    }
  }
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const about = typeof data.about === 'string' ? data.about.trim() : '';
  const recordedAt = typeof data.recordedAt === 'string' ? data.recordedAt : '';
  const madeHow = typeof data.madeHow === 'string' ? data.madeHow.trim() : '';
  const criteria = Array.isArray(data.criteria) ? (data.criteria as Criterion[]) : [];
  return {
    ok: true,
    recording: {
      format: RECORDING_FORMAT,
      title,
      about,
      recordedAt,
      madeHow,
      criteria,
      frames: data.frames as RecordedFrame[],
    },
  };
}

/** Read recorded/index.json. Returns a message when the list is missing, empty or broken. */
export function parseIndex(data: unknown): { runs: RecordedIndexEntry[]; emptyMessage: string | null } {
  if (!isObject(data) || !Array.isArray(data.runs)) {
    return { runs: [], emptyMessage: 'No recorded runs are in this copy.' };
  }
  const runs = data.runs
    .filter(isObject)
    .map((row) => ({
      file: typeof row.file === 'string' ? row.file.trim() : '',
      title: typeof row.title === 'string' ? row.title.trim() : '',
      about: typeof row.about === 'string' ? row.about.trim() : '',
    }))
    .filter((row) => row.file !== '' && row.title !== '');
  if (runs.length === 0) return { runs: [], emptyMessage: 'No recorded runs are in this copy.' };
  return { runs, emptyMessage: null };
}

/** Steps through the frames of one recording. */
export class RecordingPlayer {
  private index = 0;
  private readonly run: RecordedRun;

  constructor(run: RecordedRun) {
    this.run = run;
  }

  get frameCount(): number {
    return this.run.frames.length;
  }

  get frameIndex(): number {
    return this.index;
  }

  atEnd(): boolean {
    return this.index >= this.run.frames.length - 1;
  }

  response(): StateResponse {
    return this.run.frames[this.index]?.response ?? emptyRecordedState();
  }

  frameNote(): string {
    return this.run.frames[this.index]?.note?.trim() ?? '';
  }

  goTo(step: number): void {
    this.index = Math.max(0, Math.min(this.run.frames.length - 1, Math.round(step)));
  }

  next(): boolean {
    if (this.atEnd()) return false;
    this.index += 1;
    return true;
  }

  startAgain(): void {
    this.index = 0;
  }

  /** The wait before the next frame from the frame after this one. */
  waitBeforeNext(): { ms: number; caption: string | null } {
    const next = this.run.frames[this.index + 1];
    if (!next) return { ms: 0, caption: null };
    return playWaitMs(next.afterMs);
  }
}

export function emptyRecordedState(): StateResponse {
  return {
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
    now: { stage: null, text: 'Pick a recorded case, then press Play or Next step.' },
    serverTime: new Date().toISOString(),
    recorded: true,
  };
}