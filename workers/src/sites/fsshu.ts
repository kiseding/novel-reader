// Fsshu — same template as biquge5, prefix /biquge/
import type { SiteSource, SearchResult, BookDetail, ChapterContent, ResolvedURL } from "../types";
import { fetchHTML, parseHTML, absolutizeURL, cleanText } from "../utils/http";
import { withRetry } from "../utils/retry";
import { cleanChapterContent } from "../utils/clean";

const BASE = "https://www.fsshu.com";
const PREFIX = "/biquge";
const BOOK_RE = /^\/biquge\/(\d+_\d+)\/?$/;

export class FsshuSource implements SiteSource {
  readonly key = "fsshu";
  readonly displayName = "飞升书屋";
  readonly tags = ["简体中文", "转载站", "笔趣阁"];

  resolveURL(url: string): ResolvedURL | null {
    try {
      const u = new URL(url);
      if (!u.hostname.includes("fsshu.com")) return null;
      const m = u.pathname.match(/^\/biquge\/(\d+_\d+)\/c(\d+)\.html$/);
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
      let title = cleanText($(a).attr("title") || $(a).text());
      title = title.replace(/^\[[^\]]+\]\s*/, "").replace(/\s*全文阅读$/, "").trim();
      if (!title) return;

      results.push({
        site: this.key, bookId, title,
        author: "", description: "",
        url: absolutizeURL(BASE, href),
        coverUrl: `https://www.fsshu.com/images/${m[1].split("_")[0]}/${m[1].split("_")[1]}/${m[1].split("_")[1]}s.jpg`,
        latestChapter: "",
      });
    });

    return limit > 0 ? results.slice(0, limit) : results;
  }

  async downloadPlan(bookId: string): Promise<BookDetail> {
    const html = await withRetry(() => fetchHTML(`${BASE}${PREFIX}/${bookId}/`));
    let $ = parseHTML(html);
    const title = $('meta[property="og:novel:book_name"]').attr("content") ||
      $('meta[property="og:title"]').attr("content")?.replace("最新章节", "").trim() || bookId;
    const author = $('meta[property="og:novel:author"]').attr("content") || "未知";
    const description = $('meta[property="og:description"]').attr("content") || "";
    const coverUrl = $('meta[property="og:image"]').attr("content") || "";

    // Collect chapters from all paginated pages
    const allChapters: { id: string; title: string; url: string; order: number }[] = [];
    const seen = new Set<string>();
    const re = new RegExp(`${PREFIX}/${bookId}/c(\\d+)\\.html$`);

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

    // Follow pagination links to get all chapters
    for (let page = 1; page < 30; page++) {
      const nextLink = $(`a:contains("下一页"), a:contains("下一頁")`).first();
      const nextHref = nextLink.attr("href") || "";
      if (!nextHref) break;
      const nextUrl = absolutizeURL(`${BASE}${PREFIX}/${bookId}/`, nextHref);
      if (!nextUrl.includes(bookId)) break;
      try {
        const pageHtml = await withRetry(() => fetchHTML(nextUrl));
        const page$ = parseHTML(pageHtml);
        collectChapters(page$);
        $ = page$;
      } catch { break; }
    }

    return { site: this.key, bookId, title, author, description, coverUrl, sourceUrl: `${BASE}${PREFIX}/${bookId}/`, chapters: allChapters.map((ch, i) => ({ ...ch, order: i + 1 })) };
  }

  async fetchChapter(bookId: string, chapter: { id: string; url: string; title: string }): Promise<ChapterContent> {
    const url = chapter.url || `${BASE}${PREFIX}/${bookId}/c${chapter.id}.html`;
    const html = await withRetry(() => fetchHTML(url));
    const $ = parseHTML(html);
    const title = $('meta[property="og:title"]').attr("content")?.replace("最新章节", "").trim() || chapter.title;
    let text = ($(".box.single").first().text() || "").replace(/\n{3,}/g, "\n").trim();

    // Multi-page chapters
    const pageMatch = text.match(/第\s*[\(（]?\s*(\d+)\s*\/\s*(\d+)\s*[\)）]?\s*页/);
    if (pageMatch) {
      const [, current, total] = pageMatch;
      for (let p = parseInt(current) + 1; p <= parseInt(total) && p <= 10; p++) {
        try {
          const pgUrl = `${BASE}${PREFIX}/${bookId}/c${chapter.id}_${p}.html`;
          const pgHtml = await fetchHTML(pgUrl);
          const pg$ = parseHTML(pgHtml);
          const pgText = (pg$(".box.single").first().text() || "").replace(/\n{3,}/g, "\n").trim();
          if (pgText) text += "\n" + pgText;
        } catch { break; }
      }
    }

    text = cleanChapterContent(text);
    return { id: chapter.id, title, content: text };
  }
}
