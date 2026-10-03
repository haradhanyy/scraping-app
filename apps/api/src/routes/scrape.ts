import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { prisma } from "@scraping-app/db";
import {
  CreateJobSchema,
  JobIdParamSchema,
  JobSchema,
  ScrapedPostSchema,
  toProfileUrl,
  SCRAPE_WORKFLOW_NAME,
  TEMPORAL_TASK_QUEUE,
} from "@scraping-app/shared";
import { getTemporalClient, taskQueue } from "../lib/temporal.js";

export const scrapeRoute = new Hono()
  // POST /api/v1/scrape — trigger on-demand scrape for a target
  .post("/", zValidator("json", CreateJobSchema), async (c) => {
    const input = c.req.valid("json");

    const target = await prisma.trackedTarget.findUnique({
      where: { id: input.targetId },
    });
    if (!target) return c.json({ error: "Target not found" }, 404);
    if (!target.isActive) return c.json({ error: "Target is inactive" }, 400);

    const job = await prisma.scrapeJob.create({
      data: {
        targetId: target.id,
        platform: target.platform,
        targetUrl: target.profileUrl,
        maxPosts: input.maxPosts,
        maxComments: input.maxComments,
        // QUEUED until a worker actually picks it up (see markRunningActivity).
        status: "QUEUED",
      },
    });

    // Start Temporal workflow
    try {
      const client = await getTemporalClient();
      await client.workflow.start(SCRAPE_WORKFLOW_NAME, {
        args: [{ jobId: job.id }],
        taskQueue: taskQueue(),
        workflowId: `scrape-${job.id}`,
        retry: { maximumAttempts: 1 },
      });
      await prisma.scrapeJob.update({
        where: { id: job.id },
        data: { temporalWorkflowId: `scrape-${job.id}` },
      });
    } catch (err) {
      console.error("[api] temporal start failed:", err);
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

  // GET /api/v1/scrape/jobs — list recent scrape jobs
  .get("/jobs", async (c) => {
    const jobs = await prisma.scrapeJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { _count: { select: { posts: true } }, target: { select: { handle: true } } },
    });
    return c.json(jobs);
  })

  // GET /api/v1/scrape/jobs/:id — job detail with scraped posts
  .get("/jobs/:id", zValidator("param", JobIdParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const job = await prisma.scrapeJob.findUnique({
      where: { id },
      include: {
        posts: { orderBy: { scrapedAt: "desc" } },
        target: { select: { handle: true, platform: true } },
      },
    });
    if (!job) return c.json({ error: "Job not found" }, 404);
    return c.json(job);
  })

  // POST /api/v1/scrape/jobs/:id/retry — retry failed job
  .post("/jobs/:id/retry", zValidator("param", JobIdParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const existing = await prisma.scrapeJob.findUnique({
      where: { id },
      include: { target: true },
    });
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