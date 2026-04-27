import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Send, ImagePlus } from "lucide-react";
import { KR, type Asset, loadFocalMap } from "./agentTypes";
import { MentionDropdown } from "./AgentSceneCards";
import { useT } from "@/lib/uiLanguage";

interface Props {
  assets: Asset[];
  projectId: string;
  disabled: boolean;
  hasImages: boolean;
  onSend: (text: string) => void;
  onAttach: () => void;
}

export const AgentChatInput = ({ assets, projectId, disabled, hasImages, onSend, onAttach }: Props) => {
  const t = useT();
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
        placeholder={t("agent.chatPlaceholder")}
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
        title={t("agent.attachImages")}
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
