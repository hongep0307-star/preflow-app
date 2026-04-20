import { supabase } from "./supabase";

/* ━━━━━ 타입 ━━━━━ */
type AssetType = "character" | "item" | "background";

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
  moodReferenceUrl?: string;
  model?: ContiModel;
  onStageChange?: (stage: GeneratingStage) => void;
}

export interface StyleTransferOptions {
  // conti_image_crop을 포함한 full Scene 객체를 허용
  // ia(image aspect ratio)를 crop 데이터에서 읽어 정확한 imageSize를 계산하기 위함
  scene: SceneForConti & { conti_image_url: string; conti_image_crop?: unknown };
  projectId: string;
  styleImageUrl: string;
  stylePrompt?: string;
  videoFormat: VideoFormat;
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

/* ━━━━━ aspect ratio → imageSize 문자열 변환 ━━━━━
 * GPT/NB2가 지원하는 3가지 크기 중 가장 가까운 것을 선택.
 * 비표준 크기(1536x1536 등)를 반환하지 않아 GPT API 오류 방지.
 */
const imageSizeFromAspect = (ia: number): string => {
  if (ia >= 1.4) return "1536x1024"; // 16:9 가로
  if (ia <= 0.75) return "1024x1536"; // 9:16 세로
  return "1024x1024"; // 정사각형 계열
};

/* ━━━━━ conti_image_crop 에서 ia 추출 ━━━━━
 * CropState: { ia?: number, fmt?: string, _v?: number, ... }
 * CropMap:   { horizontal?: CropState, vertical?: CropState, square?: CropState }
 * 어느 포맷이든 ia가 있으면 반환.
 */
const getIaFromCrop = (crop: unknown): number | null => {
  if (!crop || typeof crop !== "object") return null;
  const obj = crop as Record<string, any>;
  // CropMap 형식
  for (const fmt of ["horizontal", "vertical", "square"]) {
    const state = obj[fmt];
    if (state && typeof state === "object" && typeof state.ia === "number" && state.ia > 0) {
      return state.ia;
    }
  }
  // 직접 CropState 형식
  if (typeof obj.ia === "number" && obj.ia > 0) return obj.ia;
  return null;
};

/* ━━━━━ 소스 이미지 URL → imageSize 감지 (CORS 폴백용) ━━━━━
 * crop ia를 우선 사용하고 없을 때만 이 함수를 호출한다.
 * crossOrigin = "anonymous" 추가로 CORS 오류 방지.
 */
const detectImageSize = (url: string, fallback: string): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (w <= 0 || h <= 0) return resolve(fallback);
      resolve(imageSizeFromAspect(w / h));
    };
    img.onerror = () => resolve(fallback);
    img.src = url;
  });
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
            ? " [REFERENCE IMAGE PROVIDED — You MUST preserve this person's exact facial features, skin tone, hair color, hair style, and body proportions. HIGHEST PRIORITY constraint.]"
            : a.photo_url
              ? " [Reference photo provided — match appearance closely]"
              : a.ai_description
                ? ` ${sanitizeImagePrompt(a.ai_description)}`
                : ""
        }`,
        a.outfit_description
          ? `  OUTFIT (MANDATORY — render exactly): ${sanitizeImagePrompt(a.outfit_description)}`
          : "",
        a.ai_description && a.photo_url && hasImageUrls
          ? `  Appearance notes: ${sanitizeImagePrompt(a.ai_description)}`
          : "",
      ].filter(Boolean);
      return rows.join("\n");
    });
    sections.push(
      `[CHARACTERS — VISUAL CONSISTENCY IS MANDATORY]\nThe following characters MUST appear exactly as described.\n` +
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
          ? "\n  → [Reference image provided — MATCH THIS ENVIRONMENT PRECISELY.]"
          : "\n  → Recreate this location with consistency across all scenes.")
      );
    });
    sections.push(
      `[BACKGROUND / LOCATION — MAINTAIN SPATIAL CONSISTENCY]\n` +
        lines.join("\n") +
        `\n— Every scene sharing this location must look like the same physical space.`,
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
  hasMoodReference: boolean = false,
): string => {
  const totalScenes = allScenes.length;
  const sceneIndex = allScenes.findIndex((s) => s.scene_number === scene.scene_number);
  const prevScene = sceneIndex > 0 ? allScenes[sceneIndex - 1] : null;
  const nextScene = sceneIndex < totalScenes - 1 ? allScenes[sceneIndex + 1] : null;

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

  const moodRefNote = hasMoodReference
    ? `\n═══ MOOD REFERENCE IMAGE (COMPOSITION GUIDE) ═══
The FIRST reference image is a mood/composition guide.
STRICTLY FOLLOW its camera angle, framing, character placement, spatial layout, and overall composition.
Adapt the scene content and characters into this exact composition framework.
═══════════════════════════════════════════\n`
    : "";

  const visualInterpretation = enrichedContext ? `\n  VISUAL DIRECTION: ${enrichedContext}` : "";

  const sceneDetail = `\n═══ SCENE CONTENT (HIGH PRIORITY) ═══
  Action: ${scene.description}
  Location: ${scene.location || "fitting the narrative"}
  Mood: ${scene.mood || "consistent with campaign tone"}${visualInterpretation}
═══════════════════════════════════════`;

  return [
    `Create a single cinematic storyboard frame for a commercial advertisement.`,
    moodRefNote,
    `\n${shotDirective}\n`,
    sceneDetail,
    assetSection
      ? `\n═══ ASSET REQUIREMENTS (HIGHEST PRIORITY) ═══\n${assetSection}\n═══════════════════════════════════════════`
      : "",
    briefContext,
    flowContext,
    styleRules,
  ]
    .filter(Boolean)
    .join("\n");
};

/* ━━━━━ fetchTaggedAssets ━━━━━ */
export const fetchTaggedAssets = async (tags: string[], projectId: string): Promise<Asset[]> => {
  if (!tags || tags.length === 0) return [];
  const normalizedTags = tags.map((t) => (t.startsWith("@") ? t : `@${t}`));
  const rawTags = normalizedTags.map((t) => t.slice(1));
  const { data: allAssets } = (await supabase
    .from("assets")
    .select("tag_name, photo_url, ai_description, outfit_description, signature_items, space_description, asset_type")
    .eq("project_id", projectId)) as any;
  if (!allAssets) return [];
  return (allAssets as any[]).filter((asset) => {
    const norm = asset.tag_name.startsWith("@") ? asset.tag_name : `@${asset.tag_name}`;
    const raw = asset.tag_name.startsWith("@") ? asset.tag_name.slice(1) : asset.tag_name;
    return normalizedTags.includes(norm) || normalizedTags.includes(asset.tag_name) || rawTags.includes(raw);
  }) as Asset[];
};

/* ━━━━━ assetImageUrls 조립 ━━━━━ */
const buildAssetImageUrls = (assets: Asset[], styleImageUrl?: string, moodReferenceUrl?: string): string[] => {
  const MAX = 6;
  const urls: string[] = [];

  if (moodReferenceUrl) urls.push(moodReferenceUrl);
  if (styleImageUrl) urls.push(styleImageUrl);

  const bgAssets = assets.filter((a) => a.asset_type === "background" && a.photo_url);
  if (bgAssets.length > 0) urls.push(bgAssets[0].photo_url as string);

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
    urls.push(a.photo_url as string);
  }

  return urls;
};

/* ━━━━━ generateConti ━━━━━ */
export const generateConti = async ({
  scene,
  allScenes,
  projectId,
  videoFormat = "vertical",
  briefAnalysis,
  styleAnchor = DEFAULT_STYLE_ANCHOR,
  styleImageUrl,
  moodReferenceUrl,
  model = "nano-banana-2",
  onStageChange,
}: ContiGenerateOptions): Promise<string> => {
  const taggedAssets = await fetchTaggedAssets(scene.tagged_assets ?? [], projectId);
  const assetImageUrls = buildAssetImageUrls(taggedAssets, styleImageUrl, moodReferenceUrl);
  const assetSection = buildAssetSections(taggedAssets, assetImageUrls.length > 0);

  const safeBrief = briefAnalysis
    ? {
        goal: fieldToArray(briefAnalysis.goal).map(sanitizeImagePrompt),
        target: fieldToArray(briefAnalysis.target).map(sanitizeImagePrompt),
        usp: fieldToArray(briefAnalysis.usp).map(sanitizeImagePrompt),
        tone_manner: fieldToArray(briefAnalysis.tone_manner).map(sanitizeImagePrompt),
        visual_direction: briefAnalysis.visual_direction,
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
    !!moodReferenceUrl,
  );
  const finalPrompt =
    sanitizeImagePrompt(rawPrompt) + "\n\nSafe for all audiences. No violence, weapons, or real celebrities.";

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
  onStageChange,
}: StyleTransferOptions): Promise<string> => {
  const styleDesc = stylePrompt?.trim() || "";
  const fallbackSize = IMAGE_SIZE_MAP[videoFormat];

  // ── imageSize 결정: 우선순위 순 ──
  // 1순위: conti_image_crop의 ia (가장 신뢰도 높음 — 네트워크 요청 없음)
  // 2순위: 이미지 URL 로드로 실제 픽셀 크기 감지 (crossOrigin 포함)
  // 3순위: 프로젝트 포맷 폴백
  const cropIa = getIaFromCrop(scene.conti_image_crop);
  const imageSize = cropIa ? imageSizeFromAspect(cropIa) : await detectImageSize(scene.conti_image_url, fallbackSize);

  console.log("[StyleTransfer] imageSize 결정", {
    source: cropIa ? "crop_ia" : "detect",
    cropIa,
    imageSize,
    fallback: fallbackSize,
  });

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
    sourceImageUrl: scene.conti_image_url,
    stylePrompt: styleDesc || "(image-only)",
    imageSize,
  });

  const { data, error } = await supabase.functions.invoke("openai-image", {
    body: {
      mode: "style_transfer",
      prompt: nbPrompt,
      gptPrompt: gptPrompt,
      sourceImageUrl: scene.conti_image_url,
      styleImageUrl: styleImageUrl ?? null,
      imageSize, // 소스 이미지 실제 비율 기준
      projectId,
      sceneNumber: scene.scene_number,
    },
  });

  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error?.message ?? data.error?.type ?? "Style transfer failed");

  const publicUrl = data.publicUrl;
  if (!publicUrl) throw new Error("No image URL returned");

  console.log("[StyleTransfer] 완료, usedModel:", data.usedModel);

  onStageChange?.("uploading");
  await supabase.from("scenes").update({ conti_image_url: publicUrl }).eq("id", scene.id);
  return publicUrl;
};
