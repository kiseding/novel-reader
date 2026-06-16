import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import type { SearchItem } from "../lib/api";
import BookCard from "../components/BookCard";
import { useSearch } from "../hooks/useSearch";

function scoreResult(item: SearchItem, keyword: string): number {
  const kw = keyword.toLowerCase();
  const title = (item.title || "").toLowerCase();
  if (title === kw) return 100;
  if (title.startsWith(kw)) return 80;
  if (title.includes(kw)) return 60;
  let c = 0;
  for (const ch of kw) { if (title.includes(ch)) c++; }
  return c * 5;
}

// Numeric category IDs matching biquge5 /list{N}/ paths
const TAGS: Array<{ label: string; slug: string }> = [
  { label: "玄幻", slug: "1" },
  { label: "武侠", slug: "2" },
  { label: "都市", slug: "3" },
  { label: "历史", slug: "4" },
  { label: "网游", slug: "5" },
  { label: "科幻", slug: "6" },
  { label: "言情", slug: "7" },
];

// Stable per-mount shuffle so books don't re-order on each render.
function shuffle<T>(arr: T[], seed: number): T[] {
  const out = arr.slice();
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function HomePage() {
  const { keyword, results, loading, sourceErrors, exactMatch } = useSearch();
  const [books, setBooks] = useState<SearchItem[]>([]);
  const [homeLoading, setHomeLoading] = useState(true);
  const [activeTag, setActiveTag] = useState<string>("");
  const [shuffleSeed, setShuffleSeed] = useState<number>(() => 0xC0FFEE);

  useEffect(() => {
    if (keyword) return;
    setHomeLoading(true);
    api.getHomepage(activeTag || undefined)
      .then(res => { setBooks(res.books); setShuffleSeed(s => s + 1); })
      .catch(() => setBooks([]))
      .finally(() => setHomeLoading(false));
  }, [keyword, activeTag]);

  const displayBooks = useMemo(() => {
    if (!activeTag) return books;
    // For tag results, randomize order so repeated taps surface different books.
    return shuffle(books, shuffleSeed);
  }, [books, activeTag, shuffleSeed]);

  const exactKey = exactMatch ? `${exactMatch.site}|${exactMatch.bookId}` : null;
  const otherResults = exactKey
    ? results.filter(r => `${r.site}|${r.bookId}` !== exactKey)
    : results;
  const sorted = [...otherResults].sort((a, b) => scoreResult(b, keyword) - scoreResult(a, keyword));
  // Keep search view stable while a keyword is in flight; never bounce back to homepage.
  const showSearch = !!keyword;

  return (
    <div className="max-w-5xl mx-auto px-4 pt-2 pb-8">
      {showSearch ? (
        <>
          {sourceErrors.length > 0 && (
            <div className="mb-3 p-2.5 rounded-lg text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300">
              {sourceErrors.length} 个源失败：{sourceErrors.map(s => s.site).join("、")}
            </div>
          )}
          {exactMatch && (
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">完全匹配</span>
                <span className="text-xs text-gray-500">{loading ? "继续搜索其他源中..." : "已完成"}</span>
              </div>
              <BookCard {...exactMatch} />
            </div>
          )}
          {loading && sorted.length === 0 && !exactMatch ? (
            <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-2 border-[#2563eb] border-t-transparent" /></div>
          ) : sorted.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 mb-2">
                {exactMatch ? "其他相关结果" : `找到 ${sorted.length} 个结果`}{loading ? "，搜索中..." : ""}
              </p>
              {sorted.map((item, i) => <BookCard key={`${item.site}|${item.bookId}|${i}`} {...item} />)}
            </div>
          ) : !loading && !exactMatch ? (
            <div className="text-center py-16 text-gray-500">没有找到相关小说</div>
          ) : null}
        </>
      ) : (
        <>
          {/* Tag chips */}
          <div className="-mx-4 px-4 mb-4 overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
            <div className="flex gap-2 whitespace-nowrap pb-1">
              <button
                onClick={() => setActiveTag("")}
                className="px-3 py-1.5 rounded-full text-xs font-medium min-h-[32px] transition-colors"
                style={{
                  background: activeTag === "" ? "var(--primary)" : "var(--bg2)",
                  color: activeTag === "" ? "#fff" : "var(--t)",
                  border: `1px solid ${activeTag === "" ? "var(--primary)" : "var(--b)"}`,
                }}
              >
                🔥 热门
              </button>
              {TAGS.map(t => (
                <button
                  key={t.slug}
                  onClick={() => {
                    if (activeTag === t.slug) setShuffleSeed(s => s + 1);
                    else setActiveTag(t.slug);
                  }}
                  className="px-3 py-1.5 rounded-full text-xs font-medium min-h-[32px] transition-colors"
                  style={{
                    background: activeTag === t.slug ? "var(--primary)" : "var(--bg2)",
                    color: activeTag === t.slug ? "#fff" : "var(--t)",
                    border: `1px solid ${activeTag === t.slug ? "var(--primary)" : "var(--b)"}`,
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <h1 className="text-lg font-bold mb-4">
            {activeTag ? `${TAGS.find(t => t.slug === activeTag)?.label || ""} · 推荐` : "🔥 热门榜单"}
          </h1>
          {homeLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {[1,2,3,4,5,6,7,8,9,10].map(i => <div key={i} className="skeleton h-48 rounded-xl" />)}
            </div>
          ) : displayBooks.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {displayBooks.map((b, i) => (
                <Link key={`${b.site}|${b.bookId}|${i}`} to={`/book/${b.site}/${b.bookId}`}
                  className="card p-3 active:scale-[0.98] transition-transform">
                  <div className="aspect-[3/4] rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700 mb-2">
                    {b.coverUrl ? <img src={b.coverUrl} alt={b.title} className="w-full h-full object-cover" loading="lazy" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      : <div className="w-full h-full flex items-center justify-center text-3xl text-gray-400">📖</div>}
                  </div>
                  <h3 className="text-xs font-medium line-clamp-2 leading-snug">{b.title}</h3>
                  <span className="text-[10px] text-gray-400 mt-0.5">{b.site}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-16 text-gray-500"><div className="text-4xl mb-4">📚</div><p>{activeTag ? "该分类暂无内容，已回退热门榜单" : "首页加载失败，请使用搜索功能"}</p></div>
          )}
        </>
      )}
    </div>
  );
}
