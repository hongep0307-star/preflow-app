import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
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
  Users,
  ArrowRight,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

/* ━━━━━ 컬러 ━━━━━ */
const KR = "#f9423a";
const KR_BG = "rgba(249,66,58,0.10)";
const KR_BORDER = "rgba(249,66,58,0.25)";

/* ━━━━━ 타입 ━━━━━ */
type AssetType = "character" | "item" | "background";

const TYPE_META: Record<
  AssetType,
  {
    label: string;
    icon: React.ReactNode;
    gridCols: string;
    emptyIcon: React.ReactNode;
    emptyText: string;
    addLabel: string;
  }
> = {
  character: {
    label: "Character",
    icon: <Users className="w-3.5 h-3.5" />,
    gridCols: "grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
    emptyIcon: <Users className="w-12 h-12 text-border mb-4" />,
    emptyText: "Register characters to @tag them in scenes and reference during conti generation",
    addLabel: "Add Character",
  },
  item: {
    label: "Item",
    icon: <Package className="w-3.5 h-3.5" />,
    gridCols: "grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
    emptyIcon: <Package className="w-12 h-12 text-border mb-4" />,
    emptyText: "Register props to auto-inject material and detail info when tagging scenes",
    addLabel: "Add Item",
  },
  background: {
    label: "Background",
    icon: <MapPin className="w-3.5 h-3.5" />,
    gridCols: "grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
    emptyIcon: <MapPin className="w-12 h-12 text-border mb-4" />,
    emptyText: "Register locations to maintain spatial consistency across tagged scenes",
    addLabel: "Add Background",
  },
};

interface FocalPoint {
  x: number;
  y: number;
  scale?: number;
}

interface Asset {
  id: string;
  project_id: string;
  tag_name: string;
  photo_url: string | null;
  ai_description: string | null;
  outfit_description: string | null;
  role_description: string | null;
  signature_items: string | null;
  space_description: string | null;
  asset_type: AssetType;
  source_type: string;
  created_at: string;
}
interface Props {
  projectId: string;
  onSwitchToAgent?: () => void;
}

/* ━━━━━ 이미지 유틸 ━━━━━ */
const dataUrlToResizedBase64 = (dataUrl: string, maxSize = 512): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale),
        h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.8).split(",")[1]);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        resolve(await dataUrlToResizedBase64(reader.result as string));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const urlToBase64 = async (url: string): Promise<{ base64: string; mediaType: string }> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`이미지 fetch 실패 (${res.status})`);
  const blob = await res.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  const resized = await dataUrlToResizedBase64(dataUrl);
  return { base64: resized, mediaType: detectMediaType(resized) };
};

/* ━━━━━ Vision 분석 ━━━━━ */
const VISION_CONFIGS: Record<AssetType, { system: string; prompt: string }> = {
  character: {
    system: "You are a fashion analyst for commercial film production. Analyze clothing and return only JSON.",
    prompt: `이 이미지 속 인물의 착장만 분석하세요. 아래 JSON만 반환 (마크다운 없이):\n{"outfit":"의상 설명 (영어, 색상/스타일/의류 종류 포함)"}`,
  },
  item: {
    system: "You are a prop analyst for commercial film production. Analyze objects and return only JSON.",
    prompt: `이 이미지 속 오브젝트/소품을 분석하세요. 아래 JSON만 반환 (마크다운 없이):\n{"description":"상세 묘사 (영어, 형태/크기/소재/색상/질감/특이사항/브랜드 포함)"}`,
  },
  background: {
    system: "You are a location scout for commercial film production. Analyze locations and return only JSON.",
    prompt: `이 이미지 속 배경/장소를 분석하세요. 아래 JSON만 반환 (마크다운 없이):\n{"description":"장소 묘사 (영어, 공간 유형/조명/분위기/색감/주요 요소/시간대 포함)"}`,
  },
};

const callVisionAnalyze = async (base64: string, mediaType: string, type: AssetType) => {
  const { system, prompt } = VISION_CONFIGS[type];
  const data = await callClaude({
    model: "claude-sonnet-4-20250514",
    max_tokens: 300,
    system,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType as any, data: base64 } },
          { type: "text", text: prompt },
        ],
      },
    ],
  });
  const raw: string = data.content?.[0]?.text ?? "";
  if (!raw) throw new Error("응답이 비어 있습니다");
  const jsonMatch = raw
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim()
    .match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`JSON 파싱 실패: ${raw.slice(0, 80)}`);
  return JSON.parse(jsonMatch[0]);
};

/* ━━━━━ AssetDetailModal — 1클릭 통합 뷰 (이미지 줌/드래그 + 정보 패널) ━━━━━ */
const AssetDetailModal = ({
  asset,
  sceneCount,
  onClose,
}: {
  asset: Asset;
  sceneCount: number;
  onClose: () => void;
}) => {
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
        {/* ── 이미지 영역 ── */}
        <div className="relative bg-[#0d0d0d] flex flex-col" style={{ width: imgPanelW, minWidth: 240 }}>
          {/* 줌 컨트롤 */}
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

          {/* 이미지 */}
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
                }}
              />
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

          {/* 하단 힌트 */}
          <p className="text-center text-white/25 text-[10px] py-2 pointer-events-none select-none">
            {scale > 1 ? "Drag to move · Scroll to zoom" : "Scroll to zoom · Click outside to close"}
          </p>
        </div>

        {/* ── 우측 정보 패널 ── */}
        <div
          className="flex flex-col bg-card border-l border-border p-5 overflow-y-auto"
          style={{ width: 240, minWidth: 200 }}
        >
          {/* 닫기 버튼 */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center bg-muted hover:bg-muted/80 transition-colors"
            style={{ borderRadius: 3 }}
          >
            <X className="w-3 h-3 text-muted-foreground" />
          </button>

          {/* 태그 배지 */}
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

          {/* 설명 — 타입별 */}
          {asset.asset_type === "item" && asset.ai_description && (
            <div className="mb-4">
              <p className="text-[11px] text-muted-foreground font-medium mb-1.5">📦 Item Description</p>
              <p className="text-[13px] text-foreground/80 leading-relaxed">{asset.ai_description}</p>
            </div>
          )}
          {asset.asset_type === "background" && asset.space_description && (
            <div className="mb-4">
              <p className="text-[11px] text-muted-foreground font-medium mb-1.5">📍 Location Description</p>
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
                  <p className="text-[11px] text-muted-foreground font-medium mb-0.5">🎭 Role / Relationship</p>
                  <p className="text-[13px] text-foreground/70">{asset.role_description}</p>
                </div>
              )}
              {asset.outfit_description && (
                <div className="mb-3">
                  <p className="text-[11px] text-muted-foreground font-medium mb-0.5">👗 Outfit</p>
                  <p className="text-[13px] text-foreground/70">{asset.outfit_description}</p>
                </div>
              )}
              {!asset.ai_description && !asset.role_description && !asset.outfit_description && (
                <p className="text-[12px] text-muted-foreground/30">No description registered</p>
              )}
            </>
          )}

          {/* 씬 사용 수 */}
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

/* ━━━━━ FocalEditor ━━━━━ */
const FocalEditor = ({
  url,
  initial,
  onSave,
  onClose,
}: {
  url: string;
  initial: FocalPoint;
  onSave: (p: FocalPoint) => void;
  onClose: () => void;
}) => {
  const [pos, setPos] = useState<FocalPoint>(initial);
  const [scale, setScale] = useState<number>(initial.scale ?? 1.4);
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  const onDown = (e: React.MouseEvent | React.TouchEvent) => {
    dragging.current = true;
    const pt = "touches" in e ? e.touches[0] : e;
    last.current = { x: pt.clientX, y: pt.clientY };
  };
  const onMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!dragging.current) return;
    const pt = "touches" in e ? e.touches[0] : e;
    const dx = pt.clientX - last.current.x,
      dy = pt.clientY - last.current.y;
    last.current = { x: pt.clientX, y: pt.clientY };
    setPos((p) => ({
      ...p,
      x: Math.max(0, Math.min(100, p.x - dx * 0.3)),
      y: Math.max(0, Math.min(100, p.y - dy * 0.3)),
    }));
  };
  const onUp = () => {
    dragging.current = false;
  };

  const bsz = `${Math.round(scale * 100)}%`;
  const fillPct = ((scale * 100 - 80) / (300 - 80)) * 100;
  const trackStyle = {
    background: `linear-gradient(to right, ${KR} 0%, ${KR} ${fillPct}%, #e2e2e2 ${fillPct}%, #e2e2e2 100%)`,
    accentColor: KR,
    height: "4px",
    borderRadius: "2px",
    outline: "none",
    border: "none",
    cursor: "pointer",
    WebkitAppearance: "none" as const,
    appearance: "none" as const,
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={onClose}
    >
      <div className="bg-card rounded p-6 w-80 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-semibold text-foreground mb-1">Adjust profile image</p>
        <p className="text-[12px] text-muted-foreground mb-4">드래그로 위치 · 슬라이더로 크기를 조정하세요</p>
        <div className="flex justify-center mb-4">
          <div
            className="w-44 h-44 rounded-full overflow-hidden cursor-grab active:cursor-grabbing select-none"
            style={{
              backgroundImage: `url(${url})`,
              backgroundSize: bsz,
              backgroundPosition: `${pos.x}% ${pos.y}%`,
              outline: `2px solid ${KR}`,
            }}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
            onTouchStart={onDown}
            onTouchMove={onMove}
            onTouchEnd={onUp}
          />
        </div>
        <div className="mb-5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[12px] text-muted-foreground">크기</span>
            <span className="text-[12px] font-medium" style={{ color: KR }}>
              {Math.round(scale * 100)}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ZoomOut className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              type="range"
              min={80}
              max={300}
              value={Math.round(scale * 100)}
              onChange={(e) => setScale(Number(e.target.value) / 100)}
              className="flex-1"
              style={trackStyle}
            />
            <ZoomIn className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            취소
          </Button>
          <Button
            size="sm"
            className="text-white"
            style={{ background: KR }}
            onClick={() => {
              onSave({ ...pos, scale });
              onClose();
            }}
          >
            적용
          </Button>
        </div>
      </div>
    </div>
  );
};

/* ━━━━━ SquareAvatar ━━━━━ */
const SquareAvatar = ({ url, focal, name }: { url: string | null; focal: FocalPoint; name: string }) => (
  <div className="w-full flex items-center justify-center pt-4 pb-3">
    <div
      className="rounded-full overflow-hidden group-hover:ring-2 group-hover:ring-primary/40 transition-all"
      style={{ width: 128, height: 128, background: "hsl(var(--elevated))" }}
    >
      {url ? (
        <div
          className="w-full h-full"
          style={{
            backgroundImage: `url(${url})`,
            backgroundSize: `${Math.round((focal.scale ?? 1.4) * 100)}%`,
            backgroundPosition: `${focal.x}% ${focal.y}%`,
          }}
        />
      ) : (
        <div
          className="w-full h-full flex items-center justify-center text-white font-bold text-3xl"
          style={{ background: KR }}
        >
          {name.charAt(0)}
        </div>
      )}
    </div>
  </div>
);

/* ━━━━━ UploadZone ━━━━━ */
const UploadZone = ({ assetType, onFile }: { assetType: AssetType; onFile: (file: File) => void }) => {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) onFile(file);
  };
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className="w-full border border-dashed flex flex-col items-center justify-center gap-2 transition-all"
        style={{
          height: assetType === "background" ? 120 : 100,
          borderRadius: 0,
          borderColor: dragOver ? KR : "rgba(255,255,255,0.1)",
          background: dragOver ? "rgba(249,66,58,0.04)" : "transparent",
        }}
      >
        <Plus className="w-5 h-5" style={{ color: dragOver ? KR : "rgba(255,255,255,0.2)" }} />
        <span className="font-mono text-[10px] tracking-wider text-muted-foreground/40">
          {dragOver ? "Drop Here" : "Drag or Click · Max 5MB"}
        </span>
      </button>
    </>
  );
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Main Component
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
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
  const saveFocal = (id: string, p: FocalPoint) => {
    const next = { ...focalPoints, [id]: p };
    setFocalPoints(next);
    supabase.from("assets").update({ photo_crop: p as any }).eq("id", id).then(() => {});
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

  /* ━━━ 씬 카운트 — 활성 버전 기준 + 씬당 고유 1회 ━━━ */
  const fetchSceneCounts = useCallback(async () => {
    // 1. 프로젝트의 active_version_id 조회
    const { data: projectData } = await supabase
      .from("projects")
      .select("active_version_id")
      .eq("id", projectId)
      .single();

    let rawScenes: Array<{ tagged_assets?: string[] }> = [];

    if (projectData?.active_version_id) {
      // 2. 활성 버전 스냅샷에서 scenes JSONB 사용
      const { data: versionData } = await supabase
        .from("scene_versions")
        .select("scenes")
        .eq("id", projectData.active_version_id)
        .single();
      if (versionData?.scenes && Array.isArray(versionData.scenes)) {
        rawScenes = versionData.scenes as Array<{ tagged_assets?: string[] }>;
      }
    }

    // 3. 폴백: scenes 테이블 직접 조회 (활성 버전 없거나 데이터 없을 때)
    if (rawScenes.length === 0) {
      const { data: scenesData } = await supabase.from("scenes").select("tagged_assets").eq("project_id", projectId);
      rawScenes = scenesData ?? [];
    }

    // 4. 씬당 고유 카운팅 — 한 씬에 같은 태그가 여러 번 있어도 1로 처리
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
        system: "당신은 광고 영상 제작을 위한 인물 비주얼 디렉터입니다.",
        messages: [
          {
            role: "user",
            content: `다음 기본 설명을 바탕으로 광고 영상 콘티 이미지 생성에 사용할 상세한 인물 묘사를 영어로 작성해주세요.\n외모(얼굴형, 피부톤, 헤어스타일, 눈코입 특징), 체형, 분위기를 구체적으로 묘사하세요. 의상은 별도 항목에서 입력받으므로 제외하세요.\n반드시 영어로만 작성하세요:\n\n[입력]: ${aiInput}`,
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
    await supabase.from("assets").delete().eq("id", id);
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

  /* ── 공통 액션 버튼 ── */
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

  /* ── 씬 카운트 배지 ── */
  const SceneCount = ({ tagName }: { tagName: string }) => {
    const count = sceneCounts[tagName] ?? 0;
    return (
      <span className="text-[10px] text-muted-foreground/40">
        {count} {count === 1 ? "Scene" : "Scenes"}
      </span>
    );
  };

  /* ── 카드 렌더 ── */
  const renderCard = (asset: Asset) => {
    /* 캐릭터 — 전체 카드 클릭 가능 */
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
            {/* 얼굴 조정 버튼 — 6시 방향 */}
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
              <div className="flex items-start gap-1">
                <span className="text-[11px] shrink-0 mt-px">🎭</span>
                <span className="text-[11px] text-muted-foreground leading-snug line-clamp-1">
                  {asset.role_description}
                </span>
              </div>
            )}
            {asset.outfit_description && (
              <div className="flex items-start gap-1">
                <span className="text-[11px] shrink-0 mt-px">👗</span>
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

    /* 아이템 */
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
              <img src={asset.photo_url} className="w-full h-full object-cover" alt={asset.tag_name} />
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

    /* 배경 */
    return (
      <div
        key={asset.id}
        className="border border-border bg-card overflow-hidden hover:border-primary/30 transition-all group cursor-pointer"
        style={{ borderRadius: 4 }}
        onClick={() => setPreviewAsset(asset)}
      >
        <div className="relative aspect-video bg-background overflow-hidden">
          {asset.photo_url ? (
            <img src={asset.photo_url} className="w-full h-full object-cover" alt={asset.tag_name} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <MapPin className="w-8 h-8 text-muted-foreground/20" />
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
  };

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     JSX
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  return (
    <div className="h-full overflow-y-auto">
      {/* ── 헤더 ── */}
      <div className="flex items-center justify-between border-b border-white/[0.08] px-5 pt-4">
        {/* 타입 탭 */}
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
        {/* 버튼 */}
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
                    : "에셋 없이도 이동 가능 — 채팅으로 먼저 스토리를 다듬어도 돼요"
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

      {/* ── 그리드 ── */}
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

      {/* ── Focal editor ── */}
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

      {/* ── 통합 에셋 디테일 모달 (1클릭, 줌/드래그 + 정보 패널) ── */}
      {previewAsset && (
        <AssetDetailModal
          asset={previewAsset}
          sceneCount={sceneCounts[previewAsset.tag_name] ?? 0}
          onClose={() => setPreviewAsset(null)}
        />
      )}

      {/* ── 생성/편집 모달 ── */}
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
                        style={{ display: "block" }}
                      />
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
                            <img src={generatedPortraitUrl} className="max-w-full max-h-[280px] object-contain" />
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
                    <label className="text-xs text-muted-foreground mb-1.5 block">
                      🎭 Role / Relationship <span className="text-muted-foreground/40">(optional)</span>
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
                    <label className="text-xs text-muted-foreground mb-1.5 block">
                      👗 Outfit / Style <span className="text-muted-foreground/40">(optional)</span>
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
                  <label className="text-xs text-muted-foreground mb-1.5 block">
                    📦 Item Detail <span className="text-muted-foreground/40">(optional · auto-analyzable)</span>
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
                  <label className="text-xs text-muted-foreground mb-1.5 block">
                    📍 Location Description{" "}
                    <span className="text-muted-foreground/40">(optional · auto-analyzable)</span>
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

      {/* ── 삭제 확인 ── */}
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
