function getAPI() {
  if (!window.electronAPI) {
    throw new Error('Not connected. Please refresh the page.');
  }
  return window.electronAPI;
}

// ── Settings ──────────────────────────────────────────────────────────────

const SETTINGS_DEFAULTS = {
  apiKey: '',
  googleApiKey: '',
  geminiModel: 'gemini-2.0-flash-preview-image-generation',
  outputFolder: '',
  defaultQuality: 'high',
  defaultResolution: '1080x1440',
  gcsBucket: '',
  gcsSaKeyPath: '',
  gcsProjectId: '',
  pdpGlobalInstruction: '',
  pdpShotInstructions: {},
  pdpDetailNote: '',
};

export async function getSettings() {
  try {
    const stored = await getAPI().storeGet('settings');
    return { ...SETTINGS_DEFAULTS, ...(stored || {}) };
  } catch (e) {
    console.warn('getSettings:', e.message);
    return { ...SETTINGS_DEFAULTS };
  }
}

export async function saveSettings(settings) {
  await getAPI().storeSet('settings', settings);
}

// ── Models ────────────────────────────────────────────────────────────────

export async function getModels() {
  try {
    return await getAPI().storeGet('models') || [];
  } catch (e) { return []; }
}

export async function saveModel(model) {
  const models = await getModels();
  const idx = models.findIndex(m => m.id === model.id);
  if (idx >= 0) models[idx] = model; else models.push(model);
  await getAPI().storeSet('models', models);
  return models;
}

export async function deleteModel(modelId) {
  const models = await getModels();
  const updated = models.filter(m => m.id !== modelId);
  await getAPI().storeSet('models', updated);
  return updated;
}

// ── Backgrounds ───────────────────────────────────────────────────────────

export async function getBackgrounds() {
  try {
    return await getAPI().storeGet('backgrounds') || [];
  } catch (e) { return []; }
}

export async function saveBackground(bg) {
  const bgs = await getBackgrounds();
  const idx = bgs.findIndex(b => b.id === bg.id);
  if (idx >= 0) bgs[idx] = bg; else bgs.push(bg);
  await getAPI().storeSet('backgrounds', bgs);
  return bgs;
}

export async function deleteBackground(bgId) {
  const bgs = await getBackgrounds();
  const updated = bgs.filter(b => b.id !== bgId);
  await getAPI().storeSet('backgrounds', updated);
  return updated;
}

// ── History ───────────────────────────────────────────────────────────────

export async function getHistory() {
  try {
    return await getAPI().storeGet('history') || [];
  } catch (e) { return []; }
}

export async function addHistoryEntry(entry) {
  const history = await getHistory();
  history.unshift({ ...entry, id: `gen_${Date.now()}`, createdAt: new Date().toISOString() });
  await getAPI().storeSet('history', history.slice(0, 40));
  return history;
}

export async function deleteHistoryEntry(entryId) {
  const history = await getHistory();
  const updated = history.filter(h => h.id !== entryId);
  await getAPI().storeSet('history', updated);
  return updated;
}

// ── Poses ─────────────────────────────────────────────────────────────────

export async function getPoses() {
  try { return await getAPI().storeGet('poses') || []; }
  catch (e) { return []; }
}

export async function savePose(pose) {
  const poses = await getPoses();
  const idx = poses.findIndex(p => p.id === pose.id);
  if (idx >= 0) poses[idx] = pose; else poses.push(pose);
  await getAPI().storeSet('poses', poses);
  return poses;
}

export async function deletePose(poseId) {
  const poses = await getPoses();
  const updated = poses.filter(p => p.id !== poseId);
  await getAPI().storeSet('poses', updated);
  return updated;
}

// ── ID generation ─────────────────────────────────────────────────────────

export function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}
