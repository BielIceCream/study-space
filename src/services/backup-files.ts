import type { BackupDocument } from '../shared/types';
import { assertBackupSize, serializeBackup } from './backup-json';
import { ARCHIVE_MAGIC, isArchiveHeader, readBackupArchive } from './backup-archive';

export function downloadBackup(backup: BackupDocument | Blob): void {
  const archive = backup instanceof Blob;
  const blob = archive ? backup : new Blob([serializeBackup(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = archive ? `studyspace-backup-${new Date().toISOString().slice(0, 10)}.studyspace` : `studyspace-backup-${backup.exportedAt.slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function readBackupFile(file: File): Promise<unknown> {
  const prefix = new Uint8Array(await file.slice(0, ARCHIVE_MAGIC.length).arrayBuffer());
  if (isArchiveHeader(prefix)) return readBackupArchive(file);
  assertBackupSize(file.size);
  try { return JSON.parse(await file.text()); }
  catch { throw new Error('Este arquivo não contém um backup JSON válido.'); }
}
