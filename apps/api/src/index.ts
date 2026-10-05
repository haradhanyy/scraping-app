import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { jobsRoute } from "./routes/jobs.js";
import { targetsRoute } from "./routes/targets.js";
import { postsRoute } from "./routes/posts.js";
import { scrapeRoute } from "./routes/scrape.js";
import { scrapeInstagramRoute } from "./routes/scrape-instagram.js";
import { scrapeThreadsRoute } from "./routes/scrape-threads.js";
import { apiKeysRoute } from "./routes/api-keys.js";

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));

// API v1 routes
app.route("/api/v1/targets", targetsRoute);
app.route("/api/v1/posts", postsRoute);
app.route("/api/v1/scrape", scrapeRoute);
app.route("/api/v1/api-keys", apiKeysRoute);

// New scrape endpoints with API key auth
app.route("/scrape/instagram", scrapeInstagramRoute);
app.route("/scrape/threads", scrapeThreadsRoute);

// Legacy routes (for backward compatibility with existing web dashboard)
app.route("/api/jobs", jobsRoute);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error("[api] unhandled:", err);
  return c.json({ error: "Internal server error" }, 500);
});

const port = Number(process.env.API_PORT ?? 3001);
console.log(`[api] listening on :${port}`);

export default {
  port,
  fetch: app.fetch,
};

export type AppType = typeof app;