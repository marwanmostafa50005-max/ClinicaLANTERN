// tools/apply-snomed.mjs adds brand names, and moves or respells five listed brands.
// Importing the script writes nothing: the real criteria change only when the file is run on its own.
// These tests use a temporary folder. No model is called.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface SnomedStats {
  addBrands: { criteria: number; added: number; present: number; noGroup: number };
  nameFixes: { criteria: number; added: number; present: number };
  mends: { done: number; present: number };
}

interface SnomedModule {
  applySnomed: (repo: string, dir: string) => SnomedStats;
}

const snomed = await import(new URL('./apply-snomed.mjs', import.meta.url).href) as SnomedModule;
const made: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempRepo(): { repo: string; dir: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-snomed-'));
  const dir = path.join(repo, 'pack');
  fs.mkdirSync(dir, { recursive: true });
  made.push(repo);
  return { repo, dir };
}

function writeCriterion(repo: string, id: string, json: unknown, crlf = false): string {
  const file = path.join(repo, 'criteria', id, 'criterion.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let text = JSON.stringify(json, null, 2) + '\n';
  if (crlf) text = text.replace(/\n/g, '\r\n');
  fs.writeFileSync(file, text);
  return file;
}

function writePack(dir: string, brands: unknown, names: unknown, bom = false): void {
  const prefix = bom ? '\uFEFF' : '';
  fs.writeFileSync(path.join(dir, 'SNOMED_ADD_BRANDS.json'), prefix + JSON.stringify(brands));
  fs.writeFileSync(path.join(dir, 'SNOMED_NAME_FIXES.json'), JSON.stringify(names));
}

function readCriterion(repo: string, id: string): { brands: Record<string, string[]>; ingredients?: string[] } {
  const json = JSON.parse(fs.readFileSync(path.join(repo, 'criteria', id, 'criterion.json'), 'utf8'));
  const group = json.medicine_groups[0];
  return { brands: group.brands, ingredients: group.ingredients };
}

describe('SNOMED brand names', () => {
  it('adds a missing brand, keeps Windows line ends, and adds nothing the second time', () => {
    const { repo, dir } = tempRepo();
    const file = writeCriterion(repo, 'T-1', {
      medicine_groups: [{ key: 'A', name: 'NSAID', ingredients: ['ibuprofen'], brands: { Ibuprofen: ['Advil'] } }]
    }, true);
    writePack(dir, {
      criteria: { 'T-1': [{ group: 1, ingredient: 'ibuprofen', add: ['Nurofen', 'Advil'] }], 'T-MISSING': [{ group: 'NSAID', ingredient: 'ibuprofen', add: ['X'] }] }
    }, { names: [] }, true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const stats = snomed.applySnomed(repo, dir);
    const out = fs.readFileSync(file, 'utf8');
    expect(JSON.parse(out).medicine_groups[0].brands.Ibuprofen).toEqual(['Advil', 'Nurofen']);
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
    expect(stats.addBrands).toEqual({ criteria: 1, added: 1, present: 1, noGroup: 0 });
    const again = snomed.applySnomed(repo, dir);
    expect(again.addBrands).toEqual({ criteria: 0, added: 0, present: 2, noGroup: 0 });
    expect(fs.readFileSync(file, 'utf8')).toBe(out);
  });

  it('counts a missing file and a group that is not there, and does not treat a note as the group name', () => {
    const { repo, dir } = tempRepo();
    writeCriterion(repo, 'T-2', {
      medicine_groups: [{ name: 'NSAID', ingredients: ['ibuprofen'], brands: {} }]
    });
    writePack(dir, {
      criteria: {
        'T-2': [{ group: 'no such group', ingredient: 'ibuprofen', add: ['Nurofen'] }, { group: 'NSAID', ingredient: 'ibuprofen', add: ['Brufen'] }],
        'T-GONE': [{ group: 'NSAID', ingredient: 'ibuprofen', add: ['X'] }]
      }
    }, { names: [] });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stats = snomed.applySnomed(repo, dir);
    expect(stats.addBrands).toEqual({ criteria: 1, added: 1, present: 0, noGroup: 1 });
    expect(readCriterion(repo, 'T-2').brands.ibuprofen).toEqual(['Brufen']);
    expect(log.mock.calls.map(call => call[0])).toContain('no file for T-GONE (add brands)');
    expect(log.mock.calls.map(call => call[0])).toContain('T-2: group "no such group" not found');
  });

  it('adds the Australian name beside the listed name, and skips any other action', () => {
    const { repo, dir } = tempRepo();
    writeCriterion(repo, 'T-3', {
      medicine_groups: [{
        name: 'The diuretic', ingredients: ['frusemide'], brands: { frusemide: ['Lasix'] }
      }]
    });
    writePack(dir, { criteria: {} }, {
      names: [
        { action: 'NONE', listed_name: 'frusemide', australian_name: 'furosemide', criteria: ['T-3'] },
        { action: 'FOUNDER', listed_name: 'frusemide', australian_name: 'furosemide', criteria: ['T-3'] },
        { action: 'ADD_NAME', listed_name: 'frusemide', australian_name: 'furosemide', criteria: ['T-3', 'T-GONE'] }
      ]
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const stats = snomed.applySnomed(repo, dir);
    const group = readCriterion(repo, 'T-3');
    expect(group.ingredients).toEqual(['frusemide', 'furosemide']);
    expect(group.brands.furosemide).toEqual(['Lasix']);
    expect(group.brands.frusemide).toEqual(['Lasix']);
    expect(stats.nameFixes).toEqual({ criteria: 1, added: 1, present: 0 });
    const again = snomed.applySnomed(repo, dir);
    expect(again.nameFixes).toEqual({ criteria: 0, added: 0, present: 1 });
  });

  it('moves Dithiazide onto hydrochlorothiazide, and respells Nurofen Caplets', () => {
    const { repo, dir } = tempRepo();
    writePack(dir, { criteria: {} }, { names: [] });
    writeCriterion(repo, 'OPTIMISE-T2-07', {
      medicine_groups: [{
        name: 'The medicines',
        brands: { diltiazem: ['Dithiazide', 'Cardizem'], hydrochlorothiazide: ['Dapa'] }
      }]
    });
    writeCriterion(repo, 'POPI-04', {
      medicine_groups: [{ name: 'Ibuprofen', brands: { ibuprofen: ['Nurofen Caplets', 'Nurofen Caplet'] } }]
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const stats = snomed.applySnomed(repo, dir);
    expect(readCriterion(repo, 'OPTIMISE-T2-07').brands).toEqual({
      diltiazem: ['Cardizem'],
      hydrochlorothiazide: ['Dapa', 'Dithiazide']
    });
    expect(readCriterion(repo, 'POPI-04').brands.ibuprofen).toEqual(['Nurofen Caplet']);
    expect(stats.mends.done).toBe(2);
    const again = snomed.applySnomed(repo, dir);
    expect(again.mends.done).toBe(0);
    expect(readCriterion(repo, 'OPTIMISE-T2-07').brands.hydrochlorothiazide).toEqual(['Dapa', 'Dithiazide']);
  });

  it('names a brand list that is not a list, a pack row with nothing to add, a respelling that is new, and a move onto an ingredient that has no list', () => {
    const { repo, dir } = tempRepo();
    writeCriterion(repo, 'T-ADD', {
      medicine_groups: [{ name: 'NSAID', brands: { ibuprofen: 'Advil' } }]
    });
    const rowsFile = writeCriterion(repo, 'T-ROWS', {
      medicine_groups: [{ name: 'NSAID', brands: { ibuprofen: ['Advil'] } }]
    });
    const rowsText = fs.readFileSync(rowsFile, 'utf8');
    writeCriterion(repo, 'T-NONE', { id: 'T-NONE' });
    writeCriterion(repo, 'T-NAME', {
      medicine_groups: [
        { name: 'A', ingredients: ['other'], brands: {} },
        { name: 'B', ingredients: ['frusemide'], brands: 'not-a-list' }
      ]
    });
    writeCriterion(repo, 'OPTIMISE-T2-07', {
      medicine_groups: [{ name: 'The medicines', brands: { diltiazem: ['Dithiazide', 'Cardizem'] } }]
    });
    writeCriterion(repo, 'POPI-04', {
      medicine_groups: [{ name: 'Ibuprofen', brands: { ibuprofen: ['Nurofen Caplets'] } }]
    });
    writeCriterion(repo, 'STOPP-D14', {
      medicine_groups: [{ name: 'Sleep', brands: 'no' }]
    });
    writePack(dir, {
      criteria: {
        'T-ADD': [
          { group: 'nsaid', ingredient: 'ibuprofen', add: ['Nurofen'] },
          { group: 'NSAID', ingredient: 'newdrug' },
          { group: 1.5, ingredient: 'ibuprofen', add: ['Skip'] }
        ],
        'T-ROWS': { group: 1 },
        'T-NONE': [{ group: 1, ingredient: 'ibuprofen', add: ['X'] }]
      }
    }, {
      names: [
        { action: 'ADD_NAME', listed_name: 'frusemide', australian_name: 'furosemide', criteria: ['T-NAME', 'T-NAME-GONE'] }
      ]
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stats = snomed.applySnomed(repo, dir);
    expect(readCriterion(repo, 'T-ADD').brands).toEqual({ ibuprofen: ['Nurofen'], newdrug: [] });
    expect(fs.readFileSync(rowsFile, 'utf8')).toBe(rowsText);
    const named = JSON.parse(fs.readFileSync(path.join(repo, 'criteria', 'T-NAME', 'criterion.json'), 'utf8'));
    expect(named.medicine_groups[0].ingredients).toEqual(['other']);
    expect(named.medicine_groups[1].ingredients).toEqual(['frusemide', 'furosemide']);
    expect(named.medicine_groups[1].brands).toBe('not-a-list');
    expect(readCriterion(repo, 'OPTIMISE-T2-07').brands).toEqual({
      diltiazem: ['Cardizem'],
      hydrochlorothiazide: ['Dithiazide']
    });
    expect(readCriterion(repo, 'POPI-04').brands.ibuprofen).toEqual(['Nurofen Caplet']);
    expect(JSON.parse(fs.readFileSync(path.join(repo, 'criteria', 'STOPP-D14', 'criterion.json'), 'utf8')).medicine_groups[0].brands).toBe('no');
    expect(stats.addBrands).toEqual({ criteria: 1, added: 1, present: 0, noGroup: 2 });
    expect(stats.nameFixes).toEqual({ criteria: 1, added: 1, present: 0 });
    expect(stats.mends).toEqual({ done: 2, present: 1 });
    const lines = log.mock.calls.map(call => call[0]);
    expect(lines).toContain('T-ADD: group 1.5 not found');
    expect(lines).toContain('T-NONE: group 1 not found');
    expect(lines).toContain('no file for T-NAME-GONE (name fix)');
    expect(lines).toContain('no file for EU7-F65 (mend)');
    expect(lines).toContain('no file for STOPP-D24 (mend)');
    expect(lines).toContain('no file for STOPP-D25 (mend)');

    writeCriterion(repo, 'OPTIMISE-T2-07', {
      medicine_groups: [{
        name: 'The medicines',
        brands: { diltiazem: ['Dithiazide', 'Cardizem'], hydrochlorothiazide: ['Dithiazide'] }
      }]
    });
    const again = snomed.applySnomed(repo, dir);
    expect(readCriterion(repo, 'OPTIMISE-T2-07').brands).toEqual({
      diltiazem: ['Cardizem'],
      hydrochlorothiazide: ['Dithiazide']
    });
    expect(again.mends.done).toBe(1);
  });
});
