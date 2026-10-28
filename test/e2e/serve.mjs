// The game as GitHub Pages serves it: the repo's files, statically, on a free local port.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

export function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (err, body) => {
      if (err) return res.writeHead(404).end();
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(body);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: 'http://127.0.0.1:' + server.address().port + '/',
    close: () => new Promise((r) => server.close(r)),
  })));
}

// Collects page errors and failed checks; the process exits non-zero if there were any.
export function checks() {
  const errors = [];
  let failed = 0;
  const check = (ok, what) => {
    console.log((ok ? 'PASS ' : 'FAIL ') + what);
    if (!ok) failed++;
  };
  return {
    check,
    watch(page, label) {
      page.on('pageerror', (e) => errors.push(label + ' pageerror: ' + e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(label + ' console: ' + m.text()));
    },
    done() {
      check(errors.length === 0, 'no page errors' + (errors.length ? ':\n  ' + errors.join('\n  ') : ''));
      process.exitCode = failed ? 1 : 0;
    },
  };
}
