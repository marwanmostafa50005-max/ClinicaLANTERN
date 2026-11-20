import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MESSAGES,
  MODEL_SERVER_SCRIPT,
  SHORTCUT_DESCRIPTION,
  launchFacts,
  quoteCmd,
  serverLaunch,
  shortcutArguments
} from './plan.ts';

function appWith(config: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-plan-'));
  fs.writeFileSync(path.join(dir, 'lantern.config.json'), JSON.stringify(config), 'utf8');
  return dir;
}

function dataWith(driverPortLine: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-plan-data-'));
  if (driverPortLine !== null) {
    fs.writeFileSync(path.join(dir, 'driver-port.txt'), driverPortLine, 'utf8');
  }
  return dir;
}

describe('launch plan', () => {
  it('reads the port and the model address from the settings', () => {
    const dir = appWith({ ollamaBase: 'http://127.0.0.1:27435', port: 8788 });
    const facts = launchFacts(dir);
    expect(facts.port).toBe(8788);
    expect(facts.versionUrl).toBe('http://127.0.0.1:27435/api/version');
    expect(facts.healthUrl).toBe('http://127.0.0.1:8788/api/health');
    expect(facts.pageUrl).toBe('http://127.0.0.1:8788/');
    expect(facts.edgeArgument).toBe('--app=http://127.0.0.1:8788/');
    expect(facts.edgeArguments).toEqual(['--app=http://127.0.0.1:8788/']);
    expect(facts.driverPort).toBeNull();
    expect(facts.driverPortRefused).toBeUndefined();
    expect(facts.builtPage).toBe(path.join(dir, 'dist', 'index.html'));
    expect(facts.modelStartScript).toBe(MODEL_SERVER_SCRIPT);
  });

  it('keeps one edge argument when no data folder or driver-port.txt is absent', () => {
    const appDir = appWith({ ollamaBase: 'http://127.0.0.1:27435', port: 8788 });
    const dataDir = dataWith(null);
    try {
      const noData = launchFacts(appDir);
      expect(noData.edgeArguments).toEqual(['--app=http://127.0.0.1:8788/']);
      expect(noData.driverPort).toBeNull();
      expect(noData.edgeArgument).toBe('--app=http://127.0.0.1:8788/');

      const noFile = launchFacts(appDir, undefined, dataDir);
      expect(noFile.edgeArguments).toEqual(['--app=http://127.0.0.1:8788/']);
      expect(noFile.driverPort).toBeNull();
      expect(noFile.edgeArgument).toBe('--app=http://127.0.0.1:8788/');
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.rmSync(appDir, { recursive: true, force: true });
    }
  });

  it('opens Edge for a test driver when driver-port.txt holds a valid port', () => {
    const appDir = appWith({ ollamaBase: 'http://127.0.0.1:27435', port: 8788 });
    const dataDir = dataWith('9333');
    try {
      const facts = launchFacts(appDir, undefined, dataDir);
      expect(facts.driverPort).toBe(9333);
      expect(facts.edgeArgument).toBe('--app=http://127.0.0.1:8788/');
      expect(facts.edgeArguments).toEqual([
        '--app=http://127.0.0.1:8788/',
        '--remote-debugging-port=9333',
        `--user-data-dir=${path.join(dataDir, 'window-profile')}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1366,900',
        '--window-position=40,20'
      ]);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.rmSync(appDir, { recursive: true, force: true });
    }
  });

  it('refuses driver-port.txt that is empty, not a number, or outside 1024–65535', () => {
    const appDir = appWith({ ollamaBase: 'http://127.0.0.1:27435', port: 8788 });
    const cases = ['', 'abc', '80', '70000'] as const;
    for (const line of cases) {
      const dataDir = dataWith(line);
      try {
        const facts = launchFacts(appDir, undefined, dataDir);
        expect(facts.driverPort).toBeNull();
        expect(facts.edgeArguments).toEqual(['--app=http://127.0.0.1:8788/']);
        expect(facts.driverPortRefused).toMatch(/driver-port\.txt/);
        expect(facts.driverPortRefused!.length).toBeGreaterThan(10);
      } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    }
    fs.rmSync(appDir, { recursive: true, force: true });
  });

  it('uses 8787 when the settings name no port, and a trial port when one is given', () => {
    const dir = appWith({ ollamaBase: 'http://127.0.0.1:27435' });
    expect(launchFacts(dir).port).toBe(8787);
    expect(launchFacts(dir, 8791).healthUrl).toBe('http://127.0.0.1:8791/api/health');
  });

  it('refuses a model address that is not on this computer', () => {
    const dir = appWith({ ollamaBase: 'http://example.com', port: 8787 });
    expect(() => launchFacts(dir)).toThrow(/127\.0\.0\.1/);
  });

  it('sets the warm-up off only when the trial asks for it', () => {
    const quiet = serverLaunch(8788, 'D:\\lantern-data', true);
    expect(quiet.args).toEqual(['server/index.ts']);
    expect(quiet.env).toEqual({
      PORT: '8788',
      LANTERN_DATA_DIR: 'D:\\lantern-data',
      LANTERN_NO_WARMUP: '1'
    });
    const trading = serverLaunch(8787, 'D:\\lantern-data', false);
    expect(trading.env.PORT).toBe('8787');
    expect(trading.env.LANTERN_NO_WARMUP).toBeUndefined();
  });

  it('builds the shortcut command line', () => {
    const line = shortcutArguments(
      'C:\\app\\tools\\launch\\Start-Lantern.ps1',
      'C:\\app',
      'C:\\app\\data'
    );
    expect(line).toBe(
      '-NoProfile -WindowStyle Hidden -File C:\\app\\tools\\launch\\Start-Lantern.ps1 -AppDir C:\\app -DataDir C:\\app\\data'
    );
    expect(shortcutArguments('C:\\My App\\Start-Lantern.ps1', 'C:\\My App', 'C:\\My Data')).toContain('"C:\\My App\\Start-Lantern.ps1"');
    expect(quoteCmd('C:\\My App')).toBe('"C:\\My App"');
    expect(() => quoteCmd('a"b')).toThrow(/quote/);
    expect(SHORTCUT_DESCRIPTION).toBe('ClinicaLANTERN: the LANTERN');
  });

  it('keeps the sentences a person sees', () => {
    expect(MESSAGES.builtPage).toMatch(/has not been built yet/);
    expect(MESSAGES.models).toMatch(/local models are not running/);
    expect(MESSAGES.node).toMatch(/Node\.js was not found/);
    expect(MESSAGES.server).toBe('The application server did not answer in time, so the page was not opened. The log in the data folder has the details.');
    expect(MESSAGES.settings).toBe('The settings file could not be read, so ClinicaLANTERN cannot open.');
  });

  it('refuses a port that is not a whole number, and a shortcut path with a line break', () => {
    expect(() => serverLaunch(0, 'D:\\lantern-data', false)).toThrow(/whole number from 1 to 65535/);
    expect(() => serverLaunch(65536, 'D:\\lantern-data', false)).toThrow(/65536/);
    expect(() => serverLaunch(1.5, 'D:\\lantern-data', true)).toThrow(/1\.5/);
    expect(quoteCmd('C:\\lantern')).toBe('C:\\lantern');
    expect(() => quoteCmd('C:\\lantern\n')).toThrow(/line break/);
  });

  it('runs the command line the shortcut scripts call', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-plan-cli-'));
    const run = (args: string[]) => spawnSync(process.execPath, [path.join('tools', 'launch', 'plan.ts'), ...args], {
      encoding: 'utf8', cwd: path.resolve('.')
    });
    try {
      const facts = run(['facts', '--app', dir]);
      expect(facts.status).toBe(0);
      expect(JSON.parse(facts.stdout).port).toBe(8787);
      expect(JSON.parse(facts.stdout).healthUrl).toBe('http://127.0.0.1:8787/api/health');

      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-plan-cli-data-'));
      fs.writeFileSync(path.join(dataDir, 'driver-port.txt'), '9333', 'utf8');
      const factsData = run(['facts', '--app', dir, '--data', dataDir]);
      expect(factsData.status).toBe(0);
      const parsed = JSON.parse(factsData.stdout) as {
        edgeArguments: string[];
        driverPort: number | null;
        edgeArgument: string;
      };
      expect(parsed.edgeArguments).toHaveLength(7);
      expect(parsed.driverPort).toBe(9333);
      expect(parsed.edgeArgument).toBe('--app=http://127.0.0.1:8787/');
      fs.rmSync(dataDir, { recursive: true, force: true });

      const noApp = run(['facts']);
      expect(noApp.status).toBe(1);
      expect(noApp.stderr).toMatch(/facts needs --app/);

      const settings = run(['message', 'settings']);
      expect(settings.status).toBe(0);
      expect(settings.stdout.trim()).toBe(MESSAGES.settings);

      const unknown = run(['message', 'nope']);
      expect(unknown.status).toBe(1);
      expect(unknown.stderr).toMatch(/message needs/);

      const env = run(['server-env', '--port', '8788', '--data', 'D:\\lantern-data', '--no-warmup']);
      expect(env.status).toBe(0);
      expect(JSON.parse(env.stdout).env).toEqual({
        PORT: '8788',
        LANTERN_DATA_DIR: 'D:\\lantern-data',
        LANTERN_NO_WARMUP: '1'
      });

      const badPort = run(['server-env', '--port', 'nope', '--data', 'D:\\lantern-data']);
      expect(badPort.status).toBe(1);
      expect(badPort.stderr).toMatch(/whole number/);

      const cut = run(['shortcut', '--script', 'C:\\app\\Start-Lantern.ps1', '--app', 'C:\\app']);
      expect(cut.status).toBe(1);
      expect(cut.stderr).toMatch(/shortcut needs/);

      const open = run(['open']);
      expect(open.status).toBe(1);
      expect(open.stderr).toMatch(/Use facts, server-env, shortcut or message/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names a trial port, a trading day with the warm-up left on, and every sentence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-plan-cli-'));
    const run = (args: string[]) => spawnSync(process.execPath, [path.join('tools', 'launch', 'plan.ts'), ...args], {
      encoding: 'utf8', cwd: path.resolve('.')
    });
    try {
      const facts = run(['facts', '--app', dir, '--port', '8791']);
      expect(facts.status).toBe(0);
      expect(JSON.parse(facts.stdout).port).toBe(8791);
      expect(JSON.parse(facts.stdout).healthUrl).toBe('http://127.0.0.1:8791/api/health');

      const omitted = run(['facts', '--app', dir, '--port']);
      expect(omitted.status).toBe(0);
      expect(JSON.parse(omitted.stdout).port).toBe(8787);

      const zero = run(['facts', '--app', dir, '--port', '0']);
      expect(zero.status).toBe(1);
      expect(zero.stderr).toMatch(/whole number/);

      const trading = run(['server-env', '--port', '8787', '--data', 'D:\\lantern-data']);
      expect(trading.status).toBe(0);
      const env = JSON.parse(trading.stdout).env as Record<string, string>;
      expect(env.PORT).toBe('8787');
      expect(env.LANTERN_DATA_DIR).toBe('D:\\lantern-data');
      expect(env.LANTERN_NO_WARMUP).toBeUndefined();

      const noData = run(['server-env', '--port', '8788']);
      expect(noData.status).toBe(1);
      expect(noData.stderr).toMatch(/server-env needs --port and --data/);

      const shortcut = run([
        'shortcut', '--script', 'C:\\app\\Start-Lantern.ps1', '--app', 'C:\\app', '--data', 'C:\\app\\data'
      ]);
      expect(shortcut.status).toBe(0);
      expect(shortcut.stdout.trim()).toBe(shortcutArguments(
        'C:\\app\\Start-Lantern.ps1', 'C:\\app', 'C:\\app\\data'
      ));

      for (const key of ['builtPage', 'models', 'node', 'server'] as const) {
        const msg = run(['message', key]);
        expect(msg.status).toBe(0);
        expect(msg.stdout.trim()).toBe(MESSAGES[key]);
      }

      expect(serverLaunch(1, 'D:\\lantern-data', false).env.PORT).toBe('1');
      expect(serverLaunch(65535, 'D:\\lantern-data', false).env.PORT).toBe('65535');
      expect(() => quoteCmd('a\rb')).toThrow(/line break/);
      expect(quoteCmd('a\tb')).toBe('"a\tb"');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
