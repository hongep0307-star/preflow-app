import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type MouseEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/common/BrandLogo";
import { EagleImportDialog } from "@/components/library/EagleImportDialog";
import { LibraryAddMenu } from "@/components/library/LibraryAddMenu";
import { LibraryPreviewPanel } from "@/components/library/LibraryPreviewPanel";
import {
  LibrarySidebar,
  type LibraryFilterRow,
  type LibraryFolderRow,
  type QuickFilter,
} from "@/components/library/LibrarySidebar";
import { DuplicateMergeDialog } from "@/components/library/DuplicateMergeDialog";
import { ExportPackDialog } from "@/components/library/ExportPackDialog";
import { FolderDeleteDialog } from "@/components/library/FolderDeleteDialog";
import { FolderEditDialog } from "@/components/library/FolderEditDialog";
import { FolderPickerDialog } from "@/components/library/FolderPickerDialog";
import { LibraryGrid } from "@/components/library/LibraryGrid";
import { LibraryInspector } from "@/components/library/LibraryInspector";
import { OrphanCleanupDialog } from "@/components/library/OrphanCleanupDialog";
import { PackImportDialog } from "@/components/library/PackImportDialog";
import { PasteUrlDialog } from "@/components/library/PasteUrlDialog";
import { PromoteToAssetDialog } from "@/components/library/PromoteToAssetDialog";
import { RenameReferenceDialog } from "@/components/library/RenameReferenceDialog";
import {
  LibraryToolbar,
  type LibrarySortKey,
  type LibrarySortOrder,
  type LibraryViewMode,
  type NoteFilter,
  type RatingFilter,
  type SourceFilter,
} from "@/components/library/LibraryToolbar";
import { useToast } from "@/hooks/use-toast";
import { importEagleLibrary, selectEagleLibrary, type EagleImportResult, type EaglePreview } from "@/lib/eagleImport";
import { addUserFolderPath, getUserFolderPaths, normalizeLibraryFolderPath, removeUserFolderPath, renameUserFolderPath } from "@/lib/folderCache";
import type { PackScope } from "@/lib/preflowPack";
import { acceptReferenceAiSuggestions, classifyReference, type ReferenceAiSuggestions } from "@/lib/referenceAi";
import { getStorageUsage, type StorageUsage } from "@/lib/storageMaintenance";
import { cn } from "@/lib/utils";
import {
  addReferencesToFolder,
  createLinkReference,
  deleteReference,
  deleteFolder,
  duplicateReference,
  folderTag,
  getReferenceUsageCounts,
  linkReferenceToProject,
  listSavedFilters,
  listReferences,
  mergeReferences,
  moveReferencesToFolder,
  moveReferenceToTrash,
  normalizeFolderPath,
  openReferenceWithDefaultApp,
  regenerateReferenceThumbnail,
  removeReferencesFromFolder,
  renameFolder,
  resolveReferenceFilePath,
  restoreReference,
  saveVideoFrameAsReference,
  setReferenceCoverFromVideo,
  showReferenceInFolder,
  toggleReferencePin,
  updateReference,
  uploadReferenceFile,
  type ReferenceItem,
  type ReferenceKind,
  type SavedFilter,
  type TimestampNote,
} from "@/lib/referenceLibrary";

const FILTERS: Array<{ id: "all" | ReferenceKind; label: string }> = [
  { id: "all", label: "All" },
  { id: "image", label: "Images" },
  { id: "webp", label: "WebP" },
  { id: "gif", label: "GIFs" },
  { id: "video", label: "Videos" },
  { id: "youtube", label: "YouTube" },
  { id: "link", label: "Links" },
];

const REFERENCE_LOAD_LIMIT = 10_000;

type UploadJob = {
  id: string;
  label: string;
  status: "uploading" | "done" | "failed";
  error?: string;
};

type ExportDialogState = {
  scope: PackScope;
  scopeLabel: string;
  ids?: string[];
  folderTag?: string;
  projectId?: string | null;
  itemCount: number;
} | null;

type FolderEditState = {
  mode: "create" | "rename";
  parentPath?: string | null;
  row?: LibraryFolderRow | null;
} | null;

type FolderPickerState = {
  mode: "add" | "move";
  item: ReferenceItem;
} | null;

type DuplicateMergeState = {
  keep: ReferenceItem;
  mergeItems: ReferenceItem[];
} | null;

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

function parseTags(value: string): string[] {
  return [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))];
}

function tagCounts(items: ReferenceItem[], predicate: (tag: string) => boolean): LibraryFilterRow[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.tags) {
      if (!predicate(tag)) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: id, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function folderRows(items: ReferenceItem[], userFolderPaths: string[] = []): LibraryFolderRow[] {
  const counts = new Map(tagCounts(items, (tag) => tag.startsWith("folder:")).map((row) => [row.id, row.count]));
  for (const path of userFolderPaths) {
    if (path) counts.set(folderTag(path), counts.get(folderTag(path)) ?? 0);
  }
  return [...counts.entries()]
    .map(([tag, count]) => {
      const path = tag.replace(/^folder:/, "");
      const parts = path.split("/").filter(Boolean);
      return {
        id: tag,
        count,
        tag,
        label: parts[parts.length - 1] ?? path,
        depth: Math.max(0, parts.length - 1),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function getSavedFilterTokens(filter: SavedFilter | null): string[] {
  if (!filter) return [];
  const queryText = JSON.stringify(filter.query ?? {}).toLowerCase();
  const tokens = new Set<string>();
  for (const match of queryText.matchAll(/"([^"]{2,80})"/g)) {
    const token = match[1].trim();
    if (!token || ["and", "or", "tags", "folders", "name", "ext", "kind", "type", "rule", "rules"].includes(token)) continue;
    tokens.add(token);
  }
  return [...tokens].slice(0, 16);
}

function matchesSavedFilter(item: ReferenceItem, filter: SavedFilter | null): boolean {
  const tokens = getSavedFilterTokens(filter);
  if (tokens.length === 0) return true;
  const haystack = [
    item.title,
    item.kind,
    item.mime_type,
    item.notes,
    item.source_url,
    ...item.tags,
  ].filter(Boolean).join(" ").toLowerCase();
  return tokens.some((token) => haystack.includes(token));
}

function getReturnTo(search: string): string {
  const params = new URLSearchParams(search);
  return params.get("returnTo") || sessionStorage.getItem("preflow.library.returnTo") || "/dashboard";
}

function getReturnProjectId(search: string): string | null {
  const returnTo = getReturnTo(search);
  const match = returnTo.match(/\/project\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

const LibraryPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const loadSeqRef = useRef(0);
  const [items, setItems] = useState<ReferenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [pasteUrlOpen, setPasteUrlOpen] = useState(false);
  const [eagleImportOpen, setEagleImportOpen] = useState(false);
  const [kindFilter, setKindFilter] = useState<"all" | ReferenceKind>("all");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [uploadJobs, setUploadJobs] = useState<UploadJob[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editSourceUrl, setEditSourceUrl] = useState("");
  const [editRating, setEditRating] = useState("0");
  const [timestampText, setTimestampText] = useState("");
  const [playbackRate, setPlaybackRate] = useState("1");
  const [saving, setSaving] = useState(false);
  const [eagleRoot, setEagleRoot] = useState("");
  const [eaglePreview, setEaglePreview] = useState<EaglePreview | null>(null);
  const [eagleResult, setEagleResult] = useState<EagleImportResult | null>(null);
  const [eagleBusy, setEagleBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [activeSavedFilterId, setActiveSavedFilterId] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("all");
  const [noteFilter, setNoteFilter] = useState<NoteFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [gridSize, setGridSize] = useState(() => Number(localStorage.getItem("preflow.library.gridSize")) || 180);
  const [viewMode, setViewMode] = useState<LibraryViewMode>("grid");
  const [sortKey, setSortKey] = useState<LibrarySortKey>(
    () => (localStorage.getItem("preflow.library.sortKey") as LibrarySortKey | null) ?? "recent",
  );
  const [sortOrder, setSortOrder] = useState<LibrarySortOrder>(
    () => (localStorage.getItem("preflow.library.sortOrder") as LibrarySortOrder | null) ?? "desc",
  );
  const [copiedTags, setCopiedTags] = useState<string[] | null>(null);
  const [usageCounts, setUsageCounts] = useState<Record<string, number>>({});
  const [promoteTarget, setPromoteTarget] = useState<ReferenceItem | null>(null);
  const [userFolderPaths, setUserFolderPaths] = useState<string[]>(() => getUserFolderPaths());
  const [exportDialog, setExportDialog] = useState<ExportDialogState>(null);
  const [importPackOpen, setImportPackOpen] = useState(false);
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [folderEdit, setFolderEdit] = useState<FolderEditState>(null);
  const [folderDeleteTarget, setFolderDeleteTarget] = useState<LibraryFolderRow | null>(null);
  const [folderPicker, setFolderPicker] = useState<FolderPickerState>(null);
  const [orphanCleanupOpen, setOrphanCleanupOpen] = useState(false);
  const [duplicateMerge, setDuplicateMerge] = useState<DuplicateMergeState>(null);
  const [renameTarget, setRenameTarget] = useState<ReferenceItem | null>(null);
  const [permanentDeleteTargets, setPermanentDeleteTargets] = useState<ReferenceItem[]>([]);

  const loadReferences = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      // Library page presents Trash as a quickFilter, so we need active+trashed
      // in a single in-memory list. ReferencePickerDrawer / Brief sync paths use
      // the default (trash-excluded) shape.
      const rows = await listReferences({ limit: REFERENCE_LOAD_LIMIT, includeTrashed: true });
      if (seq !== loadSeqRef.current) return;
      setItems(rows);
      setSelectedId((current) => {
        const next = current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? null;
        setSelectedIds(next ? new Set([next]) : new Set());
        setLastSelectedId(next);
        return next;
      });
      // Usage 집계는 best-effort — 실패해도 라이브러리 자체는 동작해야 한다.
      getReferenceUsageCounts(rows.map((row) => row.id))
        .then((counts) => {
          if (seq !== loadSeqRef.current) return;
          setUsageCounts(counts);
        })
        .catch((err) => {
          console.warn("[library] usage counts failed", err);
        });
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReferences();
    return () => {
      loadSeqRef.current += 1;
    };
  }, [loadReferences]);

  useEffect(() => {
    listSavedFilters()
      .then(setSavedFilters)
      .catch((err) => {
        console.warn("[library] saved filters failed to load", err);
      });
  }, []);

  const refreshStorageUsage = useCallback(async () => {
    try {
      setStorageUsage(await getStorageUsage());
    } catch (err) {
      console.warn("[library] storage usage failed", err);
    }
  }, []);

  useEffect(() => {
    void refreshStorageUsage();
  }, [refreshStorageUsage]);

  useEffect(() => {
    localStorage.setItem("preflow.library.gridSize", String(gridSize));
  }, [gridSize]);

  useEffect(() => {
    localStorage.setItem("preflow.library.sortKey", sortKey);
    localStorage.setItem("preflow.library.sortOrder", sortOrder);
  }, [sortKey, sortOrder]);

  useEffect(() => {
    const refresh = () => setUserFolderPaths(getUserFolderPaths());
    window.addEventListener("preflow-library-folders-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("preflow-library-folders-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const upsertUploadedItem = useCallback((item: ReferenceItem) => {
    setItems((current) => [item, ...current.filter((row) => row.id !== item.id)]);
    setSelectedId(item.id);
    setSelectedIds(new Set([item.id]));
    setLastSelectedId(item.id);
  }, []);

  const setJob = useCallback((id: string, patch: Partial<UploadJob>) => {
    setUploadJobs((current) => current.map((job) => (job.id === id ? { ...job, ...patch } : job)));
  }, []);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    const jobs = files.map((file) => ({
      id: `${file.name}_${file.size}_${file.lastModified}_${Math.random().toString(36).slice(2)}`,
      label: file.name,
      status: "uploading" as const,
    }));
    setUploadJobs((current) => [...jobs, ...current].slice(0, 8));

    let successCount = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const job = jobs[i];
      try {
        const item = await uploadReferenceFile(file);
        upsertUploadedItem(item);
        setJob(job.id, { status: "done" });
        successCount += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setJob(job.id, { status: "failed", error: message });
      }
    }

    if (successCount > 0) {
      toast({ title: "Reference saved", description: `${successCount} item${successCount > 1 ? "s" : ""} added to Library.` });
    }
  }, [setJob, toast, upsertUploadedItem]);

  const handleUrlSubmit = useCallback(async (event?: FormEvent) => {
    event?.preventDefault();
    const url = urlInput.trim();
    if (!url) return;
    const jobId = `url_${Date.now().toString(36)}`;
    setUploadJobs((current) => [{ id: jobId, label: url, status: "uploading" as const }, ...current].slice(0, 8));
    try {
      const item = await createLinkReference(url);
      upsertUploadedItem(item);
      setUrlInput("");
      setPasteUrlOpen(false);
      setJob(jobId, { status: "done" });
      toast({ title: "Reference saved", description: item.kind === "youtube" ? "YouTube reference added." : "Link reference added." });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setJob(jobId, { status: "failed", error: message });
      toast({ variant: "destructive", title: "URL save failed", description: message });
    }
  }, [setJob, toast, upsertUploadedItem, urlInput]);

  const handleDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer.files.length > 0) {
      void handleFiles(event.dataTransfer.files);
      return;
    }
    const text = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
    if (text.trim()) {
      const url = text.trim();
      const jobId = `url_${Date.now().toString(36)}`;
      setUploadJobs((current) => [{ id: jobId, label: url, status: "uploading" as const }, ...current].slice(0, 8));
      createLinkReference(url)
        .then((item) => {
          upsertUploadedItem(item);
          setJob(jobId, { status: "done" });
          toast({ title: "Reference saved", description: "Dropped URL added to Library." });
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          setJob(jobId, { status: "failed", error: message });
          toast({ variant: "destructive", title: "Drop failed", description: message });
        });
    }
  }, [handleFiles, setJob, toast, upsertUploadedItem]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length > 0) {
        event.preventDefault();
        void handleFiles(files);
        return;
      }
      const text = event.clipboardData?.getData("text/plain")?.trim();
      if (text && /^https?:\/\//i.test(text)) {
        event.preventDefault();
        const jobId = `url_${Date.now().toString(36)}`;
        setUploadJobs((current) => [{ id: jobId, label: text, status: "uploading" as const }, ...current].slice(0, 8));
        createLinkReference(text)
          .then((item) => {
            upsertUploadedItem(item);
            setJob(jobId, { status: "done" });
            toast({ title: "Reference saved", description: "Pasted URL added to Library." });
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            setJob(jobId, { status: "failed", error: message });
            toast({ variant: "destructive", title: "Paste failed", description: message });
          });
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handleFiles, setJob, toast, upsertUploadedItem]);

  const activeSavedFilter = useMemo(
    () => savedFilters.find((filter) => filter.id === activeSavedFilterId) ?? null,
    [activeSavedFilterId, savedFilters],
  );

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const result = items.filter((item) => {
      if (quickFilter === "trash") {
        if (!item.deleted_at) return false;
      } else if (item.deleted_at) {
        return false;
      }
      if (kindFilter !== "all" && item.kind !== kindFilter) return false;
      if (quickFilter === "favorites" && !item.is_favorite) return false;
      if (quickFilter === "untagged" && item.tags.length > 0) return false;
      if (quickFilter === "recentlyUsed" && !item.last_used_at) return false;
      if (quickFilter === "unclassified" && item.classification_status !== "unclassified") return false;
      if (quickFilter === "duplicates" && (!item.content_hash || items.filter((row) => row.content_hash === item.content_hash).length < 2)) return false;
      if (activeTag && !item.tags.includes(activeTag)) return false;
      if (activeSavedFilter && !matchesSavedFilter(item, activeSavedFilter)) return false;
      if (ratingFilter === "rated" && !item.rating) return false;
      if (ratingFilter === "unrated" && item.rating) return false;
      if (ratingFilter === "fourPlus" && (item.rating ?? 0) < 4) return false;
      if (noteFilter === "with" && !item.notes?.trim()) return false;
      if (noteFilter === "without" && item.notes?.trim()) return false;
      if (sourceFilter === "eagle" && item.source_app !== "eagle") return false;
      if (sourceFilter === "manual" && item.source_app) return false;
      if (sourceFilter === "youtube" && item.kind !== "youtube") return false;
      if (!q) return true;
      return [item.title, item.notes, item.source_url, ...item.tags]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    if (quickFilter === "recentlyUsed") {
      return [...result].sort((a, b) => new Date(b.last_used_at ?? 0).getTime() - new Date(a.last_used_at ?? 0).getTime());
    }
    // 사용자가 선택한 정렬 키를 적용. 핀고정은 어떤 키를 골라도 항상 위로
    // 끌어올린다 — 핀은 "이 항목을 절대 시야에서 놓치지 마" 의도라서 정렬과
    // 직교하는 강한 신호.
    const orderMul = sortOrder === "asc" ? 1 : -1;
    const cmp = (a: ReferenceItem, b: ReferenceItem): number => {
      const pinA = a.pinned_at ? 1 : 0;
      const pinB = b.pinned_at ? 1 : 0;
      if (pinA !== pinB) return pinB - pinA;
      switch (sortKey) {
        case "name": {
          return a.title.localeCompare(b.title) * orderMul;
        }
        case "rating": {
          return ((a.rating ?? 0) - (b.rating ?? 0)) * orderMul;
        }
        case "size": {
          return ((a.file_size ?? 0) - (b.file_size ?? 0)) * orderMul;
        }
        case "lastUsed": {
          const ta = new Date(a.last_used_at ?? 0).getTime();
          const tb = new Date(b.last_used_at ?? 0).getTime();
          return (ta - tb) * orderMul;
        }
        case "recent":
        default: {
          const ta = new Date(a.created_at ?? 0).getTime();
          const tb = new Date(b.created_at ?? 0).getTime();
          return (ta - tb) * orderMul;
        }
      }
    };
    return [...result].sort(cmp);
  }, [activeSavedFilter, activeTag, items, kindFilter, noteFilter, query, quickFilter, ratingFilter, sortKey, sortOrder, sourceFilter]);

  const selectedFromAll = selectedId ? items.find((item) => item.id === selectedId) ?? null : null;
  const selected = selectedId ? filteredItems.find((item) => item.id === selectedId) ?? null : null;
  const selectedItems = useMemo(
    () => filteredItems.filter((item) => selectedIds.has(item.id)),
    [filteredItems, selectedIds],
  );
  const selectedHiddenByFilters = Boolean(selectedFromAll && !selected);
  const selectedSuggestions = selected?.ai_suggestions as Partial<ReferenceAiSuggestions> | undefined;
  const duplicateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (!item.content_hash) continue;
      counts.set(item.content_hash, (counts.get(item.content_hash) ?? 0) + 1);
    }
    return counts;
  }, [items]);
  const selectedDuplicateCount = selected?.content_hash ? duplicateCounts.get(selected.content_hash) ?? 0 : 0;
  const selectedRegularTags = selected?.tags.filter((tag) => !tag.startsWith("folder:")) ?? [];
  const selectedFolderTags = selected?.tags.filter((tag) => tag.startsWith("folder:")) ?? [];
  const activeItems = useMemo(() => items.filter((item) => !item.deleted_at), [items]);
  const counts = useMemo(() => {
    return activeItems.reduce<Record<"all" | ReferenceKind, number>>(
      (acc, item) => {
        acc.all += 1;
        acc[item.kind] += 1;
        return acc;
      },
      { all: 0, image: 0, webp: 0, gif: 0, video: 0, youtube: 0, link: 0 },
    );
  }, [activeItems]);
  const typeRows = useMemo(
    () => FILTERS.map((filter) => ({ ...filter, count: counts[filter.id] })),
    [counts],
  );
  const folders = useMemo(() => folderRows(activeItems, userFolderPaths), [activeItems, userFolderPaths]);
  const tagsList = useMemo(
    () => tagCounts(activeItems, (tag) => !tag.startsWith("folder:") && !tag.startsWith("source:")),
    [activeItems],
  );
  const toolbarTitle = activeTag?.startsWith("folder:")
    ? activeTag.replace(/^folder:/, "")
    : activeTag ?? activeSavedFilter?.name ?? (quickFilter === "trash" ? "Trash" : "All References");
  const toolbarSubtitle = activeSavedFilter
    ? "Smart folder matching imported metadata"
    : quickFilter === "trash"
      ? "Soft-deleted references"
      : activeTag
      ? "Tag filter"
      : "Global Reference Library";
  const returnProjectId = useMemo(() => getReturnProjectId(location.search), [location.search]);
  const storageUsageLabel = storageUsage ? formatBytes(storageUsage.total_bytes) : undefined;

  useEffect(() => {
    if (!selected) {
      setEditTitle("");
      setEditTags("");
      setEditNotes("");
      setEditSourceUrl("");
      setEditRating("0");
      setTimestampText("");
      return;
    }
    setEditTitle(selected.title);
    setEditTags(selected.tags.join(", "));
    setEditNotes(selected.notes ?? "");
    setEditSourceUrl(selected.source_url ?? "");
    setEditRating(String(selected.rating ?? 0));
    setTimestampText("");
  }, [selected?.id, selected]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = Number(playbackRate);
  }, [playbackRate, selected?.id]);

  useEffect(() => {
    if (!selected) setPreviewMode(false);
  }, [selected]);

  const replaceItem = useCallback((next: ReferenceItem) => {
    setItems((current) => current.map((item) => (item.id === next.id ? next : item)));
    setSelectedId(next.id);
    setSelectedIds((current) => {
      const updated = new Set(current);
      if (updated.size === 0) updated.add(next.id);
      return updated;
    });
    setLastSelectedId(next.id);
  }, []);

  const handleSaveMetadata = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const rating = Math.max(0, Math.min(5, Number(editRating) || 0));
      const next = await updateReference(selected.id, {
        title: editTitle,
        tags: parseTags(editTags),
        notes: editNotes.trim() || null,
        source_url: editSourceUrl.trim() || null,
        rating: rating > 0 ? rating : null,
      });
      replaceItem(next);
      toast({ title: "Reference updated", description: "Tags, notes, and rating were saved." });
    } catch (err) {
      toast({ variant: "destructive", title: "Save failed", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }, [editNotes, editRating, editSourceUrl, editTags, editTitle, replaceItem, selected, toast]);

  const handleCopyText = useCallback(async (value: string, label: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    toast({ title: `${label} copied`, description: value });
  }, [toast]);

  const handleToggleFavorite = useCallback(async () => {
    if (!selected) return;
    const next = await updateReference(selected.id, { is_favorite: !selected.is_favorite });
    replaceItem(next);
  }, [replaceItem, selected]);

  const handleTogglePin = useCallback(async (item: ReferenceItem) => {
    const next = await toggleReferencePin(item);
    replaceItem(next);
    toast({ title: next.pinned_at ? "Pinned to top" : "Unpinned", description: next.title });
  }, [replaceItem, toast]);

  const selectedIdsForItem = useCallback((item: ReferenceItem): string[] => {
    return selectedIds.has(item.id) ? [...selectedIds] : [item.id];
  }, [selectedIds]);

  const permanentlyDeleteItems = useCallback(async (targets: ReferenceItem[]) => {
    if (targets.length === 0) return;
    const targetIds = new Set(targets.map((item) => item.id));
    for (const item of targets) {
      await deleteReference(item.id);
    }
    setItems((current) => current.filter((item) => !targetIds.has(item.id)));
    setSelectedId(null);
    setSelectedIds(new Set());
    setLastSelectedId(null);
    toast({
      title: targets.length === 1 ? "Reference permanently deleted" : "References permanently deleted",
      description: `${targets.length} reference${targets.length === 1 ? "" : "s"} and stored file(s) were removed.`,
    });
  }, [toast]);

  const handleDeleteSelected = useCallback(async () => {
    const targets = selectedItems.length > 1 ? selectedItems : selected ? [selected] : [];
    if (targets.length === 0) return;
    if (targets.every((item) => item.deleted_at)) {
      await permanentlyDeleteItems(targets);
      return;
    }
    const activeTargets = targets.filter((item) => !item.deleted_at);
    const updated: ReferenceItem[] = [];
    for (const item of activeTargets) {
      updated.push(await moveReferenceToTrash(item.id));
    }
    setItems((current) => current.map((item) => updated.find((next) => next.id === item.id) ?? item));
    setSelectedId(null);
    setSelectedIds(new Set());
    setLastSelectedId(null);
    toast({
      title: activeTargets.length === 1 ? "Moved to Trash" : "Moved references to Trash",
      description: `${activeTargets.length} reference${activeTargets.length === 1 ? "" : "s"} can be restored from Trash.`,
    });
  }, [permanentlyDeleteItems, selected, selectedItems, toast]);

  const handleMoveToTrash = useCallback(async (item: ReferenceItem) => {
    const ids = selectedIdsForItem(item);
    const targets = items.filter((row) => ids.includes(row.id) && !row.deleted_at);
    const updated: ReferenceItem[] = [];
    for (const target of targets) {
      updated.push(await moveReferenceToTrash(target.id));
    }
    setItems((current) => current.map((row) => updated.find((next) => next.id === row.id) ?? row));
    setSelectedId(null);
    setSelectedIds(new Set());
    setLastSelectedId(null);
    toast({
      title: targets.length === 1 ? "Moved to Trash" : "Moved references to Trash",
      description: `${targets.length} reference${targets.length === 1 ? "" : "s"} can be restored from Trash.`,
    });
  }, [items, selectedIdsForItem, toast]);

  const handleRestoreReference = useCallback(async (item: ReferenceItem) => {
    const ids = selectedIdsForItem(item);
    const targets = items.filter((row) => ids.includes(row.id) && row.deleted_at);
    const updated: ReferenceItem[] = [];
    for (const target of targets) {
      updated.push(await restoreReference(target.id));
    }
    setItems((current) => current.map((row) => updated.find((next) => next.id === row.id) ?? row));
    setSelectedId(null);
    setSelectedIds(new Set());
    setLastSelectedId(null);
    toast({
      title: targets.length === 1 ? "Reference restored" : "References restored",
      description: `${targets.length} reference${targets.length === 1 ? "" : "s"} restored to the library.`,
    });
  }, [items, selectedIdsForItem, toast]);

  const handleRestoreSelected = useCallback(async () => {
    const targets = (selectedItems.length > 1 ? selectedItems : selected ? [selected] : []).filter((item) => item.deleted_at);
    if (targets.length === 0) return;
    const updated: ReferenceItem[] = [];
    for (const target of targets) {
      updated.push(await restoreReference(target.id));
    }
    setItems((current) => current.map((row) => updated.find((next) => next.id === row.id) ?? row));
    setSelectedId(null);
    setSelectedIds(new Set());
    setLastSelectedId(null);
    toast({
      title: targets.length === 1 ? "Reference restored" : "References restored",
      description: `${targets.length} reference${targets.length === 1 ? "" : "s"} restored to the library.`,
    });
  }, [selected, selectedItems, toast]);

  const handlePermanentlyDelete = useCallback((item: ReferenceItem) => {
    const ids = selectedIdsForItem(item);
    const targets = items.filter((row) => ids.includes(row.id) && row.deleted_at);
    setPermanentDeleteTargets(targets.length > 0 ? targets : [item]);
  }, [items, selectedIdsForItem]);

  const confirmPermanentDelete = useCallback(async () => {
    const targets = permanentDeleteTargets;
    setPermanentDeleteTargets([]);
    await permanentlyDeleteItems(targets);
  }, [permanentDeleteTargets, permanentlyDeleteItems]);

  const handleOpenDefault = useCallback(async (item: ReferenceItem) => {
    try {
      await openReferenceWithDefaultApp(item);
    } catch (err) {
      toast({ variant: "destructive", title: "Open failed", description: err instanceof Error ? err.message : String(err) });
    }
  }, [toast]);

  const handleShowInFolder = useCallback(async (item: ReferenceItem) => {
    try {
      await showReferenceInFolder(item);
    } catch (err) {
      toast({ variant: "destructive", title: "Show in folder failed", description: err instanceof Error ? err.message : String(err) });
    }
  }, [toast]);

  const handleCopyFilePath = useCallback(async (item: ReferenceItem) => {
    try {
      const filePath = await resolveReferenceFilePath(item);
      await navigator.clipboard.writeText(filePath);
      toast({ title: "File path copied", description: filePath });
    } catch (err) {
      toast({ variant: "destructive", title: "Copy path failed", description: err instanceof Error ? err.message : String(err) });
    }
  }, [toast]);

  const handleCopyTags = useCallback((item: ReferenceItem) => {
    setCopiedTags(item.tags);
    toast({ title: "Tags copied", description: `${item.tags.length} tag${item.tags.length === 1 ? "" : "s"} copied.` });
  }, [toast]);

  const handlePasteTags = useCallback(async (item: ReferenceItem) => {
    if (!copiedTags) return;
    const next = await updateReference(item.id, { tags: [...new Set([...item.tags, ...copiedTags])] });
    replaceItem(next);
    toast({ title: "Tags pasted", description: next.title });
  }, [copiedTags, replaceItem, toast]);

  const handleDuplicateReference = useCallback(async (item: ReferenceItem) => {
    try {
      const next = await duplicateReference(item);
      upsertUploadedItem(next);
      toast({ title: "Reference duplicated", description: next.title });
    } catch (err) {
      toast({ variant: "destructive", title: "Duplicate failed", description: err instanceof Error ? err.message : String(err) });
    }
  }, [toast, upsertUploadedItem]);

  const handleMergeDuplicates = useCallback(async (item: ReferenceItem) => {
    const ids = selectedIdsForItem(item);
    const mergeIds = ids.filter((id) => id !== item.id);
    if (mergeIds.length === 0) return;
    const selectedMergeItems = items.filter((row) => ids.includes(row.id));
    if (!item.content_hash || selectedMergeItems.some((row) => row.content_hash !== item.content_hash)) {
      toast({ variant: "destructive", title: "Merge unavailable", description: "Select duplicates with the same content hash." });
      return;
    }
    setDuplicateMerge({
      keep: item,
      mergeItems: selectedMergeItems.filter((row) => row.id !== item.id),
    });
  }, [items, selectedIdsForItem, toast]);

  const confirmDuplicateMerge = useCallback(async () => {
    if (!duplicateMerge) return;
    try {
      const result = await mergeReferences(duplicateMerge.keep.id, duplicateMerge.mergeItems.map((mergeItem) => mergeItem.id));
      setItems((current) => current.map((row) => {
        if (row.id === result.keep.id) return result.keep;
        return result.trashed.find((trashed) => trashed.id === row.id) ?? row;
      }));
      setSelectedIds(new Set([result.keep.id]));
      setSelectedId(result.keep.id);
      toast({ title: "Duplicates merged", description: `${result.trashed.length} duplicate(s) moved to Trash.` });
    } catch (err) {
      toast({ variant: "destructive", title: "Merge failed", description: err instanceof Error ? err.message : String(err) });
    }
  }, [duplicateMerge, toast]);

  const handleRenameReference = useCallback(async (item: ReferenceItem) => {
    setRenameTarget(item);
  }, []);

  const confirmRenameReference = useCallback(async (title: string) => {
    if (!renameTarget || title === renameTarget.title) return;
    try {
      const next = await updateReference(renameTarget.id, { title });
      replaceItem(next);
      toast({ title: "Reference renamed", description: next.title });
    } catch (err) {
      toast({ variant: "destructive", title: "Rename failed", description: err instanceof Error ? err.message : String(err) });
    }
  }, [renameTarget, replaceItem, toast]);

  const handleSearchByImage = useCallback((item: ReferenceItem) => {
    const url = item.thumbnail_url || item.file_url || item.source_url;
    if (!url || /^https?:\/\/(?:127\.0\.0\.1|localhost):/i.test(url) || url.startsWith("local-file://")) {
      toast({ variant: "destructive", title: "Search unavailable", description: "External image search needs a public image URL." });
      return;
    }
    window.open(`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(url)}`, "_blank", "noopener,noreferrer");
  }, [toast]);

  const handleClassifyReference = useCallback(async (item: ReferenceItem) => {
    setSelectedId(item.id);
    setAiBusy(true);
    try {
      const next = await classifyReference(item);
      replaceItem(next);
      toast({ title: "AI classification ready", description: "Review the suggestions before applying them." });
    } catch (err) {
      toast({ variant: "destructive", title: "AI classify failed", description: err instanceof Error ? err.message : String(err) });
      loadReferences();
    } finally {
      setAiBusy(false);
    }
  }, [loadReferences, replaceItem, toast]);

  const handleRegenerateThumbnail = useCallback(async (item: ReferenceItem) => {
    try {
      const next = await regenerateReferenceThumbnail(item);
      replaceItem(next);
      toast({ title: "Thumbnail regenerated", description: next.title });
    } catch (err) {
      toast({ variant: "destructive", title: "Thumbnail failed", description: err instanceof Error ? err.message : String(err) });
    }
  }, [replaceItem, toast]);

  const handleAddToProjectTarget = useCallback(async (item: ReferenceItem, target: "brief" | "agent" | "conti") => {
    if (!returnProjectId) {
      toast({ variant: "destructive", title: "No active project", description: "Open Library from a project before adding references." });
      return;
    }
    if (item.kind === "link") {
      toast({ variant: "destructive", title: "Cannot add link", description: "Project import currently accepts images, GIFs, videos, and YouTube references." });
      return;
    }
    try {
      await linkReferenceToProject({
        projectId: returnProjectId,
        referenceId: item.id,
        target,
      });
      const label = target === "brief" ? "Brief" : target === "agent" ? "Agent" : "Conti";
      toast({ title: `Added to ${label}`, description: `${item.title} will appear in the project's ${label} references.` });
    } catch (err) {
      toast({ variant: "destructive", title: `Add to ${target} failed`, description: err instanceof Error ? err.message : String(err) });
    }
  }, [returnProjectId, toast]);

  const handleAddToBrief = useCallback((item: ReferenceItem) => {
    void handleAddToProjectTarget(item, "brief");
  }, [handleAddToProjectTarget]);

  const handleAddToAgent = useCallback((item: ReferenceItem) => {
    void handleAddToProjectTarget(item, "agent");
  }, [handleAddToProjectTarget]);

  const handleAddToConti = useCallback((item: ReferenceItem) => {
    void handleAddToProjectTarget(item, "conti");
  }, [handleAddToProjectTarget]);

  const handleOpenPromoteDialog = useCallback((item: ReferenceItem) => {
    if (!returnProjectId) {
      toast({ variant: "destructive", title: "No active project", description: "Open Library from a project before promoting a reference." });
      return;
    }
    if (item.kind !== "image" && item.kind !== "webp" && item.kind !== "gif") {
      toast({ variant: "destructive", title: "Cannot promote", description: "Only image / webp / gif references can be promoted to assets." });
      return;
    }
    if (!item.file_url) {
      toast({ variant: "destructive", title: "Cannot promote", description: "This reference has no stored file." });
      return;
    }
    setPromoteTarget(item);
  }, [returnProjectId, toast]);

  const handlePromoteCompleted = useCallback((result: { assetId: string; reference: ReferenceItem }) => {
    replaceItem(result.reference);
    toast({
      title: "Asset created",
      description: `New asset linked back to "${result.reference.title}". The Library entry stays in place.`,
    });
  }, [replaceItem, toast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "Escape" && previewMode) {
        event.preventDefault();
        setPreviewMode(false);
      } else if (event.key === "Enter" && selected) {
        event.preventDefault();
        setPreviewMode(true);
      } else if (event.key === "Delete" && selected) {
        event.preventDefault();
        const targets = selectedItems.length > 1 ? selectedItems : [selected];
        if (targets.every((item) => item.deleted_at)) {
          setPermanentDeleteTargets(targets);
        } else {
          void handleDeleteSelected();
        }
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d" && selected) {
        event.preventDefault();
        void handleDuplicateReference(selected);
      } else if (event.key === "F2" && selected) {
        event.preventDefault();
        void handleRenameReference(selected);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleDeleteSelected, handleDuplicateReference, handleRenameReference, previewMode, selected, selectedItems]);

  const handleAddTimestampNote = useCallback(async () => {
    if (!selected || selected.kind !== "video") return;
    const text = timestampText.trim();
    if (!text) return;
    const atSec = videoRef.current?.currentTime;
    const note: TimestampNote = {
      id: crypto.randomUUID().replace(/-/g, ""),
      atSec: Number.isFinite(atSec) ? atSec : undefined,
      text,
    };
    const next = await updateReference(selected.id, {
      timestamp_notes: [...selected.timestamp_notes, note],
    });
    replaceItem(next);
    setTimestampText("");
  }, [replaceItem, selected, timestampText]);

  const handleSetCover = useCallback(async () => {
    if (!selected || !videoRef.current) return;
    setSaving(true);
    try {
      const next = await setReferenceCoverFromVideo(selected, videoRef.current);
      replaceItem(next);
      toast({ title: "Cover updated", description: "Current video frame is now the reference cover." });
    } catch (err) {
      toast({ variant: "destructive", title: "Cover failed", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }, [replaceItem, selected, toast]);

  const handleSaveFrame = useCallback(async () => {
    if (!selected || !videoRef.current) return;
    setSaving(true);
    try {
      const frame = await saveVideoFrameAsReference(selected, videoRef.current);
      upsertUploadedItem(frame);
      toast({ title: "Frame saved", description: "Current video frame was saved as a new image reference." });
    } catch (err) {
      toast({ variant: "destructive", title: "Frame save failed", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }, [selected, toast, upsertUploadedItem]);

  const handleSelectEagle = useCallback(async () => {
    setEagleBusy(true);
    setEagleResult(null);
    try {
      const result = await selectEagleLibrary();
      if (!result.canceled && result.rootPath && result.preview) {
        setEagleRoot(result.rootPath);
        setEaglePreview(result.preview);
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Eagle preview failed", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setEagleBusy(false);
    }
  }, [toast]);

  const handleImportEagle = useCallback(async () => {
    if (!eagleRoot) return;
    setEagleBusy(true);
    setEagleResult(null);
    try {
      const result = await importEagleLibrary(eagleRoot);
      setEagleResult(result);
      toast({ title: "Eagle import complete", description: `${result.imported} imported, ${result.skipped} skipped.` });
      loadReferences();
    } catch (err) {
      toast({ variant: "destructive", title: "Eagle import failed", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setEagleBusy(false);
    }
  }, [eagleRoot, loadReferences, toast]);

  const handleClassifySelected = useCallback(async () => {
    if (!selected) return;
    setAiBusy(true);
    try {
      const next = await classifyReference(selected);
      replaceItem(next);
      toast({ title: "AI classification ready", description: "Review the suggestions before applying them." });
    } catch (err) {
      toast({ variant: "destructive", title: "AI classify failed", description: err instanceof Error ? err.message : String(err) });
      loadReferences();
    } finally {
      setAiBusy(false);
    }
  }, [loadReferences, replaceItem, selected, toast]);

  const handleAcceptSuggestions = useCallback(async () => {
    if (!selected) return;
    setAiBusy(true);
    try {
      const next = await acceptReferenceAiSuggestions(selected);
      replaceItem(next);
      toast({ title: "AI suggestions applied", description: "Suggested tags and notes were merged into the reference." });
    } catch (err) {
      toast({ variant: "destructive", title: "Accept failed", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setAiBusy(false);
    }
  }, [replaceItem, selected, toast]);

  const clearFilters = useCallback(() => {
    setQuery("");
    setKindFilter("all");
    setQuickFilter("all");
    setActiveSavedFilterId(null);
    setActiveTag(null);
    setRatingFilter("all");
    setNoteFilter("all");
    setSourceFilter("all");
  }, []);

  const handleSelectGridItem = useCallback((id: string, event?: MouseEvent<HTMLElement>) => {
    const isContextMenu = event?.type === "contextmenu";
    if (isContextMenu && selectedIds.has(id)) {
      setSelectedId(id);
      return;
    }
    if (event?.shiftKey && lastSelectedId) {
      const start = filteredItems.findIndex((item) => item.id === lastSelectedId);
      const end = filteredItems.findIndex((item) => item.id === id);
      if (start >= 0 && end >= 0) {
        const [from, to] = start < end ? [start, end] : [end, start];
        const range = filteredItems.slice(from, to + 1).map((item) => item.id);
        setSelectedIds(new Set(range));
        setSelectedId(id);
        return;
      }
    }
    if (event?.metaKey || event?.ctrlKey) {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        if (next.size === 0) {
          setSelectedId(null);
          setLastSelectedId(null);
        } else {
          setSelectedId(id);
          setLastSelectedId(id);
        }
        return next;
      });
      return;
    }
    setSelectedIds(new Set([id]));
    setSelectedId(id);
    setLastSelectedId(id);
  }, [filteredItems, lastSelectedId, selectedIds]);

  const handlePreviewSelect = useCallback((id: string) => {
    setSelectedIds(new Set([id]));
    setSelectedId(id);
    setLastSelectedId(id);
  }, []);

  const handleGridDoubleClick = useCallback((id: string) => {
    handlePreviewSelect(id);
    setPreviewMode(true);
  }, [handlePreviewSelect]);

  const handleMarqueeSelect = useCallback((ids: string[], mode: "replace" | "add") => {
    const orderedIds = filteredItems.map((item) => item.id).filter((id) => ids.includes(id));
    if (mode === "add") {
      setSelectedIds((current) => {
        const next = new Set(current);
        orderedIds.forEach((id) => next.add(id));
        const primary = orderedIds[orderedIds.length - 1] ?? selectedId;
        if (primary) {
          setSelectedId(primary);
          setLastSelectedId(primary);
        }
        return next;
      });
      return;
    }
    const next = new Set(orderedIds);
    const primary = orderedIds[orderedIds.length - 1] ?? null;
    setSelectedIds(next);
    setSelectedId(primary);
    setLastSelectedId(primary);
  }, [filteredItems, selectedId]);

  const folderCount = useCallback((tag: string): number => {
    return activeItems.filter((item) => item.tags.some((candidate) => candidate === tag || candidate.startsWith(`${tag}/`))).length;
  }, [activeItems]);

  const handleCreateFolder = useCallback((parentPath?: string) => {
    setFolderEdit({ mode: "create", parentPath: parentPath ?? null });
  }, []);

  const confirmCreateFolder = useCallback((path: string) => {
    addUserFolderPath(path);
    setUserFolderPaths(getUserFolderPaths());
    toast({ title: "Folder created", description: path });
  }, [toast]);

  const handleRenameFolder = useCallback((row: LibraryFolderRow) => {
    setFolderEdit({ mode: "rename", row });
  }, []);

  const confirmRenameFolder = useCallback(async (newPath: string) => {
    const row = folderEdit?.row;
    if (!row) return;
    const oldPath = normalizeFolderPath(row.tag);
    if (!newPath || newPath === oldPath) return;
    try {
      const result = await renameFolder(oldPath, newPath);
      renameUserFolderPath(oldPath, newPath);
      setUserFolderPaths(getUserFolderPaths());
      setItems((current) => current.map((item) => result.items.find((updated) => updated.id === item.id) ?? item));
      if (activeTag === folderTag(oldPath)) setActiveTag(folderTag(newPath));
      toast({ title: "Folder renamed", description: `${result.updated} reference(s) updated.` });
    } catch (err) {
      toast({ variant: "destructive", title: "Rename failed", description: err instanceof Error ? err.message : String(err) });
    }
  }, [activeTag, folderEdit, toast]);

  const handleDeleteFolder = useCallback((row: LibraryFolderRow) => {
    setFolderDeleteTarget(row);
  }, []);

  const confirmDeleteFolder = useCallback(async (opts: { mode: "removeTagOnly" | "trashItems"; recursive: boolean }) => {
    const row = folderDeleteTarget;
    if (!row) return;
    const folderPath = normalizeFolderPath(row.tag);
    try {
      const result = await deleteFolder(folderPath, opts);
      removeUserFolderPath(folderPath);
      setUserFolderPaths(getUserFolderPaths());
      setItems((current) => current.map((item) => result.items.find((updated) => updated.id === item.id) ?? item));
      if (activeTag === row.tag || activeTag?.startsWith(`${row.tag}/`)) setActiveTag(null);
      toast({ title: opts.mode === "trashItems" ? "Folder moved to Trash" : "Folder removed", description: `${result.affected} reference(s) affected.` });
    } catch (err) {
      toast({ variant: "destructive", title: "Delete folder failed", description: err instanceof Error ? err.message : String(err) });
    }
  }, [activeTag, folderDeleteTarget, toast]);

  const applyUpdatedItems = useCallback((updated: ReferenceItem[]) => {
    setItems((current) => current.map((item) => updated.find((next) => next.id === item.id) ?? item));
  }, []);

  const handleAddToFolder = useCallback(async (item: ReferenceItem) => {
    setFolderPicker({ mode: "add", item });
  }, []);

  const handleMoveToFolder = useCallback(async (item: ReferenceItem) => {
    setFolderPicker({ mode: "move", item });
  }, []);

  const confirmPickFolder = useCallback(async (path: string) => {
    if (!folderPicker) return;
    try {
      addUserFolderPath(path);
      const ids = selectedIdsForItem(folderPicker.item);
      const updated = folderPicker.mode === "add"
        ? await addReferencesToFolder(ids, path)
        : await moveReferencesToFolder(ids, path);
      applyUpdatedItems(updated);
      setUserFolderPaths(getUserFolderPaths());
      toast({
        title: folderPicker.mode === "add" ? "Added to folder" : "Moved to folder",
        description: `${updated.length} reference(s) ${folderPicker.mode === "add" ? "added to" : "moved to"} ${path}.`,
      });
    } catch (err) {
      toast({ variant: "destructive", title: "Folder update failed", description: err instanceof Error ? err.message : String(err) });
    }
  }, [applyUpdatedItems, folderPicker, selectedIdsForItem, toast]);

  const handleRemoveFromActiveFolder = useCallback(async (item: ReferenceItem) => {
    if (!activeTag?.startsWith("folder:")) return;
    try {
      const updated = await removeReferencesFromFolder(selectedIdsForItem(item), activeTag);
      applyUpdatedItems(updated);
      toast({ title: "Removed from folder", description: `${updated.length} reference(s) updated.` });
    } catch (err) {
      toast({ variant: "destructive", title: "Remove failed", description: err instanceof Error ? err.message : String(err) });
    }
  }, [activeTag, applyUpdatedItems, selectedIdsForItem, toast]);

  const openExportDialog = useCallback((config: ExportDialogState) => {
    setExportDialog(config);
  }, []);

  const handleExportFolder = useCallback((row: LibraryFolderRow) => {
    openExportDialog({
      scope: "folder",
      scopeLabel: row.tag.replace(/^folder:/, ""),
      folderTag: row.tag,
      itemCount: folderCount(row.tag),
    });
  }, [folderCount, openExportDialog]);

  const handleExportSelected = useCallback((item?: ReferenceItem) => {
    const ids = item ? selectedIdsForItem(item) : selectedItems.map((row) => row.id);
    openExportDialog({
      scope: "selected",
      scopeLabel: `${ids.length} selected`,
      ids,
      itemCount: ids.length,
    });
  }, [openExportDialog, selectedIdsForItem, selectedItems]);

  const handleExportFiltered = useCallback(() => {
    openExportDialog({
      scope: "filtered",
      scopeLabel: toolbarTitle,
      ids: filteredItems.map((item) => item.id),
      itemCount: filteredItems.length,
    });
  }, [filteredItems, openExportDialog, toolbarTitle]);

  const handleExportAll = useCallback(() => {
    openExportDialog({
      scope: "all",
      scopeLabel: "All References",
      itemCount: activeItems.length,
    });
  }, [activeItems.length, openExportDialog]);

  const handleExportProject = useCallback(() => {
    if (!returnProjectId) return;
    openExportDialog({
      scope: "projectLinked",
      scopeLabel: "Project linked references",
      projectId: returnProjectId,
      itemCount: activeItems.filter((item) => (usageCounts[item.id] ?? 0) > 0).length,
    });
  }, [activeItems, openExportDialog, returnProjectId, usageCounts]);

  const handleCleanupOrphans = useCallback(async () => {
    setOrphanCleanupOpen(true);
  }, []);

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-background">
      <nav className="app-topbar items-stretch justify-between px-4">
        <button
          onClick={() => navigate("/dashboard")}
          className="flex items-center pl-4 pr-8 flex-shrink-0 border-r border-border-subtle transition-opacity hover:opacity-80"
        >
          <BrandLogo />
        </button>
        <div className="flex items-center flex-1 pl-8 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] text-muted-foreground">Reference Library</span>
          </div>
        </div>
        <div className="flex items-center gap-2 px-7">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(getReturnTo(location.search))}
            className="h-8 gap-2 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Project
          </Button>
        </div>
      </nav>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <LibrarySidebar
          ingestSlot={(
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
                className="hidden"
                onChange={(event) => {
                  if (event.currentTarget.files) void handleFiles(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
              />
              <LibraryAddMenu
                eagleBusy={eagleBusy}
                onChooseFiles={() => fileInputRef.current?.click()}
                onPasteUrl={() => setPasteUrlOpen(true)}
                onImportEagle={() => setEagleImportOpen(true)}
              />
              {uploadJobs.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {uploadJobs.slice(0, 4).map((job) => (
                    <div
                      key={job.id}
                      className={cn(
                        "flex items-center gap-1.5 border px-2 py-1 text-[10px]",
                        job.status === "failed"
                          ? "border-destructive/40 bg-destructive/10 text-destructive"
                          : "border-border-subtle bg-surface-panel text-muted-foreground",
                      )}
                      style={{ borderRadius: 0 }}
                      title={job.error ?? job.label}
                    >
                      <span className={cn(
                        "h-1.5 w-1.5 flex-shrink-0 rounded-full",
                        job.status === "uploading" ? "bg-primary animate-pulse" : job.status === "done" ? "bg-success" : "bg-destructive",
                      )} />
                      <span className="truncate">{job.label}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}
          quickFilter={quickFilter}
          onQuickFilterChange={setQuickFilter}
          kindFilter={kindFilter}
          onKindFilterChange={setKindFilter}
          typeRows={typeRows}
          savedFilters={savedFilters}
          activeSavedFilterId={activeSavedFilterId}
          onSavedFilterChange={setActiveSavedFilterId}
          folderRows={folders}
          activeTag={activeTag}
          onTagChange={setActiveTag}
          onCreateFolder={handleCreateFolder}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
          onExportFolder={handleExportFolder}
          tagRows={tagsList}
        />

        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          <LibraryToolbar
            title={toolbarTitle}
            subtitle={toolbarSubtitle}
            query={query}
            onQueryChange={setQuery}
            filteredCount={filteredItems.length}
            totalCount={items.length}
            isCapped={items.length >= REFERENCE_LOAD_LIMIT}
            gridSize={gridSize}
            onGridSizeChange={setGridSize}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            kindFilter={kindFilter}
            onKindFilterChange={setKindFilter}
            typeRows={typeRows}
            activeTag={activeTag}
            onTagChange={setActiveTag}
            tagRows={tagsList}
            ratingFilter={ratingFilter}
            onRatingFilterChange={setRatingFilter}
            noteFilter={noteFilter}
            onNoteFilterChange={setNoteFilter}
            sourceFilter={sourceFilter}
            onSourceFilterChange={setSourceFilter}
            sortKey={sortKey}
            onSortKeyChange={setSortKey}
            sortOrder={sortOrder}
            onSortOrderChange={setSortOrder}
            onClearFilters={clearFilters}
            selectedCount={selectedItems.length}
            storageUsageLabel={storageUsageLabel}
            canExportProject={Boolean(returnProjectId)}
            onRefreshStorageUsage={refreshStorageUsage}
            onCleanupOrphans={handleCleanupOrphans}
            onImportPack={() => setImportPackOpen(true)}
            onExportSelected={() => handleExportSelected()}
            onExportFiltered={handleExportFiltered}
            onExportAll={handleExportAll}
            onExportProject={handleExportProject}
          />

          <div className="flex-1 grid min-h-0 overflow-hidden" style={{ gridTemplateColumns: "minmax(0, 1fr) 360px" }}>
            {previewMode && selected ? (
              <LibraryPreviewPanel
                item={selected}
                items={filteredItems}
                videoRef={videoRef}
                playbackRate={playbackRate}
                onPlaybackRateChange={setPlaybackRate}
                onSelect={handlePreviewSelect}
                onBack={() => setPreviewMode(false)}
                onSetCover={handleSetCover}
                onSaveFrame={handleSaveFrame}
                saving={saving}
              />
            ) : (
              <LibraryGrid
                items={filteredItems}
                selectedId={selectedId}
                selectedIds={selectedIds}
                duplicateCounts={duplicateCounts}
                usageCounts={usageCounts}
                loading={loading}
                error={error}
                isDragging={isDragging}
                gridSize={gridSize}
                viewMode={viewMode}
                onSelect={handleSelectGridItem}
                onDoubleClick={handleGridDoubleClick}
                onMarqueeSelect={handleMarqueeSelect}
                onChooseFiles={() => fileInputRef.current?.click()}
                onImportEagle={() => setEagleImportOpen(true)}
                onDragStateChange={setIsDragging}
                onDrop={handleDrop}
                hasCopiedTags={Boolean(copiedTags)}
                onOpenDefault={handleOpenDefault}
                onShowInFolder={handleShowInFolder}
                onCopyFilePath={handleCopyFilePath}
                onCopyTags={handleCopyTags}
                onPasteTags={handlePasteTags}
                folderRows={folders}
                activeFolderTag={activeTag?.startsWith("folder:") ? activeTag : null}
                onAddToFolder={handleAddToFolder}
                onMoveToFolder={handleMoveToFolder}
                onRemoveFromActiveFolder={handleRemoveFromActiveFolder}
                onExportSelected={handleExportSelected}
                onTogglePin={handleTogglePin}
                onDuplicate={handleDuplicateReference}
                onRename={handleRenameReference}
                onSearchByImage={handleSearchByImage}
                onClassify={handleClassifyReference}
                onRegenerateThumbnail={handleRegenerateThumbnail}
                onMergeDuplicates={handleMergeDuplicates}
                onMoveToTrash={handleMoveToTrash}
                onRestore={handleRestoreReference}
                onPermanentlyDelete={handlePermanentlyDelete}
                onAddToBrief={handleAddToBrief}
                onAddToAgent={handleAddToAgent}
                onAddToConti={handleAddToConti}
                onPromoteToAsset={handleOpenPromoteDialog}
                canAddToProject={Boolean(returnProjectId)}
              />
            )}

            <LibraryInspector
              selected={selected}
              selectedItems={selectedItems}
              hideMediaPreview={previewMode}
              selectedHiddenByFilters={selectedHiddenByFilters}
              selectedDuplicateCount={selectedDuplicateCount}
              selectedUsageCount={selected ? usageCounts[selected.id] ?? 0 : 0}
              selectedSuggestions={selectedSuggestions}
              videoRef={videoRef}
              playbackRate={playbackRate}
              onPlaybackRateChange={setPlaybackRate}
              saving={saving}
              aiBusy={aiBusy}
              editTitle={editTitle}
              editTags={editTags}
              editNotes={editNotes}
              editRating={editRating}
              editSourceUrl={editSourceUrl}
              timestampText={timestampText}
              onEditTitleChange={setEditTitle}
              onEditTagsChange={setEditTags}
              onEditNotesChange={setEditNotes}
              onEditRatingChange={setEditRating}
              onEditSourceUrlChange={setEditSourceUrl}
              onTimestampTextChange={setTimestampText}
              onSaveMetadata={handleSaveMetadata}
              onToggleFavorite={handleToggleFavorite}
              onSetCover={handleSetCover}
              onSaveFrame={handleSaveFrame}
              onAddTimestampNote={handleAddTimestampNote}
              onClassify={handleClassifySelected}
              onAcceptSuggestions={handleAcceptSuggestions}
              onDelete={handleDeleteSelected}
              onRestoreSelected={handleRestoreSelected}
              onCopyText={handleCopyText}
              onExportSelected={() => handleExportSelected()}
              onPromoteToAsset={selected ? () => handleOpenPromoteDialog(selected) : undefined}
              canPromoteToAsset={Boolean(
                returnProjectId
                && selected
                && (selected.kind === "image" || selected.kind === "webp" || selected.kind === "gif")
                && Boolean(selected.file_url)
                && !selected.deleted_at,
              )}
            />
          </div>
        </main>
      </div>

      <PasteUrlDialog
        open={pasteUrlOpen}
        value={urlInput}
        onOpenChange={setPasteUrlOpen}
        onValueChange={setUrlInput}
        onSubmit={handleUrlSubmit}
      />
      <EagleImportDialog
        open={eagleImportOpen}
        busy={eagleBusy}
        root={eagleRoot}
        preview={eaglePreview}
        result={eagleResult}
        onOpenChange={setEagleImportOpen}
        onSelectLibrary={handleSelectEagle}
        onRunImport={handleImportEagle}
      />
      <PromoteToAssetDialog
        open={Boolean(promoteTarget)}
        onOpenChange={(open) => {
          if (!open) setPromoteTarget(null);
        }}
        reference={promoteTarget}
        projectId={returnProjectId}
        onCompleted={handlePromoteCompleted}
      />
      {exportDialog ? (
        <ExportPackDialog
          open={Boolean(exportDialog)}
          onOpenChange={(open) => {
            if (!open) setExportDialog(null);
          }}
          scope={exportDialog.scope}
          scopeLabel={exportDialog.scopeLabel}
          ids={exportDialog.ids}
          folderTag={exportDialog.folderTag}
          projectId={exportDialog.projectId}
          itemCount={exportDialog.itemCount}
        />
      ) : null}
      <PackImportDialog
        open={importPackOpen}
        onOpenChange={setImportPackOpen}
        onComplete={loadReferences}
      />
      <FolderEditDialog
        open={Boolean(folderEdit)}
        mode={folderEdit?.mode ?? "create"}
        parentPath={folderEdit?.parentPath}
        initialPath={folderEdit?.row ? normalizeFolderPath(folderEdit.row.tag) : null}
        onOpenChange={(open) => {
          if (!open) setFolderEdit(null);
        }}
        onSubmit={(path) => {
          if (folderEdit?.mode === "rename") void confirmRenameFolder(path);
          else confirmCreateFolder(path);
        }}
      />
      <FolderDeleteDialog
        open={Boolean(folderDeleteTarget)}
        folderPath={folderDeleteTarget ? normalizeFolderPath(folderDeleteTarget.tag) : null}
        affectedCount={folderDeleteTarget ? folderCount(folderDeleteTarget.tag) : 0}
        onOpenChange={(open) => {
          if (!open) setFolderDeleteTarget(null);
        }}
        onConfirm={(opts) => void confirmDeleteFolder(opts)}
      />
      <FolderPickerDialog
        open={Boolean(folderPicker)}
        title={folderPicker?.mode === "move" ? "Move to Folder" : "Add to Folder"}
        description={`${folderPicker ? selectedIdsForItem(folderPicker.item).length : 0} selected reference(s).`}
        folders={folders}
        onOpenChange={(open) => {
          if (!open) setFolderPicker(null);
        }}
        onPick={(path) => void confirmPickFolder(path)}
      />
      <OrphanCleanupDialog
        open={orphanCleanupOpen}
        onOpenChange={setOrphanCleanupOpen}
        onComplete={(result) => {
          toast({ title: "Orphan cleanup complete", description: `${result.filesDeleted} file(s) deleted, ${formatBytes(result.bytesFreed)} freed.` });
          void refreshStorageUsage();
        }}
      />
      <DuplicateMergeDialog
        open={Boolean(duplicateMerge)}
        keep={duplicateMerge?.keep ?? null}
        mergeItems={duplicateMerge?.mergeItems ?? []}
        onOpenChange={(open) => {
          if (!open) setDuplicateMerge(null);
        }}
        onConfirm={() => void confirmDuplicateMerge()}
      />
      <RenameReferenceDialog
        open={Boolean(renameTarget)}
        reference={renameTarget}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        onSubmit={(title) => void confirmRenameReference(title)}
      />
      <AlertDialog
        open={permanentDeleteTargets.length > 0}
        onOpenChange={(open) => {
          if (!open) setPermanentDeleteTargets([]);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Permanently delete {permanentDeleteTargets.length} reference{permanentDeleteTargets.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the selected library row{permanentDeleteTargets.length === 1 ? "" : "s"} and stored media files. Project links to the selected reference{permanentDeleteTargets.length === 1 ? "" : "s"} will also be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmPermanentDelete()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Permanently Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default LibraryPage;
