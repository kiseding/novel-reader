// Site source registry — 6 verified-working 转载站
import type { SiteSource, SearchResult, BookDetail } from "../types";

// Re-export SearchResult for the homepage
export type { SearchResult };

import { Biquge345Source } from "./biquge345";
import { Biquge5Source } from "./biquge5";
import { AaatxtSource } from "./aaatxt";
import { Ixdzs8Source } from "./ixdzs8";
import { FsshuSource } from "./fsshu";
import { HaiwaishubaoSource } from "./haiwaishubao";
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
      new AaatxtSource(),
      new Ixdzs8Source(),
      new FsshuSource(),
      new HaiwaishubaoSource(),
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

  // Category ranking — try a small set of URL templates per source. Sources
  // may use different paths; we try common patterns and dedupe across what
  // responds. Falls back to homepage on total failure.
  async getCategoryBooks(slug: string): Promise<SearchResult[]> {
    const books: SearchResult[] = [];
    const seen = new Set<string>();
    const sites: Array<{ key: string; base: string; templates: string[] }> = [
      {
        key: "biquge5",
        base: "https://www.biquge5.com",
        templates: [`/sort/${slug}/`, `/sort/${slug}_1/`, `/${slug}/`, `/list/${slug}/`, `/${slug}_1/`],
      },
      {
        key: "fsshu",
        base: "https://www.fsshu.com",
        templates: [`/sort/${slug}/`, `/sort/${slug}_1/`, `/${slug}/`, `/list/${slug}/`],
      },
    ];

    for (const site of sites) {
      if (books.length >= 30) break;
      for (const tmpl of site.templates) {
        if (books.length >= 30) break;
        try {
          const html = await fetchHTML(site.base + tmpl);
          const $ = parseHTML(html);
          let pageHits = 0;
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
              site: site.key,
              bookId,
              title,
              author: "",
              description: "",
              url: site.base + href,
              coverUrl: `${site.base}/images/${cat}/${id}/${id}s.jpg`,
              latestChapter: "",
            });
            pageHits++;
          });
          if (pageHits > 0) break;
        } catch {}
      }
    }

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
