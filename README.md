# Order Desk — Ritual Matcha Co.

Internal dashboard for the sales lead (Joey): paste a Viber order message →
get a parsed order, a Shopify **draft**, and a ready-to-send reply; verify the
BPI payment; keep one clean record of everything.

> **The one rule:** the dashboard only **drafts** orders and **matches**
> payments. Joey confirms **every** draft and **every** payment. Nothing is
> automatic end-to-end. There is no Viber bot.

## Pages

| Route | What it does |
|---|---|
| `/paste` | Cafe dropdown (searches cafe AND contact names) + message box → **Send to queue**. **Chat-to-profile**: the add-cafe modal parses a pasted customer message (template or free-form) into name/phone/cafe/address, creates the Shopify profile with the address, and moves any order lines into the message box. Shows the selected cafe's real Shopify order history ("Use as new order" fills the box) and supports **⌘/Ctrl+Enter** to send. |
| `/queue` | Messages being parsed, grouped by cafe, "Processing…" status, searchable. Auto-moves to Processed. |
| `/processed` | Split screen, searchable, **↑/↓** to move between orders. Left: orders (Table/Kanban toggle, persisted), line items, **draft options** (apply the cafe's eligible Shopify discounts, manual discount / one-click **sample credit**, **VAT 12% tickbox**, **delivery method + optional fee**, free samples — defaults from the Shopify profile, all overridable), live-updating reply + Shopify-calculated total breakdown, a **preview modal** before **Confirm · create draft**. Right: payment verification — multi-file proof upload with gallery/lightbox, BPI email match, **Confirm payment · mark paid**. |
| `/history` | Every paid order, read from the **Order History** sheet tab. Add/edit a free-text note per order; **View invoice** opens a printable receipt. |
| `/invoice/:orderId` | Printable receipt for one paid order (print → Save as PDF; no PDF library — just the browser's own print dialog). |
| `/analytics` | Always-on dashboard: total revenue, paid order count, average order value, top cafes, best-selling variants, and a 30-day revenue chart — all derived from Order History. |
| `/reports` | Full sales report over **all Shopify orders** (not just app-processed): date range + wholesale/retail segment + cafe filter, headline stats with previous-period deltas (revenue, orders, AOV, kg sold, active cafes, samples, discounts), revenue-over-time chart, top products/cafes bars, product & cafe breakdowns, new-cafes list, delivery split, order table — printable to PDF (charts are pure SVG/divs, no chart library). |

## Modes — live vs mock

Every integration checks its own env var; missing var = mock. Mix freely.

| Layer | Env switch | Without it (default) |
|---|---|---|
| Shopify | `SHOPIFY_STORE` + (`SHOPIFY_CLIENT_ID`+`SHOPIFY_CLIENT_SECRET`, or `SHOPIFY_ADMIN_TOKEN`) | Real **snapshot** of the ritualmatcha.ph catalog + 143 wholesale cafes (2026-07-02); draft orders are mocked |
| Google Sheets | `APPS_SCRIPT_URL` + `APPS_SCRIPT_SECRET` + `SHEET_ID` | In-memory mirror |
| Claude parsing | `ANTHROPIC_API_KEY` *(later phase)* | Keyword/regex fallback parser |
| BPI matching | Same `APPS_SCRIPT_URL`/`APPS_SCRIPT_SECRET` *(reads a shared "BPI Transactions" sheet — a separate Apps Script project, `scripts/apps-script/BpiMatching.gs`, logs it from Gmail on a timer)* | Simulated log (a matching transaction "arrives" ~8s after a draft is created) |
| Database | `SUPABASE_URL` + `SUPABASE_SECRET_KEY` *(tables via [scripts/db/schema.sql](scripts/db/schema.sql))* | In-memory (resets on restart) |
| Auth | `DASHBOARD_PASSWORD` (+ `AUTH_SECRET`) | Auth disabled (local dev only) |

See [.env.example](.env.example) for the full list, or [SETUP.md](SETUP.md)
for the full step-by-step to go live against the real Shopify store, the
real Google Sheet, and hosting on Vercel.

## Test mode

A global switch in the nav (**Test mode ON/off**) — flip it on and every
order created from then on gets a `TEST` badge everywhere it appears, and:
- **Skips the real Shopify draft + mark-paid calls** (still reads real
  catalog prices and the real cafe list, so it prices realistically).
- **Never writes to the Google Sheet.**
- **Never searches the real BPI mailbox** — always matches the simulated
  inbox, so a test order can't coincidentally match someone's real transfer.

It's a shared, database-backed switch (`app_settings` table) — everyone
using the dashboard sees the same state, and a bright banner shows on every
page while it's on so it's hard to forget. Turning it OFF is instant;
turning it ON asks for confirmation first, since any real order pasted
while it's on would also be faked.

## Domain rules (enforced in `lib/`)

- 1 pouch = 200g · 1 case = 2kg = 10 pouches · 1 kg = 5 pouches.
- **MOQ = 2kg (1 case)** — below-MOQ orders are flagged *Needs review*, never blocked. Samples (20g) don't count toward MOQ.
- Prices **always** come from Shopify variant prices. Full cases are billed at
  the Case variant price, the remainder at the 200g pouch price — and the
  draft order line items map to those same variants.
- All incoming messages are treated as orders.
- Reply templates live in [lib/templates.ts](lib/templates.ts) — the Total
  Order message is verbatim per the team's saved reply; the fulfilment
  templates (Pickup / Metro Manila Delivery / Nationwide / Rush) are the
  team's actual saved Viber replies, pulled from the "RMC Message Templates"
  doc in Drive (updated 2026-06-25). Blanks (order #, tracking, shipping fee)
  are left for Joey to fill in by hand, same as the source doc.

## The Google Sheet

One spreadsheet, two tabs — **Customers** (synced one-way from Shopify; feeds
the dropdown) and **Order History** (a row per paid order; History reads it):

- **RMC Order Desk - Customers and Order History**
  `SHEET_ID = 1-51E1TzDLNQzjnpPxqE6BmJ5Pj6cALFcNg5-bguF45E` (owned by
  `arianne.co@ritualmatcha.ph`).
- Seeded with all 143 wholesale cafes from Shopify (2026-07-02).
- On the first live call the deployed Apps Script auto-creates both
  `Customers` and `Order History` tabs with headers if they don't already
  exist (`scripts/apps-script/Code.gs`). Sync is one-way (Shopify → Sheet);
  editing the sheet does not push back to Shopify.
- Two malformed duplicate copies (`&amp;` literally in the title, an
  escaping bug while I was uploading) are sitting in the same Drive folder —
  safe to delete, see [SETUP.md](SETUP.md) for their file IDs.
- To go live: see [SETUP.md](SETUP.md) step 2 — deploy
  [`scripts/apps-script/Code.gs`](scripts/apps-script/Code.gs) as a Google
  Apps Script Web App under your own Google account (no Cloud service
  account or Workspace admin approval needed), then set `APPS_SCRIPT_URL` +
  `APPS_SCRIPT_SECRET` + `SHEET_ID`.

## ⚠️ Shopify: this points at the production store

`SHOPIFY_STORE` points at **ritualmatcha.ph** (`f8bf85-2.myshopify.com`) —
there is no separate dev store in this setup. Once live auth is set, every
"Confirm · create draft" and "Confirm payment" click acts on the real store.

Live auth has two supported paths (`lib/shopify.ts` checks for either):
`SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET` (current Shopify flow — apps
created in the **Dev Dashboard** don't expose a static token in the UI at
all; the app exchanges these for a short-lived token itself and refreshes it
automatically, roughly every 24h), or a static `SHOPIFY_ADMIN_TOKEN` (older
admin-created custom apps, Settings → Apps → Develop apps, which do show a
one-time-reveal token). See [SETUP.md](SETUP.md) step 1 for either
walkthrough, and step 6 for a safe first test.

The catalog snapshot and customer list baked into this repo (`lib/*-snapshot.ts`)
were read from that same production store via the Claude connector —
**reads only**; no drafts, customers, or writes were made while building.

## Known store data issue

**Yasumi — Case (10 x 200g) is priced ₱1,250 in Shopify, which is *less* than
one 200g pouch (₱1,300).** Almost certainly a typo for ~₱12,500. The app
flags any order containing it ("Needs review" + warning) but uses Shopify
prices as-is. Fix the variant price in Shopify admin.

## Develop

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm run build
```

Deploy: see [SETUP.md](SETUP.md) step 8 for hosting on Vercel. Orders
persist in Supabase when `SUPABASE_URL` + `SUPABASE_SECRET_KEY` are set
(tables: [scripts/db/schema.sql](scripts/db/schema.sql)); without them the
store is in-memory and resets per serverless instance — fine for local
demos, not for production.
