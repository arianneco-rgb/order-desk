// Shopify adapter — the source of truth for customers, variant prices,
// draft orders, and marking orders paid.
//
// LIVE mode (SHOPIFY_STORE + either auth path below): Admin GraphQL API.
//   ⚠️ Point SHOPIFY_STORE at a TEST/DEV store until the team signs off.
// SNAPSHOT mode (default): a real snapshot of the ritualmatcha.ph catalog +
//   wholesale customers, with mock draft orders — nothing touches Shopify.
//
// Two supported auth paths, checked independently:
//   1. SHOPIFY_ADMIN_TOKEN — a static token, e.g. from an admin-created
//      custom app (Settings → Apps → Develop apps, the older flow). Never
//      expires on its own; used as-is.
//   2. SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET — a Dev Dashboard app.
//      These apps don't expose a static token in the UI at all; instead we
//      exchange the client credentials for a token via the OAuth client
//      credentials grant. That token expires in 24h, so it's fetched fresh
//      and cached in memory, refreshed automatically before it lapses —
//      same pattern as the Google service-account token in lib/sheets.ts.

import { shopifyMode } from "./config";
import { CATALOG_SNAPSHOT } from "./catalog-snapshot";
import { CUSTOMERS_SNAPSHOT } from "./customers-snapshot";
import { joinNaturally, plural } from "./conversions";
import { DELIVERY_METHODS } from "./delivery";
import { VAT_RATE } from "./pricing";
import { addRuntimeCustomer, getTestMode, historyRows, nextId, runtimeCustomers } from "./store";
import type {
  CafeCustomer,
  CatalogProduct,
  DraftTotals,
  Order,
  PricedItem,
  VariantRef,
} from "./types";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";

// ── Auth ─────────────────────────────────────────────────────────────────

interface ShopifyTokenCache {
  token: string;
  expiresAt: number;
}
declare global {
  // eslint-disable-next-line no-var
  var __odShopifyToken: ShopifyTokenCache | undefined;
  // eslint-disable-next-line no-var
  var __odShopifyTokenPromise: Promise<string> | undefined;
}

async function exchangeToken(store: string): Promise<string> {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Shopify live mode requires SHOPIFY_ADMIN_TOKEN, or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET."
    );
  }
  const res = await fetch(`https://${store}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Shopify token exchange failed: ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  globalThis.__odShopifyToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return json.access_token;
}

/**
 * Shopify revokes the PREVIOUS client_credentials token whenever a new one
 * is issued — so the exchange is single-flighted: concurrent callers (e.g.
 * the report's two parallel range queries on a cold server) share one
 * exchange instead of racing and revoking each other's tokens.
 */
async function getAccessToken(store: string, forceRefresh = false): Promise<string> {
  const staticToken = process.env.SHOPIFY_ADMIN_TOKEN;
  if (staticToken) return staticToken;

  if (!forceRefresh) {
    const cached = globalThis.__odShopifyToken;
    if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
  }

  if (!globalThis.__odShopifyTokenPromise) {
    globalThis.__odShopifyTokenPromise = exchangeToken(store).finally(() => {
      globalThis.__odShopifyTokenPromise = undefined;
    });
  }
  return globalThis.__odShopifyTokenPromise;
}

// ── GraphQL client ───────────────────────────────────────────────────────

async function adminGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const store = process.env.SHOPIFY_STORE;
  if (!store) {
    throw new Error("Shopify live mode requires SHOPIFY_STORE.");
  }

  const call = async (token: string): Promise<Response> =>
    fetch(`https://${store}.myshopify.com/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });

  let res = await call(await getAccessToken(store));
  if (res.status === 401) {
    // The cached token was revoked (issuing a NEW client_credentials token
    // anywhere — another instance, a script — kills the old one). Refresh
    // once and retry.
    res = await call(await getAccessToken(store, true));
  }
  if (!res.ok) {
    throw new Error(`Shopify API ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) throw new Error("Shopify GraphQL: empty response");
  return json.data;
}

function legacyId(gid: string): string {
  return gid.split("/").pop() ?? gid;
}

function adminUrl(path: string): string | undefined {
  const store = process.env.SHOPIFY_STORE;
  return store ? `https://admin.shopify.com/store/${store}/${path}` : undefined;
}

// ── Catalog (variant prices) ─────────────────────────────────────────────

// Extra parser aliases per product key (titles alone miss nicknames).
const EXTRA_ALIASES: Record<string, string[]> = Object.fromEntries(
  CATALOG_SNAPSHOT.map((p) => [p.key, p.aliases])
);

interface CatalogCache {
  at: number;
  data: CatalogProduct[];
}
declare global {
  // eslint-disable-next-line no-var
  var __odCatalogCache: CatalogCache | undefined;
}
const CATALOG_TTL_MS = 5 * 60_000;

export async function getCatalog(): Promise<CatalogProduct[]> {
  if (shopifyMode() === "snapshot") return CATALOG_SNAPSHOT;

  const cache = globalThis.__odCatalogCache;
  if (cache && Date.now() - cache.at < CATALOG_TTL_MS) return cache.data;

  try {
    const data = await fetchLiveCatalog();
    globalThis.__odCatalogCache = { at: Date.now(), data };
    return data;
  } catch (err) {
    console.error("Live catalog fetch failed; falling back to snapshot:", err);
    return CATALOG_SNAPSHOT;
  }
}

interface ProductsQuery {
  products: {
    edges: {
      node: {
        id: string;
        title: string;
        variants: {
          edges: { node: { id: string; title: string; sku: string | null; price: string } }[];
        };
      };
    }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

async function fetchLiveCatalog(): Promise<CatalogProduct[]> {
  const products: ProductsQuery["products"]["edges"][number]["node"][] = [];
  let after: string | null = null;
  for (let page = 0; page < 5; page++) {
    const data: ProductsQuery = await adminGraphQL<ProductsQuery>(
      `query($after: String) {
        products(first: 100, after: $after) {
          edges { node { id title variants(first: 30) { edges { node { id title sku price } } } } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { after }
    );
    products.push(...data.products.edges.map((e) => e.node));
    if (!data.products.pageInfo.hasNextPage) break;
    after = data.products.pageInfo.endCursor;
  }

  const result: CatalogProduct[] = [];
  for (const product of products) {
    const entry: CatalogProduct = {
      key: product.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      title: product.title,
      aliases: [product.title.toLowerCase()],
      productId: product.id,
    };
    for (const { node: v } of product.variants.edges) {
      const sku = v.sku ?? "";
      const ref: VariantRef = {
        variantId: v.id,
        sku,
        price: Number(v.price),
        title: v.title,
      };
      // SKU convention: WHO-*-0200 = 200g pouch · WHC-* = case (10 x 200g)
      // WHO-*-1000 = 1kg · SAM-* = sample sachet · CUS-*-0200 = custom 200g
      if (/^WHC-/.test(sku)) entry.case = ref;
      else if (/^WHO-.*-1000$/.test(sku)) entry.kilo = ref;
      else if (/^WHO-.*-0200$/.test(sku) || /^CUS-.*-0200$/.test(sku)) entry.pouch = ref;
      else if (/^SAM-/.test(sku)) entry.sample = ref;
    }
    if (entry.pouch || entry.case || entry.sample) {
      // Samples live on a separate "Samples" product in the store; attach
      // them to the matching named product when the variant title names it.
      entry.aliases = Array.from(
        new Set([...(EXTRA_ALIASES[matchSnapshotKey(entry.title)] ?? []), ...entry.aliases])
      );
      result.push(entry);
    }
  }

  // Re-home sample variants from the "Samples" product onto named products.
  const samplesProduct = result.find((p) => p.title.toLowerCase() === "samples");
  if (samplesProduct) {
    const named = result.filter((p) => p !== samplesProduct);
    for (const p of products.find((x) => x.title.toLowerCase() === "samples")?.variants.edges ?? []) {
      const v = p.node;
      const target = named.find((n) =>
        v.title.toLowerCase().startsWith(n.title.toLowerCase().split(" ")[0])
      );
      if (target && !target.sample) {
        target.sample = {
          variantId: v.id,
          sku: v.sku ?? "",
          price: Number(v.price),
          title: v.title,
        };
      }
    }
    result.splice(result.indexOf(samplesProduct), 1);
  }

  return result.length > 0 ? result : CATALOG_SNAPSHOT;
}

function matchSnapshotKey(title: string): string {
  const t = title.toLowerCase();
  const hit = CATALOG_SNAPSHOT.find(
    (p) => t.includes(p.key) || p.aliases.some((a) => t.includes(a))
  );
  return hit?.key ?? t;
}

// ── Customers ────────────────────────────────────────────────────────────

export async function getCafeCustomers(): Promise<CafeCustomer[]> {
  if (shopifyMode() === "snapshot") {
    return [...CUSTOMERS_SNAPSHOT, ...(await runtimeCustomers())].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }
  type CustomersPage = {
    customers: {
      edges: {
        node: {
          id: string;
          displayName: string;
          email: string | null;
          phone: string | null;
          tags: string[];
          defaultAddress: { company: string | null; city: string | null } | null;
        };
      }[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
  // Paginate — RMC has 300+ wholesale customers, well past one page.
  const edges: CustomersPage["customers"]["edges"] = [];
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const data: CustomersPage = await adminGraphQL<CustomersPage>(
      `query($after: String) {
        customers(first: 100, query: "tag:wholesale", after: $after) {
          edges { node { id displayName email phone tags defaultAddress { company city } } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { after }
    );
    edges.push(...data.customers.edges);
    if (!data.customers.pageInfo.hasNextPage) break;
    after = data.customers.pageInfo.endCursor;
  }
  return edges
    .map(({ node }) => ({
      shopifyId: node.id,
      name: node.defaultAddress?.company?.trim() || node.displayName,
      tags: node.tags,
      contactName: node.displayName,
      email: node.email ?? undefined,
      phone: node.phone ?? undefined,
      city: node.defaultAddress?.city ?? undefined,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface PastOrder {
  /** Shopify order name, e.g. "#5023" (empty in snapshot mode). */
  name: string;
  date: string;
  status: string;
  total: number;
  /** "2 cases of Kasane and 3 pouches of Yasumi" — display AND parser-friendly. */
  itemsText: string;
}

/** "Case (10 x 200g)" + qty 2 → "2 cases of Kasane" — wording the parser reads back. */
function describeShopifyLine(qty: number, title: string, variantTitle: string | null): string {
  const v = (variantTitle ?? "").toLowerCase();
  if (v.includes("case")) return `${plural(qty, "case")} of ${title}`;
  if (v.includes("sample") || /\b(20|50)\s*g\b/.test(v)) return `${plural(qty, "sample")} of ${title}`;
  if (/\b1\s*kg\b/.test(v)) return `${qty} kg of ${title}`;
  return `${plural(qty, "pouch")} of ${title}`;
}

/**
 * A cafe's real order history, straight from Shopify — includes orders that
 * never went through this dashboard. Snapshot mode falls back to the app's
 * own history rows for that cafe.
 */
export async function getCustomerPastOrders(
  customerId: string,
  company: string,
  limit = 5
): Promise<PastOrder[]> {
  if (shopifyMode() === "snapshot" || customerId.startsWith("mock:")) {
    const needle = company.trim().toLowerCase();
    return (await historyRows())
      .filter((r) => r.company.trim().toLowerCase() === needle)
      .slice(0, limit)
      .map((r) => ({
        name: r.shopifyDraftName ?? "",
        date: r.paidAt,
        status: "PAID",
        total: r.total,
        itemsText: r.items,
      }));
  }

  const data = await adminGraphQL<{
    customer: {
      orders: {
        edges: {
          node: {
            name: string;
            createdAt: string;
            displayFinancialStatus: string | null;
            currentTotalPriceSet: { shopMoney: { amount: string } };
            lineItems: {
              edges: { node: { title: string; quantity: number; variantTitle: string | null } }[];
            };
          };
        }[];
      };
    } | null;
  }>(
    `query($id: ID!, $first: Int!) {
      customer(id: $id) {
        orders(first: $first, sortKey: CREATED_AT, reverse: true) {
          edges { node {
            name createdAt displayFinancialStatus
            currentTotalPriceSet { shopMoney { amount } }
            lineItems(first: 20) { edges { node { title quantity variantTitle } } }
          } }
        }
      }
    }`,
    { id: customerId, first: limit }
  );
  if (!data.customer) return [];

  return data.customer.orders.edges.map(({ node }) => ({
    name: node.name,
    date: node.createdAt,
    status: node.displayFinancialStatus ?? "",
    total: Number(node.currentTotalPriceSet.shopMoney.amount) || 0,
    itemsText: joinNaturally(
      node.lineItems.edges.map(({ node: li }) =>
        describeShopifyLine(li.quantity, li.title, li.variantTitle)
      )
    ),
  }));
}

/** Profile facts that seed per-order defaults (VAT box, delivery method). */
export interface CustomerDefaults {
  taxExempt: boolean;
  tags: string[];
  city?: string;
  province?: string;
}

export async function getCustomerDefaults(
  customerId: string
): Promise<CustomerDefaults | null> {
  if (shopifyMode() === "snapshot" || customerId.startsWith("mock:")) return null;
  const data = await adminGraphQL<{
    customer: {
      taxExempt: boolean;
      tags: string[];
      defaultAddress: { city: string | null; province: string | null } | null;
    } | null;
  }>(
    `query($id: ID!) {
      customer(id: $id) {
        taxExempt tags
        defaultAddress { city province }
      }
    }`,
    { id: customerId }
  );
  if (!data.customer) return null;
  return {
    taxExempt: data.customer.taxExempt,
    tags: data.customer.tags,
    city: data.customer.defaultAddress?.city ?? undefined,
    province: data.customer.defaultAddress?.province ?? undefined,
  };
}

/**
 * ₱ this customer actually PAID for samples across their Shopify orders —
 * the gross side of the sample-credit suggestion (free samples contribute
 * ₱0 because line totals are post-discount). Sample lines are identified by
 * their SAM- SKU prefix.
 */
export async function getPaidSampleTotal(customerId: string): Promise<number> {
  if (shopifyMode() === "snapshot" || customerId.startsWith("mock:")) return 0;
  const data = await adminGraphQL<{
    customer: {
      orders: {
        edges: {
          node: {
            displayFinancialStatus: string | null;
            lineItems: {
              edges: {
                node: {
                  sku: string | null;
                  discountedTotalSet: { shopMoney: { amount: string } };
                };
              }[];
            };
          };
        }[];
      };
    } | null;
  }>(
    `query($id: ID!) {
      customer(id: $id) {
        orders(first: 50) {
          edges { node {
            displayFinancialStatus
            lineItems(first: 30) { edges { node {
              sku
              discountedTotalSet { shopMoney { amount } }
            } } }
          } }
        }
      }
    }`,
    { id: customerId }
  );
  if (!data.customer) return 0;
  let total = 0;
  for (const { node: order } of data.customer.orders.edges) {
    if (order.displayFinancialStatus !== "PAID") continue;
    for (const { node: li } of order.lineItems.edges) {
      if (li.sku?.startsWith("SAM-")) {
        total += Number(li.discountedTotalSet.shopMoney.amount) || 0;
      }
    }
  }
  return Math.round(total * 100) / 100;
}

// ── Report data ──────────────────────────────────────────────────────────

/** One Shopify order, flattened for report aggregation (lib/reports.ts). */
export interface RawReportOrder {
  name: string;
  createdAt: string;
  financialStatus: string;
  cafe: string;
  customerId: string;
  /** Customer tags — "wholesale" distinguishes cafes from retail buyers. */
  customerTags: string[];
  /** Customer's lifetime order count — used to spot first-time cafes. */
  customerLifetimeOrders: number;
  total: number;
  discounts: number;
  tags: string[];
  lineItems: {
    title: string;
    variantTitle: string;
    sku: string;
    quantity: number;
    amount: number;
  }[];
}

const REPORT_MAX_PAGES = 10; // 100 orders/page — plenty for any sane range

/**
 * Every Shopify order created in [from, to] (dates in PH time), newest
 * first — the whole store, not just app-processed orders. Returns
 * { orders, truncated } — truncated=true when the range has more than
 * REPORT_MAX_PAGES×100 orders.
 */
export async function getOrdersInRange(
  from: string,
  to: string
): Promise<{ orders: RawReportOrder[]; truncated: boolean }> {
  if (shopifyMode() === "snapshot") return { orders: [], truncated: false };

  interface Page {
    orders: {
      edges: {
        node: {
          name: string;
          createdAt: string;
          displayFinancialStatus: string | null;
          tags: string[];
          currentTotalPriceSet: { shopMoney: { amount: string } };
          totalDiscountsSet: { shopMoney: { amount: string } };
          customer: {
            id: string;
            displayName: string;
            numberOfOrders: string;
            tags: string[];
            defaultAddress: { company: string | null } | null;
          } | null;
          lineItems: {
            edges: {
              node: {
                title: string;
                variantTitle: string | null;
                sku: string | null;
                quantity: number;
                discountedTotalSet: { shopMoney: { amount: string } };
              };
            }[];
          };
        };
      }[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  }

  const search = `created_at:>='${from}T00:00:00+08:00' AND created_at:<='${to}T23:59:59+08:00'`;
  const orders: RawReportOrder[] = [];
  let after: string | null = null;
  let truncated = false;

  for (let page = 0; page < REPORT_MAX_PAGES; page++) {
    const data: Page = await adminGraphQL<Page>(
      `query($search: String!, $after: String) {
        orders(first: 100, query: $search, after: $after, sortKey: CREATED_AT, reverse: true) {
          edges { node {
            name createdAt displayFinancialStatus tags
            currentTotalPriceSet { shopMoney { amount } }
            totalDiscountsSet { shopMoney { amount } }
            customer { id displayName numberOfOrders tags defaultAddress { company } }
            lineItems(first: 40) { edges { node {
              title variantTitle sku quantity
              discountedTotalSet { shopMoney { amount } }
            } } }
          } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { search, after }
    );
    for (const { node } of data.orders.edges) {
      orders.push({
        name: node.name,
        createdAt: node.createdAt,
        financialStatus: node.displayFinancialStatus ?? "",
        cafe:
          node.customer?.defaultAddress?.company?.trim() ||
          node.customer?.displayName ||
          "(no customer)",
        customerId: node.customer?.id ?? "",
        customerTags: node.customer?.tags ?? [],
        customerLifetimeOrders: Number(node.customer?.numberOfOrders ?? 0) || 0,
        total: Number(node.currentTotalPriceSet.shopMoney.amount) || 0,
        discounts: Number(node.totalDiscountsSet.shopMoney.amount) || 0,
        tags: node.tags,
        lineItems: node.lineItems.edges.map(({ node: li }) => ({
          title: li.title,
          variantTitle: li.variantTitle ?? "",
          sku: li.sku ?? "",
          quantity: li.quantity,
          amount: Number(li.discountedTotalSet.shopMoney.amount) || 0,
        })),
      });
    }
    if (!data.orders.pageInfo.hasNextPage) return { orders, truncated: false };
    after = data.orders.pageInfo.endCursor;
  }
  truncated = true; // ran out of pages with more orders still unfetched
  return { orders, truncated };
}

export interface NewCustomerAddress {
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  zip?: string;
}

export async function createCafeCustomer(input: {
  cafeName: string;
  contactName?: string;
  /** Explicit split (from the profile form) — falls back to splitting contactName. */
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: NewCustomerAddress;
}): Promise<CafeCustomer> {
  // Test mode fakes customer creation too — a Shopify profile is a real
  // write. (To test REAL profile creation, e.g. with Jericho/Marco's test
  // accounts, turn test mode off and delete the profile in Shopify after.)
  if (shopifyMode() === "snapshot" || (await getTestMode())) {
    const customer: CafeCustomer = {
      shopifyId: `mock:Customer:${nextId("c_")}`,
      name: input.cafeName,
      contactName: input.contactName,
      email: input.email,
      phone: input.phone,
      city: input.address?.city,
    };
    await addRuntimeCustomer(customer);
    return customer;
  }

  // Explicit first/last from the profile form wins; otherwise split the
  // contact name on its last word (matching the profile field table:
  // "First name / Last name — from client message 'Name'").
  const [fallbackFirst, ...rest] = (input.contactName || input.cafeName).split(/\s+/);
  const firstName = input.firstName?.trim() || fallbackFirst;
  const lastName = input.lastName?.trim() || rest.join(" ") || undefined;
  const data = await adminGraphQL<{
    customerCreate: {
      customer: { id: string; displayName: string } | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(
    `mutation($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { id displayName }
        userErrors { field message }
      }
    }`,
    {
      input: {
        firstName,
        lastName,
        email: input.email || undefined,
        phone: input.phone || undefined,
        tags: ["wholesale", "Order Desk"],
        addresses: [
          {
            // The delivery address carries the person's name too, per the
            // team's profile field table.
            firstName,
            lastName,
            company: input.cafeName,
            phone: input.phone || undefined,
            address1: input.address?.address1 || undefined,
            address2: input.address?.address2 || undefined,
            city: input.address?.city || undefined,
            province: input.address?.province || undefined,
            zip: input.address?.zip || undefined,
            country: input.address?.address1 ? "Philippines" : undefined,
          },
        ],
      },
    }
  );
  const errs = data.customerCreate.userErrors;
  if (errs.length || !data.customerCreate.customer) {
    throw new Error(`Shopify customerCreate failed: ${errs.map((e) => e.message).join("; ") || "unknown"}`);
  }
  return {
    shopifyId: data.customerCreate.customer.id,
    name: input.cafeName,
    contactName: input.contactName,
    email: input.email,
    phone: input.phone,
    city: input.address?.city,
  };
}

// ── Draft orders ─────────────────────────────────────────────────────────

export interface DraftLineItem {
  variantId: string;
  quantity: number;
  label: string;
  /** Sample-sachet line — target of the "Free samples" 100% line discount. */
  isSample?: boolean;
}

/**
 * Map priced lines to Shopify variants: full cases on the Case variant,
 * the remainder on the 200g pouch variant, samples on the sample variant.
 */
export function buildDraftLineItems(
  priced: PricedItem[],
  catalog: CatalogProduct[]
): DraftLineItem[] {
  const lines: DraftLineItem[] = [];
  for (const item of priced) {
    const product = catalog.find((p) => p.key === item.productKey);
    if (!product) {
      throw new Error(`“${item.productKey}” is not in the Shopify catalog.`);
    }
    if (item.form === "sample") {
      if (!product.sample) throw new Error(`${product.title} has no sample variant in Shopify.`);
      lines.push({
        variantId: product.sample.variantId,
        quantity: item.qty,
        label: `${product.title} sample × ${item.qty}`,
        isSample: true,
      });
      continue;
    }
    if (item.cases > 0) {
      if (!product.case) throw new Error(`${product.title} has no Case variant in Shopify.`);
      lines.push({
        variantId: product.case.variantId,
        quantity: item.cases,
        label: `${product.title} case × ${item.cases}`,
      });
    }
    if (item.loosePouches > 0) {
      if (!product.pouch) throw new Error(`${product.title} has no 200g variant in Shopify.`);
      lines.push({
        variantId: product.pouch.variantId,
        quantity: item.loosePouches,
        label: `${product.title} 200g × ${item.loosePouches}`,
      });
    }
  }
  if (lines.length === 0) throw new Error("No line items to put on the draft.");
  return lines;
}

export interface DraftResult {
  draftId: string;
  draftName: string;
  draftUrl?: string;
}

/**
 * The ONE place the draft-order input is assembled — used verbatim by both
 * calculateDraft() (preview/reprice) and createDraftOrder(), so the total
 * Joey sends the cafe is exactly what the created draft will say.
 *
 * `vatAmount` > 0 adds the explicit "VAT (12%)" custom line. The store has
 * no PH tax registration configured (verified 2026-07-07: taxExempt:false +
 * PH address still calculates ₱0 tax), and enabling one store-wide would
 * change RETAIL checkout too — so VAT is a visible line item instead of
 * Shopify's tax engine. If the store ever configures PH taxes properly,
 * swap this for `taxExempt: !order.options.chargeVat`.
 */
function buildDraftOrderInput(
  order: Order,
  lineItems: DraftLineItem[],
  vatAmount: number
): Record<string, unknown> {
  const opts = order.options;
  const delivery = opts.deliveryMethod ? DELIVERY_METHODS[opts.deliveryMethod] : null;

  return {
    lineItems: [
      ...lineItems.map((l) => ({
        variantId: l.variantId,
        quantity: l.quantity,
        ...(opts.freeSamples && l.isSample
          ? { appliedDiscount: { value: 100, valueType: "PERCENTAGE", title: "Free samples" } }
          : {}),
      })),
      ...(vatAmount > 0
        ? [
            {
              title: "VAT (12%)",
              originalUnitPrice: vatAmount,
              quantity: 1,
              requiresShipping: false,
              taxable: false,
            },
          ]
        : []),
    ],
    ...(order.customerId && !order.customerId.startsWith("mock:")
      ? { purchasingEntity: { customerId: order.customerId } }
      : {}),
    note: `Order Desk — pasted Viber message from ${order.company}:\n${order.rawMessage}`,
    tags: [
      "Order Desk",
      order.company,
      ...(delivery ? [`Delivery: ${delivery.label}`] : []),
    ],
    useCustomerDefaultAddress: true,
    // ALWAYS tax-exempt: the tickbox's explicit VAT line is the ONLY tax on
    // a draft. Without this, Shopify's own PH registration adds 12% whenever
    // the customer isn't tax-exempt (or no customer is attached) — observed
    // live 2026-07-08 — which would stack on top of our VAT line.
    taxExempt: true,
    acceptAutomaticDiscounts: opts.applyEligibleDiscounts,
    ...(opts.manualDiscount && opts.manualDiscount.value > 0
      ? {
          appliedDiscount: {
            value: opts.manualDiscount.value,
            valueType: opts.manualDiscount.valueType,
            title: opts.manualDiscount.title || "Discount",
          },
        }
      : {}),
    ...(delivery
      ? { shippingLine: { title: delivery.label, price: opts.deliveryFee ?? 0 } }
      : {}),
  };
}

interface CalculatedMoney {
  subtotalPriceSet: { shopMoney: { amount: string } };
  totalDiscountsSet: { shopMoney: { amount: string } };
  totalShippingPriceSet: { shopMoney: { amount: string } };
  totalPriceSet: { shopMoney: { amount: string } };
}

async function draftOrderCalculate(input: Record<string, unknown>): Promise<CalculatedMoney> {
  const data = await adminGraphQL<{
    draftOrderCalculate: {
      calculatedDraftOrder: CalculatedMoney | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(
    `mutation($input: DraftOrderInput!) {
      draftOrderCalculate(input: $input) {
        calculatedDraftOrder {
          subtotalPriceSet { shopMoney { amount } }
          totalDiscountsSet { shopMoney { amount } }
          totalShippingPriceSet { shopMoney { amount } }
          totalPriceSet { shopMoney { amount } }
        }
        userErrors { field message }
      }
    }`,
    { input }
  );
  const errs = data.draftOrderCalculate.userErrors;
  const calc = data.draftOrderCalculate.calculatedDraftOrder;
  if (errs.length || !calc) {
    throw new Error(`draftOrderCalculate failed: ${errs.map((e) => e.message).join("; ") || "unknown"}`);
  }
  return calc;
}

const money = (set: { shopMoney: { amount: string } }): number =>
  Number(set.shopMoney.amount) || 0;

/**
 * Shopify's own math for this order (persists NOTHING — safe in test mode):
 * automatic discounts, manual discount, free samples, delivery fee, and the
 * VAT line. Two passes when VAT is on: first to learn the discounted goods
 * total the 12% applies to, second including the VAT line for the final
 * total (so any automatic-discount interaction is visible, not guessed).
 */
export async function calculateDraft(
  order: Order,
  lineItems: DraftLineItem[]
): Promise<DraftTotals> {
  const base = await draftOrderCalculate(buildDraftOrderInput(order, lineItems, 0));
  // Shopify's subtotalPrice is ALREADY NET of line + order discounts
  // (verified against the live store 2026-07-08) — it IS the VAT base. The
  // UI shows gross goods then −discounts, so report subtotal as net+disc.
  const netGoods = money(base.subtotalPriceSet);
  const discounts = money(base.totalDiscountsSet);
  const grossGoods = Math.round((netGoods + discounts) * 100) / 100;

  if (!order.options.chargeVat) {
    return {
      subtotal: grossGoods,
      discounts,
      vat: 0,
      shipping: money(base.totalShippingPriceSet),
      total: money(base.totalPriceSet),
    };
  }

  const vat = Math.round(Math.max(netGoods, 0) * VAT_RATE * 100) / 100;
  if (vat <= 0) {
    return {
      subtotal: grossGoods,
      discounts,
      vat: 0,
      shipping: money(base.totalShippingPriceSet),
      total: money(base.totalPriceSet),
    };
  }

  const final = await draftOrderCalculate(buildDraftOrderInput(order, lineItems, vat));
  return {
    subtotal: grossGoods,
    discounts,
    vat,
    shipping: money(final.totalShippingPriceSet),
    total: money(final.totalPriceSet),
  };
}

export async function createDraftOrder(
  order: Order,
  lineItems: DraftLineItem[],
  /** The VAT line amount — pass order.totals?.vat (kept fresh by reprice). */
  vatAmount: number
): Promise<DraftResult> {
  // Test-mode orders still price against real Shopify data (getCatalog,
  // getCafeCustomers, calculateDraft) — only the WRITE is faked, same mock:
  // id path as snapshot mode. completeDraftAsPaid() below then skips its own
  // Shopify call too, since it keys off the "mock:" prefix, not shopifyMode().
  if (shopifyMode() === "snapshot" || order.isTest) {
    const n = nextId("d_").replace("d_", "");
    const suffix = order.isTest ? "test" : "mock";
    return {
      draftId: `mock:DraftOrder:${n}`,
      draftName: `#D${n} (${suffix})`,
      draftUrl: undefined, // no real draft — nothing to link to
    };
  }

  const data = await adminGraphQL<{
    draftOrderCreate: {
      draftOrder: { id: string; name: string } | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(
    `mutation($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder { id name }
        userErrors { field message }
      }
    }`,
    { input: buildDraftOrderInput(order, lineItems, order.options.chargeVat ? vatAmount : 0) }
  );
  const errs = data.draftOrderCreate.userErrors;
  if (errs.length || !data.draftOrderCreate.draftOrder) {
    throw new Error(`draftOrderCreate failed: ${errs.map((e) => e.message).join("; ") || "unknown"}`);
  }
  const draft = data.draftOrderCreate.draftOrder;
  return {
    draftId: draft.id,
    draftName: draft.name,
    draftUrl: adminUrl(`draft_orders/${legacyId(draft.id)}`),
  };
}

/** Complete the draft and mark it paid (only after Joey confirms payment). */
export async function completeDraftAsPaid(order: Order): Promise<{ orderId: string }> {
  if (!order.shopifyDraftId) throw new Error("No draft to complete.");

  if (shopifyMode() === "snapshot" || order.shopifyDraftId.startsWith("mock:")) {
    return { orderId: `mock:Order:${legacyId(order.shopifyDraftId)}` };
  }

  const data = await adminGraphQL<{
    draftOrderComplete: {
      draftOrder: { order: { id: string; name: string } | null } | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(
    `mutation($id: ID!) {
      draftOrderComplete(id: $id, paymentPending: false) {
        draftOrder { order { id name } }
        userErrors { field message }
      }
    }`,
    { id: order.shopifyDraftId }
  );
  const errs = data.draftOrderComplete.userErrors;
  const completed = data.draftOrderComplete.draftOrder?.order;
  if (errs.length || !completed) {
    throw new Error(`draftOrderComplete failed: ${errs.map((e) => e.message).join("; ") || "unknown"}`);
  }
  return { orderId: completed.id };
}

/**
 * Permanently delete a (not-yet-paid) draft order in Shopify — used when
 * Joey deletes an order from the app. Never called on a completed/paid
 * order, only on drafts still awaiting payment, so this is reversible in
 * the sense that no real transaction is ever destroyed.
 */
export async function deleteDraftOrder(draftId: string): Promise<void> {
  if (shopifyMode() === "snapshot" || draftId.startsWith("mock:")) return;

  const data = await adminGraphQL<{
    draftOrderDelete: {
      deletedId: string | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(
    `mutation($input: DraftOrderDeleteInput!) {
      draftOrderDelete(input: $input) {
        deletedId
        userErrors { field message }
      }
    }`,
    { input: { id: draftId } }
  );
  const errs = data.draftOrderDelete.userErrors;
  if (errs.length) {
    throw new Error(`draftOrderDelete failed: ${errs.map((e) => e.message).join("; ") || "unknown"}`);
  }
}
