import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';

const here = path.dirname(fileURLToPath(import.meta.url));
const width = 1240;
const height = 1754;

function page() {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#152b33';
  ctx.textBaseline = 'alphabetic';
  return { canvas, ctx };
}

function text(ctx, words, x, y, size = 28, bold = false) {
  ctx.font = `${bold ? 'bold ' : ''}${size}px sans-serif`;
  ctx.fillStyle = '#152b33';
  ctx.fillText(words, x, y);
}

function rule(ctx, y) {
  ctx.strokeStyle = '#61757b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(60, y);
  ctx.lineTo(1180, y);
  ctx.stroke();
}

function header(ctx, subtitle) {
  text(ctx, 'FICTIONAL PATHOLOGY', 60, 92, 38, true);
  text(ctx, 'Made-up report for local software testing only', 60, 135, 23);
  text(ctx, subtitle, 60, 185, 27, true);
  rule(ctx, 210);
}

function patient(ctx, collected = '12/03/2026 08:15') {
  text(ctx, 'Patient: Fictional Patient P-01', 60, 260, 26);
  text(ctx, 'DOB: 01/01/1950', 700, 260, 26);
  text(ctx, `Collected: ${collected}`, 60, 308, 26);
  text(ctx, 'Requested: 11/03/2026', 700, 308, 26);
  text(ctx, 'Requesting doctor: Dr A. Example (fictional)', 60, 356, 25);
  rule(ctx, 385);
}

function standard(subtitle) {
  const { canvas, ctx } = page();
  header(ctx, subtitle);
  patient(ctx);
  text(ctx, 'Test', 60, 440, 25, true);
  text(ctx, 'Result', 400, 440, 25, true);
  text(ctx, 'Units', 610, 440, 25, true);
  text(ctx, 'Reference range', 800, 440, 25, true);
  text(ctx, 'Flag', 1090, 440, 25, true);
  rule(ctx, 465);
  const rows = [
    ['Sodium', '128', 'mmol/L', '135-145', 'L'],
    ['Potassium', '4.4', 'mmol/L', '3.5-5.2', ''],
    ['Urea', '6.1', 'mmol/L', '3.0-8.0', ''],
    ['Creatinine', '82', 'umol/L', '60-110', '']
  ];
  rows.forEach((row, index) => {
    const y = 525 + index * 72;
    text(ctx, row[0], 60, y, 29);
    text(ctx, row[1], 400, y, 29);
    text(ctx, row[2], 610, y, 29);
    text(ctx, row[3], 800, y, 29);
    text(ctx, row[4], 1090, y, 29);
  });
  rule(ctx, 790);
  text(ctx, 'Comment: no haemolysis noted.', 60, 845, 24);
  text(ctx, 'END OF FICTIONAL REPORT', 60, 1640, 22, true);
  return canvas;
}

function degraded() {
  const source = standard('SKEWED AND GRAINY SCAN');
  const { canvas, ctx } = page();
  ctx.fillStyle = '#d7d7d4';
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(1.2 * Math.PI / 180);
  ctx.drawImage(source, -width / 2, -height / 2);
  ctx.restore();
  const image = ctx.getImageData(0, 0, width, height);
  let seed = 20260312;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = 0; i < image.data.length; i += 4) {
    const noise = Math.round((random() - 0.5) * 24);
    image.data[i] = Math.max(0, Math.min(255, image.data[i] + noise));
    image.data[i + 1] = Math.max(0, Math.min(255, image.data[i + 1] + noise));
    image.data[i + 2] = Math.max(0, Math.min(255, image.data[i + 2] + noise));
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function cumulative() {
  const { canvas, ctx } = page();
  header(ctx, 'CUMULATIVE REPORT - TWO DATED COLUMNS');
  patient(ctx, '02/03/2026 08:15');
  text(ctx, 'Test', 60, 440, 24, true);
  text(ctx, '01/03/2026', 350, 440, 24, true);
  text(ctx, '02/03/2026', 610, 440, 24, true);
  text(ctx, 'Units', 865, 440, 24, true);
  text(ctx, 'Range', 1040, 440, 24, true);
  rule(ctx, 465);
  text(ctx, 'Sodium', 60, 525, 29);
  text(ctx, '138', 350, 525, 29);
  text(ctx, '139', 610, 525, 29);
  text(ctx, 'mmol/L', 865, 525, 27);
  text(ctx, '135-145', 1040, 525, 25);
  text(ctx, 'Potassium', 60, 597, 29);
  text(ctx, '4.2', 350, 597, 29);
  text(ctx, '4.4', 610, 597, 29);
  text(ctx, 'mmol/L', 865, 597, 27);
  text(ctx, '3.5-5.2', 1040, 597, 25);
  rule(ctx, 660);
  text(ctx, 'Two result columns are printed. Select a result by its collection date.', 60, 720, 23);
  text(ctx, 'END OF FICTIONAL REPORT', 60, 1640, 22, true);
  return canvas;
}

function vitaminDReport() {
  const { canvas, ctx } = page();
  text(ctx, 'Fictional pathology report', 60, 100, 38, true);
  text(ctx, 'Made-up report for local software testing only. No real person.', 60, 150, 23);
  text(ctx, 'Patient reference: F-MEGA01 (fictional)', 60, 240, 26);
  text(ctx, 'Collected: 18/11/2026 08:15', 60, 290, 26);
  text(ctx, '25-hydroxyvitamin D 32 nmol/L (50-150) L', 60, 380, 29);
  text(ctx, 'Calcium 2.31 mmol/L (2.10-2.60)', 60, 440, 29);
  text(ctx, 'Comment: fictional values for a software test.', 60, 520, 24);
  return canvas;
}

fs.writeFileSync(path.join(here, 'vitamin-d-report.png'), vitaminDReport().toBuffer('image/png'));

const reading = {
  analyte: 'sodium', name: 'Sodium', value: 128, valueWords: '128', unit: 'mmol/L',
  refLow: 135, refHigh: 145, flag: 'L', date: '2026-03-12', page: 1, sure: true, readBy: 'model'
};

const truth = {
  description: 'Fictional pathology reports. The cumulative report must abstain because one row holds two dated Sodium values.',
  reports: [
    { file: 'clean.png', expected: { collected: '2026-03-12', readings: [reading] } },
    { file: 'skewed-grainy.png', expected: { collected: '2026-03-12', readings: [reading] } },
    {
      file: 'cumulative.png',
      printed: {
        collected: '2026-03-02',
        sodium: [
          { collected: '2026-03-01', value: 138, unit: 'mmol/L' },
          { collected: '2026-03-02', value: 139, unit: 'mmol/L' }
        ],
        refLow: 135,
        refHigh: 145
      },
      expected: { collected: '2026-03-02', readings: [], abstainedIncludes: 'more than one number' }
    }
  ]
};

for (const [name, canvas] of [['clean.png', standard('CLEAN TEXT REPORT')], ['skewed-grainy.png', degraded()], ['cumulative.png', cumulative()]]) {
  fs.writeFileSync(path.join(here, name), canvas.toBuffer('image/png'));
}
fs.writeFileSync(path.join(here, 'truth.json'), JSON.stringify(truth, null, 2) + '\n');
console.log('Wrote clean.png, skewed-grainy.png, cumulative.png and truth.json');
