import React, { useState } from 'react';
import { getArticlesFromTab, ArticlesResponse, Article } from '@/services/api';
import { EmptyState } from '../LoadingStates';
import { SearchIcon } from '../Icons';

interface FaultCodesProps {
  articlesData: ArticlesResponse | null;
  onArticleSelect: (articleId: string) => void;
}

const FaultCodes: React.FC<FaultCodesProps> = ({ articlesData, onArticleSelect }) => {
  const [search, setSearch] = useState('');
  const allDtcs = getArticlesFromTab(articlesData, 'diagnostic');

  const filtered = search
    ? allDtcs.filter(a =>
        a.title?.toLowerCase().includes(search.toLowerCase()) ||
        a.code?.toLowerCase().includes(search.toLowerCase())
      )
    : allDtcs;

  return (
    <div className="space-y-6">
      <div>
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[hsl(191,97%,50%)] mb-1 block">DIAGNOSTICS</span>
        <h2 className="text-xl font-heading font-bold text-white">Diagnostic Trouble Codes</h2>
        <p className="text-sm text-[hsl(215,20%,65%)] mt-1">{allDtcs.length} codes documented</p>
      </div>

      {allDtcs.length > 0 && (
        <div className="glass-card flex items-center gap-3 px-4 py-2.5">
          <SearchIcon className="w-4 h-4 text-[hsl(215,16%,47%)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter codes (e.g. P0300, misfire)..."
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
              {article.code && (
                <span className="inline-block px-2 py-0.5 rounded text-xs font-mono font-bold text-[hsl(191,97%,50%)] bg-[hsl(191,97%,50%)]/10 mb-2">
                  {article.code}
                </span>
              )}
              <p className="text-sm text-white/80 group-hover:text-white transition-colors line-clamp-2">
                {article.title}
              </p>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          message="No Fault Codes Found"
          submessage={search ? 'No codes match your search criteria.' : 'No diagnostic trouble codes are available for this vehicle.'}
        />
      )}
    </div>
  );
};

export default FaultCodes;
