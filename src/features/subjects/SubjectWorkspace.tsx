import { lazy, Suspense } from 'react';
import { FilePlus2, FileText, Layers2, Pencil, Plus } from 'lucide-react';
import type { Flashcard, Note, SaveNoteInput, Subject, DocumentMetadata, StorageService, CardMetadata } from '../../shared/types';
import { EmptyState } from '../../shared/ui';
import { shortDate } from '../../shared/utils';
import '../documents/documents.css';
import { CardLibrary } from '../flashcards/CardLibrary';

const NoteEditor = lazy(() => import('../notes/NoteEditor').then(module => ({ default: module.NoteEditor })));

export function SubjectWorkspace({ subject, notes, cards, noteId, tab, onSelectNote, onTab, onNewNote, onEditSubject, onSaveNote, onCreateCard, onEditCard, onReview, registerFlush, documents, storage, cardMetadata, onOpenDocument }: {
  subject: Subject; notes: Note[]; cards: Flashcard[]; noteId?: string; tab: 'notes' | 'cards';
  onSelectNote: (note: Note) => void; onTab: (tab: 'notes' | 'cards') => void; onNewNote: () => void; onEditSubject: () => void;
  onSaveNote: (input: SaveNoteInput) => Promise<Note>; onCreateCard: (note?: Note, selected?: string) => void;
  onEditCard: (card: Flashcard) => void; onReview: () => void;
  documents?: DocumentMetadata[]; storage?: StorageService; cardMetadata?: CardMetadata[]; onOpenDocument?: (document: DocumentMetadata) => void;
  registerFlush: (flush: () => Promise<void>, isDirty: () => boolean) => () => void;
}) {
  const note = notes.find(item => item.id === noteId) ?? notes[0];
  const sourceDocuments = documents?.filter(item => item.noteId === note?.id) ?? [];
  const editor = note && <Suspense fallback={<div className="note-editor" role="status">Abrindo sua nota...</div>}><NoteEditor key={note.id} note={note} subject={subject} onSave={onSaveNote} onCreateCard={onCreateCard} registerFlush={registerFlush} /></Suspense>;
  return <div className="subject-workspace page-enter"><div className="subject-heading"><div className={`subject-heading-icon accent-${subject.accent}`}><FileText size={28} strokeWidth={1.5} /></div><div><div className="eyebrow">SUA MATÉRIA</div><h1>{subject.name}</h1></div><button className="icon-button" aria-label="Editar matéria" title="Editar matéria" onClick={onEditSubject}><Pencil size={17} /></button><button className="button primary" onClick={tab === 'notes' ? onNewNote : () => onCreateCard()}><Plus size={16} />{tab === 'notes' ? 'Nova nota' : 'Novo flashcard'}</button></div>
    <div className="workspace-tabs" role="tablist" aria-label="Conteúdo da matéria"><button role="tab" aria-selected={tab === 'notes'} aria-controls="notes-panel" id="notes-tab" onClick={() => onTab('notes')}><FileText size={16} />Notas<span>{notes.length}</span></button><button role="tab" aria-selected={tab === 'cards'} aria-controls="cards-panel" id="cards-tab" onClick={() => onTab('cards')}><Layers2 size={16} />Flashcards<span>{cards.length}</span></button></div>
    {tab === 'notes' ? <div className="notes-panel" role="tabpanel" aria-labelledby="notes-tab" id="notes-panel">{notes.length ? <><aside className="note-list"><div className="note-list-heading"><span>PÁGINAS</span><button className="icon-button" aria-label="Adicionar nota" onClick={onNewNote}><Plus size={16} /></button></div>{notes.map(item => <button className={`note-list-item ${item.id === note?.id ? 'active' : ''}`} key={item.id} onClick={() => onSelectNote(item)}><FileText size={16} /><span><strong>{item.title}</strong><small>{shortDate(item.updatedAt)}</small></span></button>)}</aside>{sourceDocuments.length ? <div className="document-note-wrapper">{sourceDocuments.map(item => <div className="document-source" key={item.id}><button className="text-button" disabled={!onOpenDocument} onClick={() => onOpenDocument?.(item)}><FileText size={14} />Abrir documento original: {item.fileName}</button></div>)}{editor}</div> : editor}</> : <EmptyState icon={FilePlus2} title="Um espaço em branco, muitas possibilidades" description="Abra sua primeira nota. Organize uma ideia, resuma um conceito ou guarde aquela pergunta." action="Criar minha primeira nota" onAction={onNewNote} />}</div>
      : <div role="tabpanel" aria-labelledby="cards-tab" id="cards-panel"><CardLibrary cards={cards} subjects={[subject]} notes={notes} onCreate={() => onCreateCard()} onEdit={onEditCard} onOpenNote={onSelectNote} onReview={onReview} storage={storage} cardMetadata={cardMetadata} compact /></div>}
  </div>;
}
