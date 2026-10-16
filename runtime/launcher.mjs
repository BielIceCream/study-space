import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const address = 'http://127.0.0.1:1420/';
const runtime = dirname(fileURLToPath(import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function status() {
  try {
    const response = await fetch(address + '__studyspace_local__/health', { headers: { connection: 'close' }, signal: AbortSignal.timeout(600), redirect: 'error' });
    return response.ok && await response.text() === 'StudySpace-Local-0.2.0' ? 'ready' : 'occupied';
  } catch (error) { return error.cause?.code === 'ECONNREFUSED' ? 'closed' : 'occupied'; }
}

try {
  if (process.argv.includes('--stop')) {
    const current = await status();
    if (current === 'ready') {
      const path = join(process.env.LOCALAPPDATA || process.env.TEMP, 'StudySpace-Local', 'servidor.json');
      const { token } = JSON.parse(readFileSync(path, 'utf8'));
      const response = await fetch(address + '__studyspace_local__/stop', { method: 'POST', headers: { 'x-studyspace-token': token, connection: 'close' }, signal: AbortSignal.timeout(2000) });
      if (!response.ok) throw new Error('Não foi possível encerrar o StudySpace.');
      await response.text();
      let closed = false;
      for (let i = 0; i < 30; i++) {
        if (await status() === 'closed') { closed = true; break; }
        await delay(100);
      }
      if (!closed) throw new Error('O servidor local ainda está encerrando. Tente novamente.');
    }
    console.log('StudySpace encerrado. Seus dados continuam salvos no navegador.');
  } else {
    let current = await status();
    if (current === 'occupied') throw new Error('A porta 1420 está ocupada por outro programa. Feche esse programa e tente novamente.');
    if (current === 'closed') {
      const server = spawn(process.execPath, [join(runtime, 'server.mjs')], { detached: true, windowsHide: true, stdio: 'ignore', cwd: runtime });
      let failure;
      server.on('error', error => { failure = error; });
      server.unref();
      for (let i = 0; i < 60; i++) {
        if (failure) throw failure;
        current = await status();
        if (current === 'ready') break;
        await delay(100);
      }
      if (current !== 'ready') throw new Error('Não foi possível iniciar o StudySpace. Consulte %LOCALAPPDATA%\\StudySpace-Local\\iniciador.log.');
    }
    if (!process.argv.includes('--no-browser')) {
      const browser = spawn('explorer.exe', [address], { windowsHide: true, stdio: 'ignore' });
      browser.on('error', () => console.log('Abra no navegador: ' + address));
      browser.unref();
    }
    console.log('StudySpace pronto em ' + address);
  }
} catch (error) {
  console.error('\n' + error.message);
  process.exitCode = 1;
}
