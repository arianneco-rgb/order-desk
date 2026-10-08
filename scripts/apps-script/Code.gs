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
/** Columns the Gmail-side script writes — Email ID … Warnings. */
const BPI_TRANSACTIONS_COLUMNS = 14;
/** Match Key is column B; claiming looks it up there rather than scanning every row. */
const BPI_MATCH_KEY_COLUMN = 2;
const BPI_MATCHED_ORDER_COLUMN = 12;
const BPI_MATCHED_AT_COLUMN = 13;

/**
 * PAYMENT LEDGER + PROOF STORAGE
 *
 * Replaces auto-matching as the primary record of payment. Joey/JJ upload a
 * screenshot per transfer; each upload becomes one ledger row and one Drive
 * file, and Wheng reconciles weekly against the bank.
 *
 * One row PER TRANSFER, not per order — that's what makes split payments and
 * withholding tax ordinary rather than exceptional: three transfers for one
 * order are three rows, and the Balance column shows what's still open.
 *
 * The folder is created on first use if PAYMENT_PROOFS_FOLDER_ID is blank,
 * and its id is written to Script Properties so it survives a code paste.
 */
const PAYMENT_LEDGER_SHEET_ID = '1ZMk4C32nOx6vWCqHzLBbdSEctJQLOKCyNU7zIVoanwc';
const PAYMENT_LEDGER_TAB = 'Payment Ledger';
const PAYMENT_PROOFS_FOLDER_NAME = 'RMC Payment Proofs — Order Desk';
const PAYMENT_LEDGER_HEADER = [
  'Logged At', 'Payment Date', 'Order #', 'Order Desk ID', 'Customer Name',
  'Order Total', 'Amount Paid', 'Balance', 'Bank / Method', 'Reference No.',
  'Screenshot', 'Uploaded By', 'Notes', 'Recon Status', 'Recon Date', 'Recon By',
];

/**
 * RUN THIS ONCE from the editor after pasting a new version.
 *
 * Google only asks for a permission when code that needs it actually runs,
 * and it asks per SCOPE — so running a Sheets function grants nothing for
 * Drive. This touches Drive deliberately, which is what makes the consent
 * prompt appear. Without it, payment-proof uploads fail with
 * "Wala kang pahintulot / You do not have permission to call DriveApp".
 *
 * Safe to re-run: it reuses the folder if one already exists.
 */
function authorizeDrive() {
  const folder = paymentProofsFolder_();
  const msg =
    'Drive authorised.\n' +
    'Payment proofs folder: "' + folder.getName() + '"\n' +
    'Folder ID: ' + folder.getId() + '\n' +
    'Open it: ' + folder.getUrl() + '\n\n' +
    'Share this folder with whoever reconciles payments.';
  Logger.log(msg);
  return msg;
}

function paymentProofsFolder_() {
  const props = PropertiesService.getScriptProperties();
  const stored = props.getProperty('PAYMENT_PROOFS_FOLDER_ID');
  if (stored) {
    try { return DriveApp.getFolderById(stored); } catch (e) { /* recreate below */ }
  }
  const existing = DriveApp.getFoldersByName(PAYMENT_PROOFS_FOLDER_NAME);
  const folder = existing.hasNext()
    ? existing.next()
    : DriveApp.createFolder(PAYMENT_PROOFS_FOLDER_NAME);
  props.setProperty('PAYMENT_PROOFS_FOLDER_ID', folder.getId());
  return folder;
}

function getPaymentLedgerSheet_() {
  const ss = SpreadsheetApp.openById(PAYMENT_LEDGER_SHEET_ID);
  let sheet = ss.getSheetByName(PAYMENT_LEDGER_TAB);
  if (!sheet) {
    // A CSV import names the first tab after the file, so adopt whatever
    // single tab exists rather than leaving a stray empty one behind.
    const all = ss.getSheets();
    sheet = all.length === 1 ? all[0].setName(PAYMENT_LEDGER_TAB) : ss.insertSheet(PAYMENT_LEDGER_TAB);
  }
  const first = sheet.getRange(1, 1, 1, PAYMENT_LEDGER_HEADER.length).getValues()[0];
  if (!first.some(function (v) { return v !== ''; })) {
    sheet.getRange(1, 1, 1, PAYMENT_LEDGER_HEADER.length)
      .setValues([PAYMENT_LEDGER_HEADER]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Saves one screenshot to Drive and returns its link. */
function savePaymentProof(input) {
  const match = String(input.dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return { error: 'dataUrl must be a base64 data URL.' };
  const blob = Utilities.newBlob(
    Utilities.base64Decode(match[2]),
    match[1],
    input.fileName || ('proof-' + new Date().getTime())
  );
  const file = paymentProofsFolder_().createFile(blob);
  // Anyone with the link can view: Wheng reconciles from the sheet and must
  // be able to open a screenshot without being granted each file one by one.
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) { /* domain policy may forbid link sharing — the link still works internally */ }
  return { fileId: file.getId(), url: file.getUrl() };
}

/**
 * Appends one transfer. Balance is computed here from what the ledger
 * already holds for this order, so two uploads minutes apart can't both
 * report the full amount outstanding.
 */
function appendPaymentLedger(row) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getPaymentLedgerSheet_();
    const lastRow = sheet.getLastRow();
    let alreadyPaid = 0;
    if (lastRow > 1) {
      const existing = sheet.getRange(2, 4, lastRow - 1, 4).getValues(); // D..G
      existing.forEach(function (r) {
        if (String(r[0]) === String(row.orderDeskId)) alreadyPaid += Number(r[3]) || 0;
      });
    }
    const amount = Number(row.amountPaid) || 0;
    const total = Number(row.orderTotal) || 0;
    const balance = total - (alreadyPaid + amount);

    sheet.appendRow([
      new Date(),
      row.paymentDate || '',
      row.orderNo || '',
      row.orderDeskId || '',
      row.customerName || '',
      total,
      amount,
      balance,
      row.bank || '',
      row.reference || '',
      row.screenshotUrl || '',
      row.uploadedBy || '',
      row.notes || '',
      '', '', '',  // Recon columns — Wheng's, never written by the app
    ]);
    return { ok: true, balance: balance, alreadyPaid: alreadyPaid + amount };
  } finally {
    lock.releaseLock();
  }
}

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
      case 'savePaymentProof':
        return json(savePaymentProof(body));
      case 'appendPaymentLedger':
        return json(appendPaymentLedger(body));
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

/**
 * Finds a history row by Order Desk ID (column E) without reading the whole
 * sheet — Order History only ever grows, and both callers below run on a
 * user-facing click. Returns the 1-based row number, or 0 if not found.
 */
function findHistoryRow_(sheet, orderId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const found = sheet
    .getRange(2, 5, lastRow - 1, 1)
    .createTextFinder(orderId)
    .matchEntireCell(true)
    .findNext();
  return found ? found.getRow() : 0;
}

function setHistoryNote(orderId, note) {
  const sheet = getSheet(HISTORY_TAB);
  const row = findHistoryRow_(sheet, orderId);
  if (!row) return { ok: false };
  sheet.getRange(row, 8).setValue(note);
  return { ok: true };
}

function deleteHistoryRow(orderId) {
  const sheet = getSheet(HISTORY_TAB);
  const row = findHistoryRow_(sheet, orderId);
  if (!row) return { ok: false };
  sheet.deleteRow(row);
  return { ok: true };
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

// How many of the most recent rows to return. The Gmail-side script appends,
// so the newest transactions are always at the bottom. Reading the whole
// sheet made every call slower as the log grew (it never shrinks) — and this
// is polled every few seconds while an order is open. A payment older than
// the last few hundred transactions is never the one being matched.
const BPI_RECENT_ROWS = 300;

// Column order written by the Gmail-side script's logBpiTransactionsToSheet().
function listBpiTransactions() {
  const sheet = getBpiTransactionsSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const startRow = Math.max(2, lastRow - BPI_RECENT_ROWS + 1);
  const values = sheet
    .getRange(startRow, 1, lastRow - startRow + 1, BPI_TRANSACTIONS_COLUMNS)
    .getValues();
  return values
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
    // Jump straight to the row via a column-scoped TextFinder instead of
    // pulling the entire sheet into memory and looping. This runs while the
    // script lock is held and sits on the critical path of "Confirm payment
    // · mark paid", so its cost was the whole operation's cost — and it grew
    // with every transaction ever logged.
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { error: 'Transaction not found for matchKey: ' + matchKey };
    const found = sheet
      .getRange(2, BPI_MATCH_KEY_COLUMN, lastRow - 1, 1)
      .createTextFinder(matchKey)
      .matchEntireCell(true)
      .findNext();
    if (!found) return { error: 'Transaction not found for matchKey: ' + matchKey };

    const row = found.getRow();
    const existingOrderId = sheet.getRange(row, BPI_MATCHED_ORDER_COLUMN).getValue();
    if (existingOrderId && existingOrderId !== orderId) {
      return { error: 'already_matched', matchedOrderId: existingOrderId };
    }
    // One setValues call rather than two setValue round trips.
    sheet
      .getRange(row, BPI_MATCHED_ORDER_COLUMN, 1, 2)
      .setValues([[orderId, new Date().toISOString()]]);
    return { ok: true };
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
