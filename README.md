# SCSalvager.net — Star Citizen Salvage Guide

Interactive salvage companion for Star Citizen patch 4.7.2.
Made by Chrissyy · Referral: STAR-CH2W-R73F

## What's in this build

- Refinery Bonus Yield Calculator with a Refinery Location dropdown (Stanton / Pyro / Nyx)
- Scraper Module Performance reference
- CMAT Sell Estimate panel with a community-driven **Report a Price** field
- Median-of-recent-reports makes displayed prices resistant to single bad submissions
- **Ledger tab** — personal refinery job / sell order tracker with live timers, pickup flow, lifetime stats, and a 30-day history
- **Discord login** — users sign in with Discord to sync their Ledger across devices
- Scroll-optimized animated space background

## Prerequisites

- Node.js 18+ and npm
- For local full-stack dev: Vercel CLI (`npm i -g vercel`)
- A Vercel account with an Upstash Redis integration
- A Discord application registered at https://discord.com/developers/applications

## Initial setup on Vercel

### 1. Import the project

1. Push this repo to GitHub / GitLab / Bitbucket.
2. In Vercel → New Project → Import your repository.
3. Vercel auto-detects the framework (Vite) and picks up `vercel.json` for all other settings. No manual config needed.

### 2. Add Upstash Redis (required for the backend)

1. In your Vercel project dashboard → **Storage** tab → **Create Database**.
2. Pick **Upstash** → **Upstash for Redis**.
3. Select a free-tier database and click **Create & Continue**.
4. Connect it to the project when prompted. Vercel auto-injects:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
5. Redeploy the project so the new env vars take effect.

### 3. Register a Discord application (required for login)

1. Go to https://discord.com/developers/applications
2. Click **New Application**, give it a name (e.g. "SC Salvager"), and click Create.
3. Under the **OAuth2** tab:
   - In **Redirects**, add `https://scsalvager.net/api/auth/callback` (and, optionally, a preview URL like `https://<your-preview>.vercel.app/api/auth/callback` for testing).
   - Click **Save Changes**.
   - Copy the **Client ID** (visible at the top of the OAuth2 page, same as the Application ID).
   - Click **Reset Secret**, then copy the newly generated **Client Secret** — this value is shown once and must be stored securely.
4. In Vercel → your project → **Settings** → **Environment Variables**, add (scope: Production, Preview, Development as needed):
   - `DISCORD_CLIENT_ID` = your Client ID
   - `DISCORD_CLIENT_SECRET` = your Client Secret
5. Redeploy so the new env vars take effect.

**Security note:** The Client Secret grants anyone who has it the ability to impersonate your app. Never commit it to source control, paste it in chat logs, or share it in screenshots. It only belongs in Vercel's Environment Variables panel.

### 4. Connect the custom domain scsalvager.net

1. Vercel → Project → **Domains** → **Add** → enter `scsalvager.net`.
2. Either:
   - Point your registrar's nameservers to Vercel's DNS, OR
   - Add the recommended `A` / `CNAME` record at your registrar pointing `scsalvager.net` to Vercel.
3. SSL auto-provisions once DNS resolves.

## Local Development

**Frontend only** (community price API and login won't work locally):
```bash
npm install
npm run dev
# open http://localhost:5173
```

**Full stack (Vite + API routes + Upstash + Discord OAuth)**:
```bash
npm install
vercel link           # one-time, connects this folder to your Vercel project
vercel env pull       # pulls Upstash + Discord env vars into .env.local
vercel dev
# open http://localhost:3000
```

For OAuth to work locally, also add `http://localhost:3000/api/auth/callback` as a redirect URI in your Discord application's OAuth2 settings.

## Build

```bash
npm install
npm run build
# output: dist/
```

## Deploy

Deployment is automatic once the repo is connected — every push to the main branch triggers a new Vercel deployment.

Manual deploys via CLI:
```bash
vercel           # preview deployment
vercel --prod    # production deployment
```

## Backend overview

### Community price reports
- **Endpoint:** `GET|POST /api/prices`
- **Storage:** Upstash Redis under key `cmat-prices:all`
- **Anti-troll:** displayed price is the median of the last 50 reports per location
- **Validation:** price 100–200,000 aUEC/SCU, location name capped at 100 chars

### Authentication
- **Endpoints:** `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout`, `/api/auth/me`
- **Flow:** Discord OAuth 2.0, `identify` scope only (username + avatar, no email)
- **Session:** 7-day HTTP-only cookie pointing to a Redis-stored session record (`session:{token}`)
- **CSRF:** OAuth `state` parameter stored in a short-lived cookie and validated on callback

### Per-user ledger
- **Endpoint:** `GET|POST /api/ledger`
- **Storage:** Upstash Redis under key `ledger:{userId}` (one key per Discord user)
- **Auth required:** returns 401 if the session cookie is missing or expired
- **Sanitization:** server validates and clamps all submitted fields before writing

## File layout

```
scsalvager/
├── src/
│   ├── App.jsx                # Main component (all UI, state, API calls)
│   └── main.jsx               # React entry point
├── public/
│   └── favicon.svg
├── api/
│   ├── _lib/
│   │   ├── redis.js           # Shared Upstash client
│   │   ├── session.js         # Cookie parsing + session CRUD
│   │   └── discord.js         # Discord OAuth helpers
│   ├── auth/
│   │   ├── login.js           # /api/auth/login
│   │   ├── callback.js        # /api/auth/callback
│   │   ├── logout.js          # /api/auth/logout
│   │   └── me.js              # /api/auth/me
│   ├── ledger.js              # /api/ledger (per-user)
│   └── prices.js              # /api/prices (community reports)
├── index.html
├── vite.config.js
├── vercel.json                # Build + SPA rewrite
├── package.json               # @upstash/redis dependency
└── README.md
```
