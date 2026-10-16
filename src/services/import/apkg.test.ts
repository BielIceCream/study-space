import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { parseImportFile } from './parser';
import { boundedZstd, renderAnkiTemplate } from './apkg';

vi.mock('sql.js/dist/sql-wasm.wasm?url', async () => {
  const { createRequire } = await import('node:module');
  return { default: createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm') };
});
const require = createRequire(import.meta.url);
const sql = initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });

function rawZstd(bytes: Uint8Array): Uint8Array {
  const output = new Uint8Array(9 + 3 + bytes.length); const view = new DataView(output.buffer);
  output.set([0x28, 0xb5, 0x2f, 0xfd, 0xa0]); view.setUint32(5, bytes.length, true);
  const block = (bytes.length << 3) | 1; output[9] = block & 255; output[10] = (block >>> 8) & 255; output[11] = (block >>> 16) & 255;
  output.set(bytes, 12); return output;
}
async function legacyApkg(withImage = false): Promise<File> {
  const SQL = await sql; const db = new SQL.Database();
  db.run('CREATE TABLE col(models TEXT); CREATE TABLE notes(id INTEGER, mid INTEGER, flds TEXT, tags TEXT); CREATE TABLE cards(nid INTEGER, ord INTEGER);');
  db.run('INSERT INTO col VALUES (?)', [JSON.stringify({ 1: { type: 0, flds: [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }], tmpls: [{ ord: 0, qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr>{{Back}}' }, { ord: 1, qfmt: '{{Back}}', afmt: '{{Front}}' }] }, 2: { type: 1, flds: [{ name: 'Text', ord: 0 }, { name: 'Extra', ord: 1 }], tmpls: [{ ord: 0, qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>{{Extra}}' }] } })]);
  db.run('INSERT INTO notes VALUES (1,1,?,?)', [`<b>Frente</b>${withImage ? '<img src="diagram.png" alt="Diagrama">' : ''}\x1fVerso`, ' ciência biologia ']);
  db.run('INSERT INTO cards VALUES (1,0),(1,1);');
  db.run('INSERT INTO notes VALUES (2,2,?,?)', ['A {{c1::membrana::estrutura}} regula {{c2::passagem}}.\x1fExtra', 'cloze']);
  db.run('INSERT INTO cards VALUES (2,0),(2,1);');
  const bytes = db.export(); db.close();
  const archive: Record<string, Uint8Array> = { 'collection.anki2': bytes, media: strToU8(withImage ? '{"0":"diagram.png"}' : '{}') };
  if (withImage) archive['0'] = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 0);
  return new File([zipSync(archive)], 'deck.apkg');
}
describe('APKG SQLite real', () => {
  it('importa básico, reverso, cloze e tags sem incluir histórico de revisão', async () => {
    const result = await parseImportFile(await legacyApkg(), { subjectId: 's' });
    expect(result.batch.flashcards).toHaveLength(4);
    expect(result.batch.flashcards[0]).toEqual({ front: 'Frente', back: 'Verso', tags: ['ciência', 'biologia'] });
    expect(result.batch.flashcards[1]).toMatchObject({ front: 'Verso', back: 'Frente' });
    expect(result.batch.flashcards[2]).toMatchObject({ front: 'A [estrutura] regula passagem.', back: 'A membrana regula passagem.\nExtra' });
    expect(result.batch.flashcards[3]).toMatchObject({ front: 'A membrana regula […].', back: 'A membrana regula passagem.\nExtra' });
  });
  it('preserva imagem local pelo hash e referências em ambos os lados', async () => {
    const result = await parseImportFile(await legacyApkg(true));
    expect(result.batch.assets).toHaveLength(1);
    expect(result.batch.assets[0].mimeType).toBe('image/png');
    const hash = result.batch.assets[0].sha256;
    expect(result.batch.flashcards[0].images).toEqual([{ assetHash: hash, side: 'front', alt: 'Diagrama' }]);
    expect(result.batch.flashcards[1].images).toEqual([{ assetHash: hash, side: 'back', alt: 'Diagrama' }]);
  });
  it('lê coleção anki21b Zstandard com modelos modernos protobuf', async () => {
    const SQL = await sql; const db = new SQL.Database();
    db.run('CREATE TABLE notetypes(id INTEGER, config BLOB); CREATE TABLE fields(ntid INTEGER, ord INTEGER, name TEXT); CREATE TABLE templates(ntid INTEGER, ord INTEGER, config BLOB); CREATE TABLE notes(id INTEGER, mid INTEGER, flds TEXT, tags TEXT); CREATE TABLE cards(nid INTEGER, ord INTEGER);');
    const qfmt = strToU8('{{Front}}'); const afmt = strToU8('{{Back}}');
    const template = Uint8Array.from([10, qfmt.length, ...qfmt, 18, afmt.length, ...afmt]);
    db.run('INSERT INTO notetypes VALUES (1,?)', [new Uint8Array()]);
    db.run("INSERT INTO fields VALUES (1,0,'Front'),(1,1,'Back'); INSERT INTO notes VALUES (1,1,'Q' || char(31) || 'A',''); INSERT INTO cards VALUES(1,0);");
    db.run('INSERT INTO templates VALUES (1,0,?)', [template]);
    const bytes = db.export(); db.close();
    const archive = zipSync({ 'collection.anki21b': rawZstd(bytes), media: rawZstd(new Uint8Array()) });
    const result = await parseImportFile(new File([archive], 'modern.apkg'));
    expect(result.batch.flashcards).toEqual([{ front: 'Q', back: 'A' }]);
  });
  it('aceita cabeçalho BMP completo e ignora mídia BMP truncada na prévia', async () => {
    const source = await legacyApkg(true);
    const archive = unzipSync(new Uint8Array(await source.arrayBuffer()));
    const bmp = new Uint8Array(58); const view = new DataView(bmp.buffer);
    bmp.set([66, 77]); view.setUint32(2, 58, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true);
    view.setInt32(18, 1, true); view.setInt32(22, 1, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true);
    archive['0'] = bmp;
    const complete = await parseImportFile(new File([zipSync(archive)], 'image.apkg'));
    expect(complete.batch.assets[0].mimeType).toBe('image/bmp');
    archive['0'] = Uint8Array.of(66, 77);
    const truncated = await parseImportFile(new File([zipSync(archive)], 'image.apkg'));
    expect(truncated.batch.assets).toHaveLength(0);
    expect(truncated.batch.warnings.join(' ')).toContain('ignorada');
  });
  it('recusa banco ausente ou truncado e Zstandard inválido', async () => {
    await expect(parseImportFile(new File([zipSync({ media: strToU8('{}') })], 'bad.apkg'))).rejects.toThrow('coleção');
    await expect(parseImportFile(new File([zipSync({ 'collection.anki2': strToU8('bad') })], 'bad.apkg'))).rejects.toThrow('SQLite');
    await expect(boundedZstd(Uint8Array.of(1, 2, 3))).rejects.toThrow('Zstandard');
  });
  it('processa condicionais sem expressão ou script e remove FrontSide da resposta', () => {
    const fields = new Map([['Front', 'Q'], ['Back', 'A'], ['Optional', '']]);
    expect(renderAnkiTemplate('{{#Optional}}skip{{/Optional}}{{^Optional}}{{Back}}{{/Optional}}{{FrontSide}}', fields)).toBe('A');
  });
});
