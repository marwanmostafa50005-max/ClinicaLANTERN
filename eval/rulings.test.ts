// The founder's two rulings that Kimi Code tests (DRIVE_413.md, task G11). No model.
// Fictional data only.
// Ruling 3: a disputed planted finding is scored as disputed, never a miss, and fails no criterion.
// Ruling 2: a letter cannot be marked as sent without a preview of exactly that text.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CheckResult, Criterion, Finding, LetterDraft, ScreenResult } from '../shared/types.ts';
import { testConfig, testCriterion } from '../pipeline/testkit.ts';
import { passingLists, scoreRun } from './score.ts';
import {
  checkConfirmed,
  checkNotConfirmed,
  expectedCase,
  letterByModel,
  makeCriterion,
  pair,
  planted,
  screenClear,
  screenSuspected,
} from './testkit.ts';
import { ApiError, Engine, type PipelineFns } from '../server/engine.ts';
import { PageImages } from '../server/images.ts';
import { StateStore } from '../server/store.ts';

describe("the founder's ruling 3: a disputed planted finding is scored as disputed", () => {
  const criterion = makeCriterion('STOPP-C10');
  const caught = expectedCase('STOPP-C10/pos-brand.csv', 'positive', [planted('STOPP-C10', ['L001'])]);
  const disputed = expectedCase('STOPP-C10/pos-nofact.csv', 'positive', [planted('STOPP-C10', ['L002'])]);
  const missed = expectedCase('STOPP-C10/pos-other.csv', 'positive', [planted('STOPP-C10', ['L003'])]);

  it('counts one disputed and no miss, and the criterion does not fail for it', () => {
    const run = scoreRun({
      criteria: [criterion],
      cases: [caught, disputed],
      lettersRun: true,
      pairs: [
        pair(caught.file, 'STOPP-C10', screenSuspected(['L001']), checkConfirmed(['L001']), letterByModel()),
        pair(disputed.file, 'STOPP-C10', screenSuspected(['L002']), checkNotConfirmed()),
      ],
    });
    const s = run.criteria[0];
    expect(s.verdict).toBe('PASS');
    expect(s.caught).toBe(1);
    expect(s.disputed).toBe(1);
    expect(s.disputes.map((d) => d.caseFile)).toEqual([disputed.file]);
    expect(s.misses).toEqual([]);
    expect(s.letters.needed).toBe(1); // the caught finding only; a disputed finding needs no letter
    expect(run.totals.disputed).toBe(1);
    const lists = passingLists(run);
    expect(lists.passing).toEqual(['STOPP-C10']);
    expect(lists.not_passing).toEqual([]);
  });

  it('still fails the criterion when a planted finding is not suspected at all', () => {
    const run = scoreRun({
      criteria: [criterion],
      cases: [disputed, missed],
      lettersRun: true,
      pairs: [
        pair(disputed.file, 'STOPP-C10', screenSuspected(['L002']), checkNotConfirmed()),
        pair(missed.file, 'STOPP-C10', screenClear()),
      ],
    });
    const s = run.criteria[0];
    expect(s.verdict).toBe('FAIL');
    expect(s.disputed).toBe(1);
    expect(s.misses.map((m) => m.caseFile)).toEqual([missed.file]);
    expect(s.whyFailed).toContain('pos-other.csv');
  });
});

describe("the founder's ruling 2: no letter leaves without a preview", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  const ONE: Criterion = { ...testCriterion, id: 'ONE', label: 'Criterion one' };
  const CSV = [
    'patient_ref,patient_age,patient_sex,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber',
    'F-001,72,F,2026-08-08,,Xarelto,20 mg,tablet,28,5,Take ONE tablet daily with food,Dr F. Example',
    'F-001,72,F,2026-08-21,,Celebrex,200 mg,capsule,30,2,Take ONE capsule daily with food,Dr G. Sample',
  ].join('\r\n');

  function makeEngine() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-rulings-'));
    made.push(dir);
    const store = new StateStore(dir);
    store.load();
    const pipeline: PipelineFns = {
      screenCriterion: async () => ({ ok: true, suspected: true, result: screenAnswer(['L001', 'L002']) }),
      checkFinding: async () => checkAnswer(true),
      draftLetter: async () => letterAnswer(),
      transcribePageImage: async () => ({ ok: false, error: 'not used' }),
    };
    const engine = new Engine({
      cfg: testConfig,
      store,
      pipeline,
      images: new PageImages(path.join(dir, 'images')),
      loadCriteria: async () => [ONE],
      now: () => new Date('2026-11-18T01:00:00.000Z'),
      saveRetryMs: 15,
    });
    return engine;
  }

  function screenAnswer(lineIds: string[]): ScreenResult {
    return { lineIds, medicines: ['celecoxib', 'rivaroxaban'], reason: 'Both are supplied.', linesVerified: true, missingFacts: [], model: 'lantern-screen', at: '2026-11-18T00:00:00.000Z', seconds: 1 };
  }
  function checkAnswer(confirmed: boolean): CheckResult {
    return { confirmed, lineIds: ['L001', 'L002'], whatMatches: 'Celebrex and Xarelto.', whatCannotBeSeen: 'Kidney function.', completed: true, model: 'lantern-check', at: '2026-11-18T00:00:10.000Z', seconds: 2 };
  }
  function letterAnswer(): LetterDraft {
    return { subject: 'Review request', body: 'Fictional patient. No real person.\n\nThe letter text.', origin: 'model', checkNotes: [], model: 'lantern-letter', at: '2026-11-18T00:01:00.000Z', seconds: 2 };
  }

  async function readyLetter(): Promise<{ engine: Engine; letterId: string }> {
    const engine = makeEngine();
    const { caseId } = await engine.importCase({ fileName: 'positive.csv', source: 'csv', csvText: CSV });
    await engine.whenIdle();
    const finding = engine.state.findings.find((f: Finding) => f.caseId === caseId);
    expect(finding).toBeDefined();
    engine.decide(finding!.id, { action: 'accept' });
    await engine.whenIdle();
    const letter = engine.state.letters[0];
    expect(letter.status).toBe('ready');
    return { engine, letterId: letter.id };
  }

  it('is refused for a letter with no preview, refused after a preview and then an edit, and taken after a preview of exactly that text', async () => {
    const { engine, letterId } = await readyLetter();

    // no preview: refused
    let caught: unknown;
    try {
      engine.markSent(letterId, { by: 'print' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(409);
    expect((caught as ApiError).message).toContain('not been previewed');

    // preview, then an edit: the preview is cleared, and sending is refused
    const preview = engine.previewLetter(letterId);
    expect(preview.text.endsWith('Marwan Morsy\nPharmacy Manager\nPHA0002761764')).toBe(true); // ruling 1: the signature is the last lines
    engine.editLetter(letterId, { subject: 'Review request, edited', body: 'Fictional patient. No real person.\n\nEdited text.', expectedRevision: 0 });
    expect(engine.state.letters[0].previewedAt).toBeUndefined();
    caught = undefined;
    try {
      engine.markSent(letterId, { by: 'print' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(409);
    expect((caught as ApiError).message).toMatch(/preview/i);

    // a preview of exactly the text that leaves: taken
    const sentPreview = engine.previewLetter(letterId);
    engine.markSent(letterId, { by: 'print', previewToken: sentPreview.previewToken });
    expect(engine.state.letters[0].status).toBe('sent');
    expect(engine.state.letters[0].sentBy).toBe('print');
  }, 30000);
});
