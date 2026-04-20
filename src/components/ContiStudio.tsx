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

  /* ── 드로잉 상태 ── */
  const isDrawingRef = useRef(false);
  const [brushSize, setBrushSize] = useState(30);
  const brushSizeRef = useRef(30);
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

  /* ── Undo 스택 ── */
  type InpaintSnap = { mask: ImageData; overlay: ImageData | null };
  const inpaintUndoRef = useRef<InpaintSnap[]>([]);
  const [inpaintUndoCount, setInpaintUndoCount] = useState(0);

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
      if (e.key === "ArrowLeft" && hasPrev) setCurrentIndex((i) => i - 1);
      if (e.key === "ArrowRight" && hasNext) setCurrentIndex((i) => i + 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, hasPrev, hasNext, activeTab]);

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

  /* ━━━ Undo 스냅샷 ━━━ */
  const saveInpaintSnapshot = useCallback(() => {
    const mc = maskCanvasRef.current;
    const oc = overlayCanvasRef.current;
    if (!mc || !mc.width) return;
    const maskData = mc.getContext("2d")!.getImageData(0, 0, mc.width, mc.height);
    const overlayData = oc ? oc.getContext("2d")!.getImageData(0, 0, oc.width, oc.height) : null;
    inpaintUndoRef.current = [
      ...inpaintUndoRef.current.slice(-(MAX_INPAINT_UNDO - 1)),
      { mask: maskData, overlay: overlayData },
    ];
    setInpaintUndoCount(inpaintUndoRef.current.length);
  }, []);

  const handleUndoInpaint = () => {
    if (inpaintUndoRef.current.length === 0) return;
    const snap = inpaintUndoRef.current[inpaintUndoRef.current.length - 1];
    inpaintUndoRef.current = inpaintUndoRef.current.slice(0, -1);
    setInpaintUndoCount(inpaintUndoRef.current.length);
    const mc = maskCanvasRef.current;
    const oc = overlayCanvasRef.current;
    if (mc) mc.getContext("2d")!.putImageData(snap.mask, 0, 0);
    if (oc) {
      if (snap.overlay) oc.getContext("2d")!.putImageData(snap.overlay, 0, 0);
      else oc.getContext("2d")!.clearRect(0, 0, oc.width, oc.height);
    }
    const d = snap.mask.data;
    const hasAny = d.some((v, i) => i % 4 === 0 && v > 0);
    setHasMask(hasAny);
  };

  const paintAt = useCallback((cx: number, cy: number, divW: number, divH: number) => {
    const mc = maskCanvasRef.current;
    const oc = overlayCanvasRef.current;
    if (!mc || !mc.width || !mc.height || divW <= 0 || divH <= 0) return;

    const sx = mc.width / divW;
    const sy = mc.height / divH;
    const x = cx * sx;
    const y = cy * sy;
    const r = brushSizeRef.current * ((sx + sy) / 2);

    if (toolModeRef.current === "eraser") {
      const mctx = mc.getContext("2d")!;
      mctx.save();
      mctx.globalCompositeOperation = "destination-out";
      mctx.beginPath();
      mctx.arc(x, y, r, 0, Math.PI * 2);
      mctx.fillStyle = "rgba(0,0,0,1)";
      mctx.fill();
      mctx.restore();
      if (oc) {
        const octx = oc.getContext("2d")!;
        octx.save();
        octx.globalCompositeOperation = "destination-out";
        octx.beginPath();
        octx.arc(x, y, r, 0, Math.PI * 2);
        octx.fillStyle = "rgba(0,0,0,1)";
        octx.fill();
        octx.restore();
      }
    } else {
      const mctx = mc.getContext("2d")!;
      mctx.save();
      mctx.globalCompositeOperation = "source-over";
      mctx.fillStyle = "rgba(255,255,255,1)";
      mctx.beginPath();
      mctx.arc(x, y, r, 0, Math.PI * 2);
      mctx.fill();
      mctx.restore();
      if (oc) {
        const octx = oc.getContext("2d")!;
        octx.save();
        octx.globalCompositeOperation = "source-over";
        octx.fillStyle = "rgba(249,66,58,0.85)";
        octx.beginPath();
        octx.arc(x, y, r, 0, Math.PI * 2);
        octx.fill();
        octx.restore();
      }
    }
    setHasMask(true);
  }, []);

  const drawCursorAt = useCallback((clientX: number, clientY: number) => {
    const cc = cursorCanvasRef.current;
    const div = eventDivRef.current;
    if (!cc || !div) return;
    const rect = div.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (cc.width !== Math.round(rect.width) || cc.height !== Math.round(rect.height)) {
      cc.width = Math.round(rect.width);
      cc.height = Math.round(rect.height);
    }
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const ctx = cc.getContext("2d")!;
    ctx.clearRect(0, 0, cc.width, cc.height);
    ctx.beginPath();
    ctx.arc(x, y, brushSizeRef.current, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, brushSizeRef.current, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }, []);

  const clearCursor = useCallback(() => {
    const cc = cursorCanvasRef.current;
    if (!cc) return;
    cc.getContext("2d")?.clearRect(0, 0, cc.width, cc.height);
  }, []);

  const handleDrawMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isGenerating) return;
      e.preventDefault();

      const div = e.currentTarget;
      const rect = div.getBoundingClientRect();

      saveInpaintSnapshot();
      isDrawingRef.current = true;

      paintAt(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);

      const onDocMove = (me: MouseEvent) => {
        if (!isDrawingRef.current) return;
        const r = div.getBoundingClientRect();
        drawCursorAt(me.clientX, me.clientY);
        paintAt(me.clientX - r.left, me.clientY - r.top, r.width, r.height);
      };
      const onDocUp = () => {
        isDrawingRef.current = false;
        document.removeEventListener("mousemove", onDocMove);
        document.removeEventListener("mouseup", onDocUp);
      };

      document.addEventListener("mousemove", onDocMove);
      document.addEventListener("mouseup", onDocUp);
    },
    [isGenerating, paintAt, drawCursorAt, saveInpaintSnapshot],
  );

  const handleDrawMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDrawingRef.current) drawCursorAt(e.clientX, e.clientY);
    },
    [drawCursorAt],
  );

  const handleDrawMouseLeave = useCallback(() => {
    if (!isDrawingRef.current) clearCursor();
  }, [clearCursor]);

  const handleDrawTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (isGenerating) return;
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;

      const div = e.currentTarget;
      const rect = div.getBoundingClientRect();

      saveInpaintSnapshot();
      isDrawingRef.current = true;
      paintAt(touch.clientX - rect.left, touch.clientY - rect.top, rect.width, rect.height);

      const onTouchMove = (te: TouchEvent) => {
        if (!isDrawingRef.current) return;
        const t = te.touches[0];
        if (!t) return;
        const r = div.getBoundingClientRect();
        paintAt(t.clientX - r.left, t.clientY - r.top, r.width, r.height);
      };
      const onTouchEnd = () => {
        isDrawingRef.current = false;
        document.removeEventListener("touchmove", onTouchMove);
        document.removeEventListener("touchend", onTouchEnd);
      };

      document.addEventListener("touchmove", onTouchMove, { passive: false });
      document.addEventListener("touchend", onTouchEnd);
    },
    [isGenerating, paintAt, saveInpaintSnapshot],
  );

  /* ━━━ Reset ━━━ */
  const handleResetMask = () => {
    const mc = maskCanvasRef.current;
    if (mc) mc.getContext("2d")!.clearRect(0, 0, mc.width, mc.height);
    const oc = overlayCanvasRef.current;
    if (oc) oc.getContext("2d")!.clearRect(0, 0, oc.width, oc.height);
    setHasMask(false);
    inpaintUndoRef.current = [];
    setInpaintUndoCount(0);
  };

  /* ━━━ 마스크 추출 ━━━ */
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

  const buildEnrichedPrompt = async (): Promise<string> => {
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
        body: { prompt: rawPrompt, hasMask: !maskEmpty, assetDescriptions: assetDescriptions || undefined },
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
    const useNanoBanana = maskEmptyVal;
    const moodRefUrls = useMoodRef && moodReferenceUrl ? [moodReferenceUrl] : [];
    const mentionedTagNames = (promptText.match(/@([\w가-힣]+)/g) || []).map((t) => t.slice(1));
    const REMOVAL_KEYWORDS = /제거|삭제|없애|지워|지우|remove|delete|erase|get rid/i;
    const isRemoval = REMOVAL_KEYWORDS.test(promptText);
    const assetRefUrls = isRemoval
      ? []
      : mentionedTagNames
          .map((name) => assets.find((a) => a.tag_name === name || a.tag_name === `@${name}`))
          .filter(Boolean)
          .filter((a) => a!.photo_url)
          .map((a) => a!.photo_url as string);
    const selectedRefs = [...compareSelectedRefs];
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
        const referenceImageUrls = [...moodRefUrls, ...assetRefUrls, ...selectedRefs, ...customRefUrls].slice(0, 3);
        const enrichedPrompt = await buildEnrichedPrompt();
        const body: Record<string, any> = {
          mode: "inpaint",
          imageBase64,
          maskBase64: maskB64,
          prompt: enrichedPrompt,
          forceGpt: !useNanoBanana && maskEmptyVal,
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
        const publicUrl = data.publicUrl;
        if (!publicUrl) throw new Error("No image URL returned");
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
            <div className="relative flex items-center justify-center w-full h-full">
              {!imageLoaded && !imageError && (
                <div className="text-muted-foreground text-sm flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading image...
                </div>
              )}
              {imageError && <div className="text-destructive text-sm">Failed to load image</div>}

              {/* 캔버스 컨테이너 */}
              <div
                className="relative shrink-0"
                style={{
                  width: imageLoaded ? canvasSize.w : undefined,
                  height: imageLoaded ? canvasSize.h : undefined,
                  display: imageLoaded ? "block" : "none",
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
                {/* 레이어 5: 이벤트 캡처 div */}
                <div
                  ref={eventDivRef}
                  style={{
                    position: "absolute",
                    inset: 0,
                    cursor: "none",
                    touchAction: "none",
                    pointerEvents: isGenerating ? "none" : "auto",
                  }}
                  onMouseDown={handleDrawMouseDown}
                  onMouseMove={handleDrawMouseMove}
                  onMouseLeave={handleDrawMouseLeave}
                  onTouchStart={handleDrawTouchStart}
                />
              </div>

              {/* 브러시 툴바 */}
              {imageLoaded && (
                <div
                  className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-2 rounded-none border border-white/[0.06]"
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
                    min={5}
                    max={80}
                    value={brushSize}
                    onChange={(e) => setBrushSize(Number(e.target.value))}
                    className="w-20"
                  />
                  <span className="text-[11px] text-muted-foreground w-5 text-right">{brushSize}</span>
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
                  >
                    Reset
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
              alt={`Scene ${currentScene.scene_number}`}
            />
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
                        <img src={img.preview} className="w-full h-full object-cover" />
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
                          <img src={moodReferenceUrl} className="block w-full aspect-video object-cover rounded-none" />
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
                            <img src={url} className="w-full h-full object-cover" />
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
                  <div className="flex flex-col items-center justify-center h-40 gap-2">
                    <History className="w-8 h-8 text-border" />
                    <p className="text-[12px] text-muted-foreground">No history yet</p>
                  </div>
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
                          <img src={url} className="w-full h-full object-cover" loading="lazy" />
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
                const onReplaceWithImage = (url: string) => {
                  onSaveInpaint(url);
                  toast({ title: "Image replaced" });
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
                            alt="preview"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => onReplaceWithImage(comparePreviewUrl)}
                              className="px-3 py-1.5 rounded text-[11px] font-semibold text-white transition-colors"
                              style={{ background: KR }}
                            >
                              Replace
                            </button>
                            <button
                              onClick={() => addToEditRefs(comparePreviewUrl)}
                              className="px-3 py-1.5 rounded text-[11px] font-semibold border transition-colors"
                              style={{ borderColor: "rgba(255,255,255,0.15)", color: "hsl(var(--foreground))" }}
                            >
                              <span className="flex items-center gap-1">
                                <Plus className="w-3 h-3" /> Add to Edit
                              </span>
                            </button>
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
                                          loading="lazy"
                                        />
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
                                  <img src={url} className="w-full h-full object-cover" loading="lazy" />
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
