import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { holdDataDirectory } from './data-lock.ts';

const made: string[] = [];
const children: ReturnType<typeof spawn>[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-lock-'));
  made.push(dir);
  return dir;
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
  }
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('one writer for a data folder', () => {
  it('refuses the folder when another server is still running', () => {
    const dir = tempDir();
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    children.push(child);
    const lock = path.join(dir, 'writer.lock');
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, 'pid'), `${child.pid}\n`);
    expect(() => holdDataDirectory(dir)).toThrow(/already using/);
    expect(fs.readFileSync(path.join(lock, 'pid'), 'utf8').trim()).toBe(String(child.pid));
  });

  it('takes the folder when the other server has stopped', async () => {
    const dir = tempDir();
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
    await new Promise(resolve => child.once('exit', resolve));
    const lock = path.join(dir, 'writer.lock');
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, 'pid'), `${child.pid}\n`);
    holdDataDirectory(dir);
    expect(fs.readFileSync(path.join(lock, 'pid'), 'utf8').trim()).toBe(String(process.pid));
  });
});
