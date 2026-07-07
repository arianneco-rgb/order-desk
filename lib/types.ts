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

export interface BpiMatch {
  amount: number;
  senderName: string;
  ref: string;
  date: string;
  emailId: string;
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
  shopifyDraftId?: string;
  shopifyDraftName?: string;
  shopifyDraftUrl?: string;
  shopifyOrderId?: string;
  draftCreatedAt?: string;
  /** The filled Total Order reply Joey copy-pastes into Viber. */
  reply: string;
  /** The paid-confirmation reply, revealed after Confirm payment. */
  paidReply?: string;
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
