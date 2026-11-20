import { describe, expect, it } from 'vitest';
import type { Finding } from '../shared/types.ts';
import {
  assembleLetter, checkDraft, choosePrescriber, citedLineIds, draftLetter, EMAIL_COVER_NOTE, emailDraftFor, FICTIONAL_LINE, templateLetter,
  letterAllowedText, letterAsItLeaves, letterClosing, letterMessages, letterTextHash, signatureBlock,
  medicineNamesInHistory, medicinesInLines, MODEL_LINE, prescriberInLine, TEMPLATE_LINE, TEMPLATE_LINE_ERROR, TEMPLATE_LINE_NO_ANSWER, templateParagraphs, WORDING_HINT,
  type LetterParagraphs
} from './letter.ts';
import { checkLetterFacts, checkLetterTone, isWordingNote } from './facts.ts';
import { linesById } from './history.ts';
import { fakeChat, testConfig, testCriterion, testLines, testPatient, userText } from './testkit.ts';

const finding: Finding = {
  id: 'F0001',
  caseId: 'C0001',
  criterionId: testCriterion.id,
  state: 'accepted',
  possible: false,
  screen: {
    lineIds: ['L002', 'L003', 'L004', 'L005', 'L006'], medicines: ['celecoxib', 'rivaroxaban'],
    reason: 'Celebrex with Xarelto.', linesVerified: true, missingFacts: [], model: 'lantern-screen', at: '2026-11-18T00:00:00.000Z', seconds: 5
  },
  check: {
    confirmed: true, lineIds: ['L002', 'L003', 'L004', 'L005'], whatMatches: 'Celebrex and Xarelto within 60 days.',
    whatCannotBeSeen: 'Whether the medicines were taken.', completed: true, model: 'lantern-check', at: '2026-11-18T00:00:10.000Z', seconds: 9
  },
  decision: { action: 'accept', by: 'The pharmacist on duty', at: '2026-11-18T00:01:00.000Z' },
  seenByPharmacist: true
};

const good: LetterParagraphs = {
  subject: 'Review request: celecoxib with rivaroxaban, Fictional patient F-001',
  finding_paragraph: 'I am writing about a possible medicines issue for this 72-year-old patient. An NSAID was supplied while an oral anticoagulant is also being supplied.',
  evidence_paragraph: 'Celebrex 200 mg was supplied on 21 August 2026 and 20 September 2026. Xarelto 20 mg was supplied on 8 August 2026 and 8 September 2026.',
  request_paragraph: 'Could you please review whether the NSAID is still needed? I am happy to help with any information from our records.'
};

// The mistake the letter model made in the proof: one date that is not in the lines.
const wrongDate: LetterParagraphs = {
  ...good,
  evidence_paragraph: 'Celebrex 200 mg was supplied on 21/08/2026 and 20/10/2026. Xarelto 20 mg was supplied on 08/09/2026.'
};

const when = new Date(2026, 10, 18, 9, 30);         // 18 November 2026, local time
const deps = (answers: unknown[]) => {
  const fake = fakeChat(answers);
  return { fake, deps: { chat: fake.chat, now: () => when } };
};

describe('what a letter is built from', () => {
  it('cites the lines of the second check and keeps the lines of the first model as well', () => {
    // One rule for the page, the letter and the scorer (shared/lines.ts).
    expect(citedLineIds(finding)).toEqual(['L002', 'L003', 'L004', 'L005', 'L006']);
    expect(citedLineIds({ ...finding, check: { ...finding.check!, lineIds: [] } })).toEqual(finding.screen.lineIds);
    expect(citedLineIds({ ...finding, check: { ...finding.check!, completed: false } })).toEqual(finding.screen.lineIds);
    const { check: _dropped, ...unchecked } = finding;
    expect(citedLineIds(unchecked)).toEqual(finding.screen.lineIds);
  });

  it('still prints the proving lines when the second model named other lines', async () => {
    // What the reviewers showed: Model 1 cites the Celebrex and Xarelto lines, Model 2 confirms but names two other lines.
    const other: Finding = { ...finding, screen: { ...finding.screen, lineIds: ['L003', 'L004'] }, check: { ...finding.check!, lineIds: ['L001', 'L006'] } };
    expect(citedLineIds(other)).toEqual(['L001', 'L003', 'L004', 'L006']);
    const { deps: d } = deps([{ fail: 'Tried twice.' }]);
    const draft = await draftLetter(testConfig, testPatient, testLines, testCriterion, other, d);
    expect(draft.body).toContain(testLines[2].text);          // L003, the Celebrex supply
    expect(draft.body).toContain(testLines[3].text);          // L004, the Xarelto supply
  });

  it('names the criterion medicines found in the cited lines, with the brand that was supplied', () => {
    const cited = linesById(testLines, citedLineIds(finding));
    expect(medicinesInLines(testCriterion, cited)).toEqual(['celecoxib (Celebrex)', 'rivaroxaban (Xarelto)']);
  });

  it('collects the medicine names written in the history', () => {
    const names = medicineNamesInHistory(testLines);
    expect(names).toEqual(expect.arrayContaining(['lipitor', 'atorvastatin', 'xarelto', 'celebrex']));
  });

  it('gives the model the facts with dates in words, ready to copy', () => {
    const cited = linesById(testLines, citedLineIds(finding));
    const text = letterMessages(testPatient, testCriterion, finding, cited)[1].content;
    expect(text).toContain('FINDING ACCEPTED BY THE PHARMACIST');
    expect(text).toContain('"patient": "Fictional patient F-001, female, 72 years"');
    expect(text).toContain('21 August 2026 | Celebrex 200 mg capsule | qty 30 | repeats 2');
    expect(text).toContain('"celecoxib (Celebrex)"');
    expect(text).not.toContain('Lipitor');                 // a line that was not cited is not given
    expect(text).toContain('Write: subject (one line), finding_paragraph');
  });
});

describe('the letter text', () => {
  const cited = linesById(testLines, citedLineIds(finding));
  const body = assembleLetter({ cfg: testConfig, patient: testPatient, criterion: testCriterion, cited, paragraphs: good, origin: 'model', when });

  it('has every part the specification lists, in order', () => {
    const order = [
      'Example Community Pharmacy (fictional)',
      'Pharmacist: Marwan Morsy',
      '18 November 2026',
      'To: Dr F. Example',
      'Patient: Fictional patient F-001, female, 72 years',
      FICTIONAL_LINE,
      `Re: ${good.subject}`,
      good.finding_paragraph,
      good.evidence_paragraph,
      good.request_paragraph,
      `${testCriterion.label}: ${testCriterion.statement}`,
      `Source: ${testCriterion.source.credit}`,
      'Dispensing lines from our records',
      testLines[1].text,
      testLines[4].text,
      'What a dispensing history cannot show',
      testCriterion.cannot_be_seen,
      'Yours sincerely,',
      MODEL_LINE,
      'Marwan Morsy',
      'Pharmacy Manager',
      'PHA0002761764'
    ];
    let from = 0;
    for (const piece of order) {
      const at = body.indexOf(piece, from);
      expect(at, `missing or out of order: ${piece}`).toBeGreaterThanOrEqual(from);
      from = at + piece.length;
    }
    expect(body).not.toContain(testLines[0].text);           // not cited
    expect(body).not.toContain('\u2014');                    // no em dash
    expect(body).not.toContain('Example Family Practice');   // the settings practice belongs to the placeholder, not to Dr F. Example
    expect(body).not.toContain('Dr F. Example (fictional)');
  });

  it('addresses the letter to the prescriber named most often in the cited lines', () => {
    const lines = [
      { id: 'L001', text: '2026-08-03 | RESULT | eGFR 28 mL/min/1.73 m2' },
      { id: 'L002', text: '2026-08-08 | Xarelto 20 mg tablet | qty 28 | Dr A. Example' },
      { id: 'L003', text: '2026-08-21 | Celebrex 200 mg capsule | qty 30 | Dr H. Example' },
      { id: 'L004', text: '2026-09-08 | Xarelto 20 mg tablet | qty 28 | Dr A. Example' }
    ];
    expect(choosePrescriber(lines, testConfig.doctor)).toEqual({ name: 'Dr A. Example', practice: '' });
    // A tie goes to the later cited line.
    const tied = [lines[1], lines[2]];
    expect(choosePrescriber(tied, testConfig.doctor)).toEqual({ name: 'Dr H. Example', practice: '' });
    // No prescriber: the settings placeholder, and its practice.
    expect(choosePrescriber([lines[0]], testConfig.doctor)).toEqual({
      name: 'Dr F. Example (fictional)', practice: 'Example Family Practice'
    });
    expect(prescriberInLine('2026-08-08 | Xarelto 20 mg | qty 28 | Dr A. Example')).toBe('Dr A. Example');
    expect(prescriberInLine('2026-08-08 | Doctor H. Example | qty 28 | Take one daily')).toBe('Doctor H. Example');
    expect(prescriberInLine('2026-08-08 | Xarelto | qty 28 | dr a. example')).toBe('dr a. example');
    expect(prescriberInLine('Dr A. Example')).toBe('Dr A. Example');
    expect(prescriberInLine('2026-08-03 | RESULT | eGFR 28')).toBeNull();
    expect(prescriberInLine('Andrew drove past | Take one daily')).toBeNull();
    const toDoctor = assembleLetter({
      cfg: testConfig, patient: testPatient, criterion: testCriterion, cited: [lines[0]], paragraphs: good, origin: 'model', when
    });
    expect(toDoctor).toContain('To: Dr F. Example (fictional)\nExample Family Practice\n');
  });

  it('puts the line about AI and the signature back after an edit, and they cannot be deleted', () => {
    const closing = letterClosing(testConfig, 'model');
    const left = letterAsItLeaves(body, closing);
    expect(left).toBe(body);
    const edited = letterAsItLeaves(body.replace('Dear Doctor,', 'Dear Doctor,\n\nOne more sentence.'), closing);
    expect(edited).toContain('One more sentence.');
    expect(edited.endsWith(`${MODEL_LINE}\nMarwan Morsy\nPharmacy Manager\nPHA0002761764`)).toBe(true);
    const stripped = letterAsItLeaves('Fictional patient. No real person.\n\nPlease review this.', closing);
    expect(stripped.endsWith(`${MODEL_LINE}\nMarwan Morsy\nPharmacy Manager\nPHA0002761764`)).toBe(true);
    expect(letterTextHash(left)).toHaveLength(64);
    const template = letterClosing(testConfig, 'template', 'checks_failed');
    expect(template.closingLine).toBe('');
    const fromTemplate = letterAsItLeaves('Fictional patient. No real person.\n\nPlease review this.', template);
    expect(fromTemplate.endsWith('Marwan Morsy\nPharmacy Manager\nPHA0002761764')).toBe(true);
    expect(fromTemplate).not.toContain(TEMPLATE_LINE);
    expect(fromTemplate).not.toContain(MODEL_LINE);
    expect(fromTemplate).not.toContain('Built from the standard letter template');
    const bare = letterAsItLeaves('Dear Doctor, please review.', closing);
    expect(bare).toContain('Dear Doctor, please review.');
    expect(bare).toContain(FICTIONAL_LINE);
    expect(bare.split(FICTIONAL_LINE)).toHaveLength(2);
    expect(bare.indexOf(FICTIONAL_LINE)).toBeLessThan(bare.indexOf('Yours sincerely,'));
    expect(bare.endsWith(`${MODEL_LINE}\nMarwan Morsy\nPharmacy Manager\nPHA0002761764`)).toBe(true);
    expect(letterAsItLeaves(bare, closing).split(FICTIONAL_LINE)).toHaveLength(2);
    const bareTemplate = letterAsItLeaves('Dear Doctor, please review.', template);
    expect(bareTemplate).toContain(FICTIONAL_LINE);
    expect(bareTemplate.split(FICTIONAL_LINE)).toHaveLength(2);
    expect(bareTemplate).not.toContain(MODEL_LINE);
    expect(bareTemplate).not.toContain(TEMPLATE_LINE);
    expect(bareTemplate).not.toContain('Built from the standard letter template');
    expect(bareTemplate.endsWith('Marwan Morsy\nPharmacy Manager\nPHA0002761764')).toBe(true);
  });

  it('makes an email draft of the letter when it fits, and a cover note when it does not', () => {
    const fits = emailDraftFor('Review', 'Short letter.', 1800);
    expect(fits).toEqual({ subject: 'Review', text: 'Short letter.', fits: true, coverNote: false });
    expect(fits.text).not.toMatch(/@/);
    const long = emailDraftFor('Review', 'x'.repeat(1801), 1800);
    expect(long.fits).toBe(false);
    expect(long.coverNote).toBe(true);
    expect(long.text).toBe(EMAIL_COVER_NOTE);
    expect(long).not.toHaveProperty('to');
  });

  it('a template letter ends with the signature and does not say it came from the template', () => {
    const paragraphs = templateParagraphs(testCriterion, cited);
    const text = assembleLetter({ cfg: testConfig, patient: testPatient, criterion: testCriterion, cited, paragraphs, origin: 'template', when });
    expect(text).not.toContain(TEMPLATE_LINE);
    expect(text).not.toContain(TEMPLATE_LINE_NO_ANSWER);
    expect(text).not.toContain(TEMPLATE_LINE_ERROR);
    expect(text).not.toContain('Built from the standard letter template');
    expect(text).not.toContain(MODEL_LINE);
    expect(text.trimEnd().endsWith('Marwan Morsy\nPharmacy Manager\nPHA0002761764')).toBe(true);
    expect(text).toContain('What I am asking you to review: Whether the NSAID is still needed while the anticoagulant continues, and the patient\'s risk of bleeding.');
    // The template states no dates, amounts or medicine names of its own.
    expect(checkDraft(paragraphs, letterAllowedText(testPatient, testCriterion, cited))).toEqual([]);
  });

  it('prints the change notice when the criterion has one, on a model letter and on a template letter', async () => {
    const criterion = {
      ...testCriterion,
      source: { ...testCriterion.source, modification_notice: 'Wording shortened for the prototype.' }
    };
    const cited = linesById(testLines, citedLineIds(finding));
    const model = assembleLetter({
      cfg: testConfig, patient: testPatient, criterion, cited, paragraphs: good, origin: 'model', when
    });
    const fromTemplate = templateLetter(testConfig, testPatient, testLines, criterion, finding, 'error', ['The letter step stopped.'], when);
    for (const text of [model, fromTemplate.body]) {
      expect(text).toContain('Wording shortened for the prototype.');
      expect(text.indexOf(`${criterion.label}: ${criterion.statement}`)).toBeLessThan(text.indexOf('Wording shortened for the prototype.'));
      expect(text).toContain(`Source: ${criterion.source.credit}`);
      expect(text).toContain(FICTIONAL_LINE);
      expect(text).toContain('What a dispensing history cannot show');
      expect(text).toContain(criterion.cannot_be_seen);
      expect(text.trimEnd().endsWith('Marwan Morsy\nPharmacy Manager\nPHA0002761764')).toBe(true);
    }
    expect(model).toContain(MODEL_LINE);
    expect(fromTemplate.body).not.toContain(MODEL_LINE);
    expect(fromTemplate.body).not.toContain('Built from the standard letter template');
    expect(fromTemplate.origin).toBe('template');
  });

  it('marks a same-day criterion', () => {
    const urgent = { ...testCriterion, urgency: 'same_day' as const };
    const text = assembleLetter({ cfg: testConfig, patient: testPatient, criterion: urgent, cited, paragraphs: templateParagraphs(urgent, cited), origin: 'template', when });
    expect(text).toContain('Urgency: same day.');
    expect(text).toContain('Could you please review this today if possible?');
  });
});

describe('draftLetter', () => {
  it('uses the first draft when it passes the checks', async () => {
    const { fake, deps: d } = deps([good]);
    const draft = await draftLetter(testConfig, testPatient, testLines, testCriterion, finding, d);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ model: 'lantern-letter', think: false, numPredict: 1200 });
    expect(draft.origin).toBe('model');
    expect(draft.checkNotes).toEqual([]);
    expect(draft.subject).toBe(good.subject);
    expect(draft.body).toContain(good.evidence_paragraph);
    expect(draft.body).toContain(MODEL_LINE);
    expect(draft.body).toContain(FICTIONAL_LINE);
    expect(draft.model).toBe('lantern-letter');
    expect(draft.at).toBe(when.toISOString());
  });

  it('catches 21 September 2026 when the lines say 21 August 2026, names it, and uses the template when the second draft is wrong too', async () => {
    const september: LetterParagraphs = {
      ...good,
      evidence_paragraph: 'Celebrex 200 mg was supplied on 21 September 2026.'
    };
    const { fake, deps: d } = deps([september, september]);
    const draft = await draftLetter(testConfig, testPatient, testLines, testCriterion, finding, d);
    expect(fake.calls).toHaveLength(2);
    expect(userText(fake.calls[1])).toContain('The date "21 September 2026" is not in the dispensing lines.');
    expect(draft.origin).toBe('template');
    expect(draft.templateReason).toBe('checks_failed');
    expect(draft.body).not.toContain('21 September 2026');
    expect(draft.body).toContain(`${testCriterion.label}: ${testCriterion.statement}`);
    expect(draft.body.trimEnd().endsWith('Marwan Morsy\nPharmacy Manager\nPHA0002761764')).toBe(true);
  });

  it('drafts once more when a date is wrong, and names the mismatch to the model', async () => {
    const { fake, deps: d } = deps([wrongDate, good]);
    const draft = await draftLetter(testConfig, testPatient, testLines, testCriterion, finding, d);
    expect(fake.calls).toHaveLength(2);
    const second = fake.calls[1];
    expect(second.messages.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(userText(second)).toContain('- The date "20/10/2026" is not in the dispensing lines.');
    expect(userText(second)).toContain('Write the letter again.');
    expect(draft.origin).toBe('model');
    expect(draft.body).toContain(good.evidence_paragraph);
    expect(draft.body).not.toContain('20/10/2026');
    expect(draft.checkNotes).toEqual([
      'First draft: The date "20/10/2026" is not in the dispensing lines.',
      'The letter was drafted again. The second draft passed the checks.'
    ]);
  });

  it('asks for a second draft about a date in the words it always used', async () => {
    // The request for a second draft is the same as before the wording hint was added, to the letter.
    const { fake, deps: d } = deps([wrongDate, good]);
    await draftLetter(testConfig, testPatient, testLines, testCriterion, finding, d);
    expect(userText(fake.calls[1])).toBe(
      'Some things in that draft are not in the facts of the finding:\n' +
      '- The date "20/10/2026" is not in the dispensing lines.\n' +
      'Write the letter again. Use only dates, amounts and medicine names that are in the facts. ' +
      'Copy them exactly. Ask for a review. Do not tell the doctor what to do.\n' +
      'Write: subject (one line), finding_paragraph (2 to 3 sentences), ' +
      'evidence_paragraph (2 to 3 sentences naming the supplies and dates), ' +
      'request_paragraph (2 sentences asking for review and offering to help).'
    );
    expect(userText(fake.calls[1])).not.toContain('About the wording');
  });

  it('names the words the wording check looks for in the second request, when the first draft told the doctor what to do', async () => {
    // Measured with the real model on 18 November: told only that "should" was found, it wrote "is to be",
    // or kept "should" in a request that ended with a full stop. Both drafts failed and the template was used.
    const telling: LetterParagraphs = {
      ...good,
      request_paragraph: 'Could you please review whether the NSAID should be reviewed. I am happy to help with any information from our records.'
    };
    const { fake, deps: d } = deps([telling, good]);
    const draft = await draftLetter(testConfig, testPatient, testLines, testCriterion, finding, d);
    expect(fake.calls).toHaveLength(2);
    // The first request is not changed by the hint.
    expect(userText(fake.calls[0])).not.toContain('About the wording');
    const second = userText(fake.calls[1]);
    expect(second).toContain('- The words "should" tell the doctor what to do. The letter should ask for a review.');
    expect(second).toContain('Write the letter again.');
    expect(second).toContain(WORDING_HINT);
    expect(WORDING_HINT).toBe(
      'About the wording: in a sentence that is not a question, do not write must, should, ought to, need to, needs to, ' +
      'is to be, are to be, requires, recommend, advise or suggest. Leave these words out, also where the facts above use them. ' +
      'A sentence that asks the doctor something ends with a question mark.'
    );
    // The hint stands before the task, so the task is still the last thing the model reads.
    expect(second.indexOf(WORDING_HINT)).toBeLessThan(second.indexOf('Write: subject (one line)'));
    expect(draft.origin).toBe('model');
    expect(draft.checkNotes).toEqual([
      'First draft: The words "should" tell the doctor what to do. The letter should ask for a review.',
      'The letter was drafted again. The second draft passed the checks.'
    ]);
    // The check itself is as strict as before: the same wording in the second draft still ends in the template.
    const twice = await draftLetter(testConfig, testPatient, testLines, testCriterion, finding, deps([telling, telling]).deps);
    expect(twice.origin).toBe('template');
    expect(twice.templateReason).toBe('checks_failed');
    // A note about a fact is not a note about wording, and the other way round.
    expect(isWordingNote('The words "should" tell the doctor what to do. The letter should ask for a review.')).toBe(true);
    expect(isWordingNote('The date "20/10/2026" is not in the dispensing lines.')).toBe(false);
    expect(checkLetterTone(['You should stop the tablet.']).every(isWordingNote)).toBe(true);
  });

  it('falls back to the template when the second draft fails too, and says so', async () => {
    const stillWrong = { ...good, evidence_paragraph: 'Celebrex 200 mg and warfarin 5 mg were supplied on 21 August 2026.' };
    const { fake, deps: d } = deps([wrongDate, stillWrong]);
    const draft = await draftLetter(testConfig, testPatient, testLines, testCriterion, finding, d);
    expect(fake.calls).toHaveLength(2);
    expect(draft.origin).toBe('template');
    expect(draft.body).not.toContain(TEMPLATE_LINE);
    expect(draft.body).not.toContain('Built from the standard letter template');
    expect(draft.body).not.toContain(MODEL_LINE);
    expect(draft.body.trimEnd().endsWith('Marwan Morsy\nPharmacy Manager\nPHA0002761764')).toBe(true);
    expect(draft.body).not.toContain('warfarin 5 mg');
    expect(draft.body).not.toContain('20/10/2026');
    expect(draft.body).toContain(testLines[2].text);          // the cited lines are still printed
    expect(draft.body).toContain(testCriterion.statement);
    expect(draft.checkNotes).toEqual([
      'First draft: The date "20/10/2026" is not in the dispensing lines.',
      'Second draft: The amount "5 mg" is not in the dispensing lines or the criterion.',
      'Both drafts failed the checks.',
      'This letter was built from the standard template.'
    ]);
  });

  it('falls back to the template when the model does not answer, and says that, not that a draft failed its checks', async () => {
    const { deps: d } = deps([{ fail: 'Tried twice. The local model server did not answer.' }]);
    const draft = await draftLetter(testConfig, testPatient, testLines, testCriterion, finding, d);
    expect(draft.origin).toBe('template');
    expect(draft.templateReason).toBe('no_answer');
    expect(draft.checkNotes[0]).toBe('The letter model did not answer. Tried twice. The local model server did not answer.');
    // The letter does not tell the doctor that it came from the template, or that a draft failed its checks.
    expect(draft.body).not.toContain(TEMPLATE_LINE_NO_ANSWER);
    expect(draft.body).not.toContain('did not pass its checks');
    expect(draft.body).not.toContain('Built from the standard letter template');
    expect(draft.body.trimEnd().endsWith('Marwan Morsy\nPharmacy Manager\nPHA0002761764')).toBe(true);
  });

  it('says why the template was used: the drafts failed their checks, or the step failed', async () => {
    const stillWrong = { ...good, evidence_paragraph: 'Celebrex 200 mg and warfarin 5 mg were supplied on 21 August 2026.' };
    const failedChecks = await draftLetter(testConfig, testPatient, testLines, testCriterion, finding, deps([wrongDate, stillWrong]).deps);
    expect(failedChecks.templateReason).toBe('checks_failed');
    expect(failedChecks.body).not.toContain(TEMPLATE_LINE);
    expect(failedChecks.body).not.toContain(TEMPLATE_LINE_ERROR);
    expect(failedChecks.body.trimEnd().endsWith('Marwan Morsy\nPharmacy Manager\nPHA0002761764')).toBe(true);
    const broke = await draftLetter(testConfig, testPatient, testLines, testCriterion, finding, {
      chat: async () => { throw new Error('boom'); }, now: () => when
    });
    expect(broke.templateReason).toBe('error');
    expect(broke.body).not.toContain(TEMPLATE_LINE_ERROR);
    expect(broke.body).not.toContain('Built from the standard letter template');
    const model = await draftLetter(testConfig, testPatient, testLines, testCriterion, finding, deps([good]).deps);
    expect(model.templateReason).toBeUndefined();
  });

  it('never throws, even when the model stand-in throws', async () => {
    const draft = await draftLetter(testConfig, testPatient, testLines, testCriterion, finding, {
      chat: async () => { throw new Error('boom'); }, now: () => when
    });
    expect(draft.origin).toBe('template');
    expect(draft.checkNotes[0]).toContain('boom');
    expect(draft.body).toContain(FICTIONAL_LINE);
  });

  it('catches a medicine from the history that is not part of the finding', async () => {
    const stray = { ...good, finding_paragraph: 'This patient also takes Lipitor. An NSAID was supplied while an oral anticoagulant is also being supplied.' };
    const { fake, deps: d } = deps([stray, good]);
    const draft = await draftLetter(testConfig, testPatient, testLines, testCriterion, finding, d);
    expect(userText(fake.calls[1])).toContain('The medicine name "lipitor" is not in the dispensing lines or the criterion.');
    expect(draft.origin).toBe('model');
  });

  it('sends back a draft that tells the doctor what to do', async () => {
    const bossy = { ...good, request_paragraph: 'Please cease the NSAID. I am happy to help.' };
    const { fake, deps: d } = deps([bossy, good]);
    const draft = await draftLetter(testConfig, testPatient, testLines, testCriterion, finding, d);
    expect(userText(fake.calls[1])).toContain('tell the doctor what to do');
    expect(draft.origin).toBe('model');
  });

  it('writes a model letter whose own paragraphs pass the exported fact check', async () => {
    const { deps: d } = deps([good]);
    const draft = await draftLetter(testConfig, testPatient, testLines, testCriterion, finding, d);
    const cited = linesById(testLines, citedLineIds(finding));
    const paragraphs = [good.subject, good.finding_paragraph, good.evidence_paragraph, good.request_paragraph];
    expect(checkLetterFacts(paragraphs, letterAllowedText(testPatient, testCriterion, cited))).toEqual([]);
    for (const p of paragraphs) expect(draft.body).toContain(p);
  });
});

describe('the signature block', () => {
  it('puts the model line above the name, and leaves that line off when it is empty', () => {
    const model = letterClosing(testConfig, 'model');
    expect(signatureBlock(model)).toBe(`${MODEL_LINE}\nMarwan Morsy\nPharmacy Manager\nPHA0002761764`);
    const template = letterClosing(testConfig, 'template', 'checks_failed');
    expect(template.closingLine).toBe('');
    expect(signatureBlock(template)).toBe('Marwan Morsy\nPharmacy Manager\nPHA0002761764');
    expect(signatureBlock({
      closingLine: '',
      signatureName: 'A Name',
      signatureTitle: 'A Title',
      signatureRegistration: 'REG1'
    })).toBe('A Name\nA Title\nREG1');
  });
});
