import { useCallback, useEffect, useState } from 'react';
import type { FlashcardInput, NoteInput, ReviewInput, SaveNoteInput, Snapshot, StorageService, SubjectInput, Theme, UpdateFlashcardInput } from '../shared/types';
import { messageFrom } from '../shared/utils';
import { recordWorkspaceReview, SavedReviewNeedsReloadError } from './review-recording';
import type { SaveErrorEntryInput } from '../domain/error-notebook/types';

export function useWorkspace(storage: StorageService) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewNeedsReload, setReviewNeedsReload] = useState(false);
  const reload = useCallback(async () => {
    const snapshot = await storage.getSnapshot();
    setData(snapshot);
    setError(null);
    setReviewNeedsReload(false);
    return snapshot;
  }, [storage]);

  useEffect(() => { void reload().catch(cause => setError(messageFrom(cause))); }, [reload]);

  const createSubject = async (input: SubjectInput) => {
    const subject = await storage.createSubject(input);
    setData(current => current && { ...current, subjects: [...current.subjects, subject] });
    return subject;
  };
  const saveErrorEntry = async (input:SaveErrorEntryInput) => {
    const entry = await storage.saveErrorEntry(input);
    setData(current => current && {...current,errorEntries:[...(current.errorEntries??[]).filter(item=>item.id!==entry.id),entry]});
    return entry;
  };
  const updateSubject = async (id: string, input: SubjectInput) => {
    const subject = await storage.updateSubject(id, input);
    setData(current => current && { ...current, subjects: current.subjects.map(item => item.id === id ? subject : item) });
    return subject;
  };
  const createNote = async (input: NoteInput) => {
    const note = await storage.createNote(input);
    setData(current => current && { ...current, notes: [...current.notes, note] });
    return note;
  };
  const saveNote = async (input: SaveNoteInput) => {
    const note = await storage.saveNote(input);
    setData(current => current && { ...current, notes: current.notes.map(item => item.id === note.id && item.revision <= note.revision ? note : item) });
    return note;
  };
  const createFlashcard = async (input: FlashcardInput) => {
    const card = await storage.createFlashcard(input);
    setData(current => current && { ...current, flashcards: [...current.flashcards, card] });
    return card;
  };
  const updateFlashcard = async (input: UpdateFlashcardInput) => {
    const card = await storage.updateFlashcard(input);
    setData(current => current && { ...current, flashcards: current.flashcards.map(item => item.id === card.id ? card : item) });
    return card;
  };
  const recordReview = async (input: ReviewInput) => {
    try {
      const { log, snapshot } = await recordWorkspaceReview(storage, input);
      setData(current => snapshot ?? (current && { ...current, reviewLogs: current.reviewLogs.some(item => item.id === log.id) ? current.reviewLogs : [...current.reviewLogs, log] }));
      if (snapshot) setReviewNeedsReload(false);
      return log;
    } catch (cause) {
      if (cause instanceof SavedReviewNeedsReloadError) setReviewNeedsReload(true);
      throw cause;
    }
  };
  const setTheme = async (theme: Theme) => {
    await storage.setTheme(theme);
    setData(current => current && { ...current, settings: { ...current.settings, theme } });
  };

  return { data, error, reviewNeedsReload, reload, saveErrorEntry, createSubject, updateSubject, createNote, saveNote, createFlashcard, updateFlashcard, recordReview, setTheme };
}
