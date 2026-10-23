import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackupDocument } from '../shared/types';
import { downloadBackup, readBackupFile } from './backup-files';
import { serializeBackup } from './backup-json';
import { MAX_BACKUP_BYTES, validateBackup } from './storage/validation';

const time = '2026-10-18T12:00:00.000Z';
const body = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

function backupAtLimit(): BackupDocument {
  const backup: BackupDocument = {
    format: 'studyspace-backup', version: 2, exportedAt: time,
    data: {
      subjects: [{ id: 'subject', name: 'Matemática 🧠', accent: 'blue', createdAt: time, updatedAt: time }],
      notes: Array.from({ length: 27 }, (_, index) => {
        const text = index < 26 ? 'a'.repeat(1_000_000) : '';
        return { id: `note-${index}`, subjectId: 'subject', title: 'Revisão', bodyJson: body(text), plainText: text, revision: 1, createdAt: time, updatedAt: time };
      }),
      flashcards: [], reviewLogs: [], settings: { theme: 'light' }, documents: [], cardMetadata: [],
    },
    materials: { documents: [], assets: [] },
  };
  const remaining = MAX_BACKUP_BYTES - Buffer.byteLength(JSON.stringify(backup));
  const last = backup.data.notes.at(-1)!;
  const text = 'a'.repeat(Math.floor(remaining / 2));
  last.bodyJson = body(text); last.plainText = text;
  if (remaining % 2) last.title += 'a';
  return backup;
}

function smallBackup(version: 1 | 2): BackupDocument {
  return {
    format: 'studyspace-backup', version, exportedAt: time,
    data: {
      subjects: [{ id: 'subject', name: 'Redação 🧠', accent: 'blue', createdAt: time, updatedAt: time }],
      notes: [{ id: 'note', subjectId: 'subject', title: 'Revisão de ação', bodyJson: body('Acentos, emoji 🧠, aspas " e quebra\nde linha.'), plainText: 'Acentos, emoji 🧠, aspas " e quebra\nde linha.', revision: 7, createdAt: time, updatedAt: time }],
      flashcards: [{ id: 'card', subjectId: 'subject', noteId: 'note', front: 'Qual é a função?', back: 'Explicação 🧠.', createdAt: time, updatedAt: time }],
      reviewLogs: [{ id: 'review', flashcardId: 'card', sessionId: 'session', rating: 3, reviewedAt: time }],
      settings: { theme: 'dark' },
    },
    ...(version === 2 ? { materials: { documents: [], assets: [] } } : {}),
  };
}

function captureDownload() {
  let downloaded: Blob | undefined;
  const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { downloaded = blob as Blob; return 'blob:backup-test'; });
  vi.stubGlobal('document', { createElement: () => link, body: { append: vi.fn() } });
  vi.stubGlobal('window', { setTimeout: vi.fn() });
  return { file: () => new File([downloaded!], link.download, { type: 'application/json' }), createObjectURL, link };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('arquivo físico de backup', () => {
  it('permite reler o backup válido baixado exatamente no limite de 50 MiB', async () => {
    const backup = backupAtLimit();
    expect(Buffer.byteLength(JSON.stringify(backup))).toBe(MAX_BACKUP_BYTES);
    // This is a valid library, not padding in unknown fields of a malformed envelope.
    validateBackup(backup);
    const download = captureDownload();
    downloadBackup(backup);
    const file = download.file();
    expect(file.size).toBe(MAX_BACKUP_BYTES);
    const restored = await readBackupFile(file) as BackupDocument;
    expect(restored.data.notes).toHaveLength(27);
    expect(restored.data.notes.at(-1)).toEqual(backup.data.notes.at(-1));
    expect(restored.data.subjects).toEqual(backup.data.subjects);

    // One extra byte must fail before a download or a file read is attempted.
    backup.data.notes.at(-1)!.title += 'a';
    download.createObjectURL.mockClear(); download.link.click.mockClear();
    expect(() => validateBackup(backup)).toThrow('50 MiB');
    expect(() => downloadBackup(backup)).toThrow('50 MiB');
    expect(download.createObjectURL).not.toHaveBeenCalled();
    expect(download.link.click).not.toHaveBeenCalled();
    const oversized = new File([file, ' '], 'grande.json');
    const read = vi.spyOn(oversized, 'text');
    await expect(readBackupFile(oversized)).rejects.toThrow('50 MiB');
    expect(read).not.toHaveBeenCalled();

    // Accents and emoji consume UTF-8 bytes, not their JavaScript string length.
    backup.data.notes.at(-1)!.title = backup.data.notes.at(-1)!.title.slice(0, -2) + 'é';
    expect(() => downloadBackup(backup)).toThrow('50 MiB');
    backup.data.notes.at(-1)!.title = backup.data.notes.at(-1)!.title.slice(0, -1) + '🧠';
    expect(() => downloadBackup(backup)).toThrow('50 MiB');
  }, 20_000);

  it.each([1, 2] as const)('preserva o backup v%i baixado e continua lendo arquivos antigos indentados', async version => {
    const backup = smallBackup(version);
    validateBackup(backup);
    const download = captureDownload();
    downloadBackup(backup);
    const file = download.file();
    const text = await file.text();
    expect(text).toBe(JSON.stringify(backup));
    expect(file.size).toBe(Buffer.byteLength(text));
    expect(file.size).toBeGreaterThan(text.length);
    expect(validateBackup(await readBackupFile(file))).toEqual(backup);
    const legacy = new File([JSON.stringify(backup, null, 2)], 'antigo.json');
    expect(validateBackup(await readBackupFile(legacy))).toEqual(backup);
  });

  it('rejeita JSON ilegível e mantém validação estrutural e de materiais no armazenamento', async () => {
    for (const text of ['', '{inválido']) {
      await expect(readBackupFile(new File([text], 'invalido.json'))).rejects.toThrow('JSON válido');
    }
    const future = await readBackupFile(new File([JSON.stringify({ ...smallBackup(2), version: 99 })], 'futuro.json'));
    expect(() => validateBackup(future)).toThrow('versão não suportada');
    const missingImage = smallBackup(2);
    missingImage.data.cardMetadata = [{ flashcardId: 'card', tags: ['revisão'], images: [{ assetHash: 'a'.repeat(64), side: 'front' }] }];
    expect(() => validateBackup(missingImage)).toThrow('imagens dos cartões');
  });

  it('recusa valores não serializáveis antes de criar um arquivo', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const value of [circular, undefined, 1n]) {
      expect(() => serializeBackup(value)).toThrow('JSON válido');
    }
  });
});
