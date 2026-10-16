import { useState, type FormEvent } from 'react';
import { ArrowRight, FileText, Layers2 } from 'lucide-react';
import type { Flashcard, FlashcardInput, Note, Subject, UpdateFlashcardInput } from '../../shared/types';
import { ErrorMessage, Modal } from '../../shared/ui';
import { messageFrom } from '../../shared/utils';

export function CardModal({ subjects, initialSubjectId, note, selected = '', card, onClose, onCreate, onUpdate }: {
  subjects: Subject[]; initialSubjectId?: string; note?: Note; selected?: string; card?: Flashcard;
  onClose: () => void; onCreate: (input: FlashcardInput) => Promise<void>; onUpdate: (input: UpdateFlashcardInput) => Promise<void>;
}) {
  const [subjectId, setSubjectId] = useState(card?.subjectId ?? note?.subjectId ?? initialSubjectId ?? subjects[0]?.id ?? '');
  const [front, setFront] = useState(card?.front ?? '');
  const [back, setBack] = useState(card?.back ?? selected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      if (card) await onUpdate({ id: card.id, front: front.trim(), back: back.trim() });
      else await onCreate({ subjectId, noteId: note?.id ?? null, front: front.trim(), back: back.trim() });
    } catch (cause) { setError(messageFrom(cause)); setBusy(false); }
  };
  return <Modal title={card ? 'Editar flashcard' : 'Uma pergunta, uma descoberta'} description="Escreva uma pergunta clara. A resposta fica do outro lado." onClose={onClose} busy={busy} className="card-modal">
    <form onSubmit={event => void submit(event)}>
      <label className="field-label" htmlFor="card-subject">Matéria</label><select className="input" id="card-subject" value={subjectId} onChange={event => setSubjectId(event.target.value)} disabled={Boolean(card || note || busy)}>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select>
      {note && <div className="source-badge"><FileText size={14} />Vinculado à nota: {note.title}</div>}
      <div className="card-form-face"><label className="field-label" htmlFor="card-front"><Layers2 size={15} />FRENTE · PERGUNTA</label><textarea className="input" id="card-front" placeholder="O que você quer lembrar?" value={front} onChange={event => setFront(event.target.value)} required maxLength={5000} rows={3} autoFocus disabled={busy} /></div>
      <div className="card-form-face back"><label className="field-label" htmlFor="card-back">VERSO · RESPOSTA</label><textarea className="input" id="card-back" placeholder="Uma resposta com suas próprias palavras…" value={back} onChange={event => setBack(event.target.value)} required maxLength={10000} rows={4} disabled={busy} /></div>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="modal-actions"><button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="button primary" type="submit" disabled={busy || !front.trim() || !back.trim()}>{busy ? 'Salvando…' : card ? 'Salvar cartão' : 'Criar flashcard'}<ArrowRight size={16} /></button></div>
    </form>
  </Modal>;
}
