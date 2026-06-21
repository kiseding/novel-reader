// Multi-page chapter fetch helper
// Sources sometimes split one chapter into multiple pages (e.g. 第(1/3)页).
// This helper fetches the remaining pages concurrently with bounded
// concurrency/timeouts so the Worker stays within the 30s request limit.

import { fetchHTML, parseHTML } from "./http";

export interface MultiPageOptions {
  /** Maximum total pages to fetch (including the first page). Default 5. */
  maxPages?: number;
  /** Concurrent fetches for remaining pages. Default 2. */
  concurrency?: number;
  /** Per-page fetch timeout in ms. Default 10000. */
  perPageTimeoutMs?: number;
  /** Overall deadline for all extra fetches in ms. Default 20000. */
  totalTimeoutMs?: number;
}

export interface PageExtractor {
  (html: string): string;
}

const PAGE_RE = /第\s*[\(（]?\s*(\d+)\s*\/\s*(\d+)\s*[\)）]?\s*页/;

/**
 * Given the already-fetched first page HTML, detect pagination markers like
 * "第(1/3)页" and fetch the remaining pages concurrently.
 *
 * @param firstHtml   HTML of the first page (already fetched).
 * @param firstText   Extracted text of the first page.
 * @param pageUrlBuilder Returns the URL for page number `pageNum` (1-based).
 * @param extractor   Extract readable text from fetched HTML.
 * @param options     Concurrency/timeouts/page limits.
 * @returns Merged chapter text (first page + fetched follow-up pages).
 */
export async function fetchMultiPageChapter(
  firstHtml: string,
  firstText: string,
  pageUrlBuilder: (pageNum: number) => string,
  extractor: PageExtractor,
  options: MultiPageOptions = {}
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

  // Only continue if we are on the first page and there are more pages.
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
    const batch = Array.from({ length: concurrency }, (_, j) => {
      const pageNum = currentPage + 1 + i + j;
      return pageNum <= totalPages ? fetchOne(pageNum) : Promise.resolve(null);
    });
    const results = await Promise.all(batch);
    for (const text of results) {
      if (text) merged.push(text);
    }
    if (Date.now() - startTime > totalTimeoutMs) break;
  }

  return merged.join("\n");
}
