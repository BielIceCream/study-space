import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCheck, Clock3, Coffee, Layers2, RotateCcw, Sparkles } from 'lucide-react';
import type { Flashcard, Rating, ReviewInput, ReviewLog, Subject, StorageService, CardMetadata, Snapshot } from '../../shared/types';
import type { ReviewSchedule } from '../../domain/spaced-repetition/types';
import type { ErrorDraft } from '../../domain/error-notebook/types';
import { buildReviewQueue, reviewClock, type ReviewMode } from '../../domain/spaced-repetition/queue';
import { SavedReviewNeedsReloadError } from '../../services/review-recording';
import { CardMedia } from './CardMedia';
import { EmptyState } from '../../shared/ui';
import { isTyping, messageFrom, plural } from '../../shared/utils';
import './review.css';

export interface ReviewPlannerContext { trackId: string; title: string; minutes: number; unbound?: boolean }
const LIMIT_KEY = 'studyspace.review.newCardLimit.v1';
const validLimit = (value: string) => /^\d{1,2}$/.test(value) && Number(value) <= 50;
function readLimit(): string {
  try { const value = localStorage.getItem(LIMIT_KEY); return value !== null && validLimit(value) ? value : '10'; }
  catch { return '10'; }
}
const formatDue = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const ratings: { value: Rating; label: string; hint: string; className: string }[] = [
  { value: 1, label: 'Errei', hint: 'Preciso retomar', className: 'again' },
  { value: 2, label: 'Difícil', hint: 'Quase lembrei', className: 'hard' },
  { value: 3, label: 'Bom', hint: 'Lembrei bem', className: 'good' },
  { value: 4, label: 'Fácil', hint: 'Na ponta da língua', className: 'easy' },
];

export function Review({ cards, subjects, reviewSchedules = [], initialSubjectId, initialCardId, initialMode = 'free', plannerContext, onPlanner, onNotebook, onProgress, onErrorDraft, onRecord, onReload, reviewNeedsReload, onCreate, onLibrary, storage, cardMetadata, onActiveCardChange, startToken }: {
  cards: Flashcard[]; subjects: Subject[]; reviewSchedules?: ReviewSchedule[]; initialSubjectId?: string; initialMode?: ReviewMode;
  plannerContext?: ReviewPlannerContext; onPlanner?: () => void;
  initialCardId?: string; onNotebook?:()=>void;onProgress?:()=>void;onErrorDraft?:(draft:ErrorDraft)=>void;
  onRecord: (input: ReviewInput) => Promise<ReviewLog>; onReload: () => Promise<Snapshot>; reviewNeedsReload?: boolean;
  onCreate: () => void; onLibrary: () => void;
  storage?: StorageService; cardMetadata?: CardMetadata[]; onActiveCardChange?: (card: Flashcard | null) => void; startToken?: string;
}) {
  const [filter, setFilter] = useState(initialSubjectId ?? 'all');
  const [mode, setMode] = useState<ReviewMode>(initialMode);
  const [newLimit, setNewLimit] = useState(readLimit);
  const [preferenceError, setPreferenceError] = useState(false);
  const [clock, setClock] = useState(reviewClock);
  const [session, setSession] = useState<{ id: string; cards: Flashcard[]; mode: ReviewMode; startedAt: number } | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Rating[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savedPending, setSavedPending] = useState<ReviewLog | null>(null);
  const [lastSaved, setLastSaved] = useState<ReviewLog | null>(null);
  const saving = useRef(false);
  const revealRef = useRef<HTMLButtonElement>(null);
  const firstRatingRef = useRef<HTMLButtonElement>(null);
  const completeRef = useRef<HTMLHeadingElement>(null);
  const reloadRef = useRef<HTMLButtonElement>(null);
  const availableCards = useMemo(()=>initialCardId ? cards.filter(card=>card.id===initialCardId) : cards,[cards,initialCardId]);
  const selectedCards = availableCards.filter(card => filter === 'all' || card.subjectId === filter);
  const scheduleByCard = useMemo(() => new Map(reviewSchedules.map(state => [state.flashcardId, state])), [reviewSchedules]);
  const queue = useMemo(() => buildReviewQueue(mode === 'spaced' && !session ? availableCards : [], mode === 'spaced' && !session ? reviewSchedules : [], clock, { subjectId: filter === 'all' ? undefined : filter, newCardLimit: validLimit(newLimit) ? Number(newLimit) : 0 }), [availableCards, reviewSchedules, clock, filter, newLimit, mode, session]);
  const current = session?.cards[index];
  const complete = Boolean(session && index >= session.cards.length);
  const savedSchedule = lastSaved ? scheduleByCard.get(lastSaved.flashcardId) : undefined;
  const reset = () => { setSession(null); setIndex(0); setResults([]); setFlipped(false); setError(null); setLastSaved(null); setSavedPending(null); setClock(reviewClock()); };
  const start = async () => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(null);
    try {
      const fresh = mode === 'spaced' ? await onReload() : undefined;
      const now = reviewClock();
      const selected = fresh ? buildReviewQueue(initialCardId ? fresh.flashcards.filter(card=>card.id===initialCardId) : fresh.flashcards, fresh.reviewSchedules ?? [], now, { subjectId: filter === 'all' ? undefined : filter, newCardLimit: Number(newLimit) }).cards : selectedCards;
      setClock(now);
      if (!selected.length) { setError('Nenhum cartão disponível neste momento. Confira o filtro e o próximo vencimento.'); return; }
      setSession({ id: crypto.randomUUID(), cards: [...selected], mode, startedAt: Date.now() });
      setIndex(0); setResults([]); setFlipped(false); setLastSaved(null); setSavedPending(null);
    } catch (cause) { setError(messageFrom(cause)); }
    finally { saving.current = false; setBusy(false); }
  };
  const acceptLog = (log: ReviewLog) => {
    setResults(previous => [...previous, log.rating]); setIndex(previous => previous + 1);
    setFlipped(false); setLastSaved(log); setSavedPending(null); setError(null); setClock(reviewClock());
  };
  const refresh = async () => {
    if (saving.current) return;
    saving.current = true; setBusy(true);
    try { await onReload(); if (savedPending) acceptLog(savedPending); else reset(); }
    catch (cause) { setError(savedPending ? 'Sua resposta está salva. Ainda não foi possível recarregar a agenda. Tente novamente.' : messageFrom(cause)); }
    finally { saving.current = false; setBusy(false); }
  };
  useEffect(() => {
    const update = () => setClock(reviewClock());
    const interval = window.setInterval(update, 15_000);
    window.addEventListener('focus', update);
    const preference = (event: StorageEvent) => { if (event.key === LIMIT_KEY) setNewLimit(readLimit()); };
    window.addEventListener('storage', preference);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', update); window.removeEventListener('storage', preference); };
  }, []);
  useEffect(() => { onActiveCardChange?.(current ?? null); }, [current, onActiveCardChange]);
  useEffect(() => () => onActiveCardChange?.(null), [onActiveCardChange]);
  useEffect(() => {
    if (!startToken) return;
    setFilter(initialSubjectId ?? 'all'); setMode('free');
    setSession({ id: crypto.randomUUID(), cards: cards.filter(card => (!initialSubjectId || card.subjectId === initialSubjectId) && (!initialCardId || card.id===initialCardId)), mode: 'free', startedAt: Date.now() });
    setIndex(0); setResults([]); setFlipped(false); setError(null); setSavedPending(null); setLastSaved(null);
  }, [startToken]);
  useEffect(() => {
    if (savedPending) reloadRef.current?.focus();
    else if (complete) completeRef.current?.focus();
    else if (current) (flipped ? firstRatingRef : revealRef).current?.focus();
  }, [current?.id, flipped, complete, savedPending]);
  const record = useCallback(async (rating: Rating) => {
    if (!current || !session || !flipped || saving.current || savedPending || (session.mode === 'spaced' && reviewNeedsReload)) return;
    saving.current = true; setBusy(true); setError(null);
    try {
      const day = reviewClock();
      const log = await onRecord({ flashcardId: current.id, sessionId: session.id, rating, ...(session.mode === 'spaced' ? { schedule: true, admission: { newCardLimit: validLimit(newLimit) ? Number(newLimit) : 0, dayStart: day.dayStart, dayEnd: day.dayEnd } } : {}) });
      acceptLog(log);
    } catch (cause) {
      if (cause instanceof SavedReviewNeedsReloadError) { setSavedPending(cause.log); setError(cause.message); }
      else setError(`${messageFrom(cause)} Sua avaliação ainda não foi registrada.`);
    } finally { saving.current = false; setBusy(false); }
  }, [current, session, flipped, savedPending, reviewNeedsReload, newLimit, onRecord]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (!current || busy || savedPending || isTyping(event.target) || document.querySelector('dialog[open]') || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (event.code === 'Space') { event.preventDefault(); setFlipped(value => !value); }
      else if (/^[1-4]$/.test(event.key) && flipped) { event.preventDefault(); void record(Number(event.key) as Rating); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [current, busy, flipped, record, savedPending]);

  const ratedCard = lastSaved ? cards.find(card=>card.id===lastSaved.flashcardId) : undefined;
  const errorOffer = lastSaved?.rating === 1 && ratedCard && onErrorDraft && <aside className="review-error-offer"><p>Guarde o que precisa retomar e registre sua correção.</p><button className="button secondary" onClick={()=>onErrorDraft({subjectId:ratedCard.subjectId,question:ratedCard.front.slice(0,2000),originLabel:'Revisão de flashcard',source:{kind:'flashcard',flashcardId:ratedCard.id,reviewLogId:lastSaved.id}})}>Anotar no caderno de erros</button></aside>;
  const notebookReturn = (onNotebook || onProgress) && <p className="review-notebook-return"><button className="text-button" disabled={busy || Boolean(savedPending)} onClick={onNotebook ?? onProgress}>{onNotebook ? 'Voltar ao registro de erro' : 'Voltar ao progresso'}</button></p>;
  const savedMessage = lastSaved && <p className="review-next-due" role="status"><Check size={15} />{session?.mode === 'spaced' && savedSchedule?.lastReviewId === lastSaved.id ? `Próxima revisão: ${formatDue(savedSchedule.dueAt)}. ${lastSaved.rating === 1 ? 'Retome em outra sessão após o vencimento.' : ''}` : 'Sua resposta foi salva neste dispositivo.'}</p>;
  const plannerNotice = plannerContext && <aside className="review-planner-context"><Clock3 size={18} /><div><strong>{plannerContext.title}</strong>{plannerContext.unbound && <p>Esta unidade ainda não tem matéria vinculada. Escolha a matéria abaixo para revisar seus cartões.</p>}<p>{plannerContext.minutes} min como referência. {session && Date.parse(clock.now) - session.startedAt >= plannerContext.minutes * 60_000 ? 'Esse tempo já passou; você pode encerrar quando quiser. ' : ''}Conclua o bloco separadamente no planner.</p>{onPlanner && <button className="text-button" disabled={busy || Boolean(savedPending)} onClick={onPlanner}>Voltar ao planner</button>}</div></aside>;
  if (complete && session) {
    const remembered = results.filter(value => value >= 3).length;
    return <div className="review-page page-enter">{plannerNotice}{notebookReturn}<div className="review-complete"><span className="complete-icon"><CheckCheck size={42} strokeWidth={1.4} /></span><div className="eyebrow">MAIS UM PASSO DADO</div><h1 ref={completeRef} tabIndex={-1}>Sua memória agradece.</h1><p>Você praticou {plural(results.length, 'cartão', 'cartões')} nesta sessão.<br />Cada tentativa ajuda a construir uma conexão.</p><div className="session-results"><div><strong>{results.length}</strong><span>cartões revisados</span></div><div><strong>{remembered}</strong><span>respostas lembradas</span></div></div>{savedMessage}{errorOffer}<p className="session-saved"><Check size={15} />Seu histórico foi salvo neste dispositivo.</p><div className="complete-actions"><button className="button secondary" onClick={reset}><RotateCcw size={16} />{session.mode === 'spaced' ? 'Voltar à revisão' : 'Praticar de novo'}</button><button className="button primary" onClick={onLibrary}>Voltar à biblioteca<ArrowRight size={16} /></button></div></div></div>;
  }
  if (session && current) {
    const subject = subjects.find(item => item.id === current.subjectId);
    const state = scheduleByCard.get(current.id);
    const status = !state ? 'Novo cartão' : state.dueAt < clock.dayStart ? 'Atrasado' : 'Revisão de hoje';
    return <div className="review-page page-enter">{plannerNotice}{notebookReturn}<div className="review-session-heading"><button className="text-button muted" onClick={reset} disabled={busy || Boolean(savedPending)}><ArrowLeft size={16} />Encerrar sessão</button><span>{index + 1} de {session.cards.length} cartões</span><span className="review-mode"><Layers2 size={14} />{session.mode === 'spaced' ? 'Revisão espaçada' : 'Prática livre'}</span></div><div className="review-progress" role="progressbar" aria-label="Progresso da sessão" aria-valuenow={index} aria-valuemin={0} aria-valuemax={session.cards.length}><span style={{ width: `${index / session.cards.length * 100}%` }} /></div>
      {savedMessage}{errorOffer}<div className="review-card-area"><span className={`subject-pill accent-${subject?.accent ?? 'lavender'}`}><span className="color-dot" />{subject?.name ?? 'Matéria'}</span>{session.mode === 'spaced' && <p className="review-card-status">{status}</p>}<div className="review-card-scene" key={current.id}><button className={`review-card ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped(value => !value)} disabled={busy || Boolean(savedPending)} aria-describedby={flipped ? 'review-answer' : 'review-question'} aria-label={flipped ? 'Virar cartão para ver a pergunta' : 'Virar cartão para ver a resposta'}><div className="review-face front" aria-hidden={flipped}><span className="face-label">PUXE PELA MEMÓRIA</span><p id="review-question">{current.front}</p><CardMedia storage={storage} metadata={cardMetadata?.find(item => item.flashcardId === current.id)} side="front" /><span className="flip-hint"><RotateCcw size={14} />Pense na resposta antes de revelar</span></div><div className="review-face back" aria-hidden={!flipped}><span className="face-label">CONECTE AS IDEIAS</span><p id="review-answer">{current.back}</p><CardMedia storage={storage} metadata={cardMetadata?.find(item => item.flashcardId === current.id)} side="back" /><span className="flip-hint"><Check size={14} />Como foi lembrar desta resposta?</span></div></button></div>
        <div className="review-response">{!flipped ? <><button ref={revealRef} className="button primary reveal-button" onClick={() => setFlipped(true)} disabled={busy || Boolean(savedPending)}>Revelar resposta<ArrowRight size={17} /></button><span className="keyboard-hint">ou pressione <kbd>espaço</kbd></span></> : <><p className="rating-prompt">Como foi lembrar?</p><div className="rating-buttons">{ratings.map((rating, i) => <button ref={i === 0 ? firstRatingRef : undefined} className={`rating-button ${rating.className}`} key={rating.value} onClick={() => void record(rating.value)} aria-describedby={i === 0 ? 'review-answer' : undefined} disabled={busy || Boolean(savedPending) || (session.mode === 'spaced' && Boolean(reviewNeedsReload))}><span><strong>{rating.label}</strong><kbd>{rating.value}</kbd></span><small>{rating.hint}</small></button>)}</div><span className="keyboard-hint">{busy ? 'Salvando sua avaliação…' : 'Use as teclas 1–4 para avaliar.'}</span></>}{error && <p className="form-error" role="alert">{error}</p>}{(savedPending || (session.mode === 'spaced' && (error || reviewNeedsReload))) && <button ref={reloadRef} className="button secondary" disabled={busy} onClick={() => void refresh()}>{savedPending || reviewNeedsReload ? 'Recarregar agenda' : 'Atualizar fila'}</button>}</div>
      </div></div>;
  }
  return <div className="review-page page-enter"><div className="page-heading"><div><div className="eyebrow">DÊ UM POUCO DE ATENÇÃO À SUA MEMÓRIA</div><h1>Hora de conectar ideias<span className="heading-dot">.</span></h1><p>Uma pergunta de cada vez. Sem pressa, sem distrações.</p></div></div>{plannerNotice}{notebookReturn}
    {cards.length ? <div className="review-start"><span className="review-start-icon"><Layers2 size={39} strokeWidth={1.3} /></span><h2>O que vamos lembrar hoje?</h2><fieldset className="review-modes" disabled={busy}><legend>Modo de revisão</legend><label><input type="radio" name="review-mode" value="free" checked={mode === 'free'} onChange={() => { setMode('free'); setError(null); }} />Prática livre</label><label><input type="radio" name="review-mode" value="spaced" checked={mode === 'spaced'} onChange={() => { setMode('spaced'); setClock(reviewClock()); setError(null); }} />Revisão espaçada</label></fieldset><p>{mode === 'spaced' ? 'Comece pelos cartões devidos e acrescente novos aos poucos.' : 'Pratique seus cartões e registre como foi lembrar. Você escolhe a matéria e o ritmo.'}</p><label className="field-label" htmlFor="review-filter">Escolha sua matéria</label><select className="input" id="review-filter" value={filter} disabled={busy} onChange={event => { setFilter(event.target.value); setError(null); }}><option value="all">Todas as matérias</option>{subjects.map(subject => <option value={subject.id} key={subject.id}>{subject.name}</option>)}</select>
      {mode === 'spaced' ? <><label className="field-label" htmlFor="review-new-limit">Novos cartões por dia</label><input id="review-new-limit" className="input" type="number" min={0} max={50} step={1} value={newLimit} disabled={busy} aria-describedby="review-limit-help" aria-invalid={!validLimit(newLimit)} onChange={event => { const value = event.target.value; setNewLimit(value); if (validLimit(value)) { try { localStorage.setItem(LIMIT_KEY, value); setPreferenceError(false); } catch { setPreferenceError(true); } } }} /><p id="review-limit-help" className="review-queue-help">De 0 a 50. A cota é compartilhada entre as matérias deste espaço. Cartões já inscritos não consomem nova vaga.{preferenceError && ' Esta preferência vale apenas nesta tela, pois não pôde ser guardada.'}</p>{!validLimit(newLimit) && <p className="form-error" role="alert">Escolha um número inteiro entre 0 e 50.</p>}<dl className="review-queue-counts" aria-label="Fila de revisão"><div><dt>Atrasados</dt><dd>{queue.overdue}</dd></div><div><dt>Devidos hoje</dt><dd>{queue.dueToday}</dd></div><div><dt>Novos nesta sessão</dt><dd>{queue.newSelected}</dd></div></dl><p className="review-queue-help" role="status">{queue.introducedToday} novos já inscritos hoje · {queue.remainingNew} vagas restantes. {queue.newAvailable} cartões ainda sem agenda.</p>{queue.cards.length === 0 && <p className="review-queue-empty">Nenhum cartão devido para esta seleção.{queue.nextDueAt && ` Próxima revisão: ${formatDue(queue.nextDueAt)}.`}{queue.newAvailable > 0 && !queue.remainingNew && ' A cota de novos de hoje foi atingida.'}</p>}{queue.overdue + queue.dueToday > 200 && <p className="review-queue-help">Até 200 cartões por sessão. As demais pendências continuam na fila.</p>}</> : <div className="review-start-meta"><BookOpen size={16} />{plural(selectedCards.length, 'cartão', 'cartões')} nesta sessão</div>}
      {reviewNeedsReload && <p className="form-error" role="alert">Uma resposta está salva e a agenda precisa ser recarregada antes da próxima sessão espaçada.</p>}{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary" disabled={busy || (mode === 'spaced' ? !validLimit(newLimit) || queue.cards.length === 0 || Boolean(reviewNeedsReload) : !selectedCards.length)} onClick={() => void start()}>{busy ? 'Preparando…' : mode === 'spaced' ? 'Começar revisão espaçada' : 'Começar revisão'}<ArrowRight size={17} /></button>{(mode === 'spaced' || reviewNeedsReload) && <button className="text-button" disabled={busy} onClick={() => void refresh()}>{reviewNeedsReload ? 'Recarregar agenda' : 'Atualizar fila'}</button>}<span className="practice-note"><Coffee size={14} />{mode === 'spaced' ? 'Agenda local · funciona sem IA' : 'Prática livre · sem agendamento automático'}</span></div> : <EmptyState icon={Sparkles} title="Sua próxima conexão começa aqui" description="Crie alguns flashcards para começar uma sessão de revisão. O histórico de cada avaliação fica salvo." action="Criar meu primeiro cartão" onAction={onCreate} />}
  </div>;
}
