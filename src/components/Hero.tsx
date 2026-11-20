import type { ReactNode } from 'react';
import { Mark } from '../brand/Mark.tsx';
import { Wordmark } from '../brand/Wordmark.tsx';
import { FICTIONAL_LINE } from '../lib/letters.ts';

interface HeroProps {
  /** A short, true line about what the page is showing, such as a recorded run. */
  note?: string;
  /** Shown at the foot of the band, under the slogan: the steps of a recorded run in the judges' view. */
  children?: ReactNode;
}

/** The top half of the first screen: the mark, the name with the golden L, the purpose line and the slogan. */
export function Hero({ note, children }: HeroProps) {
  return (
    <header className="hero">
      <div className="hero-strip">
        <div className="hero-strip-left">
          <span className="stage-tag">Prototype</span>
          {note ? (
            <span className="stage-note" role="note">
              {note}
            </span>
          ) : null}
        </div>
        <span className="fictional-tag">{FICTIONAL_LINE}</span>
      </div>
      <div className="hero-lockup">
        <Mark className="hero-mark" />
        <div className="hero-words">
          <Wordmark />
          <p className="purpose">A Pharmacist-in-the-loop Clinical Decision Support System</p>
          <p className="slogan">See what routine dispensing can miss.</p>
        </div>
      </div>
      {children}
    </header>
  );
}
