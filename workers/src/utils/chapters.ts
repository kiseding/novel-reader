// Chapter normalization — dedup, sort, renumber
import type { ChapterItem } from "../types";

const CN_DIGITS: Record<string, number> = {
  '零':0, '一':1, '二':2, '三':3, '四':4, '五':5, '六':6, '七':7, '八':8, '九':9,
  '十':10, '百':100, '千':1000, '万':10000,
};

function parseChineseNum(s: string): number | null {
  let result = 0, current = 0;
  for (const ch of s) {
    const v = CN_DIGITS[ch];
    if (v === undefined) return null;
    if (v >= 10) { current = (current || 1) * v; result += current; current = 0; }
    else current = v;
  }
  result += current;
  return result || null;
}

function extractOrder(id: string, title: string): number {
  const text = title + ' ' + id;
  // Try Chinese chapter: 第一章, 第一百二十七章
  const cnM = text.match(/第\s*([一二三四五六七八九十百千万零]+)\s*章/);
  if (cnM) {
    const n = parseChineseNum(cnM[1]);
    if (n) return n;
  }
  // Arabic chapter: 第127章
  const arM = text.match(/第\s*(\d+)\s*章/);
  if (arM) return parseInt(arM[1]);
  // Regular chapter numbers
  const patterns = [
    /番外.*?(\d+)/, /^(\d+)[\.\、\s]/, /^(\d+)$/,
    /[\(（](\d+)[\)）]/, /Chapter\s*(\d+)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return parseInt(m[1]);
  }
  const nums = id.match(/\d+/g);
  if (nums) return parseInt(nums[nums.length - 1]);
  return 0;
}

export function normalizeChapters(chapters: ChapterItem[]): ChapterItem[] {
  if (!chapters.length) return chapters;

  // Dedup by ID
  const seen = new Set<string>();
  const deduped: ChapterItem[] = [];
  for (const ch of chapters) {
    const key = ch.id.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(ch);
  }

  // Categorize chapters for proper ordering
  function category(ch: ChapterItem): number {
    const t = ch.title + ch.id;
    if (/番外|外传|番外篇|bonus/i.test(t)) return 2;
    if (/第[一二三四五六七八九十百千万零\d]+\s*章|Chapter\s*\d/i.test(t)) return 0;
    if (/序章|楔子|前言|引子|prologue/i.test(t)) return -1;
    return 1;
  }

  // Detect multi-volume: same chapter number appears multiple times
  const orderCounts = new Map<number, number>();
  for (const ch of deduped) {
    const n = extractOrder(ch.id, ch.title);
    if (n > 0) orderCounts.set(n, (orderCounts.get(n) || 0) + 1);
  }
  const isMultiVolume = Array.from(orderCounts.values()).some(c => c > 2);

  if (isMultiVolume) {
    // Multi-volume book: keep original order, just dedup and renumber
    // Don't sort — the site's original order groups by volume
  } else {
    // Single-volume: sort prologue → regular → misc → 番外
    deduped.sort((a, b) => {
      const catA = category(a);
      const catB = category(b);
      if (catA !== catB) return catA - catB;
      const aNum = extractOrder(a.id, a.title);
      const bNum = extractOrder(b.id, b.title);
      if (aNum !== bNum) return aNum - bNum;
      return 0;
    });
  }

  // Renumber sequentially
  deduped.forEach((ch, i) => { ch.order = i + 1; });
  return deduped;
}
