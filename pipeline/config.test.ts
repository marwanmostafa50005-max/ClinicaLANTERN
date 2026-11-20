import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, isLoopbackUrl, loadConfig, normalizeConfig } from './config.ts';

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-config-'));
  made.push(dir);
  return dir;
}

describe('isLoopbackUrl', () => {
  it('accepts this computer and refuses everywhere else', () => {
    expect(isLoopbackUrl('http://127.0.0.1:27435')).toBe(true);
    expect(isLoopbackUrl('https://localhost/api')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:27435')).toBe(true);
    expect(isLoopbackUrl('http://192.168.1.2:27435')).toBe(false);
    expect(isLoopbackUrl('ftp://127.0.0.1/models')).toBe(false);
    expect(isLoopbackUrl('not a url')).toBe(false);
  });
});

describe('normalizeConfig', () => {
  it('keeps condition markers off unless the switch is explicitly true or false', () => {
    expect(normalizeConfig({}).conditionMarkers).toBe(false);
    expect(normalizeConfig({ conditionMarkers: true }).conditionMarkers).toBe(true);
    expect(normalizeConfig({ conditionMarkers: false }).conditionMarkers).toBe(false);
    expect(normalizeConfig({ conditionMarkers: 'true' }).conditionMarkers).toBe(false);
  });

  it('fills every value from the defaults when the file is empty or not an object', () => {
    expect(normalizeConfig({})).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig([])).toEqual(DEFAULT_CONFIG);
  });

  it('strips a trailing slash and refuses an address that is not this computer', () => {
    expect(normalizeConfig({ ollamaBase: 'http://127.0.0.1:27435/' }).ollamaBase).toBe('http://127.0.0.1:27435');
    expect(() => normalizeConfig({ ollamaBase: 'http://example.com:27435' })).toThrow(/this computer/);
  });

  it('keeps a whole number inside its range and falls back otherwise', () => {
    const cfg = normalizeConfig({ port: 8788, overdueDays: 0, numCtx: 100, maxLinesPerCall: 1.5, screenBlockSize: 0 });
    expect(cfg.port).toBe(8788);
    expect(cfg.overdueDays).toBe(0);
    expect(cfg.numCtx).toBe(DEFAULT_CONFIG.numCtx);
    expect(cfg.maxLinesPerCall).toBe(DEFAULT_CONFIG.maxLinesPerCall);
    expect(cfg.screenBlockSize).toBe(DEFAULT_CONFIG.screenBlockSize);
  });

  it('shrinks the overlap when it is not shorter than a call', () => {
    expect(normalizeConfig({ maxLinesPerCall: 10, overlapLines: 10 }).overlapLines).toBe(2);
    expect(normalizeConfig({ maxLinesPerCall: 10, overlapLines: 9 }).overlapLines).toBe(9);
  });

  it('strips every trailing slash, keeps a range edge, and fills a blank model name', () => {
    expect(isLoopbackUrl('http://LOCALHOST:27435')).toBe(true);
    expect(isLoopbackUrl('http://0.0.0.0:27435')).toBe(false);

    const cfg = normalizeConfig({
      ollamaBase: 'http://127.0.0.1:27435///',
      port: 65535,
      keepAlive: '   ',
      maxLinesPerCall: 11,
      overlapLines: 11,
      emailDraftLimit: 20000,
      screenBlockSize: 200,
      models: { screen: '   ', check: 'lantern-check-b' },
      think: { check: false },
      modelsBehind: { letter: '   ' },
      doctor: { name: '  Dr A. Sample (fictional)  ', practice: '  ' },
      pharmacy: { pharmacistTitle: 'Owner' }
    });
    expect(cfg.ollamaBase).toBe('http://127.0.0.1:27435');
    expect(cfg.port).toBe(65535);
    expect(cfg.keepAlive).toBe(DEFAULT_CONFIG.keepAlive);
    expect(cfg.maxLinesPerCall).toBe(11);
    expect(cfg.overlapLines).toBe(2);
    expect(cfg.emailDraftLimit).toBe(20000);
    expect(cfg.screenBlockSize).toBe(200);
    expect(cfg.models.screen).toBe(DEFAULT_CONFIG.models.screen);
    expect(cfg.models.check).toBe('lantern-check-b');
    expect(cfg.think.check).toBe(false);
    expect(cfg.modelsBehind.letter).toBe(DEFAULT_CONFIG.modelsBehind.letter);
    expect(cfg.doctor.name).toBe('Dr A. Sample (fictional)');
    expect(cfg.doctor.practice).toBe(DEFAULT_CONFIG.doctor.practice);
    expect(cfg.pharmacy.pharmacistTitle).toBe('Owner');
    expect(cfg.pharmacy.name).toBe(DEFAULT_CONFIG.pharmacy.name);
    expect(normalizeConfig({ port: 0, emailDraftLimit: 199 }).port).toBe(DEFAULT_CONFIG.port);
    expect(normalizeConfig({ emailDraftLimit: 199 }).emailDraftLimit).toBe(DEFAULT_CONFIG.emailDraftLimit);
  });

  it('trims the model address, and falls back when a number is written as text', () => {
    const cfg = normalizeConfig({
      ollamaBase: '  http://127.0.0.1:27435/  ',
      port: '8788',
      overdueDays: 366,
      numCtx: 2048,
      overlapLines: 0,
      think: { screen: true, check: true },
      models: { letter: '   ' },
      modelNames: { screen: '   ', check: 'Glow' },
      modelsBehind: { screen: '   ' },
      pharmacy: { phone: '   ', address: '  2 Example Street  ' }
    });
    expect(cfg.ollamaBase).toBe('http://127.0.0.1:27435');
    expect(cfg.port).toBe(DEFAULT_CONFIG.port);
    expect(cfg.overdueDays).toBe(DEFAULT_CONFIG.overdueDays);
    expect(cfg.numCtx).toBe(2048);
    expect(cfg.overlapLines).toBe(0);
    expect(cfg.think).toEqual({ screen: true, check: true, letter: false });
    expect(cfg.models.letter).toBe(DEFAULT_CONFIG.models.letter);
    expect(cfg.modelNames.screen).toBe(DEFAULT_CONFIG.modelNames.screen);
    expect(cfg.modelNames.check).toBe('Glow');
    expect(cfg.modelsBehind.screen).toBe(DEFAULT_CONFIG.modelsBehind.screen);
    expect(cfg.pharmacy.phone).toBe(DEFAULT_CONFIG.pharmacy.phone);
    expect(cfg.pharmacy.address).toBe('2 Example Street');
    expect(normalizeConfig({ ollamaBase: '   ' }).ollamaBase).toBe(DEFAULT_CONFIG.ollamaBase);
    expect(normalizeConfig({ numCtx: 262144, overdueDays: 365 }).numCtx).toBe(262144);
    expect(normalizeConfig({ numCtx: 262144, overdueDays: 365 }).overdueDays).toBe(365);
    expect(normalizeConfig({ numCtx: 262145 }).numCtx).toBe(DEFAULT_CONFIG.numCtx);
    expect(normalizeConfig({ numCtx: 2047 }).numCtx).toBe(DEFAULT_CONFIG.numCtx);

    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'lantern.config.json'), 'null');
    expect(loadConfig(dir)).toEqual(DEFAULT_CONFIG);
    fs.writeFileSync(path.join(dir, 'lantern.config.json'), '   ');
    expect(() => loadConfig(dir)).toThrow(/could not be read/);
  });

  it('falls back when a name is blank and when a think flag is not true or false', () => {
    const cfg = normalizeConfig({
      pharmacy: { pharmacist: '   ' },
      modelNames: { letter: 'Quill' },
      think: { screen: 'yes', letter: true }
    });
    expect(cfg.pharmacy.pharmacist).toBe(DEFAULT_CONFIG.pharmacy.pharmacist);
    expect(cfg.modelNames.letter).toBe('Quill');
    expect(cfg.modelNames.screen).toBe(DEFAULT_CONFIG.modelNames.screen);
    expect(cfg.think.screen).toBe(DEFAULT_CONFIG.think.screen);
    expect(cfg.think.letter).toBe(true);
  });

  it('uses the defaults when a group is not a group, and keeps a range edge', () => {
    const cfg = normalizeConfig({
      models: [],
      think: 'yes',
      pharmacy: ['Example'],
      modelNames: null,
      modelsBehind: 3,
      doctor: []
    });
    expect(cfg.models).toEqual(DEFAULT_CONFIG.models);
    expect(cfg.think).toEqual(DEFAULT_CONFIG.think);
    expect(cfg.pharmacy).toEqual(DEFAULT_CONFIG.pharmacy);
    expect(cfg.modelNames).toEqual(DEFAULT_CONFIG.modelNames);
    expect(cfg.modelsBehind).toEqual(DEFAULT_CONFIG.modelsBehind);
    expect(cfg.doctor).toEqual(DEFAULT_CONFIG.doctor);

    const named = normalizeConfig({
      pharmacy: { registration: '   ' },
      modelsBehind: { check: 'Other 1B' },
      maxLinesPerCall: 2000,
      overlapLines: 1000,
      screenBlockSize: 1,
      emailDraftLimit: 200
    });
    expect(named.pharmacy.registration).toBe(DEFAULT_CONFIG.pharmacy.registration);
    expect(named.pharmacy.pharmacist).toBe(DEFAULT_CONFIG.pharmacy.pharmacist);
    expect(named.modelsBehind.check).toBe('Other 1B');
    expect(named.maxLinesPerCall).toBe(2000);
    expect(named.overlapLines).toBe(1000);
    expect(named.screenBlockSize).toBe(1);
    expect(named.emailDraftLimit).toBe(200);

    const shrunk = normalizeConfig({ maxLinesPerCall: 9, overlapLines: 1000 });
    expect(shrunk.maxLinesPerCall).toBe(DEFAULT_CONFIG.maxLinesPerCall);
    expect(shrunk.overlapLines).toBe(30);
    expect(normalizeConfig({ maxLinesPerCall: 2001 }).maxLinesPerCall).toBe(DEFAULT_CONFIG.maxLinesPerCall);
  });
});

describe('loadConfig', () => {
  it('uses the defaults when the file is missing', () => {
    expect(loadConfig(tempDir())).toEqual(DEFAULT_CONFIG);
  });

  it('reads the file, including a byte-order mark, and names a file that is not JSON', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'lantern.config.json'), `\uFEFF${JSON.stringify({ port: 8788 })}`);
    expect(loadConfig(dir).port).toBe(8788);
    expect(loadConfig(dir).pharmacy.pharmacist).toBe(DEFAULT_CONFIG.pharmacy.pharmacist);

    fs.writeFileSync(path.join(dir, 'lantern.config.json'), '{');
    expect(() => loadConfig(dir)).toThrow(/could not be read/);
  });
});
