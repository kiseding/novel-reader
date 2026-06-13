import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { SearchProvider } from "./hooks/useSearch";
import Navbar from "./components/Navbar";
import HomePage from "./pages/HomePage";
import BookDetailPage from "./pages/BookDetailPage";
import ReaderPage from "./pages/ReaderPage";
import BookshelfPage from "./pages/BookshelfPage";
import HistoryPage from "./pages/HistoryPage";
import DownloadsPage from "./pages/DownloadsPage";
import LoginPage from "./pages/LoginPage";
import { applyTheme, getTheme } from "./lib/theme";

// lx2cf-style theme: auto/dark/light — implemented in lib/theme.ts

function Spinner() {
  return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-8 w-8 border-2 border-[--primary] border-t-transparent" /></div>;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppInner() {
  const { loading } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner />;

  // Navbar = 56 (h-14). Home adds an independent search bar (~64) below it.
  const path = location.pathname;
  const navHidden = path === "/login" || path.startsWith("/read");
  const isHome = path === "/";
  const padTopPx = navHidden ? 0 : (isHome ? 120 : 56);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main
        className="flex-1"
        style={{
          paddingTop: `calc(${padTopPx}px + env(safe-area-inset-top))`,
          paddingBottom: `calc(env(safe-area-inset-bottom) + 16px)`,
        }}
      >
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<RequireAuth><HomePage /></RequireAuth>} />
          <Route path="/book/:site/:bookId" element={<RequireAuth><BookDetailPage /></RequireAuth>} />
          <Route path="/read/:site/:bookId/:chapterId" element={<RequireAuth><ReaderPage /></RequireAuth>} />
          <Route path="/bookshelf" element={<RequireAuth><BookshelfPage /></RequireAuth>} />
          <Route path="/history" element={<RequireAuth><HistoryPage /></RequireAuth>} />
          <Route path="/downloads" element={<RequireAuth><DownloadsPage /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  // lx2cf theme init: set light/dark classes for CSS variables + Tailwind darkMode
  applyTheme(getTheme());

  // Follow system color-scheme changes when in auto mode
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if (getTheme() === "auto") applyTheme("auto"); };
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);

  return (
    <AuthProvider>
      <SearchProvider>
        <AppInner />
      </SearchProvider>
    </AuthProvider>
  );
}
