import type { RichDocument, Snapshot } from '../../shared/types';

export type ImportFormat = 'csv' | 'tsv' | 'json' | 'apkg' | 'pdf' | 'docx' | 'txt' | 'md';
export interface ImportedNote { title: string; bodyJson: RichDocument; plainText: string }
export interface ImportedImage { assetHash: string; side: 'front' | 'back'; alt?: string }
export interface ImportedFlashcard { front: string; back: string; noteIndex?: number; tags?: string[]; images?: ImportedImage[] }
export interface ImportedDocument {
  noteIndex: number;
  fileName: string;
  kind: 'pdf' | 'docx' | 'txt' | 'md' | 'json' | 'csv';
  mimeType: string;
  sha256: string;
  dataBase64: string;
  pages: { page: number; text: string }[];
}
export interface ImportedAsset { sha256: string; fileName: string; mimeType: string; dataBase64: string }
export interface ImportBatchInput {
  subjectId: string;
  sourceName: string;
  format: ImportFormat;
  notes: ImportedNote[];
  flashcards: ImportedFlashcard[];
  documents: ImportedDocument[];
  assets: ImportedAsset[];
  warnings: string[];
}
export interface ImportResult { noteIds: string[]; flashcardIds: string[]; documentIds: string[]; skippedDuplicates: number }
export interface ImportColumnMapping { frontColumn: number; backColumn: number; hasHeader?: boolean }
export interface ImportProgress { stage: 'reading' | 'parsing' | 'extracting' | 'validating'; completed: number; total: number }
export interface ImportOptions {
  subjectId?: string;
  snapshot?: Pick<Snapshot, 'flashcards'>;
  columnMapping?: ImportColumnMapping;
  onProgress?: (progress: ImportProgress) => void;
  signal?: AbortSignal;
}
export interface ImportPreview {
  batch: ImportBatchInput;
  format: ImportFormat;
  fileName: string;
  counts: { notes: number; flashcards: number; documents: number; assets: number };
  columns: string[];
  suggestedMapping: ImportColumnMapping | null;
  duplicates: number;
}
export const MAX_IMPORT_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_IMPORT_ITEMS = 5_000;
export const MAX_IMPORT_BACKUP_BYTES = 50 * 1024 * 1024;
