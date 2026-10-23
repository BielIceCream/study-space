import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, BookOpen, Check, ClipboardList, Plus, RotateCcw } from 'lucide-react';
import type { ErrorDraft, ErrorEntry, ErrorSource, SaveErrorEntryInput } from '../../domain/error-notebook/types';
import type { Snapshot } from '../../shared/types';
import { ErrorMessage } from '../../shared/ui';
import { messageFrom } from '../../shared/utils';
import './notebook.css';

type NotebookData = Snapshot & { errorEntries?: ErrorEntry[] };
type EntryForm = Pick<SaveErrorEntryInput, 'subjectId' | 'originLabel' | 'question' | 'correction' | 'nextAction' | 'source'>;
const sourceLabels: Record<ErrorSource['kind'], string> = { manual: 'Manual', flashcard: 'Flashcard', note: 'Nota', diagnostic: 'Diagnóstico' };
const ratingLabels = { 1: 'Errei', 2: 'Difícil', 3: 'Bom', 4: 'Fácil' };
const dateLabel = (date: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(date));
const toForm = (entry: ErrorEntry): EntryForm => ({ subjectId: entry.subjectId, originLabel: entry.originLabel, question: entry.question, correction: entry.correction, nextAction: entry.nextAction, source: entry.source });
const newForm = (data: NotebookData, draft?: ErrorDraft): EntryForm => ({ subjectId: draft?.subjectId ?? data.subjects[0]?.id ?? '', originLabel: draft?.originLabel ?? '', question: draft?.question ?? '', correction: '', nextAction: '', source: draft?.source ?? { kind: 'manual' } });
const fingerprint = (form: EntryForm) => JSON.stringify(form);

export function NotebookPage({ data, initialSubjectId, initialEntryId, initialDraft, onSave, onOpenNote, onReviewCard, onReload, onProgress, registerFlush }: {
  data: NotebookData; initialSubjectId?: string; initialEntryId?: string; initialDraft?: ErrorDraft;
  onSave: (input: SaveErrorEntryInput) => Promise<ErrorEntry>;
  onOpenNote: (id: string) => void;
  onReviewCard: (cardId: string, entryId: string) => void;
  onReload?: () => Promise<void>;
  onProgress?: () => void;
  registerFlush?: (flush: () => Promise<void>, isDirty: () => boolean) => () => void;
}) {
  const entries = data.errorEntries ?? [];
  const initialEntry = initialDraft ? null : entries.find(entry => entry.id === initialEntryId) ?? null;
  const [entry, setEntry] = useState<ErrorEntry | null>(initialEntry);
  const [form, setForm] = useState<EntryForm | null>(() => initialDraft ? newForm(data, initialDraft) : initialEntry ? toForm(initialEntry) : null);
  const [initialFingerprint, setInitialFingerprint] = useState(() => initialDraft ? '' : initialEntry ? fingerprint(toForm(initialEntry)) : '');
  const [subjectFilter, setSubjectFilter] = useState(initialSubjectId ?? '');
  const [statusFilter, setStatusFilter] = useState('open');
  const [visibleCount, setVisibleCount] = useState(50);
  const [practice, setPractice] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const practiceId = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [focusVersion, setFocusVersion] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dirty = form !== null && fingerprint(form) !== initialFingerprint;
  const hasDraft = dirty || !!practice.trim();
  const dirtyRef = useRef(hasDraft);
  dirtyRef.current = hasDraft;
  const current = entry ? entries.find(item => item.id === entry.id) : undefined;
  const stale = !!entry && !!current && current.revision !== entry.revision;
  const filtered = useMemo(() => entries.filter(item => (!subjectFilter || item.subjectId === subjectFilter) && (statusFilter === 'all' || item.status === statusFilter)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)), [entries, subjectFilter, statusFilter]);
  const diagnostics = useMemo(() => (data.studyTracks ?? []).flatMap(track => track.diagnostics.flatMap(attempt => attempt.answers.flatMap(answer => {
    const question = track.catalog.questions.find(item => item.id === answer.questionId);
    return question ? [{ key: JSON.stringify([track.id, attempt.id, question.id]), label: `${track.config.name} · ${dateLabel(answer.answeredAt)} · ${question.prompt}`, source: { kind: 'diagnostic' as const, trackId: track.id, attemptId: attempt.id, questionId: question.id } }] : [];
  }))), [data.studyTracks]);
  const cardId = entry?.source.kind === 'flashcard' ? entry.source.flashcardId : null;
  const cardLogs = useMemo(() => cardId && entry ? data.reviewLogs.filter(log => log.flashcardId === cardId && log.reviewedAt >= entry.createdAt && (entry.source.kind !== 'flashcard' || log.id !== entry.source.reviewLogId)).sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt)).slice(0, 50) : [], [cardId, entry, data.reviewLogs]);

  useEffect(() => registerFlush?.(async () => {
    if (busyRef.current) throw new Error('Aguarde a gravação do caderno antes de sair.');
    if (dirtyRef.current) throw new Error('Salve ou descarte a edição do caderno antes de sair.');
  }, () => dirtyRef.current || busyRef.current), [registerFlush]);

  useEffect(() => {
    if (!focusVersion) return;
    headingRef.current?.focus();
  }, [focusVersion]);

  const open = (next: ErrorEntry | null, draft?: ErrorDraft) => {
    const nextForm = next ? toForm(next) : { ...newForm(data, draft), subjectId: draft?.subjectId ?? (subjectFilter || data.subjects[0]?.id || '') };
    setEntry(next); setForm(nextForm); setInitialFingerprint(draft ? '' : fingerprint(nextForm));
    setPractice(''); practiceId.current = null; setError(null); setNotice(''); setFocusVersion(value => value + 1);
  };
  const discard = () => {
    if (entry) open(current ?? entry);
    else { setForm(null); setPractice(''); practiceId.current = null; setError(null); setNotice('Rascunho descartado.'); }
  };
  const set = <K extends keyof EntryForm>(key: K, value: EntryForm[K]) => {
    setForm(previous => previous ? { ...previous, [key]: value } : previous); setNotice(''); setError(null);
  };
  const applySaved = (saved: ErrorEntry, noticeText: string) => {
    setEntry(saved); setForm(toForm(saved)); setInitialFingerprint(fingerprint(toForm(saved))); setNotice(noticeText);
  };
  const persist = async (input: SaveErrorEntryInput, noticeText: string) => {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setError(null); setNotice('');
    try { applySaved(await onSave(input), noticeText); return true; }
    catch (cause) { setError(messageFrom(cause)); return false; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    if (!form.subjectId || !form.question.trim() || !form.originLabel.trim()) { setError('Preencha a matéria, o que aconteceu e a origem ou atividade.'); return; }
    if ((form.source.kind === 'flashcard' && !form.source.flashcardId) || (form.source.kind === 'note' && !form.source.noteId) || (form.source.kind === 'diagnostic' && !form.source.questionId)) { setError('Selecione o item da fonte antes de salvar.'); return; }
    await persist({ ...form, ...(entry ? { id: entry.id, expectedRevision: entry.revision } : {}), status: entry?.status ?? 'open' }, 'Registro salvo.');
  };
  const changeStatus = async () => {
    if (!entry || !form || dirty) return;
    if (entry.status === 'open' && (!entry.correction.trim() || !entry.nextAction.trim())) { setError('Preencha e salve a correção e a próxima ação antes de resolver o erro.'); return; }
    await persist({ ...toForm(entry), id: entry.id, expectedRevision: entry.revision, status: entry.status === 'open' ? 'resolved' : 'open' }, entry.status === 'open' ? 'Erro resolvido por você. O registro permanece no histórico.' : 'Erro reaberto.');
  };
  const recordPractice = async (event: FormEvent) => {
    event.preventDefault();
    if (!entry || dirty || !practice.trim()) return;
    practiceId.current ??= crypto.randomUUID();
    if (await persist({ ...toForm(entry), id: entry.id, expectedRevision: entry.revision, status: entry.status, practice: { id: practiceId.current, description: practice.trim() } }, 'Prática registrada. A situação do erro foi mantida.')) { setPractice(''); practiceId.current = null; }
  };
  const reload = async () => {
    if (!onReload || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await onReload(); setNotice('Dados atualizados. Descarte a edição para carregar a versão salva; seu rascunho foi mantido.'); }
    catch (cause) { setError(messageFrom(cause)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const changeSource = (kind: ErrorSource['kind']) => {
    const source: ErrorSource = kind === 'manual' ? { kind } : kind === 'flashcard' ? { kind, flashcardId: '', reviewLogId: null } : kind === 'note' ? { kind, noteId: '' } : { kind, trackId: '', attemptId: '', questionId: '' };
    set('source', source);
  };

  return <div className="notebook-page page-enter">
    <div className="page-heading"><div><div className="eyebrow">APRENDER COM CADA TENTATIVA</div><h1>Caderno de erros<span className="heading-dot">.</span></h1><p>Entenda a dúvida, registre sua correção e escolha como praticar.</p></div><button className="button primary" disabled={busy || hasDraft || entries.length >= 5000 || !data.subjects.length} onClick={() => open(null)}><Plus size={17} />Novo erro</button></div>
    {onProgress && <p><button className="text-button" onClick={onProgress}>Voltar ao progresso</button></p>}
    <p className="notebook-notice"><BookOpen size={20} /><span>Seus registros ficam neste espaço local e nos backups. Resolver um erro é sua decisão; não comprova domínio de um conteúdo. Tudo funciona sem IA.</span></p>
    {!data.subjects.length && <p className="notebook-help">Crie uma matéria na biblioteca para organizar seu primeiro registro.</p>}
    {entries.length >= 5000 && <p className="notebook-help">O limite de 5.000 registros foi atingido. Você ainda pode consultar e atualizar os registros existentes.</p>}
    <div className="notebook-layout">
      <section className="notebook-list" aria-labelledby="notebook-list-title"><h2 id="notebook-list-title">Seus registros</h2>
        <div className="notebook-filters"><label>Filtrar por matéria<select className="input" value={subjectFilter} onChange={event => { setSubjectFilter(event.target.value); setVisibleCount(50); }}><option value="">Todas as matérias</option>{data.subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label><label>Filtrar por situação<select className="input" value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setVisibleCount(50); }}><option value="open">Abertos</option><option value="resolved">Resolvidos</option><option value="all">Todos</option></select></label></div>
        <p className="notebook-count">{filtered.length} {filtered.length === 1 ? 'registro encontrado' : 'registros encontrados'}</p>
        {hasDraft && <p className="notebook-draft-hint">Salve ou descarte a edição e registre ou descarte a prática para abrir outro registro.</p>}
        {!filtered.length ? <div className="notebook-empty"><ClipboardList size={27} /><p>{entries.length ? 'Nenhum registro corresponde aos filtros.' : 'Seu caderno começa com uma dúvida. Use “Novo erro” ou registre uma dificuldade durante a revisão de um cartão.'}</p></div> : <ul className="notebook-entry-list">{filtered.slice(0, visibleCount).map(item => <li key={item.id}><button className={`notebook-entry ${entry?.id === item.id ? 'selected' : ''}`} onClick={() => open(item)} disabled={busy || hasDraft} aria-current={entry?.id === item.id ? 'true' : undefined}><span className="notebook-entry-top"><strong>{item.question}</strong><span className={`notebook-status ${item.status}`}>{item.status === 'open' ? 'Aberto' : 'Resolvido'}</span></span><span className="notebook-entry-meta">{data.subjects.find(subject => subject.id === item.subjectId)?.name ?? 'Matéria'} · {sourceLabels[item.source.kind]}</span><span className="notebook-entry-date">Atualizado em {dateLabel(item.updatedAt)}</span></button></li>)}</ul>}
        {filtered.length > visibleCount && <button className="button secondary" onClick={() => setVisibleCount(value => value + 50)}>Mostrar mais registros</button>}
      </section>
      <section className="notebook-detail" aria-labelledby="notebook-detail-title">
        <h2 id="notebook-detail-title" ref={headingRef} tabIndex={-1}>{form ? entry ? 'Detalhes do registro' : 'Novo registro' : 'Um próximo passo para sua dúvida'}</h2>
        {!form ? <div className="notebook-detail-empty"><BookOpen size={34} /><p>Abra um registro da lista ou crie um novo. Correção e próxima ação podem ser preenchidas quando você estiver pronto.</p></div> : <>
          {entry && <div className="notebook-record-meta"><span className={`notebook-status ${entry.status}`}>{entry.status === 'open' ? 'Aberto' : 'Resolvido'}</span><span>Criado em {dateLabel(entry.createdAt)}</span>{entry.resolvedAt && <span>Resolvido em {dateLabel(entry.resolvedAt)}</span>}</div>}
          {stale && <p className="notebook-draft-hint">Há uma versão mais recente deste registro. Descarte a edição para carregá-la antes de salvar.</p>}
          <form onSubmit={event => void save(event)}>
            <fieldset className="notebook-fields" disabled={busy || stale}><legend className="sr-only">Dados do registro</legend>
              <label>O que aconteceu?<textarea className="input" value={form.question} onChange={event => set('question', event.target.value)} required maxLength={2000} rows={4} /><small>Descreva a pergunta, o erro ou a dificuldade que quer entender.</small></label>
              <div className="notebook-field-grid"><label>Origem ou atividade<input className="input" value={form.originLabel} onChange={event => set('originLabel', event.target.value)} required maxLength={180} /></label><label>Matéria do registro<select className="input" value={form.subjectId} disabled={!!entry} required onChange={event => {
                const subjectId = event.target.value;
                setForm(previous => previous ? { ...previous, subjectId, source: previous.source.kind === 'flashcard' ? { kind: 'flashcard', flashcardId: '', reviewLogId: null } : previous.source.kind === 'note' ? { kind: 'note', noteId: '' } : previous.source } : previous);
                setNotice('');
              }}><option value="">Selecione uma matéria</option>{data.subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label></div>
              <label>Fonte<select className="input" value={form.source.kind} disabled={!!entry} onChange={event => changeSource(event.target.value as ErrorSource['kind'])}>{Object.entries(sourceLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
              {form.source.kind === 'flashcard' && <label>Cartão de origem<select className="input" disabled={!!entry} value={form.source.flashcardId} required onChange={event => set('source', { kind: 'flashcard', flashcardId: event.target.value, reviewLogId: null })}><option value="">Selecione um cartão</option>{data.flashcards.filter(card => card.subjectId === form.subjectId).map(card => <option key={card.id} value={card.id}>{card.front}</option>)}</select></label>}
              {form.source.kind === 'note' && <label>Nota de origem<select className="input" disabled={!!entry} value={form.source.noteId} required onChange={event => set('source', { kind: 'note', noteId: event.target.value })}><option value="">Selecione uma nota</option>{data.notes.filter(note => note.subjectId === form.subjectId).map(note => <option key={note.id} value={note.id}>{note.title}</option>)}</select><small>A fonte salva inclui o título e até os primeiros 1.000 caracteres da nota.</small></label>}
              {form.source.kind === 'diagnostic' && <label>Questão respondida no diagnóstico<select className="input" disabled={!!entry} required value={JSON.stringify([form.source.trackId, form.source.attemptId, form.source.questionId])} onChange={event => { const choice = diagnostics.find(item => item.key === event.target.value); if (choice) set('source', choice.source); }}><option value={JSON.stringify(['', '', ''])}>Selecione uma questão</option>{diagnostics.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select><small>Apenas questões com resposta registrada, inclusive “Não sei ainda”. Escolha a matéria da biblioteca; ela não é deduzida da competência.</small></label>}
              {entry && <p className="notebook-help">A matéria e o vínculo da fonte são preservados após a criação.</p>}
              <label>Correção<textarea className="input" value={form.correction} onChange={event => set('correction', event.target.value)} maxLength={5000} rows={5} /><small>Explique com suas palavras o que mudou no seu entendimento.</small></label>
              <label>Próxima ação<textarea className="input" value={form.nextAction} onChange={event => set('nextAction', event.target.value)} maxLength={2000} rows={3} /><small>Uma ação concreta: revisar uma nota, refazer a questão ou praticar um exemplo.</small></label>
            </fieldset>
            {error && <ErrorMessage>{error}</ErrorMessage>}
            {error && onReload && <button className="text-button" type="button" disabled={busy} onClick={() => void reload()}>Atualizar dados</button>}
            {notice && <p className="notebook-saved" role="status"><Check size={16} />{notice}</p>}
            <div className="notebook-actions"><button className="button primary" type="submit" disabled={busy || stale}>{busy ? 'Salvando…' : 'Salvar registro'}<Check size={16} /></button><button className="button secondary" type="button" disabled={busy} onClick={discard}>{hasDraft ? 'Descartar edição' : entry ? 'Recarregar registro' : 'Cancelar'}</button>{entry && <button className="button soft" type="button" disabled={busy || dirty || stale} onClick={() => void changeStatus()}>{entry.status === 'open' ? <Check size={16} /> : <RotateCcw size={16} />}{entry.status === 'open' ? 'Resolver erro' : 'Reabrir erro'}</button>}</div>
            {entry?.status === 'open' && <p className="notebook-help">Para resolver, preencha e salve a correção e a próxima ação. Praticar não resolve o erro automaticamente.</p>}
          </form>
          {entry && <>
            {<section className="notebook-source" aria-labelledby="notebook-source-title"><h3 id="notebook-source-title">Fonte capturada ao criar</h3><strong>{entry.sourceSnapshot.title}</strong>{entry.sourceSnapshot.prompt && <p>{entry.sourceSnapshot.prompt}</p>}{entry.sourceSnapshot.answer && <div><span>Resposta ou referência</span><p>{entry.sourceSnapshot.answer}</p></div>}<small>Esta cópia de referência preserva a fonte no momento do registro. Alterações posteriores no material não a reescrevem.</small><div className="notebook-actions">{entry.source.kind === 'note' && <button className="button secondary small" disabled={busy || hasDraft} onClick={() => onOpenNote(entry.source.kind === 'note' ? entry.source.noteId : '')}>Abrir nota<ArrowRight size={15} /></button>}{cardId && <button className="button secondary small" disabled={busy || hasDraft} onClick={() => onReviewCard(cardId, entry.id)}>Praticar este cartão<ArrowRight size={15} /></button>}</div></section>}
            <section className="notebook-practice" aria-labelledby="notebook-practice-title"><h3 id="notebook-practice-title">Registro de prática</h3><p>Conte o que você praticou. Este registro manual não atribui nota nem altera sua agenda de revisão.</p><form onSubmit={event => void recordPractice(event)}><label>O que praticou?<textarea className="input" rows={3} value={practice} maxLength={1000} required disabled={busy || dirty || stale || entry.practices.length >= 200} onChange={event => { setPractice(event.target.value); practiceId.current = null; }} /></label><button className="button secondary" disabled={busy || dirty || stale || !practice.trim() || entry.practices.length >= 200} type="submit">Registrar prática</button></form>{dirty && <p className="notebook-help">Salve ou descarte a edição antes de registrar uma prática.</p>}{entry.practices.length >= 200 && <p className="notebook-help">Este registro atingiu o limite de 200 práticas.</p>}{entry.practices.length ? <ol className="notebook-history">{[...entry.practices].reverse().map(item => <li key={item.id}><time dateTime={item.createdAt}>{dateLabel(item.createdAt)}</time><p>{item.description}</p></li>)}</ol> : <p className="notebook-help">Nenhuma prática registrada ainda.</p>}</section>
            {cardId && <section className="notebook-reviews" aria-labelledby="notebook-reviews-title"><h3 id="notebook-reviews-title">Revisões do cartão após o registro</h3><p>Histórico de respostas do cartão, independente das práticas manuais. Avaliações não comprovam domínio nem resolvem este erro.</p>{cardLogs.length ? <ol className="notebook-history">{cardLogs.map(log => <li key={log.id}><time dateTime={log.reviewedAt}>{dateLabel(log.reviewedAt)}</time><strong>{ratingLabels[log.rating]}</strong></li>)}</ol> : <p className="notebook-help">Nenhuma revisão deste cartão após a criação do registro.</p>}{cardLogs.length === 50 && <small>Exibindo as 50 revisões mais recentes.</small>}</section>}
          </>}
        </>}
      </section>
    </div>
  </div>;
}
