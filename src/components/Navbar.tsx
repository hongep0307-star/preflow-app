import { LogOut, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";

// ── 타입 ────────────────────────────────────────────────
interface NavbarProps {
  /** 프로젝트 내부 탭에서만 전달. 없으면 Dashboard 모드 */
  folderName?: string;
  projectTitle?: string;
  tabName?: string;
  videoFormat?: string;
  sceneCount?: string; // e.g. "4/39"
}

// ── 필름 아이콘 (소형) ──────────────────────────────────
const FilmIcon = () => (
  <div className="relative w-[22px] h-[17px] flex-shrink-0 scale-150 origin-center">
    <div className="absolute bottom-0 right-0 w-[13px] h-[9px] rounded-[2px] border border-white/10 bg-[#1a1a1a]" />
    <div className="absolute bottom-[2.5px] right-[2.5px] w-[14px] h-[10px] rounded-[2px] border border-[#5a2a2a] bg-[#1c1010]" />
    <div className="absolute bottom-[5px] right-[4.5px] w-[15px] h-[11px] rounded-[2px] border-[1.5px] border-[#f9423a] bg-[#1f0f0f]">
      <span className="absolute left-[1.5px] top-1/2 -translate-y-1/2 w-[2px] h-[2px] bg-[#f9423a] rounded-[0.5px]" />
      <span className="absolute right-[1.5px] top-1/2 -translate-y-1/2 w-[2px] h-[2px] bg-[#f9423a] rounded-[0.5px]" />
    </div>
  </div>
);

const Divider = () => <div className="w-px h-4 bg-white/[0.13] flex-shrink-0" />;

// ── 메인 ───────────────────────────────────────────────
export const Navbar = ({ folderName, projectTitle, tabName, videoFormat, sceneCount }: NavbarProps) => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const isDashboard = !projectTitle;

  useEffect(() => {
    setEmail("Local User");
  }, []);

  const handleSettings = () => {
    navigate("/settings");
  };

  return (
    <nav className="flex items-stretch h-16 bg-[#0e0e0e] border-b border-white/[0.08] flex-shrink-0">
      {/* ── 브랜드 존 (항상 고정) ── */}
      <button
        onClick={() => navigate("/dashboard")}
        className={`flex items-center gap-3 px-8 flex-shrink-0 transition-colors ${!isDashboard ? "border-r border-white/[0.13]" : "cursor-default"}`}
      >
        <FilmIcon />
        <span className="text-[26px] font-extrabold tracking-tight leading-none">
          <span className="text-white">Pre</span>
          <span className="text-[#f9423a]">-Flow</span>
        </span>
      </button>

      {/* ── 컨텍스트 존 (페이지별 가변) ── */}
      <div className="flex items-center flex-1 px-8 min-w-0">
        {isDashboard ? (
          /* Dashboard */
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-bold text-white">Project Workspace</span>
            <span className="text-[9px] font-mono tracking-widest text-white/25 border border-white/[0.1] rounded-[3px] px-1.5 py-0.5 bg-white/[0.04]">
              Beta V1.0
            </span>
          </div>
        ) : (
          /* 프로젝트 탭 — breadcrumb */
          <div className="flex items-center min-w-0 overflow-hidden">
            {folderName && (
              <>
                <span className="text-[11px] text-white/35 flex-shrink-0">{folderName}</span>
                <span className="text-[#f9423a]/50 text-[10px] mx-2 flex-shrink-0">/</span>
              </>
            )}
            <span className="text-[12px] font-semibold text-white flex-shrink-0 truncate max-w-[180px]">
              {projectTitle}
            </span>
            {tabName && (
              <>
                <span className="text-[#f9423a]/50 text-[10px] mx-2 flex-shrink-0">/</span>
                <span className="text-[12px] text-white/55 flex-shrink-0">{tabName}</span>
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
            <span className="text-[13px] text-white/40 hidden sm:block truncate max-w-[160px]">{email}</span>
            <Divider />
            <button
              onClick={handleSettings}
              className="flex items-center gap-1 text-[13px] text-white/35 hover:text-white/65 transition-colors"
            >
              <Settings size={13} />
              <span className="hidden sm:block">Settings</span>
            </button>
          </>
        ) : (
          /* 프로젝트 탭: 포맷 · 유저 · 씬수 + 로그아웃 */
          <>
            {videoFormat && (
              <span className="text-[10px] font-mono text-white/35 border border-white/[0.1] rounded-[3px] px-2 py-0.5 hidden sm:block">
                {videoFormat}
              </span>
            )}
            <Divider />
            <span className="text-[11px] text-white/45 hidden sm:block">{email.split("@")[0]}</span>
            <Divider />
            {sceneCount && (
              <span className="text-[10px] font-mono text-white/35 border border-white/[0.1] rounded-[3px] px-2 py-0.5">
                {sceneCount}
              </span>
            )}
            <Divider />
            <button
              onClick={handleSettings}
              className="flex items-center text-white/30 hover:text-white/60 transition-colors"
            >
              <Settings size={12} />
            </button>
          </>
        )}
      </div>
    </nav>
  );
};
