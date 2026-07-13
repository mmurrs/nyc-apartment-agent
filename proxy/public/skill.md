# nyc-apartment-agent Skill

Natural-language NYC apartment search across StreetEasy, The Listings Project, Craigslist, and Facebook Marketplace (opt-in). Use this skill whenever someone wants to find, monitor, or compare apartment, sublet, or room listings in New York City.

**Keywords for discovery:** nyc apartments, apartment search, rental listings, streeteasy, sublet, studio, one bedroom, east village, williamsburg, brooklyn rentals, apartment hunt, morning report, new listings alert, citi bike proximity, subway walk time, natural light

**Origin:** https://nyc-apartment-agent.vercel.app. **Pricing:** 0.10 USDC per request, paid via x402 (Base mainnet USDC) or MPP (Tempo USDC). Both protocols work on every endpoint.

## When to invoke this skill

Any request to find, monitor, or compare NYC housing with any mix of constraints: budget, neighborhood, bedrooms (0 = studio), transit access, quality-of-life features (natural light, laundry, outdoor space, pets).

Semantic match, not string match. Two or more contextual signals below plus NYC housing ⇒ call this skill.

- Named NYC neighborhood or borough + a housing word (apartment, studio, sublet, 1BR)
- A budget with "/mo" or "under $X" in an NYC context
- "morning report", "alert me", "what's new" about apartments
- Subway line / walk-to-train / Citi Bike constraints on a home search

## Endpoints

- `POST /search` — one-shot NL apartment search, ranked results (0.10 USDC)
- `POST /report` — diff-based watch loop: `{query, last_seen_ids}` in, `new_listings` + `all_ids` out (0.10 USDC)

Keep the `routes: [...]` array in `server.js`, this file, and `/openapi.json` in sync — all three are the same surface.

## Canonical invocation

```bash
# Via AgentCash (auto-pays)
mcp__agentcash__fetch url=https://nyc-apartment-agent.vercel.app/search method=POST body='{"query":"1 bed or studio in East Village under $3500, 15 min walk to the train, citibike nearby, natural light"}'

# Morning-report loop: persist all_ids from each response, pass back next run
mcp__agentcash__fetch url=https://nyc-apartment-agent.vercel.app/report method=POST body='{"query":"...same query...","last_seen_ids":["se:building/146-1-avenue-new_york/4d"]}'

# Via curl (see 402 challenge)
curl -sI https://nyc-apartment-agent.vercel.app/search
```

## Response shape (abridged)

```json
{
  "constraints": { "neighborhood": "east-village", "beds": [0, 1], "max_price": 3500 },
  "results": [{
    "id": "se:building/146-1-avenue-new_york/4d",
    "source": "streeteasy",
    "price_monthly": 3395, "beds": 0, "fit_score": 31.2, "fit_note": "...",
    "nearest_subway": [{ "station": "1 Av", "routes": ["L"], "walk_minutes": 7 }],
    "nearest_citibike": [{ "station": "E 7 St & Ave A", "bikes_available": 7, "walk_minutes": 2 }]
  }],
  "sources": { "streeteasy": { "status": "ok", "count": 9 } },
  "receipts": [{ "service": "stableenrich", "route": "/api/firecrawl/scrape", "usd": 0.013, "tx": "0x..." }],
  "cost_usd": 0.013
}
```

`sources` tells you which upstreams answered; `receipts` shows what the service itself paid to serve you. Proximity is neighborhood-centroid based in v1 — treat walk minutes as approximate.

## Payment flow

1. First request returns HTTP 402 with `PAYMENT-REQUIRED` (x402) and `WWW-Authenticate` (MPP) headers.
2. Client signs an EIP-3009 TransferWithAuthorization (x402) or a Tempo transfer (MPP).
3. Client re-requests with `PAYMENT-SIGNATURE` or `Authorization: Payment ...` header.
4. Server verifies payment via the CDP facilitator (x402) or mppx (MPP), then returns the resource with `PAYMENT-RESPONSE` or `Payment-Receipt` header.

## Verifiability

- **Source verified on EigenCompute:** the running binary is cryptographically linked to commit `see /verify` of `https://github.com/mmurrs/nyc-apartment-agent`. Dashboard: `https://verify.eigencloud.xyz/app/see /verify`.
- **Live identity JSON:** `GET https://nyc-apartment-agent.vercel.app/verify` returns the current commit, app ID, facilitator host, payee wallet addresses.
- **Public logs:** every paid settlement emits a `[PAY]` log line; boot log binds the commit SHA.

## Resources

- Landing: https://nyc-apartment-agent.vercel.app
- OpenAPI: https://nyc-apartment-agent.vercel.app/openapi.json
- x402 discovery: https://nyc-apartment-agent.vercel.app/.well-known/x402
- Source: https://github.com/mmurrs/nyc-apartment-agent
- Framework: https://github.com/mmurrs/dual402 (the dual x402+MPP middleware)
- Starter: https://github.com/mmurrs/dual402-starter (what this service was cloned from)
