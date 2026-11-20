// What the page shows for a letter: its status in plain words, whether it is overdue, its last
// lines (which cannot be edited), the text that leaves, and the link that opens the email program.
import type { EmailDraft, Letter, ReplyOutcome } from '../../shared/types.ts';
import { daysFromTo, formatDate, formatShortDate, plural } from './format.ts';
import { JOB_NAMES } from './modelNames.ts';

export const FICTIONAL_LINE = 'Fictional patient. No real person.';
export const MODEL_LINE = 'Drafted by a local AI model. Read by the pharmacist before sending.';
export const EMAIL_COVER_NOTE =
  'The letter is longer than an email draft can hold. Please copy it from the preview, or print it.';
export const EMAIL_DRAFT_LIMIT = 1800;
/** The words above the last lines of every letter. */
export const SIGN_OFF = 'Yours sincerely,';

/** The letter's status as the page shows it. "overdue" is a sent letter past its due time with no reply. */
export type LetterView = 'drafting' | 'ready' | 'sent' | 'overdue' | 'reply_recorded' | 'closed';

export function letterView(letter: Letter, nowIso: string): LetterView {
  if (letter.status === 'sent' && isOverdue(letter, nowIso)) return 'overdue';
  return letter.status;
}

export function isOverdue(letter: Letter, nowIso: string): boolean {
  if (letter.status !== 'sent' || letter.reply || !letter.dueAt) return false;
  const due = new Date(letter.dueAt).getTime();
  const now = new Date(nowIso).getTime();
  return Number.isFinite(due) && Number.isFinite(now) && now > due;
}

/** Whole days past the due time, at least 1 when overdue. */
export function daysOverdue(letter: Letter, nowIso: string): number {
  return isOverdue(letter, nowIso) ? Math.max(1, daysFromTo(letter.dueAt, nowIso)) : 0;
}

export const VIEW_WORDS: Record<LetterView, string> = {
  drafting: 'Being written',
  ready: 'Ready to review',
  sent: 'Sent',
  overdue: 'Overdue',
  reply_recorded: 'Reply recorded',
  closed: 'Closed',
};

export const OUTCOME_WORDS: Record<ReplyOutcome, string> = {
  changed: 'The doctor changed the medicines',
  not_changed: 'The doctor made no change',
  will_review: 'The doctor will review the patient',
  other: 'Other',
};

export const OUTCOME_ORDER: ReplyOutcome[] = ['changed', 'not_changed', 'will_review', 'other'];

/**
 * The line under the status chip in a row of the list: what the letter waits for.
 * `sample` is true in the sample view, where no model writes a letter.
 */
/**
 * The finding a one-point row names. When the letter carries a list, the first id of that list
 * wins over `findingId`. A letter saved before the list existed still uses `findingId`.
 */
export function letterRowFindingId(letter: { findingId: string; findingIds?: string[] }): string {
  if (letter.findingIds && letter.findingIds.length > 0) return letter.findingIds[0];
  return letter.findingId;
}

/** The text the printer gets. A sent letter keeps its body, and says above it when an answer was taken back. */
export function printedLetter(body: string, withdrawnNote?: string): string {
  if (!withdrawnNote) return body;
  return `${withdrawnNote}\n\n${body}`;
}

/** The words in `.letter-row-what`. More than one point is "N points". One point is that finding's name. */
export function letterRowWhat(
  letter: { findingId: string; findingIds?: string[]; subject: string },
  criterionNameFor: (findingId: string) => string | undefined,
): string {
  const listed = letter.findingIds && letter.findingIds.length > 0 ? letter.findingIds : undefined;
  if (listed && listed.length > 1) return `${listed.length} points`;
  const named = criterionNameFor(letterRowFindingId(letter));
  return named || letter.subject || 'Letter to the doctor';
}

export function statusDetail(letter: Letter, view: LetterView, nowIso: string, sample = false): string {
  const takenBack = letter.withdrawnNote
    && (letter.status === 'sent' || letter.status === 'reply_recorded' || letter.status === 'closed')
    ? letter.withdrawnNote
    : '';
  const withNote = (detail: string): string => (takenBack ? `${detail} ${takenBack}` : detail);
  switch (view) {
    case 'drafting':
      if (letter.withdrawnNote) return 'A point was withdrawn';
      return sample ? 'Shown as being written (sample)' : `${JOB_NAMES.letter} is writing it`;
    case 'ready':
      return letter.seenByPharmacist ? 'Waiting for your review' : 'New';
    case 'sent':
      return withNote(letter.dueAt ? `Reply due by ${formatShortDate(letter.dueAt)}` : 'Waiting for a reply');
    case 'overdue':
      return withNote(`No reply. Overdue by ${plural(daysOverdue(letter, nowIso), 'day', 'days')}`);
    case 'reply_recorded':
      return withNote(letter.reply ? OUTCOME_WORDS[letter.reply.outcome] : 'Reply recorded');
    case 'closed':
      return withNote(letter.closedAt ? `Closed on ${formatShortDate(letter.closedAt)}` : 'Closed');
  }
}

/** The line under the buttons of an open letter: what the pharmacist does next. */
export function nextStep(letter: Letter, view: LetterView, nowIso: string): string {
  switch (view) {
    case 'drafting':
      return '';
    case 'ready':
      return letter.patientAgreed
        ? 'Next: open the preview. There you print the letter or open it in your email program, and mark it as sent.'
        : 'Next: read the letter and edit it if you need to. Tick the box when the patient agrees. Then open the preview to print or email it, and mark it as sent.';
    case 'sent':
      return `The letter was sent. Record the doctor's reply when it comes${letter.dueAt ? `. It is due by ${formatDate(letter.dueAt)}` : ''}.`;
    case 'overdue':
      return `No reply yet. It was due on ${formatDate(letter.dueAt)}, ${plural(daysOverdue(letter, nowIso), 'day', 'days')} ago. Contact the practice, then record the reply.`;
    case 'reply_recorded':
      return 'The reply is recorded. Close the case when nothing more is needed.';
    case 'closed':
      if (!letter.sentAt) return 'This case is closed. The letter was not sent.';
      return letter.reply ? 'This case is closed. The loop is complete.' : 'This case is closed. No reply was recorded.';
  }
}

// ---------- the last lines of a letter ----------

export interface LetterClosingParts {
  /** The line about who wrote the words. Empty when the letter carries none. */
  closingLine: string;
  signatureName: string;
  signatureTitle: string;
  signatureRegistration: string;
}

type WithClosing = Pick<Letter, 'draft' | 'closingLine' | 'signatureName' | 'signatureTitle' | 'signatureRegistration'>;

/**
 * The last lines of a letter, as the server sends them with it. They are kept apart from the text
 * the pharmacist edits, so an edit cannot delete them. A saved letter that carries none of the
 * four fields shows no closing sentence: the page does not write one in.
 */
export function closingParts(letter: WithClosing): LetterClosingParts {
  return {
    closingLine: letter.closingLine ?? '',
    signatureName: letter.signatureName ?? 'The pharmacist on duty',
    signatureTitle: letter.signatureTitle ?? 'Pharmacist',
    signatureRegistration: letter.signatureRegistration ?? '',
  };
}

/** The last lines, top to bottom, without the empty ones. */
export function closingLines(closing: LetterClosingParts): string[] {
  return [closing.closingLine, closing.signatureName, closing.signatureTitle, closing.signatureRegistration]
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export function signatureBlock(closing: LetterClosingParts): string {
  return closingLines(closing).join('\n');
}

/**
 * The text the pharmacist edits: the letter without "Yours sincerely,", the line about who wrote
 * the words and the three signature lines, when it ends with them. A text that does not end with
 * them comes back exactly as it is.
 * The server keeps every letter with those lines at its end. The page shows them once, under the
 * text box, where they cannot be changed.
 */
export function editableBody(body: string, closing: LetterClosingParts): string {
  const last = closingLines(closing);
  if (last.length === 0) return body;
  const lines = body.replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n');
  let at = lines.length;
  for (let i = last.length - 1; i >= 0; i--) {
    at -= 1;
    if (at < 0 || lines[at].trim() !== last[i]) return body;
  }
  // "Yours sincerely," stands above them, after an empty line.
  let head = at;
  while (head > 0 && lines[head - 1].trim() === '') head -= 1;
  if (head > 0 && lines[head - 1].trim() === SIGN_OFF) head -= 1;
  else head = at;
  return lines.slice(0, head).join('\n').replace(/\s+$/, '');
}

/** True when the text ends with the last lines of the letter. */
export function endsWithClosing(body: string, closing: LetterClosingParts): boolean {
  return editableBody(body, closing) !== body;
}

/**
 * The letter as it leaves. The line about who wrote the words and the three signature lines are
 * put back at the end, so an edit cannot delete them. Text typed after them is kept, above them.
 */
export function letterAsItLeaves(body: string, closing: LetterClosingParts): string {
  let text = body.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
  const block = signatureBlock(closing);
  const at = block === '' ? -1 : text.lastIndexOf(block);
  if (at >= 0) {
    const before = text.slice(0, at).replace(/\s+$/, '');
    const after = text.slice(at + block.length).replace(/^\s+/, '');
    const head = before.endsWith(SIGN_OFF)
      ? before.slice(0, before.lastIndexOf(SIGN_OFF)).replace(/\s+$/, '')
      : before;
    text = after ? `${head}\n\n${after}` : head;
  }
  let base = text.replace(/\s+$/, '');
  if (!base.includes(FICTIONAL_LINE)) base = `${base}\n\n${FICTIONAL_LINE}`;
  return `${base}\n\n${SIGN_OFF}\n\n${block}`;
}

export function letterLeavingText(letter: Pick<Letter, 'body'> & WithClosing): string {
  return letterAsItLeaves(letter.body, closingParts(letter));
}

/** The text that Copy puts on the clipboard and that Print puts on paper. */
export function letterPlainText(letter: Pick<Letter, 'body'> & WithClosing): string {
  return letterLeavingText(letter);
}

/** Every text that leaves says that the patient is fictional. A text that lost the line gets it back, at its top. */
export function withFictionalLine(text: string): string {
  return text.includes(FICTIONAL_LINE) ? text : `${FICTIONAL_LINE}\n\n${text}`;
}

/** The draft that opens in the pharmacist's own mail program. It carries no address. */
export function emailDraftFor(subject: string, leavingText: string, limit = EMAIL_DRAFT_LIMIT): EmailDraft {
  const fits = leavingText.length <= limit;
  return { subject, text: fits ? leavingText : EMAIL_COVER_NOTE, fits, coverNote: !fits };
}

/** Build the email draft from the letter as the page holds it. */
export function emailDraftFromLetter(letter: Letter, subject: string, body: string): EmailDraft {
  return emailDraftFor(subject, letterAsItLeaves(body, closingParts(letter)));
}

/**
 * Print, Open in my email program, Copy and Mark as sent are open only after a preview of the
 * letter as it stands, and not while unsaved edits are in the editor.
 */
export function outboundStepsOpen(letter: Letter, unsavedEdits: boolean): boolean {
  if (unsavedEdits) return false;
  return Boolean(letter.previewedAt && letter.previewHash);
}

/** A short note when the letter does not fit in an email draft. */
export function coverNote(): string {
  return [
    'Dear Doctor,',
    '',
    'Please see the letter from the pharmacy about a medicines review for a shared patient.',
    'The letter is pasted below this note or attached.',
    '',
    'Kind regards,',
    'The pharmacist',
    '',
    FICTIONAL_LINE,
  ].join('\n');
}

/**
 * A mailto link with the subject and either the whole letter or a short cover note.
 * There is no address in it: the pharmacist picks the doctor in his own email program.
 */
export function mailtoHref(subject: string, bodyText: string): string {
  const crlf = bodyText.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  return `mailto:?subject=${encodeURIComponent(subject.trim())}&body=${encodeURIComponent(crlf)}`;
}

/** What "Open in my email program" has to do, as steps that can be tried without a browser. */
export interface EmailSteps {
  /** Saves the edits. False when they could not be saved. */
  save(): Promise<boolean>;
  /** Copies the letter, ready to paste. False when it could not be copied. */
  copy(): Promise<boolean>;
  /** Told true just before the email program is opened: opening it is not leaving the page. */
  leaving(on: boolean): void;
  /** Opens the email program with the subject and the draft text. */
  open(): void;
}

export type EmailOutcome = 'not_saved' | 'opened_and_copied' | 'opened';

/**
 * Saves the edits first and only then opens the email program. Until 18 November the link opened
 * while the save was still on its way: the browser asked "leave this page?", and when the answer
 * was no, the page still said that the email program had opened.
 */
export async function openEmail(steps: EmailSteps): Promise<EmailOutcome> {
  if (!(await steps.save())) return 'not_saved';
  const copied = await steps.copy();
  steps.leaving(true);
  steps.open();
  return copied ? 'opened_and_copied' : 'opened';
}

/** Order for the list: letters that need the pharmacist first, finished ones last. */
const VIEW_RANK: Record<LetterView, number> = {
  overdue: 0,
  ready: 1,
  drafting: 2,
  sent: 3,
  reply_recorded: 4,
  closed: 5,
};

export function sortLetters(letters: Letter[], nowIso: string): Letter[] {
  return letters
    .map((letter, index) => ({ letter, index, rank: VIEW_RANK[letterView(letter, nowIso)] }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.letter);
}

// ---------- why a button is off, in plain words ----------

export function whyNotReady(view: LetterView): string {
  if (view === 'drafting') return 'The letter is still being written.';
  if (view === 'sent' || view === 'overdue') return 'This letter was already sent.';
  if (view === 'reply_recorded') return 'The reply is already recorded.';
  if (view === 'closed') return 'This case is closed.';
  return '';
}

/** The preview opens for every letter that has text. What was typed is saved first. */
export function whyNoPreview(view: LetterView, hasText: boolean): string {
  if (view === 'drafting') return 'The letter is still being written.';
  if (!hasText) return 'The letter has no text.';
  return '';
}

export function whyNoOutbound(letter: Letter, unsavedEdits: boolean): string {
  if (unsavedEdits) return 'You have unsaved edits. Save them, then open the preview again.';
  if (!letter.previewedAt) return 'Open the preview and read the letter as it will leave.';
  if (!letter.previewHash) return 'Open the preview again.';
  return '';
}

export function whyNoSent(view: LetterView): string {
  if (view !== 'ready') return whyNotReady(view) || 'Only a letter that is ready to review can be marked as sent.';
  return '';
}

export function whyNoReply(view: LetterView): string {
  if (view !== 'sent' && view !== 'overdue' && view !== 'reply_recorded') {
    return 'Record a reply only after the letter was sent.';
  }
  return '';
}

export function whyNoClose(view: LetterView): string {
  if (view === 'drafting') return 'The letter is still being written.';
  if (view === 'closed') return 'This case is already closed.';
  return '';
}
