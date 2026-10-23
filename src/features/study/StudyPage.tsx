import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, BookOpen, CalendarDays, Check, ClipboardCheck, Link2, Plus, Route, Settings2 } from 'lucide-react';
import { DEMO_CATALOG, defaultConfig } from '../../domain/study/demo';
import { answerDiagnostic, assessCompetencies, nextUnit, skipDiagnostic, startDiagnostic } from '../../domain/study/engine';
import type { DiagnosticAttempt, SaveStudyTrackInput, StudyCatalog, StudyTrack, TrackConfig } from '../../domain/study/types';
import type { Note, Snapshot, Subject } from '../../shared/types';
import { ErrorMessage, Modal } from '../../shared/ui';
import { messageFrom } from '../../shared/utils';
import './study.css';

const yearLabels: Record<TrackConfig['startingYear'], string> = { fundamental: 'Ensino fundamental', 'medio-1': '1º ano do ensino médio', 'medio-2': '2º ano do ensino médio', 'medio-3': '3º ano do ensino médio', concluido: 'Ensino médio concluído' };
const evidenceLabels = { unknown: 'Ainda sem evidência', 'needs-practice': 'Reforçar a base', 'initial-evidence': 'Evidência inicial', 'review-due': 'Rever a evidência' };
const dateLabel = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

export function StudyPage({ data, initialTrackId, onSave, onOpenSubject, onOpenNote, onPlanner }: {
  initialTrackId?: string; onPlanner: (trackId: string) => void;
  data: Snapshot; onSave: (input: SaveStudyTrackInput) => Promise<StudyTrack>;
  onOpenSubject: (subject: Subject) => void; onOpenNote: (note: Note) => void;
}) {
  const tracks = data.studyTracks ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(initialTrackId ?? null);
  const [editing, setEditing] = useState<'new' | 'current' | null>(null);
  const [bindingUnitId, setBindingUnitId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const track = tracks.find(item => item.id === selectedId) ?? tracks[0];
  const save = async (input: SaveStudyTrackInput) => {
    setBusy(true); setError(null);
    try { const saved = await onSave(input); setSelectedId(saved.id); return saved; }
    catch (cause) { setError(messageFrom(cause)); throw cause; }
    finally { setBusy(false); }
  };
  const update = async (config: TrackConfig, diagnostics = track.diagnostics) => save({ id: track.id, expectedRevision: track.revision, catalog: track.catalog, config, diagnostics });
  const updateAttempt = async (attempt: DiagnosticAttempt) => {
    const diagnostics = track.diagnostics.some(item => item.id === attempt.id) ? track.diagnostics.map(item => item.id === attempt.id ? attempt : item) : [...track.diagnostics, attempt];
    await update(track.config, diagnostics);
  };
  const suggestion = track ? nextUnit(track) : null;
  const evidence = track ? assessCompetencies(track) : [];
  const selectedUnits = track ? track.catalog.units.filter(unit => {
    const competency = track.catalog.competencies.find(item => item.id === unit.competencyId)!;
    return track.config.subjectIds.includes(competency.subjectId);
  }) : [];
  const bindingUnit = track?.catalog.units.find(unit => unit.id === bindingUnitId);

  return <div className="study-page page-enter">
    <div className="page-heading"><div><div className="eyebrow">UM CAMINHO DO SEU JEITO</div><h1>Trilhas de estudo<span className="heading-dot">.</span></h1><p>Conheça sua base, conecte seus materiais e escolha o próximo passo.</p></div><button className="button primary" onClick={() => setEditing('new')} disabled={busy}><Plus size={17} />Nova trilha</button></div>
    <div className="study-notice"><Route size={20} /><p><strong>Comece pequeno, avance com evidências.</strong> Esta primeira trilha é uma amostra demonstrativa de Matemática e Língua Portuguesa, com conteúdo autoral. Funciona localmente, sem IA, e não cobre todo o currículo ou garante preparação para o ENEM.</p></div>
    {error && <ErrorMessage>{error}</ErrorMessage>}
    {!track ? <section className="study-catalog-card"><div className="study-icon"><Route size={28} /></div><div><span className="study-badge">CATÁLOGO DEMONSTRATIVO · V{DEMO_CATALOG.version}</span><h2>{DEMO_CATALOG.title}</h2><p>{DEMO_CATALOG.description}</p><ul><li>Configure seu objetivo e seu tempo disponível.</li><li>Faça um diagnóstico opcional e retome quando quiser.</li><li>Use as notas e matérias que já existem na sua biblioteca.</li></ul><button className="button primary" onClick={() => setEditing('new')}>Configurar minha trilha<ArrowRight size={16} /></button></div></section> : <>
      {tracks.length > 1 && <div className="study-track-picker"><label className="field-label" htmlFor="study-track-choice">Trilha atual</label><select className="input" id="study-track-choice" value={track.id} disabled={busy} onChange={event => { setSelectedId(event.target.value); setError(null); }}>{tracks.map(item => <option key={item.id} value={item.id}>{item.config.name}</option>)}</select></div>}
      <section className="study-summary" aria-label="Configuração da trilha"><div><span className="study-badge">{track.catalog.title} · AMOSTRA V{track.catalog.version}</span><h2>{track.config.name}</h2><p>{track.config.objective}</p><div className="study-meta"><span>{yearLabels[track.config.startingYear]}</span><span>{track.config.weeklyMinutes} min/semana</span><span>{track.config.subjectIds.length} matérias</span>{track.config.examDate && <span>Prova: {new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${track.config.examDate}T12:00:00Z`))}</span>}</div></div><button className="button secondary" onClick={() => setEditing('current')} disabled={busy}><Settings2 size={16} />Editar configuração</button></section>
      <p className="study-small-note"><strong>Sua série é um ponto de partida, não uma medida de domínio.</strong> Suas preferências ficam salvas. No planner, você pode gerar uma prévia semanal, aceitar os blocos e replanejar pendências respeitando seu tempo.</p>
      <button className="button soft" onClick={() => onPlanner(track.id)}><CalendarDays size={16} />Planejar minha semana<ArrowRight size={16} /></button>
      <div className="study-main-grid"><section className="study-next-card" aria-label="Próximo passo sugerido"><span className="study-section-kicker"><Route size={16} />PRÓXIMO PASSO SUGERIDO</span><h2>{suggestion?.unit.title ?? 'Continue observando sua base'}</h2><p>{suggestion?.reason ?? 'Refaça o diagnóstico quando quiser novas evidências e use seus materiais para continuar praticando.'}</p>{suggestion && <button className="text-button" disabled={busy} onClick={() => setBindingUnitId(suggestion.unit.id)}>Conectar meus materiais<ArrowRight size={16} /></button>}<small>Uma sugestão local baseada em pré-requisitos e respostas; sem agendamento automático.</small></section>
        <DiagnosticPanel key={track.id} track={track} busy={busy} onAttempt={updateAttempt} />
      </div>
      <section className="study-report" aria-labelledby="study-report-title"><div className="section-heading"><h2 id="study-report-title"><ClipboardCheck size={19} />Seu ponto de partida</h2><span className="section-hint">Evidências, sem rótulos de domínio</span></div><p className="study-small-note">Amostra curta: uma resposta isolada não comprova aprendizagem. Questões puladas não contam como erro. Os resultados mostram a amostra e a data para você avaliar o contexto.</p>
        <div className="study-report-grid">{track.catalog.subjects.filter(subject => track.config.subjectIds.includes(subject.id)).map(subject => {
          const competencies = track.catalog.competencies.filter(item => item.subjectId === subject.id);
          const subjectEvidence = evidence.filter(item => competencies.some(competency => competency.id === item.competencyId));
          const total = subjectEvidence.reduce((sum, item) => sum + item.sampleSize, 0);
          const correct = subjectEvidence.reduce((sum, item) => sum + item.correctCount, 0);
          return <article className="study-subject-report" key={subject.id}><h3>{subject.name}</h3><p className="study-report-total">{total ? `${correct} acertos em ${total} respostas observadas` : 'Sem respostas observadas nesta matéria'}</p>{competencies.map(competency => {
            const item = evidence.find(result => result.competencyId === competency.id)!;
            return <div className="study-evidence" key={competency.id}><div><strong>{competency.title}</strong><span className={`study-status ${item.status}`}>{evidenceLabels[item.status]}</span></div><p>{item.explanation}</p><small>Amostra: {item.sampleSize} {item.sampleSize === 1 ? 'resposta' : 'respostas'} · {item.correctCount} {item.correctCount === 1 ? 'acerto' : 'acertos'}{item.lastAnsweredAt ? <> · Última resposta: <time dateTime={item.lastAnsweredAt}>{dateLabel(item.lastAnsweredAt)}</time></> : ' · Sem data de resposta'}</small></div>;
          })}</article>;
        })}</div>
      </section>
      <section className="study-units" aria-labelledby="study-units-title"><div className="section-heading"><h2 id="study-units-title"><BookOpen size={19} />Conteúdos e materiais</h2><span className="section-hint">Conecte o que já está na sua biblioteca</span></div><div className="study-unit-grid">{selectedUnits.map(unit => {
        const binding = track.config.bindings.find(item => item.unitId === unit.id);
        const subject = data.subjects.find(item => item.id === binding?.subjectId);
        const notes = data.notes.filter(note => binding?.noteIds.includes(note.id));
        const state = evidence.find(item => item.competencyId === unit.competencyId)!;
        return <article className="study-unit" key={unit.id}><span className={`study-status ${state.status}`}>{evidenceLabels[state.status]}</span><h3>{unit.title}</h3><p>{unit.summary}</p><small>Base sugerida: {unit.prerequisites.length ? unit.prerequisites.map(id => track.catalog.units.find(item => item.id === id)!.title).join('; ') : 'Nenhum pré-requisito neste catálogo'}</small><div className="study-unit-materials">{subject ? <><button className="text-button" onClick={() => onOpenSubject(subject)}><BookOpen size={15} />{subject.name}</button>{notes.map(note => <button className="study-note-link" key={note.id} onClick={() => onOpenNote(note)}>{note.title}<ArrowRight size={14} /></button>)}</> : <p>Nenhum material vinculado.</p>}</div><button className="button secondary small" onClick={() => setBindingUnitId(unit.id)} disabled={busy}><Link2 size={14} />{binding ? 'Editar materiais' : 'Vincular materiais'}</button></article>;
      })}</div></section>
      <footer className="study-catalog-source">Catálogo: {track.catalog.id} · versão {track.catalog.version} · Origem: {track.catalog.origin} · Licença: {track.catalog.license}. Seu diagnóstico e sua configuração ficam no espaço local e nos seus backups; não fazem parte do conteúdo do catálogo.</footer>
    </>}
    {editing && <TrackForm key={editing === 'current' ? track.id : 'new'} catalog={editing === 'current' ? track.catalog : DEMO_CATALOG} config={editing === 'current' ? track.config : defaultConfig()} busy={busy} onClose={() => setEditing(null)} onSubmit={async config => { if (editing === 'current') await update(config); else await save({ catalog: DEMO_CATALOG, config, diagnostics: [] }); setEditing(null); }} />}
    {track && bindingUnit && <MaterialBinding unitTitle={bindingUnit.title} subjects={data.subjects} notes={data.notes} initial={track.config.bindings.find(item => item.unitId === bindingUnit.id)} busy={busy} onClose={() => setBindingUnitId(null)} onSubmit={async binding => { await update({ ...track.config, bindings: [...track.config.bindings.filter(item => item.unitId !== bindingUnit.id), ...(binding ? [{ ...binding, unitId: bindingUnit.id }] : [])] }); setBindingUnitId(null); }} />}
  </div>;
}

function TrackForm({ catalog, config, busy, onClose, onSubmit }: { catalog: StudyCatalog; config: TrackConfig; busy: boolean; onClose: () => void; onSubmit: (config: TrackConfig) => Promise<void> }) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => formRef.current?.querySelector('input')?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  const [draft, setDraft] = useState<TrackConfig>(() => structuredClone(config));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof TrackConfig>(key: K, value: TrackConfig[K]) => setDraft(current => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(null);
    if (!draft.subjectIds.length) { setError('Selecione ao menos uma matéria para a trilha.'); return; }
    try { await onSubmit({ ...draft, name: draft.name.trim(), objective: draft.objective.trim() }); }
    catch (cause) { setError(messageFrom(cause)); }
  };
  return <Modal title="Configurar trilha" description="Defina seu ponto de partida e preferências. Você pode ajustar tudo depois." className="study-config-modal" onClose={onClose} busy={busy}><form ref={formRef} onSubmit={event => void submit(event)}>
    <fieldset className="study-form-fields" disabled={busy}>
      <div className="study-form-grid"><label className="study-field">Nome da trilha<input className="input" value={draft.name} onChange={event => set('name', event.target.value)} required maxLength={120} autoFocus /></label><label className="study-field">Objetivo final<input className="input" value={draft.objective} onChange={event => set('objective', event.target.value)} required maxLength={200} /></label><label className="study-field">Ano escolar de partida<select className="input" value={draft.startingYear} onChange={event => set('startingYear', event.target.value as TrackConfig['startingYear'])}>{Object.entries(yearLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><small>Ajuda a contextualizar; o diagnóstico observa sua base real.</small></label><label className="study-field">Data da prova (opcional)<input className="input" type="date" value={draft.examDate ?? ''} onChange={event => set('examDate', event.target.value || null)} min="2000-01-01" max="2100-12-31" /></label></div>
      <fieldset className="study-subject-fields"><legend>Matérias e dificuldades percebidas</legend><p className="study-small-note">A dificuldade é sua percepção inicial, sem substituir as respostas do diagnóstico.</p>{catalog.subjects.map(subject => {
        const checked = draft.subjectIds.includes(subject.id);
        return <div className="study-subject-choice" key={subject.id}><label><input type="checkbox" checked={checked} onChange={event => { const subjectIds = event.target.checked ? [...draft.subjectIds, subject.id] : draft.subjectIds.filter(id => id !== subject.id); setDraft(current => ({ ...current, subjectIds, bindings: current.bindings.filter(binding => subjectIds.includes(catalog.competencies.find(competency => competency.id === catalog.units.find(unit => unit.id === binding.unitId)?.competencyId)?.subjectId ?? '')), difficulties: current.difficulties.filter(item => subjectIds.includes(item.subjectId)).concat(event.target.checked && !current.difficulties.some(item => item.subjectId === subject.id) ? [{ subjectId: subject.id, level: 'unknown' as const }] : []) })); }} />{subject.name}</label><label className="study-field"><span className="sr-only">Dificuldade em {subject.name}</span><select className="input" aria-label={`Dificuldade em ${subject.name}`} disabled={!checked} value={draft.difficulties.find(item => item.subjectId === subject.id)?.level ?? 'unknown'} onChange={event => set('difficulties', [...draft.difficulties.filter(item => item.subjectId !== subject.id), { subjectId: subject.id, level: event.target.value as TrackConfig['difficulties'][number]['level'] }])}><option value="unknown">Ainda não sei</option><option value="low">Pouca dificuldade</option><option value="medium">Dificuldade moderada</option><option value="high">Muita dificuldade</option></select></label></div>;
      })}<p className="study-small-note">Retirar uma matéria remove os vínculos dela nesta trilha ao salvar. Seus materiais continuam na biblioteca e o histórico do diagnóstico é preservado.</p></fieldset>
      <div className="study-form-grid"><label className="study-field">Disponibilidade semanal (minutos)<input className="input" type="number" min={30} max={5040} step={1} required value={draft.weeklyMinutes} onChange={event => set('weeklyMinutes', event.target.valueAsNumber)} /><small>Tempo total na semana, incluindo pausas e revisões.</small></label><label className="study-field">Intensidade<select className="input" value={draft.intensity} onChange={event => set('intensity', event.target.value as TrackConfig['intensity'])}><option value="light">Leve</option><option value="balanced">Equilibrada</option><option value="intensive">Intensiva</option></select></label><label className="study-field">Ritmo de progressão<select className="input" value={draft.pace} onChange={event => set('pace', event.target.value as TrackConfig['pace'])}><option value="gradual">Gradual</option><option value="regular">Regular</option><option value="accelerated">Acelerado</option></select></label><label className="study-field">Revisar a cada (dias)<input className="input" type="number" min={1} max={90} step={1} required value={draft.reviewEveryDays} onChange={event => set('reviewEveryDays', event.target.valueAsNumber)} /></label><label className="study-field">Simulado a cada (semanas)<input className="input" type="number" min={1} max={26} step={1} required value={draft.mockEveryWeeks} onChange={event => set('mockEveryWeeks', event.target.valueAsNumber)} /></label></div>
    </fieldset><p className="study-small-note">Esta amostra salva suas preferências e sugere conteúdos. O planner organiza blocos manuais de estudo, revisão e simulado; provas automáticas ficam para uma próxima missão.</p>{error && <ErrorMessage>{error}</ErrorMessage>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" className="button primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar trilha'}<Check size={16} /></button></div>
  </form></Modal>;
}

function DiagnosticPanel({ track, busy, onAttempt }: { track: StudyTrack; busy: boolean; onAttempt: (attempt: DiagnosticAttempt) => Promise<void> }) {
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attempt = track.diagnostics.at(-1);
  const pending = attempt?.questionIds.find(id => !attempt.answers.some(answer => answer.questionId === id));
  const questionId = feedbackId ?? (attempt?.status === 'in-progress' ? pending : null);
  const question = track.catalog.questions.find(item => item.id === questionId);
  const answer = attempt?.answers.find(item => item.questionId === questionId);
  const apply = async (action: () => DiagnosticAttempt, feedback: string | null = null) => {
    setError(null);
    try { await onAttempt(action()); setFeedbackId(feedback); }
    catch (cause) { setError(messageFrom(cause)); }
  };
  const begin = () => void apply(() => startDiagnostic(track, new Date(), crypto.randomUUID()));
  return <section className="study-diagnostic" aria-labelledby="study-diagnostic-title"><span className="study-section-kicker"><ClipboardCheck size={16} />DIAGNÓSTICO OPCIONAL</span><h2 id="study-diagnostic-title">Conheça seu ponto de partida</h2>{error && <ErrorMessage>{error}</ErrorMessage>}
    {question && attempt ? <div className="study-question"><div className="study-question-meta"><span>Questão {attempt.questionIds.indexOf(question.id) + 1} de {attempt.questionIds.length}</span><span>{attempt.answers.length} registradas</span></div><h3>{question.prompt}</h3><fieldset className="study-answers" disabled={busy || !!answer}><legend className="sr-only">Escolha sua resposta</legend>{question.choices.map((choice, index) => <button key={index} className={`study-answer ${answer?.choiceIndex === index ? 'selected' : ''}`} aria-pressed={answer?.choiceIndex === index} onClick={() => void apply(() => answerDiagnostic(track, attempt.id, question.id, index, new Date()), question.id)}><span>{String.fromCharCode(65 + index)}</span>{choice}{answer?.choiceIndex === index && <Check size={16} />}</button>)}{!answer && <button className="text-button muted" onClick={() => void apply(() => answerDiagnostic(track, attempt.id, question.id, null, new Date()), question.id)}>Não sei ainda</button>}</fieldset>{answer && <div className="study-answer-feedback" role="status"><strong>{answer.choiceIndex === null ? 'Tudo bem deixar uma dúvida aberta.' : answer.choiceIndex === question.correctIndex ? 'Resposta correta. Vamos observar mais evidências.' : 'Uma oportunidade para reforçar a base.'}</strong><p>Resposta: {question.choices[question.correctIndex]}. {question.explanation}</p><button className="button soft small" onClick={() => setFeedbackId(null)} disabled={busy}>{attempt.status === 'completed' ? 'Ver resultado' : 'Próxima questão'}<ArrowRight size={15} /></button></div>}{!answer && <><p className="study-small-note">Cada resposta é salva ao clicar. Você pode sair e retomar depois.</p><button className="text-button muted" disabled={busy} onClick={() => void apply(() => skipDiagnostic(track, attempt.id, new Date()))}>Encerrar diagnóstico por agora</button></>}</div> : <><p>{attempt?.status === 'completed' ? 'Diagnóstico concluído. Veja abaixo os sinais por matéria e competência. Eles ajudam a escolher o que reforçar; não comprovam domínio.' : attempt?.status === 'skipped' ? 'Diagnóstico adiado. As respostas já registradas foram preservadas. Sem resposta, a competência continua sem evidência.' : 'Algumas questões curtas ajudam a identificar lacunas. Não vale nota, não é obrigatório e você pode responder “Não sei ainda”.'}</p>{attempt && <small>Última tentativa: {dateLabel(attempt.updatedAt)} · {track.diagnostics.length} {track.diagnostics.length === 1 ? 'tentativa registrada' : 'tentativas registradas'}</small>}<div className="study-actions"><button className="button soft" onClick={begin} disabled={busy}>{attempt?.status === 'skipped' ? 'Retomar diagnóstico' : attempt ? 'Refazer diagnóstico' : 'Iniciar diagnóstico'}<ArrowRight size={16} /></button>{!attempt && <button className="text-button muted" disabled={busy} onClick={() => void apply(() => { const initial = startDiagnostic(track, new Date(), crypto.randomUUID()); return skipDiagnostic({ ...track, diagnostics: [...track.diagnostics, initial] }, initial.id, new Date()); })}>Pular diagnóstico</button>}</div></>}
  </section>;
}

function MaterialBinding({ unitTitle, subjects, notes, initial, busy, onClose, onSubmit }: { unitTitle: string; subjects: Subject[]; notes: Note[]; initial?: TrackConfig['bindings'][number]; busy: boolean; onClose: () => void; onSubmit: (binding: Omit<TrackConfig['bindings'][number], 'unitId'> | null) => Promise<void> }) {
  const [subjectId, setSubjectId] = useState(initial?.subjectId ?? '');
  const [noteIds, setNoteIds] = useState(initial?.noteIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(null); try { await onSubmit(subjectId ? { subjectId, noteIds } : null); } catch (cause) { setError(messageFrom(cause)); } };
  return <Modal title="Vincular materiais" description={unitTitle} onClose={onClose} busy={busy}><form onSubmit={event => void submit(event)}><label className="study-field">Matéria da biblioteca<select className="input" value={subjectId} disabled={busy} onChange={event => { setSubjectId(event.target.value); setNoteIds([]); }}><option value="">Sem vínculo</option>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>{!subjects.length && <p className="study-small-note">Crie uma matéria na biblioteca e volte para vinculá-la aqui. A trilha não cria cópias dos seus materiais.</p>}{subjectId && <fieldset className="study-material-notes" disabled={busy}><legend>Notas desta matéria (opcional)</legend>{notes.filter(note => note.subjectId === subjectId).map(note => <label key={note.id}><input type="checkbox" checked={noteIds.includes(note.id)} onChange={event => setNoteIds(current => event.target.checked ? [...current, note.id] : current.filter(id => id !== note.id))} />{note.title}</label>)}{!notes.some(note => note.subjectId === subjectId) && <p>Esta matéria ainda não tem notas. Você pode vinculá-las depois.</p>}</fieldset>}{error && <ErrorMessage>{error}</ErrorMessage>}<div className="modal-actions"><button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="button primary" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar vínculo'}<Link2 size={16} /></button></div></form></Modal>;
}
