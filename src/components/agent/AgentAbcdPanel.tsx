import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { scoreABCD, gradeABCD } from "@/lib/abcdScorer";
import type { Analysis, Scene } from "./agentTypes";

type Lang = "ko" | "en";

const L: Record<string, { ko: string; en: string }> = {
  title: { ko: "ABCD 실시간 점수", en: "ABCD Live Score" },
  subtitle_empty: { ko: "씬을 추가하면 실시간 채점됩니다", en: "Add scenes to start live scoring" },
  subtitle_scenes: { ko: "씬 {n}개 반영 · Agent 스토리보드 기준", en: "{n} scenes · Agent storyboard-based" },
  attract: { ko: "Attract · 첫 3초 몰입도", en: "Attract · First 3s Hook" },
  brand: { ko: "Brand · 브랜드·제품 노출", en: "Brand · Brand/Product Exposure" },
  connect: { ko: "Connect · 감정 연결", en: "Connect · Emotional Link" },
  direct: { ko: "Direct · CTA 명확성", en: "Direct · CTA Clarity" },
  grade_excellent: { ko: "탁월", en: "Excellent" },
  grade_good: { ko: "양호", en: "Good" },
  grade_needs_work: { ko: "보완 필요", en: "Needs Work" },
  grade_revise: { ko: "전면 재검토", en: "Revise" },
};
const t = (k: string, lang: Lang) => L[k]?.[lang] ?? k;

const GRADE_LABEL: Record<string, { ko: string; en: string }> = {
  탁월: L.grade_excellent,
  양호: L.grade_good,
  "보완 필요": L.grade_needs_work,
  "전면 재검토": L.grade_revise,
};
const gradeLabel = (g: string, lang: Lang) => GRADE_LABEL[g]?.[lang] ?? g;

/**
 * 프로젝트 톤에 맞춘 3단계 컬러 시스템
 *   green  — 양호 이상 (>=7 개별축 / >=28 총점)
 *   amber  — 보완 필요 (4~6 / 20~27)
 *   red    — 심각 (<4 / <20)
 * 연두(lime) 제거.
 */
const COLORS = {
  green: "#10b981",
  amber: "#f59e0b",
  red: "#ef4444",
  muted: "hsl(var(--muted-foreground))",
} as const;

const barColor = (score: number) =>
  score >= 7 ? COLORS.green : score >= 4 ? COLORS.amber : COLORS.red;

/** gradeABCD 의 "lime" 을 프로젝트 팔레트(green) 로 매핑 */
const totalColor = (gradeColor: "red" | "amber" | "lime" | "green") =>
  gradeColor === "red" ? COLORS.red : gradeColor === "amber" ? COLORS.amber : COLORS.green;

interface Props {
  scenes: Scene[];
  briefAnalysis: Analysis | null;
  lang?: Lang;
  /** controlled open state (optional) */
  defaultOpen?: boolean;
}

export default function AgentAbcdPanel({ scenes, briefAnalysis, lang = "ko", defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  const computed = useMemo(() => {
    if (!briefAnalysis) return null;
    const vd =
      typeof briefAnalysis.visual_direction === "object" ? briefAnalysis.visual_direction : undefined;
    return scoreABCD({
      hook_strategy: briefAnalysis.hook_strategy,
      hero_visual: briefAnalysis.hero_visual,
      product_info: briefAnalysis.product_info,
      pacing: briefAnalysis.pacing,
      constraints: briefAnalysis.constraints,
      audience_insight: briefAnalysis.audience_insight,
      visual_direction: vd,
      reference_mood: briefAnalysis.reference_mood,
      scenes: scenes.map((s) => ({
        scene_number: s.scene_number,
        description: s.description,
        camera_angle: s.camera_angle,
        tagged_assets: s.tagged_assets,
      })),
      total_scene_count: scenes.length,
    });
  }, [scenes, briefAnalysis]);

  if (!briefAnalysis) return null;
  if (!computed) return null;

  const total = computed.total ?? 0;
  const gradeInfo = gradeABCD(total);
  const gradeCol = totalColor(gradeInfo.color);

  const rows: Array<{ key: "attract" | "brand" | "connect" | "direct"; letter: string; label: string }> = [
    { key: "attract", letter: "A", label: t("attract", lang) },
    { key: "brand", letter: "B", label: t("brand", lang) },
    { key: "connect", letter: "C", label: t("connect", lang) },
    { key: "direct", letter: "D", label: t("direct", lang) },
  ];

  return (
    <div
      style={{
        borderRadius: 8,
        border: "0.5px solid hsl(var(--border))",
        background: "hsl(var(--muted)/0.2)",
        overflow: "hidden",
      }}
    >
      {/* ── compact header (always visible) ─────────────────── */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 12px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <Sparkles style={{ width: 13, height: 13, color: COLORS.muted }} />
        <span
          className="font-mono"
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.04em",
            color: "hsl(var(--muted-foreground))",
            textTransform: "uppercase",
          }}
        >
          {t("title", lang)}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 6 }}>
          {rows.map(({ key, letter }) => {
            const s = computed[key].score;
            const col = barColor(s);
            return (
              <span
                key={key}
                className="font-mono"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "2px 7px",
                  borderRadius: 4,
                  background: `${col}1f`,
                  border: `1px solid ${col}55`,
                  lineHeight: 1,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    color: col,
                    letterSpacing: "0.04em",
                  }}
                >
                  {letter}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 800,
                    color: col,
                    letterSpacing: "0",
                  }}
                >
                  {s}
                </span>
              </span>
            );
          })}
        </div>
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "baseline",
            gap: 8,
          }}
        >
          <span
            className="font-mono"
            style={{
              fontSize: 14,
              fontWeight: 800,
              color: gradeCol,
              letterSpacing: "-0.01em",
            }}
          >
            {total}
            <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.muted }}>/40</span>
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: gradeCol,
              padding: "2px 7px",
              borderRadius: 4,
              background: `${gradeCol}1f`,
              border: `1px solid ${gradeCol}55`,
              lineHeight: 1,
            }}
          >
            {gradeLabel(gradeInfo.grade, lang)}
          </span>
          {open ? (
            <ChevronUp style={{ width: 13, height: 13, color: COLORS.muted }} />
          ) : (
            <ChevronDown style={{ width: 13, height: 13, color: COLORS.muted }} />
          )}
        </div>
      </button>

      {/* ── expanded details ─────────────────────────────── */}
      {open && (
        <div
          style={{
            padding: "10px 12px 12px 12px",
            borderTop: "0.5px solid hsl(var(--border))",
            background: "hsl(var(--background))",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "hsl(var(--muted-foreground))",
              marginBottom: 12,
              letterSpacing: "0.02em",
            }}
          >
            {scenes.length === 0
              ? t("subtitle_empty", lang)
              : t("subtitle_scenes", lang).replace("{n}", String(scenes.length))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {rows.map(({ key, letter, label }) => {
              const row = computed[key];
              const pct = Math.round((row.score / 10) * 100);
              const col = barColor(row.score);
              return (
                <div key={key} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span className="font-mono" style={{ fontSize: 13, fontWeight: 800, color: col }}>
                      {letter}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        color: "hsl(var(--muted-foreground))",
                        fontWeight: 600,
                      }}
                    >
                      {label}
                    </span>
                    <span
                      className="font-mono"
                      style={{
                        marginLeft: "auto",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "hsl(var(--muted-foreground))",
                      }}
                    >
                      {row.score}/10
                    </span>
                  </div>
                  <div
                    style={{
                      height: 5,
                      width: "100%",
                      background: "hsl(var(--muted)/0.5)",
                      borderRadius: 2,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${pct}%`,
                        background: col,
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                  {row.notes && (
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "hsl(var(--muted-foreground))",
                        lineHeight: 1.55,
                      }}
                    >
                      {row.notes}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
