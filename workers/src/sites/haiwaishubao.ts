// Ported from go-novel-dl internal/site/haiwaishubao.go
import type { SiteSource, SearchResult, BookDetail, ChapterContent, ResolvedURL } from "../types";
import { fetchHTML, parseHTML, absolutizeURL, cleanText } from "../utils/http";

const BASE = "https://www.haiwaishubao.com";
const SEARCH_BASE = "https://www.haiwaishubao1.com";
const BOOK_RE = /^\/book\/(\d+)\/?$/;
const CHAPTER_RE = /^\/book\/(\d+)\/(\d+)(?:_\d+)?\.html$/;

export class HaiwaishubaoSource implements SiteSource {
  readonly key = "haiwaishubao";
  readonly displayName = "海外书包";
  readonly tags = ["简体中文", "转载站", "成人向", "NSFW"];

  resolveURL(url: string): ResolvedURL | null {
    try {
      const u = new URL(url);
      if (!u.hostname.includes("haiwaishubao.com")) return null;
      let m = u.pathname.match(CHAPTER_RE);
      if (m) return { siteKey: this.key, bookId: m[1], chapterId: m[2], canonical: this.chapterURL(m[1], m[2]) };
      m = u.pathname.match(BOOK_RE);
      if (m) return { siteKey: this.key, bookId: m[1], canonical: this.bookURL(m[1]) };
    } catch {}
    return null;
  }

  async search(keyword: string, limit: number): Promise<SearchResult[]> {
    const body = new URLSearchParams();
    body.set("searchkey", keyword);
    body.set("searchtype", "all");
    body.set("submit", "");
    const html = await fetchHTML(`${SEARCH_BASE}/search/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: SEARCH_BASE,
      },
      body: body.toString(),
    });
    const $ = parseHTML(html);
    const results: SearchResult[] = [];

    $(".SHsectionThree-middle p").each((_, row) => {
      const a = $(row).find('a[href*="/book/"]').first();
      const href = a.attr("href") || "";
      const m = href.match(BOOK_RE);
      if (!m) return;

      results.push({
        site: this.key,
        bookId: m[1],
        title: a.attr("title") || cleanText(a.text()),
        author: cleanText($(row).find('a[href*="/author/"]').first().text()),
        description: "",
        url: this.bookURL(m[1]),
        coverUrl: $(row).find("img.lazyload").first().attr("_src") || $(row).find("img.lazyload").first().attr("src") || $(row).find("img").first().attr("_src") || $(row).find("img").first().attr("src") || "",
        latestChapter: "",
      });
      if (limit > 0 && results.length >= limit) return false;
    });

    return results;
  }

  async downloadPlan(bookId: string): Promise<BookDetail> {
    const html = await fetchHTML(this.bookURL(bookId), {
      headers: { Referer: `${BASE}/` },
    });
    const $ = parseHTML(html);

    const title = $('meta[property="og:title"]').attr("content") ||
      cleanText($("p.title").first().text());
    const author = $('meta[property="og:novel:author"]').attr("content") ||
      cleanText($("p.author").first().text());
    const description = ($('meta[property="og:description"]').attr("content") || "")
      .replace(/&emsp;/g, "");
    const coverUrl = $('meta[property="og:image"]').attr("content") ||
      $(".BGsectionOne-top-left img").first().attr("src") || "";

    // Paginated chapter list
    const chapters: { id: string; title: string; url: string; order: number }[] = [];
    for (let page = 1; page <= 50; page++) {
      try {
        const catHtml = await fetchHTML(this.catalogURL(bookId, page), {
          headers: { Referer: this.bookURL(bookId) },
        });
        const $cat = parseHTML(catHtml);
        const pageChapters: { id: string; title: string; url: string; order: number }[] = [];
        $cat(".BCsectionTwo-top a").each((_: number, a: any) => {
          const href = $(a).attr("href") || "";
          const m = href.match(CHAPTER_RE);
          if (m) pageChapters.push({ id: m[2], title: cleanText($(a).text()), url: absolutizeURL(BASE, href), order: 0 });
        });
        if (!pageChapters.length) break;
        chapters.push(...pageChapters);
        if (!catHtml.includes("下一页") && !catHtml.includes("下一頁")) break;
      } catch {
        if (page === 1) throw new Error("haiwaishubao 目录获取失败");
        break;
      }
    }

    return {
      site: this.key, bookId,
      title: title || bookId,
      author: author || "未知",
      description: description || "",
      coverUrl,
      sourceUrl: this.bookURL(bookId),
      chapters: chapters.map((ch, i) => ({ ...ch, order: i + 1 })),
    };
  }

  async fetchChapter(
    bookId: string,
    chapter: { id: string; url: string; title: string }
  ): Promise<ChapterContent> {
    const html = await fetchHTML(this.chapterURL(bookId, chapter.id), {
      headers: { Referer: this.bookURL(bookId) },
    });
    const $ = parseHTML(html);

    const title = cleanText($("#chapterTitle").first().text()) || chapter.title;
    const paragraphs: string[] = [];
    $("#content p").each((_: number, p: any) => {
      const text = cleanText($(p).text()).replace(/&emsp;/g, "").replace(/&esp;/g, "");
      if (text) paragraphs.push(text);
    });

    return { id: chapter.id, title, content: paragraphs.join("\n") };
  }

  private bookURL(id: string): string {
    return `${BASE}/book/${id}/`;
  }
  private catalogURL(id: string, page: number): string {
    if (page <= 1) return `${BASE}/index/${id}/`;
    return `${BASE}/index/${id}/${page}/`;
  }
  private chapterURL(bookId: string, chapterId: string, page = 1): string {
    if (page <= 1) return `${BASE}/book/${bookId}/${chapterId}.html`;
    return `${BASE}/book/${bookId}/${chapterId}_${page}.html`;
  }
}
