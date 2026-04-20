import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  MousePointer2,
  Type,
  Pen,
  Eraser,
  Undo2,
  Redo2,
  FlipHorizontal2,
  FlipVertical2,
  Trash2,
  Loader2,
  Check,
  Crop,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

/* ━━━ Types ━━━ */
type ToolId = "select" | "text" | "pen" | "eraser" | "crop";
interface Stroke {
  type: "path";
  points: { x: number; y: number }[];
  color: string;
  size: number;
  isEraser?: boolean;
}
interface TextObject {
  type: "textobj";
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  width: number;
  height: number;
}
type DrawAction = Stroke | TextObject;
type CropRatio = "free" | "16:9" | "9:16" | "1:1";
type HandleId = "tl" | "tc" | "tr" | "ml" | "mr" | "bl" | "bc" | "br";

/* ━━━ Constants ━━━ */
const KR = "#f9423a";
const TEXT_FONT_SIZES = [12, 16, 20, 28, 36, 48];
const MAX_UNDO = 20;
const HANDLE_SIZE = 8;
const CROP_RATIO_OPTIONS: { id: CropRatio; label: string }[] = [
  { id: "free", label: "Free" },
  { id: "16:9", label: "16:9" },
  { id: "9:16", label: "9:16" },
  { id: "1:1", label: "1:1" },
];
const HANDLE_CURSOR: Record<string, string> = {
  tl: "nwse-resize",
  tc: "ns-resize",
  tr: "nesw-resize",
  ml: "ew-resize",
  mr: "ew-resize",
  bl: "nesw-resize",
  bc: "ns-resize",
  br: "nwse-resize",
};
let _idCounter = 0;
const genId = () => `txt_${Date.now()}_${_idCounter++}`;

/* ━━━ URL helpers ━━━ */
export const _originalUrlByScene = new Map<string, string>();
const isEditorUrl = (url: string | null | undefined) => !!url && /_editor_/i.test(url);
const deriveOriginalUrl = (currentUrl: string | null, imageHistory: string[]) => {
  if (!currentUrl) return null;
  if (!isEditorUrl(currentUrl)) return currentUrl;
  return imageHistory.find((u) => !isEditorUrl(u)) ?? imageHistory[imageHistory.length - 1] ?? currentUrl;
};

/* ━━━ Geometry helpers ━━━ */
const measureText = (ctx: CanvasRenderingContext2D, text: string, fontSize: number) => {
  ctx.font = `bold ${fontSize}px sans-serif`;
  const m = ctx.measureText(text);
  return { width: m.width, height: fontSize * 1.2 };
};
const getHandles = (obj: TextObject) => {
  const { x, y, width: w, height: h } = obj;
  const ty = y - h;
  return [
    { id: "tl" as HandleId, x, y: ty },
    { id: "tc" as HandleId, x: x + w / 2, y: ty },
    { id: "tr" as HandleId, x: x + w, y: ty },
    { id: "ml" as HandleId, x, y: ty + h / 2 },
    { id: "mr" as HandleId, x: x + w, y: ty + h / 2 },
    { id: "bl" as HandleId, x, y: ty + h },
    { id: "bc" as HandleId, x: x + w / 2, y: ty + h },
    { id: "br" as HandleId, x: x + w, y: ty + h },
  ];
};
const hitTestHandle = (obj: TextObject, px: number, py: number, tol: number): HandleId | null => {
  for (const h of getHandles(obj)) if (Math.abs(px - h.x) <= tol && Math.abs(py - h.y) <= tol) return h.id;
  return null;
};
const hitTestObj = (obj: TextObject, px: number, py: number) =>
  px >= obj.x && px <= obj.x + obj.width && py >= obj.y - obj.height && py <= obj.y;

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ToolBtn / ActionBtn — 컴포넌트 외부에 정의 (★ 핵심 수정)
 * 컴포넌트 내부에 정의하면 매 렌더마다 새 타입 → React가
 * unmount/remount 반복 → 캔버스 state 리셋 → 그린 내용 사라짐
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
type IconComponent = React.ComponentType<{ className?: string }>;

const ToolBtn = ({
  isActive,
  icon: Icon,
  label,
  onClick,
}: {
  isActive: boolean;
  icon: IconComponent;
  label: string;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    title={label}
    className="p-1.5 rounded transition-colors"
    style={{ background: isActive ? KR : "transparent", color: isActive ? "#fff" : "rgba(255,255,255,0.5)" }}
  >
    <Icon className="w-4 h-4" />
  </button>
);

const ActionBtn = ({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: IconComponent;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={label}
    className="p-1.5 rounded transition-colors text-white/50 hover:text-white disabled:opacity-30"
  >
    <Icon className="w-4 h-4" />
  </button>
);

/* ━━━ Types ━━━ */
type VideoFormat = "vertical" | "horizontal" | "square";
interface Props {
  imageUrl: string | null;
  imageHistory: string[];
  canvasSize: { w: number; h: number };
  containerRef: React.RefObject<HTMLDivElement>;
  projectId: string;
  sceneId: string;
  sceneNumber: number;
  videoFormat?: VideoFormat;
  onApply: (url: string) => void;
  onRestore?: (originalUrl: string) => void;
}

const videoCropRatio = (vf?: VideoFormat): CropRatio =>
  vf === "horizontal" ? "16:9" : vf === "square" ? "1:1" : "9:16";

/* ━━━ Component ━━━ */
export const AnnotationEditor = ({
  imageUrl,
  imageHistory,
  canvasSize,
  containerRef,
  projectId,
  sceneId,
  sceneNumber,
  videoFormat,
  onApply,
  onRestore,
}: Props) => {
  const derivedOriginal = deriveOriginalUrl(imageUrl, imageHistory);
  useEffect(() => {
    if (derivedOriginal && _originalUrlByScene.get(sceneId) !== derivedOriginal)
      _originalUrlByScene.set(sceneId, derivedOriginal);
  }, [sceneId, derivedOriginal]);

  /* ── state ── */
  const [tool, setTool] = useState<ToolId>("select");
  const [brushSize, setBrushSize] = useState(8);
  const [textFontSize, setTextFontSize] = useState(20);
  const [color, setColor] = useState("#f9423a");
  const colorInputRef = useRef<HTMLInputElement>(null);
  const [cropRatio, setCropRatio] = useState<CropRatio>(() => videoCropRatio(videoFormat));
  const [actions, setActions] = useState<DrawAction[]>([]);
  const [redoStack, setRedoStack] = useState<DrawAction[]>([]);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [applying, setApplying] = useState(false);
  const [croppedImgSrc, setCroppedImgSrc] = useState<string | null>(null);
  const [cropHistory, setCropHistory] = useState<{ imgSrc: string | null; actions: DrawAction[] }[]>([]);
  const [textInput, setTextInput] = useState<{ x: number; y: number } | null>(null);
  const [textValue, setTextValue] = useState("");
  const textInputRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{
    mode: "move" | "resize";
    handleId?: HandleId;
    startX: number;
    startY: number;
    origObj: TextObject;
  } | null>(null);
  const [cropCursor, setCropCursor] = useState("crosshair");
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [cropDrag, setCropDrag] = useState<{
    mode: "draw" | "move" | "handle";
    handleId?: HandleId;
    startX: number;
    startY: number;
    origRect: { x: number; y: number; w: number; h: number };
  } | null>(null);

  /* ── refs ── */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null);
  const currentStroke = useRef<{ x: number; y: number }[]>([]);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  /* ★ isDrawingRef — React 18 automatic batching 클로저 문제 해결
   * setIsDrawing(true)는 배치 업데이트라 같은 이벤트 사이클의
   * mousemove에서 아직 false로 읽힘 → ref로 즉시 동기 반영 */
  const isDrawingRef = useRef(false);

  const effectiveImageUrl = croppedImgSrc || imageUrl;

  /* ★ effectiveSize — canvasSize prop이 0일 때 자체 계산
   * canvasSize=0 → container div width: undefined → canvas CSS 크기 0
   * → getBoundingClientRect().width=0 → 좌표 Infinity → 그리기 무음 실패 */
  const effectiveSize = useMemo(() => {
    if (canvasSize.w > 0 && canvasSize.h > 0) return canvasSize;
    // containerRef에서 직접 계산
    const ctr = containerRef.current;
    if (ctr && naturalSize.w > 0 && naturalSize.h > 0) {
      const cw = Math.max(0, ctr.clientWidth - 48);
      const ch = Math.max(0, ctr.clientHeight - 48);
      if (cw > 0 && ch > 0) {
        const s = Math.min(cw / naturalSize.w, ch / naturalSize.h);
        return { w: Math.round(naturalSize.w * s), h: Math.round(naturalSize.h * s) };
      }
    }
    // 마지막 폴백: 화면 최대 800×600 기준 스케일
    if (naturalSize.w > 0 && naturalSize.h > 0) {
      const s = Math.min(1, 800 / naturalSize.w, 600 / naturalSize.h);
      return { w: Math.round(naturalSize.w * s), h: Math.round(naturalSize.h * s) };
    }
    return { w: 0, h: 0 };
  }, [canvasSize, naturalSize, containerRef]);

  /* ── image load ── */
  useEffect(() => {
    if (!effectiveImageUrl) return;
    setImgLoaded(false);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
      setImgLoaded(true);
    };
    img.src = effectiveImageUrl;
  }, [effectiveImageUrl]);

  /* ── text objects helper ── */
  const getTextObjects = useCallback(() => actions.filter((a): a is TextObject => a.type === "textobj"), [actions]);
  const selectedObj = selectedId ? (getTextObjects().find((t) => t.id === selectedId) ?? null) : null;

  /* ── crop aspect ── */
  const getCropAspect = useCallback((): number | null => {
    if (cropRatio === "16:9") return 16 / 9;
    if (cropRatio === "9:16") return 9 / 16;
    if (cropRatio === "1:1") return 1;
    return null;
  }, [cropRatio]);

  /* ── brush cursor ── */
  const drawCursorAt = useCallback(
    (clientX: number, clientY: number) => {
      const cc = cursorCanvasRef.current;
      const cv = canvasRef.current;
      if (!cc || !cv) return;
      const rect = cv.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      if (cc.width !== Math.round(rect.width) || cc.height !== Math.round(rect.height)) {
        cc.width = Math.round(rect.width);
        cc.height = Math.round(rect.height);
      }
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const r = Math.max(2, (brushSize * (rect.width / cv.width)) / 2);
      const ctx = cc.getContext("2d")!;
      ctx.clearRect(0, 0, cc.width, cc.height);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
    },
    [brushSize],
  );

  const clearCursor = useCallback(() => {
    const cc = cursorCanvasRef.current;
    if (!cc) return;
    cc.getContext("2d")?.clearRect(0, 0, cc.width, cc.height);
  }, []);

  /* ── redraw ── */
  const redraw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv || !imgLoaded) return;
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const a of actions) {
      if (a.type === "path" && a.points.length >= 1) {
        /* ★ 핵심 수정: length > 1 → length >= 1
         * 단일 클릭(점 1개)도 저장되는데 기존엔 redraw에서 skip →
         * mouseup 후 캔버스가 원복되는 버그의 실제 원인 */
        ctx.save();
        ctx.globalCompositeOperation = a.isEraser ? "destination-out" : "source-over";
        if (a.points.length === 1) {
          // 단일 클릭: arc dot으로 그리기
          ctx.fillStyle = a.isEraser ? "rgba(0,0,0,1)" : a.color;
          ctx.beginPath();
          ctx.arc(a.points[0].x, a.points[0].y, a.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // 드래그: 선으로 그리기
          ctx.strokeStyle = a.isEraser ? "rgba(0,0,0,1)" : a.color;
          ctx.lineWidth = a.size;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.beginPath();
          ctx.moveTo(a.points[0].x, a.points[0].y);
          for (let i = 1; i < a.points.length; i++) ctx.lineTo(a.points[i].x, a.points[i].y);
          ctx.stroke();
        }
        ctx.restore();
      } else if (a.type === "textobj") {
        ctx.fillStyle = a.color;
        ctx.font = `bold ${a.fontSize}px sans-serif`;
        ctx.fillText(a.text, a.x, a.y);
        if (a.id === selectedId) {
          const ty = a.y - a.height;
          ctx.strokeStyle = KR;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.strokeRect(a.x, ty, a.width, a.height);
          ctx.setLineDash([]);
          for (const h of getHandles(a)) {
            ctx.fillStyle = "#fff";
            ctx.fillRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
            ctx.strokeStyle = KR;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
          }
        }
      }
    }
    if (currentStroke.current.length > 1 && tool === "pen") {
      ctx.strokeStyle = color;
      ctx.lineWidth = brushSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalCompositeOperation = "source-over";
      ctx.beginPath();
      ctx.moveTo(currentStroke.current[0].x, currentStroke.current[0].y);
      for (let i = 1; i < currentStroke.current.length; i++)
        ctx.lineTo(currentStroke.current[i].x, currentStroke.current[i].y);
      ctx.stroke();
    }
    if (tool === "crop" && cropRect) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.clearRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 1;
      for (let i = 1; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(cropRect.x + (cropRect.w / 3) * i, cropRect.y);
        ctx.lineTo(cropRect.x + (cropRect.w / 3) * i, cropRect.y + cropRect.h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cropRect.x, cropRect.y + (cropRect.h / 3) * i);
        ctx.lineTo(cropRect.x + cropRect.w, cropRect.y + (cropRect.h / 3) * i);
        ctx.stroke();
      }
      for (const ch of [
        { x: cropRect.x, y: cropRect.y },
        { x: cropRect.x + cropRect.w / 2, y: cropRect.y },
        { x: cropRect.x + cropRect.w, y: cropRect.y },
        { x: cropRect.x, y: cropRect.y + cropRect.h / 2 },
        { x: cropRect.x + cropRect.w, y: cropRect.y + cropRect.h / 2 },
        { x: cropRect.x, y: cropRect.y + cropRect.h },
        { x: cropRect.x + cropRect.w / 2, y: cropRect.y + cropRect.h },
        { x: cropRect.x + cropRect.w, y: cropRect.y + cropRect.h },
      ]) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(ch.x - 4, ch.y - 4, 8, 8);
        ctx.strokeStyle = KR;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(ch.x - 4, ch.y - 4, 8, 8);
      }
    }
  }, [actions, imgLoaded, tool, color, brushSize, selectedId, cropRect]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !naturalSize.w) return;
    cv.width = naturalSize.w;
    cv.height = naturalSize.h;
    redraw();
  }, [naturalSize, redraw]);

  /* ★ toCanvas — offsetX/offsetY 사용으로 getBoundingClientRect 의존성 최소화
   * rect.width=0 가드 추가 → Infinity 좌표 방지 */
  const toCanvas = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current;
    if (!cv) return { x: 0, y: 0 };
    const rect = cv.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    // offsetX/Y: 이벤트 타겟 기준 CSS 픽셀 좌표 (getBoundingClientRect 없이 직접 접근)
    let cssX = e.nativeEvent.offsetX;
    let cssY = e.nativeEvent.offsetY;
    if (flipH) cssX = rect.width - cssX;
    if (flipV) cssY = rect.height - cssY;
    return { x: cssX * (cv.width / rect.width), y: cssY * (cv.height / rect.height) };
  };

  /* ── snapshot helpers ── */
  const pushAction = (action: DrawAction) => {
    setActions((prev) => {
      setRedoStack([]);
      return [...prev.slice(-(MAX_UNDO - 1)), action];
    });
  };

  /* ── select handlers ── */
  const handleSelectDown = (p: { x: number; y: number }) => {
    const textObjs = getTextObjects();
    const cv = canvasRef.current;
    const tol = cv ? HANDLE_SIZE * (cv.width / (effectiveSize.w || cv.width)) : HANDLE_SIZE;
    if (selectedObj) {
      const hid = hitTestHandle(selectedObj, p.x, p.y, tol);
      if (hid) {
        setDragState({ mode: "resize", handleId: hid, startX: p.x, startY: p.y, origObj: { ...selectedObj } });
        return;
      }
      if (hitTestObj(selectedObj, p.x, p.y)) {
        setDragState({ mode: "move", startX: p.x, startY: p.y, origObj: { ...selectedObj } });
        return;
      }
    }
    for (let i = textObjs.length - 1; i >= 0; i--) {
      if (hitTestObj(textObjs[i], p.x, p.y)) {
        setSelectedId(textObjs[i].id);
        setDragState({ mode: "move", startX: p.x, startY: p.y, origObj: { ...textObjs[i] } });
        return;
      }
    }
    setSelectedId(null);
  };

  const handleSelectMove = (p: { x: number; y: number }) => {
    if (!dragState || !selectedObj) return;
    const dx = p.x - dragState.startX,
      dy = p.y - dragState.startY;
    const orig = dragState.origObj;
    if (dragState.mode === "move") {
      setActions((prev) =>
        prev.map((a) => (a.type === "textobj" && a.id === orig.id ? { ...orig, x: orig.x + dx, y: orig.y + dy } : a)),
      );
    } else if (dragState.mode === "resize" && dragState.handleId) {
      const hid = dragState.handleId;
      if (["tl", "tr", "bl", "br"].includes(hid)) {
        const scaleRef = hid === "tl" || hid === "tr" ? -dy : dy;
        const scale = Math.max(0.3, 1 + scaleRef / orig.height);
        const newFs = Math.max(8, Math.round(orig.fontSize * scale));
        const cv = canvasRef.current;
        if (cv) {
          const m = measureText(cv.getContext("2d")!, orig.text, newFs);
          setActions((prev) =>
            prev.map((a) =>
              a.type === "textobj" && a.id === orig.id
                ? { ...orig, fontSize: newFs, width: m.width, height: m.height }
                : a,
            ),
          );
        }
      }
    }
  };

  /* ── crop handlers ── */
  const handleCropDown = (p: { x: number; y: number }) => {
    if (cropRect) {
      const cr = cropRect,
        tol = 10;
      const corners = [
        { id: "tl" as HandleId, x: cr.x, y: cr.y },
        { id: "tr" as HandleId, x: cr.x + cr.w, y: cr.y },
        { id: "bl" as HandleId, x: cr.x, y: cr.y + cr.h },
        { id: "br" as HandleId, x: cr.x + cr.w, y: cr.y + cr.h },
      ];
      for (const h of corners) {
        if (Math.abs(p.x - h.x) <= tol && Math.abs(p.y - h.y) <= tol) {
          setCropDrag({ mode: "handle", handleId: h.id, startX: p.x, startY: p.y, origRect: { ...cr } });
          return;
        }
      }
      if (p.x >= cr.x && p.x <= cr.x + cr.w && p.y >= cr.y && p.y <= cr.y + cr.h) {
        setCropDrag({ mode: "move", startX: p.x, startY: p.y, origRect: { ...cr } });
        return;
      }
    }
    setCropRect({ x: p.x, y: p.y, w: 0, h: 0 });
    setCropDrag({ mode: "draw", startX: p.x, startY: p.y, origRect: { x: p.x, y: p.y, w: 0, h: 0 } });
  };

  const handleCropMove = (p: { x: number; y: number }) => {
    if (!cropDrag) return;
    const cv = canvasRef.current;
    const maxW = cv?.width ?? naturalSize.w,
      maxH = cv?.height ?? naturalSize.h;
    const dx = p.x - cropDrag.startX,
      dy = p.y - cropDrag.startY;
    const orig = cropDrag.origRect,
      aspect = getCropAspect();
    if (cropDrag.mode === "draw") {
      let w = Math.abs(p.x - cropDrag.startX),
        h: number,
        y: number;
      const x = Math.min(cropDrag.startX, p.x);
      if (aspect !== null) {
        h = w / aspect;
        y = p.y >= cropDrag.startY ? cropDrag.startY : cropDrag.startY - h;
      } else {
        h = Math.abs(p.y - cropDrag.startY);
        y = Math.min(cropDrag.startY, p.y);
      }
      const cx = Math.max(0, x),
        cy = Math.max(0, y);
      setCropRect({ x: cx, y: cy, w: Math.min(Math.max(1, w), maxW - cx), h: Math.min(Math.max(1, h), maxH - cy) });
    } else if (cropDrag.mode === "move") {
      setCropRect({
        ...orig,
        x: Math.max(0, Math.min(orig.x + dx, maxW - orig.w)),
        y: Math.max(0, Math.min(orig.y + dy, maxH - orig.h)),
      });
    } else if (cropDrag.mode === "handle" && cropDrag.handleId) {
      const hid = cropDrag.handleId;
      let { x, y, w, h } = orig;
      if (aspect !== null) {
        if (hid === "br") {
          w = Math.max(20, orig.w + dx);
          h = w / aspect;
        } else if (hid === "bl") {
          w = Math.max(20, orig.w - dx);
          h = w / aspect;
          x = orig.x + orig.w - w;
        } else if (hid === "tr") {
          w = Math.max(20, orig.w + dx);
          h = w / aspect;
          y = orig.y + orig.h - h;
        } else {
          w = Math.max(20, orig.w - dx);
          h = w / aspect;
          x = orig.x + orig.w - w;
          y = orig.y + orig.h - h;
        }
      } else {
        if (hid === "br") {
          w = Math.max(20, orig.w + dx);
          h = Math.max(20, orig.h + dy);
        } else if (hid === "bl") {
          w = Math.max(20, orig.w - dx);
          h = Math.max(20, orig.h + dy);
          x = orig.x + orig.w - w;
        } else if (hid === "tr") {
          w = Math.max(20, orig.w + dx);
          h = Math.max(20, orig.h - dy);
          y = orig.y + orig.h - h;
        } else {
          w = Math.max(20, orig.w - dx);
          h = Math.max(20, orig.h - dy);
          x = orig.x + orig.w - w;
          y = orig.y + orig.h - h;
        }
      }
      setCropRect({ x, y, w, h });
    }
  };

  const applyCrop = () => {
    if (!cropRect || !imgRef.current) return;
    const cr = cropRect;
    setCropHistory((prev) => [...prev, { imgSrc: croppedImgSrc, actions: [...actions] }]);
    const out = document.createElement("canvas");
    out.width = cr.w;
    out.height = cr.h;
    const ctx = out.getContext("2d")!;
    ctx.drawImage(imgRef.current, cr.x, cr.y, cr.w, cr.h, 0, 0, cr.w, cr.h);
    const cv = canvasRef.current;
    if (cv && actions.length > 0) {
      const tmp = document.createElement("canvas");
      tmp.width = cv.width;
      tmp.height = cv.height;
      const tc = tmp.getContext("2d")!;
      for (const a of actions) {
        if (a.type === "path" && a.points.length > 1) {
          tc.globalCompositeOperation = a.isEraser ? "destination-out" : "source-over";
          tc.strokeStyle = a.isEraser ? "rgba(0,0,0,1)" : a.color;
          tc.lineWidth = a.size;
          tc.lineCap = "round";
          tc.lineJoin = "round";
          tc.beginPath();
          tc.moveTo(a.points[0].x, a.points[0].y);
          for (let i = 1; i < a.points.length; i++) tc.lineTo(a.points[i].x, a.points[i].y);
          tc.stroke();
          tc.globalCompositeOperation = "source-over";
        } else if (a.type === "textobj") {
          tc.fillStyle = a.color;
          tc.font = `bold ${a.fontSize}px sans-serif`;
          tc.fillText(a.text, a.x, a.y);
        }
      }
      ctx.drawImage(tmp, cr.x, cr.y, cr.w, cr.h, 0, 0, cr.w, cr.h);
    }
    setCroppedImgSrc(out.toDataURL("image/png"));
    setActions([]);
    setRedoStack([]);
    setCropRect(null);
    setTool("select");
  };

  /* ━━━ Mouse handlers ━━━
   * ★ 수정 포인트:
   * 1. isDrawingRef.current 동기 설정 (batching 문제 해결)
   * 2. pen mousedown: moveTo/lineTo 동일 좌표 → arc fill (단일 클릭 버그)
   * 3. eraser mousedown: 그리기 코드 추가 (원래 없었음)
   * 4. handlePointerMove: isDrawing state → isDrawingRef.current
   * 5. toCanvas: offsetX/offsetY + rect=0 가드
   */
  const handlePointerDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const p = toCanvas(e);
    if (tool === "crop") {
      handleCropDown(p);
      isDrawingRef.current = true;
      return;
    }
    if (tool === "select") {
      handleSelectDown(p);
      isDrawingRef.current = true;
      return;
    }
    if (tool === "text") {
      const cv = canvasRef.current!;
      const rect = cv.getBoundingClientRect();
      setTextInput({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      setTextValue("");
      setTimeout(() => textInputRef.current?.focus(), 50);
      (textInputRef as any)._canvasPos = p;
      return;
    }
    isDrawingRef.current = true;
    currentStroke.current = [p];
    lastPoint.current = p;
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    if (tool === "pen") {
      /* ★ 단일 클릭 즉시 dot: arc fill
       * 기존: moveTo(p) + lineTo(p) → 길이 0 패스 → 아무것도 안 그려짐 */
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (tool === "eraser") {
      /* ★ 단일 클릭 즉시 지우기: 기존에 코드 자체가 없었음 */
      const rect = cv.getBoundingClientRect();
      const scale = rect.width > 0 ? cv.width / rect.width : 1;
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,1)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, (brushSize * scale) / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };

  const handlePointerMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool === "pen" || tool === "eraser") drawCursorAt(e.clientX, e.clientY);
    if (tool === "crop") {
      const cp = toCanvas(e);
      if (cropDrag?.handleId) {
        setCropCursor(HANDLE_CURSOR[cropDrag.handleId] ?? "crosshair");
      } else if (cropRect) {
        const cr = cropRect,
          tol = 12;
        const ch = [
          { id: "tl", x: cr.x, y: cr.y },
          { id: "tc", x: cr.x + cr.w / 2, y: cr.y },
          { id: "tr", x: cr.x + cr.w, y: cr.y },
          { id: "ml", x: cr.x, y: cr.y + cr.h / 2 },
          { id: "mr", x: cr.x + cr.w, y: cr.y + cr.h / 2 },
          { id: "bl", x: cr.x, y: cr.y + cr.h },
          { id: "bc", x: cr.x + cr.w / 2, y: cr.y + cr.h },
          { id: "br", x: cr.x + cr.w, y: cr.y + cr.h },
        ].find((h) => Math.abs(cp.x - h.x) <= tol && Math.abs(cp.y - h.y) <= tol);
        if (ch) setCropCursor(HANDLE_CURSOR[ch.id]);
        else if (cp.x >= cr.x && cp.x <= cr.x + cr.w && cp.y >= cr.y && cp.y <= cr.y + cr.h) setCropCursor("move");
        else setCropCursor("crosshair");
      } else {
        setCropCursor("crosshair");
      }
    }
    /* ★ isDrawing state → isDrawingRef.current */
    if (!isDrawingRef.current) return;
    const p = toCanvas(e);
    if (tool === "crop") {
      handleCropMove(p);
      return;
    }
    if (tool === "select") {
      handleSelectMove(p);
      return;
    }
    const cv = canvasRef.current;
    if (!cv || !lastPoint.current) return;
    const ctx = cv.getContext("2d")!;
    if (tool === "pen") {
      ctx.strokeStyle = color;
      ctx.lineWidth = brushSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalCompositeOperation = "source-over";
      ctx.beginPath();
      ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    } else if (tool === "eraser") {
      const rect = cv.getBoundingClientRect();
      const scale = rect.width > 0 ? cv.width / rect.width : 1;
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = brushSize * scale;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    }
    currentStroke.current.push(p);
    lastPoint.current = p;
  };

  const handlePointerUp = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    if (tool === "crop") {
      setCropDrag(null);
      return;
    }
    if (tool === "select") {
      if (dragState) setDragState(null);
      return;
    }
    if ((tool === "pen" || tool === "eraser") && currentStroke.current.length > 0) {
      const cv = canvasRef.current;
      const rect = cv?.getBoundingClientRect();
      const scale = rect?.width ? cv!.width / rect.width : 1;
      pushAction({
        type: "path",
        points: [...currentStroke.current],
        color,
        size: tool === "eraser" ? brushSize * scale : brushSize,
        isEraser: tool === "eraser",
      });
    }
    currentStroke.current = [];
    lastPoint.current = null;
    redraw();
  };

  const handlePointerLeave = () => {
    clearCursor();
    handlePointerUp();
  };

  /* ── text commit ── */
  const commitText = () => {
    if (!textValue.trim() || !textInput) {
      setTextInput(null);
      setEditingTextId(null);
      return;
    }
    const cv = canvasRef.current;
    const scale = naturalSize.w / (effectiveSize.w || naturalSize.w);
    const fs = textFontSize * scale;
    let w = 100,
      h = fs * 1.2;
    if (cv) {
      const m = measureText(cv.getContext("2d")!, textValue, fs);
      w = m.width;
      h = m.height;
    }
    if (editingTextId) {
      setActions((prev) =>
        prev.map((a) =>
          a.type === "textobj" && a.id === editingTextId
            ? { ...a, text: textValue, color, fontSize: fs, width: w, height: h }
            : a,
        ),
      );
      setEditingTextId(null);
    } else {
      const cp = (textInputRef as any)._canvasPos as { x: number; y: number } | undefined;
      if (!cp) {
        setTextInput(null);
        return;
      }
      pushAction({
        type: "textobj",
        id: genId(),
        text: textValue,
        x: cp.x,
        y: cp.y,
        fontSize: fs,
        color,
        width: w,
        height: h,
      });
    }
    setTextInput(null);
    setTextValue("");
  };

  /* ── undo/redo ── */
  const undo = () => {
    if (actions.length > 0) {
      setActions((prev) => {
        setRedoStack((r) => [...r, prev[prev.length - 1]]);
        return prev.slice(0, -1);
      });
      setSelectedId(null);
    } else if (cropHistory.length > 0) {
      const prev = cropHistory[cropHistory.length - 1];
      setCroppedImgSrc(prev.imgSrc);
      setActions(prev.actions);
      setRedoStack([]);
      setCropHistory((h) => h.slice(0, -1));
    }
  };
  const redo = () => {
    setRedoStack((prev) => {
      if (!prev.length) return prev;
      setActions((a) => [...a, prev[prev.length - 1]]);
      return prev.slice(0, -1);
    });
  };

  const prevColorRef = useRef(color);
  useEffect(() => {
    if (color !== prevColorRef.current && selectedId && tool === "select" && !editingTextId)
      setActions((prev) => prev.map((a) => (a.type === "textobj" && a.id === selectedId ? { ...a, color } : a)));
    prevColorRef.current = color;
  }, [color, selectedId, tool, editingTextId]);

  /* ── clear / apply ── */
  const hasAnnotations = actions.length > 0 || !!croppedImgSrc || flipH || flipV || cropHistory.length > 0;
  const originalUrl = derivedOriginal ?? _originalUrlByScene.get(sceneId) ?? null;
  const canRestore = !!(originalUrl && onRestore && (hasAnnotations || imageUrl !== originalUrl));

  const clearAll = () => {
    setActions([]);
    setRedoStack([]);
    setCropHistory([]);
    setCroppedImgSrc(null);
    setFlipH(false);
    setFlipV(false);
    setSelectedId(null);
    const cv = canvasRef.current;
    if (cv) cv.getContext("2d")!.clearRect(0, 0, cv.width, cv.height);
    if (originalUrl && onRestore) {
      _originalUrlByScene.set(sceneId, originalUrl);
      onRestore(originalUrl);
    }
  };

  const handleApply = async () => {
    if (!imgRef.current || !canvasRef.current || applying) return;
    setApplying(true);
    try {
      const out = document.createElement("canvas");
      out.width = naturalSize.w;
      out.height = naturalSize.h;
      const ctx = out.getContext("2d")!;
      if (flipH || flipV) {
        ctx.translate(flipH ? naturalSize.w : 0, flipV ? naturalSize.h : 0);
        ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      }
      ctx.drawImage(imgRef.current, 0, 0, naturalSize.w, naturalSize.h);
      setSelectedId(null);
      for (const a of actions) {
        if (a.type === "path" && a.points.length >= 1) {
          ctx.save();
          ctx.globalCompositeOperation = a.isEraser ? "destination-out" : "source-over";
          if (a.points.length === 1) {
            ctx.fillStyle = a.isEraser ? "rgba(0,0,0,1)" : a.color;
            ctx.beginPath();
            ctx.arc(a.points[0].x, a.points[0].y, a.size / 2, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.strokeStyle = a.isEraser ? "rgba(0,0,0,1)" : a.color;
            ctx.lineWidth = a.size;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            ctx.moveTo(a.points[0].x, a.points[0].y);
            for (let i = 1; i < a.points.length; i++) ctx.lineTo(a.points[i].x, a.points[i].y);
            ctx.stroke();
          }
          ctx.restore();
        } else if (a.type === "textobj") {
          ctx.fillStyle = a.color;
          ctx.font = `bold ${a.fontSize}px sans-serif`;
          ctx.fillText(a.text, a.x, a.y);
        }
      }
      const blob = await new Promise<Blob>((res, rej) =>
        out.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/png"),
      );
      const path = `${projectId}/scene_${sceneNumber}_editor_${Date.now()}.png`;
      const { error } = await supabase.storage
        .from("contis")
        .upload(path, blob, { contentType: "image/png", upsert: true });
      if (error) throw error;
      onApply(supabase.storage.from("contis").getPublicUrl(path).data.publicUrl);
    } catch (err) {
      console.error("Apply failed:", err);
    } finally {
      setApplying(false);
    }
  };

  /* ── keyboard ── */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        setActions((prev) => prev.filter((a) => !(a.type === "textobj" && a.id === selectedId)));
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selectedId]);

  const transform = `${flipH ? "scaleX(-1)" : ""} ${flipV ? "scaleY(-1)" : ""}`.trim() || undefined;
  const hasChanges = actions.length > 0 || flipH || flipV || !!croppedImgSrc;
  const getCursor = () => {
    if (tool === "pen" || tool === "eraser") return "none";
    if (tool === "select") return dragState ? "grabbing" : "default";
    if (tool === "text") return "text";
    if (tool === "crop") return cropCursor;
    return "crosshair";
  };

  if (!imageUrl && !croppedImgSrc)
    return <div className="text-muted-foreground text-sm flex items-center justify-center h-full">No image</div>;
  if (!imgLoaded)
    return (
      <div className="flex items-center justify-center h-full gap-2 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading...
      </div>
    );

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center">
      <div
        className="relative shrink-0"
        style={{ width: effectiveSize.w || undefined, height: effectiveSize.h || undefined, transform }}
      >
        <img
          src={effectiveImageUrl!}
          className="block w-full h-full"
          style={{ pointerEvents: "none" }}
          alt="conti"
          crossOrigin="anonymous"
        />
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            cursor: getCursor(),
            touchAction: "none",
          }}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={handlePointerLeave}
          onDoubleClick={(e) => {
            if (tool !== "select") return;
            const p = toCanvas(e);
            const objs = getTextObjects();
            for (let i = objs.length - 1; i >= 0; i--) {
              if (hitTestObj(objs[i], p.x, p.y)) {
                const obj = objs[i];
                setEditingTextId(obj.id);
                setSelectedId(obj.id);
                setTextValue(obj.text);
                setColor(obj.color);
                setTextFontSize(Math.round(obj.fontSize / (naturalSize.w / (effectiveSize.w || naturalSize.w))));
                const cv = canvasRef.current!;
                const rect = cv.getBoundingClientRect();
                let cssX = obj.x * (rect.width / cv.width);
                let cssY = (obj.y - obj.height) * (rect.height / cv.height);
                if (flipH) cssX = rect.width - cssX;
                if (flipV) cssY = rect.height - cssY;
                setTextInput({ x: cssX, y: cssY });
                setTimeout(() => textInputRef.current?.focus(), 50);
                return;
              }
            }
          }}
        />
        {(tool === "pen" || tool === "eraser") && (
          <canvas
            ref={cursorCanvasRef}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
          />
        )}
        {textInput && (
          <input
            ref={textInputRef}
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitText();
              if (e.key === "Escape") setTextInput(null);
            }}
            onBlur={commitText}
            className="absolute z-10 bg-black/60 text-white border border-white/20 rounded px-1 py-0.5 outline-none"
            style={{
              left: textInput.x,
              top: textInput.y,
              minWidth: 80,
              fontSize: textFontSize,
              transform: flipH || flipV ? `${flipH ? "scaleX(-1)" : ""} ${flipV ? "scaleY(-1)" : ""}` : undefined,
            }}
          />
        )}
      </div>

      {/* Toolbar */}
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-2 rounded-lg border z-20 flex-wrap justify-center"
        style={{ background: "#1a1a1a", borderColor: "rgba(255,255,255,0.08)", maxWidth: "90%" }}
      >
        {tool === "crop" && cropRect ? (
          <>
            <div className="flex items-center gap-0.5 mr-2">
              {CROP_RATIO_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setCropRatio(opt.id)}
                  className="px-2 py-0.5 rounded text-[10px] font-medium transition-colors"
                  style={{
                    background: cropRatio === opt.id ? "rgba(249,66,58,0.15)" : "transparent",
                    color: cropRatio === opt.id ? KR : "rgba(255,255,255,0.4)",
                    border: cropRatio === opt.id ? `1px solid rgba(249,66,58,0.3)` : "1px solid transparent",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="w-px h-5 bg-white/10 mx-1" />
            <button
              onClick={applyCrop}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium"
              style={{ background: KR, color: "#fff" }}
            >
              <Check className="w-3.5 h-3.5" /> Apply Crop
            </button>
            <button
              onClick={() => {
                setCropRect(null);
                setTool("select");
              }}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium text-white/60 hover:text-white"
            >
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
          </>
        ) : (
          <>
            <ToolBtn
              isActive={tool === "select"}
              icon={MousePointer2}
              label="Select"
              onClick={() => setTool("select")}
            />
            <ToolBtn
              isActive={tool === "text"}
              icon={Type}
              label="Text"
              onClick={() => {
                setTool("text");
                setSelectedId(null);
              }}
            />
            <ToolBtn
              isActive={tool === "pen"}
              icon={Pen}
              label="Pen"
              onClick={() => {
                setTool("pen");
                setSelectedId(null);
              }}
            />
            <ToolBtn
              isActive={tool === "eraser"}
              icon={Eraser}
              label="Eraser"
              onClick={() => {
                setTool("eraser");
                setSelectedId(null);
              }}
            />
            <ToolBtn
              isActive={tool === "crop"}
              icon={Crop}
              label="Crop"
              onClick={() => {
                setTool("crop");
                setSelectedId(null);
              }}
            />
            <div className="w-px h-5 bg-white/10 mx-1" />
            {tool === "crop" && (
              <>
                {CROP_RATIO_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setCropRatio(opt.id)}
                    className="px-2 py-0.5 rounded text-[10px] font-medium transition-colors"
                    style={{
                      background: cropRatio === opt.id ? "rgba(249,66,58,0.15)" : "transparent",
                      color: cropRatio === opt.id ? KR : "rgba(255,255,255,0.4)",
                      border: cropRatio === opt.id ? `1px solid rgba(249,66,58,0.3)` : "1px solid transparent",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
                <div className="w-px h-5 bg-white/10 mx-1" />
              </>
            )}
            {(tool === "pen" || tool === "eraser") && (
              <>
                <input
                  type="range"
                  min={1}
                  max={60}
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                  className="w-20 h-1 cursor-pointer"
                  style={{ accentColor: KR }}
                />
                <span className="text-[10px] text-white/50 min-w-[28px] text-center">{brushSize}px</span>
                <div className="w-px h-5 bg-white/10 mx-1" />
              </>
            )}
            {tool === "text" && (
              <>
                {TEXT_FONT_SIZES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setTextFontSize(s)}
                    className="px-1.5 py-0.5 rounded-full text-[10px] font-medium transition-colors"
                    style={{
                      background: textFontSize === s ? "rgba(249,66,58,0.15)" : "transparent",
                      color: textFontSize === s ? KR : "rgba(255,255,255,0.4)",
                      border: textFontSize === s ? `1px solid rgba(249,66,58,0.3)` : "1px solid transparent",
                    }}
                  >
                    {s}
                  </button>
                ))}
                <div className="w-px h-5 bg-white/10 mx-1" />
              </>
            )}
            <div className="relative">
              <button
                onClick={() => colorInputRef.current?.click()}
                className="w-6 h-6 rounded-full border-2"
                title="Color"
                style={{ background: color, borderColor: "rgba(255,255,255,0.2)" }}
              />
              <input
                ref={colorInputRef}
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="absolute inset-0 w-0 h-0 opacity-0 pointer-events-none"
              />
            </div>
            <ActionBtn
              icon={Undo2}
              label="Undo (Ctrl+Z)"
              onClick={undo}
              disabled={actions.length === 0 && cropHistory.length === 0}
            />
            <ActionBtn icon={Redo2} label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={redoStack.length === 0} />
            <ActionBtn icon={FlipHorizontal2} label="Flip H" onClick={() => setFlipH((v) => !v)} />
            <ActionBtn icon={FlipVertical2} label="Flip V" onClick={() => setFlipV((v) => !v)} />
            <button
              onClick={clearAll}
              disabled={!canRestore}
              title={canRestore ? "Restore Original" : "No changes"}
              className="flex items-center gap-1 p-1.5 rounded transition-colors disabled:opacity-30"
              style={{ color: canRestore ? "#dc2626" : "rgba(255,255,255,0.5)" }}
            >
              <Trash2 className="w-4 h-4" />
              {canRestore && <span className="text-[10px] font-medium">Restore</span>}
            </button>
            <div className="w-px h-5 bg-white/10 mx-1" />
            <button
              onClick={handleApply}
              disabled={applying || !hasChanges}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors disabled:opacity-30"
              style={{ background: KR, color: "#fff" }}
            >
              {applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Apply
            </button>
          </>
        )}
      </div>
    </div>
  );
};
