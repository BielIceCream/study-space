import { useState, type FormEvent } from 'react';
import { ArrowRight, BookOpen } from 'lucide-react';
import { ACCENTS, type Accent, type Subject, type SubjectInput } from '../../shared/types';
import { accentLabels, messageFrom } from '../../shared/utils';
import { ErrorMessage, Modal } from '../../shared/ui';

export function SubjectModal({ subject, onClose, onSubmit }: {
  subject?: Subject; onClose: () => void; onSubmit: (input: SubjectInput) => Promise<void>;
}) {
  const [name, setName] = useState(subject?.name ?? '');
  const [accent, setAccent] = useState<Accent>(subject?.accent ?? 'lavender');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try { await onSubmit({ name: name.trim(), accent }); }
    catch (cause) { setError(messageFrom(cause)); setBusy(false); }
  };
  return <Modal title={subject ? 'Editar matéria' : 'Um novo começo'} description={subject ? 'Dê um nome e uma cor a este espaço.' : 'Crie uma matéria para reunir suas notas e flashcards.'} onClose={onClose} busy={busy}>
    <div className={`subject-preview accent-${accent}`}><BookOpen size={26} strokeWidth={1.5} /><span>{name.trim() || 'Sua próxima matéria'}</span></div>
    <form onSubmit={event => void submit(event)}>
      <label className="field-label" htmlFor="subject-name">Nome da matéria</label>
      <input id="subject-name" className="input" placeholder="Ex.: Biologia, Inglês, Cálculo…" value={name} onChange={event => setName(event.target.value)} required maxLength={80} autoFocus disabled={busy} />
      <fieldset className="color-field"><legend className="field-label">Uma cor para organizar</legend><div className="color-options">{ACCENTS.map(color => <label className={`color-option accent-${color} ${accent === color ? 'selected' : ''}`} key={color} title={accentLabels[color]}><input type="radio" name="accent" value={color} checked={accent === color} onChange={() => setAccent(color)} aria-label={accentLabels[color]} disabled={busy} /><span /></label>)}</div></fieldset>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="modal-actions"><button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="button primary" type="submit" disabled={busy || !name.trim()}>{busy ? 'Salvando…' : subject ? 'Salvar matéria' : 'Criar matéria'}<ArrowRight size={16} /></button></div>
    </form>
  </Modal>;
}
