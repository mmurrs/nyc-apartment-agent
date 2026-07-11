import { pathToFileURL } from "node:url";
import express from "express";
import { createDual402, dualDiscovery } from "dual402";

export const app = express();
const PORT = process.env.PORT || 8080;

app.set("trust proxy", true);
app.use(express.json({ limit: "16kb" }));

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

const chargeHello = dual.charge({
  amount: "0.02",
  description: "Sample paid endpoint. Replace with your own logic.",
});

const helloInputSchema = {
  type: "object",
  properties: {
    name: { type: "string", description: "Who to greet" },
  },
  required: ["name"],
  additionalProperties: false,
};

const helloOutputSchema = {
  type: "object",
  properties: {
    greeting: { type: "string" },
    paid_at: { type: "string", format: "date-time" },
  },
  required: ["greeting", "paid_at"],
};

function handleHello(req, res) {
  const name =
    (req.method === "POST" ? req.body?.name : req.query?.name) ?? "world";
  res.json({
    greeting: `Hello, ${String(name).slice(0, 64)}. You paid 0.02 USDC.`,
    paid_at: new Date().toISOString(),
  });
}

app.post("/hello", chargeHello, handleHello);
app.get("/hello", chargeHello, handleHello);

app.get("/", (req, res) => {
  res.json({
    service: "dual402-starter",
    docs: "/openapi.json",
    x402: "/.well-known/x402",
    verify: "/verify",
  });
});

app.get("/verify", (req, res) => {
  res.json({
    service: {
      name: process.env.SERVICE_NAME || "dual402-starter",
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
    title: process.env.SERVICE_NAME || "dual402-starter",
    version: process.env.SERVICE_VERSION || "0.1.0",
    description:
      "Starter paid API accepting both x402 (Base) and MPP (Tempo) USDC.",
    "x-guidance":
      "POST /hello with { name }. GET /hello?name=world is a query-string alias. Expect 402 until payment attached.",
  },
  routes: [
    {
      method: "post",
      path: "/hello",
      handler: chargeHello,
      operationId: "postHello",
      tags: ["hello"],
      summary: "Paid greeting (canonical POST)",
      description:
        "POST /hello with a JSON body { name }. Returns a greeting for 0.02 USDC.",
      requestBodySchema: helloInputSchema,
      responseSchema: helloOutputSchema,
    },
    {
      method: "get",
      path: "/hello",
      handler: chargeHello,
      operationId: "getHello",
      tags: ["hello"],
      summary: "Paid greeting (GET alias for curl/browsers)",
      description: "GET /hello?name=world. Query-string alias of POST /hello.",
      parameters: [
        {
          name: "name",
          in: "query",
          required: false,
          schema: { type: "string" },
          description: "Who to greet",
        },
      ],
      responseSchema: helloOutputSchema,
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
      `[BOOT] ${process.env.SERVICE_NAME || "dual402-starter"} ` +
        `commit=${process.env.GIT_SHA || "unknown"} ` +
        `built=${process.env.BUILD_TIME || "unknown"} ` +
        `port=${port} ` +
        `x402=${process.env.X402_NETWORK || "eip155:8453"} ` +
        `facilitator=${facilitatorHost} ` +
        `cdp_auth=${process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET ? "configured" : "missing"} ` +
        `mpp=${process.env.MPP_SECRET_KEY ? "configured" : "missing"}`,
    );
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
