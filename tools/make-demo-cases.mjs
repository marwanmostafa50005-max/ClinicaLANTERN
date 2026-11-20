// Writes the two demo histories in cases/_demo from the fictional history used in the model proof.
// Fictional patients only. No real person.
//   node tools/make-demo-cases.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'cases', '_demo');

const COLUMNS = [
  'patient_ref', 'patient_age', 'patient_sex', 'dispense_date', 'medicine', 'brand',
  'strength', 'form', 'quantity', 'repeats_left', 'directions', 'prescriber'
];

export function history() {
  const rows = [];
  const add = (date, brand, medicine, strength, form, quantity, repeats, directions, prescriber) =>
    rows.push({ date, brand, medicine, strength, form, quantity, repeats, directions, prescriber });
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  for (const m of months) {
    add(m + '-06', 'Diabex XR', 'metformin', '1000 mg', 'modified release tablet', 60, 4, 'Take ONE tablet twice a day with food', 'Dr F. Example');
    add(m + '-06', 'Coversyl', 'perindopril arginine', '5 mg', 'tablet', 30, 4, 'Take ONE tablet in the morning', 'Dr F. Example');
    add(m + '-06', 'Lipitor', 'atorvastatin', '40 mg', 'tablet', 30, 4, 'Take ONE tablet at night', 'Dr F. Example');
    add(m + '-08', 'Xarelto', '', '20 mg', 'tablet', 28, 5, 'Take ONE tablet daily with food', 'Dr F. Example');
    if (m === '2026-03' || m === '2026-07') add(m + '-15', 'Panadol Osteo', 'paracetamol', '665 mg', 'modified release tablet', 96, 2, 'Take TWO tablets three times a day', 'Dr F. Example');
    if (m === '2026-04') add(m + '-19', 'Amoxil', 'amoxicillin', '500 mg', 'capsule', 20, 0, 'Take ONE capsule three times a day until finished', 'Dr G. Sample');
    if (m === '2026-08') add(m + '-21', 'Celebrex', '', '200 mg', 'capsule', 30, 2, 'Take ONE capsule daily with food', 'Dr G. Sample');
    if (m === '2026-09') add(m + '-20', 'Celebrex', '', '200 mg', 'capsule', 30, 1, 'Take ONE capsule daily with food', 'Dr G. Sample');
  }
  return rows;
}

export function cell(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function toCsv(rows, patient) {
  const lines = [COLUMNS.join(',')];
  for (const r of rows) {
    lines.push([
      patient.ref, patient.age, patient.sex, r.date, r.medicine, r.brand,
      r.strength, r.form, r.quantity, r.repeats, r.directions, r.prescriber
    ].map(cell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/**
 * A long history, printed medicine by medicine, as some dispensing reports are: every supply of one
 * medicine, then every supply of the next. Xarelto comes first and Celebrex last, about 300 lines
 * later, so the two medicines of the demo finding never sit in the same part of the history.
 * It is in the answer sheet so that the scorer measures a finding whose lines are split over parts.
 */
export function longHistory() {
  const rows = [];
  const add = (date, brand, medicine, strength, form, quantity, repeats, directions, prescriber) =>
    rows.push({ date, brand, medicine, strength, form, quantity, repeats, directions, prescriber });
  const months = [];
  for (let year = 2024; year <= 2026; year++) {
    for (let month = 1; month <= 12; month++) {
      if (year === 2026 && month > 10) break;
      months.push(`${year}-${String(month).padStart(2, '0')}`);
    }
  }
  const everyMonth = (day, ...supply) => { for (const m of months) add(`${m}-${day}`, ...supply); };
  everyMonth('08', 'Xarelto', '', '20 mg', 'tablet', 28, 5, 'Take ONE tablet daily with food', 'Dr F. Example');
  everyMonth('06', 'Diabex XR', 'metformin', '1000 mg', 'modified release tablet', 60, 4, 'Take ONE tablet twice a day with food', 'Dr F. Example');
  everyMonth('06', 'Coversyl', 'perindopril arginine', '5 mg', 'tablet', 30, 4, 'Take ONE tablet in the morning', 'Dr F. Example');
  everyMonth('06', 'Lipitor', 'atorvastatin', '40 mg', 'tablet', 30, 4, 'Take ONE tablet at night', 'Dr F. Example');
  everyMonth('12', 'Somac', 'pantoprazole', '40 mg', 'enteric coated tablet', 30, 5, 'Take ONE tablet daily before food', 'Dr F. Example');
  everyMonth('12', 'Ostelin', 'colecalciferol', '25 microgram', 'capsule', 60, 2, 'Take ONE capsule daily', 'Dr F. Example');
  everyMonth('15', 'Panadol Osteo', 'paracetamol', '665 mg', 'modified release tablet', 96, 2, 'Take TWO tablets three times a day', 'Dr F. Example');
  everyMonth('20', 'Ventolin', 'salbutamol', '100 microgram', 'inhaler', 2, 5, 'TWO puffs when needed', 'Dr F. Example');
  everyMonth('20', 'Seretide', 'fluticasone propionate with salmeterol', '250/25', 'inhaler', 1, 5, 'TWO puffs twice a day', 'Dr F. Example');
  add('2025-04-19', 'Amoxil', 'amoxicillin', '500 mg', 'capsule', 20, 0, 'Take ONE capsule three times a day until finished', 'Dr G. Sample');
  add('2026-04-22', 'Amoxil', 'amoxicillin', '500 mg', 'capsule', 20, 0, 'Take ONE capsule three times a day until finished', 'Dr G. Sample');
  add('2026-08-21', 'Celebrex', '', '200 mg', 'capsule', 30, 2, 'Take ONE capsule daily with food', 'Dr G. Sample');
  add('2026-09-20', 'Celebrex', '', '200 mg', 'capsule', 30, 1, 'Take ONE capsule daily with food', 'Dr G. Sample');
  return rows;
}

export const lineId = i => 'L' + String(i + 1).padStart(3, '0');
export const linesOf = (rows, test) => rows.map((r, i) => (test(r) ? lineId(i) : '')).filter(Boolean);

const calledDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (calledDirectly) {
  const positive = history();
  const nearMiss = positive.filter(r => r.brand !== 'Celebrex');
  const long = longHistory();

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'positive.csv'), toCsv(positive, { ref: 'F-001', age: 72, sex: 'F' }));
  fs.writeFileSync(path.join(OUT, 'near-miss.csv'), toCsv(nearMiss, { ref: 'F-002', age: 72, sex: 'F' }));
  fs.writeFileSync(path.join(OUT, 'long-split.csv'), toCsv(long, { ref: 'F-003', age: 74, sex: 'M' }));

  const celebrex = linesOf(positive, r => r.brand === 'Celebrex');
  console.log(`positive.csv: ${positive.length} rows. Celebrex is on ${celebrex.join(' and ')}.`);
  console.log(`near-miss.csv: ${nearMiss.length} rows. No NSAID. Xarelto is still there.`);
  console.log(`long-split.csv: ${long.length} rows, printed medicine by medicine. ` +
    `Xarelto is on ${linesOf(long, r => r.brand === 'Xarelto')[0]} to ${linesOf(long, r => r.brand === 'Xarelto').pop()}. ` +
    `Celebrex is on ${linesOf(long, r => r.brand === 'Celebrex').join(' and ')}. ` +
    `Xarelto within 60 days of a Celebrex supply: ${linesOf(long, r => r.brand === 'Xarelto' && r.date >= '2026-07-01').join(', ')}.`);
}
