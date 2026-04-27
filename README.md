# SCSalvager.net — Star Citizen Salvage Guide

Interactive salvage companion for Star Citizen patch 4.7.2.
Made by Chrissyy · Referral: STAR-CH2W-R73F

## What's in this build

UPDATE 4/26/2026 v2.4

Added:
- Refinery Job Orders: new "Upload screenshot" button. Drop in a screenshot of the in-game refinery setup screen and the Refinery Location, Method, SCU, and Refinery Time fields auto-fill (cSCU values from the in-game screen are converted to SCU automatically — 1 SCU = 100 cSCU).
- Sell Orders: same flow. Drop in a screenshot of the in-game Commodities / Trading Console and Sell Location, SCU, and aUEC fields auto-fill — plus the Report a Price input is seeded with the per-SCU value from the screenshot.
- Both upload flows analyze the image once via vision AI and discard it immediately. Nothing is stored on the server.

Modified:
- Material renamed: "Recycle Material Composite" → "Recycled Material Composite" to match the in-game name. Existing community price reports roll forward; old- and new-name reports merge into a single median.
- Location and Refinery Method dropdowns now default to "(Select a Location)" / "(Select a Method)" — you have to pick before the Home Sell Estimate shows a result.

Fixes:
- Sell-order screenshot auto-fill no longer guesses a location when the result is ambiguous (e.g. "Pyro Gateway" matches both the Stanton and Nyx ends of the gate) — it surfaces the candidates and lets you pick.

UPDATE 4/25/2026 v2.3

Added:
- Logged-in users now see an in-page banner when a new deployment goes live, prompting them to press Ctrl+Shift+R to hard-refresh and pick up the latest version.
- Discord #releases now auto-announces incremental changelog bullets (not just full version bumps), posting silently without @everyone.
- Report a Price now also lives on the Ledger, between the Sell Orders form and Recent Sales. It targets whatever sell point you're logging an order for, and shares its median with the Home page widget — so a report from either place updates the Sell Location dropdown for everyone.

Modified:
- Removed "Sold to Player" from the Home page Sell Location dropdown — player sales now belong only on the Ledger tab where you can record the buyer and final aUEC.
- Replaced the header title block with a full-width SCSalvager.net banner; Discord, login, and Patch Verified buttons remain underneath.
- Sell Estimate panel cleanup — dropped the redundant Region/System and Sell Price cards (the metric table beneath already shows the same numbers), renamed "Selected Sell Price" to "Reported Sale Price", and "Total From Base Yield" to "Profit".
- UI palette tuned toward the Star Citizen mobiGlass aesthetic — panels now have subtle lit-edge inner glows, cyan section headers carry a soft holographic shimmer, and the active tab visibly "powers on".
- Refinery time is now user-entered with Hours/Min/Sec fields on the Ledger's Submit Order and Edit Job forms (matches what the in-game refinery actually quotes you). The Home page Refinery Bonus Yield Calculator no longer shows an auto-estimated Time row — it's expected yield + cost only.
- Sell Location dropdowns (Home Sell Estimate + Ledger Sell Orders + Edit modal) are now grouped by system — Stanton / Pyro / Nyx — with each system sorted by best price first. Matches the Refinery Location dropdown's grouping. Also: a couple of label tidies — "Sell Point" → "Sell Location" on the Ledger, and "Material SCU" → "SCU Amount" on the Home Sell Estimate.
- Internal: bumped the release-announce GitHub Actions workflow to Node.js 24-native action versions, removing the Node 20 deprecation warnings.

Fixes:
- Cleaned up the 30-day history notes column: dropped the redundant "At" prefix from refinery and sell-order entries (e.g. "Levski · Cost: 1,152 aUEC", "Sold to Player (PlayerName)").
- Refinery completion DMs now report the refined yield (the SCU you actually pick up) instead of the raw input SCU you fed into the refinery.
- Mobile layout polish — wide data tables (Scraper Modules, Stock Components, 30-day history) now scroll inside themselves on small screens instead of dragging the whole page sideways, and the header CTAs/tabs lay out more cleanly on phones.

UPDATE 4/25/2026 v2.2
Notable Changes:
- Users can now opt-in to receive Discord DM's from SCSalvager bot to notify them of completed refinery jobs. with the response: "Your Refinery Job for {Amount}SCU of Construction Material is ready for pickup at {Location}.
- Added "Join our Discord" button to the header. Linking to this server.
- Moved Ship Selected Details and Ship selection to a new tab titled "Ship Details".
- Added stock component list for all 5 ships.

UPDATE 4/24/2026 v2.1 
- Users can now select refinery methods in both the ledger and home calculator to calculate expected yield, cost, and time required for less human input.

RELEASE V1.0
- Refinery Bonus Yield Calculator with a Refinery Location dropdown (Stanton / Pyro / Nyx)
- Scraper Module Performance reference
- CMAT Sell Estimate panel with a community-driven **Report a Price** field
- Median-of-recent-reports makes displayed prices resistant to single bad submissions
- **Ledger tab** — personal refinery job / sell order tracker with live timers, pickup flow, lifetime stats, and a 30-day history
- **Discord login** — users sign in with Discord to sync their Ledger across devices
- Scroll-optimized animated space background 
