import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { BackupDocument } from '../../shared/types';
import { readBackupArchive } from '../backup-archive';
import type { BackupArchiveManifest } from '../backup-archive';
import { createNativeStorage } from './native';
import { advanceSchedule } from '../../domain/spaced-repetition/engine';

const TIME = '2026-10-13T12:00:00.000Z';
const snapshot = { subjects: [], notes: [], flashcards: [], reviewLogs: [], settings: { theme: 'light' as const } };

function archiveFixture(): { manifest: BackupArchiveManifest; bytes: Uint8Array } {
  const bytes = new TextEncoder().encode('Ação e reação: Física.');
  return {
    bytes,
    manifest: {
      format: 'studyspace-backup', version: 3, exportedAt: TIME,
      data: {
        ...snapshot,
        subjects: [{ id: 'subject', name: 'Física', accent: 'blue', createdAt: TIME, updatedAt: TIME }],
        notes: [{ id: 'note', subjectId: 'subject', title: 'Aula', bodyJson: { type: 'doc' }, plainText: '', revision: 1, createdAt: TIME, updatedAt: TIME }],
        documents: [{ id: 'doc', noteId: 'note', subjectId: 'subject', fileName: 'aula.txt', kind: 'txt', mimeType: 'text/plain', sha256: createHash('sha256').update(bytes).digest('hex'), pageCount: 1, createdAt: TIME }],
        cardMetadata: [],
      },
      materials: { documents: [{ documentId: 'doc', byteLength: bytes.length, pages: [{ page: 1, text: 'Ação e reação.' }] }], assets: [] },
    },
  };
}

describe('ponte Tauri', () => {
  it('envia a ativação explícita e lê a agenda com os mesmos vínculos da revisão nativa', async () => {
    const { manifest } = archiveFixture();
    const card = { id: 'card', subjectId: 'subject', noteId: 'note', front: 'Pergunta', back: 'Resposta', createdAt: TIME, updatedAt: TIME };
    const log = { id: 'review', flashcardId: card.id, sessionId: 'spaced-session', rating: 3 as const, reviewedAt: TIME };
    const schedule = advanceSchedule(undefined, log);
    const data = { ...manifest.data, flashcards: [card], reviewLogs: [log], reviewSchedules: [schedule] };
    const calls: { command: string; args?: Record<string, unknown> }[] = [];
    const storage = createNativeStorage(async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return (command === 'record_review' ? log : data) as T;
    });
    const input = { flashcardId: card.id, sessionId: log.sessionId, rating: 3 as const, schedule: true };
    expect(await storage.recordReview(input)).toEqual(log);
    expect((await storage.getSnapshot()).reviewSchedules).toEqual([schedule]);
    expect(calls[0]).toEqual({ command: 'record_review', args: { input } });
    await storage.close();
  });

  it('lista cópias verificadas e exporta a seleção pela sessão v3 sem substituir a biblioteca', async () => {
    const { manifest, bytes } = archiveFixture();
    const metadata = { id: '2335b5eb-073c-46c3-abfa-0bfd1914a42a', format: 'studyspace-recovery', version: 1, schemaVersion: 1, targetSchemaVersion: 2, createdAt: TIME, reason: 'before-migration', byteLength: 8192, sha256: 'a'.repeat(64) };
    const commands: string[] = [];
    const storage = createNativeStorage(async <T>(command: string, args?: Record<string, unknown>) => {
      commands.push(command);
      if (command === 'list_recovery_copies') return [metadata] as T;
      if (command === 'export_recovery_v3_begin') { expect(args).toEqual({ id: metadata.id }); return { token: 'recovery-session', manifest } as T; }
      if (command === 'export_backup_v3_material') return Buffer.from(bytes).toString('base64') as T;
      return undefined as T;
    });
    expect(await storage.listRecoveryCopies()).toEqual([metadata]);
    const recovered = await readBackupArchive(await storage.exportRecoveryCopy(metadata.id));
    expect(await recovered.readMaterial(0)).toEqual(bytes);
    expect(commands).toEqual(['list_recovery_copies', 'export_recovery_v3_begin', 'export_backup_v3_material', 'backup_v3_cancel']);
    await expect(storage.exportRecoveryCopy('../../database')).rejects.toThrow();
    expect(commands).toHaveLength(4);
    await storage.close();
  });

  it('envia objetos estruturados com os nomes dos comandos nativos', async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = [];
    const subject = { id: 'materia-1', name: 'Física', accent: 'blue', createdAt: TIME, updatedAt: TIME };
    const storage = createNativeStorage(async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return (command === 'get_snapshot' ? snapshot : subject) as T;
    });
    await storage.getSnapshot();
    await storage.createSubject({ name: 'Física', accent: 'blue' });
    await storage.updateSubject('materia-1', { name: 'Física', accent: 'blue' });
    await storage.setTheme('dark');
    expect(calls).toEqual([
      { command: 'get_snapshot', args: undefined },
      { command: 'create_subject', args: { input: { name: 'Física', accent: 'blue' } } },
      { command: 'update_subject', args: { id: 'materia-1', input: { name: 'Física', accent: 'blue' } } },
      { command: 'set_theme', args: { theme: 'dark' } },
    ]);
    await storage.close();
  });

  it('valida backup antes de chamar o backend e preserva o envelope acordado', async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = [];
    const storage = createNativeStorage(async <T>(command: string, args?: Record<string, unknown>) => { calls.push({ command, args }); return undefined as T; });
    await expect(storage.restoreBackup({ format: 'studyspace-backup', version: 42 })).rejects.toThrow('inválido');
    expect(calls).toHaveLength(0);
    const backup: BackupDocument = { format: 'studyspace-backup', version: 1, exportedAt: TIME, data: snapshot };
    await storage.restoreBackup(backup);
    expect(calls).toEqual([{ command: 'restore_backup', args: { backup } }]);
    await storage.close();
    await expect(storage.getSnapshot()).rejects.toThrow('fechado');
  });

  it('exporta cada material da sessão consistente e libera o staging nativo', async () => {
    const { manifest, bytes } = archiveFixture();
    const calls: { command: string; args?: Record<string, unknown> }[] = [];
    const storage = createNativeStorage(async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return (command === 'export_backup_v3_begin' ? { token: 'session-export', manifest }
        : command === 'export_backup_v3_material' ? Buffer.from(bytes).toString('base64') : undefined) as T;
    });
    const archive = await readBackupArchive(await storage.exportBackupArchive());
    expect(archive.manifest).toEqual(manifest);
    expect(await archive.readMaterial(0)).toEqual(bytes);
    expect(calls).toEqual([
      { command: 'export_backup_v3_begin', args: undefined },
      { command: 'export_backup_v3_material', args: { token: 'session-export', index: 0 } },
      { command: 'backup_v3_cancel', args: { token: 'session-export' } },
    ]);
  });

  it('cancela a sessão de exportação quando o material está corrompido', async () => {
    const { manifest, bytes } = archiveFixture();
    const calls: string[] = [];
    const storage = createNativeStorage(async <T>(command: string) => {
      calls.push(command);
      return (command === 'export_backup_v3_begin' ? { token: 'session-export', manifest }
        : command === 'export_backup_v3_material' ? Buffer.from(new Uint8Array(bytes.length)).toString('base64') : undefined) as T;
    });
    await expect(storage.exportBackupArchive()).rejects.toThrow('integridade');
    expect(calls.at(-1)).toBe('backup_v3_cancel');
  });

  it('restaura materiais sequencialmente antes do único commit e cancela a sessão ao concluir', async () => {
    const { manifest, bytes } = archiveFixture();
    const calls: { command: string; args?: Record<string, unknown> }[] = [];
    const storage = createNativeStorage(async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return (command === 'restore_backup_v3_begin' ? 'session-restore' : undefined) as T;
    });
    const readMaterial = vi.fn(async () => bytes);
    await storage.restoreBackupArchive({ manifest, readMaterial });
    expect(readMaterial).toHaveBeenCalledExactlyOnceWith(0);
    expect(calls).toEqual([
      { command: 'restore_backup_v3_begin', args: { manifest } },
      { command: 'restore_backup_v3_material', args: { token: 'session-restore', index: 0, dataBase64: Buffer.from(bytes).toString('base64') } },
      { command: 'restore_backup_v3_finish', args: { token: 'session-restore' } },
      { command: 'backup_v3_cancel', args: { token: 'session-restore' } },
    ]);
  });

  it('descarta staging sem commit quando a leitura ou integridade do arquivo falha', async () => {
    const { manifest, bytes } = archiveFixture();
    const calls: string[] = [];
    const storage = createNativeStorage(async <T>(command: string) => {
      calls.push(command);
      return (command === 'restore_backup_v3_begin' ? 'session-restore' : undefined) as T;
    });
    await expect(storage.restoreBackupArchive({ manifest, readMaterial: async () => new Uint8Array(bytes.length) })).rejects.toThrow('integridade');
    expect(calls).toEqual(['restore_backup_v3_begin', 'backup_v3_cancel']);
    calls.length = 0;
    await expect(storage.restoreBackupArchive({ manifest, readMaterial: async () => { throw new Error('arquivo removido'); } })).rejects.toThrow('arquivo removido');
    expect(calls).toEqual(['restore_backup_v3_begin', 'backup_v3_cancel']);
  });
});
