import { MoreHorizontal, Edit2, Trash2, Crop, ImageIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format, isValid } from "date-fns";
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
import { useT } from "@/lib/uiLanguage";

interface ProjectCardProps {
  project: Project;
  onRefresh: () => void;
  onEdit: (project: Project) => void;
  sceneStats?: SceneStats;
}

export const ProjectCard = ({ project, onRefresh, onEdit, sceneStats }: ProjectCardProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const t = useT();
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
      setShowCropModal(false);
      toast({ title: t("dashboard.thumbnailAdjusted") });
      onRefresh();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Save failed", description: e.message });
    }
  };

  const isCompleted = project.status === "completed";
  const crop = project.thumbnail_crop as CropSettings | null;

  const deadlineDate = project.deadline ? new Date(project.deadline) : null;
  const hasValidDeadline = !!deadlineDate && isValid(deadlineDate);
  const deadlineStr = hasValidDeadline ? format(deadlineDate, "MMM dd yyyy") : "—";

  /* 마감 임박 (3일 이내) */
  const isUrgent = (() => {
    if (!deadlineDate || !hasValidDeadline) return false;
    const diff = Math.ceil((deadlineDate.getTime() - Date.now()) / 86400000);
    return diff >= 0 && diff <= 3;
  })();

  /* 비율 표기 */
  const formatLabel = (() => {
    switch ((project.video_format ?? "").toLowerCase()) {
      case "vertical":
        return "9:16";
      case "horizontal":
        return "16:9";
      case "square":
        return "1:1";
      default:
        return project.video_format?.toUpperCase() ?? null;
    }
  })();

  return (
    <>
      {/* ━━━ 썸네일 중심 카드 ━━━ */}
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
        className="group flex h-full min-w-0 flex-col bg-card border border-border hover:border-primary/25 hover:bg-surface-elevated cursor-pointer transition-all duration-150"
        style={{ borderRadius: 0 }}
      >
        {/* ── 썸네일 — 프로젝트 video_format 과 무관하게 16:9 고정. */}
        <div
          className="relative aspect-video w-full overflow-hidden bg-background border-b border-border flex items-center justify-center group/thumb"
          style={{ borderRadius: 0 }}
        >
          {formatLabel && (
            <span className="absolute left-2 top-2 z-10 bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
              {formatLabel}
            </span>
          )}

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
                decoding="async"
              />
            </>
          ) : (
            <ImageIcon className="w-8 h-8 text-muted-foreground/15" />
          )}
        </div>

        {/* ── 하단 정보: 제목 / 진척 / 메타 ── */}
        <div className="flex min-h-[78px] flex-1 flex-col justify-between gap-2 px-3 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="w-[7px] h-[7px] rounded-full flex-shrink-0"
              style={{ background: isCompleted ? "rgba(52,211,153,0.9)" : "#f9423a" }}
            />
            <h3
              className="min-w-0 flex-1 truncate text-[13px] font-bold tracking-wide group-hover:text-primary transition-colors"
              style={{ color: isCompleted ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.9)" }}
            >
              {project.title}
            </h3>

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
                  {project.thumbnail_url && (
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowCropModal(true);
                      }}
                      className="text-[12px] gap-2 cursor-pointer"
                    >
                      <Crop className="w-3 h-3" /> {t("dashboard.editThumbnail")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(project);
                    }}
                    className="text-[12px] gap-2 cursor-pointer"
                  >
                    <Edit2 className="w-3 h-3" /> {t("common.edit")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDeleteDialog(true);
                    }}
                    className="text-[12px] gap-2 text-destructive focus:text-destructive cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" /> {t("common.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* 진척 바 + ratio — sceneStats 가 없어도 자리 유지.
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

          <div className="flex items-center gap-1.5 min-w-0">
            {project.client && (
              <span
                className="inline-block max-w-[62%] truncate border border-white/[0.1] px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-white/35"
                style={{ borderRadius: 0 }}
              >
                {project.client}
              </span>
            )}

            <span
              className="shrink-0 whitespace-nowrap border px-1.5 py-0.5 font-mono text-[10px] tracking-wide"
              style={{
                borderRadius: 0,
                borderColor: hasValidDeadline
                  ? isUrgent
                    ? "rgba(249,66,58,0.5)"
                    : "rgba(255,255,255,0.1)"
                  : "rgba(255,255,255,0.06)",
                color: hasValidDeadline
                  ? isUrgent
                    ? "#f9423a"
                    : "rgba(255,255,255,0.35)"
                  : "rgba(255,255,255,0.22)",
              }}
            >
              {hasValidDeadline ? deadlineStr : t("dashboard.noDeadline")}
            </span>

            <div className="flex-1" />
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
            <AlertDialogTitle className="text-[15px] font-semibold">{t("dashboard.deleteProjectTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="text-[13px]">
              {t("dashboard.deleteProjectDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border hover:bg-secondary h-9 text-[13px]">{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 h-9 text-[13px]"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
