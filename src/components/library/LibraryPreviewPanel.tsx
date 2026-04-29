import type { RefObject } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Library, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReferenceItem } from "@/lib/referenceLibrary";

function youtubeEmbedUrl(url?: string | null): string | null {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/(?:watch\?[^#]*?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return match?.[1] ? `https://www.youtube.com/embed/${match[1]}` : null;
}

interface LibraryPreviewPanelProps {
  item: ReferenceItem;
  items: ReferenceItem[];
  videoRef: RefObject<HTMLVideoElement>;
  playbackRate: string;
  onPlaybackRateChange: (rate: string) => void;
  onSelect: (id: string) => void;
  onBack: () => void;
  onSetCover: () => void;
  onSaveFrame: () => void;
  saving: boolean;
}

export function LibraryPreviewPanel({
  item,
  items,
  videoRef,
  playbackRate,
  onPlaybackRateChange,
  onSelect,
  onBack,
  onSetCover,
  onSaveFrame,
  saving,
}: LibraryPreviewPanelProps) {
  const currentIndex = items.findIndex((candidate) => candidate.id === item.id);
  const previous = currentIndex > 0 ? items[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < items.length - 1 ? items[currentIndex + 1] : null;
  const imagePreviewUrl = item.kind === "gif" || item.kind === "webp"
    ? item.file_url || item.thumbnail_url || ""
    : item.thumbnail_url || item.file_url || "";

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border-subtle px-4">
        <Button variant="ghost" className="h-8 gap-2 text-[12px]" style={{ borderRadius: 0 }} onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to grid
        </Button>
        <div className="min-w-0 px-4 text-center">
          <div className="truncate text-[13px] font-semibold">{item.title}</div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {currentIndex + 1} / {items.length}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            style={{ borderRadius: 0 }}
            disabled={!previous}
            onClick={() => previous && onSelect(previous.id)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            style={{ borderRadius: 0 }}
            disabled={!next}
            onClick={() => next && onSelect(next.id)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-5">
        <div className="relative flex h-full w-full items-center justify-center border border-border-subtle bg-black" style={{ borderRadius: 0 }}>
          {item.kind === "video" && item.file_url ? (
            <video
              ref={videoRef}
              src={item.file_url}
              poster={item.thumbnail_url ?? undefined}
              controls
              className="h-full w-full object-contain"
              onLoadedMetadata={(event) => {
                event.currentTarget.playbackRate = Number(playbackRate);
              }}
            />
          ) : item.kind === "youtube" && youtubeEmbedUrl(item.source_url) ? (
            <iframe
              src={youtubeEmbedUrl(item.source_url) ?? undefined}
              title={item.title}
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : item.kind === "link" ? (
            <div className="flex max-w-xl flex-col items-center gap-3 px-8 text-center text-white/80">
              <Link2 className="h-12 w-12" />
              <div className="break-all text-[13px]">{item.source_url}</div>
            </div>
          ) : imagePreviewUrl ? (
            <img src={imagePreviewUrl} alt={item.title} className="h-full w-full object-contain" />
          ) : (
            <Library className="h-12 w-12 text-white/50" />
          )}
        </div>
      </div>

      {item.kind === "video" ? (
        <div className="flex h-12 flex-shrink-0 items-center justify-center gap-2 border-t border-border-subtle px-4">
          <select
            value={playbackRate}
            onChange={(event) => onPlaybackRateChange(event.target.value)}
            className="h-8 border border-border-subtle bg-background px-2 text-[11px]"
            style={{ borderRadius: 0 }}
          >
            <option value="0.25">0.25x</option>
            <option value="0.5">0.5x</option>
            <option value="1">1x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
          </select>
          <Button variant="outline" className="h-8 text-[11px]" style={{ borderRadius: 0 }} onClick={onSetCover} disabled={saving}>
            Set Cover
          </Button>
          <Button variant="outline" className="h-8 text-[11px]" style={{ borderRadius: 0 }} onClick={onSaveFrame} disabled={saving}>
            Save Frame
          </Button>
        </div>
      ) : null}
    </section>
  );
}
