// Reading one page of an uploaded pathology test that has no text layer (a scan or a photograph).
// The first model, which has a vision part, writes the page out line by line. It only reads: the lines go to
// pipeline/pathology.ts, which finds the value by rule and abstains when unsure. The page is read TWICE, and a line
// is used only when both readings hold it (the rule of path-O-finder: two passes must agree).
import type { LanternConfig } from '../shared/types.ts';
import { chat, type JsonSchema } from './ollama.ts';
import type { JobDeps } from './screen.ts';
import { cleanBase64, TRANSCRIBE_TIMEOUT_MS } from './transcribe.ts';

export const PATHOLOGY_PAGE_NUM_PREDICT = 6000;

export const PATHOLOGY_PAGE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { lines: { type: 'array', items: { type: 'string' } } },
  required: ['lines']
};

// THE TEXT THE MODEL READS. It is fixed in prompts/PATH-CONTRACT.md on the build board, word for word.
export const PATHOLOGY_PAGE_SYSTEM =
  'You read one page of a printed pathology report from an image and write its text out line by line. You only read. ' +
  'Write every line exactly as printed, left to right, top to bottom. ' +
  'Keep a test name, its value, its unit, its reference range and any flag letter together on one line, separated by single spaces. ' +
  'Keep every digit, decimal point, sign (< or >) and unit exactly as printed. ' +
  'Do not correct, round, convert, interpret or comment. ' +
  'If a character cannot be read, write ? in its place. ' +
  'Do not add any line that is not on the page. ' +
  'Answer with JSON only, in this form: {"lines": ["first line", "second line"]}';

export const PATHOLOGY_PAGE_TASK = 'Write out the text of this page, line by line.';

export type PathologyPageOutcome =
  | { ok: true; lines: string[] }
  | { ok: false; error: string };

/** One reading of one page image: its lines, as the model wrote them out. */
export async function transcribePathologyPage(cfg: LanternConfig, base64Png: string, deps: JobDeps = {}): Promise<PathologyPageOutcome> {
  const call = deps.chat ?? chat;
  const image = typeof base64Png === 'string' ? cleanBase64(base64Png) : '';
  if (!image) return { ok: false, error: 'The page image is empty.' };
  try {
    const answer = await call<{ lines: unknown }>(cfg, {
      model: cfg.models.screen,
      think: cfg.think.screen,
      schema: PATHOLOGY_PAGE_SCHEMA,
      messages: [
        { role: 'system', content: PATHOLOGY_PAGE_SYSTEM },
        { role: 'user', content: PATHOLOGY_PAGE_TASK, images: [image] }
      ],
      numPredict: PATHOLOGY_PAGE_NUM_PREDICT,
      timeoutMs: TRANSCRIBE_TIMEOUT_MS,
      signal: deps.signal
    });
    if (!answer.ok) return { ok: false, error: answer.error };
    const raw = Array.isArray(answer.value.lines) ? answer.value.lines : [];
    const lines = raw.filter((line): line is string => typeof line === 'string')
      .map(line => line.replace(/\s+/g, ' ').trim())
      .filter(line => line !== '')
      .slice(0, 400);
    return { ok: true, lines };
  } catch (e) {
    return { ok: false, error: `The page could not be read: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Two lines are the same when their words are, without regard to case or to the width of a gap. */
export function sameLine(a: string, b: string): boolean {
  const tidy = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();
  return tidy(a) === tidy(b);
}

/**
 * The lines both readings of a page hold, in the order of the first reading, and the lines of the first
 * reading that the second does not hold. A line that stands in only one reading is never used.
 */
export function agreedLines(first: string[], second: string[]): { agreed: string[]; onlyInOne: string[] } {
  const left = second.slice();
  const agreed: string[] = []; const onlyInOne: string[] = [];
  for (const line of first) {
    const at = left.findIndex(other => sameLine(line, other));
    if (at >= 0) { agreed.push(line); left.splice(at, 1); } else onlyInOne.push(line);
  }
  return { agreed, onlyInOne: [...onlyInOne, ...left] };
}
