/**
 * Reference recommender — Phase 9.
 *
 * 라이브러리 자료의 메타(tags, notes, ai_suggestions, color_palette) 를 입력
 * 신호와 매칭해 점수를 매긴다. 추천 결과는 "추천 카드 + 짧은 매칭 이유"
 * 형태로 표시되며 (`reasons` 토큰), 사용자가 카드를 클릭하면 호출부가
 * `linkReferenceToProject` 로 실제 연결을 만든다.
 *
 * 의도적으로 LLM 을 부르지 않는다 — 추천은 즉시 떠야 하고 OpenAI 키가 없는
 * 환경에서도 동작해야 한다. AI 가 정해 놓은 메타(`ai_suggestions.suggested_tags`,
 * `mood_labels`, `use_cases`) 가 있으면 가중치를 더 주는 식으로만 합류시킨다.
 */

import type { ReferenceAiSuggestions } from "./referenceAi";
import type { ReferenceItem } from "./referenceLibrary";

/** Brief 분석 결과에서 뽑은 신호. 비어 있는 필드는 그냥 점수에 기여하지 않음. */
export interface BriefSignals {
  /** mood/tone keywords — 분석의 tone_manner.keywords 등에서 합류. */
  mood: string[];
  /** Genre / content type — "tutorial", "ad", "documentary" 같은 키워드. */
  genre: string[];
  /** 제품/주제 이름 후보 — 보통 제품명 1-2 개. */
  product: string[];
  /** 장소/환경 키워드. */
  location: string[];
  /** 그 외 자유 키워드 — 사용자 입력 텍스트 등 모든 토큰. */
  keywords: string[];
}

/** Conti / Agent 의 한 scene 에서 뽑은 신호. */
export interface SceneSignals {
  /** 카메라 샷 종류 — wide / close / handheld 등. */
  shot: string[];
  /** 동작 / 모션 키워드. */
  motion: string[];
  /** 장면 mood / 감정. */
  mood: string[];
  /** 그 외 키워드 — description, location, props 등. */
  keywords: string[];
}

export interface RecommendedReference {
  item: ReferenceItem;
  score: number;
  /** UI 칩에 띄울 사람-friendly 이유 토큰. 예: ["mood:tense","tag:neon"]. */
  reasons: string[];
}

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "in", "on", "for", "to", "with", "by",
  "is", "are", "was", "were", "be", "been", "being", "this", "that", "these",
  "those", "it", "its", "as", "at", "from", "into", "onto", "off", "over",
  "under", "but", "if", "than", "then", "so", "such",
]);

/** 자유 텍스트 → 소문자 토큰 배열. 한글은 그대로 보존, 영어/숫자만 normalize. */
function tokenize(input: string | null | undefined): string[] {
  if (!input || typeof input !== "string") return [];
  return input
    .toLowerCase()
    .split(/[\s,.;:!?()[\]{}"'`/\\|·•—–-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function normalizeArray(values: Array<string | null | undefined> | undefined): string[] {
  if (!values) return [];
  return [...new Set(values.flatMap((v) => tokenize(v)))];
}

/** 두 토큰 set 의 교집합. tokenize 가 이미 trim/lower 했다고 가정. */
function intersect(a: string[], b: string[]): string[] {
  if (a.length === 0 || b.length === 0) return [];
  const set = new Set(a);
  const out = new Set<string>();
  for (const t of b) if (set.has(t)) out.add(t);
  return [...out];
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 신호 추출
 *
 * Brief / Scene 양쪽에서 자주 쓰는 필드들을 받아 정규화. 호출부는 자기
 * 도메인의 어떤 데이터든 string / string[] 로 줄여 넘기면 된다 — 추천기는
 * 데이터 모양을 모른 채 토큰만 본다.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export interface ExtractBriefSignalsInput {
  /** tone_manner.keywords / mood — 정확히 알면 여기에. */
  mood?: Array<string | null | undefined>;
  /** content_type / hook_strategy.kind / production_notes.shooting_style 등. */
  genre?: Array<string | null | undefined>;
  /** product_info.brand / product_name / target_audience.primary 등. */
  product?: Array<string | null | undefined>;
  /** location 키워드. */
  location?: Array<string | null | undefined>;
  /** Free-form 텍스트 (raw_text, analysis.goal.summary, idea_note 등). */
  text?: Array<string | null | undefined>;
}

export function extractBriefSignals(input: ExtractBriefSignalsInput): BriefSignals {
  return {
    mood: normalizeArray(input.mood),
    genre: normalizeArray(input.genre),
    product: normalizeArray(input.product),
    location: normalizeArray(input.location),
    keywords: normalizeArray(input.text),
  };
}

export interface ExtractSceneSignalsInput {
  shot?: Array<string | null | undefined>;
  motion?: Array<string | null | undefined>;
  mood?: Array<string | null | undefined>;
  text?: Array<string | null | undefined>;
}

export function extractSceneSignals(input: ExtractSceneSignalsInput): SceneSignals {
  return {
    shot: normalizeArray(input.shot),
    motion: normalizeArray(input.motion),
    mood: normalizeArray(input.mood),
    keywords: normalizeArray(input.text),
  };
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 스코어링
 *
 * 가중치는 "사용자가 직접 단 태그 > AI 가 제안한 태그 > free-text" 순으로
 * 점차 작아진다. 가중치 합이 어디서든 명확히 0-100 사이에 들어오게 만들지는
 * 않는다 — 절대값이 아니라 정렬용 상대값이다.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const WEIGHTS = {
  userTag: 1.0,
  aiTag: 0.6,
  aiMoodLabel: 0.7,
  aiUseCase: 0.9,
  notes: 0.4,
  title: 0.5,
  /** last_used_at 가 최근 30일 이내면 약한 보너스 — 사용자가 최근에 손댄
   *  자료가 검색 의도와 가까울 가능성이 높다. */
  recencyBonus: 0.2,
  /** Brief 의 mood / Scene 의 mood / shot 같은 "전용" 신호와 매칭됐을 때만
   *  이유 토큰에 카테고리 prefix 를 붙여 사람이 읽기 쉽게 한다. 추가 가중치는
   *  주지 않음 — 이중 카운트 방지. */
} as const;

function recencyBonus(lastUsedAt: string | null | undefined): number {
  if (!lastUsedAt) return 0;
  const t = new Date(lastUsedAt).getTime();
  if (!Number.isFinite(t)) return 0;
  const ageDays = (Date.now() - t) / (1000 * 60 * 60 * 24);
  if (ageDays < 0) return 0;
  if (ageDays > 30) return 0;
  return WEIGHTS.recencyBonus * (1 - ageDays / 30);
}

interface MatchableTokens {
  /** key → token bucket. 같은 토큰이 여러 카테고리에 등장하면 각각의 가중치를 다 받는다. */
  buckets: Array<{ tokens: string[]; weight: number; reasonPrefix: string }>;
}

function tokensFromReference(item: ReferenceItem): MatchableTokens {
  const ai = (item.ai_suggestions ?? null) as Partial<ReferenceAiSuggestions> | null;
  const userTags = (item.tags ?? []).filter((tag) => !tag.startsWith("source:"));
  const folderTags = userTags.filter((tag) => tag.startsWith("folder:")).map((tag) => tag.replace(/^folder:/, ""));
  const plainUserTags = userTags.filter((tag) => !tag.startsWith("folder:"));
  return {
    buckets: [
      { tokens: normalizeArray(plainUserTags), weight: WEIGHTS.userTag, reasonPrefix: "tag" },
      { tokens: normalizeArray(folderTags), weight: WEIGHTS.userTag, reasonPrefix: "folder" },
      { tokens: normalizeArray(ai?.suggested_tags), weight: WEIGHTS.aiTag, reasonPrefix: "ai-tag" },
      { tokens: normalizeArray(ai?.mood_labels), weight: WEIGHTS.aiMoodLabel, reasonPrefix: "mood" },
      { tokens: normalizeArray(ai?.use_cases), weight: WEIGHTS.aiUseCase, reasonPrefix: "use" },
      { tokens: tokenize(item.title), weight: WEIGHTS.title, reasonPrefix: "title" },
      { tokens: tokenize(item.notes), weight: WEIGHTS.notes, reasonPrefix: "note" },
    ],
  };
}

function flattenSignal(signals: BriefSignals | SceneSignals): Array<{ tokens: string[]; reasonPrefix: string }> {
  if ("genre" in signals) {
    // BriefSignals
    return [
      { tokens: signals.mood, reasonPrefix: "mood" },
      { tokens: signals.genre, reasonPrefix: "genre" },
      { tokens: signals.product, reasonPrefix: "product" },
      { tokens: signals.location, reasonPrefix: "location" },
      { tokens: signals.keywords, reasonPrefix: "keyword" },
    ];
  }
  // SceneSignals
  return [
    { tokens: signals.shot, reasonPrefix: "shot" },
    { tokens: signals.motion, reasonPrefix: "motion" },
    { tokens: signals.mood, reasonPrefix: "mood" },
    { tokens: signals.keywords, reasonPrefix: "keyword" },
  ];
}

export interface ScoreReferencesOptions {
  /** 추천에 포함할 자료 종류. 기본값: image / gif / video / youtube (link 제외). */
  allowedKinds?: ReadonlySet<ReferenceItem["kind"]>;
  /** 이미 어떤 target 에 붙어 있어 다시 추천할 필요 없는 reference id 들. */
  excludeIds?: ReadonlySet<string>;
  /** 점수 cutoff — 너무 낮은 매칭은 제외. 기본 0.5 (대략 user-tag 1 개 또는 mood 매칭 1 개 이상). */
  minScore?: number;
  /** 결과 상한. 기본 12. */
  limit?: number;
}

const DEFAULT_KINDS: ReadonlySet<ReferenceItem["kind"]> = new Set(["image", "gif", "video", "youtube"]);

/** Brief / Scene 신호로 라이브러리 자료를 스코어링한 뒤 정렬해 반환. */
export function scoreReferences(
  signals: BriefSignals | SceneSignals,
  candidates: ReferenceItem[],
  options: ScoreReferencesOptions = {},
): RecommendedReference[] {
  const allowed = options.allowedKinds ?? DEFAULT_KINDS;
  const exclude = options.excludeIds ?? new Set<string>();
  const minScore = options.minScore ?? 0.5;
  const limit = options.limit ?? 12;
  const flatSignals = flattenSignal(signals);

  // 신호가 아예 비어있으면 더 계산할 필요가 없음 — 빈 배열 반환.
  // (호출부가 fallback 으로 "최근 사용" 정렬을 띄우면 됨.)
  if (flatSignals.every((bucket) => bucket.tokens.length === 0)) return [];

  const scored: RecommendedReference[] = [];
  for (const item of candidates) {
    if (item.deleted_at) continue;
    if (!allowed.has(item.kind)) continue;
    if (exclude.has(item.id)) continue;

    const refTokens = tokensFromReference(item);
    let score = 0;
    const reasonSet = new Map<string, string>();

    for (const refBucket of refTokens.buckets) {
      if (refBucket.tokens.length === 0) continue;
      for (const sigBucket of flatSignals) {
        if (sigBucket.tokens.length === 0) continue;
        const overlap = intersect(refBucket.tokens, sigBucket.tokens);
        if (overlap.length === 0) continue;
        score += overlap.length * refBucket.weight;
        for (const token of overlap.slice(0, 2)) {
          // sigBucket.reasonPrefix(=신호 카테고리) + 매칭 토큰. UI 에 그대로 표시.
          const key = `${sigBucket.reasonPrefix}:${token}`;
          if (!reasonSet.has(key)) reasonSet.set(key, key);
        }
      }
    }

    if (score < minScore) continue;
    score += recencyBonus(item.last_used_at);
    scored.push({
      item,
      score,
      reasons: [...reasonSet.values()].slice(0, 4),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** Brief 분석 결과에서 호출부가 흔히 가진 필드들을 한 번에 취하는 편의 함수.
 *  파라미터는 모두 unknown 으로 받고 안에서 안전하게 풀어낸다 — DeepAnalysis
 *  타입 import 없이도 BriefTab/Agent 어디서든 호출할 수 있도록. */
export function buildBriefSignalsFromAnalysis(input: {
  rawText?: string | null;
  ideaNote?: string | null;
  toneKeywords?: ReadonlyArray<string | null | undefined>;
  moodSummary?: string | null;
  genre?: string | null;
  productName?: string | null;
  productBrand?: string | null;
  location?: string | null;
}): BriefSignals {
  return extractBriefSignals({
    mood: [...(input.toneKeywords ?? []), input.moodSummary ?? null],
    genre: [input.genre ?? null],
    product: [input.productName ?? null, input.productBrand ?? null],
    location: [input.location ?? null],
    text: [input.rawText ?? null, input.ideaNote ?? null],
  });
}
