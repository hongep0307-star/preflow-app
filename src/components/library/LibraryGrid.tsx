import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type MouseEvent, type PointerEvent } from "react";
import { Copy, Download, ExternalLink, Film, FolderInput, FolderOpen, ImageIcon, Library, Link2, Loader2, Pencil, Pin, RefreshCw, RotateCcw, Search, Sparkles, Star, Tags, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import type { ReferenceItem, ReferenceKind } from "@/lib/referenceLibrary";
import type { LibraryFolderRow } from "./LibrarySidebar";
import type { LibraryViewMode } from "./LibraryToolbar";

const KIND_LABEL: Record<ReferenceKind, string> = {
  image: "Image",
  webp: "WebP",
  gif: "GIF",
  video: "Video",
  youtube: "YouTube",
  link: "Link",
};

const KIND_ICON: Record<ReferenceKind, typeof ImageIcon> = {
  image: ImageIcon,
  webp: ImageIcon,
  gif: ImageIcon,
  video: Film,
  youtube: Film,
  link: Link2,
};

function formatDate(value?: string | null): string {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDuration(value?: number | null): string {
  if (!value || !Number.isFinite(value)) return "00:00";
  const total = Math.max(0, Math.floor(value));
  const minutes = Math.floor(total / 60).toString().padStart(2, "0");
  const seconds = (total % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatBytes(value?: number | null): string {
  if (!value || !Number.isFinite(value)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

function LibraryMediaThumbnail({ item, Icon }: { item: ReferenceItem; Icon: typeof ImageIcon }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hoveringVideo, setHoveringVideo] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoTime, setVideoTime] = useState(0);
  const [scrubbingVideo, setScrubbingVideo] = useState(false);
  const [animatedPreviewReady, setAnimatedPreviewReady] = useState(false);
  const [animatedPreviewFailed, setAnimatedPreviewFailed] = useState(false);
  const canAnimateOnHover = (item.kind === "gif" || item.kind === "webp") && Boolean(item.file_url);
  const stillSrc = item.thumbnail_url || item.file_url || "";
  const animatedSrc = item.file_url || stillSrc;
  const canPreviewVideo = item.kind === "video" && Boolean(item.file_url);
  const videoProgress = videoDuration > 0 ? Math.max(0, Math.min(1, videoTime / videoDuration)) : 0;
  const showAnimatedPreview = canAnimateOnHover && animatedPreviewReady && !animatedPreviewFailed;

  useEffect(() => {
    setVideoDuration(0);
    setVideoTime(0);
    setScrubbingVideo(false);
    setAnimatedPreviewReady(false);
    setAnimatedPreviewFailed(false);
  }, [item.id, item.file_url, item.thumbnail_url]);

  const playVideo = () => {
    const video = videoRef.current;
    if (!video) return;
    setHoveringVideo(true);
    void video.play().catch(() => {
      // Hover previews are opportunistic; the full preview panel still has controls.
    });
  };

  const pauseVideo = () => {
    const video = videoRef.current;
    setHoveringVideo(false);
    setScrubbingVideo(false);
    if (video) video.pause();
  };

  const seekVideoTo = (time: number) => {
    const video = videoRef.current;
    const duration = Number.isFinite(video?.duration) && video!.duration > 0
      ? video!.duration
      : item.duration_sec && item.duration_sec > 0
      ? item.duration_sec
      : 0;
    if (!video || duration <= 0) return;
    const nextTime = Math.max(0, Math.min(duration, time));
    video.pause();
    video.currentTime = nextTime;
    setVideoTime(nextTime);
  };

  const handleTimelinePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  const handleTimelinePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    setScrubbingVideo(true);
    videoRef.current?.pause();
  };

  const handleTimelinePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    setScrubbingVideo(false);
    if (hoveringVideo) void videoRef.current?.play().catch(() => undefined);
  };

  const handleTimelineChange = (event: ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation();
    seekVideoTo(Number(event.currentTarget.value));
  };

  const stopTimelineEvent = (event: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  if (canPreviewVideo) {
    return (
      <div
        className="h-full w-full"
        title="Hover to play. Drag the timeline to scrub."
        onMouseEnter={playVideo}
        onMouseLeave={pauseVideo}
      >
        {stillSrc ? (
          <img
            src={stillSrc}
            alt={item.title}
            className={cn(
              "h-full w-full object-cover transition-all duration-200 group-hover:scale-[1.03]",
              hoveringVideo && "opacity-0",
            )}
          />
        ) : (
          <Icon className={cn("h-8 w-8 text-muted-foreground transition-opacity", hoveringVideo && "opacity-0")} />
        )}
        <video
          ref={videoRef}
          src={item.file_url ?? undefined}
          poster={item.thumbnail_url ?? undefined}
          muted
          loop
          playsInline
          preload="auto"
          onLoadedMetadata={(event) => {
            const duration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
            setVideoDuration(duration);
            setVideoTime(event.currentTarget.currentTime || 0);
          }}
          onTimeUpdate={(event) => {
            if (!scrubbingVideo) setVideoTime(event.currentTarget.currentTime || 0);
          }}
          className={cn(
            "absolute inset-0 h-full w-full object-cover opacity-0 transition-all duration-200 group-hover:scale-[1.03]",
            hoveringVideo && "opacity-100",
          )}
        />
        <div
          className={cn(
            "absolute inset-x-2 bottom-1.5 z-10 h-7 cursor-ew-resize opacity-0 transition-opacity group-hover:opacity-100",
            (hoveringVideo || scrubbingVideo) && "opacity-100",
          )}
          onPointerDown={handleTimelinePointerDown}
          onPointerMove={handleTimelinePointerMove}
          onPointerUp={handleTimelinePointerEnd}
          onPointerCancel={handleTimelinePointerEnd}
          onClick={stopTimelineEvent}
          onDoubleClick={stopTimelineEvent}
          title="Drag to scrub"
        >
          <input
            type="range"
            min={0}
            max={videoDuration || item.duration_sec || 0}
            step={0.01}
            value={videoTime}
            onChange={handleTimelineChange}
            onInput={handleTimelineChange}
            onPointerDown={handleTimelinePointerDown}
            onPointerMove={handleTimelinePointerMove}
            onPointerUp={handleTimelinePointerEnd}
            onPointerCancel={handleTimelinePointerEnd}
            onClick={stopTimelineEvent}
            onDoubleClick={stopTimelineEvent}
            className="absolute left-0 right-0 top-1/2 h-3 w-full -translate-y-1/2 cursor-ew-resize accent-primary"
            style={{ borderRadius: 0 }}
          />
        </div>
      </div>
    );
  }

  if (!stillSrc) {
    return <Icon className="h-8 w-8 text-muted-foreground" />;
  }

  if (canAnimateOnHover) {
    return (
      <>
        <img
          src={stillSrc}
          alt={item.title}
          className={cn(
            "h-full w-full object-cover transition-all duration-200 group-hover:scale-[1.03]",
            showAnimatedPreview && "group-hover:opacity-0",
          )}
        />
        <img
          src={animatedSrc}
          alt=""
          aria-hidden="true"
          onLoad={() => setAnimatedPreviewReady(true)}
          onError={() => setAnimatedPreviewFailed(true)}
          className={cn(
            "absolute inset-0 h-full w-full object-cover opacity-0 transition-all duration-200 group-hover:scale-[1.03]",
            showAnimatedPreview && "group-hover:opacity-100",
          )}
        />
      </>
    );
  }

  return (
    <img
      src={stillSrc}
      alt={item.title}
      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
    />
  );
}

interface LibraryGridProps {
  items: ReferenceItem[];
  selectedId: string | null;
  selectedIds: Set<string>;
  duplicateCounts: Map<string, number>;
  /** referenceId → 이 자료가 (프로젝트, target) 쌍에서 몇 번 쓰이고 있는지.
   *  값이 없거나 0 이면 뱃지를 숨긴다 — 새 자료에 시각적 노이즈를 만들지 않기 위함. */
  usageCounts?: Record<string, number>;
  loading: boolean;
  error: string | null;
  isDragging: boolean;
  gridSize: number;
  viewMode: LibraryViewMode;
  onSelect: (id: string, event?: MouseEvent<HTMLElement>) => void;
  onDoubleClick?: (id: string) => void;
  onMarqueeSelect?: (ids: string[], mode: "replace" | "add") => void;
  onChooseFiles: () => void;
  onImportEagle: () => void;
  onDragStateChange: (dragging: boolean) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  hasCopiedTags: boolean;
  onOpenDefault: (item: ReferenceItem) => void;
  onShowInFolder: (item: ReferenceItem) => void;
  onCopyFilePath: (item: ReferenceItem) => void;
  onCopyTags: (item: ReferenceItem) => void;
  onPasteTags: (item: ReferenceItem) => void;
  folderRows: LibraryFolderRow[];
  activeFolderTag: string | null;
  onAddToFolder: (item: ReferenceItem) => void;
  onMoveToFolder: (item: ReferenceItem) => void;
  onRemoveFromActiveFolder: (item: ReferenceItem) => void;
  onExportSelected: (item: ReferenceItem) => void;
  onTogglePin: (item: ReferenceItem) => void;
  onDuplicate: (item: ReferenceItem) => void;
  onRename: (item: ReferenceItem) => void;
  onSearchByImage: (item: ReferenceItem) => void;
  onClassify: (item: ReferenceItem) => void;
  onRegenerateThumbnail: (item: ReferenceItem) => void;
  onMergeDuplicates: (item: ReferenceItem) => void;
  onMoveToTrash: (item: ReferenceItem) => void;
  onRestore: (item: ReferenceItem) => void;
  onPermanentlyDelete: (item: ReferenceItem) => void;
  onAddToBrief: (item: ReferenceItem) => void;
  onAddToAgent: (item: ReferenceItem) => void;
  onAddToConti: (item: ReferenceItem) => void;
  onPromoteToAsset: (item: ReferenceItem) => void;
  canAddToProject: boolean;
}

export function LibraryGrid({
  items,
  selectedId,
  selectedIds,
  duplicateCounts,
  usageCounts,
  loading,
  error,
  isDragging,
  gridSize,
  viewMode,
  onSelect,
  onDoubleClick,
  onMarqueeSelect,
  onChooseFiles,
  onImportEagle,
  onDragStateChange,
  onDrop,
  hasCopiedTags,
  onOpenDefault,
  onShowInFolder,
  onCopyFilePath,
  onCopyTags,
  onPasteTags,
  folderRows,
  activeFolderTag,
  onAddToFolder,
  onMoveToFolder,
  onRemoveFromActiveFolder,
  onExportSelected,
  onTogglePin,
  onDuplicate,
  onRename,
  onSearchByImage,
  onClassify,
  onRegenerateThumbnail,
  onMergeDuplicates,
  onMoveToTrash,
  onRestore,
  onPermanentlyDelete,
  onAddToBrief,
  onAddToAgent,
  onAddToConti,
  onPromoteToAsset,
  canAddToProject,
}: LibraryGridProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const [marquee, setMarquee] = useState<{
    startClientX: number;
    startClientY: number;
    currentClientX: number;
    currentClientY: number;
    startContentX: number;
    startContentY: number;
    currentContentX: number;
    currentContentY: number;
    mode: "replace" | "add";
  } | null>(null);
  const [intersectingIds, setIntersectingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!marquee) return;

    const updateSelection = (event: globalThis.MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const currentContentX = event.clientX - containerRect.left + container.scrollLeft;
      const currentContentY = event.clientY - containerRect.top + container.scrollTop;
      const rect = {
        left: Math.min(marquee.startClientX, event.clientX),
        right: Math.max(marquee.startClientX, event.clientX),
        top: Math.min(marquee.startClientY, event.clientY),
        bottom: Math.max(marquee.startClientY, event.clientY),
      };
      const edge = 48;
      if (event.clientY < containerRect.top + edge) container.scrollTop -= Math.max(4, edge - (event.clientY - containerRect.top));
      if (event.clientY > containerRect.bottom - edge) container.scrollTop += Math.max(4, edge - (containerRect.bottom - event.clientY));

      const nextIds = new Set<string>();
      for (const item of items) {
        const node = cardRefs.current.get(item.id);
        if (!node) continue;
        const cardRect = node.getBoundingClientRect();
        const intersects = cardRect.left < rect.right
          && cardRect.right > rect.left
          && cardRect.top < rect.bottom
          && cardRect.bottom > rect.top;
        if (intersects) nextIds.add(item.id);
      }
      setIntersectingIds(nextIds);
      setMarquee((current) => current ? {
        ...current,
        currentClientX: event.clientX,
        currentClientY: event.clientY,
        currentContentX,
        currentContentY,
      } : current);
    };

    const finishSelection = () => {
      onMarqueeSelect?.([...intersectingIds], marquee.mode);
      setMarquee(null);
      setIntersectingIds(new Set());
    };

    document.addEventListener("mousemove", updateSelection);
    document.addEventListener("mouseup", finishSelection, { once: true });
    return () => {
      document.removeEventListener("mousemove", updateSelection);
      document.removeEventListener("mouseup", finishSelection);
    };
  }, [intersectingIds, items, marquee, onMarqueeSelect]);

  const handleMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || loading || error || items.length === 0 || viewMode !== "grid") return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-library-card='true']")) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const startContentX = event.clientX - rect.left + container.scrollLeft;
    const startContentY = event.clientY - rect.top + container.scrollTop;
    event.preventDefault();
    setIntersectingIds(new Set());
    setMarquee({
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      startContentX,
      startContentY,
      currentContentX: startContentX,
      currentContentY: startContentY,
      mode: event.shiftKey || event.ctrlKey || event.metaKey ? "add" : "replace",
    });
  };

  const marqueeStyle = marquee
    ? {
      left: Math.min(marquee.startContentX, marquee.currentContentX),
      top: Math.min(marquee.startContentY, marquee.currentContentY),
      width: Math.abs(marquee.currentContentX - marquee.startContentX),
      height: Math.abs(marquee.currentContentY - marquee.startContentY),
    }
    : undefined;

  return (
    <section
      ref={containerRef}
      className={cn(
        "relative h-full min-h-0 overflow-y-auto px-5 py-5 transition-colors select-none",
        isDragging && "bg-primary/[0.04]",
      )}
      onMouseDown={handleMouseDown}
      onDragEnter={(event) => {
        event.preventDefault();
        onDragStateChange(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        onDragStateChange(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        onDragStateChange(false);
      }}
      onDrop={onDrop}
    >
      {isDragging ? (
        <div className="pointer-events-none absolute inset-5 z-20 flex items-center justify-center border border-dashed border-primary/70 bg-background/80 backdrop-blur-sm" style={{ borderRadius: 0 }}>
          <div className="text-center">
            <Upload className="mx-auto mb-3 h-8 w-8 text-primary" />
            <div className="text-[15px] font-semibold">Drop to save references</div>
            <div className="mt-1 text-[12px] text-muted-foreground">Images, GIFs, videos, and URLs are supported.</div>
          </div>
        </div>
      ) : null}
      {marquee ? (
        <div
          className="pointer-events-none absolute z-30 border border-primary bg-primary/10"
          style={{ ...marqueeStyle, borderRadius: 0 }}
        />
      ) : null}

      {loading ? (
        <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="font-mono text-[11px]">Loading references...</span>
        </div>
      ) : error ? (
        <div className="border border-destructive/40 bg-destructive/10 p-4 text-[13px] text-destructive" style={{ borderRadius: 0 }}>
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="flex min-h-[360px] flex-col items-center justify-center border border-dashed border-border-subtle text-center" style={{ borderRadius: 0 }}>
          <Library className="mb-3 h-8 w-8 text-muted-foreground" />
          <h2 className="text-[15px] font-semibold">No references yet</h2>
          <p className="mt-2 max-w-[360px] text-[12px] leading-relaxed text-muted-foreground">
            Drop files here, click Add Reference, paste an image/video from clipboard, or save a YouTube URL from the left panel.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button onClick={onChooseFiles} className="h-9 gap-2 text-[12px]" style={{ borderRadius: 0 }}>
              <Upload className="h-4 w-4" />
              Choose Files
            </Button>
            <Button variant="outline" onClick={onImportEagle} className="h-9 gap-2 text-[12px]" style={{ borderRadius: 0 }}>
              <Library className="h-4 w-4" />
              Import Eagle
            </Button>
          </div>
        </div>
      ) : (
        <div
          className={cn("grid gap-3", viewMode === "list" && "grid-cols-1")}
          style={viewMode === "grid" ? { gridTemplateColumns: `repeat(auto-fill, minmax(${gridSize}px, 1fr))` } : undefined}
        >
          {items.map((item) => {
            const Icon = KIND_ICON[item.kind];
            const isSelected = selectedIds.has(item.id) || selectedId === item.id;
            const selectedCount = selectedIds.has(item.id) ? selectedIds.size : 1;
            return (
              <ContextMenu key={item.id}>
                <ContextMenuTrigger asChild>
                  <button
                    ref={(node) => {
                      if (node) cardRefs.current.set(item.id, node);
                      else cardRefs.current.delete(item.id);
                    }}
                    data-library-card="true"
                    onClick={(event) => onSelect(item.id, event)}
                    onDoubleClick={() => onDoubleClick?.(item.id)}
                    onContextMenu={(event) => onSelect(item.id, event)}
                    className={cn(
                      "group overflow-hidden border bg-surface-panel text-left transition-all",
                      isSelected || intersectingIds.has(item.id)
                        ? "border-primary/70 shadow-[0_0_0_1px_hsl(var(--primary)/0.35)]"
                        : "border-border-subtle hover:border-primary/40",
                    )}
                    style={{ borderRadius: 0 }}
                  >
                    <div className="aspect-video bg-muted/30 relative flex items-center justify-center overflow-hidden">
                      <LibraryMediaThumbnail item={item} Icon={Icon} />
                      <Badge className="absolute left-2 top-2 h-5 px-1.5 text-[9px]" variant="secondary">
                        {KIND_LABEL[item.kind]}
                      </Badge>
                      {item.is_favorite ? (
                        <Badge className="absolute left-2 top-8 h-5 px-1.5 text-[9px] bg-primary/90 text-primary-foreground">
                          <Star className="mr-1 h-3 w-3 fill-current" />
                          FAV
                        </Badge>
                      ) : null}
                      {item.pinned_at ? (
                        <Badge className="absolute left-2 top-14 h-5 px-1.5 text-[9px] bg-primary/90 text-primary-foreground">
                          <Pin className="mr-1 h-3 w-3 fill-current" />
                          PIN
                        </Badge>
                      ) : null}
                      {item.content_hash && (duplicateCounts.get(item.content_hash) ?? 0) > 1 ? (
                        <Badge className="absolute right-2 top-2 h-5 px-1.5 text-[9px] bg-amber-500/90 text-black">
                          DUP
                        </Badge>
                      ) : null}
                      {item.deleted_at ? (
                        <Badge className="absolute right-2 top-8 h-5 px-1.5 text-[9px] bg-destructive text-destructive-foreground">
                          TRASH
                        </Badge>
                      ) : (usageCounts?.[item.id] ?? 0) > 0 ? (
                        <Badge
                          className="absolute right-2 top-8 h-5 px-1.5 text-[9px] bg-primary/85 text-primary-foreground"
                          title={`Used in ${usageCounts![item.id]} project target${usageCounts![item.id] === 1 ? "" : "s"}`}
                        >
                          USED {usageCounts![item.id]}
                        </Badge>
                      ) : null}
                      {(item.kind === "video" || item.kind === "youtube") && item.duration_sec ? (
                        <span
                          className={cn(
                            "absolute right-2 bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white transition-[bottom] duration-150",
                            item.kind === "video" ? "bottom-2 group-hover:bottom-8" : "bottom-2",
                          )}
                        >
                          {formatDuration(item.duration_sec)}
                        </span>
                      ) : null}
                    </div>
                    <div className="space-y-2 p-3">
                      <div className="line-clamp-2 min-h-[32px] text-[12px] font-semibold text-foreground">{item.title}</div>
                      <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                        <span>{formatDate(item.created_at)}</span>
                        <span>{formatBytes(item.file_size) || (item.rating ? `${item.rating}/5` : "")}</span>
                      </div>
                    </div>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-56 rounded-none">
                  <ContextMenuLabel className="line-clamp-1 text-[11px]">{item.title}</ContextMenuLabel>
                  <ContextMenuSeparator />
                  <ContextMenuItem disabled={!item.file_url && !item.thumbnail_url} onSelect={() => onOpenDefault(item)}>
                    <ExternalLink className="mr-2 h-3.5 w-3.5" />
                    Open With Default App
                  </ContextMenuItem>
                  <ContextMenuItem disabled={!item.file_url && !item.thumbnail_url} onSelect={() => onShowInFolder(item)}>
                    <FolderOpen className="mr-2 h-3.5 w-3.5" />
                    Open File Location
                  </ContextMenuItem>
                  <ContextMenuItem disabled={!item.file_url && !item.thumbnail_url} onSelect={() => onCopyFilePath(item)}>
                    <Copy className="mr-2 h-3.5 w-3.5" />
                    Copy File Path
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => onCopyTags(item)}>
                    <Tags className="mr-2 h-3.5 w-3.5" />
                    Copy Tags
                  </ContextMenuItem>
                  <ContextMenuItem disabled={!hasCopiedTags} onSelect={() => onPasteTags(item)}>
                    <Tags className="mr-2 h-3.5 w-3.5" />
                    Paste Tags
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => onTogglePin(item)}>
                    <Pin className="mr-2 h-3.5 w-3.5" />
                    {item.pinned_at ? "Unpin from Top" : "Pin to Top"}
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => onRename(item)}>
                    <Pencil className="mr-2 h-3.5 w-3.5" />
                    Rename
                    <ContextMenuShortcut>F2</ContextMenuShortcut>
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => onDuplicate(item)}>
                    <Copy className="mr-2 h-3.5 w-3.5" />
                    Duplicate
                    <ContextMenuShortcut>Ctrl+D</ContextMenuShortcut>
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem disabled={folderRows.length === 0 || Boolean(item.deleted_at)} onSelect={() => onAddToFolder(item)}>
                    <FolderInput className="mr-2 h-3.5 w-3.5" />
                    Add {selectedCount > 1 ? `${selectedCount} items` : "to folder"}...
                  </ContextMenuItem>
                  <ContextMenuItem disabled={folderRows.length === 0 || Boolean(item.deleted_at)} onSelect={() => onMoveToFolder(item)}>
                    <FolderInput className="mr-2 h-3.5 w-3.5" />
                    Move {selectedCount > 1 ? `${selectedCount} items` : "to folder"}...
                  </ContextMenuItem>
                  <ContextMenuItem disabled={!activeFolderTag || Boolean(item.deleted_at)} onSelect={() => onRemoveFromActiveFolder(item)}>
                    <FolderOpen className="mr-2 h-3.5 w-3.5" />
                    Remove from this folder
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem disabled={Boolean(item.deleted_at)} onSelect={() => onExportSelected(item)}>
                    <Download className="mr-2 h-3.5 w-3.5" />
                    Export {selectedCount > 1 ? `${selectedCount} items` : "selected"} as pack...
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => onSearchByImage(item)}>
                    <Search className="mr-2 h-3.5 w-3.5" />
                    Search by Image
                  </ContextMenuItem>
                  <ContextMenuItem disabled={Boolean(item.deleted_at)} onSelect={() => onClassify(item)}>
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    Re-classify with AI
                  </ContextMenuItem>
                  <ContextMenuItem disabled={item.kind === "link" || Boolean(item.deleted_at)} onSelect={() => onRegenerateThumbnail(item)}>
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    Regenerate Thumbnail
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={
                      !item.content_hash
                      || (duplicateCounts.get(item.content_hash) ?? 0) < 2
                      || selectedCount < 2
                      || Boolean(item.deleted_at)
                    }
                    onSelect={() => onMergeDuplicates(item)}
                  >
                    <Copy className="mr-2 h-3.5 w-3.5" />
                    Merge selected duplicates into this
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  {item.deleted_at ? (
                    <>
                      <ContextMenuItem onSelect={() => onRestore(item)}>
                        <RotateCcw className="mr-2 h-3.5 w-3.5" />
                        Restore {selectedCount > 1 ? `${selectedCount} items` : ""}
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => onPermanentlyDelete(item)} className="text-destructive focus:text-destructive">
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        Permanently delete {selectedCount > 1 ? `${selectedCount} items` : ""}
                      </ContextMenuItem>
                    </>
                  ) : (
                    <ContextMenuItem onSelect={() => onMoveToTrash(item)} className="text-destructive focus:text-destructive">
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      Move {selectedCount > 1 ? `${selectedCount} items to Trash` : "to Trash"}
                      <ContextMenuShortcut>Del</ContextMenuShortcut>
                    </ContextMenuItem>
                  )}
                  <ContextMenuSeparator />
                  <ContextMenuItem disabled={!canAddToProject || item.kind === "link" || Boolean(item.deleted_at)} onSelect={() => onAddToBrief(item)}>
                    Add to Brief
                  </ContextMenuItem>
                  <ContextMenuItem disabled={!canAddToProject || item.kind === "link" || Boolean(item.deleted_at)} onSelect={() => onAddToAgent(item)}>
                    Add to Agent
                  </ContextMenuItem>
                  <ContextMenuItem disabled={!canAddToProject || item.kind === "link" || Boolean(item.deleted_at)} onSelect={() => onAddToConti(item)}>
                    Add to Conti
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    disabled={
                      !canAddToProject
                      || (item.kind !== "image" && item.kind !== "webp" && item.kind !== "gif")
                      || !item.file_url
                      || Boolean(item.deleted_at)
                    }
                    onSelect={() => onPromoteToAsset(item)}
                  >
                    <Sparkles className="mr-2 h-3.5 w-3.5" />
                    Promote to Asset...
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
      )}
    </section>
  );
}
