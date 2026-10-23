import { useMemo, useState } from 'react';
import { ArrowRight, BookOpenCheck, RefreshCw } from 'lucide-react';
import { createProgressIndex, selectSubjectProgress, type ProgressPeriod } from '../../domain/progress/selectors';
import type { Snapshot } from '../../shared/types';
import './progress.css';

const dateLabel = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(value));
const referenceLabel = (date: Date) => new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
}).format(date);
const ratingLabels = { 1: 'Errei', 2: 'Difícil', 3: 'Bom', 4: 'Fácil' } as const;
const evidenceLabels = { unknown: 'Ainda sem evidência', 'needs-practice': 'Reforçar a base', 'initial-evidence': 'Evidência inicial', 'review-due': 'Rever a evidência' };

export function SubjectProgress({ data, subjectId, onReview, onNotebook, onTrack, initialPeriod = 'week', onPeriodChange }: {
  initialPeriod?: ProgressPeriod; onPeriodChange?: (period:ProgressPeriod)=>void;
  data: Snapshot; subjectId: string; onReview: () => void; onNotebook: () => void; onTrack: (trackId: string) => void;
}) {
  const [period, setPeriod] = useState<ProgressPeriod>(initialPeriod);
  const [reference, setReference] = useState(() => new Date());
  const [refreshed, setRefreshed] = useState(false);
  const index = useMemo(() => createProgressIndex(data), [data]);
  const summary = useMemo(() => selectSubjectProgress(index, subjectId, period, reference), [index, subjectId, period, reference]);
  if (!summary.subject) return <p className="progress-help">Esta matéria não está disponível. Volte à biblioteca para escolher outra.</p>;
  return <div className="subject-progress">
    <div className="progress-heading"><div><h2>Seu progresso na matéria</h2><p>Veja sua atividade e escolha o que retomar.</p></div>
      <label className="progress-period">Período de atividade<select className="input" value={period} onChange={event => { const next = event.target.value as ProgressPeriod; setPeriod(next); onPeriodChange?.(next); }}><option value="week">Últimos 7 dias</option><option value="all">Todo o histórico</option></select></label>
    </div>
    <div className="progress-reference"><p>{summary.window.startsAt ? `De ${dateLabel(summary.window.startsAt)} até a referência abaixo.` : 'Todo o histórico até a referência abaixo.'}<br /><span>Referência: <time dateTime={reference.toISOString()}>{referenceLabel(reference)}</time> · Datas no horário deste dispositivo.</span></p><button className="button secondary small" onClick={() => { setReference(new Date()); setRefreshed(true); }}><RefreshCw size={14} />Atualizar referência</button></div>
    <span className="sr-only" role="status">{refreshed ? `Referência atualizada: ${referenceLabel(reference)}.` : ''}</span>
    {!summary.hasPeriodActivity && <p className="progress-empty"><BookOpenCheck size={20} />Ainda sem atividade registrada neste período. Você pode revisar um cartão ou registrar algo para retomar no caderno.</p>}
    <section className="progress-section" aria-labelledby="progress-activity-heading"><div className="progress-section-heading"><h3 id="progress-activity-heading">Atividade no período</h3><button className="text-button" disabled={!summary.cards.total} onClick={onReview}>Revisar cartões<ArrowRight size={14} /></button></div>
      <dl className="progress-metrics"><div><dt>Respostas em flashcards</dt><dd data-testid="progress-review-answers">{summary.reviews.answers}</dd></div><div><dt>Sessões de revisão</dt><dd data-testid="progress-review-sessions">{summary.reviews.sessions}</dd></div><div><dt>Cartões distintos revisados</dt><dd>{summary.reviews.distinctCards}</dd></div><div><dt>Novos registros de erro</dt><dd>{summary.errors.createdInPeriod}</dd></div><div><dt>Práticas anotadas no caderno</dt><dd data-testid="progress-notebook-practices">{summary.errors.practicesInPeriod}</dd></div></dl>
      <p className="progress-help">Uma sessão pode conter várias respostas. As práticas anotadas são registros manuais; avaliações vinculadas a erros aparecem apenas uma vez no histórico dos flashcards.</p>
      <details className="progress-ratings"><summary>Autoavaliações das {summary.reviews.answers} respostas em flashcards</summary><dl>{([1, 2, 3, 4] as const).map(rating => <div key={rating}><dt>{ratingLabels[rating]}</dt><dd>{summary.reviews.ratings[rating]}</dd></div>)}</dl><p className="progress-help">Essas avaliações descrevem sua lembrança naquele momento. Não são nota de prova nem porcentagem de domínio.</p></details>
    </section>
    <section className="progress-section" aria-labelledby="progress-current-heading"><div className="progress-section-heading"><h3 id="progress-current-heading">Estado atual</h3><button className="text-button" onClick={onNotebook}>Abrir caderno desta matéria<ArrowRight size={14} /></button></div>
      <p className="progress-help">O filtro de período acima não altera os totais abaixo. Vencimentos calculados para a referência exibida.</p>
      <dl className="progress-metrics"><div><dt>Flashcards na matéria</dt><dd>{summary.cards.total}</dd></div><div><dt>Revisões espaçadas vencidas</dt><dd data-testid="progress-cards-due">{summary.cards.due}</dd></div><div><dt>Revisões com data futura</dt><dd>{summary.cards.upcoming}</dd></div><div><dt>Cartões sem agenda espaçada</dt><dd>{summary.cards.unscheduled}</dd></div><div><dt>Erros abertos</dt><dd data-testid="progress-errors-open">{summary.errors.open}</dd></div><div><dt>Erros resolvidos</dt><dd data-testid="progress-errors-resolved">{summary.errors.resolved}</dd></div></dl>
      <p className="progress-help">Resolver um erro registra sua decisão de encerrá-lo. Isso não altera a agenda de revisão nem comprova domínio.</p>
    </section>
    <section className="progress-section" aria-labelledby="progress-diagnostics-heading"><h3 id="progress-diagnostics-heading">Competências nas trilhas vinculadas</h3>
      <p className="progress-help">Somente vínculos explícitos entre unidades da trilha e esta matéria aparecem aqui. Os sinais usam o histórico do diagnóstico até a referência; a amostra é indicada por competência.</p>
      {!summary.diagnostics.length ? <p className="progress-help">Nenhuma unidade de trilha está vinculada a esta matéria. Você pode criar o vínculo na tela de trilhas, em “Vincular materiais”.</p> : summary.diagnostics.map(diagnostic => <article className="progress-track" key={diagnostic.trackId}><div className="progress-section-heading"><h4>{diagnostic.trackName}</h4><button className="text-button" onClick={() => onTrack(diagnostic.trackId)}>Abrir trilha<ArrowRight size={14} /></button></div><p className="progress-help">No período: {diagnostic.answersInPeriod} respostas registradas em {diagnostic.distinctQuestionsInPeriod} questões distintas, incluindo {diagnostic.unknownAnswersInPeriod} respostas “Não sei ainda”.</p><ul className="progress-competencies">{diagnostic.competencies.map(competency => <li key={competency.competencyId}><div><strong>{competency.title}</strong><span className="progress-evidence">{evidenceLabels[competency.status]}</span></div><p>{competency.explanation}</p><small>Última resposta considerada: {competency.lastAnsweredAt ? dateLabel(competency.lastAnsweredAt) : 'nenhuma'}.</small></li>)}</ul></article>)}
    </section>
  </div>;
}
