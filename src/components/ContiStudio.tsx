import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { deleteStoredFile } from "@/lib/storageUtils";
import {
  sanitizeImagePrompt,
  IMAGE_SIZE_MAP,
  generateConti,
  preflightCropToFormat,
  type VideoFormat,
  type BriefAnalysis,
  type GeneratingStage,
} from "@/lib/conti";
import { useToast } from "@/hooks/use-toast";
import {
  X,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Download,
  Loader2,
  Eye,
  Paintbrush,
  History,
  Columns2,
  Upload,
  RotateCcw,
  Eraser,
  Heart,
  PenLine,
  Undo2,
  Sparkles,
  Library,
  Film,
  ImageIcon,
  Youtube,
} from "lucide-react";
import { AnnotationEditor } from "@/components/conti/AnnotationEditor";
import { StudioSketchesTab } from "@/components/conti/StudioSketchesTab";
import type { Sketch } from "@/components/conti/contiTypes";
import { getReferencePreviewImageUrl, type ReferenceItem } from "@/lib/referenceLibrary";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import MentionInput from "@/components/MentionInput";
import { renderMessageWithMentions as renderMentions } from "@/lib/renderMentions";
import { useT } from "@/lib/uiLanguage";

/* ━━━━━ 타입 ━━━━━ */
interface Scene {
  id: string;
  project_id: string;
  scene_number: number;
  title: string | null;
  description: string | null;
  camera_angle: string | null;
  location: string | null;
  mood: string | null;
  tagged_assets: string[];
  duration_sec: number | null;
  conti_image_url: string | null;
  is_transition?: boolean;
  transition_type?: string | null;
  conti_image_crop?: unknown;
  is_highlight?: boolean;
  highlight_kind?: "hook" | "hero" | "product" | "emotion" | "cta" | null;
  highlight_reason?: string | null;
  /** Per-scene composition candidates generated in the Sketches tab.
   *  Lives on the scene row so deleting the scene cascades the sketches. */
  sketches?: Sketch[];
}
interface Asset {
  id?: string;
  tag_name: string;
  photo_url: string | null;
  ai_description: string | null;
  outfit_description: string | null;
  role_description: string | null;
  signature_items: string | null;
  space_description: string | null;
  asset_type: string;
}
interface SceneVersion {
  id: string;
  project_id: string;
  version_number: number;
  version_name: string | null;
  scenes: any[];
  created_at: string;
  is_active: boolean;
  display_order: number;
}
export interface ContiStudioProps {
  scene: Scene;
  allScenes: Scene[];
  assets: Asset[];
  versions: SceneVersion[];
  activeVersionId: string | null;
  videoFormat: VideoFormat;
  imageHistory: string[] | Record<number, string[]>;
  briefAnalysis?: BriefAnalysis | null;
  styleAnchor?: string;
  styleImageUrl?: string;
  moodReferenceUrl?: string;
  moodImages?: string[];
  moodBookmarks?: string[];
  /** Library references attached to the project's Conti track. The Compare
   *  panel renders these in their own "Library" section with kind-aware
   *  thumbnails — animated raster (gif / animated webp / apng) gets a static
   *  MEDIA placeholder, video gets its poster, etc. — instead of being
   *  squashed into bare URLs in `moodImages`. */
  libraryReferences?: ReferenceItem[];
  /** Opens the parent's Library picker. Wired into the Compare panel's
   *  "Library" section header so the user can attach more references
   *  without leaving the Studio. */
  onOpenLibraryPicker?: () => void;
  initialTab?: TabId;
  onClose: () => void;
  onSaveInpaint: (url: string, scene?: Scene) => void;
  onRollback: (url: string, scene?: Scene) => void;
  onDeleteHistory?: (url: string, scene?: Scene) => Promise<void> | void;
  onEditGeneratingChange?: (sceneId: string, generating: boolean) => void;
  onStageChange?: (sceneId: string, stage: GeneratingStage | null) => void;
  /** Notified by StudioSketchesTab whenever the persisted sketch list for
   *  the current scene changes. ContiTab uses this to keep `activeScenes`
   *  (and therefore the SortableContiCard sketch-count badge + the next
   *  Studio-open's `scene.sketches` prop) in sync with the DB.
   *
   *  Receives a functional updater (not a final array) so the parent can
   *  apply it against the freshest snapshot in its own state — see the
   *  long comment in StudioSketchesTab for the concurrent-batch race this
   *  shape avoids. */
  onSketchesUpdated?: (sceneId: string, updater: (current: Sketch[]) => Sketch[]) => void;
  isRegenerating?: boolean;
}

/* ━━━━━ 상수 ━━━━━ */
const KR = "#f9423a";
const TYPE_LABEL: Record<string, string> = { character: "캐릭터", item: "아이템", background: "배경" };
export type TabId = "view" | "editor" | "edit" | "sketches" | "history" | "compare";
const TABS: { id: TabId; labelKey: string; icon: typeof Eye }[] = [
  { id: "view", labelKey: "studio.view", icon: Eye },
  { id: "editor", labelKey: "studio.editor", icon: PenLine },
  { id: "edit", labelKey: "studio.inpaint", icon: Paintbrush },
  { id: "sketches", labelKey: "studio.sketches", icon: Sparkles },
  { id: "history", labelKey: "studio.history", icon: History },
  { id: "compare", labelKey: "studio.compare", icon: Columns2 },
];
const ASPECT_CLASS: Record<VideoFormat, string> = {
  vertical: "aspect-[9/16]",
  horizontal: "aspect-video",
  square: "aspect-square",
};
// Numeric counterpart of ASPECT_CLASS for imperative sizing of the image
// stage. Must stay 1:1 with SortableContiCard's FORMAT_RATIO so a scene
// "looks the same size" whether the user is staring at the Conti grid
// card or at the Studio viewport.
const FORMAT_RATIO: Record<VideoFormat, number> = {
  horizontal: 16 / 9,
  vertical: 9 / 16,
  square: 1,
};
const MAX_INPAINT_UNDO = 20;
const formatSceneRefLabel = (scene: Pick<Scene, "scene_number" | "is_transition" | "transition_type">) =>
  scene.is_transition || scene.transition_type ? "TR" : `#${String(scene.scene_number).padStart(2, "0")}`;
const PLAYABLE_MEDIA_URL_RE = /\.(gif|apng|mp4|webm|mov|m4v)(?:[?#].*)?$/i;
const isPlayableMediaUrl = (url: string | null | undefined): boolean => {
  if (!url) return false;
  return PLAYABLE_MEDIA_URL_RE.test(url.split("?")[0] ?? url);
};

const MediaPlaceholder = ({ className = "" }: { className?: string }) => (
  <div className={`flex flex-col items-center justify-center gap-2 bg-black/70 text-white/65 ${className}`}>
    <Columns2 className="h-5 w-5" />
    <span className="font-mono text-[10px]">MEDIA</span>
  </div>
);

/* ━━━ 원본 이미지 비율 보존 imageSize 계산 ━━━
 * 실제 W/H 비율로 GPT/NB2가 지원하는 3가지 크기 중 가장 가까운 것을 선택.
 * 비표준 크기(1536x1536 등)를 반환하지 않아 GPT API 오류 방지.
 */
function computeImageSizeFromDimensions(w: number, h: number): string {
  const ratio = w / h;
  if (ratio >= 1.4) return "1536x1024"; // 16:9 가로
  if (ratio <= 0.75) return "1024x1536"; // 9:16 세로
  return "1024x1024"; // 정사각형 계열
}

/* ━━━━━ ContiStudio ━━━━━ */
export const ContiStudio = ({
  scene: initialScene,
  allScenes,
  assets,
  versions,
  activeVersionId,
  videoFormat,
  imageHistory,
  briefAnalysis,
  styleAnchor,
  styleImageUrl,
  moodReferenceUrl,
  moodImages,
  moodBookmarks,
  libraryReferences,
  onOpenLibraryPicker,
  initialTab,
  onClose,
  onSaveInpaint,
  onRollback,
  onDeleteHistory,
  onEditGeneratingChange,
  onSketchesUpdated,
  onStageChange,
  isRegenerating: externalRegenerating,
}: ContiStudioProps) => {
  const { toast } = useToast();
  const t = useT();

  const [currentIndex, setCurrentIndex] = useState(() => Math.max(0, allScenes.findIndex((s) => s.id === initialScene.id)));
  const currentScene = allScenes[currentIndex] ?? initialScene;
  const currentSceneIdRef = useRef(currentScene.id);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < allScenes.length - 1;

  const currentImageHistory: string[] = Array.isArray(imageHistory)
    ? imageHistory
    : (imageHistory[currentScene.scene_number] ?? []);

  const [activeTab, setActiveTab] = useState<TabId>(initialTab ?? "view");

  useEffect(() => {
    const nextIndex = allScenes.findIndex((s) => s.id === currentSceneIdRef.current);
    if (nextIndex >= 0 && nextIndex !== currentIndex) {
      setCurrentIndex(nextIndex);
    }
  }, [allScenes, currentIndex]);

  const goToIndex = useCallback(
    (next: number | ((prev: number) => number)) => {
      setCurrentIndex((prev) => {
        if (allScenes.length === 0) return prev;
        const raw = typeof next === "function" ? next(prev) : next;
        const clamped = Math.max(0, Math.min(allScenes.length - 1, raw));
        currentSceneIdRef.current = allScenes[clamped]?.id ?? currentSceneIdRef.current;
        return clamped;
      });
    },
    [allScenes],
  );

  /* ── 캔버스 refs ── */
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null);
  const eventDivRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /* ── inpaint preflight 소스 URL ──
   * style transfer 와 동일하게, inpaint 전에 원본 씬 이미지를 프리뷰 비율
   * (= FORMAT_RATIO[videoFormat])로 잘라 Supabase 에 업로드하고, 그 URL 을
   * 여기 저장해둔다. handleInpaint 는 이 URL 을 원본으로 사용해 NB2 에게
   * 프리뷰와 정확히 같은 비율·프레이밍의 source 를 넘긴다.
   *
   * GPT(1:1/2:3/3:2 등)와 NB2(9:16/16:9/1:1) 의 지원 비율이 다르기 때문에,
   * 원본 GPT 이미지를 그대로 NB2 inpaint 에 주면 결과물이 강제로 NB2 비율로
   * 리샘플되며 찌그러진다. 프리뷰 비율로 사전-크롭 해두면 입력/출력 비율이
   * 같아 더 이상 찌그러지지 않는다. */
  const preflightSourceUrlRef = useRef<string | null>(null);
  const preflightedSceneImageUrlRef = useRef<string | null>(null);

  /* ── 드로잉 상태 ──
   * brushSize 는 이제 "이미지 픽셀 기준 반지름" (해상도 독립).
   * 화면 표시 픽셀 = brushSize × (eventDiv 폭 / 이미지 폭). drawCursorAt 에서 환산.
   */
  const isDrawingRef = useRef(false);
  const BRUSH_MIN = 4;
  const BRUSH_MAX = 200;
  const BRUSH_DEFAULT = 40;
  const [brushSize, setBrushSize] = useState(BRUSH_DEFAULT);
  const brushSizeRef = useRef(BRUSH_DEFAULT);

  /* brush strength — 0~100%
   * 100% = 마스크 안 100% 모델 출력으로 교체 (기존 동작과 동일)
   * 50%  = 마스크 안 = 원본 50% + 모델 50% 블렌드 → "살짝만 수정"
   * NB2 에 보내는 마스크도 grayscale 로 attenuate 해서 모델이 "약한 개입" 신호를 받음.
   */
  const STRENGTH_MIN = 10;
  const STRENGTH_MAX = 100;
  const STRENGTH_DEFAULT = 85;
  const [brushStrength, setBrushStrength] = useState(STRENGTH_DEFAULT);
  const brushStrengthRef = useRef(STRENGTH_DEFAULT);
  useEffect(() => {
    brushStrengthRef.current = brushStrength;
  }, [brushStrength]);
  const toolModeRef = useRef<"brush" | "eraser">("brush");
  const [toolMode, setToolMode] = useState<"brush" | "eraser">("brush");

  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    brushSizeRef.current = brushSize;
  }, [brushSize]);
  useEffect(() => {
    toolModeRef.current = toolMode;
  }, [toolMode]);

  /* ── Undo 스택 (메모리 최적화) ──
   * 풀 ImageData 대신 R-채널 1바이트씩만 저장 (4바이트 → 1바이트, 75% 절감).
   * 오버레이는 마스크에서 결정론적이므로 저장하지 않고 undo 시점에 재구성.
   * 1536x1024 이미지 기준: 기존 ~12MB/snap × 20 = ~250MB → ~1.6MB × 20 = ~32MB.
   */
  type InpaintSnap = { mask: Uint8Array; w: number; h: number };
  const inpaintUndoRef = useRef<InpaintSnap[]>([]);
  const [inpaintUndoCount, setInpaintUndoCount] = useState(0);

  /* ── 직전 페인트 좌표 (이미지 좌표계) — 빠른 드래그 보간용 ── */
  const lastPaintPtRef = useRef<{ x: number; y: number } | null>(null);
  const hasMaskRef = useRef(false);

  /* ── 줌/팬 상태 ──
   * viewport(고정) 안에서 canvasContainer 를 transform: translate+scale 로 변환.
   * paintAt 은 eventDiv.getBoundingClientRect() 의 post-transform 크기를 사용하므로
   *   x_image = clientX_local × (image.width / rect.width)
   * 비율이 그대로 유지돼 줌/팬과 무관하게 정확히 동작.
   */
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 8;
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const isSpaceDownRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ clientX: number; clientY: number; px: number; py: number } | null>(null);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // 새 이미지 로드 시 줌/팬 리셋
  useEffect(() => {
    resetZoom();
  }, [currentScene.conti_image_url, resetZoom]);

  /* ── 인페인팅 상태 ── */
  const [inpaintPrompt, setInpaintPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasMask, setHasMask] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const inpaintInputRef = useRef<HTMLTextAreaElement>(null);

  /* ── 레퍼런스 ── */
  const [selectedSceneRefs, setSelectedSceneRefs] = useState<
    { id: string; scene_number: number; title: string | null; conti_image_url: string }[]
  >([]);
  const [customRefImages, setCustomRefImages] = useState<{ preview: string; file: File }[]>([]);
  const [useMoodRef, setUseMoodRef] = useState(true);
  const customRefInputRef = useRef<HTMLInputElement>(null);

  const [isLocalRegenerating, setIsLocalRegenerating] = useState(false);
  const isRegenerating = externalRegenerating || isLocalRegenerating;

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [deletingHistoryUrl, setDeletingHistoryUrl] = useState<string | null>(null);

  const [compareSelectedRefs, setCompareSelectedRefs] = useState<string[]>([]);
  const [comparePreviewUrl, setComparePreviewUrl] = useState<string | null>(null);
  // URLs whose underlying file is missing from storage (e.g. the matching
  // mood image got deleted while the parent state hadn't refreshed yet).
  // Filtering them out prevents the Compare panel from rendering a broken
  // image-X icon for already-orphaned references.
  const [brokenMoodUrls, setBrokenMoodUrls] = useState<Set<string>>(new Set());
  const markMoodUrlBroken = useCallback((url: string) => {
    setBrokenMoodUrls((prev) => {
      if (prev.has(url)) return prev;
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  }, []);
  // Library thumbnails whose <img> failed to load. We keep these per-reference
  // (not per-URL) so a thumbnail-vs-file_url fallback can be retried inside
  // the same card before collapsing to the kind-glyph placeholder.
  const [brokenLibraryRefIds, setBrokenLibraryRefIds] = useState<Set<string>>(new Set());
  const markLibraryRefBroken = useCallback((refId: string) => {
    setBrokenLibraryRefIds((prev) => {
      if (prev.has(refId)) return prev;
      const next = new Set(prev);
      next.add(refId);
      return next;
    });
  }, []);

  /* ━━━ 키보드 ━━━ */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditing = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
      if (e.key === "Escape" && !isEditing) onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && activeTab === "edit") {
        e.preventDefault();
        handleUndoInpaint();
        return;
      }
      if (isEditing) return;

      // ── Inpaint 단축키 ──
      if (activeTab === "edit") {
        // Space → 임시 팬 모드 (drag-to-pan)
        if (e.code === "Space" && !isSpaceDownRef.current) {
          isSpaceDownRef.current = true;
          e.preventDefault();
          return;
        }
        // [ / ] : 브러시 크기 -/+ (이미지 픽셀)
        if (e.key === "[") {
          setBrushSize((v) => Math.max(BRUSH_MIN, Math.round(v / 1.15)));
          e.preventDefault();
          return;
        }
        if (e.key === "]") {
          setBrushSize((v) => Math.min(BRUSH_MAX, Math.round(v * 1.15) || v + 1));
          e.preventDefault();
          return;
        }
        // B / E : 도구 전환
        if (e.key === "b" || e.key === "B") {
          setToolMode("brush");
          e.preventDefault();
          return;
        }
        if (e.key === "e" || e.key === "E") {
          setToolMode("eraser");
          e.preventDefault();
          return;
        }
        // Shift + [ / ] : 브러시 강도 -/+
        if (e.shiftKey && (e.key === "{" || e.key === "[")) {
          setBrushStrength((v) => Math.max(STRENGTH_MIN, v - 5));
          e.preventDefault();
          return;
        }
        if (e.shiftKey && (e.key === "}" || e.key === "]")) {
          setBrushStrength((v) => Math.min(STRENGTH_MAX, v + 5));
          e.preventDefault();
          return;
        }
        // 0 : 줌 리셋
        if (e.key === "0") {
          resetZoom();
          e.preventDefault();
          return;
        }
      }

      if (e.key === "ArrowLeft" && hasPrev) goToIndex((i) => i - 1);
      if (e.key === "ArrowRight" && hasNext) goToIndex((i) => i + 1);
    };
    const upHandler = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        isSpaceDownRef.current = false;
      }
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("keyup", upHandler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keyup", upHandler);
    };
  }, [onClose, hasPrev, hasNext, activeTab, resetZoom, goToIndex]);

  const otherScenes = allScenes.filter((s) => s.id !== currentScene.id && s.conti_image_url) as (Scene & {
    conti_image_url: string;
  })[];

  const insertPromptTagAtCursor = useCallback((tag: string, allowDuplicate = true) => {
    setInpaintPrompt((prev) => {
      if (!allowDuplicate && prev.includes(tag)) return prev;
      const textarea = inpaintInputRef.current;
      const start = textarea?.selectionStart ?? prev.length;
      const end = textarea?.selectionEnd ?? prev.length;
      const needsLeadingSpace = start > 0 && !/\s/.test(prev[start - 1] ?? "");
      const needsTrailingSpace = end >= prev.length || !/\s/.test(prev[end] ?? "");
      const insertion = `${needsLeadingSpace ? " " : ""}${tag}${needsTrailingSpace ? " " : ""}`;
      const nextValue = `${prev.slice(0, start)}${insertion}${prev.slice(end)}`;
      const nextCursor = start + insertion.length;
      requestAnimationFrame(() => {
        const t = inpaintInputRef.current;
        if (!t) return;
        t.focus();
        t.setSelectionRange(nextCursor, nextCursor);
      });
      return nextValue;
    });
  }, []);

  const removePromptTag = useCallback((tag: string) => {
    setInpaintPrompt((prev) =>
      prev.split(`${tag} `).join("").split(` ${tag}`).join("").split(tag).join("").replace(/ {2,}/g, " "),
    );
  }, []);

  const isFileDrag = (dt: DataTransfer | null) => !!dt && Array.from(dt.types).includes("Files");

  /* ━━━ 이미지 stage 크기 계산 ━━━
   *
   * 핵심: stage 크기는 (container 크기 × 프로젝트 videoFormat 비율) 의 함수다.
   * 이미지의 naturalSize 나 activeTab 에 의존하지 않는다. 예전에는 매 탭 전환마다
   * 이미지의 natural aspect 로 scale 을 다시 계산했기 때문에:
   *   · 16:9 프로젝트에서 natural aspect 가 format 과 0.5% 만 달라도
   *     탭 이동마다 캔버스가 미세하게 흔들렸고
   *   · Inpaint 탭은 preflightCrop 으로 format-ratio 로 맞춰진 이미지를 쓰고
   *     View 탭은 원본을 쓰는 탓에 두 탭의 stage 크기가 서로 달라 보였다.
   * ResizeObserver 로 container 크기 변화만 따라가면 탭 전환과 무관하게
   * stage 크기가 고정된다. */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ratio = FORMAT_RATIO[videoFormat] ?? 16 / 9;
    const recompute = () => {
      // p-6 (24px) 패딩은 content box 밖. 실제 그림이 차지할 수 있는 영역은
      // clientWidth/Height 에서 패딩을 빼야 맞다. 예전 로직은 이 뺄셈이 없어서
      // stage 가 미세하게 padding 위로 번졌다.
      const cw = Math.max(0, el.clientWidth - 48);
      const ch = Math.max(0, el.clientHeight - 48);
      if (cw <= 0 || ch <= 0) return;
      let w = cw;
      let h = cw / ratio;
      if (h > ch) {
        h = ch;
        w = ch * ratio;
      }
      setCanvasSize((prev) =>
        Math.abs(prev.w - w) < 0.5 && Math.abs(prev.h - h) < 0.5 ? prev : { w, h },
      );
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [videoFormat]);

  /* ━━━ 이미지 로드 (Inpaint 탭) ━━━
   * style transfer 와 동일하게, 인페인트도 씬 이미지를 프리뷰 비율로 사전-크롭한
   * 결과 위에서 수행한다. 즉 캔버스에 그려지는 이미지부터가 "프리뷰에 보이는
   * 그 영역"이며, 사용자가 그리는 마스크도 최종 결과와 1:1 로 정렬된다.
   * 크롭된 이미지는 Supabase 에 업로드되어 handleInpaint 가 NB2 에게 넘길
   * sourceImageUrl 로 재사용된다. */
  useEffect(() => {
    if (activeTab !== "edit" || !currentScene.conti_image_url) return;
    setImageLoaded(false);
    setImageError(false);
    isDrawingRef.current = false;
    inpaintUndoRef.current = [];
    setInpaintUndoCount(0);
    setHasMask(false);
    hasMaskRef.current = false;
    lastPaintPtRef.current = null;

    // 씬 이미지 URL 이 바뀌었으면 기존 preflight 캐시 무효화.
    if (preflightedSceneImageUrlRef.current !== currentScene.conti_image_url) {
      preflightSourceUrlRef.current = null;
      preflightedSceneImageUrlRef.current = null;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const sourceUrl = currentScene.conti_image_url!;

        // 1) 프리뷰 비율로 사전-크롭 (실패하면 원본으로 폴백).
        let loadUrl = sourceUrl;
        let objectUrl: string | null = null;
        try {
          const { blob, publicUrl } = await preflightCropToFormat(
            sourceUrl,
            currentScene.conti_image_crop,
            videoFormat,
            currentScene.project_id,
            currentScene.scene_number,
            "inpaint-src",
          );
          if (cancelled) return;
          preflightSourceUrlRef.current = publicUrl;
          preflightedSceneImageUrlRef.current = sourceUrl;
          objectUrl = URL.createObjectURL(blob);
          loadUrl = objectUrl;
          console.log("[Inpaint] preflight crop 완료", { preflightSourceUrl: publicUrl });
        } catch (preflightErr) {
          console.warn("[Inpaint] preflight crop 실패 — 원본 이미지로 진행", preflightErr);
          preflightSourceUrlRef.current = null;
          preflightedSceneImageUrlRef.current = null;
          const res = await fetch(sourceUrl);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          objectUrl = URL.createObjectURL(blob);
          loadUrl = objectUrl;
        }

        const img = new Image();
        img.onload = () => {
          if (cancelled) {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            return;
          }
          const ic = imageCanvasRef.current;
          const mc = maskCanvasRef.current;
          const oc = overlayCanvasRef.current;
          if (!ic || !mc) return;
          ic.width = img.naturalWidth;
          ic.height = img.naturalHeight;
          mc.width = img.naturalWidth;
          mc.height = img.naturalHeight;
          if (oc) {
            oc.width = img.naturalWidth;
            oc.height = img.naturalHeight;
          }
          ic.getContext("2d")!.drawImage(img, 0, 0);
          mc.getContext("2d")!.clearRect(0, 0, mc.width, mc.height);
          if (oc) oc.getContext("2d")!.clearRect(0, 0, oc.width, oc.height);
          // canvasSize 는 format-ratio 기반 ResizeObserver 훅에서 전역적으로
          // 관리한다. 예전엔 이미지 naturalSize 로 다시 계산해서 탭마다 값이
          // 튀었는데, 지금은 이곳이 stage 크기를 건드리지 않게 비워둔다.
          setImageLoaded(true);
          if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
        img.onerror = () => {
          setImageError(true);
          if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
        img.src = loadUrl;
      } catch {
        setImageError(true);
      }
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    activeTab,
    currentScene.conti_image_url,
    currentScene.conti_image_crop,
    currentScene.project_id,
    currentScene.scene_number,
    videoFormat,
  ]);

  /* ━━━ Undo 스냅샷 (alpha-채널 1바이트 압축)
   * soft 브러시의 알파 그라디언트를 보존하기 위해 R 대신 alpha 채널 저장.
   * mask canvas 는 항상 white(R=G=B=255)라 alpha 만 있으면 완전 복원 가능.
   */
  const saveInpaintSnapshot = useCallback(() => {
    const mc = maskCanvasRef.current;
    if (!mc || !mc.width) return;
    const id = mc.getContext("2d")!.getImageData(0, 0, mc.width, mc.height);
    const a = new Uint8Array(mc.width * mc.height);
    for (let i = 3, j = 0; i < id.data.length; i += 4, j++) a[j] = id.data[i];
    inpaintUndoRef.current = [
      ...inpaintUndoRef.current.slice(-(MAX_INPAINT_UNDO - 1)),
      { mask: a, w: mc.width, h: mc.height },
    ];
    setInpaintUndoCount(inpaintUndoRef.current.length);
  }, []);

  /** alpha-채널 배열에서 마스크 + 오버레이를 결정론적으로 재구성 */
  const restoreFromSnapshot = (snap: InpaintSnap) => {
    const mc = maskCanvasRef.current;
    const oc = overlayCanvasRef.current;
    if (!mc) return false;
    if (mc.width !== snap.w || mc.height !== snap.h) {
      mc.width = snap.w;
      mc.height = snap.h;
    }
    const mctx = mc.getContext("2d")!;
    const mid = mctx.createImageData(snap.w, snap.h);
    let hasAny = false;
    for (let j = 0, i = 0; j < snap.mask.length; j++, i += 4) {
      const a = snap.mask[j];
      if (a > 0) hasAny = true;
      // mask canvas 는 항상 white + alpha 변조
      mid.data[i] = 255;
      mid.data[i + 1] = 255;
      mid.data[i + 2] = 255;
      mid.data[i + 3] = a;
    }
    mctx.putImageData(mid, 0, 0);

    if (oc) {
      if (oc.width !== snap.w || oc.height !== snap.h) {
        oc.width = snap.w;
        oc.height = snap.h;
      }
      const octx = oc.getContext("2d")!;
      const oid = octx.createImageData(snap.w, snap.h);
      // 브러시 색(빨강) × 마스크 alpha 비율 0.85
      for (let j = 0, i = 0; j < snap.mask.length; j++, i += 4) {
        const a = snap.mask[j];
        if (a > 0) {
          oid.data[i] = 249;
          oid.data[i + 1] = 66;
          oid.data[i + 2] = 58;
          oid.data[i + 3] = Math.round((a / 255) * 217); // 0.85 × 255
        }
      }
      octx.putImageData(oid, 0, 0);
    }
    return hasAny;
  };

  const handleUndoInpaint = () => {
    if (inpaintUndoRef.current.length === 0) return;
    const snap = inpaintUndoRef.current[inpaintUndoRef.current.length - 1];
    inpaintUndoRef.current = inpaintUndoRef.current.slice(0, -1);
    setInpaintUndoCount(inpaintUndoRef.current.length);
    const hasAny = restoreFromSnapshot(snap);
    hasMaskRef.current = hasAny;
    setHasMask(hasAny);
    lastPaintPtRef.current = null;
  };

  /* ━━━ 소프트 엣지 스탬프 브러시 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * - radialGradient 로 중심=1 → feather 시작점까지 유지 → 반지름=0 으로 감쇠
   * - 세그먼트는 촘촘한 스탬프로 구현 (lineWidth 스트로크는 feather 를 지원하지 않음)
   * - BRUSH_FEATHER = 0.25 → 반지름의 75% 까지 solid, 나머지 25% 에서 soft fade
   */
  const BRUSH_FEATHER = 0.25;

  /** 색상 문자열에서 rgba 성분 추출 (rgb/rgba 둘 다 지원). */
  const parseRgba = (c: string): [number, number, number, number] => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return [255, 255, 255, 1];
    const parts = m[1].split(/\s*,\s*/);
    const r = Number(parts[0]) || 0;
    const g = Number(parts[1]) || 0;
    const b = Number(parts[2]) || 0;
    const a = parts[3] !== undefined ? Number(parts[3]) : 1;
    return [r, g, b, a];
  };

  /** 한 점에 soft-edge 스탬프 찍기 */
  const drawDot = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    composite: GlobalCompositeOperation,
    fill: string,
  ) => {
    if (r < 0.5) return;
    ctx.save();
    ctx.globalCompositeOperation = composite;
    const [cr, cg, cb, ca] = parseRgba(fill);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    const solidStop = Math.max(0, Math.min(1, 1 - BRUSH_FEATHER));
    grad.addColorStop(0, `rgba(${cr},${cg},${cb},${ca})`);
    grad.addColorStop(solidStop, `rgba(${cr},${cg},${cb},${ca})`);
    grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  /** 두 점을 soft-edge 스탬프 열로 연결 (스탬핑) */
  const drawSegment = (
    ctx: CanvasRenderingContext2D,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    r: number,
    composite: GlobalCompositeOperation,
    stroke: string,
  ) => {
    if (r < 0.5) return;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dist = Math.hypot(dx, dy);
    // 스탬프 간격: 반지름의 20% — 소프트 엣지가 겹쳐서 스트로크 내부는 꽉 차고 외곽만 페더됨
    const step = Math.max(1, r * 0.2);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      drawDot(ctx, fromX + dx * t, fromY + dy * t, r, composite, stroke);
    }
  };

  /**
   * 한 포인터 샘플을 마스크에 반영.
   * 직전 좌표가 있으면 스탬프 열로, 없으면 단발 dot 을 찍는다.
   * pressure 는 반지름에만 변조 적용 (마우스는 고정 1.0).
   */
  const paintAt = useCallback(
    (cx: number, cy: number, divW: number, divH: number, pressure: number = 1, pointerType = "mouse") => {
      const mc = maskCanvasRef.current;
      const oc = overlayCanvasRef.current;
      if (!mc || !mc.width || !mc.height || divW <= 0 || divH <= 0) return;

      const x = cx * (mc.width / divW);
      const y = cy * (mc.height / divH);
      // pressure 반경 변조: 마우스는 1.0 고정, 스타일러스/터치만 0.35~1.0 범위
      const pfactor = pointerType === "mouse" ? 1 : 0.35 + 0.65 * Math.max(0, Math.min(1, pressure));
      const r = brushSizeRef.current * pfactor;

      const isErase = toolModeRef.current === "eraser";
      const composite: GlobalCompositeOperation = isErase ? "destination-out" : "source-over";
      // 마스크 자체는 항상 alpha=1 (사용자에게 브러시가 또렷이 보이도록).
      // strength 는 extract 단계에서 알파를 스케일해서 적용 (시각 피드백과 분리).
      const maskColor = "rgba(255,255,255,1)";
      const overlayColor = isErase ? "rgba(0,0,0,1)" : "rgba(249,66,58,0.85)";

      const mctx = mc.getContext("2d")!;
      const octx = oc?.getContext("2d") ?? null;
      const prev = lastPaintPtRef.current;

      if (prev) {
        drawSegment(mctx, prev.x, prev.y, x, y, r, composite, maskColor);
        if (octx) drawSegment(octx, prev.x, prev.y, x, y, r, composite, overlayColor);
      } else {
        drawDot(mctx, x, y, r, composite, maskColor);
        if (octx) drawDot(octx, x, y, r, composite, overlayColor);
      }

      lastPaintPtRef.current = { x, y };
      if (!isErase && !hasMaskRef.current) {
        hasMaskRef.current = true;
        setHasMask(true);
      }
    },
    [],
  );

  const drawCursorAt = useCallback((clientX: number, clientY: number) => {
    const cc = cursorCanvasRef.current;
    const div = eventDivRef.current;
    const ic = imageCanvasRef.current;
    if (!cc || !div) return;
    const rect = div.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (cc.width !== Math.round(rect.width) || cc.height !== Math.round(rect.height)) {
      cc.width = Math.round(rect.width);
      cc.height = Math.round(rect.height);
    }
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    // 화면 표시 반지름 = (이미지px 반지름) × (eventDiv visual폭 / 이미지 폭)
    // 줌 시에도 brush 가 시각적으로 제대로 커지고 작아짐.
    const scale = ic && ic.width > 0 ? rect.width / ic.width : 1;
    const screenR = Math.max(1.5, brushSizeRef.current * scale);
    const ctx = cc.getContext("2d")!;
    ctx.clearRect(0, 0, cc.width, cc.height);
    ctx.beginPath();
    ctx.arc(x, y, screenR, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, screenR, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }, []);

  const clearCursor = useCallback(() => {
    const cc = cursorCanvasRef.current;
    if (!cc) return;
    cc.getContext("2d")?.clearRect(0, 0, cc.width, cc.height);
  }, []);

  /**
   * Pointer Events 통합 핸들러 — 마우스/펜/터치 모두 처리.
   * `getCoalescedEvents()` 로 OS 가 한 프레임에 모은 모든 입력 샘플을 받아 보간에 사용,
   * 빠른 모션에서도 마스크가 끊기지 않도록 보장.
   */
  /* ── 팬 동작 ── */
  const startPan = (clientX: number, clientY: number) => {
    isPanningRef.current = true;
    panStartRef.current = { clientX, clientY, px: panRef.current.x, py: panRef.current.y };
    clearCursor();
  };
  const movePan = (clientX: number, clientY: number) => {
    const s = panStartRef.current;
    if (!s) return;
    setPan({ x: s.px + (clientX - s.clientX), y: s.py + (clientY - s.clientY) });
  };
  const endPan = () => {
    isPanningRef.current = false;
    panStartRef.current = null;
  };

  const handleDrawPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isGenerating) return;
      // 팬 트리거: 중간버튼(button===1) 또는 space 누른 채 좌클릭
      if (e.button === 1 || (e.button === 0 && isSpaceDownRef.current)) {
        e.preventDefault();
        const div = e.currentTarget;
        try {
          div.setPointerCapture(e.pointerId);
        } catch {}
        startPan(e.clientX, e.clientY);
        return;
      }
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      const div = e.currentTarget;
      try {
        div.setPointerCapture(e.pointerId);
      } catch {}

      saveInpaintSnapshot();
      isDrawingRef.current = true;
      lastPaintPtRef.current = null;

      const rect = div.getBoundingClientRect();
      drawCursorAt(e.clientX, e.clientY);
      paintAt(
        e.clientX - rect.left,
        e.clientY - rect.top,
        rect.width,
        rect.height,
        e.pressure,
        e.pointerType,
      );
    },
    [isGenerating, paintAt, drawCursorAt, saveInpaintSnapshot],
  );

  const handleDrawPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isPanningRef.current) {
        movePan(e.clientX, e.clientY);
        return;
      }
      const div = e.currentTarget;
      if (!isDrawingRef.current) {
        drawCursorAt(e.clientX, e.clientY);
        return;
      }
      const rect = div.getBoundingClientRect();
      const pointerType = e.pointerType;
      // OS 가 한 프레임에 모은 모든 중간 샘플들 — 빠른 드래그에서 점이 끊기지 않게 함
      const samples =
        typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
      if (samples.length > 0) {
        for (const s of samples) {
          paintAt(
            s.clientX - rect.left,
            s.clientY - rect.top,
            rect.width,
            rect.height,
            (s as PointerEvent).pressure ?? e.pressure,
            pointerType,
          );
        }
      } else {
        paintAt(
          e.clientX - rect.left,
          e.clientY - rect.top,
          rect.width,
          rect.height,
          e.pressure,
          pointerType,
        );
      }
      drawCursorAt(e.clientX, e.clientY);
    },
    [paintAt, drawCursorAt],
  );

  const handleDrawPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const div = e.currentTarget;
      try {
        div.releasePointerCapture(e.pointerId);
      } catch {}
      if (isPanningRef.current) {
        endPan();
        return;
      }
      isDrawingRef.current = false;
      lastPaintPtRef.current = null;
    },
    [],
  );

  const handleDrawPointerLeave = useCallback(() => {
    if (!isDrawingRef.current && !isPanningRef.current) clearCursor();
  }, [clearCursor]);

  /* ── 휠 줌 (커서 위치 기준) ──
   * React onWheel 은 passive 라 preventDefault 가 안 통하므로
   * native addEventListener({passive:false}) 로 직접 등록.
   */
  useEffect(() => {
    if (activeTab !== "edit") return;
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      const mx = e.clientX - r.left - r.width / 2;
      const my = e.clientY - r.top - r.height / 2;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const oldZoom = zoomRef.current;
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, oldZoom * factor));
      if (newZoom === oldZoom) return;
      const k = newZoom / oldZoom;
      const newPan = {
        x: mx - (mx - panRef.current.x) * k,
        y: my - (my - panRef.current.y) * k,
      };
      setZoom(newZoom);
      setPan(newPan);
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [activeTab, imageLoaded]);

  /* ━━━ Reset ━━━ */
  const handleResetMask = () => {
    const mc = maskCanvasRef.current;
    if (mc) mc.getContext("2d")!.clearRect(0, 0, mc.width, mc.height);
    const oc = overlayCanvasRef.current;
    if (oc) oc.getContext("2d")!.clearRect(0, 0, oc.width, oc.height);
    setHasMask(false);
    hasMaskRef.current = false;
    lastPaintPtRef.current = null;
    inpaintUndoRef.current = [];
    setInpaintUndoCount(0);
  };

  /* ━━━ 마스크 유틸 (페더링 / 합성) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 페더링: 경계의 alpha 가 부드럽게 떨어지는 soft mask 를 만들어 합성 솔기를 제거.
   * 합성  : 원본 + 모델출력 + soft mask → 마스크 밖 픽셀이 100% 원본으로 보장됨.
   *         (NB2 같은 generative 모델이 unmasked 영역까지 다시 렌더해도 영향 없음)
   * ── feather 픽셀은 이미지 짧은 변의 ~0.5% 로 자동 스케일.
   */
  const FEATHER_FRACTION = 0.005;

  const featherPxFor = (w: number, h: number) =>
    Math.max(2, Math.round(Math.min(w, h) * FEATHER_FRACTION));

  /**
   * mask canvas → 동일 해상도의 white-on-transparent 캔버스.
   * 브러시가 이미 soft 엣지(alpha 그라디언트)로 칠하므로 alpha 값을 그대로 보존.
   * strength 는 최대 alpha 를 스케일 → 50%면 mask 중심도 0.5 로 제한 → 합성 시 원본 50% 유지.
   */
  const buildSoftMaskCanvas = (
    mc: HTMLCanvasElement,
    targetW: number,
    targetH: number,
    featherPx: number,
    strength01: number = 1,
  ): HTMLCanvasElement => {
    const src = mc.getContext("2d")!.getImageData(0, 0, mc.width, mc.height);
    const tmp = document.createElement("canvas");
    tmp.width = mc.width;
    tmp.height = mc.height;
    const tctx = tmp.getContext("2d")!;
    const tid = tctx.createImageData(mc.width, mc.height);
    const s = Math.max(0, Math.min(1, strength01));
    for (let i = 0; i < src.data.length; i += 4) {
      // mask canvas 는 "쓰여짐 = 알파" 방식. R/G/B 는 항상 255 이므로 alpha 만 읽음.
      const a = Math.round(src.data[i + 3] * s);
      tid.data[i] = 255;
      tid.data[i + 1] = 255;
      tid.data[i + 2] = 255;
      tid.data[i + 3] = a;
    }
    tctx.putImageData(tid, 0, 0);

    const out = document.createElement("canvas");
    out.width = targetW;
    out.height = targetH;
    const octx = out.getContext("2d")!;
    // 경계 솔기 제거용 추가 블러 (브러시 자체 feather 와 합쳐서 자연스러움)
    if (featherPx > 0) {
      octx.filter = `blur(${featherPx}px)`;
    }
    octx.drawImage(tmp, 0, 0, targetW, targetH);
    octx.filter = "none";
    return out;
  };

  /**
   * 마스크 추출 (모델 전달용 PNG, base64) — GPT edits 폴백 경로용.
   * 브러시가 soft 엣지라 alpha 채널을 읽고, 임계(alpha > 32) 기준으로 painted 판정.
   */
  const extractMaskBase64 = (): string | null => {
    const mc = maskCanvasRef.current;
    const ic = imageCanvasRef.current;
    if (!mc) return null;
    const targetW = ic?.width || mc.width;
    const targetH = ic?.height || mc.height;
    const src = mc.getContext("2d")!.getImageData(0, 0, mc.width, mc.height);
    const rawMask = document.createElement("canvas");
    rawMask.width = mc.width;
    rawMask.height = mc.height;
    const rawCtx = rawMask.getContext("2d")!;
    const rawID = rawCtx.createImageData(mc.width, mc.height);
    for (let i = 0; i < src.data.length; i += 4) {
      const painted = src.data[i + 3] > 32;
      rawID.data[i] = painted ? 255 : 0;
      rawID.data[i + 1] = painted ? 255 : 0;
      rawID.data[i + 2] = painted ? 255 : 0;
      rawID.data[i + 3] = 255;
    }
    rawCtx.putImageData(rawID, 0, 0);
    const out = document.createElement("canvas");
    out.width = targetW;
    out.height = targetH;
    const octx = out.getContext("2d")!;
    octx.imageSmoothingEnabled = false;
    octx.drawImage(rawMask, 0, 0, targetW, targetH);
    return out.toDataURL("image/png").split(",")[1];
  };

  /**
   * 클라이언트 합성: 원본 + 모델출력 + soft mask
   *   - 마스크 안: 모델출력 (페더된 가장자리로 자연스럽게 블렌드)
   *   - 마스크 밖: 원본 픽셀 그대로 (수학적으로 보존)
   * 반환: composite 결과의 PNG Blob
   * 인자 ic/mc 는 detached snapshot 을 받을 수 있도록 옵션 처리 (없으면 ref 사용).
   */
  const compositeInpaintResult = async (
    generatedUrl: string,
    icArg?: HTMLCanvasElement | null,
    mcArg?: HTMLCanvasElement | null,
  ): Promise<Blob | null> => {
    const ic = icArg ?? imageCanvasRef.current;
    const mc = mcArg ?? maskCanvasRef.current;
    if (!ic || !mc) return null;
    const W = ic.width;
    const H = ic.height;
    if (!W || !H) return null;

    // 1) 모델 출력 로드
    const genImg: HTMLImageElement = await new Promise((resolve, reject) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => resolve(im);
      im.onerror = (e) => reject(e);
      im.src = generatedUrl;
    });

    // 2) 모델 출력을 원본 해상도로 리스케일 (NB2 결과는 보통 다른 해상도)
    const genCanvas = document.createElement("canvas");
    genCanvas.width = W;
    genCanvas.height = H;
    const gctx = genCanvas.getContext("2d")!;
    gctx.imageSmoothingQuality = "high";
    gctx.drawImage(genImg, 0, 0, W, H);

    // 3) soft mask 생성 (strength 반영)
    const featherPx = featherPxFor(W, H);
    const strength01 = brushStrengthRef.current / 100;
    const softMask = buildSoftMaskCanvas(mc, W, H, featherPx, strength01);

    // 4) (gen ∩ softMask) → 마스크 영역만 남긴 모델출력
    const maskedGen = document.createElement("canvas");
    maskedGen.width = W;
    maskedGen.height = H;
    const mgctx = maskedGen.getContext("2d")!;
    mgctx.drawImage(genCanvas, 0, 0);
    mgctx.globalCompositeOperation = "destination-in";
    mgctx.drawImage(softMask, 0, 0);

    // 5) 원본 위에 maskedGen 을 source-over → 최종 합성
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const octx = out.getContext("2d")!;
    octx.drawImage(ic, 0, 0);
    octx.drawImage(maskedGen, 0, 0);

    return await new Promise<Blob | null>((resolve) =>
      out.toBlob((b) => resolve(b), "image/png"),
    );
  };

  /* ━━━━━ 마스크 오버레이 — NB2(Gemini 3.1) 용 시각 힌트 이미지 ━━━━━
   * NB2 는 mask 파라미터가 없으므로, 원본 위에 브러시 영역을 형광 마젠타(#FF00FF)로
   * 칠한 합성 PNG 를 레퍼런스로 같이 보내 "수정 영역"을 시각적으로 지정한다.
   */
  const buildMaskOverlayBase64 = (): string | null => {
    const ic = imageCanvasRef.current;
    const mc = maskCanvasRef.current;
    if (!ic || !mc) return null;
    const mImg = mc.getContext("2d")!.getImageData(0, 0, mc.width, mc.height);
    let anyPainted = false;
    for (let i = 0; i < mImg.data.length; i += 4) {
      if (mImg.data[i] > 128) {
        anyPainted = true;
        break;
      }
    }
    if (!anyPainted) return null;

    const W = ic.width;
    const H = ic.height;

    // ── 마스크를 살짝 dilate(팽창) — 클라이언트 합성의 soft mask 가장자리를
    //    모델이 완전히 채울 수 있도록 NB2 가 인식하는 편집 영역을 약간 더 넓힘.
    //    (blur 후 alpha > 0 임계화 → 거리 변환 없이 간단한 디스크 dilation 효과)
    const featherPx = featherPxFor(W, H);
    const dilatePx = Math.max(2, Math.round(featherPx * 1.5));
    const dilated = document.createElement("canvas");
    dilated.width = W;
    dilated.height = H;
    const dctx = dilated.getContext("2d")!;
    dctx.filter = `blur(${dilatePx}px)`;
    dctx.drawImage(mc, 0, 0, W, H);
    dctx.filter = "none";
    const dImg = dctx.getImageData(0, 0, W, H);

    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const ctx = out.getContext("2d")!;
    ctx.drawImage(ic, 0, 0);
    const imageData = ctx.getImageData(0, 0, W, H);
    for (let i = 0; i < dImg.data.length; i += 4) {
      // blur 결과가 임의의 alpha 라도 > 0 이면 dilated 영역에 포함
      if (dImg.data[i + 3] > 8) {
        imageData.data[i] = 255;
        imageData.data[i + 1] = 0;
        imageData.data[i + 2] = 255;
        imageData.data[i + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return out.toDataURL("image/png").split(",")[1];
  };

  const uploadMaskOverlayAndGetUrl = async (projectId: string): Promise<string | null> => {
    const b64 = buildMaskOverlayBase64();
    if (!b64) return null;
    try {
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
      const path = `${projectId}/temp-mask-overlay-${Date.now()}.png`;
      const { error } = await supabase.storage
        .from("contis")
        .upload(path, blob, { upsert: true, contentType: "image/png" });
      if (error) return null;
      return supabase.storage.from("contis").getPublicUrl(path).data.publicUrl;
    } catch {
      return null;
    }
  };

  /* ━━━━━━━━━━━ ROI (Region-of-Interest) 인페인트 파이프라인 ━━━━━━━━━━━
   * 왜 필요한가:
   *   NB2(Gemini 3.1)는 멀티모달 generateContent API라 "별도 mask 파라미터" 가 없고
   *   전체 이미지를 재렌더한다. 이로 인해 unmasked 영역이 미묘하게 변형되거나
   *   모델이 브러시 영역이 아닌 엉뚱한 부분을 편집하는 문제가 발생.
   *
   * 해결:
   *   1. 클라이언트가 마스크 bbox 주변만 크롭(ROI) → 모델이 재렌더할 수 있는 범위 자체를
   *      ROI로 물리적으로 제한.
   *   2. B/W 바이너리 마스크도 별도 이미지로 함께 전달 → 고전적 inpaint 관습
   *      (흰=편집, 검=유지) 에 매칭되는 신호 제공.
   *   3. 합성 시 ROI 자리에만 paste-back → ROI 밖 픽셀은 원본과 bit-identical 보장.
   */
  type BBox = { x: number; y: number; w: number; h: number };

  /** 마스크 canvas의 alpha>0 영역 bbox (이미지 좌표). 비어있으면 null. */
  const computeMaskBBox = (mc: HTMLCanvasElement): BBox | null => {
    const ctx = mc.getContext("2d");
    if (!ctx) return null;
    const { data } = ctx.getImageData(0, 0, mc.width, mc.height);
    let minX = mc.width,
      minY = mc.height,
      maxX = -1,
      maxY = -1;
    const W = mc.width;
    for (let y = 0; y < mc.height; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        if (data[idx] > 0) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  };

  /**
   * bbox 확장:
   *   1. pad = max(bbox 짧은변의 padFraction, minPadPx) 만큼 사방으로 확장
   *   2. ROI의 짧은 변이 minSize 미만이면 minSize 까지 키움
   *   3. NB2 지원 aspect(9:16, 16:9, 1:1) 중 ROI 비율에 가장 가까운 것에 맞춰 확장
   *      (NB2 출력과 ROI 비율이 일치 → paste-back 시 stretch 없음)
   *   4. 이미지 경계로 clamp
   */
  const padBBox = (
    bb: BBox,
    imgW: number,
    imgH: number,
    padFraction = 0.35,
    minPadPx = 48,
    minSize = 384,
  ): BBox => {
    const padRaw = Math.max(minPadPx, Math.round(Math.min(bb.w, bb.h) * padFraction));
    let x = bb.x - padRaw;
    let y = bb.y - padRaw;
    let w = bb.w + padRaw * 2;
    let h = bb.h + padRaw * 2;

    // 최소 크기 보장
    if (w < minSize) {
      const add = minSize - w;
      x -= Math.round(add / 2);
      w = minSize;
    }
    if (h < minSize) {
      const add = minSize - h;
      y -= Math.round(add / 2);
      h = minSize;
    }

    // NB2 aspect 맞춤 확장 (중심 고정) — 로그 거리로 가장 가까운 aspect 선택
    const targets = [16 / 9, 1, 9 / 16];
    const ratio = w / h;
    const target = targets.reduce(
      (best, t) =>
        Math.abs(Math.log(t) - Math.log(ratio)) < Math.abs(Math.log(best) - Math.log(ratio)) ? t : best,
      targets[0],
    );

    if (Math.abs(ratio - target) > 0.02) {
      if (ratio < target) {
        // 너무 세로로 김 → 가로 확장
        const newW = Math.round(h * target);
        x -= Math.round((newW - w) / 2);
        w = newW;
      } else {
        // 너무 가로로 김 → 세로 확장
        const newH = Math.round(w / target);
        y -= Math.round((newH - h) / 2);
        h = newH;
      }
    }

    // 이미지 경계로 clamp (ROI를 이미지 안으로 밀어넣음, 크기 유지 시도)
    if (x < 0) {
      x = 0;
    }
    if (y < 0) {
      y = 0;
    }
    if (x + w > imgW) {
      x = Math.max(0, imgW - w);
      w = Math.min(w, imgW);
    }
    if (y + h > imgH) {
      y = Math.max(0, imgH - h);
      h = Math.min(h, imgH);
    }
    return { x, y, w, h };
  };

  /** source canvas를 bbox로 크롭한 새 canvas */
  const cropCanvas = (src: HTMLCanvasElement, bb: BBox): HTMLCanvasElement => {
    const out = document.createElement("canvas");
    out.width = bb.w;
    out.height = bb.h;
    const ctx = out.getContext("2d")!;
    ctx.drawImage(src, bb.x, bb.y, bb.w, bb.h, 0, 0, bb.w, bb.h);
    return out;
  };

  /**
   * mask canvas → 그레이스케일 마스크 (흰=편집, 검=유지, 회색=부분 편집).
   * 모델(NB2/GPT) 전송용. ROI crop 지원.
   * brightness = alpha * strength → strength 50%이면 중심 픽셀도 ~127 회색 → 모델이
   * "약한 개입" 신호로 인식.
   */
  const buildBinaryMaskCanvas = (
    mc: HTMLCanvasElement,
    bb?: BBox,
    strength01: number = 1,
  ): HTMLCanvasElement => {
    const srcX = bb?.x ?? 0;
    const srcY = bb?.y ?? 0;
    const W = bb?.w ?? mc.width;
    const H = bb?.h ?? mc.height;
    const srcCtx = mc.getContext("2d")!;
    const srcID = srcCtx.getImageData(srcX, srcY, W, H);
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const ctx = out.getContext("2d")!;
    const id = ctx.createImageData(W, H);
    const s = Math.max(0, Math.min(1, strength01));
    for (let i = 0; i < srcID.data.length; i += 4) {
      const a = srcID.data[i + 3];
      const v = Math.round(a * s);
      id.data[i] = v;
      id.data[i + 1] = v;
      id.data[i + 2] = v;
      id.data[i + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    return out;
  };

  /** 원본 crop 위에 마젠타 마스크를 칠한 이미지 (NB2용 추가 시각 힌트) */
  const buildMagentaOverlayCanvas = (
    ic: HTMLCanvasElement,
    mc: HTMLCanvasElement,
    bb?: BBox,
  ): HTMLCanvasElement => {
    const cropped = bb ? cropCanvas(ic, bb) : (() => {
      const c = document.createElement("canvas");
      c.width = ic.width;
      c.height = ic.height;
      c.getContext("2d")!.drawImage(ic, 0, 0);
      return c;
    })();
    const W = cropped.width;
    const H = cropped.height;
    const featherPx = featherPxFor(W, H);
    const dilatePx = Math.max(2, Math.round(featherPx * 1.5));
    const dilated = document.createElement("canvas");
    dilated.width = W;
    dilated.height = H;
    const dctx = dilated.getContext("2d")!;
    dctx.filter = `blur(${dilatePx}px)`;
    if (bb) {
      dctx.drawImage(mc, bb.x, bb.y, bb.w, bb.h, 0, 0, W, H);
    } else {
      dctx.drawImage(mc, 0, 0, W, H);
    }
    dctx.filter = "none";
    const dImg = dctx.getImageData(0, 0, W, H);
    const ctx = cropped.getContext("2d")!;
    const id = ctx.getImageData(0, 0, W, H);
    for (let i = 0; i < dImg.data.length; i += 4) {
      if (dImg.data[i + 3] > 8) {
        id.data[i] = 255;
        id.data[i + 1] = 0;
        id.data[i + 2] = 255;
        id.data[i + 3] = 255;
      }
    }
    ctx.putImageData(id, 0, 0);
    return cropped;
  };

  /** canvas → Blob → 업로드 → public URL */
  const uploadCanvasAsImage = async (
    canvas: HTMLCanvasElement,
    projectId: string,
    tag: string,
  ): Promise<string | null> => {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
    if (!blob) return null;
    const path = `${projectId}/temp-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const { error } = await supabase.storage
      .from("contis")
      .upload(path, blob, { upsert: true, contentType: "image/png" });
    if (error) return null;
    return supabase.storage.from("contis").getPublicUrl(path).data.publicUrl;
  };

  /**
   * ROI 결과를 원본 이미지 위에 paste-back 합성.
   *   - ROI 바깥: 원본 픽셀 그대로 (bit-identical)
   *   - ROI 안: (모델출력 ∩ soft mask) 블렌드
   */
  const compositeROIInpaintResult = async (
    generatedUrl: string,
    bb: BBox,
    icArg?: HTMLCanvasElement | null,
    mcArg?: HTMLCanvasElement | null,
  ): Promise<Blob | null> => {
    const ic = icArg ?? imageCanvasRef.current;
    const mc = mcArg ?? maskCanvasRef.current;
    if (!ic || !mc) return null;
    const W = ic.width;
    const H = ic.height;
    if (!W || !H) return null;

    const genImg: HTMLImageElement = await new Promise((resolve, reject) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => resolve(im);
      im.onerror = (e) => reject(e);
      im.src = generatedUrl;
    });

    // ROI 크기로 리스케일
    const genROI = document.createElement("canvas");
    genROI.width = bb.w;
    genROI.height = bb.h;
    const gctx = genROI.getContext("2d")!;
    gctx.imageSmoothingQuality = "high";
    gctx.drawImage(genImg, 0, 0, bb.w, bb.h);

    // ROI 범위의 soft mask (브러시 soft 엣지 알파 + strength 스케일 보존)
    const featherPx = featherPxFor(bb.w, bb.h);
    const strength01 = brushStrengthRef.current / 100;
    const softMask = document.createElement("canvas");
    softMask.width = bb.w;
    softMask.height = bb.h;
    const smctx = softMask.getContext("2d")!;
    const srcID = mc.getContext("2d")!.getImageData(bb.x, bb.y, bb.w, bb.h);
    const whiteAlpha = document.createElement("canvas");
    whiteAlpha.width = bb.w;
    whiteAlpha.height = bb.h;
    const wctx = whiteAlpha.getContext("2d")!;
    const wid = wctx.createImageData(bb.w, bb.h);
    for (let i = 0; i < srcID.data.length; i += 4) {
      const a = Math.round(srcID.data[i + 3] * strength01);
      wid.data[i] = 255;
      wid.data[i + 1] = 255;
      wid.data[i + 2] = 255;
      wid.data[i + 3] = a;
    }
    wctx.putImageData(wid, 0, 0);
    smctx.filter = `blur(${featherPx}px)`;
    smctx.drawImage(whiteAlpha, 0, 0);
    smctx.filter = "none";

    // (genROI ∩ softMask)
    const maskedGen = document.createElement("canvas");
    maskedGen.width = bb.w;
    maskedGen.height = bb.h;
    const mgctx = maskedGen.getContext("2d")!;
    mgctx.drawImage(genROI, 0, 0);
    mgctx.globalCompositeOperation = "destination-in";
    mgctx.drawImage(softMask, 0, 0);

    // 최종: 원본 전체 + ROI 자리에 maskedGen
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const octx = out.getContext("2d")!;
    octx.drawImage(ic, 0, 0);
    octx.drawImage(maskedGen, bb.x, bb.y);

    return await new Promise<Blob | null>((resolve) => out.toBlob((b) => resolve(b), "image/png"));
  };

  const toggleSceneRef = (s: (typeof otherScenes)[0]) => {
    const isAlreadySelected = selectedSceneRefs.find((x) => x.id === s.id);
    if (isAlreadySelected) {
      setSelectedSceneRefs((p) => p.filter((x) => x.id !== s.id));
      removePromptTag(`[#${String(s.scene_number).padStart(2, "0")}]`);
    } else {
      setSelectedSceneRefs((p) => [...p, s]);
      insertPromptTagAtCursor(`[#${String(s.scene_number).padStart(2, "0")}]`);
    }
  };

  const handleCustomRefUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    let added = 0;
    Array.from(e.target.files ?? [])
      .slice(0, 3 - customRefImages.length)
      .forEach((file) => {
        if (!file.type.startsWith("image/")) return;
        setCustomRefImages((p) => [...p, { preview: URL.createObjectURL(file), file }]);
        added++;
      });
    if (added > 0) insertPromptTagAtCursor("[ref-img]", false);
    e.target.value = "";
  };
  const removeCustomRef = (idx: number) =>
    setCustomRefImages((p) => {
      URL.revokeObjectURL(p[idx].preview);
      return p.filter((_, i) => i !== idx);
    });

  const urlToBase64 = async (url: string): Promise<string | null> => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  };

  const buildEnrichedPrompt = async (
    sourceImageBase64?: string,
    tagImageBase64?: string,
  ): Promise<string> => {
    const maskEmpty = isMaskEmpty();
    const rawPrompt = sanitizeImagePrompt(inpaintPrompt.trim());
    const mentionedTagNames = (inpaintPrompt.match(/@([\w가-힣]+)/g) || []).map((t) => t.slice(1));
    const assetDescriptions = mentionedTagNames
      .map((name) => {
        const asset = assets.find((a) => a.tag_name === name || a.tag_name === `@${name}`);
        if (!asset) return null;
        const parts: string[] = [];
        if (asset.asset_type === "character") {
          if (asset.ai_description) parts.push(`Appearance: ${asset.ai_description}`);
          if (asset.outfit_description) parts.push(`Outfit: ${asset.outfit_description}`);
          if (asset.role_description) parts.push(`Role: ${asset.role_description}`);
          if (asset.signature_items) parts.push(`Signature items: ${asset.signature_items}`);
        } else if (asset.asset_type === "background") {
          if (asset.space_description) parts.push(`Space: ${asset.space_description}`);
          if (asset.ai_description) parts.push(`Description: ${asset.ai_description}`);
        } else {
          if (asset.ai_description) parts.push(`Description: ${asset.ai_description}`);
          if (asset.signature_items) parts.push(`Details: ${asset.signature_items}`);
        }
        if (parts.length === 0) return null;
        return `@${name} (${TYPE_LABEL[asset.asset_type] || asset.asset_type}):\n${parts.join("\n")}`;
      })
      .filter(Boolean)
      .join("\n\n");
    try {
      const { data, error } = await supabase.functions.invoke("enhance-inpaint-prompt", {
        body: {
          prompt: rawPrompt,
          hasMask: !maskEmpty,
          assetDescriptions: assetDescriptions || undefined,
          // Gemini 가 SOURCE + TAG 이미지를 모두 보고
          //   PRESERVE: (원본에서 보존할 요소)
          //   TAG_IDENTITY: (태그 에셋의 식별 특징)
          // 블록을 포함한 강화 프롬프트를 만들게 한다.
          // 브러시 없이 태그만으로 호출될 때도 태그 에셋의 식별 특징이 NB2 까지
          // 그대로 흘러가야 반영률이 떨어지지 않으므로 hasMask 무관하게 전달.
          sourceImageBase64: sourceImageBase64 || undefined,
          tagImageBase64: tagImageBase64 || undefined,
        },
      });
      if (!error && data?.enhanced) {
        let p = data.enhanced as string;
        if (selectedSceneRefs.length > 0)
          p += `\nMatch the visual style, color grading, and art direction of the referenced shots.`;
        return p + "\n\nSafe for all audiences. No violence, weapons, or real celebrities.";
      }
    } catch {}
    let p = rawPrompt;
    if (assetDescriptions) p += `\n\n[Asset references]\n${assetDescriptions}`;
    p += `\n\nOnly edit the masked region.\nPreserve all unmasked content exactly.\nDo not add substitute objects or extra changes.`;
    return p + "\n\nSafe for all audiences. No violence, weapons, or real celebrities.";
  };

  const uploadCustomRefsAndGetUrls = async (): Promise<string[]> => {
    const urls: string[] = [];
    for (const item of customRefImages) {
      const ext = item.file.name.split(".").pop() ?? "jpg";
      const path = `${currentScene.project_id}/temp-ref-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("contis").upload(path, item.file, { upsert: true });
      if (!error) urls.push(supabase.storage.from("contis").getPublicUrl(path).data.publicUrl);
    }
    return urls;
  };

  const isMaskEmpty = (): boolean => {
    const mc = maskCanvasRef.current;
    if (!mc) return true;
    const ctx = mc.getContext("2d");
    if (!ctx) return true;
    const data = ctx.getImageData(0, 0, mc.width, mc.height).data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 0) return false;
    }
    return true;
  };

  const handleInpaint = async () => {
    if (!inpaintPrompt.trim() || !currentScene.conti_image_url) return;
    const targetScene = currentScene;
    setIsGenerating(true);
    onEditGeneratingChange?.(targetScene.id, true);
    const sceneId = targetScene.id;
    // ── 프리뷰 비율로 사전-크롭된 URL 이 있으면 그걸 원본으로 사용 (style transfer 와 동일) ──
    // 캔버스에 그려진 이미지와 마스크는 이미 이 크롭 결과 위에서 그려졌으므로,
    // 모델에게도 동일한 크롭된 이미지를 넘겨야 mask 좌표계가 정확히 일치한다.
    const preflightSourceUrl = preflightSourceUrlRef.current;
    const effectiveSceneImageUrl =
      preflightSourceUrl && preflightedSceneImageUrlRef.current === targetScene.conti_image_url
        ? preflightSourceUrl
        : targetScene.conti_image_url;
    const sceneImageUrl = effectiveSceneImageUrl;
    const usedPreflight = sceneImageUrl !== targetScene.conti_image_url;
    const sceneProjectId = targetScene.project_id;
    const sceneNumber = targetScene.scene_number;
    const promptText = inpaintPrompt;
    const maskEmptyVal = isMaskEmpty();
    const maskB64 = maskEmptyVal ? null : extractMaskBase64();
    // 항상 NB2 를 우선 사용. 브러시가 있을 때는 마스크 오버레이 레퍼런스로 영역 지시,
    // 브러시가 없을 때는 NB2 의 instruction-based 전체 편집을 활용.
    const useNanoBanana = true;
    const moodRefUrls = useMoodRef && moodReferenceUrl ? [moodReferenceUrl] : [];
    const mentionedTagNames = (promptText.match(/@([\w가-힣]+)/g) || []).map((t) => t.slice(1));
    const REMOVAL_KEYWORDS = /제거|삭제|없애|지워|지우|remove|delete|erase|get rid/i;
    const isRemoval = REMOVAL_KEYWORDS.test(promptText);
    const matchedAssets = mentionedTagNames
      .map((name) => ({
        name,
        asset: assets.find((a) => a.tag_name === name || a.tag_name === `@${name}`),
      }))
      .map((x) => ({
        name: x.name,
        matched: !!x.asset,
        hasPhoto: !!x.asset?.photo_url,
        photoUrl: x.asset?.photo_url ?? null,
      }));
    const assetRefUrls = isRemoval
      ? []
      : matchedAssets.filter((m) => m.matched && m.hasPhoto).map((m) => m.photoUrl as string);
    const selectedRefs = [...compareSelectedRefs];

    console.log("[Inpaint:tag-debug]", {
      promptText,
      mentionedTagNames,
      isRemoval,
      availableAssetTagNames: assets.map((a) => a.tag_name),
      matchedAssets,
      assetRefUrls,
    });
    const fmt = videoFormat;

    // ── 캔버스 스냅샷 (detached offscreen copies) ──────────────────────
    // onClose() 후 edit 탭이 언마운트되면 canvas ref 들이 null 이 되므로,
    // 비동기 파이프라인에서 쓸 image/mask 캔버스를 미리 detached 복사본으로 만들어둠.
    const ic = imageCanvasRef.current;
    const mcRef = maskCanvasRef.current;
    const icSnapshot: HTMLCanvasElement | null = (() => {
      if (!ic || ic.width === 0 || ic.height === 0) return null;
      const c = document.createElement("canvas");
      c.width = ic.width;
      c.height = ic.height;
      c.getContext("2d")!.drawImage(ic, 0, 0);
      return c;
    })();
    const mcSnapshot: HTMLCanvasElement | null = (() => {
      if (!mcRef || mcRef.width === 0 || mcRef.height === 0) return null;
      const c = document.createElement("canvas");
      c.width = mcRef.width;
      c.height = mcRef.height;
      c.getContext("2d")!.drawImage(mcRef, 0, 0);
      return c;
    })();

    // ── ROI 적용 판정 ──
    let roi: BBox | null = null;
    let useROI = false;
    if (!maskEmptyVal && icSnapshot && mcSnapshot) {
      const tight = computeMaskBBox(mcSnapshot);
      if (tight) {
        const padded = padBBox(tight, icSnapshot.width, icSnapshot.height);
        const coverage = (padded.w * padded.h) / (icSnapshot.width * icSnapshot.height);
        roi = padded;
        useROI = coverage < 0.7;
        console.log("[Inpaint:roi]", { tight, padded, coverage: coverage.toFixed(3), useROI });
      }
    }

    onClose();
    (async () => {
      try {
        onStageChange?.(sceneId, "generating");

        const imgRes = await fetch(sceneImageUrl);
        const imgBlob = await imgRes.blob();
        const imageBase64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.readAsDataURL(imgBlob);
        });
        const customRefUrls = await uploadCustomRefsAndGetUrls();

        const primaryAssetRef = assetRefUrls[0] ?? null;
        const hasTagRef = !!primaryAssetRef;

        /* ━━━ ROI 모드 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
         * 클라이언트가 마스크 bbox 주변만 잘라 NB2 에게 전달.
         * NB2 는 ROI 만 재생성할 수 있으므로 물리적으로 편집 범위가 제한됨.
         * 결과를 원본 위 ROI 자리에 paste-back → 마스크 밖은 bit-identical 보장.
         * ────────────────────────────────────────────────────────── */
        let nbSourceUrl: string;
        let nbRefUrls: string[];
        let nbImageSize: string;
        let maskPrefix: string;

        if (useROI && roi && icSnapshot && mcSnapshot) {
          const strength01 = brushStrengthRef.current / 100;
          const roiSource = cropCanvas(icSnapshot, roi);
          const roiMask = buildBinaryMaskCanvas(mcSnapshot, roi, strength01);
          const roiOverlay = buildMagentaOverlayCanvas(icSnapshot, mcSnapshot, roi);

          const [roiSourceUrl, roiMaskUrl, roiOverlayUrl] = await Promise.all([
            uploadCanvasAsImage(roiSource, sceneProjectId, "roi-src"),
            uploadCanvasAsImage(roiMask, sceneProjectId, "roi-mask"),
            uploadCanvasAsImage(roiOverlay, sceneProjectId, "roi-ovl"),
          ]);

          if (!roiSourceUrl || !roiMaskUrl) {
            throw new Error("ROI upload failed");
          }

          nbSourceUrl = roiSourceUrl;
          nbRefUrls = [roiMaskUrl];
          if (roiOverlayUrl) nbRefUrls.push(roiOverlayUrl);
          if (primaryAssetRef) nbRefUrls.push(primaryAssetRef);
          nbImageSize = computeImageSizeFromDimensions(roi.w, roi.h);

          maskPrefix = `INPAINT REGION EDIT — precision mode.

You receive a CROPPED region of a larger shot plus a binary mask.

Reference images (exact order):
  [1] SOURCE — a cropped region of a scene. This is the canvas you must respect.
  [2] MASK   — binary mask aligned 1:1 with SOURCE. WHITE = the area you MUST edit. BLACK = the area you MUST preserve pixel-for-pixel.
  [3] OVERLAY (optional) — SOURCE with the edit region visually painted magenta (#FF00FF). Use it as a redundant visual cue; magenta must NOT appear in your output.${hasTagRef ? `
  [4] TAG_ASSET — a reference photo showing the identity of the object to paint inside the WHITE mask region.` : ""}

Hard output rules — ALL must hold:
 1. For every BLACK mask pixel in [2], the corresponding pixel in your output MUST equal [1] SOURCE exactly (same color, same texture, same detail). Do NOT re-render, re-light, re-color, or re-frame any black-mask pixel.
 2. For WHITE mask pixels in [2], paint the requested content. Blend seamlessly with SOURCE's lighting, color grading, perspective, and texture at the white/black boundary.
 3. Output aspect ratio and framing MUST match SOURCE. Do NOT crop, rotate, pan, or zoom. The edit is strictly local.
 4. Output size and subject placement must match SOURCE. Treat SOURCE as an immutable background layer onto which the white-mask region is the only paintable area.${hasTagRef ? `
 5. TAG_ASSET identity match (REQUIRED):
    - The object painted inside the WHITE region MUST be recognizably the same specific object shown in [4]. Match exact shape, silhouette, proportions, materials, colors, surface finish, markings/logos/text, and distinguishing details.
    - Adapt only the viewing angle, lighting, and scale to blend with SOURCE. Do NOT copy [4]'s background or photo framing into the output.` : ""}

Self-check before emitting pixels:
 - If any black-mask pixel of your planned output differs from SOURCE → STOP and restart from rule 1.
 - If the WHITE region is not filled with the requested content blending naturally → restart from rule 2.${hasTagRef ? `
 - If the painted object is not immediately recognizable as the specific object in [4] → restart from rule 5.` : ""}

Edit instruction (applies strictly inside the WHITE mask region):
`;
        } else {
          /* ━━━ 전체 이미지 모드 (마스크 없음 또는 ROI가 거의 전체) ━━━━
           * 기존 동작 유지 + 마스크 있으면 B/W 마스크를 레퍼런스로 추가 전송.
           */
          let binaryMaskUrl: string | null = null;
          let magentaOverlayUrl: string | null = null;
          if (!maskEmptyVal && icSnapshot && mcSnapshot) {
            const strength01 = brushStrengthRef.current / 100;
            const binMask = buildBinaryMaskCanvas(mcSnapshot, undefined, strength01);
            const magOverlay = buildMagentaOverlayCanvas(icSnapshot, mcSnapshot);
            [binaryMaskUrl, magentaOverlayUrl] = await Promise.all([
              uploadCanvasAsImage(binMask, sceneProjectId, "mask-bw"),
              uploadCanvasAsImage(magOverlay, sceneProjectId, "mask-ovl"),
            ]);
          }

          nbSourceUrl = sceneImageUrl;
          if (!maskEmptyVal && (binaryMaskUrl || magentaOverlayUrl)) {
            nbRefUrls = [];
            if (binaryMaskUrl) nbRefUrls.push(binaryMaskUrl);
            if (magentaOverlayUrl) nbRefUrls.push(magentaOverlayUrl);
            if (primaryAssetRef) nbRefUrls.push(primaryAssetRef);
          } else {
            nbRefUrls = [...assetRefUrls, ...moodRefUrls, ...selectedRefs, ...customRefUrls].slice(0, 3);
          }
          nbImageSize =
            icSnapshot && icSnapshot.width > 0 && icSnapshot.height > 0
              ? computeImageSizeFromDimensions(icSnapshot.width, icSnapshot.height)
              : IMAGE_SIZE_MAP[fmt];

          if (!maskEmptyVal) {
            maskPrefix = `INPAINT EDIT — full-image mode with binary mask.

Reference images (exact order):
  [1] SOURCE — the original full shot. This is your canvas.
  [2] MASK   — binary mask aligned 1:1 with SOURCE. WHITE = the area you MUST edit. BLACK = the area you MUST preserve pixel-for-pixel.${magentaOverlayUrl ? `
  [3] OVERLAY — SOURCE with edit region painted magenta (#FF00FF). Redundant visual cue; magenta must NOT appear in the output.` : ""}${hasTagRef ? `
  [${magentaOverlayUrl ? 4 : 3}] TAG_ASSET — identity reference for the object to paint inside the WHITE region.` : ""}

Hard output rules — ALL must hold:
 1. For every BLACK mask pixel, output pixel MUST equal SOURCE exactly. Same composition, crop, camera angle, aspect ratio, lighting, color grading, subject poses, background, and other objects.
 2. For WHITE mask pixels, paint the requested content and blend seamlessly.
 3. Do NOT move, resize, crop, or duplicate any subject outside the WHITE region.
 4. Aspect ratio must match SOURCE.${hasTagRef ? `
 5. The object painted inside WHITE MUST be recognizably the same specific object in TAG_ASSET.` : ""}

Edit instruction (applies strictly inside the WHITE mask region):
`;
          } else if (hasTagRef) {
            /* ━━━ 태그-only 모드 (브러시 없음 + @태그 있음) ━━━
             * 역할 라벨이 없으면 NB2 가 [2] TAG_ASSET 을 단순 스타일/무드 레퍼런스처럼
             * 약하게 참고해 반영률이 떨어진다. 명시적으로 정체성 소스임을 지정하고,
             * SOURCE 의 구성·조명·다른 서브젝트는 유지하도록 강하게 묶어준다.
             */
            maskPrefix = `INPAINT EDIT — tag-driven edit (no brush mask).

Reference images (exact order):
  [1] SOURCE — the current shot. Preserve composition, camera angle, framing, lighting, color grading, and every subject/element that is NOT the target of the user's edit request.
  [2] TAG_ASSET — identity reference for the object/character the user @-tagged. Treat this as the authoritative source for the tagged subject's identity (shape, proportions, colors, materials, markings, logos, distinctive details).${nbRefUrls.length > 1 ? `
  [3+] STYLE/MOOD REFS — use only for style, color, and mood cues. Do NOT copy their subjects or composition.` : ""}

Hard output rules — ALL must hold:
 1. Apply the user's edit instruction ONLY to the target implied by the prompt. Every non-target pixel must match [1] SOURCE (same people, same poses, same background, same props, same lighting).
 2. The tagged subject in the output MUST be recognizably the same specific object/character shown in [2] TAG_ASSET. Match its shape, proportions, colors, materials, surface finish, markings/logos/text, and distinguishing details. Adapt only viewing angle, lighting, and scale to blend with SOURCE.
 3. Do NOT generate a generic version of the tagged subject. Do NOT substitute it with a similar-but-different object.
 4. Output aspect ratio, framing, and crop MUST match SOURCE. No pan/zoom/rotate.
 5. Do NOT introduce extra changes (new objects, relighting the whole scene, re-framing) beyond what the user asked.

Edit instruction:
`;
          } else {
            maskPrefix = "";
          }
        }

        console.log("[Inpaint:refs-debug]", {
          useROI,
          roi,
          nbSourceUrl,
          nbRefUrls,
          nbImageSize,
          hasTagRef,
        });

        const tagImageBase64 = primaryAssetRef ? await urlToBase64(primaryAssetRef) : null;
        const rawEnrichedPrompt = await buildEnrichedPrompt(imageBase64, tagImageBase64 ?? undefined);
        const enrichedPrompt = maskPrefix + rawEnrichedPrompt;

        const body: Record<string, any> = {
          mode: "inpaint",
          imageBase64,
          maskBase64: maskB64,
          prompt: enrichedPrompt,
          forceGpt: false,
          projectId: sceneProjectId,
          sceneNumber,
          imageSize: nbImageSize,
          referenceImageUrls: nbRefUrls,
          useNanoBanana,
          sourceImageUrl: nbSourceUrl,
        };
        const { data, error } = await supabase.functions.invoke("openai-image", { body });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error?.message ?? "Inpainting failed");
        console.log("[Inpaint] used model:", data.usedModel ?? "unknown", "| imageSize:", nbImageSize);
        const generatedUrl = data.publicUrl;
        if (!generatedUrl) throw new Error("No image URL returned");

        /* ━━━ 클라이언트 합성: 마스크 밖 픽셀 원본 보존 보장 ━━━
         * ROI 모드: 원본 + ROI 자리에 (gen ∩ soft mask) paste-back
         * 전체 모드: 원본 + (gen ∩ soft mask)                        */
        let publicUrl = generatedUrl;
        if (!maskEmptyVal) {
          try {
            const blob =
              useROI && roi
                ? await compositeROIInpaintResult(generatedUrl, roi, icSnapshot, mcSnapshot)
                : await compositeInpaintResult(generatedUrl, icSnapshot, mcSnapshot);
            if (blob) {
              const compositePath = `${sceneProjectId}/scene-${sceneNumber}-inpaint-composite-${Date.now()}.png`;
              const { error: upErr } = await supabase.storage
                .from("contis")
                .upload(compositePath, blob, { upsert: true, contentType: "image/png" });
              if (!upErr) {
                publicUrl = supabase.storage.from("contis").getPublicUrl(compositePath).data.publicUrl;
                console.log("[Inpaint] client-composited:", { useROI, url: publicUrl });
              } else {
                console.warn("[Inpaint] composite upload failed, using raw model output:", upErr.message);
              }
            }
          } catch (e) {
            console.warn("[Inpaint] client compositing failed, using raw model output:", (e as Error).message);
          }
        }

        // 프리뷰 비율로 사전-크롭된 이미지 위에서 inpaint 한 경우, 결과 이미지의
        // 자연 비율이 이미 FORMAT_RATIO 와 일치한다. 이전에 저장된 conti_image_crop
        // 은 옛 이미지 좌표 기준이므로 반드시 비워야 프리뷰가 정상 출력된다.
        const sceneUpdate: Record<string, any> = { conti_image_url: publicUrl };
        if (usedPreflight) sceneUpdate.conti_image_crop = null;
        await supabase.from("scenes").update(sceneUpdate).eq("id", sceneId);
        onSaveInpaint(publicUrl, targetScene);
        toast({ title: t("studio.inpaintComplete") });
        // inpaint 성공 후 preflight 임시 파일 정리.
        // - preflightSourceUrl 은 이 호출 전에 snapshot 된 로컬 변수라서,
        //   다음 useEffect 재실행으로 ref 가 바뀌든 말든 안전하게 그 파일만 지움.
        // - 다음 inpaint 는 scene 의 새 conti_image_url 로 useEffect 가
        //   preflight 를 새로 만들어주므로 캐시 손실이 없다.
        if (usedPreflight && preflightSourceUrl) void deleteStoredFile(preflightSourceUrl);
      } catch (e: any) {
        toast({ title: t("studio.inpaintFailed"), description: e.message, variant: "destructive" });
      } finally {
        onStageChange?.(sceneId, null);
        onEditGeneratingChange?.(sceneId, false);
      }
    })();
  };

  const handleDownload = () => {
    if (!currentScene.conti_image_url) return;
    const a = document.createElement("a");
    a.href = currentScene.conti_image_url;
    a.download = `shot-${String(currentScene.scene_number).padStart(2, "0")}.png`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
  };

  const displayUrl = previewUrl || currentScene.conti_image_url;

  /* ━━━━━━━━━━━ RENDER ━━━━━━━━━━━ */
  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "#111111" }}>
      {/* ── 헤더 ── */}
      <div
        className="h-[52px] flex items-center justify-between px-5 border-b border-white/[0.06] shrink-0"
        style={{ background: "hsl(var(--card))" }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => hasPrev && goToIndex((i) => i - 1)}
              disabled={!hasPrev}
              className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => hasNext && goToIndex((i) => i + 1)}
              disabled={!hasNext}
              className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <span className="text-foreground font-semibold text-sm flex items-center gap-1.5">
            {(currentScene as any).is_transition ? (
              <span
                className="font-mono text-[11px] font-bold px-1.5 py-0.5 text-white"
                style={{ background: "#6b7280", borderRadius: 2 }}
              >
                TR
              </span>
            ) : (
              <span
                className="font-mono text-[11px] font-bold px-1.5 py-0.5 text-white"
                style={{ background: KR, borderRadius: 2 }}
              >
                #
                {(() => {
                  let dn = 0;
                  for (const s of allScenes) {
                    if (!(s as any).is_transition) dn++;
                    if (s.id === currentScene.id) break;
                  }
                  return String(dn).padStart(2, "0");
                })()}
              </span>
            )}
            {currentScene.title && (
              <span className="text-muted-foreground font-normal ml-1.5">· {currentScene.title}</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={async () => {
              if (!currentScene || isRegenerating) return;
              setIsLocalRegenerating(true);
              onEditGeneratingChange?.(currentScene.id, true);
              try {
                // Regenerate intentionally drops styleAnchor / styleImageUrl
                // here too — see ContiTab.handleGenerate for the rationale.
                // Style is applied only via the dedicated Style Transfer
                // flow, never as a soft hint mixed into generate prompts.
                const newUrl = await generateConti({
                  scene: currentScene,
                  allScenes,
                  projectId: currentScene.project_id,
                  videoFormat,
                  briefAnalysis: briefAnalysis ?? undefined,
                });
                onSaveInpaint(newUrl, currentScene);
                toast({ title: t("studio.regenComplete") });
              } catch (e: any) {
                toast({ title: t("studio.regenFailed"), description: e.message, variant: "destructive" });
              } finally {
                setIsLocalRegenerating(false);
                onEditGeneratingChange?.(currentScene.id, false);
              }
            }}
            disabled={isRegenerating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40"
          >
            {isRegenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}{" "}
            {t("studio.regenerate")}
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> {t("studio.download")}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── 본문 ── */}
      <div className="flex flex-1 min-h-0">
        {/* ─── 좌측: 이미지 영역 ─── */}
        <div ref={containerRef} className="flex-1 flex items-center justify-center p-6 relative">
          {activeTab === "editor" ? (
            <AnnotationEditor
              imageUrl={currentScene.conti_image_url}
              imageHistory={currentImageHistory}
              canvasSize={canvasSize}
              containerRef={containerRef as React.RefObject<HTMLDivElement>}
              projectId={currentScene.project_id}
              sceneId={currentScene.id}
              sceneNumber={currentScene.scene_number}
              videoFormat={videoFormat}
              onApply={(url) => {
                onSaveInpaint(url, currentScene);
                onClose();
              }}
              onRestore={(originalUrl) => {
                onSaveInpaint(originalUrl, currentScene);
              }}
            />
          ) : activeTab === "edit" ? (
            <div
              ref={viewportRef}
              className="relative w-full h-full overflow-hidden"
              style={{ touchAction: "none" }}
            >
              {!imageLoaded && !imageError && (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> {t("studio.loadingImage")}
                </div>
              )}
              {imageError && (
                <div className="absolute inset-0 flex items-center justify-center text-destructive text-sm">
                  {t("studio.failedLoadImage")}
                </div>
              )}

              {/* 캔버스 컨테이너 — 줌/팬 transform 대상.
                  viewport 중심에 정렬한 뒤 translate(pan)+scale(zoom) 적용. */}
              <div
                className="absolute"
                style={{
                  left: "50%",
                  top: "50%",
                  width: imageLoaded ? canvasSize.w : undefined,
                  height: imageLoaded ? canvasSize.h : undefined,
                  display: imageLoaded ? "block" : "none",
                  transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: "50% 50%",
                  willChange: "transform",
                }}
              >
                {/* 레이어 1: 이미지 */}
                <canvas ref={imageCanvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
                {/* 레이어 2: 마스크 (AI 전달용, 숨김) */}
                <canvas ref={maskCanvasRef} style={{ display: "none" }} />
                {/* 레이어 3: 오버레이 (빨간 브러시 시각 피드백) — 이벤트 없음 */}
                <canvas
                  ref={overlayCanvasRef}
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "block",
                    width: "100%",
                    height: "100%",
                    opacity: 0.9,
                    pointerEvents: "none",
                  }}
                />
                {/* 레이어 4: 커서 — 이벤트 없음 */}
                <canvas
                  ref={cursorCanvasRef}
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "block",
                    width: "100%",
                    height: "100%",
                    pointerEvents: "none",
                  }}
                />
                {/* 레이어 5: 이벤트 캡처 div — Pointer Events 통합(마우스/펜/터치) */}
                <div
                  ref={eventDivRef}
                  style={{
                    position: "absolute",
                    inset: 0,
                    cursor: "none",
                    touchAction: "none",
                    pointerEvents: isGenerating ? "none" : "auto",
                  }}
                  onPointerDown={handleDrawPointerDown}
                  onPointerMove={handleDrawPointerMove}
                  onPointerUp={handleDrawPointerUp}
                  onPointerCancel={handleDrawPointerUp}
                  onPointerLeave={handleDrawPointerLeave}
                />
              </div>

              {/* 브러시 툴바 */}
              {imageLoaded && (
                <div
                  className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-2 rounded-none border border-white/[0.06] z-10"
                  style={{ background: "hsl(var(--card)/0.95)", backdropFilter: "blur(8px)" }}
                >
                  <button
                    onClick={() => setToolMode("brush")}
                    className={`p-1.5 rounded transition-colors ${toolMode === "brush" ? "text-foreground bg-white/10" : "text-muted-foreground hover:text-foreground"}`}
                    title={t("studio.brush")}
                  >
                    <Paintbrush className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setToolMode("eraser")}
                    className={`p-1.5 rounded transition-colors ${toolMode === "eraser" ? "text-foreground bg-white/10" : "text-muted-foreground hover:text-foreground"}`}
                    title={t("studio.eraser")}
                  >
                    <Eraser className="w-3.5 h-3.5" />
                  </button>
                  <div className="w-px h-4 bg-white/10 mx-1" />
                  <span
                    className="text-[10px] text-muted-foreground tracking-wide"
                    title={t("studio.brushSizeTitle")}
                  >
                    {t("studio.size")}
                  </span>
                  <input
                    type="range"
                    min={BRUSH_MIN}
                    max={BRUSH_MAX}
                    value={brushSize}
                    onChange={(e) => setBrushSize(Number(e.target.value))}
                    className="w-16"
                    title={t("studio.brushRadiusTitle", { size: brushSize })}
                  />
                  <span
                    className="text-[11px] text-muted-foreground w-9 text-right tabular-nums"
                    title={t("studio.imagePixelRadiusTitle")}
                  >
                    {brushSize}px
                  </span>
                  <div className="w-px h-4 bg-white/10 mx-1" />
                  <span
                    className="text-[10px] text-muted-foreground tracking-wide"
                    title={t("studio.editStrengthTitle")}
                  >
                    {t("studio.strength")}
                  </span>
                  <input
                    type="range"
                    min={STRENGTH_MIN}
                    max={STRENGTH_MAX}
                    value={brushStrength}
                    onChange={(e) => setBrushStrength(Number(e.target.value))}
                    className="w-16"
                    title={t("studio.editStrengthValueTitle", { strength: brushStrength })}
                  />
                  <span
                    className="text-[11px] text-muted-foreground w-9 text-right tabular-nums"
                    title={t("studio.lowerStrengthTitle")}
                  >
                    {brushStrength}%
                  </span>
                  <div className="w-px h-4 bg-white/10 mx-1" />
                  <button
                    onClick={handleUndoInpaint}
                    disabled={inpaintUndoCount === 0}
                    title={t("studio.undoTitle")}
                    className="p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={handleResetMask}
                    className="text-[11px] text-muted-foreground px-2 py-0.5 border border-white/[0.06] rounded-md hover:text-foreground transition-colors"
                    title={t("studio.clearMaskTitle")}
                  >
                    {t("studio.reset")}
                  </button>
                  <div className="w-px h-4 bg-white/10 mx-1" />
                  <button
                    onClick={resetZoom}
                    title={t("studio.resetZoomTitle")}
                    className="text-[11px] text-muted-foreground px-2 py-0.5 border border-white/[0.06] rounded-md hover:text-foreground transition-colors tabular-nums"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                </div>
              )}

              {/* 생성 중 오버레이 */}
              {(isGenerating || isRegenerating) && imageLoaded && (
                <div
                  className="absolute inset-0 z-20 flex items-center justify-center"
                  style={{ background: "hsl(var(--background) / 0.72)", backdropFilter: "blur(2px)" }}
                >
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-foreground" />
                    <span className="text-sm font-medium text-foreground">{t("studio.generating")}</span>
                  </div>
                </div>
              )}
            </div>
          ) : displayUrl ? (
            isPlayableMediaUrl(displayUrl) ? (
              <MediaPlaceholder className="h-full w-full" />
            ) : (
            <img
              src={displayUrl}
              className="rounded-none"
              style={{ width: canvasSize.w || undefined, height: canvasSize.h || undefined, objectFit: "contain" }}
              alt={`Shot #${String(currentScene.scene_number).padStart(2, "0")}`} loading="lazy" decoding="async" />
            )
          ) : (
            <div className="text-muted-foreground text-sm">
              {(currentScene as any).is_transition ? t("studio.transition") : t("studio.noContiImage")}
            </div>
          )}
        </div>

        {/* ─── 우측: 사이드 패널 ─── */}
        <div
          className="w-[510px] shrink-0 border-l border-white/[0.06] flex flex-col"
          style={{ background: "hsl(var(--card))" }}
        >
          <div className="flex border-b border-white/[0.06] shrink-0">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              // Small badge for the Sketches tab so users see at-a-glance
              // how many drafts they already have on this scene without
              // opening the tab first.
              // Defensive `Array.isArray` — legacy version JSON could deliver
              // `sketches` as the string `"[]"` (length 2) and surface a
              // misleading "2" badge.
              const sketchCount = Array.isArray(currentScene.sketches)
                ? currentScene.sketches.length
                : 0;
              const badge = tab.id === "sketches" && sketchCount > 0 ? sketchCount : null;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setPreviewUrl(null);
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 h-8 text-[11px] font-medium transition-colors relative"
                  style={{ color: isActive ? KR : "hsl(var(--muted-foreground))" }}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t(tab.labelKey)}
                  {badge !== null && (
                    <span
                      className="ml-0.5 text-[9.5px] font-bold px-1 rounded-sm tracking-wide"
                      style={{
                        background: isActive ? KR : "hsl(var(--muted))",
                        color: isActive ? "#fff" : "hsl(var(--muted-foreground))",
                      }}
                    >
                      {badge}
                    </span>
                  )}
                  {isActive && (
                    <div className="absolute bottom-0 left-2 right-2 h-[2px] rounded-none" style={{ background: KR }} />
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* ━━━ View ━━━ */}
            {activeTab === "view" && (
              <div className="p-4 space-y-4">
                <div className="space-y-3">
                  {currentScene.camera_angle && (
                    <div>
                      <div className="text-[10px] text-muted-foreground/60 tracking-wider mb-1">{t("studio.camera")}</div>
                      <div className="text-[13px] text-foreground">
                        {renderMentions(currentScene.camera_angle, assets)}
                      </div>
                    </div>
                  )}
                  {currentScene.mood && (
                    <div>
                      <div className="text-[10px] text-muted-foreground/60 tracking-wider mb-1">{t("studio.mood")}</div>
                      <div className="text-[13px] text-foreground">{renderMentions(currentScene.mood, assets)}</div>
                    </div>
                  )}
                  {currentScene.location && (
                    <div>
                      <div className="text-[10px] text-muted-foreground/60 tracking-wider mb-1">{t("studio.location")}</div>
                      <div className="text-[13px] text-foreground">{renderMentions(currentScene.location, assets)}</div>
                    </div>
                  )}
                  {currentScene.duration_sec && (
                    <div>
                      <div className="text-[10px] text-muted-foreground/60 tracking-wider mb-1">{t("studio.duration")}</div>
                      <div className="text-[13px] text-foreground">{currentScene.duration_sec}s</div>
                    </div>
                  )}
                </div>
                {currentScene.description && (
                  <div>
                    <div className="text-[10px] text-muted-foreground/60 tracking-wider mb-1">{t("studio.description")}</div>
                    <p className="text-[12px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
                      {renderMentions(currentScene.description, assets)}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ━━━ Editor ━━━ */}
            {activeTab === "editor" && (
              <div className="p-4 space-y-3">
                <p className="text-[11px] text-muted-foreground">
                  {t("studio.editorHelp")}
                </p>
                <p className="text-[10px] text-muted-foreground/60">
                  {t("studio.editorHelp2")}
                </p>
              </div>
            )}

            {/* ━━━ Inpaint ━━━ */}
            {activeTab === "edit" && (
              <div className="flex flex-col h-full">
                <div className="px-4 py-3 border-b border-white/[0.06]">
                  <p className="text-[11px]" style={{ color: hasMask ? KR : "hsl(var(--muted-foreground))" }}>
                    {hasMask ? t("studio.modifyPaintedArea") : t("studio.modifyEntireImage")}
                  </p>
                </div>
                <div className="px-4 py-3 border-b border-white/[0.06] space-y-2">
                  <div
                    onDragOver={(e) => {
                      if (!isFileDrag(e.dataTransfer)) return;
                      e.preventDefault();
                      setIsDragOver(true);
                    }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={(e) => {
                      if (!isFileDrag(e.dataTransfer)) return;
                      e.preventDefault();
                      setIsDragOver(false);
                      const files = Array.from(e.dataTransfer.files)
                        .filter((f) => f.type.startsWith("image/"))
                        .slice(0, 3 - customRefImages.length);
                      if (files.length > 0) {
                        files.forEach((file) => {
                          setCustomRefImages((prev) => [...prev, { preview: URL.createObjectURL(file), file }]);
                        });
                        insertPromptTagAtCursor("[ref-img]", false);
                      }
                    }}
                    style={{
                      border: isDragOver ? "1.5px dashed #f9423a" : "1.5px dashed transparent",
                      borderRadius: 0,
                      transition: "border 0.15s",
                      background: isDragOver ? "rgba(249,66,58,0.04)" : "transparent",
                    }}
                  >
                    <MentionInput
                      value={inpaintPrompt}
                      onChange={setInpaintPrompt}
                      assets={assets as any}
                      placeholder={t("studio.promptPlaceholder")}
                      minHeight={72}
                      textareaRef={inpaintInputRef}
                      squareCorners
                      onSubmit={() => {
                        if (inpaintPrompt.trim() && !isGenerating && imageLoaded) handleInpaint();
                      }}
                    />
                    {isDragOver && (
                      <div className="text-center py-1" style={{ fontSize: 11, color: KR }}>
                        {t("studio.dropReferenceImages")}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      ref={customRefInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handleCustomRefUpload}
                    />
                    {customRefImages.length < 3 && (
                      <button
                        onClick={() => customRefInputRef.current?.click()}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-dashed border-white/[0.06] transition-colors"
                      >
                        <Upload className="w-3 h-3" /> {t("studio.images")} ({customRefImages.length}/3)
                      </button>
                    )}
                    {customRefImages.map((img, i) => (
                      <div
                        key={i}
                        className="relative group w-8 h-8 rounded overflow-hidden border border-white/[0.06]"
                      >
                        <img src={img.preview} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                        <button
                          onClick={() => removeCustomRef(i)}
                          className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ background: "rgba(0,0,0,0.5)" }}
                        >
                          <X className="w-3 h-3 text-white" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={handleInpaint}
                    disabled={!inpaintPrompt.trim() || isGenerating || !imageLoaded}
                    className="w-full py-2 rounded-none text-white text-[12px] font-semibold disabled:opacity-40 transition-colors"
                    style={{ background: isGenerating ? "rgba(249,66,58,0.6)" : KR }}
                  >
                    {isGenerating ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("studio.generating")}
                      </span>
                    ) : (
                      t("studio.editImage")
                    )}
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {moodReferenceUrl && (
                    <div className="border-b border-white/[0.06]">
                      <div className="w-full flex items-center justify-between px-4 py-2 text-[11px] font-semibold text-muted-foreground">
                        <span>{t("studio.moodReference")}</span>
                      </div>
                      <div className="px-3 pb-3">
                        <button
                          type="button"
                          onClick={() => setUseMoodRef((v) => !v)}
                          className="relative rounded-none overflow-hidden border-2 transition-all w-full"
                          style={{ borderColor: useMoodRef ? KR : "transparent" }}
                        >
                          <img src={moodReferenceUrl} className="block w-full aspect-video object-cover rounded-none" loading="lazy" decoding="async" />
                          {useMoodRef && (
                            <div
                              className="absolute top-1 right-1 w-4 h-4 flex items-center justify-center"
                              style={{ background: KR }}
                            >
                              <svg
                                width={9}
                                height={9}
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="#fff"
                                strokeWidth={3}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M20 6L9 17l-5-5" />
                              </svg>
                            </div>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                  {compareSelectedRefs.length > 0 && (
                    <div className="px-4 py-3 border-b border-white/[0.06]">
                      <div style={{ fontSize: 11, color: "#999" }} className="mb-2">
                        {t("studio.references")}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {compareSelectedRefs.map((url, i) => (
                          <div
                            key={i}
                            className="relative group w-16 h-16 rounded-none overflow-hidden border border-white/[0.06]"
                          >
                            <img src={url} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                            <button
                              onClick={() => setCompareSelectedRefs((prev) => prev.filter((_, idx) => idx !== i))}
                              className="absolute top-0.5 right-0.5 w-4 h-4 flex items-center justify-center rounded-none opacity-0 group-hover:opacity-100 transition-opacity"
                              style={{ background: "rgba(0,0,0,0.7)" }}
                            >
                              <X className="w-2.5 h-2.5 text-white" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ━━━ Sketches ━━━ */}
            {activeTab === "sketches" && (
              <StudioSketchesTab
                projectId={currentScene.project_id}
                scene={currentScene}
                allScenes={allScenes}
                assets={assets}
                videoFormat={videoFormat}
                briefAnalysis={briefAnalysis ?? null}
                onSetAsSceneImage={(url) => onSaveInpaint(url, currentScene)}
                onAddToEditRefs={(url) => {
                  setCompareSelectedRefs((prev) => (prev.includes(url) ? prev : [...prev, url]));
                  toast({ title: t("studio.addedToEditRefs") });
                }}
                // Reuse the same previewUrl state the History tab drives.
                // `displayUrl` (line ~1926) already prefers `previewUrl` over
                // `currentScene.conti_image_url`, so passing the setter
                // through here gives Sketches History-tab parity for free
                // — no new canvas-render branch needed.
                previewUrl={previewUrl}
                onPreview={setPreviewUrl}
                onSketchesUpdated={(updater) => onSketchesUpdated?.(currentScene.id, updater)}
              />
            )}

            {/* ━━━ History ━━━ */}
            {activeTab === "history" && (
              <div className="p-4">
                {currentImageHistory.length === 0 ? (
                  <EmptyState
                    icon={<History className="w-8 h-8" />}
                    title={t("studio.noHistory")}
                    compact
                  />
                ) : (
                  <div className="space-y-3">
                    {currentImageHistory.map((url, idx) => (
                      <div
                        key={idx}
                        className="relative group rounded-none overflow-hidden border border-white/[0.06] bg-background"
                      >
                        <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.06]">
                          <span className="text-[11px] text-muted-foreground">
                            {idx === 0 ? t("studio.previous") : t("studio.ago", { count: idx + 1 })}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setPreviewUrl(previewUrl === url ? null : url)}
                              className="text-[10px] px-2 py-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                            >
                              {previewUrl === url ? t("studio.current") : t("studio.preview")}
                            </button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={deletingHistoryUrl !== null}
                              onClick={() => {
                                onRollback(url, currentScene);
                                toast({ title: t("studio.sceneRestored", { scene: String(currentScene.scene_number).padStart(2, "0") }) });
                              }}
                              className="gap-1 text-[11px] h-6 px-2"
                              style={{ color: KR }}
                            >
                              <RotateCcw className="w-3 h-3" /> {t("studio.restore")}
                            </Button>
                          </div>
                        </div>
                        <div className={`relative ${ASPECT_CLASS[videoFormat]} bg-background`}>
                          <img src={url} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                          <button
                            disabled={!onDeleteHistory || deletingHistoryUrl !== null}
                            onClick={async () => {
                              if (!onDeleteHistory) return;
                              setDeletingHistoryUrl(url);
                              try {
                                if (previewUrl === url) setPreviewUrl(null);
                                await onDeleteHistory(url, currentScene);
                                toast({ title: t("studio.historyDeleted", { scene: String(currentScene.scene_number).padStart(2, "0") }) });
                              } finally {
                                setDeletingHistoryUrl(null);
                              }
                            }}
                            className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:hidden"
                            style={{ background: "rgba(0,0,0,0.65)" }}
                            title={t("studio.deleteFromHistory")}
                          >
                            {deletingHistoryUrl === url ? (
                              <Loader2 className="w-3 h-3 text-white animate-spin" />
                            ) : (
                              <X className="w-3 h-3 text-white" />
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ━━━ Compare ━━━ */}
            {activeTab === "compare" &&
              (() => {
                // Library URLs known to belong to attached library references.
                // We strip these from the legacy mood list because library
                // imports now live in their own section below — that section
                // renders kind-aware previews so animated raster doesn't leak
                // into a bare <img>.
                const libraryUrlSet = new Set<string>();
                for (const ref of libraryReferences ?? []) {
                  const previewUrl = getReferencePreviewImageUrl(ref);
                  if (previewUrl) libraryUrlSet.add(previewUrl);
                  if (ref.file_url) libraryUrlSet.add(ref.file_url);
                  if (ref.thumbnail_url) libraryUrlSet.add(ref.thumbnail_url);
                }
                const allMoodUrls = (moodImages ?? [])
                  .filter((u) => !brokenMoodUrls.has(u))
                  .filter((u) => !libraryUrlSet.has(u));
                const bookmarkSet = new Set(moodBookmarks ?? []);
                const sortedMoods = [
                  ...allMoodUrls.filter((u) => bookmarkSet.has(u)),
                  ...allMoodUrls.filter((u) => !bookmarkSet.has(u)),
                ];
                const hasSceneImages = versions.some((v) =>
                  (v.scenes as Scene[]).some((s) => s.conti_image_url && s.id !== currentScene.id),
                );
                const visibleLibraryRefs = (libraryReferences ?? []).filter(
                  (ref) => ref.kind !== "link" && !ref.deleted_at && Boolean(getReferencePreviewImageUrl(ref)),
                );
                const hasLibraryRefs = visibleLibraryRefs.length > 0;
                const hasAnyContent = sortedMoods.length > 0 || hasSceneImages || hasLibraryRefs;
                const hasExistingConti = !!currentScene.conti_image_url;
                const onReplaceWithImage = (url: string) => {
                  if (isPlayableMediaUrl(url)) return;
                  onSaveInpaint(url, currentScene);
                  toast({ title: hasExistingConti ? t("studio.imageReplaced") : t("studio.setAsConti") });
                  setComparePreviewUrl(null);
                };
                const addToEditRefs = (url: string) => {
                  setCompareSelectedRefs((prev) => (prev.includes(url) ? prev : [...prev, url]));
                  toast({ title: t("studio.addedToEditRefs") });
                };
                // Pick the URL that should populate the comparePreview when
                // the user clicks a library reference card. For animated
                // raster (kind=gif) prefer the static thumbnail so the
                // preview stays still; the corresponding "Use" action will
                // store that thumbnail as conti_image_url for export safety.
                const referenceCompareUrl = (ref: ReferenceItem): string | null => {
                  if (ref.kind === "gif") return ref.thumbnail_url || ref.file_url || null;
                  if (ref.kind === "video" || ref.kind === "youtube") return ref.thumbnail_url || null;
                  return ref.file_url || ref.thumbnail_url || null;
                };
                const referenceKindBadge = (ref: ReferenceItem): string => {
                  if (ref.kind === "gif") return "GIF";
                  if (ref.kind === "video") return "VIDEO";
                  if (ref.kind === "youtube") return "YT";
                  return "IMG";
                };
                const referenceKindIcon = (ref: ReferenceItem) => {
                  if (ref.kind === "video") return Film;
                  if (ref.kind === "youtube") return Youtube;
                  return ImageIcon;
                };
                return (
                  <div className="flex flex-col h-full">
                    <div
                      className="shrink-0 border-b border-white/[0.06] flex flex-col items-center justify-center"
                      style={{ minHeight: 320, maxHeight: 440, background: "rgba(0,0,0,0.2)" }}
                    >
                      {comparePreviewUrl ? (
                        <div className="flex flex-col items-center gap-2 w-full px-4 py-3">
                          {isPlayableMediaUrl(comparePreviewUrl) ? (
                            <MediaPlaceholder className="h-[220px] w-full max-w-[360px]" />
                          ) : (
                            <img
                              src={comparePreviewUrl}
                              className="max-h-[320px] w-auto object-contain rounded-none"
                              alt="preview" loading="lazy" decoding="async" />
                          )}
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => onReplaceWithImage(comparePreviewUrl)}
                              disabled={isPlayableMediaUrl(comparePreviewUrl)}
                              className="px-3 py-1.5 rounded-none text-[11px] font-semibold text-white transition-colors"
                              style={{ background: KR, opacity: isPlayableMediaUrl(comparePreviewUrl) ? 0.45 : 1 }}
                            >
                              {t("studio.use")}
                            </button>
                            {hasExistingConti && (
                              <button
                                onClick={() => addToEditRefs(comparePreviewUrl)}
                                className="px-3 py-1.5 rounded-none text-[11px] font-semibold border transition-colors"
                                style={{ borderColor: "rgba(255,255,255,0.15)", color: "hsl(var(--foreground))" }}
                              >
                                <span className="flex items-center gap-1">
                                  {t("studio.addToEdit")}
                                </span>
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: "#666" }}>{t("studio.clickPreview")}</span>
                      )}
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-0">
                      {!hasAnyContent && (
                        <div className="flex flex-col items-center justify-center h-32 gap-2">
                          <Columns2 className="w-8 h-8 text-border" />
                          <p className="text-[12px] text-muted-foreground">{t("studio.noReferenceImages")}</p>
                        </div>
                      )}
                      {hasSceneImages && (
                        <div className="mb-4">
                          <div style={{ fontSize: 12, color: "#999" }} className="mb-2">
                            {t("studio.sceneReference")}
                          </div>
                          {versions.map((v) => {
                            const vScenes = (v.scenes as Scene[]).filter(
                              (s) => s.conti_image_url && s.id !== currentScene.id,
                            );
                            if (vScenes.length === 0) return null;
                            return (
                              <div key={v.id} className="mb-3">
                                <div style={{ fontSize: 11, color: "#666" }} className="mb-1.5">
                                  {t("conti.versionShort", { num: v.version_number })}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {vScenes.map((vScene) => {
                                    const isRef = compareSelectedRefs.includes(vScene.conti_image_url!);
                                    return (
                                      <button
                                        key={`${v.id}-${vScene.scene_number}`}
                                        onClick={() => setComparePreviewUrl(vScene.conti_image_url!)}
                                        className="relative rounded-none overflow-hidden transition-all"
                                        style={{
                                          width: 64,
                                          height: 64,
                                          border: isRef ? `2px solid ${KR}` : "2px solid rgba(255,255,255,0.06)",
                                        }}
                                      >
                                        {isPlayableMediaUrl(vScene.conti_image_url) ? (
                                          <MediaPlaceholder className="h-full w-full" />
                                        ) : (
                                          <img
                                            src={vScene.conti_image_url!}
                                            className="w-full h-full object-cover"
                                            loading="lazy" decoding="async" />
                                        )}
                                        <div
                                          className="absolute top-0.5 left-0.5 text-[8px] font-bold px-1 py-0.5 rounded-none text-white"
                                          style={{ background: "rgba(0,0,0,0.6)" }}
                                        >
                                          {formatSceneRefLabel(vScene)}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {hasLibraryRefs && (
                        <div style={{ marginTop: hasSceneImages ? 16 : 0 }} className="mb-4">
                          <div className="mb-2 flex items-center justify-between">
                            <div className="flex items-center gap-1.5" style={{ fontSize: 12, color: "#999" }}>
                              <Library className="h-3.5 w-3.5" />
                              <span>Library</span>
                              <span className="font-mono text-[10px] text-muted-foreground/60">
                                {visibleLibraryRefs.length}
                              </span>
                            </div>
                            {onOpenLibraryPicker ? (
                              <button
                                type="button"
                                onClick={onOpenLibraryPicker}
                                className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors"
                              >
                                + Add
                              </button>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {visibleLibraryRefs.map((ref) => {
                              const compareUrl = referenceCompareUrl(ref);
                              const isRef = compareUrl ? compareSelectedRefs.includes(compareUrl) : false;
                              const Icon = referenceKindIcon(ref);
                              const badge = referenceKindBadge(ref);
                              // Pick the static thumbnail source per kind:
                              //   - image: file_url is the static asset
                              //   - video / youtube: thumbnail_url holds the
                              //     poster (static); the original is only
                              //     used for hover-play on the Conti card
                              //   - gif: prefer the static poster extracted
                              //     at upload; if missing (legacy upload),
                              //     no thumbnail is shown so the glyph card
                              //     covers up the animation.
                              const thumbSrc =
                                ref.kind === "image"
                                  ? ref.file_url ?? ref.thumbnail_url ?? null
                                  : ref.kind === "video" || ref.kind === "youtube"
                                    ? ref.thumbnail_url ?? null
                                    : ref.kind === "gif"
                                      ? ref.thumbnail_url && ref.thumbnail_url !== ref.file_url
                                        ? ref.thumbnail_url
                                        : null
                                      : null;
                              const showThumb = Boolean(thumbSrc) && !brokenLibraryRefIds.has(ref.id);
                              return (
                                <button
                                  key={ref.id}
                                  type="button"
                                  onClick={() => compareUrl && setComparePreviewUrl(compareUrl)}
                                  title={ref.title}
                                  className="relative rounded-none overflow-hidden transition-all bg-black/40"
                                  style={{
                                    width: 64,
                                    height: 64,
                                    border: isRef ? `2px solid ${KR}` : "2px solid rgba(255,255,255,0.06)",
                                  }}
                                >
                                  {showThumb ? (
                                    <img
                                      src={thumbSrc!}
                                      className="w-full h-full object-cover"
                                      loading="lazy"
                                      decoding="async"
                                      onError={() => markLibraryRefBroken(ref.id)}
                                    />
                                  ) : (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-white/65">
                                      <Icon className="h-4 w-4" />
                                      <span className="font-mono text-[8px] tracking-[0.1em]">{badge}</span>
                                    </div>
                                  )}
                                  <span
                                    className="absolute left-0.5 top-0.5 bg-black/70 px-1 py-px font-mono text-[8px] text-white"
                                  >
                                    {badge}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {sortedMoods.length > 0 && (
                        <div style={{ marginTop: hasSceneImages || hasLibraryRefs ? 16 : 0 }}>
                          <div style={{ fontSize: 12, color: "#999" }} className="mb-2">
                            {t("studio.moodReference")}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {sortedMoods.map((url, i) => {
                              const isBookmarked = bookmarkSet.has(url);
                              const isRef = compareSelectedRefs.includes(url);
                              return (
                                <button
                                  key={i}
                                  onClick={() => setComparePreviewUrl(url)}
                                  className="relative rounded-none overflow-hidden transition-all"
                                  style={{
                                    width: 64,
                                    height: 64,
                                    border: isRef ? `2px solid ${KR}` : "2px solid rgba(255,255,255,0.06)",
                                  }}
                                >
                                  {isPlayableMediaUrl(url) ? (
                                    <MediaPlaceholder className="h-full w-full" />
                                  ) : (
                                    <img
                                      src={url}
                                      className="w-full h-full object-cover"
                                      loading="lazy"
                                      decoding="async"
                                      onError={() => markMoodUrlBroken(url)}
                                    />
                                  )}
                                  {isBookmarked && (
                                    <div
                                      className="absolute top-0.5 right-0.5 flex items-center justify-center rounded-none"
                                      style={{ width: 14, height: 14, background: KR }}
                                    >
                                      <Heart className="w-2 h-2 text-white fill-white" />
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
          </div>
        </div>
      </div>
    </div>
  );
};
