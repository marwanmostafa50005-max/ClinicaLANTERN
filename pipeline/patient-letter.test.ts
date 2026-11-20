import { describe, expect, it } from 'vitest';
import type { Criterion, Finding, HistoryLine, Letter, LetterDraft } from '../shared/types.ts';
import { letterFindingIds, mergeLegacyPatientLetters, writingLine } from '../shared/patient-letter.ts';
import {
  assembleLetter, assemblePatientLetter, choosePrescriber, letterAsItLeaves, letterMessages, letterTextHash,
  MIXED_WRITING_LINE, MODEL_LINE, partFromLetterBody,
  type LetterParagraphs
} from './letter.ts';
import { linesById } from './history.ts';
import { testConfig, testCriterion, testLines, testPatient } from './testkit.ts';

const when = new Date(2026, 10, 18, 9, 30);

const finding: Finding = {
  id: 'F0001', caseId: 'C0001', criterionId: testCriterion.id, state: 'accepted', possible: false,
  screen: {
    lineIds: ['L002', 'L003'], medicines: ['celecoxib'], reason: 'Supplied.', linesVerified: true,
    missingFacts: [], model: 'lantern-screen', at: '2026-11-18T00:00:00.000Z', seconds: 1
  },
  check: {
    confirmed: true, lineIds: ['L002', 'L003'], whatMatches: 'Celebrex.', whatCannotBeSeen: 'Kidney function.',
    completed: true, model: 'lantern-check', at: '2026-11-18T00:00:10.000Z', seconds: 1
  },
  seenByPharmacist: true
};

function paragraphs(subject: string, request: string): LetterParagraphs {
  return {
    subject,
    finding_paragraph: `The finding for ${subject}.`,
    evidence_paragraph: `The supplies for ${subject} are listed below.`,
    request_paragraph: request
  };
}

function draftFor(
  criterion: Criterion, cited: HistoryLine[], subject: string, request: string, origin: 'model' | 'template' = 'model'
): LetterDraft {
  const body = assembleLetter({
    cfg: testConfig, patient: testPatient, criterion, cited, paragraphs: paragraphs(subject, request),
    origin, when, missingFacts: criterion.id === 'POSS' ? ['eGFR'] : undefined
  });
  return {
    subject, body, origin, checkNotes: [], model: 'lantern-letter', at: '2026-11-18T00:01:00.000Z', seconds: 1
  };
}

const alphaLines: HistoryLine[] = [
  { id: 'A1', text: '2026-08-01 | Alpha 10 mg tablet | qty 28 | Dr A. One' },
  { id: 'A2', text: '2026-09-01 | Alpha 10 mg tablet | qty 28 | Dr A. One' }
];
const betaLines: HistoryLine[] = [
  { id: 'B1', text: '2026-08-02 | Beta 5 mg tablet | qty 30 | Dr A. One' }
];
const gammaLines: HistoryLine[] = [
  { id: 'G1', text: '2026-08-03 | Gamma 1 mg tablet | qty 28 | Dr B. Two' }
];

const beta: Criterion = { ...testCriterion, id: 'BETA', label: 'Beta criterion', title: 'Beta', urgency: 'same_day', statement: 'Beta needs a review today.' };
const gamma: Criterion = { ...testCriterion, id: 'POSS', label: 'Gamma criterion', title: 'Gamma', statement: 'Gamma may apply when the eGFR is low.' };

describe('one letter for the patient', () => {
  const alpha = draftFor(testCriterion, alphaLines, 'Alpha review', 'Please review alpha.');
  const betaDraft = draftFor(beta, betaLines, 'Beta today', 'Please review beta today.', 'template');
  const gammaDraft = draftFor(gamma, gammaLines, 'Possible finding, gamma', 'Please confirm the eGFR and review gamma.');
  const parts = [alpha, betaDraft, gammaDraft].map(draft => partFromLetterBody(draft.body, draft.subject, draft.origin));

  it('three findings make one letter, and one finding still reads as it does today', () => {
    const alone = assemblePatientLetter({ cfg: testConfig, patient: testPatient, when, parts: [parts[0]] });
    expect(alone).toBe(alpha.body);

    const body = assemblePatientLetter({ cfg: testConfig, patient: testPatient, when, parts });
    expect(body.split('Dear Doctor,').length - 1).toBe(1);
    expect(body.split('Yours sincerely,').length - 1).toBe(1);
    expect(body.split('PHA0002761764').length - 1).toBe(1);
    expect(body.startsWith(testConfig.pharmacy.name)).toBe(true);
    expect(body.slice(1)).not.toContain(testConfig.pharmacy.name);
    expect(body).toContain('Re: 3 points for this patient');
    expect(body).toContain("I have reviewed this patient's dispensing history and I raise 3 points, numbered below.");
    expect(body).toContain('1. Alpha review');
    expect(body).toContain('2. Beta today');
    expect(body).toContain('3. Possible finding, gamma');
    expect(body).toContain('Please review alpha.');
    expect(body).toContain('Please review beta today.');
    expect(body).toContain('Please confirm the eGFR and review gamma.');
    expect(body).toContain(alphaLines[0].text);
    expect(body).toContain(betaLines[0].text);
    expect(body).toContain(gammaLines[0].text);
    expect(body.indexOf('1. Alpha review')).toBeLessThan(body.indexOf(alphaLines[0].text));
    expect(body.indexOf('2. Beta today')).toBeLessThan(body.indexOf(betaLines[0].text));
    expect(body.indexOf('3. Possible finding, gamma')).toBeLessThan(body.indexOf(gammaLines[0].text));
  });

  it('asks the model for the same bytes as a letter for that finding alone', () => {
    const cited = linesById(testLines, ['L002', 'L003']);
    const alone = JSON.stringify(letterMessages(testPatient, testCriterion, finding, cited, testLines));
    assemblePatientLetter({ cfg: testConfig, patient: testPatient, when, parts });
    const after = JSON.stringify(letterMessages(testPatient, testCriterion, finding, cited, testLines));
    expect(after).toBe(alone);
    expect(alone).not.toContain('numbered below');
    expect(alone).not.toContain('points for this patient');
    const second = { ...finding, id: 'F0002', criterionId: 'BETA' };
    const secondBytes = JSON.stringify(letterMessages(testPatient, beta, second, betaLines, betaLines));
    expect(secondBytes).toBe(JSON.stringify(letterMessages(testPatient, beta, second, betaLines, betaLines)));
    expect(secondBytes).not.toContain('Please review alpha.');
    expect(secondBytes).not.toContain('numbered below');
  });

  it('addresses the letter to the prescriber named most often, names a same-day point in the head, and keeps a possible finding inside its point', () => {
    const body = assemblePatientLetter({ cfg: testConfig, patient: testPatient, when, parts });
    const cited = [...alphaLines, ...betaLines, ...gammaLines];
    const doctor = choosePrescriber(cited, testConfig.doctor);
    expect(doctor.name).toBe('Dr A. One');
    expect(body).toContain('To: Dr A. One');
    expect(body).not.toContain(testConfig.doctor.practice);
    const dear = body.indexOf('Dear Doctor,');
    const head = body.slice(0, dear);
    expect(head).toContain('Urgency: same day. Please review today if you can.');
    expect(head).toContain('Point 2: Beta today');
    expect(head).not.toContain('The record we hold does not show');
    const point = body.slice(body.indexOf('3. Possible finding, gamma'));
    expect(point.startsWith('3. Possible finding, gamma')).toBe(true);
    expect(point).toContain('The record we hold does not show: eGFR.');
    expect(body.indexOf('The record we hold does not show: eGFR.')).toBeGreaterThan(dear);
    expect(body).toContain(MIXED_WRITING_LINE);
    expect(body).not.toContain(MODEL_LINE);
  });

  it('shows a point that is still being written, and does not repeat the ending', () => {
    const body = assemblePatientLetter({
      cfg: testConfig, patient: testPatient, when,
      parts: [parts[0], { pending: true, subject: '', findingParagraph: '', evidenceParagraph: '', requestParagraph: '' }]
    });
    expect(body).toContain('2. Being written');
    expect(body).toContain('This point is still being written.');
    expect(body).toContain('Please review alpha.');
    expect(body.split('Dear Doctor,').length - 1).toBe(1);
    expect(body.split('Yours sincerely,').length - 1).toBe(1);
  });

  it('loads an old state of several letters for one patient as one letter, and keeps each draft', () => {
    const letters: Letter[] = [alpha, betaDraft, gammaDraft].map((draft, index) => ({
      id: `T000${index + 1}`,
      findingId: `F000${index + 1}`,
      caseId: 'C0001',
      status: 'ready' as const,
      draft,
      subject: draft.subject,
      body: draft.body,
      editedByPharmacist: false,
      seenByPharmacist: true
    }));
    const state: { letters: Letter[]; issued: { C: number; F: number; T: number; J: number } } = {
      letters: [
        letters[0],
        { ...letters[1], caseId: 'C0009', id: 'T0009', findingId: 'F0009' },
        letters[2],
        letters[1]
      ],
      issued: { C: 1, F: 3, T: 3, J: 0 }
    };
    expect(mergeLegacyPatientLetters(state)).toBe(true);
    expect(state.letters.map(letter => letter.id)).toEqual(['T0001', 'T0009']);
    const joined = state.letters[0];
    expect(letterFindingIds(joined)).toEqual(['F0001', 'F0002', 'F0003']);
    expect(joined.points?.map(point => point.draft?.subject)).toEqual(['Alpha review', 'Beta today', 'Possible finding, gamma']);
    expect(joined.points?.map(point => point.draft?.at)).toEqual([alpha.at, betaDraft.at, gammaDraft.at]);
    expect(joined.body).toContain('Please review alpha.');
    expect(joined.body).toContain('Please review beta today.');
    expect(joined.body).toContain('Please confirm the eGFR and review gamma.');
    expect(joined.body.split('Dear Doctor,').length - 1).toBe(1);
    expect(joined.status).toBe('ready');
    expect(state.issued?.T).toBe(9);
    expect(mergeLegacyPatientLetters(state)).toBe(false);
  });

  it('lists each point after the greeting when there are more than three, and a letter of one to three points has no list', () => {
    const headingOf = (part: { pending?: boolean; subject: string }, index: number) =>
      part.pending ? `${index + 1}. Being written` : `${index + 1}. ${part.subject}`;
    const one = assemblePatientLetter({ cfg: testConfig, patient: testPatient, when, parts: [parts[0]] });
    const twoParts = parts.slice(0, 2);
    const two = assemblePatientLetter({ cfg: testConfig, patient: testPatient, when, parts: twoParts });
    const three = assemblePatientLetter({ cfg: testConfig, patient: testPatient, when, parts });
    expect(one).toBe(alpha.body);
    for (const [body, these] of [[two, twoParts], [three, parts]] as const) {
      for (const heading of these.map(headingOf)) {
        expect(body.split('\n').filter(line => line === heading)).toEqual([heading]);
      }
    }
    const raiseThree = "I have reviewed this patient's dispensing history and I raise 3 points, numbered below.";
    const afterThree = three.slice(three.indexOf(raiseThree) + raiseThree.length).replace(/^\n+/, '');
    const threeHeadings = parts.map(headingOf);
    expect(afterThree.startsWith(`${threeHeadings[0]}\n`)).toBe(true);
    expect(afterThree.split('\n')[1]).not.toBe(threeHeadings[1]);
    expect(letterTextHash(one)).toBe('d7df5d5e520a5f99d996f526886209cc834ea95260c84ab12990fbc280c37e9d');
    expect(letterTextHash(two)).toBe('e1eaef0dd0fadc1cc3967dc46e9f5d8d986e63466a0e0b67a89ba3e90d36c1e9');
    expect(letterTextHash(three)).toBe('3b60ebdee2cc543f5841711c19cdbd62c49ea614a0c5a256bb5088a146fd6137');

    const deltaLines: HistoryLine[] = [
      { id: 'D1', text: '2026-08-04 | Delta 20 mg tablet | qty 28 | Dr A. One' }
    ];
    const delta: Criterion = { ...testCriterion, id: 'DELTA', label: 'Delta criterion', title: 'Delta', statement: 'Delta needs a review.' };
    const deltaDraft = draftFor(delta, deltaLines, 'Delta review', 'Please review delta.');
    const fourParts = [...parts, partFromLetterBody(deltaDraft.body, deltaDraft.subject, deltaDraft.origin)];
    const four = assemblePatientLetter({ cfg: testConfig, patient: testPatient, when, parts: fourParts });
    const fourHeadings = fourParts.map(headingOf);
    expect(fourHeadings).toEqual(['1. Alpha review', '2. Beta today', '3. Possible finding, gamma', '4. Delta review']);
    const raiseFour = "I have reviewed this patient's dispensing history and I raise 4 points, numbered below.";
    const afterFour = four.slice(four.indexOf(raiseFour) + raiseFour.length).replace(/^\n+/, '');
    const list = fourHeadings.join('\n');
    expect(afterFour.startsWith(`${list}\n`)).toBe(true);
    for (const heading of fourHeadings) {
      expect(four.split('\n').filter(line => line === heading)).toEqual([heading, heading]);
    }
    const listAt = four.indexOf(list);
    expect(listAt).toBeGreaterThan(four.indexOf('Dear Doctor,'));
    expect(listAt).toBeGreaterThan(four.indexOf(raiseFour));
    const partAt = four.indexOf(`\n\n${fourHeadings[0]}\n`, listAt + list.length);
    expect(partAt).toBeGreaterThan(listAt);
    const closing = {
      closingLine: writingLine(fourParts.map(part => part.origin)),
      signatureName: testConfig.pharmacy.pharmacist,
      signatureTitle: testConfig.pharmacy.pharmacistTitle,
      signatureRegistration: testConfig.pharmacy.registration
    };
    const left = letterAsItLeaves(four, closing);
    const withoutList = letterAsItLeaves(four.replace(`${list}\n\n`, ''), closing);
    expect(left).toContain(list);
    expect(letterTextHash(left)).toHaveLength(64);
    expect(letterTextHash(left)).not.toBe(letterTextHash(withoutList));
  });
});
