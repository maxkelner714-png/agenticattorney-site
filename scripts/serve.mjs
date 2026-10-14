#!/usr/bin/env node
// Zero-dependency static server for public/. Applies _headers and _redirects (200 rewrites),
// serves 404.html with status 404, and maps extensionless paths. PORT from env (default 4190).
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT) || 4190;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4',
};

const globToRegex = (glob) => new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

function readHeaders() {
  const rules = [];
  const file = join(ROOT, '_headers');
  if (!existsSync(file)) return rules;
  let current = null;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) { current = { re: globToRegex(raw.trim()), headers: [] }; rules.push(current); continue; }
    const i = raw.indexOf(':');
    if (current && i > 0) current.headers.push([raw.slice(0, i).trim(), raw.slice(i + 1).trim()]);
  }
  return rules;
}

function readRedirects() {
  const rules = [];
  const file = join(ROOT, '_redirects');
  if (!existsSync(file)) return rules;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [from, to, status] = line.split(/\s+/);
    rules.push({ from, to, status: Number(status) || 301 });
  }
  return rules;
}

const headerRules = readHeaders();
const redirects = readRedirects();

function applyHeaders(res, path) {
  for (const rule of headerRules) if (rule.re.test(path)) for (const [k, v] of rule.headers) res.setHeader(k, v);
}

function fileFor(path) {
  let p = decodeURIComponent(path.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const abs = normalize(join(ROOT, p));
  if (!abs.startsWith(ROOT)) return null;
  if (existsSync(abs) && statSync(abs).isFile()) return abs;
  if (!extname(p) && existsSync(abs + '.html')) return abs + '.html';
  return null;
}

function send(res, status, file, path) {
  const body = readFileSync(file);
  applyHeaders(res, path);
  res.writeHead(status, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Content-Length': body.length });
  res.end(body);
}

const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  for (const r of redirects) {
    if (r.from !== path) continue;
    if (r.status === 200) { const f = fileFor(r.to); if (f) return send(res, 200, f, path); break; }
    applyHeaders(res, path);
    res.writeHead(r.status, { Location: r.to }); return res.end();
  }
  const f = fileFor(path);
  if (f) return send(res, 200, f, path);
  const nf = join(ROOT, '404.html');
  if (existsSync(nf)) return send(res, 404, nf, path);
  applyHeaders(res, path);
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found');
});

server.listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}`));
