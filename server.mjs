// Lokální vývojový server bez závislostí: `node --env-file=.env server.mjs`
// Servíruje složku public/ a stejné API jako Netlify Functions.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { Readable } from 'node:stream';
import { chatResponse, modelsResponse, fileResponse } from './lib/chat.mjs';

const PORT = Number(process.env.PORT) || 8888;
const ROOT = join(import.meta.dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4' };

async function send(res, response) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) Readable.fromWeb(response.body).pipe(res);
  else res.end();
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/models') return send(res, modelsResponse(process.env));
    if (url.pathname === '/api/file') return send(res, await fileResponse(new Request(url), process.env));
    if (url.pathname === '/api/chat') {
      const controller = new AbortController();
      res.on('close', () => controller.abort());
      const request = new Request(url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? Readable.toWeb(req) : undefined, duplex: 'half', signal: controller.signal });
      return send(res, await chatResponse(request, process.env));
    }
    const path = normalize(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT)) throw new Error('forbidden');
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Nenalezeno');
  }
}).listen(PORT, () => console.log(`✨ AdrrexAI běží na http://localhost:${PORT}`));
