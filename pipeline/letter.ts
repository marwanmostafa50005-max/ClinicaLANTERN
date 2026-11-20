// Job 3: the third model writes the letter to the GP for one accepted finding (docs/SPEC.md section 7.3).
// The model returns four short texts. Code builds the letter around them and checks every date,
// number with a unit and medicine name in them against the finding. On a mismatch the letter is
// drafted once more with the mismatch named. If that fails too, the letter is built from the
// template alone. The letter does not say so: it ends with the signature. The notes say so. draftLetter never throws.
//
// A possible finding (docs/SPEC.md section 6a): the medicines match and the record does not show a
// fact the criterion needs. Its letter says so in the frame ("The record we hold does not show:
// ..."), and its request paragraph asks the doctor to confirm that fact and to review if it
// applies. A letter for any other finding is built exactly as before.
import { createHash } from 'node:crypto';
import type { Criterion, EmailDraft, Finding, HistoryLine, LanternConfig, LetterDraft, PatientHeader } from '../shared/types.ts';
import { isFactLine, isPossible, listFacts, missingFactsOf, tidyFacts } from '../shared/facts.ts';
import { findingLines } from '../shared/lines.ts';
import { chat, type ChatMessage, type JsonSchema } from './ollama.ts';
import { criterionAllowedText } from './criteria.ts';
import { supplyCountNote } from './count-supplies.ts';
import { longDate, longDateOf } from './dates.ts';
import { checkLetterFacts, checkLetterTone, hasWord, isWordingNote } from './facts.ts';
import { linesById, omitBirthDate, patientText } from './history.ts';
import type { JobDeps } from './screen.ts';
import {
  letterFindingIds, mergeLegacyPatientLetters, MIXED_WRITING_LINE, partFromLetterBody,
  prescriberMostNamed, renderPatientLetter, writingLine, type PatientLetterPart
} from '../shared/patient-letter.ts';

export {
  letterFindingIds, mergeLegacyPatientLetters, MIXED_WRITING_LINE, partFromLetterBody, renderPatientLetter, writingLine,
  type PatientLetterPart
};

export const LETTER_NUM_PREDICT = 1200;
const MAX_EVIDENCE_LINES = 12;

export const FICTIONAL_LINE = 'Fictional patient. No real person.';
export const MODEL_LINE = 'Drafted by a local AI model. Read by the pharmacist before sending.';
// The three lines a template letter used to end with. None of them is written now.
// The pharmacist still sees, outside the letter, that it came from the template.
export const TEMPLATE_LINE =
  'Built from the standard letter template. The AI draft did not pass its checks. Reviewed and edited by the pharmacist.';
export const TEMPLATE_LINE_NO_ANSWER =
  'Built from the standard letter template. The AI model did not answer. Reviewed and edited by the pharmacist.';
export const TEMPLATE_LINE_ERROR =
  'Built from the standard letter template. The AI draft could not be made. Reviewed and edited by the pharmacist.';
const TEMPLATE_NOTE = 'This letter was built from the standard template.';

export type TemplateReason = NonNullable<LetterDraft['templateReason']>;

/**
 * The line above the signature. A model letter names the local model.
 * A template letter has no line there: it ends with the signature.
 */
export function closingLine(origin: 'model' | 'template', _why?: TemplateReason): string {
  return origin === 'model' ? MODEL_LINE : '';
}

/** The last lines, kept apart from the text the pharmacist edits. */
export interface LetterClosing {
  closingLine: string;
  signatureName: string;
  signatureTitle: string;
  signatureRegistration: string;
}

export function letterClosing(cfg: LanternConfig, origin: 'model' | 'template', why?: TemplateReason): LetterClosing {
  return {
    closingLine: closingLine(origin, why),
    signatureName: cfg.pharmacy.pharmacist,
    signatureTitle: cfg.pharmacy.pharmacistTitle,
    signatureRegistration: cfg.pharmacy.registration
  };
}

export function signatureBlock(closing: LetterClosing): string {
  const lines = [closing.signatureName, closing.signatureTitle, closing.signatureRegistration];
  if (closing.closingLine) lines.unshift(closing.closingLine);
  return lines.join('\n');
}

/**
 * The letter as it leaves. The fictional-patient line, the line about AI and the three signature
 * lines are put back, so an edit cannot delete them. Text the pharmacist added after the signature
 * is kept, above them.
 */
export function letterAsItLeaves(body: string, closing: LetterClosing): string {
  let text = body.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
  const block = signatureBlock(closing);
  const at = text.lastIndexOf(block);
  if (at >= 0) {
    const before = text.slice(0, at).replace(/\s+$/, '');
    const after = text.slice(at + block.length).replace(/^\s+/, '');
    const head = before.endsWith('Yours sincerely,')
      ? before.slice(0, before.lastIndexOf('Yours sincerely,')).replace(/\s+$/, '')
      : before;
    text = after ? `${head}\n\n${after}` : head;
  }
  let base = text.replace(/\s+$/, '');
  if (!base.includes(FICTIONAL_LINE)) base = `${base}\n\n${FICTIONAL_LINE}`;
  return `${base}\n\nYours sincerely,\n\n${block}`;
}

/** sha256 of the letter exactly as it will leave. */
export function letterTextHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export const EMAIL_COVER_NOTE =
  'The letter is longer than an email draft can hold. Please copy it from the preview, or print it.';

/** The draft that opens in the pharmacist's own mail program. It carries no address. */
export function emailDraftFor(subject: string, leavingText: string, limit: number): EmailDraft {
  const fits = leavingText.length <= limit;
  return { subject, text: fits ? leavingText : EMAIL_COVER_NOTE, fits, coverNote: !fits };
}

const PRESCRIBER = /^(dr|doctor)\b/i;

/** The prescriber named in one line, when a segment starts with Dr or Doctor. */
export function prescriberInLine(text: string): string | null {
  const parts = text.split(' | ').map(part => part.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (PRESCRIBER.test(parts[i])) return parts[i];
  }
  return null;
}

/**
 * Who the letter is addressed to. The prescriber named most often in the cited lines wins.
 * A tie goes to the later cited line. When no cited line names a prescriber, the settings
 * placeholder is used, and its practice is kept. A prescriber taken from a line has no practice:
 * the settings practice belongs to the placeholder, not to that doctor.
 */
export function choosePrescriber(cited: HistoryLine[], doctor: { name: string; practice: string }): { name: string; practice: string } {
  return prescriberMostNamed(cited, doctor);
}

export const LETTER_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    finding_paragraph: { type: 'string' },
    evidence_paragraph: { type: 'string' },
    request_paragraph: { type: 'string' }
  },
  required: ['subject', 'finding_paragraph', 'evidence_paragraph', 'request_paragraph']
};

export const LETTER_SYSTEM =
  'You draft the body of a short, courteous letter from a community pharmacist to a patient\'s general practitioner. ' +
  'The pharmacist will edit and sign it. Use only the facts given. ' +
  'Do not invent a diagnosis, a dose change, a date, a name or a medicine. ' +
  'Copy every date, strength and quantity exactly as it is written in the facts. ' +
  'Keep each quantity and each number of repeats with the supply date on the same line. ' +
  'Do not put a quantity or a repeat count from one line onto a different date. ' +
  'Do not work out new numbers such as totals or lengths of time. ' +
  'Do not tell the doctor what to do; ask for a review. Plain Australian English. Reply with JSON only.';

const LETTER_TASK =
  'Write: subject (one line), finding_paragraph (2 to 3 sentences), ' +
  'evidence_paragraph (2 to 3 sentences naming the supplies and dates), ' +
  'request_paragraph (2 sentences asking for review and offering to help).';

/** The words used when a possible finding names no fact at all. */
const SOME_FACT = 'a fact that the criterion needs';
export const NO_CONFIRM_REQUEST = 'The request paragraph does not ask the doctor to confirm the fact that the record does not show.';

/**
 * What the model is asked to write. A finding with no fact line and no missing fact gets the task
 * it always had. A fact line among the evidence is named in the evidence paragraph. For a possible
 * finding the request paragraph asks the doctor to confirm the fact and to review if it applies.
 */
function letterTask(possible: boolean, withFactLines: boolean, noSupplyLines = false): string {
  if (!possible && !withFactLines) return LETTER_TASK;
  // Evidence that holds facts and no supply: the finding is about a medicine that is not supplied.
  const evidence = noSupplyLines
    ? 'evidence_paragraph (2 to 3 sentences naming the recorded facts and their dates, and saying that our dispensing records show no recent supply of the medicine the criterion is about)'
    : withFactLines
      ? 'evidence_paragraph (2 to 3 sentences naming the supplies, the recorded facts and their dates)'
      : 'evidence_paragraph (2 to 3 sentences naming the supplies and dates)';
  const notSupplied = noSupplyLines
    ? 'The evidence lines hold no supply, because this finding is about a medicine that is not supplied. Name that kind of medicine as the criterion names it.\n'
    : '';
  if (!possible) {
    return `${notSupplied}Write: subject (one line), finding_paragraph (2 to 3 sentences), ${evidence}, ` +
      'request_paragraph (2 sentences asking for review and offering to help).';
  }
  return 'This is a possible finding. The record we hold does not show the fact named in record_does_not_show. ' +
    'Do not write that the patient has it, and do not write that the patient does not have it.\n' +
    notSupplied +
    'Write: subject (one line, starting with the words "Possible finding"), ' +
    'finding_paragraph (2 to 3 sentences: what the medicines show, and that the record we hold does not show the fact), ' +
    `${evidence}, ` +
    'request_paragraph (2 sentences: ask the doctor to confirm the fact, and to review the medicines if it applies; offer to help).';
}

/** Which task a letter gets, from its finding and the cited lines the model is shown. */
function taskForLetter(possible: boolean, shown: HistoryLine[]): string {
  const withFactLines = shown.some(l => isFactLine(l.text));
  return letterTask(possible, withFactLines, shown.length > 0 && shown.every(l => isFactLine(l.text)));
}

export interface LetterParagraphs {
  subject: string;
  finding_paragraph: string;
  evidence_paragraph: string;
  request_paragraph: string;
}

/**
 * The lines a letter cites. It is the same rule as the bell panel and the scorer use
 * (shared/lines.ts): the lines the second check named and the lines the first model named.
 */
export function citedLineIds(finding: Pick<Finding, 'screen' | 'check'>): string[] {
  return findingLines(finding).all;
}

/** The criterion's medicines that are named in the cited lines, as "celecoxib (Celebrex)". Letter path only. */
export function medicinesInLines(criterion: Criterion, cited: HistoryLine[]): string[] {
  const text = cited.map(l => l.text).join('\n').toLowerCase();
  const out: string[] = [];
  for (const group of criterion.medicine_groups) {
    const ingredients = [...new Set([...group.ingredients, ...Object.keys(group.brands)])];
    for (const ingredient of ingredients) {
      if (!ingredient.trim()) continue;
      const brands = (group.brands[ingredient] ?? []).filter(b => b.trim() && hasWord(text, b.trim().toLowerCase()));
      if (brands.length > 0) out.push(`${ingredient} (${brands.join(', ')})`);
      else if (hasWord(text, ingredient.trim().toLowerCase())) out.push(ingredient);
    }
  }
  return out;
}

/** Brand and ingredient names written in the history lines, lower case. Used only to check letters. */
export function medicineNamesInHistory(lines: HistoryLine[]): string[] {
  const names = new Set<string>();
  const add = (raw: string | undefined): void => {
    const name = (raw ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (name.replace(/[^a-z]/g, '').length < 4) return;
    names.add(name);
    const firstWord = name.split(' ')[0];
    if (firstWord !== name && firstWord.replace(/[^a-z]/g, '').length >= 5) names.add(firstWord);
  };
  for (const line of lines) {
    // A condition, a result or an observation is not a supply: it names no medicine.
    if (isFactLine(line.text)) continue;
    const parts = line.text.split(' | ');
    if (parts.length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(parts[0].trim())) continue;
    const m = /^([^(\d]*)(?:\(([^)]*)\))?/.exec(parts[1]);
    if (!m) continue;
    add(m[1]);
    add(m[2]);
  }
  return [...names];
}

/** Everything a drafted paragraph may quote facts from: the patient label, the cited lines and the criterion. */
export function letterAllowedText(patient: PatientHeader, criterion: Criterion, cited: HistoryLine[]): string {
  return [patientText(patient), cited.map(l => omitBirthDate(l.text, patient.dateOfBirth)).join('\n'), criterionAllowedText(criterion)].join('\n');
}

function evidenceForModel(line: HistoryLine, dateOfBirth?: string): string {
  return omitBirthDate(line.text, dateOfBirth).replace(/^(\d{4}-\d{2}-\d{2})(?=\s|$)/, iso => longDate(iso));
}

/**
 * The facts a letter says the record does not show. Empty unless the finding is a possible finding.
 * They are the facts the first model named, as the bell shows them. A name that carries a date, an
 * amount or a medicine name that is not in the cited lines or the criterion is not printed: the
 * criterion's own list of facts is used in its place, so the frame of a letter never states a
 * fact that code has not checked.
 */
export function letterMissingFacts(patient: PatientHeader, criterion: Criterion, finding: Finding, cited: HistoryLine[]): string[] {
  if (!isPossible(finding)) return [];
  const allowed = letterAllowedText(patient, criterion, cited);
  const named = missingFactsOf(finding).filter(fact => checkLetterFacts([fact], allowed).length === 0);
  if (named.length > 0) return named;
  const listed = tidyFacts((criterion.needs_facts ?? []).map(f => f.what));
  return listed.length > 0 ? listed : [SOME_FACT];
}

/**
 * The cited lines the model is given: the last twelve, as before. When the list is longer and holds
 * fact lines, the fact lines are kept first and the latest supplies fill the rest, so a condition
 * or a result that proves the finding is never among the lines left out.
 */
function evidenceShown(cited: HistoryLine[]): HistoryLine[] {
  if (cited.length <= MAX_EVIDENCE_LINES) return cited;
  const factLines = cited.filter(l => isFactLine(l.text)).slice(-MAX_EVIDENCE_LINES);
  if (factLines.length === 0) return cited.slice(-MAX_EVIDENCE_LINES);
  const room = MAX_EVIDENCE_LINES - factLines.length;
  const supplies = room > 0 ? cited.filter(l => !isFactLine(l.text)).slice(-room) : [];
  const keep = new Set([...factLines, ...supplies].map(l => l.id));
  return cited.filter(l => keep.has(l.id));
}

export function letterMessages(
  patient: PatientHeader, criterion: Criterion, finding: Finding, cited: HistoryLine[], history: HistoryLine[] = cited
): ChatMessage[] {
  const shown = evidenceShown(cited);
  const missing = letterMissingFacts(patient, criterion, finding, cited);
  let medicines = medicinesInLines(criterion, cited);
  if (medicines.length === 0) {
    const allowed = letterAllowedText(patient, criterion, cited).toLowerCase();
    medicines = finding.screen.medicines.filter(name => name.trim() && hasWord(allowed, name.trim().toLowerCase()));
  }
  const facts: Record<string, unknown> = {
    patient: patientText(patient),
    criterion_label: criterion.label,
    criterion_text: criterion.statement,
    medicines,
    evidence_lines: shown.map(line => evidenceForModel(line, patient.dateOfBirth))
  };
  if (missing.length > 0) {
    facts.possible_finding = 'Yes. The medicines match the criterion, and the record we hold does not show the fact below.';
    facts.record_does_not_show = missing;
  }
  facts.cannot_be_seen = criterion.cannot_be_seen || finding.check?.whatCannotBeSeen || '';
  facts.review_to_ask_for = criterion.ask_the_gp;
  facts.urgency = criterion.urgency === 'same_day' ? 'same day' : 'routine';
  const withFactLines = shown.some(l => isFactLine(l.text));
  if (cited.length > shown.length) {
    facts.note = withFactLines
      ? `There are ${cited.length - shown.length} more supply lines. The full list is printed under the letter.`
      : `There are ${cited.length - shown.length} earlier lines. The full list is printed under the letter.`;
  }
  const body = `FINDING ACCEPTED BY THE PHARMACIST\n${JSON.stringify(facts, null, 1)}\n\n${taskForLetter(missing.length > 0, shown)}`;
  // The count uses the whole history when the caller passes it. An empty note leaves the prompt as it was.
  const counted = supplyCountNote(criterion, history);
  return [
    { role: 'system', content: LETTER_SYSTEM },
    { role: 'user', content: counted ? `${counted}\n\n${body}` : body }
  ];
}

function oneLine(text: unknown): string {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}

function tidy(p: LetterParagraphs): LetterParagraphs {
  return {
    subject: oneLine(p.subject).replace(/^(?:re|subject)\s*:\s*/i, '').slice(0, 200),
    finding_paragraph: oneLine(p.finding_paragraph),
    evidence_paragraph: oneLine(p.evidence_paragraph),
    request_paragraph: oneLine(p.request_paragraph)
  };
}

/**
 * All the checks on a draft: nothing left empty, the facts, and the wording.
 * For a possible finding the request paragraph must also ask the doctor to confirm the fact.
 * When the cited lines are facts only, the letter must say the medicine is not supplied.
 */
export const NO_SUPPLY_NOTE =
  'The letter does not say that our dispensing records show no recent supply of the medicine the criterion is about.';

export function checkDraft(
  p: LetterParagraphs, allowedText: string, moreMedicineNames: string[] = [], possible = false, noSupply = false
): string[] {
  const problems: string[] = [];
  if (!p.subject) problems.push('The draft has no subject line.');
  if (!p.finding_paragraph) problems.push('The draft has no paragraph about the finding.');
  if (!p.evidence_paragraph) problems.push('The draft has no paragraph about the supplies.');
  if (!p.request_paragraph) problems.push('The draft has no paragraph asking for a review.');
  if (possible && p.request_paragraph && !/\bconfirm/i.test(p.request_paragraph)) problems.push(NO_CONFIRM_REQUEST);
  if (noSupply) {
    const said = [p.subject, p.finding_paragraph, p.evidence_paragraph, p.request_paragraph].join(' ');
    if (!/no recent supply|not supplied|no supply of/i.test(said)) problems.push(NO_SUPPLY_NOTE);
  }
  const texts = [p.subject, p.finding_paragraph, p.evidence_paragraph, p.request_paragraph];
  return [...problems, ...checkLetterFacts(texts, allowedText, moreMedicineNames), ...checkLetterTone(texts)];
}

function sentence(text: string): string {
  const t = text.trim();
  if (!t) return '';
  return /[.!?]$/.test(t) ? t : t + '.';
}

/**
 * A letter built from the template, used when both drafts fail, the model does not answer,
 * or the letter step stops and the criterion is known. The body is the whole letter.
 * The notes say why. The letter itself does not.
 */
export function templateLetter(
  cfg: LanternConfig, patient: PatientHeader, lines: HistoryLine[], criterion: Criterion, finding: Finding,
  why: TemplateReason, notes: string[], when: Date = new Date()
): LetterDraft {
  const cited = linesById(lines, citedLineIds(finding));
  let missing: string[] = [];
  try {
    missing = letterMissingFacts(patient, criterion, finding, cited);
  } catch {
    missing = isPossible(finding) ? [SOME_FACT] : [];
  }
  const paragraphs = templateParagraphs(criterion, cited, missing);
  const draft: LetterDraft = {
    subject: paragraphs.subject,
    body: assembleLetter({
      cfg, patient, criterion, cited, paragraphs, origin: 'template', templateReason: why, when,
      cannotBeSeen: finding.check?.whatCannotBeSeen, missingFacts: missing
    }),
    origin: 'template',
    templateReason: why,
    checkNotes: notes.includes(TEMPLATE_NOTE) ? notes : [...notes, TEMPLATE_NOTE],
    model: cfg.models.letter,
    at: when.toISOString(),
    seconds: 0
  };
  return draft;
}

/**
 * The paragraphs used when the model's draft failed its checks twice, or the model did not answer.
 * missing: the facts the record does not show, for a possible finding. Then the paragraphs say so
 * and ask the doctor to confirm the fact and to review if it applies.
 */
export function templateParagraphs(criterion: Criterion, cited: HistoryLine[], missing: string[] = []): LetterParagraphs {
  const sameDay = criterion.urgency === 'same_day';
  const ask = criterion.ask_the_gp.trim() ? ` What I am asking you to review: ${sentence(criterion.ask_the_gp)}` : '';
  const summary = criterion.plain_summary.trim() ? ' ' + sentence(criterion.plain_summary) : '';
  const withFactLines = cited.some(l => isFactLine(l.text));
  const noSupply = cited.length > 0 && cited.every(l => isFactLine(l.text));
  const notSupplied = noSupply ? ' Our dispensing records show no recent supply of the medicine the criterion is about.' : '';
  const evidence = (cited.length > 0
    ? (withFactLines ? 'The lines from our records that match are listed below with their dates.' : 'The dispensing lines that match are listed below with their dates.')
    : 'The exact dispensing lines could not be listed. I can send the full history if that helps.') + notSupplied;
  if (missing.length > 0) {
    const facts = listFacts(missing);
    return {
      subject: `Possible finding, request for a medicines review: ${criterion.title}`,
      finding_paragraph:
        'I am writing about a possible medicines issue for this patient. ' +
        'Our records match the medicines part of the criterion set out below. ' +
        `The record we hold does not show: ${facts}.` + summary,
      evidence_paragraph: evidence,
      request_paragraph:
        `Could you please confirm whether this applies to the patient: ${facts}? ` +
        (sameDay ? 'If it does, could you please review this today if possible?' : 'If it does, could you please review this when you next see the patient?') +
        ask + ' I am happy to help with any information from our dispensing records.'
    };
  }
  return {
    subject: `Request for a medicines review: ${criterion.title}`,
    finding_paragraph:
      'I am writing about a possible medicines issue for this patient. ' +
      'Our dispensing records match the criterion set out below.' + summary,
    evidence_paragraph: evidence,
    request_paragraph:
      (sameDay ? 'Could you please review this today if possible?' : 'Could you please review this when you next see the patient?') +
      ask + ' I am happy to help with any information from our dispensing records.'
  };
}

export interface LetterParts {
  cfg: LanternConfig;
  patient: PatientHeader;
  criterion: Criterion;
  cited: HistoryLine[];
  paragraphs: LetterParagraphs;
  origin: 'model' | 'template';
  templateReason?: TemplateReason;
  when: Date;
  cannotBeSeen?: string;
  missingFacts?: string[];            // a possible finding: the facts the record does not show
}

/** The line a letter for a possible finding carries in its frame: "The record we hold does not show: eGFR." */
export function recordDoesNotShowLine(missing: string[]): string {
  return `The record we hold does not show: ${listFacts(tidyFacts(missing))}.`;
}

/** Builds the whole letter around the three paragraphs. */
export function assembleLetter(parts: LetterParts): string {
  const { cfg, patient, criterion, cited, paragraphs, origin, when } = parts;
  const cannotBeSeen = (criterion.cannot_be_seen || parts.cannotBeSeen || '').trim();
  const missing = tidyFacts(parts.missingFacts ?? []);
  const addressee = choosePrescriber(cited, cfg.doctor);
  const out: string[] = [
    cfg.pharmacy.name,
    cfg.pharmacy.address,
    `Phone: ${cfg.pharmacy.phone}`,
    `Pharmacist: ${cfg.pharmacy.pharmacist}`,
    '',
    longDateOf(when),
    '',
    `To: ${addressee.name}`,
    ...(addressee.practice ? [addressee.practice] : []),
    '',
    `Patient: ${patientText(patient)}`,
    FICTIONAL_LINE,
    '',
    `Re: ${paragraphs.subject}`
  ];
  if (criterion.urgency === 'same_day') out.push('Urgency: same day. Please review today if you can.');
  // A possible finding says so before the letter starts, so that it is never read as a settled one.
  if (missing.length > 0) out.push(recordDoesNotShowLine(missing));
  out.push(
    '',
    'Dear Doctor,',
    '',
    paragraphs.finding_paragraph,
    '',
    paragraphs.evidence_paragraph,
    '',
    paragraphs.request_paragraph,
    '',
    'The criterion this is based on',
    `${criterion.label}: ${criterion.statement}`
  );
  if (criterion.source.credit.trim()) out.push(`Source: ${criterion.source.credit.trim()}`);
  if (criterion.source.modification_notice?.trim()) out.push(criterion.source.modification_notice.trim());
  // A condition or a result among the cited lines is not a dispensing line, so the heading says "lines".
  out.push('', cited.some(l => isFactLine(l.text)) ? 'Lines from our records' : 'Dispensing lines from our records');
  if (cited.length > 0) out.push(...cited.map(l => omitBirthDate(l.text, patient.dateOfBirth)));
  else out.push('No single line was identified. Please see the full dispensing history.');
  if (cannotBeSeen) out.push('', 'What a dispensing history cannot show', cannotBeSeen);
  const end = ['', 'Yours sincerely,', ''];
  const line = closingLine(origin, parts.templateReason);
  if (line) end.push(line);
  end.push(cfg.pharmacy.pharmacist, cfg.pharmacy.pharmacistTitle, cfg.pharmacy.registration);
  out.push(...end);
  return out.join('\n');
}

/**
 * One letter for the patient, built from the drafts that already exist. One finding is returned
 * as today's letter. Several findings share one head, one greeting and one ending.
 * This does not call a model. assembleLetter still builds the single part.
 */
export function assemblePatientLetter(input: {
  cfg: LanternConfig;
  patient: PatientHeader;
  when: Date;
  parts: PatientLetterPart[];
}): string {
  if (input.parts.length === 1 && !input.parts[0].pending && input.parts[0].singleLetter) {
    return input.parts[0].singleLetter;
  }
  const cited = input.parts.flatMap(part => part.cited ?? []);
  const addressee = choosePrescriber(cited, input.cfg.doctor);
  const text = renderPatientLetter({
    pharmacyName: input.cfg.pharmacy.name,
    pharmacyAddress: input.cfg.pharmacy.address,
    phone: input.cfg.pharmacy.phone,
    pharmacist: input.cfg.pharmacy.pharmacist,
    dateText: longDateOf(input.when),
    addresseeName: addressee.name,
    addresseePractice: addressee.practice,
    patientLine: patientText(input.patient)
  }, input.parts, {
    closingLine: writingLine(input.parts.map(part => part.origin)),
    signatureName: input.cfg.pharmacy.pharmacist,
    signatureTitle: input.cfg.pharmacy.pharmacistTitle,
    signatureRegistration: input.cfg.pharmacy.registration
  });
  return text;
}

/**
 * Said in the request for a second draft, and only when the first draft failed the check on wording.
 * Measured on 18 November with the real model: told which word was found, it wrote another word of
 * the same kind ("should", then "is to be"), or kept the word in a request that ended with a full
 * stop. The word often came from the criterion's own text. So the second request names every such
 * word and says that a question ends with a question mark. The check itself is not changed.
 * A first draft that failed on a date, an amount or a name gets the request it always got.
 */
export const WORDING_HINT =
  'About the wording: in a sentence that is not a question, do not write must, should, ought to, need to, needs to, ' +
  'is to be, are to be, requires, recommend, advise or suggest. Leave these words out, also where the facts above use them. ' +
  'A sentence that asks the doctor something ends with a question mark.';

function redraftRequest(problems: string[], task = LETTER_TASK): string {
  const wording = problems.some(isWordingNote) ? WORDING_HINT + '\n' : '';
  return 'Some things in that draft are not in the facts of the finding:\n' +
    problems.map(p => `- ${p}`).join('\n') +
    '\nWrite the letter again. Use only dates, amounts and medicine names that are in the facts. ' +
    'Copy them exactly. Ask for a review. Do not tell the doctor what to do.\n' + wording + task;
}

/**
 * Drafts the letter for one accepted finding. Never throws.
 * origin is "model" when a draft passed the checks (the first, or the second after one redraft).
 * origin is "template" when both drafts failed or the model did not answer; checkNotes says why.
 */
export async function draftLetter(
  cfg: LanternConfig, patient: PatientHeader, lines: HistoryLine[], criterion: Criterion, finding: Finding,
  deps: JobDeps = {}
): Promise<LetterDraft> {
  const call = deps.chat ?? chat;
  const started = performance.now();
  const when = deps.now?.() ?? new Date();
  const model = cfg.models.letter;
  const cited = linesById(lines, citedLineIds(finding));
  // Worked out once, before anything else can fail: the template needs it too.
  let missing: string[] = [];
  try {
    missing = letterMissingFacts(patient, criterion, finding, cited);
  } catch {
    missing = isPossible(finding) ? [SOME_FACT] : [];
  }
  const possible = missing.length > 0;
  const finish = (
    paragraphs: LetterParagraphs, origin: 'model' | 'template', checkNotes: string[], templateReason?: TemplateReason
  ): LetterDraft => {
    const draft: LetterDraft = {
      subject: paragraphs.subject,
      body: assembleLetter({
        cfg, patient, criterion, cited, paragraphs, origin, templateReason, when, cannotBeSeen: finding.check?.whatCannotBeSeen,
        missingFacts: missing
      }),
      origin,
      checkNotes,
      model,
      at: when.toISOString(),
      seconds: Math.round((performance.now() - started) / 10) / 100
    };
    if (origin === 'template' && templateReason) draft.templateReason = templateReason;
    return draft;
  };
  // why says plainly what happened, so the letter, the log, the page and the scorer never have to guess it from a note.
  const fallBack = (why: TemplateReason, notes: string[]): LetterDraft => {
    const draft = templateLetter(cfg, patient, lines, criterion, finding, why, notes, when);
    draft.seconds = Math.round((performance.now() - started) / 10) / 100;
    return draft;
  };

  try {
    const allowed = letterAllowedText(patient, criterion, cited);
    const names = medicineNamesInHistory(lines);
    const messages = letterMessages(patient, criterion, finding, cited, lines);
    const request = { model, think: cfg.think.letter, schema: LETTER_SCHEMA, numPredict: LETTER_NUM_PREDICT, signal: deps.signal };

    const first = await call<LetterParagraphs>(cfg, { ...request, messages });
    if (!first.ok) return fallBack('no_answer', [`The letter model did not answer. ${first.error}`]);
    const draftOne = tidy(first.value);
    const noSupply = cited.length > 0 && cited.every(l => isFactLine(l.text));
    const problemsOne = checkDraft(draftOne, allowed, names, possible, noSupply);
    if (problemsOne.length === 0) return finish(draftOne, 'model', []);
    const notesOne = problemsOne.map(p => `First draft: ${p}`);

    const second = await call<LetterParagraphs>(cfg, {
      ...request,
      messages: [
        ...messages,
        { role: 'assistant', content: JSON.stringify(first.value) },
        { role: 'user', content: redraftRequest(problemsOne, taskForLetter(possible, evidenceShown(cited))) }
      ]
    });
    if (!second.ok) return fallBack('checks_failed', [...notesOne, `The second draft could not be written. ${second.error}`]);
    const draftTwo = tidy(second.value);
    const problemsTwo = checkDraft(draftTwo, allowed, names, possible, noSupply);
    if (problemsTwo.length === 0) {
      return finish(draftTwo, 'model', [...notesOne, 'The letter was drafted again. The second draft passed the checks.']);
    }
    return fallBack('checks_failed', [...notesOne, ...problemsTwo.map(p => `Second draft: ${p}`), 'Both drafts failed the checks.']);
  } catch (e) {
    try {
      return fallBack('error', [`The letter step failed: ${e instanceof Error ? e.message : String(e)}`]);
    } catch {
      return {
        subject: `Request for a medicines review: ${criterion?.label ?? ''}`.trim(),
        body: `${FICTIONAL_LINE}\n\nThe letter could not be built. Please write it by hand.`,
        origin: 'template',
        templateReason: 'error',
        checkNotes: ['The letter could not be built.'],
        model,
        at: when.toISOString(),
        seconds: Math.round((performance.now() - started) / 10) / 100
      };
    }
  }
}
