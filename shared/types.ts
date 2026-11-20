// The contract between the page, the server, the three model jobs and the scorer.
// Erasable TypeScript only (types and interfaces): Node runs this file directly.
// Explained in docs/SPEC.md section 5. Change it only together with docs/SPEC.md.

export type Stage = 'screen' | 'check' | 'letter';
export type ImportSource = 'csv' | 'pdf-text' | 'pdf-image';

// ---------- criteria (data files in criteria/<ID>/criterion.json) ----------

export interface MedicineGroup {
  key: string;                        // "A", "B", ...
  name: string;                       // "Oral NSAIDs"
  ingredients: string[];              // active ingredient names, lower case
  brands: Record<string, string[]>;   // ingredient -> Australian brand names
  note?: string;
}

export interface CriterionSource {
  document: string;                   // e.g. "STOPP/START criteria, version 3"
  citation: string;                   // authors, journal, year, pages
  doi?: string;
  url?: string;
  licence: string;                    // e.g. "CC BY 4.0"
  licence_status: 'proposed' | 'confirmed_by_founder';
  credit: string;                     // credit line shown with the statement
  modification_notice?: string;
}

// A fact a criterion needs that a dispensing history does not hold (docs/SPEC.md section 6a).
export type FactKind = 'condition' | 'result' | 'observation';

/** What choosing an option means for the fact. */
export type FactEffect = 'meets' | 'does_not_meet' | 'unknown';

/** One button the pharmacist can press. The words are what is stored on the fact line. */
export interface FactOption {
  words: string;
  effect: FactEffect;
}

export interface NeededFact {
  kind: FactKind;                     // a diagnosis, a test result or a measurement
  what: string;                       // its name: "Heart failure", "eGFR", "Blood pressure"
  meets: string;                      // when the fact meets the criterion: "below 30 mL/min/1.73 m2"
  /** Buttons, when Yes and No are not enough. Absent: Yes, No and Not known, or a value for a result. */
  options?: FactOption[];
  /**
   * Absent: the question is asked only when a possible finding is waiting for this fact.
   * "always": the question stands for this patient, and may be skipped.
   * { group }: ask when a medicine of that group is supplied and the criterion's age limit holds.
   */
  ask_when?: 'always' | { group: string };
  /**
   * Absent: nothing closes a standing question early.
   * { group, months? }: when ask_when is "always", the standing question is not put if a medicine
   * of that group was supplied in that many calendar months ending on the newest supply date of
   * the record. months is 6 when it is left out. An older supply does not close it. Ignored when
   * ask_when is not "always". The group is named here. It is never guessed.
   */
  close_when?: { group: string; months?: number };
}

/** The pharmacist's answer, stored with the question so a restart keeps it. */
export interface FactAnswer {
  lineId: string;
  words: string;
  effect: FactEffect;
  at: string;
  /** Set when the pharmacist takes the answer back. The line stays, marked as taken back. */
  takenBackAt?: string;
}

/** One question for one fact. Two criteria that name the same fact share one question. */
export interface PharmacistQuestion {
  id: string;                         // "Q0001"
  /** kind, then the fact's name in lower case with the spaces trimmed. */
  key: string;
  kind: FactKind;
  what: string;
  meets: string;
  criterionIds: string[];
  findingIds: string[];
  /** possible: a possible finding is waiting. supply: a listed or marker medicine is supplied. patient: it stands for this patient. */
  source: 'possible' | 'supply' | 'patient';
  /**
   * Why each criterion shares this question. A possible finding on one criterion does not release
   * another criterion's standing or supply link. Absent on a state saved before this field: the
   * question source applies to every criterion on the question.
   */
  links?: { criterionId: string; why: 'possible' | 'supply' | 'patient' }[];
  status: 'open' | 'answered' | 'not_known';
  options: FactOption[];
  /** A result, the age, or a daily dose: the pharmacist types a value. Everything else is a button. */
  needsValue: boolean;
  /**
   * Set when the pharmacist leaves this standing question unanswered.
   * The question stays open, so the check still waits. Absent on a state saved before this field existed.
   */
  leftUnanswered?: boolean;
  /** Small print under the question: an unread age limit or the reason a marker opened it. */
  note?: string;
  /** Present when a supplied medicine marker opened this fact question at import. */
  conditionMarker?: {
    condition: string;
    question: string;
    lineIds: string[];
  };
  /**
   * Present when the typed result can also be read from an uploaded pathology test (pipeline/pathology.ts):
   * the tests the reader knows for this question. Absent for every other question and on an older saved state.
   */
  pathology?: { tests: { key: string; name: string }[] };
  answer?: FactAnswer;
  /** The findings and the criterion results from before this answer, so taking it back puts them back. */
  heldFindings?: Finding[];
  heldRuns?: { criterionId: string; status: CriterionRunStatus; reason?: string }[];
}

/**
 * One pack rule. A counted line whose product holds form_has is that many units per pack.
 * The amount is the quantity divided by per, rounded up.
 */
export interface SupplyPack {
  form_has: string;                   // one word, matched the same way as SupplyCount.form_has
  per: number;                        // units in one pack; a whole number of 1 or more
}

/**
 * Absent from a criterion that does not ask for a count.
 * The application then counts supply lines of one medicine group and writes the numbers
 * into the screen, the check and the letter. The models are told not to count again.
 */
export interface SupplyCount {
  group: string;                      // a key of this criterion's medicine groups
  months: number;                     // calendar months, 1 to 120
  window: 'any' | 'last';             // "last": ending on the newest date of the record. "any": the window with the highest total
  form_has?: string[];                // the product form must hold one of these words. Absent: no form check
  packs?: SupplyPack[];               // absent: each line is counted as today. Present: a matching line is converted
}

export interface Criterion {
  id: string;                         // "STOPP-C10" (also the folder name)
  label: string;                      // "STOPP C10"
  family: string;
  title: string;                      // short plain title
  statement: string;                  // the criterion text shown to the pharmacist as evidence
  statement_origin: 'published' | 'entrant';
  source: CriterionSource;
  plain_summary: string;              // one sentence
  medicine_groups: MedicineGroup[];
  needs_facts?: NeededFact[];         // only when the criterion needs a fact that a dispensing history does not hold
  count_supplies?: SupplyCount;       // only when the application is asked to count supply lines of one group
  /**
   * Absent: a standing question is asked of every sex.
   * "female" or "male": the standing question is withheld for the other sex.
   * The statement and the rule are not a sex limit. The field is not in the words the models read.
   */
  only_sex?: 'female' | 'male';
  rule_for_models: string;            // one or two sentences: when to suspect a finding
  cannot_be_seen: string;             // what a dispensing history cannot show
  ask_the_gp: string;                 // the check or review the letter asks for
  urgency: 'routine' | 'same_day';
  draft: boolean;                     // true until the founder signs
  signed_by_clinical_reviewer: null | { name: string; date: string };
}

// active: the first ten, always screened first. further: the criteria in use after them, in order.
export interface ActiveCriteria { active: string[]; reserves: string[]; further?: string[] }

// ---------- cases ----------

// A line is a supply, or a fact the record carries: "2026-08-03 | RESULT | eGFR 28 mL/min/1.73 m2".
// Line IDs run over all rows in file order, supplies and facts alike.
export interface HistoryLine { id: string; text: string; page?: number }   // id "L001"

export interface PatientHeader {
  label: string;                                          // fictional only
  age?: number;
  sex?: string;
  dateOfBirth?: string;                                   // YYYY-MM-DD when the file carried one
  ageFrom?: 'date_of_birth' | 'record';
}

export type CriterionRunStatus = 'waiting' | 'running' | 'clear' | 'suspected' | 'failed';

export interface CriterionRun {
  criterionId: string;
  status: CriterionRunStatus;
  seconds?: number;
  error?: string;                     // set when status is "failed" (could not be screened)
  reason?: string;                    // what Model 1 wrote when it answered "clear", kept so a miss can be looked into
}

export interface CaseRecord {
  id: string;                         // "C0001"
  fileName: string;
  importedAt: string;                 // ISO time
  source: ImportSource;
  patient: PatientHeader;
  lines: HistoryLine[];
  cannotAssess?: string;              // reason; when set the case is not screened
  transcriptionConfirmed: boolean;    // true for csv and pdf-text; the pharmacist confirms pdf-image
  pages?: number;                     // pdf-image only: how many page pictures were sent
  scanNotes?: string[];               // pdf-image only: what to look at before confirming (a page with no rows, a date that cannot be read)
  /**
   * Dates of birth read from the pages of a scan, when they are not all the same.
   * Absent when the pages agree, or when the history is not a scan. Confirming stays off while this is set.
   */
  birthDatesRead?: string[];
  parts: number;                      // 1 unless a long history was screened in overlapping parts
  /** Questions for the pharmacist. Absent on a state saved before this field existed. */
  questions?: PharmacistQuestion[];
  /**
   * True when this history was imported under a saved copy of the criteria.
   * Absent on a state saved before that copy existed: the current file is used, because no earlier text was kept.
   */
  criterionPinned?: boolean;
  screening: {
    status: 'waiting' | 'running' | 'done' | 'interrupted' | 'not_started';
    criteria: CriterionRun[];
    startedAt?: string;
    finishedAt?: string;
  };
}

// ---------- findings ----------

export type FindingState = 'suspected' | 'confirmed' | 'not_confirmed' | 'accepted' | 'bypassed';

export interface ScreenResult {
  lineIds: string[];
  medicines: string[];
  reason: string;
  linesVerified: boolean;             // false when the model cited no valid line
  listedLineIds?: string[];           // long histories only: every line Model 1 listed as holding a listed medicine. They are read together.
  missingFacts: string[];             // facts the criterion needs that the record holds no line about; empty when nothing is missing
  model: string;
  at: string;
  seconds: number;
}

export interface CheckResult {
  confirmed: boolean;
  lineIds: string[];
  whatMatches: string;
  whatCannotBeSeen: string;
  completed: boolean;                 // false when the check call failed twice (finding still shown)
  unclear?: boolean;                  // true when Model 2 answered "not confirmed" but named lines as proof (finding still shown)
  model: string;
  at: string;
  seconds: number;
}

export interface Decision { action: 'accept' | 'bypass' | 'dismiss'; reason?: string; by: string; at: string }

export interface Finding {
  id: string;                         // "F0001"
  caseId: string;
  criterionId: string;
  state: FindingState;
  possible: boolean;                  // true for a possible finding: the medicines match and the record does not show a fact the criterion needs (screen.missingFacts)
  screen: ScreenResult;
  check?: CheckResult;
  decision?: Decision;
  seenByPharmacist: boolean;          // drives the bell badge
}

// ---------- letters ----------

export type LetterStatus = 'drafting' | 'ready' | 'sent' | 'reply_recorded' | 'closed';
export type ReplyOutcome = 'changed' | 'not_changed' | 'will_review' | 'other';

export interface LetterDraft {
  subject: string;
  body: string;                       // the full letter text as first drafted
  origin: 'model' | 'template';       // "template" when the model's draft failed its checks twice, or the model did not answer
  templateReason?: 'checks_failed' | 'no_answer' | 'error';   // set when origin is "template": why the model's words are not used
  checkNotes: string[];               // what the letter checks found, empty when clean
  model: string;
  at: string;
  seconds: number;
}

/** One accepted finding inside the patient's letter. The draft is absent while that point is being written. */
export interface LetterPoint {
  findingId: string;
  draft?: LetterDraft;
}

/** A point the doctor answered differently from the outcome recorded for the whole letter. */
export interface LetterPointReply {
  findingId: string;
  outcome: ReplyOutcome;
  note?: string;
}

export interface Letter {
  id: string;                         // "T0001"
  findingId: string;                  // the first finding. Kept so an older reader still has one.
  /** Every finding in this letter, in the order the pharmacist accepted them. Absent on a letter saved as one finding. */
  findingIds?: string[];
  /** The draft of each finding. Absent on a letter saved before one letter per patient. */
  points?: LetterPoint[];
  /** True when this letter was started because an earlier letter for the patient had already been sent. */
  afterSent?: boolean;
  /**
   * Set when a point rested on an answer the pharmacist took back.
   * A letter already marked as sent keeps its text and carries this note.
   * A letter that no longer matches its findings carries this note and cannot be agreed, previewed or sent.
   */
  withdrawnNote?: string;
  caseId: string;
  status: LetterStatus;
  draft?: LetterDraft;                // absent while status is "drafting"
  subject: string;                    // current text (after the pharmacist's edits)
  body: string;
  editedByPharmacist: boolean;
  /**
   * How many times this draft has been saved. Absent on a letter saved before revisions, which means 0.
   * An edit must send this number back. A later save makes an earlier number useless.
   */
  draftRevision?: number;
  /** The line about who wrote the words. Kept apart from the text the pharmacist edits, so it cannot be deleted. */
  closingLine?: string;
  /** The three lines of the signature, apart from the text the pharmacist edits. The page draws the name in a handwriting font. */
  signatureName?: string;
  signatureTitle?: string;
  signatureRegistration?: string;
  /** Set when this exact text was previewed. Cleared by any edit. */
  previewedAt?: string;
  /**
   * sha256 of the subject and the letter as it will leave, including the line about AI and the signature.
   * The window that previewed this copy sends it back when the letter is marked as sent.
   */
  previewHash?: string;
  patientAgreed?: { at: string; note?: string };
  sentAt?: string;
  sentBy?: 'print' | 'email';
  dueAt?: string;                     // sentAt + overdueDays
  reply?: { at: string; outcome: ReplyOutcome; note: string; points?: LetterPointReply[] };
  closedAt?: string;
  seenByPharmacist: boolean;          // drives the letter badge
}

// ---------- jobs, activity, state ----------

export interface Job {
  id: string;
  stage: Stage;
  caseId: string;
  findingId?: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  detail?: string;
  /** A screen job for criteria after the first ten. Checks, letters and the first ten go before it. */
  band?: 'further';
  /** The one warm-up job at server start. It is not a history. Model 1 answers once so it is in memory. */
  warmup?: boolean;
}

export interface Activity {
  at: string;
  kind: 'import' | 'screen' | 'check' | 'decision' | 'letter' | 'letter_status' | 'error' | 'reset';
  text: string;
  model?: string;
  caseId?: string;
  findingId?: string;
  letterId?: string;
  criterionId?: string;
}

export interface Counts {
  historiesScreened: number;
  findingsConfirmed: number;
  accepted: number;
  bypassed: number;
  lettersReady: number;
  lettersSent: number;
  repliesRecorded: number;
  closed: number;
  overdue: number;
  bellBadge: number;                  // confirmed findings not yet seen
  letterBadge: number;                // ready letters not yet seen
}

export interface NowRunning { stage: Stage | null; text: string }   // "Mantle is screening: criterion 14 of 413"

export interface AppState {
  version: 1;
  cases: CaseRecord[];
  findings: Finding[];
  letters: Letter[];
  jobs: Job[];
  activity: Activity[];
  /**
   * The highest id number already given out. A reset keeps it, so a window from the
   * earlier demo cannot act on a new patient by sending an id that has started again.
   * Absent in a state saved before this field.
   */
  issued?: { C: number; F: number; T: number; J: number };
}

export interface StateResponse {
  state: AppState;
  counts: Counts;
  now: NowRunning;
  serverTime: string;
  recorded: boolean;                  // true in the judges' replay build: no live model
  /** Disputed findings (state not_confirmed, no decision yet) waiting for the pharmacist. The grey count beside the bell. */
  disputedWaiting?: number;
}

export interface HealthResponse {
  ollama: 'up' | 'down';
  version?: string;
  models: { screen: boolean; check: boolean; letter: boolean };
  names: { screen: string; check: string; letter: string };   // the technical names in Ollama
  displayNames?: { screen: string; check: string; letter: string };   // Mantle, Lumen, Ogee, from the settings
  modelsBehind?: { screen: string; check: string; letter: string };   // the open model behind each name
  /** Set when the warm-up could not reach the models. The sentence is "The local models are not running." */
  modelsNote?: string;
}

// ---------- API bodies ----------

export interface ImportRequest {
  fileName: string;
  source: ImportSource;
  csvText?: string;                   // source "csv"
  rows?: string[];                    // source "pdf-text": one printed row per entry
  pageImages?: string[];              // source "pdf-image": base64 PNG, one per page
  patient?: PatientHeader;
}
export interface ImportResponse { caseId: string }
export interface DecisionRequest { action: 'accept' | 'bypass' | 'dismiss'; reason?: string }
/** The pharmacist's answer to one question. A button sends `option`. A result sends `value`, and may send `unit` and `date`. */
export interface QuestionAnswerRequest { option?: string; value?: string; unit?: string; date?: string }
/** The email draft. It carries no address: the pharmacist's own mail program opens it. */
export interface EmailDraft {
  subject: string;
  text: string;                       // the whole letter when it fits, otherwise a short cover note
  fits: boolean;
  coverNote: boolean;                 // true when the letter is longer than the limit: the preview offers Copy and Print
}
export interface LetterEditRequest {
  subject: string;
  body: string;
  /** The draft revision this edit was opened against. A later save makes an earlier one useless. */
  expectedRevision?: number;
}
export interface LetterSentRequest {
  by: 'print' | 'email';
  /** The token from the preview of this subject and text. A later preview makes an earlier token useless. */
  previewToken?: string;
}
export interface LetterReplyRequest {
  outcome: ReplyOutcome;
  note: string;
  /** A point answered differently from `outcome`. Omitted when every point has the same outcome. */
  points?: LetterPointReply[];
}

// ---------- config (lantern.config.json) ----------

export interface LanternConfig {
  ollamaBase: string;                 // "http://127.0.0.1:27435"
  port: number;                       // local server port, 8787
  models: { screen: string; check: string; letter: string };
  think: { screen: boolean; check: boolean; letter: boolean };
  numCtx: number;
  keepAlive: string;
  maxLinesPerCall: number;
  overlapLines: number;
  overdueDays: number;
  /** Ask about a marker-linked fact when a marker medicine is supplied. Default false. */
  conditionMarkers?: boolean;
  /** Further criteria screened before their findings are double-checked. Default 20. */
  screenBlockSize?: number;
  pharmacy: {
    name: string;
    address: string;
    phone: string;
    pharmacist: string;
    pharmacistTitle: string;
    registration: string;
  };
  modelNames: { screen: string; check: string; letter: string };
  /** The open model behind each name. Shown in the page footer. Not a name written into code. */
  modelsBehind: { screen: string; check: string; letter: string };
  /** The email draft carries the whole letter when the text is no longer than this. Default 1800. */
  emailDraftLimit?: number;
  doctor: { name: string; practice: string };                                         // fictional in the prototype
}

// ---------- test cases (cases/expected.json) ----------

export interface ExpectedFinding {
  criterion: string;                  // criterion id that must fire on this case
  must_cite: string[][];              // for each inner list, at least one of its line IDs must be cited
}
export interface ExpectedCase {
  file: string;                       // path under cases/, e.g. "STOPP-C10/pos-brand.csv"
  kind: 'positive' | 'near_miss' | 'clean';
  about: string;                      // one sentence: what was planted, or why it must not flag
  findings: ExpectedFinding[];        // empty for near_miss and clean
}
export interface ExpectedSheet {
  signed_by_clinical_reviewer: null | { name: string; date: string };
  cases: ExpectedCase[];
}
