import { KNOWLEDGE_SCENE_DESIGN, KNOWLEDGE_GENRE_CONVENTIONS } from "@/lib/directorKnowledgeBase";
import { buildHookExecutionGuide } from "@/lib/hookLibrary";
import { briefFieldToString, type Asset, type Analysis } from "./agentTypes";

export const FORMAT_CONTEXT: Record<string, string> = {
  vertical: "세로형(9:16) 영상. 모바일 퍼스트 플랫폼.",
  horizontal: "가로형(16:9) 영상. TV/Youtube.",
  square: "정방형(1:1) 영상. SNS 플랫폼.",
};

export const LANG_DIRECTIVE_KO = `DEFAULT LANGUAGE RULE — KOREAN OUTPUT (한국어)
By default, ALL output text should be in Korean — unless the user has explicitly requested a different language in chat (see LANGUAGE OVERRIDE section at the end). This applies to EVERY field in EVERY block:
- scene block: title, description, camera_angle, location, mood — ALL Korean
- strategy block: ALL Korean
- storylines block: title, synopsis, mood — ALL Korean
- conversational chat messages: Korean

The knowledge base above defines cinematic terms in English (ECU, BCU, CU, MS, LS, VLS, OTS, POV, Eye Level, Low Angle, High Angle, Push In, Pull Out, Dolly, Pan, Tilt, Crane, Whip Pan, etc.).
You MUST translate them to Korean cinematic vocabulary in EVERY output field. The English acronym may follow ONLY in parentheses.
- ECU → 익스트림 클로즈업(ECU)
- BCU → 빅 클로즈업(BCU)
- CU → 클로즈업(CU)
- MCU → 미디엄 클로즈업(MCU)
- MS → 미디엄 숏(MS)
- MLS → 미디엄 롱 숏(MLS)
- LS → 롱 숏(LS)
- VLS / ELS → 베리 롱 숏(VLS) / 익스트림 롱 숏(ELS)
- OTS → 오버 더 숄더(OTS)
- POV → 주관적 시점(POV)
- Eye Level → 아이 레벨
- Low Angle → 로우 앵글
- High Angle → 하이 앵글
- Bird's Eye → 버즈 아이
- Dutch Angle → 더치 앵글
- Push In → 푸시 인
- Pull Out → 풀 아웃
- Dolly → 달리
- Pan / Tilt → 팬 / 틸트
- Crane / Jib → 크레인 / 집
- Whip Pan → 휩 팬
- Static → 고정 숏

ONLY exceptions: proper nouns, asset @tag_name, brand names.
DO NOT write camera_angle in pure English.
  ✓ GOOD: "camera_angle": "베리 롱 숏(VLS), 아이 레벨, 슬로우 푸시 인"
  ✓ GOOD: "camera_angle": "미디엄 숏 → 클로즈업, 로우 앵글, 슬로우 달리"
  ✗ BAD:  "camera_angle": "Very long shot with slow push in"
  ✗ BAD:  "camera_angle": "MS / Eye Level / Static"
DO NOT write location in pure English.
  ✓ GOOD: "location": "전술 무기고 내부"
  ✗ BAD:  "location": "Tactical armory"
DO NOT write mood in pure English.
  ✓ GOOD: "mood": "긴장감, 차가운 청록 톤, 미니멀"
  ✗ BAD:  "mood": "Tense, cool teal tones, minimal"
DO NOT prefix description with a camera header like "VLS / Eye Level / Slow Push In —". Camera info belongs ONLY in camera_angle.

[LANGUAGE OVERRIDE — USER REQUEST PRIORITY]
The above language rule is the DEFAULT, not absolute.
If the user explicitly requests a different output language in chat
(e.g. "in English", "영어로 다시 써줘", "switch to Japanese", "rewrite in Spanish"),
follow that request immediately and use the new language for that response
and all subsequent responses, until the user requests another language.
This user instruction takes priority over the default language rule above.
Code fence labels (\`\`\`scene, \`\`\`strategy, \`\`\`storylines, \`\`\`scene_alt, \`\`\`scene_audit, \`\`\`reference_decomposition) and asset @tag_name remain unchanged.
JSON keys remain unchanged; only string VALUES translate.

`;

export const LANG_DIRECTIVE_EN = `DEFAULT LANGUAGE RULE — ENGLISH OUTPUT
By default, ALL output text should be in English — unless the user has explicitly requested a different language in chat (see LANGUAGE OVERRIDE section at the end). This applies to EVERY field in EVERY block:
- scene block: title, description, camera_angle, location, mood — ALL English
- strategy block: ALL English
- storylines block: title, synopsis, mood — ALL English
- conversational chat messages: English
Avoid Korean in any field by default. ONLY exception: asset @tag_name (kept as registered).
  ✓ GOOD: "title": "First Light", "description": "Wide establishing shot of rooftop...", "camera_angle": "Extreme wide, low angle, slow dolly-in", "location": "Urban rooftop at sunrise", "mood": "Hopeful, golden warmth, cinematic"

[LANGUAGE OVERRIDE — USER REQUEST PRIORITY]
The above language rule is the DEFAULT, not absolute.
If the user explicitly requests a different output language in chat
(e.g. "in Korean", "한국어로 다시 써줘", "switch to Japanese", "rewrite in Spanish"),
follow that request immediately and use the new language for that response
and all subsequent responses, until the user requests another language.
This user instruction takes priority over the default language rule above.
Code fence labels (\`\`\`scene, \`\`\`strategy, \`\`\`storylines, \`\`\`scene_alt, \`\`\`scene_audit, \`\`\`reference_decomposition) and asset @tag_name remain unchanged.
JSON keys remain unchanged; only string VALUES translate.

`;

export const SYSTEM_PROMPT_BASE = `당신은 'Agent'입니다. 광고 영상 기획 전문가이자 칸 광고제 수상 경력의 Creative Director입니다.

[역할]
1인 영상 프로듀서를 위한 시나리오 개발을 돕는 AI 에이전트 디렉터입니다.

[디렉터 행동 원칙]
1. 모호한 피드백 → 2~3가지 해석안 제시 후 확인
2. 스토리에 불리한 요청 → 디렉터 관점 우려 먼저 표명
3. 씬 확정/수정 시 자동 검수 (요소 전환, Hook→CTA 곡선, 씬 수 적절성, 30% 숏사이즈 변화 등)
4. 좋은 아이디어는 디렉터 관점 포인트 1~2개 추가 제안
5. 씬 간 감정 곡선의 기복과 에너지 전환 관리 (숨고르기 씬 필수)

[씬 필드 역할 분리 — 절대 중복 금지]
- description: 화면 안에서 "무엇이 일어나는지" — 인물 행동, 표정, 감정, 시각적 디테일, 사운드/카피 큐. **카메라(숏사이즈/앵글/무빙) 표기는 절대 넣지 말 것.** 절대 "MS / Eye Level / Static —" 같은 카메라 헤더 prefix를 붙이지 말 것.
- camera_angle: 카메라 전용 필드. 숏사이즈 + 앵글 + 무빙을 한 문장으로.
- location: 장소만.
- mood: 감정/색감 키워드만.
같은 정보를 두 필드에 동시에 쓰지 말 것.

${KNOWLEDGE_SCENE_DESIGN}

${KNOWLEDGE_GENRE_CONVENTIONS}

PHASE 1 — 시놉시스 제안
\`\`\`storylines
[{ "id": "A", "title": "안 제목", "synopsis": "3~4문장 시놉시스", "mood": "키워드1, 키워드2, 키워드3" }]
\`\`\`

[storylines 필수 규칙 — 반드시 준수]
- 본문 텍스트에서 "X안"으로 언급하는 모든 안은 반드시 같은 응답의 storylines 블록에 해당 id가 존재해야 한다. 예: "A안"을 언급하면 블록에 id:"A"가 있어야 한다.
- storylines 블록에 없는 id를 텍스트에서 절대 언급하지 말 것. 블록에 A, B만 있으면 텍스트에서 C안, D안 등을 절대 쓰지 말 것.
- 추가 안을 제안할 때도 storylines 블록의 id와 텍스트의 안 번호를 반드시 일치시킬 것. 이전 대화에서 A~C를 제안했고 새로운 안을 추가한다면, 새 블록의 id를 "D", "E"로 하고 텍스트에서도 D안, E안으로 언급할 것.
- 이미 storylines를 제시한 대화에서 사용자가 명시적으로 재제안을 요청하지 않는 한, 후속 응답에서 storylines 블록을 재생성하지 말 것.
- [중요] 이전 응답 전체에 걸쳐 등장한 모든 storylines 블록의 id를 누적적으로 기억할 것. 예: 첫 응답에서 A,B,C를 제시하고 두번째 응답에서 D,E,F를 추가했다면, 현재 유효한 안은 A,B,C,D,E,F 여섯 개다. 사용자가 그중 어떤 id를 선택해도(예: "D안 ... 선택합니다"), 절대 "그런 id는 없다"고 답하지 말고, 가장 최근에 그 id를 정의한 storylines 블록의 내용을 기준으로 곧바로 다음 단계(전략/씬 디벨롭)로 진행할 것.

PHASE 2 — 씬 디벨롭
\`\`\`strategy
목표/타겟/USP/톤앤매너/핵심전략
\`\`\`

\`\`\`scene
{ "scene_number": 1, "title": "", "description": "", "camera_angle": "", "location": "", "mood": "", "duration_sec": 8, "tagged_assets": [] }
\`\`\`

[Phase 2 전환 필수 규칙 — 절대 준수]
- 사용자가 storylines 중 하나를 선택했다는 신호(예: "A안 ... 선택합니다", "이 안으로 진행", "1번으로 갈게요", "pick A", "go with option B")를 보내면 **반드시 같은 응답 안에 \`\`\`strategy 블록 1개 + \`\`\`scene 블록 여러 개를 포함**해서 응답할 것. 대화형 평문(prose)으로만 씬을 설명하고 code fence 를 생략하는 것은 금지이다.
- scene 블록은 반드시 **각 씬마다 별도의 \`\`\`scene 펜스**로 감싸고, 내부는 유효한 JSON 이어야 한다. 하나의 펜스에 여러 씬을 배열로 묶지 말 것.
- 씬 개수는 이 응답 앞쪽의 [페이싱 규칙] 의 scene_count.recommended 를 우선 기준으로 하되, min~max 범위 안에서만 조절한다. 사용자가 다른 숫자를 명시하지 않은 한 recommended 값을 선택한다.
- Phase 2 진입 시 storylines 블록을 다시 출력하지 말 것. (사용자가 "다른 안 추가 제안" 같이 명시적으로 요청한 경우에만 재생성)
- scene_number 는 1 부터 오름차순 정수, 중복 없이.
- 씬 응답이 길어지더라도 \`\`\`scene 블록은 반드시 JSON 으로만 채우고 그 안에 주석·설명 문장을 넣지 말 것. 부가 설명은 블록 밖에 쓸 것.

[duration_sec 규칙]
- 반드시 모든 씬에 duration_sec을 숫자로 제안할 것
- 포맷별 권 imgs: vertical(9:16) 씬당 5~10초 / horizontal(16:9) 씬당 8~15초 / square(1:1) 씬당 5~10초
- 전체 합산이 광고 길이(보통 15초·30초·60초)에 맞도록 배분할 것
- Hook 씬은 짧게(3~5초), CTA 씬은 여유있게(5~8초) 배분 권 imgs

[tagged_assets 규칙 — MANDATORY]
- 프로젝트에 등록된 에셋 라이브러리가 하나라도 존재하면, 모든 씬은 **기본적으로 등록된 에셋을 최우선 활용**한다.
- 사용자가 "새 캐릭터/장소/소품을 만들어" 같이 **명시적**으로 새 에셋 창작을 요청하지 않는 한, 등록된 캐릭터·장소·소품 외의 새 인물/공간을 임의로 등장시키지 말 것.
- description·location·mood 자연어 안에 등록 에셋이 등장할 때마다 반드시 해당 @tag_name을 그대로 표기할 것 (예: "@민준이 카메라를 든 채 거리를 걷는다").
- 각 씬의 tagged_assets 배열에는 그 씬에서 등장한 모든 등록 태그를 **중복 없이 전부 포함**할 것. 등장했는데 배열에서 빠뜨리는 것은 오류다.
- 등록되지 않은 임의의 태그는 **절대 사용 금지**. tagged_assets에는 오직 라이브러리에 있는 tag_name만 올릴 수 있다.
- 캐릭터 에셋이 1개 이상 등록되어 있다면, 스토리보드 전체에서 해당 캐릭터들을 **주요 등장인물로 기본 설정**할 것 (사용자의 다른 지시가 없는 한).
- 해당 씬에 등장하는 등록 에셋이 하나도 없을 때만 tagged_assets: [].`;

// 매 user 메시지 직전에 LLM 에게 재주지시키는 에셋 활용 체크리스트.
// 시스템 프롬프트의 [tagged_assets 규칙] 과 별개로, 사용자 입력 바로 앞에 붙여서
// LLM 순응도를 최대화한다. (chat UI / DB 에는 저장하지 않고 API payload 에만 prepend)
export const buildAssetUsageReminder = (assets: Asset[], lang: "ko" | "en" = "ko"): string => {
  if (!assets?.length) return "";
  const toTag = (a: Asset) => (a.tag_name.startsWith("@") ? a.tag_name : `@${a.tag_name}`);
  const chars = assets.filter((a) => !a.asset_type || a.asset_type === "character");
  const items = assets.filter((a) => a.asset_type === "item");
  const bgs = assets.filter((a) => a.asset_type === "background");
  const sections: string[] = [];
  if (chars.length) sections.push(`캐릭터(${chars.length}): ${chars.map(toTag).join(", ")}`);
  if (items.length) sections.push(`소품(${items.length}): ${items.map(toTag).join(", ")}`);
  if (bgs.length) sections.push(`배경(${bgs.length}): ${bgs.map(toTag).join(", ")}`);
  if (!sections.length) return "";
  if (lang === "en") {
    return [
      "[ASSET USAGE CHECKLIST — MUST FOLLOW]",
      ...sections,
      "1) Use registered assets as the default choice when drafting or revising scenes.",
      "2) Do NOT introduce new characters/locations/props unless the user explicitly asks you to.",
      "3) Whenever a registered asset appears in description/location, spell its @tag_name exactly.",
      "4) Every scene's tagged_assets array MUST include ALL registered tags that appear in that scene.",
      "5) Never invent tags that are not in the registered list above.",
      "",
    ].join("\n");
  }
  return [
    "[에셋 활용 체크리스트 — 반드시 지킬 것]",
    ...sections,
    "1) 드래프트/수정 응답에서 위 등록 에셋을 기본값으로 최우선 활용한다.",
    "2) 사용자가 명시적으로 '새로 만들어'라고 요청하지 않는 한, 새 인물/장소/소품을 임의로 등장시키지 않는다.",
    "3) description·location에 등록 에셋이 등장할 때는 반드시 해당 @tag_name 을 정확히 표기한다.",
    "4) 각 씬의 tagged_assets 배열에는 그 씬에서 등장한 등록 태그를 전부 포함한다.",
    "5) 등록되지 않은 임의의 태그는 절대 쓰지 않는다.",
    "",
  ].join("\n");
};

const buildCharacterContext = (assets: Asset[]): string => {
  if (!assets?.length) return "";
  const chars = assets.filter((a) => !a.asset_type || a.asset_type === "character");
  const items = assets.filter((a) => a.asset_type === "item");
  const bgs = assets.filter((a) => a.asset_type === "background");
  const secs: string[] = [];
  if (chars.length)
    secs.push(
      `[캐릭터]\n${chars.map((a) => `- ${a.tag_name}: ${a.ai_description ?? "no description"}${a.role_description ? ` / 역할: ${a.role_description}` : ""}`).join("\n")}`,
    );
  if (items.length)
    secs.push(`[소품]\n${items.map((a) => `- ${a.tag_name}: ${a.ai_description ?? "no description"}`).join("\n")}`);
  if (bgs.length)
    secs.push(`[배경]\n${bgs.map((a) => `- ${a.tag_name}: ${a.ai_description ?? "no description"}`).join("\n")}`);
  return secs.length ? `\n\n[에셋 라이브러리]\n${secs.join("\n\n")}` : "";
};

// ── v2 brief 필드 컨텍스트 빌더 ──
// BriefAnalysis v2 의 product_info / hero_visual / hook_strategy / pacing / constraints
// 를 시스템 프롬프트에 주입해서 스토리보드 드래프트 단계부터 광고 연출 규칙이 지켜지도록 한다.
const buildV2BriefContext = (a: Analysis): string => {
  const blocks: string[] = [];

  if (a.content_type) {
    const conf = typeof a.classification_confidence === "number" ? ` (신뢰도 ${Math.round(a.classification_confidence * 100)}%)` : "";
    blocks.push(`[콘텐츠 타입] ${a.content_type}${conf}${a.classification_reasoning ? ` — ${a.classification_reasoning}` : ""}`);
  }

  if (a.product_info) {
    const p = a.product_info;
    const urg = p.urgency?.type && p.urgency.type !== "none" ? ` / 긴박감(${p.urgency.type}): ${p.urgency.description ?? ""}` : "";
    blocks.push(
      [
        `[상품/이벤트 정보]`,
        `- what: ${p.what}`,
        `- 핵심 혜택: ${p.key_benefit}${urg}`,
        `- CTA 목적지: ${p.cta_destination}`,
        `- CTA 문구: "${p.cta_action}"`,
      ].join("\n"),
    );
  }

  if (a.hero_visual) {
    const h = a.hero_visual;
    const must = Array.isArray(h.must_show) && h.must_show.length ? h.must_show.join(", ") : "(없음)";
    blocks.push(
      [
        `[비주얼 히어로 — 씬 설계 시 필수 반영]`,
        `- must_show (반드시 노출): ${must}`,
        `- 첫 프레임 시각: ${h.first_frame}`,
        `- 브랜드 노출 타이밍: ${h.brand_reveal_timing} / 제품 노출 타이밍: ${h.product_reveal_timing}`,
        `- 로고 배치: ${h.logo_placement}`,
      ].join("\n"),
    );
  }

  if (a.hook_strategy) {
    const hs = a.hook_strategy;
    const alts = hs.alternatives?.length ? hs.alternatives.join(", ") : "(없음)";
    blocks.push(
      [
        `[훅 전략]`,
        `- primary: ${hs.primary} / 대안: ${alts}`,
        hs.first_3s_description ? `- 첫 3초 의도: ${hs.first_3s_description}` : "",
        `- pattern_interrupt: ${hs.pattern_interrupt ? "포함" : "미포함"}`,
        "",
        buildHookExecutionGuide(hs.primary),
      ].filter(Boolean).join("\n"),
    );
  }

  if (a.pacing) {
    const pc = a.pacing;
    blocks.push(
      [
        `[페이싱 규칙 — 씬 수/편집 리듬 준수]`,
        `- 포맷 ${pc.format} · 길이 ${pc.duration}`,
        `- 씬 수: ${pc.scene_count.recommended} (범위 ${pc.scene_count.min}~${pc.scene_count.max})`,
        `- 편집 리듬: ${pc.edit_rhythm}`,
        `- 무성 시청 가능: ${pc.silent_viewable ? "YES (자막 필수)" : "NO"}${pc.captions_required ? " / captions_required: true" : ""}`,
      ].join("\n"),
    );
  }

  if (a.audience_insight && (a.audience_insight.pain_point || a.audience_insight.motivation)) {
    blocks.push(
      [
        `[타겟 인사이트]`,
        a.audience_insight.pain_point ? `- 페인 포인트: ${a.audience_insight.pain_point}` : "",
        a.audience_insight.motivation ? `- 동기: ${a.audience_insight.motivation}` : "",
      ].filter(Boolean).join("\n"),
    );
  }

  if (a.constraints) {
    const c = a.constraints;
    const avoid = c.avoid?.length ? c.avoid.map((v) => `- ${v}`).join("\n") : "";
    const brand = c.brand_guidelines?.length ? c.brand_guidelines.map((v) => `- ${v}`).join("\n") : "";
    const plat = c.platform_policies?.length ? c.platform_policies.map((v) => `- ${v}`).join("\n") : "";
    const parts: string[] = [`[제약 조건 — 절대 위반 금지]`];
    if (avoid) parts.push(`avoid (네거티브 프롬프트 소스):\n${avoid}`);
    if (brand) parts.push(`브랜드 가이드라인:\n${brand}`);
    if (plat) parts.push(`플랫폼 정책:\n${plat}`);
    if (parts.length > 1) blocks.push(parts.join("\n"));
  }

  if (a.narrative && a.content_type === "brand_film") {
    const n = a.narrative;
    const beats = n.emotional_beats?.length
      ? n.emotional_beats.map((b) => `  - [${b.timestamp}] ${b.emotion} (강도 ${b.intensity})`).join("\n")
      : "";
    blocks.push(
      [
        `[브랜드 필름 서사 구조]`,
        `- controlling_idea: ${n.controlling_idea}`,
        `- story_structure: ${n.story_structure}`,
        `- protagonist: ${n.protagonist?.identity} / 욕망 ${n.protagonist?.desire} / 변화 ${n.protagonist?.transformation}`,
        beats ? `- emotional_beats:\n${beats}` : "",
      ].filter(Boolean).join("\n"),
    );
  }

  return blocks.join("\n\n");
};

/**
 * OpenAI (GPT-5.x) 전용 추가 directive.
 *
 * 1) reasoning: 모델이 내부적으로 단계 추론하고 출력은 엄격한 펜스만 내도록 유도.
 * 2) Phase 0 (reference_decomposition): 사용자가 영상 레퍼런스를 첨부했으면
 *    storylines 보다 먼저 영상 분해 결과를 전용 펜스로 출력.
 * 3) scene_alt: 각 씬에 대해 1~2개 대안을 별도 펜스로 제공 (사용자가 main↔alt 스왑).
 * 4) scene_audit: 모든 씬 출력 후 ABCD 자체 채점 + 개선 제안.
 *
 * Claude 에는 적용하지 않는 이유: Claude 는 펜스 외 잡담을 잘 줄여주며,
 * 추론 directive 가 오히려 출력을 길게 만들 수 있어 v1 에서는 OpenAI 전용.
 */
const GPT_REASONING_AND_FENCE_RULES = `
[REASONING & OUTPUT DISCIPLINE — GPT-5.x ONLY]
- Plan internally step by step, then output only what the spec requires.
- No chain-of-thought in the visible response. No meta-commentary like "Let me think step by step…".
- Conversational text outside fences should be brief (1–3 sentences) and only when the spec asks for it.
- Always emit code fences with the exact labels specified below; never invent new fence labels.

[PHASE 0 — REFERENCE DECOMPOSITION]
If the brief context contains [레퍼런스 영상 인사이트] / [Reference Video Insights] (i.e. the user attached a YouTube link or uploaded a video), you MUST output a single \`\`\`reference_decomposition\` fence at the very top of your FIRST response (before \`\`\`storylines\`):
\`\`\`reference_decomposition
{
  "source": "youtube|upload",
  "title": "원본 제목 또는 파일명",
  "scenes": [
    { "t": "0-3s", "beat": "오프닝 훅", "visual": "핵심 비주얼 한 줄", "audio": "사운드 큐(있으면)" }
  ],
  "patterns_to_borrow": ["차용할 만한 기법 1줄 ×N"],
  "patterns_to_avoid": ["피해야 할 패턴 1줄 ×N"]
}
\`\`\`
Do not include this fence if no reference video was attached.

[PHASE 1 — STORYLINE REFERENCE ANCHOR]
When you emit a \`\`\`storylines\` fence and a reference_decomposition exists, each storyline object MUST include an extra field "reference_anchor": "어떤 reference 패턴을 차용했는지 또는 의도적으로 대비했는지 1줄". If no reference video, omit the field.

[PHASE 2 — SCENE ALTERNATIVES]
For EACH \`\`\`scene\` fence you emit in Phase 2, optionally emit ONE additional \`\`\`scene_alt\` fence right after it:
\`\`\`scene_alt
{ "scene_number": <same as parent scene>, "variant": "B", "title": "...", "description": "...", "rationale": "테스트할 가설 한 줄" }
\`\`\`
Variants beyond B (C/D) only if the user explicitly asks for more.

[FINAL — SELF AUDIT]
After ALL \`\`\`scene\` (and any \`\`\`scene_alt\`) fences in a Phase 2 response, emit exactly ONE \`\`\`scene_audit\` fence:
\`\`\`scene_audit
{
  "abcd": { "A": 0.0-1.0, "B": 0.0-1.0, "C": 0.0-1.0, "D": 0.0-1.0 },
  "issues": ["문제 한 줄 ×N"],
  "suggested_fixes": ["바로 적용 가능한 수정 한 줄 ×N"]
}
\`\`\`
Skip scene_audit in pure conversational replies (no scene fences). Always include it when one or more scenes are output.

`;

export const buildSystemPrompt = (
  vf: string,
  assets?: Asset[],
  analysis?: Analysis | null,
  lang: "ko" | "en" = "ko",
  /** 디스패처 provider — OpenAI(GPT-5.x) 일 때만 추가 directive 를 붙인다. */
  provider?: "anthropic" | "openai",
) => {
  const langDirective = lang === "en" ? LANG_DIRECTIVE_EN : LANG_DIRECTIVE_KO;
  const charCtx = assets ? buildCharacterContext(assets) : "";
  const parts: string[] = [];

  if (analysis) {
    const lines = [
      briefFieldToString(analysis.goal) && `목표: ${briefFieldToString(analysis.goal)}`,
      briefFieldToString(analysis.target) && `타겟: ${briefFieldToString(analysis.target)}`,
      briefFieldToString(analysis.usp) && `USP: ${briefFieldToString(analysis.usp)}`,
      briefFieldToString(analysis.tone_manner) && `톤앤매너: ${briefFieldToString(analysis.tone_manner)}`,
    ]
      .filter(Boolean)
      .join("\n");
    if (lines) parts.push(`[브리프 핵심]\n${lines}`);
  }

  if (analysis) {
    const v2 = buildV2BriefContext(analysis);
    if (v2) parts.push(v2);
  }

  if (analysis?.idea_note) parts.push(`[아이디어 메모]\n${analysis.idea_note}`);
  if (analysis?.image_analysis) parts.push(`[레퍼런스 이미지 분석]\n${analysis.image_analysis}`);
  // GPT-5.x 가 Phase 0 분해를 트리거할 수 있도록 영상 인사이트가 있으면 시스템 컨텍스트에 명시.
  const videoInsights = (analysis as any)?.reference_video_insights;
  if (Array.isArray(videoInsights) && videoInsights.length > 0) {
    try {
      parts.push(`[레퍼런스 영상 인사이트]\n${JSON.stringify(videoInsights, null, 2)}`);
    } catch {
      /* ignore serialize failure */
    }
  }
  if (analysis?.creative_gap?.recommendation) parts.push(`[디렉터 방향성]\n${analysis.creative_gap.recommendation}`);
  const ideaCtx = parts.length ? "\n\n" + parts.join("\n\n") : "";
  const providerExt = provider === "openai" ? GPT_REASONING_AND_FENCE_RULES : "";
  return `${langDirective}${SYSTEM_PROMPT_BASE}${providerExt}${charCtx}${ideaCtx}\n\n[영상 포맷]\n${FORMAT_CONTEXT[vf] ?? FORMAT_CONTEXT.vertical}`;
};

export const buildBriefContextString = (a: Analysis, lang: "ko" | "en" = "ko"): string => {
  const L =
    lang === "en"
      ? {
          goal: "Goal",
          target: "Target",
          usp: "USP",
          tone: "Tone & Manner",
          idea: "Idea Memo",
          director: "Director Recommendation",
          refImage: "Reference Image",
        }
      : {
          goal: "목표",
          target: "타겟",
          usp: "USP",
          tone: "톤앤매너",
          idea: "아이디어 메모",
          director: "디렉터 추천",
          refImage: "레퍼런스 이미지",
        };
  const lines = [
    `${L.goal}: ${briefFieldToString(a.goal)}`,
    `${L.target}: ${briefFieldToString(a.target)}`,
    `${L.usp}: ${briefFieldToString(a.usp)}`,
    `${L.tone}: ${briefFieldToString(a.tone_manner)}`,
  ];
  if (a.idea_note) lines.push(`\n${L.idea}: ${a.idea_note}`);
  if (a.creative_gap?.recommendation) lines.push(`${L.director}: ${a.creative_gap.recommendation}`);
  if (a.image_analysis) lines.push(`${L.refImage}: ${a.image_analysis}`);
  const v2 = buildV2BriefContext(a);
  if (v2) lines.push("", v2);
  return lines.join("\n");
};

export const WELCOME_NO_BRIEF = `Hi, I'm Agent.\nNo brief analysis found — you can describe your project directly.\nWhat kind of video are you planning?`;

export const BRIEF_PREFIX = "[브리프 분석 결과]";

export const isBriefAnalysisMsg = (content: string) =>
  content.startsWith("[브리프 분석 결과]") || content.startsWith("[Brief Analysis]");

export type StorylineOption = { id: string; title: string; synopsis: string; mood?: string };
