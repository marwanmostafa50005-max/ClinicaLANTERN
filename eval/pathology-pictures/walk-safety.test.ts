import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeConfig } from '../../pipeline/config.ts';
import { makeOwnedDataDir, removeOwnedDataDir, standInHealth } from './walk-safety.mjs';

const made: string[] = [];
afterEach(async () => {
  for (const dir of made.splice(0)) await removeOwnedDataDir(dir);
});

describe('K-PATH-3 walk safety', () => {
  it('creates a unique default data directory and removes only a directory created by the harness', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'k-path-3-safety-'));
    made.push(root);
    const first = makeOwnedDataDir('', path.join(root, 'tmp'));
    const second = makeOwnedDataDir('', path.join(root, 'tmp'));
    expect(first).not.toBe(second);
    expect(fs.existsSync(first)).toBe(true);
    expect(await removeOwnedDataDir(first)).toBe(true);
    expect(fs.existsSync(first)).toBe(false);
    expect(fs.existsSync(second)).toBe(true);
  });

  it('refuses an existing explicit data directory instead of loading and deleting it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'k-path-3-existing-'));
    made.push(root);
    const existing = path.join(root, 'application-data');
    fs.mkdirSync(existing);
    fs.writeFileSync(path.join(existing, 'state.json'), '{}');
    expect(() => makeOwnedDataDir(existing, path.join(root, 'tmp'))).toThrow('already exists');
    expect(fs.readFileSync(path.join(existing, 'state.json'), 'utf8')).toBe('{}');
  });

  it('answers health with all three stand-in models and no real service address', () => {
    const cfg = normalizeConfig({ ollamaBase: 'http://127.0.0.1:1' });
    expect(standInHealth(cfg)).toEqual({
      ollama: 'up', version: 'stand-in-no-model', models: { screen: true, check: true, letter: true },
      names: cfg.models, displayNames: cfg.modelNames, modelsBehind: cfg.modelsBehind
    });
    expect(cfg.ollamaBase).toBe('http://127.0.0.1:1');
  });
});
