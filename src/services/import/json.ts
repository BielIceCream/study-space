import { htmlToPlainText, textDocument } from './text';
import type { ImportedFlashcard, ImportedNote } from './types';
import { MAX_IMPORT_ITEMS } from './types';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('O JSON precisa conter objetos de notas ou cartões.');
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`O campo ${label} precisa conter texto.`);
  return value.trim();
}

/** Accepted JSON: cards array, {flashcards:[...]}, or {format:'studyspace-import',version:1,notes:[{title,text}],flashcards:[{front,back,tags?,noteIndex?}]}. */
export function jsonContent(text: string): { notes: ImportedNote[]; cards: ImportedFlashcard[] } {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('O arquivo JSON está incompleto ou inválido.'); }
  const container = Array.isArray(parsed) ? { flashcards: parsed } : record(parsed);
  if (container.format !== undefined && (container.format !== 'studyspace-import' || container.version !== 1)) throw new Error('Formato JSON desconhecido. Use studyspace-import versão 1 ou uma lista de cartões.');
  const sourceCards = container.flashcards ?? container.cards ?? [];
  const sourceNotes = container.notes ?? [];
  if (!Array.isArray(sourceCards) || !Array.isArray(sourceNotes)) throw new Error('As propriedades flashcards e notes precisam ser listas.');
  if (sourceCards.length + sourceNotes.length > MAX_IMPORT_ITEMS) throw new Error(`O JSON excede o limite de ${MAX_IMPORT_ITEMS} itens.`);
  const notes = sourceNotes.map(value => {
    const data = record(value); const title = string(data.title, 'title');
    const plainText = string(data.text ?? data.plainText, 'text');
    return { title, plainText, bodyJson: textDocument(plainText) };
  });
  const plainTextFormat = container.format === 'studyspace-import';
  const cards = sourceCards.map(value => {
    const data = record(value);
    const frontValue = string(data.front ?? data.question ?? data.frente ?? data.pergunta, 'front');
    const backValue = string(data.back ?? data.answer ?? data.verso ?? data.resposta, 'back');
    const front = plainTextFormat ? frontValue : htmlToPlainText(frontValue);
    const back = plainTextFormat ? backValue : htmlToPlainText(backValue);
    const card: ImportedFlashcard = { front, back };
    if (data.noteIndex !== undefined) {
      if (typeof data.noteIndex !== 'number' || !Number.isInteger(data.noteIndex) || data.noteIndex < 0 || data.noteIndex >= notes.length) throw new Error('O noteIndex de um cartão precisa apontar para uma nota deste JSON.');
      card.noteIndex = data.noteIndex;
    }
    if (data.tags !== undefined) {
      if (!Array.isArray(data.tags) || data.tags.some(tag => typeof tag !== 'string')) throw new Error('As tags de um cartão precisam ser uma lista de textos.');
      card.tags = [...new Set((data.tags as string[]).map(tag => tag.trim()).filter(Boolean))];
    }
    return card;
  });
  return { notes, cards };
}
