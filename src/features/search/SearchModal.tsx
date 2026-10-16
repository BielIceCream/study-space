import { useState } from 'react';
import { ArrowUpRight, BookOpen, FileText, Layers2, Search } from 'lucide-react';
import type { Flashcard, Note, Snapshot, Subject } from '../../shared/types';
import { Modal } from '../../shared/ui';

export function SearchModal({ data, onClose, onSubject, onNote, onCard }: {
  data: Snapshot; onClose: () => void; onSubject: (subject: Subject) => void; onNote: (note: Note) => void; onCard: (card: Flashcard) => void;
}) {
  const [query, setQuery] = useState('');
  const term = query.trim().toLocaleLowerCase('pt-BR');
  const matches = (text: string) => term.length > 0 && text.toLocaleLowerCase('pt-BR').includes(term);
  const results = [
    ...data.subjects.filter(subject => matches(subject.name)).map(subject => ({ id: subject.id, title: subject.name, context: 'Matéria', icon: BookOpen, action: () => onSubject(subject) })),
    ...data.notes.filter(note => matches(`${note.title} ${note.plainText}`)).map(note => ({ id: note.id, title: note.title, context: data.subjects.find(subject => subject.id === note.subjectId)?.name ?? 'Nota', icon: FileText, action: () => onNote(note) })),
    ...data.flashcards.filter(card => matches(`${card.front} ${card.back}`)).map(card => ({ id: card.id, title: card.front, context: 'Flashcard', icon: Layers2, action: () => onCard(card) })),
  ].slice(0, 30);
  return <Modal title="Buscar no seu espaço" onClose={onClose} className="search-modal"><div className="search-field global-search-input"><Search size={19} /><input aria-label="Busca global" value={query} onChange={event => setQuery(event.target.value)} placeholder="Matérias, notas, perguntas…" autoFocus /></div><div className="search-results">{results.map(result => <button className="search-result" key={result.id} onClick={result.action}><result.icon size={18} /><span><strong>{result.title}</strong><small>{result.context}</small></span><ArrowUpRight size={16} /></button>)}{!results.length && <div className="search-empty"><Search size={25} strokeWidth={1.5} /><p>{term ? 'Nenhum resultado. Tente outras palavras.' : 'O seu conhecimento, a poucas letras de distância.'}</p><small>A busca funciona inteiramente neste dispositivo.</small></div>}</div></Modal>;
}
