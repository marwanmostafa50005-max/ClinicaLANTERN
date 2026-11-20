import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CaseRecord, EmailDraft, Finding, Letter, ReplyOutcome, StateResponse } from '../../shared/types.ts';
import { api, errorText, isMock, isReplay, isReplayMock, pageView } from '../api.ts';
import { criterionName } from '../lib/criteria.ts';
import type { CriterionView } from '../lib/criteria.ts';
import { LETTER_TEXT_CAP, clearStoredDraft, isDraftDirty, mergeDraftWithServer, serverHasSaved, tidySubject, writeStoredDraft } from '../lib/draftStore.ts';
import type { DraftStorage, LetterDraftLocal } from '../lib/draftStore.ts';
import { formatDate, formatDateTime, plural } from '../lib/format.ts';
import {
  FICTIONAL_LINE,
  OUTCOME_ORDER,
  OUTCOME_WORDS,
  VIEW_WORDS,
  closingParts,
  daysOverdue,
  editableBody,
  emailDraftFor,
  endsWithClosing,
  letterAsItLeaves,
  letterRowWhat,
  letterView,
  nextStep,
  sortLetters,
  statusDetail,
  whyNoClose,
  whyNoPreview,
  whyNoReply,
  withFictionalLine,
} from '../lib/letters.ts';
import type { LetterView } from '../lib/letters.ts';
import { JOB_NAMES, type DisplayNames } from '../lib/modelNames.ts';
import { isRecordedView } from '../lib/pageView.ts';
import type { PageView } from '../lib/pageView.ts';
import { RECORDED_BUTTONS_OFF } from '../lib/replayBackend.ts';
import { LetterClosing, LetterPreview } from './LetterPreview.tsx';
import { Panel } from './Panel.tsx';
import { AlertIcon, BackIcon, CheckIcon, LetterGlyph } from './glyphs.tsx';

interface LetterPanelProps {
  snap: StateResponse | null;
  criteria: Record<string, CriterionView>;
  /** The note of the page when it does not show a live run (sample data, or a recorded run). */
  pageNote?: string;
  refresh(): Promise<void>;
  onClose(): void;
  /** The letter that the page address named when the page loaded (?panel=letter&letter=T0003). */
  initialLetterId?: string | null;
  /** True when the page address also asked for the preview of that letter (&preview=1). */
  initialPreview?: boolean;
  /** Display names from the health response. Mantle, Lumen and Ogee when health has not arrived. */
  names?: DisplayNames;
}

/** The sample view and the made-up recording: no model wrote their letters. */
const sample = isMock || isReplayMock;

/** Who wrote the words of a letter, said as it is true in this view. */
export function draftedWords(origin: 'model' | 'template' | undefined, sampleView: boolean, names: DisplayNames = JOB_NAMES): string {
  // The letters of the sample view were written by hand for the mock-up. No model wrote them.
  if (sampleView) return origin === 'template' ? 'Sample letter, written by hand, shown as built from the template' : 'Sample letter, written by hand for the mock-up';
  return origin === 'template' ? 'Built from the template' : `Drafted by ${names.letter}`;
}

/**
 * The line under the buttons of an open letter. In a live run and in the sample view it is the
 * next step of the pharmacist. In a recorded run the editor, the tick box, the email, "Mark as
 * sent" and the reply are all switched off, so the line asks for none of them: it says what is
 * shown, and that the preview can still print or copy the letter.
 */
export function letterStepWords(view: PageView, nextStepWords: string, canPreview: boolean): string {
  if (!isRecordedView(view)) return nextStepWords;
  const shown =
    view === 'recorded'
      ? 'Recorded run. The letter is shown as it was recorded.'
      : 'Made-up recording of the sample view. The letter is shown as the sample data holds it.';
  return canPreview ? `${shown} Open the preview to print or copy it.` : shown;
}

/**
 * The words of an empty list of letters, said as they are true in this view. In the sample view no
 * model writes a letter. In a recorded run no finding can be accepted, so the line does not say
 * what happens when one is.
 */
export function noLettersWords(view: PageView, names: DisplayNames = JOB_NAMES): string {
  switch (view) {
    case 'live':
      return `No letters yet. When you accept a finding under the bell, ${names.letter} writes a letter and it shows here.`;
    case 'sample':
      return 'No letters yet. When you accept a finding under the bell, a sample letter shows here.';
    case 'recorded':
    case 'made_up_recording':
      return 'No letters yet at this step of the recording.';
  }
}

/** Why a letter was built from the template, in plain words. A model that did not answer is not a draft that failed its checks. */
export function templateWords(reason: 'checks_failed' | 'no_answer' | 'error' | undefined): string {
  if (reason === 'no_answer') {
    return 'The local AI model did not answer, so this letter was built from the template alone. No draft was written or checked. Please read it with care.';
  }
  if (reason === 'error') {
    return 'The draft by the local AI model could not be made, so this letter was built from the template alone. Please read it with care.';
  }
  return 'The draft by the local AI model did not pass its checks twice, so this letter was built from the template alone. Please read it with care.';
}

/**
 * Sets the height of the letter box to fit its text, and keeps every scrolling area above it where
 * it was. While the height is worked out the box is short for a moment; without this the browser
 * pulled the scroll position back and the line being typed jumped out of view.
 */
export function fitHeightKeepingScroll(box: HTMLElement): void {
  const scrolled: Array<[Element, number]> = [];
  for (let el: Element | null = box.parentElement; el; el = el.parentElement) {
    if (el.scrollTop !== 0) scrolled.push([el, el.scrollTop]);
  }
  box.style.height = 'auto';
  box.style.height = `${box.scrollHeight + 2}px`;
  for (const [el, top] of scrolled) {
    if (el.scrollTop !== top) el.scrollTop = top;
  }
}

/** Where the text that is being typed is kept in this browser, so a refresh does not lose it. */
const browserStorage: DraftStorage = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // The store is full or switched off. The text is still in the box and is still sent to the server.
    }
  },
  remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing was kept.
    }
  },
};

/** The letter that the page address names now, and whether its preview is asked for. */
function letterInAddress(): { letterId: string | null; preview: boolean } {
  const query = new URLSearchParams(window.location.search);
  if (query.get('panel') !== 'letter') return { letterId: null, preview: false };
  return { letterId: query.get('letter'), preview: query.get('preview') === '1' };
}

/**
 * The open letter is part of the page address, so a refresh comes back to the same letter. It is
 * still one page: nothing is loaded again. When the letters are closed the address forgets them.
 */
function writeLetterAddress(open: boolean, letterId: string | null, preview: boolean): void {
  const url = new URL(window.location.href);
  if (open) url.searchParams.set('panel', 'letter');
  else if (url.searchParams.get('panel') === 'letter') url.searchParams.delete('panel');
  if (open && letterId) url.searchParams.set('letter', letterId);
  else url.searchParams.delete('letter');
  if (open && letterId && preview) url.searchParams.set('preview', '1');
  else url.searchParams.delete('preview');
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(window.history.state, '', next);
  }
}

/** The text in the editor, and the text that was last saved. */
type Draft = LetterDraftLocal & { id: string };

const isDirty = (d: Draft | null): boolean => d !== null && isDraftDirty(d);

/** The text of a letter as the editor shows it: without its last lines, which stand under the text box. */
const editorText = (letter: Letter): string => editableBody(letter.body, closingParts(letter));

const draftOf = (letter: Letter | undefined): Draft | null => {
  if (!letter) return null;
  const body = editorText(letter);
  return { id: letter.id, subject: letter.subject, body, savedSubject: letter.subject, savedBody: body, revision: letter.draftRevision ?? 0 };
};

/**
 * The text for the editor when a letter is opened. Text that was typed and not yet saved is kept
 * in this browser: it comes back here, also after a refresh. Only a letter that can still be
 * edited takes it.
 */
function draftWithKept(letter: Letter | undefined): Draft | null {
  const fromServer = draftOf(letter);
  if (!letter || !fromServer) return null;
  if (letter.status !== 'ready' || isReplay) return fromServer;
  const kept = mergeDraftWithServer(browserStorage, letter.id, fromServer.subject, fromServer.body);
  // Text kept by an earlier build of the page may still end with the last lines of the letter.
  // They stand under the text box, so they are taken off here as they are for the server's text.
  const closing = closingParts(letter);
  return {
    id: letter.id,
    ...kept,
    body: editableBody(kept.body, closing),
    savedBody: editableBody(kept.savedBody, closing),
    revision: kept.revision ?? letter.draftRevision ?? 0,
  };
}

/** True on a screen wide enough for the list and the letter side by side. */
function useWide(): boolean {
  const query = '(min-width: 900px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setWide(media.matches);
    media.addEventListener('change', update);
    update();
    return () => media.removeEventListener('change', update);
  }, []);
  return wide;
}

/** The letter to open first: the one the page address names, then a new ready letter, then any ready letter, then the top of the list. */
function firstChoice(sorted: Letter[], preferId: string | null = null): string | null {
  if (preferId && sorted.some((l) => l.id === preferId)) return preferId;
  const pick =
    sorted.find((l) => l.status === 'ready' && !l.seenByPharmacist) ?? sorted.find((l) => l.status === 'ready') ?? sorted[0];
  return pick ? pick.id : null;
}

interface DetailProps {
  letter: Letter;
  view: LetterView;
  nowIso: string;
  finding: Finding | undefined;
  caseRecord: CaseRecord | undefined;
  criterion: CriterionView | undefined;
  findings?: Finding[];
  criteria?: Record<string, CriterionView>;
  draft: Draft;
  saving: boolean;
  /** A message of success under the letter, such as "The reply was recorded." */
  notice: string | null;
  setNotice(text: string | null): void;
  onDraft(change: Partial<Pick<Draft, 'subject' | 'body'>>): void;
  save(): Promise<boolean>;
  refresh(): Promise<void>;
  onBack: (() => void) | null;
  /** Saves what was typed and opens the preview. It answers with the reason when the preview could not be opened. */
  onPreview(): Promise<string | null>;
  names?: DisplayNames;
}

/** The small forms that open in place of the buttons. */
type SmallForm = 'reply' | 'close';

function LetterDetail({ letter, view, nowIso, finding, caseRecord, criterion, findings = [], criteria = {}, draft, saving, notice, setNotice, onDraft, save, refresh, onBack, onPreview, names = JOB_NAMES }: DetailProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<SmallForm | null>(null);
  const [outcome, setOutcome] = useState<ReplyOutcome | null>(null);
  const [replyNote, setReplyNote] = useState('');
  const [pointOutcomes, setPointOutcomes] = useState<Record<string, ReplyOutcome | 'same'>>({});
  const pointIds = (letter.findingIds?.length ?? 0) > 1 ? letter.findingIds! : [];
  const bodyBox = useRef<HTMLTextAreaElement>(null);
  const subjectId = useId();
  const bodyId = useId();
  const agreeId = useId();
  const noteId = useId();
  const stepId = useId();

  // A recorded run is shown as it happened: nothing in it can be changed.
  const editable = view === 'ready' && !isReplay;
  const dirty = isDirty(draft);
  const agreed = letter.patientAgreed !== undefined;
  const hasText = draft.body.trim() !== '';
  const canPreview = view !== 'drafting' && hasText;
  const canReply = view === 'sent' || view === 'overdue' || view === 'reply_recorded';
  const canClose = view !== 'drafting' && view !== 'closed';
  // The last lines of the letter. They are shown under the text box when the letter ends with
  // them, and for a letter that is still to leave: they are put at its end when it does.
  const closing = closingParts(letter);
  const showClosing = view === 'ready' || endsWithClosing(letter.body, closing);
  const whyOff = (why: string): string | undefined => (isReplay ? RECORDED_BUTTONS_OFF : why) || undefined;

  // A fresh letter starts with clean forms and messages.
  useEffect(() => {
    setBusy(null);
    setError(null);
    setNotice(null);
    setForm(null);
    setOutcome(null);
    setReplyNote('');
    setPointOutcomes({});
  }, [letter.id, setNotice]);

  // The editor grows with the letter, so the whole letter is read without a second scroll bar.
  // The scroll position is kept while the height is set, so the text does not jump while he types.
  useLayoutEffect(() => {
    const box = bodyBox.current;
    if (box) fitHeightKeepingScroll(box);
  }, [draft.body, draft.id, editable]);

  // The keyboard focus follows the small forms: into the form when it opens, back to its button when it closes.
  const actions = useRef<HTMLElement>(null);
  const lastForm = useRef<SmallForm | null>(null);
  useEffect(() => {
    const box = actions.current;
    if (!box) return;
    if (form !== null) {
      lastForm.current = form;
      box.querySelector<HTMLElement>('.inline-form input, .inline-form button')?.focus();
    } else if (lastForm.current !== null) {
      // Back to the button that opened the form, or to the next step when that button is now switched off.
      const back =
        box.querySelector<HTMLElement>(`[data-opens="${lastForm.current}"]:not(:disabled)`) ??
        box.querySelector<HTMLElement>('.letter-buttons .btn-primary:not(:disabled)') ??
        box.querySelector<HTMLElement>('.letter-buttons .btn:not(:disabled)');
      back?.focus();
      lastForm.current = null;
    }
  }, [form]);

  const openForm = (name: SmallForm) => {
    setError(null);
    setNotice(null);
    if (name === 'reply') {
      // A reply that is already recorded can be corrected.
      setOutcome(letter.reply?.outcome ?? null);
      setReplyNote(letter.reply?.note ?? '');
      const seeded: Record<string, ReplyOutcome | 'same'> = {};
      for (const id of letter.findingIds ?? []) {
        const saved = letter.reply?.points?.find((point) => point.findingId === id);
        seeded[id] = saved?.outcome ?? 'same';
      }
      setPointOutcomes(seeded);
    }
    setForm(name);
  };

  const run = async (
    name: string,
    action: () => Promise<void>,
    options: { saveFirst?: boolean; done?: string; closeForm?: boolean } = {},
  ) => {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      // When the edits cannot be saved, the step is not taken. The reason is shown above the letter.
      if (options.saveFirst && !(await save())) return;
      await action();
      await refresh();
      if (options.closeForm) setForm(null);
      if (options.done) setNotice(options.done);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  // What was typed is sent to the server when the text box loses the focus. When the focus goes to
  // the tick box or to a button under the letter, that step saves it itself, so it is not sent twice.
  const saveOnBlur = (event: { relatedTarget: EventTarget | null }) => {
    const next = event.relatedTarget;
    if (next instanceof HTMLElement && actions.current?.contains(next)) return;
    void save();
  };

  // The tick records that the patient was told and agrees. It can be taken away again until the letter is sent.
  const onAgree =(tick: boolean) => run(tick ? 'agree' : 'unagree', () => api.agreeLetter(letter.id, tick), { saveFirst: tick });

  // The preview is the one way a letter leaves: print, email, copy and "mark as sent" stand on it
  // and nowhere else. What was typed is saved before it opens.
  const openThePreview = async () => {
    setBusy('preview');
    setError(null);
    setNotice(null);
    try {
      const problem = await onPreview();
      if (problem) setError(problem);
    } finally {
      setBusy(null);
    }
  };

  const onReply = () => {
    if (!outcome) {
      setError('Choose what the doctor said.');
      return;
    }
    if (outcome === 'other' && replyNote.trim() === '') {
      setError('Write a short note about the reply.');
      return;
    }
    const points = pointIds.flatMap((id) => {
      const chosen = pointOutcomes[id];
      if (!chosen || chosen === 'same' || chosen === outcome) return [];
      return [{ findingId: id, outcome: chosen }];
    });
    void run('reply', () => api.recordReply(letter.id, { outcome, note: replyNote.trim(), ...(points.length > 0 ? { points } : {}) }), {
      closeForm: true,
      done: 'The reply was recorded.',
    });
  };

  const pointLabel = (id: string, index: number): string => {
    const found = findings.find((item) => item.id === id);
    const named = found ? criteria[found.criterionId] : undefined;
    return named ? criterionName(named) : found?.criterionId ?? `Point ${index + 1}`;
  };

  const onCloseCase = () =>
    run('close', () => api.closeLetter(letter.id), { saveFirst: editable, closeForm: true, done: 'The case is closed.' });

  const patient = caseRecord?.patient.label ?? 'Fictional patient';
  const origin = letter.draft?.origin;
  const checkNotes = letter.draft?.checkNotes ?? [];
  const rewrittenBecause = origin === 'template' ? checkNotes.find(note => note.includes('was taken back')) : undefined;
  const shownNotes = rewrittenBecause ? checkNotes.filter(note => note !== rewrittenBecause) : checkNotes;
  // In a recorded run the line names no step: nothing in the letter can be changed there.
  const step = letterStepWords(pageView, nextStep(letter, view, nowIso), canPreview);

  return (
    <section className="letter-detail" aria-label="The letter">
      <header className="letter-top">
        {onBack ? (
          <button type="button" className="btn btn-quiet btn-small" onClick={onBack}>
            <BackIcon /> All letters
          </button>
        ) : null}
        <div className="letter-top-words">
          <p className="letter-for">
            {patient}
            {pointIds.length > 1
              ? `. ${pointIds.length} points`
              : criterion ? `. ${criterionName(criterion)}` : finding ? `. ${finding.criterionId}` : ''}
          </p>
          <p className="fictional-tag">{FICTIONAL_LINE}</p>
        </div>
        <span className={`chip chip--${view}`}>{VIEW_WORDS[view]}</span>
      </header>

      <div className="letter-scroll">
        {letter.afterSent ? (
          <p className="note">This is the next letter for this patient. An earlier letter was marked as sent.</p>
        ) : null}
        {letter.withdrawnNote ? (
          <p className="note note--warn">
            <AlertIcon /> {letter.withdrawnNote}
          </p>
        ) : null}
        {view === 'drafting' && draft.body.trim() === '' ? (
          <p className="empty">
            {sample
              ? 'Sample data: this letter is shown as being written. The models are not connected.'
              : `${names.letter} is writing this letter. It will show here when it is ready.`}
          </p>
        ) : (
          <>
            {view === 'drafting' && !letter.withdrawnNote ? <p className="note">A point of this letter is still being written.</p> : null}
            {origin === 'template' && !sample ? (
              <p className="note note--warn">
                <AlertIcon /> {rewrittenBecause ?? templateWords(letter.draft?.templateReason)}
              </p>
            ) : null}
            {shownNotes.length > 0 ? (
              <div className="note note--warn note--stack">
                <p>What the letter checks found:</p>
                <ul>
                  {shownNotes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <ol className="trail" aria-label="What has happened to this letter">
              {letter.draft ? (
                <li>
                  {draftedWords(origin, sample, names)} on{' '}
                  {formatDateTime(letter.draft.at)}
                  {letter.editedByPharmacist ? '. Edited by the pharmacist' : ''}.
                </li>
              ) : null}
              {letter.patientAgreed ? <li>The patient was told and agrees. Recorded on {formatDateTime(letter.patientAgreed.at)}.</li> : null}
              {letter.sentAt ? (
                <li>
                  Sent{letter.sentBy === 'email' ? ' by email' : letter.sentBy === 'print' ? ' on paper' : ''} on{' '}
                  {formatDateTime(letter.sentAt)}.{letter.patientAgreed ? '' : " The patient's agreement was not recorded."}
                </li>
              ) : null}
              {view === 'overdue' ? (
                <li className="trail-alarm">
                  No reply. It was due on {formatDate(letter.dueAt)}. Overdue by{' '}
                  {plural(daysOverdue(letter, nowIso), 'day', 'days')}.
                </li>
              ) : null}
              {letter.reply ? (
                <li>
                  Reply recorded on {formatDateTime(letter.reply.at)}: {OUTCOME_WORDS[letter.reply.outcome]}.
                  {letter.reply.note ? ` Note: ${letter.reply.note}` : ''}
                  {letter.reply.points?.length === 1 ? ' One point differs.' : ''}
                  {(letter.reply.points?.length ?? 0) > 1 ? ` ${letter.reply.points!.length} points differ.` : ''}
                </li>
              ) : null}
              {letter.closedAt ? (
                <li>
                  Closed on {formatDateTime(letter.closedAt)}.
                  {letter.sentAt ? (letter.reply ? '' : ' No reply was recorded.') : ' The letter was not sent.'}
                </li>
              ) : null}
            </ol>

            <div className="paper">
              <label htmlFor={subjectId} className="field-label">
                Subject (used for the email)
              </label>
              <input
                id={subjectId}
                className="subject-input"
                type="text"
                maxLength={300}
                value={draft.subject}
                readOnly={!editable}
                onChange={(e) => onDraft({ subject: e.target.value })}
                onBlur={saveOnBlur}
              />
              <label htmlFor={bodyId} className="field-label">
                The letter{editable ? ' (you can edit it)' : letter.sentAt ? ' (as it was sent)' : ''}
              </label>
              <textarea
                id={bodyId}
                ref={bodyBox}
                className="letter-body"
                maxLength={LETTER_TEXT_CAP}
                value={draft.body}
                readOnly={!editable}
                spellCheck
                onChange={(e) => onDraft({ body: e.target.value })}
                onBlur={saveOnBlur}
              />
              {/* The last lines are not in the text box: an edit cannot delete them. */}
              {showClosing ? (
                <>
                  <p className="field-label closing-label">The last lines (they cannot be changed)</p>
                  <LetterClosing closing={closing} fixed />
                </>
              ) : null}
            </div>
          </>
        )}
      </div>

      {view !== 'drafting' ? (
        <footer
          className="letter-actions"
          ref={actions}
          onKeyDown={(e) => {
            // Escape closes the small form first, not the whole panel.
            if (e.key === 'Escape' && form !== null && busy === null) {
              e.stopPropagation();
              setForm(null);
            }
          }}
        >
          {error ? (
            <p className="note note--error" role="alert">
              {error}
            </p>
          ) : null}
          {notice && form === null ? (
            <p className="note note--ok" role="status">
              <CheckIcon /> {notice}
            </p>
          ) : null}

          {/* While a small form is open it takes the place of the tick box and the buttons, so the letter stays in view. */}
          {form === null ? (
            <div className="agree-row">
              <span className="agree-main">
                <input
                  id={agreeId}
                  type="checkbox"
                  checked={busy === 'agree' ? true : busy === 'unagree' ? false : agreed}
                  disabled={busy !== null || !editable}
                  onChange={(e) => void onAgree(e.target.checked)}
                  title={isReplay ? 'This is a recorded run. Nothing can be changed here.' : undefined}
                />
                <label htmlFor={agreeId}>Discussed with the patient; the patient agrees to this letter</label>
              </span>
              {editable ? (
                <span className={`save-state${dirty ? ' save-state--dirty' : ''}`} role="status">
                  {saving ? 'Saving' : dirty ? 'Changes not saved yet' : letter.editedByPharmacist ? 'All changes saved' : ''}
                </span>
              ) : null}
              {editable && dirty ? (
                <button
                  type="button"
                  className="btn btn-small btn-quiet"
                  disabled={saving}
                  onClick={() => {
                    // The button goes away once the changes are saved. The focus goes back to the letter, not to nowhere.
                    void save().then((saved) => {
                      if (saved) bodyBox.current?.focus({ preventScroll: true });
                    });
                  }}
                >
                  Save changes
                </button>
              ) : null}
            </div>
          ) : null}

          {form === 'reply' ? (
            <div className="inline-form">
              <fieldset className="outcomes">
                <legend className="inline-form-title">What did the doctor say?</legend>
                {OUTCOME_ORDER.map((value) => (
                  <label key={value} className="outcome">
                    <input
                      type="radio"
                      name={`outcome-${letter.id}`}
                      value={value}
                      checked={outcome === value}
                      onChange={() => {
                        setOutcome(value);
                        setError(null);
                      }}
                    />
                    {OUTCOME_WORDS[value]}
                  </label>
                ))}
              </fieldset>
              {pointIds.length > 1 ? (
                <fieldset className="point-replies">
                  <legend className="inline-form-title">A point the doctor answered differently</legend>
                  {pointIds.map((id, index) => (
                    <label key={id} className="point-reply">
                      <span>{index + 1}. {pointLabel(id, index)}</span>
                      <select
                        aria-label={`Point ${index + 1}`}
                        value={pointOutcomes[id] ?? 'same'}
                        onChange={(e) => {
                          const value = e.target.value as ReplyOutcome | 'same';
                          setPointOutcomes((prev) => ({ ...prev, [id]: value }));
                          setError(null);
                        }}
                      >
                        <option value="same">Same as the letter</option>
                        {OUTCOME_ORDER.map((value) => (
                          <option key={value} value={value}>{OUTCOME_WORDS[value]}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <label htmlFor={noteId} className="field-label">
                Note: what was said, and how you heard
              </label>
              <textarea id={noteId} rows={2} maxLength={2000} value={replyNote} onChange={(e) => setReplyNote(e.target.value)} />
              <div className="btn-row">
                <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={onReply}>
                  {busy === 'reply' ? 'Saving' : 'Save the reply'}
                </button>
                <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={() => setForm(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {form === 'close' ? (
            <div className="inline-form" role="group" aria-label="Close the case?">
              <p className="inline-form-title">
                {letter.sentAt ? 'Close the case without a reply?' : 'Close the case without sending the letter?'}
              </p>
              <p>
                {letter.sentAt
                  ? 'The log will say that no reply was recorded. A closed case cannot be opened again here.'
                  : 'The log will say that the letter was not sent. A closed case cannot be opened again here.'}
              </p>
              <div className="btn-row">
                <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void onCloseCase()}>
                  {busy === 'close' ? 'Closing' : 'Yes, close the case'}
                </button>
                <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={() => setForm(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {form === null ? (
            <div className="btn-row letter-buttons" aria-describedby={step ? stepId : undefined}>
              {/* The one way out of the letter. Print, email, Copy and "Mark as sent" stand on the preview page. */}
              <button
                type="button"
                className={`btn ${view === 'ready' ? 'btn-primary' : 'btn-quiet'}`}
                disabled={!canPreview || busy !== null}
                title={whyNoPreview(view, hasText) || undefined}
                data-opens="preview"
                onClick={() => void openThePreview()}
              >
                Preview letter
              </button>
              <span className="btn-gap" aria-hidden="true" />
              <button
                type="button"
                className={`btn ${view === 'sent' || view === 'overdue' ? 'btn-primary' : 'btn-quiet'}`}
                disabled={!canReply || busy !== null || isReplay}
                title={canReply && !isReplay ? undefined : whyOff(whyNoReply(view))}
                data-opens="reply"
                onClick={() => openForm('reply')}
              >
                Record the doctor's reply
              </button>
              <button
                type="button"
                className={`btn ${view === 'reply_recorded' ? 'btn-primary' : 'btn-quiet'}`}
                disabled={!canClose || busy !== null || isReplay}
                title={canClose && !isReplay ? undefined : whyOff(whyNoClose(view))}
                data-opens="close"
                onClick={() => (view === 'reply_recorded' ? void onCloseCase() : openForm('close'))}
              >
                {busy === 'close' ? 'Closing' : 'Close the case'}
              </button>
            </div>
          ) : null}
          {step && form === null ? (
            <p id={stepId} className={`next-step${view === 'overdue' && !isReplay ? ' next-step--alarm' : ''}`}>
              {step}
            </p>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}

/** What the preview page shows: the letter exactly as it leaves. */
interface Preview {
  id: string;
  subject: string;
  text: string;
  email: EmailDraft;
  previewToken?: string;
}

/** The letter panel: the list of letters with their status, the letter that is open, and its preview. */
export function LetterPanel({ snap, criteria, pageNote, refresh, onClose, initialLetterId = null, initialPreview = false, names = JOB_NAMES }: LetterPanelProps) {
  const letters = useMemo(() => snap?.state.letters ?? [], [snap]);
  const nowIso = snap?.serverTime ?? new Date().toISOString();
  const sorted = useMemo(() => sortLetters(letters, nowIso), [letters, nowIso]);
  const wide = useWide();

  // The letter the page address named when it loaded is opened first, while the address still names it.
  // Later, when the letters are opened again, the address names none and the usual first letter opens.
  const [named] = useState(() => {
    const now = letterInAddress();
    const letterId = initialLetterId !== null && now.letterId === initialLetterId ? initialLetterId : null;
    return { letterId, preview: letterId !== null && initialPreview && now.preview };
  });

  // The letter that is open, and the text in its editor. They are set together so the editor never shows a gap.
  // On a phone the list opens first, unless the page address names a letter.
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    wide ? firstChoice(sorted, named.letterId) : named.letterId && sorted.some((l) => l.id === named.letterId) ? named.letterId : null,
  );
  const [draft, setDraft] = useState<Draft | null>(() => draftWithKept(letters.find((l) => l.id === selectedId)));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;
  const lettersRef = useRef(letters);
  lettersRef.current = letters;

  const selected = letters.find((l) => l.id === selectedId) ?? null;
  const previewShown = preview !== null && selected !== null && preview.id === selected.id;

  const open = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      setDraft(draftWithKept(letters.find((l) => l.id === id)));
      setPreview(null);
    },
    [letters],
  );

  // On a wide screen a letter is always open, so the working part fills the screen. The letter that
  // the page address names is opened once, when the letters are first here: with the local server
  // they come a moment after the panel.
  const namedPending = useRef<string | null>(named.letterId);
  useEffect(() => {
    if (sorted.length === 0) return;
    const wanted = namedPending.current;
    namedPending.current = null;
    if (selected !== null) return;
    if (wanted && sorted.some((l) => l.id === wanted)) open(wanted);
    else if (wide) open(firstChoice(sorted));
  }, [wide, selected, sorted, open]);

  // The page address follows the letter that is open, and forgets it when the letters are closed.
  useEffect(() => {
    writeLetterAddress(true, selectedId, previewShown);
  }, [selectedId, previewShown]);
  useEffect(() => () => writeLetterAddress(false, null, false), []);

  // Keep the editor in step with the server, but never overwrite what the pharmacist is typing.
  // The server tidies the text it is sent (spaces at the end of a line, empty lines at the end).
  // Its tidied copy of what was saved from here is the same text: it does not replace the text in the box.
  const openId = selected?.id ?? null;
  const serverSubject = selected?.subject ?? '';
  const serverBody = selected ? editorText(selected) : '';
  const serverRevision = selected?.draftRevision ?? 0;
  useEffect(() => {
    if (openId === null) {
      setDraft(null);
      return;
    }
    setDraft((prev) => {
      if (prev && prev.id === openId && isDirty(prev)) return prev;
      if (prev && prev.id === openId && serverHasSaved(prev, serverSubject, serverBody)) {
        return prev.revision === serverRevision ? prev : { ...prev, revision: serverRevision };
      }
      return { id: openId, subject: serverSubject, body: serverBody, savedSubject: serverSubject, savedBody: serverBody, revision: serverRevision };
    });
  }, [openId, serverSubject, serverBody, serverRevision]);

  // What is typed is kept in this browser until the server has it. After a refresh it is back in the editor.
  useEffect(() => {
    if (!draft || isReplay) return;
    if (isDirty(draft)) writeStoredDraft(browserStorage, draft.id, draft);
    else clearStoredDraft(browserStorage, draft.id);
  }, [draft]);

  // One save at a time: a second call waits for the first, and then saves what is still unsaved.
  const saveRunning = useRef<Promise<boolean> | null>(null);
  const saveNow = useCallback(async (): Promise<boolean> => {
    const current = draftRef.current;
    if (!current || !isDirty(current)) return true;
    // A letter that is no longer waiting for review cannot be changed: the server's text stands.
    const live = lettersRef.current.find((l) => l.id === current.id);
    if (!live || live.status !== 'ready' || isReplay) {
      clearStoredDraft(browserStorage, current.id);
      setDraft((prev) => (prev && prev.id === current.id ? draftOf(live) : prev));
      return true;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await api.saveLetter(current.id, {
        subject: current.subject,
        body: current.body,
        expectedRevision: current.revision ?? 0,
      });
      // What was typed while the save was on its way stays in the box, and stays unsaved.
      setDraft((prev) =>
        prev && prev.id === current.id
          ? { ...prev, savedSubject: current.subject, savedBody: current.body, revision: (current.revision ?? 0) + 1 }
          : prev,
      );
      await refresh();
      return true;
    } catch (err) {
      setSaveError(`The changes could not be saved. ${errorText(err)}`);
      return false;
    } finally {
      setSaving(false);
    }
  }, [refresh]);
  const save = useCallback(async (): Promise<boolean> => {
    while (saveRunning.current) await saveRunning.current;
    const running = saveNow();
    saveRunning.current = running;
    try {
      return await running;
    } finally {
      if (saveRunning.current === running) saveRunning.current = null;
    }
  }, [saveNow]);

  // What is typed is sent to the server one second after the last key. (It is also sent when the
  // text box loses the focus, and before every step.) A save that failed is not tried again by
  // itself: the reason is shown, and the text stays kept in this browser.
  const dirty = isDirty(draft);
  const typedId = draft?.id;
  const typedSubject = draft?.subject;
  const typedBody = draft?.body;
  useEffect(() => {
    if (!dirty || isReplay) return;
    const timer = window.setTimeout(() => void save(), 1000);
    return () => window.clearTimeout(timer);
  }, [dirty, typedId, typedSubject, typedBody, save]);

  // Opening a ready letter is seeing it: the number badge is cleared.
  const asked = useRef(new Set<string>());
  const unseenId = selected && selected.status === 'ready' && !selected.seenByPharmacist ? selected.id : null;
  useEffect(() => {
    if (isReplay || !unseenId || asked.current.has(unseenId)) return;
    asked.current.add(unseenId);
    api
      .markLetterSeen(unseenId)
      .then(refresh)
      .catch(() => asked.current.delete(unseenId));
  }, [unseenId, refresh]);

  // If the panel is taken away some other way (a file is dropped, a pop-up opens another panel),
  // unsaved edits are still sent to the server.
  useEffect(
    () => () => {
      const left = draftRef.current;
      if (left && isDirty(left) && !isReplay) {
        void api.saveLetter(left.id, { subject: left.subject, body: left.body, expectedRevision: left.revision ?? 0 }).catch(() => {});
      }
    },
    [],
  );

  // Warn before the page is closed with unsaved edits. Opening the email program is not leaving the page.
  const leavingForEmail = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!leavingForEmail.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // The preview: what was typed is saved first, and then the letter is shown exactly as it leaves.
  const openPreview = useCallback(async (): Promise<string | null> => {
    const typed = draftRef.current;
    if (!typed) return null;
    // When the edits cannot be saved the preview does not open. The reason is shown above the letter.
    if (!(await save())) return null;
    const live = lettersRef.current.find((l) => l.id === typed.id);
    if (!live) return null;
    try {
      if (live.status !== 'ready') {
        // A letter that has left is shown as it was sent: the text the server kept. Nothing is recorded.
        const text = withFictionalLine(live.body);
        setPreview({ id: live.id, subject: live.subject, text, email: emailDraftFor(live.subject, text) });
      } else if (api.previewLetter) {
        // The server records that this exact text was previewed, and answers with the text as it will leave.
        const answer = await api.previewLetter(live.id);
        const text = withFictionalLine(answer.text);
        const email = answer.emailDraft.coverNote ? answer.emailDraft : { ...answer.emailDraft, text: withFictionalLine(answer.emailDraft.text) };
        await refresh();
        setPreview({ id: live.id, subject: answer.letter.subject, text, email, previewToken: answer.previewToken });
      } else {
        const subject = tidySubject(typed.subject);
        const text = letterAsItLeaves(typed.body, closingParts(live));
        setPreview({ id: live.id, subject, text, email: emailDraftFor(subject, text) });
      }
      return null;
    } catch (err) {
      return errorText(err);
    }
  }, [save, refresh]);

  // The page address can ask for the preview of a letter (&preview=1). It is opened once, when the letter is there.
  const [openProblem, setOpenProblem] = useState<string | null>(null);
  const askedForPreview = useRef(false);
  const draftId = draft?.id ?? null;
  useEffect(() => {
    if (!named.preview || askedForPreview.current || !snap || named.letterId === null) return;
    if (selectedId !== named.letterId || draftId !== named.letterId) return;
    askedForPreview.current = true;
    void openPreview().then((problem) => {
      if (problem) setOpenProblem(`The preview could not be opened. ${problem}`);
    });
  }, [named, snap, selectedId, draftId, openPreview]);

  // When the preview closes, the keyboard focus goes back to the button that opened it, or to the
  // next step when the letter was sent from the preview.
  const hadPreview = useRef(false);
  useEffect(() => {
    if (hadPreview.current && !previewShown) {
      window.setTimeout(() => {
        const row = document.querySelector<HTMLElement>('.panel--letter .letter-buttons');
        const back =
          row?.querySelector<HTMLElement>('.btn-primary:not(:disabled)') ??
          row?.querySelector<HTMLElement>('[data-opens="preview"]:not(:disabled)');
        back?.focus();
      }, 0);
    }
    hadPreview.current = previewShown;
  }, [previewShown]);

  // Edits are saved before another letter is opened and before the panel goes away.
  const choose = async (id: string | null) => {
    if (id === selectedId) return;
    if (await save()) {
      setNotice(null);
      setOpenProblem(null);
      open(id);
    }
  };
  const close = async () => {
    if (await save()) onClose();
  };

  const caseById = useMemo(() => new Map((snap?.state.cases ?? []).map((c) => [c.id, c] as const)), [snap]);
  const findingById = useMemo(() => new Map((snap?.state.findings ?? []).map((f) => [f.id, f] as const)), [snap]);

  const showList = wide || selected === null;
  const showDetail = selected !== null;
  const selectedFinding = selected ? findingById.get(selected.findingId) : undefined;
  const problem = saveError ?? openProblem;

  return (
    <>
      <Panel name="letter" title="Letters to the doctor" icon={<LetterGlyph />} note={pageNote} covered={previewShown} onClose={() => void close()}>
        <div className={`letters${wide ? ' letters--wide' : ''}`}>
          {showList ? (
            <nav className="letter-list" aria-label="All letters">
              {isReplay ? <p className="note">{RECORDED_BUTTONS_OFF}</p> : null}
              {!snap ? <p className="empty">Waiting for the local server.</p> : null}
              {snap && sorted.length === 0 ? <p className="empty">{noLettersWords(pageView, names)}</p> : null}
              <ul>
                {sorted.map((letter) => {
                  const view = letterView(letter, nowIso);
                  const c = caseById.get(letter.caseId);
                  const what = letterRowWhat(letter, (id) => {
                    const found = findingById.get(id);
                    const named = found ? criteria[found.criterionId] : undefined;
                    return named ? criterionName(named) : undefined;
                  });
                  const isNew = letter.status === 'ready' && !letter.seenByPharmacist;
                  return (
                    <li key={letter.id}>
                      <button
                        type="button"
                        className={`letter-row letter-row--${view}${letter.id === selectedId ? ' letter-row--open' : ''}`}
                        aria-current={letter.id === selectedId ? 'true' : undefined}
                        onClick={() => void choose(letter.id)}
                      >
                        <span className="letter-row-top">
                          <span className="letter-row-who">{c?.patient.label ?? 'Fictional patient'}</span>
                          <span className={`chip chip--${view}`}>{VIEW_WORDS[view]}</span>
                        </span>
                        <span className="letter-row-what">
                          {what}
                        </span>
                        <span className={`letter-row-detail${view === 'overdue' ? ' letter-row-detail--alarm' : ''}`}>
                          {isNew ? <span className="new-dot" aria-hidden="true" /> : null}
                          {statusDetail(letter, view, nowIso, sample)}
                          <span className="letter-row-id">
                            <span className="sr-only">Letter </span>
                            {letter.id}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ) : null}

          {showDetail && selected && draft && draft.id === selected.id ? (
            <div className="letter-pane">
              {problem ? (
                <p className="note note--error" role="alert">
                  <span>
                    {problem}
                    {saveError ? (
                      <>
                        {' '}
                        The text is kept in this browser.{' '}
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => {
                            // The pharmacist chooses to let his changes go, so that he is never stuck here.
                            setDraft(draftOf(selected));
                            setSaveError(null);
                          }}
                        >
                          Drop my changes
                        </button>
                      </>
                    ) : null}
                  </span>
                </p>
              ) : null}
              <LetterDetail
                letter={selected}
                view={letterView(selected, nowIso)}
                nowIso={nowIso}
                finding={selectedFinding}
                caseRecord={caseById.get(selected.caseId)}
                criterion={selectedFinding ? criteria[selectedFinding.criterionId] : undefined}
                findings={snap?.state.findings ?? []}
                criteria={criteria}
                draft={draft}
                saving={saving}
                notice={notice}
                setNotice={setNotice}
                onDraft={(change) => {
                  setOpenProblem(null);
                  setDraft((prev) => {
                    if (!prev) return prev;
                    const next = { ...prev, ...change };
                    // Kept in this browser at once, under the letter's ID.
                    if (!isReplay) writeStoredDraft(browserStorage, next.id, next);
                    return next;
                  });
                }}
                save={save}
                refresh={refresh}
                onBack={wide ? null : () => void choose(null)}
                onPreview={openPreview}
                names={names}
              />
            </div>
          ) : null}

          {wide && !selected && sorted.length > 0 ? <p className="empty letter-pane">Choose a letter from the list.</p> : null}
        </div>
      </Panel>

      {/* The preview is a page of its own over the letters: the one place from which a letter leaves. */}
      {previewShown && preview && selected ? (
        <LetterPreview
          letter={selected}
          view={letterView(selected, nowIso)}
          subject={preview.subject}
          text={preview.text}
          emailDraft={preview.email}
          previewToken={preview.previewToken}
          pageNote={pageNote}
          wide={wide}
          leavingForEmail={leavingForEmail}
          refresh={refresh}
          onBack={() => setPreview(null)}
          onSent={() => {
            // The letter has left: the copy kept in this browser is not needed any more.
            clearStoredDraft(browserStorage, selected.id);
            setPreview(null);
            setNotice('Marked as sent. Record the reply when it comes.');
          }}
        />
      ) : null}
    </>
  );
}
