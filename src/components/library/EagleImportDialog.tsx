import { Library, Loader2 } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EagleImportResult, EaglePreview } from "@/lib/eagleImport";

interface EagleImportDialogProps {
  open: boolean;
  busy: boolean;
  root: string;
  preview: EaglePreview | null;
  result: EagleImportResult | null;
  onOpenChange: (open: boolean) => void;
  onSelectLibrary: () => void;
  onRunImport: () => void;
}

export function EagleImportDialog({
  open,
  busy,
  root,
  preview,
  result,
  onOpenChange,
  onSelectLibrary,
  onRunImport,
}: EagleImportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-none">
        <DialogHeader>
          <DialogTitle>Import Eagle Library</DialogTitle>
          <DialogDescription>
            Preview an Eagle library folder, then import references into Pre-Flow.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Button
            variant="outline"
            className="h-9 w-full gap-2 text-[12px]"
            style={{ borderRadius: 0 }}
            onClick={onSelectLibrary}
            disabled={busy}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Library className="h-3.5 w-3.5" />}
            Choose Eagle Library Folder
          </Button>

          {preview ? (
            <Alert className="rounded-none border-border-subtle bg-surface-panel">
              <AlertTitle className="text-[12px]">{preview.libraryName}</AlertTitle>
              <AlertDescription className="mt-2 space-y-2 text-[11px]">
                <div className="break-all text-muted-foreground">{root}</div>
                <div className="grid grid-cols-2 gap-1 font-mono">
                  <span>{preview.totalItems} items</span>
                  <span>{Math.round(preview.totalBytes / 1024 / 1024)} MB</span>
                  <span>{preview.folders} folders</span>
                  <span>{preview.smartFolders} filters</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(preview.kinds).map(([kind, count]) => (
                    <Badge key={kind} variant="outline" className="text-[9px]">
                      {kind}: {count}
                    </Badge>
                  ))}
                </div>
                {preview.missingFiles.length > 0 ? (
                  <div className="text-amber-500">
                    {preview.missingFiles.length} missing files will be skipped or metadata-only.
                  </div>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          {result ? (
            <div className="border border-border-subtle bg-surface-panel p-3 text-[11px] text-muted-foreground" style={{ borderRadius: 0 }}>
              <div className="font-semibold text-foreground">Last import</div>
              <div>{result.imported} imported / {result.skipped} skipped / {result.metadataOnly} metadata-only</div>
              {result.skipped > 0 ? (
                <div>Skipped items already exist in this Library. Re-import is skip-only for now.</div>
              ) : null}
              {result.missingFiles.length > 0 ? (
                <div className="text-amber-500">{result.missingFiles.length} missing original files were reported in preview.</div>
              ) : null}
              {result.failed.length > 0 ? <div className="text-destructive">{result.failed.length} failed</div> : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" style={{ borderRadius: 0 }} onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" style={{ borderRadius: 0 }} onClick={onRunImport} disabled={busy || !root}>
            {busy ? "Importing..." : "Run Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
