import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { normalizeLibraryFolderPath } from "@/lib/folderCache";

interface FolderEditDialogProps {
  open: boolean;
  mode: "create" | "rename";
  parentPath?: string | null;
  initialPath?: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (path: string) => void;
}

export function FolderEditDialog({
  open,
  mode,
  parentPath,
  initialPath,
  onOpenChange,
  onSubmit,
}: FolderEditDialogProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (mode === "rename") {
      setValue(initialPath ?? "");
    } else {
      setValue("");
    }
    setError(null);
  }, [initialPath, mode, open]);

  const submit = () => {
    const raw = value.trim();
    if (raw.includes(":")) {
      setError("Folder names cannot include ':'.");
      return;
    }
    const normalized = normalizeLibraryFolderPath(mode === "create" && parentPath ? `${parentPath}/${raw}` : raw);
    if (!normalized) {
      setError("Enter a folder name.");
      return;
    }
    onSubmit(normalized);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-none sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{mode === "rename" ? "Rename Folder" : parentPath ? "Create Subfolder" : "Create Folder"}</DialogTitle>
          <DialogDescription>
            {mode === "rename"
              ? "Rename this folder and all nested folder tags."
              : parentPath
              ? `Create under ${parentPath}.`
              : "Create an empty Library folder."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            placeholder={mode === "rename" ? "Reference/Motion" : "Folder name"}
            className="h-9 text-[12px]"
          />
          {error ? <div className="text-[11px] text-destructive">{error}</div> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" style={{ borderRadius: 0 }} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button style={{ borderRadius: 0 }} onClick={submit}>
            {mode === "rename" ? "Rename" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
