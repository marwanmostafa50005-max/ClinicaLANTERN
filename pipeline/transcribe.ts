// Reading a scanned page: the first model (it has a vision part) copies the printed rows of one
// page image. The pharmacist confirms the rows before any screening starts (docs/SPEC.md section 6).
import type { LanternConfig } from '../shared/types.ts';
import { parseBirthDate } from './age.ts';
import { chat, type JsonSchema } from './ollama.ts';
import { formatSupplyLine } from './csv.ts';
import { parseDateField } from './dates.ts';
import type { JobDeps } from './screen.ts';

export const TRANSCRIBE_NUM_PREDICT = 8000;
/** One attempt at reading one page image. A printed page took up to about a minute in the proof. */
export const TRANSCRIBE_TIMEOUT_MS = 290_000;

const ROW_FIELDS = ['date', 'medicine', 'strength', 'form', 'qty', 'repeats', 'directions', 'prescriber'];
const PATIENT_FIELDS = ['date_of_birth', 'age', 'sex'];

export const TRANSCRIBE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    patient: {
      type: 'object',
      properties: Object.fromEntries(PATIENT_FIELDS.map(name => [name, { type: 'string' } as JsonSchema])),
      required: PATIENT_FIELDS
    },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: Object.fromEntries(ROW_FIELDS.map(name => [name, { type: 'string' } as JsonSchema])),
        required: ROW_FIELDS
      }
    }
  },
  required: ['rows', 'patient']
};

export const TRANSCRIBE_SYSTEM =
  'You transcribe a printed pharmacy dispensing history from an image into rows. ' +
  'Copy exactly what is printed. Do not skip, merge or invent rows. ' +
  'When a column is not printed, give an empty text for it. Reply with JSON only.';

const TRANSCRIBE_TASK =
  'Transcribe every row of the table in this image, top to bottom. ' +
  'For each row give: date, medicine (the name as printed, with the ingredient in brackets when it is printed), ' +
  'strength, form, qty, repeats, directions, prescriber. ' +
  'Also copy the patient header into patient: date_of_birth, age and sex exactly as printed, with empty text when not printed. ' +
  'Do not calculate age from the date of birth.';

interface TranscribedRow {
  date: string; medicine: string; strength: string; form: string;
  qty: string; repeats: string; directions: string; prescriber: string;
}

interface TranscribedHeader {
  date_of_birth: string; age: string; sex: string;
}

export interface TranscribedPatient {
  dateOfBirth?: string;
  dateOfBirthUnreadable?: boolean;
  age?: number;
  sex?: string;
}

export type TranscribeOutcome =
  | { ok: true; rows: string[]; patient?: TranscribedPatient }
  | { ok: false; error: string };

/** Removes a "data:image/png;base64," prefix and any white space. */
export function cleanBase64(image: string): string {
  return image.replace(/^data:[^;,]*;base64,/i, '').replace(/\s+/g, '');
}

/** Reads the supply rows and patient header printed on one page image. */
export async function transcribePageImage(cfg: LanternConfig, base64Png: string, deps: JobDeps = {}): Promise<TranscribeOutcome> {
  const call = deps.chat ?? chat;
  const image = typeof base64Png === 'string' ? cleanBase64(base64Png) : '';
  if (!image) return { ok: false, error: 'The page image is empty.' };
  try {
    const answer = await call<{ rows: TranscribedRow[]; patient?: TranscribedHeader }>(cfg, {
      model: cfg.models.screen,
      think: cfg.think.screen,
      schema: TRANSCRIBE_SCHEMA,
      messages: [
        { role: 'system', content: TRANSCRIBE_SYSTEM },
        { role: 'user', content: TRANSCRIBE_TASK, images: [image] }
      ],
      numPredict: TRANSCRIBE_NUM_PREDICT,
      timeoutMs: TRANSCRIBE_TIMEOUT_MS,
      signal: deps.signal
    });
    if (!answer.ok) return { ok: false, error: answer.error };
    // A page that gives no rows is a good answer here. The server tells the pharmacist about it
    // ("Page 2: no rows were read") and never drops the page without a word.
    const rows = answer.value.rows
      .map(r => formatSupplyLine({
        // A date that can be read is written as year-month-day, like every other line. Otherwise it stays as printed,
        // and the server marks the row for the pharmacist (linesFromRows with everyRowDated).
        date: parseDateField(r.date) ?? r.date,
        medicine: '', brand: r.medicine, strength: r.strength, form: r.form,
        quantity: r.qty, repeats: r.repeats, directions: r.directions, prescriber: r.prescriber
      }))
      .filter(text => text !== '');
    const header = answer.value.patient;
    if (!header) return { ok: true, rows };
    const patient: TranscribedPatient = {};
    const printedDob = header.date_of_birth.trim();
    if (printedDob) {
      const dob = parseBirthDate(printedDob);
      if (dob) patient.dateOfBirth = dob;
      else patient.dateOfBirthUnreadable = true;
    }
    const printedAge = header.age.trim();
    if (/^\d{1,3}$/.test(printedAge) && Number(printedAge) <= 130) patient.age = Number(printedAge);
    const sex = header.sex.trim();
    if (sex) patient.sex = /^f(?:emale)?$/i.test(sex) ? 'F' : /^m(?:ale)?$/i.test(sex) ? 'M' : sex;
    return { ok: true, rows, patient };
  } catch (e) {
    return { ok: false, error: `The page could not be read: ${e instanceof Error ? e.message : String(e)}` };
  }
}
