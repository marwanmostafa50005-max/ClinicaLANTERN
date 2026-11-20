import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast.ts';

const tokensPath = join(dirname(fileURLToPath(import.meta.url)), '../styles/tokens.css');

function tokenColours(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of css.split('\n')) {
    const m = line.match(/^\s*(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/);
    if (m) out[m[1]] = m[2].toLowerCase();
  }
  return out;
}

describe('contrast on tokens from tokens.css', () => {
  const css = readFileSync(tokensPath, 'utf8');
  const t = tokenColours(css);

  const textPairs: [string, string, string][] = [
    ['body text on page', '--text', '--page'],
    ['body text on card', '--text', '--card'],
    ['navy on page', '--navy', '--page'],
    ['muted on page', '--muted', '--page'],
    ['muted on card', '--muted', '--card'],
    ['cyan-dark on page', '--cyan-dark', '--page'],
    ['gold-dark on page', '--gold-dark', '--page'],
    ['red on page', '--red', '--page'],
    ['white on navy', '--white', '--navy'],
    ['white on red', '--white', '--red'],
    ['white on the grey count of disputed findings', '--white', '--disputed-grey'],
    ['gold-ink on gold-tint', '--gold-ink', '--gold-tint'],
    ['cyan-ink on cyan-tint', '--cyan-ink', '--cyan-tint'],
    ['red-ink on red-tint', '--red-ink', '--red-tint'],
  ];

  it.each(textPairs)('%s is at least 4.5:1', (_label, fg, bg) => {
    expect(contrastRatio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });

  const edgePairs: [string, string, string][] = [
    ['cyan-dark edge on page', '--cyan-dark', '--page'],
    ['gold-dark edge on page', '--gold-dark', '--page'],
    ['red edge on page', '--red', '--page'],
    ['gold on navy', '--gold', '--navy'],
  ];

  it.each(edgePairs)('%s is at least 3:1', (_label, fg, bg) => {
    expect(contrastRatio(t[fg], t[bg])).toBeGreaterThanOrEqual(3);
  });
});