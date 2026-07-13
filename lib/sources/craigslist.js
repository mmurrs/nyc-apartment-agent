// Craigslist NYC — free, but with the 2026 URL migration: the old
// newyork.craigslist.org/search/... 403s and RSS is dead. The canonical
// route is www.craigslist.org/search/area/newyork?cat=apa which returns a
// hydrated page (~350 newest listings). Verified 2026-07-13.
const BASE = "https://www.craigslist.org";

async function fetchSearch(cat) {
  const response = await fetch(`${BASE}/search/area/newyork?cat=${cat}`, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; nycaptagent/0.1)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`craigslist -> HTTP ${response.status}`);
  return response.text();
}

export function parseHtml(html) {
  const out = [];
  const seen = new Set();
  // Cards anchor on /view/d/{slug}/{id}.html style detail links.
  const re = /href="(https?:\/\/[^"]*craigslist\.org[^"]*\/(\d{10})[^"]*|\/view\/d\/[^"]+\/(\d{10})[^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = m[2] ?? m[3];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const url = m[1].startsWith("http") ? m[1] : `${BASE}${m[1]}`;
    const start = Math.max(0, m.index - 300);
    const end = Math.min(html.length, m.index + 1200);
    const win = html
      .slice(start, end)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");

    const price = win.match(/\$\s?([\d,]{3,6})(?!\d)/);
    const beds = win.match(/\b(studio|[1-5])\s*(?:-?\s*)(?:br|bed(?:room)?s?)\b/i);
    const titleM = win.match(/([A-Za-z][^$<>{}]{12,110}?)\s*\$/);

    if (!price) continue;

    out.push({
      id: `cl:${id}`,
      source: "craigslist",
      url,
      title: titleM ? titleM[1].trim() : `craigslist ${id}`,
      price_monthly: parseInt(price[1].replace(/,/g, ""), 10),
      beds: beds ? (beds[1].toLowerCase() === "studio" ? 0 : parseInt(beds[1], 10)) : null,
      baths: null,
      neighborhood: null,
      address: null,
      posted_at: null,
      photo_urls: [],
      description_snippet: win.slice(0, 200),
    });
  }
  return out;
}

export async function searchCraigslist(constraints, { receipts }) {
  const cat = constraints.beds?.includes(0) ? "apa" : "apa"; // sublets: cat=sub, v2
  const html = await fetchSearch(cat);
  receipts.push({ service: "craigslist", route: `/search/area/newyork?cat=${cat}`, usd: 0, tx: null });

  const hood = (constraints.neighborhood_name ?? "").toLowerCase();
  let listings = parseHtml(html);
  listings = listings.filter((l) => {
    if (constraints.max_price && l.price_monthly > constraints.max_price) return false;
    if (constraints.beds?.length && l.beds != null && !constraints.beds.includes(l.beds)) return false;
    if (hood) {
      const text = `${l.title} ${l.description_snippet ?? ""}`.toLowerCase();
      if (!text.includes(hood)) return false;
    }
    return true;
  });
  return { listings };
}
