import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  promoteReferenceToAsset,
  type PromoteAssetType,
  type ReferenceItem,
} from "@/lib/referenceLibrary";

const ASSET_TYPES: Array<{ id: PromoteAssetType; label: string; hint: string }> = [
  { id: "character", label: "Character", hint: "Cast member, narrator, on-camera persona" },
  { id: "background", label: "Background", hint: "Location, set, environment" },
  { id: "item", label: "Item / Prop", hint: "Object, brand product, signature prop" },
];

interface PromoteToAssetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reference: ReferenceItem | null;
  /** 어느 프로젝트의 자산으로 만들지. Library 페이지에서 returnTo 가 project URL
   *  이어야만 활성화되므로, null 일 때는 진입 자체가 막혀있다 — 이중 안전장치. */
  projectId: string | null;
  onCompleted?: (result: { assetId: string; reference: ReferenceItem }) => void;
}

export function PromoteToAssetDialog({
  open,
  onOpenChange,
  reference,
  projectId,
  onCompleted,
}: PromoteToAssetDialogProps) {
  const [assetType, setAssetType] = useState<PromoteAssetType>("character");
  const [tagName, setTagName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Library 에서 다른 reference 를 선택해 다이얼로그를 다시 열 때, 직전 입력이
  // 그대로 남아 있으면 사용자에게 혼란. 매번 reference 가 바뀔 때마다 폼을
  // 새 자료의 이름/AI 제안 기반으로 초기화.
  useEffect(() => {
    if (!open || !reference) return;
    setError(null);
    const fromAi = (reference.ai_suggestions as { asset_candidate?: string } | null | undefined)?.asset_candidate;
    setTagName((fromAi?.trim() || reference.title.trim() || "asset").replace(/^@/, ""));
    setDescription(reference.notes ?? "");
    setAssetType("character");
  }, [open, reference]);

  if (!reference) return null;

  const promotable = reference.kind === "image" || reference.kind === "webp" || reference.kind === "gif";
  const blockedReason = !promotable
    ? "Promote to Asset currently supports image / webp / gif references only."
    : !reference.file_url
      ? "This reference has no stored file."
      : !projectId
        ? "Open the Library from a project to promote a reference."
        : null;

  const handleConfirm = async () => {
    if (!reference || !projectId) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await promoteReferenceToAsset({
        reference,
        projectId,
        assetType,
        tagName,
        description,
      });
      onCompleted?.(result);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-none border-border-subtle bg-background">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Promote to Asset</DialogTitle>
          <DialogDescription className="text-[12px] text-muted-foreground">
            Create a new project asset that references this Library item. The Library entry stays intact —
            only a link in <span className="font-mono">promoted_asset_ids</span> is added.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[120px_minmax(0,1fr)] items-start gap-4">
          <div className="aspect-square overflow-hidden border border-border-subtle bg-muted/30" style={{ borderRadius: 0 }}>
            {reference.thumbnail_url || reference.file_url ? (
              <img
                src={reference.thumbnail_url || reference.file_url || ""}
                alt={reference.title}
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="rounded-none text-[10px] uppercase">{reference.kind}</Badge>
              {(reference.ai_suggestions as { asset_candidate?: string } | null | undefined)?.asset_candidate ? (
                <Badge variant="secondary" className="rounded-none text-[10px]">
                  <Sparkles className="mr-1 h-3 w-3" />
                  AI suggested
                </Badge>
              ) : null}
            </div>
            <div className="line-clamp-2 text-[13px] font-semibold">{reference.title}</div>
            {reference.notes ? (
              <div className="line-clamp-2 text-[11px] text-muted-foreground">{reference.notes}</div>
            ) : null}
          </div>
        </div>

        {blockedReason ? (
          <div className="border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] text-amber-500" style={{ borderRadius: 0 }}>
            {blockedReason}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label className="mb-2 block text-[10px] font-mono tracking-[0.12em] text-muted-foreground">ASSET TYPE</Label>
              <div className="grid grid-cols-3 gap-2">
                {ASSET_TYPES.map((option) => {
                  const active = option.id === assetType;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setAssetType(option.id)}
                      className={cn(
                        "flex flex-col items-start gap-1 border bg-surface-panel px-3 py-2 text-left transition",
                        active ? "border-primary/80 shadow-[0_0_0_1px_hsl(var(--primary)/0.35)]" : "border-border-subtle hover:border-primary/40",
                      )}
                      style={{ borderRadius: 0 }}
                    >
                      <span className="text-[12px] font-semibold">{option.label}</span>
                      <span className="text-[10px] leading-snug text-muted-foreground">{option.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label htmlFor="promote-tag-name" className="mb-1.5 block text-[10px] font-mono tracking-[0.12em] text-muted-foreground">
                ASSET TAG NAME
              </Label>
              <Input
                id="promote-tag-name"
                value={tagName}
                onChange={(event) => setTagName(event.target.value)}
                className="h-8 rounded-none text-[12px]"
                placeholder="e.g. hero, kitchen, brand_logo"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                The leading <span className="font-mono">@</span> is implicit — scenes will mention this asset as <span className="font-mono">@{tagName.trim() || "name"}</span>.
              </p>
            </div>

            <div>
              <Label htmlFor="promote-description" className="mb-1.5 block text-[10px] font-mono tracking-[0.12em] text-muted-foreground">
                {assetType === "background" ? "SPACE DESCRIPTION" : assetType === "item" ? "ITEM DESCRIPTION" : "NOTES (optional)"}
              </Label>
              <Textarea
                id="promote-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={assetType === "background" ? "Where this place is, key surfaces, lighting feel" : assetType === "item" ? "Material, scale, signature detail" : "Anything that helps the assistant tag scenes"}
                className="min-h-[80px] rounded-none text-[12px]"
              />
            </div>

            {error ? (
              <div className="border border-destructive/40 bg-destructive/10 p-3 text-[12px] text-destructive" style={{ borderRadius: 0 }}>
                {error}
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" className="h-8 rounded-none text-[11px]" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            className="h-8 gap-1.5 rounded-none text-[11px]"
            onClick={handleConfirm}
            disabled={submitting || Boolean(blockedReason) || !tagName.trim()}
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Create asset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
