// docs/SPEC.md section 6a in the server: a possible finding and its missing facts go through the
// state and the API, a state saved before 18 November still loads, and a criterion file that does
// not load is named while the others stay in use. No model is called: the tests pass stand-ins.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppState, CheckResult, Criterion, Finding, LetterDraft, ScreenResult, StateResponse } from '../shared/types.ts';
import { factsCriterion, testConfig, testCriterion } from '../pipeline/testkit.ts';
import { handleApi } from './api.ts';
import { Engine, type CriterionLoadProblem, type LoadedCriteria, type PipelineFns } from './engine.ts';
import { PageImages } from './images.ts';
import { emptyState, isState, StateStore, withNewFields } from './store.ts';

const made: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const EGFR = 'eGFR (estimated kidney function), the most recent result';
const FACTS: Criterion = { ...factsCriterion, id: 'FACTS', label: 'Criterion with facts' };
const PLAIN: Criterion = { ...testCriterion, id: 'PLAIN', label: 'Criterion without facts' };

// A record that also carries a condition and a result (the three optional columns).
const RECORD_CSV = [
  'patient_ref,patient_age,patient_sex,record_type,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber,detail,value',
  'F-021,74,F,condition,2025-12-02,,,,,,,,,Atrial fibrillation,',
  'F-021,74,F,,2025-12-08,,Lanoxin,250 microgram,tablet,100,2,Take ONE tablet daily,Dr A. Example,,',
  'F-021,74,F,result,2026-05-12,,,,,,,,,eGFR,24 mL/min/1.73 m2',
  'F-021,74,F,dispensed,2026-06-16,,Lanoxin,250 microgram,tablet,100,0,Take ONE tablet daily,Dr A. Example,,'
].join('\r\n');

function screenResult(lineIds: string[], missingFacts: string[]): ScreenResult {
  return { lineIds, medicines: ['digoxin'], reason: 'Digoxin long term.', linesVerified: lineIds.length > 0, missingFacts, model: 'lantern-screen', at: '2026-11-18T00:00:00.000Z', seconds: 1 };
}

function checkResult(confirmed: boolean, lineIds: string[]): CheckResult {
  return { confirmed, lineIds, whatMatches: 'Lanoxin is supplied.', whatCannotBeSeen: 'A digoxin level.', completed: true, model: 'lantern-check', at: '2026-11-18T00:00:10.000Z', seconds: 2 };
}

interface Rig {
  engine: Engine;
  dir: string;
  calls: string[];
  lettersFor: Finding[];
  behaviour: {
    screen: (criterion: Criterion) => Awaited<ReturnType<PipelineFns['screenCriterion']>>;
    check: (screen: ScreenResult) => CheckResult;
    criteria: () => LoadedCriteria;
  };
}

function rig(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-records-'))): Rig {
  if (!made.includes(dir)) made.push(dir);
  const store = new StateStore(dir);
  store.load();
  const calls: string[] = [];
  const lettersFor: Finding[] = [];
  const behaviour: Rig['behaviour'] = {
    screen: criterion => criterion.id === 'FACTS'
      ? { ok: true, suspected: true, result: screenResult(['L002', 'L004'], [EGFR]) }
      : { ok: true, suspected: false, result: screenResult([], []) },
    check: screen => checkResult(true, screen.lineIds),
    criteria: () => [PLAIN, FACTS]
  };
  const pipeline: PipelineFns = {
    screenCriterion: async (_cfg, _patient, _lines, criterion) => {
      calls.push(`screen ${criterion.id}`);
      return behaviour.screen(criterion);
    },
    checkFinding: async (_cfg, _patient, _lines, criterion, screen) => {
      calls.push(`check ${criterion.id}`);
      return behaviour.check(screen);
    },
    draftLetter: async (_cfg, _patient, _lines, _criterion, finding): Promise<LetterDraft> => {
      lettersFor.push(JSON.parse(JSON.stringify(finding)) as Finding);
      return { subject: 'Review request', body: 'Fictional patient. No real person.\n\nThe letter text.', origin: 'model', checkNotes: [], model: 'lantern-letter', at: '2026-11-18T00:01:00.000Z', seconds: 2 };
    },
    transcribePageImage: async () => ({ ok: true, rows: [] })
  };
  const engine = new Engine({
    cfg: testConfig, store, pipeline, images: new PageImages(path.join(dir, 'images')),
    loadCriteria: async () => behaviour.criteria(),
    now: () => new Date('2026-11-18T01:00:00.000Z')
  });
  return { engine, dir, calls, lettersFor, behaviour };
}

async function importRecord(r: Rig): Promise<string> {
  const { caseId } = await r.engine.importCase({ fileName: 'record.csv', source: 'csv', csvText: RECORD_CSV });
  await r.engine.whenIdle();
  return caseId;
}

function onDisk(dir: string): AppState {
  const reread = new StateStore(dir);
  reread.load();
  return reread.state;
}

describe('a record that also carries conditions and results', () => {
  it('is imported with its fact lines, numbered with the supplies in file order', async () => {
    const r = rig();
    await r.engine.start();
    await importRecord(r);
    const c = r.engine.state.cases[0];
    expect(c.cannotAssess).toBeUndefined();
    expect(c.patient).toEqual({ label: 'Fictional patient F-021', age: 74, sex: 'F', ageFrom: 'record' });
    expect(c.lines).toEqual([
      { id: 'L001', text: '2025-12-02 | CONDITION | Atrial fibrillation' },
      { id: 'L002', text: '2025-12-08 | Lanoxin 250 microgram tablet | qty 100 | repeats 2 | Take ONE tablet daily | Dr A. Example' },
      { id: 'L003', text: '2026-05-12 | RESULT | eGFR 24 mL/min/1.73 m2' },
      { id: 'L004', text: '2026-06-16 | Lanoxin 250 microgram tablet | qty 100 | repeats 0 | Take ONE tablet daily | Dr A. Example' }
    ]);
    expect(c.screening.criteria.map(run => [run.criterionId, run.status])).toEqual([['PLAIN', 'clear'], ['FACTS', 'suspected']]);
  });
});

describe('a possible finding in the state', () => {
  it('is marked possible, keeps its missing facts, and says so in the log at each step', async () => {
    const r = rig();
    await r.engine.start();
    await importRecord(r);
    const f = r.engine.state.findings[0];
    expect(f).toMatchObject({ id: 'F0001', criterionId: 'FACTS', state: 'confirmed', possible: true });
    expect(f.screen.missingFacts).toEqual([EGFR]);
    const texts = r.engine.state.activity.map(a => a.text);
    expect(texts).toContain(
      `Mantle suspects a possible finding for Criterion with facts on record.csv (criterion 2 of 2). The record does not show: ${EGFR}. It goes to the second check.`);
    expect(texts).toContain(
      `Lumen confirmed the possible finding for Criterion with facts on record.csv. The record does not show: ${EGFR}. It is waiting for the pharmacist.`);
    // It waits under the bell like any confirmed finding, and the file on disk holds the same.
    expect(r.engine.stateResponse().counts).toMatchObject({ findingsConfirmed: 1, bellBadge: 1 });
    expect(onDisk(r.dir)).toEqual(r.engine.state);
    expect(onDisk(r.dir).findings[0]).toMatchObject({ possible: true, screen: { missingFacts: [EGFR] } });
  });

  it('gives the letter job the finding with its mark and its missing facts', async () => {
    const r = rig();
    await r.engine.start();
    await importRecord(r);
    r.engine.decide('F0001', { action: 'accept' });
    await r.engine.whenIdle();
    expect(r.lettersFor).toHaveLength(1);
    expect(r.lettersFor[0]).toMatchObject({ id: 'F0001', state: 'accepted', possible: true, screen: { missingFacts: [EGFR] } });
    expect(r.engine.state.letters[0].status).toBe('ready');
  });

  it('stays a possible finding when the second check turns it back or does not finish', async () => {
    const turnedBack = rig();
    turnedBack.behaviour.check = () => checkResult(false, []);
    await turnedBack.engine.start();
    await importRecord(turnedBack);
    expect(turnedBack.engine.state.findings[0]).toMatchObject({ state: 'not_confirmed', possible: true });

    const notFinished = rig();
    notFinished.behaviour.check = screen => ({ ...checkResult(false, screen.lineIds), completed: false });
    await notFinished.engine.start();
    await importRecord(notFinished);
    expect(notFinished.engine.state.findings[0]).toMatchObject({ state: 'confirmed', possible: true });   // shown, never dropped
  });

  it('is not possible when the first model named no missing fact, and the log reads as before', async () => {
    const r = rig();
    r.behaviour.screen = criterion => criterion.id === 'FACTS'
      ? { ok: true, suspected: true, result: screenResult(['L002', 'L003', 'L004'], []) }
      : { ok: true, suspected: false, result: screenResult([], []) };
    await r.engine.start();
    await importRecord(r);
    expect(r.engine.state.findings[0]).toMatchObject({ state: 'confirmed', possible: false });
    expect(r.engine.state.findings[0].screen.missingFacts).toEqual([]);
    const texts = r.engine.state.activity.map(a => a.text);
    expect(texts).toContain('Mantle suspects a finding for Criterion with facts on record.csv (criterion 2 of 2). It goes to the second check.');
    expect(texts).toContain('Lumen confirmed the finding for Criterion with facts on record.csv. It is waiting for the pharmacist.');
    expect(texts.some(t => t.includes('possible finding'))).toBe(false);
  });

  it('gets both fields even when a model job gives a result without the list', async () => {
    const r = rig();
    const { missingFacts: _none, ...old } = screenResult(['L002'], []);
    r.behaviour.screen = criterion => criterion.id === 'FACTS'
      ? { ok: true, suspected: true, result: old as ScreenResult }
      : { ok: true, suspected: false, result: screenResult([], []) };
    await r.engine.start();
    await importRecord(r);
    expect(r.engine.state.findings[0].possible).toBe(false);
    expect(r.engine.state.findings[0].screen.missingFacts).toEqual([]);
  });
});

describe('a possible finding through the API', () => {
  it('GET /api/state gives "possible" and "missingFacts" for every finding, and GET /api/criteria gives the facts a criterion needs', async () => {
    const r = rig();
    await r.engine.start();
    const server = http.createServer((req, res) => {
      void handleApi(r.engine, req, res, new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const imported = await fetch(`${base}/api/cases`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: 'record.csv', source: 'csv', csvText: RECORD_CSV })
    });
    expect(imported.status).toBe(200);
    await r.engine.whenIdle();

    const state = await (await fetch(`${base}/api/state`)).json() as StateResponse;
    expect(state.state.findings).toHaveLength(1);
    expect(state.state.findings[0].possible).toBe(true);
    expect(state.state.findings[0].screen.missingFacts).toEqual([EGFR]);
    expect(state.state.cases[0].lines[2]).toEqual({ id: 'L003', text: '2026-05-12 | RESULT | eGFR 24 mL/min/1.73 m2' });

    const criteria = await (await fetch(`${base}/api/criteria`)).json() as Criterion[];
    expect(criteria.map(c => c.id)).toEqual(['PLAIN', 'FACTS']);
    expect(criteria[1].needs_facts).toEqual(factsCriterion.needs_facts);
    expect('needs_facts' in criteria[0]).toBe(false);

    const decided = await fetch(`${base}/api/findings/F0001/decision`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'accept' })
    });
    const answer = await decided.json() as { finding: Finding };
    expect(answer.finding).toMatchObject({ state: 'accepted', possible: true, screen: { missingFacts: [EGFR] } });
    await r.engine.whenIdle();
  });
});

describe('a state saved before 18 November', () => {
  function oldState(): Record<string, unknown> {
    const state = emptyState();
    state.cases.push({
      id: 'C0001', fileName: 'positive.csv', importedAt: '2026-11-18T00:00:00.000Z', source: 'csv',
      patient: { label: 'Fictional patient F-001' },
      lines: [{ id: 'L001', text: '2026-08-08 | Xarelto 20 mg tablet' }, { id: 'L002', text: '2026-08-21 | Celebrex 200 mg capsule' }],
      transcriptionConfirmed: true, parts: 1,
      screening: { status: 'done', criteria: [{ criterionId: 'PLAIN', status: 'suspected', seconds: 5 }, { criterionId: 'FACTS', status: 'suspected', seconds: 5 }] }
    });
    const raw = JSON.parse(JSON.stringify(state)) as { findings: unknown[] };
    // Two findings as the first build wrote them: no "possible", no "missingFacts".
    raw.findings.push({
      id: 'F0001', caseId: 'C0001', criterionId: 'PLAIN', state: 'confirmed', seenByPharmacist: true,
      screen: { lineIds: ['L001', 'L002'], medicines: ['celecoxib'], reason: 'Both.', linesVerified: true, model: 'lantern-screen', at: '2026-11-18T00:00:05.000Z', seconds: 5 },
      check: { confirmed: true, lineIds: ['L001', 'L002'], whatMatches: 'Both.', whatCannotBeSeen: 'x', completed: true, model: 'lantern-check', at: '2026-11-18T00:00:09.000Z', seconds: 4 }
    });
    raw.findings.push({
      id: 'F0002', caseId: 'C0001', criterionId: 'FACTS', state: 'suspected', seenByPharmacist: false,
      screen: { lineIds: ['L002'], medicines: ['celecoxib'], reason: 'One.', linesVerified: true, model: 'lantern-screen', at: '2026-11-18T00:00:06.000Z', seconds: 5 }
    });
    return raw as Record<string, unknown>;
  }

  it('still loads: a finding without the new fields is not possible and has an empty list', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-records-'));
    made.push(dir);
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(oldState()));
    const store = new StateStore(dir);
    store.load();
    expect(store.loadNote).toBeNull();
    expect(store.state.findings.map(f => [f.id, f.possible, f.screen.missingFacts])).toEqual([['F0001', false, []], ['F0002', false, []]]);
    expect(fs.existsSync(path.join(dir, 'backups'))).toBe(false);         // nothing was set aside
  });

  it('is picked up by the server: the open check runs, and the saved file gains the fields', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-records-'));
    made.push(dir);
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(oldState()));
    const r = rig(dir);
    await r.engine.start();
    await r.engine.whenIdle();
    expect(r.calls).toEqual(['check FACTS']);
    expect(r.engine.state.findings.map(f => [f.id, f.state, f.possible])).toEqual([['F0001', 'confirmed', false], ['F0002', 'confirmed', false]]);
    expect(onDisk(dir).findings.every(f => f.possible === false && Array.isArray(f.screen.missingFacts))).toBe(true);
  });

  it('keeps a mark and a list that are there, and takes the mark from the list when only the list is there', () => {
    const state = emptyState();
    const finding = (possible: unknown, missingFacts: unknown): Finding => ({
      id: 'F0001', caseId: 'C0001', criterionId: 'FACTS', state: 'suspected', seenByPharmacist: false, possible,
      screen: { lineIds: [], medicines: [], reason: '', linesVerified: false, missingFacts, model: 'm', at: '', seconds: 0 }
    } as unknown as Finding);
    state.findings.push(finding(true, [EGFR]), finding(undefined, [EGFR]), finding(undefined, undefined), finding(false, []));
    expect(withNewFields(state).findings.map(f => [f.possible, f.screen.missingFacts])).toEqual([[true, [EGFR]], [true, [EGFR]], [false, []], [false, []]]);
  });

  it('is not taken as a state when a new field has the wrong kind of value', () => {
    const wrongMark = oldState() as { findings: Record<string, unknown>[] };
    wrongMark.findings[0].possible = 'yes';
    expect(isState(wrongMark)).toBe(false);
    const wrongList = oldState() as { findings: { screen: Record<string, unknown> }[] };
    wrongList.findings[0].screen.missingFacts = 'eGFR';
    expect(isState(wrongList)).toBe(false);
    expect(isState(oldState())).toBe(true);
  });
});

describe('a criterion file that does not load', () => {
  const problem: CriterionLoadProblem = { id: 'BROKEN', error: 'Criterion BROKEN: "statement" is missing.' };

  it('is named in the log once, and the other criteria stay in use', async () => {
    const r = rig();
    r.behaviour.criteria = () => ({ criteria: [PLAIN, FACTS], problems: [problem] });
    await r.engine.start();
    expect(r.engine.criteriaError).toBeNull();
    expect(r.engine.criteriaProblems).toEqual([problem]);
    await importRecord(r);
    await r.engine.refreshCriteria();
    await r.engine.refreshCriteria();
    const notes = r.engine.state.activity.filter(a => a.text.includes('could not be loaded'));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      kind: 'error',
      text: '1 criterion could not be loaded and is not screened: BROKEN. The first reason: Criterion BROKEN: "statement" is missing. The other criteria are in use.'
    });
    // The history was screened against the criteria that loaded.
    expect(r.engine.state.cases[0].screening.criteria.map(run => run.criterionId)).toEqual(['PLAIN', 'FACTS']);
    expect(r.engine.state.findings[0].criterionId).toBe('FACTS');
  });

  it('says so when every criterion loads again, and names the file again after a clean start', async () => {
    const r = rig();
    let broken = true;
    r.behaviour.criteria = () => (broken ? { criteria: [PLAIN], problems: [problem, { id: 'ALSO', error: 'x' }] } : [PLAIN, FACTS]);
    await r.engine.start();
    expect(r.engine.state.activity[0].text).toBe(
      '2 criteria could not be loaded and are not screened: BROKEN, ALSO. The first reason: Criterion BROKEN: "statement" is missing. The other criteria are in use.');
    await r.engine.reset();
    expect(r.engine.state.activity.map(a => a.kind)).toEqual(['reset', 'error']);     // named again in the clean log
    broken = false;
    await r.engine.refreshCriteria();
    expect(r.engine.criteriaProblems).toEqual([]);
    expect(r.engine.state.activity[r.engine.state.activity.length - 1].text).toBe('Every criterion in the list loads again.');
  });

  it('leaves a plain list of criteria as it was: no note at all', async () => {
    const r = rig();
    await r.engine.start();
    await importRecord(r);
    expect(r.engine.criteriaProblems).toEqual([]);
    expect(r.engine.state.activity.some(a => a.text.includes('could not be loaded') || a.text.includes('loads again'))).toBe(false);
  });
});
