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

// The no-JS fallback list renders as:
//   <li class="cl-static-search-result" title="...">
//     <a href="https://www.craigslist.org/view/d/{slug}/{hash}">
//       <div class="title">...</div>
//       <div class="price">$5,200</div>
//       <div class="location"> Long Island </div>
// The trailing hash is the stable post id.
export function parseHtml(html) {
  const out = [];
  const seen = new Set();
  const liRe = /<li class="cl-static-search-result"[\s\S]*?<\/li>/g;
  let m;
  while ((m = liRe.exec(html)) !== null) {
    const li = m[0];
    const link = li.match(/href="([^"]+\/view\/d\/[^"]+\/([A-Za-z0-9_-]{8,}))"/);
    if (!link) continue;
    const [, url, id] = link;
    if (seen.has(id)) continue;
    seen.add(id);
    const rawTitle = li.match(/<div class="title">([\s\S]*?)<\/div>/)?.[1] ?? "";
    const rawPrice = li.match(/<div class="price">\s*\$?\s*([\d,]+)/)?.[1] ?? null;
    const rawLoc = li.match(/<div class="location">([\s\S]*?)<\/div>/)?.[1] ?? null;
    const title = decodeEntities(rawTitle).trim();
    const location = rawLoc ? decodeEntities(rawLoc).trim() : null;
    const t = title.toLowerCase();
    const beds = /\bstudio\b/.test(t)
      ? 0
      : (t.match(/\b([1-5])\s*(?:-?\s*)(?:br|bed(?:room)?s?|bd)\b/) ?? [])[1];

    out.push({
      id: `cl:${id}`,
      source: "craigslist",
      url,
      title,
      price_monthly: rawPrice ? parseInt(rawPrice.replace(/,/g, ""), 10) : null,
      beds: beds === 0 ? 0 : beds ? parseInt(beds, 10) : null,
      baths: null,
      neighborhood: location,
      address: null,
      posted_at: null,
      photo_urls: [],
      description_snippet: null,
    });
  }
  return out;
}

function decodeEntities(s) {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ");
}

// cat=apa is "apts / housing for rent"; cat=sub is "sublets & temporary".
// Sublet queries search BOTH — plenty of sublets get posted under apa.
export function pickCategories(constraints) {
  return constraints.sublet ? ["sub", "apa"] : ["apa"];
}

export async function searchCraigslist(constraints, { receipts }) {
  const cats = pickCategories(constraints);
  const settled = await Promise.allSettled(cats.map(fetchSearch));
  const htmls = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      htmls.push(r.value);
      receipts.push({ service: "craigslist", route: `/search/area/newyork?cat=${cats[i]}`, usd: 0, tx: null });
    }
  });
  if (htmls.length === 0) throw settled[0].reason ?? new Error("craigslist -> all categories failed");
  const hood = (constraints.neighborhood_name ?? "").toLowerCase();
  const byId = new Map();
  for (const html of htmls) for (const l of parseHtml(html)) byId.set(l.id, l);
  let listings = [...byId.values()];
  listings = listings.filter((l) => {
    if (constraints.max_price && l.price_monthly > constraints.max_price) return false;
    if (constraints.beds?.length && l.beds != null && !constraints.beds.includes(l.beds)) return false;
    if (hood) {
      const text = `${l.title} ${l.neighborhood ?? ""}`.toLowerCase();
      if (!text.includes(hood)) return false;
    }
    return true;
  });
  return { listings };
}
