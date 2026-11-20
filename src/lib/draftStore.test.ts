import { describe, expect, it } from 'vitest';
import {
  clearStoredDraft,
  draftKey,
  isDraftDirty,
  markDraftSaved,
  mergeDraftWithServer,
  readStoredDraft,
  serverHasSaved,
  tidyBody,
  tidySubject,
  writeStoredDraft,
  type DraftStorage,
} from './draftStore.ts';

function memory(): DraftStorage & { dump: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    dump: map,
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
  };
}

describe('draftStore', () => {
  it('keeps a change and reads it back', () => {
    const s = memory();
    writeStoredDraft(s, 'T0002', { subject: 'S', body: 'Hello', savedSubject: 'Old', savedBody: 'Old body' });
    expect(readStoredDraft(s, 'T0002')).toEqual({ subject: 'S', body: 'Hello', savedSubject: 'Old', savedBody: 'Old body' });
    expect(draftKey('T0002')).toBe('lantern-letter-draft-T0002');
  });

  it('clears a saved draft', () => {
    const s = memory();
    writeStoredDraft(s, 'T0001', { subject: 'A', body: 'B', savedSubject: 'A', savedBody: 'B' });
    clearStoredDraft(s, 'T0001');
    expect(readStoredDraft(s, 'T0001')).toBeNull();
  });

  it('uses unsaved local text instead of older server text', () => {
    const s = memory();
    writeStoredDraft(s, 'T0003', { subject: 'New sub', body: 'Typing', savedSubject: 'Was', savedBody: 'Was' });
    expect(mergeDraftWithServer(s, 'T0003', 'Server sub', 'Server body')).toEqual({
      subject: 'New sub',
      body: 'Typing',
      savedSubject: 'Was',
      savedBody: 'Was',
    });
  });

  it('uses server text when nothing unsaved is kept', () => {
    const s = memory();
    expect(mergeDraftWithServer(s, 'T0003', 'Server sub', 'Server body')).toEqual({
      subject: 'Server sub',
      body: 'Server body',
      savedSubject: 'Server sub',
      savedBody: 'Server body',
    });
  });

  it('does not mix two letters', () => {
    const s = memory();
    writeStoredDraft(s, 'T0001', { subject: 'One', body: 'A', savedSubject: 'O', savedBody: 'O' });
    expect(mergeDraftWithServer(s, 'T0002', 'Two', 'B')).toEqual({
      subject: 'Two',
      body: 'B',
      savedSubject: 'Two',
      savedBody: 'B',
    });
    expect(readStoredDraft(s, 'T0001')?.subject).toBe('One');
  });

  it('marks dirty and saved', () => {
    const d = { subject: 'a', body: 'b', savedSubject: 'x', savedBody: 'y' };
    expect(isDraftDirty(d)).toBe(true);
    expect(isDraftDirty(markDraftSaved(d, 'a', 'b'))).toBe(false);
  });
});

describe('the text as the server keeps it', () => {
  it('tidies a subject to one line with single spaces', () => {
    expect(tidySubject('  Request   for a\treview \n')).toBe('Request for a review');
    // A long subject is left whole. The server refuses it. Cutting it here would hide the words.
    expect(tidySubject('x'.repeat(400))).toHaveLength(400);
  });

  it('tidies a letter text: Unix line ends, no spaces at the end of a line, no empty lines at the end', () => {
    expect(tidyBody('Dear Doctor,  \r\n\r\nPlease review. \t\r\n\r\n\r\n')).toBe('Dear Doctor,\n\nPlease review.');
    // Spaces inside a line, and empty lines inside the text, are kept.
    expect(tidyBody('One  two\n\n\nThree')).toBe('One  two\n\n\nThree');
    expect(tidyBody('y'.repeat(31000))).toHaveLength(31000);
    // A letter past the cap is left whole. The server refuses it. Cutting it here would hide the words.
    expect(tidyBody('y'.repeat(210_000))).toHaveLength(210_000);
  });

  it('knows the tidied copy of the server as the text that was saved, so it does not replace what is being typed', () => {
    // The pharmacist typed a space at the end and paused. The save went out with the space; the server keeps it without.
    const typing = { subject: 'Review ', body: 'Dear Doctor, \n', savedSubject: 'Review ', savedBody: 'Dear Doctor, \n' };
    expect(serverHasSaved(typing, 'Review', 'Dear Doctor,')).toBe(true);
    // Another text on the server is another text.
    expect(serverHasSaved(typing, 'Review', 'Dear Doctor, changed elsewhere')).toBe(false);
    expect(serverHasSaved(typing, 'Another subject', 'Dear Doctor,')).toBe(false);
  });
});
