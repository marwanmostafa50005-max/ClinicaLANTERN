// What GET /api/state adds to the saved state: the counts, and one plain line saying what is running now.
import { anyCriteriaScreenedAgain, SCREENED_AGAIN } from '../shared/screenedAgain.ts';
import type { AppState, CaseRecord, Counts, Finding, LanternConfig, Letter, NowRunning } from '../shared/types.ts';
import { DEFAULT_CONFIG } from '../pipeline/config.ts';
import { screenParts } from '../pipeline/screen.ts';
import { linesForModels } from './questions.ts';

/** True when the case is waiting for Model 1 to read its scanned pages, or for the pharmacist to confirm the rows. */
export function awaitsTranscription(c: CaseRecord): boolean {
  return c.source === 'pdf-image' && !c.transcriptionConfirmed;
}

/**
 * A finding reaches the bell when the second check confirmed it, when the second check could not
 * be completed, or when its answer is unclear (it said "not confirmed" but named lines as proof).
 * The check may hide a finding only with a plain, completed "no".
 */
export function reachedTheBell(f: Finding): boolean {
  return f.check !== undefined && (f.check.confirmed || !f.check.completed || f.check.unclear === true);
}

/** True only when Model 2 really confirmed the finding: the check was completed and its answer was yes. */
export function confirmedByTheCheck(f: Finding): boolean {
  return f.check !== undefined && f.check.completed && f.check.confirmed;
}

/**
 * A history counts as screened only when every criterion has a result. A criterion that could not
 * be screened is never "no finding", so such a history is not counted as screened.
 */
export function fullyScreened(c: CaseRecord): boolean {
  return c.screening.status === 'done' && !c.screening.criteria.some(run => run.status === 'failed');
}

/** A sent letter with no reply after the due time is overdue. */
export function isOverdue(letter: Letter, now: Date): boolean {
  if (letter.status !== 'sent' || !letter.dueAt) return false;
  const due = Date.parse(letter.dueAt);
  return Number.isFinite(due) && now.getTime() > due;
}

export function computeCounts(state: AppState, now: Date): Counts {
  const letters = state.letters;
  return {
    historiesScreened: state.cases.filter(fullyScreened).length,
    // Only what Model 2 confirmed. A finding shown because the check did not finish is not "confirmed".
    findingsConfirmed: state.findings.filter(confirmedByTheCheck).length,
    accepted: state.findings.filter(f => f.state === 'accepted').length,
    bypassed: state.findings.filter(f => f.state === 'bypassed').length,
    lettersReady: letters.filter(l => l.status === 'ready').length,
    lettersSent: letters.filter(l => l.sentAt !== undefined).length,
    repliesRecorded: letters.filter(l => l.reply !== undefined).length,
    closed: letters.filter(l => l.status === 'closed').length,
    overdue: letters.filter(l => isOverdue(l, now)).length,
    bellBadge: state.findings.filter(f => f.state === 'confirmed' && !f.seenByPharmacist).length,
    letterBadge: letters.filter(l => l.status === 'ready' && !l.seenByPharmacist).length
  };
}

/** Disputed findings that still wait for the pharmacist. A decision (accept anyway, bypass or dismiss) takes one off this count. */
export function disputedWaiting(state: AppState): number {
  return state.findings.filter(f => f.state === 'not_confirmed' && f.decision === undefined).length;
}

export interface Progress {
  page?: number;                      // while Model 1 reads scanned pages
  pages?: number;
  part?: number;                      // while Model 1 screens a long history; 0 while the listed lines are read together
  parts?: number;
}

function many(n: number, one: string, more: string): string {
  return `${n} ${n === 1 ? one : more}`;
}

type ModelNames = LanternConfig['modelNames'];

/**
 * Used only when a caller has no settings. The replay player in src calls this without names, and its
 * recorded run was saved with these words. The server always passes the names from lantern.config.json.
 */
const NAMES_WHEN_NONE_ARE_GIVEN: ModelNames = { screen: 'Model 1', check: 'Model 2', letter: 'Model 3' };

/** A queued job with this detail is waiting because the model server could not be reached. It is not a failure. */
export const HELD_FOR_MODELS = 'Waiting. The local model server is not answering. This step starts again when it does.';

/** The status line, and GET /api/health modelsNote, when the warm-up could not reach the models. */
export const MODELS_NOT_RUNNING = 'The local models are not running.';

/** Said on the status line while this history still has criteria to screen. */
export const PASS_NOT_FINISHED = 'This pass is not finished.';

/** One plain line: "Mantle is screening: criterion 14 of 413", "Lumen is double-checking 2 findings", "Idle". */
export function computeNow(
  state: AppState, progress: Progress = {}, names: ModelNames = NAMES_WHEN_NONE_ARE_GIVEN,
  cfg: LanternConfig = DEFAULT_CONFIG
): NowRunning {
  // The same line the page already shows. The extra sentence is only while an answer has taken findings off.
  const say = (now: NowRunning): NowRunning => {
    if (!anyCriteriaScreenedAgain(state)) return now;
    const gap = now.text.endsWith('.') ? ' ' : '. ';
    return { stage: now.stage, text: `${now.text}${gap}${SCREENED_AGAIN}` };
  };
  const running = state.jobs.find(j => j.status === 'running');
  const queued = state.jobs.filter(j => j.status === 'queued');
  if (!running) {
    const held = queued.find(j => (j.detail ?? '').startsWith('Waiting. The local model server'));
    if (held) return say({ stage: held.stage, text: 'The local models are not running. This step starts again when they answer.' });
    if (queued.length > 0) return say({ stage: queued[0].stage, text: 'Starting the next step' });
    return say({ stage: null, text: 'Idle' });
  }

  if (running.warmup) return say({ stage: 'screen', text: `Warming up ${names.screen}` });

  if (running.stage === 'screen') {
    const c = state.cases.find(x => x.id === running.caseId);
    const waiting = queued.filter(j => j.stage === 'screen').length;
    const more = waiting > 0 ? `. ${many(waiting, 'more history is', 'more histories are')} waiting` : '';
    if (c && awaitsTranscription(c)) {
      const page = progress.page && progress.pages ? `: page ${progress.page} of ${progress.pages}` : '';
      return say({ stage: 'screen', text: `${names.screen} is reading a scanned page${page}${more}` });
    }
    const runs = c?.screening.criteria ?? [];
    const total = runs.length;
    // How many are checked so far, including the one in progress. Not its place in the list:
    // a listed medicine is screened before a criterion that sits earlier in the list.
    const finished = runs.filter(r => r.status !== 'waiting' && r.status !== 'running').length;
    const at = total === 0 ? 0 : Math.min(total, finished + 1);
    const where = total > 0 ? `: criterion ${at} of ${total}` : '';
    let parts = '';
    const currentParts = c ? Math.max(c.parts, screenParts(cfg, linesForModels(c.lines)).length) : 1;
    if (c && currentParts > 1) {
      if (progress.parts && progress.part) parts = ` (long history, part ${progress.part} of ${progress.parts})`;
      else if (progress.parts && progress.part === 0) parts = ' (long history, reading the listed lines together)';
      else parts = ` (long history, read in ${currentParts} parts)`;
    }
    const still = total > 0 && runs.some(r => r.status === 'waiting' || r.status === 'running');
    const open = still ? `. ${PASS_NOT_FINISHED}` : '';
    return say({ stage: 'screen', text: `${names.screen} is screening${where}${parts}${more}${open}` });
  }

  if (running.stage === 'check') {
    const left = Math.max(1, state.findings.filter(f => f.state === 'suspected').length);
    return say({ stage: 'check', text: `${names.check} is double-checking ${many(left, 'finding', 'findings')}` });
  }

  // A letter job for a finding that is no longer accepted must not be announced as writing.
  const findingId = running.findingId;
  const finding = findingId ? state.findings.find(f => f.id === findingId) : undefined;
  const gone = !!findingId && (!finding || finding.state !== 'accepted');
  if (gone) {
    if (queued.length > 0) return say({ stage: queued[0].stage, text: 'Starting the next step' });
    return say({ stage: null, text: 'Idle' });
  }
  const left = Math.max(1, state.letters.filter(l => l.status === 'drafting').length);
  return say({ stage: 'letter', text: `${names.letter} is writing ${many(left, 'letter', 'letters')}` });
}
