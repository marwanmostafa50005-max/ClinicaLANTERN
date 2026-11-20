import { useEffect, useId, useState } from 'react';
import type { NeededFact } from '../../shared/types.ts';
import { api } from '../api.ts';
import type { CriterionView } from '../lib/criteria.ts';
import { countSigned, filterCriteriaList, groupCriteriaBySource } from '../lib/criteriaList.ts';
import { formatShortDate } from '../lib/format.ts';
import { MagnifierGlyph } from './glyphs.tsx';
import { Panel } from './Panel.tsx';

interface CriteriaPanelProps {
  pageNote?: string;
  onClose(): void;
}

function factsWords(facts: NeededFact[]): string {
  return facts
    .map((f) => {
      const kind = f.kind === 'condition' ? 'Condition' : f.kind === 'result' ? 'Result' : 'Observation';
      const meets = f.meets.trim() !== '' ? ` Meets when: ${f.meets.trim()}` : '';
      return `${kind}: ${f.what.trim()}${meets}`;
    })
    .join(' ');
}

/** Words at the top of the criteria panel. */
export function criteriaCountsLine(total: number, signed: number): string {
  // Every case says only what is true: no criterion, none signed, all signed, or some of each.
  const noun = total === 1 ? 'criterion' : 'criteria';
  const drafts = Math.max(0, total - signed);
  if (total === 0) return 'No criterion is in use.';
  if (signed === 0) return `${total} ${noun} in use. None is signed by the clinical reviewer yet: ${total === 1 ? 'it is a draft' : 'all are drafts'}.`;
  if (drafts === 0) return `${total} ${noun} in use. ${total === 1 ? 'It is' : 'All are'} signed by the clinical reviewer.`;
  const draftTail = drafts === 1 ? 'The other is a draft.' : 'The others are drafts.';
  return `${total} ${noun} in use. ${signed} signed by the clinical reviewer. ${draftTail}`;
}

export function CriterionDetail({ criterion }: { criterion: CriterionView }) {
  const signed = criterion.signedBy;
  return (
    <div className="criteria-detail">
      <blockquote className="criterion-text">{criterion.statement}</blockquote>
      {criterion.credit ? <p className="credit">{criterion.credit}</p> : null}
      {criterion.modificationNotice ? <p className="credit">{criterion.modificationNotice}</p> : null}
      {criterion.cannotBeSeen ? (
        <p className="credit">
          <strong>What a dispensing history cannot show:</strong> {criterion.cannotBeSeen}
        </p>
      ) : null}
      {criterion.needsFacts && criterion.needsFacts.length > 0 ? (
        <p className="credit">
          <strong>Facts it needs:</strong> {factsWords(criterion.needsFacts)}
        </p>
      ) : null}
      {criterion.rule ? (
        <p className="credit">
          <strong>What the models were asked to look for:</strong> {criterion.rule}
        </p>
      ) : null}
      {criterion.urgency === 'same_day' ? (
        <p className="credit">
          <strong>Same day</strong>
        </p>
      ) : null}
      <p className="credit credit--small">
        {signed
          ? `Signed by ${signed.name} on ${formatShortDate(signed.date) || signed.date}`
          : 'Draft criterion. Not yet signed by the clinical reviewer.'}
      </p>
    </div>
  );
}

function CriterionRow({ criterion }: { criterion: CriterionView }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="criteria-row"
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="criteria-summary">
        <span className="criteria-label">{criterion.label}</span>
        {criterion.title ? <span className="criteria-title">{criterion.title}</span> : null}
      </summary>
      {open ? <CriterionDetail criterion={criterion} /> : null}
    </details>
  );
}

/** Read-only list of every criterion in use. */
export function CriteriaPanel({ pageNote, onClose }: CriteriaPanelProps) {
  const searchId = useId();
  const [list, setList] = useState<CriterionView[]>([]);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let alive = true;
    const peek = api.peekCriteria?.();
    if (peek) {
      setList(peek);
      setReady(true);
      return;
    }
    api
      .getCriteria()
      .then((criteria) => {
        if (!alive) return;
        setList(criteria);
        setReady(true);
      })
      .catch(() => {
        if (alive) {
          setFailed(true);
          setReady(true);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = filterCriteriaList(list, filter);
  const groups = groupCriteriaBySource(filtered);
  const signed = countSigned(list);
  const filtering = filter.trim() !== '';

  return (
    <Panel
      name="import"
      title="The criteria in use"
      icon={<MagnifierGlyph />}
      note={pageNote}
      onClose={onClose}
    >
      <div className="panel-inner criteria-panel">
        {!ready ? (
          <p className="panel-lede" role="status">
            Loading the criteria.
          </p>
        ) : failed && list.length === 0 ? (
          <p className="note note--warn" role="alert">
            The local server is not answering.
          </p>
        ) : (
          <>
            <p className="panel-lede" role="status">
              {criteriaCountsLine(list.length, signed)}
            </p>
            <div className="bypass-form">
              <label htmlFor={searchId}>Search the criteria</label>
              <input
                id={searchId}
                type="search"
                value={filter}
                autoComplete="off"
                spellCheck={false}
                placeholder="Label, title, words or source"
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            {filtering && filtered.length === 0 ? (
              <p className="credit" role="status">
                No criterion matches.
              </p>
            ) : null}
            {groups.map((group) => (
              <section key={group.source} className="criteria-group">
                <h3 className="section-title">
                  {group.source} ({group.count})
                </h3>
                <ul className="criteria-list">
                  {group.criteria.map((criterion) => (
                    <li key={criterion.id}>
                      <CriterionRow criterion={criterion} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </Panel>
  );
}