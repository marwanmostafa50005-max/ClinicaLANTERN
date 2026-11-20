import { describe, expect, it } from 'vitest';
import type { Letter } from '../../shared/types.ts';
import {
  EMAIL_COVER_NOTE,
  FICTIONAL_LINE,
  MODEL_LINE,
  VIEW_WORDS,
  closingParts,
  daysOverdue,
  editableBody,
  emailDraftFor,
  emailDraftFromLetter,
  endsWithClosing,
  isOverdue,
  letterAsItLeaves,
  letterPlainText,
  letterView,
  mailtoHref,
  nextStep,
  openEmail,
  outboundStepsOpen,
  sortLetters,
  letterRowWhat,
  printedLetter,
  statusDetail,
  whyNoPreview,
  withFictionalLine,
} from './letters.ts';
import { formatShortDate } from './format.ts';
import { JOB_NAMES } from './modelNames.ts';

const NOW = '2026-11-18T09:00:00.000Z';

const CLOSING = {
  closingLine: 'Drafted by a local AI model. Read by the pharmacist before sending.',
  signatureName: 'Sample Pharmacist',
  signatureTitle: 'Pharmacy Manager',
  signatureRegistration: 'PHA0000000000',
};

function letter(over: Partial<Letter>): Letter {
  return {
    id: 'T0001',
    findingId: 'F0001',
    caseId: 'C0001',
    status: 'ready',
    subject: 'Request for a medicines review',
    body: 'Dear Doctor,\n\nPlease review the medicines.\n\nYours sincerely,\n',
    editedByPharmacist: false,
    seenByPharmacist: true,
    ...CLOSING,
    ...over,
  };
}

describe('letter status in the list', () => {
  it('shows each state in words, with what the letter waits for under it', () => {
    expect(VIEW_WORDS.drafting).toBe('Being written');
    expect(statusDetail(letter({ status: 'drafting' }), 'drafting', NOW)).toBe(`${JOB_NAMES.letter} is writing it`);
    // The sample view has no model: it does not say that one is writing.
    expect(statusDetail(letter({ status: 'drafting' }), 'drafting', NOW, true)).toBe('Shown as being written (sample)');
    expect(VIEW_WORDS.ready).toBe('Ready to review');
    expect(statusDetail(letter({ status: 'ready', seenByPharmacist: false }), 'ready', NOW)).toBe('New');
    expect(statusDetail(letter({ status: 'ready' }), 'ready', NOW)).toBe('Waiting for your review');
    const sent = letter({ status: 'sent', dueAt: '2026-11-25T09:00:00.000Z', sentAt: NOW });
    expect(VIEW_WORDS.sent).toBe('Sent');
    expect(statusDetail(sent, 'sent', NOW)).toBe(`Reply due by ${formatShortDate(sent.dueAt)}`);
    expect(statusDetail(letter({ status: 'sent' }), 'sent', NOW)).toBe('Waiting for a reply');
    expect(VIEW_WORDS.reply_recorded).toBe('Reply recorded');
    expect(statusDetail(letter({ status: 'reply_recorded', reply: { at: NOW, outcome: 'will_review', note: '' } }), 'reply_recorded', NOW))
      .toBe('The doctor will review the patient');
    expect(VIEW_WORDS.closed).toBe('Closed');
    expect(statusDetail(letter({ status: 'closed', closedAt: '2026-11-04T09:00:00.000Z' }), 'closed', NOW))
      .toBe(`Closed on ${formatShortDate('2026-11-04T09:00:00.000Z')}`);
    expect(VIEW_WORDS.overdue).toBe('Overdue');
  });

  it('shows overdue with days just before and just after the due time', () => {
    const before = letter({ status: 'sent', dueAt: '2026-11-18T10:00:00.000Z' });
    expect(letterView(before, NOW)).toBe('sent');
    const after = letter({ status: 'sent', dueAt: '2026-11-18T08:00:00.000Z' });
    expect(letterView(after, NOW)).toBe('overdue');
    expect(statusDetail(after, 'overdue', NOW)).toBe('No reply. Overdue by 1 day');
    expect(statusDetail(letter({ status: 'sent', dueAt: '2026-11-15T09:00:00.000Z' }), 'overdue', NOW)).toBe(
      'No reply. Overdue by 3 days',
    );
  });

  it('says in the list when an answer was taken back after the letter was sent', () => {
    const note = 'An answer this letter rested on was taken back. The letter was not changed, because it was already marked as sent.';
    const sent = letter({ status: 'sent', dueAt: '2026-11-25T09:00:00.000Z', sentAt: NOW, withdrawnNote: note });
    expect(statusDetail(sent, 'sent', NOW)).toBe(`Reply due by ${formatShortDate(sent.dueAt)} ${note}`);
    expect(statusDetail(letter({ status: 'sent', withdrawnNote: note }), 'sent', NOW)).toContain('taken back');
    const overdue = letter({ status: 'sent', dueAt: '2026-11-15T09:00:00.000Z', sentAt: NOW, withdrawnNote: note });
    expect(statusDetail(overdue, 'overdue', NOW)).toContain('was taken back');
    expect(statusDetail(overdue, 'overdue', NOW)).toContain('already marked as sent');
    const body = 'Dear Doctor,\n\nPlease review Beta today.';
    expect(printedLetter(body, note)).toBe(`${note}\n\n${body}`);
    expect(printedLetter(body, note).includes(note)).toBe(true);
    expect(body).not.toContain('taken back');
    expect(printedLetter(body)).toBe(body);
  });

  it('names a one-point row from the first id of the list when both exist', () => {
    const name = (id: string): string | undefined => (
      id === 'F0002' ? 'Second criterion' : id === 'F0001' ? 'First criterion' : undefined
    );
    expect(letterRowWhat({ findingId: 'F0001', findingIds: ['F0002'], subject: 'Old subject' }, name)).toBe('Second criterion');
    expect(letterRowWhat({ findingId: 'F0001', subject: 'Old subject' }, name)).toBe('First criterion');
    expect(letterRowWhat({ findingId: 'F0009', findingIds: [], subject: 'Old subject' }, name)).toBe('Old subject');
    expect(letterRowWhat({ findingId: 'F0001', findingIds: ['F0001', 'F0009'], subject: 'Old subject' }, name)).toBe('2 points');
  });
});

describe('the next step under an open letter', () => {
  it('leads a ready letter to the preview, the one place from which it leaves', () => {
    const ready = nextStep(letter({}), 'ready', NOW);
    expect(ready).toBe(
      'Next: read the letter and edit it if you need to. Tick the box when the patient agrees. Then open the preview to print or email it, and mark it as sent.',
    );
    expect(nextStep(letter({ patientAgreed: { at: NOW } }), 'ready', NOW)).toContain('Next: open the preview.');
    expect(nextStep(letter({ status: 'drafting' }), 'drafting', NOW)).toBe('');
  });

  it('says what is true after the letter has left', () => {
    const sent = letter({ status: 'sent', sentAt: NOW, dueAt: '2026-11-25T09:00:00.000Z' });
    expect(nextStep(sent, 'sent', NOW)).toContain("The letter was sent. Record the doctor's reply when it comes. It is due by");
    const late = letter({ status: 'sent', sentAt: '2026-11-08T09:00:00.000Z', dueAt: '2026-11-15T09:00:00.000Z' });
    expect(nextStep(late, 'overdue', NOW)).toContain('3 days ago. Contact the practice, then record the reply.');
    expect(nextStep(letter({ status: 'reply_recorded' }), 'reply_recorded', NOW)).toBe('The reply is recorded. Close the case when nothing more is needed.');
    expect(nextStep(letter({ status: 'closed' }), 'closed', NOW)).toBe('This case is closed. The letter was not sent.');
    expect(nextStep(letter({ status: 'closed', sentAt: NOW }), 'closed', NOW)).toBe('This case is closed. No reply was recorded.');
    expect(nextStep(letter({ status: 'closed', sentAt: NOW, reply: { at: NOW, outcome: 'changed', note: '' } }), 'closed', NOW))
      .toBe('This case is closed. The loop is complete.');
  });
});

describe('overdue', () => {
  it('is a sent letter past its due time with no reply', () => {
    const late = letter({ status: 'sent', sentAt: '2026-11-08T09:00:00.000Z', dueAt: '2026-11-15T09:00:00.000Z' });
    expect(isOverdue(late, NOW)).toBe(true);
    expect(letterView(late, NOW)).toBe('overdue');
    expect(daysOverdue(late, NOW)).toBe(3);
  });

  it('is not a sent letter that is still inside its time', () => {
    const waiting = letter({ status: 'sent', dueAt: '2026-11-24T09:00:00.000Z' });
    expect(letterView(waiting, NOW)).toBe('sent');
    expect(daysOverdue(waiting, NOW)).toBe(0);
  });

  it('is never a letter with a reply, a closed letter, or a letter not yet sent', () => {
    const past = '2026-11-01T09:00:00.000Z';
    expect(letterView(letter({ status: 'reply_recorded', dueAt: past, reply: { at: NOW, outcome: 'changed', note: '' } }), NOW)).toBe('reply_recorded');
    expect(letterView(letter({ status: 'closed', dueAt: past }), NOW)).toBe('closed');
    expect(letterView(letter({ status: 'ready', dueAt: past }), NOW)).toBe('ready');
    expect(letterView(letter({ status: 'drafting' }), NOW)).toBe('drafting');
  });

  it('counts at least one day once the due time has passed', () => {
    const justLate = letter({ status: 'sent', dueAt: '2026-11-18T08:00:00.000Z' });
    expect(daysOverdue(justLate, NOW)).toBe(1);
  });
});

describe('sortLetters', () => {
  it('puts overdue first, then ready, and closed last', () => {
    const list = [
      letter({ id: 'closed', status: 'closed' }),
      letter({ id: 'sent', status: 'sent', dueAt: '2026-11-24T09:00:00.000Z' }),
      letter({ id: 'ready', status: 'ready' }),
      letter({ id: 'late', status: 'sent', dueAt: '2026-11-10T09:00:00.000Z' }),
      letter({ id: 'drafting', status: 'drafting' }),
    ];
    expect(sortLetters(list, NOW).map((l) => l.id)).toEqual(['late', 'ready', 'drafting', 'sent', 'closed']);
  });
});

describe('the last lines of a letter', () => {
  const text = 'Dear Doctor,\n\nPlease review the medicines.';
  const ending = `Yours sincerely,\n\n${CLOSING.closingLine}\n${CLOSING.signatureName}\n${CLOSING.signatureTitle}\n${CLOSING.signatureRegistration}`;

  it('are taken off the text the pharmacist edits when the letter ends with them', () => {
    // The server keeps every letter with these lines at its end. The editor shows them once, under the text box.
    expect(editableBody(`${text}\n\n${ending}`, CLOSING)).toBe(text);
    expect(editableBody(`${text}\r\n\r\n${ending.replace(/\n/g, '\r\n')}\r\n\r\n`, CLOSING)).toBe(text);
    expect(endsWithClosing(`${text}\n\n${ending}`, CLOSING)).toBe(true);
  });

  it('leave a text without them exactly as it is', () => {
    expect(editableBody(text, CLOSING)).toBe(text);
    expect(editableBody(`${text}\n\nYours sincerely,\n`, CLOSING)).toBe(`${text}\n\nYours sincerely,\n`);
    expect(endsWithClosing(text, CLOSING)).toBe(false);
    // Three of the four lines are not the last lines.
    const three = `${text}\n\nYours sincerely,\n\n${CLOSING.signatureName}\n${CLOSING.signatureTitle}\n${CLOSING.signatureRegistration}`;
    expect(editableBody(three, CLOSING)).toBe(three);
  });

  it('leave a text with words typed after them as it is; the letter as it leaves has those words above them', () => {
    const typedAfter = `${text}\n\n${ending}\n\nP.S. One more thing.`;
    expect(editableBody(typedAfter, CLOSING)).toBe(typedAfter);
    const leaves = letterAsItLeaves(typedAfter, CLOSING);
    expect(leaves).toBe(`${text}\n\nP.S. One more thing.\n\n${FICTIONAL_LINE}\n\n${ending}`);
    expect(editableBody(leaves, CLOSING)).toBe(`${text}\n\nP.S. One more thing.\n\n${FICTIONAL_LINE}`);
  });

  it('are put back once, however often the letter is saved', () => {
    const once = letterAsItLeaves(text, CLOSING);
    expect(once.split('Yours sincerely,')).toHaveLength(2);
    expect(letterAsItLeaves(once, CLOSING)).toBe(once);
    // What the editor shows, saved again, gives the same letter.
    expect(letterAsItLeaves(editableBody(once, CLOSING), CLOSING)).toBe(once);
  });

  it('come from the server with the letter; a line it took away stays away', () => {
    expect(closingParts(letter({}))).toEqual(CLOSING);
    // A letter that carries its signature and no line about who wrote the words has none.
    const noLine = closingParts(letter({ closingLine: undefined }));
    expect(noLine.closingLine).toBe('');
    expect(editableBody(`${text}\n\nYours sincerely,\n\n${CLOSING.signatureName}\n${CLOSING.signatureTitle}\n${CLOSING.signatureRegistration}`, noLine)).toBe(text);
    // A saved letter that carries none of the four closing fields shows no made-up sentence.
    const bare = {
      closingLine: undefined,
      signatureName: undefined,
      signatureTitle: undefined,
      signatureRegistration: undefined,
    };
    const old = letter(bare);
    expect(closingParts(old).closingLine).toBe('');
    expect(letterPlainText(old)).not.toContain('Built from the standard letter template');
    const reasons = ['checks_failed', 'no_answer', 'error'] as const;
    for (const templateReason of reasons) {
      const saved = letter({
        ...bare,
        draft: { subject: '', body: '', origin: 'template', templateReason, checkNotes: [], model: 'm', at: NOW, seconds: 0 },
      });
      expect(closingParts(saved).closingLine).toBe('');
      const plain = letterPlainText(saved);
      expect(plain).not.toContain('Built from the standard letter template');
      expect(plain).not.toContain('The AI model did not answer');
      expect(plain).not.toContain('could not be made');
      expect(plain).not.toContain(MODEL_LINE);
    }
    const modelBare = letter({
      ...bare,
      draft: { subject: '', body: '', origin: 'model', checkNotes: [], model: 'm', at: NOW, seconds: 0 },
    });
    expect(closingParts(modelBare).closingLine).toBe('');
    expect(letterPlainText(modelBare)).not.toContain(MODEL_LINE);
  });
});

describe('preview outbound steps', () => {
  it('never opens without a preview, and not after a later change', () => {
    expect(outboundStepsOpen(letter({}), true)).toBe(false);
    expect(outboundStepsOpen(letter({ previewedAt: '2026-11-18T09:00:00.000Z', previewHash: 'abc' }), true)).toBe(false);
    expect(outboundStepsOpen(letter({}), false)).toBe(false);
    expect(outboundStepsOpen(letter({ previewedAt: '2026-11-18T09:00:00.000Z', previewHash: 'abc' }), false)).toBe(true);
  });

  it('the preview opens for every letter that has text, and says why when it cannot', () => {
    expect(whyNoPreview('ready', true)).toBe('');
    expect(whyNoPreview('sent', true)).toBe('');
    expect(whyNoPreview('ready', false)).toBe('The letter has no text.');
    expect(whyNoPreview('drafting', false)).toBe('The letter is still being written.');
  });
});

describe('email draft', () => {
  it('holds the letter text when it fits and a cover note when it does not, and never an address', () => {
    const short = emailDraftFor('Subject', 'A'.repeat(500));
    expect(short.fits).toBe(true);
    expect(short.coverNote).toBe(false);
    expect(short.text).toBe('A'.repeat(500));
    const long = emailDraftFor('Subject', 'B'.repeat(2000));
    expect(long.fits).toBe(false);
    expect(long.coverNote).toBe(true);
    expect(long.text).toBe(EMAIL_COVER_NOTE);
    expect(mailtoHref('S', short.text)).not.toContain('@');
    expect(mailtoHref('S', short.text)).toContain('mailto:?subject=');
  });

  it('builds from a letter with the fictional line once in the copied text', () => {
    const text = letterPlainText(letter({}));
    expect(text).toContain(FICTIONAL_LINE);
    expect(text.split(FICTIONAL_LINE)).toHaveLength(2);
    expect(text).toContain('Sample Pharmacist');
    expect(text).toMatch(/Yours sincerely,/);
    const draft = emailDraftFromLetter(letter({}), letter({}).subject, letter({}).body);
    expect(draft.fits).toBe(text.length <= 1800);
  });

  it('gives a text that lost the fictional line the line back, once', () => {
    expect(withFictionalLine('Dear Doctor')).toBe(`${FICTIONAL_LINE}\n\nDear Doctor`);
    const withLine = `Patient: X\n${FICTIONAL_LINE}\n\nDear Doctor`;
    expect(withFictionalLine(withLine)).toBe(withLine);
  });
});

describe('"Open in my email program"', () => {
  function steps(saved: boolean, copied = true): { log: string[]; run: Parameters<typeof openEmail>[0] } {
    const log: string[] = [];
    return {
      log,
      run: {
        save: async () => {
          log.push('save starts');
          await new Promise((resolve) => setTimeout(resolve, 5));
          log.push(saved ? 'saved' : 'save failed');
          return saved;
        },
        copy: async () => {
          log.push('copy');
          return copied;
        },
        leaving: (on) => log.push(`leaving ${on}`),
        open: () => log.push('open the email program'),
      },
    };
  }

  it('saves the edits first, and opens the email program only when they are saved', async () => {
    const s = steps(true);
    expect(await openEmail(s.run)).toBe('opened_and_copied');
    // The program is opened after the save has ended, and the page is told that this is not "leaving".
    expect(s.log).toEqual(['save starts', 'saved', 'copy', 'leaving true', 'open the email program']);
  });

  it('opens nothing, and says nothing was opened, when the edits could not be saved', async () => {
    const s = steps(false);
    expect(await openEmail(s.run)).toBe('not_saved');
    expect(s.log).toEqual(['save starts', 'save failed']);
  });

  it('still opens the email program when the letter could not be copied', async () => {
    const s = steps(true, false);
    expect(await openEmail(s.run)).toBe('opened');
    expect(s.log[s.log.length - 1]).toBe('open the email program');
  });
});
