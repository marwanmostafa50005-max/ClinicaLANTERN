import { describe, expect, it } from 'vitest';
import { allowedAmounts, checkLetterFacts, checkLetterTone, findAmounts, findMedicineNames, hasWord, tellsTheDoctor } from './facts.ts';
import { checkLetterFacts as exported } from './index.ts';
import { criterionAllowedText } from './criteria.ts';
import { patientText } from './history.ts';
import { testCriterion, testLines, testPatient } from './testkit.ts';

// What a letter for the demo finding may quote from: the patient label, the cited lines, the criterion.
const cited = testLines.slice(1);            // Xarelto and Celebrex lines, August to October
const ALLOWED = [patientText(testPatient), cited.map(l => l.text).join('\n'), criterionAllowedText(testCriterion)].join('\n');

const GOOD = [
  'Review request: celecoxib with rivaroxaban, Fictional patient F-001',
  'I am writing about this 72-year-old patient. Our records show an NSAID supplied while an oral anticoagulant is also being supplied, which carries a risk of major bleeding.',
  'Celebrex (celecoxib) 200 mg capsules were supplied on 21/08/2026 and 20/09/2026, 30 capsules each time. Xarelto 20 mg was supplied on 2026-08-08, on 8 September 2026 and on October 8, 2026. These supplies fall within 60 days of each other.',
  'Could you please review whether the NSAID is still needed? I am happy to help with any information from our dispensing records.'
];

describe('checkLetterFacts', () => {
  it('passes a correct letter, with dates written in different ways', () => {
    expect(checkLetterFacts(GOOD, ALLOWED)).toEqual([]);
  });

  it('is the same function the pipeline exports', () => {
    expect(exported(GOOD, ALLOWED)).toEqual([]);
  });

  it('catches a wrong date (the mistake the letter model made in the proof)', () => {
    const letter = [...GOOD];
    letter[2] = 'Our records show Celecoxib 200 mg daily was supplied on 21/08/2026 and 20/10/2026. Rivaroxaban 20 mg daily was supplied on 08/09/2026 and 08/10/2026.';
    expect(checkLetterFacts(letter, ALLOWED)).toEqual(['The date "20/10/2026" is not in the dispensing lines.']);
  });

  it('catches a wrong date in ISO form and in words, and a date that does not exist', () => {
    expect(checkLetterFacts(['Supplied on 2026-08-22.'], ALLOWED)).toEqual(['The date "2026-08-22" is not in the dispensing lines.']);
    expect(checkLetterFacts(['Supplied on 21 July 2026.'], ALLOWED)).toEqual(['The date "21 July 2026" is not in the dispensing lines.']);
    expect(checkLetterFacts(['Supplied on 31/02/2026.'], ALLOWED)).toEqual(['The date "31/02/2026" is not in the dispensing lines.']);
    expect(checkLetterFacts(['Supplied in November 2026.'], ALLOWED)).toEqual(['The date "November 2026" is not in the dispensing lines.']);
    expect(checkLetterFacts(['Supplied in August 2026 and on 20 September.'], ALLOWED)).toEqual([]);
  });

  it('catches an invented medicine: a known name that is not in the finding', () => {
    const letter = [...GOOD];
    letter[1] = 'I am writing about this 72-year-old patient, who is also taking atorvastatin and Voltaren.';
    expect(checkLetterFacts(letter, ALLOWED)).toEqual([
      'The medicine name "atorvastatin" is not in the dispensing lines or the criterion.',
      'The medicine name "voltaren" is not in the dispensing lines or the criterion.'
    ]);
  });

  it('catches an invented medicine: a made-up name written with a strength, or with a medicine-like ending', () => {
    expect(checkLetterFacts(['The patient was supplied Zentaprex 200 mg.'], ALLOWED))
      .toEqual(['The medicine name "zentaprex" is not in the dispensing lines or the criterion.']);
    expect(checkLetterFacts(['The patient may also be taking fantasoprazole.'], ALLOWED))
      .toEqual(['The medicine name "fantasoprazole" is not in the dispensing lines or the criterion.']);
  });

  it('catches a medicine from the history that is not in the finding, when the history names are passed in', () => {
    expect(checkLetterFacts(['The patient also takes Flurbex each night.'], ALLOWED)).toEqual([]);
    expect(checkLetterFacts(['The patient also takes Flurbex each night.'], ALLOWED, ['flurbex']))
      .toEqual(['The medicine name "flurbex" is not in the dispensing lines or the criterion.']);
  });

  it('accepts a medicine that the criterion lists, and ordinary words before a strength', () => {
    expect(checkLetterFacts(['NSAIDs such as ibuprofen (Nurofen) raise the risk with warfarin.'], ALLOWED)).toEqual([]);
    expect(checkLetterFacts(['A daily dose of 200 mg, taken with 20 mg of the anticoagulant.'], ALLOWED)).toEqual([]);
  });

  it('catches a wrong strength, a wrong quantity and a made-up length of time', () => {
    expect(checkLetterFacts(['Celebrex 400 mg was supplied.'], ALLOWED)).toEqual(['The amount "400 mg" is not in the dispensing lines or the criterion.']);
    expect(checkLetterFacts(['Celebrex was supplied, 60 capsules.'], ALLOWED)).toEqual(['The amount "60 capsules" is not in the dispensing lines or the criterion.']);
    expect(checkLetterFacts(['This has gone on for 3 months.'], ALLOWED)).toEqual(['The amount "3 months" is not in the dispensing lines or the criterion.']);
    expect(checkLetterFacts(['This 75-year-old patient.'], ALLOWED)).toEqual(['The amount "75-year" is not in the dispensing lines or the criterion.']);
  });

  it('accepts amounts however they are spaced, and a quantity written as a count', () => {
    expect(checkLetterFacts(['Celebrex 200mg, 30 capsules, with 2 repeats. Xarelto 20 mg, quantity 28.'], ALLOWED)).toEqual([]);
  });

  it('accepts 30 capsules when the line says qty 30', () => {
    expect(checkLetterFacts(['30 capsules were supplied.'], '2026-08-21 | Celebrex 200 mg capsule | qty 30')).toEqual([]);
  });

  it('catches a wrong number of repeats', () => {
    expect(checkLetterFacts(['Celebrex was supplied with 9 repeats.'], ALLOWED))
      .toEqual(['The amount "9 repeats" is not in the dispensing lines or the criterion.']);
  });

  it('catches an ingredient that is not in the cited lines or the criterion', () => {
    expect(checkLetterFacts(['The patient also takes metformin.'], ALLOWED))
      .toEqual(['The medicine name "metformin" is not in the dispensing lines or the criterion.']);
  });

  it('catches a brand that is not in the cited lines or the criterion', () => {
    expect(checkLetterFacts(['The patient also takes Panadol.'], ALLOWED))
      .toEqual(['The medicine name "panadol" is not in the dispensing lines or the criterion.']);
  });

  it('reports each mismatch once', () => {
    expect(checkLetterFacts(['Supplied on 20/10/2026.', 'Again: 20/10/2026.'], ALLOWED)).toHaveLength(1);
  });
});

describe('a date in every common form is the same day', () => {
  const line = '2026-08-21 | Celebrex 200 mg capsule | qty 30 | repeats 2';
  const forms = [
    '2026-08-21',
    '21/08/2026',
    '21/8/26',
    '21.08.2026',
    '21-08-2026',
    '21 August 2026',
    '21 Aug 2026',
    '21st August 2026',
    'August 21, 2026',
    '21st of August 2026'
  ];

  it.each(forms)('reads %s as 21 August 2026', form => {
    expect(checkLetterFacts([`Celebrex 200 mg was supplied on ${form}.`], line)).toEqual([]);
  });

  it('reads a month with a year, August 2026, as that month', () => {
    expect(checkLetterFacts(['Supplied in August 2026.'], line)).toEqual([]);
  });

  it('catches 21 September 2026 when the line says 21 August 2026', () => {
    expect(checkLetterFacts(['Celebrex 200 mg was supplied on 21 September 2026.'], line))
      .toEqual(['The date "21 September 2026" is not in the dispensing lines.']);
  });
});

describe('the pieces of the fact check', () => {
  it('finds numbers with units', () => {
    expect(findAmounts('Celebrex 200 mg capsule | qty 30 | repeats 2, 1,000 mg, 0.50 mL, 72-year-old').map(a => `${a.value} ${a.unit}`))
      .toEqual(['200 mg', '1000 mg', '0.5 ml', '72 year', '30 qty', '2 repeat']);
  });

  it('finds medicine names by list, by ending and before a strength', () => {
    expect(findMedicineNames('Panadol Osteo and warfarin, with lisinopril.').sort()).toEqual(['lisinopril', 'panadol osteo', 'warfarin']);
    expect(findMedicineNames('Newdrugex 5 mg daily.')).toEqual(['newdrugex']);
    expect(findMedicineNames('The cholesterol result and the routine review in April.')).toEqual([]);
  });
});

describe('checkLetterTone', () => {
  it('accepts a letter that asks for a review', () => {
    expect(checkLetterTone(GOOD)).toEqual([]);
    expect(checkLetterTone(['I would be grateful if you could review this. Please contact the pharmacy if you need more information.'])).toEqual([]);
  });

  it('catches wording that tells the doctor what to do', () => {
    expect(checkLetterTone(['Please cease the celecoxib.'])).toHaveLength(1);
    expect(checkLetterTone(['You should stop the NSAID.'])).toHaveLength(1);
    expect(checkLetterTone(['I recommend stopping the NSAID.'])).toHaveLength(1);
    expect(checkLetterTone(['The NSAID must be stopped.'])).toHaveLength(1);
  });

  // The 20 sentences of the review of 18 November. Fifteen of them passed the check as it was then.
  const INSTRUCTIONS = [
    'You should stop the Celebrex.',
    'Please stop the Celebrex.',
    'I recommend stopping the Celebrex.',
    'The Celebrex should be stopped.',
    'I recommend that the Celebrex be ceased.',
    'Please consider stopping the Celebrex.',
    'Kindly cease the Celebrex.',
    'The Celebrex needs to stop.',
    'Stop the Celebrex while the Xarelto continues.',
    'Celebrex is to be ceased.',
    'A bisphosphonate should be prescribed for this patient.',
    'The sleeping tablet should not be used long-term.',
    'Do not continue the NSAID with the anticoagulant.',
    'It would be best to cease the NSAID.',
    'The NSAID must stop.',
    'I advise against continuing the NSAID.',
    'Please arrange a blood test and withhold the NSAID.',
    'This patient requires a proton pump inhibitor.',
    'Serum potassium should be monitored regularly.',
    'All benzodiazepines should be withdrawn gradually.'
  ];

  it.each(INSTRUCTIONS)('catches an instruction to the doctor: %s', sentence => {
    expect(tellsTheDoctor(sentence)).not.toBeNull();
    expect(checkLetterTone(['I am writing about this patient.', sentence])).toHaveLength(1);
  });

  it('catches the two-sentence instruction that was once logged as "the letter checks found nothing"', () => {
    const problems = checkLetterTone(['I recommend that the Celebrex be ceased. Stop the Celebrex while the Xarelto continues.']);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toBe('The words "recommend" tell the doctor what to do. The letter should ask for a review.');
  });

  const ASKING = [
    'Could you please review whether the NSAID is still needed while the anticoagulant continues, and assess the patient\'s risk of bleeding?',
    'Please let us know if you require any further information.',
    'Should the NSAID be continued?',
    'Should you require anything further, I am happy to help.',
    'Would you consider whether the sleeping tablet should continue?',
    'I am writing to note that this patient is being supplied an NSAID alongside an oral anticoagulant.',
    'This combination may increase the risk of major bleeding.',
    'The dispensing history suggests that both medicines are supplied together.',
    'Start dates of the two supplies are 13 days apart.',
    'Could you please review this when you next see the patient?',
    'What I am asking you to review: Whether the NSAID is still needed while the anticoagulant continues, and the patient\'s risk of bleeding.',
    'I am happy to help with any information from our dispensing records.'
  ];

  it.each(ASKING)('lets a question or a plain statement through: %s', sentence => {
    expect(tellsTheDoctor(sentence)).toBeNull();
  });
});

// ---------- docs/SPEC.md section 6a: fact lines cited from the record ----------

describe('the fact check and the facts a record carries', () => {
  // What a letter may quote when these fact lines are among the cited lines.
  const RECORD = [
    patientText(testPatient),
    '2026-05-12 | RESULT | eGFR 24 mL/min/1.73 m2',
    '2026-08-03 | OBSERVATION | Blood pressure 168/94 mmHg',
    '2026-03-10 | OBSERVATION | Blood pressure lying 150/90, standing 128/78 mmHg',
    '2026-03-04 | RESULT | Serum potassium 2.8 mmol/L',
    '2026-03-04 | RESULT | Serum creatinine 188 umol/L',
    '2026-03-04 | RESULT | TSH 13 mIU/L',
    '2026-03-04 | RESULT | HbA1c 8.2 %',
    '2026-07-10 | CONDITION | Heart failure NYHA class III',
    'no date | CONDITION | Gout',
    'Criterion: an eGFR below 30 mL/min/1.73 m2, or a systolic blood pressure above 160 mmHg.'
  ].join('\n');

  it('accepts a fact quoted from the record: its date and its number with the unit', () => {
    expect(checkLetterFacts([
      'An eGFR of 24 mL/min/1.73 m2 was recorded on 12 May 2026, which is below 30 mL/min/1.73 m2.',
      'The blood pressure was 168/94 mmHg on 3 August 2026, and 128/78 mmHg standing on 10 March 2026.',
      'Serum potassium was 2.8 mmol/L and serum creatinine 188 umol/L on 4 March 2026. The TSH was 13 mIU/L and the HbA1c 8.2%.',
      'Heart failure of NYHA class III was recorded on 10 July 2026. Gout is on the record with no date.'
    ], RECORD)).toEqual([]);
  });

  it('accepts a pressure whose unit the record writes once for two readings, and one half of a reading', () => {
    expect(checkLetterFacts(['Lying blood pressure was 150/90 mmHg.'], RECORD)).toEqual([]);
    expect(checkLetterFacts(['The systolic pressure was 168 mmHg, above 160 mmHg.'], RECORD)).toEqual([]);
  });

  it('catches a number that is not the one on the record', () => {
    expect(checkLetterFacts(['The blood pressure was 186/94 mmHg.'], RECORD)).toEqual(['The amount "186/94 mmHg" is not in the dispensing lines or the criterion.']);
    expect(checkLetterFacts(['An eGFR of 42 mL/min/1.73 m2.'], RECORD)).toEqual(['The amount "42 mL" is not in the dispensing lines or the criterion.']);
    expect(checkLetterFacts(['Serum creatinine was 118 umol/L.'], RECORD)).toEqual(['The amount "118 umol" is not in the dispensing lines or the criterion.']);
    expect(checkLetterFacts(['The potassium was 3.8 mmol/L.'], RECORD)).toEqual(['The amount "3.8 mmol" is not in the dispensing lines or the criterion.']);
    expect(checkLetterFacts(['The systolic pressure was 178 mmHg.'], RECORD)).toEqual(['The amount "178 mmHg" is not in the dispensing lines or the criterion.']);
    expect(checkLetterFacts(['The eGFR was recorded on 12 June 2026.'], RECORD)).toEqual(['The date "12 June 2026" is not in the dispensing lines.']);
  });

  it('finds a blood pressure as one amount, and the new units', () => {
    expect(findAmounts('Blood pressure 168/94 mmHg, creatinine 188 umol/L, TSH 13 mIU/L, pulse 52 bpm, oxygen 9.1 kPa').map(a => `${a.value} ${a.unit}`))
      .toEqual(['188 umol', '13 miu', '52 bpm', '9.1 kpa', '168/94 mmhg']);
    // A strength such as 160/25 mg is not a pressure, and words are not units.
    expect(findAmounts('Co-Diovan 160/25 mg, 3 must, 2 ngs').map(a => `${a.value} ${a.unit}`)).toEqual([]);
  });

  it('gives the amounts of the two demo lines exactly as before', () => {
    expect([...allowedAmounts('Celebrex 200 mg capsule | qty 30 | repeats 2')].sort()).toEqual(['2 repeat', '200 mg', '30 qty']);
  });
});

describe('a medicine name as a whole word', () => {
  it('matches the name on its own and refuses a name hidden inside another word', () => {
    expect(hasWord('patient takes aspirin daily', 'aspirin')).toBe(true);
    expect(hasWord('aspirin', 'aspirin')).toBe(true);
    expect(hasWord('the dose is aspirin.', 'aspirin')).toBe(true);
    expect(hasWord('supplied co-amoxiclav', 'co-amoxiclav')).toBe(true);
    expect(hasWord('supplied co-amoxiclav', 'amoxiclav')).toBe(true);
    expect(hasWord('patient takes aspirin daily', 'spirin')).toBe(false);
    expect(hasWord('aspirin10 tablets', 'aspirin')).toBe(false);
    // Both arguments are already lower case. This function does not fold case.
    expect(hasWord('Aspirin daily', 'aspirin')).toBe(false);
  });

  it('treats a dot or a plus in the name as that character', () => {
    expect(hasWord('the salt is a.b today', 'a.b')).toBe(true);
    expect(hasWord('the salt is axb today', 'a.b')).toBe(false);
    expect(hasWord('give a+b now', 'a+b')).toBe(true);
    expect(hasWord('give ab now', 'a+b')).toBe(false);
  });
});
