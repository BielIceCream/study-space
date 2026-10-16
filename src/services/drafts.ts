import type { SaveNoteInput } from '../shared/types';

const prefix = 'studyspace:note-draft:';

// A synchronous recovery journal closes the gap before an async SQLite write.
// It is never the canonical database; entries are cleared only after commit.
export function readDraft(noteId: string): SaveNoteInput | null {
  try {
    const raw = localStorage.getItem(prefix + noteId);
    if (!raw) return null;
    const value = JSON.parse(raw) as SaveNoteInput;
    return value.id === noteId && typeof value.title === 'string' &&
      typeof value.plainText === 'string' && Number.isInteger(value.expectedRevision) &&
      value.bodyJson?.type === 'doc' ? value : null;
  } catch { return null; }
}

export function writeDraft(draft: SaveNoteInput): void {
  localStorage.setItem(prefix + draft.id, JSON.stringify(draft));
}

export function clearDraft(noteId: string): void {
  localStorage.removeItem(prefix + noteId);
}
