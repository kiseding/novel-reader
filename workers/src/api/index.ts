// API routes for the novel reader
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { signToken, verifyToken, extractToken } from "../auth/jwt";
import { hashPassword, verifyPassword } from "../auth/password";
import * as db from "../db/schema";
import { getRegistry } from "../sites/registry";
import type { D1Database } from "@cloudflare/workers-types";
import { rateLimit } from "../middleware/rateLimit";

type Bindings = {
  DB: D1Database;
  CACHE?: KVNamespace;
  JWT_SECRET?: string;
};

type Variables = {
  user: { userId: number; username: string };
};

const api = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function requireDB(c: { env: Bindings }) {
  if (!c.env.DB) {
    throw new Response(JSON.stringify({ error: "数据库未配置" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}

// ========== Auth middleware ==========
async function authMiddleware(c: any, next: any) {
  const token = extractToken(c.req.header("Authorization"));
  if (!token) return c.json({ error: "未登录" }, 401);
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: "登录已过期" }, 401);
  c.set("user", payload);
  return next();
}

async function adminMiddleware(c: any, next: any) {
  const user = c.get("user");
  if (user.userId !== 1) return c.json({ error: "需要管理员权限" }, 403);
  return next();
}

// ========== Auth routes ==========
// KV-backed rate limit: by client IP, max N failures per window
const LOGIN_RL_LIMIT = 8;
const LOGIN_RL_WINDOW = 600; // seconds (also KV TTL)

function getClientIp(c: any): string {
  return c.req.header("CF-Connecting-IP")
    || c.req.header("X-Forwarded-For")?.split(",")[0]?.trim()
    || "unknown";
}

api.post("/auth/login", async (c) => {
  requireDB(c);
  const ip = getClientIp(c);
  const rlKey = `rl:login:${ip}`;
  if (c.env.CACHE) {
    try {
      const cur = await c.env.CACHE.get(rlKey);
      const n = cur ? parseInt(cur) || 0 : 0;
      if (n >= LOGIN_RL_LIMIT) {
        return c.json({ error: "尝试次数过多，请稍后再试" }, 429);
      }
    } catch {}
  }
  const { username, password } = await c.req.json();
  if (!username || !password) return c.json({ error: "用户名和密码不能为空" }, 400);
  const user = await db.getUserByUsername(c.env.DB, username);
  const valid = user ? await verifyPassword(password, user.password_hash) : false;
  if (!user || !valid) {
    if (c.env.CACHE) {
      try {
        const cur = await c.env.CACHE.get(rlKey);
        const n = (cur ? parseInt(cur) || 0 : 0) + 1;
        c.executionCtx?.waitUntil(c.env.CACHE.put(rlKey, String(n), { expirationTtl: LOGIN_RL_WINDOW }));
      } catch {}
    }
    return c.json({ error: "用户名或密码错误" }, 401);
  }
  if (c.env.CACHE) {
    try { c.executionCtx?.waitUntil(c.env.CACHE.delete(rlKey)); } catch {}
  }
  const token = await signToken({ userId: user.id, username: user.username });
  return c.json({ token, user: { id: user.id, username: user.username, isAdmin: user.id === 1 } });
});

api.get("/auth/me", authMiddleware, async (c) => {
  const user = c.get("user");
  return c.json({ user: { ...user, isAdmin: user.userId === 1 } });
});

api.put("/auth/change-password", authMiddleware, async (c) => {
  requireDB(c);
  const user = c.get("user");
  const { oldPassword, newPassword } = await c.req.json();
  if (!oldPassword || !newPassword) return c.json({ error: "请输入新旧密码" }, 400);
  if (newPassword.length < 6) return c.json({ error: "新密码至少6个字符" }, 400);
  const u = await db.getUserById(c.env.DB, user.userId);
  if (!u) return c.json({ error: "用户不存在" }, 404);
  const valid = await verifyPassword(oldPassword, u.password_hash);
  if (!valid) return c.json({ error: "旧密码错误" }, 400);
  const hash = await hashPassword(newPassword);
  await db.updateUserPassword(c.env.DB, user.userId, hash);
  return c.json({ ok: true });
});

// ========== Admin routes ==========
api.get("/admin/users", authMiddleware, adminMiddleware, async (c) => {
  requireDB(c);
  const users = await db.listUsers(c.env.DB);
  return c.json({ users });
});

api.post("/admin/users", authMiddleware, adminMiddleware, async (c) => {
  requireDB(c);
  const { username, password } = await c.req.json();
  if (!username || !password) return c.json({ error: "用户名和密码不能为空" }, 400);
  if (username.length < 2 || username.length > 20) return c.json({ error: "用户名2-20个字符" }, 400);
  if (password.length < 6) return c.json({ error: "密码至少6个字符" }, 400);
  const existing = await db.getUserByUsername(c.env.DB, username);
  if (existing) return c.json({ error: "用户名已存在" }, 409);
  const hash = await hashPassword(password);
  const user = await db.createUser(c.env.DB, username, hash);
  return c.json({ user: { id: user.id, username: user.username } }, 201);
});

api.delete("/admin/users/:id", authMiddleware, adminMiddleware, async (c) => {
  requireDB(c);
  const id = parseInt(c.req.param("id"));
  if (id === 1) return c.json({ error: "不能删除管理员" }, 400);
  await db.deleteUser(c.env.DB, id);
  return c.json({ ok: true });
});

api.put("/admin/users/:id/reset-password", authMiddleware, adminMiddleware, async (c) => {
  requireDB(c);
  const id = parseInt(c.req.param("id"));
  const { password } = await c.req.json();
  if (!password || password.length < 6) return c.json({ error: "密码至少6个字符" }, 400);
  const hash = await hashPassword(password);
  await db.updateUserPassword(c.env.DB, id, hash);
  return c.json({ ok: true });
});

// ========== Rate limiting for public read endpoints ==========
api.use("/sources", rateLimit);
api.use("/homepage", rateLimit);
api.use("/search", rateLimit);
api.use("/search/stream", rateLimit);

// ========== Source list ==========
api.get("/sources", async (c) => {
  return c.json({ sources: getRegistry().getSearchableSources() });
});

// ========== Homepage ==========
api.get("/homepage", async (c) => {
  const tag = c.req.query("tag") || "";
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
  try {
    const result = await getRegistry().getHomepageBooks(tag || undefined, page);
    return c.json({ books: result.books, tag, page, totalPages: result.totalPages });
  } catch (e) {
    console.error(e);
    return c.json({ error: "服务暂时不可用" }, 502);
  }
});

// ========== Search (streaming SSE) ==========
api.post("/search/stream", async (c) => {
  const { keyword, sites } = await c.req.json<{ keyword: string; sites: string[] }>();
  if (!keyword?.trim()) return c.json({ error: "关键词不能为空" }, 400);

  const registry = getRegistry();
  const kw = keyword.trim();

  // URL resolve
  try {
    new URL(kw);
    const resolved = registry.resolveURL(kw);
    if (resolved) {
      const detail = await registry.getBookDetail(resolved.siteKey, resolved.bookId);
      return c.json({
        urlSearch: true,
        item: { key: `${resolved.siteKey}|${resolved.bookId}`, site: resolved.siteKey, bookId: resolved.bookId, title: detail.title, author: detail.author, description: detail.description, coverUrl: detail.coverUrl, url: detail.sourceUrl },
      });
    }
  } catch {}

  const targetSources: string[] = (sites && sites.length > 0)
    ? sites.filter((k: string) => registry.getSource(k))
    : registry.getSearchableSources().map(s => s.key);

  const sitesKey = (targetSources || []).sort().join(",");
  const cacheKey = `v2:search:${kw.toLowerCase()}:${sitesKey}`;
  let cached: { results: any[] } | null = null;
  if (c.env.CACHE) {
    try { cached = await c.env.CACHE.get(cacheKey, "json"); } catch {}
  }

  return streamSSE(c, async (stream) => {
    if (cached?.results?.length) {
      // Group cached items by site so client `onResult(site, items)` semantics still hold.
      const bySite = new Map<string, any[]>();
      for (const it of cached.results) {
        const arr = bySite.get(it.site) || [];
        arr.push(it);
        bySite.set(it.site, arr);
      }
      for (const [site, items] of bySite) {
        await stream.writeSSE({ data: JSON.stringify({ site, results: items }) });
      }
      await stream.writeSSE({ data: JSON.stringify({ done: true }) });
      return;
    }

    const aggregated: any[] = [];
    const pending = targetSources.map(async (siteKey: string) => {
      try {
        const items = await Promise.race([
          registry.getSource(siteKey)!.search(kw, 10),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
        ]);
        for (const item of items) {
          aggregated.push({ ...item, site: siteKey });
          await stream.writeSSE({ data: JSON.stringify({ site: siteKey, results: [item] }) });
        }
      } catch (e) {
        console.error(e);
        await stream.writeSSE({ data: JSON.stringify({ site: siteKey, error: "搜索失败" }) });
      }
    });
    await Promise.allSettled(pending);
    await stream.writeSSE({ data: JSON.stringify({ done: true }) });
    if (c.env.CACHE && aggregated.length) {
      c.executionCtx?.waitUntil(c.env.CACHE.put(cacheKey, JSON.stringify({ results: aggregated }), { expirationTtl: 300 }));
    }
  });
});

// Non-streaming fallback
api.post("/search", async (c) => {
  const { keyword, sites } = await c.req.json();
  if (!keyword?.trim()) return c.json({ error: "关键词不能为空" }, 400);

  const k = keyword.trim();
  const sitesKey = ((sites as string[]) || []).sort().join(",");
  const cacheKey = `v2:search:${k.toLowerCase()}:${sitesKey}`;
  if (c.env.CACHE) {
    try { const cached = await c.env.CACHE.get(cacheKey, "json"); if (cached) return c.json(cached); } catch {}
  }

  const registry = getRegistry();
  try {
    new URL(keyword);
    const resolved = registry.resolveURL(keyword);
    if (resolved) {
      const detail = await registry.getBookDetail(resolved.siteKey, resolved.bookId);
      return c.json({
        urlSearch: true,
        item: { key: `${resolved.siteKey}|${resolved.bookId}`, site: resolved.siteKey, bookId: resolved.bookId, title: detail.title, author: detail.author, description: detail.description, coverUrl: detail.coverUrl, url: detail.sourceUrl },
      });
    }
  } catch {}
  const results = await registry.searchAll(sites || [], k, 50);
  const resp = { results };
  if (c.env.CACHE) c.executionCtx?.waitUntil(c.env.CACHE.put(cacheKey, JSON.stringify(resp), { expirationTtl: 300 }));
  return c.json(resp);
});

// ========== Book detail ==========
api.get("/books/:site/:bookId", async (c) => {
  const { site, bookId } = c.req.param();
  const page = parseInt(c.req.query("page") || "1");
  const pageSize = Math.min(parseInt(c.req.query("page_size") || "100"), 500);
  // Cache key includes page + version to avoid stale data
  const cacheKey = `v2:book:${site}:${bookId}:p${page}`;
  if (c.env.CACHE) { try { const cached = await c.env.CACHE.get(cacheKey, "json"); if (cached) return c.json(cached); } catch {} }
  try {
    const detail = await getRegistry().getBookDetail(site, bookId);
    const total = detail.chapters.length;
    const totalPages = Math.ceil(total / pageSize);
    const p = Math.min(page, totalPages || 1);
    const start = (p - 1) * pageSize;
    const response = { ...detail, chapters: detail.chapters.slice(start, start + pageSize), chapterPage: { page: p, pageSize, total, hasPrev: p > 1, hasNext: p < totalPages } };
    if (c.env.CACHE) { c.executionCtx?.waitUntil(c.env.CACHE.put(cacheKey, JSON.stringify(response), { expirationTtl: 600 })); }
    return c.json(response);
  } catch (e: any) { console.error(e); return c.json({ error: `服务暂时不可用: ${e.message}` }, 502); }
});

// ========== Chapter content ==========
api.get("/books/:site/:bookId/:chapterId", async (c) => {
  const { site, bookId, chapterId } = c.req.param();
  const cacheKey = `v2:chapter:${site}:${bookId}:${chapterId}`;
  if (c.env.CACHE) { try { const cached = await c.env.CACHE.get(cacheKey, "json"); if (cached) return c.json(cached); } catch {} }
  try {
    const content = await getRegistry().getChapterContent(site, bookId, { id: chapterId, url: c.req.query("url") || "", title: c.req.query("title") || "" });
    if (c.env.CACHE) { c.executionCtx?.waitUntil(c.env.CACHE.put(cacheKey, JSON.stringify(content), { expirationTtl: 1800 })); }
    return c.json(content);
  } catch (e: any) { console.error(e); return c.json({ error: "服务暂时不可用" }, 502); }
});

// ========== Bookshelf (authenticated) ==========
api.get("/bookshelf", authMiddleware, async (c) => {
  requireDB(c); const items = await db.listBookshelf(c.env.DB, c.get("user").userId);
  return c.json({ items });
});
api.post("/bookshelf", authMiddleware, async (c) => {
  requireDB(c); const u = c.get("user"); const b = await c.req.json();
  const item = await db.addToBookshelf(c.env.DB, u.userId, { site: b.site, bookId: b.bookId, title: b.title || "", author: b.author || "", coverUrl: b.coverUrl || "", description: b.description || "", sourceUrl: b.sourceUrl || "" });
  return c.json({ item }, 201);
});
api.delete("/bookshelf/:site/:bookId", authMiddleware, async (c) => {
  const u = c.get("user"); const { site, bookId } = c.req.param();
  const removed = await db.removeFromBookshelf(c.env.DB, u.userId, site, bookId);
  if (!removed) return c.json({ error: "未找到" }, 404);
  return c.json({ ok: true });
});

api.put("/bookshelf/:site/:bookId/progress", authMiddleware, async (c) => {
  requireDB(c);
  const u = c.get("user"); const { site, bookId } = c.req.param();
  const { chapterIndex, chapterId, chapterTitle } = await c.req.json();
  if (typeof chapterId !== "string" || typeof chapterTitle !== "string" || typeof chapterIndex !== "number") {
    return c.json({ error: "参数错误" }, 400);
  }
  await db.updateReadingProgress(c.env.DB, u.userId, site, bookId, chapterIndex, chapterId, chapterTitle);
  return c.json({ ok: true });
});

// ========== History (authenticated) ==========
api.get("/history", authMiddleware, async (c) => {
  requireDB(c); const items = await db.listHistory(c.env.DB, c.get("user").userId);
  return c.json({ items });
});
api.post("/history", authMiddleware, async (c) => {
  requireDB(c); const u = c.get("user"); const b = await c.req.json();
  await db.addHistory(c.env.DB, u.userId, { site: b.site, bookId: b.bookId, title: b.title || "", author: b.author || "", coverUrl: b.coverUrl || "", chapterId: b.chapterId || "", chapterTitle: b.chapterTitle || "" });
  return c.json({ ok: true });
});
api.delete("/history", authMiddleware, async (c) => {
  requireDB(c);
  await c.env.DB!.prepare("DELETE FROM history WHERE user_id = ?").bind(c.get("user").userId).run();
  return c.json({ ok: true });
});

export default api;
