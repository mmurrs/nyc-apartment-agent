// Optional LLM layer via the EigenCloud AI Gateway. Inside EigenCompute the
// KMS attestation env (KMS_SERVER_URL / KMS_PUBLIC_KEY) is auto-injected;
// locally a static KMS_AUTH_JWT works. With neither, every export degrades
// to null and callers fall back to the deterministic path — the API must
// never depend on LLM availability.
//
// Gotcha (memory: ai_gateway_urls): on sepolia/mainnet-alpha you MUST set
// EIGEN_GATEWAY_URL=https://ai-gateway.eigencloud.xyz — the package default
// points at the dev gateway, whose JWT verification rejects prod KMS tokens
// with a 401 "crypto/rsa: verification error".

const MODEL = process.env.MODEL || "anthropic/claude-haiku-4-5";

let providerPromise = null;

async function getProvider() {
  const gatewayURL = process.env.EIGEN_GATEWAY_URL;
  const staticJwt = process.env.KMS_AUTH_JWT;
  const kmsServerURL = process.env.KMS_SERVER_URL;
  const kmsPublicKey = process.env.KMS_PUBLIC_KEY;
  if (!gatewayURL) return null;
  if (!staticJwt && !(kmsServerURL && kmsPublicKey)) return null;

  if (!providerPromise) {
    providerPromise = (async () => {
      const { createEigenGateway } = await import("@layr-labs/ai-gateway-provider");
      return createEigenGateway({
        baseURL: gatewayURL,
        ...(staticJwt ? { jwt: staticJwt } : {}),
        ...(kmsServerURL && kmsPublicKey
          ? {
              attestConfig: {
                kmsServerURL,
                kmsPublicKey,
                audience: "llm-proxy",
              },
            }
          : {}),
      });
    })();
  }
  return providerPromise;
}

export async function llmAvailable() {
  return (await getProvider()) !== null;
}

async function generate(prompt, maxOutputTokens = 700) {
  const provider = await getProvider();
  if (!provider) return null;
  const { generateText } = await import("ai");
  const { text } = await generateText({
    model: provider(MODEL),
    prompt,
    maxOutputTokens,
    abortSignal: AbortSignal.timeout(25000),
  });
  return text;
}

function extractJson(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

// Refine deterministic constraints with the LLM: catches phrasing the regex
// parser can't ("walkup ok but not above 4th floor", "somewhere leafy").
export async function refineConstraints(rawQuery, deterministic) {
  try {
    const text = await generate(
      `You convert an NYC apartment-hunt request into strict JSON constraints.

Request: """${rawQuery.slice(0, 600)}"""

A deterministic parser produced: ${JSON.stringify(deterministic)}

Return ONLY a JSON object with these keys (null when unspecified):
{"neighborhood_name": string|null, "beds": number[]|null (0=studio),
 "max_price": number|null, "max_subway_walk_minutes": number|null,
 "subway_lines": string[]|null, "citibike_nearby": boolean,
 "features": string[] (from: natural_light,laundry,dishwasher,outdoor_space,pets,doorman,elevator,gym,renovated,exposed_brick,hardwood,quiet,no_fee),
 "must_avoid": string[] (dealbreakers phrased as keywords, e.g. "basement","ground floor")}
Keep the deterministic values unless the request clearly contradicts them.`,
    );
    const parsed = extractJson(text);
    if (!parsed) return null;
    return { ...parsed, parser: "llm" };
  } catch {
    return null;
  }
}

// One-line "why this matches / what to check" note per shortlisted listing.
export async function fitNotes(rawQuery, listings) {
  try {
    const compact = listings.map((l, i) => ({
      i,
      title: l.title,
      price: l.price_monthly,
      beds: l.beds,
      hood: l.neighborhood,
      desc: (l.description_snippet ?? "").slice(0, 260),
      subway: l.nearest_subway?.[0],
    }));
    const text = await generate(
      `Request: """${rawQuery.slice(0, 400)}"""
Listings: ${JSON.stringify(compact)}

For each listing return one honest sentence: why it fits the request and the
single biggest thing to verify. No hype. Return ONLY JSON:
{"notes": [{"i": number, "note": string}]}`,
      900,
    );
    const parsed = extractJson(text);
    if (!parsed?.notes) return null;
    const map = new Map(parsed.notes.map((n) => [n.i, String(n.note).slice(0, 300)]));
    return listings.map((_, i) => map.get(i) ?? null);
  } catch {
    return null;
  }
}
