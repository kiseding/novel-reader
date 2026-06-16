// Site source registry — 6 verified-working 转载站
import type { SiteSource, SearchResult, BookDetail } from "../types";

// Re-export SearchResult for the homepage
export type { SearchResult };

import { Biquge345Source } from "./biquge345";
import { Biquge5Source } from "./biquge5";
import { Ixdzs8Source } from "./ixdzs8";
import { FsshuSource } from "./fsshu";
import { fetchHTML, parseHTML, absolutizeURL, cleanText } from "../utils/http";

export interface SourceMeta {
  key: string;
  displayName: string;
  tags: string[];
  searchable: boolean;
}

export class SiteRegistry {
  private sources: Map<string, SiteSource>;
  private meta: SourceMeta[];

  constructor() {
    const list: SiteSource[] = [
      new Biquge345Source(),
      new Biquge5Source(),
      new Ixdzs8Source(),
      new FsshuSource(),
    ];
    this.sources = new Map();
    this.meta = [];
    for (const s of list) {
      this.sources.set(s.key, s);
      this.meta.push({ key: s.key, displayName: s.displayName, tags: s.tags, searchable: true });
    }
  }

  getSource(key: string): SiteSource | undefined { return this.sources.get(key); }
  getSources(): SourceMeta[] { return this.meta; }
  getSearchableSources(): SourceMeta[] { return this.meta.filter(m => m.searchable); }

  resolveURL(url: string): { siteKey: string; bookId: string; chapterId?: string } | null {
    for (const source of this.sources.values()) {
      const resolved = source.resolveURL(url);
      if (resolved) return resolved;
    }
    return null;
  }

  // Homepage — scrape /top/ ranking with homepage fallback
  async getHomepageBooks(): Promise<SearchResult[]> {
    const books: SearchResult[] = [];
    const seen = new Set<string>();
    // Try biquge5 /top/ first, then fsshu /top/, then homepage fallback
    const sources: Array<{ key: string; url: string }> = [
      { key: "biquge5", url: "https://www.biquge5.com/top/" },
      { key: "fsshu", url: "https://www.fsshu.com/top/" },
    ];
    for (const src of sources) {
      if (books.length >= 20) break;
      try {
        const html = await fetchHTML(src.url);
        const $ = parseHTML(html);
        const base = src.key === "biquge5" ? "https://www.biquge5.com" : "https://www.fsshu.com";
        $("a").each((_, a) => {
          if (books.length >= 30) return false;
          const href = $(a).attr("href") || "";
          const m = href.match(/^\/(\d+_\d+)\/?$/);
          if (!m) return;
          const bookId = m[1];
          if (seen.has(bookId)) return;
          seen.add(bookId);
          const title = cleanText($(a).attr("title") || $(a).text())
            .replace(/^\[[^\]]+\]\s*/, "").replace(/\s*全文阅读$/, "").trim();
          if (!title) return;
          books.push({
            site: src.key, bookId, title, author: "", description: "",
            url: base + href,
            coverUrl: `${base}/images/${bookId.split("_")[0]}/${bookId.split("_")[1]}/${bookId.split("_")[1]}s.jpg`,
            latestChapter: "",
          });
        });
      } catch {}
    }
    // Fallback: homepage
    if (books.length === 0) {
      try {
        const html = await fetchHTML("https://www.biquge5.com/");
        const $ = parseHTML(html);
        $("a").each((_, a) => {
          if (books.length >= 30) return false;
          const href = $(a).attr("href") || "";
          const m = href.match(/^\/(\d+_\d+)\/?$/);
          if (!m) return;
          const bookId = m[1];
          if (seen.has(bookId)) return;
          seen.add(bookId);
          const title = cleanText($(a).attr("title") || $(a).text())
            .replace(/^\[[^\]]+\]\s*/, "").replace(/\s*全文阅读$/, "").trim();
          if (!title) return;
          const [cat, id] = bookId.split("_");
          books.push({
            site: "biquge5", bookId, title, author: "", description: "",
            url: `https://www.biquge5.com/${bookId}/`,
            coverUrl: `https://www.biquge5.com/images/${cat}/${id}/${id}s.jpg`,
            latestChapter: "",
          });
        });
      } catch {}
    }
    return books.slice(0, 30);
  }

  // Category books — scrape /top/ ranking page which has [`玄幻`] category markers,
  // then filter by category name. Much more reliable than per-category pages.
  private CAT_NAMES: Record<string, string> = {
    "1": "玄幻", "2": "武侠", "3": "都市", "4": "历史",
    "5": "网游", "6": "科幻", "7": "言情",
  };

  async getCategoryBooks(slug: string): Promise<SearchResult[]> {
    const catName = this.CAT_NAMES[slug];
    if (!catName) return this.getHomepageBooks();

    const books: SearchResult[] = [];
    const seen = new Set<string>();
    try {
      const html = await fetchHTML("https://www.biquge5.com/top/");
      const $ = parseHTML(html);
      $("a").each((_, a) => {
        if (books.length >= 30) return false;
        const href = $(a).attr("href") || "";
        const m = href.match(/^\/(\d+_\d+)\/?$/);
        if (!m) return;
        const bookId = m[1];
        if (seen.has(bookId)) return;
        seen.add(bookId);
        const raw = cleanText($(a).attr("title") || $(a).text());
        const catMatch = raw.match(/^\[([^\]]+)\]/);
        if (!catMatch || catMatch[1] !== catName) return;
        const title = raw.replace(/^\[[^\]]+\]\s*/, "").replace(/\s*全文阅读$/, "").trim();
        if (!title) return;
        const [cat, id] = bookId.split("_");
        books.push({
          site: "biquge5", bookId, title, author: "", description: "",
          url: `https://www.biquge5.com/${bookId}/`,
          coverUrl: `https://www.biquge5.com/images/${cat}/${id}/${id}s.jpg`,
          latestChapter: "",
        });
      });
    } catch {}
    if (books.length === 0) return this.getHomepageBooks();
    return books.slice(0, 30);
  }

  async searchAll(sites: string[], keyword: string, limit: number): Promise<SearchResult[]> {
    const targetSources = sites.length > 0
      ? sites.map(k => this.sources.get(k)).filter(Boolean) as SiteSource[]
      : Array.from(this.sources.values());
    const results: SearchResult[] = [];

    // Per-source 8s timeout via Promise.race, max 5 results per source
    const promises = targetSources.map(async (source) => {
      try {
        return await Promise.race([
          source.search(keyword, Math.min(limit, 5)),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
        ]) as SearchResult[];
      } catch { return []; }
    });
    const allResults = await Promise.all(promises);
    for (const items of allResults) results.push(...items);
    return results.slice(0, limit || results.length);
  }

  async getBookDetail(siteKey: string, bookId: string): Promise<BookDetail> {
    const source = this.sources.get(siteKey);
    if (!source) throw new Error(`未找到书源: ${siteKey}`);
    const detail = await source.downloadPlan(bookId);
    return detail;
  }

  async getChapterContent(siteKey: string, bookId: string, chapter: { id: string; url: string; title: string }) {
    const source = this.sources.get(siteKey);
    if (!source) throw new Error(`未找到书源: ${siteKey}`);
    return source.fetchChapter(bookId, chapter);
  }
}

let registry: SiteRegistry | null = null;
export function getRegistry(): SiteRegistry {
  if (!registry) registry = new SiteRegistry();
  return registry;
}
