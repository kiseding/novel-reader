// Ported from go-novel-dl internal/site/ixdzs8.go
import type { SiteSource, SearchResult, BookDetail, ChapterContent, ResolvedURL } from "../types";
import { fetchHTML, parseHTML, absolutizeURL, cleanText } from "../utils/http";

const BASE = "https://ixdzs8.com";
const BOOK_RE = /^\/read\/(\d+)\/?$/;
const CHAPTER_RE = /^\/read\/(\d+)\/(p\d+)\.html$/;
const TOKEN_RE = /(?:let|var|const)\s+token\s*=\s*["']([^"']+)["']/i;

export class Ixdzs8Source implements SiteSource {
  readonly key = "ixdzs8";
  readonly displayName = "爱下电子书";
  readonly tags = ["中文", "电子书"];

  resolveURL(url: string): ResolvedURL | null {
    try {
      const u = new URL(url);
      if (u.hostname.replace("www.", "") !== "ixdzs8.com") return null;
      let m = u.pathname.match(CHAPTER_RE);
      if (m) return { siteKey: this.key, bookId: m[1], chapterId: m[2], canonical: `https://ixdzs8.com${u.pathname}` };
      m = u.pathname.match(BOOK_RE);
      if (m) return { siteKey: this.key, bookId: m[1], canonical: `https://ixdzs8.com${u.pathname}` };
    } catch {}
    return null;
  }

  async search(keyword: string, limit: number): Promise<SearchResult[]> {
    const cookies: string[] = [];
    const html = await this.fetchVerified(`${BASE}/bsearch?q=${encodeURIComponent(keyword)}`, cookies);
    const $ = parseHTML(html);
    const results: SearchResult[] = [];
    const seen = new Set<string>();

    $("li.burl").each((_, item) => {
      const titleLink = $(item).find(".bname a").first();
      let href = titleLink.attr("href") || "";
      let bookId = extractBookId(href);
      if (!bookId) bookId = extractBookId($(item).attr("data-url") || "");
      if (!bookId || seen.has(bookId)) return;
      seen.add(bookId);

      results.push({
        site: this.key,
        bookId,
        title: cleanText(titleLink.attr("title") || titleLink.text()),
        author: cleanText($(item).find("a.bauthor").first().text()),
        description: cleanIxdzsSummary(cleanText($(item).find("p.l-p2").first().text())),
        url: `${BASE}/read/${bookId}/`,
        coverUrl: $(item).find("img").first().attr("src") || "",
        latestChapter: cleanText($(item).find("span.l-chapter").first().text()),
      });
    });

    return limit > 0 ? results.slice(0, limit) : results;
  }

  async downloadPlan(bookId: string): Promise<BookDetail> {
    const cookies: string[] = [];
    const html = await this.fetchVerified(`${BASE}/read/${bookId}/`, cookies);
    const catalogData = await this.postCatalog(bookId, cookies);
    const $ = parseHTML(html);

    const title = $('meta[property="og:novel:book_name"]').attr("content") ||
      cleanText($("h1.n-text").first().text());
    const author = $('meta[property="og:novel:author"]').attr("content") ||
      cleanText($("a.bauthor").first().text());
    const description = cleanIxdzsSummary(
      $('meta[property="og:description"]').attr("content") || ""
    );
    const coverUrl = $('meta[property="og:image"]').attr("content") ||
      $(".n-img img").first().attr("src") || "";

    let payload: { data?: { ordernum?: string | number; title?: string }[] };
    try {
      payload = JSON.parse(catalogData);
    } catch {
      throw new Error("ixdzs8 目录解析失败");
    }

    const chapters = (payload.data || [])
      .filter((item) => {
        const ord = String(item.ordernum ?? "").trim();
        return ord && ord !== "<nil>";
      })
      .map((item, i) => ({
        id: "p" + String(item.ordernum).trim(),
        title: cleanText(item.title || ""),
        url: `${BASE}/read/${bookId}/p${String(item.ordernum).trim()}.html`,
        order: i + 1,
      }));

    return {
      site: this.key, bookId,
      title: title || bookId,
      author: author || "未知",
      description: description || "",
      coverUrl: absolutizeURL(BASE, coverUrl),
      sourceUrl: `${BASE}/read/${bookId}/`,
      chapters,
    };
  }

  async fetchChapter(
    bookId: string,
    chapter: { id: string; url: string; title: string }
  ): Promise<ChapterContent> {
    const cookies: string[] = [];
    const html = await this.fetchVerified(`${BASE}/read/${bookId}/${chapter.id}.html`, cookies);
    const $ = parseHTML(html);

    let title = cleanText($("h1.page-d-top").first().text());
    if (!title) title = cleanText($("h3.page-content").first().text());
    if (!title) title = chapter.title;

    const paragraphs: string[] = [];
    $("section .page-content p").each((_, p) => {
      if ($(p).hasClass("abg")) return;
      const text = cleanText($(p).text());
      if (!text || isIxdzsAd(text)) return;
      paragraphs.push(text);
    });

    if (!paragraphs.length) {
      $(".page-content").first().contents().each((_, node) => {
        if (node.type === "text") {
          const text = cleanText($(node).text());
          if (text && !isIxdzsAd(text)) paragraphs.push(text);
        }
      });
    }

    if (!paragraphs.length) {
      $("p").each((_, p) => {
        const text = cleanText($(p).text());
        if (text && !isIxdzsAd(text)) paragraphs.push(text);
      });
    }

    if (paragraphs.length && title) {
      const first = paragraphs[0].replace(title, "").replace(title.replace(/\s/g, ""), "").trim();
      if (!first) paragraphs.shift();
      else paragraphs[0] = first;
    }

    if (paragraphs.length && paragraphs[paragraphs.length - 1].includes("本章完")) {
      paragraphs.pop();
    }

    if (!paragraphs.length) throw new Error("ixdzs8 章节内容未找到");

    return { id: chapter.id, title, content: paragraphs.join("\n") };
  }

  private async fetchVerified(url: string, cookies: string[]): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const headers: Record<string, string> = {};
      if (cookies.length) headers["Cookie"] = cookies.join("; ");

      let html = await fetchHTML(url, { headers });
      if (!isChallenge(html)) return html;

      const m = html.match(TOKEN_RE);
      if (!m) throw new Error("ixdzs8 challenge token not found");

      const sep = url.includes("?") ? "&" : "?";
      const challengeUrl = `${url}${sep}challenge=${m[1]}`;

      const resp = await fetch(challengeUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: url,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "zh-CN,zh;q=0.9",
          Cookie: cookies.join("; "),
        },
      });
      if (!resp.ok) throw new Error(`ixdzs8 challenge HTTP ${resp.status}`);

      const setCookie = resp.headers.get("Set-Cookie");
      if (setCookie) {
        cookies.length = 0;
        for (const part of setCookie.split(/,(?=\s*[^=;]+=)/)) {
          const name = part.split(";")[0]?.trim();
          if (name) cookies.push(name);
        }
      }

      html = await resp.text();
      if (!isChallenge(html)) return html;
    }
    throw new Error("ixdzs8 challenge bypass failed after 3 attempts");
  }

  private async postCatalog(bookId: string, cookies: string[]): Promise<string> {
    const form = new URLSearchParams();
    form.set("bid", bookId);
    const resp = await fetch(`${BASE}/novel/clist/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json, text/plain, */*",
        Origin: BASE,
        Referer: `${BASE}/read/${bookId}/`,
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Cookie: cookies.length ? cookies.join("; ") : "",
      },
      body: form.toString(),
    });
    if (!resp.ok) throw new Error(`ixdzs8 catalog HTTP ${resp.status}`);
    return resp.text();
  }
}

function extractBookId(raw: string): string | null {
  raw = raw.trim();
  if (!raw) return null;
  if (raw.startsWith("//")) raw = "https:" + raw;
  try {
    if (raw.startsWith("http")) raw = new URL(raw).pathname;
  } catch {}
  const m = raw.match(BOOK_RE);
  return m ? m[1] : null;
}

function cleanIxdzsSummary(s: string): string {
  return s.replace(/&nbsp;/g, "").replace(/<br\s*\/?>/gi, "\n").trim();
}

function isIxdzsAd(text: string): boolean {
  return !text.trim() || text.toLowerCase().includes("ixdzs");
}

function isChallenge(markup: string): boolean {
  if (!TOKEN_RE.test(markup)) return false;
  return (
    markup.includes("challenge=") ||
    markup.includes("正在进行安全验证") ||
    markup.includes("正在進行安全驗證") ||
    markup.includes("请稍等") ||
    markup.includes("請稍等")
  );
}
