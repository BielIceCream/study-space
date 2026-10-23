import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  ARCHIVE_HEADER_BYTES, ARCHIVE_MAGIC, MAX_ARCHIVE_BYTES, MAX_DOCUMENT_BYTES,
  createBackupArchive, readBackupArchive, validateArchiveManifest,
} from './backup-archive';
import type { BackupArchiveManifest } from './backup-archive';
import { downloadBackup, readBackupFile } from './backup-files';

const time = '2026-10-18T12:00:00.000Z';
function fixture(): BackupArchiveManifest {
  return {
    format: 'studyspace-backup', version: 3, exportedAt: time,
    data: { subjects: [], notes: [], flashcards: [], reviewLogs: [], settings: { theme: 'light' }, documents: [], cardMetadata: [] },
    materials: { documents: [], assets: [] },
  };
}

describe('contrato do backup escalável', () => {
  it('gera pacote vazio autossuficiente, autodetecta o conteúdo e baixa com extensão própria', async () => {
    const manifest = fixture();
    const read = vi.fn();
    const blob = await createBackupArchive(manifest, read);
    expect(read).not.toHaveBeenCalled();
    expect(blob.size).toBe(ARCHIVE_HEADER_BYTES + Buffer.byteLength(JSON.stringify(manifest)));
    const file = new File([blob], 'backup-sem-extensao');
    const archive = await readBackupFile(file) as Awaited<ReturnType<typeof readBackupArchive>>;
    expect(archive.manifest).toEqual(manifest);
    await expect(archive.readMaterial(-1)).rejects.toThrow('não existe');
    await expect(archive.readMaterial(0.5)).rejects.toThrow('não existe');
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('document', { createElement: () => link, body: { append: vi.fn() } });
    vi.stubGlobal('window', { setTimeout: vi.fn() });
    const url = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    try {
      downloadBackup(blob);
      expect(link.download).toMatch(/\.studyspace$/);
      expect(url).toHaveBeenCalledWith(blob);
      expect(link.click).toHaveBeenCalledOnce();
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });

  it('recusa o tamanho agregado antes de solicitar materiais e inclui o manifesto no orçamento', async () => {
    const manifest = fixture();
    const subject = { id: 'subject', name: 'Matéria', accent: 'blue' as const, createdAt: time, updatedAt: time };
    manifest.data.subjects.push(subject);
    // Eight maximum-sized materials alone reach 256 MiB; the header/manifest must also fit.
    for (let index = 0; index < 8; index++) {
      const id = `doc-${index}`;
      manifest.data.notes.push({ id, subjectId: subject.id, title: id, bodyJson: { type: 'doc' }, plainText: '', revision: 1, createdAt: time, updatedAt: time });
      manifest.data.documents!.push({ id, subjectId: subject.id, noteId: id, fileName: `${id}.txt`, kind: 'txt', mimeType: 'text/plain', sha256: 'a'.repeat(64), pageCount: 0, createdAt: time });
      manifest.materials.documents.push({ documentId: id, byteLength: MAX_DOCUMENT_BYTES, pages: [] });
    }
    const read = vi.fn();
    await expect(createBackupArchive(manifest, read)).rejects.toThrow('256 MiB');
    expect(read).not.toHaveBeenCalled();
    const payloadBytes = MAX_ARCHIVE_BYTES - ARCHIVE_HEADER_BYTES - Buffer.byteLength(JSON.stringify(manifest));
    manifest.materials.documents.at(-1)!.byteLength -= MAX_ARCHIVE_BYTES - payloadBytes;
    expect(() => validateArchiveManifest(manifest)).not.toThrow();
  });

  it('verifica manifesto, material original e bytes físicos antes de considerar um pacote utilizável', async () => {
    const bytes = new TextEncoder().encode('Conteúdo original 🧠');
    const manifest = fixture();
    manifest.data.subjects.push({ id: 's', name: 'Ciências', accent: 'green', createdAt: time, updatedAt: time });
    manifest.data.notes.push({ id: 'n', subjectId: 's', title: 'Original', bodyJson: { type: 'doc' }, plainText: '', revision: 1, createdAt: time, updatedAt: time });
    manifest.data.documents!.push({ id: 'd', subjectId: 's', noteId: 'n', fileName: '../../original.txt', kind: 'txt', mimeType: 'text/plain', sha256: createHash('sha256').update(bytes).digest('hex'), pageCount: 0, createdAt: time });
    manifest.materials.documents.push({ documentId: 'd', byteLength: bytes.length, pages: [] });
    await expect(createBackupArchive(manifest, async () => bytes.slice(1))).rejects.toThrow('tamanho');
    const changed = bytes.slice(); changed[0] ^= 1;
    await expect(createBackupArchive(manifest, async () => changed)).rejects.toThrow('integridade');
    const file = await createBackupArchive(manifest, async () => bytes);
    const archive = await readBackupArchive(file);
    expect(await archive.readMaterial(0)).toEqual(bytes);
    // Names remain metadata; the format does not extract paths onto the filesystem.
    expect(archive.manifest.data.documents![0].fileName).toBe('../../original.txt');
    const raw = new Uint8Array(await file.arrayBuffer());
    raw[ARCHIVE_MAGIC.length + 4] ^= 1;
    await expect(readBackupArchive(new Blob([raw]))).rejects.toThrow('integridade do manifesto');
  });
});
