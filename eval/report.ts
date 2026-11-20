// Writes the results of a test run:
//   <out>/table.md      one row per criterion, then every miss and every false flag
//   <out>/results.json  everything
//   <out>/raw/          every model answer, one file per call
// The founder and the judges read table.md, so its text is plain English in short sentences.

import fs from 'node:fs';
import path from 'node:path';
import type { ExpectedCase } from '../shared/types.ts';
import type {
  CheckCall,
  CriterionScore,
  EvalResults,
  LetterCall,
  NotPassing,
  PairRecord,
  PairRole,
  RecordedOptions,
  RunScore,
  ScreenCall,
  Verdict,
  WaveNote,
} from './types.ts';
import { loadConfig } from '../pipeline/config.ts';
import { classLabel, factsText, historyKind, oneLine } from './score.ts';

// ---------- small text helpers ----------

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

// Folder name for one run: yyyyMMdd-HHmmss, local time.
export function stampOf(date: Date): string {
  return (
    `${pad(date.getFullYear(), 4)}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function localTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export function duration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  if (h > 0) return `${h} h ${m} min ${rest} s`;
  if (m > 0) return `${m} min ${rest} s`;
  return `${rest} s`;
}

function secondsText(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

// Text for a table cell: one line, no bar that would break the table.
function cell(text: string): string {
  return oneLine(text, 200).replace(/\|/g, '/');
}

// A longer cell, for the reason a criterion failed.
function wideCell(text: string): string {
  return oneLine(text, 400).replace(/\|/g, '/');
}

// Text shown as code: one line, no backtick that would end the code span.
function code(text: string): string {
  return `\`${oneLine(text, 400).replace(/`/g, "'")}\``;
}

// Model text shown in quotes: one line, plain quotes.
function quoted(text: string): string {
  return `"${oneLine(text, 300).replace(/"/g, "'")}"`;
}

function idList(ids: string[]): string {
  return ids.length === 0 ? 'none' : ids.join(', ');
}

function groupsText(groups: string[][]): string {
  if (groups.length === 0) return 'no line was named';
  return groups.map((g) => (g.length === 0 ? '(no line named)' : g.join(' or '))).join('; and ');
}

// ---------- labels ----------

export function resultLabel(verdict: Verdict): string {
  switch (verdict) {
    case 'PASS':
      return 'PASS';
    case 'PASS_PART':
      return 'PASS (part run)';
    case 'FAIL':
      return 'FAIL';
    default:
      return 'NOT TESTED';
  }
}

export function resultSentence(score: RunScore): string {
  const t = score.totals;
  const parts = [`Criteria that PASS: ${t.pass} of ${t.criteria}.`];
  if (t.passPart > 0) parts.push(`PASS on a part run only: ${t.passPart}.`);
  if (t.fail > 0) parts.push(`FAIL: ${t.fail}.`);
  if (t.notTested > 0) parts.push(`Not tested: ${t.notTested}.`);
  return parts.join(' ');
}

export function lettersCell(s: CriterionScore, lettersRun: boolean): string {
  if (!lettersRun) return 'not run';
  const l = s.letters;
  if (l.needed === 0) return 'none needed';
  const parts: string[] = [];
  if (l.modelClean > 0) parts.push(`${l.modelClean} by the model`);
  if (l.modelWithNotes > 0) parts.push(`${l.modelWithNotes} by the model with check notes`);
  if (l.template > 0) parts.push(`${l.template} from the template`);
  if (l.notProduced > 0) parts.push(`${l.notProduced} missing`);
  if (l.withoutPlanted > 0) parts.push(`${l.withoutPlanted} without the planted lines`);
  return `${l.produced} of ${l.needed}: ${parts.join(', ')}`;
}

export function optionsText(o: RecordedOptions): string {
  const parts: string[] = [];
  if (o.waves && o.waves.length > 0) parts.push(`--wave ${o.waves.join(',')}`);
  if (o.quick) parts.push('--quick');
  if (o.noSample) parts.push('--no-sample');
  if (o.only.length > 0) parts.push(`--only ${o.only.join(',')}`);
  if (o.cases.length > 0) parts.push(`--cases ${o.cases.join(',')}`);
  if (o.limit !== null) parts.push(`--limit ${o.limit}`);
  if (!o.letters) parts.push('--no-letters');
  if (o.sheet !== null) parts.push(`--sheet ${o.sheet}`);
  return parts.length > 0 ? parts.join(' ') : 'none';
}

function kindPhrase(kind: ExpectedCase['kind'], ownFolder: boolean): string {
  if (kind === 'near_miss') return ownFolder ? 'the near miss written for this criterion' : 'a near miss written for another criterion';
  if (kind === 'clean') return 'a clean history';
  return 'a history with a finding planted for another criterion';
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// 3 of 120 as "2.5%". One decimal place, so a small sample does not look more exact than it is.
export function percentText(part: number, whole: number): string {
  if (whole <= 0) return 'no rate';
  const rounded = Math.round((part / whole) * 1000) / 10;
  if (part > 0 && rounded === 0) return 'less than 0.1%';   // never "0.0%" when something was found
  return `${rounded.toFixed(1)}%`;
}

function rolePhrase(role: PairRole | undefined): string {
  if (role === 'sample') return ' It was found in the false-flag sample.';
  if (role === 'clean') return ' It was found on a history screened as a clean history.';
  return '';
}

export function notPassingLabel(result: NotPassing['result']): string {
  switch (result) {
    case 'FAIL':
      return 'FAIL';
    case 'PASS_PART':
      return 'PASS (part run)';
    case 'NOT_DRAFTED':
      return 'NOT DRAFTED';
    case 'FILES_NOT_USABLE':
      return 'FILES NOT USABLE';
    default:
      return 'NOT TESTED';
  }
}

function stagePhrase(stage: 'import' | 'screen' | 'check' | 'letter'): string {
  if (stage === 'import') return 'reading the history';
  if (stage === 'screen') return 'Model 1, screen';
  if (stage === 'check') return 'Model 2, double-check';
  return 'Model 3, letter';
}

// ---------- a wave run, wave folder by wave folder ----------

// What one wave folder came to in a wave run. Several wave folders can share one run, so the
// table and the last lines of the run say, for each of them, how many criteria pass and how long
// the model calls for its criteria took.
export interface WaveSummary {
  name: string;
  scored: number;               // criteria of the wave folder that were scored in this run
  pass: number;
  notPassing: number;           // scored, and the result is not PASS
  leftOut: number;              // usable, but not picked by --only
  notDrafted: number;
  notUsable: number;
  planted: number;
  caught: number;
  disputed: number;
  falseFlags: number;
  seconds: number;              // time spent in the model calls for its criteria
}

export function waveSummaries(waves: WaveNote[] | null | undefined, score: RunScore): WaveSummary[] {
  const scoreOf = new Map(score.criteria.map((s) => [s.criterionId, s]));
  return (waves ?? []).map((wave) => {
    const summary: WaveSummary = {
      name: wave.name, scored: 0, pass: 0, notPassing: 0, leftOut: 0, notDrafted: 0, notUsable: 0, planted: 0, caught: 0, disputed: 0, falseFlags: 0, seconds: 0,
    };
    for (const note of wave.criteria) {
      if (note.status === 'left_out') summary.leftOut++;
      else if (note.status === 'not_drafted') summary.notDrafted++;
      else if (note.status === 'not_usable') summary.notUsable++;
      const s = note.status === 'in_run' ? scoreOf.get(note.id) : undefined;
      if (!s) continue;
      summary.scored++;
      if (s.verdict === 'PASS') summary.pass++;
      else summary.notPassing++;
      summary.planted += s.planted;
      summary.caught += s.caught;
      summary.disputed += s.disputed;
      summary.falseFlags += s.falseFlags.length;
      summary.seconds += s.seconds;
    }
    summary.seconds = Math.round(summary.seconds * 10) / 10;
    return summary;
  });
}

// One wave folder in one line, for the last lines of a run.
export function waveSummaryLine(w: WaveSummary): string {
  const more: string[] = [];
  if (w.notDrafted > 0) more.push(`not drafted ${w.notDrafted}`);
  if (w.notUsable > 0) more.push(`files not usable ${w.notUsable}`);
  if (w.leftOut > 0) more.push(`left out by an option ${w.leftOut}`);
  return `${w.name}: PASS ${w.pass} of ${w.scored} scored, not passing ${w.notPassing}${more.length > 0 ? `, ${more.join(', ')}` : ''}. Planted findings caught: ${w.caught} of ${w.planted}, disputed ${w.disputed}. Time in model calls: ${duration(w.seconds)}.`;
}

// ---------- table.md ----------

export function renderTable(r: EvalResults): string {
  const out: string[] = [];
  const score = r.score;
  const t = score.totals;
  const caseOf = new Map(r.cases.map((c) => [c.file, c]));

  // The text of the cited lines, so the reader can judge a miss or a false flag at a glance.
  const lineItems = (caseFile: string, ids: string[], indent: string): string[] => {
    const lines = new Map((caseOf.get(caseFile)?.lines ?? []).map((l) => [l.id.trim().toUpperCase(), l.text]));
    const shown = ids.slice(0, 12).map((id) => {
      const text = lines.get(id.trim().toUpperCase());
      return `${indent}- ${code(text === undefined ? id : `${id}: ${text}`)}`;
    });
    if (ids.length > 12) shown.push(`${indent}- and ${ids.length - 12} more.`);
    return shown;
  };

  out.push('# ClinicaLANTERN test results', '');
  out.push('Fictional patients only. No real person is in these histories.', '');
  out.push('Stage: Prototype. This is one measured run on one computer. It is not a validation.', '');
  if (r.stoppedEarly !== null) {
    out.push(`**This run stopped early.** ${oneLine(r.stoppedEarly)} Do not use it for sign-off.`, '');
  }
  if (r.partRun) {
    out.push(
      `**This is a part run.** It does not cover the whole test set. Do not use it for sign-off. Options used: ${code(optionsText(r.options))}.`,
      '',
    );
  }
  const waves = r.waves ?? [];
  const quick = r.quick;
  const sampleInfo = quick?.sample ?? null;
  const sampleWords = sampleInfo
    ? ` One history in ${sampleInfo.oneIn} was also screened against up to ${sampleInfo.perHistory} other criteria, to estimate false flags.`
    : '';
  if (r.mode === 'quick') {
    out.push(
      `**This was a quick run.** Each history was screened against its own criterion only. Clean histories were screened against the first ten criteria.${sampleWords} PASS means the same as in a full run. False flags were counted only where the run looked.`,
      '',
    );
  }
  if (r.mode === 'wave') {
    out.push(
      `**This was a wave run.** It scored the criteria of ${count(waves.length, 'wave folder', 'wave folders')} in place: ${waves.map((w) => w.name).join(', ')}. Each history was screened against its own criterion only.${sampleWords} PASS means the same as in a full run. False flags were counted only where the run looked.`,
      '',
    );
  }

  // ----- the run -----
  const m = r.settings.models;
  const signed = r.sheet.signed_by_clinical_reviewer;
  const criteriaSigned = r.criteria.filter((c) => c.signed_by_clinical_reviewer !== null && c.signed_by_clinical_reviewer !== undefined).length;
  const kinds = { positive: 0, near_miss: 0, clean: 0 };
  for (const c of r.cases) kinds[c.kind]++;
  const notRead = r.cases.filter((c) => c.cannotAssess !== null).length;
  const leftUnscored = r.not_passing.filter((n) => n.result === 'NOT_DRAFTED' || n.result === 'FILES_NOT_USABLE');
  const notDrafted = leftUnscored.filter((n) => n.result === 'NOT_DRAFTED');
  const notUsable = leftUnscored.filter((n) => n.result === 'FILES_NOT_USABLE');

  out.push('## The run', '');
  out.push(`- When: ${localTime(r.startedAt)} to ${localTime(r.finishedAt)}, local time. It took ${duration(r.seconds)}.`);
  out.push(
    `- Models, by the names in the settings file: Model 1 ${code(m.screen)} screens. Model 2 ${code(m.check)} double-checks. Model 3 ${code(m.letter)} writes the letters.`,
  );
  out.push(`- Ollama address in the settings file: ${code(r.settings.ollamaBase)}.`);
  const signedWords = signed ? `Signed by ${oneLine(signed.name)} on ${oneLine(signed.date)}.` : 'Not signed by the clinical reviewer yet.';
  if (r.mode === 'wave') {
    out.push(`- Answer sheet: built from the answer parts (${code('expected.part.json')}) in the wave folders. ${signedWords}`);
  } else {
    out.push(`- Answer sheet: ${code(r.sheet.path)}. ${signedWords}`);
  }
  out.push(
    `- Histories: ${r.cases.length} of the ${r.sheet.caseCount} in the answer sheet. With a planted finding: ${kinds.positive}. Near misses: ${kinds.near_miss}. Clean: ${kinds.clean}.${
      notRead > 0 ? ` Could not be read: ${notRead}.` : ''
    }`,
  );
  if (r.mode === 'wave') {
    out.push(
      `- Criteria: ${r.criteria.length} of the ${r.activeCriteria.length} that could be read in the wave folders. Signed by the clinical reviewer: ${criteriaSigned} of ${r.criteria.length}. Not drafted: ${notDrafted.length}. Files not usable: ${notUsable.length}.`,
    );
    for (const wave of waves) {
      const inRun = wave.criteria.filter((c) => c.status === 'in_run').length;
      const more: string[] = [];
      const leftOut = wave.criteria.filter((c) => c.status === 'left_out').length;
      const undrafted = wave.criteria.filter((c) => c.status === 'not_drafted').length;
      const unusable = wave.criteria.filter((c) => c.status === 'not_usable').length;
      if (leftOut > 0) more.push(`${leftOut} left out by an option`);
      if (undrafted > 0) more.push(`${undrafted} not drafted`);
      if (unusable > 0) more.push(`${unusable} with files that are not usable`);
      out.push(`  - ${cell(wave.name)}: ${count(inRun, 'criterion', 'criteria')} in the run${more.length > 0 ? `, ${more.join(', ')}` : ''}.`);
    }
  } else {
    out.push(
      `- Criteria: ${r.criteria.length} of the ${r.activeCriteria.length} active. Signed by the clinical reviewer: ${criteriaSigned} of ${r.criteria.length}.`,
    );
  }
  if (t.needsAFact > 0) {
    out.push(`- Criteria that need a fact the supplies do not hold: ${t.needsAFact}. Criteria decided from the supplies alone: ${t.suppliesOnly}.`);
  }
  if (quick) {
    const p = quick.planned;
    out.push(
      `- Screenings planned: ${p.own + p.clean + p.sample}. A history against its own criterion: ${p.own}. A clean history against the first ten: ${p.clean}. The false-flag sample: ${p.sample}.`,
    );
  }
  out.push(`- Model calls made: ${t.calls.screen} to screen, ${t.calls.check} to double-check, ${t.calls.letter} to write letters.`);
  out.push('');

  // ----- the result -----
  out.push('## The result', '');
  out.push(`- ${resultSentence(score)}`);
  out.push(`- Planted findings caught: ${t.caught} of ${t.planted}. Disputed: ${t.disputed}. A disputed finding was suspected by Model 1 and turned back by Model 2. It is shown to the pharmacist. It is not a failure.`);
  const fh = t.factHistories;
  if (fh.noFactPlanted > 0) {
    out.push(
      `- Histories with no line about the fact (${code('pos-nofact')}): caught ${fh.noFactCaught} of ${fh.noFactPlanted}. Reported as a possible finding: ${fh.noFactPossible}. Reported as a plain finding: ${fh.noFactCaught - fh.noFactPossible}. Both count as caught.`,
    );
  }
  if (fh.withFactPlanted > 0) {
    out.push(
      `- Histories that hold the fact (${code('pos-fact')}): caught ${fh.withFactCaught} of ${fh.withFactPlanted}.${
        fh.withFactPossible > 0 ? ` Of these, reported as a possible finding all the same: ${fh.withFactPossible}.` : ''
      }`,
    );
  }
  if (t.possibleCaught > 0 && fh.noFactPlanted === 0 && fh.withFactPlanted === 0) {
    out.push(`- Caught findings that were reported as a possible finding: ${t.possibleCaught}.`);
  }
  if (r.mode === 'wave' || leftUnscored.length > 0) {
    out.push(`- Not drafted: ${notDrafted.length}. Files not usable: ${notUsable.length}. Neither was scored, and neither passes.`);
  }
  out.push(`- False flags: ${t.falseFlags}. A false flag is counted and shown. It is not a failure.`);
  if (score.ownCriterionOnly) {
    const by = t.falseFlagsByRole;
    out.push(
      `- Where the false flags were found: on a history written for the criterion ${by.own}, on a clean history ${by.clean}, in the false-flag sample ${by.sample}.`,
    );
    if (sampleInfo) {
      const s = t.sample;
      out.push(
        `- Sampled false-flag estimate: ${s.falseFlags} false ${s.falseFlags === 1 ? 'flag' : 'flags'} in ${s.answered} sampled screenings that got an answer (${percentText(s.falseFlags, s.answered)}). This is an estimate from a sample. It is shown on its own below.`,
      );
    }
  }
  out.push(`- Suspected findings that Model 2 turned back, where nothing was planted for that criterion: ${t.turnedBack}.`);
  out.push(`- Calls that could not be completed: ${t.notCompleted}. A failed call is never counted as a clean result.`);
  if (score.lettersRun) {
    const l = t.letters;
    out.push(
      `- Letters: ${l.produced} of ${l.needed}. Written by the model with no check notes: ${l.modelClean}. Written by the model with check notes: ${l.modelWithNotes}. Built from the template: ${l.template}. Missing: ${l.notProduced}. Without the planted lines: ${l.withoutPlanted}.`,
    );
  } else {
    out.push('- Letters: not run.');
  }
  const spent = { screen: 0, check: 0, letter: 0 };
  for (const s of score.criteria) {
    spent.screen += s.secondsByStage.screen;
    spent.check += s.secondsByStage.check;
    spent.letter += s.secondsByStage.letter;
  }
  const each = (total: number, calls: number): string => (calls > 0 ? `${secondsText(total / calls)} s each on average` : 'no call');
  out.push(
    `- Time in model calls: ${duration(t.seconds)}. Screen: ${secondsText(spent.screen)} s, ${each(spent.screen, t.calls.screen)}. Double-check: ${secondsText(spent.check)} s, ${each(spent.check, t.calls.check)}. Letters: ${secondsText(spent.letter)} s, ${each(spent.letter, t.calls.letter)}.`,
  );
  out.push('');

  // The criteria table. In a full run with further criteria in use it has two parts (G06): the
  // first ten in full, then the further criteria in quick mode, each with its count line.
  const signedIds = new Set(r.criteria.filter((c) => c.signed_by_clinical_reviewer !== null && c.signed_by_clinical_reviewer !== undefined).map((c) => c.id));
  const rowFor = (s: (typeof score.criteria)[number]): string =>
    `| ${cell(s.label)} | ${resultLabel(s.verdict)} | ${s.caught} / ${s.planted} | ${s.disputed} | ${s.textAttached ? 'yes' : 'no'} | ${s.falseFlags.length} | ${s.notCompleted.length} | ${lettersCell(s, score.lettersRun)} | ${secondsText(s.seconds)} | ${cell(s.criterionId)} | ${classLabel(s.class)} | ${wideCell(s.whyFailed)} |`;
  const countLine = (rows: typeof score.criteria, q: number): string => {
    const p = rows.filter((s) => s.verdict === 'PASS' || s.verdict === 'PASS_PART').length;
    const sCount = rows.filter((s) => signedIds.has(s.criterionId)).length;
    return `Count: ${p} of ${q} pass the planted-finding test. Signed by the clinical reviewer: ${sCount} of ${q}.`;
  };
  const tableHead = ['| Criterion | Result | Caught / planted | Disputed | Criterion text | False flags | Failed calls | Letters | Seconds | ID | Class | Why it failed |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  // Two parts only when the run names its further criteria (set by eval/run.ts, G06). Until then
  // the run stamps the headings onto the table after writeReport; the stamp does nothing when the
  // first heading is already here, so the two never double.
  const furtherIds = r.furtherIds ?? null;
  if (furtherIds !== null && furtherIds.length > 0 && r.mode === 'full') {
    const furtherSet = new Set(furtherIds);
    const tenRows = score.criteria.filter((s) => !furtherSet.has(s.criterionId));
    const furtherRows = score.criteria.filter((s) => furtherSet.has(s.criterionId));
    const furtherTotal = furtherIds.length;
    out.push('## THE FIRST TEN: FULL RUN', '');
    out.push(...tableHead);
    for (const s of tenRows) out.push(rowFor(s));
    out.push('', countLine(tenRows, tenRows.length), '');
    if (furtherRows.length === 0) {
      out.push('## FURTHER CRITERIA: NOT RUN YET', '');
    } else {
      out.push('## FURTHER CRITERIA: QUICK MODE (each history against its own criterion only)', '');
      out.push(`${furtherRows.length} of ${furtherTotal} further criteria were scored. ${furtherTotal - furtherRows.length} were not reached.`, '');
      out.push(...tableHead);
      for (const s of furtherRows) out.push(rowFor(s));
      out.push('', countLine(furtherRows, furtherTotal), '');
    }
  } else {
    // The last three columns: the ID of the criterion (its folder name), its class and, for a FAIL,
    // which history failed and at which step.
    out.push(...tableHead);
    for (const s of score.criteria) out.push(rowFor(s));
    // A criterion that was not scored still has its row, so the table shows every criterion of the wave folders.
    for (const n of leftUnscored) {
      out.push(`| ${cell(n.id)} | ${notPassingLabel(n.result)} | | | | | | | | ${cell(n.id)} | | ${wideCell(n.reason)} |`);
    }
    if (score.criteria.length === 0 && leftUnscored.length === 0) out.push('| (no criterion was run) | | | | | | | | | | | |');
  }
  out.push('');

  // ----- a wave run: each wave folder on its own -----
  if (r.mode === 'wave' && waves.length > 0) {
    out.push('## Each wave folder', '');
    out.push('| Wave folder | Criteria scored | PASS | Not passing | Not drafted | Files not usable | Caught / planted | Disputed | False flags | Seconds in model calls |');
    out.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const w of waveSummaries(waves, score)) {
      out.push(
        `| ${cell(w.name)} | ${w.scored} | ${w.pass} | ${w.notPassing} | ${w.notDrafted} | ${w.notUsable} | ${w.caught} / ${w.planted} | ${w.disputed} | ${w.falseFlags} | ${secondsText(w.seconds)} |`,
      );
    }
    out.push('');
    out.push('Not passing counts the criteria that were scored and did not pass. Seconds in model calls is the time spent in the calls for the criteria of that wave folder. Each model is loaded once for the whole run, and that time falls on the first call of each stage.');
    out.push('');
  }

  // ----- why each FAIL -----
  const failed = score.criteria.filter((s) => s.verdict === 'FAIL');
  if (failed.length > 0) {
    out.push('## Why each FAIL', '');
    for (const s of failed) {
      out.push(`- **${cell(s.label)}**: ${s.reasons.join(' ')}`);
      for (const failure of s.failures) out.push(`  - ${oneLine(failure.text, 400)}`);
    }
    out.push('');
  }

  // ----- what the run did not cover -----
  const withCaveats = score.criteria.filter((s) => s.caveats.length > 0);
  if (withCaveats.length > 0) {
    out.push('## What this run did not cover', '');
    for (const s of withCaveats) out.push(`- **${cell(s.label)}**: ${s.caveats.join(' ')}`);
    out.push('');
  }

  // ----- a wave run: what was not scored -----
  if (notDrafted.length > 0) {
    out.push('## Not drafted', '');
    out.push('These criterion folders hold a note that says the criterion was not drafted. They were not scored.', '');
    for (const n of notDrafted) out.push(`- **${cell(n.id)}**${n.wave ? ` (${cell(n.wave)})` : ''}: not drafted.`);
    out.push('');
  }
  if (notUsable.length > 0) {
    out.push('## Files not usable', '');
    out.push('A criterion file, an answer part or a history of these criteria could not be loaded. They were not scored. The other criteria ran.', '');
    for (const n of notUsable) out.push(`- **${cell(n.id)}**${n.wave ? ` (${cell(n.wave)})` : ''}: ${oneLine(n.reason, 500)}`);
    out.push('');
  }

  // ----- disputed planted findings -----
  const disputes = score.criteria.flatMap((s) => s.disputes.map((d) => ({ s, d })));
  out.push('## Disputed findings', '');
  if (disputes.length === 0) {
    out.push('None. Model 2 did not turn back a planted finding.');
  } else {
    out.push('Model 1 suspected these planted findings and Model 2 turned them back. Each one is shown to the pharmacist, who decides. None of them is a failure, and none of them needs a letter in this run.', '');
    for (const { s, d } of disputes) {
      out.push(`- **${cell(s.label)}** on ${code(d.caseFile)}. ${d.detail}`);
      out.push(`  - Lines cited by Model 1: ${idList(d.citedByScreen)}. Lines cited by Model 2: ${idList(d.citedByCheck)}.`);
    }
  }
  out.push('');

  // ----- misses -----
  out.push('## Misses', '');
  const misses = score.criteria.flatMap((s) => s.misses.map((miss) => ({ s, miss })));
  if (misses.length === 0) {
    out.push(t.planted === 0
      ? 'No planted finding was in this run.'
      : t.disputed > 0
        ? 'None. No planted finding was missed. A disputed finding is listed above. It is not a miss.'
        : 'None. Every planted finding in this run was caught.');
  }
  for (const { s, miss } of misses) {
    out.push(`- **${cell(s.label)}** on ${code(miss.caseFile)}. ${miss.detail}`);
    out.push(`  - Lines that had to be cited: ${groupsText(miss.mustCite)}.`);
    out.push(...lineItems(miss.caseFile, [...new Set(miss.mustCite.flat())], '    '));
    out.push(`  - Lines cited by Model 1: ${idList(miss.citedByScreen)}. Lines cited by Model 2: ${idList(miss.citedByCheck)}.`);
    const about = caseOf.get(miss.caseFile)?.about ?? '';
    if (about !== '') out.push(`  - What was planted: ${oneLine(about)}`);
  }
  out.push('');

  // ----- caught, with an unclear second check -----
  const unclear = score.criteria.flatMap((s) => s.catches.filter((c) => c.unclear).map((c) => ({ s, c })));
  if (unclear.length > 0) {
    out.push('## Caught with an unclear second check', '');
    out.push('Model 2 answered "not confirmed" but named lines as proof. The app shows such a finding under the bell, marked "second check unclear", so it counts as caught.', '');
    for (const { s, c } of unclear) {
      out.push(`- **${cell(s.label)}** on ${code(c.caseFile)}. Lines cited by Model 1: ${idList(c.citedByScreen)}. Lines cited by Model 2: ${idList(c.citedByCheck)}.`);
    }
    out.push('');
  }

  // ----- possible findings -----
  const possible = score.criteria.flatMap((s) => s.catches.filter((c) => c.possible).map((c) => ({ s, c })));
  const plainOnNoFact = score.criteria.flatMap((s) => s.catches.filter((c) => !c.possible && historyKind(c.caseFile) === 'no_fact').map((c) => ({ s, c })));
  if (possible.length > 0 || plainOnNoFact.length > 0 || fh.noFactPlanted > 0) {
    out.push('## Possible findings', '');
    out.push(
      'A possible finding: the medicines match, and the record holds no line about a fact the criterion needs. The app shows it under the bell as a possible finding, and the letter asks the doctor to confirm the fact. It counts as caught.',
      '',
    );
    if (possible.length === 0) out.push('No caught finding was reported as a possible finding.');
    for (const { s, c } of possible) {
      const where = historyKind(c.caseFile) === 'with_fact' ? ' This record does hold the fact.' : '';
      out.push(`- **${cell(s.label)}** on ${code(c.caseFile)}. The record does not show: ${factsText(c.missingFacts) || 'the fact was not named'}.${where}`);
    }
    if (plainOnNoFact.length > 0) {
      out.push('', 'Caught on a history with no line about the fact, and reported as a plain finding, not a possible one. It still counts as caught:', '');
      for (const { s, c } of plainOnNoFact) out.push(`- **${cell(s.label)}** on ${code(c.caseFile)}.`);
    }
    out.push('');
  }

  // ----- false flags -----
  out.push('## False flags', '');
  out.push('A false flag is a confirmed finding where nothing was planted. It is counted and shown. It is not a failure.', '');
  const flags = score.criteria.flatMap((s) => s.falseFlags.map((flag) => ({ s, flag })));
  if (flags.length === 0) out.push('None in this run.');
  for (const { s, flag } of flags) {
    out.push(`- **${cell(s.label)}** on ${code(flag.caseFile)}, ${kindPhrase(flag.caseKind, flag.ownFolder)}.${flag.unclear ? ' The second check was unclear: it said "not confirmed" but named lines as proof.' : ''}${flag.possible ? ' It was reported as a possible finding.' : ''}${rolePhrase(flag.role)}`);
    out.push(`  - Lines cited by Model 1: ${idList(flag.citedByScreen)}. Lines cited by Model 2: ${idList(flag.citedByCheck)}.`);
    out.push(...lineItems(flag.caseFile, [...new Set([...flag.citedByScreen, ...flag.citedByCheck])], '    '));
    if (flag.screenReason !== '') out.push(`  - Model 1 said: ${quoted(flag.screenReason)}`);
    if (flag.checkWhatMatches !== '') out.push(`  - Model 2 said: ${quoted(flag.checkWhatMatches)}`);
    const about = caseOf.get(flag.caseFile)?.about ?? '';
    if (about !== '') out.push(`  - About this history: ${oneLine(about)}`);
  }
  out.push('');

  // ----- the false-flag sample of a quick run, on its own -----
  if (sampleInfo) {
    const s = t.sample;
    out.push('## Sampled false-flag estimate', '');
    out.push(
      `A quick run screens a history against its own criterion only, so it cannot count every false flag. To estimate them, one history in ${sampleInfo.oneIn} was also screened against up to ${sampleInfo.perHistory} other criteria. The histories and the criteria were chosen by a fixed seed (${sampleInfo.seed}), so the same test set gives the same sample.`,
      '',
    );
    out.push(`- Histories sampled: ${sampleInfo.histories.length} of the ${sampleInfo.eligible} that could be sampled.`);
    out.push(`- Sampled screenings planned: ${s.screenings}. Got an answer: ${s.answered}. Could not be completed: ${s.notCompleted}.`);
    out.push(`- False flags in the sample: ${s.falseFlags} of ${s.answered} (${percentText(s.falseFlags, s.answered)}). Suspected by Model 1 and turned back by Model 2: ${s.turnedBack}.`);
    out.push('- Nothing was planted for these pairs, so a confirmed finding here counts as a false flag. A history can still truly meet another criterion that nobody planted. Each one is listed under "False flags". Read it.');
    out.push('- This is an estimate from a sample. It is not a count of the whole test set, and it is not a failure.');
    out.push('');
  }

  // ----- calls that could not be completed -----
  out.push('## Calls that could not be completed', '');
  const incomplete = score.criteria.flatMap((s) => s.notCompleted.map((item) => ({ s, item })));
  if (incomplete.length === 0) out.push('None in this run.');
  for (const { s, item } of incomplete) {
    out.push(
      `- **${cell(s.label)}** on ${code(item.caseFile)} (${stagePhrase(item.stage)})${
        item.planted ? ', a history with a planted finding for this criterion' : ''
      }. ${item.detail}${item.role === 'sample' ? ' This call was part of the false-flag sample.' : ''}`,
    );
  }
  out.push('');

  // ----- letters -----
  out.push('## Letters', '');
  if (!score.lettersRun) {
    out.push('Letters were not run.');
  } else {
    const letterLines = score.criteria.flatMap((s) => s.letterLines.map((line) => ({ s, line })));
    if (letterLines.length === 0) out.push('No letter was needed. A letter is written for each caught planted finding.');
    for (const { s, line } of letterLines) {
      out.push(`- **${cell(s.label)}** on ${code(line.caseFile)}. ${line.detail}`);
      for (const note of line.checkNotes) out.push(`  - Check note: ${quoted(note)}`);
      for (const seen of line.observations) out.push(`  - Also seen, not part of the result: ${oneLine(seen)}`);
    }
  }
  out.push('');

  // ----- problems found before the run -----
  const problems: string[] = [...r.sheet.warnings];
  for (const c of r.cases) {
    if (c.cannotAssess !== null) problems.push(`${c.file}: the history was not screened. ${oneLine(c.cannotAssess)}`);
  }
  const notScored = [...new Set(score.unscored.map((u) => u.criterionId))];
  if (problems.length > 0 || notScored.length > 0) {
    out.push('## Things to look at', '');
    for (const p of problems) out.push(`- ${oneLine(p, 500)}`);
    if (notScored.length > 0) {
      out.push(`- Planted findings for these criteria were not scored, because the criteria were not in this run: ${notScored.join(', ')}.`);
    }
    out.push('');
  }

  // ----- how to read it -----
  out.push('## How to read the table', '');
  out.push('- PASS: no planted finding was missed. A finding Model 1 suspected and Model 2 turned back is disputed: it is shown to the pharmacist and it is not a miss. The criterion text and its credit line are attached, and a letter was produced for every caught finding. A disputed finding has no letter in a scored run.');
  out.push('- PASS (part run): nothing failed, but the run did not cover everything. It is not a full pass.');
  out.push('- FAIL: a planted finding was missed, or the criterion text is missing, or a letter is missing, or a letter does not show the planted lines, or a call could not be completed on a history with a planted finding. A disputed finding is not a miss.');
  out.push('- NOT TESTED: no planted finding for the criterion was in this run.');
  out.push('- Caught: Model 2 confirmed the finding, and the planted lines were cited by Model 1 or by Model 2. The app shows the lines of both models under the bell and prints them in the letter.');
  out.push('- Disputed: Model 1 suspected the planted finding and Model 2 turned it back. The count sits beside the caught count. It is not a failure.');
  out.push('- Criterion text: yes when the criterion file has its statement and its credit line. The app shows them with the finding.');
  out.push('- False flags: confirmed findings where nothing was planted. They are never a failure.');
  out.push('- Failed calls: model calls that could not be completed, and histories that could not be read.');
  out.push('- Letters: a letter built from the template counts as a letter. It is counted on its own. A text without the criterion text is not counted as a letter. A letter must show the planted lines.');
  out.push('- When Model 3 did not answer at all, the template letter is still shown, and the failed call is listed under "Calls that could not be completed".');
  out.push('- Seconds: time spent in the model calls for the criterion. The first call to a model includes loading it.');
  out.push('- ID: the name the criterion goes by in the folders, in the lists and in results.json.');
  out.push('- Class: "supplies only" when the criterion is decided from the supplies alone. "needs a fact" when it also needs a condition, a result or a measurement.');
  out.push('- Why it failed: for a FAIL, which history failed and at which step. Not suspected by Model 1. Call could not be completed. Letter missing. A finding Model 2 turned back is disputed, and it is not in this column.');
  if (t.needsAFact > 0 || t.possibleCaught > 0) {
    out.push('- Possible finding: the medicines match and the record holds no line about the fact. It reaches the bell marked as possible, and the letter asks the doctor to confirm the fact. It counts as caught.');
    out.push('- A history named pos-fact holds the fact: the finding must be confirmed and the fact line must be cited. A history named pos-nofact holds no line about the fact: the finding is caught when it is confirmed, possible or not.');
    out.push('- A near miss that is confirmed is a false flag. It is counted and it is never a failure.');
  }
  if (score.ownCriterionOnly) {
    out.push('- In a quick run and a wave run a history is screened against its own criterion only. So the false flag count covers only the screenings that were made.');
  }
  if (r.mode === 'wave' || leftUnscored.length > 0) {
    out.push('- NOT DRAFTED: the folder holds a note in place of the criterion. FILES NOT USABLE: a file of the criterion could not be loaded. Neither was scored.');
  }
  out.push(`- The file ${code('results.json')} lists the criteria that pass under ${code('passing')} and every other one, with its reason, under ${code('not_passing')}.`);
  out.push('');
  out.push('The file `results.json` in this folder holds everything. The folder `raw` holds every model answer.');
  out.push('');
  return withModelNames(out.join('\n'));
}

/** The tables a person reads use the three names from the settings. results.json is not changed here. */
function withModelNames(text: string): string {
  const names = loadConfig(process.cwd()).modelNames;
  return text.replaceAll('Model 1', names.screen).replaceAll('Model 2', names.check).replaceAll('Model 3', names.letter);
}

// ---------- raw answers ----------

export type RawStage = 'screen' | 'check' | 'letter';
const RAW_STAGES: RawStage[] = ['screen', 'check', 'letter'];

export function rawBaseName(caseFile: string, criterionId: string): string {
  const safe = (s: string): string => s.replace(/[\\/]+/g, '__').replace(/[^A-Za-z0-9._-]+/g, '_');
  return `${safe(caseFile)}__${safe(criterionId)}`;
}

// Writes what one call answered. Returns the files written (none when no call was made).
export function writeRaw(outDir: string, stage: RawStage, pair: PairRecord): string[] {
  let call: ScreenCall | CheckCall | LetterCall | undefined;
  let answer: unknown;
  let findingId: string | undefined;
  if (stage === 'screen') {
    call = pair.screen;
    answer = pair.screen.result;
  } else if (stage === 'check') {
    call = pair.check;
    answer = pair.check?.result;
    findingId = pair.check?.findingId;
  } else {
    call = pair.letter;
    answer = pair.letter?.draft;
    findingId = pair.letter?.findingId;
  }
  if (!call || call.status === 'not_run' || call.status === 'not_read') return [];

  const dir = path.join(outDir, 'raw', stage);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, rawBaseName(pair.caseFile, pair.criterionId));
  const record = {
    stage,
    caseFile: pair.caseFile,
    criterionId: pair.criterionId,
    findingId: findingId ?? null,
    status: call.status,
    seconds: call.seconds,
    error: call.error ?? null,
    answer: answer ?? null,
  };
  const written = [`${base}.json`];
  fs.writeFileSync(`${base}.json`, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  if (stage === 'letter' && pair.letter?.draft && typeof pair.letter.draft.body === 'string') {
    const draft = pair.letter.draft;
    fs.writeFileSync(`${base}.txt`, `Subject: ${draft.subject ?? ''}\n\n${draft.body}\n`, 'utf8');
    written.push(`${base}.txt`);
  }
  return written;
}

// ---------- everything ----------

export interface WrittenReport {
  outDir: string;
  table: string;
  results: string;
  rawDir: string;
  rawFiles: number;
}

export function writeReport(outDir: string, results: EvalResults): WrittenReport {
  fs.mkdirSync(outDir, { recursive: true });
  const rawDir = path.join(outDir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  let rawFiles = 0;
  for (const pair of results.pairs) {
    for (const stage of RAW_STAGES) rawFiles += writeRaw(outDir, stage, pair).length;
  }
  const table = path.join(outDir, 'table.md');
  const json = path.join(outDir, 'results.json');
  fs.writeFileSync(json, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  fs.writeFileSync(table, renderTable(results), 'utf8');
  return { outDir, table, results: json, rawDir, rawFiles };
}
