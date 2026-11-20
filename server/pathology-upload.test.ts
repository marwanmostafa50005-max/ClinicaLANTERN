// The pathology upload, server side: a typed result can also be read from an uploaded pathology test.
// Every report line here is fictional. No model is called: the reading model is a stand-in.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { longDate } from '../pipeline/dates.ts';
import { templateLetter } from '../pipeline/letter.ts';
import { testConfig } from '../pipeline/testkit.ts';
import {
  PATHOLOGY_PAGE_SYSTEM, PATHOLOGY_PAGE_TASK, agreedLines, sameLine, transcribePathologyPage, type PathologyPageOutcome
} from '../pipeline/transcribe-pathology.ts';
import type { CaseRecord, Criterion, Finding, PharmacistQuestion } from '../shared/types.ts';
import { ApiError, Engine, PATHOLOGY_MODEL_BUSY, PATHOLOGY_NO_MODEL, PATHOLOGY_TWO_READINGS, type PipelineFns } from './engine.ts';
import { MAX_BODY_BYTES, handleApi } from './api.ts';
import { PageImages } from './images.ts';
import { answerLineText, chosenFrom, dayOf, pathologyOf, sourceFrom } from './questions.ts';
import { StateStore } from './store.ts';

const made: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function serve(engine: Engine): Promise<{ base: string; port: number }> {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    void handleApi(engine, req, res, pathname);
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, port };
}

async function postJson(base: string, route: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(base + route, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}

function declaredBodyLength(port: number, route: string, length: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: route, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': length }
    }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
}

function criterion(id: string, ingredient: string, brand: string, fact: NonNullable<Criterion['needs_facts']>[number]): Criterion {
  return {
    id, label: `${id} test`, family: 'Test', title: `${id} test`,
    statement: 'Test wording. This is not a published criterion.', statement_origin: 'entrant',
    source: { document: 'Test', citation: 'Test', licence: 'Test', licence_status: 'proposed', credit: 'Test wording written for this prototype. It is not a published criterion.' },
    plain_summary: 'A test criterion.',
    medicine_groups: [{ key: 'A', name: 'The medicine', ingredients: [ingredient], brands: { [ingredient]: [brand] } }],
    rule_for_models: 'Suspect when the named medicine is supplied.',
    cannot_be_seen: 'The result the record does not show.', ask_the_gp: 'A review.', urgency: 'routine',
    draft: true, signed_by_clinical_reviewer: null, needs_facts: [fact]
  };
}

const SOD = criterion('SOD', 'sertraline', 'Zoloft', { kind: 'result', what: 'Serum sodium', meets: 'below 130 mmol/L', ask_when: { group: 'A' } });
const CRCL = criterion('CRCL', 'gabapentin', 'Neurontin', { kind: 'result', what: 'Creatinine clearance (unindexed, mL/min)', meets: 'below 60 mL/min', ask_when: { group: 'A' } });
const HF = criterion('HF', 'ibuprofen', 'Nurofen', { kind: 'condition', what: 'Heart failure', meets: 'the patient has heart failure', ask_when: { group: 'A' } });

const REPORT = [
  'FICTIONAL PATHOLOGY (a made-up report for testing)',
  'Patient: Fictional patient P-01',
  'Date of collection: 12 March 2026 08:15',
  'Sodium 128 mmol/L (135-145) L',
  'Potassium 4.4 mmol/L (3.5-5.2)'
];

type Reader = (image: string) => PathologyPageOutcome | Promise<PathologyPageOutcome>;

function open(reader?: Reader): { engine: Engine; screened: string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-path-'));
  made.push(dir);
  const store = new StateStore(dir);
  store.load();
  const screened: string[] = [];
  const pipeline: PipelineFns = {
    screenCriterion: async (_cfg, _patient, _lines, item) => {
      screened.push(item.id);
      return { ok: true, suspected: false, result: { lineIds: [], medicines: [], missingFacts: [], reason: 'Nothing to report.', linesVerified: true, model: 'lantern-screen', at: '2026-11-20T00:00:00.000Z', seconds: 1 } };
    },
    checkFinding: async () => { throw new Error('This step was not part of the pathology test.'); },
    draftLetter: async () => { throw new Error('This step was not part of the pathology test.'); },
    transcribePageImage: async () => { throw new Error('This step was not part of the pathology test.'); },
    ...(reader ? { transcribePathologyPage: async (_cfg, image) => reader(image) } : {})
  };
  const engine = new Engine({
    cfg: testConfig, store, pipeline, images: new PageImages(path.join(dir, 'images')),
    loadCriteria: async () => [SOD, CRCL, HF], warmup: false, modelsUp: async () => true
  });
  return { engine, screened };
}

async function imported(reader?: Reader): Promise<{ engine: Engine; screened: string[]; c: CaseRecord }> {
  const opened = open(reader);
  await opened.engine.start();
  const head = 'patient_ref,patient_age,patient_sex,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber';
  const rows = [['sertraline', 'Zoloft'], ['gabapentin', 'Neurontin'], ['ibuprofen', 'Nurofen']]
    .map(([medicine, brand]) => `F-001,72,F,2026-03-01,${medicine},${brand},100 mg,tablet,30,1,one daily,Dr A. Example`);
  await opened.engine.importCase({ fileName: 'fictional.csv', source: 'csv', csvText: `${head}\n${rows.join('\n')}\n` });
  await opened.engine.whenIdle();
  return { ...opened, c: opened.engine.state.cases[0] };
}

function question(c: CaseRecord, what: string): PharmacistQuestion {
  const q = (c.questions ?? []).find(item => item.what === what);
  if (!q) throw new Error(`No question for ${what}.`);
  return q;
}

async function refusal(run: () => Promise<unknown>): Promise<ApiError> {
  try { await run(); } catch (e) { if (e instanceof ApiError) return e; throw e; }
  throw new Error('The call was not refused.');
}

describe('a question says whether a pathology test can answer it', () => {
  it('names the tests on a result the reader knows, and nothing on any other question', async () => {
    const { c } = await imported();
    expect(question(c, 'Serum sodium').pathology).toEqual({ tests: [{ key: 'sodium', name: 'Sodium' }] });
    expect(question(c, 'Creatinine clearance (unindexed, mL/min)').pathology).toBeUndefined();
    expect(question(c, 'Heart failure').pathology).toBeUndefined();
    expect(pathologyOf({ kind: 'result', what: 'Serum sodium' })).toEqual({ pathology: { tests: [{ key: 'sodium', name: 'Sodium' }] } });
    expect(pathologyOf({ kind: 'condition', what: 'Hyponatraemia with low serum sodium' })).toEqual({});
  });
});

describe('reading a pathology test that has a text layer', () => {
  it('gives the reading with its line, page and collection date, and writes nothing', async () => {
    const { engine, c } = await imported();
    const q = question(c, 'Serum sodium');
    const linesBefore = c.lines.map(line => line.text);
    const got = await engine.readPathologyTest(c.id, q.id, { fileName: 'fictional-report.pdf', pages: [REPORT] });
    expect(got.fact).toBe('Serum sodium');
    expect(got.tests).toEqual([{ key: 'sodium', name: 'Sodium' }]);
    expect(got.readings).toHaveLength(1);
    expect(got.readings[0]).toMatchObject({
      analyte: 'sodium', value: 128, valueWords: '128', unit: 'mmol/L', refLow: 135, refHigh: 145, flag: 'L',
      date: '2026-03-12', line: 'Sodium 128 mmol/L (135-145) L', page: 1, sure: true, readBy: 'text'
    });
    expect(got.collected).toEqual({ date: '2026-03-12', line: 'Date of collection: 12 March 2026 08:15' });
    expect(got.abstained).toEqual([]);
    expect(got.note).toBeUndefined();
    expect(c.lines.map(line => line.text)).toEqual(linesBefore);
    expect(q.status).toBe('open');
    expect(q.answer).toBeUndefined();
  });

  it('skips overlong lines whole, names their page once, and reads the ordinary result rows', async () => {
    const { engine, c } = await imported();
    const got = await engine.readPathologyTest(c.id, question(c, 'Serum sodium').id, {
      fileName: 'long-footer.pdf',
      pages: [[
        ...REPORT,
        `Sodium 999 mmol/L ${'x'.repeat(301)}`,
        `Accreditation and comment ${'x'.repeat(301)}`
      ]]
    });
    expect(got.readings).toHaveLength(1);
    expect(got.readings[0]).toMatchObject({ value: 128, line: 'Sodium 128 mmol/L (135-145) L', page: 1, sure: true });
    expect(got.abstained).toEqual(['2 lines on page 1 are too long to be result rows and were not read.']);
    expect(got.note).toBeUndefined();
  });

  it('finds no result and shows the abstention when the wanted result stands only on an overlong line', async () => {
    const { engine, c } = await imported();
    const got = await engine.readPathologyTest(c.id, question(c, 'Serum sodium').id, {
      fileName: 'long-result.pdf',
      pages: [
        ['Patient: Fictional patient P-01', 'Date of collection: 12 March 2026 08:15'],
        [`Sodium 128 mmol/L (135-145) L ${'x'.repeat(301)}`]
      ]
    });
    expect(got.readings).toEqual([]);
    expect(got.abstained).toEqual(['One line on page 2 is too long to be a result row and was not read.']);
    expect(got.note).toBe('No Sodium result was found in this document. Type the result from the report.');
  });

  it('says so in plain words when the document holds no such result', async () => {
    const { engine, c } = await imported();
    const got = await engine.readPathologyTest(c.id, question(c, 'Serum sodium').id, { fileName: 'other.pdf', pages: [['Collected: 12/03/2026', 'Potassium 4.4 mmol/L (3.5-5.2)']] });
    expect(got.readings).toEqual([]);
    expect(got.note).toBe('No Sodium result was found in this document. Type the result from the report.');
  });

  it('passes on the reason when a line fails a check, and uses no value from it', async () => {
    const { engine, c } = await imported();
    const got = await engine.readPathologyTest(c.id, question(c, 'Serum sodium').id, { fileName: 'bad.pdf', pages: [['Collected: 12/03/2026', 'Sodium 1280 mmol/L (135-145) H']] });
    expect(got.readings).toEqual([]);
    expect(got.abstained).toHaveLength(1);
    expect(got.abstained[0]).toContain('a misread is suspected');
  });

  it('refuses a question that a pathology test cannot answer, in plain words', async () => {
    const { engine, c } = await imported();
    const crcl = await refusal(() => engine.readPathologyTest(c.id, question(c, 'Creatinine clearance (unindexed, mL/min)').id, { fileName: 'r.pdf', pages: [REPORT] }));
    expect(crcl.status).toBe(400);
    expect(crcl.message).toBe('This question is not answered from a pathology test. Type the answer.');
    const condition = await refusal(() => engine.readPathologyTest(c.id, question(c, 'Heart failure').id, { fileName: 'r.pdf', pages: [REPORT] }));
    expect(condition.status).toBe(400);
    const empty = await refusal(() => engine.readPathologyTest(c.id, question(c, 'Serum sodium').id, { fileName: 'r.pdf' }));
    expect(empty.message).toBe('The pathology test is empty.');
    const long = await refusal(() => engine.readPathologyTest(c.id, question(c, 'Serum sodium').id, { fileName: 'r.pdf', pages: Array.from({ length: 11 }, () => REPORT) }));
    expect(long.message).toContain('more than 10 pages');
    const missing = await refusal(() => engine.readPathologyTest(c.id, 'Q9999', { fileName: 'r.pdf', pages: [REPORT] }));
    expect(missing.status).toBe(404);
  });

  it('refuses a question that already has an answer', async () => {
    const { engine, c } = await imported();
    const q = question(c, 'Serum sodium');
    engine.answerQuestion(c.id, q.id, { value: '128', unit: 'mmol/L', date: '2026-03-12' });
    const again = await refusal(() => engine.readPathologyTest(c.id, q.id, { fileName: 'r.pdf', pages: [REPORT] }));
    expect(again.status).toBe(409);
  });
});

describe('the answer says where the value came from', () => {
  const today = dayOf(new Date());
  const source = { kind: 'pathology', fileName: 'fictional-report.pdf', page: 1, line: 'Sodium 128 mmol/L (135-145) L', readBy: 'text' };

  it('writes the file name and the line of the report, and screens the waiting criterion', async () => {
    const { engine, c, screened } = await imported();
    const q = question(c, 'Serum sodium');
    expect(screened).not.toContain('SOD');
    engine.answerQuestion(c.id, q.id, { value: '128', unit: 'mmol/L (laboratory range 135 to 145)', date: '2026-03-12', source });
    await engine.whenIdle();
    const line = c.lines.find(item => item.text.includes('pathology test'));
    expect(line?.text).toBe(
      '2026-03-12 | RESULT | Serum sodium 128 mmol/L (laboratory range 135 to 145). ' +
      'Read from the uploaded pathology test "fictional-report.pdf" (page 1; the line of the report: "Sodium 128 mmol/L (135-145) L") ' +
      `and confirmed by the pharmacist at the counter on ${longDate(today)}.`
    );
    expect(screened).toContain('SOD');
  });

  it('writes a typed value exactly as before when no source is sent', async () => {
    const { engine, c } = await imported();
    const q = question(c, 'Serum sodium');
    engine.answerQuestion(c.id, q.id, { value: '128', unit: 'mmol/L', date: '2026-03-12' });
    const line = c.lines.find(item => item.text.includes('pharmacist at the counter'));
    expect(line?.text).toBe(`2026-03-12 | RESULT | Serum sodium 128 mmol/L. Entered by the pharmacist at the counter on ${longDate(today)}.`);
  });

  it('refuses a source that is not whole, and keeps field marks and quote marks out of the line', async () => {
    const { c } = await imported();
    const q = question(c, 'Serum sodium');
    expect(chosenFrom(q, { value: '128', unit: 'mmol/L', date: '2026-03-12', source: { kind: 'pathology', fileName: 'a.pdf', page: 1, readBy: 'text' } }, today).error)
      .toBe('The source of the result could not be read.');
    expect(sourceFrom({ kind: 'pathology', fileName: 'a.pdf', page: 0, line: 'x', readBy: 'text' }).error).toBe('The source of the result could not be read.');
    expect(sourceFrom(undefined)).toEqual({});
    const odd = sourceFrom({ kind: 'pathology', fileName: 'C:\\scans\\re"port|1.pdf', page: 2, line: 'Sodium | 128 "mmol/L"\n(135-145)', readBy: 'model' });
    expect(odd.source).toEqual({ kind: 'pathology', fileName: "C:\\scans\\re'port/1.pdf", page: 2, line: "Sodium / 128 'mmol/L' (135-145)", readBy: 'model' });
    const chosen = chosenFrom(q, { value: '128', unit: 'mmol/L', date: '2026-03-12', source: odd.source }, today).chosen;
    if (!chosen) throw new Error('No answer was made.');
    expect(answerLineText(q, chosen).split('|')).toHaveLength(2);       // kind | the rest: no stray field mark
  });
});

describe('reading a page that has no text layer', () => {
  it('uses a line only when both readings hold it', async () => {
    let calls = 0;
    const { engine, c } = await imported(() => { calls += 1; return { ok: true, lines: calls === 1 ? REPORT : REPORT.map(line => line.toUpperCase().replace('  ', ' ')) }; });
    const got = await engine.readPathologyTest(c.id, question(c, 'Serum sodium').id, { fileName: 'scan.png', pageImages: ['aGVsbG8='] });
    expect(calls).toBe(2);
    expect(got.readings).toHaveLength(1);
    expect(got.readings[0]).toMatchObject({ value: 128, page: 1, readBy: 'model', date: '2026-03-12' });
    expect(got.abstained).toEqual([]);
  });

  it('abstains when the two readings differ on the wanted line', async () => {
    let calls = 0;
    const { engine, c } = await imported(() => { calls += 1; return { ok: true, lines: calls === 1 ? REPORT : REPORT.map(line => line.replace('128', '123')) }; });
    const got = await engine.readPathologyTest(c.id, question(c, 'Serum sodium').id, { fileName: 'scan.png', pageImages: ['aGVsbG8='] });
    expect(got.readings).toEqual([]);
    expect(got.abstained).toEqual([`Page 1: ${PATHOLOGY_TWO_READINGS}`]);
    expect(got.note).toBe('No Sodium result was found in this document. Type the result from the report.');
  });

  it('never uses a line with a character the model could not read', async () => {
    const { engine, c } = await imported(() => ({ ok: true, lines: ['Collected: 12/03/2026', 'Sodium 1?8 mmol/L (135-145) L'] }));
    const got = await engine.readPathologyTest(c.id, question(c, 'Serum sodium').id, { fileName: 'scan.png', pageImages: ['aGVsbG8='] });
    expect(got.readings).toEqual([]);
    expect(got.abstained[0]).toContain('could not be read');
  });

  it('says to type the result when no model reads pages, or the model fails', async () => {
    const none = await imported();
    const a = await none.engine.readPathologyTest(none.c.id, question(none.c, 'Serum sodium').id, { fileName: 'scan.png', pageImages: ['aGVsbG8='] });
    expect(a.readings).toEqual([]);
    expect(a.note).toBe(PATHOLOGY_NO_MODEL);
    const failing = await imported(() => ({ ok: false, error: 'The model did not answer.' }));
    const b = await failing.engine.readPathologyTest(failing.c.id, question(failing.c, 'Serum sodium').id, { fileName: 'scan.png', pageImages: ['aGVsbG8='] });
    expect(b.note).toBe(PATHOLOGY_NO_MODEL);
  });

  it('reads the text pages and the scanned pages of one document together', async () => {
    const { engine, c } = await imported(() => ({ ok: true, lines: ['Sodium 128 mmol/L (135-145) L'] }));
    const got = await engine.readPathologyTest(c.id, question(c, 'Serum sodium').id, { fileName: 'mixed.pdf', pages: [['Date of collection: 12 March 2026']], pageImages: ['aGVsbG8='] });
    expect(got.readings).toHaveLength(1);
    expect(got.readings[0]).toMatchObject({ page: 2, readBy: 'model', date: '2026-03-12' });
  });

  it('uses supplied original page numbers for text and model readings', async () => {
    const { engine, c } = await imported(() => ({ ok: true, lines: REPORT }));
    const got = await engine.readPathologyTest(c.id, question(c, 'Serum sodium').id, {
      fileName: 'blank-pages.pdf', pages: [REPORT], pageImages: ['aGVsbG8='], pageNumbers: [2, 5]
    });
    expect(got.readings).toHaveLength(2);
    expect(got.readings.map(reading => ({ page: reading.page, readBy: reading.readBy }))).toEqual([
      { page: 2, readBy: 'text' }, { page: 5, readBy: 'model' }
    ]);
  });

  it('uses supplied original page numbers in parser, long-line and model-disagreement abstentions', async () => {
    let calls = 0;
    const { engine, c } = await imported(() => {
      calls += 1;
      return { ok: true, lines: calls === 1 ? REPORT : REPORT.map(line => line.replace('128', '123')) };
    });
    const got = await engine.readPathologyTest(c.id, question(c, 'Serum sodium').id, {
      fileName: 'abstentions-after-blanks.pdf',
      pages: [['Sodium 1?8 mmol/L (135-145) L', 'x'.repeat(301)]],
      pageImages: ['aGVsbG8='], pageNumbers: [2, 5]
    });
    expect(got.readings).toEqual([]);
    expect(got.abstained).toEqual([
      'Page 2: "Sodium 1?8 mmol/L (135-145) L": a character on this line could not be read. Read the value from the report yourself.',
      'One line on page 2 is too long to be a result row and was not read.',
      `Page 5: ${PATHOLOGY_TWO_READINGS}`
    ]);
  });

  it('accepts original page numbers over HTTP and refuses invalid lists before the reader is called', async () => {
    let calls = 0;
    const { engine, c } = await imported(() => { calls += 1; return { ok: true, lines: REPORT }; });
    const http = await serve(engine);
    const route = `/api/cases/${c.id}/questions/${question(c, 'Serum sodium').id}/pathology`;
    const malformed: unknown[] = [
      { pages: [REPORT], pageImages: ['aGVsbG8='], pageNumbers: [2] },
      { pages: [REPORT], pageNumbers: 2 },
      { pages: [REPORT], pageNumbers: [0] },
      { pages: [REPORT], pageNumbers: [1.5] },
      { pages: [REPORT], pageNumbers: ['2'] },
      { pages: [REPORT, REPORT], pageNumbers: [2, 2] },
      { pages: [REPORT, REPORT], pageNumbers: [2, 1] }
    ];
    for (const body of malformed) {
      const got = await postJson(http.base, route, body);
      expect(got).toEqual({
        status: 400,
        json: { error: 'The page numbers must give one whole number of at least 1 for each supplied page, in strictly rising order.' }
      });
    }
    const ok = await postJson(http.base, route, { fileName: 'page-4.pdf', pageImages: ['aGVsbG8='], pageNumbers: [4] });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ readings: [{ value: 128, page: 4, readBy: 'model' }] });
    expect(calls).toBe(2);
  });
});

describe('the reading model is asked only to read', () => {
  it('sends the fixed text and one image, and tidies the lines it gets back', async () => {
    const seen: { system: string; user: string; images: number }[] = [];
    const out = await transcribePathologyPage(testConfig, 'data:image/png;base64,aGVsbG8=', {
      chat: (async (_cfg: unknown, req: { messages: { role: string; content: string; images?: string[] }[] }) => {
        seen.push({ system: req.messages[0].content, user: req.messages[1].content, images: req.messages[1].images?.length ?? 0 });
        return { ok: true, value: { lines: ['  Sodium   128 mmol/L ', '', 7, 'Potassium 4.4 mmol/L'] } };
      }) as never
    });
    expect(out).toEqual({ ok: true, lines: ['Sodium 128 mmol/L', 'Potassium 4.4 mmol/L'] });
    expect(seen).toEqual([{ system: PATHOLOGY_PAGE_SYSTEM, user: PATHOLOGY_PAGE_TASK, images: 1 }]);
    expect(PATHOLOGY_PAGE_SYSTEM).toContain('You only read.');
    expect(PATHOLOGY_PAGE_SYSTEM).toContain('If a character cannot be read, write ? in its place.');
  });

  it('passes a failure on and refuses an empty image', async () => {
    expect(await transcribePathologyPage(testConfig, '', {})).toEqual({ ok: false, error: 'The page image is empty.' });
    const failed = await transcribePathologyPage(testConfig, 'aGVsbG8=', { chat: (async () => ({ ok: false, error: 'The model did not answer.' })) as never });
    expect(failed).toEqual({ ok: false, error: 'The model did not answer.' });
  });

  it('compares two readings line by line, without regard to case or the width of a gap', () => {
    expect(sameLine('Sodium  128 mmol/L', 'sodium 128 MMOL/L ')).toBe(true);
    expect(sameLine('Sodium 128 mmol/L', 'Sodium 123 mmol/L')).toBe(false);
    expect(agreedLines(['a', 'b', 'c'], ['A', 'x', 'c'])).toEqual({ agreed: ['a', 'c'], onlyInOne: ['b', 'x'] });
  });
});


describe('K-PATH-REVIEW pathology HTTP boundary', () => {
  it('answers over HTTP and rejects malformed pages instead of silently changing them', async () => {
    const { engine, c } = await imported(() => ({ ok: true, lines: REPORT }));
    const http = await serve(engine);
    const route = `/api/cases/${c.id}/questions/${question(c, 'Serum sodium').id}/pathology`;
    const ok = await postJson(http.base, route, { fileName: 'fictional.pdf', pages: [REPORT] });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ fact: 'Serum sodium', readings: [{ value: 128, readBy: 'text' }] });

    const notJson = await fetch(http.base + route, { method: 'POST', body: 'this is not json' });
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toEqual({ error: 'The request could not be read. It must be JSON.' });

    const malformed: unknown[] = [
      { fileName: 'x.pdf', pages: 'not an array' },
      { fileName: 'x.pdf', pages: ['not an array'] },
      { fileName: 'x.pdf', pages: [[...REPORT, 7]] },
      { fileName: 'x.pdf', pageImages: 'not an array' }
    ];
    for (const body of malformed) {
      const got = await postJson(http.base, route, body);
      expect(got.status, JSON.stringify(body).slice(0, 100)).toBe(400);
      expect(got.json.error).toBeTypeOf('string');
    }
    expect((await postJson(http.base, route, { fileName: 'x.pdf', pages: Array.from({ length: 11 }, () => REPORT) })).status).toBe(400);
    expect(await declaredBodyLength(http.port, route, MAX_BODY_BYTES + 1)).toBe(413);
  });

  it('refuses a picture that is not base64 before the reading model is called', async () => {
    let calls = 0;
    const { engine, c } = await imported(() => { calls += 1; return { ok: true, lines: REPORT }; });
    const http = await serve(engine);
    const got = await postJson(http.base, `/api/cases/${c.id}/questions/${question(c, 'Serum sodium').id}/pathology`, {
      fileName: 'scan.png', pageImages: ['not base64!']
    });
    expect(got.status).toBe(400);
    expect(got.json.error).toBe('A page picture is not valid base64 image data. Upload the page again, or type the result yourself.');
    expect(calls).toBe(0);
  });

  it('does not accept a question id that belongs to another history', async () => {
    const { engine, c } = await imported();
    await engine.importCase({
      fileName: 'other.csv', source: 'csv',
      csvText: 'patient_ref,patient_age,patient_sex,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber\nF-002,72,F,2026-03-01,sertraline,Zoloft,100 mg,tablet,30,1,one daily,Dr A. Example'
    });
    await engine.whenIdle();
    const other = engine.state.cases.find(item => item.id !== c.id)!;
    const http = await serve(engine);
    const got = await postJson(http.base, `/api/cases/${c.id}/questions/${question(other, 'Serum sodium').id}/pathology`, {
      fileName: 'fictional.pdf', pages: [REPORT]
    });
    expect(got.status).toBe(404);
  });

  it('loads a state saved before question.pathology existed and still reads the route', async () => {
    const first = await imported();
    const old = question(first.c, 'Serum sodium');
    delete old.pathology;
    first.engine.store.save();
    const store = new StateStore(first.engine.store.dataDir);
    store.load();
    expect(question(store.state.cases[0], 'Serum sodium').pathology).toBeUndefined();
    const engine = new Engine({
      cfg: testConfig, store, pipeline: first.engine.pipeline, images: new PageImages(path.join(store.dataDir, 'images')),
      loadCriteria: async () => [SOD, CRCL, HF], warmup: false, modelsUp: async () => true
    });
    await engine.start();
    const http = await serve(engine);
    const c = engine.state.cases[0];
    const got = await postJson(http.base, `/api/cases/${c.id}/questions/${question(c, 'Serum sodium').id}/pathology`, {
      fileName: 'old-state.pdf', pages: [REPORT]
    });
    expect(got.status).toBe(200);
    expect(got.json).toMatchObject({ readings: [{ value: 128 }] });
  });
});

describe('K-PATH-REVIEW one-model locking', () => {
  it('queues a screening that arrives during a scanned-page read and starts it afterwards', async () => {
    let calls = 0;
    let started!: () => void;
    let release!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { engine, c, screened } = await imported(async () => {
      calls += 1;
      if (calls === 1) { started(); await gate; }
      return { ok: true, lines: REPORT };
    });
    const upload = engine.readPathologyTest(c.id, question(c, 'Serum sodium').id, { fileName: 'scan.png', pageImages: ['aGVsbG8='] });
    await reading;
    const before = screened.length;
    await engine.importCase({
      fileName: 'queued.csv', source: 'csv',
      csvText: 'patient_ref,patient_age,patient_sex,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber\nF-003,72,F,2026-03-01,sertraline,Zoloft,100 mg,tablet,30,1,one daily,Dr A. Example'
    });
    expect(screened).toHaveLength(before);
    release();
    await upload;
    await engine.whenIdle();
    expect(screened.length).toBeGreaterThan(before);
    expect(calls).toBe(2);
  });

  it('does not run two scanned uploads at once', async () => {
    let calls = 0;
    let active = 0;
    let mostActive = 0;
    let started!: () => void;
    let release!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { engine, c } = await imported(async () => {
      calls += 1;
      active += 1;
      mostActive = Math.max(mostActive, active);
      if (calls === 1) { started(); await gate; }
      active -= 1;
      return { ok: true, lines: REPORT };
    });
    const q = question(c, 'Serum sodium');
    const first = engine.readPathologyTest(c.id, q.id, { fileName: 'one.png', pageImages: ['aGVsbG8='] });
    await reading;
    const second = await engine.readPathologyTest(c.id, q.id, { fileName: 'two.png', pageImages: ['aGVsbG8='] });
    expect(second).toMatchObject({ readings: [], note: PATHOLOGY_MODEL_BUSY });
    expect(calls).toBe(1);
    release();
    expect((await first).readings).toHaveLength(1);
    expect(calls).toBe(2);
    expect(mostActive).toBe(1);
  });

  it('clears the worker flag after a thrown read error or abort and permits a later upload', async () => {
    let fail = true;
    const { engine, c } = await imported(async () => {
      if (fail) throw new Error('reading aborted');
      return { ok: true, lines: REPORT };
    });
    const q = question(c, 'Serum sodium');
    await expect(engine.readPathologyTest(c.id, q.id, { fileName: 'abort.png', pageImages: ['aGVsbG8='] })).rejects.toThrow('reading aborted');
    await engine.whenIdle();
    fail = false;
    const got = await engine.readPathologyTest(c.id, q.id, { fileName: 'later.png', pageImages: ['aGVsbG8='] });
    expect(got.readings).toHaveLength(1);
  });

  it('passes an abort signal into the page transcription call', async () => {
    const controller = new AbortController();
    const out = transcribePathologyPage(testConfig, 'aGVsbG8=', {
      signal: controller.signal,
      chat: (async (_cfg: unknown, req: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
        req.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as never
    });
    controller.abort();
    expect(await out).toEqual({ ok: false, error: 'The page could not be read: aborted' });
  });
});

describe('K-PATH-REVIEW sourced answer safety', () => {
  it.each([
    { value: '128|2026-03-12 | RESULT | Potassium 6.1', unit: 'mmol/L' },
    { value: '128\n2026-03-12 | RESULT | Potassium 6.1', unit: 'mmol/L' },
    { value: '128\r2026-03-12 | RESULT | Potassium 6.1', unit: 'mmol/L' },
    { value: '128"', unit: 'mmol/L' },
    { value: '128', unit: 'mmol/L|RESULT' },
    { value: '128', unit: 'mmol/L\nRESULT' },
    { value: '128', unit: 'mmol/L"' }
  ])('refuses record-line characters in a sourced value or unit', async ({ value, unit }) => {
    const { c } = await imported();
    const q = question(c, 'Serum sodium');
    const source = { kind: 'pathology', fileName: 'report.pdf', page: 1, line: 'Sodium 128 mmol/L', readBy: 'text' };
    expect(chosenFrom(q, { value, unit, date: '2026-03-12', source }, dayOf(new Date())).error)
      .toBe('The value and unit cannot contain a line break, field mark or quote mark. Type the result again.');
  });

  it('builds a letter and takes a sourced answer back exactly like a typed answer', async () => {
    const { engine, c } = await imported();
    const q = question(c, 'Serum sodium');
    engine.answerQuestion(c.id, q.id, {
      value: '128', unit: 'mmol/L', date: '2026-03-12',
      source: { kind: 'pathology', fileName: 'report.pdf', page: 1, line: 'Sodium 128 mmol/L', readBy: 'text' }
    });
    await engine.whenIdle();
    const line = c.lines.find(item => item.text.includes('uploaded pathology test'))!;
    const finding: Finding = {
      id: 'F9001', caseId: c.id, criterionId: SOD.id, state: 'confirmed', possible: false, seenByPharmacist: false,
      screen: { lineIds: [line.id], medicines: ['sertraline'], reason: 'The result and medicine are present.', linesVerified: true, missingFacts: [], model: 'stand-in', at: '2026-11-20T00:00:00.000Z', seconds: 1 },
      check: { confirmed: true, lineIds: [line.id], whatMatches: 'Sodium 128 mmol/L.', whatCannotBeSeen: '', completed: true, model: 'stand-in', at: '2026-11-20T00:00:01.000Z', seconds: 1 }
    };
    const letter = templateLetter(testConfig, c.patient, c.lines, SOD, finding, 'no_answer', []);
    expect(letter.body).toContain('Fictional patient');
    expect(letter.body).toContain('Serum sodium 128 mmol/L');
    engine.takeBackQuestion(c.id, q.id);
    expect(q.status).toBe('open');
    expect(q.answer?.takenBackAt).toBeTruthy();
    expect(line.text).toContain('Taken back');
  });
});


describe('K-PATH-REVIEW final disagreement and record-line probes', () => {
  it('withholds an otherwise agreed value when either pass adds a conflicting wanted line', async () => {
    let calls = 0;
    const { engine, c } = await imported(() => {
      calls += 1;
      return { ok: true, lines: calls === 1 ? REPORT : [...REPORT, 'Sodium 123 mmol/L (135-145) L'] };
    });
    const got = await engine.readPathologyTest(c.id, question(c, 'Serum sodium').id, {
      fileName: 'extra-line.png', pageImages: ['aGVsbG8=']
    });
    expect(got.readings).toEqual([]);
    expect(got.abstained).toEqual([`Page 1: ${PATHOLOGY_TWO_READINGS}`]);
  });

  it.each(['\u2028', '\u2029'])('refuses a Unicode line separator in a sourced value', async separator => {
    const { c } = await imported();
    const q = question(c, 'Serum sodium');
    const source = { kind: 'pathology', fileName: 'report.pdf', page: 1, line: 'Sodium 128 mmol/L', readBy: 'text' };
    expect(chosenFrom(q, {
      value: `128${separator}2026-03-12`, unit: 'mmol/L', date: '2026-03-12', source
    }, dayOf(new Date())).error).toBe('The value and unit cannot contain a line break, field mark or quote mark. Type the result again.');
  });
});
