/**
 * Sketches — per-scene composition candidates.
 *
 * Role split vs Mood Ideation (Ideation tab):
 *   · MoodIdeationPanel generates project-scoped tone references and persists
 *     them into `briefs.mood_image_urls`. The generator there can attach any
 *     result to a specific scene via `sceneRef`, but the store is global.
 *   · Sketches live on the individual scene row (`scenes.sketches`). They are
 *     scene-scoped composition drafts that the user can promote into
 *     `conti_image_url` from the ContiStudio Sketches tab. Deleting the scene
 *     deletes the sketches (FK cascade).
 *
 * This module is an intentionally thin wrapper around the same low-level
 * image pipeline (`generateMoodImages` in lib/moodIdeation). We only reuse the
 * generator — NOT the persistence path. Sketches never touch
 * `briefs.mood_image_urls`; the caller is responsible for writing the returned
 * URLs to `scenes.sketches` so role separation stays clean.
 */

import {
  generateMoodImages,
  MOOD_IMAGE_MODEL_DEFAULT,
  MOOD_MODEL_USES_ASSET_REFS,
  type MoodGenerateOptions,
  type MoodImageModel,
} from "./moodIdeation";
import { generateTransitionFrame } from "./transitions";
import type { BriefAnalysis, ContiModel, VideoFormat } from "./conti";
import type { Sketch } from "@/components/conti/contiTypes";

/** Default model for the Sketches tab differs from Mood Ideation:
 *  NB2 is the workhorse in Conti because by the time the user reaches Conti
 *  the assets are registered and a reference-aware model produces noticeably
 *  better composition candidates than text-only GPT Image 1.5. */
export const SKETCH_MODEL_DEFAULT: MoodImageModel = "nano-banana-2";
export type { MoodImageModel as SketchModel };

export const SKETCH_MODEL_USES_ASSET_REFS: Record<MoodImageModel, boolean> = {
  ...MOOD_MODEL_USES_ASSET_REFS,
  "gpt-image-1.5": true,
};

export const SKETCH_MODEL_LABELS: Record<MoodImageModel, string> = {
  "nano-banana-2": "Nano Banana 2",
  "gpt-image-2": "GPT Image 2",
  "gpt-image-1.5": "GPT Image 1.5",
};

export const SKETCH_MODEL_DESCRIPTIONS: Record<MoodImageModel, string> = {
  "nano-banana-2": "Best default · Uses asset images for stable character/background likeness",
  "gpt-image-2": "High quality vision · Strong reference reading, slower generation",
  "gpt-image-1.5": "Faster vision · Reads asset images with lighter reference fidelity",
};

export interface GenerateSketchesOptions {
  projectId: string;
  /** Scene to tailor the prompts to. Sketches are always per-scene, so
   *  `sceneNumber` is required (MoodIdeationPanel allows null for "all scenes",
   *  we do not). */
  sceneNumber: number;
  scene: NonNullable<MoodGenerateOptions["scenes"]>[number];
  briefAnalysis: MoodGenerateOptions["briefAnalysis"];
  assets: MoodGenerateOptions["assets"];
  videoFormat: string;
  count: number;
  model?: MoodImageModel;
}

export interface GenerateTransitionSketchesOptions {
  projectId: string;
  prev: {
    scene_number: number;
    title?: string | null;
    description?: string | null;
    camera_angle?: string | null;
    mood?: string | null;
    location?: string | null;
    conti_image_url: string;
  };
  next: {
    scene_number: number;
    title?: string | null;
    description?: string | null;
    camera_angle?: string | null;
    mood?: string | null;
    location?: string | null;
    conti_image_url: string;
  };
  tr: {
    scene_number: number;
    description?: string | null;
    transition_type?: string | null;
  };
  allScenes?: Array<{
    scene_number: number;
    title?: string | null;
    description?: string | null;
    is_transition?: boolean;
  }>;
  briefAnalysis: BriefAnalysis | null;
  videoFormat: VideoFormat | string;
  count: number;
  model?: MoodImageModel;
}

/**
 * Generate N composition candidates for a single scene. Returns a flat URL
 * array. Does NOT write to `briefs.mood_image_urls` or `scenes.sketches`.
 * The caller decides persistence.
 *
 * `onBatchDone` streams URLs as they arrive so the Sketches tab can swap
 * skeleton placeholders for real images without waiting for the full batch.
 */
export async function generateSceneSketches(
  opts: GenerateSketchesOptions,
  onBatchDone?: (urls: string[]) => void,
): Promise<string[]> {
  const model = opts.model ?? SKETCH_MODEL_DEFAULT;
  return generateMoodImages(
    {
      projectId: opts.projectId,
      briefAnalysis: opts.briefAnalysis,
      // Only the target scene is sent. generateMoodImages honours
      // `targetSceneNumber` to bias prompts to that scene's description.
      scenes: [opts.scene],
      assets: opts.assets,
      videoFormat: opts.videoFormat,
      count: opts.count,
      targetSceneNumber: opts.sceneNumber,
      model,
      forceAssetRefs: true,
    },
    onBatchDone,
  );
}

function sketchModelToContiModel(model: MoodImageModel | undefined): ContiModel {
  return model === "nano-banana-2" ? "nano-banana-2" : "gpt";
}

export async function generateTransitionSketches(
  opts: GenerateTransitionSketchesOptions,
  onBatchDone?: (urls: string[]) => void,
): Promise<string[]> {
  const urls: string[] = [];
  const count = Math.max(1, opts.count);
  for (let i = 0; i < count; i++) {
    const url = await generateTransitionFrame({
      projectId: opts.projectId,
      prev: opts.prev,
      next: opts.next,
      tr: {
        ...opts.tr,
        // Give each candidate a tiny variation hint while preserving the
        // selected transition technique and anchor discipline.
        description: [opts.tr.description, `Sketch candidate ${i + 1}: vary the composition and timing within the same transition beat.`]
          .filter(Boolean)
          .join("\n"),
      },
      allScenes: opts.allScenes,
      briefAnalysis: opts.briefAnalysis,
      videoFormat: opts.videoFormat as VideoFormat,
      model: sketchModelToContiModel(opts.model),
    });
    urls.push(url);
    onBatchDone?.([url]);
  }
  return urls;
}

export function makeSketchFromUrl(url: string, model: MoodImageModel): Sketch {
  return {
    id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    url,
    model,
    createdAt: new Date().toISOString(),
  };
}

export { MOOD_IMAGE_MODEL_DEFAULT };
