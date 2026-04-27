import { Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { BrandLogo } from "@/components/common/BrandLogo";
import { MetaPill } from "@/components/common/ui-primitives";
import { useT } from "@/lib/uiLanguage";

// ── 타입 ────────────────────────────────────────────────
interface NavbarProps {
  /** 프로젝트 내부 탭에서만 전달. 없으면 Dashboard 모드 */
  folderName?: string;
  projectTitle?: string;
  tabName?: string;
  videoFormat?: string;
  sceneCount?: string; // e.g. "4/39"
}

const Divider = () => <div className="w-px h-4 bg-border-subtle flex-shrink-0" />;

// ── 메인 ───────────────────────────────────────────────
export const Navbar = ({ folderName, projectTitle, tabName, videoFormat, sceneCount }: NavbarProps) => {
  const navigate = useNavigate();
  const t = useT();
  const [email, setEmail] = useState("");
  const isDashboard = !projectTitle;

  useEffect(() => {
    setEmail(t("nav.localUser"));
  }, [t]);

  const handleSettings = () => {
    navigate("/settings");
  };

  return (
    <nav className="app-topbar items-stretch">
      {/* ── 브랜드 존 (항상 고정) ── */}
      <button
        onClick={() => navigate("/dashboard")}
        className={`flex items-center px-8 flex-shrink-0 transition-opacity hover:opacity-80 ${!isDashboard ? "border-r border-border-subtle" : "cursor-default"}`}
      >
        <BrandLogo />
      </button>

      {/* ── 컨텍스트 존 (페이지별 가변) ── */}
      <div className="flex items-center flex-1 px-8 min-w-0">
        {isDashboard ? (
          /* Dashboard */
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-bold text-foreground">{t("nav.projectWorkspace")}</span>
            <MetaPill className="h-[20px] px-1.5 text-[9px] tracking-widest">
              Beta V1.0
            </MetaPill>
          </div>
        ) : (
          /* 프로젝트 탭 — breadcrumb */
          <div className="flex items-center min-w-0 overflow-hidden">
            {folderName && (
              <>
                <span className="text-[11px] text-muted-foreground flex-shrink-0">{folderName}</span>
                <span className="text-primary/50 text-[10px] mx-2 flex-shrink-0">/</span>
              </>
            )}
            <span className="text-[12px] font-semibold text-foreground flex-shrink-0 truncate max-w-[180px]">
              {projectTitle}
            </span>
            {tabName && (
              <>
                <span className="text-primary/50 text-[10px] mx-2 flex-shrink-0">/</span>
                <span className="text-[12px] text-text-secondary flex-shrink-0">{tabName}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── 우측 존 (항상 고정) ── */}
      <div className="flex items-center gap-6 px-7 flex-shrink-0">
        {isDashboard ? (
          /* Dashboard: 이메일 + 로그아웃 */
          <>
            <span className="text-[13px] text-muted-foreground hidden sm:block truncate max-w-[160px]">{email}</span>
            <Divider />
            <button
              onClick={handleSettings}
              className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <Settings size={13} />
              <span className="hidden sm:block">{t("common.settings")}</span>
            </button>
          </>
        ) : (
          /* 프로젝트 탭: 포맷 · 유저 · 씬수 + 로그아웃 */
          <>
            {videoFormat && (
              <MetaPill className="hidden sm:inline-flex">
                {videoFormat}
              </MetaPill>
            )}
            <Divider />
            <span className="text-[11px] text-muted-foreground hidden sm:block">{email.split("@")[0]}</span>
            <Divider />
            {sceneCount && (
              <MetaPill>
                {sceneCount}
              </MetaPill>
            )}
            <Divider />
            <button
              onClick={handleSettings}
              className="flex items-center text-muted-foreground hover:text-foreground transition-colors"
            >
              <Settings size={12} />
            </button>
          </>
        )}
      </div>
    </nav>
  );
};
