# BPI Transaction Log Setup

1. Go to [script.google.com](https://script.google.com) while signed into the Google account that actually receives the BPI transfer emails. Click **New project**, delete whatever's in the editor.

2. Paste in the code below (`BpiMatching.gs`) into the empty editor.

3. In the left sidebar, click the **+** next to "Services", find **Gmail API**, and click **Add**. Without this step, the script can't read anything and every run fails immediately.

4. Project Settings (gear icon) → tick **"Show appsscript.json manifest file in editor"**. Open `appsscript.json` in the file list and replace its contents with the manifest below.

5. Near the top of the code, find `BPI_TRANSACTIONS_SHEET_ID` and replace the placeholder with this value:

   ```
   1wSjFC954T-GnnE7mr2tmcA7GoY2jDUqrCimEgapC-_M
   ```

   You'll need edit access to that spreadsheet before the script can write to it — if you get a permission error on step 6, it just means that share hasn't gone through yet.

6. In the function dropdown near the ▶ Run button, choose **installLogTrigger**, then click ▶. Google will ask you to authorize Gmail + Sheets access — allow it. That's it — no deployment, no URL, no secret key. It now checks your inbox every 10 minutes on its own.

7. (Optional but recommended) Pick **_verify** from the same dropdown, run it, then check **View → Logs** (or Cmd/Ctrl+Enter) for a summary of what it found.

**What to send back:** just your Google account's email address, so the spreadsheet in step 5 can be shared with you as an Editor.

---

## `BpiMatching.gs`

```javascript
// ── BPI payment matching — Gmail reader (deploy under Marco's account) ──
// This is a SEPARATE Apps Script project from Order Desk's main bridge
// (Code.gs) — it only ever reads BPI transfer-notification emails from
// whichever Google account it's deployed under (Gmail access is always the
// deploying account's own mailbox) and logs new transactions into a shared
// spreadsheet on a timer. It is NOT a web app — no deployment, no secret
// key, no HTTP calls from Order Desk. Order Desk's main bridge (a
// different script, different account) reads the sheet this writes to.

const BPI_TRANSACTIONS_SHEET_ID = 'PASTE_BPI_TRANSACTIONS_SHEET_ID_HERE';
const BPI_TRANSACTIONS_TAB = 'Transactions';
const BPI_TRANSACTIONS_HEADER = [
  'Email ID',
  'Match Key',
  'Type',
  'Amount',
  'Reference',
  'From Account Last 4',
  'Source Bank',
  'Status',
  'Settled',
  'Date',
  'Logged At',
  'Matched Order ID',
  'Matched At',
  'Warnings',
];

const BPI_LOOKBACK_DAYS = 30;
const BPI_MAX_MESSAGES = 500;
const BPI_PROCESSED_LABEL = 'OrderDesk/Processed';
// "Processed" here means "already logged to the sheet" (so the next timer
// run doesn't re-log it) — NOT "matched to an order". Which order a
// transaction is applied to is tracked in the sheet's own Matched Order ID
// column instead, written by Order Desk's main bridge.
const BPI_TO_ACCOUNT_LAST4 = '3163';

// ── Stage 1: query — exact sender, exact subject, not already logged ────

function buildBpiQuery(lookbackDays, excludeProcessed) {
  const days = lookbackDays || BPI_LOOKBACK_DAYS;
  const base =
    'newer_than:' +
    days +
    'd ((from:bpiinstapay@bpi.com.ph subject:"Incoming Interbank Funds Transfer Confirmation")' +
    ' OR (from:edpo-local-payments@bpi.com.ph subject:"Incoming Fund Transfer Status Notification"))';
  return excludeProcessed ? base + ' -label:"' + BPI_PROCESSED_LABEL + '"' : base;
}

// ── Stage 2: message-level listing (NOT GmailApp.search, which returns
// threads and is what caused the original bug) ───────────────────────────

function listBpiMessageIds(query) {
  const ids = [];
  let pageToken = null;
  let pagesFetched = 0;
  do {
    const resp = Gmail.Users.Messages.list('me', {
      q: query,
      maxResults: 100,
      pageToken: pageToken,
    });
    pagesFetched++;
    (resp.messages || []).forEach(function (m) {
      ids.push(m.id);
    });
    pageToken = resp.nextPageToken;
  } while (pageToken && ids.length < BPI_MAX_MESSAGES);
  return {
    ids: ids.slice(0, BPI_MAX_MESSAGES),
    pagesFetched: pagesFetched,
    truncated: ids.length > BPI_MAX_MESSAGES,
  };
}

// ── Stage 3: per-message sender + subject gate (belt and braces — the
// query already filters, but a caller-supplied query override shouldn't be
// able to sneak an unrelated email past classification) ──────────────────

function classifyBpiMessage(from, subject) {
  const f = String(from || '').toLowerCase();
  const s = String(subject || '');
  if (f.indexOf('bpiinstapay@bpi.com.ph') !== -1 && s.indexOf('Incoming Interbank Funds Transfer Confirmation') !== -1) {
    return 'instapay';
  }
  if (f.indexOf('edpo-local-payments@bpi.com.ph') !== -1 && s.indexOf('Incoming Fund Transfer Status Notification') !== -1) {
    return 'edpo';
  }
  return null;
}

// ── Stage 4: MIME walk, flatten, label-anchored field extraction ────────
// InstaPay nests multipart/mixed -> multipart/related -> text/html (depth 2).
// EDPO nests multipart/related -> text/html (depth 1). Recurse instead of
// assuming a fixed depth. Neither format has a text/plain part.

function extractHtmlPart(payload) {
  if (!payload) return null;
  if (payload.mimeType === 'text/html' && payload.body && payload.body.data) {
    return payload.body.data;
  }
  const parts = payload.parts || [];
  for (let i = 0; i < parts.length; i++) {
    const found = extractHtmlPart(parts[i]);
    if (found) return found;
  }
  return null;
}

function flattenHtml(html) {
  let text = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
  return text.replace(/\s+/g, ' ').trim();
}

// Account masking length varies (8 X's vs 12 X's across real samples) — pull
// the whole masked token and take its last 4 DIGITS, not a fixed-width slice.
function last4(masked) {
  const m = String(masked || '').match(/[X*x\d]{4,24}/);
  if (!m) return '';
  const digits = m[0].replace(/[^0-9]/g, '');
  return digits.slice(-4);
}

function parseInstapay(text) {
  const warnings = [];

  const amountMatch = text.match(/Transfer Amount\s*(?:PHP|PHP\.|₱)\s*([\d,]+(?:\.\d{2})?)/i);
  const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : 0;
  if (!amountMatch) warnings.push('amount_not_found');

  const refMatch = text.match(/Reference Number\s*:?\s*([A-Za-z0-9]{5,})/i);
  const ref = refMatch ? refMatch[1] : '';
  if (!refMatch) warnings.push('reference_not_found');

  const fromMatch = text.match(/Transfer From\s*:?\s*([X*x\d\s]{4,30})/i);
  const fromAccountLast4 = fromMatch ? last4(fromMatch[1]) : '';

  const toMatch = text.match(/Transfer To\s*:?\s*([X*x\d\s]{4,30})/i);
  const toAccountLast4 = toMatch ? last4(toMatch[1]) : '';
  if (!toMatch || toAccountLast4 !== BPI_TO_ACCOUNT_LAST4) {
    warnings.push('credited_to_unexpected_account:' + toAccountLast4);
  }

  const bankMatch = text.match(/Bank Name\s*(.+?)\s*Transfer Amount/i);
  const sourceBank = bankMatch ? bankMatch[1].trim() : '';

  return {
    type: 'instapay',
    service: 'INSTAPAY',
    amount: amount,
    ref: ref,
    fromAccountLast4: fromAccountLast4,
    toAccountLast4: toAccountLast4,
    sourceBank: sourceBank,
    status: 'credited',
    settled: true,
    parsed: amount > 0 && !!ref,
    warnings: warnings,
  };
}

function parseEdpo(text) {
  const warnings = [];

  const amountMatch = text.match(/amounting to\s*(?:PHP|₱)\s*([\d,]+(?:\.\d{2})?)/i);
  const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : 0;
  if (!amountMatch) warnings.push('amount_not_found');

  const refMatch = text.match(/OFI reference number\s*:?\s*([A-Za-z0-9]{5,})/i);
  const ref = refMatch ? refMatch[1] : '';
  if (!refMatch) warnings.push('reference_not_found');

  const toMatch = text.match(/account number\s*:?\s*([X*x\d\s]{4,30})/i);
  const toAccountLast4 = toMatch ? last4(toMatch[1]) : '';
  if (!toMatch || toAccountLast4 !== BPI_TO_ACCOUNT_LAST4) {
    warnings.push('credited_to_unexpected_account:' + toAccountLast4);
  }

  // EDPO is a pre-advice, not a credit — the money is not in the account
  // yet when this email arrives ("will be credited within the day").
  warnings.push('pre_advice_not_yet_credited');

  return {
    type: 'edpo',
    service: 'EDPO',
    amount: amount,
    ref: ref,
    fromAccountLast4: '', // EDPO carries no sender account info at all
    toAccountLast4: toAccountLast4,
    sourceBank: '',
    status: 'pending_same_day',
    settled: false,
    parsed: amount > 0 && !!ref,
    warnings: warnings,
  };
}

// ── Stage 5: validate, dedupe, sort ──────────────────────────────────────

function dedupeByMatchKey(payments) {
  const seen = {};
  const result = [];
  payments.forEach(function (p) {
    if (seen[p.matchKey]) return;
    seen[p.matchKey] = true;
    result.push(p);
  });
  return result;
}

function headerValue(headers, name) {
  const h = (headers || []).filter(function (x) {
    return x.name === name;
  })[0];
  return h ? h.value : '';
}

/**
 * The core scan. Returns { payments, meta } — payments is never silently
 * dropped: anything that passes the sender+subject gate comes back, with
 * parsed:false and a populated warnings array if a field couldn't be read,
 * instead of vanishing with no trace (the old failure mode).
 */
function searchBpi(query, lookbackDays, includeProcessed) {
  const q = query || buildBpiQuery(lookbackDays, !includeProcessed);
  const listing = listBpiMessageIds(q);
  const payments = [];
  let rejectedByGate = 0;

  listing.ids.forEach(function (id) {
    const msg = Gmail.Users.Messages.get('me', id, { format: 'full' });
    const headers = (msg.payload && msg.payload.headers) || [];
    const from = headerValue(headers, 'From');
    const subject = headerValue(headers, 'Subject');
    const type = classifyBpiMessage(from, subject);
    if (!type) {
      rejectedByGate++;
      return;
    }

    const htmlData = extractHtmlPart(msg.payload);
    if (!htmlData) return;
    const html = Utilities.newBlob(Utilities.base64DecodeWebSafe(htmlData)).getDataAsString('UTF-8');
    const text = flattenHtml(html);
    const parsed = type === 'instapay' ? parseInstapay(text) : parseEdpo(text);

    const dateHeader = headerValue(headers, 'Date');
    const date = dateHeader ? new Date(dateHeader) : new Date(Number(msg.internalDate));

    payments.push(
      Object.assign({}, parsed, {
        emailId: id,
        date: date.toISOString(),
        matchKey: type + ':' + (parsed.ref || id),
      })
    );
  });

  const deduped = dedupeByMatchKey(payments).sort(function (a, b) {
    return new Date(b.date) - new Date(a.date);
  });

  return {
    payments: deduped,
    meta: {
      query: q,
      lookbackDays: lookbackDays || BPI_LOOKBACK_DAYS,
      excludingProcessedLabel: !includeProcessed,
      messagesFetched: listing.ids.length,
      rejectedByGate: rejectedByGate,
      pagesFetched: listing.pagesFetched,
      truncatedByMessageCap: listing.truncated,
    },
  };
}

// ── Processed-label lifecycle ────────────────────────────────────────────
// "gmail.modify" (declared in appsscript.json) is read + write on the
// mailbox — it's the narrowest scope that can apply a label to a message.
// It does not permit permanent deletion. Keep this project's sharing tight.

function getProcessedLabelId() {
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty('BPI_PROCESSED_LABEL_ID');
  if (cached) return cached;

  const list = Gmail.Users.Labels.list('me');
  const existing = (list.labels || []).filter(function (l) {
    return l.name === BPI_PROCESSED_LABEL;
  })[0];
  if (existing) {
    props.setProperty('BPI_PROCESSED_LABEL_ID', existing.id);
    return existing.id;
  }
  const created = Gmail.Users.Labels.create(
    { name: BPI_PROCESSED_LABEL, labelListVisibility: 'labelHide', messageListVisibility: 'hide' },
    'me'
  );
  props.setProperty('BPI_PROCESSED_LABEL_ID', created.id);
  return created.id;
}

function markBpiProcessed(emailIds) {
  if (!emailIds || emailIds.length === 0) return { ok: true, count: 0 };
  Gmail.Users.Messages.batchModify({ ids: emailIds, addLabelIds: [getProcessedLabelId()] }, 'me');
  return { ok: true, count: emailIds.length };
}

function unmarkBpiProcessed(emailIds) {
  if (!emailIds || emailIds.length === 0) return { ok: true, count: 0 };
  Gmail.Users.Messages.batchModify({ ids: emailIds, removeLabelIds: [getProcessedLabelId()] }, 'me');
  return { ok: true, count: emailIds.length };
}

// ── The actual job: log new transactions to the shared sheet ────────────

function getBpiTransactionsSheet() {
  const ss = SpreadsheetApp.openById(BPI_TRANSACTIONS_SHEET_ID);
  let sheet = ss.getSheetByName(BPI_TRANSACTIONS_TAB);
  if (!sheet) sheet = ss.insertSheet(BPI_TRANSACTIONS_TAB);
  const first = sheet.getRange(1, 1, 1, BPI_TRANSACTIONS_HEADER.length).getValues()[0];
  const hasHeader = first.some(function (v) {
    return v !== '';
  });
  if (!hasHeader) sheet.getRange(1, 1, 1, BPI_TRANSACTIONS_HEADER.length).setValues([BPI_TRANSACTIONS_HEADER]);
  return sheet;
}

/**
 * Timer entrypoint (see installLogTrigger). Scans for payment emails not
 * yet logged, appends one row per transaction, then labels those emails so
 * the next run doesn't re-log them.
 */
function logBpiTransactionsToSheet() {
  const result = searchBpi(null, null, false);
  if (result.payments.length === 0) return { logged: 0, meta: result.meta };

  const sheet = getBpiTransactionsSheet();
  const now = new Date().toISOString();
  const rows = result.payments.map(function (p) {
    return [
      p.emailId,
      p.matchKey,
      p.type,
      p.amount,
      p.ref,
      p.fromAccountLast4 || '',
      p.sourceBank || '',
      p.status,
      p.settled,
      p.date,
      now,
      '', // Matched Order ID — filled in by Order Desk's main bridge
      '', // Matched At
      (p.warnings || []).join(', '),
    ];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, BPI_TRANSACTIONS_HEADER.length).setValues(rows);

  markBpiProcessed(
    result.payments.map(function (p) {
      return p.emailId;
    })
  );

  return { logged: rows.length, meta: result.meta };
}

/**
 * Run ONCE from the editor (function dropdown → installLogTrigger → ▶).
 * Re-running is safe — it replaces any existing trigger for this function
 * rather than stacking duplicates.
 */
function installLogTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'logBpiTransactionsToSheet') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('logBpiTransactionsToSheet').timeBased().everyMinutes(10).create();
  return { ok: true, everyMinutes: 10 };
}

/** Run from the editor to sanity-check the setup after installing. */
function _verify() {
  const r = searchBpi();
  Logger.log(r.meta);
  Logger.log(r.payments.length + ' unreconciled payments');
  if (r.payments.length > 0) Logger.log(r.payments[0]);
}
```

## `appsscript.json`

```json
{
  "timeZone": "Asia/Manila",
  "dependencies": {
    "enabledAdvancedServices": [
      {
        "userSymbol": "Gmail",
        "version": "v1",
        "serviceId": "gmail"
      }
    ]
  },
  "oauthScopes": [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.scriptapp"
  ],
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8"
}
```
