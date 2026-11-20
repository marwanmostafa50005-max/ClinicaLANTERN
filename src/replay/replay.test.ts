import { describe, expect, it } from 'vitest';
import type { AppState, Criterion } from '../../shared/types.ts';
import { responseAt, stateAt, stepsOf } from './replay.ts';
import type { Recording } from './replay.ts';
import { NO_IMPORT, RECORDED_ONLY, replayBackend, replayControl } from './server.ts';

const T = (seconds: number): string => new Date(Date.UTC(2026, 10, 18, 0, 0, seconds)).toISOString();
const at = (seconds: number): number => Date.parse(T(seconds));

/** A small recording in the shape the server saves: one history, one finding, accepted, one letter, closed. */
function recordedState(): AppState {
  return {
    version: 1,
    cases: [{
      id: 'C0001', fileName: 'positive.csv', importedAt: T(1), source: 'csv', patient: { label: 'Fictional patient F-001', age: 72, sex: 'F' },
      lines: [{ id: 'L001', text: '2026-08-08 | Xarelto 20 mg tablet' }, { id: 'L002', text: '2026-08-21 | Celebrex 200 mg capsule' }],
      transcriptionConfirmed: true, parts: 1,
      screening: {
        status: 'done', startedAt: T(1), finishedAt: T(20),
        criteria: [{ criterionId: 'ONE', status: 'suspected', seconds: 9 }, { criterionId: 'TWO', status: 'clear', seconds: 4, reason: 'No such medicine.' }],
      },
    }],
    findings: [{
      id: 'F0001', caseId: 'C0001', criterionId: 'ONE', state: 'accepted', possible: false, seenByPharmacist: true,
      screen: { lineIds: ['L001', 'L002'], medicines: ['rivaroxaban', 'celecoxib'], reason: 'Both supplied.', linesVerified: true, missingFacts: [], model: 'lantern-screen', at: T(1), seconds: 9 },
      check: { confirmed: true, lineIds: ['L001', 'L002'], whatMatches: 'Both within 60 days.', whatCannotBeSeen: 'Kidney function.', completed: true, model: 'lantern-check', at: T(20), seconds: 10 },
      decision: { action: 'accept', by: 'The pharmacist on duty', at: T(40) },
    }],
    letters: [{
      id: 'T0001', findingId: 'F0001', caseId: 'C0001', status: 'closed', subject: 'Edited subject', body: 'Fictional patient. No real person.\n\nEdited letter.',
      draft: { subject: 'Review request', body: 'Fictional patient. No real person.\n\nDraft letter.', origin: 'model', checkNotes: [], model: 'lantern-letter', at: T(40), seconds: 10 },
      editedByPharmacist: true, patientAgreed: { at: T(60) }, sentAt: T(61), sentBy: 'print', dueAt: T(61 + 7 * 86400),
      reply: { at: T(70), outcome: 'will_review', note: 'The practice rang.' }, closedAt: T(71), seenByPharmacist: true,
    }],
    jobs: [{ id: 'J0001', stage: 'screen', caseId: 'C0001', status: 'done' }],
    activity: [
      { at: T(1), kind: 'import', text: 'History imported: positive.csv, 2 lines. Screening is queued.', caseId: 'C0001' },
      { at: T(10), kind: 'screen', text: 'Model 1 suspects a finding for Criterion one on positive.csv (criterion 1 of 2). It goes to the second check.', caseId: 'C0001', criterionId: 'ONE', findingId: 'F0001' },
      { at: T(20), kind: 'screen', text: 'Model 1 screened Criterion two on positive.csv (criterion 2 of 2): nothing suspected.', caseId: 'C0001', criterionId: 'TWO' },
      { at: T(20), kind: 'screen', text: 'Model 1 finished screening positive.csv: 1 suspected finding goes to the second check.', caseId: 'C0001' },
      { at: T(30), kind: 'check', text: 'Model 2 confirmed the finding for Criterion one on positive.csv. It is waiting for the pharmacist.', caseId: 'C0001', findingId: 'F0001', criterionId: 'ONE' },
      { at: T(40), kind: 'decision', text: 'The pharmacist accepted the finding for Criterion one. A letter to the GP is queued.', caseId: 'C0001', findingId: 'F0001', criterionId: 'ONE', letterId: 'T0001' },
      { at: T(50), kind: 'letter', text: 'The letter for Criterion one on positive.csv is ready. The letter checks found nothing.', caseId: 'C0001', findingId: 'F0001', letterId: 'T0001' },
      { at: T(58), kind: 'letter_status', text: 'The pharmacist saved changes to letter T0001.', letterId: 'T0001' },
      { at: T(60), kind: 'letter_status', text: 'Recorded for letter T0001: discussed with the patient, and the patient agrees.', letterId: 'T0001' },
      { at: T(61), kind: 'letter_status', text: 'Letter T0001 was marked as sent by print.', letterId: 'T0001' },
      { at: T(70), kind: 'letter_status', text: "The doctor's reply to letter T0001 was recorded: the doctor will review the patient.", letterId: 'T0001' },
      { at: T(71), kind: 'letter_status', text: 'Letter T0001 was closed.', letterId: 'T0001' },
    ],
  };
}

const recording: Recording = {
  note: 'A real run. Fictional patient. No real person.', how: 'a test', recordedAt: T(72),
  criteria: [] as Criterion[], state: recordedState(),
};

describe('the steps of a recorded run', () => {
  it('are the entries of the activity log, in the order they happened', () => {
    const steps = stepsOf(recordedState());
    expect(steps).toHaveLength(12);
    expect(steps[0]).toMatchObject({ at: at(1), kind: 'import' });
    expect(steps[11].text).toBe('Letter T0001 was closed.');
    expect(steps.every((s, i) => i === 0 || s.at >= steps[i - 1].at)).toBe(true);
  });
});

describe('the recorded state as it was at one time', () => {
  const final = recordedState();

  it('shows the history being screened, criterion by criterion', () => {
    const start = stateAt(final, at(1));
    expect(start.cases[0].screening.status).toBe('running');
    expect(start.cases[0].screening.criteria.map((c) => c.status)).toEqual(['running', 'waiting']);
    expect(start.findings).toEqual([]);
    expect(start.activity).toHaveLength(1);

    const afterFirst = stateAt(final, at(10));
    expect(afterFirst.cases[0].screening.criteria.map((c) => c.status)).toEqual(['suspected', 'running']);
    expect(afterFirst.cases[0].screening.criteria[1].reason).toBeUndefined();       // not known yet at that time
    expect(afterFirst.findings.map((f) => [f.id, f.state, f.check])).toEqual([['F0001', 'suspected', undefined]]);
  });

  it('shows the finding under the bell, not yet seen, between the second check and the decision', () => {
    const waiting = stateAt(final, at(30));
    expect(waiting.cases[0].screening.status).toBe('done');
    expect(waiting.findings[0]).toMatchObject({ state: 'confirmed', seenByPharmacist: false });
    expect(waiting.findings[0].decision).toBeUndefined();
    expect(waiting.letters).toEqual([]);
  });

  it('shows the letter being written, then ready as first drafted, then as the pharmacist left it', () => {
    expect(stateAt(final, at(40)).letters[0]).toMatchObject({ status: 'drafting', body: '', subject: '' });
    const ready = stateAt(final, at(50)).letters[0];
    expect(ready).toMatchObject({ status: 'ready', body: 'Fictional patient. No real person.\n\nDraft letter.', editedByPharmacist: false, seenByPharmacist: false });
    expect(ready.sentAt).toBeUndefined();
    expect(ready.reply).toBeUndefined();
    const edited = stateAt(final, at(58)).letters[0];
    expect(edited).toMatchObject({ status: 'ready', body: 'Fictional patient. No real person.\n\nEdited letter.', editedByPharmacist: true });
    expect(edited.patientAgreed).toBeUndefined();
    expect(stateAt(final, at(61)).letters[0]).toMatchObject({ status: 'sent', sentBy: 'print' });
    expect(stateAt(final, at(70)).letters[0]).toMatchObject({ status: 'reply_recorded' });
  });

  it('never changes the recording itself', () => {
    const before = JSON.stringify(final);
    for (const step of stepsOf(final)) stateAt(final, step.at);
    expect(JSON.stringify(final)).toBe(before);
  });
});

describe('what the page is told at each step', () => {
  it('always says that this is a recorded run', () => {
    for (let i = 0; i < 12; i++) expect(responseAt(recording, i).recorded).toBe(true);
  });

  it('gives the status line and the counts the live server gave', () => {
    expect(responseAt(recording, 0).now).toEqual({ stage: 'screen', text: 'Model 1 is screening: criterion 1 of 2. This pass is not finished.' });
    expect(responseAt(recording, 1).now.text).toBe('Model 1 is screening: criterion 2 of 2. This pass is not finished.');
    expect(responseAt(recording, 3).now.text).toBe('Model 2 is double-checking 1 finding');
    const confirmed = responseAt(recording, 4);
    expect(confirmed.now.text).toBe('Idle');
    expect(confirmed.counts).toMatchObject({ historiesScreened: 1, findingsConfirmed: 1, bellBadge: 1, accepted: 0 });
    expect(responseAt(recording, 5).now.text).toBe('Model 3 is writing 1 letter');
    expect(responseAt(recording, 6).counts).toMatchObject({ accepted: 1, lettersReady: 1, letterBadge: 1 });
  });

  it('ends with the recording exactly as it was saved', () => {
    const end = responseAt(recording, 11);
    expect(end.state).toEqual(recordedState());
    expect(end.counts).toMatchObject({ lettersSent: 1, repliesRecorded: 1, closed: 1, bellBadge: 0, letterBadge: 0 });
    expect(responseAt(recording, 99).state).toEqual(recordedState());       // a step past the end is the end
    expect(responseAt(recording, -5).state.activity).toHaveLength(1);
  });
});

describe('the backend of the judges\' view', () => {
  it('plays the recording that ships with the repository: a real run, fictional patients only', async () => {
    expect(replayControl.steps.length).toBeGreaterThan(5);
    expect(replayControl.note).toContain('Fictional patient');
    replayControl.goTo(replayControl.steps.length - 1);
    const end = await replayBackend.getState();
    expect(end.recorded).toBe(true);
    expect(end.state.cases.length).toBeGreaterThan(0);
    expect(end.state.cases.every((c) => /fictional/i.test(c.patient.label))).toBe(true);
    expect(end.state.letters.every((l) => l.status === 'drafting' || l.body.includes('Fictional patient. No real person.'))).toBe(true);
    const criteria = await replayBackend.getCriteria();
    for (const f of end.state.findings) expect(criteria.some((c) => c.id === f.criterionId)).toBe(true);
    replayControl.goTo(0);
    expect((await replayBackend.getState()).state.activity).toHaveLength(1);
  });

  it('refuses an import and every change in one plain sentence, and never calls a server', async () => {
    await expect(replayBackend.importCase({ fileName: 'x.csv', source: 'csv', csvText: 'a' })).rejects.toThrow(NO_IMPORT);
    await expect(replayBackend.decideFinding('F0001', { action: 'accept' })).rejects.toThrow(RECORDED_ONLY);
    await expect(replayBackend.saveLetter('T0001', { subject: 's', body: 'b' })).rejects.toThrow(RECORDED_ONLY);
    await expect(replayBackend.resetDemo()).rejects.toThrow(RECORDED_ONLY);
    await expect(replayBackend.markFindingSeen('F0001')).resolves.toBeUndefined();      // looking changes nothing
    expect(replayBackend.pagePictures('C0001', 2)).toEqual([]);
    expect((await replayBackend.getHealth()).ollama).toBe('down');
  });
});
