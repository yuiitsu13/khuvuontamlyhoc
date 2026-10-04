import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async (req) => {
  const code = (req.headers.get("x-sync-code") || "").trim();
  if (code.length < 4 || code.length > 200) return json({ error: "bad code" }, 400);

  const key = "u-" + createHash("sha256").update(code).digest("hex");
  const store = getStore("progress");

  if (req.method === "GET") {
    const rec = await store.get(key, { type: "json" });
    return json(rec || null);
  }

  if (req.method === "PUT") {
    const raw = await req.text();
    if (raw.length > 4_000_000) return json({ error: "too large" }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: "bad json" }, 400); }
    if (!Array.isArray(body.data)) return json({ error: "bad data" }, 400);

    const existing = await store.get(key, { type: "json" });
    if (existing && Number(body.baseRev) !== existing.rev) return json(existing, 409);

    const rev = Math.max(Date.now(), (existing?.rev || 0) + 1);
    await store.setJSON(key, { rev, data: body.data });
    return json({ rev });
  }

  return json({ error: "method not allowed" }, 405);
};

export const config = { path: "/api/progress" };
