import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html';
    case '.js':
      return 'application/javascript';
    case '.css':
      return 'text/css';
    case '.json':
      return 'application/json';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'text/plain';
  }
}

function serveStatic(req, res, rootDir) {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/log') {
    console.log('[LOG FROM EXTENSION]', req.url);
    res.writeHead(200);
    res.end('ok');
    return;
  }
  if (reqPath === '/') reqPath = '/login-demo.html';

  let filePath = path.join(rootDir, reqPath);

  if (!fs.existsSync(filePath)) {
    // Check in shared/
    filePath = path.join(rootDir, 'shared', reqPath);
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': getMime(filePath),
    'Access-Control-Allow-Origin': '*',
  });
  fs.createReadStream(filePath).pipe(res);
}

// 1. Primary origin on :5173
const serverPrimary = http.createServer((req, res) => {
  serveStatic(req, res, __dirname);
});

serverPrimary.listen(5173, () => {
  console.log('✓ Primary test-site serving on http://localhost:5173');
});

// 2. Secondary origin on :5174 (for cross-origin iframe testing)
const serverSecondary = http.createServer((req, res) => {
  serveStatic(req, res, __dirname);
});

serverSecondary.listen(5174, () => {
  console.log('✓ Secondary test-site serving on http://localhost:5174');
});
