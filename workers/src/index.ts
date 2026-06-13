// Main entry point — Cloudflare Worker with Hono
import { Hono } from "hono";
import { cors } from "hono/cors";
import apiRoutes from "./api/index";
import { initSchema, ensureAdmin } from "./db/schema";
import type { D1Database } from "@cloudflare/workers-types";

type Bindings = {
  DB?: D1Database;
  CACHE?: KVNamespace;
  JWT_SECRET?: string;
  ALLOWED_ORIGINS?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS — allow frontend requests
app.use("*", cors({
  origin: (origin, c) => {
    if (!origin) return "*";
    const allowed = (c.env as Bindings).ALLOWED_ORIGINS || "";
    const origins = allowed.split(",").map(s => s.trim()).filter(Boolean);
    if (origins.length > 0) {
      try {
        const u = new URL(origin);
        return origins.some(o => { try { return u.hostname === new URL(o).hostname; } catch { return false; } }) ? origin : null;
      } catch { return null; }
    }
    return origin || "*"; // allow all if ALLOWED_ORIGINS not set
  },
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
}));

// Global error handler — ensure all errors return JSON, never empty body
app.onError((err, c) => {
  console.error("Worker error:", err.message);
  return c.json({ error: "服务器内部错误" }, 500);
});

// 404 handler — all unmatched routes return JSON
app.notFound((c) => {
  return c.json({ error: "接口不存在" }, 404);
});

// Health check
app.get("/health", (c) => c.json({ status: "ok", db: !!c.env.DB, time: new Date().toISOString() }));

// Mount API routes
app.route("/api", apiRoutes);

// Init DB schema + admin on first request
let initPromise: Promise<void> | null = null;
async function ensureInit(db?: D1Database) {
  if (initPromise) return initPromise;
  if (!db) return;
  initPromise = (async () => {
    await initSchema(db);
    await ensureAdmin(db);
  })().catch((e) => {
    console.error("DB init failed:", e.message);
    initPromise = null; // allow retry on next request
  });
  return initPromise;
}

const handler: ExportedHandler<Bindings> = {
  async fetch(request, env, ctx) {
    (globalThis as unknown as Record<string, unknown>).JWT_SECRET = env.JWT_SECRET || "novel-reader-prod-secret-change-me";
    if (!initPromise) await ensureInit(env.DB);
    return app.fetch(request, env, ctx);
  },
};

export default handler;
