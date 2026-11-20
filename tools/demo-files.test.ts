// tools/demo-files.mjs prints the demo history and can draw it with Edge.
// These tests name the printed rows and the page HTML. They do not start Edge, and no model is called.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface Printed {
  rows: string[][];
  patient: { ref: string; age: string; sex: string };
}

interface DemoFiles {
  printedRows: () => Promise<Printed>;
  scanPageHtml: (rows: (string | number)[][], patient: Printed['patient'], pageNumber: number, pageCount: number) => string;
  tableHtml: (rows: (string | number)[][], patient: Printed['patient'], kind: string) => string;
}

const repoRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(repoRoot, 'tools', 'demo-files.mjs');
const demo = await import(new URL('./demo-files.mjs', import.meta.url).href) as DemoFiles;
const outputs = ['positive.pdf', 'positive-scan.png', 'positive-scan.pdf'].map(name => path.join(repoRoot, 'cases', '_demo', name));

const patient = { ref: 'F-001', age: '72', sex: 'Female' };
const oddCell = ['06/01/2026', 'A < B & C>', '10 mg', 'tablet', '1', '0', 'Take <one>', 'Dr A & B'];

function mtimes(): number[] {
  return outputs.map(file => fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0);
}

function run(args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let out = '';
    const timer = setTimeout(() => child.kill(), 8000);
    child.stdout.on('data', chunk => { out += String(chunk); });
    child.once('error', reject);
    child.once('exit', code => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

describe('demo-files', () => {
  it('prints the demo history with the day first, and a brand alone when the medicine cell is empty', async () => {
    const printed = await demo.printedRows();
    expect(printed.patient).toEqual(patient);
    expect(printed.rows).toHaveLength(45);
    expect(printed.rows[0]).toEqual([
      '06/01/2026',
      'Diabex XR (metformin)',
      '1000 mg',
      'modified release tablet',
      '60',
      '4',
      'Take ONE tablet twice a day with food',
      'Dr F. Example'
    ]);
    expect(printed.rows.filter(row => row[1] === 'Xarelto').map(row => row[0])[0]).toBe('08/01/2026');
    expect(printed.rows.filter(row => row[1] === 'Xarelto')).toHaveLength(10);
    expect(printed.rows.filter(row => row[1] === 'Celebrex').map(row => row[0])).toEqual(['21/08/2026', '20/09/2026']);
  });

  it('builds a text page and a picture page, and escapes a cell', () => {
    const text = demo.tableHtml([oddCell], patient, 'pdf');
    expect(text).toContain('@page { size: A4 landscape;');
    expect(text).toContain('Fictional patient F-001');
    expect(text).toContain('Age 72');
    expect(text).toContain('Female');
    expect(text).toContain('Fictional patient. No real person.');
    expect(text).toContain('A &lt; B &amp; C&gt;');
    expect(text).toContain('Take &lt;one&gt;');
    expect(text).toContain('Dr A &amp; B');
    expect(text).not.toContain('Page 1 of');

    const picture = demo.tableHtml([oddCell], patient, 'scan');
    expect(picture).toContain('width: 1754px');
    expect(picture).toContain('height: 1240px');

    const page = demo.scanPageHtml([oddCell], patient, 2, 3);
    expect(page).toContain('Page 2 of 3');
    expect(page).toContain('width: 1754px');
    expect(page).toContain('A &lt; B &amp; C&gt;');
  });

  it('escapes a patient reference and leaves a quotation mark as itself', () => {
    const quoted = ['06/01/2026', 'Say "hello"', '10 mg', 'tablet', '1', '0', 'Take one', 'Dr'];
    const html = demo.tableHtml([quoted], { ref: 'F<1', age: '72', sex: 'F' }, 'pdf');
    expect(html).toContain('Fictional patient F&lt;1');
    expect(html).toContain('Say "hello"');
    expect(html).not.toContain('&quot;');
    const picture = demo.scanPageHtml([quoted], { ref: 'F<1', age: '72', sex: 'F' }, 1, 1);
    expect(picture).toContain('Page 1 of 1');
    expect(picture).toContain('Fictional patient F&lt;1');
  });

  it('names the way to call it when no command is given, and writes nothing', async () => {
    const before = mtimes();
    const result = await run([]);
    expect(result.code).toBe(2);
    expect(result.out).toContain('node tools/demo-files.mjs make | check-pdf | check-scan | check-scan-pdf');
    expect(result.out).not.toContain('Written:');
    expect(mtimes()).toEqual(before);
  });

  it('does not start Edge when the file is imported', async () => {
    const before = mtimes();
    const child = spawn(process.execPath, ['--input-type=module', '-e', "import './tools/demo-files.mjs'"], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let out = '';
    child.stdout.on('data', chunk => { out += String(chunk); });
    const timer = setTimeout(() => child.kill(), 8000);
    const code = await new Promise<number | null>(resolve => child.once('exit', resolve));
    clearTimeout(timer);
    expect(code).toBe(0);
    expect(out).not.toContain('Written:');
    expect(out).not.toContain('node tools/demo-files.mjs');
    expect(mtimes()).toEqual(before);
  });

  it('refuses an unknown command and writes nothing', async () => {
    const before = mtimes();
    const result = await run(['nope']);
    expect(result.code).toBe(2);
    expect(result.out).toContain('node tools/demo-files.mjs make | check-pdf | check-scan | check-scan-pdf');
    expect(result.out).not.toContain('Written:');
    expect(mtimes()).toEqual(before);
  });

  it('checks the text PDF against the printed rows and does not rewrite it', async () => {
    const before = mtimes();
    const result = await run(['check-pdf']);
    expect(result.code).toBe(0);
    expect(result.out).toContain('Supply rows: 45 read, 45 printed, 45 exactly the same');
    expect(result.out).toContain('PASS: one row for each printed row.');
    expect(mtimes()).toEqual(before);
  });

  it('checks the scanned PDF is two pictures with no text, and does not rewrite it', async () => {
    const before = mtimes();
    const result = await run(['check-scan-pdf']);
    expect(result.code).toBe(0);
    expect(result.out).toContain('0 letters of text, a picture.');
    expect(result.out).toContain('PASS: every page is a picture with no text.');
    expect(mtimes()).toEqual(before);
  });

  it('names a picture page for an empty table, and a make that names nothing it knows', async () => {
    const html = demo.tableHtml([], { ref: 'F&1', age: '', sex: 'Male' }, 'png');
    expect(html).toContain('width: 1754px');
    expect(html).not.toContain('@page');
    expect(html).toContain('Fictional patient F&amp;1');
    expect(html).toContain('Age .');
    expect(html).toContain('Male.');
    expect(html).not.toContain('<td>');

    const numbered = demo.tableHtml([['06/01/2026', 'A&B', 10]], patient, 'pdf');
    expect(numbered).toContain('@page { size: A4 landscape;');
    expect(numbered).toContain('A&amp;B');
    expect(numbered).toContain('<td>10</td>');

    const page = demo.scanPageHtml([], patient, 1, 2);
    expect(page).toContain('Page 1 of 2');
    expect(page).not.toContain('<td>');

    const before = mtimes();
    const made = await run(['make', 'nope']);
    expect(made.code, made.out).toBe(0);
    expect(made.out).toContain('45 supply rows are printed in each file.');
    expect(made.out).not.toContain('Written:');
    expect(made.out).not.toContain('NOT written');
    expect(mtimes()).toEqual(before);

    const upper = await run(['CHECK-PDF']);
    expect(upper.code).toBe(2);
    expect(upper.out).toContain('node tools/demo-files.mjs make | check-pdf | check-scan | check-scan-pdf');
    expect(mtimes()).toEqual(before);
  });

  it('uses the picture layout unless the kind is exactly pdf, and escapes the age and the sex', () => {
    const marked = { ref: 'F-001', age: '7<2', sex: 'M&F' };
    const picture = demo.tableHtml([oddCell], marked, 'PDF');
    expect(picture).toContain('width: 1754px');
    expect(picture).not.toContain('@page');
    expect(picture).toContain('Age 7&lt;2');
    expect(picture).toContain('M&amp;F.');

    const emptyKind = demo.tableHtml([], marked, '');
    expect(emptyKind).toContain('width: 1754px');
    expect(emptyKind).not.toContain('@page');
    expect(emptyKind).not.toContain('<td>');

    const scan = demo.scanPageHtml([['01/01/2026', 'A\nB']], marked, 1, 1);
    expect(scan).toContain('Page 1 of 1');
    expect(scan).toContain('Age 7&lt;2');
    expect(scan).toContain('M&amp;F.');
    expect(scan).toContain('<td>A\nB</td>');
    for (const heading of ['Date', 'Medicine', 'Strength', 'Form', 'Qty', 'Repeats', 'Directions', 'Prescriber']) {
      expect(picture).toContain(`<th>${heading}</th>`);
      expect(scan).toContain(`<th>${heading}</th>`);
    }
  });
});
