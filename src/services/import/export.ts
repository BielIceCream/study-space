import type { CardMetadata, Flashcard } from '../../shared/types';
import { MAX_IMPORT_FILE_BYTES, MAX_IMPORT_ITEMS } from './types';

export interface FlashcardExport {
  format: 'studyspace-import';
  version: 1;
  flashcards: { front: string; back: string; tags: string[] }[];
}

export const FLASHCARD_EXPORT_WARNING = 'O JSON exporta o texto e as tags dos cartões. Para preservar imagens, fontes e histórico, use o backup completo.';

/** Standalone, interoperable JSON. Original note links and binary media belong to full backups. */
export function createFlashcardExport(cards: Flashcard[], metadata: CardMetadata[]): FlashcardExport {
  if (cards.length > MAX_IMPORT_ITEMS) throw new Error(`Cada exportação JSON aceita até ${MAX_IMPORT_ITEMS} cartões. Filtre a biblioteca para exportar em partes.`);
  const byCard = new Map(metadata.map(value => [value.flashcardId, value]));
  const flashcards = cards.map(card => {
    if (!card.front.trim() || !card.back.trim() || card.front.length > 20_000 || card.back.length > 20_000 || /\u0000/.test(card.front + card.back)) throw new Error('Um cartão contém texto inválido para exportação.');
    const tags = [...new Set((byCard.get(card.id)?.tags ?? []).map(tag => tag.trim()).filter(Boolean))];
    if (tags.length > 64 || tags.some(tag => tag.length > 120 || /\u0000/.test(tag))) throw new Error('Um cartão contém tags inválidas para exportação.');
    return { front: card.front, back: card.back, tags };
  });
  const result: FlashcardExport = { format: 'studyspace-import', version: 1, flashcards };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_IMPORT_FILE_BYTES) throw new Error('O JSON excede 32 MiB. Filtre os cartões para exportar em partes menores.');
  return result;
}
