import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { supabase } from "@/lib/supabase";
import { Navbar } from "@/components/Navbar";
import { ProjectCard } from "@/components/ProjectCard";
import { ProjectModal } from "@/components/ProjectModal";
import { SkeletonCard } from "@/components/SkeletonCard";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus, Film, Search, X, ChevronRight, Loader2, Trash2, Folder } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ── 타입 ── */
export interface Project {
  id: string;
  title: string;
  client: string | null;
  deadline: string | null;
  status: string;
  created_at: string;
  video_format?: string;
  thumbnail_url?: string | null;
  thumbnail_crop?: any;
  folder_id?: string | null;
}
export interface SceneStats {
  total: number;
  withConti: number;
  /** 콘티 탭에 작업 중인 씬이 있는지 (scenes.source = 'conti') */
  hasContiScenes?: boolean;
  /** Agent 스토리보드에 씬 카드가 있는지 (scenes.source = 'agent') */
  hasAgentScenes?: boolean;
  /** Agent 에서 저장된 스토리보드 드래프트 버전이 있는지 */
  hasDraftVersion?: boolean;
}
export interface Folder {
  id: string;
  name: string;
  created_at: string;
}

/* ── FolderModal ── */
const FolderModal = ({
  isOpen,
  onClose,
  onSuccess,
  editFolder,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editFolder?: Folder | null;
}) => {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setName(editFolder?.name ?? "");
  }, [editFolder, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    if (editFolder) {
      const { error } = await (supabase as any).from("folders").update({ name }).eq("id", editFolder.id);
      if (error) toast({ variant: "destructive", title: "수정 실패", description: error.message });
      else {
        onSuccess();
        onClose();
      }
    } else {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await (supabase as any).from("folders").insert([{ name, user_id: user?.id }]);
      if (error) toast({ variant: "destructive", title: "생성 실패", description: error.message });
      else {
        onSuccess();
        onClose();
      }
    }
    setLoading(false);
  };

  const handleDelete = async () => {
    if (!editFolder) return;
    setLoading(true);
    const { error } = await (supabase as any).from("folders").delete().eq("id", editFolder.id);
    if (error) toast({ variant: "destructive", title: "Delete failed", description: error.message });
    else {
      onSuccess();
      onClose();
    }
    setLoading(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-[360px]" style={{ borderRadius: 0 }}>
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold">{editFolder ? "Edit Folder" : "New Folder"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-[13px]">Folder Name *</Label>
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-background border-border text-[13px] h-9"
              style={{ borderRadius: 0 }}
            />
          </div>
          <div className="flex justify-between items-center pt-1">
            {editFolder ? (
              <Button
                type="button"
                variant="ghost"
                onClick={handleDelete}
                disabled={loading}
                className="text-destructive hover:text-destructive hover:bg-destructive/10 text-[13px] h-9 px-3"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                Delete
              </Button>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose} className="text-[13px] h-9">
                Cancel
              </Button>
              <Button
                disabled={loading}
                className="min-w-[80px] bg-primary hover:bg-primary/85 text-[13px] h-9"
                style={{ borderRadius: 0 }}
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : editFolder ? "Save" : "Create"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/* ── Draggable ProjectCard 래퍼 ── */
const DraggableCard = ({
  project,
  onRefresh,
  onEdit,
  sceneStats,
}: {
  project: Project;
  onRefresh: () => void;
  onEdit: (p: Project) => void;
  sceneStats?: SceneStats;
}) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: project.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn("touch-none transition-opacity duration-100", isDragging && "opacity-20")}
    >
      <ProjectCard project={project} onRefresh={onRefresh} onEdit={onEdit} sceneStats={sceneStats} />
    </div>
  );
};

/* ── 사이드바 Ungrouped 드롭존 (드래그 중에만 노출) ── */
const DroppableUngroupedSidebar = ({ isOver }: { isOver: boolean }) => {
  const { setNodeRef } = useDroppable({ id: "sidebar-ungrouped" });
  return (
    <div ref={setNodeRef}>
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-2.5 border-l-2 transition-all duration-100",
          isOver ? "bg-white/[0.06] border-l-white/30" : "border-l-transparent",
        )}
      >
        <Folder
          className={cn("w-3.5 h-3.5 flex-shrink-0 transition-colors", isOver ? "text-white/50" : "text-white/15")}
        />
        <span className={cn("text-[13px] transition-colors", isOver ? "text-white/60" : "text-white/20")}>
          Ungrouped
        </span>
      </div>
    </div>
  );
};

/* ── 사이드바 드롭 가능 폴더 아이템 ── */
const DroppableSidebarFolder = ({
  folder,
  count,
  isSelected,
  isOver,
  isDragging,
  onSelect,
  onDoubleClick,
}: {
  folder: Folder;
  count: number;
  isSelected: boolean;
  isOver: boolean;
  isDragging: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
}) => {
  const { setNodeRef } = useDroppable({ id: `sidebar-folder-${folder.id}` });

  return (
    <div ref={setNodeRef}>
      <button
        onClick={onSelect}
        onDoubleClick={onDoubleClick}
        className={cn(
          "w-full flex items-center gap-3 px-4 py-2.5 text-left border-l-2 transition-all duration-100",
          isOver && isDragging
            ? "bg-primary/[0.12] border-l-primary"
            : isSelected
              ? "border-l-primary bg-primary/[0.07]"
              : "border-l-transparent hover:bg-white/[0.03]",
        )}
        title="Double-click to edit"
      >
        <Folder
          className={cn(
            "w-3.5 h-3.5 flex-shrink-0 transition-colors",
            isOver && isDragging ? "text-primary" : isSelected ? "text-primary" : "text-white/25",
          )}
        />
        <span
          className={cn(
            "text-[13px] flex-1 truncate transition-colors",
            isOver && isDragging
              ? "text-primary font-semibold"
              : isSelected
                ? "text-white/90 font-semibold"
                : "text-white/45",
          )}
        >
          {folder.name}
        </span>
        <span
          className={cn(
            "text-[11px] font-mono transition-colors",
            isOver && isDragging ? "text-primary/60" : "text-white/22",
          )}
        >
          {count}
        </span>
      </button>
    </div>
  );
};

/* ── 프로젝트 그룹 (All 뷰 폴더별) ── */
const ProjectGroup = ({
  label,
  count,
  projects,
  sceneStatsMap,
  onRefresh,
  onEditProject,
  isOver,
  droppableId,
}: {
  label?: string;
  count?: number;
  projects: Project[];
  sceneStatsMap: Record<string, SceneStats>;
  onRefresh: () => void;
  onEditProject: (p: Project) => void;
  isOver?: boolean;
  droppableId: string;
}) => {
  const { setNodeRef } = useDroppable({ id: droppableId });
  if (projects.length === 0) return null;

  return (
    <div ref={setNodeRef}>
      {label && (
        <div className="flex items-center gap-2.5 mb-2">
          <ChevronRight className="w-3 h-3 text-white/20 rotate-90" />
          <span className="text-[11px] font-mono tracking-[0.05em] text-white/35">{label}</span>
          {count !== undefined && <span className="text-[10px] font-mono text-white/18">{count}</span>}
          <div className={cn("flex-1 h-px", isOver ? "bg-primary/30" : "bg-white/[0.05]")} />
        </div>
      )}
      <div className={cn("space-y-2 transition-colors", isOver && "ring-1 ring-primary/20 bg-primary/[0.02]")}>
        {projects.map((p) => (
          <DraggableCard
            key={p.id}
            project={p}
            onRefresh={onRefresh}
            onEdit={onEditProject}
            sceneStats={sceneStatsMap[p.id]}
          />
        ))}
      </div>
    </div>
  );
};

/* ═══════════════════════ 메인 페이지 ═══════════════════════ */
const DashboardPage = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [editFolder, setEditFolder] = useState<Folder | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "completed">("all");
  const [sceneStatsMap, setSceneStatsMap] = useState<Record<string, SceneStats>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  const { toast } = useToast();
  const navigate = useNavigate();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  /* ── 데이터 패칭 ── */
  const fetchData = async () => {
    const [{ data: pData, error: pErr }, { data: fData }] = await Promise.all([
      supabase.from("projects").select("*, active_version_id").order("created_at", { ascending: false }),
      (supabase as any).from("folders").select("*").order("created_at", { ascending: true }),
    ]);
    if (pErr) toast({ variant: "destructive", title: "오류 발생", description: pErr.message });
    else {
      setProjects(pData || []);
      if (pData?.length) {
        const ids = pData.map((p) => p.id);
        const [{ data: sc }, { data: sv }] = await Promise.all([
          supabase
            .from("scenes")
            .select("project_id, conti_image_url, is_transition, source")
            .in("project_id", ids),
          supabase.from("scene_versions").select("id, project_id, scenes").in("project_id", ids),
        ]);
        const statsMap = pData.reduce(
          (acc, p) => {
            const activeVersionId = (p as any).active_version_id;

            // 탭 결정용 보유 여부 (버전 우선 순위와 독립)
            // hasContiScenes: scenes 테이블 또는 scene_versions 어디서든 conti_image_url 이 세팅된
            //                 씬이 하나라도 있으면 콘티 작업 존재로 간주 (source 값과 무관)
            const projScenes = sc?.filter((s) => s.project_id === p.id) ?? [];
            const projVersions = sv?.filter((v) => v.project_id === p.id) ?? [];
            const hasContiInScenesTable = projScenes.some((s: any) => !!s.conti_image_url);
            const hasContiInVersions = projVersions.some((v: any) => {
              const arr = Array.isArray(v.scenes) ? v.scenes : [];
              return arr.some((s: any) => !!s?.conti_image_url);
            });
            const hasContiScenes = hasContiInScenesTable || hasContiInVersions;
            const hasAgentScenes = projScenes.some((s: any) => s.source === "agent");
            const hasDraftVersion = projVersions.length > 0;

            // 1순위: active_version_id 기준
            if (activeVersionId) {
              const activeVersion = sv?.find((v) => v.id === activeVersionId);
              if (activeVersion) {
                const allScenes = Array.isArray(activeVersion.scenes) ? activeVersion.scenes : [];
                const scenes = allScenes.filter((s: any) => !s.is_transition);
                if (scenes.length > 0) {
                  acc[p.id] = {
                    total: scenes.length,
                    withConti: scenes.filter((s: any) => s.conti_image_url).length,
                    hasContiScenes,
                    hasAgentScenes,
                    hasDraftVersion,
                  };
                  return acc;
                }
              }
            }

            // 2순위: scenes 테이블
            const ps = projScenes.filter((s) => !s.is_transition);
            if (ps.length > 0) {
              acc[p.id] = {
                total: ps.length,
                withConti: ps.filter((s) => s.conti_image_url).length,
                hasContiScenes,
                hasAgentScenes,
                hasDraftVersion,
              };
              return acc;
            }

            // 3순위: 마지막 버전
            const projectVersions = sv?.filter((v) => v.project_id === p.id) ?? [];
            if (projectVersions.length > 0) {
              const lastVersion = projectVersions[projectVersions.length - 1];
              const allScenes = Array.isArray(lastVersion.scenes) ? lastVersion.scenes : [];
              const scenes = allScenes.filter((s: any) => !s.is_transition);
              acc[p.id] = {
                total: scenes.length,
                withConti: scenes.filter((s: any) => s.conti_image_url).length,
                hasContiScenes,
                hasAgentScenes,
                hasDraftVersion,
              };
            } else {
              acc[p.id] = {
                total: 0,
                withConti: 0,
                hasContiScenes,
                hasAgentScenes,
                hasDraftVersion,
              };
            }
            return acc;
          },
          {} as Record<string, SceneStats>,
        );
        setSceneStatsMap(statsMap);
      }
    }
    if (fData) setFolders(fData);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  /* ── 드래그 핸들러 ── */
  const handleDragStart = ({ active }: DragStartEvent) => setActiveId(active.id as string);
  const handleDragOver = ({ over }: DragOverEvent) => setOverId(over ? String(over.id) : null);
  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    setOverId(null);
    if (!over) return;
    const projectId = active.id as string;
    const dropZone = String(over.id);
    const newFolderId =
      dropZone === "ungrouped" || dropZone === "sidebar-ungrouped"
        ? null
        : dropZone.replace("sidebar-folder-", "").replace("folder-", "");
    const project = projects.find((p) => p.id === projectId);
    if (!project || (project.folder_id ?? null) === (newFolderId ?? null)) return;
    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, folder_id: newFolderId } : p)));
    const { error } = await (supabase as any).from("projects").update({ folder_id: newFolderId }).eq("id", projectId);
    if (error) {
      toast({ variant: "destructive", title: "이동 실패", description: error.message });
      fetchData();
    }
  };

  /* ── 필터 ── */
  const baseFiltered = projects
    .filter((p) => statusFilter === "all" || p.status === statusFilter)
    .filter(
      (p) =>
        p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.client ?? "").toLowerCase().includes(searchQuery.toLowerCase()),
    );

  const visibleProjects = selectedFolderId
    ? baseFiltered.filter((p) => p.folder_id === selectedFolderId)
    : baseFiltered;

  const activeProject = projects.find((p) => p.id === activeId);
  const mainTitle = selectedFolderId
    ? (folders.find((f) => f.id === selectedFolderId)?.name ?? "Projects")
    : "All Projects";

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {/* ━━━ 좌측 사이드바 ━━━ */}
          <aside
            className="flex flex-col flex-shrink-0 border-r border-white/[0.07]"
            style={{ width: 230, background: "#090909" }}
          >
            {/* 검색 */}
            <div className="flex items-center px-3 border-b border-white/[0.06] flex-shrink-0" style={{ height: 48 }}>
              <div
                className="flex items-center gap-2 px-3 py-2 bg-white/[0.04] border border-white/[0.08] w-full"
                style={{ borderRadius: 0 }}
              >
                <Search className="w-3.5 h-3.5 text-white/25 flex-shrink-0" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search..."
                  className="bg-transparent border-none outline-none text-[12px] font-mono text-white/50 placeholder:text-white/15 w-full"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")}>
                    <X className="w-3 h-3 text-white/30 hover:text-white/60 transition-colors" />
                  </button>
                )}
              </div>
            </div>

            {/* Create Project */}
            <div className="px-3 py-3 border-b border-white/[0.06] flex-shrink-0">
              <button
                onClick={() => setIsModalOpen(true)}
                className="w-full flex items-center justify-center gap-2 h-9 bg-primary hover:bg-primary/85 text-white text-[12px] font-semibold tracking-wide transition-colors"
                style={{ borderRadius: 0 }}
              >
                <Plus className="w-4 h-4" />
                Create Project
              </button>
            </div>

            {/* Folders 헤더 */}
            <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
              <span className="text-[10px] font-mono tracking-[0.12em] text-white/25">Folders</span>
              <button
                onClick={() => {
                  setEditFolder(null);
                  setIsFolderModalOpen(true);
                }}
                className="w-[18px] h-[18px] flex items-center justify-center border border-white/[0.12] text-white/35 hover:border-primary/50 hover:text-primary hover:bg-primary/[0.08] transition-all text-[13px] leading-none"
                style={{ borderRadius: 2 }}
                title="New Folder"
              >
                +
              </button>
            </div>

            {/* 폴더 목록 */}
            <div className="flex-1 overflow-y-auto pb-2">
              {folders.length === 0 && !loading && (
                <div className="px-4 py-3 text-[11px] text-white/20 font-mono">No folders yet</div>
              )}
              {folders.map((folder) => {
                const count = projects.filter((p) => p.folder_id === folder.id).length;
                const isSelected = selectedFolderId === folder.id;
                return (
                  <DroppableSidebarFolder
                    key={folder.id}
                    folder={folder}
                    count={count}
                    isSelected={isSelected}
                    isOver={overId === `sidebar-folder-${folder.id}`}
                    isDragging={!!activeId}
                    onSelect={() => setSelectedFolderId(isSelected ? null : folder.id)}
                    onDoubleClick={() => {
                      setEditFolder(folder);
                      setIsFolderModalOpen(true);
                    }}
                  />
                );
              })}
              {/* 드래그 중일 때 Ungrouped 드롭존 노출 */}
              {activeId && <DroppableUngroupedSidebar isOver={overId === "sidebar-ungrouped"} />}
            </div>
          </aside>

          {/* ━━━ 메인 영역 ━━━ */}
          <main className="flex-1 flex flex-col min-w-0 min-h-0">
            {/* 메인 바 */}
            <div
              className="flex items-center px-5 border-b border-white/[0.07] flex-shrink-0"
              style={{ height: 48, background: "#0c0c0c" }}
            >
              <span className="text-[14px] font-bold text-white/70">{mainTitle}</span>
              <span className="text-[11px] font-mono text-white/25 ml-2.5">{visibleProjects.length}</span>

              <div className="flex items-center ml-auto">
                {(["all", "active", "completed"] as const).map((key) => (
                  <button
                    key={key}
                    onClick={() => setStatusFilter(key)}
                    className={cn(
                      "px-4 text-[12px] font-medium tracking-wider border-b-[2px] h-[48px] transition-all duration-100",
                      statusFilter === key
                        ? "text-primary border-primary"
                        : "text-white/30 border-transparent hover:text-white/55",
                    )}
                    style={{ borderRadius: 0 }}
                  >
                    {key === "all" ? "All" : key === "active" ? "Active" : "Done"}
                  </button>
                ))}
              </div>
            </div>

            {/* 프로젝트 목록 */}
            <div className="flex-1 overflow-y-auto px-5 py-5">
              {loading ? (
                <div className="space-y-2">
                  {[...Array(4)].map((_, i) => (
                    <SkeletonCard key={i} />
                  ))}
                </div>
              ) : visibleProjects.length === 0 ? (
                <div
                  className="border border-dashed border-white/[0.08]"
                  style={{ borderRadius: 0 }}
                >
                  <EmptyState
                    icon={<Film className="w-8 h-8" />}
                    title={searchQuery || statusFilter !== "all" ? "No results" : "No projects yet"}
                    description={
                      searchQuery || statusFilter !== "all"
                        ? "Try a different search or filter"
                        : "Create a project to get started"
                    }
                  />
                </div>
              ) : selectedFolderId ? (
                /* 특정 폴더 선택 뷰 */
                <div className="space-y-2">
                  {visibleProjects.map((p) => (
                    <DraggableCard
                      key={p.id}
                      project={p}
                      onRefresh={fetchData}
                      onEdit={(proj) => {
                        setEditProject(proj);
                        setIsModalOpen(true);
                      }}
                      sceneStats={sceneStatsMap[p.id]}
                    />
                  ))}
                </div>
              ) : (
                /* All 뷰 — 폴더별 그룹핑 */
                <div className="space-y-8">
                  {folders.map((folder) => {
                    const folderProjects = visibleProjects.filter((p) => p.folder_id === folder.id);
                    if (folderProjects.length === 0) return null;
                    return (
                      <ProjectGroup
                        key={folder.id}
                        label={folder.name}
                        count={folderProjects.length}
                        projects={folderProjects}
                        sceneStatsMap={sceneStatsMap}
                        onRefresh={fetchData}
                        onEditProject={(proj) => {
                          setEditProject(proj);
                          setIsModalOpen(true);
                        }}
                        isOver={overId === `folder-${folder.id}`}
                        droppableId={`folder-${folder.id}`}
                      />
                    );
                  })}

                  {/* 미분류 프로젝트 */}
                  {(() => {
                    const ungrouped = visibleProjects.filter((p) => !p.folder_id);
                    if (ungrouped.length === 0) return null;
                    return (
                      <ProjectGroup
                        label={folders.length > 0 ? "Ungrouped" : undefined}
                        count={ungrouped.length}
                        projects={ungrouped}
                        sceneStatsMap={sceneStatsMap}
                        onRefresh={fetchData}
                        onEditProject={(proj) => {
                          setEditProject(proj);
                          setIsModalOpen(true);
                        }}
                        isOver={overId === "ungrouped"}
                        droppableId="ungrouped"
                      />
                    );
                  })()}
                </div>
              )}
            </div>
          </main>

          {/* DragOverlay — modifiers 없이 순수 pointerWithin만 사용 */}
          <DragOverlay dropAnimation={{ duration: 120, easing: "ease" }}>
            {activeProject && (
              <div className="rotate-1 scale-[1.02] opacity-80 pointer-events-none">
                <ProjectCard
                  project={activeProject}
                  onRefresh={() => {}}
                  onEdit={() => {}}
                  sceneStats={sceneStatsMap[activeProject.id]}
                />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>

      {/* ━━━ 하단 상태바 ━━━ */}
      <footer
        className="flex items-center justify-between px-5 border-t border-white/[0.06] flex-shrink-0"
        style={{ height: 28, background: "#060606" }}
      >
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2">
            <span className="inline-block w-[6px] h-[6px] bg-emerald-500" style={{ borderRadius: "50%" }} />
            <span className="font-mono text-[10px] tracking-wide text-white/35">Server: Online</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-[6px] h-[6px] bg-primary" style={{ borderRadius: "50%" }} />
            <span className="font-mono text-[10px] tracking-wide text-white/35">Projects: {projects.length}</span>
          </div>
        </div>
        <span className="font-mono text-[10px] tracking-wide text-white/25">Pre-Flow Dashboard Beta v1.0</span>
      </footer>

      {/* ━━━ 모달 ━━━ */}
      <ProjectModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditProject(null);
        }}
        onSuccess={(id) => {
          fetchData();
          if (id && !editProject) navigate(`/project/${id}`);
        }}
        editProject={editProject}
        folders={folders}
        initialFolderId={editProject ? undefined : selectedFolderId}
      />
      <FolderModal
        isOpen={isFolderModalOpen}
        onClose={() => {
          setIsFolderModalOpen(false);
          setEditFolder(null);
        }}
        onSuccess={fetchData}
        editFolder={editFolder}
      />
    </div>
  );
};

export default DashboardPage;
