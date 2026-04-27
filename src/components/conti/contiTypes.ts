import type { VideoFormat } from "@/lib/conti";

// ─── Color constants ───
export const KR = "#f9423a";
export const KR_BG = "rgba(249,66,58,0.10)";
export const KR_BG2 = "rgba(249,66,58,0.14)";
export const KR_BORDER2 = "rgba(249,66,58,0.20)";
export const NONE_ID = "__none__";

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

// ─── Types ───
/**
 * Sketch — a per-scene composition/draft image generated from the scene's
 * text description in ContiStudio's Sketches tab. Stored on the owning scene
 * row so the lifecycle is tied to that scene (scene delete → sketches gone).
 *
 * Role distinction vs `briefs.mood_image_urls` (Mood Ideation in the Ideation
 * tab): Mood is project-scoped tone exploration; Sketches are scene-scoped
 * compositional candidates you can promote into `conti_image_url`.
 */
export interface Sketch {
  id: string;
  url: string;
  /** Generator model used — "nano-banana-2" | "gpt-image-1.5" | "gpt-image-2".
   *  Kept free-form string so adding new models later does not widen this union. */
  model: string;
  createdAt: string;
  liked?: boolean;
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
  conti_image_history: string[];
  is_transition?: boolean;
  transition_type?: string | null;
  conti_image_crop?: any;
  /** Per-scene Sketches; lives on the scene row so a scene delete cascades.
   *  Optional because legacy rows may not have the column yet. */
  sketches?: Sketch[];
  /** User-confirmed "final" marker. Dashboard progress counts only scenes
   *  with `is_final === true`. When every non-transition scene is final,
   *  ContiTab auto-promotes `projects.status` to `completed`; unmarking
   *  any demotes back to `active`. Legacy rows lack the column → treated
   *  as `false`. */
  is_final?: boolean;
}

/**
 * Coerce a single scene's `sketches` field to a real `Sketch[]`.
 *
 * Some legacy `scene_versions.scenes` JSON snapshots have `sketches` stored as
 * the **string** `"[]"` (or even a JSON-encoded array string) instead of an
 * actual array. The symptoms in the UI are:
 *   · `SortableContiCard` reads `scene.sketches.length` → for a 2-char string
 *     `"[]"` that yields 2, so a phantom "2 sketches" badge appears even
 *     though the user never generated any.
 *   · Clicking the card opens `StudioSketchesTab` whose `useState<Sketch[]>`
 *     receives the string as-is, and the very next render calls
 *     `sketches.filter(...)` → `TypeError: sketches.filter is not a function`
 *     and the storyboard tab crashes into the error boundary.
 *
 * Normalising at the read boundary (after deserialisation, before the value
 * touches React state) fixes both symptoms in one place. We also try
 * `JSON.parse` for the rare case the string actually contains a stringified
 * array of real sketches — those should not be silently dropped.
 */
export function normalizeSceneSketches(scene: Scene): {
  scene: Scene;
  changed: boolean;
} {
  const raw = (scene as any).sketches;
  if (Array.isArray(raw)) return { scene, changed: false };
  if (raw === null || raw === undefined || raw === "") {
    // Treat absence/empty-string as "no sketches"; only mark changed if the
    // shape was non-array (so we know to re-persist sanitised JSON).
    if (raw === undefined) return { scene, changed: false };
    return { scene: { ...scene, sketches: [] }, changed: true };
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return { scene: { ...scene, sketches: parsed }, changed: true };
    } catch {
      /* fall through */
    }
    return { scene: { ...scene, sketches: [] }, changed: true };
  }
  // Any other shape (object, number, boolean…) is invalid → reset to empty.
  return { scene: { ...scene, sketches: [] }, changed: true };
}

/** Apply `normalizeSceneSketches` over an array, also reporting whether ANY
 *  scene was mutated. Caller can use the boolean to decide if the cleaned
 *  array should be re-persisted to scene_versions for self-healing. */
export function normalizeScenesSketches(scenes: Scene[]): {
  scenes: Scene[];
  changed: boolean;
} {
  let anyChanged = false;
  const out = scenes.map((s) => {
    const r = normalizeSceneSketches(s);
    if (r.changed) anyChanged = true;
    return r.scene;
  });
  return { scenes: anyChanged ? out : scenes, changed: anyChanged };
}
/** Camera framing buckets for background variations.
 *  Mirrors src/components/assets/types.tsx → BackgroundFraming.
 *  Kept narrow here so the conti pipeline can match by exact string. */
export type BackgroundFraming = "wide" | "medium" | "close" | "detail" | "alt";

export interface PhotoVariation {
  url: string;
  framing: BackgroundFraming;
  caption?: string | null;
  generated_at: string;
}

export interface Asset {
  tag_name: string;
  photo_url: string | null;
  asset_type?: string;
  ai_description?: string | null;
  outfit_description?: string | null;
  space_description?: string | null;
  /** Background-only alternate views per camera framing. Used by
   *  buildAssetImageUrls to pick a framing-matched reference image
   *  for a scene; falls back to photo_url when absent. */
  photo_variations?: PhotoVariation[] | null;
}
export interface ProjectInfo {
  title: string;
  client: string | null;
  active_version_id: string | null;
  conti_style_id: string | null;
  /** "active" | "completed". Mirrored in ContiTab state so auto-status toggle
   *  on final-toggle can skip DB writes when already in desired state. */
  status?: string | null;
}
export interface SceneVersion {
  id: string;
  project_id: string;
  version_number: number;
  version_name: string | null;
  scenes: any[];
  created_at: string;
  is_active: boolean;
  display_order: number;
}
export interface StylePreset {
  id: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  style_prompt: string | null;
  is_default: boolean;
}
export interface Props {
  projectId: string;
  videoFormat: VideoFormat;
}
export type ViewMode = "single" | "grid2" | "auto";

export const ASPECT_CLASS: Record<VideoFormat, string> = {
  vertical: "aspect-[9/16]",
  horizontal: "aspect-video",
  square: "aspect-square",
};

// 로컬(SQLite) 환경이라 DB 부담이 적어 씬 카드당 conti 히스토리를 넉넉히 보관한다.
export const MAX_HISTORY = 20;
