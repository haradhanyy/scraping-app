import * as cheerio from "cheerio";
import { DESKTOP_UA, getBrowser, isRateLimitedPage, parseCount, type RawPost, resetBrowser } from "./common.js";
import { getProxy, recordProxyResult } from "../proxy/proxy-manager.js";

export class RateLimitedError extends Error {
  constructor(message = "Rate limited by Instagram") {
    super(message);
    this.name = "RateLimitedError";
  }
}

interface ScrapeOptions {
  maxPosts: number;
  scrapeViews?: boolean;
  scrapeComments?: boolean;
  maxComments?: number;
}

export async function scrapeInstagram(
  targetUrl: string,
  options: ScrapeOptions
): Promise<RawPost[]> {
  const { maxPosts, scrapeViews, scrapeComments, maxComments } = options;

  // Get proxy for this scrape
  const proxy = await getProxy();
  const browser = await getBrowser(proxy ?? undefined);

  let context: Awaited<ReturnType<typeof browser.newContext>>;
  let proxyId: string | undefined;

  try {
    context = await browser.newContext({
      userAgent: DESKTOP_UA,
      locale: "en-US",
      viewport: { width: 1366, height: 900 },
    });

    if (proxy) {
      proxyId = proxy.host + ":" + proxy.port;
    }

    const page = await context.newPage();
    const startTime = Date.now();

    try {
      const resp = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(2500);

      // Dismiss cookie banner
      try {
        const accept = page.getByRole("button", { name: /accept|allow all/i });
        if (await accept.first().isVisible({ timeout: 2000 })) await accept.first().click();
      } catch {
        /* ignore */
      }

      const html = await page.content();
      if (resp?.status() === 429 || isRateLimitedPage(html, resp?.status())) {
        if (proxyId) await recordProxyResult(proxyId, false, Date.now() - startTime);
        throw new RateLimitedError(`Instagram rate limit (http=${resp?.status()})`);
      }

      // Login wall detection
      const $wall = cheerio.load(html);
      const wallText = $wall("body").text().slice(0, 5000);
      if (/log in.*to (see|continue)|sorry, this page isn't available/i.test(wallText)) {
        if (proxyId) await recordProxyResult(proxyId, false, Date.now() - startTime);
        const embedded = extractEmbeddedPosts(html, targetUrl, maxPosts);
        if (embedded.length > 0) return embedded;
        throw new RateLimitedError("Instagram login wall encountered");
      }

      // Determine if profile grid or single post
      const isProfile = /@[\w.]+$|\/([A-Za-z0-9._]+)\/?$/.test(targetUrl) && 
                        !targetUrl.includes("/p/") && !targetUrl.includes("/reel/");

      if (isProfile) {
        for (let i = 0; i < 4; i++) {
          await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
          await page.waitForTimeout(1200);
        }
      }

      const finalHtml = await page.content();
      const latencyMs = Date.now() - startTime;

      // Try embedded JSON first
      let posts = extractEmbeddedPosts(finalHtml, targetUrl, maxPosts, scrapeViews);
      if (posts.length > 0) {
        if (proxyId) await recordProxyResult(proxyId, true, latencyMs);
        return posts;
      }

      // Fallback to DOM
      posts = extractDomPosts(finalHtml, targetUrl, maxPosts, scrapeViews);
      if (proxyId) await recordProxyResult(proxyId, posts.length > 0, latencyMs);
      return posts;
    } finally {
      await context.close();
    }
  } catch (err) {
    if (proxyId) await recordProxyResult(proxyId, false, 0);
    // Browser context might be corrupted, reset for next run
    resetBrowser();
    throw err;
  }
}

function extractEmbeddedPosts(
  html: string,
  targetUrl: string,
  maxPosts: number,
  scrapeViews?: boolean
): RawPost[] {
  const $ = cheerio.load(html);
  const posts: RawPost[] = [];
  const seen = new Set<string>();

  const ogTitle = $('meta[property="og:title"]').attr("content") ?? "";
  const ogDesc = $('meta[property="og:description"]').attr("content") ?? "";
  const ogImage = $('meta[property="og:image"]').attr("content") ?? "";
  const author = ogTitle.split(" on ")[0].replace(/^@/, "").trim() || "unknown";

  // Extract hashtags and mentions from og:description
  const hashtags = extractHashtags(ogDesc);
  const mentions = extractMentions(ogDesc);

  // Try to find shortcode edges in inline JSON
  const scripts = $("script[type='application/json'], script:not([src])")
    .map((_, el) => $(el).text())
    .get()
    .join("\n")
    .slice(0, 2_000_000);

  const shortcodeRe = /"(?:shortcode|code)"\s*:\s*"([A-Za-z0-9_-]{6,})"/g;
  let m: RegExpExecArray | null;
  while ((m = shortcodeRe.exec(scripts)) && posts.length < maxPosts) {
    const code = m[1];
    if (seen.has(code)) continue;
    seen.add(code);

    const likeM = new RegExp(`"${code}"[\\s\\S]{0,600}?"(?:edge_liked_by|like_count|likes?)"\\s*:\\s*\\{?\\s*"count"\\s*:\\s*(\\d+)`).exec(scripts);
    const commentM = new RegExp(`"${code}"[\\s\\S]{0,600}?"(?:edge_media_to_comment|comment_count)"\\s*:\\s*\\{?\\s*"count"\\s*:\\s*(\\d+)`).exec(scripts);
    const viewM = new RegExp(`"${code}"[\\s\\S]{0,600}?"(?:video_view_count|view_count)"\\s*:\\s*(\\d+)`).exec(scripts);
    const typeM = new RegExp(`"${code}"[\\s\\S]{0,600}?"__typename"\\s*:\\s*"(GraphVideo|GraphImage|GraphSidecar)"`).exec(scripts);

    const isReel = /\/reel\//.test(targetUrl) || typeM?.[1] === "GraphVideo";
    const postType = isReel ? "REEL" : "POST";

    posts.push({
      author,
      caption: ogDesc.slice(0, 2000) || null,
      likes: likeM ? Number(likeM[1]) : 0,
      commentsCount: commentM ? Number(commentM[1]) : 0,
      views: scrapeViews && viewM ? Number(viewM[1]) : undefined,
      mediaUrls: ogImage ? [ogImage] : [],
      postUrl: `https://www.instagram.com/p/${code}/`,
      postedAt: null,
      type: postType,
      hashtags,
      mentions,
    });
  }

  // Single-post page fallback
  if (posts.length === 0 && (/\/p\/|\/reel\//.test(targetUrl) || ogImage)) {
    const descLikes = ogDesc.match(/([\d,.]+[KMB]?)\s*Likes?/i);
    const descComments = ogDesc.match(/([\d,.]+[KMB]?)\s*Comments?/i);
    const isReel = /\/reel\//.test(targetUrl);

    posts.push({
      author,
      caption: ogDesc.slice(0, 2000) || null,
      likes: parseCount(descLikes?.[1]),
      commentsCount: parseCount(descComments?.[1]),
      views: undefined,
      mediaUrls: ogImage ? [ogImage] : [],
      postUrl: targetUrl,
      postedAt: $('meta[property="article:published_time"]').attr("content") ?? null,
      type: isReel ? "REEL" : "POST",
      hashtags,
      mentions,
    });
  }

  return posts.slice(0, maxPosts);
}

function extractDomPosts(
  html: string,
  targetUrl: string,
  maxPosts: number,
  scrapeViews?: boolean
): RawPost[] {
  const $ = cheerio.load(html);
  const posts: RawPost[] = [];

  const ogTitle = $('meta[property="og:title"]').attr("content") ?? "";
  const author = ogTitle.split(" on ")[0].replace(/^@/, "").trim() || "unknown";
  const ogDesc = $('meta[property="og:description"]').attr("content") ?? "";
  const hashtags = extractHashtags(ogDesc);
  const mentions = extractMentions(ogDesc);

  $('article a[href*="/p/"], article a[href*="/reel/"]').each((_, el) => {
    if (posts.length >= maxPosts) return false;
    const href = $(el).attr("href");
    const img = $(el).find("img").first();
    if (!href) return;

    const isReel = href.includes("/reel/");
    posts.push({
      author: img.attr("alt")?.split(" ")[0]?.replace(/^@/, "") || author,
      caption: img.attr("alt")?.slice(0, 2000) ?? null,
      likes: 0,
      commentsCount: 0,
      views: undefined,
      mediaUrls: img.attr("src") ? [img.attr("src")!] : [],
      postUrl: new URL(href, "https://www.instagram.com").toString(),
      postedAt: $(el).find("time").attr("datetime") ?? null,
      type: isReel ? "REEL" : "POST",
      hashtags,
      mentions,
    });
  });

  return posts.slice(0, maxPosts);
}

function extractHashtags(text: string): string[] {
  return [...text.matchAll(/#[A-Za-z0-9_]+/g)].map((m) => m[0].slice(1));
}

function extractMentions(text: string): string[] {
  return [...text.matchAll(/@[A-Za-z0-9._]+/g)].map((m) => m[0].slice(1));
}