import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const componentsDir = join(dirname(fileURLToPath(import.meta.url)));

function componentSources(): string[] {
  return readdirSync(componentsDir)
    .filter((name) => name.endsWith('.tsx') && !name.endsWith('.test.tsx'))
    .map((name) => join(componentsDir, name));
}

// The founder's ruling 2: a letter leaves only through its preview. Print, the email program, Copy
// and "Mark as sent" are called from the preview page and from no other part of the page. This
// reads the source, so a later change that puts one of them back beside the editor is caught.
describe('the ways a letter leaves', () => {
  const waysOut = ['markLetterSent(', 'window.print', 'mailtoHref(', 'openEmail(', 'copyText(', 'navigator.clipboard', "execCommand('copy')"];
  const pageSources = [...componentSources(), join(componentsDir, '..', 'App.tsx')];

  it('are called from the preview page', () => {
    const preview = readFileSync(join(componentsDir, 'LetterPreview.tsx'), 'utf8');
    for (const call of ['api.markLetterSent(', 'window.print()', 'mailtoHref(', 'copyText(']) {
      expect(preview, `LetterPreview.tsx should call ${call}`).toContain(call);
    }
  });

  for (const path of pageSources) {
    const name = path.split(/[/\\]/).pop()!;
    if (name === 'LetterPreview.tsx') continue;
    it(`${name} holds none of them`, () => {
      const src = readFileSync(path, 'utf8');
      for (const call of waysOut) expect(src, `${name} holds ${call}`).not.toContain(call);
    });
  }

  it('the letter panel opens the preview, and holds none of the four buttons of the preview', () => {
    const panel = readFileSync(join(componentsDir, 'LetterPanel.tsx'), 'utf8');
    expect(panel).toContain('<LetterPreview');
    expect(panel).toContain('data-opens="preview"');
    // The icons of Print, the email program and Copy, the words of the email button, and the mark of "Mark as sent".
    for (const part of ['PrintIcon', 'MailIcon', 'CopyIcon', 'Open in my email program', 'data-opens="sent"']) {
      expect(panel, `LetterPanel.tsx holds ${part}`).not.toContain(part);
    }
  });
});

describe('labels and controls in components', () => {
  for (const path of componentSources()) {
    const name = path.split(/[/\\]/).pop()!;
    const src = readFileSync(path, 'utf8');

    it(`${name} has no tabIndex above zero`, () => {
      expect(src).not.toMatch(/\btabIndex=\{[1-9]\d*\}/);
      expect(src).not.toMatch(/\btabIndex="[1-9]\d*"/);
    });

    it(`${name} ties every field to a label`, () => {
      const fields = [...src.matchAll(/<(?:input|textarea|select)\b[^>]*\bid=\{([^}]+)\}/g)];
      for (const m of fields) {
        const idExpr = m[1].trim();
        const hasFor =
          src.includes(`htmlFor={${idExpr}}`) ||
          src.includes(`htmlFor={ ${idExpr}`) ||
          new RegExp(`htmlFor=\\{${idExpr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`).test(src);
        expect(hasFor, `${name}: field id ${idExpr} has no matching htmlFor`).toBe(true);
      }
    });

    it(`${name} gives every button words or aria-label`, () => {
      const buttons = src.split('<button');
      for (let i = 1; i < buttons.length; i++) {
        const chunk = buttons[i]!;
        const open = chunk.slice(0, chunk.indexOf('>') + 1);
        const close = chunk.indexOf('</button>');
        const inner = close === -1 ? '' : chunk.slice(chunk.indexOf('>') + 1, close);
        const hasAria = /aria-label=/.test(open);
        const hasText = inner.replace(/<[^>]+>/g, '').trim().length > 0;
        expect(hasAria || hasText, `${name}: button without words or aria-label`).toBe(true);
      }
    });
  }
});