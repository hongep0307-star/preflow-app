import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Library } from "lucide-react";

const RETURN_TO_KEY = "preflow.library.returnTo";
const SWITCHER_SIZE = 48;
const SWITCHER_OFFSET = 20;
const SWITCHER_BOTTOM = 40;
const SWITCHER_RED = "#ff3434";

function currentPath(location: ReturnType<typeof useLocation>): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

function shouldShow(pathname: string): boolean {
  return pathname === "/dashboard" || pathname === "/library" || pathname.startsWith("/project/");
}

export const ModeSwitcher = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const path = currentPath(location);
  const isLibrary = location.pathname === "/library";

  useEffect(() => {
    if (!isLibrary && shouldShow(location.pathname)) {
      sessionStorage.setItem(RETURN_TO_KEY, path);
    }
  }, [isLibrary, location.pathname, path]);

  if (!shouldShow(location.pathname)) return null;

  const goLibrary = () => {
    const returnTo = path || "/dashboard";
    sessionStorage.setItem(RETURN_TO_KEY, returnTo);
    navigate(`/library?returnTo=${encodeURIComponent(returnTo)}`);
  };

  const goBack = () => {
    const params = new URLSearchParams(location.search);
    const returnTo = params.get("returnTo") || sessionStorage.getItem(RETURN_TO_KEY) || "/dashboard";
    navigate(returnTo);
  };

  return (
    <div
      style={{
        position: "fixed",
        left: `calc(100vw - ${SWITCHER_SIZE + SWITCHER_OFFSET}px)`,
        right: "auto",
        bottom: SWITCHER_BOTTOM,
        width: SWITCHER_SIZE,
        height: SWITCHER_SIZE,
        zIndex: 50,
        boxSizing: "border-box",
        transform: "none",
      }}
    >
      <button
        onClick={isLibrary ? goBack : goLibrary}
        className="border bg-background/95 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur transition-colors hover:bg-background"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: SWITCHER_SIZE,
          height: SWITCHER_SIZE,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
          padding: 0,
          borderRadius: 0,
          boxSizing: "border-box",
          borderColor: SWITCHER_RED,
          color: SWITCHER_RED,
        }}
        title={isLibrary ? "Back to Project Mode" : "Open Reference Library"}
        aria-label={isLibrary ? "Back to Project Mode" : "Open Reference Library"}
      >
        {isLibrary ? (
          <ArrowLeft className="h-5 w-5" strokeWidth={2.25} />
        ) : (
          <Library className="h-5 w-5" strokeWidth={2.25} />
        )}
      </button>
    </div>
  );
};
