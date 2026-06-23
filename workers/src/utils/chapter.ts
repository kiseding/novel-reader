// Multi-page chapter fetch helper
// Sources sometimes split one chapter into multiple pages (e.g. 第(1/3)页).
// Two strategies:
//   1. DOM-based: follow next-page links in HTML via findNextPageUrl().
//   2. Text-based: detect "第(1/3)页" markers and build URLs by page number.
// Strategy 1 takes precedence when getNextPageUrl is provided; if DOM mode
// finds nothing, it falls back to text-based detection automatically.

import { fetchHTML, parseHTML, absolutizeURL } from "./http";

export interface MultiPageOptions {
  /** Maximum total pages to fetch (including the first page). Default 5. */
  maxPages?: number;
  /** Concurrent fetches for remaining pages. Default 2 (text-based mode only). */
  concurrency?: number;
  /** Per-page fetch timeout in ms. Default 10000. */
  perPageTimeoutMs?: number;
  /** Overall deadline for all extra fetches in ms. Default 20000. */
  totalTimeoutMs?: number;
  /**
   * DOM-based "next page" link finder.
   * Given the current page HTML and its URL, return the next page URL or null.
   * When provided, this takes precedence; falls back to text-based if null.
   */
  getNextPageUrl?: (html: string, currentUrl: string) => string | null;
  /**
   * URL of the first page (for resolving relative links).
   * Required when using getNextPageUrl.
   */
  firstPageUrl?: string;
  /**
   * Custom fetch function for sources that need special handling
   * (cookies, challenge bypass, custom headers, etc.).
   */
  fetchPage?: (url: string) => Promise<string>;
}

export interface PageExtractor {
  (html: string): string;
}

/** Matches "第(1/3)页" / "第（1/3）页" / "1/3页" etc. */
const PAGE_RE = /第\s*[\(（]?\s*(\d+)\s*\/\s*(\d+)\s*[\)）]?\s*页/;

/**
 * Best-effort "next page" URL finder for Chinese novel chapter pages.
 *
 * Tries these strategies in order:
 *   1. <link rel="next"> / <a rel="next">          (standard HTML)
 *   2. Text: "下一页" / "下一頁" / "下一章" / "继续"   (Chinese markers)
 *   3. Text: "下页" / "下頁"                         (short forms)
 *   4. Arrow-only links: » › → ＞ >                 (exact match, excludes prev-arrows)
 *   5. Numbered pagination: find highlighted current
 *      page number in DOM, then link to next number.
 *   6. Last resort: first <a> whose text contains
 *      "下" or "next" (case-insensitive).
 *
 * Each strategy resolves href against currentUrl and skips
 * self-referencing / javascript: links.
 */
export function findNextPageUrl(html: string, currentUrl: string): string | null {
  const $ = parseHTML(html);

  const resolve = (href: string | undefined | null): string | null => {
    if (!href) return null;
    if (href.startsWith("javascript:") || href.startsWith("#")) return null;
    const url = absolutizeURL(currentUrl, href);
    return url !== currentUrl ? url : null;
  };

  // ── 1. rel="next" ──────────────────────────────────────────
  {
    const href = $('link[rel="next"], a[rel="next"]').first().attr("href");
    const r = resolve(href);
    if (r) return r;
  }

  // ── 2. Chinese text markers (full forms) ───────────────────
  {
    const sel = [
      'a:contains("下一页")', 'a:contains("下一頁")',
      'a:contains("下一章")',
      'a:contains("继续阅读")', 'a:contains("继续")',
    ].join(", ");
    const href = $(sel).first().attr("href");
    const r = resolve(href);
    if (r) return r;
  }

  // ── 3. Short forms ─────────────────────────────────────────
  {
    const sel = [
      'a:contains("下页")', 'a:contains("下頁")',
    ].join(", ");
    const href = $(sel).first().attr("href");
    const r = resolve(href);
    if (r) return r;
  }

  // ── 4. Arrow-only links ────────────────────────────────────
  {
    // Right-pointing arrows: » › → ＞ (exclude « ‹ ← which are prev)
    const nextArrows = ["»", "›", "→", "＞"];
    for (const arrow of nextArrows) {
      const $a = $("a").filter((_, a) => $(a).text().trim() === arrow).first();
      const r = resolve($a.attr("href"));
      if (r) return r;
    }
    // For plain '>' — check both text() and html() (&gt; encoding)
    const $gt = $("a").filter((_, a) => {
      const t = $(a).text().trim();
      return t === ">" || t === "&gt;" || $(a).html()?.trim() === "&gt;";
    }).first();
    const r = resolve($gt.attr("href"));
    if (r) return r;
  }

  // ── 5. Numbered pagination ─────────────────────────────────
  {
    // Collect all numeric links
    const pageNums: Array<{ num: number; $el: ReturnType<typeof $>; href: string }> = [];
    $("a").each((_, a) => {
      const text = $(a).text().trim();
      const num = parseInt(text, 10);
      if (!isNaN(num) && num > 0 && num < 10000) {
        const href = $(a).attr("href") || "";
        if (href && !href.startsWith("javascript:")) {
          pageNums.push({ num, $el: $(a), href });
        }
      }
    });

    if (pageNums.length >= 2) {
      // Find current page — look for a highlighted non-link element first
      let currentNum = -1;
      // Non-link elements with active/current class
      $("span, strong, em").each((_, el) => {
        const cls = $(el).attr("class") || "";
        if (/active|current|on|hover|selected/.test(cls)) {
          const text = $(el).text().trim();
          const num = parseInt(text, 10);
          if (!isNaN(num) && num > currentNum) currentNum = num;
        }
      });

      // If no highlighted element, try finding which link matches currentUrl
      if (currentNum < 0) {
        const currentPath = new URL(currentUrl).pathname;
        for (const p of pageNums) {
          const linkPath = absolutizeURL(currentUrl, p.href);
          try { if (new URL(linkPath).pathname === currentPath) { currentNum = p.num; break; } }
          catch { /* ignore */ }
        }
      }

      // Link to next page number
      if (currentNum > 0) {
        const next = pageNums.find(p => p.num === currentNum + 1);
        if (next) {
          const r = resolve(next.href);
          if (r) return r;
        }
      }
    }
  }

  // ── 6. Last resort: any link containing "下" or "next" ────
  {
    const href = $('a:contains("下"), a:contains("next")').first().attr("href");
    const r = resolve(href);
    if (r) return r;
  }

  return null;
}

/**
 * Given the already-fetched first page, fetch remaining pages of a multi-page
 * chapter using either DOM-based link following or text-based page number detection.
 *
 * @param firstHtml      HTML of the first page (already fetched).
 * @param firstText      Extracted text of the first page.
 * @param pageUrlBuilder Returns the URL for page number `pageNum` (1-based);
 *                       used as fallback when text-based detection matches.
 * @param extractor      Extract readable text from fetched HTML.
 * @param options        Concurrency/timeouts/page limits + optional getNextPageUrl.
 * @returns Merged chapter text (all pages joined by newline).
 */
export async function fetchMultiPageChapter(
  firstHtml: string,
  firstText: string,
  pageUrlBuilder: (pageNum: number) => string,
  extractor: PageExtractor,
  options: MultiPageOptions = {},
): Promise<string> {
  const { getNextPageUrl } = options;

  // Strategy 1: DOM-based next-link following
  if (getNextPageUrl) {
    const result = await fetchByFollowingLinks(firstHtml, firstText, extractor, options);
    // If DOM mode found extra pages, return merged result
    if (result !== firstText) return result;
    // Otherwise fall through to text-based detection below
  }

  // Strategy 2: Text-based page number detection
  return fetchByPageNumbers(firstHtml, firstText, pageUrlBuilder, extractor, options);
}

// ─── DOM-based: follow next-page links ──────────────────────────────────

async function fetchByFollowingLinks(
  firstHtml: string,
  firstText: string,
  extractor: PageExtractor,
  options: MultiPageOptions,
): Promise<string> {
  const {
    maxPages = 5,
    perPageTimeoutMs = 10000,
    totalTimeoutMs = 20000,
    getNextPageUrl,
    firstPageUrl = "",
    fetchPage,
  } = options;

  const startTime = Date.now();
  const merged: string[] = [firstText];
  let currentHtml = firstHtml;
  let currentUrl = firstPageUrl;
  const fetcher: (url: string) => Promise<string> =
    fetchPage || ((url: string) => fetchHTML(url, { signal: AbortSignal.timeout(perPageTimeoutMs) }));

  for (let i = 0; i < maxPages - 1; i++) {
    if (Date.now() - startTime > totalTimeoutMs) break;

    const nextUrl = getNextPageUrl!(currentHtml, currentUrl);
    if (!nextUrl || nextUrl === currentUrl) break;

    try {
      const html = await fetcher(nextUrl);
      const text = extractor(html);
      if (!text || !text.trim()) break;

      // Content overlap detection: strip duplicated last/first line
      const trimmed = trimOverlap(merged[merged.length - 1], text);
      if (!trimmed) break;

      merged.push(trimmed);
      currentHtml = html;
      currentUrl = nextUrl;
    } catch (e) {
      console.error(`Multi-page fetch failed for ${nextUrl}:`, e);
      break;
    }
  }

  return merged.join("\n");
}

/**
 * Trims the first line of `nextText` if it matches the last line of `prevText`.
 * Chinese novel sites often repeat the last line of page N as the first line of page N+1.
 */
function trimOverlap(prevText: string, nextText: string): string {
  const prevLines = prevText.trim().split("\n");
  const nextLines = nextText.trim().split("\n");
  if (!prevLines.length || !nextLines.length) return nextText;

  const lastPrev = prevLines[prevLines.length - 1].trim();
  const firstNext = nextLines[0].trim();
  if (lastPrev && firstNext && lastPrev === firstNext) {
    return nextLines.slice(1).join("\n").trim();
  }
  return nextText;
}

// ─── Text-based: detect 第(1/3)页 markers ────────────────────────────

async function fetchByPageNumbers(
  _firstHtml: string,
  firstText: string,
  pageUrlBuilder: (pageNum: number) => string,
  extractor: PageExtractor,
  options: MultiPageOptions,
): Promise<string> {
  const {
    maxPages = 5,
    concurrency = 2,
    perPageTimeoutMs = 10000,
    totalTimeoutMs = 20000,
  } = options;

  const match = firstText.match(PAGE_RE);
  if (!match) return firstText;

  const currentPage = parseInt(match[1], 10);
  const totalPages = parseInt(match[2], 10);

  if (
    Number.isNaN(currentPage) ||
    Number.isNaN(totalPages) ||
    currentPage !== 1 ||
    totalPages <= 1
  ) {
    return firstText;
  }

  const remaining = Math.min(totalPages - currentPage, maxPages - 1);
  if (remaining <= 0) return firstText;

  const startTime = Date.now();
  const merged: string[] = [firstText];

  const fetchOne = async (pageNum: number): Promise<string | null> => {
    if (Date.now() - startTime > totalTimeoutMs) return null;
    try {
      const html = await fetchHTML(pageUrlBuilder(pageNum), {
        signal: AbortSignal.timeout(perPageTimeoutMs),
      });
      return extractor(html);
    } catch (e) {
      console.error(`Multi-page fetch failed for page ${pageNum}:`, e);
      return null;
    }
  };

  for (let i = 0; i < remaining; i += concurrency) {
    const batch: Array<Promise<string | null>> = [];
    for (let j = 0; j < concurrency && i + j < remaining; j++) {
      const pageNum = currentPage + 1 + i + j;
      batch.push(pageNum <= totalPages ? fetchOne(pageNum) : Promise.resolve(null));
    }
    const results = await Promise.all(batch);
    for (const text of results) {
      if (text) merged.push(trimOverlap(merged[merged.length - 1], text));
    }
    if (Date.now() - startTime > totalTimeoutMs) break;
  }

  return merged.join("\n");
}
