// Guards the answer sheet of the first ten and their criterion files (task K01).
// Every check reads files only: no model. Fictional patients only.

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

describe('the first ten and their answer sheet', () => {
  const list = readJson<{ active: string[]; further?: string[]; reserves: string[] }>('criteria/active.json');
  const sheet = readJson<ExpectedSheet>('cases/expected.json');

  it('loads every active criterion file', () => {
    for (const id of list.active) {
      const file = `criteria/${id}/criterion.json`;
      expect(fs.existsSync(path.join(REPO, file)), file).toBe(true);
      const c = readJson<Criterion>(file);
      expect(c.id).toBe(id);
    }
  });

  it('every history in the sheet exists and reads with no problem', () => {
    for (const c of sheet.cases) {
      const file = path.join(REPO, 'cases', c.file);
      expect(fs.existsSync(file), c.file).toBe(true);
      const parsed = parseCsv(fs.readFileSync(file, 'utf8'));
      expect(parsed.problems, `${c.file}: ${parsed.problems.join('; ')}`).toEqual([]);
      expect(parsed.lines.length, `${c.file}: no lines`).toBeGreaterThan(0);
    }
  });

  it('every line ID the sheet names exists in its history', () => {
    for (const c of sheet.cases) {
      const parsed = parseCsv(fs.readFileSync(path.join(REPO, 'cases', c.file), 'utf8'));
      const ids = new Set(parsed.lines.map((l) => l.id));
      for (const f of c.findings) {
        for (const group of f.must_cite) {
          expect(group.length, `${c.file}: an empty must_cite group`).toBeGreaterThan(0);
          for (const id of group) {
            expect(ids.has(id), `${c.file}: ${id} is not a line of the history`).toBe(true);
          }
        }
      }
    }
  });

  it('every active criterion has two planted histories and one near miss', () => {
    for (const id of list.active) {
      const own = sheet.cases.filter((c) => c.file.startsWith(`${id}/`));
      expect(own.filter((c) => c.kind === 'positive').length, `${id}: planted histories`).toBe(2);
      expect(own.filter((c) => c.kind === 'near_miss').length, `${id}: near miss`).toBe(1);
    }
  });

  it('positives name their planted findings; near misses and clean histories name none', () => {
    for (const c of sheet.cases) {
      if (c.kind === 'positive') expect(c.findings.length, `${c.file}: a positive with no finding`).toBeGreaterThan(0);
      else expect(c.findings, `${c.file}: nothing may be planted here`).toEqual([]);
    }
  });

  it('no criterion in use says draft: false without a signature', () => {
    for (const id of [...list.active, ...(list.further ?? [])]) {
      const c = readJson<Criterion>(`criteria/${id}/criterion.json`);
      if (c.draft === false) {
        expect(c.signed_by_clinical_reviewer, `${id}: draft false with no signature`).not.toBeNull();
      }
    }
  });
});
