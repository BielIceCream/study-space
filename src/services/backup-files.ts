import type { BackupDocument } from '../shared/types';

export function downloadBackup(backup: BackupDocument): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `studyspace-backup-${backup.exportedAt.slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function readBackupFile(file: File): Promise<unknown> {
  if (file.size > 50 * 1024 * 1024) throw new Error('O backup deve ter até 50 MB.');
  try { return JSON.parse(await file.text()); }
  catch { throw new Error('Este arquivo não contém um backup JSON válido.'); }
}
