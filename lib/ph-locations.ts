// PH city → province lookup for deriving Shopify address fields from a
// pasted "Delivery Address with barangay" line (feedback round 4). Shopify's
// PH address "province" dropdown uses these exact province names (Metro
// Manila cities all map to "Metro Manila"). Not exhaustive — covers every
// city seen in the wholesale customer list plus the major PH cities; anything
// unmatched is simply flagged for manual entry, never guessed.

export interface PhLocation {
  city: string;
  province: string;
}

const METRO_MANILA_CITIES = [
  "Caloocan", "Las Piñas", "Makati", "Malabon", "Mandaluyong", "Manila",
  "Marikina", "Muntinlupa", "Navotas", "Parañaque", "Pasay", "Pasig",
  "Pateros", "Quezon City", "San Juan", "Taguig", "Valenzuela",
];

const CITY_PROVINCE: Record<string, string> = {
  // Bulacan
  "Pulilan": "Bulacan", "Bocaue": "Bulacan", "Malolos": "Bulacan",
  "Meycauayan": "Bulacan", "San Jose del Monte": "Bulacan", "Baliuag": "Bulacan",
  // Cavite
  "Bacoor": "Cavite", "Imus": "Cavite", "Silang": "Cavite", "Tagaytay": "Cavite",
  "General Trias": "Cavite", "Dasmariñas": "Cavite", "Kawit": "Cavite",
  // Laguna
  "San Pedro": "Laguna", "Calamba": "Laguna", "Santa Rosa": "Laguna",
  "Biñan": "Laguna", "Cabuyao": "Laguna", "Los Baños": "Laguna",
  // Rizal
  "Antipolo": "Rizal", "Teresa": "Rizal", "Cainta": "Rizal", "Taytay": "Rizal",
  "Binangonan": "Rizal", "Angono": "Rizal",
  // Batangas
  "Lipa": "Batangas", "Batangas City": "Batangas", "Santo Tomas": "Batangas",
  "Tanauan": "Batangas",
  // Pampanga
  "Angeles": "Pampanga", "San Fernando": "Pampanga", "Mabalacat": "Pampanga",
  // Zambales / Subic
  "Olongapo": "Zambales", "Subic": "Zambales", "Subic Bay Freeport Zone": "Zambales",
  // Nueva Ecija
  "Cabanatuan": "Nueva Ecija", "San Jose City": "Nueva Ecija", "Gapan": "Nueva Ecija",
  // Pangasinan
  "Bayambang": "Pangasinan", "Dagupan": "Pangasinan", "Urdaneta": "Pangasinan",
  // Isabela
  "Santiago": "Isabela", "Ilagan": "Isabela", "Cauayan": "Isabela",
  // Benguet / North Luzon
  "Baguio": "Benguet", "La Trinidad": "Benguet", "Vigan": "Ilocos Sur",
  "Laoag": "Ilocos Norte", "Tuguegarao": "Cagayan",
  // Quezon province
  "Lucena": "Quezon", "Tayabas": "Quezon",
  // Bicol
  "Naga": "Camarines Sur", "Legazpi": "Albay", "Sorsogon City": "Sorsogon",
  // Cebu
  "Cebu City": "Cebu", "Minglanilla": "Cebu", "Mandaue": "Cebu",
  "Lapu-Lapu": "Cebu", "Talisay": "Cebu", "Dalaguete": "Cebu", "Toledo": "Cebu",
  // Rest of Visayas
  "Iloilo City": "Iloilo", "Cabatuan": "Iloilo", "Bacolod": "Negros Occidental",
  "Dumaguete": "Negros Oriental", "Tacloban": "Leyte", "Ormoc": "Leyte",
  "Tagbilaran": "Bohol", "Roxas City": "Capiz", "Kalibo": "Aklan",
  "Boracay": "Aklan", "Malay": "Aklan",
  // Mindanao
  "Davao City": "Davao del Sur", "Cagayan de Oro": "Misamis Oriental",
  "Iligan": "Lanao del Norte", "Zamboanga City": "Zamboanga del Sur",
  "Molave": "Zamboanga del Sur", "General Santos": "South Cotabato",
  "Butuan": "Agusan del Norte", "General Luna": "Surigao del Norte",
  "Surigao City": "Surigao del Norte", "Kidapawan": "Cotabato",
  // Palawan / islands
  "Puerto Princesa": "Palawan", "El Nido": "Palawan", "Coron": "Palawan",
};

interface CityEntry extends PhLocation {
  /** Lowercased needle used for matching inside a free-text address. */
  needle: string;
}

const CITY_ENTRIES: CityEntry[] = [
  ...METRO_MANILA_CITIES.map((city) => ({ city, province: "Metro Manila", needle: city.toLowerCase() })),
  // Common unaccented spellings people actually type.
  { city: "Parañaque", province: "Metro Manila", needle: "paranaque" },
  { city: "Las Piñas", province: "Metro Manila", needle: "las pinas" },
  { city: "Quezon City", province: "Metro Manila", needle: "qc" },
  ...Object.entries(CITY_PROVINCE).map(([city, province]) => ({ city, province, needle: city.toLowerCase() })),
  { city: "Dasmariñas", province: "Cavite", needle: "dasmarinas" },
  { city: "Biñan", province: "Laguna", needle: "binan" },
].sort((a, b) => b.needle.length - a.needle.length); // longest match wins ("Cebu City" before "Cebu")

/**
 * Find the most specific known PH city mentioned in a free-text address.
 * Word-boundary matched; longest city name wins. Returns undefined when
 * nothing matches — the UI flags city/province for manual entry instead.
 */
export function findPhLocation(text: string): PhLocation | undefined {
  const hay = ` ${text.toLowerCase().replace(/[.,;()]/g, " ").replace(/\s+/g, " ")} `;
  for (const entry of CITY_ENTRIES) {
    if (hay.includes(` ${entry.needle} `)) return { city: entry.city, province: entry.province };
  }
  return undefined;
}

/** Shopify PH "province" options the UI offers as suggestions. */
export const PH_PROVINCES: string[] = Array.from(
  new Set(["Metro Manila", ...Object.values(CITY_PROVINCE)])
).sort();
