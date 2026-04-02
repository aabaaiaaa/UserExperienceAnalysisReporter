/**
 * Lightweight HTTP server for serving the e2e test fixture web app.
 * Used during e2e test runs to serve the static HTML pages locally.
 *
 * Usage:
 *   import { startServer, stopServer } from './server.js';
 *   const { url, port } = await startServer();
 *   // ... run tests against url ...
 *   await stopServer();
 *
 * Or run directly:
 *   npx tsx tests/fixtures/e2e-app/server.ts
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const STATIC_DIR = path.dirname(fileURLToPath(import.meta.url));

let server: http.Server | null = null;

export function startServer(port = 0): Promise<{ url: string; port: number }> {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      let reqPath = req.url || '/';

      // Strip query strings
      reqPath = reqPath.split('?')[0];

      // Default to index.html
      if (reqPath === '/') {
        reqPath = '/index.html';
      }

      const filePath = path.resolve(STATIC_DIR, '.' + reqPath);

      // Security: prevent path traversal
      if (!filePath.startsWith(STATIC_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });

    server.on('error', reject);

    // port 0 = OS picks a free port
    server.listen(port, '127.0.0.1', () => {
      const addr = server!.address();
      if (typeof addr === 'object' && addr !== null) {
        const assignedPort = addr.port;
        resolve({ url: `http://127.0.0.1:${assignedPort}`, port: assignedPort });
      } else {
        reject(new Error('Failed to get server address'));
      }
    });
  });
}

export function stopServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }
    server.close((err) => {
      server = null;
      if (err) reject(err);
      else resolve();
    });
  });
}

// Allow running directly for manual testing
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js')
);

if (isDirectRun) {
  const port = parseInt(process.argv[2] || '3737', 10);
  startServer(port).then(({ url }) => {
    console.log(`E2E test fixture server running at ${url}`);
    console.log('Press Ctrl+C to stop.');
  });
}
