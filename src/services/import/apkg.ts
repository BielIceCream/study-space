import initSqlJs from 'sql.js';
import type { Database, SqlValue } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { Decompress } from 'fzstd';
import { protobufFields } from './protobuf';
import { bytesToBase64, decodeEntities, decodeUtf8, htmlToPlainText, sha256, yieldImport } from './text';
import { readSafeZip, safeArchivePath } from './zip';
import type { ImportedAsset, ImportedFlashcard, ImportedImage, ImportOptions } from './types';
import { MAX_IMPORT_FILE_BYTES, MAX_IMPORT_ITEMS } from './types';

interface Template { ord: number; qfmt: string; afmt: string }
interface Model { fields: string[]; templates: Template[]; cloze: boolean }
type Row = Record<string, SqlValue>;

function query(db: Database, sql: string, values: SqlValue[] = []): Row[] {
  const statement = db.prepare(sql); const rows: Row[] = [];
  try { statement.bind(values); while (statement.step()) { rows.push(statement.getAsObject()); if (rows.length > MAX_IMPORT_ITEMS + 1) throw new Error(`O APKG excede o limite de ${MAX_IMPORT_ITEMS} itens.`); } }
  finally { statement.free(); }
  return rows;
}

export async function boundedZstd(bytes: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
  const parts: Uint8Array[] = []; let size = 0;
  const stream = new Decompress(chunk => {
    size += chunk.length;
    if (size > MAX_IMPORT_FILE_BYTES) throw new Error('O conteúdo Zstandard excede o limite de 32 MiB.');
    parts.push(chunk);
  });
  try {
    for (let index = 0; index < bytes.length; index += 4096) {
      stream.push(bytes.subarray(index, index + 4096), index + 4096 >= bytes.length);
      if (index % (4096 * 128) === 0) await yieldImport(signal);
    }
  } catch (cause) {
    if (cause instanceof Error && /limite|cancelada/.test(cause.message)) throw cause;
    throw new Error('O conteúdo Zstandard do APKG está inválido ou usa compressão não suportada.');
  }
  const result = new Uint8Array(size); let at = 0;
  for (const part of parts) { result.set(part, at); at += part.length; }
  return result;
}
const isZstd = (bytes: Uint8Array) => bytes.length >= 4 && bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd;
const asBytes = (value: SqlValue) => value instanceof Uint8Array ? value : new Uint8Array();

function modelsFromDatabase(db: Database): Map<string, Model> {
  const models = new Map<string, Model>();
  const modern = query(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='notetypes'").length > 0;
  if (modern) {
    for (const row of query(db, 'SELECT CAST(id AS TEXT) id, config FROM notetypes')) {
      const id = String(row.id); const config = protobufFields(asBytes(row.config));
      const fields = query(db, 'SELECT name FROM fields WHERE ntid = ? ORDER BY ord', [id]).map(field => String(field.name));
      const templates = query(db, 'SELECT ord, config FROM templates WHERE ntid = ? ORDER BY ord', [id]).map(template => {
        const data = protobufFields(asBytes(template.config));
        const q = data.get(1)?.[0]; const a = data.get(2)?.[0];
        return { ord: Number(template.ord), qfmt: q instanceof Uint8Array ? decodeUtf8(q) : '', afmt: a instanceof Uint8Array ? decodeUtf8(a) : '' };
      });
      models.set(id, { fields, templates, cloze: config.get(1)?.[0] === 1 });
    }
  } else {
    const serialized = query(db, 'SELECT models FROM col LIMIT 1')[0]?.models;
    let parsed: unknown;
    try { parsed = JSON.parse(String(serialized)); } catch { throw new Error('Os modelos de notas do APKG estão corrompidos.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Os modelos de notas do APKG estão inválidos.');
    for (const [id, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue;
      const model = value as { flds?: { name?: string; ord?: number }[]; tmpls?: { ord?: number; qfmt?: string; afmt?: string }[]; type?: number };
      if (!Array.isArray(model.flds) || !Array.isArray(model.tmpls)) continue;
      const fields = [...model.flds].sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0)).map(field => typeof field.name === 'string' ? field.name : '');
      const templates = model.tmpls.map((template, index) => ({ ord: template.ord ?? index, qfmt: typeof template.qfmt === 'string' ? template.qfmt : '', afmt: typeof template.afmt === 'string' ? template.afmt : '' }));
      models.set(id, { fields, templates, cloze: model.type === 1 });
    }
  }
  return models;
}

function clozeText(value: string, index: number, answer: boolean): string {
  return value.replace(/\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/gi, (_match, ord: string, text: string, hint?: string) => !answer && Number(ord) === index ? `[${hint?.trim() || '…'}]` : text);
}

export function renderAnkiTemplate(template: string, fields: Map<string, string>, clozeIndex?: number, answer = false): string {
  let value = template;
  // Bounded Mustache conditionals, with no expression evaluation or script execution.
  for (let depth = 0; depth < 20; depth += 1) {
    const next = value.replace(/\{\{([#^])([^{}]+)\}\}((?:(?!\{\{[#^])[\s\S])*?)\{\{\/\2\}\}/g, (_match, op: string, key: string, body: string) => {
      const present = !!htmlToPlainText(fields.get(key.trim()) ?? '');
      return present === (op === '#') ? body : '';
    });
    if (next === value) break; value = next;
  }
  return value.replace(/\{\{([^{}]+)\}\}/g, (_match, raw: string) => {
    const keys = raw.trim().split(':'); const key = keys.pop()!;
    if (key === 'FrontSide' || /^[#^/]/.test(key)) return '';
    let result = fields.get(key) ?? '';
    if (keys.includes('cloze') && clozeIndex !== undefined) result = clozeText(result, clozeIndex, answer);
    if (keys.includes('text')) result = htmlToPlainText(result);
    return result;
  });
}

function imageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 137 && decodeUtf8(bytes.subarray(1, 4)) === 'PNG') return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 6 && String.fromCharCode(...bytes.subarray(0, 6)).match(/^GIF8[79]a$/)) return 'image/gif';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  if (bytes.length >= 54 && bytes[0] === 66 && bytes[1] === 77) return 'image/bmp';
  return null;
}

async function mediaMap(files: Map<string, Uint8Array>, signal?: AbortSignal): Promise<Map<string, { bytes: Uint8Array; fileName: string }>> {
  const result = new Map<string, { bytes: Uint8Array; fileName: string }>();
  const mapping = files.get('media'); if (!mapping) return result;
  let entries: [string, string][];
  if (isZstd(mapping)) {
    const fields = protobufFields(await boundedZstd(mapping, signal));
    entries = (fields.get(1) ?? []).map((value, index) => {
      if (!(value instanceof Uint8Array)) throw new Error('O índice de mídia do APKG está inválido.');
      const entry = protobufFields(value); const name = entry.get(1)?.[0];
      if (!(name instanceof Uint8Array)) throw new Error('O índice de mídia do APKG não contém nomes válidos.');
      return [String(entry.get(255)?.[0] ?? index), decodeUtf8(name)];
    });
  } else {
    let parsed: unknown;
    try { parsed = JSON.parse(decodeUtf8(mapping)); } catch { throw new Error('O índice de mídia do APKG está corrompido.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('O índice de mídia do APKG está inválido.');
    entries = Object.entries(parsed).map(([key, name]) => {
      if (typeof name !== 'string') throw new Error('O índice de mídia do APKG contém um nome inválido.');
      return [key, name];
    });
  }
  if (entries.length > 10_000) throw new Error('O APKG contém mídia demais.');
  for (const [key, name] of entries) {
    if (!/^\d+$/.test(key) || !safeArchivePath(name) || name.includes('/') || name.length > 255 || result.has(name)) throw new Error('O APKG contém um nome de mídia inseguro ou duplicado.');
    const stored = files.get(key); if (!stored) continue;
    result.set(name, { bytes: stored, fileName: name });
  }
  return result;
}

export async function parseApkg(bytes: Uint8Array, options: ImportOptions): Promise<{ cards: ImportedFlashcard[]; assets: ImportedAsset[]; warnings: string[] }> {
  const files = await readSafeZip(bytes, options.signal);
  const databaseFile = files.get('collection.anki21b') ?? files.get('collection.anki21') ?? files.get('collection.anki2');
  if (!databaseFile) throw new Error('O APKG não contém uma coleção Anki reconhecida.');
  const databaseBytes = isZstd(databaseFile) ? await boundedZstd(databaseFile, options.signal) : databaseFile;
  if (String.fromCharCode(...databaseBytes.subarray(0, 16)) !== 'SQLite format 3\0') throw new Error('O APKG não contém um banco SQLite válido.');
  const media = await mediaMap(files, options.signal); const assets = new Map<string, ImportedAsset>();
  const hashedMedia = new Map<string, string>(); const warnings = new Set<string>(); const cards: ImportedFlashcard[] = [];
  let expandedMedia = 0;
  const attachImages = async (markup: string, side: 'front' | 'back'): Promise<ImportedImage[]> => {
    const images: ImportedImage[] = [];
    for (const match of markup.matchAll(/<img\b[^>]*>/gi)) {
      const src = match[0].match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const raw = decodeEntities(src?.[1] ?? src?.[2] ?? src?.[3] ?? ''); let name = raw;
      try { name = decodeURIComponent(raw); } catch { /* Raw names remain available. */ }
      if (!safeArchivePath(name) || name.includes('/') || /^\w+:/.test(name)) { warnings.add('Imagens externas ou com caminhos inseguros foram ignoradas.'); continue; }
      const item = media.get(name);
      if (!item) { warnings.add(`A imagem “${name.slice(0, 80)}” não está incluída no APKG.`); continue; }
      let hash = hashedMedia.get(name);
      if (!hash) {
        const rawBytes = isZstd(item.bytes) ? await boundedZstd(item.bytes, options.signal) : item.bytes;
        const mimeType = imageType(rawBytes);
        if (!mimeType) { warnings.add('Uma mídia não é uma imagem local PNG/JPEG/GIF/WebP/BMP e foi ignorada.'); continue; }
        expandedMedia += rawBytes.length;
        if (expandedMedia > MAX_IMPORT_FILE_BYTES) throw new Error('As imagens do APKG excedem o limite de 32 MiB.');
        hash = await sha256(rawBytes); hashedMedia.set(name, hash);
        if (!assets.has(hash)) assets.set(hash, { sha256: hash, fileName: item.fileName, mimeType, dataBase64: bytesToBase64(rawBytes) });
      }
      const altMatch = match[0].match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i); const alt = htmlToPlainText(altMatch?.[1] ?? altMatch?.[2] ?? name).slice(0, 200);
      if (!images.some(image => image.assetHash === hash)) images.push({ assetHash: hash, side, alt });
      if (images.length > 20) throw new Error('Um cartão possui imagens demais.');
    }
    return images;
  };
  const SQL = await initSqlJs({ locateFile: () => wasmUrl }); const db = new SQL.Database(databaseBytes);
  try {
    if (query(db, 'PRAGMA quick_check')[0]?.quick_check !== 'ok') throw new Error('O banco Anki está corrompido.');
    const models = modelsFromDatabase(db);
    const rows = query(db, 'SELECT CAST(n.id AS TEXT) id, CAST(n.mid AS TEXT) mid, n.flds, n.tags, c.ord FROM notes n JOIN cards c ON c.nid=n.id ORDER BY n.id,c.ord LIMIT 5001');
    if (rows.length > MAX_IMPORT_ITEMS) throw new Error(`O APKG excede o limite de ${MAX_IMPORT_ITEMS} cartões.`);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]; const model = models.get(String(row.mid));
      if (!model) throw new Error('Uma nota Anki aponta para um modelo desconhecido.');
      const values = String(row.flds).split('\x1f'); const fields = new Map(model.fields.map((name, ord) => [name, values[ord] ?? '']));
      const ord = Number(row.ord); const template = model.cloze ? model.templates[0] : model.templates.find(item => item.ord === ord);
      if (!template) { warnings.add('Cartões sem modelo de frente e verso foram ignorados.'); continue; }
      const clozeIndex = model.cloze ? ord + 1 : undefined;
      const frontMarkup = renderAnkiTemplate(template.qfmt, fields, clozeIndex, false);
      const backMarkup = renderAnkiTemplate(template.afmt, fields, clozeIndex, true);
      const images = [...await attachImages(frontMarkup, 'front'), ...await attachImages(backMarkup, 'back')];
      const front = htmlToPlainText(frontMarkup) || (images.some(image => image.side === 'front') ? '[Imagem]' : '');
      const back = htmlToPlainText(backMarkup) || (images.some(image => image.side === 'back') ? '[Imagem]' : '');
      if (!front || !back) { warnings.add('Cartões com frente ou verso vazios foram ignorados.'); continue; }
      if (/\{\{c\d+::/.test(front + back)) warnings.add('Uma oclusão aninhada não pôde ser expandida por completo; revise o cartão.');
      if (/\[sound:/.test(frontMarkup + backMarkup)) warnings.add('Áudios Anki não são reproduzidos nesta importação.');
      const tags = [...new Set(String(row.tags ?? '').split(/\s+/).filter(Boolean))];
      cards.push({ front, back, ...(tags.length ? { tags } : {}), ...(images.length ? { images } : {}) });
      if ((index + 1) % 100 === 0) { options.onProgress?.({ stage: 'extracting', completed: index + 1, total: rows.length }); await yieldImport(options.signal); }
    }
  } catch (cause) {
    if (cause instanceof Error && !/no such table|no such column|file is not a database/.test(cause.message)) throw cause;
    throw new Error('A estrutura deste APKG não é compatível. Exporte uma coleção Anki básica ou reversa e tente novamente.');
  } finally { db.close(); }
  return { cards, assets: [...assets.values()], warnings: [...warnings] };
}
