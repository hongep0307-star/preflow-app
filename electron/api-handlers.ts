import { ipcMain } from "electron";
import { getSettings } from "./settings";
import { registerSettingsHandlers } from "./settings";
import { getStorageBasePath } from "./storage";
import { LOCAL_SERVER_PORT } from "./constants";
import fs from "fs";
import path from "path";
import crypto from "crypto";

function storageFileUrl(fullPath: string): string {
  const base = getStorageBasePath();
  const relative = path.relative(base, fullPath).replace(/\\/g, "/");
  return `http://127.0.0.1:${LOCAL_SERVER_PORT}/storage/file/${relative}`;
}

export async function handleClaudeProxy(body: any) {
  const settings = getSettings();
  const apiKey = settings.anthropic_api_key;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY가 설정되지 않았습니다.");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  return await response.json();
}

export async function handleEnhanceInpaintPrompt(body: any) {
  const settings = getSettings();
  ensureGoogleCredentials(settings);
  const { prompt, hasMask, assetDescriptions, sourceImageBase64, tagImageBase64 } = body;
  if (!prompt) return { error: "prompt is required" };

  // Gemini 가 SOURCE (보존용) + TAG (정체성 묘사용) 두 장을 직접 보고
  // 1) PRESERVE: 원본에서 보존해야 할 요소 목록
  // 2) TAG_IDENTITY: 태그 에셋의 구체적 식별 특징
  // 두 블록을 프롬프트에 주입 → 이후 NB2 가 "인물 날리기" / "일반화" 실수 둘 다 줄어듦.
  const hasSourceImage = !!sourceImageBase64 && hasMask;
  const hasTagImage = !!tagImageBase64 && hasMask;

  const systemPrompt = `You are an expert prompt writer for high-precision image inpainting/editing.

Your job:
1. If the input is not in English, translate it to natural English first.
2. Classify the request as one of: REMOVAL, REPLACEMENT, ADDITION, or MODIFICATION.
3. Rewrite it into a SHORT, EXTREMELY SPECIFIC editing prompt optimized for image editing AI.
${hasSourceImage ? `
═══ SCENE PRESERVATION (CRITICAL) ═══
You will be given the SOURCE scene image. Study it first and silently identify every element that must be preserved OUTSIDE the masked region:
 - all people (count, pose, clothing, facial features, gaze direction, position)
 - background environment and layout
 - other objects (furniture, props, vehicles, etc.)
 - lighting direction, color temperature, shadows
 - camera angle, framing, depth of field, color grading

Then include a concise "PRESERVE:" block in the output prompt that explicitly lists these elements so the downstream image model does not drop or alter them. Example:
  PRESERVE: 1 male character on the left wearing a navy suit, facing camera; industrial warehouse interior; cool blue-teal color grading; low-angle shot.
` : ""}${hasTagImage ? `
═══ TAG IDENTITY (CRITICAL) ═══
You will also be given the TAG reference image — the exact object to place inside the masked region. Study it and write a "TAG_IDENTITY:" block that lists every visually distinctive feature the downstream model MUST reproduce so the object is immediately recognizable:
 - object category and specific model/type (e.g., "AR-15 carbine", "Hermès Birkin bag 30cm", "Porsche 911 Carrera")
 - overall shape and proportions
 - dominant colors and color distribution (be specific: "matte black polymer body with tan FDE grip and handguard")
 - materials and surface finish (matte/glossy/brushed/leather/etc.)
 - markings, logos, stickers, text, serial patterns
 - distinguishing attachments or details (e.g., "red-dot sight on top rail", "angled foregrip", "bronze hardware")

The output prompt must instruct the image model to match ALL of these identity features exactly, while adapting only viewing angle, lighting, and scale to blend with SOURCE. Do NOT let the model generate a generic version of the object.

Example TAG_IDENTITY block:
  TAG_IDENTITY: AR-15 carbine with matte black upper/lower receiver, 16" barrel, tan FDE furniture (grip, handguard, stock), black picatinny top rail with red-dot optic, angled foregrip under handguard, black 30-round polymer magazine.
` : ""}
═══ REMOVAL REQUESTS ═══
Detection: words like "remove", "delete", "erase", "없애", "제거", "삭제", "지워"
Rules:
- Primary instruction: "Completely remove [object] from the image."
- Secondary instruction: "Fill the area with the natural continuation of the surrounding background."
- CRITICAL: "Do NOT replace the removed object with any other object."
- CRITICAL: "Do NOT add anything new. The area should look as if the object was never there."

═══ UNIVERSAL RULES ═══
- Keep the prompt FOCUSED (up to ~14 sentences including PRESERVE and TAG_IDENTITY blocks).
- The FIRST sentence must be the primary action on the masked region.
- Never introduce creative additions the user didn't ask for.
- Always end with: Preserve all unmasked content exactly as-is — same people, same background, same lighting, same composition. Match the tag identity exactly inside the masked region.
${assetDescriptions ? `\nAdditional asset notes (supplementary — the TAG reference image is authoritative):\n${assetDescriptions}` : ""}${hasMask ? "\n[User painted a brush mask on the target area.]" : "\n[No brush mask. Full-image edit.]"}

Return ONLY the final prompt. No explanations. No markdown.`;

  try {
    // Multimodal parts: [SOURCE label + image] + [TAG label + image] + [user request text]
    const userParts: any[] = [];
    if (hasSourceImage) {
      userParts.push({ text: "[SOURCE scene image — everything OUTSIDE the mask must be preserved]" });
      userParts.push({ inlineData: { mimeType: "image/png", data: sourceImageBase64 } });
    }
    if (hasTagImage) {
      userParts.push({ text: "[TAG reference image — the object to place INSIDE the masked region; reproduce its identity exactly]" });
      userParts.push({ inlineData: { mimeType: "image/png", data: tagImageBase64 } });
    }
    userParts.push({ text: `User edit request: ${prompt}` });

    const data = await callVertexGemini(settings, "gemini-2.0-flash", {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: userParts }],
    });
    const enhanced = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || prompt;
    console.log(
      "[enhance-inpaint] hasSourceImage:",
      hasSourceImage,
      "| hasTagImage:",
      hasTagImage,
      "| enhanced length:",
      enhanced.length,
    );
    return { enhanced };
  } catch (e) {
    console.error("Vertex Gemini enhance error:", e);
    return { enhanced: prompt, fallback: true };
  }
}

// v2 fields: enum/literal/numeric/boolean values that must NOT be translated
// (translate-analysis 는 자연어만 번역하고 이 필드들은 원본 그대로 보존해야 함)
const TRANSLATE_KEEP_AS_IS_KEYS = [
  "content_type",
  "secondary_type",
  "classification_confidence",
  "hook_strategy.primary",
  "hook_strategy.alternatives",
  "hook_strategy.pattern_interrupt",
  "pacing.format",
  "pacing.duration",
  "pacing.edit_rhythm",
  "pacing.scene_count",
  "pacing.silent_viewable",
  "pacing.captions_required",
  "hero_visual.brand_reveal_timing",
  "hero_visual.product_reveal_timing",
  "hero_visual.logo_placement",
  "product_info.urgency.type",
  "abcd_compliance.attract.score",
  "abcd_compliance.brand.score",
  "abcd_compliance.connect.score",
  "abcd_compliance.direct.score",
  "abcd_compliance.total",
  "narrative.story_structure",
  "narrative.emotional_beats[].intensity",
];

export async function handleTranslateAnalysis(body: any) {
  const settings = getSettings();
  ensureGoogleCredentials(settings);
  const { mode, analysis, fieldValue, fieldPath, direction } = body;
  if (mode === "full") {
    const directionText = direction === "ko_to_en" ? "Korean to English" : "English to Korean";
    const systemPrompt = `You are a professional translator for advertising/marketing analysis.
RULES:
- Translate ALL natural-language text values in the JSON
- Preserve the EXACT JSON structure and key names
- Keep proper nouns, brand names, game titles as-is
- DO NOT translate enum/literal values. Keep these fields EXACTLY as-is (values are enums or numbers, not natural language):
${TRANSLATE_KEEP_AS_IS_KEYS.map((k) => `  - ${k}`).join("\n")}
- Any field whose value looks like a timing token ("0-3s", "3-5s", "5-10s"), format token ("9:16", "16:9", "1:1", "4:5"), duration token ("6s", "15s", "30s", "45s", "60s"), or an identifier with underscores (e.g. "product_launch", "unboxing_reveal", "time_limited", "first_frame") must also be kept as-is.
- Numbers and booleans are never translated.
- Return ONLY valid JSON, no markdown fences.`;
    const data = await callVertexGemini(settings, "gemini-2.5-flash", {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: `Translate this analysis JSON from ${directionText}. Return ONLY valid JSON:\n\n${JSON.stringify(analysis)}` }] }],
      generationConfig: { maxOutputTokens: 6000, temperature: 0.1 },
    });
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) throw new Error("Empty AI response");
    let jsonStr = content.trim().replace(/```json\s?|```/g, "").trim();
    return { translated: JSON.parse(jsonStr) };
  }
  if (mode === "field") {
    // field-level translation: skip if fieldPath is in the enum keep-as-is list
    if (fieldPath && TRANSLATE_KEEP_AS_IS_KEYS.some((k) => fieldPath === k || fieldPath.startsWith(`${k}.`))) {
      return { translated: fieldValue };
    }
    const directionText = direction === "ko_to_en" ? "Korean to natural English" : "English to natural Korean";
    const data = await callVertexGemini(settings, "gemini-2.0-flash", {
      contents: [{ parts: [{ text: `Translate from ${directionText}. ${fieldPath ? `This is the "${fieldPath}" field of a marketing analysis. ` : ""}Keep proper nouns as-is. Return ONLY the translated text:\n\n${fieldValue}` }] }],
      generationConfig: { maxOutputTokens: 500, temperature: 0.1 },
    });
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!content) throw new Error("Empty AI response");
    try { return { translated: JSON.parse(content) }; } catch { return { translated: content }; }
  }
  return { error: "Invalid mode" };
}

export async function handleAnalyzeReferenceImages(body: any) {
  const settings = getSettings();
  ensureGoogleCredentials(settings);
  const { images, imageUrls, mode } = body;
  const isStyleOnly = mode === "style_only";
  const prompt = isStyleOnly
    ? "Describe the visual style of this image. Return ONLY a single short English paragraph (max 2 sentences) describing: rendering technique, line style, color palette, lighting mood, texture. Do NOT mention subjects or content."
    : "이 이미지의 색감, 카메라 앵글, 편집 스타일, 전체적인 무드를 영상 제작 관점에서 간결하게 설명해줘. 한국어로 답변해줘.";
  const parts: any[] = [];
  if (imageUrls && Array.isArray(imageUrls) && imageUrls.length > 0) {
    for (const url of imageUrls) {
      try { const resp = await fetch(url); if (!resp.ok) continue; const buf = Buffer.from(await resp.arrayBuffer()); const ct = resp.headers.get("content-type") || "image/png"; const mimeType = ct.startsWith("image/") ? ct.split(";")[0] : "image/png"; parts.push({ inlineData: { mimeType, data: buf.toString("base64") } }); } catch {}
    }
  } else if (images && Array.isArray(images)) {
    for (const img of images) parts.push({ inlineData: { mimeType: img.mediaType, data: img.base64 } });
  }
  if (parts.length === 0) return { error: "이미지가 없습니다." };
  parts.push({ text: prompt });
  const data = await callVertexGemini(settings, "gemini-2.5-flash", {
    contents: [{ parts }],
    generationConfig: { maxOutputTokens: isStyleOnly ? 256 : 512, temperature: 0.3 },
  });
  return { analysis: data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "" };
}

export async function handleOpenaiImage(body: any) {
  const settings = getSettings();
  if (body.mode === "ping") return { ok: true };
  const openaiKey = settings.openai_api_key;
  const storagePath = getStorageBasePath();

  if (body.mode === "style_transfer") {
    const { sourceImageUrl, styleImageUrl, prompt, gptPrompt, imageSize, projectId, sceneNumber } = body;
    if (!sourceImageUrl || !prompt || !projectId || sceneNumber === undefined) return { error: "Missing required fields" };
    try {
      const imageUrls = [sourceImageUrl, ...(styleImageUrl ? [styleImageUrl] : [])];
      const aspect = sizeToNB2Aspect(imageSize ?? "1024x1536");
      const imgBuf = await callVertexNB2(settings, prompt, imageUrls, aspect);
      const filePath = saveToStorage(storagePath, "contis", projectId, `scene_${sceneNumber}_style-nb2_${Date.now()}.png`, imgBuf);
      return { publicUrl: storageFileUrl(filePath), usedModel: "nano-banana-2" };
    } catch (e) { console.error("[StyleTransfer] NB2 failed:", (e as Error).message); }
    try {
      if (!openaiKey) throw new Error("OPENAI_API_KEY not set");
      const srcBuf = await downloadImage(sourceImageUrl);
      const imgBytes = await callGptInpaint(openaiKey, srcBuf.toString("base64"), null, gptPrompt ?? prompt, imageSize ?? "1024x1536", styleImageUrl ? [styleImageUrl] : []);
      const filePath = saveToStorage(storagePath, "contis", projectId, `scene_${sceneNumber}_style-gpt_${Date.now()}.png`, imgBytes);
      return { publicUrl: storageFileUrl(filePath), usedModel: "style-gpt-fallback" };
    } catch (e) { return { error: "NB2 및 GPT 폴백 모두 실패", detail: String(e) }; }
  }

  const { mode, prompt, imageBase64, maskBase64, sourceImageUrl, referenceImageUrls = [], projectId, sceneNumber, imageSize, size: sizeAlias, assetImageUrls = [], forceGpt = false, model, useNanoBanana = false, folder } = body;
  if (!prompt || !projectId || sceneNumber === undefined) return { error: "Missing required fields: prompt, projectId, sceneNumber" };
  const size = imageSize ?? sizeAlias ?? "1024x1536";
  const bucket = folder === "mood" ? "mood" : "contis";
  let imageBytes: Buffer | undefined;
  let suffix: string = "";
  console.log("[openai-image] Request:", {
    mode,
    model,
    size,
    bucket,
    sceneNumber,
    promptLen: prompt?.length,
    useNanoBanana,
    hasSourceImageUrl: !!sourceImageUrl,
    hasImageBase64: !!imageBase64,
    hasMaskBase64: !!maskBase64,
    refCount: referenceImageUrls.length,
  });
  if (referenceImageUrls.length > 0) {
    console.log(
      "[openai-image] referenceImageUrls:",
      referenceImageUrls.map((u: string) => (u?.length > 120 ? u.slice(0, 117) + "..." : u)),
    );
  }

  // ── Inpaint 라우팅 ──
  //   · NB2 primary (마스크 유무 무관). 브러시 영역은 클라이언트에서 만든 "마스크 오버레이" 레퍼런스로 NB2 에 지시.
  //   · NB2 실패 or sourceImageUrl 없음 → GPT edits 폴백 (이때만 maskBase64 를 실제 인페인팅 마스크로 사용).
  if (mode === "inpaint") {
    const hasMask = !!maskBase64;
    console.log("[inpaint] routing:", { hasMask, useNanoBanana, forceGpt, refCount: referenceImageUrls.length });

    if (useNanoBanana && sourceImageUrl) {
      // NB2 primary — 원본 + (브러시 있으면) 마스크 오버레이 + 태그 에셋 refs
      try {
        const nbUrls = [sourceImageUrl, ...referenceImageUrls].filter(Boolean);
        console.log(
          "[inpaint] NB2 image layout:",
          nbUrls.map((u, i) => {
            const role =
              i === 0
                ? "[1]SOURCE"
                : hasMask && i === 1
                  ? "[2]MASK_HINT"
                  : `[${i + 1}]${hasMask ? "TAG_ASSET" : "REF"}`;
            return `${role} ${u.length > 80 ? u.slice(0, 77) + "..." : u}`;
          }),
        );
        imageBytes = await callVertexNB2(settings, prompt, nbUrls, sizeToNB2Aspect(size));
        suffix = hasMask ? "inpaint-nb2-masked" : "inpaint-nb2";
      } catch (e) {
        console.error("[inpaint] NB2 failed, falling back to GPT edits:", (e as Error).message);
      }
    }

    if (!imageBytes) {
      // GPT edits 폴백. 브러시 있을 때는 native mask 로 인페인팅, 없을 때는 forceGpt 필요
      if (!imageBase64 || (!maskBase64 && !forceGpt)) {
        return { error: "GPT edits 폴백에 imageBase64 가 필요합니다 (마스크 없을 때는 forceGpt=true 필요)", usedModel: "inpaint-failed" };
      }
      if (!openaiKey) throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");
      imageBytes = await callGptInpaint(openaiKey, imageBase64, maskBase64 ?? null, prompt, size, referenceImageUrls);
      suffix = hasMask ? "inpaint-gpt-masked-fallback" : "inpaint-gpt-fallback";
    }
  } else if (model === "gpt") {
    if (!openaiKey) throw new Error("OPENAI_API_KEY가 설정되지 않았습니다. Settings에서 OpenAI API Key를 입력하세요.");
    if (openaiKey.startsWith("sk-ant-")) throw new Error("OpenAI 필드에 Anthropic 키가 입력되어 있습니다. Settings에서 올바른 OpenAI API Key(sk-proj-...)를 입력하세요.");
    imageBytes = await callGptGenerations(openaiKey, prompt, size);
    suffix = "gen-gpt";
  } else if (model === "nano-banana-2") {
    try { imageBytes = await callVertexNB2(settings, prompt, assetImageUrls?.length > 0 ? assetImageUrls : undefined, sizeToNB2Aspect(size)); suffix = "nano-banana-2"; }
    catch (e) { console.error("[nano-banana-2] failed:", (e as Error).message); if (!openaiKey) throw new Error("NB2 실패, GPT 폴백에 OPENAI_API_KEY 필요"); imageBytes = await callGptGenerations(openaiKey, prompt, size); suffix = "nb2-gpt-fallback"; }
  } else {
    try { imageBytes = await callVertexNB2(settings, prompt, assetImageUrls?.length > 0 ? assetImageUrls : undefined, sizeToNB2Aspect(size)); suffix = "nano-banana-2"; }
    catch { if (!openaiKey) throw new Error("OPENAI_API_KEY가 설정되지 않았습니다."); imageBytes = await callGptGenerations(openaiKey, prompt, size); suffix = "gen-gpt"; }
  }

  const filePath = saveToStorage(storagePath, bucket, projectId, `scene-${sceneNumber}-${suffix}-${Date.now()}.png`, imageBytes!);
  console.log("[openai-image] Saved:", filePath, "model:", suffix);
  return { publicUrl: storageFileUrl(filePath), usedModel: suffix };
}

// Register all IPC handlers (kept for production builds)
export function registerApiHandlers() {
  registerSettingsHandlers();
  ipcMain.handle("api:claude-proxy", (_e, body) => handleClaudeProxy(body));
  ipcMain.handle("api:enhance-inpaint-prompt", (_e, body) => handleEnhanceInpaintPrompt(body));
  ipcMain.handle("api:translate-analysis", (_e, body) => handleTranslateAnalysis(body));
  ipcMain.handle("api:analyze-reference-images", (_e, body) => handleAnalyzeReferenceImages(body));
  ipcMain.handle("api:openai-image", (_e, body) => handleOpenaiImage(body));
}

// ── Vertex AI: Text Gemini (shared credentials with NB2) ──
function ensureGoogleCredentials(settings: any) {
  if (!settings.google_service_account_key || !settings.google_cloud_project_id) {
    throw new Error("Google Cloud 설정이 필요합니다. 설정 페이지에서 Service Account Key와 Project ID를 입력해주세요.");
  }
}

async function callVertexGemini(settings: any, model: string, requestBody: any): Promise<any> {
  const saKeyJson = settings.google_service_account_key;
  const gcpProjectId = settings.google_cloud_project_id;
  const accessToken = await getVertexAccessToken(saKeyJson);
  const endpoint = `https://aiplatform.googleapis.com/v1/projects/${gcpProjectId}/locations/global/publishers/google/models/${model}:generateContent`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`[Vertex Gemini ${model}] HTTP ${res.status}:`, errText);
    throw new Error(`Vertex AI (${model}) HTTP ${res.status}`);
  }
  return await res.json();
}

// ── Vertex AI NB2 ──
async function callVertexNB2(settings: any, prompt: string, imageUrls?: string[], aspectRatio?: string): Promise<Buffer> {
  const saKeyJson = settings.google_service_account_key;
  const gcpProjectId = settings.google_cloud_project_id;
  if (!saKeyJson || !gcpProjectId) throw new Error("Google Cloud credentials not configured");
  const accessToken = await getVertexAccessToken(saKeyJson);
  const model = "gemini-3.1-flash-image-preview";
  const endpoint = `https://aiplatform.googleapis.com/v1/projects/${gcpProjectId}/locations/global/publishers/google/models/${model}:generateContent`;
  const parts: any[] = [{ text: prompt }];
  if (imageUrls && imageUrls.length > 0) {
    for (const url of imageUrls.slice(0, 14)) {
      try { const buf = await downloadImage(url); parts.push({ inlineData: { mimeType: "image/png", data: buf.toString("base64") } }); } catch {}
    }
  }
  const res = await fetch(endpoint, {
    method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE", "TEXT"], imageConfig: { aspectRatio: aspectRatio ?? "9:16", imageSize: "1K" } } }),
  });
  if (!res.ok) throw new Error(`Vertex AI HTTP ${res.status}: ${await res.text()}`);
  const result = await res.json();
  if (!result.candidates?.length) throw new Error("Vertex AI: no candidates");
  for (const part of result.candidates[0].content?.parts || []) {
    if (part.inlineData?.data) return Buffer.from(part.inlineData.data, "base64");
  }
  throw new Error("Vertex AI: no image in response");
}

async function getVertexAccessToken(saKeyJson: string): Promise<string> {
  const sa = JSON.parse(saKeyJson);
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const sign = crypto.createSign("RSA-SHA256"); sign.update(signingInput);
  const signature = sign.sign(sa.private_key, "base64url");
  const jwt = `${signingInput}.${signature}`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}` });
  if (!tokenRes.ok) throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
  return (await tokenRes.json()).access_token;
}

async function callGptGenerations(apiKey: string, prompt: string, size: string): Promise<Buffer> {
  console.log("[callGptGenerations] Starting:", { size, promptLen: prompt.length });
  const body = { model: "gpt-image-1.5", prompt, n: 1, size, quality: "high", output_format: "png" };
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const msg = errBody.error?.message ?? `GPT generation failed (HTTP ${res.status})`;
    console.error("[callGptGenerations] API error:", res.status, msg);
    throw new Error(msg);
  }
  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) {
    console.error("[callGptGenerations] No b64_json in response. Keys:", JSON.stringify(Object.keys(data?.data?.[0] ?? {})));
    throw new Error("No b64_json in GPT response");
  }
  console.log("[callGptGenerations] Success, image bytes:", b64.length);
  return Buffer.from(b64, "base64");
}

async function callGptInpaint(apiKey: string, imageB64: string, maskB64: string | null, prompt: string, size: string, refUrls: string[] = []): Promise<Buffer> {
  const formData = new FormData();
  formData.append("model", "gpt-image-1.5"); formData.append("prompt", prompt); formData.append("n", "1"); formData.append("size", size); formData.append("quality", "high"); formData.append("input_fidelity", "high"); formData.append("output_format", "png");
  formData.append("image[]", new Blob([Buffer.from(imageB64, "base64")], { type: "image/png" }), "image.png");
  for (let i = 0; i < Math.min(refUrls.length, 3); i++) { try { const refBuf = await downloadImage(refUrls[i]); formData.append("image[]", new Blob([refBuf], { type: "image/png" }), `ref-${i}.png`); } catch {} }
  if (maskB64) formData.append("mask", new Blob([Buffer.from(maskB64, "base64")], { type: "image/png" }), "mask.png");
  const res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: formData });
  if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message ?? "GPT inpaint failed"); }
  const data = await res.json();
  return Buffer.from(data.data[0].b64_json, "base64");
}

async function downloadImage(url: string): Promise<Buffer> {
  if (url.startsWith("local-file://")) {
    const stripped = url.replace(/^local-file:\/\//i, "").split(/[?#]/)[0];
    return fs.readFileSync(decodeURIComponent(stripped)) as unknown as Buffer;
  }
  const localPrefix = `http://127.0.0.1:${LOCAL_SERVER_PORT}/storage/file/`;
  if (url.startsWith(localPrefix)) {
    const relative = decodeURIComponent(url.slice(localPrefix.length));
    const fullPath = path.join(getStorageBasePath(), relative);
    return fs.readFileSync(fullPath) as unknown as Buffer;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function sizeToNB2Aspect(size: string): string {
  const map: Record<string, string> = { "1024x1536": "9:16", "1536x1024": "16:9", "1024x1024": "1:1" };
  if (map[size]) return map[size];
  const parts = size.split("x").map(Number);
  if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) { const ratio = parts[0] / parts[1]; if (ratio >= 1.4) return "16:9"; if (ratio <= 0.75) return "9:16"; return "1:1"; }
  return "9:16";
}

function saveToStorage(basePath: string, bucket: string, projectId: string, fileName: string, data: Buffer): string {
  const dir = path.join(basePath, bucket, projectId);
  fs.mkdirSync(dir, { recursive: true });
  const fullPath = path.join(dir, fileName);
  fs.writeFileSync(fullPath, data);
  return fullPath;
}
