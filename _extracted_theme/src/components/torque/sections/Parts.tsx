import React, { useState } from 'react';
import { getArticlesFromTab, ArticlesResponse } from '@/services/api';
import { EmptyState } from '../LoadingStates';
import { SearchIcon, ChevronRightIcon } from '../Icons';

interface PartsProps {
  articlesData: ArticlesResponse | null;
  onArticleSelect: (articleId: string) => void;
}

const Parts: React.FC<PartsProps> = ({ articlesData, onArticleSelect }) => {
  const [search, setSearch] = useState('');
  const allParts = getArticlesFromTab(articlesData, 'part');

  const filtered = search
    ? allParts.filter(a => a.title?.toLowerCase().includes(search.toLowerCase()))
    : allParts;

  return (
    <div className="space-y-6">
      <div>
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[hsl(191,97%,50%)] mb-1 block">PARTS</span>
        <h2 className="text-xl font-heading font-bold text-white">Component Inventory</h2>
        <p className="text-sm text-[hsl(215,20%,65%)] mt-1">{allParts.length} parts documented</p>
      </div>

      {allParts.length > 0 && (
        <div className="glass-card flex items-center gap-3 px-4 py-2.5">
          <SearchIcon className="w-4 h-4 text-[hsl(215,16%,47%)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search parts..."
            className="flex-1 bg-transparent text-sm text-white placeholder-[hsl(215,16%,47%)] outline-none"
          />
        </div>
      )}

      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(article => (
            <button
              key={article.id}
              onClick={() => onArticleSelect(article.id)}
              className="glass-card p-4 text-left hover:neon-border-cyan transition-all group"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/80 group-hover:text-white transition-colors line-clamp-2 flex-1">
                  {article.title}
                </span>
                <ChevronRightIcon className="w-3.5 h-3.5 text-white/20 group-hover:text-[hsl(191,97%,50%)] flex-shrink-0 ml-2" />
              </div>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          message="No Parts Data"
          submessage={search ? 'No parts match your search.' : 'Parts catalog data not available for this vehicle.'}
        />
      )}
    </div>
  );
};

export default Parts;
