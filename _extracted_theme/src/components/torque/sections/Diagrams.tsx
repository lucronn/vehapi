import React, { useState } from 'react';
import { getArticlesFromTab, ArticlesResponse, getGraphicUrl } from '@/services/api';
import { EmptyState } from '../LoadingStates';
import { SearchIcon } from '../Icons';

interface DiagramsProps {
  contentSource: string;
  articlesData: ArticlesResponse | null;
  onArticleSelect: (articleId: string) => void;
}

const Diagrams: React.FC<DiagramsProps> = ({ contentSource, articlesData, onArticleSelect }) => {
  const [search, setSearch] = useState('');
  const allDiagrams = getArticlesFromTab(articlesData, 'diagram');

  const filtered = search
    ? allDiagrams.filter(a => a.title?.toLowerCase().includes(search.toLowerCase()))
    : allDiagrams;

  return (
    <div className="space-y-6">
      <div>
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[hsl(191,97%,50%)] mb-1 block">WIRING & COMPONENTS</span>
        <h2 className="text-xl font-heading font-bold text-white">Wiring Diagrams</h2>
        <p className="text-sm text-[hsl(215,20%,65%)] mt-1">{allDiagrams.length} diagrams available</p>
      </div>

      {allDiagrams.length > 0 && (
        <div className="glass-card flex items-center gap-3 px-4 py-2.5">
          <SearchIcon className="w-4 h-4 text-[hsl(215,16%,47%)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search diagrams..."
            className="flex-1 bg-transparent text-sm text-white placeholder-[hsl(215,16%,47%)] outline-none"
          />
        </div>
      )}

      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(article => (
            <button
              key={article.id}
              onClick={() => onArticleSelect(article.id)}
              className="glass-card overflow-hidden text-left hover:neon-border-cyan transition-all group"
            >
              {article.thumbnailHref && (
                <div className="aspect-[4/3] bg-white/[0.02] flex items-center justify-center overflow-hidden">
                  <img
                    src={getGraphicUrl(contentSource, article.thumbnailHref)}
                    alt={article.title}
                    className="w-full h-full object-contain p-2 group-hover:scale-105 transition-transform duration-300"
                    onError={(e) => {
                      (e.target as HTMLImageElement).parentElement!.innerHTML = '<div class="text-[hsl(215,16%,47%)] text-xs font-mono">PREVIEW_UNAVAILABLE</div>';
                    }}
                  />
                </div>
              )}
              <div className="p-3">
                <p className="text-xs text-white/80 group-hover:text-white transition-colors line-clamp-2">
                  {article.title}
                </p>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          message="No Diagrams Found"
          submessage={search ? 'No diagrams match your search.' : 'No wiring diagrams available for this vehicle.'}
        />
      )}
    </div>
  );
};

export default Diagrams;
