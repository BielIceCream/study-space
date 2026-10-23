use super::*;
use crate::models::{Accent, SubjectInput};
use serde_json::json;
use sha2::{Digest, Sha256};

fn memory() -> Connection {
    let mut connection = Connection::open_in_memory().unwrap();
    connection.pragma_update(None, "foreign_keys", "ON").unwrap();
    storage::migrate(&mut connection).unwrap();
    connection
}

#[test]
fn version_six_roundtrip_preserves_schedules_and_rejects_downgrade() {
    let mut source = seed();
    let card = storage::get_snapshot(&mut source).unwrap().flashcards[0].clone();
    storage::record_review(&mut source, crate::models::ReviewInput {
        flashcard_id: card.id, session_id: "scheduled-roundtrip".into(), rating: 4, schedule: true, admission: None,
    }).unwrap();
    let expected = storage::get_snapshot(&mut source).unwrap();
    assert!(storage::export_backup(&mut source).unwrap_err().to_string().contains("versão 6"));
    let mut sessions = ArchiveSessions::default();
    let export = sessions.export_begin(&mut source).unwrap();
    assert_eq!(export.manifest.version, 6);
    for version in 3..=5 {
        let mut downgraded = export.manifest.clone(); downgraded.version = version;
        assert!(sessions.restore_begin(downgraded).is_err());
    }
    let mut malformed = export.manifest.clone();
    malformed.data.review_schedules[0].due_at = malformed.data.review_schedules[0].last_reviewed_at.clone();
    assert!(sessions.restore_begin(malformed).is_err());
    let token = sessions.restore_begin(export.manifest).unwrap();
    for index in 0..2 {
        let bytes = sessions.export_material(&export.token, index).unwrap();
        sessions.restore_material(&token, index, bytes).unwrap();
    }
    let mut target = memory();
    target.execute_batch("CREATE TRIGGER fail_schedule_restore BEFORE INSERT ON review_schedules BEGIN SELECT RAISE(ABORT, 'schedule restore failure'); END;").unwrap();
    assert!(sessions.restore_finish(&mut target, &token).is_err());
    let empty = storage::get_snapshot(&mut target).unwrap();
    assert!(empty.review_logs.is_empty() && empty.review_schedules.is_empty() && empty.flashcards.is_empty());
    target.execute_batch("DROP TRIGGER fail_schedule_restore;").unwrap();
    sessions.restore_finish(&mut target, &token).unwrap();
    assert_eq!(storage::get_snapshot(&mut target).unwrap(), expected);
}

#[test]
fn version_five_roundtrip_preserves_agenda_pending_work_and_materials() {
    let mut source=seed(); let track=storage::save_study_track(&mut source,crate::study::tests::input()).unwrap();
    let mut input=crate::planner::tests::input(&track.id);
    let mut waiting=input.weeks[0].blocks[0].clone(); waiting.id="waiting".into(); waiting.unit_id=Some("unit2".into()); input.backlog.push(waiting);
    storage::save_study_planner(&mut source,input).unwrap();
    let expected=storage::get_snapshot(&mut source).unwrap();
    assert!(storage::export_backup(&mut source).unwrap_err().to_string().contains("versão 5"));
    let mut sessions=ArchiveSessions::default(); let export=sessions.export_begin(&mut source).unwrap();
    assert_eq!(export.manifest.version,5);
    let mut downgrade=export.manifest.clone(); downgrade.version=4; assert!(sessions.restore_begin(downgrade).is_err());
    let token=sessions.restore_begin(export.manifest).unwrap();
    for index in 0..2 { let bytes=sessions.export_material(&export.token,index).unwrap(); sessions.restore_material(&token,index,bytes).unwrap(); }
    let mut target=memory(); sessions.restore_finish(&mut target,&token).unwrap();
    assert_eq!(storage::get_snapshot(&mut target).unwrap(),expected);
}

#[test]
fn version_four_preserves_private_tracks_and_diagnostics_and_refuses_silent_downgrade() {
    let mut source = seed();
    let mut input = crate::study::tests::input();
    let library = storage::get_snapshot(&mut source).unwrap();
    input.config.bindings.push(crate::study::Binding { unit_id: "unit1".into(), subject_id: library.subjects[0].id.clone(), note_ids: vec![library.notes[0].id.clone()] });
    input.diagnostics = serde_json::from_value(json!([{
        "id":"diagnostic", "startedAt":"2026-10-19T12:00:00.000Z", "updatedAt":"2026-10-19T12:00:00.000Z", "status":"skipped",
        "questionIds":["q1","q2"], "answers":[{"questionId":"q1","choiceIndex":0,"answeredAt":"2026-10-19T12:00:00.000Z"}]
    }])).unwrap();
    storage::save_study_track(&mut source, input).unwrap();
    let expected = storage::get_snapshot(&mut source).unwrap();
    assert!(storage::export_backup(&mut source).unwrap_err().to_string().contains(".studyspace"));
    let mut sessions = ArchiveSessions::default();
    let start = sessions.export_begin(&mut source).unwrap();
    assert_eq!(start.manifest.version, 4);
    let mut downgraded = start.manifest.clone(); downgraded.version = 3;
    assert!(sessions.restore_begin(downgraded).is_err());
    let token = sessions.restore_begin(start.manifest.clone()).unwrap();
    for index in 0..2 { let bytes = sessions.export_material(&start.token, index).unwrap(); sessions.restore_material(&token, index, bytes).unwrap(); }
    let mut destination = memory();
    sessions.restore_finish(&mut destination, &token).unwrap();
    assert_eq!(storage::get_snapshot(&mut destination).unwrap(), expected);
    let mut only_track = memory(); storage::save_study_track(&mut only_track, crate::study::tests::input()).unwrap();
    let token = sessions.restore_begin(start.manifest).unwrap();
    for index in 0..2 { let bytes = sessions.export_material(&start.token, index).unwrap(); sessions.restore_material(&token, index, bytes).unwrap(); }
    assert!(sessions.restore_finish(&mut only_track, &token).unwrap_err().to_string().contains("biblioteca vazia"));
}

fn seed() -> Connection {
    let mut connection = memory();
    let subject = storage::create_subject(&mut connection, SubjectInput { name: "Física".into(), accent: Accent::Blue }).unwrap();
    let document = b"%PDF-1.7 material de estudo";
    let image = b"\x89PNG\r\n\x1a\nconteudo";
    let image_hash = format!("{:x}", Sha256::digest(image));
    let batch = json!({
        "subjectId": subject.id, "sourceName": "aula.pdf", "format": "pdf", "warnings": [],
        "notes": [{ "title": "Movimento", "bodyJson": { "type": "doc", "content": [] }, "plainText": "Ação e reação" }],
        "flashcards": [{ "front": "Força?", "back": "m.a", "noteIndex": 0, "tags": ["revisão"], "images": [{ "assetHash": image_hash, "side": "front", "alt": "diagrama" }] }],
        "documents": [{ "noteIndex": 0, "fileName": "aula.pdf", "kind": "pdf", "mimeType": "application/pdf", "sha256": format!("{:x}", Sha256::digest(document)), "dataBase64": STANDARD.encode(document), "pages": [{ "page": 1, "text": "Ação e reação" }] }],
        "assets": [{ "sha256": image_hash, "fileName": "diagrama.png", "mimeType": "image/png", "dataBase64": STANDARD.encode(image) }]
    });
    materials::import_batch(&mut connection, serde_json::from_value(batch).unwrap()).unwrap();
    connection
}

#[test]
fn archive_roundtrip_stages_materials_and_commits_all_relationships() {
    let mut source = seed();
    let expected = storage::get_snapshot(&mut source).unwrap();
    let mut sessions = ArchiveSessions::default();
    let start = sessions.export_begin(&mut source).unwrap();
    let restore = sessions.restore_begin(start.manifest.clone()).unwrap();
    let mut target = memory();
    for index in 0..2 {
        let bytes = sessions.export_material(&start.token, index).unwrap();
        sessions.restore_material(&restore, index, bytes).unwrap();
        assert!(storage::get_snapshot(&mut target).unwrap().subjects.is_empty());
    }
    sessions.restore_finish(&mut target, &restore).unwrap();
    assert_eq!(storage::get_snapshot(&mut target).unwrap(), expected);
    assert_eq!(materials::get_document(&target, &expected.documents[0].id).unwrap().data_base64, materials::get_document(&source, &expected.documents[0].id).unwrap().data_base64);
    let image = &expected.card_metadata[0].images[0].asset_hash;
    assert_eq!(materials::get_asset(&target, image).unwrap(), materials::get_asset(&source, image).unwrap());
    sessions.cancel(&start.token);
    assert!(sessions.export.is_none());
    assert!(sessions.restore.is_none());
}

#[test]
fn final_transaction_rolls_back_all_materials_settings_and_allows_retry() {
    let mut source = seed();
    let expected = storage::get_snapshot(&mut source).unwrap();
    let mut target = memory();
    storage::set_theme(&mut target, crate::models::Theme::Dark).unwrap();
    let before = storage::get_snapshot(&mut target).unwrap();
    let mut sessions = ArchiveSessions::default();
    let start = sessions.export_begin(&mut source).unwrap();
    let restore = sessions.restore_begin(start.manifest).unwrap();
    for index in 0..2 {
        let bytes = sessions.export_material(&start.token, index).unwrap();
        sessions.restore_material(&restore, index, bytes).unwrap();
    }
    target.execute_batch("CREATE TEMP TRIGGER fail_restore BEFORE INSERT ON card_metadata BEGIN SELECT RAISE(ABORT,'falha simulada'); END;").unwrap();
    assert!(sessions.restore_finish(&mut target, &restore).is_err());
    assert_eq!(storage::get_snapshot(&mut target).unwrap(), before);
    assert_eq!(target.query_row("SELECT count(*) FROM material_assets", [], |row| row.get::<_, i64>(0)).unwrap(), 0);
    assert!(sessions.restore.is_some());
    target.execute_batch("DROP TRIGGER fail_restore;").unwrap();
    sessions.restore_finish(&mut target, &restore).unwrap();
    assert_eq!(storage::get_snapshot(&mut target).unwrap(), expected);
}

#[test]
fn document_transfer_uses_ids_when_manifest_metadata_has_a_different_order() {
    let mut source = seed();
    let mut metadata = storage::get_snapshot(&mut source).unwrap().documents[0].clone();
    let pages = materials::get_document(&source, &metadata.id).unwrap().pages;
    let bytes = b"%PDF-1.7 segundo material";
    metadata.id = uuid::Uuid::new_v4().to_string();
    metadata.sha256 = format!("{:x}", Sha256::digest(bytes));
    materials::insert_document(&source, &metadata, &materials::DocumentPayload {
        document_id: metadata.id.clone(), pages, data_base64: STANDARD.encode(bytes),
    }).unwrap();
    let expected = storage::get_snapshot(&mut source).unwrap();
    let mut sessions = ArchiveSessions::default();
    let start = sessions.export_begin(&mut source).unwrap();
    let mut manifest = start.manifest;
    manifest.data.documents.reverse();
    let restore = sessions.restore_begin(manifest).unwrap();
    for index in 0..3 {
        let bytes = sessions.export_material(&start.token, index).unwrap();
        sessions.restore_material(&restore, index, bytes).unwrap();
    }
    let mut target = memory();
    sessions.restore_finish(&mut target, &restore).unwrap();
    assert_eq!(storage::get_snapshot(&mut target).unwrap(), expected);
}

#[test]
fn exported_database_remains_consistent_when_the_library_changes() {
    let mut source = seed();
    let mut sessions = ArchiveSessions::default();
    let start = sessions.export_begin(&mut source).unwrap();
    let id = &start.manifest.data.documents[0].id;
    source.execute("DELETE FROM documents WHERE id=?1", [id]).unwrap();
    assert!(!sessions.export_material(&start.token, 0).unwrap().is_empty());
    assert_eq!(sessions.export.as_ref().unwrap().manifest.data.documents.len(), 1);
}

#[test]
fn failed_or_incomplete_restore_preserves_the_destination_and_settings() {
    let mut source = seed();
    let mut target = memory();
    storage::set_theme(&mut target, crate::models::Theme::Dark).unwrap();
    let mut sessions = ArchiveSessions::default();
    let start = sessions.export_begin(&mut source).unwrap();
    let restore = sessions.restore_begin(start.manifest.clone()).unwrap();
    assert!(sessions.restore_material(&restore, 0, STANDARD.encode(b"corrompido")).is_err());
    assert!(sessions.restore_finish(&mut target, &restore).is_err());
    let untouched = storage::get_snapshot(&mut target).unwrap();
    assert!(untouched.subjects.is_empty());
    assert_eq!(untouched.settings.theme, crate::models::Theme::Dark);
    sessions.cancel(&restore);
    assert!(sessions.restore.is_none());
}

#[test]
fn populated_destination_rejects_a_fully_staged_restore() {
    let mut source = seed();
    let mut target = seed();
    let before = storage::get_snapshot(&mut target).unwrap();
    let mut sessions = ArchiveSessions::default();
    let start = sessions.export_begin(&mut source).unwrap();
    let restore = sessions.restore_begin(start.manifest).unwrap();
    for index in 0..2 {
        let bytes = sessions.export_material(&start.token, index).unwrap();
        sessions.restore_material(&restore, index, bytes).unwrap();
    }
    assert!(sessions.restore_finish(&mut target, &restore).unwrap_err().to_string().contains("biblioteca vazia"));
    assert_eq!(storage::get_snapshot(&mut target).unwrap(), before);
}

#[test]
fn native_manifest_rejects_invalid_links_pages_limits_and_duplicate_materials() {
    let mut source = seed();
    let manifest = ArchiveSessions::default().export_begin(&mut source).unwrap().manifest;
    let mut invalid = manifest.clone(); invalid.materials.documents[0].byte_length = 32 * 1024 * 1024 + 1;
    assert!(validate_manifest(&invalid).is_err());
    let mut invalid = manifest.clone(); invalid.materials.assets[0].byte_length = 8 * 1024 * 1024 + 1;
    assert!(validate_manifest(&invalid).is_err());
    let mut invalid = manifest.clone(); invalid.materials.documents[0].pages.clear();
    assert!(validate_manifest(&invalid).is_err());
    let mut invalid = manifest.clone(); invalid.data.documents[0].note_id = "ausente".into();
    assert!(validate_manifest(&invalid).is_err());
    let mut invalid = manifest.clone(); invalid.materials.assets.push(invalid.materials.assets[0].clone());
    assert!(validate_manifest(&invalid).is_err());
    let mut invalid = manifest; invalid.data.card_metadata[0].images[0].asset_hash = "a".repeat(64);
    assert!(validate_manifest(&invalid).is_err());
}

#[test]
fn version_seven_roundtrip_preserves_notebook_evidence_practice_and_materials() {
    let mut source = seed();
    let subject = storage::get_snapshot(&mut source).unwrap().subjects[0].clone();
    let entry = storage::save_error_entry(&mut source, crate::error_notebook::tests::input(&subject.id)).unwrap();
    let input = json!({"id":entry.id,"expectedRevision":entry.revision,"subjectId":subject.id,"originLabel":entry.origin_label,"question":entry.question,"correction":"Revisei a resolução.","nextAction":"Tentar outro exercício.","status":"resolved","source":entry.source,"practice":{"id":"archive-practice","description":"Refiz a questão."}});
    storage::save_error_entry(&mut source,serde_json::from_value(input).unwrap()).unwrap();
    let expected = storage::get_snapshot(&mut source).unwrap();
    assert!(storage::export_backup(&mut source).unwrap_err().to_string().contains("versão 7"));
    let mut sessions = ArchiveSessions::default(); let export = sessions.export_begin(&mut source).unwrap();
    assert_eq!(export.manifest.version,7);
    for version in 3..=6 {
        let mut downgrade = export.manifest.clone(); downgrade.version=version;
        assert!(sessions.restore_begin(downgrade).is_err());
    }
    let mut malformed = export.manifest.clone(); malformed.data.error_entries[0].practices[0].created_at="1999-01-01T00:00:00.000Z".into();
    assert!(sessions.restore_begin(malformed).is_err());
    let mut malformed = export.manifest.clone(); malformed.data.error_entries[0].subject_id="missing-subject".into();
    assert!(sessions.restore_begin(malformed).is_err());
    let token=sessions.restore_begin(export.manifest).unwrap();
    for index in 0..2 { let data=sessions.export_material(&export.token,index).unwrap();sessions.restore_material(&token,index,data).unwrap(); }
    let mut target=memory();
    target.execute_batch("CREATE TRIGGER fail_error_restore BEFORE INSERT ON error_entries BEGIN SELECT RAISE(ABORT,'synthetic notebook restore failure'); END;").unwrap();
    assert!(sessions.restore_finish(&mut target,&token).is_err());
    assert!(storage::get_snapshot(&mut target).unwrap().subjects.is_empty());
    target.execute_batch("DROP TRIGGER fail_error_restore;").unwrap();
    sessions.restore_finish(&mut target,&token).unwrap();
    assert_eq!(storage::get_snapshot(&mut target).unwrap(),expected);
    let document_id=&expected.documents[0].id;
    assert_eq!(materials::get_document(&target,document_id).unwrap().data_base64,materials::get_document(&source,document_id).unwrap().data_base64);
    assert!(sessions.restore_finish(&mut target,&token).is_err());
}
