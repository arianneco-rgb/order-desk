# Fixing Order Desk bugs — Joey's guide

You describe the problem to Claude, Claude writes the fix, you check it on a
test link, then Arianne approves it. You never touch the live site directly
and you can't break it by accident.

**You do NOT need:** Arianne's Vercel account, her Google account, or the
Apps Script editor. The BPI payment-matching script is Marco's and is a
separate system — leave it alone.

---

## Part 1 — One-time setup (about 30 minutes, once)

### Step 1. Get a GitHub account

Sign up at [github.com](https://github.com) if you don't have one. Send
Arianne your username.

**Arianne does:** repo → Settings → Collaborators → Add people → your
username → role **Write**. Accept the emailed invite.

> Write access lets you push branches and open pull requests. It does *not*
> let you merge to `main` on your own once Step 6 is done — that stays with
> Arianne.

### Step 2. Install the tools

On your Mac, open **Terminal** (Cmd+Space, type "Terminal"):

```bash
xcode-select --install
```

Then install Node.js — download the **LTS** version from
[nodejs.org](https://nodejs.org) and run the installer.

Check both worked:

```bash
git --version && node --version
```

Two version numbers = good.

### Step 3. Install Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

### Step 4. Download the code

```bash
cd ~/Documents
git clone https://github.com/arianneco-rgb/order-desk.git
cd order-desk
npm install
```

### Step 5. Get the secrets file

The app needs passwords and API keys that are deliberately **not** in
GitHub. Ask Arianne for `.env.local` and put it in the `order-desk` folder.

**Never** email it, paste it into chat, or commit it. Arianne should send it
via a password manager or hand it over on a USB stick.

Check it's in the right place — this must print a list of names:

```bash
cd ~/Documents/order-desk && grep -o '^[A-Z_]*' .env.local
```

### Step 6. Ask Arianne to turn on the safety rails

Send her this section. It's what makes it safe for you to work
independently:

- **GitHub → Settings → Branches → Add branch ruleset** for `main`:
  tick **Require a pull request before merging**. Now nothing reaches the
  live site without her approving it.
- **Vercel → Project → Settings → Git → Connect** the
  `arianneco-rgb/order-desk` repo. This does two things: every pull request
  automatically gets its own **test link** for you to check, and merging a
  PR deploys to the live site by itself.

> Until Vercel is connected to Git, the live site is only updated by Arianne
> running `vercel --prod` on her own laptop, and you won't get test links.
> This step is what removes her from the loop.

---

## Part 2 — Fixing a bug (every time)

### 1. Get the latest code

```bash
cd ~/Documents/order-desk && git checkout main && git pull
```

### 2. Start a branch for your fix

Name it after the problem:

```bash
git checkout -b fix-invoice-date
```

### 3. Start Claude

```bash
claude
```

### 4. Describe the problem

Be specific — what you did, what happened, what you expected. Include the
exact error text if there is one.

> On the Processed page, when I tick "Charge VAT (12%)" for Loop Cafe the
> total doesn't change. It stays ₱22,000. It should go up to ₱24,640.

Good bug reports include:
- **Which page** (Paste / Queue / Processed / History / Analytics / Reports)
- **Which cafe or order number** (e.g. `#D3717`)
- **What you clicked**
- **What happened vs. what should have happened**
- The **exact error message**, copied as text

Then ask Claude to fix it. It will change the files and explain what it did.

### 5. Test it on your own machine

```bash
npm run dev
```

Open http://localhost:3000 and check the thing you reported is actually
fixed. Press `Ctrl+C` in Terminal to stop.

**Before doing anything else, turn on Test mode** (the switch in the top
nav). Test-mode orders never touch the real Shopify store and never write to
the Google Sheet. Anything you try while testing should be done with it on.

### 6. Check you didn't break anything else

```bash
npm run typecheck && npm run build
```

Both must finish with no red errors. If they don't, paste the error into
Claude and ask it to fix that too. **Do not continue past this step with a
failing build.**

### 7. Send it for approval

```bash
git add -A
git commit -m "Fix VAT tickbox not updating the total"
git push -u origin fix-invoice-date
```

The terminal prints a link — open it and click **Create pull request**.
Write a couple of sentences on what was broken and what you changed.

### 8. Check the test link

Within a minute or two, a **Vercel** comment appears on your pull request
with a preview link. That's your fix running on a real server, with real
data, but **not** the live site. Click it and confirm the bug is gone.

If it isn't, keep working on the same branch — just repeat steps 4–7. The
pull request and its test link update automatically.

### 9. Tell Arianne

She reviews and clicks **Merge**. That's what puts it live. Done.

---

## Things to be careful about

**Test mode is your friend.** The nav has a global **Test mode** switch.
With it on, orders are faked end-to-end: no Shopify draft is created, no
customer is charged, nothing is written to the Google Sheet. Use it for
anything you're unsure about. Turn it **off** when you're finished so real
orders work normally.

**This points at the real Shopify store.** There is no practice store.
Outside test mode, "Confirm · create draft" and "Confirm payment · mark
paid" act on real ritualmatcha.ph orders.

**Never commit `.env.local`.** It's already blocked by `.gitignore` — just
don't force it.

**Don't touch these unless Arianne asks:**
- `scripts/apps-script/BpiMatching.gs` — Marco's Gmail script, separate system
- `scripts/apps-script/Code.gs` — changing it needs a manual redeploy in
  Google Apps Script, which only Arianne can do

If Claude proposes changing either, stop and check with her first.

---

## When something's broken and you don't know why

**Open [the Connection check page](https://order-desk-rmc.vercel.app/health)
first.** It tests the link between Order Desk and the Google Sheet and tells
you in plain English what's wrong and how to fix it. Most "the site is
broken" reports are this.

| What you see | What it means | What to do |
|---|---|---|
| "Apps Script bridge is working" | The Sheet connection is fine | The bug is in the app — report it to Claude as normal |
| Some probe calls failed | Google is being flaky | Normal, the app retries. Only a worry if most of them fail |
| "deployment no longer exists" / "rejected the secret" | Google Apps Script needs attention | **Send it to Arianne** — you can't fix this one |
| Cafe list won't load anywhere | Same as above | Check `/health`, then Arianne |

**Rule of thumb:** if `/health` is green, it's a code bug and you can fix it.
If it's red, it's Arianne's Google setup.

---

## Cheat sheet

```bash
cd ~/Documents/order-desk        # go to the project
git checkout main && git pull    # get the latest
git checkout -b fix-something    # start a fix
claude                           # describe the bug, get a fix
npm run dev                      # try it at localhost:3000
npm run typecheck && npm run build   # must both pass
git add -A && git commit -m "Fix ..." && git push -u origin fix-something
```

Then open the pull request link, check the Vercel test link, tell Arianne.

---

## If you get stuck

Paste the error straight into Claude — including the whole red block, not a
summary. If Claude can't resolve it in a couple of tries, or if it wants to
change the Apps Script files, stop and send it to Arianne. Nothing you do on
a branch can affect the live site, so it's always safe to stop and ask.
