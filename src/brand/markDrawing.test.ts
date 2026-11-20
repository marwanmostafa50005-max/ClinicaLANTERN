import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { faviconSvgFile, markInner, markSvgFile } from './markDrawing.ts';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

/** A file of public/, with the line ends of any computer read as one kind. */
const publicFile = (name: string): string => readFileSync(join(publicDir, name), 'utf8').replace(/\r\n/g, '\n');

describe('the ClinicaLANTERN mark', () => {
  it('is the same drawing in the page and in the two files of public/', () => {
    expect(publicFile('mark.svg')).toBe(markSvgFile());
    expect(publicFile('favicon.svg')).toBe(faviconSvgFile());
  });

  // The approved mark: a navy tile, a door standing ajar, a golden L glowing along the door's
  // edge, and data lines with dots fanning out to the right.
  it('draws the tile, the door, the glowing golden L and the data lines', () => {
    const svg = markSvgFile();
    expect(svg).toContain('viewBox="0 0 512 512"');
    expect(svg).toContain('<rect x="16" y="16" width="480" height="480" rx="96"');
    expect(svg).toContain('d="M150 120L264 86V406H150Z"');
    expect(svg.match(/d="M150 124V404H258"/g)?.length).toBe(4);
    expect(svg.match(/<line /g)?.length).toBe(13);
    expect(svg.match(/<circle /g)?.length).toBe(14);
    expect(svg.match(/<feGaussianBlur /g)?.length).toBe(2);
  });

  it('keeps the names of its gradients apart when it is drawn twice on one page', () => {
    const first = markInner('a-');
    const second = markInner('b-');
    expect(first).toContain('id="a-gold"');
    expect(first).toContain('url(#a-gold)');
    expect(first).not.toContain('b-');
    expect(second).toContain('id="b-gold"');
  });
});
