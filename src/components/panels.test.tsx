// What the panels say, tested without a browser: the helpers that choose the words, and the
// panels drawn to plain markup from a hand-made state. No server and no model is used.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SCREENED_AGAIN } from '../../shared/screenedAgain.ts';
import type { CaseRecord, CheckResult, Finding, Letter, StateResponse } from '../../shared/types.ts';
import { RECORDED_NOTE, SAMPLE_NOTE } from '../App.tsx';
import type { CriterionView } from '../lib/criteria.ts';
import { matchingLineIds, whatCannotBeSeenWords } from '../lib/findings.ts';
import { JOB_NAMES } from '../lib/modelNames.ts';
import { pageViewOf } from '../lib/pageView.ts';
import type { PageView } from '../lib/pageView.ts';
import {
  answerButtonWords,
  BellPanel,
  cannotSeeWords,
  checksStillWaitingWords,
  decideHintWords,
  isOwnCriterionRefusal,
  keptAnswerWords,
  LEAVE_UNANSWERED_WORDS,
  LEFT_UNANSWERED_WORDS,
  decidedWords,
  disputedIntroWords,
  letterToComeWords,
  linesToShow,
  waitingLedeWords,
} from './BellPanel.tsx';
import { CountsLine } from './CountsLine.tsx';
import { ImportPanel, outcomeWords, rowsByPage, screeningHeadline, screeningSummary } from './ImportPanel.tsx';
import { draftedWords, fitHeightKeepingScroll, letterStepWords, noLettersWords, templateWords } from './LetterPanel.tsx';
import { LetterClosing, LetterPreview, previewLeadWords, previewTitle } from './LetterPreview.tsx';
import { closesThePanel, isTopPanel, Panel } from './Panel.tsx';
import { PathologyUploadPanel } from './PathologyUpload.tsx';
import { StatusLine } from './StatusLine.tsx';

const text = (markup: string): string => markup.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const criterion: CriterionView = {
  id: 'ONE', label: 'Criterion one', title: 'An NSAID with an anticoagulant', statement: 'The criterion text.',
  sourceName: 'Sample source', credit: 'The credit line.', cannotBeSeen: 'Why the anticoagulant was started.', rule: 'Suspect a finding when both are supplied within 60 days.',
  urgency: 'routine',
  signedBy: null,
};
const criteria = { ONE: criterion };

function history(over: Partial<CaseRecord> = {}): CaseRecord {
  return {
    id: 'C0001', fileName: 'positive.csv', importedAt: '2026-11-18T00:00:00.000Z', source: 'csv',
    patient: { label: 'Fictional patient F-001', age: 72, sex: 'F' },
    lines: [
      { id: 'L001', text: '2026-01-06 | Diabex XR (metformin) 1000 mg tablet' },
      { id: 'L002', text: '2026-01-06 | Coversyl (perindopril) 5 mg tablet' },
      { id: 'L036', text: '2026-08-21 | Celebrex 200 mg capsule' },
      { id: 'L040', text: '2026-09-08 | Xarelto 20 mg tablet' },
    ],
    transcriptionConfirmed: true, parts: 1,
    screening: { status: 'done', criteria: [{ criterionId: 'ONE', status: 'suspected' }, { criterionId: 'TWO', status: 'clear' }] },
    ...over,
  };
}

function check(over: Partial<CheckResult> = {}): CheckResult {
  return {
    confirmed: true, lineIds: ['L001', 'L002'], whatMatches: 'Celebrex with Xarelto.', whatCannotBeSeen: 'Whether the medicines were taken.',
    completed: true, model: 'lantern-check', at: '2026-11-18T00:00:20.000Z', seconds: 9, ...over,
  };
}

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'F0001', caseId: 'C0001', criterionId: 'ONE', state: 'confirmed', possible: false, seenByPharmacist: true,
    screen: { lineIds: ['L036', 'L040'], medicines: ['celecoxib', 'rivaroxaban'], reason: 'Both are supplied.', linesVerified: true, missingFacts: [], model: 'lantern-screen', at: '2026-11-18T00:00:05.000Z', seconds: 5 },
    check: check(),
    ...over,
  };
}

function snapOf(cases: CaseRecord[], findings: Finding[] = []): StateResponse {
  return {
    state: { version: 1, cases, findings, letters: [], jobs: [], activity: [] },
    counts: {
      historiesScreened: 0, findingsConfirmed: 0, accepted: 0, bypassed: 0, lettersReady: 0, lettersSent: 0,
      repliesRecorded: 0, closed: 0, overdue: 0, bellBadge: 0, letterBadge: 0,
    },
    now: { stage: null, text: 'Idle' }, serverTime: '2026-11-18T00:10:00.000Z', recorded: false,
  };
}

const noop = async (): Promise<void> => undefined;

function importPanel(snap: StateResponse, extra: { modelsNote?: string | null; pageNote?: string } = {}): string {
  return text(renderToStaticMarkup(
    <ImportPanel
      snap={snap} criteria={criteria} job={{ step: 'idle' }} previews={{}} dragging={false}
      modelsNote={extra.modelsNote ?? null} pageNote={extra.pageNote}
      onFiles={() => undefined} refresh={noop} onClose={() => undefined} onOpenBell={() => undefined}
    />,
  ));
}

function bellMarkup(snap: StateResponse, pageNote?: string, known: Record<string, CriterionView> = criteria): string {
  return renderToStaticMarkup(
    <BellPanel
      snap={snap} criteria={known} criteriaLoaded pageNote={pageNote}
      refresh={noop} onClose={() => undefined} onOpenLetters={() => undefined} onOpenImport={() => undefined}
    />,
  );
}

function bellPanel(snap: StateResponse, pageNote?: string, known: Record<string, CriterionView> = criteria): string {
  return text(bellMarkup(snap, pageNote, known));
}

// ---------- the import panel ----------

describe('the result line of a history', () => {
  it('says "No finding was suspected" only when every criterion ran', () => {
    const clear = history({ screening: { status: 'done', criteria: [{ criterionId: 'ONE', status: 'clear' }, { criterionId: 'TWO', status: 'clear' }] } });
    expect(screeningHeadline(clear)).toBe('Screened against 2 criteria. No finding was suspected.');
  });

  // The review of 18 November: with Model 1 down the card said "Screened against 2 criteria. No finding was suspected."
  it('never says it when a criterion could not be screened', () => {
    const failed = history({ screening: { status: 'done', criteria: [{ criterionId: 'ONE', status: 'failed' }, { criterionId: 'TWO', status: 'failed' }] } });
    expect(screeningHeadline(failed)).toBe('Screened against 0 of 2 criteria. 2 could not be screened.');
    const mixed = history({ screening: { status: 'done', criteria: [{ criterionId: 'ONE', status: 'suspected' }, { criterionId: 'TWO', status: 'failed' }] } });
    expect(screeningHeadline(mixed)).toBe('Screened against 1 of 2 criteria. 1 could not be screened. 1 finding was suspected and passed to the second check.');
    expect(screeningHeadline(mixed)).not.toContain('No finding');
  });

  it('is drawn that way on the card, with the button to screen again and no good-news tick', () => {
    const failed = history({ screening: { status: 'done', criteria: [{ criterionId: 'ONE', status: 'failed' }, { criterionId: 'TWO', status: 'failed' }] } });
    const page = importPanel(snapOf([failed]));
    expect(page).toContain('Screened against 0 of 2 criteria. 2 could not be screened.');
    expect(page).not.toContain('No finding was suspected');
    expect(page).toContain('This is not the same as no finding.');
    expect(page).toContain('Open the list of 2 criteria that could not be screened');
    expect(page).toContain('Screen again what has no result');
    // A history that is fully screened has no such button.
    expect(importPanel(snapOf([history()]))).not.toContain('Screen again what has no result');
  });

  it('offers to screen again a screening that was interrupted', () => {
    const interrupted = history({ screening: { status: 'interrupted', criteria: [{ criterionId: 'ONE', status: 'clear' }, { criterionId: 'TWO', status: 'waiting' }] } });
    const page = importPanel(snapOf([interrupted]));
    expect(page).toContain('Screening was interrupted before it finished. This history is not fully screened.');
    expect(page).toContain('Screen again what has no result');
  });
});

describe('what the card says became of the findings', () => {
  it('follows each finding to its end, not only to the second check', () => {
    expect(outcomeWords([])).toBe('');
    expect(outcomeWords([finding({ state: 'suspected' })])).toBe('What became of the finding: 1 is waiting for the second check.');
    expect(outcomeWords([finding({ state: 'accepted' }), finding({ id: 'F0002', state: 'not_confirmed' }), finding({ id: 'F0003', state: 'bypassed' })]))
      .toBe('What became of the 3 findings: 1 was not confirmed by the second check, 1 was accepted by you, 1 was bypassed by you.');
  });
});

describe('the import panel', () => {
  it('says when the local models are not running, before a history is imported', () => {
    const note = 'The local models are not running. A history cannot be screened until they are.';
    expect(importPanel(snapOf([]), { modelsNote: note })).toContain(note);
    expect(importPanel(snapOf([]))).not.toContain('not running');
  });

  it('says what a long history is: read in parts, then the listed lines together', () => {
    const page = importPanel(snapOf([history({ parts: 3 })]));
    expect(page).toContain(`This history is long. ${JOB_NAMES.screen} reads it in 3 overlapping parts. Then it reads the lines that hold a listed medicine together`);
  });

  it('says only what is true about scans, and explains the bars and the line numbers', () => {
    const page = importPanel(snapOf([history()]));
    expect(page).toContain('A scan or a photo of a printed history (PDF, PNG or JPEG) can be tried');
    expect(page).not.toContain('also works');
    expect(page).toContain('One bar for each criterion.');
    expect(page).toContain('L030 is line 30 of this history.');
    // A page of the demo scan took about two and a half minutes. The card no longer says "about a minute".
    const beingRead = history({ source: 'pdf-image', transcriptionConfirmed: false, lines: [], screening: { status: 'not_started', criteria: [{ criterionId: 'ONE', status: 'waiting' }] } });
    const reading = importPanel(snapOf([beingRead]));
    expect(reading).toContain('This can take one to three minutes for each page.');
    expect(reading).not.toContain('about a minute');
  });

  it('keeps what Model 1 wrote for a clear criterion where it can be looked up', () => {
    const c = history({ screening: { status: 'done', criteria: [{ criterionId: 'ONE', status: 'clear', reason: 'Xarelto is supplied, but no NSAID.' }] } });
    expect(importPanel(snapOf([c]))).toContain('Criterion one: Xarelto is supplied, but no NSAID.');
  });

  it('says the checks wait for the answers when nothing is in line, and keeps the line when screening is queued', () => {
    const buttons = [
      { words: 'Yes', effect: 'meets' as const },
      { words: 'No', effect: 'does_not_meet' as const },
      { words: 'Not known', effect: 'unknown' as const },
    ];
    const ask = (id: string, what: string, criterionIds: string[]) => ({
      id, key: what.toLowerCase(), kind: 'condition' as const, what, meets: what,
      criterionIds, findingIds: [] as string[], source: 'patient' as const, status: 'open' as const,
      needsValue: false, options: buttons,
    });
    const held = history({
      screening: {
        status: 'waiting',
        criteria: [
          { criterionId: 'ONE', status: 'clear' },
          { criterionId: 'START-H4', status: 'waiting' },
        ],
      },
      questions: [
        ask('Q0001', 'Osteoporosis', ['START-H4']),
        ask('Q0002', 'Previous fragility fracture', ['START-H4']),
      ],
    });
    const idle = importPanel(snapOf([held]));
    expect(snapOf([held]).now.text).toBe('Idle');
    expect(idle).toContain('1 check could not run until these questions are answered.');
    expect(idle).not.toContain('Waiting in line for');

    const queued = history({
      screening: {
        status: 'waiting',
        criteria: [
          { criterionId: 'ONE', status: 'waiting' },
          { criterionId: 'TWO', status: 'waiting' },
        ],
      },
    });
    const line = importPanel(snapOf([queued]));
    expect(line).toContain(`Waiting in line for ${JOB_NAMES.screen}.`);
    expect(line).not.toContain('could not run until');

    const behind = snapOf([held]);
    behind.state.jobs = [{ id: 'J0001', stage: 'screen', caseId: held.id, status: 'queued' }];
    const stillQueued = importPanel(behind);
    expect(stillQueued).toContain(`Waiting in line for ${JOB_NAMES.screen}.`);
    expect(stillQueued).not.toContain('could not run until');
  });
});

describe('the check of a scan', () => {
  const scan = history({
    id: 'C0004', fileName: 'scan.pdf', source: 'pdf-image', transcriptionConfirmed: false, pages: 3,
    lines: [
      { id: 'L001', text: '2026-08-08 | Xarelto 20 mg tablet', page: 1 },
      { id: 'L002', text: '2026-09-08 | Xarelto 20 mg tablet', page: 3 },
    ],
    scanNotes: ['Page 2: no rows were read. Look at the picture of page 2. If it holds supplies, do not confirm.'],
    screening: { status: 'not_started', criteria: [{ criterionId: 'ONE', status: 'waiting' }] },
  });

  it('lists every page of the scan with its count, also a page that gave no rows', () => {
    expect(rowsByPage(scan)?.map((p) => [p.page, p.lines.length])).toEqual([[1, 1], [2, 0], [3, 1]]);
    expect(rowsByPage(history())).toBeNull();                                  // not a scan
  });

  it('shows the page marks, the empty page, the pictures kept by the server and the way to discard the scan', () => {
    const markup = renderToStaticMarkup(
      <ImportPanel
        snap={snapOf([scan])} criteria={criteria} job={{ step: 'idle' }} previews={{}} dragging={false} modelsNote={null}
        onFiles={() => undefined} refresh={noop} onClose={() => undefined} onOpenBell={() => undefined}
      />,
    );
    const page = text(markup);
    expect(page).toContain('2 lines from 3 pages');
    expect(page).toContain('Page 1 of 3: 1 row');
    expect(page).toContain('Page 2 of 3: no rows were read');
    expect(page).toContain('Page 3 of 3: 1 row');
    expect(page).toContain('Page 2: no rows were read. Look at the picture of page 2.');
    // The pictures come from the server, so they are there after a page reload and in another window.
    expect(markup).toContain('src="/api/cases/C0004/pages/1"');
    expect(markup).toContain('src="/api/cases/C0004/pages/2"');
    expect(markup).toContain('src="/api/cases/C0004/pages/3"');
    expect(page).toContain('Discard this scan');
    expect(page).toContain('Waiting for you to check the rows. Screening has not started.');
  });
});

// ---------- the bell panel ----------

describe('the lines of a finding under the bell', () => {
  it('keeps the proving lines of the first model in view when the second check named other lines, and marks them', () => {
    // The stand-in of the review: the first model cites L036 and L040, the second check confirms but cites L001 and L002.
    const shown = linesToShow(finding(), history());
    expect([...shown.hits]).toEqual(['L001', 'L002', 'L036', 'L040']);
    expect([...shown.firstModelOnly]).toEqual(['L036', 'L040']);
    const page = bellPanel(snapOf([history()], [finding()]));
    expect(page).toContain('Lines the models pointed to');
    expect(page).toContain('Celebrex 200 mg capsule');
    expect(page).toContain(`Named by ${JOB_NAMES.screen} only`);
    expect(page).not.toContain('Dispensing lines that match');
    // The names the founder gave the models are used, never the numbers.
    expect(page).not.toMatch(/Model [123]|the first model/);
  });

  it('marks nothing when both models named the same lines, or when only the first model named any', () => {
    const same = linesToShow(finding({ check: check({ lineIds: ['L036', 'L040'] }) }), history());
    expect([...same.firstModelOnly]).toEqual([]);
    const unchecked = linesToShow(finding({ check: check({ completed: false, confirmed: false, lineIds: ['L036', 'L040'] }) }), history());
    expect([...unchecked.hits]).toEqual(['L036', 'L040']);
    expect([...unchecked.firstModelOnly]).toEqual([]);
  });
});

describe('the helpers of the first build of the bell panel, kept in lib/findings.ts', () => {
  it('give the lines of the second check when it completed and named lines, otherwise those of the first model', () => {
    expect(matchingLineIds(finding())).toEqual(['L001', 'L002']);
    expect(matchingLineIds(finding({ check: check({ completed: false, confirmed: false, lineIds: [] }) }))).toEqual(['L036', 'L040']);
  });

  it('give what cannot be seen from the check, or from the criterion when the check did not complete', () => {
    expect(whatCannotBeSeenWords(finding(), criterion)).toBe('Whether the medicines were taken.');
    expect(whatCannotBeSeenWords(finding({ check: check({ completed: false }) }), criterion)).toBe('Why the anticoagulant was started.');
  });
});

describe('the words of the models under the bell', () => {
  it('puts the criterion\'s own words first for what cannot be seen, and what the second check added after them', () => {
    expect(cannotSeeWords(finding(), criterion)).toEqual({ own: 'Why the anticoagulant was started.', added: 'Whether the medicines were taken.' });
    expect(cannotSeeWords(finding({ check: check({ whatCannotBeSeen: 'Why the anticoagulant was started.' }) }), criterion).added).toBe('');
    expect(cannotSeeWords(finding({ check: check({ completed: false }) }), criterion).added).toBe('');
    const page = bellPanel(snapOf([history()], [finding()]));
    expect(page.indexOf('Why the anticoagulant was started.')).toBeLessThan(page.indexOf(`${JOB_NAMES.check} added:`));
    expect(page).toContain(`What ${JOB_NAMES.check} wrote in the second check`);
    expect(page).toContain("These are the model's own words, not a checked fact.");
    expect(page).toContain('What the models were asked to look for: Suspect a finding when both are supplied within 60 days.');
    expect(page).toContain(`Accept sends the finding to ${JOB_NAMES.letter} for a letter to the doctor.`);
  });

  it('marks a finding whose second check is unclear, and one whose check did not finish', () => {
    const unclear = bellPanel(snapOf([history()], [finding({ check: check({ confirmed: false, unclear: true }) })]));
    expect(unclear).toContain('Second check unclear');
    expect(unclear).toContain(`${JOB_NAMES.check} answered "not confirmed" but named lines as proof.`);
    const unfinished = bellPanel(snapOf([history()], [finding({ check: check({ confirmed: false, completed: false }) })]));
    expect(unfinished).toContain('Second check not completed');
    expect(unfinished).toContain(`What ${JOB_NAMES.screen} reported`);
    // A finding whose lines the first model could not prove says so.
    const unproved = bellPanel(snapOf([history()], [finding({ screen: { ...finding().screen, linesVerified: false } })]));
    expect(unproved).toContain('Lines not verified');
    expect(bellPanel(snapOf([history()], [finding()]))).not.toContain('Lines not verified');
  });

  it('shows the findings the two models disagree on in an open section, each view with its own words and lines', () => {
    const turnedBack = finding({ state: 'not_confirmed', check: check({ confirmed: false, lineIds: ['L001'], whatMatches: 'Only one supply is seen.' }) });
    const markup = bellMarkup(snapOf([history()], [turnedBack]));
    const page = text(markup);
    expect(page).toContain('The two models disagree (1)');
    // The section is a section with a heading: it cannot be folded away.
    expect(markup).toContain('<section class="grey-list"');
    expect(markup).not.toContain('Not confirmed by the second check');
    expect(page).toContain(`${JOB_NAMES.screen} suspected`);
    expect(page).toContain(`${JOB_NAMES.check} turned it back`);
    // The criterion both views rest on, with its credit.
    expect(page).toContain('The criterion text.');
    expect(page).toContain('The credit line.');
    // What each model wrote, and the lines each one named.
    expect(page).toContain('Both are supplied.');
    expect(page).toContain('Only one supply is seen.');
    expect(markup).toContain(`aria-label="Lines ${JOB_NAMES.screen} named"`);
    expect(markup).toContain(`aria-label="Lines ${JOB_NAMES.check} named"`);
    expect(page).toContain('L036 Line a model pointed to: 2026-08-21 | Celebrex 200 mg capsule');
    expect(page).toContain('L001 Line a model pointed to: 2026-01-06 | Diabex XR (metformin) 1000 mg tablet');
    expect(page).toContain('Accept anyway');
    expect(page).toContain('Dismiss');
    // It is not under the bell as a confirmed finding, and it is not called a failure.
    expect(page).toContain('No findings are waiting for you.');
    expect(page).not.toMatch(/fail/i);
    // With no line named by the second check, the page says so in words.
    const noLines = bellPanel(snapOf([history()], [finding({ state: 'not_confirmed', check: check({ confirmed: false, lineIds: [] }) })]));
    expect(noLines).toContain(`${JOB_NAMES.check} named no line of this history.`);
    // Nothing of the kind when no finding is disputed.
    expect(bellPanel(snapOf([history()], [finding()]))).not.toContain('The two models disagree');
  });

  it('says on the bell panel that a history was not fully screened: "no findings waiting" is not the whole story', () => {
    const failed = history({ screening: { status: 'done', criteria: [{ criterionId: 'ONE', status: 'failed' }] } });
    const page = bellPanel(snapOf([failed]));
    expect(page).toContain('No findings are waiting for you.');
    expect(page).toContain('1 history was not fully screened. This is not the same as no finding.');
    // Which criterion could not be screened on which history is named: it is never shown as clear and never left out.
    expect(page).toContain('Criteria that could not be screened (1)');
    expect(page).toContain('Criterion one could not be screened on positive.csv (Fictional patient F-001).');
    expect(bellPanel(snapOf([history()]))).not.toContain('not fully screened');
    expect(bellPanel(snapOf([history()]))).not.toContain('could not be screened');
  });
});

describe('the bell panel with many findings', () => {
  const sameDay: CriterionView = { ...criterion, id: 'URGENT', label: 'Criterion urgent', urgency: 'same_day', signedBy: { name: 'Sample reviewer (mock-up only)', date: '2026-11-01' } };

  it('says "same day" in words on a finding whose criterion is marked urgent, and not on any other', () => {
    const urgent = finding({ id: 'F0002', criterionId: 'URGENT' });
    const markup = bellMarkup(snapOf([history()], [finding(), urgent]), undefined, { ONE: criterion, URGENT: sameDay });
    const page = text(markup);
    expect(page).toContain('Same day: this criterion is marked urgent. Please review it today.');
    expect(page.match(/Same day:/g)).toHaveLength(1);
    // The note stands at the top of its finding, before the name of the criterion.
    expect(page.indexOf('Same day:')).toBeLessThan(page.indexOf('Criterion urgent'));
    expect(page).toContain('Signed by the clinical reviewer: Sample reviewer (mock-up only), ');
    expect(bellPanel(snapOf([history()], [finding()]))).not.toContain('Same day');
    // A finding of such a criterion that the two models disagree on says it as well.
    const turnedBack = finding({ id: 'F0003', criterionId: 'URGENT', state: 'not_confirmed', check: check({ confirmed: false, lineIds: [] }) });
    const disputed = bellMarkup(snapOf([history()], [turnedBack]), undefined, { ONE: criterion, URGENT: sameDay });
    const section = text(disputed.slice(disputed.indexOf('<section class="grey-list"'), disputed.indexOf('<details class="grey-list grey-list--plain"')));
    expect(section).toContain('Same day: this criterion is marked urgent. Please review it today.');
  });

  it('groups the waiting findings by history, in the order of the server, with signed criteria first in a group', () => {
    const second = history({ id: 'C0002', fileName: 'second.csv', patient: { label: 'Fictional patient F-002', age: 60, sex: 'M' } });
    const list = [
      finding({ id: 'F0001', caseId: 'C0002' }),
      finding({ id: 'F0002', caseId: 'C0001' }),
      finding({ id: 'F0003', caseId: 'C0001', criterionId: 'URGENT' }),
    ];
    const markup = bellMarkup(snapOf([history(), second], list), undefined, { ONE: criterion, URGENT: sameDay });
    const page = text(markup);
    expect(markup.match(/class="section-title group-title"/g)).toHaveLength(2);
    expect(page).toContain('Fictional patient F-001, age 72, female positive.csv 2 waiting findings');
    expect(page).toContain('Fictional patient F-002, age 60, male second.csv 1 waiting finding');
    // The first history of the server comes first, whatever the order of the findings.
    expect(page.indexOf('positive.csv 2 waiting findings')).toBeLessThan(page.indexOf('second.csv 1 waiting finding'));
    // In the group of the first history the signed criterion comes before the draft.
    const firstGroup = page.slice(page.indexOf('positive.csv 2 waiting findings'), page.indexOf('second.csv 1 waiting finding'));
    expect(firstGroup.indexOf('Criterion urgent')).toBeLessThan(firstGroup.indexOf('Criterion one'));
    expect(firstGroup).toContain('Draft criterion. Not yet signed by the clinical reviewer.');
  });

  it('shows a search box when more than twenty findings wait, and none with twenty', () => {
    const many = (n: number): Finding[] => Array.from({ length: n }, (_, i) => finding({ id: `F${String(i + 1).padStart(4, '0')}` }));
    const twentyOne = bellMarkup(snapOf([history()], many(21)));
    expect(text(twentyOne)).toContain('Search the waiting findings');
    expect(twentyOne).toMatch(/<label for="([^"]+)">Search the waiting findings<\/label><input id="\1" type="text"/);
    expect(text(twentyOne)).toContain('21 findings are waiting for you.');
    expect(text(twentyOne)).toContain('positive.csv 21 waiting findings');
    // No filter is on: every finding is shown, and the page does not say "Showing".
    expect(twentyOne.match(/<article class="finding"/g)).toHaveLength(21);
    expect(text(twentyOne)).not.toContain('Showing');
    const twenty = bellMarkup(snapOf([history()], many(20)));
    expect(text(twenty)).not.toContain('Search the waiting findings');
    expect(twenty.match(/<article class="finding"/g)).toHaveLength(20);
  });

  it('lists what the pharmacist decided: accepted, accepted anyway, bypassed and dismissed, each with its reason', () => {
    const at = '2026-11-18T00:05:00.000Z';
    const by = 'The pharmacist on duty';
    const accepted = finding({ id: 'F0001', state: 'accepted', decision: { action: 'accept', by, at } });
    const anyway = finding({
      id: 'F0002', state: 'accepted', check: check({ confirmed: false, lineIds: [] }),
      decision: { action: 'accept', reason: 'The supplies do overlap.', by, at },
    });
    const bypassed = finding({ id: 'F0003', state: 'bypassed', decision: { action: 'bypass', reason: 'The doctor already knows.', by, at } });
    const dismissed = finding({
      id: 'F0004', state: 'not_confirmed', check: check({ confirmed: false, lineIds: [] }),
      decision: { action: 'dismiss', reason: 'Looked at it. Nothing to do.', by, at },
    });
    expect([accepted, anyway, bypassed, dismissed].map(decidedWords)).toEqual(['Accepted', 'Accepted anyway', 'Bypassed', 'Dismissed']);
    // A second check that was unclear is not one that turned the finding back.
    expect(decidedWords(finding({ state: 'accepted', check: check({ confirmed: false, unclear: true }) }))).toBe('Accepted');
    const page = bellPanel(snapOf([history()], [accepted, anyway, bypassed, dismissed]));
    expect(page).toContain('Already decided by the pharmacist (4)');
    expect(page).toMatch(/Accepted on /);
    expect(page).toMatch(/Accepted anyway on [^R]*Reason: The supplies do overlap\./);
    expect(page).toMatch(/Bypassed on [^R]*Reason: The doctor already knows\./);
    expect(page).toMatch(/Dismissed on [^R]*Reason: Looked at it\. Nothing to do\./);
    // A dismissed finding is decided: it is no longer among those the two models disagree on.
    expect(page).not.toContain('The two models disagree');
    expect(page).toContain('No findings are waiting for you.');
  });
});

// ---------- records that also carry conditions and results (docs/SPEC.md section 6a) ----------

/** A record that also lists a condition, a test result and a measurement, in file order among the supplies. */
function record(over: Partial<CaseRecord> = {}): CaseRecord {
  return history({
    fileName: 'record.csv',
    lines: [
      { id: 'L001', text: '2026-07-10 | CONDITION | Heart failure' },
      { id: 'L002', text: '2026-07-14 | Diabex XR (metformin) 1000 mg tablet | qty 60' },
      { id: 'L003', text: '2026-08-03 | RESULT | eGFR 28 mL/min/1.73 m2' },
      { id: 'L004', text: '2026-08-03 | OBSERVATION | Blood pressure 168/94 mmHg' },
      { id: 'L005', text: '2026-08-12 | Diabex XR (metformin) 1000 mg tablet | qty 60' },
    ],
    ...over,
  });
}

/** A finding on that record. Both models name the same lines. */
function onRecord(lineIds: string[], over: Partial<Finding> = {}, missingFacts: string[] = []): Finding {
  return finding({
    possible: missingFacts.length > 0,
    screen: { ...finding().screen, lineIds, missingFacts },
    check: check({ lineIds }),
    ...over,
  });
}

describe('a possible finding under the bell', () => {
  it('says so above the evidence, names the fact the record does not show, and says what the letter asks', () => {
    const page = bellPanel(snapOf([record()], [onRecord(['L002', 'L005'], {}, ['an eGFR result.'])]));
    expect(page).toContain('Possible finding. The record does not show: an eGFR result. The letter asks the doctor to confirm.');
    // Above the evidence: before the criterion text, the lines and the words of the models.
    const at = page.indexOf('Possible finding.');
    expect(at).toBeLessThan(page.indexOf('The criterion text.'));
    expect(at).toBeLessThan(page.indexOf('Lines the models pointed to'));
    expect(at).toBeLessThan(page.indexOf(`What ${JOB_NAMES.check} wrote in the second check`));
    // The finding is still decided on as usual.
    expect(page).toContain('Accept');
    expect(page).toContain('Bypass');
  });

  it('says nothing of the kind for a finding that is not a possible finding', () => {
    expect(bellPanel(snapOf([record()], [onRecord(['L003', 'L005'])]))).not.toContain('Possible finding');
    expect(bellPanel(snapOf([history()], [finding()]))).not.toContain('Possible finding');
  });

  it('names two missing facts as one plain list', () => {
    const page = bellPanel(snapOf([record()], [onRecord(['L002'], {}, ['eGFR', 'a diagnosis of heart failure'])]));
    expect(page).toContain('The record does not show: eGFR and a diagnosis of heart failure. The letter asks the doctor to confirm.');
  });

  it('names the one fact the criterion needs when the first model named none, and never guesses between two', () => {
    const silent = onRecord(['L002'], { possible: true });
    const one: CriterionView = { ...criterion, needsFacts: [{ kind: 'result', what: 'eGFR', meets: 'Below 30 mL/min/1.73 m2.' }] };
    expect(bellPanel(snapOf([record()], [silent]), undefined, { ONE: one }))
      .toContain('Possible finding. The record does not show: eGFR. The letter asks the doctor to confirm.');
    const two: CriterionView = {
      ...criterion,
      needsFacts: [...(one.needsFacts ?? []), { kind: 'condition', what: 'Heart failure', meets: 'Listed as a condition.' }],
    };
    expect(bellPanel(snapOf([record()], [silent]), undefined, { ONE: two }))
      .toContain('Possible finding. The record does not show: a fact this criterion needs. The letter asks the doctor to confirm.');
    expect(bellPanel(snapOf([record()], [silent])))
      .toContain('Possible finding. The record does not show: a fact this criterion needs. The letter asks the doctor to confirm.');
  });

  it('is still marked as possible among the findings the two models disagree on, and after the pharmacist has decided', () => {
    const turnedBack = onRecord(['L002'], { state: 'not_confirmed', check: check({ confirmed: false, lineIds: [] }) }, ['an eGFR result']);
    const markup = bellMarkup(snapOf([record()], [turnedBack]));
    // The sentence stands in the section of the disputed findings.
    const section = text(markup.slice(markup.indexOf('<section class="grey-list"'), markup.indexOf('<details class="grey-list grey-list--plain"')));
    expect(section).toContain(`Possible finding. ${JOB_NAMES.screen} said the record does not show: an eGFR result. A letter would ask the doctor to confirm.`);
    expect(section).toContain('Accept anyway');
    const accepted = onRecord(['L002'], { state: 'accepted', decision: { action: 'accept', by: 'The pharmacist on duty', at: '2026-11-18T00:05:00.000Z' } }, ['an eGFR result']);
    expect(bellPanel(snapOf([record()], [accepted]))).toContain('It was a possible finding.');
    expect(bellPanel(snapOf([record()], [finding({ state: 'accepted' })]))).not.toContain('possible finding');
  });
});

describe('a fact from the record among the lines of a finding', () => {
  it('shows a cited result line among the supply lines, in file order, with its kind in view', () => {
    const markup = bellMarkup(snapOf([record()], [onRecord(['L003', 'L005', 'L002'])]));
    const page = text(markup);
    expect(page).toContain('L002 Line a model pointed to: 2026-07-14 | Diabex XR (metformin) 1000 mg tablet | qty 60');
    expect(page).toContain('L003 Line a model pointed to: 2026-08-03 | RESULT | eGFR 28 mL/min/1.73 m2');
    expect(page.indexOf('L002 Line')).toBeLessThan(page.indexOf('L003 Line'));
    expect(page.indexOf('L003 Line')).toBeLessThan(page.indexOf('L005 Line'));
    // The kind is a mark of its own, and the line is told apart from a supply.
    expect(markup).toContain('<span class="cell cell--kind" title="A test result from the record. It is not a supply.">RESULT</span>');
    expect(markup).toContain('class="line line--hit line--fact"');
    expect(page).toContain('A line marked CONDITION, RESULT or OBSERVATION is a fact from the record, not a supply.');
    // A fact the models did not point to is not among the matching lines.
    expect(page).not.toContain('Heart failure');
    expect(page).not.toContain('Blood pressure');
  });

  it('marks a condition and an observation the same way', () => {
    const markup = bellMarkup(snapOf([record()], [onRecord(['L001', 'L004'])]));
    expect(markup).toContain('title="A condition from the record. It is not a supply.">CONDITION</span>');
    expect(markup).toContain('title="A measurement from the record. It is not a supply.">OBSERVATION</span>');
    expect(text(markup)).toContain('L001 Line a model pointed to: 2026-07-10 | CONDITION | Heart failure');
    expect(text(markup)).toContain('L004 Line a model pointed to: 2026-08-03 | OBSERVATION | Blood pressure 168/94 mmHg');
  });

  it('keeps the kinds in view when the whole record is shown, and in the import panel', () => {
    // No line that exists was named, so the whole record is shown.
    const whole = bellMarkup(snapOf([record()], [onRecord([], { check: check({ lineIds: [] }) })]));
    for (const kind of ['CONDITION', 'RESULT', 'OBSERVATION']) expect(whole).toContain(`>${kind}</span>`);
    expect(whole).not.toContain('line--hit');
    expect(text(whole)).toContain('A line marked CONDITION, RESULT or OBSERVATION is a fact from the record, not a supply.');
    const imported = renderToStaticMarkup(
      <ImportPanel
        snap={snapOf([record()])} criteria={criteria} job={{ step: 'idle' }} previews={{}} dragging={false} modelsNote={null}
        onFiles={() => undefined} refresh={noop} onClose={() => undefined} onOpenBell={() => undefined}
      />,
    );
    expect(imported).toContain('<span class="cell cell--kind" title="A test result from the record. It is not a supply.">RESULT</span>');
    expect(text(imported)).toContain('L003 2026-08-03 | RESULT | eGFR 28 mL/min/1.73 m2');
  });

  it('marks nothing in a history of supplies only', () => {
    const markup = bellMarkup(snapOf([history()], [finding()]));
    expect(markup).not.toContain('cell--kind');
    expect(markup).not.toContain('line--fact');
    expect(text(markup)).not.toContain('is a fact from the record');
    // Only the second part of a line can be the kind. The same word elsewhere in a supply line is not one.
    const odd = history({ lines: [{ id: 'L001', text: '2026-08-21 | Celebrex 200 mg capsule | RESULT' }] });
    expect(bellMarkup(snapOf([odd], [onRecord(['L001'])]))).not.toContain('cell--kind');
  });
});

describe('the import panel and a record with conditions and results', () => {
  it('says that the file may also list them', () => {
    expect(importPanel(snapOf([]))).toContain("The file may also list the patient's known conditions and recent test results.");
    expect(importPanel(snapOf([]))).toContain('Import fictional histories only. Do not import a real dispensing record.');
  });

  it('makes the scrolling lines box reachable by keyboard', () => {
    const html = renderToStaticMarkup(
      <ImportPanel
        snap={snapOf([history()])}
        criteria={criteria}
        job={{ step: 'idle' }}
        previews={{}}
        dragging={false}
        modelsNote={null}
        onFiles={() => undefined}
        refresh={noop}
        onClose={() => undefined}
        onOpenBell={() => undefined}
      />,
    );
    expect(html).toContain(
      'class="lines-box lines-box--scroll" tabindex="0" role="region" aria-label="Lines of positive.csv"',
    );
  });
});

describe('the screening summary on a history card', () => {
  it('counts findings under the bell and those the two models disagree on', () => {
    const atBell = finding({ state: 'confirmed' });
    const unchecked = finding({
      id: 'F0002',
      state: 'confirmed',
      check: check({ completed: false, confirmed: false }),
    });
    const disputed = finding({
      id: 'F0003',
      state: 'not_confirmed',
      check: check({ completed: true, confirmed: false }),
    });
    expect(screeningSummary([atBell, unchecked])).toBe('2 findings are waiting under the bell.');
    expect(screeningSummary([atBell, unchecked])).not.toContain('disputed');
    expect(screeningSummary([disputed])).toBe('1 is disputed because the two models disagree.');
    expect(screeningSummary([atBell, disputed])).toBe(
      '1 finding is waiting under the bell; 1 is disputed because the two models disagree.',
    );
    expect(screeningSummary([])).toBe('');
  });

  it('uses the display names passed in, and Mantle, Lumen and Ogee when none are', () => {
    const names = { screen: 'Alpha', check: 'Beta', letter: 'Gamma' };
    const imported = text(renderToStaticMarkup(
      <ImportPanel
        snap={snapOf([history({ parts: 3 })])} criteria={criteria} job={{ step: 'idle' }} previews={{}} dragging={false}
        modelsNote={null} names={names}
        onFiles={() => undefined} refresh={noop} onClose={() => undefined} onOpenBell={() => undefined}
      />,
    ));
    expect(imported).toContain('Alpha reads it in 3 overlapping parts');
    expect(imported).not.toContain('Mantle');
    const bell = bellPanel(snapOf([history()], [finding()]));
    expect(bell).toContain(`What ${JOB_NAMES.check} wrote in the second check`);
    const namedBell = text(renderToStaticMarkup(
      <BellPanel
        snap={snapOf([history()], [finding()])} criteria={criteria} criteriaLoaded names={names}
        refresh={noop} onClose={() => undefined} onOpenLetters={() => undefined} onOpenImport={() => undefined}
      />,
    ));
    expect(namedBell).toContain('What Beta wrote in the second check');
    expect(namedBell).toContain('Accept sends the finding to Gamma for a letter to the doctor.');
    expect(namedBell).not.toContain('Lumen');
    expect(namedBell).not.toContain('Ogee');
    expect(draftedWords('model', false, names)).toBe('Drafted by Gamma');
    expect(noLettersWords('live', names)).toContain('Gamma writes a letter and it shows here.');
    expect(noLettersWords('live')).toContain(JOB_NAMES.letter);
    expect(disputedIntroWords('live', names)).toContain('Alpha suspected these and Beta did not confirm them.');
  });
});

describe('a long list of criteria', () => {
  const runsOf = (n: number): CaseRecord['screening']['criteria'] =>
    Array.from({ length: n }, (_, i) => ({ criterionId: `K${i + 1}`, status: i < 13 ? 'clear' : i === 13 ? 'running' : 'waiting' }));

  it('draws one bar for each of 413 criteria in several rows of small bars, and ten criteria as before', () => {
    const many = renderToStaticMarkup(
      <ImportPanel
        snap={snapOf([history({ screening: { status: 'running', criteria: runsOf(413) } })])} criteria={criteria} job={{ step: 'idle' }}
        previews={{}} dragging={false} modelsNote={null}
        onFiles={() => undefined} refresh={noop} onClose={() => undefined} onOpenBell={() => undefined}
      />,
    );
    expect(many).toContain('class="segments segments--many"');
    expect(many.match(/<li class="segment segment--/g)).toHaveLength(413);
    expect(text(many)).toContain(`${JOB_NAMES.screen} is screening: criterion 14 of 413.`);
    const ten = renderToStaticMarkup(
      <ImportPanel
        snap={snapOf([history({ screening: { status: 'running', criteria: runsOf(10) } })])} criteria={criteria} job={{ step: 'idle' }}
        previews={{}} dragging={false} modelsNote={null}
        onFiles={() => undefined} refresh={noop} onClose={() => undefined} onOpenBell={() => undefined}
      />,
    );
    expect(ten).toContain('class="segments"');
    expect(ten).not.toContain('segments--many');
  });

  it('gives the status line the words of the server as they are', () => {
    const line = text(renderToStaticMarkup(<StatusLine now={{ stage: 'screen', text: 'Model 1 is screening: criterion 14 of 413' }} serverDown={false} />));
    expect(line).toContain('Now: Model 1 is screening: criterion 14 of 413');
  });
});

// ---------- every panel ----------

describe('a view that is not a live run', () => {
  it('says so in the head of every panel, not only on the first screen', () => {
    expect(importPanel(snapOf([]), { pageNote: SAMPLE_NOTE })).toContain('Sample data. The models are not connected.');
    expect(bellPanel(snapOf([]), RECORDED_NOTE)).toContain("Recorded run from the entrant's computer. The live models are not connected.");
    const head = text(renderToStaticMarkup(<Panel name="letter" title="Letters to the doctor" icon={null} note={SAMPLE_NOTE} onClose={() => undefined}>x</Panel>));
    expect(head).toContain('Letters to the doctor Sample data. The models are not connected. Fictional patient. No real person.');
    expect(text(renderToStaticMarkup(<Panel name="letter" title="Letters" icon={null} onClose={() => undefined}>x</Panel>))).not.toContain('Sample data');
  });

  it('goes back to the main page by one button with those words, and a page over a page says where it goes back to', () => {
    const page = renderToStaticMarkup(<Panel name="bell" title="Findings waiting for you" icon={null} onClose={() => undefined}>x</Panel>);
    expect(page).toContain('<span>Back to the main page</span>');
    expect(page).toContain('class="btn btn-quiet panel-close"');
    // The frame of a panel is the head and the body, with nothing around them.
    expect(page).toMatch(/^<div class="panel panel--bell" role="dialog" aria-modal="true"[^>]*><header class="panel-head">/);
    const over = renderToStaticMarkup(<Panel name="letter" title="Letter as it will leave" icon={null} closeLabel="Back to the letter" onClose={() => undefined}>x</Panel>);
    expect(over).toContain('<span>Back to the letter</span>');
    expect(over).not.toContain('Back to the main page');
    // A panel that another panel lies over cannot be reached.
    expect(renderToStaticMarkup(<Panel name="letter" title="Letters to the doctor" icon={null} covered onClose={() => undefined}>x</Panel>)).toContain(' inert=""');
    expect(page).not.toContain('inert');
  });

  it('does not say that a model wrote a sample letter', () => {
    expect(draftedWords('model', true)).toBe('Sample letter, written by hand for the mock-up');
    expect(draftedWords('template', true)).toContain('written by hand');
    expect(draftedWords('model', false)).toBe(`Drafted by ${JOB_NAMES.letter}`);
    expect(draftedWords('template', false)).toBe('Built from the template');
  });

  it('knows the four views from the two switches of the page address', () => {
    expect(pageViewOf(false, false)).toBe('live');
    expect(pageViewOf(false, true)).toBe('sample');
    expect(pageViewOf(true, false)).toBe('recorded');
    expect(pageViewOf(true, true)).toBe('made_up_recording');
  });
});

// The line beside Accept and Bypass, and beside "Accept anyway" and "Dismiss".
describe('the line beside the buttons of a finding', () => {
  const recordedViews: PageView[] = ['recorded', 'made_up_recording'];

  it('says in a live run what Accept does', () => {
    expect(decideHintWords('live')).toBe(`Accept sends the finding to ${JOB_NAMES.letter} for a letter to the doctor.`);
  });

  // The steps of the pharmacist in a recording may have been entered by a script: tools/record-run.mjs
  // writes that by default, and the recording in cases/_demo says so. And the line stands on findings
  // that nobody had decided in the frame that is shown. So it says only what is true of every recording.
  it('does not say in a recorded run who decided, or that anything was decided', () => {
    expect(decideHintWords('recorded')).toBe('This is a recorded run. Nothing is decided here.');
    for (const view of recordedViews) {
      const words = decideHintWords(view);
      expect(words).toContain('Nothing is decided here.');
      expect(words).not.toMatch(/pharmacist|entrant|person|script|was decided|decided on/i);
      // The buttons are switched off there: the line does not say what Accept does.
      expect(words).not.toMatch(/Accept/);
    }
    expect(decideHintWords('made_up_recording')).toContain('made-up recording of the sample view');
  });

  it('does not say in the sample view that a model writes the letter: no model is connected there', () => {
    const hint = decideHintWords('sample');
    expect(hint).toBe('Sample data: Accept shows a sample letter under the letter icon. No model writes it.');
    expect(hint).not.toContain(JOB_NAMES.letter);
    expect(letterToComeWords(true)).toBe('A sample letter will show under the letter icon.');
    expect(letterToComeWords(true)).not.toContain(JOB_NAMES.letter);
    expect(letterToComeWords(false)).toBe(`${JOB_NAMES.letter} will write the letter. It will show under the letter icon.`);
  });
});

// The other lines of the findings page and of the letters page that say what the reader can do.
describe('the lines that ask for a decision', () => {
  const recordedViews: PageView[] = ['recorded', 'made_up_recording'];
  const openViews: PageView[] = ['live', 'sample'];

  it('ask the pharmacist to accept or bypass where that can be done, and not in a recorded run', () => {
    for (const view of openViews) {
      expect(waitingLedeWords(4, view)).toBe('4 findings are waiting for you. Read the evidence, then accept or bypass each one.');
      expect(waitingLedeWords(1, view)).toBe('1 finding is waiting for you. Read the evidence, then accept or bypass each one.');
    }
    for (const view of recordedViews) {
      expect(waitingLedeWords(4, view)).toBe('4 findings are waiting at this step of the recording.');
      expect(waitingLedeWords(1, view)).toBe('1 finding is waiting at this step of the recording.');
      expect(waitingLedeWords(4, view)).not.toMatch(/accept|bypass/i);
    }
  });

  it('say that a disputed finding can still be accepted or dismissed only where the two buttons work', () => {
    const what = `${JOB_NAMES.screen} suspected these and ${JOB_NAMES.check} did not confirm them.`;
    for (const view of openViews) {
      expect(disputedIntroWords(view)).toBe(`${what} You can still accept one if you disagree with the second check, or dismiss it.`);
    }
    for (const view of recordedViews) expect(disputedIntroWords(view)).toBe(what);
    // The live page draws that line as before.
    const turnedBack = finding({ state: 'not_confirmed', check: check({ confirmed: false, lineIds: ['L001'] }) });
    expect(bellPanel(snapOf([history()], [turnedBack]))).toContain(`${what} You can still accept one if you disagree with the second check, or dismiss it.`);
    expect(bellPanel(snapOf([history()], [finding()]))).toContain('1 finding is waiting for you. Read the evidence, then accept or bypass each one.');
  });

  it('say of an empty list of letters only what is true in the view', () => {
    expect(noLettersWords('live')).toBe(`No letters yet. When you accept a finding under the bell, ${JOB_NAMES.letter} writes a letter and it shows here.`);
    // No model is connected in the sample view.
    expect(noLettersWords('sample')).toBe('No letters yet. When you accept a finding under the bell, a sample letter shows here.');
    expect(noLettersWords('sample')).not.toContain(JOB_NAMES.letter);
    // Nothing can be accepted in a recorded run.
    for (const view of recordedViews) {
      expect(noLettersWords(view)).toBe('No letters yet at this step of the recording.');
      expect(noLettersWords(view)).not.toMatch(/accept/i);
    }
  });
});

// The line under the buttons of an open letter, and the line above the letter on its preview page.
describe('the lines about a letter in a recorded run', () => {
  const next = 'Next: read the letter and edit it if you need to. Tick the box when the patient agrees. Then open the preview to print or email it, and mark it as sent.';

  it('keeps the next step of the pharmacist in a live run and in the sample view', () => {
    expect(letterStepWords('live', next, true)).toBe(next);
    expect(letterStepWords('sample', next, true)).toBe(next);
    expect(letterStepWords('live', '', false)).toBe('');
  });

  // In a recorded run the editor, the tick box, the email, "Mark as sent" and the reply are switched off.
  it('asks for no step that is switched off in a recorded run, and says what can still be done', () => {
    expect(letterStepWords('recorded', next, true)).toBe('Recorded run. The letter is shown as it was recorded. Open the preview to print or copy it.');
    expect(letterStepWords('made_up_recording', next, true)).toBe(
      'Made-up recording of the sample view. The letter is shown as the sample data holds it. Open the preview to print or copy it.',
    );
    for (const view of ['recorded', 'made_up_recording'] as const) {
      for (const step of [next, "The letter was sent. Record the doctor's reply when it comes.", 'The reply is recorded. Close the case when nothing more is needed.']) {
        expect(letterStepWords(view, step, true)).not.toMatch(/Next:|edit|Tick|email|mark it as sent|Record the|Close the case/i);
      }
      // A letter with no text has no preview to open.
      expect(letterStepWords(view, next, false)).not.toContain('preview');
    }
  });

  it('does not send the reader back to change a letter that cannot be changed', () => {
    expect(previewLeadWords(true, false, 'live')).toBe(
      'This is the whole letter, exactly as it will leave. Nothing here can be changed. To change it, go back to the letter.',
    );
    expect(previewLeadWords(true, false, 'sample')).toContain('To change it, go back to the letter.');
    expect(previewLeadWords(true, false, 'recorded')).toBe('This is the whole letter, as it was recorded. Nothing here can be changed.');
    expect(previewLeadWords(true, false, 'made_up_recording')).toBe('This is the whole letter, as the sample data holds it. Nothing here can be changed.');
    // A letter that has left, or was closed unsent, is said the same way in every view.
    for (const view of ['live', 'sample', 'recorded', 'made_up_recording'] as const) {
      expect(previewLeadWords(false, true, view)).toBe('This is the whole letter, as it was sent. Nothing here can be changed.');
      expect(previewLeadWords(false, false, view)).toBe('This is the whole letter. It was not sent. Nothing here can be changed.');
    }
  });
});

describe('a letter built from the template', () => {
  it('says that the model did not answer when that is what happened, not that a draft failed its checks', () => {
    expect(templateWords('no_answer')).toContain('The local AI model did not answer');
    expect(templateWords('no_answer')).not.toContain('did not pass its checks');
    expect(templateWords('checks_failed')).toContain('did not pass its checks twice');
    expect(templateWords(undefined)).toContain('did not pass its checks twice');
    expect(templateWords('error')).toContain('could not be made');
  });
});

describe('the keyboard', () => {
  it('Escape goes back to the main page, unless a form inside the panel has already used the key', () => {
    expect(closesThePanel({ key: 'Escape', defaultPrevented: false })).toBe(true);
    expect(closesThePanel({ key: 'Escape', defaultPrevented: true })).toBe(false);
    expect(closesThePanel({ key: 'Enter', defaultPrevented: false })).toBe(false);
  });

  it('a key press belongs to the panel on top: the preview of a letter, not the letters under it', () => {
    const letters = { name: 'letters' };
    const preview = { name: 'preview' };
    expect(isTopPanel(preview, [letters, preview])).toBe(true);
    expect(isTopPanel(letters, [letters, preview])).toBe(false);
    expect(isTopPanel(letters, [letters])).toBe(true);
    expect(isTopPanel(null, [letters])).toBe(false);
    expect(isTopPanel(letters, [])).toBe(false);
  });
});

// ---------- the preview of a letter ----------

describe('the preview of a letter', () => {
  const closing = {
    closingLine: 'Drafted by a local AI model. Read by the pharmacist before sending.',
    signatureName: 'Sample Pharmacist',
    signatureTitle: 'Pharmacy Manager',
    signatureRegistration: 'PHA0000000000',
  };
  const words = 'Example Pharmacy\n\nPatient: Fictional patient F-001\nFictional patient. No real person.\n\nDear Doctor,\n\nPlease review the medicines.';
  const leaving = `${words}\n\nYours sincerely,\n\n${closing.closingLine}\n${closing.signatureName}\n${closing.signatureTitle}\n${closing.signatureRegistration}`;

  function aLetter(over: Partial<Letter> = {}): Letter {
    return {
      id: 'T0001', findingId: 'F0001', caseId: 'C0001', status: 'ready', subject: 'Request for a medicines review', body: leaving,
      editedByPharmacist: false, seenByPharmacist: true, previewedAt: '2026-11-18T00:09:00.000Z', previewHash: 'abc', ...closing, ...over,
    };
  }

  function preview(letter: Letter, extra: { long?: boolean; note?: string } = {}): string {
    return renderToStaticMarkup(
      <LetterPreview
        letter={letter} view={letter.status === 'ready' ? 'ready' : letter.status === 'closed' ? 'closed' : 'sent'}
        subject={letter.subject} text={leaving}
        emailDraft={extra.long ? { subject: letter.subject, text: 'A short note.', fits: false, coverNote: true } : { subject: letter.subject, text: leaving, fits: true, coverNote: false }}
        pageNote={extra.note} wide leavingForEmail={{ current: false }}
        refresh={noop} onBack={() => undefined} onSent={() => undefined}
      />,
    );
  }

  it('is a page of its own with the whole letter as it will leave, and the way back to the letter', () => {
    const markup = preview(aLetter(), { note: SAMPLE_NOTE });
    const page = text(markup);
    expect(page).toContain('Letter as it will leave Sample data. The models are not connected. Fictional patient. No real person.');
    expect(markup).toContain('<span>Back to the letter</span>');
    expect(page).toContain('This is the whole letter, exactly as it will leave. Nothing here can be changed.');
    expect(page).toContain('Request for a medicines review');
    expect(page).toContain('Dear Doctor, Please review the medicines.');
    // Nothing on it can be changed: it holds no field.
    expect(markup).not.toMatch(/<(input|textarea|select)\b/);
  });

  it('holds the four ways out, and they stand nowhere else', () => {
    const page = text(preview(aLetter()));
    for (const name of ['Print', 'Open in my email program', 'Copy', 'Mark as sent']) expect(page).toContain(name);
    // A link for the email program with the subject and the letter, and no address.
    const markup = preview(aLetter());
    expect(markup).toContain('data-mailto="mailto:?subject=Request%20for%20a%20medicines%20review&amp;body=Example%20Pharmacy');
    expect(markup).not.toContain('@');
  });

  it('ends the letter with its last lines, once, with the name set apart for the handwriting font', () => {
    const markup = preview(aLetter());
    expect(markup.split('Yours sincerely,')).toHaveLength(2);
    expect(markup.split('Sample Pharmacist')).toHaveLength(2);
    expect(markup).toContain('<p class="closing-name">Sample Pharmacist</p>');
    const lines = text(renderToStaticMarkup(<LetterClosing closing={closing} />));
    expect(lines).toContain('Yours sincerely, Drafted by a local AI model. Read by the pharmacist before sending. Sample Pharmacist Pharmacy Manager PHA0000000000');
    // A letter that carries no line about who wrote the words shows none.
    expect(text(renderToStaticMarkup(<LetterClosing closing={{ ...closing, closingLine: '' }} />))).toContain('Yours sincerely, Sample Pharmacist Pharmacy Manager PHA0000000000');
  });

  it('lets a letter be marked as sent only when it is ready and this text was previewed', () => {
    // The opening tag of the button "Mark as sent".
    const sendOf = (markup: string): string => {
      const at = markup.indexOf('data-opens="sent"');
      return markup.slice(markup.lastIndexOf('<button', at), at);
    };
    expect(sendOf(preview(aLetter()))).not.toContain('disabled');
    // Not yet recorded as previewed by the server: the step stays closed, and the button says why.
    const notYet = sendOf(preview(aLetter({ previewedAt: undefined, previewHash: undefined })));
    expect(notYet).toContain('disabled=""');
    expect(notYet).toContain('title="Open the preview and read the letter as it will leave."');
    // A letter that has left is shown as it was sent. It can still be printed and copied, not sent again.
    const sent = preview(aLetter({ status: 'sent', sentAt: '2026-11-18T00:09:30.000Z' }));
    expect(text(sent)).toContain('Letter as it was sent');
    expect(text(sent)).toContain('This letter was sent. It can still be printed and copied.');
    expect(sendOf(sent)).toContain('disabled=""');
    expect(sendOf(sent)).toContain('title="This letter was already sent."');
    expect(previewTitle({ status: 'closed' })).toBe('Letter that was not sent');
  });

  it('says on its face and in the print view when an answer was taken back after the letter was sent', () => {
    const note = 'An answer this letter rested on was taken back. The letter was not changed, because it was already marked as sent.';
    const markup = preview(aLetter({ status: 'sent', sentAt: '2026-11-18T00:09:30.000Z', withdrawnNote: note }));
    expect(text(markup)).toContain(note);
    expect(markup).toContain('note note--warn');
    expect(leaving).not.toContain(note);
  });

  it('says so when the letter is longer than an email draft can hold, and points to Copy and Print', () => {
    expect(text(preview(aLetter(), { long: true }))).toContain('This letter is longer than an email draft can hold.');
    expect(text(preview(aLetter(), { long: true }))).toContain('Use Copy or Print for the letter itself.');
    expect(text(preview(aLetter()))).not.toContain('longer than an email draft');
  });
});

describe('typing in the lower part of a letter', () => {
  it('keeps the scroll position while the box is given its new height', () => {
    // A stand-in for the letter box and the scrolling area above it. While the height is "auto"
    // the browser pulls the scroll position back, as it did on the real page (557 became 341).
    const scroller = { scrollTop: 557, parentElement: null as unknown };
    const style = {
      value: '900px',
      get height(): string { return this.value; },
      set height(next: string) {
        this.value = next;
        if (next === 'auto') scroller.scrollTop = 341;
      },
    };
    const box = { style, scrollHeight: 1150, parentElement: scroller } as unknown as HTMLElement;
    fitHeightKeepingScroll(box);
    expect(style.height).toBe('1152px');
    expect(scroller.scrollTop).toBe(557);
  });
});

// ---------- the first screen ----------

describe('the first screen', () => {
  it('shows what must not be missed beside the status line, and nothing when all is well', () => {
    const quiet = text(renderToStaticMarkup(<StatusLine now={{ stage: null, text: 'Idle' }} serverDown={false} />));
    expect(quiet).toContain('Now: Idle');
    expect(quiet).not.toContain('not fully screened');
    const loud = text(renderToStaticMarkup(
      <StatusLine
        now={{ stage: null, text: 'Idle' }} serverDown={false}
        alerts={[
          { key: 'models', text: 'The local models are not running. A history cannot be screened until they are.' },
          { key: 'not-fully', text: '1 history was not fully screened. This is not the same as no finding.', action: 'See which', onAction: () => undefined },
        ]}
      />,
    ));
    expect(loud).toContain('The local models are not running.');
    expect(loud).toContain('1 history was not fully screened. This is not the same as no finding. See which');
  });

  it('says what is closed and what is overdue, and writes one history as one', () => {
    const counts = {
      historiesScreened: 1, findingsConfirmed: 2, accepted: 1, bypassed: 0, lettersReady: 0, lettersSent: 1,
      repliesRecorded: 0, closed: 1, overdue: 1, bellBadge: 0, letterBadge: 0,
    };
    const line = text(renderToStaticMarkup(<CountsLine counts={counts} />));
    expect(line).toContain('1 history screened');
    expect(line).toContain('2 findings confirmed');
    expect(line).toContain('1 letter closed');
    expect(line).toContain('1 letter overdue');
    expect(line).not.toContain('1 histories screened');
    const none = text(renderToStaticMarkup(<CountsLine counts={{ ...counts, closed: 0, overdue: 3 }} />));
    expect(none).toContain('0 letters closed');
    expect(none).toContain('3 letters overdue');
  });
});

describe('questions for the pharmacist', () => {
  it('shows the buttons and how many checks could not run', () => {
    const asked = history({
      questions: [
        {
          id: 'Q0001', key: 'condition\nheart failure', kind: 'condition', what: 'Heart failure',
          meets: 'the patient has heart failure', criterionIds: ['ONE'], findingIds: ['F0001'],
          source: 'possible', status: 'open', needsValue: false,
          options: [
            { words: 'Yes', effect: 'meets' },
            { words: 'No', effect: 'does_not_meet' },
            { words: 'Not known', effect: 'unknown' }
          ]
        },
        {
          id: 'Q0002', key: 'result\nage', kind: 'result', what: 'Age',
          meets: 'the age in years', criterionIds: ['TWO'], findingIds: [],
          source: 'patient', status: 'open', needsValue: true,
          note: 'The age limit could not be read.',
          options: [{ words: 'Not known', effect: 'unknown' }]
        }
      ]
    });
    const known = { ...criteria, TWO: { ...criterion, id: 'TWO', label: 'Criterion two' } };
    const page = bellPanel(snapOf([asked], [finding({
      possible: true,
      screen: { ...finding().screen, missingFacts: ['Heart failure'] }
    })]), undefined, known);
    expect(page).toContain('Questions for the pharmacist');
    expect(page).toContain('Heart failure');
    expect(page).toContain('Yes');
    expect(page).toContain('No');
    expect(page).toContain('Not known');
    expect(page).toContain('1 check could not run until this question is answered.');
    expect(page).toContain('Show which checks');
    expect(page).not.toContain('Hide the checks');
    expect(page).toContain('The age limit could not be read.');
    expect(page).not.toContain('Leave these unanswered');
  });

  it('shows the condition-marker question and why its medicine opened it in the existing question card', () => {
    const reason = 'Asked because Entresto (sacubitril with valsartan) 24/26 mg tablet is supplied; it points to chronic heart failure.';
    const asked = history({
      questions: [{
        id: 'Q0005', key: 'condition\nheart failure', kind: 'condition', what: 'Heart failure',
        meets: 'the patient has heart failure', criterionIds: ['ONE'], findingIds: [],
        source: 'supply', status: 'open', needsValue: false, note: reason,
        conditionMarker: {
          condition: 'chronic heart failure',
          question: 'Does this patient have chronic heart failure?',
          lineIds: ['L001']
        },
        options: [
          { words: 'Yes', effect: 'meets' },
          { words: 'No', effect: 'does_not_meet' },
          { words: 'Not known', effect: 'unknown' }
        ]
      }]
    });
    const markup = bellMarkup(snapOf([asked]));
    const page = text(markup);
    expect(page).toContain('Does this patient have chronic heart failure?');
    expect(page).toContain(reason);
    expect(markup).toContain('<h3 class="finding-label">Does this patient have chronic heart failure?</h3>');
    expect(markup).toContain(`<p class="note">${reason}</p>`);
  });

  it('shows the display words when open questions share a list question, and the list question when one is alone', () => {
    const listQuestion = 'Does this patient have atrial fibrillation?';
    const noteA = 'Asked because Eliquis (apixaban) 5 mg tablet is supplied; it points to atrial fibrillation.';
    const noteB = 'Asked because Lanoxin (digoxin) 62.5 microgram tablet is supplied; it points to atrial fibrillation.';
    const buttons = [
      { words: 'Yes', effect: 'meets' as const },
      { words: 'No', effect: 'does_not_meet' as const },
      { words: 'Not known', effect: 'unknown' as const },
    ];
    // The API puts the display copy in conditionMarker.question. When two open questions share
    // the stored list words, that copy is each fact's own what. One open question keeps the list question.
    const ask = (id: string, what: string, display: string, note: string) => ({
      id, key: `condition\n${what.toLowerCase()}`, kind: 'condition' as const, what,
      meets: what, criterionIds: [id], findingIds: [] as string[],
      source: 'supply' as const, status: 'open' as const, needsValue: false, note,
      conditionMarker: { condition: 'atrial fibrillation', question: display, lineIds: ['L001'] },
      options: buttons,
    });
    const shared = bellMarkup(snapOf([history({
      questions: [
        ask('Q0001', 'Atrial fibrillation', 'Atrial fibrillation', noteA),
        ask('Q0002', 'Chronic atrial fibrillation', 'Chronic atrial fibrillation', noteB),
      ],
    })]));
    expect(shared).toContain('<h3 class="finding-label">Atrial fibrillation</h3>');
    expect(shared).toContain('<h3 class="finding-label">Chronic atrial fibrillation</h3>');
    expect(shared).not.toContain(listQuestion);
    expect(shared).toContain(`<p class="note">${noteA}</p>`);
    expect(shared).toContain(`<p class="note">${noteB}</p>`);
    expect(shared).toContain('>Yes<');
    expect(shared).toContain('>No<');
    expect(shared).toContain('>Not known<');

    const alone = bellMarkup(snapOf([history({
      questions: [ask('Q0003', 'Atrial fibrillation', listQuestion, noteA)],
    })]));
    expect(alone).toContain(`<h3 class="finding-label">${listQuestion}</h3>`);
    expect(alone).not.toContain('<h3 class="finding-label">Atrial fibrillation</h3>');
    expect(alone).toContain(`<p class="note">${noteA}</p>`);
  });

  it('puts standing questions on one line, and one control leaves them unanswered', () => {
    const buttons = [
      { words: 'Yes', effect: 'meets' as const },
      { words: 'No', effect: 'does_not_meet' as const },
      { words: 'Not known', effect: 'unknown' as const }
    ];
    const asked = history({
      questions: [
        {
          id: 'Q0001', key: 'condition\nheart failure', kind: 'condition', what: 'Heart failure',
          meets: 'the patient has heart failure', criterionIds: ['ONE'], findingIds: ['F0001'],
          source: 'possible', status: 'open', needsValue: false, options: buttons
        },
        {
          id: 'Q0003', key: 'condition\nfalls', kind: 'condition', what: 'Falls',
          meets: 'the patient has fallen', criterionIds: ['ONE'], findingIds: [],
          source: 'patient', status: 'open', needsValue: false, options: buttons
        },
        {
          id: 'Q0004', key: 'condition\nosteoporosis', kind: 'condition', what: 'Osteoporosis',
          meets: 'the patient has osteoporosis', criterionIds: ['THREE'], findingIds: [],
          source: 'patient', status: 'open', needsValue: false, leftUnanswered: true, options: buttons
        }
      ]
    });
    const markup = bellMarkup(snapOf([asked]));
    expect(markup).toContain('<li class="question-line"><span>Falls</span>');
    expect(markup).toContain('Leave these unanswered');
    expect(markup).toContain(LEAVE_UNANSWERED_WORDS);
    expect(markup).toContain(LEFT_UNANSWERED_WORDS);
    expect(markup).toContain('<h3 class="finding-label">Heart failure</h3>');
    expect(markup).not.toContain('Osteoporosis');
    expect(markup).toContain('Show the questions');
    expect(markup).toContain('2 checks could not run until these questions are answered.');
    expect(markup.match(/role="dialog"/g)).toHaveLength(1);
  });

  it('follows the open questions, not the checks, for this question and these questions', () => {
    expect(checksStillWaitingWords(1, 1)).toBe('1 check could not run until this question is answered.');
    expect(checksStillWaitingWords(1, 2)).toBe('1 check could not run until these questions are answered.');
    expect(checksStillWaitingWords(2, 1)).toBe('2 checks could not run until this question is answered.');
    expect(checksStillWaitingWords(2, 2)).toBe('2 checks could not run until these questions are answered.');

    const buttons = [
      { words: 'Yes', effect: 'meets' as const },
      { words: 'No', effect: 'does_not_meet' as const },
      { words: 'Not known', effect: 'unknown' as const },
    ];
    const ask = (id: string, what: string, criterionIds: string[]) => ({
      id, key: what.toLowerCase(), kind: 'condition' as const, what, meets: what,
      criterionIds, findingIds: [] as string[], source: 'patient' as const, status: 'open' as const,
      needsValue: false, options: buttons,
    });
    const oneCheck = history({
      questions: [
        ask('Q0001', 'Osteoporosis', ['START-H4']),
        ask('Q0002', 'Previous fragility fracture', ['START-H4']),
      ],
    });
    expect(bellPanel(snapOf([oneCheck]))).toContain('1 check could not run until these questions are answered.');

    const oneQuestion = history({
      questions: [ask('Q0003', 'Osteoporosis', ['START-H4', 'ONE'])],
    });
    expect(bellPanel(snapOf([oneQuestion]))).toContain('2 checks could not run until this question is answered.');
  });

  it('keeps an answer the engine refuses while its own criterion is being screened, and says Saving while it is saved', () => {
    expect(isOwnCriterionRefusal('The criterion for this question is being screened. The question can be answered when that finishes.')).toBe(true);
    expect(isOwnCriterionRefusal('This history is still being screened. The question can be answered when that finishes.')).toBe(false);
    expect(keptAnswerWords('No')).toBe('No is kept. The criterion for this question is being screened at this moment. Press it again and it is saved.');
    expect(answerButtonWords(true, 'No')).toBe('Saving');
    expect(answerButtonWords(false, 'Save this answer')).toBe('Save this answer');
  });

  it('says on the findings line that criteria are screened again after an answer', () => {
    const asked = history({
      screening: { status: 'waiting', criteria: [{ criterionId: 'ONE', status: 'waiting' }] },
      questions: [{
        id: 'Q0001', key: 'condition\nheart failure', kind: 'condition', what: 'Heart failure',
        meets: 'the patient has it', criterionIds: ['ONE'], findingIds: ['F0001'],
        source: 'possible', status: 'answered', needsValue: false,
        options: [{ words: 'No', effect: 'does_not_meet' }],
        answer: { lineId: 'L900', words: 'No', effect: 'does_not_meet', at: '2026-11-20T00:00:00.000Z' },
        heldRuns: [{ criterionId: 'ONE', status: 'suspected' }]
      }]
    });
    const page = bellPanel(snapOf([asked], []));
    expect(page).toContain('No findings are waiting for you.');
    expect(page).toContain(SCREENED_AGAIN);
    const card = importPanel(snapOf([asked]));
    expect(card).toContain(`Waiting in line for Mantle. ${SCREENED_AGAIN}`);
  });

  it('shows both ways when a pathology test can answer, and the same typed form when it cannot', () => {
    const typed = {
      id: 'Q0009', key: 'result\nserum sodium', kind: 'result' as const, what: 'Serum sodium',
      meets: 'the latest serum sodium', criterionIds: ['ONE'], findingIds: [] as string[],
      source: 'patient' as const, status: 'open' as const, needsValue: true,
      options: [{ words: 'Not known', effect: 'unknown' as const }],
    };
    const without = bellMarkup(snapOf([history({ questions: [typed] })]));
    const withTests = bellMarkup(snapOf([history({
      questions: [{ ...typed, pathology: { tests: [{ key: 'sodium', name: 'Sodium' }, { key: 'potassium', name: 'Potassium' }] } }],
    })]));
    expect(withTests).toContain('Type the result');
    expect(withTests).toContain('Upload the pathology test');
    expect(withTests).not.toContain('path-O-finder');
    expect(without).not.toContain('Type the result');
    expect(without).not.toContain('Upload the pathology test');
    expect(without).not.toContain('path-O-finder');
    expect(formOf(withTests)).toBe(formOf(without));
    expect(formOf(without)).toContain('id="Q0009-value"');
    expect(formOf(without)).toContain('placeholder="2026-11-19"');
    expect(formOf(without)).toContain('Save this answer');

    const upload = renderToStaticMarkup(
      <PathologyUploadPanel
        tests={[{ key: 'sodium', name: 'Sodium' }, { key: 'potassium', name: 'Potassium' }]}
        progress={null}
        disabled={false}
        inputId="Q0009-pathology-file"
        onFile={() => undefined}
      />,
    );
    expect(upload).toContain('class="path-o-finder"');
    expect(upload).toContain('alt="path-O-finder"');
    expect(upload).toContain('Every result finds its path, and every path is one a pharmacist chose.');
    expect(upload).toContain('Tests the LANTERN can read from a report for this question: Sodium and Potassium.');
    expect(upload).toContain('path-O-finder reads the report for the LANTERN. It reads. It does not judge the result.');
    expect(upload).toContain('accept=".pdf,.png,.jpg,.jpeg"');
    expect(upload).toContain('Choose the pathology test');
    expect(upload).not.toContain('class="bypass-form"');
  });
});

/** The typed-result block, from its opening div through the matching close. */
function formOf(markup: string): string {
  const start = markup.indexOf('<div class="bypass-form">');
  if (start < 0) throw new Error('no typed form');
  let depth = 0;
  for (let i = start; i < markup.length; i++) {
    if (markup.startsWith('<div', i)) depth += 1;
    else if (markup.startsWith('</div>', i)) {
      depth -= 1;
      if (depth === 0) return markup.slice(start, i + '</div>'.length);
    }
  }
  throw new Error('typed form did not close');
}
