// Writes the fresh test histories of task 5.5 step 7: one positive and one near miss for each of
// the ten, written by Kimi Code because Gemini's GM03 never landed. Other brands, other dates,
// other order and other fictional patients than the signed set. Fictional patients only.
// Run: node data/k06/fresh.mjs
import fs from 'node:fs';

const HEAD = 'patient_ref,patient_age,patient_sex,record_type,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber,detail,value';
const F = (ref, age, sex, date, med, brand, strength, qty, rep, dir, pres = 'Dr A. Example') =>
  [ref, age, sex, '', date, med, brand, strength, 'tablet', qty, rep, dir, pres, '', ''].join(',');

// Each spec: pos and near-miss histories. kind rows: ['csv-line', ...]; facts: ['fact', date, what, value]
const SPECS = {
  'STOPP-C10': {
    pos: [
      F('F-FR-C10-1', 74, 'F', '2026-02-12', 'atorvastatin', 'Lipitor', '20 mg', 30, 4, 'Take ONE tablet at night'),
      F('F-FR-C10-1', 74, 'F', '2026-03-04', 'apixaban', 'Eliquis', '5 mg', 60, 3, 'Take ONE tablet twice a day'),
      F('F-FR-C10-1', 74, 'F', '2026-03-18', 'naproxen', 'Proxen SR', '750 mg', 30, 2, 'Take ONE tablet twice a day with food', 'Dr B. Sample'),
      F('F-FR-C10-1', 74, 'F', '2026-04-01', 'apixaban', 'Eliquis', '5 mg', 60, 2, 'Take ONE tablet twice a day'),
      F('F-FR-C10-1', 74, 'F', '2026-04-15', 'naproxen', 'Proxen SR', '750 mg', 30, 1, 'Take ONE tablet twice a day with food', 'Dr B. Sample'),
      F('F-FR-C10-1', 74, 'F', '2026-05-06', 'apixaban', 'Eliquis', '5 mg', 60, 1, 'Take ONE tablet twice a day'),
      F('F-FR-C10-1', 74, 'F', '2026-05-20', 'naproxen', 'Proxen SR', '750 mg', 30, 0, 'Take ONE tablet twice a day with food', 'Dr B. Sample'),
      F('F-FR-C10-1', 74, 'F', '2026-06-03', 'levothyroxine', 'Oroxine', '100 microgram', 90, 4, 'Take ONE tablet daily'),
    ],
    posNeedles: [["proxen sr"], ["eliquis"]],
    near: [
      F('F-FR-C10-2', 69, 'M', '2026-01-20', 'ketoprofen', 'Orudis', '50 mg', 60, 1, 'Take ONE capsule three times a day with food', 'Dr B. Sample'),
      F('F-FR-C10-2', 69, 'M', '2026-02-10', 'ketoprofen', 'Orudis', '50 mg', 60, 0, 'Take ONE capsule three times a day with food', 'Dr B. Sample'),
      F('F-FR-C10-2', 69, 'M', '2026-06-15', 'dabigatran', 'Pradaxa', '150 mg', 60, 2, 'Take ONE capsule twice a day'),
      F('F-FR-C10-2', 69, 'M', '2026-07-06', 'dabigatran', 'Pradaxa', '150 mg', 60, 1, 'Take ONE capsule twice a day'),
      F('F-FR-C10-2', 69, 'M', '2026-07-20', 'metformin', 'Diabex XR', '1000 mg', 60, 5, 'Take ONE tablet twice a day with meals'),
    ],
  },
  'STOPP-B3': {
    pos: [
      F('F-FR-B3-1', 78, 'M', '2026-04-08', 'metoprolol', 'Betaloc', '50 mg', 60, 3, 'Take ONE tablet twice a day'),
      F('F-FR-B3-1', 78, 'M', '2026-04-22', 'diltiazem', 'Cardizem CD', '180 mg', 30, 2, 'Take ONE capsule daily', 'Dr B. Sample'),
      F('F-FR-B3-1', 78, 'M', '2026-05-06', 'metoprolol', 'Betaloc', '50 mg', 60, 2, 'Take ONE tablet twice a day'),
      F('F-FR-B3-1', 78, 'M', '2026-05-20', 'diltiazem', 'Cardizem CD', '180 mg', 30, 1, 'Take ONE capsule daily', 'Dr B. Sample'),
      F('F-FR-B3-1', 78, 'M', '2026-06-03', 'metoprolol', 'Betaloc', '50 mg', 60, 1, 'Take ONE tablet twice a day'),
      F('F-FR-B3-1', 78, 'M', '2026-06-17', 'diltiazem', 'Cardizem CD', '180 mg', 30, 0, 'Take ONE capsule daily', 'Dr B. Sample'),
      F('F-FR-B3-1', 78, 'M', '2026-07-01', 'aspirin', 'Astrix', '100 mg', 90, 5, 'Take ONE tablet daily'),
    ],
    posNeedles: [["betaloc"], ["cardizem cd"]],
    near: [
      F('F-FR-B3-2', 71, 'F', '2026-02-25', 'atenolol', 'Anselol', '50 mg', 30, 1, 'Take ONE tablet daily'),
      F('F-FR-B3-2', 71, 'F', '2026-03-25', 'atenolol', 'Anselol', '50 mg', 30, 0, 'Take ONE tablet daily'),
      F('F-FR-B3-2', 71, 'F', '2026-07-08', 'verapamil', 'Isoptin SR', '240 mg', 30, 2, 'Take ONE tablet daily', 'Dr B. Sample'),
      F('F-FR-B3-2', 71, 'F', '2026-07-22', 'verapamil', 'Isoptin SR', '240 mg', 30, 1, 'Take ONE tablet daily', 'Dr B. Sample'),
      F('F-FR-B3-2', 71, 'F', '2026-08-05', 'citalopram', 'Celapram', '20 mg', 30, 4, 'Take ONE tablet daily'),
    ],
  },
  'STOPP-B13': {
    pos: [
      ['fact', '2025-09-10', 'Serum potassium', '4.7 mmol/L'],
      F('F-FR-B13-1', 73, 'F', '2026-03-12', 'perindopril', 'Prexum', '5 mg', 30, 3, 'Take ONE tablet in the morning'),
      F('F-FR-B13-1', 73, 'F', '2026-04-02', 'spironolactone', 'Spiractin', '25 mg', 100, 3, 'Take ONE tablet daily', 'Dr B. Sample'),
      F('F-FR-B13-1', 73, 'F', '2026-04-09', 'perindopril', 'Prexum', '5 mg', 30, 2, 'Take ONE tablet in the morning'),
      F('F-FR-B13-1', 73, 'F', '2026-05-07', 'perindopril', 'Prexum', '5 mg', 30, 1, 'Take ONE tablet in the morning'),
      F('F-FR-B13-1', 73, 'F', '2026-05-14', 'spironolactone', 'Spiractin', '25 mg', 100, 2, 'Take ONE tablet daily', 'Dr B. Sample'),
      F('F-FR-B13-1', 73, 'F', '2026-06-04', 'perindopril', 'Prexum', '5 mg', 30, 0, 'Take ONE tablet in the morning'),
      F('F-FR-B13-1', 73, 'F', '2026-06-11', 'spironolactone', 'Spiractin', '25 mg', 100, 1, 'Take ONE tablet daily', 'Dr B. Sample'),
      F('F-FR-B13-1', 73, 'F', '2026-06-18', 'salbutamol', 'Ventolin', '100 microgram', 200, 5, 'Inhale TWO puffs when needed'),
    ],
    posNeedles: [["spiractin"], ["prexum"], ["serum potassium"]],
    near: [
      ['fact', '2026-06-20', 'Serum potassium', '4.5 mmol/L'],
      F('F-FR-B13-2', 68, 'M', '2026-04-15', 'candesartan', 'Atacand', '16 mg', 30, 3, 'Take ONE tablet daily'),
      F('F-FR-B13-2', 68, 'M', '2026-05-01', 'spironolactone', 'Spiractin', '25 mg', 100, 2, 'Take ONE tablet daily', 'Dr B. Sample'),
      F('F-FR-B13-2', 68, 'M', '2026-05-13', 'candesartan', 'Atacand', '16 mg', 30, 2, 'Take ONE tablet daily'),
      F('F-FR-B13-2', 68, 'M', '2026-06-10', 'candesartan', 'Atacand', '16 mg', 30, 1, 'Take ONE tablet daily'),
      F('F-FR-B13-2', 68, 'M', '2026-06-24', 'spironolactone', 'Spiractin', '25 mg', 100, 1, 'Take ONE tablet daily', 'Dr B. Sample'),
      F('F-FR-B13-2', 68, 'M', '2026-07-08', 'candesartan', 'Atacand', '16 mg', 30, 0, 'Take ONE tablet daily'),
    ],
  },
  'STOPP-C14': {
    pos: [
      F('F-FR-C14-1', 70, 'F', '2026-04-30', 'rivaroxaban', 'Xarelto', '20 mg', 30, 3, 'Take ONE tablet daily with food'),
      F('F-FR-C14-1', 70, 'F', '2026-05-05', 'clarithromycin', 'Kalixocin', '500 mg', 14, 0, 'Take ONE tablet twice a day until finished', 'Dr C. Specimen'),
      F('F-FR-C14-1', 70, 'F', '2026-05-28', 'rivaroxaban', 'Xarelto', '20 mg', 30, 2, 'Take ONE tablet daily with food'),
      F('F-FR-C14-1', 70, 'F', '2026-06-25', 'rivaroxaban', 'Xarelto', '20 mg', 30, 1, 'Take ONE tablet daily with food'),
      F('F-FR-C14-1', 70, 'F', '2026-07-02', 'esomeprazole', 'Nexium', '20 mg', 30, 4, 'Take ONE tablet daily'),
    ],
    posNeedles: [["xarelto"], ["kalixocin"]],
    near: [
      F('F-FR-C14-2', 75, 'M', '2026-02-11', 'amiodarone', 'Aratac', '200 mg', 30, 1, 'Take ONE tablet daily', 'Dr B. Sample'),
      F('F-FR-C14-2', 75, 'M', '2026-06-17', 'apixaban', 'Eliquis', '5 mg', 60, 2, 'Take ONE tablet twice a day'),
      F('F-FR-C14-2', 75, 'M', '2026-07-08', 'apixaban', 'Eliquis', '5 mg', 60, 1, 'Take ONE tablet twice a day'),
      F('F-FR-C14-2', 75, 'M', '2026-07-22', 'rosuvastatin', 'Crestor', '10 mg', 30, 4, 'Take ONE tablet daily'),
    ],
  },
  'STOPP-D18': {
    pos: [
      F('F-FR-D18-1', 79, 'F', '2026-03-19', 'galantamine', 'Reminyl', '8 mg', 56, 2, 'Take ONE tablet twice a day'),
      F('F-FR-D18-1', 79, 'F', '2026-04-02', 'sotalol', 'Sotab', '80 mg', 30, 2, 'Take ONE tablet twice a day', 'Dr B. Sample'),
      F('F-FR-D18-1', 79, 'F', '2026-04-16', 'galantamine', 'Reminyl', '8 mg', 56, 1, 'Take ONE tablet twice a day'),
      F('F-FR-D18-1', 79, 'F', '2026-04-30', 'sotalol', 'Sotab', '80 mg', 30, 1, 'Take ONE tablet twice a day', 'Dr B. Sample'),
      F('F-FR-D18-1', 79, 'F', '2026-05-14', 'galantamine', 'Reminyl', '8 mg', 56, 0, 'Take ONE tablet twice a day'),
      F('F-FR-D18-1', 79, 'F', '2026-05-28', 'vitamin D', 'Ostelin', '1000 IU', 60, 5, 'Take ONE tablet daily'),
    ],
    posNeedles: [["reminyl"], ["sotab"]],
    near: [
      F('F-FR-D18-2', 67, 'M', '2026-04-09', 'pyridostigmine', 'Mestinon', '60 mg', 90, 3, 'Take ONE tablet three times a day'),
      F('F-FR-D18-2', 67, 'M', '2026-05-07', 'pyridostigmine', 'Mestinon', '60 mg', 90, 2, 'Take ONE tablet three times a day'),
      F('F-FR-D18-2', 67, 'M', '2026-06-04', 'pyridostigmine', 'Mestinon', '60 mg', 90, 1, 'Take ONE tablet three times a day'),
      F('F-FR-D18-2', 67, 'M', '2026-06-18', 'cetirizine', 'Zyrtec', '10 mg', 30, 5, 'Take ONE tablet daily when needed'),
    ],
  },
  'STOPP-L2': {
    pos: [
      F('F-FR-L2-1', 66, 'F', '2026-03-26', 'oxycodone', 'OxyNorm', '10 mg', 60, 3, 'Take ONE capsule every six hours when needed for pain', 'Dr B. Sample'),
      F('F-FR-L2-1', 66, 'F', '2026-04-23', 'oxycodone', 'OxyNorm', '10 mg', 60, 2, 'Take ONE capsule every six hours when needed for pain', 'Dr B. Sample'),
      F('F-FR-L2-1', 66, 'F', '2026-05-21', 'oxycodone', 'OxyNorm', '10 mg', 60, 1, 'Take ONE capsule every six hours when needed for pain', 'Dr B. Sample'),
      F('F-FR-L2-1', 66, 'F', '2026-06-18', 'oxycodone', 'OxyNorm', '10 mg', 60, 0, 'Take ONE capsule every six hours when needed for pain', 'Dr B. Sample'),
      F('F-FR-L2-1', 66, 'F', '2026-04-09', 'pregabalin', 'Lyrica', '75 mg', 56, 2, 'Take ONE capsule twice a day'),
    ],
    posNeedles: [["oxynorm"]],
    near: [
      F('F-FR-L2-2', 72, 'M', '2026-04-16', 'tapentadol', 'Palexia SR', '50 mg', 56, 2, 'Take ONE tablet twice a day', 'Dr B. Sample'),
      F('F-FR-L2-2', 72, 'M', '2026-04-20', 'macrogol 3350', 'Movicol', '13 g', 60, 4, 'Dissolve ONE sachet in water daily'),
      F('F-FR-L2-2', 72, 'M', '2026-05-14', 'tapentadol', 'Palexia SR', '50 mg', 56, 1, 'Take ONE tablet twice a day', 'Dr B. Sample'),
      F('F-FR-L2-2', 72, 'M', '2026-05-28', 'macrogol 3350', 'Movicol', '13 g', 60, 3, 'Dissolve ONE sachet in water daily'),
      F('F-FR-L2-2', 72, 'M', '2026-06-11', 'atenolol', 'Anselol', '50 mg', 30, 5, 'Take ONE tablet daily'),
    ],
  },
  'STOPP-D8': {
    pos: [
      F('F-FR-D8-1', 70, 'M', '2026-03-05', 'temazepam', 'Normison', '10 mg', 25, 3, 'Take ONE tablet at night', 'Dr B. Sample'),
      F('F-FR-D8-1', 70, 'M', '2026-04-02', 'temazepam', 'Normison', '10 mg', 25, 2, 'Take ONE tablet at night', 'Dr B. Sample'),
      F('F-FR-D8-1', 70, 'M', '2026-05-07', 'temazepam', 'Normison', '10 mg', 25, 1, 'Take ONE tablet at night', 'Dr B. Sample'),
      F('F-FR-D8-1', 70, 'M', '2026-06-04', 'temazepam', 'Normison', '10 mg', 25, 0, 'Take ONE tablet at night', 'Dr B. Sample'),
      F('F-FR-D8-1', 70, 'M', '2026-03-19', 'metformin', 'Diabex XR', '1000 mg', 60, 5, 'Take ONE tablet twice a day with meals'),
    ],
    posNeedles: [["normison"]],
    near: [
      F('F-FR-D8-2', 64, 'F', '2026-05-21', 'alprazolam', 'Ralozam', '0.5 mg', 20, 0, 'Take HALF a tablet when needed for anxiety up to twice a week', 'Dr B. Sample'),
      F('F-FR-D8-2', 64, 'F', '2026-06-03', 'venlafaxine', 'Efexor XR', '75 mg', 30, 4, 'Take ONE capsule daily'),
      F('F-FR-D8-2', 64, 'F', '2026-07-01', 'venlafaxine', 'Efexor XR', '75 mg', 30, 3, 'Take ONE capsule daily'),
    ],
  },
  'STOPP-A3': {
    pos: [
      F('F-FR-A3-1', 75, 'F', '2026-04-23', 'quetiapine', 'Syquet', '25 mg', 60, 2, 'Take ONE tablet at night'),
      F('F-FR-A3-1', 75, 'F', '2026-05-06', 'risperidone', 'Risperdal', '1 mg', 60, 2, 'Take ONE tablet twice a day', 'Dr B. Sample'),
      F('F-FR-A3-1', 75, 'F', '2026-05-21', 'quetiapine', 'Syquet', '25 mg', 60, 1, 'Take ONE tablet at night'),
      F('F-FR-A3-1', 75, 'F', '2026-06-03', 'risperidone', 'Risperdal', '1 mg', 60, 1, 'Take ONE tablet twice a day', 'Dr B. Sample'),
      F('F-FR-A3-1', 75, 'F', '2026-06-17', 'quetiapine', 'Syquet', '25 mg', 60, 0, 'Take ONE tablet at night'),
      F('F-FR-A3-1', 75, 'F', '2026-05-14', 'calcium carbonate', 'Caltrate', '600 mg', 60, 5, 'Take ONE tablet twice a day'),
    ],
    posNeedles: [["syquet"], ["risperdal"]],
    near: [
      F('F-FR-A3-2', 68, 'M', '2026-04-30', 'quetiapine', 'Syquet', '50 mg', 60, 2, 'Take ONE tablet at night'),
      F('F-FR-A3-2', 68, 'M', '2026-05-28', 'quetiapine', 'Syquet', '50 mg', 60, 1, 'Take ONE tablet at night'),
      F('F-FR-A3-2', 68, 'M', '2026-06-25', 'quetiapine', 'Syquet', '50 mg', 60, 0, 'Take ONE tablet at night'),
      F('F-FR-A3-2', 68, 'M', '2026-06-11', 'atorvastatin', 'Lipitor', '40 mg', 30, 4, 'Take ONE tablet at night'),
    ],
  },
  'STOPP-B11': {
    pos: [
      F('F-FR-B11-1', 73, 'M', '2026-05-13', 'moxonidine', 'Physiotens', '200 microgram', 30, 2, 'Take ONE tablet twice a day', 'Dr B. Sample'),
      F('F-FR-B11-1', 73, 'M', '2026-06-10', 'moxonidine', 'Physiotens', '200 microgram', 30, 1, 'Take ONE tablet twice a day', 'Dr B. Sample'),
      F('F-FR-B11-1', 73, 'M', '2026-07-08', 'moxonidine', 'Physiotens', '200 microgram', 30, 0, 'Take ONE tablet twice a day', 'Dr B. Sample'),
      F('F-FR-B11-1', 73, 'M', '2026-05-27', 'amlodipine', 'Norvasc', '5 mg', 30, 5, 'Take ONE tablet daily'),
    ],
    posNeedles: [["physiotens"]],
    near: [
      F('F-FR-B11-2', 70, 'F', '2026-04-16', 'perindopril', 'Coversyl', '5 mg', 30, 3, 'Take ONE tablet in the morning'),
      F('F-FR-B11-2', 70, 'F', '2026-05-14', 'perindopril', 'Coversyl', '5 mg', 30, 2, 'Take ONE tablet in the morning'),
      F('F-FR-B11-2', 70, 'F', '2026-06-11', 'perindopril', 'Coversyl', '5 mg', 30, 1, 'Take ONE tablet in the morning'),
      F('F-FR-B11-2', 70, 'F', '2026-05-21', 'hydrochlorothiazide', 'Dithiazide', '25 mg', 30, 4, 'Take ONE tablet daily'),
    ],
  },
  'PINCER-9': {
    pos: [
      F('F-FR-P9-1', 61, 'F', '2026-03-26', 'methotrexate', 'Trexject', '10 mg', 15, 3, 'Take as directed by your specialist', 'Dr B. Sample'),
      F('F-FR-P9-1', 61, 'F', '2026-04-23', 'methotrexate', 'Trexject', '10 mg', 15, 2, 'Take as directed by your specialist', 'Dr B. Sample'),
      F('F-FR-P9-1', 61, 'F', '2026-05-21', 'methotrexate', 'Trexject', '10 mg', 15, 0, 'Take as directed', 'Dr B. Sample'),
      F('F-FR-P9-1', 61, 'F', '2026-04-09', 'folic acid', 'Folicid', '5 mg', 30, 4, 'Take ONE tablet daily except on methotrexate day'),
      F('F-FR-P9-1', 61, 'F', '2026-05-07', 'naproxen', 'Naprogesic', '275 mg', 60, 2, 'Take ONE tablet twice a day with food'),
    ],
    posNeedles: [["trexject"]],
    near: [
      F('F-FR-P9-2', 68, 'M', '2026-04-02', 'methotrexate', 'Methoblastin', '10 mg', 15, 2, 'Take ONE tablet once a week on the same day', 'Dr B. Sample'),
      F('F-FR-P9-2', 68, 'M', '2026-05-14', 'methotrexate', 'Methoblastin', '10 mg', 15, 1, 'Take ONE tablet once a week on the same day', 'Dr B. Sample'),
      F('F-FR-P9-2', 68, 'M', '2026-06-25', 'methotrexate', 'Methoblastin', '10 mg', 15, 0, 'Take ONE tablet once weekly', 'Dr B. Sample'),
      F('F-FR-P9-2', 68, 'M', '2026-04-16', 'folic acid', 'Folicid', '5 mg', 30, 4, 'Take ONE tablet daily except on methotrexate day'),
    ],
  },
};

const ABOUT = {
  'STOPP-C10': ['Proxen SR (naproxen) is supplied three times from March to May 2026 while Eliquis (apixaban) is supplied every month, and the supplies overlap.', 'Orudis (ketoprofen) was last supplied in February 2026 and Pradaxa (dabigatran) was first supplied in June, more than 60 days later, so the two never overlapped.'],
  'STOPP-B3': ['Betaloc (metoprolol) and Cardizem CD (diltiazem) are both supplied every month from April to June 2026, overlapping throughout.', 'Anselol (atenolol) was last supplied in March 2026 and Isoptin SR (verapamil) was first supplied in July, more than 60 days later.'],
  'STOPP-B13': ['Spiractin (spironolactone) is supplied with monthly Prexum (perindopril) from April 2026, and the record holds a serum potassium result from September 2025, more than six months before the newest supply.', 'Spiractin is supplied with monthly Atacand (candesartan), and the record holds a serum potassium result from June 2026, within the last six months.'],
  'STOPP-C14': ['Xarelto (rivaroxaban) is supplied monthly and a course of Kalixocin (clarithromycin) in May 2026 falls within 60 days of the rivaroxaban supplies.', 'Aratac (amiodarone) was last supplied in February 2026 and Eliquis (apixaban) was first supplied in June, more than 60 days later.'],
  'STOPP-D18': ['Reminyl (galantamine) is supplied every month from March 2026 together with Sotab (sotalol), and the supplies overlap.', 'Mestinon (pyridostigmine) is the only medicine of the two groups supplied; there is no beta-blocker, digoxin, diltiazem or verapamil.'],
  'STOPP-L2': ['OxyNorm (oxycodone) is supplied monthly from March to June 2026 for regular use, and no laxative of any kind is supplied.', 'Palexia SR (tapentadol) is supplied with Movicol (macrogol) supplied within 60 days of each opioid supply.'],
  'STOPP-D8': ['Normison (temazepam) is supplied four times from March to June 2026, more than 28 days of supplies in all.', 'Ralozam (alprazolam) is supplied once, 20 tablets for use no more than twice a week, covering far less than 28 days.'],
  'STOPP-A3': ['Syquet (quetiapine) and Risperdal (risperidone), two antipsychotics from one class, are both supplied monthly from April 2026, overlapping.', 'Only Syquet (quetiapine) of the antipsychotic class is supplied; no second medicine of the same class appears.'],
  'STOPP-B11': ['Physiotens (moxonidine), a centrally-acting antihypertensive, is supplied three times from May 2026.', 'Coversyl (perindopril) and a diuretic are supplied; neither is a centrally-acting antihypertensive.'],
  'PINCER-9': ['Trexject (methotrexate) is supplied three times and the most recent directions say only "Take as directed", with no word of once weekly.', 'Methoblastin (methotrexate) is supplied monthly and every supply says to take one tablet once a week.'],
};

const cases = [];
for (const [id, spec] of Object.entries(SPECS)) {
  const dir = `cases/_fresh/${id}`;
  fs.mkdirSync(dir, { recursive: true });
  const rowsOf = (rows) => rows.map((r) => (Array.isArray(r) ? null : r)).filter(Boolean);
  const factsOf = (rows) => rows.filter((r) => Array.isArray(r));
  // interleave facts by date
  const merge = (rows) => rows.slice().sort((a, b) => (Array.isArray(a) ? a[1] : a.split(',')[4]) < (Array.isArray(b) ? b[1] : b.split(',')[4]) ? -1 : 1);
  const toCsv = (rows) => [HEAD, ...merge(rows).map((r) => {
    if (!Array.isArray(r)) return r;
    const [, date, what, value] = r;
    const ref = rows.find((x) => !Array.isArray(x)).split(',')[0];
    const age = rows.find((x) => !Array.isArray(x)).split(',')[1];
    const sex = rows.find((x) => !Array.isArray(x)).split(',')[2];
    return [ref, age, sex, 'result', date, '', '', '', '', '', '', '', '', what, value].join(',');
  })].join('\n') + '\n';

  fs.writeFileSync(`${dir}/pos.csv`, toCsv(spec.pos));
  fs.writeFileSync(`${dir}/near-miss.csv`, toCsv(spec.near));
  // line IDs follow the written order: rebuild the citation lists from the file itself
  const posLines = fs.readFileSync(`${dir}/pos.csv`, 'utf8').trim().split(String.fromCharCode(10)).map((s) => s.replace(String.fromCharCode(13), '')).slice(1);
  const citeFor = (needles) => posLines.map((l, i) => ({ l, id: `L${String(i + 1).padStart(3, '0')}` }))
    .filter(({ l }) => needles.some((n) => l.toLowerCase().includes(n.toLowerCase()))).map((x) => x.id);
  const must_cite = spec.posNeedles.map(citeFor);
  const [posAbout, nearAbout] = ABOUT[id];
  cases.push({ file: `_fresh/${id}/pos.csv`, kind: 'positive', about: posAbout, findings: [{ criterion: id, must_cite }] });
  cases.push({ file: `_fresh/${id}/near-miss.csv`, kind: 'near_miss', about: nearAbout, findings: [] });
}
fs.writeFileSync('cases/expected.fresh.json', JSON.stringify({ signed_by_clinical_reviewer: null, cases }, null, 2) + '\n');
console.log('fresh histories written:', cases.length);
