import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesDir = join(dirname(fileURLToPath(import.meta.url)));

function styleFiles(): string[] {
  return readdirSync(stylesDir)
    .filter((name) => name.endsWith('.css') && name !== 'tokens.css')
    .map((name) => join(stylesDir, name));
}

/** Strip @media (prefers-reduced-motion: reduce) blocks so motion rules are not counted twice. */
function withoutReducedMotionBlock(css: string): string {
  return css.replace(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{[\s\S]*?\n\}/g, '');
}

describe('no gold or cyan as ordinary text colour', () => {
  const allowed: { file: string; selector: string }[] = [
    // The golden L of the name: it is the logo, drawn large, with its own glow.
    { file: 'hero.css', selector: '.wm-l' },
    // The focus ring inside a navy pop-up message: gold on navy is 9.6 to 1; a navy ring would not show.
    { file: 'base.css', selector: '.popup :focus-visible' },
    // Founder (19 November): model names on the navy model bar, not body text.
    { file: 'models.css', selector: '.model-bar-name--mantle' },
    { file: 'models.css', selector: '.model-bar-name--ogee' },
  ];

  it('uses var(--gold) or var(--cyan) for color only where allowed', () => {
    for (const path of styleFiles()) {
      const name = path.split(/[/\\]/).pop()!;
      const css = readFileSync(path, 'utf8');
      const blocks = css.split(/\}(?=\s*[\.\[#@a-z])/);
      for (const block of blocks) {
        const head = block.match(/([^{]+)\{/);
        if (!head) continue;
        const selectors = head[1].trim();
        if (!/color\s*:\s*var\(--(gold|cyan)\)/.test(block)) continue;
        const ok = allowed.some((a) => name === a.file && selectors.includes(a.selector));
        expect(ok, `${name} ${selectors} sets color to gold or cyan`).toBe(true);
      }
    }
  });
});

describe('no raw colour literals outside tokens.css', () => {
  it('finds no #hex or rgb( in other style sheets', () => {
    for (const path of styleFiles()) {
      const css = readFileSync(path, 'utf8');
      expect(css, path).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css, path).not.toMatch(/rgba?\s*\(/);
    }
  });
});

describe('Segoe UI Variable font tokens', () => {
  const tokens = readFileSync(join(stylesDir, 'tokens.css'), 'utf8');
  const hero = readFileSync(join(stylesDir, 'hero.css'), 'utf8');

  it('sets running, display and small stacks', () => {
    expect(tokens).toMatch(
      /--font:\s*"Segoe UI Variable Text",\s*"Segoe UI Variable",\s*var\(--font-stack\)/,
    );
    expect(tokens).toMatch(
      /--font-display:\s*"Segoe UI Variable Display",\s*"Segoe UI Variable",\s*var\(--font-stack\)/,
    );
    expect(tokens).toMatch(
      /--font-small:\s*"Segoe UI Variable Small",\s*"Segoe UI Variable",\s*var\(--font-stack\)/,
    );
  });

  it('keeps the approved stack on --font-brand for the hero wordmark', () => {
    expect(tokens).toMatch(
      /--font-brand:\s*var\(--font-stack\)/,
    );
    expect(tokens).toMatch(
      /--font-stack:\s*"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif/,
    );
    expect(hero).toMatch(/\.wordmark\s*\{[\s\S]*font-family:\s*var\(--font-brand\)/);
    expect(hero).toMatch(/\.purpose\s*\{[\s\S]*font-family:\s*var\(--font-brand\)/);
    expect(hero).toMatch(/\.slogan\s*\{[\s\S]*font-family:\s*var\(--font-brand\)/);
  });
});

describe('reduced motion covers every animation and transition', () => {
  it('has a global off switch while the page still uses motion elsewhere', () => {
    const base = readFileSync(join(stylesDir, 'base.css'), 'utf8');
    expect(base).toMatch(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/);
    expect(base).toMatch(/\*\s*,\s*\*::before,\s*\*::after/);
    expect(base).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(base).toMatch(/transition-duration:\s*0\.01ms\s*!important/);

    let motionRules = 0;
    for (const path of styleFiles()) {
      const css = withoutReducedMotionBlock(readFileSync(path, 'utf8'));
      const noKeyframes = css.replace(/@keyframes\s+[\w-]+\s*\{[\s\S]*?\n\}/g, '');
      const hits = noKeyframes.match(/(?:^|[;{\s])(?:animation|transition)\s*:/gm);
      if (hits) motionRules += hits.length;
    }
    expect(motionRules).toBeGreaterThan(0);
  });
});