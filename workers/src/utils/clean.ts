// Chapter content cleaner — strips source site UI noise + duplicate title
export function cleanChapterContent(raw: string, title?: string): string {
  let text = raw;

  // Remove chapter number + title from body (sites embed it as first line)
  // Pattern: "第一章 仙子的修行" or "第1章 武道生"
  const firstLine = text.split('\n')[0] || '';
  const firstLineClean = firstLine.replace(/\s+/g, '');

  if (title) {
    const tClean = title.replace(/\s+/g, '');
    // Direct substring match (partial match handles -《书名》 suffix)
    if (firstLineClean.includes(tClean) || tClean.includes(firstLineClean) ||
        firstLineClean.slice(0, 8).includes(tClean.slice(0, 6)) ||
        tClean.slice(0, 8).includes(firstLineClean.slice(0, 6))) {
      text = text.split('\n').slice(1).join('\n');
    }
  } else {
    // Fallback: strip chapter-numbered line from body (only when title not known)
    if (CH_NUM.test(firstLine)) {
      const rest = text.split('\n');
      if (rest[0] && rest[0].length < 120 && CH_NUM.test(rest[0])) {
        text = rest.slice(1).join('\n');
      }
    }
  }

  // Also strip book title patterns like "-《书名》" from body
  text = text.replace(/[-—–]\s*[《「][^》」]+[》」]/g, '');
  text = text.replace(/[《「][^》」]+[》」]/g, '');

  // Rest of cleaning...

  // Remove page indicators like "第(1/3)页" "第1/3页" "页码1/3"
  text = text.replace(/第\s*[\(（]?\s*\d+\s*\/\s*\d+\s*[\)）]?\s*页/g, "");
  // Remove standalone "(1/3)" patterns
  text = text.replace(/[\(（]\s*\d+\s*\/\s*\d+\s*[\)）]/g, "");

  // Remove function calls
  text = text.replace(/\b[a-z_]+\s*\(\s*\)\s*;?/gi, "");

  // Remove UI controls (font size, mode switcher)
  text = text.replace(/^字体\s*$/gm, "");
  text = text.replace(/^[大小中]\s*$/gm, "");
  text = text.replace(/^换手\s*$/gm, "");
  text = text.replace(/^关灯\s*$/gm, "");
  text = text.replace(/^全屏阅读\s*$/gm, "");

  // Navigation text
  text = text.replace(/^上一章\s*$/gm, "");
  text = text.replace(/^下一章\s*$/gm, "");
  text = text.replace(/^目录\s*$/gm, "");
  text = text.replace(/^存书签\s*$/gm, "");
  text = text.replace(/^\s*→\s*$/gm, "");
  text = text.replace(/^\s*←\s*$/gm, "");

  // Common ad/site markers
  text = text.replace(/本章未完.*点击下一页/g, "");
  text = text.replace(/本章完/g, "");
  text = text.replace(/记住本站.*/g, "");
  text = text.replace(/请收藏本站.*/g, "");
  text = text.replace(/最新网址.*/g, "");
  text = text.replace(/\b(biquge|笔趣阁|www\.|https?:\/\/)\S*/gi, "");

  // Clean up whitespace
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/^\s+|\s+$/gm, "");

  return text.trim();
}


