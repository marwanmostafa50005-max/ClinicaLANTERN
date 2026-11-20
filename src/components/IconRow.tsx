import { useState } from 'react';
import type { ReactNode } from 'react';
import type { PanelName } from '../lib/events.ts';
import { bellBadgeAriaLabel } from '../lib/findings.ts';
import { badgeText, plural } from '../lib/format.ts';
import { disputedCountLabel } from '../lib/statusLine.ts';
import { BellGlyph, LetterGlyph, MagnifierGlyph } from './glyphs.tsx';
import { ModelBar } from './ModelBar.tsx';

interface IconRowProps {
  /** Scans whose rows wait for the pharmacist's check. */
  scansToCheck: number;
  /** Histories whose screening ended without a result for every criterion. */
  notFullyScreened: number;
  /** Confirmed findings waiting for accept or bypass. */
  bellBadge: number;
  /** Disputed findings waiting for a pharmacist decision. */
  disputedCount: number;
  /** Ready letters not yet seen. */
  letterBadge: number;
  /** True while a file is being dragged over the page. */
  dragging: boolean;
  /** In replay mode the magnifying glass opens the recorded-case picker, not a drop zone. */
  replay?: boolean;
  onOpen(panel: PanelName): void;
}

interface OrbProps {
  kind: PanelName;
  caption: string;
  label: string;
  badge: number;
  badgeLabel: string;
  /** The grey count: findings on which the two models disagree. Only the bell has one. */
  disputed?: number;
  disputedLabel?: string;
  glyph: ReactNode;
  onOpen(panel: PanelName): void;
}

function Orb({ kind, caption, label, badge, badgeLabel, disputed = 0, disputedLabel = '', glyph, onOpen }: OrbProps) {
  const badgeId = `orb-badge-${kind}`;
  const disputedId = `orb-disputed-${kind}`;
  // A badge pops only when its number changes while the page is open, not when the page loads.
  const [lastBadge, setLastBadge] = useState(badge);
  const [pops, setPops] = useState(false);
  if (lastBadge !== badge) {
    setLastBadge(badge);
    setPops(true);
  }
  return (
    <div className={`orb-wrap orb-wrap--${kind}`}>
      <button
        type="button"
        className="orb"
        aria-label={label}
        aria-describedby={[badge > 0 ? badgeId : '', disputed > 0 ? disputedId : ''].filter(Boolean).join(' ') || undefined}
        aria-haspopup="dialog"
        onClick={() => onOpen(kind)}
      >
        <span className="orb-disc">{glyph}</span>
        <span className="orb-caption">{caption}</span>
      </button>
      {/* The number badge, as on a social media notification. It is announced when it changes.
          The grey count sits to the left of the red badge and takes its place when there is none. */}
      <span className="orb-badge-slot" role="status">
        {disputed > 0 ? (
          <span id={disputedId} className="orb-disputed" aria-label={disputedLabel}>
            {badgeText(disputed)}
          </span>
        ) : null}
        {badge > 0 ? (
          <span
            key={badge}
            id={badgeId}
            className={pops ? 'orb-badge orb-badge--pop' : 'orb-badge'}
            aria-label={badgeLabel}
          >
            {badgeText(badge)}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** The three large round icons, in one row: magnifying glass, bell, letter. */
export function IconRow({
  scansToCheck,
  notFullyScreened,
  bellBadge,
  disputedCount,
  letterBadge,
  dragging,
  replay = false,
  onOpen,
}: IconRowProps) {
  // The number on the magnifying glass: histories that need the pharmacist before they can be relied on.
  const importBadge = scansToCheck + notFullyScreened;
  const importWords = [
    scansToCheck > 0 ? `${plural(scansToCheck, 'scan', 'scans')} waiting for you to check the rows` : '',
    notFullyScreened > 0 ? `${plural(notFullyScreened, 'history', 'histories')} not fully screened` : '',
  ].filter(Boolean).join(', ');
  return (
    <div className="icon-block">
    <div className={`orbs${dragging ? ' orbs--dragging' : ''}`} role="group" aria-label="Import, findings and letters">
      <Orb
        kind="import"
        // While a file is dragged over the page, the words under the magnifying glass ask for it.
        // In a recorded run nothing is imported: the magnifying glass opens the list of recorded cases.
        caption={replay ? 'Pick a recorded case' : dragging ? 'Drop the file here' : 'Import a history'}
        label={
          replay
            ? 'Pick a recorded case. Choose a recorded run to play step by step.'
            : 'Import a history. Import a dispensing history, CSV or PDF, by click or by drop.'
        }
        badge={importBadge}
        badgeLabel={importWords}
        glyph={<MagnifierGlyph className="orb-glyph" />}
        onOpen={onOpen}
      />
      <Orb
        kind="bell"
        caption="Findings"
        label="Findings. Confirmed findings waiting for the pharmacist."
        badge={bellBadge}
        badgeLabel={bellBadgeAriaLabel(bellBadge)}
        disputed={disputedCount}
        disputedLabel={disputedCountLabel(disputedCount)}
        glyph={<BellGlyph className="orb-glyph" />}
        onOpen={onOpen}
      />
      <Orb
        kind="letter"
        caption="Letters"
        label="Letters. Letters to the doctor and their status."
        badge={letterBadge}
        badgeLabel={`${plural(letterBadge, 'new letter', 'new letters')} ready to review`}
        glyph={<LetterGlyph className="orb-glyph" />}
        onOpen={onOpen}
      />
    </div>
    <ModelBar />
    </div>
  );
}
