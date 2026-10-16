import { readSafeZip } from './zip';
import { bytesToBase64, decodeUtf8, sha256, textDocument, yieldImport } from './text';
import type { ImportedDocument, ImportedNote, ImportOptions } from './types';

const MAX_TEXT_CHARS = 1_500_000;
const MAX_PAGES = 2_000;

export function docxText(xml: string): string {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('O DOCX contém declarações XML não permitidas.');
  if (typeof DOMParser === 'undefined') throw new Error('A leitura de DOCX requer o aplicativo ou um navegador com suporte a XML.');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('O XML de texto do DOCX está corrompido.');
  if (document.documentElement.localName !== 'document') throw new Error('O DOCX não contém um documento Word válido.');
  const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const STRICT_WORD_NS = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
  const paragraphs = [...document.getElementsByTagNameNS('*', 'p')].filter(node => node.namespaceURI === WORD_NS || node.namespaceURI === STRICT_WORD_NS);
  if (paragraphs.length > 100_000) throw new Error('O DOCX contém parágrafos demais.');
  const lines: string[] = []; let length = 0;
  for (const paragraph of paragraphs) {
    let line = '';
    const walk = (node: Element, depth: number): void => {
      if (depth > 80) throw new Error('O DOCX contém uma estrutura XML profunda demais.');
      if (node.namespaceURI !== WORD_NS && node.namespaceURI !== STRICT_WORD_NS) return;
      if (node.localName === 't') line += node.textContent ?? '';
      else if (node.localName === 'tab') line += '\t';
      else if (node.localName === 'br' || node.localName === 'cr') line += '\n';
      else if (node.localName !== 'del' && node.localName !== 'instrText') for (const child of node.children) walk(child, depth + 1);
    };
    walk(paragraph, 0); length += line.length + 1;
    if (length > MAX_TEXT_CHARS) throw new Error('O texto do DOCX excede o limite de importação.');
    lines.push(line);
  }
  return lines.join('\n').trim();
}

async function pdfPages(bytes: Uint8Array, options: ImportOptions): Promise<{ pages: { page: number; text: string }[]; warnings: string[] }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  // PDF.js transfers/detaches its input. A private copy preserves the original for storage and hashing.
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false, stopAtErrors: true, disableAutoFetch: true });
  const cancel = () => { void task.destroy(); };
  options.signal?.addEventListener('abort', cancel, { once: true });
  const pages: { page: number; text: string }[] = []; let length = 0; let empty = 0;
  try {
    const document = await task.promise;
    if (document.numPages > MAX_PAGES) throw new Error(`O PDF excede o limite de ${MAX_PAGES} páginas.`);
    for (let number = 1; number <= document.numPages; number += 1) {
      await yieldImport(options.signal);
      const page = await document.getPage(number);
      try {
        const content = await page.getTextContent();
        const pieces: string[] = [];
        for (const item of content.items) {
          if ('str' in item) { pieces.push(item.str, item.hasEOL ? '\n' : ' '); length += item.str.length + 1; }
          if (length > MAX_TEXT_CHARS) throw new Error('O texto do PDF excede o limite de importação.');
        }
        const text = pieces.join('').replace(/ +\n/g, '\n').trim();
        if (!text) empty += 1;
        pages.push({ page: number, text });
      } finally { page.cleanup(); }
      options.onProgress?.({ stage: 'extracting', completed: number, total: document.numPages });
    }
    const warnings = empty ? [`${empty} página(s) do PDF não têm texto extraível. Páginas escaneadas precisam de OCR; o arquivo original será preservado.`] : [];
    return { pages, warnings };
  } catch (cause) {
    if (options.signal?.aborted) throw new Error('Importação cancelada.');
    if (cause instanceof Error && (/limite/.test(cause.message))) throw cause;
    const name = cause instanceof Error ? cause.name : '';
    if (name === 'PasswordException') throw new Error('O PDF é protegido por senha. Exporte uma cópia desbloqueada para importar.');
    throw new Error('Não foi possível ler este PDF. Verifique se o arquivo está completo e válido.', { cause });
  } finally { options.signal?.removeEventListener('abort', cancel); await task.destroy(); }
}

export async function parseDocument(bytes: Uint8Array, fileName: string, kind: 'pdf' | 'docx' | 'txt' | 'md', options: ImportOptions): Promise<{ note: ImportedNote; document: ImportedDocument; warnings: string[] }> {
  let pages: { page: number; text: string }[]; const warnings: string[] = [];
  if (kind === 'pdf') {
    if (String.fromCharCode(...bytes.subarray(0, 1024)).indexOf('%PDF-') < 0) throw new Error('O arquivo não contém uma assinatura PDF válida.');
    const parsed = await pdfPages(bytes, options); pages = parsed.pages; warnings.push(...parsed.warnings);
  } else if (kind === 'docx') {
    const archive = await readSafeZip(bytes, options.signal); const xml = archive.get('word/document.xml');
    if (!xml || !archive.has('[Content_Types].xml')) throw new Error('O arquivo não é um DOCX válido.');
    const text = docxText(decodeUtf8(xml)); pages = [{ page: 1, text }];
    if (!text) warnings.push('Este DOCX não contém texto extraível. O arquivo original será preservado.');
    if ([...archive.keys()].some(name => /^word\/media\//.test(name))) warnings.push('As imagens do DOCX são preservadas no arquivo original; a nota contém o texto extraído.');
  } else {
    const text = decodeUtf8(bytes).replace(/\u0000/g, '');
    if (!text.trim()) throw new Error('O arquivo não contém texto para importar.');
    if (text.length > MAX_TEXT_CHARS) throw new Error('O texto excede o limite de importação.');
    pages = [{ page: 1, text }];
    if (kind === 'md') warnings.push('O Markdown foi preservado como texto editável e no arquivo original.');
  }
  const plainText = kind === 'pdf' ? pages.map(page => `Página ${page.page}\n${page.text}`).join('\n\n') : pages[0].text;
  const title = fileName.replace(/\.[^.]+$/, '').trim().slice(0, 180) || 'Documento importado';
  const mimeTypes = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain', md: 'text/markdown' };
  return {
    note: { title, plainText, bodyJson: textDocument(plainText) },
    document: { noteIndex: 0, fileName, kind, mimeType: mimeTypes[kind], sha256: await sha256(bytes), dataBase64: bytesToBase64(bytes), pages },
    warnings,
  };
}
