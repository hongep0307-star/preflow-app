import {
  useEffect,
  useState,
  useCallback,
  useRef,
  useSyncExternalStore,
  lazy,
  Suspense,
  type Dispatch,
  type SetStateAction,
} from "react";
import { supabase } from "@/lib/supabase";
import { generateConti, styleTransfer, IMAGE_SIZE_MAP } from "@/lib/conti";
import type { VideoFormat, BriefAnalysis, GeneratingStage } from "@/lib/conti";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";

// ContiStudio is heavy (inpainting canvas, AI calls). Load on demand to keep
// initial Storyboard tab payload small.
const ContiStudio = lazy(() =>
  import("@/components/ContiStudio").then((m) => ({ default: m.ContiStudio })),
);
import {
  Sparkles,
  Film,
  Download,
  RefreshCw,
  Loader2,
  Paintbrush,
  Plus,
  Trash2,
  GripVertical,
  Columns2,
  Upload,
  History,
  RotateCcw,
  X,
  LayoutList,
  LayoutGrid,
  Palette,
  Copy,
  Wand2,
  Minus,
  ImageIcon,
  Eye,
  EyeOff,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  Scene,
  Asset,
  ProjectInfo,
  SceneVersion,
  StylePreset,
  Props,
  ViewMode,
  KR,
  KR_BG,
  KR_BG2,
  KR_BORDER2,
  NONE_ID,
  ACFG,
  ASSET_ICON,
  ASPECT_CLASS,
  MAX_HISTORY,
} from "@/components/conti/contiTypes";
import {
  TagChip,
  resolveAsset,
  InlineField,
  LocationField,
  MetaRows,
  DescriptionField,
  SidePanel,
} from "@/components/conti/contiInternals";
import { SortableContiCard } from "@/components/conti/SortableContiCard";
import { RelightModal } from "@/components/conti/RelightModal";
import { CameraVariationsModal } from "@/components/conti/CameraVariationsModal";
// NOTE: ChangeAngleModal lives in the repo but is not wired — NB2 can't reliably
// re-angle an existing image. Re-enable when a Qwen multi-angle backend lands.
import { StyleTransferConfirmModal } from "@/components/conti/StyleTransferConfirmModal";
import { GenerateAllModal } from "@/components/conti/GenerateAllModal";
import { SceneImageCropModal } from "@/components/conti/SceneImageCropModal";

// ─── 모듈 레벨 상태 ────────────────────────────────────────────
// 탭 이동(ContiTab unmount → remount)에도 진행 중인 generation 의 로딩 상태가 보존되도록
// 모든 로딩 관련 상태를 모듈 store로 끌어올리고 useSyncExternalStore 로 구독한다.

type LoadingFields = {
  generatingSceneIds: Set<string>;
  editGeneratingIds: Set<string>;
  uploadingSceneIds: Set<string>;
  styleTransferringIds: Set<string>;
  queuedSceneIds: Set<string>;
  sceneStages: Record<string, GeneratingStage>;
  generatingVersionId: string | null;
  generatingSceneVersionMap: Record<string, string | null>;
  generatingAll: boolean;
  styleTransferring: boolean;
  generateProgress: { done: number; total: number } | null;
  styleTransferProgress: { done: number; total: number } | null;
};

const _loadingByProject = new Map<string, LoadingFields>();
const _loadingListenersByProject = new Map<string, Set<() => void>>();
const _cacheBustersByProject = new Map<string, Record<number, number>>();
const _sceneStateByProject = new Map<string, { scenes: Scene[]; activeVersionId: string | null }>();
// scene state 모듈 store 에 구독자를 둔다. 탭 이동으로 컴포넌트가 언마운트된 뒤에도
// 계속 돌고 있는 스타일 변형/전체 생성 배치 루프가 saveSceneState 로 최신 상태를 쓰면,
// 리마운트된 인스턴스가 이 구독을 통해 React state 를 동기화해 UI 에 새 이미지를 즉시 반영한다.
const _sceneStateListenersByProject = new Map<string, Set<() => void>>();

function emptyLoading(): LoadingFields {
  return {
    generatingSceneIds: new Set(),
    editGeneratingIds: new Set(),
    uploadingSceneIds: new Set(),
    styleTransferringIds: new Set(),
    queuedSceneIds: new Set(),
    sceneStages: {},
    generatingVersionId: null,
    generatingSceneVersionMap: {},
    generatingAll: false,
    styleTransferring: false,
    generateProgress: null,
    styleTransferProgress: null,
  };
}
function getLoading(pid: string): LoadingFields {
  let v = _loadingByProject.get(pid);
  if (!v) {
    v = emptyLoading();
    _loadingByProject.set(pid, v);
  }
  return v;
}
function patchLoading(pid: string, patch: Partial<LoadingFields>) {
  const cur = getLoading(pid);
  _loadingByProject.set(pid, { ...cur, ...patch });
  _loadingListenersByProject.get(pid)?.forEach((fn) => fn());
}
function subscribeLoading(pid: string, fn: () => void) {
  if (!_loadingListenersByProject.has(pid)) _loadingListenersByProject.set(pid, new Set());
  _loadingListenersByProject.get(pid)!.add(fn);
  return () => {
    _loadingListenersByProject.get(pid)?.delete(fn);
  };
}

function getGeneratingScenes(pid: string): Set<string> {
  return getLoading(pid).generatingSceneIds;
}
function isGeneratingAll(pid: string) {
  return getLoading(pid).generatingAll;
}
function getCacheBusters(pid: string): Record<number, number> {
  if (!_cacheBustersByProject.has(pid)) _cacheBustersByProject.set(pid, {});
  return _cacheBustersByProject.get(pid)!;
}
function getSceneState(pid: string) {
  return _sceneStateByProject.get(pid) ?? null;
}
function saveSceneState(pid: string, scenes: Scene[], activeVersionId: string | null) {
  _sceneStateByProject.set(pid, { scenes, activeVersionId });
  _sceneStateListenersByProject.get(pid)?.forEach((fn) => fn());
}
function subscribeSceneState(pid: string, fn: () => void) {
  if (!_sceneStateListenersByProject.has(pid)) _sceneStateListenersByProject.set(pid, new Set());
  _sceneStateListenersByProject.get(pid)!.add(fn);
  return () => {
    _sceneStateListenersByProject.get(pid)?.delete(fn);
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const VersionCompareModal = ({
  sceneNumber,
  versions,
  activeVersionId,
  videoFormat,
  onClose,
  onImport,
}: {
  sceneNumber: number;
  versions: SceneVersion[];
  activeVersionId: string | null;
  videoFormat: VideoFormat;
  onClose: () => void;
  onImport: (sceneNumber: number, imageUrl: string) => Promise<void>;
}) => {
  const aspectClass = ASPECT_CLASS[videoFormat];
  const [importingIdx, setImportingIdx] = useState<number | null>(null);
  const versionScenes = versions
    .map((v) => ({
      versionName: v.version_name || `v${v.version_number}`,
      versionIdx: v.version_number,
      isActive: v.id === activeVersionId,
      scene: (v.scenes as Scene[]).find((s) => s.scene_number === sceneNumber) ?? null,
    }))
    .filter((v) => v.scene !== null);
  if (versionScenes.length === 0) return null;
  const title = versionScenes[0].scene?.title ?? `Scene ${sceneNumber}`;
  const handleImport = async (versionIdx: number, imageUrl: string) => {
    setImportingIdx(versionIdx);
    try {
      await onImport(sceneNumber, imageUrl);
    } finally {
      setImportingIdx(null);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="bg-card border-border"
        style={{ maxWidth: `${Math.min(versionScenes.length * 280 + 80, 1200)}px`, width: "90vw" }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Columns2 className="w-4 h-4" style={{ color: KR }} />
            Compare — Scene {sceneNumber} · {title}
          </DialogTitle>
        </DialogHeader>
        <div className="overflow-x-auto pb-2" style={{ maxHeight: "75vh" }}>
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: `repeat(${versionScenes.length}, minmax(220px, 1fr))` }}
          >
            {versionScenes.map(({ versionName, versionIdx, isActive, scene }) => (
              <div key={versionIdx} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[11px] font-bold px-2 py-0.5 rounded-none text-white"
                    style={{ background: KR }}
                  >
                    {`ver.${versionIdx}`}
                  </span>
                  <span className="text-[12px] text-muted-foreground truncate">{versionName}</span>
                  {isActive && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-none font-semibold"
                      style={{ background: KR_BG, color: KR }}
                    >
                      현재
                    </span>
                  )}
                </div>
                <div
                  className={`relative ${aspectClass} rounded-none overflow-hidden bg-background border-2`}
                  style={{ borderColor: isActive ? KR : "hsl(var(--border))" }}
                >
                  {scene?.conti_image_url ? (
                    <img src={scene.conti_image_url} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                      <Film className="w-6 h-6 text-border" />
                      <span className="text-[11px] text-muted-foreground/40">No conti</span>
                    </div>
                  )}
                </div>
                {scene?.description && (
                  <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-3">{scene.description}</p>
                )}
                <Button
                  size="sm"
                  variant={isActive ? "ghost" : "outline"}
                  disabled={isActive || !scene?.conti_image_url || importingIdx !== null}
                  onClick={() => scene?.conti_image_url && handleImport(versionIdx, scene.conti_image_url)}
                  className="w-full gap-1.5 text-xs mt-1"
                >
                  {importingIdx === versionIdx ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Loading...
                    </>
                  ) : isActive ? (
                    "Current"
                  ) : !scene?.conti_image_url ? (
                    "No conti"
                  ) : (
                    <>
                      <RefreshCw className="w-3.5 h-3.5" />
                      Use this
                    </>
                  )}
                </Button>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const HistorySheet = ({
  sceneNumber,
  sceneTitle,
  history,
  aspectClass,
  onClose,
  onRollback,
  onDelete,
}: {
  sceneNumber: number;
  sceneTitle: string | null;
  history: string[];
  aspectClass: string;
  onClose: () => void;
  onRollback: (url: string) => Promise<void>;
  onDelete: (url: string) => void;
}) => {
  const [rollingBack, setRollingBack] = useState<number | null>(null);
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[340px] bg-card border-border overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2 text-[14px]">
            <History className="w-4 h-4" style={{ color: KR }} />
            Scene {sceneNumber} History
            {sceneTitle && <span className="text-muted-foreground font-normal">· {sceneTitle}</span>}
          </SheetTitle>
        </SheetHeader>
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <History className="w-8 h-8 text-border" />
            <p className="text-[12px] text-muted-foreground">No history available</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {history.map((url, idx) => (
              <div key={idx} className="rounded-none overflow-hidden border border-border bg-background">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50">
                  <span className="text-[11px] text-muted-foreground">{idx === 0 ? "Previous" : `${idx + 1} ago`}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={rollingBack !== null}
                      onClick={() => onDelete(url)}
                      className="gap-1 text-[11px] h-6 px-2 text-muted-foreground hover:text-destructive"
                      title="Delete from history"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={rollingBack !== null}
                      onClick={async () => {
                        setRollingBack(idx);
                        try {
                          await onRollback(url);
                          onClose();
                        } finally {
                          setRollingBack(null);
                        }
                      }}
                      className="gap-1 text-[11px] h-6 px-2"
                      style={{ color: KR }}
                    >
                      {rollingBack === idx ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <>
                          <RotateCcw className="w-3 h-3" />
                          Restore
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                <div className={`relative ${aspectClass} bg-background`}>
                  <img src={url} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                </div>
              </div>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const NewVersionModal = ({
  onClose,
  onCreated,
  versions,
  activeScenes,
  projectId,
}: {
  onClose: () => void;
  onCreated: (newVersionId: string) => void;
  versions: SceneVersion[];
  activeScenes: Scene[];
  projectId: string;
}) => {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [createMethod, setCreateMethod] = useState<"copy" | "fresh">("copy");
  const [isCreating, setIsCreating] = useState(false);
  const methods = [
    {
      id: "copy" as const,
      Icon: Copy,
      title: "Copy current scenes",
      desc: "Duplicate scene structure, regenerate conti",
    },
    {
      id: "fresh" as const,
      Icon: Sparkles,
      title: "Start fresh",
      desc: "Develop a new scenario from Agent tab",
    },
  ];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[420px] bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold">New Version</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Version name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="" autoFocus />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Start method</label>
            <div className="space-y-2">
              {methods.map((m) => {
                const isSelected = createMethod === m.id;
                return (
                  <div
                    key={m.id}
                    onClick={() => setCreateMethod(m.id)}
                    className="flex items-start gap-3 p-3 rounded-none cursor-pointer transition-colors border"
                    style={{
                      borderColor: isSelected ? KR : "hsl(var(--border))",
                      background: isSelected ? KR_BG : "transparent",
                    }}
                  >
                    <m.Icon
                      className="w-4 h-4 shrink-0 mt-0.5"
                      style={{ color: isSelected ? KR : "rgba(255,255,255,0.5)" }}
                      strokeWidth={1.75}
                    />
                    <div>
                      <div className="text-[13px] font-semibold">{m.title}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{m.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" className="text-[13px] h-9" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={isCreating}
            className="text-white text-[13px] h-9"
            style={{ background: KR }}
            onClick={async () => {
              setIsCreating(true);
              try {
                const maxVerNum = versions.reduce((m, v) => Math.max(m, v.version_number), 0);
                const maxOrder = versions.reduce((m, v) => Math.max(m, v.display_order ?? 0), 0);
                const versionName = name.trim() || `ver.${maxVerNum + 1}`;
                const scenesToSave =
                  createMethod === "copy"
                    ? activeScenes.map((s) => ({ ...s, conti_image_url: null, conti_image_history: [] }))
                    : [];
                const { data: inserted } = await supabase
                  .from("scene_versions")
                  .insert({
                    project_id: projectId,
                    version_number: maxVerNum + 1,
                    version_name: versionName,
                    display_order: maxOrder + 1,
                    scenes: scenesToSave as any,
                    is_active: false,
                  })
                  .select("id")
                  .single();
                toast({ title: `"${versionName}" created` });
                onCreated(inserted?.id ?? "");
                onClose();
              } catch (err: any) {
                toast({ title: "Creation failed", description: err.message, variant: "destructive" });
              } finally {
                setIsCreating(false);
              }
            }}
          >
            {isCreating ? "Creating..." : "Create Version"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const FORMAT_OPTIONS = [
  { id: "pdf" as const, icon: FileText, label: "PDF", description: "인쇄 · 공유용", enabled: true },
  { id: "png" as const, icon: ImageIcon, label: "PNG", description: "고해상도 이미지", enabled: true },
  { id: "ae" as const, icon: Film, label: "AE", description: "Coming Soon", enabled: false },
];

const ExportModal = ({
  versions,
  currentScenes,
  activeVersionId,
  showInfo,
  videoFormat,
  projectTitle,
  onClose,
  onExportPdf,
  onExportPng,
}: {
  versions: SceneVersion[];
  currentScenes: Scene[];
  activeVersionId: string | null;
  showInfo: boolean;
  videoFormat: string;
  projectTitle: string;
  onClose: () => void;
  onExportPdf: (v: { label: string; scenes: Scene[] }[], includeInfo: boolean) => void;
  onExportPng: (
    v: { label: string; scenes: Scene[] }[],
    scale: number,
    mode: "page" | "individual",
    includeInfo: boolean,
  ) => void;
}) => {
  const [exportFormat, setExportFormat] = useState<"pdf" | "png" | "ae">("pdf");
  const [pngScale, setPngScale] = useState<1 | 2 | 3>(2);
  const [pngMode, setPngMode] = useState<"page" | "individual">("page");
  const [includeInfo, setIncludeInfo] = useState(showInfo);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    if (activeVersionId && versions.some((v) => v.id === activeVersionId)) {
      return new Set([activeVersionId]);
    }
    return versions.length > 0 ? new Set([versions[0].id]) : new Set(["current"]);
  });
  const toggle = (id: string) =>
    setSelectedIds((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const buildSelected = () => {
    const result: { label: string; scenes: Scene[] }[] = [];
    if (selectedIds.has("current")) result.push({ label: "Current", scenes: currentScenes });
    for (const v of versions)
      if (selectedIds.has(v.id)) {
        const isActive = v.id === activeVersionId;
        const scenes = isActive ? currentScenes : (v.scenes as Scene[]);
        result.push({ label: v.version_name || `v${v.version_number}`, scenes });
      }
    return result;
  };
  const handleExport = () => {
    const selected = buildSelected();
    onClose();
    if (exportFormat === "pdf") {
      onExportPdf(selected, includeInfo);
    } else if (exportFormat === "png") {
      onExportPng(selected, pngScale, pngMode, includeInfo);
    }
  };

  const scaleOptions: { value: 1 | 2 | 3; label: string; detail: string }[] = [
    { value: 1, label: "1x", detail: "1600px" },
    { value: 2, label: "2x", detail: "3200px" },
    { value: 3, label: "3x", detail: "4800px" },
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[480px] bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold">Export</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Format</label>
            <div className="grid grid-cols-3 gap-2">
              {FORMAT_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const isSelected = exportFormat === opt.id;
                return (
                  <button
                    key={opt.id}
                    disabled={!opt.enabled}
                    onClick={() => opt.enabled && setExportFormat(opt.id)}
                    className="flex flex-col items-center justify-center gap-1.5 py-4 transition-all"
                    style={{
                      background: isSelected ? "rgba(249,66,58,0.06)" : "rgba(255,255,255,0.03)",
                      border: `1px solid ${isSelected ? KR : "rgba(255,255,255,0.08)"}`,
                      borderRadius: 0,
                      opacity: opt.enabled ? 1 : 0.4,
                      cursor: opt.enabled ? "pointer" : "not-allowed",
                    }}
                  >
                    <Icon className="w-6 h-6" style={{ color: isSelected ? KR : "rgba(255,255,255,0.5)" }} />
                    <span
                      className="text-[13px] font-semibold"
                      style={{ color: isSelected ? KR : "rgba(255,255,255,0.7)" }}
                    >
                      {opt.label}
                    </span>
                    <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                      {opt.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Version</label>
            <div className="space-y-2 max-h-[30vh] overflow-y-auto">
              {versions.length === 0 && (
                <label
                  className="flex items-center gap-3 p-3 rounded-none cursor-pointer border"
                  style={{
                    background: "hsl(var(--background))",
                    borderColor: selectedIds.has("current") ? KR : "hsl(var(--border))",
                  }}
                >
                  <Checkbox checked={selectedIds.has("current")} onCheckedChange={() => toggle("current")} />
                  <div className="flex-1">
                    <div className="text-foreground text-[13px] font-semibold">Current work</div>
                    <div className="text-muted-foreground/60 text-[11px]">{currentScenes.length} scenes</div>
                  </div>
                </label>
              )}
              {versions.map((v, idx) => (
                <label
                  key={v.id}
                  className="flex items-center gap-3 p-3 rounded-none cursor-pointer border"
                  style={{
                    background: "hsl(var(--background))",
                    borderColor: selectedIds.has(v.id) ? KR : "hsl(var(--border))",
                  }}
                >
                  <Checkbox checked={selectedIds.has(v.id)} onCheckedChange={() => toggle(v.id)} />
                  <div className="flex-1 min-w-0">
                    <div className="text-foreground text-[13px] font-semibold">
                      {`ver.${idx + 1}`} — {v.version_name || `v${v.version_number}`}
                    </div>
                    <div className="text-muted-foreground/60 text-[11px]">
                      {new Date(v.created_at).toLocaleDateString("en-US")} · {v.scenes.length} scenes
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {v.scenes
                      .slice(0, 3)
                      .map((s: any, i: number) =>
                        s.conti_image_url ? (
                          <img key={i} src={s.conti_image_url} className="w-7 h-5 object-cover rounded" loading="lazy" decoding="async" />
                        ) : (
                          <div key={i} className="w-7 h-5 rounded bg-muted" />
                        ),
                      )}
                  </div>
                </label>
              ))}
            </div>
          </div>

          {exportFormat === "png" && (
            <>
              <div>
                <label className="text-xs text-muted-foreground mb-2 block">Resolution</label>
                <div className="flex gap-2">
                  {scaleOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setPngScale(opt.value)}
                      className="flex-1 py-2 text-center transition-all"
                      style={{
                        background: pngScale === opt.value ? "rgba(249,66,58,0.06)" : "rgba(255,255,255,0.03)",
                        border: `1px solid ${pngScale === opt.value ? KR : "rgba(255,255,255,0.08)"}`,
                        borderRadius: 0,
                        cursor: "pointer",
                      }}
                    >
                      <div
                        className="text-[13px] font-semibold"
                        style={{ color: pngScale === opt.value ? KR : "rgba(255,255,255,0.7)" }}
                      >
                        {opt.label}
                      </div>
                      <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                        {opt.detail}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-2 block">Export mode</label>
                <div className="flex gap-2">
                  {[
                    { value: "page" as const, label: "Page layout", desc: "PDF와 동일 5×2 레이아웃" },
                    { value: "individual" as const, label: "Individual scenes", desc: "씬별 개별 PNG" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setPngMode(opt.value)}
                      className="flex-1 py-2.5 px-3 text-left transition-all"
                      style={{
                        background: pngMode === opt.value ? "rgba(249,66,58,0.06)" : "rgba(255,255,255,0.03)",
                        border: `1px solid ${pngMode === opt.value ? KR : "rgba(255,255,255,0.08)"}`,
                        borderRadius: 0,
                        cursor: "pointer",
                      }}
                    >
                      <div
                        className="text-[12px] font-semibold"
                        style={{ color: pngMode === opt.value ? KR : "rgba(255,255,255,0.7)" }}
                      >
                        {opt.label}
                      </div>
                      <div className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>
                        {opt.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {(exportFormat === "pdf" || exportFormat === "png") && (
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={includeInfo} onCheckedChange={(v) => setIncludeInfo(!!v)} />
              <span className="text-[12px] text-muted-foreground">
                메타 정보 포함 (제목, 카메라, 무드, 로케이션, 러닝타임)
              </span>
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" className="text-[13px] h-9" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={selectedIds.size === 0 || !FORMAT_OPTIONS.find((f) => f.id === exportFormat)?.enabled}
            className="text-white text-[13px] h-9"
            style={{ background: KR }}
          >
            Export {exportFormat.toUpperCase()} ({selectedIds.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const StylePickerModal = ({
  currentStyleId,
  projectId,
  onClose,
  onChanged,
}: {
  currentStyleId: string | null;
  projectId: string;
  onClose: () => void;
  onChanged: (p: StylePreset | null) => void;
}) => {
  const { toast } = useToast();
  const [presets, setPresets] = useState<StylePreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<string>(currentStyleId ?? NONE_ID);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  const fetchStyles = useCallback(async () => {
    const { data, error } = await supabase
      .from("style_presets")
      .select("id,name,description,thumbnail_url,style_prompt,is_default")
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) throw error;
    const nextPresets = (data ?? []) as StylePreset[];
    setPresets(nextPresets);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStyles().catch(() => setLoading(false));
  }, [fetchStyles]);

  useEffect(() => {
    setSelected(currentStyleId ?? NONE_ID);
  }, [currentStyleId]);

  const handleUploadStyle = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "png";
      const safeName = `custom-style-${Date.now()}.${ext}`.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${projectId}/${safeName}`;
      const { error: upErr } = await supabase.storage.from("style-presets").upload(storagePath, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from("style-presets").getPublicUrl(storagePath);
      const publicUrl = urlData.publicUrl;
      const { data: inserted, error: insErr } = await supabase
        .from("style_presets")
        .insert({
          name: file.name.replace(/\.[^.]+$/, "").slice(0, 30) || "Custom",
          description: "Uploaded custom style",
          thumbnail_url: publicUrl,
          style_prompt: "Match the visual style, color palette, and artistic treatment of the reference image.",
          is_default: false,
          user_id: (await supabase.auth.getUser()).data.user?.id ?? null,
        })
        .select()
        .single();
      if (insErr) throw insErr;
      const newPreset = inserted as StylePreset;
      setPresets((prev) => [...prev, newPreset]);
      setSelected(newPreset.id);
      toast({ title: `"${newPreset.name}" style uploaded.` });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  const handleApply = async () => {
    setSaving(true);
    try {
      if (selected === NONE_ID) {
        const { error } = await supabase.from("projects").update({ conti_style_id: null }).eq("id", projectId);
        if (error) throw error;
        onChanged(null);
        toast({ title: "Style removed." });
      } else {
        const preset = presets.find((p) => p.id === selected) ?? null;
        const { error } = await supabase.from("projects").update({ conti_style_id: selected }).eq("id", projectId);
        if (error) throw error;
        onChanged(preset);
        toast({ title: `"${preset?.name}" style applied.` });
      }
      onClose();
    } catch (err: any) {
      toast({ title: "Style change failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[720px] bg-card border-border" style={{ borderRadius: 0 }}>
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold">Style Select</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2.5 max-h-[60vh] overflow-y-auto py-1">
            <div
              onClick={() => setSelected(NONE_ID)}
              className="overflow-hidden cursor-pointer transition-all h-52 flex flex-col"
              style={{
                borderRadius: 0,
                border: selected === NONE_ID ? `2px solid ${KR}` : "1px solid rgba(255,255,255,0.07)",
                background: selected === NONE_ID ? KR_BG : "rgba(255,255,255,0.03)",
              }}
            >
              <div
                className="relative flex-1 min-h-0 overflow-hidden flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.03)" }}
              >
                <div className="flex flex-col items-center gap-1.5">
                  <div
                    className="w-8 h-8 flex items-center justify-center"
                    style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 0 }}
                  >
                    <svg
                      width={16}
                      height={16}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="rgba(255,255,255,0.25)"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                    >
                      <line x1="4" y1="4" x2="20" y2="20" />
                    </svg>
                  </div>
                </div>
              </div>
              <div className="p-2 h-16 flex flex-col justify-start">
                <div
                  className="text-[11px] font-bold"
                  style={{ color: selected === NONE_ID ? KR : "#f0f0f0" }}
                >
                  None
                </div>
                <div className="text-[10px] mt-0.5 line-clamp-2" style={{ color: "rgba(255,255,255,0.3)" }}>
                  Default photorealistic
                </div>
              </div>
            </div>
            {(() => {
              const defaults = presets.filter((p) => p.is_default);
              const customs = presets.filter((p) => !p.is_default);
              const sorted = [...defaults, ...customs];
              return sorted.map((preset) => {
                const isSel = selected === preset.id;
                const isCustom = !preset.is_default;
                return (
                  <div
                    key={preset.id}
                    onClick={() => setSelected(preset.id)}
                    className="relative overflow-hidden cursor-pointer transition-all group h-52 flex flex-col"
                    style={{
                      borderRadius: 0,
                      border: isSel ? `2px solid ${KR}` : "1px solid rgba(255,255,255,0.07)",
                      background: isSel ? KR_BG : "rgba(255,255,255,0.03)",
                    }}
                  >
                    {isCustom && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!window.confirm("이 스타일을 삭제하시겠습니까?")) return;
                          try {
                            const isDeletingSelected = selected === preset.id;
                            const isDeletingCurrent = currentStyleId === preset.id;
                            const { error: detachProjectsError } = await supabase
                              .from("projects")
                              .update({ conti_style_id: null })
                              .eq("conti_style_id", preset.id);
                            if (detachProjectsError) throw detachProjectsError;
                            const { error: deleteError } = await supabase
                              .from("style_presets")
                              .delete()
                              .eq("id", preset.id);
                            if (deleteError) throw deleteError;
                            if (preset.thumbnail_url) {
                              const urlPath = preset.thumbnail_url.split("/style-presets/")[1];
                              if (urlPath) {
                                const { error: storageError } = await supabase.storage
                                  .from("style-presets")
                                  .remove([decodeURIComponent(urlPath)]);
                                if (storageError) throw storageError;
                              }
                            }
                            if (isDeletingSelected || isDeletingCurrent) setSelected(NONE_ID);
                            if (isDeletingCurrent) onChanged(null);
                            await fetchStyles();
                            toast({ title: "스타일이 삭제되었습니다." });
                          } catch (err: any) {
                            toast({ title: "삭제 실패", description: err.message, variant: "destructive" });
                          }
                        }}
                        className="absolute top-2 right-2 z-10 w-5 h-5 flex items-center justify-center rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ background: "rgba(220,38,38,0.9)" }}
                      >
                        <X className="w-3 h-3 text-white" />
                      </button>
                    )}
                    <div
                      className="relative flex-1 min-h-0 overflow-hidden"
                      style={{ background: "rgba(255,255,255,0.03)" }}
                    >
                      {preset.thumbnail_url ? (
                        <img src={preset.thumbnail_url} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Palette className="w-5 h-5" style={{ color: "rgba(255,255,255,0.15)" }} />
                        </div>
                      )}
                      {preset.is_default && (
                        <div
                          className="absolute bottom-1 left-1 font-mono text-[8px] font-bold uppercase px-1.5 py-0.5"
                          style={{ background: "rgba(0,0,0,0.65)", color: "#fff", borderRadius: 2 }}
                        >
                          DEFAULT
                        </div>
                      )}
                    </div>
                    <div className="p-2 h-16 flex flex-col justify-start">
                      <div className="text-[11px] font-bold" style={{ color: isSel ? KR : "#f0f0f0" }}>
                        {preset.name}
                      </div>
                      {preset.description && (
                        <div className="text-[10px] mt-0.5 line-clamp-2" style={{ color: "rgba(255,255,255,0.3)" }}>
                          {preset.description}
                        </div>
                      )}
                    </div>
                  </div>
                );
              });
            })()}
            <div
              onClick={() => !uploading && uploadRef.current?.click()}
              onDragOver={(e) => {
                if (uploading) return;
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
                if (!dragOver) setDragOver(true);
              }}
              onDragEnter={(e) => {
                if (uploading) return;
                e.preventDefault();
                e.stopPropagation();
                setDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                // 자식 요소로 포인터가 들어가는 dragleave 는 무시
                const related = e.relatedTarget as Node | null;
                if (related && (e.currentTarget as Node).contains(related)) return;
                setDragOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOver(false);
                if (uploading) return;
                const file = Array.from(e.dataTransfer?.files ?? []).find((f) =>
                  f.type.startsWith("image/"),
                );
                if (file) {
                  handleUploadStyle(file);
                } else {
                  toast({
                    title: "이미지 파일만 업로드 가능합니다.",
                    variant: "destructive",
                  });
                }
              }}
              className="overflow-hidden cursor-pointer transition-all h-52 flex flex-col"
              style={{
                borderRadius: 0,
                border: dragOver ? `2px solid ${KR}` : "1px dashed rgba(255,255,255,0.15)",
                background: dragOver ? KR_BG : "rgba(255,255,255,0.02)",
                opacity: uploading ? 0.5 : 1,
              }}
            >
              <input
                ref={uploadRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUploadStyle(f);
                }}
              />
              <div
                className="relative flex-1 min-h-0 overflow-hidden flex items-center justify-center"
                style={{ background: dragOver ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.03)" }}
              >
                {uploading ? (
                  <Loader2 className="w-5 h-5 animate-spin" style={{ color: "rgba(255,255,255,0.3)" }} />
                ) : (
                  <Upload
                    className="w-5 h-5"
                    style={{ color: dragOver ? KR : "rgba(255,255,255,0.2)" }}
                  />
                )}
              </div>
              <div className="p-2 h-16 flex flex-col justify-start">
                <div
                  className="text-[11px] font-bold"
                  style={{ color: dragOver ? KR : "#f0f0f0" }}
                >
                  {uploading ? "Uploading..." : dragOver ? "Drop image" : "Upload"}
                </div>
                <div className="text-[10px] mt-0.5 line-clamp-2" style={{ color: "rgba(255,255,255,0.3)" }}>
                  {dragOver ? "Release to upload" : "Drag & drop or click"}
                </div>
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" className="text-[13px] h-9" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            className="text-white gap-1.5 text-[13px] h-9"
            style={{ background: KR, borderRadius: 0 }}
            onClick={handleApply}
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const RenameVersionModal = ({
  version,
  onClose,
  onRenamed,
}: {
  version: SceneVersion;
  onClose: () => void;
  onRenamed: () => void;
}) => {
  const { toast } = useToast();
  const [name, setName] = useState(version.version_name || "");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[360px] bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold">Rename Version</DialogTitle>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter")
              supabase
                .from("scene_versions")
                .update({ version_name: name.trim() })
                .eq("id", version.id)
                .then(() => {
                  onRenamed();
                  onClose();
                });
          }}
        />
        <DialogFooter>
          <Button variant="ghost" className="text-[13px] h-9" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="text-white text-[13px] h-9"
            style={{ background: KR }}
            onClick={async () => {
              await supabase.from("scene_versions").update({ version_name: name.trim() }).eq("id", version.id);
              toast({ title: "Renamed." });
              onRenamed();
              onClose();
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const AddSceneCard = ({ onClick }: { onClick: () => void }) => {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="cursor-pointer select-none flex items-center justify-center"
      style={{
        borderRadius: 0,
        border: `1.5px dashed ${hover ? "rgba(249,66,58,0.45)" : "rgba(255,255,255,0.1)"}`,
        background: hover ? "rgba(249,66,58,0.04)" : "rgba(255,255,255,0.02)",
        transition: "border-color 0.15s, background 0.15s",
      }}
    >
      <div className="flex flex-col items-center gap-2">
        <div
          className="flex items-center justify-center"
          style={{
            width: 40,
            height: 40,
            borderRadius: 0,
            background: hover ? "rgba(249,66,58,0.12)" : "rgba(255,255,255,0.05)",
            transition: "background 0.15s",
          }}
        >
          <Plus
            style={{ width: 18, height: 18, color: hover ? KR : "rgba(255,255,255,0.25)", transition: "color 0.15s" }}
          />
        </div>
        <span
          className="font-mono text-[10px] font-bold tracking-wider"
          style={{ color: hover ? KR : "rgba(255,255,255,0.3)", transition: "color 0.15s" }}
        >
          Add Scene
        </span>
      </div>
    </div>
  );
};

const InsertSceneButton = ({
  onAddScene,
  onAddTransition,
  canTransition,
}: {
  onAddScene: () => void;
  onAddTransition: () => void;
  canTransition: boolean;
}) => {
  const [hover, setHover] = useState(false);
  const [popOpen, setPopOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const [flipRight, setFlipRight] = useState(false);

  useEffect(() => {
    if (!popOpen) return;
    const fn = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setPopOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [popOpen]);

  useEffect(() => {
    if (popOpen && popRef.current) {
      const rect = popRef.current.getBoundingClientRect();
      setFlipRight(rect.left < 80);
    }
  }, [popOpen]);

  return (
    <div
      ref={popRef}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "absolute",
        left: -6,
        top: 0,
        bottom: 0,
        width: 12,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transform: "translateX(-50%)",
      }}
    >
      {(hover || popOpen) && (
        <>
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: "50%",
              width: 2,
              background: `linear-gradient(to bottom, transparent, ${KR} 15%, ${KR} 85%, transparent)`,
              transform: "translateX(-50%)",
            }}
          />
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPopOpen((v) => !v);
            }}
            style={{
              width: 24,
              height: 24,
              minWidth: 24,
              minHeight: 24,
              borderRadius: "9999px",
              aspectRatio: "1 / 1",
              background: KR,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1,
              border: "none",
              cursor: "pointer",
              padding: 0,
              boxSizing: "border-box",
            }}
          >
            <Plus style={{ width: 14, height: 14, color: "#fff" }} />
          </button>
        </>
      )}
      {popOpen && (
        <div
          style={{
            position: "absolute",
            ...(flipRight
              ? { left: "50%", top: "50%", transform: "translate(12px, -50%)" }
              : { left: "50%", top: "50%", transform: "translate(-50%, 18px)" }),
            background: "hsl(var(--card))",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 0,
            padding: 4,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            minWidth: 160,
            zIndex: 30,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPopOpen(false);
              onAddScene();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "rgba(255,255,255,0.85)",
              fontSize: 12,
              fontWeight: 500,
              width: "100%",
              textAlign: "left",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "none";
            }}
          >
            <Plus style={{ width: 13, height: 13, flexShrink: 0 }} />
            Add Scene
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!canTransition) return;
              setPopOpen(false);
              onAddTransition();
            }}
            disabled={!canTransition}
            title={!canTransition ? "Both scenes need images" : "Insert transition between scenes"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              background: "none",
              border: "none",
              cursor: canTransition ? "pointer" : "not-allowed",
              color: canTransition ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.25)",
              fontSize: 12,
              fontWeight: 500,
              width: "100%",
              textAlign: "left",
              opacity: canTransition ? 1 : 0.5,
            }}
            onMouseEnter={(e) => {
              if (canTransition) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "none";
            }}
          >
            <svg
              width={13}
              height={13}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <path d="M18 8L22 12L18 16" />
              <path d="M2 12H22" />
            </svg>
            Add Transition
          </button>
        </div>
      )}
    </div>
  );
};

const SortableVersionTab = ({
  id,
  children,
}: {
  id: string;
  children: (listeners: any, attributes: any) => React.ReactNode;
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, 0, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style}>
      {children(listeners, attributes)}
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ContiTab — 메인 컴포넌트
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const ContiTab = ({ projectId, videoFormat }: Props) => {
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const [versions, setVersions] = useState<SceneVersion[]>([]);
  const savedSceneState = getSceneState(projectId);
  const [activeVersionId, setActiveVersionIdState] = useState<string | null>(savedSceneState?.activeVersionId ?? null);
  const [activeScenes, setActiveScenesState] = useState<Scene[]>(savedSceneState?.scenes ?? []);
  const projectActiveVersionIdRef = useRef<string | null>(null);

  const setActiveVersionId = useCallback(
    (id: string | null) => {
      setActiveVersionIdState(id);
      saveSceneState(projectId, _sceneStateByProject.get(projectId)?.scenes ?? [], id);
    },
    [projectId],
  );

  const setActiveScenes = useCallback(
    (scenes: Scene[] | ((prev: Scene[]) => Scene[])) => {
      setActiveScenesState((prev) => {
        const next = typeof scenes === "function" ? scenes(prev) : scenes;
        saveSceneState(projectId, next, _sceneStateByProject.get(projectId)?.activeVersionId ?? null);
        return next;
      });
    },
    [projectId],
  );

  // ⚠️ 모듈 store 구독: 탭 이동 → 리마운트 중에도 background 스타일 변형/일괄 생성 루프가
  // saveSceneState 로 최신 scene 배열을 쓴다. 언마운트된 인스턴스의 setter 는 no-op 이므로
  // 새 인스턴스는 이 구독을 통해 모듈 store 변경을 감지해 activeScenes React state 를 맞춘다.
  // 같은 reference 라면 React 가 자동으로 dedupe 하므로 cycle 걱정 없음.
  useEffect(() => {
    const unsub = subscribeSceneState(projectId, () => {
      const stored = _sceneStateByProject.get(projectId);
      if (!stored) return;
      setActiveScenesState(stored.scenes);
      setActiveVersionIdState(stored.activeVersionId);
    });
    return unsub;
  }, [projectId]);

  const [currentScenes, setCurrentScenes] = useState<Scene[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);

  // ─── 로딩 상태: 모듈 store에 보관해서 ContiTab 언마운트/리마운트 사이에도 유지 ───
  const subscribeFn = useCallback((cb: () => void) => subscribeLoading(projectId, cb), [projectId]);
  const getSnapshotFn = useCallback(() => getLoading(projectId), [projectId]);
  const loadingState = useSyncExternalStore(subscribeFn, getSnapshotFn, getSnapshotFn);
  const {
    generatingSceneIds,
    editGeneratingIds,
    uploadingSceneIds,
    styleTransferringIds,
    queuedSceneIds,
    sceneStages,
    generatingVersionId,
    generatingSceneVersionMap,
    generatingAll,
    styleTransferring,
    generateProgress,
    styleTransferProgress,
  } = loadingState;

  // Setter들은 모듈 store를 직접 갱신 → 컴포넌트가 언마운트된 뒤에도 in-flight closure가 호출하면 정상 반영됨.
  const makeLoadingSetter = useCallback(
    <K extends keyof LoadingFields>(key: K): Dispatch<SetStateAction<LoadingFields[K]>> =>
      (updater) => {
        const prev = getLoading(projectId)[key];
        const next =
          typeof updater === "function"
            ? (updater as (p: LoadingFields[K]) => LoadingFields[K])(prev)
            : updater;
        patchLoading(projectId, { [key]: next } as Partial<LoadingFields>);
      },
    [projectId],
  );

  const setGeneratingSceneIds = useCallback(makeLoadingSetter("generatingSceneIds"), [makeLoadingSetter]);
  const setEditGeneratingIds = useCallback(makeLoadingSetter("editGeneratingIds"), [makeLoadingSetter]);
  const setUploadingSceneIds = useCallback(makeLoadingSetter("uploadingSceneIds"), [makeLoadingSetter]);
  const setStyleTransferringIds = useCallback(makeLoadingSetter("styleTransferringIds"), [makeLoadingSetter]);
  const setQueuedSceneIds = useCallback(makeLoadingSetter("queuedSceneIds"), [makeLoadingSetter]);
  const setSceneStages = useCallback(makeLoadingSetter("sceneStages"), [makeLoadingSetter]);
  const setGeneratingVersionId = useCallback(makeLoadingSetter("generatingVersionId"), [makeLoadingSetter]);
  const setGeneratingSceneVersionMap = useCallback(makeLoadingSetter("generatingSceneVersionMap"), [makeLoadingSetter]);
  const setGeneratingAll = useCallback(makeLoadingSetter("generatingAll"), [makeLoadingSetter]);
  const setGenerateProgress = useCallback(makeLoadingSetter("generateProgress"), [makeLoadingSetter]);
  const setStyleTransferring = useCallback(makeLoadingSetter("styleTransferring"), [makeLoadingSetter]);
  const setStyleTransferProgress = useCallback(makeLoadingSetter("styleTransferProgress"), [makeLoadingSetter]);
  const [showStyleTransferModal, setShowStyleTransferModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showInfo, setShowInfo] = useState(true);
  const [showNewVersionModal, setShowNewVersionModal] = useState(false);
  const [renameVersion, setRenameVersion] = useState<SceneVersion | null>(null);
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const dragCloneRef = useRef<HTMLDivElement | null>(null);
  const [projectInfo, setProjectInfo] = useState<ProjectInfo>({
    title: "",
    client: null,
    active_version_id: null,
    conti_style_id: null,
  });
  const [studioScene, setStudioScene] = useState<Scene | null>(null);
  const [studioInitialTab, setStudioInitialTab] = useState<"view" | "edit" | "history" | "compare" | undefined>(
    undefined,
  );
  const [compareSceneNumber, setCompareSceneNumber] = useState<number | null>(null);
  const [adjustingScene, setAdjustingScene] = useState<Scene | null>(null);
  const [relightingScene, setRelightingScene] = useState<Scene | null>(null);
  const [cameraVariationsScene, setCameraVariationsScene] = useState<Scene | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("auto");
  const [cardSize, setCardSize] = useState<number>(videoFormat === "vertical" ? 240 : 300);
  const [showGenerateAllModal, setShowGenerateAllModal] = useState(false);
  const [tabMenuAnchor, setTabMenuAnchor] = useState<{ id: string; x: number; y: number } | null>(null);
  const [currentStyle, setCurrentStyle] = useState<StylePreset | null>(null);
  const [showStyleModal, setShowStyleModal] = useState(false);
  const [selectedSceneIds, setSelectedSceneIds] = useState<Set<string>>(new Set());
  const [deleteVersionTarget, setDeleteVersionTarget] = useState<{ id: string; name: string } | null>(null);

  const toggleSceneSelect = (id: string, v: boolean) =>
    setSelectedSceneIds((s) => {
      const n = new Set(s);
      v ? n.add(id) : n.delete(id);
      return n;
    });

  const [cacheBusters, setCacheBustersState] = useState<Record<number, number>>(() => ({
    ...getCacheBusters(projectId),
  }));
  const bumpCache = (sceneNumber: number) => {
    const ts = Date.now();
    _cacheBustersByProject.set(projectId, { ...getCacheBusters(projectId), [sceneNumber]: ts });
    setCacheBustersState((prev) => ({ ...prev, [sceneNumber]: ts }));
  };

  const buildHistoryFromScenes = useCallback((scenes: Scene[]): Record<number, string[]> => {
    const h: Record<number, string[]> = {};
    for (const s of scenes) {
      if (s.conti_image_history && s.conti_image_history.length > 0) {
        h[s.scene_number] = s.conti_image_history;
      }
    }
    return h;
  }, []);

  const [imageHistory, setImageHistoryState] = useState<Record<number, string[]>>(() =>
    buildHistoryFromScenes(activeScenes),
  );
  const imageHistoryRef = useRef<Record<number, string[]>>(imageHistory);
  const replaceImageHistory = useCallback((next: Record<number, string[]>) => {
    imageHistoryRef.current = next;
    setImageHistoryState(next);
  }, []);
  const setImageHistory = useCallback((updater: (prev: Record<number, string[]>) => Record<number, string[]>) => {
    const next = updater(imageHistoryRef.current);
    imageHistoryRef.current = next;
    setImageHistoryState(next);
  }, []);
  const [historySheet, setHistorySheet] = useState<Scene | null>(null);

  // ⚠️ sceneId 로 식별한다. 이전에는 scene_number 로 식별했는데,
  // 스타일 변형 전체 루프 중간에 TR 삽입/삭제/재배열이 일어나면 scene_number 가 뒤섞여
  // 엉뚱한 scene 의 conti_image_history 에 push 되는 버그가 있었다.
  const pushHistory = (sceneId: string, oldUrl: string | null) => {
    if (!oldUrl) return;
    const latest = getSceneState(projectId)?.scenes ?? activeScenes;
    const scene = latest.find((s) => s.id === sceneId);
    if (!scene) return;
    const existing = Array.isArray(scene.conti_image_history) ? scene.conti_image_history : [];
    const next = [oldUrl, ...existing.filter((u) => u !== oldUrl)].slice(0, MAX_HISTORY);
    supabase.from("scenes").update({ conti_image_history: next }).eq("id", scene.id).then();
    // 모듈 store 를 동기로 먼저 갱신해 두어야, style-transfer 루프처럼
    // pushHistory 직후 await 전에 getSceneState() 를 읽는 코드가 최신 history 를 본다.
    const currentState = getSceneState(projectId);
    if (currentState) {
      const updatedScenes = currentState.scenes.map((s) =>
        s.id === scene.id ? { ...s, conti_image_history: next } : s,
      );
      saveSceneState(projectId, updatedScenes, currentState.activeVersionId ?? null);
    }
    setActiveScenes((prev) =>
      prev.map((s) => (s.id === scene.id ? { ...s, conti_image_history: next } : s)),
    );
    // UI 캐시는 '현재의' scene_number 로 동기화 (표시 전용).
    const nextMap = { ...imageHistoryRef.current, [scene.scene_number]: next };
    imageHistoryRef.current = nextMap;
    setImageHistoryState(nextMap);
  };

  const imageHistorySyncKey = activeScenes.map((s) => `${s.id}:${(s.conti_image_history ?? []).join("|")}`).join("||");

  useEffect(() => {
    replaceImageHistory(buildHistoryFromScenes(activeScenes));
  }, [imageHistorySyncKey, buildHistoryFromScenes, replaceImageHistory]);

  // setGeneratingSceneIds / setGeneratingAll 자체가 모듈 store를 갱신하므로 wrapper는 단순 alias.
  const updateGeneratingSceneIds = setGeneratingSceneIds;
  const updateGeneratingAll = setGeneratingAll;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const versionSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 10 } }));

  const handleVersionDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = versions.findIndex((v) => v.id === active.id);
      const newIndex = versions.findIndex((v) => v.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(versions, oldIndex, newIndex);
      setVersions(reordered);
      await Promise.all(
        reordered.map((v, i) =>
          supabase
            .from("scene_versions")
            .update({ display_order: i + 1 })
            .eq("id", v.id),
        ),
      );
    },
    [versions],
  );

  const briefAnalysisRef = useRef<BriefAnalysis | null>(null);
  const moodImagesRef = useRef<Array<{ url: string; sceneRef: number | null }>>([]);
  const [moodImageUrls, setMoodImageUrls] = useState<string[]>([]);
  const [moodBookmarks, setMoodBookmarks] = useState<string[]>([]);

  const fetchCurrentScenes = useCallback(async () => {
    const { data } = await supabase
      .from("scenes")
      .select("*")
      .eq("project_id", projectId)
      .eq("source", "conti")
      .order("scene_number", { ascending: true });
    if (data) setCurrentScenes(data as Scene[]);
    return data as Scene[] | null;
  }, [projectId]);

  const fetchAssets = useCallback(async () => {
    const { data } = await supabase
      .from("assets")
      .select("tag_name, photo_url, asset_type, ai_description, outfit_description, space_description")
      .eq("project_id", projectId);
    if (data) setAssets(data as Asset[]);
  }, [projectId]);

  const getMoodReferenceUrl = useCallback((sceneNumber: number): string | undefined => {
    const linked = moodImagesRef.current.find((img) => img.sceneRef === sceneNumber);
    return linked?.url ?? undefined;
  }, []);

  // scene_versions.scenes 에 conti_image_history 가 누락된 legacy 데이터를 위해,
  // scenes 테이블에서 scene.id 기준으로 history 를 가져와 머지한다. renumber 에 영향을 받지 않는다.
  const hydrateSceneHistory = useCallback(
    async (scenes: Scene[]): Promise<Scene[]> => {
      if (!scenes.length) return scenes;
      const ids = scenes.map((s) => s.id).filter(Boolean);
      if (!ids.length) return scenes;
      const { data, error } = await supabase
        .from("scenes")
        .select("id, conti_image_history")
        .in("id", ids);
      if (error || !data) return scenes;
      const histById = new Map<string, string[]>();
      for (const row of data as { id: string; conti_image_history: string[] | null }[]) {
        histById.set(row.id, Array.isArray(row.conti_image_history) ? row.conti_image_history : []);
      }
      return scenes.map((s) => {
        const dbHist = histById.get(s.id) ?? [];
        const own = Array.isArray(s.conti_image_history) ? s.conti_image_history : [];
        // scene 객체에 history 가 이미 있다면 그것을 우선(최신 업데이트 반영).
        return { ...s, conti_image_history: own.length > 0 ? own : dbHist };
      });
    },
    [],
  );

  const loadVersions = useCallback(
    async (preserveActiveScenes = false) => {
      const { data } = await supabase
        .from("scene_versions")
        .select("*")
        .eq("project_id", projectId)
        .order("display_order", { ascending: true });
      const vers = (data ?? []) as SceneVersion[];
      setVersions(vers);
      if (vers.length > 0) {
        const active = vers.find((v) => v.id === projectActiveVersionIdRef.current) ?? vers[0];
        setActiveVersionId(active.id);
        if (!preserveActiveScenes) {
          const hydrated = await hydrateSceneHistory(active.scenes as Scene[]);
          setActiveScenes(hydrated);
        }
      } else {
        setActiveVersionId(null);
        if (!preserveActiveScenes) {
          const scenes = await fetchCurrentScenes();
          setActiveScenes(scenes ?? []);
        }
      }
    },
    [projectId, fetchCurrentScenes, setActiveVersionId, setActiveScenes, hydrateSceneHistory],
  );

  useEffect(() => {
    supabase.functions.invoke("openai-image", { body: { mode: "ping" } }).catch(() => {});
  }, []);

  useEffect(() => {
    // in-flight 스타일 변형/일괄 생성이 진행 중이면, DB 로부터 scene 을 다시 읽어
    // 모듈 store 를 덮어쓰지 않는다. 모듈 store 가 DB 보다 앞서있을 수 있기 때문.
    // (background loop 가 scene 마다 saveSceneState 후 async 로 DB 에 write — 이 사이
    //  구간에 리마운트가 일어나면 DB 는 한 번뒤쳐진 상태라 그걸 읽어 쓰면 진행분이 롤백된다.)
    const _l = getLoading(projectId);
    const hasOngoing =
      _l.generatingSceneIds.size > 0 ||
      _l.generatingAll ||
      _l.styleTransferringIds.size > 0 ||
      _l.styleTransferring;

    const briefsPromise = supabase
      .from("briefs")
      .select("analysis, mood_image_urls, mood_bookmarks")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const projectPromise = supabase
      .from("projects")
      .select("title, client, active_version_id, conti_style_id")
      .eq("id", projectId)
      .single();

    Promise.all([fetchCurrentScenes(), fetchAssets(), briefsPromise, projectPromise]).then(
      async ([_scenes, _assets, briefsRes, projectRes]) => {
        if (briefsRes.data?.analysis) briefAnalysisRef.current = briefsRes.data.analysis as unknown as BriefAnalysis;
        if (briefsRes.data?.mood_image_urls && Array.isArray(briefsRes.data.mood_image_urls)) {
          const rawMoods = briefsRes.data.mood_image_urls as any[];
          moodImagesRef.current = rawMoods.map((item: any) =>
            typeof item === "string"
              ? { url: item, sceneRef: null }
              : { url: item.url, sceneRef: item.sceneRef ?? null },
          );
          setMoodImageUrls(rawMoods.map((item: any) => (typeof item === "string" ? item : item.url)));
          const likedUrls = rawMoods
            .filter((item: any) => typeof item !== "string" && item.liked)
            .map((item: any) => item.url as string);
          if (likedUrls.length > 0) setMoodBookmarks(likedUrls);
        }
        if (briefsRes.data?.mood_bookmarks && Array.isArray(briefsRes.data.mood_bookmarks)) {
          setMoodBookmarks((prev) => {
            const existing = new Set(prev);
            const additional = (briefsRes.data!.mood_bookmarks as string[]).filter((u) => !existing.has(u));
            return additional.length > 0 ? [...prev, ...additional] : prev;
          });
        }
        if (projectRes.data) {
          const info = projectRes.data as ProjectInfo;
          projectActiveVersionIdRef.current = info.active_version_id;
          setProjectInfo(info);
          if (info.conti_style_id) {
            const { data: preset } = await supabase
              .from("style_presets")
              .select("id, name, description, thumbnail_url, style_prompt, is_default")
              .eq("id", info.conti_style_id)
              .single();
            if (preset) {
              setCurrentStyle(preset as StylePreset);
            } else {
              setCurrentStyle(null);
              setProjectInfo((prev) => ({ ...prev, conti_style_id: null }));
              await supabase.from("projects").update({ conti_style_id: null }).eq("id", projectId);
            }
          } else {
            setCurrentStyle(null);
          }
        }
        loadVersions(hasOngoing);
      },
    );
  }, [projectId]);

  const switchVersion = async (versionId: string) => {
    const { data } = await supabase.from("scene_versions").select("*").eq("id", versionId).single();
    if (!data) return;
    const version = data as SceneVersion;
    setVersions((prev) => prev.map((v) => (v.id === versionId ? { ...v, scenes: version.scenes } : v)));
    setActiveVersionId(versionId);
    const hydrated = await hydrateSceneHistory(version.scenes as Scene[]);
    setActiveScenes(hydrated);
    projectActiveVersionIdRef.current = versionId;
    replaceImageHistory(buildHistoryFromScenes(hydrated));
    const moduleState = getGeneratingScenes(projectId);
    setGeneratingSceneIds(new Set(moduleState));
    await supabase.from("projects").update({ active_version_id: versionId }).eq("id", projectId);
  };

  const handleDeleteVersion = async (versionId: string) => {
    const version = versions.find((v) => v.id === versionId);
    if (!version) return;
    const vName = version.version_name || `v${version.version_number}`;
    setDeleteVersionTarget({ id: versionId, name: vName });
  };

  const executeDeleteVersion = async (versionId: string) => {
    const version = versions.find((v) => v.id === versionId);
    if (!version) return;
    const vName = version.version_name || `v${version.version_number}`;
    const isReferenced = activeVersionId === versionId || projectActiveVersionIdRef.current === versionId;
    if (isReferenced) {
      projectActiveVersionIdRef.current = null;
      await supabase.from("projects").update({ active_version_id: null }).eq("id", projectId);
      setProjectInfo((p) => ({ ...p, active_version_id: null }));
    }
    const { error } = await supabase.from("scene_versions").delete().eq("id", versionId);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    setVersions((prev) => prev.filter((v) => v.id !== versionId));
    toast({ title: `"${vName}" deleted` });
    await loadVersions();
  };

  const handleSaveCurrentAsVersion = async () => {
    const scenes = currentScenes.length > 0 ? currentScenes : ((await fetchCurrentScenes()) ?? []);
    if (scenes.length === 0) {
      toast({ title: "No scenes to save", variant: "destructive" });
      return;
    }
    const num = versions.length + 1;
    await supabase.from("scene_versions").insert({
      project_id: projectId,
      version_number: num,
      version_name: `ver.${num}`,
      display_order: num,
      scenes: scenes as any,
      is_active: false,
    });
    toast({ title: `Saved as "ver.${num}".` });
    await loadVersions();
  };

  const activeVersionIdRef = useRef<string | null>(activeVersionId);
  useEffect(() => {
    activeVersionIdRef.current = activeVersionId;
  }, [activeVersionId]);

  const updateVersionScenes = useCallback(
    async (updatedScenes: Scene[]) => {
      // history 의 source of truth 는 scene 객체의 conti_image_history 필드.
      // imageHistoryRef 는 scene_number 키라 insert/delete/reorder 직후에는 꼬이기 때문에
      // 절대 fallback 으로 쓰면 안 된다 (예: TR 삽입 시 새 TR(#2) 이 구 #2 의 history 를 물려받는 버그).
      // scene 객체에 history 가 없으면 빈 배열로 취급한다 — legacy 데이터는 별도 hydrate 단계에서 채운다.
      const enriched = updatedScenes.map((s) => ({
        ...s,
        conti_image_history: Array.isArray(s.conti_image_history) ? s.conti_image_history : [],
      }));
      // ⚠️ 모듈 store 를 React state updater **바깥**에서 동기 갱신한다.
      // 컴포넌트 언마운트 후에도 in-flight 스타일 트랜스퍼/생성 루프가 다음 이터레이션에서
      // getSceneState() 로 최신 상태를 읽어 누적 업데이트 해야, 이전 이터레이션의 URL 이
      // 덮어쓰기로 롤백되는 사고(탭 이동 후 "생성이 안되" 버그)가 없어진다.
      const curActiveVid = getSceneState(projectId)?.activeVersionId ?? activeVersionIdRef.current ?? null;
      saveSceneState(projectId, enriched, curActiveVid);
      setActiveScenes(enriched);
      const vid = activeVersionIdRef.current;
      if (vid) {
        await supabase
          .from("scene_versions")
          .update({ scenes: enriched as any })
          .eq("id", vid);
        setVersions((prev) => prev.map((v) => (v.id === vid ? { ...v, scenes: enriched as any } : v)));
      }
    },
    [setActiveScenes, projectId],
  );

  const handleSceneUpdate = async (sceneNumber: number, fields: Partial<Scene>) => {
    const current = getSceneState(projectId)?.scenes ?? activeScenes;
    const target = current.find((s) => s.scene_number === sceneNumber);
    if (!target) return;
    await supabase.from("scenes").update(fields).eq("id", target.id);
    const latest = getSceneState(projectId)?.scenes ?? current;
    await updateVersionScenes(latest.map((s) => (s.scene_number === sceneNumber ? { ...s, ...fields } : s)));
  };

  const handleSetThumbnail = async (imageUrl: string) => {
    try {
      const { error } = await supabase
        .from("projects")
        .update({ thumbnail_url: imageUrl } as any)
        .eq("id", projectId);
      if (error) throw error;
      toast({ title: "Thumbnail updated" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed to set thumbnail", description: e.message });
    }
  };

  /**
   * 씬카드 이미지를 프로젝트의 스타일 프리셋(style_presets)으로 등록 + 현재 프로젝트의 활성 스타일로 즉시 적용.
   * - 해당 씬의 conti_image_url을 다운로드 → style-presets 버킷에 재업로드 → style_presets 행 insert
   * - 등록 성공 시 projects.conti_style_id를 방금 만든 프리셋으로 업데이트 + currentStyle/projectInfo 클라이언트 상태 동기화
   * - 스키마/경로 규약은 StylePickerModal.handleUploadStyle 과 동일.
   */
  const handleRegisterSceneAsStyle = useCallback(
    async (scene: Scene) => {
      if (!scene.conti_image_url) {
        toast({ variant: "destructive", title: "No image to register" });
        return;
      }
      try {
        const resp = await fetch(scene.conti_image_url);
        if (!resp.ok) throw new Error(`fetch failed (${resp.status})`);
        const blob = await resp.blob();
        const contentType = blob.type || "image/png";
        const ext = contentType.includes("png")
          ? "png"
          : contentType.includes("webp")
            ? "webp"
            : contentType.includes("jpeg") || contentType.includes("jpg")
              ? "jpg"
              : "png";
        const safeName = `scene-${scene.scene_number}-style-${Date.now()}.${ext}`.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `${projectId}/${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("style-presets")
          .upload(storagePath, blob, { upsert: true, contentType });
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from("style-presets").getPublicUrl(storagePath);
        const publicUrl = urlData.publicUrl;
        const presetName = `Scene ${scene.scene_number}${scene.title ? ` – ${scene.title}` : ""}`.slice(0, 60);
        const { data: inserted, error: insErr } = await supabase
          .from("style_presets")
          .insert({
            name: presetName,
            description: `From scene ${scene.scene_number}`,
            thumbnail_url: publicUrl,
            style_prompt: "Match the visual style, color palette, and artistic treatment of the reference image.",
            is_default: false,
            user_id: (await supabase.auth.getUser()).data.user?.id ?? null,
          })
          .select()
          .single();
        if (insErr) throw insErr;
        const newPreset = inserted as StylePreset;
        // 프로젝트의 활성 스타일로 즉시 승격
        const { error: projErr } = await supabase
          .from("projects")
          .update({ conti_style_id: newPreset.id })
          .eq("id", projectId);
        if (projErr) throw projErr;
        setCurrentStyle(newPreset);
        setProjectInfo((prev) => ({ ...prev, conti_style_id: newPreset.id }));
        toast({ title: `"${newPreset.name}" set as current style.` });
      } catch (e: any) {
        toast({
          variant: "destructive",
          title: "Failed to register style",
          description: e?.message ?? String(e),
        });
      }
    },
    [projectId, toast],
  );

  const handleDuplicateScene = async (scene: Scene) => {
    const tempNumber = 90000 + (Date.now() % 10000);
    const { data, error } = await supabase
      .from("scenes")
      .insert({
        project_id: projectId,
        scene_number: tempNumber,
        title: `${scene.title} (copy)`,
        description: scene.description,
        camera_angle: scene.camera_angle,
        location: scene.location,
        mood: scene.mood,
        duration_sec: scene.duration_sec,
        tagged_assets: scene.tagged_assets ?? [],
        conti_image_url: null,
        source: "conti",
      })
      .select()
      .single();
    if (error || !data) {
      toast({ title: "복제 실패", description: error?.message, variant: "destructive" });
      return;
    }
    // ⚠️ await 이후에는 반드시 모듈 store 로부터 최신 scene 배열을 다시 읽어야 한다.
    // 스타일 변형/전체 생성 루프가 진행 중이면, 위의 await 동안 다른 scene 들의
    // conti_image_url/conti_image_history 가 갱신되어 있다. activeScenes closure 는
    // stale 이라 그대로 쓰면 진행 중이던 변경사항(스타일 결과, 새 history 엔트리)을 롤백시킨다.
    const latest = getSceneState(projectId)?.scenes ?? activeScenes;
    const sourceIdxLatest = latest.findIndex((s) => s.id === scene.id);
    const insertIdx = sourceIdxLatest >= 0 ? sourceIdxLatest + 1 : latest.length;
    const newScenes = [...latest];
    newScenes.splice(insertIdx, 0, data as Scene);
    const renumbered = newScenes.map((s, i) => ({ ...s, scene_number: i + 1 }));
    const tempRenumbered = renumbered.map((s, i) => ({ ...s, scene_number: 80000 + i }));
    await Promise.all(
      tempRenumbered.map((s) => supabase.from("scenes").update({ scene_number: s.scene_number }).eq("id", s.id)),
    );
    await Promise.all(
      renumbered.map((s) => supabase.from("scenes").update({ scene_number: s.scene_number }).eq("id", s.id)),
    );
    await updateVersionScenes(renumbered);
    toast({ title: `Scene duplicated to position ${insertIdx + 1}.` });
  };

  const handleDeleteScene = async (sceneId: string, sceneNumber: number) => {
    const snapshot = getSceneState(projectId)?.scenes ?? activeScenes;
    const deletedScene = snapshot.find((s) => s.id === sceneId);
    const isTransition = deletedScene?.is_transition;
    await supabase.from("scenes").delete().eq("id", sceneId);
    // await 이후 최신 snapshot 재조회 (스타일 변형 루프가 중간에 다른 scene 업데이트 가능).
    const latest = getSceneState(projectId)?.scenes ?? activeScenes;
    const updated = latest.filter((s) => s.id !== sceneId).map((s, i) => ({ ...s, scene_number: i + 1 }));
    const tempUpdated = updated.map((s, i) => ({ ...s, scene_number: 80000 + i }));
    await Promise.all(
      tempUpdated.map((s) => supabase.from("scenes").update({ scene_number: s.scene_number }).eq("id", s.id)),
    );
    await Promise.all(
      updated.map((s) => supabase.from("scenes").update({ scene_number: s.scene_number }).eq("id", s.id)),
    );
    await updateVersionScenes(updated);
    toast({
      title: isTransition
        ? `Transition (${deletedScene?.transition_type ?? "TRANSITION"}) deleted.`
        : `Scene ${sceneNumber} deleted.`,
    });
  };

  const bulkDeleteScenes = async () => {
    const snapshot = getSceneState(projectId)?.scenes ?? activeScenes;
    const toDelete = snapshot.filter((s) => selectedSceneIds.has(s.id));
    await Promise.all(toDelete.map((s) => supabase.from("scenes").delete().eq("id", s.id)));
    const latest = getSceneState(projectId)?.scenes ?? activeScenes;
    const updated = latest
      .filter((s) => !selectedSceneIds.has(s.id))
      .map((s, i) => ({ ...s, scene_number: i + 1 }));
    await Promise.all(
      updated.map((s) => supabase.from("scenes").update({ scene_number: s.scene_number }).eq("id", s.id)),
    );
    await updateVersionScenes(updated);
    setSelectedSceneIds(new Set());
    toast({ title: `${toDelete.length} scene(s) deleted.` });
  };

  const handleAddScene = async () => {
    const snapshot = getSceneState(projectId)?.scenes ?? activeScenes;
    const tempNumber = 90000 + (Date.now() % 10000);
    const { data, error } = await supabase
      .from("scenes")
      .insert({
        project_id: projectId,
        scene_number: tempNumber,
        title: `Scene ${snapshot.length + 1}`,
        description: null,
        camera_angle: null,
        location: null,
        mood: null,
        duration_sec: null,
        tagged_assets: [],
        conti_image_url: null,
        source: "conti",
      })
      .select()
      .single();
    if (error || !data) {
      toast({ title: "Failed to add scene", description: error?.message, variant: "destructive" });
      return;
    }
    // await 이후 모듈 store 재조회 — 진행 중인 스타일 변형/생성 결과를 덮어쓰지 않기 위해.
    const latest = getSceneState(projectId)?.scenes ?? activeScenes;
    const updated = [...latest, data as Scene];
    const renumbered = updated.map((s, i) => ({ ...s, scene_number: i + 1 }));
    await supabase.from("scenes").update({ scene_number: renumbered.length }).eq("id", data.id);
    // scene_versions 에 직접 쓰면 imageHistory 병합이 누락되어 히스토리가 유실된다.
    await updateVersionScenes(renumbered);
  };

  const handleInsertSceneAt = async (insertIdx: number) => {
    const tempNumber = 90000 + (Date.now() % 10000);
    const { data, error } = await supabase
      .from("scenes")
      .insert({
        project_id: projectId,
        scene_number: tempNumber,
        title: `Scene ${insertIdx + 1}`,
        description: null,
        camera_angle: null,
        location: null,
        mood: null,
        duration_sec: null,
        tagged_assets: [],
        conti_image_url: null,
        source: "conti",
      })
      .select()
      .single();
    if (error || !data) {
      toast({ title: "Failed to add scene", description: error?.message, variant: "destructive" });
      return;
    }
    // await 이후 모듈 store 재조회.
    const latest = getSceneState(projectId)?.scenes ?? activeScenes;
    const safeInsertIdx = Math.min(insertIdx, latest.length);
    const updated = [...latest];
    updated.splice(safeInsertIdx, 0, data as Scene);
    const renumbered = updated.map((s, i) => ({ ...s, scene_number: i + 1 }));
    const tempRenumbered = renumbered.map((s, i) => ({ ...s, scene_number: 80000 + i }));
    await Promise.all(
      tempRenumbered.map((s) => supabase.from("scenes").update({ scene_number: s.scene_number }).eq("id", s.id)),
    );
    await Promise.all(
      renumbered.map((s) => supabase.from("scenes").update({ scene_number: s.scene_number }).eq("id", s.id)),
    );
    await updateVersionScenes(renumbered);
    toast({ title: `Scene inserted at position ${insertIdx + 1}.` });
  };

  const handleInsertTransitionAt = async (idx: number) => {
    const snapshot = getSceneState(projectId)?.scenes ?? activeScenes;
    const prevScene = snapshot[idx - 1];
    const nextScene = snapshot[idx];
    if (!prevScene?.conti_image_url || !nextScene?.conti_image_url) return;
    const tempNumber = 80000 + (Date.now() % 10000);
    const { data: newScene, error } = await supabase
      .from("scenes")
      .insert({
        project_id: projectId,
        scene_number: tempNumber,
        title: "",
        description: "",
        is_transition: true,
        transition_type: "TRANSITION",
        conti_image_url: null,
        source: "conti",
      })
      .select()
      .single();
    if (error || !newScene) {
      toast({ title: "Failed to add transition", description: error?.message, variant: "destructive" });
      return;
    }
    // await 이후 반드시 모듈 store 로 최신 scene 배열을 재조회.
    // 스타일 변형/전체 생성이 진행 중이면 activeScenes closure 는 stale 이므로,
    // 그대로 TR 을 꽂으면 이미 완료된 scene 들의 새 conti_image_url / conti_image_history 가 덮어써진다.
    // prevScene.id 를 기준으로 최신 배열에서 삽입 위치를 다시 계산한다.
    const latest = getSceneState(projectId)?.scenes ?? activeScenes;
    const prevIdxInLatest = latest.findIndex((s) => s.id === prevScene.id);
    const insertIdx = prevIdxInLatest >= 0 ? prevIdxInLatest + 1 : Math.min(idx, latest.length);
    const inserted = [...latest.slice(0, insertIdx), newScene as Scene, ...latest.slice(insertIdx)].map((s, i) => ({
      ...s,
      scene_number: i + 1,
    }));
    await Promise.all(
      inserted.map((s, i) =>
        supabase
          .from("scenes")
          .update({ scene_number: 80000 + i + 1 })
          .eq("id", s.id),
      ),
    );
    await Promise.all(
      inserted.map((s) => supabase.from("scenes").update({ scene_number: s.scene_number }).eq("id", s.id)),
    );
    await updateVersionScenes(inserted);
    toast({ title: "Transition added." });
  };

  const handleTransitionTypeChange = async (scene: Scene, newType: string) => {
    await supabase.from("scenes").update({ transition_type: newType, title: "" }).eq("id", scene.id);
    const latest = getSceneState(projectId)?.scenes ?? activeScenes;
    const updatedScenes = latest.map((s) =>
      s.id === scene.id ? { ...s, transition_type: newType, title: "" } : s,
    );
    await updateVersionScenes(updatedScenes);
    toast({ title: `Transition → ${newType}` });
  };

  const handleImportSceneImage = async (sceneNumber: number, imageUrl: string) => {
    const current = getSceneState(projectId)?.scenes ?? activeScenes;
    const target = current.find((s) => s.scene_number === sceneNumber);
    if (!target) return;
    pushHistory(target.id, target.conti_image_url ?? null);
    const latest = getSceneState(projectId)?.scenes ?? current;
    await updateVersionScenes(
      latest.map((s) => (s.id === target.id ? { ...s, conti_image_url: imageUrl } : s)),
    );
    bumpCache(target.scene_number);
    toast({ title: `Scene ${target.scene_number} conti replaced.` });
  };

  const handleRollback = async (scene: Scene, url: string) => {
    const current = getSceneState(projectId)?.scenes ?? activeScenes;
    const liveScene = current.find((s) => s.id === scene.id);
    pushHistory(scene.id, liveScene?.conti_image_url ?? scene.conti_image_url);
    await supabase.from("scenes").update({ conti_image_url: url }).eq("id", scene.id);
    const latest = getSceneState(projectId)?.scenes ?? current;
    const updated = latest.map((s) => (s.id === scene.id ? { ...s, conti_image_url: url } : s));
    if (activeVersionId) await updateVersionScenes(updated);
    else {
      setActiveScenes(updated);
      await fetchCurrentScenes();
    }
    bumpCache(scene.scene_number);
    toast({ title: `Scene ${scene.scene_number} restored.` });
  };

  const handleUploadConti = async (scene: Scene, file: File) => {
    setUploadingSceneIds((prev) => new Set(prev).add(scene.id));
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${projectId}/scene_${scene.scene_number}_upload_${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("contis").upload(path, file, { upsert: true });
      if (uploadError) throw new Error(uploadError.message);
      const publicUrl = supabase.storage.from("contis").getPublicUrl(path).data.publicUrl;
      if (!publicUrl) throw new Error("URL generation failed");
      const current = getSceneState(projectId)?.scenes ?? activeScenes;
      const liveScene = current.find((s) => s.id === scene.id);
      pushHistory(scene.id, liveScene?.conti_image_url ?? scene.conti_image_url);
      await supabase.from("scenes").update({ conti_image_url: publicUrl }).eq("id", scene.id);
      const latest = getSceneState(projectId)?.scenes ?? current;
      const updated = latest.map((s) => (s.id === scene.id ? { ...s, conti_image_url: publicUrl } : s));
      await updateVersionScenes(updated);
      bumpCache(scene.scene_number);
      toast({ title: `Scene ${scene.scene_number} image uploaded.` });
    } catch (err: any) {
      toast({ title: "업로드 실패", description: err.message, variant: "destructive" });
    } finally {
      setUploadingSceneIds((prev) => {
        const n = new Set(prev);
        n.delete(scene.id);
        return n;
      });
    }
  };

  type ContiModel = "gpt" | "nano-banana-2";
  const [contiModel, setContiModel] = useState<ContiModel>("nano-banana-2");
  const [showModelMenu, setShowModelMenu] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const MODEL_OPTIONS: { id: ContiModel; name: string; desc: string }[] = [
    { id: "nano-banana-2", name: "Nano Banana 2", desc: "구도+일관성 (기본)" },
    { id: "gpt", name: "GPT", desc: "범용 생성" },
  ];
  useEffect(() => {
    if (!showModelMenu) return;
    const handler = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) setShowModelMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showModelMenu]);

  const handleGenerate = async (scene: Scene) => {
    if (generatingSceneIds.has(scene.id)) return;

    if (scene.is_transition) {
      const idx = activeScenes.findIndex((s) => s.id === scene.id);
      const prevScene = activeScenes[idx - 1];
      const nextScene = activeScenes[idx + 1];
      if (!prevScene?.conti_image_url || !nextScene?.conti_image_url) {
        toast({ title: "Adjacent scenes need images first", variant: "destructive" });
        return;
      }
      setSceneStages((prev) => ({ ...prev, [scene.id]: "generating" }));
      updateGeneratingSceneIds((prev) => new Set(prev).add(scene.id));
      setGeneratingSceneVersionMap((prev) => ({ ...prev, [scene.id]: activeVersionId }));
      try {
        const { data: imgData } = await supabase.functions.invoke("openai-image", {
          body: {
            mode: "inpaint",
            prompt: `Create a single cinematic transition frame using ${scene.transition_type ?? "CUT"} technique. Blend these two scenes naturally.`,
            sourceImageUrl: prevScene.conti_image_url,
            referenceImageUrls: [nextScene.conti_image_url],
            useNanoBanana: true,
            projectId,
            sceneNumber: scene.scene_number,
            imageSize: IMAGE_SIZE_MAP[videoFormat],
          },
        });
        const newUrl = imgData?.publicUrl ?? imgData?.url ?? null;
        if (newUrl) {
          pushHistory(scene.id, scene.conti_image_url);
          await supabase.from("scenes").update({ conti_image_url: newUrl }).eq("id", scene.id);
          const current = getSceneState(projectId)?.scenes ?? activeScenes;
          const updated = current.map((s) => (s.id === scene.id ? { ...s, conti_image_url: newUrl } : s));
          await updateVersionScenes(updated);
          bumpCache(scene.scene_number);
        }
      } catch (err: any) {
        toast({ title: "Transition image failed", description: err.message, variant: "destructive" });
      } finally {
        updateGeneratingSceneIds((prev) => {
          const n = new Set(prev);
          n.delete(scene.id);
          return n;
        });
        setGeneratingSceneVersionMap((prev) => {
          const n = { ...prev };
          delete n[scene.id];
          return n;
        });
        setSceneStages((prev) => {
          const next = { ...prev };
          delete next[scene.id];
          return next;
        });
      }
      return;
    }

    setSceneStages((prev) => ({ ...prev, [scene.id]: "translating" }));
    updateGeneratingSceneIds((prev) => new Set(prev).add(scene.id));
    setGeneratingSceneVersionMap((prev) => ({ ...prev, [scene.id]: activeVersionId }));
    try {
      const styleAnchor = currentStyle?.style_prompt ?? undefined;
      const styleImageUrl = currentStyle?.thumbnail_url ?? undefined;
      const newUrl = await generateConti({
        scene,
        allScenes: activeScenes,
        projectId,
        videoFormat,
        briefAnalysis: briefAnalysisRef.current,
        styleAnchor,
        styleImageUrl,
        moodReferenceUrl: getMoodReferenceUrl(scene.scene_number),
        model: contiModel,
        onStageChange: (stage) => setSceneStages((prev) => ({ ...prev, [scene.id]: stage })),
      });
      pushHistory(scene.id, scene.conti_image_url);
      await supabase.from("scenes").update({ conti_image_url: newUrl }).eq("id", scene.id);
      const current = getSceneState(projectId)?.scenes ?? activeScenes;
      const updated = current.map((s) => (s.id === scene.id ? { ...s, conti_image_url: newUrl } : s));
      await updateVersionScenes(updated);
      bumpCache(scene.scene_number);
    } catch (err: any) {
      toast({
        title: `Scene ${scene.scene_number} generation failed`,
        description: err.message,
        variant: "destructive",
      });
    } finally {
      updateGeneratingSceneIds((prev) => {
        const n = new Set(prev);
        n.delete(scene.id);
        return n;
      });
      setGeneratingSceneVersionMap((prev) => {
        const n = { ...prev };
        delete n[scene.id];
        return n;
      });
      setSceneStages((prev) => {
        const next = { ...prev };
        delete next[scene.id];
        return next;
      });
    }
  };

  const runGenerateAll = async (mode: "all" | "missing") => {
    updateGeneratingAll(true);
    setGeneratingVersionId(activeVersionIdRef.current);
    const pending =
      mode === "all"
        ? activeScenes.filter((s) => s.description?.trim() && !s.is_transition)
        : activeScenes.filter((s) => !s.conti_image_url && s.description?.trim() && !s.is_transition);
    setQueuedSceneIds(new Set(pending.map((s) => s.id)));
    setSceneStages((prev) => {
      const next = { ...prev };
      pending.forEach((s) => {
        next[s.id] = "queued";
      });
      return next;
    });
    setGenerateProgress({ done: 0, total: pending.length });
    const styleAnchor = currentStyle?.style_prompt ?? undefined;
    const styleImageUrl = currentStyle?.thumbnail_url ?? undefined;
    let doneCount = 0;
    try {
      await Promise.all(
        pending.map(async (scene) => {
          setQueuedSceneIds((prev) => {
            const n = new Set(prev);
            n.delete(scene.id);
            return n;
          });
          updateGeneratingSceneIds((prev) => {
            const next = new Set(prev);
            next.add(scene.id);
            return next;
          });
          setGeneratingSceneVersionMap((prev) => ({ ...prev, [scene.id]: activeVersionIdRef.current }));
          try {
            const newUrl = await generateConti({
              scene,
              allScenes: getSceneState(projectId)?.scenes ?? activeScenes,
              projectId,
              videoFormat,
              briefAnalysis: briefAnalysisRef.current,
              styleAnchor,
              styleImageUrl,
              moodReferenceUrl: getMoodReferenceUrl(scene.scene_number),
              model: contiModel,
              onStageChange: (stage) => setSceneStages((prev) => ({ ...prev, [scene.id]: stage })),
            });
            pushHistory(scene.id, scene.conti_image_url);
            await supabase.from("scenes").update({ conti_image_url: newUrl }).eq("id", scene.id);
            // 언마운트 후에도 누적 업데이트가 가능하도록 module store 기반으로 다음 스냅샷을 만든다.
            // fallback 은 `[]` 가 아닌 activeScenes 여야 기존 scene 데이터가 통째로 날아가는 사고가 없다.
            const current = getSceneState(projectId)?.scenes ?? activeScenes;
            const updated = current.map((s) => (s.id === scene.id ? { ...s, conti_image_url: newUrl } : s));
            await updateVersionScenes(updated);
            bumpCache(scene.scene_number);
          } catch (err: any) {
            console.error(`Scene ${scene.scene_number} generation failed:`, err.message);
          } finally {
            updateGeneratingSceneIds((prev) => {
              const n = new Set(prev);
              n.delete(scene.id);
              return n;
            });
            setGeneratingSceneVersionMap((prev) => {
              const n = { ...prev };
              delete n[scene.id];
              return n;
            });
            doneCount++;
            setGenerateProgress({ done: doneCount, total: pending.length });
            setSceneStages((prev) => {
              const next = { ...prev };
              delete next[scene.id];
              return next;
            });
          }
        }),
      );
    } finally {
      updateGeneratingAll(false);
      setGenerateProgress(null);
      setQueuedSceneIds(new Set());
      setGeneratingVersionId(null);
      toast({ title: "All conti generated!" });
    }
  };

  const STYLE_BATCH = 2;

  const runStyleTransferAll = async (mode: "all" | "selected" = "all") => {
    const targetScenes =
      mode === "selected"
        ? activeScenes.filter((s) => s.conti_image_url && selectedSceneIds.has(s.id))
        : activeScenes.filter((s) => s.conti_image_url);
    if (!currentStyle || targetScenes.length === 0) return;

    setStyleTransferring(true);
    setStyleTransferProgress({ done: 0, total: targetScenes.length });
    const initialQueued = new Set(targetScenes.slice(STYLE_BATCH).map((s) => s.id));
    setQueuedSceneIds(initialQueued);

    // ⚠️ NB2 호출은 batch 내에서 병렬로 돌리되,
    // pushHistory / updateVersionScenes (모듈 store / DB 읽고-합치고-쓰기) 는 race condition 을 피하려
    // 단일 체인으로 직렬화한다. (두 scene 이 동시에 getSceneState().scenes 를 읽고 write-back 하면
    // last-writer 가 먼저 쓴 쪽의 conti_image_url 을 덮어쓰는 사고 발생.)
    let postProcessChain: Promise<void> = Promise.resolve();
    const enqueuePostProcess = (task: () => Promise<void>): Promise<void> => {
      postProcessChain = postProcessChain.then(task, task); // 이전 task 실패해도 다음 task 는 진행
      return postProcessChain;
    };
    let doneCount = 0;
    try {
      for (let i = 0; i < targetScenes.length; i += STYLE_BATCH) {
        const batch = targetScenes.slice(i, i + STYLE_BATCH);
        setStyleTransferringIds((prev) => {
          const n = new Set(prev);
          batch.forEach((s) => n.add(s.id));
          return n;
        });
        setQueuedSceneIds((prev) => {
          const n = new Set(prev);
          batch.forEach((s) => n.delete(s.id));
          return n;
        });
        await Promise.all(
          batch.map(async (scene) => {
            try {
              setSceneStages((prev) => ({ ...prev, [scene.id]: "generating" }));
              const oldUrl = scene.conti_image_url;
              console.log("[StyleTransfer/ContiTab] ▶ start scene", scene.scene_number, {
                id: scene.id,
                oldUrl,
                hasCurrentStyle: !!currentStyle,
                styleThumbUrl: currentStyle?.thumbnail_url ?? null,
                is_transition: !!scene.is_transition,
              });
              const newUrl = await styleTransfer({
                scene,
                projectId,
                videoFormat,
                styleImageUrl: currentStyle?.thumbnail_url ?? null,
                onStageChange: (stage) => setSceneStages((prev) => ({ ...prev, [scene.id]: stage })),
              });
              console.log("[StyleTransfer/ContiTab] ✓ got newUrl for scene", scene.scene_number, newUrl);
              // post-processing 을 체인에 enqueue — 완료될 때까지 await 해서 진행률/로딩 UI 가 정확히 맞도록.
              await enqueuePostProcess(async () => {
                pushHistory(scene.id, oldUrl);
                const { data: freshRow } = await supabase
                  .from("scenes")
                  .select("conti_image_crop")
                  .eq("id", scene.id)
                  .single();
                const preservedCrop = freshRow?.conti_image_crop ?? scene.conti_image_crop ?? null;
                const current = getSceneState(projectId)?.scenes ?? activeScenes;
                const updated = current.map((s) =>
                  s.id === scene.id ? { ...s, conti_image_url: newUrl, conti_image_crop: preservedCrop } : s,
                );
                await updateVersionScenes(updated);
                bumpCache(scene.scene_number);
                doneCount += 1;
                setStyleTransferProgress({ done: doneCount, total: targetScenes.length });
                console.log("[StyleTransfer/ContiTab] ✓ done scene", scene.scene_number);
              });
            } catch (err: any) {
              console.error(
                `[StyleTransfer/ContiTab] ✗ Scene ${scene.scene_number} FAILED:`,
                err?.message,
                err?.stack ?? err,
              );
            } finally {
              setStyleTransferringIds((prev) => {
                const n = new Set(prev);
                n.delete(scene.id);
                return n;
              });
              setSceneStages((prev) => {
                const n = { ...prev };
                delete n[scene.id];
                return n;
              });
            }
          }),
        );
      }
      // 마지막 post-process 까지 다 끝난 뒤 종료 (exception-proof).
      await postProcessChain.catch(() => {});
    } finally {
      setStyleTransferring(false);
      setStyleTransferProgress(null);
      setQueuedSceneIds(new Set());
      if (mode === "selected") setSelectedSceneIds(new Set());
      toast({ title: "Style transfer complete!" });
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const id = event.active.id as string;
    setDragActiveId(id);
    const scene = activeScenes.find((s) => s.id === id);
    if (scene) {
      const el = document.getElementById(`conti-scene-${scene.scene_number}`);
      if (el) {
        const clone = el.cloneNode(true) as HTMLDivElement;
        clone.style.width = `${el.offsetWidth}px`;
        dragCloneRef.current = clone;
      }
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setDragActiveId(null);
    dragCloneRef.current = null;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // 스타일 변형/생성이 진행 중이어도 드래그 이동이 안전하도록 최신 snapshot 사용.
    const snapshot = getSceneState(projectId)?.scenes ?? activeScenes;
    const oldIdx = snapshot.findIndex((s) => s.id === active.id);
    const newIdx = snapshot.findIndex((s) => s.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = arrayMove(snapshot, oldIdx, newIdx).map((s, i) => ({ ...s, scene_number: i + 1 }));
    await Promise.all(
      reordered.map((s) => supabase.from("scenes").update({ scene_number: s.scene_number }).eq("id", s.id)),
    );
    await updateVersionScenes(reordered);
  };

  function getExportCrop(
    stored: unknown,
    fmt: string,
  ): { x: number; y: number; scale: number; rotate?: number; ia?: number } | null {
    if (!stored || typeof stored !== "object") return null;
    const map = stored as Record<string, any>;
    if ("horizontal" in map || "vertical" in map || "square" in map) {
      const c = map[fmt];
      if (c && c._v === 2) return c;
      return null;
    }
    const s = stored as any;
    if (!s._v) return s;
    return null;
  }

  function computeExportImageLayout(imgAspect: number, containerAspect: number, scale: number, x: number, y: number) {
    let covWR: number, covHR: number;
    if (imgAspect >= containerAspect) {
      covHR = 1;
      covWR = imgAspect / containerAspect;
    } else {
      covWR = 1;
      covHR = containerAspect / imgAspect;
    }
    const s = scale + 0.2;
    const wPct = s * covWR * 100;
    const hPct = s * covHR * 100;
    return { wPct, hPct, leftPct: 50 - wPct / 2 + x, topPct: 50 - hPct / 2 + y };
  }

  const exportToPDFWithVersions = async (
    selectedVersions: { label: string; scenes: Scene[] }[],
    includeInfoParam: boolean = true,
  ) => {
    setIsExporting(true);
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 12;
      const cols = 5;
      const aspectMap: Record<string, string> = { vertical: "9/16", horizontal: "16/9", square: "1/1" };
      const aspect = aspectMap[videoFormat] ?? "9/16";
      const renderW = 2400;
      const padX = 24;
      const gapPx = 8;
      const cardW = (renderW - padX * 2 - gapPx * (cols - 1)) / cols;
      let isFirstPage = true;
      const stripAt = (s: string) => s.replace(/@/g, "");
      const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const getSceneLabel = (scene: Scene, scenes: Scene[]) => {
        if (scene.is_transition) return "TR";
        let counter = 0;
        for (const s of scenes) {
          if (!s.is_transition) counter++;
          if (s.id === scene.id) break;
        }
        return `S${String(counter).padStart(2, "0")}`;
      };
      const buildMetaRow = (label: string, value: string | null | undefined) => {
        const v = value || "—";
        return `<div style="display:flex; gap:6px; align-items:baseline;"><span style="font-size:9px; font-weight:500; color:#666; width:52px; flex-shrink:0;">${label}</span><span style="font-size:9px; color:#aaa;">${escHtml(v)}</span></div>`;
      };

      for (const { label, scenes } of selectedVersions) {
        const rows: Scene[][] = [];
        for (let i = 0; i < scenes.length; i += cols) rows.push(scenes.slice(i, i + cols));
        const rowsPerPage = 2;
        for (let pageStart = 0; pageStart < rows.length; pageStart += rowsPerPage) {
          if (!isFirstPage) pdf.addPage();
          isFirstPage = false;
          const pageRows = rows.slice(pageStart, pageStart + rowsPerPage);
          const container = document.createElement("div");
          container.style.cssText = `position:fixed; left:-9999px; top:0; z-index:-1; width:${renderW}px; background:#141414; padding:${padX}px; font-family:Pretendard,Inter,sans-serif; display:flex; flex-direction:column; gap:10px;`;
          const header = document.createElement("div");
          header.style.cssText = "display:flex; align-items:baseline; gap:8px; margin-bottom:2px;";
          header.innerHTML = `<span style="font-size:14px; font-weight:600; color:#ffffff;">${escHtml(projectInfo.title || "Pre-Flow")}</span><span style="font-size:12px; font-weight:400; color:#f9423a;">${escHtml(label)}</span>`;
          container.appendChild(header);
          const pageCardRows: HTMLDivElement[] = [];
          for (const row of pageRows) {
            const cardsRow = document.createElement("div");
            cardsRow.style.cssText = `display:flex; gap:${gapPx}px; align-items:stretch;`;
            for (const scene of row) {
              const card = document.createElement("div");
              card.style.cssText = `width:${cardW}px; background:#1a1a1a; border:1px solid rgba(255,255,255,0.07); border-radius:0; overflow:hidden; display:flex; flex-direction:column; box-sizing:border-box;`;
              const imgWrap = document.createElement("div");
              imgWrap.style.cssText = `position:relative; width:100%; aspect-ratio:${aspect}; background:#2a2a2a; overflow:hidden; border-radius:0; flex-shrink:0;`;
              if (scene.conti_image_url) {
                const exportCrop = getExportCrop(scene.conti_image_crop, videoFormat);
                if (exportCrop) {
                  const containerAspect = videoFormat === "vertical" ? 9 / 16 : videoFormat === "square" ? 1 : 16 / 9;
                  const ia = exportCrop.ia ?? containerAspect;
                  const layout = computeExportImageLayout(
                    ia,
                    containerAspect,
                    exportCrop.scale,
                    exportCrop.x,
                    exportCrop.y,
                  );
                  const imgEl = document.createElement("img");
                  imgEl.crossOrigin = "anonymous";
                  imgEl.src = scene.conti_image_url;
                  imgEl.style.cssText = `position:absolute;width:${layout.wPct}%;height:${layout.hPct}%;left:${layout.leftPct}%;top:${layout.topPct}%;object-fit:fill;display:block;background-color:#111;${exportCrop.rotate ? `transform:rotate(${exportCrop.rotate}deg);transform-origin:center center;` : ""}`;
                  imgWrap.appendChild(imgEl);
                } else {
                  const imgEl = document.createElement("img");
                  imgEl.crossOrigin = "anonymous";
                  imgEl.src = scene.conti_image_url;
                  imgEl.style.cssText =
                    "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;object-position:center;display:block;";
                  imgWrap.appendChild(imgEl);
                }
              } else if (scene.is_transition) {
                const flow = document.createElement("div");
                flow.style.cssText =
                  "position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;box-sizing:border-box;";
                const prevIdx = scenes.indexOf(scene);
                let prevLabel = "",
                  nextLabel = "";
                for (let pi = prevIdx - 1; pi >= 0; pi--) {
                  if (!scenes[pi].is_transition) {
                    let dn = 0;
                    for (let j = 0; j <= pi; j++) {
                      if (!scenes[j].is_transition) dn++;
                    }
                    prevLabel = `S${String(dn).padStart(2, "0")}`;
                    break;
                  }
                }
                for (let ni = prevIdx + 1; ni < scenes.length; ni++) {
                  if (!scenes[ni].is_transition) {
                    let dn = 0;
                    for (let j = 0; j <= ni; j++) {
                      if (!scenes[j].is_transition) dn++;
                    }
                    nextLabel = `S${String(dn).padStart(2, "0")}`;
                    break;
                  }
                }
                const svgNs = "http://www.w3.org/2000/svg";
                const svg = document.createElementNS(svgNs, "svg");
                svg.setAttribute("viewBox", "0 0 300 40");
                svg.setAttribute("width", "80%");
                svg.setAttribute("height", "40");
                svg.style.display = "block";
                svg.innerHTML = `<text x="4" y="20" dominant-baseline="middle" fill="#9ca3af" font-size="10" font-family="sans-serif">${prevLabel}</text><line x1="30" y1="20" x2="108" y2="20" stroke="#4b5563" stroke-width="0.8"/><circle cx="111" cy="20" r="3" fill="#4b5563"/><text x="150" y="20" dominant-baseline="middle" text-anchor="middle" fill="#6b7280" font-size="11" font-family="sans-serif">Transition</text><circle cx="189" cy="20" r="3" fill="#4b5563"/><line x1="192" y1="20" x2="264" y2="20" stroke="#4b5563" stroke-width="0.8"/><polygon points="264,16 272,20 264,24" fill="#4b5563"/><text x="276" y="20" dominant-baseline="middle" fill="#9ca3af" font-size="10" font-family="sans-serif">${nextLabel}</text>`;
                flow.appendChild(svg);
                imgWrap.appendChild(flow);
              } else {
                const noImg = document.createElement("div");
                noImg.style.cssText =
                  "width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:#555; font-size:11px;";
                noImg.textContent = "No Image";
                imgWrap.appendChild(noImg);
              }
              card.appendChild(imgWrap);
              const textArea = document.createElement("div");
              textArea.style.cssText = "padding:5px 8px 8px 8px; display:flex; flex-direction:column; gap:5px; flex:1;";
              const titleRow = document.createElement("div");
              titleRow.style.cssText = "display:flex; align-items:flex-start; gap:6px;";
              const sceneLabel = document.createElement("div");
              sceneLabel.style.cssText = `font-size:11px; font-weight:600; color:${scene.is_transition ? "#6b7280" : "#f9423a"}; line-height:1.3; flex-shrink:0;`;
              sceneLabel.textContent = getSceneLabel(scene, scenes);
              titleRow.appendChild(sceneLabel);
              if (includeInfoParam && !scene.is_transition) {
                const title = document.createElement("div");
                title.style.cssText =
                  "font-size:11px; font-weight:600; color:#ffffff; word-break:break-word; line-height:1.3; flex:1;";
                title.textContent = stripAt(scene.title || `Scene ${scene.scene_number}`);
                titleRow.appendChild(title);
              }
              textArea.appendChild(titleRow);
              if (includeInfoParam) {
                const metaWrap = document.createElement("div");
                metaWrap.style.cssText = "display:flex; flex-direction:column; gap:2px;";
                metaWrap.innerHTML = [
                  buildMetaRow("Camera", scene.camera_angle ? stripAt(scene.camera_angle) : null),
                  buildMetaRow("Mood", scene.mood ? stripAt(scene.mood) : null),
                  buildMetaRow("Location", scene.location ? stripAt(scene.location) : null),
                  buildMetaRow("Duration", scene.duration_sec ? `${scene.duration_sec}s` : null),
                ].join("");
                textArea.appendChild(metaWrap);
              }
              if (scene.description) {
                const desc = document.createElement("div");
                desc.style.cssText =
                  "font-size:9px; color:#999; line-height:1.45; margin-top:3px; white-space:pre-wrap; word-break:break-word;";
                desc.textContent = stripAt(scene.description);
                textArea.appendChild(desc);
              }
              card.appendChild(textArea);
              cardsRow.appendChild(card);
            }
            container.appendChild(cardsRow);
            pageCardRows.push(cardsRow);
          }
          document.body.appendChild(container);
          const imageUrls = pageRows.flatMap((r) => r.map((s) => s.conti_image_url)).filter(Boolean) as string[];
          await Promise.all(
            imageUrls.map(
              (url) =>
                new Promise<void>((resolve) => {
                  const img = new Image();
                  img.crossOrigin = "anonymous";
                  img.onload = () => resolve();
                  img.onerror = () => resolve();
                  img.src = url;
                }),
            ),
          );
          const allCards = pageCardRows.flatMap((rowEl) =>
            Array.from(rowEl.querySelectorAll<HTMLElement>(":scope > div")),
          );
          let maxCardH = 0;
          allCards.forEach((cardEl) => {
            maxCardH = Math.max(maxCardH, cardEl.offsetHeight);
          });
          allCards.forEach((cardEl) => {
            cardEl.style.height = `${maxCardH}px`;
          });
          const canvas = await html2canvas(container, {
            useCORS: true,
            backgroundColor: "#141414",
            scale: 3,
            imageTimeout: 20000,
          });
          const imgData = canvas.toDataURL("image/png");
          const ratio = canvas.width / canvas.height;
          const contentW = pageW - margin * 2;
          let drawW = contentW;
          let drawH = drawW / ratio;
          if (drawH > pageH - margin * 2) {
            drawH = pageH - margin * 2;
            drawW = drawH * ratio;
          }
          pdf.setFillColor(20, 20, 20);
          pdf.rect(0, 0, pageW, pageH, "F");
          pdf.addImage(imgData, "PNG", (pageW - drawW) / 2, (pageH - drawH) / 2, drawW, drawH);
          document.body.removeChild(container);
        }
      }
      pdf.save(`${projectInfo.title || "pre-flow"}_conti.pdf`);
      toast({ title: "PDF exported!" });
    } catch (err: any) {
      toast({ title: "PDF export failed", description: err.message, variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const exportToPNGWithVersions = async (
    selectedVersions: { label: string; scenes: Scene[] }[],
    scale: number,
    mode: "page" | "individual",
    includeInfo: boolean,
  ) => {
    setIsExporting(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const allFiles: { name: string; blob: Blob; folder?: string }[] = [];
      const aspectMap: Record<string, string> = { vertical: "9/16", horizontal: "16/9", square: "1/1" };
      const aspect = aspectMap[videoFormat] ?? "9/16";
      const stripAt = (s: string) => s.replace(/@/g, "");
      const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9가-힣_-]/g, "_").slice(0, 30);
      const getSceneLabel = (scene: Scene, scenes: Scene[]) => {
        if (scene.is_transition) return "TR";
        let counter = 0;
        for (const s of scenes) {
          if (!s.is_transition) counter++;
          if (s.id === scene.id) break;
        }
        return `S${String(counter).padStart(2, "0")}`;
      };
      const buildMetaRow = (label: string, value: string | null | undefined, large = false) => {
        const v = value || "—";
        const fs = large ? "12px" : "9px";
        const lw = large ? "62px" : "52px";
        return `<div style="display:flex; gap:6px; align-items:baseline;"><span style="font-size:${fs}; font-weight:500; color:#666; width:${lw}; flex-shrink:0;">${label}</span><span style="font-size:${fs}; color:#aaa;">${escHtml(v)}</span></div>`;
      };

      if (mode === "page") {
        const cols = 5;
        const renderW = 2400;
        const padX = 24;
        const gapPx = 8;
        const cardW = (renderW - padX * 2 - gapPx * (cols - 1)) / cols;
        for (const { label, scenes } of selectedVersions) {
          const rows: Scene[][] = [];
          for (let i = 0; i < scenes.length; i += cols) rows.push(scenes.slice(i, i + cols));
          const rowsPerPage = 2;
          const folderName = selectedVersions.length > 1 ? label : undefined;
          for (let pageStart = 0; pageStart < rows.length; pageStart += rowsPerPage) {
            const pageRows = rows.slice(pageStart, pageStart + rowsPerPage);
            const container = document.createElement("div");
            container.style.cssText = `position:fixed; left:-9999px; top:0; z-index:-1; width:${renderW}px; background:#141414; padding:${padX}px; font-family:Pretendard,Inter,sans-serif; display:flex; flex-direction:column; gap:10px;`;
            const header = document.createElement("div");
            header.style.cssText = "display:flex; align-items:baseline; gap:8px; margin-bottom:2px;";
            header.innerHTML = `<span style="font-size:14px; font-weight:600; color:#ffffff;">${escHtml(projectInfo.title || "Pre-Flow")}</span><span style="font-size:12px; font-weight:400; color:#f9423a;">${escHtml(label)}</span>`;
            container.appendChild(header);
            const pageCardRows: HTMLDivElement[] = [];
            for (const row of pageRows) {
              const cardsRow = document.createElement("div");
              cardsRow.style.cssText = `display:flex; gap:${gapPx}px; align-items:stretch;`;
              for (const scene of row) {
                const card = document.createElement("div");
                card.style.cssText = `width:${cardW}px; background:#1a1a1a; border:1px solid rgba(255,255,255,0.07); border-radius:0; overflow:hidden; display:flex; flex-direction:column; box-sizing:border-box;`;
                const imgWrap = document.createElement("div");
                imgWrap.style.cssText = `position:relative; width:100%; aspect-ratio:${aspect}; background:#2a2a2a; overflow:hidden; flex-shrink:0;`;
                if (scene.conti_image_url) {
                  const exportCrop = getExportCrop(scene.conti_image_crop, videoFormat);
                  if (exportCrop) {
                    const containerAspect = videoFormat === "vertical" ? 9 / 16 : videoFormat === "square" ? 1 : 16 / 9;
                    const ia = exportCrop.ia ?? containerAspect;
                    const layout = computeExportImageLayout(
                      ia,
                      containerAspect,
                      exportCrop.scale,
                      exportCrop.x,
                      exportCrop.y,
                    );
                    const imgEl = document.createElement("img");
                    imgEl.crossOrigin = "anonymous";
                    imgEl.src = scene.conti_image_url;
                    imgEl.style.cssText = `position:absolute;width:${layout.wPct}%;height:${layout.hPct}%;left:${layout.leftPct}%;top:${layout.topPct}%;object-fit:fill;display:block;background-color:#111;${exportCrop.rotate ? `transform:rotate(${exportCrop.rotate}deg);transform-origin:center center;` : ""}`;
                    imgWrap.appendChild(imgEl);
                  } else {
                    const imgEl = document.createElement("img");
                    imgEl.crossOrigin = "anonymous";
                    imgEl.src = scene.conti_image_url;
                    imgEl.style.cssText =
                      "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;object-position:center;display:block;";
                    imgWrap.appendChild(imgEl);
                  }
                } else if (scene.is_transition) {
                  const flow = document.createElement("div");
                  flow.style.cssText =
                    "position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;box-sizing:border-box;";
                  const prevIdx = scenes.indexOf(scene);
                  let prevLabel = "",
                    nextLabel = "";
                  for (let pi = prevIdx - 1; pi >= 0; pi--) {
                    if (!scenes[pi].is_transition) {
                      let dn = 0;
                      for (let j = 0; j <= pi; j++) {
                        if (!scenes[j].is_transition) dn++;
                      }
                      prevLabel = `S${String(dn).padStart(2, "0")}`;
                      break;
                    }
                  }
                  for (let ni = prevIdx + 1; ni < scenes.length; ni++) {
                    if (!scenes[ni].is_transition) {
                      let dn = 0;
                      for (let j = 0; j <= ni; j++) {
                        if (!scenes[j].is_transition) dn++;
                      }
                      nextLabel = `S${String(dn).padStart(2, "0")}`;
                      break;
                    }
                  }
                  const svgNs = "http://www.w3.org/2000/svg";
                  const svg = document.createElementNS(svgNs, "svg");
                  svg.setAttribute("viewBox", "0 0 300 40");
                  svg.setAttribute("width", "80%");
                  svg.setAttribute("height", "40");
                  svg.style.display = "block";
                  svg.innerHTML = `<text x="4" y="20" dominant-baseline="middle" fill="#9ca3af" font-size="10" font-family="sans-serif">${prevLabel}</text><line x1="30" y1="20" x2="108" y2="20" stroke="#4b5563" stroke-width="0.8"/><circle cx="111" cy="20" r="3" fill="#4b5563"/><text x="150" y="20" dominant-baseline="middle" text-anchor="middle" fill="#6b7280" font-size="11" font-family="sans-serif">Transition</text><circle cx="189" cy="20" r="3" fill="#4b5563"/><line x1="192" y1="20" x2="264" y2="20" stroke="#4b5563" stroke-width="0.8"/><polygon points="264,16 272,20 264,24" fill="#4b5563"/><text x="276" y="20" dominant-baseline="middle" fill="#9ca3af" font-size="10" font-family="sans-serif">${nextLabel}</text>`;
                  flow.appendChild(svg);
                  imgWrap.appendChild(flow);
                } else {
                  const noImg = document.createElement("div");
                  noImg.style.cssText =
                    "width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:#555; font-size:11px;";
                  noImg.textContent = "No Image";
                  imgWrap.appendChild(noImg);
                }
                card.appendChild(imgWrap);
                const textArea = document.createElement("div");
                textArea.style.cssText =
                  "padding:5px 8px 8px 8px; display:flex; flex-direction:column; gap:5px; flex:1;";
                const titleRow = document.createElement("div");
                titleRow.style.cssText = "display:flex; align-items:flex-start; gap:6px;";
                const sceneLabel = document.createElement("div");
                sceneLabel.style.cssText = `font-size:11px; font-weight:600; color:${scene.is_transition ? "#6b7280" : "#f9423a"}; line-height:1.3; flex-shrink:0;`;
                sceneLabel.textContent = getSceneLabel(scene, scenes);
                titleRow.appendChild(sceneLabel);
                if (includeInfo && !scene.is_transition) {
                  const title = document.createElement("div");
                  title.style.cssText =
                    "font-size:11px; font-weight:600; color:#ffffff; word-break:break-word; line-height:1.3; flex:1;";
                  title.textContent = stripAt(scene.title || `Scene ${scene.scene_number}`);
                  titleRow.appendChild(title);
                }
                textArea.appendChild(titleRow);
                if (includeInfo) {
                  const metaWrap = document.createElement("div");
                  metaWrap.style.cssText = "display:flex; flex-direction:column; gap:2px;";
                  metaWrap.innerHTML = [
                    buildMetaRow("Camera", scene.camera_angle ? stripAt(scene.camera_angle) : null),
                    buildMetaRow("Mood", scene.mood ? stripAt(scene.mood) : null),
                    buildMetaRow("Location", scene.location ? stripAt(scene.location) : null),
                    buildMetaRow("Duration", scene.duration_sec ? `${scene.duration_sec}s` : null),
                  ].join("");
                  textArea.appendChild(metaWrap);
                }
                if (scene.description) {
                  const desc = document.createElement("div");
                  desc.style.cssText =
                    "font-size:9px; color:#999; line-height:1.45; margin-top:3px; white-space:pre-wrap; word-break:break-word;";
                  desc.textContent = stripAt(scene.description);
                  textArea.appendChild(desc);
                }
                card.appendChild(textArea);
                cardsRow.appendChild(card);
              }
              container.appendChild(cardsRow);
              pageCardRows.push(cardsRow);
            }
            document.body.appendChild(container);
            const bgUrls = pageRows.flatMap((r) => r.map((s) => s.conti_image_url)).filter(Boolean) as string[];
            await Promise.all(
              bgUrls.map(
                (url) =>
                  new Promise<void>((resolve) => {
                    const img = new Image();
                    img.crossOrigin = "anonymous";
                    img.onload = () => resolve();
                    img.onerror = () => resolve();
                    img.src = url;
                  }),
              ),
            );
            const allCards = pageCardRows.flatMap((r) => Array.from(r.querySelectorAll<HTMLElement>(":scope > div")));
            let maxH = 0;
            allCards.forEach((c) => {
              maxH = Math.max(maxH, c.offsetHeight);
            });
            allCards.forEach((c) => {
              c.style.height = `${maxH}px`;
            });
            const canvas = await html2canvas(container, {
              useCORS: true,
              backgroundColor: "#141414",
              scale,
              imageTimeout: 20000,
            });
            const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
            const pageNum = Math.floor(pageStart / rowsPerPage) + 1;
            allFiles.push({ name: `page_${pageNum}.png`, blob, folder: folderName });
            document.body.removeChild(container);
          }
        }
      } else {
        for (const { label, scenes } of selectedVersions) {
          const folderName = selectedVersions.length > 1 ? label : undefined;
          for (const scene of scenes) {
            const container = document.createElement("div");
            container.style.cssText = `position:fixed; left:-9999px; top:0; z-index:-1; width:800px; background:#141414; font-family:Pretendard,Inter,sans-serif; display:flex; flex-direction:column;`;
            const imgWrap = document.createElement("div");
            imgWrap.style.cssText = `position:relative; width:100%; aspect-ratio:${aspect}; background:#2a2a2a; overflow:hidden;`;
            if (scene.conti_image_url) {
              const exportCrop = getExportCrop(scene.conti_image_crop, videoFormat);
              if (exportCrop) {
                const containerAspect = videoFormat === "vertical" ? 9 / 16 : videoFormat === "square" ? 1 : 16 / 9;
                const ia = exportCrop.ia ?? containerAspect;
                const layout = computeExportImageLayout(
                  ia,
                  containerAspect,
                  exportCrop.scale,
                  exportCrop.x,
                  exportCrop.y,
                );
                const imgEl = document.createElement("img");
                imgEl.crossOrigin = "anonymous";
                imgEl.src = scene.conti_image_url;
                imgEl.style.cssText = `position:absolute;width:${layout.wPct}%;height:${layout.hPct}%;left:${layout.leftPct}%;top:${layout.topPct}%;object-fit:fill;display:block;background-color:#111;${exportCrop.rotate ? `transform:rotate(${exportCrop.rotate}deg);transform-origin:center center;` : ""}`;
                imgWrap.appendChild(imgEl);
              } else {
                const imgEl = document.createElement("img");
                imgEl.crossOrigin = "anonymous";
                imgEl.src = scene.conti_image_url;
                imgEl.style.cssText =
                  "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;object-position:center;display:block;";
                imgWrap.appendChild(imgEl);
              }
            } else if (scene.is_transition) {
              const flow = document.createElement("div");
              flow.style.cssText =
                "position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;padding:0 24px;box-sizing:border-box;";
              const prevIdx = scenes.indexOf(scene);
              let prevLabel = "",
                nextLabel = "";
              for (let pi = prevIdx - 1; pi >= 0; pi--) {
                if (!scenes[pi].is_transition) {
                  let dn = 0;
                  for (let j = 0; j <= pi; j++) {
                    if (!scenes[j].is_transition) dn++;
                  }
                  prevLabel = `S${String(dn).padStart(2, "0")}`;
                  break;
                }
              }
              for (let ni = prevIdx + 1; ni < scenes.length; ni++) {
                if (!scenes[ni].is_transition) {
                  let dn = 0;
                  for (let j = 0; j <= ni; j++) {
                    if (!scenes[j].is_transition) dn++;
                  }
                  nextLabel = `S${String(dn).padStart(2, "0")}`;
                  break;
                }
              }
              if (prevLabel) {
                const p = document.createElement("span");
                p.style.cssText =
                  "font-size:14px;font-family:monospace;font-weight:700;color:rgba(255,255,255,0.3);flex-shrink:0;line-height:1;";
                p.textContent = prevLabel;
                flow.appendChild(p);
              }
              const lL = document.createElement("div");
              lL.style.cssText = "flex:1;height:1px;background:rgba(255,255,255,0.15);";
              flow.appendChild(lL);
              const dL = document.createElement("div");
              dL.style.cssText =
                "width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,0.3);flex-shrink:0;";
              flow.appendChild(dL);
              const lM1 = document.createElement("div");
              lM1.style.cssText = "flex:1;height:1px;background:rgba(255,255,255,0.15);";
              flow.appendChild(lM1);
              const cl = document.createElement("span");
              cl.style.cssText =
                "font-size:14px;font-weight:600;color:rgba(255,255,255,0.45);letter-spacing:0.04em;flex-shrink:0;padding:0 10px;line-height:1;";
              cl.textContent = "Transition";
              flow.appendChild(cl);
              const lM2 = document.createElement("div");
              lM2.style.cssText = "flex:1;height:1px;background:rgba(255,255,255,0.15);";
              flow.appendChild(lM2);
              const dR = document.createElement("div");
              dR.style.cssText =
                "width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,0.3);flex-shrink:0;";
              flow.appendChild(dR);
              const lR = document.createElement("div");
              lR.style.cssText = "flex:1;height:1px;background:rgba(255,255,255,0.15);";
              flow.appendChild(lR);
              const ar = document.createElement("div");
              ar.style.cssText =
                "width:0;height:0;border-top:4px solid transparent;border-bottom:4px solid transparent;border-left:7px solid rgba(255,255,255,0.3);flex-shrink:0;";
              flow.appendChild(ar);
              if (nextLabel) {
                const n = document.createElement("span");
                n.style.cssText =
                  "font-size:14px;font-family:monospace;font-weight:700;color:rgba(255,255,255,0.3);flex-shrink:0;padding-left:3px;line-height:1;";
                n.textContent = nextLabel;
                flow.appendChild(n);
              }
              imgWrap.appendChild(flow);
            } else {
              const noImg = document.createElement("div");
              noImg.style.cssText =
                "width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:#555; font-size:14px;";
              noImg.textContent = "No Image";
              imgWrap.appendChild(noImg);
            }
            container.appendChild(imgWrap);
            const textArea = document.createElement("div");
            textArea.style.cssText =
              "padding:10px 14px 16px; display:flex; flex-direction:column; gap:6px; background:#1a1a1a;";
            const indTitleRow = document.createElement("div");
            indTitleRow.style.cssText = "display:flex; align-items:baseline; gap:8px;";
            const indSceneLabel = document.createElement("span");
            indSceneLabel.style.cssText = `font-size:14px; font-weight:700; color:${scene.is_transition ? "#6b7280" : "#f9423a"}; line-height:1.3; flex-shrink:0;`;
            indSceneLabel.textContent = getSceneLabel(scene, scenes);
            indTitleRow.appendChild(indSceneLabel);
            if (includeInfo && !scene.is_transition) {
              const indTitleEl = document.createElement("span");
              indTitleEl.style.cssText =
                "font-size:14px; font-weight:600; color:#ffffff; line-height:1.3; word-break:break-word;";
              indTitleEl.textContent = stripAt(scene.title || `Scene ${scene.scene_number}`);
              indTitleRow.appendChild(indTitleEl);
            }
            textArea.appendChild(indTitleRow);
            if (includeInfo && !scene.is_transition) {
              const indMetaWrap = document.createElement("div");
              indMetaWrap.style.cssText = "display:flex; flex-direction:column; gap:2px;";
              indMetaWrap.innerHTML = [
                buildMetaRow("Camera", scene.camera_angle ? stripAt(scene.camera_angle) : null, true),
                buildMetaRow("Mood", scene.mood ? stripAt(scene.mood) : null, true),
                buildMetaRow("Location", scene.location ? stripAt(scene.location) : null, true),
                buildMetaRow("Duration", scene.duration_sec ? `${scene.duration_sec}s` : null, true),
              ].join("");
              textArea.appendChild(indMetaWrap);
            }
            if (scene.description) {
              const indDesc = document.createElement("div");
              indDesc.style.cssText =
                "font-size:13px; color:#999; line-height:1.5; white-space:pre-wrap; word-break:break-word;";
              indDesc.textContent = stripAt(scene.description);
              textArea.appendChild(indDesc);
            }
            container.appendChild(textArea);
            document.body.appendChild(container);
            if (scene.conti_image_url) {
              await new Promise<void>((resolve) => {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => resolve();
                img.onerror = () => resolve();
                img.src = scene.conti_image_url!;
              });
            }
            const canvas = await html2canvas(container, {
              useCORS: true,
              backgroundColor: "#141414",
              scale,
              imageTimeout: 20000,
            });
            const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
            const fileName = `${getSceneLabel(scene, scenes)}_${sanitize(scene.title || "untitled")}.png`;
            allFiles.push({ name: fileName, blob, folder: folderName });
            document.body.removeChild(container);
          }
        }
      }

      if (allFiles.length === 1) {
        const f = allFiles[0];
        const url = URL.createObjectURL(f.blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = f.name;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        for (const f of allFiles) {
          if (f.folder) zip.folder(f.folder)!.file(f.name, f.blob);
          else zip.file(f.name, f.blob);
        }
        const zipBlob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${projectInfo.title || "pre-flow"}_conti${mode === "individual" ? "_scenes" : ""}.zip`;
        a.click();
        URL.revokeObjectURL(url);
      }
      toast({ title: "PNG exported!" });
    } catch (err: any) {
      toast({ title: "PNG export failed", description: err.message, variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const assetMap: Record<string, Asset> = {};
  for (const a of assets) assetMap[a.tag_name.replace(/^@/, "")] = a;

  const gridClass = viewMode === "single" ? "grid-cols-1" : viewMode === "grid2" ? "grid-cols-2" : "";
  const gridStyle: React.CSSProperties =
    viewMode === "auto" ? { gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))` } : {};

  const noDescriptionCount = activeScenes.filter((s) => !s.is_transition && !s.description?.trim()).length;
  const scenesWithImages = activeScenes.filter((s) => !s.is_transition && s.conti_image_url).length;
  const dragActiveScene = dragActiveId ? activeScenes.find((s) => s.id === dragActiveId) : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── 버전 탭 바 ── */}
      {versions.length > 0 && (
        <DndContext sensors={versionSensors} collisionDetection={closestCenter} onDragEnd={handleVersionDragEnd}>
          <div
            className="flex items-center gap-0.5 px-3 pt-2 pb-0 overflow-x-auto shrink-0"
            style={{ background: "#0d0d0d", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
          >
            <SortableContext items={versions.map((v) => v.id)} strategy={horizontalListSortingStrategy}>
              {versions.map((v, idx) => {
                const isActive = v.id === activeVersionId;
                return (
                  <SortableVersionTab key={v.id} id={v.id}>
                    {(dragListeners, dragAttributes) => (
                      <div className="relative shrink-0 group/vtab">
                        <button
                          onClick={() => switchVersion(v.id)}
                          className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono font-medium transition-colors cursor-pointer active:cursor-grabbing"
                          {...dragListeners}
                          {...dragAttributes}
                          style={{
                            borderBottom: isActive ? `2px solid ${KR}` : "2px solid transparent",
                            color: isActive ? "#f0f0f0" : "rgba(255,255,255,0.3)",
                            background: "transparent",
                            borderRadius: 0,
                          }}
                        >
                          <span
                            className="font-mono text-[9px] font-bold px-1.5 py-0.5 text-white shrink-0"
                            style={{ background: isActive ? KR : "rgba(255,255,255,0.15)", borderRadius: 2 }}
                          >
                            {`ver.${idx + 1}`}
                          </span>
                          <span className="tracking-wide">{v.version_name || `v${v.version_number}`}</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            setTabMenuAnchor((prev) =>
                              prev?.id === v.id ? null : { id: v.id, x: rect.left, y: rect.bottom + 4 },
                            );
                          }}
                          className="absolute top-1 right-[-5px] w-4 h-4 flex items-center justify-center opacity-0 group-hover/vtab:opacity-100 hover:!opacity-100 transition-all"
                          style={{ border: "none", cursor: "pointer", borderRadius: 2 }}
                        >
                          <svg width={10} height={10} viewBox="0 0 24 24" fill="rgba(255,255,255,0.4)" stroke="none">
                            <circle cx="12" cy="5" r="2" />
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="12" cy="19" r="2" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </SortableVersionTab>
                );
              })}
            </SortableContext>
            <button
              onClick={() => setShowNewVersionModal(true)}
              className="flex items-center gap-1 px-2 py-1.5 text-[10px] font-mono tracking-wide hover:text-foreground transition-colors shrink-0"
              style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.25)" }}
            >
              <Plus className="w-2.5 h-2.5" />
              New
            </button>
            <div className="flex-1" />
          </div>
        </DndContext>
      )}

      {/* 탭 컨텍스트 메뉴 */}
      {tabMenuAnchor &&
        (() => {
          const menuId = tabMenuAnchor.id;
          return (
            <div
              style={{
                position: "fixed",
                top: tabMenuAnchor.y,
                left: tabMenuAnchor.x,
                zIndex: 300,
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 0,
                minWidth: 140,
                overflow: "hidden",
                boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
              }}
              onMouseLeave={() => setTabMenuAnchor(null)}
            >
              {[
                {
                  label: "Rename",
                  fn: () => {
                    const v = versions.find((x) => x.id === menuId);
                    if (v) {
                      setRenameVersion(v);
                      setTabMenuAnchor(null);
                    }
                  },
                },
                {
                  label: "Delete",
                  fn: () => {
                    setTabMenuAnchor(null);
                    handleDeleteVersion(menuId);
                  },
                  danger: true,
                },
              ].map((item, i) => (
                <button
                  key={i}
                  onClick={item.fn}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    padding: "9px 14px",
                    fontSize: 12,
                    cursor: "pointer",
                    border: "none",
                    textAlign: "left",
                    fontFamily: "inherit",
                    background: "transparent",
                    color: (item as any).danger ? "hsl(var(--destructive))" : "hsl(var(--foreground))",
                  }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "hsl(var(--muted))")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                >
                  {item.label}
                </button>
              ))}
            </div>
          );
        })()}

      {/* ── 서브 바 ── */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 shrink-0"
        style={{ background: "#0d0d0d", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <span className="text-[10px] font-mono tracking-wide" style={{ color: "rgba(255,255,255,0.35)" }}>
          Sc {activeScenes.filter((s) => !s.is_transition).length} · Img {scenesWithImages}/
          {activeScenes.filter((s) => !s.is_transition).length}
        </span>
        {noDescriptionCount > 0 && !generatingAll && (
          <span className="text-[10px] font-mono" style={{ color: "#d97706" }}>
            ⚠ {noDescriptionCount} no desc
          </span>
        )}
        {generateProgress && (
          <span className="text-[10px] font-mono font-bold" style={{ color: KR }}>
            GEN {generateProgress.done}/{generateProgress.total}
          </span>
        )}
        {styleTransferProgress && (
          <span className="text-[10px] font-mono font-bold" style={{ color: KR }}>
            STY {styleTransferProgress.done}/{styleTransferProgress.total}
          </span>
        )}
        <div className="flex-1" />

        <div className="flex items-center gap-1">
          {(["single", "grid2", "auto"] as ViewMode[]).map((m) => {
            const icons = {
              single: <LayoutList className="w-3 h-3" />,
              grid2: <LayoutGrid className="w-3 h-3" />,
              auto: <Columns2 className="w-3 h-3" />,
            };
            return (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className="w-6 h-6 flex items-center justify-center transition-colors"
                style={{
                  background: viewMode === m ? KR_BG : "none",
                  color: viewMode === m ? KR : "rgba(255,255,255,0.3)",
                  border: viewMode === m ? `1px solid ${KR_BORDER2}` : "none",
                  cursor: "pointer",
                  borderRadius: 0,
                }}
              >
                {icons[m]}
              </button>
            );
          })}
          {viewMode === "auto" && (
            <div className="flex items-center gap-1.5 ml-1">
              <Minus
                className="w-3 h-3 text-muted-foreground cursor-pointer"
                onClick={() => setCardSize((s) => Math.max(180, s - 20))}
              />
              <input
                type="range"
                min={180}
                max={500}
                step={20}
                value={cardSize}
                onChange={(e) => setCardSize(Number(e.target.value))}
                className="w-16 accent-[#f9423a]"
              />
              <Plus
                className="w-3 h-3 text-muted-foreground cursor-pointer"
                onClick={() => setCardSize((s) => Math.min(500, s + 20))}
              />
            </div>
          )}
        </div>

        <button
          onClick={() => setShowStyleModal(true)}
          className="flex items-center gap-1.5 px-3 h-8 text-[11px] font-medium tracking-wide transition-colors"
          style={{
            background: currentStyle ? KR_BG : "rgba(255,255,255,0.04)",
            color: currentStyle ? KR : "rgba(255,255,255,0.35)",
            border: currentStyle ? `1px solid ${KR_BORDER2}` : "1px solid rgba(255,255,255,0.08)",
            cursor: "pointer",
            borderRadius: 0,
          }}
        >
          <Palette className="w-3.5 h-3.5" />
          {currentStyle ? currentStyle.name : "Style"}
        </button>

        {selectedSceneIds.size > 0 ? (
          <>
            <div className="w-px h-5 mx-1" style={{ background: "rgba(255,255,255,0.08)" }} />
            <span className="text-[10px] font-mono font-medium tracking-wide" style={{ color: "#f0f0f0" }}>
              {selectedSceneIds.size} Selected
            </span>
            <button
              onClick={() => setSelectedSceneIds(new Set())}
              className="w-6 h-6 flex items-center justify-center hover:text-foreground transition-colors"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "rgba(255,255,255,0.3)",
                borderRadius: 0,
              }}
              title="Clear selection"
            >
              <X className="w-3 h-3" />
            </button>
            {currentStyle && activeScenes.some((s) => s.conti_image_url && selectedSceneIds.has(s.id)) && (
              <button
                onClick={() => setShowStyleTransferModal(true)}
                disabled={styleTransferring || generatingAll}
                className="flex items-center gap-1.5 px-3 h-8 text-[11px] font-medium tracking-wide text-white transition-opacity disabled:opacity-40"
                style={{ background: KR, border: "none", cursor: "pointer", borderRadius: 0 }}
              >
                {styleTransferring ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wand2 className="w-3.5 h-3.5" />
                )}
                Transfer
              </button>
            )}
            <button
              onClick={bulkDeleteScenes}
              className="flex items-center gap-1.5 px-3 h-8 text-[11px] font-medium tracking-wide text-white transition-colors"
              style={{ background: "#dc2626", border: "none", cursor: "pointer", borderRadius: 0 }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete ({selectedSceneIds.size})
            </button>
          </>
        ) : (
          <>
            <div className="relative" ref={modelMenuRef}>
              <button
                onClick={() => setShowModelMenu((p) => !p)}
                className="flex items-center gap-1.5 px-3 h-8 text-[11px] font-medium tracking-wide transition-colors"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  color: "rgba(255,255,255,0.7)",
                  border: showModelMenu ? `1px solid ${KR}` : "1px solid rgba(255,255,255,0.08)",
                  cursor: "pointer",
                  borderRadius: 0,
                }}
              >
                <Wand2 className="w-3.5 h-3.5" />
                {MODEL_OPTIONS.find((m) => m.id === contiModel)?.name ?? "Dev"}
              </button>
              {showModelMenu && (
                <div
                  className="absolute top-full left-0 mt-1 z-50 border border-border bg-card shadow-lg"
                  style={{ borderRadius: 0, minWidth: 160 }}
                >
                  {MODEL_OPTIONS.map((opt) => {
                    const isSelected = contiModel === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => {
                          setContiModel(opt.id);
                          setShowModelMenu(false);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[rgba(249,66,58,0.06)]"
                        style={{
                          background: isSelected ? KR_BG : "transparent",
                          borderRadius: 0,
                          cursor: "pointer",
                          border: "none",
                        }}
                      >
                        <div className="flex-1">
                          <div
                            className="text-[11px] font-bold"
                            style={{ color: isSelected ? KR : "rgba(255,255,255,0.7)" }}
                          >
                            {opt.name}
                          </div>
                          <div className="text-[9px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                            {opt.desc}
                          </div>
                        </div>
                        {isSelected && <div className="w-1.5 h-1.5" style={{ background: KR }} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              onClick={() => setShowGenerateAllModal(true)}
              disabled={generatingAll || activeScenes.length === 0}
              className="flex items-center gap-1.5 px-3 h-8 text-[11px] font-medium tracking-wide text-white transition-opacity disabled:opacity-40"
              style={{ background: KR, border: "none", cursor: "pointer", borderRadius: 0 }}
            >
              {generatingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Generate All
            </button>

            <button
              onClick={() => setShowInfo((p) => !p)}
              className="flex items-center gap-1.5 px-3 h-8 text-[11px] font-medium tracking-wide transition-colors"
              style={{
                background: showInfo ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
                color: showInfo ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.35)",
                border: `1px solid ${showInfo ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.08)"}`,
                cursor: "pointer",
                borderRadius: 0,
              }}
            >
              {showInfo ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              Info
            </button>

            <button
              onClick={() => setShowExportModal(true)}
              disabled={isExporting || activeScenes.length === 0}
              className="flex items-center gap-1.5 px-3 h-8 text-[11px] font-medium tracking-wide transition-colors disabled:opacity-40"
              style={{
                background: "rgba(255,255,255,0.04)",
                color: "rgba(255,255,255,0.5)",
                border: "1px solid rgba(255,255,255,0.08)",
                cursor: "pointer",
                borderRadius: 0,
              }}
            >
              {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Export
            </button>

            {versions.length === 0 && activeScenes.length > 0 && (
              <button
                onClick={() => setShowNewVersionModal(true)}
                className="flex items-center gap-1.5 px-3 h-8 text-[11px] font-medium tracking-wide transition-colors"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  color: "rgba(255,255,255,0.35)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  cursor: "pointer",
                  borderRadius: 0,
                }}
              >
                <Plus className="w-3.5 h-3.5" />
                New
              </button>
            )}
          </>
        )}
      </div>

      {versions.length === 0 && activeScenes.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <button
            onClick={() => setShowNewVersionModal(true)}
            className="flex flex-col items-center gap-3 px-12 py-10 transition-colors"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px dashed rgba(255,255,255,0.12)",
              borderRadius: 0,
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = KR;
              e.currentTarget.style.background = "rgba(249,66,58,0.04)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
              e.currentTarget.style.background = "rgba(255,255,255,0.03)";
            }}
          >
            <Plus className="w-8 h-8" style={{ color: "rgba(255,255,255,0.3)" }} />
            <span className="text-[13px] font-medium" style={{ color: "rgba(255,255,255,0.4)" }}>
              New Version
            </span>
            <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.2)" }}>
              Create scene or start new version
            </span>
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={activeScenes.map((s) => s.id)} strategy={rectSortingStrategy}>
              <div className={`grid ${gridClass} gap-3 items-stretch`} style={gridStyle}>
                {(() => {
                  let sceneCounter = 0;
                  return activeScenes.map((scene, idx) => {
                    if (!scene.is_transition) sceneCounter++;
                    const displayNum = scene.is_transition ? undefined : sceneCounter;
                    return (
                      <div key={scene.id} style={{ position: "relative" }}>
                        <InsertSceneButton
                          onAddScene={() => handleInsertSceneAt(idx)}
                          onAddTransition={() => handleInsertTransitionAt(idx)}
                          canTransition={
                            idx > 0 && !!activeScenes[idx - 1]?.conti_image_url && !!activeScenes[idx]?.conti_image_url
                          }
                        />
                        <SortableContiCard
                          scene={scene}
                          isGenerating={
                            (generatingSceneIds.has(scene.id) &&
                              (generatingVersionId
                                ? generatingVersionId === activeVersionId
                                : generatingSceneVersionMap[scene.id] === activeVersionId)) ||
                            editGeneratingIds.has(scene.id)
                          }
                          isGeneratingAll={
                            generatingAll && (!generatingVersionId || generatingVersionId === activeVersionId)
                          }
                          isUploading={uploadingSceneIds.has(scene.id)}
                          isStyleTransferring={styleTransferringIds.has(scene.id)}
                          isStyleTransferFlow={styleTransferring}
                          isQueued={
                            queuedSceneIds.has(scene.id) &&
                            (!generatingVersionId || generatingVersionId === activeVersionId)
                          }
                          aspectClass={ASPECT_CLASS[videoFormat]}
                          assetMap={assetMap}
                          assets={assets}
                          cacheBuster={cacheBusters[scene.scene_number] ?? 0}
                          historyCount={(imageHistory[scene.scene_number] ?? []).length}
                          selected={selectedSceneIds.has(scene.id)}
                          hasMultipleVersions={versions.length > 1}
                          onClickImage={() => {
                            // 콘티 이미지가 없는 씬은 Compare 탭으로 열어서 mood 이미지를
                            // 즉시 확인하고 "Use as Conti" 로 활용할 수 있도록 한다.
                            setStudioInitialTab(scene.conti_image_url ? undefined : "compare");
                            setStudioScene(scene);
                          }}
                          onGenerate={() => handleGenerate(scene)}
                          onInpaint={() => {
                            setStudioInitialTab("edit");
                            setStudioScene(scene);
                          }}
                          onCompare={() => {
                            setStudioInitialTab("compare");
                            setStudioScene(scene);
                          }}
                          onUpload={(file) => handleUploadConti(scene, file)}
                          onHistory={() => {
                            setStudioInitialTab("history");
                            setStudioScene(scene);
                          }}
                          onSceneUpdate={handleSceneUpdate}
                          onDelete={() => handleDeleteScene(scene.id, scene.scene_number)}
                          onDuplicate={() => handleDuplicateScene(scene)}
                          onSelect={(v) => toggleSceneSelect(scene.id, v)}
                          onSetThumbnail={
                            scene.conti_image_url ? () => handleSetThumbnail(scene.conti_image_url!) : undefined
                          }
                          onAdjustImage={scene.conti_image_url ? () => setAdjustingScene(scene) : undefined}
                          onUseAsStyle={
                            scene.conti_image_url ? () => handleRegisterSceneAsStyle(scene) : undefined
                          }
                          onRelight={scene.conti_image_url ? () => setRelightingScene(scene) : undefined}
                          onCameraVariations={
                            scene.conti_image_url ? () => setCameraVariationsScene(scene) : undefined
                          }
                          displayNumber={displayNum}
                          onTransitionTypeChange={handleTransitionTypeChange}
                          showInfo={showInfo}
                          generatingStage={sceneStages[scene.id]}
                          // ── inpaint 단계 표시용: editGeneratingIds에 있으면 스피너를 "1/1"로 표시
                          isEditGenerating={editGeneratingIds.has(scene.id)}
                          allScenes={activeScenes}
                          videoFormat={videoFormat}
                        />
                      </div>
                    );
                  });
                })()}
                <AddSceneCard onClick={handleAddScene} />
              </div>
            </SortableContext>
            <DragOverlay>
              {dragActiveId && dragCloneRef.current && (
                <div
                  className="shadow-2xl pointer-events-none"
                  style={{
                    opacity: 0.92,
                    border: `1.5px solid ${KR}`,
                    borderRadius: 0,
                    overflow: "hidden",
                    boxSizing: "border-box",
                  }}
                  ref={(node) => {
                    if (node && dragCloneRef.current && !node.hasChildNodes()) {
                      dragCloneRef.current.style.border = "none";
                      dragCloneRef.current.style.width = "100%";
                      node.appendChild(dragCloneRef.current);
                    }
                  }}
                />
              )}
            </DragOverlay>
          </DndContext>
        </div>
      )}

      {/* ── 모달들 ── */}
      {adjustingScene && (
        <SceneImageCropModal
          scene={adjustingScene}
          onClose={() => setAdjustingScene(null)}
          onSaved={(sceneId, crop) => {
            updateVersionScenes(activeScenes.map((s) => (s.id === sceneId ? { ...s, conti_image_crop: crop } : s)));
            setAdjustingScene(null);
          }}
        />
      )}

      {relightingScene && (
        <RelightModal
          scene={relightingScene}
          projectId={projectId}
          videoFormat={videoFormat}
          onClose={() => setRelightingScene(null)}
          onApplied={async (newUrl, previousUrl) => {
            const target = relightingScene;
            if (!target) return;
            pushHistory(target.id, previousUrl);
            await supabase.from("scenes").update({ conti_image_url: newUrl }).eq("id", target.id);
            const current = getSceneState(projectId)?.scenes ?? activeScenes;
            const updated = current.map((s) => (s.id === target.id ? { ...s, conti_image_url: newUrl } : s));
            await updateVersionScenes(updated);
            bumpCache(target.scene_number);
            toast({ title: `Scene ${target.scene_number} relit.` });
          }}
        />
      )}

      {cameraVariationsScene && (
        <CameraVariationsModal
          scene={cameraVariationsScene}
          videoFormat={videoFormat}
          onClose={() => setCameraVariationsScene(null)}
          generate={async (overrideScene) => {
            // Reuse the tab's regenerate context so variations share brief /
            // style / mood / model with the normal Regenerate pipeline.
            // `overrideScene` already has camera_angle replaced with the
            // preset phrase by the modal.
            //
            // IMPORTANT: do NOT pass the scene's current image as a reference
            // here. NB2 interprets any "mostly-baked" reference as copy-mode
            // and freezes the geometry (subject and background stay put, only
            // surface effects change). Identity preservation comes from the
            // separate, clean tagged_assets photos that generateConti already
            // pulls via fetchTaggedAssets — that's how NB2's multi-reference
            // consistency is actually meant to be used.
            const styleAnchor = currentStyle?.style_prompt ?? undefined;
            const styleImageUrl = currentStyle?.thumbnail_url ?? undefined;
            const newUrl = await generateConti({
              scene: overrideScene,
              allScenes: activeScenes,
              projectId,
              videoFormat,
              briefAnalysis: briefAnalysisRef.current,
              styleAnchor,
              styleImageUrl,
              moodReferenceUrl: getMoodReferenceUrl(overrideScene.scene_number),
              model: contiModel,
            });
            return newUrl;
          }}
          onApplied={async (newUrl, previousUrl) => {
            const target = cameraVariationsScene;
            if (!target) return;
            pushHistory(target.id, previousUrl);
            await supabase.from("scenes").update({ conti_image_url: newUrl }).eq("id", target.id);
            const current = getSceneState(projectId)?.scenes ?? activeScenes;
            const updated = current.map((s) => (s.id === target.id ? { ...s, conti_image_url: newUrl } : s));
            await updateVersionScenes(updated);
            bumpCache(target.scene_number);
            toast({ title: `Scene ${target.scene_number} updated with new camera angle.` });
          }}
        />
      )}

      {studioScene && (
        <Suspense fallback={null}>
        <ContiStudio
          scene={studioScene}
          allScenes={activeScenes}
          assets={assets as any}
          versions={versions}
          activeVersionId={activeVersionId}
          videoFormat={videoFormat}
          imageHistory={imageHistory}
          briefAnalysis={briefAnalysisRef.current}
          styleAnchor={currentStyle?.style_prompt ?? undefined}
          styleImageUrl={currentStyle?.thumbnail_url ?? undefined}
          moodReferenceUrl={getMoodReferenceUrl(studioScene.scene_number)}
          moodImages={moodImageUrls}
          moodBookmarks={moodBookmarks}
          initialTab={studioInitialTab}
          onClose={() => {
            setStudioScene(null);
            setStudioInitialTab(undefined);
          }}
          onSaveInpaint={async (url) => {
            const current = getSceneState(projectId)?.scenes ?? activeScenes;
            const liveScene = current.find((s) => s.id === studioScene.id);
            pushHistory(studioScene.id, liveScene?.conti_image_url ?? studioScene.conti_image_url);
            await supabase.from("scenes").update({ conti_image_url: url }).eq("id", studioScene.id);
            const latest = getSceneState(projectId)?.scenes ?? current;
            await updateVersionScenes(
              latest.map((s) => (s.id === studioScene.id ? { ...s, conti_image_url: url } : s)),
            );
            bumpCache(studioScene.scene_number);
          }}
          onRollback={(url) => handleRollback(studioScene, url)}
          onDeleteHistory={async (url) => {
            const sceneNumber = studioScene.scene_number;
            const currentHistory = imageHistoryRef.current[sceneNumber] ?? [];
            const updatedHist = currentHistory.filter((u) => u !== url);
            setImageHistory((prev) => ({ ...prev, [sceneNumber]: updatedHist }));
            await supabase.from("scenes").update({ conti_image_history: updatedHist }).eq("id", studioScene.id);
            const latest = getSceneState(projectId)?.scenes ?? activeScenes;
            await updateVersionScenes(
              latest.map((s) => (s.id === studioScene.id ? { ...s, conti_image_history: updatedHist } : s)),
            );
          }}
          onEditGeneratingChange={(sceneId, generating) => {
            setEditGeneratingIds((prev) => {
              const next = new Set(prev);
              if (generating) next.add(sceneId);
              else next.delete(sceneId);
              return next;
            });
          }}
          // ── inpaint stage를 카드 스피너에 전달 ──
          onStageChange={(sceneId, stage) => {
            setSceneStages((prev) => {
              if (stage === null) {
                const next = { ...prev };
                delete next[sceneId];
                return next;
              }
              return { ...prev, [sceneId]: stage };
            });
          }}
          isRegenerating={generatingSceneIds.has(studioScene.id)}
        />
        </Suspense>
      )}

      {compareSceneNumber !== null && (
        <VersionCompareModal
          sceneNumber={compareSceneNumber}
          versions={versions}
          activeVersionId={activeVersionId}
          videoFormat={videoFormat}
          onClose={() => setCompareSceneNumber(null)}
          onImport={handleImportSceneImage}
        />
      )}
      {historySheet && (
        <HistorySheet
          sceneNumber={historySheet.scene_number}
          sceneTitle={historySheet.title}
          history={imageHistory[historySheet.scene_number] ?? []}
          aspectClass={ASPECT_CLASS[videoFormat]}
          onClose={() => setHistorySheet(null)}
          onRollback={(url) => handleRollback(historySheet, url)}
          onDelete={(url) => {
            const sn = historySheet.scene_number;
            setImageHistory((prev) => {
              const updated = (prev[sn] ?? []).filter((u) => u !== url);
              return { ...prev, [sn]: updated };
            });
            const scene = (getSceneState(projectId)?.scenes ?? activeScenes).find((s) => s.scene_number === sn);
            if (scene) {
              const updatedHist = (imageHistory[sn] ?? []).filter((u) => u !== url);
              supabase.from("scenes").update({ conti_image_history: updatedHist }).eq("id", scene.id).then();
            }
          }}
        />
      )}
      {showNewVersionModal && (
        <NewVersionModal
          versions={versions}
          activeScenes={activeScenes}
          projectId={projectId}
          onClose={() => setShowNewVersionModal(false)}
          onCreated={async (newId) => {
            await loadVersions();
            if (newId) switchVersion(newId);
          }}
        />
      )}
      {showExportModal && (
        <ExportModal
          versions={versions}
          currentScenes={activeScenes}
          activeVersionId={activeVersionId}
          showInfo={showInfo}
          videoFormat={videoFormat}
          projectTitle={projectInfo.title || ""}
          onClose={() => setShowExportModal(false)}
          onExportPdf={exportToPDFWithVersions}
          onExportPng={exportToPNGWithVersions}
        />
      )}
      {showGenerateAllModal && (
        <GenerateAllModal
          totalCount={activeScenes.filter((s) => s.description?.trim() && !s.is_transition).length}
          missingCount={
            activeScenes.filter((s) => !s.conti_image_url && s.description?.trim() && !s.is_transition).length
          }
          onClose={() => setShowGenerateAllModal(false)}
          onConfirm={runGenerateAll}
        />
      )}
      {showStyleTransferModal && currentStyle && (
        <StyleTransferConfirmModal
          styleName={currentStyle.name}
          styleThumb={currentStyle.thumbnail_url}
          sceneCount={scenesWithImages}
          selectedCount={activeScenes.filter((s) => s.conti_image_url && selectedSceneIds.has(s.id)).length}
          onClose={() => setShowStyleTransferModal(false)}
          onConfirm={runStyleTransferAll}
        />
      )}
      {showStyleModal && (
        <StylePickerModal
          currentStyleId={currentStyle?.id ?? null}
          projectId={projectId}
          onClose={() => setShowStyleModal(false)}
          onChanged={(preset) => {
            setCurrentStyle(preset);
            setProjectInfo((prev) => ({ ...prev, conti_style_id: preset?.id ?? null }));
          }}
        />
      )}
      {renameVersion && (
        <RenameVersionModal
          version={renameVersion}
          onClose={() => setRenameVersion(null)}
          onRenamed={() => loadVersions(true)}
        />
      )}
      {deleteVersionTarget && (
        <Dialog open onOpenChange={(o) => !o && setDeleteVersionTarget(null)}>
          <DialogContent className="max-w-[360px] bg-card border-border" style={{ borderRadius: 0 }}>
            <DialogHeader>
              <DialogTitle className="text-[15px] font-semibold">Delete Version</DialogTitle>
            </DialogHeader>
            <p className="text-[13px] text-muted-foreground">
              Are you sure you want to delete "{deleteVersionTarget.name}"? This action cannot be undone.
            </p>
            <DialogFooter className="gap-2">
              <Button variant="ghost" className="text-[13px] h-9" onClick={() => setDeleteVersionTarget(null)}>
                Cancel
              </Button>
              <Button
                className="text-white text-[13px] h-9"
                style={{ background: "#dc2626" }}
                onClick={() => {
                  executeDeleteVersion(deleteVersionTarget.id);
                  setDeleteVersionTarget(null);
                }}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
