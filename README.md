# SCSalvager.net — Star Citizen Salvage Guide

Interactive salvage companion for Star Citizen patch 4.7.2.
Made by Chrissyy · Referral: STAR-CH2W-R73F

## What's in this build

- Refinery Bonus Yield Calculator with a Refinery Location dropdown (Stanton / Pyro / Nyx)
- Bonus auto-applies based on the selected refinery (Levski is the only one with current construction bonuses)
- Scraper Module Performance in the left column
- CMAT Sell Estimate panel on the right, with a community-driven **Report a Price** field
- Community price reports persisted server-side via **Upstash Redis** (through Vercel Marketplace)
- Median-of-recent-reports makes the displayed price resistant to single bad submissions
- Scroll-optimized animated space background

## Prerequisites

- Node.js 18+ and npm
- For local full-stack dev: Vercel CLI (`npm i -g vercel`)
- A Vercel account and an Upstash Redis integration (see setup below)

## Initial setup on Vercel

### 1. Import the project

1. Push this repo to GitHub / GitLab / Bitbucket.
2. In Vercel → New Project → Import your repository.
3. Vercel auto-detects the framework (Vite) and picks up `vercel.json` for all other settings. No manual config needed.

### 2. Add Upstash Redis (required for Report-a-Price)

1. In your Vercel project dashboard → **Storage** tab → **Create Database**.
2. Pick **Upstash** → **Upstash for Redis**.
3. Select a free-tier database and click **Create & Continue**.
4. Connect it to the project when prompted. Vercel auto-injects these environment variables into every deployment:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - (and the `KV_REST_API_URL` / `KV_REST_API_TOKEN` aliases for legacy compatibility)
5. Redeploy the project so the new env vars take effect.

### 3. Connect the custom domain scsalvager.net

1. Vercel → Project → **Domains** → **Add** → enter `scsalvager.net`.
2. Either:
   - Point your registrar's nameservers to Vercel's DNS, OR
   - Add the recommended `A` / `CNAME` record at your registrar pointing `scsalvager.net` to Vercel.
3. SSL auto-provisions once DNS resolves.

## Local Development

**Frontend only** (community price API won't respond locally):
```bash
npm install
npm run dev
# open http://localhost:5173
```

**Full stack (Vite + API function + Upstash Redis)**:
```bash
npm install
vercel link           # one-time, connects this folder to your Vercel project
vercel env pull       # pulls the Upstash env vars into .env.local
vercel dev
# open http://localhost:3000
```

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

## About the Report-a-Price backend

- **Endpoint:** `GET|POST /api/prices`
- **Storage:** Upstash Redis (a single master key, `cmat-prices:all`, holds a map of all location reports)
- **Anti-troll:** The displayed price for each location is the **median** of the last 50 reports for that location. One troll submission gets diluted out.
- **Validation:** Server accepts prices between 100 and 200,000 aUEC/SCU. Location name is capped at 100 characters.
- **Cost:** Upstash free tier provides 500,000 commands per month — far beyond what a hobby site needs.

### Resetting bad data manually

Log into your Upstash console (linked from the Vercel Storage tab) → CLI or Data Browser → either delete the `cmat-prices:all` key (wipes all community data) or edit its JSON value and remove the offending location.

## File layout

```
scsalvager/
├── src/
│   ├── App.jsx                # Main component (all UI and state)
│   └── main.jsx               # React entry point
├── public/
│   └── favicon.svg
├── api/
│   └── prices.js              # /api/prices — community price reports
├── index.html
├── vite.config.js
├── vercel.json                # Build + SPA rewrite
├── package.json               # Includes @upstash/redis dependency
└── README.md
```
