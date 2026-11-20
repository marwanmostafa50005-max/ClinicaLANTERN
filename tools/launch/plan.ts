// Pure parts of the desktop launcher: the port, the addresses, the server
// environment and the shortcut command line. Start-Lantern.ps1 and
// Install-Shortcuts.ps1 call this file so the tests and the scripts share one reading.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../pipeline/config.ts';

/** The sentence the shortcut shows under its name. */
export const SHORTCUT_DESCRIPTION = 'ClinicaLANTERN: the LANTERN';

/** How this build starts the model server when it is not already answering. */
export const MODEL_SERVER_SCRIPT = 'C:\\Users\\AdamG\\ClinicaLANTERN-Lantern-runtime\\start-ollama.ps1';

/** Plain sentences for a person. The scripts show these and do not invent others. */
export const MESSAGES = {
  builtPage:
    'The page has not been built yet, so ClinicaLANTERN cannot open. In the application folder, run npm run build, then click LANTERN again.',
  models:
    'The local models are not running on this computer, so ClinicaLANTERN cannot open. Start them, then click LANTERN again.',
  node: 'Node.js was not found on this computer, so ClinicaLANTERN cannot open.',
  server:
    'The application server did not answer in time, so the page was not opened. The log in the data folder has the details.',
  settings: 'The settings file could not be read, so ClinicaLANTERN cannot open.'
} as const;

export interface LaunchFacts {
  port: number;
  ollamaBase: string;
  versionUrl: string;
  healthUrl: string;
  pageUrl: string;
  edgeArgument: string;
  edgeArguments: string[];
  driverPort: number | null;
  driverPortRefused?: string;
  builtPage: string;
  modelStartScript: string;
}

export interface ServerLaunch {
  /** Arguments for node, relative to the application folder. */
  args: string[];
  /** Environment entries the launcher sets. Absent keys are removed, so a warm-up cannot leak in. */
  env: Record<string, string>;
}

function wholePort(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`The port must be a whole number from 1 to 65535. It is "${value}".`);
  }
  return value;
}

const DRIVER_PORT_MIN = 1024;
const DRIVER_PORT_MAX = 65535;

function refuseDriverPort(held: string): string {
  return `The driver-port.txt file held "${held}", which is not a valid port from ${DRIVER_PORT_MIN} to ${DRIVER_PORT_MAX}, so the window was opened as usual.`;
}

/** Reads driver-port.txt when a data folder is given. A bad or missing file does not throw. */
export function readDriverPort(
  dataDir: string | undefined
): { driverPort: number | null; driverPortRefused?: string } {
  if (!dataDir) return { driverPort: null };
  const filePath = path.join(dataDir, 'driver-port.txt');
  if (!fs.existsSync(filePath)) return { driverPort: null };
  const firstLine = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)[0] ?? '';
  const held = firstLine.trim();
  if (held === '') {
    return {
      driverPort: null,
      driverPortRefused: 'The driver-port.txt file was empty, so the window was opened as usual.'
    };
  }
  if (!/^\d+$/.test(held)) {
    return { driverPort: null, driverPortRefused: refuseDriverPort(held) };
  }
  const n = Number(held);
  if (n < DRIVER_PORT_MIN || n > DRIVER_PORT_MAX) {
    return { driverPort: null, driverPortRefused: refuseDriverPort(held) };
  }
  return { driverPort: n };
}

/** Edge command-line arguments for the app window; seven when a test driver port is active. */
export function buildEdgeArguments(
  pageUrl: string,
  dataDir: string | undefined,
  driverPort: number | null
): string[] {
  const appArg = `--app=${pageUrl}`;
  if (driverPort === null) return [appArg];
  const profileDir = path.join(dataDir!, 'window-profile');
  return [
    appArg,
    `--remote-debugging-port=${driverPort}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1366,900',
    '--window-position=40,20'
  ];
}

/** Reads the port and the model-server address from lantern.config.json. An override is for a trial only. */
export function launchFacts(appDir: string, portOverride?: number, dataDir?: string): LaunchFacts {
  const cfg = loadConfig(appDir);
  const port = wholePort(portOverride ?? cfg.port);
  const pageUrl = `http://127.0.0.1:${port}/`;
  const edgeArgument = `--app=${pageUrl}`;
  const { driverPort, driverPortRefused } = readDriverPort(dataDir);
  const edgeArguments = buildEdgeArguments(pageUrl, dataDir, driverPort);
  return {
    port,
    ollamaBase: cfg.ollamaBase,
    versionUrl: `${cfg.ollamaBase}/api/version`,
    healthUrl: `http://127.0.0.1:${port}/api/health`,
    pageUrl,
    edgeArgument,
    edgeArguments,
    driverPort,
    ...(driverPortRefused === undefined ? {} : { driverPortRefused }),
    builtPage: path.join(appDir, 'dist', 'index.html'),
    modelStartScript: MODEL_SERVER_SCRIPT
  };
}

/**
 * What `node` is given when the application server is not already answering.
 * LANTERN_NO_WARMUP is set only for a trial that must not load a model.
 * On a trading day the key is absent, so the server may warm Mantle.
 */
export function serverLaunch(port: number, dataDir: string, noWarmup: boolean): ServerLaunch {
  const env: Record<string, string> = {
    PORT: String(wholePort(port)),
    LANTERN_DATA_DIR: dataDir
  };
  if (noWarmup) env.LANTERN_NO_WARMUP = '1';
  return { args: ['server/index.ts'], env };
}

/** Quotes one argument for the shortcut command line. A quote or a line break is rejected. */
export function quoteCmd(value: string): string {
  if (value.includes('"') || value.includes('\r') || value.includes('\n')) {
    throw new Error('A path for the shortcut cannot contain a quote or a line break.');
  }
  if (/[\s\t]/.test(value)) return `"${value}"`;
  return value;
}

/** The arguments of pwsh.exe. The shortcut target is pwsh.exe itself. */
export function shortcutArguments(scriptPath: string, appDir: string, dataDir: string): string {
  return [
    '-NoProfile',
    '-WindowStyle',
    'Hidden',
    '-File',
    quoteCmd(scriptPath),
    '-AppDir',
    quoteCmd(appDir),
    '-DataDir',
    quoteCmd(dataDir)
  ].join(' ');
}

function take(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0 || i + 1 >= process.argv.length) return undefined;
  return process.argv[i + 1];
}

function fail(text: string): never {
  process.stderr.write(text + '\n');
  process.exit(1);
}

function main(): void {
  const cmd = process.argv[2];
  try {
    if (cmd === 'facts') {
      const app = take('--app');
      if (!app) fail('facts needs --app');
      const portText = take('--port');
      const port = portText === undefined ? undefined : wholePort(Number(portText));
      const data = take('--data');
      process.stdout.write(JSON.stringify(launchFacts(app, port, data)) + '\n');
      return;
    }
    if (cmd === 'server-env') {
      const portText = take('--port');
      const data = take('--data');
      if (!portText || !data) fail('server-env needs --port and --data');
      const launch = serverLaunch(Number(portText), data, process.argv.includes('--no-warmup'));
      process.stdout.write(JSON.stringify(launch) + '\n');
      return;
    }
    if (cmd === 'shortcut') {
      const script = take('--script');
      const app = take('--app');
      const data = take('--data');
      if (!script || !app || !data) fail('shortcut needs --script, --app and --data');
      process.stdout.write(shortcutArguments(script, app, data) + '\n');
      return;
    }
    if (cmd === 'message') {
      const key = process.argv[3];
      if (key !== 'builtPage' && key !== 'models' && key !== 'node' && key !== 'server' && key !== 'settings') {
        fail('message needs builtPage, models, node, server or settings');
      }
      process.stdout.write(MESSAGES[key] + '\n');
      return;
    }
    fail('Use facts, server-env, shortcut or message.');
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) main();
