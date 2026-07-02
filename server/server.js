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
  res.json({ id: user.id, email: user.email, name: user.name, role: 'user', credits: user.credits || 0 });
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

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = readUsers().map(u => ({
    id: u.id, email: u.email, name: u.name,
    credits: u.credits || 0,
    totalImagesGenerated: u.totalImagesGenerated || 0,
    totalCreditsUsed: u.totalCreditsUsed || 0,
    totalCreditsAdded: u.totalCreditsAdded || 0,
    disabled: u.disabled || false,
    createdAt: u.createdAt,
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

app.post('/api/ai/gemini-generate', requireAuth, requireActive, async (req, res) => {
  const { model, images, prompt, aspectRatio } = req.body;
  const { googleKey } = getGlobalApiKeys();
  if (!googleKey) return res.status(400).json({ error: 'Service not configured. Contact admin.' });

  const isAdmin = req.userRole === 'admin';
  if (!isAdmin) {
    const check = checkAndDeductCredits(req.userId, 3);
    if (!check.ok) return res.status(402).json({ error: check.error });
  }

  try {
    const parts = [];
    for (const img of (images || [])) {
      const data = img.replace(/^data:image\/\w+;base64,/, '');
      parts.push({ inlineData: { mimeType: img.startsWith('data:image/png') ? 'image/png' : 'image/jpeg', data } });
    }
    parts.push({ text: prompt });

    // Instant generation uses Gemini 3 Pro Image
    const modelId = model || 'gemini-3-pro-image';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${googleKey}`;
    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    };
    if (aspectRatio) body.generationConfig.imageGenerationConfig = { aspectRatio };

    const response = await axios.post(url, body, { timeout: 120000, headers: { 'Content-Type': 'application/json' } });
    const candidate = response.data?.candidates?.[0];
    if (!candidate) {
      if (!isAdmin) refundCredits(req.userId, 3, 'no response');
      return res.status(500).json({ error: 'No response from Gemini' });
    }

    for (const part of (candidate.content?.parts || [])) {
      if (part.inlineData?.data) {
        const mime = part.inlineData.mimeType || 'image/png';
        if (!isAdmin) {
          addTransaction(req.userId, 'credit_used', 3, '3 credits used (instant generation)');
          recordImages(req.userId, 1);
        }
        return res.json({ base64: `data:${mime};base64,${part.inlineData.data}` });
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

// Per-user lock: prevents duplicate Gemini batch jobs from double-clicks or retries
const activeSubmissions = new Set();

// Background task: calls ai.batches.create() and maps temp → real job name.
// The HTTP endpoint responds immediately with a temp name so the client isn't
// blocked waiting for Gemini to accept (potentially minutes of) image data.
async function createBatchJobAsync(googleKey, inlinedRequests, uid, tempId, itemCount, userId) {
  try {
    const ai = new GoogleGenAI({ apiKey: googleKey });
    const job = await ai.batches.create({
      model: 'models/gemini-3.1-flash-image',
      src: inlinedRequests,
      config: { displayName: `shootai_${Date.now()}` },
    });
    const realJobId = job.name.split('/').pop();
    // Save real job metadata for credit tracking
    writeUserStore(uid, `batch_meta_${realJobId}`, {
      name: job.name,
      itemCount,
      creditsClaimed: false,
      userId,
    });
    // Map temp → real name, and clear temp credit reservation
    writeUserStore(uid, `batch_tempmap_${tempId}`, { realName: job.name });
    const tempMeta = readUserStore(uid, `batch_meta_${tempId}`);
    if (tempMeta && !tempMeta.creditsClaimed) {
      writeUserStore(uid, `batch_meta_${tempId}`, { ...tempMeta, creditsClaimed: true });
    }
    console.log(`[batch-submit] temp=${tempId} → real=${realJobId}`);
  } catch (e) {
    console.error(`[batch-submit error] temp=${tempId}`, e.message);
    writeUserStore(uid, `batch_tempmap_${tempId}`, { failed: true, error: e.message });
    // Clear temp credit reservation on failure
    const tempMeta = readUserStore(uid, `batch_meta_${tempId}`);
    if (tempMeta && !tempMeta.creditsClaimed) {
      writeUserStore(uid, `batch_meta_${tempId}`, { ...tempMeta, creditsClaimed: true });
    }
  } finally {
    activeSubmissions.delete(uid); // release lock
  }
}

app.post('/api/ai/gemini-batch-create', requireAuth, requireActive, async (req, res) => {
  const { requests } = req.body;
  const { googleKey } = getGlobalApiKeys();
  if (!googleKey) return res.status(400).json({ error: 'Service not configured. Contact admin.' });

  const isAdmin = req.userRole === 'admin';
  const uid = isAdmin ? 'admin' : req.userId;

  if (!isAdmin) {
    const user = readUsers().find(u => u.id === req.userId);
    const balance = user?.credits || 0;
    const reserved = getReservedCredits(req.userId);
    const requested = (requests || []).length;
    const available = balance - reserved;
    if (available < requested) {
      return res.status(402).json({
        error: `Not enough credits. This batch needs ${requested} credit${requested !== 1 ? 's' : ''}, but you have ${available} available (${balance} total − ${reserved} reserved for running batches).`,
      });
    }
  }

  try {
    // Build inlinedRequests and immediately clear source from memory
    const rawRequests = [...(requests || [])];
    req.body = null; // allow GC to collect parsed request body
    const inlinedRequests = rawRequests.map(r => {
      const parts = [{ text: r.prompt }];
      (r.images || []).forEach(img => {
        parts.push({
          inlineData: {
            mimeType: img.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
            data: img.replace(/^data:image\/\w+;base64,/, ''),
          },
        });
      });
      r.images = null; // free image data from source as we go
      return {
        contents: [{ role: 'user', parts }],
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: r.aspectRatio || '3:4', imageSize: '1K' },
        },
      };
    });

    // Prevent double-submission (double-click, nginx timeout retry, etc.)
    if (activeSubmissions.has(uid)) {
      return res.status(429).json({ error: 'A batch is already being submitted. Please wait a moment.' });
    }
    activeSubmissions.add(uid);

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

    // Fire-and-forget — the real Gemini call happens in background (lock released in finally)
    createBatchJobAsync(googleKey, inlinedRequests, uid, tempId, rawRequests.length, isAdmin ? null : req.userId);

    // Respond immediately so the client isn't blocked
    res.json({ name: tempName, state: 'JOB_STATE_PENDING', createTime: new Date().toISOString() });
  } catch (e) {
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
// No field mask — field masks can strip the state field causing silent RUNNING fallback.
// Cache-busting param + no-cache headers prevent GCE network layers from returning stale responses.
async function checkBatchState(googleKey, name) {
  const url = `https://generativelanguage.googleapis.com/v1beta/${name}?key=${encodeURIComponent(googleKey)}&_cb=${Date.now()}`;
  try {
    const { data } = await axios.get(url, {
      timeout: 20000,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
    if (!data.state) throw new Error('API response missing state field');
    return normalizeState(data.state);
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

  console.log(`[batch-dl] Downloading images for ${jobId} (attempt ${failCount + 1})`);
  try {
    // Use axios directly — avoids SDK's potential OOM on large inline responses
    // and works on all Node versions. 5-minute timeout for large batches.
    const url = `https://generativelanguage.googleapis.com/v1beta/${name}?key=${encodeURIComponent(googleKey)}`;
    const { data: job } = await axios.get(url, { timeout: 300000, maxContentLength: 500 * 1024 * 1024 });

    console.log(`[batch-dl] Got response for ${jobId}, state=${job.state}`);
    console.log(`[batch-dl] Response keys: ${Object.keys(job || {}).join(', ')}`);

    if (normalizeState(job.state) === 'JOB_STATE_SUCCEEDED') {
      // Correct path per Gemini API: output.inlinedResponses.inlinedResponses (double-nested)
      // Note: SDK uses 'output' not 'dest' (dest is Vertex AI variant)
      const responses =
        job?.output?.inlinedResponses?.inlinedResponses ||
        job?.dest?.inlinedResponses?.inlinedResponses ||
        job?.dest?.inlinedResponses ||
        [];

      console.log(`[batch-dl] Found ${responses.length} responses for ${jobId}`);

      const results = responses.map(r => {
        // Gemini may nest under r.response or directly under r
        const parts =
          r?.response?.candidates?.[0]?.content?.parts ||
          r?.candidates?.[0]?.content?.parts ||
          [];
        for (const part of parts) {
          if (part?.inlineData?.data) {
            return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
          }
        }
        return null;
      });

      writeUserStore(uid, `batch_results_${jobId}`, results);
      writeUserStore(uid, `batch_state_${jobId}`, { state: 'JOB_STATE_SUCCEEDED', ts: Date.now() });

      // Deduct credits once
      const meta = readUserStore(uid, `batch_meta_${jobId}`);
      if (meta && !meta.creditsClaimed && meta.userId) {
        const successCount = results.filter(Boolean).length;
        if (successCount > 0) {
          const users = readUsers();
          const idx = users.findIndex(u => u.id === meta.userId);
          if (idx !== -1) {
            const toDeduct = Math.min(successCount, users[idx].credits || 0);
            users[idx].credits = (users[idx].credits || 0) - toDeduct;
            users[idx].totalCreditsUsed = (users[idx].totalCreditsUsed || 0) + toDeduct;
            users[idx].totalImagesGenerated = (users[idx].totalImagesGenerated || 0) + successCount;
            writeUsers(users);
            if (toDeduct > 0)
              addTransaction(meta.userId, 'credit_used', toDeduct,
                `${toDeduct} credit${toDeduct > 1 ? 's' : ''} used (batch: ${successCount} image${successCount > 1 ? 's' : ''})`);
          }
        }
        writeUserStore(uid, `batch_meta_${jobId}`, { ...meta, creditsClaimed: true });
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
