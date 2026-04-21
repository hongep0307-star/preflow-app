import { Palette, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { KR } from "./contiTypes";

export const StyleTransferConfirmModal = ({
  styleName,
  styleThumb,
  sceneCount,
  selectedCount,
  onClose,
  onConfirm,
}: {
  styleName: string;
  styleThumb: string | null;
  sceneCount: number;
  selectedCount: number;
  onClose: () => void;
  onConfirm: (mode: "all" | "selected") => void;
}) => {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-full max-w-[560px] bg-card border-border" style={{ borderRadius: 0 }}>
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold flex items-center gap-2">
            Style Transfer
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Preset style info */}
          <div className="flex w-full items-center gap-3 p-3 rounded-none border border-border bg-background">
            {styleThumb ? (
              <img src={styleThumb} className="w-16 h-10 object-cover shrink-0" style={{ borderRadius: 0 }} loading="lazy" decoding="async" />
            ) : (
              <div className="w-16 h-10 bg-muted shrink-0 flex items-center justify-center" style={{ borderRadius: 0 }}>
                <Palette className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-foreground truncate">{styleName}</div>
              <div className="text-[11px] text-muted-foreground">Selected style</div>
            </div>
          </div>

          <p className="text-[13px] text-muted-foreground leading-relaxed">
            {selectedCount > 0 ? (
              <>Transfer style to <strong className="text-foreground">{selectedCount} selected</strong> or all <strong className="text-foreground">{sceneCount} scenes</strong>.</>
            ) : (
              <>Transfer style to all <strong className="text-foreground">{sceneCount} scenes</strong> with conti images.</>
            )}
            <br />
            Original images are auto-saved to history.
          </p>
          <div className="flex items-start gap-2 rounded-none bg-muted/50 px-3 py-2 text-[12px] text-muted-foreground">
            <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-px" strokeWidth={1.75} />
            <span>Composition and layout are preserved — only the visual style changes.</span>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:flex-row sm:flex-wrap sm:justify-end sm:space-x-0">
          <Button variant="ghost" className="text-[13px] h-9" onClick={onClose}>Cancel</Button>
          <Button
            variant="outline"
            className="h-9 px-4 gap-1.5 text-[13px]"
            style={{ color: "hsl(var(--muted-foreground))", borderColor: "hsl(var(--border))" }}
            onClick={() => { onConfirm("all"); onClose(); }}
          >
            Transfer All ({sceneCount})
          </Button>
          {selectedCount > 0 && (
            <Button
              className="h-9 px-4 text-white gap-1.5 text-[13px]"
              style={{ background: KR }}
              onClick={() => { onConfirm("selected"); onClose(); }}
            >
              Selected ({selectedCount})
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
