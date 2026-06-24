// 思路客 (siluke.com) — 中文网文源
// Chapter content is Base64-encoded in a <script> tag, decoded at runtime.
import type { SiteSource, SearchResult, BookDetail, ChapterContent, ResolvedURL } from "../types";
import { fetchHTML, parseHTML, absolutizeURL, cleanText } from "../utils/http";

const BASE = "https://www.siluke.com";
const BOOK_RE = /^\/([^/]+)\/$/;
const CHAPTER_RE = /^\/([^/]+)\/([^/]+)\.html$/;

export class SilukeSource implements SiteSource {
  readonly key = "siluke";
  readonly displayName = "思路客";
  readonly tags = ["中文", "网文"];

  resolveURL(url: string): ResolvedURL | null {
    try {
      const u = new URL(url);
      if (!u.hostname.includes("siluke.com")) return null;
      // Chapter: /{code}/{chapterId}.html
      let m = u.pathname.match(CHAPTER_RE);
      if (m) return { siteKey: this.key, bookId: m[1], chapterId: m[2], canonical: `${BASE}${u.pathname}` };
      // Book: /{code}/
      m = u.pathname.match(BOOK_RE);
      if (m) return { siteKey: this.key, bookId: m[1], canonical: `${BASE}${u.pathname}` };
    } catch {}
    return null;
  }

  async search(keyword: string, limit: number): Promise<SearchResult[]> {
    // POST search to /search.html
    const resp = await fetch(`${BASE}/search.html`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
      },
      body: `s=${encodeURIComponent(keyword)}&submit=submit`,
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    return this.parseSearchResults(html, limit);
  }

  private parseSearchResults(html: string, limit: number): SearchResult[] {
    const $ = parseHTML(html);
    const results: SearchResult[] = [];

    // Search results page: <ul class="sort_list"><li><span class="s2"><a href="/{code}/">Title</a></span><span class="s5">Author</span></li>...</ul>
    $('ul.sort_list li').each((_, li) => {
      if (results.length >= limit) return false;
      const $li = $(li);
      const link = $li.find("span.s2 a").first();
      const href = link.attr("href") || "";
      const m = href.match(BOOK_RE);
      const bookId = m ? m[1] : "";
      if (!bookId || results.some((r) => r.bookId === bookId)) return;

      results.push({
        site: this.key,
        bookId,
        title: cleanText(link.text()),
        author: cleanText($li.find("span.s5").first().text()),
        description: "",
        url: `${BASE}${href}`,
        coverUrl: "",
        latestChapter: "",
      });
    });

    // Fallback: parse as homepage-style (rec-focus-book items)
    if (results.length === 0) {
      $(".rec-focus-book").each((_, item) => {
        if (results.length >= limit) return false;
        const $item = $(item);
        const link = $item.find("h2 a").first();
        const href = link.attr("href") || "";
        const m = href.match(BOOK_RE);
        const bookId = m ? m[1] : "";
        if (!bookId || results.some((r) => r.bookId === bookId)) return;
        results.push({
          site: this.key,
          bookId,
          title: cleanText(link.text()),
          author: cleanText($item.find("p").first().text().replace("作者：", "")),
          description: cleanText($item.find("p").last().text()),
          url: `${BASE}${href}`,
          coverUrl: absolutizeURL(BASE, $item.find("img").first().attr("src") || ""),
          latestChapter: "",
        });
      });
    }

    return results.slice(0, limit);
  }

  async downloadPlan(bookId: string): Promise<BookDetail> {
    const html = await fetchHTML(`${BASE}/${bookId}/`, {
      headers: { Referer: `${BASE}/` },
    });
    const $ = parseHTML(html);

    const title = cleanText($(".bookname").first().text()) || bookId;
    const authorText = cleanText($(".author").first().text()).replace("著", "").trim();
    const coverUrl = absolutizeURL(BASE, $(".book-img img").first().attr("src") || "");

    // Collect chapters from the chapter list
    const chapters: { id: string; title: string; url: string; order: number }[] = [];
    const seen = new Set<string>();

    $(".chapter-list a[href]").each((_, a) => {
      const href = $(a).attr("href") || "";
      const m = href.match(CHAPTER_RE);
      if (!m || m[1] !== bookId) return;
      const chId = m[2];
      if (seen.has(chId) || chId === "chapter1") return; // skip TOC link
      seen.add(chId);

      const txt = cleanText($(a).text());
      // Skip non-chapter entries
      if (!txt || /^(开始阅读|章节目录|更多)/.test(txt)) return;

      chapters.push({
        id: chId,
        title: txt,
        url: `${BASE}${href}`,
        order: chapters.length + 1,
      });
    });

    return {
      site: this.key,
      bookId,
      title,
      author: authorText || "未知",
      description: "",
      coverUrl,
      sourceUrl: `${BASE}/${bookId}/`,
      chapters,
    };
  }

  async fetchChapter(
    bookId: string,
    chapter: { id: string; url: string; title: string }
  ): Promise<ChapterContent> {
    const url = chapter.url || `${BASE}/${bookId}/${chapter.id}.html`;
    const html = await fetchHTML(url, {
      headers: { Referer: `${BASE}/${bookId}/` },
    });

    // Extract Base64-encoded content from: document.writeln(til.sy('BASE64...'))
    const b64Match = html.match(/document\.writeln\(til\.sy\('([A-Za-z0-9+/=]+)'\)\)/);
    if (!b64Match) throw new Error("siluke 章节内容未找到（编码格式不符）");

    const decoded = Buffer.from(b64Match[1], "base64").toString("utf-8");

    // Parse the decoded HTML to extract text
    const $ = parseHTML(decoded);
    const paragraphs: string[] = [];
    $("p").each((_, p) => {
      const text = cleanText($(p).text());
      if (text) paragraphs.push(text);
    });

    // Fallback: extract all text from decoded HTML
    let content = paragraphs.join("\n");
    if (!content) {
      content = cleanText($("body").text() || decoded)
        .replace(/\s+/g, " ")
        .trim();
    }

    if (!content) throw new Error("siluke 章节内容未找到");

    // Extract chapter title
    let chTitle = cleanText($("h1").first().text()) || chapter.title;

    return { id: chapter.id, title: chTitle, content };
  }
}
