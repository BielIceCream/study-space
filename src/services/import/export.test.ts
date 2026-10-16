import { createHash } from 'node:crypto';
import type { CardMetadata, Flashcard } from '../../shared/types';
import { describe, expect, it } from 'vitest';
import { createFlashcardExport, FLASHCARD_EXPORT_WARNING } from './export';
import { parseImportFile } from './parser';

const card = (id: string, front: string, back: string): Flashcard => ({ id, front, back, subjectId: 's', noteId: null, createdAt: '2026-10-13T12:00:00.000Z', updatedAt: '2026-10-13T12:00:00.000Z' });

describe('originais JSON e exportação interoperável', () => {
  it('preserva bytes, SHA-256 e origem lógica quando o JSON inclui notas', async () => {
    const text = '\uFEFF' + JSON.stringify({ format: 'studyspace-import', version: 1, notes: [{ title: 'Primeira nota', text: 'Texto com acentuação: membranáceo.' }, { title: 'Segunda nota', text: 'Outra fonte.' }], flashcards: [{ front: 'Q', back: 'A', noteIndex: 1 }] }, null, 2);
    const bytes = new TextEncoder().encode(text);
    const parsed = await parseImportFile(new File([bytes], 'aula.json'));
    expect(parsed.batch.documents).toHaveLength(1);
    const original = parsed.batch.documents[0];
    expect(original).toMatchObject({ noteIndex: 0, fileName: 'aula.json', kind: 'json', mimeType: 'application/json', pages: [{ page: 1, text: 'Texto com acentuação: membranáceo.' }] });
    expect(Buffer.from(original.dataBase64, 'base64')).toEqual(Buffer.from(bytes));
    expect(original.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(parsed.batch.flashcards[0].noteIndex).toBe(1);
  });
  it('exporta/reimporta textos literais e tags preservando ordem, sem mídia ou vínculos', async () => {
    const cards = [card('one', 'Como exibir <div> literalmente?', 'Use texto; símbolos < e >.'), card('two', 'Pergunta\nmultilinha', 'Resposta com acentuação')];
    const metadata: CardMetadata[] = [{ flashcardId: 'one', tags: [' HTML ', 'biologia', 'HTML'], images: [{ assetHash: '0'.repeat(64), side: 'front' }] }, { flashcardId: 'other', tags: ['ignorar'], images: [] }];
    const before = JSON.stringify(metadata);
    const exported = createFlashcardExport(cards, metadata);
    expect(exported).toEqual({ format: 'studyspace-import', version: 1, flashcards: [{ front: cards[0].front, back: cards[0].back, tags: ['HTML', 'biologia'] }, { front: cards[1].front, back: cards[1].back, tags: [] }] });
    expect(JSON.stringify(metadata)).toBe(before);
    const parsed = await parseImportFile(new File([JSON.stringify(exported)], 'cards.json'));
    expect(parsed.batch.flashcards).toEqual(exported.flashcards);
    expect(parsed.batch.documents).toHaveLength(0);
    expect(parsed.batch.assets).toHaveLength(0);
    expect(FLASHCARD_EXPORT_WARNING).toContain('backup completo');
  });
  it('recusa mais de 5.000 cartões e arquivos exportados acima de 32 MiB', () => {
    expect(() => createFlashcardExport(Array.from({ length: 5_001 }, (_, index) => card(String(index), 'Q', 'A')), [])).toThrow('5000');
    expect(() => createFlashcardExport(Array.from({ length: 900 }, (_, index) => card(String(index), 'Q'.repeat(20_000), 'A'.repeat(20_000))), [])).toThrow('32 MiB');
  });
});
