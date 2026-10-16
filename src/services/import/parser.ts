import type { ImportBatchInput, ImportFormat, ImportOptions, ImportPreview } from './types';
import { MAX_IMPORT_BACKUP_BYTES, MAX_IMPORT_FILE_BYTES, MAX_IMPORT_ITEMS } from './types';
import { assertNotAborted, bytesToBase64, decodeUtf8, normalizedCardKey, sha256, yieldImport } from './text';
import { delimitedCards } from './csv';
import { jsonContent } from './json';

const formats = new Set<ImportFormat>(['csv', 'tsv', 'json', 'apkg', 'pdf', 'docx', 'txt', 'md']);
export function detectImportFormat(fileName: string): ImportFormat {
  const extension = fileName.split('.').pop()?.toLowerCase() as ImportFormat;
  if (!formats.has(extension)) throw new Error('Formato não suportado. Escolha CSV, TSV, JSON, APKG, PDF, DOCX, TXT ou MD.');
  return extension;
}

function validateBatch(batch: ImportBatchInput): void {
  const count = batch.notes.length + batch.flashcards.length;
  if (count > MAX_IMPORT_ITEMS) throw new Error(`Cada importação aceita até ${MAX_IMPORT_ITEMS} notas e cartões.`);
  if (!count) throw new Error('O arquivo não contém notas ou cartões válidos para importar.');
  for (const note of batch.notes) {
    if (!note.title || note.title.length > 180 || note.plainText.length > 2_000_000 || new TextEncoder().encode(JSON.stringify(note.bodyJson)).length > 2 * 1024 * 1024) throw new Error('Uma nota excede os limites de título ou texto. Divida o documento e tente novamente.');
  }
  for (const card of batch.flashcards) {
    if (!card.front.trim() || !card.back.trim() || card.front.length > 20_000 || card.back.length > 20_000 || /\u0000/.test(card.front + card.back)) throw new Error('Um cartão precisa de frente e verso preenchidos, com até 20.000 caracteres cada.');
    if (card.noteIndex !== undefined && (!Number.isInteger(card.noteIndex) || card.noteIndex < 0 || card.noteIndex >= batch.notes.length)) throw new Error('Um cartão aponta para uma nota inexistente neste arquivo.');
    if ((card.tags?.length ?? 0) > 64 || card.tags?.some(tag => tag.length > 120 || /\u0000/.test(tag))) throw new Error('Um cartão contém tags demais ou uma tag com mais de 120 caracteres.');
  }
  // Reserve space for IDs, timestamps and the backup envelope before persisting binary content.
  const overhead = count * 600 + 4_096;
  if (new TextEncoder().encode(JSON.stringify(batch)).byteLength + overhead > MAX_IMPORT_BACKUP_BYTES) throw new Error('Os dados importados excedem o limite de 50 MiB do backup. Divida o arquivo em partes menores.');
}

export async function parseImportFile(file: File, options: ImportOptions = {}): Promise<ImportPreview> {
  assertNotAborted(options.signal);
  if (!file.size) throw new Error('O arquivo está vazio.');
  if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error('Cada arquivo pode ter no máximo 32 MiB.');
  const format = detectImportFormat(file.name);
  const fileName = file.name.replace(/[\u0000-\u001f]/g, '').split(/[\\/]/).pop()!.slice(0, 255) || 'importação';
  options.onProgress?.({ stage: 'reading', completed: 0, total: file.size });
  const bytes = new Uint8Array(await file.arrayBuffer());
  assertNotAborted(options.signal);
  if (bytes.length !== file.size) throw new Error('O arquivo foi alterado durante a leitura. Selecione-o novamente.');
  options.onProgress?.({ stage: 'reading', completed: file.size, total: file.size });
  await yieldImport(options.signal);
  const batch: ImportBatchInput = { subjectId: options.subjectId ?? '', sourceName: fileName, format, notes: [], flashcards: [], documents: [], assets: [], warnings: [] };
  let columns: string[] = []; let suggestedMapping: ImportPreview['suggestedMapping'] = null;
  options.onProgress?.({ stage: 'parsing', completed: 0, total: 1 });
  if (format === 'csv' || format === 'tsv') {
    const content = delimitedCards(decodeUtf8(bytes), format === 'tsv', options.columnMapping);
    batch.flashcards = content.cards; batch.warnings = content.warnings; columns = content.columns; suggestedMapping = content.mapping;
  } else if (format === 'json') {
    const content = jsonContent(decodeUtf8(bytes)); batch.notes = content.notes; batch.flashcards = content.cards;
    if (content.notes.length) {
      batch.documents.push({ noteIndex: 0, fileName, kind: 'json', mimeType: 'application/json', sha256: await sha256(bytes), dataBase64: bytesToBase64(bytes), pages: [{ page: 1, text: content.notes[0].plainText }] });
    }
  } else if (format === 'apkg') {
    const { parseApkg } = await import('./apkg'); const content = await parseApkg(bytes, options);
    batch.flashcards = content.cards; batch.assets = content.assets; batch.warnings = content.warnings;
  } else {
    const { parseDocument } = await import('./documents'); const content = await parseDocument(bytes, fileName, format, options);
    batch.notes = [content.note]; batch.documents = [content.document]; batch.warnings = content.warnings;
  }
  options.onProgress?.({ stage: 'validating', completed: 0, total: batch.flashcards.length || 1 });
  validateBatch(batch);
  const existing = new Set(options.snapshot?.flashcards.filter(card => !options.subjectId || card.subjectId === options.subjectId).map(card => normalizedCardKey(card.front, card.back)) ?? []);
  const seen = new Set<string>(); let duplicates = 0;
  for (let index = 0; index < batch.flashcards.length; index += 1) {
    const card = batch.flashcards[index];
    // Image-only cards must retain their identity even when their text is identical.
    const textKey = normalizedCardKey(card.front, card.back);
    const key = `${textKey}:${JSON.stringify(card.images?.map(image => [image.side, image.assetHash]).sort() ?? [])}`;
    if (seen.has(key) || (!card.images?.length && existing.has(textKey))) duplicates += 1;
    seen.add(key);
    if ((index + 1) % 200 === 0) { options.onProgress?.({ stage: 'validating', completed: index + 1, total: batch.flashcards.length }); await yieldImport(options.signal); }
  }
  if (duplicates) batch.warnings.push(`${duplicates} cartão(ões) repetido(s) foram identificados na prévia; a importação preserva os cartões existentes.`);
  options.onProgress?.({ stage: 'validating', completed: batch.flashcards.length || 1, total: batch.flashcards.length || 1 });
  assertNotAborted(options.signal);
  return { batch, format, fileName, counts: { notes: batch.notes.length, flashcards: batch.flashcards.length, documents: batch.documents.length, assets: batch.assets.length }, columns, suggestedMapping, duplicates };
}
