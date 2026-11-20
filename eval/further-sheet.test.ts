// Guards the further criteria in use and their answer sheet (task K04). No model.
// Fictional patients only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Criterion, ExpectedSheet } from '../shared/types.ts';
import { parseCsv } from '../pipeline/csv.ts';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(REPO, file), 'utf8')) as T;
}

describe('the further criteria and cases/expected.further.json', () => {
  const list = readJson<{ active: string[]; further?: string[]; reserves: string[] }>('criteria/active.json');
  const further = list.further ?? [];
  const sheetFile = path.join(REPO, 'cases', 'expected.further.json');
  const hasSheet = fs.existsSync(sheetFile);
  const sheet = hasSheet ? readJson<ExpectedSheet>('cases/expected.further.json') : null;

  it('every further criterion has a loadable file with its own id, a draft mark and no signature yet', () => {
    for (const id of further) {
      const file = `criteria/${id}/criterion.json`;
      expect(fs.existsSync(path.join(REPO, file)), file).toBe(true);
      const c = readJson<Criterion>(file);
      expect(c.id).toBe(id);
      expect(c.draft, `${id}: a further criterion is a draft until the founder signs`).toBe(true);
      expect(c.signed_by_clinical_reviewer, `${id}: nobody has signed a further criterion`).toBeNull();
    }
  });

  it('the further sheet exists once any criterion is adopted, and its findings name only further or active criteria', () => {
    if (further.length === 0) return;
    expect(hasSheet, 'cases/expected.further.json').toBe(true);
    const allowed = new Set([...further, ...list.active]);
    const sheetCriteria = new Set((sheet?.cases ?? []).flatMap((c) => c.findings.map((f) => f.criterion)));
    for (const id of sheetCriteria) {
      expect(allowed.has(id), `${id} is in the further sheet but is neither further nor one of the ten`).toBe(true);
    }
  });

  it('every history in the further sheet exists and reads with no problem', () => {
    if (!sheet) return;
    for (const c of sheet.cases) {
      const file = path.join(REPO, 'cases', c.file);
      expect(fs.existsSync(file), c.file).toBe(true);
      const parsed = parseCsv(fs.readFileSync(file, 'utf8'));
      expect(parsed.problems, `${c.file}: ${parsed.problems.join('; ')}`).toEqual([]);
      expect(parsed.lines.length, `${c.file}: no lines`).toBeGreaterThan(0);
    }
  });

  it('every line ID the further sheet names exists in its history', () => {
    if (!sheet) return;
    for (const c of sheet.cases) {
      const parsed = parseCsv(fs.readFileSync(path.join(REPO, 'cases', c.file), 'utf8'));
      const ids = new Set(parsed.lines.map((l) => l.id));
      for (const f of c.findings) {
        for (const group of f.must_cite) {
          expect(group.length, `${c.file}: an empty must_cite group`).toBeGreaterThan(0);
          for (const id of group) expect(ids.has(id), `${c.file}: ${id} is not a line of the history`).toBe(true);
        }
      }
    }
  });

  it('positives name their planted findings; near misses and clean histories name none', () => {
    if (!sheet) return;
    for (const c of sheet.cases) {
      if (c.kind === 'positive') expect(c.findings.length, `${c.file}: a positive with no finding`).toBeGreaterThan(0);
      else expect(c.findings, `${c.file}: nothing may be planted here`).toEqual([]);
    }
  });
});
