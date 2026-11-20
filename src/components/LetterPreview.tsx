import { useEffect, useId, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import type { EmailDraft, Letter } from '../../shared/types.ts';
import { api, errorText, isMock, isReplay, isReplayMock, pageView } from '../api.ts';
import {
  SIGN_OFF,
  closingParts,
  editableBody,
  mailtoHref,
  openEmail,
  outboundStepsOpen,
  printedLetter,
  whyNoOutbound,
  whyNoSent,
} from '../lib/letters.ts';
import type { LetterClosingParts, LetterView } from '../lib/letters.ts';
import type { PageView } from '../lib/pageView.ts';
import { RECORDED_BUTTONS_OFF } from '../lib/replayBackend.ts';
import { Panel } from './Panel.tsx';
import { AlertIcon, CheckIcon, CopyIcon, LetterGlyph, MailIcon, PrintIcon } from './glyphs.tsx';

/** Puts a text on the clipboard. False when the browser does not allow it. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older way, for a browser that does not allow the newer one here.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/**
 * The last lines of a letter: "Yours sincerely,", the line about who wrote the words, and the
 * signature. They come from the server with the letter and are not part of the text the pharmacist
 * edits. The name is drawn in a handwriting font; the title and the number are in the letter's font.
 */
export function LetterClosing({ closing, fixed = false }: { closing: LetterClosingParts; fixed?: boolean }) {
  return (
    <div className={fixed ? 'closing closing--fixed' : 'closing'}>
      <p className="closing-sign-off">{SIGN_OFF}</p>
      {closing.closingLine ? <p>{closing.closingLine}</p> : null}
      <p className="closing-name">{closing.signatureName}</p>
      {closing.signatureTitle ? <p>{closing.signatureTitle}</p> : null}
      {closing.signatureRegistration ? <p>{closing.signatureRegistration}</p> : null}
    </div>
  );
}

/** The heading of the preview page, said as it is true for this letter. */
export function previewTitle(letter: Pick<Letter, 'status' | 'sentAt'>): string {
  if (letter.status === 'ready') return 'Letter as it will leave';
  return letter.sentAt ? 'Letter as it was sent' : 'Letter that was not sent';
}

/**
 * The line above the letter on the preview page: what is shown, said as it is true in this view.
 * In a recorded run the letter cannot be changed anywhere, so the line does not send the reader
 * back to the letter to change it.
 */
export function previewLeadWords(ready: boolean, wasSent: boolean, view: PageView): string {
  if (!ready) {
    return wasSent
      ? 'This is the whole letter, as it was sent. Nothing here can be changed.'
      : 'This is the whole letter. It was not sent. Nothing here can be changed.';
  }
  if (view === 'recorded') return 'This is the whole letter, as it was recorded. Nothing here can be changed.';
  if (view === 'made_up_recording') return 'This is the whole letter, as the sample data holds it. Nothing here can be changed.';
  return 'This is the whole letter, exactly as it will leave. Nothing here can be changed. To change it, go back to the letter.';
}

interface LetterPreviewProps {
  /** The letter as the state holds it now. */
  letter: Letter;
  view: LetterView;
  subject: string;
  /** The whole letter exactly as it leaves, its last lines included. */
  text: string;
  /** The draft for the pharmacist's own email program: the letter when it fits, or else a short note. */
  emailDraft: EmailDraft;
  /** The token for this preview. The server accepts a send only when this is the latest preview. */
  previewToken?: string;
  /** The note of the page when it does not show a live run (sample data, or a recorded run). */
  pageNote?: string;
  /** True on a screen wide enough for the list and the letter side by side. */
  wide: boolean;
  /** Set to true just before the email program is opened from code, so the "leave this page?" question is not raised. */
  leavingForEmail: MutableRefObject<boolean>;
  refresh(): Promise<void>;
  onBack(): void;
  /** Called after the letter was marked as sent. */
  onSent(): void;
}

/**
 * The preview of a letter: one fixed page that shows the whole letter exactly as it leaves.
 * Print, "Open in my email program", Copy and "Mark as sent" stand here and nowhere else, so no
 * letter leaves without having been shown. Nothing on this page can be changed.
 */
export function LetterPreview({ letter, view, subject, text, emailDraft, previewToken, pageNote, wide, leavingForEmail, refresh, onBack, onSent }: LetterPreviewProps) {
  const [busy, setBusy] = useState<'sent' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const stepId = useId();

  const ready = view === 'ready';
  const agreed = letter.patientAgreed !== undefined;
  // The last lines are drawn apart from the text, so the name can be set in handwriting.
  const closing = closingParts(letter);
  const body = editableBody(text, closing);
  const hasClosing = body !== text;
  // The server marks the letter as sent only when this exact text was previewed.
  const canSend = ready && !isReplay && outboundStepsOpen(letter, false);
  const whyNotSend = !ready ? whyNoSent(view) : isReplay ? RECORDED_BUTTONS_OFF : whyNoOutbound(letter, false);

  // The keyboard focus follows the small form: into the form when it opens, back to its button when it closes.
  const actions = useRef<HTMLElement>(null);
  const wasAsking = useRef(false);
  useEffect(() => {
    const box = actions.current;
    if (!box) return;
    if (asking) box.querySelector<HTMLElement>('.inline-form button')?.focus();
    else if (wasAsking.current) {
      const back =
        box.querySelector<HTMLElement>('[data-opens="sent"]:not(:disabled)') ??
        box.querySelector<HTMLElement>('.letter-buttons .btn:not(:disabled)');
      back?.focus();
    }
    wasAsking.current = asking;
  }, [asking]);

  const onPrint = () => {
    setError(null);
    setNotice(null);
    // The print style sheet shows only the letter, on A4.
    window.print();
  };

  const onCopy = async () => {
    setError(null);
    const ok = await copyText(text);
    setNotice(ok ? 'The letter was copied. You can paste it where you need it.' : null);
    if (!ok) setError('The letter could not be copied. Select the text and copy it by hand.');
  };

  const onEmail = async () => {
    // The email program is opened from here, so the browser never asks "leave this page?", and the
    // page never says that it opened when it did not. What was typed was saved before this page opened.
    setError(null);
    setNotice(null);
    const outcome = await openEmail({
      save: async () => true,
      copy: () => copyText(text),
      leaving: (on) => {
        leavingForEmail.current = on;
      },
      open: () => {
        window.location.href = mailtoHref(subject, emailDraft.text);
      },
    });
    window.setTimeout(() => {
      leavingForEmail.current = false;
    }, 1500);
    if (!emailDraft.coverNote) {
      setNotice('Your email program should open with the subject and the letter. Nothing is sent by this app.');
    } else {
      setNotice(
        outcome === 'opened_and_copied'
          ? 'Your email program should open with the subject and a short note. The letter was copied: paste it in place of the note. Nothing is sent by this app.'
          : 'Your email program should open with the subject and a short note. Use Copy, then paste the letter in place of the note. Nothing is sent by this app.',
      );
    }
  };

  const markSent = async (by: 'print' | 'email') => {
    setBusy('sent');
    setError(null);
    setNotice(null);
    try {
      await api.markLetterSent(letter.id, { by, previewToken });
      await refresh();
      setAsking(false);
      onSent();
    } catch (err) {
      // The server refuses when this exact text was not previewed. Its words are shown as they are.
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const step = isReplay
    ? RECORDED_BUTTONS_OFF
    : ready
      ? 'Next: print the letter or open it in your email program. Then mark it as sent.'
      : letter.sentAt
        ? 'This letter was sent. It can still be printed and copied.'
        : 'This letter was not sent. It can still be printed and copied.';

  // What the printer gets: only the letter, on A4. Hidden on the screen. It is there only while
  // this page is open, so the letter cannot be printed without having been shown.
  const printSheet = (
    <article className="print-sheet" aria-hidden="true">
      {isMock || isReplayMock ? <p className="print-mark">SAMPLE DATA. This letter was written by hand for a mock-up. No model wrote it.</p> : null}
      {isReplay && !isReplayMock ? <p className="print-mark">Recorded run from the entrant's computer. The live models are not connected.</p> : null}
      <pre className="print-letter">{printedLetter(body, letter.withdrawnNote)}</pre>
      {hasClosing ? <LetterClosing closing={closing} /> : null}
    </article>
  );

  return (
    <Panel name="letter" title={previewTitle(letter)} icon={<LetterGlyph />} note={pageNote} closeLabel="Back to the letter" onClose={onBack}>
      <div className={`letters letters--one${wide ? ' letters--wide' : ''}`}>
        <div className="letter-pane">
          <section className="letter-detail" aria-label="The letter as it leaves">
            <div className="letter-scroll">
              {letter.withdrawnNote ? (
                <p className="note note--warn">
                  <AlertIcon /> {letter.withdrawnNote}
                </p>
              ) : null}
              {/* The email draft holds the whole letter only when it fits. When it does not, this page says so. */}
              {emailDraft.coverNote && !isReplay ? (
                <p className="note note--warn">
                  <AlertIcon />
                  <span>
                    This letter is longer than an email draft can hold. "Open in my email program" opens a draft with
                    a short note only. Use Copy or Print for the letter itself.
                  </span>
                </p>
              ) : null}
              <p className="credit">{previewLeadWords(ready, Boolean(letter.sentAt), pageView)}</p>
              <article className="paper" aria-label="The letter">
                <p className="field-label">Subject (used for the email)</p>
                <p className="letter-for preview-subject">{subject}</p>
                <p className="field-label">The letter</p>
                <pre className="preview-text">{body}</pre>
                {hasClosing ? <LetterClosing closing={closing} /> : null}
              </article>
            </div>

            <footer
              className="letter-actions"
              ref={actions}
              onKeyDown={(e) => {
                // Escape closes the small form first, not the whole page.
                if (e.key === 'Escape' && asking && busy === null) {
                  e.stopPropagation();
                  setAsking(false);
                }
              }}
            >
              {error ? (
                <p className="note note--error" role="alert">
                  {error}
                </p>
              ) : null}
              {notice && !asking ? (
                <p className="note note--ok" role="status">
                  <CheckIcon /> {notice}
                </p>
              ) : null}

              {asking ? (
                <div className="inline-form" role="group" aria-label="How was the letter sent?">
                  <p className="inline-form-title">How was the letter sent?</p>
                  {!agreed ? (
                    <p className="note note--warn">
                      <AlertIcon /> The box "Discussed with the patient" is not ticked. The log will say that the
                      patient's agreement was not recorded.
                    </p>
                  ) : null}
                  <div className="btn-row">
                    <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void markSent('print')}>
                      On paper
                    </button>
                    <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void markSent('email')}>
                      By email
                    </button>
                    <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={() => setAsking(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="btn-row letter-buttons" aria-describedby={stepId}>
                  <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={onPrint}>
                    <PrintIcon /> Print
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet"
                    data-mailto={mailtoHref(subject, emailDraft.text)}
                    disabled={busy !== null || isReplay}
                    title={isReplay ? 'This is a recorded run. The email program is not opened from it.' : undefined}
                    onClick={() => void onEmail()}
                  >
                    <MailIcon /> Open in my email program
                  </button>
                  <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={() => void onCopy()}>
                    <CopyIcon /> Copy
                  </button>
                  <span className="btn-gap" aria-hidden="true" />
                  <button
                    type="button"
                    className={`btn ${ready ? 'btn-primary' : 'btn-quiet'}`}
                    disabled={!canSend || busy !== null}
                    title={canSend ? undefined : whyNotSend || undefined}
                    data-opens="sent"
                    onClick={() => {
                      setError(null);
                      setNotice(null);
                      setAsking(true);
                    }}
                  >
                    Mark as sent
                  </button>
                </div>
              )}
              {!asking ? (
                <p id={stepId} className="next-step">
                  {step}
                </p>
              ) : null}
            </footer>
          </section>
        </div>
      </div>

      {typeof document !== 'undefined' ? createPortal(printSheet, document.body) : null}
    </Panel>
  );
}
