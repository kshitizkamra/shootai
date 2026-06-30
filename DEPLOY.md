# ShootAI Web — Deployment Guide

## Architecture
- **Frontend** (React): Deployed to GoDaddy public_html
- **Backend** (Node.js/Express): Deployed to Railway (recommended) or GoDaddy Node.js App

---

## Step 1: Deploy Backend to Railway (Recommended)

Railway is free to start and handles long-running AI requests (30-60s) without timeouts.

1. Go to https://railway.app and sign up (free)
2. Click **New Project → Deploy from GitHub repo**
3. Push the `server/` folder to a GitHub repo, OR use Railway CLI:
   ```
   npm install -g @railway/cli
   cd ShootAI-Web/server
   railway login
   railway init
   railway up
   ```
4. In Railway dashboard, go to **Variables** and add:
   - `JWT_SECRET` = any long random string (e.g. `shootai-prod-secret-2024-xyz`)
   - `PORT` = `3001` (Railway sets this automatically)
5. Click **Generate Domain** in Railway → you'll get a URL like `https://shootai-server-production.up.railway.app`
6. Copy this URL — you'll need it in Step 2.

### Alternative: GoDaddy Node.js App
If you want everything on GoDaddy:
1. In cPanel, go to **Software → Node.js App**
2. Create new app:
   - Node.js version: 18+
   - Application mode: Production
   - Application root: `shootai-server`
   - Application URL: `api.yourdomain.com` (subdomain)
   - Application startup file: `server.js`
3. Upload `server/` contents to the `shootai-server` folder via File Manager
4. In cPanel Node.js App, click **Run NPM Install**
5. Set environment variables: `JWT_SECRET=your-secret-here`
6. Click **Restart**

---

## Step 2: Build the React Frontend

1. Open `ShootAI-Web/.env.production` (create if not exists):
   ```
   REACT_APP_SERVER_URL=https://your-railway-url.railway.app
   ```
   Replace with your actual backend URL from Step 1.

2. In terminal:
   ```bash
   cd ShootAI-Web
   npm install
   npm run build
   ```
   This creates a `build/` folder.

---

## Step 3: Upload Frontend to GoDaddy

1. Log in to GoDaddy cPanel
2. Open **File Manager**
3. Navigate to `public_html/` (or a subdomain folder)
4. Upload ALL contents of `ShootAI-Web/build/` to `public_html/`
   - You can zip the build folder and extract it in cPanel
5. Make sure `index.html` is in the root of `public_html/`

---

## Step 4: Configure Domain

- Frontend: `www.yourdomain.com` → points to GoDaddy public_html (automatic)
- Backend: Railway provides its own URL, or use `api.yourdomain.com` if on GoDaddy

For Railway backend, update your `.env.production` with the Railway URL and rebuild + re-upload the frontend.

---

## Step 5: Test

1. Open `https://www.yourdomain.com`
2. You should see the ShootAI login screen
3. Click **Create Account** and register
4. Go to Settings and enter your Gemini/OpenAI API keys
5. Upload a model and try a generation

---

## Managing Users

Users are stored in `server/data/users.json` on Railway/GoDaddy.

To add/remove users manually, SSH into your server and edit this file, or build an admin panel later.

---

## Pricing Estimate

| Service | Cost |
|---------|------|
| GoDaddy shared hosting (frontend) | Already have it |
| Railway backend | Free tier (500 hours/month), then ~$5/month |
| Gemini API (per customer) | Customer's own API key |
| OpenAI API (per customer) | Customer's own API key |

**Total cost to run: ~$0-5/month** (customers pay their own AI API costs)

---

## Troubleshooting

**Login doesn't work**: Check that `REACT_APP_SERVER_URL` in `.env.production` points to the correct backend URL. Rebuild and re-upload.

**Images not generating**: Customer needs to enter their Gemini/OpenAI API keys in Settings.

**Backend crashes on GoDaddy**: GoDaddy shared hosting may timeout long requests. Switch to Railway.

**CORS errors**: The backend allows all origins by default. If you restrict it, add your domain to the CORS config in `server.js`.
