import React, { useState, useEffect } from 'react';
import { getFluids, getArticlesFromTab, ArticlesResponse, Fluid } from '@/services/api';
import { Skeleton, EmptyState } from '../LoadingStates';
import { ChevronRightIcon, BeakerIcon, CogIcon } from '../Icons';

interface SpecificationsProps {
  contentSource: string;
  vehicleId: string;
  articlesData: ArticlesResponse | null;
  onArticleSelect: (articleId: string) => void;
}

const Specifications: React.FC<SpecificationsProps> = ({ contentSource, vehicleId, articlesData, onArticleSelect }) => {
  const [fluids, setFluids] = useState<Fluid[]>([]);
  const [fluidsLoading, setFluidsLoading] = useState(true);

  useEffect(() => {
    const loadFluids = async () => {
      try {
        const data = await getFluids(contentSource, vehicleId);
        setFluids(data?.data || []);
      } catch {
        // Fluid data unavailable, UI will show empty state
      } finally {
        setFluidsLoading(false);
      }
    };
    loadFluids();
  }, [contentSource, vehicleId]);

  const specArticles = getArticlesFromTab(articlesData, 'spec');

  return (
    <div className="space-y-8">
      <div>
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[hsl(191,97%,50%)] mb-1 block">TECH SPECS</span>
        <h2 className="text-xl font-heading font-bold text-white">Specifications & Fluids</h2>
      </div>

      {/* Specifications */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <CogIcon className="w-4 h-4 text-[hsl(191,97%,50%)]" />
          <h3 className="text-sm font-semibold text-white">System Specifications</h3>
          <span className="text-[10px] font-mono text-[hsl(215,16%,47%)] bg-white/5 px-2 py-0.5 rounded">{specArticles.length}</span>
        </div>
        {specArticles.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {specArticles.map(article => (
              <button
                key={article.id}
                onClick={() => onArticleSelect(article.id)}
                className="glass-card p-4 text-left group hover:neon-border-cyan transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[hsl(215,20%,65%)] line-clamp-2">
                    {article.title}
                  </span>
                  <ChevronRightIcon className="w-3.5 h-3.5 text-white/20 group-hover:text-[hsl(191,97%,50%)] flex-shrink-0 ml-2" />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState message="No Specifications" submessage="Specification data not available." />
        )}
      </section>

      {/* Fluids */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <BeakerIcon className="w-4 h-4 text-[hsl(263,83%,58%)]" />
          <h3 className="text-sm font-semibold text-white">Fluid Capacities & Requirements</h3>
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
                  <p className="text-[10px] font-mono text-[hsl(215,16%,47%)] line-clamp-3">{fluid.specification}</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState message="No Fluid Data" submessage="Fluid capacity data not available." />
        )}
      </section>
    </div>
  );
};

export default Specifications;
