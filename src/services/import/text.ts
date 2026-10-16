import type { RichDocument } from '../../shared/types';

export function decodeUtf8(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
  catch { throw new Error('O arquivo precisa usar codificação UTF-8. Salve uma cópia em UTF-8 e tente novamente.'); }
}

export function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name: string) => {
    if (name[0] !== '#') return named[name.toLowerCase()] ?? entity;
    const code = name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  });
}

// Imported markup becomes text nodes. It never enters innerHTML or an editor HTML parser.
export function htmlToPlainText(value: string): string {
  return decodeEntities(value
    .replace(/<(script|style|iframe|object|embed|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|svg)\b[^>]*\/?>/gi, '')
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/\[sound:[^\]]*\]/gi, '')
    .replace(/<br\b[^>]*>|<\/(?:p|div|li|h[1-6]|tr|section)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ''))
    .replace(/\r\n?/g, '\n').replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').trim();
}

export function textDocument(value: string): RichDocument {
  return { type: 'doc', content: value.split(/\r?\n/).map(text => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) })) };
}

export function normalizedCardKey(front: string, back: string): string {
  const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
  return JSON.stringify([normalize(front), normalize(back)]);
}

export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Importação cancelada.');
}

export async function yieldImport(signal?: AbortSignal): Promise<void> {
  assertNotAborted(signal);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  assertNotAborted(signal);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
