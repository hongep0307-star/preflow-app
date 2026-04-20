import { useEffect, useState, useRef, useCallback, lazy, Suspense } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Clapperboard, Calendar, X, Check, Loader2, FileDown } from "lucide-react";
import { ProjectSidebar, TabId } from "@/components/ProjectSidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import type { VideoFormat } from "@/lib/conti";

const BriefTab = lazy(() => import("@/components/BriefTab").then((m) => ({ default: m.BriefTab })));
const AgentTab = lazy(() => import("@/components/AgentTab").then((m) => ({ default: m.AgentTab })));
const AssetsTab = lazy(() => import("@/components/AssetsTab").then((m) => ({ default: m.AssetsTab })));
const ContiTab = lazy(() => import("@/components/ContiTab").then((m) => ({ default: m.ContiTab })));

const TabLoadingFallback = () => (
  <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
    <Loader2 className="w-4 h-4 animate-spin" />
    <span className="font-mono text-[11px] tracking-wide">Loading...</span>
  </div>
);

interface ProjectInfo {
  title: string;
  client: string | null;
  deadline: string | null;
  video_format: VideoFormat;
}

const FORMAT_BADGE: Record<VideoFormat, { label: string; short: string }> = {
  vertical: { label: "9:16 Vertical", short: "9:16" },
  horizontal: { label: "16:9 Horizontal", short: "16:9" },
  square: { label: "1:1 Square", short: "1:1" },
};

const FORMAT_EDIT_OPTIONS: { value: VideoFormat; label: string }[] = [
  { value: "vertical", label: "9:16 Vertical" },
  { value: "horizontal", label: "16:9 Horizontal" },
  { value: "square", label: "1:1 Square" },
];

const ProjectPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as TabId) || "brief";
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [folderName, setFolderName] = useState<string>("");
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const isMobile = useIsMobile();

  const [editingField, setEditingField] = useState<"format" | "client" | "deadline" | null>(null);
  const [editClient, setEditClient] = useState("");
  const [editDeadline, setEditDeadline] = useState("");
  const [briefLang, setBriefLang] = useState<"ko" | "en">("ko");
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");

  const formatRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<HTMLDivElement>(null);
  const deadlineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    const fetchData = async () => {
      const { data } = await supabase
        .from("projects")
        .select("title, client, deadline, video_format, folder_id")
        .eq("id", id)
        .single();
      if (data) {
        setProject({ ...data, video_format: (data as any).video_format || "vertical" } as ProjectInfo);
        if ((data as any).folder_id) {
          const { data: folderData } = await supabase
            .from("folders")
            .select("name")
            .eq("id", (data as any).folder_id)
            .single();
          if (folderData) setFolderName(folderData.name);
        }
      }
    };
    fetchData();
  }, [id]);

  useEffect(() => {
    if (!editingField) return;
    const refs = { format: formatRef, client: clientRef, deadline: deadlineRef };
    const handler = (e: MouseEvent) => {
      const ref = refs[editingField];
      if (ref?.current && !ref.current.contains(e.target as Node)) setEditingField(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editingField]);

  const updateProjectField = useCallback(
    async (patch: Partial<{ video_format: VideoFormat; client: string | null; deadline: string | null }>) => {
      if (!id) return;
      const { data } = await supabase
        .from("projects")
        .update(patch)
        .eq("id", id)
        .select("title, client, deadline, video_format")
        .single();
      if (data) setProject({ ...data, video_format: (data as any).video_format || "vertical" } as ProjectInfo);
      setEditingField(null);
    },
    [id],
  );

  const saveTitle = useCallback(
    async (val: string) => {
      const trimmed = val.trim();
      if (!trimmed || !id) {
        setEditingTitle(false);
        return;
      }
      const { data } = await supabase
        .from("projects")
        .update({ title: trimmed })
        .eq("id", id)
        .select("title, client, deadline, video_format")
        .single();
      if (data) setProject({ ...data, video_format: (data as any).video_format || "vertical" } as ProjectInfo);
      setEditingTitle(false);
    },
    [id],
  );

  const formatDeadlineDisplay = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso + "T00:00:00");
    const mm = d.getMonth() + 1;
    const dd = d.getDate();
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const diff = Math.ceil((d.getTime() - now.getTime()) / 86400000);
    const base = `${mm}/${dd}`;
    if (diff < 0) return { text: `${base} (D+${Math.abs(diff)})`, urgent: true };
    if (diff === 0) return { text: `${base} (TODAY)`, urgent: true };
    if (diff <= 3) return { text: `${base} (D-${diff})`, urgent: true };
    return { text: base, urgent: false };
  };

  const videoFormat = project?.video_format ?? "vertical";
  const badge = FORMAT_BADGE[videoFormat];
  const deadlineDisplay = formatDeadlineDisplay(project?.deadline ?? null);

  const handleSwitchToContiTab = (sceneNumber?: number) => {
    setActiveTab("storyboard");
    if (sceneNumber) {
      setTimeout(() => {
        const el = document.getElementById(`conti-scene-${sceneNumber}`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  };

  const renderContent = () => {
    if (!id) return null;
    return (
      <Suspense fallback={<TabLoadingFallback />}>
        {activeTab === "brief" && (
          <BriefTab
            projectId={id}
            onSwitchToAgent={(lang) => { setBriefLang(lang); setActiveTab("agent"); }}
            onSwitchToAssets={() => setActiveTab("assets")}
          />
        )}
        {activeTab === "agent" && (
          <AgentTab projectId={id} videoFormat={videoFormat} lang={briefLang} onSwitchToContiTab={handleSwitchToContiTab} />
        )}
        {activeTab === "assets" && <AssetsTab projectId={id} onSwitchToAgent={() => setActiveTab("agent")} />}
        {activeTab === "storyboard" && <ContiTab projectId={id} videoFormat={videoFormat} />}
      </Suspense>
    );
  };

  /* ── Pill 스타일 ── */
  const pillBase =
    "font-mono text-[10px] font-medium tracking-wide px-2.5 h-[26px] inline-flex items-center border transition-colors duration-100 cursor-pointer select-none";
  const pillDefault =
    "border-border bg-secondary/50 text-muted-foreground hover:border-primary/30 hover:text-foreground";
  const pillActive = "border-primary/40 bg-primary/10 text-primary";

  const TAB_LABEL: Record<TabId, string> = {
    brief: "Brief",
    agent: "Agents",
    assets: "Assets",
    storyboard: "Conti",
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* ── Top bar ── */}
      <nav
        className="h-16 border-b flex items-center justify-between px-4 shrink-0"
        style={{ background: "#0d0d0d", borderColor: "rgba(255,255,255,0.05)" }}
      >
        {/* 왼쪽: 브랜드(클릭 시 대시보드) + 브레드크럼 + 제목 */}
        <div className="flex items-center gap-0">
          {/* 브랜드 버튼 */}
          <button
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-3 pl-4 pr-8 border-r border-white/[0.13] hover:opacity-75 transition-opacity flex-shrink-0"
          >
            <div className="relative w-[22px] h-[17px] scale-150 origin-center">
              <div className="absolute bottom-0 right-0 w-[13px] h-[9px] rounded-[2px] border border-white/10 bg-[#1a1a1a]" />
              <div className="absolute bottom-[2.5px] right-[2.5px] w-[14px] h-[10px] rounded-[2px] border border-[#5a2a2a] bg-[#1c1010]" />
              <div className="absolute bottom-[5px] right-[4.5px] w-[15px] h-[11px] rounded-[2px] border-[1.5px] border-[#f9423a] bg-[#1f0f0f]">
                <span className="absolute left-[1.5px] top-1/2 -translate-y-1/2 w-[2px] h-[2px] bg-[#f9423a] rounded-[0.5px]" />
                <span className="absolute right-[1.5px] top-1/2 -translate-y-1/2 w-[2px] h-[2px] bg-[#f9423a] rounded-[0.5px]" />
              </div>
            </div>
            <span className="text-[26px] font-extrabold tracking-tight leading-none">
              <span className="text-white">Pre</span>
              <span className="text-[#f9423a]">-Flow</span>
            </span>
          </button>

          {/* 브레드크럼 */}
          <div className="flex items-center pl-8 gap-0">
            {folderName && (
              <>
                <span className="text-[15px] text-white/35">{folderName}</span>
                <span className="text-[#f9423a]/50 text-[10px] mx-2">/</span>
              </>
            )}
            {editingTitle ? (
              <input
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveTitle(editTitle);
                  if (e.key === "Escape") setEditingTitle(false);
                }}
                onBlur={() => saveTitle(editTitle)}
                className="text-[15px] font-bold border-b border-primary bg-transparent text-foreground outline-none w-[200px] tracking-wide"
              />
            ) : (
              <button
                onClick={() => {
                  setEditTitle(project?.title ?? "");
                  setEditingTitle(true);
                }}
                className="text-[15px] font-bold text-white/80 truncate max-w-[200px] hover:text-white transition-colors cursor-pointer tracking-wide"
                title="제목 수정"
              >
                {project?.title || ""}
              </button>
            )}
            <span className="text-[#f9423a]/50 text-[10px] mx-2">/</span>
            <span className="text-[15px] text-white/55 flex-shrink-0">{TAB_LABEL[activeTab]}</span>
          </div>
        </div>

        {/* 오른쪽: 메타 pills */}
        <div className="flex items-center gap-2">
          {/* 비율 */}
          <div ref={formatRef} className="relative">
            <button
              onClick={() => setEditingField(editingField === "format" ? null : "format")}
              className={`${pillBase} ${editingField === "format" ? pillActive : pillDefault}`}
              style={{ borderRadius: 0 }}
            >
              {badge?.label}
            </button>
            {editingField === "format" && (
              <div
                className="absolute right-0 top-[calc(100%+4px)] z-50 bg-card border border-border shadow-xl overflow-hidden min-w-[160px]"
                style={{ borderRadius: 0 }}
              >
                {FORMAT_EDIT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => updateProjectField({ video_format: opt.value })}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-[11px] font-mono font-medium tracking-wide text-left transition-colors ${
                      project?.video_format === opt.value
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-secondary text-foreground/70"
                    }`}
                  >
                    <span className="flex-1">{opt.label}</span>
                    {project?.video_format === opt.value && <Check className="w-3 h-3 text-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 요청부서 */}
          <div ref={clientRef} className="relative hidden md:block">
            {editingField === "client" ? (
              <input
                autoFocus
                value={editClient}
                onChange={(e) => setEditClient(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") updateProjectField({ client: editClient.trim() || null });
                  if (e.key === "Escape") setEditingField(null);
                }}
                onBlur={() => updateProjectField({ client: editClient.trim() || null })}
                placeholder="DEPARTMENT"
                className="font-mono text-[10px] font-medium tracking-wide border border-primary/40 px-2.5 h-[26px] inline-flex items-center bg-background text-foreground outline-none w-[110px]"
                style={{ borderRadius: 0 }}
              />
            ) : (
              <button
                onClick={() => {
                  setEditClient(project?.client ?? "");
                  setEditingField("client");
                }}
                className={`${pillBase} ${pillDefault}`}
                style={{ borderRadius: 0 }}
              >
                {project?.client || "Dept"}
              </button>
            )}
          </div>

          {/* 마감일 */}
          <div ref={deadlineRef} className="relative hidden md:flex items-center">
            {editingField === "deadline" ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  type="date"
                  lang="en"
                  value={editDeadline}
                  onChange={(e) => setEditDeadline(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") updateProjectField({ deadline: editDeadline || null });
                    if (e.key === "Escape") setEditingField(null);
                  }}
                  onBlur={() => updateProjectField({ deadline: editDeadline || null })}
                  className="font-mono text-[10px] font-bold uppercase border border-primary/40 px-2 py-0.5 bg-background text-foreground outline-none"
                  style={{ borderRadius: 0, colorScheme: "dark" }}
                />
                {project?.deadline && (
                  <button
                    onMouseDown={(e) => {
                      e.preventDefault();
                      updateProjectField({ deadline: null });
                    }}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                    title="마감일 삭제"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={() => {
                  setEditDeadline(project?.deadline ?? "");
                  setEditingField("deadline");
                }}
                className={`${pillBase} ${deadlineDisplay?.urgent ? "border-primary/40 text-primary bg-primary/5" : pillDefault}`}
                style={{ borderRadius: 0 }}
              >
                <Calendar className="w-3 h-3 inline mr-1 -mt-px" />
                {deadlineDisplay ? deadlineDisplay.text : "Deadline"}
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">
        <ProjectSidebar activeTab={activeTab} onTabChange={setActiveTab} />
        <main
          className={`flex-1 overflow-hidden ${activeTab === "brief" ? "overflow-y-auto p-5 lg:p-6" : ""} ${isMobile ? "pb-14" : ""}`}
        >
          {renderContent()}
        </main>
      </div>
    </div>
  );
};

export default ProjectPage;
