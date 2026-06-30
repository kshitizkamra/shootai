// ── Batch Queue ───────────────────────────────────────────────────────────
// Manages the local queue of items waiting to be submitted as a batch job.
// Each item stores the pre-built prompt + base64 images so it can be
// submitted at any time without re-reading files.
//
// BatchItem shape:
// {
//   id: string,
//   workflow: 'A' | 'B' | 'C' | 'D',
//   label: string,          // display label e.g. "Background — shirt.png"
//   createdAt: ISO string,
//   prompt: string,         // fully constructed prompt
//   images: string[],       // ordered base64 strings
//   aspectRatio: string,    // '3:4'
//   resolution: string,     // '1080x1440'
// }
//
// BatchJob shape (after submission):
// {
//   name: string,           // Gemini job name e.g. 'batches/batch-123'
//   state: string,          // JOB_STATE_PENDING | RUNNING | SUCCEEDED | FAILED | CANCELLED
//   submittedAt: ISO string,
//   itemCount: number,
//   itemLabels: string[],
//   resolution: string,     // resolution for saving results
//   results: string[],      // base64 images (populated when SUCCEEDED)
//   savedPaths: string[],   // populated as results are saved
// }

function getAPI() { return window.electronAPI; }

// ── Image pool helpers ────────────────────────────────────────────────────
// Deduplicates base64 images across batch items so each unique image is
// stored once, referenced by a short key. Reduces payload size by ~N× when
// model/bg/pose images are shared across many shots.

function poolEncode(items) {
  const pool = {};   // key → base64
  const counter = { n: 0 };
  function intern(b64) {
    if (!b64 || !b64.startsWith('data:')) return b64;
    // Use first 64 chars as a fast fingerprint (unique enough for our sizes)
    const fp = b64.slice(0, 64);
    if (!pool[fp]) { pool[fp] = { key: '__img' + (counter.n++), data: b64 }; }
    return pool[fp].key;
  }
  const compressed = items.map(item => ({
    ...item,
    images: Array.isArray(item.images) ? item.images.map(intern) : item.images,
  }));
  const imagePool = {};
  Object.values(pool).forEach(({ key, data }) => { imagePool[key] = data; });
  return { items: compressed, imagePool };
}

function poolDecode(stored) {
  if (!stored || !stored._pooled) return stored; // legacy format
  const { items, imagePool } = stored;
  return items.map(item => ({
    ...item,
    images: Array.isArray(item.images)
      ? item.images.map(ref => imagePool[ref] ?? ref)
      : item.images,
  }));
}

// ── Queue ─────────────────────────────────────────────────────────────────

export async function getBatchQueue() {
  try {
    const raw = await getAPI().storeGet('batchQueue');
    if (!raw) return [];
    return poolDecode(raw);
  }
  catch (e) { return []; }
}

export async function addToBatchQueue(item) {
  const queue = await getBatchQueue();
  const newItem = {
    ...item,
    id: 'bq_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    createdAt: new Date().toISOString(),
  };
  queue.push(newItem);
  const { items, imagePool } = poolEncode(queue);
  await getAPI().storeSet('batchQueue', { _pooled: true, items, imagePool });
  return newItem;
}

export async function addManyToBatchQueue(items) {
  const existing = await getBatchQueue();
  const stamped = items.map(item => ({
    ...item,
    id: 'bq_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    createdAt: new Date().toISOString(),
  }));
  const all = [...existing, ...stamped];
  const { items: compressed, imagePool } = poolEncode(all);
  await getAPI().storeSet('batchQueue', { _pooled: true, items: compressed, imagePool });
  return all;
}

export async function removeFromBatchQueue(id) {
  const queue = await getBatchQueue();
  const updated = queue.filter(item => item.id !== id);
  const { items, imagePool } = poolEncode(updated);
  await getAPI().storeSet('batchQueue', { _pooled: true, items, imagePool });
  return updated;
}

export async function clearBatchQueue() {
  await getAPI().storeSet('batchQueue', []);
}

// ── Jobs ──────────────────────────────────────────────────────────────────

export async function getBatchJobs() {
  try { return await getAPI().storeGet('batchJobs') || []; }
  catch (e) { return []; }
}

export async function saveBatchJob(job) {
  const jobs = await getBatchJobs();
  const idx = jobs.findIndex(j => j.name === job.name);
  if (idx >= 0) {
    jobs[idx] = { ...jobs[idx], ...job };
  } else {
    jobs.unshift(job);
  }
  // Keep last 20 jobs, drop old ones
  await getAPI().storeSet('batchJobs', jobs.slice(0, 20));
  return jobs;
}

export async function deleteBatchJob(name) {
  const jobs = await getBatchJobs();
  const updated = jobs.filter(j => j.name !== name);
  await getAPI().storeSet('batchJobs', updated);
  return updated;
}
