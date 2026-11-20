import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppState } from '../shared/types.ts';
import { emptyState, fileStamp, isState, nextId, StateStore, writeFileAtomic } from './store.ts';

const made: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-store-'));
  made.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function sampleState(): AppState {
  const state = emptyState();
  state.cases.push({
    id: 'C0001', fileName: 'positive.csv', importedAt: '2026-11-18T00:00:00.000Z', source: 'csv',
    patient: { label: 'Fictional patient F-001', age: 72, sex: 'F' },
    lines: [{ id: 'L001', text: '2026-08-21 | Celebrex 200 mg capsule | qty 30 | repeats 2' }],
    transcriptionConfirmed: true, parts: 1,
    screening: { status: 'done', criteria: [{ criterionId: 'DEMO', status: 'suspected', seconds: 5.2 }] }
  });
  state.findings.push({
    id: 'F0001', caseId: 'C0001', criterionId: 'DEMO', state: 'suspected', possible: false, seenByPharmacist: false,
    screen: { lineIds: ['L001'], medicines: ['celecoxib'], reason: 'Suspected.', linesVerified: true, missingFacts: [], model: 'lantern-screen', at: '2026-11-18T00:00:05.000Z', seconds: 5.2 }
  });
  state.jobs.push({ id: 'J0001', stage: 'screen', caseId: 'C0001', status: 'done' });
  state.activity.push({ at: '2026-11-18T00:00:00.000Z', kind: 'import', text: 'History imported: positive.csv, 1 line.', caseId: 'C0001' });
  return state;
}

describe('the state store', () => {
  it('starts empty when there is no state file', () => {
    const store = new StateStore(tempDir());
    store.load();
    expect(store.state).toEqual(emptyState());
    expect(store.loadNote).toBeNull();
  });

  it('round trip: what is saved is what is loaded', () => {
    const dir = tempDir();
    const first = new StateStore(dir);
    first.state = sampleState();
    first.save();

    const second = new StateStore(dir);
    second.load();
    expect(second.state).toEqual(sampleState());
    expect(second.loadNote).toBeNull();
  });

  it('writes the whole file each time and leaves no temporary file behind', () => {
    const dir = tempDir();
    const store = new StateStore(dir);
    for (let i = 0; i < 5; i++) {
      store.state.activity.push({ at: '2026-11-18T00:00:00.000Z', kind: 'screen', text: `step ${i}` });
      store.save();
      const onDisk = JSON.parse(fs.readFileSync(store.file, 'utf8')) as AppState;
      expect(onDisk.activity).toHaveLength(i + 1);
    }
    expect(fs.readdirSync(dir)).toEqual(['state.json']);
  });

  it('replaces an existing file in one step', () => {
    const file = path.join(tempDir(), 'deep', 'folder', 'note.json');
    writeFileAtomic(file, 'one');
    writeFileAtomic(file, 'two');
    expect(fs.readFileSync(file, 'utf8')).toBe('two');
    expect(fs.readdirSync(path.dirname(file))).toEqual(['note.json']);
  });

  it('keeps a state file it cannot read and starts clean, saying so', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'state.json'), '{"version":1,"cases":[');
    const store = new StateStore(dir);
    store.load(new Date(2026, 10, 18, 7, 15, 2));
    expect(store.state).toEqual(emptyState());
    expect(store.loadNote).toContain('state-unreadable-2026-11-18T07-15-02.json');
    expect(fs.readFileSync(path.join(dir, 'backups', 'state-unreadable-2026-11-18T07-15-02.json'), 'utf8')).toBe('{"version":1,"cases":[');
  });

  // CR_2 blocker 2. The copy aside can fail while the state file itself can still be replaced.
  // A later save, which the server does on start, must not be the thing that destroys the only copy.
  it('does not replace the only copy of a damaged state file when the backup cannot be written', () => {
    const dir = tempDir();
    const original = '{"version":1,"cases":[';
    fs.writeFileSync(path.join(dir, 'state.json'), original);
    fs.writeFileSync(path.join(dir, 'backups'), 'not a directory');
    const store = new StateStore(dir);
    store.load(new Date(2026, 10, 18, 7, 15, 2));
    expect(store.state).toEqual(emptyState());
    expect(store.loadNote).toContain('left as it is');
    expect(() => store.save()).toThrow(/left as it is/);
    expect(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).toBe(original);
    expect(fs.readFileSync(path.join(dir, 'backups'), 'utf8')).toBe('not a directory');
  });

  it('does not accept a file that is JSON but not a state', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'state.json'), '{"version":2,"cases":[]}');
    const store = new StateStore(dir);
    store.load();
    expect(store.state).toEqual(emptyState());
    expect(store.loadNote).not.toBeNull();
  });

  // The review of 18 November: such a file passed the old check, and then the server did not
  // start ("Cannot read properties of undefined") or answered every call with an error.
  it.each([
    ['a case that is an empty object', (s: Record<string, unknown[]>) => { s.cases = [{}]; }],
    ['an empty entry in the list of cases', (s: Record<string, unknown[]>) => { s.cases = [null]; }],
    ['an empty entry in the list of jobs', (s: Record<string, unknown[]>) => { s.jobs = [null]; }],
    ['a case with no screening part', (s: Record<string, unknown[]>) => { delete (s.cases[0] as Record<string, unknown>).screening; }],
    ['a finding with no first-model result', (s: Record<string, unknown[]>) => { delete (s.findings[0] as Record<string, unknown>).screen; }],
    ['a letter with no text', (s: Record<string, unknown[]>) => { s.letters = [{ id: 'T0001', findingId: 'F0001', caseId: 'C0001', status: 'ready' }]; }],
    ['an activity entry that is not an object', (s: Record<string, unknown[]>) => { s.activity = ['hello']; }]
  ])('treats a state file that is valid JSON but damaged inside as unreadable: %s', (_name, damage) => {
    const dir = tempDir();
    const damaged = JSON.parse(JSON.stringify(sampleState())) as Record<string, unknown[]>;
    damage(damaged);
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(damaged));
    const store = new StateStore(dir);
    store.load(new Date(2026, 10, 18, 7, 15, 2));
    expect(store.state).toEqual(emptyState());
    expect(store.loadNote).toBe('The saved state could not be read. It was kept as state-unreadable-2026-11-18T07-15-02.json and a clean state was started.');
    expect(fs.existsSync(path.join(dir, 'backups', 'state-unreadable-2026-11-18T07-15-02.json'))).toBe(true);
  });

  it('accepts a whole state, with every optional part in it', () => {
    const full = sampleState();
    full.cases[0].pages = 2;
    full.cases[0].scanNotes = ['Page 2: no rows were read.'];
    full.findings[0].check = {
      confirmed: false, lineIds: ['L001'], whatMatches: 'x', whatCannotBeSeen: 'y', completed: true, unclear: true,
      model: 'lantern-check', at: '2026-11-18T00:00:09.000Z', seconds: 4
    };
    full.letters.push({ id: 'T0001', findingId: 'F0001', caseId: 'C0001', status: 'drafting', subject: '', body: '', editedByPharmacist: false, seenByPharmacist: false });
    expect(isState(JSON.parse(JSON.stringify(full)))).toBe(true);
    expect(isState(emptyState())).toBe(true);
  });

  it('reset keeps the old state as a dated backup and starts clean', () => {
    const dir = tempDir();
    const store = new StateStore(dir);
    store.state = sampleState();
    store.save();

    const when = new Date(2026, 10, 18, 7, 15, 2);
    const kept = store.reset(when);
    expect(kept).toBe(path.join(dir, 'backups', 'state-2026-11-18T07-15-02.json'));
    expect(JSON.parse(fs.readFileSync(kept!, 'utf8'))).toEqual(sampleState());
    expect(store.state.cases).toEqual([]);
    expect(store.state.findings).toEqual([]);
    expect(store.state.letters).toEqual([]);
    expect(store.state.jobs).toEqual([]);
    expect(store.state.activity).toEqual([]);
    expect(store.state.issued).toEqual({ C: 1, F: 1, T: 0, J: 1 });
    expect(JSON.parse(fs.readFileSync(store.file, 'utf8')).issued).toEqual({ C: 1, F: 1, T: 0, J: 1 });

    // A second reset in the same second does not overwrite the first backup.
    store.state = sampleState();
    store.save();
    const again = store.reset(when);
    expect(again).toBe(path.join(dir, 'backups', 'state-2026-11-18T07-15-02-2.json'));
    expect(fs.readdirSync(path.join(dir, 'backups')).sort()).toEqual(['state-2026-11-18T07-15-02-2.json', 'state-2026-11-18T07-15-02.json']);
  });

  it('reset with nothing saved keeps no backup', () => {
    const store = new StateStore(tempDir());
    expect(store.reset()).toBeNull();
    expect(fs.existsSync(store.file)).toBe(true);
  });

  it('reads a mark at the start of the file, fills in an old finding, and skips an id that is not a whole number', () => {
    expect(nextId('C', [{ id: 'C0008x' }, { id: 'c0009' }, { id: 'C' }])).toBe('C0001');
    expect(nextId('C', [{ id: 'C9999' }])).toBe('C10000');
    expect(nextId('F', [{ id: 'F0012' }, { id: 'F12' }, { id: 'F0012.5' }])).toBe('F0013');

    const old = sampleState();
    const first = old.findings[0] as { possible?: boolean; screen: { missingFacts?: string[] } };
    delete first.possible;
    delete first.screen.missingFacts;
    const second = JSON.parse(JSON.stringify(sampleState().findings[0])) as { id: string; possible?: boolean; screen: { missingFacts?: string[] } };
    second.id = 'F0002';
    second.screen.missingFacts = ['eGFR'];
    delete second.possible;
    old.findings.push(second as AppState['findings'][number]);
    const marked = JSON.parse(JSON.stringify(old)) as AppState;
    marked.findings[0].possible = 'yes' as unknown as boolean;
    expect(isState(marked)).toBe(false);

    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'state.json'), '\uFEFF' + JSON.stringify(old));
    const store = new StateStore(dir);
    store.load();
    expect(store.loadNote).toBeNull();
    expect(store.state.findings[0].possible).toBe(false);
    expect(store.state.findings[0].screen.missingFacts).toEqual([]);
    expect(store.state.findings[1]).toMatchObject({ id: 'F0002', possible: true, screen: { missingFacts: ['eGFR'] } });

    const bare = new StateStore(tempDir());
    bare.setAside(new Date(2026, 10, 18, 7, 15, 2));
    expect(bare.state).toEqual(emptyState());
    expect(bare.loadNote).toBe('The saved state could not be read. A clean state was started.');
    expect(fs.existsSync(bare.backupDir)).toBe(false);
  });
});

describe('small helpers', () => {
  it('gives the next ID in a list', () => {
    expect(nextId('C', [])).toBe('C0001');
    expect(nextId('F', [{ id: 'F0001' }, { id: 'F0007' }, { id: 'F0003' }])).toBe('F0008');
    expect(nextId('T', [{ id: 'F0009' }])).toBe('T0001');
    expect(nextId('F', [], 1)).toBe('F0002');
    expect(nextId('C', [{ id: 'C0003' }], 1)).toBe('C0004');
  });

  it('writes a time that is safe in a file name', () => {
    expect(fileStamp(new Date(2026, 0, 5, 9, 3, 7))).toBe('2026-01-05T09-03-07');
  });
});
