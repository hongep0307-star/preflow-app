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

export const MessageContent = ({ content, assets, onSend, segments: preSegments }: Props) => {
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
