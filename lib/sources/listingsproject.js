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

// Listing cards: the TITLE is the text of an <a href="/listings/{slug}">
// anchor ("See more" / "Read the full listing..." anchors share the slug and
// are skipped). Price ("$1,500/month"), availability dates, and
// "Neighborhood, Borough" text follow the anchor in the card body.
export function parseHtml(html) {
  const cards = new Map(); // slug -> { title, windowText }
  const re = /<a[^>]+href="\/listings\/([a-z0-9-]+)"[^>]*>([\s\S]{0,300}?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const slug = m[1];
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const existing = cards.get(slug);
    const isTitle = text.length > 12 && !/^(see more|read the full)/i.test(text);
    const win = html
      .slice(m.index, Math.min(html.length, m.index + 2200))
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    if (!existing) {
      cards.set(slug, { title: isTitle ? text : null, win });
    } else if (isTitle && !existing.title) {
      existing.title = text;
      existing.win = win;
    }
  }

  const out = [];
  for (const [slug, { title, win }] of cards) {
    const price = win.match(/\$\s?([\d,]{3,6})\s*\/?\s*(month|mo|week|wk|day|night)?/i);
    const text = `${title ?? ""} ${win}`;
    const t = text.toLowerCase();
    const beds = /\bstudio\b/.test(t)
      ? 0
      : (t.match(/\b([1-5])\s*(?:-?\s*)(?:bed(?:room)?s?|br|bd(?:rm)?)\b/) ?? [])[1];
    const hood = win.match(
      /([A-Z][A-Za-z' .-]{2,30}),\s*(Brooklyn|Manhattan|Queens|Bronx|Staten Island)/,
    );

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
      title: title ?? slug.replace(/-[a-f0-9-]{20,}$/, "").replace(/-/g, " "),
      price_monthly: priceMonthly,
      beds: beds === 0 ? 0 : beds ? parseInt(beds, 10) : null,
      baths: null,
      neighborhood: hood ? `${hood[1]}, ${hood[2]}` : null,
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
  const borough = (constraints.borough ?? "").toLowerCase();
  listings = listings.filter((l) => {
    if (constraints.max_price && l.price_monthly && l.price_monthly > constraints.max_price) return false;
    if (constraints.beds?.length && l.beds != null && !constraints.beds.includes(l.beds)) return false;
    if (hood) {
      const text = `${l.title} ${l.neighborhood ?? ""} ${l.description_snippet ?? ""}`.toLowerCase();
      // Neighborhood match preferred; same-borough listings kept as weaker
      // matches (LP is sparse — an exact-hood-only filter often returns 0).
      if (!text.includes(hood) && !(borough && (l.neighborhood ?? "").toLowerCase().includes(borough)))
        return false;
    }
    return true;
  });
  const deduped = [...new Map(listings.map((l) => [l.id, l])).values()];
  return { listings: deduped };
}
