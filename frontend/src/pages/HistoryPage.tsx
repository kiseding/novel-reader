import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as api from "../lib/api";
import { useAuth } from "../hooks/useAuth";

export default function HistoryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => { if (!user) { navigate("/login"); return; } load(); }, [user]);

  const load = async () => { try { setError(""); setItems((await api.getHistory()).items); } catch (e: any) { setError(e.message || "加载失败"); } finally { setLoading(false); } };

  if (loading) return <div className="max-w-2xl mx-auto px-4 pt-4 space-y-3">{[1,2,3].map(i => <div key={i} className="flex gap-3 p-3"><div className="skeleton w-20 h-[106px] rounded-lg shrink-0" /><div className="flex-1 space-y-2"><div className="skeleton h-5 w-3/4" /><div className="skeleton h-4 w-1/3" /></div></div>)}</div>;

  if (error) return (
    <div className="max-w-2xl mx-auto px-4 pt-16 text-center">
      <div className="text-4xl mb-4">📡</div>
      <p className="text-red-500 mb-2">{error}</p>
      <button className="btn-primary mt-2" onClick={() => { setLoading(true); load(); }}>重试</button>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4 pb-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold">阅读历史</h1>
        {items.length > 0 && <button onClick={async () => { try { await api.clearHistory(); setItems([]); } catch (e: any) { setMsg(e.message || "清空失败"); setTimeout(() => setMsg(""), 3000); } }} className="btn-ghost text-xs text-red-400 min-h-[44px]">清空历史</button>}
      </div>
      {msg && <div className="mb-3 p-2.5 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">{msg}</div>}
      {items.length === 0 ? (
        <div className="mt-16 text-center"><div className="text-4xl mb-4">🕐</div><p className="text-gray-500">暂无阅读记录</p></div>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <Link key={item.id} to={`/book/${item.site}/${item.book_id}`} className="card flex gap-3 p-3 active:scale-[0.98] transition-transform">
              <div className="w-20 h-[106px] shrink-0 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700">
                {item.cover_url ? <img src={item.cover_url} alt={item.title} className="w-full h-full object-cover" loading="lazy" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  : <div className="w-full h-full flex items-center justify-center text-2xl">📖</div>}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-sm line-clamp-1">{item.title}</h3>
                {item.author && <p className="text-xs text-gray-500 mt-0.5">{item.author}</p>}
                {item.chapter_title && <p className="text-xs text-accent mt-1 line-clamp-1">读到: {item.chapter_title}</p>}
                <p className="text-[10px] text-gray-400 mt-1">{new Date(item.last_read_at || item.created_at).toLocaleDateString("zh-CN")}</p>
              </div>
              <button onClick={async (e) => { e.preventDefault(); e.stopPropagation(); try { await api.removeFromBookshelf(item.site, item.book_id); setItems(p => p.filter(i => i.id !== item.id)); } catch (e: any) { setMsg(e.message || "删除失败"); setTimeout(() => setMsg(""), 3000); } }} className="shrink-0 self-center text-red-400 hover:text-red-600 text-xs min-w-[44px] min-h-[44px] pointer-events-auto z-10">删除</button>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
