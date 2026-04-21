import { callClaude } from "@/lib/claude";
import type { AssetType } from "./types";

const VISION_CONFIGS: Record<AssetType, { system: string; prompt: string }> = {
  character: {
    system: "You are a fashion analyst for commercial film production. Analyze clothing and return only JSON.",
    prompt: `이 이미지 속 인물의 착장만 분석하세요. 아래 JSON만 반환 (마크다운 없이):\n{"outfit":"의상 설명 (영어, 색상/스타일/의류 종류 포함)"}`,
  },
  item: {
    system: "You are a prop analyst for commercial film production. Analyze objects and return only JSON.",
    prompt: `이 이미지 속 오브젝트/소품을 분석하세요. 아래 JSON만 반환 (마크다운 없이):\n{"description":"상세 묘사 (영어, 형태/크기/소재/색상/질감/특이사항/브랜드 포함)"}`,
  },
  background: {
    system: "You are a location scout for commercial film production. Analyze locations and return only JSON.",
    prompt: `이 이미지 속 배경/장소를 분석하세요. 아래 JSON만 반환 (마크다운 없이):\n{"description":"장소 묘사 (영어, 공간 유형/조명/분위기/색감/주요 요소/시간대 포함)"}`,
  },
};

export const callVisionAnalyze = async (base64: string, mediaType: string, type: AssetType) => {
  const { system, prompt } = VISION_CONFIGS[type];
  const data = await callClaude({
    model: "claude-sonnet-4-20250514",
    max_tokens: 300,
    system,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType as any, data: base64 } },
          { type: "text", text: prompt },
        ],
      },
    ],
  });
  const raw: string = data.content?.[0]?.text ?? "";
  if (!raw) throw new Error("응답이 비어 있습니다");
  const jsonMatch = raw
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim()
    .match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`JSON 파싱 실패: ${raw.slice(0, 80)}`);
  return JSON.parse(jsonMatch[0]);
};
