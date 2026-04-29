import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { applyPack, previewPack } from "@/lib/preflowPackClient";
import type { PackImportStrategy, PackPreview } from "@/lib/preflowPack";
import { useToast } from "@/hooks/use-toast";

interface PackImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

function formatBytes(value: number): string {
  if (!value || !Number.isFinite(value)) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

export function PackImportDialog({ open, onOpenChange, onComplete }: PackImportDialogProps) {
  const { toast } = useToast();
  const [preview, setPreview] = useState<PackPreview | null>(null);
  const [strategy, setStrategy] = useState<PackImportStrategy>("skip");
  const [busy, setBusy] = useState(false);

  const choosePack = async () => {
    setBusy(true);
    try {
      const result = await previewPack();
      if (result.canceled) return;
      setPreview(result);
    } catch (err) {
      toast({ variant: "destructive", title: "Preview failed", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const result = await applyPack({ tempPath: preview.tempPath, strategy });
      toast({
        title: "Pack imported",
        description: `${result.inserted} inserted, ${result.skipped} skipped, ${result.merged} merged.`,
      });
      onComplete();
      onOpenChange(false);
      setPreview(null);
    } catch (err) {
      toast({ variant: "destructive", title: "Import failed", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => {
      onOpenChange(next);
      if (!next) setPreview(null);
    }}>
      <DialogContent className="rounded-none sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>Import Reference Pack</DialogTitle>
          <DialogDescription>Preview a .preflowlib or .preflowpack before writing rows into the Library.</DialogDescription>
        </DialogHeader>
        {!preview ? (
          <div className="border border-border-subtle bg-surface-panel p-4 text-[12px] text-muted-foreground" style={{ borderRadius: 0 }}>
            Choose a pack file to inspect its manifest, duplicates, and missing files.
          </div>
        ) : (
          <div className="space-y-4 text-[12px]">
            <div className="grid grid-cols-3 gap-2">
              <div className="border border-border-subtle bg-surface-panel p-3" style={{ borderRadius: 0 }}>
                <div className="font-mono text-[9px] uppercase text-muted-foreground">Kind</div>
                <div className="mt-1 font-semibold">{preview.manifest.kind}</div>
              </div>
              <div className="border border-border-subtle bg-surface-panel p-3" style={{ borderRadius: 0 }}>
                <div className="font-mono text-[9px] uppercase text-muted-foreground">Items</div>
                <div className="mt-1 font-semibold">{preview.item_count}</div>
              </div>
              <div className="border border-border-subtle bg-surface-panel p-3" style={{ borderRadius: 0 }}>
                <div className="font-mono text-[9px] uppercase text-muted-foreground">Size</div>
                <div className="mt-1 font-semibold">{formatBytes(preview.total_size_bytes)}</div>
              </div>
            </div>
            <div className="border border-border-subtle bg-background p-3" style={{ borderRadius: 0 }}>
              <div className="font-mono text-[10px] uppercase text-muted-foreground">Kinds</div>
              <div className="mt-1 text-foreground">
                {Object.entries(preview.kind_distribution).map(([kind, count]) => `${kind}: ${count}`).join(" / ") || "None"}
              </div>
            </div>
            <div className="border border-border-subtle bg-background p-3" style={{ borderRadius: 0 }}>
              <div className="font-mono text-[10px] uppercase text-muted-foreground">Duplicates</div>
              <div className="mt-1 text-foreground">{preview.duplicates.length} existing source id match(es)</div>
            </div>
            {preview.missing_files.length > 0 ? (
              <div className="border border-amber-500/40 bg-amber-500/10 p-3 text-amber-600" style={{ borderRadius: 0 }}>
                {preview.missing_files.length} file entries are missing from this pack.
              </div>
            ) : null}
            <RadioGroup value={strategy} onValueChange={(value) => setStrategy(value as PackImportStrategy)}>
              {[
                ["skip", "Skip duplicates"],
                ["keepBoth", "Keep both"],
                ["mergeMetadata", "Merge metadata only"],
              ].map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-[12px]">
                  <RadioGroupItem value={value} />
                  {label}
                </label>
              ))}
            </RadioGroup>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" style={{ borderRadius: 0 }} onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="outline" style={{ borderRadius: 0 }} onClick={choosePack} disabled={busy}>
            {busy && !preview ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Choose Pack...
          </Button>
          <Button style={{ borderRadius: 0 }} onClick={runImport} disabled={busy || !preview}>
            {busy && preview ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
