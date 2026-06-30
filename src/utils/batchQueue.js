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

// ── Queue ─────────────────────────────────────────────────────────────────

export async function getBatchQueue() {
  try { return await getAPI().storeGet('batchQueue') || []; }
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
  await getAPI().storeSet('batchQueue', queue);
  return newItem;
}

export async function removeFromBatchQueue(id) {
  const queue = await getBatchQueue();
  const updated = queue.filter(item => item.id !== id);
  await getAPI().storeSet('batchQueue', updated);
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
