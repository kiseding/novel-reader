// Multi-page chapter fetch helper
// Sources sometimes split one chapter into multiple pages (e.g. 第(1/3)页).
// Two strategies:
//   1. DOM-based: follow "下一页" / "下一頁" links in the HTML.
//   2. Text-based: detect "第(1/3)页" markers and build URLs by page number.
// Strategy 1 takes precedence when getNextPageUrl is provided.

import { fetchHTML } from "./http";

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
   * When provided, this takes precedence over the text-based page number detection.
   */
  getNextPageUrl?: (html: string, currentUrl: string) => string | null;
  /**
   * URL of the first page (for resolving relative links in getNextPageUrl).
   * Required when using getNextPageUrl.
   */
  firstPageUrl?: string;
  /**
   * Custom fetch function for sources that need special handling
   * (cookies, challenge bypass, custom headers, etc.).
   * Defaults to fetchHTML with AbortSignal.timeout.
   */
  fetchPage?: (url: string) => Promise<string>;
}

export interface PageExtractor {
  (html: string): string;
}

/** Matches "第(1/3)页" / "第（1/3）页" / "1/3页" etc. */
const PAGE_RE = /第\s*[\(（]?\s*(\d+)\s*\/\s*(\d+)\s*[\)）]?\s*页/;

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
    return fetchByFollowingLinks(firstHtml, firstText, extractor, options);
  }

  // Strategy 2: Text-based page number detection (existing behavior)
  return fetchByPageNumbers(firstHtml, firstText, pageUrlBuilder, extractor, options);
}

// ─── DOM-based: follow "下一页" links ──────────────────────────────────

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
