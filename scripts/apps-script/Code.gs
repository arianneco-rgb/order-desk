// ── Order Desk — Apps Script bridge ─────────────────────────────────────
// Replaces a Google Cloud service account (blocked by the Workspace admin)
// with a Google Apps Script Web App: it runs under YOUR OWN Google
// account's normal permissions, so no admin approval is needed to read/
// write the spreadsheet or search Gmail.
//
// SETUP (see SETUP.md for the full walkthrough):
//   1. Go to script.google.com → New project.
//   2. Delete the placeholder code, paste this whole file in.
//   3. Fill in SHEET_ID and SECRET_KEY below.
//   4. Deploy → New deployment → type "Web app" →
//        Execute as: Me
//        Who has access: Anyone
//      → Deploy → copy the Web app URL (ends in /exec).
//   5. Put that URL + your SECRET_KEY into the Order Desk .env.local as
//      APPS_SCRIPT_URL and APPS_SCRIPT_SECRET.
//   6. IMPORTANT for BPI matching: deploy this from the Google account that
//      actually receives BPI transfer-notification emails — Apps Script's
//      Gmail access is always the deploying account's own mailbox, it can't
//      read anyone else's inbox.
//
// Whenever you edit this file, make a NEW deployment (or "Manage
// deployments" → edit → new version) — saving alone doesn't republish it.

const SHEET_ID = 'PASTE_YOUR_GOOGLE_SHEET_ID_HERE';
const SECRET_KEY = 'PASTE_A_LONG_RANDOM_SECRET_HERE';

const CUSTOMERS_TAB = 'Customers';
const HISTORY_TAB = 'Order History';
const CUSTOMER_HEADER = ['Cafe', 'Contact', 'Email', 'Phone', 'City', 'Shopify ID'];
const HISTORY_HEADER = ['Paid at', 'Cafe', 'Items', 'Total (PHP)', 'Order Desk ID', 'Shopify draft', 'Status', 'Notes'];

function doGet(e) {
  return handle(e);
}

function doPost(e) {
  return handle(e);
}

function handle(e) {
  try {
    const params = (e && e.parameter) || {};
    if (params.key !== SECRET_KEY) {
      return json({ error: 'Unauthorized' });
    }
    const body = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    const action = body.action || params.action;

    switch (action) {
      case 'listCustomers':
        return json({ customers: listCustomers() });
      case 'syncCustomers':
        return json(syncCustomers(body.customers || []));
      case 'listHistory':
        return json({ rows: listHistory() });
      case 'appendHistory':
        return json(appendHistoryRow(body.row || {}));
      case 'setHistoryNote':
        return json(setHistoryNote(body.orderId, body.note));
      case 'deleteHistoryRow':
        return json(deleteHistoryRow(body.orderId));
      case 'searchBpi':
        return json({ emails: searchBpi(body.query) });
      default:
        return json({ error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return json({ error: String(err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

// ── Sheets ────────────────────────────────────────────────────────────────

function getSheet(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function ensureHeader(sheet, header) {
  const first = sheet.getRange(1, 1, 1, header.length).getValues()[0];
  const hasHeader = first.some(function (v) {
    return v !== '';
  });
  if (!hasHeader) sheet.getRange(1, 1, 1, header.length).setValues([header]);
}

function listCustomers() {
  const sheet = getSheet(CUSTOMERS_TAB);
  ensureHeader(sheet, CUSTOMER_HEADER);
  const values = sheet.getDataRange().getValues();
  return values
    .slice(1)
    .filter(function (r) {
      return r[0];
    })
    .map(function (r) {
      return {
        name: r[0],
        contactName: r[1] || undefined,
        email: r[2] || undefined,
        phone: r[3] || undefined,
        city: r[4] || undefined,
        shopifyId: r[5] || '',
      };
    });
}

function syncCustomers(customers) {
  const sheet = getSheet(CUSTOMERS_TAB);
  sheet.clear();
  const rows = [CUSTOMER_HEADER].concat(
    customers.map(function (c) {
      return [c.name || '', c.contactName || '', c.email || '', c.phone || '', c.city || '', c.shopifyId || ''];
    })
  );
  sheet.getRange(1, 1, rows.length, CUSTOMER_HEADER.length).setValues(rows);
  return { count: customers.length };
}

function listHistory() {
  const sheet = getSheet(HISTORY_TAB);
  ensureHeader(sheet, HISTORY_HEADER);
  const values = sheet.getDataRange().getValues();
  return values
    .slice(1)
    .filter(function (r) {
      return r[0];
    })
    .map(function (r) {
      return {
        paidAt: toIso(r[0]),
        company: r[1] || '',
        items: r[2] || '',
        total: Number(r[3]) || 0,
        orderId: r[4] || '',
        shopifyDraftName: r[5] || undefined,
        status: 'paid',
        notes: r[7] || undefined,
      };
    });
}

function appendHistoryRow(row) {
  const sheet = getSheet(HISTORY_TAB);
  ensureHeader(sheet, HISTORY_HEADER);
  sheet.appendRow([
    row.paidAt || '',
    row.company || '',
    row.items || '',
    row.total || 0,
    row.orderId || '',
    row.shopifyDraftName || '',
    row.status || 'paid',
    row.notes || '',
  ]);
  return { ok: true };
}

function setHistoryNote(orderId, note) {
  const sheet = getSheet(HISTORY_TAB);
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][4] === orderId) {
      sheet.getRange(i + 1, 8).setValue(note);
      return { ok: true };
    }
  }
  return { ok: false };
}

function deleteHistoryRow(orderId) {
  const sheet = getSheet(HISTORY_TAB);
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][4] === orderId) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false };
}

function toIso(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return v.toISOString();
  return v;
}

// ── BPI email matching (Gmail — reads the deploying account's own mail) ──
// ⚠️ Best-effort defaults, not verified against a real BPI notification —
// tune the regexes below once real emails are landing in the mailbox.

function searchBpi(query) {
  const q =
    query ||
    'newer_than:2d (from:bpi.com.ph OR subject:"BPI" OR subject:"fund transfer")';
  const threads = GmailApp.search(q, 0, 25);
  const emails = [];
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      const subject = msg.getSubject();
      const body = msg.getPlainBody();
      const text = subject + '\n' + body;

      const amountMatch = text.match(/(?:PHP|₱)\s*([\d,]+(?:\.\d{1,2})?)/i);
      if (!amountMatch) return;
      const refMatch = text.match(/ref(?:erence)?\.?\s*(?:no\.?|number|#)?\s*:?\s*([A-Za-z0-9-]{5,})/i);
      const senderMatch = text.match(/from\s+([A-Z][A-Za-z.,'\-\s]{2,60}?)(?:\s+(?:on|via|through)\b|[.,\n]|$)/);

      emails.push({
        emailId: msg.getId(),
        amount: Number(amountMatch[1].replace(/,/g, '')),
        senderName: senderMatch ? senderMatch[1].trim() : '',
        ref: refMatch ? refMatch[1] : '',
        date: msg.getDate().toISOString(),
      });
    });
  });
  return emails;
}
