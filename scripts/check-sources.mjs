#!/usr/bin/env node
// Live connectivity probe for every data source. Run from a machine with
// open egress (laptop, or the deployed EigenCompute app) — NOT from a
// sandboxed coding-agent container: managed sandboxes allowlist egress and
// answer CONNECT with 403 for craigslist.org / listingsproject.com /
// stableenrich.dev / stablesocial.dev, which looks identical to a source
// block. A 403 here proves nothing until you rule the proxy out.
//
// Usage:  node scripts/check-sources.mjs
// Paid upstreams are probed unauthenticated — a 402 challenge means "alive
// and payable"; no payer key is needed or used.

import { parseHtml as parseCl } from "../lib/sources/craigslist.js";
import { parseHtml as parseLp } from "../lib/sources/listingsproject.js";

const UA = "Mozilla/5.0 (compatible; nycaptagent/0.1)";
const results = [];

async function probe(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (e) {
    results.push({ name, ok: false, detail: String(e.message ?? e).slice(0, 120) });
  }
}

async function get(url) {
  const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
  return { status: r.status, text: r.ok ? await r.text() : "" };
}

await probe("craigslist cat=apa (rentals)", async () => {
  const { status, text } = await get("https://www.craigslist.org/search/area/newyork?cat=apa");
  if (status !== 200) throw new Error(`HTTP ${status}`);
  const n = parseCl(text).length;
  if (n === 0) throw new Error("200 OK but 0 listings parsed — markup changed?");
  return `${n} listings parsed`;
});

await probe("craigslist cat=sub (sublets)", async () => {
  const { status, text } = await get("https://www.craigslist.org/search/area/newyork?cat=sub");
  if (status !== 200) throw new Error(`HTTP ${status}`);
  const n = parseCl(text).length;
  if (n === 0) throw new Error("200 OK but 0 listings parsed — markup changed?");
  return `${n} listings parsed`;
});

await probe("listingsproject", async () => {
  const { status, text } = await get("https://www.listingsproject.com/real-estate/new-york-city?page=1");
  if (status !== 200) throw new Error(`HTTP ${status}`);
  const n = parseLp(text).length;
  if (n === 0) throw new Error("200 OK but 0 listings parsed — markup changed?");
  return `${n} listings parsed`;
});

await probe("stableenrich (StreetEasy via Firecrawl)", async () => {
  const base = process.env.STABLEENRICH_URL || "https://stableenrich.dev";
  const r = await fetch(`${base}/api/firecrawl/scrape`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://streeteasy.com/for-rent/nyc" }),
    signal: AbortSignal.timeout(20000),
  });
  if (r.status === 402) return "402 challenge — alive, payable";
  throw new Error(`expected 402, got HTTP ${r.status}`);
});

await probe("stablesocial (FB Marketplace)", async () => {
  const base = process.env.STABLESOCIAL_URL || "https://stablesocial.dev";
  const r = await fetch(`${base}/api/sc/facebook/marketplace/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "apartment", lat: 40.73, lng: -73.99 }),
    signal: AbortSignal.timeout(20000),
  });
  if (r.status === 402) return "402 challenge — alive, payable";
  throw new Error(`expected 402, got HTTP ${r.status}`);
});

await probe("citibike GBFS", async () => {
  const r = await fetch("https://gbfs.lyft.com/gbfs/1.1/bkn/en/station_information.json", {
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  return `${data?.data?.stations?.length ?? 0} stations`;
});

let failed = 0;
for (const { name, ok, detail } of results) {
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${name.padEnd(42)} ${detail}`);
}
if (failed) {
  console.log(
    `\n${failed} source(s) failing. If EVERY probe fails with 403/CONNECT errors, you are behind an egress-allowlisted proxy — rerun from a machine with open egress before concluding a source is down.`,
  );
  process.exit(1);
}
console.log("\nAll sources reachable.");
