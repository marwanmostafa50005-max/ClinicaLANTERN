import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../pipeline/csv.ts';
import { loadConditionMarkers, syncCaseQuestions } from '../server/questions.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function option(name, fallback = '') {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function normal(name) {
  return String(name).trim().toLowerCase();
}

function readCriteria(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({ id: entry.name, file: path.join(directory, entry.name, 'criterion.json') }))
    .filter(entry => fs.existsSync(entry.file))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(entry => readJson(entry.file));
}

function reportGaps(markerData, criteria) {
  const conditions = Array.isArray(markerData.conditions) ? markerData.conditions : [];
  const needed = new Map();
  const listed = new Set();
  for (const criterion of criteria) {
    for (const fact of criterion.needs_facts ?? []) {
      if (!needed.has(normal(fact.what))) needed.set(normal(fact.what), fact);
    }
  }
  const unmatchedFactNames = [];
  for (const marker of conditions) {
    for (const rawName of marker.fact_names ?? []) {
      const factName = String(rawName).trim();
      listed.add(normal(factName));
      if (!needed.has(normal(factName))) {
        unmatchedFactNames.push({ condition: marker.condition, factName });
      }
    }
  }
  const unlistedConditionFacts = [];
  let criteriaWithListedConditionFact = 0;
  let criteriaWithUnlistedConditionFact = 0;
  for (const criterion of criteria) {
    const facts = (criterion.needs_facts ?? []).filter(fact => fact.kind === 'condition');
    const matched = facts.filter(fact => listed.has(normal(fact.what)));
    const missing = facts.filter(fact => !listed.has(normal(fact.what)));
    if (matched.length > 0) criteriaWithListedConditionFact++;
    if (missing.length > 0) {
      criteriaWithUnlistedConditionFact++;
      unlistedConditionFacts.push({ criterionId: criterion.id, factNames: missing.map(fact => fact.what) });
    }
  }
  return {
    counts: {
      conditions: conditions.length,
      factNames: conditions.reduce((count, marker) => count + (marker.fact_names?.length ?? 0), 0),
      criteriaWithListedConditionFact,
      criteriaWithUnlistedConditionFact
    },
    unmatchedFactNames,
    unlistedConditionFacts
  };
}

function historyQuestions(file, markerFile, criteria) {
  const parsed = parseCsv(fs.readFileSync(file, 'utf8'));
  if (parsed.problems.length > 0) throw new Error(`The history cannot be assessed: ${parsed.problems.join(' ')}`);
  const markers = loadConditionMarkers(markerFile, line => console.error(line));
  const c = {
    id: 'C0001', fileName: path.basename(file), importedAt: '2026-11-20T00:00:00.000Z', source: 'csv',
    patient: parsed.patient, lines: parsed.lines, transcriptionConfirmed: true, parts: 1,
    screening: { status: 'not_started', criteria: [] }, questions: []
  };
  syncCaseQuestions(c, criteria, [], [], markers);
  const byId = new Map(c.lines.map(line => [line.id, line.text]));
  return {
    file: path.resolve(file),
    patient: c.patient,
    questions: (c.questions ?? []).filter(question => question.conditionMarker).map(question => ({
      condition: question.conditionMarker.condition,
      question: question.conditionMarker.question,
      kind: question.kind,
      what: question.what,
      supplyLineIds: question.conditionMarker.lineIds,
      supplyLines: question.conditionMarker.lineIds.map(id => byId.get(id)),
      criterionIds: question.criterionIds,
      reason: question.note
    }))
  };
}

function printReport(report) {
  console.log(`Conditions in the list: ${report.counts.conditions}`);
  console.log(`Fact names: ${report.counts.factNames}`);
  console.log(`Criteria with at least one listed condition fact: ${report.counts.criteriaWithListedConditionFact}`);
  console.log(`Criteria with an unlisted condition fact: ${report.counts.criteriaWithUnlistedConditionFact}`);
  console.log(`\nFact names with no matching needs_facts what (${report.unmatchedFactNames.length})`);
  for (const item of report.unmatchedFactNames) console.log(`- ${item.condition}: ${item.factName}`);
  console.log(`\nCondition facts with no list entry (${report.unlistedConditionFacts.reduce((n, item) => n + item.factNames.length, 0)})`);
  for (const item of report.unlistedConditionFacts) console.log(`- ${item.criterionId}: ${item.factNames.join('; ')}`);
  if (!report.history) return;
  console.log(`\nQuestions the marker rule opens for ${report.history.file} (${report.history.questions.length})`);
  report.history.questions.forEach((item, index) => {
    console.log(`\n${index + 1}. ${item.condition}: ${item.question}`);
    console.log(`   Fact: ${item.what} (${item.kind})`);
    console.log(`   Criteria that wait: ${item.criterionIds.join(', ')}`);
    console.log('   Supply lines that open it:');
    item.supplyLineIds.forEach((id, i) => console.log(`   - ${id}: ${item.supplyLines[i]}`));
    console.log(`   Reason: ${item.reason}`);
  });
}

const markerFile = path.resolve(option('--markers', path.join(root, 'criteria', '_markers', 'condition-markers.json')));
const criteriaDir = path.resolve(option('--criteria-dir', path.join(root, 'criteria')));
const criteria = readCriteria(criteriaDir);
const report = reportGaps(readJson(markerFile), criteria);
const history = option('--history');
if (history) report.history = historyQuestions(path.resolve(history), markerFile, criteria);
printReport(report);
const json = option('--json');
if (json) {
  fs.writeFileSync(path.resolve(json), JSON.stringify(report, null, 2) + '\n');
  console.log(`\nJSON written to ${path.resolve(json)}`);
}
