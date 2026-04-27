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
      {/* ━━━ 2열 그리드용 카드 — 썸네일(좌) + 수직 스택(우) ━━━
       *  [썸네일 180x스트레치]
       *  [● 제목 ........................... ]
       *  [진척 바 ........................ n/m]
       *  [포맷 · owner · deadline ···  →]  */}
      <div
        onClick={() => {
          // 라우팅 우선순위:
          //  1) 콘티탭에 씬 카드가 하나라도 있음 (source='conti' 또는 scene_versions 존재) → storyboard 탭
          //  2) Agent 탭에 씬 카드가 있음 (채팅 시작했지만 아직 콘티탭으로 안 넘김) → agent 탭
          //  3) 그 외 (브리프/에셋까지만 또는 최초 상태) → brief (기본)
          let target = `/project/${project.id}`;
          if (sceneStats?.hasContiScenes) {
            target = `/project/${project.id}?tab=storyboard`;
          } else if (sceneStats?.hasAgentScenes) {
            target = `/project/${project.id}?tab=agent`;
          }
          navigate(target);
        }}
        className="group flex items-stretch bg-card border border-border hover:border-primary/25 hover:bg-surface-elevated cursor-pointer transition-all duration-150 min-h-[124px]"
        style={{ borderRadius: 0 }}
      >
        {/* ── 썸네일 — 프로젝트 video_format 과 무관하게 16:9 고정.
         *  explicit height 를 주면 flex items-stretch 가 무시되므로 카드
         *  우측 패널이 길어져도 썸네일은 늘어나지 않음. */}
        <div
          className="flex-shrink-0 self-start bg-background border-r border-border flex items-center justify-center overflow-hidden relative group/thumb"
          style={{ width: 220, height: 124, borderRadius: 0 }}
          onClick={(e) => {
            if (project.thumbnail_url) {
              e.stopPropagation();
              setShowCropModal(true);
            }
          }}
          title={project.thumbnail_url ? "Click to adjust thumbnail position" : undefined}
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
                }} decoding="async" />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center">
                <Crop className="w-4 h-4 text-white/80" />
              </div>
            </>
          ) : (
            <ImageIcon className="w-6 h-6 text-muted-foreground/15" />
          )}
        </div>

        {/* ── 우측: 3 행 수직 스택 (제목 / 진척 / 메타) ── */}
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-2 px-4 py-3">
          {/* Row 1: dot + 제목 */}
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="w-[7px] h-[7px] rounded-full flex-shrink-0"
              style={{ background: isCompleted ? "rgba(52,211,153,0.9)" : "#f9423a" }}
            />
            <h3
              className="text-[14px] font-bold truncate tracking-wide group-hover:text-primary transition-colors"
              style={{ color: isCompleted ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.9)" }}
            >
              {project.title}
            </h3>
          </div>

          {/* Row 2: 진척 바 + ratio — sceneStats 가 없어도 자리 유지.
           *  진행도는 유저가 수동으로 final 처리한 씬 수(sceneStats.finalCount) 기준.
           *  이미지 유무(conti_image_url)는 더 이상 진행도에 반영되지 않음 — 유저가
           *  "이 컷 최종" 이라고 명시 체크해야 카운트됨. */}
          <div
            className="flex items-center gap-3 min-w-0"
            title={
              sceneStats && sceneStats.total > 0
                ? `${sceneStats.finalCount} of ${sceneStats.total} scenes finalized`
                : undefined
            }
          >
            <div
              className="flex-1 h-[2px] overflow-hidden"
              style={{ background: "rgba(255,255,255,0.07)", borderRadius: 0 }}
            >
              {sceneStats && sceneStats.total > 0 && (
                <div
                  className="h-full transition-all duration-300"
                  style={{
                    width: `${Math.round((sceneStats.finalCount / sceneStats.total) * 100)}%`,
                    background: isCompleted ? "rgba(52,211,153,0.9)" : "#f9423a",
                    borderRadius: 0,
                  }}
                />
              )}
            </div>
            <span className="text-[10px] font-mono text-white/30 flex-shrink-0 whitespace-nowrap">
              {sceneStats && sceneStats.total > 0
                ? `${sceneStats.finalCount} / ${sceneStats.total}`
                : "0 / 0"}
            </span>
          </div>

          {/* Row 3: 메타 배지 + ··· + 화살표 */}
          <div className="flex items-center gap-1.5 min-w-0">
            {project.video_format && (
              <span
                className="text-[11px] font-mono tracking-wide px-1.5 py-0.5 border border-white/[0.1] text-white/35 shrink-0 whitespace-nowrap"
                style={{ borderRadius: 0 }}
              >
                {formatLabel}
              </span>
            )}

            {project.client && (
              <span
                className="text-[11px] font-mono tracking-wide px-1.5 py-0.5 border border-white/[0.1] text-white/35 truncate min-w-0 max-w-[110px]"
                style={{ borderRadius: 0 }}
              >
                {project.client}
              </span>
            )}

            <span
              className="text-[11px] font-mono tracking-wide px-1.5 py-0.5 border shrink-0 whitespace-nowrap"
              style={{
                borderRadius: 0,
                borderColor: project.deadline
                  ? isUrgent
                    ? "rgba(249,66,58,0.5)"
                    : "rgba(255,255,255,0.1)"
                  : "rgba(255,255,255,0.06)",
                color: project.deadline
                  ? isUrgent
                    ? "#f9423a"
                    : "rgba(255,255,255,0.35)"
                  : "rgba(255,255,255,0.22)",
              }}
            >
              {project.deadline ? deadlineStr : "No Deadline"}
            </span>

            <div className="flex-1" />

            {/* ··· 드롭다운 */}
            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              <DropdownMenu>
                <DropdownMenuTrigger
                  onClick={(e) => e.stopPropagation()}
                  className="p-1 hover:bg-secondary transition-colors"
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
