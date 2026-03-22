import React from 'react';

interface SkeletonProps {
  type?: 'list' | 'grid' | 'content';
  count?: number;
}

export const Skeleton: React.FC<SkeletonProps> = ({ type = 'list', count = 3 }) => {
  if (type === 'grid') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="glass-card p-5 space-y-3 animate-pulse">
            <div className="h-3 w-24 bg-white/5 rounded-full" />
            <div className="h-5 w-3/4 bg-white/5 rounded-full" />
            <div className="h-3 w-1/2 bg-white/5 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  if (type === 'content') {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-2/3 bg-white/5 rounded-lg" />
        <div className="h-4 w-full bg-white/5 rounded-lg" />
        <div className="h-4 w-5/6 bg-white/5 rounded-lg" />
        <div className="h-4 w-4/6 bg-white/5 rounded-lg" />
        <div className="h-32 w-full bg-white/5 rounded-xl mt-6" />
        <div className="h-4 w-full bg-white/5 rounded-lg" />
        <div className="h-4 w-3/4 bg-white/5 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="glass-card p-4 flex items-center gap-4 animate-pulse">
          <div className="w-10 h-10 rounded-lg bg-white/5 flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-3/4 bg-white/5 rounded-full" />
            <div className="h-3 w-1/2 bg-white/5 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
};

interface EmptyStateProps {
  icon?: React.ReactNode;
  message: string;
  submessage?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, message, submessage }) => (
  <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
    {icon ? (
      <div className="mb-4 text-torque-muted">{icon}</div>
    ) : (
      <svg className="w-12 h-12 mb-4 text-[hsl(215,16%,47%)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 11.625l2.25-2.25M12 11.625l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
      </svg>
    )}
    <h3 className="text-lg font-semibold text-white mb-1 font-heading">{message}</h3>
    {submessage && (
      <p className="text-sm text-[hsl(215,16%,47%)] max-w-md font-mono">{submessage}</p>
    )}
  </div>
);

export const LoadingSpinner: React.FC<{ text?: string }> = ({ text = 'Synchronizing Data...' }) => (
  <div className="flex flex-col items-center justify-center py-12 gap-4">
    <div className="w-8 h-8 border-2 border-[hsl(191,97%,50%)]/30 border-t-[hsl(191,97%,50%)] rounded-full animate-spin" />
    <p className="text-sm font-mono text-[hsl(215,16%,47%)]">{text}</p>
  </div>
);
