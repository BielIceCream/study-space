import type { z } from 'zod';
import { saveStudyTrackSchema, studyTrackSchema } from '../../domain/study/validation';
import { savePlannerSchema, plannerSchema } from '../../domain/planner/validation';
import { errorEntrySchema, saveErrorEntrySchema } from '../../domain/error-notebook/engine';
import { createBackupArchive, materialDescriptors, validateArchiveManifest, verifyMaterial } from '../backup-archive';
import type { BackupArchive } from '../backup-archive';
import { encodeMaterial } from './materials';
import { parseRecoveryMetadata, recoveryIdSchema } from './recovery';
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
  function operation<T>(action: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new Error('O armazenamento já foi fechado.'));
    const result = queue.then(action)
      .catch((error) => { throw storageError(error); });
    queue = result.catch(() => undefined);
    return result;
  }
  function call<T>(command: string, args: Record<string, unknown> | undefined, parse: (value: unknown) => T): Promise<T> {
    return operation(async () => parse(await invoke(command, args)));
  }
  function inputCall<T, I>(command: string, input: I, schema: z.ZodType<I>, output: z.ZodType<T>): Promise<T> {
    try { return call(command, { input: validate(schema, input) }, (value) => validate(output, value)); }
    catch (error) { return Promise.reject(storageError(error)); }
  }

  function exportArchive(command: string, args?: Record<string, unknown>): Promise<Blob> {
    return operation(async () => {
      const start = await invoke<{ token: unknown; manifest: unknown }>(command, args);
      const token = validate(idSchema, start?.token);
      try {
        const manifest = validateArchiveManifest(start.manifest);
        const descriptors = materialDescriptors(manifest);
        return await createBackupArchive(manifest, async index => {
          const encoded = await invoke<unknown>('export_backup_v3_material', { token, index });
          if (typeof encoded !== 'string' || encoded.length > Math.ceil(descriptors[index].byteLength / 3) * 4) throw new Error('O material retornado pelo armazenamento é inválido.');
          try { return Uint8Array.from(atob(encoded), char => char.charCodeAt(0)); }
          catch { throw new Error('O material retornado pelo armazenamento é inválido.'); }
        });
      } finally { await invoke('backup_v3_cancel', { token }).catch(() => undefined); }
    });
  }

  return {
    getSnapshot: (): Promise<Snapshot> => call('get_snapshot', undefined, validateSnapshot),
    saveErrorEntry: input => inputCall('save_error_entry',input,saveErrorEntrySchema,errorEntrySchema),
    createSubject: (input: SubjectInput): Promise<Subject> => inputCall('create_subject', input, subjectInputSchema, subjectSchema),
    updateSubject: (id: string, input: SubjectInput): Promise<Subject> => {
      try { return call('update_subject', { id: validate(idSchema, id), input: validate(subjectInputSchema, input) }, (value) => validate(subjectSchema, value)); }
      catch (error) { return Promise.reject(storageError(error)); }
    },
    createNote: (input: NoteInput): Promise<Note> => inputCall('create_note', input, noteInputSchema, noteSchema),
    saveNote: (input: SaveNoteInput): Promise<Note> => inputCall('save_note', input, saveNoteSchema, noteSchema),
    saveStudyTrack: input => inputCall('save_study_track', input, saveStudyTrackSchema, studyTrackSchema),
    saveStudyPlanner: input => inputCall('save_study_planner', input, savePlannerSchema, plannerSchema),
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
    listRecoveryCopies: () => call('list_recovery_copies', undefined, value => {
      if (!Array.isArray(value)) throw new Error('A lista de cópias de recuperação é inválida.');
      return value.map(parseRecoveryMetadata);
    }),
    exportRecoveryCopy: id => {
      try { return exportArchive('export_recovery_v3_begin', { id: validate(recoveryIdSchema, id) }); }
      catch (error) { return Promise.reject(storageError(error)); }
    },
    exportBackupArchive: () => exportArchive('export_backup_v3_begin'),
    restoreBackupArchive: (archive: BackupArchive): Promise<void> => operation(async () => {
      const manifest = validateArchiveManifest(archive.manifest);
      const descriptors = materialDescriptors(manifest);
      const token = validate(idSchema, await invoke<unknown>('restore_backup_v3_begin', { manifest }));
      try {
        for (let index = 0; index < descriptors.length; index++) {
          const bytes = await archive.readMaterial(index);
          await verifyMaterial(bytes, descriptors[index]);
          await invoke('restore_backup_v3_material', { token, index, dataBase64: encodeMaterial(bytes) });
        }
        await invoke('restore_backup_v3_finish', { token });
      } finally { await invoke('backup_v3_cancel', { token }).catch(() => undefined); }
    }),
    close: async () => { closed = true; await queue; },
  };
}
