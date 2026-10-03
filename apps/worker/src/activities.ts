import { Context } from "@temporalio/activity";
import { prisma } from "@scraping-app/db";
import type { RawPost } from "./scrapers/common.js";
import { scrapeInstagram, RateLimitedError } from "./scrapers/instagram.js";
import { scrapeThreads } from "./scrapers/threads.js";

export { RateLimitedError };

export interface ScrapeInput {
  jobId: string;
}

/** Load job row; throws if missing (non-retryable via workflow config). */
export async function loadJobActivity({ jobId }: ScrapeInput) {
  const job = await prisma.scrapeJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { target: true },
  });
  return {
    id: job.id,
    platform: job.platform as "instagram" | "threads",
    targetUrl: job.targetUrl,
    maxPosts: job.maxPosts,
  };
}

export async function markRunningActivity({ jobId }: ScrapeInput) {
  await prisma.scrapeJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", attemptCount: { increment: 1 }, error: null },
  });
}

/**
 * Core scraping activity. Heartbeats so long page loads can be cancelled;
 * maps scraper failures to typed errors the workflow can branch on.
 */
export async function runScraperActivity({ jobId }: ScrapeInput): Promise<RawPost[]> {
  const job = await prisma.scrapeJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { target: true },
  });
  const targetUrl = job.targetUrl ?? job.target?.profileUrl ?? "";
  if (!targetUrl) throw new Error("No target URL available for job");
  Context.current().heartbeat({ jobId, stage: "scrape-start", targetUrl });

  try {
    const posts =
      job.platform === "instagram"
        ? await scrapeInstagram(targetUrl, job.maxPosts)
        : await scrapeThreads(targetUrl, job.maxPosts);
    Context.current().heartbeat({ jobId, stage: "scrape-done", count: posts.length });
    return posts;
  } catch (err) {
    if (err instanceof RateLimitedError) throw err; // workflow catches separately
    throw err;
  }
}

export async function savePostsActivity({
  jobId,
  posts,
}: ScrapeInput & { posts: RawPost[] }) {
  const job = await prisma.scrapeJob.findUniqueOrThrow({ where: { id: jobId } });
  if (posts.length === 0) return { saved: 0 };

  // Replace previous results for idempotent retries.
  await prisma.scrapedPost.deleteMany({ where: { jobId } });
  await prisma.scrapedPost.createMany({
    data: posts.map((p) => ({
      jobId,
      platform: job.platform,
      author: p.author.slice(0, 255),
      authorAvatar: p.authorAvatar ?? null,
      caption: p.caption?.slice(0, 8000) ?? null,
      likes: Number.isFinite(p.likes) ? p.likes : 0,
      commentsCount: Number.isFinite(p.commentsCount) ? p.commentsCount : 0,
      mediaUrls: p.mediaUrls.slice(0, 10),
      postUrl: p.postUrl ?? null,
      postedAt: p.postedAt ? new Date(p.postedAt) : null,
    })),
  });
  return { saved: posts.length };
}

export async function markCompletedActivity({ jobId }: ScrapeInput) {
  await prisma.scrapeJob.update({
    where: { id: jobId },
    data: { status: "COMPLETED", error: null, completedAt: new Date() },
  });
  // Keep the dashboard card's "last scraped" accurate.
  await prisma.trackedTarget.updateMany({
    where: { jobs: { some: { id: jobId } } },
    data: { lastScrapedAt: new Date() },
  });
}

export async function markFailedActivity({
  jobId,
  error,
  rateLimited,
}: ScrapeInput & { error: string; rateLimited?: boolean }) {
  await prisma.scrapeJob.update({
    where: { id: jobId },
    data: { status: rateLimited ? "RATE_LIMITED" : "FAILED", error: error.slice(0, 4000), completedAt: new Date() },
  });
}