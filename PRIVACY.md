# Privacy Policy

_Last updated: April 28, 2026_

SCSalvager.net is a community salvage companion for Star Citizen. This page explains exactly what we store about you, why, where it lives, who else can see it, and what you can do about it.

## What we collect

- **Discord handle (display name)** — required to identify you to other salvagers.
- **Custom display name (optional)** — a free-form name you can set in Settings to use on the Statistics leaderboard instead of your Discord handle, until you verify an RSI handle.
- **RSI handle (optional)** — the Roberts Space Industries citizen handle you choose to link for in-game identity verification.
- **Session data (IP address, user-agent)** — retained only while your session is active to prevent unauthorised access.
- **Anonymous visit ping (user-agent, country code)** — when you load the site without being signed in, your browser fires a single ping that records the user-agent string and country code (from the CDN) so the operator can see how much anonymous traffic the site receives. **IP addresses are not collected** for these pings. We store at most the 1,000 most recent pings, deduped per-browser to one ping per 24 hours via an HTTP-only cookie (`scs_guest_visit`). Once you sign in, no further anonymous pings are recorded for that browser.

Anything else you see on the site is content you've authored yourself (ledger entries, community price reports, your preference toggles) — we keep it associated with your Discord handle so it's there the next time you sign in, and you can wipe all of it via Settings → Danger Zone at any time.

Screenshots you upload to auto-fill refinery or sell orders — including any cropped subset you select before sending — are sent once to a vision AI service for parsing and immediately discarded. They are never written to disk, stored in Redis, or logged.

## Why we collect it

We collect only what is needed to operate the service:

- Only your Discord handle is required to create and authenticate your account.
- Custom display name is collected only when you set one, solely to render that label on the Statistics leaderboard in place of your Discord handle.
- RSI handle is collected solely to verify your in-game identity when you choose to do so. Verification is optional. A verified RSI handle replaces both your Discord handle and any custom display name on the leaderboard.
- Session data (IP, user-agent) is retained only while your session is active to prevent unauthorised access.

## How it is stored

- All account data — sessions, ledgers, preferences, login events, user index — lives in **Upstash Redis**, a hosted Redis service.
- Session cookies (`scs_session`) are **HTTP-only**, marked `Secure` in production, set with `SameSite=Lax`, and expire **7 days** after issue. The cookie is scoped to the canonical site origin (`scsalvager.net`) regardless of which front the request arrives on.
- The global login event log is capped at **100,000 entries**; older entries are trimmed automatically.
- The anonymous visit log is capped at the **1,000 most recent entries** (oldest dropped on each new write). Each entry holds only the three fields above (timestamp, user-agent, country code) and is never associated with a user account.
- **Screenshots are not stored.** Both full uploads and any cropped subset you choose before submitting exist only in server memory for the duration of the single vision-API call, then are released to be garbage-collected. They never reach Redis or any log.
- The site is hosted on **Vercel**, which runs the serverless API.

## Third party disclosure

We share data only with the services required for the site to function:

- **Discord** — OAuth login provider. Discord knows you've authorized this app. If you opt in to refinery-completion DMs, we deliver those messages through Discord's API.
- **Anthropic** — when you upload a screenshot (including a crop you select before submitting), the image is sent once to Anthropic's Claude API for parsing. Under Anthropic's commercial terms, API inputs are not used to train models and are not retained beyond the request.
- **Roberts Space Industries** — when you click "Verify Now" on your RSI handle, our server fetches your public RSI profile page (`robertsspaceindustries.com/citizens/{handle}`). RSI sees a request from our server's IP address; we do not send any of your data to RSI.
- **Cloud Imperium Games / scmdb.net / finder.cstone.space** — the Missions, Ship Details, and Scraper Module Performance panels render data scraped from these public Star Citizen reference sites. Requests run server-side from our infrastructure (or are baked into the build); your browser does not contact those sites directly because of you using SCSalvager.net.
- **Upstash** — operates the Redis instance where your account data lives.
- **Vercel** — hosts the application and serverless functions. Server logs may include standard request metadata (IP, user agent, path) plus diagnostic OAuth logs (request host, redirect URI, presence flags for cookies — never the cookie values themselves).

We do **not** sell, rent, or trade your data to anyone, ever.

## Your rights

You can:

- **View your data** at any time — your full Ledger is on the Ledger tab; your preferences and RSI handle state are in Settings.
- **Opt out of Discord DMs** at any time in Settings — delivery stops immediately.
- **Disconnect Discord notifications** without losing your account.
- **Reset your ledger when a new Star Citizen patch drops** — Settings → Patch reset offers a one-click "Clear ledger for new patch" button on the day a new patch goes live. It soft-deletes every refinery job and sell order so you start the new cycle clean, while keeping your account, RSI handle, and DM preferences intact. The button only appears on the patch's release date and can be used at most once per patch cycle. We store a single timestamp (`lastPatchClearAt`) so the once-per-cycle guard works.
- **Permanently delete your account** via Settings → Danger Zone. The flow walks through two explicit confirmation prompts and then wipes:
  - your ledger (refinery jobs + sell orders)
  - your preferences (RSI handle, verification, DM opt-in)
  - your user index entry, username mirror, and login event history
  - every active session across every device you've signed in on
  - your contributions to the site-wide Statistics aggregations

  Account deletion is irreversible and we keep no backup tied to your identity.

## Contact

Questions, concerns, or data requests: [Discord community](https://discord.gg/GkQU7AbfBS)
