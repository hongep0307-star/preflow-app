import { describe, it, expect } from "vitest";
import {
  buildBriefSignalsFromAnalysis,
  extractSceneSignals,
  scoreReferences,
} from "@/lib/referenceRecommender";
import type { ReferenceItem } from "@/lib/referenceLibrary";

function makeRef(over: Partial<ReferenceItem>): ReferenceItem {
  return {
    id: over.id ?? "ref",
    kind: over.kind ?? "image",
    title: over.title ?? "Untitled",
    tags: over.tags ?? [],
    timestamp_notes: [],
    color_palette: [],
    ...over,
  } as ReferenceItem;
}

describe("referenceRecommender.scoreReferences", () => {
  it("user-tagged matches outscore AI-suggested matches with the same overlap", () => {
    const userTagged = makeRef({
      id: "user",
      title: "Neon Tokyo Street",
      tags: ["neon", "tokyo"],
    });
    const aiTagged = makeRef({
      id: "ai",
      title: "Some name",
      tags: [],
      ai_suggestions: { suggested_tags: ["neon", "tokyo"], mood_labels: [], use_cases: [] },
    });
    const signals = buildBriefSignalsFromAnalysis({
      toneKeywords: ["neon", "tokyo"],
      moodSummary: "",
    });
    const ranked = scoreReferences(signals, [userTagged, aiTagged]);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]!.item.id).toBe("user");
  });

  it("returns empty when all signal buckets are empty", () => {
    const item = makeRef({ id: "x", tags: ["neon"] });
    const ranked = scoreReferences(
      { mood: [], genre: [], product: [], location: [], keywords: [] },
      [item],
    );
    expect(ranked).toEqual([]);
  });

  it("excludes deleted references and items in excludeIds", () => {
    const trashed = makeRef({ id: "trashed", tags: ["neon"], deleted_at: new Date().toISOString() });
    const attached = makeRef({ id: "attached", tags: ["neon"] });
    const fresh = makeRef({ id: "fresh", tags: ["neon"] });
    const signals = buildBriefSignalsFromAnalysis({ toneKeywords: ["neon"] });
    const ranked = scoreReferences(signals, [trashed, attached, fresh], {
      excludeIds: new Set(["attached"]),
    });
    expect(ranked.map((r) => r.item.id)).toEqual(["fresh"]);
  });

  it("emits reason chips with the matching signal category prefix", () => {
    const item = makeRef({ id: "a", tags: ["handheld"] });
    const sceneSignals = extractSceneSignals({ shot: ["handheld"] });
    const ranked = scoreReferences(sceneSignals, [item]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.reasons).toContain("shot:handheld");
  });

  it("link references are excluded from default kind whitelist", () => {
    const link = makeRef({ id: "link", kind: "link", tags: ["neon"] });
    const signals = buildBriefSignalsFromAnalysis({ toneKeywords: ["neon"] });
    expect(scoreReferences(signals, [link])).toEqual([]);
  });
});
