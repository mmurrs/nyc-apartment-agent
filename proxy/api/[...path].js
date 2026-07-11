// Vercel serverless proxy → EigenCompute backend.
//
// CRITICAL: disable Vercel's automatic body parsing. Otherwise Vercel
// pre-parses JSON bodies into `req.body` AND consumes the raw stream,
// leaving us with no way to forward the original bytes downstream.
export const config = {
  api: {
    bodyParser: false,
  },
};

const BACKEND = process.env.BACKEND_URL || "http://localhost:8080";

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return chunks.length === 0 ? undefined : Buffer.concat(chunks);
}

export default async function handler(req, res) {
  const url = `${BACKEND}${req.url}`;

  const forwardedHeaders = Object.fromEntries(
    Object.entries(req.headers).filter(
      ([k]) => !["host", "connection", "content-length"].includes(k.toLowerCase()),
    ),
  );

  let body;
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    try {
      body = await readRawBody(req);
    } catch {
      return res.status(400).json({ error: "Failed to read request body" });
    }
  }

  try {
    const response = await fetch(url, {
      method: req.method,
      headers: forwardedHeaders,
      body,
      duplex: body ? "half" : undefined,
    });

    res.status(response.status);
    for (const [key, value] of response.headers.entries()) {
      if (!["transfer-encoding", "content-encoding", "content-length"].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    }
    const buf = Buffer.from(await response.arrayBuffer());
    res.send(buf);
  } catch {
    res.status(502).json({ error: "Backend unreachable" });
  }
}
