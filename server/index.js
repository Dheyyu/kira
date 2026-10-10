import './env.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Office } from './office.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC = [
  ['/vendor/three/', path.join(ROOT, 'node_modules', 'three')],
  ['/', path.join(ROOT, 'public')],
];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const office = new Office();
const clients = new Set();

const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
office.on('tick', (agents) => clients.forEach((res) => send(res, 'tick', agents)));
office.on('state', (state) => clients.forEach((res) => send(res, 'state', state)));

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e6) throw new Error('Body too large');
  }
  return raw ? JSON.parse(raw) : {};
}

function serveStatic(req, res, pathname) {
  for (const [prefix, dir] of STATIC) {
    if (!pathname.startsWith(prefix)) continue;
    let file = path.resolve(dir, '.' + decodeURIComponent(pathname.slice(prefix.length - 1)));
    if (file !== dir && !file.startsWith(dir + path.sep)) break;
    if (pathname.endsWith('/')) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) return json(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
    return;
  }
  json(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      clients.add(res);
      send(res, 'state', office.fullState());
      req.on('close', () => clients.delete(res));
      return;
    }
    if (pathname === '/api/state' && req.method === 'GET') return json(res, 200, office.fullState());
    if (pathname === '/api/tasks' && req.method === 'POST') {
      const body = await readBody(req);
      return json(res, 201, office.submitTask(body));
    }
    let m;
    if ((m = pathname.match(/^\/api\/tasks\/([\w-]+)\/feedback$/)) && req.method === 'POST') {
      const { rating } = await readBody(req);
      return json(res, 200, office.feedback(m[1], rating));
    }
    if ((m = pathname.match(/^\/api\/agents\/([\w-]+)\/train$/)) && req.method === 'POST') {
      const { note } = await readBody(req);
      office.train(m[1], note);
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/models/refresh' && req.method === 'POST') {
      return json(res, 200, await office.refreshModels());
    }
    if (pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
    serveStatic(req, res, pathname);
  } catch (e) {
    json(res, 400, { error: e.message });
  }
});

await office.start();
server.listen(PORT, HOST, () => {
  const m = office.models;
  console.log(`KIRA office running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  for (const p of ['ollama', 'mistral', 'claude']) {
    console.log(`  ${p.padEnd(8)} ${m[p]?.available ? 'online' : `offline (${m[p]?.reason})`}`);
  }
  if (!Object.values(m).some((s) => s.available)) console.log('  No models online: tasks will run in simulation mode.');
});
