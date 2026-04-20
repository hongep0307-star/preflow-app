import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import { Loader2, CalendarIcon } from "lucide-react";
import { format, parse } from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { Project, Folder as FolderType } from "@/pages/DashboardPage";

type VideoFormat = "vertical" | "horizontal" | "square";

interface StylePreset {
  id: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  is_default: boolean;
}

const FORMAT_OPTIONS: { value: VideoFormat; label: string; ratio: string; badge: string; w: number; h: number }[] = [
  { value: "horizontal", label: "Horizontal", ratio: "16 : 9", badge: "TV · YouTube", w: 32, h: 20 },
  { value: "vertical", label: "Vertical", ratio: "9 : 16", badge: "Shorts · TikTok", w: 20, h: 32 },
  { value: "square", label: "Square", ratio: "1 : 1", badge: "Instagram · Feed", w: 24, h: 24 },
];

const KR = "#f9423a";
const KR_BG = "rgba(249,66,58,0.10)";
const KR_BG2 = "rgba(249,66,58,0.06)";
const KR_BORDER = "rgba(249,66,58,0.28)";

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (projectId?: string) => void;
  editProject?: Project | null;
  /** 사이드바 폴더 목록 — 생성 시 폴더 선택 UI 표시 */
  folders?: FolderType[];
  /** 생성 시 기본 선택 폴더 ID */
  initialFolderId?: string | null;
}

export const ProjectModal = ({
  isOpen,
  onClose,
  onSuccess,
  editProject,
  folders = [],
  initialFolderId = null,
}: ProjectModalProps) => {
  const [loading, setLoading] = useState(false);
  const [stylePresets, setStylePresets] = useState<StylePreset[]>([]);
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    title: "",
    client: "",
    deadline: "",
    status: "active",
    video_format: "horizontal" as VideoFormat,
    conti_style_id: "" as string,
    folder_id: null as string | null,
  });

  /* ── 스타일 프리셋 로드 ── */
  useEffect(() => {
    const fetchPresets = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data } = await supabase
        .from("style_presets")
        .select("id, name, description, thumbnail_url, is_default")
        .or(`is_default.eq.true,user_id.eq.${user?.id}`)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true });
      if (data) {
        setStylePresets(data as StylePreset[]);
        // 신규 프로젝트 기본 스타일 자동 선택 제거 — None으로 시작
      }
    };
    if (isOpen) fetchPresets();
  }, [isOpen]);

  /* ── 폼 초기화 ── */
  useEffect(() => {
    if (editProject) {
      setFormData({
        title: editProject.title,
        client: editProject.client || "",
        deadline: editProject.deadline || "",
        status: editProject.status,
        video_format: ((editProject as any).video_format as VideoFormat) || "horizontal",
        conti_style_id: (editProject as any).conti_style_id || "",
        folder_id: editProject.folder_id ?? null,
      });
    } else {
      setFormData({
        title: "",
        client: "",
        deadline: "",
        status: "active",
        video_format: "horizontal",
        conti_style_id: "", // 신규 프로젝트는 스타일 None
        folder_id: initialFolderId ?? null,
      });
    }
  }, [editProject, isOpen, initialFolderId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const payload = {
      title: formData.title,
      client: formData.client || null,
      deadline: formData.deadline || null,
      status: formData.status,
      video_format: formData.video_format,
      conti_style_id: formData.conti_style_id || null,
      folder_id: formData.folder_id || null,
    };

    if (editProject) {
      const { error } = await supabase
        .from("projects")
        .update(payload as any)
        .eq("id", editProject.id);
      if (error) toast({ variant: "destructive", title: "Update failed", description: error.message });
      else {
        onSuccess();
        onClose();
      }
    } else {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("projects")
        .insert([{ ...payload, user_id: user?.id } as any])
        .select()
        .single();
      if (error) toast({ variant: "destructive", title: "Create failed", description: error.message });
      else {
        onClose();
        onSuccess(data?.id);
      }
    }
    setLoading(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-[480px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold">
            {editProject ? "Edit Project" : "Create Project"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 mt-4">
          {/* 프로젝트명 */}
          <div className="space-y-2">
            <Label className="text-muted-foreground text-[13px]">Project Name *</Label>
            <Input
              required
              placeholder="Project name"
              className="bg-background border-border placeholder:text-muted-foreground/30 text-[13px]"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            />
          </div>

          {/* 요청 부서 */}
          <div className="space-y-2">
            <Label className="text-muted-foreground text-[13px]">Department</Label>
            <Input
              placeholder="Department name"
              className="bg-background border-border placeholder:text-muted-foreground/30 text-[13px]"
              value={formData.client}
              onChange={(e) => setFormData({ ...formData, client: e.target.value })}
            />
          </div>

          {/* 마감일 + 상태 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground text-[13px]">Deadline</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-[200px] justify-start text-left font-normal bg-background border-border text-[13px]",
                      !formData.deadline && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.deadline
                      ? format(parse(formData.deadline, "yyyy-MM-dd", new Date()), "MMM d, yyyy")
                      : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formData.deadline ? parse(formData.deadline, "yyyy-MM-dd", new Date()) : undefined}
                    onSelect={(d) => setFormData({ ...formData, deadline: d ? format(d, "yyyy-MM-dd") : "" })}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground text-[13px]">Status</Label>
              <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                <SelectTrigger className="bg-background border-border text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="active" className="text-[13px]">
                    In Progress
                  </SelectItem>
                  <SelectItem value="completed" className="text-[13px]">
                    Completed
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 폴더 선택 — 폴더가 1개 이상일 때만 표시 */}
          {folders.length > 0 && (
            <div className="space-y-2">
              <Label className="text-muted-foreground text-[13px]">Folder</Label>
              <Select
                value={formData.folder_id ?? "ungrouped"}
                onValueChange={(v) => setFormData({ ...formData, folder_id: v === "ungrouped" ? null : v })}
              >
                <SelectTrigger className="w-full bg-background border-border text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="ungrouped" className="text-[13px]">
                    Ungrouped
                  </SelectItem>
                  {folders.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id} className="text-[13px]">
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* 영상 포맷 */}
          <div className="space-y-2">
            <Label className="text-muted-foreground text-[13px]">Video Format</Label>
            <div className="grid grid-cols-3 gap-3">
              {FORMAT_OPTIONS.map((opt) => {
                const selected = formData.video_format === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, video_format: opt.value })}
                    className="flex flex-col items-center justify-center p-3 rounded-none border cursor-pointer transition-all min-h-[110px]"
                    style={{
                      borderColor: selected ? KR : "hsl(var(--border))",
                      background: selected ? KR_BG : "transparent",
                      outline: selected ? `2px solid ${KR_BORDER}` : "none",
                    }}
                  >
                    <div className="flex items-center justify-center h-10 mb-1.5">
                      <svg width={opt.w} height={opt.h} viewBox={`0 0 ${opt.w} ${opt.h}`}>
                        <rect
                          width={opt.w}
                          height={opt.h}
                          rx={0}
                          fill={selected ? KR : "hsl(var(--muted-foreground))"}
                        />
                      </svg>
                    </div>
                    <div className="flex flex-col items-center gap-0.5 mt-auto">
                      <span
                        className="text-[13px] font-semibold"
                        style={{ color: selected ? KR : "hsl(var(--foreground))" }}
                      >
                        {opt.label}
                      </span>
                      <span className="text-[12px]" style={{ color: selected ? KR : "hsl(var(--muted-foreground))" }}>
                        {opt.ratio}
                      </span>
                      <span
                        className="text-[11px]"
                        style={{ color: selected ? "rgba(249,66,58,0.6)" : "hsl(var(--muted-foreground)/0.6)" }}
                      >
                        {opt.badge}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 액션 버튼 */}
          <div className="flex justify-end gap-3 mt-8">
            <Button type="button" variant="ghost" onClick={onClose} className="hover:bg-secondary text-[13px] h-9">
              Cancel
            </Button>
            <Button disabled={loading} className="bg-primary hover:bg-primary/85 min-w-[120px] text-[13px] h-9">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : editProject ? "Save" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
