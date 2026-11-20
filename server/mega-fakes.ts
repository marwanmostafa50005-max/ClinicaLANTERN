// Fake model jobs for the M01 mega flow. No real model is called.
import type { CaseRecord, CheckResult, Criterion, Finding, HistoryLine, LanternConfig, LetterDraft, PatientHeader, PharmacistQuestion, ScreenResult } from '../shared/types.ts';
import { enteredAtTheCounter } from '../shared/facts.ts';
import { PHARMACIST_MARK, TAKEN_BACK_MARK } from './questions.ts';
import type { PipelineFns } from './engine.ts';

export interface ExpectedQuestion {
  what: string;
  answer: string;
  kind: string;
  value?: string;
  unit?: string;
  date?: string;
}

export interface ExpectedFinding {
  criterion: string;
  title: string;
  kind: 'R' | 'Q' | 'P';
  lines: string[];
  why: string;
  questions: ExpectedQuestion[];
}

export interface ImportQuestion {
  what: string;
  kind: string;
  answer: string;
  value?: string;
  unit?: string;
  date?: string;
  needs_value?: boolean;
}

export interface MegaExpected {
  patient: { id: string; sex: string; date_of_birth: string; age: number };
  lines: number;
  expected_findings: ExpectedFinding[];
  questions_at_import: ImportQuestion[];
  touched_no_finding: { criterion: string; why: string }[];
}

export interface AnswerSpec {
  answer?: string;
  option?: string;
  value?: string;
  unit?: string;
  date?: string;
}

export interface MegaStats {
  screen: number;
  check: number;
  letter: number;
  transcribe: number;
  warm: number;
}

/** Answers for follow-up questions named in the answer sheet but not in M01_EXPECTED.json. */
const EXTRA_ANSWERS: Record<string, AnswerSpec> = {
  'QTc interval': { value: '505', unit: 'ms', date: '2026-03-16' },
  'Atrial fibrillation': { option: 'Yes' },
  'Metallic heart valve or moderate to severe mitral stenosis': { option: 'Yes' },
  'eGFR': { value: '52', unit: 'mL/min/1.73 m²', date: '2026-11-18' },
  'Current home oxygen from a hospital, state scheme or oxygen supplier': { option: 'Yes' },
  'Response to or suitability of simpler analgesia': { option: 'Yes' },
  'Diabetes status': { option: 'Yes' },
  'Urine albumin-to-creatinine ratio or urine protein-to-creatinine ratio': { value: 'Urine ACR 80', unit: 'mg/mmol', date: '2026-11-18' },
  'Spot urine albumin to creatinine ratio (uACR) for Australian review': {
    value: '80 (dated renal clinic assessment confirms persistent A3 albuminuria)',
    unit: 'mg/mmol',
    date: '2026-11-18'
  },
  'Bone mineral density T-score': { value: '-2.9 at the femoral neck', date: '2026-11-18' }
};

const AT = '2026-11-20T01:00:00.000Z';

function liveFact(lines: HistoryLine[], what: string): boolean {
  const needle = what.trim().toLowerCase();
  return lines.some(line =>
    enteredAtTheCounter(line.text) &&
    !line.text.includes(TAKEN_BACK_MARK) &&
    line.text.toLowerCase().includes(needle.slice(0, Math.min(needle.length, 24)))
  );
}

function questionAnswered(questions: PharmacistQuestion[] | undefined, what: string): boolean {
  const q = (questions ?? []).find(item => item.what === what);
  return q?.status === 'answered' || q?.status === 'not_known';
}

function factsReady(exp: ExpectedFinding, c: CaseRecord): boolean {
  for (const need of exp.questions) {
    if (questionAnswered(c.questions, need.what)) continue;
    if (liveFact(c.lines, need.what)) continue;
    return false;
  }
  return true;
}

function screenResult(lineIds: string[], missingFacts: string[], reason: string): ScreenResult {
  return {
    lineIds,
    medicines: [],
    reason,
    linesVerified: lineIds.length > 0 || missingFacts.length > 0,
    missingFacts,
    model: 'lantern-screen-fake',
    at: AT,
    seconds: 0.01
  };
}

export function buildAnswerMap(expected: MegaExpected): Map<string, AnswerSpec> {
  const map = new Map<string, AnswerSpec>();
  for (const row of expected.questions_at_import) {
    map.set(row.what, row.needs_value
      ? { value: row.value ?? row.answer, unit: row.unit ?? '', date: row.date ?? '2026-11-18' }
      : { option: row.answer, answer: row.answer });
  }
  for (const finding of expected.expected_findings) {
    for (const q of finding.questions) {
      map.set(q.what, q.value !== undefined || q.unit !== undefined
        ? { value: q.value ?? q.answer, unit: q.unit ?? '', date: q.date ?? '2026-11-18' }
        : { option: q.answer, answer: q.answer });
    }
  }
  for (const [what, spec] of Object.entries(EXTRA_ANSWERS)) map.set(what, spec);
  return map;
}

export function answerBodyFor(q: PharmacistQuestion, map: Map<string, AnswerSpec>): Record<string, unknown> {
  const spec = map.get(q.what);
  if (!spec) throw new Error(`The expected file names no answer for: ${q.what}`);
  if (q.needsValue) {
    const value = spec.value ?? spec.answer ?? '';
    if (!value) throw new Error(`The expected file gives no value for: ${q.what}`);
    return { value, unit: spec.unit ?? '', date: spec.date ?? '2026-11-18' };
  }
  const words = (spec.option ?? spec.answer ?? '').trim();
  const exact = q.options.find(o => o.words === words);
  if (exact) return { option: exact.words };
  const fold = q.options.find(o => o.words.toLowerCase() === words.toLowerCase());
  if (fold) return { option: fold.words };
  const partial = q.options.find(o => words.includes(o.words) || o.words.includes(words));
  if (partial) return { option: partial.words };
  if (q.options.some(o => o.words === words)) return { option: words };
  throw new Error(`The answer "${words}" is not a button on the question: ${q.what}`);
}

export function createMegaPipeline(
  expected: MegaExpected,
  stats: MegaStats,
  getCase: () => CaseRecord | undefined
): { pipeline: PipelineFns; byCriterion: Map<string, ExpectedFinding> } {
  const byCriterion = new Map(expected.expected_findings.map(f => [f.criterion, f]));

  const pipeline: PipelineFns = {
    screenCriterion: async (_cfg: LanternConfig, _patient: PatientHeader, _lines: HistoryLine[], criterion: Criterion) => {
      stats.screen++;
      const exp = byCriterion.get(criterion.id);
      const c = getCase();
      if (!exp) {
        return { ok: true as const, suspected: false, result: screenResult([], [], 'Clear.') };
      }
      if (exp.kind === 'R') {
        return { ok: true as const, suspected: true, result: screenResult(exp.lines, [], exp.why) };
      }
      if (!c || factsReady(exp, c)) {
        return { ok: true as const, suspected: true, result: screenResult([...exp.lines], [], exp.why) };
      }
      const missing = exp.questions
        .filter(q => !questionAnswered(c.questions, q.what) && !liveFact(c.lines, q.what))
        .map(q => q.what);
      const anchor = exp.lines.length > 0 ? exp.lines : ['L001'];
      return { ok: true as const, suspected: true, result: screenResult(anchor, missing, exp.why) };
    },
    checkFinding: async (_cfg, _patient, _lines, criterion, screen) => {
      stats.check++;
      const exp = byCriterion.get(criterion.id);
      const lineIds = screen.lineIds.length > 0 ? screen.lineIds : (exp?.lines ?? []);
      const result: CheckResult = {
        confirmed: true,
        lineIds,
        whatMatches: exp?.why ?? 'Matches the expected pack.',
        whatCannotBeSeen: 'Nothing further for this test.',
        completed: true,
        model: 'lantern-check-fake',
        at: AT,
        seconds: 0.01
      };
      return result;
    },
    draftLetter: async (_cfg, _patient, lines, criterion, finding) => {
      stats.letter++;
      const cited = finding.check?.lineIds?.length ? finding.check.lineIds : finding.screen.lineIds;
      const bodyLines = cited.map(id => lines.find(l => l.id === id)?.text ?? id).join('\n');
      const draft: LetterDraft = {
        subject: `Review: ${criterion.label}`,
        body: `${expected.patient.id}\n\n${bodyLines}\n\n${finding.screen.reason}`,
        origin: 'model',
        checkNotes: [],
        model: 'lantern-letter-fake',
        at: AT,
        seconds: 0.01
      };
      return draft;
    },
    transcribePageImage: async () => {
      stats.transcribe++;
      throw new Error('The mega flow test does not transcribe scans.');
    }
  };

  return { pipeline, byCriterion };
}