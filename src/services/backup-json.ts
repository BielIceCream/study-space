/** UTF-8 backup byte limit; native validation enforces it on compact JSON. */
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

export function assertBackupSize(byteLength: number): void {
  if (byteLength > MAX_BACKUP_BYTES) {
    throw new Error('O backup deve ter até 50 MiB. Seus dados locais não foram alterados.');
  }
}

/** Size and file encoding only; storage adapters still validate the backup schema. */
export function serializeBackup(value: unknown): string {
  let encoded: string | undefined;
  try { encoded = JSON.stringify(value); }
  catch { throw new Error('O backup não contém JSON válido.'); }
  if (!encoded) throw new Error('O backup não contém JSON válido.');
  assertBackupSize(new TextEncoder().encode(encoded).byteLength);
  return encoded;
}
