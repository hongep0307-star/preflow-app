import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { callLLM } from "@/lib/llm";
import { getModel } from "@/lib/modelPreference";
import { subscribeModel } from "@/lib/modelPreference";
import { getModelMeta } from "@/lib/modelCatalog";
import { ensureSettingsLoaded, getSettingsCached } from "@/lib/settingsCache";
import ModelPicker from "@/components/common/ModelPicker";
import {
  type RefItem,
  type RefImageItem,
  type RefYoutubeItem,
  type RefVideoItem,
  type RefAnnotation,
  type SerializableRefItem,
  toSerializableRefItems,
  fromSerializableRefItems,
  recomputeIgnoredByModel,
  summarize as summarizeRefs,
  summarizeLabel as summarizeRefsLabel,
  makeRefId,
  toDataUrl as refToDataUrl,
  hasAnnotation,
  parseTimeRange,
  formatAnnotationLines,
} from "@/lib/refItems";
import { ingestYoutube, isYoutubeUrl, YOUTUBE_URL_REGEX } from "@/lib/youtube";
import { extractFirstFrame, sampleFrames, validateVideoFile } from "@/lib/videoFrames";
import type {
  ContentType,
  ProductInfo,
  HeroVisual,
  HookStrategy,
  Pacing,
  Constraints,
  AudienceInsight,
  ABCDCompliance,
  NarrativeAnalysis,
} from "@/components/agent/agentTypes";
import { scoreABCD, gradeABCD } from "@/lib/abcdScorer";
import { useToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";
import {
  BarChart3,
  CheckCircle,
  Copy,
  ImagePlus,
  X,
  Plus,
  FileText,
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  LayoutList,
  GalleryHorizontalEnd,
  ChevronLeft,
  GripVertical,
  Package,
  MessageSquare,
  Target,
  Camera,
  Lightbulb,
  Palette,
  Scissors,
  Link as LinkIcon,
  Film,
  Youtube as YoutubeIcon,
  Loader2,
  Image as ImageIcon,
  EyeOff,
  Pencil,
  type LucideIcon,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  type AnimateLayoutChanges,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/* ━━━━━ localStorage 키 ━━━━━ */
const LS_KEY = (pid: string) => `ff_brief_draft_${pid}`;

/* ━━━━━ localStorage 직렬화용 이미지 타입 (File 제외) ━━━━━ */
interface SerializableImage {
  base64: string;
  mediaType: string;
}

interface PersistedDraft {
  briefText: string;
  ideaNote: string;
  briefImages: SerializableImage[];
  /** v2 통합 모델 — image/youtube/video 모두 담음 */
  refItems: SerializableRefItem[];
  /** v1 호환 — 옛날 데이터에서만 존재, 로드 후 refItems 로 자동 마이그레이션 */
  refImages?: SerializableImage[];
  pdfState: "idle" | "extracting" | "ready" | "error";
  pdfExtractedText: string;
  pdfFileName: string;
  pdfFileSize: number;
  pdfPageInfo: { pages: number; chars: number } | null;
}

const getDefaultPersisted = (): PersistedDraft => ({
  briefText: "",
  ideaNote: "",
  briefImages: [],
  refItems: [],
  pdfState: "idle",
  pdfExtractedText: "",
  pdfFileName: "",
  pdfFileSize: 0,
  pdfPageInfo: null,
});

/**
 * v1 → v2 자동 마이그레이션: 옛 `refImages` 만 있는 드래프트를
 * 새 `refItems` 로 변환. 한 번 로드하면 다음 save 부터 v2 형식으로 저장됨.
 */
const migrateLegacyRefImages = (draft: PersistedDraft): PersistedDraft => {
  if (draft.refItems && draft.refItems.length > 0) return draft;
  if (!draft.refImages || draft.refImages.length === 0) return draft;
  const migrated: SerializableRefItem[] = draft.refImages.map((img) => ({
    kind: "image",
    id: makeRefId("image"),
    addedAt: new Date().toISOString(),
    base64: img.base64,
    mediaType: img.mediaType,
  }));
  return { ...draft, refItems: migrated, refImages: [] };
};

const loadFromLS = (pid: string): PersistedDraft => {
  try {
    const raw = localStorage.getItem(LS_KEY(pid));
    if (!raw) return getDefaultPersisted();
    const merged = { ...getDefaultPersisted(), ...JSON.parse(raw) } as PersistedDraft;
    return migrateLegacyRefImages(merged);
  } catch {
    return getDefaultPersisted();
  }
};

const saveToLS = (pid: string, draft: PersistedDraft) => {
  try {
    localStorage.setItem(LS_KEY(pid), JSON.stringify(draft));
  } catch (e) {
    try {
      // 용량 초과 시 이미지/레퍼런스 데이터를 비우고 텍스트만 저장
      localStorage.setItem(LS_KEY(pid), JSON.stringify({ ...draft, briefImages: [], refItems: [] }));
    } catch {}
  }
};

/* ━━━━━ 모듈 레벨 Map — 탭 전환 시 성능용 캐시 ━━━━━ */
interface DraftState {
  briefText: string;
  ideaNote: string;
  briefImages: ImageItem[];
  refItems: RefItem[];
  pdfState: "idle" | "extracting" | "ready" | "error";
  pdfExtractedText: string;
  pdfFileName: string;
  pdfFileSize: number;
  pdfPageInfo: { pages: number; chars: number } | null;
}
const _draftByProject = new Map<string, DraftState>();

const getDefaultDraft = (): DraftState => ({
  briefText: "",
  ideaNote: "",
  briefImages: [],
  refItems: [],
  pdfState: "idle",
  pdfExtractedText: "",
  pdfFileName: "",
  pdfFileSize: 0,
  pdfPageInfo: null,
});

/* ━━━━━ 이미지 타입 (런타임용) ━━━━━ */
interface ImageItem {
  file?: File;
  base64: string;
  mediaType: string;
  preview: string;
}

/* ━━━━━ base64 → data URL 프리뷰 ━━━━━ */
const toDataUrl = (base64: string, mediaType: string) => `data:${mediaType};base64,${base64}`;

/* ━━━━━ localStorage → ImageItem 변환 ━━━━━ */
const fromSerializable = (imgs: SerializableImage[]): ImageItem[] =>
  imgs.map((img) => ({
    base64: img.base64,
    mediaType: img.mediaType,
    preview: toDataUrl(img.base64, img.mediaType),
  }));

/* ━━━━━ ImageItem → SerializableImage 변환 ━━━━━ */
const toSerializable = (imgs: ImageItem[]): SerializableImage[] =>
  imgs.map(({ base64, mediaType }) => ({ base64, mediaType }));

/* ━━━━━ Types ━━━━━ */
interface VisualDirectionStructured {
  camera: string;
  lighting: string;
  color_grade: string;
  editing: string;
}
interface SceneFlowStructured {
  structure: string;
  total_scenes: string;
  hook: { duration: string; description: string };
  body: { duration: string; description: string };
  cta: { duration: string; description: string };
}
interface UspItem {
  keyword: string;
  comparison: string;
}
interface DeepAnalysis {
  goal: {
    summary: string;
    items: string[];
    kpi_hint: string;
    core_message?: string;
    success_criteria?: string;
    desired_action?: string;
  };
  target: { summary: string; primary: string[]; insight: string; media_behavior: string };
  usp: { summary: string; items: string[] | UspItem[]; competitive_edge: string; message_hierarchy: string };
  tone_manner: {
    summary: string;
    keywords: string[];
    visual_direction: string | VisualDirectionStructured;
    reference_mood: string;
    do_not: string;
  };
  production_notes: {
    format_recommendation: string;
    shooting_style: string;
    scene_count_hint: string | SceneFlowStructured;
    budget_efficiency: string;
  };
  idea_note?: string;
  image_analysis?: string;
  creative_gap?: { synergy: string[]; gap: string[]; recommendation: string };

  // ── reference video insights (GPT-5.x only) ──
  reference_video_insights?: Array<{
    source: "youtube" | "upload";
    title?: string;
    hook_pattern?: string;
    pacing_per_scene?: Array<{ t: string; beat: string }>;
    visual_motifs?: string[];
    audio_cues?: string[];
    transferable_techniques?: string[];
    do_not_copy?: string[];
  }>;

  // ── v2 fields (all optional; populated when classifier runs) ──
  content_type?: ContentType;
  classification_confidence?: number;
  classification_reasoning?: string;
  secondary_type?: ContentType;

  product_info?: ProductInfo;
  hero_visual?: HeroVisual;
  hook_strategy?: HookStrategy;
  pacing?: Pacing;
  constraints?: Constraints;
  audience_insight?: AudienceInsight;
  abcd_compliance?: ABCDCompliance;
  narrative?: NarrativeAnalysis;
}
interface LegacyAnalysis {
  goal: string[];
  target: string[];
  usp: string[];
  tone_manner: string[];
}
type Analysis = DeepAnalysis | LegacyAnalysis;
function isDeepAnalysis(a: Analysis): a is DeepAnalysis {
  return a.goal && typeof a.goal === "object" && !Array.isArray(a.goal);
}
interface Brief {
  id: string;
  raw_text: string | null;
  analysis: Analysis | null;
  created_at: string;
  source_type: string | null;
  image_urls: string[] | null;
}
interface Props {
  projectId: string;
  onSwitchToAgent: (lang: "ko" | "en") => void;
  onSwitchToAssets?: () => void;
}

/* ━━━━━ Helpers ━━━━━ */
const fileToBase64 = (file: File): Promise<string> =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res((r.result as string).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

const DEEP_ANALYSIS_SYSTEM_PROMPT = `당신은 게임/프로모션 영상 제작을 돕는 시니어 CD 이자 Performance Creative 전문가입니다.
1인 프로듀서가 이 분석만으로 씬을 바로 짤 수 있도록, 마케팅 수사보다 "무엇을/언제/어떻게 노출할지"에 집중하세요.
기반 프레임워크: Meta Creative Best Practices · Google ABCD · Mobile UA Patterns.

═══ STAGE 1 — CONTENT TYPE CLASSIFICATION ═══
먼저 브리프를 읽고 5개 타입 중 하나로 분류하세요:

1. product_launch — 특정 인게임 상품/스킨/무기/번들/패스 출시·판매
2. event — 기간 한정 이벤트·시즌·토너먼트·콜라보·보상
3. update — 패치/신규 맵/밸런스/기능 업데이트 안내
4. community — 크리에이터·UGC·스트리머·플레이어 토너먼트 중심
5. brand_film — 세계관/철학/감성 서사 중심, 직접 판매 CTA 없음

분류 기준:
- 브리프에 "출시/런칭/구매/스킨/한정/번들" → product_launch
- "이벤트/시즌/한정 기간/보상/콜라보" → event
- "업데이트/패치/신규 맵/밸런스" → update
- "크리에이터/UGC/스트리머/토너먼트" → community
- "브랜드 필름/세계관/철학/감동/스토리" 명시 + 길이 45초 이상 → brand_film

content_type 결정 후, classification_confidence (0.0–1.0), classification_reasoning (1문장) 을 함께 기록하세요.
confidence < 0.6 이면 secondary_type 도 추가 제시.

═══ STAGE 2 — TEMPLATE SELECTION ═══
- content_type ∈ { product_launch, event, update, community } → Performance Creative 템플릿 (기본)
- content_type === "brand_film" → Narrative Creative 추가 블록(narrative) 포함

═══ OUTPUT JSON SCHEMA (반드시 이 형식만) ═══

공통 + Performance 필드 (항상 포함):
{
  "content_type": "product_launch | event | update | community | brand_film",
  "classification_confidence": 0.85,
  "classification_reasoning": "브리프에 'WSUS 411 한정 스킨' 3회 언급, 판매 목적 명확",
  "secondary_type": "event",

  "goal": { "summary": "…", "items": ["…","…","…"], "kpi_hint": "…", "core_message": "15단어 이내 태그라인", "success_criteria": "수치 2-3개", "desired_action": "단계1 → 단계2 → 단계3" },
  "target": { "summary": "…", "primary": ["…","…","…"], "insight": "페인포인트", "media_behavior": "미디어 행동" },
  "audience_insight": { "pain_point": "이전 WSUS 시리즈를 놓친 경험", "motivation": "한정 희소성 + FOMO" },
  "usp": { "summary": "…", "items": [{"keyword":"2-4단어","comparison":"…"}], "competitive_edge": "…", "message_hierarchy": "1순위 → 2순위 → 3순위" },
  "tone_manner": { "summary": "…", "keywords": ["…","…","…","…"], "visual_direction": {"camera":"…","lighting":"…","color_grade":"…","editing":"…"}, "reference_mood": "…", "do_not": "…" },
  "production_notes": { "format_recommendation": "…", "shooting_style": "…", "scene_count_hint": {"structure":"HOOK → BODY → CTA","total_scenes":"3-5개 씬","hook":{"duration":"…","description":"…"},"body":{"duration":"…","description":"…"},"cta":{"duration":"…","description":"…"}}, "budget_efficiency": "…" },

  "product_info": {
    "what": "구체적 상품/이벤트명 (예: WSUS 411 한정 스킨)",
    "key_benefit": "핵심 혜택 1문장 (예: 출시 기념 30% 할인)",
    "urgency": {"type":"time_limited|quantity_limited|exclusive|none","description":"3월 31일까지 등"},
    "cta_destination": "인게임 상점 > 스킨 탭 같은 구체 경로",
    "cta_action": "지금 구매하기 같은 동사형 구체 문구"
  },

  "hero_visual": {
    "must_show": ["반드시 노출할 시각 요소 3개"],
    "first_frame": "첫 프레임에 등장할 시각 요소의 구체 묘사",
    "brand_reveal_timing": "0-3s | 3-5s",
    "product_reveal_timing": "0-3s | 3-5s | 5-10s",
    "logo_placement": "first_frame | last_frame | persistent_corner"
  },

  "hook_strategy": {
    "primary": "gameplay_first | fail_solve | power_fantasy | unboxing_reveal | before_after | mystery_tease | testimonial | pattern_interrupt",
    "alternatives": ["대안 Hook 타입 2개"],
    "first_3s_description": "첫 3초에 실제로 일어날 일 구체 묘사 (무엇이 보이고, 어떤 소리/동작)",
    "pattern_interrupt": true
  },

  "pacing": {
    "format": "9:16 | 16:9 | 1:1 | 4:5",
    "duration": "6s | 15s | 30s | 45s | 60s",
    "scene_count": {"min":3,"max":5,"recommended":4},
    "edit_rhythm": "fast | medium | slow",
    "silent_viewable": true,
    "captions_required": true
  },

  "constraints": {
    "brand_guidelines": ["로고/컬러/폰트 규칙"],
    "avoid": ["피해야 할 표현·이미지 — 네거티브 프롬프트로 직결됨"],
    "platform_policies": ["YouTube/Meta/TikTok 플랫폼별 주의사항"]
  }
}

brand_film 인 경우에만 추가:
"narrative": {
  "controlling_idea": "마지막 씬이 전달할 단 하나의 감정",
  "story_structure": "hero_journey | before_after | vignette | demonstration",
  "protagonist": {"identity":"…","desire":"…","transformation":"…"},
  "emotional_beats": [{"timestamp":"0-5s","emotion":"호기심","intensity":5}]
}

아이디어 메모가 함께 제공된 경우 위 JSON에 추가:
"idea_note": "원본 메모",
"creative_gap": { "synergy": ["시너지 2~3개"], "gap": ["간극 (없으면 빈 배열)"], "recommendation": "CD 한마디 제언" }

═══ CRITICAL QUALITY RULES ═══

[hook_strategy.primary 선택 기준]
- unboxing_reveal: 스킨/아이템 판매(product_launch) 기본값
- power_fantasy: RPG·배틀 product_launch / event 에 강함
- before_after: update 필수 선택 (구버전 → 신버전 비교)
- mystery_tease: 티저성 event 에 최적
- testimonial: community / 이벤트 보상 체감 필요 시
- gameplay_first: 판단 어려울 때의 안전한 기본값
- fail_solve: 퍼즐/캐주얼 전용
- pattern_interrupt: 바이럴 지향·플랫폼 알고리즘 노출 극대화

[hero_visual.first_frame 규칙]
- 첫 프레임 자체가 움직임 또는 궁금증 유발을 포함해야 한다 (정적 로고컷 금지)
- product_launch / event 는 product_reveal_timing = "0-3s" 가 기본값
- brand_film 은 product_reveal_timing = "5-10s" 도 허용

[constraints.avoid 규칙]
- 반드시 네거티브 프롬프트 형태 (예: "logo-only first frame", "flat product shot without motion", "generic stock footage cliché")
- 최소 2개 이상 제공

[pacing.scene_count 자동 결정]
- 6s → 1~2 씬
- 15s → 3~4 씬 (recommended 4)
- 30s → 5~7 씬 (recommended 6)
- 45s → 7~10 씬 (recommended 8)
- 60s → 8~12 씬 (recommended 10)

[pacing.silent_viewable]
- 모바일·SNS (9:16, 1:1) 는 기본 true, captions_required = true
- YouTube 가로 (16:9) 는 false 허용

[product_info 규칙]
- what: 상품명은 브리프에서 그대로 추출 (추측 금지)
- cta_action: "지금 구매", "지금 다운로드", "참여하기" 같은 **동사 시작의 3-6자 짧은 문구**
- urgency.type === "none" 은 brand_film 외 허용 X

[visual_direction 4개 서브필드 의무]
- camera, lighting, color_grade, editing 각각 1-2 문장의 실무 지시어
- 추상적 "cinematic" 금지 → 실제 기법 (예: "handheld shaky cam at 120fps", "rim light from 45° back-left")

[reference_mood 작성 규칙]
- 장르 나열 금지. 시각/청각 디테일 2-3문장 센서리 묘사
- BAD: "다큐멘터리 현장감"
- GOOD: "라이브 스트림 채팅이 겹친 화면, 현장 사이렌+바람 소리 그대로의 무편집 오디오, 타임스탬프 오버레이"

[goal.core_message]
- 관객에게 던지는 15단어 이내 태그라인 (목표 설명 아님)

[goal.success_criteria]
- 수치 포함 2-3개 (예: "완주율 60% 이상, CTR 15% 이상")

[goal.desired_action]
- → 화살표로 연결한 2-3단계 퍼널

[usp.items]
- 각 item: { keyword: 2-4단어, comparison: "기존/경쟁 콘텐츠는 ~인데 이건 ~라서 다르다" 구체 비교 1문장 }
- 모호한 단어(현장감/사실성) 단독 금지

반드시 위 JSON 형식만 응답. JSON 외 텍스트 절대 포함 금지.`;

const LANG_DIRECTIVE_KO = `CRITICAL LANGUAGE RULE: ALL output fields must be written in Korean (한국어). This includes visual_direction (camera, lighting, color_grade, editing), reference_mood, scene_count_hint descriptions, usp comparisons, and every other text field. Do NOT mix English into Korean analysis. Only use English for proper nouns, technical terms (e.g. POV, HUD, CCTV), or universally understood abbreviations.\n\n`;
const LANG_DIRECTIVE_EN = `CRITICAL LANGUAGE RULE: ALL output fields must be written in English. Do NOT use Korean in any field.\n\n`;

/**
 * GPT-5.x 전용 추가 directive — JSON 강제 모드 (Chat Completions response_format=json_object)
 * 와 함께 쓰이지만, 모델이 가끔 빈 객체를 뱉을 위험을 줄이기 위해 시스템 프롬프트에서도
 * "stick to the schema, no extra keys" 를 명시한다.
 */
const GPT_DEEP_ANALYSIS_SUFFIX = `

[OUTPUT DISCIPLINE — GPT-5.x ONLY]
- Plan internally step by step, then output only valid JSON matching the schema above.
- No markdown fences. No commentary. No leading/trailing prose.
- Do NOT invent extra top-level keys. Optional keys may be omitted; required keys must be present.
- If reference video metadata or transcript is provided in the user message, you MUST also output a top-level "reference_video_insights" array with one object per reference, each shaped:
  { "source": "youtube"|"upload", "title": "...", "hook_pattern": "...",
    "pacing_per_scene": [{ "t": "0-3s", "beat": "..." }],
    "visual_motifs": ["..."], "audio_cues": ["..."],
    "transferable_techniques": ["..."], "do_not_copy": ["..."] }
- If no reference video is provided, omit the "reference_video_insights" key entirely.
`;

/**
 * 분석 결과 파서.
 *  - Claude 는 JSON 을 ```json``` 펜스로 감싸서 보낼 때가 있어 strip 처리.
 *  - GPT-5.x 는 response_format=json_object 가 보장되어 있어 그대로 parse.
 *  - 두 케이스 모두 안전하게 한 번에 처리.
 */
const parseDeepAnalysisJson = (text: string): DeepAnalysis => {
  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
  return JSON.parse(cleaned);
};

const analyzeBriefText = async (briefText: string, lang: Lang = "ko", modelId?: string): Promise<DeepAnalysis> => {
  const langDirective = lang === "en" ? LANG_DIRECTIVE_EN : LANG_DIRECTIVE_KO;
  const resolvedModel = modelId ?? getModel("brief");
  const meta = getModelMeta(resolvedModel, getSettingsCached());
  const isOpenAI = meta?.provider === "openai";
  const system = langDirective + DEEP_ANALYSIS_SYSTEM_PROMPT + (isOpenAI ? GPT_DEEP_ANALYSIS_SUFFIX : "");
  const result = await callLLM({
    model: resolvedModel,
    system,
    max_tokens: meta?.maxOutputTokens ?? 4500,
    response_format: isOpenAI ? "json_object" : undefined,
    messages: [{ role: "user", content: `다음 브리프를 분석해주세요:\n\n${briefText}` }],
  });
  return parseDeepAnalysisJson(result.text);
};

const analyzeBriefWithImages = async (
  images: Array<{ base64: string; mediaType: string }>,
  additionalText: string,
  lang: Lang = "ko",
  modelId?: string,
): Promise<DeepAnalysis> => {
  const langDirective = lang === "en" ? LANG_DIRECTIVE_EN : LANG_DIRECTIVE_KO;
  const resolvedModel = modelId ?? getModel("brief");
  const meta = getModelMeta(resolvedModel, getSettingsCached());
  const isOpenAI = meta?.provider === "openai";
  const system =
    langDirective +
    DEEP_ANALYSIS_SYSTEM_PROMPT +
    "\n\n이미지 안의 모든 시각적 정보를 빠짐없이 읽고 분석하세요." +
    (isOpenAI ? GPT_DEEP_ANALYSIS_SUFFIX : "");
  const content: Array<{ type: "text"; text: string } | { type: "image"; mediaType: string; dataBase64: string }> = [];
  images.forEach((img, i) => {
    content.push({ type: "image", mediaType: img.mediaType, dataBase64: img.base64 });
    if (images.length > 1) content.push({ type: "text", text: `위 이미지는 브리프 ${i + 1}번째 장면입니다.` });
  });
  content.push({
    type: "text",
    text: `이 이미지(들)는 광고 브리프입니다.${additionalText ? `\n\n추가 설명: ${additionalText}` : ""}`,
  });
  const result = await callLLM({
    model: resolvedModel,
    system,
    max_tokens: meta?.maxOutputTokens ?? 4500,
    response_format: isOpenAI ? "json_object" : undefined,
    messages: [{ role: "user", content }],
  });
  return parseDeepAnalysisJson(result.text);
};

/* ━━━━━ i18n 라벨 맵 ━━━━━ */
type Lang = "ko" | "en";
const L: Record<string, Record<Lang, string>> = {
  core_strategy: { ko: "핵심 전략", en: "Core Strategy" },
  production_guide: { ko: "제작 가이드", en: "Production Guide" },
  campaign_goal: { ko: "캠페인 목표", en: "Campaign Goal" },
  target: { ko: "타겟", en: "Target" },
  target_audience: { ko: "타겟 오디언스", en: "Target Audience" },
  usp: { ko: "USP · 핵심 차별점", en: "USP · Key Differentiator" },
  tone_manner: { ko: "톤앤매너", en: "Tone & Manner" },
  prod_notes: { ko: "제작 노트", en: "Prod Notes" },
  brief_idea_analysis: { ko: "브리프 × 아이디어 메모 분석", en: "Brief × Idea Memo Analysis" },
  kpi_hint: { ko: "KPI 힌트", en: "KPI Hint" },
  core_message: { ko: "핵심 메시지", en: "Core Message" },
  success_criteria: { ko: "성공 기준", en: "Success Criteria" },
  desired_action: { ko: "핵심 액션", en: "Desired Action" },
  psychological_insight: { ko: "심리적 인사이트", en: "Psychological Insight" },
  media_behavior: { ko: "미디어 행동", en: "Media Behavior" },
  competitive_edge: { ko: "경쟁 우위", en: "Competitive Edge" },
  visual_direction: { ko: "비주얼 방향", en: "Visual Direction" },
  reference_mood: { ko: "레퍼런스 무드", en: "Reference Mood" },
  do_not: { ko: "금지 사항", en: "Do Not" },
  format: { ko: "포맷", en: "Format" },
  shooting_style: { ko: "촬영 스타일", en: "Shooting Style" },
  scene_flow: { ko: "씬 흐름", en: "Scene Flow" },
  budget_efficiency: { ko: "예산 효율", en: "Budget Efficiency" },
  abcd_effectiveness: { ko: "ABCD 효과성 스코어", en: "ABCD Effectiveness Score" },
  abcd_design_checklist: { ko: "ABCD 설계 체크리스트", en: "ABCD Design Checklist" },
  abcd_measured_effectiveness: { ko: "ABCD 효과성 점검", en: "ABCD Effectiveness Check" },
  abcd_source_plan: { ko: "예측 · 브리프 설계 기반", en: "Predicted · plan-based" },
  abcd_source_scenes: { ko: "실측 · 씬 {n}개 반영", en: "Measured · {n} scenes applied" },
  abcd_preview_plan: {
    ko: "브리프 설계값을 기준으로 ABCD 4축이 얼마나 탄탄히 준비됐는지 예측합니다.",
    en: "Predicts ABCD 4-axis readiness from the current brief plan values.",
  },
  abcd_preview_scenes: {
    ko: "Agent 씬을 반영한 ABCD 4축 실측 점검 — 씬이 갱신되면 D축이 재계산됩니다.",
    en: "ABCD 4-axis check measured against Agent scenes — D-axis re-scores as scenes evolve.",
  },
  abcd_attract: { ko: "Attract · 첫 3초 몰입도", en: "Attract · First 3s Hook" },
  abcd_brand: { ko: "Brand · 브랜드·제품 노출", en: "Brand · Brand/Product Exposure" },
  abcd_connect: { ko: "Connect · 감정 연결", en: "Connect · Emotional Link" },
  abcd_direct: { ko: "Direct · CTA 명확성", en: "Direct · CTA Clarity" },
  abcd_total: { ko: "종합", en: "Total" },
  narrative_structure: { ko: "서사 구조 (브랜드 필름)", en: "Narrative Structure (Brand Film)" },
  controlling_idea: { ko: "Controlling Idea", en: "Controlling Idea" },
  protagonist: { ko: "주인공 · 욕망 · 변화", en: "Protagonist · Desire · Transformation" },
  emotional_beats: { ko: "감정 비트", en: "Emotional Beats" },
  content_type_label: { ko: "콘텐츠 유형", en: "Content Type" },
};

const CONTENT_TYPE_LABEL: Record<string, { ko: string; en: string; color: string }> = {
  product_launch: { ko: "상품 런칭", en: "Product Launch", color: "#f59e0b" },
  event: { ko: "이벤트", en: "Event", color: "#8b5cf6" },
  update: { ko: "업데이트", en: "Update", color: "#06b6d4" },
  community: { ko: "커뮤니티", en: "Community", color: "#10b981" },
  brand_film: { ko: "브랜드 필름", en: "Brand Film", color: "#f9423a" },
};
const t = (key: string, lang: Lang) => L[key]?.[lang] ?? key;

/* ━━━━━ UI 서브 컴포넌트 (Dark Theme) ━━━━━ */
const SectionCard = ({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) => (
  <div
    className={`bg-elevated border border-border overflow-hidden ${className}`}
    style={{ borderRadius: 0, ...style }}
  >
    {children}
  </div>
);

type DotVariant = "red" | "black" | "gray";

const SectionHeader = ({ dot, label }: { dot: DotVariant; label: string; tag?: string }) => (
  <div
    className="flex items-center gap-2 px-3 py-2.5 border-b border-border"
    style={{ background: dot === "red" ? "rgba(249,66,58,0.06)" : "rgba(255,255,255,0.02)" }}
  >
    <span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot === "red" ? "bg-primary" : dot === "black" ? "bg-foreground" : "bg-muted-foreground"}`}
    />
    <span className="text-[12px] font-bold uppercase tracking-wider text-foreground">{label}</span>
  </div>
);

const BulletList = ({ items, dot = "red" }: { items: string[]; dot?: "red" | "black" }) => (
  <ul className="space-y-1.5">
    {items.map((item, i) => (
      <li key={i} className="flex items-start gap-2 text-[13px] leading-relaxed text-muted-foreground">
        <span className={`w-1 h-1 rounded-full shrink-0 mt-[7px] ${dot === "red" ? "bg-primary" : "bg-foreground"}`} />
        {item}
      </li>
    ))}
  </ul>
);

const SubCard = ({ label, value }: { label: string; value: string }) => (
  <div className="bg-background/80 border border-border px-3 py-2.5" style={{ borderRadius: 0 }}>
    <p className="label-meta text-muted-foreground mb-1">{label}</p>
    <div className="text-[13px] leading-relaxed text-foreground/80 space-y-1">
      {value
        .split(/(?<=[.。!?])\s+/)
        .filter((s) => s.trim())
        .map((sentence, i) => (
          <p key={i}>{sentence.trim()}</p>
        ))}
    </div>
  </div>
);

const CreativeGapSection = ({
  gap,
  lang = "ko",
  onUpdate,
}: {
  gap: DeepAnalysis["creative_gap"];
  lang?: Lang;
  onUpdate?: OnFieldUpdate;
}) => {
  if (!gap) return null;
  return (
    <SectionCard>
      <SectionHeader dot="gray" label={t("brief_idea_analysis", lang)} />
      <div className="px-3 py-2.5 space-y-2">
        {gap.synergy.map((s, i) => (
          <div key={i} className="flex items-start gap-2 text-[13px] leading-relaxed text-emerald-400">
            <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {onUpdate ? (
              <EditableText
                value={s}
                onSave={(v) => onUpdate(["creative_gap", "synergy", String(i)], v)}
                className="flex-1 text-[13px] leading-relaxed text-emerald-400"
              />
            ) : (
              s
            )}
          </div>
        ))}
        {gap.gap.map((g, i) => (
          <div key={i} className="flex items-start gap-2 text-[13px] leading-relaxed text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {onUpdate ? (
              <EditableText
                value={g}
                onSave={(v) => onUpdate(["creative_gap", "gap", String(i)], v)}
                className="flex-1 text-[13px] leading-relaxed text-amber-400"
              />
            ) : (
              g
            )}
          </div>
        ))}
        {gap.recommendation && (
          <div className="border-l-2 border-primary/40 pl-3 mt-2">
            {onUpdate ? (
              <EditableText
                value={gap.recommendation}
                onSave={(v) => onUpdate(["creative_gap", "recommendation"], v)}
                className="text-[13px] text-muted-foreground leading-relaxed italic"
              />
            ) : (
              <p className="text-[13px] text-muted-foreground leading-relaxed italic">"{gap.recommendation}"</p>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
};

/* ━━━━━ Collapsible Section ━━━━━ */
const CollapsibleSection = ({
  title,
  preview,
  defaultOpen = false,
  children,
}: {
  title: string;
  preview?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 py-1.5 text-left group">
        <ChevronDown
          className={`w-3 h-3 text-muted-foreground/50 transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
        />
        <span className="label-meta text-primary">{title}</span>
        {!open && preview && (
          <span className="text-[10px] text-muted-foreground/40 truncate flex-1 ml-1">{preview}</span>
        )}
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ${open ? "max-h-[2000px] opacity-100 mt-1.5" : "max-h-0 opacity-0"}`}
      >
        {children}
      </div>
    </div>
  );
};

/* ━━━━━ Section heading helpers ━━━━━ */
const Heading1 = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center gap-2.5 mt-8 first:mt-0 mb-4">
    <span className="w-[3px] self-stretch bg-primary" style={{ borderRadius: 0 }} />
    <span className="text-[15px] font-bold text-primary tracking-wide">{children}</span>
  </div>
);

const Heading2 = ({ children, tag }: { children: React.ReactNode; tag?: string }) => (
  <div className="flex items-center gap-2 mb-2">
    <span className="text-[14px] font-semibold text-foreground">{children}</span>
    {tag && (
      <span
        className="ml-auto font-mono text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider"
        style={{
          borderRadius: 0,
          background: "rgba(255,255,255,0.06)",
          color: "rgba(255,255,255,0.4)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {tag}
      </span>
    )}
  </div>
);

const Label3 = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[12px] font-medium uppercase tracking-[0.5px] mb-1" style={{ color: "#666" }}>
    {children}
  </p>
);

/* ━━━━━ EditableText — inline editing component ━━━━━ */
type OnFieldUpdate = (path: string[], newValue: any) => void;

const EditableText = ({
  value,
  onSave,
  multiline,
  placeholder,
  className: extraClass = "",
  style: extraStyle,
  syncing,
}: {
  value: string;
  onSave: (newValue: string) => void;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  syncing?: boolean;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const clickOffsetRef = useRef<number | null>(null);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      if (clickOffsetRef.current !== null) {
        const pos = Math.min(clickOffsetRef.current, ref.current.value.length);
        ref.current.setSelectionRange(pos, pos);
        clickOffsetRef.current = null;
      } else {
        const len = ref.current.value.length;
        ref.current.setSelectionRange(len, len);
      }
    }
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  if (!editing) {
    const displayContent = (() => {
      if (!value) return <span style={{ color: "#555", fontStyle: "italic" }}>{placeholder || "—"}</span>;
      if (!multiline) return value;
      const sentences = value.split(/(?<=[.。!?])\s+|\n/).filter((s: string) => s.trim());
      if (sentences.length <= 1) return value;
      return (
        <span className="flex flex-col gap-1">
          {sentences.map((s: string, i: number) => (
            <span key={i}>{s.trim()}</span>
          ))}
        </span>
      );
    })();
    return (
      <span
        onClick={() => {
          const sel = window.getSelection();
          clickOffsetRef.current = sel?.focusOffset ?? value.length;
          setDraft(value);
          setEditing(true);
        }}
        className={`cursor-text transition-colors duration-150 ${extraClass}`}
        style={{
          ...extraStyle,
          borderRadius: 0,
          display: multiline ? "block" : "inline",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }}
        title="Click to edit"
      >
        {displayContent}
        {syncing && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#f9423a",
              animation: "pulse 1s infinite",
              marginLeft: 4,
              display: "inline-block",
              verticalAlign: "middle",
            }}
          />
        )}
      </span>
    );
  }
  const handleCommit = () => {
    setEditing(false);
    if (draft.trim() !== value) {
      onSave(draft.trim());
      sonnerToast("Saved", { duration: 1000 });
    }
  };

  if (multiline) {
    return (
      <textarea
        ref={ref as React.RefObject<HTMLTextAreaElement>}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleCommit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className={extraClass}
        style={{
          ...extraStyle,
          width: "100%",
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(249,66,58,0.3)",
          borderRadius: 0,
          padding: "4px 8px",
          color: "#fff",
          outline: "none",
          resize: "vertical",
          minHeight: 60,
          fontFamily: "inherit",
          fontSize: "inherit",
          lineHeight: "inherit",
        }}
      />
    );
  }

  return (
    <input
      ref={ref as React.RefObject<HTMLInputElement>}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={handleCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") handleCommit();
        if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
      className={extraClass}
      style={{
        ...extraStyle,
        width: "100%",
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(249,66,58,0.3)",
        borderRadius: 0,
        padding: "4px 8px",
        color: "#fff",
        outline: "none",
        fontFamily: "inherit",
        fontSize: "inherit",
        lineHeight: "inherit",
      }}
    />
  );
};

/* ━━━━━ Deep-set utility ━━━━━ */
function deepSet(obj: any, path: string[], value: any): any {
  const result = structuredClone(obj);
  let target = result;
  for (let i = 0; i < path.length - 1; i++) {
    target = target[path[i]];
  }
  target[path[path.length - 1]] = value;
  return result;
}

/* ━━━━━ Reorder array sync (no translation needed) ━━━━━ */
function reorderArraySync(targetLang: any, sourceLang: any, path: string[], newArray: any[]): any {
  const result = structuredClone(targetLang);
  let target = result;
  for (let i = 0; i < path.length - 1; i++) target = target[path[i]];

  const oldTargetArray = target[path[path.length - 1]] || [];

  let oldSource = sourceLang;
  for (const p of path) oldSource = oldSource?.[p];

  if (Array.isArray(newArray) && Array.isArray(oldTargetArray)) {
    const reordered = newArray.map((item, i) => {
      const origIdx = oldSource?.findIndex?.((old: any) => JSON.stringify(old) === JSON.stringify(item));
      return origIdx >= 0 && origIdx < oldTargetArray.length ? oldTargetArray[origIdx] : oldTargetArray[i] || item;
    });
    target[path[path.length - 1]] = reordered;
  }

  return result;
}

/* ━━━━━ SortableUspItem — draggable USP card ━━━━━ */
const SortableUspCard = ({
  item,
  index,
  onUpdate,
  basePath,
}: {
  item: UspItem;
  index: number;
  onUpdate?: OnFieldUpdate;
  basePath: string[];
}) => {
  const noLayoutAnimation: AnimateLayoutChanges = () => false;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `usp-${index}`,
    animateLayoutChanges: noLayoutAnimation,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? transition : undefined,
    opacity: isDragging ? 0.7 : 1,
    borderRadius: 0,
    ...(index === 0
      ? {
          background: "rgba(249,66,58,0.08)",
          border: isDragging ? "1px solid rgba(249,66,58,0.5)" : "1px solid rgba(249,66,58,0.2)",
        }
      : {
          background: "rgba(255,255,255,0.03)",
          border: isDragging ? "1px solid rgba(249,66,58,0.5)" : "1px solid rgba(255,255,255,0.06)",
        }),
  };

  return (
    <div ref={setNodeRef} style={style} className="px-3 py-3">
      <div className="flex items-start gap-2.5">
        <span
          {...attributes}
          {...listeners}
          className="w-5 h-5 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 cursor-grab active:cursor-grabbing group relative"
          style={{
            borderRadius: 0,
            background: index === 0 ? "#f9423a" : index === 1 ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.08)",
            color: index === 0 ? "#fff" : "rgba(255,255,255,0.5)",
          }}
        >
          {index + 1}
          <GripVertical
            className="w-3 h-3 absolute opacity-0 group-hover:opacity-60 transition-opacity"
            style={{ color: "currentColor" }}
          />
        </span>
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          {onUpdate ? (
            <>
              <EditableText
                value={item.keyword}
                onSave={(v) => onUpdate([...basePath, String(index), "keyword"], v)}
                className="text-[13px] leading-snug font-semibold"
                style={{ color: index === 0 ? "#f0f0f0" : "rgba(255,255,255,0.6)" }}
              />
              {item.comparison && (
                <EditableText
                  value={item.comparison}
                  onSave={(v) => onUpdate([...basePath, String(index), "comparison"], v)}
                  multiline
                  className="text-[12px] leading-[1.6]"
                  style={{ color: "#999", paddingLeft: 0 }}
                />
              )}
            </>
          ) : (
            <>
              <span
                className="text-[13px] leading-snug font-semibold"
                style={{ color: index === 0 ? "#f0f0f0" : "rgba(255,255,255,0.6)" }}
              >
                {item.keyword}
              </span>
              {item.comparison && (
                <p className="text-[12px] leading-[1.6]" style={{ color: "#999" }}>
                  {item.comparison}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const AccordionCard = ({
  index,
  title,
  preview,
  isOpen,
  onToggle,
  children,
}: {
  index: number;
  title: string;
  preview: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) => (
  <div
    className="transition-all duration-200"
    style={{
      background: isOpen ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.02)",
      border: `1px solid ${isOpen ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)"}`,
      borderRadius: 0,
      marginBottom: 8,
    }}
  >
    <div
      onClick={onToggle}
      className="flex items-center justify-between cursor-pointer select-none"
      style={{ padding: "14px 14px 6px" }}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="w-[22px] h-[22px] flex items-center justify-center text-[11px] font-bold text-white shrink-0"
          style={{ borderRadius: "50%", background: "#f9423a" }}
        >
          {index}
        </span>
        <span className="text-[16px] font-bold text-foreground">{title}</span>
      </div>
      <ChevronDown
        className="w-3.5 h-3.5 transition-transform duration-200"
        style={{ color: "#666", transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
      />
    </div>
    <div
      className="text-xs text-muted-foreground my-0 mx-0 py-[20px] px-[45px] pt-0"
      style={{ paddingBottom: isOpen ? "14px" : "10px", lineHeight: 1.4 }}
    >
      {preview}
    </div>
    <div
      className="transition-all duration-300"
      style={{
        overflow: "hidden",
        maxHeight: isOpen ? 2000 : 0,
        opacity: isOpen ? 1 : 0,
        transition: "max-height 300ms ease-in-out, opacity 200ms ease-in-out",
      }}
    >
      <div
        style={{
          padding: "14px 14px 14px",
          borderTop: "1px solid rgba(255,255,255,0.05)",
          marginTop: 2,
        }}
      >
        {children}
      </div>
    </div>
  </div>
);

/* ━━━━━ CoreStrategyUI — center column ━━━━━ */
const CoreStrategyUI = ({
  analysis,
  lang = "ko",
  onUpdate,
}: {
  analysis: DeepAnalysis;
  lang?: Lang;
  onUpdate?: OnFieldUpdate;
}) => {
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const toggleSection = (key: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const isStrategyOpen = openSections.has("strategy");
  const isDirectionOpen = openSections.has("direction");
  const isAbcdOpen = openSections.has("abcd");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleUspDragEnd = (event: any) => {
    const { active, over } = event;
    if (!active || !over || active.id === over.id || !onUpdate) return;
    const items = analysis.usp.items;
    if (!items.length || typeof items[0] !== "object") return;
    const oldIndex = parseInt((active.id as string).replace("usp-", ""));
    const newIndex = parseInt((over.id as string).replace("usp-", ""));
    const reordered = arrayMove(items as UspItem[], oldIndex, newIndex);
    onUpdate(["usp", "items"], reordered as any);
  };

  const directionPreview =
    lang === "ko" ? "비주얼 방향 · 레퍼런스 무드 · 씬 흐름" : "Visual Direction · Reference Mood · Scene Flow";

  const strategyPreview =
    lang === "ko" ? "캠페인 목표 · 타겟 · USP · 메모 분석" : "Campaign Goal · Target · USP · Memo Analysis";

  const abcdPreview = t("abcd_preview_plan", lang);
  const abcdTitle = t("abcd_design_checklist", lang);

  const E = (
    path: string[],
    value: string,
    opts?: { multiline?: boolean; className?: string; style?: React.CSSProperties },
  ) => {
    if (!onUpdate) {
      return (
        <span className={opts?.className} style={opts?.style}>
          {value}
        </span>
      );
    }
    return (
      <EditableText
        value={value}
        onSave={(v) => onUpdate(path, v)}
        multiline={opts?.multiline}
        className={opts?.className || ""}
        style={opts?.style}
      />
    );
  };

  const EditableBulletList = ({
    items,
    basePath,
    dot = "red",
  }: {
    items: string[];
    basePath: string[];
    dot?: "red" | "black";
  }) => (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-[13px] leading-relaxed text-muted-foreground">
          <span
            className={`w-1 h-1 rounded-full shrink-0 mt-[7px] ${dot === "red" ? "bg-primary" : "bg-foreground"}`}
          />
          {onUpdate ? (
            <EditableText
              value={item}
              onSave={(v) => onUpdate([...basePath, String(i)], v)}
              className="flex-1 text-[13px] leading-relaxed text-muted-foreground"
            />
          ) : (
            item
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <div>
      <div className="px-1 mb-6">
        {analysis.content_type && CONTENT_TYPE_LABEL[analysis.content_type] && (
          <div className="mb-2">
            <span
              className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5"
              title={analysis.classification_reasoning ?? ""}
              style={{
                borderRadius: 0,
                background: `${CONTENT_TYPE_LABEL[analysis.content_type].color}15`,
                color: CONTENT_TYPE_LABEL[analysis.content_type].color,
                border: `1px solid ${CONTENT_TYPE_LABEL[analysis.content_type].color}40`,
              }}
            >
              {CONTENT_TYPE_LABEL[analysis.content_type][lang]}
              {typeof analysis.classification_confidence === "number" &&
                ` · ${Math.round(analysis.classification_confidence * 100)}%`}
            </span>
          </div>
        )}
        {E(["goal", "summary"], analysis.goal.summary, {
          className: "text-[22px] font-bold text-foreground leading-tight tracking-tight",
        })}
        <div className="mt-2">
          {E(["usp", "summary"], analysis.usp.summary, {
            className: "text-[13px] text-muted-foreground leading-relaxed",
          })}
        </div>
      </div>

      <AccordionCard
        index={1}
        title={t("core_strategy", lang)}
        preview={strategyPreview}
        isOpen={isStrategyOpen}
        onToggle={() => toggleSection("strategy")}
      >
        <div className="grid gap-4 items-stretch" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <SectionCard className="w-full flex flex-col">
            <SectionHeader dot="red" label={t("campaign_goal", lang)} tag="GOAL" />
            <div className="px-3 py-3 flex-1 space-y-2.5">
              <EditableBulletList items={analysis.goal.items} basePath={["goal", "items"]} dot="red" />
              {analysis.goal.core_message && (
                <div
                  className="rounded-none px-3 py-2.5"
                  style={{ background: "rgba(249,66,58,0.06)", border: "1px solid rgba(249,66,58,0.15)" }}
                >
                  <span className="text-[11px] font-medium inline-flex items-center gap-1.5" style={{ color: "#888" }}>
                    <MessageSquare className="w-3 h-3" /> {t("core_message", lang)}
                  </span>
                  <div className="mt-1">
                    {E(["goal", "core_message"], analysis.goal.core_message, {
                      className: "text-[13px] text-foreground/90 font-medium leading-relaxed",
                    })}
                  </div>
                </div>
              )}
              {analysis.goal.success_criteria && (
                <div
                  className="rounded-none px-3 py-2.5"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <span className="text-[11px] font-medium inline-flex items-center gap-1.5" style={{ color: "#888" }}>
                    <Target className="w-3 h-3" /> {t("success_criteria", lang)}
                  </span>
                  <div className="mt-1">
                    {E(["goal", "success_criteria"], analysis.goal.success_criteria, {
                      multiline: true,
                      className: "text-[13px] text-foreground/80 leading-relaxed",
                    })}
                  </div>
                </div>
              )}
              {analysis.goal.desired_action && (
                <div
                  className="rounded-none px-3 py-2.5"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <span className="text-[11px] font-medium" style={{ color: "#888" }}>
                    ▶ {t("desired_action", lang)}
                  </span>
                  <div className="mt-1">
                    {E(["goal", "desired_action"], analysis.goal.desired_action, {
                      className: "text-[13px] text-foreground/80 leading-relaxed",
                    })}
                  </div>
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard className="w-full flex flex-col">
            <SectionHeader dot="black" label={t("target", lang)} tag="TARGET" />
            <div className="px-3 py-3 space-y-2 flex-1">
              {E(["target", "summary"], analysis.target.summary, {
                className: "text-[13px] font-medium text-muted-foreground",
              })}
              <EditableBulletList items={analysis.target.primary} basePath={["target", "primary"]} dot="black" />
              <div className="bg-background/80 border border-border px-3 py-2.5" style={{ borderRadius: 0 }}>
                <Label3>{t("psychological_insight", lang)}</Label3>
                {E(["target", "insight"], analysis.target.insight, {
                  multiline: true,
                  className: "text-[13px] leading-relaxed text-foreground/80",
                })}
              </div>
              <div className="bg-background/80 border border-border px-3 py-2.5" style={{ borderRadius: 0 }}>
                <Label3>{t("media_behavior", lang)}</Label3>
                {E(["target", "media_behavior"], analysis.target.media_behavior, {
                  multiline: true,
                  className: "text-[13px] leading-relaxed text-foreground/80",
                })}
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="border-t mt-5 pt-4" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
          <SectionCard className="w-full">
            <SectionHeader dot="red" label={t("usp", lang)} tag="USP" />
            <div className="px-3 py-3 space-y-1.5" style={{ gap: 6 }}>
              {(() => {
                const items = analysis.usp.items;
                const isStructured = items.length > 0 && typeof items[0] === "object";
                if (isStructured && onUpdate) {
                  return (
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleUspDragEnd}>
                      <SortableContext
                        items={(items as UspItem[]).map((_, i) => `usp-${i}`)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="flex flex-col" style={{ gap: 6 }}>
                          {(items as UspItem[]).map((item, i) => (
                            <SortableUspCard
                              key={`usp-${i}`}
                              item={item}
                              index={i}
                              onUpdate={onUpdate}
                              basePath={["usp", "items"]}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                  );
                }
                if (isStructured) {
                  return (
                    <div className="flex flex-col" style={{ gap: 6 }}>
                      {(items as UspItem[]).map((item, i) => (
                        <div
                          key={i}
                          className="px-3 py-2"
                          style={{
                            borderRadius: 0,
                            ...(i === 0
                              ? { background: "rgba(249,66,58,0.08)", border: "1px solid rgba(249,66,58,0.2)" }
                              : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }),
                          }}
                        >
                          <div className="flex items-start gap-2.5">
                            <span
                              className="w-5 h-5 flex items-center justify-center text-[10px] font-bold shrink-0 mt-px"
                              style={{
                                borderRadius: 0,
                                background:
                                  i === 0 ? "#f9423a" : i === 1 ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.08)",
                                color: i === 0 ? "#fff" : "rgba(255,255,255,0.5)",
                              }}
                            >
                              {i + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <span
                                className="text-[13px] leading-relaxed font-semibold"
                                style={{ color: i === 0 ? "#f0f0f0" : "rgba(255,255,255,0.6)" }}
                              >
                                {item.keyword}
                              </span>
                              {item.comparison && (
                                <p className="text-[13px] leading-[1.5] mt-1" style={{ color: "#888" }}>
                                  {item.comparison}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                }
                return <BulletList items={items as string[]} dot="red" />;
              })()}
              {analysis.usp.competitive_edge && (
                <div className="pt-1">
                  <div className="bg-background/80 border border-border px-3 py-2.5" style={{ borderRadius: 0 }}>
                    <Label3>{t("competitive_edge", lang)}</Label3>
                    {E(["usp", "competitive_edge"], analysis.usp.competitive_edge, {
                      className: "text-[13px] leading-relaxed text-foreground/80",
                    })}
                  </div>
                </div>
              )}
            </div>
          </SectionCard>
        </div>

        {analysis.creative_gap && (
          <div className="border-t mt-5 pt-4" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
            <CreativeGapSection gap={analysis.creative_gap} lang={lang} onUpdate={onUpdate} />
          </div>
        )}
      </AccordionCard>

      <AccordionCard
        index={2}
        title={lang === "ko" ? "연출 가이드" : "Direction Guide"}
        preview={directionPreview}
        isOpen={isDirectionOpen}
        onToggle={() => toggleSection("direction")}
      >
        <Heading2>{t("visual_direction", lang)}</Heading2>
        {typeof analysis.tone_manner.visual_direction === "string" ? (
          <SubCard label={t("visual_direction", lang)} value={analysis.tone_manner.visual_direction} />
        ) : (
          <div className="grid grid-cols-2 gap-3 mb-6">
            {(
              [
                { Icon: Camera, label: lang === "ko" ? "카메라" : "Camera", key: "camera" as const },
                { Icon: Lightbulb, label: lang === "ko" ? "조명" : "Lighting", key: "lighting" as const },
                { Icon: Palette, label: lang === "ko" ? "색감" : "Color", key: "color_grade" as const },
                { Icon: Scissors, label: lang === "ko" ? "편집" : "Editing", key: "editing" as const },
              ] as const
            ).map(({ Icon, label: cellLabel, key }) => (
              <div key={key} className="px-3 py-3" style={{ borderRadius: 0, background: "rgba(255,255,255,0.03)" }}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Icon className="w-3 h-3 text-foreground/60" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-foreground/60">{cellLabel}</span>
                </div>
                {E(
                  ["tone_manner", "visual_direction", key],
                  (analysis.tone_manner.visual_direction as VisualDirectionStructured)[key],
                  {
                    multiline: true,
                    className: "text-[13px] text-foreground/70 leading-relaxed",
                  },
                )}
              </div>
            ))}
          </div>
        )}

        {analysis.tone_manner.reference_mood && (
          <div className="mb-6">
            <Heading2>{t("reference_mood", lang)}</Heading2>
            <div className="bg-background/80 border border-border px-3 py-2.5" style={{ borderRadius: 0 }}>
              {E(["tone_manner", "reference_mood"], analysis.tone_manner.reference_mood, {
                multiline: true,
                className: "text-[13px] leading-relaxed text-foreground/80",
              })}
            </div>
          </div>
        )}

        <Heading2>{t("scene_flow", lang)}</Heading2>
        <div className="bg-background/80 border border-border px-3 py-2.5" style={{ borderRadius: 0 }}>
          <div className="flex items-start mb-3">
            {(["Hook", "Body", "CTA"] as const).map((step, i) => (
              <div key={step} className="flex-1 relative">
                {i < 2 && <div className="absolute top-[6px] left-1/2 w-full h-px bg-border" />}
                <div className="flex flex-col items-center gap-1.5 relative z-10">
                  <div
                    className="w-3 h-3 border-2 border-background"
                    style={{ borderRadius: 0, background: i === 1 ? "rgba(255,255,255,0.2)" : "#f9423a" }}
                  />
                  <span
                    className="font-mono text-[10px] font-bold uppercase"
                    style={{ color: i === 1 ? "rgba(255,255,255,0.3)" : "#f9423a" }}
                  >
                    {step}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {typeof analysis.production_notes.scene_count_hint === "string" ? (
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              {analysis.production_notes.scene_count_hint}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {(["hook", "body", "cta"] as const).map((key) => {
                const section = (analysis.production_notes.scene_count_hint as SceneFlowStructured)[key];
                return (
                  <div
                    key={key}
                    className="px-3 py-3"
                    style={{ borderRadius: 0, background: "rgba(255,255,255,0.03)" }}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="font-mono text-[12px] font-semibold" style={{ color: "#f9423a" }}>
                        {key.toUpperCase()}
                      </span>
                      {E(["production_notes", "scene_count_hint", key, "duration"], section.duration, {
                        className: "text-[11px]",
                        style: { color: "#666" },
                      })}
                    </div>
                    {E(["production_notes", "scene_count_hint", key, "description"], section.description, {
                      multiline: true,
                      className: "text-[13px] leading-[1.5]",
                      style: { color: "#aaa" },
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </AccordionCard>

      <AccordionCard
        index={3}
        title={abcdTitle}
        preview={abcdPreview}
        isOpen={isAbcdOpen}
        onToggle={() => toggleSection("abcd")}
      >
        <AbcdSlideContent analysis={analysis} lang={lang} />
      </AccordionCard>
    </div>
  );
};

/* ━━━━━ SlideUspContent — USP with DnD for slide view ━━━━━ */
const SlideUspContent = ({
  analysis,
  lang,
  onUpdate,
}: {
  analysis: DeepAnalysis;
  lang: Lang;
  onUpdate?: OnFieldUpdate;
}) => {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const items = analysis.usp.items;
  const isStructured = items.length > 0 && typeof items[0] === "object";

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (!active || !over || active.id === over.id || !onUpdate) return;
    if (!isStructured) return;
    const oldIndex = parseInt((active.id as string).replace("usp-", ""));
    const newIndex = parseInt((over.id as string).replace("usp-", ""));
    const reordered = arrayMove(items as UspItem[], oldIndex, newIndex);
    onUpdate(["usp", "items"], reordered as any);
  };

  return (
    <div className="space-y-4">
      {isStructured && onUpdate ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={(items as UspItem[]).map((_, i) => `usp-${i}`)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col" style={{ gap: 6 }}>
              {(items as UspItem[]).map((item, i) => (
                <SortableUspCard
                  key={`usp-${i}`}
                  item={item}
                  index={i}
                  onUpdate={onUpdate}
                  basePath={["usp", "items"]}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : isStructured ? (
        <div className="flex flex-col gap-3">
          {(items as UspItem[]).map((item, i) => (
            <div
              key={i}
              className="px-4 py-3"
              style={{
                borderRadius: 0,
                ...(i === 0
                  ? { background: "rgba(249,66,58,0.08)", border: "1px solid rgba(249,66,58,0.2)" }
                  : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }),
              }}
            >
              <div className="flex items-start gap-3">
                <span
                  className="w-6 h-6 flex items-center justify-center text-[11px] font-bold shrink-0"
                  style={{
                    borderRadius: 0,
                    background: i === 0 ? "#f9423a" : "rgba(255,255,255,0.12)",
                    color: i === 0 ? "#fff" : "rgba(255,255,255,0.5)",
                  }}
                >
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                  <span className="text-[13px] leading-snug font-semibold">{item.keyword}</span>
                  {item.comparison && (
                    <p className="text-[12px] leading-[1.6]" style={{ color: "#999" }}>
                      {item.comparison}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <BulletList items={items as string[]} dot="red" />
      )}
      {analysis.usp.competitive_edge &&
        (onUpdate ? (
          <div className="bg-background/80 border border-border px-3 py-2.5" style={{ borderRadius: 0 }}>
            <Label3>{t("competitive_edge", lang)}</Label3>
            <EditableText
              value={analysis.usp.competitive_edge}
              onSave={(v) => onUpdate(["usp", "competitive_edge"], v)}
              className="text-[13px] leading-relaxed text-foreground/80"
            />
          </div>
        ) : (
          <SubCard label={t("competitive_edge", lang)} value={analysis.usp.competitive_edge} />
        ))}
    </div>
  );
};

/* ━━━━━ SlideViewUI — 7-slide carousel for analysis ━━━━━ */
type SlideGroup = "core" | "direction" | "abcd";

interface SlideDefinition {
  title: string;
  badge: string;
  group: SlideGroup;
  render: (analysis: DeepAnalysis, lang: Lang, onUpdate?: OnFieldUpdate) => React.ReactNode;
  /** optional predicate — if present and returns false, slide is filtered out */
  show?: (analysis: DeepAnalysis) => boolean;
}

const SLIDE_GROUP_LABEL: Record<SlideGroup, { ko: string; en: string; color: string; bg: string }> = {
  core: { ko: "핵심 전략", en: "Core Strategy", color: "#f9423a", bg: "rgba(249,66,58,0.08)" },
  direction: { ko: "연출 가이드", en: "Direction Guide", color: "#888", bg: "rgba(255,255,255,0.04)" },
  abcd: { ko: "효과성 검증", en: "Effectiveness Check", color: "#10b981", bg: "rgba(16,185,129,0.10)" },
};

const SLIDE_DEFS: ((lang: Lang) => SlideDefinition)[] = [
  (lang) => ({
    title: t("campaign_goal", lang),
    badge: "GOAL",
    group: "core",
    render: (a, l, onU) => (
      <div className="space-y-4">
        <ul className="space-y-1.5">
          {a.goal.items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px] leading-relaxed text-muted-foreground">
              <span className="w-1 h-1 rounded-full shrink-0 mt-[7px] bg-primary" />
              {onU ? (
                <EditableText
                  value={item}
                  onSave={(v) => onU(["goal", "items", String(i)], v)}
                  className="flex-1 text-[13px] leading-relaxed text-muted-foreground"
                />
              ) : (
                item
              )}
            </li>
          ))}
        </ul>
        {a.goal.core_message && (
          <div
            className="rounded-none px-3 py-1.5"
            style={{ background: "rgba(249,66,58,0.06)", border: "1px solid rgba(249,66,58,0.15)" }}
          >
            <span className="text-[11px] font-medium inline-flex items-center gap-1.5" style={{ color: "#888" }}>
              <MessageSquare className="w-3 h-3" /> {t("core_message", l)}
            </span>
            <div className="mt-1">
              {onU ? (
                <EditableText
                  value={a.goal.core_message}
                  onSave={(v) => onU(["goal", "core_message"], v)}
                  className="text-[13px] text-foreground/90 font-medium leading-relaxed"
                />
              ) : (
                <p className="text-[13px] text-foreground/90 font-medium leading-relaxed">"{a.goal.core_message}"</p>
              )}
            </div>
          </div>
        )}
        {a.goal.success_criteria && (
          <div
            className="rounded-none px-3 py-1.5"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <span className="text-[11px] font-medium inline-flex items-center gap-1.5" style={{ color: "#888" }}>
              <Target className="w-3 h-3" /> {t("success_criteria", l)}
            </span>
            <div className="mt-1">
              {onU ? (
                <EditableText
                  value={a.goal.success_criteria}
                  onSave={(v) => onU(["goal", "success_criteria"], v)}
                  multiline
                  className="text-[13px] text-foreground/80 leading-relaxed"
                />
              ) : (
                <div className="space-y-1">
                  {a.goal.success_criteria.split(/[,،、]\s*/).map((c: string, i: number) => (
                    <p key={i} className="text-[13px] text-foreground/80 leading-relaxed">
                      {c.trim()}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {a.goal.desired_action && (
          <div
            className="rounded-none px-3 py-1.5"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <span className="text-[11px] font-medium" style={{ color: "#888" }}>
              ▶ {t("desired_action", l)}
            </span>
            <div className="mt-1">
              {onU ? (
                <EditableText
                  value={a.goal.desired_action}
                  onSave={(v) => onU(["goal", "desired_action"], v)}
                  className="text-[13px] text-foreground/80 leading-relaxed"
                />
              ) : (
                <p className="text-[13px] text-foreground/80 leading-relaxed">{a.goal.desired_action}</p>
              )}
            </div>
          </div>
        )}
      </div>
    ),
  }),
  (lang) => ({
    title: t("target", lang),
    badge: "TARGET",
    group: "core",
    render: (a, l, onU) => (
      <div className="space-y-4">
        {onU ? (
          <EditableText
            value={a.target.summary}
            onSave={(v) => onU(["target", "summary"], v)}
            className="text-[13px] text-muted-foreground leading-relaxed"
          />
        ) : (
          <p className="text-[13px] text-muted-foreground leading-relaxed">{a.target.summary}</p>
        )}
        <ul className="space-y-1.5">
          {a.target.primary.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px] leading-relaxed text-muted-foreground">
              <span className="w-1 h-1 rounded-full shrink-0 mt-[7px] bg-foreground" />
              {onU ? (
                <EditableText
                  value={item}
                  onSave={(v) => onU(["target", "primary", String(i)], v)}
                  className="flex-1 text-[13px] leading-relaxed text-muted-foreground"
                />
              ) : (
                item
              )}
            </li>
          ))}
        </ul>
        {onU ? (
          <>
            <div className="bg-background/80 border border-border px-3 py-2.5" style={{ borderRadius: 0 }}>
              <Label3>{t("psychological_insight", l)}</Label3>
              <EditableText
                value={a.target.insight}
                onSave={(v) => onU(["target", "insight"], v)}
                multiline
                className="text-[13px] leading-relaxed text-foreground/80"
              />
            </div>
            <div className="bg-background/80 border border-border px-3 py-2.5" style={{ borderRadius: 0 }}>
              <Label3>{t("media_behavior", l)}</Label3>
              <EditableText
                value={a.target.media_behavior}
                onSave={(v) => onU(["target", "media_behavior"], v)}
                multiline
                className="text-[13px] leading-relaxed text-foreground/80"
              />
            </div>
          </>
        ) : (
          <>
            <SubCard label={t("psychological_insight", l)} value={a.target.insight} />
            <SubCard label={t("media_behavior", l)} value={a.target.media_behavior} />
          </>
        )}
      </div>
    ),
  }),
  (lang) => ({
    title: t("usp", lang),
    badge: "USP",
    group: "core",
    render: (a, _l, onU) => <SlideUspContent analysis={a} lang={lang} onUpdate={onU} />,
  }),
  (lang) => ({
    title: t("brief_idea_analysis", lang),
    badge: "MEMO",
    group: "core",
    render: (a, _l, onU) =>
      a.creative_gap ? (
        <div className="space-y-3">
          {a.creative_gap.synergy.map((s, i) => (
            <div key={i} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-emerald-400">
              <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {onU ? (
                <EditableText
                  value={s}
                  onSave={(v) => onU(["creative_gap", "synergy", String(i)], v)}
                  className="flex-1 text-[13px] leading-relaxed text-emerald-400"
                />
              ) : (
                s
              )}
            </div>
          ))}
          {a.creative_gap.gap.map((g, i) => (
            <div key={i} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {onU ? (
                <EditableText
                  value={g}
                  onSave={(v) => onU(["creative_gap", "gap", String(i)], v)}
                  className="flex-1 text-[13px] leading-relaxed text-amber-400"
                />
              ) : (
                g
              )}
            </div>
          ))}
          {a.creative_gap.recommendation && (
            <div className="border-l-2 border-primary/40 pl-4 mt-3">
              {onU ? (
                <EditableText
                  value={a.creative_gap.recommendation}
                  onSave={(v) => onU(["creative_gap", "recommendation"], v)}
                  className="text-[14px] text-muted-foreground leading-relaxed italic"
                />
              ) : (
                <p className="text-[14px] text-muted-foreground leading-relaxed italic">
                  "{a.creative_gap.recommendation}"
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground/50">
          {lang === "ko" ? "아이디어 메모가 없습니다" : "No idea memo provided"}
        </p>
      ),
  }),
  (lang) => ({
    title: t("visual_direction", lang),
    badge: "VISUAL",
    group: "direction",
    render: (a, l, onU) =>
      typeof a.tone_manner.visual_direction === "string" ? (
        onU ? (
          <EditableText
            value={a.tone_manner.visual_direction}
            onSave={(v) => onU(["tone_manner", "visual_direction"], v)}
            multiline
            className="text-[14px] text-foreground/80 leading-relaxed"
          />
        ) : (
          <p className="text-[14px] text-foreground/80 leading-relaxed">{a.tone_manner.visual_direction}</p>
        )
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {(
            [
              { Icon: Camera, label: l === "ko" ? "카메라" : "Camera", key: "camera" as const },
              { Icon: Lightbulb, label: l === "ko" ? "조명" : "Lighting", key: "lighting" as const },
              { Icon: Palette, label: l === "ko" ? "색감" : "Color", key: "color_grade" as const },
              { Icon: Scissors, label: l === "ko" ? "편집" : "Editing", key: "editing" as const },
            ] as const
          ).map(({ Icon, label: cellLabel, key }) => (
            <div key={key} className="px-4 py-4" style={{ borderRadius: 0, background: "rgba(255,255,255,0.03)" }}>
              <div className="flex items-center gap-2 mb-2">
                <Icon className="w-3.5 h-3.5 text-foreground/60" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-foreground/60">{cellLabel}</span>
              </div>
              {onU ? (
                <EditableText
                  value={(a.tone_manner.visual_direction as VisualDirectionStructured)[key]}
                  onSave={(v) => onU(["tone_manner", "visual_direction", key], v)}
                  multiline
                  className="text-[13px] text-foreground/70 leading-relaxed"
                />
              ) : (
                <p className="text-[13px] text-foreground/70 leading-relaxed">
                  {(a.tone_manner.visual_direction as VisualDirectionStructured)[key]}
                </p>
              )}
            </div>
          ))}
        </div>
      ),
  }),
  (lang) => ({
    title: t("reference_mood", lang),
    badge: "MOOD",
    group: "direction",
    render: (a, _l, onU) =>
      onU ? (
        <EditableText
          value={a.tone_manner.reference_mood || ""}
          onSave={(v) => onU(["tone_manner", "reference_mood"], v)}
          multiline
          className="text-[14px] leading-relaxed text-foreground/80"
        />
      ) : (
        <ul className="space-y-2.5">
          {(a.tone_manner.reference_mood || "")
            .split(/(?<=[.。!?])\s+|(?<=\n)/)
            .filter((s: string) => s.trim())
            .map((sentence: string, i: number) => (
              <li key={i} className="flex items-start gap-2.5 text-[14px] leading-relaxed text-foreground/80">
                <span className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-foreground/30" />
                {sentence.trim()}
              </li>
            ))}
        </ul>
      ),
  }),
  (lang) => ({
    title: t("scene_flow", lang),
    badge: "FLOW",
    group: "direction",
    render: (a, _l, onU) => (
      <div className="space-y-4">
        <div className="flex items-start">
          {(["Hook", "Body", "CTA"] as const).map((step, i) => (
            <div key={step} className="flex-1 relative">
              {i < 2 && <div className="absolute top-[6px] left-1/2 w-full h-px bg-border" />}
              <div className="flex flex-col items-center gap-1.5 relative z-10">
                <div
                  className="w-3 h-3 border-2 border-background"
                  style={{ borderRadius: 0, background: i === 1 ? "rgba(255,255,255,0.2)" : "#f9423a" }}
                />
                <span
                  className="font-mono text-[10px] font-bold uppercase"
                  style={{ color: i === 1 ? "rgba(255,255,255,0.3)" : "#f9423a" }}
                >
                  {step}
                </span>
              </div>
            </div>
          ))}
        </div>
        {typeof a.production_notes.scene_count_hint === "string" ? (
          <p className="text-[13px] text-muted-foreground leading-relaxed">{a.production_notes.scene_count_hint}</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {(["hook", "body", "cta"] as const).map((key) => {
              const section = (a.production_notes.scene_count_hint as SceneFlowStructured)[key];
              return (
                <div key={key} className="px-4 py-4" style={{ borderRadius: 0, background: "rgba(255,255,255,0.03)" }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-mono text-[13px] font-semibold" style={{ color: "#f9423a" }}>
                      {key.toUpperCase()}
                    </span>
                    {onU ? (
                      <EditableText
                        value={section.duration}
                        onSave={(v) => onU(["production_notes", "scene_count_hint", key, "duration"], v)}
                        className="text-[12px]"
                        style={{ color: "#666" }}
                      />
                    ) : (
                      <span className="text-[12px]" style={{ color: "#666" }}>
                        {section.duration}
                      </span>
                    )}
                  </div>
                  {onU ? (
                    <EditableText
                      value={section.description}
                      onSave={(v) => onU(["production_notes", "scene_count_hint", key, "description"], v)}
                      multiline
                      className="text-[13px] leading-[1.6]"
                      style={{ color: "#aaa" }}
                    />
                  ) : (
                    <p className="text-[13px] leading-[1.6]" style={{ color: "#aaa" }}>
                      {section.description}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    ),
  }),
  (lang) => ({
    title: t("narrative_structure", lang),
    badge: "NARRATIVE",
    group: "direction",
    show: (a) => a.content_type === "brand_film" && !!a.narrative,
    render: (a, l) => <NarrativeSlideContent analysis={a} lang={l} />,
  }),
  (lang) => ({
    title: t("abcd_design_checklist", lang),
    badge: "ABCD",
    group: "abcd",
    render: (a, l) => <AbcdSlideContent analysis={a} lang={l} />,
  }),
];

/* ━━━━━ Narrative (brand_film) Slide ━━━━━ */
const NarrativeSlideContent = ({ analysis, lang }: { analysis: DeepAnalysis; lang: Lang }) => {
  const n = analysis.narrative;
  if (!n) return null;
  return (
    <div className="space-y-4">
      <div className="px-4 py-3" style={{ borderRadius: 0, background: "rgba(249,66,58,0.06)", border: "1px solid rgba(249,66,58,0.15)" }}>
        <Label3>{t("controlling_idea", lang)}</Label3>
        <p className="text-[14px] text-foreground/90 leading-relaxed italic">"{n.controlling_idea}"</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="px-3 py-2.5" style={{ borderRadius: 0, background: "rgba(255,255,255,0.03)" }}>
          <Label3>Story Structure</Label3>
          <p className="text-[13px] text-foreground/80 font-mono">{n.story_structure}</p>
        </div>
        <div className="px-3 py-2.5" style={{ borderRadius: 0, background: "rgba(255,255,255,0.03)" }}>
          <Label3>{t("protagonist", lang)}</Label3>
          <p className="text-[12px] text-foreground/80 leading-relaxed">
            <span className="text-foreground/60">{lang === "ko" ? "정체성" : "Identity"}:</span> {n.protagonist?.identity}
            <br />
            <span className="text-foreground/60">{lang === "ko" ? "욕망" : "Desire"}:</span> {n.protagonist?.desire}
            <br />
            <span className="text-foreground/60">{lang === "ko" ? "변화" : "Transformation"}:</span> {n.protagonist?.transformation}
          </p>
        </div>
      </div>

      {Array.isArray(n.emotional_beats) && n.emotional_beats.length > 0 && (
        <div className="px-3 py-2.5" style={{ borderRadius: 0, background: "rgba(255,255,255,0.03)" }}>
          <Label3>{t("emotional_beats", lang)}</Label3>
          <div className="space-y-1.5 mt-1">
            {n.emotional_beats.map((b, i) => (
              <div key={i} className="flex items-center gap-3 text-[12.5px]">
                <span className="font-mono text-foreground/50 w-16 shrink-0">{b.timestamp}</span>
                <span className="text-foreground/85 flex-1">{b.emotion}</span>
                <div className="flex gap-0.5 items-end h-4 w-16">
                  {Array.from({ length: 10 }).map((_, idx) => (
                    <div
                      key={idx}
                      className="flex-1 rounded-none"
                      style={{
                        background: idx < b.intensity ? "#f9423a" : "rgba(255,255,255,0.08)",
                        height: `${30 + idx * 7}%`,
                      }}
                    />
                  ))}
                </div>
                <span className="font-mono text-[11px] text-foreground/50 w-6 text-right">{b.intensity}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ━━━━━ ABCD Effectiveness Slide ━━━━━ */
const AbcdSlideContent = ({ analysis, lang }: { analysis: DeepAnalysis; lang: Lang }) => {
  // 브리프 설계값만으로 채점하는 "설계 체크리스트". 저장된 값이 있으면 사용.
  // 브리프 설계값만으로 채점 → scoreABCD 는 scenes 미전달 시 항상 non-null 반환
  const computed = analysis.abcd_compliance ?? scoreABCD({
    hook_strategy: analysis.hook_strategy,
    hero_visual: analysis.hero_visual,
    product_info: analysis.product_info,
    pacing: analysis.pacing,
    constraints: analysis.constraints,
    audience_insight: analysis.audience_insight,
    visual_direction:
      typeof analysis.tone_manner?.visual_direction === "object"
        ? analysis.tone_manner.visual_direction
        : undefined,
    reference_mood: analysis.tone_manner?.reference_mood,
  }) ?? {
    attract: { score: 0, notes: "" },
    brand: { score: 0, notes: "" },
    connect: { score: 0, notes: "" },
    direct: { score: 0, notes: "" },
    total: 0,
  };
  const total = computed.total ?? (computed.attract.score + computed.brand.score + computed.connect.score + computed.direct.score);
  const gradeInfo = gradeABCD(total);
  const colorMap: Record<typeof gradeInfo.color, string> = {
    red: "#ef4444",
    amber: "#f59e0b",
    lime: "#a3e635",
    green: "#10b981",
  };
  const rows: Array<{ key: "attract" | "brand" | "connect" | "direct"; letter: string; label: string }> = [
    { key: "attract", letter: "A", label: t("abcd_attract", lang) },
    { key: "brand", letter: "B", label: t("abcd_brand", lang) },
    { key: "connect", letter: "C", label: t("abcd_connect", lang) },
    { key: "direct", letter: "D", label: t("abcd_direct", lang) },
  ];
  return (
    <div className="space-y-4">
      {rows.map(({ key, letter, label }) => {
        const row = computed[key];
        const pct = Math.round((row.score / 10) * 100);
        return (
          <div key={key} className="space-y-1.5">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[13px] font-bold" style={{ color: "#f9423a" }}>{letter}</span>
              <span className="text-[12px] uppercase tracking-wider text-foreground/70 font-semibold">{label}</span>
              <span className="ml-auto font-mono text-[13px] text-foreground/80">{row.score}/10</span>
            </div>
            <div className="h-2 w-full rounded-none bg-foreground/10 overflow-hidden">
              <div
                className="h-full transition-all"
                style={{
                  width: `${pct}%`,
                  background:
                    row.score >= 7 ? "#10b981" : row.score >= 5 ? "#a3e635" : row.score >= 3 ? "#f59e0b" : "#ef4444",
                }}
              />
            </div>
            {row.notes && (
              <p className="text-[11.5px] leading-relaxed text-muted-foreground/80 pl-4 font-light">{row.notes}</p>
            )}
          </div>
        );
      })}
      <div
        className="mt-4 px-4 py-3 flex items-center justify-between"
        style={{ borderRadius: 0, background: "rgba(255,255,255,0.03)", border: `1px solid ${colorMap[gradeInfo.color]}40` }}
      >
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t("abcd_total", lang)}</span>
          <span className="font-mono text-[16px] font-bold" style={{ color: colorMap[gradeInfo.color] }}>{total}/40</span>
        </div>
        <span
          className="text-[12px] font-bold uppercase tracking-wider"
          style={{ color: colorMap[gradeInfo.color] }}
        >
          {gradeInfo.grade}
        </span>
      </div>
    </div>
  );
};

const SlideViewUI = ({
  analysis,
  lang = "ko",
  onUpdate,
}: {
  analysis: DeepAnalysis;
  lang?: Lang;
  onUpdate?: OnFieldUpdate;
}) => {
  const [slideIndex, setSlideIndex] = useState(0);
  // show predicate 가 있는 슬라이드는 현재 analysis 에 맞지 않으면 숨긴다
  const slides = SLIDE_DEFS.map((fn) => fn(lang)).filter((s) => !s.show || s.show(analysis));
  const total = slides.length;
  const current = slides[Math.min(slideIndex, total - 1)];

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft") setSlideIndex((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setSlideIndex((i) => Math.min(total - 1, i + 1));
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [total]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-1 mb-4">
        {analysis.content_type && CONTENT_TYPE_LABEL[analysis.content_type] && (
          <div className="mb-2">
            <span
              className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5"
              title={analysis.classification_reasoning ?? ""}
              style={{
                borderRadius: 0,
                background: `${CONTENT_TYPE_LABEL[analysis.content_type].color}15`,
                color: CONTENT_TYPE_LABEL[analysis.content_type].color,
                border: `1px solid ${CONTENT_TYPE_LABEL[analysis.content_type].color}40`,
              }}
            >
              {CONTENT_TYPE_LABEL[analysis.content_type][lang]}
              {typeof analysis.classification_confidence === "number" &&
                ` · ${Math.round(analysis.classification_confidence * 100)}%`}
            </span>
          </div>
        )}
        {onUpdate ? (
          <EditableText
            value={analysis.goal.summary}
            onSave={(v) => onUpdate(["goal", "summary"], v)}
            className="text-[22px] font-bold text-foreground leading-tight tracking-tight"
          />
        ) : (
          <p className="text-[22px] font-bold text-foreground leading-tight tracking-tight">{analysis.goal.summary}</p>
        )}
        <div className="mt-2">
          {onUpdate ? (
            <EditableText
              value={analysis.usp.summary}
              onSave={(v) => onUpdate(["usp", "summary"], v)}
              className="text-[13px] text-muted-foreground leading-relaxed"
            />
          ) : (
            <p className="text-[13px] text-muted-foreground leading-relaxed">{analysis.usp.summary}</p>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <div
          className="flex-1 overflow-y-auto"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 0 }}
        >
          <div className="flex items-center gap-3 px-5 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <span className="font-mono text-[11px] font-bold" style={{ color: "#666" }}>
              {slideIndex + 1}/{total}
            </span>
            <span
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5"
              style={{
                borderRadius: 0,
                background: SLIDE_GROUP_LABEL[current.group].bg,
                color: SLIDE_GROUP_LABEL[current.group].color,
              }}
            >
              {SLIDE_GROUP_LABEL[current.group][lang]}
            </span>
            <span className="text-[15px] font-bold text-foreground">{current.title}</span>
          </div>
          <div key={slideIndex} className="px-5 py-5 animate-fade-in">
            {current.render(analysis, lang, onUpdate)}
          </div>
        </div>

        <div className="flex flex-col items-center gap-2 pt-4 pb-1">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSlideIndex((i) => Math.max(0, i - 1))}
              disabled={slideIndex === 0}
              className="w-8 h-8 flex items-center justify-center transition-colors"
              style={{
                borderRadius: "50%",
                background: slideIndex === 0 ? "transparent" : "rgba(255,255,255,0.06)",
                color: slideIndex === 0 ? "#333" : "#999",
                border: "none",
                cursor: slideIndex === 0 ? "default" : "pointer",
              }}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1.5">
              {slides.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setSlideIndex(i)}
                  style={{
                    width: i === slideIndex ? 20 : 6,
                    height: 6,
                    borderRadius: 0,
                    background: i === slideIndex ? "#f9423a" : "rgba(255,255,255,0.15)",
                    border: "none",
                    cursor: "pointer",
                    transition: "width 200ms, background 200ms",
                  }}
                />
              ))}
            </div>
            <button
              onClick={() => setSlideIndex((i) => Math.min(total - 1, i + 1))}
              disabled={slideIndex === total - 1}
              className="w-8 h-8 flex items-center justify-center transition-colors"
              style={{
                borderRadius: "50%",
                background: slideIndex === total - 1 ? "transparent" : "rgba(255,255,255,0.06)",
                color: slideIndex === total - 1 ? "#333" : "#999",
                border: "none",
                cursor: slideIndex === total - 1 ? "default" : "pointer",
              }}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <span className="text-[11px] text-muted-foreground/50">
            {slideIndex + 1} / {total} · {current.title}
          </span>
        </div>
      </div>
    </div>
  );
};

/* ━━━━━ ProductionGuideUI — right column ━━━━━ */
const ProductionGuideUI = ({
  analysis,
  lang = "ko",
  onUpdate,
}: {
  analysis: DeepAnalysis;
  lang?: Lang;
  onUpdate?: OnFieldUpdate;
}) => {
  const [addingTag, setAddingTag] = useState(false);
  const [newTag, setNewTag] = useState("");

  const addToneTag = (tag: string) => {
    if (!tag.trim() || !onUpdate) return;
    const updated = [...(analysis.tone_manner.keywords || []), tag.trim()];
    onUpdate(["tone_manner", "keywords"], updated as any);
    setAddingTag(false);
    setNewTag("");
  };

  const removeToneTag = (index: number) => {
    if (!onUpdate) return;
    const updated = analysis.tone_manner.keywords.filter((_, i) => i !== index);
    onUpdate(["tone_manner", "keywords"], updated as any);
  };

  const E = (
    path: string[],
    value: string,
    opts?: { multiline?: boolean; className?: string; style?: React.CSSProperties },
  ) => {
    if (!onUpdate) {
      return (
        <span className={opts?.className} style={opts?.style}>
          {value}
        </span>
      );
    }
    return (
      <EditableText
        value={value}
        onSave={(v) => onUpdate(path, v)}
        multiline={opts?.multiline}
        className={opts?.className || ""}
        style={opts?.style}
      />
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-[3px] h-3 bg-foreground/30" style={{ borderRadius: 0 }} />
        <span className="label-meta text-muted-foreground">{t("production_guide", lang)}</span>
      </div>

      <SectionCard>
        <SectionHeader dot="gray" label={t("tone_manner", lang)} />
        <div className="px-3 py-3 space-y-2.5">
          <div className="flex flex-wrap gap-1.5">
            {analysis.tone_manner.keywords.map((kw, i) => (
              <span
                key={i}
                className="font-mono text-[10px] px-2 py-1 font-bold uppercase tracking-wider relative group"
                style={{
                  borderRadius: 0,
                  ...(i % 2 === 0
                    ? { background: "rgba(249,66,58,0.12)", color: "#f9423a", border: "1px solid rgba(249,66,58,0.2)" }
                    : {
                        background: "rgba(255,255,255,0.06)",
                        color: "rgba(255,255,255,0.5)",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }),
                }}
              >
                {kw}
                {onUpdate && (
                  <button
                    onClick={() => removeToneTag(i)}
                    className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-primary text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ borderRadius: "50%", fontSize: 8, lineHeight: 1 }}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            {onUpdate && !addingTag && (
              <button
                onClick={() => setAddingTag(true)}
                className="font-mono text-[10px] px-2 py-1 font-bold uppercase tracking-wider transition-colors"
                style={{
                  borderRadius: 0,
                  background: "rgba(255,255,255,0.06)",
                  color: "#666",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                +
              </button>
            )}
            {addingTag && (
              <input
                autoFocus
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onBlur={() => {
                  if (newTag.trim()) addToneTag(newTag);
                  else {
                    setAddingTag(false);
                    setNewTag("");
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTag.trim()) addToneTag(newTag);
                  if (e.key === "Escape") {
                    setAddingTag(false);
                    setNewTag("");
                  }
                }}
                className="font-mono text-[10px] px-2 py-1 font-bold uppercase tracking-wider"
                style={{
                  width: 80,
                  borderRadius: 0,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(249,66,58,0.3)",
                  color: "#fff",
                  outline: "none",
                }}
              />
            )}
          </div>
          <div
            className="flex items-start gap-2.5 px-3 py-2.5"
            style={{ borderRadius: 0, background: "rgba(249,66,58,0.08)", border: "1px solid rgba(249,66,58,0.25)" }}
          >
            <div
              className="w-5 h-5 flex items-center justify-center shrink-0 mt-px"
              style={{ borderRadius: 0, background: "#f9423a" }}
            >
              <span className="text-white text-[11px] font-bold leading-none">!</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="label-meta text-primary mb-1">{t("do_not", lang).toUpperCase()}</p>
              {E(["tone_manner", "do_not"], analysis.tone_manner.do_not, {
                multiline: true,
                className: "text-[13px] text-primary/80 leading-relaxed",
              })}
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard>
        <div
          className="flex items-center gap-2 px-3 py-2.5 border-b border-border"
          style={{ background: "rgba(249,66,58,0.1)" }}
        >
          <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-primary" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
            {t("prod_notes", lang).toUpperCase()}
          </span>
        </div>
        <div className="px-3 py-3 space-y-2">
          <div className="bg-background/80 border border-border px-3 py-2.5" style={{ borderRadius: 0 }}>
            <p className="label-meta text-muted-foreground mb-1">{t("format", lang)}</p>
            {E(["production_notes", "format_recommendation"], analysis.production_notes.format_recommendation, {
              className: "text-[13px] leading-relaxed text-foreground/80",
            })}
          </div>
          <div className="bg-background/80 border border-border px-3 py-2.5" style={{ borderRadius: 0 }}>
            <p className="label-meta text-muted-foreground mb-1">{t("shooting_style", lang)}</p>
            {E(["production_notes", "shooting_style"], analysis.production_notes.shooting_style, {
              className: "text-[13px] leading-relaxed text-foreground/80",
            })}
          </div>
          <div className="bg-background/80 border border-border px-3 py-2.5" style={{ borderRadius: 0 }}>
            <p className="label-meta text-muted-foreground mb-1">{t("budget_efficiency", lang)}</p>
            {E(["production_notes", "budget_efficiency"], analysis.production_notes.budget_efficiency, {
              multiline: true,
              className: "text-[13px] leading-relaxed text-foreground/80",
            })}
          </div>
        </div>
      </SectionCard>
    </div>
  );
};

/* ━━━━━ DeepResultUI (legacy wrapper) ━━━━━ */
const DeepResultUI = ({
  analysis,
  lang = "ko",
  onUpdate,
}: {
  analysis: DeepAnalysis;
  lang?: Lang;
  onUpdate?: OnFieldUpdate;
}) => (
  <div className="space-y-5">
    <CoreStrategyUI analysis={analysis} lang={lang} onUpdate={onUpdate} />
    <ProductionGuideUI analysis={analysis} lang={lang} onUpdate={onUpdate} />
  </div>
);

const LegacyResultUI = ({ analysis, lang = "ko" }: { analysis: LegacyAnalysis; lang?: Lang }) => {
  const cards: { dot: DotVariant; label: string; tag: string; key: keyof LegacyAnalysis }[] = [
    { dot: "red", label: t("campaign_goal", lang), tag: "GOAL", key: "goal" },
    { dot: "black", label: t("target_audience", lang), tag: "TARGET", key: "target" },
    { dot: "red", label: t("usp", lang), tag: "USP", key: "usp" },
    { dot: "gray", label: t("tone_manner", lang), tag: "TONE", key: "tone_manner" },
  ];
  return (
    <div className="space-y-2">
      {cards.map((c) => (
        <SectionCard key={c.key}>
          <SectionHeader dot={c.dot} label={c.label} tag={c.tag} />
          <div className="px-3 py-2.5">
            <BulletList items={analysis[c.key] as string[]} dot={c.dot === "black" ? "black" : "red"} />
          </div>
        </SectionCard>
      ))}
    </div>
  );
};

/* ━━━━━ NextStepOption ━━━━━ */
const NextStepOption = ({
  Icon,
  title,
  desc,
  onClick,
}: {
  Icon: LucideIcon;
  title: string;
  desc: string;
  onClick: () => void;
}) => {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="w-full flex items-start gap-3 p-3 border text-left transition-all duration-150"
      style={{
        borderRadius: 0,
        borderColor: hovered ? "rgba(249,66,58,0.4)" : "rgba(255,255,255,0.07)",
        background: hovered ? "rgba(249,66,58,0.06)" : "transparent",
        transform: hovered ? "translateY(-1px)" : "translateY(0)",
        boxShadow: hovered ? "0 4px 12px rgba(249,66,58,0.12)" : "none",
      }}
    >
      <Icon
        className="w-4 h-4 shrink-0 mt-0.5"
        style={{ color: hovered ? "#f9423a" : "rgba(255,255,255,0.5)" }}
        strokeWidth={1.75}
      />
      <div>
        <div className="text-[12px] font-semibold text-foreground">{title}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{desc}</div>
      </div>
    </button>
  );
};

const NextStepModal = ({
  onClose,
  onGoAssets,
  onGoAgent,
}: {
  onClose: () => void;
  onGoAssets: () => void;
  onGoAgent: () => void;
  analysisLang?: "ko" | "en";
}) => (
  <Dialog open onOpenChange={(o) => !o && onClose()}>
    <DialogContent className="max-w-[380px] bg-card border-border" style={{ borderRadius: 0 }}>
      <DialogHeader>
        <DialogTitle className="text-[15px] font-semibold text-foreground">Choose next step</DialogTitle>
      </DialogHeader>
      <p className="text-[12px] text-muted-foreground leading-relaxed">
        Registering assets (characters, items, backgrounds) first helps the agent build more detailed scenes.
      </p>
      <div className="space-y-2 mt-1">
        {[
          {
            Icon: Package,
            title: "Set Up Assets First",
            desc: "Register characters, items, backgrounds then go to Ideation",
            onClick: () => {
              onClose();
              onGoAssets();
            },
          },
          {
            Icon: MessageSquare,
            title: "Go to Ideation Directly",
            desc: "Start building the story without assets",
            onClick: () => {
              onClose();
              onGoAgent();
            },
          },
        ].map((opt) => (
          <NextStepOption key={opt.title} {...opt} />
        ))}
      </div>
      <DialogFooter>
        <Button variant="ghost" className="text-[13px] h-9" onClick={onClose}>
          Cancel
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

/* ━━━━━ LangToggle — shared toggle UI ━━━━━ */
const LangToggle = ({
  lang,
  onChange,
  loading = false,
}: {
  lang: Lang;
  onChange: (l: Lang) => void;
  loading?: boolean;
}) => (
  <button
    onClick={() => onChange(lang === "ko" ? "en" : "ko")}
    disabled={loading}
    className="flex items-center h-6 border border-border overflow-hidden"
    style={{ borderRadius: 0 }}
  >
    {(["ko", "en"] as const).map((l) => (
      <span
        key={l}
        className="px-2 h-full flex items-center text-[10px] font-bold tracking-wider transition-colors"
        style={{
          background: lang === l ? "#f9423a" : "transparent",
          color: lang === l ? "#fff" : "rgba(255,255,255,0.35)",
        }}
      >
        {l === "en" && loading ? (
          <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        ) : (
          l.toUpperCase()
        )}
      </span>
    ))}
  </button>
);

/* ━━━━━ Main Component ━━━━━ */
export const BriefTab = ({ projectId, onSwitchToAgent, onSwitchToAssets }: Props) => {
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const getInitialDraft = useCallback((): DraftState => {
    const memCached = _draftByProject.get(projectId);
    if (memCached) return memCached;

    const persisted = loadFromLS(projectId);
    const draft: DraftState = {
      briefText: persisted.briefText,
      ideaNote: persisted.ideaNote,
      pdfState: persisted.pdfState,
      pdfExtractedText: persisted.pdfExtractedText,
      pdfFileName: persisted.pdfFileName,
      pdfFileSize: persisted.pdfFileSize,
      pdfPageInfo: persisted.pdfPageInfo,
      briefImages: fromSerializable(persisted.briefImages),
      refItems: fromSerializableRefItems(persisted.refItems),
    };
    _draftByProject.set(projectId, draft);
    return draft;
  }, [projectId]);

  const initialDraft = getInitialDraft();

  const [briefText, setBriefTextState] = useState(initialDraft.briefText);
  const [ideaNote, setIdeaNoteState] = useState(initialDraft.ideaNote);
  const [briefImages, setBriefImagesState] = useState<ImageItem[]>(initialDraft.briefImages);
  const [refItems, setRefItemsState] = useState<RefItem[]>(initialDraft.refItems);
  const [pdfState, setPdfStateRaw] = useState<"idle" | "extracting" | "ready" | "error">(initialDraft.pdfState);
  const [pdfExtractedText, setPdfExtractedTextState] = useState(initialDraft.pdfExtractedText);
  const [pdfFileName, setPdfFileNameState] = useState(initialDraft.pdfFileName);
  const [pdfFileSize, setPdfFileSizeState] = useState(initialDraft.pdfFileSize);
  const [pdfPageInfo, setPdfPageInfoState] = useState(initialDraft.pdfPageInfo);

  const saveDraft = useCallback(
    (patch: Partial<DraftState>) => {
      const cur = _draftByProject.get(projectId) ?? getDefaultDraft();
      const next = { ...cur, ...patch };
      _draftByProject.set(projectId, next);

      const persisted: PersistedDraft = {
        briefText: next.briefText,
        ideaNote: next.ideaNote,
        briefImages: toSerializable(next.briefImages),
        refItems: toSerializableRefItems(next.refItems),
        pdfState: next.pdfState,
        pdfExtractedText: next.pdfExtractedText,
        pdfFileName: next.pdfFileName,
        pdfFileSize: next.pdfFileSize,
        pdfPageInfo: next.pdfPageInfo,
      };
      saveToLS(projectId, persisted);
    },
    [projectId],
  );

  const setBriefText = (v: string) => {
    setBriefTextState(v);
    saveDraft({ briefText: v });
  };
  const setIdeaNote = (v: string) => {
    setIdeaNoteState(v);
    saveDraft({ ideaNote: v });
  };

  const setBriefImages = (fn: ImageItem[] | ((p: ImageItem[]) => ImageItem[])) => {
    setBriefImagesState((prev) => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      saveDraft({ briefImages: next });
      return next;
    });
  };
  const setRefItems = (fn: RefItem[] | ((p: RefItem[]) => RefItem[])) => {
    setRefItemsState((prev) => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      saveDraft({ refItems: next });
      return next;
    });
  };
  const setPdfState = (v: "idle" | "extracting" | "ready" | "error") => {
    setPdfStateRaw(v);
    saveDraft({ pdfState: v });
  };
  const setPdfExtractedText = (v: string) => {
    setPdfExtractedTextState(v);
    saveDraft({ pdfExtractedText: v });
  };
  const setPdfFileName = (v: string) => {
    setPdfFileNameState(v);
    saveDraft({ pdfFileName: v });
  };
  const setPdfFileSize = (v: number) => {
    setPdfFileSizeState(v);
    saveDraft({ pdfFileSize: v });
  };
  const setPdfPageInfo = (v: { pages: number; chars: number } | null) => {
    setPdfPageInfoState(v);
    saveDraft({ pdfPageInfo: v });
  };

  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  // analyzing 이 false 로 내려간 직후 300ms 동안 로더를 유지해 100% 스냅 연출.
  // AnalysisLoader 가 onHidden 콜백으로 해제.
  const [loaderLingering, setLoaderLingering] = useState(false);
  const [existingBrief, setExistingBrief] = useState<Brief | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzedAt, setAnalyzedAt] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<"text" | "image" | "pdf">("text");
  const [composerDragOver, setComposerDragOver] = useState(false);
  const [refDragOver, setRefDragOver] = useState(false);
  const [refUrlInput, setRefUrlInput] = useState("");
  const [showNextStepModal, setShowNextStepModal] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "slide">("list");

  /* ━━━━━ KO/EN — analysis lang + bidirectional sync ━━━━━ */
  const [analysisLang, setAnalysisLang] = useState<Lang>("en");
  const [analysisEn, setAnalysisEn] = useState<Analysis | null>(null);
  const [translating, setTranslating] = useState(false);
  const [fieldSyncing, setFieldSyncing] = useState<string | null>(null);

  /* Analysis result lang toggle — lazy translate on first EN click */
  const handleLangToggle = useCallback(
    async (next: Lang) => {
      if (next === "ko") {
        setAnalysisLang("ko");
        return;
      }
      if (!analysis) return;
      if (analysisEn) {
        setAnalysisLang("en");
        return;
      }
      // First-time full translation
      setTranslating(true);
      try {
        const { data, error } = await supabase.functions.invoke("translate-analysis", {
          body: { mode: "full", analysis, direction: "ko_to_en" },
        });
        if (error) throw error;
        if (data?.translated) {
          setAnalysisEn(data.translated);
          setAnalysisLang("en");
          if (existingBrief) {
            await supabase
              .from("briefs")
              .update({ analysis_en: data.translated } as any)
              .eq("id", existingBrief.id);
          }
        }
      } catch {
        toast({
          variant: "destructive",
          title: "Translation failed",
          description: "Something went wrong while translating to English.",
        });
      } finally {
        setTranslating(false);
      }
    },
    [analysis, analysisEn, toast, existingBrief],
  );

  /* ━━━━━ Bidirectional field sync ━━━━━ */
  const updateAnalysisField = useCallback(
    async (path: string[], newValue: any) => {
      if (!analysis || !isDeepAnalysis(analysis)) return;

      const editedLang = analysisLang;
      const pathKey = path.join(".");

      if (editedLang === "ko") {
        const updated = deepSet(analysis, path, newValue);
        setAnalysis(updated);
        if (existingBrief) {
          await supabase.from("briefs").update({ analysis: updated }).eq("id", existingBrief.id);
        }
      } else {
        if (!analysisEn) return;
        const updated = deepSet(analysisEn, path, newValue);
        setAnalysisEn(updated);
        if (existingBrief) {
          await supabase
            .from("briefs")
            .update({ analysis_en: updated } as any)
            .eq("id", existingBrief.id);
        }
      }

      if (editedLang === "ko" && !analysisEn) return;
      if (editedLang === "en" && !analysis) return;

      if (Array.isArray(newValue)) {
        if (editedLang === "ko" && analysisEn) {
          const enUpdated = reorderArraySync(analysisEn, analysis, path, newValue);
          setAnalysisEn(enUpdated);
          if (existingBrief) {
            await supabase
              .from("briefs")
              .update({ analysis_en: enUpdated } as any)
              .eq("id", existingBrief.id);
          }
        } else if (editedLang === "en" && analysis) {
          const koUpdated = reorderArraySync(analysis, analysisEn!, path, newValue);
          setAnalysis(koUpdated);
          if (existingBrief) {
            await supabase.from("briefs").update({ analysis: koUpdated }).eq("id", existingBrief.id);
          }
        }
        return;
      }

      if (typeof newValue === "string" && newValue.trim()) {
        setFieldSyncing(pathKey);
        try {
          const { data } = await supabase.functions.invoke("translate-analysis", {
            body: {
              mode: "field",
              fieldValue: newValue,
              fieldPath: pathKey,
              direction: editedLang === "ko" ? "ko_to_en" : "en_to_ko",
            },
          });

          if (data?.translated) {
            if (editedLang === "ko" && analysisEn) {
              const enUpdated = deepSet(structuredClone(analysisEn), path, data.translated);
              setAnalysisEn(enUpdated);
              if (existingBrief) {
                await supabase
                  .from("briefs")
                  .update({ analysis_en: enUpdated } as any)
                  .eq("id", existingBrief.id);
              }
            } else if (editedLang === "en" && analysis) {
              const koUpdated = deepSet(structuredClone(analysis), path, data.translated);
              setAnalysis(koUpdated);
              if (existingBrief) {
                await supabase.from("briefs").update({ analysis: koUpdated }).eq("id", existingBrief.id);
              }
            }
          }
        } catch (err) {
          console.error("Field sync failed:", err);
        } finally {
          setFieldSyncing(null);
        }
      }
    },
    [analysis, analysisEn, analysisLang, existingBrief],
  );

  /* ━━━━━ First-time editing hint ━━━━━ */
  const [showEditHint, setShowEditHint] = useState(false);
  useEffect(() => {
    if (!analysis || !isDeepAnalysis(analysis)) return;
    const key = `ff_edit_hint_${projectId}`;
    if (!localStorage.getItem(key)) {
      setShowEditHint(true);
      localStorage.setItem(key, "1");
      const timer = setTimeout(() => setShowEditHint(false), 3000);
      const handleClick = () => {
        setShowEditHint(false);
        clearTimeout(timer);
      };
      window.addEventListener("click", handleClick, { once: true });
      return () => {
        clearTimeout(timer);
        window.removeEventListener("click", handleClick);
      };
    }
  }, [analysis, projectId]);

  const refFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchBrief = async () => {
      const { data } = await supabase
        .from("briefs")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!data) return;
      setExistingBrief(data as unknown as Brief);

      if (data.analysis) {
        const a = data.analysis as unknown as DeepAnalysis;
        setAnalysis(a);
        setAnalyzedAt(data.created_at);
        setSourceType(((data as any).source_type as "text" | "image" | "pdf") || "text");

        // ★ Load lang from DB
        if ((data as any).lang) {
          setAnalysisLang((data as any).lang as Lang);
        }

        if ((data as any).analysis_en) {
          setAnalysisEn((data as any).analysis_en as unknown as Analysis);
        }

        const currentDraft = loadFromLS(projectId);
        if (!currentDraft.ideaNote && a.idea_note) {
          setIdeaNote(a.idea_note);
        }
      }

      const currentDraft = loadFromLS(projectId);
      if (!currentDraft.briefText && data.raw_text) {
        setBriefText(data.raw_text);
      }
    };
    fetchBrief();
  }, [projectId]);

  /* ━━━━━ Reference 패널 — 모델 가용성 ━━━━━
   *  projectId 스코프를 명시해 프로젝트 override 가 있으면 그걸,
   *  없으면 global 디폴트를 따른다. (Settings 에서 디폴트를 바꿔도
   *  이 프로젝트에 override 가 있다면 유지.) */
  const [briefModelTick, setBriefModelTick] = useState(0);
  const briefModelMeta = useMemo(() => {
    const id = getModel("brief", projectId);
    return getModelMeta(id, getSettingsCached());
    // briefModelTick: picker 에서 변경이 발생하면 재계산.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, briefModelTick]);
  const supportsVideoFrames = !!briefModelMeta?.supportsVideoFrames;

  // 모델/설정이 바뀔 때마다 ignoredByModel 재계산
  useEffect(() => {
    setRefItems((prev) => recomputeIgnoredByModel(prev, supportsVideoFrames));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supportsVideoFrames]);

  // brief 모델 변경을 구독해서 리렌더 트리거 — 해당 projectId 스코프만.
  useEffect(() => {
    const unsub = subscribeModel("brief", () => setBriefModelTick((t) => t + 1), projectId);
    return unsub;
  }, [projectId]);

  const refCounts = useMemo(() => summarizeRefs(refItems), [refItems]);
  const REF_TOTAL_LIMIT = 8;

  const handleRefFileSelect = useCallback(
    async (files: FileList | null) => {
      if (!files) return;
      const slots = Math.max(0, REF_TOTAL_LIMIT - refItems.length);
      const arr = Array.from(files).slice(0, slots);
      for (const file of arr) {
        const isImage = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
        const isVideo = ["video/mp4", "video/quicktime", "video/webm"].includes(file.type);

        if (isImage) {
          if (file.size > 10 * 1024 * 1024) {
            toast({ variant: "destructive", title: "File too large", description: "Max image size is 10MB." });
            continue;
          }
          const base64 = await fileToBase64(file);
          const item: RefImageItem = {
            kind: "image",
            id: makeRefId("image"),
            addedAt: new Date().toISOString(),
            base64,
            mediaType: file.type,
            preview: toDataUrl(base64, file.type),
            file,
            ignoredByModel: false,
          };
          setRefItems((prev) => [...prev, item]);
          continue;
        }

        if (isVideo) {
          if (!supportsVideoFrames) {
            toast({
              variant: "destructive",
              title: "Video not supported by current model",
              description: "Switch to GPT-5.x in the Creative Input header to add videos.",
            });
            continue;
          }
          const v = validateVideoFile(file);
          if (!v.ok) {
            const reason = "reason" in v ? v.reason : "video rejected";
            toast({ variant: "destructive", title: "Video rejected", description: reason });
            continue;
          }
          const id = makeRefId("video");
          // Provisional entry — 메타/포스터 추출 중
          const provisional: RefVideoItem = {
            kind: "video",
            id,
            addedAt: new Date().toISOString(),
            fileName: file.name,
            fileSize: file.size,
            durationSec: 0,
            posterBase64: "",
            file,
            status: "sampling",
            ignoredByModel: !supportsVideoFrames,
          };
          setRefItems((prev) => [...prev, provisional]);
          try {
            const { meta, poster } = await extractFirstFrame(file);
            setRefItems((prev) =>
              prev.map((it) =>
                it.id === id && it.kind === "video"
                  ? {
                      ...it,
                      durationSec: meta.durationSec,
                      posterBase64: poster.base64,
                      status: "ready" as const,
                    }
                  : it,
              ),
            );
          } catch (err: any) {
            setRefItems((prev) =>
              prev.map((it) =>
                it.id === id && it.kind === "video"
                  ? { ...it, status: "error" as const, errorMsg: err?.message || "video probe failed" }
                  : it,
              ),
            );
          }
          continue;
        }

        toast({
          variant: "destructive",
          title: "Unsupported format",
          description: "JPG/PNG/WEBP images, or MP4/MOV/WEBM videos only.",
        });
      }
    },
    [refItems.length, supportsVideoFrames, toast],
  );

  const addYoutubeRef = useCallback(
    async (rawUrl: string) => {
      const url = rawUrl.trim();
      if (!url) return;
      if (!isYoutubeUrl(url)) {
        toast({ variant: "destructive", title: "Invalid URL", description: "Only YouTube links are supported." });
        return;
      }
      if (!supportsVideoFrames) {
        toast({
          variant: "destructive",
          title: "YouTube not supported by current model",
          description: "Switch to GPT-5.x in the Creative Input header to add links.",
        });
        return;
      }
      if (refItems.length >= REF_TOTAL_LIMIT) {
        toast({ variant: "destructive", title: "Limit reached", description: `Max ${REF_TOTAL_LIMIT} reference items.` });
        return;
      }
      const m = url.match(YOUTUBE_URL_REGEX);
      const videoId = m?.[1] ?? "";
      const id = makeRefId("youtube");
      const provisional: RefYoutubeItem = {
        kind: "youtube",
        id,
        addedAt: new Date().toISOString(),
        url,
        videoId,
        status: "loading",
        ignoredByModel: !supportsVideoFrames,
      };
      setRefItems((prev) => [...prev, provisional]);
      try {
        const ingested = await ingestYoutube(url);
        setRefItems((prev) =>
          prev.map((it) =>
            it.id === id && it.kind === "youtube"
              ? {
                  ...it,
                  videoId: ingested.videoId,
                  title: ingested.title,
                  channel: ingested.channel,
                  thumbnailUrl: ingested.thumbnailUrl,
                  transcript: ingested.transcript,
                  durationSec: ingested.durationSec,
                  status: "ready" as const,
                }
              : it,
          ),
        );
      } catch (err: any) {
        setRefItems((prev) =>
          prev.map((it) =>
            it.id === id && it.kind === "youtube"
              ? { ...it, status: "error" as const, errorMsg: err?.message || "ingest failed" }
              : it,
          ),
        );
      }
    },
    [refItems.length, supportsVideoFrames, toast],
  );

  const removeRefItem = (id: string) => setRefItems((prev) => prev.filter((it) => it.id !== id));
  const setRefItemAnnotation = (id: string, annotation: RefAnnotation | undefined) =>
    setRefItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        // hasAnnotation 기준으로 비어있으면 아얘 필드 제거해서 저장 용량/노이즈 최소화.
        const next = hasAnnotation(annotation) ? annotation : undefined;
        return { ...it, annotation: next } as typeof it;
      }),
    );
  const removeBriefImage = (i: number) => setBriefImages((prev) => prev.filter((_, j) => j !== i));

  const extractTextFromPDF = async (file: File) => {
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      pages.push(`[${i}페이지]\n${(tc.items as any[]).map((it) => it.str).join(" ")}`);
    }
    const full = pages.join("\n\n");
    if (full.trim().length < 50) throw new Error("Not enough text extracted");
    return { text: full.length > 8000 ? full.slice(0, 8000) + "\n\n[truncated]" : full, pages: pdf.numPages };
  };

  const handlePDFUpload = useCallback(
    async (file: File) => {
      if (file.size > 20 * 1024 * 1024) {
        toast({ variant: "destructive", title: "File too large", description: "Max file size is 20MB." });
        return;
      }
      if (file.type !== "application/pdf") {
        toast({ variant: "destructive", title: "Unsupported format", description: "Only PDF files are supported." });
        return;
      }
      setPdfFileName(file.name);
      setPdfFileSize(file.size);
      setPdfState("extracting");
      try {
        const { text, pages } = await extractTextFromPDF(file);
        setPdfExtractedText(text);
        setPdfPageInfo({ pages, chars: text.length });
        setPdfState("ready");
      } catch {
        setPdfState("error");
      }
    },
    [toast],
  );

  const resetPdf = () => {
    setPdfState("idle");
    setPdfExtractedText("");
    setPdfFileName("");
    setPdfFileSize(0);
    setPdfPageInfo(null);
  };

  const handleComposerDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setComposerDragOver(false);
      const files = e.dataTransfer.files;
      if (!files?.length) return;
      const pdfs = Array.from(files).filter((f) => f.type === "application/pdf");
      const imgs = Array.from(files).filter((f) => ["image/jpeg", "image/png", "image/webp"].includes(f.type));
      if (pdfs[0]) handlePDFUpload(pdfs[0]);
      for (const file of imgs.slice(0, 3 - briefImages.length)) {
        if (file.size > 10 * 1024 * 1024) {
          toast({ variant: "destructive", title: "File too large", description: "Max file size is 10MB." });
          continue;
        }
        const base64 = await fileToBase64(file);
        setBriefImages((prev) => [
          ...prev,
          { file, base64, mediaType: file.type, preview: toDataUrl(base64, file.type) },
        ]);
      }
    },
    [briefImages.length, handlePDFUpload, toast],
  );

  const canAnalyze = briefText.trim().length > 0 || pdfState === "ready" || briefImages.length > 0;

  const handleAnalyze = async () => {
    if (!canAnalyze) return;
    setAnalyzing(true);
    try {
      // settings 캐시를 미리 로드해서 ModelMeta 가용성/maxTokens 가 정확히 결정되도록
      await ensureSettingsLoaded();
      const briefModelId = getModel("brief", projectId);
      const briefMeta = getModelMeta(briefModelId, getSettingsCached());
      const modelSupportsVideo = !!briefMeta?.supportsVideoFrames;

      let result: DeepAnalysis;
      let currentSourceType: "text" | "pdf" | "image";
      let imageAnalysis = "";
      let videoInsightsBlock = "";

      // ── 1) 이미지 레퍼런스: 종래 Gemini 기반 스타일 분석 호출 ──
      const refImagesUsable = refItems.filter(
        (it): it is RefImageItem => it.kind === "image" && !it.ignoredByModel,
      );
      if (refImagesUsable.length > 0) {
        try {
          const { data: rd, error: re } = await supabase.functions.invoke("analyze-reference-images", {
            body: { images: refImagesUsable.map((i) => ({ base64: i.base64, mediaType: i.mediaType })) },
          });
          if (!re && rd?.analysis) imageAnalysis = rd.analysis;
        } catch {}
      }

      // ── 2) YouTube/Video 레퍼런스: GPT-5.x 일 때만 텍스트 + 프레임 첨부 ──
      const youtubesUsable = refItems.filter(
        (it): it is RefYoutubeItem => it.kind === "youtube" && !it.ignoredByModel && it.status === "ready",
      );
      const videosUsable = refItems.filter(
        (it): it is RefVideoItem => it.kind === "video" && !it.ignoredByModel && it.status === "ready",
      );
      // 비디오 프레임을 in-place 로 샘플링 (분석 직전에만)
      const sampledVideos: Array<{ item: RefVideoItem; frames: { base64: string; mediaType: string; t: number }[] }> = [];
      if (modelSupportsVideo) {
        for (const v of videosUsable) {
          if (!v.file) {
            // 파일 핸들이 사라진 경우 — poster 만이라도 사용
            sampledVideos.push({ item: v, frames: v.posterBase64 ? [{ base64: v.posterBase64, mediaType: "image/png", t: 0 }] : [] });
            continue;
          }
          try {
            const targetCount = v.durationSec > 60 ? 12 : 8;
            // 사용자가 관심 구간을 지정했다면 그 구간 안에서 dense 샘플링.
            // parseTimeRange 가 성공한 경우에만 startSec/endSec 가 채워져 있음.
            const ann = v.annotation;
            const range =
              ann && typeof ann.startSec === "number" && typeof ann.endSec === "number"
                ? { startSec: ann.startSec, endSec: ann.endSec }
                : undefined;
            const { frames } = await sampleFrames(v.file, targetCount, range);
            sampledVideos.push({ item: v, frames: frames.map((f) => ({ base64: f.base64, mediaType: f.mediaType, t: f.t })) });
          } catch {
            sampledVideos.push({ item: v, frames: v.posterBase64 ? [{ base64: v.posterBase64, mediaType: "image/png", t: 0 }] : [] });
          }
        }
      }

      // 텍스트 인서트: youtube 메타/자막 + video 메타 + 사용자 부연설명
      const ytLines: string[] = [];
      for (const yt of youtubesUsable) {
        const head = `- [YouTube] ${yt.title || yt.url} ${yt.channel ? `· ${yt.channel}` : ""} (${yt.videoId})`;
        const annLines = formatAnnotationLines(yt.annotation, { includeRange: true }); // YT 는 샘플링 없이 텍스트 힌트로만 반영
        const transcript = yt.transcript ? `\n  Transcript (excerpt): ${yt.transcript.slice(0, 1500)}${yt.transcript.length > 1500 ? "…" : ""}` : "";
        ytLines.push([head, ...annLines].join("\n") + transcript);
      }
      const vidLines: string[] = sampledVideos.map(({ item, frames }) => {
        const ann = item.annotation;
        const rangeApplied =
          ann && typeof ann.startSec === "number" && typeof ann.endSec === "number";
        const head = `- [Video] ${item.fileName} · ${Math.round(item.durationSec)}s · ${frames.length} frames sampled${rangeApplied ? ` (dense-sampled within ${ann!.rangeText})` : ""}`;
        // 구간은 head 에 이미 반영했으니 본문에는 포인트만.
        const annLines = formatAnnotationLines(ann, { includeRange: !rangeApplied });
        return [head, ...annLines].join("\n");
      });
      // 이미지 레퍼런스 부연설명 — 이미지 자체는 별도 분석 파이프라인으로 넘기지만,
      // 사용자가 적은 포인트는 메인 분석 프롬프트에 텍스트로 합류시켜 가중치를 높인다.
      const imgNoteLines: string[] = [];
      const imageIdxMap = new Map<string, number>();
      {
        let idx = 1;
        for (const it of refItems) {
          if (it.kind === "image") {
            imageIdxMap.set(it.id, idx);
            idx++;
          }
        }
      }
      for (const [id, n] of imageIdxMap) {
        const img = refItems.find((it) => it.id === id) as RefImageItem | undefined;
        if (!img || !hasAnnotation(img.annotation)) continue;
        const annLines = formatAnnotationLines(img.annotation, { includeRange: false });
        if (annLines.length === 0) continue;
        imgNoteLines.push([`- Image ${n}`, ...annLines].join("\n"));
      }
      if (ytLines.length || vidLines.length || imgNoteLines.length) {
        // 사용자가 어느 레퍼런스 하나에라도 부연설명을 달았으면, 분석기가 이를
        // 강한 힌트로 반영하도록 상단에 지시문 한 줄을 붙인다. 부연설명이 전혀
        // 없는 일반 케이스에서는 지시문을 생략해 불필요한 톤 변경을 피함.
        const hasAnyUserNotes = refItems.some((it) => hasAnnotation(it.annotation));
        const directive = hasAnyUserNotes
          ? "Each reference below may carry a 'Time range' and 'Focus points' — these are explicit, user-highlighted learning points. Prioritize extracting the technique, timing and staging from those sections over other elements.\n\n"
          : "";
        videoInsightsBlock = directive + [
          ytLines.length ? `### YouTube References\n${ytLines.join("\n")}` : "",
          vidLines.length ? `### Video References\n${vidLines.join("\n")}` : "",
          imgNoteLines.length ? `### Image Reference Notes\n${imgNoteLines.join("\n")}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
      }

      // 모델이 video 를 지원 안 하는데 사용자가 (모델 변경 전) 등록만 해둔 경우
      const ignoredVideoCount = refItems.filter((it) => it.ignoredByModel).length;
      if (ignoredVideoCount > 0) {
        toast({
          title: "Some references skipped",
          description: `${ignoredVideoCount} non-image reference(s) were ignored — the current model does not support them.`,
        });
      }

      // ── 3) 모델 호출: image-frame 첨부는 GPT-5.x 일 때만 ──
      const extraFrameImages: Array<{ base64: string; mediaType: string }> = modelSupportsVideo
        ? sampledVideos.flatMap(({ frames }) => frames).slice(0, 16) // 안전 상한
        : [];

      if (briefImages.length > 0 || extraFrameImages.length > 0) {
        const allImages = [
          ...briefImages.map((i) => ({ base64: i.base64, mediaType: i.mediaType })),
          ...extraFrameImages,
        ];
        result = await analyzeBriefWithImages(
          allImages,
          [
            briefText.trim(),
            imageAnalysis ? `스타일 레퍼런스 분석: ${imageAnalysis}` : "",
            videoInsightsBlock ? `영상 레퍼런스 인사이트:\n${videoInsightsBlock}` : "",
            ideaNote.trim() ? `크리에이터 아이디어 메모: ${ideaNote.trim()}` : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
          analysisLang,
          briefModelId,
        );
        currentSourceType = "image";
      } else if (pdfState === "ready") {
        let txt = `[PDF 브리프: ${pdfFileName}]\n\n${pdfExtractedText}`;
        if (briefText.trim()) txt += `\n\n## 추가 텍스트\n${briefText.trim()}`;
        if (imageAnalysis) txt += `\n\n## 첨부 이미지 스타일 분석\n${imageAnalysis}`;
        if (videoInsightsBlock) txt += `\n\n## 영상 레퍼런스 인사이트\n${videoInsightsBlock}`;
        if (ideaNote.trim()) txt += `\n\n## 크리에이터 아이디어 메모\n${ideaNote.trim()}`;
        result = await analyzeBriefText(txt, analysisLang, briefModelId);
        currentSourceType = "pdf";
      } else {
        let txt = briefText.trim();
        if (imageAnalysis) txt += `\n\n## 첨부 이미지 스타일 분석\n${imageAnalysis}`;
        if (videoInsightsBlock) txt += `\n\n## 영상 레퍼런스 인사이트\n${videoInsightsBlock}`;
        if (ideaNote.trim()) txt += `\n\n## 크리에이터 아이디어 메모\n${ideaNote.trim()}`;
        result = await analyzeBriefText(txt, analysisLang, briefModelId);
        currentSourceType = "text";
      }

      if (ideaNote.trim()) result.idea_note = ideaNote.trim();
      if (imageAnalysis) result.image_analysis = imageAnalysis;

      setAnalysis(result);
      setAnalysisEn(null); // invalidate EN cache
      // ★ analysisLang은 유지 — 사용자가 선택한 언어 보존
      setSourceType(currentSourceType);
      setAnalyzedAt(new Date().toISOString());

      const payload: any = {
        raw_text: pdfState === "ready" ? pdfExtractedText : briefText.trim(),
        analysis: result as any,
        analysis_en: null,
        lang: analysisLang, // ★ DB에 lang 저장
        source_type: currentSourceType,
        image_urls: null,
      };

      if (existingBrief) {
        await supabase.from("briefs").update(payload).eq("id", existingBrief.id);
      } else {
        const { data: nb } = await supabase
          .from("briefs")
          .insert({ project_id: projectId, ...payload })
          .select()
          .single();
        if (nb) setExistingBrief(nb as unknown as Brief);
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Analysis error",
        description: "Something went wrong while analyzing the brief. Please try again.",
      });
    } finally {
      // loader 가 100% 스냅 연출 후 사라지도록 lingering 플래그 on —
      // AnalysisLoader onHidden 에서 off.
      setLoaderLingering(true);
      setAnalyzing(false);
    }
  };

  const copyAll = () => {
    if (!analysis) return;
    let text: string;
    if (isDeepAnalysis(analysis)) {
      const a = analysis;
      text = [
        `캠페인 목표: ${a.goal.summary}\n${a.goal.items.map((g) => `• ${g}`).join("\n")}`,
        `타겟: ${a.target.summary}\n${a.target.primary.map((t) => `• ${t}`).join("\n")}`,
        `USP: ${a.usp.summary}\n${a.usp.items.map((u) => `• ${u}`).join("\n")}`,
        `톤앤매너: ${a.tone_manner.summary}\n키워드: ${a.tone_manner.keywords.join(", ")}`,
        `제작 노트\n포맷: ${a.production_notes.format_recommendation}`,
      ].join("\n\n");
    } else {
      const l = analysis as LegacyAnalysis;
      text = [
        `목표:\n${l.goal.map((g) => `• ${g}`).join("\n")}`,
        `타겟:\n${l.target.map((t) => `• ${t}`).join("\n")}`,
        `USP:\n${l.usp.map((u) => `• ${u}`).join("\n")}`,
        `톤앤매너:\n${l.tone_manner.map((t) => `• ${t}`).join("\n")}`,
      ].join("\n\n");
    }
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: "Analysis copied to clipboard." });
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const hasAnalysis = !!analysis && !analyzing;
  const isCollapsedMode = hasAnalysis;

  const briefTextPreview = briefText.trim()
    ? briefText.trim().slice(0, 60) + (briefText.trim().length > 60 ? "…" : "")
    : "Empty";
  const moodboardPreview = refItems.length > 0 ? summarizeRefsLabel(refCounts) || `${refItems.length} item${refItems.length > 1 ? "s" : ""}` : "Empty";
  const ideaNotePreview = ideaNote.trim()
    ? ideaNote.trim().slice(0, 60) + (ideaNote.trim().length > 60 ? "…" : "")
    : "Empty";

  const renderBriefTextContent = () => (
    <>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setComposerDragOver(true);
        }}
        onDragLeave={() => setComposerDragOver(false)}
        onDrop={handleComposerDrop}
        className={`overflow-hidden border bg-input transition-colors ${composerDragOver ? "border-primary/50" : "border-input focus-within:border-primary/50"}`}
        style={{
          borderRadius: 0,
          ...(composerDragOver ? { background: "rgba(249,66,58,0.04)" } : {}),
        }}
      >
        <textarea
          value={briefText}
          onChange={(e) => setBriefText(e.target.value.slice(0, 5000))}
          placeholder="Enter your brief — production goals, target audience, key message, references, etc."
          className={`w-full border-none outline-none resize-none text-[12px] font-[inherit] text-foreground bg-transparent px-3 pt-3 pb-2 leading-relaxed placeholder:text-muted-foreground/40 ${isCollapsedMode ? "h-[100px]" : "h-[140px]"}`}
        />
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-border bg-input">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
            <path d="M3 10l3-3 3 3M9 7l3-3 3 3" />
            <path d="M1 13h14" />
          </svg>
          <span className="font-mono text-[10px] text-muted-foreground/40">IMG · PDF DROP</span>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground/30">{briefText.length} / 5000</span>
        </div>
      </div>

      {briefImages.length > 0 && (
        <div className="border border-border p-2" style={{ borderRadius: 0 }}>
          <p className="label-meta text-muted-foreground mb-1.5">BRIEF_IMAGES</p>
          <div className="flex gap-2 flex-wrap">
            {briefImages.map((img, i) => (
              <div key={i} className="relative group">
                <img
                  src={img.preview}
                  alt=""
                  onClick={() => setLightboxSrc(img.preview)}
                  className="h-[56px] w-[56px] object-cover border border-border cursor-zoom-in"
                  style={{ borderRadius: 0 }} loading="lazy" decoding="async" />
                <button
                  onClick={() => removeBriefImage(i)}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-primary text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ borderRadius: 0 }}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
            {briefImages.length < 3 && (
              <div
                className="h-[56px] w-[56px] border border-dashed border-border flex flex-col items-center justify-center gap-0.5"
                style={{ borderRadius: 0 }}
              >
                <span className="font-mono text-[9px] text-muted-foreground/30">+DROP</span>
              </div>
            )}
          </div>
        </div>
      )}

      {pdfState === "extracting" && (
        <div className="flex items-center gap-2 px-3 py-2.5 bg-input border border-border" style={{ borderRadius: 0 }}>
          <FileText className="w-4 h-4 text-primary shrink-0" />
          <span className="font-mono text-[11px] text-muted-foreground flex-1 truncate">{pdfFileName}</span>
          <div className="w-20 h-1 bg-border overflow-hidden" style={{ borderRadius: 0 }}>
            <div className="h-full bg-primary animate-pulse" style={{ width: "70%", borderRadius: 0 }} />
          </div>
        </div>
      )}
      {pdfState === "ready" && (
        <div className="flex items-center gap-2 px-3 py-2.5 bg-input border border-border" style={{ borderRadius: 0 }}>
          <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] text-foreground truncate font-medium">{pdfFileName}</p>
            {pdfPageInfo && (
              <p className="font-mono text-[10px] text-muted-foreground">
                {pdfPageInfo.pages}P · {pdfPageInfo.chars.toLocaleString()} CHARS
              </p>
            )}
          </div>
          <button onClick={resetPdf} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {pdfState === "error" && (
        <div
          className="flex items-center gap-2 px-3 py-2.5 border"
          style={{ borderRadius: 0, background: "rgba(249,66,58,0.06)", borderColor: "rgba(249,66,58,0.2)" }}
        >
          <AlertCircle className="w-4 h-4 text-primary shrink-0" />
          <p className="font-mono text-[10px] text-primary flex-1">PDF_EXTRACT_FAILED — SCAN IMG NOT SUPPORTED</p>
          <button onClick={resetPdf} className="text-[11px] text-primary underline shrink-0">
            닫기
          </button>
        </div>
      )}
    </>
  );

  const renderMoodboardContent = () => {
    const acceptAttr = supportsVideoFrames
      ? "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
      : "image/jpeg,image/png,image/webp";
    const dropHintLabel = supportsVideoFrames
      ? "DRAG OR CLICK · IMG / VIDEO · MAX 8"
      : "DRAG OR CLICK · IMG ONLY · MAX 8";
    const slotsLeft = REF_TOTAL_LIMIT - refItems.length;

    const renderTile = (item: RefItem) => {
      const ignored = !!item.ignoredByModel;
      const tileBaseStyle: React.CSSProperties = {
        borderRadius: 0,
        opacity: ignored ? 0.4 : 1,
        filter: ignored ? "grayscale(100%)" : undefined,
      };
      const annotated = hasAnnotation(item.annotation);
      const includeRange = item.kind !== "image";
      // 공통 오버레이: 주석 인디케이터(좌하단 점) + 연필 아이콘(우하단 hover)
      const overlayControls = (
        <>
          {annotated && !ignored && (
            <span
              className="pointer-events-none absolute bottom-0.5 left-0.5 w-1.5 h-1.5 bg-primary"
              style={{ borderRadius: "9999px" }}
              aria-hidden
            />
          )}
          <RefNoteEditor
            item={item}
            includeRange={includeRange}
            onSave={(ann) => setRefItemAnnotation(item.id, ann)}
            disabled={ignored}
          />
        </>
      );
      if (item.kind === "image") {
        return (
          <div key={item.id} className="relative group">
            <img
              src={item.preview}
              alt=""
              onClick={() => !ignored && setLightboxSrc(item.preview)}
              className="h-[54px] w-[54px] object-cover border border-border cursor-zoom-in"
              style={tileBaseStyle}
              loading="lazy"
              decoding="async"
            />
            {ignored && (
              <span className="absolute bottom-0 left-0 right-0 text-center font-mono text-[8px] text-white bg-black/60">
                IGNORED
              </span>
            )}
            {overlayControls}
            <button
              onClick={() => removeRefItem(item.id)}
              className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-primary text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ borderRadius: 0 }}
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        );
      }
      if (item.kind === "youtube") {
        const thumb = item.thumbnailUrl;
        return (
          <div key={item.id} className="relative group">
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="block h-[54px] w-[54px] border border-border bg-black flex items-center justify-center"
              style={tileBaseStyle}
              title={item.title || item.url}
            >
              {thumb ? (
                // eslint-disable-next-line jsx-a11y/alt-text
                <img src={thumb} className="h-full w-full object-cover" loading="lazy" decoding="async" />
              ) : item.status === "loading" ? (
                <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
              ) : item.status === "error" ? (
                <AlertCircle className="w-4 h-4 text-primary" />
              ) : (
                <YoutubeIcon className="w-4 h-4 text-muted-foreground" />
              )}
              <span className="absolute top-0 left-0 px-1 py-[1px] font-mono text-[8px] text-white bg-red-600/90">YT</span>
              {ignored && (
                <span className="absolute bottom-0 left-0 right-0 text-center font-mono text-[8px] text-white bg-black/60">
                  IGNORED
                </span>
              )}
            </a>
            {overlayControls}
            <button
              onClick={() => removeRefItem(item.id)}
              className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-primary text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ borderRadius: 0 }}
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        );
      }
      // video
      const posterSrc = item.posterBase64 ? refToDataUrl(item.posterBase64, "image/png") : null;
      return (
        <div key={item.id} className="relative group">
          <div
            className="h-[54px] w-[54px] border border-border bg-black overflow-hidden flex items-center justify-center"
            style={tileBaseStyle}
            title={`${item.fileName} · ${Math.round(item.durationSec)}s`}
          >
            {posterSrc ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <img src={posterSrc} className="h-full w-full object-cover" loading="lazy" decoding="async" />
            ) : item.status === "sampling" ? (
              <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
            ) : item.status === "error" ? (
              <AlertCircle className="w-4 h-4 text-primary" />
            ) : (
              <Film className="w-4 h-4 text-muted-foreground" />
            )}
            <span className="absolute top-0 left-0 px-1 py-[1px] font-mono text-[8px] text-white bg-blue-600/90">VID</span>
            {ignored && (
              <span className="absolute bottom-0 left-0 right-0 text-center font-mono text-[8px] text-white bg-black/60">
                IGNORED
              </span>
            )}
          </div>
          {overlayControls}
          <button
            onClick={() => removeRefItem(item.id)}
            className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-primary text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ borderRadius: 0 }}
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </div>
      );
    };

    return (
      <>
        <input
          ref={refFileInputRef}
          type="file"
          accept={acceptAttr}
          multiple
          className="hidden"
          onChange={(e) => {
            handleRefFileSelect(e.target.files);
            e.target.value = "";
          }}
        />

        {/* ── URL 인풋 (모델이 video frames 지원할 때만) ── */}
        {supportsVideoFrames ? (
          <div
            className="flex items-center gap-1.5 px-2 py-1 mb-2 border bg-input"
            style={{ borderRadius: 0, borderColor: "rgba(255,255,255,0.07)" }}
          >
            <LinkIcon className="w-3 h-3 text-muted-foreground/40 shrink-0" />
            <input
              type="url"
              value={refUrlInput}
              onChange={(e) => setRefUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (refUrlInput.trim()) {
                    addYoutubeRef(refUrlInput);
                    setRefUrlInput("");
                  }
                }
              }}
              placeholder="Paste YouTube URL & press Enter"
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-[11px] text-foreground placeholder:text-muted-foreground/30"
            />
            {refUrlInput.trim() && (
              <button
                onClick={() => {
                  if (refUrlInput.trim()) {
                    addYoutubeRef(refUrlInput);
                    setRefUrlInput("");
                  }
                }}
                className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
              >
                ADD
              </button>
            )}
          </div>
        ) : (
          <div
            className="flex items-center gap-1.5 px-2 py-1 mb-2 border border-dashed overflow-hidden"
            style={{ borderRadius: 0, borderColor: "rgba(255,255,255,0.07)" }}
            title="Switch to GPT-5.x in the header to enable links & video uploads"
          >
            <EyeOff className="w-3 h-3 text-muted-foreground/30 shrink-0" />
            {/* 컨테이너가 좁으면 2줄로 깨지던 문구. whitespace-nowrap + truncate
             *  로 항상 한 줄에 유지하고, 폭이 부족하면 말줄임표로 축약.
             *  원문 title 로 전체 문구는 hover 툴팁에서 읽을 수 있음. */}
            <span className="font-mono text-[10px] text-muted-foreground/40 whitespace-nowrap truncate min-w-0">
              IMG-ONLY MODE · CHANGE MODEL FOR LINK / VIDEO
            </span>
          </div>
        )}

        {/* ── 드롭존 / 타일 ── */}
        {refItems.length === 0 ? (
          <div
            onClick={() => refFileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setRefDragOver(true);
            }}
            onDragLeave={() => setRefDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setRefDragOver(false);
              handleRefFileSelect(e.dataTransfer.files);
            }}
            className="h-[60px] border border-dashed flex items-center justify-center gap-2 cursor-pointer transition-colors"
            style={{
              borderRadius: 0,
              borderColor: refDragOver ? "rgba(249,66,58,0.5)" : "rgba(255,255,255,0.1)",
              background: refDragOver ? "rgba(249,66,58,0.04)" : "transparent",
            }}
          >
            <ImagePlus className="w-4 h-4 text-muted-foreground/30" />
            <p className="font-mono text-[10px] text-muted-foreground/40">{dropHintLabel}</p>
          </div>
        ) : (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setRefDragOver(true);
            }}
            onDragLeave={() => setRefDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setRefDragOver(false);
              handleRefFileSelect(e.dataTransfer.files);
            }}
            className="border p-2 transition-colors"
            style={{
              borderRadius: 0,
              borderColor: refDragOver ? "rgba(249,66,58,0.5)" : "rgba(255,255,255,0.07)",
              background: refDragOver ? "rgba(249,66,58,0.04)" : "transparent",
            }}
          >
            <div className="flex gap-2 flex-wrap">
              {refItems.map(renderTile)}
              {slotsLeft > 0 && (
                <button
                  onClick={() => refFileInputRef.current?.click()}
                  className="h-[54px] w-[54px] border border-dashed border-border hover:border-primary/40 flex flex-col items-center justify-center gap-0.5 transition-colors"
                  style={{ borderRadius: 0 }}
                  title="Add more references"
                >
                  <Plus className="w-3.5 h-3.5 text-muted-foreground/30" />
                </button>
              )}
            </div>
            {refCounts.ignored > 0 && (
              <p className="font-mono text-[9px] text-muted-foreground/50 mt-1.5">
                {refCounts.ignored} ITEM(S) IGNORED — UNSUPPORTED BY CURRENT MODEL
              </p>
            )}
          </div>
        )}
      </>
    );
  };

  const renderIdeaNoteContent = () => (
    <div
      className="overflow-hidden border border-input bg-input transition-colors focus-within:border-primary/50"
      style={{ borderRadius: 0 }}
    >
      <textarea
        value={ideaNote}
        onChange={(e) => setIdeaNote(e.target.value.slice(0, 2000))}
        placeholder="Scenes, moods, and references — feel free to share."
        className="w-full h-[60px] border-none outline-none resize-none text-[11px] font-[inherit] text-foreground bg-transparent px-3 py-2 leading-relaxed placeholder:text-muted-foreground/30"
      />
    </div>
  );

  /* ━━━━━ RENDER ━━━━━ */
  return (
    <div className="flex gap-3 h-full">
      {/* ── LEFT: Input Panel ── */}
      <div
        className={`shrink-0 ${isMobile ? "w-full" : ""}`}
        style={
          isMobile
            ? {}
            : {
                width: isCollapsedMode ? 260 : 300,
                minWidth: isCollapsedMode ? 220 : undefined,
                maxWidth: isCollapsedMode ? 280 : undefined,
              }
        }
      >
        <div className="bg-card/80 border border-border flex flex-col h-full" style={{ borderRadius: 0 }}>
          {/* ★ Header — Creative Input + Model picker + KO/EN toggle
           *  컨테이너 너비가 좁아지면 ModelPicker 의 모델 라벨은 truncate
           *  되도록 `min-w-0 flex-1` 로 공간을 양보하고, LangToggle 은 항상
           *  `shrink-0` 으로 온전히 보이게 고정. `Creative Input` 타이틀 역시
           *  min-w-0 + truncate 로 필요하면 줄여서 토글 잘림을 방지. */}
          <div className="px-4 pt-4 pb-3 border-b border-border flex items-center gap-2">
            <h2 className="text-[13px] font-bold tracking-wider text-foreground min-w-0 truncate">
              Creative Input
            </h2>
            <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
              <div className="min-w-0 flex-shrink">
                <ModelPicker stage="brief" projectId={projectId} variant="compact" className="max-w-full" />
              </div>
              <div className="shrink-0">
                <LangToggle
                  lang={analysisLang}
                  onChange={(l) => {
                    if (hasAnalysis) handleLangToggle(l);
                    else setAnalysisLang(l);
                  }}
                  loading={translating}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col flex-1 px-5 pt-3 pb-4 gap-4 overflow-y-auto">
            {isCollapsedMode ? (
              <>
                <CollapsibleSection title="Brief Text" preview={briefTextPreview}>
                  {renderBriefTextContent()}
                </CollapsibleSection>
                <CollapsibleSection title="Reference" preview={moodboardPreview}>
                  {renderMoodboardContent()}
                </CollapsibleSection>
                <CollapsibleSection title="Idea Note" preview={ideaNotePreview}>
                  {renderIdeaNoteContent()}
                </CollapsibleSection>
                <button
                  onClick={handleAnalyze}
                  disabled={!canAnalyze || analyzing}
                  className="w-full h-[36px] text-[11px] font-semibold tracking-wider text-muted-foreground border border-border transition-colors flex items-center justify-center gap-2 mt-auto hover:text-foreground hover:border-foreground/20 disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ borderRadius: 0 }}
                >
                  <RefreshCw className="w-3 h-3" />
                  Re-analyze
                </button>
              </>
            ) : (
              <>
                <div>
                  <p className="label-meta text-primary mb-1">Brief Text</p>
                  {renderBriefTextContent()}
                </div>
                <div>
                  <p className="label-meta text-primary mb-1">Reference</p>
                  {renderMoodboardContent()}
                </div>
                <div>
                  <p className="label-meta text-primary mb-1">
                    Idea Note <span className="font-normal opacity-50">(Optional)</span>
                  </p>
                  {renderIdeaNoteContent()}
                </div>
                <button
                  onClick={handleAnalyze}
                  disabled={!canAnalyze || analyzing}
                  className="w-full h-[40px] text-[12px] font-semibold tracking-wider text-white transition-colors flex items-center justify-center gap-2 mt-auto disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{
                    borderRadius: 0,
                    background: analyzing ? "rgba(249,66,58,0.4)" : "#f9423a",
                  }}
                  onMouseEnter={(e) => {
                    if (!analyzing && canAnalyze) (e.currentTarget as HTMLElement).style.background = "#e03530";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = analyzing ? "rgba(249,66,58,0.4)" : "#f9423a";
                  }}
                >
                  {analyzing ? "Analyzing..." : "✦ Execute Analysis"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── CENTER: Strategy Manifesto ── */}
      {(hasAnalysis || analyzing || loaderLingering) && (
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="border border-border overflow-hidden flex flex-col h-full" style={{ borderRadius: 0 }}>
            <div
              className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0"
              style={{ background: "rgba(249,66,58,0.06)" }}
            >
              <h2 className="text-[13px] font-bold tracking-wider text-foreground">Strategy Manifesto</h2>
              {showEditHint && (
                <span
                  className="text-[10px] px-2 py-0.5 rounded-none animate-fade-in"
                  style={{
                    background: "rgba(249,66,58,0.12)",
                    color: "#f9423a",
                    border: "1px solid rgba(249,66,58,0.2)",
                  }}
                >
                  텍스트를 클릭하여 편집할 수 있습니다
                </span>
              )}
              {hasAnalysis && (
                <>
                  <div
                    className="ml-auto flex items-center gap-1"
                    style={{ background: "rgba(255,255,255,0.04)", borderRadius: 0, padding: 2 }}
                  >
                    <button
                      onClick={() => setViewMode("list")}
                      className="flex items-center justify-center transition-colors"
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 0,
                        background: viewMode === "list" ? "rgba(249,66,58,0.14)" : "transparent",
                        color: viewMode === "list" ? "#f9423a" : "#666",
                      }}
                    >
                      <LayoutList className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setViewMode("slide")}
                      className="flex items-center justify-center transition-colors"
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 0,
                        background: viewMode === "slide" ? "rgba(249,66,58,0.14)" : "transparent",
                        color: viewMode === "slide" ? "#f9423a" : "#666",
                      }}
                    >
                      <GalleryHorizontalEnd className="w-3.5 h-3.5" />
                    </button>
                  </div>

                   {/* ★ Result area lang toggle — removed, now in Creative Input header */}
                </>
              )}
            </div>

            <div className="flex-1 overflow-y-auto bg-background/60 p-4">
              {analyzing || loaderLingering ? (
                <AnalysisLoader
                  active={analyzing}
                  mode={pdfState === "ready" ? "pdf" : "default"}
                  variant="full"
                  onHidden={() => setLoaderLingering(false)}
                />
              ) : analysis ? (
                (() => {
                  const displayAnalysis = analysisLang === "en" && analysisEn ? analysisEn : analysis;
                  if (isDeepAnalysis(displayAnalysis)) {
                    return viewMode === "slide" ? (
                      <SlideViewUI analysis={displayAnalysis} lang={analysisLang} onUpdate={updateAnalysisField} />
                    ) : (
                      <CoreStrategyUI analysis={displayAnalysis} lang={analysisLang} onUpdate={updateAnalysisField} />
                    );
                  }
                  return <LegacyResultUI analysis={displayAnalysis as LegacyAnalysis} lang={analysisLang} />;
                })()
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {!hasAnalysis && !analyzing && (
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="border border-border overflow-hidden flex flex-col h-full" style={{ borderRadius: 0 }}>
            <div
              className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0"
              style={{ background: "rgba(249,66,58,0.06)" }}
            >
              <h2 className="text-[13px] font-bold tracking-wider text-foreground">Strategy Manifesto</h2>
            </div>
            <div className="flex-1 overflow-y-auto bg-background/60 p-4">
              <div className="flex flex-col items-center justify-center h-full min-h-[360px]">
                <BarChart3 className="w-8 h-8 text-muted-foreground/20 mb-3" />
                <p className="text-[13px] font-bold tracking-wider text-muted-foreground/40">No Analysis Yet</p>
                <p className="font-mono text-[10px] text-muted-foreground/25 mt-1">Input brief → Execute Analysis</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── RIGHT: Production Guide + Actions ── */}
      {!isMobile && hasAnalysis && (
        <div className="shrink-0" style={{ width: 380, minWidth: 340 }}>
          <div className="border border-border flex flex-col h-full overflow-hidden" style={{ borderRadius: 0 }}>
            <div
              className="px-4 pt-4 pb-3 shrink-0"
              style={{
                position: "sticky",
                top: 0,
                zIndex: 10,
                background: "hsl(var(--background))",
                boxShadow: "0 1px 0 rgba(255,255,255,0.06)",
              }}
            >
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-[11px] font-medium text-emerald-400">Analysis Complete</span>
                  {analyzedAt && (
                    <span className="font-mono text-[10px] text-muted-foreground/50 ml-auto">
                      {formatDate(analyzedAt)}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setShowNextStepModal(true)}
                  className="w-full h-[44px] text-[12px] font-semibold tracking-wider text-white transition-colors flex items-center justify-center gap-2"
                  style={{ borderRadius: 0, background: "#f9423a" }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "#e03530";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "#f9423a";
                  }}
                >
                  Execute Strategy →
                </button>
                <div className="flex items-center gap-3">
                  <button
                    onClick={copyAll}
                    className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Copy className="w-3 h-3" />
                    Copy
                  </button>
                  <button
                    onClick={handleAnalyze}
                    disabled={!canAnalyze || analyzing}
                    className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Re-analyze
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              {analysis &&
                isDeepAnalysis(analysis) &&
                (() => {
                  const displayAnalysis = analysisLang === "en" && analysisEn ? analysisEn : analysis;
                  return isDeepAnalysis(displayAnalysis) ? (
                    <ProductionGuideUI analysis={displayAnalysis} lang={analysisLang} onUpdate={updateAnalysisField} />
                  ) : null;
                })()}
            </div>
          </div>
        </div>
      )}

      {/* ── RIGHT: Action Panel (no analysis) ── */}
      {!isMobile && !hasAnalysis && (
        <div className="w-[200px] shrink-0">
          <div className="bg-card/80 border border-border flex flex-col h-full" style={{ borderRadius: 0 }}>
            <div className="px-4 pt-4 pb-3 border-b border-border">
              <h2 className="text-[13px] font-bold tracking-wider text-foreground">Next Step</h2>
            </div>
            <div className="flex flex-col flex-1 px-3 pt-4 pb-4 gap-4">
              {analyzing ? (
                <AnalysisLoader active={analyzing} variant="compact" />
              ) : (
                <div className="flex flex-col items-center justify-center flex-1 gap-2 text-center">
                  <span className="font-mono text-[10px] text-muted-foreground/30 uppercase leading-relaxed">
                    Run analysis first to proceed
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showNextStepModal && (
        <NextStepModal
          onClose={() => setShowNextStepModal(false)}
          onGoAssets={() => onSwitchToAssets?.()}
          onGoAgent={() => onSwitchToAgent(analysisLang)}
          analysisLang={analysisLang}
        />
      )}

      {lightboxSrc && (
        <div
          onClick={() => setLightboxSrc(null)}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 cursor-zoom-out"
        >
          <button
            onClick={() => setLightboxSrc(null)}
            className="absolute top-4 right-4 w-8 h-8 bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
            style={{ borderRadius: 0 }}
          >
            <X className="w-4 h-4 text-white" />
          </button>
          <img
            src={lightboxSrc}
            alt="Original image"
            onClick={(e) => e.stopPropagation()}
            className="max-w-[90vw] max-h-[90vh] object-contain shadow-2xl cursor-default"
            style={{ borderRadius: 0 }} loading="lazy" decoding="async" />
        </div>
      )}
    </div>
  );
};

/* ━━━━━ Reference 부연설명 에디터 ━━━━━
 *
 * 각 RefItem 타일 우하단에 연필 아이콘을 띄우고, 클릭 시 Popover 로
 * 관심 구간 + 보고 싶은 포인트를 편집한다. 이미지 타일에서는 구간 입력 숨김.
 * `onSave` 는 빈 값으로 호출되면 상위에서 annotation 필드 자체를 제거. */
interface RefNoteEditorProps {
  item: RefItem;
  includeRange: boolean;
  disabled?: boolean;
  onSave: (next: RefAnnotation | undefined) => void;
}
const RefNoteEditor = ({ item, includeRange, disabled, onSave }: RefNoteEditorProps) => {
  const [open, setOpen] = useState(false);
  const [rangeText, setRangeText] = useState(item.annotation?.rangeText ?? "");
  const [notes, setNotes] = useState(item.annotation?.notes ?? "");
  const [rangeError, setRangeError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRangeText(item.annotation?.rangeText ?? "");
      setNotes(item.annotation?.notes ?? "");
      setRangeError(null);
    }
  }, [open, item.annotation?.rangeText, item.annotation?.notes]);

  const handleSave = () => {
    const trimmedRange = rangeText.trim();
    const trimmedNotes = notes.trim();
    let startSec: number | undefined;
    let endSec: number | undefined;
    if (includeRange && trimmedRange) {
      const parsed = parseTimeRange(trimmedRange);
      if (parsed) {
        startSec = parsed.startSec;
        endSec = parsed.endSec;
      } else if (!rangeError) {
        setRangeError("Invalid format — frame sampling will stay on the full clip (expected e.g. 00:12~00:15). Click Save again to keep text only.");
        return;
      }
    }
    const next: RefAnnotation = {
      rangeText: trimmedRange && includeRange ? trimmedRange : undefined,
      startSec,
      endSec,
      notes: trimmedNotes || undefined,
    };
    onSave(next);
    setOpen(false);
  };

  const handleClear = () => {
    setRangeText("");
    setNotes("");
    onSave(undefined);
    setOpen(false);
  };

  if (disabled) return null;

  const hasExisting = hasAnnotation(item.annotation);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          aria-label={hasExisting ? "Edit reference note" : "Add reference note"}
          className={
            "absolute -bottom-1.5 -right-1.5 w-4 h-4 bg-foreground text-background flex items-center justify-center " +
            (hasExisting ? "opacity-100" : "opacity-0 group-hover:opacity-100") +
            " transition-opacity"
          }
          style={{ borderRadius: 0 }}
        >
          <Pencil className="w-2.5 h-2.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-80 p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-3">
          <div className="text-[11px] font-medium tracking-wide text-primary">
            Reference Note
          </div>
          {includeRange && (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">Time range</span>
              <input
                type="text"
                value={rangeText}
                onChange={(e) => {
                  setRangeText(e.target.value);
                  setRangeError(null);
                }}
                placeholder="00:12~00:15"
                className="h-8 px-2 text-[12px] border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                style={{ borderRadius: 0 }}
              />
              {rangeError && (
                <span className="text-[10px] text-primary">{rangeError}</span>
              )}
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Points to focus on</span>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={"- How the weapon enters via the scan line\n- Timing of the UI overlay"}
              className="min-h-[90px] text-[12px]"
            />
          </label>
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={handleClear}
              className="h-8 px-2 text-[12px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-8 px-3 text-[12px] border border-border hover:bg-secondary"
                style={{ borderRadius: 0 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="h-8 px-3 text-[12px] bg-primary text-primary-foreground hover:bg-primary/85"
                style={{ borderRadius: 0 }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

/* ━━━━━ Execute Analysis 로딩 체감 개선 ━━━━━
 *
 * LLM 분석은 Promise 단일 resolve 라 중간 진행 이벤트가 없다. 실제 진행률을
 * 모르면서도 "멈춘 듯한" 인상을 줄이기 위해 두 축을 도입:
 *   A. asymptotic 진행률 바 (0 → 95% log 곡선) — 완료 시 100% 스냅 + 300ms fade
 *   B. 실제 파이프라인 단계를 반영한 5개 스테이지 메시지 로테이션
 * 둘 다 "거짓말" 아님 — 분석 시 실제로 저 단계들이 (순차적으로) 일어남. */
const ANALYSIS_STAGES = [
  "Parsing brief...",
  "Extracting hooks & story beats...",
  "Scoring ABCD metrics...",
  "Mapping audience insights...",
  "Finalizing strategy...",
];

function useFakeAnalysisProgress(active: boolean) {
  const [pct, setPct] = useState(0);
  const [stageIdx, setStageIdx] = useState(0);
  useEffect(() => {
    if (!active) {
      setPct(0);
      setStageIdx(0);
      return;
    }
    const started = Date.now();
    // 1 - e^(-t/tau), tau=8s → 10s 지점 ~71%, 20s 지점 ~92%, 상한 95%.
    // tick 120ms 면 바의 transition-[width] duration-500 과 어우러져 부드럽게 차오름.
    const tick = setInterval(() => {
      const t = (Date.now() - started) / 1000;
      const eased = 1 - Math.exp(-t / 8);
      setPct(Math.min(95, eased * 100));
    }, 120);
    const rotate = setInterval(() => {
      setStageIdx((i) => Math.min(i + 1, ANALYSIS_STAGES.length - 1));
    }, 3500);
    return () => {
      clearInterval(tick);
      clearInterval(rotate);
    };
  }, [active]);
  return { pct, stage: ANALYSIS_STAGES[stageIdx] };
}

/* 메인 결과 영역용 풀 로더 (spinner + 타이틀 + 스테이지 + 바 + 퍼센트).
 * compact variant 는 좁은 Next Step 사이드바 카드 안에서 쓰이며 스피너 생략. */
interface AnalysisLoaderProps {
  active: boolean;
  mode?: "default" | "pdf";
  variant?: "full" | "compact";
  onHidden?: () => void;
}
const AnalysisLoader = ({ active, mode = "default", variant = "full", onHidden }: AnalysisLoaderProps) => {
  const { pct, stage } = useFakeAnalysisProgress(active);
  const [displayPct, setDisplayPct] = useState(0);
  useEffect(() => {
    if (active) {
      setDisplayPct(pct);
      return;
    }
    // active=false 로 내려오는 순간: 100% 스냅 유지 후 300ms 뒤 onHidden.
    setDisplayPct(100);
    if (!onHidden) return;
    const t = setTimeout(onHidden, 300);
    return () => clearTimeout(t);
  }, [active, pct, onHidden]);

  if (variant === "compact") {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-2 text-center w-full">
        <span className="font-mono text-[10px] text-muted-foreground/50 leading-relaxed">
          {stage}
        </span>
        <div
          className="w-full h-1 rounded-full overflow-hidden"
          style={{ background: "rgba(255,255,255,0.06)" }}
        >
          <div
            className="h-full bg-primary/60 rounded-full transition-[width] duration-500 ease-out"
            style={{ width: `${displayPct}%` }}
          />
        </div>
        <span className="font-mono text-[9px] text-muted-foreground/30">
          {Math.round(displayPct)}%
        </span>
      </div>
    );
  }

  const headline = mode === "pdf" ? "Processing PDF Brief…" : "Generating Strategy Report…";
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-5">
      <div className="relative w-10 h-10">
        <span className="absolute inset-0 border-2 border-primary/20 rounded-full" />
        <span className="absolute inset-0 border-2 border-transparent border-t-primary rounded-full animate-spin" />
      </div>
      <div className="text-center space-y-1.5">
        <p className="text-[13px] font-semibold text-foreground">{headline}</p>
        <p className="font-mono text-[10px] text-muted-foreground/60 min-h-[14px] transition-opacity">
          {stage}
        </p>
      </div>
      <div className="w-48 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
        <div
          className="h-full bg-primary/70 rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${displayPct}%` }}
        />
      </div>
      <p className="font-mono text-[10px] text-muted-foreground/30">
        {Math.round(displayPct)}%
      </p>
    </div>
  );
};
