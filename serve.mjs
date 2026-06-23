// serve.mjs — Minimal static file server with correct MIME types for ES modules.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.argv[2] || '.';
const PORT = parseInt(process.argv[3] || '8765', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = normalize(join(ROOT, urlPath));
    if (!filePath.startsWith(normalize(ROOT))) { res.statusCode = 403; return res.end('Forbidden'); }
    const s = await stat(filePath);
    if (s.isDirectory()) { res.statusCode = 403; return res.end('Forbidden'); }
    const data = await readFile(filePath);
    res.setHeader('Content-Type', MIME[extname(filePath).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(data);
  } catch (e) {
    res.statusCode = 404;
    res.end('Not found');
  }
});

server.listen(PORT, () => console.log(`Serving ${ROOT} at http://localhost:${PORT}`));
