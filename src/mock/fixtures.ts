// Sample data for ?mock=1. Everything here is made up for looking at the page:
// the patients, the prescribers, the pharmacy, the doctor, the findings and the letters.
// The "sample criteria" are written for this mock-up: the first ten, and two further ones that
// need a fact a dispensing history does not hold (docs/SPEC.md section 6a). They are not published
// criteria and they are not the criteria the real prototype uses (those come from the server).
import { FACT_WORDS, isFactLine, isPossible, listFacts, missingFactsOf } from '../../shared/facts.ts';
import { findingLines } from '../../shared/lines.ts';
import type {
  Activity,
  AppState,
  CaseRecord,
  CheckResult,
  Criterion,
  CriterionRun,
  CriterionRunStatus,
  FactKind,
  Finding,
  HistoryLine,
  Letter,
  NeededFact,
  PatientHeader,
  ScreenResult,
} from '../../shared/types.ts';
import { JOB_NAMES } from '../lib/modelNames.ts';

export const SAMPLE_CREDIT = 'Sample text written for this mock-up. Not a published criterion.';

/** The last line of every sample letter. It must never read as if a model had written the letter. */
export const SAMPLE_LETTER_LINE = 'Sample letter. It was written by hand for the mock-up of the page. No model drafted it.';
export const SAMPLE_TEMPLATE_LINE =
  'Sample letter. It was written by hand for the mock-up of the page, to show how a letter built from the template looks. No model drafted it.';

/**
 * The last lines of a sample letter, kept apart from its text as the server keeps them for a real
 * one. A real letter says "Drafted by a local AI model." there. In the sample view that would be
 * untrue: no model wrote these letters. So the line says what the letter is.
 */
export function sampleClosing(origin: 'model' | 'template' = 'model'): {
  closingLine: string;
  signatureName: string;
  signatureTitle: string;
  signatureRegistration: string;
} {
  return {
    closingLine: origin === 'model' ? SAMPLE_LETTER_LINE : SAMPLE_TEMPLATE_LINE,
    signatureName: 'Sample Pharmacist (sample signature)',
    signatureTitle: 'Pharmacy Manager (sample)',
    signatureRegistration: 'PHA0000000000 (sample signature)',
  };
}

/** The last lines of a sample letter that is shown as drafted. */
export const SAMPLE_LETTER_CLOSING = sampleClosing('model');

export const MODEL_NAMES = { screen: 'lantern-screen', check: 'lantern-check', letter: 'lantern-letter' } as const;

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

// ---------- the sample criteria ----------

function sample(
  n: number,
  title: string,
  statement: string,
  cannot_be_seen: string,
  ask_the_gp: string,
  /** Only for a criterion that needs a fact: the rule given to the models, and the fact it needs. */
  more: {
    rule?: string;
    needs?: NeededFact[];
    urgency?: 'routine' | 'same_day';
    signed?: { name: string; date: string } | null;
    modification_notice?: string;
  } = {},
): Criterion {
  const criterion: Criterion = {
    id: `SAMPLE-${String(n).padStart(2, '0')}`,
    label: `Sample ${n}`,
    family: 'Sample criteria',
    title,
    statement,
    statement_origin: 'entrant',
    source: {
      document: 'Sample text for the page mock-up',
      citation: 'Written for the mock-up only.',
      licence: 'Not applicable',
      licence_status: 'proposed',
      credit: SAMPLE_CREDIT,
    },
    plain_summary: title,
    medicine_groups: [],
    rule_for_models: more.rule ?? '',
    cannot_be_seen,
    ask_the_gp,
    urgency: more.urgency ?? 'routine',
    draft: more.signed ? false : true,
    signed_by_clinical_reviewer: more.signed ?? null,
  };
  if (more.needs) criterion.needs_facts = more.needs;
  if (more.modification_notice) {
    criterion.source = { ...criterion.source, modification_notice: more.modification_notice };
  }
  return criterion;
}

/** The first ten: each is a pattern of supplies, and a dispensing history holds all it needs. */
const FIRST_TEN: Criterion[] = [
  sample(
    1,
    'Anti-inflammatory with a blood pressure medicine and a fluid tablet',
    'An anti-inflammatory medicine (NSAID) is supplied while the patient also has an ACE inhibitor or a sartan, and a fluid tablet (diuretic). Together the three can harm the kidneys.',
    'A dispensing history does not show kidney test results or blood pressure. It does not show medicines bought without a prescription, or whether the patient still takes each medicine.',
    'a review of the anti-inflammatory medicine',
  ),
  sample(
    2,
    'Two anti-inflammatory medicines together',
    'Two anti-inflammatory medicines (NSAIDs) are supplied for the same weeks.',
    'A dispensing history does not show whether the patient takes both medicines, or was told to stop one.',
    'a review of whether both anti-inflammatory medicines are needed',
  ),
  sample(
    3,
    'Full-dose acid medicine for more than eight weeks',
    'A proton pump inhibitor at full dose is supplied for more than eight weeks in a row.',
    'A dispensing history does not show the reason for the medicine, or whether a lower dose was tried.',
    'a review of the dose of the acid medicine',
  ),
  sample(
    4,
    'Sleeping tablet for more than four weeks',
    'A sleeping tablet (a benzodiazepine or a Z-drug) is supplied for more than four weeks in a row.',
    'A dispensing history does not show how often the patient takes the tablet, or why it was started.',
    'a review of the sleeping tablet',
  ),
  sample(
    5,
    'Opioid with a benzodiazepine',
    'An opioid is supplied while the patient also has a benzodiazepine. Together the two can cause drowsiness and slow breathing.',
    'A dispensing history does not show how much of each medicine the patient takes, or how drowsy the patient is.',
    'a review of the two medicines together',
  ),
  sample(
    6,
    'Two blood thinners together',
    'Two blood thinners (anticoagulants) are supplied for the same weeks.',
    'A dispensing history does not show a planned change from one blood thinner to the other.',
    'a check that only one blood thinner is meant to be taken',
  ),
  sample(
    7,
    'Statin with erythromycin or clarithromycin',
    'Atorvastatin or simvastatin is supplied with erythromycin or clarithromycin. The antibiotic can raise the level of the statin.',
    'A dispensing history does not show whether the patient was told to pause the statin during the antibiotic course.',
    'a check of whether the statin should be paused during the antibiotic course',
  ),
  sample(
    8,
    'Methotrexate with trimethoprim',
    'Methotrexate is supplied with trimethoprim. Together the two can lower blood counts.',
    'A dispensing history does not show blood test results, or whether the patient took the trimethoprim.',
    'a review of this pair of medicines',
  ),
  sample(
    9,
    'Medicines that raise potassium',
    'Two or more medicines that raise potassium are supplied for the same weeks.',
    'A dispensing history does not show potassium or kidney test results.',
    'a review of these medicines together',
  ),
  sample(
    10,
    'Lithium with an anti-inflammatory or a fluid tablet',
    'Lithium is supplied with an anti-inflammatory medicine (NSAID) or a fluid tablet. These can raise the level of lithium.',
    'A dispensing history does not show lithium levels, or whether the patient still takes each medicine.',
    'a review of the added medicine',
  ),
];

/**
 * Two further sample criteria (docs/SPEC.md section 6a). Each needs a fact that a dispensing
 * history does not hold: a test result, and a condition. They are screened after the first ten.
 */
const FURTHER: Criterion[] = [
  sample(
    11,
    'Dabigatran with a low kidney test result',
    'Dabigatran is supplied while the latest kidney test result (eGFR) is below 30 mL/min/1.73 m2. The kidneys clear dabigatran, so the risk of bleeding rises.',
    'A dispensing history does not show kidney test results unless the record lists them. It does not show whether the patient still takes the medicine.',
    'a review of dabigatran and the kidney function',
    {
      rule:
        'Suspect a finding when dabigatran is supplied and the latest eGFR result in the record is below 30. Cite the result line with the supply lines. When the record holds no eGFR result, report a possible finding and name the missing fact.',
      needs: [{ kind: 'result', what: 'eGFR', meets: 'The latest eGFR is below 30 mL/min/1.73 m2.' }],
      // The one sample criterion that is marked for a review on the same day, and the one that is
      // shown as signed. Its finding is a later card of the findings page: the first card of the
      // sample view carries no special state, so it looks like the card of the approved picture.
      urgency: 'same_day',
      signed: { name: 'Sample reviewer (mock-up only)', date: '2026-11-01' },
    },
  ),
  sample(
    12,
    'Pioglitazone in heart failure',
    'Pioglitazone is supplied to a patient who has heart failure. Pioglitazone can make the body hold fluid, which can make heart failure worse.',
    'A dispensing history does not show a diagnosis unless the record lists it. It does not show whether the patient still takes the medicine.',
    'a check of whether the patient has heart failure, and a review of pioglitazone if so',
    {
      rule:
        'Suspect a finding when pioglitazone is supplied and the record lists heart failure as a condition. Cite the condition line with the supply lines. When the record holds no line about heart failure, report a possible finding and name the missing fact.',
      needs: [{ kind: 'condition', what: 'Heart failure', meets: 'The record lists heart failure as a condition.' }],
    },
  ),
];

/** The sample criteria in use, in screening order: the first ten, then the further ones. */
export const SAMPLE_CRITERIA: Criterion[] = [...FIRST_TEN, ...FURTHER];

const C = (n: number): string => SAMPLE_CRITERIA[n - 1].id;

export function criterionById(id: string): Criterion | undefined {
  return SAMPLE_CRITERIA.find((criterion) => criterion.id === id);
}

// ---------- dispensing histories ----------

const GP = 'Dr G. Sample';
const LOCUM = 'Dr H. Locum';

function rx(date: string, medicine: string, qty: number, repeats: number, directions: string, prescriber = GP): string {
  return `${date} | ${medicine} | qty ${qty} | repeats ${repeats} | ${directions} | ${prescriber}`;
}

export function numberLines(rows: string[], page?: number): HistoryLine[] {
  return rows.map((text, i) => {
    const line: HistoryLine = { id: `L${String(i + 1).padStart(3, '0')}`, text };
    if (page !== undefined) line.page = page;
    return line;
  });
}

const COVERSYL = 'Coversyl (perindopril) 5 mg tablet';
const LASIX = 'Lasix (furosemide) 40 mg tablet';
const LIPITOR = 'Lipitor (atorvastatin) 40 mg tablet';
const SOMAC = 'Somac (pantoprazole) 40 mg tablet';
const CELEBREX = 'Celebrex (celecoxib) 200 mg capsule';

const LINES_A = numberLines([
  rx('2026-06-02', COVERSYL, 30, 5, 'Take ONE tablet in the morning'),
  rx('2026-06-02', LASIX, 100, 1, 'Take ONE tablet in the morning'),
  rx('2026-06-02', LIPITOR, 30, 5, 'Take ONE tablet at night'),
  rx('2026-06-16', 'Panadol Osteo (paracetamol) 665 mg tablet', 96, 3, 'Take TWO tablets three times a day'),
  rx('2026-07-01', COVERSYL, 30, 4, 'Take ONE tablet in the morning'),
  rx('2026-07-01', LIPITOR, 30, 4, 'Take ONE tablet at night'),
  rx('2026-07-14', SOMAC, 30, 1, 'Take ONE tablet daily before food'),
  rx('2026-07-30', COVERSYL, 30, 3, 'Take ONE tablet in the morning'),
  rx('2026-07-30', LIPITOR, 30, 3, 'Take ONE tablet at night'),
  rx('2026-08-12', SOMAC, 30, 0, 'Take ONE tablet daily before food'),
  rx('2026-08-21', CELEBREX, 30, 2, 'Take ONE capsule daily with food', LOCUM),
  rx('2026-08-29', COVERSYL, 30, 2, 'Take ONE tablet in the morning'),
  rx('2026-08-29', LIPITOR, 30, 2, 'Take ONE tablet at night'),
  rx('2026-09-09', LASIX, 100, 0, 'Take ONE tablet in the morning'),
  rx('2026-09-18', 'E-Mycin (erythromycin) 400 mg tablet', 25, 0, 'Take ONE tablet four times a day until finished', LOCUM),
  rx('2026-09-20', CELEBREX, 30, 1, 'Take ONE capsule daily with food', LOCUM),
]);

const ELIQUIS = 'Eliquis (apixaban) 5 mg tablet';
const TEMAZE = 'Temaze (temazepam) 10 mg tablet';
const MOBIC = 'Mobic (meloxicam) 15 mg tablet';
const XARELTO = 'Xarelto (rivaroxaban) 20 mg tablet';
const ENDONE = 'Endone (oxycodone) 5 mg tablet';

const LINES_B = numberLines([
  rx('2026-07-06', ELIQUIS, 60, 5, 'Take ONE tablet twice a day'),
  rx('2026-07-06', TEMAZE, 25, 0, 'Take ONE tablet at night when needed'),
  rx('2026-07-20', MOBIC, 30, 2, 'Take ONE tablet daily with food'),
  rx('2026-08-03', TEMAZE, 25, 0, 'Take ONE tablet at night when needed'),
  rx('2026-08-05', ELIQUIS, 60, 4, 'Take ONE tablet twice a day'),
  rx('2026-08-11', 'Brufen (ibuprofen) 400 mg tablet', 30, 0, 'Take ONE tablet three times a day with food', LOCUM),
  rx('2026-08-19', MOBIC, 30, 1, 'Take ONE tablet daily with food'),
  rx('2026-09-01', TEMAZE, 25, 0, 'Take ONE tablet at night when needed'),
  rx('2026-09-04', XARELTO, 28, 5, 'Take ONE tablet daily with food'),
  rx('2026-09-14', ENDONE, 20, 0, 'Take ONE tablet every six hours when needed for pain', LOCUM),
  rx('2026-09-14', 'Valium (diazepam) 5 mg tablet', 50, 0, 'Take ONE tablet at night when needed', LOCUM),
  rx('2026-09-29', TEMAZE, 25, 0, 'Take ONE tablet at night when needed'),
  rx('2026-10-02', XARELTO, 28, 4, 'Take ONE tablet daily with food'),
  rx('2026-10-12', ENDONE, 20, 0, 'Take ONE tablet every six hours when needed for pain', LOCUM),
]);

const LITHICARB = 'Lithicarb (lithium carbonate) 250 mg tablet';
const AVAPRO = 'Avapro (irbesartan) 150 mg tablet';
const METHOBLASTIN = 'Methoblastin (methotrexate) 10 mg tablet';
const VOLTAREN = 'Voltaren (diclofenac) 50 mg tablet';

const LINES_C = numberLines([
  rx('2026-07-08', LITHICARB, 200, 2, 'Take TWO tablets twice a day'),
  rx('2026-07-08', AVAPRO, 30, 5, 'Take ONE tablet daily'),
  rx('2026-07-15', METHOBLASTIN, 15, 2, 'Take ONE tablet ONCE A WEEK on Monday'),
  rx('2026-07-15', 'Megafol (folic acid) 5 mg tablet', 100, 1, 'Take ONE tablet once a week on Thursday'),
  rx('2026-08-06', AVAPRO, 30, 4, 'Take ONE tablet daily'),
  rx('2026-08-06', 'Aldactone (spironolactone) 25 mg tablet', 100, 1, 'Take ONE tablet daily'),
  rx('2026-08-20', 'Span-K (potassium chloride) 600 mg tablet', 200, 0, 'Take ONE tablet twice a day', LOCUM),
  rx('2026-09-03', AVAPRO, 30, 3, 'Take ONE tablet daily'),
  rx('2026-09-10', LITHICARB, 200, 1, 'Take TWO tablets twice a day'),
  rx('2026-09-22', VOLTAREN, 50, 1, 'Take ONE tablet twice a day with food', LOCUM),
  rx('2026-10-01', AVAPRO, 30, 2, 'Take ONE tablet daily'),
  rx('2026-10-07', METHOBLASTIN, 15, 1, 'Take ONE tablet ONCE A WEEK on Monday'),
  rx('2026-10-09', 'Alprim (trimethoprim) 300 mg tablet', 7, 0, 'Take ONE tablet at night for 7 days', LOCUM),
  rx('2026-10-20', VOLTAREN, 50, 0, 'Take ONE tablet twice a day with food', LOCUM),
  rx('2026-10-29', AVAPRO, 30, 1, 'Take ONE tablet daily'),
]);

const LINES_D = numberLines([
  'Dispensing summary | Example Community Pharmacy (fictional)',
  'Medicine | Quantity | Prescriber',
  'Lipitor (atorvastatin) 40 mg tablet | 30 | Dr G. Sample',
  'Coversyl (perindopril) 5 mg tablet | 30 | Dr G. Sample',
]);

const MICARDIS = 'Micardis (telmisartan) 40 mg tablet';
const DIABEX = 'Diabex XR (metformin) 1000 mg tablet';
const NEXIUM = 'Nexium (esomeprazole) 20 mg tablet';
const OXYCONTIN = 'OxyContin (oxycodone) 10 mg modified release tablet';

const LINES_E = numberLines([
  rx('2026-08-03', MICARDIS, 28, 5, 'Take ONE tablet daily'),
  rx('2026-08-03', DIABEX, 60, 5, 'Take TWO tablets with the evening meal'),
  rx('2026-08-17', NEXIUM, 30, 5, 'Take ONE tablet daily'),
  rx('2026-08-31', MICARDIS, 28, 4, 'Take ONE tablet daily'),
  rx('2026-09-02', DIABEX, 60, 4, 'Take TWO tablets with the evening meal'),
  rx('2026-09-15', NEXIUM, 30, 4, 'Take ONE tablet daily'),
  rx('2026-09-21', OXYCONTIN, 28, 0, 'Take ONE tablet twice a day', LOCUM),
  rx('2026-09-21', 'Valium (diazepam) 5 mg tablet', 50, 0, 'Take ONE tablet three times a day when needed', LOCUM),
  rx('2026-09-28', MICARDIS, 28, 3, 'Take ONE tablet daily'),
  rx('2026-10-01', DIABEX, 60, 3, 'Take TWO tablets with the evening meal'),
  rx('2026-10-06', OXYCONTIN, 28, 0, 'Take ONE tablet twice a day', LOCUM),
  rx('2026-10-14', NEXIUM, 30, 3, 'Take ONE tablet daily'),
]);

const NORMISON = 'Normison (temazepam) 10 mg tablet';
const ZOCOR = 'Zocor (simvastatin) 20 mg tablet';

const LINES_F = numberLines(
  [
    rx('2026-07-10', NORMISON, 25, 0, 'Take ONE tablet at night'),
    rx('2026-07-10', ZOCOR, 30, 5, 'Take ONE tablet at night'),
    rx('2026-08-07', NORMISON, 25, 0, 'Take ONE tablet at night'),
    rx('2026-08-09', ZOCOR, 30, 4, 'Take ONE tablet at night'),
    rx('2026-08-24', 'Ventolin (salbutamol) 100 microgram inhaler', 2, 5, 'TWO puffs when needed'),
    rx('2026-09-04', NORMISON, 25, 0, 'Take ONE tablet at night'),
    rx('2026-09-08', ZOCOR, 30, 3, 'Take ONE tablet at night'),
    rx('2026-10-02', NORMISON, 25, 0, 'Take ONE tablet at night'),
    rx('2026-10-07', ZOCOR, 30, 2, 'Take ONE tablet at night'),
  ],
  1,
);

// A record that also carries facts (docs/SPEC.md section 6a): a condition, a test result and a
// measurement sit among the supplies, in file order. It holds no line about heart failure.
// A fact line is written the way the server writes it: the date, the kind in capitals, the fact.
function fact(date: string, kind: FactKind, what: string): string {
  return `${date} | ${FACT_WORDS[kind]} | ${what}`;
}

const PRADAXA = 'Pradaxa (dabigatran) 110 mg capsule';
const ACTOS = 'Actos (pioglitazone) 30 mg tablet';

const LINES_G = numberLines([
  fact('2026-05-12', 'condition', 'Type 2 diabetes'),
  rx('2026-07-02', PRADAXA, 60, 5, 'Take ONE capsule twice a day'),
  rx('2026-07-02', ACTOS, 28, 5, 'Take ONE tablet daily'),
  rx('2026-07-02', LASIX, 100, 1, 'Take ONE tablet in the morning'),
  rx('2026-07-31', PRADAXA, 60, 4, 'Take ONE capsule twice a day'),
  rx('2026-07-31', ACTOS, 28, 4, 'Take ONE tablet daily'),
  rx('2026-08-29', PRADAXA, 60, 3, 'Take ONE capsule twice a day'),
  rx('2026-08-29', ACTOS, 28, 3, 'Take ONE tablet daily'),
  rx('2026-09-28', PRADAXA, 60, 2, 'Take ONE capsule twice a day'),
  rx('2026-09-28', ACTOS, 28, 2, 'Take ONE tablet daily'),
  fact('2026-10-06', 'result', 'eGFR 28 mL/min/1.73 m2'),
  fact('2026-10-06', 'observation', 'Blood pressure 168/94 mmHg'),
  rx('2026-10-09', LASIX, 100, 0, 'Take ONE tablet in the morning'),
  rx('2026-10-27', PRADAXA, 60, 1, 'Take ONE capsule twice a day'),
  rx('2026-10-27', ACTOS, 28, 1, 'Take ONE tablet daily'),
]);

// ---------- the words of the letters ----------

export interface LetterParts {
  finding: string;
  evidence: string;
  request: string;
}

const LETTER_PARTS: Record<string, LetterParts> = {
  F0001: {
    finding:
      'While looking at the dispensing history for this patient, I saw an anti-inflammatory medicine supplied while the patient also has an ACE inhibitor and a fluid tablet.',
    evidence:
      'Celebrex (celecoxib) 200 mg was supplied on 21 August and 20 September 2026. Coversyl (perindopril) 5 mg was supplied on 29 August 2026. Lasix (furosemide) 40 mg was supplied on 9 September 2026.',
    request:
      'Could you please review the anti-inflammatory medicine when you next see the patient? A kidney function test may help your review.',
  },
  F0002: {
    finding:
      'While looking at the dispensing history for this patient, I saw erythromycin supplied while the patient also has atorvastatin.',
    evidence:
      'Lipitor (atorvastatin) 40 mg was supplied on 29 August 2026. E-Mycin (erythromycin) 400 mg was supplied on 18 September 2026.',
    request: 'Could you please check whether the statin should be paused during the antibiotic course?',
  },
  F0004: {
    finding:
      'While looking at the dispensing history for this patient, I saw an opioid and a benzodiazepine supplied for the same weeks.',
    evidence:
      'Endone (oxycodone) 5 mg was supplied on 14 September and 12 October 2026. Valium (diazepam) 5 mg was supplied on 14 September 2026.',
    request:
      'Could you please review the two medicines together when you next see the patient? I am happy to help with any change you decide on.',
  },
  F0005: {
    finding:
      'While looking at the dispensing history for this patient, I saw a sleeping tablet supplied each month for four months.',
    evidence:
      'Temaze (temazepam) 10 mg, 25 tablets, was supplied on 6 July, 3 August, 1 September and 29 September 2026.',
    request: 'Could you please review the sleeping tablet at the next visit?',
  },
  F0006: {
    finding:
      'While looking at the dispensing history for this patient, I saw two anti-inflammatory medicines supplied for the same weeks.',
    evidence:
      'Mobic (meloxicam) 15 mg was supplied on 20 July and 19 August 2026. Brufen (ibuprofen) 400 mg was supplied on 11 August 2026.',
    request: 'Could you please review whether both medicines are needed?',
  },
  F0008: {
    finding:
      'While looking at the dispensing history for this patient, I saw an anti-inflammatory medicine supplied while the patient also has lithium.',
    evidence:
      'Lithicarb (lithium carbonate) 250 mg was supplied on 10 September 2026. Voltaren (diclofenac) 50 mg was supplied on 22 September and 20 October 2026.',
    request:
      'Could you please review the anti-inflammatory medicine when you next see the patient? A lithium level may help your review.',
  },
  F0009: {
    finding:
      'While looking at the dispensing history for this patient, I saw trimethoprim supplied while the patient also has methotrexate.',
    evidence:
      'Methoblastin (methotrexate) 10 mg was supplied on 7 October 2026. Alprim (trimethoprim) 300 mg was supplied on 9 October 2026.',
    request: 'Could you please review this pair of medicines? A blood count may help your review.',
  },
  F0010: {
    finding:
      'While looking at the dispensing history for this patient, I saw three medicines that can raise potassium supplied for the same weeks.',
    evidence:
      'Avapro (irbesartan) 150 mg and Aldactone (spironolactone) 25 mg were supplied on 6 August 2026. Span-K (potassium chloride) 600 mg was supplied on 20 August 2026.',
    request:
      'Could you please review these medicines together? A potassium and kidney function test may help your review.',
  },
  F0011: {
    finding:
      'While looking at the dispensing history for this patient, I saw an anti-inflammatory medicine supplied while the patient also has a sartan and a fluid tablet.',
    evidence:
      'Voltaren (diclofenac) 50 mg was supplied on 22 September 2026. Avapro (irbesartan) 150 mg was supplied on 1 October 2026. Aldactone (spironolactone) 25 mg was supplied on 6 August 2026.',
    request:
      'Could you please review the anti-inflammatory medicine when you next see the patient? A kidney function test may help your review.',
  },
  // A finding that rests on a test result in the record.
  F0012: {
    finding:
      'While looking at the record for this patient, I saw dabigatran supplied while the latest kidney test result is below 30 mL/min/1.73 m2.',
    evidence:
      'Pradaxa (dabigatran) 110 mg was supplied on 28 September and 27 October 2026. Our record shows an eGFR of 28 mL/min/1.73 m2 on 6 October 2026.',
    request: 'Could you please review dabigatran and the kidney function when you next see the patient?',
  },
  // A possible finding: the letter asks the doctor to confirm the fact the record does not show.
  F0013: {
    finding:
      'While looking at the dispensing history for this patient, I saw pioglitazone supplied each month. Our record does not show whether the patient has heart failure.',
    evidence: 'Actos (pioglitazone) 30 mg was supplied on 28 September and 27 October 2026.',
    request: 'Could you please confirm whether the patient has heart failure? If so, could you please review pioglitazone?',
  },
  // The two findings that appear while the sample view runs (see SCRIPTED below).
  F0014: {
    finding:
      'While looking at the dispensing history for this patient, I saw an opioid and a benzodiazepine supplied for the same weeks.',
    evidence:
      'OxyContin (oxycodone) 10 mg was supplied on 21 September and 6 October 2026. Valium (diazepam) 5 mg was supplied on 21 September 2026.',
    request: 'Could you please review the two medicines together when you next see the patient?',
  },
  F0015: {
    finding:
      'While looking at the dispensing history for this patient, I saw a sleeping tablet supplied each month for four months.',
    evidence:
      'Normison (temazepam) 10 mg, 25 tablets, was supplied on 10 July, 7 August, 4 September and 2 October 2026.',
    request: 'Could you please review the sleeping tablet at the next visit?',
  },
};

const longDate = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

function patientLine(patient: PatientHeader): string {
  const bits = [patient.label];
  if (patient.age !== undefined) bits.push(`age ${patient.age}`);
  if (patient.sex === 'F') bits.push('female');
  else if (patient.sex === 'M') bits.push('male');
  else if (patient.sex) bits.push(patient.sex);
  return bits.join(', ');
}

/** The subject of a sample letter. For a possible finding it starts with those words, as a real letter does. */
export function letterSubject(caseRecord: CaseRecord, criterion: Criterion, finding?: Finding): string {
  const about = `${caseRecord.patient.label} (${criterion.label})`;
  return finding && isPossible(finding)
    ? `Possible finding, request for a medicines review: ${about}`
    : `Request for a medicines review: ${about}`;
}

/** The whole letter as text, laid out the way docs/SPEC.md section 7.3 describes. */
export function buildLetterBody(
  caseRecord: CaseRecord,
  finding: Finding,
  criterion: Criterion,
  atIso: string,
  origin: 'model' | 'template',
): string {
  const parts: LetterParts = LETTER_PARTS[finding.id] ?? {
    finding: `While looking at the dispensing history for this patient, I saw supplies that match this criterion: ${criterion.title}.`,
    evidence: 'The dispensing lines are listed below.',
    request: `Could you please consider ${criterion.ask_the_gp} when you next see the patient?`,
  };
  // The same lines the real page and the real letter use (shared/lines.ts).
  const ids = findingLines(finding).all;
  const cited = caseRecord.lines.filter((line) => ids.includes(line.id));
  // A condition or a result among the cited lines is not a dispensing line, so the heading says "lines".
  const linesTitle = cited.some((line) => isFactLine(line.text)) ? 'Lines from our records' : 'Dispensing lines from our records';
  const cannot = criterion.cannot_be_seen || finding.check?.whatCannotBeSeen || '';
  // A possible finding says so before the letter starts, in the words a real letter uses.
  const missing = isPossible(finding) ? missingFactsOf(finding) : [];
  const notShown = missing.length > 0 ? [`The record we hold does not show: ${listFacts(missing)}.`] : [];

  // Laid out like a real letter (pipeline/letter.ts), so the sample view shows the page as it is.
  // It ends as a real letter ends: "Yours sincerely,", the line about who wrote the words, and the
  // three lines of the signature. Here that line says what is true: the words were written by hand
  // for the mock-up, not by a model.
  const closing = sampleClosing(origin);
  return [
    'Example Community Pharmacy (fictional)',
    '1 Example Street, Exampletown',
    'Phone: (00) 0000 0000',
    'Pharmacist: The pharmacist on duty',
    '',
    longDate.format(new Date(atIso)),
    '',
    'To: Dr F. Example (fictional)',
    'Example Family Practice',
    '',
    `Patient: ${patientLine(caseRecord.patient)}`,
    'Fictional patient. No real person.',
    '',
    `Re: ${letterSubject(caseRecord, criterion, finding)}`,
    ...notShown,
    '',
    'Dear Doctor,',
    '',
    parts.finding,
    '',
    parts.evidence,
    '',
    parts.request,
    '',
    'The criterion this is based on',
    `${criterion.label}: ${criterion.statement}`,
    `Source: ${criterion.source.credit}`,
    '',
    linesTitle,
    ...cited.map((line) => line.text),
    '',
    'What a dispensing history cannot show',
    cannot,
    '',
    'Yours sincerely,',
    '',
    closing.closingLine,
    closing.signatureName,
    closing.signatureTitle,
    closing.signatureRegistration,
  ].join('\n');
}

// ---------- findings that appear while the sample view runs ----------

export interface ScriptedFinding {
  screen: Pick<ScreenResult, 'lineIds' | 'medicines' | 'reason'>;
  check: Pick<CheckResult, 'confirmed' | 'lineIds' | 'whatMatches' | 'whatCannotBeSeen'>;
}

/** Keyed by "caseId:criterionId". Used when the sample view finishes a screening on its own clock. */
export const SCRIPTED: Record<string, ScriptedFinding> = {
  [`C0005:${C(5)}`]: {
    screen: {
      lineIds: ['L007', 'L008', 'L011'],
      medicines: ['oxycodone', 'diazepam'],
      reason:
        'OxyContin (oxycodone) and Valium (diazepam) were both supplied on 21 September 2026. OxyContin was supplied again on 6 October 2026.',
    },
    check: {
      confirmed: true,
      lineIds: ['L007', 'L008', 'L011'],
      whatMatches:
        'OxyContin (oxycodone) 10 mg was supplied on 21 September and 6 October 2026 (L007, L011). Valium (diazepam) 5 mg, 50 tablets, was supplied on 21 September 2026 (L008). The two supplies cover the same weeks.',
      whatCannotBeSeen:
        'The history does not show how much of each medicine the patient takes, or how drowsy the patient is.',
    },
  },
  [`C0006:${C(4)}`]: {
    screen: {
      lineIds: ['L001', 'L003', 'L006', 'L008'],
      medicines: ['temazepam'],
      reason: 'Normison (temazepam) 10 mg was supplied in July, August, September and October 2026.',
    },
    check: {
      confirmed: true,
      lineIds: ['L001', 'L003', 'L006', 'L008'],
      whatMatches:
        'Normison (temazepam) 10 mg, 25 tablets, was supplied on 10 July, 7 August, 4 September and 2 October 2026 (L001, L003, L006, L008). That is four supplies about four weeks apart.',
      whatCannotBeSeen:
        'The history does not show how often the patient takes the tablet, or why it was started. The rows were read from a scan.',
    },
  },
};

// ---------- the starting state ----------

function runs(statuses: Partial<Record<string, CriterionRunStatus>>, fallback: CriterionRunStatus): CriterionRun[] {
  return SAMPLE_CRITERIA.map((criterion, i) => {
    const status = statuses[criterion.id] ?? fallback;
    const run: CriterionRun = { criterionId: criterion.id, status };
    if (status === 'clear' || status === 'suspected') run.seconds = 5.2 + ((i * 7) % 10) / 6;
    if (status === 'failed') {
      run.seconds = 21.4;
      run.error = 'The model did not answer twice in a row.';
    }
    return run;
  });
}

interface FindingSeed {
  id: string;
  caseId: string;
  criterion: number;
  state: Finding['state'];
  lineIds: string[];
  medicines: string[];
  reason: string;
  whatMatches?: string;
  whatCannotBeSeen?: string;
  checkLineIds?: string[];
  checkCompleted?: boolean;
  seen?: boolean;
  bypassReason?: string;
  linesVerified?: boolean;
  dismiss?: boolean;
  /** A possible finding: the medicines match, and the record holds no line about the fact named here. */
  missingFacts?: string[];
}

/** Sample data whose times are counted back from `nowMs`, so "overdue" stays overdue on any day. */
export function makeFixture(nowMs: number): AppState {
  const ago = (days: number, hours = 0): string => new Date(nowMs - days * DAY - hours * HOUR).toISOString();
  const ahead = (days: number): string => new Date(nowMs + days * DAY).toISOString();

  const cases: CaseRecord[] = [
    {
      id: 'C0001',
      fileName: 'fictional-patient-a.csv',
      importedAt: ago(0, 1),
      source: 'csv',
      patient: { label: 'Fictional patient A', age: 74, sex: 'F' },
      lines: LINES_A,
      transcriptionConfirmed: true,
      parts: 1,
      screening: {
        status: 'done',
        criteria: runs({ [C(1)]: 'suspected', [C(3)]: 'suspected', [C(7)]: 'suspected' }, 'clear'),
        startedAt: ago(0, 1),
        finishedAt: ago(0, 0.97),
      },
    },
    {
      id: 'C0002',
      fileName: 'fictional-patient-b.csv',
      importedAt: ago(21),
      source: 'csv',
      patient: { label: 'Fictional patient B', age: 81, sex: 'M' },
      lines: LINES_B,
      transcriptionConfirmed: true,
      parts: 3,
      screening: {
        status: 'done',
        criteria: runs({ [C(2)]: 'suspected', [C(4)]: 'suspected', [C(5)]: 'suspected', [C(6)]: 'suspected' }, 'clear'),
        startedAt: ago(21),
        finishedAt: ago(21),
      },
    },
    {
      id: 'C0003',
      fileName: 'fictional-patient-c.csv',
      importedAt: ago(2),
      source: 'csv',
      patient: { label: 'Fictional patient C', age: 68, sex: 'F' },
      lines: LINES_C,
      transcriptionConfirmed: true,
      parts: 1,
      screening: {
        status: 'done',
        criteria: runs(
          { [C(1)]: 'suspected', [C(6)]: 'failed', [C(8)]: 'suspected', [C(9)]: 'suspected', [C(10)]: 'suspected' },
          'clear',
        ),
        startedAt: ago(2),
        finishedAt: ago(2),
      },
    },
    {
      id: 'C0004',
      fileName: 'summary-without-dates.pdf',
      importedAt: ago(0, 3),
      source: 'pdf-text',
      patient: { label: 'Fictional patient D' },
      lines: LINES_D,
      cannotAssess: 'No dispensing dates were found. Each row needs a date.',
      transcriptionConfirmed: true,
      parts: 1,
      screening: { status: 'not_started', criteria: [] },
    },
    {
      id: 'C0005',
      fileName: 'fictional-patient-e.csv',
      importedAt: ago(0, 0.01),
      source: 'csv',
      patient: { label: 'Fictional patient E', age: 59, sex: 'M' },
      lines: LINES_E,
      transcriptionConfirmed: true,
      parts: 1,
      screening: {
        status: 'running',
        criteria: runs({ [C(1)]: 'clear', [C(2)]: 'clear', [C(3)]: 'clear', [C(4)]: 'running' }, 'waiting'),
        startedAt: ago(0, 0.008),
      },
    },
    {
      id: 'C0006',
      fileName: 'scan-fictional-patient-f.pdf',
      importedAt: ago(0, 0.3),
      source: 'pdf-image',
      patient: { label: 'Fictional patient F' },
      lines: LINES_F,
      transcriptionConfirmed: false,
      pages: 1,
      parts: 1,
      screening: { status: 'not_started', criteria: [] },
    },
    // A record that also lists a condition, a test result and a measurement (docs/SPEC.md section 6a).
    {
      id: 'C0007',
      fileName: 'fictional-patient-g.csv',
      importedAt: ago(0, 2),
      source: 'csv',
      patient: { label: 'Fictional patient G', age: 77, sex: 'M' },
      lines: LINES_G,
      transcriptionConfirmed: true,
      parts: 1,
      screening: {
        status: 'done',
        criteria: runs({ [C(11)]: 'suspected', [C(12)]: 'suspected' }, 'clear'),
        startedAt: ago(0, 2),
        finishedAt: ago(0, 1.98),
      },
    },
  ];

  const seeds: FindingSeed[] = [
    {
      id: 'F0001',
      caseId: 'C0001',
      criterion: 1,
      state: 'confirmed',
      lineIds: ['L011', 'L012', 'L014', 'L016'],
      medicines: ['celecoxib', 'perindopril', 'furosemide'],
      reason:
        'Celebrex (celecoxib) is supplied in August and September 2026. Coversyl (perindopril) and Lasix (furosemide) are supplied in the same weeks.',
      whatMatches:
        'Celebrex (celecoxib) 200 mg was supplied on 21 August and 20 September 2026 (L011, L016). Coversyl (perindopril) 5 mg was supplied on 29 August 2026 (L012). Lasix (furosemide) 40 mg was supplied on 9 September 2026 (L014). All three cover the same weeks.',
      whatCannotBeSeen:
        'The history does not show kidney test results or blood pressure. It does not show whether the patient still takes each medicine.',
    },
    {
      id: 'F0002',
      caseId: 'C0001',
      criterion: 7,
      state: 'confirmed',
      lineIds: ['L013', 'L015'],
      medicines: ['atorvastatin', 'erythromycin'],
      reason:
        'Lipitor (atorvastatin) 40 mg was supplied on 29 August 2026. E-Mycin (erythromycin) 400 mg was supplied on 18 September 2026, while the atorvastatin supply was still running.',
      checkCompleted: false,
    },
    {
      id: 'F0003',
      caseId: 'C0001',
      criterion: 3,
      state: 'not_confirmed',
      lineIds: ['L007', 'L010'],
      medicines: ['pantoprazole'],
      reason: 'Somac (pantoprazole) 40 mg was supplied in July and in August 2026.',
      whatMatches:
        'Two supplies of Somac (pantoprazole) 40 mg are seen, on 14 July and 12 August 2026. That is about eight weeks. The rule needs more than eight weeks in a row.',
      whatCannotBeSeen: 'The history does not show whether the patient was told to stop after the second supply.',
      seen: true,
    },
    {
      id: 'F0016',
      caseId: 'C0001',
      criterion: 3,
      state: 'not_confirmed',
      lineIds: ['L007'],
      medicines: ['pantoprazole'],
      reason: 'Somac (pantoprazole) was supplied for several weeks. The pharmacist dismissed this after review.',
      whatMatches: 'The supplies do not meet the sample rule for this mock-up.',
      dismiss: true,
      seen: true,
    },
    {
      id: 'F0004',
      caseId: 'C0002',
      criterion: 5,
      state: 'accepted',
      lineIds: ['L010', 'L011', 'L014'],
      medicines: ['oxycodone', 'diazepam'],
      reason: 'Endone (oxycodone) and Valium (diazepam) were both supplied on 14 September 2026.',
      whatMatches:
        'Endone (oxycodone) 5 mg was supplied on 14 September and 12 October 2026 (L010, L014). Valium (diazepam) 5 mg was supplied on 14 September 2026 (L011).',
      whatCannotBeSeen: 'The history does not show how much of each medicine the patient takes.',
      seen: true,
    },
    {
      id: 'F0005',
      caseId: 'C0002',
      criterion: 4,
      state: 'accepted',
      lineIds: ['L002', 'L004', 'L008', 'L012'],
      medicines: ['temazepam'],
      reason: 'Temaze (temazepam) 10 mg was supplied each month from July to September 2026.',
      whatMatches:
        'Temaze (temazepam) 10 mg, 25 tablets, was supplied on 6 July, 3 August, 1 September and 29 September 2026 (L002, L004, L008, L012).',
      whatCannotBeSeen: 'The history does not show how often the patient takes the tablet.',
      seen: true,
    },
    {
      id: 'F0006',
      caseId: 'C0002',
      criterion: 2,
      state: 'accepted',
      lineIds: ['L003', 'L006', 'L007'],
      medicines: ['meloxicam', 'ibuprofen'],
      reason: 'Mobic (meloxicam) and Brufen (ibuprofen) were both supplied in August 2026.',
      whatMatches:
        'Mobic (meloxicam) 15 mg was supplied on 20 July and 19 August 2026 (L003, L007). Brufen (ibuprofen) 400 mg was supplied on 11 August 2026 (L006).',
      whatCannotBeSeen: 'The history does not show whether the patient was told to stop one of the two.',
      seen: true,
    },
    {
      id: 'F0007',
      caseId: 'C0002',
      criterion: 6,
      state: 'bypassed',
      lineIds: ['L005', 'L009'],
      medicines: ['apixaban', 'rivaroxaban'],
      reason: 'Eliquis (apixaban) was supplied on 5 August 2026 and Xarelto (rivaroxaban) on 4 September 2026.',
      whatMatches:
        'Eliquis (apixaban) 5 mg, 60 tablets, was supplied on 5 August 2026 (L005). Xarelto (rivaroxaban) 20 mg was supplied on 4 September 2026 (L009). The Eliquis supply may still have been running.',
      whatCannotBeSeen: 'The history does not show a planned change from one blood thinner to the other.',
      seen: true,
      bypassReason: 'Planned change from Eliquis to Xarelto. The doctor wrote this on the new prescription.',
    },
    {
      id: 'F0008',
      caseId: 'C0003',
      criterion: 10,
      state: 'accepted',
      lineIds: ['L009', 'L010', 'L014'],
      medicines: ['lithium', 'diclofenac'],
      reason: 'Lithicarb (lithium carbonate) and Voltaren (diclofenac) were both supplied in September 2026.',
      whatMatches:
        'Lithicarb (lithium carbonate) 250 mg was supplied on 10 September 2026 (L009). Voltaren (diclofenac) 50 mg was supplied on 22 September and 20 October 2026 (L010, L014).',
      whatCannotBeSeen: 'The history does not show lithium levels, or whether the patient still takes each medicine.',
      seen: true,
    },
    {
      id: 'F0009',
      caseId: 'C0003',
      criterion: 8,
      state: 'accepted',
      lineIds: ['L012', 'L013'],
      medicines: ['methotrexate', 'trimethoprim'],
      reason: 'Methoblastin (methotrexate) and Alprim (trimethoprim) were supplied two days apart in October 2026.',
      whatMatches:
        'Methoblastin (methotrexate) 10 mg was supplied on 7 October 2026 (L012). Alprim (trimethoprim) 300 mg was supplied on 9 October 2026 (L013).',
      whatCannotBeSeen: 'The history does not show blood test results, or whether the patient took the trimethoprim.',
      seen: true,
    },
    {
      id: 'F0010',
      caseId: 'C0003',
      criterion: 9,
      state: 'accepted',
      lineIds: ['L005', 'L006', 'L007'],
      medicines: ['irbesartan', 'spironolactone', 'potassium chloride'],
      reason: 'Avapro (irbesartan), Aldactone (spironolactone) and Span-K (potassium chloride) were supplied in August 2026.',
      whatMatches:
        'Avapro (irbesartan) 150 mg and Aldactone (spironolactone) 25 mg were supplied on 6 August 2026 (L005, L006). Span-K (potassium chloride) 600 mg was supplied on 20 August 2026 (L007).',
      whatCannotBeSeen: 'The history does not show potassium or kidney test results.',
      seen: true,
    },
    {
      id: 'F0011',
      caseId: 'C0003',
      criterion: 1,
      state: 'accepted',
      lineIds: ['L006', 'L010', 'L011'],
      medicines: ['diclofenac', 'irbesartan', 'spironolactone'],
      reason: 'Voltaren (diclofenac) was supplied while Avapro (irbesartan) and Aldactone (spironolactone) were running.',
      whatMatches:
        'Voltaren (diclofenac) 50 mg was supplied on 22 September 2026 (L010). Avapro (irbesartan) 150 mg was supplied on 1 October 2026 (L011). Aldactone (spironolactone) 25 mg, 100 tablets, was supplied on 6 August 2026 (L006).',
      whatCannotBeSeen: 'The history does not show kidney test results or blood pressure.',
      seen: true,
    },
    // The record holds the fact and it meets the criterion: a finding, and the result line is cited with the supplies.
    {
      id: 'F0012',
      caseId: 'C0007',
      criterion: 11,
      state: 'confirmed',
      lineIds: ['L009', 'L011', 'L014'],
      medicines: ['dabigatran'],
      reason:
        'Pradaxa (dabigatran) is supplied each month. The record shows an eGFR of 28 mL/min/1.73 m2 on 6 October 2026, and Pradaxa was supplied again on 27 October 2026.',
      whatMatches:
        'Pradaxa (dabigatran) 110 mg was supplied on 28 September and 27 October 2026 (L009, L014). The record shows an eGFR of 28 mL/min/1.73 m2 on 6 October 2026 (L011). That is below 30.',
      whatCannotBeSeen: 'The record does not show whether the test was repeated, or whether the patient still takes the medicine.',
    },
    // The medicines match and the record holds no line about the fact: a possible finding.
    // It also shows "Lines not verified": the first model named no line of this history, as the
    // real server records it (no line IDs, linesVerified false). The second check named the lines.
    {
      id: 'F0013',
      caseId: 'C0007',
      criterion: 12,
      state: 'confirmed',
      lineIds: [],
      linesVerified: false,
      checkLineIds: ['L010', 'L015'],
      medicines: ['pioglitazone'],
      reason: 'Actos (pioglitazone) is supplied each month. The record holds no line about heart failure.',
      missingFacts: ['a diagnosis of heart failure'],
      whatMatches:
        'Actos (pioglitazone) 30 mg was supplied on 28 September and 27 October 2026 (L010, L015). The record holds no line about heart failure, so this is a possible finding.',
      whatCannotBeSeen:
        'The record does not show whether the patient has heart failure. Lasix (furosemide) is also supplied, but the record does not say why.',
    },
  ];

  const caseTime = (caseId: string): string => cases.find((c) => c.id === caseId)?.importedAt ?? ago(0);

  const findings: Finding[] = seeds.map((seed) => {
    const at = caseTime(seed.caseId);
    const missingFacts = seed.missingFacts ?? [];
    const finding: Finding = {
      id: seed.id,
      caseId: seed.caseId,
      criterionId: C(seed.criterion),
      state: seed.state,
      possible: missingFacts.length > 0,
      screen: {
        lineIds: seed.lineIds,
        medicines: seed.medicines,
        reason: seed.reason,
        linesVerified: seed.linesVerified ?? true,
        missingFacts,
        model: MODEL_NAMES.screen,
        at,
        seconds: 6.1,
      },
      seenByPharmacist: seed.seen ?? false,
    };
    if (seed.checkCompleted === false) {
      finding.check = {
        confirmed: true,
        lineIds: [],
        whatMatches: '',
        whatCannotBeSeen: '',
        completed: false,
        model: MODEL_NAMES.check,
        at,
        seconds: 18.6,
      };
    } else {
      finding.check = {
        confirmed: seed.state !== 'not_confirmed',
        lineIds: seed.checkLineIds ?? seed.lineIds,
        whatMatches: seed.whatMatches ?? '',
        whatCannotBeSeen: seed.whatCannotBeSeen ?? '',
        completed: true,
        model: MODEL_NAMES.check,
        at,
        seconds: 9.2,
      };
    }
    if (seed.state === 'accepted') {
      finding.decision = { action: 'accept', by: 'The pharmacist on duty', at };
    }
    if (seed.state === 'bypassed') {
      finding.decision = { action: 'bypass', reason: seed.bypassReason, by: 'The pharmacist on duty', at };
    }
    if (seed.dismiss) {
      finding.decision = { action: 'dismiss', reason: 'Reviewed and dismissed in the sample data.', by: 'The pharmacist on duty', at };
    }
    return finding;
  });

  const draftFor = (findingId: string, atIso: string, origin: 'model' | 'template', checkNotes: string[] = []) => {
    const finding = findings.find((f) => f.id === findingId)!;
    const caseRecord = cases.find((c) => c.id === finding.caseId)!;
    const criterion = criterionById(finding.criterionId)!;
    const subject = letterSubject(caseRecord, criterion, finding);
    const body = buildLetterBody(caseRecord, finding, criterion, atIso, origin);
    return {
      subject,
      body,
      draft: { subject, body, origin, checkNotes, model: MODEL_NAMES.letter, at: atIso, seconds: 2.3 },
      // The last lines of the letter, apart from the text the pharmacist edits.
      ...sampleClosing(origin),
    };
  };

  const t1 = draftFor('F0004', ago(10, 2), 'model');
  const t2 = draftFor('F0005', ago(12, 3), 'model');
  const t3 = draftFor('F0006', ago(20, 2), 'model');
  // The letter that opens first. It is one page long and fits an email draft, as in the approved picture.
  const t4 = draftFor('F0008', ago(0, 0.2), 'model');
  const t6 = draftFor('F0010', ago(1, 3), 'model');
  // The other ready letter is longer than an email draft can hold (the text of its criterion and
  // its last lines are longer), so its preview shows the note about the short cover note.
  const t7 = draftFor('F0011', ago(0, 5), 'template', [
    'The first draft gave a date that is not in the dispensing lines: 12 October 2026.',
    'The second draft gave a strength that is not in the dispensing lines: 75 mg.',
  ]);

  const letters: Letter[] = [
    {
      id: 'T0001',
      findingId: 'F0004',
      caseId: 'C0002',
      status: 'sent',
      ...t1,
      editedByPharmacist: false,
      patientAgreed: { at: ago(10, 1) },
      sentAt: ago(10),
      sentBy: 'print',
      dueAt: ago(3),
      seenByPharmacist: true,
    },
    {
      id: 'T0002',
      findingId: 'F0005',
      caseId: 'C0002',
      status: 'reply_recorded',
      ...t2,
      editedByPharmacist: true,
      patientAgreed: { at: ago(12, 2) },
      sentAt: ago(12),
      sentBy: 'email',
      dueAt: ago(5),
      reply: {
        at: ago(6),
        outcome: 'will_review',
        note: 'The practice nurse rang. The doctor will see the patient next week to talk about the sleeping tablet.',
      },
      seenByPharmacist: true,
    },
    {
      id: 'T0003',
      findingId: 'F0006',
      caseId: 'C0002',
      status: 'closed',
      ...t3,
      editedByPharmacist: false,
      patientAgreed: { at: ago(20, 1) },
      sentAt: ago(20),
      sentBy: 'print',
      dueAt: ago(13),
      reply: {
        at: ago(15),
        outcome: 'changed',
        note: 'The doctor stopped the Brufen. The patient keeps the Mobic.',
      },
      closedAt: ago(14),
      seenByPharmacist: true,
    },
    {
      id: 'T0004',
      findingId: 'F0008',
      caseId: 'C0003',
      status: 'ready',
      ...t4,
      editedByPharmacist: false,
      seenByPharmacist: false,
    },
    {
      id: 'T0005',
      findingId: 'F0009',
      caseId: 'C0003',
      status: 'drafting',
      subject: '',
      body: '',
      ...SAMPLE_LETTER_CLOSING,
      editedByPharmacist: false,
      seenByPharmacist: false,
    },
    {
      id: 'T0006',
      findingId: 'F0010',
      caseId: 'C0003',
      status: 'sent',
      ...t6,
      editedByPharmacist: false,
      patientAgreed: { at: ago(1, 1) },
      sentAt: ago(1),
      sentBy: 'email',
      dueAt: ahead(6),
      seenByPharmacist: true,
    },
    {
      id: 'T0007',
      findingId: 'F0011',
      caseId: 'C0003',
      status: 'ready',
      ...t7,
      editedByPharmacist: false,
      seenByPharmacist: true,
    },
  ];

  const activity: Activity[] = [
    { at: ago(21), kind: 'import', text: 'Imported fictional-patient-b.csv. 14 lines.', caseId: 'C0002' },
    { at: ago(20), kind: 'letter_status', text: 'Letter T0003 marked as sent by print.', letterId: 'T0003' },
    { at: ago(15), kind: 'letter_status', text: 'Reply recorded for letter T0003: the doctor changed the medicines.', letterId: 'T0003' },
    { at: ago(14), kind: 'letter_status', text: 'Letter T0003 closed.', letterId: 'T0003' },
    {
      at: ago(13),
      kind: 'decision',
      text: 'The pharmacist bypassed Sample 6. Reason: Planned change from Eliquis to Xarelto. The doctor wrote this on the new prescription.',
      findingId: 'F0007',
      criterionId: C(6),
    },
    { at: ago(12), kind: 'letter_status', text: 'Letter T0002 marked as sent by email.', letterId: 'T0002' },
    { at: ago(10), kind: 'letter_status', text: 'Letter T0001 marked as sent by print.', letterId: 'T0001' },
    { at: ago(6), kind: 'letter_status', text: 'Reply recorded for letter T0002: the doctor will review the patient.', letterId: 'T0002' },
    { at: ago(2), kind: 'import', text: 'Imported fictional-patient-c.csv. 15 lines.', caseId: 'C0003' },
    {
      at: ago(2),
      kind: 'error',
      text: 'Sample 6 could not be screened on fictional-patient-c.csv. The model did not answer twice in a row.',
      model: MODEL_NAMES.screen,
      caseId: 'C0003',
      criterionId: C(6),
    },
    { at: ago(1), kind: 'letter_status', text: 'Letter T0006 marked as sent by email.', letterId: 'T0006' },
    { at: ago(0, 5), kind: 'letter', text: 'Sample: letter T0007 is shown as built from the template.', model: MODEL_NAMES.letter, letterId: 'T0007' },
    { at: ago(0, 3), kind: 'import', text: 'Imported summary-without-dates.pdf. Cannot assess: no dispensing dates were found.', caseId: 'C0004' },
    { at: ago(0, 2), kind: 'import', text: 'Imported fictional-patient-g.csv. 15 lines.', caseId: 'C0007' },
    { at: ago(0, 1.99), kind: 'screen', text: `${JOB_NAMES.screen} suspected Sample 11 on fictional-patient-g.csv.`, model: MODEL_NAMES.screen, caseId: 'C0007', criterionId: C(11) },
    { at: ago(0, 1.985), kind: 'screen', text: `${JOB_NAMES.screen} reported a possible finding for Sample 12 on fictional-patient-g.csv. The record does not show a diagnosis of heart failure.`, model: MODEL_NAMES.screen, caseId: 'C0007', criterionId: C(12) },
    { at: ago(0, 1.97), kind: 'check', text: `${JOB_NAMES.check} confirmed Sample 11.`, model: MODEL_NAMES.check, findingId: 'F0012', criterionId: C(11) },
    { at: ago(0, 1.96), kind: 'check', text: `${JOB_NAMES.check} confirmed Sample 12 as a possible finding.`, model: MODEL_NAMES.check, findingId: 'F0013', criterionId: C(12) },
    { at: ago(0, 1), kind: 'import', text: 'Imported fictional-patient-a.csv. 16 lines.', caseId: 'C0001' },
    { at: ago(0, 0.98), kind: 'screen', text: `${JOB_NAMES.screen} suspected Sample 1 on fictional-patient-a.csv.`, model: MODEL_NAMES.screen, caseId: 'C0001', criterionId: C(1) },
    { at: ago(0, 0.96), kind: 'check', text: `${JOB_NAMES.check} confirmed Sample 1.`, model: MODEL_NAMES.check, findingId: 'F0001', criterionId: C(1) },
    { at: ago(0, 0.95), kind: 'check', text: `${JOB_NAMES.check} did not confirm Sample 3.`, model: MODEL_NAMES.check, findingId: 'F0003', criterionId: C(3) },
    { at: ago(0, 0.94), kind: 'error', text: 'The second check of Sample 7 was not completed. The finding was passed to the pharmacist.', model: MODEL_NAMES.check, findingId: 'F0002', criterionId: C(7) },
    { at: ago(0, 0.3), kind: 'import', text: `Imported scan-fictional-patient-f.pdf. ${JOB_NAMES.screen} read 9 rows from 1 page. Waiting for the pharmacist to check them.`, model: MODEL_NAMES.screen, caseId: 'C0006' },
    { at: ago(0, 0.2), kind: 'letter', text: 'Sample: letter T0004 is shown as ready.', model: MODEL_NAMES.letter, letterId: 'T0004' },
    { at: ago(0, 0.01), kind: 'import', text: 'Imported fictional-patient-e.csv. 12 lines.', caseId: 'C0005' },
  ];

  return {
    version: 1,
    cases,
    findings,
    letters,
    jobs: [
      { id: 'J0031', stage: 'screen', caseId: 'C0005', status: 'running', detail: `criterion 4 of ${SAMPLE_CRITERIA.length}` },
      { id: 'J0032', stage: 'letter', caseId: 'C0003', findingId: 'F0009', status: 'queued' },
    ],
    activity,
  };
}

/** Sample view with twenty-five waiting findings from three histories (?mock=1&many=1). */
export function makeManyFixture(nowMs: number): AppState {
  const base = makeFixture(nowMs);
  const waiting = base.findings.filter((f) => f.state === 'confirmed').length;
  const need = 25 - waiting;
  if (need <= 0) return base;

  const caseIds = ['C0001', 'C0002', 'C0007'];
  const at = new Date(nowMs).toISOString();
  let n = 17;
  for (let i = 0; i < need; i++) {
    const caseId = caseIds[i % caseIds.length];
    const criterion = SAMPLE_CRITERIA[(i + 2) % SAMPLE_CRITERIA.length];
    const finding: Finding = {
      id: `F${String(n).padStart(4, '0')}`,
      caseId,
      criterionId: criterion.id,
      state: 'confirmed',
      possible: false,
      screen: {
        lineIds: ['L002'],
        medicines: ['sample medicine'],
        reason: `Sample waiting finding ${n} for the search box mock-up.`,
        linesVerified: true,
        missingFacts: [],
        model: MODEL_NAMES.screen,
        at,
        seconds: 5.1,
      },
      check: {
        confirmed: true,
        lineIds: ['L002'],
        whatMatches: 'Sample double-check words for the search box mock-up.',
        whatCannotBeSeen: criterion.cannot_be_seen,
        completed: true,
        model: MODEL_NAMES.check,
        at,
        seconds: 8.8,
      },
      seenByPharmacist: false,
    };
    base.findings.push(finding);
    n++;
  }
  return base;
}
