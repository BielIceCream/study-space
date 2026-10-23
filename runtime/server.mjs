import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, unlinkSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { publicConfiguration } from './config.mjs';
import { jarvisCommand } from './jarvis.mjs';
import { localIdentity } from './identity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../app');
const settings = join(process.env.LOCALAPPDATA || process.env.TEMP, 'StudySpace-Local');
const controlPath = join(settings, 'servidor.json');
const token = randomBytes(32).toString('hex');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
mkdirSync(settings, { recursive: true });

const send = (res, status, body = '') => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); };
const json = (res, status, body) => { if (res.destroyed || res.writableEnded) return; res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
let active = 0;
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.headers.host !== '127.0.0.1:1420') return send(res, 403);
  if (!req.url || req.url.length > 2048) return send(res, 400);
  if (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:1420') return send(res, 403);
  if (req.url === '/__studyspace_local__/config' && req.method === 'GET') {
    try { return json(res, 200, publicConfiguration()); } catch { return json(res, 500, { error: 'Confira o formato do arquivo config\\.env.' }); }
  }
  if (req.url === '/__studyspace_local__/jarvis' && req.method === 'POST') {
    if (req.headers['x-studyspace-local'] !== '1' || !req.headers['content-type']?.startsWith('application/json')) return send(res, 403);
    if (active >= 4) return json(res, 429, { error: 'O JARVIS está ocupado. Aguarde e tente novamente.' });
    active++;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 90000);
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 15 * 1024 * 1024) { json(res, 413, { error: 'O pedido ultrapassou o limite permitido.' }); req.resume(); return; }
        chunks.push(chunk);
      }
      let request;
      try { request = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return json(res, 400, { error: 'Pedido JSON inválido.' }); }
      const result = await jarvisCommand(request.command, request.input || {}, abort.signal);
      json(res, 200, result);
    } catch (error) {
      const message = error instanceof TypeError || error instanceof SyntaxError ? 'Não foi possível processar o pedido local.' : error.message;
      json(res, 400, { error: message || 'Não foi possível concluir o pedido.' });
    } finally { clearTimeout(timeout); active--; }
    return;
  }
  if (req.url === '/__studyspace_local__/health' && req.method === 'GET') return send(res, 200, localIdentity);
  if (req.url === '/__studyspace_local__/stop' && req.method === 'POST') {
    const provided = Buffer.from(req.headers['x-studyspace-token'] || '');
    const expected = Buffer.from(token);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return send(res, 403);
    send(res, 200, 'Encerrando');
    server.close(() => process.exit(0));
    setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 500).unref();
    return;
  }
  if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405);
  let path;
  try { path = decodeURIComponent(req.url.split('?')[0]); } catch { return send(res, 400); }
  if (!path.startsWith('/') || /[\\:\0]/.test(path)) return send(res, 403);
  const file = resolve(root, path === '/' ? 'index.html' : '.' + path);
  if (!file.startsWith(root + sep)) return send(res, 403);
  try {
    const stats = statSync(file);
    if (!stats.isFile()) return send(res, 404);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Content-Length': stats.size, 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(file);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch { send(res, 404); }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.maxHeadersCount = 64;
server.on('error', error => {
  appendFileSync(join(settings, 'iniciador.log'), new Date().toISOString() + ' ' + error.message + '\n');
  process.exit(1);
});
process.on('exit', () => {
  try { if (JSON.parse(readFileSync(controlPath, 'utf8')).pid === process.pid) unlinkSync(controlPath); } catch { }
});
if (!existsSync(join(root, 'index.html'))) throw new Error('Extraia todo o ZIP, incluindo a pasta app.');
server.listen(1420, '127.0.0.1', () => {
  writeFileSync(controlPath, JSON.stringify({ pid: process.pid, token, identity: localIdentity }));
});
