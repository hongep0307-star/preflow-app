import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { sanitizeImagePrompt, IMAGE_SIZE_MAP, type VideoFormat } from "@/lib/conti";
import { useToast } from "@/hooks/use-toast";
import { Upload, X, ChevronDown, ChevronUp } from "lucide-react";

/* ━━━━━ 타입 ━━━━━ */
interface Scene {
  id: string;
  project_id: string;
  scene_number: number;
  title: string | null;
  conti_image_url: string | null;
  tagged_assets: string[];
}

interface Asset {
  id?: string;
  tag_name: string;
  photo_url: string | null;
  ai_description: string | null;
  outfit_description: string | null;
  space_description: string | null;
  asset_type: "character" | "item" | "background";
}

interface OtherScene {
  id: string;
  scene_number: number;
  title: string | null;
  conti_image_url: string;
}

interface Props {
  scene: Scene;
  videoFormat: VideoFormat;
  onClose: () => void;
  onSave: (newUrl: string) => void;
}

/* ━━━━━ 에셋 타입 컬러 ━━━━━ */
const ACFG: Record<string, { color: string; bg: string; bd: string }> = {
  character: { color: "#6366f1", bg: "rgba(99,102,241,0.12)", bd: "rgba(99,102,241,0.30)" },
  item: { color: "#d97706", bg: "rgba(245,158,11,0.12)", bd: "rgba(245,158,11,0.30)" },
  background: { color: "#059669", bg: "rgba(16,185,129,0.12)", bd: "rgba(16,185,129,0.30)" },
};
const TYPE_LABEL: Record<string, string> = { character: "Character", item: "Item", background: "Background" };

const KR = "#f9423a";

export const InpaintModal = ({ scene, videoFormat, onClose, onSave }: Props) => {
  const { toast } = useToast();

  /* ── 캔버스 ── */
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(30);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  /* ── 프롬프트 & 생성 ── */
  const [inpaintPrompt, setInpaintPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  /* ── 레퍼런스 데이터 ── */
  const [projectAssets, setProjectAssets] = useState<Asset[]>([]);
  const [otherScenes, setOtherScenes] = useState<OtherScene[]>([]);

  /* ── 선택된 레퍼런스 ── */
  const [selectedAssets, setSelectedAssets] = useState<Asset[]>([]);
  const [selectedScenes, setSelectedScenes] = useState<OtherScene[]>([]);
  const [customRefImages, setCustomRefImages] = useState<{ preview: string; file: File }[]>([]);

  /* ── UI 토글 ── */
  const [assetOpen, setAssetOpen] = useState(true);
  const [sceneOpen, setSceneOpen] = useState(false);
  const customRefInputRef = useRef<HTMLInputElement>(null);

  /* ━━━━━ 데이터 페치 ━━━━━ */
  useEffect(() => {
    supabase
      .from("assets")
      .select("tag_name, photo_url, ai_description, outfit_description, space_description, asset_type")
      .eq("project_id", scene.project_id)
      .then(({ data }) => setProjectAssets((data ?? []) as Asset[]));

    supabase
      .from("scenes")
      .select("id, scene_number, title, conti_image_url")
      .eq("project_id", scene.project_id)
      .neq("id", scene.id)
      .not("conti_image_url", "is", null)
      .order("scene_number", { ascending: true })
      .then(({ data }) => setOtherScenes((data ?? []).filter((s) => s.conti_image_url) as OtherScene[]));
  }, [scene.project_id, scene.id]);

  /* ━━━━━ 이미지 로드 ━━━━━ */
  useEffect(() => {
    if (!scene.conti_image_url) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(scene.conti_image_url!);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          const ic = imageCanvasRef.current;
          const mc = maskCanvasRef.current;
          if (!ic || !mc) return;
          ic.width = mc.width = img.naturalWidth;
          ic.height = mc.height = img.naturalHeight;
          ic.getContext("2d")!.drawImage(img, 0, 0);
          mc.getContext("2d")!.clearRect(0, 0, mc.width, mc.height);
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
  }, [scene.conti_image_url]);

  /* ━━━━━ 브러시 ━━━━━ */
  const paintAt = (clientX: number, clientY: number) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    ctx.fillStyle = "rgba(249,66,58,0.55)";
    ctx.beginPath();
    ctx.arc((clientX - rect.left) * sx, (clientY - rect.top) * sy, brushSize * sx, 0, Math.PI * 2);
    ctx.fill();
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    paintAt(e.clientX, e.clientY);
  };
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    paintAt(e.clientX, e.clientY);
  };
  const handleTouch = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const t = e.touches[0];
    paintAt(t.clientX, t.clientY);
  };
  const handleReset = () => {
    const mc = maskCanvasRef.current;
    if (mc) mc.getContext("2d")!.clearRect(0, 0, mc.width, mc.height);
  };

  /* ━━━━━ 마스크 추출 — Flux/GPT 형식 (칠한 영역 = 흰색) ━━━━━ */
  const extractMaskBase64 = (): string => {
    const mc = maskCanvasRef.current!;
    const src = mc.getContext("2d")!.getImageData(0, 0, mc.width, mc.height);
    const out = document.createElement("canvas");
    out.width = mc.width;
    out.height = mc.height;
    const octx = out.getContext("2d")!;
    const outID = octx.createImageData(mc.width, mc.height);
    for (let i = 0; i < src.data.length; i += 4) {
      const painted = src.data[i + 3] > 10;
      // Flux fill: white = inpaint, black = preserve
      outID.data[i] = painted ? 255 : 0;
      outID.data[i + 1] = painted ? 255 : 0;
      outID.data[i + 2] = painted ? 255 : 0;
      outID.data[i + 3] = 255;
    }
    octx.putImageData(outID, 0, 0);
    return out.toDataURL("image/png").split(",")[1];
  };

  /* ━━━━━ 마스크 오버레이 생성 — NB2(Gemini 3.1) 용 시각 힌트 이미지 ━━━━━
   * NB2 는 mask 파라미터가 없으므로, 원본 위에 브러시 영역을 형광 마젠타(#FF00FF)로
   * 칠한 합성 PNG 를 레퍼런스 이미지로 전달하여 "수정 영역"을 시각적으로 지정한다.
   * 프롬프트 프리픽스와 함께 사용될 때 surgical precision 을 최대한 보존.
   */
  const buildMaskOverlayBase64 = (): string | null => {
    const ic = imageCanvasRef.current;
    const mc = maskCanvasRef.current;
    if (!ic || !mc) return null;
    // 칠해진 픽셀이 하나도 없으면 오버레이 생성 스킵
    const mImg = mc.getContext("2d")!.getImageData(0, 0, mc.width, mc.height);
    let anyPainted = false;
    for (let i = 3; i < mImg.data.length; i += 4) {
      if (mImg.data[i] > 10) {
        anyPainted = true;
        break;
      }
    }
    if (!anyPainted) return null;

    const out = document.createElement("canvas");
    out.width = ic.width;
    out.height = ic.height;
    const ctx = out.getContext("2d")!;
    ctx.drawImage(ic, 0, 0);
    const imageData = ctx.getImageData(0, 0, out.width, out.height);
    for (let i = 0; i < mImg.data.length; i += 4) {
      if (mImg.data[i + 3] > 10) {
        imageData.data[i] = 255; // R
        imageData.data[i + 1] = 0; // G
        imageData.data[i + 2] = 255; // B — 형광 마젠타
        imageData.data[i + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return out.toDataURL("image/png").split(",")[1];
  };

  const uploadMaskOverlayAndGetUrl = async (): Promise<string | null> => {
    const b64 = buildMaskOverlayBase64();
    if (!b64) return null;
    try {
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
      const path = `${scene.project_id}/temp-mask-overlay-${Date.now()}.png`;
      const { error } = await supabase.storage
        .from("contis")
        .upload(path, blob, { upsert: true, contentType: "image/png" });
      if (error) return null;
      return supabase.storage.from("contis").getPublicUrl(path).data.publicUrl;
    } catch {
      return null;
    }
  };

  /* ━━━━━ 레퍼런스 토글 ━━━━━ */
  const toggleAsset = (asset: Asset) => {
    setSelectedAssets((prev) =>
      prev.find((a) => a.tag_name === asset.tag_name)
        ? prev.filter((a) => a.tag_name !== asset.tag_name)
        : [...prev, asset],
    );
  };
  const toggleScene = (s: OtherScene) => {
    setSelectedScenes((prev) => (prev.find((x) => x.id === s.id) ? prev.filter((x) => x.id !== s.id) : [...prev, s]));
  };

  /* ━━━━━ 커스텀 이미지 업로드 ━━━━━ */
  const handleCustomRefUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.slice(0, 3 - customRefImages.length).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      setCustomRefImages((prev) => [...prev, { preview: URL.createObjectURL(file), file }]);
    });
    e.target.value = "";
  };
  const removeCustomRef = (idx: number) => {
    setCustomRefImages((prev) => {
      URL.revokeObjectURL(prev[idx].preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  /* ━━━━━ 프롬프트 보강 ━━━━━ */
  const buildEnrichedPrompt = (): string => {
    let p = sanitizeImagePrompt(inpaintPrompt.trim());
    if (selectedAssets.length > 0) {
      const descs = selectedAssets.map((a) => {
        const parts: string[] = [a.tag_name];
        if (a.ai_description) parts.push(a.ai_description);
        if (a.outfit_description) parts.push(`wearing: ${a.outfit_description}`);
        if (a.space_description) parts.push(a.space_description);
        return parts.filter(Boolean).join(" - ");
      });
      p += `\nReference: ${descs.join("; ")}`;
    }
    if (selectedScenes.length > 0) {
      p += `\nMatch visual style and composition of referenced scenes.`;
    }
    return p + "\n\nSafe for all audiences. No violence, weapons, or real celebrities.";
  };

  /* ━━━━━ 커스텀 이미지 → base64 업로드 후 URL 반환 ━━━━━ */
  const uploadCustomRefsAndGetUrls = async (): Promise<string[]> => {
    const urls: string[] = [];
    for (const item of customRefImages) {
      const ext = item.file.name.split(".").pop() ?? "jpg";
      const path = `${scene.project_id}/temp-ref-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("contis").upload(path, item.file, { upsert: true });
      if (!error) {
        const url = supabase.storage.from("contis").getPublicUrl(path).data.publicUrl;
        urls.push(url);
      }
    }
    return urls;
  };

  /* ━━━━━ 인페인팅 실행 (NB2 우선 · GPT edits 폴백) ━━━━━ */
  const handleInpaint = async () => {
    if (!inpaintPrompt.trim() || !scene.conti_image_url) return;
    setIsGenerating(true);
    try {
      const maskBase64 = extractMaskBase64();

      const imgRes = await fetch(scene.conti_image_url);
      const imgBlob = await imgRes.blob();
      const imageBase64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.readAsDataURL(imgBlob);
      });

      // 선택된 레퍼런스 URL 수집
      const assetRefUrls = selectedAssets.filter((a) => a.photo_url).map((a) => a.photo_url as string);
      const sceneRefUrls = selectedScenes.map((s) => s.conti_image_url);
      const customRefUrls = await uploadCustomRefsAndGetUrls();
      const userRefUrls = [...assetRefUrls, ...sceneRefUrls, ...customRefUrls];

      // NB2 용 마스크 오버레이 업로드 (브러시 영역이 있을 때만)
      const maskOverlayUrl = await uploadMaskOverlayAndGetUrl();

      // NB2 레퍼런스 구성: [마스크 오버레이, ...사용자 레퍼런스] — sourceImageUrl 은 서버가 맨 앞에 자동 추가
      // 총 4장(source + overlay + refs 2) 이하로 제한
      const nbReferenceImageUrls = maskOverlayUrl
        ? [maskOverlayUrl, ...userRefUrls].slice(0, 3)
        : userRefUrls.slice(0, 3);

      const userPrompt = buildEnrichedPrompt();
      const maskPrefix = maskOverlayUrl
        ? `You are editing a scene image. The SECOND reference image is identical to the first but with the region to edit highlighted in bright magenta (#FF00FF). EDIT ONLY pixels within that magenta-marked region. Every pixel outside the magenta region MUST remain pixel-identical to the first reference image — do not re-render, do not alter lighting or color or composition of unmasked areas. Do not draw the magenta color itself into the output; replace the magenta area with the requested content, blended naturally.\n\nEdit request:\n`
        : "";
      const finalPrompt = maskPrefix + userPrompt;

      const { data, error } = await supabase.functions.invoke("openai-image", {
        body: {
          mode: "inpaint",
          // NB2 경로 활성화
          useNanoBanana: true,
          sourceImageUrl: scene.conti_image_url,
          referenceImageUrls: nbReferenceImageUrls,
          // GPT edits 폴백용 필드 유지 — NB2 실패 시 서버가 이 값으로 재시도
          imageBase64,
          maskBase64,
          prompt: finalPrompt,
          projectId: scene.project_id,
          sceneNumber: scene.scene_number,
          imageSize: IMAGE_SIZE_MAP[videoFormat],
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error?.message ?? data.error?.type ?? "Inpainting failed");

      const publicUrl = data.publicUrl;
      if (!publicUrl) throw new Error("No image URL returned");

      await supabase.from("scenes").update({ conti_image_url: publicUrl }).eq("id", scene.id);
      onSave(publicUrl);
      onClose();
      toast({ title: "Inpainting complete ✨" });
    } catch (e: any) {
      toast({ title: "Inpainting failed", description: e.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  /* ━━━━━ 태그된 에셋 (씬에 태깅된 것 우선) ━━━━━ */
  const taggedNames = new Set(scene.tagged_assets.map((t) => (t.startsWith("@") ? t.slice(1) : t)));
  const taggedAssets = projectAssets.filter((a) => {
    const n = a.tag_name.startsWith("@") ? a.tag_name.slice(1) : a.tag_name;
    return taggedNames.has(n);
  });
  const otherAssets = projectAssets.filter((a) => {
    const n = a.tag_name.startsWith("@") ? a.tag_name.slice(1) : a.tag_name;
    return !taggedNames.has(n);
  });

  const totalSelected = selectedAssets.length + selectedScenes.length + customRefImages.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.88)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[920px] rounded border border-border bg-card flex flex-col"
        style={{ maxHeight: "94vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <span className="text-[15px] font-semibold text-foreground">Inpainting</span>
            <span className="text-[12px] text-muted-foreground ml-2">Brush over the area you want to modify</span>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer text-lg"
          >
            ✕
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex flex-1 overflow-hidden">
          {/* ── Left: Canvas ── */}
          <div className="flex-1 flex flex-col p-4 overflow-hidden">
            {/* 브러시 컨트롤 */}
            <div className="flex items-center gap-3 mb-3 shrink-0">
              <span className="text-[12px] text-muted-foreground whitespace-nowrap">Brush Size</span>
              <input
                type="range"
                min={5}
                max={80}
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                className="flex-1"
              />
              <span className="text-[12px] text-muted-foreground w-6 text-right">{brushSize}</span>
              <button
                onClick={handleReset}
                className="text-[11px] text-muted-foreground px-2.5 py-1 border border-border rounded-md bg-transparent cursor-pointer hover:text-foreground whitespace-nowrap"
              >
                Reset
              </button>
            </div>

            {/* 캔버스 영역 */}
            <div className="relative rounded-lg overflow-hidden border border-border bg-background flex items-center justify-center flex-1 min-h-0">
              {!imageLoaded && !imageError && (
                <div className="text-muted-foreground text-sm p-10">Loading image...</div>
              )}
              {imageError && <div className="text-destructive text-sm p-10">Failed to load image</div>}
              <canvas
                ref={imageCanvasRef}
                className="max-w-full max-h-full object-contain"
                style={{ display: imageLoaded ? "block" : "none" }}
              />
              <canvas
                ref={maskCanvasRef}
                className="absolute top-0 left-0 w-full h-full"
                style={{ cursor: "crosshair", display: imageLoaded ? "block" : "none" }}
                onMouseDown={handleMouseDown}
                onMouseUp={() => setIsDrawing(false)}
                onMouseLeave={() => setIsDrawing(false)}
                onMouseMove={handleMouseMove}
                onTouchStart={() => setIsDrawing(true)}
                onTouchEnd={() => setIsDrawing(false)}
                onTouchMove={handleTouch}
              />
            </div>

            {/* 범례 */}
            <div className="flex items-center gap-1.5 mt-2 shrink-0">
              <div className="w-3 h-3 rounded-full" style={{ background: "rgba(249,66,58,0.55)" }} />
              <span className="text-[11px] text-muted-foreground">Painted area = region to modify</span>
            </div>
          </div>

          {/* ── Right: 레퍼런스 패널 ── */}
          <div className="w-[220px] shrink-0 border-l border-border flex flex-col overflow-hidden">
            <div className="px-3 py-2.5 border-b border-border shrink-0">
              <span className="text-[12px] font-semibold text-foreground">Reference Images</span>
              {totalSelected > 0 && (
                <span
                  className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white"
                  style={{ background: KR }}
                >
                  {totalSelected}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {/* ── 섹션 1: 에셋 ── */}
              <div>
                <button
                  onClick={() => setAssetOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-semibold text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer"
                  style={{ borderBottom: "0.5px solid hsl(var(--border))" }}
                >
                  <span>Asset Reference</span>
                  {assetOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                {assetOpen && (
                  <div className="p-2 space-y-1">
                    {projectAssets.length === 0 && (
                      <p className="text-[11px] text-muted-foreground/50 px-1 py-1">No assets registered</p>
                    )}
                    {/* 태그된 에셋 먼저 */}
                    {taggedAssets.length > 0 && (
                      <>
                        <p className="text-[10px] text-muted-foreground/60 px-1 pb-0.5">Tagged in this scene</p>
                        {taggedAssets.map((asset) => {
                          const name = asset.tag_name.startsWith("@") ? asset.tag_name.slice(1) : asset.tag_name;
                          const isSel = selectedAssets.some((a) => a.tag_name === asset.tag_name);
                          const cfg = ACFG[asset.asset_type] || ACFG.character;
                          return (
                            <button
                              key={asset.tag_name}
                              onClick={() => toggleAsset(asset)}
                              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-all"
                              style={{
                                background: isSel ? cfg.bg : "transparent",
                                border: `1px solid ${isSel ? cfg.bd : "transparent"}`,
                              }}
                            >
                              {asset.photo_url ? (
                                <img src={asset.photo_url} className="w-7 h-7 rounded-full object-cover shrink-0" />
                              ) : (
                                <div
                                  className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold"
                                  style={{ background: cfg.bg, color: cfg.color }}
                                >
                                  {name.slice(0, 1)}
                                </div>
                              )}
                              <div className="min-w-0">
                                <div
                                  className="text-[11px] font-semibold truncate"
                                  style={{ color: isSel ? cfg.color : "hsl(var(--foreground))" }}
                                >
                                  {name}
                                </div>
                                <div className="text-[10px] text-muted-foreground">{TYPE_LABEL[asset.asset_type]}</div>
                              </div>
                            </button>
                          );
                        })}
                      </>
                    )}
                    {/* 나머지 에셋 */}
                    {otherAssets.length > 0 && (
                      <>
                        {taggedAssets.length > 0 && <div className="h-px bg-border/40 my-1" />}
                        {otherAssets.map((asset) => {
                          const name = asset.tag_name.startsWith("@") ? asset.tag_name.slice(1) : asset.tag_name;
                          const isSel = selectedAssets.some((a) => a.tag_name === asset.tag_name);
                          const cfg = ACFG[asset.asset_type] || ACFG.character;
                          return (
                            <button
                              key={asset.tag_name}
                              onClick={() => toggleAsset(asset)}
                              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-all"
                              style={{
                                background: isSel ? cfg.bg : "transparent",
                                border: `1px solid ${isSel ? cfg.bd : "transparent"}`,
                              }}
                            >
                              {asset.photo_url ? (
                                <img src={asset.photo_url} className="w-7 h-7 rounded-full object-cover shrink-0" />
                              ) : (
                                <div
                                  className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold"
                                  style={{ background: cfg.bg, color: cfg.color }}
                                >
                                  {name.slice(0, 1)}
                                </div>
                              )}
                              <div className="min-w-0">
                                <div
                                  className="text-[11px] font-semibold truncate"
                                  style={{ color: isSel ? cfg.color : "hsl(var(--foreground))" }}
                                >
                                  {name}
                                </div>
                                <div className="text-[10px] text-muted-foreground">{TYPE_LABEL[asset.asset_type]}</div>
                              </div>
                            </button>
                          );
                        })}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* ── 섹션 2: 다른 씬 ── */}
              <div>
                <button
                  onClick={() => setSceneOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-semibold text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer"
                  style={{
                    borderBottom: "0.5px solid hsl(var(--border))",
                    borderTop: "0.5px solid hsl(var(--border))",
                  }}
                >
                  <span>Scene Reference</span>
                  {sceneOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                {sceneOpen && (
                  <div className="p-2">
                    {otherScenes.length === 0 && (
                      <p className="text-[11px] text-muted-foreground/50 px-1 py-1">No other scene contis</p>
                    )}
                    <div className="grid grid-cols-2 gap-1.5">
                      {otherScenes.map((s) => {
                        const isSel = selectedScenes.some((x) => x.id === s.id);
                        return (
                          <button
                            key={s.id}
                            onClick={() => toggleScene(s)}
                            className="relative rounded-lg overflow-hidden border-2 transition-all aspect-video"
                            style={{ borderColor: isSel ? KR : "hsl(var(--border))" }}
                          >
                            <img src={s.conti_image_url} className="w-full h-full object-cover" />
                            <div
                              className="absolute top-0.5 left-0.5 text-[9px] font-bold px-1 py-0.5 rounded text-white"
                              style={{ background: "rgba(0,0,0,0.6)" }}
                            >
                              S{s.scene_number}
                            </div>
                            {isSel && (
                              <div
                                className="absolute inset-0 flex items-center justify-center"
                                style={{ background: "rgba(249,66,58,0.18)" }}
                              >
                                <div
                                  className="w-4 h-4 rounded-full flex items-center justify-center"
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
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* ── 섹션 3: 직접 업로드 ── */}
              <div>
                <div
                  className="px-3 py-2 text-[11px] font-semibold text-muted-foreground"
                  style={{ borderTop: "0.5px solid hsl(var(--border))" }}
                >
                   Custom Upload
                </div>
                <div className="px-2 pb-3">
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
                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed text-[11px] text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors bg-transparent cursor-pointer"
                      style={{ borderColor: "hsl(var(--border))" }}
                    >
                      <Upload className="w-3 h-3" />
                      Add Image ({customRefImages.length}/3)
                    </button>
                  )}
                  {customRefImages.length > 0 && (
                    <div className="grid grid-cols-3 gap-1 mt-1.5">
                      {customRefImages.map((img, i) => (
                        <div
                          key={i}
                          className="relative group aspect-square rounded overflow-hidden border border-border"
                        >
                          <img src={img.preview} className="w-full h-full object-cover" />
                          <button
                            onClick={() => removeCustomRef(i)}
                            className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ background: KR }}
                          >
                            <X className="w-2.5 h-2.5 text-white" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer: 프롬프트 + 버튼 ── */}
        <div className="px-5 py-4 border-t border-border shrink-0 space-y-3">
          <div>
            <label className="text-[12px] text-muted-foreground block mb-1.5">How should the painted area be modified?</label>
            <input
              type="text"
              value={inpaintPrompt}
              onChange={(e) => setInpaintPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleInpaint();
              }}
              placeholder="Describe the edit you want to make"
              className="w-full px-3.5 py-2.5 bg-background border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-1"
              style={{ "--tw-ring-color": KR } as any}
            />
          </div>
          {totalSelected > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedAssets.map((a) => {
                const n = a.tag_name.startsWith("@") ? a.tag_name.slice(1) : a.tag_name;
                const cfg = ACFG[a.asset_type] || ACFG.character;
                return (
                  <span
                    key={a.tag_name}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: cfg.bg, color: cfg.color, border: `0.5px solid ${cfg.bd}` }}
                  >
                    {n}
                    <button
                      onClick={() => toggleAsset(a)}
                      className="bg-transparent border-none cursor-pointer p-0"
                      style={{ color: cfg.color }}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                );
              })}
              {selectedScenes.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(249,66,58,0.10)", color: KR, border: "0.5px solid rgba(249,66,58,0.25)" }}
                >
                  S{s.scene_number}
                  <button
                    onClick={() => toggleScene(s)}
                    className="bg-transparent border-none cursor-pointer p-0"
                    style={{ color: KR }}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
              {customRefImages.map((_, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{
                    background: "rgba(99,102,241,0.10)",
                    color: "#6366f1",
                    border: "0.5px solid rgba(99,102,241,0.25)",
                  }}
                >
                  Upload {i + 1}
                  <button
                    onClick={() => removeCustomRef(i)}
                    className="bg-transparent border-none cursor-pointer p-0"
                    style={{ color: "#6366f1" }}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-5 py-2 rounded-lg border border-border bg-transparent text-muted-foreground cursor-pointer hover:text-foreground text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleInpaint}
              disabled={!inpaintPrompt.trim() || isGenerating || !imageLoaded}
              className="px-5 py-2 rounded-lg border-none text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold"
              style={{ background: isGenerating ? "rgba(249,66,58,0.6)" : KR }}
            >
              {isGenerating ? "Generating..." : "Apply Inpaint"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
