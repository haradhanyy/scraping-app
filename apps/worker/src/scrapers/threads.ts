import * as cheerio from "cheerio";
import { DESKTOP_UA, getBrowser, isRateLimitedPage, parseCount, type RawPost, resetBrowser } from "./common.js";
import { RateLimitedError } from "./instagram.js";
import { getProxy, recordProxyResult } from "../proxy/proxy-manager.js";

interface ScrapeOptions {
  maxPosts: number;
  scrapeViews?: boolean;
  scrapeComments?: boolean;
  maxComments?: number;
}

export async function scrapeThreads(
  targetUrl: string,
  options: ScrapeOptions
): Promise<RawPost[]> {
  const { maxPosts, scrapeViews, scrapeComments, maxComments } = options;

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
      await page.waitForTimeout(3000);

      for (let i = 0; i < 4; i++) {
        await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
        await page.waitForTimeout(1000);
      }

      const html = await page.content();
      if (resp?.status() === 429 || isRateLimitedPage(html, resp?.status())) {
        if (proxyId) await recordProxyResult(proxyId, false, Date.now() - startTime);
        throw new RateLimitedError(`Threads rate limit (http=${resp?.status()})`);
      }

      const posts = extractThreadsPosts(html, targetUrl, maxPosts, scrapeViews);
      const latencyMs = Date.now() - startTime;

      if (posts.length === 0) {
        const wall = cheerio.load(html)("body").text().slice(0, 2000);
        if (/log in|sign in|challenge/i.test(wall)) {
          if (proxyId) await recordProxyResult(proxyId, false, latencyMs);
          throw new RateLimitedError("Threads login wall encountered");
        }
        if (proxyId) await recordProxyResult(proxyId, false, latencyMs);
        throw new Error("No posts found — selector drift or private profile?");
      }

      if (proxyId) await recordProxyResult(proxyId, true, latencyMs);
      return posts;
    } finally {
      await context.close();
    }
  } catch (err) {
    if (proxyId) await recordProxyResult(proxyId, false, 0);
    resetBrowser();
    throw err;
  }
}

function extractThreadsPosts(
  html: string,
  targetUrl: string,
  maxPosts: number,
  scrapeViews?: boolean
): RawPost[] {
  const $ = cheerio.load(html);
  const posts: RawPost[] = [];

  const ogTitle = $('meta[property="og:title"]').attr("content") ?? "";
  const author = ogTitle.split(" ")[0]?.replace(/^@/, "") || "unknown";
  const ogDesc = $('meta[property="og:description"]').attr("content") ?? "";
  const hashtags = extractHashtags(ogDesc);
  const mentions = extractMentions(ogDesc);

  // 1) Embedded JSON state
  const blob = $("script:not([src])").map((_, el) => $(el).text()).get().join("\n").slice(0, 2_000_000);
  const textRe = /"(?:text|post_text|caption)"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.){1,2000})"/g;
  let m: RegExpExecArray | null;
  while ((m = textRe.exec(blob)) && posts.length < maxPosts) {
    let caption: string;
    try {
      caption = JSON.parse(`"${m[1]}"`);
    } catch {
      caption = m[1];
    }
    posts.push({
      author: guessAuthor($, targetUrl),
      caption,
      likes: 0,
      commentsCount: 0,
      views: undefined,
      mediaUrls: [],
      postUrl: targetUrl,
      postedAt: null,
      type: "THREAD",
      hashtags,
      mentions,
    });
  }
  if (posts.length > 0) return posts.slice(0, maxPosts);

  // 2) DOM fallback
  $('a[href*="/post/"], a[href*="/t/"]').each((_, el) => {
    if (posts.length >= maxPosts) return false;
    const href = $(el).attr("href");
    const card = $(el).closest("div").parent();
    const text = card.text().trim().slice(0, 2000);
    const likeText = card.text().match(/([\d,.]+[KMB]?)\s*(likes?|replies?)/i);
    const imgs = card
      .find("img")
      .map((_, img) => $(img).attr("src"))
      .get()
      .filter((s): s is string => !!s && s.startsWith("http"));
    if (!href || !text) return;
    posts.push({
      author: guessAuthor($, targetUrl),
      caption: text || null,
      likes: parseCount(likeText?.[1]),
      commentsCount: 0,
      views: undefined,
      mediaUrls: imgs.slice(0, 4),
      postUrl: new URL(href, "https://www.threads.com").toString(),
      postedAt: card.find("time").attr("datetime") ?? null,
      type: "THREAD",
      hashtags,
      mentions,
    });
  });

  return posts.slice(0, maxPosts);
}

function guessAuthor($: cheerio.CheerioAPI, targetUrl: string): string {
  const og = $('meta[property="og:title"]').attr("content")?.split(" ")[0]?.replace(/^@/, "");
  if (og) return og;
  const m = targetUrl.match(/@([\w.]+)/);
  return m?.[1] ?? "unknown";
}

function extractHashtags(text: string): string[] {
  return [...text.matchAll(/#[A-Za-z0-9_]+/g)].map((m) => m[0].slice(1));
}

function extractMentions(text: string): string[] {
  return [...text.matchAll(/@[A-Za-z0-9._]+/g)].map((m) => m[0].slice(1));
}