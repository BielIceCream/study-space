import { useEffect, useRef, useState } from 'react';
import type { Snapshot, StorageService } from '../../shared/types';
import { Modal } from '../../shared/ui';
import { messageFrom } from '../../shared/utils';
import { parseImportFile } from '../../services/import/parser';
import type { ImportBatchInput, ImportPreview, ImportProgress, ImportResult, ImportColumnMapping } from '../../services/import/types';
import './imports.css';

export function ImportModal({ snapshot, storage, onClose, onImported, initialSubjectId, initialBatch }: { snapshot: Snapshot; storage: StorageService; onClose: () => void; onImported: (result: ImportResult) => void; initialSubjectId?: string; initialBatch?:ImportBatchInput }) {
  const [subjectId, setSubjectId] = useState(initialBatch?.subjectId ?? initialSubjectId ?? snapshot.subjects[0]?.id ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(initialBatch?{batch:initialBatch,format:initialBatch.format,fileName:initialBatch.sourceName,counts:{notes:initialBatch.notes.length,flashcards:initialBatch.flashcards.length,documents:initialBatch.documents.length,assets:initialBatch.assets.length},columns:[],suggestedMapping:null,duplicates:initialBatch.flashcards.filter(card=>snapshot.flashcards.some(c=>c.subjectId===initialBatch.subjectId&&c.front===card.front&&c.back===card.back)).length}:null);
  const [mapping, setMapping] = useState<ImportColumnMapping>({ frontColumn: 0, backColumn: 1, hasHeader: true });
  const [mappingTouched,setMappingTouched] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function prepare() {
    if (!file || !subjectId) return;
    const controller = new AbortController(); abort.current = controller;
    setBusy(true); setError(''); setPreview(null);
    try {
      const next=await parseImportFile(file, { subjectId, snapshot, columnMapping: mappingTouched?mapping:undefined, signal: controller.signal, onProgress: setProgress });
      if(!mappingTouched&&next.suggestedMapping)setMapping(next.suggestedMapping);
      setPreview(next);
    }
    catch (cause) { if (!controller.signal.aborted) setError(messageFrom(cause)); }
    finally { setBusy(false); setProgress(null); }
  }
  async function confirm() {
    if (!preview || saving) return;
    setSaving(true); setError('');
    try { onImported(await storage.importBatch({...preview.batch,subjectId})); }
    catch (cause) { setError(messageFrom(cause)); }
    finally { setSaving(false); }
  }
  const changeMapping = (next: ImportColumnMapping) => { setMappingTouched(true);setMapping(next); setPreview(null); };
  const delimited = /\.(csv|tsv)$/i.test(file?.name ?? '');
  return <Modal title="Importar material" description="CSV, TSV, JSON, APKG, PDF, DOCX, TXT ou MD. Até 32 MiB e 5.000 notas e cartões por arquivo." onClose={() => { abort.current?.abort(); onClose(); }} busy={saving} className="import-modal">
    <div className="import-fields"><label>Arquivo<input className="input" type="file" accept=".csv,.tsv,.json,.apkg,.pdf,.docx,.txt,.md" disabled={busy || saving} onChange={event => { setFile(event.target.files?.[0] ?? null); setMappingTouched(false);setPreview(null); setError(''); }} /></label><label>Matéria<select className="input" disabled={busy || saving} value={subjectId} onChange={event => { setSubjectId(event.target.value); if(!initialBatch) setPreview(null); }}>{snapshot.subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
    {!subjectId && <p>Crie uma matéria antes de importar.</p>}
    {delimited && <div className="import-mapping"><label>Coluna da pergunta<input className="input" type="number" min={1} max={100} value={mapping.frontColumn + 1} disabled={busy || saving} onChange={event => changeMapping({ ...mapping, frontColumn: Math.max(0, Number(event.target.value) - 1) })} /></label><label>Coluna da resposta<input className="input" type="number" min={1} max={100} value={mapping.backColumn + 1} disabled={busy || saving} onChange={event => changeMapping({ ...mapping, backColumn: Math.max(0, Number(event.target.value) - 1) })} /></label><label><span><input type="checkbox" checked={mapping.hasHeader} disabled={busy || saving} onChange={event => changeMapping({ ...mapping, hasHeader: event.target.checked })} /> Primeira linha é cabeçalho</span></label></div>}</div>
    {progress && <><progress className="import-progress" value={progress.completed} max={progress.total || 1} /><p role="status">Preparando prévia… {progress.completed} / {progress.total}</p></>}
    {preview && <section className="import-preview" aria-label="Prévia da importação"><strong>{preview.counts.notes} notas · {preview.counts.flashcards} cartões · {preview.counts.documents} documentos</strong><p>{preview.duplicates} cartões repetidos identificados.</p>{preview.columns.length > 0 && <p>Colunas: {preview.columns.join(' · ')}</p>}{preview.batch.warnings.map((warning, i) => <p key={i}>{warning}</p>)}{preview.batch.notes.slice(0, 2).map((note, i) => <article key={i}><strong>{note.title}</strong><p>{note.plainText.slice(0, 500)}</p></article>)}{preview.batch.flashcards.slice(0, 3).map((card, i) => <article key={i}><strong>{card.front}</strong><p>{card.back}</p>{Boolean(card.images?.length) && <small>{card.images!.length} imagem(ns) preservada(s)</small>}</article>)}</section>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="import-actions">{busy ? <button className="button secondary" onClick={() => abort.current?.abort()}>Cancelar leitura</button> : <button className="button secondary" onClick={onClose} disabled={saving}>Cancelar</button>}<button className="button primary" disabled={busy || saving || (!file && !preview) || !subjectId} onClick={() => void (preview ? confirm() : prepare())}>{saving ? 'Importando…' : preview ? 'Confirmar importação' : 'Ver prévia'}</button></div>
  </Modal>;
}
