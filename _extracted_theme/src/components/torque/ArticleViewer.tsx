import React, { useState, useEffect, useCallback } from 'react';
import { getArticleContent, processArticleHtml, ArticleContent } from '@/services/api';
import { ArrowLeftIcon } from './Icons';
import { Skeleton } from './LoadingStates';

interface ArticleViewerProps {
  contentSource: string;
  vehicleId: string;
  articleId: string;
  onBack: () => void;
  onArticleNavigate: (articleId: string) => void;
}

const ArticleViewer: React.FC<ArticleViewerProps> = ({
  contentSource, vehicleId, articleId, onBack, onArticleNavigate
}) => {
  const [article, setArticle] = useState<ArticleContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadArticle = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await getArticleContent(contentSource, vehicleId, articleId);
      setArticle(data);
    } catch (e) {
      setError('Failed to load article content.');
    } finally {
      setLoading(false);
    }
  }, [contentSource, vehicleId, articleId]);

  useEffect(() => {
    loadArticle();
  }, [loadArticle]);

  // Handle clicks on internal article links
  const handleContentClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const link = target.closest('a[data-article-id]');
    if (link) {
      e.preventDefault();
      const aid = link.getAttribute('data-article-id');
      if (aid) onArticleNavigate(aid);
    }
  }, [onArticleNavigate]);

  const processedHtml = article?.html
    ? processArticleHtml(article.html, contentSource)
    : article?.content
    ? processArticleHtml(article.content, contentSource)
    : '';

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-[hsl(215,16%,47%)] hover:text-white transition-colors mb-6 group"
      >
        <ArrowLeftIcon className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        <span className="font-mono tracking-wider text-xs">BACK TO DASHBOARD</span>
      </button>

      {loading && <Skeleton type="content" />}

      {error && (
        <div className="glass-card p-6 text-center">
          <p className="text-red-400 font-mono text-sm">{error}</p>
          <button onClick={loadArticle} className="btn-glass mt-4 text-sm">Retry</button>
        </div>
      )}

      {article && !loading && (
        <div className="animate-fade-in">
          {/* Title */}
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-white mb-6 leading-tight">
            {article.title}
          </h1>

          {/* Content */}
          <div className="glass-card p-6 md:p-8">
            <div
              className="motor-prose"
              onClick={handleContentClick}
              dangerouslySetInnerHTML={{ __html: processedHtml }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ArticleViewer;
