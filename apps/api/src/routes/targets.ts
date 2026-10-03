import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { prisma } from "@scraping-app/db";
import {
  CreateTargetSchema,
  TargetIdParamSchema,
  TrackedTargetSchema,
  UpdateTargetSchema,
  MetricTimelineSchema,
  TrackedTargetDTO,
  MetricTimelineDTO,
  toProfileUrl,
  PlatformSchema,
} from "@scraping-app/shared";

export const targetsRoute = new Hono()
  // GET /api/v1/targets — list all tracked targets with dashboard card data
  .get("/", async (c) => {
    const targets = await prisma.trackedTarget.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { posts: true, comments: true } },
        metrics: {
          orderBy: { recordedAt: "desc" },
          take: 1,
        },
      },
    });

    const targetIds = targets.map((t) => t.id);

    // Batch fetch sparkline data (last 30 metric points per target)
    const metrics = await prisma.metricSnapshot.findMany({
      where: {
        targetId: { in: targetIds },
        recordedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { recordedAt: "asc" },
    });

    const sparklineMap = new Map<string, number[]>();
    for (const m of metrics) {
      const arr = sparklineMap.get(m.targetId) ?? [];
      arr.push(Number(m.mentionVolume));
      sparklineMap.set(m.targetId, arr);
    }

    // Fetch previous metric for growth calculation
    const prevMetrics = await prisma.metricSnapshot.findMany({
      where: {
        targetId: { in: targetIds },
        recordedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { recordedAt: "desc" },
      distinct: ["targetId"],
    });
    const prevMetricMap = new Map(prevMetrics.map((m) => [m.targetId, Number(m.followers)]));

    const dto: TrackedTargetDTO[] = targets.map((t) => {
      const latest = t.metrics[0];
      const prevFollowers = prevMetricMap.get(t.id);
      const latestFollowers = latest ? Number(latest.followers) : 0;
      const growthPct = prevFollowers && prevFollowers > 0
        ? Number(((latestFollowers - prevFollowers) / prevFollowers) * 100).toFixed(1)
        : null;

      return {
        id: t.id,
        platform: t.platform,
        handle: t.handle,
        displayName: t.displayName ?? null,
        avatarUrl: t.avatarUrl ?? null,
        profileUrl: t.profileUrl,
        status: "LIVE" as const,
        scope: "Public posts, Reels/Threads, comments & @mentions, tracked keywords/hashtags",
        schedule: t.scrapeFrequency ?? "On demand",
        lastScrapedAt: t.lastScrapedAt?.toISOString() ?? null,
        metrics: {
          followers: latestFollowers,
          mentionVolume: Number(latest?.mentionVolume ?? 0),
          growthPct: growthPct ? Number(growthPct) : null,
          sparkline: sparklineMap.get(t.id) ?? [],
        },
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      };
    });

    return c.json(dto);
  })

  // POST /api/v1/targets — create a new tracked target
  .post("/", zValidator("json", CreateTargetSchema), async (c) => {
    const input = c.req.valid("json");
    const handle = input.handle.replace(/^@/, "");
    const profileUrl = toProfileUrl(input.platform, handle);

    const existing = await prisma.trackedTarget.findUnique({
      where: { platform_handle: { platform: input.platform, handle } },
    });
    if (existing) {
      return c.json({ error: "Target already exists" }, 409);
    }

    const target = await prisma.trackedTarget.create({
      data: {
        platform: input.platform,
        handle,
        profileUrl,
        scrapeFrequency: input.scrapeFrequency,
      },
    });

    // Create initial metric snapshot (0 followers)
    await prisma.metricSnapshot.create({
      data: { targetId: target.id, followers: 0, mentionVolume: 0 },
    });

    return c.json(target, 201);
  })

  // GET /api/v1/targets/:id — single target detail
  .get("/:id", zValidator("param", TargetIdParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const target = await prisma.trackedTarget.findUnique({
      where: { id },
      include: {
        metrics: { orderBy: { recordedAt: "desc" }, take: 1 },
        _count: { select: { posts: true, comments: true } },
      },
    });
    if (!target) return c.json({ error: "Target not found" }, 404);

    const latest = target.metrics[0];
    return c.json({
      id: target.id,
      platform: target.platform,
      handle: target.handle,
      displayName: target.displayName ?? null,
      avatarUrl: target.avatarUrl ?? null,
      profileUrl: target.profileUrl,
      status: "LIVE" as const,
      scope: "Public posts, Reels/Threads, comments & @mentions, tracked keywords/hashtags",
      schedule: target.scrapeFrequency ?? "On demand",
      lastScrapedAt: target.lastScrapedAt?.toISOString() ?? null,
      metrics: {
        followers: Number(latest?.followers ?? 0),
        mentionVolume: Number(latest?.mentionVolume ?? 0),
        growthPct: null,
        sparkline: [],
      },
      createdAt: target.createdAt.toISOString(),
      updatedAt: target.updatedAt.toISOString(),
    } satisfies TrackedTargetDTO);
  })

  // PATCH /api/v1/targets/:id — update target config
  .patch("/:id", zValidator("param", TargetIdParamSchema), zValidator("json", UpdateTargetSchema), async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");

    const target = await prisma.trackedTarget.update({
      where: { id },
      data: input,
    });
    return c.json(target);
  })

  // DELETE /api/v1/targets/:id — soft delete (deactivate)
  .delete("/:id", zValidator("param", TargetIdParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    await prisma.trackedTarget.update({
      where: { id },
      data: { isActive: false },
    });
    return c.json({ ok: true });
  })

  // GET /api/v1/targets/:id/metrics — historical metrics for charts
  .get("/:id/metrics", zValidator("param", TargetIdParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const points = await prisma.metricSnapshot.findMany({
      where: { targetId: id },
      orderBy: { recordedAt: "asc" },
    });
    return c.json({
      targetId: id,
      points: points.map((p) => ({
        recordedAt: p.recordedAt.toISOString(),
        followers: Number(p.followers),
        mentionVolume: p.mentionVolume,
      })),
    } satisfies MetricTimelineDTO);
  });