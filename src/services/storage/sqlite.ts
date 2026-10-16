import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import migration from '../../../db/migrations/001_initial.sql?raw';
import materialsMigration from '../../../db/migrations/002_materials.sql?raw';
import { documentMetadata, cardMetadata, storedDocument, storedAsset, backupMaterials, decodeMaterial, insertAsset, importSQLiteBatch } from './materials';
import { EMPTY_DOCUMENT } from '../../shared/types';
import type {
  BackupDocument, Flashcard, FlashcardInput, Note, NoteInput, ReviewInput, ReviewLog,
  SaveNoteInput, Snapshot, StorageService, Subject, SubjectInput, Theme, UpdateFlashcardInput,
} from '../../shared/types';
import type { PersistenceAdapter } from './persistence';
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

function migrate(db: Database): boolean {
  db.run('PRAGMA foreign_keys = ON');
  const version = Number(scalar(db, 'PRAGMA user_version'));
  if (version > 2) throw new Error('Este banco foi criado por uma versão mais nova do StudySpace. Atualize o aplicativo.');
  if (scalar(db, 'PRAGMA quick_check') !== 'ok') throw new Error('O banco local está corrompido. Preserve uma cópia antes de restaurar um backup.');
  if (version === 0) {
    db.run('BEGIN IMMEDIATE');
    try { db.exec(migration); db.run('COMMIT'); }
    catch (error) { db.run('ROLLBACK'); throw error; }
  }
  if (version < 2) {
    db.run('BEGIN IMMEDIATE');
    try { db.exec(materialsMigration); db.run('COMMIT'); }
    catch (error) { db.run('ROLLBACK'); throw error; }
  }
  if (rows(db, 'PRAGMA foreign_key_check').length) throw new Error('O banco local contém vínculos inválidos.');
  return version < 2;
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
  return validateSnapshot({
    subjects: rows(db, 'SELECT * FROM subjects ORDER BY created_at, id').map(subject),
    notes: rows(db, 'SELECT * FROM notes ORDER BY created_at, id').map(note),
    flashcards: rows(db, 'SELECT * FROM flashcards ORDER BY created_at, id').map(card),
    reviewLogs: rows(db, 'SELECT * FROM review_logs ORDER BY reviewed_at, id').map(review),
    settings: { theme: rows(db, 'SELECT value FROM settings WHERE key = ?', ['theme'])[0]?.value },
    documents: documentMetadata(db), cardMetadata: cardMetadata(db),
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

export async function createSQLiteStorage(options: SQLiteStorageOptions): Promise<StorageService> {
  const SQL = await options.initializeSqlite();
  const { persistence } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const newId = options.newId ?? (() => crypto.randomUUID());
  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(write: boolean, work: (db: Database) => T | Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new Error('O armazenamento já foi fechado.'));
    const result = queue.then(() => persistence.exclusive(async () => {
      const bytes = await persistence.load();
      const db = new SQL.Database(bytes ?? undefined);
      let inTransaction = false;
      try {
        const migrated = migrate(db);
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

  return {
    getSnapshot: () => enqueue(false, snapshot),
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
      return review(required(rows(db, 'SELECT * FROM review_logs WHERE id = ?', [id])[0], 'A revisão não foi encontrada.'));
    }),
    setTheme: (theme: Theme) => enqueue(true, (db) => {
      validate(themeSchema, theme);
      db.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['theme', theme]);
    }),
    importBatch: (input) => enqueue(true, db=>importSQLiteBatch(db,input,now(),newId)),
    getDocument: (id) => enqueue(false, db=>{validate(idSchema,id);return storedDocument(db,id);}),
    getAsset: (hash) => enqueue(false, db=>storedAsset(db,hash)),
    exportBackup: () => enqueue(false, (db): BackupDocument => validateBackup({ format: 'studyspace-backup', version: 2, exportedAt: now(), data: snapshot(db), materials:backupMaterials(db) })),
    restoreBackup: (backup: unknown) => enqueue(true, async (db) => {
      const validated = validateBackup(backup), data = validated.data;
      if (Number(scalar(db, 'SELECT (SELECT COUNT(*) FROM subjects) + (SELECT COUNT(*) FROM notes) + (SELECT COUNT(*) FROM flashcards) + (SELECT COUNT(*) FROM review_logs)')) !== 0) {
        throw new Error('A restauração exige uma biblioteca vazia para preservar seus dados atuais.');
      }
      await insertMany(db, 'INSERT INTO subjects(id, name, accent, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', data.subjects, (value) => [value.id, value.name, value.accent, value.createdAt, value.updatedAt]);
      await insertMany(db, 'INSERT INTO notes(id, subject_id, title, body_json, plain_text, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', data.notes, (value) => [value.id, value.subjectId, value.title, JSON.stringify(value.bodyJson), value.plainText, value.revision, value.createdAt, value.updatedAt]);
      await insertMany(db, 'INSERT INTO flashcards(id, subject_id, note_id, front, back, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', data.flashcards, (value) => [value.id, value.subjectId, value.noteId, value.front, value.back, value.createdAt, value.updatedAt]);
      await insertMany(db, 'INSERT INTO review_logs(id, flashcard_id, session_id, rating, reviewed_at) VALUES (?, ?, ?, ?, ?)', data.reviewLogs, (value) => [value.id, value.flashcardId, value.sessionId, value.rating, value.reviewedAt]);
      for(const asset of validated.materials?.assets??[]) await insertAsset(db,asset);
      for(const doc of data.documents??[]){
        const payload=validated.materials!.documents.find(d=>d.documentId===doc.id)!;
        const bytes=await decodeMaterial(payload.dataBase64,doc.sha256);
        if(payload.pages.length!==doc.pageCount) throw new Error('As páginas do documento são inconsistentes.');
        db.run('INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?,?)',[doc.id,doc.subjectId,doc.noteId,doc.fileName,doc.kind,doc.mimeType,doc.sha256,doc.pageCount,JSON.stringify(payload.pages),bytes,doc.createdAt]);
      }
      for(const meta of data.cardMetadata??[]) db.run('INSERT INTO card_metadata VALUES (?,?,?)',[meta.flashcardId,JSON.stringify(meta.tags),JSON.stringify(meta.images)]);
      db.run('UPDATE settings SET value = ? WHERE key = ?', [data.settings.theme, 'theme']);
    }),
    close: async () => {
      if (closed) return;
      closed = true;
      await queue;
      await persistence.close?.();
    },
  };
}
