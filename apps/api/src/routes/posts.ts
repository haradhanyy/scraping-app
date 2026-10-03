import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { prisma } from "@scraping-app/db";
import {
  PostFilterSchema,
  PaginatedPostsSchema,
  PostSchema,
  PostFilterInput,
  PaginatedPostsDTO,
  PostDTO,
  CommentDTO,
} from "@scraping-app/shared";

export const postsRoute = new Hono()
  // GET /api/v1/posts — filter posts with pagination
  .get("/", zValidator("query", PostFilterSchema), async (c) => {
    const filters = c.req.valid("query");
    const {
      platform,
      targetHandle,
      keyword,
      hashtag,
      type,
      dateFrom,
      dateTo,
      limit,
      offset,
      sortBy,
      sortOrder,
    } = filters;

    const where: Record<string, unknown> = {};

    if (platform) where.platform = platform;
    if (type) where.type = type;
    if (dateFrom || dateTo) {
      where.postedAt = {};
      if (dateFrom) (where.postedAt as Record<string, Date>).gte = new Date(dateFrom);
      if (dateTo) (where.postedAt as Record<string, Date>).lte = new Date(dateTo);
    }
    if (keyword) {
      where.caption = { contains: keyword, mode: "insensitive" };
    }
    if (hashtag) {
      where.hashtags = { has: hashtag };
    }
    if (targetHandle) {
      where.target = { handle: { equals: targetHandle.replace(/^@/, ""), mode: "insensitive" } };
    }

    const [data, total] = await Promise.all([
      prisma.post.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        take: limit,
        skip: offset,
        include: { target: { select: { handle: true, platform: true } } },
      }),
      prisma.post.count({ where }),
    ]);

    const dto: PaginatedPostsDTO = {
      data: data.map((p) => ({
        id: p.id,
        targetId: p.targetId,
        platform: p.platform,
        postUrl: p.postUrl,
        type: p.type,
        caption: p.caption,
        likes: Number(p.likes),
        commentsCount: p.commentsCount,
        views: p.views ? Number(p.views) : null,
        mediaUrls: p.mediaUrls,
        hashtags: p.hashtags,
        mentions: p.mentions,
        postedAt: p.postedAt.toISOString(),
        scrapedAt: p.scrapedAt.toISOString(),
      })),
      total,
      limit,
      offset,
    };

    return c.json(dto);
  })

  // GET /api/v1/posts/:id — single post with comments
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const post = await prisma.post.findUnique({
      where: { id },
      include: {
        target: { select: { handle: true, platform: true } },
        comments: { orderBy: { postedAt: "desc" }, take: 50 },
      },
    });
    if (!post) return c.json({ error: "Post not found" }, 404);

    return c.json({
      id: post.id,
      targetId: post.targetId,
      platform: post.platform,
      postUrl: post.postUrl,
      type: post.type,
      caption: post.caption,
      likes: Number(post.likes),
      commentsCount: post.commentsCount,
      views: post.views ? Number(post.views) : null,
      mediaUrls: post.mediaUrls,
      hashtags: post.hashtags,
      mentions: post.mentions,
      postedAt: post.postedAt.toISOString(),
      scrapedAt: post.scrapedAt.toISOString(),
      comments: post.comments.map((cm) => ({
        id: cm.id,
        postId: cm.postId,
        targetId: cm.targetId,
        author: cm.author,
        text: cm.text,
        sentiment: cm.sentiment,
        keywords: cm.keywords,
        postedAt: cm.postedAt.toISOString(),
        scrapedAt: cm.scrapedAt.toISOString(),
      })) satisfies CommentDTO[],
    } satisfies PostDTO & { comments: CommentDTO[] });
  });