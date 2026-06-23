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

// Ranking types  (maps to ixdzs8.com URL paths)
const RANKS: Array<{ label: string; key: string }> = [
  { label: "🔥 热门", key: "hot" },
  { label: "📈 日榜", key: "day" },
  { label: "📊 月榜", key: "month" },
  { label: "✅ 完结", key: "end" },
  { label: "🆕 最新", key: "new" },
];

// Category IDs matching ixdzs8.com /sort/{id}/ paths
const TAGS: Array<{ label: string; slug: string }> = [
  { label: "玄幻奇幻", slug: "1" },
  { label: "修真仙侠", slug: "2" },
  { label: "都市青春", slug: "3" },
  { label: "军事历史", slug: "4" },
  { label: "网游竞技", slug: "5" },
  { label: "科幻灵异", slug: "6" },
  { label: "言情穿越", slug: "7" },
  { label: "耽美同人", slug: "8" },
  { label: "台言古言", slug: "9" },
  { label: "传统武侠", slug: "10" },
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
  const [activeTab, setActiveTab] = useState<string>("hot"); // "hot" | "day" | "month" | "end" | "new" | "1".."10"
  const [shuffleSeed, setShuffleSeed] = useState<number>(() => 0xC0FFEE);

  useEffect(() => {
    if (keyword) return;
    setHomeLoading(true);
    // Fetch homepage: pass tag/rank as `type` parameter
    api.getHomepage(activeTab)
      .then(res => { setBooks(res.books); setShuffleSeed(s => s + 1); })
      .catch(() => setBooks([]))
      .finally(() => setHomeLoading(false));
  }, [keyword, activeTab]);

  const displayBooks = useMemo(() => {
    // For category tags, randomize order so repeated taps surface different books.
    const isCategory = TAGS.some(t => t.slug === activeTab);
    if (isCategory) return shuffle(books, shuffleSeed);
    return books;
  }, [books, activeTab, shuffleSeed]);

  const exactKey = exactMatch ? `${exactMatch.site}|${exactMatch.bookId}` : null;
  const otherResults = exactKey
    ? results.filter(r => `${r.site}|${r.bookId}` !== exactKey)
    : results;
  const sorted = [...otherResults].sort((a, b) => scoreResult(b, keyword) - scoreResult(a, keyword));
  const showSearch = !!keyword;

  // Determine the label of the active tab for the heading
  const activeLabel = RANKS.find(r => r.key === activeTab)?.label
    || TAGS.find(t => t.slug === activeTab)?.label
    || "";

  // Active tab tracking for button styles
  const isRank = RANKS.some(r => r.key === activeTab);
  const isCategory = TAGS.some(t => t.slug === activeTab);

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
          {/* Ranking tabs row */}
          <div className="-mx-4 px-4 mb-3 overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
            <div className="flex gap-2 whitespace-nowrap pb-1">
              {RANKS.map(r => (
                <button
                  key={r.key}
                  onClick={() => setActiveTab(r.key)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium min-h-[32px] transition-colors"
                  style={{
                    background: activeTab === r.key ? "var(--primary)" : "var(--bg2)",
                    color: activeTab === r.key ? "#fff" : "var(--t)",
                    border: `1px solid ${activeTab === r.key ? "var(--primary)" : "var(--b)"}`,
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Category chips */}
          <div className="-mx-4 px-4 mb-4 overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
            <div className="flex gap-2 whitespace-nowrap pb-1">
              {TAGS.map(t => (
                <button
                  key={t.slug}
                  onClick={() => {
                    if (activeTab === t.slug) setShuffleSeed(s => s + 1);
                    else setActiveTab(t.slug);
                  }}
                  className="px-3 py-1.5 rounded-full text-xs font-medium min-h-[32px] transition-colors"
                  style={{
                    background: activeTab === t.slug ? "var(--primary)" : "var(--bg2)",
                    color: activeTab === t.slug ? "#fff" : "var(--t)",
                    border: `1px solid ${activeTab === t.slug ? "var(--primary)" : "var(--b)"}`,
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Section heading */}
          <h1 className="text-lg font-bold mb-4">{activeLabel}</h1>

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
                  <span className="text-[10px] text-gray-400 mt-0.5">{b.author !== "未知" ? b.author : b.site}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-16 text-gray-500"><div className="text-4xl mb-4">📚</div><p>暂无内容</p></div>
          )}
        </>
      )}
    </div>
  );
}
