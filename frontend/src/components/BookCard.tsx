import { useState } from "react";
import { Link } from "react-router-dom";

interface Props {
  site: string;
  bookId: string;
  title: string;
  author: string;
  description: string;
  coverUrl: string;
  latestChapter?: string;
  showDescription?: boolean;
}

export default function BookCard({
  site, bookId, title, author, description, coverUrl, latestChapter, showDescription = true,
}: Props) {
  const [coverError, setCoverError] = useState(false);
  const showFallback = !coverUrl || coverError;
  return (
    <Link
      to={`/book/${site}/${bookId}`}
      className="card flex gap-3 p-3 active:scale-[0.98] transition-transform"
    >
      <div className="w-20 h-[106px] shrink-0 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700">
        {showFallback ? (
          <div className="w-full h-full flex items-center justify-center text-2xl text-gray-400">📖</div>
        ) : (
          <img src={coverUrl} alt={title} className="w-full h-full object-cover" loading="lazy"
            onError={() => setCoverError(true)} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-sm line-clamp-1">{title}</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{author}</p>
        {showDescription && description && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 line-clamp-2">{description}</p>
        )}
        {latestChapter && (
          <p className="text-xs text-accent mt-1 line-clamp-1">{latestChapter}</p>
        )}
        <span className="inline-block mt-1 text-[10px] text-gray-400 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700">
          {site}
        </span>
      </div>
    </Link>
  );
}
