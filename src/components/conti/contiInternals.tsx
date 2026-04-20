import { useState, useEffect, useRef, useCallback } from "react";
import { Copy, Trash2, Columns2, Upload, Paintbrush, X, ImageIcon, Crop } from "lucide-react";
import { KR, KR_BG, ACFG, ASSET_ICON, type Asset } from "./contiTypes";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TagChip
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const TagChip = ({ name, assetType }: { name: string; assetType: string }) => {
  const cfg = ACFG[assetType] || ACFG.character;
  const ico = ASSET_ICON[assetType] || ASSET_ICON.character;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 9,
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontWeight: 600,
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        padding: "1px 6px 1px 4px",
        borderRadius: 2,
        background: cfg.bg,
        color: cfg.color,
        border: `0.5px solid ${cfg.bd}`,
        verticalAlign: "middle",
        lineHeight: 1,
        position: "relative",
        top: -1,
        margin: "0 1px",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          width: 0,
          height: 0,
          overflow: "hidden",
          opacity: 0,
          pointerEvents: "none",
        }}
      >
        @
      </span>
      <svg
        width={9}
        height={9}
        viewBox="0 0 24 24"
        fill="none"
        stroke={cfg.color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ display: "inline-block", flexShrink: 0 }}
      >
        <path d={ico} />
      </svg>
      {name}
    </span>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// resolveAsset — 정확 매칭 우선, 그 다음 prefix 매칭
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const resolveAsset = (raw: string, assets: Asset[]): { asset: Asset; name: string } | null => {
  const clean = raw.startsWith("@") ? raw.slice(1) : raw;
  // 1. 정확 매칭
  for (const a of assets) {
    const n = a.tag_name.startsWith("@") ? a.tag_name.slice(1) : a.tag_name;
    if (n === clean) return { asset: a, name: n };
  }
  // 2. prefix 매칭 (긴 것 우선)
  const sorted = [...assets].sort((a, b) => b.tag_name.length - a.tag_name.length);
  for (const a of sorted) {
    const n = a.tag_name.startsWith("@") ? a.tag_name.slice(1) : a.tag_name;
    if (clean.startsWith(n) && clean.length > n.length) return { asset: a, name: n };
  }
  return null;
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// getCaretOffsetFromPoint — 뷰(span)에서 편집(input/textarea) 모드 전환 시
// 클릭한 위치에 해당하는 문자열 오프셋을 구한다. 실패 시 fallbackLength 반환.
// 각 필드에서 onMouseDown 시 이 함수를 호출해 clickOffsetRef 에 저장하고,
// editing 전환 후 input 포커스 시 해당 오프셋으로 selectionRange 를 세팅한다.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const getCaretOffsetFromPoint = (
  container: HTMLElement,
  clientX: number,
  clientY: number,
  fallbackLength: number,
): number => {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  const getOffsetFromNode = (targetNode: Node, targetOffset: number) => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let charCount = 0;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node === targetNode) return charCount + targetOffset;
      charCount += node.textContent?.length ?? 0;
    }
    return fallbackLength;
  };

  let offset = fallbackLength;
  const caretPos = doc.caretPositionFromPoint?.(clientX, clientY);
  if (caretPos) offset = getOffsetFromNode(caretPos.offsetNode, caretPos.offset);
  else {
    const range = doc.caretRangeFromPoint?.(clientX, clientY);
    if (range) offset = getOffsetFromNode(range.startContainer, range.startOffset);
  }
  return Math.min(Math.max(offset, 0), fallbackLength);
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// InlineField — uncontrolled(defaultValue+ref)로 한글 IME 버그 수정
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const InlineField = ({
  value,
  onChange,
  placeholder,
  style = {},
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) => {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // 클릭한 위치의 문자열 오프셋. editing 전환 후 해당 위치에 커서를 둔다.
  const clickOffsetRef = useRef<number | null>(null);

  // editing 전환 시 autoFocus + 저장된 클릭 위치(없으면 끝)로 커서 이동
  useEffect(() => {
    if (editing && inputRef.current) {
      const el = inputRef.current;
      el.focus();
      const len = el.value.length;
      const pos = Math.min(clickOffsetRef.current ?? len, len);
      el.setSelectionRange(pos, pos);
      clickOffsetRef.current = null;
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const newVal = inputRef.current?.value ?? value;
    // 값이 바뀐 경우에만 부모에게 전달
    if (newVal !== value) onChange(newVal);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      // 취소 — DOM 변경 버림
      setEditing(false);
    }
  };

  if (editing)
    return (
      <input
        ref={inputRef}
        // ✅ defaultValue: uncontrolled — React가 IME 도중 DOM에 개입하지 않음
        defaultValue={value}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        style={{
          ...style,
          width: "100%",
          outline: "none",
          border: `1.5px solid ${KR}`,
          borderRadius: 0,
          padding: "2px 6px",
          margin: "-2px -6px",
          background: "hsl(var(--background))",
          fontFamily: "inherit",
          boxSizing: "border-box" as const,
        }}
      />
    );

  return (
    <span
      onClick={(e) => {
        // 클릭 위치 캡처 → editing 전환 후 해당 위치에 커서 배치
        clickOffsetRef.current = getCaretOffsetFromPoint(
          e.currentTarget as HTMLElement,
          e.clientX,
          e.clientY,
          value.length,
        );
        setEditing(true);
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "hsl(var(--muted))")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
      style={{
        ...style,
        display: "block",
        cursor: "text",
        borderRadius: 0,
        padding: "2px 5px",
        margin: "-2px -5px",
        transition: "background 0.1s",
      }}
    >
      {value || <span style={{ opacity: 0.3 }}>{placeholder}</span>}
    </span>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LocationField — @멘션 자동완성 (배경 에셋 한정)
// isComposing ref로 IME 조합 중 mention 오작동 방지
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const LocationField = ({
  value,
  assets,
  onChange,
}: {
  value: string;
  assets: Asset[];
  onChange: (v: string) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(0);
  const [selIdx, setSelIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  // 클릭 위치 오프셋 — editing 전환 후 커서 배치용
  const clickOffsetRef = useRef<number | null>(null);
  // ✅ IME 조합 중 여부 추적
  const isComposing = useRef(false);

  useEffect(() => {
    if (editing && inputRef.current) {
      const el = inputRef.current;
      el.focus();
      const len = el.value.length;
      const pos = Math.min(clickOffsetRef.current ?? len, len);
      el.setSelectionRange(pos, pos);
      clickOffsetRef.current = null;
    }
  }, [editing]);
  useEffect(() => {
    if (!editing) setVal(value);
  }, [value, editing]);
  useEffect(() => {
    setSelIdx(-1);
  }, [mentionQuery]);

  const bgAssets = assets.filter((a) => a.asset_type === "background");
  const suggestions =
    mentionQuery !== null
      ? bgAssets
          .filter((a) => a.tag_name.replace(/^@/, "").toLowerCase().includes(mentionQuery.toLowerCase()))
          .slice(0, 6)
      : [];

  const commit = () => {
    setEditing(false);
    setMentionQuery(null);
    onChange(val);
  };

  const detectMention = (v: string, pos: number) => {
    const m = v.slice(0, pos).match(/@([\w가-힣]*)$/);
    if (m) {
      setMentionQuery(m[1]);
      setMentionStart(pos - m[0].length);
    } else {
      setMentionQuery(null);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setVal(v);
    // ✅ IME 조합 중에는 mention 감지 건너뜀
    if (!isComposing.current) {
      detectMention(v, e.target.selectionStart ?? v.length);
    }
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    isComposing.current = false;
    // 조합 완료 후 mention 재감지
    const v = (e.target as HTMLInputElement).value;
    const pos = (e.target as HTMLInputElement).selectionStart ?? v.length;
    detectMention(v, pos);
  };

  const insertTag = (asset: Asset) => {
    const name = asset.tag_name.startsWith("@") ? asset.tag_name.slice(1) : asset.tag_name;
    const atEnd = mentionStart + 1 + (mentionQuery?.length ?? 0);
    const before = val.slice(0, mentionStart);
    const after = val.slice(atEnd);
    const newVal = `${before}@${name} ${after}`;
    setVal(newVal);
    setMentionQuery(null);
    onChange(newVal);
    setEditing(false);
  };

  // ── 뷰 모드: @태그를 TagChip으로 렌더링 ──
  if (!editing) {
    const parts = value ? value.split(/(@[\w가-힣]+)/g) : [];
    const hasContent = value && value.trim().length > 0;
    return (
      <span
        onClick={(e) => {
          clickOffsetRef.current = getCaretOffsetFromPoint(
            e.currentTarget as HTMLElement,
            e.clientX,
            e.clientY,
            value.length,
          );
          setEditing(true);
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "hsl(var(--muted))")}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
        style={{
          flex: 1,
          fontSize: 12,
          cursor: "text",
          borderRadius: 0,
          padding: "2px 6px",
          margin: "-2px -6px",
          transition: "background 0.1s",
          display: "inline-flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 2,
          color: hasContent ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
          opacity: hasContent ? 1 : 0.35,
        }}
      >
        {hasContent
          ? parts.map((p, i) => {
              if (/^@[\w가-힣]+$/.test(p)) {
                const resolved = resolveAsset(p, assets);
                if (resolved)
                  return <TagChip key={i} name={resolved.name} assetType={resolved.asset.asset_type || "background"} />;
              }
              return p ? <span key={i}>{p}</span> : null;
            })
          : "+ Enter location"}
      </span>
    );
  }

  // ── 편집 모드 ──
  return (
    <div style={{ flex: 1, position: "relative" }}>
      <input
        ref={inputRef}
        value={val}
        onChange={handleChange}
        // ✅ IME 조합 시작/종료 이벤트
        onCompositionStart={() => {
          isComposing.current = true;
        }}
        onCompositionEnd={handleCompositionEnd}
        onBlur={() => setTimeout(commit, 150)}
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
              insertTag(suggestions[selIdx]);
              return;
            }
          }
          if (e.key === "Enter" || e.key === "Escape") commit();
        }}
        placeholder="Enter location (@background tag)"
        style={{
          width: "100%",
          outline: "none",
          border: `1.5px solid ${KR}`,
          borderRadius: 0,
          padding: "2px 6px",
          fontSize: 12,
          background: "hsl(var(--background))",
          color: "hsl(var(--foreground))",
          fontFamily: "inherit",
          boxSizing: "border-box",
        }}
      />
      {suggestions.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 200,
            background: "#1c1c1c",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 0,
            overflow: "hidden",
            boxShadow: "0 8px 28px rgba(0,0,0,0.5)",
          }}
        >
          {suggestions.map((a, idx) => {
            const cfg = ACFG.background;
            return (
              <button
                key={a.tag_name}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertTag(a);
                }}
                onMouseEnter={() => setSelIdx(idx)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  background: idx === selIdx ? "rgba(249,66,58,0.08)" : "none",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "inherit",
                }}
              >
                {a.photo_url ? (
                  <img
                    src={a.photo_url}
                    style={{ width: 24, height: 16, objectFit: "cover", borderRadius: 0, flexShrink: 0 }}
                  />
                ) : (
                  <div style={{ width: 24, height: 16, borderRadius: 0, background: cfg.bg, flexShrink: 0 }} />
                )}
                <span style={{ fontSize: 12, fontWeight: 600, color: KR }}>@{a.tag_name.replace(/^@/, "")}</span>
                <span
                  style={{
                    fontSize: 10,
                    marginLeft: "auto",
                    padding: "1px 7px",
                    borderRadius: 0,
                    background: cfg.bg,
                    color: cfg.color,
                    border: `0.5px solid ${cfg.bd}`,
                    fontWeight: 600,
                  }}
                >
                  background
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MetaRows — uncontrolled(defaultValue+ref)로 한글 IME 버그 수정
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const MetaRows = ({
  fields,
  assets = [],
  onUpdate,
}: {
  fields: { camera_angle: string; mood: string; location: string; duration_sec: string };
  assets?: Asset[];
  onUpdate: (k: string, v: string) => void;
}) => {
  const [ek, setEk] = useState<string | null>(null);
  // ✅ 각 필드 input ref — commit 시점에 값 읽기
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  // 클릭 위치 오프셋 — editing 전환 후 커서 배치용
  const clickOffsetRef = useRef<number | null>(null);

  useEffect(() => {
    if (!ek) return;
    const fn = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        commitField(ek);
      }
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [ek]);

  // ek 이 바뀔 때 input 에 포커스 + 클릭 위치(없으면 끝)로 커서 이동
  // (setTimeout 대신 useEffect 로 처리 → autoFocus 와의 타이밍 충돌 방지)
  useEffect(() => {
    if (!ek) return;
    const el = inputRefs.current[ek];
    if (!el) return;
    el.focus();
    const len = el.value.length;
    const pos = Math.min(clickOffsetRef.current ?? len, len);
    el.setSelectionRange(pos, pos);
    clickOffsetRef.current = null;
  }, [ek]);

  // ✅ blur/Enter 시에만 부모 onUpdate 호출
  const commitField = (k: string) => {
    const newVal = inputRefs.current[k]?.value ?? (fields as any)[k] ?? "";
    setEk(null);
    onUpdate(k, newVal);
  };

  const startEdit = (k: string, offset?: number) => {
    clickOffsetRef.current = offset ?? null;
    setEk(k);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, k: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitField(k);
    } else if (e.key === "Escape") {
      // 취소 — 변경 버림
      setEk(null);
    }
  };

  const topRows = [
    {
      k: "camera_angle",
      icon: "M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2zM12 17a4 4 0 100-8 4 4 0 000 8",
      color: KR,
      label: "Camera",
    },
    {
      k: "mood",
      icon: "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z",
      color: "#f59e0b",
      label: "Mood",
    },
  ];

  return (
    <div ref={containerRef} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {topRows.map(({ k, icon, color, label }) => {
        const val = (fields as any)[k] as string;
        return (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 26 }}>
            <svg
              width={12}
              height={12}
              viewBox="0 0 24 24"
              fill="none"
              stroke={color}
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <path d={icon} />
            </svg>
            <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", width: 56, flexShrink: 0 }}>
              {label}
            </span>
            {ek === k ? (
              <input
                // ✅ ref로 등록 — defaultValue 사용(uncontrolled)
                ref={(el) => {
                  inputRefs.current[k] = el;
                }}
                defaultValue={val}
                onBlur={() => commitField(k)}
                onKeyDown={(e) => handleKeyDown(e, k)}
                autoFocus
                style={{
                  flex: 1,
                  border: `1.5px solid ${KR}`,
                  outline: "none",
                  borderRadius: 0,
                  padding: "2px 6px",
                  fontSize: 12,
                  background: "hsl(var(--background))",
                  color: "hsl(var(--foreground))",
                  fontFamily: "inherit",
                }}
              />
            ) : (
              <span
                onClick={(e) => {
                  const offset = val
                    ? getCaretOffsetFromPoint(
                        e.currentTarget as HTMLElement,
                        e.clientX,
                        e.clientY,
                        val.length,
                      )
                    : 0;
                  startEdit(k, offset);
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "hsl(var(--muted))")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                style={{
                  flex: 1,
                  fontSize: 12,
                  cursor: "text",
                  borderRadius: 0,
                  padding: "2px 6px",
                  margin: "-2px -6px",
                  color: val ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                  opacity: val ? 1 : 0.35,
                  transition: "background 0.1s",
                }}
              >
                {val || `+ Enter ${label.toLowerCase()}`}
              </span>
            )}
          </div>
        );
      })}

      {/* 장소 — LocationField (배경 에셋 @멘션 자동완성 포함) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 26 }}>
        <svg
          width={12}
          height={12}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#6b7280"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0zM12 13a3 3 0 100-6 3 3 0 000 6" />
        </svg>
        <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", width: 56, flexShrink: 0 }}>Location</span>
        <LocationField value={fields.location} assets={assets} onChange={(v) => onUpdate("location", v)} />
      </div>

      {/* Duration */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 26 }}>
        <svg
          width={12}
          height={12}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#94a3b8"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
        <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", width: 56, flexShrink: 0 }}>Duration</span>
        {ek === "duration_sec" ? (
          <input
            // ✅ duration도 동일하게 uncontrolled
            ref={(el) => {
              inputRefs.current["duration_sec"] = el;
            }}
            defaultValue={fields.duration_sec}
            type="number"
            min={1}
            max={120}
            onBlur={() => commitField("duration_sec")}
            onKeyDown={(e) => handleKeyDown(e, "duration_sec")}
            autoFocus
            style={{
              flex: 1,
              border: `1.5px solid ${KR}`,
              outline: "none",
              borderRadius: 0,
              padding: "2px 6px",
              fontSize: 12,
              background: "hsl(var(--background))",
              color: "hsl(var(--foreground))",
              fontFamily: "inherit",
            }}
          />
        ) : (
          <span
            onClick={() => startEdit("duration_sec")}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "hsl(var(--muted))")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
            style={{
              flex: 1,
              fontSize: 12,
              cursor: "text",
              borderRadius: 0,
              padding: "2px 6px",
              margin: "-2px -6px",
              transition: "background 0.1s",
              color: fields.duration_sec ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
              opacity: fields.duration_sec ? 1 : 0.35,
            }}
          >
            {fields.duration_sec ? `${fields.duration_sec}s` : "+ Enter time"}
          </span>
        )}
      </div>
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DescriptionField
// isComposing ref로 IME 조합 중 mention 감지 오작동 방지
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const DescriptionField = ({
  value,
  assets,
  existingTags = [],
  onChange,
}: {
  value: string;
  assets: Asset[];
  existingTags?: string[];
  onChange: (v: string, tags: string[]) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  const [mentionState, setMentionState] = useState<{ query: string; startIdx: number } | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const clickOffsetRef = useRef<number | null>(null);
  // ✅ IME 조합 중 여부 추적
  const isComposing = useRef(false);

  const autoResize = useCallback((ta: HTMLTextAreaElement) => {
    ta.style.height = "auto";
    ta.style.height = `${Math.max(ta.scrollHeight, 80)}px`;
  }, []);

  useEffect(() => {
    if (editing && textareaRef.current) {
      const ta = textareaRef.current;
      autoResize(ta);
      const offset = Math.min(clickOffsetRef.current ?? ta.value.length, ta.value.length);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(offset, offset);
      });
      clickOffsetRef.current = null;
    }
  }, [editing]);

  useEffect(() => {
    if (!editing) setVal(value);
  }, [value, editing]);

  const extractTags = (text: string) => {
    const fromText = [
      ...new Set(
        (text.match(/@([\w가-힣]+)/g) ?? [])
          .map((m) => {
            const r = resolveAsset(m, assets);
            return r ? r.name : null;
          })
          .filter((n): n is string => n !== null),
      ),
    ];
    const existingRaw = existingTags
      .map((t) => (t.startsWith("@") ? t.slice(1) : t))
      .filter((name) => assets.some((a) => a.tag_name === name || a.tag_name === `@${name}`));
    return [...new Set([...fromText, ...existingRaw])];
  };

  const commit = () => {
    setEditing(false);
    setMentionState(null);
    onChange(val, extractTags(val));
  };

  const detectMention = (v: string, pos: number) => {
    const m = v.slice(0, pos).match(/@([\w가-힣]*)$/);
    if (m) {
      setMentionState({ query: m[1], startIdx: pos - m[0].length });
      setSelectedIdx(0);
    } else {
      setMentionState(null);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    const pos = e.target.selectionStart ?? v.length;
    setVal(v);
    if (textareaRef.current) autoResize(textareaRef.current);
    // ✅ IME 조합 중에는 mention 감지 건너뜀
    if (!isComposing.current) {
      detectMention(v, pos);
    }
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    isComposing.current = false;
    // 조합 완료 후 mention 재감지
    const ta = e.target as HTMLTextAreaElement;
    detectMention(ta.value, ta.selectionStart ?? ta.value.length);
  };

  const handleMentionSelect = (asset: Asset) => {
    if (!mentionState || !textareaRef.current) return;
    const ta = textareaRef.current;
    const name = asset.tag_name.startsWith("@") ? asset.tag_name.slice(1) : asset.tag_name;
    const before = val.slice(0, mentionState.startIdx);
    const atEnd = mentionState.startIdx + 1 + mentionState.query.length;
    const after = val.slice(atEnd);
    const newVal = `${before}@${name} ${after}`;
    setVal(newVal);
    setMentionState(null);
    const newPos = before.length + name.length + 2;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newPos, newPos);
    });
  };

  const suggestions = mentionState
    ? assets
        .filter((a) => a.tag_name.replace(/^@/, "").toLowerCase().includes(mentionState.query.toLowerCase()))
        .slice(0, 6)
    : [];

  if (editing)
    return (
      <div style={{ position: "relative" }}>
        <textarea
          ref={textareaRef}
          value={val}
          onChange={handleChange}
          // ✅ IME 조합 시작/종료
          onCompositionStart={() => {
            isComposing.current = true;
          }}
          onCompositionEnd={handleCompositionEnd}
          onBlur={() => setTimeout(commit, 150)}
          onKeyDown={(e) => {
            if (suggestions.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIdx((i) => Math.min(i + 1, suggestions.length - 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIdx((i) => Math.max(i - 1, 0));
                return;
              }
              if ((e.key === "Enter" || e.key === "Tab") && selectedIdx >= 0) {
                e.preventDefault();
                handleMentionSelect(suggestions[selectedIdx]);
                return;
              }
            }
            if (e.key === "Escape") {
              e.stopPropagation();
              if (mentionState) setMentionState(null);
              else commit();
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.stopPropagation();
              commit();
            }
          }}
          placeholder="Enter scene description... (@tag for assets)"
          className="w-full outline-none resize-none text-[12px] leading-relaxed"
          style={{
            borderRadius: 0,
            padding: "6px 8px",
            border: `1.5px solid ${KR}`,
            background: "hsl(var(--background))",
            color: "hsl(var(--foreground))",
            fontFamily: "inherit",
            boxSizing: "border-box",
            minHeight: 80,
            overflow: "hidden",
          }}
        />
        {suggestions.length > 0 && (
          <div
            className="absolute z-50 left-0 right-0 overflow-hidden"
            style={{
              background: "#1c1c1c",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 0,
              boxShadow: "0 8px 28px rgba(0,0,0,0.5)",
              top: "calc(100% + 4px)",
            }}
          >
            {suggestions.map((asset, idx) => (
              <button
                key={asset.tag_name}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleMentionSelect(asset);
                }}
                onMouseEnter={() => setSelectedIdx(idx)}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors"
                style={{ borderRadius: 0, background: idx === selectedIdx ? "rgba(249,66,58,0.15)" : "transparent" }}
                onMouseMove={() => setSelectedIdx(idx)}
              >
                {asset.photo_url ? (
                  <img src={asset.photo_url} className="w-6 h-6 rounded-none object-cover shrink-0" />
                ) : (
                  <div
                    className="w-6 h-6 rounded-none flex items-center justify-center shrink-0"
                    style={{ background: KR_BG }}
                  >
                    <span className="text-[10px] font-bold" style={{ color: KR }}>
                      {asset.tag_name.replace(/^@/, "").slice(0, 1)}
                    </span>
                  </div>
                )}
                <span className="text-[12px] font-semibold" style={{ color: KR }}>
                  @{asset.tag_name.replace(/^@/, "")}
                </span>
                {asset.asset_type && (
                  <span
                    className="text-[10px] ml-auto px-1.5 py-0.5 rounded-none"
                    style={{
                      background: (ACFG[asset.asset_type] || ACFG.character).bg,
                      color: (ACFG[asset.asset_type] || ACFG.character).color,
                    }}
                  >
                    {asset.asset_type === "character"
                      ? "character"
                      : asset.asset_type === "item"
                        ? "item"
                        : "background"}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );

  // 뷰 모드 — description 텍스트의 @멘션만 TagChip 렌더링
  const parts = value ? value.split(/(@[\w가-힣]+)/g) : [];
  return (
    <div
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();

        const container = e.currentTarget;
        const doc = document as Document & {
          caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
          caretRangeFromPoint?: (x: number, y: number) => Range | null;
        };

        const getOffsetFromNode = (targetNode: Node, targetOffset: number) => {
          const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
          let charCount = 0;
          let node: Node | null;
          while ((node = walker.nextNode())) {
            if (node === targetNode) return charCount + targetOffset;
            charCount += node.textContent?.length ?? 0;
          }
          return value.length;
        };

        let offset = value.length;
        const caretPos = doc.caretPositionFromPoint?.(e.clientX, e.clientY);
        if (caretPos) offset = getOffsetFromNode(caretPos.offsetNode, caretPos.offset);
        else {
          const range = doc.caretRangeFromPoint?.(e.clientX, e.clientY);
          if (range) offset = getOffsetFromNode(range.startContainer, range.startOffset);
        }

        clickOffsetRef.current = Math.min(offset, value.length);
        setEditing(true);
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "hsl(var(--muted))")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
      style={{
        fontSize: 12,
        color: "hsl(var(--muted-foreground))",
        lineHeight: 1.7,
        cursor: "text",
        borderRadius: 0,
        padding: "3px 5px",
        margin: "-3px -5px",
        minHeight: 100,
        transition: "background 0.1s",
      }}
    >
      {value ? (
        parts.map((p, i) => {
          if (/^@[\w가-힣]+$/.test(p)) {
            const resolved = resolveAsset(p, assets);
            if (resolved) {
              const rawName = p.slice(1);
              const suffix = rawName.slice(resolved.name.length);
              return (
                <span key={i}>
                  <TagChip name={resolved.name} assetType={resolved.asset.asset_type || "character"} />
                  {suffix}
                </span>
              );
            }
            return <span key={i}>{p}</span>;
          }
          return <span key={i}>{p}</span>;
        })
      ) : (
        <span style={{ opacity: 0.3 }}>Enter scene description...</span>
      )}
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SidePanel
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const SidePanel = ({
  hasImage,
  openLeft,
  hasMultipleVersions,
  onDuplicate,
  onDelete,
  onUpload,
  onDeleteImage,
  onCompare,
  onInpaint,
  onSetThumbnail,
  onAdjustImage,
}: {
  hasImage: boolean;
  openLeft: boolean;
  hasMultipleVersions: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  onUpload: () => void;
  onDeleteImage: () => void;
  onCompare: () => void;
  onInpaint: () => void;
  onSetThumbnail?: () => void;
  onAdjustImage?: () => void;
}) => {
  const [hovIdx, setHovIdx] = useState(-1);
  const items: ({ icon: React.ReactNode; label: string; fn: () => void; danger: boolean } | null)[] = [
    { icon: <Copy className="w-3.5 h-3.5" />, label: "Duplicate scene", fn: onDuplicate, danger: false },
    ...(hasMultipleVersions
      ? [{ icon: <Columns2 className="w-3.5 h-3.5" />, label: "Compare versions", fn: onCompare, danger: false }]
      : []),
    ...(hasImage
      ? [{ icon: <Paintbrush className="w-3.5 h-3.5" />, label: "Inpaint", fn: onInpaint, danger: false }]
      : []),
    ...(hasImage && onSetThumbnail
      ? [{ icon: <ImageIcon className="w-3.5 h-3.5" />, label: "Set as Thumbnail", fn: onSetThumbnail, danger: false }]
      : []),
    ...(hasImage && onAdjustImage
      ? [{ icon: <Crop className="w-3.5 h-3.5" />, label: "Adjust Image", fn: onAdjustImage, danger: false }]
      : []),
    null,
    { icon: <Upload className="w-3.5 h-3.5" />, label: "Upload Image", fn: onUpload, danger: false },
    ...(hasImage
      ? [{ icon: <X className="w-3.5 h-3.5" />, label: "Delete image", fn: onDeleteImage, danger: true } as const]
      : []),
    { icon: <Trash2 className="w-3.5 h-3.5" />, label: "Delete scene", fn: onDelete, danger: true },
  ];
  return (
    <div
      style={{
        position: "absolute",
        zIndex: 200,
        top: 36,
        ...(openLeft ? { right: 44 } : { left: "calc(100% - 2px)" }),
        background: "#1c1c1c",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 0,
        minWidth: 168,
        overflow: "hidden",
        boxShadow: "0 8px 28px rgba(0,0,0,0.5)",
      }}
    >
      {items.map((item, i) => {
        if (!item) return <div key={i} style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "2px 0" }} />;
        return (
          <button
            key={i}
            onMouseEnter={() => setHovIdx(i)}
            onMouseLeave={() => setHovIdx(-1)}
            onClick={(e) => {
              e.stopPropagation();
              item.fn();
            }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 14px",
              fontSize: 12,
              cursor: "pointer",
              border: "none",
              textAlign: "left",
              fontFamily: "inherit",
              background:
                hovIdx === i ? (item.danger ? "rgba(220,38,38,0.12)" : "rgba(255,255,255,0.06)") : "transparent",
              color: item.danger ? "#f87171" : "rgba(255,255,255,0.85)",
              transition: "background 0.1s",
            }}
          >
            <span style={{ color: item.danger ? "#f87171" : "rgba(255,255,255,0.4)", display: "flex" }}>
              {item.icon}
            </span>
            {item.label}
          </button>
        );
      })}
    </div>
  );
};
