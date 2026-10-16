import type { z } from 'zod';
import type {
  BackupDocument, Flashcard, FlashcardInput, Note, NoteInput, ReviewInput, ReviewLog,
  SaveNoteInput, Snapshot, StorageService, Subject, SubjectInput, Theme, UpdateFlashcardInput,
} from '../../shared/types';
import {
  flashcardInputSchema, flashcardSchema, idSchema, noteInputSchema, noteSchema,
  reviewInputSchema, reviewLogSchema, saveNoteSchema, storageError, subjectInputSchema,
  subjectSchema, themeSchema, updateFlashcardSchema, validate, validateBackup, validateSnapshot,
  importBatchSchema, importResultSchema, storedDocumentSchema, importAssetSchema, hashSchema,
} from './validation';

export type NativeInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export function createNativeStorage(invoke: NativeInvoke): StorageService {
  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();
  function call<T>(command: string, args: Record<string, unknown> | undefined, parse: (value: unknown) => T): Promise<T> {
    if (closed) return Promise.reject(new Error('O armazenamento já foi fechado.'));
    const result = queue.then(async () => parse(await invoke(command, args)))
      .catch((error) => { throw storageError(error); });
    queue = result.catch(() => undefined);
    return result;
  }
  function inputCall<T, I>(command: string, input: I, schema: z.ZodType<I>, output: z.ZodType<T>): Promise<T> {
    try { return call(command, { input: validate(schema, input) }, (value) => validate(output, value)); }
    catch (error) { return Promise.reject(storageError(error)); }
  }

  return {
    getSnapshot: (): Promise<Snapshot> => call('get_snapshot', undefined, validateSnapshot),
    createSubject: (input: SubjectInput): Promise<Subject> => inputCall('create_subject', input, subjectInputSchema, subjectSchema),
    updateSubject: (id: string, input: SubjectInput): Promise<Subject> => {
      try { return call('update_subject', { id: validate(idSchema, id), input: validate(subjectInputSchema, input) }, (value) => validate(subjectSchema, value)); }
      catch (error) { return Promise.reject(storageError(error)); }
    },
    createNote: (input: NoteInput): Promise<Note> => inputCall('create_note', input, noteInputSchema, noteSchema),
    saveNote: (input: SaveNoteInput): Promise<Note> => inputCall('save_note', input, saveNoteSchema, noteSchema),
    createFlashcard: (input: FlashcardInput): Promise<Flashcard> => inputCall('create_flashcard', input, flashcardInputSchema, flashcardSchema),
    updateFlashcard: (input: UpdateFlashcardInput): Promise<Flashcard> => inputCall('update_flashcard', input, updateFlashcardSchema, flashcardSchema),
    recordReview: (input: ReviewInput): Promise<ReviewLog> => inputCall('record_review', input, reviewInputSchema, reviewLogSchema),
    setTheme: (theme: Theme): Promise<void> => {
      try { return call('set_theme', { theme: validate(themeSchema, theme) }, () => undefined); }
      catch (error) { return Promise.reject(storageError(error)); }
    },
    importBatch: (input) => inputCall('import_batch',input,importBatchSchema,importResultSchema),
    getDocument: (id) => call('get_document',{id:validate(idSchema,id)},value=>validate(storedDocumentSchema,value)),
    getAsset: (sha256) => call('get_asset',{sha256:validate(hashSchema,sha256)},value=>validate(importAssetSchema,value)),
    exportBackup: (): Promise<BackupDocument> => call('export_backup', undefined, validateBackup),
    restoreBackup: (backup: unknown): Promise<void> => {
      try { return call('restore_backup', { backup: validateBackup(backup) }, () => undefined); }
      catch (error) { return Promise.reject(storageError(error)); }
    },
    close: async () => { closed = true; await queue; },
  };
}
