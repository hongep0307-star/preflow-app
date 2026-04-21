import { useRef, useState } from "react";
import { X, ZoomIn, ZoomOut, Package, MapPin, Users, User, Shirt } from "lucide-react";
import { type Asset, KR, KR_BORDER } from "./types";

interface Props {
  asset: Asset;
  sceneCount: number;
  onClose: () => void;
}

export const AssetDetailModal = ({ asset, sceneCount, onClose }: Props) => {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

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
  const imgPanelW = asset.asset_type === "background" ? 580 : asset.asset_type === "item" ? 500 : 360;

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
            style={{ minHeight: isChar ? 380 : 280, maxHeight: "80vh" }}
            onWheel={(e) => {
              e.preventDefault();
              zoom(-e.deltaY * 0.001);
            }}
          >
            {asset.photo_url ? (
              <img
                src={asset.photo_url}
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
                  maxHeight: "72vh",
                  objectFit: "contain",
                }} loading="lazy" decoding="async" />
            ) : (
              <div className="flex items-center justify-center w-full h-full opacity-10">
                {asset.asset_type === "item" ? (
                  <Package className="w-16 h-16 text-white" />
                ) : asset.asset_type === "background" ? (
                  <MapPin className="w-16 h-16 text-white" />
                ) : (
                  <Users className="w-16 h-16 text-white" />
                )}
              </div>
            )}
          </div>

          <p className="text-center text-white/25 text-[10px] py-2 pointer-events-none select-none">
            {scale > 1 ? "Drag to move · Scroll to zoom" : "Scroll to zoom · Click outside to close"}
          </p>
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
                <Package className="w-3 h-3" /> Item Description
              </p>
              <p className="text-[13px] text-foreground/80 leading-relaxed">{asset.ai_description}</p>
            </div>
          )}
          {asset.asset_type === "background" && asset.space_description && (
            <div className="mb-4">
              <p className="text-[11px] text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                <MapPin className="w-3 h-3" /> Location Description
              </p>
              <p className="text-[13px] text-foreground/80 leading-relaxed">{asset.space_description}</p>
            </div>
          )}
          {isChar && (
            <>
              {asset.ai_description && (
                <div className="mb-4">
                  <p className="text-[11px] text-muted-foreground font-medium mb-1.5">Character Description</p>
                  <p className="text-[13px] text-foreground/80 leading-relaxed">
                    {asset.ai_description.slice(0, 240)}
                    {asset.ai_description.length > 240 ? "..." : ""}
                  </p>
                </div>
              )}
              {asset.role_description && (
                <div className="mb-3">
                  <p className="text-[11px] text-muted-foreground font-medium mb-0.5 flex items-center gap-1.5">
                    <User className="w-3 h-3" /> Role / Relationship
                  </p>
                  <p className="text-[13px] text-foreground/70">{asset.role_description}</p>
                </div>
              )}
              {asset.outfit_description && (
                <div className="mb-3">
                  <p className="text-[11px] text-muted-foreground font-medium mb-0.5 flex items-center gap-1.5">
                    <Shirt className="w-3 h-3" /> Outfit
                  </p>
                  <p className="text-[13px] text-foreground/70">{asset.outfit_description}</p>
                </div>
              )}
              {!asset.ai_description && !asset.role_description && !asset.outfit_description && (
                <p className="text-[12px] text-muted-foreground/30">No description registered</p>
              )}
            </>
          )}

          <div className="mt-auto pt-3 border-t border-border">
            <span className="text-[11px] text-muted-foreground/50">
              Used in {sceneCount} {sceneCount === 1 ? "Scene" : "Scenes"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
