import { Check, Download, Grid2X2, HardDrive, List, PackageOpen, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { LibraryFilterRow } from "./LibrarySidebar";
import type { ReferenceKind } from "@/lib/referenceLibrary";

export type RatingFilter = "all" | "rated" | "unrated" | "fourPlus";
export type NoteFilter = "all" | "with" | "without";
export type SourceFilter = "all" | "eagle" | "manual" | "youtube";
export type LibraryViewMode = "grid" | "list";
export type LibrarySortKey = "recent" | "name" | "rating" | "size" | "lastUsed";
export type LibrarySortOrder = "asc" | "desc";

interface LibraryToolbarProps {
  title: string;
  subtitle?: string;
  query: string;
  onQueryChange: (query: string) => void;
  filteredCount: number;
  totalCount: number;
  isCapped: boolean;
  gridSize: number;
  onGridSizeChange: (size: number) => void;
  viewMode: LibraryViewMode;
  onViewModeChange: (mode: LibraryViewMode) => void;
  kindFilter: "all" | ReferenceKind;
  onKindFilterChange: (kind: "all" | ReferenceKind) => void;
  typeRows: Array<{ id: "all" | ReferenceKind; label: string; count: number }>;
  activeTag: string | null;
  onTagChange: (tag: string | null) => void;
  tagRows: LibraryFilterRow[];
  ratingFilter: RatingFilter;
  onRatingFilterChange: (filter: RatingFilter) => void;
  noteFilter: NoteFilter;
  onNoteFilterChange: (filter: NoteFilter) => void;
  sourceFilter: SourceFilter;
  onSourceFilterChange: (filter: SourceFilter) => void;
  sortKey: LibrarySortKey;
  onSortKeyChange: (key: LibrarySortKey) => void;
  sortOrder: LibrarySortOrder;
  onSortOrderChange: (order: LibrarySortOrder) => void;
  onClearFilters: () => void;
  selectedCount: number;
  storageUsageLabel?: string;
  canExportProject: boolean;
  onRefreshStorageUsage: () => void;
  onCleanupOrphans: () => void;
  onImportPack: () => void;
  onExportSelected: () => void;
  onExportFiltered: () => void;
  onExportAll: () => void;
  onExportProject: () => void;
}

const ratingOptions: Array<{ id: RatingFilter; label: string; shortLabel: string }> = [
  { id: "all", label: "Rating: All", shortLabel: "All" },
  { id: "rated", label: "Rated", shortLabel: "Rated" },
  { id: "unrated", label: "Unrated", shortLabel: "Unrated" },
  { id: "fourPlus", label: "4+ Stars", shortLabel: "4+" },
];

const noteOptions: Array<{ id: NoteFilter; label: string; shortLabel: string }> = [
  { id: "all", label: "Note: All", shortLabel: "All" },
  { id: "with", label: "Has Note", shortLabel: "Has" },
  { id: "without", label: "No Note", shortLabel: "None" },
];

const sourceOptions: Array<{ id: SourceFilter; label: string; shortLabel: string }> = [
  { id: "all", label: "Source: All", shortLabel: "All" },
  { id: "eagle", label: "Eagle", shortLabel: "Eagle" },
  { id: "manual", label: "Manual", shortLabel: "Manual" },
  { id: "youtube", label: "YouTube", shortLabel: "YouTube" },
];

const sortKeyOptions: Array<{ id: LibrarySortKey; label: string }> = [
  { id: "recent", label: "Recent" },
  { id: "lastUsed", label: "Last Used" },
  { id: "name", label: "Name" },
  { id: "rating", label: "Rating" },
  { id: "size", label: "Size" },
];

interface FilterChipProps<T extends string> {
  label: string;
  value: string;
  active: boolean;
  selectedId: T;
  options: Array<{ id: T; label: string }>;
  onChange: (value: T) => void;
}

function FilterChip<T extends string>({ label, value, active, selectedId, options, onChange }: FilterChipProps<T>) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("h-8 gap-1.5 px-2 text-[11px]", active && "border-primary/60 bg-primary/10 text-primary")}
          style={{ borderRadius: 0 }}
        >
          <span className="text-muted-foreground">{label}</span>
          <span>{value}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 rounded-none p-1">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className="flex w-full items-center justify-between px-2 py-1.5 text-left text-[12px] hover:bg-muted"
          >
            <span>{option.label}</span>
            {option.id === selectedId ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function LibraryToolbar({
  title,
  subtitle,
  query,
  onQueryChange,
  filteredCount,
  totalCount,
  isCapped,
  gridSize,
  onGridSizeChange,
  viewMode,
  onViewModeChange,
  kindFilter,
  onKindFilterChange,
  typeRows,
  activeTag,
  onTagChange,
  tagRows,
  ratingFilter,
  onRatingFilterChange,
  noteFilter,
  onNoteFilterChange,
  sourceFilter,
  onSourceFilterChange,
  sortKey,
  onSortKeyChange,
  sortOrder,
  onSortOrderChange,
  onClearFilters,
  selectedCount,
  storageUsageLabel,
  canExportProject,
  onRefreshStorageUsage,
  onCleanupOrphans,
  onImportPack,
  onExportSelected,
  onExportFiltered,
  onExportAll,
  onExportProject,
}: LibraryToolbarProps) {
  const typeValue = typeRows.find((row) => row.id === kindFilter)?.label ?? "All";
  const tagValue = activeTag ? activeTag.replace(/^folder:/, "") : "All";
  const ratingValue = ratingOptions.find((option) => option.id === ratingFilter)?.shortLabel ?? "All";
  const noteValue = noteOptions.find((option) => option.id === noteFilter)?.shortLabel ?? "All";
  const sourceValue = sourceOptions.find((option) => option.id === sourceFilter)?.shortLabel ?? "All";
  const sortValue = sortKeyOptions.find((option) => option.id === sortKey)?.label ?? "Recent";

  return (
    <div className="flex h-14 flex-shrink-0 items-center gap-3 border-b border-border-subtle bg-surface-nav px-4">
      <div className="min-w-[150px]">
        <div className="line-clamp-1 text-[12px] font-semibold text-foreground/90">{title}</div>
        {subtitle ? <div className="line-clamp-1 text-[10px] font-mono text-muted-foreground">{subtitle}</div> : null}
      </div>

      <div className="flex h-8 min-w-[220px] flex-1 items-center gap-2 border border-border-subtle bg-background px-3" style={{ borderRadius: 0 }}>
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search title, tags, notes, URL..."
          className="w-full border-none bg-transparent text-[12px] font-mono text-text-secondary outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className="hidden items-center gap-1 xl:flex">
        <FilterChip
          label="Types"
          value={typeValue}
          active={kindFilter !== "all"}
          selectedId={kindFilter}
          options={typeRows.map((row) => ({ id: row.id, label: `${row.label} (${row.count})` }))}
          onChange={onKindFilterChange}
        />
        <FilterChip
          label="Tags"
          value={tagValue}
          active={Boolean(activeTag)}
          selectedId={activeTag ?? ""}
          options={[{ id: "", label: "All Tags" }, ...tagRows.slice(0, 80).map((row) => ({ id: row.id, label: `${row.label} (${row.count})` }))]}
          onChange={(value) => onTagChange(value || null)}
        />
        <FilterChip
          label="Rating"
          value={ratingValue}
          active={ratingFilter !== "all"}
          selectedId={ratingFilter}
          options={ratingOptions}
          onChange={onRatingFilterChange}
        />
        <FilterChip
          label="Note"
          value={noteValue}
          active={noteFilter !== "all"}
          selectedId={noteFilter}
          options={noteOptions}
          onChange={onNoteFilterChange}
        />
        <FilterChip
          label="Source"
          value={sourceValue}
          active={sourceFilter !== "all"}
          selectedId={sourceFilter}
          options={sourceOptions}
          onChange={onSourceFilterChange}
        />
      </div>

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-8 px-2 text-[11px]" style={{ borderRadius: 0 }}>
              Sort: {sortValue} {sortOrder.toUpperCase()}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 rounded-none">
            {sortKeyOptions.map((option) => (
              <DropdownMenuItem key={option.id} onSelect={() => onSortKeyChange(option.id)}>
                <span className="flex-1">{option.label}</span>
                {sortKey === option.id ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onSortOrderChange(sortOrder === "asc" ? "desc" : "asc")}>
              Toggle {sortOrder === "asc" ? "Descending" : "Ascending"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="hidden items-center gap-2 text-[10px] font-mono text-muted-foreground lg:flex">
          <span>{filteredCount}</span>
          <span className="text-muted-foreground/40">/</span>
          <span>{totalCount}</span>
          {isCapped ? <span className="text-amber-500">capped</span> : null}
        </div>

        <div className="hidden items-center gap-1 border border-border-subtle bg-background px-2 py-1 lg:flex" style={{ borderRadius: 0 }}>
          <SlidersHorizontal className="h-3 w-3 text-muted-foreground" />
          <input
            aria-label="Grid zoom"
            type="range"
            min={140}
            max={260}
            step={20}
            value={gridSize}
            onChange={(event) => onGridSizeChange(Number(event.target.value))}
            className="w-20 accent-current"
          />
        </div>

        <div className="flex border border-border-subtle" style={{ borderRadius: 0 }}>
          <Button
            variant="ghost"
            className={cn("h-8 px-2", viewMode === "grid" && "bg-primary/10 text-primary")}
            style={{ borderRadius: 0 }}
            onClick={() => onViewModeChange("grid")}
          >
            <Grid2X2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            className={cn("h-8 px-2", viewMode === "list" && "bg-primary/10 text-primary")}
            style={{ borderRadius: 0 }}
            onClick={() => onViewModeChange("list")}
            title="List view is planned after grid polish"
          >
            <List className="h-3.5 w-3.5" />
          </Button>
        </div>

        <button
          type="button"
          onClick={onRefreshStorageUsage}
          className="hidden h-8 items-center gap-1.5 border border-border-subtle bg-background px-2 text-[10px] font-mono text-muted-foreground hover:text-foreground lg:flex"
          style={{ borderRadius: 0 }}
          title="Refresh storage usage"
        >
          <HardDrive className="h-3.5 w-3.5" />
          {storageUsageLabel ?? "Storage --"}
        </button>

        <Button variant="outline" className="hidden h-8 gap-1.5 px-2 text-[10px] lg:flex" style={{ borderRadius: 0 }} onClick={onCleanupOrphans}>
          <Trash2 className="h-3.5 w-3.5" />
          Cleanup
        </Button>
        <Button variant="outline" className="hidden h-8 gap-1.5 px-2 text-[10px] lg:flex" style={{ borderRadius: 0 }} onClick={onImportPack}>
          <PackageOpen className="h-3.5 w-3.5" />
          Import
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-8 gap-1.5 px-2 text-[10px]" style={{ borderRadius: 0 }}>
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 rounded-none">
            <DropdownMenuItem disabled={selectedCount === 0} onSelect={onExportSelected}>
              Selected ({selectedCount})
            </DropdownMenuItem>
            <DropdownMenuItem disabled={filteredCount === 0} onSelect={onExportFiltered}>
              Filtered ({filteredCount})
            </DropdownMenuItem>
            <DropdownMenuItem disabled={totalCount === 0} onSelect={onExportAll}>
              All active references
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!canExportProject} onSelect={onExportProject}>
              Project-linked refs
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onClearFilters}>Clear filters</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
