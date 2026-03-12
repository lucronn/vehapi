import React, { useState } from 'react';
import { ArticlesResponse, FilterTab, Bucket } from '@/services/api';
import { EmptyState } from '../LoadingStates';
import { CubeIcon } from '../Icons';

interface AllDataProps {
  articlesData: ArticlesResponse | null;
  onArticleSelect: (articleId: string) => void;
}

const AllData: React.FC<AllDataProps> = ({ articlesData, onArticleSelect }) => {
  const [activeTabIndex, setActiveTabIndex] = useState(0);

  if (!articlesData?.filterTabs?.length) {
    return (
      <div className="space-y-6">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[hsl(191,97%,50%)] mb-1 block">ALL DATA</span>
          <h2 className="text-xl font-heading font-bold text-white">Reference Catalog</h2>
        </div>
        <EmptyState message="No Data Available" submessage="Article data has not been loaded yet." />
      </div>
    );
  }

  const tabs = articlesData.filterTabs;
  const activeTab = tabs[activeTabIndex];
  const totalCount = articlesData.articleDetails?.length || 0;

  const renderBucket = (bucket: Bucket, depth: number = 0) => (
    <div key={bucket.name} className={depth > 0 ? 'ml-4 mt-2' : ''}>
      <h4 className={`text-[10px] font-mono uppercase tracking-wider mb-2 ${
        depth === 0 ? 'text-[hsl(191,97%,50%)]' : 'text-[hsl(215,16%,47%)]'
      }`}>
        {bucket.name}
        {bucket.count != null && (
          <span className="ml-2 text-[hsl(215,16%,47%)]">({bucket.count})</span>
        )}
      </h4>
      {bucket.articles && bucket.articles.length > 0 && (
        <div className="space-y-0.5 mb-3">
          {bucket.articles.map(article => (
            <button
              key={article.id}
              onClick={() => onArticleSelect(article.id)}
              className="w-full text-left px-3 py-2 text-sm text-white/70 hover:text-[hsl(191,97%,50%)] hover:translate-x-1 transition-all rounded-lg hover:bg-white/[0.02] truncate block"
            >
              {article.title}
            </button>
          ))}
        </div>
      )}
      {bucket.children && bucket.children.map(child => renderBucket(child, depth + 1))}
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[hsl(191,97%,50%)] mb-1 block">ALL DATA</span>
        <h2 className="text-xl font-heading font-bold text-white">Reference Catalog</h2>
        <p className="text-sm text-[hsl(215,20%,65%)] mt-1">{totalCount} total articles</p>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
        {tabs.map((tab, i) => (
          <button
            key={tab.name}
            onClick={() => setActiveTabIndex(i)}
            className={`px-4 py-2 rounded-xl text-xs font-mono tracking-wider whitespace-nowrap transition-all flex-shrink-0 ${
              activeTabIndex === i
                ? 'bg-[hsl(191,97%,50%)]/10 text-[hsl(191,97%,50%)] border border-[hsl(191,97%,50%)]/30'
                : 'bg-white/5 text-[hsl(215,20%,65%)] border border-white/5 hover:border-white/10'
            }`}
          >
            {tab.name}
            {tab.count != null && <span className="ml-1.5 opacity-60">({tab.count})</span>}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab && (
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <CubeIcon className="w-4 h-4 text-[hsl(191,97%,50%)]" />
            <h3 className="text-sm font-semibold text-white">{activeTab.name}</h3>
          </div>
          {activeTab.buckets && activeTab.buckets.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {activeTab.buckets.map(bucket => (
                <div key={bucket.name} className="min-w-0">
                  {renderBucket(bucket)}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[hsl(215,16%,47%)] font-mono">No buckets in this tab.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default AllData;
