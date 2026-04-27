import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  ZoomIn,
  ZoomOut,
  Package,
  MapPin,
  Users,
  User,
  Shirt,
  Camera,
  Loader2,
  AlertCircle,
  Plus,
  ArrowRight,
} from "lucide-react";
import { type Asset, KR, KR_BORDER } from "./types";
import {
  BACKGROUND_FRAMINGS,
  BACKGROUND_FRAMINGS_BY_ID,
} from "@/lib/backgroundVariations";
import {
  type BgVarSnapshot,
  startBgVarGenerate,
  subscribeBgVar,
  migrateLegacyVariations,
} from "@/lib/bgVariationStore";
import { useToast } from "@/hooks/use-toast";
import { HelpTooltip } from "@/components/common/ui-primitives";
import { useT } from "@/lib/uiLanguage";

interface Props {
  asset: Asset;
  sceneCount: number;
  onClose: () => void;
  /** Notify parent that a brand-new background asset was created from a
   *  framing generation. Parent should append it to its in-memory asset
   *  list so subsequent lookups (sibling chips, scene @-mention resolution)
   *  see it immediately. */
  onAssetCreated?: (newAsset: Asset) => void;
  /** Switch the modal to view a different asset. Used when the user
   *  clicks a sibling chip in the framings panel. Parent owns the
   *  `previewAsset` state, so it does the swap. */
  onSwitchAsset?: (nextAsset: Asset) => void;
  /** The project's full asset list — used to render existing sibling
   *  chips ("already generated: @BG_wide, @BG_wide_2 ...") so the user
   *  can tell at a glance how many framings they've already made
   *  without scanning the Assets grid. */
  allAssets?: Asset[];
}

export const AssetDetailModal = ({
  asset,
  sceneCount,
  onClose,
  onAssetCreated,
  onSwitchAsset,
  allAssets,
}: Props) => {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const { toast } = useToast();
  const t = useT();

  // Subscribe to the module-singleton bgVariationStore so in-flight
  // counts and errors survive modal close/reopen cycles.
  const [snapshot, setSnapshot] = useState<BgVarSnapshot>(() => ({
    inFlight: {},
    errors: {},
  }));
  useEffect(() => {
    const unsub = subscribeBgVar(asset.id, setSnapshot);
    return unsub;
  }, [asset.id]);
  const { inFlight, errors } = snapshot;
  // Surface persistent generation errors to the user via toast — but
  // only on transition to error (not every snapshot fan-out).
  const lastErrorsRef = useRef<BgVarSnapshot["errors"]>({});
  useEffect(() => {
    const prev = lastErrorsRef.current;
    for (const [framing, msg] of Object.entries(errors)) {
      if (msg && prev[framing as keyof BgVarSnapshot["errors"]] !== msg) {
        toast({
          title: t("assets.framingFailed", { framing }),
          description: msg,
          variant: "destructive",
        });
      }
    }
    lastErrorsRef.current = errors;
  }, [errors, t, toast]);

  const effectivePrimaryUrl = asset.photo_url;

  /* Siblings = every existing asset whose tag_name looks like
   * `{parent}_{framing}` or `{parent}_{framing}_{n}`. These are the
   * framings the user has already generated off this parent. We render
   * them as chips so the user sees at a glance what they've already
   * made, and can hop to any of them without closing the modal. */
  const siblings = useMemo(() => {
    if (!allAssets || asset.asset_type !== "background") return [];
    const parentTag = asset.tag_name.replace(/^@/, "");
    const framingIds = BACKGROUND_FRAMINGS.map((f) => f.id);
    // Match `{parent}_{framing}` optionally followed by `_<number>`.
    const patterns = framingIds.map(
      (f) => new RegExp(`^${escapeRegExp(parentTag)}_${f}(?:_(\\d+))?$`),
    );
    const out: Array<{ asset: Asset; framing: string; n: number }> = [];
    for (const a of allAssets) {
      if (a.id === asset.id) continue;
      if (a.asset_type !== "background") continue;
      const tag = a.tag_name.replace(/^@/, "");
      for (let i = 0; i < patterns.length; i++) {
        const m = tag.match(patterns[i]);
        if (m) {
          out.push({
            asset: a,
            framing: framingIds[i],
            n: m[1] ? parseInt(m[1], 10) : 1,
          });
          break;
        }
      }
    }
    // Sort by framing order, then by numeric suffix.
    const orderIndex = new Map<string, number>(framingIds.map((f, i) => [f, i] as const));
    out.sort((a, b) => {
      const ai = orderIndex.get(a.framing) ?? 99;
      const bi = orderIndex.get(b.framing) ?? 99;
      if (ai !== bi) return ai - bi;
      return a.n - b.n;
    });
    return out;
  }, [allAssets, asset.id, asset.tag_name, asset.asset_type]);

  /* Legacy data migration: if this background asset still carries
   * `photo_variations` entries from the pre-sibling-asset era, convert
   * each to a standalone sibling (with vision analysis) and clear the
   * array. Runs once per asset-id per mount, gated by a ref so re-renders
   * don't re-trigger it mid-flight. Silent on empty arrays. */
  const migratingRef = useRef<string | null>(null);
  const [isMigrating, setIsMigrating] = useState(false);
  useEffect(() => {
    const legacy = Array.isArray(asset.photo_variations) ? asset.photo_variations : [];
    if (legacy.length === 0) return;
    if (asset.asset_type !== "background") return;
    if (migratingRef.current === asset.id) return;
    migratingRef.current = asset.id;
    setIsMigrating(true);
    (async () => {
      try {
        const created = await migrateLegacyVariations(
          {
            id: asset.id,
            project_id: asset.project_id,
            tag_name: asset.tag_name,
            photo_url: asset.photo_url,
            space_description: asset.space_description,
          },
          legacy,
        );
        for (const row of created) {
          onAssetCreated?.(row as unknown as Asset);
        }
        if (created.length > 0) {
          toast({
            title: t("assets.cameraFramingsUpgraded"),
            description: t("assets.cameraFramingsUpgradedDesc", { count: created.length }),
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast({
          title: t("assets.variationMigrationFailed"),
          description: msg,
          variant: "destructive",
        });
      } finally {
        setIsMigrating(false);
      }
    })();
  }, [
    asset.id,
    asset.photo_variations,
    asset.project_id,
    asset.tag_name,
    asset.photo_url,
    asset.space_description,
    asset.asset_type,
    onAssetCreated,
    t,
    toast,
  ]);

  const generateOne = async (framing: (typeof BACKGROUND_FRAMINGS)[number]["id"]) => {
    if (!asset.photo_url) {
      toast({
        title: t("assets.noSourceImage"),
        description: t("assets.noSourceImageDesc"),
        variant: "destructive",
      });
      return;
    }
    const created = await startBgVarGenerate(
      {
        id: asset.id,
        project_id: asset.project_id,
        tag_name: asset.tag_name,
        photo_url: asset.photo_url,
        space_description: asset.space_description,
      },
      framing,
    );
    if (created) {
      onAssetCreated?.(created as unknown as Asset);
      toast({
        title: t("assets.framingCreated"),
        description: t("assets.framingCreatedDesc", { tag: created.tag_name }),
      });
    }
  };

  const generateAll = () => {
    if (!asset.photo_url) {
      toast({
        title: t("assets.noSourceImage"),
        description: t("assets.noSourceImageDesc"),
        variant: "destructive",
      });
      return;
    }
    for (const f of BACKGROUND_FRAMINGS) void generateOne(f.id);
  };

  const zoom = (delta: number) => {
    setScale((p) => {
      const next = Math.max(0.5, Math.min(5, p + delta));
      if (next <= 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setOffset((p) => ({ x: p.x + dx, y: p.y + dy }));
  };
  const onMouseUp = () => {
    dragging.current = false;
  };

  const isChar = !asset.asset_type || asset.asset_type === "character";
  const isBackground = asset.asset_type === "background";
  const imgPanelW = isBackground ? 580 : asset.asset_type === "item" ? 500 : 360;

  const totalInFlight = Object.values(inFlight).reduce((n, v) => n + (v ?? 0), 0);
  const isAnyGenerating = totalInFlight > 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.90)" }}
      onClick={onClose}
    >
      <div
        className="relative flex overflow-hidden shadow-2xl border border-border"
        style={{ borderRadius: 4, maxWidth: "95vw", maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative bg-[#0d0d0d] flex flex-col" style={{ width: imgPanelW, minWidth: 240 }}>
          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-10">
            <button
              onClick={() => zoom(-0.25)}
              className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors"
            >
              <ZoomOut className="w-3.5 h-3.5 text-white" />
            </button>
            <span className="text-white text-[10px] font-medium w-10 text-center">{Math.round(scale * 100)}%</span>
            <button
              onClick={() => zoom(0.25)}
              className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors"
            >
              <ZoomIn className="w-3.5 h-3.5 text-white" />
            </button>
            <button
              onClick={() => {
                setScale(1);
                setOffset({ x: 0, y: 0 });
              }}
              className="px-2 h-7 rounded-full bg-white/15 hover:bg-white/25 text-white text-[10px] transition-colors"
            >
              1:1
            </button>
          </div>

          <div
            className="flex-1 flex items-center justify-center overflow-hidden"
            style={{ minHeight: isChar ? 380 : 280, maxHeight: "70vh" }}
            onWheel={(e) => {
              e.preventDefault();
              zoom(-e.deltaY * 0.001);
            }}
          >
            {effectivePrimaryUrl ? (
              <img
                src={effectivePrimaryUrl}
                alt={asset.tag_name}
                draggable={false}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
                style={{
                  transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                  transition: dragging.current ? "none" : "transform 0.15s ease",
                  cursor: scale > 1 ? (dragging.current ? "grabbing" : "grab") : "default",
                  userSelect: "none",
                  maxWidth: "100%",
                  maxHeight: "62vh",
                  objectFit: "contain",
                }}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div className="flex items-center justify-center w-full h-full opacity-10">
                {asset.asset_type === "item" ? (
                  <Package className="w-16 h-16 text-white" />
                ) : isBackground ? (
                  <MapPin className="w-16 h-16 text-white" />
                ) : (
                  <Users className="w-16 h-16 text-white" />
                )}
              </div>
            )}
          </div>

          <p className="text-center text-white/25 text-[10px] py-2 pointer-events-none select-none">
            {scale > 1 ? t("assets.zoomHintDrag") : t("assets.zoomHintClose")}
          </p>

          {/* ── Camera Framings panel (background-only) ──
              Each framing button generates a NEW standalone background
              asset (e.g. `@{parent}_wide`, `@{parent}_wide_2` on the
              next click of the same button). The parent's photo_url is
              never touched. Existing siblings are listed below as chips
              so the user can jump between them without closing the
              modal. */}
          {isBackground && (
            <div
              className="border-t border-border-subtle bg-surface-sidebar px-3 py-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <Camera className="w-3 h-3 text-white/60" />
                  <span className="text-white/70 text-[10px] font-semibold uppercase tracking-wider">
                    {t("assets.generateCameraFramings")}
                  </span>
                  <HelpTooltip>
                    {t("assets.cameraFramingHelp")}
                  </HelpTooltip>
                  {isMigrating && (
                    <span className="flex items-center gap-1 text-white/50 text-[10px]">
                      <Loader2 className="w-3 h-3 animate-spin" /> {t("assets.upgradingLegacy")}
                    </span>
                  )}
                </div>
                <button
                  onClick={generateAll}
                  disabled={!effectivePrimaryUrl || isMigrating}
                  className="px-2 py-1 text-[10px] font-medium border border-border-subtle text-foreground/80 hover:bg-surface-panel disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                  style={{ borderRadius: 2 }}
                  title="Generate one new sibling per framing (4 in parallel)"
                >
                  {isAnyGenerating ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {t("studio.generating")} ({totalInFlight})
                    </>
                  ) : (
                    t("assets.generateAll")
                  )}
                </button>
              </div>

              <div className="grid grid-cols-4 gap-1.5">
                {BACKGROUND_FRAMINGS.map((f) => {
                  const count = inFlight[f.id] ?? 0;
                  const generating = count > 0;
                  const hasError = !!errors[f.id] && !generating;
                  return (
                    <button
                      key={f.id}
                      onClick={() => void generateOne(f.id)}
                      disabled={!effectivePrimaryUrl || isMigrating}
                      className="relative flex flex-col items-center justify-center gap-1 py-2 px-1.5 bg-background/70 border border-border-subtle hover:border-primary/30 hover:bg-surface-panel disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      style={{ borderRadius: 2, minHeight: 58 }}
                      title={`Generate a new @${asset.tag_name.replace(/^@/, "")}_${f.id} sibling asset — ${f.shortDesc}`}
                    >
                      {generating ? (
                        <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                      ) : hasError ? (
                        <AlertCircle className="w-3.5 h-3.5 text-orange-400/80" />
                      ) : (
                        <Plus className="w-3.5 h-3.5 text-white/80" />
                      )}
                      <span className="text-white text-[10px] font-semibold uppercase tracking-wider">
                        {f.label}
                      </span>
                      <span className="text-white/40 text-[9px] leading-tight text-center line-clamp-1">
                        {f.shortDesc}
                      </span>
                      {count > 1 && (
                        <span
                          className="absolute top-1 right-1 text-[9px] text-white/90 px-1"
                          style={{
                            background: "hsl(var(--primary) / 0.85)",
                            borderRadius: 2,
                            minWidth: 14,
                            textAlign: "center",
                          }}
                          title={`${count} generations queued for this framing`}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Sibling chips — assets already spawned off this parent.
                  Shows each as `@tag_name`; click opens that asset. */}
              {siblings.length > 0 && (
                <div className="mt-3">
                  <p className="text-white/40 text-[9px] font-semibold uppercase tracking-wider mb-1.5">
                    {t("assets.existingSiblings", { count: siblings.length })}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {siblings.map(({ asset: sib, framing }) => (
                      <button
                        key={sib.id}
                        onClick={() => onSwitchAsset?.(sib)}
                        className="group flex items-center gap-1.5 px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/25 transition-colors"
                        style={{ borderRadius: 2 }}
                        title={`Open @${sib.tag_name.replace(/^@/, "")} (${BACKGROUND_FRAMINGS_BY_ID[framing as keyof typeof BACKGROUND_FRAMINGS_BY_ID]?.label ?? framing})`}
                      >
                        {sib.photo_url ? (
                          <img
                            src={sib.photo_url}
                            alt={sib.tag_name}
                            className="w-5 h-5 object-cover"
                            style={{ borderRadius: 2 }}
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <Camera className="w-3 h-3 text-white/60" />
                        )}
                        <span className="text-white/85 text-[10px] font-medium">
                          @{sib.tag_name.replace(/^@/, "")}
                        </span>
                        <ArrowRight className="w-3 h-3 text-white/40 group-hover:text-white/80 transition-colors" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-muted-foreground text-[9px] mt-2">
                {t("assets.generatedFramings")}
              </p>
            </div>
          )}
        </div>

        <div
          className="flex flex-col bg-card border-l border-border p-5 overflow-y-auto"
          style={{ width: 240, minWidth: 200 }}
        >
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center bg-muted hover:bg-muted/80 transition-colors"
            style={{ borderRadius: 3 }}
          >
            <X className="w-3 h-3 text-muted-foreground" />
          </button>

          <span
            className="self-start text-[11px] font-bold px-2 py-0.5 mb-4"
            style={{
              color: KR,
              background: "rgba(249,66,58,0.12)",
              border: `1px solid ${KR_BORDER}`,
              borderRadius: 2,
            }}
          >
            @{asset.tag_name}
          </span>

          {asset.asset_type === "item" && asset.ai_description && (
            <div className="mb-4">
              <p className="text-[11px] text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                <Package className="w-3 h-3" /> {t("assets.itemDescription")}
              </p>
              <p className="text-[13px] text-foreground/80 leading-relaxed">{asset.ai_description}</p>
            </div>
          )}
          {isBackground && asset.space_description && (
            <div className="mb-4">
              <p className="text-[11px] text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                <MapPin className="w-3 h-3" /> {t("assets.locationDescription")}
              </p>
              <p className="text-[13px] text-foreground/80 leading-relaxed">{asset.space_description}</p>
            </div>
          )}
          {isChar && (
            <>
              {asset.ai_description && (
                <div className="mb-4">
                  <p className="text-[11px] text-muted-foreground font-medium mb-1.5">{t("assets.characterDescription")}</p>
                  <p className="text-[13px] text-foreground/80 leading-relaxed">
                    {asset.ai_description.slice(0, 240)}
                    {asset.ai_description.length > 240 ? "..." : ""}
                  </p>
                </div>
              )}
              {asset.role_description && (
                <div className="mb-3">
                  <p className="text-[11px] text-muted-foreground font-medium mb-0.5 flex items-center gap-1.5">
                    <User className="w-3 h-3" /> {t("assets.roleRelationship")}
                  </p>
                  <p className="text-[13px] text-foreground/70">{asset.role_description}</p>
                </div>
              )}
              {asset.outfit_description && (
                <div className="mb-3">
                  <p className="text-[11px] text-muted-foreground font-medium mb-0.5 flex items-center gap-1.5">
                    <Shirt className="w-3 h-3" /> {t("assets.outfit")}
                  </p>
                  <p className="text-[13px] text-foreground/70">{asset.outfit_description}</p>
                </div>
              )}
              {!asset.ai_description && !asset.role_description && !asset.outfit_description && (
                <p className="text-[12px] text-muted-foreground/30">{t("assets.noDescriptionRegistered")}</p>
              )}
            </>
          )}

          <div className="mt-auto pt-3 border-t border-border">
            <span className="text-[11px] text-muted-foreground/50">
              {t("assets.usedInScenes", { count: sceneCount, unit: t(sceneCount === 1 ? "assets.scene" : "assets.scenes") })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
