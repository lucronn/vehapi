import React, { useState } from 'react';
import { getArticlesFromTab, ArticlesResponse, getGraphicUrl } from '@/services/api';
import { EmptyState } from '../LoadingStates';
import { SearchIcon } from '../Icons';

interface BulletinsProps {
  contentSource: string;
  articlesData: ArticlesResponse | null;
  onArticleSelect: (articleId: string) => void;
}

const Bulletins: React.FC<BulletinsProps> = ({ contentSource, articlesData, onArticleSelect }) => {
  const [search, setSearch] = useState('');
  const allTsbs = getArticlesFromTab(articlesData, 'bulletin');

  const filtered = search
    ? allTsbs.filter(a =>
        a.title?.toLowerCase().includes(search.toLowerCase()) ||
        a.bulletinNumber?.toLowerCase().includes(search.toLowerCase())
      )
    : allTsbs;

  return (
    <div className="space-y-6">
      <div>
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[hsl(191,97%,50%)] mb-1 block">SERVICE INFO</span>
        <h2 className="text-xl font-heading font-bold text-white">Technical Service Bulletins</h2>
        <p className="text-sm text-[hsl(215,20%,65%)] mt-1">{allTsbs.length} bulletins available</p>
      </div>

      {allTsbs.length > 0 && (
        <div className="glass-card flex items-center gap-3 px-4 py-2.5">
          <SearchIcon className="w-4 h-4 text-[hsl(215,16%,47%)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter bulletins..."
            className="flex-1 bg-transparent text-sm text-white placeholder-[hsl(215,16%,47%)] outline-none"
          />
        </div>
      )}

      {filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map(article => (
            <button
              key={article.id}
              onClick={() => onArticleSelect(article.id)}
              className="glass-card p-4 w-full text-left hover:neon-border-cyan transition-all group flex gap-4"
            >
              {article.thumbnailHref && (
                <img
                  src={getGraphicUrl(contentSource, article.thumbnailHref)}
                  alt=""
                  className="w-16 h-16 rounded-lg object-cover border border-white/10 flex-shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  {article.bulletinNumber && (
                    <span className="inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold text-[hsl(263,83%,58%)] bg-[hsl(263,83%,58%)]/10">
                      {article.bulletinNumber}
                    </span>
                  )}
                  {article.releaseDate && (
                    <span className="text-[10px] font-mono text-[hsl(215,16%,47%)]">{article.releaseDate}</span>
                  )}
                </div>
                <p className="text-sm text-white/80 group-hover:text-white transition-colors line-clamp-2">
                  {article.title}
                </p>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          message="No Service Bulletins"
          submessage={search ? 'No bulletins match your search.' : 'No technical service bulletins found for this vehicle.'}
        />
      )}
    </div>
  );
};

export default Bulletins;
