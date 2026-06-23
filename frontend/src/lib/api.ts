// API client — direct Worker URL in production
const API_BASE = import.meta.env.VITE_API_URL || "/api";

function getToken(): string | null { return localStorage.getItem("token"); }

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(options.headers as Record<string, string>) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let res: Response;
  try { res = await fetch(`${API_BASE}${path}`, { ...options, headers }); }
  catch (e: any) { throw new Error(`网络请求失败: ${e.message}`); }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(text.slice(0, 200) || `服务器返回非JSON响应 (HTTP ${res.status})`);
  }
  let data: any;
  try { data = await res.json(); } catch { throw new Error(`JSON解析失败 (HTTP ${res.status})`); }
  if (!res.ok) throw new Error(data.error || `请求失败 (HTTP ${res.status})`);
  return data as T;
}

export async function streamSearch(keyword: string, sites: string[], onResult: (site: string, items: any[]) => void, onDone: () => void, onError: (e: string) => void, onSourceError?: (site: string, error: string) => void, signal?: AbortSignal) {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  try {
    const res = await fetch(`${API_BASE}/search/stream`, { method: "POST", headers, body: JSON.stringify({ keyword, sites }), signal });
    if (!res.ok) { const d = await res.json().catch(() => ({})); onError(d.error || "搜索失败"); return; }
    const reader = res.body?.getReader();
    if (!reader) { onError("无法读取流"); return; }
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.done) { onDone(); return; }
          if (parsed.error) { onSourceError?.(parsed.site, parsed.error); continue; }
          if (parsed.results) onResult(parsed.site, parsed.results);
        } catch {}
      }
    }
    onDone();
  } catch (e: any) { onError(e.message); }
}

// ===== Types =====
export interface User { id: number; username: string; isAdmin?: boolean; }
export interface SourceMeta { key: string; displayName: string; tags: string[]; searchable: boolean; }
export interface SearchItem { key?: string; site: string; bookId: string; title: string; author: string; description: string; coverUrl: string; url: string; latestChapter?: string; }
export interface ChapterItem { id: string; title: string; url: string; order: number; }
export interface BookDetail { site: string; bookId: string; title: string; author: string; description: string; coverUrl: string; sourceUrl: string; chapters: ChapterItem[]; chapterPage?: { page: number; pageSize: number; total: number; hasPrev: boolean; hasNext: boolean; }; }
export interface ChapterContent { id: string; title: string; content: string; }
export interface BookshelfItem { id: number; site: string; book_id: string; title: string; author: string; cover_url: string; description: string; source_url: string; chapter_index: number; chapter_id: string; chapter_title: string; updated_at: string; }

// ===== API =====
export async function login(username: string, password: string) { return request<{ token: string; user: User }>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }); }
export async function getMe() { return request<{ user: User }>("/auth/me", { signal: AbortSignal.timeout(5000) }); }
export async function changePassword(oldPassword: string, newPassword: string) { return request<{ ok: boolean }>("/auth/change-password", { method: "PUT", body: JSON.stringify({ oldPassword, newPassword }) }); }
export async function listUsers() { return request<{ users: Array<{ id: number; username: string; created_at: string }> }>("/admin/users"); }
export async function adminCreateUser(username: string, password: string) { return request<{ user: { id: number; username: string } }>("/admin/users", { method: "POST", body: JSON.stringify({ username, password }) }); }
export async function adminDeleteUser(id: number) { return request<{ ok: boolean }>(`/admin/users/${id}`, { method: "DELETE" }); }
export async function adminResetPassword(id: number, password: string) { return request<{ ok: boolean }>(`/admin/users/${id}/reset-password`, { method: "PUT", body: JSON.stringify({ password }) }); }
export async function getSources() { return request<{ sources: SourceMeta[] }>("/sources"); }
export async function getHomepage(tag?: string, page = 1) { return request<{ books: SearchItem[]; tag?: string; page?: number; totalPages?: number }>(`/homepage?page=${page}${tag ? `&tag=${encodeURIComponent(tag)}` : ""}`); }
export async function search(keyword: string, sites?: string[]) { return request<{ results?: SearchItem[]; urlSearch?: boolean; item?: SearchItem }>("/search", { method: "POST", body: JSON.stringify({ keyword, sites }) }); }
export async function getBookDetail(site: string, bookId: string, page = 1, pageSize = 100) { return request<BookDetail>(`/books/${site}/${bookId}?page=${page}&page_size=${pageSize}`); }
export async function getChapterContent(site: string, bookId: string, chapterId: string, title: string, url: string) { return request<ChapterContent>(`/books/${site}/${bookId}/${chapterId}?${new URLSearchParams({ title, url })}`); }
export async function getBookshelf() { return request<{ items: BookshelfItem[] }>("/bookshelf"); }
export async function addToBookshelf(book: { site: string; bookId: string; title: string; author: string; coverUrl: string; description: string; sourceUrl: string }) { return request<{ item: BookshelfItem }>("/bookshelf", { method: "POST", body: JSON.stringify(book) }); }
export async function removeFromBookshelf(site: string, bookId: string) { return request<{ ok: boolean }>(`/bookshelf/${site}/${bookId}`, { method: "DELETE" }); }
export async function updateReadingProgress(site: string, bookId: string, chapterIndex: number, chapterId: string, chapterTitle: string) {
  return request<{ ok: boolean }>(`/bookshelf/${site}/${bookId}/progress`, { method: "PUT", body: JSON.stringify({ chapterIndex, chapterId, chapterTitle }) });
}
export async function getHistory() { return request<{ items: any[] }>("/history"); }
export async function addHistory(book: { site: string; bookId: string; title: string; author: string; coverUrl: string; chapterId: string; chapterTitle: string }) { return request<{ ok: boolean }>("/history", { method: "POST", body: JSON.stringify(book) }); }
export async function clearHistory() { return request<{ ok: boolean }>("/history", { method: "DELETE" }); }
