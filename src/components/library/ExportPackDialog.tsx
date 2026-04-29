import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { exportPack } from "@/lib/preflowPackClient";
import type { PackScope } from "@/lib/preflowPack";
import { useToast } from "@/hooks/use-toast";

interface ExportPackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: PackScope;
  scopeLabel: string;
  ids?: string[];
  folderTag?: string;
  projectId?: string | null;
  itemCount: number;
}

export function ExportPackDialog({
  open,
  onOpenChange,
  scope,
  scopeLabel,
  ids,
  folderTag,
  projectId,
  itemCount,
}: ExportPackDialogProps) {
  const { toast } = useToast();
  const [includeFiles, setIncludeFiles] = useState(true);
  const [includeSubfolders, setIncludeSubfolders] = useState(true);
  const [packName, setPackName] = useState(scopeLabel);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setIncludeFiles(true);
      setIncludeSubfolders(true);
      setPackName(scopeLabel);
    }
  }, [open, scopeLabel]);

  const runExport = async () => {
    setBusy(true);
    try {
      const result = await exportPack({
        scope,
        ids,
        folderTag,
        projectId,
        includeFiles,
        includeSubfolders,
        suggestedName: packName,
      });
      if (result.canceled) return;
      toast({
        title: "Pack exported",
        description: `${result.item_count} references saved${result.saved_path ? ` to ${result.saved_path}` : ""}.`,
      });
      if (result.skipped.length > 0) {
        toast({ title: "Some files were skipped", description: `${result.skipped.length} missing file(s) were reported.` });
      }
      onOpenChange(false);
    } catch (err) {
      toast({ variant: "destructive", title: "Export failed", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-none sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Export Reference Pack</DialogTitle>
          <DialogDescription>
            {itemCount.toLocaleString()} reference{itemCount === 1 ? "" : "s"} from {scopeLabel}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-[11px] font-mono text-muted-foreground">Pack name</label>
            <Input value={packName} onChange={(event) => setPackName(event.target.value)} className="h-9 text-[12px]" />
          </div>
          <label className="flex items-center gap-2 text-[12px]">
            <Checkbox checked={includeFiles} onCheckedChange={(checked) => setIncludeFiles(checked === true)} />
            Include original files
          </label>
          {scope === "folder" ? (
            <label className="flex items-center gap-2 text-[12px]">
              <Checkbox checked={includeSubfolders} onCheckedChange={(checked) => setIncludeSubfolders(checked === true)} />
              Include subfolders
            </label>
          ) : null}
          {!includeFiles ? (
            <div className="border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-600" style={{ borderRadius: 0 }}>
              Metadata-only packs preserve tags, notes, and links but do not copy local media files.
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" style={{ borderRadius: 0 }} onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button style={{ borderRadius: 0 }} onClick={runExport} disabled={busy || itemCount === 0}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save...
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
