import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from './plan.ts';

const startScript = path.join(process.cwd(), 'tools', 'launch', 'Start-Lantern.ps1');
const installScript = path.join(process.cwd(), 'tools', 'launch', 'Install-Shortcuts.ps1');
const iconFile = path.join(process.cwd(), 'tools', 'launch', 'lantern.ico');

function run(script: string, args: string[]): Promise<{ status: number | null; text: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('pwsh', ['-NoProfile', '-File', script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', chunk => { text += chunk.toString(); });
    child.stderr.on('data', chunk => { text += chunk.toString(); });
    const timer = setTimeout(() => child.kill(), 25000);
    child.on('error', reject);
    child.on('exit', status => {
      clearTimeout(timer);
      resolve({ status, text });
    });
  });
}

function standIn(health: number): Promise<{ port: number; hits: string[]; close: () => Promise<void> }> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url ?? '');
    if (req.url === '/api/version') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"version":"test"}');
      return;
    }
    res.writeHead(health, { 'content-type': 'application/json' });
    res.end('{"ollama":"up"}');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        port: address.port,
        hits,
        close: () => new Promise(done => server.close(() => done()))
      });
    });
  });
}

function writeApp(ollamaPort: number, appPort: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-launch-'));
  fs.writeFileSync(
    path.join(dir, 'lantern.config.json'),
    JSON.stringify({ ollamaBase: `http://127.0.0.1:${ollamaPort}`, port: appPort }),
    'utf8'
  );
  return dir;
}

describe('Start-Lantern.ps1', () => {
  it('says the page has not been built, and does not start a server', async () => {
    const models = await standIn(404);
    const app = writeApp(models.port, 1);
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-data-'));
    try {
      const result = await run(startScript, [
        '-AppDir', app,
        '-DataDir', data,
        '-NoWindow',
        '-NoMessageBox'
      ]);
      const log = fs.readFileSync(path.join(data, 'lantern-launch.log'), 'utf8');
      expect(result.status, result.text + '\n' + log).toBe(2);
      expect(log).toContain(MESSAGES.builtPage);
      expect(log).not.toContain('Starting the application server');
      expect(log).not.toContain('start-ollama.ps1');
      expect(models.hits).toContain('/api/version');
    } finally {
      await models.close();
    }
  }, 25000);

  it('opens nothing new when the application server is already answering', async () => {
    const server = await standIn(200);
    const app = writeApp(server.port, server.port);
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-data-'));
    try {
      const result = await run(startScript, [
        '-AppDir', app,
        '-DataDir', data,
        '-NoWindow',
        '-NoMessageBox'
      ]);
      const log = fs.readFileSync(path.join(data, 'lantern-launch.log'), 'utf8');
      expect(result.status, result.text + '\n' + log).toBe(0);
      expect(log).toContain('The application server is already answering. Opening the window only.');
      expect(log).not.toContain('Starting the application server');
      expect(server.hits).toContain('/api/version');
      expect(server.hits).toContain('/api/health');
    } finally {
      await server.close();
    }
  }, 25000);

  it('uses the trial port instead of the port in the settings', async () => {
    const server = await standIn(200);
    const app = writeApp(server.port, 1);
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-data-'));
    try {
      const result = await run(startScript, [
        '-AppDir', app,
        '-DataDir', data,
        '-Port', String(server.port),
        '-NoWindow',
        '-NoMessageBox'
      ]);
      const log = fs.readFileSync(path.join(data, 'lantern-launch.log'), 'utf8');
      expect(result.status, result.text + '\n' + log).toBe(0);
      expect(log).toContain(`http://127.0.0.1:${server.port}/`);
      expect(log).not.toContain('http://127.0.0.1:1/');
    } finally {
      await server.close();
    }
  }, 25000);
});

describe('Install-Shortcuts.ps1', () => {
  it('writes both shortcuts and removes only those two files', async () => {
    expect(fs.existsSync(iconFile)).toBe(true);
    const desktop = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-desk-'));
    const programs = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-menu-'));
    const data = path.join(os.tmpdir(), 'lantern-shortcut-data');
    const app = process.cwd();
    const made = await run(installScript, [
      '-AppDir', app,
      '-DataDir', data,
      '-Desktop', desktop,
      '-Programs', programs
    ]);
    expect(made.status, made.text).toBe(0);
    const desktopLink = path.join(desktop, 'LANTERN.lnk');
    const startLink = path.join(programs, 'LANTERN.lnk');
    expect(fs.existsSync(desktopLink)).toBe(true);
    expect(fs.existsSync(startLink)).toBe(true);
    const ico = fs.readFileSync(iconFile);
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(7);
    const shown = await new Promise<{ status: number | null; text: string }>((resolve, reject) => {
      const child = spawn('pwsh', ['-NoProfile', '-Command', `
        $s = (New-Object -ComObject WScript.Shell).CreateShortcut('${desktopLink.replace(/'/g, "''")}')
        Write-Output $s.TargetPath
        Write-Output $s.Arguments
        Write-Output $s.Description
        Write-Output $s.IconLocation
      `], { stdio: ['ignore', 'pipe', 'pipe'] });
      let text = '';
      child.stdout.on('data', chunk => { text += chunk.toString(); });
      child.stderr.on('data', chunk => { text += chunk.toString(); });
      child.on('error', reject);
      child.on('exit', status => resolve({ status, text }));
    });
    expect(shown.status, shown.text).toBe(0);
    expect(shown.text).toMatch(/pwsh\.exe/i);
    expect(shown.text).toContain('-NoProfile -WindowStyle Hidden -File');
    expect(shown.text).toContain('Start-Lantern.ps1');
    expect(shown.text).toContain('-AppDir');
    expect(shown.text).toContain('-DataDir');
    expect(shown.text).toContain('ClinicaLANTERN: the LANTERN');
    expect(shown.text.toLowerCase()).toContain('lantern.ico');
    const removed = await run(installScript, ['-Remove', '-Desktop', desktop, '-Programs', programs]);
    expect(removed.status, removed.text).toBe(0);
    expect(fs.existsSync(desktopLink)).toBe(false);
    expect(fs.existsSync(startLink)).toBe(false);
    expect(fs.existsSync(iconFile)).toBe(true);
  }, 25000);
});
