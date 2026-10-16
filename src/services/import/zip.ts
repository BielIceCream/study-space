import { Unzip, UnzipInflate } from 'fflate';
import { decodeUtf8, yieldImport } from './text';
import { MAX_IMPORT_FILE_BYTES } from './types';

const MAX_ENTRIES = 10_000;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
interface Entry { size: number; compressed: number; crc: number }

export function safeArchivePath(name: string): boolean {
  return !!name && !name.includes('\0') && !name.includes('\\') && !name.startsWith('/') && !name.includes(':') && !name.split('/').some(part => part === '..' || part === '.');
}

function directory(bytes: Uint8Array): Map<string, Entry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === bytes.length) { end = at; break; }
  }
  if (end < 0) throw new Error('O pacote ZIP está incompleto ou corrompido.');
  const count = view.getUint16(end + 10, true); const offset = view.getUint32(end + 16, true); const length = view.getUint32(end + 12, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count || count === 65535 || offset === 0xffffffff || length === 0xffffffff || count > MAX_ENTRIES || offset + length > end) throw new Error('ZIP multipartes, ZIP64 ou pacote com entradas demais não é suportado.');
  const entries = new Map<string, Entry>(); let at = offset; let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > offset + length || view.getUint32(at, true) !== 0x02014b50) throw new Error('O índice do ZIP está corrompido.');
    const flags = view.getUint16(at + 8, true); const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true); const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true); const extra = view.getUint16(at + 30, true); const comment = view.getUint16(at + 32, true); const localOffset = view.getUint32(at + 42, true);
    if (at + 46 + nameLength + extra + comment > offset + length) throw new Error('O índice do ZIP está truncado.');
    const name = decodeUtf8(bytes.subarray(at + 46, at + 46 + nameLength));
    total += size;
    if (!safeArchivePath(name) || entries.has(name)) throw new Error('O pacote contém um caminho inseguro ou uma entrada duplicada.');
    if ((flags & 1) || ![0, 8].includes(method)) throw new Error('ZIP criptografado ou compressão diferente de DEFLATE não é suportado.');
    if (size > MAX_IMPORT_FILE_BYTES || total > MAX_EXPANDED_BYTES || (size > 1024 * 1024 && size / Math.max(1, compressed) > 200)) throw new Error('O pacote excede o limite seguro de descompressão.');
    if (localOffset + 30 > offset || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('Uma entrada do ZIP está corrompida.');
    const localNameLength = view.getUint16(localOffset + 26, true); const localExtra = view.getUint16(localOffset + 28, true);
    if (localOffset + 30 + localNameLength + localExtra + compressed > offset || view.getUint16(localOffset + 8, true) !== method || view.getUint16(localOffset + 6, true) !== flags || decodeUtf8(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)) !== name) throw new Error('Uma entrada do ZIP não corresponde ao índice.');
    entries.set(name, { size, compressed, crc: view.getUint32(at + 16, true) });
    at += 46 + nameLength + extra + comment;
  }
  if (at !== offset + length) throw new Error('O índice do ZIP contém dados inesperados.');
  return entries;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export async function readSafeZip(bytes: Uint8Array, signal?: AbortSignal): Promise<Map<string, Uint8Array>> {
  const expected = directory(bytes); const files = new Map<string, Uint8Array>(); const started = new Set<string>();
  let actualTotal = 0;
  const unzip = new Unzip(file => {
    const entry = expected.get(file.name);
    if (!entry || started.has(file.name)) throw new Error('O pacote contém uma entrada desconhecida ou duplicada.');
    started.add(file.name);
    const parts: Uint8Array[] = []; let actual = 0;
    file.ondata = (error, data, final) => {
      if (error) throw new Error('Não foi possível descomprimir o pacote.');
      actual += data.length; actualTotal += data.length;
      if (actual > entry.size || actualTotal > MAX_EXPANDED_BYTES) throw new Error('O pacote excede o tamanho declarado.');
      parts.push(data);
      if (final) {
        if (actual !== entry.size) throw new Error('Uma entrada do pacote está truncada.');
        const output = new Uint8Array(actual); let position = 0;
        for (const part of parts) { output.set(part, position); position += part.length; }
        if (crc32(output) !== entry.crc) throw new Error('Uma entrada do pacote está corrompida (CRC inválido).');
        files.set(file.name, output);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let at = 0; at < bytes.length; at += 4096) {
    unzip.push(bytes.subarray(at, at + 4096), at + 4096 >= bytes.length);
    if (at % (4096 * 128) === 0) await yieldImport(signal);
  }
  if (files.size !== expected.size) throw new Error('O pacote não contém todas as entradas declaradas.');
  return files;
}
