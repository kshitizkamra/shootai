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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
  if (req.userRole === 'admin') return res.json({ credits: null });
  const user = readUsers().find(u => u.id === req.userId);
  res.json({ credits: user?.credits || 0 });
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

app.post('/api/ai/gemini-batch-create', requireAuth, requireActive, async (req, res) => {
  const { requests } = req.body;
  const { googleKey } = getGlobalApiKeys();
  if (!googleKey) return res.status(400).json({ error: 'Service not configured. Contact admin.' });

  const isAdmin = req.userRole === 'admin';
  const uid = isAdmin ? 'admin' : req.userId;

  if (!isAdmin) {
    const user = readUsers().find(u => u.id === req.userId);
    if ((user?.credits || 0) < 1)
      return res.status(402).json({ error: 'Not enough credits. Need at least 1 credit.' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: googleKey });

    const inlinedRequests = (requests || []).map(r => {
      const parts = [{ text: r.prompt }];
      (r.images || []).forEach(img => {
        parts.push({
          inlineData: {
            mimeType: img.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
            data: img.replace(/^data:image\/\w+;base64,/, ''),
          },
        });
      });
      return {
        contents: [{ role: 'user', parts }],
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: r.aspectRatio || '3:4', imageSize: '1K' },
        },
      };
    });

    const job = await ai.batches.create({
      model: 'models/gemini-3.1-flash-image',
      src: inlinedRequests,
      config: { displayName: `shootai_${Date.now()}` },
    });

    // Store metadata so credits can be deducted once on success
    writeUserStore(uid, `batch_meta_${job.name.split('/').pop()}`, {
      name: job.name,
      itemCount: (requests || []).length,
      creditsClaimed: false,
      userId: isAdmin ? null : req.userId,
    });

    res.json({ name: job.name, state: job.state || 'JOB_STATE_PENDING', createTime: job.createTime });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/api/ai/gemini-batch-get', requireAuth, async (req, res) => {
  const { name } = req.body;
  const { googleKey } = getGlobalApiKeys();
  if (!googleKey) return res.status(400).json({ error: 'Service not configured. Contact admin.' });

  const isAdmin = req.userRole === 'admin';
  const uid = isAdmin ? 'admin' : req.userId;

  try {
    const ai = new GoogleGenAI({ apiKey: googleKey });
    const job = await ai.batches.get({ name });

    if (job.state === 'JOB_STATE_SUCCEEDED') {
      const responses = (job.dest && job.dest.inlinedResponses) || [];
      const results = responses.map(r => {
        const parts = r.response?.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.inlineData?.data) {
            return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
          }
        }
        return null;
      });

      // Deduct credits once on first successful poll
      if (!isAdmin) {
        const jobId = name.split('/').pop();
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
      }

      return res.json({ name: job.name, state: job.state, results });
    }

    res.json({ name: job.name, state: job.state || 'JOB_STATE_PENDING' });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
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
