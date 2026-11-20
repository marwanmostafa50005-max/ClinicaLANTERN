import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RECORDED_BUTTONS_OFF } from '../lib/replayBackend.ts';
import type { ReplayControl } from '../lib/replayBackend.ts';
import { RecordingPlayer } from '../lib/recorded.ts';
import type { RecordedRun } from '../lib/recorded.ts';
import { RECORDED_SAMPLE } from '../mock/recordedSample.ts';
import { RecordedRunPicker, ReplayBar } from './ReplayBar.tsx';

const text = (markup: string): string =>
  markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const refresh = async (): Promise<void> => undefined;

/** A stand-in for the page's replay control: one run, or none, and no file is read. */
function control(run: RecordedRun | null, frame = 0): ReplayControl {
  const player = run ? new RecordingPlayer(run) : null;
  player?.goTo(frame);
  return {
    useSample: () => undefined,
    loadRecording: () => undefined,
    fetchIndex: async () => ({ runs: [], emptyMessage: 'No recorded runs are in this copy.' }),
    loadRunFile: async () => null,
    madeHow: () => run?.madeHow ?? '',
    title: () => run?.title ?? '',
    about: () => run?.about ?? '',
    player: () => player,
    goToFrame: (index) => player?.goTo(index),
    nextFrame: () => player?.next() ?? false,
    startAgain: () => player?.startAgain(),
  };
}

describe('ReplayBar', () => {
  it('shows the three steps of the guide, in their order', () => {
    const line = text(renderToStaticMarkup(<ReplayBar replay={control(null)} paused={false} refresh={refresh} />));
    expect(line).toContain(
      '1. Pick a recorded case. 2. Press Play, or Next step, and watch the status line. ' +
        '3. Open the red bell and the yellow letter to read what the models wrote.',
    );
  });

  it('asks for a case before one is picked, and keeps the three buttons off', () => {
    const html = renderToStaticMarkup(<ReplayBar replay={control(null)} paused={false} refresh={refresh} />);
    expect(text(html)).toContain('Pick a recorded case to begin.');
    expect(text(html)).not.toContain('Step 1');
    expect(text(html)).toContain(RECORDED_BUTTONS_OFF);
    expect(html.match(/<button /g)?.length).toBe(3);
    expect(html.match(/<button [^>]*disabled=""/g)?.length).toBe(3);
  });

  it('says where the run is, which case it is and how the recording was made', () => {
    const html = renderToStaticMarkup(<ReplayBar replay={control(RECORDED_SAMPLE)} paused={false} refresh={refresh} />);
    const line = text(html);
    expect(line).toContain(`Step 1 of ${RECORDED_SAMPLE.frames.length}`);
    expect(line).toContain(RECORDED_SAMPLE.title);
    expect(line).toContain(RECORDED_SAMPLE.madeHow);
    expect(line).toContain('Recorded run. Buttons that change things are switched off.');
    // The step count is the part a screen reader is told when it changes.
    expect(html).toMatch(/<span class="replay-count" role="status" aria-live="polite"><strong>Step 1 of \d+<\/strong><\/span>/);
    // The sentence about the case is in the tooltip of the title.
    expect(html).toContain(RECORDED_SAMPLE.about);
    expect(html).not.toContain('—');
  });

  it('offers Play, Next step and Start again, each a native button', () => {
    const html = renderToStaticMarkup(<ReplayBar replay={control(RECORDED_SAMPLE)} paused={false} refresh={refresh} />);
    const buttons = [...html.matchAll(/<button type="button"[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]);
    expect(buttons).toEqual(['Play', 'Next step', 'Start again']);
    expect(html).not.toMatch(/<button [^>]*disabled=""/);
  });

  it('shows the sentence of a step that a script entered while that step is on the screen', () => {
    const noted = RECORDED_SAMPLE.frames.findIndex((frame) => frame.note !== '');
    expect(noted).toBeGreaterThan(0);
    const before = text(renderToStaticMarkup(<ReplayBar replay={control(RECORDED_SAMPLE, 0)} paused={false} refresh={refresh} />));
    expect(before).not.toContain(RECORDED_SAMPLE.frames[noted]!.note);
    const html = renderToStaticMarkup(<ReplayBar replay={control(RECORDED_SAMPLE, noted)} paused={false} refresh={refresh} />);
    expect(text(html)).toContain(`Step ${noted + 1} of ${RECORDED_SAMPLE.frames.length}`);
    expect(html).toContain(`<span role="status">${RECORDED_SAMPLE.frames[noted]!.note}</span>`);
  });

  it('switches Next step off on the last step', () => {
    const last = RECORDED_SAMPLE.frames.length - 1;
    const html = renderToStaticMarkup(<ReplayBar replay={control(RECORDED_SAMPLE, last)} paused={false} refresh={refresh} />);
    expect(html).toMatch(/<button type="button" class="btn btn-quiet btn-small" disabled="">Next step<\/button>/);
    expect(html).toMatch(/<button type="button" class="btn btn-quiet btn-small">Start again<\/button>/);
  });
});

describe('RecordedRunPicker', () => {
  it('asks the judge to pick a case', () => {
    const html = renderToStaticMarkup(<RecordedRunPicker replay={control(null)} refresh={refresh} />);
    expect(text(html)).toContain('Pick a recorded case to play.');
  });

  it('says how the recording that is loaded was made', () => {
    const html = renderToStaticMarkup(<RecordedRunPicker replay={control(RECORDED_SAMPLE)} refresh={refresh} />);
    expect(text(html)).toContain(RECORDED_SAMPLE.madeHow);
  });
});
