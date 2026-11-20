// Names every status line and every activity sentence, so a later change is noticed.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptyState } from './store.ts';
import { computeNow, HELD_FOR_MODELS, PASS_NOT_FINISHED } from './view.ts';

const names = { screen: 'Mantle', check: 'Lumen', letter: 'Ogee' };

const NOW_TEXTS = [
  'Idle',
  'Starting the next step',
  'The local models are not running. This step starts again when they answer.',
  'The local models are not running.',
  'Warming up Mantle',
  'Mantle is reading a scanned page',
  'Mantle is reading a scanned page: page 1 of 2',
  'Mantle is reading a scanned page: page 1 of 2. 1 more history is waiting',
  'Mantle is screening',
  `Mantle is screening: criterion 1 of 2. ${PASS_NOT_FINISHED}`,
  `Mantle is screening: criterion 2 of 3 (long history, part 2 of 4). ${PASS_NOT_FINISHED}`,
  `Mantle is screening: criterion 2 of 3 (long history, reading the listed lines together). ${PASS_NOT_FINISHED}`,
  `Mantle is screening: criterion 2 of 3 (long history, read in 4 parts). 2 more histories are waiting. ${PASS_NOT_FINISHED}`,
  'Lumen is double-checking 1 finding',
  'Lumen is double-checking 2 findings',
  'Ogee is writing 1 letter',
  'Ogee is writing 2 letters'
];

const ACTIVITY_TEXTS = [
  'The server stopped while',
  'The server stopped during a second check. The check starts again.',
  'The server stopped while a letter was being written. The letter is drafted again.',
  'The state file can be written again. Nothing was lost.',
  'The state file could not be written. Another program may be holding it.',
  'Every criterion in the list loads again.',
  'could not be loaded and',
  'Scan imported:',
  'History imported:',
  'The pharmacist confirmed',
  'The pharmacist discarded the scan',
  'The pharmacist asked to screen',
  'The pharmacist dismissed it.',
  'The pharmacist accepted it anyway.',
  'The pharmacist accepted the finding for',
  'The pharmacist bypassed it.',
  'The pharmacist bypassed the finding for',
  'The pharmacist saved changes to letter',
  'was previewed,',
  'The patient agreement tick was removed from letter',
  'discussed with the patient, and the patient agrees.',
  'was marked as sent by',
  "The doctor's reply to letter",
  'was closed.',
  'The demo clock is back to the real date.',
  'The demo clock was moved',
  'The demo clock is back to the real date for this run. The clock file could not be saved.',
  'A clean demo was started.',
  'The local models are answering again. The waiting step starts.',
  'A step stopped with an error.',
  'is started again.',
  'second check not completed',
  'Please write it by hand.',
  'could not be drafted, so it was built from the template.',
  'the page images are missing.',
  'could not read page',
  'found no rows in the scan of',
  'Read from a scan: please check the rows before screening.',
  'could not screen',
  'suspects a possible finding for',
  'suspects a finding for',
  'nothing suspected.',
  'its criterion file could not be read. This is not a clear result.',
  'finished screening',
  'already in the list.',
  'could not fully screen',
  'The local models are not running, so',
  'confirmed the possible finding for',
  'confirmed the finding for',
  'turned it back.',
  'second check unclear',
  'The letter for',
  'is ready.',
  'is warm.',
  'The local models are not running. The server is up. Screening starts when they answer.'
];

describe('status texts', () => {
  it('names every line the status can show', () => {
    const idle = emptyState();
    const starting = emptyState();
    starting.jobs.push({ id: 'J1', stage: 'check', caseId: 'C1', status: 'queued' });
    const held = emptyState();
    held.jobs.push({ id: 'J1', stage: 'screen', caseId: 'C1', status: 'queued', detail: HELD_FOR_MODELS });
    const warming = emptyState();
    warming.jobs.push({ id: 'J1', stage: 'screen', caseId: '', status: 'running', warmup: true });
    const scan = emptyState();
    scan.cases.push({
      id: 'C1', fileName: 'scan.pdf', importedAt: '', source: 'pdf-image',
      patient: { label: 'Fictional patient' }, lines: [], transcriptionConfirmed: false, parts: 1,
      screening: { status: 'running', criteria: [] }
    });
    scan.jobs.push({ id: 'J1', stage: 'screen', caseId: 'C1', status: 'running' });
    const scanPage = emptyState();
    scanPage.cases.push({ ...scan.cases[0], id: 'C1' });
    scanPage.jobs.push({ id: 'J1', stage: 'screen', caseId: 'C1', status: 'running' });
    const scanWait = emptyState();
    scanWait.cases.push({ ...scan.cases[0], id: 'C1' });
    scanWait.jobs.push(
      { id: 'J1', stage: 'screen', caseId: 'C1', status: 'running' },
      { id: 'J2', stage: 'screen', caseId: 'C2', status: 'queued' }
    );
    const screening = emptyState();
    screening.jobs.push({ id: 'J1', stage: 'screen', caseId: 'C9', status: 'running' });
    const criterion = emptyState();
    criterion.cases.push({
      id: 'C1', fileName: 'h.csv', importedAt: '', source: 'csv', patient: { label: 'Fictional patient' },
      lines: [], transcriptionConfirmed: true, parts: 1,
      screening: { status: 'running', criteria: [{ criterionId: 'ONE', status: 'waiting' }, { criterionId: 'TWO', status: 'waiting' }] }
    });
    criterion.jobs.push({ id: 'J1', stage: 'screen', caseId: 'C1', status: 'running' });
    const mid = emptyState();
    mid.cases.push({
      id: 'C1', fileName: 'h.csv', importedAt: '', source: 'csv', patient: { label: 'Fictional patient' },
      lines: [], transcriptionConfirmed: true, parts: 4,
      screening: {
        status: 'running',
        criteria: [
          { criterionId: 'ONE', status: 'clear' },
          { criterionId: 'TWO', status: 'running' },
          { criterionId: 'THREE', status: 'waiting' }
        ]
      }
    });
    mid.jobs.push({ id: 'J1', stage: 'screen', caseId: 'C1', status: 'running' });
    const midWait = emptyState();
    midWait.cases.push(mid.cases[0]);
    midWait.jobs.push(
      { id: 'J1', stage: 'screen', caseId: 'C1', status: 'running' },
      { id: 'J2', stage: 'screen', caseId: 'C2', status: 'queued' },
      { id: 'J3', stage: 'screen', caseId: 'C3', status: 'queued' }
    );
    const oneCheck = emptyState();
    oneCheck.jobs.push({ id: 'J1', stage: 'check', caseId: 'C1', status: 'running' });
    oneCheck.findings.push({
      id: 'F1', caseId: 'C1', criterionId: 'ONE', state: 'suspected', possible: false,
      screen: { lineIds: [], medicines: [], reason: '', linesVerified: true, missingFacts: [], model: 'm', at: '', seconds: 0 },
      seenByPharmacist: false
    });
    const twoChecks = emptyState();
    twoChecks.jobs.push({ id: 'J1', stage: 'check', caseId: 'C1', status: 'running' });
    twoChecks.findings.push(oneCheck.findings[0], { ...oneCheck.findings[0], id: 'F2' });
    const oneLetter = emptyState();
    oneLetter.jobs.push({ id: 'J1', stage: 'letter', caseId: 'C1', status: 'running' });
    const twoLetters = emptyState();
    twoLetters.jobs.push({ id: 'J1', stage: 'letter', caseId: 'C1', status: 'running' });
    twoLetters.letters.push(
      { id: 'T1', findingId: 'F1', caseId: 'C1', status: 'drafting', subject: '', body: '', editedByPharmacist: false, seenByPharmacist: false },
      { id: 'T2', findingId: 'F2', caseId: 'C1', status: 'drafting', subject: '', body: '', editedByPharmacist: false, seenByPharmacist: false }
    );

    const said = [
      computeNow(idle, {}, names).text,
      computeNow(starting, {}, names).text,
      computeNow(held, {}, names).text,
      'The local models are not running.',
      computeNow(warming, {}, names).text,
      computeNow(scan, {}, names).text,
      computeNow(scanPage, { page: 1, pages: 2 }, names).text,
      computeNow(scanWait, { page: 1, pages: 2 }, names).text,
      computeNow(screening, {}, names).text,
      computeNow(criterion, {}, names).text,
      computeNow(mid, { part: 2, parts: 4 }, names).text,
      computeNow(mid, { part: 0, parts: 4 }, names).text,
      computeNow(midWait, {}, names).text,
      computeNow(oneCheck, {}, names).text,
      computeNow(twoChecks, {}, names).text,
      computeNow(oneLetter, {}, names).text,
      computeNow(twoLetters, {}, names).text
    ];
    expect(said).toEqual(NOW_TEXTS);
  });

  it('names every activity sentence in the engine', () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, 'engine.ts'), 'utf8');
    for (const text of ACTIVITY_TEXTS) expect(src, text).toContain(text);
  });
});
