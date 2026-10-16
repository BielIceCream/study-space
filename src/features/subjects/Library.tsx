import { ArrowRight, ArrowUpRight, BookOpen, Check, FileText, Layers2, Plus, Sprout, Sparkles, Clock3 } from 'lucide-react';
import type { Note, Snapshot, Subject } from '../../shared/types';
import { isToday, plural, shortDate } from '../../shared/utils';

export function Library({ data, onCreateSubject, onOpenSubject, onOpenNote, onReview }: {
  data: Snapshot; onCreateSubject: () => void; onOpenSubject: (subject: Subject) => void; onOpenNote: (note: Note) => void; onReview: () => void;
}) {
  const recent = [...data.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);
  const todayReviews = data.reviewLogs.filter(log => isToday(log.reviewedAt)).length;
  return <div className="library-page page-enter">
    <div className="page-heading"><div><div className="eyebrow">UM POUCO A CADA DIA</div><h1>Seu espaço, seu ritmo<span className="heading-dot">.</span></h1><p>Organize o que você aprende. Dê espaço para suas ideias.</p></div><button className="button primary" onClick={onCreateSubject}><Plus size={17} />Nova matéria</button></div>
    <section className="welcome-banner">
      <div className="banner-copy"><span className="banner-kicker"><Sparkles size={15} />CONSTRUA SEU CONHECIMENTO</span><h2>Grandes descobertas<br />começam com uma nota.</h2><p>Da primeira ideia àquela resposta que você<br className="desktop-break" /> nunca mais esquece. Está tudo aqui.</p><button className="banner-link" onClick={data.subjects.length ? () => onOpenSubject(data.subjects[0]) : onCreateSubject}>{data.subjects.length ? 'Continuar estudando' : 'Criar minha primeira matéria'}<ArrowRight size={17} /></button></div>
      <div className="study-illustration" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="illus-spark one">✧</div><div className="illus-spark two">✧</div><div className="illus-dot" /><div className="illus-card back"><span /><span /><span /></div><div className="illus-card front"><div className="illus-book"><BookOpen size={35} strokeWidth={1.35} /></div><div className="illus-line long" /><div className="illus-line" /><div className="illus-line short" /></div><div className="illus-badge"><Check size={18} /></div><div className="illus-leaf"><Sprout size={38} strokeWidth={1.3} /></div></div>
    </section>
    <div className="library-facts"><div><span className="fact-icon lavender"><BookOpen size={18} /></span><strong>{data.subjects.length}</strong><span>{data.subjects.length === 1 ? 'matéria no seu espaço' : 'matérias no seu espaço'}</span></div><div><span className="fact-icon blue"><Layers2 size={18} /></span><strong>{data.flashcards.length}</strong><span>{data.flashcards.length === 1 ? 'cartão para praticar' : 'cartões para praticar'}</span></div><div><span className="fact-icon green"><Check size={18} /></span><strong>{todayReviews}</strong><span>{todayReviews === 1 ? 'revisão hoje' : 'revisões hoje'}</span></div></div>
    <section className="subjects-section"><div className="section-heading"><h2>Suas matérias <span className="count-badge">{data.subjects.length}</span></h2><span className="section-hint">Um lugar para cada curiosidade</span></div>
      <div className="subject-grid">{data.subjects.map(subject => {
        const notes = data.notes.filter(note => note.subjectId === subject.id).length;
        const cards = data.flashcards.filter(card => card.subjectId === subject.id).length;
        return <button className={`subject-card accent-${subject.accent}`} key={subject.id} onClick={() => onOpenSubject(subject)}><div className="subject-card-top"><span className="subject-icon"><BookOpen size={23} strokeWidth={1.5} /></span><ArrowUpRight size={18} className="card-arrow" /></div><h3>{subject.name}</h3><div className="subject-card-meta"><span><FileText size={13} />{plural(notes, 'nota')}</span><span><Layers2 size={13} />{plural(cards, 'cartão', 'cartões')}</span></div></button>;
      })}<button className="new-subject-card" onClick={onCreateSubject}><span><Plus size={24} strokeWidth={1.5} /></span><strong>{data.subjects.length ? 'Nova matéria' : 'Sua primeira matéria'}</strong><small>{data.subjects.length ? 'Mais espaço para aprender' : 'Comece com o que você quer aprender'}</small></button></div>
    </section>
    <div className="library-bottom"><section className="recent-section"><div className="section-heading"><h2><Clock3 size={17} />Continue de onde parou</h2></div>{recent.length ? <div className="recent-list">{recent.map(note => {
      const subject = data.subjects.find(item => item.id === note.subjectId)!;
      return <button className="recent-note" key={note.id} onClick={() => onOpenNote(note)}><span className={`recent-note-icon accent-${subject.accent}`}><FileText size={18} /></span><span className="recent-note-copy"><strong>{note.title}</strong><small>{subject.name}</small></span><time dateTime={note.updatedAt}>{shortDate(note.updatedAt)}</time><ArrowUpRight size={15} /></button>;
    })}</div> : <div className="recent-empty"><FileText size={21} strokeWidth={1.5} /><p>Suas notas mais recentes vão aparecer aqui.</p></div>}</section>
      <section className="practice-callout"><span className="practice-icon"><Layers2 size={22} strokeWidth={1.5} /></span><h3>Aprender. Lembrar. Repetir.</h3><p>{data.flashcards.length ? `${plural(data.flashcards.length, 'cartão', 'cartões')} esperando um momento da sua atenção.` : 'Transforme suas notas em perguntas e exercite sua memória.'}</p><button className="text-button" onClick={data.flashcards.length ? onReview : data.subjects.length ? () => onOpenSubject(data.subjects[0]) : onCreateSubject}>{data.flashcards.length ? 'Começar uma revisão' : 'Preparar meus estudos'}<ArrowRight size={16} /></button></section>
    </div>
  </div>;
}
