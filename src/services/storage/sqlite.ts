import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import migration from '../../../db/migrations/001_initial.sql?raw';
import materialsMigration from '../../../db/migrations/002_materials.sql?raw';
import studyMigration from '../../../db/migrations/003_study_tracks.sql?raw';
import plannerMigration from '../../../db/migrations/004_study_planners.sql?raw';
import reviewMigration from '../../../db/migrations/005_review_schedules.sql?raw';
import errorMigration from '../../../db/migrations/006_error_entries.sql?raw';
import { buildErrorEntry, errorEntrySchema, saveErrorEntrySchema } from '../../domain/error-notebook/engine';
import { advanceSchedule, validateSchedule } from '../../domain/spaced-repetition/engine';
import type { ReviewSchedule } from '../../domain/spaced-repetition/types';
import type { StudyPlanner } from '../../domain/planner/types';
import { plannerSchema, savePlannerSchema, validatePlannerLinks, validatePlannerTransition } from '../../domain/planner/validation';
import type { StudyTrack } from '../../domain/study/types';
import { saveStudyTrackSchema, studyTrackSchema, validateStudyLinks, validateStudyTransition } from '../../domain/study/validation';
import { documentMetadata, cardMetadata, storedDocument, storedAsset, backupMaterials, decodeMaterial, insertAsset, importSQLiteBatch, validateAssetContent } from './materials';
import { createBackupArchive, materialDescriptors, validateArchiveManifest, verifyMaterial } from '../backup-archive';
import type { BackupArchiveManifest } from '../backup-archive';
import { EMPTY_DOCUMENT } from '../../shared/types';
import type {
  BackupDocument, Flashcard, FlashcardInput, Note, NoteInput, ReviewInput, ReviewLog,
  SaveNoteInput, Snapshot, StorageService, Subject, SubjectInput, Theme, UpdateFlashcardInput,
} from '../../shared/types';
import { MemoryPersistence } from './persistence';
import type { PersistenceAdapter } from './persistence';
import { listRecoveryMetadata, protectBeforeMigration, verifyRecoveryRecord, parseRecoveryMetadata, recoveryIdSchema } from './recovery';
import {
  flashcardInputSchema, idSchema, noteInputSchema, reviewInputSchema, saveNoteSchema,
  storageError, subjectInputSchema, themeSchema, updateFlashcardSchema, validate,
  validateBackup, validateSnapshot,
} from './validation';

export interface SQLiteStorageOptions {
  persistence: PersistenceAdapter;
  initializeSqlite: () => Promise<SqlJsStatic>;
  now?: () => string;
  newId?: () => string;
  /** Additional migrations for isolated failure tests; production uses the compiled plan. */
  migrationPlan?: readonly { version: number; sql: string }[];
}

type Row = Record<string, SqlValue>;
function rows(db: Database, sql: string, params: SqlValue[] = []): Row[] {
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    const result: Row[] = [];
    while (statement.step()) result.push(statement.getAsObject());
    return result;
  } finally { statement.free(); }
}

function scalar(db: Database, sql: string): SqlValue | undefined {
  return Object.values(rows(db, sql)[0] ?? {})[0];
}

const COMPILED_MIGRATIONS = [{ version: 1, sql: migration }, { version: 2, sql: materialsMigration }, { version: 3, sql: studyMigration }, { version: 4, sql: plannerMigration }, { version: 5, sql: reviewMigration }, {version:6,sql:errorMigration}];

function inspectDatabase(db: Database, target: number): number {
  db.run('PRAGMA foreign_keys = ON');
  const version = Number(scalar(db, 'PRAGMA user_version'));
  if (!Number.isInteger(version) || version < 0) throw new Error('A versão do banco local é inválida.');
  if (version > target) throw new Error('Este banco foi criado por uma versão mais nova do StudySpace. Atualize o aplicativo.');
  if (scalar(db, 'PRAGMA quick_check') !== 'ok') throw new Error('O banco local está corrompido. Preserve uma cópia antes de restaurar um backup.');
  if (rows(db, 'PRAGMA foreign_key_check').length) throw new Error('O banco local contém vínculos inválidos.');
  return version;
}

function migrate(db: Database, version: number, plan: readonly { version: number; sql: string }[]): boolean {
  if (version >= plan.at(-1)!.version) return false;
  db.run('BEGIN IMMEDIATE');
  try {
    for (const step of plan) if (step.version > version) {
      db.exec(step.sql);
      db.run(`PRAGMA user_version = ${step.version}`);
    }
    inspectDatabase(db, plan.at(-1)!.version);
    db.run('COMMIT');
    return true;
  } catch (error) {
    db.run('ROLLBACK');
    throw new Error(`A atualização do banco foi interrompida. O banco anterior foi preservado; baixe uma cópia recuperada e tente novamente. ${error instanceof Error ? error.message : String(error)}`);
  }
}

function subject(row: Row): Subject {
  return { id: String(row.id), name: String(row.name), accent: row.accent as Subject['accent'], createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
function note(row: Row): Note {
  return { id: String(row.id), subjectId: String(row.subject_id), title: String(row.title), bodyJson: JSON.parse(String(row.body_json)), plainText: String(row.plain_text), revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
function card(row: Row): Flashcard {
  return { id: String(row.id), subjectId: String(row.subject_id), noteId: row.note_id === null ? null : String(row.note_id), front: String(row.front), back: String(row.back), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
function review(row: Row): ReviewLog {
  return { id: String(row.id), flashcardId: String(row.flashcard_id), sessionId: String(row.session_id), rating: Number(row.rating) as ReviewLog['rating'], reviewedAt: String(row.reviewed_at) };
}

function snapshot(db: Database): Snapshot {
  const errorEntries = rows(db,"SELECT id,subject_id,data_json FROM error_entries ORDER BY json_extract(data_json,'$.createdAt'),id").map(row => {
    const entry = validate(errorEntrySchema,JSON.parse(String(row.data_json)));
    if (entry.id !== row.id || entry.subjectId !== row.subject_id) throw new Error('Os identificadores do caderno estão inconsistentes.');
    return entry;
  });
  const reviewSchedules = rows(db, 'SELECT flashcard_id,last_review_id,data_json FROM review_schedules ORDER BY flashcard_id').map(row => {
    const value = validateSchedule(JSON.parse(String(row.data_json)));
    if (value.flashcardId !== row.flashcard_id || value.lastReviewId !== row.last_review_id) throw new Error('Os identificadores da agenda de revisão estão inconsistentes.');
    return value;
  });
  const studyTracks = rows(db, "SELECT id,data_json FROM study_tracks ORDER BY json_extract(data_json,'$.createdAt'),id").map(row => { const value: StudyTrack = JSON.parse(String(row.data_json)); if (value.id !== row.id) throw new Error('O identificador da trilha está inconsistente.'); return value; });
  const studyPlanners = rows(db, 'SELECT track_id,data_json FROM study_planners ORDER BY track_id').map(row => { const value: StudyPlanner = JSON.parse(String(row.data_json)); if (value.trackId !== row.track_id) throw new Error('O identificador da agenda está inconsistente.'); return value; });
  return validateSnapshot({
    subjects: rows(db, 'SELECT * FROM subjects ORDER BY created_at, id').map(subject),
    notes: rows(db, 'SELECT * FROM notes ORDER BY created_at, id').map(note),
    flashcards: rows(db, 'SELECT * FROM flashcards ORDER BY created_at, id').map(card),
    reviewLogs: rows(db, 'SELECT * FROM review_logs ORDER BY reviewed_at, id').map(review),
    settings: { theme: rows(db, 'SELECT value FROM settings WHERE key = ?', ['theme'])[0]?.value },
    documents: documentMetadata(db), cardMetadata: cardMetadata(db),
    ...(studyTracks.length ? { studyTracks } : {}),
    ...(studyPlanners.length ? { studyPlanners } : {}),
    ...(reviewSchedules.length ? { reviewSchedules } : {}),
    ...(errorEntries.length ? { errorEntries } : {}),
  });
}

function required(row: Row | undefined, message: string): Row {
  if (!row) throw new Error(message);
  return row;
}

async function insertMany<T>(db: Database, sql: string, values: T[], bind: (value: T) => SqlValue[]): Promise<void> {
  const statement = db.prepare(sql);
  try {
    for (let index = 0; index < values.length; index += 1) {
      statement.run(bind(values[index]));
      // Give the browser time to renew the cross-tab lease during large restores.
      if ((index + 1) % 256 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally { statement.free(); }
}

function requireEmptyLibrary(db: Database): void {
  if (Number(scalar(db, 'SELECT (SELECT COUNT(*) FROM subjects) + (SELECT COUNT(*) FROM notes) + (SELECT COUNT(*) FROM flashcards) + (SELECT COUNT(*) FROM review_logs) + (SELECT COUNT(*) FROM documents) + (SELECT COUNT(*) FROM material_assets) + (SELECT COUNT(*) FROM study_tracks) + (SELECT COUNT(*) FROM study_planners) + (SELECT COUNT(*) FROM error_entries)')) !== 0) {
    throw new Error('A restauração exige uma biblioteca vazia para preservar seus dados atuais.');
  }
}

async function insertBackupSnapshot(db: Database, data: Snapshot): Promise<void> {
  await insertMany(db, 'INSERT INTO subjects(id, name, accent, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', data.subjects, value => [value.id, value.name, value.accent, value.createdAt, value.updatedAt]);
  await insertMany(db, 'INSERT INTO notes(id, subject_id, title, body_json, plain_text, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', data.notes, value => [value.id, value.subjectId, value.title, JSON.stringify(value.bodyJson), value.plainText, value.revision, value.createdAt, value.updatedAt]);
  await insertMany(db, 'INSERT INTO flashcards(id, subject_id, note_id, front, back, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', data.flashcards, value => [value.id, value.subjectId, value.noteId, value.front, value.back, value.createdAt, value.updatedAt]);
  await insertMany(db, 'INSERT INTO review_logs(id, flashcard_id, session_id, rating, reviewed_at) VALUES (?, ?, ?, ?, ?)', data.reviewLogs, value => [value.id, value.flashcardId, value.sessionId, value.rating, value.reviewedAt]);
  await insertMany(db, 'INSERT INTO review_schedules(flashcard_id,last_review_id,data_json) VALUES (?,?,?)', data.reviewSchedules ?? [], value => [value.flashcardId, value.lastReviewId, JSON.stringify(value)]);
  for (const meta of data.cardMetadata ?? []) db.run('INSERT INTO card_metadata VALUES (?,?,?)', [meta.flashcardId, JSON.stringify(meta.tags), JSON.stringify(meta.images)]);
  db.run('UPDATE settings SET value = ? WHERE key = ?', [data.settings.theme, 'theme']);
  await insertMany(db, 'INSERT INTO study_tracks(id,data_json) VALUES (?,?)', data.studyTracks ?? [], value => [value.id, JSON.stringify(value)]);
  await insertMany(db, 'INSERT INTO study_planners(track_id,data_json) VALUES (?,?)', data.studyPlanners ?? [], value => [value.trackId, JSON.stringify(value)]);
  await insertMany(db, 'INSERT INTO error_entries(id,subject_id,data_json) VALUES (?,?,?)', data.errorEntries ?? [], value => [value.id,value.subjectId,JSON.stringify(value)]);
}

export async function createSQLiteStorage(options: SQLiteStorageOptions): Promise<StorageService> {
  const SQL = await options.initializeSqlite();
  const { persistence } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const newId = options.newId ?? (() => crypto.randomUUID());
  const plan = [...COMPILED_MIGRATIONS, ...(options.migrationPlan ?? [])];
  if (plan.some((step, index) => step.version !== index + 1 || !Number.isSafeInteger(step.version) || typeof step.sql !== 'string')) {
    throw new Error('O plano de migração do banco é inválido.');
  }
  const targetVersion = plan.at(-1)!.version;
  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(write: boolean, work: (db: Database) => T | Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new Error('O armazenamento já foi fechado.'));
    const result = queue.then(() => persistence.exclusive(async () => {
      const bytes = await persistence.load();
      const db = new SQL.Database(bytes ?? undefined);
      let inTransaction = false;
      try {
        const version = inspectDatabase(db, targetVersion);
        if (bytes && version < targetVersion) await protectBeforeMigration(persistence, SQL, bytes, version, targetVersion, now());
        const migrated = migrate(db, version, plan);
        if (write) { db.run('BEGIN IMMEDIATE'); inTransaction = true; }
        const value = await work(db);
        if (write) { db.run('COMMIT'); inTransaction = false; }
        // This candidate is never published before durable save succeeds. A failed
        // save discards it, leaving the previously persisted database untouched.
        if (write || migrated) await persistence.save(db.export());
        return value;
      } catch (error) {
        if (inTransaction) db.run('ROLLBACK');
        throw storageError(error);
      } finally { db.close(); }
    })).catch((error) => { throw storageError(error); });
    queue = result.catch(() => undefined);
    return result;
  }

  // Persist and validate the migration immediately, including existing databases.
  await enqueue(false, snapshot);

  function recoveryOperation<T>(action: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new Error('O armazenamento já foi fechado.'));
    const result = queue.then(action).catch(error => { throw storageError(error); });
    queue = result.catch(() => undefined);
    return result;
  }

  return {
    getSnapshot: () => enqueue(false, snapshot),
    saveErrorEntry: input => enqueue(true,db => {
      const value = validate(saveErrorEntrySchema,input);
      const found = value.id ? rows(db,'SELECT data_json FROM error_entries WHERE id=?',[value.id])[0] : undefined;
      const current = found ? validate(errorEntrySchema,JSON.parse(String(found.data_json))) : undefined;
      const entry = buildErrorEntry(current,value,snapshot(db),now(),newId());
      db.run('INSERT INTO error_entries(id,subject_id,data_json) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json', [entry.id,entry.subjectId,JSON.stringify(entry)]);
      return entry;
    }),
    saveStudyPlanner: input => enqueue(true, db => {
      const data = validate(savePlannerSchema, input);
      const found = rows(db, 'SELECT data_json FROM study_planners WHERE track_id=?', [data.trackId])[0];
      const current: StudyPlanner | undefined = found ? validate(plannerSchema, JSON.parse(String(found.data_json))) : undefined;
      if (current ? current.revision !== data.expectedRevision : data.expectedRevision !== undefined) throw new Error('A agenda mudou em outra janela. Recarregue antes de salvar.');
      const timestamp = now();
      const time = current && timestamp < current.updatedAt ? current.updatedAt : timestamp;
      const planner = validate(plannerSchema, { trackId:data.trackId, revision:(current?.revision ?? 0)+1, createdAt:current?.createdAt ?? time, updatedAt:time, config:data.config, weeks:data.weeks, backlog:data.backlog, undo:data.undo });
      validatePlannerLinks(planner, snapshot(db));
      if (current) validatePlannerTransition(current, planner);
      db.run('INSERT INTO study_planners(track_id,data_json) VALUES (?,?) ON CONFLICT(track_id) DO UPDATE SET data_json=excluded.data_json', [planner.trackId,JSON.stringify(planner)]);
      return planner;
    }),
    saveStudyTrack: input => enqueue(true, db => {
      const data = validate(saveStudyTrackSchema, input);
      const found = data.id ? rows(db, 'SELECT data_json FROM study_tracks WHERE id=?', [data.id])[0] : undefined;
      if (data.id && !found) throw new Error('A trilha não foi encontrada. Reabra as trilhas antes de salvar.');
      const current: StudyTrack | undefined = found ? validate(studyTrackSchema, JSON.parse(String(found.data_json))) : undefined;
      if (current && current.revision !== data.expectedRevision) throw new Error('A trilha mudou em outra janela. Reabra as trilhas antes de salvar.');
      if (current && JSON.stringify(current.catalog) !== JSON.stringify(data.catalog)) throw new Error('O catálogo de uma trilha existente não pode ser alterado. Crie outra trilha para usar outra versão.');
      const timestamp = now();
      const time = current && timestamp < current.updatedAt ? current.updatedAt : timestamp;
      const track = validate(studyTrackSchema, { id: current?.id ?? newId(), revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? time, updatedAt: time, catalog: data.catalog, config: data.config, diagnostics: data.diagnostics });
      const library = snapshot(db);
      if (!current && (library.studyTracks?.length ?? 0) >= 100) throw new Error('O limite de 100 trilhas foi atingido.');
      validateStudyLinks(track, library);
      if (current) validateStudyTransition(current, track);
      db.run('INSERT INTO study_tracks(id,data_json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json', [track.id, JSON.stringify(track)]);
      return track;
    }),
    createSubject: (input: SubjectInput) => enqueue(true, (db) => {
      const data = validate(subjectInputSchema, input);
      const id = newId(); const time = now();
      db.run('INSERT INTO subjects(id, name, accent, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, data.name, data.accent, time, time]);
      return subject(required(rows(db, 'SELECT * FROM subjects WHERE id = ?', [id])[0], 'A matéria não foi encontrada.'));
    }),
    updateSubject: (id: string, input: SubjectInput) => enqueue(true, (db) => {
      validate(idSchema, id); const data = validate(subjectInputSchema, input);
      const current = required(rows(db, 'SELECT updated_at FROM subjects WHERE id = ?', [id])[0], 'A matéria não foi encontrada.');
      const time = [now(), String(current.updated_at)].sort()[1];
      db.run('UPDATE subjects SET name = ?, accent = ?, updated_at = ? WHERE id = ?', [data.name, data.accent, time, id]);
      return subject(required(rows(db, 'SELECT * FROM subjects WHERE id = ?', [id])[0], 'A matéria não foi encontrada.'));
    }),
    createNote: (input: NoteInput) => enqueue(true, (db) => {
      const data = validate(noteInputSchema, input);
      const id = newId(); const time = now();
      db.run('INSERT INTO notes(id, subject_id, title, body_json, plain_text, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, data.subjectId, data.title, JSON.stringify(EMPTY_DOCUMENT), '', 1, time, time]);
      return note(required(rows(db, 'SELECT * FROM notes WHERE id = ?', [id])[0], 'A nota não foi encontrada.'));
    }),
    saveNote: (input: SaveNoteInput) => enqueue(true, (db) => {
      const data = validate(saveNoteSchema, input);
      const current = required(rows(db, 'SELECT revision, updated_at FROM notes WHERE id = ?', [data.id])[0], 'A nota não foi encontrada.');
      if (Number(current.revision) !== data.expectedRevision) throw new Error('Esta nota foi alterada em outra janela. Recarregue antes de salvar novamente.');
      const time = [now(), String(current.updated_at)].sort()[1];
      db.run('UPDATE notes SET title = ?, body_json = ?, plain_text = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?', [data.title, JSON.stringify(data.bodyJson), data.plainText, time, data.id, data.expectedRevision]);
      if (db.getRowsModified() !== 1) throw new Error('Esta nota foi alterada em outra janela. Recarregue antes de salvar novamente.');
      return note(required(rows(db, 'SELECT * FROM notes WHERE id = ?', [data.id])[0], 'A nota não foi encontrada.'));
    }),
    createFlashcard: (input: FlashcardInput) => enqueue(true, (db) => {
      const data = validate(flashcardInputSchema, input);
      const id = newId(); const time = now();
      db.run('INSERT INTO flashcards(id, subject_id, note_id, front, back, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, data.subjectId, data.noteId, data.front, data.back, time, time]);
      return card(required(rows(db, 'SELECT * FROM flashcards WHERE id = ?', [id])[0], 'O cartão não foi encontrado.'));
    }),
    updateFlashcard: (input: UpdateFlashcardInput) => enqueue(true, (db) => {
      const data = validate(updateFlashcardSchema, input);
      const current = required(rows(db, 'SELECT updated_at FROM flashcards WHERE id = ?', [data.id])[0], 'O cartão não foi encontrado.');
      const time = [now(), String(current.updated_at)].sort()[1];
      db.run('UPDATE flashcards SET front = ?, back = ?, updated_at = ? WHERE id = ?', [data.front, data.back, time, data.id]);
      return card(required(rows(db, 'SELECT * FROM flashcards WHERE id = ?', [data.id])[0], 'O cartão não foi encontrado.'));
    }),
    recordReview: (input: ReviewInput) => enqueue(true, (db) => {
      const data = validate(reviewInputSchema, input);
      const existing = rows(db, 'SELECT * FROM review_logs WHERE session_id = ? AND flashcard_id = ?', [data.sessionId, data.flashcardId])[0];
      if (existing) return review(existing);
      const id = newId();
      db.run('INSERT INTO review_logs(id, flashcard_id, session_id, rating, reviewed_at) VALUES (?, ?, ?, ?, ?)', [id, data.flashcardId, data.sessionId, data.rating, now()]);
      const log = review(required(rows(db, 'SELECT * FROM review_logs WHERE id = ?', [id])[0], 'A revisão não foi encontrada.'));
      if (data.admission && (log.reviewedAt < data.admission.dayStart || log.reviewedAt >= data.admission.dayEnd)) throw new Error('O dia da revisão mudou. Atualize a fila antes de continuar.');
      if (data.schedule) {
        const found = rows(db, 'SELECT data_json FROM review_schedules WHERE flashcard_id=?', [data.flashcardId])[0];
        const current: ReviewSchedule | undefined = found ? validateSchedule(JSON.parse(String(found.data_json))) : undefined;
        if (!current && data.admission) {
          const { dayStart, dayEnd, newCardLimit } = data.admission;
          const count = Number(rows(db, "SELECT COUNT(*) AS total FROM review_schedules WHERE json_extract(data_json,'$.introducedAt')>=? AND json_extract(data_json,'$.introducedAt')<?", [dayStart, dayEnd])[0].total);
          if (count >= newCardLimit) throw new Error('O limite de novos cartões de hoje foi atingido. Atualize a fila para continuar com os cartões devidos.');
        }
        const next = advanceSchedule(current, log);
        db.run('INSERT INTO review_schedules(flashcard_id,last_review_id,data_json) VALUES (?,?,?) ON CONFLICT(flashcard_id) DO UPDATE SET last_review_id=excluded.last_review_id,data_json=excluded.data_json', [next.flashcardId, next.lastReviewId, JSON.stringify(next)]);
      }
      return log;
    }),
    setTheme: (theme: Theme) => enqueue(true, (db) => {
      validate(themeSchema, theme);
      db.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['theme', theme]);
    }),
    importBatch: (input) => enqueue(true, db=>importSQLiteBatch(db,input,now(),newId)),
    getDocument: (id) => enqueue(false, db=>{validate(idSchema,id);return storedDocument(db,id);}),
    getAsset: (hash) => enqueue(false, db=>storedAsset(db,hash)),
    listRecoveryCopies: () => recoveryOperation(() => persistence.exclusive(() => listRecoveryMetadata(persistence))),
    exportRecoveryCopy: id => recoveryOperation(() => exportRecoveryArchive(persistence, () => Promise.resolve(SQL), id)),
    exportBackupArchive: () => enqueue(false, async db => {
      const data = snapshot(db);
      const manifest: BackupArchiveManifest = {
        format: 'studyspace-backup', version: data.errorEntries?.length ? 7 : data.reviewSchedules?.length ? 6 : data.studyPlanners?.length ? 5 : data.studyTracks?.length ? 4 : 3, exportedAt: now(), data,
        materials: {
          documents: rows(db, 'SELECT id,length(file_bytes) AS bytes,pages_json FROM documents ORDER BY created_at,id').map(row => ({ documentId: String(row.id), byteLength: Number(row.bytes), pages: JSON.parse(String(row.pages_json)) })),
          assets: rows(db, 'SELECT sha256,file_name,mime_type,length(file_bytes) AS bytes FROM material_assets ORDER BY sha256').map(row => ({ sha256: String(row.sha256), fileName: String(row.file_name), mimeType: String(row.mime_type), byteLength: Number(row.bytes) })),
        },
      };
      const descriptors = materialDescriptors(manifest);
      // The exclusive adapter lease and this same DB image cover the entire export.
      return createBackupArchive(manifest, async index => {
        const item = descriptors[index];
        const row = required(rows(db, item.kind === 'document' ? 'SELECT file_bytes FROM documents WHERE id=?' : 'SELECT file_bytes FROM material_assets WHERE sha256=?', [item.id])[0], 'O material do backup está ausente.');
        return row.file_bytes as Uint8Array;
      });
    }),
    restoreBackupArchive: archive => enqueue(true, async db => {
      const manifest = validateArchiveManifest(archive.manifest);
      requireEmptyLibrary(db);
      await insertBackupSnapshot(db, manifest.data);
      const descriptors = materialDescriptors(manifest);
      const documents = new Map((manifest.data.documents ?? []).map(doc => [doc.id, doc]));
      for (let index = 0; index < descriptors.length; index++) {
        const item = descriptors[index];
        const bytes = await archive.readMaterial(index);
        await verifyMaterial(bytes, item);
        if (item.kind === 'document') {
          const doc = documents.get(item.id)!;
          const pages = manifest.materials.documents[index].pages;
          db.run('INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?,?)', [doc.id, doc.subjectId, doc.noteId, doc.fileName, doc.kind, doc.mimeType, doc.sha256, doc.pageCount, JSON.stringify(pages), bytes, doc.createdAt]);
        } else {
          const asset = manifest.materials.assets[index - manifest.materials.documents.length];
          validateAssetContent(bytes, asset.mimeType);
          db.run('INSERT INTO material_assets VALUES (?,?,?,?)', [asset.sha256, asset.fileName, asset.mimeType, bytes]);
        }
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }),
    exportBackup: () => enqueue(false, (db): BackupDocument => validateBackup({ format: 'studyspace-backup', version: 2, exportedAt: now(), data: snapshot(db), materials:backupMaterials(db) })),
    restoreBackup: (backup: unknown) => enqueue(true, async (db) => {
      const validated = validateBackup(backup), data = validated.data;
      requireEmptyLibrary(db);
      await insertBackupSnapshot(db, data);
      for(const asset of validated.materials?.assets??[]) await insertAsset(db,asset);
      for(const doc of data.documents??[]){
        const payload=validated.materials!.documents.find(d=>d.documentId===doc.id)!;
        const bytes=await decodeMaterial(payload.dataBase64,doc.sha256);
        if(payload.pages.length!==doc.pageCount) throw new Error('As páginas do documento são inconsistentes.');
        db.run('INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?,?)',[doc.id,doc.subjectId,doc.noteId,doc.fileName,doc.kind,doc.mimeType,doc.sha256,doc.pageCount,JSON.stringify(payload.pages),bytes,doc.createdAt]);
      }
    }),
    close: async () => {
      if (closed) return;
      closed = true;
      await queue;
      await persistence.close?.();
    },
  };
}

/** Opens a verified copy in isolated memory. Never substitutes the active SQLite key. */
export async function exportRecoveryArchive(persistence: PersistenceAdapter, initializeSqlite: () => Promise<SqlJsStatic>, id: string): Promise<Blob> {
  validate(recoveryIdSchema, id);
  const SQL = await initializeSqlite();
  const record = await persistence.exclusive(async () => {
    const found = await persistence.loadRecovery(id);
    if (!found || parseRecoveryMetadata(found.metadata).id !== id) throw new Error('A cópia de recuperação não foi encontrada.');
    return verifyRecoveryRecord(found, SQL);
  });
  const isolated = await createSQLiteStorage({ persistence: new MemoryPersistence(record.bytes), initializeSqlite: () => Promise.resolve(SQL) });
  try { return await isolated.exportBackupArchive(); }
  finally { await isolated.close(); }
}
