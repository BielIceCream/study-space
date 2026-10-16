use crate::error::{StoreError, StoreResult};
use crate::models::*;
use crate::validation;
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row, TransactionBehavior};
use serde::de::DeserializeOwned;
use std::path::Path;
use std::time::Duration;
use uuid::Uuid;

const SCHEMA_VERSION: i32 = 2;
const MIGRATIONS: &[(i32, &str)] = &[(1, include_str!("../../db/migrations/001_initial.sql")),(2,include_str!("../../db/migrations/002_materials.sql"))];

pub fn open(path: &Path) -> StoreResult<Connection> {
    let mut connection = Connection::open(path)?;
    schema_version(&connection)?;
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    let _: String = connection.query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))?;
    connection.pragma_update(None, "synchronous", "FULL")?;
    migrate(&mut connection)?;
    check_integrity(&connection)?;
    Ok(connection)
}

pub fn migrate(connection: &mut Connection) -> StoreResult<()> {
    let version = schema_version(connection)?;
    for &(next_version, sql) in MIGRATIONS {
        if next_version > version {
            let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute_batch(sql)?;
            transaction.pragma_update(None, "user_version", next_version)?;
            transaction.commit()?;
        }
    }
    Ok(())
}

fn schema_version(connection: &Connection) -> StoreResult<i32> {
    let version: i32 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version > SCHEMA_VERSION {
        return Err(StoreError::Invalid("Este banco foi criado por uma versão mais recente do StudySpace. Atualize o aplicativo para abri-lo.".into()));
    }
    if version < 0 {
        return Err(StoreError::Invalid("A versão do banco local é inválida. Guarde uma cópia da pasta de dados antes de tentar recuperá-lo.".into()));
    }
    Ok(version)
}

fn check_integrity(connection: &Connection) -> StoreResult<()> {
    let result: String = connection.query_row("PRAGMA quick_check(1)", [], |row| row.get(0))?;
    if result != "ok" {
        return Err(StoreError::Invalid("O banco local apresentou um problema de integridade. Guarde uma cópia da pasta de dados antes de tentar recuperá-lo.".into()));
    }
    let mut statement = connection.prepare("PRAGMA foreign_key_check")?;
    if statement.query([])?.next()?.is_some() {
        return Err(StoreError::Invalid("O banco local contém vínculos inválidos. Guarde uma cópia da pasta de dados antes de tentar recuperá-lo.".into()));
    }
    Ok(())
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn updated_at(previous: &str) -> String {
    let current = now();
    if current.as_str() < previous { previous.to_owned() } else { current }
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

fn enum_column<T: DeserializeOwned>(row: &Row<'_>, column: usize) -> rusqlite::Result<T> {
    let value: String = row.get(column)?;
    serde_json::from_value(serde_json::Value::String(value)).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(column, rusqlite::types::Type::Text, Box::new(error))
    })
}

fn subject_row(row: &Row<'_>) -> rusqlite::Result<Subject> {
    Ok(Subject {
        id: row.get(0)?, name: row.get(1)?, accent: enum_column(row, 2)?,
        created_at: row.get(3)?, updated_at: row.get(4)?,
    })
}

fn note_row(row: &Row<'_>) -> rusqlite::Result<Note> {
    let json: String = row.get(3)?;
    let body_json = serde_json::from_str(&json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(Note {
        id: row.get(0)?, subject_id: row.get(1)?, title: row.get(2)?, body_json,
        plain_text: row.get(4)?, revision: row.get(5)?, created_at: row.get(6)?, updated_at: row.get(7)?,
    })
}

fn flashcard_row(row: &Row<'_>) -> rusqlite::Result<Flashcard> {
    Ok(Flashcard {
        id: row.get(0)?, subject_id: row.get(1)?, note_id: row.get(2)?,
        front: row.get(3)?, back: row.get(4)?, created_at: row.get(5)?, updated_at: row.get(6)?,
    })
}

fn review_row(row: &Row<'_>) -> rusqlite::Result<ReviewLog> {
    Ok(ReviewLog {
        id: row.get(0)?, flashcard_id: row.get(1)?, session_id: row.get(2)?,
        rating: row.get(3)?, reviewed_at: row.get(4)?,
    })
}

fn subject(connection: &Connection, id: &str) -> StoreResult<Subject> {
    connection.query_row(
        "SELECT id, name, accent, created_at, updated_at FROM subjects WHERE id = ?1",
        [id], subject_row,
    ).optional()?.ok_or(StoreError::NotFound("A matéria"))
}

fn note(connection: &Connection, id: &str) -> StoreResult<Note> {
    connection.query_row(
        "SELECT id, subject_id, title, body_json, plain_text, revision, created_at, updated_at FROM notes WHERE id = ?1",
        [id], note_row,
    ).optional()?.ok_or(StoreError::NotFound("A nota"))
}

fn flashcard(connection: &Connection, id: &str) -> StoreResult<Flashcard> {
    connection.query_row(
        "SELECT id, subject_id, note_id, front, back, created_at, updated_at FROM flashcards WHERE id = ?1",
        [id], flashcard_row,
    ).optional()?.ok_or(StoreError::NotFound("O cartão"))
}

fn query_all<T>(connection: &Connection, sql: &str, map: fn(&Row<'_>) -> rusqlite::Result<T>) -> StoreResult<Vec<T>> {
    let mut statement = connection.prepare(sql)?;
    let rows = statement.query_map([], map)?.collect::<rusqlite::Result<Vec<T>>>()?;
    Ok(rows)
}

fn snapshot(connection: &Connection) -> StoreResult<Snapshot> {
    let subjects = query_all(connection, "SELECT id, name, accent, created_at, updated_at FROM subjects ORDER BY created_at, id", subject_row)?;
    let notes = query_all(connection, "SELECT id, subject_id, title, body_json, plain_text, revision, created_at, updated_at FROM notes ORDER BY created_at, id", note_row)?;
    let flashcards = query_all(connection, "SELECT id, subject_id, note_id, front, back, created_at, updated_at FROM flashcards ORDER BY created_at, id", flashcard_row)?;
    let review_logs = query_all(connection, "SELECT id, flashcard_id, session_id, rating, reviewed_at FROM review_logs ORDER BY reviewed_at, id", review_row)?;
    let theme = connection.query_row("SELECT value FROM settings WHERE key = 'theme'", [], |row| enum_column(row, 0)).optional()?.unwrap_or(Theme::Light);
    Ok(Snapshot { subjects, notes, flashcards, review_logs, settings: Settings { theme }, documents:crate::materials::metadata(connection)?,card_metadata:crate::materials::card_metadata(connection)? })
}

pub fn get_snapshot(connection: &mut Connection) -> StoreResult<Snapshot> {
    let transaction = connection.transaction()?;
    let data = snapshot(&transaction)?;
    transaction.commit()?;
    Ok(data)
}

fn insert_subject(connection: &Connection, subject: &Subject) -> StoreResult<()> {
    connection.execute(
        "INSERT INTO subjects (id, name, accent, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![subject.id, subject.name, subject.accent.as_str(), subject.created_at, subject.updated_at],
    )?;
    Ok(())
}

fn insert_note(connection: &Connection, note: &Note) -> StoreResult<()> {
    let body = serde_json::to_string(&note.body_json)?;
    connection.execute(
        "INSERT INTO notes (id, subject_id, title, body_json, plain_text, revision, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![note.id, note.subject_id, note.title, body, note.plain_text, note.revision, note.created_at, note.updated_at],
    )?;
    Ok(())
}

fn insert_flashcard(connection: &Connection, card: &Flashcard) -> StoreResult<()> {
    connection.execute(
        "INSERT INTO flashcards (id, subject_id, note_id, front, back, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![card.id, card.subject_id, card.note_id, card.front, card.back, card.created_at, card.updated_at],
    )?;
    Ok(())
}

fn insert_review(connection: &Connection, review: &ReviewLog) -> StoreResult<()> {
    connection.execute(
        "INSERT INTO review_logs (id, flashcard_id, session_id, rating, reviewed_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![review.id, review.flashcard_id, review.session_id, review.rating, review.reviewed_at],
    )?;
    Ok(())
}

pub fn create_subject(connection: &mut Connection, input: SubjectInput) -> StoreResult<Subject> {
    let name = input.name.trim().to_owned();
    validation::text(&name, 120, "O nome da matéria", false)?;
    let timestamp = now();
    let subject = Subject { id: new_id(), name, accent: input.accent, created_at: timestamp.clone(), updated_at: timestamp };
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    insert_subject(&transaction, &subject)?;
    transaction.commit()?;
    Ok(subject)
}

pub fn update_subject(connection: &mut Connection, id: &str, input: SubjectInput) -> StoreResult<Subject> {
    validation::id(id)?;
    let name = input.name.trim().to_owned();
    validation::text(&name, 120, "O nome da matéria", false)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let old = subject(&transaction, id)?;
    let updated_at = updated_at(&old.updated_at);
    transaction.execute("UPDATE subjects SET name = ?1, accent = ?2, updated_at = ?3 WHERE id = ?4", params![name, input.accent.as_str(), updated_at, id])?;
    let changed = subject(&transaction, id)?;
    transaction.commit()?;
    Ok(changed)
}

pub fn create_note(connection: &mut Connection, input: NoteInput) -> StoreResult<Note> {
    validation::id(&input.subject_id)?;
    let title = input.title.trim().to_owned();
    validation::text(&title, 180, "O título da nota", false)?;
    let timestamp = now();
    let note = Note {
        id: new_id(), subject_id: input.subject_id, title,
        body_json: serde_json::json!({ "type": "doc", "content": [{ "type": "paragraph" }] }),
        plain_text: String::new(), revision: 1, created_at: timestamp.clone(), updated_at: timestamp,
    };
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    subject(&transaction, &note.subject_id)?;
    insert_note(&transaction, &note)?;
    transaction.commit()?;
    Ok(note)
}

pub fn save_note(connection: &mut Connection, input: SaveNoteInput) -> StoreResult<Note> {
    validation::id(&input.id)?;
    validation::revision(input.expected_revision)?;
    if input.expected_revision == validation::MAX_SAFE_INTEGER {
        return Err(StoreError::Invalid("A nota atingiu o limite de revisões permitido.".into()));
    }
    let title = input.title.trim().to_owned();
    validation::text(&title, 180, "O título da nota", false)?;
    validation::text(&input.plain_text, 2_000_000, "O texto da nota", true)?;
    validation::document(&input.body_json)?;
    let body = serde_json::to_string(&input.body_json)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let previous = note(&transaction, &input.id)?;
    let timestamp = updated_at(&previous.updated_at);
    let changed = transaction.execute(
        "UPDATE notes SET title = ?1, body_json = ?2, plain_text = ?3, revision = revision + 1, updated_at = ?4 WHERE id = ?5 AND revision = ?6",
        params![title, body, input.plain_text, timestamp, input.id, input.expected_revision],
    )?;
    if changed != 1 {
        return Err(StoreError::Conflict);
    }
    let saved = note(&transaction, &input.id)?;
    transaction.commit()?;
    Ok(saved)
}

pub fn create_flashcard(connection: &mut Connection, input: FlashcardInput) -> StoreResult<Flashcard> {
    validation::id(&input.subject_id)?;
    let front = input.front.trim().to_owned();
    let back = input.back.trim().to_owned();
    validation::text(&front, 20_000, "A pergunta do cartão", false)?;
    validation::text(&back, 20_000, "A resposta do cartão", false)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    subject(&transaction, &input.subject_id)?;
    if let Some(note_id) = &input.note_id {
        validation::id(note_id)?;
        let source = note(&transaction, note_id)?;
        if source.subject_id != input.subject_id {
            return Err(StoreError::Invalid("O cartão e a nota devem pertencer à mesma matéria.".into()));
        }
    }
    let timestamp = now();
    let card = Flashcard {
        id: new_id(), subject_id: input.subject_id, note_id: input.note_id,
        front, back, created_at: timestamp.clone(), updated_at: timestamp,
    };
    insert_flashcard(&transaction, &card)?;
    transaction.commit()?;
    Ok(card)
}

pub fn update_flashcard(connection: &mut Connection, input: UpdateFlashcardInput) -> StoreResult<Flashcard> {
    validation::id(&input.id)?;
    let front = input.front.trim().to_owned();
    let back = input.back.trim().to_owned();
    validation::text(&front, 20_000, "A pergunta do cartão", false)?;
    validation::text(&back, 20_000, "A resposta do cartão", false)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let previous = flashcard(&transaction, &input.id)?;
    let timestamp = updated_at(&previous.updated_at);
    transaction.execute("UPDATE flashcards SET front = ?1, back = ?2, updated_at = ?3 WHERE id = ?4", params![front, back, timestamp, input.id])?;
    let saved = flashcard(&transaction, &input.id)?;
    transaction.commit()?;
    Ok(saved)
}

pub fn record_review(connection: &mut Connection, input: ReviewInput) -> StoreResult<ReviewLog> {
    validation::id(&input.flashcard_id)?;
    validation::text(&input.session_id, 160, "A sessão de revisão", false)?;
    validation::rating(input.rating)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    flashcard(&transaction, &input.flashcard_id)?;
    let existing = transaction.query_row(
        "SELECT id, flashcard_id, session_id, rating, reviewed_at FROM review_logs WHERE session_id = ?1 AND flashcard_id = ?2",
        params![input.session_id, input.flashcard_id], review_row,
    ).optional()?;
    if let Some(review) = existing {
        transaction.commit()?;
        return Ok(review);
    }
    let review = ReviewLog { id: new_id(), flashcard_id: input.flashcard_id, session_id: input.session_id, rating: input.rating, reviewed_at: now() };
    insert_review(&transaction, &review)?;
    transaction.commit()?;
    Ok(review)
}

pub fn set_theme(connection: &mut Connection, theme: Theme) -> StoreResult<()> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    transaction.execute("INSERT INTO settings (key, value) VALUES ('theme', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [theme.as_str()])?;
    transaction.commit()?;
    Ok(())
}

pub fn export_backup(connection: &mut Connection) -> StoreResult<BackupDocument> {
    let transaction = connection.transaction()?;
    let backup = BackupDocument { format: "studyspace-backup".into(), version: 2, exported_at: now(), data: snapshot(&transaction)?, materials:Some(crate::materials::export_materials(&transaction)?) };
    validation::backup(&backup)?;
    transaction.commit()?;
    Ok(backup)
}

pub fn restore_backup(connection: &mut Connection, backup: BackupDocument) -> StoreResult<()> {
    validation::backup(&backup)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let populated: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM subjects) OR EXISTS(SELECT 1 FROM notes) OR EXISTS(SELECT 1 FROM flashcards) OR EXISTS(SELECT 1 FROM review_logs)",
        [], |row| row.get(0),
    )?;
    if populated {
        return Err(StoreError::Invalid("A restauração só está disponível em uma biblioteca vazia. Seus dados atuais foram preservados.".into()));
    }
    for subject in &backup.data.subjects { insert_subject(&transaction, subject)?; }
    for note in &backup.data.notes { insert_note(&transaction, note)?; }
    for card in &backup.data.flashcards { insert_flashcard(&transaction, card)?; }
    for review in &backup.data.review_logs { insert_review(&transaction, review)?; }
    crate::materials::restore_materials(&transaction,&backup)?;
    transaction.execute(
        "INSERT INTO settings (key, value) VALUES ('theme', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [backup.data.settings.theme.as_str()],
    )?;
    transaction.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests;
