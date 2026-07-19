# Agent Instructions

This file gives coding agents (Claude Code, Cursor, Codex, Aider, etc.) the context they need to be useful in this repo. Model-agnostic — read top to bottom on first visit.

> **Update after learnings or mistakes.** When a correction, new convention, or hard-won lesson emerges during development, append it to the **Learned** section below. This file should grow as the repo does.

## What this repo is

A GitHub template for shipping paid APIs on **EigenCompute** that accept both:
- **x402** (Base mainnet USDC, via Coinbase CDP facilitator)
- **MPP** (Tempo USDC, via mppx)

on every route, out of the box. Built on [`mmurrs/dual402`](https://github.com/mmurrs/dual402).

## What you'll be asked to do

In priority order of likelihood:

1. **Add a new paid route.** The sample `/hello` route in `server.js` is a placeholder. Users replace it with their real business logic.
2. **Customize the landing page.** `proxy/public/{index.html,llms.txt,skill.md}` ship with `{{PLACEHOLDER}}` tokens. Substitute them for the service's name, tagline, price, etc.
3. **Deploy to EigenCompute.** Via `./scripts/deploy.sh --fresh` (first time) or `./scripts/deploy.sh` (subsequent upgrades).
4. **Debug payment failures.** Most cost real hours the first time; the gotchas section below covers them.

## Key conventions

### Adding a paid route

In `server.js`, you need to do **three** things, all in sync:

1. Create a `charge` middleware: `const chargeFoo = dual.charge({ amount: "0.02", description: "..." })`
2. Wire the routes: `app.post("/foo", chargeFoo, handleFoo)` and optionally `app.get("/foo", chargeFoo, handleFoo)` as an alias
3. Add the route to the `routes: [...]` array passed to `dualDiscovery()` — including `requestBodySchema` / `responseSchema` / `parameters`

All three must match. `/openapi.json` is generated from the `routes: [...]` array; agent clients rely on it for discovery.

### Schema vs example

In OpenAPI `responseSchema`, pass a JSON Schema. The `extensions.bazaar.info.output.example` that gets emitted in the 402 challenge should be a **concrete example response object**, not another schema. dual402 handles this correctly when you pass `responseSchema` — don't hand-author `extensions.bazaar`.

### ASCII-only in route descriptions

`dual.charge({ description })` flows into HTTP header values via mppx's `WWW-Authenticate` challenge. HTTP headers are ByteString (≤ U+00FF). **No em-dashes, smart quotes, or other Unicode punctuation in `description` strings.** Use `--` instead of `—`. Crashes as `TypeError: Cannot convert argument to a ByteString`.

### Never log `req.body` on a paid route

Paid route bodies contain signed `PAYMENT-SIGNATURE` / `Authorization: Payment ...` credentials. Logging them leaks signed authorizations. Log extracted fields explicitly — never the whole body.

### CORS already exposes both protocol headers

`server.js` already exposes `WWW-Authenticate, Payment-Receipt, PAYMENT-REQUIRED, PAYMENT-RESPONSE` via `Access-Control-Expose-Headers`. Don't remove — browser-based x402 clients can't read the challenge without it.

### Vercel proxy needs `bodyParser: false`

`proxy/api/[...path].js` has `export const config = { api: { bodyParser: false } }`. **Do not remove.** Without it, Vercel pre-parses JSON bodies and strips raw bytes, leaving `express.json()` downstream with `{}` — every POST's schema validation fails silently.

## Production gotchas (prevented by starter defaults; do not regress)

1. **`extra.name` for USDC must be `"USD Coin"`, not `"USDC"`.** Base mainnet USDC's EIP-712 domain uses the contract's on-chain `name()` which returns `"USD Coin"`. Wrong name → wrong domain separator → signature reverts on verify. `dual402` defaults correctly; don't override.
2. **Merchant wallet ≠ tester wallet.** CDP facilitator rejects self-transfers as `invalid_payload`. `scripts/init.sh` generates a fresh wallet on purpose. Never reuse your AgentCash or personal wallet as `RECIPIENT_WALLET`.
3. **Base mainnet facilitator is CDP, not x402.org.** `X402_FACILITATOR_URL` defaults to `https://api.cdp.coinbase.com/platform/v2/x402`. `x402.org/facilitator` is Sepolia-only.
4. **CDP keys are required on mainnet.** Without `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET`, every `/verify` returns 401, clients loop at 402. Boot log shows `cdp_auth=configured` when set correctly.
5. **Docker build context is CWD.** `scripts/deploy.sh` always `cd`s to the repo root before running `ecloud`. If you call ecloud manually from elsewhere, `COPY server.js` grabs the wrong tree.
6. **Verifiable builds require the current commit to be pushed.** `deploy.sh` aborts if `HEAD != origin/main` or if the working tree is dirty. Don't skip this guard — ecloud clones from GitHub at the specified SHA, not from your local files.

## Environment conventions

All config flows through `.env.mainnet` (gitignored). The `.env.example` documents every var.

Required:
- `MPP_SECRET_KEY`, `USDC_TEMPO`, `MPP_RECIPIENT` or `RECIPIENT_WALLET` (MPP)
- `X402_PAYEE_ADDRESS` or `RECIPIENT_WALLET` (x402)
- `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` (if using CDP facilitator on mainnet)

The `/verify` endpoint and `[BOOT]` log both reflect these at runtime. Don't add new env vars without threading them through both surfaces so operators can audit what's running.

## Testing

- `npm test` — offline smoke with an ephemeral local server boot, no external network
- CI should run the same smoke plus a live-boot 402 check on Node 22 (`.github/workflows/ci.yml`)
- Manual 402 probe: `curl -sI http://localhost:8080/<route>` → must return `HTTP/1.1 402` with both `PAYMENT-REQUIRED` and `www-authenticate` headers

## Deploying

```bash
./scripts/init.sh            # first time only — generates merchant wallet + MPP secret
./scripts/deploy.sh --fresh  # first deploy — creates app, saves APP_ID
./scripts/deploy.sh          # subsequent — upgrades existing app (reads scripts/.deploy-config)
```

Monitor with `ecloud compute app logs <APP_ID> --environment mainnet-alpha --watch`. Expected boot log:

```
[BOOT] <service-name> commit=<sha> built=<iso8601> port=8080 x402=eip155:8453 facilitator=api.cdp.coinbase.com cdp_auth=configured mpp=configured
```

If any field is wrong or missing, **do not deploy to production** until fixed.

## What NOT to do

- Don't add backwards-compatibility code for old env var names. This is a fresh template — consumers adopt the current surface.
- Don't introduce a shared SDK between backend and frontend. The proxy is intentionally dumb.
- Don't log payment bodies or headers that contain signed authorizations.
- Don't override `extra.name` or the default facilitator URL without a specific reason.
- Don't commit `.env.mainnet`, `scripts/.deploy-config`, `scripts/.merchant-privkey`, or `CLAUDE.md`. All gitignored.

## Learned

Accumulating list of things actually hit in practice. Append to this section when something new gets burned into the codebase so future agents skip the same debug cycle. Oldest first.

- **2026-05-08 — em-dash in route `description` crashes mppx.** `dual.charge({ description: "... — ..." })` flows into the `WWW-Authenticate` HTTP header, which is ByteString (≤ U+00FF). Em-dash (`—`, U+2014) throws `TypeError: Cannot convert argument to a ByteString`. Stick to ASCII.
- **2026-05-08 — `ecloud compute app deploy --name <foo>` is silently ignored.** Apps show as `(unnamed)` in `app info` and on `verify.eigencloud.xyz`. Workaround: after deploy, run `ecloud compute app profile set <APP_ID> --name <foo> --description <...> --website <...> --environment mainnet-alpha`. This is an on-chain profile update (costs a few gwei). `deploy.sh --fresh` already does this automatically.
- **2026-05-08 — `Logs not yet available` (HTTP 425) for ~60–90s after Status: Running.** Normal. Wait, then re-poll. Don't interpret as a bad deploy.
- **2026-05-08 — verifiable build can fail "Failed to verify provenance" on first attempt.** Retry with a different commit SHA (trivial no-op commit or pull a rebase). Usually transient; the provenance cache sometimes gets stuck on a rejected attestation.
- **2026-05-10 — `npm test` passing a directory to `node --test` requires Node 24+.** On Node 22 it errors `MODULE_NOT_FOUND`. Use explicit globs: `node --test tests/*.test.mjs`.
- **2026-07-17 — sandboxed coding-agent containers CANNOT verify live data sources.** Claude Code remote (and similar) sandboxes allowlist egress at a proxy; craigslist.org, listingsproject.com, stableenrich.dev, and stablesocial.dev all get `CONNECT ... 403` (check `curl -sS "$HTTPS_PROXY/__agentproxy/status"` → `recentRelayFailures`). This is indistinguishable from a real source block if you only look at HTTP status. Do NOT conclude a source or parser is broken from inside a sandbox — run `node scripts/check-sources.mjs` from a machine with open egress or from the deployed EigenCompute app. WebFetch is blocked the same way; WebSearch still works (routes via the search API, not the proxy).
- **2026-07-17 — Craigslist sublets live under `cat=sub` ("sublets & temporary").** `searchCraigslist` now fetches both `sub` and `apa` when `constraints.sublet` is true, because plenty of sublets are posted under the plain rentals category. Sublet intent is parsed in `lib/query.js` (`sublet`, `duration_months`; a stated stay of ≤6 months implies a sublet even without the keyword).
- **2026-07-17 — commits can silently land unsigned in remote agent sessions, and GitHub shows them Unverified.** The session's git config has `commit.gpgsign=true` + an SSH signing key, but the first commits of a session may still miss the signature (config lands after the commit). Fix before pushing: `git rebase --exec "git commit --amend --no-edit --reset-author" origin/main`, then verify with `git cat-file commit HEAD | grep gpgsig` (don't trust `git log --show-signature` locally — it errors on a missing allowedSignersFile and prints "No signature" misleadingly). Already-pushed branch commits need a `--force-with-lease` push after re-signing.
- **2026-07-17 — highest-value sublet inventory (private FB groups like Gypsy Housing/Ghostlight, Instagram) is login-walled.** Logged-out public scraping is the settled-law safe zone (Meta v. Bright Data); logged-in private-group scraping violates Meta ToS and carries CFAA exposure — keep it out of the service. See `docs/data-sources.md` for the researched option matrix before adding any new source adapter.

## Further reading

- Library: https://github.com/mmurrs/dual402 — architecture, protocol details, middleware internals
- This template: https://github.com/mmurrs/dual402-starter
- EigenCompute verify dashboard: https://verify.eigencloud.xyz
- x402 spec: https://github.com/coinbase/x402
- MPP spec: https://github.com/tempoxyz/mpp-specs
