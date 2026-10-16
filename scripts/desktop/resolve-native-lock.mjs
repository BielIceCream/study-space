// Cargo's Schannel TLS can be unavailable in managed Windows sessions. This
// temporary loopback proxy uses Node's verified HTTPS, then exits with Cargo.
// It changes no machine settings and does not run in the installed application.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const localBin = join(root, '.cache/rust/toolchain/bin');
const cargo = existsSync(join(localBin, 'cargo.exe')) ? join(localBin, 'cargo.exe') : 'cargo';
let port;
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    if (path === '/config.json') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ dl: `http://127.0.0.1:${port}/download/{crate}/{version}`, api: 'https://crates.io' }));
      return;
    }
    const download = path.match(/^\/download\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9.+_-]+)$/);
    if (!download && !/^\/[a-z0-9_-]+(?:\/[a-z0-9_-]+){1,2}$/i.test(path)) {
      response.writeHead(400); response.end(); return;
    }
    const url = download
      ? `https://static.crates.io/crates/${download[1]}/${download[1]}-${download[2]}.crate`
      : `https://index.crates.io${path}`;
    const upstream = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': 'StudySpace locked native build setup' } });
    response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream' });
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch { response.writeHead(502); response.end('Não foi possível consultar a fonte oficial.'); }
});
// Stable loopback identity reuses Cargo's verified cache across invocations.
// The server still exists only for this command; an occupied port fails closed.
await new Promise((resolve,reject) => { server.once('error',reject); server.listen(58661, '127.0.0.1', resolve); });
port = server.address().port;
const args = ['generate-lockfile', '--manifest-path', 'src-tauri/Cargo.toml',
  '--config', 'source.crates-io.replace-with="studyspace-verified-proxy"',
  '--config', `source.studyspace-verified-proxy.registry="sparse+http://127.0.0.1:${port}/"`];
const mode = process.argv[2];
if (mode && !['check', 'voice-probe', 'test', 'test-ci', 'build', 'offline', 'qa'].includes(mode)) { server.close(); throw new Error('Modo de build invalido.'); }
// Incremental resolution keeps existing locked versions while adding new dependencies.
const checkArgs = ['check', '--target', 'x86_64-pc-windows-msvc', ...args.slice(args.indexOf('--config'))];
const probeArgs = ['test','--locked','--target','x86_64-pc-windows-msvc',...args.slice(args.indexOf('--config')),'windows_local_voice_probe','--','--ignored','--nocapture'];
const directCargo = mode === 'check' || mode === 'voice-probe';
const child = spawn(mode && !directCargo ? process.execPath : cargo, mode === 'voice-probe' ? probeArgs : mode === 'check' ? checkArgs : mode ? [join(root, 'scripts/desktop/windows-build.mjs'), mode] : args, {
  cwd: directCargo ? join(root, 'src-tauri') : root, windowsHide: true, stdio: 'inherit',
  env: { ...process.env, CARGO_HOME: join(root, '.cache/rust/cargo'), PATH: `${localBin};${process.env.PATH}`, ...(mode ? { STUDYSPACE_CARGO_PROXY_URL: `http://127.0.0.1:${port}/` } : {}) },
});
const stop = () => { child.kill(); server.close(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
try {
  process.exitCode = await new Promise((resolve, reject) => { child.on('exit', code => resolve(code ?? 1)); child.on('error', reject); });
} finally { server.close(); }
