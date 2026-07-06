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

## 2. Google Sheets — service account + sharing

The app talks to Sheets as a **service account**, not as your personal
Google login — this is the standard way to let a server-side app read/write
one specific spreadsheet without giving it your whole Drive.

1. Go to **console.cloud.google.com** → create a project (e.g. "RMC Order Desk") or reuse an existing one.
2. **APIs & Services → Library** → enable **Google Sheets API**.
3. **APIs & Services → Credentials → Create Credentials → Service Account**.
   - Name it `order-desk-sheets`.
   - No project roles needed (access is granted per-file via sharing, next step).
4. Open the new service account → **Keys → Add key → Create new key → JSON**. This downloads a `.json` file — treat it like a password.
5. Open that JSON file and copy the `client_email` value (looks like `order-desk-sheets@your-project.iam.gserviceaccount.com`).
6. Open the spreadsheet (`1-51E1TzDLNQzjnpPxqE6BmJ5Pj6cALFcNg5-bguF45E`) → **Share** → paste that service-account email → give it **Editor** → Send (uncheck "notify," it's not a real inbox).
7. In `.env.local`, set `SHEET_ID` and the **entire JSON file contents as one line**:
   ```
   SHEET_ID=1-51E1TzDLNQzjnpPxqE6BmJ5Pj6cALFcNg5-bguF45E
   GOOGLE_SA_JSON={"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n", ...}
   ```
   Easiest way to get it onto one line: `cat your-key-file.json | pbcopy` (Mac) then paste after `GOOGLE_SA_JSON=`.

**What this unlocks:** the Paste page's cafe dropdown reads from the
`Customers` tab (synced one-way from Shopify), and every paid order appends
a row to `Order History`. The first time the app talks to Sheets, it
automatically renames the current single tab to `Customers` and creates the
`Order History` tab — you don't need to do that by hand.

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
- **BPI email matching** — connects the real BPI notification mailbox
  instead of the simulated inbox. See step 5 below (its own step, since it
  needs a Google Workspace admin action, not just an env var).
- **Supabase** — replaces the in-memory store (which resets whenever the
  server restarts) with a real database. Credentials can be saved to
  `.env.local` ahead of time, but the actual persistence code
  (`lib/store.ts`) isn't built yet — that's a separate task. **Recommended
  before daily production use on Vercel** — see the note in step 5.

---

## 5. BPI email matching — Gmail via a service account

No IMAP, no mailbox password. A Google service account reads one mailbox
**read-only** via the Gmail API, using the same trust model as the Sheets
service account — just a different scope, plus "domain-wide delegation" so
it can impersonate a specific mailbox instead of only accessing files
explicitly shared with it.

1. Decide which mailbox actually receives BPI transfer notifications (e.g.
   `payments@ritualmatcha.ph`). This must be a mailbox in your Google
   Workspace domain — personal Gmail accounts can't be delegated this way.
2. You can reuse the **same service account** already created for Sheets
   (step 2) — no need for a second one, as long as your Workspace admin
   authorizes the extra scope in the next step.
3. As a **Google Workspace admin**, go to **admin.google.com → Security →
   API controls → Domain-wide Delegation → Add new**:
   - Client ID: the service account's numeric client ID (in the same JSON
     key file as `client_email`/`private_key` — look for the `client_id`
     field, or find it on the service account's page in Google Cloud
     Console).
   - OAuth scopes: `https://www.googleapis.com/auth/gmail.readonly`
   - Authorize.
4. In `.env.local`:
   ```
   BPI_GMAIL_USER=payments@ritualmatcha.ph
   ```
   (Leave `BPI_GMAIL_SA_JSON` blank to reuse `GOOGLE_SA_JSON` from step 2, or
   set it separately if you'd rather use a dedicated service account.)

**Heads up on parsing accuracy:** `lib/bpi.ts` searches the mailbox with a
broad, best-effort query and extracts amount/sender/reference with regexes
based on typical PH bank transfer wording — **not verified against an
actual BPI notification email**, since none was available while building
this. Once real emails start landing, forward one (or paste the text) so
the regexes in `lib/bpi.ts` (`extractAmount`, `extractSenderName`,
`extractReference`) can be tuned to BPI's exact format. Until then, expect
some real transfers to come back as "no match" even though the email
arrived — that's a parsing-accuracy gap, not a bug in the matching logic
itself (which is unchanged and already used by the simulated inbox).

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

> **Important gap in this phase:** the in-memory order store resets on every
> server restart/redeploy. That's fine for local testing, but on Vercel each
> serverless function invocation can even get a fresh instance — meaning
> orders could disappear mid-flow in production. **Set up Supabase before
> relying on this daily** (see step 4 — credentials may already be saved,
> but the persistence code itself still needs to be built), or accept that
> it's a "test it live, but don't trust it as your only record yet" phase.
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
   upload the proof → check the BPI match (real inbox once step 5's BPI env
   vars are set; otherwise this will show "no match" since the simulated
   inbox only knows about mock drafts — use "I verified this transfer
   manually" to test the confirm-payment path).
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
   `SHEET_ID`, `GOOGLE_SA_JSON`, `DASHBOARD_PASSWORD`, `AUTH_SECRET`, plus
   any of the optional ones from step 4 you've turned on). Paste
   `GOOGLE_SA_JSON` as the single-line JSON string, same as locally.
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
GOOGLE_SA_JSON={"type":"service_account", ...}
DASHBOARD_PASSWORD=...
AUTH_SECRET=...
# optional, later:
ANTHROPIC_API_KEY=
BPI_GMAIL_SA_JSON=
BPI_GMAIL_USER=
BPI_EMAIL_QUERY=
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
SUPABASE_JWKS_URL=
```
