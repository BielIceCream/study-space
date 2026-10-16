import { useCallback, useEffect, useRef, useState } from 'react';
import type { Note, RichDocument, SaveNoteInput } from '../../shared/types';
import { clearDraft, readDraft, writeDraft } from '../../services/drafts';
import { messageFrom } from '../../shared/utils';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

export function useNoteAutosave(note: Note, onSave: (input: SaveNoteInput) => Promise<Note>, registerFlush: (flush: () => Promise<void>, isDirty: () => boolean) => () => void) {
  const [initial] = useState(() => {
    const recovery = readDraft(note.id);
    const sameRevision = recovery?.expectedRevision === note.revision;
    const current = { id: note.id, title: note.title, bodyJson: note.bodyJson, plainText: note.plainText, expectedRevision: note.revision };
    return { current: sameRevision && recovery ? recovery : current, recovered: Boolean(sameRevision && recovery), conflict: recovery && !sameRevision ? recovery : null };
  });
  const [draft, setDraft] = useState(initial.current);
  const [status, setStatus] = useState<SaveStatus>(initial.recovered ? 'pending' : 'saved');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(initial.conflict);
  const draftRef = useRef(draft);
  const version = useRef(initial.recovered ? 1 : 0);
  const committed = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const update = useCallback((patch: { title?: string; bodyJson?: RichDocument; plainText?: string }) => {
    draftRef.current = { ...draftRef.current, ...patch };
    version.current += 1;
    setDraft(draftRef.current);
    setStatus('pending');
    setError(null);
    try { writeDraft(draftRef.current); }
    catch { setError('A recuperação de rascunho está indisponível. Mantenha a página aberta até a nota ser salva.'); }
  }, []);

  const flush = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    if (version.current === committed.current) return Promise.resolve();
    const task = (async () => {
      while (version.current !== committed.current) {
        const savingVersion = version.current;
        const input = { ...draftRef.current, title: draftRef.current.title.trim() || 'Sem título' };
        setStatus('saving');
        const saved = await onSaveRef.current(input);
        committed.current = savingVersion;
        draftRef.current = { ...draftRef.current, expectedRevision: saved.revision };
        if (version.current === committed.current) {
          try { clearDraft(note.id); } catch { /* The committed SQLite note remains safe. */ }
        } else {
          try { writeDraft(draftRef.current); } catch { /* Keep attempting the database write. */ }
        }
      }
      setStatus('saved');
      setError(null);
    })().catch(cause => {
      setStatus('error');
      setError(messageFrom(cause));
      throw cause;
    }).finally(() => { inFlight.current = null; });
    inFlight.current = task;
    return task;
  }, [note.id]);

  useEffect(() => registerFlush(flush, () => version.current !== committed.current), [flush, registerFlush]);
  useEffect(() => {
    if (version.current === committed.current || status === 'error') return;
    const timer = window.setTimeout(() => { void flush().catch(() => undefined); }, 550);
    return () => window.clearTimeout(timer);
  }, [draft, flush, status]);
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'hidden') void flush().catch(() => undefined); };
    const onUnload = (event: BeforeUnloadEvent) => {
      if (version.current !== committed.current) { void flush().catch(() => undefined); event.preventDefault(); event.returnValue = ''; }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onUnload);
    return () => { document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('beforeunload', onUnload); };
  }, [flush]);

  const recoverConflict = () => {
    if (!conflict) return;
    update({ title: conflict.title, bodyJson: conflict.bodyJson, plainText: conflict.plainText });
    setConflict(null);
  };
  const discardConflict = () => {
    try {
      if (version.current === committed.current) clearDraft(note.id);
      else writeDraft(draftRef.current);
    } catch { /* No canonical data is removed. */ }
    setConflict(null);
  };

  return { draft, status, error, update, flush, conflict, recoverConflict, discardConflict, recovered: initial.recovered };
}
