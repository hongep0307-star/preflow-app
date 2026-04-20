import { FileText, MessageSquare, Layers, Film } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export type TabId = "brief" | "agent" | "assets" | "storyboard";

const tabs: { id: TabId; icon: typeof FileText; label: string }[] = [
  { id: "brief", icon: FileText, label: "Brief" },
  { id: "assets", icon: Layers, label: "Assets" },
  { id: "agent", icon: MessageSquare, label: "Agents" },
  { id: "storyboard", icon: Film, label: "Conti" },
];

interface Props {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export const ProjectSidebar = ({ activeTab, onTabChange }: Props) => {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 h-12 border-t border-border flex items-center justify-around"
        style={{ background: "#0d0d0d" }}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "flex flex-col items-center justify-center w-14 h-12 transition-colors duration-100",
                isActive ? "text-primary" : "text-muted-foreground active:text-foreground",
              )}
            >
              <tab.icon className="w-4 h-4" />
              <span className="text-[8px] mt-0.5 font-bold tracking-wider">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    );
  }

  return (
    <aside
      className="flex flex-col items-center shrink-0 border-r"
      style={{
        width: 72,
        background: "#0d0d0d",
        borderColor: "rgba(255,255,255,0.05)",
      }}
    >
      <div className="flex-1 flex flex-col items-center justify-center gap-0.5">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              title={tab.label}
              className={cn(
                "relative flex flex-col items-center justify-center w-full py-4 transition-colors duration-100 gap-1.5",
                isActive ? "text-primary" : "hover:text-foreground/60",
              )}
              style={{ color: isActive ? undefined : "#4a4a4a" }}
            >
              <tab.icon className="w-[22px] h-[22px]" />
              <span className="text-[9px] font-bold tracking-widest leading-none">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
};
