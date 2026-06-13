// Browser-side chapter cache using Cache API
const CACHE_NAME = "novel-chapters-v1";

async function openCache(): Promise<Cache> {
  return caches.open(CACHE_NAME);
}

export async function getCachedChapter(key: string): Promise<string | null> {
  try {
    const cache = await openCache();
    const resp = await cache.match(key);
    if (!resp) return null;
    return resp.text();
  } catch { return null; }
}

export async function setCachedChapter(key: string, content: string): Promise<void> {
  try {
    const cache = await openCache();
    const resp = new Response(content, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
    await cache.put(key, resp);
  } catch {}
}

export async function removeCachedChapter(key: string): Promise<void> {
  try {
    const cache = await openCache();
    await cache.delete(key);
  } catch {}
}

export function chapterCacheKey(site: string, bookId: string, chapterId: string): string {
  return `/cache/${site}/${bookId}/${chapterId}`;
}
