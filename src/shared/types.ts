import type { ImportBatchInput, ImportResult, ImportedAsset, ImportedImage } from '../services/import/types';

export type Accent = 'lavender' | 'blue' | 'green' | 'peach' | 'rose';
export type Theme = 'light' | 'dark';
export type Rating = 1 | 2 | 3 | 4;

export interface RichDocument {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichDocument[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export interface Subject {
  id: string;
  name: string;
  accent: Accent;
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  subjectId: string;
  title: string;
  bodyJson: RichDocument;
  plainText: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface Flashcard {
  id: string;
  subjectId: string;
  noteId: string | null;
  front: string;
  back: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewLog {
  id: string;
  flashcardId: string;
  sessionId: string;
  rating: Rating;
  reviewedAt: string;
}

export interface Settings {
  theme: Theme;
}

export interface Snapshot {
  subjects: Subject[];
  notes: Note[];
  flashcards: Flashcard[];
  reviewLogs: ReviewLog[];
  settings: Settings;
  documents?: DocumentMetadata[];
  cardMetadata?: CardMetadata[];
}

export interface DocumentMetadata {
  id: string; subjectId: string; noteId: string; fileName: string; kind: string;
  mimeType: string; sha256: string; pageCount: number; createdAt: string;
}
export interface StoredDocument extends DocumentMetadata { dataBase64: string; pages: { page: number; text: string }[] }
export interface CardMetadata { flashcardId: string; tags: string[]; images: ImportedImage[] }
export interface BackupMaterials {
  documents: { documentId: string; dataBase64: string; pages: { page: number; text: string }[] }[];
  assets: ImportedAsset[];
}

export interface BackupDocument {
  format: 'studyspace-backup';
  version: 1 | 2;
  exportedAt: string;
  data: Snapshot;
  materials?: BackupMaterials;
}

export interface SubjectInput { name: string; accent: Accent }
export interface NoteInput { subjectId: string; title: string }
export interface SaveNoteInput {
  id: string;
  title: string;
  bodyJson: RichDocument;
  plainText: string;
  expectedRevision: number;
}
export interface FlashcardInput {
  subjectId: string;
  noteId: string | null;
  front: string;
  back: string;
}
export interface UpdateFlashcardInput { id: string; front: string; back: string }
export interface ReviewInput { flashcardId: string; sessionId: string; rating: Rating }

export interface StorageService {
  getSnapshot(): Promise<Snapshot>;
  createSubject(input: SubjectInput): Promise<Subject>;
  updateSubject(id: string, input: SubjectInput): Promise<Subject>;
  createNote(input: NoteInput): Promise<Note>;
  saveNote(input: SaveNoteInput): Promise<Note>;
  createFlashcard(input: FlashcardInput): Promise<Flashcard>;
  updateFlashcard(input: UpdateFlashcardInput): Promise<Flashcard>;
  recordReview(input: ReviewInput): Promise<ReviewLog>;
  setTheme(theme: Theme): Promise<void>;
  importBatch(input: ImportBatchInput): Promise<ImportResult>;
  getDocument(id: string): Promise<StoredDocument>;
  getAsset(sha256: string): Promise<ImportedAsset>;
  exportBackup(): Promise<BackupDocument>;
  restoreBackup(backup: unknown): Promise<void>;
  close(): Promise<void>;
}

export const EMPTY_DOCUMENT: RichDocument = { type: 'doc', content: [{ type: 'paragraph' }] };
export const ACCENTS: Accent[] = ['lavender', 'blue', 'green', 'peach', 'rose'];
