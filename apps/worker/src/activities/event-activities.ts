import { Context } from "@temporalio/activity";
import { prisma } from "@scraping-app/db";
import { scrapeInstagram, RateLimitedError } from "../scrapers/instagram.js";
import { scrapeThreads } from "../scrapers/threads.js";
import { extractHashtags, extractMentions } from "../scrapers/common.js";
import { generateEventId } from "@scraping-app/shared";
import { createHash, randomBytes } from "crypto";

export { RateLimitedError };

export interface EventInput {
  eventId: string;
}

interface ScrapePayload {
  instagramPostUrl?: string;
  threadsPostUrl?: string;
  scrapeLikes?: boolean;
  scrapeCommentNumber?: boolean;
  scrapeViews?: boolean;
  scrapeComments?: boolean;
  maxComments?: number;
}

interface ScrapeResult {
  posts: Array<{
    author: string;
    authorAvatar?: string | null;
    caption?: string | null;
    likes: number;
    commentsCount: number;
    views?: number;
    mediaUrls: string[];
    postUrl?: string | null;
    postedAt?: string | null;
    type?: "POST" | "REEL" | "THREAD";
    hashtags?: string[];
    mentions?: string[];
  }>;
  targetHandle?: string;
  targetPlatform?: "instagram" | "threads";
  followerCount?: number;
}

interface FireWebhookInput {
  webhookUrl: string;
  webhookSecret?: string;
  payload: Record<string, unknown>;
}

/** Load ScrapeEvent record */
export async function loadEventActivity({ eventId }: EventInput) {
  const event = await prisma.scrapeEvent.findUniqueOrThrow({
    where: { eventId },
    include: { user: { include: { webhooks: { where: { isActive: true }, take: 1 } } } },
  });

  return {
    id: event.id,
    eventId: event.eventId,
    type: event.type,
    userId: event.userId,
    targetId: event.targetId,
    payload: event.payload as ScrapePayload,
    webhookUrl: event.webhookUrl ?? event.user?.webhooks?.[0]?.url ?? null,
    webhookSecret: event.webhookSecret ?? event.user?.webhooks?.[0]?.secret ?? null,
  };
}

export async function markEventRunningActivity({ eventId }: EventInput) {
  await prisma.scrapeEvent.update({
    where: { eventId },
    data: { status: "RUNNING", startedAt: new Date() },
  });
}

export async function runScraperEventActivity({ eventId }: EventInput): Promise<ScrapeResult> {
  const event = await prisma.scrapeEvent.findUniqueOrThrow({
    where: { eventId },
  });

  const payload = event.payload as ScrapePayload;
  const targetUrl = payload.instagramPostUrl ?? payload.threadsPostUrl;
  if (!targetUrl) throw new Error("No target URL in payload");

  Context.current().heartbeat({ eventId, stage: "scrape-start", targetUrl });

  try {
    let posts;
    const options = {
      maxPosts: 1, // single URL scrape
      scrapeViews: payload.scrapeViews,
      scrapeComments: payload.scrapeComments,
      maxComments: payload.maxComments,
    };

    if (event.type.startsWith("SCRAPE_INSTAGRAM")) {
      posts = await scrapeInstagram(targetUrl, options);
    } else {
      posts = await scrapeThreads(targetUrl, options);
    }

    Context.current().heartbeat({ eventId, stage: "scrape-done", count: posts.length });

    // Derive target handle from URL if possible
    let targetHandle: string | undefined;
    if (event.type.startsWith("SCRAPE_INSTAGRAM")) {
      const match = targetUrl.match(/instagram\.com\/([A-Za-z0-9._]+)/);
      targetHandle = match?.[1];
    } else {
      const match = targetUrl.match(/threads\.net\/@([A-Za-z0-9._]+)/);
      targetHandle = match?.[1];
    }

    return {
      posts,
      targetHandle,
      targetPlatform: event.type.startsWith("SCRAPE_INSTAGRAM") ? "instagram" : "threads",
    };
  } catch (err) {
    if (err instanceof RateLimitedError) throw err;
    throw err;
  }
}

export async function saveEventResultActivity({
  eventId,
  result,
}: EventInput & { result: ScrapeResult }) {
  const event = await prisma.scrapeEvent.findUniqueOrThrow({ where: { eventId } });
  const payload = event.payload as ScrapePayload;

  if (result.posts.length === 0) {
    return { saved: 0 };
  }

  const post = result.posts[0];
  const platform = result.targetPlatform ?? "instagram";
  const handle = result.targetHandle ?? "unknown";

  // Upsert TrackedTarget
  let target = await prisma.trackedTarget.findUnique({
    where: { platform_handle: { platform: platform as any, handle } },
  });

  if (!target) {
    target = await prisma.trackedTarget.create({
      data: {
        platform: platform as any,
        handle,
        profileUrl: platform === "instagram"
          ? `https://www.instagram.com/${handle}/`
          : `https://www.threads.com/@${handle}`,
        userId: event.userId,
      },
    });
  }

  // Upsert Post
  const postUrl = post.postUrl ?? (payload.instagramPostUrl ?? payload.threadsPostUrl ?? "");
  const savedPost = await prisma.post.upsert({
    where: { postUrl },
    create: {
      targetId: target.id,
      platform: platform as any,
      postUrl,
      type: (post.type ?? "POST") as any,
      caption: post.caption?.slice(0, 8000) ?? null,
      likes: post.likes,
      commentsCount: post.commentsCount,
      views: post.views,
      mediaUrls: post.mediaUrls,
      hashtags: post.hashtags ?? [],
      mentions: post.mentions ?? [],
      postedAt: post.postedAt ? new Date(post.postedAt) : new Date(),
    },
    update: {
      caption: post.caption?.slice(0, 8000) ?? null,
      likes: post.likes,
      commentsCount: post.commentsCount,
      views: post.views,
      mediaUrls: post.mediaUrls,
      hashtags: post.hashtags ?? [],
      mentions: post.mentions ?? [],
      scrapedAt: new Date(),
    },
  });

  // Update MetricSnapshot (followers from profile if available)
  // For now just increment mentionVolume
  await prisma.metricSnapshot.create({
    data: {
      targetId: target.id,
      followers: 0, // would need profile scrape to get actual count
      mentionVolume: 1,
    },
  });

  // Update target lastScrapedAt
  await prisma.trackedTarget.update({
    where: { id: target.id },
    data: { lastScrapedAt: new Date() },
  });

  // Update event with result
  await prisma.scrapeEvent.update({
    where: { eventId },
    data: { result: result as any },
  });

  return { saved: 1, postId: savedPost.id, targetId: target.id };
}

export async function markEventCompletedActivity({
  eventId,
  result,
}: EventInput & { result: ScrapeResult }) {
  await prisma.scrapeEvent.update({
    where: { eventId },
    data: { status: "COMPLETED", completedAt: new Date(), result: result as any },
  });
}

export async function markEventFailedActivity({
  eventId,
  error,
  rateLimited,
}: EventInput & { error: string; rateLimited?: boolean }) {
  await prisma.scrapeEvent.update({
    where: { eventId },
    data: { status: rateLimited ? "RATE_LIMITED" : "FAILED", error: error.slice(0, 4000), completedAt: new Date() },
  });
}

export async function fireWebhookActivity({
  webhookUrl,
  webhookSecret,
  payload,
}: FireWebhookInput) {
  try {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "ScrapingAPI/1.0",
    };

    if (webhookSecret) {
      const signature = createHash("sha256")
        .update(webhookSecret + body)
        .digest("hex");
      headers["X-Signature"] = `sha256=${signature}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      console.error(`[webhook] Failed: ${resp.status} ${resp.statusText}`);
    }
  } catch (err) {
    console.error("[webhook] Error firing:", err);
  }
}