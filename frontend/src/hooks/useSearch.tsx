// Persist search state across navigation
import { createContext, useContext, useState, useCallback } from "react";
import type { SearchItem } from "../lib/api";

export interface SourceError { site: string; error: string; }

interface SearchState {
  keyword: string;
  results: SearchItem[];
  loading: boolean;
  sourceErrors: SourceError[];
  exactMatch: SearchItem | null;
}

interface SearchContextType extends SearchState {
  setKeyword: (k: string) => void;
  addResults: (items: SearchItem[]) => void;
  setResults: (items: SearchItem[]) => void;
  setLoading: (l: boolean) => void;
  addSourceError: (e: SourceError) => void;
  clearSourceErrors: () => void;
  setExactMatch: (m: SearchItem | null) => void;
  clear: () => void;
}

const SearchContext = createContext<SearchContextType>({
  keyword: "", results: [], loading: false, sourceErrors: [], exactMatch: null,
  setKeyword: () => {}, addResults: () => {}, setResults: () => {}, setLoading: () => {},
  addSourceError: () => {}, clearSourceErrors: () => {}, setExactMatch: () => {}, clear: () => {},
});

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sourceErrors, setSourceErrors] = useState<SourceError[]>([]);
  const [exactMatch, setExactMatchState] = useState<SearchItem | null>(null);

  const addResults = useCallback((items: SearchItem[]) => {
    setResults(prev => {
      const existing = new Set(prev.map(r => r.key || `${r.site}|${r.bookId}`));
      const newItems = items.filter(i => !existing.has(i.key || `${i.site}|${i.bookId}`));
      return [...prev, ...newItems];
    });
  }, []);

  const addSourceError = useCallback((e: SourceError) => {
    setSourceErrors(prev => prev.find(x => x.site === e.site) ? prev : [...prev, e]);
  }, []);
  const clearSourceErrors = useCallback(() => setSourceErrors([]), []);

  // Only the first exact match wins; later identical matches don't overwrite.
  const setExactMatch = useCallback((m: SearchItem | null) => {
    setExactMatchState(prev => (m === null ? null : (prev ? prev : m)));
  }, []);

  const clear = useCallback(() => {
    setKeyword(""); setResults([]); setLoading(false);
    setSourceErrors([]); setExactMatchState(null);
  }, []);

  return (
    <SearchContext.Provider value={{ keyword, results, loading, sourceErrors, exactMatch, setKeyword, addResults, setResults, setLoading, addSourceError, clearSourceErrors, setExactMatch, clear }}>
      {children}
    </SearchContext.Provider>
  );
}

export function useSearch() { return useContext(SearchContext); }
