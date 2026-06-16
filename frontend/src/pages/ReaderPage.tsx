// Mobile-first reader with swipe gestures, paged/scroll modes
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useSearchParams, Link, useNavigate } from "react-router-dom";
import Modal from "../components/Modal";
import * as api from "../lib/api";
import type { ChapterContent, BookDetail } from "../lib/api";
import * as cache from "../lib/cache";

export default function ReaderPage() {
  const { site, bookId, chapterId } = useParams<{ site: string; bookId: string; chapterId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const chapterTitle = searchParams.get("title") || "";
  const chapterUrl = searchParams.get("url") || "";

  const [content, setContent] = useState<ChapterContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem("rf") || 18));
  const [paged, setPaged] = useState(() => localStorage.getItem("rp") === "1");
  const [showToc, setShowToc] = useState(false);
  const tocRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showHeader, setShowHeader] = useState(true);
  const lastScrollTop = useRef(0);
  const [chapters, setChapters] = useState<{ id: string; title: string }[]>([]);
  const [bookMeta, setBookMeta] = useState<{ title: string; author: string; coverUrl: string } | null>(null);
  const [chIdx, setChIdx] = useState(-1);
  const [page, setPage] = useState(0);
  const [winH, setWinH] = useState(() => window.innerHeight);
  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const touchedRef = useRef(false); // suppress click after touch swipe

  // Window resize
  useEffect(() => {
    const h = () => setWinH(window.innerHeight);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  // Persist settings
  useEffect(() => { localStorage.setItem("rf", String(fontSize)); }, [fontSize]);
  useEffect(() => { localStorage.setItem("rp", paged ? "1" : "0"); }, [paged]);

  // Fetch chapter
  useEffect(() => {
    if (!site || !bookId || !chapterId) return;
    let stale = false;
    setLoading(true); setError(""); setPage(0);
    const ck = cache.chapterCacheKey(site, bookId, chapterId);
    cache.getCachedChapter(ck).then(c => {
      if (stale) return;
      if (c) { setContent({ id: chapterId, title: chapterTitle, content: c }); setLoading(false); return; }
      api.getChapterContent(site, bookId, chapterId, chapterTitle, chapterUrl)
        .then(r => { if (!stale) { setContent(r); cache.setCachedChapter(ck, r.content); } })
        .catch(e => { if (!stale) setError(e.message); }).finally(() => { if (!stale) setLoading(false); });
    });
    window.scrollTo(0, 0);
    return () => { stale = true; };
  }, [site, bookId, chapterId]);

  // Chapter list + book meta
  useEffect(() => {
    if (!site || !bookId) return;
    api.getBookDetail(site, bookId).then((b: BookDetail) => {
      const raw = b.chapters.map(ch => ({ id: ch.id, title: ch.title }));
      // Sort by chapter number for reliable reading order
      raw.sort((a, b) => {
        const na = parseInt(a.id.match(/\d+/)?.[0] || "0");
        const nb = parseInt(b.id.match(/\d+/)?.[0] || "0");
        return na - nb;
      });
      setChapters(raw);
      setBookMeta({ title: b.title, author: b.author || "", coverUrl: b.coverUrl || "" });
    }).catch(() => {});
  }, [site, bookId]);

  // Record reading history with real book metadata (book name as title, not chapter name)
  useEffect(() => {
    if (!site || !bookId || !chapterId || !bookMeta) return;
    api.addHistory({
      site, bookId,
      title: bookMeta.title,
      author: bookMeta.author,
      coverUrl: bookMeta.coverUrl,
      chapterId,
      chapterTitle,
    }).catch(() => {});
  }, [site, bookId, chapterId, chapterTitle, bookMeta]);

  useEffect(() => {
    if (chapters.length) setChIdx(chapters.findIndex(ch => ch.id === chapterId));
  }, [chapters, chapterId]);

  // Sync reading progress to bookshelf (no-op if book not on shelf)
  useEffect(() => {
    if (!site || !bookId || !chapterId || chIdx < 0) return;
    api.updateReadingProgress(site, bookId, chIdx, chapterId, chapterTitle).catch(() => {});
  }, [site, bookId, chapterId, chIdx, chapterTitle]);

  // Preload next chapters
  useEffect(() => {
    if (!site || !bookId || chIdx < 0) return;
    for (let i = 1; i <= 3; i++) {
      const idx = chIdx + i;
      if (idx >= chapters.length) break;
      const ck = cache.chapterCacheKey(site, bookId, chapters[idx].id);
      cache.getCachedChapter(ck).then(c => { if (!c) api.getChapterContent(site, bookId, chapters[idx].id, "", "").then(r => cache.setCachedChapter(ck, r.content)).catch(() => {}); });
    }
  }, [chIdx]);

  const goChapter = useCallback((id: string) => {
    const ch = chapters.find(c => c.id === id);
    if (!ch) return;
    navigate(`/read/${site}/${bookId}/${id}?title=${encodeURIComponent(ch.title)}&url=`);
    setPage(0);
  }, [site, bookId, chapters, navigate]);

  // Keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (showToc) return;
      if (e.key === "ArrowLeft" && hasPrevCh) goChapter(chapters[chIdx - 1].id);
      if (e.key === "ArrowRight" && hasNextCh) goChapter(chapters[chIdx + 1].id);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [showToc, chIdx, chapters, goChapter]);

  const paragraphs = useMemo(() => content?.content.split("\n").filter(Boolean) || [], [content]);

  const computedPages = useMemo<string[][]>(() => {
    if (!paged || winH < 300 || !paragraphs.length) {
      return [paragraphs];
    }
    const lineHeight = fontSize * 1.8;
    const contentH = winH - 180;
    const linesPerPage = Math.max(1, Math.floor(contentH / lineHeight));
    const pages: string[][] = [];
    for (let i = 0; i < paragraphs.length; i += linesPerPage) {
      pages.push(paragraphs.slice(i, i + linesPerPage));
    }
    return pages.length > 0 ? pages : [paragraphs];
  }, [paragraphs, fontSize, winH, paged]);

  const totalPages = computedPages.length;
  const hasPrevCh = chIdx > 0;
  const hasNextCh = chIdx >= 0 && chIdx < chapters.length - 1;

  // Scroll to current chapter when TOC opens
  useEffect(() => {
    if (showToc) requestAnimationFrame(() => tocRef.current?.scrollIntoView({ block: "center" }));
  }, [showToc]);

  // Scroll listener for header hide/show
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const st = el.scrollTop;
      if (st <= 0) { setShowHeader(true); lastScrollTop.current = st; return; }
      if (st > lastScrollTop.current + 8) setShowHeader(false);
      else if (st < lastScrollTop.current - 8) setShowHeader(true);
      lastScrollTop.current = st;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [loading]);

  const nextPage = () => {
    if (paged && page < totalPages - 1) { setPage(p => p + 1); return; }
    if (hasNextCh) goChapter(chapters[chIdx + 1].id);
  };
  const prevPage = () => {
    if (paged && page > 0) { setPage(p => p - 1); return; }
    if (hasPrevCh) goChapter(chapters[chIdx - 1].id);
  };

  // Swipe detection
  const onTouchStart = (e: React.TouchEvent) => {
    if (!paged) return;
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!paged || !touchStart.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    const dt = Date.now() - touchStart.current.t;
    touchStart.current = null;
    if (dt < 500 && Math.abs(dx) > 50 && Math.abs(dy) < Math.abs(dx) * 1.5) {
      touchedRef.current = true;
      setTimeout(() => { touchedRef.current = false; }, 300);
      if (dx < -60) nextPage();
      else if (dx > 60) prevPage();
    }
  };

  const onTap = (e: React.MouseEvent) => {
    if (touchedRef.current) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width;
    if (paged && x < w * 0.25) prevPage();
    else if (paged && x > w * 0.75) nextPage();
  };

  // Loading / Error states
  if (loading) return <div className={`fixed inset-0 bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-200 flex items-center justify-center`}><div className="animate-spin rounded-full h-8 w-8 border-2 border-[#2563eb] border-t-transparent" /></div>;
  if (error) return <div className={`fixed inset-0 bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-200 flex items-center justify-center`}><div className="text-center"><p className="text-red-500 mb-4">{error}</p><button onClick={() => navigate(-1)} className="btn-ghost">返回</button></div></div>;
  if (!content) return null;

  return (
    <div className={`fixed inset-0 bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-200 flex flex-col`}
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      {/* Title bar — collapses to 0 height when hidden so reading area fills the screen */}
      <div className={`z-40 bg-white/90 dark:bg-gray-900/90 backdrop-blur flex items-center justify-between px-4 border-b border-gray-200 dark:border-gray-700 transition-all duration-300 overflow-hidden ${showHeader ? "max-h-14 py-1.5 opacity-100" : "max-h-0 py-0 opacity-0"}`}>
        <Link to={`/book/${site}/${bookId}`} className="text-sm text-[#2563eb] hover:underline whitespace-nowrap">← 返回</Link>
        <span className="text-sm font-medium line-clamp-1 text-center mx-2 flex-1 min-w-0">{content?.title || chapterTitle}</span>
        <button onClick={() => setShowToc(true)} className="text-sm text-[#2563eb] hover:underline whitespace-nowrap">{chapters.length ? chIdx + 1 : "?"}/{chapters.length || "?"} 目录</button>
      </div>

      {/* Reading area */}
      <div ref={scrollRef} className={`flex-1 ${paged ? "overflow-hidden" : "overflow-y-auto"} overscroll-contain ${paged ? "" : "touch-pan-y"}`} style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}
        onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onClick={onTap}>
        {paged ? (
          <div className="h-full flex flex-col px-4" style={{ paddingTop: 24, paddingBottom: 24 }}>
            <div className="flex-1 overflow-hidden">
              <div className="max-w-[800px] mx-auto">
                {content.title && page === 0 && <h1 className="text-center font-bold mb-6" style={{ fontSize: fontSize + 6 }}>{content.title}</h1>}
                <div style={{ fontSize, lineHeight: 1.8 }}>
                  {(computedPages[page] || []).map((line, i) => <p key={i} className="indent-8" style={{ fontSize, marginBottom: fontSize * 0.5 }}>{line}</p>)}
                </div>
              </div>
            </div>
            {chapters.length > 0 && page === totalPages - 1 && (
              <div className="flex justify-between mt-2 shrink-0">
                <button className="btn-ghost text-sm min-h-[44px]" disabled={!hasPrevCh} onClick={() => { if (chapters[chIdx - 1]) goChapter(chapters[chIdx - 1].id); }}>← 上一章</button>
                <span className="text-sm text-gray-400 self-center">{chapters.length ? chIdx + 1 : "?"}/{chapters.length || "?"}</span>
                <button className="btn-ghost text-sm min-h-[44px]" disabled={!hasNextCh} onClick={() => { if (chapters[chIdx + 1]) goChapter(chapters[chIdx + 1].id); }}>下一章 →</button>
              </div>
            )}
          </div>
        ) : (
          /* SCROLL MODE — scrollRef handles all scrolling, no nested scroll container */
          <div className="px-4 pb-4">
            <div className="max-w-[800px] mx-auto py-8">
              {content.title && <h1 className="text-center font-bold mb-8" style={{ fontSize: fontSize + 6 }}>{content.title}</h1>}
              <div style={{ fontSize, lineHeight: 1.8 }}>
                {paragraphs.map((p, i) => <p key={i} className="indent-8" style={{ fontSize, marginBottom: fontSize * 0.6 }}>{p}</p>)}
              </div>
              {chapters.length > 0 && <div className="flex justify-between mt-12 mb-8">
                <button className="btn-ghost text-sm min-h-[44px]" disabled={!hasPrevCh} onClick={() => { if (chapters[chIdx - 1]) goChapter(chapters[chIdx - 1].id); }}>← 上一章</button>
                <span className="text-sm text-gray-400 self-center">{chapters.length ? chIdx + 1 : "?"}/{chapters.length || "?"}</span>
                <button className="btn-ghost text-sm min-h-[44px]" disabled={!hasNextCh} onClick={() => { if (chapters[chIdx + 1]) goChapter(chapters[chIdx + 1].id); }}>下一章 →</button>
              </div>}
            </div>
          </div>
        )}
      </div>

      {/* TOC Modal */}
      <Modal open={showToc} onClose={() => setShowToc(false)} title="目录">
        <div className="space-y-4">
          <div className="flex justify-center gap-2 pb-2 border-b border-gray-200 dark:border-gray-700">
            <button onClick={() => setPaged(false)} className={`px-4 py-1.5 rounded-full text-sm ${!paged ? "bg-[#2563eb] text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-500"}`}>滚动</button>
            <button onClick={() => setPaged(true)} className={`px-4 py-1.5 rounded-full text-sm ${paged ? "bg-[#2563eb] text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-500"}`}>翻页</button>
          </div>
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => setFontSize(s => Math.max(14, s - 2))} className="text-gray-400 px-3 text-sm">A-</button>
            <input type="range" min={14} max={28} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="flex-1 max-w-[200px] accent-[#2563eb]" />
            <button onClick={() => setFontSize(s => Math.min(28, s + 2))} className="text-gray-400 px-3 text-sm">A+</button>
          </div>
          <div className="max-h-96 overflow-y-auto space-y-1">
            {chapters.map((ch, i) => (
              <button
                key={ch.id}
                ref={i === chIdx ? tocRef : undefined}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${i === chIdx ? "bg-[#2563eb]/10 text-[#2563eb] font-medium border-l-2 border-[#2563eb]" : "hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"}`}
                onClick={() => { goChapter(ch.id); setShowToc(false); }}
              >
                <span className="text-xs text-gray-400 mr-2">{i + 1}/{chapters.length}</span>
                {ch.title}
              </button>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
