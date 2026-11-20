// One letter for a patient. Each finding is still drafted on its own. This file only joins
// those drafts. It does not call a model and it does not change a request.
import type { HistoryLine, Letter, LetterDraft, ReplyOutcome } from './types.ts';
import { listFacts, tidyFacts } from './facts.ts';

export const PATIENT_FICTIONAL_LINE = 'Fictional patient. No real person.';
export const PATIENT_MODEL_LINE = 'Drafted by a local AI model. Read by the pharmacist before sending.';
/** Said once, when some points were written by the model and some by the template. */
export const MIXED_WRITING_LINE =
  'Some of these points were drafted by a local AI model and some were built from the standard letter template. Read by the pharmacist before sending.';

const PRESCRIBER = /^(dr|doctor)\b/i;
const NO_LINE = 'No single line was identified. Please see the full dispensing history.';

export interface PatientLetterPart {
  pending?: boolean;
  subject: string;
  origin?: 'model' | 'template';
  findingParagraph: string;
  evidenceParagraph: string;
  requestParagraph: string;
  sameDay?: boolean;
  /** Printed inside the point, as "The record we hold does not show: ...". */
  doesNotShowLine?: string;
  criterionLabel?: string;
  criterionStatement?: string;
  sourceCredit?: string;
  modificationNotice?: string;
  linesHeading?: string;
  cited?: HistoryLine[];
  cannotBeSeen?: string;
  /**
   * The whole letter for this finding alone. When the patient letter holds only this point,
   * that letter is returned unchanged, so one finding still reads as it does today.
   */
  singleLetter?: string;
}

export interface PatientLetterHead {
  pharmacyName: string;
  pharmacyAddress: string;
  phone: string;
  pharmacist: string;
  dateText: string;
  addresseeName: string;
  addresseePractice: string;
  patientLine: string;
}

export interface PatientLetterClosing {
  closingLine: string;
  signatureName: string;
  signatureTitle: string;
  signatureRegistration: string;
}

/**
 * The findings of a letter, in the order the pharmacist accepted them.
 * An empty list means every point has left. A letter saved before one letter per patient has no list,
 * and is still the one finding named on it.
 */
export function letterFindingIds(letter: { findingId: string; findingIds?: string[] }): string[] {
  if (letter.findingIds) return [...letter.findingIds];
  return [letter.findingId];
}

/** The line above the signature. Mixed letters say so. A template-only letter has no line, as today. */
export function writingLine(origins: Array<'model' | 'template' | undefined>): string {
  const known = origins.filter((origin): origin is 'model' | 'template' => origin === 'model' || origin === 'template');
  const model = known.some(origin => origin === 'model');
  const template = known.some(origin => origin === 'template');
  if (model && template) return MIXED_WRITING_LINE;
  if (model) return PATIENT_MODEL_LINE;
  return '';
}

/** The prescriber named in one line, when a segment starts with Dr or Doctor. Same rule as the single letter. */
export function prescriberMostNamed(
  cited: { text: string }[], doctor: { name: string; practice: string }
): { name: string; practice: string } {
  const tallies: { name: string; n: number; last: number }[] = [];
  cited.forEach((line, index) => {
    const parts = line.text.split(' | ').map(part => part.trim()).filter(Boolean);
    let name: string | null = null;
    for (let i = parts.length - 1; i >= 0; i--) {
      if (PRESCRIBER.test(parts[i])) {
        name = parts[i];
        break;
      }
    }
    if (!name) return;
    const found = tallies.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (!found) tallies.push({ name, n: 1, last: index });
    else {
      found.n += 1;
      found.last = index;
      found.name = name;
    }
  });
  if (tallies.length === 0) return { name: doctor.name, practice: doctor.practice };
  tallies.sort((a, b) => b.n - a.n || b.last - a.last);
  return { name: tallies[0].name, practice: '' };
}

/** The part's own heading. A contents list uses this same line, so the numbers cannot drift. */
function pointHeading(part: PatientLetterPart, index: number): string {
  if (part.pending) return `${index + 1}. Being written`;
  return `${index + 1}. ${part.subject}`;
}

function pointLines(part: PatientLetterPart, index: number): string[] {
  if (part.pending) {
    return [pointHeading(part, index), '', 'This point is still being written.'];
  }
  const out: string[] = [pointHeading(part, index)];
  if (part.sameDay) out.push('Urgency: same day. Please review today if you can.');
  if (part.doesNotShowLine) out.push(part.doesNotShowLine);
  if (part.findingParagraph) out.push('', part.findingParagraph);
  if (part.evidenceParagraph) out.push('', part.evidenceParagraph);
  if (part.requestParagraph) out.push('', part.requestParagraph);
  if (part.criterionLabel || part.criterionStatement) {
    out.push('', 'The criterion this is based on', `${part.criterionLabel ?? ''}: ${part.criterionStatement ?? ''}`.replace(/: $/, ''));
  }
  if (part.sourceCredit) out.push(`Source: ${part.sourceCredit}`);
  if (part.modificationNotice) out.push(part.modificationNotice);
  out.push('', part.linesHeading || 'Lines from our records');
  if (part.cited && part.cited.length > 0) out.push(...part.cited.map(line => line.text));
  else out.push(NO_LINE);
  if (part.cannotBeSeen) out.push('', 'What a dispensing history cannot show', part.cannotBeSeen);
  return out;
}

/**
 * The patient's letter. One head, one greeting, one ending.
 * One ready point whose single letter is kept is returned as that letter, unchanged.
 */
export function renderPatientLetter(
  head: PatientLetterHead, parts: PatientLetterPart[], closing: PatientLetterClosing
): string {
  if (parts.length === 1 && !parts[0].pending && parts[0].singleLetter) return parts[0].singleLetter;
  const n = parts.length;
  const pointsWord = n === 1 ? 'point' : 'points';
  const out: string[] = [
    head.pharmacyName,
    head.pharmacyAddress,
    `Phone: ${head.phone}`,
    `Pharmacist: ${head.pharmacist}`,
    '',
    head.dateText,
    '',
    `To: ${head.addresseeName}`,
    ...(head.addresseePractice ? [head.addresseePractice] : []),
    '',
    `Patient: ${head.patientLine}`,
    PATIENT_FICTIONAL_LINE,
    '',
    `Re: ${n} ${pointsWord} for this patient`
  ];
  const sameDay = parts.flatMap((part, index) => part.sameDay && !part.pending ? [`Point ${index + 1}: ${part.subject}`] : []);
  if (sameDay.length > 0) {
    out.push('Urgency: same day. Please review today if you can.', ...sameDay);
  }
  out.push(
    '',
    'Dear Doctor,',
    '',
    `I have reviewed this patient's dispensing history and I raise ${n} ${pointsWord}, numbered below.`
  );
  if (n > 3) out.push('', ...parts.map(pointHeading));
  for (const [index, part] of parts.entries()) {
    out.push('', ...pointLines(part, index));
  }
  const end = ['', 'Yours sincerely,', ''];
  if (closing.closingLine) end.push(closing.closingLine);
  end.push(closing.signatureName, closing.signatureTitle, closing.signatureRegistration);
  out.push(...end);
  return out.join('\n');
}

function paragraphBlocks(lines: string[]): string[] {
  const blocks: string[] = [];
  let buf: string[] = [];
  const flush = (): void => {
    const text = buf.join('\n').trim();
    if (text) blocks.push(text);
    buf = [];
  };
  for (const line of lines) {
    if (line.trim() === '') flush();
    else buf.push(line.trim());
  }
  flush();
  return blocks;
}

/** Reads one finding's letter back into the pieces a patient letter is built from. */
export function partFromLetterBody(body: string, subject: string, origin?: 'model' | 'template'): PatientLetterPart {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const at = (label: string): number => lines.findIndex(line => line.trim() === label);
  const dear = at('Dear Doctor,');
  const yours = at('Yours sincerely,');
  const criterionAt = at('The criterion this is based on');
  const linesAt = lines.findIndex(line => line.trim() === 'Lines from our records' || line.trim() === 'Dispensing lines from our records');
  const cannotAt = at('What a dispensing history cannot show');
  if (dear < 0) {
    return {
      subject, origin, findingParagraph: body.trim(), evidenceParagraph: '', requestParagraph: '',
      cited: [], singleLetter: body
    };
  }
  const head = lines.slice(0, dear).map(line => line.trim());
  const re = head.find(line => line.startsWith('Re:'));
  const doesNotShow = head.find(line => line.startsWith('The record we hold does not show:'));
  const middleEnd = criterionAt >= 0 ? criterionAt : (yours >= 0 ? yours : lines.length);
  const paras = paragraphBlocks(lines.slice(dear + 1, middleEnd));
  let criterionLabel = '';
  let criterionStatement = '';
  let sourceCredit = '';
  let modificationNotice = '';
  if (criterionAt >= 0) {
    const stop = linesAt >= 0 ? linesAt : (cannotAt >= 0 ? cannotAt : (yours >= 0 ? yours : lines.length));
    const block = lines.slice(criterionAt + 1, stop).map(line => line.trim()).filter(Boolean);
    const first = block[0] ?? '';
    const split = first.indexOf(': ');
    if (split >= 0) {
      criterionLabel = first.slice(0, split);
      criterionStatement = first.slice(split + 2);
    } else {
      criterionStatement = first;
    }
    const rest = block.slice(1);
    const source = rest.find(line => line.startsWith('Source: '));
    if (source) sourceCredit = source.slice('Source: '.length).trim();
    modificationNotice = rest.filter(line => line !== source).join('\n');
  }
  let cited: HistoryLine[] = [];
  let linesHeading = 'Lines from our records';
  if (linesAt >= 0) {
    linesHeading = lines[linesAt].trim();
    const stop = cannotAt >= 0 ? cannotAt : (yours >= 0 ? yours : lines.length);
    cited = lines.slice(linesAt + 1, stop).map(line => line.trim()).filter(line => line && line !== NO_LINE)
      .map((text, index) => ({ id: `C${index + 1}`, text }));
  }
  let cannotBeSeen = '';
  if (cannotAt >= 0) {
    const stop = yours >= 0 ? yours : lines.length;
    cannotBeSeen = lines.slice(cannotAt + 1, stop).join('\n').trim();
  }
  return {
    subject: re ? re.slice(3).trim() : subject,
    origin,
    findingParagraph: paras[0] ?? '',
    evidenceParagraph: paras[1] ?? '',
    requestParagraph: paras.slice(2).join('\n\n'),
    sameDay: head.some(line => line.startsWith('Urgency: same day')),
    doesNotShowLine: doesNotShow,
    criterionLabel,
    criterionStatement,
    sourceCredit,
    modificationNotice,
    linesHeading,
    cited,
    cannotBeSeen,
    singleLetter: body
  };
}

/** The head of one finding's letter: pharmacy, date, addressee and patient. */
export function headFromLetterBody(body: string): PatientLetterHead | null {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const toAt = lines.findIndex(line => line.startsWith('To: '));
  const patientAt = lines.findIndex(line => line.startsWith('Patient: '));
  if (toAt < 1 || !lines[0]?.trim()) return null;
  const phone = lines.find(line => line.startsWith('Phone: '));
  const pharmacist = lines.find(line => line.startsWith('Pharmacist: '));
  const date = lines.slice(0, toAt).map(line => line.trim()).find(line =>
    line !== '' && !line.startsWith('Phone:') && !line.startsWith('Pharmacist:') && line !== lines[0].trim() && line !== lines[1]?.trim() && /\d/.test(line));
  const practice = lines[toAt + 1]?.trim() && !lines[toAt + 1].startsWith('Patient:') ? lines[toAt + 1].trim() : '';
  return {
    pharmacyName: lines[0].trim(),
    pharmacyAddress: (lines[1] ?? '').trim(),
    phone: phone ? phone.slice('Phone: '.length).trim() : '',
    pharmacist: pharmacist ? pharmacist.slice('Pharmacist: '.length).trim() : '',
    dateText: date ?? '',
    addresseeName: lines[toAt].slice('To: '.length).trim(),
    addresseePractice: practice,
    patientLine: patientAt >= 0 ? lines[patientAt].slice('Patient: '.length).trim() : 'Fictional patient'
  };
}

function closingFromLetter(letter: Letter, origins: Array<'model' | 'template' | undefined>): PatientLetterClosing {
  const lines = letter.body.replace(/\r\n?/g, '\n').split('\n');
  const yours = lines.findIndex(line => line.trim() === 'Yours sincerely,');
  const tail = yours >= 0 ? lines.slice(yours + 1).map(line => line.trim()).filter(Boolean) : [];
  const signature = tail.slice(-3);
  return {
    closingLine: writingLine(origins),
    signatureName: letter.signatureName || signature[0] || '',
    signatureTitle: letter.signatureTitle || signature[1] || '',
    signatureRegistration: letter.signatureRegistration || signature[2] || ''
  };
}

function mergedStatus(letters: Letter[]): Letter['status'] {
  if (letters.some(letter => letter.status === 'drafting')) return 'drafting';
  if (letters.every(letter => letter.status === 'closed')) return 'closed';
  if (letters.every(letter => letter.sentAt) && letters.some(letter => letter.reply || letter.status === 'reply_recorded')) {
    return 'reply_recorded';
  }
  if (letters.every(letter => letter.sentAt)) return 'sent';
  return 'ready';
}

function mergedReply(letters: Letter[]): Letter['reply'] {
  const withReply = letters.filter(letter => letter.reply);
  if (withReply.length === 0) return undefined;
  const first = withReply[0].reply!;
  const points: { findingId: string; outcome: ReplyOutcome; note?: string }[] = [];
  for (const letter of withReply) {
    const reply = letter.reply!;
    if (reply.outcome !== first.outcome || (reply.note && reply.note !== first.note)) {
      points.push({ findingId: letter.findingId, outcome: reply.outcome, ...(reply.note ? { note: reply.note } : {}) });
    }
    for (const point of reply.points ?? []) {
      if (point.outcome !== first.outcome) points.push(point);
    }
  }
  return { at: first.at, outcome: first.outcome, note: first.note, ...(points.length > 0 ? { points } : {}) };
}

/** Joins stored one-finding letters into one letter. The drafts already on them are kept. */
export function combineStoredLetters(letters: Letter[]): Letter {
  const ordered = [...letters].sort((a, b) => a.id.localeCompare(b.id));
  const first = ordered[0];
  const parts = ordered.map(letter => {
    if (letter.status === 'drafting' && !letter.draft) {
      return { pending: true, subject: 'Being written', findingParagraph: '', evidenceParagraph: '', requestParagraph: '' };
    }
    return partFromLetterBody(letter.body || letter.draft?.body || '', letter.draft?.subject || letter.subject, letter.draft?.origin);
  });
  const cited = parts.flatMap(part => part.cited ?? []);
  const parsed = headFromLetterBody(first.body || first.draft?.body || '');
  const fallback = { name: parsed?.addresseeName || 'the doctor', practice: parsed?.addresseePractice || '' };
  const addressee = prescriberMostNamed(cited, fallback);
  const head: PatientLetterHead = parsed ?? {
    pharmacyName: '', pharmacyAddress: '', phone: '', pharmacist: '', dateText: '',
    addresseeName: addressee.name, addresseePractice: addressee.practice, patientLine: 'Fictional patient'
  };
  head.addresseeName = addressee.name;
  head.addresseePractice = addressee.practice;
  const origins = ordered.map(letter => letter.draft?.origin);
  const closing = closingFromLetter(first, origins);
  const body = renderPatientLetter(head, parts, closing);
  const n = ordered.length;
  const subject = `${n} ${n === 1 ? 'point' : 'points'} for this patient`;
  const draftSource = ordered.find(letter => letter.draft)?.draft;
  const draft: LetterDraft | undefined = draftSource ? {
    ...draftSource,
    subject,
    body,
    checkNotes: ordered.flatMap(letter => letter.draft?.checkNotes ?? []),
    seconds: ordered.reduce((sum, letter) => sum + (letter.draft?.seconds ?? 0), 0)
  } : undefined;
  if (draft) {
    const allTemplate = origins.length > 0 && origins.every(origin => origin === 'template');
    draft.origin = allTemplate ? 'template' : (origins.some(origin => origin === 'model') ? 'model' : draft.origin);
    if (!allTemplate) delete draft.templateReason;
  }
  const agreed = ordered.every(letter => letter.patientAgreed)
    ? ordered.map(letter => letter.patientAgreed!).sort((a, b) => a.at.localeCompare(b.at))[0]
    : undefined;
  const sent = ordered.find(letter => letter.sentAt);
  const reply = mergedReply(ordered);
  const merged: Letter = {
    id: first.id,
    findingId: ordered[0].findingId,
    findingIds: ordered.map(letter => letter.findingId),
    points: ordered.map(letter => ({ findingId: letter.findingId, ...(letter.draft ? { draft: letter.draft } : {}) })),
    caseId: first.caseId,
    status: mergedStatus(ordered),
    subject,
    body,
    editedByPharmacist: false,
    seenByPharmacist: ordered.every(letter => letter.seenByPharmacist),
    ...(draft ? { draft } : {}),
    ...(closing.closingLine ? { closingLine: closing.closingLine } : {}),
    ...(closing.signatureName ? { signatureName: closing.signatureName } : {}),
    ...(closing.signatureTitle ? { signatureTitle: closing.signatureTitle } : {}),
    ...(closing.signatureRegistration ? { signatureRegistration: closing.signatureRegistration } : {}),
    ...(agreed ? { patientAgreed: agreed } : {}),
    ...(sent?.sentAt ? { sentAt: sent.sentAt } : {}),
    ...(sent?.sentBy ? { sentBy: sent.sentBy } : {}),
    ...(sent?.dueAt ? { dueAt: sent.dueAt } : {}),
    ...(reply ? { reply } : {}),
    ...(ordered.every(letter => letter.closedAt) ? { closedAt: ordered.map(letter => letter.closedAt!).sort().at(-1) } : {})
  };
  return merged;
}

/**
 * An old state file kept one letter per finding. Those letters of one patient become one letter.
 * A letter that already names its findings is left as it is. Nothing is drafted again.
 * Returns true when a letter was joined.
 */
export function mergeLegacyPatientLetters(state: { letters: Letter[]; issued?: { C: number; F: number; T: number; J: number } }): boolean {
  const open = new Map<string, Letter[]>();
  const sent = new Map<string, Letter[]>();
  for (const letter of state.letters) {
    if (letter.findingIds && letter.findingIds.length > 0) continue;
    const bag = letter.sentAt ? sent : open;
    const list = bag.get(letter.caseId) ?? [];
    list.push(letter);
    bag.set(letter.caseId, list);
  }
  const drop = new Set<string>();
  const replace = new Map<string, Letter>();
  for (const bag of [open, sent]) {
    for (const list of bag.values()) {
      if (list.length < 2) continue;
      const ordered = [...list].sort((a, b) => a.id.localeCompare(b.id));
      replace.set(ordered[0].id, combineStoredLetters(ordered));
      for (const extra of ordered.slice(1)) drop.add(extra.id);
    }
  }
  if (replace.size === 0) return false;
  let highest = state.issued?.T ?? 0;
  for (const letter of state.letters) {
    const n = Number(letter.id.slice(1));
    if (letter.id.startsWith('T') && Number.isInteger(n) && n > highest) highest = n;
  }
  state.letters = state.letters.filter(letter => !drop.has(letter.id)).map(letter => replace.get(letter.id) ?? letter);
  state.issued = { C: state.issued?.C ?? 0, F: state.issued?.F ?? 0, T: highest, J: state.issued?.J ?? 0 };
  return true;
}
