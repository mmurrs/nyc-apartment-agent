import {
  wrapFetchWithPayment,
  x402Client,
  x402HTTPClient,
  decodePaymentResponseHeader,
} from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

// Outbound payment client. This service is a CUSTOMER of other x402 services
// (stableenrich for Exa/Firecrawl, stablesocial for FB Marketplace) — it pays
// for its own inputs from a dedicated payer wallet. Never the merchant wallet:
// CDP rejects self-transfers, and mixing roles makes the books unreadable.
export function createPayer({ privateKey, maxPayPerCallUsd = 0.25 }) {
  const account = privateKeyToAccount(privateKey);
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account });

  const httpClient = new x402HTTPClient(client);
  // Spend guard: upstream challenges name their own price. Refuse anything
  // above the cap so a hijacked upstream can't drain the payer wallet.
  httpClient.onPaymentRequired(async ({ paymentRequired }) => {
    for (const offer of paymentRequired?.accepts ?? []) {
      const usd = Number(offer.amount) / 1e6; // USDC, 6 decimals
      if (!Number.isFinite(usd) || usd > maxPayPerCallUsd) {
        throw new Error(
          `payer: refusing challenge of $${usd} (cap $${maxPayPerCallUsd})`,
        );
      }
    }
  });

  return { address: account.address, fetch: wrapFetchWithPayment(fetch, httpClient) };
}

export function extractTxHash(response) {
  const header =
    response.headers.get("PAYMENT-RESPONSE") ??
    response.headers.get("X-PAYMENT-RESPONSE");
  if (!header) return null;
  try {
    const decoded = decodePaymentResponseHeader(header);
    return decoded?.transaction ?? decoded?.transactionHash ?? decoded?.txHash ?? null;
  } catch {
    return null;
  }
}
