/**
 * webShim.js
 * Replaces window.electronAPI with browser-compatible equivalents.
 * All components use window.electronAPI — this shim provides the same interface
 * using fetch (for server calls) and browser APIs (for file handling).
 */

const SERVER_URL = process.env.REACT_APP_SERVER_URL || '';

function getToken() {
  return localStorage.getItem('shootai_token');
}

function authHeaders() {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function apiCall(path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (res.status === 402) throw new Error(data.error || 'Not enough credits');
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

// ── File picker (browser) ──────────────────────────────────────────────────

function openFileDialog() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return resolve(null);
      // Store the File object and return a fake "path" (object URL as ID)
      const fakeId = `web-file:${Date.now()}:${file.name}`;
      webShim._fileCache[fakeId] = file;
      resolve(fakeId);
    };
    input.click();
  });
}

function openMultipleFilesDialog() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return resolve([]);
      const fakeIds = files.map(file => {
        const fakeId = `web-file:${Date.now()}:${Math.random().toString(36).slice(2)}:${file.name}`;
        webShim._fileCache[fakeId] = file;
        return fakeId;
      });
      resolve(fakeIds);
    };
    input.click();
  });
}

// ── File reader (browser) ──────────────────────────────────────────────────

function readFileAsBase64(pathOrId) {
  return new Promise((resolve, reject) => {
    // Check if it's a cached web file
    const file = webShim._fileCache[pathOrId];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result); // returns data:image/...;base64,...
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }
    // Check if it's already base64 (stored in library)
    if (pathOrId && pathOrId.startsWith('data:')) {
      resolve(pathOrId);
      return;
    }
    // If it's a base64 string without prefix (raw), wrap it
    if (pathOrId && pathOrId.length > 100 && !pathOrId.includes('/')) {
      resolve(`data:image/jpeg;base64,${pathOrId}`);
      return;
    }
    reject(new Error(`Cannot read file: ${pathOrId}`));
  });
}

// ── File saver (browser download) ─────────────────────────────────────────

function saveFile(base64, filename) {
  const link = document.createElement('a');
  link.href = base64;
  link.download = filename || 'image.png';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return Promise.resolve(`downloaded/${filename}`);
}

function openInExplorer(filePath) {
  // No-op in web — could show a toast
  console.log('File saved:', filePath);
  return Promise.resolve();
}

// ── Store (server-side per user) ───────────────────────────────────────────

async function storeGet(key) {
  try {
    const res = await fetch(`${SERVER_URL}/api/store/${encodeURIComponent(key)}`, {
      headers: authHeaders(),
    });
    const data = await res.json();
    return data.value;
  } catch { return null; }
}

async function storeSet(key, value) {
  await apiCall(`/api/store/${encodeURIComponent(key)}`, { value });
}

// ── AI: Gemini ─────────────────────────────────────────────────────────────

async function geminiGenerate({ model, images, prompt, aspectRatio }) {
  const data = await apiCall('/api/ai/gemini-generate', { model, images, prompt, aspectRatio });
  return data.base64;
}

async function geminiBatchCreate({ requests }) {
  return await apiCall('/api/ai/gemini-batch-create', { requests });
}

async function geminiBatchGet({ name }) {
  return await apiCall('/api/ai/gemini-batch-get', { name });
}

async function geminiBatchCancel({ name }) {
  return await apiCall('/api/ai/gemini-batch-cancel', { name });
}

// ── AI: OpenAI ─────────────────────────────────────────────────────────────

async function generateImage({ prompt, quality }) {
  const data = await apiCall('/api/ai/openai-generate', { prompt, quality });
  return data.base64;
}

async function multiImageGenerate({ images, prompt, quality }) {
  const data = await apiCall('/api/ai/openai-multi', { images, prompt, quality });
  return data.base64;
}

async function editImage({ imageBase64, prompt, quality }) {
  const data = await apiCall('/api/ai/openai-edit', { imageBase64, prompt, quality });
  return data.base64;
}

async function testConnection() {
  const data = await apiCall('/api/ai/test-connection', {});
  return data;
}

// ── Install shim ───────────────────────────────────────────────────────────

const webShim = {
  _fileCache: {},
  openFileDialog,
  openMultipleFilesDialog,
  readFileAsBase64,
  saveFile,
  openInExplorer,
  storeGet,
  storeSet,
  geminiGenerate,
  geminiBatchCreate,
  geminiBatchGet,
  geminiBatchCancel,
  generateImage,
  multiImageGenerate,
  editImage,
  testConnection,
};

export function installWebShim() {
  window.electronAPI = webShim;
}

export default webShim;
