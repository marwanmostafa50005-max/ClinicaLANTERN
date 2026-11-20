import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const roundMinutes = ms => Math.round((ms / 60000) * 1000) / 1000;

export function answerBodyFor(question, entry) {
  if (entry && typeof entry.answer === 'object' && entry.answer !== null) {
    const body = {};
    for (const key of ['value', 'unit', 'date']) {
      if (entry.answer[key] !== undefined) body[key] = entry.answer[key];
    }
    return body;
  }
  if (entry && typeof entry.answer === 'string') return { option: entry.answer };
  const options = Array.isArray(question.options) ? question.options : [];
  const notKnown = options.find(option => typeof option.words === 'string' && option.words.trim().toLowerCase() === 'not known');
  const unknown = notKnown ?? options.find(option => option.effect === 'unknown');
  if (!unknown) throw new Error(`No Not known choice is offered for ${question.what ?? question.key ?? question.id}.`);
  return { option: unknown.words };
}

function parseArguments(argv) {
  const options = { minutes: 12, acceptFirst: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--accept-first') options.acceptFirst = true;
    else if (arg === '--base') options.base = argv[++i];
    else if (arg === '--history') options.history = argv[++i];
    else if (arg === '--answers') options.answers = argv[++i];
    else if (arg === '--out') options.out = argv[++i];
    else if (arg === '--minutes') options.minutes = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  for (const key of ['base', 'history', 'answers', 'out']) {
    if (!options[key]) throw new Error('Usage: node eval/rehearsal/rehearse.mjs --base http://127.0.0.1:<port> --history <csv> --answers <json> --out <folder> [--minutes 12] [--accept-first]');
  }
  if (!Number.isFinite(options.minutes) || options.minutes <= 0) throw new Error('--minutes must be a positive number.');
  return options;
}

function findingView(finding, caseRecord) {
  const lineIds = [...new Set((finding.check?.lineIds?.length ? finding.check.lineIds : finding.screen?.lineIds) ?? [])];
  return {
    id: finding.id,
    criterion: finding.criterionId,
    status: finding.state,
    possible: Boolean(finding.possible),
    decision: finding.decision?.action ?? null,
    lineIds,
    citedLines: lineIds.map(id => ({ id, text: caseRecord?.lines?.find(line => line.id === id)?.text ?? '' }))
  };
}

function letterIncludes(letter, findingId) {
  return letter.findingId === findingId || Boolean(letter.findingIds?.includes(findingId));
}

function letterReady(letter) {
  return letter.status === 'ready' && Boolean(letter.draft) && (letter.points ?? []).every(point => Boolean(point.draft));
}

function markdown(summary) {
  const lines = [
    '# ClinicaLANTERN rehearsal', '',
    `- Started: ${summary.startedAt}`,
    `- Ended: ${summary.endedAt}`,
    `- Elapsed minutes: ${summary.elapsedMinutes}`,
    `- Case: ${summary.caseId ?? 'not imported'}`,
    `- Questions asked: ${summary.questions.asked}; answered by this driver: ${summary.questions.answered}`,
    `- Answers from file: ${summary.questions.answeredFromFile}; Not known: ${summary.questions.notKnown}`,
    `- Minutes to first finding: ${summary.minutesToFirstFinding ?? 'none'}`,
    `- Minutes to letter: ${summary.minutesToLetter ?? 'none'}`,
    `- Minutes to paper-sent letter: ${summary.minutesToLetterSent ?? 'none'}`, '',
    '## Questions', ''
  ];
  for (const q of summary.questions.details) {
    lines.push(`- ${q.id} | ${q.key} | ${q.fact} | ${q.status} | ${q.criteria.join(', ')}${q.driverAnswer ? ` | sent ${JSON.stringify(q.driverAnswer)}` : ''}`);
  }
  lines.push('', '## Unlisted questions answered Not known', '');
  if (summary.questions.unlisted.length === 0) lines.push('- None');
  for (const q of summary.questions.unlisted) lines.push(`- ${q.id} | ${q.key} | ${q.fact} | ${q.criteria.join(', ')}`);
  lines.push('', '## Findings by status', '');
  for (const [status, findings] of Object.entries(summary.findingsByStatus)) {
    lines.push(`### ${status}`, '');
    for (const finding of findings) lines.push(`- ${finding.id} | ${finding.criterion} | possible ${finding.possible} | cited ${finding.lineIds.join(', ') || 'none'}`);
  }
  if (Object.keys(summary.findingsByStatus).length === 0) lines.push('- None');
  lines.push('', '## Letters', '');
  if (summary.letters.length === 0) lines.push('- None');
  for (const letter of summary.letters) lines.push(`- ${letter.id} | ${letter.status} | findings ${letter.findingIds.join(', ')}`);
  lines.push('', '## API errors', '');
  if (summary.errors.length === 0) lines.push('- None');
  for (const error of summary.errors) lines.push(`- ${error.at} | ${error.method} ${error.path} | HTTP ${error.status} | ${error.error}`);
  lines.push('', '## Timeline', '');
  for (const event of summary.timeline) {
    const { at, elapsedSeconds, type, ...detail } = event;
    lines.push(`- ${at} | +${elapsedSeconds}s | ${type} | ${JSON.stringify(detail)}`);
  }
  return lines.join('\n') + '\n';
}

export async function runRehearsal(options) {
  const base = options.base.replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const pollMs = options.pollMs ?? 2500;
  const startedMs = Date.now();
  const deadline = startedMs + options.minutes * 60000;
  const startedAt = new Date(startedMs).toISOString();
  const timeline = [];
  const errors = [];
  const allQuestions = new Map();
  const questionStatuses = new Map();
  const questionAnswers = new Map();
  const unlisted = new Map();
  const failedAnswers = new Map();
  const attempted = new Set();
  const findingsSeen = new Map();
  const finalFindings = new Map();
  const finalLetters = new Map();
  const answerRows = JSON.parse(fs.readFileSync(options.answers, 'utf8').replace(/^\uFEFF/, ''));
  if (!Array.isArray(answerRows)) throw new Error('The answers file must hold a JSON array.');
  const byKey = new Map();
  for (const row of answerRows) {
    if (!row || typeof row.key !== 'string') throw new Error('Every answer entry needs a string key.');
    byKey.set(row.key, row);
  }
  let caseId;
  let importMs;
  let firstFinding = null;
  let firstFindingMs = null;
  let letterMs = null;
  let letterSentMs = null;
  let acceptedFindingId = null;
  let letterFlowStarted = false;
  let lastModel = '';
  let lastState = null;
  let fatal = null;

  fs.mkdirSync(options.out, { recursive: true });
  const record = (type, detail = {}) => {
    const now = Date.now();
    timeline.push({ at: new Date(now).toISOString(), elapsedSeconds: Math.round((now - startedMs) / 100) / 10, type, ...detail });
  };
  const elapsedFromImport = () => importMs === undefined ? null : roundMinutes(Date.now() - importMs);
  const call = async (method, apiPath, body) => {
    let res;
    try {
      res = await fetchImpl(base + apiPath, {
        method,
        cache: 'no-store',
        headers: method === 'GET' ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {})
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ at: new Date().toISOString(), method, path: apiPath, status: 0, error: message });
      throw error;
    }
    const text = await res.text();
    let data;
    try { data = text === '' ? undefined : JSON.parse(text); } catch { data = undefined; }
    if (!res.ok) {
      const message = typeof data?.error === 'string' ? data.error : (text || `HTTP ${res.status}`);
      errors.push({ at: new Date().toISOString(), method, path: apiPath, status: res.status, error: message });
      const error = new Error(message);
      error.status = res.status;
      throw error;
    }
    return data;
  };
  const observe = response => {
    lastState = response;
    const state = response.state;
    const modelKey = `${response.now?.stage ?? ''}\u0000${response.now?.text ?? ''}`;
    if (modelKey !== lastModel) {
      lastModel = modelKey;
      record('models', { stage: response.now?.stage ?? null, text: response.now?.text ?? '' });
    }
    const c = state.cases.find(item => item.id === caseId);
    for (const q of c?.questions ?? []) {
      const previous = questionStatuses.get(q.id);
      const view = {
        id: q.id,
        key: q.key,
        fact: q.what,
        shown_as: q.question ?? q.conditionMarker?.question ?? q.what,
        criteria: q.criterionIds ?? [],
        kind: q.kind,
        status: q.status,
        answer: q.answer?.words ?? null,
        driverAnswer: questionAnswers.get(q.id) ?? null
      };
      allQuestions.set(q.id, view);
      if (q.status === 'open' && previous !== 'open') record('question_opened', view);
      if ((q.status === 'answered' || q.status === 'not_known') && previous !== undefined && previous !== q.status) record('question_answered', view);
      questionStatuses.set(q.id, q.status);
    }
    for (const finding of state.findings.filter(item => item.caseId === caseId)) {
      const view = findingView(finding, c);
      finalFindings.set(finding.id, view);
      const previous = findingsSeen.get(finding.id);
      if (!previous) {
        findingsSeen.set(finding.id, finding.state);
        record('finding', view);
        if (!firstFinding) {
          firstFinding = view;
          firstFindingMs = Date.now();
        }
      } else if (previous !== finding.state) {
        findingsSeen.set(finding.id, finding.state);
        record('finding_status', view);
      }
    }
    for (const letter of state.letters.filter(item => item.caseId === caseId)) {
      const view = { id: letter.id, status: letter.status, findingIds: letter.findingIds ?? [letter.findingId] };
      finalLetters.set(letter.id, view);
      if (letterMs === null && letter.status === 'ready') letterMs = Date.now();
    }
  };
  const pause = async () => {
    const remaining = deadline - Date.now();
    if (remaining > 0) await sleep(Math.min(pollMs, remaining));
  };

  record('run_started', { base, history: path.resolve(options.history), answers: path.resolve(options.answers), acceptFirst: Boolean(options.acceptFirst) });
  try {
    let ready = false;
    while (!ready && Date.now() < deadline) {
      try {
        const health = await call('GET', '/api/health');
        ready = health.ollama === 'up' && health.models?.screen === true && health.models?.check === true && health.models?.letter === true;
      } catch {}
      if (!ready) await pause();
    }
    if (!ready) throw new Error('The server did not report that all three models were ready before --minutes expired.');
    record('models_ready');
    importMs = Date.now();
    const imported = await call('POST', '/api/cases', {
      fileName: path.basename(options.history),
      source: 'csv',
      csvText: fs.readFileSync(options.history, 'utf8')
    });
    caseId = imported.caseId;
    record('imported', { caseId });

    while (Date.now() < deadline) {
      observe(await call('GET', '/api/state'));
      if (options.acceptFirst && !acceptedFindingId) {
        const finding = lastState.state.findings.find(item => item.caseId === caseId && item.state === 'confirmed' && !item.possible && !item.decision);
        if (finding) {
          await call('POST', `/api/findings/${encodeURIComponent(finding.id)}/decision`, { action: 'accept' });
          acceptedFindingId = finding.id;
          record('finding_accepted', { id: finding.id, criterion: finding.criterionId });
        }
      }
      if (acceptedFindingId && !letterFlowStarted) {
        const letter = lastState.state.letters.find(item => item.caseId === caseId && letterIncludes(item, acceptedFindingId) && letterReady(item));
        if (letter) {
          letterFlowStarted = true;
          await call('POST', `/api/letters/${encodeURIComponent(letter.id)}/agree`, { agreed: true });
          record('patient_agreed', { letterId: letter.id });
          const preview = await call('POST', `/api/letters/${encodeURIComponent(letter.id)}/preview`, {});
          record('letter_previewed', { letterId: letter.id, previewedAt: preview.previewedAt, text: preview.text });
          await call('POST', `/api/letters/${encodeURIComponent(letter.id)}/sent`, { by: 'print', previewToken: preview.previewToken });
          letterSentMs = Date.now();
          record('letter_sent_on_paper', { letterId: letter.id });
        }
      }
      const c = lastState.state.cases.find(item => item.id === caseId);
      const q = (c?.questions ?? []).find(item => item.status === 'open' && !item.leftUnanswered && !attempted.has(item.id));
      if (q) {
        const entry = byKey.get(q.key) ?? byKey.get(q.id);
        if (!entry && !unlisted.has(q.id)) unlisted.set(q.id, { id: q.id, key: q.key, fact: q.what, criteria: q.criterionIds ?? [] });
        const body = answerBodyFor(q, entry);
        try {
          await call('POST', `/api/cases/${encodeURIComponent(caseId)}/questions/${encodeURIComponent(q.id)}/answer`, body);
          attempted.add(q.id);
          questionAnswers.set(q.id, body);
          record('answer_submitted', { id: q.id, key: q.key, fact: q.what, listed: Boolean(entry), body });
        } catch (error) {
          if (error.status !== 409 && error.status !== 0) {
            attempted.add(q.id);
            failedAnswers.set(q.id, { id: q.id, key: q.key, fact: q.what, error: error.message });
          }
        }
      }
      await pause();
    }
    try { observe(await call('GET', '/api/state')); } catch (error) { if (!fatal) fatal = error; }
  } catch (error) {
    fatal = error;
    record('run_error', { error: error instanceof Error ? error.message : String(error) });
  }

  const endedMs = Date.now();
  for (const [id, answer] of questionAnswers) {
    const q = allQuestions.get(id);
    if (q) q.driverAnswer = answer;
  }
  const findings = [...finalFindings.values()];
  const findingsByStatus = {};
  for (const finding of findings) (findingsByStatus[finding.status] ??= []).push(finding);
  const notKnown = [...questionAnswers.values()].filter(body => typeof body.option === 'string' && /not known|unknown|not yet asked/i.test(body.option)).length;
  const summary = {
    startedAt,
    endedAt: new Date(endedMs).toISOString(),
    elapsedMinutes: roundMinutes(endedMs - startedMs),
    caseId: caseId ?? null,
    history: path.resolve(options.history),
    answersFile: path.resolve(options.answers),
    questions: {
      asked: allQuestions.size,
      answered: questionAnswers.size,
      answeredFromFile: [...questionAnswers.keys()].filter(id => {
        const q = allQuestions.get(id);
        return q && (byKey.has(q.key) || byKey.has(q.id));
      }).length,
      notKnown,
      unlisted: [...unlisted.values()],
      failed: [...failedAnswers.values()],
      details: [...allQuestions.values()]
    },
    firstFinding,
    minutesToFirstFinding: firstFindingMs === null || importMs === undefined ? null : roundMinutes(firstFindingMs - importMs),
    minutesToLetter: letterMs === null || importMs === undefined ? null : roundMinutes(letterMs - importMs),
    minutesToLetterSent: letterSentMs === null || importMs === undefined ? null : roundMinutes(letterSentMs - importMs),
    acceptedFindingId,
    findingsByStatus,
    letters: [...finalLetters.values()],
    errors,
    timeline,
    fatalError: fatal ? (fatal instanceof Error ? fatal.message : String(fatal)) : null
  };
  const summaryPath = path.join(options.out, 'summary.json');
  const markdownPath = path.join(options.out, 'summary.md');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  fs.writeFileSync(markdownPath, markdown(summary));
  if (fatal) throw fatal;
  return { summary, summaryPath, markdownPath };
}

const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = await runRehearsal(options);
    console.log(`Rehearsal report: ${result.summaryPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
