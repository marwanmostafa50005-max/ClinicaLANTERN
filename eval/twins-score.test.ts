// The twins scorer calls the models when it is started. This test does not import it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../pipeline/config.ts';

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('the twins scorer reads lantern.config.json from the repository root', () => {
  it('a folder name finds the file, and the file name itself does not', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-twins-cfg-'));
    made.push(dir);
    fs.writeFileSync(path.join(dir, 'lantern.config.json'), JSON.stringify({
      ollamaBase: 'http://127.0.0.1:27999',
      models: { screen: 'lantern-screen-custom' },
    }), 'utf8');
    const missed = loadConfig(path.join(dir, 'lantern.config.json'));
    const found = loadConfig(dir);
    expect(missed.ollamaBase).toBe('http://127.0.0.1:27435');
    expect(missed.models.screen).not.toBe('lantern-screen-custom');
    expect(found.ollamaBase).toBe('http://127.0.0.1:27999');
    expect(found.models.screen).toBe('lantern-screen-custom');
    const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'twins-score.ts'), 'utf8');
    expect(source).toContain("loadConfig('.')");
    expect(source).not.toContain("loadConfig('lantern.config.json')");
  });
});
