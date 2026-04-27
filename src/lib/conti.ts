import { supabase } from "./supabase";
import { deleteStoredFile } from "./storageUtils";
import type { HeroVisual, HookStrategy, ProductInfo, Constraints } from "@/components/agent/agentTypes";
import { buildHookMoodAddendum } from "./hookLibrary";

/* ━━━━━ 타입 ━━━━━ */
type AssetType = "character" | "item" | "background";

/**
 * Background framings are now independent sibling assets
 * (e.g. `@BG_wide`, `@BG_close`) rather than alternate views
 * stored on a parent asset. The conti pipeline therefore no
 * longer needs `photo_variations` here — each tag the user
 * @-mentions resolves directly to its own `photo_url`.
 */
interface Asset {
  tag_name: string;
  photo_url: string | null;
  ai_description: string | null;
  outfit_description: string | null;
  signature_items: string | null;
  space_description: string | null;
  asset_type: AssetType;
}

interface SceneForConti {
  id: string;
  scene_number: number;
  title: string | null;
  description: string | null;
  camera_angle: string | null;
  location: string | null;
  mood: string | null;
  duration_sec?: number | null;
  tagged_assets: string[];
}

export type VideoFormat = "vertical" | "horizontal" | "square";

type BriefField = string[] | { summary: string; detail?: string; memo_link?: string | null };

export interface BriefAnalysis {
  goal: BriefField;
  target: BriefField;
  usp: BriefField;
  tone_manner: BriefField;
  visual_direction?: string | { camera?: string; lighting?: string; color_grade?: string; editing?: string };

  // ── v2 fields (optional; injected into per-scene image prompt) ──
  hero_visual?: HeroVisual;
  hook_strategy?: HookStrategy;
  product_info?: ProductInfo;
  constraints?: Constraints;
}

export type ContiModel = "gpt" | "nano-banana-2";

export type GeneratingStage = "queued" | "translating" | "building" | "generating" | "uploading";

export interface ContiGenerateOptions {
  scene: SceneForConti;
  allScenes: SceneForConti[];
  projectId: string;
  videoFormat: VideoFormat;
  briefAnalysis?: BriefAnalysis | null;
  styleAnchor?: string;
  styleImageUrl?: string;
  model?: ContiModel;
  onStageChange?: (stage: GeneratingStage) => void;
}

export interface StyleTransferOptions {
  // conti_image_crop 을 포함한 full Scene 객체를 허용 — 프리뷰 비율로 사전-크롭할 때 사용.
  scene: SceneForConti & { conti_image_url: string; conti_image_crop?: unknown };
  projectId: string;
  styleImageUrl: string;
  stylePrompt?: string;
  videoFormat: VideoFormat;
  /** Which generator to drive. Matches ContiTab's top-bar `contiModel`
   *  selector so Style Transfer follows the same model knob as Generate /
   *  Regenerate / TR. When omitted we keep the legacy behaviour (NB2
   *  first, GPT edits as silent fallback on NB2 outage). */
  model?: ContiModel;
  onStageChange?: (stage: GeneratingStage) => void;
}

/* ━━━━━ 유틸 ━━━━━ */
const fieldToString = (field: BriefField | undefined | null): string => {
  if (!field) return "";
  if (Array.isArray(field)) return field.join(", ");
  return field.summary ?? "";
};

const fieldToArray = (field: BriefField | undefined | null): string[] => {
  if (!field) return [];
  if (Array.isArray(field)) return field;
  const parts: string[] = [];
  if (field.summary) parts.push(field.summary);
  if (field.detail) parts.push(field.detail);
  return parts;
};

export const sanitizeImagePrompt = (text: string): string => {
  return text
    .replace(/에스파|aespa|카리나|윈터|지젤|닝닝/gi, "K-pop artist")
    .replace(/블랙핑크|BTS|방탄소년단|뉴진스|아이브|르세라핌|엑소|빅뱅|세븐틴|스트레이키즈/gi, "K-pop group")
    .replace(/PUBG|배틀그라운드|PlayerUnknown/gi, "mobile game")
    .replace(/포트나이트|리그오브레전드|오버워치|발로란트|마인크래프트/gi, "popular game")
    .replace(/크래프톤|라이엇|블리자드|넥슨|넷마블/gi, "game company")
    .replace(/배틀|전투|총격|격투|폭발|전쟁|킬|사살|공격|저격|폭탄|무기|총기/gi, "action")
    .replace(/battle|combat|gunfire|explosion|warfare|kill|attack|weapon|gun|bomb/gi, "action")
    .replace(/삼성|갤럭시|애플|아이폰|나이키|아디다스|현대|기아|LG전자|SK텔레콤/gi, "brand")
    .replace(/\s{2,}/g, " ")
    .trim();
};

export const IMAGE_SIZE_MAP: Record<VideoFormat, string> = {
  vertical: "1024x1536",
  horizontal: "1536x1024",
  square: "1024x1024",
};

/* ━━━━━ 프리뷰 컨테이너 비율 (씬카드와 동일) ━━━━━
 * SortableContiCard.tsx 의 FORMAT_RATIO 와 1:1 일치해야 한다.
 * NB2 가 출력할 비율(9:16, 16:9, 1:1)과도 정확히 일치한다.
 */
export const FORMAT_RATIO: Record<VideoFormat, number> = {
  horizontal: 16 / 9,
  vertical: 9 / 16,
  square: 1,
};

/* ━━━━━ pre-crop 캔버스 출력 크기 ━━━━━
 * FORMAT_RATIO 와 정확히 동일한 비율의 픽셀 사이즈.
 * NB2 / GPT 의 size 인자(IMAGE_SIZE_MAP)와는 무관하다 — 어차피 NB2 는
 * source 이미지의 픽셀 크기는 무시하고 aspectRatio 인자만 본다.
 */
const FORMAT_OUTPUT_SIZE: Record<VideoFormat, { w: number; h: number }> = {
  horizontal: { w: 1536, h: 864 }, // 16:9
  vertical: { w: 864, h: 1536 }, // 9:16
  square: { w: 1024, h: 1024 }, // 1:1
};

const FORMAT_PROMPT_NOTE: Record<VideoFormat, string> = {
  vertical: "VERTICAL 9:16 portrait frame. Mobile fullscreen.",
  horizontal: "HORIZONTAL 16:9 landscape. Wide cinematic frame.",
  square: "SQUARE 1:1. Centered balanced composition.",
};

const DEFAULT_STYLE_ANCHOR = `VISUAL STYLE (apply consistently):
- High-end Korean commercial advertisement
- Cinematic lighting — soft, directional, no harsh flash
- Sony A7IV aesthetic, 35mm lens, f/2.0
- Teal-orange color grade
- Photorealistic, 8K quality
- No text, subtitles, or watermarks in image
- Safe for all audiences`;

const SHOT_ROTATION: Record<number, string> = {
  1: "EXTREME WIDE ESTABLISHING SHOT — full environment visible, character tiny in frame, massive sense of scale",
  2: "MEDIUM SHOT — waist-up, character off-center (rule of thirds), environment context visible",
  3: "CLOSE-UP — chest to head, face fills 60% of frame, shallow depth of field blurs background",
  4: "LOW ANGLE SHOT — camera placed below subject looking up, hero perspective, dramatic sky visible",
  5: "OVER-THE-SHOULDER or POV SHOT — camera behind/beside character, scene viewed from their perspective",
  6: "EXTREME CLOSE-UP — face only or single detail (hands, eyes, object), maximum emotion",
  7: "BIRD'S EYE / HIGH ANGLE — camera looks straight down or steep angle from above",
  8: "DUTCH ANGLE (tilted frame) — camera rotated 15-30 degrees, tension and unease",
};

const resolveShotType = (sceneNumber: number, totalScenes: number, cameraAngle: string | null): string => {
  if (cameraAngle && cameraAngle.trim().length > 3) {
    return `SHOT TYPE (MANDATORY): ${cameraAngle.trim()}
    — Strictly compose this frame as described. Do NOT default to a standard front-facing portrait.`;
  }
  if (sceneNumber === 1) {
    return `SHOT TYPE (MANDATORY): EXTREME WIDE ESTABLISHING SHOT
    — Show full environment, character small in frame. Set the world.`;
  }
  if (sceneNumber === totalScenes) {
    return `SHOT TYPE (MANDATORY): MEDIUM CLOSE-UP facing camera
    — Final emotional beat. Character centered, direct eye contact with viewer.`;
  }
  const idx = ((sceneNumber - 2) % (Object.keys(SHOT_ROTATION).length - 2)) + 2;
  return `SHOT TYPE (MANDATORY): ${SHOT_ROTATION[idx] ?? SHOT_ROTATION[2]}
  — This is scene ${sceneNumber} of ${totalScenes}. Vary the composition from adjacent scenes.`;
};

/* ━━━━━ 씬 빈약도 판정 ━━━━━ */
const isSparseScene = (scene: SceneForConti): boolean => {
  const filledFields = [scene.description, scene.camera_angle, scene.mood, scene.location].filter(
    (v) => v && v.trim().length > 2,
  ).length;
  return filledFields <= 1;
};

/* ━━━━━ 프리뷰 비율로 source 이미지 자르기 ━━━━━
 * 씬카드의 AdjustImageModal.captureAsImage 와 동일한 cover-render 알고리즘.
 * conti_image_crop 의 x/y/scale/rotate/ia 를 그대로 적용해, 사용자가 보고 있는
 * 프리뷰의 visible region 만 잘라서 PNG Blob 으로 반환한다.
 *
 * 결과 이미지 비율 = FORMAT_RATIO[videoFormat] = NB2 출력 비율 → 스타일 변환 후
 * 결과 이미지가 프리뷰 컨테이너에 정확히 들어맞아 더 이상 찌그러짐이 없다.
 */
type PreflightCrop = {
  x?: number;
  y?: number;
  scale?: number;
  rotate?: number;
  ia?: number;
};

const loadHTMLImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });

/** SortableContiCard.tsx 의 getCropForFmt 와 동일 로직.
 *  CropMap({horizontal, vertical, square}) 또는 단일 CropState 모두 지원. */
const getCropForFmtFromStored = (stored: unknown, fmt: VideoFormat): PreflightCrop | null => {
  if (!stored || typeof stored !== "object") return null;
  const obj = stored as Record<string, any>;
  if ("horizontal" in obj || "vertical" in obj || "square" in obj) {
    const c = obj[fmt];
    if (c && c._v === 2) return c as PreflightCrop;
    return null;
  }
  const s = obj as any;
  if (s._v === 2 && (!s.fmt || s.fmt === fmt)) return s as PreflightCrop;
  return null;
};

const cropImageForFormat = async (
  imageUrl: string,
  storedCrop: PreflightCrop | null,
  videoFormat: VideoFormat,
): Promise<Blob> => {
  const img = await loadHTMLImage(imageUrl);
  const { w: cW, h: cH } = FORMAT_OUTPUT_SIZE[videoFormat];

  const canvas = document.createElement("canvas");
  canvas.width = cW;
  canvas.height = cH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, cW, cH);

  // crop 인자 — 없으면 정중앙 cover (x=0, y=0, scale=0.8 → 렌더 scale 1.0)
  const x = storedCrop?.x ?? 0;
  const y = storedCrop?.y ?? 0;
  const baseScale = typeof storedCrop?.scale === "number" ? storedCrop.scale : 0.8;
  const s = Math.max(0.1, baseScale) + 0.2;
  const rad = ((storedCrop?.rotate ?? 0) * Math.PI) / 180;

  // 항상 현재 이미지의 실제 자연 비율 사용 — 저장된 ia 값이 stale 인 경우(이전 NB2 변환 등)도 안전.
  const ia = img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : (storedCrop?.ia ?? cW / cH);

  // 컨테이너에 cover-fit 시 이미지의 렌더 픽셀 크기.
  const cAspect = cW / cH;
  let covW: number, covH: number;
  if (ia >= cAspect) {
    covH = cH;
    covW = cH * ia;
  } else {
    covW = cW;
    covH = cW / ia;
  }

  ctx.save();
  ctx.translate(cW / 2 + (x / 100) * cW, cH / 2 + (y / 100) * cH);
  ctx.scale(s, s);
  ctx.rotate(rad);
  ctx.drawImage(img, -covW / 2, -covH / 2, covW, covH);
  ctx.restore();

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))),
      "image/png",
    );
  });
};

const uploadPreflightSource = async (
  blob: Blob,
  projectId: string,
  sceneNumber: number,
  label: string = "styletx-src",
): Promise<string> => {
  const path = `${projectId}/scene_${sceneNumber}_${label}_${Date.now()}.png`;
  const { error } = await supabase.storage.from("contis").upload(path, blob, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) throw new Error(`Pre-crop upload failed: ${error.message}`);
  return supabase.storage.from("contis").getPublicUrl(path).data.publicUrl;
};

/* ━━━━━ 외부에서 재사용하는 preflight 래퍼 ━━━━━
 * 씬 이미지를 프리뷰(= FORMAT_RATIO) 비율로 잘라 blob + publicUrl 로 돌려준다.
 * style transfer, inpaint 등 "프리뷰에 보이는 영역만 원본으로 쓰고 싶은" 모든
 * 파이프라인에서 동일하게 쓸 수 있다.
 */
export const preflightCropToFormat = async (
  imageUrl: string,
  storedCrop: unknown,
  videoFormat: VideoFormat,
  projectId: string,
  sceneNumber: number,
  label: string = "preflight-src",
): Promise<{ blob: Blob; publicUrl: string }> => {
  const crop = getCropForFmtFromStored(storedCrop, videoFormat);
  const blob = await cropImageForFormat(imageUrl, crop, videoFormat);
  const publicUrl = await uploadPreflightSource(blob, projectId, sceneNumber, label);
  return { blob, publicUrl };
};

/* ━━━━━ 한→영 번역 — @태그 보호 ━━━━━ */
const translateSceneToEnglish = async (scene: SceneForConti): Promise<SceneForConti> => {
  const koreanCharCount = (scene.description ?? "").match(/[ㄱ-힣]/g)?.length ?? 0;
  if (koreanCharCount < 30) return scene;
  try {
    const tagMap: Record<string, string> = {};
    let tagIdx = 0;
    const protectTags = (text: string) =>
      text.replace(/@([\w가-힣]+)/g, (match) => {
        const key = `__TAG${tagIdx++}__`;
        tagMap[key] = match;
        return key;
      });
    const restoreTags = (text: string) => Object.entries(tagMap).reduce((t, [k, v]) => t.replace(k, v), text);

    const protected_desc = protectTags(scene.description ?? "");
    const protected_loc = protectTags(scene.location ?? "");

    const { data, error } = await supabase.functions.invoke("claude-proxy", {
      body: {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system: `You are a translator for video production storyboards.
Translate the given Korean scene descriptions into concise, vivid English suitable for AI image generation.
Use cinematographic language. Be specific about visuals.
Preserve ALL placeholders like __TAG0__, __TAG1__ exactly as-is — do NOT translate them.
Return ONLY a raw JSON object with the same keys. No explanation, no markdown, no code fences.`,
        messages: [
          {
            role: "user",
            content: `Translate to English:\n${JSON.stringify(
              {
                title: scene.title ?? "",
                description: protected_desc,
                camera_angle: scene.camera_angle ?? "",
                location: protected_loc,
                mood: scene.mood ?? "",
              },
              null,
              2,
            )}`,
          },
        ],
      },
    });
    if (error || !data) return scene;
    const text = data.content?.[0]?.text ?? "";
    const clean = text.replace(/```json|```/g, "").trim();
    const translated = JSON.parse(clean);
    return {
      ...scene,
      title: translated.title || scene.title,
      description: restoreTags(translated.description || scene.description || ""),
      camera_angle: translated.camera_angle || scene.camera_angle,
      location: restoreTags(translated.location || scene.location || ""),
      mood: translated.mood || scene.mood,
    };
  } catch {
    return scene;
  }
};

/* ━━━━━ 씬 설명 → 시각적 연출 해석 ━━━━━ */
const enrichSceneDescription = async (
  scene: SceneForConti,
  briefAnalysis?: BriefAnalysis | null,
): Promise<{ enrichedContext: string }> => {
  const sparse = isSparseScene(scene);
  const hasMinContent =
    (scene.description?.trim().length ?? 0) >= 10 ||
    (scene.mood?.trim().length ?? 0) > 2 ||
    (scene.location?.trim().length ?? 0) > 2;

  if (!hasMinContent && !briefAnalysis) return { enrichedContext: "" };

  try {
    const userContent =
      sparse && briefAnalysis
        ? `This scene has minimal description. Use the campaign context to infer the visual direction.

Campaign goal: ${fieldToString(briefAnalysis.goal)}
Target audience: ${fieldToString(briefAnalysis.target)}
Key message: ${fieldToString(briefAnalysis.usp)}
Visual tone: ${fieldToString(briefAnalysis.tone_manner)}

Scene (partial): "${scene.description ?? ""}"
Location: "${scene.location ?? ""}"
Mood: "${scene.mood ?? ""}"

Based on the campaign context above, translate into visual composition directives:`
        : `Scene: "${scene.description}"\nLocation: "${scene.location ?? ""}"\nMood: "${scene.mood ?? ""}"\n\nTranslate into visual composition directives:`;

    const { data, error } = await supabase.functions.invoke("claude-proxy", {
      body: {
        model: "claude-sonnet-4-20250514",
        max_tokens: 200,
        system: `You are a cinematographer translating scene descriptions into precise visual composition directives for AI image generation.

Given a scene description, mood, and location, output a SHORT visual interpretation (3-5 sentences max) that covers:
1. FRAMING: How should the subject be positioned in frame? (rule of thirds, centered, foreground/background ratio, negative space)
2. LIGHTING: What does this mood translate to visually? (key light direction, color temperature, contrast, shadow quality)
3. ATMOSPHERE: Environmental details that reinforce the emotional tone (depth of field, background clarity, particles, weather)

Do NOT describe what characters look like or their outfits.
Do NOT restate the original scene description.
Do NOT introduce new characters, props, objects, brand names, text, or signage that are not already present in the given scene description — stick strictly to atmospheric and compositional directives.
Output ONLY the visual directives as a short paragraph. No labels, no bullet points, no explanation.`,
        messages: [
          {
            role: "user",
            content: userContent,
          },
        ],
      },
    });
    if (error || !data) return { enrichedContext: "" };
    const enriched = data.content?.[0]?.text?.trim() ?? "";
    return { enrichedContext: enriched };
  } catch {
    return { enrichedContext: "" };
  }
};

/* ━━━━━ 에셋 섹션 빌더 ━━━━━ */
const buildAssetSections = (assets: Asset[], hasImageUrls: boolean): string => {
  const characters = assets.filter((a) => (a.asset_type ?? "character") === "character");
  const items = assets.filter((a) => a.asset_type === "item");
  const backgrounds = assets.filter((a) => a.asset_type === "background");
  const sections: string[] = [];

  if (characters.length > 0) {
    const lines = characters.map((a) => {
      const rows = [
        `• ${a.tag_name}:${
          a.photo_url && hasImageUrls
            ? " [REFERENCE IMAGE PROVIDED] Preserve ONLY the facial identity — face shape, skin tone, hair color and style. Pose, expression, gaze, head tilt, and body orientation MUST follow THIS scene's ACTION — do NOT copy pose or expression from the reference photo."
            : a.photo_url
              ? " [Reference photo provided — match facial identity; pose/expression per scene action]"
              : a.ai_description
                ? ` ${sanitizeImagePrompt(a.ai_description)}`
                : ""
        }`,
        a.outfit_description
          ? `  OUTFIT: ${sanitizeImagePrompt(a.outfit_description)}`
          : "",
        a.ai_description && a.photo_url && hasImageUrls
          ? `  Appearance notes: ${sanitizeImagePrompt(a.ai_description)}`
          : "",
      ].filter(Boolean);
      return rows.join("\n");
    });
    sections.push(
      `[CHARACTERS — IDENTITY CONSISTENCY]\nThe following characters appear in this scene. Preserve their facial identity; stage their pose and expression fresh per this scene's ACTION.\n` +
        lines.join("\n"),
    );
  }

  if (items.length > 0) {
    const lines = items.map((a) => {
      const desc = a.ai_description ? sanitizeImagePrompt(a.ai_description) : "as described by tag name";
      return (
        `• ${a.tag_name}: ${desc}\n` +
        `  → THIS ITEM MUST BE VISIBLY PRESENT AND CLEARLY RECOGNIZABLE IN THE FRAME.` +
        (a.photo_url && hasImageUrls ? " [Reference image provided — match the item's design precisely]" : "")
      );
    });
    sections.push(`[PROPS — MUST BE VISIBLE AND IDENTIFIABLE]\n${lines.join("\n")}`);
  }

  if (backgrounds.length > 0) {
    const lines = backgrounds.map((a) => {
      const desc = a.space_description ? sanitizeImagePrompt(a.space_description) : "as described by tag name";
      return (
        `• ${a.tag_name}: ${desc}` +
        (a.photo_url && hasImageUrls
          ? "\n  → [Reference image provided] Match the location's architectural features, materials, and color palette. Frame the shot freshly per SHOT TYPE above — do NOT reproduce the reference's camera angle or composition."
          : "\n  → Recreate this location with consistency across all scenes.")
      );
    });
    sections.push(
      `[BACKGROUND / LOCATION — MAINTAIN SPATIAL CONSISTENCY]\n` +
        lines.join("\n") +
        `\n— Every scene sharing this location must look like the same physical space, but framing/camera angle is set by this scene's SHOT TYPE.`,
    );
  }

  return sections.join("\n\n");
};

const formatVisualDir = (vd: BriefAnalysis["visual_direction"]): string => {
  if (!vd) return "";
  if (typeof vd === "string") return vd;
  return [
    vd.camera ? `Camera: ${vd.camera}` : "",
    vd.lighting ? `Lighting: ${vd.lighting}` : "",
    vd.color_grade ? `Color: ${vd.color_grade}` : "",
    vd.editing ? `Editing: ${vd.editing}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
};

/* ━━━━━ 최종 프롬프트 조립 ━━━━━ */
const buildContiPrompt = (
  scene: SceneForConti,
  allScenes: SceneForConti[],
  assetSection: string,
  enrichedContext: string,
  videoFormat: VideoFormat,
  briefAnalysis?: BriefAnalysis | null,
  styleAnchor: string = DEFAULT_STYLE_ANCHOR,
): string => {
  const totalScenes = allScenes.length;
  const sceneIndex = allScenes.findIndex((s) => s.scene_number === scene.scene_number);
  const prevScene = sceneIndex > 0 ? allScenes[sceneIndex - 1] : null;
  const nextScene = sceneIndex < totalScenes - 1 ? allScenes[sceneIndex + 1] : null;

  const isFirstScene = scene.scene_number === 1;
  const isLastScene = scene.scene_number === totalScenes && totalScenes > 1;

  const shotDirective = resolveShotType(scene.scene_number, totalScenes, scene.camera_angle);

  const visualDirStr = formatVisualDir(briefAnalysis?.visual_direction);
  const briefContext = briefAnalysis
    ? `PROJECT CONTEXT:
- Campaign goal: ${fieldToString(briefAnalysis.goal)}
- Target audience: ${fieldToString(briefAnalysis.target)}
- Key message: ${fieldToString(briefAnalysis.usp)}
- Visual tone: ${fieldToString(briefAnalysis.tone_manner)}${
        visualDirStr ? `\n- Visual direction: ${visualDirStr}` : ""
      }`
    : "";

  const sceneFlow = allScenes
    .map(
      (s) => `  Scene ${s.scene_number}${s.scene_number === scene.scene_number ? " ← CURRENT" : ""}: ${s.title ?? ""}`,
    )
    .join("\n");

  const flowContext = `COMMERCIAL FLOW (${totalScenes} scenes):
${sceneFlow}
${prevScene ? `Previous: "${prevScene.title}"` : "OPENING scene"}
${nextScene ? `Next: "${nextScene.title}"` : "CLOSING scene"}
→ Composition MUST differ from adjacent scenes.`;

  const styleRules = `${styleAnchor}\n- ${FORMAT_PROMPT_NOTE[videoFormat]}`;

  const visualInterpretation = enrichedContext ? `\n  VISUAL DIRECTION: ${enrichedContext}` : "";

  const sceneDetail = `\n═══ SCENE CONTENT (HIGH PRIORITY) ═══
  Action: ${scene.description}
  Location: ${scene.location || "fitting the narrative"}
  Mood: ${scene.mood || "consistent with campaign tone"}${visualInterpretation}
═══════════════════════════════════════`;

  // ── v2 필드 주입 블록 ──
  const hv = briefAnalysis?.hero_visual;
  const hs = briefAnalysis?.hook_strategy;
  const pi = briefAnalysis?.product_info;
  const constraints = briefAnalysis?.constraints;

  const mustShowBlock =
    hv?.must_show && hv.must_show.length > 0
      ? `\n═══ MANDATORY VISIBLE ELEMENTS (from brief hero_visual.must_show) ═══
${hv.must_show.map((m) => `  • ${sanitizeImagePrompt(m)}`).join("\n")}
  → At least these elements MUST be clearly visible or implied in-frame.
═══════════════════════════════════════════`
      : "";

  const firstFrameBlock =
    isFirstScene && (hv?.first_frame || hs?.primary)
      ? `\n═══ FIRST-FRAME HOOK (scene 1 only) ═══${
          hv?.first_frame ? `\nOpening frame visual intent: ${sanitizeImagePrompt(hv.first_frame)}` : ""
        }${
          hs?.primary
            ? `\nHook type: ${hs.primary} — mood keywords: ${buildHookMoodAddendum(hs.primary)}`
            : ""
        }${
          hv?.brand_reveal_timing === "0-3s" || hv?.product_reveal_timing === "0-3s"
            ? `\nBrand/product MUST be visibly established in this frame (first 3 seconds exposure rule).`
            : ""
        }
═══════════════════════════════════════════`
      : "";

  const ctaBlock =
    isLastScene && pi && (pi.cta_action || pi.cta_destination)
      ? `\n═══ FINAL-SCENE CTA HINT (last scene only) ═══${
          pi.cta_action ? `\nCTA call: "${sanitizeImagePrompt(pi.cta_action)}"` : ""
        }${pi.cta_destination ? `\nDirects viewer to: ${sanitizeImagePrompt(pi.cta_destination)}` : ""}
  → Compose frame to visually imply the CTA moment (product hero shot, emotional peak, or clear directional cue).
  → Do NOT render CTA text inside the image itself (text will be overlaid later).
═══════════════════════════════════════════`
      : "";

  const negativePromptBlock =
    constraints?.avoid && constraints.avoid.length > 0
      ? `\n═══ NEGATIVE PROMPT — AVOID ═══
${constraints.avoid.map((v) => `  ✗ ${sanitizeImagePrompt(v)}`).join("\n")}
═══════════════════════════════════════════`
      : "";

  const castLockBlock = assetSection
    ? `\n═══ CAST LOCK (STRICT) ═══
The characters and objects listed in ASSET REQUIREMENTS above are the ONLY people and tangible objects allowed in this frame.
Do NOT add bystanders, extras, additional characters, pets, logos, brand signage, text, or props that are not explicitly listed.
If the scene description implies someone/something off-camera, keep them off-camera.
═══════════════════════════════════`
    : "";

  const topDirective =
    `Create a single cinematic storyboard frame for a commercial advertisement.\n` +
    `Compose this frame FRESH based on the SHOT TYPE and this scene's ACTION below. Reference images are for identity and material guidance only — never for composition, pose, or expression copying.`;

  return [
    topDirective,
    `\n${shotDirective}\n`,
    sceneDetail,
    firstFrameBlock,
    mustShowBlock,
    ctaBlock,
    assetSection
      ? `\n═══ ASSET REQUIREMENTS (HIGHEST PRIORITY) ═══\n${assetSection}\n═══════════════════════════════════════════`
      : "",
    castLockBlock,
    briefContext,
    flowContext,
    styleRules,
    negativePromptBlock,
  ]
    .filter(Boolean)
    .join("\n");
};

/* ━━━━━ fetchTaggedAssets ━━━━━
 *
 * Returns assets in the SAME order the caller passed tags in. This
 * matters: `tagged_assets` is built location-first in ContiTab /
 * AgentSceneCards, so the first background tag in the list is the
 * scene's primary location. `buildAssetImageUrls` keys its "primary
 * bg" selection on this ordering. Without explicit sort-by-input-order
 * Supabase returns rows in heap order and the primary bg becomes
 * whichever row the DB happened to return first. */
export const fetchTaggedAssets = async (tags: string[], projectId: string): Promise<Asset[]> => {
  if (!tags || tags.length === 0) return [];
  const normalizedTags = tags.map((t) => (t.startsWith("@") ? t : `@${t}`));
  const rawTags = normalizedTags.map((t) => t.slice(1));
  const { data: allAssets } = (await supabase
    .from("assets")
    .select(
      "tag_name, photo_url, ai_description, outfit_description, signature_items, space_description, asset_type",
    )
    .eq("project_id", projectId)) as any;
  if (!allAssets) return [];

  const byRawTag = new Map<string, Asset>();
  for (const asset of allAssets as Asset[]) {
    const raw = asset.tag_name.startsWith("@") ? asset.tag_name.slice(1) : asset.tag_name;
    const norm = asset.tag_name.startsWith("@") ? asset.tag_name : `@${asset.tag_name}`;
    if (normalizedTags.includes(norm) || normalizedTags.includes(asset.tag_name) || rawTags.includes(raw)) {
      byRawTag.set(raw, asset);
    }
  }

  const out: Asset[] = [];
  const seen = new Set<string>();
  for (const raw of rawTags) {
    const hit = byRawTag.get(raw);
    if (hit && !seen.has(raw)) {
      out.push(hit);
      seen.add(raw);
    }
  }
  return out;
};

/* ━━━━━ assetImageUrls 조립 ━━━━━
 *
 * Each tag resolves to exactly one `photo_url`. There is no longer a
 * framing picker — if the user wants the close-up view of a location
 * they @-mention `@BG_close` directly, which is its own asset row.
 *
 * Order is preserved from `fetchTaggedAssets`, so `bgAssets[0]` is
 * the location tag (because `computeTaggedAssets` and
 * `handleLocChange` prepend location-derived tags). Subsequent
 * backgrounds fill in if slots remain under the 6-image cap. */
const buildAssetImageUrls = (
  assets: Asset[],
  styleImageUrl?: string,
): string[] => {
  const MAX = 6;
  const urls: string[] = [];

  if (styleImageUrl) urls.push(styleImageUrl);

  const bgAssets = assets.filter((a) => a.asset_type === "background" && a.photo_url);
  if (bgAssets.length > 0 && bgAssets[0].photo_url) {
    urls.push(bgAssets[0].photo_url);
  }

  for (const a of assets.filter((a) => a.asset_type === "character" && a.photo_url)) {
    if (urls.length >= MAX) break;
    urls.push(a.photo_url as string);
  }

  for (const a of assets.filter((a) => a.asset_type === "item" && a.photo_url)) {
    if (urls.length >= MAX) break;
    urls.push(a.photo_url as string);
  }

  for (const a of bgAssets.slice(1)) {
    if (urls.length >= MAX) break;
    if (a.photo_url) urls.push(a.photo_url);
  }

  return urls;
};

/* ━━━━━ filterMustShowForScene ━━━━━
 *
 * `hero_visual.must_show` is a brief-level array ("things that MUST be
 * visible") and `buildContiPrompt` injects it into every non-TR scene
 * unconditionally. When the brief was built around an IP collab (e.g.
 * PUBGM × Lupi), items like "Lupi mascot visible" leak the hero character
 * into scenes where the user explicitly did NOT tag that asset — the model
 * sees a "MUST be visible" directive and quietly paints it into the
 * background.
 *
 * This filter drops must_show items that name a project asset which is not
 * tagged on the current scene. Items that reference only generic visual
 * elements (no asset name match) pass through untouched, preserving the
 * original intent for abstract must-shows like "brand logo moment" /
 * "hero product close-up" when no per-asset conflict exists.
 *
 * Matching is lowercase substring against each project asset `tag_name`
 * (minus the `@` prefix). A 2-char minimum guards against a 1-letter tag
 * (`@A`) matching every English sentence. Partial overlaps are accepted on
 * purpose — must_show items rarely contain the raw `@tag` token and usually
 * paraphrase the asset name.
 */
function filterMustShowForScene(
  items: string[] | undefined,
  projectAssetTags: string[],
  sceneTagSet: Set<string>,
  sceneNumber: number,
): string[] {
  if (!items || items.length === 0) return [];
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const raw of items) {
    const lower = raw.toLowerCase();
    const mentioned = projectAssetTags.filter((t) => t.length >= 2 && lower.includes(t));
    if (mentioned.length === 0) {
      kept.push(raw);
      continue;
    }
    const allTagged = mentioned.every((t) => sceneTagSet.has(t));
    if (allTagged) kept.push(raw);
    else dropped.push(raw);
  }
  if (dropped.length > 0) {
    console.warn(
      `[generateConti] S${sceneNumber} dropped ${dropped.length} must_show item(s) referencing non-tagged assets:`,
      dropped,
    );
  }
  return kept;
}

/* ━━━━━ generateConti ━━━━━ */
export const generateConti = async ({
  scene,
  allScenes,
  projectId,
  videoFormat = "vertical",
  briefAnalysis,
  styleAnchor = DEFAULT_STYLE_ANCHOR,
  styleImageUrl,
  model = "nano-banana-2",
  onStageChange,
}: ContiGenerateOptions): Promise<string> => {
  // Belt-and-suspenders: drop stale `tagged_assets` entries that are
  // no longer `@mentioned` anywhere in description/location. The UI
  // save path (computeTaggedAssets) now enforces this on every edit,
  // but legacy scene rows — especially ones duplicated before that
  // fix — may still carry zombie character/item tags from ancestors.
  // Reading the text as the source of truth here prevents their photos
  // from being quietly attached as references.
  const combinedText = `${scene.description ?? ""} ${scene.location ?? ""}`;
  const mentionTokens = (combinedText.match(/@[\w가-힣]+/g) ?? []).map((m) =>
    m.slice(1).toLowerCase(),
  );
  const activeTagList = (scene.tagged_assets ?? []).filter((tag) => {
    const name = (tag.startsWith("@") ? tag.slice(1) : tag).toLowerCase();
    // Exact match or Korean-particle suffix (e.g. `@YD가` → tag `YD`).
    return mentionTokens.some((tok) => tok === name || tok.startsWith(name));
  });
  if (activeTagList.length !== (scene.tagged_assets ?? []).length) {
    const dropped = (scene.tagged_assets ?? []).filter((t) => !activeTagList.includes(t));
    console.warn("[generateConti] dropped stale tagged_assets", { dropped, scene: scene.scene_number });
  }
  const taggedAssets = await fetchTaggedAssets(activeTagList, projectId);
  const assetImageUrls = buildAssetImageUrls(taggedAssets, styleImageUrl);
  const assetSection = buildAssetSections(taggedAssets, assetImageUrls.length > 0);

  // Fetch all project asset tag names (lightweight) so we can filter
  // `hero_visual.must_show` items that name an asset not tagged on the
  // current scene — see `filterMustShowForScene` for rationale.
  const { data: allProjectAssetsRaw } = await supabase
    .from("assets")
    .select("tag_name")
    .eq("project_id", projectId);
  const projectAssetTags: string[] = (allProjectAssetsRaw ?? [])
    .map((a: { tag_name: string | null }) => a.tag_name ?? "")
    .filter(Boolean)
    .map((t: string) => (t.startsWith("@") ? t.slice(1) : t).toLowerCase());
  const sceneTagSet = new Set(
    (scene.tagged_assets ?? []).map((t) => (t.startsWith("@") ? t.slice(1) : t).toLowerCase()),
  );

  const filteredMustShow = filterMustShowForScene(
    briefAnalysis?.hero_visual?.must_show,
    projectAssetTags,
    sceneTagSet,
    scene.scene_number,
  );

  const safeBrief: BriefAnalysis | null = briefAnalysis
    ? {
        goal: fieldToArray(briefAnalysis.goal).map(sanitizeImagePrompt),
        target: fieldToArray(briefAnalysis.target).map(sanitizeImagePrompt),
        usp: fieldToArray(briefAnalysis.usp).map(sanitizeImagePrompt),
        tone_manner: fieldToArray(briefAnalysis.tone_manner).map(sanitizeImagePrompt),
        visual_direction: briefAnalysis.visual_direction,
        // v2 fields — 통과시켜 buildContiPrompt 가 활용. sanitize 는 첫프레임/CTA 시점에 국소 적용.
        hero_visual: briefAnalysis.hero_visual
          ? { ...briefAnalysis.hero_visual, must_show: filteredMustShow }
          : undefined,
        hook_strategy: briefAnalysis.hook_strategy,
        product_info: briefAnalysis.product_info,
        constraints: briefAnalysis.constraints,
      }
    : null;

  const safeScene: SceneForConti = {
    ...scene,
    title: sanitizeImagePrompt(scene.title ?? ""),
    description: sanitizeImagePrompt(scene.description ?? ""),
    camera_angle: sanitizeImagePrompt(scene.camera_angle ?? ""),
    location: sanitizeImagePrompt(scene.location ?? ""),
    mood: sanitizeImagePrompt(scene.mood ?? ""),
  };

  onStageChange?.("translating");
  const [translatedScene, { enrichedContext }] = await Promise.all([
    translateSceneToEnglish(safeScene),
    enrichSceneDescription(safeScene, safeBrief as BriefAnalysis | null),
  ]);
  onStageChange?.("building");

  const safeAllScenes = allScenes.map((s) => ({
    ...s,
    title: sanitizeImagePrompt(s.title ?? ""),
    description: sanitizeImagePrompt(s.description ?? ""),
  }));

  const rawPrompt = buildContiPrompt(
    translatedScene,
    safeAllScenes,
    assetSection,
    enrichedContext,
    videoFormat,
    safeBrief as any,
    styleAnchor,
  );
  const finalPrompt =
    sanitizeImagePrompt(rawPrompt) + "\n\nSafe for all audiences. No violence, weapons, or real celebrities.";

  // Opt-in diagnostic dump. Enable in DevTools with:
  //   (window as any).__CONTI_DEBUG__ = true
  // to inspect which brief fragments landed in the prompt for a given scene.
  if (typeof window !== "undefined" && (window as any).__CONTI_DEBUG__ === true) {
    console.groupCollapsed(
      `[conti] S${scene.scene_number} prompt (${finalPrompt.length} chars)`,
    );
    console.log("scene.tagged_assets:", scene.tagged_assets);
    console.log("projectAssetTags:", projectAssetTags);
    console.log("must_show (raw):", briefAnalysis?.hero_visual?.must_show ?? "(none)");
    console.log("must_show (filtered):", filteredMustShow);
    console.log("assetImageUrls:", assetImageUrls);
    console.log(finalPrompt);
    console.groupEnd();
  }

  onStageChange?.("generating");
  const { data, error } = await supabase.functions.invoke("openai-image", {
    body: {
      prompt: finalPrompt,
      projectId,
      sceneNumber: scene.scene_number,
      imageSize: IMAGE_SIZE_MAP[videoFormat],
      assetImageUrls,
      model: model ?? "nano-banana-2",
      timestamp: Date.now(),
    },
  });

  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error?.message ?? data.error?.type ?? "Image generation failed");

  const publicUrl = data.publicUrl;
  if (!publicUrl) throw new Error("No image URL returned");

  if (data.usedModel) {
    console.log(`[Conti] Scene ${scene.scene_number} generated with: ${data.usedModel}`);
  }

  onStageChange?.("uploading");
  await supabase.from("scenes").update({ conti_image_url: publicUrl }).eq("id", scene.id);
  return publicUrl;
};

/* ━━━━━ styleTransfer ━━━━━ */
export const styleTransfer = async ({
  scene,
  projectId,
  styleImageUrl,
  stylePrompt,
  videoFormat,
  model,
  onStageChange,
}: StyleTransferOptions): Promise<string> => {
  const styleDesc = stylePrompt?.trim() || "";

  // ── imageSize: 항상 프로젝트 포맷 = 프리뷰 컨테이너 비율과 일치한 NB2 비율로 통일 ──
  // (1024x1536/1536x1024/1024x1024 → toNanoBananaAspectRatio 가 9:16/16:9/1:1 로 매핑)
  const imageSize = IMAGE_SIZE_MAP[videoFormat];

  // ── 프리뷰 비율로 source 이미지 사전-크롭 ──
  // GPT(1:1, 2:3, 3:2 등)와 NB2(9:16, 16:9, 1:1)의 지원 비율이 달라, 그대로 NB2 에 넘기면
  // 결과가 NB2 비율로 강제 변형되며 찌그러진다. 씬카드 프리뷰에 보이는 영역(=FORMAT_RATIO)을
  // 그대로 잘라서 NB2 에 넘기면 입력/출력 비율이 같아 더 이상 찌그러지지 않는다.
  let preflightSourceUrl = scene.conti_image_url;
  // preflight crop 으로 업로드한 임시 파일. 스타일 트랜스퍼 완료/실패 후
  // 디스크에서 지워야 disposable intermediate 가 계속 쌓이지 않는다.
  let preflightTempUrl: string | null = null;
  try {
    const { publicUrl } = await preflightCropToFormat(
      scene.conti_image_url,
      scene.conti_image_crop,
      videoFormat,
      projectId,
      scene.scene_number,
      "styletx-src",
    );
    preflightSourceUrl = publicUrl;
    preflightTempUrl = publicUrl;
    console.log("[StyleTransfer] pre-crop 완료", {
      videoFormat,
      formatRatio: FORMAT_RATIO[videoFormat],
      preflightSourceUrl,
    });
  } catch (cropErr) {
    console.warn("[StyleTransfer] pre-crop 실패 — 원본 이미지로 진행", cropErr);
  }

  // ── NB2용 프롬프트: 이미지 스타일만 차용, 텍스트 style_prompt 제외 ──
  const nbPrompt = [
    `The FIRST image is the SOURCE SCENE. Preserve it exactly:`,
    `- Same subjects, characters, and count (no additions or removals)`,
    `- Same background and environment`,
    `- Same camera angle, framing, composition`,
    `- Same objects and props`,
    ``,
    `The SECOND image is the STYLE REFERENCE. Extract ONLY:`,
    `- Visual rendering style and line quality`,
    `- Color palette and lighting mood`,
    `- Texture and artistic treatment`,
    ``,
    `Do NOT add any new subjects, characters, or objects from the style reference image.`,
    `This is a STYLE-ONLY transformation. Do not alter scene content.`,
  ].join("\n");

  // ── GPT 폴백용 프롬프트: style_prompt 텍스트 포함 ──
  const gptPrompt = styleDesc
    ? [`Apply this visual style to the scene: ${styleDesc}.`, ``, ...nbPrompt.split("\n")].join("\n")
    : nbPrompt;

  onStageChange?.("generating");
  console.log("[StyleTransfer] 호출", {
    scene: scene.scene_number,
    sourceImageUrl: preflightSourceUrl,
    originalImageUrl: scene.conti_image_url,
    stylePrompt: styleDesc || "(image-only)",
    imageSize,
    // model 을 로그에 노출해 "GPT 선택했는데 NB2 로 나오는 것 같다" 류의
    // 체감 버그를 서버 로그 ([StyleTransfer] stModel=...) 와 교차확인할 수 있게 한다.
    requestedModel: model ?? "(default=nano-banana-2)",
  });

  const { data, error } = await supabase.functions.invoke("openai-image", {
    body: {
      mode: "style_transfer",
      prompt: nbPrompt,
      gptPrompt: gptPrompt,
      sourceImageUrl: preflightSourceUrl, // 프리뷰 비율로 잘라낸 이미지
      styleImageUrl: styleImageUrl ?? null,
      imageSize, // 프로젝트 포맷 기준
      projectId,
      sceneNumber: scene.scene_number,
      // When the user's selected model is "gpt", skip the NB2 primary
      // pass entirely so GPT Image 2 is used for style consistency
      // (GPT now handles style preservation as well as NB2). When
      // omitted or "nano-banana-2" the edge keeps the legacy NB2→GPT
      // fallback chain, so this is backward compatible.
      model: model ?? null,
    },
  });

  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error?.message ?? data.error?.type ?? "Style transfer failed");

  const publicUrl = data.publicUrl;
  if (!publicUrl) throw new Error("No image URL returned");

  // usedModel 값은 경로 판별용 — 아래 한 가지 중 하나가 나와야 한다.
  //   "gpt-image-2"               → 사용자가 GPT 선택, GPT primary 성공
  //   "nano-banana-2"             → 사용자가 NB2(기본) 선택, NB2 primary 성공
  //   "style-gpt-fallback:...":   → NB2 primary 실패해서 GPT 폴백으로 넘어감
  // "GPT 로 해도 NB2 로 도는 것 같다" 체감이 있다면 이 값이 실제로 뭐 찍혔는지 확인.
  console.log("[StyleTransfer] 완료", {
    scene: scene.scene_number,
    requestedModel: model ?? "(default=nano-banana-2)",
    usedModel: data.usedModel,
  });

  onStageChange?.("uploading");
  // 새 이미지의 자연 비율 = FORMAT_RATIO[videoFormat] = 프리뷰 컨테이너 비율 → 별도의 crop 불필요.
  // (이전 crop 들은 옛 이미지의 콘텐츠 좌표 기준이라 새 이미지엔 안 맞으므로 모두 비운다.)
  await supabase
    .from("scenes")
    .update({ conti_image_url: publicUrl, conti_image_crop: null })
    .eq("id", scene.id);
  // 성공적으로 DB 반영됐으니 preflight 임시 파일은 더 이상 필요 없다.
  // (실패 경로에서는 호출부가 catch 후 재시도할 수도 있어 지우지 않는다.)
  if (preflightTempUrl) void deleteStoredFile(preflightTempUrl);
  return publicUrl;
};
