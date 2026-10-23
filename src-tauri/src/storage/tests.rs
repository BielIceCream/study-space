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
    assert_eq!(version, 6);
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
    connection.pragma_update(None, "user_version", 7).unwrap();
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
        connection.pragma_update(None, "user_version", 7).unwrap();
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
        record_review(&mut connection, ReviewInput { flashcard_id: card.id, session_id: "sessao-1".into(), rating: 3, schedule: false, admission: None }).unwrap();
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
    let first = record_review(&mut connection, ReviewInput { flashcard_id: card.id.clone(), session_id: "same-session".into(), rating: 2, schedule: false, admission: None }).unwrap();
    let retry = record_review(&mut connection, ReviewInput { flashcard_id: card.id.clone(), session_id: "same-session".into(), rating: 4, schedule: false, admission: None }).unwrap();
    assert_eq!(first, retry);
    record_review(&mut connection, ReviewInput { flashcard_id: card.id, session_id: "other-session".into(), rating: 4, schedule: false, admission: None }).unwrap();
    assert_eq!(get_snapshot(&mut connection).unwrap().review_logs.len(), 2);
}

#[test]
fn failed_review_can_be_retried_without_duplicate_logs() {
    let mut connection = memory();
    let (_, _, card) = seed(&mut connection);
    let before = get_snapshot(&mut connection).unwrap();
    connection.execute_batch("CREATE TRIGGER fail_review BEFORE INSERT ON review_logs BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
    assert!(record_review(&mut connection, ReviewInput { flashcard_id: card.id.clone(), session_id: "retry".into(), rating: 1, schedule: false, admission: None }).is_err());
    assert_eq!(get_snapshot(&mut connection).unwrap(), before);
    connection.execute_batch("DROP TRIGGER fail_review;").unwrap();
    record_review(&mut connection, ReviewInput { flashcard_id: card.id, session_id: "retry".into(), rating: 1, schedule: false, admission: None }).unwrap();
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
    record_review(&mut original, ReviewInput { flashcard_id: card.id, session_id: "backup-session".into(), rating: 3, schedule: false, admission: None }).unwrap();
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
    record_review(&mut original, ReviewInput { flashcard_id: card.id, session_id: "validate-session".into(), rating: 3, schedule: false, admission: None }).unwrap();
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

#[test]
fn spaced_schedule_is_opt_in_idempotent_and_durable() {
    let mut connection = memory();
    let (_, _, card) = seed(&mut connection);
    let free = record_review(&mut connection, ReviewInput { flashcard_id: card.id.clone(), session_id: "free".into(), rating: 3, schedule: false, admission: None }).unwrap();
    assert!(get_snapshot(&mut connection).unwrap().review_schedules.is_empty());
    let duplicate = record_review(&mut connection, ReviewInput { flashcard_id: card.id.clone(), session_id: "free".into(), rating: 4, schedule: true, admission: None }).unwrap();
    assert_eq!(duplicate, free);
    assert!(get_snapshot(&mut connection).unwrap().review_schedules.is_empty());
    let review = record_review(&mut connection, ReviewInput { flashcard_id: card.id.clone(), session_id: "spaced".into(), rating: 3, schedule: true, admission: None }).unwrap();
    let expected = get_snapshot(&mut connection).unwrap();
    let schedule = &expected.review_schedules[0];
    assert_eq!(schedule.last_review_id, review.id);
    assert_eq!(schedule.stage, 1);
    assert_eq!(schedule.repetitions, 1);
    crate::validation::snapshot(&expected).unwrap();
    let retry = record_review(&mut connection, ReviewInput { flashcard_id: card.id.clone(), session_id: "spaced".into(), rating: 1, schedule: true, admission: None }).unwrap();
    assert_eq!(retry, review);
    assert_eq!(get_snapshot(&mut connection).unwrap(), expected);
    // A fresh session before the due instant must roll back the inserted log.
    assert!(record_review(&mut connection, ReviewInput { flashcard_id: card.id.clone(), session_id: "early".into(), rating: 4, schedule: true, admission: None }).is_err());
    assert_eq!(get_snapshot(&mut connection).unwrap(), expected);
    record_review(&mut connection, ReviewInput { flashcard_id: card.id, session_id: "extra-free".into(), rating: 1, schedule: false, admission: None }).unwrap();
    assert_eq!(get_snapshot(&mut connection).unwrap().review_schedules, expected.review_schedules);
}

#[test]
fn spaced_schedule_failure_rolls_back_log_and_retry_applies_once() {
    let mut connection = memory();
    let (_, _, card) = seed(&mut connection);
    let expected = get_snapshot(&mut connection).unwrap();
    connection.execute_batch("CREATE TRIGGER fail_schedule BEFORE INSERT ON review_schedules BEGIN SELECT RAISE(ABORT, 'schedule test failure'); END;").unwrap();
    assert!(record_review(&mut connection, ReviewInput { flashcard_id: card.id.clone(), session_id: "retry-spaced".into(), rating: 1, schedule: true, admission: None }).is_err());
    assert_eq!(get_snapshot(&mut connection).unwrap(), expected);
    connection.execute_batch("DROP TRIGGER fail_schedule;").unwrap();
    record_review(&mut connection, ReviewInput { flashcard_id: card.id, session_id: "retry-spaced".into(), rating: 1, schedule: true, admission: None }).unwrap();
    let actual = get_snapshot(&mut connection).unwrap();
    assert_eq!(actual.review_logs.len(), 1);
    assert_eq!(actual.review_schedules[0].repetitions, 1);
    assert_eq!(actual.review_schedules[0].lapses, 1);
}

#[test]
fn spaced_schedule_survives_database_reopen() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("schedule.sqlite3");
    let expected;
    {
        let mut connection = open(&path).unwrap();
        let (_, _, card) = seed(&mut connection);
        record_review(&mut connection, ReviewInput { flashcard_id: card.id, session_id: "persistent".into(), rating: 4, schedule: true, admission: None }).unwrap();
        expected = get_snapshot(&mut connection).unwrap();
    }
    let mut connection = open(&path).unwrap();
    assert_eq!(get_snapshot(&mut connection).unwrap(), expected);
    crate::validation::snapshot(&expected).unwrap();
}

fn review_admission(limit: u8) -> ReviewAdmission {
    let start = chrono::Utc::now().date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc();
    ReviewAdmission {
        new_card_limit: limit,
        day_start: start.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        day_end: (start + chrono::Duration::days(1)).to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    }
}

fn admitted_input(card_id: &str, session: &str, limit: u8) -> ReviewInput {
    ReviewInput {
        flashcard_id: card_id.into(), session_id: session.into(), rating: 3,
        schedule: true, admission: Some(review_admission(limit)),
    }
}

#[test]
fn daily_admission_is_global_across_subjects_and_free_practice_does_not_consume_it() {
    let mut connection = memory();
    let (_, _, first) = seed(&mut connection);
    let (_, _, second) = seed(&mut connection);
    record_review(&mut connection, ReviewInput {
        flashcard_id: second.id.clone(), session_id: "free-before-admission".into(), rating: 4,
        schedule: false, admission: None,
    }).unwrap();
    let first_log = record_review(&mut connection, admitted_input(&first.id, "first-admission", 1)).unwrap();
    let expected = get_snapshot(&mut connection).unwrap();
    let error = record_review(&mut connection, admitted_input(&second.id, "quota-exhausted", 1)).unwrap_err();
    assert!(error.to_string().contains("cota diária"));
    assert_eq!(get_snapshot(&mut connection).unwrap(), expected);
    // A retry must return the first answer even if quota or the supplied day changed.
    let mut retry = admitted_input(&first.id, "first-admission", 0);
    retry.admission.as_mut().unwrap().day_start = "invalid".into();
    assert_eq!(record_review(&mut connection, retry).unwrap(), first_log);
    assert_eq!(get_snapshot(&mut connection).unwrap(), expected);
}

#[test]
fn daily_admission_serializes_two_connections_without_enrolling_twice() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("admission.sqlite3");
    let (first_id, second_id) = {
        let mut connection = open(&path).unwrap();
        let (_, _, first) = seed(&mut connection);
        let (_, _, second) = seed(&mut connection);
        (first.id, second.id)
    };
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let handles: Vec<_> = [first_id, second_id].into_iter().enumerate().map(|(index, card_id)| {
        let path = path.clone();
        let barrier = barrier.clone();
        std::thread::spawn(move || {
            let mut connection = open(&path).unwrap();
            barrier.wait();
            record_review(&mut connection, admitted_input(&card_id, &format!("window-{index}"), 1))
        })
    }).collect();
    let results: Vec<_> = handles.into_iter().map(|handle| handle.join().unwrap()).collect();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(results.iter().filter(|result| result.is_err()).count(), 1);
    let mut connection = open(&path).unwrap();
    let snapshot = get_snapshot(&mut connection).unwrap();
    assert_eq!(snapshot.review_logs.len(), 1);
    assert_eq!(snapshot.review_schedules.len(), 1);
    crate::validation::snapshot(&snapshot).unwrap();
}

#[test]
fn daily_admission_limit_zero_allows_due_cards_without_changing_their_introduction() {
    let mut connection = memory();
    let (_, _, card) = seed(&mut connection);
    let older = ReviewLog {
        id: "old-spaced-log".into(), flashcard_id: card.id.clone(), session_id: "old-spaced-session".into(), rating: 1,
        reviewed_at: (chrono::Utc::now() - chrono::Duration::days(2)).to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    };
    insert_review(&connection, &older).unwrap();
    let state = crate::review_schedule::advance(None, &older).unwrap();
    connection.execute("INSERT INTO review_schedules(flashcard_id,last_review_id,data_json) VALUES (?1,?2,?3)",
        params![state.flashcard_id, state.last_review_id, serde_json::to_string(&state).unwrap()]).unwrap();
    record_review(&mut connection, admitted_input(&card.id, "due-card-with-zero-new", 0)).unwrap();
    let snapshot = get_snapshot(&mut connection).unwrap();
    assert_eq!(snapshot.review_schedules[0].introduced_at, state.introduced_at);
    assert_eq!(snapshot.review_schedules[0].first_review_id, older.id);
    assert_eq!(snapshot.review_schedules[0].repetitions, 2);
    let (_, _, new_card) = seed(&mut connection);
    let expected = get_snapshot(&mut connection).unwrap();
    assert!(record_review(&mut connection, admitted_input(&new_card.id, "zero-new", 0)).is_err());
    assert_eq!(get_snapshot(&mut connection).unwrap(), expected);
}

#[test]
fn daily_admission_rejects_invalid_or_stale_windows_and_free_mode_without_publishing() {
    let mut connection = memory();
    let (_, _, card) = seed(&mut connection);
    let expected = get_snapshot(&mut connection).unwrap();
    let valid = review_admission(1);
    let cases = [
        ReviewAdmission { new_card_limit: 51, ..review_admission(1) },
        ReviewAdmission { day_start: "2026-02-30T12:00:00.000Z".into(), ..review_admission(1) },
        ReviewAdmission { day_end: valid.day_start.clone(), ..review_admission(1) },
        ReviewAdmission { day_start: "2020-01-01T00:00:00.000Z".into(), day_end: "2020-01-04T00:00:00.000Z".into(), new_card_limit: 1 },
        ReviewAdmission { day_start: "2020-01-01T00:00:00.000Z".into(), day_end: "2020-01-02T00:00:00.000Z".into(), new_card_limit: 1 },
    ];
    for (index, admission) in cases.into_iter().enumerate() {
        let mut input = admitted_input(&card.id, &format!("invalid-window-{index}"), 1);
        input.admission = Some(admission);
        assert!(record_review(&mut connection, input).is_err());
        assert_eq!(get_snapshot(&mut connection).unwrap(), expected);
    }
    let mut free = admitted_input(&card.id, "free-with-quota", 1);
    free.schedule = false;
    assert!(record_review(&mut connection, free).is_err());
    assert_eq!(get_snapshot(&mut connection).unwrap(), expected);
}

fn error_edit(entry: &crate::error_notebook::ErrorEntry) -> crate::error_notebook::SaveErrorEntryInput {
    serde_json::from_value(json!({ "id":entry.id, "expectedRevision":entry.revision,
        "subjectId":entry.subject_id, "originLabel":entry.origin_label, "question":entry.question,
        "correction":entry.correction, "nextAction":entry.next_action, "status":entry.status, "source":entry.source })).unwrap()
}

#[test]
fn error_notebook_captures_original_source_and_keeps_it_across_material_edits() {
    use crate::error_notebook::{ErrorSource, PracticeInput};
    let mut connection = memory();
    let (subject, note, card) = seed(&mut connection);
    let review = record_review(&mut connection, ReviewInput { flashcard_id: card.id.clone(), session_id:"error-source".into(), rating:1, schedule:false, admission:None }).unwrap();
    let mut input = crate::error_notebook::tests::input(&subject.id);
    input.source = ErrorSource::Flashcard { flashcard_id: card.id.clone(), review_log_id: Some(review.id) };
    let first = save_error_entry(&mut connection, input).unwrap();
    assert_eq!(first.source_snapshot.title, "Flashcard · Biologia");
    assert_eq!(first.source_snapshot.prompt, card.front);
    assert_eq!(first.source_snapshot.answer, card.back);
    update_flashcard(&mut connection, UpdateFlashcardInput { id:card.id.clone(), front:"Pergunta alterada".into(), back:"Resposta alterada".into() }).unwrap();
    let mut input = error_edit(&first);
    input.correction = "Identifiquei a troca de conceito.".into(); input.next_action = "Refazer o exercício.".into(); input.status = "resolved".into();
    input.practice = Some(PracticeInput { id:"practice-1".into(), description:"Refiz sem consultar.".into() });
    let resolved = save_error_entry(&mut connection, input).unwrap();
    assert_eq!(resolved.revision, 2); assert_eq!(resolved.source_snapshot, first.source_snapshot);
    assert!(resolved.resolved_at.is_some()); assert_eq!(resolved.practices.len(), 1);
    let resolved_again = save_error_entry(&mut connection, error_edit(&resolved)).unwrap();
    assert_eq!(resolved_again.resolved_at, resolved.resolved_at);
    let mut reopen = error_edit(&resolved_again); reopen.status = "open".into();
    let reopened = save_error_entry(&mut connection, reopen).unwrap(); assert!(reopened.resolved_at.is_none());
    let mut note_input = crate::error_notebook::tests::input(&subject.id); note_input.source = ErrorSource::Note { note_id:note.id.clone() };
    let saved_note = save_error_entry(&mut connection, note_input).unwrap();
    assert_eq!(saved_note.source_snapshot.prompt, note.plain_text);
    save_note(&mut connection, save_input(&note, "novo conteúdo")).unwrap();
    assert_eq!(save_error_entry(&mut connection,error_edit(&saved_note)).unwrap().source_snapshot,saved_note.source_snapshot);
}

#[test]
fn error_notebook_practice_retry_is_idempotent_even_with_stale_revision_and_other_draft_edits() {
    use crate::error_notebook::PracticeInput;
    let mut connection = memory(); let (subject, _, _) = seed(&mut connection);
    let first = save_error_entry(&mut connection, crate::error_notebook::tests::input(&subject.id)).unwrap();
    let mut input = error_edit(&first); input.practice = Some(PracticeInput { id:"practice-retry".into(), description:"Fiz novamente.".into() });
    let saved = save_error_entry(&mut connection, input).unwrap();
    let mut retry = error_edit(&first); retry.question = "Edição ignorada no retry".into();
    retry.practice = Some(PracticeInput { id:"practice-retry".into(), description:"Fiz novamente.".into() });
    assert_eq!(save_error_entry(&mut connection, retry).unwrap(),saved);
    let mut conflict = error_edit(&first); conflict.practice = Some(PracticeInput { id:"practice-retry".into(), description:"Descrição diferente".into() });
    assert!(save_error_entry(&mut connection, conflict).is_err());
    assert!(save_error_entry(&mut connection, error_edit(&first)).is_err());
    assert_eq!(get_snapshot(&mut connection).unwrap().error_entries, vec![saved]);
}

#[test]
fn error_notebook_rejects_bad_links_resolving_without_correction_and_source_changes_atomically() {
    use crate::error_notebook::ErrorSource;
    let mut connection = memory(); let (subject, _, card) = seed(&mut connection);
    let other = create_subject(&mut connection, SubjectInput { name:"Outra".into(), accent:Accent::Rose }).unwrap();
    let before = get_snapshot(&mut connection).unwrap();
    let mut input = crate::error_notebook::tests::input(&other.id);
    input.source = ErrorSource::Flashcard { flashcard_id:card.id.clone(),review_log_id:None };
    assert!(save_error_entry(&mut connection,input).is_err());
    let mut input = crate::error_notebook::tests::input(&subject.id); input.status = "resolved".into();
    assert!(save_error_entry(&mut connection,input).is_err());
    assert_eq!(get_snapshot(&mut connection).unwrap(),before);
    let first = save_error_entry(&mut connection,crate::error_notebook::tests::input(&subject.id)).unwrap();
    let mut input = error_edit(&first); input.source = ErrorSource::Flashcard { flashcard_id:card.id,review_log_id:None };
    assert!(save_error_entry(&mut connection,input).is_err());
    let mut input = error_edit(&first); input.subject_id = other.id;
    assert!(save_error_entry(&mut connection,input).is_err());
    assert_eq!(get_snapshot(&mut connection).unwrap().error_entries,vec![first]);
}

#[test]
fn error_notebook_diagnostic_requires_saved_answer_and_keeps_unknown_choice() {
    use crate::error_notebook::ErrorSource;
    let mut connection = memory(); let (subject, _, _) = seed(&mut connection);
    let mut track_input = crate::study::tests::input();
    track_input.diagnostics = serde_json::from_value(json!([{"id":"diagnostic-error","startedAt":"2026-10-19T12:00:00.000Z","updatedAt":"2026-10-19T12:00:00.000Z","status":"in-progress","questionIds":["q1","q2"],"answers":[{"questionId":"q1","choiceIndex":null,"answeredAt":"2026-10-19T12:00:00.000Z"}]}])).unwrap();
    let track = save_study_track(&mut connection,track_input).unwrap();
    let mut input = crate::error_notebook::tests::input(&subject.id);
    input.source = ErrorSource::Diagnostic { track_id:track.id.clone(),attempt_id:"diagnostic-error".into(),question_id:"q2".into() };
    assert!(save_error_entry(&mut connection,input).is_err());
    let mut input = crate::error_notebook::tests::input(&subject.id);
    input.source = ErrorSource::Diagnostic { track_id:track.id.clone(),attempt_id:"diagnostic-error".into(),question_id:"q1".into() };
    let entry = save_error_entry(&mut connection,input).unwrap();
    assert_eq!(entry.source_snapshot.title,track.config.name);
    assert!(entry.source_snapshot.prompt.contains("\n1. "));
    assert!(entry.source_snapshot.answer.starts_with("Sua resposta: Não sei ainda\nCorreção: "));
    assert!(entry.source_snapshot.answer.ends_with(&track.catalog.questions[0].explanation));
}

#[test]
fn error_notebook_storage_failure_rolls_back_and_retry_survives_reopen() {
    let directory = tempfile::tempdir().unwrap(); let path = directory.path().join("errors.sqlite3");
    let expected;
    {
        let mut connection = open(&path).unwrap(); let (subject, _, _) = seed(&mut connection);
        let before = get_snapshot(&mut connection).unwrap();
        connection.execute_batch("CREATE TRIGGER fail_error BEFORE INSERT ON error_entries BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END;").unwrap();
        assert!(save_error_entry(&mut connection,crate::error_notebook::tests::input(&subject.id)).is_err());
        assert_eq!(get_snapshot(&mut connection).unwrap(),before);
        connection.execute_batch("DROP TRIGGER fail_error;").unwrap();
        save_error_entry(&mut connection,crate::error_notebook::tests::input(&subject.id)).unwrap();
        expected = get_snapshot(&mut connection).unwrap();
    }
    let mut reopened = open(&path).unwrap(); assert_eq!(get_snapshot(&mut reopened).unwrap(),expected);
}
