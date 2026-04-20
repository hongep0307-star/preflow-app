import { MoreHorizontal, ChevronRight, Edit2, Trash2, Crop, ImageIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { deleteProjectCompletely } from "@/lib/deleteProject";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { ThumbnailCropModal, type CropSettings } from "@/components/ThumbnailCropModal";
import type { Project, SceneStats } from "@/pages/DashboardPage";

interface ProjectCardProps {
  project: Project;
  onRefresh: () => void;
  onEdit: (project: Project) => void;
  sceneStats?: SceneStats;
}

export const ProjectCard = ({ project, onRefresh, onEdit, sceneStats }: ProjectCardProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showCropModal, setShowCropModal] = useState(false);

  const handleDelete = async () => {
    try {
      await deleteProjectCompletely(project.id);
      onRefresh();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Delete failed", description: e.message });
    }
    setShowDeleteDialog(false);
  };

  const handleSaveCrop = async (crop: CropSettings) => {
    try {
      const { error } = await supabase
        .from("projects")
        .update({ thumbnail_crop: crop } as any)
        .eq("id", project.id);
      if (error) throw error;
      project.thumbnail_crop = crop;
      setShowCropModal(false);
      toast({ title: "Thumbnail adjusted" });
      onRefresh();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Save failed", description: e.message });
    }
  };

  const isCompleted = project.status === "completed";
  const crop = project.thumbnail_crop as CropSettings | null;

  /* 마감일 포맷 */
  const deadlineStr = project.deadline ? format(new Date(project.deadline), "MMM dd yyyy") : "—";

  /* 마감 임박 (3일 이내) */
  const isUrgent = (() => {
    if (!project.deadline) return false;
    const diff = Math.ceil((new Date(project.deadline).getTime() - Date.now()) / 86400000);
    return diff >= 0 && diff <= 3;
  })();

  /* 비율 + 이름 표기 */
  const formatLabel = (() => {
    switch ((project.video_format ?? "").toLowerCase()) {
      case "vertical":
        return "9:16 · Vertical";
      case "horizontal":
        return "16:9 · Horizontal";
      case "square":
        return "1:1 · Square";
      default:
        return project.video_format?.toUpperCase() ?? null;
    }
  })();

  return (
    <>
      {/* ━━━ B안: 한 줄 가로 배치 ━━━
          [썸네일] [● 상태] | [제목 flex-1] [포맷] [owner] | [deadline] [···] [›]
      */}
      <div
        onClick={() => navigate(`/project/${project.id}${sceneStats && sceneStats.total > 0 ? "?tab=storyboard" : ""}`)}
        className="group flex items-stretch bg-card border border-border hover:border-primary/25 hover:bg-surface-elevated cursor-pointer transition-all duration-150"
        style={{ borderRadius: 0 }}
      >
        {/* ── 썸네일 — 16:9, crop 지원 ── */}
        <div
          className="flex-shrink-0 bg-background border-r border-border flex items-center justify-center overflow-hidden relative group/thumb"
          style={{ width: 160, height: 90, borderRadius: 0 }}
          onClick={(e) => {
            if (project.thumbnail_url) {
              e.stopPropagation();
              setShowCropModal(true);
            }
          }}
          title={project.thumbnail_url ? "클릭하여 썸네일 위치 조정" : undefined}
        >
          {project.thumbnail_url ? (
            <>
              <img
                src={project.thumbnail_url}
                alt={project.title}
                className="w-full h-full object-cover"
                loading="lazy"
                style={{
                  objectPosition: crop ? `${crop.x}% ${crop.y}%` : "center",
                  transform: crop && crop.scale > 1 ? `scale(${crop.scale})` : undefined,
                  transformOrigin: crop ? `${crop.x}% ${crop.y}%` : undefined,
                }}
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center">
                <Crop className="w-4 h-4 text-white/80" />
              </div>
            </>
          ) : (
            <ImageIcon className="w-5 h-5 text-muted-foreground/15" />
          )}
        </div>

        {/* ── 나머지 콘텐츠 한 줄 ── */}
        <div className="flex items-center gap-4 flex-1 min-w-0 px-4 overflow-hidden">
          {/* 상태 — dot + 텍스트 (B안) */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span
              className="w-[6px] h-[6px] rounded-full flex-shrink-0"
              style={{ background: isCompleted ? "rgba(255,255,255,0.2)" : "#f9423a" }}
            />
            <span
              className="text-[13px] font-medium whitespace-nowrap"
              style={{
                color: isCompleted ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.5)",
              }}
            >
              {isCompleted ? "Completed" : "In Progress"}
            </span>
          </div>

          {/* 구분선 */}
          <div className="w-px h-5 bg-white/[0.08] flex-shrink-0" />

          {/* 중앙 그룹: 제목 + 진척 바 — flex-1로 공간 흡수 */}
          <div className="flex items-center gap-4 flex-1 min-w-0">
            {/* 제목 */}
            <h3
              className="text-[13px] font-bold flex-1 min-w-0 truncate tracking-wide group-hover:text-primary transition-colors"
              style={{ color: isCompleted ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.85)" }}
            >
              {project.title}
            </h3>

            {/* 씬 콘티 진척 바 */}
            {sceneStats && sceneStats.total > 0 && (
              <div className="flex items-center gap-3 flex-shrink-0" style={{ width: 180 }}>
                <div
                  className="flex-1 h-[2px] overflow-hidden"
                  style={{ background: "rgba(255,255,255,0.07)", borderRadius: 1 }}
                >
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${Math.round((sceneStats.withConti / sceneStats.total) * 100)}%`,
                      background: isCompleted ? "rgba(255,255,255,0.2)" : "#f9423a",
                      borderRadius: 1,
                    }}
                  />
                </div>
                <span className="text-[10px] font-mono text-white/30 flex-shrink-0 whitespace-nowrap">
                  {sceneStats.withConti} / {sceneStats.total}
                </span>
              </div>
            )}
          </div>

          {/* 우측 메타 그룹 — flex-shrink-0으로 항상 고정 */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* 포맷 태그 */}
            {project.video_format && (
              <span
                className="text-[12px] font-mono tracking-wide px-2 py-0.5 border border-white/[0.1] text-white/35"
                style={{ borderRadius: 0 }}
              >
                {formatLabel}
              </span>
            )}

            {/* Owner */}
            {project.client && (
              <span
                className="text-[12px] font-mono tracking-wide px-2 py-0.5 border border-white/[0.1] text-white/35 max-w-[90px] truncate"
                style={{ borderRadius: 0 }}
              >
                {project.client}
              </span>
            )}

            {/* Deadline */}
            <span
              className="text-[12px] font-mono tracking-wide px-2 py-0.5 border"
              style={{
                borderRadius: 0,
                borderColor: isUrgent ? "rgba(249,66,58,0.5)" : "rgba(255,255,255,0.1)",
                color: isUrgent ? "#f9423a" : "rgba(255,255,255,0.35)",
              }}
            >
              {deadlineStr}
            </span>

            {/* ··· 드롭다운 */}
            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              <DropdownMenu>
                <DropdownMenuTrigger
                  onClick={(e) => e.stopPropagation()}
                  className="p-1.5 hover:bg-secondary transition-colors"
                  style={{ borderRadius: 0 }}
                >
                  <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground/50 hover:text-muted-foreground transition-colors" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-card border-border min-w-[110px]">
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(project);
                    }}
                    className="text-[12px] gap-2 cursor-pointer"
                  >
                    <Edit2 className="w-3 h-3" /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDeleteDialog(true);
                    }}
                    className="text-[12px] gap-2 text-destructive focus:text-destructive cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* 화살표 */}
            <ChevronRight className="w-4 h-4 text-muted-foreground/15 group-hover:text-muted-foreground/40 transition-colors duration-150 flex-shrink-0" />
          </div>
        </div>
      </div>

      {/* Crop Modal */}
      {showCropModal && project.thumbnail_url && (
        <ThumbnailCropModal
          imageUrl={project.thumbnail_url}
          initial={crop}
          onSave={handleSaveCrop}
          onClose={() => setShowCropModal(false)}
        />
      )}

      {/* Delete Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="bg-card border-border max-w-sm" style={{ borderRadius: 0 }}>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[15px] font-semibold">Delete this project?</AlertDialogTitle>
            <AlertDialogDescription className="text-[13px]">
              All data will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border hover:bg-secondary h-9 text-[13px]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 h-9 text-[13px]"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
