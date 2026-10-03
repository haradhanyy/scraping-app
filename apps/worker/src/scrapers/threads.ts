import * as cheerio from "cheerio";
import { DESKTOP_UA, getBrowser, isRateLimitedPage, parseCount, type RawPost } from "./common.js";
import { RateLimitedError } from "./instagram.js";

/**
 * Scrape a Threads profile or single post URL.
 * threads.com serves mostly client-rendered content; Playwright renders, Cheerio parses.
 */
export async function scrapeThreads(targetUrl: string, maxPosts: number): Promise<RawPost[]> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: DESKTOP_UA,
    locale: "en-US",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  try {
    const resp = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3000);
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);
    }
    const html = await page.content();
    if (resp?.status() === 429 || isRateLimitedPage(html, resp?.status())) {
      throw new RateLimitedError(`Threads rate limit (http=${resp?.status()})`);
    }

    const posts = extractThreadsPosts(html, targetUrl, maxPosts);
    if (posts.length === 0) {
      const wall = cheerio.load(html)("body").text().slice(0, 2000);
      if (/log in|sign in|challenge/i.test(wall)) {
        throw new RateLimitedError("Threads login wall encountered");
      }
      throw new Error("No posts found — selector drift or private profile?");
    }
    return posts;
  } finally {
    await context.close();
  }
}

function extractThreadsPosts(html: string, targetUrl: string, maxPosts: number): RawPost[] {
  const $ = cheerio.load(html);
  const posts: RawPost[] = [];

  // 1) Embedded JSON state (Threads ships post data in script payloads).
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
      mediaUrls: [],
      postUrl: targetUrl,
      postedAt: null,
    });
  }
  if (posts.length > 0) return posts.slice(0, maxPosts);

  // 2) DOM fallback: links to /post/ + nearby text.
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
      mediaUrls: imgs.slice(0, 4),
      postUrl: new URL(href, "https://www.threads.com").toString(),
      postedAt: card.find("time").attr("datetime") ?? null,
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
