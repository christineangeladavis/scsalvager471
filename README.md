# [SCSalvager.net](http://SCSalvager.net) - Your All in One Salvage Tool

Interactive salvage companion for Star Citizen patch 4.7.2.
Made by Chrissyy · Referral: STAR-CH2W-R73F

## What's in this build

UPDATE 4/28/2026 v2.6

Added:
- New Missions tab between Ship Details and Ledger. Browse 59 in-game salvage contracts pulled from the live game data, filter by Search / System (Stanton / Pyro / Nyx / Multi) / Faction (Adagio Holdings / Tar Pits) / Legality / Min reward (slider 0–550,000 aUEC), sort by any column, and click any row to open a full mission detail popup.
- Mission detail popup: full briefing copy from the in-game contract manager, location chips (Pickup / Destinations / Prerequisite), chain relationships (Chain starts with / Requires completion of / Unlocks — clickable when the linked mission is also a salvage entry), Min/Max Rank with XP thresholds, and a flag/cooldown grid (Shareable, Sharing CrimeStat, Once only, Re-accept after abandon/fail, Cooldown, Abandon cooldown).
- Mission Reward column shows fee-bearing missions as a negative aUEC line under the reward (e.g. main reward + `-5,000 aUEC` buy-in).
- Ship Details now includes the pledge price in USD and every in-game purchase location with its aUEC price, sourced from finder.cstone.space. Lorville rows display a "10% discount" badge.
- Ship Details lists Teach's Special editions (Levski / Teach's Ship Shop) for ships that have them: Reclaimer (33,339,600 aUEC), Vulture (2,778,300 aUEC), Fortune (1,984,500 aUEC).
- Ledger → 30-Day History panel renamed **Patch History** — now scopes to entries from the current Star Citizen patch (4.7.2) instead of a rolling 30-day window. Header label and footer pill both show the active patch version so it's obvious which game cycle you're looking at. A "Live" badge marks the active patch.
- Patch History now includes a patch dropdown next to the panel header. Switch the panel to view any past patch's entries; future patches are listed but locked until they go live. Title rewrites to match the selected version, and an "everything on screen" Clear option always targets whatever patch is currently displayed.
- Patch History → Clear History dropdown now offers per-patch wipes: a "Current patch · 4.7.2 (everything on screen)" option that empties the panel for the current cycle, plus a separate entry for each older released patch (clears entries from earlier cycles that no longer render in the panel but are still in your stored ledger).
- Settings → **Patch reset** section appears on the day a new Star Citizen patch goes live, with a one-click "Clear ledger for new patch" button so you can start the new cycle with an empty ledger. Available only on patch drop day, once per patch cycle. Hidden every other day. Two-step confirmation flow with a result summary.
- Privacy Policy + Terms of Service refreshed: anonymous visit pings (user-agent + country only — **no IP collected**) and the new patch-reset right are both disclosed under "What we collect" / "Your rights".
- New **notification bell** sits to the left of the user menu (logged-in only). Red badge shows the unread count. Surfaces setup nags (Discord DMs off, RSI handle not linked, RSI handle not verified) plus a "New site update available" entry every time What's New gets a new release section.
- Clicking a notification opens the relevant destination (Settings or What's New) and marks it as read. Read items stay visible in the dropdown — greyed with a slate dot — until the underlying setup is fixed. A "Mark all as read" header button clears the badge in one click.
- Site-wide scrollbar styling: every scrollable surface (page body, modals, tables, dropdowns, custom overflow containers) now uses the same cyan-thumb / slate-track pill-shape style as the Patch History panel. Firefox + Chromium/Webkit both styled.
- New **Donate** button in the footer — cyan pill that opens [streamelements.com/chrissynightingale/tip](https://streamelements.com/chrissynightingale/tip) in a new tab. Sits inline with the Star Citizen referral code pill. Tips help keep the site running.
- Header gains a matching **Donate** tile next to the "Join our Discord" button — same shape and palette as the "Patch Verified" pill on the right side of the header, so the two read as a matched pair. Same StreamElements tip target as the footer button.
- "Join our Discord" button reshaped to a rounded-full pill so it lines up cleanly with the new header Donate tile.

Fixes:
- Drake Vulture and MISC Fortune roles renamed from "Solo Salvage" to "Light Salvage" to match in-game classification.
- Update banner now has a one-click "Update now" button — clicking it clears caches and reloads, no Ctrl+Shift+R required.
- Discord OAuth login: redirect_uri pinned to the canonical https://scsalvager.net origin in production, and login attempts on non-canonical hosts (www.* / preview deploys) now redirect to canonical first so the CSRF state cookie reaches the callback. Fixes "Invalid OAuth2 redirect_uri" and "Invalid OAuth state" errors.
- "Connect Discord" for refinery DMs: session cookie issued as SameSite=Lax (was Strict) so the browser carries it on the cross-site OAuth return trip, and the notifications-link handler bounces non-canonical hosts to canonical first. Resolves the "Your login session expired" loop when linking notifications. (Existing users may need to sign out and sign back in once to refresh the cookie.)
- Home → Scraper Module Performance now shows in-game purchase locations per module, sourced from finder.cstone.space. Each detail card has Stanton / Pyro / Nyx buttons — click to reveal locations + prices for that system, click again to collapse. Systems with no stock for that module hide their button automatically (e.g. Trawler is Stanton-only). The comparison table's Price column was renamed Lowest Price and now reflects the cheapest location across all systems (e.g. Abrade 20,188 aUEC at Everus Harbor instead of the 21,250 sticker).
- Home layout: Scraper Module Performance was lifted out of the left column into its own full-width row beneath Refinery Bonus Yield Calculator + Sell Estimate. Calculator and Sell Estimate now sit side-by-side at the top.
- Privacy Policy and Terms of Service refreshed for the v2.6 build: now cover the optional custom display name, screenshot crop uploads, the canonical-host SameSite=Lax session cookie, and the public Star Citizen reference sites (scmdb.net / finder.cstone.space) used by the Missions, Ship Details, and Scraper Module Performance panels. Footer modals match the canonical PRIVACY.md / TERMS.md copies.

UPDATE 4/27/2026 v2.5.1

Added:
- Settings → Display Name: free-form name shown on the Statistics leaderboard for users who haven't linked an RSI handle yet. Verifying an RSI handle still overrides any custom display name. Display Name section sits at the top of Settings, above Notifications.

Fixes:
- 30-Day History scrollbar now matches the site's color scheme — pill-shaped cyan thumb (hover lighter) on a recessed slate-950 track. Firefox + Chromium/Webkit both styled.

UPDATE 4/27/2026 v2.5

Added:
- New Statistics tab (logged-in only): shows site-wide totals (SCU refined, profit, refinery fees), Refinery Most Used, Most Used Method, per-material refined totals (Construction Salvage / Pieces / Rubble), plus a Top 5 Salvagers leaderboard ranked by SCU refined.
- Settings → RSI Handle: enter your Star Citizen handle to display under that name on the Statistics leaderboard instead of your Discord username.
- Settings → RSI Handle verification: prove ownership of your handle by pasting a one-time verification code into your RSI Short Bio. Once we see it, your handle gets a check mark next to it on the Statistics leaderboard. You can remove the code from your bio after we verify.
- Statistics leaderboard now displays your RSI handle only once it's been verified. Saving a handle without verifying still shows your Discord username — verification is what unlocks the swap (and prevents impersonation by someone typing in your handle).
- Settings → Danger Zone: you can now permanently delete your account. The flow walks through two confirmation prompts and then wipes your ledger, prefs, login history, and every active session. The deletion also drops your contributions out of the Statistics aggregations.
- Privacy Policy: new "Privacy Policy" link in the site footer opens a full policy explaining what we collect, why, how it's stored, who it's shared with, and what you can do about it. Canonical copy also lives at PRIVACY.md in the repo. Contact channel for questions / data requests is the [Discord community](https://discord.gg/GkQU7AbfBS).
- Terms of Service: companion "Terms of Service" link next to Privacy Policy in the footer covers eligibility, acceptable use, account suspension, content licensing for community price reports, no-warranty disclaimers, and the explicit non-affiliation with Cloud Imperium Games / Roberts Space Industries. Canonical copy at TERMS.md.
- What's New: new footer link opens an in-app changelog covering every release back to v1.0, with user-facing summaries of each release's added features and improvements.
- Screenshot upload → Crop to a single order: when you upload a refinery or sell screenshot, a modal opens so you can drag a box around just the order you want to read. Only the cropped area ships to the analyzer — much cleaner results when your screenshot has multiple queued orders.
- Refinery screenshot now also extracts the in-game TOTAL COST in aUEC.
- Refinery Job Orders + Sell Orders: new Clear button next to Submit Order / Log Sale that wipes the form back to defaults. Submitting an order or logging a sale also auto-clears the form so the next entry starts from a clean slate.
- 30-Day History panel now caps the visible table at ~10 rows and scrolls inside itself, with the column headers pinned to the top — keeps the page short even when you've got weeks of activity logged.

Fixes:
- Screenshot extraction now reads fields in a deliberate priority order (Material → Amount → Location → Method → Time → Cost) so the most important fields fill first and dependent dropdowns scope correctly.
- In-game material truncations (e.g. "CONSTRUCTION PI") now resolve to the correct full name on screenshot upload.
- Refinery method names with OCR drift now still match via a fuzzy fallback.
- Sell Orders → Sell Location is always visible (no longer hidden until a material is picked).
- Sell-side material renamed from "Construction Material" → "Construction Materials" to match the in-game Commodities label. Old ledger entries display under the new name and migrate on next edit; community price reports roll forward (old- and new-name reports merge into a single median).
- Refinery Job Orders cost now reflects the exact in-game TOTAL COST when a screenshot was uploaded (instead of the method × material estimate). The COST display is labelled "from screenshot" so you can see when the auto-fill provided it, and submitting the order stores that exact aUEC value — surcharges and workload multipliers included.

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
