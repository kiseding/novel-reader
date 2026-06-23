// Site source registry — ixdzs8 (爱下电子书) only
import type { SiteSource, SearchResult, BookDetail } from "../types";
import { Ixdzs8Source } from "./ixdzs8";
import { fetchHTML, parseHTML, cleanText } from "../utils/http";

export type { SearchResult };

export interface SourceMeta {
  key: string;
  displayName: string;
  tags: string[];
  searchable: boolean;
}

// ixdzs8.com category IDs → display names
const CATEGORIES: Record<string, string> = {
  "0": "其他",
  "1": "玄幻奇幻",
  "2": "修真仙侠",
  "3": "都市青春",
  "4": "军事历史",
  "5": "网游竞技",
  "6": "科幻灵异",
  "7": "言情穿越",
  "8": "耽美同人",
  "9": "台言古言",
  "10": "传统武侠",
};

const BASE = "https://ixdzs8.com";

export class SiteRegistry {
  private sources: Map<string, SiteSource>;
  private meta: SourceMeta[];

  constructor() {
    const list: SiteSource[] = [new Ixdzs8Source()];
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

  /**
   * Homepage: scrape ixdzs8.com homepage for recent update list.
   * The homepage shows `li.burl` items with latest updated novels.
   */
  async getHomepageBooks(): Promise<SearchResult[]> {
    const books: SearchResult[] = [];
    const seen = new Set<string>();

    try {
      const html = await fetchHTML(`${BASE}/`);
      const $ = parseHTML(html);

      $("li.burl").each((_, li) => {
        if (books.length >= 30) return false;

        const $li = $(li);
        const href = $li.attr("data-url") || "";
        const bookId = href.match(/\/read\/(\d+)\//)?.[1];
        if (!bookId || seen.has(bookId)) return;
        seen.add(bookId);

        const title = cleanText($li.find(".bname a").attr("title") || $li.find(".bname a").text());
        const author = cleanText($li.find(".bauthor a").first().text());
        const desc = cleanText($li.find("p.l-p2").first().text());
        const coverUrl = $li.find(".l-img img").first().attr("src") || "";
        const latestChapter = cleanText($li.find(".l-chapter").first().text());

        if (!title) return;

        books.push({
          site: "ixdzs8", bookId, title, author: author || "未知",
          description: desc,
          url: `${BASE}/read/${bookId}/`,
          coverUrl,
          latestChapter,
        });
      });
    } catch (e) {
      console.error("Failed to fetch ixdzs8 homepage:", e);
    }

    return books.slice(0, 30);
  }

  /**
   * Category books: scrape ixdzs8.com /sort/{slug}/ page.
   * Slug is the numeric category ID (1-10).
   */
  async getCategoryBooks(slug: string): Promise<SearchResult[]> {
    const catName = CATEGORIES[slug];
    if (!catName) return this.getHomepageBooks();

    const books: SearchResult[] = [];
    const seen = new Set<string>();

    try {
      const html = await fetchHTML(`${BASE}/sort/${slug}/`);
      const $ = parseHTML(html);

      $("li.burl").each((_, li) => {
        if (books.length >= 30) return false;

        const $li = $(li);
        const href = $li.attr("data-url") || "";
        const bookId = href.match(/\/read\/(\d+)\//)?.[1];
        if (!bookId || seen.has(bookId)) return;
        seen.add(bookId);

        const title = cleanText($li.find(".bname a").attr("title") || $li.find(".bname a").text());
        const author = cleanText($li.find(".bauthor a").first().text());

        if (!title) return;

        books.push({
          site: "ixdzs8", bookId, title, author: author || "未知",
          description: "",
          url: `${BASE}/read/${bookId}/`,
          coverUrl: $li.find(".l-img img").first().attr("src") || "",
          latestChapter: "",
        });
      });
    } catch (e) {
      console.error(`Failed to fetch ixdzs8 category ${slug}:`, e);
    }

    if (books.length === 0) return this.getHomepageBooks();
    return books.slice(0, 30);
  }

  /**
   * Search all sources. Since there's only ixdzs8, delegate directly.
   */
  async searchAll(sites: string[], keyword: string, limit: number): Promise<SearchResult[]> {
    const source = this.sources.get("ixdzs8")!;
    try {
      return await Promise.race([
        source.search(keyword, Math.min(limit, 10)),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
      ]) as SearchResult[];
    } catch {
      return [];
    }
  }

  async getBookDetail(siteKey: string, bookId: string): Promise<BookDetail> {
    const source = this.sources.get(siteKey);
    if (!source) throw new Error(`未找到书源: ${siteKey}`);
    return source.downloadPlan(bookId);
  }

  async getChapterContent(siteKey: string, bookId: string, chapter: { id: string; url: string; title: string }) {
    const source = this.sources.get(siteKey);
    if (!source) throw new Error(`未找到书源: ${siteKey}`);
    return source.fetchChapter(bookId, chapter);
  }

  /** Get available categories (for frontend dropdown) */
  getCategories(): { id: string; name: string }[] {
    return Object.entries(CATEGORIES).map(([id, name]) => ({ id, name }));
  }
}

let registry: SiteRegistry | null = null;
export function getRegistry(): SiteRegistry {
  if (!registry) registry = new SiteRegistry();
  return registry;
}
