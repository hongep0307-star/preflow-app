import React, { useEffect, useState, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  generateMoodImages,
  MOOD_IMAGE_MODEL_DEFAULT,
  MOOD_MODEL_USES_ASSET_REFS,
  type MoodImageModel,
} from "@/lib/moodIdeation";
import { supabase } from "@/lib/supabase";
import { Trash2, Loader2, X, Check, ExternalLink, Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  KR,
  KR_BG,
  KR_BORDER,
  KR_BORDER2,
  FORMAT_DEFAULT_COLS,
  _moodGeneratingByProject,
  getMoodGen,
  setMoodGen,
  patchMoodGen,
  toMoodImages,
  genMoodId,
  type Asset,
  type Scene,
  type Analysis,
  type MoodImage,
  type MoodGenState,
} from "./agentTypes";

/* ━━━━━ Mood generation result persistence ━━━━━
 * AgentTab(부모) 이 언마운트된 상태에서 generation 이 끝날 수 있으므로
 * React state 를 거치지 않고 DB 에 직접 저장하는 경로가 필요하다.
 * 모듈 store 의 arrivedUrls + skeletonIds 를 기준으로
 * 현재 DB 의 mood_image_urls 와 머지해 persist 한다.
 */
async function persistMoodGenResultToDB(projectId: string, gen: MoodGenState | undefined | null) {
  if (!gen || gen.skeletonIds.length === 0) return;
  try {
    const { data: brief } = await supabase
      .from("briefs")
      .select("id,mood_image_urls")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (!brief) return;
    const skelIdSet = new Set(gen.skeletonIds);
    const dbImages = toMoodImages(((brief as any).mood_image_urls as (string | MoodImage)[]) ?? []);
    const dbWithoutSkel = dbImages.filter((img) => !skelIdSet.has(img.id));
    const arrivedImages: MoodImage[] = gen.skeletonIds
      .map((id, i) => ({
        id,
        url: gen.arrivedUrls[i] ?? null,
        liked: false,
        sceneRef: null,
        comment: "",
        createdAt: new Date().toISOString(),
      }))
      .filter((img) => img.url !== null) as MoodImage[];
    const merged = [...arrivedImages, ...dbWithoutSkel];
    await supabase
      .from("briefs")
      .update({ mood_image_urls: merged } as any)
      .eq("id", (brief as any).id);
  } catch (e) {
    console.error("[MoodGen] persistMoodGenResultToDB failed:", e);
  }
}

/* ━━━━━ MoodCard ━━━━━ */
const MoodCard = ({
  img,
  selected,
  hasSelection,
  skelIdx,
  totalSkel,
  videoFormat,
  onToggleSelect,
  onToggleLike,
  onDelete,
  onSendToChat,
  onLightbox,
  onAttach,
}: {
  img: MoodImage;
  selected: boolean;
  hasSelection: boolean;
  skelIdx?: number;
  totalSkel?: number;
  videoFormat?: string;
  onToggleSelect: () => void;
  onToggleLike: () => void;
  onDelete: () => void;
  onSendToChat: () => void;
  onLightbox: () => void;
  onAttach: (e: React.MouseEvent) => void;
}) => {
  const [hovered, setHovered] = useState(false);
  const showOverlay = hovered || selected;

  // ── url === null : 스켈레톤을 MoodCard 안에서 직접 렌더링
  // 이렇게 하면 key={img.id}인 같은 컴포넌트가 유지되면서
  // props(url)만 null→string으로 바뀌므로 React가 DOM을 교체하지 않음
  if (img.url === null) {
    const aspect = videoFormat === "horizontal" ? "16/9" : videoFormat === "square" ? "1/1" : "9/16";
    return (
      <div
        style={{
          aspectRatio: aspect,
          background: "hsl(var(--muted))",
          position: "relative",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 0,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(90deg, transparent 0%, rgba(249,66,58,0.06) 50%, transparent 100%)",
            animation: `shimmerSweep 2s ease-in-out ${(skelIdx ?? 0) * 0.15}s infinite`,
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, zIndex: 1 }}>
          <Loader2
            className="animate-spin"
            style={{ width: 14, height: 14, color: "hsl(var(--muted-foreground))", opacity: 0.6 }}
          />
          {totalSkel !== undefined && skelIdx !== undefined && (
            <span style={{ fontSize: 9, fontWeight: 500, color: "hsl(var(--muted-foreground))", opacity: 0.5 }}>
              {skelIdx + 1}/{totalSkel}
            </span>
          )}
        </div>
      </div>
    );
  }

  // ── url 있음 : 실제 이미지 + 오버레이
  // wrapper에 aspectRatio를 걸어서 이미지 로드 전에도 높이 유지
  // img를 position: absolute로 배치해서 레이아웃이 절대 무너지지 않음
  const imgAspect = videoFormat === "horizontal" ? "16/9" : videoFormat === "square" ? "1/1" : "9/16";
  return (
    <div
      draggable={!!img.url}
      onDragStart={(e) => {
        if (!img.url) return;
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData(
          "application/x-mood-image",
          JSON.stringify({ moodImageId: img.id, url: img.url }),
        );
        e.dataTransfer.setData("text/plain", img.url);
      }}
      style={{
        position: "relative",
        borderRadius: 0,
        overflow: "hidden",
        cursor: "pointer",
        aspectRatio: imgAspect,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => {
        e.stopPropagation();
        if (hasSelection) {
          onToggleSelect();
          return;
        }
        onLightbox();
      }}
    >
      <img
        src={img.url}
        alt="mood"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
          opacity: 0,
          transition: "opacity 0.45s ease",
        }}
        loading="lazy"
        onLoad={(e) => {
          (e.currentTarget as HTMLImageElement).style.opacity = "1";
        }} decoding="async" />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: showOverlay ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0)",
          transition: "background 0.12s",
          pointerEvents: "none",
        }}
      />
      {showOverlay && (
        <div
          style={{ position: "absolute", top: 7, left: 7 }}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
        >
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 0,
              cursor: "pointer",
              border: selected ? "none" : "1.5px solid rgba(255,255,255,0.75)",
              background: selected ? KR : "rgba(0,0,0,0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.1s",
            }}
          >
            {selected && (
              <svg
                width={12}
                height={12}
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
        </div>
      )}
      {(showOverlay || img.liked) && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleLike();
          }}
          style={{
            position: "absolute",
            top: 7,
            right: 7,
            width: 31,
            height: 31,
            borderRadius: 0,
            background: img.liked ? KR : "rgba(0,0,0,0.45)",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.1s",
          }}
        >
          <svg
            width={13}
            height={13}
            viewBox="0 0 24 24"
            fill={img.liked ? "#fff" : "none"}
            stroke={img.liked ? "#fff" : "rgba(255,255,255,0.85)"}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
          </svg>
        </button>
      )}
      {showOverlay && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAttach(e);
            }}
            title={img.sceneRef != null ? `Linked to S${img.sceneRef}` : "Attach to scene"}
            style={{
              position: "absolute",
              bottom: 7,
              left: 7,
              width: 29,
              height: 29,
              borderRadius: 0,
              background: img.sceneRef != null ? KR : "rgba(0,0,0,0.5)",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width={12}
              height={12}
              viewBox="0 0 24 24"
              fill="none"
              stroke="rgba(255,255,255,0.9)"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
            {img.sceneRef != null && (
              <span
                style={{
                  position: "absolute",
                  top: -4,
                  right: -4,
                  fontSize: 8,
                  fontWeight: 700,
                  padding: "1px 3px",
                  borderRadius: 0,
                  background: "#fff",
                  color: KR,
                  lineHeight: 1,
                }}
              >
                S{img.sceneRef}
              </span>
            )}
          </button>
          <div style={{ position: "absolute", bottom: 7, right: 7, display: "flex", gap: 4 }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSendToChat();
              }}
              style={{
                width: 29,
                height: 29,
                borderRadius: 0,
                background: "rgba(0,0,0,0.45)",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              title="채팅에 보내기"
            >
              <ExternalLink style={{ width: 12, height: 12, color: "rgba(255,255,255,.85)" }} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              style={{
                width: 29,
                height: 29,
                borderRadius: 0,
                background: "rgba(180,0,0,0.55)",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              title="Delete image"
            >
              <Trash2 style={{ width: 12, height: 12, color: "rgba(255,255,255,.9)" }} />
            </button>
          </div>
        </>
      )}
      {!showOverlay && img.sceneRef !== null && (
        <div style={{ position: "absolute", bottom: 6, left: 6 }}>
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: 0,
              background: KR,
              color: "#fff",
            }}
          >
            S{img.sceneRef}
          </span>
        </div>
      )}
    </div>
  );
};

/* ━━━━━ MoodIdeationPanel ━━━━━ */
export const MoodIdeationPanel = ({
  projectId,
  briefAnalysis,
  scenes,
  assets,
  videoFormat,
  moodImages,
  setMoodImages,
  saveMoodImagesToDB,
  onSendToChat,
  onAttachToScene,
  onDetachFromScene,
  onDeleteMoodImages,
}: {
  projectId: string;
  briefAnalysis: Analysis | null;
  scenes: Scene[];
  assets: Asset[];
  videoFormat: string;
  moodImages: MoodImage[];
  setMoodImages: React.Dispatch<React.SetStateAction<MoodImage[]>>;
  saveMoodImagesToDB: (images: MoodImage[]) => Promise<void>;
  onSendToChat: (url: string) => void;
  onAttachToScene: (imageUrl: string, sceneId: string, moodImageId: string, sceneNumber: number) => Promise<void>;
  onDetachFromScene: (moodImageId: string, sceneNumber: number) => Promise<void>;
  onDeleteMoodImages: (ids: string[]) => Promise<void>;
}) => {
  useEffect(() => {
    const id = "mood-shimmer-style";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `@keyframes shimmerSweep {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(200%); }
    }
    @keyframes moodFadeIn {
      0% { opacity: 0; transform: scale(0.9); }
      100% { opacity: 1; transform: scale(1); }
    }`;
    document.head.appendChild(style);
    return () => {
      document.getElementById(id)?.remove();
    };
  }, []);
  const { toast } = useToast();
  const existingGen = getMoodGen(projectId);
  const [isGenerating, setIsGenerating] = useState(!!existingGen?.promise);
  const [showLikedOnly, setShowLikedOnly] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [targetSceneNum, setTargetSceneNum] = useState<number | null>(null);
  const [ctxOpen, setCtxOpen] = useState(false);
  const ctxRef = useRef<HTMLDivElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [attachMenu, setAttachMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ ids: string[]; connectedScenes: number[] } | null>(null);
  const [generateCount, setGenerateCount] = useState(3);
  const defaultCols = FORMAT_DEFAULT_COLS[videoFormat] ?? 3;
  // 탭 이동/언마운트 후 복귀 시에도 마지막 설정값이 유지되도록 프로젝트별 localStorage 에 저장.
  const thumbColsKey = `ff_mood_thumb_cols_${projectId}`;
  const [thumbCols, setThumbColsState] = useState<number>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(thumbColsKey) : null;
      const parsed = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 12) return parsed;
    } catch {}
    return defaultCols;
  });
  const setThumbCols = useCallback(
    (val: number) => {
      setThumbColsState(val);
      try {
        window.localStorage.setItem(thumbColsKey, String(val));
      } catch {}
    },
    [thumbColsKey],
  );
  // Mood 이미지 생성 모델. 빠른 텍스트-only GPT 1.5 가 기본값.
  // 사용자의 마지막 선택은 프로젝트 단위로 localStorage 에 저장되어
  // 탭 이동/재진입/새로고침 후에도 유지된다.
  const moodModelKey = `ff_mood_model_${projectId}`;
  const [moodModel, setMoodModelState] = useState<MoodImageModel>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(moodModelKey) : null;
      if (raw === "gpt-image-1.5" || raw === "gpt-image-2" || raw === "nano-banana-2") {
        return raw;
      }
      // 과거 "creative" / "asset" 문자열을 신규 모델명으로 마이그레이트.
      if (raw === "asset") return "nano-banana-2";
      if (raw === "creative") return "gpt-image-1.5";
    } catch {}
    return MOOD_IMAGE_MODEL_DEFAULT;
  });
  const setMoodModel = useCallback(
    (val: MoodImageModel) => {
      setMoodModelState(val);
      try {
        window.localStorage.setItem(moodModelKey, val);
      } catch {}
    },
    [moodModelKey],
  );
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  const MOOD_MODEL_LABELS: Record<MoodImageModel, string> = {
    "gpt-image-1.5": "GPT Image 1.5",
    "gpt-image-2": "GPT Image 2",
    "nano-banana-2": "Nano Banana 2",
  };
  const MOOD_MODEL_DESCRIPTIONS: Record<MoodImageModel, string> = {
    "gpt-image-1.5": "Fastest · Text-based (asset appearance not reflected)",
    "gpt-image-2": "Vision · Reflects asset images · Slow",
    "nano-banana-2": "Reflects asset images · Vertex",
  };
  const genMoodId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  useEffect(() => {
    if (!ctxOpen) return;
    const fn = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [ctxOpen]);
  useEffect(() => {
    if (!modelMenuOpen) return;
    const fn = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) setModelMenuOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [modelMenuOpen]);
  useEffect(() => {
    if (!attachMenu) return;
    const fn = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) setAttachMenu(null);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [attachMenu]);

  useEffect(() => {
    const gen = getMoodGen(projectId);
    if (gen?.promise) {
      setIsGenerating(true);
      gen.promise.then(() => {
        setIsGenerating(false);
      });
    }
  }, [projectId]);

  const contextLabel = (() => {
    if (targetSceneNum !== null) {
      const s = scenes.find((sc) => sc.scene_number === targetSceneNum);
      return `S${String(targetSceneNum).padStart(2, "0")}${s?.title ? ` · ${s.title}` : ""}`;
    }
    return scenes.length > 0 ? `All scenes (${scenes.length})` : "Brief-based";
  })();

  const handleGenerate = async () => {
    setIsGenerating(true);

    // Insert skeleton placeholders (url: null) at the front.
    // skeletonIds 와 arrivedUrls 를 모듈 store(_moodGeneratingByProject) 에도 보관해서
    // 탭 이동으로 AgentTab 이 언마운트→리마운트 되어도 스켈레톤이 살아있도록 한다.
    const skeletonIds = Array.from({ length: generateCount }, () => genMoodId());
    const skeletons: MoodImage[] = skeletonIds.map((id) => ({
      id,
      url: null,
      liked: false,
      sceneRef: null,
      comment: "",
      createdAt: new Date().toISOString(),
    }));
    setMoodImages((prev) => [...skeletons, ...prev]);

    // 모듈 store 등록 (promise 는 아래에서 채움)
    setMoodGen(projectId, {
      count: generateCount,
      skeletonIds,
      arrivedUrls: [],
      promise: null,
    });

    const genPromise = (async () => {
      try {
        const targetScenes = targetSceneNum !== null ? scenes.filter((s) => s.scene_number === targetSceneNum) : scenes;
        await generateMoodImages(
          {
            projectId,
            briefAnalysis,
            scenes: targetScenes.map((s) => ({
              scene_number: s.scene_number,
              title: s.title,
              description: s.description,
              camera_angle: s.camera_angle,
              location: s.location,
              mood: s.mood,
              tagged_assets: s.tagged_assets,
            })),
            assets: assets.map((a) => ({
              tag_name: a.tag_name,
              photo_url: a.photo_url,
              ai_description: a.ai_description,
              asset_type: a.asset_type,
              role_description: a.role_description,
              outfit_description: a.outfit_description,
              space_description: a.space_description,
            })),
            videoFormat,
            count: generateCount,
            targetSceneNumber: targetSceneNum,
            model: moodModel,
          },
          (batchUrls) => {
            // 모듈 store 의 arrivedUrls 갱신 + listener 통지.
            // AgentTab 의 mood gen 구독 effect(subscribeMoodGen) 가 이 patch 를 받아
            // skeletonIds + arrivedUrls 를 기준으로 moodImages 를 일관되게 재구성한다.
            //
            // NOTE: 로컬에서 setMoodImages 로 null 을 url 로 바꾸는 추가 작업은
            //       일부러 하지 않는다. 구독자와 로컬 setter 가 동시에 업데이트하면
            //       batch 2+ 시점에 "첫 번째 null 슬롯"을 서로 다르게 해석해서
            //       같은 URL 이 두 슬롯에 중복 기록되는 버그가 있었음.
            const cur = getMoodGen(projectId);
            if (cur) {
              patchMoodGen(projectId, { arrivedUrls: [...cur.arrivedUrls, ...batchUrls] });
            }
          },
        );
        toast({ title: `${generateCount} mood images generated` });
      } catch (err: any) {
        toast({ title: "Mood generation failed", description: err.message, variant: "destructive" });
      } finally {
        // ─── 언마운트-세이프 완료 처리 ───
        // 탭 전환으로 AgentTab 이 unmount 된 상태에서도 DB 에 반드시 저장되어야 하므로,
        // setMoodImages (React state) 가 아닌 모듈 store + supabase 를 직접 사용한다.
        // 1) 모듈 store 의 arrivedUrls 기준으로 DB persist
        const finalGen = getMoodGen(projectId);
        await persistMoodGenResultToDB(projectId, finalGen);
        // 2) mount 된 경우에만 로컬 state 정리 (null placeholder 제거).
        //    unmount 상태면 no-op 이고, 재마운트 시 fetchBrief 가 DB 에서 새로 로드.
        setMoodImages((prev) => prev.filter((img) => img.url !== null));
        // 3) 모듈 store 정리 — 이 호출이 subscribeMoodGen listener 를 트리거하므로
        //    위 setMoodImages 뒤에서 호출해 UI 가 최종 상태로 안정화되게 한다.
        setMoodGen(projectId, null);
        setIsGenerating(false);
      }
    })();
    // promise 핸들 모듈 store 에 기록
    patchMoodGen(projectId, { promise: genPromise });
  };

  const handleToggleLike = (id: string) =>
    setMoodImages((prev) => {
      const next = prev.map((img) => (img.id === id ? { ...img, liked: !img.liked } : img));
      saveMoodImagesToDB(next);
      return next;
    });
  const requestDelete = (ids: string[]) => {
    const connectedScenes = ids
      .map((id) => moodImages.find((i) => i.id === id))
      .filter((img): img is MoodImage => !!img && img.sceneRef !== null)
      .map((img) => img.sceneRef as number);
    if (connectedScenes.length > 0) setDeleteConfirm({ ids, connectedScenes: [...new Set(connectedScenes)] });
    else onDeleteMoodImages(ids);
  };
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const clearSelection = () => setSelectedIds(new Set());
  const openAttachMenu = (e: React.MouseEvent, imgId: string) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setAttachMenu({ id: imgId, x: rect.left, y: rect.top });
  };
  const doAttach = async (imgId: string, scene: Scene) => {
    const img = moodImages.find((i) => i.id === imgId);
    if (!img || !img.url) return;
    await onAttachToScene(img.url, scene.id, imgId, scene.scene_number);
    setAttachMenu(null);
    toast({ title: `Image attached to Scene ${scene.scene_number}` });
  };
  const doDetach = async (imgId: string) => {
    const img = moodImages.find((i) => i.id === imgId);
    if (!img || img.sceneRef === null) return;
    await onDetachFromScene(imgId, img.sceneRef);
    setAttachMenu(null);
    toast({ title: `Detached from Scene ${img.sceneRef}` });
  };

  const displayImages = showLikedOnly ? moodImages.filter((img) => img.url === null || img.liked) : moodImages;
  const likedCount = moodImages.filter((img) => img.liked).length;
  const attachImg = attachMenu ? moodImages.find((i) => i.id === attachMenu.id) : null;

  const hasPhotoAssets = assets.some((a) => a.photo_url);
  const MOOD_MODEL_OPTIONS: MoodImageModel[] = ["gpt-image-1.5", "gpt-image-2", "nano-banana-2"];

  const modelSelector = (
    <div ref={modelMenuRef} style={{ position: "relative" }}>
      <button
        onClick={() => setModelMenuOpen((p) => !p)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "0 10px",
          height: 28,
          borderRadius: 0,
          fontSize: 11,
          cursor: "pointer",
          border: `0.5px solid ${modelMenuOpen ? KR : "hsl(var(--border))"}`,
          background: modelMenuOpen ? KR_BG : "hsl(var(--muted))",
          color: modelMenuOpen ? KR : "hsl(var(--muted-foreground))",
          transition: "all 0.15s",
          fontWeight: 500,
        }}
      >
        {MOOD_MODEL_LABELS[moodModel]}
        <span style={{ fontSize: 9, opacity: 0.6 }}>{modelMenuOpen ? "▴" : "▾"}</span>
      </button>
      {modelMenuOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            background: "hsl(var(--card))",
            border: "0.5px solid hsl(var(--border))",
            borderRadius: 0,
            overflow: "hidden",
            boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
            zIndex: 100,
            minWidth: 260,
          }}
        >
          {MOOD_MODEL_OPTIONS.map((m) => {
            const needsAsset = MOOD_MODEL_USES_ASSET_REFS[m];
            const disabled = needsAsset && !hasPhotoAssets;
            const active = moodModel === m;
            return (
              <button
                key={m}
                onClick={() => {
                  if (disabled) {
                    toast({
                      title: "Register assets first",
                      description: "Assets with images are required",
                      variant: "destructive",
                    });
                    return;
                  }
                  setMoodModel(m);
                  setModelMenuOpen(false);
                }}
                style={{
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  padding: "8px 12px",
                  background: "none",
                  border: "none",
                  cursor: disabled ? "not-allowed" : "pointer",
                  textAlign: "left",
                  fontFamily: "inherit",
                  opacity: disabled ? 0.4 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!disabled) (e.currentTarget as HTMLElement).style.background = "hsl(var(--muted))";
                }}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "none")}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: active ? 600 : 400,
                      color: active ? KR : "hsl(var(--foreground))",
                    }}
                  >
                    {MOOD_MODEL_LABELS[m]}
                  </span>
                  {m === MOOD_IMAGE_MODEL_DEFAULT && (
                    <span
                      style={{
                        fontSize: 9,
                        padding: "1px 5px",
                        border: "0.5px solid hsl(var(--border))",
                        color: "hsl(var(--muted-foreground))",
                        letterSpacing: 0.3,
                      }}
                    >
                      DEFAULT
                    </span>
                  )}
                  {active && (
                    <Check className="w-3 h-3 ml-auto" style={{ color: "hsl(var(--muted-foreground))" }} />
                  )}
                </div>
                <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>
                  {disabled ? "Register asset images first" : MOOD_MODEL_DESCRIPTIONS[m]}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderMasonryGrid = (images: MoodImage[]) => {
    // 스켈레톤 관련 계산은 여기서 미리
    const skelImages = images.filter((i) => i.url === null);
    const totalSkel = skelImages.length;

    return (
      <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
        {Array.from({ length: thumbCols }, (_, colIdx) => (
          <div key={colIdx} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            {images
              .filter((_, idx) => idx % thumbCols === colIdx)
              .map((img) => {
                // 스켈레톤 순번 계산 (url === null인 것들 중 몇 번째인지)
                const skelIdx = img.url === null ? skelImages.indexOf(img) : undefined;

                // ── 핵심 변경 ──
                // url === null이든 아니든 항상 MoodCard 하나만 반환
                // React가 key={img.id}인 같은 컴포넌트를 유지하므로
                // url이 null→string으로 바뀌어도 DOM 교체 없이 props만 업데이트됨
                return (
                  <MoodCard
                    key={img.id}
                    img={img}
                    selected={selectedIds.has(img.id)}
                    hasSelection={selectedIds.size > 0}
                    skelIdx={skelIdx}
                    totalSkel={totalSkel}
                    videoFormat={videoFormat}
                    onToggleSelect={() => toggleSelect(img.id)}
                    onToggleLike={() => handleToggleLike(img.id)}
                    onDelete={() => requestDelete([img.id])}
                    onSendToChat={() => onSendToChat(img.url!)}
                    onLightbox={() => setLightboxUrl(img.url!)}
                    onAttach={(e) => openAttachMenu(e, img.id)}
                  />
                );
              })}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full" onClick={() => setAttachMenu(null)}>
      <div style={{ padding: "8px 12px", borderBottom: "0.5px solid hsl(var(--border))", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap" }}>
          {/* Context selector */}
          <div ref={ctxRef} style={{ position: "relative" }}>
            <button
              onClick={() => setCtxOpen((p) => !p)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "0 10px",
                height: 28,
                borderRadius: 0,
                fontSize: 11,
                cursor: "pointer",
                border: `0.5px solid ${ctxOpen ? KR : "hsl(var(--border))"}`,
                background: ctxOpen ? KR_BG : "hsl(var(--muted))",
                color: ctxOpen ? KR : "hsl(var(--muted-foreground))",
                transition: "all 0.15s",
                fontWeight: 500,
              }}
            >
              <svg
                width={10}
                height={10}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
              {contextLabel}
              <span style={{ fontSize: 9, opacity: 0.6 }}>{ctxOpen ? "▴" : "▾"}</span>
            </button>
            {ctxOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  background: "hsl(var(--card))",
                  border: "0.5px solid hsl(var(--border))",
                  borderRadius: 0,
                  overflow: "hidden",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
                  zIndex: 100,
                  minWidth: 180,
                  whiteSpace: "nowrap" as const,
                }}
              >
                {[
                  { label: scenes.length > 0 ? "All scenes" : "Brief-based", num: null },
                  ...scenes.map((s) => ({
                    label: `S${String(s.scene_number).padStart(2, "0")}${s.title ? ` · ${s.title}` : ""}`,
                    num: s.scene_number,
                  })),
                ].map((opt) => (
                  <button
                    key={opt.num ?? "all"}
                    onClick={() => {
                      setTargetSceneNum(opt.num);
                      setCtxOpen(false);
                    }}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      padding: "7px 12px",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: "inherit",
                      fontSize: 12,
                      color: targetSceneNum === opt.num ? KR : "hsl(var(--foreground))",
                      fontWeight: targetSceneNum === opt.num ? 600 : 400,
                    }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "hsl(var(--muted))")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "none")}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: KR,
                        flexShrink: 0,
                        opacity: targetSceneNum === opt.num ? 1 : 0,
                      }}
                    />
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Count selector */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              background: "hsl(var(--muted))",
              borderRadius: 0,
              padding: "2px 6px",
            }}
          >
            <button
              onClick={() => setGenerateCount((p) => Math.max(1, p - 1))}
              style={{
                width: 20,
                height: 24,
                borderRadius: 0,
                fontSize: 13,
                fontWeight: 600,
                background: "transparent",
                color: "hsl(var(--muted-foreground))",
                border: "none",
                cursor: "pointer",
                lineHeight: 1,
              }}
            >
              −
            </button>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={generateCount}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 1 && v <= 20) setGenerateCount(v);
              }}
              style={{
                width: 28,
                height: 22,
                borderRadius: 0,
                fontSize: 11,
                fontWeight: 700,
                background: KR,
                color: "#fff",
                border: "none",
                textAlign: "center",
                fontFamily: "var(--font-mono, monospace)",
              }}
            />
            <button
              onClick={() => setGenerateCount((p) => Math.min(20, p + 1))}
              style={{
                width: 20,
                height: 24,
                borderRadius: 0,
                fontSize: 13,
                fontWeight: 600,
                background: "transparent",
                color: "hsl(var(--muted-foreground))",
                border: "none",
                cursor: "pointer",
                lineHeight: 1,
              }}
            >
              +
            </button>
          </div>
          {/* Model selector */}
          {modelSelector}
          <div style={{ width: 1, height: 14, background: "hsl(var(--border))" }} />
          {/* Saved filter */}
          <button
            onClick={() => setShowLikedOnly((p) => !p)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "0 10px",
              height: 28,
              borderRadius: 0,
              fontSize: 11,
              fontWeight: 500,
              background: showLikedOnly ? KR_BG : "transparent",
              color: showLikedOnly ? KR : "hsl(var(--muted-foreground))",
              border: `0.5px solid ${showLikedOnly ? KR_BORDER : "transparent"}`,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            <svg
              width={11}
              height={11}
              viewBox="0 0 24 24"
              fill={showLikedOnly ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
            </svg>
            {likedCount > 0 ? `Saved ${likedCount}` : "Saved"}
          </button>
          {/* Column slider + count */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>{displayImages.length} imgs</span>
            <div style={{ width: 1, height: 14, background: "hsl(var(--border))" }} />
            <svg
              width={11}
              height={11}
              viewBox="0 0 24 24"
              fill="none"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
            <input
              type="range"
              min={1}
              max={7}
              step={1}
              value={thumbCols}
              onChange={(e) => setThumbCols(Number(e.target.value))}
              style={{ width: 64, accentColor: KR, cursor: "pointer" }}
              title={`${thumbCols} col`}
            />
            <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", minWidth: 28, textAlign: "center" }}>
              {thumbCols} cols
            </span>
          </div>
          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "0 13px",
              height: 28,
              borderRadius: 0,
              fontSize: 11,
              fontWeight: 600,
              background: KR,
              color: "#fff",
              border: "none",
              cursor: isGenerating ? "not-allowed" : "pointer",
              opacity: isGenerating ? 0.7 : 1,
              flexShrink: 0,
            }}
          >
            {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}{" "}
            Generate
          </button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            background: KR_BG,
            borderBottom: `0.5px solid ${KR_BORDER2}`,
            flexShrink: 0,
          }}
        >
          <svg
            width={13}
            height={13}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 11 12 14 22 4" />
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
          </svg>
          <span style={{ fontSize: 12, fontWeight: 500, color: KR }}>{selectedIds.size} selected</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={clearSelection}
            style={{
              padding: "4px 10px",
              borderRadius: 0,
              fontSize: 11,
              border: "0.5px solid hsl(var(--border))",
              background: "transparent",
              color: "hsl(var(--muted-foreground))",
              cursor: "pointer",
            }}
          >
            Deselect
          </button>
          <button
            onClick={() => requestDelete(Array.from(selectedIds))}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 10px",
              borderRadius: 0,
              fontSize: 11,
              fontWeight: 500,
              background: "#dc2626",
              color: "#fff",
              border: "none",
              cursor: "pointer",
            }}
          >
            Delete
          </button>
          {moodImages.length > 0 && (
            <button
              onClick={() => requestDelete(moodImages.map((i) => i.id))}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 10px",
                borderRadius: 0,
                fontSize: 11,
                fontWeight: 500,
                background: "transparent",
                color: "#fff",
                border: "0.5px solid #dc2626",
                cursor: "pointer",
              }}
            >
              Delete All
            </button>
          )}
        </div>
      )}

      {/* pb-24: 마지막 행 카드의 호버 오버레이(bottom: 7px 위치한 attach/send/delete 버튼들)가
          뷰포트 하단(스크롤바·윈도우 태스크바 등)에 가려지지 않도록 충분한 하단 여백을 둔다. */}
      <div className="flex-1 overflow-y-auto p-3 pb-24" onClick={() => setAttachMenu(null)}>
        {displayImages.length === 0 && !isGenerating ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[200px]">
            <p className="text-sm text-muted-foreground">{showLikedOnly ? "No saved images" : "No mood images yet"}</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {showLikedOnly ? "Save images with the ♥ button" : "Select a scene above and generate mood images"}
            </p>
          </div>
        ) : (
          renderMasonryGrid(displayImages)
        )}
      </div>

      {attachMenu && attachImg && (
        <div
          ref={attachMenuRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            left: attachMenu.x,
            top: attachMenu.y - 4,
            transform: "translateY(-100%)",
            background: "#141414",
            border: "0.5px solid hsl(var(--border))",
            borderRadius: 0,
            overflow: "hidden",
            boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
            zIndex: 9999,
            minWidth: 150,
          }}
        >
          <div
            style={{
              padding: "5px 10px 4px",
              fontSize: 10,
              color: "hsl(var(--muted-foreground))",
              borderBottom: "0.5px solid hsl(var(--border))",
            }}
          >
            Attach to scene
          </div>
          {attachImg.sceneRef !== null && (
            <>
              <button
                onClick={() => doDetach(attachMenu.id)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "inherit",
                  fontSize: 11,
                  color: "#dc2626",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(220,38,38,0.12)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "none")}
              >
                <X style={{ width: 11, height: 11 }} />
                Detach S{attachImg.sceneRef}
              </button>
              <div style={{ height: 1, background: "hsl(var(--border))", margin: "2px 0" }} />
            </>
          )}
          {scenes.map((s) => {
            const alreadyTaken = !!s.conti_image_url && s.conti_image_url !== attachImg.url;
            const isCurrentlyAttached = attachImg.sceneRef === s.scene_number;
            return (
              <button
                key={s.id}
                disabled={alreadyTaken}
                onClick={() => !alreadyTaken && doAttach(attachMenu.id, s)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  background: "none",
                  border: "none",
                  cursor: alreadyTaken ? "not-allowed" : "pointer",
                  textAlign: "left",
                  fontFamily: "inherit",
                  fontSize: 11,
                  color: isCurrentlyAttached ? KR : "hsl(var(--foreground))",
                  opacity: alreadyTaken ? 0.4 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!alreadyTaken) (e.currentTarget as HTMLElement).style.background = "hsl(var(--muted))";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "none";
                }}
              >
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    padding: "1px 5px",
                    borderRadius: 0,
                    background: KR,
                    color: "#fff",
                  }}
                >
                  S{s.scene_number}
                </span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.title || `Scene ${s.scene_number}`}
                </span>
                {alreadyTaken && <span style={{ fontSize: 9, color: "hsl(var(--muted-foreground))" }}>연결됨</span>}
                {isCurrentlyAttached && !alreadyTaken && (
                  <svg
                    width={10}
                    height={10}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={KR}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}

      {deleteConfirm && (
        <Dialog open onOpenChange={() => setDeleteConfirm(null)}>
          <DialogContent className="max-w-[380px] bg-card border-border">
            <DialogHeader>
              <DialogTitle>Delete image 확인</DialogTitle>
            </DialogHeader>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              선택한 이미지 중 <strong className="text-foreground">{deleteConfirm.connectedScenes.length}개</strong>가
              씬({deleteConfirm.connectedScenes.map((n) => `씬 ${n}`).join(", ")})에 연결되어 있습니다.
              <br />
              <br />
              삭제하면 씬에서도 이미지가 제거됩니다. 계속할까요?
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>
                취소
              </Button>
              <Button
                onClick={async () => {
                  await onDeleteMoodImages(deleteConfirm.ids);
                  setSelectedIds(new Set());
                  setDeleteConfirm(null);
                }}
                className="gap-1.5"
                style={{ background: "#dc2626", color: "#fff" }}
              >
                삭제
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {lightboxUrl &&
        (() => {
          const currentIdx = displayImages.findIndex((img) => img.url === lightboxUrl);
          const hasPrev = currentIdx > 0;
          const hasNext = currentIdx < displayImages.length - 1;
          const goPrev = () => {
            if (hasPrev) setLightboxUrl(displayImages[currentIdx - 1].url);
          };
          const goNext = () => {
            if (hasNext) setLightboxUrl(displayImages[currentIdx + 1].url);
          };
          return (
            <div
              className="fixed inset-0 z-[9999] flex items-center justify-center"
              style={{ background: "rgba(0,0,0,0.85)" }}
              onClick={() => setLightboxUrl(null)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setLightboxUrl(null);
                if (e.key === "ArrowLeft") goPrev();
                if (e.key === "ArrowRight") goNext();
              }}
              tabIndex={0}
              ref={(el) => el?.focus()}
            >
              <button
                onClick={() => setLightboxUrl(null)}
                className="absolute top-4 right-4"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.15)",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X className="w-5 h-5 text-white" />
              </button>
              {hasPrev && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    goPrev();
                  }}
                  className="absolute left-4 top-1/2 -translate-y-1/2"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.1)",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <ChevronLeft className="w-5 h-5 text-white" />
                </button>
              )}
              {hasNext && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    goNext();
                  }}
                  className="absolute right-4 top-1/2 -translate-y-1/2"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.1)",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <ChevronRight className="w-5 h-5 text-white" />
                </button>
              )}
              <img
                src={lightboxUrl}
                alt="mood lightbox"
                style={{ maxWidth: "85vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 0 }}
                onClick={(e) => e.stopPropagation()} loading="lazy" decoding="async" />
              {currentIdx >= 0 && (
                <span
                  className="absolute bottom-4 left-1/2 -translate-x-1/2"
                  style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: 500 }}
                >
                  {currentIdx + 1} / {displayImages.length}
                </span>
              )}
            </div>
          );
        })()}
    </div>
  );
};
