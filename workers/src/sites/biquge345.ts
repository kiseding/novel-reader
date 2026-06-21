// Ported from go-novel-dl internal/site/biquge345.go
import type { SiteSource, SearchResult, BookDetail, ChapterContent, ResolvedURL } from "../types";
import { fetchHTML, postFormHTML, parseHTML, absolutizeURL, cleanText } from "../utils/http";
import { fetchMultiPageChapter } from "../utils/chapter";

const BASE = "https://www.biquge345.com";
const BOOK_RE = /^\/book\/(\d+)\/?$/;
const CHAPTER_RE = /^\/chapter\/(\d+)\/(\d+)\.html$/;

export class Biquge345Source implements SiteSource {
  readonly key = "biquge345";
  readonly displayName = "笔趣阁345";
  readonly tags = ["中文", "网文"];

  resolveURL(url: string): ResolvedURL | null {
    try {
      const u = new URL(url);
      if (u.hostname.replace("www.", "") !== "biquge345.com") return null;
      let m = u.pathname.match(CHAPTER_RE);
      if (m) return { siteKey: this.key, bookId: m[1], chapterId: m[2], canonical: `${BASE}${u.pathname}` };
      m = u.pathname.match(BOOK_RE);
      if (m) return { siteKey: this.key, bookId: m[1], canonical: `${BASE}${u.pathname}` };
    } catch {}
    return null;
  }

  async search(keyword: string, limit: number): Promise<SearchResult[]> {
    const form = new URLSearchParams();
    form.set("type", "articlename");
    form.set("s", keyword);
    const html = await postFormHTML(`${BASE}/s.php`, form);
    const $ = parseHTML(html);
    const results: SearchResult[] = [];
    const seen = new Set<string>();

    // Try multiple selector patterns (site may have changed structure)
    const items = $("ul.search li, .list-item, .result-item").toArray();
    if (items.length) {
      items.forEach((li) => {
        if ($(li).hasClass("fen")) return;
        const link = $(li).find(".name a, a").first();
        const href = link.attr("href") || "";
        const m = href.match(BOOK_RE);
        if (!m) return;
        const bookId = m[1];
        if (seen.has(bookId)) return;
        seen.add(bookId);
        results.push({
          site: this.key, bookId,
          title: cleanText(link.text()),
          author: cleanText($(li).find(".zuo a, .author a, .author").first().text()),
          description: "",
          url: absolutizeURL(BASE, href),
        coverUrl: "",
        latestChapter: cleanText($(li).find(".jie a").first().text()),
      });
    });
    }

    return limit > 0 ? results.slice(0, limit) : results;
  }

  async downloadPlan(bookId: string): Promise<BookDetail> {
    const html = await fetchHTML(`${BASE}/book/${bookId}/`);
    let $ = parseHTML(html);

    const title = cleanText($(".right_border h1").first().text());
    const author = cleanText($(".x1 a").first().text());
    const description = cleanText($(".x3").first().text());
    const coverUrl = absolutizeURL(BASE, $(".zhutu img").first().attr("src") || "");

    // Collect chapters from all paginated pages
    const allChapters: { id: string; title: string; url: string; order: number }[] = [];
    const seen = new Set<string>();
    const seenBH = new Set<string>();

    function collectChapters(_$: ReturnType<typeof parseHTML>) {
      _$(".info a").each((_, a) => {
        const href = $(a).attr("href") || "";
        const m = href.match(CHAPTER_RE);
        if (!m) return;
        const key = m[2];
        if (seen.has(key)) return;
        seen.add(key);
        const bh = m[1];
        const isPrefixed = bh && bh !== bookId && !seenBH.has(bh + key);
        if (isPrefixed) seenBH.add(bh + key);
        allChapters.push({
          id: key,
          title: cleanText($(a).text()),
          url: absolutizeURL(BASE, href),
          order: 0,
        });
      });
    }

    collectChapters($);

    // Follow pagination links to get all chapters
    for (let page = 1; page < 30; page++) {
      let nextUrl = "";
      const nextLink = $(`a:contains("下一页"), a:contains("下一頁"), a:contains("▶")`).first();
      const nextHref = nextLink.attr("href") || "";
      if (nextHref) {
        nextUrl = absolutizeURL(`${BASE}/book/${bookId}/`, nextHref);
      } else {
        nextUrl = `${BASE}/book/${bookId}/index_${page + 1}.html`;
      }
      if (!nextUrl.includes(bookId)) break;
      try {
        const pageHtml = await fetchHTML(nextUrl);
        const page$ = parseHTML(pageHtml);
        const prevCount = allChapters.length;
        collectChapters(page$);
        if (allChapters.length === prevCount) break;
        $ = page$;
      } catch { break; }
    }

    // Ad removal markers
    const filteredChapters = allChapters.filter((ch) => {
      const t = ch.title;
      return !t.includes("biquge345") && !t.includes("笔趣阁");
    });

    return {
      site: this.key,
      bookId,
      title: title || bookId,
      author: author || "未知",
      description: description || "",
      coverUrl,
      sourceUrl: `${BASE}/book/${bookId}/`,
      chapters: filteredChapters.map((ch, i) => ({ ...ch, order: i + 1 })),
    };
  }

  async fetchChapter(
    bookId: string,
    chapter: { id: string; url: string; title: string }
  ): Promise<ChapterContent> {
    const url = chapter.url || `${BASE}/chapter/${bookId}/${chapter.id}.html`;
    const html = await fetchHTML(url);
    const $ = parseHTML(html);

    let title = cleanText($("#neirong h1").first().text()) || chapter.title;

    const extractText = (h: string): string => {
      const _$ = parseHTML(h);
      const contentDiv = _$("#txt");
      const paragraphs: string[] = [];
      contentDiv.contents().each((_, node) => {
        if (node.type === "text") {
          const line = cleanText(_$(node).text());
          if (line && !isAd(line)) paragraphs.push(line);
        } else if (node.type === "tag") {
          const text = cleanText(_$(node).text());
          if (text && !isAd(text)) paragraphs.push(text);
        }
      });
      return paragraphs.join("\n");
    };

    const firstText = extractText(html);
    const text = await fetchMultiPageChapter(
      html,
      firstText,
      (p) => `${BASE}/chapter/${bookId}/${chapter.id}_${p}.html`,
      extractText,
      { maxPages: 5, concurrency: 2 }
    );

    return { id: chapter.id, title, content: text };
  }
}

function isAd(line: string): boolean {
  return !line || line.includes("biquge345") || line.includes("笔趣阁小说网");
}
