// docs/SPEC.md section 6a: the letter for a finding of a criterion that needs facts, and for a possible finding.
// No model is called: the tests pass a stand-in.
import { describe, expect, it } from 'vitest';
import type { Finding, HistoryLine } from '../shared/types.ts';
import {
  assembleLetter, checkDraft, citedLineIds, draftLetter, letterAllowedText, letterMessages, letterMissingFacts, medicineNamesInHistory,
  MODEL_LINE, NO_CONFIRM_REQUEST, NO_SUPPLY_NOTE, recordDoesNotShowLine, TEMPLATE_LINE, templateParagraphs, type LetterParagraphs
} from './letter.ts';
import { linesById } from './history.ts';
import { lineId } from './csv.ts';
import { factsCriterion, factsLines, fakeChat, noFactLines, testConfig, testCriterion, testLines, testPatient, userText } from './testkit.ts';

const EGFR = 'eGFR (estimated kidney function), the most recent result';
const when = new Date(2026, 10, 18, 9, 30);         // 18 November 2026, local time

function finding(lineIds: string[], missingFacts: string[], checkLines = lineIds): Finding {
  return {
    id: 'F0001', caseId: 'C0001', criterionId: factsCriterion.id, state: 'accepted',
    possible: missingFacts.length > 0,
    screen: { lineIds, medicines: ['digoxin'], reason: 'Digoxin long term.', linesVerified: true, missingFacts, model: 'lantern-screen', at: '2026-11-18T00:00:00.000Z', seconds: 5 },
    check: {
      confirmed: true, lineIds: checkLines, whatMatches: 'Lanoxin is supplied.', whatCannotBeSeen: 'A digoxin level.',
      completed: true, model: 'lantern-check', at: '2026-11-18T00:00:10.000Z', seconds: 9
    },
    decision: { action: 'accept', by: 'The pharmacist on duty', at: '2026-11-18T00:01:00.000Z' },
    seenByPharmacist: true
  };
}

// The record holds the fact: digoxin on L002, L003 and L005, the eGFR on L004.
const withFact = finding(['L002', 'L003', 'L004', 'L005'], []);
// The record holds no line about the eGFR: digoxin on L002, L003 and L004.
const possible = finding(['L002', 'L003', 'L004'], [EGFR]);

const goodWithFact: LetterParagraphs = {
  subject: 'Review request: digoxin and kidney function, Fictional patient F-001',
  finding_paragraph: 'I am writing about a possible medicines issue for this 72-year-old patient. Digoxin has been supplied long term and the most recent eGFR on our record is below 30 mL/min/1.73 m2.',
  evidence_paragraph: 'Lanoxin 250 microgram was supplied on 8 December 2025, 10 March 2026 and 16 June 2026. An eGFR of 24 mL/min/1.73 m2 was recorded on 12 May 2026.',
  request_paragraph: 'Could you please review the digoxin dose against the current eGFR? I am happy to help with any information from our records.'
};

const goodPossible: LetterParagraphs = {
  subject: 'Possible finding: digoxin and kidney function, Fictional patient F-001',
  finding_paragraph: 'I am writing about a possible medicines issue for this patient. Digoxin has been supplied long term. The record we hold does not show an eGFR result.',
  evidence_paragraph: 'Lanoxin 250 microgram was supplied on 8 December 2025, 10 March 2026 and 16 June 2026.',
  request_paragraph: 'Could you please confirm the most recent eGFR, and review the digoxin dose if it is below 30 mL/min/1.73 m2? I am happy to help with any information from our records.'
};

const deps = (answers: unknown[]) => {
  const fake = fakeChat(answers);
  return { fake, deps: { chat: fake.chat, now: () => when } };
};

describe('the facts a letter says the record does not show', () => {
  it('are none for a finding that is not a possible finding', () => {
    const cited = linesById(factsLines, citedLineIds(withFact));
    expect(letterMissingFacts(testPatient, factsCriterion, withFact, cited)).toEqual([]);
  });

  it('are the facts the first model named, as the bell shows them', () => {
    const cited = linesById(noFactLines, citedLineIds(possible));
    expect(letterMissingFacts(testPatient, factsCriterion, possible, cited)).toEqual([EGFR]);
    const own = finding(['L002'], ['The kidney function']);
    expect(letterMissingFacts(testPatient, factsCriterion, own, cited)).toEqual(['The kidney function']);
  });

  it('never print a date, an amount or a medicine name that code has not checked: then the list of the criterion is used', () => {
    const cited = linesById(noFactLines, citedLineIds(possible));
    for (const made of ['eGFR 19 mL/min/1.73 m2 on 3 March 2026', 'An eGFR while on Zentaprex 200 mg', 'eGFR measured 2026-02-30']) {
      expect(letterMissingFacts(testPatient, factsCriterion, finding(['L002'], [made]), cited), made).toEqual([EGFR]);
    }
    // A limit that the criterion itself gives is fine.
    expect(letterMissingFacts(testPatient, factsCriterion, finding(['L002'], ['An eGFR below 30 mL/min/1.73 m2']), cited))
      .toEqual(['An eGFR below 30 mL/min/1.73 m2']);
  });

  it('fall back to the list of the criterion, or to plain words, when a possible finding names no fact', () => {
    const cited = linesById(noFactLines, ['L002']);
    const noName = { ...finding(['L002'], []), possible: true };
    expect(letterMissingFacts(testPatient, factsCriterion, noName, cited)).toEqual([EGFR]);
    expect(letterMissingFacts(testPatient, testCriterion, noName, cited)).toEqual(['a fact that the criterion needs']);
  });

  it('are read from the first result when a finding has no "possible" mark, as one built by other code may not', () => {
    const { possible: _mark, ...unmarked } = possible;
    const cited = linesById(noFactLines, citedLineIds(possible));
    expect(letterMissingFacts(testPatient, factsCriterion, unmarked as Finding, cited)).toEqual([EGFR]);
  });
});

describe('the letter for a possible finding', () => {
  const cited = linesById(noFactLines, citedLineIds(possible));

  it('tells the model that the record does not show the fact, and asks for a request to confirm it', () => {
    const text = letterMessages(testPatient, factsCriterion, possible, cited)[1].content;
    expect(text).toContain('"possible_finding": "Yes. The medicines match the criterion, and the record we hold does not show the fact below."');
    expect(text).toContain(`"record_does_not_show": [\n  "${EGFR}"\n ]`);
    expect(text).toContain('This is a possible finding. The record we hold does not show the fact named in record_does_not_show.');
    expect(text).toContain('Do not write that the patient has it, and do not write that the patient does not have it.');
    expect(text).toContain('request_paragraph (2 sentences: ask the doctor to confirm the fact, and to review the medicines if it applies; offer to help)');
    expect(text).not.toContain('\u2014');
  });

  it('carries the line "The record we hold does not show: (fact)." in its frame, above the letter text', async () => {
    const { fake, deps: d } = deps([goodPossible]);
    const draft = await draftLetter(testConfig, testPatient, noFactLines, factsCriterion, possible, d);
    expect(fake.calls).toHaveLength(1);
    expect(draft.origin).toBe('model');
    expect(draft.checkNotes).toEqual([]);
    const body = draft.body;
    const line = `The record we hold does not show: ${EGFR}.`;
    expect(body).toContain(line);
    expect(body.indexOf(`Re: ${goodPossible.subject}`)).toBeLessThan(body.indexOf(line));
    expect(body.indexOf(line)).toBeLessThan(body.indexOf('Dear Doctor,'));
    expect(body).toContain(goodPossible.request_paragraph);
    expect(body).toContain(MODEL_LINE);
    expect(body).toContain('Dispensing lines from our records');       // only supplies are cited
    expect(recordDoesNotShowLine([EGFR, 'Heart failure.'])).toBe(`The record we hold does not show: ${EGFR} and Heart failure.`);
  });

  it('sends back a draft whose request does not ask the doctor to confirm the fact', async () => {
    const noAsk = { ...goodPossible, request_paragraph: 'Could you please review the digoxin dose? I am happy to help with any information from our records.' };
    const { fake, deps: d } = deps([noAsk, goodPossible]);
    const draft = await draftLetter(testConfig, testPatient, noFactLines, factsCriterion, possible, d);
    expect(fake.calls).toHaveLength(2);
    expect(userText(fake.calls[1])).toContain(`- ${NO_CONFIRM_REQUEST}`);
    expect(userText(fake.calls[1])).toContain('This is a possible finding.');            // the second request repeats the task of a possible finding
    expect(draft.origin).toBe('model');
    expect(draft.checkNotes).toEqual([`First draft: ${NO_CONFIRM_REQUEST}`, 'The letter was drafted again. The second draft passed the checks.']);
    // A finding that is not possible is not asked for that.
    expect(checkDraft(noAsk, letterAllowedText(testPatient, factsCriterion, cited))).toEqual([]);
    expect(checkDraft(noAsk, letterAllowedText(testPatient, factsCriterion, cited), [], true)).toEqual([NO_CONFIRM_REQUEST]);
  });

  it('builds a template letter that says the record does not show the fact and asks the doctor to confirm it', async () => {
    const paragraphs = templateParagraphs(factsCriterion, cited, [EGFR]);
    expect(paragraphs.subject).toBe(`Possible finding, request for a medicines review: ${factsCriterion.title}`);
    expect(paragraphs.finding_paragraph).toBe(
      'I am writing about a possible medicines issue for this patient. Our records match the medicines part of the criterion set out below. ' +
      `The record we hold does not show: ${EGFR}. Digoxin can build up in the body when the kidneys work poorly.`);
    expect(paragraphs.request_paragraph).toBe(
      `Could you please confirm whether this applies to the patient: ${EGFR}? ` +
      'If it does, could you please review this when you next see the patient? ' +
      'What I am asking you to review: A review of the digoxin dose against the current eGFR. ' +
      'I am happy to help with any information from our dispensing records.');
    // The template passes every check a model draft has to pass, the one for a possible finding too.
    expect(checkDraft(paragraphs, letterAllowedText(testPatient, factsCriterion, cited), medicineNamesInHistory(noFactLines), true)).toEqual([]);

    const { deps: d } = deps([{ fail: 'Tried twice. The local model server did not answer.' }]);
    const draft = await draftLetter(testConfig, testPatient, noFactLines, factsCriterion, possible, d);
    expect(draft.origin).toBe('template');
    expect(draft.body).toContain(`The record we hold does not show: ${EGFR}.`);
    expect(draft.body).toContain('Could you please confirm whether this applies to the patient');
    const urgent = templateParagraphs({ ...factsCriterion, urgency: 'same_day' }, cited, [EGFR]);
    expect(urgent.request_paragraph).toContain('If it does, could you please review this today if possible?');
  });

  it('names every missing fact when there is more than one', () => {
    const body = assembleLetter({
      cfg: testConfig, patient: testPatient, criterion: factsCriterion, cited, origin: 'template', when,
      paragraphs: templateParagraphs(factsCriterion, cited, ['Serum potassium', 'Serum sodium', 'Gout']), missingFacts: ['Serum potassium', 'Serum sodium', 'Gout']
    });
    expect(body).toContain('The record we hold does not show: Serum potassium, Serum sodium and Gout.');
    expect(body).not.toContain(TEMPLATE_LINE);
    expect(body).not.toContain(MODEL_LINE);
    expect(body.trimEnd().endsWith('Marwan Morsy\nPharmacy Manager\nPHA0002761764')).toBe(true);
  });
});

describe('the letter for a finding whose fact is on the record', () => {
  const cited = linesById(factsLines, citedLineIds(withFact));

  it('gives the model the fact line with its date in words, and asks it to name the recorded facts', () => {
    const text = letterMessages(testPatient, factsCriterion, withFact, cited)[1].content;
    expect(text).toContain('"12 May 2026 | RESULT | eGFR 24 mL/min/1.73 m2"');
    expect(text).toContain('evidence_paragraph (2 to 3 sentences naming the supplies, the recorded facts and their dates)');
    expect(text).not.toContain('possible_finding');
    expect(text).not.toContain('record_does_not_show');
  });

  it('accepts a fact line cited from the record: its date and its number with the unit', async () => {
    const { fake, deps: d } = deps([goodWithFact]);
    const draft = await draftLetter(testConfig, testPatient, factsLines, factsCriterion, withFact, d);
    expect(fake.calls).toHaveLength(1);
    expect(draft.origin).toBe('model');
    expect(draft.checkNotes).toEqual([]);
    expect(draft.body).toContain('Lines from our records');                      // a result is not a dispensing line
    expect(draft.body).not.toContain('Dispensing lines from our records');
    expect(draft.body).toContain('2026-05-12 | RESULT | eGFR 24 mL/min/1.73 m2');
    expect(draft.body).not.toContain('The record we hold does not show');        // not a possible finding
    expect(draft.body).not.toContain('2025-12-02 | CONDITION | Atrial fibrillation');   // a fact line that was not cited is not printed
  });

  it('still catches a wrong number or a wrong date for a fact', async () => {
    const wrongValue = { ...goodWithFact, evidence_paragraph: 'Lanoxin 250 microgram was supplied on 8 December 2025. An eGFR of 42 mL/min/1.73 m2 was recorded on 12 May 2026.' };
    const wrongDate = { ...goodWithFact, evidence_paragraph: 'Lanoxin 250 microgram was supplied on 8 December 2025. An eGFR of 24 mL/min/1.73 m2 was recorded on 12 June 2026.' };
    const allowed = letterAllowedText(testPatient, factsCriterion, cited);
    expect(checkDraft(wrongValue, allowed)).toEqual(['The amount "42 mL" is not in the dispensing lines or the criterion.']);
    expect(checkDraft(wrongDate, allowed)).toEqual(['The date "12 June 2026" is not in the dispensing lines.']);
    const { fake, deps: d } = deps([wrongValue, goodWithFact]);
    const draft = await draftLetter(testConfig, testPatient, factsLines, factsCriterion, withFact, d);
    expect(userText(fake.calls[1])).toContain('- The amount "42 mL" is not in the dispensing lines or the criterion.');
    expect(draft.origin).toBe('model');
  });

  it('does not take the words of a fact line for medicine names', () => {
    const names = medicineNamesInHistory(factsLines);
    expect(names).toEqual(expect.arrayContaining(['lanoxin', 'lipitor', 'atorvastatin']));
    for (const word of ['result', 'condition', 'observation', 'egfr', 'atrial']) expect(names, word).not.toContain(word);
    // A history with no fact line gives the names it always gave.
    expect(medicineNamesInHistory(testLines)).toEqual(expect.arrayContaining(['lipitor', 'atorvastatin', 'xarelto', 'celebrex']));
  });

  it('says to the model that a finding with no supply among its lines is about a medicine that is not supplied', () => {
    // A START criterion: the record holds the condition and the medicine that should be there is not supplied.
    // Only the condition line is cited. In a live run the letter model then wrote "No medicines were identified".
    const omission = finding(['L001'], []);
    const onlyFact = linesById(factsLines, ['L001']);
    const text = letterMessages(testPatient, factsCriterion, omission, onlyFact)[1].content;
    expect(text).toContain('"2 December 2025 | CONDITION | Atrial fibrillation"');
    expect(text).toContain('The evidence lines hold no supply, because this finding is about a medicine that is not supplied. Name that kind of medicine as the criterion names it.');
    expect(text).toContain('saying that our dispensing records show no recent supply of the medicine the criterion is about');
    const paragraphs = templateParagraphs(factsCriterion, onlyFact, []);
    expect(paragraphs.evidence_paragraph).toContain('Our dispensing records show no recent supply of the medicine the criterion is about.');
    expect(checkDraft(
      { ...paragraphs, evidence_paragraph: 'The lines from our records that match are listed below with their dates.' },
      'x', [], false, true
    )).toContain(NO_SUPPLY_NOTE);
    expect(checkDraft(paragraphs, letterAllowedText(testPatient, factsCriterion, onlyFact), medicineNamesInHistory(onlyFact), false, true)).toEqual([]);
    // With a supply among the lines, and for a criterion without facts, the model is not told that.
    expect(letterMessages(testPatient, factsCriterion, withFact, cited)[1].content).not.toContain('is not supplied');
    expect(letterMessages(testPatient, testCriterion, { ...withFact, screen: { ...withFact.screen, lineIds: ['L002'] }, check: undefined }, linesById(testLines, ['L002']))[1].content)
      .not.toContain('is not supplied');
  });

  it('keeps the fact lines among the lines the model is given when the list is long', () => {
    // 20 supplies, then the result at the start of the record: the last twelve lines alone would leave the result out.
    const lines: HistoryLine[] = [
      { id: 'L001', text: '2025-01-05 | RESULT | eGFR 24 mL/min/1.73 m2' },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: lineId(i + 2),
        text: `2025-${String((i % 12) + 1).padStart(2, '0')}-10 | Lanoxin 250 microgram tablet | qty 100 | repeats 1 | Take ONE tablet daily | Dr A. Example`
      }))
    ];
    const long = finding(lines.map(l => l.id), []);
    const text = letterMessages(testPatient, factsCriterion, long, lines)[1].content;
    expect(text).toContain('"5 January 2025 | RESULT | eGFR 24 mL/min/1.73 m2"');
    expect(text).toContain('"note": "There are 9 more supply lines. The full list is printed under the letter."');
    expect((text.match(/Lanoxin 250 microgram tablet/g) ?? []).length).toBe(11);       // eleven supplies and the result: twelve lines
  });
});
