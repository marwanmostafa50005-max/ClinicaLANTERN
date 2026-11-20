import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import type { PanelName } from '../lib/events.ts';
import { FICTIONAL_LINE } from '../lib/letters.ts';
import { BackIcon } from './glyphs.tsx';

interface PanelProps {
  name: PanelName;
  title: string;
  icon: ReactNode;
  /**
   * Said in the head of the panel when the page does not show a live run: "Sample data. ..." or
   * "Recorded run ...". The panel covers the first screen, so the note is repeated here.
   */
  note?: string;
  /** The words of the button that leaves the panel. A page that opens over another one says where it goes back to. */
  closeLabel?: string;
  /** True while another panel lies over this one. Nothing in it can then be reached. */
  covered?: boolean;
  /** Called when the pharmacist asks to go back to the main page. */
  onClose(): void;
  children: ReactNode;
}

/** True when this key press should take the pharmacist back to the main page. */
export function closesThePanel(event: { key: string; defaultPrevented: boolean }): boolean {
  return event.key === 'Escape' && !event.defaultPrevented;
}

/**
 * True for the panel on top: the last one in the page. When a second panel lies over the first
 * (the preview of a letter over the letters), a key press belongs to the one on top only.
 */
export function isTopPanel<T>(panel: T | null, all: ArrayLike<T>): boolean {
  return panel !== null && all.length > 0 && all[all.length - 1] === panel;
}

/** What Tab can reach, in the order of the page. Controls that are switched off or not shown are left out. */
const CAN_TAKE_FOCUS = 'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

function tabStops(inside: Element | null): HTMLElement[] {
  if (!inside) return [];
  return [...inside.querySelectorAll<HTMLElement>(CAN_TAKE_FOCUS)].filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true' && el.getClientRects().length > 0,
  );
}

/**
 * A panel that opens over the page so the working part fills the screen.
 * The page behind it is switched off while the panel is open (see App), the Escape key goes back,
 * Tab stays inside it, and the keyboard focus returns to where it was.
 */
export function Panel({ name, title, icon, note, closeLabel = 'Back to the main page', covered = false, onClose, children }: PanelProps) {
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : null;
    root.current?.focus();
    return () => {
      // After the page behind is switched on again, the focus goes back to where it was,
      // or to the round icon of this panel.
      window.setTimeout(() => {
        const target =
          opener && opener.isConnected ? opener : document.querySelector<HTMLElement>(`.orb-wrap--${name} .orb`);
        target?.focus();
      }, 0);
    };
  }, [name]);

  // Escape is heard on the whole page while a panel is open, not only inside the panel. When a
  // control that had the focus is taken away (a small form closes, a button goes), the focus falls
  // to the page body, and Escape must still work. A form inside the panel that handles Escape itself
  // stops the key before it gets here.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!closesThePanel(event)) return;
      if (!isTopPanel<Element>(root.current, document.querySelectorAll('.panel'))) return;
      event.stopPropagation();
      close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // If the focus has fallen out of the panel, it is taken back, so the next Tab starts inside it.
  useEffect(() => {
    const onFocusOut = () => {
      window.setTimeout(() => {
        const panel = root.current;
        if (!panel || !isTopPanel<Element>(panel, document.querySelectorAll('.panel'))) return;
        if (document.activeElement === document.body || document.activeElement === null) panel.focus();
      }, 0);
    };
    const panel = root.current;
    panel?.addEventListener('focusout', onFocusOut);
    return () => panel?.removeEventListener('focusout', onFocusOut);
  }, []);

  // Tab stays with the panel while it is open: after its last control comes its first one again.
  // The small pop-up messages lie over the panel, so their buttons are part of the round.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const panel = root.current;
      if (!panel || !isTopPanel<Element>(panel, document.querySelectorAll('.panel'))) return;
      const messages = document.querySelector('.popups');
      const stops = [...tabStops(panel), ...tabStops(messages)];
      const at = document.activeElement;
      if (stops.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (at === null || !(panel.contains(at) || (messages !== null && messages.contains(at)))) {
        // The focus was outside, on the page body: Tab brings it back.
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (at === first || at === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && at === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      ref={root}
      className={`panel panel--${name}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      inert={covered}
    >
      <header className="panel-head">
        <span className="panel-icon" aria-hidden="true">
          {icon}
        </span>
        <h2 id={titleId} className="panel-title">
          {title}
        </h2>
        {note ? (
          <span className="stage-note panel-note" role="note">
            {note}
          </span>
        ) : null}
        <span className="fictional-tag panel-fictional">{FICTIONAL_LINE}</span>
        <button type="button" className="btn btn-quiet panel-close" onClick={onClose}>
          <BackIcon />
          <span>{closeLabel}</span>
        </button>
      </header>
      <div className="panel-body">{children}</div>
    </div>
  );
}
