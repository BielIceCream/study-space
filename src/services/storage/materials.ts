import type { Database, SqlValue } from 'sql.js';
import type { ImportBatchInput, ImportResult, ImportedAsset } from '../import/types';
import type { BackupMaterials, DocumentMetadata, StoredDocument, CardMetadata } from '../../shared/types';
import { importBatchSchema, validate } from './validation';

export function materialRows(db: Database, sql: string, params: SqlValue[] = []): Record<string, SqlValue>[] {
  const stmt = db.prepare(sql);
  try { stmt.bind(params); const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); return rows; }
  finally { stmt.free(); }
}
export function encodeMaterial(bytes: Uint8Array): string {
  let binary = ''; for (let n=0;n<bytes.length;n+=32768) binary += String.fromCharCode(...bytes.subarray(n,n+32768));
  return btoa(binary);
}
export async function decodeMaterial(dataBase64: string, hash: string, max = 32*1024*1024): Promise<Uint8Array> {
  if (dataBase64.length > Math.ceil(max/3)*4) throw new Error('O arquivo excede o limite permitido.');
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(dataBase64), c=>c.charCodeAt(0)); } catch { throw new Error('O arquivo contém dados inválidos.'); }
  if (!bytes.length || bytes.length > max) throw new Error('O arquivo está vazio ou excede o limite permitido.');
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer))).map(b=>b.toString(16).padStart(2,'0')).join('');
  if (digest !== hash) throw new Error('A integridade do arquivo não confere.');
  return bytes;
}
export function cardDuplicateKey(front: string, back: string, images: {side:string;assetHash:string}[]=[]): string {
  const normalize = (text:string)=>text.normalize('NFKC').replace(/\s+/g,' ').trim().toLocaleLowerCase('pt-BR');
  return JSON.stringify([normalize(front),normalize(back),images.map(i=>[i.side,i.assetHash]).sort()]);
}
function metadata(row: Record<string,SqlValue>): DocumentMetadata {
  return {id:String(row.id),subjectId:String(row.subject_id),noteId:String(row.note_id),fileName:String(row.file_name),kind:String(row.kind),mimeType:String(row.mime_type),sha256:String(row.sha256),pageCount:Number(row.page_count),createdAt:String(row.created_at)};
}
export function documentMetadata(db:Database): DocumentMetadata[] {
  return materialRows(db,'SELECT id,subject_id,note_id,file_name,kind,mime_type,sha256,page_count,created_at FROM documents ORDER BY created_at,id').map(metadata);
}
export function cardMetadata(db:Database): CardMetadata[] {
  return materialRows(db,'SELECT * FROM card_metadata').map(r=>({flashcardId:String(r.flashcard_id),tags:JSON.parse(String(r.tags_json)),images:JSON.parse(String(r.images_json))}));
}
export function storedDocument(db:Database,id:string): StoredDocument {
  const row = materialRows(db,'SELECT * FROM documents WHERE id=?',[id])[0];
  if(!row) throw new Error('O documento não foi encontrado.');
  return {...metadata(row),pages:JSON.parse(String(row.pages_json)),dataBase64:encodeMaterial(row.file_bytes as Uint8Array)};
}
export function storedAsset(db:Database,sha256:string):ImportedAsset {
  const row=materialRows(db,'SELECT * FROM material_assets WHERE sha256=?',[sha256])[0];
  if(!row) throw new Error('A imagem não foi encontrada.');
  return {sha256,fileName:String(row.file_name),mimeType:String(row.mime_type),dataBase64:encodeMaterial(row.file_bytes as Uint8Array)};
}
export function backupMaterials(db:Database):BackupMaterials {
  return {documents:documentMetadata(db).map(d=>{const full=storedDocument(db,d.id);return {documentId:d.id,pages:full.pages,dataBase64:full.dataBase64};}),assets:materialRows(db,'SELECT sha256 FROM material_assets').map(r=>storedAsset(db,String(r.sha256)))};
}
export async function insertAsset(db:Database,asset:ImportedAsset):Promise<void> {
  const bytes=await decodeMaterial(asset.dataBase64,asset.sha256,8*1024*1024);
  const hex=Array.from(bytes.subarray(0,12)).map(b=>b.toString(16).padStart(2,'0')).join('');
  if (!(asset.mimeType==='image/png'&&hex.startsWith('89504e470d0a1a0a') || asset.mimeType==='image/jpeg'&&hex.startsWith('ffd8ff') || asset.mimeType==='image/gif'&&hex.startsWith('47494638') || asset.mimeType==='image/webp'&&hex.startsWith('52494646')&&hex.slice(16,24)==='57454250' || asset.mimeType==='image/bmp'&&bytes.length>=54&&hex.startsWith('424d'))) throw new Error('O formato da imagem não confere com seu conteúdo.');
  db.run('INSERT OR IGNORE INTO material_assets VALUES (?,?,?,?)',[asset.sha256,asset.fileName,asset.mimeType,bytes]);
}
export async function importSQLiteBatch(db:Database,input:ImportBatchInput,time:string,newId:()=>string):Promise<ImportResult> {
  const batch=validate(importBatchSchema,input);
  if(!materialRows(db,'SELECT id FROM subjects WHERE id=?',[batch.subjectId]).length) throw new Error('Escolha uma matéria existente.');
  const count=materialRows(db,'SELECT (SELECT COUNT(*) FROM notes) AS notes,(SELECT COUNT(*) FROM flashcards) AS cards')[0];
  if(Number(count.notes)+batch.notes.length>50000 || Number(count.cards)+batch.flashcards.length>200000) throw new Error('A importação excede a capacidade da biblioteca.');
  const result:ImportResult={noteIds:[],flashcardIds:[],documentIds:[],skippedDuplicates:0};
  const noteIds:string[]=[];
  const repeatedNotes=new Map<number,string>();
  const documentBytes = new Map<string,Uint8Array>();
  for(const doc of batch.documents) documentBytes.set(doc.sha256,await decodeMaterial(doc.dataBase64,doc.sha256));
  for(const doc of batch.documents){const old=materialRows(db,'SELECT note_id FROM documents WHERE subject_id=? AND sha256=?',[batch.subjectId,doc.sha256])[0];if(old){repeatedNotes.set(doc.noteIndex,String(old.note_id));result.skippedDuplicates++;}}
  for(let i=0;i<batch.notes.length;i++){
    if(repeatedNotes.has(i)){noteIds.push(repeatedNotes.get(i)!);continue;}
    const id=newId(),note=batch.notes[i];noteIds.push(id);result.noteIds.push(id);
    db.run('INSERT INTO notes VALUES (?,?,?,?,?,1,?,?)',[id,batch.subjectId,note.title,JSON.stringify(note.bodyJson),note.plainText,time,time]);
    if(i%128===127) await new Promise(r=>setTimeout(r,0));
  }
  for(const asset of batch.assets) await insertAsset(db,asset);
  const assetHashes=new Set(materialRows(db,'SELECT sha256 FROM material_assets').map(r=>String(r.sha256)));
  const duplicates=new Set(materialRows(db,'SELECT f.front,f.back,m.images_json FROM flashcards f LEFT JOIN card_metadata m ON m.flashcard_id=f.id WHERE f.subject_id=?',[batch.subjectId]).map(r=>cardDuplicateKey(String(r.front),String(r.back),r.images_json?JSON.parse(String(r.images_json)):[])));
  for(let i=0;i<batch.flashcards.length;i++){
    const card=batch.flashcards[i], key=cardDuplicateKey(card.front,card.back,card.images);
    if(duplicates.has(key)){result.skippedDuplicates++;continue;}
    for(const image of card.images??[]) if(!assetHashes.has(image.assetHash)) throw new Error('Uma imagem de cartão está ausente.');
    const id=newId();duplicates.add(key);result.flashcardIds.push(id);
    db.run('INSERT INTO flashcards VALUES (?,?,?,?,?,?,?)',[id,batch.subjectId,card.noteIndex===undefined?null:noteIds[card.noteIndex],card.front,card.back,time,time]);
    if(card.tags?.length||card.images?.length) db.run('INSERT INTO card_metadata VALUES (?,?,?)',[id,JSON.stringify(card.tags??[]),JSON.stringify(card.images??[])]);
    if(i%128===127) await new Promise(r=>setTimeout(r,0));
  }
  for(const doc of batch.documents){
    if(repeatedNotes.has(doc.noteIndex)) continue;
    const bytes=documentBytes.get(doc.sha256)!; const id=newId();
    db.run('INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?,?)',[id,batch.subjectId,noteIds[doc.noteIndex],doc.fileName,doc.kind,doc.mimeType,doc.sha256,doc.pages.length,JSON.stringify(doc.pages),bytes,time]);result.documentIds.push(id);
  }
  return result;
}
