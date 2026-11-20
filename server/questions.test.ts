// The pharmacist's questions. No model is called: the screen, the check and the letter are stand-ins.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCsv } from '../pipeline/csv.ts';
import { criterionBlock, readCriterion } from '../pipeline/criteria.ts';
import { datesNote, latestDate } from '../pipeline/screen.ts';
import { latestSupplyDate } from '../pipeline/age.ts';
import { testConfig } from '../pipeline/testkit.ts';
import type { CaseRecord, Criterion, Finding, HistoryLine, Letter, PharmacistQuestion, ScreenResult } from '../shared/types.ts';
import type { ScreenOutcome } from '../pipeline/screen.ts';
import { ApiError, Engine, type PipelineFns } from './engine.ts';
import { fullyScreened } from './view.ts';
import { PageImages } from './images.ts';
import { AGE_LIMIT_UNREAD, PHARMACIST_MARK, PRESENT_THROUGHOUT, TAKEN_BACK_MARK, ageLimitHolds, answerLineText, askWhenAnswered, checksNotRun, checksNotRunWords, chosenFrom, dayOf, defaultOptions, factKey, factLineDetail, groupIsSupplied, groupSuppliedRecently, leaveStanding, linesForModels, listedMedicineSupplied, nameForSupplyMatch, needsAValue, readAgeLimit, sexTheCriterionNames, showStanding, standingQuestionApplies, syncCaseQuestions, takeAnswerBack, writeAnswer } from './questions.ts';
import { longDate } from '../pipeline/dates.ts';
import { StateStore } from './store.ts';

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function criterion(over: Partial<Criterion> & Pick<Criterion, 'id' | 'label'>): Criterion {
  return {
    family: 'Test',
    title: over.label,
    statement: 'Test wording. This is not a published criterion.',
    statement_origin: 'entrant',
    source: {
      document: 'Test',
      citation: 'Test',
      licence: 'Test',
      licence_status: 'proposed',
      credit: 'Test wording written for this prototype. It is not a published criterion.'
    },
    plain_summary: 'A test criterion.',
    medicine_groups: [{
      key: 'A', name: 'The medicine', ingredients: ['ibuprofen'], brands: { ibuprofen: ['Nurofen'] }
    }],
    rule_for_models: 'Suspect when the named medicine is supplied.',
    cannot_be_seen: 'The fact the record does not show.',
    ask_the_gp: 'A review.',
    urgency: 'routine',
    draft: true,
    signed_by_clinical_reviewer: null,
    ...over
  };
}

const heart = { kind: 'condition' as const, what: 'Heart failure', meets: 'the patient has heart failure' };

const hf = criterion({ id: 'HF', label: 'Heart failure test', needs_facts: [heart] });
const hf2 = criterion({ id: 'HF2', label: 'Heart failure test two', needs_facts: [{ ...heart }] });
const lithium = criterion({
  id: 'LI',
  label: 'Lithium level test',
  statement: 'Lithium supplied to a person aged over 65.',
  medicine_groups: [{ key: 'A', name: 'Lithium', ingredients: ['lithium'], brands: { lithium: ['Lithicarb'] } }],
  needs_facts: [{ kind: 'result', what: 'latest lithium level', meets: 'above 1 mmol/L', ask_when: { group: 'A' } }]
});
const age = criterion({
  id: 'AGE',
  label: 'Age test',
  needs_facts: [{ kind: 'result', what: 'Age', meets: 'the age in years', ask_when: 'always' }]
});

const ALL = [hf, hf2, lithium, age];

function csv(years: number, rows: { medicine: string; brand: string }[]): string {
  const head = 'patient_ref,patient_age,patient_sex,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber';
  const body = rows.map(row => `F-001,${years},F,2026-08-08,${row.medicine},${row.brand},200 mg,tablet,30,1,one daily,Dr A. Example`);
  return `${head}\n${body.join('\n')}\n`;
}

function screenResult(over: Pick<ScreenResult, 'lineIds' | 'reason' | 'missingFacts'> & Partial<ScreenResult>): ScreenResult {
  return {
    medicines: [],
    linesVerified: true,
    model: 'lantern-screen',
    at: '2026-11-19T00:00:00.000Z',
    seconds: 1,
    ...over
  };
}

function liveLine(lines: HistoryLine[], includes: string): HistoryLine | undefined {
  return lines.find(line =>
    line.text.includes('pharmacist at the counter') && !line.text.includes(TAKEN_BACK_MARK) && line.text.includes(includes)
  );
}

/** What the stand-in says. A live pharmacist line is the fact. No such line leaves a possible finding only for heart failure. */
function screenOf(lines: HistoryLine[], item: Criterion): ScreenOutcome {
  if (item.id === 'HF' || item.id === 'HF2') {
    const line = liveLine(lines, '| CONDITION |');
    if (!line) {
      const missing = item.needs_facts?.[0]?.what ?? 'Heart failure';
      return {
        ok: true, suspected: true,
        result: screenResult({
          lineIds: [lines[0]?.id ?? 'L001'], medicines: ['ibuprofen'], missingFacts: [missing],
          reason: 'The medicine is supplied. The record does not show heart failure.'
        })
      };
    }
    const words = line.text.split('|')[2] ?? '';
    if (/\bNo\b/.test(words)) {
      return { ok: true, suspected: false, result: screenResult({ lineIds: [line.id], missingFacts: [], reason: 'The pharmacist answered no.' }) };
    }
    return {
      ok: true, suspected: true,
      result: screenResult({ lineIds: [line.id], medicines: ['ibuprofen'], missingFacts: [], reason: 'The pharmacist entered the fact.' })
    };
  }
  if (item.id === 'LI') {
    const line = liveLine(lines, 'lithium');
    if (!line) return { ok: true, suspected: false, result: screenResult({ lineIds: [], missingFacts: [], reason: 'No lithium level is on the record yet.' }) };
    return { ok: true, suspected: true, result: screenResult({ lineIds: [line.id], medicines: ['lithium'], missingFacts: [], reason: 'The level is on the record.' }) };
  }
  const line = lines.find(itemLine =>
    itemLine.text.includes('pharmacist at the counter') && !itemLine.text.includes(TAKEN_BACK_MARK) && /\bAge\b/.test(itemLine.text)
  );
  if (!line) return { ok: true, suspected: false, result: screenResult({ lineIds: [], missingFacts: [], reason: 'Age was not entered.' }) };
  return { ok: true, suspected: false, result: screenResult({ lineIds: [line.id], missingFacts: [], reason: 'Age is entered.' }) };
}

function open(criteria: Criterion[]): { engine: Engine; dir: string; screened: string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-ask-'));
  made.push(dir);
  const store = new StateStore(dir);
  store.load();
  const screened: string[] = [];
  const pipeline: PipelineFns = {
    screenCriterion: async (_cfg, _patient, lines, item) => {
      screened.push(item.id);
      return screenOf(lines, item);
    },
    checkFinding: async (_cfg, _patient, _lines, _item, screen) => ({
      confirmed: true, lineIds: screen.lineIds, whatMatches: 'The lines match.', whatCannotBeSeen: 'Nothing more.',
      completed: true, model: 'lantern-check', at: '2026-11-19T00:00:01.000Z', seconds: 1
    }),
    draftLetter: async (_cfg, _patient, lines, _item, finding) => ({
      subject: 'Review',
      body: lines.filter(line => finding.screen.lineIds.includes(line.id)).map(line => line.text).join('\n'),
      origin: 'model',
      checkNotes: [],
      model: 'lantern-letter',
      at: '2026-11-19T00:00:02.000Z',
      seconds: 1
    }),
    transcribePageImage: async () => {
      throw new Error('This step was not part of the question test.');
    }
  };
  const engine = new Engine({
    cfg: testConfig,
    store,
    pipeline,
    images: new PageImages(path.join(dir, 'images')),
    loadCriteria: async () => criteria,
    warmup: false,
    modelsUp: async () => true
  });
  return { engine, dir, screened };
}

async function imported(years: number, rows: { medicine: string; brand: string }[], criteria = ALL): Promise<{ engine: Engine; dir: string; screened: string[] }> {
  const opened = open(criteria);
  await opened.engine.start();
  await opened.engine.importCase({ fileName: 'ask.csv', source: 'csv', csvText: csv(years, rows) });
  await opened.engine.whenIdle();
  return opened;
}

function theCase(engine: Engine): CaseRecord {
  const c = engine.state.cases[0];
  if (!c) throw new Error('No history was imported.');
  return c;
}

function question(engine: Engine, what: string) {
  const q = (theCase(engine).questions ?? []).find(item => item.what === what);
  if (!q) throw new Error(`No question for ${what}.`);
  return q;
}

describe('questions from one history', () => {
  it('asks three distinct questions, and one of them serves two criteria', async () => {
    const { engine, screened } = await imported(72, [
      { medicine: 'ibuprofen', brand: 'Nurofen' },
      { medicine: 'lithium', brand: 'Lithicarb' }
    ]);
    expect(screened.sort()).toEqual(['HF', 'HF2']);
    expect(theCase(engine).screening.criteria.find(run => run.criterionId === 'LI')?.status).toBe('waiting');
    expect(theCase(engine).screening.criteria.find(run => run.criterionId === 'AGE')?.status).toBe('waiting');
    expect(theCase(engine).screening.status).not.toBe('done');
    const questions = theCase(engine).questions ?? [];
    // The ready note repeats this count: this history gives three distinct questions.
    expect(new Set(questions.map(q => q.key)).size).toBe(3);
    expect(questions.map(q => q.what).sort()).toEqual(['Age', 'Heart failure', 'latest lithium level']);
    const shared = question(engine, 'Heart failure');
    expect(shared.criterionIds.sort()).toEqual(['HF', 'HF2']);
    expect(shared.source).toBe('possible');
    expect(shared.options.map(opt => opt.words)).toEqual(['Yes', 'No', 'Not known']);
    expect(question(engine, 'latest lithium level').source).toBe('supply');
    expect(question(engine, 'latest lithium level').needsValue).toBe(true);
    expect(question(engine, 'Age').source).toBe('patient');
    expect(checksNotRun(theCase(engine)).sort()).toEqual(['AGE', 'LI']);
    expect(checksNotRunWords(1)).toBe('1 check could not run until this question is answered.');
    expect(checksNotRunWords(2)).toBe('2 checks could not run until these questions are answered.');
    expect(engine.state.findings.filter(f => f.possible)).toHaveLength(2);
  });

  it('does not ask the lithium question when the age limit does not hold, or when lithium is not supplied', async () => {
    const young = await imported(40, [{ medicine: 'lithium', brand: 'Lithicarb' }]);
    expect((theCase(young.engine).questions ?? []).some(q => q.what === 'latest lithium level')).toBe(false);
    expect(question(young.engine, 'Age').source).toBe('patient');

    const none = await imported(72, [{ medicine: 'ibuprofen', brand: 'Nurofen' }]);
    expect((theCase(none.engine).questions ?? []).some(q => q.what === 'latest lithium level')).toBe(false);
    expect(question(none.engine, 'Heart failure').source).toBe('possible');
  });
});

describe('an answer is a line of the record', () => {
  it('turns Yes into a finding that cites the new line, and the letter shows the fact and not a question', async () => {
    const { engine, screened } = await imported(72, [
      { medicine: 'ibuprofen', brand: 'Nurofen' },
      { medicine: 'lithium', brand: 'Lithicarb' }
    ]);
    const before = engine.state.findings.filter(f => f.criterionId === 'HF' || f.criterionId === 'HF2').map(f => f.id);
    expect(before).toHaveLength(2);
    screened.length = 0;
    const today = dayOf(new Date());
    engine.answerQuestion(theCase(engine).id, question(engine, 'Heart failure').id, { option: 'Yes' });
    await engine.whenIdle();
    expect(screened.sort()).toEqual(['HF', 'HF2']);
    const line = theCase(engine).lines.find(item => item.text.includes('pharmacist at the counter') && !item.text.includes(TAKEN_BACK_MARK));
    expect(line?.text).toBe(`no date | CONDITION | Heart failure. The patient has this. Confirmed by the pharmacist at the counter on ${longDate(today)}. ${PRESENT_THROUGHOUT}`);
    expect(line?.text ?? '').not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(question(engine, 'Heart failure').answer?.words).toBe('Yes');
    const after = engine.state.findings.filter(f => f.criterionId === 'HF' || f.criterionId === 'HF2');
    expect(after).toHaveLength(2);
    expect(after.every(f => f.possible === false && line && f.screen.lineIds.includes(line.id))).toBe(true);
    expect(after.every(f => !before.includes(f.id))).toBe(true);
    expect(question(engine, 'Heart failure').status).toBe('answered');

    engine.decide(after[0].id, { action: 'accept' });
    await engine.whenIdle();
    const letter = engine.state.letters.find(item => item.findingId === after[0].id);
    expect(letter?.body).toContain('pharmacist at the counter');
    expect(letter?.body).toContain('Heart failure');
    expect(letter?.body).not.toContain('| CONDITION | Yes.');
    expect(letter?.body ?? '').not.toMatch(/question/i);
    expect(letter?.body).not.toContain('the patient has heart failure');
  });

  it('removes the possible finding when the answer is No', async () => {
    const { engine } = await imported(72, [{ medicine: 'ibuprofen', brand: 'Nurofen' }], [hf]);
    const id = theCase(engine).id;
    engine.answerQuestion(id, question(engine, 'Heart failure').id, { option: 'No' });
    await engine.whenIdle();
    expect(engine.state.findings.filter(f => f.caseId === id)).toEqual([]);
    expect(theCase(engine).screening.criteria.find(run => run.criterionId === 'HF')?.status).toBe('clear');
    expect(theCase(engine).lines.some(line => line.text.includes(`No heart failure: the patient does not have it. ${PHARMACIST_MARK}`))).toBe(true);
    expect(question(engine, 'Heart failure').answer?.words).toBe('No');
  });

  it('leaves the possible finding when the answer is Not known, and opens the question again', async () => {
    const { engine, screened } = await imported(72, [{ medicine: 'ibuprofen', brand: 'Nurofen' }], [hf]);
    const id = theCase(engine).id;
    const findingId = engine.state.findings[0]?.id;
    screened.length = 0;
    engine.answerQuestion(id, question(engine, 'Heart failure').id, { option: 'Not known' });
    await engine.whenIdle();
    expect(screened).toEqual([]);
    expect(engine.state.findings.map(f => f.id)).toEqual([findingId]);
    expect(engine.state.findings[0]?.possible).toBe(true);
    expect(question(engine, 'Heart failure').status).toBe('not_known');
    expect(question(engine, 'Heart failure').answer?.words).toBe('Not known');
    expect(theCase(engine).lines.some(line => line.text.includes(`Heart failure: not known. ${PHARMACIST_MARK}`))).toBe(true);
    engine.reopenQuestion(id, question(engine, 'Heart failure').id);
    expect(question(engine, 'Heart failure').status).toBe('open');
    expect(theCase(engine).lines.some(line => line.text.includes(TAKEN_BACK_MARK))).toBe(true);
    engine.answerQuestion(id, question(engine, 'Heart failure').id, { option: 'Yes' });
    await engine.whenIdle();
    expect(engine.state.findings.some(f => f.possible === false)).toBe(true);
  });

  it('keeps the possible finding when a Not known answer is taken back', async () => {
    const { engine, screened } = await imported(72, [{ medicine: 'ibuprofen', brand: 'Nurofen' }], [hf]);
    const id = theCase(engine).id;
    const before = engine.state.findings.map(f => structuredClone(f));
    screened.length = 0;
    engine.answerQuestion(id, question(engine, 'Heart failure').id, { option: 'Not known' });
    await engine.whenIdle();
    expect(screened).toEqual([]);
    expect(question(engine, 'Heart failure').status).toBe('not_known');
    engine.takeBackQuestion(id, question(engine, 'Heart failure').id);
    expect(engine.state.findings.map(f => f.id)).toEqual(before.map(f => f.id));
    expect(engine.state.findings[0]?.possible).toBe(true);
    expect(engine.state.findings[0]?.state).toBe(before[0].state);
    expect(engine.state.findings[0]?.decision).toBe(before[0].decision);
    expect(question(engine, 'Heart failure').status).toBe('open');
    expect(theCase(engine).screening.status).toBe('done');
    expect(theCase(engine).lines.some(line => line.text.includes(TAKEN_BACK_MARK))).toBe(true);
    expect(screened).toEqual([]);
  });

  it('screens again from the answer that remains when an earlier answer for the same criterion is taken back', async () => {
    const two = criterion({
      id: 'HF',
      label: 'Two facts',
      needs_facts: [
        { kind: 'condition', what: 'Heart failure', meets: 'the patient has heart failure' },
        { kind: 'condition', what: 'Peptic ulcer', meets: 'the patient has a peptic ulcer' }
      ]
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-ask-'));
    made.push(dir);
    const store = new StateStore(dir);
    store.load();
    const screened: string[] = [];
    const pipeline: PipelineFns = {
      screenCriterion: async (_cfg, _patient, lines) => {
        screened.push('HF');
        const live = lines.filter(line =>
          line.text.includes('pharmacist at the counter') && !line.text.includes(TAKEN_BACK_MARK)
        );
        const heart = live.some(line => line.text.includes('Heart failure'));
        const ulcer = live.some(line => line.text.includes('Peptic ulcer'));
        const missingFacts = [
          ...(heart ? [] : ['Heart failure']),
          ...(ulcer ? [] : ['Peptic ulcer'])
        ];
        const reason = heart && ulcer ? 'both facts' : heart ? 'only heart failure' : ulcer ? 'only peptic ulcer' : 'neither fact';
        return {
          ok: true,
          suspected: true,
          result: screenResult({
            lineIds: live.length > 0 ? live.map(line => line.id) : ['L001'],
            medicines: ['ibuprofen'],
            missingFacts,
            reason
          })
        };
      },
      checkFinding: async (_cfg, _patient, _lines, _item, screen) => ({
        confirmed: true, lineIds: screen.lineIds, whatMatches: 'The lines match.', whatCannotBeSeen: 'Nothing more.',
        completed: true, model: 'lantern-check', at: '2026-11-19T00:00:01.000Z', seconds: 1
      }),
      draftLetter: async () => ({
        subject: 'Review', body: 'A review.', origin: 'model', checkNotes: [],
        model: 'lantern-letter', at: '2026-11-19T00:00:02.000Z', seconds: 1
      }),
      transcribePageImage: async () => {
        throw new Error('This step was not part of the question test.');
      }
    };
    const engine = new Engine({
      cfg: testConfig,
      store,
      pipeline,
      images: new PageImages(path.join(dir, 'images')),
      loadCriteria: async () => [two],
      warmup: false,
      modelsUp: async () => true
    });
    await engine.start();
    await engine.importCase({ fileName: 'ask.csv', source: 'csv', csvText: csv(72, [{ medicine: 'ibuprofen', brand: 'Nurofen' }]) });
    await engine.whenIdle();
    const id = theCase(engine).id;
    expect(engine.state.findings[0]?.screen.reason).toBe('neither fact');
    expect(question(engine, 'Heart failure').criterionIds).toEqual(['HF']);
    expect(question(engine, 'Peptic ulcer').criterionIds).toEqual(['HF']);
    engine.answerQuestion(id, question(engine, 'Heart failure').id, { option: 'Yes' });
    await engine.whenIdle();
    expect(engine.state.findings.find(f => f.criterionId === 'HF')?.screen.reason).toBe('only heart failure');
    engine.answerQuestion(id, question(engine, 'Peptic ulcer').id, { option: 'Yes' });
    await engine.whenIdle();
    const both = engine.state.findings.find(f => f.criterionId === 'HF');
    expect(both?.screen.reason).toBe('both facts');
    if (!both) return;
    engine.decide(both.id, { action: 'accept' });
    await engine.whenIdle();
    const history = engine.state.activity.map(item => item.text);
    expect(history.some(text => text.includes('accepted the finding'))).toBe(true);
    screened.length = 0;
    engine.takeBackQuestion(id, question(engine, 'Heart failure').id);
    expect(theCase(engine).screening.status).toBe('waiting');
    expect(theCase(engine).screening.finishedAt).toBeUndefined();
    expect(theCase(engine).screening.criteria.find(run => run.criterionId === 'HF')?.status).toBe('waiting');
    expect(engine.state.findings.some(f => f.screen.reason === 'neither fact')).toBe(false);
    expect(engine.state.findings.some(f => f.screen.reason === 'both facts')).toBe(false);
    expect(question(engine, 'Heart failure').status).toBe('open');
    expect(question(engine, 'Peptic ulcer').status).toBe('answered');
    expect(question(engine, 'Peptic ulcer').answer?.takenBackAt).toBeUndefined();
    for (const text of history) expect(engine.state.activity.map(item => item.text)).toContain(text);
    await engine.whenIdle();
    expect(screened).toEqual(['HF']);
    const left = engine.state.findings.filter(f => f.criterionId === 'HF');
    expect(left.map(f => f.screen.reason)).toEqual(['only peptic ulcer']);
    expect(left[0]?.decision).toBeUndefined();
    expect(theCase(engine).screening.status).toBe('done');
    expect(theCase(engine).lines.some(line => line.text.includes('Heart failure') && line.text.includes(TAKEN_BACK_MARK))).toBe(true);
    expect(theCase(engine).lines.some(line => line.text.includes('Peptic ulcer') && line.text.includes(TAKEN_BACK_MARK))).toBe(false);
  });

  it('does not count the history as screened when a standing answer is taken back and its criterion is waiting again', async () => {
    const { engine } = await imported(72, [{ medicine: 'ibuprofen', brand: 'Nurofen' }], [age]);
    const id = theCase(engine).id;
    expect(theCase(engine).screening.criteria.find(run => run.criterionId === 'AGE')?.status).toBe('waiting');
    expect(fullyScreened(theCase(engine))).toBe(false);
    engine.answerQuestion(id, question(engine, 'Age').id, { value: '72', unit: 'years', date: '2026-11-02' });
    await engine.whenIdle();
    expect(theCase(engine).screening.criteria.find(run => run.criterionId === 'AGE')?.status).toBe('clear');
    expect(fullyScreened(theCase(engine))).toBe(true);
    engine.takeBackQuestion(id, question(engine, 'Age').id);
    expect(question(engine, 'Age').status).toBe('open');
    expect(theCase(engine).screening.criteria.find(run => run.criterionId === 'AGE')?.status).toBe('waiting');
    expect(theCase(engine).screening.status).toBe('waiting');
    expect(theCase(engine).screening.finishedAt).toBeUndefined();
    expect(fullyScreened(theCase(engine))).toBe(false);
    expect(engine.state.jobs.some(job => job.stage === 'screen' && (job.status === 'queued' || job.status === 'running'))).toBe(false);
  });

  it('does not screen a standing criterion when a possible finding joins the same question', async () => {
    const standing = alwaysFact('STAND', 'Heart failure', 'Start X in patients aged 65 or older with heart failure.');
    const possible = criterion({
      id: 'POSS',
      label: 'Possible',
      needs_facts: [{ kind: 'condition', what: 'Heart failure', meets: 'recorded' }]
    });
    const opened = open([standing, possible]);
    opened.engine.pipeline.screenCriterion = async (_cfg, _patient, lines, item) => {
      opened.screened.push(item.id);
      if (item.id === 'POSS') {
        return {
          ok: true, suspected: true,
          result: screenResult({
            lineIds: [lines[0]?.id ?? 'L001'], medicines: ['ibuprofen'], missingFacts: ['Heart failure'],
            reason: 'The record does not show heart failure.'
          })
        };
      }
      return {
        ok: true, suspected: false,
        result: screenResult({ lineIds: [], missingFacts: [], reason: 'The standing question was released.' })
      };
    };
    await opened.engine.start();
    await opened.engine.importCase({
      fileName: 'ask.csv', source: 'csv',
      csvText: csv(72, [{ medicine: 'ibuprofen', brand: 'Nurofen' }])
    });
    await opened.engine.whenIdle();
    const c = theCase(opened.engine);
    const shared = (c.questions ?? []).find(q => q.what === 'Heart failure');
    expect(opened.screened).toContain('POSS');
    expect(opened.screened).not.toContain('STAND');
    expect(c.screening.criteria.find(run => run.criterionId === 'STAND')?.status).toBe('waiting');
    expect(fullyScreened(c)).toBe(false);
    expect(shared?.criterionIds).toEqual(['STAND', 'POSS']);
    expect(shared?.source).toBe('patient');
    expect(shared?.links).toEqual([
      { criterionId: 'STAND', why: 'patient' },
      { criterionId: 'POSS', why: 'possible' }
    ]);
    expect(checksNotRun(c)).toEqual(['STAND']);
  });

  it('puts the possible finding back when the answer is taken back', async () => {
    const { engine } = await imported(72, [{ medicine: 'ibuprofen', brand: 'Nurofen' }], [hf, hf2]);
    const before = engine.state.findings.map(f => f.id).sort();
    const id = theCase(engine).id;
    engine.answerQuestion(id, question(engine, 'Heart failure').id, { option: 'Yes' });
    await engine.whenIdle();
    engine.takeBackQuestion(id, question(engine, 'Heart failure').id);
    expect(engine.state.findings.map(f => f.id).sort()).toEqual(before);
    expect(engine.state.findings.every(f => f.possible)).toBe(true);
    expect(question(engine, 'Heart failure').status).toBe('open');
    expect(theCase(engine).lines.some(line => line.text.includes(TAKEN_BACK_MARK))).toBe(true);
  });

  it('keeps the answer when the server starts again', async () => {
    const { engine, dir } = await imported(72, [{ medicine: 'ibuprofen', brand: 'Nurofen' }], [hf]);
    engine.answerQuestion(theCase(engine).id, question(engine, 'Heart failure').id, { option: 'Yes' });
    await engine.whenIdle();
    const line = theCase(engine).lines.find(item => item.text.includes('pharmacist at the counter') && !item.text.includes(TAKEN_BACK_MARK))?.text;
    const store = new StateStore(dir);
    store.load();
    const restarted = new Engine({
      cfg: testConfig,
      store,
      pipeline: engine.pipeline,
      images: new PageImages(path.join(dir, 'images')),
      loadCriteria: async () => [hf],
      warmup: false,
      modelsUp: async () => true
    });
    await restarted.start();
    await restarted.whenIdle();
    expect(theCase(restarted).questions?.[0]?.status).toBe('answered');
    expect(theCase(restarted).lines.some(item => item.text === line)).toBe(true);
  });

  it('screens the lithium criterion again when the level is typed, and not the others', async () => {
    const { engine, screened } = await imported(72, [
      { medicine: 'ibuprofen', brand: 'Nurofen' },
      { medicine: 'lithium', brand: 'Lithicarb' }
    ]);
    screened.length = 0;
    const today = dayOf(new Date());
    engine.answerQuestion(theCase(engine).id, question(engine, 'latest lithium level').id, {
      value: '0.8', unit: 'mmol/L', date: '2026-11-01'
    });
    await engine.whenIdle();
    expect(screened).toEqual(['LI']);
    const line = theCase(engine).lines.find(item => item.text.includes('latest lithium level'));
    const written = `2026-11-01 | RESULT | latest lithium level 0.8 mmol/L. Entered by the pharmacist at the counter on ${longDate(today)}.`;
    expect(line?.text).toBe(written);
    const found = engine.state.findings.find(f => f.criterionId === 'LI' && f.screen.lineIds.includes(line?.id ?? ''));
    expect(found).toBeTruthy();
    if (!found) return;
    engine.decide(found.id, { action: 'accept' });
    await engine.whenIdle();
    const letter = engine.state.letters.find(item => item.findingId === found.id);
    expect(letter?.body).toContain(written);
    expect(letter?.body ?? '').not.toContain('no date | RESULT');
  });

  it('stores an option-list button as the fact, then the button words, and keeps the button word on the answer', async () => {
    const opted = criterion({
      id: 'HF',
      label: 'Heart failure test',
      needs_facts: [{
        kind: 'condition',
        what: 'Reason for the loop diuretic',
        meets: 'high blood pressure alone',
        options: [
          { words: 'high blood pressure alone', effect: 'meets' },
          { words: 'for heart failure', effect: 'does_not_meet' },
          { words: 'not known', effect: 'unknown' }
        ]
      }]
    });
    const { engine } = await imported(72, [{ medicine: 'ibuprofen', brand: 'Nurofen' }], [opted]);
    const today = dayOf(new Date());
    engine.answerQuestion(theCase(engine).id, question(engine, 'Reason for the loop diuretic').id, { option: 'high blood pressure alone' });
    const line = theCase(engine).lines.find(item => item.text.includes(PHARMACIST_MARK));
    expect(line?.text).toBe(`no date | CONDITION | Reason for the loop diuretic: high blood pressure alone. ${PHARMACIST_MARK}`);
    expect(question(engine, 'Reason for the loop diuretic').answer?.words).toBe('high blood pressure alone');
  });

  it('stores a typed age and a typed daily dose as a result line with the measure, the value, the unit and the date', async () => {
    const dose = criterion({
      id: 'DOSE',
      label: 'Dose test',
      needs_facts: [{ kind: 'result', what: 'daily dose of digoxin', meets: '125 micrograms or more', ask_when: 'always' }]
    });
    const { engine } = await imported(72, [{ medicine: 'ibuprofen', brand: 'Nurofen' }], [age, dose]);
    const today = dayOf(new Date());
    engine.answerQuestion(theCase(engine).id, question(engine, 'Age').id, { value: '72', unit: 'years', date: '2026-11-02' });
    await engine.whenIdle();
    engine.answerQuestion(theCase(engine).id, question(engine, 'daily dose of digoxin').id, { value: '125', unit: 'micrograms', date: '2026-11-03' });
    await engine.whenIdle();
    const lines = theCase(engine).lines.filter(item => item.text.includes('pharmacist at the counter') && !item.text.includes(TAKEN_BACK_MARK));
    expect(lines.map(item => item.text)).toEqual([
      `2026-11-02 | RESULT | Age 72 years. Entered by the pharmacist at the counter on ${longDate(today)}.`,
      `2026-11-03 | RESULT | daily dose of digoxin 125 micrograms. Entered by the pharmacist at the counter on ${longDate(today)}.`
    ]);
  });
});

describe('a counter answer does not move the record', () => {
  it('keeps the end of a history and the dates note after Yes, No and Not known', () => {
    const csvText = fs.readFileSync(path.join('cases', 'PINCER-1', 'pos-nofact.csv'), 'utf8');
    const history = parseCsv(csvText);
    const item = criterion({
      id: 'PIN',
      label: 'Pin',
      rule_for_models: 'No supply of the named medicine in the last 6 months.',
      needs_facts: [{ kind: 'condition', what: 'Peptic ulcer disease', meets: 'The patient has this.' }]
    });
    const end = latestDate(history.lines);
    const note = datesNote(history.lines, item);
    const supplyEnd = latestSupplyDate(history.lines.map(line => line.text));
    expect(end).toBe('2026-05-06');
    expect(supplyEnd).toBe('2026-05-06');
    expect(note).toContain('The latest date in this record is 2026-05-06.');
    expect(note).toContain('6 months before it is 2025-11-06.');

    const fact = item.needs_facts?.[0];
    if (!fact) throw new Error('The test criterion has no needed fact.');
    const questionFor = (): PharmacistQuestion => ({
      id: 'Q0001', key: 'condition\npeptic ulcer disease', kind: fact.kind, what: fact.what, meets: fact.meets,
      criterionIds: ['PIN'], findingIds: [], source: 'possible', status: 'open',
      options: [
        { words: 'Yes', effect: 'meets' },
        { words: 'No', effect: 'does_not_meet' },
        { words: 'Not known', effect: 'unknown' }
      ],
      needsValue: false
    });
    const linesOf = (option: string): HistoryLine[] => {
      const q = questionFor();
      const chosen = chosenFrom(q, { option }, '2026-11-19').chosen;
      if (!chosen) throw new Error(`No answer for ${option}.`);
      const c = {
        lines: history.lines.map(line => ({ ...line })),
        screening: { status: 'done' as const, criteria: [{ criterionId: 'PIN', status: 'clear' as const }] }
      };
      writeAnswer(c as CaseRecord, [], [], q, chosen, '2026-11-19T12:00:00.000Z');
      return c.lines;
    };
    for (const option of ['Yes', 'No', 'Not known']) {
      const lines = linesOf(option);
      const line = lines.find(item => item.text.includes('pharmacist at the counter'));
      expect(line?.text.startsWith('no date |')).toBe(true);
      expect(line?.text ?? '').not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(latestDate(lines)).toBe(end);
      expect(datesNote(lines, item)).toBe(note);
      expect(latestSupplyDate(lines.map(item => item.text))).toBe(supplyEnd);
    }
    const result: PharmacistQuestion = {
      id: 'Q0002', key: 'result\nlatest lithium level', kind: 'result', what: 'latest lithium level',
      meets: 'above 1 mmol/L', criterionIds: ['PIN'], findingIds: [], source: 'supply', status: 'open',
      needsValue: true, options: defaultOptions('result')
    };
    const dated = chosenFrom(result, { value: '0.8', unit: 'mmol/L', date: '2026-11-01' }, '2026-11-20');
    if (!dated.chosen) throw new Error(dated.error ?? 'No dated result.');
    const undated = chosenFrom(result, { value: '0.8', unit: 'mmol/L', date: '' }, '2026-11-20');
    if (!undated.chosen) throw new Error(undated.error ?? 'No undated result.');
    const recordOf = (chosen: NonNullable<typeof dated.chosen>): HistoryLine[] => {
      const q = { ...result, status: 'open' as const };
      const c = {
        lines: history.lines.map(line => ({ ...line })),
        screening: { status: 'done' as const, criteria: [{ criterionId: 'PIN', status: 'clear' as const }] }
      };
      writeAnswer(c as CaseRecord, [], [], q, chosen, '2026-11-20T12:00:00.000Z');
      return c.lines;
    };
    const datedLines = recordOf(dated.chosen);
    const datedLine = datedLines.find(item => item.text.includes('latest lithium level'));
    expect(datedLine?.text).toBe('2026-11-01 | RESULT | latest lithium level 0.8 mmol/L. Entered by the pharmacist at the counter on 20 November 2026.');
    expect(latestDate(datedLines)).toBe(end);
    expect(latestSupplyDate(datedLines.map(item => item.text))).toBe(supplyEnd);
    expect(datesNote(datedLines, item)).toBe(note);
    const openLines = recordOf(undated.chosen);
    const openLine = openLines.find(item => item.text.includes('latest lithium level'));
    expect(openLine?.text).toBe('no date | RESULT | latest lithium level 0.8 mmol/L. The date of the result is not recorded. Entered by the pharmacist at the counter on 20 November 2026.');
    expect(latestDate(openLines)).toBe(end);
    expect(latestSupplyDate(openLines.map(line => line.text))).toBe(supplyEnd);

    const yes = linesOf('Yes').find(item => item.text.includes('Confirmed by the pharmacist'))?.text;
    expect(yes).toBe(`no date | CONDITION | Peptic ulcer disease. The patient has this. Confirmed by the pharmacist at the counter on 19 November 2026. ${PRESENT_THROUGHOUT}`);
    expect(yes ?? '').not.toMatch(/began on|recorded on/);
    const no = linesOf('No').find(item => item.text.includes(PHARMACIST_MARK))?.text;
    expect(no).toBe(`no date | CONDITION | No peptic ulcer disease: the patient does not have it. ${PHARMACIST_MARK}`);
    const unknown = linesOf('Not known').find(item => item.text.includes(PHARMACIST_MARK))?.text;
    expect(unknown).toBe(`no date | CONDITION | Peptic ulcer disease: not known. ${PHARMACIST_MARK}`);
  });
});

describe('an answer after the letter has gone out', () => {
  it('keeps a sent letter, the reply and the decision when the question is answered', () => {
    const q: PharmacistQuestion = {
      id: 'Q0001', key: 'condition\nheart failure', kind: 'condition', what: 'Heart failure',
      meets: 'The patient has this.', criterionIds: ['HF'], findingIds: ['F0001'],
      source: 'possible', status: 'open', needsValue: false,
      options: [
        { words: 'Yes', effect: 'meets' },
        { words: 'No', effect: 'does_not_meet' },
        { words: 'Not known', effect: 'unknown' }
      ]
    };
    const finding = {
      id: 'F0001', caseId: 'C0001', criterionId: 'HF', state: 'accepted', possible: false, seenByPharmacist: true,
      decision: { action: 'accept', by: 'Pharmacist', at: '2026-11-20T09:00:00.000Z' },
      screen: {
        lineIds: [], medicines: [], reason: 'Heart failure', linesVerified: true, missingFacts: [],
        model: 'test', at: '2026-11-20T09:00:00.000Z', seconds: 0
      }
    } as Finding;
    const reply = { at: '2026-11-20T11:00:00.000Z', outcome: 'will_review' as const, note: 'The doctor will review the patient.' };
    const letters = [
      { id: 'T0001', findingId: 'F0001', caseId: 'C0001', status: 'sent', subject: 'Sent', body: 'The sent letter.', editedByPharmacist: false, seenByPharmacist: true, sentAt: '2026-11-20T10:00:00.000Z', sentBy: 'print' },
      { id: 'T0002', findingId: 'F0001', caseId: 'C0001', status: 'reply_recorded', subject: 'Replied', body: 'The letter with a reply.', editedByPharmacist: false, seenByPharmacist: true, sentAt: '2026-11-20T10:00:00.000Z', reply },
      { id: 'T0003', findingId: 'F0001', caseId: 'C0001', status: 'closed', subject: 'Closed', body: 'The closed letter.', editedByPharmacist: false, seenByPharmacist: true, sentAt: '2026-11-20T10:00:00.000Z', closedAt: '2026-11-20T12:00:00.000Z' }
    ] as Letter[];
    const findings = [finding];
    const c = {
      id: 'C0001',
      lines: [{ id: 'L0001', text: '2026-08-21 | ibuprofen' }],
      screening: { status: 'done' as const, criteria: [{ criterionId: 'HF', status: 'suspected' as const }] }
    };
    const chosen = chosenFrom(q, { option: 'Yes' }, '2026-11-20').chosen;
    if (!chosen) throw new Error('No answer.');
    writeAnswer(c as CaseRecord, findings, letters, q, chosen, '2026-11-20T12:30:00.000Z');
    expect(letters.map(item => item.id)).toEqual(['T0001', 'T0002', 'T0003']);
    expect(letters[0].body).toBe('The sent letter.');
    expect(letters[1].body).toBe('The letter with a reply.');
    expect(letters[1].reply).toEqual(reply);
    expect(letters[2].status).toBe('closed');
    expect(q.heldFindings?.map(item => item.id)).toEqual(['F0001']);
    expect(q.heldFindings?.[0].decision).toEqual(finding.decision);
  });
});

describe('a listed medicine on a supply line', () => {
  it('sets a note in brackets at the end of a brand aside, and does not count a fact line', () => {
    const item = criterion({
      id: 'BR',
      label: 'Brand note',
      medicine_groups: [{
        key: 'A',
        name: 'Perindopril',
        ingredients: ['perindopril'],
        brands: { perindopril: ['Reaptan (with amlodipine)', 'Perindopril (Apo)', 'Temgesic (sublingual tablet)'] }
      }]
    });
    const supply = (text: string): HistoryLine => ({ id: 'L001', text });
    expect(nameForSupplyMatch('Reaptan (with amlodipine)')).toBe('reaptan');
    expect(listedMedicineSupplied([supply('2026-08-08 | Reaptan 5/5 tablet')], item)).toBe(true);
    expect(listedMedicineSupplied([supply('2026-08-08 | Perindopril 5 mg')], item)).toBe(true);
    expect(listedMedicineSupplied([supply('2026-08-08 | Temgesic 200 microgram')], item)).toBe(true);
    expect(listedMedicineSupplied([supply('2026-08-08 | with amlodipine only')], item)).toBe(false);
    expect(listedMedicineSupplied([supply('2026-08-08 | CONDITION | Reaptan is recorded. Entered by the pharmacist at the counter.')], item)).toBe(false);
  });
});

const RAW = {
  id: 'T',
  label: 'Test',
  statement: 'Test wording.',
  rule_for_models: 'Suspect when the named medicine is supplied.',
  medicine_groups: [{ key: 'A', name: 'Lithium', ingredients: ['lithium'], brands: {} }]
};

describe('the age limit on ask_when', () => {
  function ruled(id: string, rule: string, ask: 'always' | { group: string }): Criterion {
    return criterion({
      id,
      label: id,
      rule_for_models: rule,
      medicine_groups: [{ key: 'A', name: 'Digoxin', ingredients: ['digoxin'], brands: { digoxin: ['Lanoxin'] } }],
      needs_facts: [{ kind: 'condition', what: 'Atrial fibrillation', meets: 'recorded', ask_when: ask }]
    });
  }

  it('reads the age words the criteria use', () => {
    const rule = (text: string): Criterion => criterion({ id: 'A', label: 'A', rule_for_models: text });
    expect(ageLimitHolds(rule('people aged 65 years or older'), 30)).toBe(false);
    expect(ageLimitHolds(rule('people aged 65 years or older'), 64)).toBe(false);
    expect(ageLimitHolds(rule('people aged 65 years or older'), 65)).toBe(true);
    expect(ageLimitHolds(rule('a person aged over 65'), 65)).toBe(false);
    expect(ageLimitHolds(rule('a person aged over 65'), 66)).toBe(true);
    expect(ageLimitHolds(rule('65 or older'), 65)).toBe(true);
    expect(ageLimitHolds(rule('aged 65 or over'), 64)).toBe(false);
    expect(ageLimitHolds(rule('aged 75 years and older'), 74)).toBe(false);
    expect(ageLimitHolds(rule('aged 75 years and older'), 75)).toBe(true);
    expect(ageLimitHolds(rule('aged ≥ 65 years'), 64)).toBe(false);
    expect(ageLimitHolds(rule('aged ≥ 65 years'), 65)).toBe(true);
    expect(ageLimitHolds(rule('Suspect when the medicine is supplied.'), 30)).toBe(true);
    expect(ageLimitHolds(rule('aged 65 years or older'), undefined)).toBe(false);
    expect(ageLimitHolds(rule('a child under 18 years'), 17)).toBe(true);
    expect(ageLimitHolds(rule('a child under 18 years'), 18)).toBe(false);
    expect(ageLimitHolds(rule('younger than three years'), 2)).toBe(true);
    expect(ageLimitHolds(rule('younger than three years'), 3)).toBe(false);
    expect(ageLimitHolds(rule('above 65 years'), 65)).toBe(false);
    expect(ageLimitHolds(rule('above 65 years'), 66)).toBe(true);
    expect(ageLimitHolds(rule('at least 18 years'), 17)).toBe(false);
    expect(ageLimitHolds(rule('at least 18 years'), 18)).toBe(true);
    expect(ageLimitHolds(rule('from age 65'), 64)).toBe(false);
    expect(ageLimitHolds(rule('from age 65'), 65)).toBe(true);
    expect(ageLimitHolds(rule('people over 65'), 65)).toBe(false);
    expect(ageLimitHolds(rule('people over 65'), 66)).toBe(true);
    expect(ageLimitHolds(rule('below 18 years'), 17)).toBe(true);
    expect(ageLimitHolds(rule('below 18 years'), 18)).toBe(false);
    expect(ageLimitHolds(rule('18 or under'), 18)).toBe(true);
    expect(ageLimitHolds(rule('18 or under'), 19)).toBe(false);
    // A clearance or a dose is not an age. "CrCl below 30" does not exclude a patient of 72.
    expect(ageLimitHolds(rule('Review when the CrCl is below 30 mL/min and the dose is above 10 mg.'), 72)).toBe(true);
    expect(ageLimitHolds(rule('a child'), 72)).toBe(true);
    expect(readAgeLimit(rule('a child'), 72).note).toBe(AGE_LIMIT_UNREAD);
    expect(readAgeLimit(rule('a child under 18 years'), 10).note).toBeUndefined();
  });

  it('reads a birthday as an age limit', () => {
    const rule = (text: string): Criterion => criterion({ id: 'A', label: 'A', rule_for_models: text });
    expect(ageLimitHolds(rule("before the child's third birthday"), 2)).toBe(true);
    expect(ageLimitHolds(rule("before the child's third birthday"), 3)).toBe(false);
    expect(ageLimitHolds(rule("before the patient's 18th birthday"), 17)).toBe(true);
    expect(ageLimitHolds(rule("before the person's 18th birthday"), 18)).toBe(false);
    expect(ageLimitHolds(rule('before his fifth birthday'), 4)).toBe(true);
    expect(ageLimitHolds(rule('before her 3rd birthday'), 3)).toBe(false);
    expect(ageLimitHolds(rule('before their twentieth birthday'), 19)).toBe(true);
    expect(ageLimitHolds(rule('before their twentieth birthday'), 20)).toBe(false);
    expect(ageLimitHolds(rule('before a child\'s sixth birthday'), 5)).toBe(true);
    expect(ageLimitHolds(rule('before the sixth birthday'), 5)).toBe(true);
    expect(ageLimitHolds(rule('until the sixth birthday'), 6)).toBe(false);
    expect(ageLimitHolds(rule('on or after the 65th birthday'), 64)).toBe(false);
    expect(ageLimitHolds(rule('on or after the 65th birthday'), 65)).toBe(true);
    expect(ageLimitHolds(rule('from the 18th birthday'), 17)).toBe(false);
    expect(ageLimitHolds(rule('from the 18th birthday'), 18)).toBe(true);
    expect(ageLimitHolds(rule('has reached the seventy-fifth birthday'), 74)).toBe(false);
    expect(ageLimitHolds(rule('has reached the seventy-fifth birthday'), 75)).toBe(true);
    expect(ageLimitHolds(rule('has reached the thirtieth birthday'), 29)).toBe(false);
    expect(ageLimitHolds(rule('has reached the thirtieth birthday'), 30)).toBe(true);
    const popi = "Cite the supply when it was for diarrhoea before the child's third birthday. Give no finding for supply on or after the third birthday.";
    expect(ageLimitHolds(rule(popi), 2)).toBe(true);
    expect(ageLimitHolds(rule(popi), 3)).toBe(false);
    expect(ageLimitHolds(rule(popi), 72)).toBe(false);
    expect(readAgeLimit(rule(popi), 2).note).toBeUndefined();
    expect(readAgeLimit(rule('before the third birthday. On or after the third birthday this also applies.'), 2).note).toBe(AGE_LIMIT_UNREAD);
    expect(readAgeLimit(rule("around the child's birthday"), 2).note).toBe(AGE_LIMIT_UNREAD);
    expect(readAgeLimit(rule("before the child's 3th birthday"), 2).note).toBe(AGE_LIMIT_UNREAD);
  });

  it('reads no finding below, under and before age as the same floor as from age', () => {
    const rule = (text: string): Criterion => criterion({ id: 'A', label: 'A', rule_for_models: text });
    for (const text of [
      'Report no finding below age 65.',
      'Report no finding under age 65.',
      'Report no finding before age 65.'
    ]) {
      expect(ageLimitHolds(rule(text), 64)).toBe(false);
      expect(ageLimitHolds(rule(text), 65)).toBe(true);
      expect(readAgeLimit(rule(text), 60).note).toBeUndefined();
      expect(readAgeLimit(rule(text), 72).note).toBeUndefined();
    }
  });

  it('reads From age when the same sentence says no such supply', () => {
    const item = criterion({
      id: 'A',
      label: 'A',
      statement: 'Vitamin D supplement in older people.',
      rule_for_models: 'From age 65, when there is no such supply, suspect an omission.'
    });
    expect(ageLimitHolds(item, 64)).toBe(false);
    expect(ageLimitHolds(item, 65)).toBe(true);
    expect(readAgeLimit(item, 72).note).toBeUndefined();
  });

  it('withholds the START-H5 question at 60 and asks it at 72 with no unread note', async () => {
    const raw = JSON.parse(fs.readFileSync(path.join('criteria', 'START-H5', 'criterion.json'), 'utf8')) as { rule_for_models: string };
    const item = readCriterion(raw, 'START-H5');
    expect(item.rule_for_models).toContain('Report no finding below age 65');
    expect(item.rule_for_models).toContain('From age 65, when there is no such supply');
    expect(readAgeLimit(item, 60)).toEqual({ holds: false });
    expect(readAgeLimit(item, 64)).toEqual({ holds: false });
    expect(readAgeLimit(item, 65)).toEqual({ holds: true });
    expect(readAgeLimit(item, 72)).toEqual({ holds: true });
    const young = await imported(60, [{ medicine: 'metformin', brand: 'Diaformin' }], [item]);
    expect(theCase(young.engine).questions ?? []).toEqual([]);
    const old = await imported(72, [{ medicine: 'metformin', brand: 'Diaformin' }], [item]);
    const asked = question(old.engine, '25-hydroxyvitamin D (25-hydroxycolecalciferol) level');
    expect(asked.source).toBe('patient');
    expect(asked.note).toBeUndefined();
  });

  it('does not ask ask_when always for a patient outside the age limit', async () => {
    const item = ruled('OLD', 'Apply this criterion only to people aged 65 years or older.', 'always');
    const young = await imported(30, [{ medicine: 'metformin', brand: 'Diaformin' }], [item]);
    expect(theCase(young.engine).questions ?? []).toEqual([]);
    expect(young.screened).toEqual(['OLD']);
    expect(theCase(young.engine).screening.criteria[0]?.status).toBe('clear');

    const old = await imported(72, [{ medicine: 'metformin', brand: 'Diaformin' }], [item]);
    expect(question(old.engine, 'Atrial fibrillation').source).toBe('patient');
    expect(theCase(old.engine).screening.criteria[0]?.status).toBe('waiting');
    expect(old.screened).toEqual([]);
  });

  it('does not ask a group question under the age limit, even when the medicine is supplied', async () => {
    const item = ruled('GRP', 'Apply this criterion only to people aged 65 years or older.', { group: 'A' });
    const young = await imported(30, [{ medicine: 'digoxin', brand: 'Lanoxin' }], [item]);
    expect(theCase(young.engine).questions ?? []).toEqual([]);
    expect(young.screened).toEqual(['GRP']);

    const old = await imported(72, [{ medicine: 'digoxin', brand: 'Lanoxin' }], [item]);
    expect(question(old.engine, 'Atrial fibrillation').source).toBe('supply');
    expect(theCase(old.engine).screening.criteria[0]?.status).toBe('waiting');
    expect(old.screened).toEqual([]);
  });

  it('still asks when the age words cannot be read, and says so on the question', async () => {
    const item = ruled('KID', 'Apply this criterion to a child.', 'always');
    const asked = await imported(72, [{ medicine: 'metformin', brand: 'Diaformin' }], [item]);
    const q = question(asked.engine, 'Atrial fibrillation');
    expect(q.source).toBe('patient');
    expect(q.note).toBe(AGE_LIMIT_UNREAD);
    expect(theCase(asked.engine).screening.criteria[0]?.status).toBe('waiting');
  });

  it('answers true, false or unread for every criterion in use, and does not throw', () => {
    const listed = JSON.parse(fs.readFileSync(path.join('criteria', 'active.json'), 'utf8')) as { active?: string[]; further?: string[] };
    const ids = [...(listed.active ?? []), ...(listed.further ?? [])];
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const file = path.join('criteria', id, 'criterion.json');
      if (!fs.existsSync(file)) continue;
      const item = readCriterion(JSON.parse(fs.readFileSync(file, 'utf8')), id);
      for (const age of [undefined, 2, 72]) {
        const read = readAgeLimit(item, age);
        expect(read.holds === true || read.holds === false).toBe(true);
        expect(read.note === undefined || read.note === AGE_LIMIT_UNREAD).toBe(true);
        expect(ageLimitHolds(item, age)).toBe(read.holds);
      }
    }
  });
});

describe('a brand note in brackets', () => {
  it('matches the medicine on the supply line, not the note', async () => {
    const item = criterion({
      id: 'BR',
      label: 'Brand note',
      medicine_groups: [{
        key: 'A', name: 'Perindopril', ingredients: ['perindopril'],
        brands: { perindopril: ['Reaptan (with amlodipine)', 'Perindopril (Apo)'] }
      }],
      needs_facts: [{ kind: 'condition', what: 'Heart failure', meets: 'recorded', ask_when: { group: 'A' } }]
    });
    const group = item.medicine_groups[0];
    expect(groupIsSupplied([{ id: 'L001', text: '2026-08-08 | Reaptan 5/5 tablet' }], group)).toBe(true);
    expect(groupIsSupplied([{ id: 'L001', text: '2026-08-08 | with amlodipine only' }], group)).toBe(false);
    const asked = await imported(72, [{ medicine: 'perindopril', brand: 'Reaptan 5/5' }], [item]);
    expect(question(asked.engine, 'Heart failure').source).toBe('supply');
    const missed = await imported(72, [{ medicine: 'amlodipine', brand: 'Norvasc' }], [item]);
    expect(theCase(missed.engine).questions ?? []).toEqual([]);
    expect(missed.screened).toEqual(['BR']);
  });
});

describe('the criterion file', () => {
  it('reads options and ask_when, and leaves them out of the words the models read', () => {
    const loaded = readCriterion({
      ...RAW,
      needs_facts: [{
        kind: 'condition', what: 'Heart failure', meets: 'present',
        options: [{ words: 'for opioid dependence', effect: 'meets' }],
        ask_when: { group: 'A' }
      }]
    }, 'T');
    expect(loaded.needs_facts?.[0]?.options).toEqual([{ words: 'for opioid dependence', effect: 'meets' }]);
    expect(loaded.needs_facts?.[0]?.ask_when).toEqual({ group: 'A' });
    const block = criterionBlock(loaded);
    expect(block).not.toContain('for opioid dependence');
    expect(block).not.toContain('ask_when');
    expect(block).toContain('FACTS THIS CRITERION NEEDS');
  });

  it('keeps a fact that has no new fields exactly as it was', () => {
    const loaded = readCriterion({
      ...RAW,
      needs_facts: [{ kind: 'result', what: 'eGFR', meets: 'below 30' }]
    }, 'T');
    expect(loaded.needs_facts).toEqual([{ kind: 'result', what: 'eGFR', meets: 'below 30' }]);
  });

  it('refuses a bad option and a bad ask_when', () => {
    expect(() => readCriterion({
      ...RAW,
      needs_facts: [{ kind: 'condition', what: 'Heart failure', meets: 'present', ask_when: 'sometimes' }]
    }, 'T')).toThrow(/ask_when/);
    expect(() => readCriterion({
      ...RAW,
      needs_facts: [{ kind: 'condition', what: 'Heart failure', meets: 'present', ask_when: { group: 'Z' } }]
    }, 'T')).toThrow(/group Z/);
    expect(() => readCriterion({
      ...RAW,
      needs_facts: [{ kind: 'condition', what: 'Heart failure', meets: 'present', options: [{ words: 'Yes', effect: 'maybe' }] }]
    }, 'T')).toThrow(/effect/);
  });
});

function bare(patient: { age?: number; sex?: string }, lines: HistoryLine[] = []): CaseRecord {
  return {
    id: 'C0001', fileName: 'bare.csv', importedAt: '2026-11-20T00:00:00.000Z', source: 'csv',
    patient: { label: 'F-001', ...patient },
    lines, transcriptionConfirmed: true, parts: 1,
    screening: { status: 'waiting', criteria: [] }
  };
}

function alwaysFact(id: string, what: string, rule: string, statement = 'Test wording. This is not a published criterion.'): Criterion {
  return criterion({
    id, label: id, statement, rule_for_models: rule,
    needs_facts: [{ kind: 'condition', what, meets: 'recorded', ask_when: 'always' }]
  });
}

describe('one standing question for one fact', () => {
  it('joins two standing questions that use the same kind and the same words', () => {
    const first = alwaysFact('A1', 'Heart failure', 'Suspect when it is recorded.');
    const second = alwaysFact('A2', 'Heart failure', 'Suspect when it is recorded.');
    const c = bare({ age: 70, sex: 'F' });
    syncCaseQuestions(c, [first, second], [], []);
    expect(c.questions).toHaveLength(1);
    expect(c.questions?.[0]?.criterionIds).toEqual(['A1', 'A2']);
    expect(c.questions?.[0]?.source).toBe('patient');
    expect(c.questions?.[0]?.status).toBe('open');
  });

  it('does not join facts that differ by a few words', () => {
    const c = bare({ age: 70, sex: 'F' });
    syncCaseQuestions(c, [
      alwaysFact('G043', 'Acute bipolar depressive episode', 'Suspect when it is recorded.'),
      alwaysFact('G170', 'Acute bipolar depression', 'Suspect when it is recorded.')
    ], [], []);
    expect(c.questions?.map(q => q.what).sort()).toEqual(['Acute bipolar depression', 'Acute bipolar depressive episode']);
  });
});

describe('a standing question only where the criterion can apply', () => {
  const older = alwaysFact('OLD', 'Falls', 'Apply this criterion only to people aged 65 or older.');
  const woman = alwaysFact('SEX', 'Atrophic vaginitis with symptoms', 'In a woman, suspect the finding.', 'A treatment named for a woman.');
  const both = alwaysFact('BOTH', 'Falls', 'Applies to men and women aged 65 or older.', 'For men and women.');
  const plain = alwaysFact('PLAIN', 'Falls', 'Suspect when the medicine is supplied.', 'Review the management of the supply.');

  function whats(patient: { age?: number; sex?: string }, item: Criterion): string[] {
    const c = bare(patient);
    syncCaseQuestions(c, [item], [], []);
    return (c.questions ?? []).map(q => q.what);
  }

  it('already guards a known age, and still asks when the age is missing', () => {
    expect(ageLimitHolds(older, undefined)).toBe(false);
    expect(standingQuestionApplies(older, { age: 70, sex: 'F' }).ask).toBe(true);
    expect(standingQuestionApplies(older, { age: 30, sex: 'F' }).ask).toBe(false);
    expect(standingQuestionApplies(older, { sex: 'F' }).ask).toBe(true);
    expect(whats({ age: 70, sex: 'F' }, older)).toEqual(['Falls']);
    expect(whats({ age: 30, sex: 'F' }, older)).toEqual([]);
    expect(whats({ sex: 'F' }, older)).toEqual(['Falls']);
  });

  it('does not read a sex limit out of the statement or the rule', () => {
    expect(sexTheCriterionNames(woman)).toBeNull();
    expect(whats({ age: 80, sex: 'M' }, woman)).toEqual(['Atrophic vaginitis with symptoms']);
    expect(whats({ age: 80, sex: 'F' }, woman)).toEqual(['Atrophic vaginitis with symptoms']);
    const exclude = alwaysFact(
      'EX',
      'Heart failure',
      'Start X in patients aged 65 or older with heart failure (exclude pregnant women).',
      'For every adult. Exclude pregnant women.'
    );
    expect(sexTheCriterionNames(exclude)).toBeNull();
    expect(standingQuestionApplies(exclude, { age: 72, sex: 'M' }).ask).toBe(true);
    expect(whats({ age: 72, sex: 'M' }, exclude)).toEqual(['Heart failure']);
    expect(whats({ age: 72, sex: 'F' }, exclude)).toEqual(['Heart failure']);
  });

  it('withholds a standing question only when only_sex names the other sex', () => {
    const female: Criterion = {
      ...alwaysFact('SEX', 'Atrophic vaginitis with symptoms', 'Suspect the finding.', 'A treatment named for one sex.'),
      only_sex: 'female'
    };
    const male: Criterion = { ...female, id: 'MAN', only_sex: 'male' };
    expect(sexTheCriterionNames(female)).toBe('female');
    expect(sexTheCriterionNames(male)).toBe('male');
    expect(whats({ age: 80, sex: 'F' }, female)).toEqual(['Atrophic vaginitis with symptoms']);
    expect(whats({ age: 80, sex: 'female' }, female)).toEqual(['Atrophic vaginitis with symptoms']);
    expect(whats({ age: 80, sex: 'M' }, female)).toEqual([]);
    expect(whats({ age: 80, sex: 'male' }, female)).toEqual([]);
    expect(whats({ age: 80 }, female)).toEqual(['Atrophic vaginitis with symptoms']);
    expect(whats({ sex: 'M' }, female)).toEqual([]);
    expect(whats({ age: 80, sex: 'F' }, male)).toEqual([]);
    expect(whats({ age: 80, sex: 'M' }, male)).toEqual(['Atrophic vaginitis with symptoms']);
    const older: Criterion = {
      ...alwaysFact('SEX65', 'Atrophic vaginitis with symptoms', 'Apply this item only to people aged 65 or older.'),
      only_sex: 'female'
    };
    expect(whats({ age: 40, sex: 'F' }, older)).toEqual([]);
    expect(whats({ age: 80, sex: 'F' }, older)).toEqual(['Atrophic vaginitis with symptoms']);
  });

  it('does not treat men and women as one sex, and does not read management as man', () => {
    expect(sexTheCriterionNames(both)).toBeNull();
    expect(sexTheCriterionNames(plain)).toBeNull();
    expect(whats({ age: 70, sex: 'M' }, both)).toEqual(['Falls']);
    expect(whats({ age: 40, sex: 'M' }, plain)).toEqual(['Falls']);
  });

  it('still asks when the age words cannot be read and the age is missing', () => {
    const item = alwaysFact('KID', 'Falls', 'Apply this criterion to a child.');
    const c = bare({ sex: 'F' });
    syncCaseQuestions(c, [item], [], []);
    expect(c.questions?.[0]?.note).toBe(AGE_LIMIT_UNREAD);
    expect(standingQuestionApplies(item, { sex: 'F' }).note).toBe(AGE_LIMIT_UNREAD);
  });

  it('does not ask a group question when the age is missing', () => {
    const c = bare({ sex: 'F' }, [{ id: 'L001', text: '2026-08-08 | lithium 250 mg tablet' }]);
    syncCaseQuestions(c, [lithium], [], []);
    expect(c.questions ?? []).toEqual([]);
  });

  it('asks a standing question through the engine when the history has no age', async () => {
    const item = alwaysFact('OLD', 'Falls', 'Apply this criterion only to people aged 65 or older.');
    const opened = open([item]);
    await opened.engine.start();
    const head = 'patient_ref,patient_age,patient_sex,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber';
    await opened.engine.importCase({
      fileName: 'no-age.csv', source: 'csv',
      csvText: `${head}\nF-001,,F,2026-08-08,metformin,Diaformin,500 mg,tablet,30,1,one daily,Dr A. Example\n`
    });
    await opened.engine.whenIdle();
    expect(question(opened.engine, 'Falls').source).toBe('patient');
    expect(theCase(opened.engine).screening.criteria[0]?.status).toBe('waiting');
    expect(opened.screened).toEqual([]);
  });

  it('does not ask a woman-only standing question of a man', async () => {
    const asking: Criterion = {
      ...alwaysFact(
        'WOMAN',
        'Atrophic vaginitis with symptoms',
        'Apply this item only to people aged 65 or older. In a woman, suspect the finding.',
        'A treatment named for a woman.'
      ),
      only_sex: 'female'
    };
    const man = await imported(80, [{ medicine: 'metformin', brand: 'Diaformin' }], [asking]);
    const maleCsv = csv(80, [{ medicine: 'metformin', brand: 'Diaformin' }]).replace(',F,', ',M,');
    const opened = open([asking]);
    await opened.engine.start();
    await opened.engine.importCase({ fileName: 'man.csv', source: 'csv', csvText: maleCsv });
    await opened.engine.whenIdle();
    expect(theCase(man.engine).patient.sex).toBe('F');
    expect(question(man.engine, 'Atrophic vaginitis with symptoms').source).toBe('patient');
    expect(theCase(opened.engine).patient.sex).toBe('M');
    expect(theCase(opened.engine).questions ?? []).toEqual([]);
    expect(opened.screened).toEqual(['WOMAN']);
  });

  it('still asks a man when the words name women and only_sex is absent', async () => {
    const asking = alwaysFact(
      'WOMAN',
      'Heart failure',
      'Start X in patients aged 65 or older with heart failure (exclude pregnant women).',
      'For every adult. Exclude pregnant women.'
    );
    const opened = open([asking]);
    await opened.engine.start();
    await opened.engine.importCase({
      fileName: 'man.csv', source: 'csv',
      csvText: csv(72, [{ medicine: 'metformin', brand: 'Diaformin' }]).replace(',F,', ',M,')
    });
    await opened.engine.whenIdle();
    expect(theCase(opened.engine).patient.sex).toBe('M');
    expect(question(opened.engine, 'Heart failure').source).toBe('patient');
    expect(opened.screened).toEqual([]);
  });
});

describe('leaving standing questions unanswered', () => {
  it('keeps them open, writes no answer, and shows them again', () => {
    const c = bare({ age: 72, sex: 'F' });
    const standing = alwaysFact('OLD', 'Falls', 'Apply this criterion only to people aged 65 or older.');
    syncCaseQuestions(c, [standing, age], [], []);
    const before = c.lines.length;
    const changed = leaveStanding(c);
    expect(changed.map(q => q.what)).toEqual(['Falls']);
    const falls = c.questions?.find(q => q.what === 'Falls');
    expect(falls?.status).toBe('open');
    expect(falls?.leftUnanswered).toBe(true);
    expect(c.questions?.find(q => q.what === 'Age')?.leftUnanswered).toBeUndefined();
    expect(c.lines).toHaveLength(before);
    expect(checksNotRun(c).sort()).toEqual(['AGE', 'OLD']);
    expect(showStanding(c).map(q => q.what)).toEqual(['Falls']);
    expect(falls?.leftUnanswered).toBeUndefined();
  });

  it('does not hide a question a possible finding is waiting on', () => {
    const standing = alwaysFact('A', 'Heart failure', 'Start X in patients aged 65 or older with heart failure.');
    const waiting = criterion({
      id: 'B',
      label: 'B',
      needs_facts: [{ kind: 'condition', what: 'Heart failure', meets: 'recorded' }]
    });
    const finding: Finding = {
      id: 'F0002', caseId: 'C0001', criterionId: 'B', state: 'suspected', possible: true,
      seenByPharmacist: false,
      screen: screenResult({
        lineIds: ['L001'], medicines: ['ibuprofen'], missingFacts: ['Heart failure'],
        reason: 'The record does not show it.'
      })
    };
    const c = bare({ age: 72, sex: 'M' }, [{ id: 'L001', text: '2026-08-08 | Nurofen 200 mg tablet' }]);
    syncCaseQuestions(c, [standing], [], []);
    leaveStanding(c);
    expect(c.questions?.[0]?.source).toBe('patient');
    expect(c.questions?.[0]?.leftUnanswered).toBe(true);
    syncCaseQuestions(c, [standing, waiting], [finding], c.questions ?? []);
    const shared = c.questions?.find(q => q.what === 'Heart failure');
    // A possible finding joins the question. The standing criterion keeps its own link.
    expect(shared?.source).toBe('patient');
    expect(shared?.links).toEqual([
      { criterionId: 'A', why: 'patient' },
      { criterionId: 'B', why: 'possible' }
    ]);
    expect(checksNotRun(c)).toEqual(['A']);
    expect(shared?.criterionIds).toEqual(['A', 'B']);
    expect(shared?.findingIds).toEqual(['F0002']);
    expect(shared?.leftUnanswered).toBeUndefined();
    expect(leaveStanding(c)).toEqual([]);
    expect(shared?.leftUnanswered).toBeUndefined();

    const kept: CaseRecord = bare({ age: 72, sex: 'F' });
    kept.questions = [{
      id: 'Q0009', key: 'condition\nheart failure', kind: 'condition', what: 'Heart failure', meets: 'recorded',
      criterionIds: ['A', 'B'], findingIds: ['F0002'], source: 'patient', status: 'open',
      options: defaultOptions('condition'), needsValue: false
    }];
    expect(leaveStanding(kept)).toEqual([]);
    expect(kept.questions?.[0]?.leftUnanswered).toBeUndefined();
    expect(kept.questions?.[0]?.source).toBe('patient');
  });

  it('does the same through the engine, and does not wait for the screen to finish', async () => {
    const item = alwaysFact('OLD', 'Falls', 'Apply this criterion only to people aged 65 or older.');
    const { engine } = await imported(72, [{ medicine: 'metformin', brand: 'Diaformin' }], [item, age]);
    const id = theCase(engine).id;
    const before = theCase(engine).lines.length;
    const changed = engine.leaveStandingQuestions(id, {});
    expect(changed.map(q => q.what)).toEqual(['Falls']);
    expect(question(engine, 'Falls').status).toBe('open');
    expect(question(engine, 'Falls').leftUnanswered).toBe(true);
    expect(question(engine, 'Age').leftUnanswered).toBeUndefined();
    expect(theCase(engine).lines).toHaveLength(before);
    expect(checksNotRun(theCase(engine)).sort()).toEqual(['AGE', 'OLD']);
    engine.leaveStandingQuestions(id, { show: true });
    expect(question(engine, 'Falls').leftUnanswered).toBeUndefined();
    expect(() => engine.leaveStandingQuestions('C9999', {})).toThrow(/not found/);
  });
});

describe('a taken-back line stays out of the models', () => {
  it('returns the same array when nothing was taken back, and drops only the marked line', () => {
    const lines: HistoryLine[] = [
      { id: 'L001', text: '2026-08-08 | metformin 500 mg tablet' },
      { id: 'L002', text: `no date | CONDITION | Heart failure. The patient has this. ${PHARMACIST_MARK}` }
    ];
    expect(linesForModels(lines)).toBe(lines);
    const marked: HistoryLine[] = [
      lines[0],
      { id: 'L002', text: `${lines[1].text} ${TAKEN_BACK_MARK}` },
      { id: 'L003', text: `no date | CONDITION | No heart failure: the patient does not have it. ${PHARMACIST_MARK}` }
    ];
    const out = linesForModels(marked);
    expect(out).not.toBe(marked);
    expect(out.map(line => line.id)).toEqual(['L001', 'L003']);
  });

  it('passes the No to the next screen and keeps the taken-back Yes on the history', async () => {
    const seen: { screen: string[][]; check: string[][] } = { screen: [], check: [] };
    const opened = open([hf]);
    const screen = opened.engine.pipeline.screenCriterion;
    const check = opened.engine.pipeline.checkFinding;
    opened.engine.pipeline.screenCriterion = async (cfg, patient, lines, item, signal) => {
      seen.screen.push(lines.map(line => line.text));
      return screen(cfg, patient, lines, item, signal);
    };
    opened.engine.pipeline.checkFinding = async (cfg, patient, lines, item, result, signal) => {
      seen.check.push(lines.map(line => line.text));
      return check(cfg, patient, lines, item, result, signal);
    };
    await opened.engine.start();
    await opened.engine.importCase({
      fileName: 'ask.csv', source: 'csv',
      csvText: csv(72, [{ medicine: 'ibuprofen', brand: 'Nurofen' }])
    });
    await opened.engine.whenIdle();
    const id = theCase(opened.engine).id;
    opened.engine.answerQuestion(id, question(opened.engine, 'Heart failure').id, { option: 'Yes' });
    await opened.engine.whenIdle();
    opened.engine.takeBackQuestion(id, question(opened.engine, 'Heart failure').id);
    seen.screen.length = 0;
    seen.check.length = 0;
    opened.engine.answerQuestion(id, question(opened.engine, 'Heart failure').id, { option: 'No' });
    await opened.engine.whenIdle();
    const last = seen.screen.at(-1) ?? [];
    expect(last.some(text => text.includes(TAKEN_BACK_MARK))).toBe(false);
    expect(last.some(text => text.includes('No heart failure: the patient does not have it'))).toBe(true);
    expect(theCase(opened.engine).lines.some(line => line.text.includes(TAKEN_BACK_MARK))).toBe(true);
    expect(theCase(opened.engine).lines.some(line => line.text.includes('No heart failure: the patient does not have it'))).toBe(true);
    expect(seen.check.every(lines => lines.every(text => !text.includes(TAKEN_BACK_MARK)))).toBe(true);
  });
});

describe('an answer stays on its own history', () => {
  it('does not copy the answer when a second history of the same patient is brought in', async () => {
    const { engine } = await imported(72, [{ medicine: 'ibuprofen', brand: 'Nurofen' }], [hf]);
    engine.answerQuestion(theCase(engine).id, question(engine, 'Heart failure').id, { option: 'Yes' });
    await engine.whenIdle();
    await engine.importCase({
      fileName: 'ask-again.csv', source: 'csv',
      csvText: csv(72, [{ medicine: 'ibuprofen', brand: 'Nurofen' }])
    });
    await engine.whenIdle();
    expect(engine.state.cases).toHaveLength(2);
    expect(engine.state.cases[0]?.patient.label).toBe(engine.state.cases[1]?.patient.label);
    expect(engine.state.cases[0]?.questions?.some(q => q.status === 'answered')).toBe(true);
    expect(engine.state.cases[1]?.questions?.some(q => q.status === 'answered')).toBe(false);
    expect(engine.state.cases[1]?.lines.some(line => line.text.includes('pharmacist at the counter'))).toBe(false);
  });
});

describe('close_when', () => {
  function standing(close: { group: string; months?: number } | undefined, ask: 'always' | { group: string } = 'always'): Criterion {
    return criterion({
      id: 'ST',
      label: 'Start test',
      needs_facts: [{
        kind: 'condition', what: 'Heart failure', meets: 'recorded', ask_when: ask,
        ...(close ? { close_when: close } : {})
      }]
    });
  }

  function asked(lines: HistoryLine[], item: Criterion, findings: Finding[] = []): string[] {
    const c = bare({ age: 72, sex: 'F' }, lines);
    syncCaseQuestions(c, [item], findings, []);
    return (c.questions ?? []).map(q => `${q.source}:${q.what}`);
  }

  const supply: HistoryLine = { id: 'L001', text: '2026-08-08 | Nurofen 200 mg tablet' };
  const factOnly: HistoryLine = { id: 'L001', text: '2026-08-08 | CONDITION | takes Nurofen' };
  const takenBack: HistoryLine = { id: 'L001', text: `2026-08-08 | Nurofen 200 mg tablet. ${TAKEN_BACK_MARK}` };
  const other: HistoryLine = { id: 'L001', text: '2026-08-08 | Diaformin 500 mg tablet' };

  it('is not put when that group is supplied, and is put when it is not', () => {
    const item = standing({ group: 'A' });
    expect(asked([supply], item)).toEqual([]);
    expect(asked([other], item)).toEqual(['patient:Heart failure']);
    expect(asked([], item)).toEqual(['patient:Heart failure']);
  });

  it('does not count a fact line or a taken-back line as a supply', () => {
    const item = standing({ group: 'A' });
    expect(asked([factOnly], item)).toEqual(['patient:Heart failure']);
    expect(asked([takenBack], item)).toEqual(['patient:Heart failure']);
    expect(asked([factOnly, supply], item)).toEqual([]);
  });

  it('closes only a supply in the calendar months ending on the newest supply date', () => {
    const latest: HistoryLine = { id: 'L002', text: '2026-08-08 | Diaformin 500 mg tablet' };
    const old: HistoryLine = { id: 'L001', text: '2025-10-01 | Nurofen 200 mg tablet' };
    const onCut: HistoryLine = { id: 'L001', text: '2026-02-08 | Nurofen 200 mg tablet' };
    const beforeCut: HistoryLine = { id: 'L001', text: '2026-02-07 | Nurofen 200 mg tablet' };
    expect(asked([old, latest], standing({ group: 'A' }))).toEqual(['patient:Heart failure']);
    expect(asked([old, latest], standing({ group: 'A', months: 6 }))).toEqual(['patient:Heart failure']);
    expect(asked([old, latest], standing({ group: 'A', months: 12 }))).toEqual([]);
    expect(asked([onCut, latest], standing({ group: 'A' }))).toEqual([]);
    expect(asked([beforeCut, latest], standing({ group: 'A' }))).toEqual(['patient:Heart failure']);
    const recent: HistoryLine = { id: 'L001', text: '2026-03-01 | Nurofen 200 mg tablet' };
    const laterFact: HistoryLine = { id: 'L003', text: '2026-11-01 | CONDITION | A later fact' };
    expect(asked([recent, laterFact], standing({ group: 'A' }))).toEqual([]);
  });

  it('matches the product as whole words, not a direction and not a name inside another name', () => {
    const iron = criterion({
      id: 'ST',
      label: 'Iron test',
      medicine_groups: [{ key: 'A', name: 'Iron', ingredients: ['iron'], brands: { iron: ['Ferro-Tab'] } }],
      needs_facts: [{
        kind: 'condition', what: 'Iron deficiency', meets: 'recorded', ask_when: 'always', close_when: { group: 'A' }
      }]
    });
    const spiro: HistoryLine = {
      id: 'L001',
      text: '2026-08-08 | Spiractin (spironolactone) 25 mg tablet | qty 100 | repeats 5 | Take ONE daily | Dr A. Example'
    };
    expect(asked([spiro], iron)).toEqual(['patient:Iron deficiency']);
    const named: HistoryLine = {
      id: 'L001',
      text: '2026-08-08 | Ferro-Tab (iron) 300 mg tablet | qty 30 | repeats 0 | Take ONE daily | Dr A. Example'
    };
    expect(asked([named], iron)).toEqual([]);
    const avoid: HistoryLine = {
      id: 'L001',
      text: '2026-08-08 | Lipitor (atorvastatin) 40 mg tablet | qty 30 | repeats 0 | Take ONE at night; avoid ibuprofen | Dr A. Example'
    };
    expect(asked([avoid], standing({ group: 'A' }))).toEqual(['patient:Heart failure']);
  });

  it('ignores the field unless ask_when is always, and a possible finding is still asked', () => {
    expect(asked([supply], standing({ group: 'A' }, { group: 'A' }))).toEqual(['supply:Heart failure']);
    const plain = criterion({
      id: 'HF',
      label: 'Heart failure test',
      needs_facts: [{ kind: 'condition', what: 'Heart failure', meets: 'recorded', close_when: { group: 'A' } }]
    });
    const finding: Finding = {
      id: 'F0001', caseId: 'C0001', criterionId: 'HF', state: 'suspected', possible: true,
      seenByPharmacist: false,
      screen: screenResult({
        lineIds: ['L001'], medicines: ['ibuprofen'], missingFacts: ['Heart failure'],
        reason: 'The record does not show it.'
      })
    };
    expect(asked([supply], plain, [finding])).toEqual(['possible:Heart failure']);
  });

  it('still screens the criterion when the standing question is not put', async () => {
    const item = standing({ group: 'A' });
    const supplied = await imported(72, [{ medicine: 'ibuprofen', brand: 'Nurofen' }], [item]);
    expect(theCase(supplied.engine).questions ?? []).toEqual([]);
    expect(supplied.screened).toEqual(['ST']);
    const waiting = await imported(72, [{ medicine: 'metformin', brand: 'Diaformin' }], [item]);
    expect(question(waiting.engine, 'Heart failure').source).toBe('patient');
    expect(waiting.screened).toEqual([]);
  });

  it('reads the field, leaves it out of the words the models read, and refuses a group the criterion does not name', () => {
    const loaded = readCriterion({
      ...RAW,
      needs_facts: [{
        kind: 'condition', what: 'Heart failure', meets: 'present',
        ask_when: 'always', close_when: { group: 'A' }
      }]
    }, 'T');
    expect(loaded.needs_facts?.[0]?.close_when).toEqual({ group: 'A' });
    expect(criterionBlock(loaded)).not.toContain('close_when');
    const withMonths = readCriterion({
      ...RAW,
      needs_facts: [{
        kind: 'condition', what: 'Heart failure', meets: 'present',
        ask_when: 'always', close_when: { group: 'A', months: 12 }
      }]
    }, 'T');
    expect(withMonths.needs_facts?.[0]?.close_when).toEqual({ group: 'A', months: 12 });
    expect(() => readCriterion({
      ...RAW,
      needs_facts: [{ kind: 'condition', what: 'Heart failure', meets: 'present', close_when: { group: 'A', months: 0 } }]
    }, 'T')).toThrow(/months/);
    expect(() => readCriterion({
      ...RAW,
      needs_facts: [{ kind: 'condition', what: 'Heart failure', meets: 'present', close_when: { group: 'A', months: 6.5 } }]
    }, 'T')).toThrow(/months/);
    const plain = readCriterion({
      ...RAW,
      needs_facts: [{ kind: 'result', what: 'eGFR', meets: 'below 30' }]
    }, 'T');
    expect(plain.needs_facts).toEqual([{ kind: 'result', what: 'eGFR', meets: 'below 30' }]);
    expect(() => readCriterion({
      ...RAW,
      needs_facts: [{ kind: 'condition', what: 'Heart failure', meets: 'present', close_when: { group: 'Z' } }]
    }, 'T')).toThrow(/close_when/);
    expect(() => readCriterion({
      ...RAW,
      needs_facts: [{ kind: 'condition', what: 'Heart failure', meets: 'present', close_when: 'A' }]
    }, 'T')).toThrow(/close_when/);
  });

  it('reads only_sex, leaves it out of the words the models read, and refuses any other value', () => {
    const statement = 'Start X in patients aged 65 or older with heart failure (exclude pregnant women).';
    const withSex = readCriterion({ ...RAW, statement, only_sex: 'female' }, 'T');
    const without = readCriterion({ ...RAW, statement }, 'T');
    expect(withSex.only_sex).toBe('female');
    expect(without.only_sex).toBeUndefined();
    expect(criterionBlock(withSex)).toBe(criterionBlock(without));
    expect(criterionBlock(withSex)).not.toContain('only_sex');
    expect(readCriterion({ ...RAW, only_sex: 'male' }, 'T').only_sex).toBe('male');
    expect(() => readCriterion({ ...RAW, only_sex: 'both' }, 'T')).toThrow(/only_sex/);
    expect(() => readCriterion({ ...RAW, only_sex: 'women' }, 'T')).toThrow(/only_sex/);
    expect(() => readCriterion({ ...RAW, only_sex: '' }, 'T')).toThrow(/only_sex/);
  });
});

describe('groupSuppliedRecently', () => {
  const group = {
    key: 'A', name: 'The medicine', ingredients: ['ibuprofen'], brands: { ibuprofen: ['Nurofen'] }
  };
  const line = (text: string, id = 'L001'): HistoryLine => ({ id, text });
  const nurofen = line('2026-08-08 | Nurofen 200 mg tablet');

  it('is false when there is no group, no whole number of months, or no date the count can use', () => {
    expect(groupSuppliedRecently([nurofen], undefined, 6)).toBe(false);
    expect(groupSuppliedRecently([nurofen], group, 0)).toBe(false);
    expect(groupSuppliedRecently([nurofen], group, 1.5)).toBe(false);
    expect(groupSuppliedRecently([nurofen], group, -3)).toBe(false);
    expect(groupSuppliedRecently([], group, 6)).toBe(false);
    expect(groupSuppliedRecently([line('Nurofen 200 mg tablet')], group, 6)).toBe(false);
    expect(groupSuppliedRecently([line('2026-02-31 | Nurofen 200 mg tablet')], group, 6)).toBe(false);
    expect(groupSuppliedRecently([nurofen], group, 2000)).toBe(false);
    expect(groupSuppliedRecently([nurofen], { key: 'A', name: 'None', ingredients: [], brands: {} }, 6)).toBe(false);
    expect(groupSuppliedRecently([nurofen], {
      key: 'A', name: 'Short', ingredients: ['ib'], brands: { ib: ['Nu'] }
    }, 6)).toBe(false);
  });

  it('does not count a counter line, a fact, or a line the pharmacist took back', () => {
    const later = line('2026-08-08 | Diaformin 500 mg tablet', 'L002');
    const counter = line(`2026-05-01 | Nurofen 200 mg tablet. ${PHARMACIST_MARK}`);
    expect(groupSuppliedRecently([counter, later], group, 6)).toBe(false);
    expect(groupSuppliedRecently([line('2026-05-01 | CONDITION | takes Nurofen'), later], group, 6)).toBe(false);
    expect(groupSuppliedRecently([
      line(`2026-05-01 | Nurofen 200 mg tablet. ${TAKEN_BACK_MARK}`), later
    ], group, 6)).toBe(false);
    expect(groupSuppliedRecently([line('2026-05-01 | Nurofen 200 mg tablet'), later], group, 6)).toBe(true);
  });

  it('counts a supply on the cut, and a brand whose note in brackets is set aside', () => {
    const end = line('2026-08-08 | Diaformin 500 mg tablet', 'L002');
    expect(groupSuppliedRecently([line('2026-02-08 | Nurofen 200 mg tablet'), end], group, 6)).toBe(true);
    expect(groupSuppliedRecently([line('2026-02-07 | Nurofen 200 mg tablet'), end], group, 6)).toBe(false);
    const noted = {
      key: 'A', name: 'The combination', ingredients: ['perindopril'],
      brands: { perindopril: ['Reaptan (with amlodipine)'] }
    };
    expect(groupSuppliedRecently([line('2026-08-08 | Reaptan 10/10 tablet')], noted, 6)).toBe(true);
    expect(groupSuppliedRecently([
      line('2026-08-08 | Lipitor 40 mg tablet | qty 30 | Take ONE; avoid ibuprofen')
    ], group, 6)).toBe(false);
  });
});

describe('the question helpers the page and the engine share', () => {
  function asked(over: Partial<PharmacistQuestion> = {}): PharmacistQuestion {
    return {
      id: 'Q0001', key: 'condition\nheart failure', kind: 'condition', what: 'Heart failure', meets: 'recorded',
      criterionIds: ['HF'], findingIds: [], source: 'possible', status: 'answered',
      options: defaultOptions('condition'), needsValue: false,
      ...over
    };
  }

  function oneCase(): CaseRecord {
    return {
      id: 'C0001', fileName: 'h.csv', importedAt: '2026-11-18T00:00:00.000Z', source: 'csv',
      patient: { label: 'Fictional patient F-001' }, lines: [], transcriptionConfirmed: true, parts: 1,
      screening: { status: 'done', criteria: [] }
    };
  }

  function oneFinding(id: string, criterionId: string, caseId = 'C0001'): Finding {
    return {
      id, caseId, criterionId, state: 'suspected', possible: true,
      screen: { lineIds: ['L001'], medicines: [], reason: 'x', linesVerified: true, missingFacts: ['Heart failure'], model: 'm', at: '', seconds: 1 },
      seenByPharmacist: false
    };
  }

  it('builds one key, and the buttons a result gets are not the buttons a condition gets', () => {
    expect(factKey('condition', '  Heart Failure ')).toBe('condition\nheart failure');
    expect(factKey('Result', 'eGFR')).toBe('Result\negfr');
    expect(defaultOptions('result')).toEqual([{ words: 'Not known', effect: 'unknown' }]);
    expect(defaultOptions('condition')).toEqual([
      { words: 'Yes', effect: 'meets' },
      { words: 'No', effect: 'does_not_meet' },
      { words: 'Not known', effect: 'unknown' }
    ]);
    expect(defaultOptions('observation')).toEqual(defaultOptions('condition'));
  });

  it('asks for a typed value only for a result, the age, or a daily dose, and not when the fact has its own buttons', () => {
    expect(needsAValue({ kind: 'result', what: 'eGFR' })).toBe(true);
    expect(needsAValue({ kind: 'result', what: 'eGFR', options: [] })).toBe(true);
    expect(needsAValue({ kind: 'result', what: 'eGFR', options: [{ words: 'Not known', effect: 'unknown' }] })).toBe(false);
    expect(needsAValue({ kind: 'condition', what: '  AGE  ' })).toBe(true);
    expect(needsAValue({ kind: 'observation', what: 'daily dose of digoxin' })).toBe(true);
    expect(needsAValue({ kind: 'condition', what: 'Daily doses yesterday' })).toBe(true);
    expect(needsAValue({ kind: 'condition', what: 'Heart failure' })).toBe(false);
    expect(needsAValue({ kind: 'observation', what: 'Blood pressure' })).toBe(false);
  });

  it('counts an ask-when answer only when that criterion was answered, and a possible finding does not count', () => {
    const c = oneCase();
    expect(askWhenAnswered(c, 'HF')).toBe(false);
    c.questions = [
      asked({ status: 'open', source: 'supply' }),
      asked({ id: 'Q0002', status: 'answered', source: 'possible', criterionIds: ['HF'] }),
      asked({ id: 'Q0003', status: 'answered', source: 'supply', criterionIds: ['LI'] })
    ];
    expect(askWhenAnswered(c, 'HF')).toBe(false);
    c.questions.push(asked({ id: 'Q0004', status: 'answered', source: 'patient', criterionIds: ['OTHER', 'HF'] }));
    expect(askWhenAnswered(c, 'HF')).toBe(true);
    expect(askWhenAnswered(c, 'ZZ')).toBe(false);
  });

  it('writes the fact from the button, and a typed value is the words the pharmacist typed', () => {
    const yes = { words: 'Yes', effect: 'meets' as const, date: '2026-11-19' };
    const no = { words: 'No', effect: 'does_not_meet' as const, date: '2026-11-19' };
    const unknown = { words: 'Not known', effect: 'unknown' as const, date: '2026-11-19' };
    expect(factLineDetail(asked(), yes)).toBe('Heart failure');
    expect(factLineDetail(asked(), no)).toBe('No heart failure: the patient does not have it');
    expect(factLineDetail(asked(), unknown)).toBe('Heart failure: not known');
    expect(factLineDetail(asked({ what: '' }), no)).toBe('No : the patient does not have it');
    const custom = asked({
      options: [
        { words: 'high blood pressure alone', effect: 'meets' },
        { words: 'not known', effect: 'unknown' }
      ]
    });
    expect(factLineDetail(custom, { words: '  high blood pressure alone  ', effect: 'meets', date: '2026-11-19' }))
      .toBe('Heart failure: high blood pressure alone');
    const typed = asked({ kind: 'result', what: 'eGFR', needsValue: true, options: defaultOptions('result') });
    expect(factLineDetail(typed, { words: '  eGFR 28 mL  ', effect: 'meets', date: '2026-11-01' })).toBe('eGFR 28 mL');
  });

  it('puts no date in the first field, and a Yes that names no date is present for the whole record', () => {
    const on = '2026-11-19';
    const yes = answerLineText(asked(), { words: 'Yes', effect: 'meets', date: on });
    expect(yes).toBe(`CONDITION | Heart failure. The patient has this. Confirmed by the pharmacist at the counter on ${longDate(on)}. ${PRESENT_THROUGHOUT}`);
    const no = answerLineText(asked(), { words: 'No', effect: 'does_not_meet', date: on });
    expect(no).toBe(`CONDITION | No heart failure: the patient does not have it. ${PHARMACIST_MARK}`);
    const typed = asked({ kind: 'result', what: 'eGFR', needsValue: true, options: defaultOptions('result') });
    expect(answerLineText(typed, { words: 'eGFR 28', effect: 'meets', date: '2026-11-20', resultDate: '2026-11-01' }))
      .toBe(`RESULT | eGFR 28. Entered by the pharmacist at the counter on ${longDate('2026-11-20')}.`);
    expect(answerLineText(typed, { words: 'eGFR 28', effect: 'meets', date: '2026-11-20' }))
      .toBe(`RESULT | eGFR 28. The date of the result is not recorded. Entered by the pharmacist at the counter on ${longDate('2026-11-20')}.`);
    const unknown = chosenFrom(typed, { option: 'Not known' }, '2026-11-20').chosen;
    expect(unknown).toMatchObject({ words: 'Not known', effect: 'unknown' });
    expect(unknown?.resultDate).toBeUndefined();
    const unknownLine = answerLineText(typed, unknown ?? { words: 'Not known', effect: 'unknown', date: '2026-11-20' });
    expect(unknownLine).toBe(`RESULT | eGFR: not known. Entered by the pharmacist at the counter on ${longDate('2026-11-20')}.`);
    expect(unknownLine).not.toContain('The date of the result is not recorded.');
  });

  it('writes the result name when Not known answers a typed result question', () => {
    const q = asked({
      key: 'result\negfr', kind: 'result', what: 'eGFR', criterionIds: ['CKD'], source: 'patient', status: 'open',
      options: defaultOptions('result'), needsValue: true
    });
    const chosen = chosenFrom(q, { option: 'Not known' }, '2026-11-20').chosen;
    if (!chosen) throw new Error('No Not known answer was made.');
    const c = oneCase();
    writeAnswer(c, [], [], q, chosen, '2026-11-20T12:00:00.000Z');
    expect(c.lines).toEqual([{
      id: 'L001',
      text: 'no date | RESULT | eGFR: not known. Entered by the pharmacist at the counter on 20 November 2026.'
    }]);
    expect(q.answer).toMatchObject({ lineId: 'L001', words: 'Not known', effect: 'unknown' });
    expect(q.status).toBe('not_known');
  });

  it('puts the held findings back, drops a later finding of that criterion, and does not mark a line twice', () => {
    const c = oneCase();
    c.lines.push({
      id: 'L002',
      text: 'no date | CONDITION | Heart failure. The patient has this. Confirmed by the pharmacist at the counter on 19 November 2026.'
    });
    c.screening.criteria = [
      { criterionId: 'HF', status: 'waiting', reason: 'new' },
      { criterionId: 'OTHER', status: 'clear', reason: 'keep' }
    ];
    const held = oneFinding('F0001', 'HF');
    const q = asked({
      answer: { lineId: 'L002', words: 'Yes', effect: 'meets', at: '2026-11-19T00:00:00.000Z' },
      heldFindings: [held],
      heldRuns: [{ criterionId: 'HF', status: 'suspected', reason: 'named' }]
    });
    const later = oneFinding('F0002', 'HF');
    const other = oneFinding('F0003', 'ZZ');
    const replaced = oneFinding('F0001', 'HF');
    replaced.possible = false;
    const findings = [replaced, later, other];
    takeAnswerBack(c, findings, q, '2026-11-19T01:00:00.000Z');
    expect(c.lines[0].text.endsWith(` ${TAKEN_BACK_MARK}`)).toBe(true);
    expect(q.status).toBe('open');
    expect(q.answer?.takenBackAt).toBe('2026-11-19T01:00:00.000Z');
    expect(q.heldFindings).toBeUndefined();
    expect(q.heldRuns).toBeUndefined();
    expect(findings.map(item => item.id)).toEqual(['F0001', 'F0003']);
    expect(findings[0]).toEqual(held);
    expect(findings[0]).not.toBe(held);
    expect(c.screening.criteria[0]).toEqual({ criterionId: 'HF', status: 'suspected', reason: 'named' });
    expect(c.screening.criteria[1]).toEqual({ criterionId: 'OTHER', status: 'clear', reason: 'keep' });

    takeAnswerBack(c, findings, q, '2026-11-19T02:00:00.000Z');
    expect(c.lines[0].text.match(/Taken back by the pharmacist at the counter\./g)).toHaveLength(1);
    expect(q.answer?.takenBackAt).toBe('2026-11-19T02:00:00.000Z');
  });

  it('keeps the finding when Not known is taken back, because that answer held nothing', () => {
    const c = oneCase();
    c.lines.push({
      id: 'L002',
      text: `no date | CONDITION | Heart failure: not known. ${PHARMACIST_MARK}`
    });
    c.screening = { status: 'done', criteria: [{ criterionId: 'HF', status: 'clear' }], finishedAt: '2026-11-19T00:00:00.000Z' };
    const kept = oneFinding('F0001', 'HF');
    kept.possible = true;
    const q = asked({
      status: 'not_known',
      answer: { lineId: 'L002', words: 'Not known', effect: 'unknown', at: '2026-11-19T00:00:00.000Z' }
    });
    const findings = [kept];
    takeAnswerBack(c, findings, q, '2026-11-19T01:00:00.000Z');
    expect(findings).toEqual([kept]);
    expect(q.status).toBe('open');
    expect(q.answer?.takenBackAt).toBe('2026-11-19T01:00:00.000Z');
    expect(c.lines[0].text.endsWith(` ${TAKEN_BACK_MARK}`)).toBe(true);
    expect(c.screening.status).toBe('done');
    expect(c.screening.finishedAt).toBe('2026-11-19T00:00:00.000Z');
    expect(c.screening.criteria[0].status).toBe('clear');
  });

  it('does not put an earlier snapshot back while another answer for that criterion still stands', () => {
    const c = oneCase();
    c.lines.push({
      id: 'L002',
      text: 'no date | CONDITION | Heart failure. The patient has this. Confirmed by the pharmacist at the counter on 19 November 2026.'
    });
    c.lines.push({
      id: 'L003',
      text: 'no date | CONDITION | Peptic ulcer. The patient has this. Confirmed by the pharmacist at the counter on 19 November 2026.'
    });
    c.screening = {
      status: 'done',
      criteria: [{ criterionId: 'HF', status: 'suspected', reason: 'both facts' }],
      finishedAt: '2026-11-19T02:00:00.000Z'
    };
    const early = oneFinding('F0001', 'HF');
    early.screen.reason = 'neither fact';
    const current = oneFinding('F0002', 'HF');
    current.screen.reason = 'both facts';
    const first = asked({
      answer: { lineId: 'L002', words: 'Yes', effect: 'meets', at: '2026-11-19T00:00:00.000Z' },
      heldFindings: [early],
      heldRuns: [{ criterionId: 'HF', status: 'suspected', reason: 'neither fact' }]
    });
    const second = asked({
      id: 'Q0002',
      key: 'condition\npeptic ulcer',
      what: 'Peptic ulcer',
      answer: { lineId: 'L003', words: 'Yes', effect: 'meets', at: '2026-11-19T01:00:00.000Z' },
      heldFindings: [oneFinding('F0009', 'HF')],
      heldRuns: [{ criterionId: 'HF', status: 'suspected', reason: 'only heart failure' }]
    });
    c.questions = [first, second];
    const findings = [current];
    takeAnswerBack(c, findings, first, '2026-11-19T03:00:00.000Z');
    expect(findings).toEqual([]);
    expect(c.screening.status).toBe('waiting');
    expect(c.screening.finishedAt).toBeUndefined();
    expect(c.screening.criteria[0]).toEqual({ criterionId: 'HF', status: 'waiting' });
    expect(first.status).toBe('open');
    expect(first.answer?.takenBackAt).toBe('2026-11-19T03:00:00.000Z');
    expect(first.heldFindings).toBeUndefined();
    expect(second.status).toBe('answered');
    expect(second.answer?.takenBackAt).toBeUndefined();
    expect(second.heldFindings?.[0]?.id).toBe('F0009');
    expect(c.lines[0].text.endsWith(` ${TAKEN_BACK_MARK}`)).toBe(true);
    expect(c.lines[1].text.includes(TAKEN_BACK_MARK)).toBe(false);
  });

  it('does not leave the history counted as screened when the restored run is waiting', () => {
    const c = oneCase();
    c.lines.push({
      id: 'L002',
      text: '2026-11-02 | RESULT | Age 72 years. Entered by the pharmacist at the counter on 19 November 2026.'
    });
    c.screening = {
      status: 'done',
      criteria: [{ criterionId: 'AGE', status: 'clear', reason: 'Age is entered.' }],
      finishedAt: '2026-11-19T02:00:00.000Z'
    };
    const q = asked({
      key: 'result\nage', kind: 'result', what: 'Age', source: 'patient',
      answer: { lineId: 'L002', words: 'Age 72 years', effect: 'meets', at: '2026-11-19T01:00:00.000Z' },
      heldFindings: [],
      heldRuns: [{ criterionId: 'AGE', status: 'waiting' }]
    });
    c.questions = [q];
    takeAnswerBack(c, [], q, '2026-11-19T03:00:00.000Z');
    expect(q.status).toBe('open');
    expect(c.screening.criteria[0].status).toBe('waiting');
    expect(c.screening.status).toBe('waiting');
    expect(c.screening.finishedAt).toBeUndefined();
    expect(fullyScreened(c)).toBe(false);
  });

  it('leaves a missing line unmarked, keeps another case, and clears a reason the held run did not have', () => {
    const c = oneCase();
    c.lines.push({ id: 'L001', text: '2026-08-08 | Xarelto 20 mg tablet' });
    c.screening.criteria = [{ criterionId: 'HF', status: 'waiting', reason: 'old', seconds: 3 }];
    const q = asked({
      answer: { lineId: 'L999', words: 'Yes', effect: 'meets', at: '2026-11-19T00:00:00.000Z' },
      heldFindings: [oneFinding('F0001', 'HF')],
      heldRuns: [{ criterionId: 'HF', status: 'clear' }]
    });
    const otherCase = oneFinding('F0009', 'HF', 'C0002');
    const findings = [otherCase];
    takeAnswerBack(c, findings, q, '2026-11-19T03:00:00.000Z');
    expect(c.lines[0].text).toBe('2026-08-08 | Xarelto 20 mg tablet');
    expect(findings.map(item => item.id)).toEqual(['F0009', 'F0001']);
    expect(c.screening.criteria[0]).toEqual({ criterionId: 'HF', status: 'clear', seconds: 3 });
    expect(q.status).toBe('open');
  });
});

describe('an answer the server refuses', () => {
  function refused(run: () => unknown, status: number, words: string): void {
    try {
      run();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(status);
      expect((e as ApiError).message).toContain(words);
      return;
    }
    throw new Error('The call was taken.');
  }

  it('names the button that is missing, a blank value, and a date that is not a day', async () => {
    const { engine } = await imported(72, [{ medicine: 'ibuprofen', brand: 'Nurofen' }], [hf]);
    const id = theCase(engine).id;
    const q = question(engine, 'Heart failure');
    const lines = theCase(engine).lines.length;
    const notes = engine.state.activity.length;
    expect(chosenFrom(q, {}, '2026-11-20')).toEqual({ error: 'Choose one of the answers.' });
    expect(chosenFrom(q, { option: '   ' }, '2026-11-20')).toEqual({ error: 'Choose one of the answers.' });
    expect(chosenFrom(q, { option: 'Maybe' }, '2026-11-20')).toEqual({ error: 'Choose one of the answers.' });
    expect(chosenFrom(q, { option: 'yes' }, '2026-11-20').chosen).toMatchObject({ words: 'Yes', effect: 'meets' });
    refused(() => engine.answerQuestion(id, q.id, {}), 400, 'Choose one of the answers.');
    refused(() => engine.answerQuestion(id, q.id, { option: 'Maybe' }), 400, 'Choose one of the answers.');
    expect(q.status).toBe('open');
    expect(theCase(engine).lines).toHaveLength(lines);
    expect(engine.state.activity).toHaveLength(notes);

    const level = await imported(72, [{ medicine: 'lithium', brand: 'Lithicarb' }], [lithium]);
    const typed = question(level.engine, 'latest lithium level');
    expect(chosenFrom(typed, { value: '  ', unit: 'mmol/L', date: '2026-11-01' }, '2026-11-20'))
      .toEqual({ error: 'Enter the value, or choose Not known.' });
    expect(chosenFrom(typed, { value: '0.8', unit: 'mmol/L', date: '19/11/2026' }, '2026-11-20').error)
      .toContain('year-month-day');
    expect(chosenFrom(typed, { option: 'Not known' }, '2026-11-20').chosen).toMatchObject({ words: 'Not known', effect: 'unknown' });
    expect(chosenFrom(typed, { value: '0.8', unit: '   ' }, '2026-11-20').chosen?.words).toBe('latest lithium level 0.8');
    const levelId = theCase(level.engine).id;
    const levelLines = theCase(level.engine).lines.length;
    refused(() => level.engine.answerQuestion(levelId, typed.id, { value: ' ', unit: 'mmol/L' }), 400, 'Enter the value, or choose Not known.');
    refused(() => level.engine.answerQuestion(levelId, typed.id, { value: '0.8', date: '19/11/2026' }), 400, 'year-month-day');
    expect(typed.status).toBe('open');
    expect(theCase(level.engine).lines).toHaveLength(levelLines);
  });

  it('refuses a history or a question that is not there, a second answer, and a take-back of nothing', async () => {
    const { engine } = await imported(72, [{ medicine: 'ibuprofen', brand: 'Nurofen' }], [hf]);
    const id = theCase(engine).id;
    const qid = question(engine, 'Heart failure').id;
    refused(() => engine.answerQuestion('C9999', qid, { option: 'Yes' }), 404, 'This history was not found.');
    refused(() => engine.takeBackQuestion('C9999', qid), 404, 'This history was not found.');
    refused(() => engine.reopenQuestion('C9999', qid), 404, 'This history was not found.');
    refused(() => engine.answerQuestion(id, 'Q9999', { option: 'Yes' }), 404, 'This question was not found.');
    refused(() => engine.takeBackQuestion(id, 'Q9999'), 404, 'This question was not found.');
    refused(() => engine.reopenQuestion(id, 'Q9999'), 404, 'This question was not found.');
    refused(() => engine.takeBackQuestion(id, qid), 409, 'This question has no answer to take back.');
    refused(() => engine.reopenQuestion(id, qid), 409, 'This question is already open.');

    engine.answerQuestion(id, qid, { option: 'Yes' });
    await engine.whenIdle();
    refused(() => engine.answerQuestion(id, qid, { option: 'No' }), 409, 'This question already has an answer.');
    refused(() => engine.reopenQuestion(id, qid), 409, 'This question is already open.');
    expect(question(engine, 'Heart failure').status).toBe('answered');
    engine.takeBackQuestion(id, qid);
    refused(() => engine.takeBackQuestion(id, qid), 409, 'This question has no answer to take back.');
    expect(question(engine, 'Heart failure').status).toBe('open');

    engine.answerQuestion(id, qid, { option: 'Not known' });
    expect(question(engine, 'Heart failure').status).toBe('not_known');
    refused(() => engine.answerQuestion(id, qid, { option: 'Yes' }), 409, 'This question is closed. Open it again to answer it.');
    engine.reopenQuestion(id, qid);
    expect(question(engine, 'Heart failure').status).toBe('open');
    expect(question(engine, 'Heart failure').answer?.takenBackAt).toBeTruthy();
  });

  it('allows an answer when no call for its own criterion is running, while take-back still waits for an idle history', async () => {
    const { engine } = await imported(72, [{ medicine: 'ibuprofen', brand: 'Nurofen' }], [hf]);
    const id = theCase(engine).id;
    const qid = question(engine, 'Heart failure').id;
    const lines = theCase(engine).lines.length;
    engine.state.jobs.push({ id: 'J9001', stage: 'screen', caseId: id, status: 'running' });
    engine.answerQuestion(id, qid, { option: 'Yes' });
    refused(() => engine.takeBackQuestion(id, qid), 409, 'This history is still being screened.');
    expect(question(engine, 'Heart failure').status).toBe('answered');
    expect(theCase(engine).lines).toHaveLength(lines + 1);

    engine.state.jobs[engine.state.jobs.length - 1].status = 'done';
    engine.takeBackQuestion(id, qid);
    engine.state.jobs.push({ id: 'J9002', stage: 'check', caseId: 'C9999', findingId: 'F0001', status: 'running' });
    engine.answerQuestion(id, qid, { option: 'No' });
    expect(question(engine, 'Heart failure').status).toBe('answered');
    await engine.whenIdle();
  });

  it('refuses an answer while a second check of its own finding is queued or running', async () => {
    const { engine } = await imported(72, [{ medicine: 'ibuprofen', brand: 'Nurofen' }], [hf]);
    const id = theCase(engine).id;
    const qid = question(engine, 'Heart failure').id;
    engine.state.jobs.push({ id: 'J9003', stage: 'check', caseId: id, findingId: 'F0001', status: 'running' });
    refused(() => engine.answerQuestion(id, qid, { option: 'Yes' }), 409, 'The second check for this finding');
    refused(() => engine.takeBackQuestion(id, qid), 409, 'This history is still being screened.');
    expect(question(engine, 'Heart failure').status).toBe('open');
    engine.state.jobs[engine.state.jobs.length - 1].status = 'done';
    engine.state.jobs.push({ id: 'J9004', stage: 'check', caseId: id, findingId: 'F0001', status: 'queued' });
    refused(() => engine.answerQuestion(id, qid, { option: 'Not known' }), 409, 'The second check for this finding');
    engine.state.jobs[engine.state.jobs.length - 1].status = 'done';
    engine.answerQuestion(id, qid, { option: 'Not known' });
    expect(question(engine, 'Heart failure').status).toBe('not_known');
  });
});


describe('import questions when the record already holds the fact', () => {
  const examples = [
    ['BRISNIK-OP-PAIN2', 'near-miss.csv', 'Neuropathic pain'],
    ['CARETRACK-CROU16', 'near-miss.csv', 'Croup'],
    ['CKD-A10B', 'near-miss.csv', 'Chronic kidney disease'],
    ['FDADSC-3', 'near-miss.csv', 'Prior allopurinol trial, intolerance, or contraindication'],
    ['KHAWAGI-G172', 'near-miss.csv', 'Serum lithium'],
    ['MHRA-16', 'near-miss.csv', 'Vitamin B12 deficiency symptoms or risk factors on metformin'],
    ['SCOTPOLY-SD-1', 'near-miss.csv', 'Current dehydrating illness'],
    ['START-B1', 'pos-nofact.csv', 'Blood pressure'],
    ['START-D6', 'pos-nofact.csv', 'Restless legs syndrome'],
    ['START-E4', 'pos-fact-spot.csv', 'Chronic kidney disease']
  ] as const;

  it.each(examples)('%s %s does not ask about %s again', (id, file, fact) => {
    const item = readCriterion(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'criteria', id, 'criterion.json'), 'utf8')), id);
    const parsed = parseCsv(fs.readFileSync(path.join(process.cwd(), 'cases', id, file), 'utf8'));
    const c: CaseRecord = {
      id: 'C0001', fileName: file, importedAt: '2026-11-20T00:00:00.000Z', source: 'csv',
      patient: parsed.patient, lines: parsed.lines, transcriptionConfirmed: true, parts: 1,
      screening: { status: 'not_started', criteria: [] }, questions: []
    };
    syncCaseQuestions(c, [item], [], []);
    expect(c.questions?.some(q => q.what === fact)).toBe(false);
  });

  it('matches the fact kind and leaves a taken-back line unanswered', () => {
    const item = criterion({
      id: 'KIND', label: 'Kind test',
      needs_facts: [{ kind: 'condition', what: 'Heart failure', meets: 'recorded', ask_when: 'always' }]
    });
    const record = (text: string): CaseRecord => ({
      id: 'C0001', fileName: 'fact.csv', importedAt: '2026-11-20T00:00:00.000Z', source: 'csv',
      patient: { label: 'Fictional patient', age: 72 }, lines: [{ id: 'L001', text }],
      transcriptionConfirmed: true, parts: 1, screening: { status: 'not_started', criteria: [] }, questions: []
    });
    const wrongKind = record('2026-01-01 | RESULT | Heart failure 120');
    syncCaseQuestions(wrongKind, [item], [], []);
    expect(wrongKind.questions?.map(q => q.what)).toEqual(['Heart failure']);
    const takenBack = record(`2026-01-01 | CONDITION | Heart failure. ${TAKEN_BACK_MARK}`);
    syncCaseQuestions(takenBack, [item], [], []);
    expect(takenBack.questions?.map(q => q.what)).toEqual(['Heart failure']);
    const lower = record('2026-01-01 | CONDITION | hEaRt fAiLuRe ruled out');
    syncCaseQuestions(lower, [item], [], []);
    expect(lower.questions ?? []).toEqual([]);
  });

  it('takes a measurement written as an observation for a needed result, and the other way round, but never a condition line', () => {
    const record = (text: string): CaseRecord => ({
      id: 'C0001', fileName: 'fact.csv', importedAt: '2026-11-20T00:00:00.000Z', source: 'csv',
      patient: { label: 'Fictional patient', age: 72 }, lines: [{ id: 'L001', text }],
      transcriptionConfirmed: true, parts: 1, screening: { status: 'not_started', criteria: [] }, questions: []
    });
    const asResult = criterion({
      id: 'MEASURE-R', label: 'Measurement asked as a result',
      needs_facts: [{ kind: 'result', what: 'Blood pressure', meets: 'above 140/90 mmHg', ask_when: 'always' }]
    });
    const asObservation = criterion({
      id: 'MEASURE-O', label: 'Measurement asked as an observation',
      needs_facts: [{ kind: 'observation', what: 'Blood pressure', meets: 'above 140/90 mmHg', ask_when: 'always' }]
    });
    const observed = record('2026-09-22 | OBSERVATION | Clinic blood pressure 172/96 mmHg');
    syncCaseQuestions(observed, [asResult], [], []);
    expect(observed.questions ?? []).toEqual([]);
    const resulted = record('2026-09-22 | RESULT | Blood pressure 172/96 mmHg');
    syncCaseQuestions(resulted, [asObservation], [], []);
    expect(resulted.questions ?? []).toEqual([]);
    const onlyCondition = record('2026-09-22 | CONDITION | High blood pressure');
    syncCaseQuestions(onlyCondition, [asResult], [], []);
    expect(onlyCondition.questions?.map(q => q.what)).toEqual(['Blood pressure']);
    const takenBack = record(`2026-09-22 | OBSERVATION | Clinic blood pressure 172/96 mmHg. ${TAKEN_BACK_MARK}`);
    syncCaseQuestions(takenBack, [asResult], [], []);
    expect(takenBack.questions?.map(q => q.what)).toEqual(['Blood pressure']);
  });
});


describe('age and sex gates for possible and supply questions', () => {
  function record(patient: CaseRecord['patient'], lines: HistoryLine[] = []): CaseRecord {
    return {
      id: 'C0001', fileName: 'gate.csv', importedAt: '2026-11-20T00:00:00.000Z', source: 'csv',
      patient, lines, transcriptionConfirmed: true, parts: 1,
      screening: { status: 'not_started', criteria: [] }, questions: []
    };
  }

  function possible(item: Criterion, fact: string): Finding {
    return {
      id: 'F0001', caseId: 'C0001', criterionId: item.id, state: 'suspected', possible: true,
      screen: screenResult({ lineIds: ['L001'], reason: 'Possible.', missingFacts: [fact] }), seenByPharmacist: false
    };
  }

  it.each([
    { label: 'age 64 does not ask', age: 64, expected: false },
    { label: 'age 65 asks', age: 65, expected: true },
    { label: 'unknown age asks', age: undefined, expected: true }
  ])('START-B7 possible heart-failure question: $label', ({ age, expected }) => {
    const item = readCriterion(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'criteria', 'START-B7', 'criterion.json'), 'utf8')), 'START-B7');
    const fact = 'Heart failure';
    const c = record({ label: 'Fictional patient', age, sex: 'F' }, [{ id: 'L001', text: '2026-01-01 | Nurofen tablet' }]);
    syncCaseQuestions(c, [item], [possible(item, fact)], []);
    expect(c.questions?.some(q => q.what === fact)).toBe(expected);
  });

  it('FDADSC-9 with only_sex female does not ask a man, but unknown sex stays as today', () => {
    const saved = readCriterion(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'criteria', 'FDADSC-9', 'criterion.json'), 'utf8')), 'FDADSC-9');
    const item: Criterion = { ...saved, only_sex: 'female' };
    const fact = 'Breastfeeding';
    const outside = record({ label: 'Fictional patient', age: 30, sex: 'M' }, [{ id: 'L001', text: '2026-01-01 | Nurofen tablet' }]);
    syncCaseQuestions(outside, [item], [possible(item, fact)], []);
    expect(outside.questions?.some(q => q.what === fact)).toBe(false);
    const unknown = record({ label: 'Fictional patient', age: 30 }, [{ id: 'L001', text: '2026-01-01 | Nurofen tablet' }]);
    syncCaseQuestions(unknown, [item], [possible(item, fact)], []);
    expect(unknown.questions?.some(q => q.what === fact)).toBe(true);
  });

  it('a supply question neither opens nor joins for a known outside age or the other sex', () => {
    const fact = { kind: 'condition' as const, what: 'Heart failure', meets: 'recorded', ask_when: { group: 'A' } };
    const old = criterion({ id: 'OLD', label: 'Old', statement: 'People aged 65 or older.', needs_facts: [fact] });
    const female = criterion({ id: 'FEMALE', label: 'Female', only_sex: 'female', needs_facts: [fact] });
    const eligible = criterion({ id: 'ELIGIBLE', label: 'Eligible', needs_facts: [fact] });
    const lines = [{ id: 'L001', text: '2026-01-01 | Nurofen 200 mg tablet' }];
    const c = record({ label: 'Fictional patient', age: 40, sex: 'M' }, lines);
    syncCaseQuestions(c, [old, female, eligible], [], []);
    expect(c.questions?.filter(q => q.what === fact.what).map(q => q.criterionIds)).toEqual([['ELIGIBLE']]);
  });
});


describe('an age condition on one fact is not a criterion age limit', () => {
  function load(id: string): Criterion {
    return readCriterion(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'criteria', id, 'criterion.json'), 'utf8')), id);
  }

  it('QLDCOAG-6-1 still permits a pregnancy question for a woman under 55', () => {
    const item = load('QLDCOAG-6-1');
    expect(readAgeLimit(item, 40)).toEqual({ holds: true });
    const fact = item.needs_facts?.[0].what ?? '';
    const c: CaseRecord = {
      id: 'C0001', fileName: 'pregnancy.csv', importedAt: '2026-11-20T00:00:00.000Z', source: 'csv',
      patient: { label: 'Fictional patient', age: 40, sex: 'F' },
      lines: [{ id: 'L001', text: '2026-01-01 | Marevan 5 mg tablet' }], transcriptionConfirmed: true, parts: 1,
      screening: { status: 'not_started', criteria: [] }, questions: []
    };
    const finding: Finding = {
      id: 'F0001', caseId: c.id, criterionId: item.id, state: 'suspected', possible: true,
      screen: screenResult({ lineIds: ['L001'], reason: 'Pregnancy is not recorded.', missingFacts: [fact] }), seenByPharmacist: false
    };
    syncCaseQuestions(c, [item], [finding], []);
    expect(c.questions?.some(q => q.what === fact)).toBe(true);
  });

  it('FDADSC-7 has no global age limit and puts no unread-age note on its risk question', () => {
    const item = load('FDADSC-7');
    expect(readAgeLimit(item, 78)).toEqual({ holds: true });
    const c: CaseRecord = {
      id: 'C0001', fileName: 'aortic.csv', importedAt: '2026-11-20T00:00:00.000Z', source: 'csv',
      patient: { label: 'Fictional patient', age: 78, sex: 'M' },
      lines: [{ id: 'L001', text: '2026-01-01 | Ciproxin 500 mg tablet' }], transcriptionConfirmed: true, parts: 1,
      screening: { status: 'not_started', criteria: [] }, questions: []
    };
    syncCaseQuestions(c, [item], [], []);
    const q = c.questions?.find(item => item.what === 'Aortic aneurysm or high vascular risk for aortic rupture');
    expect(q).toBeTruthy();
    expect(q?.note).toBeUndefined();
    expect(q?.note).not.toBe(AGE_LIMIT_UNREAD);
  });
});
