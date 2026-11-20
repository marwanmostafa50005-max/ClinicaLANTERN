// tools/k04-adopt.mjs copies one criterion out of a wave folder into the repository.
// Importing the script writes nothing and does not exit. These tests use a temporary folder.
// No model is called.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface AdoptModule {
  adoptK04: (repo: string, board: string, argv: string[]) => number;
}

const adopt = await import(new URL('./k04-adopt.mjs', import.meta.url).href) as AdoptModule;
const made: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempPair(): { repo: string; board: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-k04-'));
  made.push(root);
  const repo = path.join(root, 'repo');
  const board = path.join(root, 'board');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(board, { recursive: true });
  return { repo, board };
}

function writeWave(board: string, wave: string, id: string, criterion: unknown, part: unknown, extra?: { name: string; text: string }): void {
  const base = path.join(board, 'w', 'kimiwork', 'waves', wave);
  fs.mkdirSync(path.join(base, 'criteria', id), { recursive: true });
  fs.mkdirSync(path.join(base, 'cases', id), { recursive: true });
  fs.writeFileSync(path.join(base, 'criteria', id, 'criterion.json'), JSON.stringify(criterion));
  fs.writeFileSync(path.join(base, 'cases', id, 'expected.part.json'), JSON.stringify(part));
  if (extra) fs.writeFileSync(path.join(base, 'cases', id, extra.name), extra.text);
}

describe('the K04 adopt helper', () => {
  it('stops when the ids or the waves are missing, and writes nothing', () => {
    const { repo, board } = tempPair();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(adopt.adoptK04(repo, board, ['node', 'k04-adopt.mjs'])).toBe(2);
    expect(adopt.adoptK04(repo, board, ['node', 'k04-adopt.mjs', '--ids', 'A'])).toBe(2);
    expect(adopt.adoptK04(repo, board, ['node', 'k04-adopt.mjs', '--waves', 'W1'])).toBe(2);
    expect(log.mock.calls.map(call => call[0])).toEqual([
      'need --ids and --waves',
      'need --ids and --waves',
      'need --ids and --waves'
    ]);
    expect(fs.readdirSync(repo)).toEqual([]);
  });

  it('takes the first wave that holds the id, refreshes the sheet, and adds the id to further once', () => {
    const { repo, board } = tempPair();
    writeWave(board, 'WOLD', 'K-1', { id: 'K-1', from: 'old' }, [{ file: 'cases/K-1/pos.csv', kind: 'positive' }]);
    writeWave(board, 'WNEW', 'K-1', { id: 'K-1', from: 'new' }, [
      { file: 'cases/K-1/pos.csv', kind: 'near-miss' },
      { file: 'cases/K-1/extra.csv', kind: 'positive' }
    ], { name: 'pos.csv', text: 'the history\n' });
    fs.mkdirSync(path.join(repo, 'cases'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'criteria'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'cases', 'expected.further.json'), JSON.stringify({
      cases: [
        { file: 'cases/K-1/pos.csv', kind: 'positive' },
        { file: 'cases/OTHER/keep.csv', kind: 'positive' }
      ]
    }, null, 2) + '\n');
    fs.writeFileSync(path.join(repo, 'criteria', 'active.json'), JSON.stringify({ further: ['ALREADY'] }, null, 2) + '\n');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const argv = ['node', 'k04-adopt.mjs', '--ids', 'K-1', '--waves', 'WNEW,WOLD', '--sheet', 'cases/expected.further.json'];
    expect(adopt.adoptK04(repo, board, argv)).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(repo, 'criteria', 'K-1', 'criterion.json'), 'utf8')).from).toBe('new');
    expect(fs.readFileSync(path.join(repo, 'cases', 'K-1', 'pos.csv'), 'utf8')).toBe('the history\n');
    const sheet = JSON.parse(fs.readFileSync(path.join(repo, 'cases', 'expected.further.json'), 'utf8'));
    expect(sheet.cases).toEqual([
      { file: 'cases/K-1/pos.csv', kind: 'near-miss' },
      { file: 'cases/OTHER/keep.csv', kind: 'positive' },
      { file: 'cases/K-1/extra.csv', kind: 'positive' }
    ]);
    const active = JSON.parse(fs.readFileSync(path.join(repo, 'criteria', 'active.json'), 'utf8'));
    expect(active.further).toEqual(['ALREADY', 'K-1']);
    expect(adopt.adoptK04(repo, board, argv)).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(repo, 'criteria', 'active.json'), 'utf8')).further).toEqual(['ALREADY', 'K-1']);
  });

  it('does not change further when the ids are in the first ten, and stops before the sheet when a wave is missing', () => {
    const { repo, board } = tempPair();
    writeWave(board, 'W1', 'K-2', { id: 'K-2' }, [{ file: 'cases/K-2/pos.csv', kind: 'positive' }]);
    fs.mkdirSync(path.join(repo, 'cases'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'criteria'), { recursive: true });
    const sheetText = JSON.stringify({ cases: [] }, null, 2) + '\n';
    fs.writeFileSync(path.join(repo, 'cases', 'expected.json'), sheetText);
    fs.writeFileSync(path.join(repo, 'criteria', 'active.json'), JSON.stringify({ further: [] }) + '\n');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const ten = ['node', 'k04-adopt.mjs', '--ids', 'K-2', '--waves', 'W1', '--sheet', 'cases/expected.json', '--ten'];
    expect(adopt.adoptK04(repo, board, ten)).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(repo, 'criteria', 'active.json'), 'utf8')).further).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(repo, 'cases', 'expected.json'), 'utf8')).cases).toEqual([
      { file: 'cases/K-2/pos.csv', kind: 'positive' }
    ]);

    const sheetBefore = fs.readFileSync(path.join(repo, 'cases', 'expected.json'), 'utf8');
    const missing = ['node', 'k04-adopt.mjs', '--ids', 'K-2,K-MISSING', '--waves', 'W1', '--sheet', 'cases/expected.json', '--ten'];
    expect(adopt.adoptK04(repo, board, missing)).toBe(1);
    expect(fs.readFileSync(path.join(repo, 'cases', 'expected.json'), 'utf8')).toBe(sheetBefore);
  });
});
