import { useEffect, useState } from "react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface FolderDeleteDialogProps {
  open: boolean;
  folderPath: string | null;
  affectedCount: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: (opts: { mode: "removeTagOnly" | "trashItems"; recursive: boolean }) => void;
}

export function FolderDeleteDialog({ open, folderPath, affectedCount, onOpenChange, onConfirm }: FolderDeleteDialogProps) {
  const [mode, setMode] = useState<"removeTagOnly" | "trashItems">("removeTagOnly");
  const [recursive, setRecursive] = useState(true);

  useEffect(() => {
    if (!open) return;
    setMode("removeTagOnly");
    setRecursive(true);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-none sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Delete Folder</DialogTitle>
          <DialogDescription>
            {folderPath ? `Choose how to remove "${folderPath}".` : "Choose how to remove this folder."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-[12px]">
          <div className="border border-border-subtle bg-surface-panel p-3" style={{ borderRadius: 0 }}>
            {affectedCount} reference{affectedCount === 1 ? "" : "s"} currently match this folder.
          </div>
          <RadioGroup value={mode} onValueChange={(value) => setMode(value as "removeTagOnly" | "trashItems")}>
            <label className="flex items-center gap-2">
              <RadioGroupItem value="removeTagOnly" />
              Remove folder tag only
            </label>
            <label className="flex items-center gap-2">
              <RadioGroupItem value="trashItems" />
              Move matching references to Trash
            </label>
          </RadioGroup>
          <label className="flex items-center gap-2">
            <Checkbox checked={recursive} onCheckedChange={(checked) => setRecursive(checked === true)} />
            Include subfolders
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" style={{ borderRadius: 0 }} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={mode === "trashItems" ? "destructive" : "default"}
            style={{ borderRadius: 0 }}
            onClick={() => {
              onConfirm({ mode, recursive });
              onOpenChange(false);
            }}
          >
            Delete Folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
