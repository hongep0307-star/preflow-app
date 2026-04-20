import { supabase } from "./supabase";
import { KNOWLEDGE_MOOD_CINEMATICS } from "./directorKnowledgeBase";

/* ━━━━━ Types ━━━━━ */
export interface MoodGenerateOptions {
  projectId: string;
  briefAnalysis: {
    goal?: any;
    target?: any;
    usp?: any;
    tone_manner?: any;
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
          hook?: { description?: string };
          body?: { description?: string };
          cta?: { description?: string };
        }
      | string;
  } | null;
  scenes: {
    scene_number: number;
    title?: string | null;
    description?: string | null;
    camera_angle?: string | null;
    location?: string | null;
    mood?: string | null;
    tagged_assets?: string[];
  }[];
  assets: {
    tag_name: string;
    photo_url?: string | null;
    ai_description?: string | null;
    asset_type?: string;
    outfit_description?: string | null;
    space_description?: string | null;
    role_description?: string | null;
  }[];
  videoFormat: string;
  count?: number;
  targetSceneNumber?: number | null;
  model?: "creative" | "asset";
}

/* ━━━━━ Legacy 랜덤 풀 (폴백용 보존) ━━━━━ */

const CAMERA_POOL = [
  "EXTREME WIDE SHOT — vast environment, subject small in frame",
  "WIDE SHOT — full body visible, environment context clear",
  "MEDIUM SHOT — waist up, natural conversational distance",
  "MEDIUM CLOSE-UP — chest up, subtle emotional read",
  "CLOSE-UP — face fills frame, emotion dominant",
  "EXTREME CLOSE-UP — eyes or hands only, texture and detail",
  "LOW ANGLE — looking up at subject, powerful and heroic",
  "HIGH ANGLE — bird's eye view, subject looks small and vulnerable",
  "DUTCH ANGLE — 15–20° tilt, unease and dynamic energy",
  "OVER THE SHOULDER — intimacy, POV of conversation",
  "RACK FOCUS — foreground blurred to background reveal",
  "TRACKING SHOT — subject in motion, lateral movement",
];

const LIGHTING_POOL = [
  "golden hour backlight — warm amber rim, deep shadows, lens flare",
  "harsh midday sun — strong shadows, high contrast, bleached highlights",
  "soft overcast — flat diffused light, no harsh shadows, pastel tones",
  "neon city night — magenta and cyan mixed, deep blacks, wet reflections",
  "practical tungsten — warm orange interior light, moody shadows",
  "cold blue moonlight — desaturated, silver highlights, night atmosphere",
  "studio strobe — sharp clean light, controlled shadows, commercial look",
  "candle and fire glow — flickering orange warmth, vignette, intimate",
  "fluorescent office — green-tinged, flat, slightly unsettling",
  "dramatic side lighting — half-lit face Rembrandt style, chiaroscuro",
  "foggy diffused light — hazy atmosphere, soft edges, dreamy",
  "silhouette lighting — subject backlit, no detail, pure shape",
];

const COLOR_GRADE_POOL = [
  "teal and orange cinematic grade — warm skin tones, cool shadow",
  "bleach bypass — desaturated, high contrast, silver metallic look",
  "warm film emulsion — Kodak Portra 400 style, creamy highlights",
  "cold clinical — cool blue-white, antiseptic, razor sharp",
  "vintage faded — lifted blacks, muted saturation, nostalgic",
  "high saturation vivid — punchy colors, commercial energy",
  "monochromatic blue — near black-and-white with blue cast",
  "earthy desaturated — brown-green tones, documentary realism",
  "cross-processed — shifted hues, unexpected color combinations",
  "day for night — blue-tinted underexposed, simulated night",
  "high key — overexposed minimal shadows, airy and light",
  "low key — deep shadows, only essential highlights visible",
];

const VISUAL_STYLE_POOL = [
  "35mm film grain — visible grain, slight vignette, organic texture",
  "hyperreal CGI render — perfectly crisp, no film artifacts, smooth",
  "editorial fashion — sharp confident poses, high fashion lighting",
  "documentary handheld — slight camera movement, naturalistic",
  "painterly impressionist — soft edges, visible brushstroke texture",
  "graphic novel — strong outlines, flat color zones, stylized",
  "vintage advertisement — retro feel, muted palette, nostalgic",
  "luxury commercial — pristine surfaces, perfect lighting, aspirational",
  "social media vertical — bold framing, native mobile energy",
  "slow cinema — minimal movement, wide lens, contemplative",
  "abstract art direction — shapes and color over narrative clarity",
  "photo collage — layered textures, mixed media, tactile",
];

const MOOD_TONE_POOL = [
  "tense and suspenseful — held breath, anticipation",
  "joyful and energetic — movement, brightness, warmth",
  "melancholy and introspective — stillness, muted tones",
  "epic and grand — scale, drama, orchestral feel",
  "intimate and tender — close, soft, deeply emotional",
  "gritty and raw — imperfect, real, unpolished",
  "surreal and dreamlike — logic-defying, soft boundaries",
  "sleek and corporate — clean lines, confidence, trust",
  "playful and quirky — unexpected angles, bold colors",
  "romantic and nostalgic — warm light, soft focus, longing",
  "urgent and kinetic — motion blur, fast pace, adrenaline",
  "peaceful and meditative — silence, simplicity, open space",
];

const SIZE_MAP: Record<string, string> = {
  vertical: "1024x1536",
  horizontal: "1536x1024",
  square: "1024x1024",
};

/* ━━━━━ 헬퍼 ━━━━━ */
const fieldToString = (f: any): string => {
  if (!f) return "";
  if (Array.isArray(f))
    return f.map((item) => (typeof item === "object" && item.keyword ? item.keyword : String(item))).join(", ");
  if (typeof f === "object" && f.summary) return f.summary;
  return String(f);
};

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

const normalize = (tag: string) => tag.replace(/^@/, "");

/* ━━━━━ Legacy 프롬프트 빌더 (폴백용) ━━━━━ */
function buildLegacyMoodPrompt(opts: MoodGenerateOptions): string {
  const { briefAnalysis, scenes, assets, videoFormat, targetSceneNumber } = opts;

  const camera = pick(CAMERA_POOL);
  const lighting = pick(LIGHTING_POOL);
  const colorGrade = pick(COLOR_GRADE_POOL);
  const style = pick(VISUAL_STYLE_POOL);
  const moodTone = pick(MOOD_TONE_POOL);

  const formatNote =
    videoFormat === "vertical"
      ? "vertical 9:16 mobile-first composition"
      : videoFormat === "horizontal"
        ? "horizontal 16:9 widescreen composition"
        : "square 1:1 social media composition";

  const parts: string[] = [
    `Camera: ${camera}`,
    `Lighting: ${lighting}`,
    `Color grade: ${colorGrade}`,
    `Visual style: ${style}`,
    `Mood: ${moodTone}`,
  ];

  const scenePool = targetSceneNumber != null ? scenes.filter((s) => s.scene_number === targetSceneNumber) : scenes;

  if (scenePool.length > 0) {
    const scene = scenePool[Math.floor(Math.random() * scenePool.length)];
    if (scene.mood) parts.push(`Scene mood: ${scene.mood}`);
    if (scene.location) parts.push(`Location: ${scene.location.replace(/@/g, "")}`);
    if (scene.description) parts.push(`Scene content: ${scene.description.replace(/@/g, "")}`);

    if (scene.tagged_assets?.length) {
      const descs = scene.tagged_assets
        .map((tag) => {
          const a = assets.find(
            (asset) =>
              asset.tag_name === tag || asset.tag_name === `@${tag}` || normalize(asset.tag_name) === normalize(tag),
          );
          if (!a) return null;
          if (a.asset_type === "character" || !a.asset_type)
            return `${normalize(a.tag_name)}: ${a.ai_description ?? a.tag_name}${
              a.outfit_description ? `, wearing ${a.outfit_description}` : ""
            }`;
          if (a.asset_type === "background") return `Setting: ${a.space_description ?? a.ai_description ?? ""}`;
          return `${normalize(a.tag_name)}: ${a.ai_description ?? ""}`;
        })
        .filter(Boolean);
      if (descs.length) parts.push(descs.join(". "));
    }
  } else {
    if (briefAnalysis) {
      const tone = fieldToString(briefAnalysis.tone_manner);
      const goal = fieldToString(briefAnalysis.goal);
      const usp = fieldToString(briefAnalysis.usp);
      const idea = briefAnalysis.idea_note;
      if (goal) parts.push(`Campaign goal: ${goal}`);
      if (tone) parts.push(`Brand tone: ${tone}`);
      if (usp && Math.random() > 0.5) parts.push(`Key message: ${usp}`);
      if (idea && Math.random() > 0.5) parts.push(`Creative direction: ${idea}`);
    }

    const characters = assets.filter((a) => !a.asset_type || a.asset_type === "character");
    if (characters.length > 0) {
      const char = pick(characters);
      parts.push(
        `Subject: ${char.ai_description ?? char.tag_name}${
          char.outfit_description ? `, wearing ${char.outfit_description}` : ""
        }`,
      );
    }

    const backgrounds = assets.filter((a) => a.asset_type === "background");
    if (backgrounds.length > 0 && Math.random() > 0.4) {
      const bg = pick(backgrounds);
      parts.push(`Environment: ${bg.space_description ?? bg.ai_description ?? ""}`);
    }
  }

  parts.push(formatNote);
  parts.push(
    "Cinematic storyboard reference frame, film still quality, professional photography. " +
      "This is a mood reference image — prioritize atmosphere, composition, and color direction.",
  );

  return parts.filter(Boolean).join(". ");
}

/* ━━━━━ Stage 1: Claude 시네마틱 연출 ━━━━━ */

interface CineShotDescription {
  full_prompt: string;
  composition: string;
  camera: string;
  lens: string;
  lighting: string;
  mood: string;
}

const FORMAT_COMPOSITION_HINTS: Record<string, string> = {
  vertical:
    "FORMAT RULE — 9:16 VERTICAL: Favor portrait-oriented compositions. " +
    "Use center-weighted verticals, tall negative space above or below subject, " +
    "stacked depth layers (feet → face → sky), and strong top-to-bottom leading lines. " +
    "Avoid wide horizontal compositions — fill the vertical frame deliberately.",
  horizontal:
    "FORMAT RULE — 16:9 HORIZONTAL: Favor wide establishing shots and panoramic depth layers. " +
    "Use rule-of-thirds horizontal placement, side-to-side leading lines, " +
    "and environmental storytelling across the full width. " +
    "Avoid center-locked portrait framing — use the horizontal canvas.",
  square:
    "FORMAT RULE — 1:1 SQUARE: Favor centered symmetry, overhead flat lays, or tight close-ups. " +
    "The equal frame rewards bold graphic compositions — strong shapes, center subjects, " +
    "or deliberate corner anchoring. Avoid wide landscape or tall portrait framings.",
};

function buildClaudeContext(opts: MoodGenerateOptions): string {
  const { briefAnalysis, scenes, assets, targetSceneNumber, videoFormat } = opts;
  const lines: string[] = [];

  const formatLabel =
    videoFormat === "vertical"
      ? "9:16 vertical (mobile)"
      : videoFormat === "horizontal"
        ? "16:9 horizontal (widescreen)"
        : "1:1 square";
  lines.push(`VIDEO FORMAT: ${formatLabel}`);

  if (briefAnalysis) {
    if (briefAnalysis.reference_mood) {
      lines.push(`\nREFERENCE MOOD (use as primary visual atmosphere guide):\n${briefAnalysis.reference_mood}`);
    }

    const vd = briefAnalysis.visual_direction;
    if (vd && typeof vd === "object") {
      const vdLines: string[] = [];
      if (vd.camera) vdLines.push(`  Camera style: ${vd.camera}`);
      if (vd.lighting) vdLines.push(`  Lighting style: ${vd.lighting}`);
      if (vd.color_grade) vdLines.push(`  Color grade: ${vd.color_grade}`);
      if (vd.editing) vdLines.push(`  Editing rhythm: ${vd.editing}`);
      if (vdLines.length) lines.push(`\nVISUAL DIRECTION (align shots to this direction):\n${vdLines.join("\n")}`);
    } else if (typeof vd === "string" && vd) {
      lines.push(`\nVISUAL DIRECTION: ${vd}`);
    }

    const sf = briefAnalysis.scene_flow;
    if (sf && typeof sf === "object" && targetSceneNumber == null) {
      const sfLines: string[] = [];
      if (sf.hook?.description) sfLines.push(`  HOOK: ${sf.hook.description}`);
      if (sf.body?.description) sfLines.push(`  BODY: ${sf.body.description}`);
      if (sf.cta?.description) sfLines.push(`  CTA: ${sf.cta.description}`);
      if (sfLines.length) lines.push(`\nSTORY FLOW STRUCTURE:\n${sfLines.join("\n")}`);
    }
  }

  const scenePool = targetSceneNumber != null ? scenes.filter((s) => s.scene_number === targetSceneNumber) : scenes;

  if (scenePool.length > 0) {
    if (targetSceneNumber != null) {
      const scene = scenePool[0];
      const cleanDesc = (text: string) => text.replace(/@([\w가-힣]+)/g, "$1");

      lines.push(
        `\n⚠️ SINGLE SCENE MODE — You are generating ${opts.count ?? 1} shot variations for ONE specific scene.`,
      );
      lines.push(`SCENE FIDELITY IS THE ABSOLUTE FIRST PRIORITY.`);
      lines.push(
        `Every shot MUST faithfully execute the scene description below. Do NOT reinterpret, substitute, or upgrade any element.`,
      );
      lines.push(`Cinematic style choices must SERVE the scene content, not override it.`);
      lines.push(`\nSCENE DIRECTIVE:`);
      const sl: string[] = [];
      if (scene.title) sl.push(`Title: ${scene.title}`);
      if (scene.description) sl.push(`Description (EXECUTE LITERALLY): ${cleanDesc(scene.description)}`);
      if (scene.mood) sl.push(`Mood: ${scene.mood}`);
      if (scene.location) sl.push(`Location: ${cleanDesc(scene.location)}`);
      if (scene.camera_angle) sl.push(`Camera: ${scene.camera_angle}`);
      lines.push(`  ` + sl.join(" | "));

      if (scene.tagged_assets && scene.tagged_assets.length > 0) {
        const taggedAssetDetails = scene.tagged_assets
          .map((tag) => {
            const a = assets.find(
              (asset) =>
                asset.tag_name === tag || asset.tag_name === `@${tag}` || normalize(asset.tag_name) === normalize(tag),
            );
            if (!a) return null;
            const name = normalize(a.tag_name);
            const type = a.asset_type ?? "character";
            const desc =
              type === "background"
                ? (a.space_description ?? a.ai_description ?? "")
                : `${a.ai_description ?? name}${a.outfit_description ? `, wearing ${a.outfit_description}` : ""}`;
            return `  - [${type}] ${name}: ${desc}`;
          })
          .filter(Boolean);

        if (taggedAssetDetails.length > 0) {
          lines.push(`\nREQUIRED ELEMENTS — ALL must appear simultaneously in EVERY shot:`);
          lines.push(...(taggedAssetDetails as string[]));
          if (taggedAssetDetails.length >= 2) {
            lines.push(
              `→ These ${taggedAssetDetails.length} elements MUST co-exist in the same frame. None may be omitted.`,
            );
            lines.push(`→ Compose the spatial relationship between them based on the scene description above.`);
          } else {
            lines.push(`→ This element MUST be visibly present and clearly recognizable in every shot.`);
          }
        }
      }
    } else {
      lines.push(`\nSTORY OVERVIEW: ${scenePool.length} scenes total`);
      const first = scenePool[0];
      const mid = scenePool[Math.floor(scenePool.length / 2)];
      const last = scenePool.at(-1);
      if (first?.description) lines.push(`  OPENING: ${first.description.replace(/@/g, "").slice(0, 100)}`);
      if (mid?.description && mid !== first) lines.push(`  MIDDLE: ${mid.description.replace(/@/g, "").slice(0, 100)}`);
      if (last?.description && last !== first)
        lines.push(`  CLOSING: ${last.description.replace(/@/g, "").slice(0, 100)}`);
      const allMoods = [...new Set(scenePool.map((s) => s.mood).filter(Boolean))];
      if (allMoods.length) lines.push(`  SCENE MOODS: ${allMoods.join(", ")}`);
      const allLocations = [
        ...new Set(
          scenePool
            .map((s) => s.location)
            .filter(Boolean)
            .map((l) => l!.replace(/@/g, "")),
        ),
      ];
      if (allLocations.length) lines.push(`  LOCATIONS: ${allLocations.join(", ")}`);
    }
  }

  if (assets.length > 0) {
    lines.push("\nASSETS:");
    for (const a of assets) {
      const name = normalize(a.tag_name);
      const type = a.asset_type ?? "character";
      const desc =
        type === "background"
          ? (a.space_description ?? a.ai_description ?? "")
          : `${a.ai_description ?? name}${a.outfit_description ? `, wearing ${a.outfit_description}` : ""}`;
      lines.push(`  [${type}] ${name}: ${desc}`);
    }
  }

  return lines.join("\n");
}

/* ━━━━━ 시스템 프롬프트 빌더 ━━━━━ */

const SYSTEM_PROMPT_BASE_CREATIVE = `You are an elite cinematic director and director of photography. You create vivid, highly specific shot descriptions for mood reference image generation.

For each shot you MUST specify ALL 6 elements:
1. CAMERA: shot type + angle + movement (e.g., "low-angle tracking shot, steadicam, slightly pushing in")
2. LENS: focal length + depth of field (e.g., "85mm f/1.4 shallow DOF, background melted into creamy bokeh")
3. COMPOSITION: composition technique from the approved list
4. DEPTH_LAYERS: foreground / midground / background description (e.g., "FG: out-of-focus leaves, MG: subject standing, BG: city skyline at dusk")
5. LIGHTING: direction + quality + color temperature (e.g., "side-lit golden hour, warm amber key, cool fill from open sky")
6. MOOD: cinematic reference or emotional tone (e.g., "Blade Runner 2049 isolation", "Wes Anderson symmetry")

COMPOSITION TECHNIQUES (use from this pool, no repeats across shots):
rule of thirds, center symmetry, frame within frame, leading lines, negative space, foreground bokeh, dutch angle, overhead flat lay, reflection, split composition, silhouette, depth layering, worm's eye, OTS rack focus, anamorphic flare

DIVERSITY RULES (CRITICAL):
- No two shots may use the same composition technique
- At least 1 extreme close-up (eyes, hands, texture detail)
- At least 1 wide/establishing shot
- At least 1 unconventional angle (dutch tilt, worm's eye, reflection, overhead)
- At least 1 foreground occlusion shot (shooting through/between objects)
- Lens variety: at least 1 wide-angle (24mm or below), 1 standard (35-50mm), 1 telephoto (85mm+)

BRIEF ALIGNMENT (IMPORTANT):
- REFERENCE MOOD in the context is your primary atmosphere guide — let it define the emotional palette of your shots
- VISUAL DIRECTION camera/lighting/color_grade fields tell you the intended style — honor them, do not contradict
- Distribute shots across the STORY FLOW (hook / body / cta) if provided

OUTPUT FORMAT: Return ONLY a valid JSON array. No markdown, no code fences.
Each element: {"full_prompt": "2-4 sentence vivid visual description in English", "composition": "technique used", "camera": "shot+angle+movement", "lens": "focal+dof", "lighting": "direction+quality+color", "mood": "cinematic reference"}

Write full_prompt as a rich, visual, English-only description that an image generation AI can directly use. Include subject, environment, lighting, color palette, texture, and atmosphere. Do NOT include technical metadata in full_prompt — keep it purely descriptive and evocative.`;

const SYSTEM_PROMPT_BASE_ASSET = `You are an elite cinematic director and director of photography. You create vivid, highly specific shot descriptions for mood reference image generation.

IMPORTANT: Reference images of actual characters and backgrounds will be provided to the image generator.
Your full_prompt MUST include specific placement instructions for these characters:
- Where in the frame each character appears (left third, center, background, etc.)
- Their pose, action, and interaction with environment
- How they relate to the camera angle you've chosen
Do NOT describe character appearance (the reference images handle that).
Instead focus on: position in frame, body language, scale relative to environment, and interaction with lighting.

For each shot you MUST specify ALL 6 elements:
1. CAMERA: shot type + angle + movement (e.g., "low-angle tracking shot, steadicam, slightly pushing in")
2. LENS: focal length + depth of field (e.g., "85mm f/1.4 shallow DOF, background melted into creamy bokeh")
3. COMPOSITION: composition technique from the approved list
4. DEPTH_LAYERS: foreground / midground / background description (e.g., "FG: out-of-focus leaves, MG: subject standing, BG: city skyline at dusk")
5. LIGHTING: direction + quality + color temperature (e.g., "side-lit golden hour, warm amber key, cool fill from open sky")
6. MOOD: cinematic reference or emotional tone (e.g., "Blade Runner 2049 isolation", "Wes Anderson symmetry")

COMPOSITION TECHNIQUES (use from this pool, no repeats across shots):
rule of thirds, center symmetry, frame within frame, leading lines, negative space, foreground bokeh, dutch angle, overhead flat lay, reflection, split composition, silhouette, depth layering, worm's eye, OTS rack focus, anamorphic flare

DIVERSITY RULES (CRITICAL):
- No two shots may use the same composition technique
- At least 1 extreme close-up (eyes, hands, texture detail)
- At least 1 wide/establishing shot
- At least 1 unconventional angle (dutch tilt, worm's eye, reflection, overhead)
- At least 1 foreground occlusion shot (shooting through/between objects)
- Lens variety: at least 1 wide-angle (24mm or below), 1 standard (35-50mm), 1 telephoto (85mm+)

BRIEF ALIGNMENT (IMPORTANT):
- REFERENCE MOOD in the context is your primary atmosphere guide — let it define the emotional palette of your shots
- VISUAL DIRECTION camera/lighting/color_grade fields tell you the intended style — honor them, do not contradict
- Distribute shots across the STORY FLOW (hook / body / cta) if provided

OUTPUT FORMAT: Return ONLY a valid JSON array. No markdown, no code fences.
Each element: {"full_prompt": "2-4 sentence vivid visual description in English focusing on FRAMING and PLACEMENT, not character appearance", "composition": "technique used", "camera": "shot+angle+movement", "lens": "focal+dof", "lighting": "direction+quality+color", "mood": "cinematic reference"}

Write full_prompt as a rich, visual, English-only description that an image generation AI can directly use. Focus on framing, positioning, body language, environment, lighting, color palette, texture, and atmosphere. Do NOT describe what characters look like — only WHERE they are and WHAT they do.`;

const SINGLE_SCENE_PRIORITY = `CRITICAL OVERRIDE — SINGLE SCENE MODE:
SCENE FIDELITY IS THE ABSOLUTE FIRST PRIORITY.
Your job is to faithfully execute the given scene description across multiple shot variations.
All REQUIRED ELEMENTS listed in the context MUST appear in every single shot — no exceptions.
If 2+ elements are listed, they MUST co-exist in the same frame simultaneously.
Cinematic style (angle, lens, lighting) must SERVE the scene content. Never override it.
Do NOT omit any required element. Do NOT substitute with similar alternatives.

`;

function buildSystemPrompt(isAssetMode: boolean, videoFormat: string, isSingleSceneMode = false): string {
  const base = isAssetMode ? SYSTEM_PROMPT_BASE_ASSET : SYSTEM_PROMPT_BASE_CREATIVE;
  const formatHint = FORMAT_COMPOSITION_HINTS[videoFormat] ?? FORMAT_COMPOSITION_HINTS.horizontal;
  const prefix = isSingleSceneMode ? SINGLE_SCENE_PRIORITY : "";
  return `${prefix}${base}\n\n${KNOWLEDGE_MOOD_CINEMATICS}\n\n${formatHint}`;
}

async function generateCineShotDescriptions(
  opts: MoodGenerateOptions,
  count: number,
): Promise<CineShotDescription[] | null> {
  try {
    const context = buildClaudeContext(opts);
    const isAssetMode = opts.model === "asset";
    const isSingleSceneMode = opts.targetSceneNumber != null;
    const systemPrompt = buildSystemPrompt(isAssetMode, opts.videoFormat, isSingleSceneMode);

    const userMessage = isSingleSceneMode
      ? `Based on the following scene directive, generate exactly ${count} cinematic shot variations as a JSON array.

${context}

CRITICAL: Every shot MUST include ALL REQUIRED ELEMENTS simultaneously in the same frame.
Apply diverse camera angles and compositions, but NEVER omit or substitute any required element.
The scene description is a LITERAL directive — execute it faithfully across all ${count} shots.
Output ONLY the JSON array.`
      : `Based on the following project context, generate exactly ${count} cinematic shot descriptions as a JSON array.

${context}

Remember: ALL ${count} shots must have unique composition techniques. Ensure lens and angle diversity as specified. Align the atmosphere and color palette with the REFERENCE MOOD and VISUAL DIRECTION provided. Output ONLY the JSON array.`;

    const { data, error } = await supabase.functions.invoke("claude-proxy", {
      body: {
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: userMessage }],
        system: systemPrompt,
      },
    });

    if (error || !data) {
      console.warn("Claude proxy call failed:", error?.message);
      return null;
    }

    const textBlock = data.content?.find((b: any) => b.type === "text");
    const rawText = textBlock?.text ?? "";
    if (!rawText) {
      console.warn("Claude returned empty text");
      return null;
    }

    const jsonStr = rawText
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    const parsed = JSON.parse(jsonStr);

    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.warn("Claude returned non-array or empty array");
      return null;
    }

    const valid = parsed.filter(
      (item: any) => typeof item === "object" && typeof item.full_prompt === "string" && item.full_prompt.length > 10,
    );

    return valid.length > 0 ? (valid as CineShotDescription[]) : null;
  } catch (err) {
    console.warn("Claude cinematic pipeline failed:", err);
    return null;
  }
}

/* ━━━━━ Asset mode helper ━━━━━ */
function buildMoodAssetImageUrls(assets: MoodGenerateOptions["assets"]): string[] {
  const urls: string[] = [];
  const MAX_REFS = 14;

  const characters = assets.filter((a) => a.asset_type === "character" && a.photo_url);
  const backgrounds = assets.filter((a) => a.asset_type === "background" && a.photo_url);
  const items = assets.filter((a) => a.asset_type === "item" && a.photo_url);

  for (const c of characters) {
    if (urls.length < MAX_REFS) urls.push(c.photo_url!);
  }
  for (const b of backgrounds) {
    if (urls.length < MAX_REFS) urls.push(b.photo_url!);
  }
  for (const i of items) {
    if (urls.length < MAX_REFS) urls.push(i.photo_url!);
  }

  return urls;
}

/* ━━━━━ 메인 함수 ━━━━━ */
export const generateMoodImages = async (
  opts: MoodGenerateOptions,
  onBatchDone?: (urls: string[]) => void,
): Promise<string[]> => {
  const count = opts.count ?? 9;
  const imageSize = SIZE_MAP[opts.videoFormat] ?? SIZE_MAP.horizontal;
  const isAssetMode = opts.model === "asset";

  const cineShots = await generateCineShotDescriptions(opts, count);
  const useCinePipeline = cineShots !== null && cineShots.length > 0;

  const assetImageUrls = isAssetMode ? buildMoodAssetImageUrls(opts.assets) : undefined;

  // ★ 단일 이미지 호출 헬퍼
  const generateOne = async (idx: number): Promise<string> => {
    let prompt: string;
    if (useCinePipeline && idx < cineShots!.length) {
      // ✅ Fix 1: sanitizeImagePrompt 제거
      // Claude가 공들여 만든 시네마틱 표현을 그대로 GPT에 전달
      prompt = cineShots![idx].full_prompt;
    } else {
      prompt = buildLegacyMoodPrompt(opts);
    }

    const body: Record<string, any> = {
      prompt,
      projectId: opts.projectId,
      sceneNumber: -1,
      imageSize,
      quality: "high", // ✅ Fix 2: "medium" → "high"
      folder: "mood",
      model: "gpt", // ✅ Fix 3: Creative 모드 GPT 명시
    };

    if (isAssetMode && assetImageUrls && assetImageUrls.length > 0) {
      body.assetImageUrls = assetImageUrls;
      body.model = "nano-banana-2"; // Asset 모드는 NB2로 덮어씀
      console.log("[Mood] Asset mode → NB2 호출", { imageUrls: assetImageUrls, prompt });
    }

    const { data, error } = await supabase.functions.invoke("openai-image", { body });
    if (error || !data?.publicUrl) throw new Error(error?.message ?? "No URL returned");
    console.log(`[Mood] Image ${idx + 1} generated with: ${data.usedModel ?? "unknown"}`);
    return data.publicUrl as string;
  };

  const urls: string[] = [];

  if (isAssetMode) {
    // ★ NB2(Asset 모드): 배치 크기 3 병렬 처리 + 완료 즉시 표시
    const BATCH_SIZE = 3;
    for (let i = 0; i < count; i += BATCH_SIZE) {
      const batchIndices = Array.from({ length: Math.min(BATCH_SIZE, count - i) }, (_, j) => i + j);
      const batchResults = await Promise.allSettled(
        batchIndices.map((idx) =>
          generateOne(idx).then((url) => {
            onBatchDone?.([url]);
            return url;
          }),
        ),
      );
      const batchUrls = batchResults
        .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
        .map((r) => r.value);
      urls.push(...batchUrls);
      batchResults
        .filter((r) => r.status === "rejected")
        .forEach((r) => console.warn(`[Mood] Asset batch image failed:`, (r as PromiseRejectedResult).reason));
      if (i + BATCH_SIZE < count) await new Promise((r) => setTimeout(r, 1000));
    }
  } else {
    // ★ Creative 모드(GPT): 전체 병렬 처리
    const results = await Promise.allSettled(
      Array.from({ length: count }, (_, idx) =>
        generateOne(idx).then((url) => {
          onBatchDone?.([url]);
          return url;
        }),
      ),
    );
    for (const r of results) {
      if (r.status === "fulfilled") urls.push(r.value);
      else console.warn("[Mood] Creative image failed:", r.reason);
    }
  }

  if (!urls.length) throw new Error("모든 이미지 생성 실패");

  // NOTE: 여기서 DB 에 직접 append 하지 않는다.
  //       MoodIdeationPanel 쪽의 persistMoodGenResultToDB 가
  //       skeletonIds 와 arrivedUrls 를 기반으로 최종 merge 를 책임진다.
  //       과거에 이 곳에서 [...existing, ...urls] 로 문자열을 append 했더니
  //       persist 단계에서 skel ID 기반 객체가 또 prepend 되어 같은 URL 이
  //       맨 위·맨 아래 모두에 중복 저장되던 버그가 있었음.

  return urls;
};
