# Privacy Policy

_Last updated: April 27, 2026_

SCSalvager.net is a community salvage companion for Star Citizen. This page explains exactly what we store about you, why, where it lives, who else can see it, and what you can do about it.

## What we collect

- **Discord handle (display name)** — required to identify you to other salvagers.
- **RSI handle (optional)** — the Roberts Space Industries citizen handle you choose to link for in-game identity verification.
- **Session data (IP address, user-agent)** — retained only while your session is active to prevent unauthorised access.

Anything else you see on the site is content you've authored yourself (ledger entries, community price reports, your preference toggles) — we keep it associated with your Discord handle so it's there the next time you sign in, and you can wipe all of it via Settings → Danger Zone at any time.

Screenshots you upload to auto-fill refinery or sell orders are sent once to a vision AI service for parsing and immediately discarded — they are never written to disk, stored in Redis, or logged.

## Why we collect it

We collect only what is needed to operate the service:

- Only your Discord handle is required to create and authenticate your account.
- RSI handle is collected solely to verify your in-game identity when you choose to do so. Verification is optional.
- Session data (IP, user-agent) is retained only while your session is active to prevent unauthorised access.

## How it is stored

- All account data — sessions, ledgers, preferences, login events, user index — lives in **Upstash Redis**, a hosted Redis service.
- Session cookies (`scs_session`) are **HTTP-only**, marked `Secure` in production, and expire **7 days** after issue.
- The global login event log is capped at **100,000 entries**; older entries are trimmed automatically.
- **Screenshots are not stored.** They exist only in server memory for the duration of the single vision-API call, then are released to be garbage-collected. They never reach Redis or any log.
- The site is hosted on **Vercel**, which runs the serverless API.

## Third party disclosure

We share data only with the services required for the site to function:

- **Discord** — OAuth login provider. Discord knows you've authorized this app. If you opt in to refinery-completion DMs, we deliver those messages through Discord's API.
- **Anthropic** — when you upload a screenshot, the image is sent once to Anthropic's Claude API for parsing. Under Anthropic's commercial terms, API inputs are not used to train models and are not retained beyond the request.
- **Roberts Space Industries** — when you click "Verify Now" on your RSI handle, our server fetches your public RSI profile page (`robertsspaceindustries.com/citizens/{handle}`). RSI sees a request from our server's IP address; we do not send any of your data to RSI.
- **Upstash** — operates the Redis instance where your account data lives.
- **Vercel** — hosts the application and serverless functions. Server logs may include standard request metadata (IP, user agent, path).

We do **not** sell, rent, or trade your data to anyone, ever.

## Your rights

You can:

- **View your data** at any time — your full Ledger is on the Ledger tab; your preferences and RSI handle state are in Settings.
- **Opt out of Discord DMs** at any time in Settings — delivery stops immediately.
- **Disconnect Discord notifications** without losing your account.
- **Permanently delete your account** via Settings → Danger Zone. The flow walks through two explicit confirmation prompts and then wipes:
  - your ledger (refinery jobs + sell orders)
  - your preferences (RSI handle, verification, DM opt-in)
  - your user index entry, username mirror, and login event history
  - every active session across every device you've signed in on
  - your contributions to the site-wide Statistics aggregations

  Account deletion is irreversible and we keep no backup tied to your identity.

## Contact

Questions, concerns, or data requests: [Discord community](https://discord.gg/GkQU7AbfBS)
