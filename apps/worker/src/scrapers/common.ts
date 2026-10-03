import { chromium, type Browser } from "playwright";
import { ProxyConfig } from "@scraping-app/shared";

let browserPromise: Promise<Browser> | null = null;

/** Launch browser with optional proxy */
export async function getBrowser(proxy?: ProxyConfig | null): Promise<Browser> {
  if (!browserPromise) {
    const args = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ];

    if (proxy) {
      const proxyUrl = `${proxy.protocol}://${proxy.host}:${proxy.port}`;
      args.push(`--proxy-server=${proxyUrl}`);
    }

    browserPromise = chromium.launch({
      headless: process.env.SCRAPER_HEADLESS !== "false",
      args,
    });
  }
  return browserPromise;
}

/** Reset browser (e.g., after proxy rotation) */
export function resetBrowser(): void {
  browserPromise = null;
}

/** "1.2K" / "3.4M" / "5,678" -> number. Returns 0 on unparseable input. */
export function parseCount(raw: string | null | undefined): number {
  if (!raw) return 0;
  const s = raw.trim().toUpperCase().replace(/,/g, "");
  const m = s.match(/^([\d.]+)\s*([KMB])?/);
  if (!m) return Number.isFinite(Number(s)) ? Math.floor(Number(s)) : 0;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return 0;
  const mult = m[2] === "B" ? 1e9 : m[2] === "M" ? 1e6 : m[2] === "K" ? 1e3 : 1;
  return Math.floor(n * mult);
}

export function isRateLimitedPage(html: string, status?: number): boolean {
  if (status === 429) return true;
  return /rate limit|try again later|temporarily blocked|challenge_required|login.*required/i.test(
    html.slice(0, 20_000),
  );
}

export const DESKTOP_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface RawPost {
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
}

export function extractHashtags(text: string): string[] {
  return [...text.matchAll(/#[A-Za-z0-9_]+/g)].map((m) => m[0].slice(1));
}

export function extractMentions(text: string): string[] {
  return [...text.matchAll(/@[A-Za-z0-9._]+/g)].map((m) => m[0].slice(1));
}