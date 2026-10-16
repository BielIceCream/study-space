import { describe, expect, it } from 'vitest';
import { parseImportFile } from './parser';
import { htmlToPlainText } from './text';
import { MAX_IMPORT_FILE_BYTES } from './types';

const file = (name: string, text: string) => new File([text], name);
describe('importação de texto e cartões', () => {
  it('detecta cabeçalhos portugueses, UTF-8 BOM, ponto e vírgula, aspas e linhas múltiplas', async () => {
    const result = await parseImportFile(file('cartoes.csv', '\uFEFFVerso;Frente\r\n"A; resposta";"Qual é\n a pergunta?"\r\n"Diz ""sim""";Outra'), { subjectId: 'biologia' });
    expect(result.suggestedMapping).toEqual({ frontColumn: 1, backColumn: 0, hasHeader: true });
    expect(result.batch.flashcards).toEqual([{ front: 'Qual é\n a pergunta?', back: 'A; resposta' }, { front: 'Outra', back: 'Diz "sim"' }]);
    expect(result.batch.subjectId).toBe('biologia');
  });
  it('permite mapear colunas e omitir a primeira linha explicitamente', async () => {
    const result = await parseImportFile(file('cards.tsv', 'ID\tEnunciado\tSolução\n1\tQ\tA'), { columnMapping: { frontColumn: 1, backColumn: 2, hasHeader: true } });
    expect(result.columns).toEqual(['ID', 'Enunciado', 'Solução']);
    expect(result.batch.flashcards).toEqual([{ front: 'Q', back: 'A' }]);
  });
  it('rejeita CSV truncado e coluna ausente em vez de salvar um lote parcial', async () => {
    await expect(parseImportFile(file('bad.csv', 'front,back\nQ,A\n"broken,A'))).rejects.toThrow('aspas');
    await expect(parseImportFile(file('bad.csv', 'front,back\nQ,A\nQ2,'))).rejects.toThrow('linha 3');
  });
  it('aceita JSON estável com notas, cartões vinculados e tags', async () => {
    const result = await parseImportFile(file('cards.json', JSON.stringify({ format: 'studyspace-import', version: 1, notes: [{ title: 'Aula', text: 'Texto de origem' }], flashcards: [{ question: 'Q', answer: 'A', noteIndex: 0, tags: ['biologia', 'biologia'] }] })));
    expect(result.batch.notes[0].bodyJson.content?.[0].content?.[0].text).toBe('Texto de origem');
    expect(result.batch.flashcards).toEqual([{ front: 'Q', back: 'A', noteIndex: 0, tags: ['biologia'] }]);
  });
  it('rejeita referências JSON inválidas e conteúdo acima do limite', async () => {
    await expect(parseImportFile(file('cards.json', JSON.stringify([{ front: 'Q', back: 'A', noteIndex: 0 }])))).rejects.toThrow('noteIndex');
    await expect(parseImportFile(file('cards.json', JSON.stringify([{ front: 'Q', back: 'a'.repeat(20_001) }])))).rejects.toThrow('20.000');
    await expect(parseImportFile(file('cards.json', '[]'))).rejects.toThrow('não contém');
  });
  it('identifica duplicatas internas e existentes apenas na matéria escolhida', async () => {
    const cards = [{ subjectId: 's', front: 'Q', back: 'A' }, { subjectId: 'other', front: 'Outra', back: 'B' }] as never;
    const result = await parseImportFile(file('cards.json', JSON.stringify([{ front: ' q ', back: 'a' }, { front: 'Q', back: 'A' }, { front: 'Outra', back: 'B' }])), { subjectId: 's', snapshot: { flashcards: cards } });
    expect(result.duplicates).toBe(2);
    expect(result.counts.flashcards).toBe(3);
  });
  it('preserva o arquivo TXT original com hash e cria uma nota editável', async () => {
    const result = await parseImportFile(file('aula.txt', 'Primeira linha\nSegunda linha'), { subjectId: 's' });
    expect(result.counts).toEqual({ notes: 1, flashcards: 0, documents: 1, assets: 0 });
    expect(result.batch.documents[0]).toMatchObject({ kind: 'txt', noteIndex: 0, pages: [{ page: 1, text: 'Primeira linha\nSegunda linha' }] });
    expect(atob(result.batch.documents[0].dataBase64)).toBe('Primeira linha\nSegunda linha');
    expect(result.batch.documents[0].sha256).toMatch(/^[a-f\d]{64}$/);
    expect(result.batch.notes[0].title).toBe('aula');
  });
  it('rejeita formato incorreto, vazio, oversized, UTF-8 inválido e cancelamento', async () => {
    await expect(parseImportFile(file('a.exe', 'hello'))).rejects.toThrow('Formato');
    await expect(parseImportFile(file('a.txt', ''))).rejects.toThrow('vazio');
    await expect(parseImportFile(new File([new Uint8Array(MAX_IMPORT_FILE_BYTES + 1)], 'a.txt'))).rejects.toThrow('32 MiB');
    await expect(parseImportFile(new File([Uint8Array.of(255)], 'a.csv'))).rejects.toThrow('UTF-8');
    const control = new AbortController(); control.abort();
    await expect(parseImportFile(file('a.txt', 'text'), { signal: control.signal })).rejects.toThrow('cancelada');
  });
  it('remove conteúdo ativo e decodifica entidades sem executar HTML', () => {
    expect(htmlToPlainText('<p>A &amp; B</p><svg><script>bad()</script></svg><img src="https://evil"><iframe>bad</iframe>')).toBe('A & B');
  });
});
