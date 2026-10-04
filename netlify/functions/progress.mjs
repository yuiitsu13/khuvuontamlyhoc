import { getStore } from "@netlify/blobs";
import book from "./book.json";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const users = () => getStore({ name: "users", consistency: "strong" }), sess = () => getStore({ name: "sessions", consistency: "strong" }), prog = () => getStore({ name: "progress", consistency: "strong" });
const hash = (pw, salt) => scryptSync(pw, salt, 32).toString("hex");
const SEED = { name: "anduy13", pw: "12345" };   // tài khoản có sẵn nội dung tâm lý học
const pub = (u) => ({ name: u.name, avatar: u.avatar || null });
const newSession = async (name) => { const t = randomBytes(32).toString("hex"); await sess().set(t, name); return t; };

export default async (req) => {
  const a = new URL(req.url).searchParams.get("a") || "";

  if (req.method === "POST" && (a === "register" || a === "login")) {
    let b; try { b = await req.json(); } catch { return J({ error: "Dữ liệu không hợp lệ" }, 400); }
    const name = String(b.username || "").trim().toLowerCase(), pw = String(b.password || "");
    if (!/^[a-z0-9_]{3,20}$/.test(name)) return J({ error: "Tên đăng nhập 3-20 ký tự: chữ thường không dấu, số, dấu _" }, 400);
    if (a === "register" && (pw.length < 6 || pw.length > 100)) return J({ error: "Mật khẩu cần từ 6 ký tự" }, 400);
    if (pw.length > 100) return J({ error: "Mật khẩu quá dài" }, 400);
    let u = await users().get(name, { type: "json" });
    if (!u && a === "login" && name === SEED.name && pw === SEED.pw) {
      const salt = randomBytes(16).toString("hex");
      u = { name, salt, hash: hash(pw, salt), avatar: null };
      await users().setJSON(name, u);
    }
    if (a === "register") {
      if (u || name === SEED.name) return J({ error: "Tên đăng nhập đã tồn tại" }, 409);
      const salt = randomBytes(16).toString("hex");
      const rec = { name, salt, hash: hash(pw, salt), avatar: null };
      await users().setJSON(name, rec);
      return J({ token: await newSession(name), user: pub(rec) });
    }
    if (!u || !timingSafeEqual(Buffer.from(hash(pw, u.salt)), Buffer.from(u.hash))) return J({ error: "Sai tên đăng nhập hoặc mật khẩu" }, 401);
    return J({ token: await newSession(name), user: pub(u) });
  }

  const tok = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  const name = tok && (await sess().get(tok));
  const u = name && (await users().get(name, { type: "json" }));
  if (!u) return J({ error: "unauthorized" }, 401);

  if (req.method === "PUT" && a === "password") {
    let b; try { b = await req.json(); } catch { return J({ error: "bad json" }, 400); }
    const oldPw = String(b.oldPassword || ""), np = String(b.newPassword || "");
    if (!timingSafeEqual(Buffer.from(hash(oldPw, u.salt)), Buffer.from(u.hash))) return J({ error: "Mật khẩu hiện tại không đúng" }, 403);
    if (np.length < 6 || np.length > 100) return J({ error: "Mật khẩu mới cần từ 6 ký tự" }, 400);
    u.salt = randomBytes(16).toString("hex"); u.hash = hash(np, u.salt);
    await users().setJSON(name, u);
    return J({ ok: true });
  }

  if (req.method === "PUT" && a === "avatar") {
    let b; try { b = await req.json(); } catch { return J({ error: "bad json" }, 400); }
    if (typeof b.avatar !== "string" || !b.avatar.startsWith("data:image/jpeg;base64,") || b.avatar.length > 80000) return J({ error: "Ảnh không hợp lệ" }, 400);
    u.avatar = b.avatar; await users().setJSON(name, u);
    return J({ user: pub(u) });
  }

  if (req.method === "GET") {
    const rec = await prog().get(name, { type: "json" });
    return J({ rev: rec?.rev || 0, data: rec?.data || (name === SEED.name ? book : null), user: pub(u) });
  }

  if (req.method === "PUT") {
    const raw = await req.text();
    if (raw.length > 4_000_000) return J({ error: "too large" }, 413);
    let b; try { b = JSON.parse(raw); } catch { return J({ error: "bad json" }, 400); }
    if (!Array.isArray(b.data)) return J({ error: "bad data" }, 400);
    const ex = await prog().get(name, { type: "json" });
    if (ex && Number(b.baseRev) !== ex.rev) return J(ex, 409);
    const rev = Math.max(Date.now(), (ex?.rev || 0) + 1);
    await prog().setJSON(name, { rev, data: b.data });
    return J({ rev });
  }
  return J({ error: "method not allowed" }, 405);
};

export const config = { path: "/api/progress" };
