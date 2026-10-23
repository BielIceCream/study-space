import { useState, type FormEvent } from 'react';
import { ArrowRight, CalendarDays, Check, Clock3, Pin, RotateCcw, Settings2 } from 'lucide-react';
import { acceptPreview, buildPreview, completeBlock, defaultPlannerConfig, plannerClock, toggleFixed, undoPreview, weekStartFor } from '../../domain/planner/engine';
import type { PlannerBlock, PlannerConfig, PlannerPreview, SaveStudyPlannerInput, StudyPlanner } from '../../domain/planner/types';
import type { StudyTrack } from '../../domain/study/types';
import type { Snapshot } from '../../shared/types';
import { ErrorMessage } from '../../shared/ui';
import { messageFrom } from '../../shared/utils';
import './planner.css';

export const blockLabels: Record<PlannerBlock['kind'], string> = { learn: 'Aprendizagem', practice: 'Prática', review: 'Revisão', mock: 'Simulado manual' };
export const slotTime = (minute: number) => `${Math.floor(minute / 60).toString().padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`;
export const civilDate = (date: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', weekday: 'short' }).format(new Date(`${date}T12:00:00Z`));
export const blockTitle = (track: StudyTrack | undefined, block: PlannerBlock) => block.unitId ? track?.catalog.units.find(unit => unit.id === block.unitId)?.title ?? 'Conteúdo da trilha' : 'Simulado manual';
const dayNames = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const totalMinutes = (blocks: PlannerBlock[]) => blocks.reduce((total, block) => total + block.minutes + block.breakMinutes, 0);

export function PlannerPage({ data, initialTrackId, onSave, onOpenTrack, onReview, onPractice }: {
  data: Snapshot; initialTrackId?: string;
  onSave: (input: SaveStudyPlannerInput) => Promise<StudyPlanner>;
  onOpenTrack: (trackId?: string) => void;
  onReview?: (trackId: string, blockId: string) => void;
  onPractice?: (trackId: string, blockId: string) => void;
}) {
  const [selected, setSelected] = useState(initialTrackId ?? '');
  const tracks = data.studyTracks ?? [];
  const track = tracks.find(item => item.id === selected) ?? tracks[0];
  return <div className="planner-page page-enter">
    <div className="page-heading"><div><div className="eyebrow">TEMPO PARA APRENDER</div><h1>Planner semanal<span className="heading-dot">.</span></h1><p>Sua semana, com espaço para respirar.</p></div></div>
    <div className="planner-notice"><CalendarDays size={21} /><p>Organize uma semana de cada vez. A prévia usa seus pré-requisitos, respostas e tempo disponível. Você decide quando aceitar; nenhum compromisso é criado automaticamente.</p></div>
    {!track ? <section className="planner-empty"><CalendarDays size={32} /><h2>Comece pelo seu objetivo</h2><p>Configure uma trilha para escolher os conteúdos e seu tempo semanal. O diagnóstico é opcional.</p><button className="button primary" onClick={() => onOpenTrack()}>Criar minha trilha<ArrowRight size={16} /></button></section> : <>
      <label className="planner-track-select">Trilha do planner<select className="input" value={track.id} onChange={event => setSelected(event.target.value)}>{tracks.map(item => <option key={item.id} value={item.id}>{item.config.name}</option>)}</select></label>
      {tracks.length > 1 && <p className="planner-help">Os horários e o orçamento são organizados por trilha. Confira a soma do tempo e eventuais conflitos se seguir mais de uma.</p>}
      <PlannerWorkspace key={track.id} track={track} planner={data.studyPlanners?.find(item => item.trackId === track.id)} onSave={onSave} onOpenTrack={() => onOpenTrack(track.id)} onReview={onReview} onPractice={onPractice} />
    </>}
  </div>;
}

function PlannerWorkspace({ track, planner, onSave, onOpenTrack, onReview, onPractice }: { track: StudyTrack; planner?: StudyPlanner; onSave: (input: SaveStudyPlannerInput) => Promise<StudyPlanner>; onOpenTrack: () => void; onReview?: (trackId:string,blockId:string) => void; onPractice?: (trackId:string,blockId:string) => void }) {
  const [config, setConfig] = useState<PlannerConfig>(() => structuredClone(planner?.config ?? defaultPlannerConfig(track)));
  const [weekStart, setWeekStart] = useState(() => weekStartFor(plannerClock().date));
  const [preview, setPreview] = useState<PlannerPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [backlogLimit, setBacklogLimit] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(!planner);
  const accepted = planner?.weeks.find(week => week.weekStart === weekStart);
  const configChanged = JSON.stringify(config) !== JSON.stringify(planner?.config ?? defaultPlannerConfig(track));
  const setDraft = (next: PlannerConfig) => { setConfig(next); setPreview(null); setNotice(null); };
  const run = async (action: () => SaveStudyPlannerInput, success: string) => {
    setBusy(true); setError(null); setNotice(null);
    try { await onSave(action()); setPreview(null); setNotice(success); }
    catch (cause) { setError(messageFrom(cause)); }
    finally { setBusy(false); }
  };
  const generate = (event?: FormEvent) => {
    event?.preventDefault(); setError(null); setNotice(null);
    try { setPreview(buildPreview(track, planner, config, weekStart, plannerClock())); }
    catch (cause) { setError(messageFrom(cause)); }
  };
  const displayed = preview?.week ?? accepted;
  const backlog = preview?.backlog ?? planner?.backlog ?? [];
  return <>
    <section className="planner-track-summary"><div><h2>{track.config.name}</h2><p><strong>{track.config.weeklyMinutes} min por semana</strong> para estudo e pausas. O limite semanal vem da trilha.</p></div><button className="button secondary" onClick={onOpenTrack}><Settings2 size={16} />Editar trilha</button></section>
    <form onSubmit={generate} className="planner-config">
      <div className="planner-toolbar"><label>Semana iniciada em<input className="input" type="date" value={weekStart} required disabled={busy} onChange={event => { if (event.target.value) { setWeekStart(weekStartFor(event.target.value)); setPreview(null); setNotice(null); } }} /><small>A semana começa na segunda-feira.</small></label><button className="button secondary" type="button" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(value => !value)}><Settings2 size={16} />Disponibilidade e durações</button></div>
      {settingsOpen && <fieldset className="planner-settings" disabled={busy}><legend>Monte uma semana possível</legend><p>Escolha dias e uma janela por dia. O planner respeita também o total semanal da trilha; ter horas livres não obriga a preencher todas.</p>
        <div className="planner-days">{dayNames.map((name, weekday) => {
          const day = config.days.find(item => item.weekday === weekday);
          const changeDay = (patch: Partial<NonNullable<typeof day>>) => setDraft({ ...config, days: config.days.map(item => item.weekday === weekday ? { ...item, ...patch } : item) });
          return <div className="planner-day" key={name}><label className="planner-day-enabled"><input type="checkbox" checked={!!day} onChange={event => setDraft({ ...config, days: event.target.checked ? [...config.days, { weekday, startMinute: 19 * 60, minutes: 60 }].sort((a, b) => a.weekday - b.weekday) : config.days.filter(item => item.weekday !== weekday) })} />{name}</label><label>Início<span className="sr-only"> de {name}</span><input className="input" aria-label={`Início de ${name}`} type="time" required={!!day} disabled={!day} value={slotTime(day?.startMinute ?? 19 * 60)} onChange={event => { const [hour, minute] = event.target.value.split(':').map(Number); changeDay({ startMinute: hour * 60 + minute }); }} /></label><label>Minutos disponíveis<span className="sr-only"> em {name}</span><input className="input" aria-label={`Minutos disponíveis em ${name}`} type="number" min={30} max={720} step={1} required={!!day} disabled={!day} value={day?.minutes ?? 60} onChange={event => changeDay({ minutes: event.target.valueAsNumber })} /></label></div>;
        })}</div>
        <div className="planner-duration-grid"><NumberField label="Duração do bloco (minutos)" value={config.blockMinutes} min={10} max={120} onChange={blockMinutes => setDraft({ ...config, blockMinutes })} /><NumberField label="Pausa por bloco (minutos)" value={config.breakMinutes} min={0} max={30} onChange={breakMinutes => setDraft({ ...config, breakMinutes })} /><NumberField label="Simulado manual (minutos)" value={config.mockMinutes} min={10} max={240} onChange={mockMinutes => setDraft({ ...config, mockMinutes })} /></div>
        <details className="planner-estimates"><summary>Tempo estimado por conteúdo</summary><p>Estimativas editáveis de estudo, não pesos oficiais do ENEM. Definem o tempo de aprendizagem; prática, revisões, simulados e pausas são reservados à parte.</p><div className="planner-duration-grid">{track.catalog.units.map(unit => <NumberField key={unit.id} label={unit.title} value={config.unitEstimates.find(item => item.unitId === unit.id)?.minutes ?? 50} min={1} max={1440} onChange={minutes => setDraft({ ...config, unitEstimates: [...config.unitEstimates.filter(item => item.unitId !== unit.id), { unitId: unit.id, minutes }] })} />)}</div></details>
      </fieldset>}
      {configChanged && planner && <p className="planner-change-note" role="status">Sua disponibilidade mudou nesta tela. Gere uma nova prévia para ver o efeito. A semana aceita só será alterada quando você aceitar a proposta.</p>}
      <div className="planner-actions"><button className="button primary" type="submit" disabled={busy}><CalendarDays size={16} />{accepted ? 'Replanejar pendências' : 'Gerar prévia semanal'}</button>{planner?.undo && !preview && <button className="button secondary" type="button" disabled={busy} onClick={() => void run(() => undoPreview(planner), 'Última proposta desfeita. O histórico foi preservado.')}><RotateCcw size={16} />Desfazer última proposta</button>}</div>
    </form>
    {error && <ErrorMessage>{error}</ErrorMessage>}{notice && <p className="form-success" role="status">{notice}</p>}
    {preview && <section className="planner-preview" aria-label="Prévia da semana"><div><span className="planner-kicker">PRÉVIA · AINDA NÃO SALVA</span><h2>Confira antes de aceitar</h2><p>{preview.movedCount} {preview.movedCount === 1 ? 'pendência realocada' : 'pendências realocadas'} · {preview.unallocatedMinutes} min de conteúdo ainda sem espaço nesta proposta.</p></div>{preview.warnings.length > 0 && <ul className="planner-warnings">{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}<p>Conclusões e blocos fixos são preservados. O restante que não couber continua pendente; o planner não acumula tudo no dia seguinte.</p><div className="planner-actions"><button className="button primary" disabled={busy || !preview.canAccept} onClick={() => void run(() => acceptPreview(track.id, planner, config, preview), 'Semana aceita. Sua agenda foi salva localmente.')}><Check size={16} />Aceitar semana</button><button className="button secondary" disabled={busy} onClick={() => setPreview(null)}>Cancelar prévia</button></div></section>}
    {displayed ? <section className="planner-agenda" aria-label={preview ? 'Blocos propostos' : 'Semana aceita'}><div className="planner-agenda-heading"><div><span className="planner-kicker">{preview ? 'COMO A SEMANA FICARIA' : 'SUA SEMANA ACEITA'}</span><h2>Semana de {civilDate(displayed.weekStart)}</h2></div><span className="planner-time-total"><Clock3 size={16} />{totalMinutes(displayed.blocks)} / {displayed.budgetMinutes} min, com pausas</span></div><p className="planner-help">Concluir registra uma atividade, sem marcar domínio do conteúdo. Abra os cartões a partir dos blocos de revisão. Responder cartões não conclui o bloco; concluir o bloco não avalia cartões. Simulados oferecem roteiros em notas para resposta e autocorreção manual.</p>{displayed.blocks.length ? <div className="planner-agenda-days">{[...new Set(displayed.blocks.map(block => block.date))].sort().map(date => <div className="planner-agenda-day" key={date}><h3><time dateTime={date}>{civilDate(date)}</time></h3>{displayed.blocks.filter(block => block.date === date).sort((a, b) => a.startMinute - b.startMinute).map(block => <article className={`planner-block ${block.status}`} key={block.id}><div className="planner-block-time"><strong>{slotTime(block.startMinute)}</strong><span>{block.minutes} min{block.breakMinutes > 0 && ` + ${block.breakMinutes} de pausa`}</span></div><div className="planner-block-copy"><span className="planner-block-kind">{blockLabels[block.kind]}{block.fixed && ' · Fixo'}{block.status === 'completed' && ' · Concluído'}</span><h4>{blockTitle(track, block)}</h4><p>{block.reason}</p></div>{!preview && planner && <div className="planner-block-actions">{block.status === 'pending' ? <>{block.kind === 'mock' && onPractice && <button className="button primary small" disabled={busy} onClick={() => onPractice(track.id, block.id)}>Preparar atividade</button>}{block.kind === 'review' && onReview && <button className="button primary small" disabled={busy} onClick={() => onReview(track.id, block.id)}>Revisar cartões</button>}<button className="button soft small" disabled={busy} aria-label={`Concluir ${blockLabels[block.kind]} de ${civilDate(block.date)} às ${slotTime(block.startMinute)}`} onClick={() => void run(() => completeBlock(planner, block.id, new Date().toISOString()), 'Atividade concluída. O histórico foi preservado.')}><Check size={14} />Concluir</button><button className={`button secondary small ${block.fixed ? 'is-fixed' : ''}`} aria-pressed={block.fixed} aria-label={`${block.fixed ? 'Desfixar' : 'Fixar'} bloco de ${civilDate(block.date)} às ${slotTime(block.startMinute)}`} disabled={busy} onClick={() => void run(() => toggleFixed(planner, block.id), block.fixed ? 'Bloco liberado para replanejamento.' : 'Horário fixado. Novas propostas preservarão este bloco.')}><Pin size={14} />{block.fixed ? 'Desfixar' : 'Fixar'}</button></> : <span className="planner-completed"><Check size={15} />Concluído</span>}</div>}</article>)}</div>)}</div> : <p className="planner-empty-week">Nenhum bloco nesta semana. Ajuste os dias, o tempo disponível ou escolha a próxima semana para gerar uma prévia.</p>}</section> : <section className="planner-empty-week"><CalendarDays size={25} /><h2>Visualize antes de se comprometer</h2><p>Gere uma prévia para distribuir conteúdos e pausas sem ultrapassar seu tempo. Você pode cancelar e ajustar quantas vezes precisar.</p></section>}
    {backlog.length > 0 && <section className="planner-backlog" aria-label="Pendentes sem horário"><h2>Pendentes sem horário</h2><p>{totalMinutes(backlog)} min, incluindo pausas, aguardam espaço. Esta fila não ocupa o seu dia. Uma nova prévia tenta acomodá-la sem ultrapassar seus limites.</p><ul>{backlog.slice(0, backlogLimit).map(block => <li key={block.id}><div><strong>{blockTitle(track, block)}</strong><span>{blockLabels[block.kind]} · {block.minutes} min{block.breakMinutes > 0 && ` + ${block.breakMinutes} de pausa`}</span><p>{block.reason}</p></div></li>)}</ul>{backlog.length > backlogLimit && <button className="button secondary" onClick={() => setBacklogLimit(limit => limit + 20)}>Mostrar mais pendências ({backlog.length - backlogLimit})</button>}</section>}
  </>;
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label>{label}<input className="input" type="number" min={min} max={max} required step={1} value={value} onChange={event => onChange(event.target.valueAsNumber)} /></label>;
}
