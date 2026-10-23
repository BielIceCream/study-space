import { z } from 'zod';
import type { Snapshot } from '../shared/types';
import { hashSchema, idSchema, importAssetSchema, pagesSchema, snapshotSchema, utcSchema, validate } from './storage/validation';
import { validateAssetContent } from './storage/materials';

// Uncompressed, length-delimited container. No extraction, paths or decompression.
export const ARCHIVE_MAGIC = new TextEncoder().encode('STUDYSPACE-BACKUP/3\n');
export const ARCHIVE_MAGIC_V4 = new TextEncoder().encode('STUDYSPACE-BACKUP/4\n');
export const ARCHIVE_MAGIC_V5 = new TextEncoder().encode('STUDYSPACE-BACKUP/5\n');
export const ARCHIVE_MAGIC_V6 = new TextEncoder().encode('STUDYSPACE-BACKUP/6\n');
export const ARCHIVE_MAGIC_V7 = new TextEncoder().encode('STUDYSPACE-BACKUP/7\n');
export function isArchiveHeader(bytes: Uint8Array): boolean {
  return [ARCHIVE_MAGIC, ARCHIVE_MAGIC_V4, ARCHIVE_MAGIC_V5, ARCHIVE_MAGIC_V6, ARCHIVE_MAGIC_V7].some(magic => magic.every((byte, index) => byte === bytes[index]));
}
export const ARCHIVE_HEADER_BYTES = ARCHIVE_MAGIC.length + 4 + 32;
export const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
export const MAX_ARCHIVE_MANIFEST_BYTES = 50 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
export const MAX_ASSET_BYTES = 8 * 1024 * 1024;

export interface BackupArchiveManifest {
  format: 'studyspace-backup';
  version: 3 | 4 | 5 | 6 | 7;
  exportedAt: string;
  data: Snapshot;
  materials: {
    documents: { documentId: string; byteLength: number; pages: { page: number; text: string }[] }[];
    assets: { sha256: string; fileName: string; mimeType: string; byteLength: number }[];
  };
}
export interface BackupArchive {
  manifest: BackupArchiveManifest;
  readMaterial(index: number): Promise<Uint8Array>;
}
export interface MaterialDescriptor {
  kind: 'document' | 'asset';
  id: string;
  sha256: string;
  byteLength: number;
}

const manifestSchema = z.object({
  format: z.literal('studyspace-backup'), version: z.union([z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7)]), exportedAt: utcSchema, data: snapshotSchema,
  materials: z.object({
    documents: z.array(z.object({
      documentId: idSchema, byteLength: z.number().int().min(1).max(MAX_DOCUMENT_BYTES), pages: pagesSchema,
    }).strict()).max(50_000),
    assets: z.array(importAssetSchema.omit({ dataBase64: true }).extend({
      byteLength: z.number().int().min(1).max(MAX_ASSET_BYTES),
    }).strict()).max(100_000),
  }).strict(),
}).strict().superRefine((manifest, ctx) => {
  if (manifest.version < 7 && manifest.data.errorEntries?.length) ctx.addIssue({code:'custom',message:'O caderno de erros exige um backup v7.'});
  if (manifest.version === 3 && manifest.data.studyTracks?.length) ctx.addIssue({code:'custom',message:'Trilhas e diagnósticos exigem um backup v4.'});
  if (manifest.version < 5 && manifest.data.studyPlanners?.length) ctx.addIssue({code:'custom',message:'Agendas exigem um backup v5.'});
  if (manifest.version < 6 && manifest.data.reviewSchedules?.length) ctx.addIssue({code:'custom',message:'A revisão espaçada exige um backup v6.'});
  const documents = new Map((manifest.data.documents ?? []).map(doc => [doc.id, doc]));
  const seen = new Set<string>();
  for (const doc of manifest.materials.documents) {
    if (seen.has(doc.documentId) || !documents.has(doc.documentId) || documents.get(doc.documentId)?.pageCount !== doc.pages.length) {
      ctx.addIssue({ code: 'custom', message: 'Os arquivos e páginas dos documentos são inconsistentes.' });
    }
    seen.add(doc.documentId);
  }
  if (seen.size !== documents.size) ctx.addIssue({ code: 'custom', message: 'O backup não contém os arquivos de todos os documentos.' });
  const assets = new Set(manifest.materials.assets.map(asset => asset.sha256));
  if (assets.size !== manifest.materials.assets.length || (manifest.data.cardMetadata ?? []).some(meta => meta.images.some(image => !assets.has(image.assetHash)))) {
    ctx.addIssue({ code: 'custom', message: 'As imagens do backup estão ausentes ou duplicadas.' });
  }
});

function manifestBytes(manifest: BackupArchiveManifest): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  if (bytes.length > MAX_ARCHIVE_MANIFEST_BYTES) throw new Error('O manifesto do backup deve ter até 50 MiB.');
  const total = ARCHIVE_HEADER_BYTES + bytes.length + materialDescriptors(manifest).reduce((sum, item) => sum + item.byteLength, 0);
  if (total > MAX_ARCHIVE_BYTES) throw new Error('O backup escalável deve ter até 256 MiB. Seus dados locais não foram alterados.');
  return bytes;
}

function parseManifest(value: unknown): { manifest: BackupArchiveManifest; encoded: Uint8Array } {
  const manifest = validate(manifestSchema, value, 'O manifesto do backup escalável é inválido ou usa uma versão não suportada.');
  return { manifest, encoded: manifestBytes(manifest) };
}

export function validateArchiveManifest(value: unknown): BackupArchiveManifest {
  return parseManifest(value).manifest;
}

export function materialDescriptors(manifest: BackupArchiveManifest): MaterialDescriptor[] {
  const documents = new Map((manifest.data.documents ?? []).map(doc => [doc.id, doc]));
  return [
    ...manifest.materials.documents.map(doc => ({ kind: 'document' as const, id: doc.documentId, sha256: documents.get(doc.documentId)!.sha256, byteLength: doc.byteLength })),
    ...manifest.materials.assets.map(asset => ({ kind: 'asset' as const, id: asset.sha256, sha256: asset.sha256, byteLength: asset.byteLength })),
  ];
}

async function digest(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
}
export async function verifyMaterial(bytes: Uint8Array, descriptor: MaterialDescriptor): Promise<void> {
  if (!(bytes instanceof Uint8Array) || bytes.length !== descriptor.byteLength) throw new Error('O tamanho do material no backup não confere.');
  const hash = Array.from(await digest(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  validate(hashSchema, descriptor.sha256);
  if (hash !== descriptor.sha256) throw new Error('A integridade do material no backup não confere. Seus dados locais não foram alterados.');
}

export async function createBackupArchive(value: BackupArchiveManifest, readMaterial: BackupArchive['readMaterial']): Promise<Blob> {
  const { manifest, encoded } = parseManifest(value);
  const header = new Uint8Array(ARCHIVE_HEADER_BYTES);
  header.set(manifest.version === 7 ? ARCHIVE_MAGIC_V7 : manifest.version === 6 ? ARCHIVE_MAGIC_V6 : manifest.version === 5 ? ARCHIVE_MAGIC_V5 : manifest.version === 4 ? ARCHIVE_MAGIC_V4 : ARCHIVE_MAGIC);
  new DataView(header.buffer).setUint32(ARCHIVE_MAGIC.length, encoded.length, true);
  header.set(await digest(encoded), ARCHIVE_MAGIC.length + 4);
  const parts: BlobPart[] = [header, encoded as Uint8Array<ArrayBuffer>];
  const descriptors = materialDescriptors(manifest);
  // Each Blob takes its own immutable copy; no aggregate base64/JSON buffer.
  for (let index = 0; index < descriptors.length; index++) {
    const bytes = await readMaterial(index);
    await verifyMaterial(bytes, descriptors[index]);
    if (descriptors[index].kind === 'asset') validateAssetContent(bytes, manifest.materials.assets[index - manifest.materials.documents.length].mimeType);
    parts.push(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}

export async function readBackupArchive(file: Blob): Promise<BackupArchive> {
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error('O backup escalável deve ter até 256 MiB. Seus dados locais não foram alterados.');
  if (file.size < ARCHIVE_HEADER_BYTES) throw new Error('O arquivo de backup está incompleto.');
  const header = new Uint8Array(await file.slice(0, ARCHIVE_HEADER_BYTES).arrayBuffer());
  if (!isArchiveHeader(header)) throw new Error('Este arquivo não é um backup StudySpace v3–v7 compatível.');
  const size = new DataView(header.buffer).getUint32(ARCHIVE_MAGIC.length, true);
  if (!size || size > MAX_ARCHIVE_MANIFEST_BYTES || ARCHIVE_HEADER_BYTES + size > file.size) throw new Error('O manifesto do backup está incompleto ou excede 50 MiB.');
  const encoded = new Uint8Array(await file.slice(ARCHIVE_HEADER_BYTES, ARCHIVE_HEADER_BYTES + size).arrayBuffer());
  const checksum = await digest(encoded);
  if (!checksum.every((byte, index) => byte === header[ARCHIVE_MAGIC.length + 4 + index])) throw new Error('A integridade do manifesto do backup não confere.');
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(encoded)); }
  catch { throw new Error('O manifesto do backup não contém JSON UTF-8 válido.'); }
  const manifest = validateArchiveManifest(value);
  if (manifest.version !== header[ARCHIVE_MAGIC.length - 2] - 48) throw new Error('A versão do cabeçalho não corresponde ao manifesto do backup.');
  const descriptors = materialDescriptors(manifest);
  let offset = ARCHIVE_HEADER_BYTES + size;
  const offsets = descriptors.map(item => { const start = offset; offset += item.byteLength; return start; });
  if (offset !== file.size) throw new Error('O backup está incompleto ou contém dados excedentes.');
  return {
    manifest,
    async readMaterial(index) {
      if (!Number.isInteger(index) || !descriptors[index]) throw new Error('O material solicitado não existe no backup.');
      const bytes = new Uint8Array(await file.slice(offsets[index], offsets[index] + descriptors[index].byteLength).arrayBuffer());
      await verifyMaterial(bytes, descriptors[index]);
      return bytes;
    },
  };
}

export function isBackupArchive(value: unknown): value is BackupArchive {
  return typeof value === 'object' && value !== null && 'manifest' in value && 'readMaterial' in value && typeof value.readMaterial === 'function';
}
