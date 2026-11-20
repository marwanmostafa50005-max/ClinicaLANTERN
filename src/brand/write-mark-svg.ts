// Writes public/mark.svg and public/favicon.svg from the same drawing the page uses.
// Run it again after changing markDrawing.ts:
//   node src/brand/write-mark-svg.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { markSvgFile, faviconSvgFile } from './markDrawing.ts';

const publicDir = join(import.meta.dirname, '..', '..', 'public');
mkdirSync(publicDir, { recursive: true });
writeFileSync(join(publicDir, 'mark.svg'), markSvgFile(), 'utf8');
writeFileSync(join(publicDir, 'favicon.svg'), faviconSvgFile(), 'utf8');
console.log('Wrote public/mark.svg and public/favicon.svg');
