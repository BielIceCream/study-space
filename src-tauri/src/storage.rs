use crate::error::{StoreError, StoreResult};
use crate::models::*;
use crate::validation;
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row, TransactionBehavior};
use serde::de::DeserializeOwned;
use std::path::Path;
use std::time::Duration;
use uuid::Uuid;

pub(crate) const SCHEMA_VERSION: i32 = 6;
const MIGRATIONS: &[(i32, &str)] = &[(1, include_str!("../../db/migrations/001_initial.sql")),(2,include_str!("../../db/migrations/002_materials.sql")),(3,include_str!("../../db/migrations/003_study_tracks.sql")),(4,include_str!("../../db/migrations/004_study_planners.sql")),(5,include_str!("../../db/migrations/005_review_schedules.sql")),(6,include_str!("../../db/migrations/006_error_entries.sql"))];

pub fn open(path: &Path) -> StoreResult<Connection> {
    let mut connection = Connection::open(path)?;
    schema_version(&connection)?;
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.pragma_update(None, "synchronous", "FULL")?;
    migrate(&mut connection)?;
    check_integrity(&connection)?;
    let _: String = connection.query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))?;
    Ok(connection)
}

pub fn migrate(connection: &mut Connection) -> StoreResult<()> {
    migrate_plan(connection, MIGRATIONS, SCHEMA_VERSION)
}

// One read snapshot covers both the recovery copy and every pending migration.
// In WAL mode, another writer invalidates the later write upgrade (BUSY_SNAPSHOT)
// rather than allowing a migration against data newer than the recovery copy.
pub(crate) fn migrate_plan(connection: &mut Connection, plan: &[(i32, &str)], target: i32) -> StoreResult<()> {
    let version = schema_version(connection)?;
    if version >= target { return Ok(()); }
    let recovery_directory = crate::recovery::directory(connection);
    let transaction = connection.transaction()?;
    let version = schema_version(&transaction)?; // Establish the consistent source snapshot.
    if version >= target { return Ok(()); }
    check_integrity(&transaction)?;
    check_readable(&transaction, version)?;
    if let Some(directory) = recovery_directory {
        let exists: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%')", [], |row| row.get(0))?;
        if exists { crate::recovery::create_copy(&transaction, &directory, version, target)?; }
    }
    for &(next_version, sql) in plan {
        if next_version > version && next_version <= target {
            transaction.execute_batch(sql)?;
            transaction.pragma_update(None, "user_version", next_version)?;
        }
    }
    let actual: i32 = transaction.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if actual != target { return Err(StoreError::Invalid("O plano de atualização do banco está incompleto.".into())); }
    check_integrity(&transaction)?;
    check_readable(&transaction, actual)?;
    transaction.commit()?;
    Ok(())
}

pub(crate) fn schema_version(connection: &Connection) -> StoreResult<i32> {
    let version: i32 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version > SCHEMA_VERSION {
        return Err(StoreError::Invalid("Este banco foi criado por uma versão mais recente do StudySpace. Atualize o aplicativo para abri-lo.".into()));
    }
    if version < 0 {
        return Err(StoreError::Invalid("A versão do banco local é inválida. Guarde uma cópia da pasta de dados antes de tentar recuperá-lo.".into()));
    }
    Ok(version)
}

pub(crate) fn check_integrity(connection: &Connection) -> StoreResult<()> {
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

pub(crate) fn check_readable(connection: &Connection, version: i32) -> StoreResult<()> {
    if version == 0 { return Ok(()); }
    let data = snapshot_at_version(connection, version)?;
    validation::snapshot(&data)?;
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

pub(crate) fn snapshot(connection: &Connection) -> StoreResult<Snapshot> {
    snapshot_at_version(connection, SCHEMA_VERSION)
}

fn snapshot_at_version(connection: &Connection, version: i32) -> StoreResult<Snapshot> {
    let subjects = query_all(connection, "SELECT id, name, accent, created_at, updated_at FROM subjects ORDER BY created_at, id", subject_row)?;
    let notes = query_all(connection, "SELECT id, subject_id, title, body_json, plain_text, revision, created_at, updated_at FROM notes ORDER BY created_at, id", note_row)?;
    let flashcards = query_all(connection, "SELECT id, subject_id, note_id, front, back, created_at, updated_at FROM flashcards ORDER BY created_at, id", flashcard_row)?;
    let review_logs = query_all(connection, "SELECT id, flashcard_id, session_id, rating, reviewed_at FROM review_logs ORDER BY reviewed_at, id", review_row)?;
    let theme = connection.query_row("SELECT value FROM settings WHERE key = 'theme'", [], |row| enum_column(row, 0)).optional()?.unwrap_or(Theme::Light);
    let study_tracks = if version >= 3 {
        let mut statement = connection.prepare("SELECT id,data_json FROM study_tracks ORDER BY json_extract(data_json,'$.createdAt'),id")?;
        let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
        let mut tracks = Vec::new();
        for row in rows {
            let (id, json) = row?;
            let track: crate::study::StudyTrack = serde_json::from_str(&json)?;
            if track.id != id { return Err(StoreError::Invalid("A trilha contém um identificador inconsistente no banco local.".into())); }
            tracks.push(track);
        }
        tracks
    } else { Vec::new() };
    let study_planners = if version >= 4 {
        let mut statement = connection.prepare("SELECT track_id,data_json FROM study_planners ORDER BY track_id")?;
        let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?,row.get::<_, String>(1)?)))?;
        let mut planners = Vec::new();
        for row in rows {
            let (track_id,json)=row?;
            let planner: crate::planner::StudyPlanner=serde_json::from_str(&json)?;
            if planner.track_id!=track_id { return Err(StoreError::Invalid("A agenda contém uma trilha inconsistente no banco local.".into())); }
            planners.push(planner);
        }
        planners
    } else { Vec::new() };
    let review_schedules = if version >= 5 {
        let mut statement = connection.prepare("SELECT flashcard_id,last_review_id,data_json FROM review_schedules ORDER BY flashcard_id")?;
        let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)))?;
        let mut schedules = Vec::new();
        for row in rows {
            let (card_id,review_id,json) = row?;
            let schedule: crate::review_schedule::ReviewSchedule = serde_json::from_str(&json)?;
            if schedule.flashcard_id != card_id || schedule.last_review_id != review_id {
                return Err(StoreError::Invalid("A agenda de revisão contém identificadores inconsistentes no banco local.".into()));
            }
            schedules.push(schedule);
        }
        schedules
    } else { Vec::new() };
    let error_entries = if version >= 6 {
        let mut statement = connection.prepare("SELECT id,subject_id,data_json FROM error_entries ORDER BY json_extract(data_json,'$.createdAt'),id")?;
        let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)))?;
        let mut entries = Vec::new();
        for row in rows {
            let (id,subject_id,json) = row?;
            let entry: crate::error_notebook::ErrorEntry = serde_json::from_str(&json)?;
            if entry.id != id || entry.subject_id != subject_id {
                return Err(StoreError::Invalid("O caderno de erros contém identificadores inconsistentes no banco local.".into()));
            }
            entries.push(entry);
        }
        entries
    } else { Vec::new() };
    Ok(Snapshot { subjects, notes, flashcards, review_logs, settings: Settings { theme }, documents: if version >= 2 { crate::materials::metadata(connection)? } else { Vec::new() }, card_metadata: if version >= 2 { crate::materials::card_metadata(connection)? } else { Vec::new() }, study_tracks, study_planners, review_schedules, error_entries })
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

fn validate_review_admission(admission: &ReviewAdmission, reviewed_at: &str) -> StoreResult<()> {
    validation::date(&admission.day_start)?;
    validation::date(&admission.day_end)?;
    let start = chrono::DateTime::parse_from_rfc3339(&admission.day_start)
        .map_err(|_| StoreError::Invalid("O início do dia de revisão é inválido.".into()))?;
    let end = chrono::DateTime::parse_from_rfc3339(&admission.day_end)
        .map_err(|_| StoreError::Invalid("O fim do dia de revisão é inválido.".into()))?;
    let duration = end.signed_duration_since(start);
    if admission.new_card_limit > 50 || duration <= chrono::Duration::zero() || duration > chrono::Duration::hours(48) {
        return Err(StoreError::Invalid("A cota de novos cartões ou o período de revisão é inválido.".into()));
    }
    if reviewed_at < admission.day_start.as_str() || reviewed_at >= admission.day_end.as_str() {
        return Err(StoreError::Invalid("O dia de revisão mudou. Atualize a agenda antes de avaliar o cartão.".into()));
    }
    Ok(())
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
    if let Some(admission) = &input.admission {
        if !input.schedule {
            return Err(StoreError::Invalid("A cota diária só se aplica à revisão espaçada.".into()));
        }
        validate_review_admission(admission, &review.reviewed_at)?;
    }
    insert_review(&transaction, &review)?;
    if input.schedule {
        let json: Option<String> = transaction.query_row("SELECT data_json FROM review_schedules WHERE flashcard_id=?1", [&review.flashcard_id], |row| row.get(0)).optional()?;
        let previous: Option<crate::review_schedule::ReviewSchedule> = json.map(|value| serde_json::from_str(&value)).transpose()?;
        if previous.is_none() {
            if let Some(admission) = &input.admission {
                let introduced: u32 = transaction.query_row(
                    "SELECT COUNT(*) FROM review_schedules WHERE json_extract(data_json,'$.introducedAt')>=?1 AND json_extract(data_json,'$.introducedAt')<?2",
                    params![admission.day_start, admission.day_end], |row| row.get(0),
                )?;
                if introduced >= u32::from(admission.new_card_limit) {
                    return Err(StoreError::Invalid("A cota diária de novos cartões foi atingida. Os cartões devidos continuam disponíveis.".into()));
                }
            }
        }
        let schedule = crate::review_schedule::advance(previous.as_ref(), &review)?;
        transaction.execute("INSERT INTO review_schedules(flashcard_id,last_review_id,data_json) VALUES (?1,?2,?3) ON CONFLICT(flashcard_id) DO UPDATE SET last_review_id=excluded.last_review_id,data_json=excluded.data_json", params![schedule.flashcard_id, schedule.last_review_id, serde_json::to_string(&schedule)?])?;
    }
    transaction.commit()?;
    Ok(review)
}

pub fn set_theme(connection: &mut Connection, theme: Theme) -> StoreResult<()> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    transaction.execute("INSERT INTO settings (key, value) VALUES ('theme', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [theme.as_str()])?;
    transaction.commit()?;
    Ok(())
}

pub fn save_study_track(connection: &mut Connection, input: crate::study::SaveStudyTrackInput) -> StoreResult<crate::study::StudyTrack> {
    use crate::study::StudyTrack;
    if input.id.is_some() != input.expected_revision.is_some() {
        return Err(StoreError::Invalid("Informe o identificador e a revisão da trilha juntos.".into()));
    }
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let previous: Option<StudyTrack> = match &input.id {
        Some(id) => {
            validation::id(id)?;
            let json: Option<String> = transaction.query_row("SELECT data_json FROM study_tracks WHERE id=?1", [id], |row| row.get(0)).optional()?;
            Some(serde_json::from_str(&json.ok_or(StoreError::NotFound("A trilha"))?)?)
        }, None => None,
    };
    let track = if let Some(previous) = &previous {
        if Some(previous.revision) != input.expected_revision {
            return Err(StoreError::Invalid("Esta trilha foi modificada em outra janela. Recarregue a trilha antes de salvar novamente.".into()));
        }
        StudyTrack { id: previous.id.clone(), revision: previous.revision + 1,
            created_at: previous.created_at.clone(), updated_at: updated_at(&previous.updated_at),
            catalog: input.catalog, config: input.config, diagnostics: input.diagnostics }
    } else {
        let timestamp = now();
        StudyTrack { id: new_id(), revision: 1, created_at: timestamp.clone(), updated_at: timestamp,
            catalog: input.catalog, config: input.config, diagnostics: input.diagnostics }
    };
    crate::study::validate_track(&track)?;
    if let Some(previous) = &previous { crate::study::validate_transition(previous, &track)?; }
    let mut data = snapshot(&transaction)?;
    data.study_tracks.retain(|value| value.id != track.id);
    data.study_tracks.push(track.clone());
    validation::snapshot(&data)?;
    transaction.execute("INSERT INTO study_tracks (id,data_json) VALUES (?1,?2) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json", params![track.id, serde_json::to_string(&track)?])?;
    transaction.commit()?;
    Ok(track)
}

pub fn save_error_entry(connection: &mut Connection, input: crate::error_notebook::SaveErrorEntryInput) -> StoreResult<crate::error_notebook::ErrorEntry> {
    crate::error_notebook::validate_input(&input)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let previous: Option<crate::error_notebook::ErrorEntry> = match &input.id {
        Some(id) => {
            let json: Option<String> = transaction.query_row("SELECT data_json FROM error_entries WHERE id=?1", [id], |row| row.get(0)).optional()?;
            Some(serde_json::from_str(&json.ok_or(StoreError::NotFound("O registro de erro"))?)?)
        }, None => None,
    };
    let mut data = snapshot(&transaction)?;
    let entry = crate::error_notebook::build(input, previous.as_ref(), &data, new_id(), now())?;
    if previous.as_ref() == Some(&entry) { transaction.commit()?; return Ok(entry); }
    data.error_entries.retain(|value| value.id != entry.id);
    data.error_entries.push(entry.clone());
    validation::snapshot(&data)?;
    transaction.execute("INSERT INTO error_entries(id,subject_id,data_json) VALUES (?1,?2,?3) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json", params![entry.id,entry.subject_id,serde_json::to_string(&entry)?])?;
    transaction.commit()?;
    Ok(entry)
}

pub fn export_backup(connection: &mut Connection) -> StoreResult<BackupDocument> {
    let transaction = connection.transaction()?;
    let backup = BackupDocument { format: "studyspace-backup".into(), version: 2, exported_at: now(), data: snapshot(&transaction)?, materials:Some(crate::materials::export_materials(&transaction)?) };
    validation::backup(&backup)?;
    transaction.commit()?;
    Ok(backup)
}

pub fn save_study_planner(connection: &mut Connection,input: crate::planner::SaveStudyPlannerInput) -> StoreResult<crate::planner::StudyPlanner> {
    use crate::planner::StudyPlanner;
    validation::id(&input.track_id)?;
    let transaction=connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let json: Option<String>=transaction.query_row("SELECT data_json FROM study_planners WHERE track_id=?1",[&input.track_id],|row|row.get(0)).optional()?;
    let previous: Option<StudyPlanner>=json.map(|value|serde_json::from_str(&value)).transpose()?;
    if previous.as_ref().map(|value|value.revision)!=input.expected_revision {
        return Err(StoreError::Invalid("Esta agenda foi modificada em outra janela. Recarregue o planner antes de salvar novamente.".into()));
    }
    let timestamp=now();
    let planner=StudyPlanner {
        track_id:input.track_id, revision:previous.as_ref().map_or(1,|value|value.revision+1),
        created_at:previous.as_ref().map_or_else(||timestamp.clone(),|value|value.created_at.clone()),
        updated_at:previous.as_ref().map_or(timestamp,|value|updated_at(&value.updated_at)),
        config:input.config,weeks:input.weeks,backlog:input.backlog,undo:input.undo,
    };
    crate::planner::validate_planner(&planner)?;
    if let Some(previous)=&previous { crate::planner::validate_transition(previous,&planner)?; }
    let mut data=snapshot(&transaction)?;
    data.study_planners.retain(|value|value.track_id!=planner.track_id);
    data.study_planners.push(planner.clone());
    validation::snapshot(&data)?;
    transaction.execute("INSERT INTO study_planners(track_id,data_json) VALUES (?1,?2) ON CONFLICT(track_id) DO UPDATE SET data_json=excluded.data_json",params![planner.track_id,serde_json::to_string(&planner)?])?;
    transaction.commit()?;
    Ok(planner)
}

pub fn restore_backup(connection: &mut Connection, backup: BackupDocument) -> StoreResult<()> {
    validation::backup(&backup)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let populated: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM subjects) OR EXISTS(SELECT 1 FROM notes) OR EXISTS(SELECT 1 FROM flashcards) OR EXISTS(SELECT 1 FROM review_logs) OR EXISTS(SELECT 1 FROM study_tracks) OR EXISTS(SELECT 1 FROM study_planners) OR EXISTS(SELECT 1 FROM documents) OR EXISTS(SELECT 1 FROM material_assets) OR EXISTS(SELECT 1 FROM card_metadata) OR EXISTS(SELECT 1 FROM review_schedules) OR EXISTS(SELECT 1 FROM error_entries)",
        [], |row| row.get(0),
    )?;
    if populated {
        return Err(StoreError::Invalid("A restauração só está disponível em uma biblioteca vazia. Seus dados atuais foram preservados.".into()));
    }
    restore_snapshot(&transaction, &backup.data)?;
    crate::materials::restore_materials(&transaction,&backup)?;
    transaction.commit()?;
    Ok(())
}

pub(crate) fn restore_snapshot(connection: &Connection, data: &Snapshot) -> StoreResult<()> {
    for subject in &data.subjects { insert_subject(connection, subject)?; }
    for note in &data.notes { insert_note(connection, note)?; }
    for card in &data.flashcards { insert_flashcard(connection, card)?; }
    for review in &data.review_logs { insert_review(connection, review)?; }
    for schedule in &data.review_schedules {
        connection.execute("INSERT INTO review_schedules(flashcard_id,last_review_id,data_json) VALUES (?1,?2,?3)", params![schedule.flashcard_id, schedule.last_review_id, serde_json::to_string(schedule)?])?;
    }
    for track in &data.study_tracks {
        connection.execute("INSERT INTO study_tracks (id,data_json) VALUES (?1,?2)", params![track.id, serde_json::to_string(track)?])?;
    }
    for planner in &data.study_planners {
        connection.execute("INSERT INTO study_planners(track_id,data_json) VALUES (?1,?2)",params![planner.track_id,serde_json::to_string(planner)?])?;
    }
    for entry in &data.error_entries {
        connection.execute("INSERT INTO error_entries(id,subject_id,data_json) VALUES (?1,?2,?3)", params![entry.id,entry.subject_id,serde_json::to_string(entry)?])?;
    }
    connection.execute(
        "INSERT INTO settings (key, value) VALUES ('theme', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [data.settings.theme.as_str()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests;
