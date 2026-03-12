import React, { useState } from 'react';
import { getArticlesGroupedByBucket, ArticlesResponse } from '@/services/api';
import { EmptyState } from '../LoadingStates';
import { SearchIcon, ChevronRightIcon } from '../Icons';

interface ProceduresProps {
  articlesData: ArticlesResponse | null;
  onArticleSelect: (articleId: string) => void;
}

const Procedures: React.FC<ProceduresProps> = ({ articlesData, onArticleSelect }) => {
  const [search, setSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const grouped = getArticlesGroupedByBucket(articlesData, 'procedure');
  const groupNames = Object.keys(grouped);

  const toggleGroup = (name: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const filteredGroups = search
    ? Object.fromEntries(
        Object.entries(grouped).map(([name, articles]) => [
          name,
          articles.filter(a => a.title?.toLowerCase().includes(search.toLowerCase()))
        ]).filter(([, articles]) => (articles as any[]).length > 0)
      )
    : grouped;

  const totalCount = Object.values(grouped).reduce((sum, arr) => sum + arr.length, 0);

  return (
    <div className="space-y-6">
      <div>
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[hsl(191,97%,50%)] mb-1 block">SERVICE PROCEDURES</span>
        <h2 className="text-xl font-heading font-bold text-white">Repair & Service</h2>
        <p className="text-sm text-[hsl(215,20%,65%)] mt-1">{totalCount} procedures in {groupNames.length} categories</p>
      </div>

      {totalCount > 0 && (
        <div className="glass-card flex items-center gap-3 px-4 py-2.5">
          <SearchIcon className="w-4 h-4 text-[hsl(215,16%,47%)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search procedures..."
            className="flex-1 bg-transparent text-sm text-white placeholder-[hsl(215,16%,47%)] outline-none"
          />
        </div>
      )}

      {Object.keys(filteredGroups).length > 0 ? (
        <div className="space-y-3">
          {Object.entries(filteredGroups).map(([groupName, articles]) => {
            const isExpanded = expandedGroups.has(groupName) || !!search;
            return (
              <div key={groupName} className="glass-card overflow-hidden">
                <button
                  onClick={() => toggleGroup(groupName)}
                  className="w-full flex items-center justify-between p-4 hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-white">{groupName}</span>
                    <span className="text-[10px] font-mono text-[hsl(215,16%,47%)] bg-white/5 px-2 py-0.5 rounded">
                      {articles.length}
                    </span>
                  </div>
                  <ChevronRightIcon className={`w-4 h-4 text-[hsl(215,16%,47%)] transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                </button>
                {isExpanded && (
                  <div className="border-t border-white/5">
                    {articles.map(article => (
                      <button
                        key={article.id}
                        onClick={() => onArticleSelect(article.id)}
                        className="w-full flex items-center gap-3 px-6 py-3 hover:bg-white/[0.03] transition-colors text-left group"
                      >
                        <div className="w-1.5 h-1.5 rounded-full bg-[hsl(191,97%,50%)]/40 flex-shrink-0" />
                        <span className="text-sm text-white/70 group-hover:text-[hsl(191,97%,50%)] transition-colors line-clamp-1">
                          {article.title}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          message="No Procedures Found"
          submessage={search ? 'No procedures match your search.' : 'No repair procedures available for this vehicle.'}
        />
      )}
    </div>
  );
};

export default Procedures;
