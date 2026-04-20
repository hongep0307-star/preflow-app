import type {
  ABCDCompliance,
  ABCDScore,
  HookStrategy,
  HeroVisual,
  ProductInfo,
  Pacing,
  Constraints,
  AudienceInsight,
} from "@/components/agent/agentTypes";

/**
 * ABCD Framework Scorer (Google)
 *   Attract — 첫 3초 몰입도
 *   Brand   — 브랜드/제품 노출 타이밍과 배치
 *   Connect — 감정·내러티브 연결
 *   Direct  — CTA 명확성
 *
 * 순수 TS 함수. 룰 기반으로 0-10 점을 매기고, 부족한 항목은 notes 로 피드백.
 * 브리프 분석 직후에는 "예측 스코어" 로, 콘티 생성 후에는 "실제 씬 기반"
 * 으로 재호출될 수 있도록 입력을 모두 optional 하게 받는다.
 */

interface Rule {
  check: () => boolean;
  weight: number;
  fail_message: string;
  pass_message?: string;
}

export interface ABCDInput {
  hook_strategy?: HookStrategy;
  hero_visual?: HeroVisual;
  product_info?: ProductInfo;
  pacing?: Pacing;
  constraints?: Constraints;
  audience_insight?: AudienceInsight;
  visual_direction?: { lighting?: string };
  reference_mood?: string;
  /** 실제 생성된 씬 배열이 있으면 더 정확한 채점 */
  scenes?: Array<{
    scene_number: number;
    description?: string | null;
    camera_angle?: string | null;
    tagged_assets?: string[];
  }>;
  total_scene_count?: number;
}

function runRules(rules: Rule[]): ABCDScore {
  let earned = 0;
  const max = rules.reduce((a, r) => a + r.weight, 0);
  const notes: string[] = [];
  for (const r of rules) {
    let passed = false;
    try {
      passed = r.check();
    } catch {
      passed = false;
    }
    if (passed) {
      earned += r.weight;
      if (r.pass_message) notes.push(`✓ ${r.pass_message}`);
    } else {
      notes.push(`⚠ ${r.fail_message}`);
    }
  }
  const normalized = max === 0 ? 0 : Math.round((earned / max) * 10);
  return { score: normalized, notes: notes.join(" · ") };
}

/** product_info.what / must_show 에서 검색 가능한 토큰(2자 이상) 을 추출 */
function extractProductKeywords(productWhat?: string, mustShow?: string[]): string[] {
  const out: string[] = [];
  const push = (raw?: string) => {
    if (!raw) return;
    raw
      .split(/[\s,/\\·\-·|]+/)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length >= 2)
      .forEach((t) => out.push(t));
  };
  push(productWhat);
  (mustShow ?? []).forEach(push);
  return [...new Set(out)];
}

type SceneLike = NonNullable<ABCDInput["scenes"]>[number];

function sceneText(s: SceneLike): string {
  return `${s.description ?? ""} ${(s.tagged_assets ?? []).join(" ")}`.toLowerCase();
}

function sceneHasAnyKeyword(s: SceneLike, keywords: string[]): boolean {
  if (!keywords.length) return false;
  const txt = sceneText(s);
  return keywords.some((k) => txt.includes(k));
}

/**
 * 키워드가 처음 등장하는 씬의 "시작 시각(초)" 를 반환.
 * 반환값: { idx, revealSec } | null
 *   revealSec = 해당 씬이 시작되기 전까지의 누적 duration.
 *   duration_sec 미지정 씬은 기본 3초로 간주.
 */
function firstKeywordAppearance(
  sceneArr: SceneLike[],
  keywords: string[],
): { idx: number; revealSec: number } | null {
  if (!keywords.length) return null;
  let cum = 0;
  for (let i = 0; i < sceneArr.length; i++) {
    const s = sceneArr[i];
    if (sceneHasAnyKeyword(s, keywords)) {
      return { idx: i, revealSec: cum };
    }
    cum += typeof s.duration_sec === "number" ? s.duration_sec : 3;
  }
  return null;
}

export function scoreABCD(input: ABCDInput): ABCDCompliance {
  const {
    hook_strategy,
    hero_visual,
    product_info,
    pacing,
    visual_direction,
    reference_mood,
    audience_insight,
    scenes,
  } = input;

  // ── 씬 기반 신호 추출 (씬이 있을 때만 사용) ─────────────
  const sceneArrAll = scenes ?? [];
  const filledScenes = sceneArrAll.filter(
    (s) => !!s.description && s.description.trim().length > 0,
  );
  const hasScenes = filledScenes.length > 0;
  const productKeywords = extractProductKeywords(product_info?.what, hero_visual?.must_show);
  const firstReveal = hasScenes ? firstKeywordAppearance(filledScenes, productKeywords) : null;
  const firstSceneFilled = filledScenes[0];
  const firstSceneTextLen = firstSceneFilled?.description?.trim().length ?? 0;

  // ── A: Attract ────────────────────────────────────────────
  // 씬이 있으면 씬 기반 규칙, 없으면 브리프 설계값 기반.
  const attract = runRules(
    hasScenes
      ? [
          {
            check: () => firstSceneTextLen >= 20,
            weight: 2,
            fail_message: "첫 씬 description 이 비었거나 너무 짧음 — 구체적 샷 서술 필요",
            pass_message: "첫 씬 description 구체적",
          },
          {
            check: () => !!firstSceneFilled?.camera_angle && firstSceneFilled.camera_angle.trim().length > 0,
            weight: 1,
            fail_message: "첫 씬 camera_angle 미지정 — 훅 샷 의도 모호",
            pass_message: "첫 씬 camera_angle 지정됨",
          },
          {
            check: () => firstReveal !== null && firstReveal.revealSec < 3,
            weight: 3,
            fail_message:
              firstReveal === null
                ? `씬 description 에 제품/브랜드 키워드 노출 없음${productKeywords.length ? ` (검색어: ${productKeywords.slice(0, 4).join(", ")})` : ""}`
                : `첫 제품/브랜드 노출이 ${firstReveal.revealSec.toFixed(1)}s — 3초를 넘김`,
            pass_message:
              firstReveal !== null
                ? `첫 ${firstReveal.revealSec.toFixed(1)}s 내 브랜드·제품 노출`
                : undefined,
          },
          {
            check: () => hook_strategy?.pattern_interrupt === true,
            weight: 2,
            fail_message: "스크롤 멈춤(pattern_interrupt) 장치 없음",
            pass_message: "pattern_interrupt 활성",
          },
          {
            check: () =>
              !!hero_visual?.first_frame && hero_visual.first_frame.trim().length > 0,
            weight: 2,
            fail_message: "hero_visual.first_frame 미정의",
          },
        ]
      : [
          {
            check: () => !!hero_visual?.first_frame && hero_visual.first_frame.trim().length > 0,
            weight: 3,
            fail_message: "hero_visual.first_frame 미정의 — 첫 프레임 시각을 구체화할 것",
            pass_message: "첫 프레임 시각 정의됨",
          },
          {
            check: () => hook_strategy?.pattern_interrupt === true,
            weight: 2,
            fail_message: "스크롤 멈춤(pattern_interrupt) 장치 없음",
            pass_message: "pattern_interrupt 활성",
          },
          {
            check: () =>
              !!hero_visual &&
              (hero_visual.brand_reveal_timing === "0-3s" ||
                hero_visual.product_reveal_timing === "0-3s"),
            weight: 3,
            fail_message: "첫 3초 내 제품/브랜드 노출이 설계되지 않음",
            pass_message: "첫 3초 내 브랜드·제품 노출 설계됨",
          },
          {
            check: () =>
              !!hook_strategy?.first_3s_description &&
              hook_strategy.first_3s_description.length > 20,
            weight: 2,
            fail_message: "훅 첫 3초 묘사가 비었거나 너무 짧음 — 구체적 샷 서술 필요",
          },
        ],
  );

  // ── B: Brand ──────────────────────────────────────────────
  // 씬이 있으면 실제 씬의 브랜드·제품 노출 시점과 빈도를 채점.
  const brand = runRules(
    hasScenes
      ? [
          {
            check: () => firstReveal !== null && firstReveal.revealSec < 5,
            weight: 4,
            fail_message:
              firstReveal === null
                ? `어떤 씬에도 제품/브랜드 키워드가 없음${productKeywords.length ? ` (검색어: ${productKeywords.slice(0, 4).join(", ")})` : ""}`
                : `브랜드·제품 노출이 ${firstReveal.revealSec.toFixed(1)}s — 5초를 넘김`,
            pass_message:
              firstReveal !== null
                ? `5초 이내 (${firstReveal.revealSec.toFixed(1)}s) 브랜드 노출`
                : undefined,
          },
          {
            check: () => {
              if (!productKeywords.length) return false;
              // 제품/브랜드 키워드가 2개 이상의 씬에 걸쳐 반복 노출되는지
              const hits = filledScenes.filter((s) => sceneHasAnyKeyword(s, productKeywords)).length;
              return hits >= 2;
            },
            weight: 3,
            fail_message: "제품/브랜드가 1개 이하 씬에만 등장 — 반복 노출 부족",
            pass_message: "복수 씬에 걸쳐 브랜드·제품 반복 노출",
          },
          {
            check: () =>
              Array.isArray(hero_visual?.must_show) && (hero_visual?.must_show.length ?? 0) >= 2,
            weight: 1,
            fail_message: "hero_visual.must_show 자산 2개 미만",
          },
          {
            check: () => !!product_info?.what && product_info.what.length > 2,
            weight: 2,
            fail_message: "product_info.what 누락 — 판매·홍보 대상 불명확",
          },
        ]
      : [
          {
            check: () =>
              hero_visual?.brand_reveal_timing === "0-3s" ||
              hero_visual?.brand_reveal_timing === "3-5s",
            weight: 4,
            fail_message: "브랜드 노출 타이밍이 5초 이내에 설계되지 않음",
            pass_message: "5초 이내 브랜드 노출",
          },
          {
            check: () => !!hero_visual?.logo_placement,
            weight: 2,
            fail_message: "logo_placement 미정의",
          },
          {
            check: () =>
              Array.isArray(hero_visual?.must_show) && (hero_visual?.must_show.length ?? 0) >= 2,
            weight: 2,
            fail_message: "hero_visual.must_show 요소가 2개 미만 — 브랜드 자산 최소 2개 강제 필요",
          },
          {
            check: () => !!product_info?.what && product_info.what.length > 2,
            weight: 2,
            fail_message: "product_info.what 누락 — 판매/홍보 대상이 명확하지 않음",
          },
        ],
  );

  // ── C: Connect ────────────────────────────────────────────
  const connect = runRules([
    {
      check: () =>
        !!audience_insight?.pain_point && audience_insight.pain_point.length > 5,
      weight: 3,
      fail_message: "audience_insight.pain_point 미정의 — 타겟 페인 포인트 구체화 필요",
    },
    {
      check: () =>
        !!hook_strategy?.primary &&
        ["power_fantasy", "fail_solve", "testimonial", "before_after"].includes(
          hook_strategy.primary,
        ),
      weight: 3,
      fail_message: "훅이 감정 비트를 강조하는 유형이 아님 — connect 보강 여지",
      pass_message: "감정 연결형 훅 선택됨",
    },
    {
      check: () => !!visual_direction?.lighting && visual_direction.lighting.length > 10,
      weight: 2,
      fail_message: "visual_direction.lighting 이 감정 톤을 구체화하지 못함",
    },
    {
      check: () => !!reference_mood && reference_mood.length > 30,
      weight: 2,
      fail_message: "reference_mood 가 센서리 디테일로 묘사되지 않음 (너무 짧음)",
    },
  ]);

  // ── D: Direct ─────────────────────────────────────────────
  // filledScenes 는 이미 상단에서 계산됨 (description 채워진 씬만 대상, 빈 placeholder 무시)
  const totalFilled = filledScenes.length;
  // 항상 최소 1개의 씬은 포함되도록 (기존 ceil(n*0.8) 은 total<=4 에서 빈 배열을 만들었음)
  const takeN = Math.max(1, Math.ceil(totalFilled * 0.2));
  const last20pct = totalFilled > 0 ? filledScenes.slice(Math.max(0, totalFilled - takeN)) : [];
  const ctaKeywords = [
    "cta", "구매", "다운로드", "참여", "클릭", "지금", "방문", "시작",
    "buy", "download", "tap", "click", "join", "play", "get", "start", "now",
  ];
  const ctaHitInLastScenes = last20pct.some((s) => {
    const txt = `${s.description ?? ""}`.toLowerCase();
    return ctaKeywords.some((k) => txt.includes(k));
  });

  const direct = runRules([
    {
      check: () =>
        !!product_info?.cta_action && /^(지금|참여|구매|다운|클릭|방문|[A-Za-z])/u.test(product_info.cta_action) &&
        product_info.cta_action.length <= 10,
      weight: 3,
      fail_message: "cta_action 이 동사형 3-6자 짧은 문구가 아님",
      pass_message: "cta_action 구체적 동사형",
    },
    {
      check: () => !!product_info?.cta_destination && product_info.cta_destination.length > 3,
      weight: 3,
      fail_message: "cta_destination (구체적 경로) 누락",
    },
    {
      check: () => !!product_info?.urgency?.type && product_info.urgency.type !== "none",
      weight: 2,
      fail_message: "urgency 가 'none' — 긴박감 장치 없음",
      pass_message: "긴박감(urgency) 설계됨",
    },
    {
      check: () => {
        // 빈 씬만 있거나 씬이 아직 없으면 pacing 기반 fallback
        if (totalFilled === 0) {
          return !!pacing && pacing.scene_count.recommended >= 3;
        }
        return ctaHitInLastScenes;
      },
      weight: 2,
      fail_message: totalFilled
        ? `마지막 씬 description 에 CTA 키워드 없음 (구매/다운로드/참여/클릭/지금/방문/시작/buy/download/tap/click/join/play/get/start/now)`
        : "마지막 20% 씬에 CTA 비주얼/액션이 포함되지 않음",
      pass_message: totalFilled ? "마지막 씬 description 에 CTA 반영됨" : undefined,
    },
  ]);

  const total_score = attract.score + brand.score + connect.score + direct.score;

  return { attract, brand, connect, direct, total: total_score };
}

/** 4개 영역 합산 0-40 을 5-grade 텍스트로 변환 */
export function gradeABCD(total: number): { grade: string; color: "red" | "amber" | "lime" | "green" } {
  if (total >= 34) return { grade: "탁월", color: "green" };
  if (total >= 28) return { grade: "양호", color: "lime" };
  if (total >= 20) return { grade: "보완 필요", color: "amber" };
  return { grade: "전면 재검토", color: "red" };
}
