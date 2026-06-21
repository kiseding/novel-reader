// Biquge5 — uses Bootstrap template, search: GET /search.php?q=
import type { SiteSource, SearchResult, BookDetail, ChapterContent, ResolvedURL } from "../types";
import { fetchHTML, parseHTML, absolutizeURL, cleanText } from "../utils/http";
import { withRetry } from "../utils/retry";
import { cleanChapterContent } from "../utils/clean";
import { fetchMultiPageChapter } from "../utils/chapter";

const BASE = "https://www.biquge5.com";
const BOOK_RE = /^\/(\d+_\d+)\/?$/;

export class Biquge5Source implements SiteSource {
  readonly key = "biquge5";
  readonly displayName = "笔趣阁5";
  readonly tags = ["简体中文", "转载站", "笔趣阁"];

  resolveURL(url: string): ResolvedURL | null {
    try {
      const u = new URL(url);
      if (!u.hostname.includes("biquge5.com")) return null;
      const m = u.pathname.match(/^\/(\d+_\d+)\/(\d+)\.html$/);
      if (m) return { siteKey: this.key, bookId: m[1], chapterId: m[2], canonical: u.href };
      const m2 = u.pathname.match(BOOK_RE);
      if (m2) return { siteKey: this.key, bookId: m2[1], canonical: u.href };
    } catch {}
    return null;
  }

  async search(keyword: string, limit: number): Promise<SearchResult[]> {
    const html = await fetchHTML(`${BASE}/search.php?q=${encodeURIComponent(keyword)}`);
    const $ = parseHTML(html);
    const results: SearchResult[] = [];
    const seen = new Set<string>();

    $("a").each((_, a) => {
      const href = $(a).attr("href") || "";
      const m = href.match(BOOK_RE);
      if (!m) return;
      const bookId = m[1];
      if (seen.has(bookId)) return;
      seen.add(bookId);
      // Use title attribute (cleaner), fallback to text content
      let title = cleanText($(a).attr("title") || $(a).text());
      title = title.replace(/^\[[^\]]+\]\s*/, "").replace(/\s*全文阅读$/, "").trim();
      if (!title) return;

      results.push({
        site: this.key, bookId, title,
        author: "", description: "",
        url: absolutizeURL(BASE, href),
        coverUrl: `https://www.biquge5.com/images/${m[1].split("_")[0]}/${m[1].split("_")[1]}/${m[1].split("_")[1]}s.jpg`,
        latestChapter: "",
      });
    });

    return limit > 0 ? results.slice(0, limit) : results;
  }

  async downloadPlan(bookId: string): Promise<BookDetail> {
    const html = await withRetry(() => fetchHTML(`${BASE}/${bookId}/`));
    let $ = parseHTML(html);
    const [cat, id] = bookId.split("_");

    const title = $('meta[property="og:novel:book_name"]').attr("content") ||
      $('meta[property="og:title"]').attr("content")?.replace("最新章节", "").trim() || bookId;
    const author = $('meta[property="og:novel:author"]').attr("content") || "未知";
    const description = $('meta[property="og:description"]').attr("content") || "";
    const coverUrl = $('meta[property="og:image"]').attr("content") || "";

    // Collect chapters from all paginated pages
    const allChapters: { id: string; title: string; url: string; order: number }[] = [];
    const seen = new Set<string>();
    const re = new RegExp(`/${bookId}/(\\d+)\\.html$`);

    function collectChapters(_$: ReturnType<typeof parseHTML>) {
      _$("a").each((_, a) => {
        const href = $(a).attr("href") || "";
        const m = href.match(re);
        if (!m) return;
        if (seen.has(m[1])) return;
        seen.add(m[1]);
        allChapters.push({ id: m[1], title: cleanText($(a).text()), url: absolutizeURL(BASE, href), order: 0 });
      });
    }

    collectChapters($);

    // Biquge5 uses index_N.html pagination (index_2.html, index_3.html, ...)
    // Skip index_1 — it's the same as the main page already fetched
    for (let page = 2; page <= 30; page++) {
      const nextUrl = `${BASE}/${bookId}/index_${page}.html`;
      try {
        const pageHtml = await withRetry(() => fetchHTML(nextUrl));
        const page$ = parseHTML(pageHtml);
        const prevCount = allChapters.length;
        collectChapters(page$);
        if (allChapters.length === prevCount) break; // no new chapters = done
        $ = page$;
      } catch { break; }
    }

    return { site: this.key, bookId, title, author, description, coverUrl, sourceUrl: `${BASE}/${bookId}/`, chapters: allChapters.map((ch, i) => ({ ...ch, order: i + 1 })) };
  }

  async fetchChapter(bookId: string, chapter: { id: string; url: string; title: string }): Promise<ChapterContent> {
    const url = chapter.url || `${BASE}/${bookId}/${chapter.id}.html`;
    const html = await withRetry(() => fetchHTML(url));
    const $ = parseHTML(html);
    const title = $('meta[property="og:title"]').attr("content")?.replace("最新章节", "").trim() || chapter.title;

    const extractText = (h: string): string => {
      const _$ = parseHTML(h);
      return (_$(".box.single").first().text() || "").replace(/\n{3,}/g, "\n").trim();
    };

    const firstText = extractText(html);
    const text = await fetchMultiPageChapter(
      html,
      firstText,
      (p) => `${BASE}/${bookId}/${chapter.id}_${p}.html`,
      extractText,
      { maxPages: 5, concurrency: 2 }
    );

    return { id: chapter.id, title, content: cleanChapterContent(text, title) };
  }
}
