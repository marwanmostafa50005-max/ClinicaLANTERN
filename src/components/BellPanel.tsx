import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CaseRecord, Finding, PharmacistQuestion, StateResponse } from '../../shared/types.ts';
import { criterionWaitsOnAnswer, isFactLine, isPossible } from '../../shared/facts.ts';
import { criteriaScreenedAgain, SCREENED_AGAIN } from '../../shared/screenedAgain.ts';
import { findingLines } from '../../shared/lines.ts';
import { api, errorText, isReplay, pageView } from '../api.ts';
import type { CriterionView } from '../lib/criteria.ts';
import { countNotFullyScreened } from '../lib/events.ts';
import { notShownWords } from '../lib/facts.ts';
import {
  decidedFindings,
  disputedFindings,
  failedScreens,
  filterWaiting,
  groupWaitingByHistory,
  lumenLineIds,
  mantleLineIds,
  orderWaitingInGroup,
  shouldShowSearch,
  waitingFindings,
} from '../lib/findings.ts';
import { formatDateTime, formatShortDate, patientWords, plural } from '../lib/format.ts';
import { JOB_NAMES, type DisplayNames } from '../lib/modelNames.ts';
import { isRecordedView } from '../lib/pageView.ts';
import type { PageView } from '../lib/pageView.ts';
import { RECORDED_BUTTONS_OFF } from '../lib/replayBackend.ts';
import { HistoryLines } from './HistoryLines.tsx';
import { Panel } from './Panel.tsx';
import { afterReadRefusal, answerFromReading, datesForReadings, typeItMyself } from '../lib/pathologyAnswer.ts';
import { PathologyFileError, preparePathologyUpload, type PathologyResponse } from '../lib/pathologyFile.ts';
import { PathologyNothingRead, PathologyReadings, PathologyUploadPanel, PathologyWays, TypedResultForm } from './PathologyUpload.tsx';
import { AlertIcon, BellGlyph, CheckIcon } from './glyphs.tsx';

interface BellPanelProps {
  snap: StateResponse | null;
  criteria: Record<string, CriterionView>;
  /** False until the first call for the criteria has ended, well or badly. */
  criteriaLoaded: boolean;
  /** The note of the page when it does not show a live run (sample data, or a recorded run). */
  pageNote?: string;
  refresh(): Promise<void>;
  onClose(): void;
  onOpenLetters(): void;
  onOpenImport(): void;
  /** Display names from the health response. Mantle, Lumen and Ogee when health has not arrived. */
  names?: DisplayNames;
}

/** What the pharmacist did with a finding while this panel is open. Each leaves a short receipt where its card was. */
type DecidedHere = 'accept' | 'bypass' | 'accept_anyway' | 'dismiss';

/** The list of criteria that could not be screened is open while it is this short. A longer one is closed until it is opened. */
const SHORT_LIST = 5;

/**
 * The line beside the buttons of a finding: what Accept does, or why the buttons are switched off.
 * It is true in every view. In a recorded run it does not say who decided: a script may have
 * entered the steps of the pharmacist, and a finding may be undecided in the frame that is shown.
 * In the sample view no model is connected, so it does not say that a model writes the letter.
 */
export function decideHintWords(view: PageView, names: DisplayNames = JOB_NAMES): string {
  switch (view) {
    case 'made_up_recording':
      return 'This is the made-up recording of the sample view. Nothing is decided here.';
    case 'recorded':
      return 'This is a recorded run. Nothing is decided here.';
    case 'sample':
      return 'Sample data: Accept shows a sample letter under the letter icon. No model writes it.';
    case 'live':
      return `Accept sends the finding to ${names.letter} for a letter to the doctor.`;
  }
}

/** What the receipt of an accepted finding says about its letter. In the sample view no model writes one. */
export function letterToComeWords(sampleView: boolean, names: DisplayNames = JOB_NAMES): string {
  return sampleView
    ? 'A sample letter will show under the letter icon.'
    : `${names.letter} will write the letter. It will show under the letter icon.`;
}

/**
 * The line above the findings that wait, after their count: what to do with them.
 * In a recorded run nothing is decided, so the line does not ask to accept or bypass.
 */
export function waitingLedeRest(view: PageView): string {
  return isRecordedView(view)
    ? ' waiting at this step of the recording.'
    : ' waiting for you. Read the evidence, then accept or bypass each one.';
}

/** The whole line above the findings that wait: how many there are, and what to do with them. */
export function waitingLedeWords(count: number, view: PageView): string {
  return `${plural(count, 'finding is', 'findings are')}${waitingLedeRest(view)}`;
}

/**
 * The line under the heading of the findings the two models disagree on. In a recorded run the two
 * buttons are switched off, so the line does not say that one can still be accepted or dismissed.
 */
export function disputedIntroWords(view: PageView, names: DisplayNames = JOB_NAMES): string {
  const what = `${names.screen} suspected these and ${names.check} did not confirm them.`;
  return isRecordedView(view) ? what : `${what} You can still accept one if you disagree with the second check, or dismiss it.`;
}

/** The sample view and the made-up recording: no model writes their letters. */
const sample = pageView === 'sample' || pageView === 'made_up_recording';

/**
 * The lines to highlight, by the one rule the letter and the scorer use too (shared/lines.ts):
 * the lines of the second check, and the lines of the first model kept as well. Lines that only
 * the first model named are marked as such.
 */
export function linesToShow(finding: Finding, c: CaseRecord | undefined): { hits: Set<string>; firstModelOnly: Set<string> } {
  const known = new Set((c?.lines ?? []).map((line) => line.id));
  const lines = findingLines(finding);
  return {
    hits: new Set(lines.all.filter((id) => known.has(id))),
    firstModelOnly: new Set(lines.byCheck.length > 0 ? lines.byScreenOnly.filter((id) => known.has(id)) : []),
  };
}

/**
 * What a dispensing history cannot show. The criterion's own words come first: they are the signed
 * text. What the second check added is shown after them, as the model's words.
 */
export function cannotSeeWords(finding: Finding, criterion: CriterionView | undefined): { own: string; added: string } {
  const own = (criterion?.cannotBeSeen ?? '').trim();
  const check = finding.check;
  const fromModel = check && check.completed ? check.whatCannotBeSeen.trim() : '';
  return { own, added: fromModel !== '' && fromModel !== own ? fromModel : '' };
}

/**
 * What the pharmacist decided, for the list of findings already decided.
 * "Accepted anyway" is a finding that the second check had turned back.
 */
export function decidedWords(finding: Finding): 'Accepted' | 'Accepted anyway' | 'Bypassed' | 'Dismissed' {
  if (finding.decision?.action === 'dismiss') return 'Dismissed';
  if (finding.state === 'bypassed') return 'Bypassed';
  const check = finding.check;
  const turnedBack = check !== undefined && check.completed && !check.confirmed && check.unclear !== true;
  return turnedBack ? 'Accepted anyway' : 'Accepted';
}

interface CriterionBlockProps {
  criterion: CriterionView | undefined;
  criterionId: string;
  loaded: boolean;
}

/** The criterion's source text with its credit line. This is the evidence the pharmacist is shown. */
function CriterionBlock({ criterion, criterionId, loaded }: CriterionBlockProps) {
  if (!criterion && !loaded) {
    return <p className="credit">Loading the text of the criterion.</p>;
  }
  if (!criterion) {
    return (
      <p className="note note--warn" role="alert">
        <AlertIcon /> The text of criterion {criterionId} could not be loaded from the local server. Do not decide on
        this finding until the text is shown.
      </p>
    );
  }
  const signed = criterion.signedBy;
  return (
    <>
      <blockquote className="criterion-text">{criterion.statement}</blockquote>
      {criterion.credit ? <p className="credit">{criterion.credit}</p> : null}
      {criterion.modificationNotice ? <p className="credit">{criterion.modificationNotice}</p> : null}
      {criterion.rule ? (
        <p className="credit">
          <strong>What the models were asked to look for:</strong> {criterion.rule}
        </p>
      ) : null}
      <p className="credit credit--small">
        {signed
          ? `Signed by the clinical reviewer: ${signed.name}${signed.date ? `, ${formatShortDate(signed.date) || signed.date}` : ''}.`
          : 'Draft criterion. Not yet signed by the clinical reviewer.'}
      </p>
    </>
  );
}

interface ReceiptProps {
  name: string;
  did: DecidedHere;
  /** A receipt inside a list is an entry of that list. */
  inList?: boolean;
  onOpenLetters(): void;
  names?: DisplayNames;
}

/** What stands where a card was, after the pharmacist decided on it here. */
function Receipt({ name, did, inList = false, onOpenLetters, names = JOB_NAMES }: ReceiptProps) {
  const Row = inList ? 'li' : 'p';
  return (
    <Row className="note note--ok receipt" role="status">
      <CheckIcon />
      {did === 'accept' || did === 'accept_anyway' ? (
        <span>
          <strong>
            {name}: {did === 'accept' ? 'accepted' : 'accepted anyway'}.
          </strong>{' '}
          {letterToComeWords(sample, names)}{' '}
          <button type="button" className="link-btn" onClick={onOpenLetters}>
            Open the letters
          </button>
        </span>
      ) : did === 'bypass' ? (
        <span>
          <strong>{name}: bypassed.</strong> Your reason was saved.
        </span>
      ) : (
        <span>
          <strong>{name}: dismissed.</strong> No letter is written.
        </span>
      )}
    </Row>
  );
}

interface FindingCardProps {
  finding: Finding;
  caseRecord: CaseRecord | undefined;
  criterion: CriterionView | undefined;
  criteriaLoaded: boolean;
  refresh(): Promise<void>;
  onDecided(action: 'accept' | 'bypass'): void;
  names?: DisplayNames;
}

function FindingCard({ finding, caseRecord, criterion, criteriaLoaded, refresh, onDecided, names = JOB_NAMES }: FindingCardProps) {
  const [bypassing, setBypassing] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'accept' | 'bypass' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [whole, setWhole] = useState(false);
  const headingId = useId();
  const reasonId = useId();
  const reasonBox = useRef<HTMLTextAreaElement>(null);
  const bypassButton = useRef<HTMLButtonElement>(null);
  const wasBypassing = useRef(false);

  const check = finding.check;
  const checkDone = check?.completed === true;
  const unclear = checkDone && check.unclear === true;
  const { hits, firstModelOnly } = useMemo(() => linesToShow(finding, caseRecord), [finding, caseRecord]);
  const lines = caseRecord?.lines ?? [];
  const noLines = hits.size === 0;
  const showWhole = whole || noLines;
  const cannotSee = cannotSeeWords(finding, criterion);
  // A possible finding: the medicines match, and the record holds no line about a fact the criterion needs.
  const possible = isPossible(finding);
  // A fact from the record (a condition, a result or an observation) is among the lines in view.
  const factInView = lines.some((line) => (showWhole || hits.has(line.id)) && isFactLine(line.text));
  // The criterion is marked for a review on the same day.
  const sameDay = criterion?.urgency === 'same_day';

  // The keyboard focus follows the bypass form: into the reason box when it opens, back to the
  // Bypass button when it closes. Without this the focus fell to the page and Escape did nothing.
  useEffect(() => {
    if (bypassing) reasonBox.current?.focus();
    else if (wasBypassing.current) bypassButton.current?.focus();
    wasBypassing.current = bypassing;
  }, [bypassing]);

  const decide = async (action: 'accept' | 'bypass') => {
    const text = reason.trim();
    if (action === 'bypass' && text.length < 3) {
      setError('Please give a short reason for the bypass.');
      reasonBox.current?.focus();
      return;
    }
    setBusy(action);
    setError(null);
    try {
      await api.decideFinding(finding.id, action === 'accept' ? { action } : { action, reason: text });
      onDecided(action);
      await refresh();
    } catch (err) {
      setError(errorText(err));
      setBusy(null);
    }
  };

  return (
    <article className="finding" aria-labelledby={headingId} data-finding-focus={finding.id} tabIndex={-1}>
      {/* Said first, in words and with a sign: it is not told by colour alone. */}
      {sameDay ? (
        <p className="note note--error possible-line" role="status">
          <AlertIcon />
          <span>
            <strong>Same day:</strong> this criterion is marked urgent. Please review it today.
          </span>
        </p>
      ) : null}

      <header className="finding-head">
        <div>
          <h3 id={headingId} className="finding-label">
            {criterion?.label ?? finding.criterionId}
          </h3>
          {criterion?.title ? <p className="finding-title">{criterion.title}</p> : null}
        </div>
        <div className="finding-meta">
          <span className="finding-patient">{patientWords(caseRecord?.patient)}</span>
          {caseRecord ? <span className="finding-file">{caseRecord.fileName}</span> : null}
        </div>
      </header>

      {/* Said above the evidence, so the evidence is read knowing that one fact is not in the record. */}
      {possible ? (
        <p className="note note--warn possible-line">
          <AlertIcon />
          <span>
            <strong>Possible finding.</strong> The record does not show: {notShownWords(finding, criterion?.needsFacts)}.
            The letter asks the doctor to confirm.
          </span>
        </p>
      ) : null}

      {!checkDone || unclear || !finding.screen.linesVerified ? (
        <div className="finding-tags">
          {!checkDone ? (
            <span className="tag tag--warn">
              <AlertIcon /> Second check not completed
            </span>
          ) : null}
          {unclear ? (
            <span className="tag tag--warn">
              <AlertIcon /> Second check unclear
            </span>
          ) : null}
          {!finding.screen.linesVerified ? (
            <span className="tag tag--warn" title={`${names.screen} named no line that exists in this history.`}>
              Lines not verified
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="finding-grid">
        <section className="finding-part">
          <h4>The criterion</h4>
          <CriterionBlock criterion={criterion} criterionId={finding.criterionId} loaded={criteriaLoaded} />
        </section>

        <section className="finding-part">
          <h4>{showWhole ? 'The dispensing history' : 'Lines the models pointed to'}</h4>
          {noLines ? (
            <p className="note note--warn">
              The models did not point to a line that exists. Please read the whole history.
            </p>
          ) : null}
          <div className={showWhole ? 'lines-box lines-box--scroll' : 'lines-box'}>
            <HistoryLines
              lines={lines}
              hits={hits}
              fromFirstModel={firstModelOnly}
              onlyHits={!showWhole}
              label={showWhole ? 'The whole dispensing history. The lines the models pointed to are marked.' : 'Lines the models pointed to'}
              names={names}
            />
          </div>
          <p className="credit credit--small">
            The models chose these lines. Check them against the criterion. Each line has a number: L030 is line 30 of
            this history.
            {factInView ? ' A line marked CONDITION, RESULT or OBSERVATION is a fact from the record, not a supply.' : ''}
          </p>
          {!noLines && lines.length > hits.size ? (
            <button type="button" className="link-btn" aria-expanded={whole} onClick={() => setWhole((v) => !v)}>
              {whole ? 'Show only the lines the models pointed to' : `Show the whole history (${plural(lines.length, 'line', 'lines')})`}
            </button>
          ) : null}
        </section>

        <section className="finding-part">
          <h4>{checkDone ? `What ${names.check} wrote in the second check` : `What ${names.screen} reported`}</h4>
          {checkDone ? (
            <>
              {unclear ? (
                <p className="note note--warn">
                  The second check is unclear. {names.check} answered "not confirmed" but named lines as proof. The
                  finding is shown so that it is not missed.
                </p>
              ) : null}
              <p className="model-words">{check.whatMatches || 'The second check confirmed the finding and gave no more detail.'}</p>
              <p className="credit credit--small">These are the model's own words, not a checked fact.</p>
            </>
          ) : (
            <>
              <p className="note note--warn">
                The second check was not completed, so this finding was not double-checked. It is shown so that it is
                not missed.
              </p>
              <p className="model-words">{finding.screen.reason}</p>
            </>
          )}
        </section>

        <section className="finding-part">
          <h4>What a dispensing history cannot show</h4>
          <p>{cannotSee.own || (cannotSee.added ? '' : 'Nothing was noted.')}</p>
          {cannotSee.added ? (
            <p className="model-words">
              <strong>{names.check} added:</strong> {cannotSee.added}
            </p>
          ) : null}
        </section>
      </div>

      {/* The decision stays in view at the bottom of the panel while the evidence above it is read. */}
      <footer className="finding-actions">
        {error ? (
          <p className="note note--error" role="alert">
            {error}
          </p>
        ) : null}
        {bypassing ? (
          <div className="bypass-form">
            <label htmlFor={reasonId}>Why are you bypassing this finding? Give a short reason.</label>
            <textarea
              id={reasonId}
              ref={reasonBox}
              rows={2}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                // Escape leaves the reason box first, not the whole panel.
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setBypassing(false);
                  setError(null);
                }
              }}
              placeholder="For example: the doctor already knows about this."
            />
            <div className="btn-row">
              {/* The reason is needed: the button stays off until there is text. */}
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy !== null || reason.trim() === ''}
                onClick={() => decide('bypass')}
              >
                {busy === 'bypass' ? 'Saving' : 'Bypass this finding'}
              </button>
              <button
                type="button"
                className="btn btn-quiet"
                disabled={busy !== null}
                onClick={() => {
                  setBypassing(false);
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-primary btn-large"
              disabled={busy !== null || !criterion || isReplay}
              onClick={() => decide('accept')}
            >
              <CheckIcon /> {busy === 'accept' ? 'Saving' : 'Accept'}
            </button>
            <button
              type="button"
              ref={bypassButton}
              className="btn btn-quiet btn-large"
              disabled={busy !== null || isReplay}
              onClick={() => setBypassing(true)}
            >
              Bypass
            </button>
            <span className="btn-hint">{decideHintWords(pageView, names)}</span>
          </div>
        )}
      </footer>
    </article>
  );
}

/** The lines one model named, or one plain sentence when it named none that this history holds. */
function NamedLines({ lines, ids, who }: { lines: CaseRecord['lines']; ids: string[]; who: string }) {
  const known = new Set(lines.map((line) => line.id));
  const hits = new Set(ids.filter((id) => known.has(id)));
  if (hits.size === 0) return <p className="credit credit--small">{who} named no line of this history.</p>;
  return <HistoryLines lines={lines} hits={hits} onlyHits label={`Lines ${who} named`} />;
}

interface DisputedItemProps {
  finding: Finding;
  caseRecord: CaseRecord | undefined;
  criterion: CriterionView | undefined;
  criteriaLoaded: boolean;
  refresh(): Promise<void>;
  onDecided(did: 'accept_anyway' | 'dismiss'): void;
  names?: DisplayNames;
}

/**
 * A finding the first model suspected and the second check turned back. It is not a failure and it
 * is never hidden: the criterion and both views are shown, each view with the lines it rests on,
 * and the pharmacist decides.
 */
function DisputedItem({ finding, caseRecord, criterion, criteriaLoaded, refresh, onDecided, names = JOB_NAMES }: DisputedItemProps) {
  const [accepting, setAccepting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'accept' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingId = useId();
  const reasonId = useId();
  const reasonBox = useRef<HTMLTextAreaElement>(null);
  const acceptButton = useRef<HTMLButtonElement>(null);
  const wasAccepting = useRef(false);
  const lines = caseRecord?.lines ?? [];

  // The keyboard focus follows the reason form: into the box when it opens, back to its button when it closes.
  useEffect(() => {
    if (accepting) reasonBox.current?.focus();
    else if (wasAccepting.current) acceptButton.current?.focus();
    wasAccepting.current = accepting;
  }, [accepting]);

  const decide = async (action: 'accept' | 'dismiss') => {
    const text = reason.trim();
    if (action === 'accept' && text.length < 3) {
      setError('Please give a short reason for accepting this finding anyway.');
      reasonBox.current?.focus();
      return;
    }
    setBusy(action);
    setError(null);
    try {
      await api.decideFinding(finding.id, action === 'accept' ? { action, reason: text } : { action });
      onDecided(action === 'accept' ? 'accept_anyway' : 'dismiss');
      await refresh();
    } catch (err) {
      setError(errorText(err));
      setBusy(null);
    }
  };

  return (
    <li className="grey-item grey-item--views" aria-labelledby={headingId} data-finding-focus={finding.id} tabIndex={-1}>
      {criterion?.urgency === 'same_day' ? (
        <p className="note note--error" role="status">
          <AlertIcon />
          <span>
            <strong>Same day:</strong> this criterion is marked urgent. Please review it today.
          </span>
        </p>
      ) : null}
      <p className="grey-head">
        <span id={headingId}>
          <strong>{criterion?.label ?? finding.criterionId}</strong>
          {criterion?.title ? `: ${criterion.title}` : ''}
        </span>
        <span className="grey-meta">
          {patientWords(caseRecord?.patient)}
          {caseRecord ? `, ${caseRecord.fileName}` : ''}
        </span>
      </p>

      <CriterionBlock criterion={criterion} criterionId={finding.criterionId} loaded={criteriaLoaded} />

      <div className="finding-grid">
        <section className="finding-part">
          <h4>{names.screen} suspected</h4>
          <p className="model-words">{finding.screen.reason || 'No reason was given.'}</p>
          <NamedLines lines={lines} ids={mantleLineIds(finding)} who={names.screen} />
        </section>
        <section className="finding-part">
          <h4>{names.check} turned it back</h4>
          <p className="model-words">{finding.check?.whatMatches || 'No reason was given.'}</p>
          <NamedLines lines={lines} ids={lumenLineIds(finding)} who={names.check} />
        </section>
      </div>

      {isPossible(finding) ? (
        <p>
          <span className="grey-who">Possible finding.</span> {names.screen} said the record does not show:{' '}
          {notShownWords(finding, criterion?.needsFacts)}. A letter would ask the doctor to confirm.
        </p>
      ) : null}

      {error ? (
        <p className="note note--error" role="alert">
          {error}
        </p>
      ) : null}

      {accepting ? (
        <div className="bypass-form">
          <label htmlFor={reasonId}>Why are you accepting this finding anyway? Give a short reason.</label>
          <textarea
            id={reasonId}
            ref={reasonBox}
            rows={2}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              // Escape leaves the reason box first, not the whole panel.
              if (e.key === 'Escape') {
                e.stopPropagation();
                setAccepting(false);
                setError(null);
              }
            }}
          />
          <div className="btn-row">
            {/* The reason is needed: the button stays off until there is text. */}
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy !== null || reason.trim() === ''}
              onClick={() => void decide('accept')}
            >
              {busy === 'accept' ? 'Saving' : 'Accept anyway'}
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              disabled={busy !== null}
              onClick={() => {
                setAccepting(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="btn-row">
          {/* In a recorded run the two buttons are shown and switched off, like Accept and Bypass. */}
          <button
            type="button"
            ref={acceptButton}
            className="btn btn-quiet btn-small"
            disabled={busy !== null || !criterion || isReplay}
            onClick={() => setAccepting(true)}
          >
            Accept anyway
          </button>
          <button
            type="button"
            className="btn btn-quiet btn-small"
            disabled={busy !== null || isReplay}
            onClick={() => void decide('dismiss')}
          >
            {busy === 'dismiss' ? 'Saving' : 'Dismiss'}
          </button>
          <span className="btn-hint">{decideHintWords(pageView, names)}</span>
        </div>
      )}
    </li>
  );
}

/** A finding still waits for the pharmacist: under the bell, or among those the two models disagree on. */
const stillOpen = (f: Finding | undefined): boolean =>
  f !== undefined && (f.state === 'confirmed' || (f.state === 'not_confirmed' && !f.decision));

/** Checks that have not run because their own standing or supply link is still open. */
function checksStillWaiting(cases: CaseRecord[]): string[] {
  const ids: string[] = [];
  for (const c of cases) {
    for (const q of c.questions ?? []) {
      for (const id of q.criterionIds) {
        if (!criterionWaitsOnAnswer(q, id)) continue;
        const key = `${c.id}:${id}`;
        if (!ids.includes(key)) ids.push(key);
      }
    }
  }
  return ids;
}

/** Open questions that hold a check back. A possible-finding link is not one of these. */
function openQuestionsHoldingChecks(cases: CaseRecord[]): number {
  let count = 0;
  for (const c of cases) {
    for (const q of c.questions ?? []) {
      if (q.criterionIds.some(id => criterionWaitsOnAnswer(q, id))) count += 1;
    }
  }
  return count;
}

/**
 * How many checks are waiting, and how many open questions they wait on.
 * "this question" follows the questions, not the checks.
 */
export function checksStillWaitingWords(checks: number, questions: number): string {
  const checksWords = checks === 1 ? '1 check' : `${checks} checks`;
  const questionWords = questions === 1 ? 'this question is answered' : 'these questions are answered';
  return `${checksWords} could not run until ${questionWords}.`;
}

/** Beside "Leave these unanswered": the criteria that wait are not screened. */
export const LEAVE_UNANSWERED_WORDS =
  'Leaving these unanswered keeps them open. The criteria that wait for them are not screened.';

/** Beside "Show the questions", after they were left unanswered. */
export const LEFT_UNANSWERED_WORDS =
  'These questions were left unanswered. They stay open, so the criteria that wait for them are not screened.';

/**
 * The engine refuses for a moment when this question's own criterion is the one being screened.
 * That is not a mistake in the answer.
 */
export function isOwnCriterionRefusal(message: string): boolean {
  return message.startsWith('The criterion for this question is being screened.');
}

/** The answer stays. The next press of it is the one that is saved. */
export function keptAnswerWords(words: string): string {
  return `${words} is kept. The criterion for this question is being screened at this moment. Press it again and it is saved.`;
}

/** The pressed answer says Saving until the server has taken it. */
export function answerButtonWords(saving: boolean, words: string): string {
  return saving ? 'Saving' : words;
}

/**
 * The questions for the pharmacist, drawn with the bell's existing parts. One fact is one question.
 * An answer is a line of the record. Nothing here decides a finding or sends a letter.
 */
function QuestionsForPharmacist({ cases, criteria, refresh }: {
  cases: CaseRecord[];
  criteria: Record<string, CriterionView>;
  refresh(): Promise<void>;
}) {
  const [listed, setListed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [savingWords, setSavingWords] = useState<string | null>(null);
  const [kept, setKept] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, { value: string; unit: string; date: string }>>({});
  const [way, setWay] = useState<Record<string, 'type' | 'upload'>>({});
  const [readingFile, setReadingFile] = useState<string | null>(null);
  const [held, setHeld] = useState<Record<string, { fileName: string; response: PathologyResponse }>>({});
  const [filledDate, setFilledDate] = useState<Record<string, string>>({});
  const waiting = checksStillWaiting(cases);
  const openQuestions = openQuestionsHoldingChecks(cases);
  const rows = cases.flatMap((c) => (c.questions ?? []).map((q) => ({ c, q })));
  if (rows.length === 0) return null;

  const standingLine = (q: PharmacistQuestion): boolean =>
    q.source === 'patient' && q.status === 'open' && !q.needsValue && q.leftUnanswered !== true;
  const tuckedAway = (q: PharmacistQuestion): boolean =>
    q.leftUnanswered === true && q.source === 'patient' && q.status === 'open' && !q.needsValue;
  const standingByCase = cases
    .map((c) => ({ c, questions: (c.questions ?? []).filter(standingLine) }))
    .filter((row) => row.questions.length > 0);
  const tucked = rows.some(({ q }) => tuckedAway(q));
  const off = isReplay || busy !== null;

  const setField = (id: string, field: 'value' | 'unit' | 'date', value: string): void => {
    setDraft((prev) => ({
      ...prev,
      [id]: {
        value: prev[id]?.value ?? '',
        unit: prev[id]?.unit ?? '',
        date: prev[id]?.date ?? '',
        [field]: value,
      },
    }));
  };

  const uploadPathology = async (caseId: string, questionId: string, file: File): Promise<void> => {
    setBusy(questionId);
    setReadingFile('Opening the file');
    setError(null);
    try {
      const body = await preparePathologyUpload(file, setReadingFile);
      const response = await api.readPathology(caseId, questionId, body);
      setHeld((prev) => ({ ...prev, [questionId]: { fileName: body.fileName, response } }));
      setReadingFile(null);
    } catch (e) {
      setReadingFile(null);
      setHeld((prev) => {
        if (prev[questionId] === undefined) return prev;
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
      setWay((prev) => afterReadRefusal(prev, questionId));
      setError(e instanceof PathologyFileError ? e.message : errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const run = async (id: string, words: string, work: () => Promise<void>): Promise<void> => {
    setBusy(id);
    setSavingWords(words);
    setError(null);
    try {
      await work();
      setKept((prev) => {
        if (prev[id] === undefined) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await refresh();
    } catch (e) {
      const message = errorText(e);
      // The criterion of this question is being screened. Keep the answer for one more press.
      if (words !== '' && isOwnCriterionRefusal(message)) setKept((prev) => ({ ...prev, [id]: words }));
      else setError(message);
    } finally {
      setBusy(null);
      setSavingWords(null);
    }
  };

  return (
    <section className="finding-part">
      <h3 className="section-title">Questions for the pharmacist</h3>
      {waiting.length > 0 ? (
        <p className="note note--warn" role="alert">
          <AlertIcon />
          <span>
            {checksStillWaitingWords(waiting.length, openQuestions)}{' '}
            <button type="button" className="link-btn" aria-expanded={listed} onClick={() => setListed((open) => !open)}>
              {listed ? 'Hide the checks' : 'Show which checks'}
            </button>
          </span>
        </p>
      ) : null}
      {listed ? (
        <ul className="credit">
          {waiting.map((key) => {
            const id = key.slice(key.indexOf(':') + 1);
            return <li key={key}>{criteria[id]?.label ?? id}</li>;
          })}
        </ul>
      ) : null}
      {standingByCase.map(({ c, questions }) => (
        <div key={`standing-${c.id}`}>
          <p className="finding-title">{patientWords(c.patient)}</p>
          <ul className="question-list">
            {questions.map((q) => (
              <li key={q.id} className="question-line">
                <span>{q.conditionMarker?.question ?? q.what}</span>
                {q.note ? <span className="note">{q.note}</span> : null}
                {q.options.map((opt) => (
                  <button
                    key={opt.words}
                    type="button"
                    className="btn btn-quiet btn-small"
                    disabled={off}
                    onClick={() => void run(q.id, opt.words, () => api.answerQuestion(c.id, q.id, { option: opt.words }))}
                  >
                    {answerButtonWords(busy === q.id && savingWords === opt.words, opt.words)}
                  </button>
                ))}
                {kept[q.id] ? <span className="note">{keptAnswerWords(kept[q.id])}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {standingByCase.length > 0 ? (
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-quiet btn-small"
            disabled={off}
            onClick={() => void run('leave-standing', '', async () => {
              for (const row of standingByCase) await api.leaveStandingQuestions(row.c.id);
            })}
          >
            {answerButtonWords(busy === 'leave-standing', 'Leave these unanswered')}
          </button>
          <span className="btn-hint">{LEAVE_UNANSWERED_WORDS}</span>
        </div>
      ) : null}
      {tucked ? (
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-quiet btn-small"
            disabled={off}
            onClick={() => void run('show-standing', '', async () => {
              for (const row of cases) {
                if ((row.questions ?? []).some(tuckedAway)) await api.leaveStandingQuestions(row.id, true);
              }
            })}
          >
            Show the questions
          </button>
          <span className="btn-hint">{LEFT_UNANSWERED_WORDS}</span>
        </div>
      ) : null}
      {rows.filter(({ q }) => !standingLine(q) && !tuckedAway(q)).map(({ c, q }) => {
        const box = draft[q.id] ?? { value: '', unit: '', date: '' };
        const got = held[q.id];
        const uploadWay = (way[q.id] ?? 'type') === 'upload' && Boolean(q.pathology && q.pathology.tests.length > 0);
        const showRead = uploadWay && got !== undefined && got.response.readings.length > 0;
        const showEmpty = uploadWay && got !== undefined && got.response.readings.length === 0;
        const backToForm = (): void => {
          const next = typeItMyself({ way: 'upload', draft: box, showingReading: showRead });
          setWay((prev) => ({ ...prev, [q.id]: next.way }));
          setHeld((prev) => {
            if (prev[q.id] === undefined) return prev;
            const copy = { ...prev };
            delete copy[q.id];
            return copy;
          });
        };
        return (
          <article key={q.id} className="finding">
            <h3 className="finding-label">{q.conditionMarker?.question ?? q.what}</h3>
            <p className="finding-title">{patientWords(c.patient)}</p>
            {q.note ? <p className="note">{q.note}</p> : null}
            {q.status === 'open' ? (
              <>
                {q.needsValue ? (
                  <>
                    {q.pathology && q.pathology.tests.length > 0 ? (
                      <PathologyWays
                        way={way[q.id] ?? 'type'}
                        disabled={off}
                        onType={backToForm}
                        onUpload={() => setWay((prev) => ({ ...prev, [q.id]: 'upload' }))}
                      />
                    ) : null}
                    {showRead && got ? (
                      <PathologyReadings
                        fact={q.what}
                        readings={got.response.readings}
                        collectedDate={got.response.collected?.date}
                        dateNote={got.response.dateNote}
                        note={got.response.note}
                        abstained={got.response.abstained}
                        idPrefix={`${q.id}-read`}
                        dates={datesForReadings(filledDate, q.id, got.response.readings.length)}
                        disabled={off}
                        typingForm={
                          <TypedResultForm
                            id={q.id}
                            draft={box}
                            disabled={off}
                            saving={busy === q.id}
                            saveWords={answerButtonWords(busy === q.id, 'Save this answer')}
                            onValue={(value) => setField(q.id, 'value', value)}
                            onUnit={(value) => setField(q.id, 'unit', value)}
                            onDate={(value) => setField(q.id, 'date', value)}
                            onSave={() => void run(q.id, box.value.trim() || 'This answer', () => api.answerQuestion(c.id, q.id, { value: box.value, unit: box.unit, date: box.date }))}
                          />
                        }
                        onDate={(index, value) => setFilledDate((prev) => ({ ...prev, [`${q.id}:${index}`]: value }))}
                        onUse={(reading, date) => {
                          const body = answerFromReading(q.what, got.fileName, reading, date);
                          void run(q.id, body.value, () => api.answerQuestion(c.id, q.id, body));
                        }}
                        onTypeMyself={backToForm}
                      />
                    ) : showEmpty && got ? (
                      <PathologyNothingRead
                        note={got.response.note}
                        abstained={got.response.abstained}
                        typingForm={
                          <TypedResultForm
                            id={q.id}
                            draft={box}
                            disabled={off}
                            saving={busy === q.id}
                            saveWords={answerButtonWords(busy === q.id, 'Save this answer')}
                            onValue={(value) => setField(q.id, 'value', value)}
                            onUnit={(value) => setField(q.id, 'unit', value)}
                            onDate={(value) => setField(q.id, 'date', value)}
                            onSave={() => void run(q.id, box.value.trim() || 'This answer', () => api.answerQuestion(c.id, q.id, { value: box.value, unit: box.unit, date: box.date }))}
                          />
                        }
                      />
                    ) : uploadWay && q.pathology ? (
                      <PathologyUploadPanel
                        tests={q.pathology.tests}
                        progress={busy === q.id ? readingFile : null}
                        disabled={off}
                        inputId={`${q.id}-pathology-file`}
                        onFile={(file) => void uploadPathology(c.id, q.id, file)}
                      />
                    ) : (
                      <TypedResultForm
                        id={q.id}
                        draft={box}
                        disabled={off}
                        saving={busy === q.id}
                        saveWords={answerButtonWords(busy === q.id, 'Save this answer')}
                        onValue={(value) => setField(q.id, 'value', value)}
                        onUnit={(value) => setField(q.id, 'unit', value)}
                        onDate={(value) => setField(q.id, 'date', value)}
                        onSave={() => void run(q.id, box.value.trim() || 'This answer', () => api.answerQuestion(c.id, q.id, { value: box.value, unit: box.unit, date: box.date }))}
                      />
                    )}
                  </>
                ) : null}
                <div className="btn-row">
                  {q.options.map((opt) => (
                    <button key={opt.words} type="button" className="btn btn-quiet" disabled={off} onClick={() => void run(q.id, opt.words, () => api.answerQuestion(c.id, q.id, { option: opt.words }))}>
                      {answerButtonWords(busy === q.id && savingWords === opt.words, opt.words)}
                    </button>
                  ))}
                </div>
                {kept[q.id] ? <p className="note">{keptAnswerWords(kept[q.id])}</p> : null}
              </>
            ) : null}
            {q.status === 'not_known' ? (
              <>
                <p>Not known. The question stays closed until you open it again.</p>
                <div className="btn-row">
                  <button type="button" className="btn btn-quiet" disabled={off} onClick={() => void run(q.id, '', () => api.reopenQuestion(c.id, q.id))}>
                    Open this question again
                  </button>
                </div>
              </>
            ) : null}
            {q.status === 'answered' && q.answer ? (
              <>
                <p>Answered: {q.answer.words}. This is a line of the record, not a letter.</p>
                <div className="btn-row">
                  <button type="button" className="btn btn-quiet" disabled={off} onClick={() => void run(q.id, '', () => api.takeBackQuestion(c.id, q.id))}>
                    Take this answer back
                  </button>
                </div>
              </>
            ) : null}
          </article>
        );
      })}
      {error ? <p className="note note--error" role="alert">{error}</p> : null}
    </section>
  );
}

/**
 * The bell panel: the confirmed findings that wait for the pharmacist, in groups by history; the
 * findings the two models disagree on; and what was already decided.
 */
export function BellPanel({ snap, criteria, criteriaLoaded, pageNote, refresh, onClose, onOpenLetters, onOpenImport, names = JOB_NAMES }: BellPanelProps) {
  // Findings decided while this panel is open. Each leaves a short receipt where its card was.
  const [decidedHere, setDecidedHere] = useState<Record<string, DecidedHere>>({});
  // The text in the search box. It changes only what this panel shows.
  const [filter, setFilter] = useState('');
  // The finding that was just decided. The keyboard focus goes on to the next one that waits.
  const justDecided = useRef<string | null>(null);
  const inner = useRef<HTMLDivElement>(null);
  const searchId = useId();
  const disputedId = useId();

  const findings = useMemo(() => snap?.state.findings ?? [], [snap]);
  const cases = useMemo(() => snap?.state.cases ?? [], [snap]);
  const caseById = useMemo(() => {
    const map = new Map<string, CaseRecord>();
    for (const c of cases) map.set(c.id, c);
    return map;
  }, [cases]);

  const waiting = waitingFindings(findings);
  const screenedAgain = cases.some(criteriaScreenedAgain);
  const stillChecking = findings.filter((f) => f.state === 'suspected').length;
  const disputed = disputedFindings(findings);
  const decided = decidedFindings(findings);
  const failed = failedScreens(cases, criteria);
  const notFully = snap ? countNotFullyScreened(snap.state) : 0;

  // The search box is there when more than twenty findings wait. Without the box no filter is on.
  const showSearch = shouldShowSearch(waiting.length);
  const query = showSearch ? filter : '';
  const filtering = query.trim() !== '';
  const shown = filterWaiting(waiting, cases, criteria, query);
  const shownIds = new Set(shown.map((f) => f.id));

  // What stands in the groups: the waiting findings the filter shows, and a receipt for each
  // finding decided here, in the place where its card was.
  const leftReceipt = (f: Finding): boolean =>
    (decidedHere[f.id] === 'accept' || decidedHere[f.id] === 'bypass') && (f.state === 'accepted' || f.state === 'bypassed');
  const inGroups = findings.filter((f) => (f.state === 'confirmed' && shownIds.has(f.id)) || leftReceipt(f));
  // One group for each imported history, in the order of the server. In a group, the findings of
  // criteria that the clinical reviewer has signed come first.
  const groups = groupWaitingByHistory(inGroups, cases).map((group) => ({
    ...group,
    waiting: orderWaitingInGroup(group.waiting, criteria),
  }));
  // A finding whose history is not in the list is shown all the same: nothing is ever dropped.
  const noHistory = inGroups.filter((f) => !caseById.has(f.caseId));

  // The findings the two models disagree on, and a receipt for each one decided here, in the order of the server.
  const disputedIds = new Set(disputed.map((f) => f.id));
  const inDisputed = findings.filter(
    (f) => disputedIds.has(f.id) || decidedHere[f.id] === 'accept_anyway' || decidedHere[f.id] === 'dismiss',
  );

  // Opening the bell marks confirmed findings as seen for the new-finding pop-up only; the red badge
  // counts findings still waiting for accept or bypass. A finding the filter hides is not marked seen.
  const asked = useRef(new Set<string>());
  const unseenKey = shown
    .filter((f) => !f.seenByPharmacist)
    .map((f) => f.id)
    .join(',');
  useEffect(() => {
    if (isReplay) return;
    const ids = unseenKey === '' ? [] : unseenKey.split(',').filter((id) => !asked.current.has(id));
    if (ids.length === 0) return;
    for (const id of ids) asked.current.add(id);
    Promise.all(ids.map((id) => api.markFindingSeen(id)))
      .then(refresh)
      .catch(() => {
        for (const id of ids) asked.current.delete(id);
      });
  }, [unseenKey, refresh]);

  // After a decision the keyboard focus goes to the next finding that waits: the one after it on
  // the page, or else the first one. When none is left it goes to the panel. The page is not
  // scrolled for this: the receipt is short, so the next card has already moved up into view.
  const orderKey = [...groups.flatMap((group) => group.waiting), ...noHistory, ...inDisputed].map((f) => f.id).join(',');
  useEffect(() => {
    const id = justDecided.current;
    if (id === null) return;
    // The card stays until the answer of the server is here. Then its receipt takes its place.
    if (stillOpen(findings.find((f) => f.id === id))) return;
    justDecided.current = null;
    const box = inner.current;
    if (!box) return;
    const ids = orderKey === '' ? [] : orderKey.split(',');
    const at = ids.indexOf(id);
    const round = at < 0 ? ids : [...ids.slice(at + 1), ...ids.slice(0, at)];
    const cards = [...box.querySelectorAll<HTMLElement>('[data-finding-focus]')];
    for (const next of round) {
      const card = cards.find((el) => el.dataset.findingFocus === next);
      if (card) {
        card.focus({ preventScroll: true });
        return;
      }
    }
    box.closest<HTMLElement>('.panel')?.focus({ preventScroll: true });
  }, [findings, orderKey]);

  const nameOf = (finding: Finding): string => criteria[finding.criterionId]?.label ?? finding.criterionId;

  const cardOrReceipt = (finding: Finding) =>
    finding.state === 'confirmed' ? (
      <FindingCard
        key={finding.id}
        finding={finding}
        caseRecord={caseById.get(finding.caseId)}
        criterion={criteria[finding.criterionId]}
        criteriaLoaded={criteriaLoaded}
        refresh={refresh}
        onDecided={(action) => {
          justDecided.current = finding.id;
          setDecidedHere((all) => ({ ...all, [finding.id]: action }));
        }}
        names={names}
      />
    ) : (
      <Receipt key={finding.id} name={nameOf(finding)} did={finding.state === 'accepted' ? 'accept' : 'bypass'} onOpenLetters={onOpenLetters} names={names} />
    );

  return (
    <Panel name="bell" title="Findings waiting for you" icon={<BellGlyph />} note={pageNote} onClose={onClose}>
      <div className="panel-inner" ref={inner}>
        {isReplay ? <p className="note">{RECORDED_BUTTONS_OFF}</p> : null}

        <QuestionsForPharmacist cases={cases} criteria={criteria} refresh={refresh} />

        {!snap ? <p className="empty">Waiting for the local server.</p> : null}

        {notFully > 0 ? (
          <p className="note note--warn" role="alert">
            <AlertIcon />
            <span>
              {plural(notFully, 'history was', 'histories were')} not fully screened. This is not the same as no
              finding.{' '}
              <button type="button" className="link-btn" onClick={onOpenImport}>
                See which
              </button>
            </span>
          </p>
        ) : null}

        {snap && waiting.length === 0 ? (
          <p className="empty">
            No findings are waiting for you.
            {stillChecking > 0
              ? ` ${names.check} still has ${plural(stillChecking, 'suspected finding', 'suspected findings')} to check.`
              : ''}
            {screenedAgain ? ` ${SCREENED_AGAIN}` : ''}
          </p>
        ) : null}

        {waiting.length > 0 ? (
          <p className="panel-lede">
            {/* The count and the words after it are two pieces of text, as they were when the look was approved. */}
            {plural(waiting.length, 'finding is', 'findings are')}
            {waitingLedeRest(pageView)}
            {stillChecking > 0
              ? ` ${names.check} still has ${plural(stillChecking, 'suspected finding', 'suspected findings')} to check.`
              : ''}
            {screenedAgain ? ` ${SCREENED_AGAIN}` : ''}
          </p>
        ) : null}

        {/* With more than twenty waiting findings, one of them can be looked up. */}
        {showSearch ? (
          <div className="bypass-form">
            <label htmlFor={searchId}>Search the waiting findings</label>
            <input
              id={searchId}
              type="text"
              value={filter}
              autoComplete="off"
              spellCheck={false}
              placeholder="A criterion, a patient or a file name"
              onChange={(e) => setFilter(e.target.value)}
            />
            {filtering ? (
              <p className="credit" role="status">
                Showing {shown.length} of {waiting.length} waiting findings.{' '}
                <button type="button" className="link-btn" onClick={() => setFilter('')}>
                  Clear the filter
                </button>
              </p>
            ) : null}
          </div>
        ) : null}

        {/* One group for each history. A finding decided here leaves a receipt in its place, so nothing jumps. */}
        {groups.map((group) => (
          <Fragment key={group.caseId}>
            <h3 className="section-title group-title">
              <span>{patientWords(group.caseRecord.patient)}</span>
              <span className="credit">{group.caseRecord.fileName}</span>
              <span className="tag">
                {plural(group.waiting.filter((f) => f.state === 'confirmed').length, 'waiting finding', 'waiting findings')}
              </span>
            </h3>
            {group.waiting.map(cardOrReceipt)}
          </Fragment>
        ))}
        {noHistory.map(cardOrReceipt)}

        {/* Which criterion could not be screened on which history. It is never shown as clear and never
            left out. The note at the top of the panel says that a history was not fully screened; this
            list names the criteria. It stands under the findings, so the findings keep their place. */}
        {failed.length > 0 ? (
          <details className="failed-list" open={failed.length <= SHORT_LIST}>
            <summary>Criteria that could not be screened ({failed.length})</summary>
            <ul>
              {failed.map((row) => (
                <li key={`${row.caseId}:${row.criterionId}`}>
                  <strong>{row.criterionLabel}</strong> could not be screened on {row.fileName} ({row.patientLabel}).
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {/* The findings the two models disagree on. The section is always open: nothing in it is hidden. */}
        {inDisputed.length > 0 ? (
          <section className="grey-list" aria-labelledby={disputedId}>
            <h3 id={disputedId} className="grey-title">
              The two models disagree ({disputed.length})
            </h3>
            {disputed.length > 0 ? <p className="grey-empty">{disputedIntroWords(pageView, names)}</p> : null}
            <ul>
              {inDisputed.map((finding) =>
                disputedIds.has(finding.id) ? (
                  <DisputedItem
                    key={finding.id}
                    finding={finding}
                    caseRecord={caseById.get(finding.caseId)}
                    criterion={criteria[finding.criterionId]}
                    criteriaLoaded={criteriaLoaded}
                    refresh={refresh}
                    onDecided={(did) => {
                      justDecided.current = finding.id;
                      setDecidedHere((all) => ({ ...all, [finding.id]: did }));
                    }}
                    names={names}
                  />
                ) : (
                  <Receipt
                    key={finding.id}
                    inList
                    name={nameOf(finding)}
                    did={decidedHere[finding.id] === 'dismiss' ? 'dismiss' : 'accept_anyway'}
                    onOpenLetters={onOpenLetters}
                    names={names}
                  />
                ),
              )}
            </ul>
          </section>
        ) : null}

        <details className="grey-list grey-list--plain">
          <summary>Already decided by the pharmacist ({decided.length})</summary>
          {decided.length === 0 ? (
            <p className="grey-empty">Nothing here.</p>
          ) : (
            <ul>
              {decided.map((finding) => {
                const c = caseById.get(finding.caseId);
                const criterion = criteria[finding.criterionId];
                const when = formatDateTime(finding.decision?.at);
                const words = decidedWords(finding);
                const reason = (finding.decision?.reason ?? '').trim();
                return (
                  <li key={finding.id} className="grey-item">
                    <p className="grey-head">
                      <span>
                        <strong>{criterion?.label ?? finding.criterionId}</strong>
                        {criterion?.title ? `: ${criterion.title}` : ''}
                      </span>
                      <span className="grey-meta">
                        {patientWords(c?.patient)}
                        {c ? `, ${c.fileName}` : ''}
                      </span>
                    </p>
                    <p>
                      {words}
                      {when ? ` on ${when}` : ''}.
                      {isPossible(finding) ? ' It was a possible finding.' : ''}
                      {words === 'Bypassed' ? ` Reason: ${reason || 'no reason was saved'}` : reason ? ` Reason: ${reason}` : ''}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </details>
      </div>
    </Panel>
  );
}
