import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import * as api from "../lib/api";
import type { BookDetail, BookshelfItem } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import * as cache from "../lib/cache";

export default function BookDetailPage() {
  const { site, bookId } = useParams<{ site: string; bookId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [book, setBook] = useState<BookDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chapterPage, setChapterPage] = useState(1);
  const [inBookshelf, setInBookshelf] = useState(false);
  const [progress, setProgress] = useState<{ chapterId: string; chapterTitle: string } | null>(null);
  const [isCached, setIsCached] = useState(false);
  const [shelfLoading, setShelfLoading] = useState(false);
  const [coverError, setCoverError] = useState(false);
  const [dlLoading, setDlLoading] = useState(false);
  const [dlProgress, setDlProgress] = useState<{ done: number; total: number } | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!site || !bookId) return;
    setLoading(true);
    api.getBookDetail(site, bookId, chapterPage).then(setBook).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [site, bookId, chapterPage]);

  // Check bookshelf + cache status
  useEffect(() => {
    if (!user || !site || !bookId) return;
    api.getBookshelf().then(res => {
      const found = res.items.find((i: BookshelfItem) => i.site === site && i.book_id === bookId);
      setInBookshelf(!!found);
      setProgress(found && found.chapter_id ? { chapterId: found.chapter_id, chapterTitle: found.chapter_title } : null);
    }).catch(() => {});
    window.caches.keys().then(keys => { setIsCached(keys.some(k => k.includes(`/cache/${site}/${bookId}/`))); }).catch(() => {});
  }, [user, site, bookId]);

  const toggleBookshelf = async () => {
    if (!user) { navigate("/login"); return; }
    if (!book) return;
    setShelfLoading(true);
    try {
      if (inBookshelf) { await api.removeFromBookshelf(site!, bookId!); setInBookshelf(false); setMsg("已移出书架"); }
      else { await api.addToBookshelf({ site: site!, bookId: bookId!, title: book.title, author: book.author, coverUrl: book.coverUrl, description: book.description, sourceUrl: book.sourceUrl }); setInBookshelf(true); setMsg("已加入书架"); }
      setTimeout(() => setMsg(""), 2000);
    } catch (e: any) { setError(e.message); }
    finally { setShelfLoading(false); }
  };

  const handleDownload = async () => {
    if (!book || !site || !bookId) return;
    setDlLoading(true); setMsg("");
    const total = book.chapters.length;
    setDlProgress({ done: 0, total });
    let cached = 0, failed = 0, done = 0;
    const CONCURRENCY = 5;
    let cursor = 0;
    const worker = async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= book.chapters.length) return;
        const ch = book.chapters[idx];
        try {
          const ck = cache.chapterCacheKey(site, bookId, ch.id);
          const existing = await cache.getCachedChapter(ck);
          if (!existing) {
            const c = await api.getChapterContent(site, bookId, ch.id, ch.title, ch.url);
            await cache.setCachedChapter(ck, c.content);
            cached++;
          }
        } catch { failed++; }
        finally { done++; setDlProgress({ done, total }); }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()));
      setIsCached(true);
      setMsg(failed > 0 ? `已缓存 ${cached} 章，${failed} 章失败` : `已缓存 ${cached} 章`);
      setTimeout(() => setMsg(""), 2500);
    } catch (e: any) { setError(e.message); }
    finally { setDlLoading(false); setDlProgress(null); }
  };

  if (loading) return <div className="max-w-3xl mx-auto px-4 pt-8"><div className="flex gap-4"><div className="skeleton w-28 h-[150px] shrink-0" /><div className="flex-1 space-y-3"><div className="skeleton h-6 w-3/4" /><div className="skeleton h-4 w-1/3" /><div className="skeleton h-4 w-2/3" /></div></div></div>;
  if (error) return <div className="max-w-3xl mx-auto px-4 pt-16 text-center"><p className="text-red-500">{error}</p><button onClick={() => navigate(-1)} className="btn-ghost mt-4">返回</button></div>;
  if (!book) return null;

  return (
    <div className="max-w-3xl mx-auto px-4 pt-4 pb-8">
      <div className="flex gap-4 mb-6">
        <div className="w-28 h-[150px] shrink-0 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700">
          {book.coverUrl && !coverError ? <img src={book.coverUrl} alt={book.title} className="w-full h-full object-cover" onError={() => setCoverError(true)} /> : <div className="w-full h-full flex items-center justify-center text-3xl">📖</div>}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold line-clamp-2">{book.title}</h1>
          <p className="text-sm text-gray-500 mt-1">{book.author}</p>
          <p className="text-xs text-gray-400 mt-1">共 {book.chapterPage?.total || book.chapters.length} 章 · {book.site}</p>
          <div className="mt-3 flex gap-2 flex-wrap">
            {(() => {
              const target = progress
                ? { id: progress.chapterId, title: progress.chapterTitle, label: "继续阅读" }
                : (book.chapters[0]
                    ? { id: book.chapters[0].id, title: book.chapters[0].title, label: "开始阅读" }
                    : null);
              if (!target) return null;
              return (
                <button
                  className="btn text-xs px-4 min-h-[44px] text-white"
                  style={{ backgroundColor: "#2563eb" }}
                  onClick={() => navigate(`/read/${site}/${bookId}/${target.id}?title=${encodeURIComponent(target.title)}&url=`)}
                >
                  {target.label}
                </button>
              );
            })()}
            <button className={`btn text-xs px-4 min-h-[44px] ${inBookshelf ? "bg-gray-200 dark:bg-gray-700 text-gray-500" : "btn-primary"}`}
              onClick={toggleBookshelf} disabled={shelfLoading}>
              {shelfLoading ? "..." : inBookshelf ? "已加入" : "加入书架"}
            </button>
            <button className={`btn text-xs px-4 min-h-[44px] text-white ${isCached ? "bg-gray-400 dark:bg-gray-600" : ""}`}
              style={isCached ? {} : { backgroundColor: "#16a34a" }}
              onClick={handleDownload} disabled={dlLoading || isCached}>
              {dlLoading ? (dlProgress ? `${dlProgress.done}/${dlProgress.total}` : "缓存中...") : isCached ? "已缓存" : "缓存"}
            </button>
          </div>
          {msg && <span className="text-xs text-green-500 mt-1 block">{msg}</span>}
          {dlProgress && dlProgress.total > 0 && (
            <div className="mt-2 h-1 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
              <div className="h-full bg-[#16a34a] transition-all duration-200" style={{ width: `${(dlProgress.done / dlProgress.total) * 100}%` }} />
            </div>
          )}
        </div>
      </div>

      {book.description && <details className="mb-6" open><summary className="text-sm font-medium text-gray-500 cursor-pointer">简介</summary><p className="text-sm text-gray-600 dark:text-gray-400 mt-2 whitespace-pre-line">{book.description}</p></details>}

      <h2 className="text-sm font-medium mb-3">目录</h2>
      <div className="space-y-0.5">
        {book.chapters.map(ch => (
          <Link key={ch.id} to={`/read/${site}/${bookId}/${ch.id}?title=${encodeURIComponent(ch.title)}&url=${encodeURIComponent(ch.url || "")}`}
            className="flex items-center justify-between px-3 py-2.5 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-800 active:bg-gray-200 dark:active:bg-gray-700 transition-colors min-h-[44px]">
            <span className="line-clamp-1 flex-1">{ch.title}</span>
            <span className="text-[10px] text-gray-400 shrink-0 ml-2">{ch.order}</span>
          </Link>
        ))}
      </div>
      {book.chapterPage && book.chapterPage.total > book.chapterPage.pageSize && (
        <div className="flex justify-center gap-4 mt-4">
          <button className="btn-ghost text-xs" disabled={!book.chapterPage.hasPrev} onClick={() => setChapterPage(p => p - 1)}>上一页</button>
          <span className="text-xs text-gray-500 self-center">{book.chapterPage.page} / {Math.ceil(book.chapterPage.total / book.chapterPage.pageSize)}</span>
          <button className="btn-ghost text-xs" disabled={!book.chapterPage.hasNext} onClick={() => setChapterPage(p => p + 1)}>下一页</button>
        </div>
      )}
    </div>
  );
}
