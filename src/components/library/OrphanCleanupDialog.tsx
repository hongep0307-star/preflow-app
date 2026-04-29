import { useEffect, useState } from "react";
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
import { previewOrphanCleanup, runOrphanCleanup, type OrphanCleanupPreview } from "@/lib/storageMaintenance";

interface OrphanCleanupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (result: { filesDeleted: number; bytesFreed: number }) => void;
}

function formatBytes(value?: number | null): string {
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

export function OrphanCleanupDialog({ open, onOpenChange, onComplete }: OrphanCleanupDialogProps) {
  const [preview, setPreview] = useState<OrphanCleanupPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setError(null);
    setBusy(true);
    previewOrphanCleanup()
      .then(setPreview)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  }, [open]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await runOrphanCleanup();
      onComplete({ filesDeleted: result.filesDeleted, bytesFreed: result.bytesFreed });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-none sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>Orphan File Cleanup</DialogTitle>
          <DialogDescription>Review unreferenced files before deleting them from local storage.</DialogDescription>
        </DialogHeader>
        {busy && !preview ? (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Scanning storage...
          </div>
        ) : preview ? (
          <div className="space-y-3 text-[12px]">
            <div className="grid grid-cols-3 gap-2">
              <div className="border border-border-subtle bg-surface-panel p-3" style={{ borderRadius: 0 }}>
                <div className="font-mono text-[9px] uppercase text-muted-foreground">Orphans</div>
                <div className="mt-1 text-lg font-semibold">{preview.orphan_files}</div>
              </div>
              <div className="border border-border-subtle bg-surface-panel p-3" style={{ borderRadius: 0 }}>
                <div className="font-mono text-[9px] uppercase text-muted-foreground">Reclaim</div>
                <div className="mt-1 text-lg font-semibold">{formatBytes(preview.bytes_reclaimable)}</div>
              </div>
              <div className="border border-border-subtle bg-surface-panel p-3" style={{ borderRadius: 0 }}>
                <div className="font-mono text-[9px] uppercase text-muted-foreground">Recent skipped</div>
                <div className="mt-1 text-lg font-semibold">{preview.skipped_recent}</div>
              </div>
            </div>
            {preview.sample.length > 0 ? (
              <div className="max-h-44 overflow-y-auto border border-border-subtle bg-background p-2 font-mono text-[10px]" style={{ borderRadius: 0 }}>
                {preview.sample.map((file) => (
                  <div key={file.key} className="flex justify-between gap-3 border-b border-border-subtle/60 py-1 last:border-0">
                    <span className="truncate">{file.key}</span>
                    <span>{formatBytes(file.size)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="border border-border-subtle bg-surface-panel p-3 text-muted-foreground" style={{ borderRadius: 0 }}>
                No orphan files found.
              </div>
            )}
          </div>
        ) : null}
        {error ? <div className="text-[12px] text-destructive">{error}</div> : null}
        <DialogFooter>
          <Button variant="outline" style={{ borderRadius: 0 }} onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            style={{ borderRadius: 0 }}
            onClick={run}
            disabled={busy || !preview || preview.orphan_files === 0}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Delete Orphans
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
