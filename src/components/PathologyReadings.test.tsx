import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { errorText } from '../api.ts';
import { ApiError } from '../apiError.ts';
import {
  CHECK_THE_REPORT,
  NO_UPPER_LIMIT,
  afterReadRefusal,
  answerFromReading,
  pathologyDate,
  typeItMyself,
  upperLimitBlock,
  type ReadReading,
} from '../lib/pathologyAnswer.ts';
import { PathologyFileError } from '../lib/pathologyFile.ts';
import { PathologyNothingRead, PathologyReadings, TypedResultForm } from './PathologyUpload.tsx';

function reading(over: Partial<ReadReading> = {}): ReadReading {
  return {
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
    ...over,
  };
}

const FILE = 'fictional-report.pdf';

function block(readings: ReadReading[], extra: { dateNote?: string; dates?: Record<number, string>; collectedDate?: string; fact?: string; draft?: string } = {}): string {
  return renderToStaticMarkup(
    <PathologyReadings
      fact={extra.fact ?? 'Serum sodium'}
      readings={readings}
      collectedDate={extra.collectedDate}
      dateNote={extra.dateNote}
      idPrefix="Q0009-read"
      dates={extra.dates ?? {}}
      disabled={false}
      typingForm={
        <TypedResultForm
          id="Q0009"
          draft={{ value: extra.draft ?? '131', unit: 'mmol/L', date: '2026-03-01' }}
          disabled={false}
          saving={false}
          saveWords="Save this answer"
          onValue={() => undefined}
          onUnit={() => undefined}
          onDate={() => undefined}
          onSave={() => undefined}
        />
      }
      onDate={() => undefined}
      onUse={() => undefined}
      onTypeMyself={() => undefined}
    />,
  );
}

describe('what was read', () => {
  it('shows a sure reading, and the date as a local calendar day', () => {
    expect(pathologyDate('2026-03-12')).toBe('12 March 2026');
    const markup = block([reading()]);
    expect(markup).toContain(CHECK_THE_REPORT);
    expect(markup).toContain('Sodium 128 mmol/L');
    expect(markup).toContain('Laboratory range 135 to 145');
    expect(markup).toContain('Sample collected 12 March 2026');
    expect(markup).toContain('Line of the report (page 1): &quot;Sodium 128 mmol/L (135-145) L&quot;');
    expect(markup).toContain('Read by: the text of the document');
    expect(markup).toContain('USE THIS RESULT');
    expect(markup).toContain('TYPE IT MYSELF');
    expect(markup).not.toContain('note--warn');
    expect(markup).not.toContain('0.9 times the laboratory upper limit');
    expect(markup).toContain('<button type="button" class="btn btn-path-use">USE THIS RESULT</button>');
    expect(markup).not.toContain('class="bypass-form"');
  });

  it('shows why a reading is not sure, in the existing warning', () => {
    const why = 'The unit on this line is not the unit this test uses.';
    const markup = block([reading({ sure: false, why })]);
    expect(markup).toContain(`<p class="note note--warn" role="status">${why}</p>`);
  });

  it('asks for the date before USE THIS RESULT can be used, and keeps a date the pharmacist filled', () => {
    const note = 'The report gives two collection dates. Type the date of this result.';
    const empty = block([reading({ date: undefined })], { dateNote: note });
    expect(empty).toContain(note);
    expect(empty).toContain('id="Q0009-read-0-date"');
    expect(empty).toContain('placeholder="2026-11-19"');
    expect(empty).toContain('<button type="button" class="btn btn-path-use" disabled="">USE THIS RESULT</button>');
    expect(empty).not.toContain('Sample collected');

    const filled = block([reading({ date: undefined })], { dates: { 0: '2026-04-01' } });
    expect(filled).toContain('value="2026-04-01"');
    expect(filled).toContain('<button type="button" class="btn btn-path-use">USE THIS RESULT</button>');
  });

  it('sends the ordinary value and unit, including the laboratory range', () => {
    expect(answerFromReading('Serum sodium', FILE, reading(), '2026-03-12')).toEqual({
      value: '128',
      unit: 'mmol/L (laboratory range 135 to 145)',
      date: '2026-03-12',
      source: {
        kind: 'pathology',
        fileName: FILE,
        page: 1,
        line: 'Sodium 128 mmol/L (135-145) L',
        readBy: 'text',
      },
    });
    const upperOnly = reading({ refLow: undefined, refHigh: 145 });
    expect(answerFromReading('Serum sodium', FILE, upperOnly, '2026-03-12').unit).toBe('mmol/L (laboratory upper limit 145)');
    const lowerOnly = reading({ refLow: 135, refHigh: undefined });
    expect(answerFromReading('Serum sodium', FILE, lowerOnly, '2026-03-12').unit).toBe('mmol/L (laboratory lower limit 135)');
  });

  it('sends the multiple of the laboratory upper limit in the value, and refuses a line with no upper limit', () => {
    const fact = 'ALT or AST as a multiple of its laboratory upper limit';
    const alt = reading({
      analyte: 'alt',
      name: 'ALT',
      value: 96,
      valueWords: '96',
      unit: 'U/L',
      refLow: undefined,
      refHigh: 40,
      multipleOfUpper: 2.4,
      flag: 'H',
      line: 'ALT 96 U/L (<40) H',
      sure: true,
      readBy: 'model',
    });
    expect(upperLimitBlock(fact, alt)).toBeNull();
    const answer = answerFromReading(fact, FILE, alt, '2026-03-12');
    expect(answer).toEqual({
      value: '2.4',
      unit: 'times the laboratory upper limit (ALT 96 U/L, upper limit 40)',
      date: '2026-03-12',
      source: {
        kind: 'pathology',
        fileName: FILE,
        page: 1,
        line: 'ALT 96 U/L (<40) H',
        readBy: 'model',
      },
    });
    expect(Object.keys(answer).sort()).toEqual(['date', 'source', 'unit', 'value']);
    expect(Object.keys(answer.source).sort()).toEqual(['fileName', 'kind', 'line', 'page', 'readBy']);
    const shown = block([alt], { fact });
    expect(shown).toContain('ALT 96 U/L');
    expect(shown).toContain('2.4 times the laboratory upper limit');
    expect(shown).toContain('Read by: the reading model, twice, and both readings agreed');

    const noLimit = reading({ analyte: 'alt', name: 'ALT', refLow: undefined, refHigh: undefined, multipleOfUpper: undefined, unit: 'U/L' });
    expect(upperLimitBlock(fact, noLimit)).toBe(NO_UPPER_LIMIT);
    const refused = block([noLimit], { fact, draft: '131' });
    expect(refused).toContain(NO_UPPER_LIMIT);
    expect(refused).toContain('value="131"');
    expect(refused).toContain('Save this answer');
    expect(refused).not.toContain('USE THIS RESULT');
  });

  it('returns to the typed form and keeps what was already typed', () => {
    const draft = { value: '131', unit: 'mmol/L', date: '2026-03-01' };
    const next = typeItMyself({ way: 'upload', draft, showingReading: true });
    expect(next.way).toBe('type');
    expect(next.showingReading).toBe(false);
    expect(next.draft).toBe(draft);
    const source = readFileSync(new URL('./BellPanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('api.answerQuestion(c.id, q.id, { value: box.value, unit: box.unit, date: box.date })');
    expect(source).toContain('const body = answerFromReading(q.what, got.fileName, reading, date)');
    expect(source).toContain('api.answerQuestion(c.id, q.id, body)');
    expect(source).toContain('{ fileName: body.fileName, response }');
    expect(source).not.toContain('pageImages: body');
    expect(source).not.toContain('pages: body');
    expect(source).toContain('const next = typeItMyself({ way: \'upload\', draft: box, showingReading: showRead });');
    expect(source).not.toContain('setDraft(next.draft)');
  });

  it('shows the note and every reason when nothing was read, with the typed form still filled', () => {
    const note = 'No Sodium result was found in this document. Type the result from the report.';
    const reasons = [
      'Page 1: the two readings of this line did not agree. Read the value from the report yourself.',
      'This page has no text that can be read by program, and the reading model is not available now. Type the result from the report.',
    ];
    const markup = renderToStaticMarkup(
      <PathologyNothingRead
        note={note}
        abstained={reasons}
        typingForm={
          <TypedResultForm
            id="Q0009"
            draft={{ value: '131', unit: 'mmol/L', date: '2026-03-01' }}
            disabled={false}
            saving={false}
            saveWords="Save this answer"
            onValue={() => undefined}
            onUnit={() => undefined}
            onDate={() => undefined}
            onSave={() => undefined}
          />
        }
      />,
    );
    expect(markup).toContain(note);
    for (const reason of reasons) expect(markup).toContain(reason);
    expect(markup).toContain('value="131"');
    expect(markup).toContain('class="bypass-form"');
    expect(markup).not.toContain('USE THIS RESULT');
  });

  it('shows each refusal in the words the server or the file gave, and the typed form is back', () => {
    const sentences = [
      'This question already has an answer. Take it back before reading a pathology test for it.',
      'This question is not answered from a pathology test. Type the answer.',
      'The pathology test is empty.',
      'A page picture of the pathology test is missing.',
      'The pathology test has more than 10 pages. Upload only the pages that hold the result.',
      'A page picture is not valid base64 image data. Upload the page again, or type the result yourself.',
      'The page numbers must give one whole number of at least 1 for each supplied page, in strictly rising order.',
      'Each text page must be an array of lines.',
      'Every line of a text page must be a string.',
      'A line on a text page is longer than 300 characters. Upload the page again, or type the result yourself.',
      'A text page has more than 400 lines. Upload only the page that holds the result.',
      'The value and unit cannot contain a line break, field mark or quote mark. Type the result again.',
      'This page has no text that can be read by program, and the reading model is busy with a history now. Upload the pathology test again when that has finished, or type the result from the report.',
    ];
    for (const sentence of sentences) expect(errorText(new ApiError(sentence, 400))).toBe(sentence);
    expect(new PathologyFileError('This file is empty.').message).toBe('This file is empty.');
    expect(new PathologyFileError('This file is larger than 40 MB. Use a smaller file.').message).toBe('This file is larger than 40 MB. Use a smaller file.');
    expect(new PathologyFileError('This kind of file cannot be read. Use a PDF or a picture (PNG or JPEG).').message)
      .toBe('This kind of file cannot be read. Use a PDF or a picture (PNG or JPEG).');
    expect(afterReadRefusal({ Q0009: 'upload' }, 'Q0009')).toEqual({ Q0009: 'type' });
    const source = readFileSync(new URL('./BellPanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('setWay((prev) => afterReadRefusal(prev, questionId))');
    expect(source).toContain('setError(e instanceof PathologyFileError ? e.message : errorText(e))');
    expect(source).toContain('className="note note--error"');
  });
});
