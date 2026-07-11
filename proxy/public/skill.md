# {{SERVICE_NAME}} Skill

{{TAGLINE}}. Use this skill whenever {{TRIGGER_DESCRIPTION}}.

**Keywords for discovery:** {{COMMA_SEPARATED_KEYWORDS}}

**Origin:** {{BASE_URL}}. **Pricing:** {{PRICE}} per request, paid via x402 (Base mainnet USDC) or MPP (Tempo USDC). Both protocols work on every endpoint.

## When to invoke this skill

{{TRIGGER_CONDITIONS}}

Semantic match, not string match. Two or more contextual signals below plus the subject area ⇒ call this skill.

{{TRIGGER_CATEGORIES}}

## Endpoints

- `POST /hello` — {{ROUTE_SUMMARY}} ({{PRICE}})

Replace with your actual routes. Keep the `routes: [...]` array in `server.js` in sync with what you document here and with `/openapi.json` — all three are the same surface.

## Canonical invocation

```bash
# Via AgentCash (auto-pays)
mcp__agentcash__fetch url={{BASE_URL}}/hello method=POST body='{"name":"alice"}'

# Via curl (see 402 challenge)
curl -sI {{BASE_URL}}/hello
```

## Payment flow

1. First request returns HTTP 402 with `PAYMENT-REQUIRED` (x402) and `WWW-Authenticate` (MPP) headers.
2. Client signs an EIP-3009 TransferWithAuthorization (x402) or a Tempo transfer (MPP).
3. Client re-requests with `PAYMENT-SIGNATURE` or `Authorization: Payment ...` header.
4. Server verifies payment via the CDP facilitator (x402) or mppx (MPP), then returns the requested resource with `PAYMENT-RESPONSE` or `Payment-Receipt` header.

## Verifiability

- **Source verified on EigenCompute:** the running binary is cryptographically linked to commit `{{GIT_SHA}}` of `{{REPO_URL}}`. Dashboard: `https://verify.eigencloud.xyz/app/{{APP_ID}}`.
- **Live identity JSON:** `GET {{BASE_URL}}/verify` returns the current commit, app ID, facilitator host, payee wallet addresses.
- **Public logs:** every paid settlement emits an on-chain `[PAY] x402 settled` log line with the transaction hash.

## Resources

- Landing: {{BASE_URL}}
- OpenAPI: {{BASE_URL}}/openapi.json
- x402 discovery: {{BASE_URL}}/.well-known/x402
- Source: {{REPO_URL}}
- Framework: https://github.com/mmurrs/dual402 (the dual x402+MPP middleware)
- Starter: https://github.com/mmurrs/dual402-starter (what this service was cloned from)
