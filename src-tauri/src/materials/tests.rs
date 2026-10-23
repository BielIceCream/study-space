use super::*;
use crate::{models::{Accent, SubjectInput}, storage};
use serde_json::json;

fn memory() -> Connection {
    let mut connection = Connection::open_in_memory().unwrap();
    connection.pragma_update(None, "foreign_keys", "ON").unwrap();
    storage::migrate(&mut connection).unwrap(); connection
}
fn batch(subject_id: &str) -> ImportBatch {
    let bytes = include_bytes!("../../../src/services/import/fixtures/studyspace.pdf");
    let image = STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNT0AAAAASUVORK5CYII=").unwrap();
    let image_hash = format!("{:x}", Sha256::digest(&image));
    serde_json::from_value(json!({
        "subjectId": subject_id, "sourceName": "studyspace.pdf", "format": "pdf", "warnings": [],
        "notes": [{"title":"Fonte original", "plainText":"Fonte preservada.", "bodyJson":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Fonte preservada."}]}]}}],
        "flashcards": [{"front":"Função da membrana?","back":"Regular a passagem.","noteIndex":0,"tags":["biologia"],"images":[{"assetHash":image_hash,"side":"front","alt":"Diagrama"}]}],
        "documents": [{"noteIndex":0,"fileName":"studyspace.pdf","kind":"pdf","mimeType":"application/pdf","sha256":format!("{:x}",Sha256::digest(bytes)),"dataBase64":STANDARD.encode(bytes),"pages":[{"page":1,"text":"membrane"},{"page":2,"text":"transport"}]}],
        "assets": [{"sha256":image_hash,"fileName":"diagram.png","mimeType":"image/png","dataBase64":STANDARD.encode(image)}]
    })).unwrap()
}
fn subject(connection: &mut Connection) -> String {
    storage::create_subject(connection, SubjectInput {name:"Biologia".into(),accent:Accent::Green}).unwrap().id
}

#[test]
fn original_documents_and_images_survive_file_reopen_with_lazy_snapshot() {
    let directory=tempfile::tempdir().unwrap(); let path=directory.path().join("materials.sqlite3");
    let mut connection=storage::open(&path).unwrap(); let subject_id=subject(&mut connection); let input=batch(&subject_id);
    let original=input.documents[0].data_base64.clone(); let image=input.assets[0].clone();
    let imported=import_batch(&mut connection,input).unwrap(); let before=storage::get_snapshot(&mut connection).unwrap();
    assert_eq!(before.card_metadata[0].tags,vec!["biologia"]);
    assert!(serde_json::to_value(&before).unwrap()["documents"][0].get("dataBase64").is_none());
    drop(connection); let mut reopened=storage::open(&path).unwrap();
    assert_eq!(storage::get_snapshot(&mut reopened).unwrap(),before);
    let stored=get_document(&reopened,&imported.document_ids[0]).unwrap();
    assert_eq!(stored.data_base64,original); assert_eq!(stored.pages.len(),2);
    assert_eq!(get_asset(&reopened,&image.sha256).unwrap(),image);
    assert_eq!(before.flashcards[0].note_id.as_ref(),Some(&imported.note_ids[0]));
}

#[test]
fn duplicate_documents_and_normalized_cards_are_scoped_to_subject() {
    let mut connection=memory(); let subject_id=subject(&mut connection);
    import_batch(&mut connection,batch(&subject_id)).unwrap(); let mut repeated=batch(&subject_id);
    repeated.flashcards[0].front="  FUNÇÃO   DA MEMBRANA? ".into(); repeated.flashcards[0].back=" REGULAR A PASSAGEM. ".into();
    let result=import_batch(&mut connection,repeated).unwrap();
    assert_eq!(result.skipped_duplicates,2); assert!(result.note_ids.is_empty()); assert!(result.document_ids.is_empty());
    let another=subject(&mut connection); let result=import_batch(&mut connection,batch(&another)).unwrap();
    assert_eq!(result.document_ids.len(),1); assert_eq!(result.flashcard_ids.len(),1);
}

#[test]
fn same_text_with_a_different_study_image_is_a_distinct_card() {
    let mut connection=memory(); let subject_id=subject(&mut connection); import_batch(&mut connection,batch(&subject_id)).unwrap();
    let mut input=batch(&subject_id); input.notes.clear(); input.documents.clear(); input.flashcards[0].note_index=None;
    let image=STANDARD.decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7").unwrap();
    let image_hash=format!("{:x}",Sha256::digest(&image)); input.assets[0].sha256=image_hash.clone(); input.assets[0].data_base64=STANDARD.encode(image);
    input.assets[0].file_name="other-diagram.gif".into(); input.assets[0].mime_type="image/gif".into();
    input.flashcards[0].images[0].asset_hash=image_hash;
    let result=import_batch(&mut connection,input).unwrap(); assert_eq!(result.flashcard_ids.len(),1); assert_eq!(result.skipped_duplicates,0);
    assert_eq!(storage::get_snapshot(&mut connection).unwrap().card_metadata.len(),2);
}

#[test]
fn duplicate_hash_does_not_bypass_original_byte_integrity_validation() {
    let mut connection=memory(); let subject_id=subject(&mut connection); import_batch(&mut connection,batch(&subject_id)).unwrap();
    let before=storage::get_snapshot(&mut connection).unwrap(); let mut forged=batch(&subject_id);
    forged.documents[0].data_base64=STANDARD.encode(b"forged bytes");
    assert!(import_batch(&mut connection,forged).unwrap_err().to_string().contains("integridade"));
    assert_eq!(storage::get_snapshot(&mut connection).unwrap(),before);
}

#[test]
fn invalid_file_image_reference_and_pages_roll_back_the_whole_batch() {
    let mut connection=memory(); let subject_id=subject(&mut connection); let before=storage::get_snapshot(&mut connection).unwrap();
    for variant in 0..5 {
        let mut invalid=batch(&subject_id);
        match variant {
            0=>invalid.documents[0].sha256="0".repeat(64),
            1=>invalid.assets[0].sha256="0".repeat(64),
            2=>invalid.assets.clear(),
            3=>invalid.flashcards[0].note_index=Some(4),
            _=>invalid.documents[0].pages[1].page=1,
        }
        assert!(import_batch(&mut connection,invalid).is_err()); assert_eq!(storage::get_snapshot(&mut connection).unwrap(),before);
        assert!(export_materials(&connection).unwrap().assets.is_empty());
    }
    assert_eq!(import_batch(&mut connection,batch(&subject_id)).unwrap().document_ids.len(),1);
}

#[test]
fn sqlite_statement_failure_rolls_back_notes_cards_assets_and_originals() {
    let mut connection=memory(); let subject_id=subject(&mut connection);
    connection.execute_batch("CREATE TRIGGER qa_disk_failure BEFORE INSERT ON documents BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;").unwrap();
    let before=storage::get_snapshot(&mut connection).unwrap(); assert!(import_batch(&mut connection,batch(&subject_id)).is_err());
    assert_eq!(storage::get_snapshot(&mut connection).unwrap(),before); assert!(export_materials(&connection).unwrap().assets.is_empty());
    connection.execute_batch("DROP TRIGGER qa_disk_failure;").unwrap(); assert_eq!(import_batch(&mut connection,batch(&subject_id)).unwrap().document_ids.len(),1);
}

#[test]
fn actual_version_one_migration_keeps_existing_notes_revision_dates_and_theme() {
    let mut connection=Connection::open_in_memory().unwrap(); connection.pragma_update(None,"foreign_keys","ON").unwrap();
    connection.execute_batch(include_str!("../../../db/migrations/001_initial.sql")).unwrap();
    connection.execute("INSERT INTO subjects VALUES ('legacy','Legado','blue',?1,?1)",["2026-10-13T12:00:00.000Z"]).unwrap();
    connection.execute("INSERT INTO notes VALUES ('legacy-note','legacy','Nota anterior',?1,'Fonte preservada.',7,?2,?2)",params![json!({"type":"doc","content":[{"type":"paragraph"}]}).to_string(),"2026-10-13T12:00:00.000Z"]).unwrap();
    connection.execute("UPDATE settings SET value='dark' WHERE key='theme'",[]).unwrap(); storage::migrate(&mut connection).unwrap();
    let snapshot=storage::get_snapshot(&mut connection).unwrap(); assert_eq!(snapshot.notes[0].id,"legacy-note"); assert_eq!(snapshot.notes[0].revision,7);
    assert_eq!(snapshot.notes[0].plain_text,"Fonte preservada."); assert_eq!(snapshot.notes[0].created_at,"2026-10-13T12:00:00.000Z");
    assert_eq!(snapshot.settings.theme,crate::models::Theme::Dark); assert!(snapshot.documents.is_empty());
    assert_eq!(connection.pragma_query_value(None,"user_version",|r|r.get::<_,i32>(0)).unwrap(),6);
    import_batch(&mut connection,batch("legacy")).unwrap(); assert!(storage::get_snapshot(&mut connection).unwrap().notes.iter().any(|n|n.id=="legacy-note"&&n.revision==7));
}

#[test]
fn backup_roundtrip_restores_originals_and_accepts_legacy_version_one() {
    let mut source=memory(); let subject_id=subject(&mut source); let input=batch(&subject_id); let original=input.documents[0].data_base64.clone();
    let result=import_batch(&mut source,input).unwrap(); let backup=storage::export_backup(&mut source).unwrap(); assert_eq!(backup.version,2);
    let mut invalid:crate::models::BackupDocument=serde_json::from_value(serde_json::to_value(&backup).unwrap()).unwrap();
    invalid.materials.as_mut().unwrap().documents[0].data_base64=STANDARD.encode(b"modified");
    let mut target=memory(); assert!(storage::restore_backup(&mut target,invalid).is_err()); assert!(storage::get_snapshot(&mut target).unwrap().subjects.is_empty());
    let serialized=serde_json::to_value(&backup).unwrap(); storage::restore_backup(&mut target,serde_json::from_value(serialized.clone()).unwrap()).unwrap();
    assert_eq!(storage::get_snapshot(&mut target).unwrap(),backup.data); assert_eq!(get_document(&target,&result.document_ids[0]).unwrap().data_base64,original);
    let mut legacy=serialized; legacy["version"]=json!(1); legacy.as_object_mut().unwrap().remove("materials"); legacy["data"].as_object_mut().unwrap().remove("documents"); legacy["data"].as_object_mut().unwrap().remove("cardMetadata");
    let mut empty=memory(); storage::restore_backup(&mut empty,serde_json::from_value(legacy).unwrap()).unwrap();
    let snapshot=storage::get_snapshot(&mut empty).unwrap(); assert_eq!(snapshot.notes,backup.data.notes); assert!(snapshot.documents.is_empty());
}
