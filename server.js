const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 7005;
const DATA_FILE = path.join(__dirname, '..', 'brain-atlas-web', 'brain-data.json');
const JWT_SECRET_PATH = '/home/openclaw/sso-portal/.jwt-secret';
const SSO_LOGIN_URL = 'https://ihitgas.com/?redirect=';

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

// Load JWT secret for SSO verification
let jwtSecret = null;
try { jwtSecret = fs.readFileSync(JWT_SECRET_PATH, 'utf8').trim(); } catch {}

function verifyAuth(req) {
  if (!jwtSecret) return false;
  const match = (req.headers.cookie || '').match(/claudia_sso=([^;]+)/);
  if (!match) return false;
  try {
    const token = match[1];
    const parts = token.split('.');
    // 2-part token (HMAC signature)
    if (parts.length === 2) {
      if (parts[1] !== crypto.createHmac('sha256', jwtSecret).update(parts[0]).digest('base64url')) return false;
      try { const d = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); if (d.exp && d.exp < Date.now()) return false; } catch {}
      return true;
    }
    // 3-part JWT
    if (parts.length !== 3) return false;
    if (parts[2] !== crypto.createHmac('sha256', jwtSecret).update(parts[0] + '.' + parts[1]).digest('base64url')) return false;
    try { const d = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); if (d.exp && d.exp < Date.now()) return false; } catch {}
    return true;
  } catch { return false; }
}

function sendLoginRedirect(req, res) {
  // API requests get 401, page requests get redirect
  if (req.url.startsWith('/api/')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
  } else {
    const redirectUrl = SSO_LOGIN_URL + encodeURIComponent('https://' + (req.headers.host || '3dbrain.ihitgas.com') + req.url);
    res.writeHead(302, { Location: redirectUrl });
    res.end();
  }
}

const server = http.createServer((req, res) => {
  // Health check is always public
  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', service: '3d-brain', port: PORT }));
  }

  // API data requires auth
  if (req.url === '/api/data') {
    if (!verifyAuth(req)) return sendLoginRedirect(req, res);
    try {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch {
      res.writeHead(500); res.end(JSON.stringify({ error: 'Failed to load brain data' }));
    }
    return;
  }

  // Static files require auth
  if (!verifyAuth(req)) return sendLoginRedirect(req, res);

  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const ext = path.extname(filePath) || '.html';
  const fullPath = path.join(__dirname, 'public', filePath);

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(__dirname, 'public', 'index.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(d2);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`3D Brain Atlas running on port ${PORT}`);
});
