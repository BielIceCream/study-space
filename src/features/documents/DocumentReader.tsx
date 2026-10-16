import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { DocumentMetadata, StorageService, StoredDocument } from '../../shared/types';
import type { JarvisExcerpt } from '../../services/jarvis/types';
import { Modal } from '../../shared/ui';
import { messageFrom } from '../../shared/utils';
import './documents.css';

GlobalWorkerOptions.workerSrc = workerUrl;
export function DocumentReader({ metadata, storage, onClose, onStudy }: { metadata: DocumentMetadata; storage: StorageService; onClose: () => void; onStudy: (excerpts: JarvisExcerpt[], intent?: string) => void }) {
  const [document, setDocument] = useState<StoredDocument | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [rendering, setRendering] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    let task: ReturnType<typeof getDocument> | undefined;
    setDocument(null); setPdf(null); setError(''); setPage(1); setSelected('');
    void storage.getDocument(metadata.id).then(async source => {
      if (!active) return;
      setDocument(source);
      if (source.kind === 'pdf') {
        task = getDocument({ data: Uint8Array.from(atob(source.dataBase64), char => char.charCodeAt(0)), useSystemFonts: true });
        const loaded = await task.promise;
        if (active) setPdf(loaded);
      }
    }).catch(cause => { if (active) setError(messageFrom(cause)); });
    return () => { active = false; void task?.destroy(); };
  }, [metadata.id, storage]);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let active = true;
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    setRendering(true);
    void pdf.getPage(page).then(item => {
      if (!active || !canvas.current) return;
      const viewport = item.getViewport({ scale: 1.25 });
      canvas.current.width = viewport.width; canvas.current.height = viewport.height;
      task = item.render({ canvas: canvas.current, viewport });
      return task.promise;
    }).catch(cause => { if (active) setError(messageFrom(cause)); }).finally(() => { if (active) setRendering(false); });
    return () => { active = false; task?.cancel(); };
  }, [pdf, page]);
  const pageText = document?.pages.find(item => item.page === page)?.text ?? '';
  const pageCount = pdf?.numPages ?? document?.pageCount ?? metadata.pageCount;
  function selection() {
    const range = window.getSelection();
    if (range?.anchorNode && text.current?.contains(range.anchorNode)) setSelected(range.toString().trim().slice(0, 3000));
  }
  function download() {
    if (!document) return;
    const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(document.dataBase64), char => char.charCodeAt(0))], { type: document.mimeType }));
    const link = window.document.createElement('a'); link.href = url; link.download = document.fileName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function study(intent: string) {
    onStudy([{ documentId: metadata.id, title: metadata.fileName, page, text: selected || pageText.slice(0, 3000) }], intent);
  }
  return <Modal title={metadata.fileName} description="O texto da página pode ser selecionado abaixo. O JARVIS só recebe o trecho quando você autorizar no painel." onClose={onClose} className="document-modal"><div className="document-toolbar"><button className="button secondary" disabled={page <= 1} onClick={() => { setPage(value => value - 1); setSelected(''); }}>Anterior</button><label>Página <input className="input" aria-label="Página do documento" type="number" min={1} max={pageCount || 1} value={page} onChange={event => { setPage(Math.max(1, Math.min(pageCount || 1, Number(event.target.value) || 1))); setSelected(''); }} /></label><span>de {pageCount || 1}</span><button className="button secondary" disabled={page >= pageCount} onClick={() => { setPage(value => value + 1); setSelected(''); }}>Próxima</button><button className="text-button" disabled={!document} onClick={download}>Baixar original</button></div>{error && <p className="form-error" role="alert">{error}</p>}{!document && !error && <p role="status">Abrindo documento…</p>}<div className="document-view">{metadata.kind === 'pdf' && <><canvas ref={canvas} aria-label={`Página ${page} do PDF`} />{rendering && <p role="status">Renderizando página…</p>}</>}<div className="document-text" ref={text} onMouseUp={selection} onKeyUp={selection}>{pageText || (document && 'Esta página não contém texto extraível. PDFs digitalizados precisam de OCR antes de estudar o texto.')}</div></div><p>{selected ? `${selected.length} caracteres selecionados` : 'Será usada apenas esta página (até 3.000 caracteres).'}</p><div className="document-study">{['Resumir', 'Explicar', 'Gerar flashcards', 'Conversar'].map(intent => <button className="button secondary" key={intent} disabled={!pageText && !selected} onClick={() => study(intent)}>{intent}</button>)}</div></Modal>;
}
