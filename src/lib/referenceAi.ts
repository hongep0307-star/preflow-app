import { callOpenAI } from "./openai";
import { updateReference, type ReferenceItem } from "./referenceLibrary";

export interface ReferenceAiSuggestions {
  suggested_tags: string[];
  mood_labels: string[];
  visual_style?: string;
  content_type?: string;
  shot_type?: string;
  color_notes?: string;
  motion_notes?: string;
  use_cases: string[];
  avoid_notes?: string;
  brief_fit?: string;
  asset_candidate?: string;
  agent_use?: string;
  conti_use?: string;
  promote_to_asset_reason?: string;
  classification_input?: "visual" | "text";
  error?: unknown;
}

const EMPTY_SUGGESTIONS: ReferenceAiSuggestions = {
  suggested_tags: [],
  mood_labels: [],
  use_cases: [],
};

type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

async function urlToDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read image"));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function safeJson(text: string): ReferenceAiSuggestions {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(cleaned) as Partial<ReferenceAiSuggestions>;
  return {
    ...EMPTY_SUGGESTIONS,
    ...parsed,
    suggested_tags: Array.isArray(parsed.suggested_tags) ? parsed.suggested_tags.slice(0, 12) : [],
    mood_labels: Array.isArray(parsed.mood_labels) ? parsed.mood_labels.slice(0, 8) : [],
    use_cases: Array.isArray(parsed.use_cases) ? parsed.use_cases.slice(0, 8) : [],
  };
}

export async function classifyReference(item: ReferenceItem): Promise<ReferenceItem> {
  await updateReference(item.id, { classification_status: "pending" });

  const imageUrl = item.thumbnail_url || (item.kind === "image" || item.kind === "webp" || item.kind === "gif" ? item.file_url : null);
  const dataUrl = imageUrl ? await urlToDataUrl(imageUrl) : null;
  const inputMode = dataUrl ? "visual" : "text";
  const text = [
    `Title: ${item.title}`,
    `Kind: ${item.kind}`,
    item.source_url ? `Source URL: ${item.source_url}` : "",
    item.notes ? `User notes: ${item.notes}` : "",
    item.tags.length > 0 ? `Existing tags: ${item.tags.join(", ")}` : "",
    dataUrl ? "" : "No thumbnail/poster image was available. Classify from metadata only and avoid claiming visual details you cannot see.",
  ].filter(Boolean).join("\n");

  const content: OpenAIContentPart[] = [
    {
      type: "text",
      text: `Classify this visual reference for a video pre-production library.\n\n${text}\n\nReturn ONLY valid JSON with this shape:\n{\n  "suggested_tags": string[],\n  "mood_labels": string[],\n  "visual_style": string,\n  "content_type": string,\n  "shot_type": string,\n  "color_notes": string,\n  "motion_notes": string,\n  "use_cases": string[],\n  "avoid_notes": string,\n  "brief_fit": string,\n  "asset_candidate": string,\n  "agent_use": string,\n  "conti_use": string,\n  "promote_to_asset_reason": string\n}`,
    },
  ];
  if (dataUrl) content.push({ type: "image_url", image_url: { url: dataUrl } });

  try {
    const response = await callOpenAI({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content }],
      max_completion_tokens: 900,
      response_format: { type: "json_object" },
      temperature: 0.2,
    });
    const raw = response.choices?.[0]?.message?.content;
    if (!raw) throw new Error("Empty AI response");
    const suggestions = safeJson(raw);
    return updateReference(item.id, {
      ai_suggestions: {
        ...suggestions,
        classification_input: inputMode,
      } as unknown as Record<string, unknown>,
      classification_status: "ready",
      classified_at: new Date().toISOString(),
    });
  } catch (err) {
    await updateReference(item.id, {
      ai_suggestions: {
        error: err instanceof Error ? err.message : String(err),
      },
      classification_status: "failed",
    });
    throw err;
  }
}

export async function acceptReferenceAiSuggestions(item: ReferenceItem): Promise<ReferenceItem> {
  const suggestions = item.ai_suggestions as Partial<ReferenceAiSuggestions> | null | undefined;
  if (!suggestions) return item;
  const nextTags = [
    ...item.tags,
    ...(Array.isArray(suggestions.suggested_tags) ? suggestions.suggested_tags : []),
    ...(Array.isArray(suggestions.mood_labels) ? suggestions.mood_labels : []),
  ];
  const notesAppend = [
    suggestions.visual_style ? `Visual style: ${suggestions.visual_style}` : "",
    suggestions.motion_notes ? `Motion: ${suggestions.motion_notes}` : "",
    suggestions.brief_fit ? `Brief fit: ${suggestions.brief_fit}` : "",
    suggestions.conti_use ? `Conti use: ${suggestions.conti_use}` : "",
  ].filter(Boolean).join("\n");
  return updateReference(item.id, {
    tags: [...new Set(nextTags.map((tag) => tag.trim()).filter(Boolean))],
    notes: [item.notes, notesAppend].filter(Boolean).join("\n\n") || null,
  });
}
