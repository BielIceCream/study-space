use super::*;
use serde_json::json;

fn memory() -> Connection {
    let mut connection = Connection::open_in_memory().unwrap();
    connection.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrate(&mut connection).unwrap();
    connection
}

fn save_input(note: &Note, content: &str) -> SaveNoteInput {
    SaveNoteInput {
        id: note.id.clone(), title: note.title.clone(), expected_revision: note.revision,
        body_json: json!({ "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": content }] }] }),
        plain_text: content.into(),
    }
}

fn seed(connection: &mut Connection) -> (Subject, Note, Flashcard) {
    let subject = create_subject(connection, SubjectInput { name: "Biologia".into(), accent: Accent::Green }).unwrap();
    let note = create_note(connection, NoteInput { subject_id: subject.id.clone(), title: "Mitocôndrias".into() }).unwrap();
    let note = save_note(connection, save_input(&note, "A respiração celular produz ATP.")).unwrap();
    let card = create_flashcard(connection, FlashcardInput {
        subject_id: subject.id.clone(), note_id: Some(note.id.clone()),
        front: "Qual molécula armazena energia?".into(), back: "ATP.".into(),
    }).unwrap();
    (subject, note, card)
}

#[test]
fn migration_is_versioned_and_preserves_populated_tables() {
    let mut connection = memory();
    seed(&mut connection);
    let previous = get_snapshot(&mut connection).unwrap();
    migrate(&mut connection).unwrap();
    let version: i32 = connection.pragma_query_value(None, "user_version", |row| row.get(0)).unwrap();
    assert_eq!(version, 2);
    assert_eq!(get_snapshot(&mut connection).unwrap(), previous);
    check_integrity(&connection).unwrap();
}

#[test]
fn migration_failure_rolls_back_schema_and_version() {
    let mut connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY CHECK (key = 'other'), value TEXT NOT NULL);").unwrap();
    assert!(migrate(&mut connection).is_err());
    let version: i32 = connection.pragma_query_value(None, "user_version", |row| row.get(0)).unwrap();
    let created: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'subjects')", [], |row| row.get(0)).unwrap();
    assert_eq!(version, 0);
    assert!(!created);
}

#[test]
fn newer_schema_is_rejected_without_mutating_data() {
    let mut connection = memory();
    seed(&mut connection);
    let previous = get_snapshot(&mut connection).unwrap();
    connection.pragma_update(None, "user_version", 3).unwrap();
    assert!(migrate(&mut connection).unwrap_err().to_string().contains("mais recente"));
    assert_eq!(get_snapshot(&mut connection).unwrap(), previous);
}

#[test]
fn opening_newer_database_does_not_change_its_file() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("future.sqlite3");
    {
        let mut connection = Connection::open(&path).unwrap();
        connection.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&mut connection).unwrap();
        seed(&mut connection);
        connection.pragma_update(None, "user_version", 3).unwrap();
    }
    let original = std::fs::read(&path).unwrap();
    assert!(open(&path).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), original);
}

#[test]
fn complete_study_flow_survives_closing_and_reopening_sqlite() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("studyspace.sqlite3");
    let expected;
    {
        let mut connection = open(&path).unwrap();
        let (_, _, card) = seed(&mut connection);
        record_review(&mut connection, ReviewInput { flashcard_id: card.id, session_id: "sessao-1".into(), rating: 3 }).unwrap();
        set_theme(&mut connection, Theme::Dark).unwrap();
        let journal: String = connection.pragma_query_value(None, "journal_mode", |row| row.get(0)).unwrap();
        let foreign_keys: bool = connection.pragma_query_value(None, "foreign_keys", |row| row.get(0)).unwrap();
        assert_eq!(journal, "wal");
        assert!(foreign_keys);
        expected = get_snapshot(&mut connection).unwrap();
    }
    let mut reopened = open(&path).unwrap();
    assert_eq!(get_snapshot(&mut reopened).unwrap(), expected);
    assert_eq!(expected.notes[0].revision, 2);
    assert_eq!(expected.review_logs[0].rating, 3);
}

#[test]
fn stale_note_revision_cannot_overwrite_newer_text() {
    let mut connection = memory();
    let (_, original, _) = seed(&mut connection);
    let saved = save_note(&mut connection, save_input(&original, "Novo texto importante.")).unwrap();
    let error = save_note(&mut connection, save_input(&original, "Texto antigo.")).unwrap_err();
    assert!(matches!(error, StoreError::Conflict));
    assert_eq!(note(&connection, &original.id).unwrap(), saved);
    assert_eq!(saved.revision, original.revision + 1);
}

#[test]
fn reviewing_twice_in_the_same_session_returns_the_first_log() {
    let mut connection = memory();
    let (_, _, card) = seed(&mut connection);
    let first = record_review(&mut connection, ReviewInput { flashcard_id: card.id.clone(), session_id: "same-session".into(), rating: 2 }).unwrap();
    let retry = record_review(&mut connection, ReviewInput { flashcard_id: card.id.clone(), session_id: "same-session".into(), rating: 4 }).unwrap();
    assert_eq!(first, retry);
    record_review(&mut connection, ReviewInput { flashcard_id: card.id, session_id: "other-session".into(), rating: 4 }).unwrap();
    assert_eq!(get_snapshot(&mut connection).unwrap().review_logs.len(), 2);
}

#[test]
fn failed_review_can_be_retried_without_duplicate_logs() {
    let mut connection = memory();
    let (_, _, card) = seed(&mut connection);
    let before = get_snapshot(&mut connection).unwrap();
    connection.execute_batch("CREATE TRIGGER fail_review BEFORE INSERT ON review_logs BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
    assert!(record_review(&mut connection, ReviewInput { flashcard_id: card.id.clone(), session_id: "retry".into(), rating: 1 }).is_err());
    assert_eq!(get_snapshot(&mut connection).unwrap(), before);
    connection.execute_batch("DROP TRIGGER fail_review;").unwrap();
    record_review(&mut connection, ReviewInput { flashcard_id: card.id, session_id: "retry".into(), rating: 1 }).unwrap();
    assert_eq!(get_snapshot(&mut connection).unwrap().review_logs.len(), 1);
}

#[test]
fn flashcard_cannot_reference_a_note_in_another_subject() {
    let mut connection = memory();
    let (_, source, _) = seed(&mut connection);
    let other = create_subject(&mut connection, SubjectInput { name: "História".into(), accent: Accent::Peach }).unwrap();
    assert!(create_flashcard(&mut connection, FlashcardInput {
        subject_id: other.id.clone(), note_id: Some(source.id.clone()),
        front: "Pergunta".into(), back: "Resposta".into(),
    }).unwrap_err().to_string().contains("mesma matéria"));
    let timestamp = now();
    assert!(connection.execute(
        "INSERT INTO flashcards (id, subject_id, note_id, front, back, created_at, updated_at) VALUES ('bad-link', ?1, ?2, 'Pergunta', 'Resposta', ?3, ?3)",
        params![other.id, source.id, timestamp],
    ).is_err());
    assert_eq!(get_snapshot(&mut connection).unwrap().flashcards.len(), 1);
}

#[test]
fn readable_backup_round_trips_all_data_and_relationships() {
    let mut original = memory();
    let (_, _, card) = seed(&mut original);
    record_review(&mut original, ReviewInput { flashcard_id: card.id, session_id: "backup-session".into(), rating: 3 }).unwrap();
    set_theme(&mut original, Theme::Dark).unwrap();
    let backup = export_backup(&mut original).unwrap();
    let readable = serde_json::to_string_pretty(&backup).unwrap();
    assert!(readable.contains("\"bodyJson\""));
    let imported: BackupDocument = serde_json::from_str(&readable).unwrap();
    let mut destination = memory();
    restore_backup(&mut destination, imported).unwrap();
    assert_eq!(get_snapshot(&mut destination).unwrap(), backup.data);
    check_integrity(&destination).unwrap();
}

#[test]
fn restore_rejects_populated_library_without_replacing_anything() {
    let mut connection = memory();
    seed(&mut connection);
    let backup = export_backup(&mut connection).unwrap();
    let previous = get_snapshot(&mut connection).unwrap();
    assert!(restore_backup(&mut connection, backup).unwrap_err().to_string().contains("biblioteca vazia"));
    assert_eq!(get_snapshot(&mut connection).unwrap(), previous);
}

#[test]
fn failed_restore_rolls_back_earlier_inserts_and_preserves_settings() {
    let mut original = memory();
    seed(&mut original);
    let backup = export_backup(&mut original).unwrap();
    let mut destination = memory();
    set_theme(&mut destination, Theme::Dark).unwrap();
    let before = get_snapshot(&mut destination).unwrap();
    destination.execute_batch("CREATE TRIGGER fail_card BEFORE INSERT ON flashcards BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
    assert!(restore_backup(&mut destination, backup.clone()).is_err());
    assert_eq!(get_snapshot(&mut destination).unwrap(), before);
    destination.execute_batch("DROP TRIGGER fail_card;").unwrap();
    restore_backup(&mut destination, backup.clone()).unwrap();
    assert_eq!(get_snapshot(&mut destination).unwrap(), backup.data);
}

#[test]
fn backup_rejects_invalid_links_dates_duplicates_and_missing_fields() {
    let mut original = memory();
    let (_, _, card) = seed(&mut original);
    record_review(&mut original, ReviewInput { flashcard_id: card.id, session_id: "validate-session".into(), rating: 3 }).unwrap();
    let backup = export_backup(&mut original).unwrap();

    let mut invalid = backup.clone();
    invalid.data.notes[0].subject_id = "missing".into();
    assert!(validation::backup(&invalid).is_err());
    invalid = backup.clone();
    invalid.exported_at = "2026-02-30T12:00:00.000Z".into();
    assert!(validation::backup(&invalid).is_err());
    invalid = backup.clone();
    invalid.data.review_logs.push(invalid.data.review_logs[0].clone());
    assert!(validation::backup(&invalid).is_err());

    let mut serialized = serde_json::to_value(&backup).unwrap();
    serialized["data"]["flashcards"][0].as_object_mut().unwrap().remove("noteId");
    assert!(serde_json::from_value::<BackupDocument>(serialized).is_err());
    let mut serialized = serde_json::to_value(&backup).unwrap();
    serialized["data"]["settings"]["unexpected"] = json!(true);
    assert!(serde_json::from_value::<BackupDocument>(serialized).is_err());
}

#[test]
fn invalid_editor_document_is_rejected_before_saving() {
    let mut connection = memory();
    let (_, note, _) = seed(&mut connection);
    let mut input = save_input(&note, "Texto novo.");
    input.body_json = json!({ "type": "doc", "content": [{ "type": "text" }] });
    assert!(save_note(&mut connection, input).is_err());

    let mut nested = json!(true);
    for _ in 0..70 { nested = json!({ "nested": nested }); }
    assert!(validation::document(&json!({ "type": "doc", "attrs": { "data": nested } })).is_err());
    assert_eq!(super::note(&connection, &note.id).unwrap(), note);
}
