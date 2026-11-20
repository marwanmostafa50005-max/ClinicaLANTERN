// The screen prompt and the check prompt of one of the first ten, on one of its histories,
// as the engine builds them. A later change that alters a line, a line ID or the criterion
// block fails this test. The first ten passed with these texts (docs/PROOF_RECORDS.md section 7).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkMessages } from './check.ts';
import { loadCriteriaFrom } from './criteria.ts';
import { parseCsv } from './csv.ts';
import { screenMessages } from './screen.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function pinText(screen: { role: string; content: string }[], check: { role: string; content: string }[], lineIds: string[]): string {
  return [
    'CRITERION: STOPP-C10',
    'HISTORY: cases/STOPP-C10/pos-brand.csv',
    'LINES: ' + lineIds.join(' '),
    '',
    '--- SCREEN ---',
    screen.map(m => m.role + '\n' + m.content).join('\n\n'),
    '',
    '--- CHECK ---',
    check.map(m => m.role + '\n' + m.content).join('\n\n'),
    ''
  ].join('\n');
}

describe('the prompts of one of the first ten stay as they are', () => {
  it('STOPP-C10 on pos-brand.csv: the same lines, the same line IDs and the same criterion block', async () => {
    const [criterion] = await loadCriteriaFrom(path.join(root, 'criteria'), ['STOPP-C10']);
    const parsed = parseCsv(readFileSync(path.join(root, 'cases', 'STOPP-C10', 'pos-brand.csv'), 'utf8'));
    expect(parsed.problems).toEqual([]);
    const screen = screenMessages(parsed.patient, parsed.lines, criterion);
    const check = checkMessages(parsed.patient, parsed.lines, criterion, {
      lineIds: ['L001', 'L002'],
      medicines: ['apixaban'],
      reason: 'Pinned stand-in. Not a model answer.',
      linesVerified: true,
      missingFacts: [],
      model: 'lantern-screen',
      at: '2026-11-18T00:00:00.000Z',
      seconds: 0
    });
    const built = pinText(screen, check, parsed.lines.map(l => l.id));
    const stored = readFileSync(path.join(root, 'pipeline', 'first-ten-pin.txt'), 'utf8').replace(/\r\n/g, '\n');
    expect(built).toBe(stored);
    expect(built).toContain('L001 |');
    expect(built).toContain('STOPP C10');
    expect(built).not.toContain('FACTS THIS CRITERION NEEDS');
    expect(built).not.toContain('missing_facts');
  });
});
