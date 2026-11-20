import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function run(args: string[]): Promise<{ status: number | null; text: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['tools/condition-markers-report.mjs', ...args], {
      cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe']
    });
    let text = '';
    child.stdout.on('data', chunk => { text += chunk.toString(); });
    child.stderr.on('data', chunk => { text += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', status => resolve({ status, text }));
  });
}

function criterion(id: string, needsFacts: unknown[], ingredients: string[], brands: Record<string, string[]>) {
  return {
    id,
    label: id,
    family: 'Test',
    title: id,
    statement: 'Fictional report fixture.',
    statement_origin: 'entrant',
    source: { document: 'Test', citation: 'Test', licence: 'Test', licence_status: 'proposed', credit: 'Test.' },
    plain_summary: 'A report fixture.',
    medicine_groups: [{ key: 'A', name: 'Fixture group', ingredients, brands }],
    needs_facts: needsFacts,
    rule_for_models: 'A fictional report fixture.',
    cannot_be_seen: 'The fixture fact.',
    ask_the_gp: 'Review.',
    urgency: 'routine',
    draft: true,
    signed_by_clinical_reviewer: null
  };
}

describe('condition-markers-report', () => {
  it('reports list gaps and the exact questions the application opens for a history', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-marker-report-'));
    made.push(dir);
    const markers = path.join(dir, 'condition-markers.json');
    const criteria = path.join(dir, 'criteria');
    fs.mkdirSync(criteria);
    fs.writeFileSync(markers, JSON.stringify({ conditions: [
      {
        condition: 'chronic heart failure',
        question: 'Does this patient have chronic heart failure?',
        fact_names: [' Heart Failure ', 'Orphan condition fact'],
        points_to_it: [{ ingredient: 'sacubitril with valsartan', brands: ['Entresto'], forms: [] }],
        also_used_for_it: []
      },
      {
        condition: 'dementia',
        question: 'Does this patient have dementia?',
        fact_names: ['Dementia'],
        points_to_it: [{ ingredient: 'donepezil', brands: ['Aricept'], forms: [] }],
        also_used_for_it: []
      }
    ] }));
    const items = [
      criterion('ONE', [{ kind: 'condition', what: 'Heart failure', meets: 'recorded' }],
        ['sacubitril with valsartan'], { 'sacubitril with valsartan': ['Entresto'] }),
      criterion('TWO', [
        { kind: 'condition', what: 'Dementia', meets: 'recorded' },
        { kind: 'condition', what: 'Unlisted condition', meets: 'recorded' }
      ], ['donepezil'], { donepezil: ['Aricept'] }),
      criterion('THREE', [{ kind: 'result', what: 'Heart failure', meets: 'recorded' }],
        ['ibuprofen'], { ibuprofen: ['Nurofen'] })
    ];
    for (const item of items) {
      fs.mkdirSync(path.join(criteria, item.id));
      fs.writeFileSync(path.join(criteria, item.id, 'criterion.json'), JSON.stringify(item));
    }
    const history = path.join(dir, 'history.csv');
    fs.writeFileSync(history,
      'patient_ref,patient_age,patient_sex,dispense_date,medicine,brand,strength,form,quantity,directions,prescriber\n' +
      'F-001,72,F,2026-08-08,sacubitril with valsartan,Entresto,24/26 mg,tablet,30,one daily,Dr A. Example\n');
    const out = path.join(dir, 'report.json');
    const base = ['--markers', markers, '--criteria-dir', criteria];
    const result = await run([...base, '--history', history, '--json', out]);

    expect(result.status, result.text).toBe(0);
    expect(result.text).toContain('Conditions in the list: 2');
    expect(result.text).toContain('Fact names: 3');
    expect(result.text).toContain('Does this patient have chronic heart failure?');
    const report = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(report.counts).toEqual({
      conditions: 2,
      factNames: 3,
      criteriaWithListedConditionFact: 2,
      criteriaWithUnlistedConditionFact: 1
    });
    expect(report.unmatchedFactNames).toEqual([
      { condition: 'chronic heart failure', factName: 'Orphan condition fact' }
    ]);
    expect(report.unlistedConditionFacts).toEqual([
      { criterionId: 'TWO', factNames: ['Unlisted condition'] }
    ]);
    expect(report.history.questions).toEqual([{
      condition: 'chronic heart failure',
      question: 'Does this patient have chronic heart failure?',
      kind: 'condition',
      what: 'Heart failure',
      supplyLineIds: ['L001'],
      supplyLines: ['2026-08-08 | Entresto (sacubitril with valsartan) 24/26 mg tablet | qty 30 | one daily | Dr A. Example'],
      criterionIds: ['ONE'],
      reason: 'Asked because Entresto (sacubitril with valsartan) 24/26 mg tablet is supplied; it points to chronic heart failure.'
    }]);
  });
});
