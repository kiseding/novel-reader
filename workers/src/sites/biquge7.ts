// New笔趣阁 (biquge7.xyz) — 连载网文源
import type { SiteSource, SearchResult, BookDetail, ChapterContent, ResolvedURL } from "../types";
import { fetchHTML, parseHTML, absolutizeURL, cleanText } from "../utils/http";

const BASE = "https://www.biquge7.xyz";
const BOOK_RE = /^\/(\d+)$/;
const CHAPTER_RE = /^\/(\d+)\/(\d+)$/;

export class Biquge7Source implements SiteSource {
  readonly key = "biquge7";
  readonly displayName = "新笔趣阁";
  readonly tags = ["中文", "网文", "连载"];

  resolveURL(url: string): ResolvedURL | null {
    try {
      const u = new URL(url);
      if (!u.hostname.includes("biquge7")) return null;
      let m = u.pathname.match(CHAPTER_RE);
      if (m) return { siteKey: this.key, bookId: m[1], chapterId: m[2], canonical: `${BASE}${u.pathname}` };
      m = u.pathname.match(BOOK_RE);
      if (m) return { siteKey: this.key, bookId: m[1], canonical: `${BASE}${u.pathname}` };
    } catch {}
    return null;
  }

  async search(keyword: string, limit: number): Promise<SearchResult[]> {
    const html = await fetchHTML(`${BASE}/search?keyword=${encodeURIComponent(keyword)}`);
    const $ = parseHTML(html);
    const results: SearchResult[] = [];
    const seen = new Set<string>();

    $("div.tui_1_item").each((_, item) => {
      if (results.length >= limit) return false;
      const $item = $(item);
      const link = $item.find("a[href]").first();
      const href = link.attr("href") || "";
      const bookId = href.match(BOOK_RE)?.[1];
      if (!bookId || seen.has(bookId)) return;
      seen.add(bookId);

      const title = cleanText($item.find(".title a").first().text()) ||
        cleanText(link.attr("title") || link.text());
      const author = cleanText($item.find(".author").first().text());
      const desc = cleanText($item.find("p").first().text());
      const coverUrl = absolutizeURL(BASE, $item.find("img").first().attr("src") || "");
      if (!title) return;

      results.push({
        site: this.key, bookId, title, author: author || "未知",
        description: desc, url: `${BASE}/${bookId}/`, coverUrl, latestChapter: "",
      });
    });

    return results.slice(0, limit);
  }

  async downloadPlan(bookId: string): Promise<BookDetail> {
    const html = await fetchHTML(`${BASE}/${bookId}`);
    const $ = parseHTML(html);

    const title = $('meta[property="og:novel:book_name"]').attr("content") ||
      $('meta[property="og:title"]').attr("content") || bookId;
    const author = $('meta[property="og:novel:author"]').attr("content") || "未知";
    const description = $('meta[property="og:description"]').attr("content") || "";
    const coverUrl = $('meta[property="og:image"]').attr("content") || "";

    // Collect chapters from <li><a href="/{bookId}/{num}"> — dedup by href
    const seen = new Set<string>();
    const chapters: { id: string; title: string; url: string; order: number }[] = [];

    $(`li a[href^="/${bookId}/"]`).each((_, a) => {
      const href = $(a).attr("href") || "";
      const m = href.match(CHAPTER_RE);
      if (!m || m[1] !== bookId) return;
      const chId = m[2];
      if (seen.has(href)) return;
      seen.add(href);
      chapters.push({
        id: chId,
        title: cleanText($(a).text()),
        url: `${BASE}/${bookId}/${chId}`,
        order: 0,
      });
    });

    // Sort ascending by chapter number
    chapters.sort((a, b) => parseInt(a.id) - parseInt(b.id));
    chapters.forEach((ch, i) => { ch.order = i + 1; });

    return {
      site: this.key, bookId, title, author, description, coverUrl,
      sourceUrl: `${BASE}/${bookId}/`,
      chapters,
    };
  }

  async fetchChapter(
    bookId: string,
    chapter: { id: string; url: string; title: string }
  ): Promise<ChapterContent> {
    const url = chapter.url || `${BASE}/${bookId}/${chapter.id}`;
    const html = await fetchHTML(url);
    const $ = parseHTML(html);

    // Extract chapter title from <title> tag: "第一章 陨落的天才_斗破苍穹-新笔趣阁"
    const pageTitle = cleanText($("title").first().text());
    const chTitle = pageTitle.split("_")[0] || chapter.title;

    // Extract content from <div class="text">
    const contentDiv = $("div.text").first();
    const paragraphs: string[] = [];
    contentDiv.contents().each((_, node) => {
      if (node.type === "tag" && node.name === "br") {
        // <br> acts as paragraph separator
        if (paragraphs.length && paragraphs[paragraphs.length - 1] !== "") {
          paragraphs.push("");
        }
      } else if (node.type === "text") {
        const text = cleanText($(node).text());
        if (text) paragraphs.push(text);
      }
    });

    const content = paragraphs
      .map(p => p.replace(/&nbsp;/g, " ").trim())
      .filter(Boolean)
      .join("\n");

    if (!content) throw new Error("biquge7 章节内容未找到");

    return { id: chapter.id, title: chTitle, content };
  }
}
