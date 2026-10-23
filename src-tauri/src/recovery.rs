//! Private, verified SQLite checkpoints. Never replace or restore over the live database.
use crate::{backup_archive::{ArchiveSessions, ExportStart}, error::{StoreError, StoreResult}, storage};
use chrono::{SecondsFormat, Utc};
use rusqlite::{backup::Backup, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs::{self, File, OpenOptions}, io::{Read, Write}, path::{Path, PathBuf}, time::Duration};
use uuid::Uuid;

const RETAIN: usize = 3;
const METADATA_LIMIT: u64 = 4 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryMetadata {
    pub id: String,
    pub format: String,
    pub version: u32,
    pub schema_version: i32,
    pub target_schema_version: i32,
    pub created_at: String,
    pub reason: String,
    pub byte_length: u64,
    pub sha256: String,
}

fn invalid() -> StoreError {
    StoreError::Invalid("A cópia de recuperação está incompleta ou falhou na verificação de integridade. O banco original foi preservado.".into())
}

fn next_timestamp(now: chrono::DateTime<Utc>, previous: Option<&str>) -> StoreResult<String> {
    let candidate = now.to_rfc3339_opts(SecondsFormat::Millis, true);
    if let Some(previous) = previous {
        // Compare at stored millisecond precision, not Utc::now's nanoseconds.
        if candidate.as_str() <= previous {
            let last = chrono::DateTime::parse_from_rfc3339(previous).map_err(|_| invalid())?.with_timezone(&Utc);
            return Ok((last + chrono::Duration::milliseconds(1)).to_rfc3339_opts(SecondsFormat::Millis, true));
        }
    }
    Ok(candidate)
}

pub(crate) fn directory(connection: &Connection) -> Option<PathBuf> {
    connection.path().filter(|p| !p.is_empty() && *p != ":memory:")
        .and_then(|p| Path::new(p).parent()).map(|p| p.join("recovery"))
}

fn valid_id(id: &str) -> bool {
    Uuid::parse_str(id).is_ok_and(|uuid| uuid.to_string() == id)
}

fn digest(path: &Path) -> StoreResult<(u64, String)> {
    let mut file = File::open(path)?;
    let mut hash = Sha256::new();
    let mut count = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let length = file.read(&mut buffer)?;
        if length == 0 { break; }
        count += length as u64;
        hash.update(&buffer[..length]);
    }
    Ok((count, format!("{:x}", hash.finalize())))
}

fn readonly(path: &Path) -> StoreResult<Connection> {
    Ok(Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?)
}

fn check_database(connection: &Connection, expected: i32) -> StoreResult<()> {
    if storage::schema_version(connection)? != expected { return Err(invalid()); }
    storage::check_integrity(connection)?;
    storage::check_readable(connection, expected)
}

fn read_verified(root: &Path, id: &str) -> StoreResult<RecoveryMetadata> {
    if !valid_id(id) { return Err(invalid()); }
    let folder = root.join(id);
    let folder_meta = fs::symlink_metadata(&folder)?;
    if !folder_meta.is_dir() || folder_meta.file_type().is_symlink() { return Err(invalid()); }
    let metadata_path = folder.join("metadata.json");
    let file_meta = fs::symlink_metadata(&metadata_path)?;
    if !file_meta.is_file() || file_meta.file_type().is_symlink() || file_meta.len() > METADATA_LIMIT { return Err(invalid()); }
    let metadata: RecoveryMetadata = serde_json::from_reader(File::open(metadata_path)?)?;
    if metadata.id != id || metadata.format != "studyspace-recovery" || metadata.version != 1
        || metadata.reason != "before-migration" || metadata.schema_version < 0
        || metadata.target_schema_version <= metadata.schema_version || metadata.byte_length == 0 {
        return Err(invalid());
    }
    crate::validation::date(&metadata.created_at)?;
    crate::materials::check_hash(&metadata.sha256)?;
    let database_path = folder.join("database.sqlite3");
    let database_meta = fs::symlink_metadata(&database_path)?;
    if !database_meta.is_file() || database_meta.file_type().is_symlink() { return Err(invalid()); }
    let (length, hash) = digest(&database_path)?;
    if length != metadata.byte_length || hash != metadata.sha256 { return Err(invalid()); }
    let database = readonly(&database_path)?;
    check_database(&database, metadata.schema_version)?;
    Ok(metadata)
}

pub(crate) fn list_directory(root: &Path) -> StoreResult<Vec<RecoveryMetadata>> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut copies = Vec::new();
    for entry in entries {
        let entry = entry?;
        if let Some(id) = entry.file_name().to_str() {
            if let Ok(metadata) = read_verified(root, id) { copies.push(metadata); }
        }
    }
    copies.sort_by(|a, b| b.created_at.cmp(&a.created_at).then_with(|| b.id.cmp(&a.id)));
    Ok(copies)
}

pub fn list(connection: &Connection) -> StoreResult<Vec<RecoveryMetadata>> {
    directory(connection).map_or_else(|| Ok(Vec::new()), |root| list_directory(&root))
}

pub(crate) fn create_copy(source: &Connection, root: &Path, version: i32, target: i32) -> StoreResult<RecoveryMetadata> {
    create_copy_with_hook(source, root, version, target, |_| Ok(()))
}

fn create_copy_with_hook(source: &Connection, root: &Path, version: i32, target: i32, mut hook: impl FnMut(&str) -> StoreResult<()>) -> StoreResult<RecoveryMetadata> {
    fs::create_dir_all(root)?;
    let id = Uuid::new_v4().to_string();
    let pending = root.join(format!(".pending-{id}"));
    fs::create_dir(&pending)?;
    let result = (|| {
        hook("before-database")?;
        let database_path = pending.join("database.sqlite3");
        {
            let mut database = Connection::open(&database_path)?;
            // SQLite's API captures committed WAL pages from the held source snapshot.
            Backup::new(source, &mut database)?.run_to_completion(128, Duration::from_millis(1), None)?;
            check_database(&database, version)?;
        }
        OpenOptions::new().read(true).write(true).open(&database_path)?.sync_all()?;
        hook("after-database")?;
        let (byte_length, sha256) = digest(&database_path)?;
        let existing = list_directory(root)?;
        if let Some(previous) = existing.iter().find(|copy| copy.schema_version == version && copy.target_schema_version == target && copy.sha256 == sha256) {
            return Ok(previous.clone());
        }
        let created_at = next_timestamp(Utc::now(), existing.first().map(|previous| previous.created_at.as_str()))?;
        let metadata = RecoveryMetadata { id: id.clone(), format: "studyspace-recovery".into(), version: 1,
            schema_version: version, target_schema_version: target,
            created_at, reason: "before-migration".into(), byte_length, sha256 };
        hook("before-metadata")?;
        let mut file = OpenOptions::new().write(true).create_new(true).open(pending.join("metadata.json"))?;
        file.write_all(&serde_json::to_vec(&metadata)?)?;
        file.sync_all()?;
        drop(file);
        hook("before-publish")?;
        // The destination is a new UUID and rename happens within the same private directory.
        fs::rename(&pending, root.join(&id))?;
        let published = read_verified(root, &id)?;
        // Retention starts only after the newly published copy passes every verification.
        let copies = list_directory(root)?;
        let mut kept = 1;
        for copy in copies.into_iter().filter(|copy| copy.id != id) {
            if kept < RETAIN { kept += 1; } else { let _ = fs::remove_dir_all(root.join(copy.id)); }
        }
        Ok(published)
    })();
    // Clean only this attempt's own private staging. A process crash leaves an ignored pending directory.
    if pending.exists() { let _ = fs::remove_dir_all(&pending); }
    result
}

pub fn export_begin(connection: &Connection, sessions: &mut ArchiveSessions, id: &str) -> StoreResult<ExportStart> {
    let root = directory(connection).ok_or_else(invalid)?;
    let metadata = read_verified(&root, id)?;
    let saved = readonly(&root.join(&metadata.id).join("database.sqlite3"))?;
    let mut isolated = Connection::open_in_memory()?;
    Backup::new(&saved, &mut isolated)?.run_to_completion(128, Duration::from_millis(1), None)?;
    isolated.pragma_update(None, "foreign_keys", "ON")?;
    // Older recovery schemas are migrated only in isolated staging; the saved copy remains immutable.
    storage::migrate(&mut isolated)?;
    sessions.export_begin(&mut isolated)
}

#[cfg(test)]
mod tests;
