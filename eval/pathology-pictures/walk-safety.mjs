import fs from 'node:fs';
import path from 'node:path';
import { removeFolder } from '../../tools/edge.mjs';

export function makeOwnedDataDir(requested, temporaryRoot) {
  if (requested) {
    const dir = path.resolve(requested);
    if (fs.existsSync(dir)) throw new Error(`The walk data directory already exists; choose a new empty path: ${dir}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  fs.mkdirSync(temporaryRoot, { recursive: true });
  return fs.mkdtempSync(path.join(temporaryRoot, 'k-path-3-'));
}

export async function removeOwnedDataDir(dir) {
  const removed = await removeFolder(dir);
  return removed && !fs.existsSync(dir);
}

export function standInHealth(cfg) {
  return {
    ollama: 'up', version: 'stand-in-no-model',
    models: { screen: true, check: true, letter: true },
    names: { ...cfg.models }, displayNames: { ...cfg.modelNames }, modelsBehind: { ...cfg.modelsBehind }
  };
}
