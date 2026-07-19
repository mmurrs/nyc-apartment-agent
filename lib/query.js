import { findNeighborhood } from "./geo.js";

// Deterministic NL constraint parser. The LLM path (lib/llm.js) refines this
// when a gateway is configured; this must always work so the API never
// hard-fails on missing LLM credentials.
//
// Handles queries like:
//   "1 bed or studio in East Village, 15 min walk to the train,
//    citibike nearby, lots of natural light, under $3500"

const FEATURE_KEYWORDS = {
  natural_light: [
    "natural light", "sunny", "sunlit", "bright", "light-filled",
    "south-facing", "southern exposure", "floor-to-ceiling", "oversized window",
    "corner unit", "tons of light", "great light", "big windows", "lots of light",
  ],
  laundry: ["laundry", "washer", "dryer", "w/d"],
  dishwasher: ["dishwasher"],
  outdoor_space: ["balcony", "terrace", "roof", "backyard", "patio", "outdoor space", "garden"],
  pets: ["pet friendly", "pets allowed", "dog friendly", "cat friendly", "pets ok", "dogs ok", "cats ok"],
  doorman: ["doorman"],
  elevator: ["elevator"],
  gym: ["gym", "fitness"],
  renovated: ["renovated", "gut renovated", "brand new", "new kitchen", "new bathroom"],
  exposed_brick: ["exposed brick"],
  hardwood: ["hardwood"],
  quiet: ["quiet", "tree-lined"],
  no_fee: ["no fee", "no-fee", "no broker fee"],
  furnished: ["furnished"],
};

function parseSublet(t) {
  // "sublet"/"sublease"/"short term"/"temporary" flips sources into sublet
  // mode (e.g. Craigslist cat=sub). "3 month sublet", "for 6 months",
  // "summer sublet" also carry an approximate duration.
  const keyword =
    /\bsub-?let(?:ting)?s?\b|\bsub-?lease\b|\bshort[- ]term\b|\btemporary\b|\btemp housing\b/.test(t) ||
    /\b(?:summer|winter|spring|fall) (?:housing|rental|stay|sublet)\b/.test(t);
  let months = null;
  const m = t.match(/\b(?:for\s+)?(\d{1,2})\s*(?:-\s*)?months?\b/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 12) months = n;
  } else if (keyword && /\bsummer\b/.test(t)) months = 3;
  // A stated stay of ≤6 months implies a sublet even without the keyword;
  // 7-12 months reads as a normal lease term.
  return { sublet: keyword || (months != null && months <= 6), months };
}

function parseBeds(t) {
  const beds = new Set();
  if (/\bstudio\b/.test(t)) beds.add(0);
  const m = t.match(/\b([1-4])\s*(?:-?\s*)?(?:bed(?:room)?s?|br|bd)\b/g);
  if (m) for (const s of m) beds.add(parseInt(s, 10));
  if (/\bone\s*bed/.test(t)) beds.add(1);
  if (/\btwo\s*bed/.test(t)) beds.add(2);
  if (/\bthree\s*bed/.test(t)) beds.add(3);
  return beds.size ? [...beds].sort() : null;
}

function parsePrice(t) {
  // "under $3500", "max 3500", "$3,500 max", "up to 3500", "budget 3500", "<$3500"
  const m =
    t.match(/(?:under|below|max(?:imum)?|up\s+to|budget(?:\s+of)?|<=?)\s*\$?\s*(\d[\d,]{0,5})\s*(k?)\b/) ??
    t.match(/\$\s*(\d[\d,]{0,5})\s*(k?)\b\s*(?:max|or\s+less|budget|\/mo)?/);
  if (!m) return null;
  let n = parseInt(m[1].replace(/,/g, ""), 10);
  if (m[2] === "k") n *= 1000;
  // Bare small numbers like "under 4" are ambiguous; require plausible rent.
  return n >= 500 && n <= 50000 ? n : null;
}

function parseWalk(t) {
  // "15 minute walk to the train/subway", "close to the subway", "near the L"
  const m = t.match(
    /(\d{1,2})\s*(?:-?\s*)?min(?:ute)?s?\s*(?:walk\s*)?(?:to|from)\s*(?:the\s*)?(?:train|subway|station)/,
  );
  if (m) return parseInt(m[1], 10);
  if (/(?:close|near|walkable)\s+(?:to\s+)?(?:the\s+)?(?:train|subway)/.test(t)) return 10;
  return null;
}

function parseLines(t) {
  // "near the L", "on the 6 train", "A/C/E access"
  const lines = new Set();
  const single = t.match(/\b(?:the|on|near)\s+([a-z1-7])\s+train\b/g);
  if (single) for (const s of single) lines.add(s.replace(/.*\s([a-z1-7])\s.*/, "$1").toUpperCase());
  const grouped = t.match(/\b([a-z1-7](?:\/[a-z1-7]){1,4})\b\s*(?:train|access|line)/);
  if (grouped) for (const l of grouped[1].split("/")) lines.add(l.toUpperCase());
  return lines.size ? [...lines] : null;
}

export function parseQuery(text) {
  const t = String(text ?? "").toLowerCase();
  const hood = findNeighborhood(t);
  const features = [];
  for (const [key, words] of Object.entries(FEATURE_KEYWORDS)) {
    if (words.some((w) => t.includes(w))) features.push(key);
  }
  const wantsCitibike = /citi\s?bike|bike\s?share|bikeshare/.test(t);
  const { sublet, months } = parseSublet(t);

  return {
    raw: String(text ?? ""),
    neighborhood: hood ? hood.slug : null,
    neighborhood_name: hood ? hood.name : null,
    borough: hood ? hood.borough : null,
    beds: parseBeds(t),
    max_price: parsePrice(t),
    max_subway_walk_minutes: parseWalk(t),
    subway_lines: parseLines(t),
    citibike_nearby: wantsCitibike,
    sublet,
    duration_months: months,
    features,
    parser: "deterministic",
  };
}

export { FEATURE_KEYWORDS };
