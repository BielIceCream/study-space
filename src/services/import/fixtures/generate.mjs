// Run with Node from any directory. Creates deterministic local files used by desktop/browser QA.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { zipSync, strToU8 } from 'fflate';

const directory = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
await mkdir(directory, { recursive: true });
const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
const db = new SQL.Database();
db.run('CREATE TABLE col(models TEXT); CREATE TABLE notes(id INTEGER, mid INTEGER, flds TEXT, tags TEXT); CREATE TABLE cards(nid INTEGER, ord INTEGER);');
db.run('INSERT INTO col VALUES (?)', [JSON.stringify({ 1: { type: 0, flds: [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }], tmpls: [{ ord: 0, qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr>{{Back}}' }, { ord: 1, qfmt: '{{Back}}', afmt: '{{Front}}' }] }, 2: { type: 1, flds: [{ name: 'Text', ord: 0 }, { name: 'Extra', ord: 1 }], tmpls: [{ ord: 0, qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>{{Extra}}' }] } })]);
db.run('INSERT INTO notes VALUES (1,1,?,?)', ['<b>Qual a função da membrana?</b><img src="diagram.png" alt="Diagrama">\x1fRegular a passagem de substâncias.', ' biologia membrana ']);
db.run('INSERT INTO notes VALUES (2,2,?,?)', ['A {{c1::membrana::estrutura}} regula {{c2::passagem}}.\x1fFonte: aula de biologia.', ' cloze biologia ']);
db.run('INSERT INTO cards VALUES (1,0),(1,1),(2,0),(2,1);');
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNT0AAAAASUVORK5CYII=', 'base64'));
const apkg = zipSync({ 'collection.anki2': db.export(), media: strToU8('{"0":"diagram.png"}'), '0': png });
db.close();
await writeFile(new URL('studyspace.apkg', import.meta.url), apkg);

const docx = zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
  '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
  'word/document.xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Membrana celular</w:t></w:r></w:p><w:p><w:r><w:t>A membrana regula a passagem de substâncias.</w:t></w:r></w:p><w:p><w:r><w:t>Texto seguro &amp; persistente.</w:t></w:r></w:p></w:body></w:document>'),
});
await writeFile(new URL('studyspace.docx', import.meta.url), docx);

const pageContents = ['StudySpace - page one: membrane', 'Page two: transport and review'];
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
  '',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
  '',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];
for (let index = 0; index < pageContents.length; index += 1) {
  const stream = `BT /F1 18 Tf 72 720 Td (${pageContents[index]}) Tj ET\n`;
  objects[index === 0 ? 3 : 5] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`;
}
let pdf = '%PDF-1.4\n'; const offsets = [0];
for (let index = 0; index < objects.length; index += 1) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`; }
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
await writeFile(new URL('studyspace.pdf', import.meta.url), pdf);
await writeFile(new URL('studyspace.csv', import.meta.url), '\uFEFFFrente;Verso\n"O que regula a membrana?";"A passagem de substâncias."\n"Linha múltipla\ncontinua";"Resposta com ; separador"');
await writeFile(new URL('studyspace.tsv', import.meta.url), 'Front\tBack\nPergunta TSV\tResposta TSV');
await writeFile(new URL('studyspace.json', import.meta.url), JSON.stringify({ format: 'studyspace-import', version: 1, notes: [{ title: 'Aula JSON', text: 'Fonte textual preservada.' }], flashcards: [{ front: 'Pergunta JSON', back: 'Resposta JSON', tags: ['biologia'], noteIndex: 0 }] }, null, 2));
await writeFile(new URL('studyspace.txt', import.meta.url), 'Aula TXT\nA membrana celular regula a passagem de substâncias.');
await writeFile(new URL('studyspace.md', import.meta.url), '# Aula Markdown\n\n**Membrana:** regula a passagem de substâncias.');
console.log('Fixtures gerados:', directory);
