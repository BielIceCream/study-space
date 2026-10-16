import { useMemo, useState } from 'react';
import { ArrowRight, FileText, Layers2, Pencil, Plus, Search } from 'lucide-react';
import type { Flashcard, Note, Subject, StorageService, CardMetadata } from '../../shared/types';
import { CardMedia } from './CardMedia';
import { EmptyState } from '../../shared/ui';
import { Modal } from '../../shared/ui';
import { createFlashcardExport, FLASHCARD_EXPORT_WARNING } from '../../services/import/export';
import { plural } from '../../shared/utils';

export function CardLibrary({ cards, subjects, notes, onCreate, onEdit, onOpenNote, onReview, compact = false, storage, cardMetadata }: {
  cards: Flashcard[]; subjects: Subject[]; notes: Note[]; onCreate: () => void; onEdit: (card: Flashcard) => void;
  onOpenNote: (note: Note) => void; onReview: () => void; compact?: boolean; storage?: StorageService; cardMetadata?: CardMetadata[];
}) {
  const [query, setQuery] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [exportOpen,setExportOpen] = useState(false);
  const [exportError,setExportError] = useState('');
  const metadataByCard=useMemo(()=>new Map((cardMetadata??[]).map(m=>[m.flashcardId,m])),[cardMetadata]);
  const filtered = cards.filter(card => (subjectFilter === 'all' || card.subjectId === subjectFilter) && `${card.front} ${card.back}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
  function exportCards(){
    try{
      const data=createFlashcardExport(filtered,cardMetadata??[]);
      const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download='StudySpace-flashcards.json';link.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),1000);setExportOpen(false);
    }catch(cause){setExportError(cause instanceof Error?cause.message:'Não foi possível exportar.');}
  }
  return <div className={`cards-page page-enter ${compact ? 'compact' : ''}`}>
    {!compact && <div className="page-heading"><div><div className="eyebrow">PEQUENAS PERGUNTAS, GRANDES CONEXÕES</div><h1>Seus flashcards<span className="heading-dot">.</span></h1><p>Transforme conhecimento em algo que fica com você.</p></div><button className="button primary" onClick={onCreate}><Plus size={17} />Novo flashcard</button></div>}
    {cards.length > 0 ? <><div className="cards-controls"><div className="search-field"><Search size={17} /><input aria-label="Buscar flashcards" placeholder="Buscar uma pergunta ou resposta…" value={query} onChange={event => setQuery(event.target.value)} /></div>{!compact && <select className="input filter-select" aria-label="Filtrar por matéria" value={subjectFilter} onChange={event => setSubjectFilter(event.target.value)}><option value="all">Todas as matérias</option>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select>}<button className="button secondary" onClick={onReview}><Layers2 size={16} />Praticar<ArrowRight size={15} /></button></div>
      <div className="results-label">{plural(filtered.length, 'cartão', 'cartões')}<button className="text-button" disabled={!filtered.length} onClick={()=>{setExportError('');setExportOpen(true);}}>Exportar JSON</button>{compact && <button className="text-button" onClick={onCreate}><Plus size={15} />Novo cartão</button>}</div>
      {filtered.length ? <div className="flashcard-grid">{filtered.map(card => {
        const subject = subjects.find(item => item.id === card.subjectId)!;
        const source = notes.find(note => note.id === card.noteId);
        const open = revealed.has(card.id);
        return <article className={`flashcard-preview accent-${subject.accent}`} key={card.id}><div className="flashcard-meta"><span className="subject-pill"><span className="color-dot" />{subject.name}</span><button className="icon-button" aria-label={`Editar cartão: ${card.front}`} onClick={() => onEdit(card)}><Pencil size={15} /></button></div><span className="face-label">PERGUNTA</span><h3>{card.front}</h3><CardMedia storage={storage} metadata={metadataByCard.get(card.id)} side="front" /><button className="reveal-inline" aria-expanded={open} onClick={() => setRevealed(current => { const next = new Set(current); if (next.has(card.id)) next.delete(card.id); else next.add(card.id); return next; })}>{open ? 'Ocultar resposta' : 'Revelar resposta'}<ArrowRight size={14} /></button>{open && <><p className="inline-answer">{card.back}</p><CardMedia storage={storage} metadata={metadataByCard.get(card.id)} side="back" /></>}{source && <button className="card-source" onClick={() => onOpenNote(source)}><FileText size={13} />{source.title}</button>}</article>;
      })}</div> : <EmptyState icon={Search} title="Nenhum cartão por aqui" description="Tente outra busca ou escolha uma matéria diferente." />}</>
      : <EmptyState icon={Layers2} title="Uma ideia que merece ser lembrada" description="Crie seu primeiro flashcard. Uma boa pergunta torna o aprendizado mais duradouro." action="Criar meu primeiro cartão" onAction={onCreate} />}
    {exportOpen&&<Modal title="Exportar cartões JSON" description={FLASHCARD_EXPORT_WARNING} onClose={()=>setExportOpen(false)}><p>{plural(filtered.length,'cartão','cartões')} no filtro atual.</p>{exportError&&<p className="form-error" role="alert">{exportError}</p>}<div className="modal-actions"><button className="button secondary" onClick={()=>setExportOpen(false)}>Cancelar</button><button className="button primary" onClick={exportCards}>Baixar JSON</button></div></Modal>}
  </div>;
}
