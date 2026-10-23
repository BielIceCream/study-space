import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, ClipboardCheck, FilePenLine } from 'lucide-react';
import { buildPracticePreview, findExistingPracticeNote, resolvePracticeContext } from '../../domain/practice/engine';
import type { PracticeContext, PracticeInput, PracticePreview } from '../../domain/practice/types';
import { plannerClock } from '../../domain/planner/engine';
import type { ImportBatchInput, ImportResult } from '../../services/import/types';
import type { Snapshot } from '../../shared/types';
import { ErrorMessage } from '../../shared/ui';
import { messageFrom } from '../../shared/utils';
import './practice.css';

export interface PracticePageProps {
  data: Snapshot;
  initialContext?: PracticeContext;
  onCreate: (batch: ImportBatchInput) => Promise<ImportResult>;
  onOpenNote: (noteId: string) => Promise<void>;
  onPlanner: (trackId?: string) => void;
  registerFlush?: (flush: () => Promise<void>, isDirty: () => boolean) => () => void;
}

export function PracticePage({ data, initialContext, onCreate, onOpenNote, onPlanner, registerFlush }: PracticePageProps) {
  let context: ReturnType<typeof resolvePracticeContext> | undefined;
  let contextError: string | null = null;
  try { if (initialContext) context = resolvePracticeContext(data, initialContext); }
  catch (cause) { contextError = messageFrom(cause); }
  const [openedDate] = useState(() => plannerClock().date);
  const [initialInput] = useState<PracticeInput>(() => ({ kind: 'weekly', subjectId: data.subjects[0]?.id ?? '', trackId: initialContext?.trackId, date: context?.block.date ?? openedDate, minutes: Math.min(30, context?.block.minutes ?? 240), theme: '', context: initialContext }));
  const [input, setInput] = useState<PracticeInput>(initialInput);
  const [preview, setPreview] = useState<PracticePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const creating = useRef(false);
  const savedTemplates = useRef(new Map<string, string | null>());
  const latestData = useRef(data);
  latestData.current = data;
  const previewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (preview) previewHeading.current?.focus(); }, [preview]);
  useEffect(() => registerFlush?.(async () => {
    if (creating.current) throw new Error('Aguarde a criação da atividade antes de sair.');
    if (dirtyRef.current) throw new Error('Crie a nota da atividade ou descarte seus ajustes antes de sair.');
  }, () => creating.current || dirtyRef.current), [registerFlush]);

  const change = <K extends keyof PracticeInput>(key: K, value: PracticeInput[K]) => {
    setInput(current => ({ ...current, [key]: value }));
    dirtyRef.current = true; setDirty(true);
    setPreview(null); setError(null); setSavedId(null);
  };
  const discard = () => {
    setInput(initialInput); setPreview(null); setError(null); setSavedId(null);
    dirtyRef.current = false; setDirty(false);
  };
  const prepare = (event: FormEvent) => {
    event.preventDefault(); setError(null); setSavedId(null);
    try { setPreview(buildPracticePreview(data, input)); }
    catch (cause) { setError(messageFrom(cause)); }
  };
  const create = async () => {
    if (!preview || creating.current) return;
    creating.current = true; setBusy(true); setError(null);
    const key = JSON.stringify([preview.batch.subjectId, preview.note.title, preview.note.plainText]);
    let writtenId: string | null = null;
    try {
      const existing = findExistingPracticeNote(latestData.current, preview);
      let id = existing?.id ?? savedTemplates.current.get(key);
      if (!id && !savedTemplates.current.has(key)) {
        // Revalidate before a new write; a saved note can always be reopened.
        const currentPreview = buildPracticePreview(latestData.current, input);
        if (currentPreview.note.title !== preview.note.title || currentPreview.note.plainText !== preview.note.plainText) throw new Error('Os conteúdos ou vínculos da trilha mudaram. Use “Ver prévia” para conferir a atividade atualizada antes de criar a nota.');
        const result = await onCreate(preview.batch);
        id = result.noteIds[0] ?? findExistingPracticeNote(latestData.current, preview)?.id;
        // Any completed import is conclusive: never repeat it just because its result lacks an ID.
        savedTemplates.current.set(key, id ?? null);
        if (!id) throw new Error(result.skippedDuplicates > 0 ? 'O roteiro já existe, mas a nota ainda não apareceu nos dados. Atualize a página para abri-la; nenhuma nota foi sobrescrita.' : 'A importação não retornou uma nota. Confira a biblioteca antes de tentar novamente.');
      }
      if (!id) throw new Error('O roteiro já existe. Atualize os dados para localizar a nota antes de tentar novamente.');
      savedTemplates.current.set(key, id);
      writtenId = id; setSavedId(id);
      dirtyRef.current = false; setDirty(false);
      // Navigating is safe after the durable result, even before React renders new data.
      creating.current = false;
      await onOpenNote(id);
    } catch (cause) { setError(writtenId ? `A atividade foi salva. Não foi possível abrir a nota: ${messageFrom(cause)} Use “Abrir nota criada” para tentar novamente.` : messageFrom(cause)); }
    finally { creating.current = false; setBusy(false); }
  };
  const maximumMinutes = context?.block.minutes ?? 240;

  return <div className="practice-page page-enter">
    <div className="page-heading"><div><div className="eyebrow">PRATICAR E REVER</div><h1>Atividades semanais<span className="heading-dot">.</span></h1><p>Prepare uma atividade, escreva suas respostas e revise com seus materiais.</p></div><button className="button secondary" disabled={busy} onClick={() => onPlanner(input.trackId)}><ArrowLeft size={16} />Voltar ao planner</button></div>
    <div className="practice-notice"><ClipboardCheck size={21} /><p>Você confere a prévia antes de criar uma nota na biblioteca. Respostas, correções e resultados ficam nessa nota, sob seu controle. O diagnóstico e as revisões espaçadas permanecem separados desta atividade.</p></div>
    {contextError && <ErrorMessage>{contextError}</ErrorMessage>}
    {!data.subjects.length ? <section className="practice-empty"><BookOpen size={30} /><h2>Escolha um lugar para suas atividades</h2><p>Crie uma matéria na biblioteca para guardar a prova semanal ou a redação.</p></section> : <div className="practice-layout">
      <section className="practice-settings" aria-labelledby="practice-config-title">
        <h2 id="practice-config-title">Sua atividade</h2>
        <div className="practice-modes" role="group" aria-label="Tipo de atividade"><button type="button" className={`button ${input.kind === 'weekly' ? 'soft' : 'secondary'}`} aria-pressed={input.kind === 'weekly'} disabled={busy} onClick={() => change('kind', 'weekly')}><ClipboardCheck size={16} />Prova semanal</button><button type="button" className={`button ${input.kind === 'writing' ? 'soft' : 'secondary'}`} aria-pressed={input.kind === 'writing'} disabled={busy} onClick={() => change('kind', 'writing')}><FilePenLine size={16} />Redação</button></div>
        <form onSubmit={prepare}>
          <fieldset className="practice-fields" disabled={busy || !!contextError}>
            <legend className="sr-only">Configurar atividade</legend>
            <label htmlFor="practice-subject">Matéria da atividade</label><select id="practice-subject" className="input" required value={input.subjectId} onChange={event => change('subjectId', event.target.value)}>{data.subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select>
            <label htmlFor="practice-track">Trilha (opcional)</label><select id="practice-track" className="input" value={input.trackId ?? ''} disabled={!!context} onChange={event => change('trackId', event.target.value || undefined)}><option value="">Atividade independente</option>{data.studyTracks?.map(track => <option key={track.id} value={track.id}>{track.config.name}</option>)}</select>
            <p className="practice-help">As questões usam somente conteúdos das disciplinas selecionadas que você vinculou explicitamente a esta matéria. Sem vínculo, você recebe um roteiro manual.</p>
            <div className="practice-date-grid"><div><label htmlFor="practice-date">Data da atividade</label><input id="practice-date" className="input" type="date" min="2000-01-01" max="2100-12-31" required disabled={!!context} value={input.date} onChange={event => change('date', event.target.value)} /></div><div><label htmlFor="practice-minutes">Duração (minutos)</label><input id="practice-minutes" className="input" type="number" min={1} max={maximumMinutes} step={1} required value={input.minutes} onChange={event => change('minutes', event.target.valueAsNumber)} /></div></div>
            {context && <p className="practice-context"><CalendarDays size={16} />Bloco aceito do planner: até {context.block.minutes} minutos. Criar ou editar a nota não conclui o bloco; confirme sua atividade no planner.</p>}
            {input.kind === 'writing' && <><label htmlFor="practice-theme">Tema da redação</label><textarea id="practice-theme" className="input" required maxLength={300} rows={4} value={input.theme} placeholder="Escreva o tema que deseja estudar" onChange={event => change('theme', event.target.value)} /><p className="practice-help">Você informa o tema. A rubrica é genérica para estudo e não representa uma nota oficial do ENEM.</p></>}
            <button type="submit" className="button primary">Ver prévia<ArrowRight size={16} /></button>
          </fieldset>
        </form>
        {dirty && <button type="button" className="text-button muted practice-discard" disabled={busy} onClick={discard}>Descartar ajustes</button>}
        {error && <ErrorMessage>{error}</ErrorMessage>}
      </section>
      <section className="practice-preview" aria-labelledby="practice-preview-title">
        <h2 id="practice-preview-title" ref={previewHeading} tabIndex={-1}>{preview ? 'Confira antes de criar' : 'Sua prévia aparece aqui'}</h2>
        {!preview ? <div className="practice-preview-empty"><FilePenLine size={33} /><p>Escolha o tipo, a matéria e o tempo disponível. Nada é salvo ao abrir esta página ou preparar a prévia.</p></div> : <>
          <ul className="practice-warnings">{preview.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
          {preview.kind === 'weekly' && <p className="practice-help">{preview.questionIds.length} questões nesta atividade · {preview.bankSize} disponíveis no banco vinculado.</p>}
          <div className="practice-preview-text" role="region" aria-label="Conteúdo da prévia" tabIndex={0}>{preview.instructions}</div>
          {preview.answerKey && <details className="practice-answer-key"><summary>Ver gabarito para autocorreção</summary><div className="practice-preview-text">{preview.answerKey}</div></details>}
          <p className="practice-help">Será criada uma única nota. Você poderá editar o roteiro, responder e guardar evidências no editor da biblioteca. Um roteiro idêntico já existente será aberto sem substituir seu conteúdo.</p>
          <div className="practice-actions"><button className="button primary" disabled={busy || !!contextError} onClick={() => void create()}><BookOpen size={16} />{busy ? 'Criando nota…' : savedId ? 'Abrir nota criada' : 'Criar nota da atividade'}</button></div>
          {savedId && <p className="practice-saved" role="status">Atividade salva na biblioteca.</p>}
        </>}
      </section>
    </div>}
  </div>;
}
