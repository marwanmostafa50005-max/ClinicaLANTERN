import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  criterionAllowedText, criterionBlock, criterionMedicineNames, loadActiveList, loadCriteria, loadCriteriaFrom, loadCriteriaFromReport,
  loadCriteriaReport, needsFacts, readCriterion, type CriterionProblem
} from './criteria.ts';
import { loadConfig, normalizeConfig } from './config.ts';
import { factsCriterion, testCriterion } from './testkit.ts';

const made: string[] = [];

function tempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-criteria-'));
  made.push(dir);
  return dir;
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('loadCriteria', () => {
  it('loads the active criteria in the order of the list', async () => {
    const repo = tempRepo();
    writeJson(path.join(repo, 'criteria', 'active.json'), { active: ['TWO', 'ONE'], reserves: ['THREE'] });
    writeJson(path.join(repo, 'criteria', 'ONE', 'criterion.json'), { ...testCriterion, id: 'ONE', label: 'One' });
    writeJson(path.join(repo, 'criteria', 'TWO', 'criterion.json'), { ...testCriterion, id: 'something-else', label: 'Two' });
    const loaded = await loadCriteria(repo);
    expect(loaded.map(c => c.label)).toEqual(['Two', 'One']);
    expect(loaded.map(c => c.id)).toEqual(['TWO', 'ONE']);      // the folder name is the ID
  });

  it('can read another list file', async () => {
    const repo = tempRepo();
    writeJson(path.join(repo, 'criteria', 'active.json'), { active: ['ONE', 'TWO'], reserves: [] });
    writeJson(path.join(repo, 'other.json'), { active: ['TWO'], reserves: [] });
    writeJson(path.join(repo, 'criteria', 'TWO', 'criterion.json'), { ...testCriterion, label: 'Two' });
    expect((await loadCriteria(repo, path.join(repo, 'other.json'))).map(c => c.id)).toEqual(['TWO']);
  });

  it('fails with a plain message when the list or a criterion file is missing or broken', async () => {
    const repo = tempRepo();
    await expect(loadCriteria(repo)).rejects.toThrow('The list of criteria could not be read');
    writeJson(path.join(repo, 'criteria', 'active.json'), { active: ['GONE'], reserves: [] });
    await expect(loadCriteria(repo)).rejects.toThrow('Criterion GONE could not be read');
    writeJson(path.join(repo, 'criteria', 'GONE', 'criterion.json'), { label: 'No statement' });
    await expect(loadCriteria(repo)).rejects.toThrow('Criterion GONE: "statement" is missing.');
  });

  it('refuses a name in the list that could leave the criteria folder', async () => {
    const repo = tempRepo();
    writeJson(path.join(repo, 'criteria', 'active.json'), { active: ['../../secrets'], reserves: [] });
    await expect(loadCriteria(repo)).rejects.toThrow('is not a valid folder name');
  });

  it('reads the demo criterion that ships with the repository', () => {
    const file = path.join(import.meta.dirname, '..', 'criteria', 'DEMO-NSAID-ANTICOAG', 'criterion.json');
    const demo = readCriterion(JSON.parse(fs.readFileSync(file, 'utf8')), 'DEMO-NSAID-ANTICOAG');
    expect(demo.statement_origin).toBe('entrant');
    expect(demo.title.toLowerCase()).toContain('test stand-in');
    expect(demo.draft).toBe(true);
    expect(demo.signed_by_clinical_reviewer).toBeNull();
    expect(demo.medicine_groups.map(g => g.key)).toEqual(['A', 'B']);
    expect(demo.source.credit).not.toBe('');
  });
});

describe('the criterion block', () => {
  it('gives the label, the statement, the medicines by group with brands, and the rule', () => {
    expect(criterionBlock(testCriterion)).toBe(
      'CRITERION Demo criterion (NSAID with an anticoagulant)\n' +
      testCriterion.statement + '\n\n' +
      'MEDICINES THAT COUNT\n' +
      'Group A (Oral NSAIDs): ibuprofen (Nurofen, Brufen), celecoxib (Celebrex)\n' +
      'Group B (Oral anticoagulants): warfarin (Coumadin, Marevan), rivaroxaban (Xarelto)\n\n' +
      'RULE\n' + testCriterion.rule_for_models
    );
  });

  it('copes with a group note, an ingredient with no brand and a criterion with no medicine list', () => {
    const block = criterionBlock({
      ...testCriterion,
      medicine_groups: [{ key: 'A', name: 'Opioids', ingredients: ['morphine', 'codeine'], brands: { codeine: ['Panadeine Forte'] }, note: 'Any strength.' }]
    });
    expect(block).toContain('Group A (Opioids): morphine, codeine (Panadeine Forte) Note: Any strength.');
    expect(criterionBlock({ ...testCriterion, medicine_groups: [] })).toContain('MEDICINES THAT COUNT\nNo fixed list. Use the criterion and the rule.');
  });

  it('lists every name and all the wording a letter may quote', () => {
    expect(criterionMedicineNames(testCriterion)).toEqual(expect.arrayContaining(['celecoxib', 'celebrex', 'rivaroxaban', 'xarelto', 'marevan']));
    const allowed = criterionAllowedText(testCriterion);
    expect(allowed).toContain('within 60 days');
    expect(allowed).toContain('Celebrex');
    expect(allowed).toContain(testCriterion.cannot_be_seen);
  });
});

describe('a criterion file with a slip in its medicine list', () => {
  const group = testCriterion.medicine_groups[0];

  it('is refused when "ingredients" is one text and not a list', () => {
    const slip = { ...testCriterion, medicine_groups: [{ ...group, ingredients: 'ibuprofen, celecoxib', brands: ['Nurofen', 'Celebrex'] }] };
    expect(() => readCriterion(slip, 'DEMO')).toThrow('Criterion DEMO, medicine group A: "ingredients" must be a list of names.');
  });

  it('is refused when "brands" has the wrong shape', () => {
    const asList = { ...testCriterion, medicine_groups: [{ ...group, brands: ['Nurofen', 'Celebrex'] }] };
    expect(() => readCriterion(asList, 'DEMO')).toThrow('Criterion DEMO, medicine group A: "brands" must give a list of brand names for each ingredient.');
    const asText = { ...testCriterion, medicine_groups: [{ ...group, brands: { celecoxib: 'Celebrex' } }] };
    expect(() => readCriterion(asText, 'DEMO')).toThrow('"brands" must give a list of brand names for each ingredient.');
  });

  it('is refused when "medicine_groups" is not a list', () => {
    const asRecord = { ...testCriterion, medicine_groups: { A: group } };
    expect(() => readCriterion(asRecord, 'DEMO')).toThrow('Criterion DEMO: "medicine_groups" must be a list of groups.');
    expect(() => readCriterion({ ...testCriterion, medicine_groups: ['ibuprofen'] }, 'DEMO')).toThrow('medicine group A is not an object');
  });

  it('is refused when a group names no medicine', () => {
    const empty = { ...testCriterion, medicine_groups: [group, { key: 'B', name: 'Oral anticoagulants', ingredients: [], brands: {} }] };
    expect(() => readCriterion(empty, 'DEMO')).toThrow('Criterion DEMO, medicine group B: it names no medicine. Give at least one ingredient or one brand.');
  });

  it('never gives the models an empty medicine line', () => {
    // Before the fix both slips loaded, and the prompt read "Group A (Oral NSAIDs): " with nothing after it.
    const good = readCriterion(testCriterion, 'DEMO');
    for (const line of criterionBlock(good).split('\n').filter(l => l.startsWith('Group '))) {
      expect(line).toMatch(/^Group [A-Z] \(.+\): \S/);
    }
    // A criterion with no list at all is still allowed: it says so to the models.
    const { medicine_groups: _none, ...open } = testCriterion;
    expect(criterionBlock(readCriterion(open, 'DEMO'))).toContain('No fixed list. Use the criterion and the rule.');
  });

  it('loads every criterion file of the repository', () => {
    const root = path.join(import.meta.dirname, '..', 'criteria');
    const folders = fs.readdirSync(root).filter(name => fs.existsSync(path.join(root, name, 'criterion.json')));
    expect(folders.length).toBeGreaterThan(10);
    for (const name of folders) {
      const raw: unknown = JSON.parse(fs.readFileSync(path.join(root, name, 'criterion.json'), 'utf8').replace(/^﻿/, ''));
      const criterion = readCriterion(raw, name);
      expect(criterion.medicine_groups.length, name).toBeGreaterThan(0);
    }
  });
});

// ---------- docs/SPEC.md section 6a: facts a criterion needs, and the further criteria ----------

describe('a criterion that needs facts', () => {
  const facts = [
    { kind: 'result', what: 'eGFR (estimated kidney function), the most recent result', meets: 'below 30 mL/min/1.73 m2' },
    { kind: 'condition', what: 'Heart failure with its NYHA class.', meets: 'NYHA class III or IV' }
  ];

  it('loads the list when it is there, and has none when it is not', () => {
    const loaded = readCriterion({ ...testCriterion, needs_facts: facts }, 'DEMO');
    expect(loaded.needs_facts).toEqual([
      { kind: 'result', what: 'eGFR (estimated kidney function), the most recent result', meets: 'below 30 mL/min/1.73 m2' },
      { kind: 'condition', what: 'Heart failure with its NYHA class.', meets: 'NYHA class III or IV' }
    ]);
    expect(needsFacts(loaded)).toBe(true);
    const plain = readCriterion(testCriterion, 'DEMO');
    expect('needs_facts' in plain).toBe(false);
    expect(needsFacts(plain)).toBe(false);
    // An empty list and a null are the same as no list.
    expect('needs_facts' in readCriterion({ ...testCriterion, needs_facts: [] }, 'DEMO')).toBe(false);
    expect('needs_facts' in readCriterion({ ...testCriterion, needs_facts: null }, 'DEMO')).toBe(false);
  });

  it('is strict about the shape of the list', () => {
    const withFacts = (needs_facts: unknown): unknown => ({ ...testCriterion, needs_facts });
    expect(() => readCriterion(withFacts('eGFR'), 'DEMO')).toThrow('Criterion DEMO: "needs_facts" must be a list of facts.');
    expect(() => readCriterion(withFacts({ kind: 'result', what: 'eGFR', meets: 'below 30' }), 'DEMO')).toThrow('"needs_facts" must be a list of facts.');
    expect(() => readCriterion(withFacts(['eGFR']), 'DEMO')).toThrow('Criterion DEMO, needed fact 1 is not an object.');
    expect(() => readCriterion(withFacts([facts[0], { kind: 'test', what: 'eGFR', meets: 'below 30' }]), 'DEMO'))
      .toThrow('Criterion DEMO, needed fact 2: "kind" must be condition, result or observation.');
    expect(() => readCriterion(withFacts([{ kind: 'result', meets: 'below 30' }]), 'DEMO')).toThrow('Criterion DEMO, needed fact 1: "what" is missing.');
    expect(() => readCriterion(withFacts([{ kind: 'result', what: 'eGFR', meets: ' ' }]), 'DEMO')).toThrow('Criterion DEMO, needed fact 1: "meets" is missing.');
    // The kind may be written in any case.
    expect(readCriterion(withFacts([{ kind: 'Observation', what: 'Blood pressure', meets: '160 or more systolic' }]), 'DEMO').needs_facts?.[0].kind).toBe('observation');
  });

  it('lists the facts in the criterion block, between the medicines and the rule', () => {
    expect(criterionBlock(factsCriterion)).toBe(
      `CRITERION ${factsCriterion.label}\n` +
      factsCriterion.statement + '\n\n' +
      'MEDICINES THAT COUNT\n' +
      'Group A (Digoxin): digoxin (Lanoxin, Lanoxin PG, Sigmaxin)\n\n' +
      'FACTS THIS CRITERION NEEDS\n' +
      'Fact 1 (RESULT line): eGFR (estimated kidney function), the most recent result. Meets the criterion when: below 30 mL/min/1.73 m2.\n\n' +
      'RULE\n' + factsCriterion.rule_for_models
    );
    const two = criterionBlock({ ...factsCriterion, needs_facts: [
      { kind: 'condition', what: 'Heart failure with its NYHA class.', meets: 'NYHA class III or IV.' },
      { kind: 'observation', what: 'Blood pressure', meets: '160 mmHg or more systolic' }
    ] });
    expect(two).toContain(
      'FACTS THIS CRITERION NEEDS\n' +
      'Fact 1 (CONDITION line): Heart failure with its NYHA class. Meets the criterion when: NYHA class III or IV.\n' +
      'Fact 2 (OBSERVATION line): Blood pressure. Meets the criterion when: 160 mmHg or more systolic.\n\nRULE\n');
  });

  it('leaves the block of a criterion without facts exactly as it was', () => {
    expect(criterionBlock(testCriterion)).not.toContain('FACTS THIS CRITERION NEEDS');
    expect(criterionBlock({ ...testCriterion, needs_facts: [] })).toBe(criterionBlock(testCriterion));
  });

  it('lets a letter quote the facts the criterion needs and their limits', () => {
    const allowed = criterionAllowedText(factsCriterion);
    expect(allowed).toContain('eGFR (estimated kidney function), the most recent result');
    expect(allowed).toContain('below 30 mL/min/1.73 m2');
  });
});

describe('the further criteria: in use after the first ten', () => {
  function repoWith(list: unknown, ids: string[]): string {
    const repo = tempRepo();
    writeJson(path.join(repo, 'criteria', 'active.json'), list);
    for (const id of ids) writeJson(path.join(repo, 'criteria', id, 'criterion.json'), { ...testCriterion, id, label: `Label ${id}` });
    return repo;
  }

  it('reads the third list, and has none when the file has none', async () => {
    const repo = repoWith({ active: ['ONE'], reserves: ['TWO'], further: ['THREE', 'FOUR'] }, []);
    expect(await loadActiveList(repo)).toEqual({ active: ['ONE'], reserves: ['TWO'], further: ['THREE', 'FOUR'] });
    const old = repoWith({ active: ['ONE'], reserves: [] }, []);
    expect(await loadActiveList(old)).toEqual({ active: ['ONE'], reserves: [] });
    const slip = repoWith({ active: ['ONE'], reserves: [], further: 'THREE' }, []);
    await expect(loadActiveList(slip)).rejects.toThrow('The "further" entry in the list of criteria is not a list');
  });

  it('returns the first ten first, then the further ones, in order, each once', async () => {
    const repo = repoWith({ active: ['B', 'A'], reserves: ['R'], further: ['D', 'A', 'C', 'D'] }, ['A', 'B', 'C', 'D', 'R']);
    expect((await loadCriteria(repo)).map(c => c.id)).toEqual(['B', 'A', 'D', 'C']);       // no reserve, no name twice
    const report = await loadCriteriaReport(repo);
    expect(report.ids).toEqual(['B', 'A', 'D', 'C']);
    expect(report.activeIds).toEqual(['B', 'A']);                                          // an ID in both lists counts with the ten
    expect(report.problems).toEqual([]);
  });

  it('gives a file without the third list exactly what it gave before', async () => {
    const repo = repoWith({ active: ['B', 'A'], reserves: ['R'] }, ['A', 'B', 'R']);
    expect((await loadCriteria(repo)).map(c => c.id)).toEqual(['B', 'A']);
    expect((await loadCriteriaReport(repo)).activeIds).toEqual(['B', 'A']);
  });

  it('stops when one of the first ten does not load, and leaves out only a broken further file', async () => {
    const tenBroken = repoWith({ active: ['A', 'GONE'], reserves: [], further: ['C'] }, ['A', 'C']);
    await expect(loadCriteria(tenBroken)).rejects.toThrow('Criterion GONE could not be read');
    const tenReport = await loadCriteriaReport(tenBroken);
    expect(tenReport.activeIds).toEqual(['A', 'GONE']);
    expect(tenReport.criteria.map(c => c.id)).toEqual(['A', 'C']);
    expect(tenReport.problems.map(p => p.id)).toEqual(['GONE']);

    const repo = repoWith({ active: ['A'], reserves: [], further: ['C', 'BROKEN', '../outside', 'D'] }, ['A', 'C', 'D']);
    writeJson(path.join(repo, 'criteria', 'BROKEN', 'criterion.json'), { ...testCriterion, needs_facts: [{ kind: 'result', what: 'eGFR' }] });
    const problems: CriterionProblem[] = [];
    const loaded = await loadCriteria(repo, undefined, problem => problems.push(problem));
    expect(loaded.map(c => c.id)).toEqual(['A', 'C', 'D']);
    expect(problems.map(p => p.id)).toEqual(['BROKEN', '../outside']);
    expect(problems[0].error).toBe('Criterion BROKEN, needed fact 1: "meets" is missing.');
    expect(problems[1].error).toBe('The criterion name "../outside" in the list is not a valid folder name.');
    const report = await loadCriteriaReport(repo);
    expect(report.criteria.map(c => c.id)).toEqual(['A', 'C', 'D']);
    expect(report.activeIds).toEqual(['A']);
    expect(report.ids).toEqual(['A', 'C', 'BROKEN', '../outside', 'D']);
    expect(report.problems.map(p => p.id)).toEqual(['BROKEN', '../outside']);
  });

  it('still stops with the reason when no criterion of the list loads', async () => {
    const repo = repoWith({ active: ['GONE'], reserves: [], further: ['ALSO-GONE'] }, []);
    await expect(loadCriteria(repo)).rejects.toThrow('Criterion GONE could not be read');
    const report = await loadCriteriaReport(repo);                 // the report never stops for a criterion file
    expect(report.criteria).toEqual([]);
    expect(report.problems.map(p => p.id)).toEqual(['GONE', 'ALSO-GONE']);
  });
});

describe('loadCriteriaFrom: criteria from a folder outside the repository list', () => {
  it('loads the named criteria from any folder that holds <ID>/criterion.json, in the order given, each once', async () => {
    const wave = path.join(tempRepo(), 'W900', 'criteria');
    writeJson(path.join(wave, 'STOPP-X1', 'criterion.json'), { ...factsCriterion, id: 'other-name' });
    writeJson(path.join(wave, 'START-Y2', 'criterion.json'), { ...testCriterion, label: 'Start Y2' });
    const loaded = await loadCriteriaFrom(wave, ['START-Y2', 'STOPP-X1', 'START-Y2']);
    expect(loaded.map(c => c.id)).toEqual(['START-Y2', 'STOPP-X1']);        // the folder name is the ID
    expect(loaded[1].needs_facts).toEqual(factsCriterion.needs_facts);
    expect(loaded[0].needs_facts).toBeUndefined();
  });

  it('reports a file that does not load by name and loads the others; it stops when none loads', async () => {
    const wave = path.join(tempRepo(), 'W901', 'criteria');
    writeJson(path.join(wave, 'GOOD', 'criterion.json'), testCriterion);
    writeJson(path.join(wave, 'BAD', 'criterion.json'), { label: 'No statement' });
    const problems: CriterionProblem[] = [];
    const loaded = await loadCriteriaFrom(wave, ['BAD', 'GOOD', 'NOT-THERE'], problem => problems.push(problem));
    expect(loaded.map(c => c.id)).toEqual(['GOOD']);
    expect(problems.map(p => p.id)).toEqual(['BAD', 'NOT-THERE']);
    expect(problems[0].error).toBe('Criterion BAD: "statement" is missing.');
    await expect(loadCriteriaFrom(wave, ['BAD'])).rejects.toThrow('Criterion BAD: "statement" is missing.');
    await expect(loadCriteriaFrom(wave, ['..\\..\\secrets'])).rejects.toThrow('is not a valid folder name');
    expect((await loadCriteriaFromReport(wave, ['BAD', 'GOOD'])).ids).toEqual(['BAD', 'GOOD']);
    expect(await loadCriteriaFrom(wave, [])).toEqual([]);
  });
});

describe('the config', () => {
  it('fills missing values with the defaults', () => {
    const cfg = normalizeConfig({ port: 9000, models: { check: 'my-check' } });
    expect(cfg.port).toBe(9000);
    expect(cfg.models).toEqual({ screen: 'lantern-screen', check: 'my-check', letter: 'lantern-letter' });
    expect(cfg.ollamaBase).toBe('http://127.0.0.1:27435');
    expect(cfg.maxLinesPerCall).toBe(150);
    expect(cfg.screenBlockSize).toBe(20);
  });

  it('refuses a model server that is not on this computer', () => {
    expect(() => normalizeConfig({ ollamaBase: 'https://models.example.com' })).toThrow('must point at this computer');
    expect(normalizeConfig({ ollamaBase: 'http://localhost:11434/' }).ollamaBase).toBe('http://localhost:11434');
  });

  it('reads the config file of the repository', () => {
    const cfg = loadConfig(path.join(import.meta.dirname, '..'));
    expect(cfg.models.screen).toBe('lantern-screen');
    expect(cfg.overdueDays).toBeGreaterThan(0);
    expect(cfg.pharmacy.name.toLowerCase()).toContain('fictional');
  });
});
