import type { ImportedFlashcard, ImportColumnMapping } from './types';
import { MAX_IMPORT_ITEMS } from './types';

export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = []; let field = ''; let quoted = false; let afterQuote = false;
  const pushField = () => { row.push(field); field = ''; afterQuote = false; };
  const pushRow = () => {
    pushField();
    if (row.some(value => value.trim())) rows.push(row);
    row = [];
    if (rows.length > MAX_IMPORT_ITEMS + 1) throw new Error(`O arquivo excede o limite de ${MAX_IMPORT_ITEMS} cartões por importação.`);
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') { quoted = false; afterQuote = true; }
      else field += char;
    } else if (char === delimiter) pushField();
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[index + 1] === '\n') index += 1; pushRow(); }
    else if (char === '"' && !field && !afterQuote) quoted = true;
    else if (afterQuote && !/\s/.test(char)) throw new Error('CSV inválido: há texto depois do fechamento de aspas.');
    else if (!afterQuote) field += char;
    if (field.length > 2_000_000) throw new Error('Uma célula do CSV é grande demais.');
  }
  if (quoted) throw new Error('CSV inválido: uma célula contém aspas sem fechamento.');
  if (field || row.length || afterQuote) pushRow();
  return rows;
}

export function detectDelimiter(text: string): string {
  let quoted = false; const counts = new Map([[',', 0], [';', 0], ['\t', 0]]);
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') { if (quoted && text[index + 1] === '"') index += 1; else quoted = !quoted; }
    else if (!quoted && (char === '\n' || char === '\r')) break;
    else if (!quoted && counts.has(char)) counts.set(char, counts.get(char)! + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

const FRONT = new Set(['front', 'frente', 'question', 'pergunta', 'perguntas', 'q', 'prompt']);
const BACK = new Set(['back', 'verso', 'answer', 'resposta', 'respostas', 'a']);
const normalizeHeader = (value: string) => value.trim().toLocaleLowerCase('pt-BR');

export function delimitedCards(text: string, isTsv: boolean, selected?: ImportColumnMapping): {
  cards: ImportedFlashcard[]; columns: string[]; mapping: ImportColumnMapping; warnings: string[];
} {
  const rows = parseDelimited(text.replace(/^\uFEFF/, ''), isTsv ? '\t' : detectDelimiter(text));
  if (!rows.length) throw new Error('O arquivo não contém linhas para importar.');
  const width = Math.max(...rows.map(row => row.length));
  if (width < 2) throw new Error('O arquivo precisa de pelo menos duas colunas: frente e verso.');
  const first = rows[0].map(normalizeHeader);
  const front = first.findIndex(value => FRONT.has(value)); const back = first.findIndex(value => BACK.has(value));
  const hasHeader = front >= 0 && back >= 0;
  const mapping = selected ? { ...selected, hasHeader: selected.hasHeader ?? hasHeader } : { frontColumn: hasHeader ? front : 0, backColumn: hasHeader ? back : 1, hasHeader };
  if (!Number.isInteger(mapping.frontColumn) || !Number.isInteger(mapping.backColumn) || mapping.frontColumn < 0 || mapping.backColumn < 0 || mapping.frontColumn >= width || mapping.backColumn >= width || mapping.frontColumn === mapping.backColumn) throw new Error('Escolha duas colunas diferentes e válidas para a frente e o verso.');
  const columns = Array.from({ length: width }, (_, index) => mapping.hasHeader ? rows[0][index]?.trim() || `Coluna ${index + 1}` : `Coluna ${index + 1}`);
  const warnings: string[] = []; const cards: ImportedFlashcard[] = [];
  for (let index = mapping.hasHeader ? 1 : 0; index < rows.length; index += 1) {
    const row = rows[index]; const frontText = row[mapping.frontColumn]?.trim(); const backText = row[mapping.backColumn]?.trim();
    if (!frontText || !backText) throw new Error(`A linha ${index + 1} precisa conter frente e verso preenchidos.`);
    if (row.length !== width && warnings.length < 10) warnings.push(`A linha ${index + 1} tem quantidade diferente de colunas; as colunas escolhidas foram preservadas.`);
    cards.push({ front: frontText, back: backText });
  }
  return { cards, columns, mapping, warnings };
}
