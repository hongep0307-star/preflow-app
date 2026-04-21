import { useState, useRef, memo, useEffect, useCallback } from "react";
import type { GeneratingStage } from "@/lib/conti";
import {
  Sparkles,
  Download,
  RefreshCw,
  GripVertical,
  Upload,
  History,
  RotateCcw,
  Move,
  X,
  Lightbulb,
  Palette,
} from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { KR, type Scene, type Asset } from "./contiTypes";
import { InlineField, MetaRows, DescriptionField, SidePanel } from "./contiInternals";

const FORMAT_RATIO: Record<string, number> = {
  horizontal: 16 / 9,
  vertical: 9 / 16,
  square: 1,
};
const FORMAT_LABEL: Record<string, string> = {
  horizontal: "16:9",
  vertical: "9:16",
  square: "1:1",
};
const ASPECT_RATIO_STR: Record<string, string> = {
  horizontal: "16 / 9",
  vertical: "9 / 16",
  square: "1 / 1",
};

interface CropState {
  _v?: number;
  x: number;
  y: number;
  scale: number;
  rotate?: number;
  fmt?: string;
  ia?: number;
}

type CropMap = Partial<Record<"horizontal" | "vertical" | "square", CropState>>;

function isCropMap(val: unknown): val is CropMap {
  if (!val || typeof val !== "object") return false;
  return "horizontal" in val || "vertical" in val || "square" in val;
}

function getCropForFmt(stored: unknown, fmt: string): CropState | null {
  if (!stored) return null;
  if (isCropMap(stored)) return (stored as CropMap)[fmt as keyof CropMap] ?? null;
  const s = stored as CropState;
  if (s._v === 2 && (!s.fmt || s.fmt === fmt)) return s;
  return null;
}

function setCropForFmt(stored: unknown, fmt: string, crop: CropState): CropMap {
  const map: CropMap = {};
  if (isCropMap(stored)) Object.assign(map, stored);
  else if (stored) {
    const s = stored as CropState;
    if (s.fmt && s._v === 2) map[s.fmt as keyof CropMap] = s;
  }
  map[fmt as keyof CropMap] = crop;
  return map;
}

function computeImageLayout(
  imgAspect: number,
  containerAspect: number,
  scale: number,
  x: number,
  y: number,
): { wPct: number; hPct: number; leftPct: number; topPct: number } {
  let covWR: number, covHR: number;
  if (imgAspect >= containerAspect) {
    covHR = 1;
    covWR = imgAspect / containerAspect;
  } else {
    covWR = 1;
    covHR = containerAspect / imgAspect;
  }
  const s = scale + 0.2;
  const wPct = s * covWR * 100;
  const hPct = s * covHR * 100;
  return {
    wPct,
    hPct,
    leftPct: 50 - wPct / 2 + x,
    topPct: 50 - hPct / 2 + y,
  };
}

// ─────────────────────────────────────────────────────
// AdjustImageModal
// ─────────────────────────────────────────────────────
function AdjustImageModal({
  imageUrl,
  videoFormat,
  initialCrop,
  onSave,
  onClose,
  onCapture,
}: {
  imageUrl: string;
  videoFormat: string;
  initialCrop: CropState;
  onSave: (crop: CropState) => void;
  onClose: () => void;
  onCapture?: (file: File) => void;
}) {
  const ratio = FORMAT_RATIO[videoFormat] ?? 16 / 9;
  const fmtLabel = FORMAT_LABEL[videoFormat] ?? "16:9";
  const arStr = ASPECT_RATIO_STR[videoFormat] ?? "16 / 9";
  const isPortrait = ratio < 1;

  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const [crop, setCrop] = useState<CropState>({ rotate: 0, ...initialCrop });
  const [zoomInput, setZoomInput] = useState(String(Math.round(((initialCrop.scale ?? 0.8) + 0.2) * 100)));
  const [rotateInput, setRotateInput] = useState(String(initialCrop.rotate ?? 0));
  const [capturing, setCapturing] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [minScale, setMinScale] = useState(0.1);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = imageUrl;
  }, [imageUrl]);

  useEffect(() => {
    if (naturalSize.w <= 0) return;
    const cRatio = FORMAT_RATIO[videoFormat] ?? 16 / 9;
    const imgAspect = naturalSize.w / naturalSize.h;
    const sRenderContain = imgAspect >= cRatio ? cRatio / imgAspect : imgAspect / cRatio;
    const computed = Math.max(0.05, sRenderContain - 0.2);
    setMinScale(computed);
  }, [naturalSize, videoFormat]);

  const getOverflow = useCallback((): { ox: number; oy: number } => {
    const c = containerRef.current;
    if (!c) return { ox: 0, oy: 0 };
    const s = Math.max(0.1, crop.scale) + 0.2;
    const cW = c.clientWidth;
    const cH = c.clientHeight;
    const rad = ((crop.rotate ?? 0) * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    let covW: number, covH: number;
    if (naturalSize.w > 0 && naturalSize.h > 0) {
      const imgAspect = naturalSize.w / naturalSize.h;
      const cAspect = cW / cH;
      if (imgAspect >= cAspect) {
        covH = cH;
        covW = cH * imgAspect;
      } else {
        covW = cW;
        covH = cW / imgAspect;
      }
    } else {
      covW = cW;
      covH = cH;
    }
    const bbW = s * covW * cos + s * covH * sin;
    const bbH = s * covW * sin + s * covH * cos;
    return { ox: Math.abs(bbW - cW) / 2, oy: Math.abs(bbH - cH) / 2 };
  }, [crop.scale, crop.rotate, naturalSize]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    const { ox, oy } = getOverflow();
    const c = containerRef.current;
    if (!c) return;
    const cW = c.clientWidth;
    const cH = c.clientHeight;
    const dxPct = cW > 0 ? (dx / cW) * 100 : 0;
    const dyPct = cH > 0 ? (dy / cH) * 100 : 0;
    const mxPct = cW > 0 ? (ox / cW) * 100 : 0;
    const myPct = cH > 0 ? (oy / cH) * 100 : 0;
    setCrop((prev) => ({
      ...prev,
      x: Math.max(-mxPct, Math.min(mxPct, prev.x + dxPct)),
      y: Math.max(-myPct, Math.min(myPct, prev.y + dyPct)),
    }));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const handleReset = () => {
    setCrop({ x: 0, y: 0, scale: 0.8, rotate: 0 });
    setZoomInput("100");
    setRotateInput("0");
  };

  const captureAsImage = useCallback(async () => {
    const c = containerRef.current;
    if (!c || !onCapture) return;
    setCapturing(true);
    try {
      const { width: cW, height: cH } = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(cW * dpr);
      canvas.height = Math.round(cH * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cW, cH);
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const el = new Image();
        el.crossOrigin = "anonymous";
        el.onload = () => res(el);
        el.onerror = rej;
        el.src = imageUrl;
      });
      const s = Math.max(0.1, crop.scale) + 0.2;
      const rad = ((crop.rotate ?? 0) * Math.PI) / 180;
      const imgAspect = img.naturalWidth / img.naturalHeight;
      const cAspect = cW / cH;
      let covW: number, covH: number;
      if (imgAspect >= cAspect) {
        covH = cH;
        covW = cH * imgAspect;
      } else {
        covW = cW;
        covH = cW / imgAspect;
      }
      ctx.save();
      ctx.translate(cW / 2 + (crop.x / 100) * cW, cH / 2 + (crop.y / 100) * cH);
      ctx.scale(s, s);
      ctx.rotate(rad);
      ctx.drawImage(img, -covW / 2, -covH / 2, covW, covH);
      ctx.restore();
      canvas.toBlob((blob) => {
        if (!blob) return;
        onCapture(new File([blob], "conti-capture.png", { type: "image/png" }));
        onClose();
      }, "image/png");
    } catch (err) {
      console.error("Capture failed:", err);
      alert("이미지 캡처에 실패했습니다. CORS 오류일 수 있습니다.");
    } finally {
      setCapturing(false);
    }
  }, [crop, imageUrl, onCapture, onClose]);

  const displayScale = Math.max(-0.15, crop.scale);
  const rot = crop.rotate ?? 0;
  const wProp = isPortrait ? undefined : videoFormat === "square" ? "min(60vw, 480px)" : "min(88vw, 720px)";

  const imgAspectModal = naturalSize.w > 0 ? naturalSize.w / naturalSize.h : (FORMAT_RATIO[videoFormat] ?? 16 / 9);
  const containerAspectModal = FORMAT_RATIO[videoFormat] ?? 16 / 9;
  const { wPct, hPct, leftPct, topPct } = computeImageLayout(
    imgAspectModal,
    containerAspectModal,
    displayScale,
    crop.x,
    crop.y,
  );

  const inputStyle: React.CSSProperties = {
    width: 48,
    fontSize: 11,
    color: "#fff",
    textAlign: "center",
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: 0,
    padding: "2px 4px",
    outline: "none",
    cursor: "text",
  };

  const btnGhost: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: 34,
    padding: "0 16px",
    fontSize: 13,
    fontWeight: 500,
    color: "#aaa",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 0,
    cursor: "pointer",
  };

  const btnWhite: React.CSSProperties = {
    height: 34,
    padding: "0 16px",
    fontSize: 13,
    fontWeight: 500,
    color: "#fff",
    background: capturing ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.14)",
    border: "1px solid rgba(255,255,255,0.20)",
    borderRadius: 0,
    cursor: capturing ? "default" : "pointer",
    opacity: capturing ? 0.6 : 1,
  };

  const btnPrimary: React.CSSProperties = {
    height: 34,
    padding: "0 16px",
    fontSize: 13,
    fontWeight: 600,
    color: "#fff",
    background: KR,
    border: "none",
    borderRadius: 0,
    cursor: "pointer",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.88)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !dragging.current) onClose();
      }}
    >
      {/* 헤더 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: wProp,
          color: "#fff",
          minWidth: 260,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Move size={14} color={KR} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>Adjust Image</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: KR,
              background: "rgba(249,66,58,0.12)",
              border: `1px solid rgba(249,66,58,0.28)`,
              borderRadius: 0,
              padding: "2px 8px",
            }}
          >
            {fmtLabel} output frame
          </span>
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#999", padding: 4 }}
        >
          <X size={17} />
        </button>
      </div>

      {/* 이미지 조정 영역 */}
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: "relative",
          aspectRatio: arStr,
          overflow: "hidden",
          cursor: "grab",
          userSelect: "none",
          touchAction: "none",
          border: `2px solid ${KR}`,
          borderRadius: 0,
          backgroundColor: "#111",
          width: wProp,
          ...(isPortrait ? { height: "min(68vh, 480px)" } : {}),
        }}
      >
        <div
          style={{
            position: "absolute",
            width: `${wPct}%`,
            height: `${hPct}%`,
            left: `${leftPct}%`,
            top: `${topPct}%`,
            backgroundImage: `url(${imageUrl})`,
            backgroundSize: "cover",
            backgroundRepeat: "no-repeat",
            backgroundColor: "#111",
            transform: rot !== 0 ? `rotate(${rot}deg)` : undefined,
            transformOrigin: "center center",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: 11,
            color: "rgba(255,255,255,0.45)",
            background: "rgba(0,0,0,0.55)",
            padding: "3px 12px",
            borderRadius: 20,
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          Drag to reposition · This frame = output
        </div>
      </div>

      {/* Zoom 슬라이더 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, width: wProp, minWidth: 260 }}>
        <span style={{ fontSize: 11, color: "#666", width: 36 }}>Zoom</span>
        <input
          type="range"
          min={-0.15}
          max={4}
          step={0.05}
          value={displayScale}
          onChange={(e) => {
            const s = parseFloat(e.target.value);
            setCrop((prev) => ({ ...prev, scale: s }));
            setZoomInput(String(Math.round((s + 0.2) * 100)));
          }}
          style={{ flex: 1, accentColor: KR, cursor: "pointer" }}
        />
        <input
          type="text"
          inputMode="numeric"
          value={zoomInput}
          onChange={(e) => setZoomInput(e.target.value.replace(/[^0-9]/g, ""))}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => {
            const v = parseInt(zoomInput, 10);
            if (!isNaN(v)) {
              const renderPct = v / 100;
              const s = Math.max(-0.15, Math.min(4, renderPct - 0.2));
              setCrop((prev) => ({ ...prev, scale: s }));
              setZoomInput(String(Math.round((s + 0.2) * 100)));
            } else {
              setZoomInput(String(Math.round((displayScale + 0.2) * 100)));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.target as HTMLInputElement).blur();
            } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const delta = e.key === "ArrowUp" ? 0.01 : -0.01;
              const s = Math.max(-0.15, Math.min(4, displayScale + delta));
              setCrop((prev) => ({ ...prev, scale: s }));
              setZoomInput(String(Math.round((s + 0.2) * 100)));
            }
          }}
          style={inputStyle}
        />
        <span style={{ fontSize: 11, color: "#666" }}>%</span>
      </div>

      {/* Rotate 슬라이더 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, width: wProp, minWidth: 260 }}>
        <span style={{ fontSize: 11, color: "#666", width: 36 }}>Rotate</span>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={rot}
          onChange={(e) => {
            const r = parseInt(e.target.value);
            setCrop((prev) => ({ ...prev, rotate: r }));
            setRotateInput(String(r));
          }}
          style={{ flex: 1, accentColor: KR, cursor: "pointer" }}
        />
        <input
          type="text"
          inputMode="numeric"
          value={rotateInput}
          onChange={(e) => setRotateInput(e.target.value.replace(/[^0-9\-]/g, ""))}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => {
            const v = parseInt(rotateInput, 10);
            if (!isNaN(v)) {
              const r = Math.max(-180, Math.min(180, v));
              setCrop((prev) => ({ ...prev, rotate: r }));
              setRotateInput(String(r));
            } else {
              setRotateInput(String(rot));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.target as HTMLInputElement).blur();
            } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const delta = e.key === "ArrowUp" ? 1 : -1;
              const r = Math.max(-180, Math.min(180, rot + delta));
              setCrop((prev) => ({ ...prev, rotate: r }));
              setRotateInput(String(r));
            }
          }}
          style={inputStyle}
        />
        <span style={{ fontSize: 11, color: "#666" }}>°</span>
      </div>

      {/* 하단 버튼 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, width: wProp, minWidth: 260 }}>
        <button onClick={handleReset} style={{ ...btnGhost, flex: 1 }}>
          <RotateCcw size={13} /> Reset
        </button>
        <button onClick={onClose} style={{ ...btnGhost, flex: 1, justifyContent: "center" }}>
          Cancel
        </button>
        {onCapture && (
          <button
            onClick={captureAsImage}
            disabled={capturing}
            style={{ ...btnWhite, flex: 1, justifyContent: "center", whiteSpace: "nowrap" }}
          >
            {capturing ? "Capturing..." : "Set as Image"}
          </button>
        )}
        <button
          onClick={() => {
            const ia = naturalSize.w > 0 ? naturalSize.w / naturalSize.h : undefined;
            onSave({ ...crop, scale: displayScale, _v: 2, fmt: videoFormat, ia });
            onClose();
          }}
          style={{ ...btnPrimary, flex: 1, justifyContent: "center" }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// SortableContiCard
// ─────────────────────────────────────────────────────
export const SortableContiCard = memo(
  ({
    scene,
    isGenerating,
    isGeneratingAll,
    isUploading,
    isStyleTransferring,
    isStyleTransferFlow,
    isQueued,
    aspectClass,
    assetMap,
    assets,
    onClickImage,
    onGenerate,
    onInpaint,
    onCompare,
    onUpload,
    onHistory,
    onSceneUpdate,
    onDelete,
    onDuplicate,
    hasMultipleVersions,
    cacheBuster,
    historyCount,
    selected,
    onSelect,
    onSetThumbnail,
    onAdjustImage,
    onUseAsStyle,
    onRelight,
    onCameraVariations,
    onChangeAngle,
    onTransitionTypeChange,
    displayNumber,
    showInfo,
    generatingStage,
    isEditGenerating,
    allScenes,
    videoFormat,
  }: {
    scene: Scene;
    isGenerating: boolean;
    isGeneratingAll: boolean;
    isUploading: boolean;
    isStyleTransferring: boolean;
    /** 스타일 트랜스퍼 작업이 전역적으로 진행 중인지 여부 (Queued 라벨 표기 분기용) */
    isStyleTransferFlow?: boolean;
    isQueued: boolean;
    aspectClass: string;
    assetMap: Record<string, Asset>;
    assets: Asset[];
    onClickImage: () => void;
    onGenerate: () => void;
    onInpaint: () => void;
    onCompare: () => void;
    onUpload: (file: File) => void;
    onHistory: () => void;
    onSceneUpdate: (sceneNumber: number, fields: Partial<Scene>) => Promise<void>;
    onDelete: () => void;
    onDuplicate: () => void;
    hasMultipleVersions: boolean;
    cacheBuster: number;
    historyCount: number;
    selected: boolean;
    onSelect: (v: boolean) => void;
    onSetThumbnail?: () => void;
    onAdjustImage?: () => void;
    /** 이 씬 이미지를 스타일 프리셋으로 등록한다. hasImage 일 때만 제공. */
    onUseAsStyle?: () => void;
    /** 조명 변경(Relight) 모달을 연다. hasImage 일 때만 제공. */
    onRelight?: () => void;
    /** 카메라 베리에이션 모달을 연다. hasImage 일 때만 제공.
     *  씬 description + tagged_assets 를 reference 로 8 가지 카메라 앵글로 병렬 생성. */
    onCameraVariations?: () => void;
    /** Change Angle 모달을 연다. hasImage 일 때만 제공.
     *  원본 이미지를 그대로 유지한 채 yaw/pitch/zoom 만 자연어로 매핑해 카메라 이동. */
    onChangeAngle?: () => void;
    onTransitionTypeChange?: (scene: Scene, newType: string) => void;
    displayNumber?: number;
    showInfo?: boolean;
    generatingStage?: GeneratingStage;
    isEditGenerating?: boolean;
    allScenes?: Scene[];
    videoFormat?: string;
  }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: scene.id });
    const dndStyle = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

    const fileInputRef = useRef<HTMLInputElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);

    const [imgHov, setImgHov] = useState(false);
    const [moreHov, setMoreHov] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuOpenLeft, setMenuOpenLeft] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [adjustOpen, setAdjustOpen] = useState(false);

    const [localTitle, setLocalTitle] = useState(scene.title ?? "");
    const [localCam, setLocalCam] = useState(scene.camera_angle ?? "");
    const [localMood, setLocalMood] = useState(scene.mood ?? "");
    const [localLocation, setLocalLocation] = useState(scene.location ?? "");
    const [localDuration, setLocalDuration] = useState(scene.duration_sec != null ? String(scene.duration_sec) : "");

    useEffect(() => {
      setLocalTitle(scene.title ?? "");
      setLocalCam(scene.camera_angle ?? "");
      setLocalMood(scene.mood ?? "");
      setLocalLocation(scene.location ?? "");
      setLocalDuration(scene.duration_sec != null ? String(scene.duration_sec) : "");
    }, [scene]);

    useEffect(() => {
      if (!menuOpen) return;
      const fn = (e: MouseEvent) => {
        if (cardRef.current && !cardRef.current.contains(e.target as Node)) setMenuOpen(false);
      };
      document.addEventListener("mousedown", fn);
      return () => document.removeEventListener("mousedown", fn);
    }, [menuOpen]);

    const fmt = videoFormat ?? "horizontal";
    const imgSrc = scene.conti_image_url
      ? cacheBuster
        ? `${scene.conti_image_url}?t=${cacheBuster}`
        : scene.conti_image_url
      : null;
    const isBusy = isGenerating || isUploading || isStyleTransferring || isQueued;
    const hasImage = !!imgSrc && !isBusy;
    const showImgOverlay = imgHov || selected;
    const showMoreBtn = imgHov || menuOpen;

    const STAGE_LABELS: Record<GeneratingStage, string> = {
      queued: "Queued",
      translating: "Translating...",
      building: "Building...",
      generating: "Generating...",
      uploading: "Uploading...",
    };
    // 일반 generate-all 플로우의 스테이지 번호 (Queued 는 사전 단계로 번호 미부여, 유지)
    const STAGE_STEPS: Partial<Record<GeneratingStage, string>> = {
      translating: "1/4",
      building: "2/4",
      generating: "3/4",
      uploading: "4/4",
    };
    // 스타일 트랜스퍼 플로우의 스테이지 번호
    // 4단계: Queued(1) → Style transfer...(2) → Generating...(3) → Uploading...(4)
    const STYLE_TRANSFER_STAGE_STEPS: Partial<Record<GeneratingStage, string>> = {
      generating: "3/4",
      uploading: "4/4",
    };

    // 스타일 트랜스퍼 컨텍스트: 실제 트랜스퍼 중이거나, 전역 트랜스퍼 작업의 큐 대기 중인 경우
    const isInStyleTransferContext = isStyleTransferring || (isQueued && !!isStyleTransferFlow);

    const busyLabel = generatingStage
      ? STAGE_LABELS[generatingStage]
      : isQueued
        ? "Queued"
        : isStyleTransferring
          ? "Style transfer..."
          : isUploading
            ? "Uploading..."
            : "Generating...";

    // isEditGenerating=true면 inpaint 단일 호출 → "1/1" 고정 표시
    const busyStep = isEditGenerating
      ? generatingStage
        ? "1/1"
        : null
      : isInStyleTransferContext
        ? generatingStage
          ? (STYLE_TRANSFER_STAGE_STEPS[generatingStage] ?? null)
          : isQueued
            ? "1/4"
            : isStyleTransferring
              ? "2/4"
              : null
        : generatingStage
          ? (STAGE_STEPS[generatingStage] ?? null)
          : null;

    const saveField = async (fields: Partial<Scene>) => {
      await onSceneUpdate(scene.scene_number, fields);
    };

    const handleAdjustSave = async (crop: CropState) => {
      const newMap = setCropForFmt(scene.conti_image_crop, fmt, crop);
      await onSceneUpdate(scene.scene_number, { conti_image_crop: newMap } as any);
    };

    const openAdjust = () => {
      setMenuOpen(false);
      if (videoFormat) setAdjustOpen(true);
      else onAdjustImage?.();
    };

    const handleCapture = useCallback(
      (file: File) => {
        onUpload(file);
        const stored = scene.conti_image_crop;
        if (isCropMap(stored)) {
          const newMap = { ...(stored as CropMap) };
          delete newMap[fmt as keyof CropMap];
          onSceneUpdate(scene.scene_number, { conti_image_crop: Object.keys(newMap).length ? newMap : null } as any);
        } else {
          onSceneUpdate(scene.scene_number, { conti_image_crop: null } as any);
        }
      },
      [onUpload, onSceneUpdate, scene.scene_number, scene.conti_image_crop, fmt],
    );

    const normalizedInitialCrop: CropState = (() => {
      const crop = getCropForFmt(scene.conti_image_crop, fmt);
      if (crop?._v === 2) return crop;
      return { _v: 2, x: 0, y: 0, scale: 0.8, rotate: 0 };
    })();

    const activeCrop = getCropForFmt(scene.conti_image_crop, fmt);
    const isCropValid = activeCrop?._v === 2;

    const cardImageLayout = (() => {
      if (!isCropValid || !activeCrop) return null;
      const containerAspect = FORMAT_RATIO[fmt] ?? 16 / 9;
      const ia = activeCrop.ia ?? containerAspect;
      return computeImageLayout(ia, containerAspect, activeCrop.scale, activeCrop.x, activeCrop.y);
    })();

    return (
      <>
        <div
          ref={(el) => {
            setNodeRef(el);
            (cardRef as any).current = el;
          }}
          {...attributes}
          {...listeners}
          id={`conti-scene-${scene.scene_number}`}
          className="overflow-visible flex flex-col cursor-grab active:cursor-grabbing h-full"
          style={{
            ...dndStyle,
            position: "relative",
            borderRadius: 0,
            border: selected ? `1.5px solid ${KR}` : "1px solid rgba(255,255,255,0.07)",
            background: "hsl(var(--card))",
            transition: "border-color 0.15s",
          }}
        >
          {/* ── HEADER ── */}
          <div
            className="flex items-center gap-2 px-2.5 py-1.5 border-b shrink-0"
            style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.06)", borderRadius: 0 }}
          >
            <GripVertical className="w-3 h-3 shrink-0" style={{ color: "rgba(255,255,255,0.2)" }} />
            {scene.is_transition ? (
              <span
                className="font-mono text-[10px] font-bold px-1.5 py-0.5 text-white shrink-0"
                style={{ background: "#6b7280", borderRadius: 0 }}
              >
                TR
              </span>
            ) : (
              <span
                className="font-mono text-[10px] font-bold px-1.5 py-0.5 text-white shrink-0"
                style={{ background: KR, borderRadius: 0 }}
              >
                S{String(displayNumber ?? scene.scene_number).padStart(2, "0")}
              </span>
            )}
            <div className="flex-1" />
            {historyCount > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onHistory();
                }}
                className="flex items-center gap-0.5 text-[9px] font-mono hover:text-foreground transition-colors px-1"
                style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.25)" }}
              >
                <History className="w-2.5 h-2.5" />
                <span>{historyCount}</span>
              </button>
            )}
            {scene.conti_image_url && (
              <a
                href={scene.conti_image_url}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="w-4 h-4 flex items-center justify-center hover:text-foreground transition-colors"
                style={{ color: "rgba(255,255,255,0.25)" }}
              >
                <Download className="w-2.5 h-2.5" />
              </a>
            )}
          </div>

          {/* ── IMAGE ── */}
          <div
            onMouseEnter={() => setImgHov(true)}
            onMouseLeave={() => setImgHov(false)}
            className={`relative ${aspectClass} overflow-hidden shrink-0`}
            style={{
              background: imgSrc ? "#0a0a0a" : "rgba(255,255,255,0.03)",
              cursor: "pointer",
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onClickImage}
          >
            {isBusy ? (
              <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-10 gap-2">
                {/* 원형 스피너 + 중앙 스텝 번호 */}
                <div style={{ position: "relative", width: 44, height: 44 }}>
                  <svg
                    width="44"
                    height="44"
                    viewBox="0 0 44 44"
                    style={{
                      position: "absolute",
                      inset: 0,
                      animation: "spin 1.2s linear infinite",
                    }}
                  >
                    <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
                    <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2.5" />
                    <circle
                      cx="22"
                      cy="22"
                      r="18"
                      fill="none"
                      stroke="rgba(255,255,255,0.7)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeDasharray="28 85"
                      strokeDashoffset="0"
                    />
                  </svg>
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <span
                      style={{
                        fontSize: busyStep ? 11 : 10,
                        fontWeight: 600,
                        color: busyStep ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.3)",
                        fontVariantNumeric: "tabular-nums",
                        letterSpacing: "-0.02em",
                        lineHeight: 1,
                      }}
                    >
                      {busyStep ?? "—"}
                    </span>
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 400,
                    color: "rgba(255,255,255,0.45)",
                  }}
                >
                  {busyLabel}
                </span>
              </div>
            ) : imgSrc ? (
              cardImageLayout ? (
                <div
                  style={{
                    position: "absolute",
                    width: `${cardImageLayout.wPct}%`,
                    height: `${cardImageLayout.hPct}%`,
                    left: `${cardImageLayout.leftPct}%`,
                    top: `${cardImageLayout.topPct}%`,
                    backgroundImage: `url(${imgSrc})`,
                    backgroundSize: "cover",
                    backgroundRepeat: "no-repeat",
                    backgroundColor: "#111",
                    transform: activeCrop?.rotate ? `rotate(${activeCrop.rotate}deg)` : undefined,
                    transformOrigin: "center center",
                  }}
                />
              ) : (
                <div
                  className="w-full h-full"
                  style={{
                    backgroundImage: `url(${imgSrc})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    backgroundRepeat: "no-repeat",
                    backgroundColor: "#111",
                  }}
                />
              )
            ) : scene.is_transition ? (
              (() => {
                const idx = allScenes?.findIndex((s) => s.id === scene.id) ?? -1;
                let prevLabel = "",
                  nextLabel = "";
                if (allScenes && idx > 0) {
                  for (let i = idx - 1; i >= 0; i--) {
                    if (!allScenes[i].is_transition) {
                      let dn = 0;
                      for (let j = 0; j <= i; j++) {
                        if (!allScenes[j].is_transition) dn++;
                      }
                      prevLabel = `S${String(dn).padStart(2, "0")}`;
                      break;
                    }
                  }
                }
                if (allScenes && idx >= 0 && idx < allScenes.length - 1) {
                  for (let i = idx + 1; i < allScenes.length; i++) {
                    if (!allScenes[i].is_transition) {
                      let dn = 0;
                      for (let j = 0; j <= i; j++) {
                        if (!allScenes[j].is_transition) dn++;
                      }
                      nextLabel = `S${String(dn).padStart(2, "0")}`;
                      break;
                    }
                  }
                }
                return (
                  <div
                    className="absolute inset-0 flex items-center justify-center"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <svg
                      viewBox="0 0 300 50"
                      width="90%"
                      height="56"
                      xmlns="http://www.w3.org/2000/svg"
                      style={{ display: "block" }}
                    >
                      <text
                        x="4"
                        y="25"
                        dominantBaseline="middle"
                        fill="#9ca3af"
                        fontSize="14"
                        fontWeight="500"
                        fontFamily="sans-serif"
                      >
                        {prevLabel}
                      </text>
                      <line x1="36" y1="25" x2="100" y2="25" stroke="#4b5563" strokeWidth="1" />
                      <circle cx="104" cy="25" r="3.5" fill="#4b5563" />
                      <text
                        x="150"
                        y="25"
                        dominantBaseline="middle"
                        textAnchor="middle"
                        fill="#9ca3af"
                        fontSize="14"
                        fontWeight="600"
                        fontFamily="sans-serif"
                      >
                        Transition
                      </text>
                      <circle cx="196" cy="25" r="3.5" fill="#4b5563" />
                      <line x1="200" y1="25" x2="260" y2="25" stroke="#4b5563" strokeWidth="1" />
                      <polygon points="260,20 270,25 260,30" fill="#4b5563" />
                      <text
                        x="276"
                        y="25"
                        dominantBaseline="middle"
                        fill="#9ca3af"
                        fontSize="14"
                        fontWeight="500"
                        fontFamily="sans-serif"
                      >
                        {nextLabel}
                      </text>
                    </svg>
                    {!isBusy && !imgSrc && (
                      <div className="absolute bottom-2 right-2 flex gap-1" style={{ zIndex: 5 }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onGenerate();
                          }}
                          title="Generate"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 28,
                            height: 28,
                            borderRadius: 0,
                            background: KR,
                            color: "#fff",
                            border: "none",
                            cursor: "pointer",
                          }}
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            fileInputRef.current?.click();
                          }}
                          title="Upload Image"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 28,
                            height: 28,
                            borderRadius: 0,
                            background: "hsl(var(--background))",
                            color: "hsl(var(--foreground))",
                            border: "0.5px solid hsl(var(--border))",
                            cursor: "pointer",
                          }}
                        >
                          <Upload className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()
            ) : (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center gap-2"
                style={{
                  background: isDragOver ? "rgba(249,66,58,0.06)" : "transparent",
                  border: isDragOver ? `2px dashed ${KR}` : "none",
                  borderRadius: 12,
                  transition: "background 0.15s",
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDragOver(true);
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDragOver(true);
                }}
                onDragLeave={(e) => {
                  e.stopPropagation();
                  setIsDragOver(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDragOver(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file?.type.startsWith("image/")) onUpload(file);
                }}
              >
                {isGeneratingAll ? (
                  <>
                    <div className="w-8 h-8 rounded-none border-2 border-border animate-pulse" />
                    <span className="text-[11px] text-muted-foreground/50">Queued</span>
                  </>
                ) : (
                  <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onGenerate();
                      }}
                      title="Generate"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 36,
                        height: 36,
                        borderRadius: 0,
                        background: KR,
                        color: "#fff",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      <Sparkles className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                      title="Upload Image"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 36,
                        height: 36,
                        borderRadius: 0,
                        background: "hsl(var(--background))",
                        color: "hsl(var(--foreground))",
                        border: "0.5px solid hsl(var(--border))",
                        cursor: "pointer",
                      }}
                    >
                      <Upload className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 딤 오버레이 */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: showImgOverlay ? "rgba(0,0,0,0.28)" : "rgba(0,0,0,0)",
                transition: "background 0.15s",
                pointerEvents: "none",
              }}
            />

            {/* 체크박스 */}
            <div
              style={{
                position: "absolute",
                top: 8,
                left: 8,
                zIndex: 10,
                opacity: showImgOverlay ? 1 : 0,
                transition: "opacity 0.15s",
                pointerEvents: showImgOverlay ? "auto" : "none",
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(!selected);
              }}
            >
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 0,
                  cursor: "pointer",
                  border: selected ? "none" : `2px solid ${showImgOverlay ? "#fff" : "rgba(255,255,255,0.55)"}`,
                  background: selected ? KR : "rgba(0,0,0,0.38)",
                  backdropFilter: "blur(4px)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {selected && (
                  <svg
                    width={13}
                    height={13}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#fff"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </div>
            </div>

            {/* ··· 버튼 */}
            <div
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                zIndex: 10,
                opacity: showMoreBtn ? 1 : 0,
                transition: "opacity 0.15s",
                pointerEvents: showMoreBtn ? "auto" : "none",
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                onMouseEnter={() => setMoreHov(true)}
                onMouseLeave={() => setMoreHov(false)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!menuOpen) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setMenuOpenLeft(window.innerWidth - rect.right < 220);
                  }
                  setMenuOpen((v) => !v);
                }}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 0,
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: menuOpen
                    ? "rgba(255,255,255,0.92)"
                    : moreHov
                      ? "rgba(255,255,255,0.22)"
                      : "rgba(0,0,0,0.42)",
                  backdropFilter: "blur(6px)",
                  transition: "background 0.12s",
                }}
              >
                <svg
                  width={14}
                  height={14}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={menuOpen ? "#111" : "#fff"}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 5v.01M12 12v.01M12 19v.01" />
                </svg>
              </button>
            </div>

            {/* Variants quick-access icons (Relight / Use as Style).
                Camera Variations / Change Angle 은 현재 NB2 단일 파이프라인으로는
                원본 유지 + 앵글 변경이 안정적으로 안 되므로(모델 구조상 novel-view
                synthesis 불가) 호버 퀵 아이콘에서 제거. 사이드패널 Variants 에는
                "Unavailable" 로 여전히 노출되어 기능 존재 자체는 드러낸다. */}
            {hasImage && (onRelight || onUseAsStyle) && (
              <div
                style={{
                  position: "absolute",
                  bottom: 8,
                  left: 8,
                  zIndex: 5,
                  display: "flex",
                  gap: 4,
                  opacity: imgHov ? 1 : 0,
                  transition: "opacity 0.15s",
                  pointerEvents: imgHov ? "auto" : "none",
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {onRelight && (
                  <button
                    title="Relight"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRelight();
                    }}
                    className="flex items-center justify-center w-7 h-7 rounded-none text-white/90 hover:bg-white/20"
                    style={{
                      background: "rgba(0,0,0,0.55)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      cursor: "pointer",
                    }}
                  >
                    <Lightbulb className="w-3.5 h-3.5" />
                  </button>
                )}
                {onUseAsStyle && (
                  <button
                    title="Use as Style"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUseAsStyle();
                    }}
                    className="flex items-center justify-center w-7 h-7 rounded-none text-white/90 hover:bg-white/20"
                    style={{
                      background: "rgba(0,0,0,0.55)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      cursor: "pointer",
                    }}
                  >
                    <Palette className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* Regenerate */}
            {hasImage && (
              <div
                style={{
                  position: "absolute",
                  bottom: 8,
                  right: 8,
                  zIndex: 5,
                  opacity: imgHov ? 1 : 0,
                  transition: "opacity 0.15s",
                  pointerEvents: imgHov ? "auto" : "none",
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onGenerate();
                  }}
                  disabled={isGeneratingAll}
                  className="flex items-center gap-1 text-[11px] font-semibold px-3 h-7 rounded-none text-white hover:opacity-85 disabled:opacity-40"
                  style={{ background: KR, border: "none", cursor: "pointer" }}
                >
                  <RefreshCw className="w-3 h-3" /> Regenerate
                </button>
              </div>
            )}
          </div>

          {/* SidePanel */}
          {menuOpen && (
            <div onPointerDown={(e) => e.stopPropagation()}>
              <SidePanel
                hasImage={!!scene.conti_image_url}
                openLeft={menuOpenLeft}
                hasMultipleVersions={hasMultipleVersions}
                onDuplicate={() => {
                  setMenuOpen(false);
                  onDuplicate();
                }}
                onDelete={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
                onUpload={() => {
                  setMenuOpen(false);
                  fileInputRef.current?.click();
                }}
                onDeleteImage={() => {
                  setMenuOpen(false);
                  onSceneUpdate(scene.scene_number, { conti_image_url: null });
                }}
                onCompare={() => {
                  setMenuOpen(false);
                  onCompare();
                }}
                onInpaint={() => {
                  setMenuOpen(false);
                  onInpaint();
                }}
                onSetThumbnail={
                  scene.conti_image_url
                    ? () => {
                        setMenuOpen(false);
                        onSetThumbnail?.();
                      }
                    : undefined
                }
                onAdjustImage={scene.conti_image_url ? openAdjust : undefined}
                onUseAsStyle={
                  scene.conti_image_url && onUseAsStyle
                    ? () => {
                        setMenuOpen(false);
                        onUseAsStyle();
                      }
                    : undefined
                }
                onRelight={
                  scene.conti_image_url && onRelight
                    ? () => {
                        setMenuOpen(false);
                        onRelight();
                      }
                    : undefined
                }
                onCameraVariations={
                  scene.conti_image_url && onCameraVariations
                    ? () => {
                        setMenuOpen(false);
                        onCameraVariations();
                      }
                    : undefined
                }
                onChangeAngle={
                  scene.conti_image_url && onChangeAngle
                    ? () => {
                        setMenuOpen(false);
                        onChangeAngle();
                      }
                    : undefined
                }
              />
            </div>
          )}

          {/* ── BODY ── */}
          <div className="px-2.5 py-2 flex-1 flex flex-col gap-2" onPointerDown={(e) => e.stopPropagation()}>
            {scene.is_transition ? (
              <DescriptionField
                value={scene.description ?? ""}
                assets={assets}
                existingTags={scene.tagged_assets ?? []}
                onChange={(desc, tags) => saveField({ description: desc, tagged_assets: tags })}
              />
            ) : (
              <>
                {showInfo !== false && (
                  <InlineField
                    value={localTitle}
                    onChange={(v) => {
                      setLocalTitle(v);
                      saveField({ title: v });
                    }}
                    placeholder="Scene title"
                    style={{ fontSize: 12, fontWeight: 600, color: "#f0f0f0", lineHeight: 1.4 } as any}
                  />
                )}
                {showInfo !== false && (
                  <MetaRows
                    fields={{
                      camera_angle: localCam,
                      mood: localMood,
                      location: localLocation,
                      duration_sec: localDuration,
                    }}
                    assets={assets}
                    onUpdate={(k, v) => {
                      if (k === "camera_angle") {
                        setLocalCam(v);
                        saveField({ camera_angle: v });
                      }
                      if (k === "mood") {
                        setLocalMood(v);
                        saveField({ mood: v });
                      }
                      if (k === "location") {
                        setLocalLocation(v);
                        saveField({ location: v });
                      }
                      if (k === "duration_sec") {
                        setLocalDuration(v);
                        saveField({ duration_sec: v ? parseInt(v) : null });
                      }
                    }}
                  />
                )}
                <DescriptionField
                  value={scene.description ?? ""}
                  assets={assets}
                  existingTags={scene.tagged_assets ?? []}
                  onChange={(desc, tags) => saveField({ description: desc, tagged_assets: tags })}
                />
                {!scene.description?.trim() && !isBusy && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "4px 8px",
                      borderRadius: 0,
                      background: "rgba(245,158,11,0.08)",
                      border: "0.5px solid rgba(245,158,11,0.25)",
                    }}
                  >
                    <svg
                      width={11}
                      height={11}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#d97706"
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ flexShrink: 0 }}
                    >
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01" />
                    </svg>
                    <span style={{ fontSize: 10, color: "#d97706", fontWeight: 500 }}>
                      No description — excluded from Generate All
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex-1" />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = "";
            }}
          />
        </div>

        {/* ── Adjust Image Modal ── */}
        {adjustOpen && scene.conti_image_url && (
          <AdjustImageModal
            imageUrl={scene.conti_image_url}
            videoFormat={fmt}
            initialCrop={normalizedInitialCrop}
            onSave={handleAdjustSave}
            onCapture={handleCapture}
            onClose={() => setAdjustOpen(false)}
          />
        )}
      </>
    );
  },
);

SortableContiCard.displayName = "SortableContiCard";
