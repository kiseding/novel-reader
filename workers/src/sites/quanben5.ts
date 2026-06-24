// 全本小说网 (quanben5.com) — 完本网文源
// Chapter content is server-rendered in <div id="content">.
import type { SiteSource, SearchResult, BookDetail, ChapterContent, ResolvedURL } from "../types";
import { fetchHTML, parseHTML, absolutizeURL, cleanText } from "../utils/http";

const BASE = "https://quanben5.com";
const BOOK_RE = /^\/n\/([^/]+)\/$/;
const CHAPTER_RE = /^\/n\/([^/]+)\/(\d+)\.html$/;
const STATIC_CHARS = "PXhw7UT1B0a9kQDKZsjIASmOezxYG4CHo5Jyfg2b8FLpEvRr3WtVnlqMidu6cN";

export class Quanben5Source implements SiteSource {
  readonly key = "quanben5";
  readonly displayName = "全本小说网";
  readonly tags = ["中文", "网文", "完本"];

  resolveURL(url: string): ResolvedURL | null {
    try {
      const u = new URL(url);
      if (!u.hostname.includes("quanben5") && !u.hostname.includes("quanben")) return null;
      // Chapter: /n/{slug}/{num}.html
      let m = u.pathname.match(CHAPTER_RE);
      if (m) return { siteKey: this.key, bookId: m[1], chapterId: m[2], canonical: `${BASE}${u.pathname}` };
      // Book: /n/{slug}/
      m = u.pathname.match(BOOK_RE);
      if (m) return { siteKey: this.key, bookId: m[1], canonical: `${BASE}${u.pathname}` };
    } catch {}
    return null;
  }

  async search(keyword: string, limit: number): Promise<SearchResult[]> {
    // Use the custom base64-encoded search API
    const b = this.customBase64(keyword);
    const searchUrl = `${BASE}/?c=book&a=search.json&callback=search&keywords=${encodeURIComponent(keyword)}&b=${encodeURIComponent(b)}`;
    try {
      const resp = await fetch(searchUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "text/javascript, application/javascript, */*",
          Referer: `${BASE}/`,
        },
      });
      if (!resp.ok) return [];
      const text = await resp.text();
      // JSONP response: search({...})
      const jsonMatch = text.match(/search\((\{.*\})\)/);
      if (!jsonMatch) return [];
      const data = JSON.parse(jsonMatch[1]);
      if (!data.content) return [];

      // Parse the HTML in the content field
      const $ = parseHTML(data.content);
      const results: SearchResult[] = [];

      $(".pic_txt_list").each((_, item) => {
        if (results.length >= limit) return false;
        const $item = $(item);
        const link = $item.find("h3 a").first();
        const href = link.attr("href") || "";
        const m = href.match(BOOK_RE);
        const bookId = m ? m[1] : "";
        if (!bookId) return;

        results.push({
          site: this.key,
          bookId,
          title: cleanText(link.text()),
          author: cleanText($item.find("span.author").first().text()),
          description: cleanText($item.find("p.description").first().text()),
          url: `${BASE}${href}`,
          coverUrl: absolutizeURL(BASE, $item.find("img").first().attr("src") || ""),
          latestChapter: "",
        });
      });

      return results.slice(0, limit);
    } catch {
      return [];
    }
  }

  async downloadPlan(bookId: string): Promise<BookDetail> {
    const html = await fetchHTML(`${BASE}/n/${bookId}/`, {
      headers: { Referer: `${BASE}/` },
    });
    const $ = parseHTML(html);

    const title = cleanText($("h1").first().text()) || bookId;
    const description = cleanText($(".description, div.description").first().text());
    const coverUrl = absolutizeURL(BASE, $(".pic img, .book-img img").first().attr("src") || "");

    // Extract author from description text: "作者:梦入神机,简介:..."
    let author = "";
    const descText = $(".description, div.description").first().text();
    const authorMatch = descText.match(/作者[：:]\s*([^,\s]+)/);
    if (authorMatch) author = authorMatch[1];

    // Collect all chapters — first try the book page, then fall back to xiaoshuo.html
    let chapters = this.extractChapters(bookId, $);

    // If no chapters found on book page, fetch xiaoshuo.html (chapter list page)
    if (chapters.length === 0) {
      try {
        const tocHtml = await fetchHTML(`${BASE}/n/${bookId}/xiaoshuo.html`, {
          headers: { Referer: `${BASE}/n/${bookId}/` },
        });
        const $toc = parseHTML(tocHtml);
        chapters = this.extractChapters(bookId, $toc);
      } catch {}
    }

    // Sort by chapter ID (numeric)
    chapters.sort((a, b) => {
      const na = parseInt(a.id) || 0;
      const nb = parseInt(b.id) || 0;
      return na - nb;
    });
    chapters.forEach((ch, i) => { ch.order = i + 1; });

    return {
      site: this.key,
      bookId,
      title,
      author: author || "未知",
      description,
      coverUrl,
      sourceUrl: `${BASE}/n/${bookId}/`,
      chapters,
    };
  }

  private extractChapters(bookId: string, $: any): { id: string; title: string; url: string; order: number }[] {
    const chapters: { id: string; title: string; url: string; order: number }[] = [];
    const seen = new Set<string>();

    $("a[href]").each((_i: number, a: any) => {
      const href = $(a).attr("href") || "";
      const m = href.match(CHAPTER_RE);
      if (!m || m[1] !== bookId) return;
      const chId = m[2];
      if (seen.has(chId)) return;
      seen.add(chId);
      chapters.push({
        id: chId,
        title: cleanText($(a).text()),
        url: `${BASE}${href}`,
        order: 0,
      });
    });

    return chapters;
  }

  async fetchChapter(
    bookId: string,
    chapter: { id: string; url: string; title: string }
  ): Promise<ChapterContent> {
    const url = chapter.url || `${BASE}/n/${bookId}/${chapter.id}.html`;
    const html = await fetchHTML(url, {
      headers: { Referer: `${BASE}/n/${bookId}/` },
    });
    const $ = parseHTML(html);

    const chTitle = cleanText($("h1.title1").first().text()) || chapter.title;

    // Extract paragraphs from <div id="content"> <p> ... </p>
    const paragraphs: string[] = [];
    $("#content p").each((_, p) => {
      const text = cleanText($(p).text());
      if (text && !text.includes("一秒记住") && !text.includes("请勿开启")) {
        paragraphs.push(text);
      }
    });

    // Fallback: all p tags in content area
    if (paragraphs.length === 0) {
      $(".content p").each((_, p) => {
        const text = cleanText($(p).text());
        if (text) paragraphs.push(text);
      });
    }

    const content = paragraphs.join("\n");
    if (!content) throw new Error("quanben5 章节内容未找到");

    return { id: chapter.id, title: chTitle, content };
  }

  // Custom base64 encoding matching the site's JavaScript:
  //   staticchars = "PXhw7UT1B0a9kQDKZsjIASmOezxYG4CHo5Jyfg2b8FLpEvRr3WtVnlqMidu6cN"
  //   Each input char is shifted +3 in staticchars, wrapped by random padding.
  private customBase64(input: string): string {
    // Step 1: URI-encode (like encodeURIComponent)
    const uriEncoded = encodeURIComponent(input);
    let result = "";
    for (const ch of uriEncoded) {
      const idx = STATIC_CHARS.indexOf(ch);
      let code: string;
      if (idx === -1) {
        code = ch; // e.g. '%' is not in staticchars, keep as-is
      } else {
        code = STATIC_CHARS[(idx + 3) % 62]; // shift forward by 3
      }
      // Add deterministic "random" padding (server ignores it)
      result += "P" + code + "P";
    }
    return result;
  }
}
