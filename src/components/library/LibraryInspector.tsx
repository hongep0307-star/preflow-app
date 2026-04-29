import type { RefObject } from "react";
import { Clipboard, Clock, ExternalLink, Library, Link2, Loader2, RotateCcw, Save, Sparkles, Star, Tags, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ReferenceItem, ReferenceKind } from "@/lib/referenceLibrary";
import type { ReferenceAiSuggestions } from "@/lib/referenceAi";

const KIND_LABEL: Record<ReferenceKind, string> = {
  image: "Image",
  webp: "WebP",
  gif: "GIF",
  video: "Video",
  youtube: "YouTube",
  link: "Link",
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
  if (!value || !Number.isFinite(value)) return "Unknown";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

function formatDateTime(value?: string | null): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDimensions(width?: number | null, height?: number | null): string {
  if (!width || !height) return "Unknown";
  return `${width} x ${height}`;
}

function youtubeEmbedUrl(url?: string | null): string | null {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/(?:watch\?[^#]*?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return match?.[1] ? `https://www.youtube.com/embed/${match[1]}` : null;
}

interface LibraryInspectorProps {
  selected: ReferenceItem | null;
  selectedItems?: ReferenceItem[];
  hideMediaPreview?: boolean;
  selectedHiddenByFilters: boolean;
  selectedDuplicateCount: number;
  /** 이 자료가 현재 몇 개의 (프로젝트, target) 쌍에 연결돼 있는지. 0 이면 표시 안 함. */
  selectedUsageCount?: number;
  selectedSuggestions?: Partial<ReferenceAiSuggestions>;
  videoRef: RefObject<HTMLVideoElement>;
  playbackRate: string;
  onPlaybackRateChange: (rate: string) => void;
  saving: boolean;
  aiBusy: boolean;
  editTitle: string;
  editTags: string;
  editNotes: string;
  editRating: string;
  editSourceUrl: string;
  timestampText: string;
  onEditTitleChange: (value: string) => void;
  onEditTagsChange: (value: string) => void;
  onEditNotesChange: (value: string) => void;
  onEditRatingChange: (value: string) => void;
  onEditSourceUrlChange: (value: string) => void;
  onTimestampTextChange: (value: string) => void;
  onSaveMetadata: () => void;
  onToggleFavorite: () => void;
  onSetCover: () => void;
  onSaveFrame: () => void;
  onAddTimestampNote: () => void;
  onClassify: () => void;
  onAcceptSuggestions: () => void;
  onDelete: () => void;
  onRestoreSelected: () => void;
  onCopyText: (value: string, label: string) => void;
  onPromoteToAsset?: () => void;
  onExportSelected?: () => void;
  /** 프로젝트 컨텍스트가 없거나 자료가 image/webp/gif 가 아니면 false → 버튼 disable. */
  canPromoteToAsset: boolean;
}

export function LibraryInspector({
  selected,
  selectedItems = [],
  hideMediaPreview = false,
  selectedHiddenByFilters,
  selectedDuplicateCount,
  selectedUsageCount = 0,
  selectedSuggestions,
  videoRef,
  playbackRate,
  onPlaybackRateChange,
  saving,
  aiBusy,
  editTitle,
  editTags,
  editNotes,
  editRating,
  editSourceUrl,
  timestampText,
  onEditTitleChange,
  onEditTagsChange,
  onEditNotesChange,
  onEditRatingChange,
  onEditSourceUrlChange,
  onTimestampTextChange,
  onSaveMetadata,
  onToggleFavorite,
  onSetCover,
  onSaveFrame,
  onAddTimestampNote,
  onClassify,
  onAcceptSuggestions,
  onDelete,
  onRestoreSelected,
  onCopyText,
  onPromoteToAsset,
  onExportSelected,
  canPromoteToAsset,
}: LibraryInspectorProps) {
  const selectedRegularTags = selected?.tags.filter((tag) => !tag.startsWith("folder:")) ?? [];
  const selectedFolderTags = selected?.tags.filter((tag) => tag.startsWith("folder:")) ?? [];
  const selectedImagePreviewUrl = selected
    ? selected.kind === "gif" || selected.kind === "webp"
      ? selected.file_url || selected.thumbnail_url || ""
      : selected.thumbnail_url || selected.file_url || ""
    : "";
  const multiSelected = selectedItems.length > 1;
  const multiSize = selectedItems.reduce((sum, item) => sum + (item.file_size ?? 0), 0);
  const multiKinds = selectedItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.kind] = (acc[item.kind] ?? 0) + 1;
    return acc;
  }, {});
  const selectedActionItems = multiSelected ? selectedItems : selected ? [selected] : [];
  const allActionItemsTrashed = selectedActionItems.length > 0 && selectedActionItems.every((item) => Boolean(item.deleted_at));
  const deleteActionLabel = allActionItemsTrashed
    ? `Permanently Delete${multiSelected ? ` ${selectedActionItems.length} Items` : " Reference"}`
    : `Move${multiSelected ? ` ${selectedActionItems.length} Items` : " Reference"} to Trash`;
  const deleteDialogTitle = allActionItemsTrashed ? "Permanently delete reference?" : "Move reference to Trash?";
  const deleteDialogDescription = allActionItemsTrashed
    ? "This removes the library row and stored media files. Project links to this reference will also be removed."
    : "This moves the reference to Trash. You can restore it later from the Trash view.";

  return (
    <aside className="h-full min-h-0 overflow-y-auto border-l border-border-subtle bg-surface-sidebar">
      {multiSelected ? (
        <div className="p-5">
          <div className="border border-border-subtle bg-surface-panel p-4" style={{ borderRadius: 0 }}>
            <div className="text-[10px] font-mono tracking-[0.14em] text-muted-foreground">MULTI SELECT</div>
            <div className="mt-2 text-[18px] font-semibold">{selectedItems.length} items selected</div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
              <div className="border border-border-subtle bg-background p-2" style={{ borderRadius: 0 }}>
                <div className="font-mono text-[9px] uppercase">Total size</div>
                <div className="mt-1 text-foreground">{formatBytes(multiSize)}</div>
              </div>
              <div className="border border-border-subtle bg-background p-2" style={{ borderRadius: 0 }}>
                <div className="font-mono text-[9px] uppercase">Kinds</div>
                <div className="mt-1 text-foreground">
                  {Object.entries(multiKinds).map(([kind, count]) => `${kind}:${count}`).join(" / ")}
                </div>
              </div>
            </div>
            <Button className="mt-4 h-9 w-full text-[12px]" style={{ borderRadius: 0 }} onClick={onExportSelected}>
              Export selected as pack...
            </Button>
            {allActionItemsTrashed ? (
              <Button variant="outline" className="mt-2 h-9 w-full gap-2 text-[12px]" style={{ borderRadius: 0 }} onClick={onRestoreSelected}>
                <RotateCcw className="h-3.5 w-3.5" />
                Restore {selectedActionItems.length} items
              </Button>
            ) : null}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="mt-2 h-9 w-full gap-2 text-[12px]" style={{ borderRadius: 0 }}>
                  <Trash2 className="h-3.5 w-3.5" />
                  {deleteActionLabel}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{allActionItemsTrashed ? `Permanently delete ${selectedActionItems.length} references?` : `Move ${selectedActionItems.length} references to Trash?`}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {allActionItemsTrashed
                      ? "This removes the selected library rows and stored media files. Project links to these references will also be removed."
                      : "This moves the selected references to Trash. You can restore them later from the Trash view."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    {allActionItemsTrashed ? "Permanently Delete" : "Move to Trash"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      ) : selectedHiddenByFilters ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-muted-foreground">
          The selected reference is hidden by the current filters. Clear filters or select another visible item.
        </div>
      ) : selected ? (
        <div className="p-5">
          {!hideMediaPreview ? (
            <>
              <div className="aspect-video border border-border-subtle bg-muted/30 flex items-center justify-center overflow-hidden" style={{ borderRadius: 0 }}>
                {selected.kind === "video" && selected.file_url ? (
                  <video
                    ref={videoRef}
                    src={selected.file_url}
                    poster={selected.thumbnail_url ?? undefined}
                    controls
                    className="h-full w-full bg-black object-contain"
                    onLoadedMetadata={(event) => {
                      event.currentTarget.playbackRate = Number(playbackRate);
                    }}
                  />
                ) : selected.kind === "youtube" && youtubeEmbedUrl(selected.source_url) ? (
                  <iframe
                    src={youtubeEmbedUrl(selected.source_url) ?? undefined}
                    title={selected.title}
                    className="h-full w-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                ) : selected.kind === "link" ? (
                  <div className="flex flex-col items-center gap-3 px-6 text-center">
                    <Link2 className="h-9 w-9 text-muted-foreground" />
                    <div className="break-all text-[12px] text-muted-foreground">{selected.source_url}</div>
                  </div>
                ) : selectedImagePreviewUrl ? (
                  <img src={selectedImagePreviewUrl} alt={selected.title} className="h-full w-full object-contain" />
                ) : (
                  <Library className="h-9 w-9 text-muted-foreground" />
                )}
              </div>

              {selected.kind === "video" ? (
                <div className="mt-3 grid grid-cols-3 gap-2">
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
            </>
          ) : null}

          {selected.color_palette.length > 0 ? (
            <div className="mt-3 border border-border-subtle bg-surface-panel p-3" style={{ borderRadius: 0 }}>
              <div className="mb-2 text-[10px] font-mono tracking-[0.12em] text-muted-foreground">COLOR PALETTE</div>
              <div className="flex flex-wrap gap-2">
                {selected.color_palette.slice(0, 10).map((swatch, index) => (
                  <button
                    key={`${swatch.color}_${index}`}
                    type="button"
                    title={swatch.color}
                    aria-label={`Copy ${swatch.color}`}
                    onClick={() => onCopyText(swatch.color, "Color")}
                    className="h-6 w-6 border border-border-subtle shadow-sm transition-transform hover:scale-110"
                    style={{ backgroundColor: swatch.color, borderRadius: 0 }}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex items-start justify-between gap-3">
            <div>
              <Badge variant="secondary" className="mb-2 text-[10px]">{KIND_LABEL[selected.kind]}</Badge>
              <h2 className="text-[16px] font-semibold leading-snug">{selected.title}</h2>
              {selectedDuplicateCount > 1 ? (
                <div className="mt-1 text-[11px] text-amber-500">
                  Duplicate candidate: {selectedDuplicateCount} matching files
                </div>
              ) : null}
            </div>
            <button
              onClick={onToggleFavorite}
              className="text-muted-foreground transition-colors hover:text-primary"
              title={selected.is_favorite ? "Remove favorite" : "Add favorite"}
            >
              <Star className={cn("h-4 w-4", selected.is_favorite && "fill-primary text-primary")} />
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 text-[11px]">
            <div className="border border-border-subtle bg-surface-panel p-3" style={{ borderRadius: 0 }}>
              <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-3 w-3" />
                Created
              </div>
              <div className="font-mono">{formatDate(selected.created_at)}</div>
            </div>
            <div className="border border-border-subtle bg-surface-panel p-3" style={{ borderRadius: 0 }}>
              <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
                <Sparkles className="h-3 w-3" />
                Classify
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono">{selected.classification_status ?? "unclassified"}</span>
                <Button variant="outline" className="h-6 px-2 text-[10px]" style={{ borderRadius: 0 }} disabled={aiBusy} onClick={onClassify}>
                  {aiBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : "AI"}
                </Button>
              </div>
              <div className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                Uses OpenAI when available. {selected.kind === "video" && !selected.thumbnail_url ? "No poster is available, so this will classify from text metadata only." : "Visual classify uses the thumbnail/poster when available."}
              </div>
            </div>
          </div>

          {selectedSuggestions && !selectedSuggestions.error ? (
            <div className="mt-5 border border-border-subtle bg-surface-panel p-3" style={{ borderRadius: 0 }}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[10px] font-mono tracking-[0.12em] text-muted-foreground">
                  <Sparkles className="h-3 w-3" />
                  AI SUGGESTIONS
                  {selectedSuggestions.classification_input === "text" ? (
                    <span className="text-amber-500">TEXT-ONLY</span>
                  ) : null}
                </div>
                <Button variant="outline" className="h-7 px-2 text-[10px]" style={{ borderRadius: 0 }} disabled={aiBusy} onClick={onAcceptSuggestions}>
                  Accept
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[...(selectedSuggestions.suggested_tags ?? []), ...(selectedSuggestions.mood_labels ?? [])].slice(0, 16).map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
                ))}
              </div>
              {selectedSuggestions.brief_fit || selectedSuggestions.conti_use || selectedSuggestions.motion_notes ? (
                <div className="mt-3 space-y-1.5 text-[11px] leading-relaxed text-text-secondary">
                  {selectedSuggestions.brief_fit ? <div><span className="text-muted-foreground">Brief:</span> {selectedSuggestions.brief_fit}</div> : null}
                  {selectedSuggestions.conti_use ? <div><span className="text-muted-foreground">Conti:</span> {selectedSuggestions.conti_use}</div> : null}
                  {selectedSuggestions.motion_notes ? <div><span className="text-muted-foreground">Motion:</span> {selectedSuggestions.motion_notes}</div> : null}
                </div>
              ) : null}
            </div>
          ) : selectedSuggestions?.error ? (
            <div className="mt-5 border border-destructive/40 bg-destructive/10 p-3 text-[11px] text-destructive" style={{ borderRadius: 0 }}>
              AI failed: {String(selectedSuggestions.error)}
            </div>
          ) : null}

          {selected.source_url ? (
            <a href={selected.source_url} target="_blank" rel="noreferrer" className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground hover:text-primary">
              <ExternalLink className="h-3 w-3" />
              <span className="truncate">{selected.source_url}</span>
            </a>
          ) : null}

          {onPromoteToAsset ? (
            <div className="mt-4">
              <Button
                variant="outline"
                className="h-8 w-full gap-2 text-[11px]"
                style={{ borderRadius: 0 }}
                onClick={onPromoteToAsset}
                disabled={!canPromoteToAsset}
                title={
                  !canPromoteToAsset
                    ? "Promote needs an image/webp/gif reference and a project context."
                    : "Create a project asset that links to this Library item"
                }
              >
                <Sparkles className="h-3.5 w-3.5" />
                Promote to Asset
                {(selected.promoted_asset_ids?.length ?? 0) > 0 ? (
                  <Badge variant="secondary" className="ml-1 rounded-none text-[9px]">
                    {selected.promoted_asset_ids!.length} created
                  </Badge>
                ) : null}
              </Button>
            </div>
          ) : null}

          <div className="mt-5">
            <div className="mb-2 text-[10px] font-mono tracking-[0.12em] text-muted-foreground">ORGANIZE</div>
            <div className="space-y-2">
              <Input value={editTitle} onChange={(event) => onEditTitleChange(event.target.value)} className="h-8 text-[12px]" placeholder="Title" />
              <Input value={editTags} onChange={(event) => onEditTagsChange(event.target.value)} className="h-8 text-[12px]" placeholder="Tags separated by comma" />
              <div className="flex gap-2">
                <select
                  value={editRating}
                  onChange={(event) => onEditRatingChange(event.target.value)}
                  className="h-8 flex-1 border border-border-subtle bg-background px-2 text-[12px]"
                  style={{ borderRadius: 0 }}
                >
                  <option value="0">No rating</option>
                  <option value="1">1 / 5</option>
                  <option value="2">2 / 5</option>
                  <option value="3">3 / 5</option>
                  <option value="4">4 / 5</option>
                  <option value="5">5 / 5</option>
                </select>
                <Button className="h-8 gap-1.5 text-[11px]" style={{ borderRadius: 0 }} onClick={onSaveMetadata} disabled={saving}>
                  <Save className="h-3.5 w-3.5" />
                  Save
                </Button>
              </div>
              <Textarea value={editNotes} onChange={(event) => onEditNotesChange(event.target.value)} placeholder="Notes" className="min-h-[90px] text-[12px]" />
              <div className="flex gap-2">
                <Input value={editSourceUrl} onChange={(event) => onEditSourceUrlChange(event.target.value)} className="h-8 text-[12px]" placeholder="Source URL" />
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 px-2"
                  style={{ borderRadius: 0 }}
                  disabled={!editSourceUrl.trim()}
                  onClick={() => onCopyText(editSourceUrl.trim(), "Source URL")}
                  title="Copy source URL"
                >
                  <Clipboard className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-mono tracking-[0.12em] text-muted-foreground">
              <Tags className="h-3 w-3" />
              TAGS
            </div>
            <div className="flex flex-wrap gap-1.5">
              {selectedRegularTags.length > 0 ? selectedRegularTags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
              )) : (
                <span className="text-[12px] text-muted-foreground">No tags yet</span>
              )}
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 text-[10px] font-mono tracking-[0.12em] text-muted-foreground">FOLDERS</div>
            <div className="flex flex-wrap gap-1.5">
              {selectedFolderTags.length > 0 ? selectedFolderTags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-[10px]">
                  {tag.replace(/^folder:/, "")}
                </Badge>
              )) : (
                <span className="text-[12px] text-muted-foreground">No folder tags</span>
              )}
            </div>
          </div>

          {selected.kind === "video" ? (
            <div className="mt-5">
              <div className="mb-2 text-[10px] font-mono tracking-[0.12em] text-muted-foreground">TIMESTAMP NOTES</div>
              <div className="flex gap-2">
                <Input
                  value={timestampText}
                  onChange={(event) => onTimestampTextChange(event.target.value)}
                  placeholder={`Note at ${formatDuration(videoRef.current?.currentTime ?? 0)}`}
                  className="h-8 text-[12px]"
                />
                <Button variant="outline" className="h-8 text-[11px]" style={{ borderRadius: 0 }} onClick={onAddTimestampNote}>
                  Add
                </Button>
              </div>
              <div className="mt-2 space-y-1.5">
                {selected.timestamp_notes.length > 0 ? selected.timestamp_notes.map((note) => (
                  <div key={note.id} className="border border-border-subtle bg-surface-panel px-2 py-1.5 text-[11px]" style={{ borderRadius: 0 }}>
                    <span className="font-mono text-primary">{formatDuration(note.atSec)}</span>
                    <span className="ml-2 text-text-secondary">{note.text}</span>
                  </div>
                )) : (
                  <span className="text-[12px] text-muted-foreground">No timestamp notes yet</span>
                )}
              </div>
            </div>
          ) : null}

          {selected.notes ? (
            <div className="mt-5">
              <div className="mb-2 text-[10px] font-mono tracking-[0.12em] text-muted-foreground">NOTES</div>
              <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-text-secondary">{selected.notes}</p>
            </div>
          ) : null}

          <div className="mt-5 border border-border-subtle bg-surface-panel p-3" style={{ borderRadius: 0 }}>
            <div className="mb-3 text-[10px] font-mono tracking-[0.12em] text-muted-foreground">PROPERTIES</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
              <div className="text-muted-foreground">Dimensions</div>
              <div className="font-mono text-right">{formatDimensions(selected.width, selected.height)}</div>
              <div className="text-muted-foreground">Size</div>
              <div className="font-mono text-right">{formatBytes(selected.file_size)}</div>
              <div className="text-muted-foreground">Type</div>
              <div className="font-mono text-right">{selected.mime_type ?? KIND_LABEL[selected.kind]}</div>
              <div className="text-muted-foreground">Used In</div>
              <div className="font-mono text-right">
                {selectedUsageCount > 0
                  ? `${selectedUsageCount} project${selectedUsageCount === 1 ? "" : "s"}`
                  : "Not yet"}
              </div>
              <div className="text-muted-foreground">Date Imported</div>
              <div className="font-mono text-right">{formatDateTime(selected.imported_at ?? selected.created_at)}</div>
              <div className="text-muted-foreground">Date Modified</div>
              <div className="font-mono text-right">{formatDateTime(selected.updated_at)}</div>
              {selected.file_url ? (
                <>
                  <div className="text-muted-foreground">File URL</div>
                  <button
                    type="button"
                    className="truncate text-right font-mono text-primary hover:underline"
                    onClick={() => onCopyText(selected.file_url ?? "", "File URL")}
                    title={selected.file_url}
                  >
                    Copy
                  </button>
                </>
              ) : null}
            </div>
          </div>

          <div className="mt-6 border-t border-border-subtle pt-4">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="h-8 w-full gap-2 text-[11px]" style={{ borderRadius: 0 }}>
                  <Trash2 className="h-3.5 w-3.5" />
                  {deleteActionLabel}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{deleteDialogTitle}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {deleteDialogDescription}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    {allActionItemsTrashed ? "Permanently Delete" : "Move to Trash"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-muted-foreground">
          Select a reference to preview details.
        </div>
      )}
    </aside>
  );
}
