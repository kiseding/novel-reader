// Novel source types — mirrors go-novel-dl's model package

export interface SearchResult {
  site: string;
  bookId: string;
  title: string;
  author: string;
  description: string;
  url: string;
  coverUrl: string;
  latestChapter: string;
}

export interface BookDetail {
  site: string;
  bookId: string;
  title: string;
  author: string;
  description: string;
  coverUrl: string;
  sourceUrl: string;
  chapters: ChapterItem[];
}

export interface ChapterItem {
  id: string;
  title: string;
  url: string;
  order: number;
}

export interface ChapterContent {
  id: string;
  title: string;
  content: string;
}

export interface ResolvedURL {
  siteKey: string;
  bookId: string;
  chapterId?: string;
  canonical: string;
}

export interface SiteSource {
  readonly key: string;
  readonly displayName: string;
  readonly tags: string[];
  search(keyword: string, limit: number): Promise<SearchResult[]>;
  downloadPlan(bookId: string): Promise<BookDetail>;
  fetchChapter(bookId: string, chapter: { id: string; url: string; title: string }): Promise<ChapterContent>;
  resolveURL(url: string): ResolvedURL | null;
}

// Database types
export interface UserRecord {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
}

export interface BookshelfItem {
  id: number;
  user_id: number;
  site: string;
  book_id: string;
  title: string;
  author: string;
  cover_url: string;
  latest_chapter: string;
  chapter_index: number;
  chapter_id: string;
  chapter_title: string;
  created_at: string;
  updated_at: string;
}
