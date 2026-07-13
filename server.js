import { pathToFileURL } from "node:url";
import express from "express";
import { createDual402, dualDiscovery } from "dual402";
import { createPayer } from "./lib/payer.js";
import { runSearch, diffAgainstSeen, DEFAULT_SOURCES, ALL_SOURCES } from "./lib/search.js";
import { llmAvailable } from "./lib/llm.js";

export const app = express();
const PORT = process.env.PORT || 8080;

app.set("trust proxy", true);
app.use(express.json({ limit: "32kb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "WWW-Authenticate, Payment-Receipt, PAYMENT-REQUIRED, PAYMENT-RESPONSE",
  );
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const RECIPIENT = process.env.RECIPIENT_WALLET;

let dual;
try {
  dual = createDual402({
    mpp: {
      currency: process.env.USDC_TEMPO,
      recipient: process.env.MPP_RECIPIENT || RECIPIENT,
      secretKey: process.env.MPP_SECRET_KEY,
      realm: process.env.MPP_REALM,
      testnet: process.env.MPP_TESTNET === "true",
    },
    x402: {
      payTo: process.env.X402_PAYEE_ADDRESS || RECIPIENT,
      network: process.env.X402_NETWORK || "eip155:8453",
      facilitatorUrl:
        process.env.X402_FACILITATOR_URL ||
        "https://api.cdp.coinbase.com/platform/v2/x402",
      cdpAuth:
        process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET
          ? {
              apiKeyId: process.env.CDP_API_KEY_ID,
              apiKeySecret: process.env.CDP_API_KEY_SECRET,
            }
          : undefined,
    },
  });
} catch (err) {
  console.error(`[BOOT] FATAL: ${err.message}`);
  process.exit(1);
}

// Outbound payer: buys Firecrawl (stableenrich) and FB Marketplace
// (stablesocial) per search. Without it, paid sources are skipped and the
// free sources (listingsproject, craigslist) still work.
const payer = process.env.PAYER_PRIVATE_KEY
  ? createPayer({ privateKey: process.env.PAYER_PRIVATE_KEY })
  : null;

// Pricing: $0.10 covers worst-case upstream spend (one Firecrawl ~$0.013 +
// one FB search $0.06) plus margin. Free-source-only searches are pure margin.
const SEARCH_PRICE = "0.10";
const REPORT_PRICE = "0.10";

const chargeSearch = dual.charge({
  amount: SEARCH_PRICE,
  description:
    "Natural-language NYC apartment search across StreetEasy, The Listings Project, Craigslist, and optionally Facebook Marketplace. Returns ranked listings with subway and Citi Bike proximity.",
});
const chargeReport = dual.charge({
  amount: REPORT_PRICE,
  description:
    "Diff-based NYC apartment report: same search, but returns only listings not in last_seen_ids. Caller owns state; ideal for a morning-report loop.",
});

const searchInputSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description:
        "Natural-language constraints, e.g. '1 bed or studio in East Village under $3500, 15 min walk to the train, citibike nearby, lots of natural light'",
    },
    sources: {
      type: "array",
      items: { type: "string", enum: ALL_SOURCES },
      description: `Sources to query. Default: ${DEFAULT_SOURCES.join(", ")}. facebook_marketplace is opt-in (adds upstream cost).`,
    },
    limit: { type: "integer", minimum: 1, maximum: 25, description: "Max results (default 12)" },
  },
  required: ["query"],
  additionalProperties: false,
};

const listingSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "Stable listing id, e.g. se:building/146-1-avenue-new_york/4d" },
    source: { type: "string" },
    url: { type: "string" },
    title: { type: "string" },
    price_monthly: { type: ["number", "null"] },
    beds: { type: ["number", "null"], description: "0 = studio" },
    baths: { type: ["number", "null"] },
    neighborhood: { type: ["string", "null"] },
    address: { type: ["string", "null"] },
    fit_score: { type: "number" },
    fit_note: { type: ["string", "null"] },
    nearest_subway: { type: "array", items: { type: "object" } },
    nearest_citibike: { type: "array", items: { type: "object" } },
  },
};

const searchOutputSchema = {
  type: "object",
  properties: {
    query: { type: "string" },
    constraints: { type: "object", description: "Parsed constraints the ranking used" },
    proximity_basis: { type: "string" },
    results: { type: "array", items: listingSchema },
    sources: { type: "object", description: "Per-source status: ok/skipped/error + counts" },
    receipts: {
      type: "array",
      items: { type: "object" },
      description: "Upstream paid calls this search made (service, route, usd, tx)",
    },
    cost_usd: { type: "number", description: "Upstream spend incurred serving this request" },
    took_ms: { type: "number" },
  },
  required: ["query", "results", "sources"],
};

const reportInputSchema = {
  type: "object",
  properties: {
    ...searchInputSchema.properties,
    last_seen_ids: {
      type: "array",
      items: { type: "string" },
      description:
        "Listing ids from previous runs. Response returns only listings NOT in this set. Pass [] on first run.",
    },
  },
  required: ["query"],
  additionalProperties: false,
};

const reportOutputSchema = {
  type: "object",
  properties: {
    ...searchOutputSchema.properties,
    new_listings: { type: "array", items: listingSchema },
    returning_count: { type: "integer" },
    all_ids: {
      type: "array",
      items: { type: "string" },
      description: "Every id seen this run -- persist and pass back as last_seen_ids next time",
    },
  },
  required: ["query", "new_listings", "all_ids"],
};

async function handleSearch(req, res) {
  const body = req.method === "POST" ? (req.body ?? {}) : req.query;
  const query = String(body.query ?? "").trim();
  if (!query || query.length > 800) {
    return res.status(400).json({ error: "query is required (1-800 chars)" });
  }
  const sources = Array.isArray(body.sources) ? body.sources : undefined;
  const limit = Number.isInteger(+body.limit) && +body.limit > 0 ? +body.limit : 12;
  try {
    const out = await runSearch({ query, sources, limit, payer });
    res.json(out);
  } catch (err) {
    console.error(`[SEARCH] error: ${err.message}`);
    res.status(502).json({ error: "search failed", detail: String(err.message).slice(0, 200) });
  }
}

async function handleReport(req, res) {
  const body = req.body ?? {};
  const query = String(body.query ?? "").trim();
  if (!query || query.length > 800) {
    return res.status(400).json({ error: "query is required (1-800 chars)" });
  }
  const lastSeen = Array.isArray(body.last_seen_ids) ? body.last_seen_ids.slice(0, 2000) : [];
  const sources = Array.isArray(body.sources) ? body.sources : undefined;
  const limit = Number.isInteger(+body.limit) && +body.limit > 0 ? +body.limit : 12;
  try {
    const out = await runSearch({ query, sources, limit, payer });
    const { new_listings, returning } = diffAgainstSeen(out.results, lastSeen);
    res.json({
      ...out,
      results: undefined,
      new_listings,
      returning_count: returning.length,
      all_ids: out.results.map((l) => l.id),
    });
  } catch (err) {
    console.error(`[REPORT] error: ${err.message}`);
    res.status(502).json({ error: "report failed", detail: String(err.message).slice(0, 200) });
  }
}

app.post("/search", chargeSearch, handleSearch);
app.get("/search", chargeSearch, handleSearch);
app.post("/report", chargeReport, handleReport);

app.get("/", (req, res) => {
  res.json({
    service: process.env.SERVICE_NAME || "nyc-apartment-agent",
    what: "Natural-language NYC apartment search across StreetEasy, The Listings Project, Craigslist, and Facebook Marketplace (opt-in). Paid per request via x402 or MPP.",
    docs: "/openapi.json",
    x402: "/.well-known/x402",
    verify: "/verify",
    example: {
      method: "POST",
      path: "/search",
      body: {
        query:
          "1 bed or studio in East Village under $3500, 15 min walk to the train, citibike nearby, natural light",
      },
    },
  });
});

app.get("/healthz", async (req, res) => {
  res.json({
    ok: true,
    payer: payer ? payer.address : null,
    llm: await llmAvailable(),
    default_sources: DEFAULT_SOURCES,
  });
});

app.get("/verify", (req, res) => {
  res.json({
    service: {
      name: process.env.SERVICE_NAME || "nyc-apartment-agent",
      version: process.env.SERVICE_VERSION || "0.1.0",
    },
    code: {
      commit: process.env.GIT_SHA || "unknown",
      built_at: process.env.BUILD_TIME || "unknown",
      repo: process.env.REPO_URL || null,
    },
    runtime: {
      app_id: process.env.APP_ID || null,
      environment: process.env.ENVIRONMENT || null,
    },
    payment: {
      x402: {
        network: process.env.X402_NETWORK || "eip155:8453",
        facilitator: new URL(
          process.env.X402_FACILITATOR_URL ||
            "https://api.cdp.coinbase.com/platform/v2/x402",
        ).host,
        payee: process.env.X402_PAYEE_ADDRESS || RECIPIENT || null,
      },
      mpp: {
        rail: "tempo",
        payee: process.env.MPP_RECIPIENT || RECIPIENT || null,
      },
    },
    framework: { name: "dual402", homepage: "https://github.com/mmurrs/dual402" },
  });
});

dualDiscovery(app, dual, {
  info: {
    title: process.env.SERVICE_NAME || "nyc-apartment-agent",
    version: process.env.SERVICE_VERSION || "0.1.0",
    description:
      "NYC apartment hunting for agents and personal workflows. Natural-language constraints in, ranked fresh listings out -- aggregated across StreetEasy, The Listings Project, Craigslist, and Facebook Marketplace (opt-in). Subway walk times and Citi Bike availability included.",
    "x-guidance":
      "POST /search with { query } for a one-shot search. POST /report with { query, last_seen_ids } for a diff-based watch loop (morning report): persist all_ids from each response and pass them back next run. Expect 402 until payment attached.",
  },
  routes: [
    {
      method: "post",
      path: "/search",
      handler: chargeSearch,
      operationId: "searchApartments",
      tags: ["search"],
      summary: "NL apartment search (canonical POST)",
      description:
        "POST /search with { query, sources?, limit? }. Parses natural-language constraints, fans out to listing sources, returns ranked matches with proximity data. 0.10 USDC.",
      requestBodySchema: searchInputSchema,
      responseSchema: searchOutputSchema,
    },
    {
      method: "get",
      path: "/search",
      handler: chargeSearch,
      operationId: "searchApartmentsGet",
      tags: ["search"],
      summary: "NL apartment search (GET alias for curl/browsers)",
      description: "GET /search?query=... -- query-string alias of POST /search.",
      parameters: [
        {
          name: "query",
          in: "query",
          required: true,
          schema: { type: "string" },
          description: "Natural-language constraints",
        },
        {
          name: "limit",
          in: "query",
          required: false,
          schema: { type: "integer" },
          description: "Max results (default 12)",
        },
      ],
      responseSchema: searchOutputSchema,
    },
    {
      method: "post",
      path: "/report",
      handler: chargeReport,
      operationId: "reportNewApartments",
      tags: ["report"],
      summary: "Diff-based new-listings report (watch loop)",
      description:
        "POST /report with { query, last_seen_ids }. Runs the same search but returns only listings not already seen. Persist all_ids between runs. 0.10 USDC.",
      requestBodySchema: reportInputSchema,
      responseSchema: reportOutputSchema,
    },
  ],
});

export function startServer(port = PORT) {
  const facilitatorHost = new URL(
    process.env.X402_FACILITATOR_URL ||
      "https://api.cdp.coinbase.com/platform/v2/x402",
  ).host;
  return app.listen(port, () => {
    console.log(
      `[BOOT] ${process.env.SERVICE_NAME || "nyc-apartment-agent"} ` +
        `commit=${process.env.GIT_SHA || "unknown"} ` +
        `built=${process.env.BUILD_TIME || "unknown"} ` +
        `port=${port} ` +
        `x402=${process.env.X402_NETWORK || "eip155:8453"} ` +
        `facilitator=${facilitatorHost} ` +
        `cdp_auth=${process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET ? "configured" : "missing"} ` +
        `mpp=${process.env.MPP_SECRET_KEY ? "configured" : "missing"} ` +
        `payer=${payer ? payer.address : "missing"} ` +
        `llm_gateway=${process.env.EIGEN_GATEWAY_URL ? new URL(process.env.EIGEN_GATEWAY_URL).host : "none"}`,
    );
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
