// The sample answer of POST .../pathology. Fictional numbers only. The page can be built against
// this before it talks to the local server. The shape is the server's PathologyResponse.
import type { PharmacistQuestion } from '../../shared/types.ts';
import { ApiError } from '../apiError.ts';
import type { PathologyResponse, PathologyUploadRequest } from '../lib/pathologyFile.ts';

/** A sure sodium reading, as a text page of a fictional report would give it. */
export const SURE_SODIUM: PathologyResponse = {
  fact: 'Serum sodium',
  tests: [{ key: 'sodium', name: 'Sodium' }],
  readings: [{
    analyte: 'sodium',
    name: 'Sodium',
    value: 128,
    valueWords: '128',
    unit: 'mmol/L',
    refLow: 135,
    refHigh: 145,
    flag: 'L',
    date: '2026-03-12',
    multipleOfUpper: 0.9,
    line: 'Sodium 128 mmol/L (135-145) L',
    page: 1,
    sure: true,
    readBy: 'text',
  }],
  abstained: [],
  collected: { date: '2026-03-12', line: 'Collected 12/03/2026' },
};

const EMPTY_FILE = 'The pathology test is empty.';
const TOO_MANY = 'The pathology test has more than 10 pages. Upload only the pages that hold the result.';

/**
 * The sample route. It refuses the same empty file and the same over-long file as the server.
 * The reading itself is the fixture, not a second reader.
 */
export function pathologyFromFixture(
  question: PharmacistQuestion | undefined,
  body: PathologyUploadRequest,
): PathologyResponse {
  if (!question) throw new ApiError('This question was not found.', 404);
  if (question.status !== 'open') {
    throw new ApiError('This question already has an answer. Take it back before reading a pathology test for it.', 409);
  }
  if (!question.pathology || question.pathology.tests.length === 0) {
    throw new ApiError('This question is not answered from a pathology test. Type the answer.', 400);
  }
  const pages = Array.isArray(body.pages) ? body.pages : [];
  const images = Array.isArray(body.pageImages) ? body.pageImages : [];
  if (images.some((page) => typeof page !== 'string' || page === '')) {
    throw new ApiError('A page picture of the pathology test is missing.', 400);
  }
  if (pages.length + images.length === 0) throw new ApiError(EMPTY_FILE, 400);
  if (pages.length + images.length > 10) throw new ApiError(TOO_MANY, 400);
  return {
    ...SURE_SODIUM,
    fact: question.what,
    tests: question.pathology.tests,
  };
}
