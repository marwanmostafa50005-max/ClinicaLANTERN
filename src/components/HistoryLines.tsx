import { Fragment } from 'react';
import { FACT_WORDS, factLineKind } from '../../shared/facts.ts';
import type { HistoryLine } from '../../shared/types.ts';
import { FACT_KIND_WORDS } from '../lib/facts.ts';
import { JOB_NAMES, type DisplayNames } from '../lib/modelNames.ts';

interface HistoryLinesProps {
  lines: HistoryLine[];
  /** Line IDs to highlight. */
  hits?: ReadonlySet<string>;
  /** Highlighted lines that only the first model named. They are marked as such. */
  fromFirstModel?: ReadonlySet<string>;
  /** Show only the highlighted lines. */
  onlyHits?: boolean;
  /** A name for the list, read by screen readers. */
  label: string;
  /** Display names. Mantle when the caller has no health response. */
  names?: DisplayNames;
}

/**
 * The lines of a record with their IDs. Matching lines are highlighted and also marked in words.
 * A line that is a fact and not a supply (a condition, a result or an observation, docs/SPEC.md
 * section 6a) keeps its kind in view as a small mark, so it is not read as a medicine.
 */
export function HistoryLines({ lines, hits, fromFirstModel, onlyHits = false, label, names = JOB_NAMES }: HistoryLinesProps) {
  const shown = onlyHits && hits ? lines.filter((line) => hits.has(line.id)) : lines;
  return (
    <ol className="lines" aria-label={label}>
      {shown.map((line) => {
        const hit = hits?.has(line.id) ?? false;
        const firstOnly = hit && (fromFirstModel?.has(line.id) ?? false);
        // The text is shown as it is. The first part (the date, in a CSV import) is set in bold.
        const cells = line.text.split(' | ');
        // A fact line reads "2026-08-03 | RESULT | eGFR 28 mL/min/1.73 m2": its second part is the kind.
        const kind = factLineKind(line.text);
        const kindAt = kind !== null && cells.length > 1 && cells[1].trim() === FACT_WORDS[kind] ? 1 : -1;
        const classes = ['line'];
        if (hit) classes.push('line--hit');
        if (firstOnly) classes.push('line--first-model');
        if (kind !== null) classes.push('line--fact');
        return (
          <li key={line.id} className={classes.join(' ')}>
            <span className="line-id">{line.id}</span>
            <span className="line-text">
              {hit ? <span className="sr-only">Line a model pointed to: </span> : null}
              {cells.map((cell, i) => (
                <Fragment key={i}>
                  {i > 0 ? <span className="cell-sep"> | </span> : null}
                  {i === kindAt && kind !== null ? (
                    <span className="cell cell--kind" title={FACT_KIND_WORDS[kind]}>
                      {cell}
                    </span>
                  ) : (
                    <span className={i === 0 && cells.length > 1 ? 'cell cell--first' : 'cell'}>{cell}</span>
                  )}
                </Fragment>
              ))}
              {firstOnly ? <span className="line-who">{` Named by ${names.screen} only`}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
