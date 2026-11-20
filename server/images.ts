// Page images of a scanned history. They are kept in files beside the state, not in the state
// itself, so the state stays small. They are removed once the pharmacist has confirmed the rows.
// A manifest written with the pages records the original page numbers and a hash of each page.
// A later read checks that list before it treats the folder as the scan that was imported.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type PageCheck =
  | { ok: true; pages: { page: number; file: string }[] }
  | { ok: false; words: string };

interface StoredPage {
  page: number;
  sha256: string;
}

export class PageImages {
  dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private prefix(caseId: string): string {
    return this.safeId(caseId) + '-p';
  }

  private safeId(caseId: string): string {
    return caseId.replace(/[^A-Za-z0-9]/g, '');
  }

  private manifestPath(caseId: string): string {
    return path.join(this.dir, `${this.safeId(caseId)}-manifest.json`);
  }

  private pageName(caseId: string, page: number): string {
    return `${this.prefix(caseId)}${String(page).padStart(3, '0')}.b64`;
  }

  /** The file for one original page number, or null when that page is not in the folder. */
  fileFor(caseId: string, page: number): string | null {
    if (!Number.isInteger(page) || page < 1) return null;
    const file = path.join(this.dir, this.pageName(caseId, page));
    return fs.existsSync(file) ? file : null;
  }

  private hash(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  private readManifest(caseId: string): StoredPage[] | undefined {
    const file = this.manifestPath(caseId);
    if (!fs.existsSync(file)) return undefined;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { pages?: unknown };
      if (!parsed || !Array.isArray(parsed.pages)) return undefined;
      const pages: StoredPage[] = [];
      for (const item of parsed.pages) {
        if (!item || typeof item !== 'object') return undefined;
        const record = item as { page?: unknown; sha256?: unknown };
        if (typeof record.page !== 'number' || !Number.isInteger(record.page) || record.page < 1) return undefined;
        if (typeof record.sha256 !== 'string' || record.sha256 === '') return undefined;
        pages.push({ page: record.page, sha256: record.sha256 });
      }
      return pages;
    } catch {
      return undefined;
    }
  }

  /**
   * The saved pages against the list written at import.
   * Missing, extra and changed pages are named. A matching set is returned in page order.
   */
  check(caseId: string): PageCheck {
    const stored = this.readManifest(caseId);
    if (!stored) {
      return { ok: false, words: 'The list of pages for this scan is missing. It was not read, and it cannot be confirmed.' };
    }
    const expectedNames = new Set(stored.map(item => this.pageName(caseId, item.page)));
    const extra: number[] = [];
    let unnamed = false;
    for (const file of this.pageFiles(caseId)) {
      const base = path.basename(file);
      if (expectedNames.has(base)) continue;
      const number = pageNumber(base);
      if (number === undefined) unnamed = true;
      else extra.push(number);
    }
    const missing: number[] = [];
    const changed: number[] = [];
    const pages: { page: number; file: string }[] = [];
    for (const item of stored) {
      const file = this.fileFor(caseId, item.page);
      if (!file) {
        missing.push(item.page);
        continue;
      }
      if (this.hash(fs.readFileSync(file, 'utf8')) !== item.sha256) changed.push(item.page);
      else pages.push({ page: item.page, file });
    }
    if (missing.length > 0 || changed.length > 0 || extra.length > 0 || unnamed || pages.length !== stored.length) {
      return { ok: false, words: pageProblem(stored.length, missing, changed, extra, unnamed) };
    }
    return { ok: true, pages };
  }

  /** Saves the pages of one case as base64 text files, in page order. An earlier save for that case is removed first, so a shorter scan cannot keep another patient's pages. */
  save(caseId: string, pages: string[]): void {
    fs.mkdirSync(this.dir, { recursive: true });
    this.remove(caseId);
    const stored: StoredPage[] = [];
    pages.forEach((page, index) => {
      const number = index + 1;
      fs.writeFileSync(path.join(this.dir, this.pageName(caseId, number)), page, 'utf8');
      stored.push({ page: number, sha256: this.hash(page) });
    });
    fs.writeFileSync(this.manifestPath(caseId), JSON.stringify({ pages: stored }) + '\n', 'utf8');
  }

  /** The page files of one case, read straight from the folder. Removal uses this, not list, so a stand-in for list cannot stop a save. */
  private pageFiles(caseId: string): string[] {
    if (!fs.existsSync(this.dir)) return [];
    const prefix = this.prefix(caseId);
    return fs.readdirSync(this.dir)
      .filter(name => name.startsWith(prefix) && name.endsWith('.b64'))
      .sort()
      .map(name => path.join(this.dir, name));
  }

  /** The saved page files of one case, in page order. */
  list(caseId: string): string[] {
    return this.pageFiles(caseId);
  }

  read(file: string): string {
    return fs.readFileSync(file, 'utf8');
  }

  /**
   * Copies one case's pages and its page list into another folder.
   * Each copy is read back and must match the original. A mismatch throws, so the caller can leave the originals in place.
   */
  copyCase(caseId: string, destDir: string): void {
    const files = [...this.pageFiles(caseId)];
    const manifest = this.manifestPath(caseId);
    if (fs.existsSync(manifest)) files.push(manifest);
    if (files.length === 0) return;
    fs.mkdirSync(destDir, { recursive: true });
    for (const file of files) {
      const target = path.join(destDir, path.basename(file));
      fs.copyFileSync(file, target);
      if (!fs.readFileSync(file).equals(fs.readFileSync(target))) {
        throw new Error(`The copy of ${path.basename(file)} does not match the page that was stored.`);
      }
    }
  }

  remove(caseId: string): void {
    for (const file of this.pageFiles(caseId)) {
      try { fs.unlinkSync(file); } catch { /* already gone */ }
    }
    try { fs.unlinkSync(this.manifestPath(caseId)); } catch { /* already gone */ }
  }

  clear(): void {
    if (!fs.existsSync(this.dir)) return;
    for (const name of fs.readdirSync(this.dir)) {
      if (name.endsWith('.b64') || name.endsWith('-manifest.json')) {
        try { fs.unlinkSync(path.join(this.dir, name)); } catch { /* already gone, or a folder */ }
      }
    }
  }
}

function pageNumber(base: string): number | undefined {
  const match = base.match(/-p(\d+)\.b64$/);
  if (!match) return undefined;
  const number = Number(match[1]);
  return Number.isInteger(number) && number >= 1 ? number : undefined;
}

function joinPages(pages: number[], unnamed: boolean): string {
  const real = [...pages].sort((a, b) => a - b);
  const head = real.length === 0 ? '' : real.length === 1 ? `Page ${real[0]}` : `Pages ${real.join(', ')}`;
  if (!unnamed) return head;
  return head ? `${head} and a file that is not a numbered page` : 'A file that is not a numbered page';
}

function pageProblem(expected: number, missing: number[], changed: number[], extra: number[], unnamed: boolean): string {
  const bits: string[] = [];
  if (missing.length > 0) bits.push(`${joinPages(missing, false)} ${missing.length === 1 ? 'is' : 'are'} missing`);
  if (changed.length > 0) bits.push(`${joinPages(changed, false)} ${changed.length === 1 ? 'has' : 'have'} changed`);
  if (extra.length > 0 || unnamed) bits.push(`${joinPages(extra, unnamed)} ${extra.length + (unnamed ? 1 : 0) === 1 ? 'is an extra page' : 'are extra pages'}`);
  const had = expected === 1 ? 'The scan had 1 page.' : `The scan had ${expected} pages.`;
  return `${bits.join('. ')}. ${had} It was not read as a shorter scan, and it cannot be confirmed.`;
}
