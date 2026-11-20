// The sample data behind ?mock=1 must show every state the page has to draw,
// and must move the way the real loop moves: screen, check, decide, letter, sent, reply, closed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { factLineKind, isFactLine } from '../../shared/facts.ts';
import { findingLines } from '../../shared/lines.ts';
import type { Backend } from '../api.ts';
import { EMAIL_DRAFT_LIMIT, emailDraftFromLetter, letterView } from '../lib/letters.ts';

const START = new Date('2026-11-18T09:00:00.000Z');

async function freshBackend(): Promise<Backend> {
  vi.resetModules();
  return (await import('./server.ts')).mockBackend;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the sample data when the page opens', () => {
  it('covers every state the page has to draw', async () => {
    const api = await freshBackend();
    const { state, counts, now, recorded, serverTime } = await api.getState();

    expect(recorded).toBe(false);
    // The sample view says that its status line is a sample: no model is working.
    // Twelve sample criteria are in use: the first ten, and two further ones that need a fact from the record.
    expect(now).toEqual({ stage: 'screen', text: 'Sample of the status line: Mantle is screening: criterion 4 of 12' });

    // Under the bell: the two findings of the first build, and two on a record that also carries facts.
    const waiting = state.findings.filter((f) => f.state === 'confirmed');
    expect(waiting).toHaveLength(4);
    expect(waiting.filter((f) => f.check?.completed === false)).toHaveLength(1);
    // One is a possible finding: it names the fact the record does not show.
    const possible = waiting.filter((f) => f.possible);
    expect(possible).toHaveLength(1);
    expect(possible[0].screen.missingFacts).toEqual(['a diagnosis of heart failure']);
    // Every other finding of the sample data names no missing fact.
    expect(state.findings.filter((f) => !f.possible).every((f) => f.screen.missingFacts.length === 0)).toBe(true);
    expect(state.findings.filter((f) => f.state === 'not_confirmed' && !f.decision)).toHaveLength(1);
    expect(state.findings.some((f) => f.state === 'bypassed' && f.decision?.reason)).toBe(true);

    const views = new Set(state.letters.map((l) => letterView(l, serverTime)));
    expect([...views].sort()).toEqual(['closed', 'drafting', 'overdue', 'ready', 'reply_recorded', 'sent']);
    expect(state.letters.some((l) => l.draft?.origin === 'template' && l.draft.checkNotes.length > 0)).toBe(true);

    expect(state.cases.some((c) => c.cannotAssess)).toBe(true);
    expect(state.cases.some((c) => c.source === 'pdf-image' && !c.transcriptionConfirmed && c.lines.length > 0)).toBe(true);
    expect(state.cases.some((c) => c.screening.status === 'running')).toBe(true);
    expect(state.cases.some((c) => c.screening.criteria.some((run) => run.status === 'failed'))).toBe(true);

    // A history with a criterion that could not be screened is not counted as screened, and a finding
    // whose second check did not finish is not counted as confirmed (as on the real server).
    // The record with facts adds one history that is fully screened and two confirmed findings, not yet seen.
    expect(counts).toMatchObject({
      historiesScreened: 3,
      findingsConfirmed: 11,
      accepted: 7,
      bypassed: 1,
      lettersSent: 4,
      repliesRecorded: 2,
      closed: 1,
      overdue: 1,
      bellBadge: 4,
      letterBadge: 1,
    });
  });

  it('holds a record that also carries facts, a finding that cites its result line, and a possible finding', async () => {
    const api = await freshBackend();
    const { state } = await api.getState();
    const record = state.cases.find((c) => c.lines.some((line) => isFactLine(line.text)));
    expect(record?.fileName).toBe('fictional-patient-g.csv');
    // The facts are lines of the record like any other, numbered in file order among the supplies.
    const facts = (record?.lines ?? []).filter((line) => isFactLine(line.text));
    expect(facts.map((line) => `${line.id} ${line.text}`)).toEqual([
      'L001 2026-05-12 | CONDITION | Type 2 diabetes',
      'L011 2026-10-06 | RESULT | eGFR 28 mL/min/1.73 m2',
      'L012 2026-10-06 | OBSERVATION | Blood pressure 168/94 mmHg',
    ]);
    // No other sample history holds a fact line.
    expect(state.cases.filter((c) => c.lines.some((line) => isFactLine(line.text)))).toHaveLength(1);

    const onRecord = state.findings.filter((f) => f.caseId === record?.id);
    expect(onRecord.map((f) => f.state)).toEqual(['confirmed', 'confirmed']);
    const textOf = (id: string): string => record?.lines.find((line) => line.id === id)?.text ?? '';

    // The fact is in the record and meets the criterion: a finding, with the result line cited beside the supply lines.
    const withResult = onRecord.find((f) => !f.possible);
    const cited = findingLines(withResult!).all;
    expect(cited.filter((id) => factLineKind(textOf(id)) === 'result')).toEqual(['L011']);
    expect(cited.filter((id) => !isFactLine(textOf(id))).length).toBeGreaterThan(0);
    expect(withResult?.screen.missingFacts).toEqual([]);

    // The medicines match and the record holds no line about the fact: a possible finding. It cites supplies only.
    const possible = onRecord.find((f) => f.possible);
    expect(findingLines(possible!).all.some((id) => isFactLine(textOf(id)))).toBe(false);
    expect((record?.lines ?? []).some((line) => /heart failure/i.test(line.text))).toBe(false);
    expect(possible?.check).toMatchObject({ completed: true, confirmed: true });
  });

  it('cites only lines that exist, and every letter says the patient is fictional', async () => {
    const api = await freshBackend();
    const { state } = await api.getState();
    for (const finding of state.findings) {
      const lineIds = new Set(state.cases.find((c) => c.id === finding.caseId)?.lines.map((l) => l.id));
      for (const id of [...finding.screen.lineIds, ...(finding.check?.lineIds ?? [])]) {
        expect(lineIds.has(id), `${finding.id} cites ${id}`).toBe(true);
      }
    }
    for (const letter of state.letters.filter((l) => l.status !== 'drafting')) {
      expect(letter.body).toContain('Fictional patient. No real person.');
    }
  });

  it('gives the ten sample criteria and the two further ones, each marked as sample text', async () => {
    const api = await freshBackend();
    const criteria = await api.getCriteria();
    expect(criteria).toHaveLength(12);
    for (const criterion of criteria) {
      expect(criterion.credit).toBe('Sample text written for this mock-up. Not a published criterion.');
    }
    expect(criteria.some((criterion) => criterion.signedBy?.name === 'Sample reviewer (mock-up only)')).toBe(true);
    // The first ten need nothing beside the supplies. The two further ones each need one fact from the record.
    expect(criteria.slice(0, 10).every((criterion) => criterion.needsFacts === undefined)).toBe(true);
    expect(criteria.slice(10).map((criterion) => criterion.needsFacts?.map((need) => `${need.kind}: ${need.what}`))).toEqual([
      ['result: eGFR'],
      ['condition: Heart failure'],
    ]);
    // Every history of the sample data is screened against all twelve, the first ten first.
    const { state } = await api.getState();
    for (const c of state.cases.filter((one) => one.screening.criteria.length > 0)) {
      expect(c.screening.criteria.map((run) => run.criterionId)).toEqual(criteria.map((criterion) => criterion.id));
    }
  });
});

describe('the sample clock', () => {
  it('finishes the screening, passes a suspected finding to the check, and confirms it', async () => {
    const api = await freshBackend();
    await api.getState();
    vi.setSystemTime(START.getTime() + 60_000);
    const { state, counts, now } = await api.getState();
    const caseE = state.cases.find((c) => c.id === 'C0005');
    expect(caseE?.screening.status).toBe('done');
    expect(caseE?.screening.criteria.filter((run) => run.status === 'suspected')).toHaveLength(1);
    const found = state.findings.find((f) => f.caseId === 'C0005');
    expect(found?.state).toBe('confirmed');
    expect(found?.check?.completed).toBe(true);
    expect(state.letters.find((l) => l.id === 'T0005')?.status).toBe('ready');
    // The four findings that waited when the page opened, and the one that was just confirmed.
    expect(counts.bellBadge).toBe(5);
    expect(counts.letterBadge).toBe(2);
    // A finding that appears on the sample clock rests on supplies alone.
    expect(found).toMatchObject({ possible: false, screen: { missingFacts: [] } });
    expect(now).toEqual({ stage: null, text: 'Idle' });
  });

  it('runs one job at a time', async () => {
    const api = await freshBackend();
    for (let seconds = 0; seconds <= 60; seconds += 1) {
      vi.setSystemTime(START.getTime() + seconds * 1000);
      const { state } = await api.getState();
      expect(state.jobs.filter((job) => job.status === 'running').length).toBeLessThanOrEqual(1);
    }
  });
});

describe('what the pharmacist does', () => {
  it('accept queues a letter, and the letter becomes ready', async () => {
    const api = await freshBackend();
    await api.decideFinding('F0001', { action: 'accept' });
    let snap = await api.getState();
    expect(snap.state.findings.find((f) => f.id === 'F0001')?.state).toBe('accepted');
    const letter = snap.state.letters.find((l) => l.findingId === 'F0001');
    expect(letter?.status).toBe('drafting');
    vi.setSystemTime(START.getTime() + 60_000);
    snap = await api.getState();
    const ready = snap.state.letters.find((l) => l.findingId === 'F0001');
    expect(ready?.status).toBe('ready');
    expect(ready?.body).toContain('Celebrex (celecoxib) 200 mg');
    // A sample letter was written by hand. It must not say that a model drafted it.
    expect(ready?.body).toContain('Sample letter. It was written by hand for the mock-up of the page. No model drafted it.');
    expect(ready?.body).not.toContain('Drafted by a local AI model');
  });

  it('two accepted findings of one patient become one letter', async () => {
    const api = await freshBackend();
    await api.decideFinding('F0001', { action: 'accept' });
    await api.decideFinding('F0002', { action: 'accept' });
    let snap = await api.getState();
    const drafting = snap.state.letters.filter((l) => l.findingIds?.includes('F0001'));
    expect(drafting).toHaveLength(1);
    expect(drafting[0]).toMatchObject({ id: 'T0008', status: 'drafting', findingIds: ['F0001', 'F0002'] });
    expect(snap.state.letters.some((l) => l.id === 'T0009')).toBe(false);
    expect(drafting[0].body).toContain('1. Being written');
    expect(drafting[0].body).toContain('2. Being written');
    expect(drafting[0].body.match(/Dear Doctor,/g)).toHaveLength(1);
    await expect(api.previewLetter!('T0008')).rejects.toThrow(/ready/);
    expect((await api.getState()).state.letters.find((l) => l.id === 'T0008')?.patientAgreed).toBeUndefined();
    await api.agreeLetter('T0008');
    expect((await api.getState()).state.letters.find((l) => l.id === 'T0008')?.patientAgreed).toBeUndefined();
    // The sample letters stay as they were written. A new acceptance does not rewrite them.
    expect(snap.state.letters.find((l) => l.id === 'T0004')?.findingId).toBe('F0008');
    expect(snap.state.letters.find((l) => l.id === 'T0004')?.findingIds).toBeUndefined();
    expect(snap.state.letters.find((l) => l.id === 'T0005')?.findingId).toBe('F0009');

    vi.setSystemTime(START.getTime() + 120_000);
    snap = await api.getState();
    const ready = snap.state.letters.find((l) => l.id === 'T0008');
    expect(ready?.status).toBe('ready');
    expect(ready?.findingIds).toEqual(['F0001', 'F0002']);
    expect(ready?.subject).toBe('2 points for this patient');
    expect(ready?.body.match(/Dear Doctor,/g)).toHaveLength(1);
    expect(ready?.body.match(/Yours sincerely,/g)).toHaveLength(1);
    expect(ready?.body).toContain('Re: 2 points for this patient');
    expect(ready?.body).toContain("I have reviewed this patient's dispensing history and I raise 2 points, numbered below.");
    expect(ready?.body).toContain('Could you please review the anti-inflammatory medicine when you next see the patient?');
    expect(ready?.body).toContain('Could you please check whether the statin should be paused during the antibiotic course?');
    expect(ready?.body).toContain('To: Dr H. Locum');
    expect(ready?.body).toContain('Sample letter. It was written by hand for the mock-up of the page. No model drafted it.');
    expect(ready?.body).not.toContain('Drafted by a local AI model');
    expect(ready?.body.match(/Sample Pharmacist \(sample signature\)/g)).toHaveLength(1);
    expect(ready?.draft?.body).toBe(ready?.body);
    expect(snap.state.letters.filter((l) => l.caseId === ready?.caseId && l.findingIds?.includes('F0001'))).toHaveLength(1);

    const preview = await api.previewLetter!('T0008');
    await api.markLetterSent('T0008', { by: 'print', previewToken: preview.previewToken });
    await api.recordReply('T0008', {
      outcome: 'changed',
      note: 'The doctor changed the treatment.',
      points: [{ findingId: 'F0002', outcome: 'will_review' }],
    });
    const replied = (await api.getState()).state.letters.find((l) => l.id === 'T0008');
    expect(replied?.status).toBe('reply_recorded');
    expect(replied?.reply).toMatchObject({
      outcome: 'changed',
      note: 'The doctor changed the treatment.',
      points: [{ findingId: 'F0002', outcome: 'will_review' }],
    });
    await api.recordReply('T0008', {
      outcome: 'changed',
      note: 'The doctor changed the treatment.',
      points: [{ findingId: 'F0002', outcome: 'changed' }],
    });
    expect((await api.getState()).state.letters.find((l) => l.id === 'T0008')?.reply?.points).toBeUndefined();
    await expect(api.recordReply('T0008', {
      outcome: 'changed',
      note: 'The doctor changed the treatment.',
      points: [{ findingId: 'F0099', outcome: 'will_review' }],
    })).rejects.toThrow('That point is not on this letter.');
  });

  it('no sample letter says that a model drafted it, and each is laid out like a real letter', async () => {
    const api = await freshBackend();
    const { state } = await api.getState();
    const letters = state.letters.filter((l) => l.body !== '');
    expect(letters.length).toBeGreaterThan(3);
    for (const letter of letters) {
      expect(letter.body).not.toContain('Drafted by a local AI model');
      expect(letter.body).not.toContain('AI draft');
      expect(letter.body).toMatch(/Sample letter\. It was written by hand for the mock-up of the page/);
      expect(letter.body).toContain('Fictional patient. No real person.');
      expect(letter.body).toContain('To: Dr F. Example (fictional)');
      expect(letter.body).toContain('Dear Doctor,');
      expect(letter.body).toContain('The criterion this is based on');
      expect(letter.body).toContain('Dispensing lines from our records');
    }
  });

  it('bypass keeps the reason', async () => {
    const api = await freshBackend();
    await api.decideFinding('F0002', { action: 'bypass', reason: 'The doctor already knows.' });
    const { state, counts } = await api.getState();
    expect(state.findings.find((f) => f.id === 'F0002')?.decision).toMatchObject({ action: 'bypass', reason: 'The doctor already knows.' });
    expect(counts.bypassed).toBe(2);
    // Four waited under the bell. One is decided, three still wait.
    expect(counts.bellBadge).toBe(3);
  });

  it('a possible finding that is accepted gets a letter that asks the doctor to confirm the fact', async () => {
    const api = await freshBackend();
    const before = (await api.getState()).state.findings.find((f) => f.possible);
    expect(before?.state).toBe('confirmed');
    await api.decideFinding(before!.id, { action: 'accept' });
    vi.setSystemTime(START.getTime() + 60_000);
    const { state } = await api.getState();
    // It stays a possible finding after the pharmacist has accepted it.
    expect(state.findings.find((f) => f.id === before!.id)).toMatchObject({ state: 'accepted', possible: true });
    const letter = state.letters.find((l) => l.findingId === before!.id);
    expect(letter?.status).toBe('ready');
    // Laid out as a real letter for a possible finding is (pipeline/letter.ts): the subject starts with
    // the words, and the fact the record does not show is said before the letter starts.
    expect(letter?.subject).toBe('Possible finding, request for a medicines review: Fictional patient G (Sample 12)');
    expect(letter?.body).toContain(
      'Re: Possible finding, request for a medicines review: Fictional patient G (Sample 12)\nThe record we hold does not show: a diagnosis of heart failure.\n\nDear Doctor,',
    );
    expect(letter?.body).toContain('Our record does not show whether the patient has heart failure.');
    expect(letter?.body).toContain('Could you please confirm whether the patient has heart failure? If so, could you please review pioglitazone?');
    expect(letter?.body).toContain('Dispensing lines from our records');
    expect(letter?.body).toContain('Sample letter. It was written by hand for the mock-up of the page. No model drafted it.');
  });

  it('a letter for a finding that cites a result line prints that line, under a heading that fits', async () => {
    const api = await freshBackend();
    await api.decideFinding('F0012', { action: 'accept' });
    vi.setSystemTime(START.getTime() + 60_000);
    const letter = (await api.getState()).state.letters.find((l) => l.findingId === 'F0012');
    expect(letter?.status).toBe('ready');
    expect(letter?.body).toContain('Lines from our records\n2026-09-28 | Pradaxa (dabigatran) 110 mg capsule');
    expect(letter?.body).toContain('\n2026-10-06 | RESULT | eGFR 28 mL/min/1.73 m2\n');
    expect(letter?.body).not.toContain('Dispensing lines from our records');
    // It is not a possible finding: the letter does not say that the record lacks a fact.
    expect(letter?.subject).toBe('Request for a medicines review: Fictional patient G (Sample 11)');
    expect(letter?.body).not.toContain('The record we hold does not show');
  });

  it('a letter goes from ready to sent, reply recorded and closed', async () => {
    const api = await freshBackend();
    await api.saveLetter('T0004', { subject: 'Edited subject', body: 'Edited body', expectedRevision: 0 });
    await api.agreeLetter('T0004');
    const preview = await api.previewLetter!('T0004');
    await api.markLetterSent('T0004', { by: 'email', previewToken: preview.previewToken });
    let letter = (await api.getState()).state.letters.find((l) => l.id === 'T0004');
    expect(letter).toMatchObject({ status: 'sent', sentBy: 'email', subject: 'Edited subject', editedByPharmacist: true });
    expect(letter?.patientAgreed).toBeDefined();
    expect(new Date(letter?.dueAt ?? 0).getTime() - START.getTime()).toBe(7 * 24 * 60 * 60 * 1000);

    await api.recordReply('T0004', { outcome: 'not_changed', note: 'No change for now.' });
    await api.closeLetter('T0004');
    letter = (await api.getState()).state.letters.find((l) => l.id === 'T0004');
    expect(letter).toMatchObject({ status: 'closed', reply: { outcome: 'not_changed', note: 'No change for now.' } });
  });

  it('the tick can be taken away again until the letter is sent', async () => {
    const api = await freshBackend();
    const letter = async () => (await api.getState()).state.letters.find((l) => l.id === 'T0004');
    await api.agreeLetter('T0004');
    expect((await letter())?.patientAgreed).toBeDefined();
    await api.agreeLetter('T0004', false);
    expect((await letter())?.patientAgreed).toBeUndefined();
    const preview = await api.previewLetter!('T0004');
    await api.markLetterSent('T0004', { by: 'print', previewToken: preview.previewToken });
    await api.agreeLetter('T0004');
    expect((await letter())?.patientAgreed).toBeUndefined();
    const { state } = await api.getState();
    expect(state.activity.some((entry) => entry.text.includes('Patient agreement was not recorded.'))).toBe(true);
  });

  it('a case can be closed without a reply, and the log says so', async () => {
    const api = await freshBackend();
    await api.closeLetter('T0006');
    const { state, counts } = await api.getState();
    expect(state.letters.find((l) => l.id === 'T0006')?.status).toBe('closed');
    expect(state.activity[state.activity.length - 1].text).toBe('Letter T0006 closed. No reply was recorded.');
    expect(counts.closed).toBe(2);
  });

  it('a sent letter can no longer be edited', async () => {
    const api = await freshBackend();
    const before = (await api.getState()).state.letters.find((l) => l.id === 'T0001')?.body;
    await api.saveLetter('T0001', { subject: 'Changed', body: 'Changed', expectedRevision: 0 });
    expect((await api.getState()).state.letters.find((l) => l.id === 'T0001')?.body).toBe(before);
  });

  it('seen clears the letter badge but not the bell badge', async () => {
    const api = await freshBackend();
    await api.markFindingSeen('F0001');
    await api.markFindingSeen('F0002');
    // The two findings on the record that also carries facts.
    await api.markFindingSeen('F0012');
    await api.markFindingSeen('F0013');
    await api.markLetterSeen('T0004');
    const { counts } = await api.getState();
    expect(counts.bellBadge).toBe(4);
    expect(counts.letterBadge).toBe(0);
  });

  it('confirming the rows of the scan starts its screening', async () => {
    const api = await freshBackend();
    await api.confirmTranscription('C0006');
    vi.setSystemTime(START.getTime() + 120_000);
    const { state } = await api.getState();
    const scan = state.cases.find((c) => c.id === 'C0006');
    expect(scan?.transcriptionConfirmed).toBe(true);
    expect(scan?.screening.status).toBe('done');
    expect(state.findings.find((f) => f.caseId === 'C0006')?.state).toBe('confirmed');
  });

  it('rows the pharmacist corrected replace the rows read from the scan', async () => {
    const api = await freshBackend();
    await api.confirmTranscription('C0006', ['2026-07-10 | Normison (temazepam) 10 mg tablet | qty 50', '  ', '2026-08-07 | second row']);
    const scan = (await api.getState()).state.cases.find((c) => c.id === 'C0006');
    expect(scan?.lines.map((l) => `${l.id} ${l.text}`)).toEqual([
      'L001 2026-07-10 | Normison (temazepam) 10 mg tablet | qty 50',
      'L002 2026-08-07 | second row',
    ]);
    expect(scan?.transcriptionConfirmed).toBe(true);
  });
});

describe('importing in the sample view', () => {
  it('never reports a file as screened', async () => {
    const api = await freshBackend();
    const { caseId } = await api.importCase({ fileName: 'mine.csv', source: 'csv', csvText: 'dispense_date,medicine\n2026-08-21,celecoxib\n' });
    vi.setSystemTime(START.getTime() + 120_000);
    const { state } = await api.getState();
    const imported = state.cases.find((c) => c.id === caseId);
    expect(imported?.cannotAssess).toContain('The models are not connected');
    expect(imported?.screening.status).toBe('not_started');
    expect(imported?.lines.map((l) => l.text)).toEqual(['2026-08-21 | celecoxib']);
    expect(state.findings.some((f) => f.caseId === caseId)).toBe(false);
  });

  it('a clean demo empties everything', async () => {
    const api = await freshBackend();
    await api.resetDemo();
    const { state, counts, now } = await api.getState();
    expect(state.cases).toEqual([]);
    expect(state.findings).toEqual([]);
    expect(state.letters).toEqual([]);
    expect(counts.bellBadge + counts.letterBadge + counts.historiesScreened).toBe(0);
    expect(now.text).toBe('Idle');
  });
});

describe('a finding the two models disagree on', () => {
  it('dismiss closes it with no letter; it stays a finding that the second check turned back', async () => {
    const api = await freshBackend();
    const before = await api.getState();
    expect(before.state.findings.filter((f) => f.state === 'not_confirmed' && !f.decision).map((f) => f.id)).toEqual(['F0003']);
    await api.decideFinding('F0003', { action: 'dismiss' });
    const { state, counts } = await api.getState();
    expect(state.findings.find((f) => f.id === 'F0003')).toMatchObject({ state: 'not_confirmed', decision: { action: 'dismiss' } });
    expect(state.letters.some((l) => l.findingId === 'F0003')).toBe(false);
    // It no longer waits, and it is counted neither as accepted nor as bypassed.
    expect(state.findings.filter((f) => f.state === 'not_confirmed' && !f.decision)).toHaveLength(0);
    expect(counts.accepted).toBe(before.counts.accepted);
    expect(counts.bypassed).toBe(before.counts.bypassed);
    expect(state.activity.some((entry) => entry.text.includes('The pharmacist dismissed it. No letter was written.'))).toBe(true);
    // A finding that is decided is not decided again.
    await api.decideFinding('F0003', { action: 'accept', reason: 'Changed my mind.' });
    expect((await api.getState()).state.findings.find((f) => f.id === 'F0003')?.state).toBe('not_confirmed');
  });

  it('accept anyway needs a reason, keeps it, and queues a letter like any accepted finding', async () => {
    const api = await freshBackend();
    await expect(api.decideFinding('F0003', { action: 'accept' })).rejects.toThrow('Please give a short reason for accepting this finding anyway.');
    await api.decideFinding('F0003', { action: 'accept', reason: 'The two supplies do run on from each other.' });
    const { state } = await api.getState();
    expect(state.findings.find((f) => f.id === 'F0003')).toMatchObject({
      state: 'accepted',
      decision: { action: 'accept', reason: 'The two supplies do run on from each other.' },
    });
    expect(state.letters.find((l) => l.findingId === 'F0003')?.status).toBe('drafting');
    expect(state.activity.some((entry) => entry.text.includes('The pharmacist accepted it anyway. Reason: The two supplies do run on from each other.'))).toBe(true);
  });

  it('dismiss is only for such a finding, and a bypass needs its reason', async () => {
    const api = await freshBackend();
    await expect(api.decideFinding('F0001', { action: 'dismiss' })).rejects.toThrow('Dismiss is for a finding the two models disagree on.');
    await expect(api.decideFinding('F0001', { action: 'bypass' })).rejects.toThrow('Please give a short reason for bypassing this finding.');
    expect((await api.getState()).state.findings.find((f) => f.id === 'F0001')?.state).toBe('confirmed');
  });
});

describe('the last lines of a sample letter', () => {
  const blockOf = (letter: { closingLine?: string; signatureName?: string; signatureTitle?: string; signatureRegistration?: string }): string =>
    [letter.closingLine, letter.signatureName, letter.signatureTitle, letter.signatureRegistration].join('\n');

  it('every sample letter ends as a real letter ends, and its line about who wrote the words is true', async () => {
    const api = await freshBackend();
    const { state } = await api.getState();
    const letters = state.letters.filter((l) => l.body !== '');
    expect(letters.length).toBeGreaterThan(3);
    for (const letter of letters) {
      expect(letter.body.endsWith(`\n\nYours sincerely,\n\n${blockOf(letter)}`), letter.id).toBe(true);
      expect(letter.body.split('Yours sincerely,'), letter.id).toHaveLength(2);
      // No model wrote a sample letter, so the line does not say that one did.
      expect(letter.closingLine).toMatch(/^Sample letter\. It was written by hand for the mock-up of the page/);
      expect(letter.signatureName).toBe('Sample Pharmacist (sample signature)');
      // A letter that the pharmacist has not edited is its draft, word for word.
      if (!letter.editedByPharmacist) expect(letter.body).toBe(letter.draft?.body);
    }
    // One ready letter is longer than an email draft can hold, so its preview shows the note about
    // the short cover note. The letter that opens first is one page long and fits an email draft.
    const ready = state.letters.filter((l) => l.status === 'ready');
    expect(ready.map((l) => `${l.id} ${emailDraftFromLetter(l, l.subject, l.body).fits ? 'fits' : 'is too long'}`)).toEqual([
      'T0004 fits',
      'T0007 is too long',
    ]);
    expect(state.letters.find((l) => l.id === 'T0007')?.body.length).toBeGreaterThan(EMAIL_DRAFT_LIMIT);
    // No sample letter is made long with filler text: each one is a letter, about one page.
    for (const letter of letters) expect(letter.body.split('\n').length, letter.id).toBeLessThan(60);
  });

  it('a saved body holds the last lines once, whatever was typed', async () => {
    const api = await freshBackend();
    const before = (await api.getState()).state.letters.find((l) => l.id === 'T0007');
    const block = blockOf(before ?? {});
    // The editor sends the text without the last lines. They are put back at its end.
    await api.saveLetter('T0007', { subject: before?.subject ?? '', body: 'Dear Doctor,\n\nA shorter letter. \n\n', expectedRevision: 0 });
    let saved = (await api.getState()).state.letters.find((l) => l.id === 'T0007');
    expect(saved?.body).toBe(`Dear Doctor,\n\nA shorter letter.\n\nFictional patient. No real person.\n\nYours sincerely,\n\n${block}`);
    expect(saved?.editedByPharmacist).toBe(true);
    // A text that still holds them, with words typed after them, gets them once, at its end.
    await api.saveLetter('T0007', { subject: before?.subject ?? '', body: `${saved?.body}\n\nP.S. Please ring me.`, expectedRevision: saved?.draftRevision ?? 0 });
    saved = (await api.getState()).state.letters.find((l) => l.id === 'T0007');
    expect(saved?.body.split('Yours sincerely,')).toHaveLength(2);
    expect(saved?.body.split('Sample Pharmacist (sample signature)')).toHaveLength(2);
    expect(saved?.body.endsWith(`P.S. Please ring me.\n\nYours sincerely,\n\n${block}`)).toBe(true);
    // An empty letter is refused, as the real server refuses it.
    await expect(api.saveLetter('T0007', { subject: 'x', body: '  \n' })).rejects.toThrow('The letter text is empty.');
    // A letter past the limit is refused whole. The saved letter stays as it was.
    const kept = (await api.getState()).state.letters.find((l) => l.id === 'T0007');
    await expect(api.saveLetter('T0007', { subject: kept?.subject ?? '', body: `${'y'.repeat(200_000)}\nmore`, expectedRevision: kept?.draftRevision ?? 0 })).rejects.toThrow('longer than 200,000');
    await expect(api.saveLetter('T0007', { subject: 'S'.repeat(301), body: kept?.body ?? 'Dear Doctor,', expectedRevision: kept?.draftRevision ?? 0 })).rejects.toThrow('longer than 300');
    const after = (await api.getState()).state.letters.find((l) => l.id === 'T0007');
    expect(after?.body).toBe(kept?.body);
    expect(after?.subject).toBe(kept?.subject);
  });

  it('a save after a preview asks for a new preview before the letter can be marked as sent', async () => {
    const api = await freshBackend();
    await api.previewLetter!('T0007');
    await api.saveLetter('T0007', { subject: 'Changed after the preview', body: 'Dear Doctor,\n\nChanged.', expectedRevision: 0 });
    await expect(api.markLetterSent('T0007', { by: 'print' })).rejects.toThrow('This letter has not been previewed.');
    const preview = await api.previewLetter!('T0007');
    await api.markLetterSent('T0007', { by: 'print', previewToken: preview.previewToken });
    expect((await api.getState()).state.letters.find((l) => l.id === 'T0007')?.status).toBe('sent');
  });
});
