// A criterion that needs no facts must be asked exactly what it was asked before records could
// carry conditions and results (docs/SPEC.md section 6a), so that its results do not change.
// The hashes below were taken from the baseline commit of 18 November ("Working baseline"), with
// the test criterion and the test history of pipeline/testkit.ts. If one of them changes, the
// models are being sent something else for the first ten criteria: that needs a new scored run.
// The letter hash was updated later the same day for G03. The screen and check hashes were not.
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Finding, ScreenResult } from '../shared/types.ts';
import { checkMessages, CHECK_SCHEMA } from './check.ts';
import { linesById } from './history.ts';
import { assembleLetter, citedLineIds, letterMessages, LETTER_SCHEMA, templateParagraphs } from './letter.ts';
import { screenMessages, screenPartMessages, screenSchemaFor, SCREEN_PART_SCHEMA, SCREEN_SCHEMA } from './screen.ts';
import { factsCriterion, factsLines, testConfig, testCriterion, testLines, testPatient } from './testkit.ts';

const sha = (value: unknown): string => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

// The fields the baseline had. The new field is left out here on purpose: the prompts must not need it.
const first = {
  lineIds: ['L002', 'L003', 'L004', 'L005'], medicines: ['celecoxib', 'rivaroxaban'], reason: 'Celebrex with Xarelto.',
  linesVerified: true, model: 'lantern-screen', at: '2026-11-18T00:00:00.000Z', seconds: 5
} as unknown as ScreenResult;

const finding = {
  id: 'F0001', caseId: 'C0001', criterionId: testCriterion.id, state: 'accepted', screen: first, seenByPharmacist: true,
  check: {
    confirmed: true, lineIds: ['L002', 'L003'], whatMatches: 'Celebrex and Xarelto within 60 days.',
    whatCannotBeSeen: 'Whether the medicines were taken.', completed: true, model: 'lantern-check', at: '2026-11-18T00:00:10.000Z', seconds: 9
  }
} as unknown as Finding;

describe('a criterion without facts is asked exactly what it was asked at the baseline', () => {
  it('the screen request: the same prompt and the same answer form', () => {
    expect(screenSchemaFor(testCriterion)).toBe(SCREEN_SCHEMA);
    expect(sha({ messages: screenMessages(testPatient, testLines, testCriterion), schema: screenSchemaFor(testCriterion) }))
      .toBe('207c419af5aae0559659dfa6c20f5c99387d6e1e19f3b553937a731b4b390149');
  });

  it('the request for one part of a long history', () => {
    expect(sha({ messages: screenPartMessages(testPatient, testLines.slice(0, 3), testCriterion, 0, 2), schema: SCREEN_PART_SCHEMA }))
      .toBe('24cc96b554fba730d27c3e22ff8aa47c25ba14f446ef92f857ca8f9185e71400');
  });

  it('the double-check request', () => {
    expect(sha({ messages: checkMessages(testPatient, testLines, testCriterion, first), schema: CHECK_SCHEMA }))
      .toBe('2177b0c9541c1744b610b808c07eb767996048ff93586991449303145926ca4c');
    // A first result that carries the new field, empty, gives the same request.
    expect(sha({ messages: checkMessages(testPatient, testLines, testCriterion, { ...first, missingFacts: [] }), schema: CHECK_SCHEMA }))
      .toBe('2177b0c9541c1744b610b808c07eb767996048ff93586991449303145926ca4c');
  });

  it('the letter request, and the letter built from the template', () => {
    const cited = linesById(testLines, citedLineIds(finding));
    // G03 added two sentences to the letter system prompt: a quantity and a number of repeats
    // stay with the supply date on the same line. Screen and check requests are unchanged.
    expect(sha({ messages: letterMessages(testPatient, testCriterion, finding, cited), schema: LETTER_SCHEMA }))
      .toBe('316f214deacc534d5786d2c22b8cd7caf9824996e7ee168b5016f7cc01a11190');
    // The letter itself changed on 18 November: the founder removed the last line of a
    // template letter (G12). It now ends with the signature.
    expect(sha(assembleLetter({
      cfg: testConfig, patient: testPatient, criterion: testCriterion, cited,
      paragraphs: templateParagraphs(testCriterion, cited), origin: 'template', when: new Date(2026, 10, 18, 9, 30)
    }))).toBe('ff3ddc1ce3e62db34b4fc9c0276783d6fd43db48064a7d5e39273c60cbcadd4a');
  });

  it('and a criterion that needs facts is asked something else', () => {
    // The other side of the same rule: only a criterion with needs_facts gets the new form and words.
    expect(screenSchemaFor(factsCriterion)).not.toBe(SCREEN_SCHEMA);
    expect(screenMessages(testPatient, factsLines, factsCriterion)[1].content).toContain('FACTS THIS CRITERION NEEDS');
    expect(screenMessages(testPatient, testLines, testCriterion)[1].content).not.toContain('FACTS');
    expect(screenMessages(testPatient, testLines, testCriterion)[1].content).not.toContain('missing_facts');
  });
});
