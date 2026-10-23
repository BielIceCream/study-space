//! Native archive staging. Only one material crosses IPC at a time; the live database
//! is changed solely by the final, atomic restore transaction.
use crate::{error::{StoreError, StoreResult}, materials, models::Snapshot, storage, validation};
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{backup::Backup, params, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{collections::{HashMap, HashSet}, time::{Duration, Instant}};

const MAX_MANIFEST: usize = 50 * 1024 * 1024;
const MAX_ARCHIVE: usize = 256 * 1024 * 1024;
const HEADER_BYTES: usize = 56;
const SESSION_TTL: Duration = Duration::from_secs(10 * 60);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentDescriptor {
    document_id: String,
    byte_length: usize,
    pages: Vec<materials::Page>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetDescriptor {
    sha256: String,
    file_name: String,
    mime_type: String,
    byte_length: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ManifestMaterials {
    documents: Vec<DocumentDescriptor>,
    assets: Vec<AssetDescriptor>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchiveManifest {
    format: String,
    version: u32,
    exported_at: String,
    data: Snapshot,
    materials: ManifestMaterials,
}

#[derive(Serialize)]
pub struct ExportStart {
    token: String,
    manifest: ArchiveManifest,
}

struct Session {
    token: String,
    touched: Instant,
    manifest: ArchiveManifest,
    database: Connection,
    received: HashSet<usize>,
    document_indices: HashMap<String, usize>,
}

impl Session {
    fn new(token: String, manifest: ArchiveManifest, database: Connection) -> Self {
        let document_indices = manifest.data.documents.iter().enumerate()
            .map(|(index, document)| (document.id.clone(), index)).collect();
        Self { token, touched: Instant::now(), manifest, database, received: HashSet::new(), document_indices }
    }
}

#[derive(Default)]
pub struct ArchiveSessions {
    export: Option<Session>,
    restore: Option<Session>,
}

fn invalid(message: &str) -> StoreError { StoreError::Invalid(message.into()) }

fn validate_manifest(manifest: &ArchiveManifest) -> StoreResult<()> {
    if manifest.format != "studyspace-backup" || !matches!(manifest.version, 3 | 4 | 5 | 6 | 7) {
        return Err(invalid("O formato do backup escalável não é compatível."));
    }
    if manifest.version == 3 && !manifest.data.study_tracks.is_empty() {
        return Err(invalid("Trilhas e diagnósticos exigem um arquivo .studyspace da versão 4."));
    }
    if manifest.version < 5 && !manifest.data.study_planners.is_empty() {
        return Err(invalid("A agenda exige um backup .studyspace da versão 5."));
    }
    if manifest.version < 7 && !manifest.data.error_entries.is_empty() {
        return Err(invalid("O caderno de erros exige um arquivo .studyspace da versão 7."));
    }
    if manifest.version < 6 && !manifest.data.review_schedules.is_empty() {
        return Err(invalid("A agenda de revisão exige um backup .studyspace da versão 6."));
    }
    validation::date(&manifest.exported_at)?;
    let manifest_bytes = validation::json_size(manifest, MAX_MANIFEST, "O manifesto do backup")?;
    validation::snapshot(&manifest.data)?;
    if manifest.materials.documents.len() > 50_000 || manifest.materials.assets.len() > 100_000
        || manifest.data.card_metadata.len() > 200_000 {
        return Err(invalid("O backup excede o limite de materiais."));
    }
    let notes = manifest.data.notes.iter().map(|n| (n.id.as_str(), n.subject_id.as_str())).collect::<HashMap<_, _>>();
    let metadata = manifest.data.documents.iter().map(|d| (d.id.as_str(), d)).collect::<HashMap<_, _>>();
    if metadata.len() != manifest.data.documents.len() || metadata.len() != manifest.materials.documents.len() {
        return Err(invalid("O backup não contém os arquivos de todos os documentos."));
    }
    let mut seen = HashSet::new();
    let mut total = HEADER_BYTES + manifest_bytes;
    for descriptor in &manifest.materials.documents {
        let meta = metadata.get(descriptor.document_id.as_str()).ok_or_else(|| invalid("Um documento do manifesto está ausente."))?;
        validation::id(&meta.id)?;
        validation::id(&meta.subject_id)?;
        validation::id(&meta.note_id)?;
        validation::text(&meta.file_name, 255, "O nome do arquivo", false)?;
        validation::text(&meta.mime_type, 120, "O formato", false)?;
        validation::date(&meta.created_at)?;
        materials::check_hash(&meta.sha256)?;
        materials::check_pages(&descriptor.pages)?;
        if !seen.insert(&descriptor.document_id) || notes.get(meta.note_id.as_str()).copied() != Some(meta.subject_id.as_str())
            || !matches!(meta.kind.as_str(), "pdf" | "docx" | "txt" | "md" | "csv" | "json")
            || meta.page_count != descriptor.pages.len() || !(1..=32 * 1024 * 1024).contains(&descriptor.byte_length) {
            return Err(invalid("Os metadados do documento são inconsistentes."));
        }
        total = total.checked_add(descriptor.byte_length).ok_or_else(|| invalid("O backup excede 256 MiB."))?;
    }
    let mut assets = HashSet::new();
    for asset in &manifest.materials.assets {
        materials::check_hash(&asset.sha256)?;
        validation::text(&asset.file_name, 255, "O nome do arquivo", false)?;
        if !assets.insert(asset.sha256.as_str()) || !(1..=8 * 1024 * 1024).contains(&asset.byte_length)
            || !matches!(asset.mime_type.as_str(), "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/bmp") {
            return Err(invalid("Os metadados da imagem são inconsistentes."));
        }
        total = total.checked_add(asset.byte_length).ok_or_else(|| invalid("O backup excede 256 MiB."))?;
    }
    if total > MAX_ARCHIVE { return Err(invalid("O backup escalável deve ter até 256 MiB.")); }
    let cards = manifest.data.flashcards.iter().map(|c| c.id.as_str()).collect::<HashSet<_>>();
    let mut card_metadata = HashSet::new();
    for meta in &manifest.data.card_metadata {
        materials::check_images(&meta.tags, &meta.images)?;
        if !cards.contains(meta.flashcard_id.as_str()) || !card_metadata.insert(meta.flashcard_id.as_str())
            || meta.images.iter().any(|image| !assets.contains(image.asset_hash.as_str())) {
            return Err(invalid("O backup contém imagens ou metadados de cartão inconsistentes."));
        }
    }
    Ok(())
}

impl ArchiveSessions {
    fn expire(&mut self) {
        if self.export.as_ref().is_some_and(|s| s.touched.elapsed() > SESSION_TTL) { self.export = None; }
        if self.restore.as_ref().is_some_and(|s| s.touched.elapsed() > SESSION_TTL) { self.restore = None; }
    }

    pub fn cancel(&mut self, token: &str) {
        self.expire();
        if self.export.as_ref().is_some_and(|s| s.token == token) { self.export = None; }
        if self.restore.as_ref().is_some_and(|s| s.token == token) { self.restore = None; }
    }

    pub fn export_begin(&mut self, connection: &mut Connection) -> StoreResult<ExportStart> {
        self.expire();
        if self.export.is_some() { return Err(invalid("Já existe uma exportação em andamento.")); }
        let transaction = connection.transaction()?;
        let data = storage::snapshot(&transaction)?;
        let mut documents = Vec::new();
        for meta in &data.documents {
            let (size, pages): (usize, String) = transaction.query_row("SELECT length(file_bytes), pages_json FROM documents WHERE id=?1", [&meta.id], |row| Ok((row.get::<_, u32>(0)? as usize, row.get(1)?)))?;
            documents.push(DocumentDescriptor { document_id: meta.id.clone(), byte_length: size, pages: serde_json::from_str(&pages)? });
        }
        let assets = {
            let mut statement = transaction.prepare("SELECT sha256,file_name,mime_type,length(file_bytes) FROM material_assets ORDER BY sha256")?;
            let rows = statement.query_map([], |row| Ok(AssetDescriptor { sha256: row.get(0)?, file_name: row.get(1)?, mime_type: row.get(2)?, byte_length: row.get::<_, u32>(3)? as usize }))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        let manifest = ArchiveManifest { format: "studyspace-backup".into(), version: if !data.error_entries.is_empty() { 7 } else if !data.review_schedules.is_empty() { 6 } else if !data.study_planners.is_empty() { 5 } else if !data.study_tracks.is_empty() { 4 } else { 3 }, exported_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true), data, materials: ManifestMaterials { documents, assets } };
        validate_manifest(&manifest)?;
        let mut database = Connection::open_in_memory()?;
        {
            let backup = Backup::new(&transaction, &mut database)?;
            backup.run_to_completion(128, Duration::from_millis(1), None)?;
        }
        transaction.commit()?;
        let token = uuid::Uuid::new_v4().to_string();
        self.export = Some(Session::new(token.clone(), manifest.clone(), database));
        Ok(ExportStart { token, manifest })
    }

    pub fn export_material(&mut self, token: &str, index: usize) -> StoreResult<String> {
        self.expire();
        let session = self.export.as_mut().filter(|s| s.token == token).ok_or_else(|| invalid("A sessão de exportação expirou. Exporte o backup novamente."))?;
        session.touched = Instant::now();
        if let Some(doc) = session.manifest.materials.documents.get(index) {
            let bytes: Vec<u8> = session.database.query_row("SELECT file_bytes FROM documents WHERE id=?1", [&doc.document_id], |row| row.get(0))?;
            return Ok(STANDARD.encode(bytes));
        }
        let asset = index.checked_sub(session.manifest.materials.documents.len()).and_then(|i| session.manifest.materials.assets.get(i)).ok_or_else(|| invalid("O índice do material é inválido."))?;
        let bytes: Vec<u8> = session.database.query_row("SELECT file_bytes FROM material_assets WHERE sha256=?1", [&asset.sha256], |row| row.get(0))?;
        Ok(STANDARD.encode(bytes))
    }

    pub fn restore_begin(&mut self, manifest: ArchiveManifest) -> StoreResult<String> {
        self.expire();
        if self.restore.is_some() { return Err(invalid("Já existe uma restauração em andamento.")); }
        validate_manifest(&manifest)?;
        let mut database = Connection::open_in_memory()?;
        database.pragma_update(None, "foreign_keys", "ON")?;
        storage::migrate(&mut database)?;
        let transaction = database.transaction()?;
        storage::restore_snapshot(&transaction, &manifest.data)?;
        for meta in &manifest.data.card_metadata {
            transaction.execute("INSERT INTO card_metadata VALUES (?1,?2,?3)", params![meta.flashcard_id, serde_json::to_string(&meta.tags)?, serde_json::to_string(&meta.images)?])?;
        }
        transaction.commit()?;
        let token = uuid::Uuid::new_v4().to_string();
        self.restore = Some(Session::new(token.clone(), manifest, database));
        Ok(token)
    }

    pub fn restore_material(&mut self, token: &str, index: usize, data_base64: String) -> StoreResult<()> {
        self.expire();
        let session = self.restore.as_mut().filter(|s| s.token == token).ok_or_else(|| invalid("A sessão de restauração expirou. Selecione o backup novamente."))?;
        if session.received.contains(&index) { return Err(invalid("O material já foi recebido nesta restauração.")); }
        session.touched = Instant::now();
        if let Some(doc) = session.manifest.materials.documents.get(index) {
            let meta = session.document_indices.get(&doc.document_id)
                .and_then(|index| session.manifest.data.documents.get(*index))
                .ok_or_else(|| invalid("Os metadados do documento estão ausentes."))?;
            if data_base64.len() != doc.byte_length.div_ceil(3) * 4 { return Err(invalid("O tamanho do documento não confere.")); }
            let payload = materials::DocumentPayload { document_id: doc.document_id.clone(), pages: doc.pages.clone(), data_base64 };
            materials::insert_document(&session.database, meta, &payload)?;
            let actual: usize = session.database.query_row("SELECT length(file_bytes) FROM documents WHERE id=?1", [&meta.id], |row| row.get::<_, u32>(0).map(|size| size as usize))?;
            if actual != doc.byte_length { return Err(invalid("O tamanho do documento não confere.")); }
        } else {
            let asset = index.checked_sub(session.manifest.materials.documents.len()).and_then(|i| session.manifest.materials.assets.get(i)).ok_or_else(|| invalid("O índice do material é inválido."))?;
            if data_base64.len() != asset.byte_length.div_ceil(3) * 4 { return Err(invalid("O tamanho da imagem não confere.")); }
            materials::insert_asset(&session.database, &materials::Asset { sha256: asset.sha256.clone(), file_name: asset.file_name.clone(), mime_type: asset.mime_type.clone(), data_base64 })?;
            let actual: usize = session.database.query_row("SELECT length(file_bytes) FROM material_assets WHERE sha256=?1", [&asset.sha256], |row| row.get::<_, u32>(0).map(|size| size as usize))?;
            if actual != asset.byte_length { return Err(invalid("O tamanho da imagem não confere.")); }
        }
        session.received.insert(index);
        Ok(())
    }

    pub fn restore_finish(&mut self, connection: &mut Connection, token: &str) -> StoreResult<()> {
        self.expire();
        let session = self.restore.as_ref().filter(|s| s.token == token).ok_or_else(|| invalid("A sessão de restauração expirou. Selecione o backup novamente."))?;
        if session.received.len() != session.manifest.materials.documents.len() + session.manifest.materials.assets.len() {
            return Err(invalid("A restauração ainda não recebeu todos os materiais."));
        }
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let populated: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM subjects) OR EXISTS(SELECT 1 FROM notes) OR EXISTS(SELECT 1 FROM flashcards) OR EXISTS(SELECT 1 FROM review_logs) OR EXISTS(SELECT 1 FROM documents) OR EXISTS(SELECT 1 FROM material_assets) OR EXISTS(SELECT 1 FROM card_metadata) OR EXISTS(SELECT 1 FROM study_tracks) OR EXISTS(SELECT 1 FROM study_planners) OR EXISTS(SELECT 1 FROM review_schedules) OR EXISTS(SELECT 1 FROM error_entries)", [], |row| row.get(0))?;
        if populated { return Err(invalid("A restauração só está disponível em uma biblioteca vazia. Seus dados atuais foram preservados.")); }
        storage::restore_snapshot(&transaction, &session.manifest.data)?;
        // Materials were already decoded, hashed and validated in staging. Copy one
        // raw BLOB at a time without allocating another base64 string or rehashing it.
        for asset in &session.manifest.materials.assets {
            let bytes: Vec<u8> = session.database.query_row("SELECT file_bytes FROM material_assets WHERE sha256=?1", [&asset.sha256], |row| row.get(0))?;
            transaction.execute("INSERT INTO material_assets (sha256,file_name,mime_type,file_bytes) VALUES (?1,?2,?3,?4)",
                params![asset.sha256, asset.file_name, asset.mime_type, bytes])?;
        }
        for meta in &session.manifest.data.documents {
            let (bytes, pages): (Vec<u8>, String) = session.database.query_row("SELECT file_bytes,pages_json FROM documents WHERE id=?1", [&meta.id], |row| Ok((row.get(0)?, row.get(1)?)))?;
            transaction.execute("INSERT INTO documents (id,subject_id,note_id,file_name,kind,mime_type,sha256,page_count,pages_json,file_bytes,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                params![meta.id, meta.subject_id, meta.note_id, meta.file_name, meta.kind, meta.mime_type, meta.sha256, meta.page_count as i64, pages, bytes, meta.created_at])?;
        }
        for meta in &session.manifest.data.card_metadata {
            transaction.execute("INSERT INTO card_metadata VALUES (?1,?2,?3)", params![meta.flashcard_id, serde_json::to_string(&meta.tags)?, serde_json::to_string(&meta.images)?])?;
        }
        transaction.commit()?;
        self.restore = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
