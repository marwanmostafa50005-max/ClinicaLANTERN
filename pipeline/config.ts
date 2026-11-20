// Reads lantern.config.json. Missing values fall back to the defaults below.
import fs from 'node:fs';
import path from 'node:path';
import type { LanternConfig } from '../shared/types.ts';

export const DEFAULT_CONFIG: LanternConfig = {
  ollamaBase: 'http://127.0.0.1:27435',
  port: 8787,
  models: { screen: 'lantern-screen', check: 'lantern-check', letter: 'lantern-letter' },
  think: { screen: false, check: false, letter: false },
  numCtx: 16384,
  keepAlive: '20m',
  maxLinesPerCall: 150,
  overlapLines: 30,
  overdueDays: 7,
  conditionMarkers: false,
  screenBlockSize: 20,
  pharmacy: {
    name: 'Example Community Pharmacy (fictional)',
    address: '1 Example Street, Exampletown',
    phone: '(00) 0000 0000',
    pharmacist: 'Marwan Morsy',
    pharmacistTitle: 'Pharmacy Manager',
    registration: 'PHA0002761764'
  },
  modelNames: { screen: 'Mantle', check: 'Lumen', letter: 'Ogee' },
  modelsBehind: { screen: 'Gemma 4 31B', check: 'Qwen 3.8 27B', letter: 'Gemma 4 26B' },
  emailDraftLimit: 1800,
  doctor: { name: 'Dr F. Example (fictional)', practice: 'Example Family Practice' }
};

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function text(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

function flag(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function whole(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

/** True when the address points at this computer. The models must never be reached over a network. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.replace(/^\[|\]$/g, '');
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

/** Turns whatever was read from the file into a complete, checked config. */
export function normalizeConfig(raw: unknown): LanternConfig {
  const d = DEFAULT_CONFIG;
  const r: Obj = isObj(raw) ? raw : {};
  const models: Obj = isObj(r.models) ? r.models : {};
  const think: Obj = isObj(r.think) ? r.think : {};
  const pharmacy: Obj = isObj(r.pharmacy) ? r.pharmacy : {};
  const modelNames: Obj = isObj(r.modelNames) ? r.modelNames : {};
  const modelsBehind: Obj = isObj(r.modelsBehind) ? r.modelsBehind : {};
  const doctor: Obj = isObj(r.doctor) ? r.doctor : {};

  const ollamaBase = text(r.ollamaBase, d.ollamaBase).replace(/\/+$/, '');
  if (!isLoopbackUrl(ollamaBase)) {
    throw new Error(`lantern.config.json: ollamaBase must point at this computer (127.0.0.1). It is "${ollamaBase}".`);
  }
  const maxLinesPerCall = whole(r.maxLinesPerCall, d.maxLinesPerCall, 10, 2000);
  let overlapLines = whole(r.overlapLines, d.overlapLines, 0, 1000);
  if (overlapLines >= maxLinesPerCall) overlapLines = Math.floor(maxLinesPerCall / 5);

  return {
    ollamaBase,
    port: whole(r.port, d.port, 1, 65535),
    models: {
      screen: text(models.screen, d.models.screen),
      check: text(models.check, d.models.check),
      letter: text(models.letter, d.models.letter)
    },
    think: {
      screen: flag(think.screen, d.think.screen),
      check: flag(think.check, d.think.check),
      letter: flag(think.letter, d.think.letter)
    },
    numCtx: whole(r.numCtx, d.numCtx, 2048, 262144),
    keepAlive: text(r.keepAlive, d.keepAlive),
    maxLinesPerCall,
    overlapLines,
    overdueDays: whole(r.overdueDays, d.overdueDays, 0, 365),
    conditionMarkers: flag(r.conditionMarkers, false),
    screenBlockSize: whole(r.screenBlockSize, d.screenBlockSize ?? 20, 1, 200),
    pharmacy: {
      name: text(pharmacy.name, d.pharmacy.name),
      address: text(pharmacy.address, d.pharmacy.address),
      phone: text(pharmacy.phone, d.pharmacy.phone),
      pharmacist: text(pharmacy.pharmacist, d.pharmacy.pharmacist),
      pharmacistTitle: text(pharmacy.pharmacistTitle, d.pharmacy.pharmacistTitle),
      registration: text(pharmacy.registration, d.pharmacy.registration)
    },
    modelNames: {
      screen: text(modelNames.screen, d.modelNames.screen),
      check: text(modelNames.check, d.modelNames.check),
      letter: text(modelNames.letter, d.modelNames.letter)
    },
    modelsBehind: {
      screen: text(modelsBehind.screen, d.modelsBehind.screen),
      check: text(modelsBehind.check, d.modelsBehind.check),
      letter: text(modelsBehind.letter, d.modelsBehind.letter)
    },
    emailDraftLimit: whole(r.emailDraftLimit, d.emailDraftLimit ?? 1800, 200, 20000),
    doctor: {
      name: text(doctor.name, d.doctor.name),
      practice: text(doctor.practice, d.doctor.practice)
    }
  };
}

export function loadConfig(repoRoot: string): LanternConfig {
  const file = path.join(repoRoot, 'lantern.config.json');
  if (!fs.existsSync(file)) return normalizeConfig({});
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new Error(`lantern.config.json could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }
  return normalizeConfig(raw);
}
