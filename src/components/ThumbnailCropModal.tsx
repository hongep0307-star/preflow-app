import { useState, useRef, useCallback, useEffect } from "react";
import { X, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

export interface CropSettings {
  x: number; // 0-100 object-position x %
  y: number; // 0-100 object-position y %
  scale: number; // 1-3
}

interface Props {
  imageUrl: string;
  initial?: CropSettings | null;
  onSave: (crop: CropSettings) => void;
  onClose: () => void;
}

const PREVIEW_W = 400;
const PREVIEW_H = 240; // ~5:3 dashboard card ratio
const MIN_SCALE = 1;
const MAX_SCALE = 3;
const STEP = 0.1;

export const ThumbnailCropModal = ({ imageUrl, initial, onSave, onClose }: Props) => {
  const [scale, setScale] = useState(initial?.scale ?? 1);
  const [pos, setPos] = useState<{ x: number; y: number }>({
    x: initial?.x ?? 50,
    y: initial?.y ?? 50,
  });
  const dragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      lastMouse.current = { x: e.clientX, y: e.clientY };

      // Convert pixel delta to percentage shift (inverse direction for object-position)
      const pctX = (dx / PREVIEW_W) * 100 * (1 / Math.max(scale - 1, 0.3));
      const pctY = (dy / PREVIEW_H) * 100 * (1 / Math.max(scale - 1, 0.3));

      setPos((prev) => ({
        x: clamp(prev.x - pctX, 0, 100),
        y: clamp(prev.y - pctY, 0, 100),
      }));
    },
    [scale]
  );

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale((prev) => clamp(prev + (e.deltaY > 0 ? -STEP : STEP), MIN_SCALE, MAX_SCALE));
  }, []);

  const reset = () => {
    setScale(1);
    setPos({ x: 50, y: 50 });
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex flex-col gap-4 p-5"
        style={{
          background: "#1a1a1a",
          border: "1px solid rgba(255,255,255,0.08)",
          width: PREVIEW_W + 40,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">Adjust Thumbnail</span>
          <button onClick={onClose} className="p-1 hover:bg-white/10 transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Preview area */}
        <div
          ref={containerRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
          className="relative overflow-hidden mx-auto"
          style={{
            width: PREVIEW_W,
            height: PREVIEW_H,
            cursor: scale > 1 ? "grab" : "default",
            border: "1px solid rgba(255,255,255,0.1)",
            background: "#000",
          }}
        >
          <img
            ref={imgRef}
            src={imageUrl}
            alt="Thumbnail preview"
            draggable={false}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: `${pos.x}% ${pos.y}%`,
              transform: `scale(${scale})`,
              transformOrigin: `${pos.x}% ${pos.y}%`,
              pointerEvents: "none",
              userSelect: "none",
            }}
          />
          {/* Crosshair guides */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              border: "2px solid rgba(255,255,255,0.15)",
            }}
          />
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 justify-center">
          <button
            onClick={() => setScale((s) => clamp(s - STEP * 2, MIN_SCALE, MAX_SCALE))}
            className="p-1.5 hover:bg-white/10 transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="w-4 h-4 text-muted-foreground" />
          </button>

          <div className="flex items-center gap-2 w-48">
            <input
              type="range"
              min={MIN_SCALE * 100}
              max={MAX_SCALE * 100}
              value={scale * 100}
              onChange={(e) => setScale(Number(e.target.value) / 100)}
              className="w-full accent-primary h-1"
              style={{ cursor: "pointer" }}
            />
            <span className="text-[11px] text-muted-foreground font-mono w-10 text-right">
              {Math.round(scale * 100)}%
            </span>
          </div>

          <button
            onClick={() => setScale((s) => clamp(s + STEP * 2, MIN_SCALE, MAX_SCALE))}
            className="p-1.5 hover:bg-white/10 transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="w-4 h-4 text-muted-foreground" />
          </button>

          <div className="w-px h-4 bg-white/10" />

          <button
            onClick={reset}
            className="p-1.5 hover:bg-white/10 transition-colors"
            title="Reset"
          >
            <RotateCcw className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 h-8 text-xs font-medium text-muted-foreground hover:bg-white/5 border border-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave({ x: pos.x, y: pos.y, scale })}
            className="px-4 h-8 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
