import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeConfig } from '../pipeline/config.ts';
import { loadCriteriaReport } from '../pipeline/criteria.ts';
import { Engine } from '../server/engine.ts';
import { PageImages } from '../server/images.ts';
import { StateStore } from '../server/store.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback = '') => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const history = path.resolve(option('--history', path.join(ROOT, 'server', 'fixtures', 'mega', 'M01-dispense-history.csv')));
const csvText = fs.readFileSync(history, 'utf8');
const loaded = await loadCriteriaReport(ROOT);
const made = [];

async function importWithMarkers(on) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `k-path-3-markers-${on ? 'on' : 'off'}-`));
  made.push(dir);
  const store = new StateStore(dir);
  store.load();
  const screenCalls = [];
  const pipeline = {
    screenCriterion: async (_cfg, _patient, _lines, criterion) => {
      screenCalls.push(criterion.id);
      return { ok: true, suspected: false, result: {
        lineIds: [], medicines: [], missingFacts: [], reason: 'Stand-in: no finding, so this measurement counts import questions only.',
        linesVerified: true, model: 'stand-in-screen', at: '2026-11-20T12:00:00.000Z', seconds: 0.01
      } };
    },
    checkFinding: async () => { throw new Error('No suspected finding is made by this stand-in.'); },
    draftLetter: async () => { throw new Error('No letter is made by this stand-in.'); },
    transcribePageImage: async () => { throw new Error('No picture is read by this stand-in.'); }
  };
  const engine = new Engine({
    cfg: normalizeConfig({ conditionMarkers: on }), store, pipeline,
    images: new PageImages(path.join(dir, 'images')),
    conditionMarkersFile: path.join(ROOT, 'criteria', '_markers', 'condition-markers.json'),
    loadCriteria: async () => loaded, warmup: false, modelsUp: async () => true,
    now: () => new Date('2026-11-20T22:00:00+10:00')
  });
  await engine.start();
  await engine.importCase({ fileName: path.basename(history), source: 'csv', csvText });
  await engine.whenIdle();
  const c = engine.state.cases[0];
  const questions = (c.questions ?? []).filter(q => q.status === 'open').map(q => ({
    id: q.id, kind: q.kind, what: q.what, source: q.source, needsValue: q.needsValue,
    question: q.conditionMarker?.question ?? q.what,
    reason: q.note ?? '', criterionIds: q.criterionIds,
    conditionMarker: q.conditionMarker ?? null,
    options: q.options.map(item => item.words),
    pathology: q.pathology ?? null
  }));
  return {
    on,
    questionCount: questions.length,
    markerQuestionCount: questions.filter(q => q.conditionMarker).length,
    questions,
    screenCalls: screenCalls.length,
    screeningStatus: c.screening.status,
    waitingCriteria: c.screening.criteria.filter(item => item.status === 'waiting').map(item => item.criterionId)
  };
}

try {
  const off = await importWithMarkers(false);
  const on = await importWithMarkers(true);
  const offKeys = new Set(off.questions.map(q => `${q.kind}\0${q.what}`));
  const added = on.questions.filter(q => !offKeys.has(`${q.kind}\0${q.what}`));
  const removed = off.questions.filter(q => !new Set(on.questions.map(q => `${q.kind}\0${q.what}`)).has(`${q.kind}\0${q.what}`));
  const result = {
    generatedAt: new Date().toISOString(), history,
    criteriaInUse: loaded.criteria.length, criteriaProblems: loaded.problems,
    off, on, addedCount: added.length, added, removed,
    duplicates: Object.values(on.questions.reduce((groups, q) => {
      const key = q.conditionMarker?.condition ?? '';
      if (!key) return groups;
      (groups[key] ??= []).push({ what: q.what, question: q.question, criterionIds: q.criterionIds });
      return groups;
    }, {})).filter(items => items.length > 1)
  };
  const out = path.resolve(option('--out', path.join(ROOT, 'data', 'tmp', 'K-PATH-3-condition-markers.json')));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  console.log(`Criteria in use: ${loaded.criteria.length}; load problems: ${loaded.problems.length}`);
  console.log(`OFF: ${off.questionCount} open questions; ON: ${on.questionCount}; added: ${added.length}; removed: ${removed.length}`);
  console.log(`ON marker questions: ${on.markerQuestionCount}; duplicate marker condition groups: ${result.duplicates.length}`);
  for (const [index, q] of added.entries()) console.log(`${index + 1}. ${q.question}\n   ${q.reason}`);
  console.log(`Written: ${out}`);
} finally {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
}
