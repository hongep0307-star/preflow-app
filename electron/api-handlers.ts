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

export async function handleAnalyzeBrief(body: any) {
  const settings = getSettings();
  ensureGoogleCredentials(settings);
  const { briefText, lang } = body;
  if (!briefText || briefText.trim().length === 0) return { error: "브리프 텍스트가 비어있습니다." };
  const langDirective = lang === "en"
    ? "CRITICAL LANGUAGE RULE: ALL output fields must be written in English. Do NOT use Korean in any field.\n\n"
    : "CRITICAL LANGUAGE RULE: ALL output fields must be written in Korean (한국어). This includes visual_direction (camera, lighting, color_grade, editing), reference_mood, scene_count_hint descriptions, usp comparisons, and every other text field. Do NOT mix English into Korean analysis. Only use English for proper nouns, technical terms (e.g. POV, HUD, CCTV), or universally understood abbreviations.\n\n";
  const briefKnowledge = `
[연출 지식 베이스 — 분석 참조]
포맷별 구조: 6초(1~2씬,HOOK+CTA) / 15초(3~4씬,HOOK0~2s,BODY2~11s,CTA11~15s) / 30초(5~7씬,HOOK0~5s,BODY5~22s,CTA22~30s) / 45초(7~10씬) / 60초(8~12씬) / 2~3분(15~25씬)
HOOK 유형: Question/In Medias Res/Contrast/Statement/Visual/Mystery/Empathy — 첫 프레임부터 움직임, 소리없이 이해 가능, 궁금증 생성
서사 유형: Hero's Journey(60초+) / Problem-Solution(15~30초) / Before-After(30초) / Demonstration(30~60초) / Emotional Resonance(60초+) / Testimonial(30~60초) / Contrast-Unexpected(30~60초)
조명 매칭: 밝음/긍정→High Key / 드라마틱→Mid Key / 긴장/럭셔리→Low Key / 영웅→Rim Light / 갈등→Side Light / 낭만→Golden Hour
색온도: 따뜻함→앰버3200K / 프리미엄→골든4500K / 현대→중성5500K / 미래→쿨블루7000K+ / 도시→틸네온
게임장르 컬러: RPG=에메랄드+골드+딥퍼플 / FPS=올리브+브라운+낮은채도 / SF=네온블루+핫핑크 / 배틀로얄=틸+오렌지 / 캐주얼=고채도원색
편집페이스: 0.5~1초=초고속(범퍼) / 1~2초=고속(액션) / 2~4초=중간(서사) / 4~8초=느림(감성) / 8초+=브랜드필름
분석 자동 도출: ①포맷→씬수+타이밍 ②장르→색채+편집페이스 ③감정목표→조명+숏사이즈 ④타겟→카메라친숙도(MZ=빠른편집/40대+=중간) ⑤USP→노출방식
CTA: 감정피크 직후 배치 / 구체적 행동지시 / 로고+제품+핵심메시지 동시(마지막3~5초)
`;
  const systemPrompt = langDirective + briefKnowledge + `\n당신은 칸 광고제 황금사자상 수상 경력의 시니어 아트 디렉터 겸 크리에이티브 디렉터입니다. 위의 연출 지식 베이스를 기반으로 주어진 광고 브리프를 철저히 분석하여 실제 제작에 바로 활용할 수 있는 심층 전략 리포트를 작성하세요.\n\n반드시 아래 JSON 형식으로만 응답하세요. JSON 외 텍스트는 절대 포함하지 마세요.\n\n{"goal":{"summary":"핵심 목표 한 줄 요약","items":["구체적 목표1","목표2","목표3"],"kpi_hint":"KPI 제안","core_message":"이 캠페인이 전달해야 할 단 하나의 핵심 메시지 (15단어 이내, 태그라인처럼)","success_criteria":"구체적 수치 포함 성공 기준 2-3개","desired_action":"시청자가 취해야 할 구체적 행동 단계 2-3단계 퍼널"},"target":{"summary":"타겟 한 줄 요약","primary":["1차 타겟 항목1","항목2","항목3"],"insight":"심리적 욕구와 페인 포인트","media_behavior":"미디어/플랫폼 행동 패턴"},"usp":{"summary":"핵심 차별점 한 줄","items":[{"keyword":"2-4 word differentiator","comparison":"기존/경쟁 콘텐츠는 ~인데, 이건 ~라서 다르다"}],"competitive_edge":"독보적 강점","message_hierarchy":"1순위 → 2순위 → 3순위"},"tone_manner":{"summary":"톤앤매너 한 줄","keywords":["키워드1","키워드2","키워드3","키워드4"],"visual_direction":{"camera":"숏 사이즈/앵글/무빙 조합 (지식 베이스 기반)","lighting":"조명 유형/비율/방향 (지식 베이스 기반)","color_grade":"색온도/팔레트/채도 방향 (지식 베이스 기반)","editing":"컷 유형/페이스/리듬 (지식 베이스 기반)"},"reference_mood":"레퍼런스 무드","do_not":"절대 피해야 할 요소"},"production_notes":{"format_recommendation":"권장 포맷과 길이","shooting_style":"촬영 스타일","scene_count_hint":{"structure":"HOOK → BODY → CTA","total_scenes":"3-5개 씬","hook":{"duration":"3-5초","description":"구체적 오프닝 장면 묘사 (HOOK 유형 명시)"},"body":{"duration":"15-20초","description":"핵심 내러티브 비트와 구체적 샷 제안"},"cta":{"duration":"5-8초","description":"구체적 엔딩 비주얼/액션 묘사"}},"budget_efficiency":"제작 효율 조언","narrative_type":"서사 유형 (Hero Journey/Problem-Solution/Before-After 등)"}}\n\nCRITICAL QUALITY RULES:\nFor visual_direction, use the cinematography knowledge base to provide specific, professional camera/lighting/color/editing direction — not generic descriptions.\nFor usp.items, each item MUST include keyword + comparison.\nFor reference_mood, describe specific visual/audio moods.\nFor scene_count_hint, provide structured per-section guidance aligned with the format's HOOK-BODY-CTA timing from the knowledge base.\nFor goal.core_message, write a punchy one-liner (15 words max).\nFor goal.success_criteria, include 2-3 measurable benchmarks.\nFor goal.desired_action, write a clear 2-3 step funnel using → arrows.\nFor production_notes.narrative_type, select the most appropriate narrative structure from the knowledge base.\n각 항목은 구체적이고 실무에 바로 쓸 수 있도록 작성하세요.`;
  const data = await callVertexGemini(settings, "gemini-2.5-flash", {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: `다음 브리프를 분석해주세요:\n\n${briefText}` }] }],
    generationConfig: { maxOutputTokens: 2048, temperature: 0.3 },
  });
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error("AI 응답이 비어있습니다.");
  let jsonStr = content.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1].trim();
  return { analysis: JSON.parse(jsonStr) };
}

export async function handleEnhanceInpaintPrompt(body: any) {
  const settings = getSettings();
  ensureGoogleCredentials(settings);
  const { prompt, hasMask, assetDescriptions } = body;
  if (!prompt) return { error: "prompt is required" };
  const systemPrompt = `You are an expert prompt writer for high-precision image inpainting/editing.\n\nYour job:\n1. If the input is not in English, translate it to natural English first.\n2. Classify the request as one of: REMOVAL, REPLACEMENT, ADDITION, or MODIFICATION.\n3. Rewrite it into a SHORT, EXTREMELY SPECIFIC editing prompt optimized for image editing AI.\n\n═══ REMOVAL REQUESTS ═══\nDetection: words like "remove", "delete", "erase", "없애", "제거", "삭제", "지워"\nRules:\n- Primary instruction: "Completely remove [object] from the image."\n- Secondary instruction: "Fill the area with the natural continuation of the surrounding background."\n- CRITICAL: "Do NOT replace the removed object with any other object."\n- CRITICAL: "Do NOT add anything new. The area should look as if the object was never there."\n\n═══ UNIVERSAL RULES ═══\n- Keep the prompt SHORT (3-6 sentences max).\n- The FIRST sentence must be the primary action.\n- Never introduce creative additions the user didn't ask for.\n- Always end with: Preserve all unmasked content exactly as-is.\n${assetDescriptions ? `\nAsset references:\n${assetDescriptions}` : ""}${hasMask ? "\n[User painted a brush mask on the target area.]" : "\n[No brush mask. Full-image edit.]"}\n\nReturn ONLY the final prompt. No explanations. No markdown.`;
  try {
    const data = await callVertexGemini(settings, "gemini-2.0-flash", {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: prompt }] }],
    });
    return { enhanced: data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || prompt };
  } catch (e) {
    console.error("Vertex Gemini enhance error:", e);
    return { enhanced: prompt, fallback: true };
  }
}

export async function handleTranslateAnalysis(body: any) {
  const settings = getSettings();
  ensureGoogleCredentials(settings);
  const { mode, analysis, fieldValue, fieldPath, direction } = body;
  if (mode === "full") {
    const directionText = direction === "ko_to_en" ? "Korean to English" : "English to Korean";
    const systemPrompt = `You are a professional translator for advertising/marketing analysis.\nRULES:\n- Translate ALL text values in the JSON\n- Preserve the EXACT JSON structure\n- Keep proper nouns, brand names, game titles as-is\n- Return ONLY valid JSON, no markdown fences`;
    const data = await callVertexGemini(settings, "gemini-2.5-flash", {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: `Translate this analysis JSON from ${directionText}. Return ONLY valid JSON:\n\n${JSON.stringify(analysis)}` }] }],
      generationConfig: { maxOutputTokens: 4000, temperature: 0.1 },
    });
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) throw new Error("Empty AI response");
    let jsonStr = content.trim().replace(/```json\s?|```/g, "").trim();
    return { translated: JSON.parse(jsonStr) };
  }
  if (mode === "field") {
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
  console.log("[openai-image] Request:", { mode, model, size, bucket, sceneNumber, promptLen: prompt?.length });

  if (mode === "inpaint" && useNanoBanana && sourceImageUrl) {
    try { const nbUrls = [sourceImageUrl, ...referenceImageUrls].filter(Boolean); imageBytes = await callVertexNB2(settings, prompt, nbUrls, sizeToNB2Aspect(size)); const fp = saveToStorage(storagePath, "contis", projectId, `scene_${sceneNumber}_${Date.now()}.png`, imageBytes); return { publicUrl: storageFileUrl(fp), usedModel: "nano-banana-2" }; }
    catch (e) { console.error("[openai-image] NB2 inpaint failed:", (e as Error).message); if (!imageBase64) return { error: "NB2 failed and no imageBase64 for GPT fallback", usedModel: "nano-banana-2-failed" }; }
  }

  if (mode === "inpaint" && imageBase64 && (maskBase64 || forceGpt || useNanoBanana)) {
    if (useNanoBanana && sourceImageUrl) {
      try { const nbUrls = [sourceImageUrl, ...referenceImageUrls].filter(Boolean); imageBytes = await callVertexNB2(settings, prompt, nbUrls, sizeToNB2Aspect(size)); const fp = saveToStorage(storagePath, "contis", projectId, `scene_${sceneNumber}_${Date.now()}.png`, imageBytes); return { publicUrl: storageFileUrl(fp), usedModel: "nano-banana-2" }; }
      catch { console.error("[openai-image] NB2 inpaint fallback to GPT"); }
    }
    if (!openaiKey) throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");
    imageBytes = await callGptInpaint(openaiKey, imageBase64, maskBase64 ?? null, prompt, size, referenceImageUrls);
    suffix = "inpaint-gpt";
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
  ipcMain.handle("api:analyze-brief", (_e, body) => handleAnalyzeBrief(body));
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
