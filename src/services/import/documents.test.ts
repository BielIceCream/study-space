import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { parseImportFile } from './parser';
import { docxText } from './documents';

vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', async () => {
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  return { default: pathToFileURL(createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs')).href };
});

describe('documentos originais e PDF.js real', () => {
  it('extrai texto de ambas as páginas e mantém bytes/hash independentes do buffer PDF.js', async () => {
    const bytes = await readFile(new URL('./fixtures/studyspace.pdf', import.meta.url));
    const progress: number[] = [];
    const result = await parseImportFile(new File([bytes], 'studyspace.pdf'), { onProgress: value => { if (value.stage === 'extracting') progress.push(value.completed); } });
    expect(result.batch.documents[0].pages).toEqual([{ page: 1, text: 'StudySpace - page one: membrane' }, { page: 2, text: 'Page two: transport and review' }]);
    expect(result.batch.notes[0].plainText).toContain('Página 2\nPage two');
    expect(Buffer.from(result.batch.documents[0].dataBase64, 'base64')).toEqual(bytes);
    expect(result.batch.documents[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(progress).toEqual([1, 2]);
  }, 20_000);
  it('rejeita PDFs corrompidos e XML com entidades externas antes de qualquer parse', async () => {
    await expect(parseImportFile(new File(['not pdf'], 'bad.pdf'))).rejects.toThrow('assinatura');
    await expect(parseImportFile(new File(['%PDF-1.4 broken'], 'bad.pdf'))).rejects.toThrow('ler este PDF');
    expect(() => docxText('<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///secret">]><document/>')).toThrow('não permitidas');
  });
});
