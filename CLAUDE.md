# ShootAI-Web — Project Context for Claude

## What This Is
React 18 SPA + Express/Node.js backend for AI fashion photography. Generates model shots by sending product + model reference images to Google Gemini (gemini-3.1-flash-image). Single user (admin), testing phase only.

---

## Deployment

- **VM**: GCE e2-micro (1 GB RAM), running Ubuntu
- **Process manager**: PM2, process name `shootai`
- **Web server**: nginx reverse proxy → PM2 on port 3001
- **SSH**: `ssh kshitiz_kamra@<VM_IP>`
- **Server path on VM**: `~/shootai/server/`
- **Auto-restart**: git push to main → PM2 restarts automatically

### Useful VM commands
```bash
pm2 logs shootai --lines 200   # tail logs
pm2 restart shootai            # manual restart
pm2 status                     # check process health
```

---

## Key Files

| File | Purpose |
|------|---------|
| `server/server.js` | Main Express backend — all API routes, batch logic |
| `src/utils/api.js` | Frontend — prompt building, Gemini API calls, batch submission |
| `src/components/WorkflowE.js` | Workflow E UI — lifestyle/studio PDP shots |
| `src/components/Batch.js` | Batch queue + jobs UI |
| `src/utils/batchQueue.js` | Client-side batch queue (IndexedDB) |
| `server/prompt_templates.seed.json` | Seed file — source of truth for prompt templates |
| `server/data/prompt_templates.json` | Runtime file — loaded by server on startup |

### Prompt template system
- Both `server/prompt_templates.seed.json` and `server/data/prompt_templates.json` are tracked by git
- Claude edits BOTH files and keeps them in sync — never ask the user to edit templates manually
- Always read `server/data/prompt_templates.json` first (it may contain UI edits newer than the seed)
- On startup, server merges seed → runtime (adds MISSING keys only, never overwrites existing)
- Since the runtime file is now committed, `git push` updates the VM's runtime directly — **no delete/re-seed step needed**

---

## Batch Processing Architecture

### Submission flow
1. Client builds queue items in `WorkflowE.js` via `prepareBatchPDPShotE()` in `api.js`
2. User clicks Submit in `Batch.js` → `submitBatchJob()` → `POST /api/ai/gemini-batch-create`
3. Server writes idempotency key (`idem_{submissionId}`) + temp meta, fires `createBatchJobAsync` in background, responds immediately with `{name: 'submitting/{tempId}'}`
4. `createBatchJobAsync`: deduplicates images → uploads to Gemini File API → calls `ai.batches.create()` → writes `batch_tempmap_{tempId}` mapping temp→real name

### Status check flow (every 30s)
1. Client polls `POST /api/ai/gemini-batch-get`
2. Server calls `checkBatchState()` via REST (lightweight, no billing — uses `&fields=` param)
3. If REST fails → SDK fallback `ai.batches.get()` (NOTE: this retrieves inline data, may bill)
4. On SUCCEEDED → fires `downloadBatchImages()` (one-shot, guarded by `dlKey` in `ongoingBatchFetches`)

### Download flow
- `downloadBatchImages()` does `GET /v1beta/{name}?key=...` — this is the billable retrieval
- Processes images **sequentially** (not parallel) to avoid OOM on 1 GB VM
- Saves to `~/shootai/server/data/users/{uid}/batch_images/{jobId}/0.jpg` etc.
- Results cached in `batch_results_{jobId}` store → subsequent polls return from cache

### Key in-memory guards (cleared on server restart!)
- `ongoingBatchFetches` Map: prevents concurrent status checks and duplicate downloads
- `submissionLock`: prevents duplicate batch creation during same upload window

---

## GCE Billing

Gemini bills per image generation event (logged in GCE BigQuery dataset). Each batch of 5 shots = 5 GCE entries when correct.

### Why duplicates happened (and fixes)
| Cause | Fix |
|-------|-----|
| `downloadBatchImages` using `Promise.all` → OOM → crash → re-download | Changed to sequential `for...of` loop |
| `checkBatchState` REST always failing → SDK fallback `ai.batches.get()` retrieves full inline data → bills AGAIN on top of download | Fixed REST URL with `&fields=name,done,metadata,error,state` (no inline data) + added `data.metadata?.state` parsing (state was nested, not top-level) |

### How to verify billing is correct
After a batch run, check GCE dataset. Should see exactly 5 rows per 5-shot batch. If 10 rows for one batch, the status check is still triggering a full inline retrieval.

---

## Workflow E — Prompt System

### Shot types
`Front`, `Styled`, `Side`, `Back`, `Detail Close-Up`

### Key template keys (in `prompt_templates.seed.json`)
- `global.hair_lock` — locks hair style/length/texture across all shots
- `global.garment_shape_lock` — prevents garment shape distortion
- `model_identity.{shotType}` — per-angle identity lock
- `e_shared.bgLock` — background color/environment lock
- `e_shared.lighting`, `e_shared.shadow` — lighting consistency
- `e_styled.scene_integration` — model blends naturally with background scene
- `e_category_actions.{category}.{shotType}` — per-category pose/action

### Background image handling (lifestyle mode)
The background reference image is explicitly labeled in the prompt as:
> "ENVIRONMENT ONLY. This image contains NO person — use it ONLY for the wall color, floor color, and environment. Do NOT allow this image to influence the model's identity, face, skin tone, hair, or body in any way."

This prevents Gemini from using the background image as a secondary model reference.

### `buildShotPromptE()` structure
```
garment_orientation + model_identity + hair_lock + action + garment_shape_lock +
print_lock_angle + bgLock + framingLock + lighting + shadow + scene_integration
```

---

## Known Issues & Status

| Issue | Status |
|-------|--------|
| Model identity drift when background is present | Partially fixed — added explicit ENVIRONMENT ONLY label on bg image, strengthened model_identity prompts. Still imperfect for some angles. |
| Hair inconsistency between shots | Fixed — added `global.hair_lock` template key |
| Lighting/shadow mismatch in side pose | Partially addressed via `e_shared.lighting` and `shadow` in prompt |
| Side pose exact side profile (no front visible) | Fixed — all Side entries changed to 3/4 angle (60–70% side, 30–40% front) |
| GCE double billing (10 entries for 5-shot batch) | Fixed — `checkBatchState` now uses `&fields=` param to prevent inline data retrieval |
| REST status check always failing (SDK fallback) | Fixed — added `data.metadata?.state` parsing |
| `[batch-dl-diag]` spam logs in PM2 | Still present — low priority cleanup |
| OOM on download (old `Promise.all`) | Fixed — sequential download |

---

## Batch Config Sent to Gemini

Each item in the batch is sent with:
```javascript
config: {
  responseModalities: ['IMAGE'],  // prevent text pass (double billing)
  candidateCount: 1,              // prevent 2 candidates per item
  imageConfig: { aspectRatio: '3:4', imageSize: '1K' },
}
```

---

## Important Rules (from user)
- **No code changes without explicit confirmation**
- User is sole developer and tester
- Server on GCE VM named `shootai` (not `ShootAI-Web`)
- PM2 process name is `shootai`
- Git push to main auto-restarts the server
