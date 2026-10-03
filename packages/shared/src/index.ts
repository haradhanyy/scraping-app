import { z } from "zod";

export const PlatformSchema = z.enum(["instagram", "threads"]);
export type Platform = z.infer<typeof PlatformSchema>;

export const JobStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "RATE_LIMITED",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const PostTypeSchema = z.enum(["POST", "REEL", "THREAD"]);
export type PostType = z.infer<typeof PostTypeSchema>;

export const SentimentSchema = z.enum(["POSITIVE", "NEGATIVE", "NEUTRAL"]);
export type Sentiment = z.infer<typeof SentimentSchema>;

export const TargetStatusSchema = z.enum(["LIVE", "IDLE", "PROCESSING", "ERROR"]);
export type TargetStatus = z.infer<typeof TargetStatusSchema>;

// ---------- Target / Account DTOs ----------

export const TrackedTargetSchema = z.object({
  id: z.string(),
  platform: PlatformSchema,
  handle: z.string(),
  displayName: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  profileUrl: z.string().url(),
  status: TargetStatusSchema,
  scope: z.string(),
  schedule: z.string().nullable().optional(),
  lastScrapedAt: z.string().nullable().optional(),
  metrics: z.object({
    followers: z.number(),
    mentionVolume: z.number(),
    growthPct: z.number().nullable().optional(),
    sparkline: z.array(z.number()).default([]),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TrackedTargetDTO = z.infer<typeof TrackedTargetSchema>;

export const CreateTargetSchema = z.object({
  platform: PlatformSchema,
  handle: z.string().min(1).max(100).regex(/^[A-Za-z0-9._]+$/),
  scrapeFrequency: z.string().optional(),
  maxPosts: z.coerce.number().int().min(1).max(100).default(10),
  maxComments: z.coerce.number().int().min(0).max(500).default(0),
});
export type CreateTargetInput = z.infer<typeof CreateTargetSchema>;

export const UpdateTargetSchema = z.object({
  isActive: z.boolean().optional(),
  scrapeFrequency: z.string().optional(),
  maxPosts: z.coerce.number().int().min(1).max(100).optional(),
  maxComments: z.coerce.number().int().min(0).max(500).optional(),
});
export type UpdateTargetInput = z.infer<typeof UpdateTargetSchema>;

export const TargetIdParamSchema = z.object({
  id: z.string().cuid(),
});
export type TargetIdParam = z.infer<typeof TargetIdParamSchema>;

// ---------- Metrics DTOs ----------

export const MetricPointSchema = z.object({
  recordedAt: z.string(),
  followers: z.number(),
  mentionVolume: z.number(),
});
export type MetricPointDTO = z.infer<typeof MetricPointSchema>;

export const MetricTimelineSchema = z.object({
  targetId: z.string(),
  points: z.array(MetricPointSchema),
});
export type MetricTimelineDTO = z.infer<typeof MetricTimelineSchema>;

// ---------- Post DTOs ----------

export const PostSchema = z.object({
  id: z.string(),
  targetId: z.string(),
  platform: PlatformSchema,
  postUrl: z.string().url(),
  type: PostTypeSchema,
  caption: z.string().nullable().optional(),
  likes: z.number(),
  commentsCount: z.number(),
  views: z.number().nullable().optional(),
  mediaUrls: z.array(z.string().url()).default([]),
  hashtags: z.array(z.string()).default([]),
  mentions: z.array(z.string()).default([]),
  postedAt: z.string(),
  scrapedAt: z.string(),
});
export type PostDTO = z.infer<typeof PostSchema>;

export const PostFilterSchema = z.object({
  platform: PlatformSchema.optional(),
  targetHandle: z.string().optional(),
  keyword: z.string().optional(),
  hashtag: z.string().optional(),
  type: PostTypeSchema.optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  sortBy: z.enum(["postedAt", "likes", "commentsCount", "views"]).default("postedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});
export type PostFilterInput = z.infer<typeof PostFilterSchema>;

export const PaginatedPostsSchema = z.object({
  data: z.array(PostSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type PaginatedPostsDTO = z.infer<typeof PaginatedPostsSchema>;

// ---------- Comment DTOs ----------

export const CommentSchema = z.object({
  id: z.string(),
  postId: z.string(),
  targetId: z.string(),
  author: z.string(),
  text: z.string(),
  sentiment: SentimentSchema.nullable().optional(),
  keywords: z.array(z.string()).default([]),
  postedAt: z.string(),
  scrapedAt: z.string(),
});
export type CommentDTO = z.infer<typeof CommentSchema>;

// ---------- Scrape Job DTOs ----------

const USERNAME_RE = /^@?[A-Za-z0-9._]{1,30}$/;

export const CreateJobSchema = z.object({
  targetId: z.string().cuid(),
  maxPosts: z.coerce.number().int().min(1).max(100).default(10),
  maxComments: z.coerce.number().int().min(0).max(500).default(0),
});
export type CreateJobInput = z.infer<typeof CreateJobSchema>;

/**
 * Legacy job creation shape used by the existing dashboard form:
 * a platform + free-form target (username or full URL).
 * The API derives/creates a TrackedTarget from this, so the target
 * also shows up in GET /api/v1/targets.
 */
export const LegacyCreateJobSchema = z.object({
  platform: PlatformSchema,
  target: z
    .string()
    .trim()
    .min(1, "Target is required")
    .max(512)
    .refine(
      (v) => v.startsWith("http://") || v.startsWith("https://") || USERNAME_RE.test(v),
      "Enter a full post/profile URL or a username (e.g. natgeo or https://www.instagram.com/p/...)",
    ),
  maxPosts: z.coerce.number().int().min(1).max(100).default(10),
  maxComments: z.coerce.number().int().min(0).max(500).default(0),
});
export type LegacyCreateJobInput = z.infer<typeof LegacyCreateJobSchema>;

/**
 * Extract a bare handle from a target that may be a username or a full URL.
 * Returns null when a handle cannot be derived (e.g. a single-post deep link).
 */
export function handleFromTarget(platform: Platform, target: string): string | null {
  const t = target.trim();
  if (!/^https?:\/\//i.test(t)) {
    const h = t.replace(/^@/, "");
    return USERNAME_RE.test(h) ? h : null;
  }
  try {
    const url = new URL(t);
    const segments = url.pathname.split("/").filter(Boolean);
    if (platform === "threads") {
      const seg = segments.find((s) => s.startsWith("@"));
      return seg ? seg.slice(1) : null;
    }
    // instagram: first segment is the handle unless it is a reserved route
    const reserved = new Set(["p", "reel", "reels", "explore", "stories", "tv", "accounts"]);
    const seg = segments[0];
    if (!seg || reserved.has(seg.toLowerCase())) return null;
    return seg;
  } catch {
    return null;
  }
}

export const JobIdParamSchema = z.object({
  id: z.string().cuid(),
});
export type JobIdParam = z.infer<typeof JobIdParamSchema>;

export const ScrapedPostSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  platform: PlatformSchema,
  author: z.string(),
  authorAvatar: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  likes: z.number().int().default(0),
  commentsCount: z.number().int().default(0),
  views: z.number().int().nullable().optional(),
  mediaUrls: z.array(z.string()).default([]),
  postUrl: z.string().nullable().optional(),
  postedAt: z.string().nullable().optional(),
  scrapedAt: z.string(),
});
export type ScrapedPostDTO = z.infer<typeof ScrapedPostSchema>;

export const JobSchema = z.object({
  id: z.string(),
  targetId: z.string(),
  platform: PlatformSchema,
  targetUrl: z.string().nullable().optional(),
  status: JobStatusSchema,
  attemptCount: z.number().int(),
  maxPosts: z.number().int(),
  maxComments: z.number().int(),
  error: z.string().nullable().optional(),
  temporalWorkflowId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable().optional(),
  posts: z.array(ScrapedPostSchema).optional(),
  _count: z.object({ posts: z.number().int() }).optional(),
});
export type JobDTO = z.infer<typeof JobSchema>;

// ---------- Utility functions ----------

/** Normalize a handle into a canonical profile URL. */
export function toProfileUrl(platform: Platform, handle: string): string {
  const h = handle.replace(/^@/, "").trim();
  if (platform === "instagram") return `https://www.instagram.com/${h}/`;
  return `https://www.threads.com/@${h}`;
}

/** Normalize a target into a canonical URL (legacy - for job creation). Returns null when it is a bare username. */
export function toTargetUrl(platform: Platform, target: string): string | null {
  const t = target.trim();
  if (/^https?:\/\//i.test(t)) return t;
  const username = t.replace(/^@/, "");
  if (platform === "instagram") return `https://www.instagram.com/${username}/`;
  return `https://www.threads.com/@${username}`;
}

/** Extract hashtags from caption text. */
export function extractHashtags(text: string): string[] {
  return [...text.matchAll(/#[A-Za-z0-9_]+/g)].map((m) => m[0].slice(1));
}

/** Extract @mentions from caption text. */
export function extractMentions(text: string): string[] {
  return [...text.matchAll(/@[A-Za-z0-9._]+/g)].map((m) => m[0].slice(1));
}

export const TEMPORAL_TASK_QUEUE = "scraping-queue";
export const SCRAPE_WORKFLOW_NAME = "scrapeWorkflow";