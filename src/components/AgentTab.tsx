import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import type { VideoFormat } from "@/lib/conti";
import { supabase } from "@/lib/supabase";
import { callClaude } from "@/lib/claude";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import ReactMarkdown from "react-markdown";
import {
  Plus,
  Clapperboard,
  Loader2,
  Send,
  Lightbulb,
  X,
  Check,
  ImagePlus,
  Sparkles,
  RotateCcw,
  Image,
  ImageOff,
  Layers,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Columns2,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";

import {
  KR,
  KR_BG,
  KR_BORDER2,
  type Asset,
  type Scene,
  type Analysis,
  type ChatLog,
  type ChatImage,
  type MoodImage,
  type ParsedScene,
  type FocalPoint,
  type RightPanel,
  briefFieldToString,
  formatTime,
  fileToBase64,
  loadFocalMap,
  toMoodImages,
  extractScenesFromText,
  resolveAsset,
  _pendingScenesByProject,
  loadPendingFromLS,
  savePendingToLS,
  getMoodGen,
  subscribeMoodGen,
  parseMessageSegments,
  remapMessageForHistory,
  type MessageSegment,
  ACFG,
  ASSET_ICON,
} from "./agent/agentTypes";
import { KNOWLEDGE_SCENE_DESIGN, KNOWLEDGE_GENRE_CONVENTIONS } from "@/lib/directorKnowledgeBase";
import { MoodIdeationPanel } from "./agent/MoodIdeationPanel";
import {
  SortableSceneCard,
  EditablePendingSceneCard,
  TagChip,
  MentionDropdown,
  AgentInlineField,
} from "./agent/AgentSceneCards";
import { ConfirmScenesModal, SendToContiModal, LoadVersionModal } from "./agent/AgentModals";

// ── System prompt & constants ──

const FORMAT_CONTEXT: Record<string, string> = {
  vertical: "세로형(9:16) 영상. 모바일 퍼스트 플랫폼.",
  horizontal: "가로형(16:9) 영상. TV/Youtube.",
  square: "정방형(1:1) 영상. SNS 플랫폼.",
};
const LANG_DIRECTIVE_KO = `CRITICAL LANGUAGE RULE — KOREAN OUTPUT (한국어)
ALL output text MUST be in Korean. This applies to EVERY field in EVERY block:
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

`;

const LANG_DIRECTIVE_EN = `CRITICAL LANGUAGE RULE — ENGLISH OUTPUT
ALL output text MUST be in English. This applies to EVERY field in EVERY block:
- scene block: title, description, camera_angle, location, mood — ALL English
- strategy block: ALL English
- storylines block: title, synopsis, mood — ALL English
- conversational chat messages: English
DO NOT use Korean in any field. ONLY exception: asset @tag_name (kept as registered).
  ✓ GOOD: "title": "First Light", "description": "Wide establishing shot of rooftop...", "camera_angle": "Extreme wide, low angle, slow dolly-in", "location": "Urban rooftop at sunrise", "mood": "Hopeful, golden warmth, cinematic"
  ✗ BAD:  Any Korean characters (가-힣) in any field.

`;

const SYSTEM_PROMPT_BASE = `당신은 'YD'입니다. 광고 영상 기획 전문가이자 칸 광고제 수상 경력의 Creative Director입니다.

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
const buildAssetUsageReminder = (assets: Asset[], lang: "ko" | "en" = "ko"): string => {
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

// ✅ [FIX] buildSystemPrompt — goal/target/usp/tone_manner 핵심 필드 주입 추가
const buildSystemPrompt = (vf: string, assets?: Asset[], analysis?: Analysis | null, lang: "ko" | "en" = "ko") => {
  const langDirective = lang === "en" ? LANG_DIRECTIVE_EN : LANG_DIRECTIVE_KO;
  const charCtx = assets ? buildCharacterContext(assets) : "";
  const parts: string[] = [];

  // ✅ 핵심 브리프 필드 주입 (goal/target/usp/tone_manner)
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

  if (analysis?.idea_note) parts.push(`[아이디어 메모]\n${analysis.idea_note}`);
  if (analysis?.image_analysis) parts.push(`[레퍼런스 이미지 분석]\n${analysis.image_analysis}`);
  if (analysis?.creative_gap?.recommendation) parts.push(`[디렉터 방향성]\n${analysis.creative_gap.recommendation}`);
  const ideaCtx = parts.length ? "\n\n" + parts.join("\n\n") : "";
  return `${langDirective}${SYSTEM_PROMPT_BASE}${charCtx}${ideaCtx}\n\n[영상 포맷]\n${FORMAT_CONTEXT[vf] ?? FORMAT_CONTEXT.vertical}`;
};

const buildBriefContextString = (a: Analysis): string => {
  const lines = [
    `목표: ${briefFieldToString(a.goal)}`,
    `타겟: ${briefFieldToString(a.target)}`,
    `USP: ${briefFieldToString(a.usp)}`,
    `톤앤매너: ${briefFieldToString(a.tone_manner)}`,
  ];
  if (a.idea_note) lines.push(`\n아이디어 메모: ${a.idea_note}`);
  if (a.creative_gap?.recommendation) lines.push(`디렉터 추천: ${a.creative_gap.recommendation}`);
  if (a.image_analysis) lines.push(`레퍼런스 이미지: ${a.image_analysis}`);
  return lines.join("\n");
};

const WELCOME_NO_BRIEF = `Hi, I'm YD.\nNo brief analysis found — you can describe your project directly.\nWhat kind of video are you planning?`;

type StorylineOption = { id: string; title: string; synopsis: string; mood?: string };
const isBriefAnalysisMsg = (content: string) =>
  content.startsWith("[브리프 분석 결과]") || content.startsWith("[Brief Analysis]");

// ── Sub-components used in chat ──

const StorylinesCard = ({ options, onSelect }: { options: StorylineOption[]; onSelect: (text: string) => void }) => {
  return (
    <div className="my-2 space-y-2">
      {options.map((opt, i) => {
        const label = opt.id || String.fromCharCode(65 + i);
        return (
        <div
          key={opt.id ?? i}
          className="border overflow-hidden"
          style={{ borderRadius: 0, borderColor: "rgba(255,255,255,0.07)", background: "hsl(var(--elevated))" }}
        >
          <div
            className="flex items-center gap-2 px-3 py-2"
            style={{ background: "rgba(249,66,58,0.06)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
          >
            <span
              className="text-[10px] font-bold w-5 h-5 flex items-center justify-center text-white shrink-0"
              style={{ background: KR, borderRadius: 2 }}
            >
              {label}
            </span>
            <span className="text-[14px] font-bold uppercase tracking-wide text-foreground flex-1">{opt.title}</span>
            {opt.mood && (
              <span className="font-mono text-[11px] text-muted-foreground/50 shrink-0 uppercase">{opt.mood}</span>
            )}
          </div>
          <div className="px-3 py-2.5">
            <p className="text-[14px] text-muted-foreground leading-relaxed">{opt.synopsis}</p>
            <button
              onClick={() => onSelect(`${label}안 "${opt.title}" 선택합니다.`)}
              className="mt-2.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider px-3 py-1.5 transition-opacity hover:opacity-80"
              style={{
                background: "rgba(249,66,58,0.1)",
                color: KR,
                border: `1px solid rgba(249,66,58,0.2)`,
                borderRadius: 3,
              }}
            >
              SELECT →
            </button>
          </div>
        </div>
        );
      })}
    </div>
  );
};

const StrategyCard = ({ content }: { content: string }) => {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return (
    <div
      className="my-2 border overflow-hidden text-left"
      style={{ borderRadius: 0, borderColor: "rgba(255,255,255,0.07)", background: "hsl(var(--elevated))" }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ background: "rgba(249,66,58,0.06)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <Lightbulb className="w-3.5 h-3.5 shrink-0" style={{ color: KR }} />
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: KR }}>
          STRATEGY
        </span>
      </div>
      <div className="px-3 py-1">
        {lines.map((line, i) => {
          const ai = line.indexOf("→");
          const st = i < lines.length - 1 ? { borderBottom: "1px solid rgba(255,255,255,0.04)" } : {};
          if (ai !== -1)
            return (
              <div key={i} className="py-2 text-[13px] leading-relaxed" style={st}>
                <span className="block label-meta text-muted-foreground mb-0.5">{line.slice(0, ai).trim()}</span>
                <span className="text-foreground/80">{line.slice(ai + 1).trim()}</span>
              </div>
            );
          return (
            <div key={i} className="py-2 text-[13px] leading-relaxed text-foreground/60" style={st}>
              {line}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const BRIEF_PREFIX = "[브리프 분석 결과]";
const BriefAnalysisCard = ({ content }: { content: string }) => {
  const lines = content
    .replace(/^\[브리프 분석 결과\]\s*/i, "")
    .replace(/^\[Brief Analysis\]\s*/i, "")
    .split("\n")
    .filter((l) => l.trim());
  const sections: { label: string; value: string }[] = [];
  const requestLine = lines.findIndex((l) => l.includes("시놉시스") || l.includes("storylines") || l.includes("제안"));
  for (const line of lines.slice(0, requestLine === -1 ? lines.length : requestLine)) {
    const m = line.match(/^(.+?):\s*(.+)$/);
    if (m) sections.push({ label: m[1].trim(), value: m[2].trim() });
  }
  const labelColors: Record<string, string> = { 목표: "#f9423a", 타겟: "#6366f1", USP: "#d97706", 톤앤매너: "#059669" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <Sparkles size={13} style={{ color: KR }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: KR, letterSpacing: "0.04em" }}>BRIEF ANALYSIS</span>
      </div>
      {sections.map((sec, i) => {
        const color = labelColors[sec.label] ?? "#888";
        return (
          <div
            key={i}
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 6,
              padding: "8px 12px",
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color,
                letterSpacing: "0.04em",
                textTransform: "uppercase" as const,
                marginBottom: 4,
              }}
            >
              {sec.label}
            </div>
            <div style={{ fontSize: 14, color: "hsl(var(--foreground))", lineHeight: 1.6, opacity: 0.85 }}>
              {sec.value}
            </div>
          </div>
        );
      })}
      {requestLine !== -1 && (
        <div
          style={{
            fontSize: 13,
            color: "hsl(var(--muted-foreground))",
            marginTop: 2,
            fontStyle: "italic",
            opacity: 0.7,
          }}
        >
          {lines.slice(requestLine).join(" ")}
        </div>
      )}
    </div>
  );
};

const MessageContent = ({
  content,
  assets,
  onSend,
  segments: preSegments,
}: {
  content: string;
  assets: Asset[];
  onSend?: (text: string) => void;
  segments?: MessageSegment[];
}) => {
  if (isBriefAnalysisMsg(content)) return <BriefAnalysisCard content={content} />;
  const segments = preSegments ?? parseMessageSegments(content);
  const renderWithTags = (text: string): React.ReactNode =>
    text.split(/(@[\w가-힣]+)/g).map((p, i) => {
      if (/^@[\w가-힣]+$/.test(p)) {
        const resolved = resolveAsset(p, assets);
        if (resolved)
          return <TagChip key={i} name={resolved.name} assetType={resolved.asset.asset_type || "character"} />;
      }
      return <span key={i}>{p}</span>;
    });
  return (
    <div>
      {segments.map((seg, i) => {
        if (seg.type === "strategy") return <StrategyCard key={i} content={seg.content} />;
        if (seg.type === "storylines")
          return <StorylinesCard key={i} options={seg.options} onSelect={(t) => onSend?.(t)} />;
        if (seg.type === "scene") return null;
        return (
          <ReactMarkdown
            key={i}
            components={{
              h1: ({ children }) => (
                <h1 className="text-[17px] font-bold text-foreground mt-3 mb-1.5 first:mt-0">{children}</h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-[16px] font-bold text-foreground mt-3 mb-1 first:mt-0">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-[15px] font-semibold text-foreground mt-2.5 mb-1 first:mt-0">{children}</h3>
              ),
              code: ({ children }) => (
                <code className="bg-background/50 px-1 py-0.5 rounded text-[13px] font-mono text-muted-foreground">
                  {children}
                </code>
              ),
              strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
              p: ({ children }) => {
                if (typeof children === "string")
                  return (
                    <p className="text-[14.5px] leading-[1.7] mb-1.5 last:mb-0 text-foreground/85">
                      {renderWithTags(children)}
                    </p>
                  );
                const processed = React.Children.map(children, (child) =>
                  typeof child === "string" ? <>{renderWithTags(child)}</> : child,
                );
                return <p className="text-[14.5px] leading-[1.7] mb-1.5 last:mb-0 text-foreground/85">{processed}</p>;
              },
              ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
              li: ({ children }) => <li className="text-[14px] leading-[1.65] text-foreground/80">{children}</li>,
              hr: () => <hr className="border-border/30 my-2.5" />,
              blockquote: ({ children }) => (
                <blockquote
                  className="border-l-2 pl-3 my-2 text-[14px] text-muted-foreground italic"
                  style={{ borderColor: KR }}
                >
                  {children}
                </blockquote>
              ),
            }}
          >
            {seg.content}
          </ReactMarkdown>
        );
      })}
    </div>
  );
};

// ── AgentChatInput ──

const AgentChatInput = ({
  assets,
  projectId,
  disabled,
  hasImages,
  onSend,
  onAttach,
}: {
  assets: Asset[];
  projectId: string;
  disabled: boolean;
  hasImages: boolean;
  onSend: (text: string) => void;
  onAttach: () => void;
}) => {
  const [text, setText] = useState("");
  const [mentionState, setMentionState] = useState<{ query: string; startIdx: number } | null>(null);
  const [selIdx, setSelIdx] = useState(-1);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const focalMap = useMemo(() => loadFocalMap(projectId), [projectId]);
  useEffect(() => {
    setSelIdx(-1);
  }, [mentionState?.query]);
  const suggestions = mentionState
    ? assets
        .filter((a) => a.tag_name.replace(/^@/, "").toLowerCase().includes(mentionState.query.toLowerCase()))
        .slice(0, 8)
    : [];
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value,
      pos = e.target.selectionStart ?? v.length;
    const m = v.slice(0, pos).match(/@([\w가-힣]*)$/);
    setMentionState(m ? { query: m[1], startIdx: pos - m[0].length } : null);
    setText(v);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  };
  const insertMention = (asset: Asset) => {
    if (!mentionState || !taRef.current) return;
    const ta = taRef.current;
    const name = asset.tag_name.startsWith("@") ? asset.tag_name.slice(1) : asset.tag_name;
    const before = text.slice(0, mentionState.startIdx);
    const after = text.slice(ta.selectionStart ?? mentionState.startIdx);
    const newVal = `${before}@${name} ${after}`;
    setText(newVal);
    setMentionState(null);
    setSelIdx(-1);
    const newPos = before.length + name.length + 2;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newPos, newPos);
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
    });
  };
  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
    if (taRef.current) taRef.current.style.height = "auto";
  };
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 6 }}>
      <textarea
        ref={taRef}
        value={text}
        onChange={handleChange}
        disabled={disabled}
        rows={1}
        placeholder="Type a message... (@tag characters)"
        className="placeholder:text-muted-foreground/35"
        onKeyDown={(e) => {
          if (suggestions.length > 0) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelIdx((p) => (p + 1) % suggestions.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelIdx((p) => (p - 1 + suggestions.length) % suggestions.length);
              return;
            }
            if (e.key === "Enter" && selIdx >= 0) {
              e.preventDefault();
              insertMention(suggestions[selIdx]);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        style={{
          flex: 1,
          resize: "none",
          outline: "none",
          overflow: "hidden",
          background: "hsl(var(--muted))",
          color: "hsl(var(--foreground))",
          border: "1.5px solid hsl(var(--border))",
          borderRadius: 0,
          padding: "7px 12px",
          fontSize: 13,
          lineHeight: 1.5,
          fontFamily: "inherit",
          transition: "border-color 0.15s",
          minHeight: 36,
          maxHeight: 120,
          boxSizing: "border-box",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = KR;
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "hsl(var(--border))";
        }}
      />
      <button
        onClick={submit}
        disabled={disabled || !text.trim()}
        style={{
          width: 36,
          height: 36,
          borderRadius: 0,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: text.trim() && !disabled ? KR : "hsl(var(--muted))",
          border: "1.5px solid transparent",
          color: text.trim() && !disabled ? "#fff" : "hsl(var(--muted-foreground))",
          cursor: text.trim() && !disabled ? "pointer" : "default",
          transition: "all 0.15s",
          boxSizing: "border-box",
          padding: 0,
        }}
      >
        {disabled ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
      </button>
      <button
        onClick={onAttach}
        title="Attach images (max 4)"
        style={{
          width: 36,
          height: 36,
          borderRadius: 0,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: hasImages ? "rgba(249,66,58,0.14)" : "hsl(var(--muted))",
          border: `1.5px solid ${hasImages ? "rgba(249,66,58,0.28)" : "hsl(var(--border))"}`,
          color: hasImages ? KR : "hsl(var(--muted-foreground))",
          cursor: "pointer",
          transition: "all 0.15s",
          boxSizing: "border-box",
          padding: 0,
        }}
        onMouseEnter={(e) => {
          if (!hasImages) {
            (e.currentTarget as HTMLElement).style.background = "hsl(var(--accent))";
            (e.currentTarget as HTMLElement).style.color = "hsl(var(--foreground))";
          }
        }}
        onMouseLeave={(e) => {
          if (!hasImages) {
            (e.currentTarget as HTMLElement).style.background = "hsl(var(--muted))";
            (e.currentTarget as HTMLElement).style.color = "hsl(var(--muted-foreground))";
          }
        }}
      >
        <ImagePlus className="w-4 h-4" />
      </button>
      {suggestions.length > 0 && (
        <MentionDropdown
          suggestions={suggestions}
          selIdx={selIdx}
          onSelect={insertMention}
          onHover={setSelIdx}
          focalMap={focalMap}
          upward
        />
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════
//   MAIN — AgentTab
// ══════════════════════════════════════════════════════════

interface Props {
  projectId: string;
  videoFormat?: VideoFormat;
  lang?: "ko" | "en";
  onSwitchToContiTab?: () => void;
}

export const AgentTab = ({ projectId, videoFormat = "vertical", lang = "ko", onSwitchToContiTab }: Props) => {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [chatHistory, setChatHistory] = useState<ChatLog[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [chatImages, setChatImages] = useState<ChatImage[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [sessionImageMap] = useState(() => new Map<string, string[]>());
  const [moodLightboxUrl, setMoodLightboxUrl] = useState<string | null>(null);
  const [moodImages, setMoodImages] = useState<MoodImage[]>([]);

  const [cardHeights, setCardHeights] = useState<Record<string, number>>({});
  const [showImages, setShowImages] = useState(true);
  const sharedHeight = Math.max(160, ...Object.values(cardHeights));
  const handleContentHeight = useCallback((id: string, h: number) => {
    setCardHeights((prev) => {
      if (prev[id] === h) return prev;
      return { ...prev, [id]: h };
    });
  }, []);

  const moodImagesRef = useRef<MoodImage[]>([]);
  useEffect(() => {
    moodImagesRef.current = moodImages;
  }, [moodImages]);

  // ─── In-flight mood generation 동기화 ───
  // 탭 이동으로 AgentTab 이 unmount 된 동안 진행되던 generation 의 스켈레톤 + 도착한 URL 을
  // 모듈 store 에서 읽어와 moodImages 에 항상 반영해 둔다.
  useEffect(() => {
    const sync = () => {
      const gen = getMoodGen(projectId);
      if (!gen?.promise || gen.skeletonIds.length === 0) return;
      const skelSet = new Set(gen.skeletonIds);
      setMoodImages((prev) => {
        const existingNonSkel = prev.filter((img) => !skelSet.has(img.id));
        const existingSkelById = new Map(prev.filter((img) => skelSet.has(img.id)).map((img) => [img.id, img]));
        // skeletonIds 순서대로 placeholder 재구성, 도착한 URL 적용
        const reconstructed: MoodImage[] = gen.skeletonIds.map((id, i) => {
          const arrived = gen.arrivedUrls[i] ?? null;
          const exist = existingSkelById.get(id);
          if (exist && exist.url === arrived) return exist;
          return (
            exist
              ? { ...exist, url: arrived }
              : {
                  id,
                  url: arrived,
                  liked: false,
                  sceneRef: null,
                  comment: "",
                  createdAt: new Date().toISOString(),
                }
          );
        });
        return [...reconstructed, ...existingNonSkel];
      });
    };
    sync();
    return subscribeMoodGen(projectId, sync);
  }, [projectId]);

  const [pendingScenes, setPendingSceneState] = useState<ParsedScene[]>(
    () => _pendingScenesByProject.get(projectId) ?? loadPendingFromLS(projectId),
  );
  const setPendingScenes = useCallback(
    (val: ParsedScene[] | ((prev: ParsedScene[]) => ParsedScene[])) => {
      setPendingSceneState((prev) => {
        const next = typeof val === "function" ? val(prev) : val;
        _pendingScenesByProject.set(projectId, next);
        savePendingToLS(projectId, next);
        return next;
      });
    },
    [projectId],
  );

  const [briefAnalysis, setBriefAnalysis] = useState<Analysis | null>(null);
  const [briefLang, setBriefLang] = useState<"ko" | "en">(lang);
  const [isLoading, setIsLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [projectAssets, setProjectAssets] = useState<Asset[]>([]);
  const [showSendModal, setShowSendModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [replaceConfirmBuffer, setReplaceConfirmBuffer] = useState<ParsedScene[] | null>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [rightPanel, setRightPanel] = useState<RightPanel>("scenes");
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [splitView, setSplitView] = useState(false);
  const prevScenesLenRef = useRef<number | null>(null);
  const pendingOrderNotice = useRef<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [versions, setVersions] = useState<
    { id: string; version_name: string | null; version_number: number; scenes: any[] }[]
  >([]);
  const [showLoadModal, setShowLoadModal] = useState(false);

  const saveMoodImagesToDB = useCallback(
    async (images: MoodImage[]) => {
      const { data: brief } = await supabase
        .from("briefs")
        .select("id")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (brief)
        await supabase
          .from("briefs")
          .update({ mood_image_urls: images } as any)
          .eq("id", brief.id);
    },
    [projectId],
  );

  const fetchAssets = useCallback(async () => {
    const { data } = await supabase
      .from("assets")
      .select("tag_name,photo_url,ai_description,asset_type,role_description,outfit_description,space_description")
      .eq("project_id", projectId);
    if (data) setProjectAssets(data as Asset[]);
    return data as Asset[] | null;
  }, [projectId]);

  const fetchScenes = useCallback(async () => {
    const { data } = await supabase
      .from("scenes")
      .select("*")
      .eq("project_id", projectId)
      .eq("source", "agent")
      .order("scene_number", { ascending: true });
    if (data) setScenes(data as Scene[]);
  }, [projectId]);

  const fetchBrief = useCallback(async () => {
    const { data } = await supabase
      .from("briefs")
      .select("analysis,mood_image_urls,lang")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (data?.analysis) setBriefAnalysis(data.analysis as unknown as Analysis);
    if ((data as any)?.lang) setBriefLang((data as any).lang as "ko" | "en");
    if ((data as any)?.mood_image_urls) {
      const dbImages = toMoodImages((data as any).mood_image_urls as (string | MoodImage)[]);
      // In-flight generation 의 skeleton placeholder 가 있으면 앞에 보존
      const gen = getMoodGen(projectId);
      if (gen?.promise && gen.skeletonIds.length > 0) {
        const skelIdSet = new Set(gen.skeletonIds);
        const dbWithoutSkel = dbImages.filter((img) => !skelIdSet.has(img.id));
        const skeletons: MoodImage[] = gen.skeletonIds.map((id, i) => ({
          id,
          url: gen.arrivedUrls[i] ?? null,
          liked: false,
          sceneRef: null,
          comment: "",
          createdAt: new Date().toISOString(),
        }));
        setMoodImages([...skeletons, ...dbWithoutSkel]);
      } else {
        setMoodImages(dbImages);
      }
    }
    return data?.analysis ? (data.analysis as unknown as Analysis) : null;
  }, [projectId]);

  const handleSceneUpdate = useCallback(async (id: string, fields: Partial<Scene>) => {
    await supabase.from("scenes").update(fields).eq("id", id);
    setScenes((prev) => prev.map((s) => (s.id === id ? { ...s, ...fields } : s)));
  }, []);

  const handleAttachMoodToScene = useCallback(
    async (imageUrl: string, sceneId: string, moodImageId: string, sceneNumber: number) => {
      await supabase.from("scenes").update({ conti_image_url: imageUrl }).eq("id", sceneId);
      setScenes((prev) => prev.map((s) => (s.id === sceneId ? { ...s, conti_image_url: imageUrl } : s)));
      setMoodImages((prev) => {
        const next = prev.map((img) => (img.id === moodImageId ? { ...img, sceneRef: sceneNumber } : img));
        saveMoodImagesToDB(next);
        return next;
      });
    },
    [saveMoodImagesToDB],
  );

  const handleSceneDrop = useCallback(
    async (
      sceneId: string,
      sceneNumber: number,
      payload: { moodImageId: string; url: string },
    ) => {
      if (!payload?.url) return;
      await handleAttachMoodToScene(payload.url, sceneId, payload.moodImageId, sceneNumber);
      toast({ title: "Mood attached", description: `Scene ${sceneNumber} updated.` });
    },
    [handleAttachMoodToScene, toast],
  );

  const handleClearSceneImage = useCallback(
    async (scene: Scene) => {
      const prevUrl = scene.conti_image_url;
      await supabase.from("scenes").update({ conti_image_url: null }).eq("id", scene.id);
      setScenes((prev) => prev.map((s) => (s.id === scene.id ? { ...s, conti_image_url: null } : s)));
      setMoodImages((prev) => {
        const next = prev.map((img) =>
          img.url === prevUrl && img.sceneRef === scene.scene_number ? { ...img, sceneRef: null } : img,
        );
        saveMoodImagesToDB(next);
        return next;
      });
    },
    [saveMoodImagesToDB],
  );

  const handleDetachFromScene = useCallback(
    async (moodImageId: string, sceneNumber: number) => {
      const scene = scenes.find((s) => s.scene_number === sceneNumber);
      const img = moodImages.find((i) => i.id === moodImageId);
      if (scene && img && scene.conti_image_url === img.url) {
        await supabase.from("scenes").update({ conti_image_url: null }).eq("id", scene.id);
        setScenes((prev) => prev.map((s) => (s.id === scene.id ? { ...s, conti_image_url: null } : s)));
      }
      setMoodImages((prev) => {
        const next = prev.map((i) => (i.id === moodImageId ? { ...i, sceneRef: null } : i));
        saveMoodImagesToDB(next);
        return next;
      });
    },
    [scenes, moodImages, saveMoodImagesToDB],
  );

  const handleDeleteMoodImages = useCallback(
    async (ids: string[]) => {
      const idsSet = new Set(ids);
      const connectedSceneIds: string[] = [];
      for (const id of ids) {
        const img = moodImages.find((i) => i.id === id);
        if (img?.sceneRef !== null && img?.sceneRef !== undefined) {
          const scene = scenes.find((s) => s.scene_number === img.sceneRef && s.conti_image_url === img.url);
          if (scene) connectedSceneIds.push(scene.id);
        }
      }
      if (connectedSceneIds.length > 0) {
        await Promise.all(
          connectedSceneIds.map((sceneId) =>
            supabase.from("scenes").update({ conti_image_url: null }).eq("id", sceneId),
          ),
        );
        setScenes((prev) => prev.map((s) => (connectedSceneIds.includes(s.id) ? { ...s, conti_image_url: null } : s)));
      }
      setMoodImages((prev) => {
        const next = prev.filter((i) => !idsSet.has(i.id));
        saveMoodImagesToDB(next);
        return next;
      });
    },
    [moodImages, scenes, saveMoodImagesToDB],
  );

  const clearScenesAfterSend = useCallback(async () => {
    await supabase.from("scenes").delete().eq("project_id", projectId).eq("source", "agent");
    setScenes([]);
    setPendingScenes([]);
    const latest = moodImagesRef.current;
    if (latest.some((img) => img.sceneRef !== null)) {
      const cleared = latest.map((img) => ({ ...img, sceneRef: null }));
      setMoodImages(cleared);
      await saveMoodImagesToDB(cleared);
    }
  }, [projectId, setPendingScenes, saveMoodImagesToDB]);

  const fetchVersions = useCallback(async () => {
    const { data } = await supabase
      .from("scene_versions")
      .select("id,version_name,version_number,scenes")
      .eq("project_id", projectId)
      .order("display_order", { ascending: true });
    setVersions((data ?? []) as any[]);
    return (data ?? []) as any[];
  }, [projectId]);

  const handleLoadVersion = useCallback(
    async (versionScenes: any[]) => {
      await supabase.from("scenes").delete().eq("project_id", projectId);
      const storyScenes = versionScenes.filter((s: any) => s.is_transition !== true && !s.transition_type);
      const toInsert = storyScenes.map((s: any, i: number) => ({
        project_id: projectId,
        scene_number: i + 1,
        title: s.title ?? `씬 ${i + 1}`,
        description: s.description ?? "",
        camera_angle: s.camera_angle ?? "",
        location: s.location ?? "",
        mood: s.mood ?? "",
        duration_sec: s.duration_sec ?? null,
        tagged_assets: s.tagged_assets ?? [],
        conti_image_url: null,
        source: "agent",
      }));
      const { data } = await supabase.from("scenes").insert(toInsert).select();
      if (data) setScenes(data as Scene[]);
      setPendingScenes([]);
      toast({ title: "Version loaded. Keep growing with YD." });
    },
    [projectId, setPendingScenes, toast],
  );

  const saveScenesToDB = useCallback(
    async (parsed: ParsedScene[], mode: "replace" | "append") => {
      const newScenes = parsed
        .filter((s) => s.scene_number && typeof s.scene_number === "number")
        .map((s) => {
          const jsonTags = (Array.isArray(s.tagged_assets) ? s.tagged_assets : []).map((t: string) =>
            t.startsWith("@") ? t : `@${t}`,
          );
          const extractNormalized = (text: string) =>
            (text.match(/@([\w가-힣]+)/g) ?? [])
              .map((m) => {
                const r = resolveAsset(m, projectAssets);
                return r ? `@${r.name}` : null;
              })
              .filter((n): n is string => n !== null);
          const allRaw = [
            ...new Set([
              ...jsonTags,
              ...extractNormalized(s.description ?? ""),
              ...extractNormalized(s.location ?? ""),
            ]),
          ];
          const registeredTags =
            projectAssets.length > 0
              ? allRaw.filter((tag) => {
                  const raw = tag.startsWith("@") ? tag.slice(1) : tag;
                  return projectAssets.some((a) => {
                    const an = a.tag_name.startsWith("@") ? a.tag_name.slice(1) : a.tag_name;
                    return an === raw;
                  });
                })
              : allRaw;
          return {
            project_id: projectId,
            scene_number: s.scene_number,
            title: s.title ?? `씬 ${s.scene_number}`,
            description: s.description ?? "",
            camera_angle: s.camera_angle ?? "",
            location: s.location ?? "",
            mood: s.mood ?? "",
            duration_sec: typeof s.duration_sec === "number" ? s.duration_sec : null,
            tagged_assets: registeredTags,
          };
        });
      if (!newScenes.length) return;
      if (mode === "replace") {
        await supabase.from("scenes").delete().eq("project_id", projectId).eq("source", "agent");
        const { error } = await supabase.from("scenes").insert(newScenes.map((s) => ({ ...s, source: "agent" })));
        if (error) {
          toast({ title: "Failed to save scenes", description: error.message, variant: "destructive" });
          return;
        }
      } else {
        const { data: existing } = await supabase
          .from("scenes")
          .select("scene_number")
          .eq("project_id", projectId)
          .order("scene_number", { ascending: false })
          .limit(1);
        const offset = existing?.[0]?.scene_number ?? 0;
        const { error } = await supabase
          .from("scenes")
          .insert(newScenes.map((s, i) => ({ ...s, scene_number: offset + i + 1, source: "agent" })));
        if (error) {
          toast({ title: "Failed to save scenes", description: error.message, variant: "destructive" });
          return;
        }
      }
      await fetchScenes();
    },
    [projectId, fetchScenes, projectAssets, toast],
  );

  const handleConfirmScenes = useCallback(
    async (mode: "replace" | "append") => {
      if (!pendingScenes.length) return;
      await saveScenesToDB(pendingScenes, mode);
      setPendingScenes([]);
      toast({ title: `${pendingScenes.length} scene${pendingScenes.length > 1 ? "s" : ""} confirmed.` });
    },
    [pendingScenes, saveScenesToDB, toast, setPendingScenes],
  );

  const handleClickConfirm = useCallback(() => {
    if (scenes.length > 0) setShowConfirmModal(true);
    else handleConfirmScenes("replace");
  }, [scenes.length, handleConfirmScenes]);

  const handleReplaceConfirm = useCallback(async () => {
    if (!replaceConfirmBuffer) return;
    await supabase.from("scenes").delete().eq("project_id", projectId);
    setScenes([]);
    setPendingScenes(replaceConfirmBuffer);
    setReplaceConfirmBuffer(null);
  }, [replaceConfirmBuffer, projectId, setPendingScenes]);

  useEffect(() => {
    const load = async () => {
      const [chatRes] = await Promise.all([
        supabase.from("chat_logs").select("*").eq("project_id", projectId).order("created_at", { ascending: true }),
        fetchScenes(),
      ]);
      const [analysis, assets] = await Promise.all([fetchBrief(), fetchAssets()]);
      if (chatRes.data?.length) {
        setChatHistory(chatRes.data as ChatLog[]);
        setInitialLoaded(true);
        return;
      }
      setInitialLoaded(true);
      if (analysis) {
        setIsLoading(true);
        try {
          const briefCtx = buildBriefContextString(analysis);
          const autoPrompt = `[브리프 분석 결과]\n${briefCtx}\n\n이 브리프를 바탕으로 방향성이 다른 시놉시스 2~3안을 storylines 블록으로 제안해주세요. 아직 씬은 짜지 마세요.`;
          await supabase.from("chat_logs").insert({ project_id: projectId, role: "user", content: autoPrompt });
          const { data: briefRow } = await supabase
            .from("briefs")
            .select("lang")
            .eq("project_id", projectId)
            .order("created_at", { ascending: false })
            .limit(1)
            .single();
          const initLang = ((briefRow as any)?.lang ?? "ko") as "ko" | "en";
          const data = await callClaude({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            system: buildSystemPrompt(videoFormat, assets ?? undefined, analysis, initLang),
            messages: [{ role: "user", content: autoPrompt }],
          });
          const msg = data.content[0].text;
          await supabase.from("chat_logs").insert({ project_id: projectId, role: "assistant", content: msg });
          const extracted = extractScenesFromText(msg);
          if (extracted.length > 0) setPendingScenes(extracted);
          setChatHistory([
            { project_id: projectId, role: "user", content: autoPrompt, created_at: new Date().toISOString() },
            { project_id: projectId, role: "assistant", content: msg, created_at: new Date().toISOString() },
          ]);
        } catch (err) {
          console.error("Auto-init error:", err);
        } finally {
          setIsLoading(false);
        }
      }
    };
    load();
  }, [projectId, fetchScenes, fetchBrief, fetchAssets]);

  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      setUserScrolledUp(scrollTop + clientHeight < scrollHeight - 100);
    };
    container.addEventListener("scroll", onScroll);
    return () => container.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!userScrolledUp && (isLoading || chatHistory.length > 0))
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, isLoading, userScrolledUp]);

  useEffect(() => {
    if (prevScenesLenRef.current === null) {
      prevScenesLenRef.current = scenes.length;
      return;
    }
    if (
      prevScenesLenRef.current === 0 &&
      scenes.length > 0 &&
      !chatCollapsed &&
      !isMobile
    ) {
      setChatCollapsed(true);
    }
    prevScenesLenRef.current = scenes.length;
  }, [scenes.length, chatCollapsed, isMobile]);

  const addImages = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files)
        .filter((f) => f.type.startsWith("image/"))
        .slice(0, 4 - chatImages.length);
      if (!arr.length) return;
      const converted = await Promise.all(arr.map(fileToBase64));
      setChatImages((prev) => [...prev, ...converted].slice(0, 4));
    },
    [chatImages.length],
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files?.length) addImages(e.dataTransfer.files);
  };

  // ✅ [FIX] handleSend — 매 전송마다 briefAnalysis DB re-fetch
  const handleSend = async (directText?: string) => {
    const rawText = directText ?? "";
    const orderNotice = pendingOrderNotice.current;
    pendingOrderNotice.current = null;
    const text = orderNotice ? `${orderNotice}\n\n${rawText}`.trim() : rawText.trim();
    if (!text || isLoading) return;
    setIsLoading(true);
    const createdAt = new Date().toISOString();
    const currentImages = [...chatImages];
    // NOTE: chat UI / chat_logs DB 에는 사용자가 타이핑한 원본 `text` 그대로 저장.
    //       LLM payload 에만 에셋 활용 체크리스트를 prepend 해서 순응도를 강제한다.
    //       (latestAssets 는 아래 try 블록 안에서 fetch 후 실제 주입됨 → 여기서는 플레이스홀더)
    setChatHistory((prev) => [...prev, { project_id: projectId, role: "user", content: text, created_at: createdAt }]);
    if (currentImages.length > 0)
      sessionImageMap.set(
        createdAt,
        currentImages.map((i) => i.preview),
      );
    setChatImages([]);
    try {
      // ✅ assets와 briefAnalysis 동시 re-fetch
      const [latestAssets, latestAnalysis] = await Promise.all([fetchAssets(), fetchBrief()]);
      await supabase.from("chat_logs").insert({ project_id: projectId, role: "user", content: text });

      // LLM payload 용 텍스트: 등록 에셋이 있으면 체크리스트를 사용자 메시지 앞에 prepend.
      // chat UI / DB 에는 영향 없고 이번 API 호출에만 사용됨.
      const assetReminder = buildAssetUsageReminder(latestAssets ?? [], briefLang);
      const textForLLM = assetReminder ? `${assetReminder}\n[사용자 요청]\n${text}` : text;
      const userApiContent: any =
        currentImages.length > 0
          ? [
              ...currentImages.map((img) => ({
                type: "image",
                source: { type: "base64", media_type: img.mediaType, data: img.base64 },
              })),
              { type: "text", text: textForLLM },
            ]
          : textForLLM;

      // ✅ Mirror the cumulative storyline-ID remap that the UI applies, so the LLM
      //    sees the same A/B/C → D/E/F numbering the user is looking at.
      const cumulativeIds = new Set<string>();
      const history = chatHistory.map((c) => {
        if (c.role === "assistant") {
          return { role: c.role, content: remapMessageForHistory(c.content, cumulativeIds) };
        }
        return { role: c.role, content: c.content };
      });
      if (!history.length && (latestAnalysis ?? briefAnalysis))
        history.push({
          role: "user" as const,
          content: `[브리프 분석 결과]\n${buildBriefContextString(latestAnalysis ?? briefAnalysis!)}`,
        });
      history.push({ role: "user" as const, content: userApiContent });
      const data = await callClaude({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        // ✅ 최신 briefAnalysis 사용, 없으면 state 값 폴백
        system: buildSystemPrompt(videoFormat, latestAssets ?? undefined, latestAnalysis ?? briefAnalysis, briefLang),
        messages: history,
      });
      const assistantContent = data.content[0].text;
      await supabase.from("chat_logs").insert({ project_id: projectId, role: "assistant", content: assistantContent });
      setChatHistory((prev) => [
        ...prev,
        { project_id: projectId, role: "assistant", content: assistantContent, created_at: new Date().toISOString() },
      ]);
      const extracted = extractScenesFromText(assistantContent);
      if (extracted.length > 0) {
        if (scenes.length > 0) {
          setReplaceConfirmBuffer(extracted);
        } else {
          setPendingScenes((prev) => {
            if (prev.length === 0) return extracted;
            const updated = [...prev];
            for (const ext of extracted) {
              const idx = updated.findIndex((p) => p.scene_number === ext.scene_number);
              if (idx >= 0) updated[idx] = ext;
              else updated.push(ext);
            }
            if (extracted.length >= prev.length && extracted.length > 1) return extracted;
            return updated.sort((a, b) => a.scene_number - b.scene_number);
          });
        }
      }
    } catch (err: any) {
      toast({ title: "Failed to send message", description: err.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const reordered = arrayMove(
      scenes,
      scenes.findIndex((s) => s.id === active.id),
      scenes.findIndex((s) => s.id === over.id),
    ).map((s, i) => ({ ...s, scene_number: i + 1 }));
    setScenes(reordered);
    await Promise.all(
      reordered.map((s) => supabase.from("scenes").update({ scene_number: s.scene_number }).eq("id", s.id)),
    );
    pendingOrderNotice.current = `[씬 순서 변경]\n${reordered.map((s) => `${s.scene_number}. ${s.title || `Scene ${s.scene_number}`}`).join("\n")}\n\n스토리 흐름이 자연스러운지 확인해주세요.`;
    toast({ title: "Scene order updated." });
  };

  const handleDeleteScene = async (id: string) => {
    const deletedScene = scenes.find((s) => s.id === id);
    await supabase.from("scenes").delete().eq("id", id);
    if (deletedScene) {
      setMoodImages((prev) => {
        const next = prev.map((img) => (img.sceneRef === deletedScene.scene_number ? { ...img, sceneRef: null } : img));
        if (next.some((img, i) => img !== prev[i])) saveMoodImagesToDB(next);
        return next;
      });
    }
    await fetchScenes();
  };
  const [newSceneId, setNewSceneId] = useState<string | null>(null);

  const handleAddScene = async () => {
    const tempNumber = 90000 + (Date.now() % 10000);
    const nextNum = scenes.reduce((max, scene) => Math.max(max, scene.scene_number), 0) + 1;
    const { data, error } = await supabase
      .from("scenes")
      .insert({
        project_id: projectId,
        scene_number: tempNumber,
        title: `Scene ${nextNum}`,
        description: null,
        camera_angle: null,
        location: null,
        mood: null,
        duration_sec: null,
        tagged_assets: [],
        conti_image_url: null,
        source: "agent",
      })
      .select()
      .single();
    if (error || !data) {
      toast({ title: "Failed to add scene", description: error?.message, variant: "destructive" });
      return;
    }
    const updated = [...scenes, data as Scene];
    const renumbered = updated.map((scene, index) => ({ ...scene, scene_number: index + 1 }));
    setNewSceneId(data.id);
    setScenes(renumbered);
    setTimeout(() => setNewSceneId(null), 400);
    const tempRenumbered = renumbered.map((scene, index) => ({ ...scene, scene_number: 80000 + index }));
    await Promise.all(
      tempRenumbered.map((scene) =>
        supabase.from("scenes").update({ scene_number: scene.scene_number }).eq("id", scene.id),
      ),
    );
    await Promise.all(
      renumbered.map((scene) =>
        supabase.from("scenes").update({ scene_number: scene.scene_number }).eq("id", scene.id),
      ),
    );
  };

  const handleInsertSceneAt = async (insertIdx: number) => {
    const tempNumber = 90000 + (Date.now() % 10000);
    const { data, error } = await supabase
      .from("scenes")
      .insert({
        project_id: projectId,
        scene_number: tempNumber,
        title: `Scene ${insertIdx + 1}`,
        description: null,
        camera_angle: null,
        location: null,
        mood: null,
        duration_sec: null,
        tagged_assets: [],
        conti_image_url: null,
        source: "agent",
      })
      .select()
      .single();
    if (error || !data) {
      toast({ title: "Failed to insert scene", description: error?.message, variant: "destructive" });
      return;
    }
    const updated = [...scenes];
    updated.splice(insertIdx, 0, data as Scene);
    const renumbered = updated.map((scene, index) => ({ ...scene, scene_number: index + 1 }));
    setNewSceneId(data.id);
    setScenes(renumbered);
    setTimeout(() => setNewSceneId(null), 400);
    const tempRenumbered = renumbered.map((scene, index) => ({ ...scene, scene_number: 80000 + index }));
    await Promise.all(
      tempRenumbered.map((scene) =>
        supabase.from("scenes").update({ scene_number: scene.scene_number }).eq("id", scene.id),
      ),
    );
    await Promise.all(
      renumbered.map((scene) =>
        supabase.from("scenes").update({ scene_number: scene.scene_number }).eq("id", scene.id),
      ),
    );
  };

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const displayMessages: ChatLog[] =
    initialLoaded && !chatHistory.length && !isLoading
      ? [{ project_id: projectId, role: "assistant", content: WELCOME_NO_BRIEF, created_at: new Date().toISOString() }]
      : chatHistory.map((m) =>
          m.role === "user" && isBriefAnalysisMsg(m.content) ? { ...m, role: "assistant" as const } : m,
        );

  const CdAvatar = ({ size = "w-8 h-8", iconSize = 18 }: { size?: string; iconSize?: number }) => (
    <div
      className={`${size} flex items-center justify-center text-white font-bold shrink-0`}
      style={{ background: KR, borderRadius: 3 }}
    >
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    </div>
  );

  const handleMoodToChat = useCallback((url: string) => {
    fetch(url)
      .then((r) => r.blob())
      .then((b) => fileToBase64(new File([b], "mood.jpg", { type: "image/jpeg" })))
      .then((img) => setChatImages((prev) => [...prev, img].slice(0, 4)));
    setRightPanel("scenes");
  }, []);

  const chatPanel = (
    <div
      className="flex flex-col h-full relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded pointer-events-none"
          style={{ background: KR_BG, border: `2px dashed ${KR}` }}
        >
          <ImagePlus className="w-10 h-10 mb-2" style={{ color: KR }} />
          <span className="text-[14px] font-semibold" style={{ color: KR }}>
            Drop images here
          </span>
        </div>
      )}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <CdAvatar />
          <div>
            <div className="text-[12px] font-bold tracking-wide text-foreground">YD</div>
            <div className="font-mono text-[9px] text-muted-foreground/50">Creative Direction Agent · Active</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="font-mono text-[9px] text-muted-foreground/30 uppercase border border-border px-2 py-0.5"
            style={{ borderRadius: 2 }}
          >
            V 4.2.0
          </span>
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-none bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-none h-1.5 w-1.5 bg-green-500" />
          </span>
          {!isMobile && (
            <button
              onClick={() => setChatCollapsed(true)}
              title="채팅 접기"
              style={{
                marginLeft: 4,
                width: 24,
                height: 24,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "1px solid hsl(var(--border))",
                color: "rgba(255,255,255,0.55)",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.color = "#fff";
                (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.55)";
                (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
            >
              <PanelLeftClose style={{ width: 13, height: 13 }} />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={chatContainerRef}>
        {(() => {
          const cumulativeIds = new Set<string>();
          return displayMessages.map((msg, i) => {
            const parsedSegments = msg.role === "assistant" && !isBriefAnalysisMsg(msg.content)
              ? parseMessageSegments(msg.content, cumulativeIds)
              : undefined;

            if (parsedSegments) {
              for (const seg of parsedSegments) {
                if (seg.type === "storylines" && Array.isArray(seg.options)) {
                  seg.options.forEach((o: any) => cumulativeIds.add(String(o.id).toUpperCase()));
                }
              }
            }

            return (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && <CdAvatar size="w-6 h-6" iconSize={14} />}
                {msg.role === "assistant" && <div className="mr-2" />}
                <div className="max-w-[85%]">
                  {msg.role === "user" && msg.created_at && sessionImageMap.get(msg.created_at)?.length ? (
                    <div className="flex flex-wrap gap-1.5 mb-1.5 justify-end">
                      {sessionImageMap.get(msg.created_at)!.map((url, j) => (
                        <img key={j} src={url} className="h-16 w-16 object-cover rounded-none border border-border" />
                      ))}
                    </div>
                  ) : null}
                  <div
                    className={`px-3.5 py-2.5 text-[14px] leading-relaxed ${msg.role === "user" ? "text-foreground" : "bg-card text-foreground border border-border"}`}
                    style={
                      msg.role === "user"
                        ? { background: "rgba(249,66,58,0.06)", border: "1px solid rgba(249,66,58,0.15)", borderRadius: 0 }
                        : { borderRadius: 0 }
                    }
                  >
                    <MessageContent content={msg.content} assets={projectAssets} onSend={handleSend} segments={parsedSegments} />
                  </div>
                  <div className={`text-[11px] text-muted-foreground mt-1 ${msg.role === "user" ? "text-right" : ""}`}>
                    {formatTime(msg.created_at)}
                  </div>
                </div>
              </div>
            );
          });
        })()}
        {isLoading && (
          <div className="flex justify-start">
            <CdAvatar size="w-6 h-6" iconSize={14} />
            <div className="ml-2">
              <div className="bg-secondary rounded rounded-tl-none border border-border px-4 py-3 flex items-center gap-1">
                {[0, 1, 2].map((j) => (
                  <span
                    key={j}
                    className="w-1.5 h-1.5 rounded-none animate-bounce"
                    style={{ background: KR, animationDelay: `${j * 150}ms` }}
                  />
                ))}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">YD is crafting your scenario...</div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      {chatImages.length > 0 && (
        <div className="px-4 pt-3 pb-1 flex items-center gap-2 shrink-0">
          {chatImages.map((img, i) => (
            <div key={i} className="relative group shrink-0">
              <img
                src={img.preview}
                className="rounded-none object-cover border border-border"
                style={{ width: 52, height: 52 }}
              />
              <div className="absolute inset-0 rounded-none bg-black/0 group-hover:bg-black/30 transition-colors" />
              <button
                onClick={() => setChatImages((prev) => prev.filter((_, j) => j !== i))}
                className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: "none", border: "none", cursor: "pointer" }}
              >
                <div className="w-5 h-5 rounded-none bg-black/60 flex items-center justify-center">
                  <X className="w-3 h-3 text-white" />
                </div>
              </button>
            </div>
          ))}
          {chatImages.length < 4 && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 flex flex-col items-center justify-center rounded-none border border-dashed border-border text-muted-foreground/50 hover:border-[#f9423a] hover:text-[#f9423a] transition-colors"
              style={{ width: 52, height: 52, background: "transparent" }}
            >
              <Plus className="w-4 h-4" />
              <span style={{ fontSize: 9, marginTop: 2 }}>{chatImages.length}/4</span>
            </button>
          )}
        </div>
      )}
      <div className="shrink-0 border-t border-border px-3 py-2.5">
        <AgentChatInput
          assets={projectAssets}
          projectId={projectId}
          disabled={isLoading}
          hasImages={chatImages.length > 0}
          onSend={handleSend}
          onAttach={() => fileInputRef.current?.click()}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addImages(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );

  const rightPanelContent = (
    <div className="flex flex-col h-full">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "10px 14px",
          borderBottom: "1px solid hsl(var(--border))",
          flexShrink: 0,
          overflowX: "auto",
        }}
      >
        <div
          role="tablist"
          aria-label="Right panel"
          style={{
            display: "inline-flex",
            gap: 4,
            padding: 3,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid hsl(var(--border))",
            flexShrink: 0,
            opacity: splitView ? 0.55 : 1,
            transition: "opacity 0.15s",
          }}
        >
          {(["scenes", "mood"] as RightPanel[]).map((p) => {
            const active = !splitView && rightPanel === p;
            const Icon = p === "scenes" ? Layers : Palette;
            const label = p === "scenes" ? "Scene Composition" : "Mood Ideation";
            const count = p === "scenes" ? scenes.length : moodImages.length;
            return (
              <button
                key={p}
                role="tab"
                aria-selected={active}
                onClick={() => {
                  if (splitView) setSplitView(false);
                  setRightPanel(p);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  height: 36,
                  padding: "0 14px",
                  fontSize: 13.5,
                  fontWeight: 700,
                  letterSpacing: "0.02em",
                  color: active ? "#fff" : "rgba(255,255,255,0.55)",
                  background: active ? "rgba(249,66,58,0.16)" : "transparent",
                  border: active
                    ? "1px solid rgba(249,66,58,0.45)"
                    : "1px solid transparent",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (!active) (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.85)";
                }}
                onMouseLeave={(e) => {
                  if (!active) (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.55)";
                }}
              >
                <Icon
                  style={{
                    width: 14,
                    height: 14,
                    color: active ? KR : "currentColor",
                  }}
                />
                <span>{label}</span>
                <span
                  className="font-mono"
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "1px 6px",
                    background: active ? "rgba(249,66,58,0.22)" : "rgba(255,255,255,0.08)",
                    color: active ? KR : "rgba(255,255,255,0.5)",
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {!isMobile && (
          <button
            onClick={() => setSplitView((v) => !v)}
            title={splitView ? "단일 보기로 전환" : "Scene + Mood 동시 보기"}
            aria-pressed={splitView}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 32,
              padding: "0 12px",
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: "0.04em",
              color: splitView ? KR : "rgba(255,255,255,0.55)",
              background: splitView ? "rgba(249,66,58,0.10)" : "transparent",
              border: splitView
                ? "1px solid rgba(249,66,58,0.45)"
                : "1px solid hsl(var(--border))",
              cursor: "pointer",
              transition: "all 0.15s",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              if (!splitView) {
                (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.85)";
                (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
              }
            }}
            onMouseLeave={(e) => {
              if (!splitView) {
                (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.55)";
                (e.currentTarget as HTMLElement).style.background = "transparent";
              }
            }}
          >
            <Columns2 style={{ width: 13, height: 13 }} />
            <span>{splitView ? "Split On" : "Split"}</span>
          </button>
        )}
      </div>

      {(() => {
      const scenesBody = (
        <div className="flex flex-col flex-1 min-h-0">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 12px",
              borderBottom: "0.5px solid hsl(var(--border))",
              background: "hsl(var(--background))",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {scenes.some((s) => s.duration_sec) && (
                <span
                  className="font-mono"
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  Total {scenes.reduce((a, s) => a + (s.duration_sec ?? 0), 0)}s
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button
                onClick={() => setShowImages((v) => !v)}
                title={showImages ? "Hide images" : "Show images"}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {showImages ? (
                  <Image style={{ width: 14, height: 14 }} />
                ) : (
                  <ImageOff style={{ width: 14, height: 14 }} />
                )}
              </button>
              <div style={{ width: 1, height: 16, background: "hsl(var(--border))" }} />
              <button
                onClick={async () => {
                  await fetchVersions();
                  setShowLoadModal(true);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  height: 28,
                  padding: "0 10px",
                  borderRadius: 0,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  border: "0.5px solid hsl(var(--border))",
                  background: "transparent",
                  color: "hsl(var(--muted-foreground))",
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "hsl(var(--muted))")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
              >
                <RotateCcw style={{ width: 12, height: 12 }} />
                Load Version
              </button>
              <div style={{ width: 1, height: 16, background: "hsl(var(--border))" }} />
              <button
                onClick={handleAddScene}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  height: 28,
                  padding: "0 10px",
                  borderRadius: 0,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  border: "0.5px solid hsl(var(--border))",
                  background: "transparent",
                  color: "hsl(var(--muted-foreground))",
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "hsl(var(--muted))")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
              >
                <Plus style={{ width: 12, height: 12 }} />
                Add Scene
              </button>
              <button
                onClick={() => setShowSendModal(true)}
                disabled={!scenes.length}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  height: 28,
                  padding: "0 12px",
                  borderRadius: 0,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  background: scenes.length ? KR : "hsl(var(--muted))",
                  color: scenes.length ? "#fff" : "hsl(var(--muted-foreground))",
                  border: "none",
                  cursor: scenes.length ? "pointer" : "not-allowed",
                }}
              >
                <Send style={{ width: 12, height: 12 }} />
                Send to Conti
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {pendingScenes.length > 0 && (
              <div className="rounded border-2 overflow-visible" style={{ borderColor: KR, background: KR_BG }}>
                <div
                  className="flex items-center justify-between px-4 py-2.5"
                  style={{ borderBottom: `1px solid ${KR_BORDER2}` }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-bold" style={{ color: KR }}>
                      {pendingScenes.length} DRAFT SCENES
                    </span>
                    <span className="text-[11px] text-muted-foreground">Click to edit</span>
                  </div>
                  <button
                    onClick={() => setPendingScenes([])}
                    style={{ background: "none", border: "none", cursor: "pointer" }}
                  >
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </div>
                <div className="p-3 space-y-2">
                  {pendingScenes.map((s) => (
                    <EditablePendingSceneCard
                      key={s.scene_number}
                      scene={s}
                      assets={projectAssets}
                      projectId={projectId}
                      onUpdate={(updated) =>
                        setPendingScenes((prev) => prev.map((p) => (p.scene_number === s.scene_number ? updated : p)))
                      }
                    />
                  ))}
                </div>
                <div className="px-3 pb-3">
                  <button
                    onClick={handleClickConfirm}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-none text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
                    style={{ background: KR, border: "none", cursor: "pointer" }}
                  >
                    <Check className="w-4 h-4" />Create scene cards from this draft
                  </button>
                </div>
              </div>
            )}
            {!scenes.length && !pendingScenes.length ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[300px]">
                <Clapperboard className="w-10 h-10 text-border mb-3" />
                <p className="text-sm text-muted-foreground">No scenes yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Chat with YD to start building scenes</p>
              </div>
            ) : scenes.length > 0 ? (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={scenes.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                  {pendingScenes.length > 0 && (
                    <div className="flex items-center gap-2 py-1">
                      <div className="flex-1 h-px bg-border/50" />
                      <span className="text-[10px] text-muted-foreground/50">Confirmed scenes</span>
                      <div className="flex-1 h-px bg-border/50" />
                    </div>
                  )}
                  {scenes.map((scene, idx) => (
                    <React.Fragment key={scene.id}>
                      {idx > 0 && (
                        <div
                          style={{
                            position: "relative",
                            height: 8,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                          className="group/insert"
                        >
                          <div
                            className="opacity-0 group-hover/insert:opacity-100 transition-opacity"
                            style={{
                              position: "absolute",
                              left: 0,
                              right: 0,
                              top: "50%",
                              height: 1,
                              background: `linear-gradient(to right, transparent, ${KR} 15%, ${KR} 85%, transparent)`,
                              transform: "translateY(-50%)",
                              pointerEvents: "none",
                            }}
                          />
                          <button
                            onClick={() => handleInsertSceneAt(idx)}
                            className="opacity-0 group-hover/insert:opacity-100 transition-opacity"
                            style={{
                              position: "absolute",
                              top: "50%",
                              left: "50%",
                              transform: "translate(-50%, -50%)",
                              zIndex: 10,
                              width: 24,
                              height: 24,
                              minWidth: 24,
                              minHeight: 24,
                              borderRadius: "9999px",
                              aspectRatio: "1 / 1",
                              background: KR,
                              color: "#fff",
                              border: "none",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              padding: 0,
                              boxSizing: "border-box",
                            }}
                          >
                            <Plus style={{ width: 12, height: 12 }} />
                          </button>
                        </div>
                      )}
                      <div
                        style={{
                          transition: "transform 0.3s ease, opacity 0.3s ease",
                          ...(scene.id === newSceneId ? { animation: "fadeIn 0.35s ease forwards" } : {}),
                        }}
                      >
                        <SortableSceneCard
                          scene={scene}
                          onDelete={(id) => setDeleteConfirmId(id)}
                          onUpdate={handleSceneUpdate}
                          onClearImage={handleClearSceneImage}
                          assets={projectAssets}
                          onLightboxMood={(url) => setMoodLightboxUrl(url)}
                          videoFormat={videoFormat}
                          sharedHeight={sharedHeight}
                          onContentHeight={handleContentHeight}
                          showImages={showImages}
                          onDropMoodImage={handleSceneDrop}
                        />
                      </div>
                    </React.Fragment>
                  ))}
                </SortableContext>
              </DndContext>
            ) : null}
            <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Scene</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete this scene? This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      if (deleteConfirmId) {
                        handleDeleteScene(deleteConfirmId);
                        setDeleteConfirmId(null);
                      }
                    }}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      );
      const moodBody = (
        <MoodIdeationPanel
          projectId={projectId}
          briefAnalysis={briefAnalysis}
          scenes={scenes}
          assets={projectAssets}
          videoFormat={videoFormat}
          moodImages={moodImages}
          setMoodImages={setMoodImages}
          saveMoodImagesToDB={saveMoodImagesToDB}
          onSendToChat={handleMoodToChat}
          onAttachToScene={handleAttachMoodToScene}
          onDetachFromScene={handleDetachFromScene}
          onDeleteMoodImages={handleDeleteMoodImages}
        />
      );
      if (splitView && !isMobile) {
        return (
          <ResizablePanelGroup direction="vertical" className="flex-1">
            <ResizablePanel defaultSize={58} minSize={20}>
              <div className="h-full flex flex-col overflow-hidden">{scenesBody}</div>
            </ResizablePanel>
            <ResizableHandle
              className="!bg-transparent h-1"
              style={{
                background:
                  "linear-gradient(to right, transparent, hsl(var(--border)) 20%, hsl(var(--border)) 80%, transparent)",
              }}
            />
            <ResizablePanel defaultSize={42} minSize={20}>
              <div className="h-full flex flex-col overflow-hidden">{moodBody}</div>
            </ResizablePanel>
          </ResizablePanelGroup>
        );
      }
      return rightPanel === "scenes" ? scenesBody : moodBody;
      })()}
    </div>
  );

  const modals = (
    <>
      {showSendModal && (
        <SendToContiModal
          scenes={scenes}
          projectId={projectId}
          onClose={() => setShowSendModal(false)}
          onSent={async (_, name) => {
            toast({ title: `"${name}" sent successfully` });
            await clearScenesAfterSend();
            onSwitchToContiTab?.();
          }}
        />
      )}
      {showConfirmModal && (
        <ConfirmScenesModal
          pendingCount={pendingScenes.length}
          existingCount={scenes.length}
          onClose={() => setShowConfirmModal(false)}
          onConfirm={handleConfirmScenes}
        />
      )}
      {showLoadModal && (
        <LoadVersionModal versions={versions} onClose={() => setShowLoadModal(false)} onLoad={handleLoadVersion} />
      )}
      {replaceConfirmBuffer && (
        <Dialog open onOpenChange={(o) => !o && setReplaceConfirmBuffer(null)}>
          <DialogContent className="max-w-[400px] bg-card border-border">
            <DialogHeader>
              <DialogTitle>Replace with new draft?</DialogTitle>
            </DialogHeader>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              YD has proposed <strong className="text-foreground">{replaceConfirmBuffer.length}</strong> new
              draft scene{replaceConfirmBuffer.length > 1 ? "s" : ""}.
              <br />
              Your <strong className="text-foreground">{scenes.length}</strong> currently confirmed scene
              {scenes.length > 1 ? "s" : ""} will be deleted.
            </p>
            <div className="text-[11px] text-muted-foreground/60 bg-muted rounded-none px-3 py-2 mt-1">
              💡 Final commit happens when you turn the draft into scene cards.
            </div>
            <DialogFooter className="gap-2 mt-1">
              <Button variant="ghost" onClick={() => setReplaceConfirmBuffer(null)}>
                Cancel
              </Button>
              <Button onClick={handleReplaceConfirm} className="gap-1.5 text-white" style={{ background: KR }}>
                <Check className="w-3.5 h-3.5" />
                Replace
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {moodLightboxUrl && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.85)" }}
          onClick={() => setMoodLightboxUrl(null)}
        >
          <button
            onClick={() => setMoodLightboxUrl(null)}
            className="absolute top-4 right-4"
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.15)",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X className="w-5 h-5 text-white" />
          </button>
          <img
            src={moodLightboxUrl}
            alt="mood"
            style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 8 }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );

  const chatRail = (
    <div
      style={{
        width: 44,
        flexShrink: 0,
        background: "rgba(255,255,255,0.02)",
        borderRight: "1px solid hsl(var(--border))",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <button
        onClick={() => setChatCollapsed(false)}
        title="채팅 펼치기"
        style={{
          width: "100%",
          height: 44,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: "none",
          borderBottom: "1px solid hsl(var(--border))",
          color: "rgba(255,255,255,0.7)",
          cursor: "pointer",
          transition: "all 0.15s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.color = KR;
          (e.currentTarget as HTMLElement).style.background = "rgba(249,66,58,0.08)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.7)";
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }}
      >
        <PanelLeftOpen style={{ width: 16, height: 16 }} />
      </button>
      <button
        onClick={() => setChatCollapsed(false)}
        title="채팅 펼치기"
        style={{
          flex: 1,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          background: "transparent",
          border: "none",
          color: "rgba(255,255,255,0.55)",
          cursor: "pointer",
          padding: "16px 0",
          transition: "color 0.15s",
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.95)")}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.55)")}
      >
        <MessageSquare style={{ width: 14, height: 14 }} />
        <span
          className="font-mono"
          style={{
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
          }}
        >
          Chat with YD
        </span>
        {chatHistory.length > 0 && (
          <span
            className="font-mono"
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: "2px 5px",
              background: "rgba(249,66,58,0.14)",
              color: KR,
              border: "1px solid rgba(249,66,58,0.3)",
            }}
          >
            {chatHistory.length}
          </span>
        )}
      </button>
    </div>
  );

  if (isMobile) {
    return (
      <div className="flex flex-col h-full">
        <div style={{ height: "60vh" }}>{chatPanel}</div>
        <div className="border-t border-border" style={{ height: "40vh" }}>
          {rightPanelContent}
        </div>
        {modals}
      </div>
    );
  }

  return (
    <div className="h-full">
      {chatCollapsed ? (
        <div className="flex h-full">
          {chatRail}
          <div className="flex-1 min-w-0">{rightPanelContent}</div>
        </div>
      ) : (
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={38} minSize={28}>
            {chatPanel}
          </ResizablePanel>
          <ResizableHandle
            className="!bg-transparent w-1 transition-colors"
            style={{
              background:
                "linear-gradient(to bottom, transparent, hsl(var(--border)) 20%, hsl(var(--border)) 80%, transparent)",
            }}
          />
          <ResizablePanel defaultSize={62} minSize={35}>
            {rightPanelContent}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
      {modals}
    </div>
  );
};
