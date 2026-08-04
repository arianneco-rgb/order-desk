// Core domain types for the Order Desk.
// The one rule: the app only DRAFTS orders and MATCHES payments —
// Joey confirms every draft and every payment. Nothing is automatic end-to-end.

export type OrderStatus =
  | "queued"
  | "processing"
  | "processed"
  | "draft_created"
  | "paid";

/** pouch = 200g wholesale pouch (10 per case). sample = 20g sample sachet. */
export type ItemForm = "pouch" | "sample";

export interface OrderItem {
  productKey: string;
  form: ItemForm;
  /** pouch form: number of 200g pouches. sample form: number of sachets. */
  qty: number;
  /** 0..1 parser confidence; 1 after Joey edits a line by hand. */
  confidence: number;
}

/** An order line joined with catalog prices. Derived, never stored. */
export interface PricedItem extends OrderItem {
  title: string;
  /** Full cases billed at the case price (pouch form only). */
  cases: number;
  /** Remainder pouches billed at the single-pouch price. */
  loosePouches: number;
  pouchPrice: number | null;
  casePrice: number | null;
  samplePrice: number | null;
  /** Line total in PHP. */
  amount: number;
  warnings: string[];
}

/**
 * Real BPI notification emails carry no payer name at all (verified
 * against 7 real samples, 2026-07-29) — matching is by amount + reference
 * + (InstaPay only) the sending account's last 4 digits, never a name.
 */
export interface BpiMatch {
  amount: number;
  ref: string;
  date: string;
  emailId: string;
  /** Claims this row in the BPI Transactions sheet — see lib/bpi.ts. */
  matchKey: string;
  type: "instapay" | "edpo";
  /** Only ever set for InstaPay — EDPO carries no sender account info. */
  fromAccountLast4?: string;
  sourceBank?: string;
  /** EDPO is a pre-advice ("will be credited within the day") — false means the money isn't in the account yet. */
  settled: boolean;
  warnings: string[];
  /** "reference" when a proof screenshot's extracted ref matched this row exactly — otherwise "amount". */
  matchedBy?: "reference" | "amount";
}

/** What Claude vision read off a proof screenshot (best-effort, key-gated). */
export interface ProofAnalysis {
  /** Transfer amount in PHP, if legible. */
  amount?: number;
  ref?: string;
  senderName?: string;
  date?: string;
  /** The image didn't look like a payment slip / nothing legible. */
  unreadable?: boolean;
}

export interface ProofOfPayment {
  url: string;
  name: string;
  uploadedAt: string;
  /** Present only when ANTHROPIC_API_KEY is set — see lib/proof-reader.ts. */
  analysis?: ProofAnalysis;
}

export interface PaymentInfo {
  /** One or more screenshots/slips — cafes sometimes send partial or split payments. */
  proofs?: ProofOfPayment[];
  bpiMatch?: BpiMatch;
  /** True when a match was searched for and none found (drives the error state). */
  noMatch?: boolean;
  confirmed: boolean;
}

/** Keys match DELIVERY_METHODS in lib/delivery.ts (labels + draft shipping line). */
export type DeliveryMethod = "pickup" | "mm_delivery" | "jnt_nationwide";

export interface ManualDiscount {
  valueType: "FIXED_AMOUNT" | "PERCENTAGE";
  /** Pesos for FIXED_AMOUNT, 0–100 for PERCENTAGE. */
  value: number;
  /** Shown on the Shopify draft, e.g. "Sample credit". */
  title: string;
}

/**
 * Per-order choices Joey makes before creating the draft (team-requested:
 * discounts, VAT, delivery). Defaults come from the Shopify customer profile
 * (address → delivery, "Invoice Requested" tag → VAT) — always overridable.
 * Frozen once the draft exists; editing them invalidates the draft, same as
 * editing line items.
 */
export interface DraftOptions {
  /** Shopify applies the customer's eligible automatic discounts (acceptAutomaticDiscounts). */
  applyEligibleDiscounts: boolean;
  manualDiscount?: ManualDiscount;
  /**
   * Toggles Shopify's own tax engine for this draft (`taxExempt: !chargeVat`
   * — see lib/shopify.ts buildDraftOrderInput). VAT shows under the
   * draft's Payment section as Shopify's native "Estimated tax", same as
   * any other order — not a custom line item.
   */
  chargeVat: boolean;
  deliveryMethod?: DeliveryMethod;
  /** Optional ₱ on the draft's shipping line (usually 0 — fee billed separately). */
  deliveryFee?: number;
  /** 100% line discount on sample lines — samples stay on record, charged ₱0. */
  freeSamples: boolean;
}

/** Shopify-calculated money breakdown (draftOrderCalculate) — shown in the preview. */
export interface DraftTotals {
  subtotal: number;
  discounts: number;
  vat: number;
  shipping: number;
  total: number;
}

export interface Order {
  id: string;
  /** Cafe name shown everywhere. */
  company: string;
  /** Shopify customer GID when known. */
  customerId?: string;
  rawMessage: string;
  items: OrderItem[];
  /** Always derived from Shopify variant prices — never hand-entered. */
  total: number;
  status: OrderStatus;
  needsReview: boolean;
  reviewReasons: string[];
  /** Quiet, non-blocking annotations (routine conversions, pack splits). */
  softNotes?: string[];
  shopifyDraftId?: string;
  shopifyDraftName?: string;
  shopifyDraftUrl?: string;
  shopifyOrderId?: string;
  draftCreatedAt?: string;
  /** The filled Total Order reply Joey copy-pastes into Viber. */
  reply: string;
  /** The paid-confirmation reply, revealed after Confirm payment. */
  paidReply?: string;
  /** Discounts/VAT/delivery choices — set during processing, edited by Joey. */
  options: DraftOptions;
  /**
   * The breakdown backing `total`, refreshed on every reprice. Live mode:
   * Shopify's own draftOrderCalculate (includes automatic discounts).
   * Mock mode / Shopify hiccup: local math (lib/pricing.ts localDraftTotals).
   * Undefined only on orders that haven't been processed yet.
   */
  totals?: DraftTotals;
  payment: PaymentInfo;
  createdAt: string;
  /** Internal state-machine timestamp: when "processing" may complete. */
  processAfter?: string;
  processedAt?: string;
  paidAt?: string;
  /**
   * Stamped at creation from the global test-mode switch (Nav toggle). Fakes
   * the Shopify draft/mark-paid calls (see lib/shopify.ts) and skips the
   * Sheet mirror write (see lib/sheets.ts) — everything else about the order
   * behaves normally so the flow can be tested end-to-end. Never flips after
   * creation, so an order's real/test status can't change mid-flow.
   */
  isTest?: boolean;
  /**
   * Set once an invoice is generated (see app/api/orders/[id]/invoice) —
   * locked in permanently so re-viewing the invoice never silently assigns
   * a new number. "{MerchantCode}-{seq}", matching the Invoice Ledger.
   */
  invoiceNumber?: string;
  invoicePreparedBy?: string;
  invoiceGeneratedAt?: string;
  invoicePoNo?: string;
  /** The real Shopify order name (e.g. "#5358") at generation time — locked in so it never has to be re-fetched. */
  invoiceOrderNo?: string;
}

export interface CafeCustomer {
  shopifyId: string;
  /** Cafe/company name used in the dropdown; falls back to the contact's name. */
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  city?: string;
  /**
   * Shopify customer tags (e.g. "Invoice Requested", "wholesale"). Only
   * populated in live mode — the bundled snapshot doesn't carry tags, so
   * this is undefined/empty when running without SHOPIFY_ADMIN_TOKEN.
   */
  tags?: string[];
}

export interface VariantRef {
  variantId: string;
  sku: string;
  price: number;
  title: string;
}

export interface CatalogProduct {
  key: string;
  title: string;
  /** Lowercase names/misspellings the parser should recognise. */
  aliases: string[];
  productId: string;
  /** 200g pouch variant. */
  pouch?: VariantRef;
  /** Case (10 x 200g) variant. */
  case?: VariantRef;
  /** 1kg variant (only some products, e.g. Koyo Hojicha). */
  kilo?: VariantRef;
  /** 20g sample sachet variant (50g for Mitsu). */
  sample?: VariantRef;
}

export interface OrderHistoryRow {
  paidAt: string;
  company: string;
  items: string;
  total: number;
  orderId: string;
  shopifyDraftName?: string;
  status: "paid";
  /** Free-text note Joey can add/edit after the fact (e.g. a correction). */
  notes?: string;
  /** Carried over from Order.isTest — skips the Sheet mirror write. */
  isTest?: boolean;
}
