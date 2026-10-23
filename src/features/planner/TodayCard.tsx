import { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, Check } from 'lucide-react';
import { completeBlock, plannerClock } from '../../domain/planner/engine';
import type { SaveStudyPlannerInput, StudyPlanner } from '../../domain/planner/types';
import type { Snapshot } from '../../shared/types';
import { ErrorMessage } from '../../shared/ui';
import { messageFrom } from '../../shared/utils';
import { blockLabels, blockTitle, civilDate, slotTime } from './PlannerPage';
import './planner.css';

export function TodayCard({ data, onPlanner, onSave }: { data: Snapshot; onPlanner: (trackId?: string) => void; onSave: (input: SaveStudyPlannerInput) => Promise<StudyPlanner> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(timer); }, []);
  const clock = plannerClock(now);
  const waiting = (data.studyPlanners ?? []).reduce((sum, planner) => sum + planner.backlog.length, 0);
  const all = (data.studyPlanners ?? []).flatMap(planner => planner.weeks.flatMap(week => week.blocks.map(block => ({ planner, block, track: data.studyTracks?.find(track => track.id === planner.trackId) }))));
  const pending = all.filter(item => item.block.status === 'pending' && item.block.date <= clock.date).sort((a, b) => a.block.date.localeCompare(b.block.date) || a.block.startMinute - b.block.startMinute || a.planner.trackId.localeCompare(b.planner.trackId));
  const completed = all.filter(item => item.block.status === 'completed' && item.block.completedAt && plannerClock(new Date(item.block.completedAt)).date === clock.date).length;
  const finish = async (planner: StudyPlanner, id: string) => { setBusy(id); setError(null); try { await onSave(completeBlock(planner, id, new Date().toISOString())); } catch (cause) { setError(messageFrom(cause)); } finally { setBusy(null); } };
  return <section className="planner-today" aria-labelledby="today-heading"><div className="planner-today-heading"><div><span className="planner-kicker"><CalendarDays size={15} />UM PASSO POR VEZ</span><h2 id="today-heading">Hoje<span className="heading-dot">.</span></h2><p>{completed} {completed === 1 ? 'atividade concluída' : 'atividades concluídas'} · {pending.length} {pending.length === 1 ? 'pendência para organizar' : 'pendências para organizar'}</p></div><button className="button soft" onClick={() => onPlanner()}>Abrir planner<ArrowRight size={15} /></button></div>{error && <ErrorMessage>{error}</ErrorMessage>}{pending.length ? <><div className="planner-today-list">{pending.slice(0, 4).map(({ planner, block, track }) => <article key={`${planner.trackId}:${block.id}`} className="planner-today-item"><div><small>{block.date < clock.date ? `Pendente de ${civilDate(block.date)}` : slotTime(block.startMinute)} · {blockLabels[block.kind]} · {block.minutes} min</small><button className="planner-today-title" onClick={() => onPlanner(planner.trackId)}>{blockTitle(track, block)}</button><span>{track?.config.name ?? 'Trilha'}{block.fixed ? ' · Horário fixo' : ''}</span></div><button className="button secondary small" aria-label={`Concluir atividade ${blockTitle(track, block)} de ${civilDate(block.date)}`} disabled={busy !== null} onClick={() => void finish(planner, block.id)}><Check size={15} />{busy === block.id ? 'Salvando…' : 'Concluir'}</button></article>)}</div>{pending.length > 4 && <p className="planner-help">Mais {pending.length - 4} pendências no planner. Replanejar gera uma proposta para você conferir; não sobrecarrega automaticamente seu dia.</p>}</> : <p className="planner-today-empty">{data.studyPlanners?.length ? 'Seu dia está livre de pendências agendadas. Use o planner para consultar as próximas atividades.' : 'Escolha uma trilha e aceite uma prévia semanal para trazer seus próximos passos para cá.'}</p>}{waiting > 0 && <p className="planner-help">{waiting} {waiting === 1 ? 'bloco aguarda' : 'blocos aguardam'} espaço na fila sem horário. Use o planner para distribuir conforme sua disponibilidade.</p>}</section>;
}
