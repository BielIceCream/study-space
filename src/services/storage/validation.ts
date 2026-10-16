import { z } from 'zod';
import type { BackupDocument, RichDocument, Snapshot } from '../../shared/types';

export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

const nonempty = (max: number, label: string) => z.string()
  .max(max, `${label} ultrapassa o limite de ${max} caracteres.`)
  .refine((value) => !value.includes('\0'), `${label} contém um caractere inválido.`)
  .refine((value) => value.trim().length > 0, `${label} não pode ficar vazio.`);
const plainTextSchema = z.string().max(2_000_000)
  .refine((value) => !value.includes('\0'), 'O texto contém um caractere inválido.');
export const idSchema = nonempty(160, 'O identificador');
export const themeSchema = z.enum(['light', 'dark']);
const accentSchema = z.enum(['lavender', 'blue', 'green', 'peach', 'rose']);
const ratingSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
const utcSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}, 'A data precisa ser válida, em UTC.');

/** Reject cycles, unsupported JSON values and excessive nesting before recursive validation. */
function assertJsonShape(value: unknown, maxBytes: number): void {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  while (stack.length) {
    const item = stack.pop()!;
    nodes += 1;
    if (nodes > 100_000 || item.depth > 64) throw new Error('O documento excede o limite de complexidade.');
    const current = item.value;
    if (typeof current === 'string' && current.includes('\0')) throw new Error('O documento contém um caractere inválido.');
    if (current === null || typeof current === 'string' || typeof current === 'boolean') continue;
    if (typeof current === 'number' && Number.isFinite(current)) continue;
    if (typeof current !== 'object') throw new Error('O documento contém um valor que não pode ser salvo em JSON.');
    if (seen.has(current)) throw new Error('O documento contém referências circulares ou repetidas.');
    seen.add(current);
    if (!Array.isArray(current) && Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) {
      throw new Error('O documento contém um objeto inválido.');
    }
    if (Object.keys(current).some((key) => key.includes('\0'))) throw new Error('O documento contém uma chave inválida.');
    for (const child of Object.values(current)) stack.push({ value: child, depth: item.depth + 1 });
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maxBytes) {
    throw new Error('O documento excede o limite de tamanho.');
  }
}

const richNodeSchema: z.ZodType<RichDocument> = z.lazy(() => z.object({
  type: nonempty(160, 'O tipo do bloco'),
  attrs: z.record(z.string(), z.unknown()).optional(),
  content: z.array(richNodeSchema).optional(),
  marks: z.array(z.object({
    type: nonempty(160, 'O tipo da marca'),
    attrs: z.record(z.string(), z.unknown()).optional(),
  }).strict()).optional(),
  text: z.string().optional(),
}).strict().refine((node) => node.type !== 'text' || typeof node.text === 'string', 'Um bloco de texto precisa conter texto.'));

export const documentSchema = z.unknown().transform((value, context) => {
  try {
    assertJsonShape(value, MAX_DOCUMENT_BYTES);
  } catch (error) {
    context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Documento inválido.' });
    return z.NEVER;
  }
  const result = richNodeSchema.safeParse(value);
  if (!result.success || result.data.type !== 'doc') {
    context.addIssue({ code: 'custom', message: 'O conteúdo da nota precisa ser um documento válido.' });
    return z.NEVER;
  }
  return result.data;
});

export const subjectInputSchema = z.object({ name: nonempty(120, 'O nome da matéria'), accent: accentSchema }).strict();
export const noteInputSchema = z.object({ subjectId: idSchema, title: nonempty(180, 'O título') }).strict();
export const saveNoteSchema = z.object({
  id: idSchema, title: nonempty(180, 'O título'), bodyJson: documentSchema,
  plainText: plainTextSchema, expectedRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1),
}).strict();
export const flashcardInputSchema = z.object({
  subjectId: idSchema, noteId: idSchema.nullable(),
  front: nonempty(20_000, 'A frente do cartão'), back: nonempty(20_000, 'O verso do cartão'),
}).strict();
export const updateFlashcardSchema = z.object({
  id: idSchema, front: nonempty(20_000, 'A frente do cartão'), back: nonempty(20_000, 'O verso do cartão'),
}).strict();
export const reviewInputSchema = z.object({ flashcardId: idSchema, sessionId: idSchema, rating: ratingSchema }).strict();

const chronological = (value: { createdAt: string; updatedAt: string }) => value.createdAt <= value.updatedAt;
export const subjectSchema = subjectInputSchema.extend({ id: idSchema, createdAt: utcSchema, updatedAt: utcSchema }).strict()
  .refine(chronological, 'A data da alteração não pode preceder a criação.');
export const noteSchema = z.object({
  id: idSchema, subjectId: idSchema, title: nonempty(180, 'O título'), bodyJson: documentSchema,
  plainText: plainTextSchema, revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  createdAt: utcSchema, updatedAt: utcSchema,
}).strict().refine(chronological, 'A data da alteração não pode preceder a criação.');
export const flashcardSchema = flashcardInputSchema.extend({ id: idSchema, createdAt: utcSchema, updatedAt: utcSchema }).strict()
  .refine(chronological, 'A data da alteração não pode preceder a criação.');
export const reviewLogSchema = reviewInputSchema.extend({ id: idSchema, reviewedAt: utcSchema }).strict();

export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const base64Schema = z.string().min(4).max(44_739_244).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
export const importImageSchema = z.object({ assetHash: hashSchema, side: z.enum(['front','back']), alt: z.string().max(500).optional() }).strict();
export const importAssetSchema = z.object({ sha256: hashSchema, fileName: nonempty(255, 'O nome do arquivo'), mimeType: z.enum(['image/png','image/jpeg','image/webp','image/gif','image/bmp']), dataBase64: base64Schema }).strict();
const pagesSchema = z.array(z.object({ page: z.number().int().min(1).max(10000), text: plainTextSchema }).strict()).max(10000).superRefine((pages,ctx)=>{
  if(new Set(pages.map(p=>p.page)).size!==pages.length) ctx.addIssue({code:'custom',message:'As páginas do documento são inconsistentes.'});
  if(new TextEncoder().encode(pages.map(p=>p.text).join('')).length>8*1024*1024) ctx.addIssue({code:'custom',message:'O texto do documento excede o limite permitido.'});
});
export const documentMetadataSchema = z.object({ id: idSchema, subjectId: idSchema, noteId: idSchema, fileName: nonempty(255,'O nome do arquivo'), kind: z.enum(['pdf','docx','txt','md','csv','json']), mimeType: nonempty(120,'O formato'), sha256: hashSchema, pageCount: z.number().int().min(0).max(10000), createdAt: utcSchema }).strict();
export const storedDocumentSchema = documentMetadataSchema.extend({ dataBase64: base64Schema, pages: pagesSchema }).strict();
const cardMetadataSchema = z.object({ flashcardId: idSchema, tags: z.array(nonempty(120,'A tag')).max(100), images: z.array(importImageSchema).max(50) }).strict();
export const importBatchSchema = z.object({
  subjectId: idSchema, sourceName: nonempty(255,'O nome do arquivo'), format: z.enum(['csv','tsv','json','apkg','pdf','docx','txt','md']),
  notes: z.array(z.object({ title: nonempty(180,'O título'), bodyJson: documentSchema, plainText: plainTextSchema }).strict()).max(5000),
  flashcards: z.array(z.object({ front: nonempty(20000,'A pergunta'), back: nonempty(20000,'A resposta'), noteIndex: z.number().int().min(0).optional(), tags: z.array(nonempty(120,'A tag')).max(100).optional(), images: z.array(importImageSchema).max(50).optional() }).strict()).max(5000),
  documents: z.array(z.object({ noteIndex: z.number().int().min(0), fileName: nonempty(255,'O nome do arquivo'), kind: z.enum(['pdf','docx','txt','md','csv','json']), mimeType: nonempty(120,'O formato'), sha256: hashSchema, dataBase64: base64Schema, pages: pagesSchema }).strict()).max(5000),
  assets: z.array(importAssetSchema).max(5000), warnings: z.array(z.string().max(500)).max(5000),
}).strict().superRefine((batch, ctx) => {
  if (batch.notes.length + batch.flashcards.length > 5000) ctx.addIssue({code:'custom',message:'Importe no máximo 5.000 itens por lote.'});
  for (const item of [...batch.flashcards, ...batch.documents]) if (item.noteIndex !== undefined && item.noteIndex >= batch.notes.length) ctx.addIssue({code:'custom',message:'O material aponta para uma nota inexistente.'});
  if (new TextEncoder().encode(JSON.stringify(batch)).length > MAX_BACKUP_BYTES) ctx.addIssue({code:'custom',message:'O lote excede 50 MB.'});
});
export const importResultSchema = z.object({ noteIds: z.array(idSchema), flashcardIds: z.array(idSchema), documentIds: z.array(idSchema), skippedDuplicates: z.number().int().min(0) }).strict();

export const snapshotSchema = z.object({
  subjects: z.array(subjectSchema).max(10_000),
  notes: z.array(noteSchema).max(50_000),
  flashcards: z.array(flashcardSchema).max(200_000),
  reviewLogs: z.array(reviewLogSchema).max(1_000_000),
  settings: z.object({ theme: themeSchema }).strict(),
  documents: z.array(documentMetadataSchema).max(50000).optional(),
  cardMetadata: z.array(cardMetadataSchema).max(200000).optional(),
}).strict().superRefine((data, context) => {
  function unique(values: { id: string }[], name: string) {
    const ids = new Set<string>();
    for (const value of values) {
      if (ids.has(value.id)) context.addIssue({ code: 'custom', message: `Há identificadores duplicados em ${name}.` });
      ids.add(value.id);
    }
    return ids;
  }
  const subjects = unique(data.subjects, 'matérias');
  unique(data.notes, 'notas');
  const notes = new Map(data.notes.map((note) => [note.id, note]));
  const cards = unique(data.flashcards, 'cartões');
  unique(data.reviewLogs, 'revisões');
  for (const note of data.notes) {
    if (!subjects.has(note.subjectId)) context.addIssue({ code: 'custom', message: 'Uma nota aponta para uma matéria inexistente.' });
  }
  for (const card of data.flashcards) {
    if (!subjects.has(card.subjectId)) context.addIssue({ code: 'custom', message: 'Um cartão aponta para uma matéria inexistente.' });
    if (card.noteId !== null && notes.get(card.noteId)?.subjectId !== card.subjectId) {
      context.addIssue({ code: 'custom', message: 'A nota de origem do cartão precisa pertencer à mesma matéria.' });
    }
  }
  const reviews = new Set<string>();
  unique(data.documents ?? [], 'documentos');
  for (const doc of data.documents ?? []) if (notes.get(doc.noteId)?.subjectId !== doc.subjectId) context.addIssue({code:'custom',message:'O documento aponta para uma nota ausente ou de outra matéria.'});
  const metadataIds = new Set<string>();
  for (const meta of data.cardMetadata ?? []) {
    if (!cards.has(meta.flashcardId) || metadataIds.has(meta.flashcardId)) context.addIssue({code:'custom',message:'Os metadados de cartão são inconsistentes.'});
    metadataIds.add(meta.flashcardId);
  }
  for (const review of data.reviewLogs) {
    if (!cards.has(review.flashcardId)) context.addIssue({ code: 'custom', message: 'Uma revisão aponta para um cartão inexistente.' });
    const key = JSON.stringify([review.sessionId, review.flashcardId]);
    if (reviews.has(key)) context.addIssue({ code: 'custom', message: 'Uma sessão contém duas respostas para o mesmo cartão.' });
    reviews.add(key);
  }
});

const backupSchema = z.object({
  format: z.literal('studyspace-backup'), version: z.union([z.literal(1),z.literal(2)]), exportedAt: utcSchema, data: snapshotSchema,
  materials: z.object({ documents: z.array(z.object({ documentId: idSchema, dataBase64: base64Schema, pages: pagesSchema }).strict()).max(50000), assets: z.array(importAssetSchema).max(100000) }).strict().optional(),
}).strict().superRefine((backup,ctx) => {
  const docs = new Set((backup.materials?.documents ?? []).map(d=>d.documentId));
  if (docs.size !== (backup.materials?.documents.length ?? 0) || docs.size !== (backup.data.documents?.length ?? 0) || (backup.data.documents ?? []).some(d=>!docs.has(d.id))) ctx.addIssue({code:'custom',message:'O backup não contém os arquivos de todos os documentos.'});
  const assets = new Set((backup.materials?.assets ?? []).map(a=>a.sha256));
  if (assets.size !== (backup.materials?.assets.length ?? 0) || (backup.data.cardMetadata ?? []).some(m=>m.images.some(i=>!assets.has(i.assetHash)))) ctx.addIssue({code:'custom',message:'O backup não contém as imagens dos cartões.'});
});

export function validate<T>(schema: z.ZodType<T>, value: unknown, fallback = 'Os dados informados são inválidos.'): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const custom = result.error.issues.find((issue) => issue.code === 'custom' || issue.message.startsWith('O ') || issue.message.startsWith('A '));
    throw new Error(custom?.message ?? fallback);
  }
  return result.data;
}

export function validateBackup(value: unknown): BackupDocument {
  let encoded: string | undefined;
  try { encoded = JSON.stringify(value); } catch { throw new Error('O backup não contém JSON válido.'); }
  if (!encoded || new TextEncoder().encode(encoded).byteLength > MAX_BACKUP_BYTES) {
    throw new Error('O backup está vazio ou excede o limite de 50 MB.');
  }
  return validate(backupSchema, value, 'O backup é inválido ou usa uma versão não suportada.');
}

export function validateSnapshot(value: unknown): Snapshot {
  return validate(snapshotSchema, value, 'Os dados locais estão inconsistentes.');
}

export function storageError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('FOREIGN KEY')) return new Error('A matéria, nota ou cartão vinculado não existe ou pertence a outra matéria.');
  if (message.includes('UNIQUE constraint')) return new Error('Este registro já existe.');
  if (message.includes('CHECK constraint') || message.includes('NOT NULL')) return new Error('Os dados não atendem às regras de armazenamento.');
  if (message.includes('database disk image') || message.includes('file is not a database')) return new Error('O banco local está corrompido. Preserve uma cópia antes de restaurar um backup.');
  if (message.includes('no such table') || message.includes('no such column')) return new Error('O banco local usa uma estrutura incompatível.');
  if (message.includes('malformed JSON')) return new Error('O conteúdo de uma nota não contém JSON válido.');
  if (error instanceof Error && error.name === 'QuotaExceededError') return new Error('O armazenamento local está cheio. Exporte um backup para preservar seus dados.');
  if (error instanceof Error && ['SecurityError', 'InvalidStateError'].includes(error.name)) return new Error('O navegador bloqueou o armazenamento local. Abra o StudySpace no aplicativo Windows.');
  if (/(fetch|Failed to load|WebAssembly|wasm|out of memory)/i.test(message)) return new Error('Não foi possível carregar o banco local. Reabra o StudySpace e tente novamente.');
  return error instanceof Error ? error : new Error(message);
}
