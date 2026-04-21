import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  sanitizeImagePrompt,
  IMAGE_SIZE_MAP,
  generateConti,
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
  Plus,
  PenLine,
  Undo2,
} from "lucide-react";
import { AnnotationEditor } from "@/components/conti/AnnotationEditor";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import MentionInput from "@/components/MentionInput";
import { renderMessageWithMentions as renderMentions } from "@/lib/renderMentions";

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
  initialTab?: TabId;
  onClose: () => void;
  onSaveInpaint: (url: string) => void;
  onRollback: (url: string) => void;
  onDeleteHistory?: (url: string) => Promise<void> | void;
  onEditGeneratingChange?: (sceneId: string, generating: boolean) => void;
  onStageChange?: (sceneId: string, stage: GeneratingStage | null) => void;
  isRegenerating?: boolean;
}

/* ━━━━━ 상수 ━━━━━ */
const KR = "#f9423a";
const TYPE_LABEL: Record<string, string> = { character: "Character", item: "Item", background: "Background" };
type TabId = "view" | "editor" | "edit" | "history" | "compare";
const TABS: { id: TabId; label: string; icon: typeof Eye }[] = [
  { id: "view", label: "View", icon: Eye },
  { id: "editor", label: "Editor", icon: PenLine },
  { id: "edit", label: "Inpaint", icon: Paintbrush },
  { id: "history", label: "History", icon: History },
  { id: "compare", label: "Compare", icon: Columns2 },
];
const ASPECT_CLASS: Record<VideoFormat, string> = {
  vertical: "aspect-[9/16]",
  horizontal: "aspect-video",
  square: "aspect-square",
};
const MAX_INPAINT_UNDO = 20;

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
  initialTab,
  onClose,
  onSaveInpaint,
  onRollback,
  onDeleteHistory,
  onEditGeneratingChange,
  onStageChange,
  isRegenerating: externalRegenerating,
}: ContiStudioProps) => {
  const { toast } = useToast();

  const [currentIndex, setCurrentIndex] = useState(() => allScenes.findIndex((s) => s.id === initialScene.id));
  const currentScene = allScenes[currentIndex] ?? initialScene;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < allScenes.length - 1;

  const currentImageHistory: string[] = Array.isArray(imageHistory)
    ? imageHistory
    : (imageHistory[currentScene.scene_number] ?? []);

  const [activeTab, setActiveTab] = useState<TabId>(initialTab ?? "view");

  /* ── 캔버스 refs ── */
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null);
  const eventDivRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  /* ━━━ 키보드 ━━━ */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditing = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
      if (e.key === "Escape") onClose();
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
        // 0 : 줌 리셋
        if (e.key === "0") {
          resetZoom();
          e.preventDefault();
          return;
        }
      }

      if (e.key === "ArrowLeft" && hasPrev) setCurrentIndex((i) => i - 1);
      if (e.key === "ArrowRight" && hasNext) setCurrentIndex((i) => i + 1);
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
  }, [onClose, hasPrev, hasNext, activeTab, resetZoom]);

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

  /* ━━━ 이미지 크기 계산 ━━━ */
  useEffect(() => {
    const url = previewUrl || currentScene.conti_image_url;
    if (!url || !containerRef.current) return;
    const img = new Image();
    img.onload = () => {
      if (!containerRef.current) return;
      const cw = containerRef.current.clientWidth;
      const ch = containerRef.current.clientHeight;
      const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
      setCanvasSize({ w: img.naturalWidth * scale, h: img.naturalHeight * scale });
    };
    img.src = url;
  }, [currentScene.conti_image_url, previewUrl, activeTab]);

  /* ━━━ 이미지 로드 (Inpaint 탭) ━━━ */
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

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(currentScene.conti_image_url!);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
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
          if (containerRef.current) {
            const cw = containerRef.current.clientWidth;
            const ch = containerRef.current.clientHeight;
            const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
            setCanvasSize({ w: img.naturalWidth * scale, h: img.naturalHeight * scale });
          }
          setImageLoaded(true);
          URL.revokeObjectURL(url);
        };
        img.onerror = () => {
          setImageError(true);
          URL.revokeObjectURL(url);
        };
        img.src = url;
      } catch {
        setImageError(true);
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [activeTab, currentScene.conti_image_url]);

  /* ━━━ Undo 스냅샷 (R-채널 1바이트 압축) ━━━ */
  const saveInpaintSnapshot = useCallback(() => {
    const mc = maskCanvasRef.current;
    if (!mc || !mc.width) return;
    const id = mc.getContext("2d")!.getImageData(0, 0, mc.width, mc.height);
    const r = new Uint8Array(mc.width * mc.height);
    for (let i = 0, j = 0; i < id.data.length; i += 4, j++) r[j] = id.data[i];
    inpaintUndoRef.current = [
      ...inpaintUndoRef.current.slice(-(MAX_INPAINT_UNDO - 1)),
      { mask: r, w: mc.width, h: mc.height },
    ];
    setInpaintUndoCount(inpaintUndoRef.current.length);
  }, []);

  /** R-채널 배열에서 마스크 + 오버레이를 결정론적으로 재구성 */
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
      const v = snap.mask[j];
      if (v > 0) hasAny = true;
      mid.data[i] = v;
      mid.data[i + 1] = v;
      mid.data[i + 2] = v;
      mid.data[i + 3] = v; // alpha = R 로 저장 → soft 마스크 가장자리도 보존
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

  /** 한 점에 dot 찍기 (mousedown 시점 — 직전 좌표 없을 때) */
  const drawDot = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    composite: GlobalCompositeOperation,
    fill: string,
  ) => {
    ctx.save();
    ctx.globalCompositeOperation = composite;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  /** 직전 좌표 → 현재 좌표를 굵은 라인으로 연결 (보간) */
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
    ctx.save();
    ctx.globalCompositeOperation = composite;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = r * 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    ctx.restore();
  };

  /**
   * 한 포인터 샘플을 마스크에 반영.
   * 직전 좌표가 있으면 보간 라인을, 없으면 단발 dot 을 찍는다.
   * 빠른 드래그(마우스 이동 이벤트 간격이 큰 경우)에도 점선처럼 끊기지 않도록 보장.
   */
  const paintAt = useCallback((cx: number, cy: number, divW: number, divH: number) => {
    const mc = maskCanvasRef.current;
    const oc = overlayCanvasRef.current;
    if (!mc || !mc.width || !mc.height || divW <= 0 || divH <= 0) return;

    const x = cx * (mc.width / divW);
    const y = cy * (mc.height / divH);
    // brushSize 는 이미지 픽셀 단위 반지름 — 줌/창크기에 무관하게 일정한 굵기 보장
    const r = brushSizeRef.current;

    const isErase = toolModeRef.current === "eraser";
    const composite: GlobalCompositeOperation = isErase ? "destination-out" : "source-over";
    const maskColor = "rgba(255,255,255,1)";
    const overlayColor = isErase ? "rgba(0,0,0,1)" : "rgba(249,66,58,0.85)";

    const mctx = mc.getContext("2d")!;
    const octx = oc?.getContext("2d") ?? null;
    const prev = lastPaintPtRef.current;

    if (prev) {
      drawSegment(mctx, prev.x, prev.y, x, y, r, composite, maskColor);
      if (octx) drawSegment(octx, prev.x, prev.y, x, y, r, composite, overlayColor);
    }
    drawDot(mctx, x, y, r, composite, maskColor);
    if (octx) drawDot(octx, x, y, r, composite, overlayColor);

    lastPaintPtRef.current = { x, y };
    if (!isErase && !hasMaskRef.current) {
      hasMaskRef.current = true;
      setHasMask(true);
    }
  }, []);

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
      paintAt(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
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
      // OS 가 한 프레임에 모은 모든 중간 샘플들 — 빠른 드래그에서 점이 끊기지 않게 함
      const samples =
        typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
      if (samples.length > 0) {
        for (const s of samples) {
          paintAt(s.clientX - rect.left, s.clientY - rect.top, rect.width, rect.height);
        }
      } else {
        paintAt(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
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

  /** mask canvas → 동일 해상도의 white-on-transparent 캔버스 (필요 시 페더링) */
  const buildSoftMaskCanvas = (
    mc: HTMLCanvasElement,
    targetW: number,
    targetH: number,
    featherPx: number,
  ): HTMLCanvasElement => {
    // 1) 마스크 데이터를 흰색 alpha 마스크로 변환 (R 채널 기준)
    const src = mc.getContext("2d")!.getImageData(0, 0, mc.width, mc.height);
    const tmp = document.createElement("canvas");
    tmp.width = mc.width;
    tmp.height = mc.height;
    const tctx = tmp.getContext("2d")!;
    const tid = tctx.createImageData(mc.width, mc.height);
    for (let i = 0; i < src.data.length; i += 4) {
      const a = src.data[i] > 0 ? 255 : 0;
      tid.data[i] = 255;
      tid.data[i + 1] = 255;
      tid.data[i + 2] = 255;
      tid.data[i + 3] = a;
    }
    tctx.putImageData(tid, 0, 0);

    // 2) 타겟 해상도로 리스케일 + 가우시안 블러로 soft edge 생성
    const out = document.createElement("canvas");
    out.width = targetW;
    out.height = targetH;
    const octx = out.getContext("2d")!;
    if (featherPx > 0) {
      octx.filter = `blur(${featherPx}px)`;
    }
    octx.drawImage(tmp, 0, 0, targetW, targetH);
    octx.filter = "none";
    return out;
  };

  /** 마스크 추출 (모델 전달용 PNG, base64) — GPT edits 폴백 경로용 hard mask */
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
      const painted = src.data[i] > 128;
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
   */
  const compositeInpaintResult = async (generatedUrl: string): Promise<Blob | null> => {
    const ic = imageCanvasRef.current;
    const mc = maskCanvasRef.current;
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

    // 3) soft mask 생성
    const featherPx = featherPxFor(W, H);
    const softMask = buildSoftMaskCanvas(mc, W, H, featherPx);

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

  const toggleSceneRef = (s: (typeof otherScenes)[0]) => {
    const isAlreadySelected = selectedSceneRefs.find((x) => x.id === s.id);
    if (isAlreadySelected) {
      setSelectedSceneRefs((p) => p.filter((x) => x.id !== s.id));
      removePromptTag(`[S${s.scene_number}]`);
    } else {
      setSelectedSceneRefs((p) => [...p, s]);
      insertPromptTagAtCursor(`[S${s.scene_number}]`);
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
          // 브러시 모드에서만 SOURCE + TAG 이미지를 같이 보내서 Gemini 가
          //   PRESERVE: (원본에서 보존할 요소)
          //   TAG_IDENTITY: (태그 에셋의 식별 특징)
          // 블록을 모두 포함한 강화 프롬프트를 만들게 한다.
          sourceImageBase64: !maskEmpty && sourceImageBase64 ? sourceImageBase64 : undefined,
          tagImageBase64: !maskEmpty && tagImageBase64 ? tagImageBase64 : undefined,
        },
      });
      if (!error && data?.enhanced) {
        let p = data.enhanced as string;
        if (selectedSceneRefs.length > 0)
          p += `\nMatch the visual style, color grading, and art direction of the referenced scenes.`;
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
    setIsGenerating(true);
    onEditGeneratingChange?.(currentScene.id, true);
    const sceneId = currentScene.id;
    const sceneImageUrl = currentScene.conti_image_url;
    const sceneProjectId = currentScene.project_id;
    const sceneNumber = currentScene.scene_number;
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

    // ── 원본 비율 보존: 로드된 캔버스 크기에서 imageSize 계산 ──
    // imageCanvasRef에 실제 이미지가 그려져 있으므로 W/H가 정확함
    const ic = imageCanvasRef.current;
    const imageSize =
      ic && ic.width > 0 && ic.height > 0 ? computeImageSizeFromDimensions(ic.width, ic.height) : IMAGE_SIZE_MAP[fmt];

    onClose();
    (async () => {
      try {
        // ── inpaint는 단일 API 호출 → 카드에 "1/1" 표시
        onStageChange?.(sceneId, "generating");

        const imgRes = await fetch(sceneImageUrl);
        const imgBlob = await imgRes.blob();
        const imageBase64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.readAsDataURL(imgBlob);
        });
        const customRefUrls = await uploadCustomRefsAndGetUrls();

        // 브러시가 있으면 마스크 오버레이 레퍼런스 생성 — NB2 가 "수정 영역" 을 시각으로 인식
        const maskOverlayUrl = !maskEmptyVal ? await uploadMaskOverlayAndGetUrl(sceneProjectId) : null;

        // ── refs 배치 전략 ─────────────────────────────────────
        // NB2 는 이미지 장수가 늘수록 "합성" 해버리는 경향이 강해지므로,
        // 브러시 인페인트 시에는 의도적으로 총 3장 (원본 + 마스크 오버레이 + 태그 1장) 으로 제한.
        //   · 서버가 sourceImageUrl 을 [0] 에 prepend 하므로 여기서는 [overlay, tag] 만 넘김.
        //   · mood/selectedRefs/custom 는 브러시 모드에서 제외 (noise 감소).
        //   · 태그가 없으면 [overlay] 만.
        //
        // 브러시 없을 때(전체 편집)는 기존대로 asset+mood+selected+custom 합쳐서 3장까지.
        const primaryAssetRef = assetRefUrls[0] ?? null;
        let referenceImageUrls: string[];
        if (maskOverlayUrl) {
          referenceImageUrls = [maskOverlayUrl];
          if (primaryAssetRef) referenceImageUrls.push(primaryAssetRef);
        } else {
          referenceImageUrls = [...assetRefUrls, ...moodRefUrls, ...selectedRefs, ...customRefUrls].slice(0, 3);
        }

        console.log("[Inpaint:refs-debug]", {
          useNanoBanana,
          hasMaskOverlay: !!maskOverlayUrl,
          primaryAssetRef,
          droppedRefsWhenMasked: maskOverlayUrl
            ? {
                extraAssetsDropped: assetRefUrls.slice(1),
                moodRefUrls,
                selectedRefs,
                customRefUrls,
              }
            : null,
          finalReferenceImageUrls: referenceImageUrls,
        });

        // Gemini 가 SOURCE + TAG 를 직접 보고 PRESERVE + TAG_IDENTITY 블록을 생성하도록 두 이미지 base64 전달
        const tagImageBase64 = primaryAssetRef ? await urlToBase64(primaryAssetRef) : null;
        const rawEnrichedPrompt = await buildEnrichedPrompt(imageBase64, tagImageBase64 ?? undefined);
        // ── NB2 mask-overlay prompt ───────────────────────────
        // Reference image order passed to NB2 is (3장 구성):
        //   [1] SOURCE      ← 원본 (서버에서 prepend) — 반드시 보존할 "캔버스"
        //   [2] MASK_HINT   ← 원본 + 브러시 영역을 #FF00FF 로 칠한 합성 PNG
        //   [3] TAG_ASSET   ← 바꿔서 그려 넣을 오브젝트의 정체성 (있을 때)
        //
        // 핵심 문제 2 개 타겟:
        //   A. 원본 유지가 안 됨        → "픽셀 복사 → 마젠타만 교체" 를 여러 각도로 강제
        //   B. 태그 이미지가 너무 강함 → TAG_ASSET 은 식별정보(shape/color/material)만,
        //                                배경/조명/구도/시점/스케일은 절대 복제 금지
        const hasTagRef = !!primaryAssetRef;
        const maskPrefix = maskOverlayUrl
          ? `CRITICAL INPAINTING TASK — read carefully before generating.

Reference images (exact order):
  [1] SOURCE     — the original scene. This is your canvas.
  [2] MASK_HINT  — identical to SOURCE except the region that MUST be edited is painted pure magenta #FF00FF.${hasTagRef ? `
  [3] TAG_ASSET  — a reference photo showing the identity of the object to place inside the magenta region.` : ""}

Hard output rules — ALL must hold:
 1. Your output MUST start from [1] SOURCE, pixel-for-pixel. Treat [1] as an immutable background layer.
 2. Only the pixels inside the magenta region of [2] may change. Every other pixel of your output MUST be pixel-identical to [1] SOURCE — same composition, same crop, same camera angle, same aspect ratio, same lighting, same color grading, same subject poses and positions, same background, same other objects. Do NOT re-render, re-light, re-color, re-frame, re-pose, or re-paint any unmasked pixel.
 3. Inside the magenta region, paint the requested content so it blends into SOURCE. The magenta color must NOT appear in the final output.
 4. Do NOT move, resize, crop, or duplicate the subject. Do NOT add or remove any object outside the magenta region.${hasTagRef ? `
 5. TAG_ASSET identity match (REQUIRED):
    - The object you paint inside the magenta region MUST be recognizably the same specific object as in [3]. Match its exact shape, silhouette, proportions, materials, colors, surface finish, markings/logos/text, and all distinguishing attachments or details.
    - A viewer familiar with [3] must immediately recognize the painted object as the same model/design. Do NOT produce a generic or "similar" version.
    - Refer to the TAG_IDENTITY: block in the edit request below — every feature listed there must appear on the painted object.
    - You MAY adapt only the object's viewing angle, lighting, and scale to match SOURCE naturally. Do NOT copy [3]'s background, surroundings, or photo framing into the output.` : ""}

Self-check before emitting pixels:
 - If your planned output changes ANY unmasked pixel of SOURCE → STOP and restart from rule 1.${hasTagRef ? `
 - If your planned object would NOT be immediately recognizable as the specific object in [3] → STOP and restart from rule 5.
 - If your planned output copies [3]'s background or framing → STOP and restart from rule 5.` : ""}

Edit request (applies ONLY inside the magenta region):
`
          : "";
        const enrichedPrompt = maskPrefix + rawEnrichedPrompt;

        const body: Record<string, any> = {
          mode: "inpaint",
          imageBase64,
          maskBase64: maskB64,
          prompt: enrichedPrompt,
          // NB2 가 실패했을 때만 GPT edits 로 폴백. 브러시 없을 때 GPT 로 억지로 돌리지 않음.
          forceGpt: false,
          projectId: sceneProjectId,
          sceneNumber,
          imageSize, // ← 원본 비율 기반 계산값
          referenceImageUrls,
          useNanoBanana,
          sourceImageUrl: sceneImageUrl,
        };
        const { data, error } = await supabase.functions.invoke("openai-image", { body });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error?.message ?? "Inpainting failed");
        console.log("[Inpaint] used model:", data.usedModel ?? "unknown", "| imageSize:", imageSize);
        const generatedUrl = data.publicUrl;
        if (!generatedUrl) throw new Error("No image URL returned");

        // ── 클라이언트 합성: 마스크 밖은 원본 픽셀로 강제 보존 ─────────
        // NB2/Gemini 같은 generative 모델은 unmasked 영역도 다시 렌더하는 경향이 있어,
        // 클라이언트에서 (원본) + (모델출력 ∩ soft mask) 로 합성해 보존 보장 + 자연스러운 경계.
        let publicUrl = generatedUrl;
        if (!maskEmptyVal) {
          try {
            const blob = await compositeInpaintResult(generatedUrl);
            if (blob) {
              const compositePath = `${sceneProjectId}/scene-${sceneNumber}-inpaint-composite-${Date.now()}.png`;
              const { error: upErr } = await supabase.storage
                .from("contis")
                .upload(compositePath, blob, { upsert: true, contentType: "image/png" });
              if (!upErr) {
                publicUrl = supabase.storage.from("contis").getPublicUrl(compositePath).data.publicUrl;
                console.log("[Inpaint] client-composited (preserved unmasked pixels):", publicUrl);
              } else {
                console.warn("[Inpaint] composite upload failed, using raw model output:", upErr.message);
              }
            }
          } catch (e) {
            console.warn("[Inpaint] client compositing failed, using raw model output:", (e as Error).message);
          }
        }

        await supabase.from("scenes").update({ conti_image_url: publicUrl }).eq("id", sceneId);
        onSaveInpaint(publicUrl);
        toast({ title: "Inpainting complete ✨" });
      } catch (e: any) {
        toast({ title: "Inpainting failed", description: e.message, variant: "destructive" });
      } finally {
        // stage 초기화 — 카드 스피너 해제
        onStageChange?.(sceneId, null);
        onEditGeneratingChange?.(sceneId, false);
      }
    })();
  };

  const handleDownload = () => {
    if (!currentScene.conti_image_url) return;
    const a = document.createElement("a");
    a.href = currentScene.conti_image_url;
    a.download = `scene-${currentScene.scene_number}.png`;
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
              onClick={() => hasPrev && setCurrentIndex((i) => i - 1)}
              disabled={!hasPrev}
              className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => hasNext && setCurrentIndex((i) => i + 1)}
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
                S
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
                const newUrl = await generateConti({
                  scene: currentScene,
                  allScenes,
                  projectId: currentScene.project_id,
                  videoFormat,
                  briefAnalysis: briefAnalysis ?? undefined,
                  styleAnchor,
                  styleImageUrl,
                });
                onSaveInpaint(newUrl);
                toast({ title: "Regeneration complete ✨" });
              } catch (e: any) {
                toast({ title: "Regeneration failed", description: e.message, variant: "destructive" });
              } finally {
                setIsLocalRegenerating(false);
                onEditGeneratingChange?.(currentScene.id, false);
              }
            }}
            disabled={isRegenerating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40"
          >
            {isRegenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}{" "}
            Regenerate
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Download
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
                onSaveInpaint(url);
                onClose();
              }}
              onRestore={(originalUrl) => {
                onSaveInpaint(originalUrl);
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
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading image...
                </div>
              )}
              {imageError && (
                <div className="absolute inset-0 flex items-center justify-center text-destructive text-sm">
                  Failed to load image
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
                    title="Brush"
                  >
                    <Paintbrush className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setToolMode("eraser")}
                    className={`p-1.5 rounded transition-colors ${toolMode === "eraser" ? "text-foreground bg-white/10" : "text-muted-foreground hover:text-foreground"}`}
                    title="Eraser"
                  >
                    <Eraser className="w-3.5 h-3.5" />
                  </button>
                  <div className="w-px h-4 bg-white/10 mx-1" />
                  <input
                    type="range"
                    min={BRUSH_MIN}
                    max={BRUSH_MAX}
                    value={brushSize}
                    onChange={(e) => setBrushSize(Number(e.target.value))}
                    className="w-20"
                    title={`Brush radius: ${brushSize} px (image)`}
                  />
                  <span
                    className="text-[11px] text-muted-foreground w-10 text-right tabular-nums"
                    title="Image-pixel radius (resolution-independent)"
                  >
                    {brushSize}px
                  </span>
                  <div className="w-px h-4 bg-white/10 mx-1" />
                  <button
                    onClick={handleUndoInpaint}
                    disabled={inpaintUndoCount === 0}
                    title="Undo (Ctrl+Z)"
                    className="p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={handleResetMask}
                    className="text-[11px] text-muted-foreground px-2 py-0.5 border border-white/[0.06] rounded-md hover:text-foreground transition-colors"
                    title="Clear mask"
                  >
                    Reset
                  </button>
                  <div className="w-px h-4 bg-white/10 mx-1" />
                  <button
                    onClick={resetZoom}
                    title="Reset zoom (0)"
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
                    <span className="text-sm font-medium text-foreground">Generating...</span>
                  </div>
                </div>
              )}
            </div>
          ) : displayUrl ? (
            <img
              src={displayUrl}
              className="rounded-none"
              style={{ width: canvasSize.w || undefined, height: canvasSize.h || undefined, objectFit: "contain" }}
              alt={`Scene ${currentScene.scene_number}`} loading="lazy" decoding="async" />
          ) : (
            <div className="text-muted-foreground text-sm">
              {(currentScene as any).is_transition ? "Transition" : "No conti image"}
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
                  {tab.label}
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
                      <div className="text-[10px] text-muted-foreground/60 tracking-wider mb-1">Camera</div>
                      <div className="text-[13px] text-foreground">
                        {renderMentions(currentScene.camera_angle, assets)}
                      </div>
                    </div>
                  )}
                  {currentScene.mood && (
                    <div>
                      <div className="text-[10px] text-muted-foreground/60 tracking-wider mb-1">Mood</div>
                      <div className="text-[13px] text-foreground">{renderMentions(currentScene.mood, assets)}</div>
                    </div>
                  )}
                  {currentScene.location && (
                    <div>
                      <div className="text-[10px] text-muted-foreground/60 tracking-wider mb-1">Location</div>
                      <div className="text-[13px] text-foreground">{renderMentions(currentScene.location, assets)}</div>
                    </div>
                  )}
                  {currentScene.duration_sec && (
                    <div>
                      <div className="text-[10px] text-muted-foreground/60 tracking-wider mb-1">Duration</div>
                      <div className="text-[13px] text-foreground">{currentScene.duration_sec}s</div>
                    </div>
                  )}
                </div>
                {currentScene.description && (
                  <div>
                    <div className="text-[10px] text-muted-foreground/60 tracking-wider mb-1">Description</div>
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
                  Draw annotations on the conti image. Use the toolbar at the bottom of the canvas.
                </p>
                <p className="text-[10px] text-muted-foreground/60">
                  Annotations are local-only and do not modify the original image. Use <strong>Save</strong> to download
                  a merged PNG.
                </p>
              </div>
            )}

            {/* ━━━ Inpaint ━━━ */}
            {activeTab === "edit" && (
              <div className="flex flex-col h-full">
                <div className="px-4 py-3 border-b border-white/[0.06]">
                  <p className="text-[11px]" style={{ color: hasMask ? KR : "hsl(var(--muted-foreground))" }}>
                    {hasMask ? "Modify painted area" : "Modify entire image"}
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
                      borderRadius: 8,
                      transition: "border 0.15s",
                      background: isDragOver ? "rgba(249,66,58,0.04)" : "transparent",
                    }}
                  >
                    <MentionInput
                      value={inpaintPrompt}
                      onChange={setInpaintPrompt}
                      assets={assets as any}
                      placeholder="Describe changes... (type @ to tag an asset)"
                      minHeight={72}
                      textareaRef={inpaintInputRef}
                      onSubmit={() => {
                        if (inpaintPrompt.trim() && !isGenerating && imageLoaded) handleInpaint();
                      }}
                    />
                    {isDragOver && (
                      <div className="text-center py-1" style={{ fontSize: 11, color: KR }}>
                        Drop images to add as reference
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
                        <Upload className="w-3 h-3" /> Images ({customRefImages.length}/3)
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
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating...
                      </span>
                    ) : (
                      "Edit Image"
                    )}
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {moodReferenceUrl && (
                    <div className="border-b border-white/[0.06]">
                      <div className="w-full flex items-center justify-between px-4 py-2 text-[11px] font-semibold text-muted-foreground">
                        <span>Mood Reference</span>
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
                        References
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {compareSelectedRefs.map((url, i) => (
                          <div
                            key={i}
                            className="relative group w-16 h-16 rounded overflow-hidden border border-white/[0.06]"
                          >
                            <img src={url} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                            <button
                              onClick={() => setCompareSelectedRefs((prev) => prev.filter((_, idx) => idx !== i))}
                              className="absolute top-0.5 right-0.5 w-4 h-4 flex items-center justify-center rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
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

            {/* ━━━ History ━━━ */}
            {activeTab === "history" && (
              <div className="p-4">
                {currentImageHistory.length === 0 ? (
                  <EmptyState
                    icon={<History className="w-8 h-8" />}
                    title="No history yet"
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
                            {idx === 0 ? "Previous" : `${idx + 1} ago`}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setPreviewUrl(previewUrl === url ? null : url)}
                              className="text-[10px] px-2 py-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                            >
                              {previewUrl === url ? "Current" : "Preview"}
                            </button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={deletingHistoryUrl !== null}
                              onClick={() => {
                                onRollback(url);
                                toast({ title: `Scene ${currentScene.scene_number} restored` });
                              }}
                              className="gap-1 text-[11px] h-6 px-2"
                              style={{ color: KR }}
                            >
                              <RotateCcw className="w-3 h-3" /> Restore
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
                                await onDeleteHistory(url);
                                toast({ title: `Scene ${currentScene.scene_number} history deleted` });
                              } finally {
                                setDeletingHistoryUrl(null);
                              }
                            }}
                            className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:hidden"
                            style={{ background: "rgba(0,0,0,0.65)" }}
                            title="Delete from history"
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
                const allMoodUrls = moodImages ?? [];
                const bookmarkSet = new Set(moodBookmarks ?? []);
                const sortedMoods = [
                  ...allMoodUrls.filter((u) => bookmarkSet.has(u)),
                  ...allMoodUrls.filter((u) => !bookmarkSet.has(u)),
                ];
                const hasSceneImages = versions.some((v) =>
                  (v.scenes as Scene[]).some((s) => s.conti_image_url && s.id !== currentScene.id),
                );
                const hasAnyContent = sortedMoods.length > 0 || hasSceneImages;
                const hasExistingConti = !!currentScene.conti_image_url;
                const onReplaceWithImage = (url: string) => {
                  onSaveInpaint(url);
                  toast({ title: hasExistingConti ? "Image replaced" : "Set as conti image" });
                  setComparePreviewUrl(null);
                };
                const addToEditRefs = (url: string) => {
                  setCompareSelectedRefs((prev) => (prev.includes(url) ? prev : [...prev, url]));
                  toast({ title: "Added to Edit references" });
                };
                return (
                  <div className="flex flex-col h-full">
                    <div
                      className="shrink-0 border-b border-white/[0.06] flex flex-col items-center justify-center"
                      style={{ minHeight: 280, maxHeight: 360, background: "rgba(0,0,0,0.2)" }}
                    >
                      {comparePreviewUrl ? (
                        <div className="flex flex-col items-center gap-2 w-full px-4 py-3">
                          <img
                            src={comparePreviewUrl}
                            className="max-h-[240px] w-auto object-contain rounded"
                            alt="preview" loading="lazy" decoding="async" />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => onReplaceWithImage(comparePreviewUrl)}
                              className="px-3 py-1.5 rounded text-[11px] font-semibold text-white transition-colors"
                              style={{ background: KR }}
                            >
                              {hasExistingConti ? "Replace" : "Use as Conti"}
                            </button>
                            {hasExistingConti && (
                              <button
                                onClick={() => addToEditRefs(comparePreviewUrl)}
                                className="px-3 py-1.5 rounded text-[11px] font-semibold border transition-colors"
                                style={{ borderColor: "rgba(255,255,255,0.15)", color: "hsl(var(--foreground))" }}
                              >
                                <span className="flex items-center gap-1">
                                  <Plus className="w-3 h-3" /> Add to Edit
                                </span>
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: "#666" }}>Click an image to preview</span>
                      )}
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-0">
                      {!hasAnyContent && (
                        <div className="flex flex-col items-center justify-center h-32 gap-2">
                          <Columns2 className="w-8 h-8 text-border" />
                          <p className="text-[12px] text-muted-foreground">No reference images available</p>
                        </div>
                      )}
                      {hasSceneImages && (
                        <div className="mb-4">
                          <div style={{ fontSize: 12, color: "#999" }} className="mb-2">
                            Scene Reference
                          </div>
                          {versions.map((v) => {
                            const vScenes = (v.scenes as Scene[]).filter(
                              (s) => s.conti_image_url && s.id !== currentScene.id,
                            );
                            if (vScenes.length === 0) return null;
                            return (
                              <div key={v.id} className="mb-3">
                                <div style={{ fontSize: 11, color: "#666" }} className="mb-1.5">
                                  v{v.version_number}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {vScenes.map((vScene) => {
                                    const isRef = compareSelectedRefs.includes(vScene.conti_image_url!);
                                    return (
                                      <button
                                        key={`${v.id}-${vScene.scene_number}`}
                                        onClick={() => setComparePreviewUrl(vScene.conti_image_url!)}
                                        className="relative rounded overflow-hidden transition-all"
                                        style={{
                                          width: 64,
                                          height: 64,
                                          border: isRef ? `2px solid ${KR}` : "2px solid rgba(255,255,255,0.06)",
                                        }}
                                      >
                                        <img
                                          src={vScene.conti_image_url!}
                                          className="w-full h-full object-cover"
                                          loading="lazy" decoding="async" />
                                        <div
                                          className="absolute top-0.5 left-0.5 text-[8px] font-bold px-1 py-0.5 rounded text-white"
                                          style={{ background: "rgba(0,0,0,0.6)" }}
                                        >
                                          S{vScene.scene_number}
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
                      {sortedMoods.length > 0 && (
                        <div style={{ marginTop: hasSceneImages ? 16 : 0 }}>
                          <div style={{ fontSize: 12, color: "#999" }} className="mb-2">
                            Mood Reference
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {sortedMoods.map((url, i) => {
                              const isBookmarked = bookmarkSet.has(url);
                              const isRef = compareSelectedRefs.includes(url);
                              return (
                                <button
                                  key={i}
                                  onClick={() => setComparePreviewUrl(url)}
                                  className="relative rounded overflow-hidden transition-all"
                                  style={{
                                    width: 64,
                                    height: 64,
                                    border: isRef ? `2px solid ${KR}` : "2px solid rgba(255,255,255,0.06)",
                                  }}
                                >
                                  <img src={url} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                                  {isBookmarked && (
                                    <div
                                      className="absolute top-0.5 right-0.5 flex items-center justify-center rounded-full"
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
