import { extractTxHash } from "../payer.js";

// StreetEasy — tier-1 source. Direct fetch 403s; Firecrawl (via stableenrich,
// paid per call through the x402 payer) renders both search-results and
// listing pages cleanly. Verified empirically 2026-07-10: search page
// /for-rent/{hood}/price:-3500|beds:0-1 returns regular listing cards.
const ENRICH_BASE = process.env.STABLEENRICH_URL || "https://stableenrich.dev";
const FIRECRAWL_PRICE = 0.013;

export function buildSearchUrl(c) {
  const hood = c.neighborhood || "nyc";
  const filters = [];
  if (c.max_price) filters.push(`price:-${c.max_price}`);
  if (c.beds?.length) {
    const min = Math.min(...c.beds);
    const max = Math.max(...c.beds);
    filters.push(`beds:${min}-${max}`);
  }
  const path = filters.length ? `${hood}/${filters.join("%7C")}` : hood;
  return `https://streeteasy.com/for-rent/${path}`;
}

async function firecrawl(payer, url) {
  const response = await payer.fetch(`${ENRICH_BASE}/api/firecrawl/scrape`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!response.ok) {
    throw new Error(`stableenrich firecrawl -> HTTP ${response.status}`);
  }
  const tx = extractTxHash(response);
  const data = await response.json();
  return { content: data.content ?? "", tx };
}

// The search page markdown interleaves listing links, prices, and bd/ba
// bullets in a stable order. Anchor on listing URLs and harvest the fields
// that appear between one anchor and the next.
export function parseSearchMarkdown(md) {
  const listings = [];
  // Cards render as [Address #Unit](https://streeteasy.com/building/...) with
  // price and bd/ba lines FOLLOWING the link. Capture link+title together and
  // read fields only from the forward window, so a card can't inherit the
  // previous card's price.
  const linkRe =
    /\[([^\]]{4,110})\]\((https:\/\/streeteasy\.com\/(?:building|rental)\/[^)\s]+)\)/g;
  const anchors = [];
  let m;
  while ((m = linkRe.exec(md)) !== null) {
    anchors.push({ title: m[1].trim(), url: m[2], index: m.index + m[0].length });
  }
  if (anchors.length === 0) {
    // Bare-URL fallback (some render modes drop link syntax)
    const bareRe = /https:\/\/streeteasy\.com\/(?:building|rental)\/[^\s)"\]]+/g;
    while ((m = bareRe.exec(md)) !== null) {
      anchors.push({ title: null, url: m[0], index: m.index + m[0].length });
    }
  }
  const seen = new Set();
  for (let i = 0; i < anchors.length; i++) {
    const url = anchors[i].url.replace(/[.,]+$/, "");
    const key = url.split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);

    const end = anchors[i + 1]
      ? Math.min(anchors[i + 1].index, anchors[i].index + 500)
      : Math.min(md.length, anchors[i].index + 500);
    const win = md.slice(anchors[i].index, end);

    const price = win.match(/\$\s?([\d,]{4,6})(?!\d)/);
    const beds = win.match(/\bstudio\b/i)
      ? ["studio", "studio"]
      : win.match(/\b([1-6])\s*(?:bed|bd)/i);
    const baths = win.match(/([\d.]+)\s*(?:bath|ba)\b/i);

    if (!price) continue; // nav links, ads, building index links

    const title = anchors[i].title;
    listings.push({
      id: `se:${key.replace("https://streeteasy.com/", "")}`,
      source: "streeteasy",
      url: key,
      title: title ?? key.split("/").slice(-2).join(" #"),
      price_monthly: parseInt(price[1].replace(/,/g, ""), 10),
      beds: beds ? (beds[1].toLowerCase() === "studio" ? 0 : parseInt(beds[1], 10)) : null,
      baths: baths ? parseFloat(baths[1]) : null,
      neighborhood: null, // filled from the query context by the caller
      address: title,
      posted_at: null,
      photo_urls: [],
      description_snippet: null,
    });
  }
  return listings;
}

export async function searchStreetEasy(constraints, { payer, receipts }) {
  if (!payer) return { listings: [], skipped: "no payer configured" };
  const url = buildSearchUrl(constraints);
  const { content, tx } = await firecrawl(payer, url);
  receipts.push({ service: "stableenrich", route: "/api/firecrawl/scrape", usd: FIRECRAWL_PRICE, tx, target: url });
  const listings = parseSearchMarkdown(content).map((l) => ({
    ...l,
    neighborhood: constraints.neighborhood_name ?? null,
  }));
  return { listings, search_url: url };
}
