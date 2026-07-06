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
| `/paste` | Cafe dropdown (from the Customers sheet/Shopify) + message box → **Send to queue**. Can add a new cafe (creates it in Shopify). Shows the selected cafe's recent paid orders (with a "repeat order" hint) and supports **⌘/Ctrl+Enter** to send. |
| `/queue` | Messages being parsed, grouped by cafe, "Processing…" status, searchable. Auto-moves to Processed. |
| `/processed` | Split screen, searchable, **↑/↓** to move between orders. Left: orders (Table/Kanban toggle, persisted), line items, live-updating reply + total, a **preview modal** (exact Shopify variants + total) before **Confirm · create draft**. Right: payment verification for the selected order — multi-file proof upload with a thumbnail gallery/lightbox, BPI email match (or no-match error), **Confirm payment · mark paid**. |
| `/history` | Every paid order, read from the **Order History** sheet tab. Add/edit a free-text note per order; **View invoice** opens a printable receipt. |
| `/invoice/:orderId` | Printable receipt for one paid order (print → Save as PDF; no PDF library — just the browser's own print dialog). |
| `/analytics` | Always-on dashboard: total revenue, paid order count, average order value, top cafes, best-selling variants, and a 30-day revenue chart — all derived from Order History. |
| `/reports` | Pick a date range (+ optional cafe filter) → summary, order table, per-cafe breakdown, printable the same way as the invoice page. |

## Modes — live vs mock

Every integration checks its own env var; missing var = mock. Mix freely.

| Layer | Env switch | Without it (default) |
|---|---|---|
| Shopify | `SHOPIFY_STORE` + (`SHOPIFY_CLIENT_ID`+`SHOPIFY_CLIENT_SECRET`, or `SHOPIFY_ADMIN_TOKEN`) | Real **snapshot** of the ritualmatcha.ph catalog + 143 wholesale cafes (2026-07-02); draft orders are mocked |
| Google Sheets | `GOOGLE_SA_JSON` + `SHEET_ID` | In-memory mirror |
| Claude parsing | `ANTHROPIC_API_KEY` *(later phase)* | Keyword/regex fallback parser |
| BPI email | `BPI_GMAIL_USER` + a Google service account *(reuses `GOOGLE_SA_JSON`)* | Simulated inbox (a matching transfer "arrives" ~8s after a draft is created) |
| Database | `SUPABASE_*` *(credentials only — persistence code not built yet)* | In-memory (resets on restart) |
| Auth | `DASHBOARD_PASSWORD` (+ `AUTH_SECRET`) | Auth disabled (local dev only) |

See [.env.example](.env.example) for the full list, or [SETUP.md](SETUP.md)
for the full step-by-step to go live against the real Shopify store, the
real Google Sheet, and hosting on Vercel.

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
- On the first live run the app renames the imported tab to `Customers` and
  adds `Order History` automatically (`lib/sheets.ts → ensureTabs`). Sync is
  one-way (Shopify → Sheet); editing the sheet does not push back to Shopify.
- Two malformed duplicate copies (`&amp;` literally in the title, an
  escaping bug while I was uploading) are sitting in the same Drive folder —
  safe to delete, see [SETUP.md](SETUP.md) for their file IDs.
- To go live: see [SETUP.md](SETUP.md) step 2 (create a Google Cloud service
  account, share the spreadsheet with its email as **Editor**, set
  `GOOGLE_SA_JSON` + `SHEET_ID`).

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

Deploy: see [SETUP.md](SETUP.md) step 7 for hosting on Vercel. Note the
in-memory store resets per serverless instance — wire up Supabase (later
phase) before the team relies on it in production.
