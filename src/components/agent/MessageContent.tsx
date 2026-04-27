import React from "react";
import ReactMarkdown from "react-markdown";
import {
  KR,
  type Asset,
  type MessageSegment,
  parseMessageSegments,
  resolveAsset,
} from "./agentTypes";
import { TagChip } from "./AgentSceneCards";
import { isBriefAnalysisMsg } from "./prompts";
import { BriefAnalysisCard } from "./BriefAnalysisCard";
import { StorylinesCard } from "./StorylinesCard";
import { StrategyCard } from "./StrategyCard";

interface Props {
  content: string;
  assets: Asset[];
  onSend?: (text: string) => void;
  segments?: MessageSegment[];
}

const normalizeShotRefs = (text: string) => text.replace(/#(\d{1,2})(?!\d)/g, (_, n) => `#${String(n).padStart(2, "0")}`);

export const MessageContent = ({ content, assets, onSend, segments: preSegments }: Props) => {
  if (isBriefAnalysisMsg(content)) return <BriefAnalysisCard content={content} />;
  const segments = preSegments ?? parseMessageSegments(content);
  const renderWithTags = (text: string): React.ReactNode =>
    normalizeShotRefs(text).split(/(@[\w가-힣]+)/g).map((p, i) => {
      if (/^@[\w가-힣]+$/.test(p)) {
        const resolved = resolveAsset(p, assets);
        if (resolved) {
          const clean = p.slice(1);
          const suffix = clean.slice(resolved.name.length);
          return (
            <React.Fragment key={i}>
              <TagChip name={resolved.name} assetType={resolved.asset.asset_type || "character"} />
              {suffix}
            </React.Fragment>
          );
        }
      }
      return <span key={i}>{p}</span>;
    });
  return (
    <div>
      {segments.map((seg, i) => {
        if (seg.type === "strategy") return <StrategyCard key={i} content={seg.content} renderText={renderWithTags} />;
        if (seg.type === "storylines")
          return <StorylinesCard key={i} options={seg.options} onSelect={(t) => onSend?.(t)} renderText={renderWithTags} />;
        if (seg.type === "scene") return null;
        if (seg.type === "scene_alt") {
          const d = seg.data;
          if (!d) return null;
          return (
            <div
              key={i}
              className="my-2 px-3 py-2 border bg-card/40"
              style={{ borderRadius: 0, borderColor: "rgba(96,165,250,0.25)" }}
            >
              <div className="flex items-baseline gap-2 mb-0.5">
                <span className="font-mono text-[10px] text-blue-300">
                  #{String(d.scene_number).padStart(2, "0")} · 대안 {d.variant || "B"}
                </span>
                {d.title && <span className="text-[12px] font-semibold text-foreground/90">{d.title}</span>}
              </div>
              {d.description && <p className="text-[12px] leading-relaxed text-foreground/80">{renderWithTags(d.description)}</p>}
              {d.rationale && (
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">RATIONALE: {renderWithTags(d.rationale)}</p>
              )}
            </div>
          );
        }
        if (seg.type === "scene_audit") {
          const d = seg.data;
          if (!d) return null;
          const score = (k: "A" | "B" | "C" | "D") => {
            const v = d.abcd?.[k];
            if (typeof v !== "number") return null;
            // Legacy audits used 0.0-1.0 ratios; current prompt uses 0-10.
            return Math.round((v <= 1 ? v * 10 : v) * 10) / 10;
          };
          return (
            <div
              key={i}
              className="my-2 px-3 py-2 border bg-card/40"
              style={{ borderRadius: 0, borderColor: "rgba(34,197,94,0.22)" }}
            >
              <div className="font-mono text-[10px] text-emerald-400 mb-1">CUT AUDIT · ABCD</div>
              <div className="flex flex-wrap gap-2 mb-1.5">
                {(["A", "B", "C", "D"] as const).map((k) => {
                  const s = score(k);
                  return (
                    <span
                      key={k}
                      className="font-mono text-[10px] px-1.5 py-0.5 border"
                      style={{ borderRadius: 0, borderColor: "rgba(255,255,255,0.1)" }}
                    >
                      {k}: {s == null ? "—" : `${s}/10`}
                    </span>
                  );
                })}
              </div>
              {!!d.issues?.length && (
                <ul className="list-disc pl-4 mb-1">
                  {d.issues.map((it, j) => (
                    <li key={j} className="text-[12px] text-foreground/80 leading-snug">{renderWithTags(it)}</li>
                  ))}
                </ul>
              )}
              {!!d.suggested_fixes?.length && (
                <ul className="list-disc pl-4">
                  {d.suggested_fixes.map((it, j) => (
                    <li key={j} className="text-[12px] text-emerald-300/85 leading-snug">{renderWithTags(it)}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        }
        if (seg.type === "reference_decomposition") {
          const d = seg.data;
          if (!d) return null;
          return (
            <div
              key={i}
              className="my-2 px-3 py-2 border bg-card/40"
              style={{ borderRadius: 0, borderColor: "rgba(244,114,182,0.25)" }}
            >
              <div className="font-mono text-[10px] text-pink-300 mb-1">REFERENCE DECOMPOSITION</div>
              {d.hook && (
                <p className="text-[12px] mb-1 text-foreground/85">
                  <span className="font-mono text-[10px] text-muted-foreground mr-1">HOOK</span>
                  {renderWithTags(d.hook)}
                </p>
              )}
              {!!d.scenes?.length && (
                <div className="space-y-0.5 mb-1">
                  {d.scenes.map((s, j) => (
                    <p key={j} className="text-[11.5px] text-foreground/80 leading-snug">
                      <span className="font-mono text-[10px] text-muted-foreground mr-1">
                        {normalizeShotRefs(s.t || `#${j + 1}`)}
                      </span>
                      {renderWithTags(s.beat || s.visual || s.audio || "")}
                    </p>
                  ))}
                </div>
              )}
              {!!d.motifs?.length && (
                <p className="text-[11.5px] text-foreground/75">
                  <span className="font-mono text-[10px] text-muted-foreground mr-1">MOTIFS</span>
                  {renderWithTags(d.motifs.join(" · "))}
                </p>
              )}
              {!!d.do_not_copy?.length && (
                <p className="text-[11.5px] text-pink-300/80 mt-0.5">
                  <span className="font-mono text-[10px] mr-1">AVOID</span>
                  {renderWithTags(d.do_not_copy.join(" · "))}
                </p>
              )}
            </div>
          );
        }
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
                <code className="bg-background/50 px-1 py-0.5 rounded-none text-[13px] font-mono text-muted-foreground">
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
              li: ({ children }) => {
                const processed = React.Children.map(children, (child) =>
                  typeof child === "string" ? <>{renderWithTags(child)}</> : child,
                );
                return <li className="text-[14px] leading-[1.65] text-foreground/80">{processed}</li>;
              },
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
            {normalizeShotRefs(seg.content)}
          </ReactMarkdown>
        );
      })}
    </div>
  );
};
