import { z } from 'zod';
import type { SqlJsStatic } from 'sql.js';
import type { PersistenceAdapter } from './persistence';
import { hashSchema, utcSchema, validate } from './validation';

export const RECOVERY_RETENTION = 3;
export const recoveryIdSchema = z.string().uuid();
export const recoveryMetadataSchema = z.object({
  id: recoveryIdSchema, format: z.literal('studyspace-recovery'), version: z.literal(1),
  schemaVersion: z.number().int().min(0).max(2_147_483_647),
  targetSchemaVersion: z.number().int().min(1).max(2_147_483_647),
  createdAt: utcSchema, reason: z.literal('before-migration'),
  byteLength: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), sha256: hashSchema,
}).strict().refine(meta => meta.targetSchemaVersion > meta.schemaVersion, 'As versões da cópia de recuperação são inconsistentes.');

export type RecoveryMetadata = z.infer<typeof recoveryMetadataSchema>;
export interface RecoveryRecord { metadata: RecoveryMetadata; bytes: Uint8Array }

export function parseRecoveryMetadata(value: unknown): RecoveryMetadata {
  return validate(recoveryMetadataSchema, value, 'Os metadados da cópia de recuperação são inválidos.');
}

export async function recoveryHash(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyRecoveryRecord(record: RecoveryRecord, SQL: SqlJsStatic): Promise<RecoveryRecord> {
  const metadata = parseRecoveryMetadata(record.metadata);
  if (!(record.bytes instanceof Uint8Array) || record.bytes.length !== metadata.byteLength || await recoveryHash(record.bytes) !== metadata.sha256) {
    throw new Error('A integridade da cópia de recuperação não confere. O banco atual não foi alterado.');
  }
  const db = new SQL.Database(record.bytes);
  try {
    const version = Number(db.exec('PRAGMA user_version')[0]?.values[0]?.[0]);
    if (version !== metadata.schemaVersion || db.exec('PRAGMA quick_check')[0]?.values[0]?.[0] !== 'ok' || db.exec('PRAGMA foreign_key_check').some(result => result.values.length)) {
      throw new Error('A cópia de recuperação contém um banco inconsistente.');
    }
    // Read SQLite's catalog as well; a hash alone does not prove SQLite readability.
    db.exec('SELECT name,type FROM sqlite_master');
    return { metadata, bytes: record.bytes };
  } finally { db.close(); }
}

export async function listRecoveryMetadata(persistence: PersistenceAdapter): Promise<RecoveryMetadata[]> {
  const valid: RecoveryMetadata[] = [];
  for (const item of await persistence.listRecovery()) {
    const parsed = recoveryMetadataSchema.safeParse(item);
    if (parsed.success) valid.push(parsed.data);
  }
  return valid.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

/** Called under the same exclusive lease that protects load/migrate/save. */
export async function protectBeforeMigration(persistence: PersistenceAdapter, SQL: SqlJsStatic, bytes: Uint8Array, schemaVersion: number, targetSchemaVersion: number, createdAt: string): Promise<void> {
  try {
    const sha256 = await recoveryHash(bytes);
    const copies = await listRecoveryMetadata(persistence);
    const prior = copies.filter(meta => meta.sha256 === sha256 && meta.schemaVersion === schemaVersion && meta.targetSchemaVersion === targetSchemaVersion);
    for (const metadata of prior) {
      try {
        const record = await persistence.loadRecovery(metadata.id);
        if (record && JSON.stringify(parseRecoveryMetadata(record.metadata)) === JSON.stringify(metadata)) {
          await verifyRecoveryRecord(record, SQL);
          // Never prune before the retained copy has been read back and checked.
          await persistence.pruneRecovery(metadata.id).catch(() => undefined);
          return;
        }
      } catch { /* Keep a damaged old record; create a new verified copy below. */ }
    }
    const metadata = parseRecoveryMetadata({
      id: crypto.randomUUID(), format: 'studyspace-recovery', version: 1,
      schemaVersion, targetSchemaVersion,
      // Stable retention even for retries within one millisecond or a clock rollback.
      createdAt: copies[0] && createdAt <= copies[0].createdAt ? new Date(Date.parse(copies[0].createdAt) + 1).toISOString() : createdAt,
      reason: 'before-migration', byteLength: bytes.length, sha256,
    });
    await verifyRecoveryRecord({ metadata, bytes }, SQL);
    await persistence.saveRecovery({ metadata, bytes });
    const durable = await persistence.loadRecovery(metadata.id);
    if (!durable || JSON.stringify(parseRecoveryMetadata(durable.metadata)) !== JSON.stringify(metadata)) throw new Error('A cópia não pôde ser relida após a gravação.');
    await verifyRecoveryRecord(durable, SQL);
    await persistence.pruneRecovery(metadata.id).catch(() => undefined);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'Falha ao acessar o armazenamento.';
    throw new Error(`Não foi possível verificar uma cópia antes da atualização. O banco anterior foi preservado. Libere espaço ou baixe uma cópia recuperada e tente novamente. ${detail}`);
  }
}
