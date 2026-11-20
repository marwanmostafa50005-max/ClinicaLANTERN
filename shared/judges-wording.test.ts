// What a judge can see must say only what is true (docs/SPEC.md section 10).
// This test reads every file that git would commit and looks for wording that must not be there.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..');
const TEXT_FILE = /\.(?:md|ts|tsx|mjs|js|json|css|html|csv|svg|txt)$/i;

/**
 * The files git would put in a commit: tracked files and new files that .gitignore does not hold back.
 * The call only reads; it changes nothing. Null when git is not on this computer or this copy is not
 * a git repository: nothing can be committed from such a copy, and the two tests below are skipped.
 */
function filesGitWouldCommit(): string[] | null {
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore']
    });
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    return null;
  }
}

// The phrase is put together here from two halves, so that this file does not hold it either.
const BANNED = ['Ollama dis', 'guised'].join('');
const BANNED_SHORT = ['dis', 'guised as'].join('');

describe('what a judge can see', () => {
  const listed = filesGitWouldCommit();
  const files = (listed ?? []).filter(f => TEXT_FILE.test(f));

  it.runIf(listed !== null)('finds the files of the repository', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('docs/SPEC.md');
    expect(files).toContain('src/App.tsx');
  });

  it.runIf(listed !== null)('never holds the internal working phrase in anything a judge sees (the coordinator\'s advice; the founder has not ruled)', () => {
    const hits: string[] = [];
    for (const file of files) {
      const full = path.join(repoRoot, file);
      if (!fs.existsSync(full) || fs.statSync(full).size > 3 * 1024 * 1024) continue;
      const text = fs.readFileSync(full, 'utf8');
      if (text.includes(BANNED) || text.includes(BANNED_SHORT)) hits.push(file);
    }
    expect(hits).toEqual([]);
  }, 300000);

  it('never says that the app hides Ollama: the page says plainly that it runs open models through it', () => {
    const footer = fs.readFileSync(path.join(repoRoot, 'src', 'components', 'Footer.tsx'), 'utf8');
    expect(footer).toContain("ClinicaLANTERN runs open models on the pharmacy's own computer through Ollama, an open-source model runner.");
  });
});
