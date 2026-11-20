import { useId, useState } from 'react';
import { criterionWaitsOnAnswer } from '../../shared/facts.ts';
import { criteriaScreenedAgain, SCREENED_AGAIN } from '../../shared/screenedAgain.ts';
import type { CaseRecord, CriterionRunStatus, Finding, HistoryLine, StateResponse } from '../../shared/types.ts';
import { api, errorText, isMock, isReplay, isReplayMock } from '../api.ts';
import { JOB_NAMES, type DisplayNames } from '../lib/modelNames.ts';
import { NO_IMPORT, RECORDED_BUTTONS_OFF } from '../lib/replayBackend.ts';
import type { ReplayControl } from '../lib/replayBackend.ts';
import { RecordedRunPicker } from './ReplayBar.tsx';
import type { CriterionView } from '../lib/criteria.ts';
import { notFullyScreened, scanNeedsCheck } from '../lib/events.ts';
import { formatDateTime, patientWords, plural } from '../lib/format.ts';
import { checksStillWaitingWords } from './BellPanel.tsx';
import { HistoryLines } from './HistoryLines.tsx';
import { Panel } from './Panel.tsx';
import { AlertIcon, CheckIcon, MagnifierGlyph, UploadIcon } from './glyphs.tsx';

/** Where the file the pharmacist chose is up to. */
export type ImportJob =
  | { step: 'idle' }
  | { step: 'working'; fileName: string; text: string }
  | { step: 'done'; fileName: string; caseId: string; notes: string[]; warnings: string[] }
  | { step: 'error'; fileName: string; message: string };

interface ImportPanelProps {
  snap: StateResponse | null;
  criteria: Record<string, CriterionView>;
  job: ImportJob;
  /** Pictures of scans imported in this tab, by case ID, so rows can be checked against them. */
  previews: Record<string, string[]>;
  /** True while a file is being dragged over the page. */
  dragging: boolean;
  /** Said when the local models are not ready, so the pharmacist knows before he imports. Null when they are. */
  modelsNote: string | null;
  /** The note of the page when it does not show a live run (sample data, or a recorded run). */
  pageNote?: string;
  replay?: ReplayControl;
  onFiles(files: File[]): void;
  refresh(): Promise<void>;
  onClose(): void;
  onOpenBell(): void;
  /** Display names from the health response. Mantle, Lumen and Ogee when health has not arrived. */
  names?: DisplayNames;
}

const SOURCE_WORDS: Record<CaseRecord['source'], string> = {
  csv: 'CSV',
  'pdf-text': 'PDF with text',
  'pdf-image': 'Read from a scan',
};

/**
 * With more criteria than this the bars are drawn smaller and in several rows, so that one bar
 * for each of 413 criteria still fits the card at phone width.
 */
export const MANY_BARS = 40;

const RUN_WORDS: Record<CriterionRunStatus, string> = {
  waiting: 'waiting',
  running: 'being screened now',
  clear: 'no finding suspected',
  suspected: 'finding suspected',
  failed: 'could not be screened',
};

/**
 * The one-line result of a finished screening. "No finding was suspected" is said only when every
 * criterion ran: a criterion that could not be screened is never "no finding".
 */
export function screeningHeadline(c: CaseRecord): string {
  const runs = c.screening.criteria;
  const failed = runs.filter((run) => run.status === 'failed').length;
  const suspected = runs.filter((run) => run.status === 'suspected').length;
  const found =
    suspected === 0
      ? ''
      : `${plural(suspected, 'finding was', 'findings were')} suspected and passed to the second check.`;
  if (failed === 0) {
    return `Screened against ${plural(runs.length, 'criterion', 'criteria')}. ${found || 'No finding was suspected.'}`;
  }
  return (
    `Screened against ${runs.length - failed} of ${plural(runs.length, 'criterion', 'criteria')}. ` +
    `${failed} could not be screened. ${found}`
  ).trim();
}

/**
 * A short summary after screening: findings under the bell, any disputed because the two models
 * disagree, in plain words. Empty when there is nothing to say.
 */
export function screeningSummary(findings: Finding[]): string {
  const waiting = findings.filter((f) => f.state === 'confirmed');
  const disputed = findings.filter((f) => f.state === 'not_confirmed' && f.check?.completed === true && f.check.confirmed === false);
  if (waiting.length === 0 && disputed.length === 0) return '';
  const parts: string[] = [];
  if (waiting.length > 0) parts.push(`${plural(waiting.length, 'finding is', 'findings are')} waiting under the bell`);
  if (disputed.length > 0) parts.push(`${plural(disputed.length, 'is', 'are')} disputed because the two models disagree`);
  return parts.join('; ') + '.';
}

/** What became of the findings of one history, in one sentence. Empty when there is none. */
export function outcomeWords(findings: Finding[]): string {
  const count = (state: Finding['state']): number => findings.filter((f) => f.state === state).length;
  const parts: string[] = [];
  const add = (n: number, one: string, many: string): void => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  add(count('suspected'), 'is waiting for the second check', 'are waiting for the second check');
  add(count('confirmed'), 'is waiting for you under the bell', 'are waiting for you under the bell');
  add(count('not_confirmed'), 'was not confirmed by the second check', 'were not confirmed by the second check');
  add(count('accepted'), 'was accepted by you', 'were accepted by you');
  add(count('bypassed'), 'was bypassed by you', 'were bypassed by you');
  if (parts.length === 0) return '';
  return `What became of the ${findings.length === 1 ? 'finding' : `${findings.length} findings`}: ${parts.join(', ')}.`;
}

interface PageOfRows {
  page: number;
  lines: HistoryLine[];
}

/** The rows of a scan, page by page, with every page of the scan in the list, also a page that gave no rows. */
export function rowsByPage(c: CaseRecord): PageOfRows[] | null {
  const pages = c.pages ?? 0;
  if (pages < 1 || c.lines.some((line) => typeof line.page !== 'number')) return null;
  return Array.from({ length: pages }, (_, i) => ({ page: i + 1, lines: c.lines.filter((line) => line.page === i + 1) }));
}

/**
 * The criteria still marked waiting, when every one of them is held by an open question.
 * Null when any of them would still be screened: that history is truly queued.
 * A possible finding's question does not hold a check.
 */
function openAnswersHolding(c: CaseRecord): { checks: number; questions: number } | null {
  const waiting = c.screening.criteria.filter((run) => run.status === 'waiting' || run.status === 'running');
  if (waiting.length === 0) return null;
  const questions = (c.questions ?? []).filter((q) =>
    q.criterionIds.some((id) => criterionWaitsOnAnswer(q, id) && waiting.some((run) => run.criterionId === id))
  );
  const held = new Set(questions.flatMap((q) => q.criterionIds.filter((id) => criterionWaitsOnAnswer(q, id))));
  if (!waiting.every((run) => held.has(run.criterionId))) return null;
  return { checks: waiting.length, questions: questions.length };
}

interface CaseCardProps {
  c: CaseRecord;
  findings: Finding[];
  /** True while this history waits behind another job. */
  queued: boolean;
  criteria: Record<string, CriterionView>;
  previews: string[] | undefined;
  refresh(): Promise<void>;
  onOpenBell(): void;
  names?: DisplayNames;
}

function CaseCard({ c, findings, queued, criteria, previews, refresh, onOpenBell, names = JOB_NAMES }: CaseCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The rows as the pharmacist is correcting them, one row on each line. Null while he is only reading.
  const [rowsText, setRowsText] = useState<string | null>(null);
  // True while the pictures of the pages are shown at full size, so the print in them can be read.
  const [largePictures, setLargePictures] = useState(false);
  const rowsId = useId();

  const runs = c.screening.criteria;
  const label = (criterionId: string): string => criteria[criterionId]?.label ?? criterionId;
  const failed = runs.filter((run) => run.status === 'failed');
  const finished = runs.filter((run) => run.status === 'clear' || run.status === 'suspected' || run.status === 'failed').length;
  const runningAt = runs.findIndex((run) => run.status === 'running');
  const started = runs.some((run) => run.status !== 'waiting');
  const underBell = findings.filter((f) => f.state === 'confirmed').length;
  const needsCheck = scanNeedsCheck(c);
  const readingScan = c.source === 'pdf-image' && !c.transcriptionConfirmed && !c.cannotAssess && c.lines.length === 0;
  const unfinished = notFullyScreened(c);
  const outcome = outcomeWords(findings);
  const summary = screeningSummary(findings);
  const clearWithReason = runs.filter((run) => run.status === 'clear' && run.reason);

  // The pictures of the pages: those kept in this tab, or else the ones the server still holds.
  const pictures = previews && previews.length > 0 ? previews : needsCheck ? api.pagePictures(c.id, c.pages ?? 0) : [];
  const byPage = rowsByPage(c);

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    // Rows the pharmacist corrected are sent; they replace what the model read.
    const original = c.lines.map((line) => line.text);
    const edited = rowsText === null ? null : rowsText.split('\n').map((row) => row.trim()).filter((row) => row !== '');
    if (edited !== null && edited.length === 0) {
      setError('There are no rows left. Put the rows back, or import the file again.');
      return;
    }
    const changed = edited !== null && (edited.length !== original.length || edited.some((row, i) => row !== original[i]));
    void act(() => api.confirmTranscription(c.id, changed ? edited : undefined));
  };

  let status: string;
  let tone: 'plain' | 'busy' | 'warn' | 'ok' = 'plain';
  if (c.cannotAssess) {
    status = `Cannot assess: ${c.cannotAssess}`;
    tone = 'warn';
  } else if (readingScan) {
    status = queued
      ? `Waiting in line. ${names.screen} will read the rows from the scan.`
      : `${names.screen} is reading the rows from the scan. This can take one to three minutes for each page.`;
    tone = 'busy';
  } else if (needsCheck) {
    status = 'Waiting for you to check the rows. Screening has not started.';
    tone = 'warn';
  } else if (c.screening.status === 'waiting') {
    const held = queued ? null : openAnswersHolding(c);
    status = held
      ? checksStillWaitingWords(held.checks, held.questions)
      : `Waiting in line for ${names.screen}.`;
    tone = 'busy';
  } else if (c.screening.status === 'running') {
    status =
      runningAt >= 0
        ? `${names.screen} is screening: criterion ${runningAt + 1} of ${runs.length}.`
        : `${names.screen} is screening this history.`;
    tone = 'busy';
  } else if (c.screening.status === 'done') {
    status = screeningHeadline(c);
    tone = failed.length > 0 ? 'warn' : 'ok';
  } else if (c.screening.status === 'interrupted') {
    status = 'Screening was interrupted before it finished. This history is not fully screened.';
    tone = 'warn';
  } else {
    status = 'Not screened yet.';
  }
  if (criteriaScreenedAgain(c)) status = `${status} ${SCREENED_AGAIN}`;

  const pictureOf = (page: number): string | undefined => pictures[page - 1];

  return (
    <article className="case">
      <header className="case-head">
        <h4 className="case-file">{c.fileName}</h4>
        <span className={`tag${c.source === 'pdf-image' ? ' tag--warn' : ''}`}>{SOURCE_WORDS[c.source]}</span>
      </header>
      <p className="case-meta">
        {patientWords(c.patient)}. Imported {formatDateTime(c.importedAt)}. {plural(c.lines.length, 'line', 'lines')}
        {c.source === 'pdf-image' && c.pages ? ` from ${plural(c.pages, 'page', 'pages')}` : ''}.
      </p>

      <p className={`case-status case-status--${tone}`}>
        {tone === 'warn' ? <AlertIcon /> : tone === 'ok' ? <CheckIcon /> : tone === 'busy' ? <span className="spinner" aria-hidden="true" /> : null}
        <span>{status}</span>
      </p>

      {started ? (
        <>
          <ol
            className={runs.length > MANY_BARS ? 'segments segments--many' : 'segments'}
            aria-label={`Screening progress: ${finished} of ${runs.length} criteria finished`}
          >
            {runs.map((run) => (
              <li key={run.criterionId} className={`segment segment--${run.status}`} title={`${label(run.criterionId)}: ${RUN_WORDS[run.status]}`}>
                <span className="sr-only">
                  {label(run.criterionId)}: {RUN_WORDS[run.status]}
                </span>
              </li>
            ))}
          </ol>
          <p className="segments-key">
            One bar for each criterion. <span className="key key--clear">Blue-green</span>: no finding suspected.{' '}
            <span className="key key--suspected">Red</span>: a finding was suspected.{' '}
            <span className="key key--failed">Striped</span>: could not be screened. <span className="key key--waiting">Grey</span>: waiting.
          </p>
        </>
      ) : null}

      {failed.length > 0 ? (
        <hgroup className="failed-screening">
          <p className="note note--warn">
            <AlertIcon /> {plural(failed.length, 'criterion', 'criteria')} could not be screened. This is not the same
            as no finding.
          </p>
          <details className="failed-list">
            <summary>Open the list of {failed.length} criteria that could not be screened</summary>
            <ul>
              {failed.map((run) => (
                <li key={run.criterionId}>
                  {label(run.criterionId)}
                  {run.error ? ` — ${run.error}` : ''}
                </li>
              ))}
            </ul>
          </details>
        </hgroup>
      ) : null}

      {unfinished && !isReplay ? (
        <div className="btn-row">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act(() => api.screenAgain(c.id))}>
            {busy ? 'Starting' : 'Screen again what has no result'}
          </button>
          <span className="btn-hint">
            The criteria that have a result keep it. Do this when the local models are running again.
          </span>
        </div>
      ) : null}

      {c.parts > 1 && !c.cannotAssess ? (
        <p className="case-note">
          {`This history is long. ${names.screen} reads it in ${c.parts} overlapping parts. Then it reads the lines that hold a listed medicine together, so two supplies far apart are seen side by side.`}
        </p>
      ) : null}

      {summary || outcome ? (
        <p className="case-note">
          {[summary, outcome].filter((part) => part !== '').join(' ')}{' '}
          {underBell > 0 ? (
            <button type="button" className="link-btn" onClick={onOpenBell}>
              Open the bell
            </button>
          ) : null}
        </p>
      ) : null}

      {error && !needsCheck ? (
        <p className="note note--error" role="alert">
          {error}
        </p>
      ) : null}

      {needsCheck ? (
        <div className="scan-check">
          <h5>Read from a scan: please check</h5>
          <p>
            {`${names.screen} read these rows from the pictures of the pages. Compare each row with the paper, page by page. Screening starts only after you confirm.`}
          </p>
          {c.scanNotes && c.scanNotes.length > 0 ? (
            <div className="note note--warn note--stack" role="alert">
              <p>
                <AlertIcon /> Please look at this first:
              </p>
              <ul>
                {c.scanNotes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {rowsText === null && byPage ? (
            // Page by page: the picture of a page beside the rows read from it, with the count for each page.
            byPage.map(({ page, lines }) => (
              <section key={page} className="scan-page" aria-label={`Page ${page} of ${byPage.length}`}>
                <h6 className={lines.length === 0 ? 'scan-page-title scan-page-title--warn' : 'scan-page-title'}>
                  Page {page} of {byPage.length}:{' '}
                  {lines.length === 0 ? 'no rows were read' : plural(lines.length, 'row', 'rows')}
                </h6>
                <div className={pictureOf(page) ? (largePictures ? 'scan-pair scan-pair--stack' : 'scan-pair') : undefined}>
                  {pictureOf(page) ? (
                    <div className={largePictures ? 'scan-pages scan-pages--large' : 'scan-pages'} tabIndex={0} role="group" aria-label={`The picture of page ${page}`}>
                      <img src={pictureOf(page)} alt={`Scanned page ${page}`} />
                    </div>
                  ) : null}
                  {lines.length > 0 ? (
                    <div
                      className="lines-box lines-box--scroll"
                      tabIndex={0}
                      role="region"
                      aria-label={`Rows read from page ${page}`}
                    >
                      <HistoryLines lines={lines} label={`Rows read from page ${page}`} names={names} />
                    </div>
                  ) : (
                    <p className="note note--warn">
                      No rows were read from this page. If the page holds supplies, do not confirm.
                    </p>
                  )}
                </div>
              </section>
            ))
          ) : (
            <div className={pictures.length > 0 ? (largePictures ? 'scan-pair scan-pair--stack' : 'scan-pair') : undefined}>
              {pictures.length > 0 ? (
                <div className={largePictures ? 'scan-pages scan-pages--large' : 'scan-pages'} tabIndex={0} role="group" aria-label="The scanned pages">
                  {pictures.map((src, i) => (
                    <img key={i} src={src} alt={`Scanned page ${i + 1}`} />
                  ))}
                </div>
              ) : null}
              {rowsText === null ? (
                <div
                  className="lines-box lines-box--scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Rows read from the scan"
                >
                  <HistoryLines lines={c.lines} label="Rows read from the scan" names={names} />
                </div>
              ) : (
                <div className="rows-edit">
                  <label htmlFor={rowsId} className="field-label">
                    Correct the rows here. One row on each line, with the date first.
                  </label>
                  <textarea
                    id={rowsId}
                    className="rows-box"
                    rows={Math.min(14, Math.max(6, c.lines.length + 1))}
                    spellCheck={false}
                    value={rowsText}
                    onChange={(e) => setRowsText(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}
          {pictures.length > 0 ? (
            <button type="button" className="link-btn" aria-pressed={largePictures} onClick={() => setLargePictures((v) => !v)}>
              {largePictures
                ? `Show the ${pictures.length === 1 ? 'picture' : 'pictures'} smaller`
                : `Show the ${pictures.length === 1 ? 'picture' : 'pictures'} larger, to read the print`}
            </button>
          ) : (
            <p className="case-note">The pictures of the pages are not on this computer any more. Check the rows against the paper.</p>
          )}
          {error ? (
            <p className="note note--error" role="alert">
              {error}
            </p>
          ) : null}
          {!isReplay ? (
            <div className="btn-row">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={confirm}>
                <CheckIcon /> {busy ? 'Saving' : 'The rows are right. Start screening'}
              </button>
              {rowsText === null ? (
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={busy}
                  onClick={() => setRowsText(c.lines.map((line) => line.text).join('\n'))}
                >
                  Correct a row
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={busy}
                  onClick={() => {
                    setRowsText(null);
                    setError(null);
                  }}
                >
                  Undo my corrections
                </button>
              )}
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void act(() => api.discardScan(c.id))}>
                Discard this scan
              </button>
              <span className="btn-hint">
                If the scan is hard to read, do not confirm. Discard it, then import a clearer scan or a CSV file.
              </span>
            </div>
          ) : null}
        </div>
      ) : c.lines.length > 0 ? (
        <details className="case-lines">
          <summary>Show the {plural(c.lines.length, 'line', 'lines')}</summary>
          <p className="case-note">Each line has a number. L030 is line 30 of this history.</p>
          <div
            className="lines-box lines-box--scroll"
            tabIndex={0}
            role="region"
            aria-label={`Lines of ${c.fileName}`}
          >
            <HistoryLines lines={c.lines} label={`Lines of ${c.fileName}`} names={names} />
          </div>
        </details>
      ) : null}

      {clearWithReason.length > 0 ? (
        <details className="case-lines">
          <summary>{`Show what ${names.screen} wrote for the criteria it found clear`}</summary>
          <ul className="clear-reasons">
            {clearWithReason.map((run) => (
              <li key={run.criterionId}>
                <strong>{label(run.criterionId)}:</strong> {run.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}

/** The import panel: choose or drop one dispensing history, then see what happened to each one. */
export function ImportPanel({
  snap, criteria, job, previews, dragging, modelsNote, pageNote, replay, onFiles, refresh, onClose, onOpenBell,
  names = JOB_NAMES,
}: ImportPanelProps) {
  const fileInputId = useId();
  const working = job.step === 'working';
  const cases = [...(snap?.state.cases ?? [])].reverse();
  const findings = snap?.state.findings ?? [];
  const jobs = snap?.state.jobs ?? [];
  // The green "was imported" note is not shown for a history that cannot be assessed: that is not good news.
  const imported = job.step === 'done' ? cases.find((c) => c.id === job.caseId) : undefined;
  const cannotAssess = imported?.cannotAssess;

  return (
    <Panel name="import" title="Import a dispensing history" icon={<MagnifierGlyph />} note={pageNote} onClose={onClose}>
      <div className="panel-inner">
        {isReplay ? (
          <>
            <p className="note note--warn">
              <AlertIcon /> {NO_IMPORT}
            </p>
            <p className="note">{RECORDED_BUTTONS_OFF}</p>
            {isReplayMock && replay?.title() ? (
              <p className="credit">{replay.madeHow()}</p>
            ) : replay ? (
              <RecordedRunPicker replay={replay} refresh={refresh} />
            ) : null}
          </>
        ) : (
          <div className={`dropzone${dragging ? ' dropzone--over' : ''}`}>
            <UploadIcon className="dropzone-icon" />
            <p className="dropzone-title">Drop one dispensing history here, or choose a file</p>
            <div className="file-field">
              <input
                id={fileInputId}
                type="file"
                className="file-input"
                disabled={working}
                accept=".csv,.pdf,.png,.jpg,.jpeg,text/csv,application/pdf,image/png,image/jpeg"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (files.length > 0) onFiles(files);
                }}
              />
              <label htmlFor={fileInputId} className="btn btn-primary btn-large file-label">
                Choose a file
              </label>
            </div>
            <p className="dropzone-help">
              {`CSV or PDF. A scan or a photo of a printed history (PDF, PNG or JPEG) can be tried: ${names.screen} reads the rows and you check every row. One patient in each file.`}
            </p>
            <p className="dropzone-help">
              The file may also list the patient&apos;s known conditions and recent test results.
            </p>
            <p className="dropzone-help dropzone-help--warn">
              Import fictional histories only. Do not import a real dispensing record.
            </p>
            {isMock ? (
              <p className="dropzone-help">
                This is the sample view. A file you import here is read by the page but is not screened.
              </p>
            ) : null}
          </div>
        )}

        {modelsNote ? (
          <p className="note note--warn" role="alert">
            <AlertIcon /> {modelsNote}
          </p>
        ) : null}

        <div role="status" aria-live="polite">
          {job.step === 'working' ? (
            <p className="note note--busy">
              <span className="spinner" aria-hidden="true" />
              <span>
                <strong>{job.fileName}</strong>: {job.text}.
              </span>
            </p>
          ) : null}
          {job.step === 'done' ? (
            <div className={cannotAssess ? 'note note--warn' : 'note note--ok'}>
              {cannotAssess ? <AlertIcon /> : <CheckIcon />}
              <div>
                {cannotAssess ? (
                  <p>
                    <strong>{job.fileName}</strong> was read, but it was not screened. Cannot assess: {cannotAssess}
                  </p>
                ) : (
                  <p>
                    <strong>{job.fileName}</strong> was imported.
                  </p>
                )}
                {job.notes.map((note, i) => (
                  <p key={i}>{note}</p>
                ))}
              </div>
            </div>
          ) : null}
          {job.step === 'done' && job.warnings.length > 0 ? (
            <div className="note note--warn note--stack">
              <p>
                <AlertIcon /> Please take a look:
              </p>
              <ul>
                {job.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        {job.step === 'error' ? (
          <p className="note note--error" role="alert">
            <AlertIcon />
            <span>
              <strong>{job.fileName}</strong> was not imported. {job.message}
            </span>
          </p>
        ) : null}

        <h3 className="section-title">Histories</h3>
        {!snap ? <p className="empty">Waiting for the local server.</p> : null}
        {snap && cases.length === 0 ? <p className="empty">No history has been imported yet.</p> : null}
        {cases.map((c) => (
          <CaseCard
            key={c.id}
            c={c}
            findings={findings.filter((f) => f.caseId === c.id)}
            queued={jobs.some((j) => j.caseId === c.id && j.stage === 'screen' && j.status === 'queued')}
            criteria={criteria}
            previews={previews[c.id]}
            refresh={refresh}
            onOpenBell={onOpenBell}
            names={names}
          />
        ))}
      </div>
    </Panel>
  );
}
