// The ClinicaLANTERN mark, redrawn as vector shapes.
// One drawing, two uses: the React component (Mark.tsx) and the files in public/
// (written by write-mark-svg.ts). Nothing here comes from the page's data.
//
// What it shows: a navy rounded square, a door standing ajar, a golden L glowing along the
// door's edge, and data lines with dots fanning out to the right like circuit traces.

/** Data lines: y, x from, x to, thickness, opacity. Drawn in a 512 x 512 box. */
const LINES: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [150, 372, 394, 3, 0.55],
  [172, 300, 430, 3.5, 0.9],
  [194, 268, 352, 3, 0.75],
  [194, 366, 384, 3, 0.6],
  [216, 236, 392, 3.5, 0.9],
  [236, 212, 356, 3, 0.7],
  [256, 176, 444, 4, 1],
  [276, 208, 330, 3, 0.7],
  [294, 232, 430, 3.5, 0.9],
  [312, 256, 330, 3, 0.65],
  [330, 296, 314, 3, 0.6],
  [330, 404, 446, 3, 0.8],
  [356, 384, 400, 3, 0.55],
];

/** Filled dots on the lines: x, y, radius, opacity. */
const DOTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [336, 172, 7.5, 1],
  [426, 172, 6, 1],
  [292, 194, 5.5, 0.9],
  [300, 216, 4.5, 0.85],
  [386, 216, 6.5, 1],
  [276, 236, 4, 0.8],
  [338, 236, 4.5, 0.85],
  [344, 256, 7.5, 1],
  [420, 256, 6, 1],
  [380, 294, 7.5, 1],
  [428, 294, 4.5, 0.9],
  [442, 330, 6, 1],
];

/** Open rings near the bottom of the fan: x, y, radius. */
const RINGS: ReadonlyArray<readonly [number, number, number]> = [
  [324, 330, 7.5],
  [372, 356, 7.5],
];

const L_PATH = 'M150 124V404H258';

/**
 * The inside of the <svg> element. `p` is a prefix that keeps gradient names unique when the
 * mark is drawn more than once on a page.
 */
export function markInner(p: string): string {
  const lines = LINES.map(
    ([y, x1, x2, w, o]) =>
      `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke-width="${w}" opacity="${o}"/>`,
  ).join('');
  const dots = DOTS.map(
    ([x, y, r, o]) => `<circle cx="${x}" cy="${y}" r="${r}" opacity="${o}"/>`,
  ).join('');
  const rings = RINGS.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('');

  return [
    '<defs>',
    `<linearGradient id="${p}bg" x1="0" y1="0" x2="1" y2="1">`,
    '<stop offset="0" stop-color="#0d2f70"/><stop offset=".5" stop-color="#071d49"/><stop offset="1" stop-color="#04112c"/>',
    '</linearGradient>',
    `<linearGradient id="${p}door" x1="0" y1="0" x2="1" y2="0">`,
    '<stop offset="0" stop-color="#0b2760"/><stop offset="1" stop-color="#041230"/>',
    '</linearGradient>',
    `<linearGradient id="${p}beam" gradientUnits="userSpaceOnUse" x1="158" y1="256" x2="472" y2="256">`,
    '<stop offset="0" stop-color="#edbf67" stop-opacity=".8"/><stop offset=".28" stop-color="#edbf67" stop-opacity=".3"/>',
    '<stop offset=".6" stop-color="#27c2d0" stop-opacity=".13"/><stop offset="1" stop-color="#27c2d0" stop-opacity="0"/>',
    '</linearGradient>',
    `<linearGradient id="${p}line" gradientUnits="userSpaceOnUse" x1="176" y1="0" x2="450" y2="0">`,
    '<stop offset="0" stop-color="#f3cf86"/><stop offset=".3" stop-color="#8fdcc9"/><stop offset=".5" stop-color="#27c2d0"/><stop offset="1" stop-color="#3fd2df"/>',
    '</linearGradient>',
    `<linearGradient id="${p}gold" x1="0" y1="0" x2="0" y2="1">`,
    '<stop offset="0" stop-color="#fff1cc"/><stop offset=".45" stop-color="#edbf67"/><stop offset="1" stop-color="#f7d58d"/>',
    '</linearGradient>',
    `<radialGradient id="${p}floor" cx=".5" cy=".5" r=".5">`,
    '<stop offset="0" stop-color="#edbf67" stop-opacity=".45"/><stop offset="1" stop-color="#edbf67" stop-opacity="0"/>',
    '</radialGradient>',
    `<clipPath id="${p}clip"><rect x="16" y="16" width="480" height="480" rx="96"/></clipPath>`,
    `<filter id="${p}halo" x="60" y="40" width="300" height="450" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="15"/></filter>`,
    `<filter id="${p}glow" x="100" y="80" width="220" height="370" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="5.5"/></filter>`,
    '</defs>',
    // the navy square
    `<rect x="16" y="16" width="480" height="480" rx="96" fill="url(#${p}bg)"/>`,
    `<g clip-path="url(#${p}clip)">`,
    // the door standing ajar
    `<path d="M150 120L264 86V406H150Z" fill="url(#${p}door)"/>`,
    '<path d="M150 120L264 86" fill="none" stroke="#2a4f9c" stroke-width="2" opacity=".7"/>',
    // light from the L
    `<path d="M158 256L472 108V404Z" fill="url(#${p}beam)"/>`,
    `<ellipse cx="204" cy="410" rx="92" ry="9" fill="url(#${p}floor)"/>`,
    // data lines, dots and rings
    `<g fill="none" stroke="url(#${p}line)" stroke-linecap="round">${lines}</g>`,
    `<g fill="url(#${p}line)">${dots}</g>`,
    `<g fill="none" stroke="#f3cf86" stroke-width="2.5" opacity=".9">${rings}</g>`,
    // the golden L: soft glow first, then the bright line
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">`,
    `<path d="${L_PATH}" stroke="#edbf67" stroke-opacity=".5" stroke-width="30" filter="url(#${p}halo)"/>`,
    `<path d="${L_PATH}" stroke="#f2c873" stroke-opacity=".85" stroke-width="15" filter="url(#${p}glow)"/>`,
    `<path d="${L_PATH}" stroke="url(#${p}gold)" stroke-width="12"/>`,
    `<path d="${L_PATH}" stroke="#fff8e3" stroke-opacity=".92" stroke-width="4"/>`,
    '</g>',
    '</g>',
  ].join('');
}

/** A complete SVG file of the mark. */
export function markSvgFile(): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-labelledby="t">' +
    '<title id="t">ClinicaLANTERN</title>' +
    markInner('m-') +
    '</svg>\n'
  );
}

/** A simpler drawing that stays clear at 16 to 32 pixels (the browser tab). */
export function faviconSvgFile(): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<rect x="2" y="2" width="60" height="60" rx="13" fill="#071d49"/>' +
    '<path d="M21 32L58 15V49Z" fill="#edbf67" opacity=".22"/>' +
    '<g stroke="#27c2d0" stroke-width="3" stroke-linecap="round">' +
    '<path d="M35 23H50"/><path d="M27 32H54"/><path d="M35 41H48"/>' +
    '</g>' +
    '<g fill="#27c2d0"><circle cx="50" cy="23" r="3.2"/><circle cx="54" cy="32" r="3.2"/><circle cx="48" cy="41" r="3.2"/></g>' +
    '<path d="M19 14V50H33" fill="none" stroke="#edbf67" stroke-opacity=".35" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M19 14V50H33" fill="none" stroke="#f6d58c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>\n'
  );
}
