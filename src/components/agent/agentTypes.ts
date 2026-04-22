import type { VideoFormat } from "@/lib/conti";

export const KR = "#f9423a";
export const KR_BG = "rgba(249,66,58,0.10)";
export const KR_BG2 = "rgba(249,66,58,0.14)";
export const KR_BORDER = "rgba(249,66,58,0.28)";
export const KR_BORDER2 = "rgba(249,66,58,0.20)";
export const DIV_LINE = "1px solid var(--color-border-tertiary)";

export const FORMAT_MOOD_SLOT: Record<string, { width: number; aspectRatio: string }> = {
  vertical: { width: 88, aspectRatio: "9/16" },
  horizontal: { width: 176, aspectRatio: "16/9" },
  square: { width: 110, aspectRatio: "1/1" },
};

export const FORMAT_DEFAULT_COLS: Record<string, number> = { vertical: 5, horizontal: 4, square: 5 };

export const ACFG: Record<string, { color: string; bg: string; bd: string }> = {
  character: { color: "#6366f1", bg: "rgba(99,102,241,0.10)", bd: "rgba(99,102,241,0.22)" },
  item: { color: "#d97706", bg: "rgba(245,158,11,0.10)", bd: "rgba(245,158,11,0.22)" },
  background: { color: "#059669", bg: "rgba(16,185,129,0.10)", bd: "rgba(16,185,129,0.22)" },
};
export const ASSET_ICON: Record<string, string> = {
  character:
    "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  item: "M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z",
  background: "M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0zM12 13a3 3 0 100-6 3 3 0 000 6",
};

export type AssetType = "character" | "item" | "background";

export interface ChatImage {
  base64: string;
  mediaType: string;
  preview: string;
}

export type FocalPoint = { x: number; y: number; scale?: number };

export interface ChatLog {
  id?: string;
  project_id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
}

export interface Scene {
  id: string;
  project_id: string;
  scene_number: number;
  title: string | null;
  description: string | null;
  camera_angle: string | null;
  location: string | null;
  mood: string | null;
  duration_sec: number | null;
  tagged_assets: string[];
  conti_image_url: string | null;
}

export type BriefField = string[] | { summary: string; detail?: string; memo_link?: string | null };

// ─────────────────────────────────────────────────────────────
// Brief Analysis v2 — content-type branched schema
// (영상 전문가 관점의 실무 필드. 모든 필드 optional — 기존 브리프와 하위호환)
// ─────────────────────────────────────────────────────────────

export type ContentType = "product_launch" | "event" | "update" | "community" | "brand_film";

export type HookType =
  | "gameplay_first"
  | "fail_solve"
  | "power_fantasy"
  | "unboxing_reveal"
  | "before_after"
  | "mystery_tease"
  | "testimonial"
  | "pattern_interrupt";

export type VideoAspect = "9:16" | "16:9" | "1:1" | "4:5";
export type VideoDuration = "6s" | "15s" | "30s" | "45s" | "60s";
export type EditRhythm = "fast" | "medium" | "slow";
export type RevealTiming = "0-3s" | "3-5s" | "5-10s";
export type LogoPlacement = "first_frame" | "last_frame" | "persistent_corner";

export interface ProductInfo {
  what: string;
  key_benefit: string;
  urgency: {
    type: "time_limited" | "quantity_limited" | "exclusive" | "none";
    description: string;
  };
  cta_destination: string;
  cta_action: string;
}

export interface HeroVisual {
  must_show: string[];
  first_frame: string;
  brand_reveal_timing: "0-3s" | "3-5s";
  product_reveal_timing: RevealTiming;
  logo_placement: LogoPlacement;
}

export interface HookStrategy {
  primary: HookType;
  alternatives: HookType[];
  first_3s_description: string;
  pattern_interrupt: boolean;
}

export interface Pacing {
  format: VideoAspect;
  duration: VideoDuration;
  scene_count: {
    min: number;
    max: number;
    recommended: number;
  };
  edit_rhythm: EditRhythm;
  silent_viewable: boolean;
  captions_required: boolean;
}

export interface Constraints {
  brand_guidelines: string[];
  avoid: string[];
  platform_policies: string[];
}

export interface AudienceInsight {
  pain_point?: string;
  motivation?: string;
}

export interface ABCDScore {
  score: number;
  notes: string;
}
export interface ABCDCompliance {
  attract: ABCDScore;
  brand: ABCDScore;
  connect: ABCDScore;
  direct: ABCDScore;
  total?: number;
}

export interface NarrativeAnalysis {
  controlling_idea: string;
  story_structure: "hero_journey" | "before_after" | "vignette" | "demonstration";
  protagonist: {
    identity: string;
    desire: string;
    transformation: string;
  };
  emotional_beats: Array<{
    timestamp: string;
    emotion: string;
    intensity: number;
  }>;
}

export interface Analysis {
  goal: BriefField;
  target: BriefField;
  usp: BriefField;
  tone_manner: BriefField;
  creative_gap?: { synergy?: string[]; gap?: string[]; recommendation?: string };
  idea_note?: string;
  image_analysis?: string;
  reference_mood?: string;
  visual_direction?:
    | {
        camera?: string;
        lighting?: string;
        color_grade?: string;
        editing?: string;
      }
    | string;
  scene_flow?:
    | {
        structure?: string;
        hook?: { duration?: string; description?: string };
        body?: { duration?: string; description?: string };
        cta?: { duration?: string; description?: string };
      }
    | string;

  // ── v2 fields (all optional; classifier-driven) ──
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

  // brand_film 전용
  narrative?: NarrativeAnalysis;
}

export interface Asset {
  tag_name: string;
  photo_url: string | null;
  ai_description: string | null;
  asset_type?: AssetType;
  role_description?: string | null;
  outfit_description?: string | null;
  space_description?: string | null;
}

export interface MoodImage {
  id: string;
  url: string | null;
  liked: boolean;
  sceneRef: number | null;
  comment: string;
  createdAt: string;
}

export type ParsedScene = {
  scene_number: number;
  title?: string;
  description?: string;
  camera_angle?: string;
  location?: string;
  mood?: string;
  duration_sec?: number;
  tagged_assets?: string[];
};

export type StorylineOption = { id: string; title: string; synopsis: string; mood?: string };

export type MessageSegment =
  | { type: "text"; content: string }
  | { type: "scene"; data: ParsedScene | null }
  | { type: "strategy"; content: string }
  | { type: "storylines"; options: StorylineOption[] };

export type RightPanel = "scenes" | "mood";

// ── Utility functions ──

export const genMoodId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const toMoodImages = (raw: (string | MoodImage)[]): MoodImage[] => {
  // 1) 문자열 → MoodImage 정규화
  const normalized: MoodImage[] = raw.map((item) =>
    typeof item === "string"
      ? { id: genMoodId(), url: item, liked: false, sceneRef: null, comment: "", createdAt: new Date().toISOString() }
      : item,
  );
  // 2) URL 기반 dedup.
  //    과거 generateMoodImages 가 DB 에 raw URL 배열을 append 하면서
  //    persistMoodGenResultToDB 가 skel ID 객체를 prepend 하여 같은 URL 이
  //    중복 기록된 브리프들이 존재. 로드 시점에 첫 항목만 유지해 자동 치유.
  const seen = new Set<string>();
  const out: MoodImage[] = [];
  for (const img of normalized) {
    const key = img.url ?? `__null__${img.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(img);
  }
  return out;
};

export const briefFieldToString = (f: BriefField | undefined | null): string => {
  if (!f) return "";
  if (Array.isArray(f)) return f.join(", ");
  return f.summary ?? "";
};

export const cleanJsonString = (raw: string) =>
  raw
    .trim()
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");

export const formatTime = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
};

export const fileToBase64 = (file: File): Promise<ChatImage> =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      resolve({ base64: dataUrl.split(",")[1], mediaType: file.type, preview: dataUrl });
    };
    reader.readAsDataURL(file);
  });

export const loadFocalMap = (projectId: string): Record<string, FocalPoint> => {
  try {
    const r = localStorage.getItem(`ff_focal_${projectId}`);
    return r ? JSON.parse(r) : {};
  } catch {
    return {};
  }
};

export const getFocalStyle = (asset: Asset, focalMap: Record<string, FocalPoint>): Record<string, string> | null => {
  if (!asset.photo_url) return null;
  const key = asset.tag_name.startsWith("@") ? asset.tag_name.slice(1) : asset.tag_name;
  const focal = focalMap[key] ?? focalMap[`@${key}`];
  if (!focal) return null;
  const scale = focal.scale ?? 1.4;
  return {
    backgroundImage: `url(${asset.photo_url})`,
    backgroundSize: `${scale * 100}%`,
    backgroundPosition: `${focal.x * 100}% ${focal.y * 100}%`,
    backgroundRepeat: "no-repeat",
  };
};



export const buildAssetMap = (assets: Asset[]) =>
  Object.fromEntries(
    assets.flatMap((a) => {
      const n = a.tag_name.startsWith("@") ? a.tag_name.slice(1) : a.tag_name;
      return [
        [n, a],
        [`@${n}`, a],
      ];
    }),
  ) as Record<string, Asset>;

/**
 * Resolve an `@tag` mention to the registered asset.
 *
 *  1. **Exact match** wins outright (case-sensitive, matches stored tag_name).
 *  2. **Prefix-match fallback** is intentionally narrow: it only fires when
 *     the overflow tail is **non-ASCII** (e.g. Korean particles `가/를/이/는`).
 *     This preserves the original UX of `@YD가` resolving to `@YD`, while
 *     refusing to swallow longer registered tags such as `@BG_medium`,
 *     `@BG2`, or `@BGwide` — those must hit step 1 with their full name.
 *
 *  Why the original prefix matcher was broken:
 *  the user could create `@BG_medium` from a background framing variation,
 *  type `@BG_medium` in a scene's location field, but if the renderer's
 *  `assets` list was momentarily stale (no `BG_medium` yet), the matcher
 *  would silently downgrade to `@BG`. That wrong tag would then be
 *  written into `scene.tagged_assets` and persist forever, so the conti
 *  pipeline never even saw `BG_medium` at generation time.
 */
export const resolveAsset = (raw: string, assets: Asset[]): { asset: Asset; name: string } | null => {
  const clean = raw.startsWith("@") ? raw.slice(1) : raw;
  // Step 1 — exact match (case-sensitive, preferred).
  for (const a of assets) {
    const n = a.tag_name.startsWith("@") ? a.tag_name.slice(1) : a.tag_name;
    if (n === clean) return { asset: a, name: n };
  }
  // Step 2 — case-insensitive exact match. Users routinely retype tags
  // with different casing (`@BG_Medium` vs the registered `@BG_medium`).
  // Without this the prefix fallback below would either reject (ASCII
  // tail) or silently match the shorter `BG`, which is what the user
  // saw as "BG_Medium 호출했는데 BG가 불러와짐".
  const cleanLc = clean.toLowerCase();
  for (const a of assets) {
    const n = a.tag_name.startsWith("@") ? a.tag_name.slice(1) : a.tag_name;
    if (n.toLowerCase() === cleanLc) return { asset: a, name: n };
  }
  // Step 3 — narrow prefix fallback, only for trailing non-ASCII (Korean
  // particles etc.). Sort longest-first so that nested registrations like
  // `YD` and `YDhyung` compete deterministically (longest-prefix wins).
  const sorted = [...assets].sort((a, b) => b.tag_name.length - a.tag_name.length);
  for (const a of sorted) {
    const n = a.tag_name.startsWith("@") ? a.tag_name.slice(1) : a.tag_name;
    if (!clean.startsWith(n) || clean.length === n.length) continue;
    const tail = clean.slice(n.length);
    // Reject ASCII alnum / underscore tails — those almost always mean
    // a different (longer) tag the user actually intended (`BG_medium`
    // vs `BG`, `YDhyung` vs `YD`). Allow Hangul or other non-ASCII.
    if (/^[A-Za-z0-9_]/.test(tail)) continue;
    return { asset: a, name: n };
  }
  return null;
};

function remapStorylineIds(options: any[], usedIds: Set<string>): { options: any[]; idMap: Record<string, string> } {
  if (!usedIds.size) return { options, idMap: {} };
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const allUsed = new Set([...usedIds]);
  const idMap: Record<string, string> = {};

  const remapped = options.map((o: any) => {
    const oldId = String(o.id).toUpperCase();
    if (allUsed.has(oldId)) {
      let newId = oldId;
      for (let i = 0; i < LETTERS.length; i++) {
        if (!allUsed.has(LETTERS[i])) { newId = LETTERS[i]; break; }
      }
      allUsed.add(newId);
      idMap[oldId] = newId;
      return { ...o, id: newId };
    }
    allUsed.add(oldId);
    return o;
  });
  return { options: remapped, idMap };
}

function applyIdMapToText(text: string, idMap: Record<string, string>): string {
  if (!Object.keys(idMap).length) return text;
  let result = text;
  for (const [from, to] of Object.entries(idMap)) {
    if (from !== to) result = result.replace(new RegExp(`(?<![a-zA-Z])${from}안`, "g"), `${to}안`);
  }
  return result;
}

export function parseMessageSegments(text: string, usedIds?: Set<string>): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const regex = /```(scene|strategy|storylines)\s*([\s\S]*?)```/g;
  let lastIndex = 0,
    match: RegExpExecArray | null;
  let idMap: Record<string, string> = {};

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) segments.push({ type: "text", content: applyIdMapToText(before, idMap) });
    }
    const bt = match[1] as "scene" | "strategy" | "storylines";
    const bc = match[2].trim();
    if (bt === "scene") {
      try {
        segments.push({ type: "scene", data: JSON.parse(cleanJsonString(bc)) });
      } catch {
        segments.push({ type: "scene", data: null });
      }
    } else if (bt === "storylines") {
      try {
        let parsed = JSON.parse(cleanJsonString(bc));
        if (usedIds && usedIds.size > 0 && Array.isArray(parsed)) {
          const result = remapStorylineIds(parsed, usedIds);
          parsed = result.options;
          idMap = { ...idMap, ...result.idMap };
        }
        segments.push({ type: "storylines", options: parsed });
      } catch {
        segments.push({ type: "text", content: bc });
      }
    } else {
      segments.push({ type: "strategy", content: bc });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    const rem = text.slice(lastIndex).trim();
    if (rem) segments.push({ type: "text", content: applyIdMapToText(rem, idMap) });
  }
  return segments;
}

/**
 * Rewrites a raw assistant message so its storylines-block IDs and body "X안" mentions
 * match what the user actually sees after cumulative remapping.
 *
 * - `usedIds` is mutated: every ID that ends up visible (after possible remap) is added.
 * - Returns the rewritten raw text (with storylines blocks re-serialized using new IDs).
 *
 * Use this when building chat history sent to the LLM so its self-consistent reasoning
 * lines up with the IDs displayed in the UI (e.g. avoids "you proposed A,B,C only" when
 * the user is looking at D,E,F cards).
 */
export function remapMessageForHistory(text: string, usedIds: Set<string>): string {
  const regex = /```(scene|strategy|storylines)\s*([\s\S]*?)```/g;
  let result = "";
  let lastIndex = 0;
  let idMap: Record<string, string> = {};
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result += applyIdMapToText(text.slice(lastIndex, match.index), idMap);
    }
    const bt = match[1] as "scene" | "strategy" | "storylines";
    const bc = match[2].trim();
    if (bt === "storylines") {
      try {
        let parsed = JSON.parse(cleanJsonString(bc));
        if (Array.isArray(parsed)) {
          if (usedIds.size > 0) {
            const r = remapStorylineIds(parsed, usedIds);
            parsed = r.options;
            idMap = { ...idMap, ...r.idMap };
          }
          for (const opt of parsed) usedIds.add(String(opt.id).toUpperCase());
          result += "```storylines\n" + JSON.stringify(parsed) + "\n```";
        } else {
          result += match[0];
        }
      } catch {
        result += match[0];
      }
    } else {
      result += match[0];
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    result += applyIdMapToText(text.slice(lastIndex), idMap);
  }
  return result;
}

export function extractScenesFromText(text: string): ParsedScene[] {
  const result: ParsedScene[] = [];
  for (const m of [...text.matchAll(/```scene\s*([\s\S]*?)```/g)]) {
    try {
      const s = JSON.parse(cleanJsonString(m[1]));
      if (s.scene_number && typeof s.scene_number === "number") result.push(s);
    } catch {}
  }
  return result;
}

// ── Pending scenes persistence ──

export const _pendingScenesByProject = new Map<string, ParsedScene[]>();
// 진행 중인 mood generation 의 전체 상태를 모듈 레벨로 보관.
// AgentTab/MoodIdeationPanel 이 언마운트(탭 이동)된 동안에도 in-flight 콜백이 안전하게 갱신할 수 있도록
// skeletonIds 와 arrivedUrls 를 함께 보관하고, subscribe 패턴으로 마운트된 인스턴스에 변화를 통지한다.
export type MoodGenState = {
  count: number;
  skeletonIds: string[];
  arrivedUrls: string[];
  promise: Promise<void> | null;
};

export const _moodGeneratingByProject = new Map<string, MoodGenState>();
const _moodGenListeners = new Map<string, Set<() => void>>();

export function getMoodGen(pid: string): MoodGenState | undefined {
  return _moodGeneratingByProject.get(pid);
}
export function setMoodGen(pid: string, next: MoodGenState | null) {
  if (next === null) _moodGeneratingByProject.delete(pid);
  else _moodGeneratingByProject.set(pid, next);
  _moodGenListeners.get(pid)?.forEach((fn) => fn());
}
export function patchMoodGen(pid: string, patch: Partial<MoodGenState>) {
  const cur = _moodGeneratingByProject.get(pid);
  if (!cur) return;
  _moodGeneratingByProject.set(pid, { ...cur, ...patch });
  _moodGenListeners.get(pid)?.forEach((fn) => fn());
}
export function subscribeMoodGen(pid: string, fn: () => void) {
  if (!_moodGenListeners.has(pid)) _moodGenListeners.set(pid, new Set());
  _moodGenListeners.get(pid)!.add(fn);
  return () => {
    _moodGenListeners.get(pid)?.delete(fn);
  };
}

/* ─────────────────────────────────────────────────────────────
 *  Chat (Agent) In-Flight 스토어
 *   — AgentTab 이 언마운트 돼도 진행 중인 LLM 호출의 상태를 보관해
 *     탭 복귀 시 로딩 인디케이터 복원 및 완료 후 chat_logs 재조회를 트리거.
 * ───────────────────────────────────────────────────────────── */
export type ChatGenState = {
  /** 진행 중 여부 */
  inFlight: boolean;
  /** 시작 시각 */
  startedAt: number;
  /** 완료 후 draft 로 넘길 씬 — mount 복귀 시 반영 */
  pendingExtractedScenes?: ParsedScene[];
  /** pendingExtractedScenes 가 있을 때, 기존 확정 씬이 있으면 replace confirm 을 띄워야 함을 표시 */
  pendingExtractedNeedsReplaceConfirm?: boolean;
};

export const _chatGenByProject = new Map<string, ChatGenState>();
const _chatGenListeners = new Map<string, Set<() => void>>();

export function getChatGen(pid: string): ChatGenState | undefined {
  return _chatGenByProject.get(pid);
}
export function setChatGen(pid: string, next: ChatGenState | null) {
  if (next === null) _chatGenByProject.delete(pid);
  else _chatGenByProject.set(pid, next);
  _chatGenListeners.get(pid)?.forEach((fn) => fn());
}
export function patchChatGen(pid: string, patch: Partial<ChatGenState>) {
  const cur = _chatGenByProject.get(pid);
  if (!cur) return;
  _chatGenByProject.set(pid, { ...cur, ...patch });
  _chatGenListeners.get(pid)?.forEach((fn) => fn());
}
export function subscribeChatGen(pid: string, fn: () => void) {
  if (!_chatGenListeners.has(pid)) _chatGenListeners.set(pid, new Set());
  _chatGenListeners.get(pid)!.add(fn);
  return () => {
    _chatGenListeners.get(pid)?.delete(fn);
  };
}

export const LS_PENDING = (pid: string) => `ff_pending_scenes_${pid}`;

export const loadPendingFromLS = (pid: string): ParsedScene[] => {
  try {
    const r = localStorage.getItem(LS_PENDING(pid));
    return r ? JSON.parse(r) : [];
  } catch {
    return [];
  }
};

export const savePendingToLS = (pid: string, scenes: ParsedScene[]) => {
  try {
    if (scenes.length === 0) localStorage.removeItem(LS_PENDING(pid));
    else localStorage.setItem(LS_PENDING(pid), JSON.stringify(scenes));
  } catch {}
};
