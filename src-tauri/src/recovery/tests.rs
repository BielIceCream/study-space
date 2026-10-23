use super::*;
use crate::models::BackupDocument;
use tempfile::TempDir;

fn fixture() -> BackupDocument {
    serde_json::from_str(include_str!("../../../tests/fixtures/recovery-parity.json")).unwrap()
}

#[test]
fn real_version_four_migration_preserves_history_without_enrolling_cards() {
    let (_directory, mut source, path) = seeded();
    let expected = storage::get_snapshot(&mut source).unwrap();
    source.execute_batch("DROP TABLE error_entries; DROP TABLE review_schedules; PRAGMA user_version=4;").unwrap();
    source.close().unwrap();
    let mut reopened = storage::open(&path).unwrap();
    assert_eq!(storage::schema_version(&reopened).unwrap(), 6);
    assert_eq!(storage::get_snapshot(&mut reopened).unwrap(), expected);
    let copies = list(&reopened).unwrap();
    assert_eq!(copies.len(), 1);
    assert_eq!(copies[0].schema_version, 4);
    assert_eq!(copies[0].target_schema_version, 6);
    let root = directory(&reopened).unwrap();
    read_verified(&root, &copies[0].id).unwrap();
}

#[test]
fn schema_three_migration_preserves_tracks_and_recovery_before_planner_tables() {
    let (_directory,mut source,path)=seeded();
    storage::save_study_track(&mut source,crate::study::tests::input()).unwrap();
    let expected=storage::get_snapshot(&mut source).unwrap();
    source.execute_batch("DROP TABLE error_entries; DROP TABLE review_schedules; DROP TABLE study_planners; PRAGMA user_version=3;").unwrap();
    assert!(storage::migrate_plan(&mut source,&[(4,"CREATE TABLE study_planners(track_id TEXT PRIMARY KEY,data_json TEXT); UPDATE subjects SET name='candidate'; SELECT * FROM migration_fault;")],4).is_err());
    assert_eq!(storage::schema_version(&source).unwrap(),3);
    let copies=list(&source).unwrap(); assert_eq!(copies.len(),1);
    assert_eq!(copies[0].schema_version,3); assert_eq!(copies[0].target_schema_version,4);
    let root=directory(&source).unwrap(); read_verified(&root,&copies[0].id).unwrap();
    source.close().unwrap(); let mut reopened=storage::open(&path).unwrap();
    assert_eq!(storage::get_snapshot(&mut reopened).unwrap(),expected);
    assert_eq!(list(&reopened).unwrap().len(),2);
}

#[test]
fn actual_version_two_migration_is_guarded_and_retries_after_sql_failure() {
    let (_directory, mut source, path) = seeded();
    let expected = storage::get_snapshot(&mut source).unwrap();
    source.execute_batch("DROP TABLE error_entries; DROP TABLE review_schedules; DROP TABLE study_planners; DROP TABLE study_tracks; PRAGMA user_version=2;").unwrap();
    let failed = storage::migrate_plan(&mut source, &[(3,include_str!("../../../db/migrations/003_study_tracks.sql")),(4,"UPDATE subjects SET name='candidato'; SELECT * FROM migration_fault;")],4);
    assert!(failed.is_err());
    assert_eq!(storage::schema_version(&source).unwrap(),2);
    let exists: bool = source.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='study_tracks')",[],|row|row.get(0)).unwrap();
    assert!(!exists);
    let copies = list(&source).unwrap(); assert_eq!(copies.len(),1);
    assert_eq!(copies[0].schema_version,2); assert_eq!(copies[0].target_schema_version,4);
    let root = directory(&source).unwrap(); read_verified(&root,&copies[0].id).unwrap();
    source.close().unwrap();
    let mut migrated = storage::open(&path).unwrap();
    assert_eq!(storage::schema_version(&migrated).unwrap(),6);
    assert_eq!(storage::get_snapshot(&mut migrated).unwrap(),expected);
    assert_eq!(list(&migrated).unwrap().len(),2);
}

fn seeded() -> (TempDir, Connection, PathBuf) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("studyspace.sqlite3");
    let mut database = storage::open(&path).unwrap();
    database.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
    storage::restore_backup(&mut database, fixture()).unwrap();
    (directory, database, path)
}

#[test]
fn retention_timestamps_remain_ordered_with_submillisecond_ties_and_clock_rollback() {
    let last = "2026-10-19T12:00:00.000Z";
    let submillisecond = chrono::DateTime::parse_from_rfc3339("2026-10-19T12:00:00.000100Z").unwrap().with_timezone(&Utc);
    assert_eq!(next_timestamp(submillisecond, Some(last)).unwrap(), "2026-10-19T12:00:00.001Z");
    let rolled_back = chrono::DateTime::parse_from_rfc3339("2026-10-18T12:00:00.000Z").unwrap().with_timezone(&Utc);
    assert_eq!(next_timestamp(rolled_back, Some(last)).unwrap(), "2026-10-19T12:00:00.001Z");
    assert_eq!(next_timestamp(submillisecond, None).unwrap(), last);
}

#[test]
fn wal_checkpoint_contains_committed_originals_and_recovers_in_isolation() {
    let (_directory, mut source, path) = seeded();
    let expected = storage::get_snapshot(&mut source).unwrap();
    assert!(fs::metadata(format!("{}-wal", path.display())).unwrap().len() > 32);
    let root = directory(&source).unwrap();
    let tx = source.transaction().unwrap();
    storage::schema_version(&tx).unwrap();
    let metadata = create_copy(&tx, &root, 6, 7).unwrap();
    tx.commit().unwrap();
    assert_eq!(read_verified(&root, &metadata.id).unwrap(), metadata);
    let saved = readonly(&root.join(&metadata.id).join("database.sqlite3")).unwrap();
    let mut recovered = Connection::open_in_memory().unwrap();
    Backup::new(&saved, &mut recovered).unwrap().run_to_completion(128, Duration::from_millis(1), None).unwrap();
    assert_eq!(storage::get_snapshot(&mut recovered).unwrap(), expected);
    assert_eq!(storage::export_backup(&mut recovered).unwrap().materials, fixture().materials);
    assert_eq!(storage::schema_version(&source).unwrap(), 6);
}

#[test]
fn all_pending_migrations_rollback_and_keep_the_verified_checkpoint() {
    let (_directory, mut source, _path) = seeded();
    let before = storage::get_snapshot(&mut source).unwrap();
    let result = storage::migrate_plan(&mut source, &[(7, "UPDATE subjects SET name='candidato'; SELECT * FROM migration_fault;")], 7);
    assert!(result.is_err());
    assert_eq!(storage::schema_version(&source).unwrap(), 6);
    assert_eq!(storage::get_snapshot(&mut source).unwrap(), before);
    let copies = list(&source).unwrap();
    assert_eq!(copies.len(), 1);
    assert_eq!(copies[0].schema_version, 6);
    assert_eq!(copies[0].target_schema_version, 7);
    // Retry does not replace the only known-good copy.
    assert!(storage::migrate_plan(&mut source, &[(7, "SELECT * FROM migration_fault;")], 7).is_err());
    assert_eq!(list(&source).unwrap()[0].id, copies[0].id);
}

#[test]
fn publication_failures_and_abandoned_staging_keep_the_previous_valid_copy() {
    let (_directory, mut source, _path) = seeded();
    let root = directory(&source).unwrap();
    let first = create_copy(&source, &root, 6, 7).unwrap();
    source.execute("UPDATE subjects SET name='outro estado'", []).unwrap();
    let before = storage::get_snapshot(&mut source).unwrap();
    for failure in ["before-database", "after-database", "before-metadata", "before-publish"] {
        let result = create_copy_with_hook(&source, &root, 6, 7, |step| {
            if step == failure { return Err(std::io::Error::new(std::io::ErrorKind::StorageFull, "quota sintética").into()); }
            Ok(())
        });
        assert!(result.is_err());
        assert_eq!(read_verified(&root, &first.id).unwrap(), first);
        assert_eq!(storage::get_snapshot(&mut source).unwrap(), before);
    }
    let abandoned = root.join(format!(".pending-{}", Uuid::new_v4()));
    fs::create_dir(&abandoned).unwrap();
    fs::write(abandoned.join("database.sqlite3"), b"truncado").unwrap();
    assert_eq!(list_directory(&root).unwrap(), vec![first]);
}

#[test]
fn actual_recovery_io_failure_prevents_migration() {
    let (_directory, mut source, _path) = seeded();
    let before = storage::get_snapshot(&mut source).unwrap();
    let root = directory(&source).unwrap();
    fs::write(&root, b"caminho ocupado").unwrap();
    assert!(storage::migrate_plan(&mut source, &[(7, "CREATE TABLE future (id INTEGER);")], 7).is_err());
    assert_eq!(storage::get_snapshot(&mut source).unwrap(), before);
    assert_eq!(storage::schema_version(&source).unwrap(), 6);
}

#[test]
fn retention_and_corruption_never_replace_the_live_library() {
    let (_directory, mut source, _path) = seeded();
    let root = directory(&source).unwrap();
    for index in 0..5 {
        source.execute("UPDATE subjects SET name=?1", [format!("estado-{index}")]).unwrap();
        create_copy(&source, &root, 6, 7).unwrap();
    }
    let copies = list_directory(&root).unwrap();
    assert_eq!(copies.len(), 3);
    let names = copies.iter().map(|copy| {
        let db = readonly(&root.join(&copy.id).join("database.sqlite3")).unwrap();
        db.query_row("SELECT name FROM subjects", [], |row| row.get::<_, String>(0)).unwrap()
    }).collect::<Vec<_>>();
    assert_eq!(names, ["estado-4", "estado-3", "estado-2"]);
    let before = storage::get_snapshot(&mut source).unwrap();
    let bad_path = root.join(&copies[0].id).join("database.sqlite3");
    let mut bytes = fs::read(&bad_path).unwrap();
    let last = bytes.len() - 1; bytes[last] ^= 1;
    fs::write(bad_path, bytes).unwrap();
    assert!(export_begin(&source, &mut ArchiveSessions::default(), &copies[0].id).is_err());
    assert_eq!(list_directory(&root).unwrap().len(), 2);
    assert_eq!(storage::get_snapshot(&mut source).unwrap(), before);
    assert!(export_begin(&source, &mut ArchiveSessions::default(), "../../studyspace").is_err());
}

#[test]
fn future_version_is_rejected_without_changing_the_file() {
    let (_directory, source, path) = seeded();
    source.pragma_update(None, "user_version", 99).unwrap();
    drop(source);
    let bytes = fs::read(&path).unwrap();
    assert!(storage::open(&path).is_err());
    assert_eq!(fs::read(&path).unwrap(), bytes);
}

#[test]
fn another_wal_writer_invalidates_the_migration_write_upgrade() {
    let (_directory, mut source, path) = seeded();
    let root = directory(&source).unwrap();
    let tx = source.transaction().unwrap();
    storage::schema_version(&tx).unwrap();
    create_copy_with_hook(&tx, &root, 6, 7, |step| {
        if step == "before-publish" {
            let other = Connection::open(&path)?;
            other.execute("UPDATE subjects SET name='escrita concorrente'", [])?;
        }
        Ok(())
    }).unwrap();
    assert!(tx.execute_batch("CREATE TABLE future (id INTEGER);").is_err());
    drop(tx);
    assert_eq!(storage::schema_version(&source).unwrap(), 6);
    assert_eq!(storage::get_snapshot(&mut source).unwrap().subjects[0].name, "escrita concorrente");
}

#[test]
#[ignore = "Executado pelo script recovery-parity.mjs com arquivos sintéticos de entrada e saída"]
fn browser_recovery_roundtrips_through_native_empty_destination() {
    let input = PathBuf::from(std::env::var("STUDYSPACE_PARITY_INPUT").unwrap());
    let output = PathBuf::from(std::env::var("STUDYSPACE_PARITY_OUTPUT").unwrap());
    let metadata: RecoveryMetadata = serde_json::from_slice(&fs::read(format!("{}.metadata.json", input.display())).unwrap()).unwrap();
    let (length, hash) = digest(&input).unwrap();
    assert_eq!(length, metadata.byte_length);
    assert_eq!(hash, metadata.sha256);
    let saved = readonly(&input).unwrap();
    check_database(&saved, metadata.schema_version).unwrap();
    let mut target = Connection::open_in_memory().unwrap();
    Backup::new(&saved, &mut target).unwrap().run_to_completion(128, Duration::from_millis(1), None).unwrap();
    target.pragma_update(None, "foreign_keys", "ON").unwrap();
    storage::migrate(&mut target).unwrap();
    let mut sessions = ArchiveSessions::default();
    let result = sessions.export_begin(&mut target).unwrap();
    let manifest = serde_json::to_value(&result).unwrap()["manifest"].clone();
    let material_count = manifest["materials"]["documents"].as_array().unwrap().len()
        + manifest["materials"]["assets"].as_array().unwrap().len();
    let materials = (0..material_count).map(|index| sessions.export_material(&serde_json::to_value(&result).unwrap()["token"].as_str().unwrap(), index).unwrap()).collect::<Vec<_>>();
    let expected = fixture().data;
    let actual = storage::get_snapshot(&mut target).unwrap();
    assert_eq!(actual.subjects, expected.subjects);
    assert_eq!(actual.notes, expected.notes);
    assert_eq!(actual.flashcards, expected.flashcards);
    assert!(expected.review_logs.iter().all(|review| actual.review_logs.contains(review)));
    assert_eq!(actual.documents, expected.documents);
    assert_eq!(actual.card_metadata, expected.card_metadata);
    assert_eq!(actual.settings, expected.settings);
    let json = serde_json::json!({ "manifest": manifest, "materials": materials });
    fs::write(output, serde_json::to_vec_pretty(&json).unwrap()).unwrap();
}

#[test]
fn real_schema_five_upgrade_retains_schedule_and_verified_recovery_before_error_table() {
    let (_directory,mut source,path)=seeded();
    let card=storage::get_snapshot(&mut source).unwrap().flashcards[0].clone();
    storage::record_review(&mut source,crate::models::ReviewInput { flashcard_id:card.id,session_id:"pre-notebook".into(),rating:3,schedule:true,admission:None }).unwrap();
    let expected=storage::get_snapshot(&mut source).unwrap();
    source.execute_batch("DROP TABLE error_entries; PRAGMA user_version=5;").unwrap();
    source.close().unwrap();
    let mut upgraded=storage::open(&path).unwrap();
    assert_eq!(storage::schema_version(&upgraded).unwrap(),6);
    assert_eq!(storage::get_snapshot(&mut upgraded).unwrap(),expected);
    let copies=list(&upgraded).unwrap();assert_eq!(copies.len(),1);
    assert_eq!(copies[0].schema_version,5);assert_eq!(copies[0].target_schema_version,6);
    let root=directory(&upgraded).unwrap();read_verified(&root,&copies[0].id).unwrap();
    let mut sessions=ArchiveSessions::default();
    let export=export_begin(&upgraded,&mut sessions,&copies[0].id).unwrap();
    assert_eq!(serde_json::to_value(export).unwrap()["manifest"]["version"],6);
}
