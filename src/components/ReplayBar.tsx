import { useCallback, useEffect, useState } from 'react';
import { RECORDED_BUTTONS_OFF } from '../lib/replayBackend.ts';
import type { ReplayControl } from '../lib/replayBackend.ts';
import { AlertIcon } from './glyphs.tsx';

interface ReplayBarProps {
  replay: ReplayControl;
  /** True while a panel is open. The run does not move on behind an open panel. */
  paused: boolean;
  refresh(): Promise<void>;
}

/** The three steps for a judge. They are shown in one line. */
const GUIDE = [
  '1. Pick a recorded case.',
  '2. Press Play, or Next step, and watch the status line.',
  '3. Open the red bell and the yellow letter to read what the models wrote.',
];

/**
 * The judges' view: the guide, where the run is, and the play controls, in one white card at the
 * foot of the top band. The picker of recorded cases is in the import panel.
 */
export function ReplayBar({ replay, paused, refresh }: ReplayBarProps) {
  const player = replay.player();
  const total = player?.frameCount ?? 0;
  const index = player?.frameIndex ?? 0;
  const [playing, setPlaying] = useState(false);
  const [waitCaption, setWaitCaption] = useState<string | null>(null);

  const sync = useCallback(() => {
    void refresh();
  }, [refresh]);

  const next = useCallback(() => {
    const moved = replay.nextFrame();
    setWaitCaption(null);
    sync();
    return moved;
  }, [replay, sync]);

  const startAgain = useCallback(() => {
    replay.startAgain();
    setPlaying(false);
    setWaitCaption(null);
    sync();
  }, [replay, sync]);

  // While the run plays, a wait that is cut short is said in words, with the real time. The words
  // go when the next wait is not cut, and when another case is picked, so they never stay beside
  // a step they are not about.
  useEffect(() => {
    setWaitCaption(null);
  }, [player]);

  useEffect(() => {
    if (!playing || paused || !player || player.atEnd()) return;
    setWaitCaption(player.waitBeforeNext().caption);
  }, [playing, paused, player, index]);

  useEffect(() => {
    if (!playing || paused || !player || player.atEnd()) return;
    const { ms } = player.waitBeforeNext();
    const timer = window.setTimeout(() => {
      if (!replay.nextFrame()) setPlaying(false);
      else sync();
    }, ms);
    return () => window.clearTimeout(timer);
  }, [playing, paused, player, index, replay, sync]);

  const note = player?.frameNote() ?? '';
  const madeHow = replay.madeHow();
  const title = replay.title();
  const about = replay.about();

  return (
    <section className="replay" aria-label="Recorded run controls">
      <p className="replay-note">{GUIDE.join(' ')}</p>

      {/* Everything that changes from step to step is on this one line: where the run is, a step
          that a script entered in place of the pharmacist, and a wait that was cut short. When the
          line is full, the title of the case gives way, never the other words. */}
      <p className="replay-step">
        <span className="replay-count" role="status" aria-live="polite">
          {total > 0 ? (
            <strong>
              Step {index + 1} of {total}
            </strong>
          ) : (
            'Pick a recorded case to begin.'
          )}
        </span>
        {total > 0 && title ? (
          <>
            {' '}
            {/* The sentence about the case is in the list of recorded cases. Here it is a tooltip, so the bar stays low. */}
            <span className="replay-title" title={[title, about].filter(Boolean).join('\n')}>
              {title}
            </span>
          </>
        ) : null}
        {note ? (
          <>
            {' '}
            <span role="status">{note}</span>
          </>
        ) : null}
        {waitCaption ? (
          <>
            {' '}
            <span className="replay-wait" role="status">
              {waitCaption}
            </span>
          </>
        ) : null}
      </p>

      {/* How the recording was made, and why the buttons are off. These words stay the same while the run plays. */}
      <p className="replay-note">
        {madeHow ? (
          <>
            <span>{madeHow}</span>{' '}
          </>
        ) : null}
        <span>{RECORDED_BUTTONS_OFF}</span>
      </p>

      <div className="btn-row replay-buttons">
        <button
          type="button"
          className="btn btn-primary btn-small"
          disabled={total === 0}
          onClick={() => setPlaying((v) => !v)}
        >
          {playing && !paused && !player?.atEnd() ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="btn btn-quiet btn-small" disabled={total === 0 || player?.atEnd()} onClick={() => next()}>
          Next step
        </button>
        <button type="button" className="btn btn-quiet btn-small" disabled={total === 0} onClick={() => startAgain()}>
          Start again
        </button>
      </div>
    </section>
  );
}

/** Lists recorded cases for the import orb in replay mode. Each case is one card that can be pressed. */
export function RecordedRunPicker({
  replay,
  refresh,
}: {
  replay: ReplayControl;
  refresh(): Promise<void>;
}) {
  const [runs, setRuns] = useState<{ file: string; title: string; about: string }[]>([]);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const list = await replay.fetchIndex();
      if (!alive) return;
      setRuns(list.runs);
      setEmptyMessage(list.emptyMessage);
    })();
    return () => {
      alive = false;
    };
  }, [replay]);

  const pick = async (file: string) => {
    setLoading(file);
    setLoadError(null);
    const err = await replay.loadRunFile(file);
    setLoading(null);
    if (err) {
      setLoadError(err);
      return;
    }
    await refresh();
  };

  return (
    <div className="replay-picker">
      <p className="credit">Pick a recorded case to play.</p>
      {emptyMessage ? (
        <p className="note note--warn" role="status">
          <AlertIcon /> {emptyMessage}
        </p>
      ) : null}
      {loadError ? (
        <p className="note note--error" role="alert">
          <AlertIcon /> {loadError}
        </p>
      ) : null}
      {runs.length > 0 ? (
        <ul className="replay-run-list">
          {runs.map((run) => (
            <li key={run.file}>
              <button
                type="button"
                className="case replay-run-row"
                disabled={loading !== null}
                onClick={() => void pick(run.file)}
              >
                <span className="case-file">{run.title}</span>
                <span className="case-note">{run.about}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {replay.madeHow() && replay.title() ? <p className="credit">{replay.madeHow()}</p> : null}
    </div>
  );
}
