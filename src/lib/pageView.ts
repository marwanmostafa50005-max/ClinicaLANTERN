// Which view the page shows. The words beside a button are chosen by it, so that they are true in
// every view: in the sample view no model writes a letter, and in a recorded run nothing is decided.

/**
 * 'live': the local server and the three models.
 * 'sample': sample data, no server and no model (?mock=1).
 * 'recorded': a recorded run, played frame by frame (the judges' build, or ?replay=1).
 * 'made_up_recording': the recording made up from the sample data (?replay=1&mock=1).
 */
export type PageView = 'live' | 'sample' | 'recorded' | 'made_up_recording';

/** The view, from the two switches of the page address (and of the judges' build). */
export function pageViewOf(replay: boolean, mock: boolean): PageView {
  if (replay) return mock ? 'made_up_recording' : 'recorded';
  return mock ? 'sample' : 'live';
}

/** True where nothing can be changed: a recorded run, real or made up. */
export function isRecordedView(view: PageView): boolean {
  return view === 'recorded' || view === 'made_up_recording';
}
