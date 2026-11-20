import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeConfig } from '../pipeline/config.ts';
import type { CaseRecord, Criterion, HistoryLine, NeededFact, ScreenResult } from '../shared/types.ts';
import { Engine, type PipelineFns } from './engine.ts';
import { PageImages } from './images.ts';
import { StateStore } from './store.ts';

const FIXTURE = path.join(process.cwd(), 'server', 'fixtures', 'condition-markers.json');
const AT = '2026-11-20T09:00:00.000Z';
const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-markers-'));
  made.push(dir);
  return dir;
}

interface Row {
  date?: string;
  medicine?: string;
  brand?: string;
  strength?: string;
  form?: string;
  recordType?: string;
  detail?: string;
  value?: string;
}

function supply(medicine: string, brand: string, form = 'tablet', date = '2026-08-08'): Row {
  return { medicine, brand, form, date, strength: '24/26 mg' };
}

function condition(detail: string): Row {
  return { date: '2026-08-01', recordType: 'condition', detail };
}

function csv(rows: Row[]): string {
  const head = 'patient_ref,patient_age,patient_sex,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber,record_type,detail,value';
  const body = rows.map(row => [
    'F-001', '72', 'F', row.date ?? '2026-08-08', row.medicine ?? '', row.brand ?? '', row.strength ?? '',
    row.form ?? '', row.recordType ? '' : '30', row.recordType ? '' : '1', row.recordType ? '' : 'one daily',
    row.recordType ? '' : 'Dr A. Example', row.recordType ?? '', row.detail ?? '', row.value ?? ''
  ].join(','));
  return `${head}\n${body.join('\n')}\n`;
}

function fact(what: string, askWhen?: NeededFact['ask_when']): NeededFact {
  return { kind: 'condition', what, meets: 'the patient has this condition', ...(askWhen ? { ask_when: askWhen } : {}) };
}

function criterion(id: string, what = 'Heart failure', askWhen?: NeededFact['ask_when']): Criterion {
  return {
    id,
    label: id,
    family: 'Test',
    title: id,
    statement: 'Fictional application test wording.',
    statement_origin: 'entrant',
    source: {
      document: 'Test', citation: 'Test', licence: 'Test', licence_status: 'proposed', credit: 'Test wording.'
    },
    plain_summary: 'A test criterion.',
    medicine_groups: [{ key: 'A', name: 'Ibuprofen', ingredients: ['ibuprofen'], brands: { ibuprofen: ['Nurofen'] } }],
    needs_facts: [fact(what, askWhen)],
    rule_for_models: 'A fictional rule used only to test question opening.',
    cannot_be_seen: 'The condition.',
    ask_the_gp: 'A review.',
    urgency: 'routine',
    draft: true,
    signed_by_clinical_reviewer: null
  };
}

function screenResult(reason: string, missingFacts: string[] = []): ScreenResult {
  return {
    lineIds: ['L001'], medicines: [], reason, linesVerified: true, missingFacts,
    model: 'fake-screen', at: AT, seconds: 1
  };
}

interface OpenOptions {
  on?: boolean;
  markerFile?: string;
  possible?: boolean;
}

async function imported(rows: Row[], criteria: Criterion[] = [criterion('HF')], options: OpenOptions = {}) {
  const dir = tempDir();
  const store = new StateStore(dir);
  store.load();
  const screened: string[] = [];
  const seen: HistoryLine[][] = [];
  const logs: string[] = [];
  const pipeline: PipelineFns = {
    screenCriterion: async (_cfg, _patient, lines, item) => {
      screened.push(item.id);
      seen.push(lines.map(line => ({ ...line })));
      return options.possible
        ? { ok: true, suspected: true, result: screenResult('The condition is not shown.', [item.needs_facts?.[0]?.what ?? 'Condition']) }
        : { ok: true, suspected: false, result: screenResult('No finding.') };
    },
    checkFinding: async () => ({
      confirmed: true, lineIds: ['L001'], whatMatches: 'Test.', whatCannotBeSeen: '', completed: true,
      model: 'fake-check', at: AT, seconds: 1
    }),
    draftLetter: async () => ({
      subject: 'Test', body: 'Test letter.', origin: 'model', checkNotes: [], model: 'fake-letter', at: AT, seconds: 1
    }),
    transcribePageImage: async () => { throw new Error('Not used by this test.'); }
  };
  const engineOptions = {
    cfg: normalizeConfig({ conditionMarkers: options.on ?? true }),
    store,
    pipeline,
    images: new PageImages(path.join(dir, 'images')),
    loadCriteria: async () => criteria,
    warmup: false,
    modelsUp: async () => true,
    now: () => new Date(AT),
    log: (line: string) => logs.push(line),
    conditionMarkersFile: options.markerFile ?? FIXTURE
  };
  const engine = new Engine(engineOptions);
  await engine.start();
  await engine.importCase({ fileName: 'markers.csv', source: 'csv', csvText: csv(rows) });
  await engine.whenIdle();
  return { engine, screened, seen, logs, dir };
}

function theCase(engine: Engine): CaseRecord {
  const c = engine.state.cases[0];
  if (!c) throw new Error('No imported history.');
  return c;
}

function questions(engine: Engine) {
  return theCase(engine).questions ?? [];
}

describe('condition markers at import', () => {
  it('opens a standing supply question for a marker medicine, with its reason and API provenance', async () => {
    const { engine, screened } = await imported([supply('sacubitril with valsartan', 'Entresto')]);
    expect(questions(engine)).toHaveLength(1);
    const q = questions(engine)[0];
    expect(q.what).toBe('Heart failure');
    expect(q.source).toBe('supply');
    expect(q.status).toBe('open');
    expect(q.note).toBe('Asked because Entresto (sacubitril with valsartan) 24/26 mg tablet is supplied; it points to chronic heart failure.');
    expect(q.conditionMarker).toEqual({
      condition: 'chronic heart failure',
      question: 'Does this patient have chronic heart failure?',
      lineIds: ['L001']
    });
    expect(engine.stateResponse().state.cases[0]?.questions?.[0]?.conditionMarker?.lineIds).toEqual(['L001']);
    expect(screened).toEqual([]);
    expect(theCase(engine).screening.criteria[0]?.status).toBe('waiting');
  });

  it('withholds a STOPP condition marker until one of its own medicine groups is supplied', async () => {
    const { engine, screened } = await imported(
      [supply('sacubitril with valsartan', 'Entresto')], [criterion('STOPP-F1')]
    );
    expect(questions(engine)).toEqual([]);
    expect(screened).toEqual(['STOPP-F1']);
  });

  it('opens a STOPP condition marker when its own medicine group is supplied', async () => {
    const { engine, screened } = await imported([
      supply('sacubitril with valsartan', 'Entresto'), supply('ibuprofen', 'Nurofen')
    ], [criterion('STOPP-F1')]);
    expect(questions(engine).map(q => q.what)).toEqual(['Heart failure']);
    expect(screened).toEqual([]);
  });

  it('keeps a START omission marker active without its own medicine group', async () => {
    const { engine, screened } = await imported(
      [supply('sacubitril with valsartan', 'Entresto')], [criterion('START-B2')]
    );
    expect(questions(engine).map(q => q.what)).toEqual(['Heart failure']);
    expect(screened).toEqual([]);
  });

  it('uses the omission-safe fallback when the criterion fields cannot distinguish its kind', async () => {
    const { engine, screened } = await imported(
      [supply('sacubitril with valsartan', 'Entresto')], [criterion('OPTIMISE-T2-07')]
    );
    expect(questions(engine).map(q => q.what)).toEqual(['Heart failure']);
    expect(screened).toEqual([]);
  });

  it('matches an ingredient as well as a brand', async () => {
    const { engine } = await imported([{ ...supply('sacubitril with valsartan', ''), form: 'tablet' }]);
    expect(questions(engine).map(q => q.what)).toEqual(['Heart failure']);
  });

  it('does not open at import without a marker medicine', async () => {
    const { engine, screened } = await imported([supply('metformin', 'Diaformin')]);
    expect(questions(engine)).toEqual([]);
    expect(screened).toEqual(['HF']);
  });

  it('does not ask when the record already holds the condition', async () => {
    const { engine, screened } = await imported([
      supply('sacubitril with valsartan', 'Entresto'), condition('Heart failure')
    ]);
    expect(questions(engine)).toEqual([]);
    expect(screened).toEqual(['HF']);
  });

  it('does not open for an also-used medicine alone', async () => {
    const { engine, screened } = await imported([supply('ramipril', 'Tritace')]);
    expect(questions(engine)).toEqual([]);
    expect(screened).toEqual(['HF']);
  });

  it('applies the form rule before opening', async () => {
    const capsule = await imported([supply('formolin', 'Formo', 'capsule')]);
    expect(questions(capsule.engine)).toEqual([]);
    expect(capsule.screened).toEqual(['HF']);
    const tablet = await imported([supply('formolin', 'Formo', 'tablet')]);
    expect(questions(tablet.engine).map(q => q.what)).toEqual(['Heart failure']);
    expect(tablet.screened).toEqual([]);
  });

  async function formImport(forms: string[], form: string, medicine = 'formolin', brand = 'Formo') {
    const dir = tempDir();
    const file = path.join(dir, 'condition-markers.json');
    fs.writeFileSync(file, JSON.stringify({
      what_this_is: 'Form-limit application test.', version: '2026-11-20',
      conditions: [{
        condition: 'chronic heart failure', question: 'Does this patient have chronic heart failure?',
        fact_names: ['Heart failure'],
        points_to_it: [{ ingredient: medicine, brands: [brand], forms, also_points_to: [] }],
        also_used_for_it: [], no_medicine_points_to_it: ''
      }]
    }));
    return imported([supply(medicine, brand, form)], [criterion('HF')], { markerFile: file });
  }

  it.each([
    { label: 'TAB counts as tablet', forms: ['tablet'], form: 'TAB', opens: true },
    { label: 'a blank form is not excluded', forms: ['tablet'], form: '', opens: true },
    { label: 'an unknown form is not excluded', forms: ['tablet'], form: 'unrecognised dispensing form', opens: true },
    { label: 'CAP is different from a tablet limit', forms: ['tablet'], form: 'CAP', opens: false },
    { label: 'CAP counts as capsule', forms: ['capsule'], form: 'CAP', opens: true },
    { label: 'INJ counts as injection', forms: ['inject', 'infus', 'vial', 'ampoule', 'syringe', ' pen', 'depot'], form: 'INJ', opens: true },
    { label: 'INH counts as inhalation', forms: ['inhal', 'haler', 'puffer', 'nebul'], form: 'INH', opens: true },
    { label: 'INH is different from a nasal limit', forms: ['nasal'], form: 'INH', opens: false },
    { label: 'an inhaler is different from a nasal limit', forms: ['nasal'], form: 'inhaler', opens: false },
    { label: 'pentoxifylline is not a pen with a blank form', forms: ['tablet'], form: '', medicine: 'pentoxifylline', brand: 'Trental', opens: true },
    { label: 'pentoxifylline is not a pen with an unknown form', forms: ['tablet'], form: 'unrecognised dispensing form', medicine: 'pentoxifylline', brand: 'Trental', opens: true },
    { label: 'Pendine is not a pen with a blank form', forms: ['tablet'], form: '', medicine: 'gabapentin', brand: 'Pendine', opens: true },
    { label: 'a genuine pen counts as injection', forms: ['inject', 'infus', 'vial', 'ampoule', 'syringe', ' pen', 'depot'], form: 'pen', medicine: 'insulin glargine', brand: 'Lantus', opens: true },
    { label: 'a genuine pen is different from a tablet limit', forms: ['tablet'], form: 'pen', opens: false }
  ])('$label', async ({ forms, form, opens, medicine, brand }) => {
    const { engine, screened } = await formImport(forms, form, medicine, brand);
    expect(questions(engine).map(q => q.what)).toEqual(opens ? ['Heart failure'] : []);
    expect(screened).toEqual(opens ? [] : ['HF']);
  });

  it('names the first two matching lines and how many more there are', async () => {
    const { engine } = await imported([
      supply('sacubitril with valsartan', 'Entresto', 'tablet', '2026-08-08'),
      supply('digoxin', 'Lanoxin', 'tablet', '2026-08-07'),
      supply('sacubitril with valsartan', 'Entresto', 'tablet', '2026-08-06')
    ]);
    expect(questions(engine)).toHaveLength(1);
    expect(questions(engine)[0]?.note).toBe(
      'Asked because Entresto (sacubitril with valsartan) 24/26 mg tablet, Lanoxin (digoxin) 24/26 mg tablet and 1 more are supplied; they point to chronic heart failure.'
    );
    expect(questions(engine)[0]?.conditionMarker?.lineIds).toEqual(['L001', 'L002', 'L003']);
  });

  it('opens one question when two criteria need the same fact name', async () => {
    const { engine, screened } = await imported(
      [supply('sacubitril with valsartan', 'Entresto')], [criterion('HF'), criterion('HF2')]
    );
    expect(questions(engine)).toHaveLength(1);
    expect(questions(engine)[0]?.criterionIds).toEqual(['HF', 'HF2']);
    expect(theCase(engine).screening.criteria.map(run => run.status)).toEqual(['waiting', 'waiting']);
    expect(screened).toEqual([]);
  });

  it('keeps an existing ask_when and lets a marker open the same fact as well', async () => {
    const item = criterion('ASK', 'Heart failure', { group: 'A' });
    const ordinary = await imported([supply('ibuprofen', 'Nurofen')], [item]);
    expect(questions(ordinary.engine)).toHaveLength(1);
    expect(questions(ordinary.engine)[0]?.source).toBe('supply');
    expect(questions(ordinary.engine)[0]?.conditionMarker).toBeUndefined();

    const marked = await imported([supply('sacubitril with valsartan', 'Entresto')], [item]);
    expect(questions(marked.engine)).toHaveLength(1);
    expect(questions(marked.engine)[0]?.conditionMarker?.condition).toBe('chronic heart failure');
  });
});

describe('condition-marker recent_days rules', () => {
  function recentFile(recentDays?: unknown): string {
    const dir = tempDir();
    const file = path.join(dir, 'condition-markers.json');
    const root = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as { conditions: Record<string, unknown>[] };
    if (recentDays !== undefined) root.conditions[0].recent_days = recentDays;
    fs.writeFileSync(file, JSON.stringify(root));
    return file;
  }

  const newest = () => supply('metformin', 'Diaformin', 'tablet', '2026-08-08');

  it.each([
    { days: 10, date: '2026-07-29', opens: true },
    { days: 200, date: '2026-01-20', opens: false }
  ])('applies recent_days 30 to a supply $days days before the newest supply', async ({ date, opens }) => {
    const { engine, screened } = await imported(
      [supply('sacubitril with valsartan', 'Entresto', 'tablet', date), newest()],
      [criterion('HF')], { markerFile: recentFile(30) }
    );
    expect(questions(engine).map(q => q.what)).toEqual(opens ? ['Heart failure'] : []);
    expect(screened).toEqual(opens ? [] : ['HF']);
  });

  it.each([
    { days: 10, date: '2026-07-29' },
    { days: 200, date: '2026-01-20' }
  ])('opens without recent_days for a supply $days days before the newest supply', async ({ date }) => {
    const { engine, screened } = await imported(
      [supply('sacubitril with valsartan', 'Entresto', 'tablet', date), newest()],
      [criterion('HF')], { markerFile: recentFile() }
    );
    expect(questions(engine).map(q => q.what)).toEqual(['Heart failure']);
    expect(screened).toEqual([]);
  });

  it('ignores and logs a bad recent_days value without rejecting the condition', async () => {
    const { engine, logs, screened } = await imported(
      [supply('sacubitril with valsartan', 'Entresto', 'tablet', '2026-01-20'), newest()],
      [criterion('HF')], { markerFile: recentFile(0) }
    );
    expect(questions(engine).map(q => q.what)).toEqual(['Heart failure']);
    expect(screened).toEqual([]);
    expect(logs.filter(line => line.includes('recent_days') && line.includes('chronic heart failure'))).toHaveLength(1);
  });

  it('names only the supplies inside the recent_days window', async () => {
    const { engine } = await imported([
      supply('digoxin', 'Lanoxin', 'tablet', '2026-01-20'),
      supply('sacubitril with valsartan', 'Entresto', 'tablet', '2026-07-29'),
      newest()
    ], [criterion('HF')], { markerFile: recentFile(30) });
    expect(questions(engine)).toHaveLength(1);
    expect(questions(engine)[0]?.note).toBe(
      'Asked because Entresto (sacubitril with valsartan) 24/26 mg tablet is supplied; it points to chronic heart failure.'
    );
    expect(questions(engine)[0]?.conditionMarker?.lineIds).toEqual(['L002']);
  });
});

describe('condition-marker in_play rules', () => {
  function inPlayFile(inPlay: unknown): string {
    const dir = tempDir();
    const file = path.join(dir, 'condition-markers.json');
    const root = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
    root.in_play_note = 'A condition question is asked only when the named criterion groups are supplied.';
    root.in_play = inPlay;
    fs.writeFileSync(file, JSON.stringify(root));
    return file;
  }

  it('withholds a named criterion until its named group is supplied', async () => {
    const markerFile = inPlayFile({ 'OPTIMISE-T2-07': { groups: ['A'], all_of: false } });
    const absent = await imported(
      [supply('sacubitril with valsartan', 'Entresto')], [criterion('OPTIMISE-T2-07')], { markerFile }
    );
    expect(questions(absent.engine)).toEqual([]);
    expect(absent.screened).toEqual(['OPTIMISE-T2-07']);

    const supplied = await imported([
      supply('sacubitril with valsartan', 'Entresto'), supply('ibuprofen', 'Nurofen')
    ], [criterion('OPTIMISE-T2-07')], { markerFile });
    expect(questions(supplied.engine).map(q => q.what)).toEqual(['Heart failure']);
    expect(supplied.screened).toEqual([]);
  });

  it('requires every named group when all_of is true', async () => {
    const item = criterion('OPTIMISE-T2-07');
    item.medicine_groups.push({
      key: 'B', name: 'Donepezil', ingredients: ['donepezil'], brands: { donepezil: ['Aricept'] }
    });
    const markerFile = inPlayFile({ 'OPTIMISE-T2-07': { groups: ['A', 'B'], all_of: true } });
    const oneGroup = await imported([
      supply('sacubitril with valsartan', 'Entresto'), supply('ibuprofen', 'Nurofen')
    ], [item], { markerFile });
    expect(questions(oneGroup.engine)).toEqual([]);
    expect(oneGroup.screened).toEqual(['OPTIMISE-T2-07']);

    const bothGroups = await imported([
      supply('sacubitril with valsartan', 'Entresto'), supply('ibuprofen', 'Nurofen'),
      supply('donepezil', 'Aricept')
    ], [item], { markerFile });
    expect(questions(bothGroups.engine).map(q => q.what)).toEqual(['Heart failure']);
    expect(bothGroups.screened).toEqual([]);
  });

  it('keeps an unnamed criterion on the omission-safe fallback', async () => {
    const markerFile = inPlayFile({ 'ANOTHER-CRITERION': { groups: ['A'], all_of: false } });
    const { engine, screened } = await imported(
      [supply('sacubitril with valsartan', 'Entresto')], [criterion('OPTIMISE-T2-07')], { markerFile }
    );
    expect(questions(engine).map(q => q.what)).toEqual(['Heart failure']);
    expect(screened).toEqual([]);
  });

  it('uses STOPP-B6 Group A rather than its Group B comparison medicines when named in in_play', async () => {
    const item = JSON.parse(fs.readFileSync(
      path.join(process.cwd(), 'criteria', 'STOPP-B6', 'criterion.json'), 'utf8'
    )) as Criterion;
    const markerFile = inPlayFile({ 'STOPP-B6': { groups: ['A'], all_of: false } });
    const root = JSON.parse(fs.readFileSync(markerFile, 'utf8')) as { conditions: unknown[] };
    root.conditions.push({
      condition: 'supraventricular tachyarrhythmia',
      question: 'Does this patient have atrial fibrillation, atrial flutter or another supraventricular tachycardia?',
      fact_names: ['Supraventricular tachyarrhythmia'],
      points_to_it: [{ ingredient: 'sacubitril with valsartan', brands: ['Entresto'], forms: [] }],
      also_used_for_it: []
    });
    fs.writeFileSync(markerFile, JSON.stringify(root));

    const groupB = await imported([
      supply('sacubitril with valsartan', 'Entresto'), supply('flecainide', 'Flecatab')
    ], [item], { markerFile });
    expect(questions(groupB.engine)).toEqual([]);
    expect(groupB.screened).toEqual(['STOPP-B6']);

    const groupA = await imported([
      supply('sacubitril with valsartan', 'Entresto'), supply('amiodarone', 'Cordarone X')
    ], [item], { markerFile });
    expect(questions(groupA.engine).map(q => q.what)).toEqual(['Supraventricular tachyarrhythmia']);
    expect(groupA.screened).toEqual([]);
  });

  it('requires every named group for a STOPP criterion with all_of true', async () => {
    const item = criterion('STOPP-ALL');
    item.medicine_groups.push({
      key: 'B', name: 'Donepezil', ingredients: ['donepezil'], brands: { donepezil: ['Aricept'] }
    });
    const markerFile = inPlayFile({ 'STOPP-ALL': { groups: ['A', 'B'], all_of: true } });
    const oneGroup = await imported([
      supply('sacubitril with valsartan', 'Entresto'), supply('ibuprofen', 'Nurofen')
    ], [item], { markerFile });
    expect(questions(oneGroup.engine)).toEqual([]);
    expect(oneGroup.screened).toEqual(['STOPP-ALL']);

    const bothGroups = await imported([
      supply('sacubitril with valsartan', 'Entresto'), supply('ibuprofen', 'Nurofen'),
      supply('donepezil', 'Aricept')
    ], [item], { markerFile });
    expect(questions(bothGroups.engine).map(q => q.what)).toEqual(['Heart failure']);
    expect(bothGroups.screened).toEqual([]);
  });

  it('keeps an unnamed STOPP criterion on its former any-own-group gate', async () => {
    const markerFile = inPlayFile({ 'OPTIMISE-T2-07': { groups: ['A'], all_of: false } });
    const absent = await imported(
      [supply('sacubitril with valsartan', 'Entresto')], [criterion('STOPP-F1')], { markerFile }
    );
    expect(questions(absent.engine)).toEqual([]);
    expect(absent.screened).toEqual(['STOPP-F1']);

    const supplied = await imported([
      supply('sacubitril with valsartan', 'Entresto'), supply('ibuprofen', 'Nurofen')
    ], [criterion('STOPP-F1')], { markerFile });
    expect(questions(supplied.engine).map(q => q.what)).toEqual(['Heart failure']);
    expect(supplied.screened).toEqual([]);
  });

  it('leaves out a malformed entry, names it, and still reads the conditions', async () => {
    const markerFile = inPlayFile({ 'OPTIMISE-T2-07': { groups: ['A'], all_of: 'not boolean' } });
    const { engine, logs, screened } = await imported(
      [supply('sacubitril with valsartan', 'Entresto')], [criterion('OPTIMISE-T2-07')], { markerFile }
    );
    expect(questions(engine).map(q => q.what)).toEqual(['Heart failure']);
    expect(screened).toEqual([]);
    expect(logs.filter(line => line.includes('OPTIMISE-T2-07') && line.includes('left out'))).toHaveLength(1);
  });
});

describe('condition-marker question display words', () => {
  const listQuestion = 'Does this patient have atrial fibrillation?';
  const facts = [
    'Atrial fibrillation',
    'Chronic atrial fibrillation (permanent, persistent or long-standing)',
    'Chronic atrial fibrillation',
    'Atrial fibrillation (chronic or paroxysmal)'
  ];
  const items = facts.map((what, index) => criterion(`AF-${index + 1}`, what));

  function markerFile(): string {
    const dir = tempDir();
    const file = path.join(dir, 'condition-markers.json');
    fs.writeFileSync(file, JSON.stringify({ conditions: [{
      condition: 'Atrial fibrillation',
      question: listQuestion,
      fact_names: facts,
      points_to_it: [{ ingredient: 'sacubitril with valsartan', brands: ['Entresto'], forms: [] }],
      also_used_for_it: []
    }] }));
    return file;
  }

  function shownQuestions(engine: Engine) {
    return engine.stateResponse().state.cases[0]?.questions ?? [];
  }

  function openTitles(engine: Engine): string[] {
    return shownQuestions(engine).filter(q => q.status === 'open').map(q => q.conditionMarker?.question ?? q.what);
  }

  it('shows four different fact titles when four facts share one open list question', async () => {
    const { engine } = await imported(
      [supply('sacubitril with valsartan', 'Entresto')], items, { markerFile: markerFile() }
    );
    expect(questions(engine)).toHaveLength(4);
    expect(openTitles(engine)).toEqual(facts);
    expect(new Set(openTitles(engine)).size).toBe(4);
    expect(openTitles(engine)).not.toContain(listQuestion);
    for (const q of shownQuestions(engine)) {
      expect(q.note).toBe('Asked because Entresto (sacubitril with valsartan) 24/26 mg tablet is supplied; it points to Atrial fibrillation.');
    }
    expect(questions(engine).map(q => q.conditionMarker?.question)).toEqual(facts.map(() => listQuestion));
  });

  it('keeps the list question when only one of its facts is open', async () => {
    const { engine } = await imported(
      [supply('sacubitril with valsartan', 'Entresto')], [items[0]], { markerFile: markerFile() }
    );
    expect(openTitles(engine)).toEqual([listQuestion]);
  });

  it('answers only its own fact and leaves the other three open with distinct titles', async () => {
    const { engine } = await imported(
      [supply('sacubitril with valsartan', 'Entresto')], items, { markerFile: markerFile() }
    );
    const c = theCase(engine);
    const answered = questions(engine).find(q => q.what === facts[1]);
    if (!answered) throw new Error('The second fact question was not opened.');
    engine.answerQuestion(c.id, answered.id, { option: 'Yes' });
    await engine.whenIdle();

    const remaining = [facts[0], facts[2], facts[3]];
    expect(questions(engine).filter(q => q.status === 'open').map(q => q.what)).toEqual(remaining);
    expect(openTitles(engine)).toEqual(remaining);
    expect(answered.status).toBe('answered');
    expect(c.lines.some(line => line.text.includes(`CONDITION | ${facts[1]}. The patient has this.`))).toBe(true);
    for (const what of remaining) {
      expect(c.lines.some(line => line.text.includes(`CONDITION | ${what}. The patient has this.`))).toBe(false);
    }

    for (const what of remaining.slice(0, 2)) {
      const q = questions(engine).find(item => item.what === what);
      if (!q) throw new Error(`The question for ${what} was not opened.`);
      engine.answerQuestion(c.id, q.id, { option: 'Yes' });
      await engine.whenIdle();
    }
    expect(questions(engine).filter(q => q.status === 'open').map(q => q.what)).toEqual([facts[3]]);
    expect(openTitles(engine)).toEqual([listQuestion]);
  });

  it('changes nothing with the switch off', async () => {
    const rows = [supply('sacubitril with valsartan', 'Entresto')];
    const baseline = await imported(rows, items, { on: false, possible: true });
    const off = await imported(rows, items, { on: false, markerFile: markerFile(), possible: true });
    expect(JSON.stringify(off.engine.stateResponse())).toBe(JSON.stringify(baseline.engine.stateResponse()));
    expect(off.engine.stateResponse().state.cases[0]?.questions?.every(q => q.conditionMarker === undefined)).toBe(true);
  });
});

describe('condition-marker answers and scale', () => {
  it('screens after No without another import and gives the model the does-not-have line', async () => {
    const { engine, screened, seen } = await imported([supply('sacubitril with valsartan', 'Entresto')]);
    expect(questions(engine)).toHaveLength(1);
    const c = theCase(engine);
    engine.answerQuestion(c.id, questions(engine)[0].id, { option: 'No' });
    await engine.whenIdle();
    expect(screened).toEqual(['HF']);
    expect(theCase(engine).screening.criteria[0]?.status).toBe('clear');
    expect(questions(engine)[0]?.status).toBe('answered');
    expect(theCase(engine).lines.some(line => line.text.includes('No heart failure: the patient does not have it'))).toBe(true);
    expect(seen.flat().some(line => line.text.includes('No heart failure: the patient does not have it'))).toBe(true);
    expect(engine.state.cases).toHaveLength(1);
  });

  it('releases a marker-held criterion after Not known', async () => {
    const { engine, screened } = await imported([supply('sacubitril with valsartan', 'Entresto')]);
    expect(questions(engine)).toHaveLength(1);
    const c = theCase(engine);
    engine.answerQuestion(c.id, questions(engine)[0].id, { option: 'Not known' });
    await engine.whenIdle();
    expect(screened).toEqual(['HF']);
    expect(questions(engine)[0]?.status).toBe('not_known');
    expect(theCase(engine).screening.status).toBe('done');
  });

  it('handles thirty marker questions and thirty rapid answers in one further screening pass', async () => {
    const dir = tempDir();
    const file = path.join(dir, 'condition-markers.json');
    const criteria = Array.from({ length: 30 }, (_, i) => criterion(`M${i + 1}`, `Condition ${i + 1}`));
    const markers = {
      what_this_is: 'Thirty-question test.', version: '2026-11-20',
      conditions: criteria.map((item, i) => ({
        condition: `condition ${i + 1}`, question: `Does this patient have condition ${i + 1}?`,
        fact_names: [`Condition ${i + 1}`],
        points_to_it: [{ ingredient: 'sacubitril with valsartan', brands: ['Entresto'], forms: [], also_points_to: [] }],
        also_used_for_it: [], no_medicine_points_to_it: ''
      }))
    };
    fs.writeFileSync(file, JSON.stringify(markers));
    const { engine, screened } = await imported([supply('sacubitril with valsartan', 'Entresto')], criteria, { markerFile: file });
    expect(questions(engine)).toHaveLength(30);
    expect(screened).toEqual([]);
    const c = theCase(engine);
    for (const q of questions(engine)) engine.answerQuestion(c.id, q.id, { option: 'No' });
    await engine.whenIdle();
    expect(screened).toHaveLength(30);
    expect(new Set(screened).size).toBe(30);
    expect(theCase(engine).screening.status).toBe('done');
    expect(theCase(engine).screening.criteria.every(run => run.status === 'clear')).toBe(true);
  });
});

describe('condition-marker fallback is byte for byte', () => {
  it('leaves questions and state unchanged with the switch off, no file, or an unreadable file, and logs unreadable once', async () => {
    const rows = [supply('sacubitril with valsartan', 'Entresto')];
    const baseline = await imported(rows, [criterion('HF')], { on: false, possible: true });
    const offWithFile = await imported(rows, [criterion('HF')], { on: false, markerFile: FIXTURE, possible: true });
    const dir = tempDir();
    const missing = await imported(rows, [criterion('HF')], { markerFile: path.join(dir, 'missing.json'), possible: true });
    const brokenFile = path.join(dir, 'condition-markers.json');
    fs.writeFileSync(brokenFile, '{ not JSON');
    const broken = await imported(rows, [criterion('HF')], { markerFile: brokenFile, possible: true });

    const bytes = (engine: Engine): string => JSON.stringify(engine.stateResponse());
    expect(bytes(offWithFile.engine)).toBe(bytes(baseline.engine));
    expect(bytes(missing.engine)).toBe(bytes(baseline.engine));
    expect(bytes(broken.engine)).toBe(bytes(baseline.engine));
    expect(offWithFile.logs.filter(line => line.includes('condition-markers.json'))).toEqual([]);
    expect(missing.logs.filter(line => line.includes('condition-markers.json'))).toEqual([]);
    expect(broken.logs.filter(line => line.includes('condition-markers.json could not be read'))).toHaveLength(1);
    expect(questions(broken.engine).every(q => q.conditionMarker === undefined)).toBe(true);

    await broken.engine.importCase({ fileName: 'markers-again.csv', source: 'csv', csvText: csv(rows) });
    await broken.engine.whenIdle();
    expect(broken.logs.filter(line => line.includes('condition-markers.json could not be read'))).toHaveLength(1);
  });
});


describe('result and observation condition markers', () => {
  const markerQuestion = 'What liver enzymes were recorded, and on what date was the sample taken?';
  const customAnswers = [
    { words: 'Raised on the pathology report', effect: 'meets' as const },
    { words: 'Not raised', effect: 'does_not_meet' as const },
    { words: 'Not known', effect: 'unknown' as const }
  ];

  function markerFile(): string {
    const dir = tempDir();
    const file = path.join(dir, 'condition-markers.json');
    fs.writeFileSync(file, JSON.stringify({ conditions: [{
      condition: 'raised liver enzymes',
      question: markerQuestion,
      fact_names: ['Liver enzymes', 'Liver injury observation'],
      points_to_it: [{ ingredient: 'ursodeoxycholic acid', brands: ['Ursofalk'], forms: [] }],
      also_used_for_it: [{ ingredient: 'ramipril', brands: ['Tritace'], forms: [] }]
    }] }));
    return file;
  }

  function liverCriterion(kind: 'result' | 'observation' = 'result', withoutMedicine = false): Criterion {
    const item = criterion('LIVER', 'Unused');
    item.needs_facts = [{
      kind,
      what: kind === 'result' ? 'Liver enzymes' : 'Liver injury observation',
      meets: 'raised liver enzymes',
      ...(kind === 'observation' ? { options: customAnswers } : {})
    }];
    item.medicine_groups = withoutMedicine ? [] : [{
      key: 'A', name: 'Agomelatine', ingredients: ['agomelatine'], brands: { agomelatine: ['Valdoxan'] }
    }];
    return item;
  }

  function markerSupply(): Row {
    return { ...supply('ursodeoxycholic acid', 'Ursofalk'), strength: '250 mg' };
  }

  function criterionSupply(): Row {
    return { ...supply('agomelatine', 'Valdoxan'), strength: '25 mg' };
  }

  it('opens the existing typed result with its sample date when both marker and criterion medicines are supplied', async () => {
    const { engine, screened } = await imported(
      [criterionSupply(), markerSupply()], [liverCriterion()], { markerFile: markerFile() }
    );
    expect(questions(engine)).toHaveLength(1);
    const q = questions(engine)[0];
    expect(q).toMatchObject({
      kind: 'result', what: 'Liver enzymes', source: 'supply', status: 'open', needsValue: true,
      criterionIds: ['LIVER'], conditionMarker: {
        condition: 'raised liver enzymes', question: markerQuestion, lineIds: ['L002']
      }
    });
    expect(q.options).toEqual([{ words: 'Not known', effect: 'unknown' }]);
    expect(q.note).toBe('Asked because Ursofalk (ursodeoxycholic acid) 250 mg tablet is supplied; it points to raised liver enzymes.');
    expect(screened).toEqual([]);
    expect(theCase(engine).screening.criteria[0]?.status).toBe('waiting');

    engine.answerQuestion(theCase(engine).id, q.id, { value: 'ALT 90', unit: 'U/L', date: '2026-08-01' });
    await engine.whenIdle();
    expect(theCase(engine).lines.some(line => line.text ===
      '2026-08-01 | RESULT | Liver enzymes ALT 90 U/L. Entered by the pharmacist at the counter on 20 November 2026.'
    )).toBe(true);
  });

  it('does not ask a result for a criterion whose own medicine is absent', async () => {
    const { engine, screened } = await imported([markerSupply()], [liverCriterion()], { markerFile: markerFile() });
    expect(questions(engine)).toEqual([]);
    expect(screened).toEqual(['LIVER']);
  });

  it('allows a result marker for a criterion with no medicine group', async () => {
    const { engine, screened } = await imported(
      [markerSupply()], [liverCriterion('result', true)], { markerFile: markerFile() }
    );
    expect(questions(engine).map(q => q.what)).toEqual(['Liver enzymes']);
    expect(screened).toEqual([]);
  });

  it('does not ask when a result line is already in the record', async () => {
    const result: Row = {
      date: '2026-08-01', recordType: 'result', detail: 'Liver enzymes', value: 'ALT 90 U/L'
    };
    const { engine, screened } = await imported(
      [criterionSupply(), markerSupply(), result], [liverCriterion()], { markerFile: markerFile() }
    );
    expect(questions(engine)).toEqual([]);
    expect(screened).toEqual(['LIVER']);
  });

  it('does not open for an also-used medicine alone', async () => {
    const alsoUsed: Row = { ...supply('ramipril', 'Tritace'), strength: '5 mg' };
    const { engine, screened } = await imported(
      [criterionSupply(), alsoUsed], [liverCriterion()], { markerFile: markerFile() }
    );
    expect(questions(engine)).toEqual([]);
    expect(screened).toEqual(['LIVER']);
  });

  it('keeps an observation’s own answers', async () => {
    const { engine, screened } = await imported(
      [criterionSupply(), markerSupply()], [liverCriterion('observation')], { markerFile: markerFile() }
    );
    expect(questions(engine)).toHaveLength(1);
    expect(questions(engine)[0]).toMatchObject({
      kind: 'observation', what: 'Liver injury observation', needsValue: false, options: customAnswers
    });
    expect(questions(engine)[0]?.note).toBe(
      'Asked because Ursofalk (ursodeoxycholic acid) 250 mg tablet is supplied; it points to raised liver enzymes.'
    );
    expect(screened).toEqual([]);
  });

  it('is byte for byte the off baseline when off, missing or unreadable', async () => {
    const file = markerFile();
    const rows = [criterionSupply(), markerSupply()];
    const baseline = await imported(rows, [liverCriterion()], { on: false, markerFile: file, possible: true });
    const dir = tempDir();
    const missing = await imported(rows, [liverCriterion()], {
      markerFile: path.join(dir, 'missing.json'), possible: true
    });
    const brokenFile = path.join(dir, 'condition-markers.json');
    fs.writeFileSync(brokenFile, '{ not JSON');
    const broken = await imported(rows, [liverCriterion()], { markerFile: brokenFile, possible: true });
    const bytes = (engine: Engine): string => JSON.stringify(engine.stateResponse());
    expect(bytes(missing.engine)).toBe(bytes(baseline.engine));
    expect(bytes(broken.engine)).toBe(bytes(baseline.engine));
    expect(missing.logs.filter(line => line.includes('condition-markers.json'))).toEqual([]);
    expect(broken.logs.filter(line => line.includes('condition-markers.json could not be read'))).toHaveLength(1);
    expect(questions(broken.engine).every(q => q.conditionMarker === undefined)).toBe(true);
  });
});
