// The Listings Project — tier-2, off-market/artist-community inventory.
// Free: public pages, no auth, no anti-bot (verified 2026-07-13). Weekly
// cadence, ~430 NYC listings, 12 per page at ?page=N.
const BASE = "https://www.listingsproject.com";

async function fetchPage(page) {
  const response = await fetch(`${BASE}/real-estate/new-york-city?page=${page}`, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; nycaptagent/0.1)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`listingsproject -> HTTP ${response.status}`);
  return response.text();
}

// Listing cards come through as anchors to /listings/{slug} with title,
// price, and location text nearby. Next.js also embeds JSON we can mine;
// prefer that when present, fall back to anchor harvesting.
export function parseHtml(html) {
  const out = [];
  const seen = new Set();

  // Attempt 1: embedded JSON (self.__next_f / __NEXT_DATA__ payloads)
  const jsonBlocks = html.match(/\{"[^"]*(?:listing|slug)[^"]*":[\s\S]{0,4000}?\}/g) ?? [];
  void jsonBlocks; // structure varies; anchor path below is the reliable one

  // Attempt 2: anchors
  const re = /href="\/listings\/([a-z0-9-]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const slug = m[1];
    if (seen.has(slug)) continue;
    seen.add(slug);
    const start = Math.max(0, m.index - 200);
    const end = Math.min(html.length, m.index + 1600);
    const win = html
      .slice(start, end)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");

    const price = win.match(/\$\s?([\d,]{3,6})\s*(?:\/|per\s*)?\s*(month|mo|week|wk|day|night)?/i);
    const beds = win.match(/\b(studio|[1-5])\s*(?:-?\s*)(?:bed(?:room)?s?|br)\b/i);
    const title = win.match(/([A-Z][^|<>{}$]{10,110}?)\s*\$/);

    let priceMonthly = null;
    if (price) {
      const n = parseInt(price[1].replace(/,/g, ""), 10);
      const unit = (price[2] ?? "month").toLowerCase();
      priceMonthly =
        unit.startsWith("w") ? n * 4 : unit.startsWith("d") || unit.startsWith("n") ? n * 30 : n;
    }

    out.push({
      id: `lp:${slug}`,
      source: "listingsproject",
      url: `${BASE}/listings/${slug}`,
      title: title ? title[1].trim() : slug.replace(/-/g, " "),
      price_monthly: priceMonthly,
      beds: beds ? (beds[1].toLowerCase() === "studio" ? 0 : parseInt(beds[1], 10)) : null,
      baths: null,
      neighborhood: null,
      address: null,
      posted_at: null,
      photo_urls: [],
      description_snippet: win.slice(0, 240),
    });
  }
  return out;
}

export async function searchListingsProject(constraints, { receipts }) {
  const pages = [1, 2, 3];
  const htmls = await Promise.allSettled(pages.map(fetchPage));
  let listings = [];
  for (const h of htmls) {
    if (h.status === "fulfilled") listings = listings.concat(parseHtml(h.value));
  }
  receipts.push({ service: "listingsproject", route: "/real-estate/new-york-city", usd: 0, tx: null });

  // LP inventory is city-wide and sparse; filter to constraints client-side.
  const hood = (constraints.neighborhood_name ?? "").toLowerCase();
  listings = listings.filter((l) => {
    if (constraints.max_price && l.price_monthly && l.price_monthly > constraints.max_price) return false;
    if (constraints.beds?.length && l.beds != null && !constraints.beds.includes(l.beds)) return false;
    if (hood) {
      const text = `${l.title} ${l.description_snippet ?? ""}`.toLowerCase();
      if (!text.includes(hood)) return false;
    }
    return true;
  });
  const deduped = [...new Map(listings.map((l) => [l.id, l])).values()];
  return { listings: deduped };
}
