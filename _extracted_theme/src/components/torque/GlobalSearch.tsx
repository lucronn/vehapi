import React, { useState, useEffect, useRef } from 'react';
import { ArticlesResponse, Article } from '@/services/api';
import { SearchIcon, XIcon, FileIcon } from './Icons';

interface GlobalSearchProps {
  articlesData: ArticlesResponse | null;
  onArticleSelect: (articleId: string) => void;
}

const GlobalSearch: React.FC<GlobalSearchProps> = ({ articlesData, onArticleSelect }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Article[]>([]);
  const [showResults, setShowResults] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout>();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        const input = containerRef.current?.querySelector('input');
        input?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setShowResults(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      if (!articlesData?.articleDetails) return;
      const q = query.toLowerCase();
      const filtered = articlesData.articleDetails.filter(
        a => a.title?.toLowerCase().includes(q) || a.code?.toLowerCase().includes(q)
      ).slice(0, 15);
      setResults(filtered);
      setShowResults(true);
    }, 300);
  }, [query, articlesData]);

  return (
    <div ref={containerRef} className="relative">
      <div className="glass-card flex items-center gap-3 px-4 py-3">
        <SearchIcon className="w-4 h-4 text-[hsl(215,16%,47%)] flex-shrink-0" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => query && setShowResults(true)}
          placeholder="Global System Search (e.g. 'brake torque', 'P0300', 'fuse box')"
          className="flex-1 bg-transparent text-sm text-white placeholder-[hsl(215,16%,47%)] outline-none"
        />
        <kbd className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono text-[hsl(215,16%,47%)] bg-white/5 border border-white/10">
          <span className="text-[9px]">CMD</span>+K
        </kbd>
      </div>

      {showResults && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 glass-card neon-border-cyan z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <span className="text-xs font-mono text-[hsl(191,97%,50%)] tracking-wider">
              SYSTEM QUERY RESULTS ({results.length})
            </span>
            <button onClick={() => { setShowResults(false); setQuery(''); }} className="text-xs text-[hsl(215,16%,47%)] hover:text-white transition-colors">
              Dismiss
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {results.map(article => (
              <button
                key={article.id}
                onClick={() => {
                  onArticleSelect(article.id);
                  setShowResults(false);
                  setQuery('');
                }}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.04] transition-colors text-left group"
              >
                <FileIcon className="w-4 h-4 text-[hsl(215,16%,47%)] flex-shrink-0" />
                <span className="text-sm text-white/80 group-hover:text-[hsl(191,97%,50%)] transition-colors truncate">
                  {article.title}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default GlobalSearch;
