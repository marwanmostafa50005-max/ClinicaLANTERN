import type { Counts } from '../../shared/types.ts';

interface CountsLineProps {
  counts: Counts | null;
}

interface CountItem {
  key: string;
  /** The words for one and for any other number: "1 letter closed", "2 letters closed". */
  one: string;
  many: string;
  value: number | null;
  alarm?: boolean;
}

/** The line of counts, in the order docs/SPEC.md section 8 gives. Each count says what it counts. */
export function CountsLine({ counts }: CountsLineProps) {
  const items: CountItem[] = [
    { key: 'screened', one: 'history screened', many: 'histories screened', value: counts?.historiesScreened ?? null },
    { key: 'confirmed', one: 'finding confirmed', many: 'findings confirmed', value: counts?.findingsConfirmed ?? null },
    { key: 'accepted', one: 'accepted', many: 'accepted', value: counts?.accepted ?? null },
    { key: 'bypassed', one: 'bypassed', many: 'bypassed', value: counts?.bypassed ?? null },
    { key: 'sent', one: 'letter sent', many: 'letters sent', value: counts?.lettersSent ?? null },
    { key: 'replies', one: 'reply recorded', many: 'replies recorded', value: counts?.repliesRecorded ?? null },
    { key: 'closed', one: 'letter closed', many: 'letters closed', value: counts?.closed ?? null },
    { key: 'overdue', one: 'letter overdue', many: 'letters overdue', value: counts?.overdue ?? null, alarm: (counts?.overdue ?? 0) > 0 },
  ];

  return (
    <ul className="counts" aria-label="Counts so far">
      {items.map((item) => (
        <li key={item.key} className={`count${item.alarm ? ' count--alarm' : ''}`}>
          {item.value === null ? (
            <span className="count-value" aria-label="not known yet">
              ...
            </span>
          ) : (
            <span className="count-value">{item.value}</span>
          )}{' '}
          <span className="count-label">{item.value === 1 ? item.one : item.many}</span>
        </li>
      ))}
    </ul>
  );
}
