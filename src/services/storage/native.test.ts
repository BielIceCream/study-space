import { describe, expect, it } from 'vitest';
import type { BackupDocument } from '../../shared/types';
import { createNativeStorage } from './native';

const TIME = '2026-10-13T12:00:00.000Z';
const snapshot = { subjects: [], notes: [], flashcards: [], reviewLogs: [], settings: { theme: 'light' as const } };

describe('ponte Tauri', () => {
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
});
