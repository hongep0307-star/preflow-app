export const SkeletonCard = () => (
  <div className="flex items-center gap-4 px-4 py-3 bg-card border border-border" style={{ borderRadius: 4 }}>
    <div className="w-[100px] h-[60px] flex-shrink-0 skeleton-shimmer" style={{ borderRadius: 3 }} />
    <div className="flex-1 space-y-2">
      <div className="h-4 w-2/5 skeleton-shimmer" style={{ borderRadius: 2 }} />
      <div className="h-3 w-1/3 skeleton-shimmer" style={{ borderRadius: 2 }} />
    </div>
    <div className="w-[140px] h-[3px] skeleton-shimmer" style={{ borderRadius: 1 }} />
  </div>
);
