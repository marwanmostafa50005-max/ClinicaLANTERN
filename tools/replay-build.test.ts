// tools/replay-build.mjs copies recorded runs into the judges' view. These tests skip the page
// build. No model is called.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(repoRoot, 'tools', 'replay-build.mjs');
const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

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
    child.once('exit', code => resolve({ code, out, err }));
  });
}

function recording(title: string, recorded: boolean): unknown {
  return {
    format: 'clinicalantern-recorded-run-1',
    title,
    about: 'A fictional history. One finding reaches the bell.',
    recordedAt: '2026-11-19T00:00:00.000Z',
    madeHow: 'The models screened the history. The script accepted the finding.',
    criteria: [{ id: 'STOPP-C10' }],
    frames: [{ afterMs: 0, note: '', response: { recorded, serverTime: '2026-11-19T00:00:00.000Z', state: { cases: [], findings: [], letters: [], jobs: [], activity: [] } } }]
  };
}

describe('replay-build', () => {
  it('copies a recorded run and writes the index from its title', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-replay-'));
    made.push(dir);
    const from = path.join(dir, 'from');
    const out = path.join(dir, 'out');
    fs.mkdirSync(from);
    fs.writeFileSync(path.join(from, 'run-01.json'), JSON.stringify(recording('Demo history', true)));
    fs.writeFileSync(path.join(from, 'index.json'), JSON.stringify({ runs: [{ file: 'skip.json', title: 'Not a run' }] }));
    const result = await run(['--no-build', '--from', from, '--out', out]);
    expect(result.code).toBe(0);
    expect(result.out).toContain('Recorded runs copied: 1.');
    const index = JSON.parse(fs.readFileSync(path.join(out, 'recorded', 'index.json'), 'utf8')) as { runs: { file: string; title: string; about: string }[] };
    expect(index.runs).toEqual([{
      file: 'run-01.json',
      title: 'Demo history',
      about: 'A fictional history. One finding reaches the bell.'
    }]);
    expect(fs.existsSync(path.join(out, 'recorded', 'skip.json'))).toBe(false);
    const copied = JSON.parse(fs.readFileSync(path.join(out, 'recorded', 'run-01.json'), 'utf8')) as { title: string };
    expect(copied.title).toBe('Demo history');
  });

  it('refuses a frame that is not marked recorded, and leaves out a made-up sample', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-replay-'));
    made.push(dir);
    const from = path.join(dir, 'from');
    const out = path.join(dir, 'out');
    fs.mkdirSync(from);
    fs.writeFileSync(path.join(from, 'bad.json'), JSON.stringify(recording('A real title', false)));
    const refused = await run(['--no-build', '--from', from, '--out', out]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('not marked as a recorded run');
    expect(fs.existsSync(path.join(out, 'recorded', 'index.json'))).toBe(false);

    fs.rmSync(path.join(from, 'bad.json'));
    const madeUp = recording('Sample walk-through (made up)', true) as { madeHow: string };
    madeUp.madeHow = 'Built from the sample data. Nothing was recorded from a live run.';
    fs.writeFileSync(path.join(from, 'sample.json'), JSON.stringify(madeUp));
    fs.writeFileSync(path.join(from, 'run-01.json'), JSON.stringify(recording('Demo history', true)));
    const kept = await run(['--no-build', '--from', from, '--out', out]);
    expect(kept.code).toBe(0);
    expect(kept.out).toContain('Left out (made up): sample.json');
    const index = JSON.parse(fs.readFileSync(path.join(out, 'recorded', 'index.json'), 'utf8')) as { runs: { file: string }[] };
    expect(index.runs.map(run => run.file)).toEqual(['run-01.json']);
    expect(fs.existsSync(path.join(out, 'recorded', 'sample.json'))).toBe(false);
  });

  it('names a file that cannot be read, a blank title, and a recorded mark that is only the word true', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-replay-'));
    made.push(dir);
    const from = path.join(dir, 'from');
    const out = path.join(dir, 'out');
    fs.mkdirSync(from);
    fs.writeFileSync(path.join(from, 'broken.json'), '{');
    const broken = await run(['--no-build', '--from', from, '--out', out]);
    expect(broken.code).toBe(1);
    expect(broken.err).toContain('broken.json could not be read.');
    expect(fs.existsSync(path.join(out, 'recorded', 'index.json'))).toBe(false);

    fs.rmSync(path.join(from, 'broken.json'));
    fs.writeFileSync(path.join(from, 'blank.json'), JSON.stringify(recording('   ', true)));
    const blank = await run(['--no-build', '--from', from, '--out', out]);
    expect(blank.code).toBe(1);
    expect(blank.err).toContain('blank.json has no title.');

    fs.rmSync(path.join(from, 'blank.json'));
    const word = recording('Demo history', true) as { frames: { response: { recorded: unknown } }[] };
    word.frames[0].response.recorded = 'true';
    fs.writeFileSync(path.join(from, 'word.json'), JSON.stringify(word));
    const refused = await run(['--no-build', '--from', from, '--out', out]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('word.json has a frame that is not marked as a recorded run.');
    expect(fs.existsSync(path.join(out, 'recorded', 'word.json'))).toBe(false);
  });

  it('refuses a recording with no frames, and one whose format is not this build', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-replay-'));
    made.push(dir);
    const from = path.join(dir, 'from');
    const out = path.join(dir, 'out');
    fs.mkdirSync(from);
    const empty = recording('Demo history', true) as { frames: unknown[] };
    empty.frames = [];
    fs.writeFileSync(path.join(from, 'empty.json'), JSON.stringify(empty));
    const noFrames = await run(['--no-build', '--from', from, '--out', out]);
    expect(noFrames.code).toBe(1);
    expect(noFrames.err).toContain('empty.json has no frames.');

    fs.rmSync(path.join(from, 'empty.json'));
    const other = recording('Demo history', true) as { format: string };
    other.format = 'clinicalantern-recorded-run-0';
    fs.writeFileSync(path.join(from, 'old.json'), JSON.stringify(other));
    const wrong = await run(['--no-build', '--from', from, '--out', out]);
    expect(wrong.code).toBe(1);
    expect(wrong.err).toContain('old.json is not a recorded run this build can copy.');
    expect(fs.existsSync(path.join(out, 'recorded', 'index.json'))).toBe(false);
  });

  it('refuses an unknown option, and a folder that was not named', async () => {
    const unknown = await run(['--wat']);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain('Unknown option --wat.');

    const bare = await run(['--from']);
    expect(bare.code).toBe(1);
    expect(bare.err).toContain('Say the folder after --from.');

    const swapped = await run(['--out', '--from']);
    expect(swapped.code).toBe(1);
    expect(swapped.err).toContain('Say the folder after --out.');
  });

  it('trims the title, leaves a blank about when about is not text, and drops an older recording', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-replay-'));
    made.push(dir);
    const from = path.join(dir, 'from');
    const out = path.join(dir, 'out');
    fs.mkdirSync(from);
    const runFile = recording('  Demo history  ', true) as { about: unknown };
    runFile.about = 12;
    fs.writeFileSync(path.join(from, 'run-01.json'), JSON.stringify(runFile));
    fs.mkdirSync(path.join(out, 'recorded'), { recursive: true });
    fs.writeFileSync(path.join(out, 'recorded', 'stale.json'), '{}\n');
    fs.writeFileSync(path.join(out, 'recorded', 'keep.txt'), 'keep\n');
    const result = await run(['--no-build', '--from', from, '--out', out]);
    expect(result.code).toBe(0);
    const index = JSON.parse(fs.readFileSync(path.join(out, 'recorded', 'index.json'), 'utf8')) as {
      runs: { file: string; title: string; about: string }[];
    };
    expect(index.runs).toEqual([{ file: 'run-01.json', title: 'Demo history', about: '' }]);
    expect(fs.existsSync(path.join(out, 'recorded', 'stale.json'))).toBe(false);
    expect(fs.readFileSync(path.join(out, 'recorded', 'keep.txt'), 'utf8')).toBe('keep\n');
  });

  it('refuses a frame that is null, and a frame with no response', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-replay-'));
    made.push(dir);
    const from = path.join(dir, 'from');
    const out = path.join(dir, 'out');
    fs.mkdirSync(from);
    const empty = recording('Demo history', true) as { frames: unknown[] };
    empty.frames = [null];
    fs.writeFileSync(path.join(from, 'null.json'), JSON.stringify(empty));
    const nul = await run(['--no-build', '--from', from, '--out', out]);
    expect(nul.code).toBe(1);
    expect(nul.err).toContain('null.json has a frame that is not marked as a recorded run.');
    expect(fs.existsSync(path.join(out, 'recorded', 'index.json'))).toBe(false);

    fs.rmSync(path.join(from, 'null.json'));
    const bare = recording('Demo history', true) as { frames: { response?: unknown }[] };
    delete bare.frames[0].response;
    fs.writeFileSync(path.join(from, 'bare.json'), JSON.stringify(bare));
    const missing = await run(['--no-build', '--from', from, '--out', out]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('bare.json has a frame that is not marked as a recorded run.');
    expect(fs.existsSync(path.join(out, 'recorded', 'bare.json'))).toBe(false);
  });

  it('refuses a recording whose name would leave the folder', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-replay-'));
    made.push(dir);
    const source = [
      `import { writeRecorded } from ${JSON.stringify(pathToFileURL(script).href)};`,
      'const data = { format: "clinicalantern-recorded-run-1", title: "Demo history", frames: [{ response: { recorded: true } }] };',
      `try { writeRecorded([{ name: "../run-01.json", data }], ${JSON.stringify(dir)}); }`,
      'catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }',
      'process.exit(0);'
    ].join('\n');
    const result = await new Promise<{ code: number | null; err: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
      let err = '';
      child.stderr.on('data', chunk => { err += String(chunk); });
      child.once('error', reject);
      child.once('exit', code => resolve({ code, err }));
    });
    expect(result.code).toBe(1);
    expect(result.err).toContain('../run-01.json is not a recording file name this build can copy.');
    expect(fs.existsSync(path.join(dir, 'run-01.json'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'recorded', 'run-01.json'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'recorded', 'index.json'))).toBe(false);
  });

  it('refuses a name that is not a json recording, and a name that contains two dots', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-replay-'));
    made.push(dir);
    const source = [
      `import { writeRecorded } from ${JSON.stringify(pathToFileURL(script).href)};`,
      'const data = { format: "clinicalantern-recorded-run-1", title: "Demo history", frames: [{ response: { recorded: true } }] };',
      'for (const name of ["notes.txt", "run..01.json"]) {',
      '  let threw = "";',
      `  try { writeRecorded([{ name, data }], ${JSON.stringify(dir)}); }`,
      '  catch (e) { threw = e instanceof Error ? e.message : String(e); }',
      '  const wanted = name + " is not a recording file name this build can copy.";',
      '  if (!threw.includes(wanted)) { console.error(threw || ("no throw for " + name)); process.exit(1); }',
      '}',
      'process.exit(0);'
    ].join('\n');
    const result = await new Promise<{ code: number | null; err: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
      let err = '';
      child.stderr.on('data', chunk => { err += String(chunk); });
      child.once('error', reject);
      child.once('exit', code => resolve({ code, err }));
    });
    expect(result.code, result.err).toBe(0);
    expect(fs.existsSync(path.join(dir, 'notes.txt'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'recorded', 'notes.txt'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'recorded', 'run..01.json'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'recorded', 'index.json'))).toBe(false);
  });

  it('refuses a title that is not text, frames that are not a list, and a folder named like a recording', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-replay-'));
    made.push(dir);
    const from = path.join(dir, 'from');
    const out = path.join(dir, 'out');
    fs.mkdirSync(from);
    const numbered = recording('Demo history', true) as { title: unknown };
    numbered.title = 4;
    fs.writeFileSync(path.join(from, 'number.json'), JSON.stringify(numbered));
    const title = await run(['--no-build', '--from', from, '--out', out]);
    expect(title.code).toBe(1);
    expect(title.err).toContain('number.json has no title.');
    expect(fs.existsSync(path.join(out, 'recorded', 'index.json'))).toBe(false);

    fs.rmSync(path.join(from, 'number.json'));
    const bag = recording('Demo history', true) as { frames: unknown };
    bag.frames = { length: 1 };
    fs.writeFileSync(path.join(from, 'bag.json'), JSON.stringify(bag));
    const frames = await run(['--no-build', '--from', from, '--out', out]);
    expect(frames.code).toBe(1);
    expect(frames.err).toContain('bag.json has no frames.');

    fs.rmSync(path.join(from, 'bag.json'));
    fs.mkdirSync(path.join(from, 'folder.json'));
    const folder = await run(['--no-build', '--from', from, '--out', out]);
    expect(folder.code).toBe(1);
    expect(folder.err).toContain('folder.json could not be read.');
    expect(fs.existsSync(path.join(out, 'recorded', 'folder.json'))).toBe(false);
  });

  it('writes an empty index when the folder of recordings is missing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-replay-'));
    made.push(dir);
    const out = path.join(dir, 'out');
    const missing = path.join(dir, 'none');
    const result = await run(['--no-build', '--from', missing, '--out', out]);
    expect(result.code).toBe(0);
    expect(result.out).toContain('No recordings in');
    const index = JSON.parse(fs.readFileSync(path.join(out, 'recorded', 'index.json'), 'utf8')) as { runs: unknown[] };
    expect(index.runs).toEqual([]);
  });
});
