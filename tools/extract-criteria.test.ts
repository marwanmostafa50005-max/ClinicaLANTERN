// tools/extract-criteria.mjs reads a folder of the earlier project and writes one JSON file
// for each card. These tests give it a temporary folder. They do not open the earlier project.
// Files written under criteria/_extract for this batch are removed afterwards. No model is called.
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(repoRoot, 'tools', 'extract-criteria.mjs');
const outDir = path.join(repoRoot, 'criteria', '_extract');
const registerRel = path.join('build-evidence', 'resumption-20261110', 'criteria-lane', 'CRITERIA_413_REGISTER_V1.json');

const made: string[] = [];
const created: string[] = [];

afterEach(() => {
  for (const file of created.splice(0)) fs.rmSync(file, { force: true });
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-extract-'));
  made.push(dir);
  return dir;
}

function remember(): void {
  if (!fs.existsSync(outDir)) return;
  for (const name of fs.readdirSync(outDir)) {
    if (!name.startsWith('GTESTS54')) continue;
    const file = path.join(outDir, name);
    if (!created.includes(file)) created.push(file);
  }
}

function run(args: string[]): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let out = '';
    let err = '';
    child.stdout.on('data', chunk => { out += String(chunk); });
    child.stderr.on('data', chunk => { err += String(chunk); });
    child.once('error', reject);
    child.once('exit', code => {
      remember();
      resolve({ code, out, err });
    });
  });
}

interface Pin {
  path: string;
  bytes: number;
  sha256: string;
}

function pinFor(body: Buffer, rel: string, over: Partial<Pin> = {}): Pin {
  return {
    path: rel,
    bytes: body.length,
    sha256: crypto.createHash('sha256').update(body).digest('hex'),
    ...over
  };
}

function writeRegister(dir: string, source: unknown): void {
  const file = path.join(dir, registerRel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof source === 'string' ? source : JSON.stringify({ pins: { source } }));
}

function projectWith(body: Buffer, rel: string, over: Partial<Pin> = {}): string {
  const dir = tempDir();
  const pin = pinFor(body, rel, over);
  if (!path.isAbsolute(pin.path) && !pin.path.startsWith('..')) {
    const file = path.join(dir, pin.path);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  writeRegister(dir, pin);
  return dir;
}

describe('extract-criteria', () => {
  it('refuses a missing register, a register that does not pin the package, and a protected folder', async () => {
    const missing = await run([tempDir()]);
    expect(missing.code).toBe(1);
    expect(missing.err).toMatch(/cannot read the register/);
    expect(missing.out).toBe('');

    const bare = tempDir();
    writeRegister(bare, 'not json');
    const broken = await run([bare]);
    expect(broken.code).toBe(1);
    expect(broken.err).toMatch(/cannot read the register/);

    const unpinned = tempDir();
    writeRegister(unpinned, { path: 'pkg/cards.json' });
    const noPin = await run([unpinned]);
    expect(noPin.code).toBe(1);
    expect(noPin.err).toMatch(/does not pin the source package/);

    const sealed = path.join(tempDir(), 'sealed-box');
    fs.mkdirSync(sealed);
    const refused = await run([sealed]);
    expect(refused.code).toBe(1);
    expect(refused.err).toMatch(/refusing to open a protected path/);
  });

  it('refuses a package outside the folder, a protected name, and a file that is not the pinned one', async () => {
    const outside = projectWith(Buffer.from('{}'), path.join('..', 'outside.json'));
    const left = await run([outside]);
    expect(left.code).toBe(1);
    expect(left.err).toMatch(/points outside the earlier project folder/);

    const named = projectWith(Buffer.from('{}'), path.join('data', 'synthetic_cases.py'));
    const protectedName = await run([named]);
    expect(protectedName.code).toBe(1);
    expect(protectedName.err).toMatch(/refusing to open a protected path/);

    const gone = projectWith(Buffer.from('{}'), path.join('pkg', 'missing.json'));
    fs.rmSync(path.join(gone, 'pkg', 'missing.json'));
    const unread = await run([gone]);
    expect(unread.code).toBe(1);
    expect(unread.err).toMatch(/cannot read the package/);

    const body = Buffer.from('{"cards":[]}');
    const wrong = projectWith(body, path.join('pkg', 'cards.json'), { sha256: 'abc', bytes: 1 });
    const mismatch = await run([wrong]);
    expect(mismatch.code).toBe(1);
    expect(mismatch.err).toMatch(/does not match the size and hash/);
    expect(mismatch.err).toMatch(/Nothing was written/);
  });

  it('refuses a package that is not JSON, and one with no list of cards', async () => {
    const text = projectWith(Buffer.from('not json'), path.join('pkg', 'cards.json'));
    const notJson = await run(['--all', text]);
    expect(notJson.code).toBe(1);
    expect(notJson.err).toMatch(/not valid JSON/);

    const empty = projectWith(Buffer.from('{"cards":null}'), path.join('pkg', 'cards.json'));
    const noList = await run(['--all', empty]);
    expect(noList.code).toBe(1);
    expect(noList.err).toMatch(/no list of cards/);
  });

  it('takes one card with --all, keeps the statement, and does not copy a question', async () => {
    const statement = 'Do not use warfarin || aspirin.';
    const body = Buffer.from(JSON.stringify({
      cards: [
        { card_id: 'skip me' },
        {
          card_id: 'LX-GTESTS54A',
          card_version: 'v1',
          source_family: 'STOPP',
          questions: ['NOT-COPIED-TOKEN-54'],
          source: {
            text_verbatim: statement,
            item_label: 'C10 (draft remark)',
            document: 'STOPP/START',
            edition_version: '3',
            doi: '10.1234/example',
            section: 'C',
            locator: 'C10',
            preambles: [{ scope: 'age', text: '65 or over', extra: 'drop' }],
            footnotes_and_definitions: [{ marker: 'a', text: 'A note.', source: 'paper', extra: 'drop' }],
            extra_columns: ['dose', ''],
            members: [
              { source_row_id: 'R1', role: 'Canonical criterion', name_as_printed: 'Warfarin', source: 'table' },
              { source_row_id: 'R2', role: 'Related', name_as_printed: 'Aspirin', source: 'table', extra: 'drop' }
            ],
            related_documents: [{ document: 'Other', url: 'https://example.test/doc', role: 'see also', extra: 'drop' }]
          },
          rights: {
            licence: 'CC BY 4.0',
            licence_url: 'https://creativecommons.org/licenses/by/4.0/',
            credit: 'Credit line.',
            basis: 'The publisher page.',
            modification_notice: 'Shortened.',
            field_dependencies: ['one open point', ''],
            status_proposed: 'proposed',
            per_card_check: 'independent review pending'
          }
        }
      ]
    }));
    const dir = projectWith(body, 'pkg/cards.json', {
      sha256: crypto.createHash('sha256').update(body).digest('hex').toUpperCase()
    });
    const result = await run(['--all', dir]);
    expect(result.code).toBe(0);
    expect(result.err).toBe('');
    expect(result.out).toBe(`GTESTS54A\t${Array.from(statement).length}\n`);

    const saved = JSON.parse(fs.readFileSync(path.join(outDir, 'GTESTS54A.json'), 'utf8')) as {
      found: boolean;
      statement: string;
      statement_chars: number;
      label: string;
      family: string;
      source: { document: string; citation: string; doi: string; url: string; credit: string };
      rights_block_as_recorded: { field_dependencies: string[]; status_proposed: string };
      context_as_recorded: {
        preambles: unknown[];
        footnotes_and_definitions: unknown[];
        extra_columns: string[];
        source_rows: unknown[];
        related_documents: unknown[];
      };
      extraction: { cautions: string[]; package_sha256: string };
    };
    expect(saved.found).toBe(true);
    expect(saved.statement).toBe(statement);
    expect(saved.statement_chars).toBe(Array.from(statement).length);
    expect(saved.label).toBe('C10 (draft remark)');
    expect(saved.family).toBe('STOPP');
    expect(saved.source).toMatchObject({
      document: 'STOPP/START',
      citation: 'Credit line.',
      doi: '10.1234/example',
      url: 'https://doi.org/10.1234/example',
      credit: 'Credit line.'
    });
    expect(saved.rights_block_as_recorded.field_dependencies).toEqual(['one open point']);
    expect(saved.context_as_recorded.preambles).toEqual([{ scope: 'age', text: '65 or over' }]);
    expect(saved.context_as_recorded.footnotes_and_definitions).toEqual([{ marker: 'a', text: 'A note.', source: 'paper' }]);
    expect(saved.context_as_recorded.extra_columns).toEqual(['dose']);
    expect(saved.context_as_recorded.source_rows).toEqual([
      { source_row_id: 'R1', role: 'Canonical criterion', source: 'table', name_as_printed: 'Warfarin' },
      { source_row_id: 'R2', role: 'Related', source: 'table', name_as_printed: 'Aspirin' }
    ]);
    expect(saved.context_as_recorded.related_documents).toEqual([
      { document: 'Other', url: 'https://example.test/doc', role: 'see also' }
    ]);
    expect(saved.extraction.package_sha256).toBe(crypto.createHash('sha256').update(body).digest('hex'));
    const cautions = saved.extraction.cautions.join('\n');
    expect(cautions).toContain('rights review is pending');
    expect(cautions).toContain('1 open point');
    expect(cautions).toContain('Warfarin, Aspirin');
    expect(cautions).toContain('R2 (Related)');
    expect(cautions).toContain('carries a remark');
    expect(JSON.stringify(saved)).not.toContain('NOT-COPIED-TOKEN-54');
    expect(JSON.stringify(saved)).not.toContain('"extra"');
  });

  it('records a card with no statement, a repeated identifier, and no DOI as not a guess', async () => {
    const noStatement = Buffer.from(JSON.stringify({
      cards: [{ card_id: 'LX-GTESTS54B', source: { item_label: 'No text' } }]
    }));
    const missingText = await run(['--all', projectWith(noStatement, 'pkg/cards.json')]);
    expect(missingText.code).toBe(0);
    expect(missingText.out).toBe('GTESTS54B\tnot found\n');
    const missed = JSON.parse(fs.readFileSync(path.join(outDir, 'GTESTS54B.json'), 'utf8')) as {
      found: boolean;
      reason: string;
      statement: null;
    };
    expect(missed.found).toBe(false);
    expect(missed.statement).toBeNull();
    expect(missed.reason).toMatch(/no statement text/);

    const doubled = Buffer.from(JSON.stringify({
      cards: [
        { card_id: 'LX-GTESTS54C', source: { text_verbatim: 'First.' } },
        { card_id: 'LX-GTESTS54C', source: { text_verbatim: 'Second.' } }
      ]
    }));
    const repeated = await run(['--all', projectWith(doubled, 'pkg/cards.json')]);
    expect(repeated.code).toBe(0);
    expect(repeated.out).toBe('GTESTS54C\tnot found\nGTESTS54C\tnot found\n');
    const both = JSON.parse(fs.readFileSync(path.join(outDir, 'GTESTS54C.json'), 'utf8')) as { reason: string; statement: null };
    expect(both.reason).toMatch(/More than one card/);
    expect(both.statement).toBeNull();
    expect(JSON.stringify(both)).not.toContain('First.');
    expect(JSON.stringify(both)).not.toContain('Second.');

    const noDoi = Buffer.from(JSON.stringify({
      cards: [{ card_id: 'LX-GTESTS54D', source: { text_verbatim: 'A short statement.', doi: 'not-a-doi' }, rights: {} }]
    }));
    const undoi = await run(['--all', projectWith(noDoi, 'pkg/cards.json')]);
    expect(undoi.code).toBe(0);
    const saved = JSON.parse(fs.readFileSync(path.join(outDir, 'GTESTS54D.json'), 'utf8')) as {
      source: { doi: string; url: null };
      extraction: { cautions: string[] };
    };
    expect(saved.source.doi).toBe('not-a-doi');
    expect(saved.source.url).toBeNull();
    expect(saved.extraction.cautions.join('\n')).not.toContain('records no DOI');
  });

  it('says two open points, and does not add a pending review when the note does not say so', async () => {
    const statement = 'One sentence only.';
    const body = Buffer.from(JSON.stringify({
      cards: [{
        card_id: 'LX-GTESTS54E',
        source: {
          text_verbatim: statement,
          item_label: 'Plain label',
          doi: '',
          members: [{ source_row_id: 'R1', role: 'Canonical criterion', name_as_printed: 'Only' }]
        },
        rights: {
          status_proposed: 'proposed',
          per_card_check: 'checked',
          field_dependencies: ['alpha', 'beta']
        }
      }]
    }));
    const result = await run(['--all', projectWith(body, 'pkg/cards.json')]);
    expect(result.code).toBe(0);
    expect(result.out).toBe(`GTESTS54E\t${Array.from(statement).length}\n`);
    const saved = JSON.parse(fs.readFileSync(path.join(outDir, 'GTESTS54E.json'), 'utf8')) as {
      source: { doi: null; url: null };
      extraction: { cautions: string[] };
    };
    expect(saved.source.doi).toBeNull();
    expect(saved.source.url).toBeNull();
    const cautions = saved.extraction.cautions.join('\n');
    expect(cautions).toContain('2 open points');
    expect(cautions).toContain('recorded the rights status "proposed"');
    expect(cautions).toContain('records no DOI');
    expect(cautions).not.toContain('review is pending');
    expect(cautions).not.toContain('carries a remark');
    expect(cautions).not.toContain('joined them');
    expect(cautions).not.toContain('other source rows');
    expect(cautions).not.toContain('framing text');
  });

  it('names one open point, a pending review, a label remark, joined rows, another source row, and framing text', async () => {
    const statement = 'Left row || Right row';
    const body = Buffer.from(JSON.stringify({
      cards: [{
        card_id: 'LX-GTESTS54F',
        source_family: 'STOPP',
        source: {
          text_verbatim: statement,
          item_label: 'Label (remark)',
          doi: '10.1000/gtests54f',
          document: 'A table',
          preambles: [{ scope: 'age', text: 'Over 65' }],
          members: [
            { source_row_id: 'R1', role: 'Canonical criterion', name_as_printed: 'Alpha' },
            { source_row_id: 'R2', role: 'Note', name_as_printed: 'Beta' }
          ]
        },
        rights: {
          status_proposed: 'proposed',
          per_card_check: 'review pending on the licence',
          field_dependencies: ['only-one'],
          credit: 'A credit line.'
        }
      }]
    }));
    const result = await run(['--all', projectWith(body, 'pkg/cards.json')]);
    expect(result.code).toBe(0);
    expect(result.err).toBe('');
    expect(result.out).toBe(`GTESTS54F\t${Array.from(statement).length}\n`);
    const saved = JSON.parse(fs.readFileSync(path.join(outDir, 'GTESTS54F.json'), 'utf8')) as {
      found: boolean;
      label: string;
      source: { doi: string; url: string };
      context_as_recorded: { preambles: Array<{ scope?: string; text?: string }> };
      extraction: { cautions: string[] };
    };
    expect(saved.found).toBe(true);
    expect(saved.label).toBe('Label (remark)');
    expect(saved.source.doi).toBe('10.1000/gtests54f');
    expect(saved.source.url).toBe('https://doi.org/10.1000/gtests54f');
    expect(saved.context_as_recorded.preambles).toEqual([{ scope: 'age', text: 'Over 65' }]);
    const cautions = saved.extraction.cautions.join('\n');
    expect(cautions).toContain('1 open point');
    expect(cautions).not.toContain('1 open points');
    expect(cautions).toContain('independent rights review is pending');
    expect(cautions).toContain('carries a remark');
    expect(cautions).toContain('holds 2 rows');
    expect(cautions).toContain('joined them with " || "');
    expect(cautions).toContain('Rows: Alpha, Beta.');
    expect(cautions).toContain('other source rows: R2 (Note)');
    expect(cautions).toContain('framing text is in context_as_recorded.preambles');
    expect(cautions).not.toContain('records no DOI');
  });

  it('prints nothing but a blank line when --all finds no card in the pool form', async () => {
    const body = Buffer.from(JSON.stringify({ cards: [{ card_id: 'plain' }, { card_id: 'LX-bad id' }] }));
    const result = await run(['--all', projectWith(body, 'pkg/cards.json')]);
    expect(result.code).toBe(0);
    expect(result.err).toBe('');
    expect(result.out).toBe('\n');
    expect(fs.readdirSync(outDir).some(name => name.startsWith('GTESTS54'))).toBe(false);
  });

  it('writes a lower-case card id in capitals, and does not build a link for a short DOI', async () => {
    const statement = 'Left || Right';
    const body = Buffer.from(JSON.stringify({
      cards: [
        null,
        { card_id: 54 },
        {
          card_id: 'LX-gtests54g',
          card_version: 'v9',
          source_family: 'STOPP',
          source: {
            text_verbatim: statement,
            item_label: 'Plain',
            edition_version: '3',
            section: 'C',
            locator: 'C10',
            doi: '10.12/short',
            members: [
              { role: 'Canonical criterion' },
              { role: 'Note', name_as_printed: '' }
            ]
          },
          rights: { per_card_check: 'review pending on the licence' }
        }
      ]
    }));
    const result = await run(['--all', projectWith(body, 'pkg/cards.json')]);
    expect(result.code, result.err).toBe(0);
    expect(result.out).toBe(`GTESTS54G\t${Array.from(statement).length}\n`);
    const saved = JSON.parse(fs.readFileSync(path.join(outDir, 'GTESTS54G.json'), 'utf8')) as {
      id: string;
      old_id: string;
      source: { edition: string; doi: string; url: string | null };
      context_as_recorded: { section: string; locator: string };
      extraction: { card_version: string; cautions: string[] };
    };
    expect(saved.id).toBe('GTESTS54G');
    expect(saved.old_id).toBe('LX-gtests54g');
    expect(saved.source.edition).toBe('3');
    expect(saved.source.doi).toBe('10.12/short');
    expect(saved.source.url).toBeNull();
    expect(saved.context_as_recorded.section).toBe('C');
    expect(saved.context_as_recorded.locator).toBe('C10');
    expect(saved.extraction.card_version).toBe('v9');
    const cautions = saved.extraction.cautions.join('\n');
    expect(cautions).not.toContain('recorded the rights status');
    expect(cautions).not.toContain('review is pending');
    expect(cautions).toContain('holds 2 rows');
    expect(cautions).not.toContain('Rows:');
    expect(cautions).toContain('unnamed row (Note)');
    expect(cautions).not.toContain('records no DOI');

    const abs = projectWith(Buffer.from('{}'), path.join(path.parse(repoRoot).root, 'lantern-outside.json'));
    const left = await run(['--all', abs]);
    expect(left.code).toBe(1);
    expect(left.err).toMatch(/points outside the earlier project folder/);
  });

  it('counts a picture character as one, not as two code units', async () => {
    const statement = 'Do not use 👍.';
    expect(statement.length).toBe(Array.from(statement).length + 1);
    const body = Buffer.from(JSON.stringify({
      cards: [{
        card_id: 'LX-GTESTS54H',
        source: { text_verbatim: statement, item_label: 'Plain' },
        rights: {}
      }]
    }));
    const result = await run(['--all', projectWith(body, 'pkg/cards.json')]);
    expect(result.code, result.err).toBe(0);
    expect(result.out).toBe(`GTESTS54H\t${Array.from(statement).length}\n`);
    const saved = JSON.parse(fs.readFileSync(path.join(outDir, 'GTESTS54H.json'), 'utf8')) as {
      statement: string;
      statement_chars: number;
    };
    expect(saved.statement).toBe(statement);
    expect(saved.statement_chars).toBe(Array.from(statement).length);
    expect(saved.statement_chars).toBe(statement.length - 1);
  });
});
