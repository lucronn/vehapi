import React, { useState, useEffect } from 'react';
import { getFluids, getArticlesFromTab, ArticlesResponse, Fluid, Article } from '@/services/api';
import { Skeleton, EmptyState } from '../LoadingStates';
import { ChevronRightIcon, BeakerIcon, CogIcon } from '../Icons';

interface OverviewProps {
  contentSource: string;
  vehicleId: string;
  articlesData: ArticlesResponse | null;
  onArticleSelect: (articleId: string) => void;
}

const Overview: React.FC<OverviewProps> = ({ contentSource, vehicleId, articlesData, onArticleSelect }) => {
  const [fluids, setFluids] = useState<Fluid[]>([]);
  const [fluidsLoading, setFluidsLoading] = useState(true);

  useEffect(() => {
    const loadFluids = async () => {
      try {
        const data = await getFluids(contentSource, vehicleId);
        setFluids(data?.data || []);
      } catch (e) {
        // Fluids not available
      } finally {
        setFluidsLoading(false);
      }
    };
    loadFluids();
  }, [contentSource, vehicleId]);

  const specArticles = getArticlesFromTab(articlesData, 'spec');
  const dtcArticles = getArticlesFromTab(articlesData, 'diagnostic');
  const tsbArticles = getArticlesFromTab(articlesData, 'bulletin');

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[hsl(191,97%,50%)] mb-1 block">TACTICAL OVERVIEW</span>
        <p className="text-sm text-[hsl(215,20%,65%)]">Primary systems and vital statistics</p>
      </div>

      {/* System Specifications */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <CogIcon className="w-4 h-4 text-[hsl(191,97%,50%)]" />
          <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-[hsl(191,97%,50%)]">System Specifications</h3>
        </div>
        {specArticles.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {specArticles.slice(0, 12).map((article, i) => (
              <button
                key={article.id}
                onClick={() => onArticleSelect(article.id)}
                className="glass-card p-4 text-left group hover:neon-border-cyan transition-all"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[hsl(215,20%,65%)] line-clamp-2">
                    {article.title}
                  </span>
                  <ChevronRightIcon className="w-3.5 h-3.5 text-white/20 group-hover:text-[hsl(191,97%,50%)] transition-all group-hover:translate-x-0.5 flex-shrink-0 ml-2" />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState message="No Specifications Found" submessage="Vital statistics are not available for this unit configuration." />
        )}
      </section>

      {/* Fluid Capacities */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <BeakerIcon className="w-4 h-4 text-[hsl(263,83%,58%)]" />
          <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-[hsl(263,83%,58%)]">Fluid Capacities & Requirements</h3>
        </div>
        {fluidsLoading ? (
          <Skeleton type="grid" count={6} />
        ) : fluids.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {fluids.map((fluid, i) => (
              <div key={fluid.id || i} className="glass-card p-4">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[hsl(263,83%,58%)] block mb-2">
                  {fluid.title}
                </span>
                <p className="text-base font-semibold text-white mb-1">
                  {fluid.capacity || <span className="font-mono text-[hsl(215,16%,47%)] text-xs">DATA_UNAVAILABLE</span>}
                </p>
                {fluid.specification && (
                  <p className="text-[10px] font-mono text-[hsl(215,16%,47%)] line-clamp-2">{fluid.specification}</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState message="No Fluid Data" submessage="Fluid capacity data is not available for this configuration." />
        )}
      </section>

      {/* Common Issues Summary */}
      {(dtcArticles.length > 0 || tsbArticles.length > 0) && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-amber-400">Common Issues</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {dtcArticles.length > 0 && (
              <div className="glass-card p-4 border-l-2 border-amber-500/50">
                <span className="text-xs font-mono text-amber-400">{dtcArticles.length} Diagnostic Trouble Codes</span>
                <p className="text-[10px] text-[hsl(215,16%,47%)] mt-1">Active fault codes documented for this vehicle</p>
              </div>
            )}
            {tsbArticles.length > 0 && (
              <div className="glass-card p-4 border-l-2 border-blue-500/50">
                <span className="text-xs font-mono text-blue-400">{tsbArticles.length} Technical Service Bulletins</span>
                <p className="text-[10px] text-[hsl(215,16%,47%)] mt-1">Manufacturer-issued service advisories</p>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
};

export default Overview;
