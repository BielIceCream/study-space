                                                                 

                           
                                           
                                                                               
                                                                                                                                           
 
                                        
                     
                  
                                                                              
                
                                     
                                                                                      
                         
 
const short = (text        , maximum        ) => text.trim().slice(0, maximum);

/** Local metadata plus only explicitly shared, bounded content. No file reads. */
export function buildStudyContext(snapshot                 , selection                        = {})                     {
  const contentShared = selection.shareContent === true;
  const activeNote = snapshot.notes.find(note => note.id === selection.noteId);
  const subjectId = selection.subjectId ?? activeNote?.subjectId ?? selection.activeCard?.subjectId;
  const activeSubject = snapshot.subjects.find(subject => subject.id === subjectId);
  const documents = (snapshot.documents ?? []).filter(document => document.subjectId === subjectId).slice(0, 30)
    .map(document => ({ id: document.id, subjectId: document.subjectId, title: short(document.title ?? document.name ?? document.fileName ?? 'Documento', 200), pageCount: document.pageCount ?? document.pages?.length }));
  const excerpts                  = [];
  let available = 12_000;
  if (contentShared) for (const excerpt of (selection.selectedExcerpts ?? []).slice(0, 8)) {
    const document = documents.find(item => item.id === excerpt.documentId);
    if (!document || !Number.isInteger(excerpt.page) || excerpt.page < 1 || (document.pageCount && excerpt.page > document.pageCount)) continue;
    const text = short(excerpt.text, Math.min(3_000, available));
    if (!text) continue;
    excerpts.push({ documentId: document.id, title: document.title, page: excerpt.page, text });
    available -= text.length;
    if (!available) break;
  }
  return {
    subjects: snapshot.subjects.slice(0, 100).map(subject => ({ id: subject.id, name: short(subject.name, 120) })),
    activeSubject: activeSubject ? { id: activeSubject.id, name: short(activeSubject.name, 120) } : undefined,
    activeNote: activeNote ? { id: activeNote.id, subjectId: activeNote.subjectId, title: short(activeNote.title, 200), excerpt: contentShared && !excerpts.length ? short(activeNote.plainText, 4_000) : undefined } : undefined,
    activeCard: selection.activeCard ? { id: selection.activeCard.id, subjectId: selection.activeCard.subjectId, front: contentShared ? short(selection.activeCard.front, 3_000) : undefined, back: contentShared ? short(selection.activeCard.back, 3_000) : undefined } : undefined,
    documents, page: selection.page, excerpts, contentShared,
  };
}

/** Reapply consent before IPC even when callers supply their own context. */
export function sanitizeStudyContext(context                    )                     {
  const documents = context.documents.slice(0, 30);
  return buildStudyContext({ subjects: context.subjects, notes: context.activeNote ? [{ ...context.activeNote, plainText: context.activeNote.excerpt ?? '' }] : [], documents }, {
    subjectId: context.activeSubject?.id, noteId: context.activeNote?.id,
    activeCard: context.activeCard ? { ...context.activeCard, front: context.activeCard.front ?? '', back: context.activeCard.back ?? '' } : undefined,
    page: context.page, selectedExcerpts: context.excerpts, shareContent: context.contentShared,
  });
}
