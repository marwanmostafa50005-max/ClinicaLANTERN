// The judges' view: a recorded real run, played step by step. No model and no server is needed.
// The recording is the state file of a real run on the entrant's computer, with the criteria that
// were in use. Nothing in it is invented here: every state shown is the recorded state as it was
// at the time of one entry of the activity log.
// Pure code: no browser, no server. The counts and the status line come from the same code the
// live server uses (server/view.ts), so a recorded run reads exactly as the live one did.
import type { Activity, AppState, CaseRecord, Criterion, Finding, Job, Letter, StateResponse } from '../../shared/types.ts';
import { computeCounts, computeNow, reachedTheBell } from '../../server/view.ts';

export interface Recording {
  /** One sentence saying what was recorded, and when. */
  note: string;
  /** How the run was made, for example "npm run smoke". */
  how: string;
  recordedAt: string;
  criteria: Criterion[];
  state: AppState;
}

export interface ReplayStep {
  /** The time of the activity entry, in milliseconds. */
  at: number;
  /** The words of the activity entry, as the server logged them. */
  text: string;
  kind: Activity['kind'];
}

const ms = (iso: string | undefined): number => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
};

/** One step for each entry of the activity log, in the order things happened. */
export function stepsOf(state: AppState): ReplayStep[] {
  return state.activity
    .map((a) => ({ at: ms(a.at), text: a.text, kind: a.kind }))
    .filter((step) => Number.isFinite(step.at))
    .sort((a, b) => a.at - b.at);
}

/** The time of the first activity entry that fits, or "never". */
function when(state: AppState, fits: (a: Activity) => boolean): number {
  let first = Number.POSITIVE_INFINITY;
  for (const a of state.activity) {
    if (fits(a)) first = Math.min(first, ms(a.at));
  }
  return first;
}

function caseAt(final: AppState, c: CaseRecord, t: number): CaseRecord {
  const copy = structuredClone(c);
  const about = (a: Activity): boolean => a.caseId === c.id;
  let startedAt = ms(c.importedAt);

  if (c.source === 'pdf-image') {
    const readAt = when(final, (a) => about(a) && a.text.startsWith('Model 1 read '));
    const confirmedAt = when(final, (a) => about(a) && a.text.startsWith('The pharmacist confirmed '));
    if (t < readAt) {
      copy.lines = [];
      delete copy.scanNotes;
    }
    if (t < confirmedAt) copy.transcriptionConfirmed = false;
    startedAt = confirmedAt;
  }
  if (c.cannotAssess) {
    // A CSV or a PDF with text is found unreadable when it is imported. A scan is found unreadable
    // later: the reason is shown from the last entry about it. Until then it is still being read.
    if (c.source === 'pdf-image') {
      let knownAt = Number.NEGATIVE_INFINITY;
      for (const a of final.activity) {
        if (about(a)) knownAt = Math.max(knownAt, ms(a.at));
      }
      if (t < knownAt) delete copy.cannotAssess;
    }
    return copy;
  }

  const finishedAt = ms(c.screening.finishedAt);
  if (finishedAt <= t) return copy;

  // Not finished at this time: each criterion keeps its result only from the entry that reported it.
  const resultAt = (criterionId: string): number =>
    when(final, (a) => about(a) && a.criterionId === criterionId && a.findingId === undefined &&
      (a.kind === 'screen' || (a.kind === 'error' && a.text.includes('could not')))) ;
  const suspectedAt = (criterionId: string): number =>
    when(final, (a) => about(a) && a.criterionId === criterionId && a.kind === 'screen' && a.findingId !== undefined);
  let live = t >= startedAt;
  copy.screening.criteria = c.screening.criteria.map((run) => {
    const doneAt = Math.min(resultAt(run.criterionId), suspectedAt(run.criterionId));
    if (doneAt <= t) return { ...run };
    const status = live ? 'running' : 'waiting';
    live = false;                               // only the first criterion without a result is being screened
    return { criterionId: run.criterionId, status };
  });
  copy.screening.status = t >= startedAt ? 'running' : c.source === 'pdf-image' ? 'not_started' : 'waiting';
  delete copy.screening.finishedAt;
  if (t < startedAt) delete copy.screening.startedAt;
  return copy;
}

function findingAt(final: AppState, f: Finding, t: number): Finding | null {
  const createdAt = Math.min(
    when(final, (a) => a.findingId === f.id && a.kind === 'screen'),
    ms(f.screen.at) + f.screen.seconds * 1000 + 60_000,     // a recording with no such entry: shown a little late, never early
  );
  if (createdAt > t) return null;
  const copy = structuredClone(f);
  const decidedAt = ms(f.decision?.at);
  if (f.decision && decidedAt <= t) return copy;
  delete copy.decision;
  copy.seenByPharmacist = false;
  const checkedAt = f.check
    ? Math.min(
      when(final, (a) => a.findingId === f.id && (a.kind === 'check' || (a.kind === 'error' && a.text.includes('second check')))),
      decidedAt,
    )
    : Number.POSITIVE_INFINITY;
  if (f.check && checkedAt <= t) {
    copy.state = reachedTheBell(f) ? 'confirmed' : 'not_confirmed';
    return copy;
  }
  delete copy.check;
  copy.state = 'suspected';
  return copy;
}

function letterAt(final: AppState, letter: Letter, t: number): Letter | null {
  const finding = final.findings.find((f) => f.id === letter.findingId);
  const acceptedAt = ms(finding?.decision?.at);
  if (acceptedAt > t) return null;
  const copy = structuredClone(letter);
  const readyAt = letter.draft
    ? Math.min(when(final, (a) => a.letterId === letter.id && a.kind === 'letter'), ms(letter.sentAt), ms(letter.closedAt))
    : Number.POSITIVE_INFINITY;
  if (!letter.draft || readyAt > t) {
    return {
      id: letter.id, findingId: letter.findingId, caseId: letter.caseId, status: 'drafting',
      subject: '', body: '', editedByPharmacist: false, seenByPharmacist: false,
    };
  }
  // The letter as it stood at this time: later steps are taken off again.
  const editedAt = when(final, (a) => a.letterId === letter.id && a.text.includes('saved changes'));
  if (letter.editedByPharmacist && t < editedAt) {
    copy.subject = letter.draft.subject;
    copy.body = letter.draft.body;
    copy.editedByPharmacist = false;
  }
  if (ms(letter.patientAgreed?.at) > t) delete copy.patientAgreed;
  if (ms(letter.closedAt) > t) delete copy.closedAt;
  if (ms(letter.reply?.at) > t) delete copy.reply;
  if (ms(letter.sentAt) > t) {
    delete copy.sentAt;
    delete copy.sentBy;
    delete copy.dueAt;
  }
  copy.status = copy.closedAt ? 'closed' : copy.reply ? 'reply_recorded' : copy.sentAt ? 'sent' : 'ready';
  copy.seenByPharmacist = copy.status !== 'ready';
  return copy;
}

/** The one step that was running at this time, so the status line reads as it did in the live run. */
function jobsAt(state: AppState): Job[] {
  const scan = state.cases.find((c) => c.source === 'pdf-image' && !c.transcriptionConfirmed && !c.cannotAssess && c.lines.length === 0);
  if (scan) return [{ id: 'J0001', stage: 'screen', caseId: scan.id, status: 'running' }];
  const screening = state.cases.find((c) => !c.cannotAssess && c.screening.status === 'running');
  if (screening) return [{ id: 'J0001', stage: 'screen', caseId: screening.id, status: 'running' }];
  const checking = state.findings.find((f) => f.state === 'suspected');
  if (checking) return [{ id: 'J0001', stage: 'check', caseId: checking.caseId, findingId: checking.id, status: 'running' }];
  const drafting = state.letters.find((l) => l.status === 'drafting');
  if (drafting) return [{ id: 'J0001', stage: 'letter', caseId: drafting.caseId, findingId: drafting.findingId, status: 'running' }];
  return [];
}

/** The recorded state as it was at one time. */
export function stateAt(final: AppState, t: number): AppState {
  const state: AppState = {
    version: 1,
    cases: final.cases.filter((c) => ms(c.importedAt) <= t).map((c) => caseAt(final, c, t)),
    findings: final.findings.map((f) => findingAt(final, f, t)).filter((f): f is Finding => f !== null),
    letters: final.letters.map((l) => letterAt(final, l, t)).filter((l): l is Letter => l !== null),
    jobs: [],
    activity: final.activity.filter((a) => ms(a.at) <= t),
  };
  state.jobs = jobsAt(state);
  return state;
}

/** What GET /api/state would have answered at that step of the recorded run. */
export function responseAt(recording: Recording, stepIndex: number): StateResponse {
  const steps = stepsOf(recording.state);
  const index = Math.max(0, Math.min(steps.length - 1, stepIndex));
  const t = steps.length === 0 ? Date.parse(recording.recordedAt) : steps[index].at;
  // The last step shows the recording exactly as it was saved.
  const state = index >= steps.length - 1 ? structuredClone(recording.state) : stateAt(recording.state, t);
  const now = new Date(Number.isFinite(t) ? t : 0);
  return {
    state,
    counts: computeCounts(state, now),
    now: computeNow(state),
    serverTime: now.toISOString(),
    recorded: true,
  };
}
