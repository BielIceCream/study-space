import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readSafeZip } from './zip';

describe('leitura de ZIP delimitada', () => {
  it('extrai arquivos válidos e diretórios sem acesso ao filesystem', async () => {
    const files = await readSafeZip(zipSync({ 'word/document.xml': strToU8('<document/>'), 'media/': new Uint8Array() }));
    expect(new TextDecoder().decode(files.get('word/document.xml'))).toBe('<document/>');
    expect(files.get('media/')).toHaveLength(0);
  });
  it('recusa caminhos traversal, absolutos e Windows', async () => {
    for (const name of ['../secret', '/secret', 'C:/secret', 'folder\\secret', 'folder/../secret']) {
      await expect(readSafeZip(zipSync({ [name]: strToU8('unsafe') }))).rejects.toThrow('inseguro');
    }
  });
  it('recusa pacote truncado e verifica integridade CRC', async () => {
    const original = zipSync({ 'hello.txt': [strToU8('hello'), { level: 0 }] });
    await expect(readSafeZip(original.subarray(0, original.length - 1))).rejects.toThrow('corrompido');
    const corrupted = original.slice(); corrupted[39] ^= 1;
    await expect(readSafeZip(corrupted)).rejects.toThrow('CRC');
  });
  it('recusa expansão excessiva antes da descompressão', async () => {
    const archive = zipSync({ bomb: new Uint8Array(2 * 1024 * 1024) });
    await expect(readSafeZip(archive)).rejects.toThrow('descompressão');
  });
});
