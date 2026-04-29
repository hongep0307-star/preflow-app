import { Clipboard, Library, Link2, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface LibraryAddMenuProps {
  eagleBusy: boolean;
  onChooseFiles: () => void;
  onPasteUrl: () => void;
  onImportEagle: () => void;
}

export function LibraryAddMenu({
  eagleBusy,
  onChooseFiles,
  onPasteUrl,
  onImportEagle,
}: LibraryAddMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="h-9 w-full gap-2 text-[12px]" style={{ borderRadius: 0 }}>
          <Upload className="h-4 w-4" />
          Add
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 rounded-none">
        <DropdownMenuItem onSelect={onChooseFiles}>
          <Upload className="mr-2 h-3.5 w-3.5" />
          Choose Files
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onPasteUrl}>
          <Link2 className="mr-2 h-3.5 w-3.5" />
          Paste URL
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onImportEagle} disabled={eagleBusy}>
          {eagleBusy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Library className="mr-2 h-3.5 w-3.5" />}
          Import Eagle Library
        </DropdownMenuItem>
        <div className="border-t border-border-subtle px-2 py-2 text-[10px] leading-relaxed text-muted-foreground">
          <Clipboard className="mr-1 inline h-3 w-3" />
          Files can also be dropped anywhere or pasted from the clipboard.
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
