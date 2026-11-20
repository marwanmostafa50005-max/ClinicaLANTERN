// The upload way on a question that a pathology test can answer.
// The typing form is the form the card already had. The upload way, and only that way, carries
// the path-O-finder mark. Everything else stays in the LANTERN's own styles.
import type { ChangeEvent, ReactNode } from 'react';
// The mark for the LANTERN: the name and the glass of pathofinder_ui.svg without the line that file carries as an
// outline (it says "clinician"). The line is written below as text, with "pharmacist", as the founder ordered.
import markUrl from '../assets/path-o-finder/pathofinder_lantern.svg';
import {
  CHECK_THE_REPORT,
  collectedWords,
  readByWords,
  reportLineWords,
  upperLimitBlock,
  type ReadReading,
} from '../lib/pathologyAnswer.ts';
import { PATHOLOGY_READS, PATHOLOGY_SLOGAN, testsLine } from '../lib/pathologyFile.ts';

export interface TypedDraft {
  value: string;
  unit: string;
  date: string;
}

/** The typed result, in the markup the card has always used. */
export function TypedResultForm({
  id,
  draft,
  disabled,
  saving,
  saveWords,
  onValue,
  onUnit,
  onDate,
  onSave,
}: {
  id: string;
  draft: TypedDraft;
  disabled: boolean;
  saving: boolean;
  saveWords: string;
  onValue(value: string): void;
  onUnit(value: string): void;
  onDate(value: string): void;
  onSave(): void;
}) {
  return (
    <div className="bypass-form">
      <label htmlFor={`${id}-value`}>Value</label>
      <input id={`${id}-value`} type="text" value={draft.value} autoComplete="off" disabled={disabled} onChange={(e) => onValue(e.target.value)} />
      <label htmlFor={`${id}-unit`}>Unit</label>
      <input id={`${id}-unit`} type="text" value={draft.unit} autoComplete="off" disabled={disabled} onChange={(e) => onUnit(e.target.value)} />
      <label htmlFor={`${id}-date`}>Date</label>
      <input id={`${id}-date`} type="text" value={draft.date} autoComplete="off" placeholder="2026-11-19" disabled={disabled} onChange={(e) => onDate(e.target.value)} />
      <div className="btn-row">
        <button type="button" className="btn btn-primary" disabled={disabled} onClick={onSave}>
          {saveWords}
        </button>
      </div>
    </div>
  );
}

/** "Type the result" and "Upload the pathology test", in the existing button styles. */
export function PathologyWays({
  way,
  disabled,
  onType,
  onUpload,
}: {
  way: 'type' | 'upload';
  disabled: boolean;
  onType(): void;
  onUpload(): void;
}) {
  return (
    <div className="btn-row">
      <button type="button" className={way === 'type' ? 'btn btn-primary' : 'btn btn-quiet'} disabled={disabled} aria-pressed={way === 'type'} onClick={onType}>
        Type the result
      </button>
      <button type="button" className={way === 'upload' ? 'btn btn-primary' : 'btn btn-quiet'} disabled={disabled} aria-pressed={way === 'upload'} onClick={onUpload}>
        Upload the pathology test
      </button>
    </div>
  );
}

/** The mark and its line. Only the upload way and the block that shows what was read use it. */
export function PathOHead() {
  return (
    <div className="path-o-head">
      <img className="path-o-mark" src={markUrl} alt="path-O-finder" />
      <p className="path-o-line">{PATHOLOGY_SLOGAN}</p>
    </div>
  );
}

/** The upload way: the mark, its line, the tests this question can read, and the file picker. */
export function PathologyUploadPanel({
  tests,
  progress,
  disabled,
  inputId,
  onFile,
}: {
  tests: { key: string; name: string }[];
  /** "Reading page 1 of 2" while the file is read. Empty when it is not. */
  progress: string | null;
  disabled: boolean;
  inputId: string;
  onFile(file: File): void;
}) {
  const choose = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onFile(file);
  };
  return (
    <div className="path-o-finder">
      <PathOHead />
      <p className="path-o-line">{testsLine(tests)}</p>
      {progress ? (
        <p className="note note--busy" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>{progress}</span>
        </p>
      ) : null}
      <div className="file-field">
        <input
          id={inputId}
          type="file"
          className="file-input"
          accept=".pdf,.png,.jpg,.jpeg"
          disabled={disabled || progress !== null}
          onChange={choose}
        />
        <label htmlFor={inputId} className="btn btn-path-use file-label">
          Choose the pathology test
        </label>
      </div>
    </div>
  );
}

/** What was read, before anything is saved. One block for each reading. */
export function PathologyReadings({
  fact,
  readings,
  collectedDate,
  dateNote,
  note,
  abstained = [],
  idPrefix,
  dates,
  disabled,
  typingForm,
  onDate,
  onUse,
  onTypeMyself,
}: {
  fact: string;
  readings: ReadReading[];
  /** The collection date of the document, when the reading itself has none. */
  collectedDate?: string;
  dateNote?: string;
  /** A sentence from the server, for example when the reading model is not available. */
  note?: string;
  abstained?: string[];
  idPrefix: string;
  /** Dates the pharmacist typed, one per reading that had none. */
  dates: Record<number, string>;
  disabled: boolean;
  /** The typed form, shown when a reading cannot answer a multiple-of-upper-limit fact. */
  typingForm: ReactNode;
  onDate(index: number, value: string): void;
  onUse(reading: ReadReading, date: string): void;
  onTypeMyself(): void;
}) {
  return (
    <div className="path-o-finder">
      <PathOHead />
      <p className="path-o-line">{PATHOLOGY_READS}</p>
      <p className="path-o-warn">{CHECK_THE_REPORT}</p>
      {note ? <p className="path-o-warn" role="status">{note}</p> : null}
      {abstained.map((reason, index) => <p key={index} className="path-o-line">{reason}</p>)}
      {readings.map((reading, index) => {
        const known = (reading.date ?? '').trim() || (collectedDate ?? '').trim();
        const date = known || (dates[index] ?? '');
        const blocked = upperLimitBlock(fact, reading);
        const showMultiple = (reading.analyte === 'alt' || reading.analyte === 'ast') && reading.multipleOfUpper !== undefined;
        return (
          <div key={`${reading.analyte}-${reading.page}-${index}`}>
            <p className="path-o-line">{`${reading.name} ${reading.valueWords} ${reading.unit}`.trim()}</p>
            {reading.refLow !== undefined && reading.refHigh !== undefined ? (
              <p className="path-o-line">{`Laboratory range ${reading.refLow} to ${reading.refHigh}`}</p>
            ) : null}
            {showMultiple ? (
              <p className="path-o-line">{`${reading.multipleOfUpper} times the laboratory upper limit`}</p>
            ) : null}
            {known ? <p className="path-o-line">{collectedWords(known)}</p> : (
              <>
                {dateNote ? <p className="path-o-line">{dateNote}</p> : null}
                <div className="bypass-form">
                  <label htmlFor={`${idPrefix}-${index}-date`}>Date</label>
                  <input
                    id={`${idPrefix}-${index}-date`}
                    type="text"
                    value={dates[index] ?? ''}
                    autoComplete="off"
                    placeholder="2026-11-19"
                    disabled={disabled}
                    onChange={(event) => onDate(index, event.target.value)}
                  />
                </div>
              </>
            )}
            <p className="path-o-line">{reportLineWords(reading.page, reading.line)}</p>
            <p className="path-o-line">{readByWords(reading.readBy)}</p>
            {reading.sure ? null : <p className="note note--warn" role="status">{reading.why}</p>}
            {blocked ? (
              <>
                <p className="path-o-warn">{blocked}</p>
                {typingForm}
              </>
            ) : (
              <div className="btn-row">
                <button type="button" className="btn btn-path-use" disabled={disabled || date.trim() === ''} onClick={() => onUse(reading, date)}>
                  USE THIS RESULT
                </button>
                <button type="button" className="btn btn-path-type" disabled={disabled} onClick={onTypeMyself}>
                  TYPE IT MYSELF
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Nothing was read. The note, every reason, and the typed form. Never a dead end. */
export function PathologyNothingRead({
  note,
  abstained,
  typingForm,
}: {
  note?: string;
  abstained: string[];
  typingForm: ReactNode;
}) {
  return (
    <div className="path-o-finder">
      <PathOHead />
      {note ? <p className="path-o-warn" role="status">{note}</p> : null}
      {abstained.map((reason, index) => <p key={index} className="path-o-line">{reason}</p>)}
      {typingForm}
    </div>
  );
}
