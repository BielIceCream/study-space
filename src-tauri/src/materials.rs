use crate::{error::{StoreError, StoreResult}, models::BackupDocument, validation};
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection, OptionalExtension, Row, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct DocumentMetadata {pub id:String,pub subject_id:String,pub note_id:String,pub file_name:String,pub kind:String,pub mime_type:String,pub sha256:String,pub page_count:usize,pub created_at:String}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Page {pub page:usize,pub text:String}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct CardImage {pub asset_hash:String,pub side:String,#[serde(default,skip_serializing_if="Option::is_none")]pub alt:Option<String>}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct CardMetadata {pub flashcard_id:String,pub tags:Vec<String>,pub images:Vec<CardImage>}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Asset {pub sha256:String,pub file_name:String,pub mime_type:String,pub data_base64:String}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct DocumentPayload {pub document_id:String,pub data_base64:String,pub pages:Vec<Page>}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct BackupMaterials {pub documents:Vec<DocumentPayload>,pub assets:Vec<Asset>}
#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct StoredDocument {#[serde(flatten)]pub metadata:DocumentMetadata,pub data_base64:String,pub pages:Vec<Page>}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct ImportedNote {pub title:String,pub body_json:Value,pub plain_text:String}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct ImportedCard {pub front:String,pub back:String,#[serde(default)]pub note_index:Option<usize>,#[serde(default)]pub tags:Vec<String>,#[serde(default)]pub images:Vec<CardImage>}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct ImportedDocument {pub note_index:usize,pub file_name:String,pub kind:String,pub mime_type:String,pub sha256:String,pub data_base64:String,pub pages:Vec<Page>}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct ImportBatch {pub subject_id:String,pub source_name:String,pub format:String,pub notes:Vec<ImportedNote>,pub flashcards:Vec<ImportedCard>,pub documents:Vec<ImportedDocument>,pub assets:Vec<Asset>,pub warnings:Vec<String>}
#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct ImportResult {pub note_ids:Vec<String>,pub flashcard_ids:Vec<String>,pub document_ids:Vec<String>,pub skipped_duplicates:usize}
fn invalid(message:&str)->StoreError {StoreError::Invalid(message.into())}
fn check_hash(hash:&str)->StoreResult<()> {if hash.len()!=64 || !hash.bytes().all(|c|c.is_ascii_digit()||(b'a'..=b'f').contains(&c)){return Err(invalid("O hash do arquivo é inválido."));}Ok(())}
fn decode(data:&str,hash:&str,max:usize)->StoreResult<Vec<u8>> {
    check_hash(hash)?;if data.len()>max.div_ceil(3)*4{return Err(invalid("O arquivo excede o limite permitido."));}
    let bytes=STANDARD.decode(data).map_err(|_|invalid("O arquivo contém dados inválidos."))?;
    if bytes.is_empty()||bytes.len()>max{return Err(invalid("O arquivo está vazio ou excede o limite permitido."));}
    if format!("{:x}",Sha256::digest(&bytes))!=hash{return Err(invalid("A integridade do arquivo não confere."));}Ok(bytes)
}
fn check_pages(pages:&[Page])->StoreResult<()> {
    if pages.len()>10000{return Err(invalid("O documento excede o limite de páginas."));}
    let mut seen=HashSet::new();let mut total=0;
    for page in pages{if !(1..=10000).contains(&page.page)||!seen.insert(page.page){return Err(invalid("As páginas do documento são inconsistentes."));}validation::text(&page.text,2_000_000,"O texto da página",true)?;total+=page.text.len();}
    if total>8*1024*1024{return Err(invalid("O texto do documento excede o limite permitido."));}Ok(())
}
fn check_images(tags:&[String],images:&[CardImage])->StoreResult<()> {
    if tags.len()>100||images.len()>50{return Err(invalid("O cartão excede o limite de tags ou imagens."));}
    for tag in tags{validation::text(tag,120,"A tag",false)?;}
    for image in images{check_hash(&image.asset_hash)?;if !matches!(image.side.as_str(),"front"|"back"){return Err(invalid("A posição da imagem é inválida."));}if let Some(alt)=&image.alt{validation::text(alt,500,"A descrição da imagem",true)?;}}Ok(())
}
fn document_row(row:&Row<'_>)->rusqlite::Result<DocumentMetadata>{Ok(DocumentMetadata{id:row.get(0)?,subject_id:row.get(1)?,note_id:row.get(2)?,file_name:row.get(3)?,kind:row.get(4)?,mime_type:row.get(5)?,sha256:row.get(6)?,page_count:row.get::<_,u32>(7)? as usize,created_at:row.get(8)?})}
const DOCUMENT_COLUMNS:&str="id,subject_id,note_id,file_name,kind,mime_type,sha256,page_count,created_at";
pub fn metadata(connection:&Connection)->StoreResult<Vec<DocumentMetadata>>{
    let mut stmt=connection.prepare(&format!("SELECT {DOCUMENT_COLUMNS} FROM documents ORDER BY created_at,id"))?;
    let result=stmt.query_map([],document_row)?.collect::<rusqlite::Result<Vec<_>>>()?;Ok(result)
}
pub fn card_metadata(connection:&Connection)->StoreResult<Vec<CardMetadata>>{
    let mut stmt=connection.prepare("SELECT flashcard_id,tags_json,images_json FROM card_metadata")?;
    let rows=stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter().map(|(flashcard_id,tags,images)|Ok(CardMetadata{flashcard_id,tags:serde_json::from_str(&tags)?,images:serde_json::from_str(&images)?})).collect()
}
pub fn get_document(connection:&Connection,id:&str)->StoreResult<StoredDocument>{
    validation::id(id)?;let metadata=connection.query_row(&format!("SELECT {DOCUMENT_COLUMNS} FROM documents WHERE id=?1"),[id],document_row).optional()?.ok_or(StoreError::NotFound("O documento"))?;
    let (bytes,pages):(Vec<u8>,String)=connection.query_row("SELECT file_bytes,pages_json FROM documents WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?)))?;
    Ok(StoredDocument{metadata,data_base64:STANDARD.encode(bytes),pages:serde_json::from_str(&pages)?})
}
pub fn get_asset(connection:&Connection,hash:&str)->StoreResult<Asset>{
    check_hash(hash)?;let (file_name,mime_type,bytes):(String,String,Vec<u8>)=connection.query_row("SELECT file_name,mime_type,file_bytes FROM material_assets WHERE sha256=?1",[hash],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?.ok_or(StoreError::NotFound("A imagem"))?;
    Ok(Asset{sha256:hash.into(),file_name,mime_type,data_base64:STANDARD.encode(bytes)})
}
pub fn export_materials(connection:&Connection)->StoreResult<BackupMaterials>{
    let documents=metadata(connection)?.into_iter().map(|m|{let d=get_document(connection,&m.id)?;Ok(DocumentPayload{document_id:m.id,data_base64:d.data_base64,pages:d.pages})}).collect::<StoreResult<Vec<_>>>()?;
    let mut stmt=connection.prepare("SELECT sha256 FROM material_assets")?;let hashes=stmt.query_map([],|r|r.get::<_,String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    let assets=hashes.iter().map(|h|get_asset(connection,h)).collect::<StoreResult<Vec<_>>>()?;Ok(BackupMaterials{documents,assets})
}
fn asset_bytes(asset:&Asset)->StoreResult<Vec<u8>>{
    validation::text(&asset.file_name,255,"O nome do arquivo",false)?;let b=decode(&asset.data_base64,&asset.sha256,8*1024*1024)?;
    let valid=match asset.mime_type.as_str(){"image/png"=>b.starts_with(b"\x89PNG\r\n\x1a\n"),"image/jpeg"=>b.starts_with(b"\xff\xd8\xff"),"image/gif"=>b.starts_with(b"GIF87a")||b.starts_with(b"GIF89a"),"image/bmp"=>b.len()>=54&&b.starts_with(b"BM"),"image/webp"=>b.starts_with(b"RIFF")&&b.get(8..12)==Some(b"WEBP"),_=>false};
    if !valid{return Err(invalid("O formato da imagem não confere com seu conteúdo."));}Ok(b)
}
fn insert_asset(connection:&Connection,asset:&Asset)->StoreResult<()>{let bytes=asset_bytes(asset)?;connection.execute("INSERT OR IGNORE INTO material_assets VALUES (?1,?2,?3,?4)",params![asset.sha256,asset.file_name,asset.mime_type,bytes])?;Ok(())}
fn insert_document(connection:&Connection,meta:&DocumentMetadata,payload:&DocumentPayload)->StoreResult<()>{
    validation::id(&meta.id)?;validation::id(&meta.subject_id)?;validation::id(&meta.note_id)?;validation::text(&meta.file_name,255,"O nome do arquivo",false)?;validation::text(&meta.mime_type,120,"O formato",false)?;validation::date(&meta.created_at)?;
    if !matches!(meta.kind.as_str(),"pdf"|"docx"|"txt"|"md"|"csv"|"json")||meta.page_count!=payload.pages.len(){return Err(invalid("Os metadados do documento são inválidos."));}check_pages(&payload.pages)?;
    let bytes=decode(&payload.data_base64,&meta.sha256,32*1024*1024)?;
    connection.execute("INSERT INTO documents VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",params![meta.id,meta.subject_id,meta.note_id,meta.file_name,meta.kind,meta.mime_type,meta.sha256,meta.page_count as i64,serde_json::to_string(&payload.pages)?,bytes,meta.created_at])?;Ok(())
}
fn key(front:&str,back:&str,images:&[CardImage])->String{fn normalize(s:&str)->String{s.nfkc().collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()}let mut media=images.iter().map(|i|(&i.side,&i.asset_hash)).collect::<Vec<_>>();media.sort();serde_json::json!([normalize(front),normalize(back),media]).to_string()}
pub fn import_batch(connection:&mut Connection,batch:ImportBatch)->StoreResult<ImportResult>{
    validation::id(&batch.subject_id)?;validation::text(&batch.source_name,255,"O nome do arquivo",false)?;
    if !matches!(batch.format.as_str(),"csv"|"tsv"|"json"|"apkg"|"pdf"|"docx"|"txt"|"md")||batch.notes.len()+batch.flashcards.len()>5000||batch.documents.len()>5000||batch.assets.len()>5000||batch.warnings.len()>5000{return Err(invalid("O lote de importação é inválido ou excede 5.000 itens."));}
    validation::json_size(&batch,50*1024*1024,"O lote")?;
    let transaction=connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if !transaction.query_row("SELECT EXISTS(SELECT 1 FROM subjects WHERE id=?1)",[&batch.subject_id],|r|r.get::<_,bool>(0))?{return Err(StoreError::NotFound("A matéria"));}
    let (notes_count,cards_count):(i64,i64)=transaction.query_row("SELECT (SELECT COUNT(*) FROM notes),(SELECT COUNT(*) FROM flashcards)",[],|r|Ok((r.get(0)?,r.get(1)?)))?;
    if notes_count+batch.notes.len() as i64>50000||cards_count+batch.flashcards.len() as i64>200000{return Err(invalid("A importação excede a capacidade da biblioteca."));}
    let mut result=ImportResult{note_ids:vec![],flashcard_ids:vec![],document_ids:vec![],skipped_duplicates:0};let timestamp=chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis,true);
    let mut repeated_notes=HashMap::new();
    for doc in &batch.documents{if doc.note_index>=batch.notes.len(){return Err(invalid("O material aponta para uma nota inexistente."));}validation::text(&doc.file_name,255,"O nome do arquivo",false)?;validation::text(&doc.mime_type,120,"O formato",false)?;if !matches!(doc.kind.as_str(),"pdf"|"docx"|"txt"|"md"|"csv"|"json"){return Err(invalid("O formato do documento é inválido."));}check_pages(&doc.pages)?;decode(&doc.data_base64,&doc.sha256,32*1024*1024)?;let old:Option<String>=transaction.query_row("SELECT note_id FROM documents WHERE subject_id=?1 AND sha256=?2",params![batch.subject_id,doc.sha256],|r|r.get(0)).optional()?;if let Some(id)=old{repeated_notes.insert(doc.note_index,id);result.skipped_duplicates+=1;}}
    let mut note_ids=vec![];
    for (index,note) in batch.notes.iter().enumerate(){validation::text(&note.title,180,"O título",false)?;validation::text(&note.plain_text,2_000_000,"O texto da nota",true)?;validation::document(&note.body_json)?;if let Some(id)=repeated_notes.get(&index){note_ids.push(id.clone());continue;}
        let id=uuid::Uuid::new_v4().to_string();transaction.execute("INSERT INTO notes VALUES (?1,?2,?3,?4,?5,1,?6,?6)",params![id,batch.subject_id,note.title,serde_json::to_string(&note.body_json)?,note.plain_text,timestamp])?;note_ids.push(id.clone());result.note_ids.push(id);
    }
    for asset in &batch.assets{insert_asset(&transaction,asset)?;}
    let mut duplicates={let mut stmt=transaction.prepare("SELECT f.front,f.back,m.images_json FROM flashcards f LEFT JOIN card_metadata m ON m.flashcard_id=f.id WHERE f.subject_id=?1")?;let values=stmt.query_map([&batch.subject_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;values.into_iter().map(|(front,back,images)|{let images:Vec<CardImage>=serde_json::from_str(images.as_deref().unwrap_or("[]"))?;Ok(key(&front,&back,&images))}).collect::<StoreResult<HashSet<_>>>()?};
    for card in &batch.flashcards{validation::text(&card.front,20000,"A pergunta",false)?;validation::text(&card.back,20000,"A resposta",false)?;check_images(&card.tags,&card.images)?;
        let note_id=match card.note_index{Some(index)=>Some(note_ids.get(index).ok_or_else(||invalid("O cartão aponta para uma nota inexistente."))?),None=>None};
        if !duplicates.insert(key(&card.front,&card.back,&card.images)){result.skipped_duplicates+=1;continue;}
        for image in &card.images{if !transaction.query_row("SELECT EXISTS(SELECT 1 FROM material_assets WHERE sha256=?1)",[&image.asset_hash],|r|r.get::<_,bool>(0))?{return Err(invalid("Uma imagem de cartão está ausente."));}}
        let id=uuid::Uuid::new_v4().to_string();transaction.execute("INSERT INTO flashcards VALUES (?1,?2,?3,?4,?5,?6,?6)",params![id,batch.subject_id,note_id,card.front,card.back,timestamp])?;
        if !card.tags.is_empty()||!card.images.is_empty(){transaction.execute("INSERT INTO card_metadata VALUES (?1,?2,?3)",params![id,serde_json::to_string(&card.tags)?,serde_json::to_string(&card.images)?])?;}result.flashcard_ids.push(id);
    }
    for doc in &batch.documents{if repeated_notes.contains_key(&doc.note_index){continue;}let id=uuid::Uuid::new_v4().to_string();let meta=DocumentMetadata{id:id.clone(),subject_id:batch.subject_id.clone(),note_id:note_ids[doc.note_index].clone(),file_name:doc.file_name.clone(),kind:doc.kind.clone(),mime_type:doc.mime_type.clone(),sha256:doc.sha256.clone(),page_count:doc.pages.len(),created_at:timestamp.clone()};let payload=DocumentPayload{document_id:id.clone(),data_base64:doc.data_base64.clone(),pages:doc.pages.clone()};insert_document(&transaction,&meta,&payload)?;result.document_ids.push(id);}
    transaction.commit()?;Ok(result)
}
pub fn validate_backup(backup:&BackupDocument)->StoreResult<()>{
    let empty=BackupMaterials{documents:vec![],assets:vec![]};let materials=backup.materials.as_ref().unwrap_or(&empty);
    let docs=materials.documents.iter().map(|d|d.document_id.as_str()).collect::<HashSet<_>>();
    if docs.len()!=materials.documents.len()||docs.len()!=backup.data.documents.len(){return Err(invalid("O backup não contém os arquivos de todos os documentos."));}
    let notes=backup.data.notes.iter().map(|n|(n.id.as_str(),n.subject_id.as_str())).collect::<HashMap<_,_>>();let mut metadata_ids=HashSet::new();
    for meta in &backup.data.documents{validation::id(&meta.id)?;check_hash(&meta.sha256)?;if !docs.contains(meta.id.as_str())||!metadata_ids.insert(meta.id.as_str())||notes.get(meta.note_id.as_str()).copied()!=Some(meta.subject_id.as_str()){return Err(invalid("Os vínculos do documento são inconsistentes."));}}
    let mut assets=HashSet::new();for asset in &materials.assets{asset_bytes(asset)?;if !assets.insert(asset.sha256.as_str()){return Err(invalid("O backup contém imagens duplicadas."));}}
    let cards=backup.data.flashcards.iter().map(|c|c.id.as_str()).collect::<HashSet<_>>();let mut seen=HashSet::new();
    for meta in &backup.data.card_metadata{check_images(&meta.tags,&meta.images)?;if !cards.contains(meta.flashcard_id.as_str())||!seen.insert(meta.flashcard_id.as_str())||meta.images.iter().any(|i|!assets.contains(i.asset_hash.as_str())){return Err(invalid("O backup contém metadados ou imagens de cartão inconsistentes."));}}Ok(())
}
pub fn restore_materials(connection:&Connection,backup:&BackupDocument)->StoreResult<()>{
    if let Some(materials)=&backup.materials{for asset in &materials.assets{insert_asset(connection,asset)?;}for meta in &backup.data.documents{let payload=materials.documents.iter().find(|d|d.document_id==meta.id).ok_or_else(||invalid("O arquivo do documento está ausente."))?;insert_document(connection,meta,payload)?;}}
    for meta in &backup.data.card_metadata{connection.execute("INSERT INTO card_metadata VALUES (?1,?2,?3)",params![meta.flashcard_id,serde_json::to_string(&meta.tags)?,serde_json::to_string(&meta.images)?])?;}Ok(())
}

#[cfg(test)]
mod tests;
