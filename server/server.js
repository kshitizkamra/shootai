require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { GoogleGenAI } = require('@google/genai');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'shootai-secret-change-in-production';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@shootai.com').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');

// ── Setup ──────────────────────────────────────────────────────────────────

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(ADMIN_FILE)) fs.writeFileSync(ADMIN_FILE, JSON.stringify({ apiKeys: {} }, null, 2));

// ── Middleware ─────────────────────────────────────────────────────────────

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

// Request logger — remove after debugging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

const BUILD_DIR = path.join(__dirname, '..', 'build');

// ── File helpers ───────────────────────────────────────────────────────────

function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; }
}
function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}
function readAdmin() {
  try { return JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8')); } catch { return { apiKeys: {} }; }
}
function writeAdmin(data) {
  fs.writeFileSync(ADMIN_FILE, JSON.stringify(data, null, 2));
}
function getUserDataDir(userId) {
  const dir = path.join(DATA_DIR, 'users', userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function readUserStore(userId, key) {
  try {
    const file = path.join(getUserDataDir(userId), `${key}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return null; }
}
function writeUserStore(userId, key, value) {
  fs.writeFileSync(path.join(getUserDataDir(userId), `${key}.json`), JSON.stringify(value, null, 2));
}
function getGlobalApiKeys() {
  return readAdmin().apiKeys || {};
}

// ── Audit log (append-only, admin-only read) ───────────────────────────────
function appendAuditLog(userId, entry) {
  try {
    const dir = path.join(DATA_DIR, 'audit');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${userId}.jsonl`);
    const line = JSON.stringify({ ts: new Date().toISOString(), userId, ...entry }) + '\n';
    fs.appendFileSync(file, line);
  } catch (e) {
    console.error('[audit] write error:', e.message);
  }
}
function readAuditLog(userId) {
  try {
    const file = path.join(DATA_DIR, 'audit', `${userId}.jsonl`);
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8')
      .split('\n').filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean)
      .reverse(); // newest first
  } catch { return []; }
}

// ── Credit helpers ─────────────────────────────────────────────────────────

function addTransaction(userId, type, amount, description) {
  const txFile = path.join(getUserDataDir(userId), 'transactions.json');
  let txs = [];
  try { txs = JSON.parse(fs.readFileSync(txFile, 'utf8')); } catch {}
  txs.unshift({ id: uuidv4(), type, amount, description, timestamp: new Date().toISOString() });
  if (txs.length > 500) txs = txs.slice(0, 500);
  fs.writeFileSync(txFile, JSON.stringify(txs, null, 2));
}

function checkAndDeductCredits(userId, amount) {
  const users = readUsers();
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) return { ok: false, error: 'User not found' };
  const bal = users[idx].credits || 0;
  if (bal < amount) return { ok: false, error: `Not enough credits. Need ${amount}, have ${bal}.` };
  users[idx].credits = bal - amount;
  users[idx].totalCreditsUsed = (users[idx].totalCreditsUsed || 0) + amount;
  writeUsers(users);
  return { ok: true };
}

function refundCredits(userId, amount, reason) {
  const users = readUsers();
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) return;
  users[idx].credits = (users[idx].credits || 0) + amount;
  users[idx].totalCreditsUsed = Math.max(0, (users[idx].totalCreditsUsed || 0) - amount);
  writeUsers(users);
  addTransaction(userId, 'credit_refunded', amount,
    `${amount} credit${amount > 1 ? 's' : ''} refunded (${reason})`);
}

// Sum itemCount across all batch_meta files where credits haven't been claimed yet.
// This is the "reserved" credit count for a user's currently running batches.
function getReservedCredits(userId) {
  const dir = getUserDataDir(userId);
  let reserved = 0;
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (!file.startsWith('batch_meta_') || !file.endsWith('.json')) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        if (!meta.creditsClaimed) reserved += (meta.itemCount || 0);
      } catch {}
    }
  } catch {}
  return reserved;
}

function recordImages(userId, count, creditCost) {
  const users = readUsers();
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) return;
  users[idx].totalImagesGenerated = (users[idx].totalImagesGenerated || 0) + count;
  writeUsers(users);
}

// ── Auth middleware ────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(h.slice(7), JWT_SECRET);
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    req.userRole = decoded.role || 'user';
    next();
  } catch { return res.status(401).json({ error: 'Invalid token' }); }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.userRole !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
  });
}

function requireActive(req, res, next) {
  if (req.userRole === 'admin') return next();
  const user = readUsers().find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.disabled) return res.status(403).json({ error: 'Account disabled. Contact admin.' });
  next();
}

// ── Auth routes ────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (email.toLowerCase() === ADMIN_EMAIL) return res.status(400).json({ error: 'This email is reserved.' });

    const users = readUsers();
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase()))
      return res.status(400).json({ error: 'Email already registered' });

    const newUser = {
      id: uuidv4(),
      email: email.toLowerCase(),
      name: name || email.split('@')[0],
      password: await bcrypt.hash(password, 10),
      role: 'user',
      credits: 0,
      totalImagesGenerated: 0,
      totalCreditsUsed: 0,
      totalCreditsAdded: 0,
      disabled: false,
      createdAt: new Date().toISOString(),
    };
    users.push(newUser);
    writeUsers(users);

    const token = jwt.sign({ userId: newUser.id, email: newUser.email, role: 'user' }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: newUser.id, email: newUser.email, name: newUser.name, role: 'user', credits: 0 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    // Admin login
    if (email.toLowerCase() === ADMIN_EMAIL) {
      if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid email or password' });
      const token = jwt.sign({ userId: 'admin', email: ADMIN_EMAIL, role: 'admin' }, JWT_SECRET, { expiresIn: '30d' });
      return res.json({ token, user: { id: 'admin', email: ADMIN_EMAIL, name: 'Admin', role: 'admin', credits: null } });
    }

    // Regular user
    const users = readUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (!await bcrypt.compare(password, user.password)) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.disabled) return res.status(403).json({ error: 'Account disabled. Contact admin.' });

    const token = jwt.sign({ userId: user.id, email: user.email, role: 'user' }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: 'user', credits: user.credits || 0 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  if (req.userRole === 'admin')
    return res.json({ id: 'admin', email: ADMIN_EMAIL, name: 'Admin', role: 'admin', credits: null });
  const user = readUsers().find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.disabled) return res.status(403).json({ error: 'Account disabled' });
  const ALL_WORKFLOWS = ['A', 'B', 'D', 'E', 'F'];
  const allowedWorkflows = user.allowedWorkflows || ALL_WORKFLOWS;
  res.json({ id: user.id, email: user.email, name: user.name, role: 'user', credits: user.credits || 0, allowedWorkflows });
});

// ── User routes ────────────────────────────────────────────────────────────

app.get('/api/user/credits', requireAuth, requireActive, (req, res) => {
  if (req.userRole === 'admin') return res.json({ credits: null, reserved: 0 });
  const user = readUsers().find(u => u.id === req.userId);
  const reserved = getReservedCredits(req.userId);
  res.json({ credits: user?.credits || 0, reserved });
});

app.get('/api/user/transactions', requireAuth, requireActive, (req, res) => {
  let txs = [];
  try { txs = JSON.parse(fs.readFileSync(path.join(getUserDataDir(req.userId), 'transactions.json'), 'utf8')); } catch {}
  res.json({ transactions: txs });
});

// ── Admin routes ───────────────────────────────────────────────────────────

app.get('/api/admin/apikeys', requireAdmin, (req, res) => {
  res.json({ apiKeys: getGlobalApiKeys() });
});

app.post('/api/admin/apikeys', requireAdmin, (req, res) => {
  const admin = readAdmin();
  admin.apiKeys = { ...admin.apiKeys, ...req.body };
  writeAdmin(admin);
  res.json({ ok: true });
});

const ALL_WORKFLOWS = ['A', 'B', 'D', 'E', 'F'];

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = readUsers().map(u => ({
    id: u.id, email: u.email, name: u.name,
    credits: u.credits || 0,
    totalImagesGenerated: u.totalImagesGenerated || 0,
    totalCreditsUsed: u.totalCreditsUsed || 0,
    totalCreditsAdded: u.totalCreditsAdded || 0,
    disabled: u.disabled || false,
    createdAt: u.createdAt,
    allowedWorkflows: u.allowedWorkflows || ALL_WORKFLOWS,
  }));
  res.json({ users });
});

app.post('/api/admin/users/:id/credits', requireAdmin, (req, res) => {
  const amount = parseInt(req.body.amount, 10); // rupee amount
  if (!amount || amount < 100 || amount % 100 !== 0)
    return res.status(400).json({ error: 'Amount must be a multiple of ₹100 (min ₹100)' });

  const credits = amount / 10; // ₹100 = 10 credits
  const users = readUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });

  users[idx].credits = (users[idx].credits || 0) + credits;
  users[idx].totalCreditsAdded = (users[idx].totalCreditsAdded || 0) + credits;
  writeUsers(users);
  addTransaction(req.params.id, 'credit_added', credits, `${credits} credits added`);

  res.json({ ok: true, credits: users[idx].credits, creditsAdded: credits,
    gst: +(amount * 0.18).toFixed(2), total: +(amount * 1.18).toFixed(2) });
});

app.post('/api/admin/users/:id/disable', requireAdmin, (req, res) => {
  const users = readUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  users[idx].disabled = true;
  writeUsers(users);
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/enable', requireAdmin, (req, res) => {
  const users = readUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  users[idx].disabled = false;
  writeUsers(users);
  res.json({ ok: true });
});

app.put('/api/admin/users/:id/workflows', requireAdmin, (req, res) => {
  const { allowedWorkflows } = req.body;
  if (!Array.isArray(allowedWorkflows)) return res.status(400).json({ error: 'allowedWorkflows must be an array' });
  const valid = allowedWorkflows.filter(w => ALL_WORKFLOWS.includes(w));
  const users = readUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  users[idx].allowedWorkflows = valid;
  writeUsers(users);
  res.json({ ok: true, allowedWorkflows: valid });
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const users = readUsers();
  const totalCreditsAdded = users.reduce((s, u) => s + (u.totalCreditsAdded || 0), 0);
  res.json({
    totalUsers: users.length,
    activeUsers: users.filter(u => !u.disabled).length,
    totalCreditsAdded,
    totalImagesGenerated: users.reduce((s, u) => s + (u.totalImagesGenerated || 0), 0),
    totalCreditsUsed: users.reduce((s, u) => s + (u.totalCreditsUsed || 0), 0),
    totalRevenue: totalCreditsAdded * 10, // ₹10 per credit
  });
});

// ── Backup / Restore ───────────────────────────────────────────────────────

app.get('/api/admin/backup', requireAdmin, (req, res) => {
  try {
    const backup = { version: 1, exportedAt: new Date().toISOString(), files: {} };

    function collectDir(dir, base) {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        const relPath = base ? `${base}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          collectDir(fullPath, relPath);
        } else if (entry.name.endsWith('.json')) {
          try { backup.files[relPath] = JSON.parse(fs.readFileSync(fullPath, 'utf8')); } catch {}
        }
      }
    }

    collectDir(DATA_DIR, '');
    const filename = `shootai-backup-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(backup, null, 2));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/restore', requireAdmin, (req, res) => {
  try {
    const { version, files } = req.body;
    if (!files || typeof files !== 'object') return res.status(400).json({ error: 'Invalid backup format.' });

    let restored = 0;
    for (const [relPath, data] of Object.entries(files)) {
      // Safety: only allow .json files inside data dir, no path traversal
      if (!relPath.endsWith('.json') || relPath.includes('..')) continue;
      const fullPath = path.join(DATA_DIR, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
      restored++;
    }
    res.json({ ok: true, restored });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Audit log routes (admin only) ─────────────────────────────────────────

app.get('/api/admin/shopify-img/:filename', requireAdmin, (req, res) => {
  res.sendFile(path.join(DATA_DIR, 'shopify', req.params.filename));
});

app.get('/api/admin/audit', requireAdmin, (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    // Return list of users that have audit logs
    try {
      const dir = path.join(DATA_DIR, 'audit');
      if (!fs.existsSync(dir)) return res.json({ entries: [] });
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
      const users = readUsers();
      const summary = files.map(f => {
        const uid = f.replace('.jsonl', '');
        const user = users.find(u => u.id === uid);
        const entries = readAuditLog(uid);
        const credits = entries.filter(e => e.event === 'batch_submitted' || e.event === 'realtime_generated')
          .reduce((sum, e) => sum + (e.credits || 0), 0);
        return { userId: uid, email: user?.email || uid, totalEntries: entries.length, totalCreditsUsed: credits, lastActivity: entries[0]?.ts || null };
      });
      return res.json({ summary });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }
  res.json({ entries: readAuditLog(userId) });
});

// ── Store routes ───────────────────────────────────────────────────────────

app.get('/api/store/:key', requireAuth, requireActive, (req, res) => {
  const uid = req.userRole === 'admin' ? 'admin' : req.userId;
  res.json({ value: readUserStore(uid, req.params.key) });
});

app.post('/api/store/:key', requireAuth, requireActive, (req, res) => {
  try {
    const uid = req.userRole === 'admin' ? 'admin' : req.userId;
    writeUserStore(uid, req.params.key, req.body.value);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ── Prompt Templates ──────────────────────────────────────────────────────

const PROMPT_TEMPLATES_FILE = path.join(DATA_DIR, 'prompt_templates.json');
const PROMPT_TEMPLATES_SEED = path.join(__dirname, 'prompt_templates.seed.json');

if (!fs.existsSync(PROMPT_TEMPLATES_FILE) && fs.existsSync(PROMPT_TEMPLATES_SEED)) {
  fs.copyFileSync(PROMPT_TEMPLATES_SEED, PROMPT_TEMPLATES_FILE);
  console.log('[server] prompt_templates.json seeded from seed file');
} else if (fs.existsSync(PROMPT_TEMPLATES_FILE) && fs.existsSync(PROMPT_TEMPLATES_SEED)) {
  try {
    const existing = JSON.parse(fs.readFileSync(PROMPT_TEMPLATES_FILE, 'utf8'));
    const seed = JSON.parse(fs.readFileSync(PROMPT_TEMPLATES_SEED, 'utf8'));
    let merged = false;
    for (const key of Object.keys(seed)) {
      if (!(key in existing)) {
        existing[key] = seed[key];
        merged = true;
        console.log(`[server] prompt_templates.json: added missing key "${key}" from seed`);
      }
    }
    if (merged) fs.writeFileSync(PROMPT_TEMPLATES_FILE, JSON.stringify(existing, null, 2));
  } catch (e) {
    console.error('[server] prompt_templates merge error:', e.message);
  }
}

function readPromptTemplates() {
  try {
    if (fs.existsSync(PROMPT_TEMPLATES_FILE)) {
      return JSON.parse(fs.readFileSync(PROMPT_TEMPLATES_FILE, 'utf8'));
    }
  } catch {}
  return null;
}

app.get('/api/prompt-templates', requireAuth, (req, res) => {
  const t = readPromptTemplates();
  if (!t) return res.status(404).json({ error: 'Templates not found' });
  res.json(t);
});

app.put('/api/admin/prompt-templates', requireAdmin, (req, res) => {
  try {
    fs.writeFileSync(PROMPT_TEMPLATES_FILE, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Swatch tiling ─────────────────────────────────────────────────────────

app.post('/api/tile-swatch', requireAuth, requireActive, async (req, res) => {
  const { swatchBase64, repeatW, repeatH, cmW, cmH } = req.body;
  if (!swatchBase64 || !repeatW || !repeatH)
    return res.status(400).json({ error: 'swatchBase64, repeatW, and repeatH required' });

  try {
    const buf = Buffer.from(swatchBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    const meta = await sharp(buf).metadata();
    const srcW = meta.width;
    const srcH = meta.height;

    const tileW = Math.max(4, Math.min(Math.round(repeatW), srcW));
    const tileH = Math.max(4, Math.min(Math.round(repeatH), srcH));

    let cols = 2;
    let rows = 2;
    if (cmW && cmW > 0) {
      cols = Math.max(2, Math.round(50 / cmW));
    }
    if (cmH && cmH > 0) {
      rows = Math.max(2, Math.round(100 / cmH));
    }

    cols = Math.min(cols, 20);
    rows = Math.min(rows, 20);

    let targetOutW = tileW * cols;
    let targetOutH = tileH * rows;
    
    let scale = 1;
    if (targetOutW > 1024 || targetOutH > 1024) {
      scale = Math.min(1024 / targetOutW, 1024 / targetOutH);
    }
    
    const outW = Math.round(targetOutW * scale);
    const outH = Math.round(targetOutH * scale);
    
    const scaledTileW = Math.round(outW / cols);
    const scaledTileH = Math.round(outH / rows);

    const finalOutW = scaledTileW * cols;
    const finalOutH = scaledTileH * rows;

    const tile = await sharp(buf)
      .extract({ left: 0, top: 0, width: tileW, height: tileH })
      .resize(scaledTileW, scaledTileH, { fit: 'fill' })
      .toBuffer();

    const compositeInputs = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        compositeInputs.push({ input: tile, top: r * scaledTileH, left: c * scaledTileW });
      }
    }

    const tiled = await sharp({ create: { width: finalOutW, height: finalOutH, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .composite(compositeInputs)
      .jpeg({ quality: 90 })
      .toBuffer();

    res.json({ tiledBase64: 'data:image/jpeg;base64,' + tiled.toString('base64'), cols, rows });
  } catch (e) {
    console.error('[tile-swatch] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── AI routes ──────────────────────────────────────────────────────────────

app.post('/api/ai/test-connection', requireAdmin, async (req, res) => {
  const { openaiKey } = getGlobalApiKeys();
  if (!openaiKey) return res.status(400).json({ error: 'No OpenAI key set.' });
  try {
    await axios.get('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${openaiKey}` }, timeout: 10000,
    });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.response?.data?.error?.message || e.message }); }
});

// ── Gemini generate (instant — 3 credits) ─────────────────────────────────

const instantJobQueue = new Map();

app.get('/api/ai/instant-job-status/:groupId', requireAuth, (req, res) => {
  const job = instantJobQueue.get(req.params.groupId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.uid !== (req.userRole === 'admin' ? 'admin' : req.userId) && req.userRole !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  res.json({
    status: job.status,
    done: job.done,
    total: job.total,
    results: job.results
  });
});

app.post('/api/ai/queue-instant-jobs', requireAuth, requireActive, async (req, res) => {
  const { requests } = req.body;
  if (!Array.isArray(requests) || requests.length === 0) return res.status(400).json({ error: 'Requests array required' });
  
  const { googleKey } = getGlobalApiKeys();
  if (!googleKey) return res.status(400).json({ error: 'Service not configured. Contact admin.' });

  const isAdmin = req.userRole === 'admin';
  const totalCredits = requests.length * 3;
  const uid = isAdmin ? 'admin' : req.userId;
  
  if (!isAdmin) {
    const check = checkAndDeductCredits(uid, totalCredits);
    if (!check.ok) return res.status(402).json({ error: check.error });
  }

  const groupId = 'group_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
  
  instantJobQueue.set(groupId, {
    uid,
    status: 'running',
    done: 0,
    total: requests.length,
    results: []
  });

  res.json({ groupId, status: 'started', total: requests.length });

  // Async processing loop
  (async () => {
    const jobState = instantJobQueue.get(groupId);
    const { GoogleGenAI } = require('@google/genai');
    const ai = new GoogleGenAI({ apiKey: googleKey });
    
    for (let i = 0; i < requests.length; i++) {
      const reqData = requests[i];
      const { model, images, prompt, aspectRatio, imageSize, historyMeta, key } = reqData;
      let finalB64 = '';
      let errorStr = '';

      try {
        const parts = [];
        for (const img of (images || [])) {
          const data = img.replace(/^data:image\/\w+;base64,/, '');
          const mimeType = img.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
          const buffer = Buffer.from(data, 'base64');
          const blob = new Blob([buffer], { type: mimeType });
          const uploaded = await ai.files.upload({ file: blob, config: { mimeType, displayName: 'shootai_instant' } });
          parts.push({ fileData: { fileUri: uploaded.uri, mimeType } });
        }
        parts.push({ text: prompt });

        let modelId = model || 'gemini-3.1-flash-image';
        if (modelId === 'gemini-2.0-flash-preview-image-generation' || modelId === 'gemini-3-pro-image') {
          modelId = 'gemini-3.1-flash-image';
        }
        const config = { 
          responseModalities: ['IMAGE'],
          candidateCount: 1,
          imageConfig: { aspectRatio: aspectRatio || '3:4', imageSize: imageSize || '1K' }
        };
        
        let response;
        let retries = 3;
        while (retries > 0) {
          try {
            response = await ai.models.generateContent({ model: modelId, contents: parts, config });
            break;
          } catch (err) {
            if (err.status === 503 || (err.message && err.message.includes('503'))) {
              retries--;
              if (retries === 0) throw err;
              await new Promise(r => setTimeout(r, 2000));
            } else {
              throw err;
            }
          }
        }

        const candidate = response.candidates?.[0];
        if (!candidate) {
          throw new Error('No response from Gemini');
        }

        let foundImg = false;
        for (const part of (candidate.content?.parts || [])) {
          if (part.inlineData?.data || part.inlineData?.data?.length) {
            let b64 = part.inlineData.data;
            if (typeof b64 !== 'string') b64 = Buffer.from(b64).toString('base64');
            const mime = part.inlineData.mimeType || 'image/png';
            finalB64 = b64.startsWith('data:') ? b64 : `data:${mime};base64,${b64}`;
            foundImg = true;
            break;
          }
        }
        if (!foundImg) throw new Error('Gemini returned no image');
        
        if (!isAdmin) {
          recordImages(uid, 1);
        }
        appendAuditLog(uid, { event: 'realtime_generated', engine: 'gemini', credits: isAdmin ? 0 : 3 });

        if (historyMeta) {
          const history = readUserStore(uid, 'history') || [];
          history.unshift({ 
            ...historyMeta, 
            id: `gen_${Date.now()}`, 
            createdAt: new Date().toISOString(), 
            imageData: finalB64,
            source: 'instant_queue'
          });
          writeUserStore(uid, 'history', history.slice(0, 40));
        }

      } catch (e) {
        errorStr = e.response?.data?.error?.message || e.message;
        if (!isAdmin) refundCredits(uid, 3, 'generation error');
      }

      jobState.results.push({
        key,
        status: finalB64 ? 'done' : 'error',
        base64: finalB64,
        error: errorStr
      });
      jobState.done += 1;
    }
    
    jobState.status = 'completed';
    setTimeout(() => {
      instantJobQueue.delete(groupId);
    }, 60 * 60 * 1000); // clear after 1 hour
  })();
});

app.post('/api/ai/gemini-generate', requireAuth, requireActive, async (req, res) => {
  const { model, images, prompt, aspectRatio, imageSize } = req.body;
  const { googleKey } = getGlobalApiKeys();
  if (!googleKey) return res.status(400).json({ error: 'Service not configured. Contact admin.' });

  const isAdmin = req.userRole === 'admin';
  if (!isAdmin) {
    const check = checkAndDeductCredits(req.userId, 3);
    if (!check.ok) return res.status(402).json({ error: check.error });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: googleKey });

    const parts = [];
    for (const img of (images || [])) {
      const data = img.replace(/^data:image\/\w+;base64,/, '');
      const mimeType = img.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      const buffer = Buffer.from(data, 'base64');
      const blob = new Blob([buffer], { type: mimeType });
      const uploaded = await ai.files.upload({ file: blob, config: { mimeType, displayName: 'shootai_instant' } });
      parts.push({ fileData: { fileUri: uploaded.uri, mimeType } });
    }
    parts.push({ text: prompt });

    let modelId = model || 'gemini-3.1-flash-image';
    if (modelId === 'gemini-2.0-flash-preview-image-generation' || modelId === 'gemini-3-pro-image') {
      modelId = 'gemini-3.1-flash-image';
    }
    const config = { 
      responseModalities: ['IMAGE'],
      candidateCount: 1,
      imageConfig: { aspectRatio: aspectRatio || '3:4', imageSize: imageSize || '1K' }
    };
    
    let response;
    let retries = 3;
    while (retries > 0) {
      try {
        response = await ai.models.generateContent({
          model: modelId,
          contents: parts,
          config
        });
        break;
      } catch (err) {
        if (err.status === 503 || (err.message && err.message.includes('503'))) {
          retries--;
          if (retries === 0) throw err;
          await new Promise(r => setTimeout(r, 2000)); // wait 2 seconds before retry
        } else {
          throw err;
        }
      }
    }

    const candidate = response.candidates?.[0];
    if (!candidate) {
      if (!isAdmin) refundCredits(req.userId, 3, 'no response');
      return res.status(500).json({ error: 'No response from Gemini' });
    }

    for (const part of (candidate.content?.parts || [])) {
      if (part.inlineData?.data || part.inlineData?.data?.length) {
        let b64 = part.inlineData.data;
        if (typeof b64 !== 'string') b64 = Buffer.from(b64).toString('base64');
        const mime = part.inlineData.mimeType || 'image/png';
        if (!isAdmin) {
          addTransaction(req.userId, 'credit_used', 3, '3 credits used (instant generation)');
          recordImages(req.userId, 1);
        }
        appendAuditLog(req.userId, { event: 'realtime_generated', engine: 'gemini', credits: isAdmin ? 0 : 3 });
        const finalB64 = b64.startsWith('data:') ? b64 : `data:${mime};base64,${b64}`;
        return res.json({ base64: finalB64 });
      }
    }
    if (!isAdmin) refundCredits(req.userId, 3, 'no image returned');
    res.status(500).json({ error: 'Gemini returned no image' });
  } catch (e) {
    if (!isAdmin) refundCredits(req.userId, 3, 'generation error');
    res.status(500).json({ error: e.response?.data?.error?.message || e.message });
  }
});

// ── OpenAI generate (instant — 3 credits) ─────────────────────────────────

app.post('/api/ai/openai-generate', requireAuth, requireActive, async (req, res) => {
  const { prompt, quality } = req.body;
  const { openaiKey } = getGlobalApiKeys();
  if (!openaiKey) return res.status(400).json({ error: 'Service not configured. Contact admin.' });

  const isAdmin = req.userRole === 'admin';
  if (!isAdmin) {
    const check = checkAndDeductCredits(req.userId, 3);
    if (!check.ok) return res.status(402).json({ error: check.error });
  }

  try {
    const response = await axios.post('https://api.openai.com/v1/images/generations', {
      model: 'gpt-image-1', prompt, n: 1,
      size: '1024x1536', quality: quality || 'high', response_format: 'b64_json',
    }, { headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' }, timeout: 120000 });

    const b64 = response.data.data?.[0]?.b64_json;
    if (!b64) {
      if (!isAdmin) refundCredits(req.userId, 3, 'no image returned');
      return res.status(500).json({ error: 'No image returned' });
    }
    if (!isAdmin) {
      addTransaction(req.userId, 'credit_used', 3, '3 credits used (instant generation)');
      recordImages(req.userId, 1);
    }
    appendAuditLog(req.userId, { event: 'realtime_generated', engine: 'openai', credits: isAdmin ? 0 : 3 });
    res.json({ base64: `data:image/png;base64,${b64}` });
  } catch (e) {
    if (!isAdmin) refundCredits(req.userId, 3, 'generation error');
    res.status(500).json({ error: e.response?.data?.error?.message || e.message });
  }
});

// ── OpenAI multi-image (instant — 3 credits) ──────────────────────────────

app.post('/api/ai/openai-multi', requireAuth, requireActive, async (req, res) => {
  const { images, prompt, quality } = req.body;
  const { openaiKey } = getGlobalApiKeys();
  if (!openaiKey) return res.status(400).json({ error: 'Service not configured. Contact admin.' });

  const isAdmin = req.userRole === 'admin';
  if (!isAdmin) {
    const check = checkAndDeductCredits(req.userId, 3);
    if (!check.ok) return res.status(402).json({ error: check.error });
  }

  try {
    const content = (images || []).map(img => ({
      type: 'input_image',
      source: { type: 'base64', media_type: 'image/jpeg', data: img.replace(/^data:image\/\w+;base64,/, '') },
    }));
    content.push({ type: 'text', text: prompt });

    const response = await axios.post('https://api.openai.com/v1/images/generations', {
      model: 'gpt-image-1', input: content, n: 1,
      size: '1024x1536', quality: quality || 'high', response_format: 'b64_json',
    }, { headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' }, timeout: 120000 });

    const b64 = response.data.data?.[0]?.b64_json;
    if (!b64) {
      if (!isAdmin) refundCredits(req.userId, 3, 'no image returned');
      return res.status(500).json({ error: 'No image returned' });
    }
    if (!isAdmin) {
      addTransaction(req.userId, 'credit_used', 3, '3 credits used (instant generation)');
      recordImages(req.userId, 1);
    }
    appendAuditLog(req.userId, { event: 'realtime_generated', engine: 'openai-multi', credits: isAdmin ? 0 : 3 });
    res.json({ base64: `data:image/png;base64,${b64}` });
  } catch (e) {
    if (!isAdmin) refundCredits(req.userId, 3, 'generation error');
    res.status(500).json({ error: e.response?.data?.error?.message || e.message });
  }
});

// ── OpenAI edit (instant — 3 credits) ─────────────────────────────────────

app.post('/api/ai/openai-edit', requireAuth, requireActive, async (req, res) => {
  const { imageBase64, prompt, quality } = req.body;
  const { openaiKey } = getGlobalApiKeys();
  if (!openaiKey) return res.status(400).json({ error: 'Service not configured. Contact admin.' });

  const isAdmin = req.userRole === 'admin';
  if (!isAdmin) {
    const check = checkAndDeductCredits(req.userId, 3);
    if (!check.ok) return res.status(402).json({ error: check.error });
  }

  try {
    const response = await axios.post('https://api.openai.com/v1/images/edits', {
      model: 'gpt-image-1', image: imageBase64.replace(/^data:image\/\w+;base64,/, ''),
      prompt, n: 1, size: '1024x1536', quality: quality || 'high', response_format: 'b64_json',
    }, { headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' }, timeout: 120000 });

    const b64 = response.data.data?.[0]?.b64_json;
    if (!b64) {
      if (!isAdmin) refundCredits(req.userId, 3, 'no image returned');
      return res.status(500).json({ error: 'No image returned' });
    }
    if (!isAdmin) {
      addTransaction(req.userId, 'credit_used', 3, '3 credits used (instant generation)');
      recordImages(req.userId, 1);
    }
    res.json({ base64: `data:image/png;base64,${b64}` });
  } catch (e) {
    if (!isAdmin) refundCredits(req.userId, 3, 'generation error');
    res.status(500).json({ error: e.response?.data?.error?.message || e.message });
  }
});

// ── Gemini batch (1 credit per successful image) ───────────────────────────
// Uses @google/genai SDK — matches desktop electron.js exactly

// Per-user lock: prevents duplicate Gemini batch jobs from double-clicks, retries, or deploys
// Disk-based so it survives PM2 restarts — in-memory Set would be cleared on every deploy
const SUBMISSION_LOCK_TTL = 10 * 60 * 1000; // 10 minutes

function getSubmissionLockPath(uid) {
  return path.join(getUserDataDir(uid), 'submission_lock.json');
}

function hasSubmissionLock(uid) {
  try {
    const lockPath = getSubmissionLockPath(uid);
    if (!fs.existsSync(lockPath)) return false;
    const { ts } = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (Date.now() - ts > SUBMISSION_LOCK_TTL) {
      fs.unlinkSync(lockPath); // stale lock — clean up
      return false;
    }
    return true;
  } catch { return false; }
}

function acquireSubmissionLock(uid) {
  fs.writeFileSync(getSubmissionLockPath(uid), JSON.stringify({ ts: Date.now() }));
}

function releaseSubmissionLock(uid) {
  try { fs.unlinkSync(getSubmissionLockPath(uid)); } catch {}
}

// Background task: uploads images to File API, calls ai.batches.create(), maps temp → real job name.
// The HTTP endpoint responds immediately with a temp name so the client isn't
// blocked waiting for Gemini to accept image data.
async function createBatchJobAsync(googleKey, rawRequests, uid, tempId, itemCount, userId, resolution) {
  // Unique trace ID — lets us confirm exactly how many times this function is entered per submission
  const traceId = Math.random().toString(36).substr(2, 6).toUpperCase();
  console.log(`[Batch Submit ${traceId}] ENTER — tempId=${tempId} items=${rawRequests.length}`);
  // Two separate SDK instances:
  //   aiUpload — attempts:1 (SDK retries file uploads on 429; safe, no duplicate risk)
  //   aiBatch  — attempts:0 (no retries on batches.create; any retry creates a duplicate batch)
  const aiUpload = new GoogleGenAI({ apiKey: googleKey, httpOptions: { retryOptions: { attempts: 1 } } });
  const aiBatch  = new GoogleGenAI({ apiKey: googleKey, httpOptions: { retryOptions: { attempts: 0 } } });
  const uniqueImages = new Map(); // base64 → { mimeType, uri, name }
  try {
    // ── Step 1: Deduplicate images across all requests ────────────────────────
    // A 5-shot batch reuses the same model/product/background images repeatedly.
    // Dedup means we upload each unique image once, not once per shot.
    for (const r of rawRequests) {
      for (const img of (r.images || [])) {
        if (!uniqueImages.has(img)) {
          const mimeType = img.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
          uniqueImages.set(img, { mimeType, uri: null, name: null });
        }
      }
    }
    const totalRefs = rawRequests.reduce((s, r) => s + (r.images || []).length, 0);
    console.log(`[Batch Submit ${traceId}] Uploading ${uniqueImages.size} unique images to File API (${totalRefs} total refs across ${rawRequests.length} items)`);

    // ── Step 2: Upload each unique image in parallel ──────────────────────────
    // Retries once on 429 (rate limit) — safe because a failed upload creates nothing on Google's side.
    const uploadWithRetry = async (b64, meta) => {
      const data = b64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(data, 'base64');
      const blob = new Blob([buffer], { type: meta.mimeType });
      // aiUpload has attempts:1 — SDK handles the 429 retry automatically
      const uploaded = await aiUpload.files.upload({ file: blob, config: { mimeType: meta.mimeType, displayName: 'shootai_batch_img' } });
      meta.uri = uploaded.uri;
      meta.name = uploaded.name;
    };
    await Promise.all([...uniqueImages.entries()].map(([b64, meta]) => uploadWithRetry(b64, meta)));
    console.log(`[Batch Submit ${traceId}] All images uploaded. Sending ${rawRequests.length} items to Google`);

    // ── Step 3: Build batch requests using fileData URIs (~2KB vs ~15MB) ──────
    const inlinedRequests = rawRequests.map(r => {
      const parts = [{ text: r.prompt }];
      for (const img of (r.images || [])) {
        const meta = uniqueImages.get(img);
        parts.push({ fileData: { fileUri: meta.uri, mimeType: meta.mimeType } });
      }
      return {
        contents: [{ role: 'user', parts }],
        config: {
          responseModalities: ['IMAGE'],  // IMAGE only — TEXT was causing Gemini to run 2 passes per item (double billing)
          candidateCount: 1,              // Explicit 1 — default was likely 2, causing 2 images generated per item
          imageConfig: { aspectRatio: r.aspectRatio || '3:4', imageSize: '1K' },
        },
      };
    });

    // Log exactly what we're sending so we can verify candidateCount in logs
    console.log(`[Batch Submit ${traceId}] Request config sample: ${JSON.stringify(inlinedRequests[0]?.config)}`);
    console.log(`[Batch Submit ${traceId}] Total inlinedRequests: ${inlinedRequests.length} (expected: ${rawRequests.length})`);

    // aiBatch has attempts:0 — no SDK retry; a retry here would create a duplicate batch job
    console.log(`[Batch Submit ${traceId}] Calling batches.create...`);
    const job = await aiBatch.batches.create({ model: 'models/gemini-3.1-flash-image', src: inlinedRequests, config: { displayName: `shootai_${Date.now()}` } });
    console.log(`[Batch Submit ${traceId}] batches.create returned: ${job.name}`);

    // NOTE: Do NOT delete uploaded files here — Google processes the batch asynchronously
    // and needs the file URIs to remain accessible until their workers finish.
    // Files auto-expire after 48h on Google's side.

    const realJobId = job.name.split('/').pop();
    // Save real job metadata for credit tracking
    writeUserStore(uid, `batch_meta_${realJobId}`, {
      name: job.name,
      itemCount,
      creditsClaimed: false,
      userId,
      resolution: resolution || '1080x1440',
    });
    // Map temp → real name, and clear temp credit reservation
    writeUserStore(uid, `batch_tempmap_${tempId}`, { realName: job.name });
    const tempMeta = readUserStore(uid, `batch_meta_${tempId}`);
    if (tempMeta && !tempMeta.creditsClaimed) {
      writeUserStore(uid, `batch_meta_${tempId}`, { ...tempMeta, creditsClaimed: true });
    }
    console.log(`[batch-submit] temp=${tempId} → real=${realJobId}`);
    appendAuditLog(uid, { event: 'batch_submitted', jobId: realJobId, geminiName: job.name, itemCount, credits: itemCount });
  } catch (e) {
    console.error(`[batch-submit error] temp=${tempId}`, e.message);
    writeUserStore(uid, `batch_tempmap_${tempId}`, { failed: true, error: e.message });
    // Clear temp credit reservation on failure
    const tempMeta = readUserStore(uid, `batch_meta_${tempId}`);
    if (tempMeta && !tempMeta.creditsClaimed) {
      writeUserStore(uid, `batch_meta_${tempId}`, { ...tempMeta, creditsClaimed: true });
    }
  } finally {
    releaseSubmissionLock(uid); // always release — early lock position closes the race window
  }
}

app.post('/api/ai/gemini-batch-create', requireAuth, requireActive, async (req, res) => {
  const { requests, submissionId } = req.body;
  console.log(`[batch-create-hit] submissionId=${submissionId} items=${(requests||[]).length} uid=${req.userId} ip=${req.ip} at=${new Date().toISOString()}`);
  const { googleKey } = getGlobalApiKeys();
  if (!googleKey) return res.status(400).json({ error: 'Service not configured. Contact admin.' });

  const isAdmin = req.userRole === 'admin';
  const uid = isAdmin ? 'admin' : req.userId;

  // ── Idempotency check — catches socket-level retries that duplicate the request ──
  // The client generates a unique submissionId per submit click. If we've already
  // processed this ID, return the existing job instead of creating a second batch.
  if (submissionId) {
    const existing = readUserStore(uid, `idem_${submissionId}`);
    if (existing) {
      console.log(`[Batch Submit] Duplicate request detected (submissionId=${submissionId}), returning existing job ${existing.name}`);
      return res.json({ name: existing.name, state: 'JOB_STATE_PENDING' });
    }
  }

  // Check lock FIRST — before any heavy CPU work — to close the race window
  if (hasSubmissionLock(uid)) {
    return res.status(429).json({ error: 'A batch is already being submitted. Please wait a moment.' });
  }
  acquireSubmissionLock(uid);

  if (!isAdmin) {
    const user = readUsers().find(u => u.id === req.userId);
    const balance = user?.credits || 0;
    const reserved = getReservedCredits(req.userId);
    const requested = (requests || []).length;
    const available = balance - reserved;
    if (available < requested) {
      releaseSubmissionLock(uid); // release — credits check failed, not a real submission
      return res.status(402).json({
        error: `Not enough credits. This batch needs ${requested} credit${requested !== 1 ? 's' : ''}, but you have ${available} available (${balance} total − ${reserved} reserved for running batches).`,
      });
    }
  }

  try {
    // Pass raw requests to background task — File API upload happens there
    const rawRequests = [...(requests || [])];
    req.body = null; // allow GC to collect parsed request body

    // Generate a temp name — client stores this immediately, no waiting
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const tempName = `submitting/${tempId}`;

    // Reserve credits using temp ID so the counter stays accurate
    writeUserStore(uid, `batch_meta_${tempId}`, {
      name: tempName,
      itemCount: rawRequests.length,
      creditsClaimed: false,
      userId: isAdmin ? null : req.userId,
    });

    // Lock in the idempotency key so any duplicate request returns this job
    if (submissionId) {
      writeUserStore(uid, `idem_${submissionId}`, { name: tempName, createdAt: new Date().toISOString() });
    }

    // Fire-and-forget — File API upload + Gemini batch create happen in background
    const batchResolution = rawRequests[0]?.resolution || '1080x1440';
    createBatchJobAsync(googleKey, rawRequests, uid, tempId, rawRequests.length, isAdmin ? null : req.userId, batchResolution);

    // Respond immediately so the client isn't blocked
    res.json({ name: tempName, state: 'JOB_STATE_PENDING', createTime: new Date().toISOString() });
  } catch (e) {
    releaseSubmissionLock(uid); // prep failed — release so user can retry
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Track in-progress background fetches so we don't double-fetch
// Keys: `${uid}:${jobId}` for status checks, `${uid}:${jobId}:dl` for image downloads
const ongoingBatchFetches = new Map();

// Normalize state strings — REST API sometimes returns short form e.g. "SUCCEEDED"
// instead of "JOB_STATE_SUCCEEDED". This ensures all downstream checks work either way.
function normalizeState(s) {
  if (!s) return s;
  if (!s.startsWith('JOB_STATE_')) return 'JOB_STATE_' + s;
  return s;
}

// Phase 1: Fast status-only check via REST — no image download.
// Uses axios (not fetch) so it works on Node 14/16 where fetch isn't global.
// No-cache headers prevent GCE network layers from returning stale responses.
// fields param limits response to status fields only — excludes inline image data so this
// call never triggers GCE billing (only downloadBatchImages does the billable retrieval).
async function checkBatchState(googleKey, name) {
  // &fields= tells Gemini to return only these fields — no inline responses, no billing
  const url = `https://generativelanguage.googleapis.com/v1beta/${name}?key=${encodeURIComponent(googleKey)}&fields=name%2Cdone%2Cmetadata%2Cerror%2Cstate`;
  try {
    const { data } = await axios.get(url, {
      timeout: 20000,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
    // LRO format: { done: bool, metadata: { state: '...' }, error: {...} }
    if (data.done !== undefined) {
      if (data.error) throw new Error(data.error.message);
      return data.done ? 'JOB_STATE_SUCCEEDED' : 'JOB_STATE_RUNNING';
    }
    // Gemini returns { metadata: { state: 'JOB_STATE_...' } } without top-level done
    if (data.metadata?.state) return normalizeState(data.metadata.state);
    // Direct batch format fallback
    if (data.state) return normalizeState(data.state);
    throw new Error("API response missing 'state', 'done', or 'metadata.state'.");
  } catch (e) {
    if (e.response?.status === 404) return 'JOB_STATE_NOT_FOUND';
    throw new Error(`REST check failed: ${e.response?.status || e.code || e.message}`);
  }
}

// Phase 2: Full image download — only runs after state is confirmed SUCCEEDED.
// Uses axios directly (not SDK) to avoid potential Node-version or OOM issues
// with the SDK's batches.get() bundling everything into one response.
// Tracks failures — after 3 attempts, gives up to prevent infinite DOWNLOADING loop.
async function downloadBatchImages(googleKey, name, uid, jobId) {
  const failKey = `${uid}:${jobId}:fails`;
  const failCount = ongoingBatchFetches.get(failKey) || 0;

  // After 3 failed attempts, stop retrying and save empty results so UI unblocks
  if (failCount >= 3) {
    console.error(`[batch-dl] Job ${jobId} failed ${failCount} times — saving empty results`);
    writeUserStore(uid, `batch_results_${jobId}`, []);
    const meta = readUserStore(uid, `batch_meta_${jobId}`);
    if (meta && !meta.creditsClaimed) {
      writeUserStore(uid, `batch_meta_${jobId}`, { ...meta, creditsClaimed: true });
    }
    ongoingBatchFetches.delete(failKey);
    ongoingBatchFetches.delete(`${uid}:${jobId}:dl`);
    return;
  }

  // Skip if results already saved — handles server restart after a completed download
  const existingResults = readUserStore(uid, `batch_results_${jobId}`);
  if (existingResults) {
    console.log(`[batch-dl] Job ${jobId} already downloaded — skipping`);
    ongoingBatchFetches.delete(`${uid}:${jobId}:dl`);
    return;
  }

  // Claim credits optimistically BEFORE download — prevents double deduction if server restarts mid-download
  const preMeta = readUserStore(uid, `batch_meta_${jobId}`);
  const shouldDeductCredits = !!(preMeta && !preMeta.creditsClaimed && preMeta.userId);
  if (shouldDeductCredits) {
    writeUserStore(uid, `batch_meta_${jobId}`, { ...preMeta, creditsClaimed: true });
  }

  console.log(`[batch-dl] Downloading images for ${jobId} (attempt ${failCount + 1})`);
  try {
    // Use axios directly — avoids SDK's potential OOM on large inline responses
    // and works on all Node versions. 5-minute timeout for large batches.
    const url = `https://generativelanguage.googleapis.com/v1beta/${name}?key=${encodeURIComponent(googleKey)}`;
    const { data: job } = await axios.get(url, { timeout: 300000, maxContentLength: 500 * 1024 * 1024 });

    console.log(`[batch-dl] Got response for ${jobId}, state=${job.state}, done=${job.done}`);
    console.log(`[batch-dl] Response keys: ${Object.keys(job || {}).join(', ')}`);

    // Unwrap LRO: Google returns { done: bool, response: { state, output } }
    // If done=false, job is still running — nothing to extract yet
    const batchJob = (job.done !== undefined) ? job.response : job;
    if (!batchJob) {
      console.log(`[batch-dl] Job ${jobId} LRO not done yet — skipping`);
      ongoingBatchFetches.delete(`${uid}:${jobId}:dl`);
      return;
    }

    const isComplete = job.done === true || normalizeState(batchJob.state) === 'JOB_STATE_SUCCEEDED';
    if (isComplete) {
      const responses =
        batchJob?.output?.inlinedResponses?.inlinedResponses ||
        batchJob?.inlinedResponses?.inlinedResponses ||
        [];

      console.log(`[batch-dl] Found ${responses.length} responses for ${jobId}`);

      // Save images as binary files — avoids base64 bloat in JSON and reduces egress ~80%
      const imgDir = path.join(getUserDataDir(uid), 'batch_images', jobId);
      if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

      // Parse target resolution from batch meta (e.g. '1080x1440' → 1080, 1440)
      const resParts = (preMeta?.resolution || '1080x1440').split('x').map(Number);
      const [targetW, targetH] = resParts.length === 2 ? resParts : [1080, 1440];

      // Process images sequentially (not parallel) to avoid OOM on the 1GB VM.
      // Promise.all was spiking RAM by loading all 5 images simultaneously —
      // causing the first download attempt to fail, which triggered a retry
      // (second GET to Gemini) and double-billed on GCE.
      const results = [];
      for (let idx = 0; idx < responses.length; idx++) {
        const r = responses[idx];
        // Gemini may nest under r.response or directly under r
        const parts =
          r?.response?.candidates?.[0]?.content?.parts ||
          r?.candidates?.[0]?.content?.parts ||
          [];
        let saved = null;
        for (const part of parts) {
          if (part?.inlineData?.data) {
            try {
              const imgBuffer = Buffer.from(part.inlineData.data, 'base64');
              const filename = `${idx}.jpg`;
              const filePath = path.join(imgDir, filename);
              // Resize to target resolution using Sharp (lanczos, cover crop from top)
              await sharp(imgBuffer)
                .resize(targetW, targetH, { fit: 'cover', position: 'top' })
                .jpeg({ quality: 92 })
                .toFile(filePath);
              saved = `/batch-static/${uid}/batch_images/${jobId}/${filename}`;
              console.log(`[batch-dl] Saved image ${idx + 1}/${responses.length} for ${jobId}`);
            } catch (saveErr) {
              console.error(`[batch-dl] Failed to save image ${idx} for ${jobId}:`, saveErr.message);
            }
            break; // only first image part per response
          }
        }
        results.push(saved);
      }

      writeUserStore(uid, `batch_results_${jobId}`, results);
      writeUserStore(uid, `batch_state_${jobId}`, { state: 'JOB_STATE_SUCCEEDED', ts: Date.now() });

      // Deduct credits — only if this run claimed them via shouldDeductCredits above
      if (shouldDeductCredits) {
        const successCount = results.filter(Boolean).length;
        if (successCount > 0) {
          const users = readUsers();
          const uidx = users.findIndex(u => u.id === preMeta.userId);
          if (uidx !== -1) {
            const toDeduct = Math.min(successCount, users[uidx].credits || 0);
            users[uidx].credits = (users[uidx].credits || 0) - toDeduct;
            users[uidx].totalCreditsUsed = (users[uidx].totalCreditsUsed || 0) + toDeduct;
            users[uidx].totalImagesGenerated = (users[uidx].totalImagesGenerated || 0) + successCount;
            writeUsers(users);
            if (toDeduct > 0)
              addTransaction(preMeta.userId, 'credit_used', toDeduct,
                `${toDeduct} credit${toDeduct > 1 ? 's' : ''} used (batch: ${successCount} image${successCount > 1 ? 's' : ''})`);
          }
        }
      }
      console.log(`[batch-dl] Job ${jobId} — cached ${results.filter(Boolean).length} results`);
      ongoingBatchFetches.delete(failKey); // clear fail count on success
    }
  } catch (e) {
    console.error(`[batch-dl error] job=${jobId} attempt=${failCount + 1}:`, e.message);
    ongoingBatchFetches.set(failKey, failCount + 1); // track failure
  } finally {
    ongoingBatchFetches.delete(`${uid}:${jobId}:dl`);
  }
}

// Status check background task — fast REST check, falls back to SDK on failure
async function fetchAndCacheBatchResults(googleKey, name, uid, jobId) {
  console.log(`[batch-bg] Status check for ${jobId}`);
  try {
    let state;
    try {
      state = await checkBatchState(googleKey, name);
      console.log(`[batch-bg] ${jobId} state=${state} (REST)`);
    } catch (restErr) {
      // REST check failed — fall back to SDK call
      console.warn(`[batch-bg] REST check failed for ${jobId} (${restErr.message}), using SDK`);
      const ai = new GoogleGenAI({ apiKey: googleKey });
      const job = await ai.batches.get({ name });
      state = job.state || 'JOB_STATE_RUNNING';
      console.log(`[batch-bg] ${jobId} state=${state} (SDK fallback)`);
    }

    // Job doesn't exist on Gemini — mark failed so it stops polling
    if (state === 'JOB_STATE_NOT_FOUND') {
      console.warn(`[batch-bg] Job ${jobId} not found on Gemini — marking failed`);
      writeUserStore(uid, `batch_state_${jobId}`, { state: 'JOB_STATE_FAILED', ts: Date.now() });
      // Clear credit reservation (no credits were deducted, just free the reserved count)
      const metaNF = readUserStore(uid, `batch_meta_${jobId}`);
      if (metaNF && !metaNF.creditsClaimed) {
        writeUserStore(uid, `batch_meta_${jobId}`, { ...metaNF, creditsClaimed: true });
      }
      return;
    }

    // Always update cached state immediately
    writeUserStore(uid, `batch_state_${jobId}`, { state, ts: Date.now() });

    // Clear credit reservation for terminal failure/cancel states
    if (['JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_CANCELLING'].includes(state)) {
      const metaFail = readUserStore(uid, `batch_meta_${jobId}`);
      if (metaFail && !metaFail.creditsClaimed) {
        writeUserStore(uid, `batch_meta_${jobId}`, { ...metaFail, creditsClaimed: true });
      }
    }

    // If succeeded, kick off image download (separate background task)
    if (state === 'JOB_STATE_SUCCEEDED') {
      const dlKey = `${uid}:${jobId}:dl`;
      if (!ongoingBatchFetches.has(dlKey)) {
        ongoingBatchFetches.set(dlKey, true);
        downloadBatchImages(googleKey, name, uid, jobId); // fire and forget
      }
    }
  } catch (e) {
    console.error(`[batch-bg error] job=${jobId}`, e.message);
  } finally {
    ongoingBatchFetches.delete(`${uid}:${jobId}`);
  }
}

app.post('/api/ai/gemini-batch-get', requireAuth, async (req, res) => {
  let { name } = req.body;
  const { googleKey } = getGlobalApiKeys();
  if (!googleKey) return res.status(400).json({ error: 'Service not configured. Contact admin.' });

  const isAdmin = req.userRole === 'admin';
  const uid = isAdmin ? 'admin' : req.userId;

  // Handle temp names — batch still being submitted to Gemini in background
  if (name && name.startsWith('submitting/')) {
    const tempId = name.split('/')[1];
    const tempMap = readUserStore(uid, `batch_tempmap_${tempId}`);
    if (!tempMap) return res.json({ name, state: 'JOB_STATE_PENDING' }); // still uploading to Gemini
    if (tempMap.failed) return res.json({ name, state: 'JOB_STATE_FAILED', error: tempMap.error });
    // Real name resolved — tell the client so it can migrate the record, then continue with real check
    name = tempMap.realName;
  }

  const jobId = name.split('/').pop();

  // 1. Serve from results cache — job fully done
  if (!isAdmin) {
    const cached = readUserStore(uid, `batch_results_${jobId}`);
    if (cached) return res.json({ name, state: 'JOB_STATE_SUCCEEDED', results: cached });

    // Credits claimed but cache missing = results lost (edge case)
    const meta = readUserStore(uid, `batch_meta_${jobId}`);
    if (meta && meta.creditsClaimed) return res.json({ name, state: 'JOB_STATE_SUCCEEDED', results: [] });
  }

  const lastState = !isAdmin ? readUserStore(uid, `batch_state_${jobId}`) : null;
  const cachedState = lastState?.state;

  // 2. Gemini says SUCCEEDED but images still downloading → keep download going, report downloading
  if (cachedState === 'JOB_STATE_SUCCEEDED') {
    const dlKey = `${uid}:${jobId}:dl`;
    if (!ongoingBatchFetches.has(dlKey)) {
      ongoingBatchFetches.set(dlKey, true);
      downloadBatchImages(googleKey, name, uid, jobId); // resume download
    }
    return res.json({ name, state: 'JOB_STATE_DOWNLOADING' });
  }

  // 3. Job still running/pending — fast status check (no image download)
  const statusKey = `${uid}:${jobId}`;
  if (!ongoingBatchFetches.has(statusKey)) {
    ongoingBatchFetches.set(statusKey, true);
    fetchAndCacheBatchResults(googleKey, name, uid, jobId); // fire and forget
  }

  return res.json({ name, state: cachedState || 'JOB_STATE_RUNNING' });
});

app.post('/api/shopify/vto', async (req, res) => {
  const origin = req.headers.origin || '';
  const { customerImageBase64, productImageUrls } = req.body;
  if (!customerImageBase64) return res.status(400).json({ error: 'Missing customer image' });
  if (!productImageUrls || !productImageUrls.length) return res.status(400).json({ error: 'Missing product images' });

  const { googleKey } = getGlobalApiKeys();
  if (!googleKey) return res.status(500).json({ error: 'AI service not configured.' });

  try {
    const productB64s = [];
    for (const url of productImageUrls) {
      if (!url) continue;
      try {
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
        const resized = await sharp(response.data).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
        productB64s.push('data:image/webp;base64,' + resized.toString('base64'));
      } catch (err) {}
    }

    if (!productB64s.length) return res.status(400).json({ error: 'Could not fetch any product images.' });

    const images = [customerImageBase64, ...productB64s];
    let productLines = '';
    for (let i = 0; i < productB64s.length; i++) {
      productLines += `Product reference image ${i + 2}: use this for garment details.\n`;
    }

    const prompt = `I am uploading ${images.length} reference images:
1. MODEL reference - this is the ONLY person to appear in the output. Use her exact face, body structure, skin tone, hair, pose, and background environment. Reference image 1 is the SOLE source for the model's identity and setting.
${productLines}

Generate a photorealistic fashion photograph.

CHARACTER: ONLY the woman from reference image 1.
CRITICAL BODY PRESERVATION: You MUST strictly preserve the exact body weight, volume, proportions, and shape of the person in reference image 1. Do NOT make the person thinner or alter their natural body type to fit standard fashion model proportions. Her exact physical dimensions must remain identical.
GARMENT: Reproduce the exact garment from the product reference image(s). EVERY design detail (seams, buttons, zippers, fabric texture), color (hue, saturation, brightness), print pattern (motifs, scale, density), and construction MUST be accurate. The garment must fit the model naturally, following the contours of her true body shape. DO NOT simplify, reinterpret, or alter any design element.
POSE & BACKGROUND: Copy the EXACT pose, camera angle, and background from reference image 1. The setting must match pixel-perfectly. The model must cast a physically accurate shadow matching the lighting direction of the background.
Premium D2C fashion brand product photography quality.
No text, no overlays, no watermarks.`;

    const ai = new GoogleGenAI({ apiKey: googleKey });
    const parts = [];
    for (const img of images) {
      const b64 = img.includes(',') ? img.split(',')[1] : img;
      parts.push({
        inlineData: { data: b64, mimeType: img.startsWith('data:') ? img.split(';')[0].split(':')[1] : 'image/jpeg' }
      });
    }
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image',
      contents: parts,
      config: { outputMimeType: "image/jpeg", personGeneration: "ALLOW_ALL", aspectRatio: "3:4", imageSize: "1024x1024" }
    });

    const b64Output = response.candidates[0].content.parts[0].inlineData.data;
    
    const jobId = Date.now().toString();
    const shopifyDir = path.join(DATA_DIR, 'shopify');
    if (!fs.existsSync(shopifyDir)) fs.mkdirSync(shopifyDir, { recursive: true });
    
    try {
      fs.writeFileSync(path.join(shopifyDir, jobId + '_in.jpg'), customerImageBase64.replace(/^data:image\/\w+;base64,/, ""), 'base64');
      fs.writeFileSync(path.join(shopifyDir, jobId + '_out.jpg'), b64Output, 'base64');
      
      appendAuditLog('shopify_store', {
        event: 'shopify_vto', 
        detail: 'Generated Virtual Try-On',
        inputUrl: `/api/admin/shopify-img/${jobId}_in.jpg`,
        outputUrl: `/api/admin/shopify-img/${jobId}_out.jpg`,
        credits: 0
      });
    } catch (logErr) {
      console.error('[Shopify VTO] Failed to save log', logErr.message);
    }

    res.json({ success: true, image: 'data:image/jpeg;base64,' + b64Output });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

app.post('/api/ai/gemini-batch-cancel', requireAuth, async (req, res) => {
  const { name } = req.body;
  const { googleKey } = getGlobalApiKeys();
  if (!googleKey) return res.status(400).json({ error: 'Service not configured. Contact admin.' });

  try {
    const ai = new GoogleGenAI({ apiKey: googleKey });
    await ai.batches.cancel({ name });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ── Static files + React catch-all (AFTER all API routes) ─────────────────

if (fs.existsSync(BUILD_DIR)) {
  app.use(express.static(BUILD_DIR));
  app.get('*', (req, res) => res.sendFile(path.join(BUILD_DIR, 'index.html')));
}

// ── JSON 404 / error fallback ──────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.path}` });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  res.status(500).json({ error: err.message });
});

// ── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\nShootAI server running on port ${PORT}`);
  console.log(`Admin login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`Data dir: ${DATA_DIR}\n`);
});

module.exports = app;
