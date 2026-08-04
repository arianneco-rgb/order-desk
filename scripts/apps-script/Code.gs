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
//   6. BPI matching does NOT need this account to have Gmail access. A
//      SEPARATE Apps Script project (deployed under whoever actually
//      receives BPI transfer emails, e.g. Marco) logs transactions into a
//      shared "BPI Transactions" spreadsheet on a timer — this script only
//      reads that sheet (BPI_TRANSACTIONS_SHEET_ID below) and writes back
//      which order a transaction was applied to. Share that sheet with
//      THIS account as Editor.
//
// Whenever you edit this file, make a NEW deployment (or "Manage
// deployments" → edit → new version) — saving alone doesn't republish it.

// Config resolution: Script Properties FIRST, then the constants below.
// Script Properties live outside the code, so re-pasting this file (e.g.
// to pick up a new action) can never wipe the real sheet ID or secret and
// lock the whole bridge out with "Unauthorized" — which is exactly what
// happened on 2026-07-30 when the placeholder version below was pasted
// over a working deployment. Set them ONCE via setupConfig() (see below),
// after which the two constants are only a fallback.
const SHEET_ID_FALLBACK = 'PASTE_YOUR_GOOGLE_SHEET_ID_HERE';
const SECRET_KEY_FALLBACK = 'PASTE_A_LONG_RANDOM_SECRET_HERE';

function config_(name, fallback) {
  const stored = PropertiesService.getScriptProperties().getProperty(name);
  return stored || fallback;
}

function getSheetId_() {
  return config_('SHEET_ID', SHEET_ID_FALLBACK);
}

function getSecretKey_() {
  return config_('SECRET_KEY', SECRET_KEY_FALLBACK);
}

/**
 * Run ONCE from the editor (function dropdown → setupConfig → ▶) to store
 * the sheet ID + secret in Script Properties. Fill in the two values here
 * first. After this, they survive any future re-paste of this file.
 */
function setupConfig() {
  const SHEET_ID = '';   // ← paste the Customers/Order History sheet ID
  const SECRET = '';     // ← paste the same value as APPS_SCRIPT_SECRET
  if (!SHEET_ID || !SECRET) throw new Error('Fill in SHEET_ID and SECRET inside setupConfig first.');
  PropertiesService.getScriptProperties().setProperties({ SHEET_ID: SHEET_ID, SECRET_KEY: SECRET });
  return { ok: true };
}

const CUSTOMERS_TAB = 'Customers';
const HISTORY_TAB = 'Order History';
const CUSTOMER_HEADER = ['Cafe', 'Contact', 'Email', 'Phone', 'City', 'Shopify ID'];
const HISTORY_HEADER = ['Paid at', 'Cafe', 'Items', 'Total (PHP)', 'Order Desk ID', 'Shopify draft', 'Status', 'Notes'];

// The invoice generator lives in a SEPARATE, pre-existing spreadsheet (the
// team's own Invoice Ledger / Customer Profiles workbook) — not the
// Customers/Order History sheet above. Whichever Google account this
// script is deployed under must ALSO have edit access to this spreadsheet
// (share it with that account) or getCustomerProfile/logInvoice will fail
// with a permission error.
const INVOICE_SHEET_ID = '19aY634KhVj26raqeEl1ya-JZBSyEalycOJO7PNwNoLg';
const CUSTOMER_PROFILES_TAB = 'Customer Profiles';
const INVOICE_LEDGER_TAB = 'Invoice Ledger';

// BPI payment matching reads from a SEPARATE, dedicated spreadsheet that a
// second Apps Script project (deployed under whichever Google account
// actually receives BPI transfer emails — Gmail access is always the
// deploying account's own mailbox) writes to on a timer. This script only
// ever READS that sheet and writes back which order a transaction was
// applied to — it never touches Gmail itself. Share the sheet with THIS
// script's account as Editor (view is not enough, since matching writes
// back to it).
const BPI_TRANSACTIONS_SHEET_ID = '1wSjFC954T-GnnE7mr2tmcA7GoY2jDUqrCimEgapC-_M';
const BPI_TRANSACTIONS_TAB = 'Transactions';

function doGet(e) {
  return handle(e);
}

function doPost(e) {
  return handle(e);
}

function handle(e) {
  try {
    const params = (e && e.parameter) || {};
    if (params.key !== getSecretKey_()) {
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
      case 'listBpiTransactions':
        return json({ transactions: listBpiTransactions() });
      case 'markBpiTransactionMatched':
        return json(markBpiTransactionMatched(body.matchKey, body.orderId));
      case 'getCustomerProfile':
        return json({ profile: findCustomerProfile(body.contactNumber, body.nameOrCompany) });
      case 'getOrCreateCustomerProfile':
        return json(getOrCreateCustomerProfile(body));
      case 'logInvoice':
        return json(logInvoice(body));
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
  const ss = SpreadsheetApp.openById(getSheetId_());
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

// ── BPI transaction log (read + reconcile — Gmail lives on a SEPARATE script) ──
// See BPI_MATCHING_HANDOFF for why the old GmailApp-based searchBpi was
// removed: it searched threads instead of messages, so a single collapsed
// BPI thread made the newer_than: filter meaningless, and it matched on a
// sender-name field that real BPI emails don't actually contain. That
// logic now lives in the separate Gmail-reading script, corrected, and
// only ever writes rows here — this script just reads them.

function getBpiTransactionsSheet() {
  const ss = SpreadsheetApp.openById(BPI_TRANSACTIONS_SHEET_ID);
  const sheet = ss.getSheetByName(BPI_TRANSACTIONS_TAB);
  if (!sheet) throw new Error('"' + BPI_TRANSACTIONS_TAB + '" tab not found — has the Gmail-side script logged anything yet?');
  return sheet;
}

// Column order written by the Gmail-side script's logBpiTransactionsToSheet().
function listBpiTransactions() {
  const sheet = getBpiTransactionsSheet();
  const values = sheet.getDataRange().getValues();
  return values
    .slice(1)
    .filter(function (r) {
      return r[0];
    })
    .map(function (r) {
      return {
        emailId: r[0],
        matchKey: r[1],
        type: r[2],
        amount: Number(r[3]) || 0,
        ref: r[4] || '',
        fromAccountLast4: r[5] || '',
        sourceBank: r[6] || '',
        status: r[7] || '',
        settled: r[8] === true || String(r[8]).toLowerCase() === 'true',
        date: toIso(r[9]),
        loggedAt: toIso(r[10]),
        matchedOrderId: r[11] || '',
        matchedAt: r[12] ? toIso(r[12]) : '',
        warnings: r[13]
          ? String(r[13])
              .split(',')
              .map(function (w) {
                return w.trim();
              })
              .filter(Boolean)
          : [],
      };
    });
}

/**
 * Claims a transaction row for an order — this is the dedupe that stops
 * the same payment being applied to two different orders. Refuses if a
 * DIFFERENT order already claimed it; re-claiming for the SAME order is a
 * harmless no-op (so a retried confirm-payment click doesn't error).
 */
function markBpiTransactionMatched(matchKey, orderId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getBpiTransactionsSheet();
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (values[i][1] === matchKey) {
        const existingOrderId = values[i][11];
        if (existingOrderId && existingOrderId !== orderId) {
          return { error: 'already_matched', matchedOrderId: existingOrderId };
        }
        sheet.getRange(i + 1, 12).setValue(orderId);
        sheet.getRange(i + 1, 13).setValue(new Date().toISOString());
        return { ok: true };
      }
    }
    return { error: 'Transaction not found for matchKey: ' + matchKey };
  } finally {
    lock.releaseLock();
  }
}

// ── Invoice generator ──────────────────────────────────────────────────
// Reads/writes the team's existing Invoice Ledger / Customer Profiles
// spreadsheet (INVOICE_SHEET_ID above) — the same one Joey/Marco already
// use, not a new sheet Order Desk owns.

function getInvoiceSheet(name) {
  const ss = SpreadsheetApp.openById(INVOICE_SHEET_ID);
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Sheet tab not found in invoice spreadsheet: ' + name);
  return sheet;
}

function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}

/**
 * Matches an order to a row in "Customer Profiles" by contact number
 * first (most reliable — company names in Shopify are often not the real
 * cafe/corporate name), then exact customer/company name, then a loose
 * substring match. Header is row 3; data starts row 4.
 */
function findCustomerProfile(contactNumber, nameOrCompany) {
  const sheet = getInvoiceSheet(CUSTOMER_PROFILES_TAB);
  const values = sheet.getDataRange().getValues();
  const wantPhone = digitsOnly(contactNumber).slice(-10);
  const wantName = String(nameOrCompany || '').trim().toLowerCase();

  let byPhone = null;
  let byExact = null;
  let byFuzzy = null;

  for (let i = 3; i < values.length; i++) {
    const row = values[i];
    const merchantCode = row[0];
    if (!merchantCode) continue;
    const customerName = row[1];
    const contactNum = row[2];
    const companyName = row[3];
    const tin = row[4];
    const address = row[5];
    const vat = row[6];

    const profile = {
      merchantCode: String(merchantCode).trim(),
      customerName: customerName || '',
      contactNumber: contactNum || '',
      companyName: companyName || '',
      tin: tin || '',
      address: address || '',
      vat: vat === true || String(vat).toLowerCase() === 'true',
    };

    const rowPhone = digitsOnly(contactNum).slice(-10);
    if (!byPhone && wantPhone && rowPhone && rowPhone === wantPhone) {
      byPhone = profile;
    }

    const rowCompany = String(companyName || '').trim().toLowerCase();
    const rowCustomer = String(customerName || '').trim().toLowerCase();
    if (!byExact && wantName && (rowCompany === wantName || rowCustomer === wantName)) {
      byExact = profile;
    }
    if (
      !byFuzzy &&
      wantName &&
      rowCompany &&
      (rowCompany.indexOf(wantName) !== -1 || wantName.indexOf(rowCompany) !== -1)
    ) {
      byFuzzy = profile;
    }
  }

  return byPhone || byExact || byFuzzy || null;
}

/**
 * Merchant-code derivation — validated against 3 real existing rows:
 *   "Coopers Coffee Haus and Resto Bar Corp." -> COC (CO + C)
 *   "Candid Coffee Enterprise OPC"            -> CAC (CA + C)
 *   "Deskanso" (single word)                  -> DES (first 3 letters)
 * Rule: one word -> first 3 letters; 2+ words -> first 2 letters of the
 * first word + first letter of the second word.
 */
function deriveMerchantCode(companyName) {
  const words = String(companyName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  const letters = function (w) {
    return w.replace(/[^A-Za-z]/g, '');
  };
  if (words.length === 1) {
    return letters(words[0]).slice(0, 3).toUpperCase();
  }
  return (letters(words[0]).slice(0, 2) + letters(words[1]).slice(0, 1)).toUpperCase();
}

/**
 * Only called when actually generating an invoice (never on preview) so a
 * mere page view can't silently write to the sheet. Searches first (same
 * priority as findCustomerProfile); if nothing matches, derives a merchant
 * code (or uses input.merchantCode, e.g. a manual override after a
 * collision) and appends a new Customer Profiles row. Refuses to silently
 * reuse a code that already belongs to a DIFFERENT company — the caller
 * must supply an explicit override in that case.
 */
function getOrCreateCustomerProfile(input) {
  const existing = findCustomerProfile(input.contactNumber, input.nameOrCompany);
  if (existing) return { profile: existing, created: false };

  const companyName = String(input.companyName || '').trim();
  if (!companyName) return { error: 'Company name is required to create a new customer profile.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // Re-check under the lock — another concurrent generate for the same
    // customer may have just created the row.
    const existingUnderLock = findCustomerProfile(input.contactNumber, input.nameOrCompany);
    if (existingUnderLock) return { profile: existingUnderLock, created: false };

    const sheet = getInvoiceSheet(CUSTOMER_PROFILES_TAB);
    const values = sheet.getDataRange().getValues();
    const code = String(input.merchantCode || '').trim().toUpperCase() || deriveMerchantCode(companyName);
    if (!code) return { error: 'Could not derive a merchant code from that company name.' };

    for (let i = 3; i < values.length; i++) {
      const row = values[i];
      const rowCode = String(row[0] || '').trim().toUpperCase();
      if (rowCode === code && String(row[3] || '').trim().toLowerCase() !== companyName.toLowerCase()) {
        return {
          error: 'code_collision',
          derivedCode: code,
          takenBy: row[3],
        };
      }
    }

    sheet.appendRow([
      code,
      input.customerName || '',
      input.contactNumber || '',
      companyName,
      input.tin || '',
      input.address || '',
      input.vat === true,
      '',
    ]);

    // Column G (VAT?) must render as an actual ticked/unticked checkbox,
    // matching the rest of the sheet — appendRow alone leaves a new row's
    // cell as plain TRUE/FALSE text unless it explicitly gets checkbox
    // validation, since that's a per-cell setting, not inferred from the
    // boolean value.
    const newRowIndex = sheet.getLastRow();
    sheet
      .getRange(newRowIndex, 7)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());

    return {
      created: true,
      profile: {
        merchantCode: code,
        customerName: input.customerName || '',
        contactNumber: input.contactNumber || '',
        companyName: companyName,
        tin: input.tin || '',
        address: input.address || '',
        vat: input.vat === true,
      },
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Assigns the next sequential invoice number for a merchant code
 * ({code}-{seq, zero-padded to 3}) and appends a row to Invoice Ledger.
 * LockService-protected so two near-simultaneous invoice generations for
 * the same merchant never claim the same number.
 */
function logInvoice(input) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const merchantCode = String(input.merchantCode || '').trim().toUpperCase();
    if (!merchantCode) return { error: 'Merchant code is required.' };

    const ledger = getInvoiceSheet(INVOICE_LEDGER_TAB);
    const values = ledger.getDataRange().getValues();
    const prefix = merchantCode + '-';
    let maxSeq = 0;
    for (let i = 1; i < values.length; i++) {
      const existing = String(values[i][0] || '');
      if (existing.indexOf(prefix) === 0) {
        const m = existing.match(/-(\d+)$/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > maxSeq) maxSeq = n;
        }
      }
    }
    const seq = maxSeq + 1;
    const invoiceNumber = prefix + ('000' + seq).slice(-3);

    ledger.appendRow([
      invoiceNumber,
      input.orderNo || '',
      input.poNo || '',
      input.customerName || '',
      input.companyName || '',
      input.paymentStatus || '',
    ]);

    return { invoiceNumber: invoiceNumber };
  } finally {
    lock.releaseLock();
  }
}
