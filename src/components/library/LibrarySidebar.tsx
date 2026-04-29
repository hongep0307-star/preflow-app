import type { ReactNode } from "react";
import { Download, Folder, Pencil, Plus, Sparkles, Tags, Trash2 } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReferenceKind, SavedFilter } from "@/lib/referenceLibrary";

export type QuickFilter = "all" | "favorites" | "untagged" | "recentlyUsed" | "unclassified" | "duplicates" | "trash";

export interface LibraryFilterRow {
  id: string;
  label: string;
  count: number;
}

export interface LibraryFolderRow extends LibraryFilterRow {
  tag: string;
  depth: number;
}

interface LibrarySidebarProps {
  ingestSlot: ReactNode;
  quickFilter: QuickFilter;
  onQuickFilterChange: (filter: QuickFilter) => void;
  kindFilter: "all" | ReferenceKind;
  onKindFilterChange: (kind: "all" | ReferenceKind) => void;
  typeRows: Array<{ id: "all" | ReferenceKind; label: string; count: number }>;
  savedFilters: SavedFilter[];
  activeSavedFilterId: string | null;
  onSavedFilterChange: (id: string | null) => void;
  folderRows: LibraryFolderRow[];
  activeTag: string | null;
  onTagChange: (tag: string | null) => void;
  onCreateFolder?: (parentPath?: string) => void;
  onRenameFolder?: (row: LibraryFolderRow) => void;
  onDeleteFolder?: (row: LibraryFolderRow) => void;
  onExportFolder?: (row: LibraryFolderRow) => void;
  tagRows: LibraryFilterRow[];
}

const QUICK_FILTERS: Array<{ id: QuickFilter; label: string }> = [
  { id: "all", label: "All Items" },
  { id: "favorites", label: "Favorites" },
  { id: "untagged", label: "Untagged" },
  { id: "recentlyUsed", label: "Recently Used" },
  { id: "unclassified", label: "Unclassified" },
  { id: "duplicates", label: "Duplicate Candidates" },
  { id: "trash", label: "Trash" },
];

function SidebarSection({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center gap-1.5 px-2 text-[10px] font-mono tracking-[0.12em] text-muted-foreground">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {icon}
          <span>{title}</span>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function LibrarySidebar({
  ingestSlot,
  quickFilter,
  onQuickFilterChange,
  kindFilter,
  onKindFilterChange,
  typeRows,
  savedFilters,
  activeSavedFilterId,
  onSavedFilterChange,
  folderRows,
  activeTag,
  onTagChange,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onExportFolder,
  tagRows,
}: LibrarySidebarProps) {
  return (
    <aside className="flex h-full min-h-0 flex-col flex-shrink-0 border-r border-border-subtle bg-surface-sidebar" style={{ width: 260 }}>
      <div className="border-b border-border-subtle px-3 py-3">{ingestSlot}</div>

      <div className="flex-1 overflow-y-auto px-2 py-4">
        <SidebarSection title="QUICK FILTERS">
          <div className="space-y-1">
            {QUICK_FILTERS.map((row) => (
              <button
                key={row.id}
                onClick={() => onQuickFilterChange(row.id)}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2 text-[12px] border-l-2 transition-colors",
                  quickFilter === row.id
                    ? "border-l-primary bg-primary/10 text-foreground"
                    : "border-l-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40",
                )}
              >
                <span>{row.label}</span>
              </button>
            ))}
          </div>
        </SidebarSection>

        {savedFilters.length > 0 ? (
          <SidebarSection title="SMART FOLDERS" icon={<Sparkles className="h-3 w-3" />}>
            <div className="space-y-1">
              <button
                onClick={() => onSavedFilterChange(null)}
                className={cn(
                  "w-full px-3 py-2 text-left text-[12px] border-l-2",
                  activeSavedFilterId === null
                    ? "border-l-primary bg-primary/10 text-foreground"
                    : "border-l-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
              >
                None
              </button>
              {savedFilters.slice(0, 24).map((filter) => (
                <button
                  key={filter.id}
                  onClick={() => onSavedFilterChange(filter.id)}
                  className={cn(
                    "w-full px-3 py-2 text-left text-[12px] border-l-2",
                    activeSavedFilterId === filter.id
                      ? "border-l-primary bg-primary/10 text-foreground"
                      : "border-l-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                  )}
                >
                  <span className="line-clamp-1">{filter.name}</span>
                </button>
              ))}
            </div>
          </SidebarSection>
        ) : null}

        <SidebarSection
          title="FOLDERS"
          icon={<Folder className="h-3 w-3" />}
          action={(
            <Button
              type="button"
              variant="ghost"
              className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
              style={{ borderRadius: 0 }}
              onClick={() => onCreateFolder?.()}
              title="Create folder"
            >
              <Plus className="h-3 w-3" />
            </Button>
          )}
        >
          {folderRows.length > 0 ? (
            <div className="space-y-1">
              {folderRows.slice(0, 80).map((row) => (
                <ContextMenu key={row.tag}>
                  <ContextMenuTrigger asChild>
                    <button
                      onClick={() => onTagChange(activeTag === row.tag ? null : row.tag)}
                      className={cn(
                        "w-full flex items-center justify-between py-1.5 pr-2 text-left text-[11px] border-l-2 transition-colors",
                        activeTag === row.tag
                          ? "border-l-primary bg-primary/10 text-foreground"
                          : "border-l-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                      )}
                      style={{ paddingLeft: `${10 + Math.min(row.depth, 3) * 10}px` }}
                    >
                      <span className="line-clamp-1">{row.label}</span>
                      <span className="font-mono text-[9px] text-muted-foreground">{row.count}</span>
                    </button>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-52 rounded-none">
                    <ContextMenuItem onSelect={() => onCreateFolder?.(row.tag.replace(/^folder:/, ""))}>
                      <Plus className="mr-2 h-3.5 w-3.5" />
                      New subfolder...
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => onRenameFolder?.(row)}>
                      <Pencil className="mr-2 h-3.5 w-3.5" />
                      Rename...
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => onDeleteFolder?.(row)} className="text-destructive focus:text-destructive">
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      Delete folder...
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => onExportFolder?.(row)} disabled={row.count === 0}>
                      <Download className="mr-2 h-3.5 w-3.5" />
                      Export folder...
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </div>
          ) : (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">No folders yet</div>
          )}
        </SidebarSection>

        <SidebarSection title="ALL TAGS" icon={<Tags className="h-3 w-3" />}>
          <div className="space-y-1">
            {tagRows.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-muted-foreground">No tags yet</div>
            ) : (
              tagRows.slice(0, 60).map((row) => (
                <button
                  key={row.id}
                  onClick={() => onTagChange(activeTag === row.id ? null : row.id)}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-1.5 text-left text-[11px] border-l-2",
                    activeTag === row.id
                      ? "border-l-primary bg-primary/10 text-foreground"
                      : "border-l-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                  )}
                >
                  <span className="line-clamp-1">{row.label}</span>
                  <span className="font-mono text-[9px] text-muted-foreground">{row.count}</span>
                </button>
              ))
            )}
          </div>
        </SidebarSection>

        <SidebarSection title="TYPE">
          {typeRows.map((filter) => (
            <button
              key={filter.id}
              onClick={() => onKindFilterChange(filter.id)}
              className={cn(
                "w-full flex items-center justify-between px-3 py-2.5 text-[12px] border-l-2 transition-colors",
                kindFilter === filter.id
                  ? "border-l-primary bg-primary/10 text-foreground"
                  : "border-l-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40",
              )}
            >
              <span>{filter.label}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{filter.count}</span>
            </button>
          ))}
        </SidebarSection>
      </div>
    </aside>
  );
}
