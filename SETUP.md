# Order Desk — Going Live Setup Guide

This is the step-by-step to take the Order Desk from demo mode to running
against **Ritual Matcha Co.'s real Shopify store and real Google account**,
then hosting it so Joey can use it from anywhere.

Read the whole thing once before touching anything — steps 1 and 2 talk to
your live store and your live spreadsheet.

---

## 0. What you're connecting

| Layer | Real target |
|---|---|
| Shopify | **ritualmatcha.ph** — myshopify handle `f8bf85-2.myshopify.com`. This is your **production store** — the one customers actually order from. |
| Google Sheet | "RMC Order Desk - Customers and Order History" — `1-51E1TzDLNQzjnpPxqE6BmJ5Pj6cALFcNg5-bguF45E`, owned by `arianne.co@ritualmatcha.ph`. |
| Hosting | Vercel (recommended — the app is a standard Next.js project). |

> ⚠️ **Production store.** Once Shopify live mode is on (step 1), every
> "Confirm · create draft" click creates a **real draft order** in
> ritualmatcha.ph, and every "Confirm payment" click **marks a real order
> paid**. There is no separate test store in this setup — that's what you
> asked for ("run it through the actual company's Shopify"). The safety net
> is the app's golden rule: nothing happens without Joey's click. Do one
> small, real test order end-to-end (step 7) before handing it to Joey for
> daily use.

### Housekeeping first
Two malformed duplicate copies were created while I was troubleshooting the
Sheets upload (title `RMC Order Desk — Customers &amp; Order History`,
literal `&amp;` in the name — a bug in how I escaped an ampersand, not
something in your account). Delete these two from Drive; keep only
`1-51E1TzDLNQzjnpPxqE6BmJ5Pj6cALFcNg5-bguF45E`:
- `1MT3-vL40OppCyKNfRaJx_q4h00p1ZYXcNPHgcnK1F_0`
- `1tt2cgh3dNXPME3arF5Mi7UM-coco5sOExPXjHxF6SZY`

I don't have delete access from here (by design), so this needs your click.

---

## 1. Shopify — Dev Dashboard app + client credentials

Shopify moved custom-app creation to the **Dev Dashboard**
(dev.shopify.com), a separate site from the regular store admin. Apps
created there — like the "Order Desk" app already set up — **don't have a
static token to copy from a UI screen at all.** Instead, the app fetches a
short-lived token itself using a client ID + secret. This is already wired
up in the code (`lib/shopify.ts`), so setup is just credentials, no code
changes needed.

1. Go to **dev.shopify.com** → your **Order Desk** app.
2. **Configuration** (or **Access**, depending on the current UI) → confirm
   these Admin API scopes are enabled: `read_products`, `read_customers`,
   `write_customers`, `write_draft_orders`, `write_orders` → **Release** a
   new version if you change anything.
3. **Apps → Order Desk → Installs** → **Install app** → select
   **ritualmatcha.ph** → confirm. (Skip if already installed.)
4. **Settings** tab → copy the **Client ID** and **Client secret** (the
   secret starts with `shpss_`).
5. In the project's `.env.local` (create it by copying `.env.example`):
   ```
   SHOPIFY_STORE=f8bf85-2
   SHOPIFY_CLIENT_ID=your-client-id
   SHOPIFY_CLIENT_SECRET=shpss_your-client-secret
   ```
   (`SHOPIFY_STORE` is just the subdomain — no `.myshopify.com`. Leave
   `SHOPIFY_ADMIN_TOKEN` blank — it's a separate, older auth path, see below.)

The app exchanges these for a real access token (`shpat_...`) on demand and
caches it for ~24h, refreshing automatically before it expires — you never
touch the token itself. **Verified working 2026-07-06** against this exact
store: token exchange succeeded, and a live GraphQL call confirmed
`read_products` and `read_customers` both actually work (Shopify's token
response only listed `write_customers`, not `read_customers`, but the write
scope covers the read in practice — confirmed by testing, not assumed).

> **If you have an *older* admin-created custom app instead** (Settings →
> Apps → Develop apps, inside the regular store admin — not Dev Dashboard):
> those still show a static **Admin API access token** you reveal once and
> copy. If that's what you have, set `SHOPIFY_ADMIN_TOKEN=shpat_...` instead
> of the client ID/secret pair — the app checks for either one.

**What this unlocks:** live variant prices, live wholesale customer list
(paginated — all 300+, not just the first 100), real draft order creation,
and real "mark paid."

---

## 2. Google Sheets + BPI — deploy the Apps Script bridge

A Cloud service account was the original plan here, but if your Workspace
admin blocks **domain-wide delegation** (ours did), that path is a dead
end — there's no way around it as a non-admin. Instead, the app talks to a
**Google Apps Script Web App** that you deploy under your own regular
Google account. Apps Script runs with *your* normal permissions, so it can
read/write the spreadsheet with zero admin approval.

This deployment covers Sheets sync, invoice generation, and reading the
shared BPI Transactions log (step 5) — it does **not** need Gmail access
itself; that lives in a completely separate Apps Script project (see step 5).

1. Go to **script.google.com** → **New project**.
2. Delete the placeholder `Code.gs` content, and paste in the full contents
   of this repo's [`scripts/apps-script/Code.gs`](scripts/apps-script/Code.gs).
3. At the top of the pasted script, fill in the two constants:
   ```js
   const SHEET_ID = '1-51E1TzDLNQzjnpPxqE6BmJ5Pj6cALFcNg5-bguF45E';
   const SECRET_KEY = 'paste-a-long-random-string-here';
   ```
   Generate `SECRET_KEY` with `openssl rand -hex 24` — it's a shared
   password between the app and the script (Apps Script Web Apps have no
   built-in auth of their own).
4. **Deploy → New deployment** → gear icon → type **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Deploy → it'll ask you to authorize access to Sheets under your own
     account → allow it (this is you granting the script access to your
     own data, not a third party).
   - Copy the **Web app URL** (ends in `/exec`).
5. In `.env.local`:
   ```
   SHEET_ID=1-51E1TzDLNQzjnpPxqE6BmJ5Pj6cALFcNg5-bguF45E
   APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
   APPS_SCRIPT_SECRET=the-same-secret-you-put-in-SECRET_KEY
   ```

**Whenever you edit `Code.gs`** (e.g. adding a new action), you need to
publish a **new version**: **Deploy → Manage deployments** →
edit (pencil icon) → **Version: New version** → Deploy. Saving alone does
not republish the live URL.

**What this unlocks:** the Paste page's cafe dropdown reads from the
`Customers` tab (synced one-way from Shopify), and every paid order appends
a row to `Order History`. The first live call auto-creates both tabs with
headers if they don't already exist — you don't need to set that up by hand.

---

## 3. Auth — protect the dashboard

Anyone with the URL and no password can currently use the app once it's
hosted publicly. Turn on auth:

```
DASHBOARD_PASSWORD=choose-a-real-password-here
AUTH_SECRET=<32+ random characters>
```

Generate `AUTH_SECRET` with: `openssl rand -base64 32`

Share `DASHBOARD_PASSWORD` with Joey (and anyone else on the team) directly
— it's one shared password, not per-person logins.

---

## 4. Optional — later phases (safe to skip for now)

These are already coded to fall back to mocks when unset — turn them on
whenever you're ready, independently of each other:

- **`ANTHROPIC_API_KEY`** — replaces the keyword/regex fallback parser with
  Claude for reading pasted messages. Get a key at console.anthropic.com.
- **BPI payment matching** — connects the real transaction log instead of
  the simulated one. Needs a separate Apps Script project deployed under
  whoever receives BPI transfer emails, plus this app's own bridge sharing
  the transaction sheet — see step 5 below.
- **Supabase** — DONE (2026-07-06). Orders, runtime customers, and the
  order-history mirror persist in Supabase whenever `SUPABASE_URL` +
  `SUPABASE_SECRET_KEY` are set (`lib/store.ts`). Tables were created from
  `scripts/db/schema.sql` with row-level security on (no policies — only
  the server's secret key can touch them). If you ever recreate the
  project, re-run that file in the Supabase SQL Editor.

---

## 5. BPI payment matching — via a shared transaction log, not live Gmail

**Rewritten 2026-07-29.** The original approach (this same Apps Script
project searching Gmail live on every check) had two real problems, found
by verifying against 7 actual BPI notification emails: `GmailApp.search`
returns *threads*, and BPI sends every notification with the same subject
and no threading headers, so Gmail collapsed the whole payment history
into one thread and the "recent only" filter did nothing; and the
sender-name field it matched on doesn't exist in real BPI emails at all —
neither format contains the payer's name, only a masked account number
(InstaPay) or nothing (PESONet/EDPO).

The current design is two separate pieces:

- **`scripts/apps-script/BpiMatching.gs`** — a completely separate Apps
  Script project, deployed under whoever's Google account actually
  receives BPI transfer emails (e.g. Marco). It has no web app deployment,
  no secret key, and Order Desk never calls it directly — it just runs a
  10-minute timer trigger that reads Gmail correctly (via the Gmail
  advanced service, message-level not thread-level) and logs new
  transactions into a shared "BPI Transactions" spreadsheet.
- **This script (`Code.gs`)** reads that shared spreadsheet
  (`BPI_TRANSACTIONS_SHEET_ID` near the top of the file — share the sheet
  with this account as Editor) via `listBpiTransactions` and
  `markBpiTransactionMatched`, which Order Desk's `lib/bpi.ts` calls
  through the same bridge as everything else. No separate URL/secret is
  needed on the Order Desk side for BPI at all.

To set up the Gmail-reading side, see the setup instructions at the top of
`scripts/apps-script/BpiMatching.gs` (needs the Gmail advanced service
enabled and the manifest in `BpiMatching.appsscript.json`) — whoever
deploys it just needs the shared sheet's ID, nothing from this app's own
`.env.local`.

Matching itself (`findMatch`/`otherCandidates` in `lib/bpi.ts`) is by
amount + (InstaPay only) the sending account's last 4 digits — never a
name. When there's no confident auto-match (a same-amount collision, or a
PESONet transfer that carries no secondary signal at all), the payment
pane shows a manual picker instead of blocking on it.

---

## 6. Run it locally first

```bash
cd order-desk
npm install
npm run dev
```

Open `http://localhost:3000` (or whatever port it prints), log in with
`DASHBOARD_PASSWORD`, and confirm the footer badge in the nav no longer says
"Demo data in use."

> **Persistence:** with the Supabase env vars set (step 4 — already done),
> orders survive restarts and redeploys, including across Vercel's
> serverless instances. If those vars are ever removed, the store silently
> falls back to in-memory (resets on restart) — fine for local demos only.
> The Google Sheet is your durable Order History either way.

---

## 7. Do one real, small acceptance test

Before Joey uses it for real:

1. Pick a real, low-value test order — ideally an actual pending order, or
   place one with a cafe you can immediately follow up with.
2. `/paste` → pick that cafe → paste the message → Send to queue.
3. `/queue` → watch it parse → `/processed` → check the line items and total
   look right, edit if needed (reply updates live).
4. Click **Confirm · create draft** → open the linked draft in Shopify admin
   → confirm the line items, customer, and currency (PHP) are correct.
5. Have the cafe actually pay (or simulate it if it's not a real order) →
   upload the proof → check the BPI match (real inbox once step 2/5's
   `APPS_SCRIPT_URL`/`APPS_SCRIPT_SECRET` are set; otherwise this will show
   "no match" since the simulated inbox only knows about mock drafts — use
   "I verified this transfer manually" to test the confirm-payment path).
6. Confirm payment → verify in Shopify that the order shows paid, and check
   the `Order History` tab in the Google Sheet for the new row.
7. Check `/history` shows it.

If all seven check out, you're live.

---

## 8. Hosting on Vercel

1. Push this repo to GitHub (private repo recommended — it will contain no
   secrets, but keep it private anyway).
2. Go to **vercel.com → Add New → Project** → import the repo.
3. Framework preset: Next.js (auto-detected).
4. **Environment Variables** → add every var from your `.env.local`
   (`SHOPIFY_STORE`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` (or
   `SHOPIFY_ADMIN_TOKEN` if you're on the older admin-created app path),
   `SHEET_ID`, `APPS_SCRIPT_URL`, `APPS_SCRIPT_SECRET`, `SUPABASE_URL`,
   `SUPABASE_SECRET_KEY`, `DASHBOARD_PASSWORD`, `AUTH_SECRET`, plus any of
   the optional ones from step 4 you've turned on). **Don't skip the
   Supabase pair** — without it every serverless instance gets its own
   throwaway in-memory store and orders vanish mid-flow.
5. Deploy. Vercel gives you a `*.vercel.app` URL immediately.
6. **Optional custom domain** (e.g. `orders.ritualmatcha.ph`): Vercel project
   → Settings → Domains → add the subdomain → add the CNAME record it shows
   you in whatever DNS provider manages `ritualmatcha.ph`.
7. Re-run the step 7 acceptance test against the hosted URL.

**Redeploys:** every push to the connected branch auto-redeploys. Env vars
persist across deploys (set once in the Vercel dashboard, not per-deploy).

---

## Known issue to fix in Shopify (not blocking)

**Yasumi's "Case (10 x 200g)" variant is priced ₱1,250 — less than a single
200g pouch (₱1,300).** Almost certainly a typo (likely meant ~₱12,500). The
app flags this on every Yasumi order ("Needs review") but still uses
whatever price is in Shopify. Fix it in Shopify admin → Products → Yasumi →
the Case variant, whenever convenient.

---

## Quick reference — full env var list

```
SHOPIFY_STORE=f8bf85-2
# Dev Dashboard app (current path):
SHOPIFY_CLIENT_ID=...
SHOPIFY_CLIENT_SECRET=shpss_...
# — or — admin-created custom app (older path), leave the two above blank:
SHOPIFY_ADMIN_TOKEN=shpat_...

SHEET_ID=1-51E1TzDLNQzjnpPxqE6BmJ5Pj6cALFcNg5-bguF45E
APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
APPS_SCRIPT_SECRET=...
DASHBOARD_PASSWORD=...
AUTH_SECRET=...
# persistent store (orders survive restarts — tables via scripts/db/schema.sql):
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
# optional, later:
ANTHROPIC_API_KEY=      # turns on Claude parsing + proof-screenshot reading
FOLLOW_UP_DAYS=         # follow-up queue window, default 3
```
