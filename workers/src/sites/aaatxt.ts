// Ported from go-novel-dl internal/site/aaatxt.go
import type { SiteSource, SearchResult, BookDetail, ChapterContent, ResolvedURL } from "../types";
import { fetchHTML, postFormHTML, parseHTML, absolutizeURL, cleanText } from "../utils/http";
import { withRetry } from "../utils/retry";
import { encodeSearchQuery } from "../utils/gbk";

const BASE = "http://www.aaatxt.com";
const BOOK_RE = /^\/shu\/(\d+)\.html$/;
const CHAPTER_RE = /^\/yuedu\/(\d+_\d+)\.html$/;
const AD_MARKERS = [
  "按键盘上方向键", "未阅读完", "加入书签", "已便下次继续阅读",
  "更多原创手机电子书", "免费TXT小说下载",
];

export class AaatxtSource implements SiteSource {
  readonly key = "aaatxt";
  readonly displayName = "3A电子书";
  readonly tags = ["中文", "TXT", "电子书"];

  resolveURL(url: string): ResolvedURL | null {
    try {
      const u = new URL(url);
      const host = u.hostname.replace("www.", "");
      if (host !== "aaatxt.com") return null;
      let m = u.pathname.match(CHAPTER_RE);
      if (m) {
        const bookId = m[1].split("_")[0];
        return { siteKey: this.key, bookId, chapterId: m[1], canonical: `${BASE}${u.pathname}` };
      }
      m = u.pathname.match(BOOK_RE);
      if (m) return { siteKey: this.key, bookId: m[1], canonical: `${BASE}${u.pathname}` };
    } catch {}
    return null;
  }

  async search(keyword: string, limit: number): Promise<SearchResult[]> {
    // Encode keyword + submit button in GBK-style for aaatxt compatibility
    const encoded = encodeSearchQuery(keyword, "gbk");
    const submit = encodeSearchQuery("搜 索", "gbk");
    const url = `${BASE}/search.php?keyword=${encoded}&submit=${submit}`;
    const html = await fetchHTML(url, { headers: { Referer: `${BASE}/` } });
    const $ = parseHTML(html);
    const results: SearchResult[] = [];
    const seen = new Set<string>();

    $("table.list.sort").each((_, table) => {
      const link = $(table).find("a.name").first();
      const href = link.attr("href") || "";
      const m = href.match(BOOK_RE);
      if (!m) return;
      const bookId = m[1];
      if (seen.has(bookId)) return;
      seen.add(bookId);

      const authorText = cleanText($(table).find("td.size").first().text());
      let author = "";
      for (const token of authorText.split(/\s+/)) {
        if (token.startsWith("上传:") || token.startsWith("上传：")) {
          author = token.replace(/^上传[：:]/, "").trim();
          break;
        }
      }
      const introText = cleanText($(table).find("td.intro").first().text());
      let description = introText;
      for (const marker of ["更新:", "更新："]) {
        if (introText.includes(marker)) {
          description = introText.split(marker)[0].trim();
          break;
        }
      }

      results.push({
        site: this.key,
        bookId,
        title: cleanText(link.text()),
        author: author || "未知",
        description: description || "",
        url: absolutizeURL(BASE, href),
        coverUrl: absolutizeURL(BASE, $(table).find("img.cover").first().attr("src") || ""),
        latestChapter: "",
      });
    });

    return limit > 0 ? results.slice(0, limit) : results;
  }

  async downloadPlan(bookId: string): Promise<BookDetail> {
    const html = await withRetry(() => fetchHTML(`${BASE}/shu/${bookId}.html`));
    let $ = parseHTML(html);

    const title = cleanText($(".xiazai h1").first().text());
    const author = cleanText($("#author a").first().text());
    const description = cleanText($("#jj p").first().text());
    const coverUrl = absolutizeURL(BASE, $("#txtbook .fm img").first().attr("src") || "");

    // Collect chapters from all paginated pages
    const allChapters: { id: string; title: string; url: string; order: number }[] = [];
    const seen = new Set<string>();

    function collectChapters(_$: ReturnType<typeof parseHTML>) {
      _$("#ml a").each((_, a) => {
        const href = $(a).attr("href") || "";
        const m = href.match(CHAPTER_RE);
        if (!m) return;
        if (seen.has(m[1])) return;
        seen.add(m[1]);
        allChapters.push({
          id: m[1],
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
      const nextLink = $(`a:contains("下一页"), a:contains("下一頁")`).first();
      const nextHref = nextLink.attr("href") || "";
      if (nextHref) {
        nextUrl = absolutizeURL(`${BASE}/shu/${bookId}.html`, nextHref);
      } else {
        nextUrl = `${BASE}/shu/${bookId}_${page + 1}.html`;
      }
      if (!nextUrl.includes(bookId)) break;
      try {
        const pageHtml = await withRetry(() => fetchHTML(nextUrl));
        const page$ = parseHTML(pageHtml);
        const prevCount = allChapters.length;
        collectChapters(page$);
        if (allChapters.length === prevCount) break;
        $ = page$;
      } catch { break; }
    }

    return {
      site: this.key,
      bookId,
      title: title || bookId,
      author: author || "未知",
      description: description || "",
      coverUrl,
      sourceUrl: `${BASE}/shu/${bookId}.html`,
      chapters: allChapters.map((ch, i) => ({ ...ch, order: i + 1 })),
    };
  }

  async fetchChapter(
    _bookId: string,
    chapter: { id: string; url: string; title: string }
  ): Promise<ChapterContent> {
    const html = await withRetry(() => fetchHTML(`${BASE}/yuedu/${chapter.id}.html`));
    const $ = parseHTML(html);

    let title = cleanText($("#content h1").first().text());
    if (title.includes("-")) {
      const parts = title.split("-");
      if (parts.length >= 2 && parts[1].trim()) title = parts[1].trim();
    }
    if (!title) title = chapter.title;

    const paragraphs: string[] = [];
    $(".chapter").contents().each((_, node) => {
      if (node.type === "text") {
        for (const line of cleanText($(node).text()).split("\n")) {
          const trimmed = line.trim();
          if (trimmed && !isAaatxtAd(trimmed)) paragraphs.push(trimmed);
        }
      }
    });

    return { id: chapter.id, title, content: paragraphs.join("\n") };
  }
}

function isAaatxtAd(line: string): boolean {
  if (!line) return true;
  return AD_MARKERS.some((m) => line.includes(m));
}
