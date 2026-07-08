# ShootAI-Web — Deployment Guide

## Current Setup

| Component | Details |
|-----------|---------|
| VM | GCE e2-micro, 1 GB RAM, Ubuntu |
| Process | PM2, process name `shootai` |
| Web server | nginx → port 3001 |
| Server path | `~/shootai/server/` |
| Auto-restart | git push to main triggers PM2 restart |

---

## Deploy a Code Change

```bash
# From local Git Bash
git add .
git commit -m "your message"
git push
# PM2 auto-restarts on the VM — done
```

Check it worked:
```bash
ssh kshitiz_kamra@<VM_IP>
pm2 logs shootai --lines 50
```

---

## Update Prompt Templates

Prompt templates have two files — **both tracked by git**:
- **Seed**: `server/prompt_templates.seed.json` — source of truth
- **Runtime**: `server/data/prompt_templates.json` — what the server actually loads

Claude edits both files directly and keeps them in sync. On push, the VM gets the updated runtime file and loads it on restart — **no delete/re-seed step needed**.

Also update CLAUDE.md if the troubleshooting section mentions deleting the runtime file — that's no longer required.

---

## Useful VM Commands

```bash
pm2 status                     # check process health
pm2 logs shootai --lines 200   # tail recent logs
pm2 restart shootai            # manual restart
pm2 logs shootai --lines 500 | grep "batch-create-hit"   # audit batch submissions
pm2 logs shootai --lines 500 | grep "batch-bg"           # audit status checks
```

---

## Environment Variables

Set in `~/shootai/server/.env` on the VM:

```
JWT_SECRET=...
GOOGLE_API_KEY=...   # or set via admin panel in the app
PORT=3001
```

---

## Architecture Overview

```
Browser (React SPA)
    ↓ HTTPS
nginx (VM)
    ↓ proxy_pass :3001
Express/Node.js (PM2 process: shootai)
    ↓ REST API
Google Gemini API (File API + Batch API)
```

### Data storage
All user data stored as JSON files on the VM:
- `~/shootai/server/data/users.json` — user accounts
- `~/shootai/server/data/users/{uid}/` — per-user data (batch jobs, results, etc.)
- `~/shootai/server/data/prompt_templates.json` — runtime prompt templates

---

## GCE Billing Notes

- Each Gemini batch image generation = 1 GCE billing entry
- A 5-shot batch should produce exactly 5 GCE entries
- If you see 10 entries for a 5-shot batch: status check is triggering full inline retrieval (see CLAUDE.md)
- `checkBatchState` uses `&fields=` URL param to fetch status only — no inline data, no billing
- Only `downloadBatchImages` should trigger billing (one GET per completed batch)

---

## Troubleshooting

**PM2 process keeps crashing**: Check `pm2 logs shootai` — likely OOM. The 1 GB VM can spike during image processing. Sequential download (not parallel) is already in place to mitigate.

**Batch stuck in Pending forever**: Likely server restarted mid-submission before `batch_tempmap` was written. The batch may exist on Gemini but the server lost the mapping. Check Gemini console for recent batch jobs.

**Prompt changes not taking effect**: Runtime template file was not deleted before push. Delete `~/shootai/server/data/prompt_templates.json` on the VM, then re-push.

**Double GCE billing**: REST status check is falling back to SDK (`ai.batches.get()`) which retrieves inline data. Check PM2 logs for `REST check failed` lines. Should show `state=... (REST)` not `using SDK fallback`.
