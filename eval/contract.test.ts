// The scorer against the real pipeline, as far as that goes without a model: the real CSV reader
// and the real criterion loader read a made-up wave folder, and only the three model jobs are
// fakes. This is the join the wave runs depend on (docs/SPEC.md section 6a). Fictional data only.

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EvalResults, Pipeline } from './types.ts';
import { main, missingPipelineParts } from './run.ts';
import { criterionClass, factsNeeded } from './score.ts';
import { factLineIdsOf } from './files.ts';
import { csv15, draftedFact, draftedSupplies, factRow, fakePipeline, makeWave, removeTempDirs, supplyRow, tempDir, COLUMNS_12 } from './fakes.ts';

afterEach(removeTempDirs);

async function realLoaders(): Promise<Pipeline> {
  const real: Pipeline = await import('../pipeline/index.ts');
  return real;
}

describe('the real pipeline, without a model', () => {
  it('has every function the scorer uses, and the loader a wave run needs', async () => {
    const real = await realLoaders();
    expect(missingPipelineParts(real)).toEqual([]);
    expect(typeof real.loadCriteriaFrom).toBe('function');
  });

  it('reads a record with the three optional columns: fact rows become fact lines, numbered with the supplies', async () => {
    const real = await realLoaders();
    const read = real.parseCsv(csv15(
      factRow('F-X-1', '2026-07-10', 'condition', 'Heart failure'),
      supplyRow('F-X-1', '2026-07-20', 'examplol', 'Examplex'),
      factRow('F-X-1', '2026-08-03', 'result', 'eGFR', '28 mL/min/1.73 m2'),
      factRow('F-X-1', '2026-08-03', 'observation', 'Blood pressure', '168/94 mmHg'),
      supplyRow('F-X-1', '2026-08-20', 'examplol', 'Examplex'),
    ));
    expect(read.problems).toEqual([]);
    expect(read.lines.map((l) => l.id)).toEqual(['L001', 'L002', 'L003', 'L004', 'L005']);
    expect(read.lines[0].text).toBe('2026-07-10 | CONDITION | Heart failure');
    expect(read.lines[2].text).toBe('2026-08-03 | RESULT | eGFR 28 mL/min/1.73 m2');
    expect(read.lines[3].text).toBe('2026-08-03 | OBSERVATION | Blood pressure 168/94 mmHg');
    // The scorer tells a fact line from a supply by the one shared rule.
    expect(factLineIdsOf(read.lines)).toEqual(['L001', 'L003', 'L004']);
  });

  it('reads a file with the 12 columns exactly as before', async () => {
    const real = await realLoaders();
    const read = real.parseCsv(`${COLUMNS_12}\nF-X-1,72,F,2026-08-21,celecoxib,Celebrex,200 mg,capsule,30,2,Take ONE capsule daily with food,Dr G. Sample\n`);
    expect(read.problems).toEqual([]);
    expect(read.lines).toEqual([{ id: 'L001', text: '2026-08-21 | Celebrex (celecoxib) 200 mg capsule | qty 30 | repeats 2 | Take ONE capsule daily with food | Dr G. Sample' }]);
    expect(factLineIdsOf(read.lines)).toEqual([]);
  });

  it('loads a criterion from a wave folder, with the facts it needs', async () => {
    const real = await realLoaders();
    const wave = makeWave(tempDir('lantern-contract-'), 'W960', { 'FACT-2': draftedFact('FACT-2'), 'GOOD-1': draftedSupplies('GOOD-1') });
    const loaded = await real.loadCriteriaFrom?.(path.join(wave, 'criteria'), ['FACT-2']);
    expect(loaded).toHaveLength(1);
    const fact = loaded?.[0];
    expect(fact?.id).toBe('FACT-2');
    expect(fact?.needs_facts).toEqual([{ kind: 'condition', what: 'Heart failure', meets: 'Heart failure is recorded as a condition' }]);
    expect(fact ? criterionClass(fact) : '').toBe('needs_a_fact');
    const plain = await real.loadCriteriaFrom?.(path.join(wave, 'criteria'), ['GOOD-1']);
    expect(plain?.[0] ? factsNeeded(plain[0]) : null).toEqual([]);
    // Asked for one at a time, a file that does not load gives its own reason.
    fs.writeFileSync(path.join(wave, 'criteria', 'GOOD-1', 'criterion.json'), '{ "id": "GOOD-1" }', 'utf8');
    await expect(real.loadCriteriaFrom?.(path.join(wave, 'criteria'), ['GOOD-1'])).rejects.toThrow('Criterion GOOD-1: "label" is missing.');
  });

  it('scores a wave folder with the real reader and loader, and fake model jobs', async () => {
    const real = await realLoaders();
    const fake = fakePipeline();
    const pipeline: Pipeline = { ...fake.pipeline, parseCsv: real.parseCsv, loadCriteriaFrom: real.loadCriteriaFrom };
    const wave = makeWave(tempDir('lantern-contract-'), 'W961', { 'FACT-2': draftedFact('FACT-2'), 'GOOD-1': draftedSupplies('GOOD-1'), 'GONE-3': { notDrafted: 'Not drafted.' } });
    const repo = tempDir('lantern-contract-repo-');
    const out = path.join(tempDir('lantern-contract-out-'), 'out');
    const log: string[] = [];
    const code = await main(pipeline, ['--wave', wave, '--out', out], { repoRoot: repo, cwd: repo, log: (l) => log.push(l) });
    expect(code).toBe(0);
    const results = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')) as EvalResults;
    expect(results.passing).toEqual(['FACT-2', 'GOOD-1']);
    expect(results.not_passing.map((n) => [n.id, n.result])).toEqual([['GONE-3', 'NOT_DRAFTED']]);
    const [fact, good] = results.score.criteria;
    expect(fact).toMatchObject({ criterionId: 'FACT-2', verdict: 'PASS', class: 'needs_a_fact', planted: 2, caught: 2, possibleCaught: 1 });
    expect(fact.factHistories).toEqual({ withFactPlanted: 1, withFactCaught: 1, withFactPossible: 0, noFactPlanted: 1, noFactCaught: 1, noFactPossible: 1 });
    expect(good).toMatchObject({ criterionId: 'GOOD-1', verdict: 'PASS', class: 'supplies_only', planted: 2, caught: 2 });
    // The fact line of pos-fact.csv was cited, and the letter step was told which finding was a possible one.
    const withFact = results.pairs.find((p) => p.caseFile === 'FACT-2/pos-fact.csv');
    expect(withFact?.screen.result?.lineIds).toEqual(['L001', 'L003', 'L004']);
    expect(results.cases.find((c) => c.file === 'FACT-2/pos-fact.csv')?.factLineIds).toEqual(['L001', 'L002']);
    expect(fake.findings.map((f) => [f.criterionId, f.possible, f.screen.missingFacts])).toEqual([
      ['FACT-2', false, []],
      ['FACT-2', true, ['Heart failure']],
      ['GOOD-1', false, []],
      ['GOOD-1', false, []],
    ]);
    const table = fs.readFileSync(path.join(out, 'table.md'), 'utf8');
    expect(table).toContain('- Histories with no line about the fact (`pos-nofact`): caught 1 of 1. Reported as a possible finding: 1. Reported as a plain finding: 0. Both count as caught.');
    expect(table).toContain('- **FACT 2** on `FACT-2/pos-nofact.csv`. The record does not show: Heart failure.');
    // The letter for the fact history prints the condition line, so the planted lines are shown.
    expect(fact.letters).toMatchObject({ needed: 2, produced: 2, withoutPlanted: 0 });
    expect(fact.letterLines.every((l) => l.observations.length === 0)).toBe(true);
  });
});
