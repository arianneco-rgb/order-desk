// Snapshot of the REAL Ritual Matcha Co. Shopify catalog (ritualmatcha.ph),
// pulled via the Shopify Admin API on 2026-07-02. Used when SHOPIFY_STORE /
// SHOPIFY_ADMIN_TOKEN are not set ("snapshot" mode) so the app runs with the
// store's actual variants, SKUs, and prices — without touching the live store.
//
// ⚠️ Prices here are a fallback snapshot only. In live mode prices ALWAYS
// come fresh from Shopify (the domain rule: never hardcode prices).

import type { CatalogProduct } from "./types";

export const CATALOG_SNAPSHOT_DATE = "2026-07-02";

export const CATALOG_SNAPSHOT: CatalogProduct[] = [
  {
    key: "kasane",
    title: "Kasane",
    aliases: ["kasane"],
    productId: "gid://shopify/Product/8221321822461",
    pouch: { variantId: "gid://shopify/ProductVariant/46477932462333", sku: "WHO-KAU-0200", price: 2350, title: "200g" },
    case: { variantId: "gid://shopify/ProductVariant/46477932495101", sku: "WHC-KAU-0200", price: 22000, title: "Case (10 x 200g)" },
    sample: { variantId: "gid://shopify/ProductVariant/46355440959741", sku: "SAM-KAU-0020", price: 200, title: "Kasane (20g)" },
  },
  {
    key: "mitsu",
    title: "Mitsu",
    aliases: ["mitsu", "sweetened kasane", "kasane sweetened"],
    productId: "gid://shopify/Product/8221322346749",
    pouch: { variantId: "gid://shopify/ProductVariant/46477931806973", sku: "WHO-KAS-0200", price: 715, title: "200g" },
    case: { variantId: "gid://shopify/ProductVariant/46477931839741", sku: "WHC-KAS-0200", price: 6800, title: "Case (10 x 200g)" },
    sample: { variantId: "gid://shopify/ProductVariant/46355440992509", sku: "SAM-KAS-0050", price: 200, title: "Mitsu (50g)" },
  },
  {
    key: "shiori",
    title: "Shiori",
    aliases: ["shiori"],
    productId: "gid://shopify/Product/8693015937277",
    pouch: { variantId: "gid://shopify/ProductVariant/45605456281853", sku: "WHO-SHR-0200", price: 1850, title: "200g" },
    case: { variantId: "gid://shopify/ProductVariant/45605456314621", sku: "WHC-SHR-0200", price: 18000, title: "Case (10 x 200g)" },
    sample: { variantId: "gid://shopify/ProductVariant/46355441025277", sku: "SAM-SHR-0020", price: 200, title: "Shiori (20g)" },
  },
  {
    key: "koyo",
    title: "Koyo Hojicha",
    aliases: ["koyo hojicha", "koyo", "hojicha", "dark roast hojicha", "houjicha"],
    productId: "gid://shopify/Product/8693024915709",
    pouch: { variantId: "gid://shopify/ProductVariant/46463092752637", sku: "WHO-KOY-0200", price: 1400, title: "200g" },
    case: { variantId: "gid://shopify/ProductVariant/46463092785405", sku: "WHC-KOY-0200", price: 13500, title: "Case (10x200g)" },
    kilo: { variantId: "gid://shopify/ProductVariant/47728229318909", sku: "WHO-KOY-1000", price: 6750, title: "1 kg" },
    sample: { variantId: "gid://shopify/ProductVariant/46355441058045", sku: "SAM-KOY-0020", price: 200, title: "Hojicha (20g)" },
  },
  {
    key: "shizu",
    title: "Shizu",
    aliases: ["shizu"],
    productId: "gid://shopify/Product/8894318936317",
    pouch: { variantId: "gid://shopify/ProductVariant/46477931380989", sku: "WHO-SHZ-0200", price: 1300, title: "200g" },
    case: { variantId: "gid://shopify/ProductVariant/46477931348221", sku: "WHC-SHZ-0200", price: 12500, title: "Case (10 x 200g)" },
    sample: { variantId: "gid://shopify/ProductVariant/46355441090813", sku: "SAM-SHZ-0020", price: 200, title: "Shizu (20g)" },
  },
  {
    key: "miyo",
    title: "Miyo",
    aliases: ["miyo"],
    productId: "gid://shopify/Product/8960209748221",
    pouch: { variantId: "gid://shopify/ProductVariant/46599187824893", sku: "WHO-KSH-0200", price: 1550, title: "200g" },
    case: { variantId: "gid://shopify/ProductVariant/46599187857661", sku: "WHC-KSH-0200", price: 15000, title: "Case (10 x 200g)" },
    sample: { variantId: "gid://shopify/ProductVariant/46567040844029", sku: "SAM-KSH-0020", price: 200, title: "Miyo (20g)" },
  },
  {
    key: "kinomi",
    title: "Kinomi",
    aliases: ["kinomi"],
    productId: "gid://shopify/Product/9070053654781",
    pouch: { variantId: "gid://shopify/ProductVariant/46927048737021", sku: "WHO-MAC-0200", price: 2000, title: "200g" },
    case: { variantId: "gid://shopify/ProductVariant/46927048769789", sku: "WHC-MAC-0200", price: 19000, title: "Case (10 x 200g)" },
    sample: { variantId: "gid://shopify/ProductVariant/46850604630269", sku: "SAM-MAC-0020", price: 200, title: "Kinomi (20g)" },
  },
  {
    key: "nagomi",
    title: "Nagomi",
    aliases: ["nagomi"],
    productId: "gid://shopify/Product/9154138145021",
    pouch: { variantId: "gid://shopify/ProductVariant/47233618477309", sku: "WHO-MAB-0200", price: 2550, title: "200g" },
    case: { variantId: "gid://shopify/ProductVariant/47233618510077", sku: "WHC-MAB-0200", price: 24000, title: "Case (10 x 200g)" },
    sample: { variantId: "gid://shopify/ProductVariant/46975711412477", sku: "SAM-MAB-0020", price: 200, title: "Nagomi (20g)" },
  },
  {
    key: "takumi",
    title: "Takumi",
    aliases: ["takumi"],
    productId: "gid://shopify/Product/9165505233149",
    pouch: { variantId: "gid://shopify/ProductVariant/47260848554237", sku: "WHO-TAK-0200", price: 3350, title: "200g" },
    case: { variantId: "gid://shopify/ProductVariant/47260848587005", sku: "WHC-TAK-0200", price: 31500, title: "Case (10 x 200g)" },
    sample: { variantId: "gid://shopify/ProductVariant/47225368019197", sku: "SAM-TAK-0020", price: 200, title: "Takumi (20g)" },
  },
  {
    key: "mori",
    title: "Mori",
    aliases: ["mori"],
    productId: "gid://shopify/Product/9298532466941",
    pouch: { variantId: "gid://shopify/ProductVariant/47622072008957", sku: "WHO-TOK-0200", price: 2200, title: "200g" },
    case: { variantId: "gid://shopify/ProductVariant/47622072041725", sku: "WHC-TOK-0200", price: 21000, title: "Case (10 x 200g)" },
    sample: { variantId: "gid://shopify/ProductVariant/47558100091133", sku: "SAM-TOK-0020", price: 200, title: "Mori (20g)" },
  },
  {
    key: "yasumi",
    title: "Yasumi",
    aliases: ["yasumi"],
    productId: "gid://shopify/Product/9325637959933",
    pouch: { variantId: "gid://shopify/ProductVariant/47756624494845", sku: "WHO-MAD-0200", price: 1300, title: "200g" },
    // ⚠️ Real store data: the case is priced ₱1,250 — LESS than one 200g pouch.
    // Almost certainly a data-entry error in Shopify (should be ~₱12,500?).
    // The app uses Shopify prices as-is but flags the anomaly for review.
    case: { variantId: "gid://shopify/ProductVariant/47756624527613", sku: "WHC-MAD-0200", price: 1250, title: "Case (10 x 200g)" },
    sample: { variantId: "gid://shopify/ProductVariant/47413378121981", sku: "SAM-MAD-0020", price: 200, title: "Yasumi (20g)" },
  },
  // Cafe-specific custom blends (200g pouches only — no case variant).
  {
    key: "coopers",
    title: "Custom Coopers Blend",
    aliases: ["coopers", "coopers blend", "custom coopers"],
    productId: "gid://shopify/Product/9001982165245",
    pouch: { variantId: "gid://shopify/ProductVariant/46926119108861", sku: "CUS-MAB-0200", price: 625, title: "200g" },
  },
  {
    key: "brothers",
    title: "Custom Brothers Sweetened Blend",
    aliases: ["brothers", "brothers blend", "brothers sweetened"],
    productId: "gid://shopify/Product/9046577676541",
    pouch: { variantId: "gid://shopify/ProductVariant/46851476947197", sku: "CUS-SHZ-0200", price: 590, title: "200g" },
  },
  {
    key: "abaca",
    title: "Custom Abaca Blend",
    aliases: ["abaca", "abaca blend"],
    productId: "gid://shopify/Product/9309777002749",
    pouch: { variantId: "gid://shopify/ProductVariant/47699491062013", sku: "CUS-KSS-0200", price: 750, title: "200g" },
  },
];
