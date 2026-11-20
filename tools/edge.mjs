// Runs Microsoft Edge without a window, for pictures and PDFs of the page.
// Edge is part of Windows 11. Nothing is installed. Each run uses its own throwaway profile folder
// inside data/tmp, which is removed afterwards.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function findEdge() {
  return [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ].find(p => fs.existsSync(p)) ?? null;
}

/**
 * Options for every headless Edge these tools start: no window, no first-run pages, and no browser
 * extensions, so a picture shows only the page. "--edge-skip-compat-layer-relaunch" keeps Edge in the
 * process that was started, so it can be stopped again.
 */
export const EDGE_OPTIONS = [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-sync', '--edge-skip-compat-layer-relaunch', '--force-device-scale-factor=1'
];

/** A new, empty profile folder for one Edge run. */
export function newProfile(name) {
  const dir = path.join(ROOT, 'data', 'tmp', `${name}-${process.pid}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Removes a folder. Edge lets go of its files a moment after it ends, so this tries a few times. */
export async function removeFolder(dir) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return true;
    } catch {
      await sleep(400);
    }
  }
  return false;
}

/** Waits until a file is there and has stopped growing. Edge returns before its file is written. */
export async function waitForFile(file, timeoutMs = 20000) {
  const until = Date.now() + timeoutMs;
  let size = -1;
  while (Date.now() < until) {
    let now = -1;
    try { now = fs.statSync(file).size; } catch { now = -1; }
    if (now > 0 && now === size) return true;
    size = now;
    await sleep(200);
  }
  return false;
}

/**
 * Runs headless Edge once with the given options and waits for the file it writes.
 * Returns true when the file is there.
 */
export async function edgeWrites(file, options, address) {
  const edge = findEdge();
  if (!edge) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.unlinkSync(file); } catch { /* there was none */ }
  const profile = newProfile('edge');
  const child = spawn(edge, [...EDGE_OPTIONS, `--user-data-dir=${profile}`, ...options, address], { stdio: 'ignore', windowsHide: true });
  await new Promise(resolve => {
    child.once('exit', resolve);
    child.once('error', resolve);
    setTimeout(resolve, 60000).unref();          // never wait for ever
  });
  const ok = await waitForFile(file);
  if (child.exitCode === null) {
    try { child.kill(); } catch { /* already gone */ }
  }
  await removeFolder(profile);
  return ok;
}

/** A picture of one address at a window size. */
export function edgePicture(file, address, width = 1366, height = 768, waitMs = 4000) {
  return edgeWrites(file, [`--window-size=${width},${height}`, `--virtual-time-budget=${waitMs}`, `--screenshot=${file}`], address);
}

/** A PDF of one address, as the print style sheet lays it out, with no header or footer lines. */
export function edgePdf(file, address) {
  return edgeWrites(file, ['--no-pdf-header-footer', '--print-to-pdf-no-header', '--virtual-time-budget=4000', `--print-to-pdf=${file}`], address);
}

/** Width and height of a PNG file, read from its first bytes. */
export function pngSize(file) {
  const head = Buffer.alloc(24);
  const handle = fs.openSync(file, 'r');
  try { fs.readSync(handle, head, 0, 24, 0); } finally { fs.closeSync(handle); }
  if (head.toString('latin1', 1, 4) !== 'PNG') return null;
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}
