import React from "react";

type AssetType = "character" | "item" | "background";

const ASSET_COLORS: Record<AssetType, { color: string; bg: string; bd: string }> = {
  character: { color: "#6366f1", bg: "rgba(99,102,241,0.12)", bd: "rgba(99,102,241,0.25)" },
  item: { color: "#d97706", bg: "rgba(245,158,11,0.12)", bd: "rgba(245,158,11,0.25)" },
  background: { color: "#059669", bg: "rgba(16,185,129,0.12)", bd: "rgba(16,185,129,0.25)" },
};

const FALLBACK = { color: "#f9423a", bg: "rgba(249,66,58,0.12)", bd: "rgba(249,66,58,0.25)" };

interface Asset {
  tag_name: string;
  photo_url?: string | null;
  ai_description?: string | null;
  asset_type?: string;
}

export function renderMessageWithMentions(text: string, assets: Asset[]): React.ReactNode {
  if (!assets || assets.length === 0) return text;

  const tagColorMap = new Map<string, { color: string; bg: string; bd: string }>();
  assets.forEach((a) => {
    const tag = a.tag_name.startsWith("@") ? a.tag_name : `@${a.tag_name}`;
    const type = (a.asset_type ?? "character") as AssetType;
    tagColorMap.set(tag, ASSET_COLORS[type] ?? FALLBACK);
  });

  // Sort longest-first so a longer tag (e.g. "@BG_medium") wins the regex
  // alternation against a shorter prefix tag ("@BG"). JS regex alternation
  // returns the leftmost-listed alternative that matches at a position, so
  // without this sort `@BG_medium` would be split into a `@BG` chip + a
  // stray `_medium` text node.
  const tags = [...tagColorMap.keys()].sort((a, b) => b.length - a.length);
  if (tags.length === 0) return text;

  const pattern = new RegExp(`(${tags.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  const parts = text.split(pattern);

  return (
    <>
      {parts.map((part, i) => {
        const colors = tagColorMap.get(part);
        return colors ? (
          <span
            key={i}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "3px",
              padding: "1px 8px",
              borderRadius: "9999px",
              fontSize: "11px",
              fontWeight: 600,
              background: colors.bg,
              color: colors.color,
              border: `1px solid ${colors.bd}`,
              lineHeight: "1.6",
            }}
          >
            {part}
          </span>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        );
      })}
    </>
  );
}
