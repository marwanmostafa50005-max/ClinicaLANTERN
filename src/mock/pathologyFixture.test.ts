import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PharmacistQuestion } from '../../shared/types.ts';
import { ApiError } from '../apiError.ts';
import { pathologyFromFixture, SURE_SODIUM } from './pathologyFixture.ts';

function question(over: Partial<PharmacistQuestion> = {}): PharmacistQuestion {
  return {
    id: 'Q0009', key: 'result\nserum sodium', kind: 'result', what: 'Serum sodium',
    meets: 'the latest serum sodium', criterionIds: ['ONE'], findingIds: [],
    source: 'patient', status: 'open', needsValue: true,
    options: [{ words: 'Not known', effect: 'unknown' }],
    pathology: { tests: [{ key: 'sodium', name: 'Sodium' }] },
    ...over,
  };
}

const PAGES = { fileName: 'fictional-report.pdf', pages: [['Sodium 128 mmol/L']] };

describe('the sample pathology route', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('returns the sure sodium fixture for an open question', () => {
    const got = pathologyFromFixture(question({ what: 'Latest serum sodium' }), PAGES);
    expect(got.fact).toBe('Latest serum sodium');
    expect(got.tests).toEqual([{ key: 'sodium', name: 'Sodium' }]);
    expect(got.readings).toEqual(SURE_SODIUM.readings);
    expect(got.readings[0].sure).toBe(true);
    expect(got.abstained).toEqual([]);
  });

  it('refuses a closed question, a question with no analyte, an empty file, a missing picture, and more than 10 pages', () => {
    const closed = () => pathologyFromFixture(question({ status: 'answered' }), PAGES);
    expect(closed).toThrow(ApiError);
    expect(closed).toThrow('This question already has an answer. Take it back before reading a pathology test for it.');
    try { closed(); } catch (err) { expect((err as ApiError).status).toBe(409); }

    const none = () => pathologyFromFixture(question({ pathology: undefined }), PAGES);
    expect(none).toThrow('This question is not answered from a pathology test. Type the answer.');
    try { none(); } catch (err) { expect((err as ApiError).status).toBe(400); }

    const empty = () => pathologyFromFixture(question(), { fileName: 'empty.pdf' });
    expect(empty).toThrow('The pathology test is empty.');

    const missing = () => pathologyFromFixture(question(), { fileName: 'scan.png', pageImages: [''] });
    expect(missing).toThrow('A page picture of the pathology test is missing.');

    const long = () => pathologyFromFixture(question(), {
      fileName: 'long.pdf',
      pages: Array.from({ length: 11 }, () => ['Sodium 128']),
    });
    expect(long).toThrow('The pathology test has more than 10 pages. Upload only the pages that hold the result.');
  });

  it('answers through the sample backend once the question is on a sample history', async () => {
    vi.resetModules();
    const { addSampleQuestion, mockBackend } = await import('./server.ts');
    addSampleQuestion('C0001', question());
    const got = await mockBackend.readPathology('C0001', 'Q0009', PAGES);
    expect(got.readings[0].valueWords).toBe('128');
    expect(got.readings[0].readBy).toBe('text');
    await expect(mockBackend.readPathology('C0000', 'Q0009', PAGES)).rejects.toThrow('This history was not found.');
  });
});
