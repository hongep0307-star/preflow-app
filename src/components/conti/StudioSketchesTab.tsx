/**
 * StudioSketchesTab — per-scene composition drafts, rendered inside ContiStudio.
 *
 * Lifecycle boundary:
 *   - Generates via `generateSceneSketches` (thin wrapper over generateMoodImages).
 *   - Persists results to `scenes.sketches` (per-scene column) — NEVER touches
 *     `briefs.mood_image_urls`. That keeps Mood Ideation (brief-scoped tone
 *     references) and Sketches (scene-scoped composition drafts) on separate
 *     storage so their roles don't blur.
 *   - In-flight state lives in `_sketchGenByKey` keyed by `projectId:sceneId`,
 *     so closing Studio / switching Conti tab does NOT cancel the job, and
 *     the final DB write happens regardless of whether this component is
 *     still mounted (persist runs inside the promise's finally block).
 *
 * Entry: user clicks the Sparkles action on a Conti scene card → ContiStudio
 * opens with `initialTab="sketches"`. There is no separate popover; single
 * entry point keeps UX predictable.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Loader2, Check, Heart, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { deleteStoredFileIfUnreferenced } from "@/lib/storageUtils";
import type { Sketch } from "./contiTypes";
import {
  SKETCH_MODEL_DEFAULT,
  SKETCH_MODEL_LABELS,
  SKETCH_MODEL_USES_ASSET_REFS,
  generateSceneSketches,
  makeSketchFromUrl,
  type SketchModel,
} from "@/lib/sketches";
import {
  getSketchGen,
  getAllSketchGensForScene,
  setSketchGen,
  patchSketchGen,
  subscribeSketchGen,
  genSketchId,
} from "./sketchState";
import { useT } from "@/lib/uiLanguage";

const KR = "#f9423a";
const KR_BG = "rgba(249,66,58,0.10)";
const KR_BG2 = "rgba(249,66,58,0.18)";
const ASPECT_CLASS: Record<string, string> = {
  vertical: "aspect-[9/16]",
  horizontal: "aspect-video",
  square: "aspect-square",
};

const MODEL_ORDER: SketchModel[] = ["nano-banana-2", "gpt-image-1.5", "gpt-image-2"];
// Min/max match MoodIdeationPanel's stepper (1..20). 20 is a soft cap
// coming from the quota budget for a single generation burst — beyond
// that the NB2 batch pacing stops feeling "one job" in the UI.
const COUNT_MIN = 1;
const COUNT_MAX = 20;
// Thumb column range for the gallery sizer. Tighter than MoodIdeationPanel's
// 1..7 because the Studio side panel is narrower than the full Ideation
// canvas — beyond 4 cols sketches become hard to evaluate visually.
const COLS_MIN = 1;
const COLS_MAX = 4;
const COLS_DEFAULT = 2;

export interface StudioSketchesTabProps {
  projectId: string;
  scene: {
    id: string;
    scene_number: number;
    title: string | null;
    description: string | null;
    camera_angle: string | null;
    location: string | null;
    mood: string | null;
    tagged_assets: string[];
    conti_image_url: string | null;
    sketches?: Sketch[];
  };
  assets: Array<{
    tag_name: string;
    photo_url: string | null;
    ai_description: string | null;
    outfit_description: string | null;
    role_description: string | null;
    space_description: string | null;
    asset_type?: string;
  }>;
  videoFormat: string;
  briefAnalysis: any | null;
  /** Called when the user picks a sketch as the scene's conti image.
   *  Contract matches ContiStudio's existing `onSaveInpaint` contract:
   *  the DB `scenes.conti_image_url` must already be written; the parent
   *  pushes the previous URL to history and syncs local state. */
  onSetAsSceneImage: (url: string) => void;
  /** Currently-previewed url in the parent canvas (mirrors ContiStudio's
   *  History tab `previewUrl`). Sketches with this url get a "Previewing"
   *  affordance so the user knows where the canvas is showing from. */
  previewUrl?: string | null;
  /** Toggle: passing the same url un-previews. null clears entirely.
   *  Identical contract to the History tab's Preview button so the canvas
   *  swap behaves the same regardless of source. */
  onPreview?: (url: string | null) => void;
  /** Called whenever the persisted sketch list for this scene changes
   *  (generate, like-toggle, delete). Receives a functional updater so
   *  the parent can apply it against the FRESHEST snapshot it has — this
   *  matters when two model batches finish in the same tick: a plain
   *  array hand-off would let the second batch clobber the first because
   *  both children computed their `merged` array against the same stale
   *  React state (refs only refresh on commit). The updater form makes
   *  the merge atomic at the parent's source of truth.
   *
   *  The parent (ContiTab) refreshes its `activeScenes` and writes the
   *  active version's scenes JSON inside this callback so (a) the
   *  SortableContiCard sketch-count badge stays in sync and (b) reopening
   *  Studio doesn't hand back a stale `scene.sketches` prop. */
  onSketchesUpdated?: (updater: (current: Sketch[]) => Sketch[]) => void;
}

export function StudioSketchesTab({
  projectId,
  scene,
  assets,
  videoFormat,
  briefAnalysis,
  onSetAsSceneImage,
  previewUrl,
  onPreview,
  onSketchesUpdated,
}: StudioSketchesTabProps) {
  const { toast } = useToast();
  const t = useT();

  // Per-project persisted model selection (last used).
  const modelKey = `ff_sketch_model_${projectId}`;
  const [model, setModelState] = useState<SketchModel>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(modelKey) : null;
      if (raw === "nano-banana-2" || raw === "gpt-image-2" || raw === "gpt-image-1.5") {
        return raw;
      }
    } catch { /* ignore */ }
    return SKETCH_MODEL_DEFAULT;
  });
  const setModel = (val: SketchModel) => {
    setModelState(val);
    try { window.localStorage.setItem(modelKey, val); } catch { /* ignore */ }
  };
  const getModelDescription = (m: SketchModel) => {
    if (m === "nano-banana-2") return t("studio.sketchModelNanoDesc");
    if (m === "gpt-image-2") return t("studio.sketchModelGpt2Desc");
    return t("studio.sketchModelGpt15Desc");
  };
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!modelMenuOpen) return;
    const fn = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [modelMenuOpen]);

  const [count, setCount] = useState(3);

  // Per-project gallery column count (image size). Persisted so the user's
  // preferred sketch density survives tab/scene navigation.
  const colsKey = `ff_sketch_cols_${projectId}`;
  const [thumbCols, setThumbColsState] = useState<number>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(colsKey) : null;
      const parsed = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(parsed) && parsed >= COLS_MIN && parsed <= COLS_MAX) return parsed;
    } catch { /* ignore */ }
    return COLS_DEFAULT;
  });
  const setThumbCols = (val: number) => {
    setThumbColsState(val);
    try { window.localStorage.setItem(colsKey, String(val)); } catch { /* ignore */ }
  };

  // Saved-only filter (mirrors MoodIdeationPanel.showLikedOnly). NOT
  // persisted across mounts — most users want to see everything when
  // returning to a scene; opting back in is one click away.
  const [showLikedOnly, setShowLikedOnly] = useState(false);

  // ── Sketches state ──
  //
  // Start from props (DB hydrated). We also keep a mutable local copy so that
  // like/delete/set-as-scene-image feel immediate; all mutations are mirrored
  // to DB via `persistSketches`.
  //
  // Defensive: a legacy `scene_versions.scenes` JSON could deliver `sketches`
  // as the string `"[]"` instead of an array (see normalizeSceneSketches).
  // ContiTab.loadVersions sanitises this on read, but we still `Array.isArray`
  // here so an unsanitised codepath cannot crash the tab on the very next
  // `.filter` call.
  const [sketches, setSketches] = useState<Sketch[]>(
    Array.isArray(scene.sketches) ? scene.sketches : [],
  );
  const sketchesRef = useRef(sketches);
  sketchesRef.current = sketches;

  // ── Hydrate-from-prop policy ──
  //
  // IMPORTANT: the version JSON (`scene_versions.scenes`) is the source of
  // truth for what the user sees in Conti — NOT the `scenes` table. Each
  // version is an immutable snapshot whose scene IDs are independent from
  // (and typically don't match) any row currently in the `scenes` table.
  // An earlier iteration tried to hydrate by querying
  //   `supabase.from("scenes").select("sketches").eq("id", scene.id).single()`
  // which silently returned no row → `setSketches([])` → wiped out the
  // freshly-generated list every time the user re-entered the tab. Same
  // bug for the persist path: `update scenes set sketches=… where id=…`
  // matched zero rows, so the DB never received the writes either.
  //
  // The reliable channel is `onSketchesUpdated` — it propagates the new
  // list up to ContiTab.updateVersionScenes which writes the version JSON
  // and updates `activeScenes`, so `scene.sketches` is fresh on every
  // remount. Hydrate from the prop and trust that it's authoritative.
  //
  // ── Why we ALSO depend on `scene.sketches` (not just `scene.id`) ──
  //
  // An earlier version of this effect deliberately ran only on scene-id
  // change to avoid "mid-generation re-renders clobbering optimistic
  // state". That concern made sense back when skeleton placeholders were
  // stored inside the local `sketches` array; today they live in the
  // module-level gen store (sketchState.ts) instead, so local `sketches`
  // only ever contains REAL completed images. Syncing it to the parent
  // prop is now strictly safe.
  //
  // Why we need to sync: handleGenerate's finally block calls
  //   1) setSketches((prev) => [...new, ...prev])
  //   2) onSketchesUpdated → setActiveScenes  (parent prop refresh)
  //   3) await persistSketches(...)   ← async boundary
  //   4) setSketchGen(null) → notify → setGenTick re-render
  // The await in (3) splits (1)+(2) and (4) into two React batches.
  // Between them the parent re-renders with the new `scene.sketches`
  // prop, but if the local setSketches commit is somehow delayed or if a
  // sibling-batch (NB2 + GPT2 racing) updates the parent ahead of the
  // local state, the gallery render at step (4) sees skeletons cleared
  // (gen store is empty) AND an outdated local `sketches` — symptom: the
  // skeletons fade out but no new image cards appear in their place
  // until the user navigates away or refreshes.
  //
  // Adding `scene.sketches` as a dep makes the local state follow the
  // authoritative parent value whenever it changes, eliminating that
  // window without affecting normal scene-switch hydration.
  useEffect(() => {
    setSketches(Array.isArray(scene.sketches) ? scene.sketches : []);
  }, [scene.id, scene.sketches]);

  // ── In-flight generation subscription ──
  //
  // `genTick` is a React-level ticker that increments whenever the module
  // store fires a listener. We don't read the store during render; instead
  // we derive `inFlight` from the store on each tick so UI reflects the
  // skeletons / arrived URLs cleanly.
  const [genTick, setGenTick] = useState(0);
  useEffect(() => {
    return subscribeSketchGen(projectId, scene.id, () => setGenTick((t) => t + 1));
  }, [projectId, scene.id]);
  // genTick is intentionally read below via getSketchGen — its value is not
  // referenced directly, the effect is just to trigger re-render.
  void genTick;

  // Per-model generation lookup: each model runs independently so the user
  // can fire NB2 + GPT-2 side-by-side. The button only disables for the
  // model that's currently in-flight, not all models.
  const currentModelGen = getSketchGen(projectId, scene.id, model);
  const isGeneratingCurrentModel = !!currentModelGen?.promise;
  // Aggregate snapshot for the gallery. Skeletons + arrived urls from
  // every active generation (any model) are stitched together so the user
  // sees the full pipeline, not just one model at a time.
  const allGens = getAllSketchGensForScene(projectId, scene.id);
  const anyGenerating = allGens.some((g) => !!g.promise);

  const persistSketches = async (next: Sketch[]) => {
    // Best-effort write to `scenes.sketches`. For most projects this is a
    // no-op because the active version's snapshot has its own scene IDs
    // (see hydrate-from-prop note above), but we still try in case the
    // current scene id happens to also exist as a `scenes` row — keeps
    // the table self-consistent for projects without versioning enabled.
    // The authoritative persist runs through `onSketchesUpdated` →
    // `updateVersionScenes` in ContiTab, which writes the version JSON.
    try {
      await supabase.from("scenes").update({ sketches: next }).eq("id", scene.id);
    } catch (e: any) {
      // Don't toast — if the row doesn't exist this is expected. The
      // version JSON write happens via onSketchesUpdated separately.
      console.warn("[Sketches] scenes-table write skipped:", e?.message ?? e);
    }
  };

  const hasPhotoAssets = useMemo(() => assets.some((a) => a.photo_url), [assets]);
  const needsAsset = SKETCH_MODEL_USES_ASSET_REFS[model];
  const assetBlocked = needsAsset && !hasPhotoAssets;

  const handleGenerate = async () => {
    // Only block re-entry on the SAME model. Switching models lets the user
    // queue an NB2 + GPT-2 batch in parallel — different upstreams, no shared
    // quota, no reason to serialize on our side.
    if (isGeneratingCurrentModel) return;
    if (assetBlocked) {
      toast({
        title: t("studio.registerAssetsFirstTitle"),
        description: t("studio.modelRequiresAssets", { model: SKETCH_MODEL_LABELS[model] }),
        variant: "destructive",
      });
      return;
    }

    // Capture model in a closure so the rest of this generation cannot be
    // confused by the user picking a different model mid-flight.
    const genModel = model;
    const skeletonIds = Array.from({ length: count }, () => genSketchId());
    setSketchGen(projectId, scene.id, genModel, {
      count,
      skeletonIds,
      arrivedUrls: [],
      promise: null,
      model: genModel,
      startedAt: Date.now(),
    });

    const genPromise = (async () => {
      let generationError: any = null;
      try {
        await generateSceneSketches(
          {
            projectId,
            sceneNumber: scene.scene_number,
            scene: {
              scene_number: scene.scene_number,
              title: scene.title,
              description: scene.description,
              camera_angle: scene.camera_angle,
              location: scene.location,
              mood: scene.mood,
              tagged_assets: scene.tagged_assets,
            },
            briefAnalysis,
            assets,
            videoFormat,
            count,
            model: genModel,
          },
          (batchUrls) => {
            const cur = getSketchGen(projectId, scene.id, genModel);
            if (cur) {
              patchSketchGen(projectId, scene.id, genModel, {
                arrivedUrls: [...cur.arrivedUrls, ...batchUrls],
              });
            }
          },
        );
      } catch (err: any) {
        generationError = err;
      } finally {
        // ── Unmount-safe completion ──
        //
        // The toast and persist BOTH live here so we report what actually
        // landed, not the requested count. Earlier code toasted
        // `${count} sketches generated` from the try-block which lied
        // when partial batches failed (e.g. 1/3 NB2 succeeded → "3
        // sketches generated" while only 1 was real). The user-visible
        // symptom of that was "completion toast but no images" when
        // every shot in the batch silently failed at the upstream.
        const finalGen = getSketchGen(projectId, scene.id, genModel);
        const arrived = finalGen?.arrivedUrls ?? [];
        const arrivedCount = arrived.length;

        if (arrivedCount > 0) {
          const newSketches: Sketch[] = arrived.map((url) =>
            makeSketchFromUrl(url, finalGen!.model),
          );
          // ⚠️ Concurrent-batch correctness:
          //   When NB2 + GPT batches finish in the same React tick (or
          //   close enough that no commit lands between them), reading
          //   `sketchesRef.current` here gives both finally blocks the
          //   SAME stale snapshot — refs only refresh on render commit.
          //   With a non-functional setSketches(merged) the second call
          //   wins and the first batch's images vanish from the UI even
          //   though both were written to the DB.
          //   The functional setter form below lets React replay updates
          //   sequentially against the latest committed state. The parent
          //   updater (onSketchesUpdated) does the same against its own
          //   source of truth (module store / activeScenes), so neither
          //   layer races.
          let mergedForPersist: Sketch[] = [];
          setSketches((prev) => {
            mergedForPersist = [...newSketches, ...prev];
            return mergedForPersist;
          });
          onSketchesUpdated?.((current) => [...newSketches, ...current]);
          // Best-effort scenes-table write (no-op for versioned projects).
          // We use the locally-computed merged list — it might miss a
          // sibling batch's just-arrived sketches but that's fine: the
          // version JSON write through onSketchesUpdated is authoritative.
          await persistSketches(mergedForPersist);
        }

        // ── Honest toast ──
        if (generationError) {
          toast({
            title: t("studio.sketchGenerationFailed"),
            description: generationError?.message ?? String(generationError),
            variant: "destructive",
          });
        } else if (arrivedCount === 0) {
          // generateSceneSketches resolved without throwing but nothing
          // landed in the store. Should be unreachable (generateMoodImages
          // throws "모든 이미지 생성 실패" when 0 succeed), but guard so we
          // never lie with a "generated" toast.
          toast({
            title: t("studio.noSketchesGenerated"),
            description: t("studio.noSketchesGeneratedDesc"),
            variant: "destructive",
          });
        } else if (arrivedCount < count) {
          toast({
            title: t("studio.partialSketchesGenerated", { done: arrivedCount, total: count }),
            description: t("studio.partialSketchesFailed", { count: count - arrivedCount }),
          });
        } else {
          toast({
            title: t("studio.sketchesGenerated", { count: arrivedCount }),
          });
        }

        setSketchGen(projectId, scene.id, genModel, null);
      }
    })();
    patchSketchGen(projectId, scene.id, genModel, { promise: genPromise });
  };

  const handleSetAsScene = async (s: Sketch) => {
    try {
      // Mirrors ContiStudio.handleInpaint: we write scenes.conti_image_url
      // ourselves, then call onSetAsSceneImage so the parent pushes the
      // previous URL into history and syncs active-version state.
      await supabase
        .from("scenes")
        .update({ conti_image_url: s.url, conti_image_crop: null })
        .eq("id", scene.id);
      onSetAsSceneImage(s.url);
      toast({
        title: scene.conti_image_url ? t("studio.sceneImageReplaced") : t("studio.setAsSceneImage"),
      });
    } catch (e: any) {
      toast({ title: t("studio.failedSetSceneImage"), description: e.message, variant: "destructive" });
    }
  };

  const handleToggleLike = async (id: string) => {
    let nextForPersist: Sketch[] = [];
    setSketches((prev) => {
      nextForPersist = prev.map((s) => (s.id === id ? { ...s, liked: !s.liked } : s));
      return nextForPersist;
    });
    onSketchesUpdated?.((current) =>
      current.map((s) => (s.id === id ? { ...s, liked: !s.liked } : s)),
    );
    await persistSketches(nextForPersist);
  };

  const handleDelete = async (id: string) => {
    const target = sketchesRef.current.find((s) => s.id === id);
    let nextForPersist: Sketch[] = [];
    setSketches((prev) => {
      nextForPersist = prev.filter((s) => s.id !== id);
      return nextForPersist;
    });
    onSketchesUpdated?.((current) => current.filter((s) => s.id !== id));
    // If the deleted sketch was being previewed in the parent canvas,
    // clear the preview so the canvas falls back to the scene's current
    // conti_image_url instead of holding onto a now-broken url.
    if (target?.url && previewUrl === target.url) {
      onPreview?.(null);
    }
    await persistSketches(nextForPersist);
    // 기존: 남은 sketches + 현재 씬의 live conti_image_url 만 검사 → 다른
    // 씬 / scene_versions snapshot / Mood Ideation / 이 씬의
    // conti_image_history 에 동일 URL 이 살아있어도 파일을 지워 HistorySheet
    // 엑박을 만들었음. 중앙 가드로 프로젝트 전체를 훑어 참조 없을 때만 삭제.
    if (target?.url) {
      void deleteStoredFileIfUnreferenced(projectId, target.url);
    }
  };

  // ── Render ──

  // Aggregate skeleton + arrived state across every in-flight model so the
  // gallery shows one unified pipeline regardless of which model triggered
  // each batch. Skeletons annotated with their owning model so the user
  // gets a hint about what's cooking when multiple models run together.
  type SkeletonItem = { id: string; model: SketchModel };
  const pendingSkeletons: SkeletonItem[] = [];
  for (const g of allGens) {
    const remaining = g.skeletonIds.slice(g.arrivedUrls.length);
    for (const id of remaining) pendingSkeletons.push({ id, model: g.model });
  }

  // Arrived URLs that are NOT yet persisted to the committed `sketches`
  // state. Rendered eagerly as provisional cards so users see each image
  // appear the moment it lands instead of having to wait for the full
  // batch to complete (previously the skeletons disappeared one-by-one
  // but nothing replaced them until the entire generation finished).
  //
  // Dedup against `sketches` handles the brief overlap window inside
  // handleGenerate's finally block: `setSketches(new)` fires before
  // `setSketchGen(null)`, and the `await persistSketches(...)` between
  // them can let React commit a render where both sets contain the URL.
  // Filtering by URL keeps the card from flashing twice.
  type ArrivingItem = { url: string; model: SketchModel };
  const arrivingItems: ArrivingItem[] = [];
  const committedUrlSet = new Set(sketches.map((s) => s.url));
  for (const g of allGens) {
    for (const url of g.arrivedUrls) {
      if (!committedUrlSet.has(url)) {
        arrivingItems.push({ url, model: g.model });
      }
    }
  }

  // Counters for the Generate button label. Refer to the CURRENT model so
  // the count "X/Y" reads naturally for what the user just clicked.
  const arrivedForCurrentModel = currentModelGen?.arrivedUrls.length ?? 0;
  const countForCurrentModel = currentModelGen?.count ?? count;

  const aspect = ASPECT_CLASS[videoFormat] ?? ASPECT_CLASS.horizontal;

  // Filter for the gallery render. Saved-only narrows to liked sketches;
  // skeletons are always shown so the user can monitor in-flight batches
  // even when filtering. likedCount feeds the Saved-button label.
  const likedCount = sketches.filter((s) => s.liked).length;
  const displaySketches = showLikedOnly ? sketches.filter((s) => s.liked) : sketches;

  // ── Arrow-key navigation while previewing ──
  //
  // ContiStudio's global keydown handler binds ←/→ to scene navigation.
  // While a sketch is previewing in the canvas we want those same keys
  // (plus ↑/↓) to step through the gallery instead, so power-users can
  // flip through candidates without leaving the keyboard. We attach with
  // capture+stopImmediatePropagation so this listener wins over the
  // parent's window-level handler. Effect only runs when previewUrl is
  // set, keeping the global behaviour unchanged at all other times.
  useEffect(() => {
    if (!previewUrl || !onPreview) return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditing =
        tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
      if (isEditing) return;
      if (
        e.key !== "ArrowLeft" &&
        e.key !== "ArrowRight" &&
        e.key !== "ArrowUp" &&
        e.key !== "ArrowDown"
      )
        return;
      // Use the rendered list (respects Saved filter) so navigation
      // matches what the user actually sees.
      const list = displaySketches;
      if (list.length === 0) return;
      const idx = list.findIndex((s) => s.url === previewUrl);
      if (idx < 0) return;
      let next = idx;
      if (e.key === "ArrowLeft") next = idx - 1;
      else if (e.key === "ArrowRight") next = idx + 1;
      else if (e.key === "ArrowUp") next = idx - thumbCols;
      else if (e.key === "ArrowDown") next = idx + thumbCols;
      if (next < 0 || next >= list.length) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onPreview(list[next].url);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [previewUrl, onPreview, displaySketches, thumbCols]);

  return (
    <div className="flex flex-col h-full">
      {/* ── Controls ── single compact row, MoodIdeationPanel-style.
          Layout: [count stepper] [model pill] [spacer] [cols slider] [Generate]
          The verbose full-width "Generate N sketches with <model>" CTA was
          replaced by a short "Generate" button — model + count are already
          visible immediately to its left, so repeating them in the label is
          noise. Progress (X/Y) still appears on the button while in-flight. */}
      <div className="px-3 py-2.5 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-2">
          {/* Count stepper */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              background: "hsl(var(--muted))",
              borderRadius: 0,
              padding: "2px 6px",
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => setCount((p) => Math.max(COUNT_MIN, p - 1))}
              disabled={isGeneratingCurrentModel}
              style={{
                width: 18, height: 22, borderRadius: 0, fontSize: 13, fontWeight: 600,
                background: "transparent", color: "hsl(var(--muted-foreground))",
                border: "none", cursor: isGeneratingCurrentModel ? "not-allowed" : "pointer",
                lineHeight: 1, opacity: isGeneratingCurrentModel ? 0.5 : 1,
              }}
              aria-label={t("studio.decreaseCount")}
            >
              −
            </button>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={count}
              disabled={isGeneratingCurrentModel}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= COUNT_MIN && v <= COUNT_MAX) setCount(v);
              }}
              style={{
                width: 26, height: 20, borderRadius: 0, fontSize: 11, fontWeight: 700,
                background: KR, color: "#fff", border: "none", textAlign: "center",
                fontFamily: "var(--font-mono, monospace)",
              }}
              aria-label={t("studio.sketchCount")}
            />
            <button
              onClick={() => setCount((p) => Math.min(COUNT_MAX, p + 1))}
              disabled={isGeneratingCurrentModel}
              style={{
                width: 18, height: 22, borderRadius: 0, fontSize: 13, fontWeight: 600,
                background: "transparent", color: "hsl(var(--muted-foreground))",
                border: "none", cursor: isGeneratingCurrentModel ? "not-allowed" : "pointer",
                lineHeight: 1, opacity: isGeneratingCurrentModel ? 0.5 : 1,
              }}
              aria-label={t("studio.increaseCount")}
            >
              +
            </button>
          </div>

          {/* Model pill — collapses to just the label so it doesn't dominate
              the row. Dropdown opens downward with the same description-rich
              entries as before so the user still gets context when picking. */}
          <div ref={modelMenuRef} className="relative" style={{ minWidth: 0 }}>
            <button
              onClick={() => setModelMenuOpen((v) => !v)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "0 8px",
                height: 26,
                borderRadius: 0,
                fontSize: 11,
                fontWeight: 500,
                cursor: "pointer",
                border: `0.5px solid ${modelMenuOpen ? KR : "hsl(var(--border))"}`,
                background: modelMenuOpen ? KR_BG : "hsl(var(--muted))",
                color: modelMenuOpen ? KR : "hsl(var(--muted-foreground))",
                transition: "all 0.15s",
                whiteSpace: "nowrap",
              }}
              title={getModelDescription(model)}
            >
              <Sparkles className="w-3 h-3" style={{ color: modelMenuOpen ? KR : KR }} />
              {SKETCH_MODEL_LABELS[model]}
              <span style={{ fontSize: 9, opacity: 0.6 }}>{modelMenuOpen ? "▴" : "▾"}</span>
            </button>
            {modelMenuOpen && (
              <div
                className="absolute top-full left-0 mt-1 border border-white/[0.08] rounded-none z-20 overflow-hidden"
                style={{
                  background: "hsl(var(--card))",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
                  minWidth: 240,
                }}
              >
                {MODEL_ORDER.map((m) => {
                  const active = model === m;
                  const disabled = SKETCH_MODEL_USES_ASSET_REFS[m] && !hasPhotoAssets;
                  return (
                    <button
                      key={m}
                      disabled={disabled}
                      onClick={() => {
                        setModel(m);
                        setModelMenuOpen(false);
                      }}
                      className="w-full flex flex-col items-start gap-0.5 px-3 py-2 text-left disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      style={{
                        background: active ? KR_BG : "transparent",
                        color: active ? KR : "hsl(var(--foreground))",
                      }}
                      onMouseEnter={(e) => {
                        if (!active && !disabled) {
                          (e.currentTarget as HTMLElement).style.background = "hsl(var(--muted))";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!active) {
                          (e.currentTarget as HTMLElement).style.background = "transparent";
                        }
                      }}
                    >
                      <span className="flex items-center gap-1.5 text-[11.5px] font-semibold">
                        {SKETCH_MODEL_LABELS[m]}
                        {m === SKETCH_MODEL_DEFAULT && (
                          <span
                            className="text-[9px] tracking-wider px-1.5 py-0.5 border border-current"
                            style={{ color: "hsl(var(--muted-foreground))", borderColor: "hsl(var(--border))" }}
                          >
                            {t("studio.default")}
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {disabled ? t("studio.registerAssetsFirst") : getModelDescription(m)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Saved filter — narrows the gallery to liked sketches only.
              Same pattern as MoodIdeationPanel.showLikedOnly so the two
              panels feel consistent. Skeletons stay visible regardless
              of filter so in-flight batches remain monitorable. */}
          <button
            onClick={() => setShowLikedOnly((p) => !p)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "0 8px",
              height: 26,
              borderRadius: 0,
              fontSize: 11,
              fontWeight: 500,
              background: showLikedOnly ? KR_BG : "transparent",
              color: showLikedOnly ? KR : "hsl(var(--muted-foreground))",
              border: `0.5px solid ${showLikedOnly ? KR : "transparent"}`,
              cursor: "pointer",
              transition: "all 0.15s",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
            title={showLikedOnly ? t("studio.showAllSketches") : t("studio.showLikedOnly")}
          >
            <Heart
              className="w-3 h-3"
              fill={showLikedOnly ? "currentColor" : "none"}
              strokeWidth={2}
            />
            {likedCount > 0 ? t("studio.savedCount", { count: likedCount }) : t("common.saved")}
          </button>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Column slider — sizes the gallery thumbnails. Mirrors
              MoodIdeationPanel.thumbCols but with a tighter range because
              the Studio side-panel is narrower. */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <svg
              width={11} height={11} viewBox="0 0 24 24"
              fill="none" stroke="hsl(var(--muted-foreground))"
              strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            >
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
            <input
              type="range"
              min={COLS_MIN}
              max={COLS_MAX}
              step={1}
              value={thumbCols}
              onChange={(e) => setThumbCols(Number(e.target.value))}
              style={{ width: 56, accentColor: KR, cursor: "pointer" }}
              title={t("studio.colsTitle", { count: thumbCols })}
              aria-label={t("studio.galleryColumns")}
            />
          </div>

          {/* Generate — short label, MoodIdeationPanel-style. Progress is
              shown via "X/Y" while in-flight; static label otherwise. */}
          <button
            onClick={handleGenerate}
            disabled={isGeneratingCurrentModel || assetBlocked}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "0 12px",
              height: 26,
              borderRadius: 0,
              fontSize: 11,
              fontWeight: 600,
              background: isGeneratingCurrentModel ? "rgba(249,66,58,0.55)" : KR,
              color: "#fff",
              border: "none",
              cursor: isGeneratingCurrentModel || assetBlocked ? "not-allowed" : "pointer",
              opacity: assetBlocked ? 0.4 : 1,
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
          >
            {isGeneratingCurrentModel ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {arrivedForCurrentModel}/{countForCurrentModel}
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                {t("mood.generate")}
              </>
            )}
          </button>
        </div>

        {/* Status hints (only when relevant — avoid permanent UI weight) */}
        {(anyGenerating && !isGeneratingCurrentModel) || assetBlocked ? (
          <div className="mt-1.5 space-y-0.5">
            {anyGenerating && !isGeneratingCurrentModel && (
              <p className="text-[10px]" style={{ color: KR }}>
                {t("studio.otherModelsGenerating")}
              </p>
            )}
            {assetBlocked && (
              <p className="text-[10px] text-muted-foreground">
                {t("studio.modelRequiresAssets", { model: SKETCH_MODEL_LABELS[model] })}
              </p>
            )}
          </div>
        ) : null}
      </div>

      {/* ── Gallery ── */}
      <div className="flex-1 overflow-y-auto p-3">
        {sketches.length === 0 && pendingSkeletons.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 px-6 py-10">
            <Sparkles className="w-6 h-6 opacity-60" />
            <div className="text-[12px] font-semibold">{t("studio.noSketchesYet")}</div>
            <p className="text-[11px] text-center leading-relaxed text-muted-foreground/80">
              {t("studio.noSketchesDesc", { scene: scene.scene_number })}
            </p>
          </div>
        ) : showLikedOnly && displaySketches.length === 0 && pendingSkeletons.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 px-6 py-10">
            <Heart className="w-6 h-6 opacity-60" />
            <div className="text-[12px] font-semibold">{t("studio.noSavedSketches")}</div>
            <p className="text-[11px] text-center leading-relaxed text-muted-foreground/80">
              {t("studio.noSavedSketchesDesc", { count: sketches.length })}
            </p>
          </div>
        ) : (
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${thumbCols}, minmax(0, 1fr))` }}
          >
            {/* Already-arrived URLs from in-flight gens — provisional
                cards so the user sees each image land as soon as it's
                ready. Promoted to full SketchCards once the batch's
                finally block flushes them into `sketches` state. */}
            {arrivingItems.map((it) => (
              <ArrivingSketchCard
                key={`arriving:${it.url}`}
                url={it.url}
                aspectClass={aspect}
                onPreview={onPreview ? () => onPreview(previewUrl === it.url ? null : it.url) : undefined}
                isPreviewing={previewUrl === it.url}
              />
            ))}
            {/* Pending skeletons — always shown so the user can track
                in-flight batches even with the Saved filter on. */}
            {pendingSkeletons.map((sk) => (
              <SketchSkeleton key={sk.id} aspectClass={aspect} model={SKETCH_MODEL_LABELS[sk.model]} />
            ))}
            {/* Real sketches (filtered) */}
            {displaySketches.map((s) => (
              <SketchCard
                key={s.id}
                sketch={s}
                aspectClass={aspect}
                isPreviewing={previewUrl === s.url}
                onSetAsScene={() => handleSetAsScene(s)}
                onToggleLike={() => handleToggleLike(s.id)}
                onDelete={() => handleDelete(s.id)}
                onPreview={onPreview ? () => onPreview(previewUrl === s.url ? null : s.url) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Subcomponents ── */

/** Provisional card for URLs that have arrived from the generator but
 *  haven't been persisted into the committed `sketches` state yet. The
 *  only affordance is preview-on-click — like / delete / "Use as scene"
 *  need a stable sketch id which is only minted in the finally block.
 *  The card fades in so the skeleton → image swap reads as a continuous
 *  transition instead of a pop. */
function ArrivingSketchCard({
  url,
  aspectClass,
  onPreview,
  isPreviewing,
}: {
  url: string;
  aspectClass: string;
  onPreview?: () => void;
  isPreviewing?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden border cursor-pointer ${aspectClass}`}
      style={{
        borderColor: isPreviewing ? KR : "rgba(255,255,255,0.06)",
        boxShadow: isPreviewing ? `0 0 0 1px ${KR} inset` : undefined,
        animation: "sketchFadeIn 320ms ease-out",
      }}
      onClick={() => onPreview?.()}
    >
      <img
        src={url}
        className="w-full h-full object-cover"
        loading="lazy"
        decoding="async"
      />
      {/* PREVIEWING 배지는 제거 — isPreviewing 상태는 이미 카드 테두리의
          빨간 링(borderColor + inset boxShadow) 으로 충분히 표시된다. */}
      <style>{`
        @keyframes sketchFadeIn {
          0% { opacity: 0; transform: scale(0.98); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

function SketchSkeleton({ aspectClass, model }: { aspectClass: string; model?: string }) {
  return (
    <div
      className={`relative overflow-hidden border border-white/[0.06] ${aspectClass}`}
      style={{ background: "hsl(var(--muted))" }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)",
          animation: "sketchShimmer 1.4s infinite",
        }}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
        <Loader2 className="w-4 h-4 animate-spin" style={{ color: KR }} />
        {/* Per-skeleton model label so the user can tell which batch
            owns each placeholder when two models run together.
            We pass the canonical SKETCH_MODEL_LABELS string verbatim
            ("GPT Image 2", "Nano Banana 2", …) — no `uppercase` Tailwind
            class because the agreed product naming uses Title Case, and
            forcing all-caps here was producing "GPT IMAGE 2" / "NANO
            BANANA 2" in the gallery, which doesn't match the model
            picker pill / Settings page / docs. */}
        {model && (
          <span className="text-[10px] tracking-wide text-muted-foreground">
            {model}
          </span>
        )}
      </div>
      <style>{`
        @keyframes sketchShimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}

function SketchCard({
  sketch,
  aspectClass,
  isPreviewing,
  onSetAsScene,
  onToggleLike,
  onDelete,
  onPreview,
}: {
  sketch: Sketch;
  aspectClass: string;
  /** True when ContiStudio's canvas is currently swapped to this sketch.
   *  Card renders a persistent ring + label so the user always knows which
   *  sketch the canvas mirror is showing, even after the cursor leaves. */
  isPreviewing?: boolean;
  onSetAsScene: () => void;
  onToggleLike: () => void;
  onDelete: () => void;
  /** Clicking the image toggles the parent canvas preview to this sketch
   *  (click again to clear, click another sketch to switch). This is the
   *  ONLY preview affordance — there's no separate lightbox button, since
   *  the canvas swap covers the same need with less UI clutter. */
  onPreview?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const t = useT();
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`relative overflow-hidden border cursor-pointer ${aspectClass}`}
      style={{
        borderColor: isPreviewing ? KR : "rgba(255,255,255,0.06)",
        boxShadow: isPreviewing ? `0 0 0 1px ${KR} inset` : undefined,
      }}
      onClick={() => onPreview?.()}
    >
      <img
        src={sketch.url}
        className="w-full h-full object-cover"
        loading="lazy"
        decoding="async"
      />
      {/* Liked indicator (persists without hover) */}
      {sketch.liked && (
        <div
          className="absolute top-1.5 left-1.5 w-5 h-5 flex items-center justify-center rounded-full"
          style={{ background: KR }}
        >
          <Heart className="w-2.5 h-2.5 text-white" fill="#fff" />
        </div>
      )}
      {/* PREVIEWING 배지는 제거 — isPreviewing 상태는 이미 카드 테두리의
          빨간 링(borderColor + inset boxShadow) 으로 충분히 드러난다. */}
      {/* Hover overlay — like / delete on top, "Use" at bottom.
          The image click itself drives canvas preview, so we don't need
          a redundant Preview button here. Dim is intentionally light
          (30%) so the underlying composition stays inspectable while
          the action affordances are visible. */}
      {hover && (
        <div
          className="absolute inset-0 flex flex-col justify-between p-1.5 pointer-events-none"
          style={{ background: "rgba(0,0,0,0.30)" }}
        >
          <div className="flex items-center justify-between pointer-events-auto">
            <button
              onClick={(e) => { e.stopPropagation(); onToggleLike(); }}
              className="w-6 h-6 flex items-center justify-center rounded-full transition-colors"
              style={{ background: sketch.liked ? KR : "rgba(0,0,0,0.55)" }}
              title={sketch.liked ? t("studio.unlike") : t("studio.like")}
            >
              <Heart
                className="w-3 h-3 text-white"
                fill={sketch.liked ? "#fff" : "none"}
              />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="w-6 h-6 flex items-center justify-center rounded-full"
              style={{ background: "rgba(0,0,0,0.55)" }}
              title={t("common.delete")}
            >
              <Trash2 className="w-3 h-3 text-white" />
            </button>
          </div>
          <div className="flex flex-col gap-1 pointer-events-auto">
            {/* Compact CTA — stays readable at low column counts where
                "Set as scene image" used to wrap onto two lines. Tooltip
                preserves the long-form intent for first-time users. */}
            <button
              onClick={(e) => { e.stopPropagation(); onSetAsScene(); }}
              className="w-full flex items-center justify-center gap-1 h-6 text-[10.5px] font-semibold text-white rounded-none"
              style={{ background: KR }}
              title={t("studio.setAsSceneImage")}
            >
              <Check className="w-3 h-3" />
              {t("studio.use")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
