import { test } from "node:test";
import assert from "node:assert/strict";

function applyMockEnv() {
  process.env.MPP_SECRET_KEY = "0".repeat(64);
  process.env.USDC_TEMPO = "0x20c0000000000000000000000000000000000000";
  process.env.RECIPIENT_WALLET = "0x1111111111111111111111111111111111111111";
  process.env.X402_NETWORK = "eip155:84532";
  process.env.X402_FACILITATOR_URL = "https://x402.org/facilitator";
  process.env.MPP_TESTNET = "true";
  process.env.PORT = "0";
  delete process.env.PAYER_PRIVATE_KEY;
  delete process.env.EIGEN_GATEWAY_URL;
}

test("server boots; unpaid /search 402s; discovery + verify OK", async () => {
  applyMockEnv();
  const { startServer } = await import(`../server.js?smoke=${Date.now()}`);
  const server = startServer(0);
  try {
    await new Promise((resolve) => {
      if (server.listening) return resolve();
      server.once("listening", resolve);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const paid = await fetch(`${baseUrl}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "studio in east village under $3000" }),
    });
    assert.equal(paid.status, 402);
    assert.ok(paid.headers.get("payment-required"));
    assert.ok(paid.headers.get("www-authenticate"));

    const report = await fetch(`${baseUrl}/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "studio", last_seen_ids: [] }),
    });
    assert.equal(report.status, 402);

    const openapi = await fetch(`${baseUrl}/openapi.json`);
    assert.equal(openapi.status, 200);
    const spec = await openapi.json();
    assert.equal(spec.paths["/search"].post.operationId, "searchApartments");
    assert.equal(spec.paths["/report"].post.operationId, "reportNewApartments");

    const verify = await fetch(`${baseUrl}/verify`);
    assert.equal(verify.status, 200);
    const proof = await verify.json();
    assert.equal(proof.payment.x402.network, "eip155:84532");

    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    const h = await health.json();
    assert.equal(h.ok, true);
    assert.equal(h.payer, null);
    assert.equal(h.llm, false);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
