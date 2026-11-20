// One writer for a data folder. A second server, even on another port, is refused.
// The lock is a folder named writer.lock. It holds the process id and is removed when this
// process exits. A lock left by a process that has already stopped can be taken again.
import fs from 'node:fs';
import path from 'node:path';

const LOCK_NAME = 'writer.lock';
/** A new lock with no process id yet belongs to a server that is still starting. */
const YOUNG_MS = 1000;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readPid(lockDir: string): number | null {
  try {
    const n = Number(fs.readFileSync(path.join(lockDir, 'pid'), 'utf8').trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function ageMs(lockDir: string): number {
  try {
    return Date.now() - fs.statSync(lockDir).mtimeMs;
  } catch {
    return 0;
  }
}

function tryCreate(lockDir: string): boolean {
  try {
    fs.mkdirSync(lockDir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw e;
  }
  try {
    fs.writeFileSync(path.join(lockDir, 'pid'), `${process.pid}\n`);
  } catch {
    // The folder is ours. A later start takes it once this process has stopped and the id is gone.
  }
  return true;
}

function claim(lockDir: string): boolean {
  if (tryCreate(lockDir)) return true;
  const pid = readPid(lockDir);
  if (pid === process.pid) return true;
  if (pid !== null && alive(pid)) return false;
  if (pid === null && ageMs(lockDir) < YOUNG_MS) return false;
  try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch { /* the other process may be removing it */ }
  return tryCreate(lockDir);
}

/** Holds dataDir until this process ends. Throws when another living server already holds it. */
export function holdDataDirectory(dataDir: string): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const lockDir = path.join(dataDir, LOCK_NAME);
  if (!claim(lockDir)) {
    throw new Error(`Another server is already using ${dataDir}. Stop that server before starting another, even on another port.`);
  }
  process.on('exit', () => {
    try {
      if (readPid(lockDir) === process.pid) fs.rmSync(lockDir, { recursive: true, force: true });
    } catch { /* already gone */ }
  });
}
