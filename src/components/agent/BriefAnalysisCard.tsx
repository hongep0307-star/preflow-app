import { Sparkles } from "lucide-react";
import { KR } from "./agentTypes";

const CONTENT_TYPE_META: Record<string, { ko: string; color: string }> = {
  product_launch: { ko: "상품 런칭", color: "#f59e0b" },
  event: { ko: "이벤트", color: "#8b5cf6" },
  update: { ko: "업데이트", color: "#06b6d4" },
  community: { ko: "커뮤니티", color: "#10b981" },
  brand_film: { ko: "브랜드 필름", color: "#f9423a" },
};

const HOOK_LABEL_KO: Record<string, string> = {
  gameplay_first: "게임플레이 우선",
  fail_solve: "실패→해결",
  power_fantasy: "파워 판타지",
  unboxing_reveal: "언박싱 공개",
  before_after: "전/후 비교",
  mystery_tease: "미스터리 티저",
  testimonial: "증언",
  pattern_interrupt: "패턴 인터럽트",
};

export const BriefAnalysisCard = ({ content }: { content: string }) => {
  const raw = content
    .replace(/^\[브리프 분석 결과\]\s*/i, "")
    .replace(/^\[Brief Analysis\]\s*/i, "");

  // label: value (공백 필수) — "9:16" 같이 공백 없는 콜론은 label로 해석되지 않음
  const extract = (label: string): string | null => {
    const esc = label.replace(/([.*+?^=!:${}()|[\]\\])/g, "\\$1");
    const re = new RegExp(`^${esc}:\\s+(.+)$`, "m");
    const m = raw.match(re);
    return m ? m[1].trim() : null;
  };

  const goal = extract("목표");
  const target = extract("타겟");
  const usp = extract("USP");
  const tone = extract("톤앤매너");
  const ideaNote = extract("아이디어 메모");
  const directorRec = extract("디렉터 추천");

  const ctMatch = raw.match(/\[콘텐츠 타입\]\s*(\w+)(?:\s*\(신뢰도\s*(\d+)%\))?/);
  const contentType = ctMatch?.[1];
  const contentTypeConf = ctMatch?.[2];
  const contentTypeMeta = contentType ? CONTENT_TYPE_META[contentType] : null;
  const contentTypeLabel = contentTypeMeta?.ko ?? contentType ?? null;
  const contentTypeColor = contentTypeMeta?.color ?? KR;

  const formatMatch = raw.match(/-\s*포맷\s+(\S+)\s*·\s*길이\s+(\S+)/);
  const format = formatMatch?.[1];
  const duration = formatMatch?.[2];

  const sceneMatch = raw.match(/-\s*씬 수:\s*(\d+)(?:\s*\(범위\s*(\d+)~(\d+)\))?/);
  const scenesRec = sceneMatch?.[1];

  const hookMatch = raw.match(/-\s*primary:\s*(\w+)/);
  const hook = hookMatch?.[1];
  const hookLabel = hook ? (HOOK_LABEL_KO[hook] ?? hook) : null;

  // 끝에 붙어 있는 자유 서술 (예: "이 브리프를 바탕으로 ...") 을 추출
  const blocks = raw.split(/\n\n+/);
  const lastBlock = blocks[blocks.length - 1]?.trim() ?? "";
  const isStructured =
    lastBlock.startsWith("[") ||
    lastBlock.startsWith("- ") ||
    /^[A-Za-z가-힣 ]+:\s/.test(lastBlock);
  const requestText = !isStructured && lastBlock.length > 0 ? lastBlock : null;

  const coreFields = [
    { key: "목표", value: goal, color: "#f9423a" },
    { key: "타겟", value: target, color: "#6366f1" },
    { key: "USP", value: usp, color: "#d97706" },
    { key: "톤앤매너", value: tone, color: "#059669" },
  ].filter((f) => f.value);

  const metaPills: { label: string; value: string }[] = [];
  if (format) metaPills.push({ label: "포맷", value: duration ? `${format} · ${duration}` : format });
  if (scenesRec) metaPills.push({ label: "씬", value: `${scenesRec}개` });
  if (hookLabel) metaPills.push({ label: "훅", value: hookLabel });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Sparkles size={13} style={{ color: KR }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: KR, letterSpacing: "0.01em" }}>Brief Analysis</span>
        </div>
        {contentTypeLabel && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 8px",
              background: `${contentTypeColor}22`,
              color: contentTypeColor,
              border: `1px solid ${contentTypeColor}55`,
              letterSpacing: "0.03em",
              whiteSpace: "nowrap",
            }}
          >
            {contentTypeLabel}
            {contentTypeConf && <span style={{ marginLeft: 4 }}>· {contentTypeConf}%</span>}
          </span>
        )}
      </div>

      {/* Core 4-field grid */}
      {coreFields.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {coreFields.map((f) => (
            <div
              key={f.key}
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                padding: "7px 10px",
                display: "flex",
                flexDirection: "column",
                gap: 3,
                minHeight: 56,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: f.color,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase" as const,
                }}
              >
                {f.key}
              </div>
              <div style={{ fontSize: 12.5, color: "hsl(var(--foreground))", lineHeight: 1.45, opacity: 0.9 }}>
                {f.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Meta line: format · scenes · hook */}
      {metaPills.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.05)",
            padding: "6px 10px",
          }}
        >
          {metaPills.map((p, i) => (
            <span key={p.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {i > 0 && <span style={{ color: "rgba(255,255,255,0.12)" }}>·</span>}
              <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", opacity: 0.7, letterSpacing: "0.04em", textTransform: "uppercase" as const }}>
                {p.label}
              </span>
              <span style={{ fontSize: 11.5, color: "hsl(var(--foreground))", fontWeight: 600 }}>{p.value}</span>
            </span>
          ))}
        </div>
      )}

      {/* Notes (idea + director rec combined) */}
      {(ideaNote || directorRec) && (
        <div
          style={{
            padding: "7px 10px",
            background: "rgba(255,255,255,0.02)",
            borderLeft: "2px solid rgba(249,66,58,0.4)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {ideaNote && (
            <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", lineHeight: 1.5 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", opacity: 0.55, marginRight: 6, textTransform: "uppercase" as const }}>
                아이디어
              </span>
              {ideaNote}
            </div>
          )}
          {directorRec && (
            <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", lineHeight: 1.5 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", opacity: 0.55, marginRight: 6, textTransform: "uppercase" as const }}>
                디렉터
              </span>
              {directorRec}
            </div>
          )}
        </div>
      )}

      {/* Trailing request text (e.g. "이 브리프를 바탕으로 ...") */}
      {requestText && (
        <div
          style={{
            fontSize: 12.5,
            color: "hsl(var(--muted-foreground))",
            marginTop: 2,
            fontStyle: "italic",
            opacity: 0.65,
            lineHeight: 1.5,
          }}
        >
          {requestText}
        </div>
      )}
    </div>
  );
};
