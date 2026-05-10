# [SCSalvager.net](http://SCSalvager.net) - Your All in One Salvage Tool

Interactive salvage companion for Star Citizen patch 4.7.2.
Made by Chrissyy · Referral: STAR-CH2W-R73F

## What's in this build

UPDATE 5/9/2026 v2.7.4

Added:
- **Two-way messaging** with SCSalvager Admin. **Reply** button on every admin message threads your response back to that message; **New** button at the top of the Messages dropdown starts a fresh thread. Admins see both sides of the conversation in their moderation view, and can reply directly to a specific message you sent.
- **Site-wide announcement banner**. SCSalvager Admin can post a yellow banner that surfaces on the Home tab right under the HOME nav for every visitor. Banner is purely time-gated: **auto-hides 24 hours after posting**, survives page refresh, and is independent from per-user mailbox messages. Mailbox-targeted broadcasts (separate feature) land in your Messages dropdown but do not drive this banner.
- **Delete message**. Per-entry Delete button drops a message from your Messages view. The deletion is yours — admins still see deleted messages in their moderation history (with a "Deleted by user" tag) so they retain context for compliance and follow-ups, but the message no longer appears in your mailbox or banner.

Changes:
- Messages mailbox poll cadence tightened from 60 seconds to **30 seconds**. New admin-sent messages reach you within ~30 s of the admin clicking Send — still no manual reload required.
- The Home-tab yellow announcement banner is now driven by a dedicated **Post Announcement** action, separate from per-user broadcasts. Broadcasts still arrive in your Messages mailbox; announcements live on the Home banner only. The banner is purely time-gated — survives page refresh and re-login, hides automatically **24 hours** after the admin posts it.
- Messages you send to SCSalvager Admin now surface directly in the admin's Messages mailbox (with your username + a preview), so admins can see and respond to incoming mail without having to dig per-user. Admins continue to see the full thread + history when they open your user record.
- Both **users and admins** can **delete** messages from their inbox. User deletes drop the message from your own view (admins keep a moderation-side record so context survives). Admin deletes drop a message from that admin's overview (the user's own thread is unaffected).
- **SCSalvager Desktop** is now downloadable from **Settings → Desktop App**. Native client (Windows / macOS arm64 / Linux) wraps the site with a system tray, refinery countdown badge, OS toasts when a job is ready, F9 / tray screenshot capture for the in-game refinery setup screen (uses the existing crop modal before upload), an offline read-only ledger cache, and silent auto-update on launch.

UPDATE 5/8/2026 v2.7.3

Added:
- Crew Salvage **Reclaimer** roster picks up three turret stations: **Manned Turret**, **Remote Turret 1**, **Remote Turret 2**. Reclaimer now lists 8 stations total (was 5). Split Calculator + Roles header automatically pick up the new stations — `Roles · X / 8 stations crewed`.
- Crew Salvage **Moth** roster gains a **Missile Operator** station, slotted directly after Pilot. Moth now lists 6 stations total (was 5).
- Statistics top-salvagers leaderboard gains three per-material columns: **Salvage Refined**, **Pieces Refined**, **Rubble Refined**. Each cell sums the user's completed refinery jobs filtered by material so the three columns add up to the SCU Refined cell. Sort order unchanged — still ranks by total SCU Refined.

Fixes:
- **SCU yield display now locale-independent** with exactly two decimals everywhere refined SCU appears (Refinery Job Orders Expected Yield + bonus subline, Edit Job preview, In Progress / Ready for Pickup cards, refinery-completion notifications, Crew Salvage refined-SCU column, Statistics leaderboard SCU columns). Previously a yield like `188.352 SCU` rendered as `"188,352 SCU"` on French / EU-locale devices (comma-as-decimal), so the value looked like 188 thousand SCU rather than 188 SCU and change. Display is now pinned to en-US (`188.35 SCU`) regardless of device locale. Stored ledger values unchanged — display-only fix.
- **Crew Salvage saved sessions now persist server-side.** Saved sessions used to live in React state only — refreshing the page or logging in from another device wiped the list. `/api/ledger` now stores `crewSessions` alongside refinery jobs + sell orders (capped at 200 per user); saving / deleting / editing / completing a session writes through to Redis. Older clients that don't send the field on save have their stored sessions preserved (no accidental wipes). Sessions saved before this build are unrecoverable — they never made it past React state.

Notes:
- New **Messages** mailbox icon sits next to the notification bell in the header. Admin → user messages (corrective actions, critical follow-ups) land here, not in the bell. Always rendered as **SCSalvager Admin**; dismissed state persists across devices. The mailbox auto-refreshes every 60 seconds and on open — no page reload needed to see new messages.

UPDATE 5/5/2026 v2.7.2

Added:
- Crew Salvage Refinery + Sales Calculator now ships with two **sell-location dropdowns**: **CMAT Sell Location** and **RMC Sell Location**. Pick a specific sell point per material to pin the calculator to that point's per-SCU price; leave blank to fall through to the highest-priced location across the catalog (the previous default).

Changes:
- Crew Salvage table cleanup: dropped the **Sells As** and **Best aUEC/SCU** columns. The remaining columns (Salvaged / Input SCU / Refined SCU / Sale aUEC) are tighter and easier to scan.
- Crew Salvage **Construction Salvage** row now follows the **CMAT Sell Location** dropdown (was implicitly priced as RMC). **Recycled Material Composite** row continues to follow the RMC Sell Location dropdown.
- Crew Salvage **Recycled Material Composite** row blanks the Refined SCU column (RMC sells 1:1 with no refinery step, so the cell was tautologically Input SCU; em-dash makes the no-refinery story obvious).
- Crew Salvage labels turned **yellow** for visual hierarchy: Refinery Location / Refinery Method / CMAT Sell Location / RMC Sell Location, the three SCU input labels (Construction Salvage / Construction Pieces / Recycled Material Composite), Total aUEC + Crew Count in the Split Calculator, and every role label (Pilot / Claw Operator / Salvage Operator 1-3 / Cargo Operator).
- All **numerical text-entry fields** site-wide now display **thousands-separator commas** as you type (e.g. `1,000,000` instead of `1000000`). State stores the raw digits so downstream math keeps working; only the rendered value flows through the formatter. Refinery Time HMS inputs are intentionally excluded.
- Ledger **Refinery Job Orders** + **Edit Job** preview now surface the **Levski refinery bonus** as a small `incl. +X.X SCU · Levski +Y%` sub-line under Expected Yield whenever the selected location has a non-zero bonus (Levski only as of 4.7.2). Makes it visually obvious the bonus is being applied.

Fixes:
- **Refinery yield math:** the **Levski location bonus** (Construction Salvage 9%, Construction Rubble 8%) is now applied **multiplicatively** to the base yield instead of being added to the yield rate. Empirical fit against an in-game sample (1,024 SCU Construction Salvage / Pyrometric Chromalysis / Levski → game-observed **165 SCU**): the old additive math predicted **245.76 SCU** (49% high); the new multiplicative math predicts **167.42 SCU** (≈1.5% variance, matches in-game rounding). Affects the **Refinery Bonus Yield Calculator** (Home), **Refinery Job Orders + Edit Job** preview (Ledger), and **Crew Salvage** projections — all share the same `computeRefineryJob` engine.

UPDATE 5/2/2026 v2.7.1

Added:
- Ship Details right-rail spec block now lists each platform's **Insurance Claim / Expedite times** (white › amber arrow) and **Expedite Cost** (emerald aUEC pill) for all 5 supported salvage / mining ships. Sourced from spviewer.eu.
- Mission detail popup gains a **Ships to salvage** chip section sourced from scmdb.net's mission-detail Combat tab. Each contract lists the ship pool that can spawn as the salvage target plus the per-encounter ship-count range (e.g. "1 per encounter").
- Mission detail popup: **[LOCATIONS]** button replaces the always-visible Pickup + Destinations chip stacks. Hover or focus the button to expand a popover with the full chip list — keeps the modal compact while still surfacing every resolved system / planet / moon.

Changes:
- Salvage Missions table: **Reward column sort** now ranks by net (reward − buy-in) instead of gross reward, matching the column's two-line display. "Lowest reward" now correctly surfaces the worst-net contracts (high buy-in, no reward, etc.) first.
- **Report Price** (Home page Sell Estimate + Ledger sell-order form) now uses a **latest-wins** model: every submission overwrites the stored price for that (material, location) pair. The displayed value site-wide is the most recent report — no community median, no rolling window, no anti-spike dilution. Privacy Policy + Terms of Service refreshed to reflect the new storage model.
- **Page reloads restore your last-viewed tab.** Top-level tab + Ledger sub-tab + Missions sub-tab are now persisted to localStorage on every change, so refreshing the page lands you exactly where you left off instead of bouncing back to Home.

Fixes:
- Mission detail popup: **Prerequisite location chips removed**. scmdb's `prerequisites.location[]` array is a contract-availability scope, not a true prerequisite — surfacing it under "Prerequisite" was misleading. Real prereqs (chainStartsWith / requires / unlocks) still render in the Chain section.
- Mission detail popup: scmdb's untransformed `@generic_locations_blank` placeholder no longer surfaces as a phantom location chip when a contract has no real entry.

UPDATE 4/29/2026 v2.7.0

Added:
- **Accept Offer** button at the top-left of every mission detail popup. Logged-in users can take a contract on directly from the Missions tab. Multiple contracts can be active at once — no single-slot lock.
- New **Active Contracts** panel above the Salvage Missions table. Lists every accepted contract with its reward, buy-in, and accepted-time, plus per-row **Complete Contract** and **Abandon Offer** buttons. Anonymous viewers see a "Log in to accept contract" CTA instead of the Accept button.
- **Complete Contract** applies both the positive reward AND the negative buy-in (if any) to your ledger as synthetic sell-order entries — they flow through Statistics, the Lifetime aUEC pill, and Patch History automatically.
- **Abandon Offer** forfeits the positive reward but still settles any negative buy-in. Use it when you've already paid into a mission you no longer want to chase.
- Mission completions and abandonments appear in **Ledger → Patch History** with a dedicated row treatment: cyan `Mission · Reward`, rose `Mission · Buy-In`, and rose `Mission · Abandoned` pills. Primary cell shows the mission name + signed aUEC delta; secondary explains whether the reward was forfeited.
- Header now shows your **Lifetime aUEC** as an emerald pill, immediately left of the notification bell. Sums every visible sell-order entry (real sales + mission settlements). Hidden on mobile to keep the header compact.
- Settings → **Avatar**: upload your own avatar to use site-wide instead of your Discord avatar. We resize and center-crop to a 312×312 circle automatically. Leave blank to revert to your Discord avatar.
- Statistics leaderboard now shows each top salvager's avatar to the left of their name (custom upload or letter-fallback initial), and the verified-RSI checkmark stays inline with the name.
- Verified RSI handles now display **site-wide**, not just on the Statistics leaderboard. Header user menu, Settings "Signed in as" line, and avatar fallback all read your verified Star Citizen identity, with the Discord username surfacing as parenthetical context where it adds value.
- **Multi-sort** on the Salvage Missions table: shift / ctrl / cmd-click any column header to chain it as a secondary sort key. Active columns show their priority (e.g. `▲ 1`, `▼ 2`). Right-click an active header to drop it from the chain.
- **Wrecked Ships for Sale** missions now print the destination station in parentheses after the title, e.g. `Wrecked Ships for Sale (Checkmate)` — sourced from the contract's `locations` field.
- Header banner trimmed to ~75% height (320px) with a radial **dissolve mask** at the edges, so the banner blends into the page instead of cutting off square.
- Mission table system pill no longer falls back to "Unknown". Resolution chain: explicit systems → location-resolved system → debugName scan → "Unknown".
- New **Rough & Ready** faction option in the Missions filter dropdown — covers the `RR_ Wrecked Ships for Sale` family that scmdb.net ships with `factionGuid: null`.
- Mission table per-row description line removed for compactness — full briefing still in the popup.
- Ledger restructured into three sub-tabs: **Refinery & Sell Orders** (existing forms + Recent Sales), **Patch History** (per-patch entries + clear scopes + dropdown), and a brand-new **Crew Salvage** page.
- **Crew Salvage**: build multi-pilot salvage runs from the Ledger tab. Pick the ship (Reclaimer or Moth) and assign each station to a crew member (Pilot, Claw Operator on Reclaimer only, Salvage Operators 1–2 on Reclaimer / 1–3 on Moth, Cargo Operator). Multi-select Ships Salvaged with per-ship quantity steppers, manufacturer dropdown + name search + Clear Search Filters / Clear ships buttons. Total Salvage SCU running total at the top.
- Crew Salvage three SCU buckets — **Construction Salvage** (Reclaimer-only), **Construction Pieces** (Moth-only), **Recycled Material Composite** (always shown, 1:1 sale ratio, no refinery). Refinery + Sales Calculator computes per-material refined SCU, best aUEC/SCU from the site's known sell points, total refinery cost, and net projected sale. Split Calculator divides total aUEC by crew count for per-share take.
- Crew Salvage sessions: Save Session → in-flight session card in the left sidebar (grouped by day, newest first); click to expand for full detail. Edit pops back into the draft form; **Mark Complete** locks edits and logs a synthetic *Crew Salvage* row to your Patch History (cyan pill, mission name + total SCU + total aUEC). Recent Sales feed excludes those entries.
- **Ships Salvaged** picker now sources exclusively from the [SPViewer.eu](https://www.spviewer.eu) vehicle dataset (upstream: `api.uexcorp.uk/2.0/vehicles`) — 217 player-pilotable ships across 18 manufacturers. Concept ships, NPC-only hulls (Vanduul Clans), Retaliator Cargo/Torpedo modules, and the Retaliator Bomber loadout variant are filtered at build time so the picker only lists whole ships you'd actually salvage. Manufacturer dropdown drives off the same dataset — no more "Other" bucket.
- Six **patch 4.8** ships pre-staged in the picker, gated on the live patch version: Drake Ironclad, Drake Ironclad Assault, Drake Pitbull, MISC Starlite, Aegis Tiburon, Kruger Intergalactic Stingray. Auto-appear once 4.8 goes live; no separate code push needed.
- Home → Scraper Module Performance: each module's detail card now ships with a **Quality Level** slider (500 → 1000) that lights up on the patch 4.8 drop. Slider is 33% width with a paired numeric input you can type into directly, and the comparison table's Speed / Radius / Efficiency columns update live as you scrub (linear 0–20% boost). Gated on the live patch version — invisible until 4.8 hits production.
- Missions tab now ships with **sub-tabs**: Salvage Missions (live 4.7.2 catalog, 59 entries) and **Refueling Missions** (12 United Wayfarers Club contracts pulled from the scmdb.net 4.8 PTU dump). Both share the same filter row, table, and detail popup; sub-tab swap flips the source array and the faction option list. Refueling sub-tab is gated on the live patch — hidden on 4.7.2, auto-appears once 4.8 goes live.
- New **United Wayfarers Club** faction option in the Missions filter dropdown — appears only on the Refueling sub-tab.
- Header **Patch Verified** pill and footer "Data verified for patch …" string now drive off the live patch status, so they auto-flip 4.7.2 → 4.8 the moment the server-side patch advance lands. No separate redeploy needed.

Changes:
- Top Salvagers leaderboard now ranks strictly by **Total SCU Refined**. Profit-only activity (e.g. mission settlements without any refinery work) no longer qualifies a user for the top 5.
- Patch History panel description updated to "Mission history, collected refinery jobs, and sell orders…" so the new contract entries are surfaced front-and-center.
- Recent Sales feed excludes mission contract settlements — those are tracked on the Active Contracts panel pre-settlement and in Patch History after, so they don't clutter the sales feed.
- "Site update available" surfaces as a centered modal instead of the page-top amber banner. Update now reloads with the cache busted; Later (or clicking the backdrop) dismisses for the session — the notification bell still carries the entry until you actually reload.

Fixes:
- Home → Scraper Module Performance comparison table values corrected. Speed × and Radius were swapped (e.g. Abrade was rendered as 3.5× / 0.90 m when the source spec is 0.15× / 3.5). Efficiency now reads as the 0–1 multiplier (Abrade 0.90, Trawler 0.60, Cinch 1.00) instead of the 340 figure that was shipping. Power column dropped; new **Mass** + **K μSCU** columns added so the table matches the in-game CStone Universal Item Finder spec sheet column-for-column.

UPDATE 4/28/2026 v2.6.1

Added:
- Missions tab → mission detail popup → new **Turn in** section: every Adagio Holdings salvage contract now lists exactly what to deliver at the destination. Bulk material rows show SCU bounds (e.g. RMC 15 SCU, Construction Materials 41 SCU). Component-tier rows show the exact unit count needed (e.g. ×2 Cooler, Industrial Grade S2; ×8 Ship Weapon S3 or S4). Sourced from scmdb.net's haulingOrders catalog.
- Component turn-in rows are clickable: expanding one shows the list of ships that come with that exact component class + size by default, sourced from the public [Star Citizen ship-components Google Sheet](https://docs.google.com/spreadsheets/d/1fFTnvQc8_i9lur4PB3txqipK1ljRkOgw6kTEimx3xdg). Ships whose copy of the component is marked "Not accessible" in the sheet render as greyed/strike-through chips with a hover tooltip — the part exists on the ship but can't be salvaged off it.
- Ship Salvage Head turn-ins list all 5 site-supported salvage platforms (Aegis Reclaimer / Argo Moth / Drake Vulture / MISC Fortune / RSI Salvation). Ship Mining Laser turn-ins list the MISC Prospector / ARGO Mole / Drake Golem.
- Mission briefings now substitute the in-game `[LOCATION]` and `[DESTINATION]` placeholders with the resolved location names, rendered as inline cyan chips. Multi-leg missions emit one chip per entry, comma-separated. Matches scmdb.net so the briefing reads like a real contract instead of a templated one.
- Daily 6am scheduled diff against the public ship-components Google Sheet — surfaces any ship/component additions, removals, modifications, and accessibility flips so the operator can keep the site's default-component data fresh.

Fixes:
- Salvage Missions table rows shortened: the truncated first-sentence briefing line under each mission title was removed to keep rows compact. Full briefing copy still lives in the mission detail popup (click any row to see it).

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
