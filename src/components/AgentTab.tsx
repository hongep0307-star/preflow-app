import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import type { VideoFormat } from "@/lib/conti";
import { supabase } from "@/lib/supabase";
import { deleteStoredFileIfUnreferenced } from "@/lib/storageUtils";
import { callLLM } from "@/lib/llm";
import { getModel } from "@/lib/modelPreference";
import { getModelMeta } from "@/lib/modelCatalog";
import { getSettingsCached, ensureSettingsLoaded } from "@/lib/settingsCache";
import { pruneHistoryForBudget } from "@/lib/historyBudget";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Plus,
  Clapperboard,
  Send,
  Lightbulb,
  X,
  Check,
  ImagePlus,
  RotateCcw,
  Image,
  ImageOff,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Columns2,
  MessageSquare,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";

import {
  KR,
  KR_BG,
  KR_BORDER2,
  type Asset,
  type Scene,
  type Analysis,
  type ChatLog,
  type ChatImage,
  type MoodImage,
  type ParsedScene,
  type FocalPoint,
  type RightPanel,
  formatTime,
  fileToBase64,
  toMoodImages,
  extractScenesFromText,
  resolveAsset,
  _pendingScenesByProject,
  loadPendingFromLS,
  savePendingToLS,
  getMoodGenBatches,
  collectAllInFlightSkeletonIds,
  lookupArrivedUrlForSkeleton,
  subscribeMoodGen,
  getChatGen,
  setChatGen,
  patchChatGen,
  subscribeChatGen,
  parseMessageSegments,
  remapMessageForHistory,
  ACFG,
  ASSET_ICON,
} from "./agent/agentTypes";
import { MoodIdeationPanel } from "./agent/MoodIdeationPanel";
import AgentAbcdPanel from "./agent/AgentAbcdPanel";
import {
  SortableSceneCard,
  EditablePendingSceneCard,
  AgentInlineField,
} from "./agent/AgentSceneCards";
import { ConfirmScenesModal, SendToContiModal, LoadVersionModal } from "./agent/AgentModals";
import {
  buildAssetUsageReminder,
  buildSystemPrompt,
  buildBriefContextString,
  isBriefAnalysisMsg,
} from "./agent/prompts";
import { MessageContent } from "./agent/MessageContent";
import { AgentChatInput } from "./agent/AgentChatInput";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/lib/uiLanguage";

// ══════════════════════════════════════════════════════════
//   MAIN — AgentTab
// ══════════════════════════════════════════════════════════

interface Props {
  projectId: string;
  videoFormat?: VideoFormat;
  lang?: "ko" | "en";
  onSwitchToContiTab?: () => void;
}

const DRAFT_REPLACE_INTENT_RE =
  /(삭제|제거|빼|빼고|줄여|축소|정리|재구성|다시\s*구성|다시\s*짜|교체|새로\s*짜|최종안|최종\s*컷|remove|delete|drop|omit|reduce|shorten|rework|replace|final\s+cut|final\s+shot)/i;

const shouldReplaceDraftsFromExtraction = ({
  userText,
  assistantText,
  previous,
  extracted,
}: {
  userText: string;
  assistantText: string;
  previous: ParsedScene[];
  extracted: ParsedScene[];
}) => {
  if (previous.length === 0 || extracted.length === 0) return false;
  if (extracted.length >= previous.length && extracted.length > 1) return true;
  const hasReplaceIntent = DRAFT_REPLACE_INTENT_RE.test(`${userText}\n${assistantText}`);
  return hasReplaceIntent && extracted.length > 1;
};

const mergeOrReplaceDrafts = (previous: ParsedScene[], extracted: ParsedScene[], forceReplace = false) => {
  if (previous.length === 0 || forceReplace) return extracted;
  const updated = [...previous];
  for (const ext of extracted) {
    const idx = updated.findIndex((p) => p.scene_number === ext.scene_number);
    if (idx >= 0) updated[idx] = ext;
    else updated.push(ext);
  }
  if (extracted.length >= previous.length && extracted.length > 1) return extracted;
  return updated.sort((a, b) => a.scene_number - b.scene_number);
};

export const AgentTab = ({ projectId, videoFormat = "vertical", lang = "en", onSwitchToContiTab }: Props) => {
  const { toast } = useToast();
  const t = useT();
  const isMobile = useIsMobile();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [chatHistory, setChatHistory] = useState<ChatLog[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [chatImages, setChatImages] = useState<ChatImage[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [sessionImageMap] = useState(() => new Map<string, string[]>());
  const [moodLightboxUrl, setMoodLightboxUrl] = useState<string | null>(null);
  const [moodImages, setMoodImages] = useState<MoodImage[]>([]);

  const [cardHeights, setCardHeights] = useState<Record<string, number>>({});
  const [showImages, setShowImages] = useState(true);
  const handlePendingUpdate = useCallback((updated: ParsedScene) => {
    setPendingScenes((prev) => prev.map((p) => (p.scene_number === updated.scene_number ? updated : p)));
  }, []);

  const handleContentHeight = useCallback((id: string, h: number) => {
    setCardHeights((prev) => {
      if (prev[id] === h) return prev;
      return { ...prev, [id]: h };
    });
  }, []);
  // 삭제된 scene 의 cardHeights 엔트리가 남아 sharedHeight 를 상향 고정하는 것을 방지.
  useEffect(() => {
    setCardHeights((prev) => {
      const sceneIds = new Set(scenes.map((s) => s.id));
      let changed = false;
      const next: Record<string, number> = {};
      for (const k of Object.keys(prev)) {
        if (sceneIds.has(k)) next[k] = prev[k];
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [scenes]);

  // ─── Scene 패널 폭 관측 + 이미지 컬럼 상한 계산 ───
  // Split 뷰에서 Mood 패널을 넓혀 Scene 패널이 좁아지면, Scene 카드의
  // imgWidth(= sharedHeight × wr/hr) 가 컨테이너를 잠식하면서 회색 placeholder 만
  // 남는 피드백 루프가 발생한다. 패널 폭을 기준으로 imgWidth / sharedHeight 양쪽에
  // 상한을 걸어 피드백 루프 자체를 차단한다.
  const [scenesPanelEl, setScenesPanelEl] = useState<HTMLDivElement | null>(null);
  const [scenesPanelWidth, setScenesPanelWidth] = useState(0);
  const scenesPanelRef = useCallback((el: HTMLDivElement | null) => {
    setScenesPanelEl(el);
  }, []);
  useEffect(() => {
    if (!scenesPanelEl) return;
    setScenesPanelWidth(scenesPanelEl.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setScenesPanelWidth(e.contentRect.width);
    });
    ro.observe(scenesPanelEl);
    return () => ro.disconnect();
  }, [scenesPanelEl]);

  // 이미지 컬럼이 패널 폭에서 차지할 수 있는 최대 비율.
  // 피드백 루프를 확실히 끊으려면 0.5 미만이어야 한다.
  const IMAGE_COL_MAX_RATIO = 0.35;
  const [imgWR, imgHR] =
    videoFormat === "horizontal" ? [16, 9] : videoFormat === "square" ? [1, 1] : [9, 16];
  const maxImgWidth =
    scenesPanelWidth > 0 ? Math.max(60, Math.floor(scenesPanelWidth * IMAGE_COL_MAX_RATIO)) : 9999;
  // sharedHeight 는 naturalHeight 를 따르되, maxImgWidth 에서 역산한 상한을 넘지 않게 캡.
  const maxSharedHeightFromPanel =
    scenesPanelWidth > 0 ? Math.floor((maxImgWidth * imgHR) / imgWR) : 9999;
  const naturalSharedHeight = Math.max(160, ...Object.values(cardHeights));
  const sharedHeight = Math.max(160, Math.min(naturalSharedHeight, maxSharedHeightFromPanel));

  const minPanelWidthForImage =
    videoFormat === "horizontal" ? 520 : videoFormat === "square" ? 400 : 330;
  const panelTooNarrowForImage =
    scenesPanelWidth > 0 && scenesPanelWidth < minPanelWidthForImage;
  const effectiveShowImages = showImages && !panelTooNarrowForImage;

  const moodImagesRef = useRef<MoodImage[]>([]);
  useEffect(() => {
    moodImagesRef.current = moodImages;
  }, [moodImages]);

  // ─── In-flight mood generation 동기화 (다중 배치 대응) ───
  // 탭 이동으로 AgentTab 이 unmount → remount 된 동안 진행되던 모든 배치의
  // 스켈레톤 + 도착 URL 을 모듈 store 에서 읽어와 moodImages 에 반영한다.
  //
  // 한 프로젝트에 여러 배치가 동시에 떠 있을 수 있으므로:
  //   1) 모든 배치의 skeleton ID 합집합을 구해 placeholder 가 누락된 게 있으면 앞에 끼워넣고,
  //   2) 각 skeleton ID 의 url 을 해당 배치의 arrivedUrls 에서 룩업해 in-place 갱신한다.
  // 위치(앞쪽) 는 이미 handleGenerate 의 prepend 로 결정되므로 여기서는 재정렬하지 않는다.
  useEffect(() => {
    const sync = () => {
      const allSkelIds = collectAllInFlightSkeletonIds(projectId);
      if (allSkelIds.size === 0) return;
      setMoodImages((prev) => {
        const presentIds = new Set(prev.map((img) => img.id));
        // 1) 누락된 skeleton placeholder 를 앞에 보충 (배치 시작 직후 remount 된 경우 대비).
        const missingSkeletons: MoodImage[] = [];
        for (const id of allSkelIds) {
          if (presentIds.has(id)) continue;
          missingSkeletons.push({
            id,
            url: lookupArrivedUrlForSkeleton(projectId, id),
            liked: false,
            sceneRef: null,
            comment: "",
            createdAt: new Date().toISOString(),
          });
        }
        // 2) 기존 항목 중 skeleton 인 것은 arrivedUrl 로 in-place 갱신.
        const updated = prev.map((img) => {
          if (!allSkelIds.has(img.id)) return img;
          const arrived = lookupArrivedUrlForSkeleton(projectId, img.id);
          if (img.url === arrived) return img;
          return { ...img, url: arrived };
        });
        return missingSkeletons.length > 0 ? [...missingSkeletons, ...updated] : updated;
      });
    };
    sync();
    return subscribeMoodGen(projectId, sync);
  }, [projectId]);

  const [pendingScenes, setPendingSceneState] = useState<ParsedScene[]>(
    () => _pendingScenesByProject.get(projectId) ?? loadPendingFromLS(projectId),
  );
  const setPendingScenes = useCallback(
    (val: ParsedScene[] | ((prev: ParsedScene[]) => ParsedScene[])) => {
      setPendingSceneState((prev) => {
        const next = typeof val === "function" ? val(prev) : val;
        _pendingScenesByProject.set(projectId, next);
        savePendingToLS(projectId, next);
        return next;
      });
    },
    [projectId],
  );
  const abcdScenes = useMemo<Scene[]>(
    () => [
      ...scenes,
      ...pendingScenes.map((s) => ({
        id: `draft-${s.scene_number}`,
        project_id: projectId,
        scene_number: s.scene_number,
        title: s.title ?? null,
        description: s.description ?? null,
        camera_angle: s.camera_angle ?? null,
        location: s.location ?? null,
        mood: s.mood ?? null,
        duration_sec: typeof s.duration_sec === "number" ? s.duration_sec : null,
        tagged_assets: s.tagged_assets ?? [],
        conti_image_url: null,
        is_highlight: s.is_highlight,
        highlight_kind: s.highlight_kind,
        highlight_reason: s.highlight_reason,
      })),
    ],
    [scenes, pendingScenes, projectId],
  );

  const [briefAnalysis, setBriefAnalysis] = useState<Analysis | null>(null);
  const [briefLang, setBriefLang] = useState<"ko" | "en">(lang);
  const [isLoading, setIsLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [projectAssets, setProjectAssets] = useState<Asset[]>([]);
  const [showSendModal, setShowSendModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [replaceConfirmBuffer, setReplaceConfirmBuffer] = useState<ParsedScene[] | null>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  // 탭 이동 후 복귀 시 마지막 우측 패널 상태(scenes / mood / split) 가 유지되도록 프로젝트별 localStorage 에 기록.
  const rightPanelKey = `ff_agent_right_panel_${projectId}`;
  const splitViewKey = `ff_agent_split_view_${projectId}`;
  const [rightPanel, setRightPanelState] = useState<RightPanel>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(rightPanelKey) : null;
      if (raw === "scenes" || raw === "mood") return raw;
    } catch {}
    return "scenes";
  });
  const setRightPanel = useCallback(
    (val: RightPanel | ((prev: RightPanel) => RightPanel)) => {
      setRightPanelState((prev) => {
        const next = typeof val === "function" ? (val as (p: RightPanel) => RightPanel)(prev) : val;
        try {
          window.localStorage.setItem(rightPanelKey, next);
        } catch {}
        return next;
      });
    },
    [rightPanelKey],
  );
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [splitView, setSplitViewState] = useState<boolean>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(splitViewKey) : null;
      if (raw === "1") return true;
      if (raw === "0") return false;
    } catch {}
    return false;
  });
  const setSplitView = useCallback(
    (val: boolean | ((prev: boolean) => boolean)) => {
      setSplitViewState((prev) => {
        const next = typeof val === "function" ? (val as (p: boolean) => boolean)(prev) : val;
        try {
          window.localStorage.setItem(splitViewKey, next ? "1" : "0");
        } catch {}
        return next;
      });
    },
    [splitViewKey],
  );
  const prevScenesLenRef = useRef<number | null>(null);
  const pendingOrderNotice = useRef<string | null>(null);
  // 탭 이동 시 AgentTab 이 언마운트 되므로, 진행 중인 LLM 호출이 언마운트 이후에
  // 로컬 state 를 건드리지 않도록 mountedRef 로 가드.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [versions, setVersions] = useState<
    { id: string; version_name: string | null; version_number: number; scenes: any[] }[]
  >([]);
  const [showLoadModal, setShowLoadModal] = useState(false);

  const saveMoodImagesToDB = useCallback(
    async (images: MoodImage[]) => {
      const { data: brief } = await supabase
        .from("briefs")
        .select("id")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (brief)
        await supabase
          .from("briefs")
          .update({ mood_image_urls: images } as any)
          .eq("id", brief.id);
    },
    [projectId],
  );

  const fetchAssets = useCallback(async () => {
    const { data } = await supabase
      .from("assets")
      .select("tag_name,photo_url,ai_description,asset_type,role_description,outfit_description,space_description")
      .eq("project_id", projectId);
    if (data) setProjectAssets(data as Asset[]);
    return data as Asset[] | null;
  }, [projectId]);

  // Mirror ContiTab: live-merge assets created in another tab so the
  // mention resolver in scene fields/chat input doesn't operate on a
  // stale list (which would silently corrupt tagged_assets[]).
  useEffect(() => {
    const onAssetCreated = (e: Event) => {
      const ce = e as CustomEvent<Asset & { project_id?: string }>;
      const created = ce.detail;
      if (!created || !created.tag_name) return;
      if (created.project_id && created.project_id !== projectId) return;
      setProjectAssets((prev) => {
        if (prev.some((a) => a.tag_name === created.tag_name)) return prev;
        return [...prev, created as Asset];
      });
    };
    window.addEventListener("preflow:asset-created", onAssetCreated as EventListener);
    return () =>
      window.removeEventListener("preflow:asset-created", onAssetCreated as EventListener);
  }, [projectId]);

  const fetchScenes = useCallback(async () => {
    const { data } = await supabase
      .from("scenes")
      .select("*")
      .eq("project_id", projectId)
      .eq("source", "agent")
      .order("scene_number", { ascending: true });
    if (data) setScenes(data as Scene[]);
  }, [projectId]);

  const fetchBrief = useCallback(async () => {
    const { data } = await supabase
      .from("briefs")
      .select("analysis,mood_image_urls,lang")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (data?.analysis) setBriefAnalysis(data.analysis as unknown as Analysis);
    if ((data as any)?.lang) setBriefLang((data as any).lang as "ko" | "en");
    if ((data as any)?.mood_image_urls) {
      const dbImages = toMoodImages((data as any).mood_image_urls as (string | MoodImage)[]);
      // In-flight generation 의 skeleton placeholder 가 있으면 모두 앞에 보존 (다중 배치 대응).
      // 각 배치의 skeleton 순서를 유지하되, 배치 자체는 시작 순서대로(오래된 → 최신) 나열한다.
      // handleGenerate 가 새 배치를 prepend 하므로 시각적으로는 최신 배치가 위쪽이지만,
      // remount 시 한 번에 재구성할 때는 시작 순서를 그대로 따라도 사용자 경험상 큰 차이가 없다.
      const batches = getMoodGenBatches(projectId).filter((b) => b.promise !== null);
      if (batches.length > 0) {
        const allSkelIdSet = new Set<string>();
        const skeletons: MoodImage[] = [];
        for (const b of batches) {
          for (let i = 0; i < b.skeletonIds.length; i++) {
            const id = b.skeletonIds[i];
            allSkelIdSet.add(id);
            skeletons.push({
              id,
              url: b.arrivedUrls[i] ?? null,
              liked: false,
              sceneRef: null,
              comment: "",
              createdAt: new Date().toISOString(),
            });
          }
        }
        const dbWithoutSkel = dbImages.filter((img) => !allSkelIdSet.has(img.id));
        setMoodImages([...skeletons, ...dbWithoutSkel]);
      } else {
        setMoodImages(dbImages);
      }
    }
    return data?.analysis ? (data.analysis as unknown as Analysis) : null;
  }, [projectId]);

  const handleSceneUpdate = useCallback(async (id: string, fields: Partial<Scene>) => {
    await supabase.from("scenes").update(fields).eq("id", id);
    setScenes((prev) => prev.map((s) => (s.id === id ? { ...s, ...fields } : s)));
  }, []);

  const handleAttachMoodToScene = useCallback(
    async (imageUrl: string, sceneId: string, moodImageId: string, sceneNumber: number) => {
      await supabase.from("scenes").update({ conti_image_url: imageUrl }).eq("id", sceneId);
      setScenes((prev) => prev.map((s) => (s.id === sceneId ? { ...s, conti_image_url: imageUrl } : s)));
      setMoodImages((prev) => {
        const next = prev.map((img) => (img.id === moodImageId ? { ...img, sceneRef: sceneNumber } : img));
        saveMoodImagesToDB(next);
        return next;
      });
    },
    [saveMoodImagesToDB],
  );

  const handleSceneDrop = useCallback(
    async (
      sceneId: string,
      sceneNumber: number,
      payload: { moodImageId: string; url: string },
    ) => {
      if (!payload?.url) return;
      await handleAttachMoodToScene(payload.url, sceneId, payload.moodImageId, sceneNumber);
      toast({ title: t("mood.attachedToast", { scene: sceneNumber }) });
    },
    [handleAttachMoodToScene, toast],
  );

  const handleClearSceneImage = useCallback(
    async (scene: Scene) => {
      const prevUrl = scene.conti_image_url;
      await supabase.from("scenes").update({ conti_image_url: null }).eq("id", scene.id);
      setScenes((prev) => prev.map((s) => (s.id === scene.id ? { ...s, conti_image_url: null } : s)));
      setMoodImages((prev) => {
        const next = prev.map((img) =>
          img.url === prevUrl && img.sceneRef === scene.scene_number ? { ...img, sceneRef: null } : img,
        );
        saveMoodImagesToDB(next);
        return next;
      });
    },
    [saveMoodImagesToDB],
  );

  const handleDetachFromScene = useCallback(
    async (moodImageId: string, sceneNumber: number) => {
      const scene = scenes.find((s) => s.scene_number === sceneNumber);
      const img = moodImages.find((i) => i.id === moodImageId);
      if (scene && img && scene.conti_image_url === img.url) {
        await supabase.from("scenes").update({ conti_image_url: null }).eq("id", scene.id);
        setScenes((prev) => prev.map((s) => (s.id === scene.id ? { ...s, conti_image_url: null } : s)));
      }
      setMoodImages((prev) => {
        const next = prev.map((i) => (i.id === moodImageId ? { ...i, sceneRef: null } : i));
        saveMoodImagesToDB(next);
        return next;
      });
    },
    [scenes, moodImages, saveMoodImagesToDB],
  );

  const handleDeleteMoodImages = useCallback(
    async (ids: string[]) => {
      const idsSet = new Set(ids);
      const connectedSceneIds: string[] = [];
      // 삭제 대상의 파일 URL 후보 — 실제 디스크 삭제는 뒤에서 프로젝트
      // 전반(`scene.conti_image_url`, `conti_image_history`, `sketches`,
      // `scene_versions.scenes` 스냅샷 등) 을 훑는 중앙 가드로 한번 더 검사한다.
      // 기존 코드는 "현재 live `conti_image_url` 과 매치되면 씬 쪽이 처리"
      // 로만 가정했는데, Mood → 씬으로 올린 이미지를 씬에서 Regenerate 하면
      // 그 URL 은 live 에서 빠지고 `conti_image_history` 로 이동한다. 그
      // 상태에서 Mood 쪽 삭제를 하면 history 에 남은 URL 의 파일이 지워져
      // HistorySheet 엑박이 되는 회귀를 유발했다 → 중앙 가드로 차단.
      const candidateUrls: string[] = [];
      for (const id of ids) {
        const img = moodImages.find((i) => i.id === id);
        if (!img) continue;
        if (img.sceneRef !== null && img.sceneRef !== undefined) {
          const scene = scenes.find((s) => s.scene_number === img.sceneRef && s.conti_image_url === img.url);
          if (scene) connectedSceneIds.push(scene.id);
        }
        if (img.url) candidateUrls.push(img.url);
      }
      if (connectedSceneIds.length > 0) {
        await Promise.all(
          connectedSceneIds.map((sceneId) =>
            supabase.from("scenes").update({ conti_image_url: null }).eq("id", sceneId),
          ),
        );
        setScenes((prev) => prev.map((s) => (connectedSceneIds.includes(s.id) ? { ...s, conti_image_url: null } : s)));
      }
      const nextMood = moodImages.filter((i) => !idsSet.has(i.id));
      setMoodImages(nextMood);
      // DB (briefs.mood_image_urls) 업데이트를 먼저 await 한 뒤 참조 검사를
      // 돌려야 "방금 뺀 자기 자신" 이 false-positive 로 잡혀 파일이
      // orphan 으로 남는 걸 피할 수 있다.
      await saveMoodImagesToDB(nextMood);
      await Promise.all(
        candidateUrls.map((u) => deleteStoredFileIfUnreferenced(projectId, u)),
      );
    },
    [moodImages, scenes, saveMoodImagesToDB, projectId],
  );

  const clearScenesAfterSend = useCallback(async () => {
    await supabase.from("scenes").delete().eq("project_id", projectId).eq("source", "agent");
    setScenes([]);
    setPendingScenes([]);
    // ── Preserve mood ↔ scene links ──
    // `sceneRef` on a MoodImage is a **scene_number**, not a scene row id
    // (see handleAttachMoodToScene). When we Send to Conti, the receiving
    // end re-inserts scenes with the same `scene_number` ordering, so the
    // number-based link stays meaningful. Previously this function nulled
    // out every `sceneRef`, which meant that coming back to Ideation after
    // sending (even via `Load Version`) showed mood images unattached to
    // any scene card — the user had to manually drop them onto scenes
    // again. Leaving `sceneRef` as-is keeps that UX intact.
  }, [projectId, setPendingScenes]);

  const fetchVersions = useCallback(async () => {
    const { data } = await supabase
      .from("scene_versions")
      .select("id,version_name,version_number,scenes")
      .eq("project_id", projectId)
      .order("display_order", { ascending: true });
    setVersions((data ?? []) as any[]);
    return (data ?? []) as any[];
  }, [projectId]);

  const handleLoadVersion = useCallback(
    async (versionScenes: any[]) => {
      // Only wipe agent-sourced scenes. Conti-sourced rows (the ones shown in
      // the Conti tab) must survive because the user is re-populating the
      // Ideation tab with a snapshot, not replacing the whole project.
      // Without the `source=agent` filter, loading a version here used to
      // delete every scene the Conti tab was actively editing.
      await supabase.from("scenes").delete().eq("project_id", projectId).eq("source", "agent");
      const storyScenes = versionScenes.filter((s: any) => s.is_transition !== true && !s.transition_type);
      const toInsert = storyScenes.map((s: any, i: number) => ({
        project_id: projectId,
        scene_number: i + 1,
        title: s.title ?? `Shot ${i + 1}`,
        description: s.description ?? "",
        camera_angle: s.camera_angle ?? "",
        location: s.location ?? "",
        mood: s.mood ?? "",
        duration_sec: s.duration_sec ?? null,
        tagged_assets: s.tagged_assets ?? [],
        is_highlight: s.is_highlight ?? false,
        highlight_kind: s.highlight_kind ?? null,
        highlight_reason: s.highlight_reason ?? null,
        conti_image_url: null,
        source: "agent",
      }));
      const { data } = await supabase.from("scenes").insert(toInsert).select();
      if (data) setScenes(data as Scene[]);
      setPendingScenes([]);
      toast({ title: t("agent.versionLoaded") });
    },
    [projectId, setPendingScenes, t, toast],
  );

  const saveScenesToDB = useCallback(
    async (parsed: ParsedScene[], mode: "replace" | "append") => {
      const newScenes = parsed
        .filter((s) => s.scene_number && typeof s.scene_number === "number")
        .map((s) => {
          const jsonTags = (Array.isArray(s.tagged_assets) ? s.tagged_assets : []).map((t: string) =>
            t.startsWith("@") ? t : `@${t}`,
          );
          const extractNormalized = (text: string) =>
            (text.match(/@([\w가-힣]+)/g) ?? [])
              .map((m) => {
                const r = resolveAsset(m, projectAssets);
                return r ? `@${r.name}` : null;
              })
              .filter((n): n is string => n !== null);
          const allRaw = [
            ...new Set([
              ...jsonTags,
              ...extractNormalized(s.description ?? ""),
              ...extractNormalized(s.location ?? ""),
            ]),
          ];
          const registeredTags =
            projectAssets.length > 0
              ? allRaw.filter((tag) => {
                  const raw = tag.startsWith("@") ? tag.slice(1) : tag;
                  return projectAssets.some((a) => {
                    const an = a.tag_name.startsWith("@") ? a.tag_name.slice(1) : a.tag_name;
                    return an === raw;
                  });
                })
              : allRaw;
          return {
            project_id: projectId,
            scene_number: s.scene_number,
        title: s.title ?? `Shot ${s.scene_number}`,
            description: s.description ?? "",
            camera_angle: s.camera_angle ?? "",
            location: s.location ?? "",
            mood: s.mood ?? "",
            duration_sec: typeof s.duration_sec === "number" ? s.duration_sec : null,
            tagged_assets: registeredTags,
            is_highlight: s.is_highlight ?? false,
            highlight_kind: s.highlight_kind ?? null,
            highlight_reason: s.highlight_reason ?? null,
          };
        });
      if (!newScenes.length) return;
      if (mode === "replace") {
        await supabase.from("scenes").delete().eq("project_id", projectId).eq("source", "agent");
        const { error } = await supabase.from("scenes").insert(newScenes.map((s) => ({ ...s, source: "agent" })));
        if (error) {
          toast({ title: t("agent.failedSaveScenes"), description: error.message, variant: "destructive" });
          return;
        }
      } else {
        const { data: existing } = await supabase
          .from("scenes")
          .select("scene_number")
          .eq("project_id", projectId)
          .order("scene_number", { ascending: false })
          .limit(1);
        const offset = existing?.[0]?.scene_number ?? 0;
        const { error } = await supabase
          .from("scenes")
          .insert(newScenes.map((s, i) => ({ ...s, scene_number: offset + i + 1, source: "agent" })));
        if (error) {
          toast({ title: t("agent.failedSaveScenes"), description: error.message, variant: "destructive" });
          return;
        }
      }
      await fetchScenes();
    },
    [projectId, fetchScenes, projectAssets, t, toast],
  );

  const handleConfirmScenes = useCallback(
    async (mode: "replace" | "append") => {
      if (!pendingScenes.length) return;
      await saveScenesToDB(pendingScenes, mode);
      setPendingScenes([]);
      toast({ title: t("agent.scenesConfirmed", { count: pendingScenes.length }) });
    },
    [pendingScenes, saveScenesToDB, t, toast, setPendingScenes],
  );

  const handleClickConfirm = useCallback(() => {
    if (scenes.length > 0) setShowConfirmModal(true);
    else handleConfirmScenes("replace");
  }, [scenes.length, handleConfirmScenes]);

  const handleReplaceConfirm = useCallback(async () => {
    if (!replaceConfirmBuffer) return;
    await supabase.from("scenes").delete().eq("project_id", projectId);
    setScenes([]);
    setPendingScenes(replaceConfirmBuffer);
    setReplaceConfirmBuffer(null);
  }, [replaceConfirmBuffer, projectId, setPendingScenes]);

  useEffect(() => {
    const load = async () => {
      const [chatRes] = await Promise.all([
        supabase.from("chat_logs").select("*").eq("project_id", projectId).order("created_at", { ascending: true }),
        fetchScenes(),
      ]);
      const [analysis, assets] = await Promise.all([fetchBrief(), fetchAssets()]);
      if (chatRes.data?.length) {
        setChatHistory(chatRes.data as ChatLog[]);
        setInitialLoaded(true);
        return;
      }
      setInitialLoaded(true);
      if (analysis) {
        // 이미 다른 마운트에서 auto-init 이 돌고 있다면 중복 호출 방지
        if (getChatGen(projectId)?.inFlight) return;
        setIsLoading(true);
        setChatGen(projectId, { inFlight: true, startedAt: Date.now() });
        try {
          const { data: briefRow } = await supabase
            .from("briefs")
            .select("lang")
            .eq("project_id", projectId)
            .order("created_at", { ascending: false })
            .limit(1)
            .single();
          const initLang = ((briefRow as any)?.lang ?? "ko") as "ko" | "en";
          const briefCtx = buildBriefContextString(analysis, initLang);
          const prefix = initLang === "en" ? "[Brief Analysis]" : "[브리프 분석 결과]";
          const tail =
            initLang === "en"
              ? "\n\nBased on this brief, propose 2–3 synopsis directions in a storylines block. Do not write scenes yet."
              : "\n\n이 브리프를 바탕으로 방향성이 다른 시놉시스 2~3안을 storylines 블록으로 제안해주세요. 아직 씬은 짜지 마세요.";
          const autoPrompt = `${prefix}\n${briefCtx}${tail}`;
          await supabase.from("chat_logs").insert({ project_id: projectId, role: "user", content: autoPrompt });
          await ensureSettingsLoaded();
          const agentModelId = getModel("agent");
          const agentMeta = getModelMeta(agentModelId, getSettingsCached());
          const llmResult = await callLLM({
            model: agentModelId,
            // OpenAI 1M ctx 모델 등 메타가 있으면 카탈로그 기준 max_tokens 사용,
            // 없으면 callLLM 이 카탈로그 디폴트로 폴백.
            max_tokens: agentMeta?.maxOutputTokens ?? 4096,
            system: buildSystemPrompt(videoFormat, assets ?? undefined, analysis, initLang, agentMeta?.provider),
            messages: [{ role: "user", content: autoPrompt }],
          });
          const msg = llmResult.text;
          await supabase.from("chat_logs").insert({ project_id: projectId, role: "assistant", content: msg });
          const extracted = extractScenesFromText(msg);
          if (extracted.length > 0) {
            if (mountedRef.current) {
              setPendingScenes(extracted);
            } else {
              patchChatGen(projectId, {
                pendingExtractedScenes: extracted,
                pendingExtractedNeedsReplaceConfirm: false,
              });
            }
          }
          if (mountedRef.current) {
            setChatHistory([
              { project_id: projectId, role: "user", content: autoPrompt, created_at: new Date().toISOString() },
              { project_id: projectId, role: "assistant", content: msg, created_at: new Date().toISOString() },
            ]);
          }
        } catch (err) {
          console.error("Auto-init error:", err);
        } finally {
          if (mountedRef.current) {
            setIsLoading(false);
          }
          const cur = getChatGen(projectId);
          if (cur?.pendingExtractedScenes && cur.pendingExtractedScenes.length) {
            patchChatGen(projectId, { inFlight: false });
          } else {
            setChatGen(projectId, null);
          }
        }
      }
    };
    load();
  }, [projectId, fetchScenes, fetchBrief, fetchAssets]);

  // ✅ 탭 이동 후 복귀 시, 모듈 스토어에 남아있는 in-flight LLM 호출 상태를 복원한다.
  //    - inFlight 중이면 로딩 인디케이터를 켜두고,
  //    - 완료(스토어가 비워짐)되면 chat_logs 를 재조회해 어시스턴트 응답을 반영,
  //    - 완료 시점에 보관된 pendingExtractedScenes 가 있으면 소비.
  useEffect(() => {
    const hydrateFromStore = () => {
      const state = getChatGen(projectId);
      if (!state) return;
      if (state.inFlight) {
        setIsLoading(true);
      }
      if (state.pendingExtractedScenes && state.pendingExtractedScenes.length > 0) {
        const extracted = state.pendingExtractedScenes;
        const needsReplace = !!state.pendingExtractedNeedsReplaceConfirm;
        const replaceDrafts = !!state.pendingExtractedReplaceDrafts;
        if (needsReplace) {
          setReplaceConfirmBuffer(extracted);
        } else {
          setPendingScenes((prev) => mergeOrReplaceDrafts(prev, extracted, replaceDrafts));
        }
        // 소비 후 정리
        if (state.inFlight) {
          patchChatGen(projectId, {
            pendingExtractedScenes: undefined,
            pendingExtractedNeedsReplaceConfirm: undefined,
            pendingExtractedReplaceDrafts: undefined,
          });
        } else {
          setChatGen(projectId, null);
        }
      }
    };

    hydrateFromStore();

    const unsub = subscribeChatGen(projectId, () => {
      const state = getChatGen(projectId);
      if (!state) {
        // 완전히 비워짐 → 완료. 로딩 해제 + chat_logs 재조회.
        if (mountedRef.current) {
          setIsLoading(false);
          supabase
            .from("chat_logs")
            .select("*")
            .eq("project_id", projectId)
            .order("created_at", { ascending: true })
            .then(({ data }) => {
              if (data && mountedRef.current) setChatHistory(data as ChatLog[]);
            });
        }
        return;
      }
      if (state.inFlight && mountedRef.current) {
        setIsLoading(true);
      }
      if (!state.inFlight && state.pendingExtractedScenes && state.pendingExtractedScenes.length > 0) {
        // 완료됐지만 extracted scenes 가 아직 소비되지 않은 상태 → 소비.
        hydrateFromStore();
      }
    });

    return unsub;
  }, [projectId, setPendingScenes]);

  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      setUserScrolledUp(scrollTop + clientHeight < scrollHeight - 100);
    };
    container.addEventListener("scroll", onScroll);
    return () => container.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!userScrolledUp && (isLoading || chatHistory.length > 0))
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, isLoading, userScrolledUp]);

  useEffect(() => {
    if (prevScenesLenRef.current === null) {
      prevScenesLenRef.current = scenes.length;
      return;
    }
    if (
      prevScenesLenRef.current === 0 &&
      scenes.length > 0 &&
      !chatCollapsed &&
      !isMobile
    ) {
      setChatCollapsed(true);
    }
    prevScenesLenRef.current = scenes.length;
  }, [scenes.length, chatCollapsed, isMobile]);

  const addImages = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files)
        .filter((f) => f.type.startsWith("image/"))
        .slice(0, 4 - chatImages.length);
      if (!arr.length) return;
      const converted = await Promise.all(arr.map(fileToBase64));
      setChatImages((prev) => [...prev, ...converted].slice(0, 4));
    },
    [chatImages.length],
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files?.length) addImages(e.dataTransfer.files);
  };

  // ✅ [FIX] handleSend — 매 전송마다 briefAnalysis DB re-fetch
  const handleSend = async (directText?: string) => {
    const rawText = directText ?? "";
    const orderNotice = pendingOrderNotice.current;
    pendingOrderNotice.current = null;
    const text = orderNotice ? `${orderNotice}\n\n${rawText}`.trim() : rawText.trim();
    if (!text || isLoading) return;
    // 모듈 스토어 레벨에서도 중복 전송 가드 (탭 복귀 직후 in-flight 중인 경우)
    if (getChatGen(projectId)?.inFlight) return;
    setIsLoading(true);
    setChatGen(projectId, { inFlight: true, startedAt: Date.now() });
    const createdAt = new Date().toISOString();
    const currentImages = [...chatImages];
    // NOTE: chat UI / chat_logs DB 에는 사용자가 타이핑한 원본 `text` 그대로 저장.
    //       LLM payload 에만 에셋 활용 체크리스트를 prepend 해서 순응도를 강제한다.
    //       (latestAssets 는 아래 try 블록 안에서 fetch 후 실제 주입됨 → 여기서는 플레이스홀더)
    setChatHistory((prev) => [...prev, { project_id: projectId, role: "user", content: text, created_at: createdAt }]);
    if (currentImages.length > 0)
      sessionImageMap.set(
        createdAt,
        currentImages.map((i) => i.preview),
      );
    setChatImages([]);
    try {
      // ✅ assets와 briefAnalysis 동시 re-fetch
      const [latestAssets, latestAnalysis] = await Promise.all([fetchAssets(), fetchBrief()]);
      await supabase.from("chat_logs").insert({ project_id: projectId, role: "user", content: text });

      // LLM payload 용 텍스트: 등록 에셋이 있으면 체크리스트를 사용자 메시지 앞에 prepend.
      // chat UI / DB 에는 영향 없고 이번 API 호출에만 사용됨.
      const assetReminder = buildAssetUsageReminder(latestAssets ?? [], briefLang);
      const textForLLM = assetReminder ? `${assetReminder}\n[사용자 요청]\n${text}` : text;
      const userApiContent: any =
        currentImages.length > 0
          ? [
              ...currentImages.map((img) => ({
                type: "image",
                source: { type: "base64", media_type: img.mediaType, data: img.base64 },
              })),
              { type: "text", text: textForLLM },
            ]
          : textForLLM;

      // ✅ Mirror the cumulative storyline-ID remap that the UI applies, so the LLM
      //    sees the same A/B/C → D/E/F numbering the user is looking at.
      const cumulativeIds = new Set<string>();
      const history = chatHistory.map((c) => {
        if (c.role === "assistant") {
          return { role: c.role, content: remapMessageForHistory(c.content, cumulativeIds) };
        }
        return { role: c.role, content: c.content };
      });
      if (!history.length && (latestAnalysis ?? briefAnalysis)) {
        const seedPrefix = briefLang === "en" ? "[Brief Analysis]" : "[브리프 분석 결과]";
        history.push({
          role: "user" as const,
          content: `${seedPrefix}\n${buildBriefContextString(latestAnalysis ?? briefAnalysis!, briefLang)}`,
        });
      }
      history.push({ role: "user" as const, content: userApiContent });
      await ensureSettingsLoaded();
      const agentModelId = getModel("agent");
      const agentMeta = getModelMeta(agentModelId, getSettingsCached());
      const systemPrompt = buildSystemPrompt(
        videoFormat,
        latestAssets ?? undefined,
        latestAnalysis ?? briefAnalysis,
        briefLang,
        agentMeta?.provider,
      );
      // ★ 모델 컨텍스트 윈도우에 맞춰 히스토리 소프트 트림.
      //   Claude Sonnet 4=200k, GPT-5.4=400k, GPT-5.5=1M. 작은 모델일수록
      //   오래된 메시지가 먼저 잘려 나가고, 큰 모델은 사실상 트림 없이 통과.
      const prunedHistory = pruneHistoryForBudget(history, {
        contextWindowTokens: agentMeta?.contextWindow ?? 200_000,
        reserveOutputTokens: agentMeta?.maxOutputTokens ?? 4096,
        systemPromptChars: systemPrompt.length,
      });
      const llmResult = await callLLM({
        model: agentModelId,
        max_tokens: agentMeta?.maxOutputTokens ?? 4096,
        system: systemPrompt,
        messages: prunedHistory,
      });
      const assistantContent = llmResult.text;
      await supabase.from("chat_logs").insert({ project_id: projectId, role: "assistant", content: assistantContent });
      if (mountedRef.current) {
        setChatHistory((prev) => [
          ...prev,
          { project_id: projectId, role: "assistant", content: assistantContent, created_at: new Date().toISOString() },
        ]);
      }
      const extracted = extractScenesFromText(assistantContent);
      // Storyline-selection 응답에서 씬이 하나도 추출되지 않으면 Phase 2 전환 실패일 가능성이 높다.
      // 실제 어시스턴트가 어떤 포맷으로 응답했는지 디버깅할 수 있도록 로그를 남긴다.
      const looksLikeStorylinePick =
        /\b[A-Z]안\b[\s\S]*(선택|진행|결정|가자|갈게|갈래)/.test(text) ||
        /\b(pick|go\s+with|choose|proceed)\b/i.test(text);
      if (looksLikeStorylinePick && extracted.length === 0) {
        console.warn(
          "[AgentTab] 스토리라인 선택 후 ```scene``` 블록이 감지되지 않았습니다. 어시스턴트 응답:",
          assistantContent,
        );
      }
      if (extracted.length > 0) {
        const needsReplaceConfirm = scenes.length > 0;
        const replaceDrafts = shouldReplaceDraftsFromExtraction({
          userText: text,
          assistantText: assistantContent,
          previous: pendingScenes,
          extracted,
        });
        if (mountedRef.current) {
          if (needsReplaceConfirm) {
            setReplaceConfirmBuffer(extracted);
          } else {
            setPendingScenes((prev) => mergeOrReplaceDrafts(prev, extracted, replaceDrafts));
          }
        } else {
          // 언마운트 상태라면 모듈 스토어에 보관, 리마운트 시 반영
          patchChatGen(projectId, {
            pendingExtractedScenes: extracted,
            pendingExtractedNeedsReplaceConfirm: needsReplaceConfirm,
            pendingExtractedReplaceDrafts: replaceDrafts,
          });
        }
      }
    } catch (err: any) {
      if (mountedRef.current) {
        toast({ title: t("agent.failedSendMessage"), description: err.message, variant: "destructive" });
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
      // in-flight 플래그 해제 — 단, pendingExtractedScenes 가 남아있으면 리마운트가 소비할 때까지 유지
      const cur = getChatGen(projectId);
      if (cur?.pendingExtractedScenes && cur.pendingExtractedScenes.length) {
        patchChatGen(projectId, { inFlight: false });
      } else {
        setChatGen(projectId, null);
      }
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const reordered = arrayMove(
      scenes,
      scenes.findIndex((s) => s.id === active.id),
      scenes.findIndex((s) => s.id === over.id),
    ).map((s, i) => ({ ...s, scene_number: i + 1 }));
    setScenes(reordered);
    await Promise.all(
      reordered.map((s) => supabase.from("scenes").update({ scene_number: s.scene_number }).eq("id", s.id)),
    );
    pendingOrderNotice.current = `[Shot order changed]\n${reordered.map((s) => `#${String(s.scene_number).padStart(2, "0")} ${s.title || `Shot ${s.scene_number}`}`).join("\n")}\n\nPlease check whether the story flow still feels natural.`;
    toast({ title: t("agent.sceneOrderUpdated") });
  };

  const handleDeleteScene = async (id: string) => {
    const deletedScene = scenes.find((s) => s.id === id);
    await supabase.from("scenes").delete().eq("id", id);
    if (deletedScene) {
      setMoodImages((prev) => {
        const next = prev.map((img) => (img.sceneRef === deletedScene.scene_number ? { ...img, sceneRef: null } : img));
        if (next.some((img, i) => img !== prev[i])) saveMoodImagesToDB(next);
        return next;
      });
    }
    await fetchScenes();
  };
  const [newSceneId, setNewSceneId] = useState<string | null>(null);

  const handleAddScene = async () => {
    const tempNumber = 90000 + (Date.now() % 10000);
    const nextNum = scenes.reduce((max, scene) => Math.max(max, scene.scene_number), 0) + 1;
    const { data, error } = await supabase
      .from("scenes")
      .insert({
        project_id: projectId,
        scene_number: tempNumber,
        title: `Shot ${nextNum}`,
        description: null,
        camera_angle: null,
        location: null,
        mood: null,
        duration_sec: null,
        tagged_assets: [],
        conti_image_url: null,
        source: "agent",
      })
      .select()
      .single();
    if (error || !data) {
      toast({ title: t("agent.failedAddScene"), description: error?.message, variant: "destructive" });
      return;
    }
    const updated = [...scenes, data as Scene];
    const renumbered = updated.map((scene, index) => ({ ...scene, scene_number: index + 1 }));
    setNewSceneId(data.id);
    setScenes(renumbered);
    setTimeout(() => setNewSceneId(null), 400);
    const tempRenumbered = renumbered.map((scene, index) => ({ ...scene, scene_number: 80000 + index }));
    await Promise.all(
      tempRenumbered.map((scene) =>
        supabase.from("scenes").update({ scene_number: scene.scene_number }).eq("id", scene.id),
      ),
    );
    await Promise.all(
      renumbered.map((scene) =>
        supabase.from("scenes").update({ scene_number: scene.scene_number }).eq("id", scene.id),
      ),
    );
  };

  const handleInsertSceneAt = async (insertIdx: number) => {
    const tempNumber = 90000 + (Date.now() % 10000);
    const { data, error } = await supabase
      .from("scenes")
      .insert({
        project_id: projectId,
        scene_number: tempNumber,
        title: `Shot ${insertIdx + 1}`,
        description: null,
        camera_angle: null,
        location: null,
        mood: null,
        duration_sec: null,
        tagged_assets: [],
        conti_image_url: null,
        source: "agent",
      })
      .select()
      .single();
    if (error || !data) {
      toast({ title: t("agent.failedInsertScene"), description: error?.message, variant: "destructive" });
      return;
    }
    const updated = [...scenes];
    updated.splice(insertIdx, 0, data as Scene);
    const renumbered = updated.map((scene, index) => ({ ...scene, scene_number: index + 1 }));
    setNewSceneId(data.id);
    setScenes(renumbered);
    setTimeout(() => setNewSceneId(null), 400);
    const tempRenumbered = renumbered.map((scene, index) => ({ ...scene, scene_number: 80000 + index }));
    await Promise.all(
      tempRenumbered.map((scene) =>
        supabase.from("scenes").update({ scene_number: scene.scene_number }).eq("id", scene.id),
      ),
    );
    await Promise.all(
      renumbered.map((scene) =>
        supabase.from("scenes").update({ scene_number: scene.scene_number }).eq("id", scene.id),
      ),
    );
  };

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const displayMessages: ChatLog[] =
    initialLoaded && !chatHistory.length && !isLoading
      ? [{ project_id: projectId, role: "assistant", content: t("agent.welcomeNoBrief"), created_at: new Date().toISOString() }]
      : chatHistory.map((m) =>
          m.role === "user" && isBriefAnalysisMsg(m.content) ? { ...m, role: "assistant" as const } : m,
        );

  const CdAvatar = ({ size = "w-8 h-8", iconSize = 18 }: { size?: string; iconSize?: number }) => (
    <div
      className={`${size} flex items-center justify-center text-white font-bold shrink-0`}
      style={{ background: KR, borderRadius: 0 }}
    >
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    </div>
  );

  const handleMoodToChat = useCallback((url: string) => {
    fetch(url)
      .then((r) => r.blob())
      .then((b) => fileToBase64(new File([b], "mood.jpg", { type: "image/jpeg" })))
      .then((img) => setChatImages((prev) => [...prev, img].slice(0, 4)));
    setRightPanel("scenes");
  }, []);

  const chatPanel = (
    <div
      className="flex flex-col h-full relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ background: "#000" }}
    >
      {isDragOver && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-none pointer-events-none"
          style={{ background: KR_BG, border: `2px dashed ${KR}` }}
        >
          <ImagePlus className="w-10 h-10 mb-2" style={{ color: KR }} />
          <span className="text-[14px] font-semibold" style={{ color: KR }}>
            Drop images here
          </span>
        </div>
      )}
      {/* 채팅 상단: 우측 패널 탭 바와 높이 맞춤
          우측 탭 바 = outer padding(10 + 10) + tablist(padding 3×2 + border 1×2 + 탭버튼 32) = 60 */}
      <div
        className="flex items-center justify-end shrink-0"
        style={{
          padding: "10px 14px",
          height: 60,
          borderBottom: "1px solid hsl(var(--border))",
        }}
      >
        {!isMobile && (
          <button
            onClick={() => setChatCollapsed(true)}
            title={t("agent.collapseChat")}
            style={{
              width: 24,
              height: 24,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: "1px solid hsl(var(--border))",
              color: "rgba(255,255,255,0.55)",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = "#fff";
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.55)";
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            <PanelLeftClose style={{ width: 13, height: 13 }} />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={chatContainerRef}>
        {(() => {
          const cumulativeIds = new Set<string>();
          return displayMessages.map((msg, i) => {
            const parsedSegments = msg.role === "assistant" && !isBriefAnalysisMsg(msg.content)
              ? parseMessageSegments(msg.content, cumulativeIds)
              : undefined;

            if (parsedSegments) {
              for (const seg of parsedSegments) {
                if (seg.type === "storylines" && Array.isArray(seg.options)) {
                  seg.options.forEach((o: any) => cumulativeIds.add(String(o.id).toUpperCase()));
                }
              }
            }

            return (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && <CdAvatar size="w-6 h-6" iconSize={14} />}
                {msg.role === "assistant" && <div className="mr-2" />}
                <div className="max-w-[85%]">
                  {msg.role === "user" && msg.created_at && sessionImageMap.get(msg.created_at)?.length ? (
                    <div className="flex flex-wrap gap-1.5 mb-1.5 justify-end">
                      {sessionImageMap.get(msg.created_at)!.map((url, j) => (
                        <img key={j} src={url} className="h-16 w-16 object-cover rounded-none border border-border" loading="lazy" decoding="async" />
                      ))}
                    </div>
                  ) : null}
                  <div
                    className={`px-3.5 py-2.5 text-[14px] leading-relaxed ${msg.role === "user" ? "text-foreground" : "bg-card text-foreground border border-border"}`}
                    style={
                      msg.role === "user"
                        ? { background: "rgba(249,66,58,0.06)", border: "1px solid rgba(249,66,58,0.15)", borderRadius: 0 }
                        : { borderRadius: 0 }
                    }
                  >
                    <MessageContent content={msg.content} assets={projectAssets} onSend={handleSend} segments={parsedSegments} />
                  </div>
                  <div className={`text-[11px] text-muted-foreground mt-1 ${msg.role === "user" ? "text-right" : ""}`}>
                    {formatTime(msg.created_at)}
                  </div>
                </div>
              </div>
            );
          });
        })()}
        {isLoading && (
          <div className="flex justify-start">
            <CdAvatar size="w-6 h-6" iconSize={14} />
            <div className="ml-2">
              <div className="bg-secondary rounded-none border border-border px-4 py-3 flex items-center gap-1">
                {[0, 1, 2].map((j) => (
                  <span
                    key={j}
                    className="w-1.5 h-1.5 rounded-none animate-bounce"
                    style={{ background: KR, animationDelay: `${j * 150}ms` }}
                  />
                ))}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">{t("agent.craftingScenario")}</div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      {chatImages.length > 0 && (
        <div className="px-4 pt-3 pb-1 flex items-center gap-2 shrink-0">
          {chatImages.map((img, i) => (
            <div key={i} className="relative group shrink-0">
              <img
                src={img.preview}
                className="rounded-none object-cover border border-border"
                style={{ width: 52, height: 52 }} loading="lazy" decoding="async" />
              <div className="absolute inset-0 rounded-none bg-black/0 group-hover:bg-black/30 transition-colors" />
              <button
                onClick={() => setChatImages((prev) => prev.filter((_, j) => j !== i))}
                className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: "none", border: "none", cursor: "pointer" }}
              >
                <div className="w-5 h-5 rounded-none bg-black/60 flex items-center justify-center">
                  <X className="w-3 h-3 text-white" />
                </div>
              </button>
            </div>
          ))}
          {chatImages.length < 4 && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 flex flex-col items-center justify-center rounded-none border border-dashed border-border text-muted-foreground/50 hover:border-primary hover:text-primary transition-colors"
              style={{ width: 52, height: 52, background: "transparent" }}
            >
              <Plus className="w-4 h-4" />
              <span style={{ fontSize: 9, marginTop: 2 }}>{chatImages.length}/4</span>
            </button>
          )}
        </div>
      )}
      <div className="shrink-0 border-t border-border px-3 py-2.5">
        <AgentChatInput
          assets={projectAssets}
          projectId={projectId}
          disabled={isLoading}
          hasImages={chatImages.length > 0}
          onSend={handleSend}
          onAttach={() => fileInputRef.current?.click()}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addImages(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );

  const rightPanelContent = (
    <div className="flex flex-col h-full">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "10px 14px",
          borderBottom: "1px solid hsl(var(--border))",
          flexShrink: 0,
          overflowX: "auto",
        }}
      >
        <div
          role="tablist"
          aria-label={t("agent.rightPanel")}
          style={{
            display: splitView ? "none" : "inline-flex",
            gap: 4,
            padding: 3,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid hsl(var(--border))",
            flexShrink: 0,
            transition: "opacity 0.15s",
          }}
        >
          {(["scenes", "mood"] as RightPanel[]).map((p) => {
            const active = !splitView && rightPanel === p;
            const Icon = p === "scenes" ? Layers : SlidersHorizontal;
            const label = p === "scenes" ? t("agent.sceneComposition") : t("agent.moodIdeation");
            const count = p === "scenes" ? scenes.length : moodImages.length;
            return (
              <button
                key={p}
                role="tab"
                aria-selected={active}
                onClick={() => {
                  if (splitView) setSplitView(false);
                  setRightPanel(p);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  height: 32,
                  padding: "0 12px",
                  fontSize: 12.5,
                  fontWeight: 700,
                  letterSpacing: "0.02em",
                  color: active ? "#fff" : "rgba(255,255,255,0.55)",
                  background: active ? "rgba(249,66,58,0.16)" : "transparent",
                  border: active
                    ? "1px solid rgba(249,66,58,0.45)"
                    : "1px solid transparent",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (!active) (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.85)";
                }}
                onMouseLeave={(e) => {
                  if (!active) (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.55)";
                }}
              >
                <Icon
                  style={{
                    width: 13,
                    height: 13,
                    color: active ? KR : "currentColor",
                  }}
                />
                <span>{label}</span>
                <span
                  className="font-mono"
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "1px 5px",
                    background: active ? "rgba(249,66,58,0.22)" : "rgba(255,255,255,0.08)",
                    color: active ? KR : "rgba(255,255,255,0.5)",
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {!isMobile && (
          <button
            onClick={() => setSplitView((v) => !v)}
            title={splitView ? t("agent.singleViewTitle") : t("agent.splitViewTitle")}
            aria-pressed={splitView}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 32,
              padding: "0 12px",
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: "0.04em",
              color: splitView ? KR : "rgba(255,255,255,0.55)",
              background: splitView ? "rgba(249,66,58,0.10)" : "transparent",
              border: splitView
                ? "1px solid rgba(249,66,58,0.45)"
                : "1px solid hsl(var(--border))",
              cursor: "pointer",
              transition: "all 0.15s",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              if (!splitView) {
                (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.85)";
                (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
              }
            }}
            onMouseLeave={(e) => {
              if (!splitView) {
                (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.55)";
                (e.currentTarget as HTMLElement).style.background = "transparent";
              }
            }}
          >
            <Columns2 style={{ width: 13, height: 13 }} />
            <span>{splitView ? t("agent.splitOn") : t("agent.split")}</span>
          </button>
        )}
      </div>

      {(() => {
      const scenesBody = (
        <div ref={scenesPanelRef} className="flex flex-col flex-1 min-h-0">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 12px",
              borderBottom: "0.5px solid hsl(var(--border))",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {scenes.some((s) => s.duration_sec) && (
                <span
                  className="font-mono"
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  {t("agent.totalSeconds", { seconds: scenes.reduce((a, s) => a + (s.duration_sec ?? 0), 0) })}
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button
                onClick={() => setShowImages((v) => !v)}
                title={
                  panelTooNarrowForImage
                    ? t("agent.imageColumnCollapsed")
                    : showImages
                      ? t("agent.hideImages")
                      : t("agent.showImages")
                }
                disabled={panelTooNarrowForImage}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {effectiveShowImages ? (
                  <Image style={{ width: 14, height: 14 }} />
                ) : (
                  <ImageOff style={{ width: 14, height: 14 }} />
                )}
              </button>
              <div style={{ width: 1, height: 16, background: "hsl(var(--border))" }} />
              <button
                onClick={async () => {
                  await fetchVersions();
                  setShowLoadModal(true);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  height: 28,
                  padding: "0 10px",
                  borderRadius: 0,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  border: "0.5px solid hsl(var(--border))",
                  background: "transparent",
                  color: "hsl(var(--muted-foreground))",
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "hsl(var(--muted))")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
              >
                <RotateCcw style={{ width: 12, height: 12 }} />
                {t("agent.loadVersion")}
              </button>
              <div style={{ width: 1, height: 16, background: "hsl(var(--border))" }} />
              <button
                onClick={handleAddScene}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  height: 28,
                  padding: "0 10px",
                  borderRadius: 0,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  border: "0.5px solid hsl(var(--border))",
                  background: "transparent",
                  color: "hsl(var(--muted-foreground))",
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "hsl(var(--muted))")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
              >
                <Plus style={{ width: 12, height: 12 }} />
                {t("agent.addScene")}
              </button>
              <button
                onClick={() => setShowSendModal(true)}
                disabled={!scenes.length}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  height: 28,
                  padding: "0 12px",
                  borderRadius: 0,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  background: scenes.length ? KR : "hsl(var(--muted))",
                  color: scenes.length ? "#fff" : "hsl(var(--muted-foreground))",
                  border: "none",
                  cursor: scenes.length ? "pointer" : "not-allowed",
                }}
              >
                <Send style={{ width: 12, height: 12 }} />
                {t("agent.sendToConti")}
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {briefAnalysis && (
              <AgentAbcdPanel
                projectId={projectId}
                scenes={abcdScenes}
                briefAnalysis={briefAnalysis}
                lang={briefLang}
              />
            )}
            {pendingScenes.length > 0 && (
              <div className="rounded-none border-2 overflow-visible" style={{ borderColor: KR, background: KR_BG }}>
                <div
                  className="flex items-center justify-between px-4 py-2.5"
                  style={{ borderBottom: `1px solid ${KR_BORDER2}` }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-bold" style={{ color: KR }}>
                      {t("agent.draftScenes", { count: pendingScenes.length })}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{t("agent.clickToEdit")}</span>
                  </div>
                  <button
                    onClick={() => setPendingScenes([])}
                    style={{ background: "none", border: "none", cursor: "pointer" }}
                  >
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </div>
                <div className="p-3 space-y-2">
                  {pendingScenes.map((s) => (
                    <EditablePendingSceneCard
                      key={s.scene_number}
                      scene={s}
                      assets={projectAssets}
                      projectId={projectId}
                      onUpdate={handlePendingUpdate}
                    />
                  ))}
                </div>
                <div className="px-3 pb-3">
                  <button
                    onClick={handleClickConfirm}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-none text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
                    style={{ background: KR, border: "none", cursor: "pointer" }}
                  >
                    <Check className="w-4 h-4" />{t("agent.createSceneCardsFromDraft")}
                  </button>
                </div>
              </div>
            )}
            {!scenes.length && !pendingScenes.length ? (
              <EmptyState
                icon={<Clapperboard className="w-10 h-10" />}
                title={t("agent.noScenesYet")}
                // Empty-state copy after the plan's Phase 3 Send-to-Conti fix:
                //   · Users arriving here a second time (after Send to Conti
                //     cleared the drafts) should know that their story is
                //     still retrievable via Load Version.
                //   · Sketches now live in Conti per-scene, so we explicitly
                //     redirect users who came looking for mood/composition
                //     iteration to the Conti tab instead of telling them to
                //     re-chat with Agent from scratch.
                description={t("agent.noScenesDesc")}
                action={
                  versions.length > 0 ? (
                    <button
                      onClick={async () => {
                        await fetchVersions();
                        setShowLoadModal(true);
                      }}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-none text-[11px] font-semibold transition-colors"
                      style={{
                        border: `0.5px solid ${KR}`,
                        background: "transparent",
                        color: KR,
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "rgba(249,66,58,0.08)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "transparent";
                      }}
                    >
                      <RotateCcw style={{ width: 12, height: 12 }} />
                      {t("agent.loadVersion")}
                    </button>
                  ) : undefined
                }
                className="h-full"
              />
            ) : scenes.length > 0 ? (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={scenes.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                  {pendingScenes.length > 0 && (
                    <div className="flex items-center gap-2 py-1">
                      <div className="flex-1 h-px bg-border/50" />
                      <span className="text-[10px] text-muted-foreground/50">{t("agent.confirmedScenes")}</span>
                      <div className="flex-1 h-px bg-border/50" />
                    </div>
                  )}
                  {scenes.map((scene, idx) => (
                    <React.Fragment key={scene.id}>
                      {idx > 0 && (
                        <div
                          style={{
                            position: "relative",
                            height: 8,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                          className="group/insert"
                        >
                          <div
                            className="opacity-0 group-hover/insert:opacity-100 transition-opacity"
                            style={{
                              position: "absolute",
                              left: 0,
                              right: 0,
                              top: "50%",
                              height: 1,
                              background: `linear-gradient(to right, transparent, ${KR} 15%, ${KR} 85%, transparent)`,
                              transform: "translateY(-50%)",
                              pointerEvents: "none",
                            }}
                          />
                          <button
                            onClick={() => handleInsertSceneAt(idx)}
                            className="opacity-0 group-hover/insert:opacity-100 transition-opacity"
                            style={{
                              position: "absolute",
                              top: "50%",
                              left: "50%",
                              transform: "translate(-50%, -50%)",
                              zIndex: 10,
                              width: 24,
                              height: 24,
                              minWidth: 24,
                              minHeight: 24,
                              borderRadius: "9999px",
                              aspectRatio: "1 / 1",
                              background: KR,
                              color: "#fff",
                              border: "none",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              padding: 0,
                              boxSizing: "border-box",
                            }}
                          >
                            <Plus style={{ width: 12, height: 12 }} />
                          </button>
                        </div>
                      )}
                      <div
                        style={{
                          transition: "transform 0.3s ease, opacity 0.3s ease",
                          ...(scene.id === newSceneId ? { animation: "fadeIn 0.35s ease forwards" } : {}),
                        }}
                      >
                        <SortableSceneCard
                          scene={scene}
                          onDelete={setDeleteConfirmId}
                          onUpdate={handleSceneUpdate}
                          onClearImage={handleClearSceneImage}
                          assets={projectAssets}
                          onLightboxMood={setMoodLightboxUrl}
                          videoFormat={videoFormat}
                          sharedHeight={sharedHeight}
                          onContentHeight={handleContentHeight}
                          showImages={effectiveShowImages}
                          onDropMoodImage={handleSceneDrop}
                          maxImgWidth={maxImgWidth}
                        />
                      </div>
                    </React.Fragment>
                  ))}
                </SortableContext>
              </DndContext>
            ) : null}
            <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("agent.deleteScene")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete this scene? This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      if (deleteConfirmId) {
                        handleDeleteScene(deleteConfirmId);
                        setDeleteConfirmId(null);
                      }
                    }}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      );
      const moodBody = (
        <MoodIdeationPanel
          projectId={projectId}
          briefAnalysis={briefAnalysis}
          scenes={scenes}
          assets={projectAssets}
          videoFormat={videoFormat}
          moodImages={moodImages}
          setMoodImages={setMoodImages}
          saveMoodImagesToDB={saveMoodImagesToDB}
          onSendToChat={handleMoodToChat}
          onAttachToScene={handleAttachMoodToScene}
          onDetachFromScene={handleDetachFromScene}
          onDeleteMoodImages={handleDeleteMoodImages}
        />
      );
      if (splitView && !isMobile) {
        const renderSplitHeader = (kind: RightPanel) => {
          const Icon = kind === "scenes" ? Layers : SlidersHorizontal;
          const label = kind === "scenes" ? t("agent.sceneComposition") : t("agent.moodIdeation");
          const count = kind === "scenes" ? scenes.length : moodImages.length;
          return (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                height: 40,
                padding: "0 14px",
                borderBottom: "0.5px solid hsl(var(--border))",
                background: "rgba(255,255,255,0.02)",
                flexShrink: 0,
              }}
            >
              <Icon style={{ width: 13, height: 13, color: KR }} />
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  letterSpacing: "0.02em",
                  color: "#fff",
                }}
              >
                {label}
              </span>
              <span
                className="font-mono"
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "1px 5px",
                  background: "rgba(249,66,58,0.22)",
                  color: KR,
                }}
              >
                {count}
              </span>
            </div>
          );
        };
        return (
          <ResizablePanelGroup direction="horizontal" className="flex-1">
            <ResizablePanel defaultSize={58} minSize={25}>
              <div className="h-full flex flex-col overflow-hidden">
                {renderSplitHeader("scenes")}
                {scenesBody}
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={42} minSize={25}>
              <div className="h-full flex flex-col overflow-hidden">
                {renderSplitHeader("mood")}
                {moodBody}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        );
      }
      return rightPanel === "scenes" ? scenesBody : moodBody;
      })()}
    </div>
  );

  const modals = (
    <>
      {showSendModal && (
        <SendToContiModal
          scenes={scenes}
          projectId={projectId}
          onClose={() => setShowSendModal(false)}
          onSent={async (_, name) => {
            toast({ title: `"${name}" sent successfully` });
            await clearScenesAfterSend();
            onSwitchToContiTab?.();
          }}
        />
      )}
      {showConfirmModal && (
        <ConfirmScenesModal
          pendingCount={pendingScenes.length}
          existingCount={scenes.length}
          onClose={() => setShowConfirmModal(false)}
          onConfirm={handleConfirmScenes}
        />
      )}
      {showLoadModal && (
        <LoadVersionModal versions={versions} onClose={() => setShowLoadModal(false)} onLoad={handleLoadVersion} />
      )}
      {replaceConfirmBuffer && (
        <Dialog open onOpenChange={(o) => !o && setReplaceConfirmBuffer(null)}>
          <DialogContent className="max-w-[400px] bg-card border-border">
            <DialogHeader>
              <DialogTitle>{t("agent.replaceDraftTitle")}</DialogTitle>
            </DialogHeader>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              Agent has proposed <strong className="text-foreground">{replaceConfirmBuffer.length}</strong> new
              draft scene{replaceConfirmBuffer.length > 1 ? "s" : ""}.
              <br />
              Your <strong className="text-foreground">{scenes.length}</strong> currently confirmed scene
              {scenes.length > 1 ? "s" : ""} will be deleted.
            </p>
            <div className="flex items-start gap-2 text-[11px] text-muted-foreground/60 bg-muted rounded-none px-3 py-2 mt-1">
              <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-px" strokeWidth={1.75} />
              <span>{t("agent.finalCommitHint")}</span>
            </div>
            <DialogFooter className="gap-2 mt-1">
              <Button variant="ghost" onClick={() => setReplaceConfirmBuffer(null)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleReplaceConfirm} className="gap-1.5 text-white" style={{ background: KR }}>
                <Check className="w-3.5 h-3.5" />
                {t("agent.replace")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {moodLightboxUrl && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.85)" }}
          onClick={() => setMoodLightboxUrl(null)}
        >
          <button
            onClick={() => setMoodLightboxUrl(null)}
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
          <img
            src={moodLightboxUrl}
            alt="mood"
            style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 0 }}
            onClick={(e) => e.stopPropagation()} loading="lazy" decoding="async" />
        </div>
      )}
    </>
  );

  const chatRail = (
    <div
      style={{
        width: 44,
        flexShrink: 0,
        // 확장 상태의 채팅 패널(#000)과 동일 톤 — "chat = 검정" 일관성 유지
        background: "#000",
        borderRight: "1px solid hsl(var(--border))",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* 상단: 우측 패널 탭 바(60px) 와 높이 정렬 */}
      <button
        onClick={() => setChatCollapsed(false)}
        title={t("agent.expandChat")}
        style={{
          width: "100%",
          height: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: "none",
          borderBottom: "1px solid hsl(var(--border))",
          color: "rgba(255,255,255,0.7)",
          cursor: "pointer",
          transition: "all 0.15s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.color = KR;
          (e.currentTarget as HTMLElement).style.background = "rgba(249,66,58,0.08)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.7)";
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }}
      >
        <PanelLeftOpen style={{ width: 16, height: 16 }} />
      </button>
      {/* 중단: 채팅 히스토리 인디케이터 — 클릭 시 채팅 펼치기 */}
      <button
        onClick={() => setChatCollapsed(false)}
        title={t("agent.expandChat")}
        style={{
          flex: 1,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: 8,
          background: "transparent",
          border: "none",
          color: "rgba(255,255,255,0.45)",
          cursor: "pointer",
          padding: "18px 0",
          transition: "color 0.15s",
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.95)")}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.45)")}
      >
        <MessageSquare style={{ width: 14, height: 14 }} />
        {chatHistory.length > 0 && (
          <span
            className="font-mono"
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: "2px 5px",
              background: "rgba(249,66,58,0.14)",
              color: KR,
              border: "1px solid rgba(249,66,58,0.3)",
              lineHeight: 1,
            }}
          >
            {chatHistory.length}
          </span>
        )}
      </button>
    </div>
  );

  if (isMobile) {
    return (
      <div className="flex flex-col h-full">
        <div style={{ height: "60vh" }}>{chatPanel}</div>
        <div className="border-t border-border" style={{ height: "40vh" }}>
          {rightPanelContent}
        </div>
        {modals}
      </div>
    );
  }

  return (
    <div className="h-full">
      {chatCollapsed ? (
        <div className="flex h-full">
          {chatRail}
          <div className="flex-1 min-w-0">{rightPanelContent}</div>
        </div>
      ) : (
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={38} minSize={28}>
            {chatPanel}
          </ResizablePanel>
          <ResizableHandle
            className="!bg-transparent w-1 transition-colors"
            style={{
              background:
                "linear-gradient(to bottom, transparent, hsl(var(--border)) 20%, hsl(var(--border)) 80%, transparent)",
            }}
          />
          <ResizablePanel defaultSize={62} minSize={35}>
            {rightPanelContent}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
      {modals}
    </div>
  );
};
