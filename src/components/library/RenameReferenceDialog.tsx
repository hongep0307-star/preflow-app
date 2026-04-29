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
import type { ReferenceItem } from "@/lib/referenceLibrary";

interface RenameReferenceDialogProps {
  open: boolean;
  reference: ReferenceItem | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (title: string) => void;
}

export function RenameReferenceDialog({ open, reference, onOpenChange, onSubmit }: RenameReferenceDialogProps) {
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (open) setTitle(reference?.title ?? "");
  }, [open, reference]);

  const submit = () => {
    const next = title.trim();
    if (!next) return;
    onSubmit(next);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-none sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Rename Reference</DialogTitle>
          <DialogDescription>Update the display title for this Library item.</DialogDescription>
        </DialogHeader>
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          className="h-9 text-[12px]"
        />
        <DialogFooter>
          <Button variant="outline" style={{ borderRadius: 0 }} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button style={{ borderRadius: 0 }} disabled={!title.trim()} onClick={submit}>
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
