import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { deleteStoredFiles } from "@/lib/storageUtils";
import { callClaude } from "@/lib/claude";
import { detectMediaType } from "@/lib/detectMediaType";
import { sanitizeImagePrompt } from "@/lib/conti";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Plus,
  Edit2,
  Trash2,
  Camera,
  Sparkles,
  X,
  Loader2,
  RefreshCw,
  Move,
  Wand2,
  Package,
  MapPin,
  User,
  Shirt,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

import { type Asset, type AssetType, type FocalPoint, type PhotoVariation, KR, KR_BG, KR_BORDER, TYPE_META } from "./assets/types";
import { fileToBase64, urlToBase64 } from "./assets/imageUtils";
import { callVisionAnalyze } from "./assets/vision";
import { AssetDetailModal } from "./assets/AssetDetailModal";
import { FocalEditor } from "./assets/FocalEditor";
import { SquareAvatar } from "./assets/SquareAvatar";
import { UploadZone } from "./assets/UploadZone";

interface Props {
  projectId: string;
  onSwitchToAgent?: () => void;
}

/* ????????????????????????????????????????
   Main Component
???????????????????????????????????????? */
export const AssetsTab = ({ projectId, onSwitchToAgent }: Props) => {
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [sceneCounts, setSceneCounts] = useState<Record<string, number>>({});
  const [activeType, setActiveType] = useState<AssetType>("character");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [focalPoints, setFocalPoints] = useState<Record<string, FocalPoint>>({});
  const [editingFocalId, setEditingFocalId] = useState<string | null>(null);

  const [assetType, setAssetType] = useState<AssetType>("character");
  const [tagName, setTagName] = useState("");
  const [sourceMode, setSourceMode] = useState<"upload" | "ai">("upload");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [aiInput, setAiInput] = useState("");
  const [aiDescription, setAiDescription] = useState("");
  const [outfitDescription, setOutfitDescription] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [spaceDescription, setSpaceDescription] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [generatedPortraitUrl, setGeneratedPortraitUrl] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const getFocal = (id: string): FocalPoint => focalPoints[id] ?? { x: 50, y: 25, scale: 1.4 };
  const saveFocal = async (id: string, p: FocalPoint) => {
    // Optimistic local update keeps the UI snappy; the DB write below is awaited
    // only to surface errors (swallowed previously by `.then(() => {})`, which
    // is why users reported the crop reverting to default on refresh).
    const next = { ...focalPoints, [id]: p };
    setFocalPoints(next);
    try {
      const { error } = await supabase.from("assets").update({ photo_crop: p as any }).eq("id", id);
      if (error) {
        console.error("[AssetsTab] saveFocal update failed:", error);
        toast({
          title: "Profile image adjustment was not saved",
          description: typeof error === "object" && error && "message" in error ? String((error as any).message) : String(error),
          variant: "destructive",
        });
      }
    } catch (e) {
      console.error("[AssetsTab] saveFocal threw:", e);
      toast({
        title: "Profile image adjustment was not saved",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  const fetchAssets = useCallback(async () => {
    const { data } = await supabase
      .from("assets")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    if (data) {
      setAssets((data as Asset[]).map((a) => ({ ...a, asset_type: a.asset_type ?? "character" })));
      const fp: Record<string, FocalPoint> = {};
      data.forEach((a: any) => {
        if (a.photo_crop && typeof a.photo_crop === "object") fp[a.id] = a.photo_crop as FocalPoint;
      });
      if (Object.keys(fp).length) setFocalPoints((prev) => ({ ...fp, ...prev }));
    }
  }, [projectId]);

  /* ??? ? ??? ? ?? ?? ?? + ?? ?? 1? ??? */
  const fetchSceneCounts = useCallback(async () => {
    // 1. ????? active_version_id ??
    const { data: projectData } = await supabase
      .from("projects")
      .select("active_version_id")
      .eq("id", projectId)
      .single();

    let rawScenes: Array<{ tagged_assets?: string[] }> = [];

    if (projectData?.active_version_id) {
      // 2. ?? ?? ????? scenes JSONB ??
      const { data: versionData } = await supabase
        .from("scene_versions")
        .select("scenes")
        .eq("id", projectData.active_version_id)
        .single();
      if (versionData?.scenes && Array.isArray(versionData.scenes)) {
        rawScenes = versionData.scenes as Array<{ tagged_assets?: string[] }>;
      }
    }

    // 3. ??: scenes ??? ?? ?? (?? ?? ??? ??? ?? ?)
    if (rawScenes.length === 0) {
      const { data: scenesData } = await supabase.from("scenes").select("tagged_assets").eq("project_id", projectId);
      rawScenes = scenesData ?? [];
    }

    // 4. ?? ?? ??? ? ? ?? ?? ??? ?? ? ??? 1? ??
    const counts: Record<string, number> = {};
    rawScenes.forEach((scene) => {
      const uniqueTags = new Set<string>(scene.tagged_assets ?? []);
      uniqueTags.forEach((tag) => {
        counts[tag] = (counts[tag] ?? 0) + 1;
      });
    });
    setSceneCounts(counts);
  }, [projectId]);

  useEffect(() => {
    fetchAssets();
    fetchSceneCounts();
  }, [fetchAssets, fetchSceneCounts, projectId]);

  // Live merge of background-variation work that happens out-of-band:
  //   - `preflow:asset-created` fires once per sibling spawned from the
  //     AssetDetailModal's "Generate Camera Framings" buttons (or from
  //     the legacy photo_variations migration). We append the new row
  //     to `assets` so it appears in the grid immediately and so the
  //     modal's sibling chip list reconciles without a refetch.
  //   - `preflow:asset-variations-updated` still fires during legacy
  //     migration to clear a parent's stale `photo_variations` array.
  //     We patch the in-memory cache so the migration banner stops
  //     retriggering.
  useEffect(() => {
    const onAssetCreated = (e: Event) => {
      const ce = e as CustomEvent<Asset>;
      const created = ce.detail;
      if (!created || !created.id) return;
      setAssets((prev) => (prev.some((a) => a.id === created.id) ? prev : [...prev, created]));
    };
    const onVariationsUpdated = (e: Event) => {
      const ce = e as CustomEvent<{ assetId: string; variations: PhotoVariation[] }>;
      const detail = ce.detail;
      if (!detail || !detail.assetId) return;
      setAssets((prev) =>
        prev.map((a) =>
          a.id === detail.assetId ? { ...a, photo_variations: detail.variations } : a,
        ),
      );
      setPreviewAsset((p) =>
        p && p.id === detail.assetId ? { ...p, photo_variations: detail.variations } : p,
      );
    };
    window.addEventListener("preflow:asset-created", onAssetCreated as EventListener);
    window.addEventListener(
      "preflow:asset-variations-updated",
      onVariationsUpdated as EventListener,
    );
    return () => {
      window.removeEventListener("preflow:asset-created", onAssetCreated as EventListener);
      window.removeEventListener(
        "preflow:asset-variations-updated",
        onVariationsUpdated as EventListener,
      );
    };
  }, []);

  const resetForm = () => {
    setTagName("");
    setSourceMode("upload");
    setPhotoFile(null);
    setPhotoPreview(null);
    setAiInput("");
    setAiDescription("");
    setOutfitDescription("");
    setRoleDescription("");
    setSpaceDescription("");
    setItemDescription("");
    setEditingAsset(null);
    setGeneratedPortraitUrl(null);
    setAssetType(activeType);
  };

  const openCreateModal = () => {
    resetForm();
    setAssetType(activeType);
    setModalOpen(true);
  };

  const openEditModal = (asset: Asset) => {
    setEditingAsset(asset);
    setAssetType(asset.asset_type ?? "character");
    setTagName(asset.tag_name);
    setSourceMode(asset.source_type === "ai" ? "ai" : "upload");
    setPhotoPreview(asset.photo_url);
    setAiDescription(asset.ai_description ?? "");
    setOutfitDescription(asset.outfit_description ?? "");
    setRoleDescription(asset.role_description ?? "");
    setSpaceDescription(asset.space_description ?? "");
    setItemDescription(asset.ai_description ?? "");
    setGeneratedPortraitUrl(asset.source_type === "ai" ? asset.photo_url : null);
    setModalOpen(true);
  };

  const handlePhotoFile = (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Max file size is 5MB", variant: "destructive" });
      return;
    }
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleAutoAnalyze = async (targetUrl: string, file?: File | null) => {
    setIsAnalyzing(true);
    try {
      let base64: string,
        mediaType = "image/jpeg";
      if (file) {
        base64 = await fileToBase64(file);
        mediaType = detectMediaType(base64);
      } else {
        const r = await urlToBase64(targetUrl);
        base64 = r.base64;
        mediaType = r.mediaType;
      }
      const result = await callVisionAnalyze(base64, mediaType, assetType);
      if (assetType === "character" && result.outfit) setOutfitDescription(result.outfit);
      if (assetType === "item" && result.description) setItemDescription(result.description);
      if (assetType === "background" && result.description) setSpaceDescription(result.description);
      if (!result.outfit && !result.description)
        toast({
          title: "No analysis result",
          description: "Could not extract info from image.",
          variant: "destructive",
        });
    } catch (e: any) {
      toast({ title: "Image analysis failed", description: e.message, variant: "destructive" });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGenerateAiDescription = async () => {
    if (!aiInput.trim()) return;
    setIsGenerating(true);
    try {
      const data = await callClaude({
        model: "claude-sonnet-4-20250514",
        max_tokens: 512,
        system: "??? ?? ?? ??? ?? ?? ??? ??????.",
        messages: [
          {
            role: "user",
            content: `?? ?? ??? ???? ?? ?? ?? ??? ??? ??? ??? ?? ??? ??? ??????.\n??(???, ???, ?????, ??? ??), ??, ???? ????? ?????. ??? ?? ???? ?????? ?????.\n??? ???? ?????:\n\n[??]: ${aiInput}`,
          },
        ],
      });
      setAiDescription(data.content[0].text);
    } catch (err: any) {
      toast({ title: "AI description failed", description: err.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGeneratePortrait = async () => {
    if (!aiDescription.trim()) return;
    setIsGeneratingImage(true);
    try {
      const fullDesc = [aiDescription, outfitDescription ? `Outfit: ${outfitDescription}` : ""]
        .filter(Boolean)
        .join("\n");
      const prompt =
        sanitizeImagePrompt(
          `Portrait photo of a person for commercial advertisement.\n${fullDesc}\n\nStyle: Professional casting photo, clean background, soft studio lighting, looking at camera, upper body shot. Photorealistic.\nNo text, no watermarks.`,
        ) + "\n\nSafe for all audiences.";
      const { data, error } = await supabase.functions.invoke("openai-image", {
        body: { prompt, projectId, sceneNumber: `asset-${tagName || "char"}-${Date.now()}`, imageSize: "1024x1024" },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error?.message ?? "Image generation failed");
      setGeneratedPortraitUrl(data.publicUrl);
    } catch (e: any) {
      toast({ title: "Image generation failed", description: e.message, variant: "destructive" });
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleSave = async () => {
    if (!tagName.trim()) return;
    setIsSaving(true);
    try {
      let photoUrl = editingAsset?.photo_url ?? null;
      if (photoFile && sourceMode === "upload") {
        const safeName = photoFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const fileName = `${projectId}/${Date.now()}-${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from("assets")
          .upload(fileName, photoFile, { contentType: photoFile.type, upsert: true });
        if (uploadError) throw uploadError;
        photoUrl = supabase.storage.from("assets").getPublicUrl(fileName).data.publicUrl;
      }
      if (sourceMode === "ai" && generatedPortraitUrl) photoUrl = generatedPortraitUrl;
      const record = {
        project_id: projectId,
        asset_type: assetType,
        tag_name: tagName.trim(),
        photo_url: photoUrl,
        source_type: assetType === "character" ? sourceMode : "upload",
        ai_description:
          assetType === "character"
            ? sourceMode === "ai"
              ? aiDescription
              : null
            : assetType === "item"
              ? itemDescription.trim() || null
              : null,
        outfit_description: assetType === "character" ? outfitDescription.trim() || null : null,
        role_description: assetType === "character" ? roleDescription.trim() || null : null,
        signature_items: null,
        space_description: assetType === "background" ? spaceDescription.trim() || null : null,
      };
      if (editingAsset) await supabase.from("assets").update(record).eq("id", editingAsset.id);
      else await supabase.from("assets").insert(record);
      setModalOpen(false);
      resetForm();
      await fetchAssets();
      toast({ title: editingAsset ? "Updated" : `${TYPE_META[assetType].label} registered` });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const handleDelete = async (id: string) => {
    const target = assets.find((a) => a.id === id);
    const urls: Array<string | null | undefined> = [];
    if (target) {
      urls.push(target.photo_url);
      if (Array.isArray(target.photo_variations)) {
        for (const v of target.photo_variations) urls.push(v?.url);
      }
    }
    await supabase.from("assets").delete().eq("id", id);
    await deleteStoredFiles(urls);
    await fetchAssets();
    toast({ title: "Deleted" });
    setDeleteTarget(null);
  };

  const filteredAssets = assets.filter((a) => (a.asset_type ?? "character") === activeType);
  const typeCounts = {
    character: assets.filter((a) => (a.asset_type ?? "character") === "character").length,
    item: assets.filter((a) => a.asset_type === "item").length,
    background: assets.filter((a) => a.asset_type === "background").length,
  };

  /* ?? ?? ?? ?? ?? */
  const renderActions = (asset: Asset) => (
    <div className="flex items-center justify-end gap-0.5 pt-1 border-t border-border">
      <button
        onClick={(e) => {
          e.stopPropagation();
          openEditModal(asset);
        }}
        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        style={{ borderRadius: 3 }}
      >
        <Edit2 className="w-3 h-3" />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setDeleteTarget(asset.id);
        }}
        className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        style={{ borderRadius: 3 }}
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );

  /* ?? ? ??? ?? ?? */
  const SceneCount = ({ tagName }: { tagName: string }) => {
    const count = sceneCounts[tagName] ?? 0;
    return (
      <span className="text-[10px] text-muted-foreground/40">
        {count} {count === 1 ? "Scene" : "Scenes"}
      </span>
    );
  };

  /* ?? ?? ?? ?? */
  const renderCard = (asset: Asset) => {
    /* ??? ? ?? ?? ?? ?? */
    if (asset.asset_type === "character" || !asset.asset_type)
      return (
        <div
          key={asset.id}
          className="border border-border bg-card overflow-hidden hover:border-primary/30 transition-all group cursor-pointer"
          style={{ borderRadius: 4 }}
          onClick={() => setPreviewAsset(asset)}
        >
          <div className="relative">
            <SquareAvatar url={asset.photo_url} focal={getFocal(asset.id)} name={asset.tag_name} />
            {/* ?? ?? ?? ? 6? ?? */}
            {asset.photo_url && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingFocalId(asset.id);
                }}
                className="absolute bottom-2 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md z-10"
                style={{ background: KR }}
                title="Adjust focal point"
              >
                <Move className="w-2.5 h-2.5 text-white" />
              </button>
            )}
          </div>
          <div className="px-3 pb-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold" style={{ color: KR }}>
                @{asset.tag_name}
              </span>
              <SceneCount tagName={asset.tag_name} />
            </div>
            {asset.role_description && (
              <div className="flex items-start gap-1.5">
                <User className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground leading-snug line-clamp-1">
                  {asset.role_description}
                </span>
              </div>
            )}
            {asset.outfit_description && (
              <div className="flex items-start gap-1.5">
                <Shirt className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
                  {asset.outfit_description}
                </span>
              </div>
            )}
            {!asset.role_description && !asset.outfit_description && (
              <p className="text-[11px] text-muted-foreground/30">No outfit info</p>
            )}
            {renderActions(asset)}
          </div>
        </div>
      );

    /* ??? */
    if (asset.asset_type === "item")
      return (
        <div
          key={asset.id}
          className="border border-border bg-card overflow-hidden hover:border-primary/30 transition-all group cursor-pointer"
          style={{ borderRadius: 4 }}
          onClick={() => setPreviewAsset(asset)}
        >
          <div className="relative aspect-video bg-background overflow-hidden">
            {asset.photo_url ? (
              <img src={asset.photo_url} className="w-full h-full object-cover" alt={asset.tag_name} loading="lazy" decoding="async" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <Package className="w-8 h-8 text-muted-foreground/20" />
              </div>
            )}
          </div>
          <div className="px-3 py-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold" style={{ color: KR }}>
                @{asset.tag_name}
              </span>
              <SceneCount tagName={asset.tag_name} />
            </div>
            {asset.ai_description ? (
              <p className="text-[11px] text-muted-foreground leading-snug line-clamp-1">{asset.ai_description}</p>
            ) : (
              <p className="text-[11px] text-muted-foreground/30">No description</p>
            )}
            {renderActions(asset)}
          </div>
        </div>
      );

    /* Background card */
    {
      // Count sibling background assets spawned off this one via the
      // "Generate Camera Framings" action. Matches `{parent}_{framing}`
      // and `{parent}_{framing}_<n>` against the framing vocabulary.
      const parentTag = asset.tag_name.replace(/^@/, "");
      const siblingPattern = new RegExp(
        `^${parentTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_(wide|medium|close|detail)(?:_\\d+)?$`,
      );
      const siblingCount = assets.reduce((n, a) => {
        if (a.id === asset.id) return n;
        if (a.asset_type !== "background") return n;
        return siblingPattern.test(a.tag_name.replace(/^@/, "")) ? n + 1 : n;
      }, 0);
      // Legacy photo_variations (migrated on next modal-open) still count
      // toward the badge so users aren't confused by an empty badge on
      // pre-migration projects.
      const legacyVariationCount = Array.isArray(asset.photo_variations)
        ? asset.photo_variations.length
        : 0;
      const variationCount = siblingCount + legacyVariationCount;
      return (
        <div
          key={asset.id}
          className="border border-border bg-card overflow-hidden hover:border-primary/30 transition-all group cursor-pointer"
          style={{ borderRadius: 4 }}
          onClick={() => setPreviewAsset(asset)}
        >
          <div className="relative aspect-video bg-background overflow-hidden">
            {asset.photo_url ? (
              <img src={asset.photo_url} className="w-full h-full object-cover" alt={asset.tag_name} loading="lazy" decoding="async" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <MapPin className="w-8 h-8 text-muted-foreground/20" />
              </div>
            )}
            {/* Camera framings indicator ? small overlay showing the
                number of sibling framing assets the user has generated
                off this parent. Visible at 0 too so users discover the
                feature; brightens once at least one exists. Clicking
                the card opens AssetDetailModal where they can generate
                more. Hidden entirely on siblings themselves (whose
                tag_name already matches the framing pattern) so we
                don't recursively label `@BG_wide` with its own badge. */}
            {asset.photo_url && !siblingPattern.test(parentTag) && (
              <div
                className="absolute top-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5"
                style={{
                  background: variationCount > 0 ? "rgba(0,0,0,0.65)" : "rgba(0,0,0,0.45)",
                  borderRadius: 2,
                  border: variationCount > 0 ? `1px solid ${KR_BORDER}` : "1px solid rgba(255,255,255,0.12)",
                }}
                title={
                  variationCount === 0
                    ? "Click to generate camera framings"
                    : `${variationCount} framing${variationCount === 1 ? "" : "s"} generated`
                }
              >
                <Camera
                  className="w-3 h-3"
                  style={{ color: variationCount > 0 ? "#fca5a5" : "rgba(255,255,255,0.55)" }}
                />
                <span
                  className="text-[9px] font-bold leading-none"
                  style={{ color: variationCount > 0 ? "#fca5a5" : "rgba(255,255,255,0.55)" }}
                >
                  {variationCount}
                </span>
              </div>
            )}
          </div>
        <div className="px-3 py-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold" style={{ color: KR }}>
              @{asset.tag_name}
            </span>
            <SceneCount tagName={asset.tag_name} />
          </div>
          {asset.space_description ? (
            <p className="text-[11px] text-muted-foreground leading-snug line-clamp-1">{asset.space_description}</p>
          ) : (
            <p className="text-[11px] text-muted-foreground/30">No description</p>
          )}
          {renderActions(asset)}
        </div>
      </div>
    );
    }
  };

  /* ????????????????????????????????????????
     JSX
  ???????????????????????????????????????? */
  return (
    <div className="h-full overflow-y-auto">
      {/* ?? ?? ?? */}
      <div className="flex items-center justify-between border-b border-white/[0.08] px-5 pt-4">
        {/* ?? ? */}
        <div className="flex items-stretch gap-0">
          {(["character", "item", "background"] as AssetType[]).map((t) => {
            const isActive = activeType === t;
            return (
              <button
                key={t}
                onClick={() => setActiveType(t)}
                className="flex items-center gap-1.5 px-4 py-2 text-[11px] font-medium tracking-wider transition-colors"
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: isActive ? KR : "rgba(255,255,255,0.3)",
                  boxShadow: isActive ? `inset 0 -2px 0 ${KR}` : "none",
                }}
              >
                {TYPE_META[t].icon}
                {TYPE_META[t].label}
                <span
                  className="font-mono text-[9px] px-1.5 py-0.5 ml-0.5"
                  style={{
                    borderRadius: 2,
                    background: isActive ? "rgba(249,66,58,0.15)" : "rgba(255,255,255,0.05)",
                    color: isActive ? KR : "rgba(255,255,255,0.3)",
                  }}
                >
                  {typeCounts[t]}
                </span>
              </button>
            );
          })}
        </div>
        {/* ?? ?? */}
        <div className="flex items-center gap-2 pb-2">
          <Button
            onClick={openCreateModal}
            className="gap-1.5 text-white text-[11px] font-medium tracking-wider h-8 px-3"
            style={{ background: filteredAssets.length === 0 ? "rgba(255,255,255,0.06)" : KR, color: filteredAssets.length === 0 ? "rgba(255,255,255,0.35)" : "#fff", borderRadius: 0 }}
          >
            <Plus className="w-3.5 h-3.5" />
            {TYPE_META[activeType].addLabel}
          </Button>
          {onSwitchToAgent && (() => {
            const hasAssets = assets.length > 0;
            return (
              <Button
                onClick={onSwitchToAgent}
                title={
                  hasAssets
                    ? undefined
                    : "?? ??? ???? ?? ??? ??? ? ???"
                }
                className="gap-1.5 text-[11px] font-medium tracking-wider border-none h-8 px-3"
                style={
                  hasAssets
                    ? { background: "rgba(249,66,58,0.1)", color: KR, borderRadius: 0 }
                    : {
                        background: "hsl(var(--muted))",
                        color: "hsl(var(--muted-foreground))",
                        borderRadius: 0,
                      }
                }
              >
                Go to Agents
                <ArrowRight className="w-3 h-3" />
              </Button>
            );
          })()}
        </div>
      </div>

      {/* ?? ??? ?? */}
      <div className="p-6">
        {filteredAssets.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[300px]">
            {TYPE_META[activeType].emptyIcon}
            <p className="text-[12px] font-bold tracking-wider text-muted-foreground/40 mt-2">
              No {activeType === "character" ? "Characters" : activeType === "item" ? "Items" : "Backgrounds"}
            </p>
            <p className="font-mono text-[10px] text-muted-foreground/25 mt-1 text-center max-w-[320px]">
              {TYPE_META[activeType].emptyText}
            </p>
            <Button
              onClick={openCreateModal}
              className="mt-4 gap-1.5 text-white text-[11px] font-medium tracking-wider h-8 px-3"
              style={{ background: KR, borderRadius: 0 }}
            >
              <Plus className="w-3.5 h-3.5" />
              {TYPE_META[activeType].addLabel}
            </Button>
          </div>
        ) : (
          <div className={`grid gap-3 ${isMobile ? "grid-cols-2" : TYPE_META[activeType].gridCols}`}>
            {filteredAssets.map(renderCard)}
          </div>
        )}
      </div>

      {/* ?? Focal editor ?? */}
      {editingFocalId &&
        (() => {
          const a = assets.find((x) => x.id === editingFocalId);
          if (!a?.photo_url) return null;
          return (
            <FocalEditor
              url={a.photo_url}
              initial={getFocal(editingFocalId)}
              onSave={(p) => saveFocal(editingFocalId, p)}
              onClose={() => setEditingFocalId(null)}
            />
          );
        })()}

      {/* Asset preview modal */}
      {previewAsset && (
        <AssetDetailModal
          asset={previewAsset}
          sceneCount={sceneCounts[previewAsset.tag_name] ?? 0}
          onClose={() => setPreviewAsset(null)}
          allAssets={assets}
          onAssetCreated={(newAsset) => {
            // Append the freshly inserted background asset so the grid
            // reflects it immediately without a full refetch round-trip.
            // (The `preflow:asset-created` broadcast handler also
            // dedupes by id, so callers that also dispatch the event
            // don't double-add.)
            setAssets((prev) =>
              prev.some((a) => a.id === newAsset.id)
                ? prev
                : [
                    ...prev,
                    { ...newAsset, asset_type: newAsset.asset_type ?? "background" },
                  ],
            );
            // Switch to the Background tab so the user sees the new tile
            // they just created (avoids the "did anything happen?" beat
            // when they were viewing a different asset type's modal).
            setActiveType("background");
          }}
          onSwitchAsset={(nextAsset) => {
            setPreviewAsset(nextAsset);
          }}
        />
      )}

      {/* ?? ??/?? ?? ?? */}
      <Dialog
        open={modalOpen}
        onOpenChange={(open) => {
          if (!open) {
            setModalOpen(false);
            resetForm();
          }
        }}
      >
        <DialogContent
          className="max-w-[520px] bg-card border-border max-h-[90vh] overflow-y-auto"
          style={{ borderRadius: 0 }}
        >
          <DialogHeader>
            <DialogTitle className="text-[15px] font-semibold text-foreground">
              {editingAsset ? "Edit Asset" : "New Asset"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            {!editingAsset && (
              <div>
                <label className="label-meta text-muted-foreground mb-1.5 block">Type</label>
                <div className="flex gap-2">
                  {(["character", "item", "background"] as AssetType[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setAssetType(t)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 border text-[11px] font-medium tracking-wider transition-colors"
                      style={{
                        borderRadius: 0,
                        borderColor: assetType === t ? KR : "rgba(255,255,255,0.07)",
                        background: assetType === t ? "rgba(249,66,58,0.08)" : "transparent",
                        color: assetType === t ? KR : "rgba(255,255,255,0.4)",
                      }}
                    >
                      {TYPE_META[t].icon}
                      {TYPE_META[t].label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className="label-meta text-muted-foreground mb-1.5 block">Tag Name</label>
              <div className="flex items-center">
                <span
                  className="h-10 px-3 flex items-center border border-r-0 border-input text-sm font-semibold"
                  style={{ background: KR_BG, color: KR, borderRadius: 0 }}
                >
                  @
                </span>
                <Input value={tagName} onChange={(e) => setTagName(e.target.value)} className="rounded-l-none" />
              </div>
              <p className="text-[11px] text-muted-foreground/60 mt-1">
                Tag as @{tagName || "name"} in chat and scene descriptions
              </p>
            </div>

            {assetType === "character" && (
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Visual Source</label>
                <div className="flex flex-col gap-2">
                  {[
                    {
                      mode: "upload" as const,
                      icon: <Camera className="w-4 h-4 shrink-0" />,
                      label: "Upload Photo",
                      sub: "Best for consistent portrayal",
                    },
                    {
                      mode: "ai" as const,
                      icon: <Sparkles className="w-4 h-4 shrink-0" />,
                      label: "AI Generated",
                      sub: "Create instantly",
                    },
                  ].map(({ mode, icon, label, sub }) => (
                    <button
                      key={mode}
                      onClick={() => setSourceMode(mode)}
                      className="flex items-center gap-2.5 px-3 h-10 border text-left transition-colors w-full"
                      style={{
                        borderRadius: 0,
                        borderColor: sourceMode === mode ? KR : "var(--border)",
                        background: sourceMode === mode ? KR_BG : "transparent",
                      }}
                    >
                      <span style={{ color: sourceMode === mode ? KR : "var(--muted-foreground)" }}>{icon}</span>
                      <span
                        className="text-[13px] font-medium"
                        style={{ color: sourceMode === mode ? KR : "var(--foreground)" }}
                      >
                        {label}
                      </span>
                      <span className="text-[11px] text-muted-foreground ml-auto hidden sm:block">{sub}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(assetType !== "character" || sourceMode === "upload") && (
              <div>
                {photoPreview ? (
                  <div className="space-y-2">
                    <div
                      className="relative w-full bg-[#f0f0f0] rounded-none overflow-hidden flex items-center justify-center"
                      style={{ maxHeight: 320 }}
                    >
                      <img
                        src={photoPreview}
                        className="max-w-full max-h-[320px] object-contain"
                        style={{ display: "block" }} loading="lazy" decoding="async" />
                      <button
                        onClick={() => {
                          setPhotoFile(null);
                          setPhotoPreview(null);
                        }}
                        className="absolute top-2 right-2 w-6 h-6 rounded-none bg-black/60 flex items-center justify-center hover:bg-black/80"
                      >
                        <X className="w-3 h-3 text-white" />
                      </button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAutoAnalyze(photoPreview, photoFile)}
                      disabled={isAnalyzing}
                      className="gap-1.5 w-full"
                    >
                      {isAnalyzing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Wand2 className="w-3.5 h-3.5" />
                      )}
                      {isAnalyzing
                        ? "Analyzing..."
                        : {
                            character: "Auto-analyze outfit from image",
                            item: "Auto-analyze item from image",
                            background: "Auto-analyze location from image",
                          }[assetType]}
                    </Button>
                  </div>
                ) : (
                  <UploadZone assetType={assetType} onFile={handlePhotoFile} />
                )}
              </div>
            )}

            {assetType === "character" && sourceMode === "ai" && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Description Input</label>
                  <Textarea
                    value={aiInput}
                    onChange={(e) => setAiInput(e.target.value)}
                    placeholder="Describe the character's appearance"
                    rows={3}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateAiDescription}
                  disabled={!aiInput.trim() || isGenerating}
                  className="gap-1.5"
                >
                  <Sparkles className="w-4 h-4" />
                  {isGenerating ? "Generating AI description..." : "Generate AI Description"}
                </Button>
                {aiDescription && (
                  <>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1.5 block">
                        Appearance Description (English, editable)
                      </label>
                      <Textarea
                        value={aiDescription}
                        onChange={(e) => setAiDescription(e.target.value)}
                        rows={4}
                        className="text-xs"
                      />
                    </div>
                    <div className="border-t border-border pt-3">
                      <div className="flex items-center gap-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleGeneratePortrait}
                          disabled={isGeneratingImage || !aiDescription.trim()}
                          className="gap-1.5"
                        >
                          {isGeneratingImage ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Sparkles className="w-4 h-4" />
                          )}
                          {isGeneratingImage ? "Generating image..." : "Generate Character Image"}
                        </Button>
                        {generatedPortraitUrl && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleGeneratePortrait}
                            disabled={isGeneratingImage}
                            className="gap-1 text-xs"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            Regenerate
                          </Button>
                        )}
                      </div>
                      {generatedPortraitUrl && (
                        <div className="mt-3 space-y-2">
                          <div
                            className="relative w-full bg-[#f0f0f0] rounded-lg overflow-hidden flex items-center justify-center"
                            style={{ maxHeight: 280 }}
                          >
                            <img src={generatedPortraitUrl} className="max-w-full max-h-[280px] object-contain" loading="lazy" decoding="async" />
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleAutoAnalyze(generatedPortraitUrl)}
                            disabled={isAnalyzing}
                            className="gap-1.5 w-full"
                          >
                            {isAnalyzing ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Wand2 className="w-3.5 h-3.5" />
                            )}
                            {isAnalyzing ? "Analyzing outfit..." : "Auto-analyze outfit from image"}
                          </Button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="border-t border-border pt-4 space-y-3">
              {assetType === "character" && (
                <>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1.5">
                      <User className="w-3 h-3" /> Role / Relationship{" "}
                      <span className="text-muted-foreground/40">(optional)</span>
                    </label>
                    <Input
                      value={roleDescription}
                      onChange={(e) => setRoleDescription(e.target.value)}
                      placeholder="Character's role and personality"
                    />
                    <p className="text-[11px] text-muted-foreground/50 mt-1">
                      Used as character relationship context when composing stories with the agent
                    </p>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1.5">
                      <Shirt className="w-3 h-3" /> Outfit / Style{" "}
                      <span className="text-muted-foreground/40">(optional)</span>
                    </label>
                    <Input
                      value={outfitDescription}
                      onChange={(e) => setOutfitDescription(e.target.value)}
                      placeholder="Outfit and styling details"
                    />
                  </div>
                </>
              )}
              {assetType === "item" && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1.5">
                    <Package className="w-3 h-3" /> Item Detail{" "}
                    <span className="text-muted-foreground/40">(optional ? auto-analyzable)</span>
                  </label>
                  <Textarea
                    value={itemDescription}
                    onChange={(e) => setItemDescription(e.target.value)}
                    rows={3}
                    placeholder="Describe the item in detail"
                  />
                </div>
              )}
              {assetType === "background" && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1.5">
                    <MapPin className="w-3 h-3" /> Location Description{" "}
                    <span className="text-muted-foreground/40">(optional ? auto-analyzable)</span>
                  </label>
                  <Textarea
                    value={spaceDescription}
                    onChange={(e) => setSpaceDescription(e.target.value)}
                    rows={3}
                    placeholder="Describe the location and atmosphere"
                  />
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              className="text-[13px] h-9"
              onClick={() => {
                setModalOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!tagName.trim() || isSaving}
              className="text-white text-[13px] h-9"
              style={{ background: KR }}
            >
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ?? ?? ?? ?? */}
      {deleteTarget && (
        <Dialog open onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <DialogContent className="max-w-[360px] bg-card border-border" style={{ borderRadius: 0 }}>
            <DialogHeader>
              <DialogTitle className="text-[15px] font-semibold">Delete Asset</DialogTitle>
            </DialogHeader>
            <p className="text-[13px] text-muted-foreground">
              Are you sure you want to delete this asset? This action cannot be undone.
            </p>
            <DialogFooter className="gap-2">
              <Button variant="ghost" className="text-[13px] h-9" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button
                className="text-white text-[13px] h-9"
                style={{ background: "#dc2626" }}
                onClick={() => handleDelete(deleteTarget)}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
