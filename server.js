/* Whisker Watch — server.js
   Zero-dependency Node server:
   - serves the app's static files
   - GET/POST /api/data  -> one shared JSON file, so phone + laptop stay in sync
   - rolling backups in data/backups on every save
   Run:  node server.js   (or double-click "Start Whisker Watch.bat")            */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const DATA_FILE = path.join(DATA_DIR, 'cat-data.json');
const PORT = Number(process.env.PORT) || 4780;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 20 * 1024 * 1024;        // 20 MB for the JSON doc
const MAX_MEDIA = 500 * 1024 * 1024;      // 500 MB per photo/video upload
const MAX_BACKUPS = 40;
const VERSION = '1.1.0';

fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });

// attachment types we accept for upload (extension -> served content type)
const MEDIA_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.heic': 'image/heic',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime'
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readDoc() {
  try {
    return fs.readFileSync(DATA_FILE, 'utf8');
  } catch (e) {
    return JSON.stringify({
      schema: 1, updatedAt: null, settings: null,
      cats: [], logs: [], meds: [], doses: [], treatments: [], visits: []
    });
  }
}

function writeDoc(text) {
  // back up the previous version first, then write atomically (tmp + rename)
  if (fs.existsSync(DATA_FILE)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    try {
      fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, 'cat-data-' + stamp + '.json'));
      const backups = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json')).sort();
      while (backups.length > MAX_BACKUPS) fs.unlinkSync(path.join(BACKUP_DIR, backups.shift()));
    } catch (e) { console.warn('backup skipped:', e.message); }
  }
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, DATA_FILE);
}

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach(name => {
    (nets[name] || []).forEach(net => {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    });
  });
  return out;
}

function handleApi(req, res, url) {
  if (url.pathname === '/api/data' && req.method === 'GET') {
    return send(res, 200, readDoc());
  }
  if (url.pathname === '/api/data' && (req.method === 'POST' || req.method === 'PUT')) {
    let body = '', size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { send(res, 413, '{"error":"too large"}'); req.destroy(); return; }
      body += chunk;
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const shape = parsed && typeof parsed === 'object' &&
          Array.isArray(parsed.cats) && Array.isArray(parsed.logs) &&
          Array.isArray(parsed.meds) && Array.isArray(parsed.treatments);
        if (!shape) return send(res, 400, '{"error":"not a whisker watch document"}');
        writeDoc(JSON.stringify(parsed, null, 2));
        return send(res, 200, JSON.stringify({ ok: true, updatedAt: parsed.updatedAt || null }));
      } catch (e) {
        return send(res, 400, JSON.stringify({ error: 'invalid JSON: ' + e.message }));
      }
    });
    return;
  }
  // upload a photo/video: POST /api/media?name=original-filename.mp4 -> { ok, id }
  if (url.pathname === '/api/media' && req.method === 'POST') {
    const orig = url.searchParams.get('name') || 'file';
    const ext = path.extname(orig).toLowerCase();
    if (!MEDIA_EXT[ext]) return send(res, 400, '{"error":"unsupported file type"}');
    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + ext;
    const dest = path.join(MEDIA_DIR, id);
    const out = fs.createWriteStream(dest);
    let size = 0, failed = false;
    function fail(code, msg) {
      if (failed) return;
      failed = true;
      out.destroy();
      fs.unlink(dest, function () { });
      send(res, code, JSON.stringify({ error: msg }));
    }
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_MEDIA) { fail(413, 'file too large'); req.destroy(); }
    });
    req.on('error', () => fail(500, 'upload interrupted'));
    out.on('error', () => fail(500, 'could not save file'));
    out.on('finish', () => { if (!failed) send(res, 200, JSON.stringify({ ok: true, id: id, size: size })); });
    req.pipe(out);
    return;
  }
  // serve / delete a stored file: /api/media/<id>  (GET supports Range so videos can seek)
  if (url.pathname.indexOf('/api/media/') === 0) {
    const id = path.basename(decodeURIComponent(url.pathname)); // basename blocks traversal
    const file = path.join(MEDIA_DIR, id);
    const type = MEDIA_EXT[path.extname(id).toLowerCase()] || 'application/octet-stream';
    if (req.method === 'GET') {
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) return send(res, 404, 'Not found', 'text/plain');
        const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
        if (m && (m[1] || m[2])) {
          const start = m[1] ? parseInt(m[1], 10) : 0;
          const end = m[2] ? Math.min(parseInt(m[2], 10), st.size - 1) : st.size - 1;
          if (isNaN(start) || start > end || start >= st.size) {
            res.writeHead(416, { 'Content-Range': 'bytes */' + st.size });
            return res.end();
          }
          res.writeHead(206, {
            'Content-Type': type, 'Content-Length': end - start + 1,
            'Content-Range': 'bytes ' + start + '-' + end + '/' + st.size,
            'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store'
          });
          return fs.createReadStream(file, { start: start, end: end }).pipe(res);
        }
        res.writeHead(200, {
          'Content-Type': type, 'Content-Length': st.size,
          'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store'
        });
        fs.createReadStream(file).pipe(res);
      });
      return;
    }
    if (req.method === 'DELETE') {
      fs.unlink(file, err => send(res, err ? 404 : 200, JSON.stringify({ ok: !err })));
      return;
    }
  }
  if (url.pathname === '/api/info' && req.method === 'GET') {
    let updatedAt = null;
    try { updatedAt = JSON.parse(readDoc()).updatedAt || null; } catch (e) { /* fresh file */ }
    return send(res, 200, JSON.stringify({
      ok: true,
      version: VERSION,
      updatedAt: updatedAt,
      port: PORT,
      urls: lanAddresses().map(ip => 'http://' + ip + ':' + PORT),
      dataFile: DATA_FILE
    }));
  }
  return send(res, 404, '{"error":"unknown endpoint"}');
}

function handleStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT) || file.startsWith(DATA_DIR)) {
    return send(res, 403, 'Forbidden', 'text/plain');
  }
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, buf, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  if (req.method !== 'GET') return send(res, 405, 'Method not allowed', 'text/plain');
  return handleStatic(req, res, url);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error('\nPort ' + PORT + ' is already in use — Whisker Watch may already be running.');
    console.error('Open http://localhost:' + PORT + ' in your browser, or close the other window first.\n');
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  Whisker Watch is running ✓');
  console.log('  ─────────────────────────────────────────────');
  console.log('  On this computer :  http://localhost:' + PORT);
  lanAddresses().forEach(ip => {
    console.log('  On your phone    :  http://' + ip + ':' + PORT + '   (same Wi-Fi)');
  });
  console.log('  Data file        :  ' + DATA_FILE);
  console.log('  Backups          :  ' + BACKUP_DIR);
  console.log('  ─────────────────────────────────────────────');
  console.log('  Keep this window open. Press Ctrl+C to stop.');
  console.log('');
});
