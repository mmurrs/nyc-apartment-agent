import { parseQuery } from "./query.js";
import { refineConstraints, fitNotes } from "./llm.js";
import { nearestSubway, citibikeNear, neighborhoodBySlug, findNeighborhood } from "./geo.js";
import { searchStreetEasy } from "./sources/streeteasy.js";
import { searchListingsProject } from "./sources/listingsproject.js";
import { searchCraigslist } from "./sources/craigslist.js";
import { searchFacebookMarketplace } from "./sources/facebook.js";

const SOURCE_ADAPTERS = {
  streeteasy: searchStreetEasy,
  listingsproject: searchListingsProject,
  craigslist: searchCraigslist,
  facebook_marketplace: searchFacebookMarketplace,
};

export const DEFAULT_SOURCES = ["streeteasy", "listingsproject", "craigslist"];
export const ALL_SOURCES = Object.keys(SOURCE_ADAPTERS);

// Ranking: hard constraints already filtered; soft fit scored here.
// Price headroom + bed match + feature keyword hits + subway walk fit.
function scoreListing(l, c) {
  let score = 0;
  if (c.max_price && l.price_monthly) {
    const headroom = (c.max_price - l.price_monthly) / c.max_price;
    score += Math.max(0, Math.min(0.25, headroom)) * 40; // up to +10
  }
  if (c.beds?.length && l.beds != null && c.beds.includes(l.beds)) score += 15;
  if (l.beds == null) score -= 5; // unknown beds = riskier match
  const text = `${l.title} ${l.description_snippet ?? ""}`.toLowerCase();
  for (const f of c.features ?? []) {
    if (f === "natural_light" && /(sun|bright|light|south)/.test(text)) score += 8;
    else if (text.includes(f.replace(/_/g, " "))) score += 6;
  }
  for (const bad of c.must_avoid ?? []) {
    if (text.includes(String(bad).toLowerCase())) score -= 20;
  }
  if (l.nearest_subway?.[0]) {
    const walk = l.nearest_subway[0].walk_minutes;
    const cap = c.max_subway_walk_minutes ?? 15;
    if (walk <= cap) score += 10 - Math.min(9, Math.max(0, walk - 5));
    else score -= (walk - cap) * 2;
  }
  // Source trust: structured > semi-structured.
  score += { streeteasy: 6, listingsproject: 4, craigslist: 0, facebook_marketplace: 1 }[l.source] ?? 0;
  return Math.round(score * 10) / 10;
}

export async function runSearch({ query, sources, limit = 12, payer }) {
  const started = Date.now();
  const receipts = [];

  // 1. Parse constraints (deterministic always; LLM refinement when available)
  const deterministic = parseQuery(query);
  const refined = await refineConstraints(query, deterministic);
  const constraints = { ...deterministic, ...(refined ?? {}) };
  if (!constraints.neighborhood_name && refined?.neighborhood_name) {
    const hood = findNeighborhood(refined.neighborhood_name);
    if (hood) {
      constraints.neighborhood = hood.slug;
      constraints.neighborhood_name = hood.name;
      constraints.borough = hood.borough;
    }
  }

  // 2. Geo center for proximity work (neighborhood centroid, else Union Sq)
  const hood = constraints.neighborhood ? neighborhoodBySlug(constraints.neighborhood) : null;
  const center = hood ? { lat: hood.lat, lng: hood.lng } : { lat: 40.7359, lng: -73.9911 };

  // 3. Fan out to sources; one source failing must not kill the search.
  const wanted = (sources?.length ? sources : DEFAULT_SOURCES).filter((s) => SOURCE_ADAPTERS[s]);
  const settled = await Promise.allSettled(
    wanted.map((s) => SOURCE_ADAPTERS[s](constraints, { payer, receipts, center })),
  );
  const sourceReport = {};
  let listings = [];
  settled.forEach((r, i) => {
    const name = wanted[i];
    if (r.status === "fulfilled") {
      sourceReport[name] = r.value.skipped
        ? { status: "skipped", reason: r.value.skipped }
        : { status: "ok", count: r.value.listings.length };
      listings = listings.concat(r.value.listings);
    } else {
      sourceReport[name] = { status: "error", reason: String(r.reason?.message ?? r.reason).slice(0, 200) };
    }
  });

  // 4. Hard filters (price cap can still be violated by parse noise)
  listings = listings.filter(
    (l) => !constraints.max_price || !l.price_monthly || l.price_monthly <= constraints.max_price,
  );
  if (constraints.beds?.length) {
    listings = listings.filter((l) => l.beds == null || constraints.beds.includes(l.beds));
  }

  // 5. Proximity enrichment from the neighborhood centroid. Listing-level
  //    geocoding is v2; centroid distance is honest for same-neighborhood
  //    results and flagged as approximate in the response.
  const subway = nearestSubway(center.lat, center.lng, 3);
  let citibike = null;
  if (constraints.citibike_nearby) {
    try {
      citibike = await citibikeNear(center.lat, center.lng, 3);
    } catch {
      citibike = null;
    }
  }
  for (const l of listings) {
    l.nearest_subway = subway;
    if (citibike) l.nearest_citibike = citibike;
  }

  // 6. Rank, cap, annotate
  for (const l of listings) l.fit_score = scoreListing(l, constraints);
  listings.sort((a, b) => b.fit_score - a.fit_score);
  listings = listings.slice(0, Math.min(limit, 25));

  const notes = await fitNotes(query, listings);
  if (notes) listings.forEach((l, i) => (l.fit_note = notes[i]));

  const costUsd = receipts.reduce((s, r) => s + r.usd, 0);
  return {
    query: constraints.raw,
    constraints,
    proximity_basis: hood
      ? `${hood.name} centroid — listing-level distances are approximate`
      : "Union Square default centroid",
    results: listings,
    sources: sourceReport,
    receipts,
    cost_usd: Math.round(costUsd * 1000) / 1000,
    took_ms: Date.now() - started,
  };
}

export function diffAgainstSeen(results, lastSeenIds) {
  if (!Array.isArray(lastSeenIds) || lastSeenIds.length === 0) {
    return { new_listings: results, returning: [] };
  }
  const seen = new Set(lastSeenIds.map(String));
  const fresh = [];
  const returning = [];
  for (const l of results) (seen.has(l.id) ? returning : fresh).push(l);
  return { new_listings: fresh, returning };
}
