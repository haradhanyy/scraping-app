import { zValidator } from "@hono/zod-validator";
import { prisma } from "@scraping-app/db";
import {
  JobIdParamSchema,
  LegacyCreateJobSchema,
  SCRAPE_WORKFLOW_NAME,
  handleFromTarget,
  toProfileUrl,
} from "@scraping-app/shared";
import { Hono } from "hono";
import { getTemporalClient, taskQueue } from "../lib/temporal.js";

export const jobsRoute = new Hono()
  // POST /api/jobs — legacy contract: { platform, target, maxPosts }.
  // Derives (or creates) a TrackedTarget so the account also appears in /api/v1/targets.
  .post("/", zValidator("json", LegacyCreateJobSchema), async (c) => {
    const input = c.req.valid("json");
    const handle = handleFromTarget(input.platform, input.target);

    // A handle-less deep link (e.g. /p/ABC) can't be a persistent target,
    // so fall back to a synthetic handle derived from the URL to satisfy the FK.
    const targetHandle = handle ?? `adhoc-${Date.now().toString(36)}`;

    const target = await prisma.trackedTarget.upsert({
      where: {
        platform_handle: { platform: input.platform, handle: targetHandle },
      },
      create: {
        platform: input.platform,
        handle: targetHandle,
        profileUrl: toProfileUrl(input.platform, targetHandle),
      },
      update: {},
    });

    const job = await prisma.scrapeJob.create({
      data: {
        targetId: target.id,
        platform: input.platform,
        targetUrl: /^https?:\/\//i.test(input.target)
          ? input.target
          : target.profileUrl,
        maxPosts: input.maxPosts,
        maxComments: input.maxComments,
        // Stay QUEUED; markRunningActivity flips this once the worker picks it up.
        // This keeps a dead workflow from masquerading as RUNNING forever.
        status: "QUEUED",
      },
    });

    // Fire-and-forget workflow start; fall back to QUEUED if Temporal is down.
    try {
      const client = await getTemporalClient();
      await client.workflow.start(SCRAPE_WORKFLOW_NAME, {
        args: [{ jobId: job.id }],
        taskQueue: taskQueue(),
        workflowId: `scrape-${job.id}`,
        retry: { maximumAttempts: 1 }, // retries handled inside the workflow
      });
      await prisma.scrapeJob.update({
        where: { id: job.id },
        data: { temporalWorkflowId: `scrape-${job.id}` },
      });
    } catch (err) {
      console.error("[api] temporal start failed, job stays QUEUED:", err);
      await prisma.scrapeJob.update({
        where: { id: job.id },
        data: { error: "Temporal unavailable — retry to start workflow." },
      });
    }

    const fresh = await prisma.scrapeJob.findUniqueOrThrow({
      where: { id: job.id },
      include: { _count: { select: { posts: true } } },
    });
    return c.json(fresh, 201);
  })
  // GET /api/jobs — latest jobs
  .get("/", async (c) => {
    const jobs = await prisma.scrapeJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { _count: { select: { posts: true } } },
    });
    return c.json(jobs);
  })
  // GET /api/jobs/:id — job + posts
  .get("/:id", zValidator("param", JobIdParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const job = await prisma.scrapeJob.findUnique({
      where: { id },
      include: { posts: { orderBy: { scrapedAt: "desc" } } },
    });
    if (!job) return c.json({ error: "Job not found" }, 404);
    return c.json(job);
  })
  // POST /api/jobs/:id/retry — re-run workflow with incremented attemptCount
  .post("/:id/retry", zValidator("param", JobIdParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const existing = await prisma.scrapeJob.findUnique({ where: { id } });
    if (!existing) return c.json({ error: "Job not found" }, 404);

    const job = await prisma.scrapeJob.update({
      where: { id },
      data: {
        status: "QUEUED",
        error: null,
        attemptCount: { increment: 1 },
        temporalWorkflowId: null,
      },
    });

    try {
      const client = await getTemporalClient();
      await client.workflow.start(SCRAPE_WORKFLOW_NAME, {
        args: [{ jobId: job.id }],
        taskQueue: taskQueue(),
        workflowId: `scrape-${job.id}-retry-${job.attemptCount}-${Date.now()}`,
        retry: { maximumAttempts: 1 },
      });
      await prisma.scrapeJob.update({
        where: { id: job.id },
        data: { temporalWorkflowId: `scrape-${job.id}-retry-${job.attemptCount}` },
      });
    } catch (err) {
      console.error("[api] temporal retry failed:", err);
      return c.json({ error: "Temporal unavailable, job queued for later retry." }, 503);
    }

    const fresh = await prisma.scrapeJob.findUniqueOrThrow({
      where: { id: job.id },
      include: { _count: { select: { posts: true } } },
    });
    return c.json(fresh);
  });