import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PageImages } from './images.ts';

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-images-'));
  made.push(dir);
  return dir;
}

describe('PageImages', () => {
  it('saves pages in order and keeps only letters and digits in the case name', () => {
    const images = new PageImages(tempDir());
    images.save('A/B 1', ['page-one', 'page-two']);
    const files = images.list('A/B 1');
    expect(files.map(file => path.basename(file))).toEqual(['AB1-p001.b64', 'AB1-p002.b64']);
    expect(images.read(files[0]!)).toBe('page-one');
    expect(images.read(files[1]!)).toBe('page-two');
  });

  it('keeps page order past nine pages', () => {
    const images = new PageImages(tempDir());
    const pages = Array.from({ length: 12 }, (_, index) => `p${index + 1}`);
    images.save('T1', pages);
    const files = images.list('T1');
    expect(files.map(file => path.basename(file))).toEqual([
      'T1-p001.b64', 'T1-p002.b64', 'T1-p003.b64', 'T1-p004.b64',
      'T1-p005.b64', 'T1-p006.b64', 'T1-p007.b64', 'T1-p008.b64',
      'T1-p009.b64', 'T1-p010.b64', 'T1-p011.b64', 'T1-p012.b64'
    ]);
    expect(files.map(file => images.read(file))).toEqual(pages);
  });

  it('lists nothing when the folder is missing, and ignores a file that is not a page', () => {
    const images = new PageImages(path.join(tempDir(), 'missing'));
    expect(images.list('T1')).toEqual([]);

    const dir = tempDir();
    const stored = new PageImages(dir);
    stored.save('T1', ['one']);
    fs.writeFileSync(path.join(dir, 'T1-p002.txt'), 'not a page');
    fs.writeFileSync(path.join(dir, 'note.txt'), 'leave me');
    expect(stored.list('T1').map(file => path.basename(file))).toEqual(['T1-p001.b64']);
  });

  it('lists one case and leaves another', () => {
    const images = new PageImages(tempDir());
    images.save('T1', ['a']);
    images.save('T10', ['b']);
    expect(images.list('T1').map(file => path.basename(file))).toEqual(['T1-p001.b64']);
    expect(images.list('T10').map(file => path.basename(file))).toEqual(['T10-p001.b64']);
  });

  it('removes one case, leaves the other, and does nothing when that case has no pages', () => {
    const images = new PageImages(tempDir());
    images.save('T1', ['a']);
    images.save('T2', ['b']);
    images.remove('T1');
    expect(images.list('T1')).toEqual([]);
    expect(images.read(images.list('T2')[0]!)).toBe('b');
    expect(() => images.remove('T9')).not.toThrow();
  });

  it('clears every page file, leaves a file that is not one, and is safe when the folder is missing', () => {
    const missing = new PageImages(path.join(tempDir(), 'missing'));
    expect(() => missing.clear()).not.toThrow();

    const dir = tempDir();
    const images = new PageImages(dir);
    images.save('T1', ['a']);
    images.save('T2', ['b']);
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'keep');
    images.clear();
    expect(images.list('T1')).toEqual([]);
    expect(images.list('T2')).toEqual([]);
    expect(fs.readFileSync(path.join(dir, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('sorts a four-digit page name before a three-digit one, and ignores a capital extension', () => {
    const dir = tempDir();
    const images = new PageImages(dir);
    fs.writeFileSync(path.join(dir, 'T1-p999.b64'), 'nine');
    fs.writeFileSync(path.join(dir, 'T1-p1000.b64'), 'thousand');
    fs.writeFileSync(path.join(dir, 'T1-p001.B64'), 'capital');
    expect(images.list('T1').map(file => path.basename(file))).toEqual(['T1-p1000.b64', 'T1-p999.b64']);
    expect(images.read(images.list('T1')[0]!)).toBe('thousand');
  });

  it('saves an empty page, and lists a name that only starts like a page', () => {
    const dir = tempDir();
    const images = new PageImages(dir);
    images.save('Café-1', ['']);
    expect(images.list('Café-1').map(file => path.basename(file))).toEqual(['Caf1-p001.b64']);
    expect(images.read(images.list('Café-1')[0]!)).toBe('');

    fs.writeFileSync(path.join(dir, 'Caf1-p001-note.b64'), 'extra');
    expect(images.list('Café-1').map(file => path.basename(file))).toEqual([
      'Caf1-p001-note.b64',
      'Caf1-p001.b64'
    ]);
    expect(images.read(path.join(dir, 'Caf1-p001-note.b64'))).toBe('extra');
  });

  it('a shorter save does not keep an earlier patient\'s pages', () => {
    const images = new PageImages(tempDir());
    images.save('C0001', ['earlier-page-one', 'earlier-page-two']);
    images.save('C0001', ['later-only']);
    const files = images.list('C0001');
    expect(files.map(file => path.basename(file))).toEqual(['C0001-p001.b64']);
    expect(images.read(files[0]!)).toBe('later-only');
  });

  it('a later save replaces every page of that case, and a case id with no letters shares one prefix', () => {
    const dir = path.join(tempDir(), 'nested');
    const images = new PageImages(dir);
    images.save('T1', []);
    expect(fs.existsSync(dir)).toBe(true);
    expect(images.list('T1')).toEqual([]);

    images.save('T1', ['a', 'b']);
    images.save('T1', ['c']);
    const files = images.list('T1');
    expect(files.map(file => path.basename(file))).toEqual(['T1-p001.b64']);
    expect(images.read(files[0]!)).toBe('c');

    images.save('///', ['scan']);
    expect(images.list('///').map(file => path.basename(file))).toEqual(['-p001.b64']);
    expect(images.list('').map(file => path.basename(file))).toEqual(['-p001.b64']);
    expect(images.read(images.list('')[0]!)).toBe('scan');
  });

  it('fails when a page file is already gone, and leaves a folder that is named like a page', () => {
    const dir = tempDir();
    const images = new PageImages(dir);
    images.save('T1', ['a']);
    const file = images.list('T1')[0]!;
    fs.unlinkSync(file);
    expect(() => images.read(file)).toThrow();

    const folder = path.join(dir, 'T1-p001.b64');
    fs.mkdirSync(folder);
    expect(() => images.clear()).not.toThrow();
    expect(fs.statSync(folder).isDirectory()).toBe(true);
    expect(() => images.remove('T1')).not.toThrow();
    expect(fs.statSync(folder).isDirectory()).toBe(true);
  });

  it('keeps the case of the case id, and treats a mark in the id as the same pages', () => {
    const dir = tempDir();
    const images = new PageImages(dir);
    images.save('t1', ['lower\nstill']);
    expect(images.list('T1')).toEqual([]);
    expect(images.list('t1').map(file => path.basename(file))).toEqual(['t1-p001.b64']);
    expect(images.read(images.list('t1')[0]!)).toBe('lower\nstill');

    images.save('A/B 1', ['page']);
    expect(images.list('AB1').map(file => path.basename(file))).toEqual(['AB1-p001.b64']);
    expect(images.read(images.list('A/B 1')[0]!)).toBe('page');
  });
});
