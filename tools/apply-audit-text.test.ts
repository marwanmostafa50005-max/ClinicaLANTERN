// tools/apply-audit-text.mjs replaces one named field of a criterion file.
// Importing the script writes nothing: the real criteria change only when the file is run on its own.
// These tests use a temporary folder. No model is called.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface AuditStats {
  applied: number;
  already: number;
  noFile: number;
  noField: number;
}

interface AuditText {
  applyAuditText: (repo: string, patchFile: string) => AuditStats;
}

const audit = await import(new URL('./apply-audit-text.mjs', import.meta.url).href) as AuditText;
const made: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-audit-text-'));
  made.push(dir);
  return dir;
}

function writeCriterion(repo: string, id: string, text: string): string {
  const file = path.join(repo, 'criteria', id, 'criterion.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

function writePatches(dir: string, body: string): string {
  const file = path.join(dir, 'patches.json');
  fs.writeFileSync(file, body);
  return file;
}

describe('audit text patches', () => {
  it('replaces the named field, keeps Windows line ends, and cuts a long reason at 80 characters', () => {
    const repo = tempRepo();
    const file = writeCriterion(repo, 'T-1', '{\r\n  "id": "T-1",\r\n  "plain_summary": "old words"\r\n}\r\n');
    const why = `${'a'.repeat(80)}TAIL`;
    const patch = writePatches(repo, JSON.stringify([
      { id: 'T-1', field: 'plain_summary', whole_field: 'new words', why }
    ]));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stats = audit.applyAuditText(repo, patch);
    const out = fs.readFileSync(file, 'utf8');
    expect(stats).toEqual({ applied: 1, already: 0, noFile: 0, noField: 0 });
    expect(JSON.parse(out).plain_summary).toBe('new words');
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
    expect(out).toContain('\r\n');
    expect(log.mock.calls[0][0]).toBe(`T-1: plain_summary patched (${'a'.repeat(80)}...)`);
    expect(String(log.mock.calls[0][0])).not.toContain('TAIL');
    expect(log.mock.calls[1][0]).toBe(JSON.stringify(stats));
  });

  it('leaves a file alone when the field already matches, and leaves line feeds as line feeds', () => {
    const repo = tempRepo();
    const spaced = '{"id":"T-2","plain_summary":"same words"}\n';
    const spacedFile = writeCriterion(repo, 'T-2', spaced);
    const lf = '{\n  "id": "T-3",\n  "plain_summary": "old"\n}\n';
    const lfFile = writeCriterion(repo, 'T-3', lf);
    const patch = writePatches(repo, JSON.stringify([
      { id: 'T-2', field: 'plain_summary', whole_field: 'same words', why: 'because' },
      { id: 'T-3', field: 'plain_summary', whole_field: 'new words', why: 'because' }
    ]));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const stats = audit.applyAuditText(repo, patch);
    const written = fs.readFileSync(lfFile, 'utf8');
    expect(stats).toEqual({ applied: 1, already: 1, noFile: 0, noField: 0 });
    expect(fs.readFileSync(spacedFile, 'utf8')).toBe(spaced);
    expect(JSON.parse(written).plain_summary).toBe('new words');
    expect(written).not.toContain('\r');
    const again = audit.applyAuditText(repo, patch);
    expect(again).toEqual({ applied: 0, already: 2, noFile: 0, noField: 0 });
    expect(fs.readFileSync(lfFile, 'utf8')).toBe(written);
  });

  it('counts a missing file and a missing field, skips a row that is not a patch, and reads a list wrapped in patches after a byte-order mark', () => {
    const repo = tempRepo();
    writeCriterion(repo, 'T-4', '{"id":"T-4","statement":"kept"}\n');
    const patch = writePatches(repo, `\uFEFF${JSON.stringify({
      patches: [
        null,
        { id: 4, field: 'statement', whole_field: 'no' },
        { id: 'T-4', field: 'statement' },
        { id: 'T-MISSING', field: 'statement', whole_field: 'gone' },
        { id: 'T-4', field: 'plain_summary', whole_field: 'not a field' },
        { id: 'T-4', field: 'statement', whole_field: 'replaced', why: 'short' }
      ]
    })}`);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stats = audit.applyAuditText(repo, patch);
    expect(stats).toEqual({ applied: 1, already: 0, noFile: 1, noField: 1 });
    expect(JSON.parse(fs.readFileSync(path.join(repo, 'criteria', 'T-4', 'criterion.json'), 'utf8')).statement).toBe('replaced');
    expect(log.mock.calls.map(call => call[0])).toEqual([
      'no file for T-MISSING',
      'T-4: no field plain_summary',
      'T-4: statement patched (short...)',
      JSON.stringify(stats)
    ]);
  });
});
