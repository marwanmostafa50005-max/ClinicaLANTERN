// Page images of a scanned history. They are kept in files beside the state, not in the state
// itself, so the state stays small. They are removed once the pharmacist has confirmed the rows.
import fs from 'node:fs';
import path from 'node:path';

export class PageImages {
  dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private prefix(caseId: string): string {
    return caseId.replace(/[^A-Za-z0-9]/g, '') + '-p';
  }

  /** Saves the pages of one case as base64 text files, in page order. An earlier save for that case is removed first, so a shorter scan cannot keep another patient's pages. */
  save(caseId: string, pages: string[]): void {
    fs.mkdirSync(this.dir, { recursive: true });
    this.remove(caseId);
    pages.forEach((page, index) => {
      const name = `${this.prefix(caseId)}${String(index + 1).padStart(3, '0')}.b64`;
      fs.writeFileSync(path.join(this.dir, name), page, 'utf8');
    });
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

  remove(caseId: string): void {
    for (const file of this.pageFiles(caseId)) {
      try { fs.unlinkSync(file); } catch { /* already gone */ }
    }
  }

  clear(): void {
    if (!fs.existsSync(this.dir)) return;
    for (const name of fs.readdirSync(this.dir)) {
      if (name.endsWith('.b64')) {
        try { fs.unlinkSync(path.join(this.dir, name)); } catch { /* already gone */ }
      }
    }
  }
}
