import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, RotateCcw } from "lucide-react";
import { KR } from "./contiTypes";

export const GenerateAllModal = ({
  totalCount,
  missingCount,
  onClose,
  onConfirm,
}: {
  totalCount: number;
  missingCount: number;
  onClose: () => void;
  onConfirm: (mode: "all" | "missing") => void;
}) => {
  const allDone = missingCount === 0;
  const handleConfirm = (mode: "all" | "missing") => {
    onConfirm(mode);
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[400px] bg-card border-border" style={{ borderRadius: 0 }}>
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold">{allDone ? "Regenerate All" : "Generation Mode"}</DialogTitle>
        </DialogHeader>
        <p className="text-[13px] text-muted-foreground">
          {allDone
            ? `All scenes (${totalCount}) already have conti. Regenerate all?`
            : `${totalCount - missingCount} of ${totalCount} scenes have conti.`}
        </p>
        {!allDone && (
          <div className="space-y-2 mt-1">
            {[
              {
                mode: "missing" as const,
                Icon: Plus,
                title: `Generate missing only (${missingCount})`,
                desc: "Keep existing conti",
              },
              {
                mode: "all" as const,
                Icon: RotateCcw,
                title: `Regenerate all (${totalCount})`,
                desc: "Replace existing conti",
              },
            ].map((opt) => (
              <button
                key={opt.mode}
                onClick={() => handleConfirm(opt.mode)}
                className="w-full flex items-start gap-3 p-3 rounded-none border text-left transition-colors hover:border-[#f9423a] hover:bg-[rgba(249,66,58,0.04)]"
                style={{ borderColor: "hsl(var(--border))" }}
              >
                <opt.Icon
                  className="w-4 h-4 shrink-0 mt-0.5"
                  style={{ color: "rgba(255,255,255,0.5)" }}
                  strokeWidth={1.75}
                />
                <div>
                  <div className="text-[13px] font-semibold">{opt.title}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{opt.desc}</div>
                </div>
              </button>
            ))}
          </div>
        )}
        <DialogFooter>
          {allDone ? (
            <>
              <Button variant="ghost" className="text-[13px] h-9" onClick={onClose}>Cancel</Button>
              <Button className="text-white text-[13px] h-9" style={{ background: KR }} onClick={() => handleConfirm("all")}>
                Regenerate All
              </Button>
            </>
          ) : (
            <Button variant="ghost" className="text-[13px] h-9" onClick={onClose}>Cancel</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
