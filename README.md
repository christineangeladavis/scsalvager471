# [SCSalvager.net](http://SCSalvager.net) - Your All in One Salvage Tool

Interactive salvage companion for Star Citizen patch 4.7.2.
Made by Chrissyy · Referral: STAR-CH2W-R73F

## What's in this build

UPDATE 4/27/2026 v2.5

Added:
- New Statistics tab (logged-in only): shows site-wide totals (SCU refined, profit, refinery fees), Refinery Most Used, Most Used Method, per-material refined totals (Construction Salvage / Pieces / Rubble), plus a Top 5 Salvagers leaderboard ranked by SCU refined.
- Settings → RSI Handle: enter your Star Citizen handle to display under that name on the Statistics leaderboard instead of your Discord username.
- Settings → RSI Handle verification: prove ownership of your handle by pasting a one-time verification code into your RSI Short Bio. Once we see it, your handle gets a check mark next to it on the Statistics leaderboard. You can remove the code from your bio after we verify.
- Statistics leaderboard now displays your RSI handle only once it's been verified. Saving a handle without verifying still shows your Discord username — verification is what unlocks the swap (and prevents impersonation by someone typing in your handle).
- Settings → Danger Zone: you can now permanently delete your account. The flow walks through two confirmation prompts and then wipes your ledger, prefs, login history, and every active session. The deletion also drops your contributions out of the Statistics aggregations.
- Privacy Policy: new "Privacy Policy" link in the site footer opens a full policy explaining what we collect, why, how it's stored, who it's shared with, and what you can do about it. Canonical copy also lives at PRIVACY.md in the repo. Contact channel for questions / data requests is the [Discord community](https://discord.gg/GkQU7AbfBS).
- Terms of Service: companion "Terms of Service" link next to Privacy Policy in the footer covers eligibility, acceptable use, account suspension, content licensing for community price reports, no-warranty disclaimers, and the explicit non-affiliation with Cloud Imperium Games / Roberts Space Industries. Canonical copy at TERMS.md.

UPDATE 4/26/2026 v2.4

Added:
- Refinery Job Orders: new "Upload screenshot" button. Drop in a screenshot of the in-game refinery setup screen and the Refinery Location, Method, SCU, and Refinery Time fields auto-fill (cSCU values from the in-game screen are converted to SCU automatically — 1 SCU = 100 cSCU).
- Sell Orders: same flow. Drop in a screenshot of the in-game Commodities / Trading Console and Sell Location, SCU, and aUEC fields auto-fill — plus the Report a Price input is seeded with the per-SCU value from the screenshot.
- Both upload flows analyze the image once via vision AI and discard it immediately. Nothing is stored on the server.
- Anonymous visitors get a one-time login prompt on page load that explains what signing in with Discord unlocks (the Ledger, community price reports, optional refinery-completion DMs). Dismissible with a 24-hour cooldown so it doesn't nag.

Fixes:
- Sell-order screenshot auto-fill no longer guesses a location when the result is ambiguous (e.g. "Pyro Gateway" matches both the Stanton and Nyx ends of the gate) — it surfaces the candidates and lets you pick.
- Material renamed: "Recycle Material Composite" → "Recycled Material Composite" to match the in-game name. Existing community price reports roll forward; old- and new-name reports merge into a single median.
- All Material, Refinery Method, and Sell Location dropdowns default to a "(Select a …)" placeholder. Forms now require an explicit pick before submitting; "Material Type" is just "Material" everywhere for consistency.
- Sell Location only appears on the Home Sell Estimate and Ledger Sell Orders forms after a material has been picked — keeps the form flow in the right order (material first, location second).
- "Sold to Player" sits at the top of the Ledger Sell Orders' Sell Location dropdown (directly under the placeholder) instead of being buried beneath the system groups.

UPDATE 4/25/2026 v2.3

Added:
- Logged-in users now see an in-page banner when a new deployment goes live, prompting them to press Ctrl+Shift+R to hard-refresh and pick up the latest version.
- Discord #releases now auto-announces incremental changelog bullets (not just full version bumps), posting silently without @everyone.
- Report a Price now also lives on the Ledger, between the Sell Orders form and Recent Sales. It targets whatever sell point you're logging an order for, and shares its median with the Home page widget — so a report from either place updates the Sell Location dropdown for everyone.
- Refinery time is now user-entered with Hours/Min/Sec fields on the Ledger's Submit Order and Edit Job forms (matches what the in-game refinery actually quotes you).
- Full-width SCSalvager.net banner at the header (replaces the old text+logo title block); Discord, login, and Patch Verified buttons remain underneath.
- UI palette tuned toward the Star Citizen mobiGlass aesthetic — panels now have subtle lit-edge inner glows, cyan section headers carry a soft holographic shimmer, and the active tab visibly "powers on".
- Sell Location dropdowns (Home Sell Estimate + Ledger Sell Orders + Edit modal) are now grouped by system — Stanton / Pyro / Nyx — with each system sorted by best price first.

Removed:
- "Sold to Player" from the Home page Sell Location dropdown — player sales now belong only on the Ledger tab where you can record the buyer and final aUEC.
- Auto-estimated Time row from the Home page Refinery Bonus Yield Calculator — it's expected yield + cost only.
- Redundant Region/System and Sell Price cards from the Sell Estimate panel — the metric table beneath already shows the same numbers.

Fixes:
- Cleaned up the 30-day history notes column: dropped the redundant "At" prefix from refinery and sell-order entries (e.g. "Levski · Cost: 1,152 aUEC", "Sold to Player (PlayerName)").
- Refinery completion DMs now report the refined yield (the SCU you actually pick up) instead of the raw input SCU you fed into the refinery.
- Mobile layout polish — wide data tables (Scraper Modules, Stock Components, 30-day history) now scroll inside themselves on small screens instead of dragging the whole page sideways, and the header CTAs/tabs lay out more cleanly on phones.
- Label tidies: "Selected Sell Price" → "Reported Sale Price", "Total From Base Yield" → "Profit", "Sell Point" → "Sell Location", and "Material SCU" → "SCU Amount".
- Internal: bumped the release-announce GitHub Actions workflow to Node.js 24-native action versions, removing the Node 20 deprecation warnings.

UPDATE 4/25/2026 v2.2

Added:
- Users can now opt-in to receive Discord DM's from SCSalvager bot to notify them of completed refinery jobs, with the response: "Your Refinery Job for {Amount}SCU of Construction Material is ready for pickup at {Location}."
- "Join our Discord" button in the header, linking to the SCSalvager Discord server.
- New "Ship Details" tab — Ship Selected Details and ship selection live here now.
- Stock component list for all 5 ships.

UPDATE 4/24/2026 v2.1

Added:
- Users can now select refinery methods in both the ledger and home calculator to calculate expected yield, cost, and time required for less human input.

RELEASE V1.0

Added:
- Refinery Bonus Yield Calculator with a Refinery Location dropdown (Stanton / Pyro / Nyx).
- Scraper Module Performance reference.
- CMAT Sell Estimate panel with a community-driven **Report a Price** field.
- Median-of-recent-reports makes displayed prices resistant to single bad submissions.
- **Ledger tab** — personal refinery job / sell order tracker with live timers, pickup flow, lifetime stats, and a 30-day history.
- **Discord login** — users sign in with Discord to sync their Ledger across devices.
- Scroll-optimized animated space background.
