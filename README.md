# ScrapeDeck — Instagram & Threads Scraping Platform

Bun monorepo: Hono API + Temporal workflows + Playwright scrapers + React dashboard.

## Quickstart

```bash
cp .env.example .env
docker compose -f docker/docker-compose.yml up -d  # postgres :5432, temporal :7233, ui :8233
bun install
bun run db:push            # create tables (or db:migrate)
bunx playwright install chromium  # worker browser (in apps/worker)

# 3 terminals:
bun run dev:api     # Hono :3001
bun run dev:worker  # Temporal worker
bun run dev:web     # Vite :5173
```

Open http://localhost:5173 → submit `natgeo` / post URL → watch live status → inspect posts.
Temporal UI: http://localhost:8233.

## Architecture

```
web (TanStack Query) → Hono API (/api/jobs) → Postgres (QUEUED/RUNNING)
                                              → Temporal workflow scrape-{jobId}
                                                  → activities: markRunning → runScraper → savePosts → markCompleted
worker: Playwright (render) + Cheerio (parse) per platform
```

- Retries: workflow-level 4 attempts (5s/20s/60s), 2-min cooldown on `RateLimitedError`; activity retries disabled for scrape (workflow owns backoff).
- Idempotent: `savePosts` deletes prior rows for the job before `createMany`.
- Hono RPC: `AppType` exported from `apps/api/src/index.ts`; web uses matching DTOs in `lib/types.ts`.

## Notes / limits

- Instagram/Threads aggressively require login & rate-limit datacenter IPs. Expect `RATE_LIMITED` on anonymous access — the dashboard surfaces the message and retry button. Setting a real session cookie is the usual production fix (see `SCRAPER_HEADLESS` / cookie envs).
- Selectors drift often; scrapers try embedded-JSON first, DOM second, OG-meta fallback last.
```
