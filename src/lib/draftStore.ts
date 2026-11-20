// Keeps letter edits in this browser until the server has them.
// Pure functions take a small storage interface so tests need no browser.

export interface DraftStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface LetterDraftLocal {
  subject: string;
  body: string;
  savedSubject: string;
  savedBody: string;
  /** The draft revision this text was opened against. Absent in a copy kept before revisions. */
  revision?: number;
}

const PREFIX = 'lantern-letter-draft-';

/** The most characters a letter text may hold. The same cap as server/engine.ts editLetter. */
export const LETTER_TEXT_CAP = 200_000;

export function draftKey(letterId: string): string {
  return `${PREFIX}${letterId}`;
}

function parse(raw: string | null): LetterDraftLocal | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<LetterDraftLocal>;
    if (typeof data.subject !== 'string' || typeof data.body !== 'string') return null;
    const savedSubject = typeof data.savedSubject === 'string' ? data.savedSubject : data.subject;
    const savedBody = typeof data.savedBody === 'string' ? data.savedBody : data.body;
    const revision = typeof data.revision === 'number' && Number.isInteger(data.revision) && data.revision >= 0 ? data.revision : undefined;
    return { subject: data.subject, body: data.body, savedSubject, savedBody, ...(revision !== undefined ? { revision } : {}) };
  } catch {
    return null;
  }
}

export function isDraftDirty(draft: LetterDraftLocal): boolean {
  return draft.subject !== draft.savedSubject || draft.body !== draft.savedBody;
}

/**
 * The subject as the server keeps it: one line, with single spaces. A subject longer than 300
 * characters is refused by the server, so this does not cut one. (server/engine.ts, editLetter.)
 */
export function tidySubject(subject: string): string {
  return subject.replace(/\s+/g, ' ').trim();
}

/**
 * The letter text as the server keeps it: Unix line ends, no spaces at the end of a line and no
 * empty lines at the end of the text. A letter longer than LETTER_TEXT_CAP is refused by the
 * server, so this does not cut one. (server/engine.ts, editLetter, and pipeline/letter.ts,
 * letterAsItLeaves.)
 */
export function tidyBody(body: string): string {
  return body.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
}

/**
 * True when the server holds the text that was last saved from this editor. The server tidies what
 * it is sent, so the two are compared in their tidied form: a space typed at the end of a line is
 * not a reason to put the server's copy over the text that is being typed.
 */
export function serverHasSaved(draft: LetterDraftLocal, serverSubject: string, serverBody: string): boolean {
  return tidySubject(draft.savedSubject) === tidySubject(serverSubject) && tidyBody(draft.savedBody) === tidyBody(serverBody);
}

/** Read what is kept for this letter, or nothing. */
export function readStoredDraft(storage: DraftStorage, letterId: string): LetterDraftLocal | null {
  return parse(storage.get(draftKey(letterId)));
}

/** Keep the text the pharmacist is typing. */
export function writeStoredDraft(storage: DraftStorage, letterId: string, draft: LetterDraftLocal): void {
  storage.set(draftKey(letterId), JSON.stringify(draft));
}

/** Drop the kept copy once the server has the same text. */
export function clearStoredDraft(storage: DraftStorage, letterId: string): void {
  storage.remove(draftKey(letterId));
}

/**
 * The text shown in the editor. Unsaved local text wins over older server text.
 * When nothing unsaved is kept, the server text is used.
 */
export function mergeDraftWithServer(
  storage: DraftStorage,
  letterId: string,
  serverSubject: string,
  serverBody: string,
): LetterDraftLocal {
  const kept = readStoredDraft(storage, letterId);
  if (kept && isDraftDirty(kept)) return kept;
  if (kept && !isDraftDirty(kept) && kept.savedSubject === serverSubject && kept.savedBody === serverBody) {
    return kept;
  }
  return { subject: serverSubject, body: serverBody, savedSubject: serverSubject, savedBody: serverBody };
}

/** After a successful save, mark the kept copy as saved. */
export function markDraftSaved(draft: LetterDraftLocal, subject: string, body: string): LetterDraftLocal {
  return { subject, body, savedSubject: subject, savedBody: body };
}