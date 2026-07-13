import { extractTxHash } from "../payer.js";

// Facebook Marketplace — via stablesocial (logged-out public data; Meta v.
// Bright Data 2024 upheld logged-out scraping). Private groups (Gypsy Housing
// tier) are deliberately OUT — login-walled, ToS/CFAA exposure.
//
// Schema verified empirically 2026-07-11. Gotchas honored here:
// - creation_time is ALWAYS null -> freshness must be caller-side ID diffing
// - custom_subtitles is a variable-length string array
// - cross-metro leakage -> filter location.state === "NY"
// - count is a hint, not a cap
const SOCIAL_BASE = process.env.STABLESOCIAL_URL || "https://stablesocial.dev";
const SEARCH_PRICE = 0.06;

export async function searchFacebookMarketplace(constraints, { payer, receipts, center }) {
  if (!payer) return { listings: [], skipped: "no payer configured" };

  const body = {
    query: constraints.beds?.includes(0) ? "studio apartment for rent" : "apartment for rent",
    lat: center.lat,
    lng: center.lng,
    radius_km: 6,
    count: 24,
    sort_by: "creation_time_descend",
    date_listed: "last_7_days",
    ...(constraints.max_price ? { max_price: constraints.max_price } : {}),
    min_price: 1200, // fewer scams/rooms below this in NYC
  };

  const response = await payer.fetch(`${SOCIAL_BASE}/api/sc/facebook/marketplace/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`stablesocial marketplace -> HTTP ${response.status}`);
  }
  const tx = extractTxHash(response);
  receipts.push({ service: "stablesocial", route: "/api/sc/facebook/marketplace/search", usd: SEARCH_PRICE, tx });

  const data = await response.json();
  const listings = (data.listings ?? [])
    .filter((l) => l.location?.state === "NY" && l.is_live !== false && l.is_sold !== true)
    .map((l) => ({
      id: `fb:${l.id}`,
      source: "facebook_marketplace",
      url: l.url,
      title: l.title,
      price_monthly: l.price?.amount ?? null,
      beds: guessBeds(l.title),
      baths: null,
      neighborhood: l.location?.city ?? null,
      address: Array.isArray(l.custom_subtitles) ? l.custom_subtitles.join(", ") : null,
      posted_at: null, // API returns null creation_time; diff by ID instead
      photo_urls: l.primary_photo?.url ? [l.primary_photo.url] : [],
      description_snippet: null,
    }));
  return { listings };
}

function guessBeds(title) {
  const t = String(title ?? "").toLowerCase();
  if (/\bstudio\b/.test(t)) return 0;
  const m = t.match(/\b([1-5])\s*(?:bed(?:room)?s?|br|bd)\b/);
  return m ? parseInt(m[1], 10) : null;
}
