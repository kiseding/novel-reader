import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import * as api from "../lib/api";
import * as cache from "../lib/cache";

export default function DownloadsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [books, setBooks] = useState<Array<{ site: string; bookId: string; title: string; author: string; coverUrl: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { if (!user) { navigate("/login"); return; } load(); }, [user]);

  const load = async () => {
    try {
      setError("");
      const shelf = await api.getBookshelf();
      const results: typeof books = [];
      for (const item of shelf.items) {
        try {
          const hasAny = (await window.caches.keys()).some((k: string) => k.includes(`/cache/${item.site}/${item.book_id}/`));
          if (hasAny) results.push({ site: item.site, bookId: item.book_id, title: item.title, author: item.author, coverUrl: item.cover_url });
        } catch {}
      }
      setBooks(results);
    } catch (e: any) { setError(e.message || "加载失败"); } finally { setLoading(false); }
  };

  const removeCache = async (e: React.MouseEvent, site: string, bookId: string) => {
    e.preventDefault(); e.stopPropagation();
    const keys = await window.caches.keys();
    const prefix = cache.chapterCacheKey(site, bookId, "");
    for (const key of keys) { if (key.startsWith(prefix)) await window.caches.delete(key); }
    setBooks(prev => prev.filter(b => !(b.site === site && b.bookId === bookId)));
  };

  if (loading) return <div className="max-w-2xl mx-auto px-4 pt-4 space-y-3">{[1,2].map(i => <div key={i} className="flex gap-3 p-3"><div className="skeleton w-20 h-[106px] rounded-lg shrink-0" /><div className="flex-1 space-y-2"><div className="skeleton h-5 w-3/4" /><div className="skeleton h-4 w-1/3" /></div></div>)}</div>;

  if (error) return (
    <div className="max-w-2xl mx-auto px-4 pt-16 text-center">
      <div className="text-4xl mb-4">📡</div>
      <p className="text-red-500 mb-2">{error}</p>
      <button className="btn-primary mt-2" onClick={() => { setLoading(true); load(); }}>重试</button>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4 pb-8">
      <h1 className="text-lg font-bold mb-4">已下载</h1>
      {books.length === 0 ? (
        <div className="mt-16 text-center"><div className="text-4xl mb-4">📥</div><p className="text-gray-500">暂无已下载内容</p></div>
      ) : (
        <div className="space-y-2">
          {books.map(book => (
            <Link key={`${book.site}|${book.bookId}`} to={`/book/${book.site}/${book.bookId}`} className="card flex gap-3 p-3 active:scale-[0.98] transition-transform">
              <div className="w-20 h-[106px] shrink-0 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700">
                {book.coverUrl ? <img src={book.coverUrl} alt={book.title} className="w-full h-full object-cover" loading="lazy" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  : <div className="w-full h-full flex items-center justify-center text-2xl">📖</div>}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-sm line-clamp-1">{book.title}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{book.author}</p>
                <p className="text-xs text-gray-400 mt-1">已离线缓存</p>
              </div>
              <button onClick={e => removeCache(e, book.site, book.bookId)} className="shrink-0 self-center text-red-400 hover:text-red-600 text-xs min-w-[44px] min-h-[44px] pointer-events-auto z-10">删除</button>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
