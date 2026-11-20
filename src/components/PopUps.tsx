import { popUpWords } from '../lib/events.ts';
import type { PanelName } from '../lib/events.ts';
import type { ShownPopUp } from '../lib/useLantern.ts';
import { BellGlyph, CloseIcon, LetterGlyph, MagnifierGlyph } from './glyphs.tsx';

interface PopUpsProps {
  popUps: ShownPopUp[];
  /** The panel that is open now, so a pop-up does not offer to open it again. */
  openPanel: PanelName | null;
  onOpen(panel: PanelName): void;
  onDismiss(id: number): void;
}

const GLYPH = {
  import: MagnifierGlyph,
  bell: BellGlyph,
  letter: LetterGlyph,
} as const;

/** Small in-page pop-up messages. They are part of the page; the operating system is not asked to notify. */
export function PopUps({ popUps, openPanel, onOpen, onDismiss }: PopUpsProps) {
  // A pop-up about the panel that is open is not shown: it would cover the top of that panel.
  const shown = popUps.filter((p) => p.panel !== openPanel).slice(0, 4);
  return (
    <div className="popups" role="region" aria-live="polite" aria-label="Messages">
      {shown.map((p) => {
        const Glyph = GLYPH[p.panel];
        const words = popUpWords(p.kind, p.count);
        const warns = p.kind === 'cannot_assess' || p.kind === 'not_fully_screened' || p.kind === 'unchecked';
        return (
          <div key={p.id} className={`popup popup--${p.panel}${warns ? ' popup--warn' : ''}`} role="status">
            <Glyph className="popup-glyph" />
            <p className="popup-text">{words.text}</p>
            <button
              type="button"
              className="btn btn-small btn-primary"
              onClick={() => {
                onDismiss(p.id);
                onOpen(p.panel);
              }}
            >
              {words.action}
            </button>
            <button type="button" className="icon-btn" aria-label="Close this message" onClick={() => onDismiss(p.id)}>
              <CloseIcon />
            </button>
          </div>
        );
      })}
    </div>
  );
}
