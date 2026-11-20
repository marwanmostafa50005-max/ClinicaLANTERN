// The Edge helpers that do not start a browser. No window, no model, no server.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

interface EdgeModule {
  EDGE_OPTIONS: string[];
  ROOT: string;
  findEdge: () => string | null;
  newProfile: (name: string) => string;
  removeFolder: (dir: string) => Promise<boolean>;
  waitForFile: (file: string, timeoutMs?: number) => Promise<boolean>;
  pngSize: (file: string) => { width: number; height: number } | null;
  sleep: (ms: number) => Promise<void>;
}

const edge = await import(new URL('./edge.mjs', import.meta.url).href) as EdgeModule;

const made: string[] = [];
afterEach(async () => {
  for (const dir of made.splice(0)) await edge.removeFolder(dir);
});

function png(width: number, height: number): Buffer {
  const head = Buffer.alloc(24);
  head.write('PNG', 1, 'latin1');
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return head;
}

describe('pngSize', () => {
  it('reads the width and height from the first bytes of a PNG', () => {
    const file = path.join(os.tmpdir(), `lantern-png-${process.pid}.png`);
    fs.writeFileSync(file, png(1366, 768));
    try {
      expect(edge.pngSize(file)).toEqual({ width: 1366, height: 768 });
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it('gives nothing when the file is not a PNG', () => {
    const file = path.join(os.tmpdir(), `lantern-png-${process.pid}.txt`);
    fs.writeFileSync(file, 'not a picture');
    try {
      expect(edge.pngSize(file)).toBeNull();
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it('reads a picture of no size, and ignores a PNG mark written at the start of the file', () => {
    const file = path.join(os.tmpdir(), `lantern-png-zero-${process.pid}.png`);
    fs.writeFileSync(file, png(0, 0));
    try {
      expect(edge.pngSize(file)).toEqual({ width: 0, height: 0 });
      const wrong = Buffer.alloc(24);
      wrong.write('PNG', 0, 'latin1');
      fs.writeFileSync(file, wrong);
      expect(edge.pngSize(file)).toBeNull();
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(() => edge.pngSize(path.join(os.tmpdir(), `lantern-no-png-${process.pid}.png`))).toThrow();
  });
});

describe('findEdge and the options', () => {
  it('names an Edge that is on this computer, or nothing when it is not', () => {
    const found = edge.findEdge();
    if (found === null) {
      expect(found).toBeNull();
    } else {
      expect(found.endsWith('msedge.exe')).toBe(true);
      expect(fs.existsSync(found)).toBe(true);
    }
  });

  it('starts Edge with no window and keeps it in the process that was started', () => {
    expect(edge.EDGE_OPTIONS).toContain('--headless=new');
    expect(edge.EDGE_OPTIONS).toContain('--edge-skip-compat-layer-relaunch');
    expect(edge.EDGE_OPTIONS).toContain('--disable-extensions');
  });
});

describe('a throwaway profile and a file that has finished writing', () => {
  it('makes a profile folder and removes it', async () => {
    const dir = edge.newProfile('test');
    made.push(dir);
    expect(dir.startsWith(path.join(edge.ROOT, 'data', 'tmp'))).toBe(true);
    expect(fs.existsSync(dir)).toBe(true);
    expect(await edge.removeFolder(dir)).toBe(true);
    expect(fs.existsSync(dir)).toBe(false);
    made.pop();
    expect(await edge.removeFolder(dir)).toBe(true);
  });

  it('waits until a file stops growing, and gives up when there is no file', async () => {
    const file = path.join(os.tmpdir(), `lantern-wait-${process.pid}.bin`);
    fs.writeFileSync(file, 'done');
    try {
      expect(await edge.waitForFile(file, 1500)).toBe(true);
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(await edge.waitForFile(path.join(os.tmpdir(), `lantern-missing-${process.pid}.bin`), 300)).toBe(false);
    await edge.sleep(1);
  });

  it('does not treat an empty file as finished, and names the options that hide the browser', async () => {
    const file = path.join(os.tmpdir(), `lantern-wait-empty-${process.pid}.bin`);
    fs.writeFileSync(file, '');
    try {
      expect(await edge.waitForFile(file, 350)).toBe(false);
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(edge.EDGE_OPTIONS).toEqual(expect.arrayContaining([
      '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      '--disable-sync', '--force-device-scale-factor=1'
    ]));
  });

  it('reads a wide picture, waits for a file that appears late, and puts the profile name in the folder', async () => {
    const wide = path.join(os.tmpdir(), `lantern-png-wide-${process.pid}.png`);
    const bytes = png(70000, 3);
    bytes[0] = 0x89;
    fs.writeFileSync(wide, bytes);
    try {
      expect(edge.pngSize(wide)).toEqual({ width: 70000, height: 3 });
      const lower = Buffer.from(bytes);
      lower.write('png', 1, 'latin1');
      fs.writeFileSync(wide, lower);
      expect(edge.pngSize(wide)).toBeNull();
    } finally {
      fs.rmSync(wide, { force: true });
    }

    const late = path.join(os.tmpdir(), `lantern-wait-late-${process.pid}.bin`);
    try {
      const pending = edge.waitForFile(late, 2000);
      await edge.sleep(50);
      fs.writeFileSync(late, 'late');
      expect(await pending).toBe(true);
    } finally {
      fs.rmSync(late, { force: true });
    }

    const dir = edge.newProfile('batch');
    made.push(dir);
    expect(path.basename(dir)).toMatch(/^batch-\d+-\d+$/);
  });

  it('does not call a file finished while it is still growing', async () => {
    const file = path.join(os.tmpdir(), `lantern-wait-grow-${process.pid}.bin`);
    fs.writeFileSync(file, 'a');
    try {
      let settled = false;
      const pending = edge.waitForFile(file, 2000).then(ok => {
        settled = true;
        return ok;
      });
      await edge.sleep(30);
      expect(settled).toBe(false);
      fs.writeFileSync(file, 'abcdef');
      expect(await pending).toBe(true);
      expect(fs.statSync(file).size).toBe(6);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});
