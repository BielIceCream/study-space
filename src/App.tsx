import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ArrowLeftToLine, ArrowRightFromLine, BookOpen, CalendarDays, Check, ChevronRight, CircleHelp, ClipboardList, HardDrive, Layers2, LibraryBig, Moon, Plus, Route, Search, Sparkles, Sun, Upload, X } from 'lucide-react';
import type { DocumentMetadata, Flashcard, Note, StorageService, Subject } from './shared/types';
import type { JarvisAction } from './services/jarvis/types';
import type { ImportBatchInput } from './services/import/types';
import type { JarvisStudyRequest } from './features/jarvis/JarvisPanel';
import { messageFrom } from './shared/utils';
import { useWorkspace } from './services/use-workspace';
import { downloadBackup } from './services/backup-files';
import { isBackupArchive } from './services/backup-archive';
import { Library } from './features/subjects/Library';
import { SubjectModal } from './features/subjects/SubjectModal';
import { SubjectWorkspace } from './features/subjects/SubjectWorkspace';
import { CardLibrary } from './features/flashcards/CardLibrary';
import { CardModal } from './features/flashcards/CardModal';
import { Review } from './features/flashcards/Review';
import type { ReviewPlannerContext } from './features/flashcards/Review';
import type { ReviewMode } from './domain/spaced-repetition/queue';
import { NotebookPage } from './features/error-notebook/NotebookPage';
import type { ErrorDraft } from './domain/error-notebook/types';
import { SearchModal } from './features/search/SearchModal';
import { BackupModal } from './features/settings/BackupModal';
import { RecoveryCopies } from './features/settings/RecoveryCopies';
import { Modal } from './shared/ui';
import { StudyPage } from './features/study/StudyPage';
import { PlannerPage } from './features/planner/PlannerPage';
import type { SaveStudyPlannerInput } from './domain/planner/types';

const JarvisPanel = lazy(() => import('./features/jarvis/JarvisPanel').then(m=>({default:m.JarvisPanel})));
const ImportModal = lazy(() => import('./features/import/ImportModal').then(m=>({default:m.ImportModal})));
const DocumentReader = lazy(() => import('./features/documents/DocumentReader').then(m=>({default:m.DocumentReader})));
const PracticePage = lazy(() => import('./features/practice/PracticePage').then(m=>({default:m.PracticePage})));

type View = { kind: 'library' } | { kind: 'study'; trackId?: string } | { kind: 'planner'; trackId?: string } | { kind: 'practice'; context?: {trackId:string;blockId:string} } | { kind:'notebook';subjectId?:string;entryId?:string;draft?:ErrorDraft } | { kind: 'subject'; subjectId: string; tab: 'notes' | 'cards' | 'progress'; noteId?: string } | { kind: 'cards' } | { kind: 'review'; subjectId?: string; cardId?:string;notebookEntryId?:string;progressSubjectId?:string;mode?: ReviewMode; plannerContext?: ReviewPlannerContext };
type Dialog = { kind: 'subject'; subject?: Subject } | { kind: 'card'; card?: Flashcard; note?: Note; selected?: string; subjectId?: string } | { kind: 'search' } | { kind: 'backup' } | { kind: 'help' } | {kind:'import';batch?:ImportBatchInput} | {kind:'document';document:DocumentMetadata} | null;

export default function App({ storage }: { storage: StorageService }) {
  const workspace = useWorkspace(storage);
  const { data } = workspace;
  const [view, setView] = useState<View>({ kind: 'library' });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [activeCard,setActiveCard] = useState<Flashcard|null>(null);
  const [reviewToken,setReviewToken] = useState<string>();
  const [studyRequest,setStudyRequest] = useState<JarvisStudyRequest>();
  const flushRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const dirtyRef = useRef<() => boolean>(() => false);
  const closing = useRef(false);
  const progressPeriods = useRef(new Map<string, 'week' | 'all'>());
  const notify = useCallback((text: string) => setToast(text), []);
  const listRecoveryCopies = useCallback(() => storage.listRecoveryCopies(), [storage]);
  const exportRecoveryCopy = useCallback(async (id: string) => { downloadBackup(await storage.exportRecoveryCopy(id)); }, [storage]);
  const run = async (action: () => Promise<void>) => { try { await action(); } catch (cause) { notify(messageFrom(cause)); } };
  const savePlanner = async (input: SaveStudyPlannerInput) => {
    try { const planner = await storage.saveStudyPlanner(input); await workspace.reload(); return planner; }
    catch (cause) { await workspace.reload().catch(() => undefined); throw cause; }
  };
  const registerFlush = useCallback((flush: () => Promise<void>, isDirty: () => boolean) => {
    flushRef.current = flush; dirtyRef.current = isDirty;
    return () => { if (flushRef.current === flush) { flushRef.current = () => Promise.resolve(); dirtyRef.current = () => false; } };
  }, []);
  const navigate = useCallback(async (next: View) => {
    try { await flushRef.current(); setReviewToken(undefined); setView(next); setDialog(null); return true; }
    catch (cause) { notify(`Salve a edição antes de sair. ${messageFrom(cause)}`); return false; }
  }, [notify]);
  const openSubject = (subject: Subject) => { void navigate({ kind: 'subject', subjectId: subject.id, tab: 'notes', noteId: data?.notes.find(note => note.subjectId === subject.id)?.id }); };
  const openNote = (note: Note) => { void navigate({ kind: 'subject', subjectId: note.subjectId, tab: 'notes', noteId: note.id }); };
  const openPracticeNote = async (id:string) => {
    const note = data?.notes.find(item=>item.id===id) ?? (await workspace.reload()).notes.find(item=>item.id===id);
    if (!note) throw new Error('A atividade foi salva, mas a nota não está disponível. Recarregue os dados para abri-la.');
    if (!await navigate({kind:'subject',subjectId:note.subjectId,tab:'notes',noteId:note.id})) throw new Error('A atividade foi salva. Termine a edição antes de abrir a nota.');
  };
  const createPractice = async (batch:ImportBatchInput) => {
    const result = await storage.importBatch(batch);
    await workspace.reload().catch(()=>notify('Sua atividade foi salva. Recarregue os dados se ela ainda não aparecer na biblioteca.'));
    return result;
  };
  const reviewNotebookCard = (cardId:string,entryId:string) => {
    const card = data?.flashcards.find(item=>item.id===cardId);
    if (card) void run(async()=>{ if(await navigate({kind:'review',subjectId:card.subjectId,cardId,notebookEntryId:entryId,progressSubjectId:view.kind==='notebook'?view.subjectId:undefined})) setReviewToken(crypto.randomUUID()); });
  };
  const openPlannerReview = (trackId: string, blockId: string) => {
    const track = data?.studyTracks?.find(item => item.id === trackId);
    const block = data?.studyPlanners?.find(item => item.trackId === trackId)?.weeks.flatMap(week => week.blocks).find(item => item.id === blockId);
    if (!track || !block || block.kind !== 'review' || block.status !== 'pending') return;
    const binding = track.config.bindings.find(item => item.unitId === block.unitId);
    const title = track.catalog.units.find(item => item.id === block.unitId)?.title ?? track.config.name;
    void navigate({ kind:'review', subjectId:binding?.subjectId, mode:'spaced', plannerContext:{trackId,title:`Revisão: ${title}`,minutes:block.minutes,unbound:!binding} });
  };
  const openCardModal = (note?: Note, selected?: string, card?: Flashcard) => {
    void run(async () => {
      await flushRef.current();
      if (!data?.subjects.length) { setDialog({ kind: 'subject' }); return; }
      setDialog({ kind: 'card', note, selected, card, subjectId: view.kind === 'subject' ? view.subjectId : undefined });
    });
  };
  const createNote = (subjectId: string) => {
    void run(async () => { await flushRef.current(); const note = await workspace.createNote({ subjectId, title: 'Sem título' }); await navigate({ kind: 'subject', subjectId, tab: 'notes', noteId: note.id }); });
  };
  const jarvisAction = async (action:JarvisAction):Promise<string|void> => {
    if(!data) throw new Error('A biblioteca ainda está abrindo.');
    if(action.name==='open_flashcards'){
      const subject=data.subjects.find(s=>s.id===action.args.subjectId);
      if(!subject) throw new Error('A matéria não existe mais.');
      if(!await navigate({kind:'subject',subjectId:subject.id,tab:'cards'})) throw new Error('Salve a nota antes de navegar.');
      return `Flashcards de ${subject.name} abertos.`;
    }
    if(action.name==='start_review'){
      const subjectId=action.args.subjectId;
      if(subjectId&&!data.subjects.some(s=>s.id===subjectId)) throw new Error('A matéria não existe mais.');
      if(!data.flashcards.some(c=>!subjectId||c.subjectId===subjectId)) throw new Error('Ainda não há cartões para esta revisão.');
      if(!await navigate({kind:'review',subjectId})) throw new Error('Salve a nota antes de começar.');
      setReviewToken(crypto.randomUUID());return 'Revisão iniciada.';
    }
    if(action.name==='read_active_card'){
      if(!activeCard||!data.flashcards.some(c=>c.id===activeCard.id)) throw new Error('Inicie uma revisão para selecionar a primeira pergunta.');
      return activeCard.front;
    }
    if(action.name==='propose_flashcards'){
      if(!data.subjects.some(s=>s.id===action.args.subjectId)) throw new Error('A matéria não existe mais.');
      await flushRef.current();
      const source=studyRequest?.excerpts[0];
      const reference=source?`Fonte: ${source.title} · página ${source.page}`:undefined;
      setDialog({kind:'import',batch:{subjectId:action.args.subjectId,sourceName:'JARVIS',format:'json',notes:[],documents:[],assets:[],warnings:['Confira os cartões sugeridos antes de confirmar. Nenhum cartão foi salvo automaticamente.'],flashcards:action.args.cards.map(c=>({front:c.front,back:reference?`${c.back.slice(0,19500)}\n\n${reference.slice(0,450)}`:c.back,tags:['JARVIS']}))}});
      return 'Prévia dos cartões aberta. Confirme a importação para salvá-los na matéria.';
    }
    if(action.name==='study_feedback'&&(!activeCard||activeCard.id!==action.args.cardId)) throw new Error('O cartão ativo mudou. Peça a avaliação novamente.');
  };

  useEffect(() => {
    if (!data) return;
    document.documentElement.dataset.theme = data.settings.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', data.settings.theme === 'dark' ? '#191921' : '#f8f7fc');
  }, [data?.settings.theme, data]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 6500); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (data && !dialog) setDialog({ kind: 'search' }); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [data, dialog]);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested(async event => {
      if (closing.current) return;
      event.preventDefault();
      try { await flushRef.current(); closing.current = true; await getCurrentWindow().close(); }
      catch (cause) { closing.current = false; notify(`Não foi possível salvar antes de fechar. ${messageFrom(cause)}`); }
    }).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(cause => notify(messageFrom(cause)));
    return () => { disposed = true; unlisten?.(); };
  }, [notify]);

  if (!data) return <div className="startup-screen"><span className="brand-mark"><Sparkles size={25} /></span><h1>StudySpace</h1>{workspace.error ? <><p role="alert">{workspace.error}</p><button className="button primary" onClick={() => void workspace.reload().catch(cause => notify(messageFrom(cause)))}>Tentar abrir novamente</button><RecoveryCopies listCopies={listRecoveryCopies} onExportRecovery={exportRecoveryCopy} /></> : <p role="status">Abrindo seu espaço…</p>}</div>;
  const currentSubject = view.kind === 'subject' ? data.subjects.find(subject => subject.id === view.subjectId) : undefined;
  const currentNote = view.kind === 'subject' && view.tab === 'notes' ? data.notes.find(note => note.id === view.noteId) : undefined;
  const breadcrumb = view.kind === 'library' ? 'Biblioteca' : view.kind === 'study' ? 'Trilhas' : view.kind === 'planner' ? 'Planner' : view.kind === 'practice' ? 'Atividades semanais' : view.kind === 'cards' ? 'Flashcards' : view.kind === 'review' ? 'Revisão' : view.kind === 'notebook' ? 'Caderno de erros' : currentSubject?.name ?? 'Matéria';

  return <><a className="skip-link" href="#main-content">Ir para o conteúdo</a><div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className="sidebar" aria-label="Navegação principal"><button className="brand" onClick={() => void navigate({ kind: 'library' })} aria-label="StudySpace · Abrir biblioteca"><span className="brand-mark"><Sparkles size={24} strokeWidth={1.7} /></span><span className="brand-name">StudySpace<span className="brand-subtitle">APRENDA DO SEU JEITO</span></span></button>
      <button className="sidebar-search" onClick={() => setDialog({ kind: 'search' })} title="Buscar · Ctrl+K"><Search size={17} /><span>Buscar no seu espaço</span><kbd>⌃ K</kbd></button>
      <div className="nav-section-label">ESPAÇO DE ESTUDO</div><nav className="main-nav">
        <button className={`nav-item ${view.kind === 'library' ? 'active' : ''}`} aria-current={view.kind === 'library' ? 'page' : undefined} onClick={() => void navigate({ kind: 'library' })} title="Biblioteca"><LibraryBig size={19} /><span>Biblioteca</span></button>
        <button className={`nav-item ${view.kind === 'study' ? 'active' : ''}`} aria-current={view.kind === 'study' ? 'page' : undefined} onClick={() => void navigate({ kind: 'study' })} title="Trilhas"><Route size={19} /><span>Trilhas</span>{(data.studyTracks?.length ?? 0) > 0 && <small>{data.studyTracks!.length}</small>}</button>
        <button className={`nav-item ${view.kind === 'planner' ? 'active' : ''}`} aria-current={view.kind === 'planner' ? 'page' : undefined} onClick={() => void navigate({ kind: 'planner' })} title="Planner"><CalendarDays size={19} /><span>Planner</span></button>
        <button className={`nav-item ${view.kind === 'cards' ? 'active' : ''}`} aria-current={view.kind === 'cards' ? 'page' : undefined} onClick={() => void navigate({ kind: 'cards' })} title="Flashcards"><Layers2 size={19} /><span>Flashcards</span>{data.flashcards.length > 0 && <small>{data.flashcards.length}</small>}</button>
        <button className={`nav-item ${view.kind === 'review' ? 'active' : ''}`} aria-current={view.kind === 'review' ? 'page' : undefined} onClick={() => void navigate({ kind: 'review' })} title="Revisão"><BookOpen size={19} /><span>Revisão</span></button>
        <button className={`nav-item ${view.kind === 'notebook' ? 'active' : ''}`} aria-label="Caderno de erros" aria-current={view.kind === 'notebook' ? 'page' : undefined} onClick={() => void navigate({ kind: 'notebook' })} title="Caderno de erros"><BookOpen size={19} /><span>Caderno de erros</span></button>
        <button className={`nav-item ${view.kind === 'practice' ? 'active' : ''}`} aria-label="Atividades semanais" aria-current={view.kind === 'practice' ? 'page' : undefined} onClick={() => void navigate({kind:'practice'})} title="Atividades semanais"><ClipboardList size={19} /><span>Atividades semanais</span></button>
      </nav>
      <div className="subjects-nav-heading"><span className="nav-section-label">SUAS MATÉRIAS</span><button className="icon-button" aria-label="Nova matéria na sidebar" onClick={() => setDialog({ kind: 'subject' })}><Plus size={16} /></button></div>
      <nav className="subject-nav" aria-label="Matérias">{data.subjects.map(subject => <button className={`subject-nav-item accent-${subject.accent} ${currentSubject?.id === subject.id ? 'active' : ''}`} key={subject.id} onClick={() => openSubject(subject)} title={subject.name} aria-current={currentSubject?.id === subject.id ? 'page' : undefined}><span className="color-dot" /><span className="subject-nav-name">{subject.name}</span></button>)}{data.subjects.length === 0 && <p className="sidebar-empty">Suas curiosidades merecem<br />um espaço. Crie uma matéria.</p>}</nav>
      <div className="sidebar-bottom"><div className="sidebar-tip"><SproutIcon /><strong>Um pouco a cada dia.</strong><p>Seu conhecimento cresce<br />com você.</p></div><button className="nav-item" onClick={() => void run(async () => { await flushRef.current(); setDialog({ kind: 'backup' }); })} title="Dados e backup"><HardDrive size={18} /><span>Dados e backup</span></button><button className="nav-item" onClick={() => void run(async () => workspace.setTheme(data.settings.theme === 'light' ? 'dark' : 'light'))} title={data.settings.theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'} aria-label={data.settings.theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'}>{data.settings.theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}<span>{data.settings.theme === 'light' ? 'Tema escuro' : 'Tema claro'}</span></button><div className="sidebar-footer"><span className="local-status"><span />Salvo localmente</span><button className="icon-button" onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? 'Expandir sidebar' : 'Recolher sidebar'} aria-expanded={!collapsed}>{collapsed ? <ArrowRightFromLine size={16} /> : <ArrowLeftToLine size={16} />}</button></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumbs"><LibraryBig size={16} /><button onClick={() => void navigate({ kind: 'library' })}>Meu espaço</button><ChevronRight size={13} /><span>{breadcrumb}</span>{currentNote && <><ChevronRight size={13} /><span className="breadcrumb-note">{currentNote.title}</span></>}</div><div className="topbar-actions"><button data-mission-control="import" className="icon-button" aria-label="Importar material" title="Importar material" onClick={() => void run(async () => { await flushRef.current(); setDialog({kind: 'import'}); })}><Upload size={18} /></button><span className="offline-badge"><span />Funciona offline</span><button className="icon-button" aria-label="Ajuda e atalhos" onClick={() => setDialog({ kind: 'help' })}><CircleHelp size={18} /></button><span className="avatar" aria-label="Seu espaço pessoal">EU</span></div></header>
      <main id="main-content" tabIndex={-1}>{view.kind === 'library' && <Library data={data} onCreateSubject={() => setDialog({ kind: 'subject' })} onOpenSubject={openSubject} onOpenNote={openNote} onReview={() => void navigate({ kind: 'review' })} onStudy={() => void navigate({ kind: 'study' })} onPlanner={trackId => void navigate({ kind: 'planner', trackId })} onSavePlanner={savePlanner} />}
        {view.kind === 'study' && <StudyPage key={view.trackId ?? 'study'} initialTrackId={view.trackId} data={data} onSave={async input => { const track = await storage.saveStudyTrack(input); await workspace.reload(); return track; }} onOpenSubject={openSubject} onOpenNote={openNote} onPlanner={trackId => void navigate({ kind: 'planner', trackId })} />}
        {view.kind === 'planner' && <PlannerPage key={view.trackId ?? 'planner'} initialTrackId={view.trackId} data={data} onSave={savePlanner} onOpenTrack={trackId => void navigate({ kind: 'study', trackId })} onReview={openPlannerReview} onPractice={(trackId,blockId)=>void navigate({kind:'practice',context:{trackId,blockId}})} />}
        {view.kind === 'subject' && currentSubject && <SubjectWorkspace data={data} subject={currentSubject} initialProgressPeriod={progressPeriods.current.get(currentSubject.id)} onProgressPeriodChange={period=>{progressPeriods.current.set(currentSubject.id,period);}} notes={data.notes.filter(note => note.subjectId === currentSubject.id)} cards={data.flashcards.filter(card => card.subjectId === currentSubject.id)} noteId={view.noteId} tab={view.tab} onSelectNote={openNote} onTab={tab => void navigate({ ...view, tab })} onNewNote={() => createNote(currentSubject.id)} onEditSubject={() => setDialog({ kind: 'subject', subject: currentSubject })} onSaveNote={workspace.saveNote} onCreateCard={openCardModal} onEditCard={card => openCardModal(undefined, undefined, card)} onReview={() => void navigate({ kind: 'review', subjectId: currentSubject.id, progressSubjectId: view.tab==='progress'?currentSubject.id:undefined })} onNotebook={()=>void navigate({kind:'notebook',subjectId:currentSubject.id})} onTrack={trackId=>void navigate({kind:'study',trackId})} registerFlush={registerFlush} storage={storage} documents={data.documents} cardMetadata={data.cardMetadata} onOpenDocument={document=>setDialog({kind:'document',document})} />}
        {view.kind === 'cards' && <CardLibrary cards={data.flashcards} subjects={data.subjects} notes={data.notes} storage={storage} cardMetadata={data.cardMetadata} onCreate={() => openCardModal()} onEdit={card => openCardModal(undefined, undefined, card)} onOpenNote={openNote} onReview={() => void navigate({ kind: 'review' })} />}
        {view.kind === 'practice' && <Suspense fallback={<p role="status">Abrindo suas atividades...</p>}><PracticePage key={view.context?`${view.context.trackId}-${view.context.blockId}`:'practice'} data={data} initialContext={view.context} onCreate={createPractice} onOpenNote={openPracticeNote} onPlanner={trackId=>void navigate({kind:'planner',trackId})} registerFlush={registerFlush} /></Suspense>}
        {view.kind === 'notebook' && <NotebookPage key={view.entryId ?? (view.draft ? JSON.stringify(view.draft.source) : `notebook-${view.subjectId??'all'}`)} data={data} initialSubjectId={view.subjectId} onProgress={view.subjectId?()=>void navigate({kind:'subject',subjectId:view.subjectId!,tab:'progress'}):undefined} initialEntryId={view.entryId} initialDraft={view.draft} onSave={workspace.saveErrorEntry} onReload={async()=>{await workspace.reload();}} registerFlush={registerFlush} onOpenNote={id=>{const note=data.notes.find(item=>item.id===id);if(note)openNote(note);}} onReviewCard={reviewNotebookCard} />}
        {view.kind === 'review' && <Review key={`review-${view.subjectId ?? 'all'}-${view.mode ?? 'free'}-${view.plannerContext?.trackId ?? ''}-${view.cardId ?? ''}-${view.notebookEntryId ?? ''}`} cards={data.flashcards} subjects={data.subjects} reviewSchedules={data.reviewSchedules} initialSubjectId={view.subjectId} initialCardId={view.cardId} onProgress={view.progressSubjectId?()=>void navigate({kind:'subject',subjectId:view.progressSubjectId!,tab:'progress'}):undefined} onNotebook={view.notebookEntryId ? ()=>void navigate({kind:'notebook',entryId:view.notebookEntryId,subjectId:view.progressSubjectId}) : undefined} onErrorDraft={draft=>void navigate({kind:'notebook',draft})} initialMode={view.mode} plannerContext={view.plannerContext} onPlanner={view.plannerContext ? () => void navigate({kind:'planner',trackId:view.plannerContext!.trackId}) : undefined} startToken={reviewToken} onActiveCardChange={setActiveCard} storage={storage} cardMetadata={data.cardMetadata} onRecord={workspace.recordReview} onReload={workspace.reload} reviewNeedsReload={workspace.reviewNeedsReload} onCreate={() => openCardModal()} onLibrary={() => void navigate({ kind: 'library' })} />}
      </main><footer className="main-footer"><span>Feito para aprender, no seu tempo.</span><span>StudySpace <span className="footer-version">2.0</span></span></footer>
    </div>
    {dialog?.kind === 'subject' && <SubjectModal subject={dialog.subject} onClose={() => setDialog(null)} onSubmit={async input => { await flushRef.current(); if (dialog.subject) { await workspace.updateSubject(dialog.subject.id, input); setDialog(null); notify('Matéria atualizada.'); } else { const subject = await workspace.createSubject(input); await navigate({ kind: 'subject', subjectId: subject.id, tab: 'notes' }); notify('Seu novo espaço está pronto.'); } }} />}
    {dialog?.kind === 'card' && <CardModal subjects={data.subjects} initialSubjectId={dialog.subjectId} note={dialog.note} selected={dialog.selected} card={dialog.card} onClose={() => setDialog(null)} onCreate={async input => { await workspace.createFlashcard(input); setDialog(null); notify('Flashcard criado. Pronto para praticar!'); }} onUpdate={async input => { await workspace.updateFlashcard(input); setDialog(null); notify('Flashcard atualizado.'); }} />}
    {dialog?.kind === 'search' && <SearchModal data={data} onClose={() => setDialog(null)} onSubject={openSubject} onNote={openNote} onCard={card => setDialog({ kind: 'card', card })} />}
    {dialog?.kind === 'backup' && <BackupModal empty={data.subjects.length === 0 && !data.studyTracks?.length} onClose={() => setDialog(null)} onExport={async () => { await flushRef.current(); downloadBackup(await storage.exportBackupArchive()); }} listRecoveryCopies={listRecoveryCopies} onExportRecovery={exportRecoveryCopy} onRestore={async backup => { if (isBackupArchive(backup)) await storage.restoreBackupArchive(backup); else await storage.restoreBackup(backup); await workspace.reload(); await navigate({ kind: 'library' }); notify('Seu espaço foi restaurado.'); }} />}
    {dialog?.kind === 'help' && <Modal title="Aprenda do seu jeito" description="Organize uma matéria, escreva suas notas e transforme ideias em perguntas." onClose={() => setDialog(null)}><div className="help-steps"><p><span>01</span><strong>Crie uma matéria</strong> para reunir um assunto.</p><p><span>02</span><strong>Escreva uma nota.</strong> O salvamento é automático.</p><p><span>03</span><strong>Crie um flashcard.</strong> Selecione um trecho para usá-lo como resposta.</p><p><span>04</span><strong>Pratique e avalie.</strong> Cada tentativa fica no histórico local.</p></div><div className="shortcut-list"><span>Buscar no espaço<kbd>Ctrl + K</kbd></span><span>Virar cartão na revisão<kbd>Espaço</kbd></span><span>Avaliar uma resposta<kbd>1 – 4</kbd></span><span>Fechar uma janela<kbd>Esc</kbd></span></div><p className="help-note">Escolha prática livre ou revisão espaçada na tela Revisão. A agenda usa regras locais v1, sem IA. Na revisão espaçada, Errei retoma em dez minutos, em outra sessão; os novos cartões entram conforme sua cota diária.</p><div className="modal-actions"><button className="button primary" onClick={() => setDialog(null)}>Entendi<Check size={16} /></button></div></Modal>}
    <Suspense fallback={null}><JarvisPanel snapshot={data} subjectId={currentSubject?.id ?? activeCard?.subjectId} noteId={currentNote?.id} activeCard={activeCard} studyRequest={studyRequest} onAction={jarvisAction} />
      {dialog?.kind==='import' && <ImportModal snapshot={data} storage={storage} initialSubjectId={currentSubject?.id} initialBatch={dialog.batch} onClose={()=>setDialog(null)} onImported={result=>{void run(async()=>{await workspace.reload();setDialog(null);notify(`${result.flashcardIds.length} cartões e ${result.noteIds.length} notas importados. ${result.skippedDuplicates} duplicatas preservadas.`);});}} />}
      {dialog?.kind==='document' && <DocumentReader metadata={dialog.document} storage={storage} onClose={()=>setDialog(null)} onStudy={(excerpts,intent)=>{setDialog(null);setStudyRequest({id:crypto.randomUUID(),excerpts,intent});}} />}
    </Suspense>
    {toast && <div className="toast" role="status"><span>{toast}</span><button className="icon-button" aria-label="Dispensar mensagem" onClick={() => setToast(null)}><X size={16} /></button></div>}
  </div></>;
}

function SproutIcon() { return <svg viewBox="0 0 40 40" fill="none" width="34" height="34" aria-hidden="true"><path d="M20 32V18m0 8c-9 0-14-5-13-13 8-1 13 4 13 13Zm0-5c0-9 5-14 13-13 1 8-4 13-13 13Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M12 33h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>; }
