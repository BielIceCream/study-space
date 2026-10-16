import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCheck, Coffee, Layers2, RotateCcw, Sparkles } from 'lucide-react';
import type { Flashcard, Rating, ReviewInput, ReviewLog, Subject, StorageService, CardMetadata } from '../../shared/types';
import { CardMedia } from './CardMedia';
import { EmptyState } from '../../shared/ui';
import { isTyping, messageFrom, plural } from '../../shared/utils';

const ratings: { value: Rating; label: string; hint: string; className: string }[] = [
  { value: 1, label: 'Errei', hint: 'Preciso retomar', className: 'again' },
  { value: 2, label: 'Difícil', hint: 'Quase lembrei', className: 'hard' },
  { value: 3, label: 'Bom', hint: 'Lembrei bem', className: 'good' },
  { value: 4, label: 'Fácil', hint: 'Na ponta da língua', className: 'easy' },
];

export function Review({ cards, subjects, initialSubjectId, onRecord, onCreate, onLibrary, storage, cardMetadata, onActiveCardChange, startToken }: {
  cards: Flashcard[]; subjects: Subject[]; initialSubjectId?: string;
  onRecord: (input: ReviewInput) => Promise<ReviewLog>; onCreate: () => void; onLibrary: () => void;
  storage?: StorageService; cardMetadata?: CardMetadata[]; onActiveCardChange?: (card: Flashcard | null) => void; startToken?: string;
}) {
  const [filter, setFilter] = useState(initialSubjectId ?? 'all');
  const [session, setSession] = useState<{ id: string; cards: Flashcard[] } | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Rating[]>([]);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const selectedCards = cards.filter(card => filter === 'all' || card.subjectId === filter);
  const current = session?.cards[index];
  const complete = Boolean(session && index >= session.cards.length);
  const start = () => {
    setSession({ id: crypto.randomUUID(), cards: [...selectedCards] });
    setIndex(0); setResults([]); setFlipped(false); setError(null);
  };
  useEffect(() => { onActiveCardChange?.(current ?? null); }, [current, onActiveCardChange]);
  useEffect(() => () => onActiveCardChange?.(null), [onActiveCardChange]);
  useEffect(() => {
    if (!startToken) return;
    setFilter(initialSubjectId ?? 'all');
    setSession({ id: crypto.randomUUID(), cards: cards.filter(card => !initialSubjectId || card.subjectId === initialSubjectId) });
    setIndex(0); setResults([]); setFlipped(false); setError(null);
  }, [startToken]);
  const record = useCallback(async (rating: Rating) => {
    if (!current || !session || !flipped || saving.current) return;
    saving.current = true; setBusy(true); setError(null);
    try {
      await onRecord({ flashcardId: current.id, sessionId: session.id, rating });
      setResults(previous => [...previous, rating]);
      setIndex(previous => previous + 1);
      setFlipped(false);
    } catch (cause) { setError(messageFrom(cause)); }
    finally { saving.current = false; setBusy(false); }
  }, [current, session, flipped, onRecord]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (!current || busy || isTyping(event.target) || document.querySelector('dialog[open]') || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Space') { event.preventDefault(); setFlipped(value => !value); }
      else if (/^[1-4]$/.test(event.key) && flipped) { event.preventDefault(); void record(Number(event.key) as Rating); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [current, busy, flipped, record]);

  if (complete && session) {
    const remembered = results.filter(value => value >= 3).length;
    return <div className="review-page page-enter"><div className="review-complete"><span className="complete-icon"><CheckCheck size={42} strokeWidth={1.4} /></span><div className="eyebrow">MAIS UM PASSO DADO</div><h1>Sua memória agradece.</h1><p>Você praticou {plural(results.length, 'cartão', 'cartões')} nesta sessão.<br />Cada tentativa ajuda a construir uma conexão.</p><div className="session-results"><div><strong>{results.length}</strong><span>cartões revisados</span></div><div><strong>{remembered}</strong><span>respostas lembradas</span></div></div><p className="session-saved"><Check size={15} />Seu histórico foi salvo neste dispositivo.</p><div className="complete-actions"><button className="button secondary" onClick={() => { setSession(null); setResults([]); }}><RotateCcw size={16} />Praticar de novo</button><button className="button primary" onClick={onLibrary}>Voltar à biblioteca<ArrowRight size={16} /></button></div></div></div>;
  }
  if (session && current) {
    const subject = subjects.find(item => item.id === current.subjectId)!;
    return <div className="review-page page-enter"><div className="review-session-heading"><button className="text-button muted" onClick={() => setSession(null)} disabled={busy}><ArrowLeft size={16} />Encerrar sessão</button><span>{index + 1} de {session.cards.length} cartões</span><span className="review-mode"><Layers2 size={14} />Prática livre</span></div><div className="review-progress" role="progressbar" aria-label="Progresso da sessão" aria-valuenow={index} aria-valuemin={0} aria-valuemax={session.cards.length}><span style={{ width: `${index / session.cards.length * 100}%` }} /></div>
      <div className="review-card-area"><span className={`subject-pill accent-${subject.accent}`}><span className="color-dot" />{subject.name}</span><div className="review-card-scene" key={current.id}><button className={`review-card ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped(value => !value)} disabled={busy} aria-label={flipped ? 'Virar cartão para ver a pergunta' : 'Virar cartão para ver a resposta'}><div className="review-face front" aria-hidden={flipped}><span className="face-label">PUXE PELA MEMÓRIA</span><p>{current.front}</p><CardMedia storage={storage} metadata={cardMetadata?.find(item => item.flashcardId === current.id)} side="front" /><span className="flip-hint"><RotateCcw size={14} />Pense na resposta antes de revelar</span></div><div className="review-face back" aria-hidden={!flipped}><span className="face-label">CONECTE AS IDEIAS</span><p>{current.back}</p><CardMedia storage={storage} metadata={cardMetadata?.find(item => item.flashcardId === current.id)} side="back" /><span className="flip-hint"><Check size={14} />Como foi lembrar desta resposta?</span></div></button></div>
        <div className="review-response" aria-live="polite">{!flipped ? <><button className="button primary reveal-button" onClick={() => setFlipped(true)}>Revelar resposta<ArrowRight size={17} /></button><span className="keyboard-hint">ou pressione <kbd>espaço</kbd></span></> : <><p className="rating-prompt">Como foi lembrar?</p><div className="rating-buttons">{ratings.map(rating => <button className={`rating-button ${rating.className}`} key={rating.value} onClick={() => void record(rating.value)} disabled={busy}><span><strong>{rating.label}</strong><kbd>{rating.value}</kbd></span><small>{rating.hint}</small></button>)}</div><span className="keyboard-hint">{busy ? 'Salvando sua avaliação…' : 'Use as teclas 1–4 para avaliar.'}</span></>}{error && <p className="form-error" role="alert">{error} Sua avaliação ainda não foi registrada. Tente novamente.</p>}</div>
      </div></div>;
  }
  return <div className="review-page page-enter"><div className="page-heading"><div><div className="eyebrow">DÊ UM POUCO DE ATENÇÃO À SUA MEMÓRIA</div><h1>Hora de conectar ideias<span className="heading-dot">.</span></h1><p>Uma pergunta de cada vez. Sem pressa, sem distrações.</p></div></div>
    {cards.length ? <div className="review-start"><span className="review-start-icon"><Layers2 size={39} strokeWidth={1.3} /></span><h2>O que vamos lembrar hoje?</h2><p>Pratique seus cartões e registre como foi lembrar.<br />Você escolhe a matéria e o ritmo.</p><label className="field-label" htmlFor="review-filter">Escolha sua matéria</label><select className="input" id="review-filter" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Todas as matérias</option>{subjects.map(subject => <option value={subject.id} key={subject.id}>{subject.name}</option>)}</select><div className="review-start-meta"><BookOpen size={16} />{plural(selectedCards.length, 'cartão', 'cartões')} nesta sessão</div><button className="button primary" disabled={!selectedCards.length} onClick={start}>Começar revisão<ArrowRight size={17} /></button><span className="practice-note"><Coffee size={14} />Prática livre · sem agendamento automático</span></div> : <EmptyState icon={Sparkles} title="Sua próxima conexão começa aqui" description="Crie alguns flashcards para começar uma sessão de revisão. O histórico de cada avaliação fica salvo." action="Criar meu primeiro cartão" onAction={onCreate} />}
  </div>;
}
