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
