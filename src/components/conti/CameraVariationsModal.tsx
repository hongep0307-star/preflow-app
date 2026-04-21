/**
 * CameraVariationsModal — generates multiple camera-angle variations of a scene
 * via pure text-to-image rendering (not image edit).
 *
 * Why text-to-image instead of editing the source:
 *   NB2 (Gemini 3.1 Flash Image) is unreliable at 3D camera re-composition of an
 *   existing image. When given a source image plus "rotate the camera" it tends
 *   to either (a) return the source unchanged or (b) rotate only the subject in
 *   2D while leaving the background static. It is, however, very good at
 *   rendering new images from a scene description + character/location reference
 *   images. This modal leans into that strength:
 *
 *     scene.description + tagged_assets (photo refs) + camera-preset phrase
 *       → new image per selected preset, in parallel (concurrency 3)
 *
 * The preset phrase is injected by overriding scene.camera_angle. buildContiPrompt
 * already consumes camera_angle as "SHOT TYPE (MANDATORY)", so an explicit
 * cinematographic phrase (e.g. "low-angle shot looking up...") becomes the
 * governing shot directive for that variation.
 *
 * Pipeline: delegates to a `generate(overrideScene)` callback supplied by
 * ContiTab, which internally calls generateConti with the tab's full context
 * (briefAnalysis, currentStyle, moodReferenceUrl, contiModel). This keeps the
 * modal decoupled from project-level state and ensures variations respect the
 * same rules as a normal Regenerate.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Images,
  Loader2,
  X,
  Check,
  RotateCcw,
  Trash2,
  ArrowLeft,
} from "lucide-react";
import type { Scene } from "./contiTypes";
import { IMAGE_SIZE_MAP } from "@/lib/conti";

type VideoFormat = keyof typeof IMAGE_SIZE_MAP;

/* ━━━ Types ━━━ */
interface CameraPreset {
  id: string;
  label: string;
  shortDesc: string;
  /** Injected into scene.camera_angle for this variation. */
  phrase: string;
  recommended?: boolean;
}

type SlotStatus = "queued" | "generating" | "success" | "error";

interface VariationSlot {
  presetId: string;
  status: SlotStatus;
  url: string | null;
  error: string | null;
}

/* ━━━ Constants ━━━ */
// Preset phrases are written in the imperative, cinematographer-style language
// NB2 responds to most reliably: a concrete camera position + what it sees +
// framing qualifiers. These get injected into the SHOT TYPE (MANDATORY) block
// of the conti prompt, so they are the single strongest directive the model
// receives about how this frame should be composed.
const CAMERA_PRESETS: CameraPreset[] = [
  {
    id: "wide",
    label: "Wide establishing",
    shortDesc: "Full environment visible",
    phrase:
      "EXTREME WIDE ESTABLISHING SHOT. Camera pulled far back. Subject small within the frame, integrated into the full environment. Deep-space composition with clear foreground, midground, and background layers. Landscape-oriented framing showing the whole location.",
    recommended: true,
  },
  {
    id: "medium",
    label: "Medium shot",
    shortDesc: "Waist-up, eye level",
    phrase:
      "MEDIUM SHOT. Camera at eye level. Subject framed from the waist up, centered, with moderate headroom. Background present but softly secondary.",
  },
  {
    id: "close",
    label: "Close-up",
    shortDesc: "Subject fills the frame",
    phrase:
      "TIGHT CLOSE-UP. Camera moved in very close. Subject's face and upper chest fill the frame. Strong shallow depth of field, background reduced to creamy bokeh. Intimate and detailed.",
    recommended: true,
  },
  {
    id: "low_angle",
    label: "Low angle",
    shortDesc: "Looking up, heroic",
    phrase:
      "LOW-ANGLE HEROIC SHOT. Camera placed below waist height, tilted upward at the subject. The subject towers into the frame against the sky or ceiling. Strong upward foreshortening, dramatic imposing perspective.",
  },
  {
    id: "high_angle",
    label: "High angle",
    shortDesc: "Looking down, observational",
    phrase:
      "HIGH-ANGLE SHOT. Camera placed well above the subject, tilted downward. Subject appears smaller and vulnerable, ground or floor visible around them. Slightly detached observational perspective.",
  },
  {
    id: "over_shoulder",
    label: "Over the shoulder",
    shortDesc: "POV from behind a character",
    phrase:
      "OVER-THE-SHOULDER SHOT. Camera positioned just behind one character's shoulder, looking past it toward the rest of the scene. The foreground shoulder and back of the head are softly out of focus. Classic conversation framing.",
  },
  {
    id: "dutch",
    label: "Dutch tilt",
    shortDesc: "Canted, uneasy",
    phrase:
      "DUTCH ANGLE. Camera rolled roughly 15–25 degrees so the horizon line is noticeably canted. Dynamic off-kilter tension. Subject still centered but the whole frame feels tilted.",
  },
  {
    id: "overhead",
    label: "Overhead",
    shortDesc: "Top-down bird's-eye",
    phrase:
      "OVERHEAD TOP-DOWN SHOT. Camera directly above the subject, lens pointed straight down toward the floor. Bird's-eye view. Subject and surrounding floor elements laid out as a flat-lay composition.",
  },
];

const CONCURRENCY = 3;

/* ━━━ Small helpers ━━━ */
/**
 * Build the scene-with-overridden-camera-angle that gets sent to generateConti.
 *
 * The preset phrase lands inside buildContiPrompt's SHOT TYPE (MANDATORY)
 * block, giving it the highest prompt priority. We deliberately do NOT append
 * any "preserve the reference image exactly" clause here — that kind of
 * language pushes NB2 into copy-mode, where it freezes geometry and changes
 * only surface effects. Identity preservation must come from clean
 * tagged_assets reference photos (character portraits, location stills) that
 * generateConti already supplies via fetchTaggedAssets, not from textual
 * pleas to the model.
 */
const buildVariationScene = (scene: Scene, preset: CameraPreset, notes: string): Scene => {
  const trimmedNotes = notes.trim();
  const camera = trimmedNotes ? `${preset.phrase} ${trimmedNotes}` : preset.phrase;
  return { ...scene, camera_angle: camera };
};

/* ━━━ Palette ━━━ */
// Accent color is kept in sync with the Generate button so the whole modal
// reads as a single red-accented surface.
const ACCENT = "#dc2626";
const ACCENT_SOFT_BG = "rgba(220, 38, 38, 0.12)";
const ACCENT_SOFT_BORDER = "rgba(220, 38, 38, 0.55)";

/* ━━━ Styles ━━━ */
const BACKDROP_STYLE: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 100,
  background: "rgba(0,0,0,0.65)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
};

const PANEL_STYLE: React.CSSProperties = {
  background: "#121212",
  border: "1px solid rgba(255,255,255,0.08)",
  width: "min(1100px, 100%)",
  height: "min(90vh, 820px)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const HEADER_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "14px 20px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  userSelect: "none",
  flexShrink: 0,
};

const FOOTER_STYLE: React.CSSProperties = {
  padding: "12px 20px",
  borderTop: "1px solid rgba(255,255,255,0.06)",
  display: "flex",
  alignItems: "center",
  gap: 10,
  justifyContent: "flex-end",
  flexShrink: 0,
  background: "#0e0e0e",
};

/* ━━━ Main modal ━━━ */
export interface CameraVariationsModalProps {
  scene: Scene;
  videoFormat: VideoFormat;
  onClose: () => void;
  onApplied: (newUrl: string, previousUrl: string | null) => void | Promise<void>;
  /**
   * Called with a modified scene (camera_angle overridden with a preset phrase).
   * ContiTab wraps its normal generateConti call here so variations share
   * briefAnalysis / style / mood / model context with Regenerate.
   */
  generate: (overrideScene: Scene) => Promise<string>;
}

export function CameraVariationsModal({
  scene,
  videoFormat: _videoFormat,
  onClose,
  onApplied,
  generate,
}: CameraVariationsModalProps) {
  const sourceUrl = scene.conti_image_url;

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(CAMERA_PRESETS.filter((p) => p.recommended).map((p) => p.id)),
  );
  const [notes, setNotes] = useState("");
  const [phase, setPhase] = useState<"setup" | "results">("setup");
  const [slots, setSlots] = useState<Record<string, VariationSlot>>({});
  const [applyingFromUrl, setApplyingFromUrl] = useState<string | null>(null);

  // Track which presets are currently running so we only start CONCURRENCY at a time.
  const activeCountRef = useRef(0);
  const pendingQueueRef = useRef<string[]>([]);
  const cancelledRef = useRef(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !applyingFromUrl) onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [applyingFromUrl, onClose]);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const hasAnySlots = Object.keys(slots).length > 0;

  const togglePreset = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(CAMERA_PRESETS.map((p) => p.id)));
  const selectNone = () => setSelected(new Set());
  const selectRecommended = () =>
    setSelected(new Set(CAMERA_PRESETS.filter((p) => p.recommended).map((p) => p.id)));

  /** Run one variation for a given preset id, writing results into slot state. */
  const runVariation = async (presetId: string) => {
    const preset = CAMERA_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    setSlots((prev) => ({
      ...prev,
      [presetId]: { ...(prev[presetId] ?? { presetId, url: null, error: null }), status: "generating" },
    }));

    try {
      const overrideScene = buildVariationScene(scene, preset, notes);
      const url = await generate(overrideScene);
      if (cancelledRef.current) return;
      setSlots((prev) => ({
        ...prev,
        [presetId]: { presetId, status: "success", url, error: null },
      }));
    } catch (e) {
      if (cancelledRef.current) return;
      const message = e instanceof Error ? e.message : String(e);
      setSlots((prev) => ({
        ...prev,
        [presetId]: { presetId, status: "error", url: null, error: message },
      }));
    }
  };

  /** Pump the pending queue up to CONCURRENCY in parallel. */
  const drainQueue = () => {
    while (activeCountRef.current < CONCURRENCY && pendingQueueRef.current.length > 0) {
      const nextId = pendingQueueRef.current.shift()!;
      activeCountRef.current++;
      void runVariation(nextId).finally(() => {
        activeCountRef.current--;
        drainQueue();
      });
    }
  };

  /**
   * Which currently-selected presets still need a fresh generation?
   * Skip anything already succeeded or currently running; retry errors.
   * Kept as a derived value so the footer can show an honest count and
   * disable the button when there is nothing meaningful to do.
   */
  const toGenerateIds = useMemo(() => {
    return CAMERA_PRESETS.filter((p) => selected.has(p.id))
      .filter((p) => {
        const slot = slots[p.id];
        if (!slot) return true;
        if (slot.status === "error") return true;
        return false;
      })
      .map((p) => p.id);
  }, [selected, slots]);

  const handleGenerate = () => {
    if (toGenerateIds.length === 0) return;

    // Merge new queued entries into existing slots — results from earlier
    // Generate cycles stay visible. Phase switch is cosmetic; slots persist
    // regardless of which panel is showing.
    setSlots((prev) => {
      const next = { ...prev };
      for (const id of toGenerateIds) {
        next[id] = { presetId: id, status: "queued", url: null, error: null };
      }
      return next;
    });

    // In case the user re-opened setup after a cancel, reset the cancel flag.
    cancelledRef.current = false;
    pendingQueueRef.current.push(...toGenerateIds);
    setPhase("results");
    drainQueue();
  };

  const handleReroll = (presetId: string) => {
    setSlots((prev) => ({
      ...prev,
      [presetId]: { presetId, status: "queued", url: null, error: null },
    }));
    pendingQueueRef.current.push(presetId);
    drainQueue();
  };

  const handleDiscard = (presetId: string) => {
    setSlots((prev) => {
      const next = { ...prev };
      delete next[presetId];
      return next;
    });
  };

  const handleApplyResult = async (url: string) => {
    if (applyingFromUrl) return;
    setApplyingFromUrl(url);
    try {
      await onApplied(url, sourceUrl);
      onClose();
    } catch (e) {
      console.error("[CameraVariations] apply failed:", e);
      setApplyingFromUrl(null);
    }
  };

  /**
   * "Back to presets" is now purely a view switch — existing results (success,
   * error, or still-running) are preserved. This lets the user iteratively
   * pick different camera angles across several Generate cycles without
   * losing any prior work. Use the Discard button on an individual result
   * card (or close the modal) to drop specific slots.
   */
  const handleBackToSetup = () => {
    setPhase("setup");
  };

  if (!sourceUrl) {
    return (
      <div style={BACKDROP_STYLE} onClick={onClose}>
        <div
          style={{ ...PANEL_STYLE, padding: 24, height: "auto" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 13 }}>
            No source scene image yet — generate the scene first, then use Camera Variations.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={BACKDROP_STYLE} onClick={onClose}>
      <div style={PANEL_STYLE} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={HEADER_STYLE}>
          <Images className="w-4 h-4" style={{ color: "rgba(255,255,255,0.78)" }} />
          <div
            style={{
              color: "rgba(255,255,255,0.95)",
              fontSize: 14,
              fontWeight: 600,
              flex: 1,
              letterSpacing: 0.1,
            }}
          >
            Camera Variations
          </div>
          <button
            onClick={onClose}
            disabled={!!applyingFromUrl}
            className="text-white/60 hover:text-white/90 disabled:opacity-40"
            style={{ background: "transparent", border: "none", cursor: "pointer", display: "flex" }}
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: "minmax(260px, 320px) 1fr",
            overflow: "hidden",
          }}
        >
          {/* Left: scene reference */}
          <div
            style={{
              borderRight: "1px solid rgba(255,255,255,0.06)",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              background: "#0e0e0e",
            }}
          >
            <div
              style={{
                padding: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#0a0a0a",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <img
                src={sourceUrl}
                alt={`Scene ${scene.scene_number}`}
                style={{
                  maxWidth: "100%",
                  maxHeight: 220,
                  objectFit: "contain",
                  display: "block",
                }}
              />
            </div>
            <div
              style={{
                padding: "12px 14px",
                overflow: "auto",
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div>
                <div
                  style={{
                    color: "rgba(255,255,255,0.5)",
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: 0.6,
                    textTransform: "uppercase",
                    marginBottom: 4,
                  }}
                >
                  Scene description
                </div>
                <div style={{ color: "rgba(255,255,255,0.82)", fontSize: 12, lineHeight: 1.5 }}>
                  {scene.description || <span style={{ opacity: 0.5 }}>No description set</span>}
                </div>
              </div>
              {scene.tagged_assets && scene.tagged_assets.length > 0 && (
                <div>
                  <div
                    style={{
                      color: "rgba(255,255,255,0.5)",
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: 0.6,
                      textTransform: "uppercase",
                      marginBottom: 4,
                    }}
                  >
                    Tags referenced
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {scene.tagged_assets.map((t) => (
                      <span
                        key={t}
                        style={{
                          fontSize: 10,
                          fontFamily: "'SF Mono', monospace",
                          color: "rgba(255,255,255,0.75)",
                          background: "rgba(255,255,255,0.06)",
                          padding: "2px 6px",
                          borderRadius: 2,
                        }}
                      >
                        {t.startsWith("@") ? t : `@${t}`}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {(scene.location || scene.mood) && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr",
                    columnGap: 8,
                    rowGap: 4,
                    fontSize: 11,
                  }}
                >
                  {scene.location && (
                    <>
                      <div style={{ color: "rgba(255,255,255,0.45)" }}>Location</div>
                      <div style={{ color: "rgba(255,255,255,0.8)" }}>{scene.location}</div>
                    </>
                  )}
                  {scene.mood && (
                    <>
                      <div style={{ color: "rgba(255,255,255,0.45)" }}>Mood</div>
                      <div style={{ color: "rgba(255,255,255,0.8)" }}>{scene.mood}</div>
                    </>
                  )}
                </div>
              )}
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.5)",
                  lineHeight: 1.5,
                  marginTop: 4,
                  padding: "8px 10px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                Each selected preset will render a{" "}
                <span style={{ color: "rgba(255,255,255,0.82)" }}>new image</span> from the scene
                description + tag references, with that preset's camera angle. Original scene image
                is kept until you apply one.
              </div>
            </div>
          </div>

          {/* Right: presets or results */}
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            {phase === "setup" ? (
              <SetupPanel
                scene={scene}
                slots={slots}
                selected={selected}
                togglePreset={togglePreset}
                selectAll={selectAll}
                selectNone={selectNone}
                selectRecommended={selectRecommended}
                notes={notes}
                setNotes={setNotes}
              />
            ) : (
              <ResultsPanel
                slots={slots}
                applyingFromUrl={applyingFromUrl}
                onApplyResult={handleApplyResult}
                onReroll={handleReroll}
                onDiscard={handleDiscard}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={FOOTER_STYLE}>
          {phase === "results" ? (
            <button
              onClick={handleBackToSetup}
              disabled={!!applyingFromUrl}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.14)",
                color: "rgba(255,255,255,0.8)",
                padding: "6px 10px",
                fontSize: 12,
                cursor: applyingFromUrl ? "not-allowed" : "pointer",
                marginRight: "auto",
              }}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to presets
            </button>
          ) : (
            // In setup we still want status text on the left when there are
            // already-generated variations, so the user knows results are kept.
            hasAnySlots && (
              <button
                onClick={() => setPhase("results")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.14)",
                  color: "rgba(255,255,255,0.8)",
                  padding: "6px 10px",
                  fontSize: 12,
                  cursor: "pointer",
                  marginRight: "auto",
                }}
              >
                View results ({Object.keys(slots).length})
              </button>
            )
          )}
          <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11 }}>
            {phase === "setup" ? summarizeSetup(selected, slots, toGenerateIds.length) : summarizeSlots(slots)}
          </div>
          {phase === "setup" && (
            <button
              onClick={handleGenerate}
              disabled={toGenerateIds.length === 0}
              title={
                toGenerateIds.length === 0
                  ? selected.size === 0
                    ? "Pick at least one preset"
                    : "All selected presets already have results — use the Reroll button in Results to regenerate"
                  : undefined
              }
              style={{
                background: toGenerateIds.length === 0 ? "rgba(220, 38, 38, 0.25)" : ACCENT,
                color: toGenerateIds.length === 0 ? "rgba(255,255,255,0.45)" : "#fff",
                border: "none",
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: 0.2,
                cursor: toGenerateIds.length === 0 ? "not-allowed" : "pointer",
              }}
            >
              Generate {toGenerateIds.length > 0 ? `(${toGenerateIds.length})` : ""}
            </button>
          )}
          {phase === "results" && (
            <button
              onClick={onClose}
              disabled={!!applyingFromUrl}
              style={{
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.18)",
                color: "rgba(255,255,255,0.85)",
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 600,
                cursor: applyingFromUrl ? "not-allowed" : "pointer",
              }}
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ━━━ Setup subpanel ━━━ */
function SetupPanel({
  scene,
  slots,
  selected,
  togglePreset,
  selectAll,
  selectNone,
  selectRecommended,
  notes,
  setNotes,
}: {
  scene: Scene;
  slots: Record<string, VariationSlot>;
  selected: Set<string>;
  togglePreset: (id: string) => void;
  selectAll: () => void;
  selectNone: () => void;
  selectRecommended: () => void;
  notes: string;
  setNotes: (v: string) => void;
}) {
  const hasTags = !!scene.tagged_assets && scene.tagged_assets.length > 0;

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        padding: "14px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {!hasTags && (
        <div
          style={{
            background: "rgba(245, 158, 11, 0.08)",
            border: "1px solid rgba(245, 158, 11, 0.35)",
            padding: "10px 12px",
            fontSize: 11,
            color: "rgba(252, 211, 77, 0.95)",
            lineHeight: 1.5,
          }}
        >
          <strong style={{ fontWeight: 600, letterSpacing: 0.2 }}>No tagged references</strong>
          <div style={{ color: "rgba(255,255,255,0.75)", marginTop: 3 }}>
            This scene has no tagged characters or locations. NB2 uses those as identity anchors —
            without them the subject and environment may look different in each variation. To keep
            identity consistent, tag this scene first (e.g. <code>@character</code>,{" "}
            <code>@location</code>) in the description, then come back.
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            color: "rgba(255,255,255,0.85)",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: 0.4,
            textTransform: "uppercase",
          }}
        >
          Camera presets
        </div>
        <div style={{ flex: 1 }} />
        <QuickBtn onClick={selectRecommended} label="Recommended" />
        <QuickBtn onClick={selectAll} label="All" />
        <QuickBtn onClick={selectNone} label="None" />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 8,
        }}
      >
        {CAMERA_PRESETS.map((p) => {
          const active = selected.has(p.id);
          const slot = slots[p.id];
          return (
            <button
              key={p.id}
              onClick={() => togglePreset(p.id)}
              style={{
                textAlign: "left",
                padding: "10px 12px",
                background: active ? ACCENT_SOFT_BG : "rgba(255,255,255,0.03)",
                border: `1px solid ${active ? ACCENT_SOFT_BORDER : "rgba(255,255,255,0.08)"}`,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                transition: "border-color 0.12s, background 0.12s",
                position: "relative",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 2,
                    border: `1px solid ${active ? ACCENT : "rgba(255,255,255,0.3)"}`,
                    background: active ? ACCENT : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {active && <Check className="w-2.5 h-2.5" style={{ color: "#fff" }} />}
                </span>
                <div style={{ color: "rgba(255,255,255,0.95)", fontSize: 12, fontWeight: 600 }}>
                  {p.label}
                </div>
                {p.recommended && !slot && (
                  <span
                    style={{
                      fontSize: 9,
                      color: "rgba(255,255,255,0.55)",
                      letterSpacing: 0.3,
                      marginLeft: "auto",
                      textTransform: "uppercase",
                    }}
                  >
                    rec
                  </span>
                )}
                {slot && <PresetStatusBadge status={slot.status} />}
              </div>
              <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 10.5, lineHeight: 1.35 }}>
                {p.shortDesc}
              </div>
            </button>
          );
        })}
      </div>

      <div>
        <div
          style={{
            color: "rgba(255,255,255,0.85)",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          Cinematic notes
          <span
            style={{
              color: "rgba(255,255,255,0.4)",
              fontWeight: 400,
              fontSize: 10.5,
              marginLeft: 6,
              textTransform: "none",
            }}
          >
            (optional, applied to every variation)
          </span>
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="e.g. anamorphic lens flare, shallow depth of field, moody teal-and-orange grade"
          style={{
            width: "100%",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "rgba(255,255,255,0.9)",
            padding: 10,
            fontSize: 12,
            fontFamily: "inherit",
            resize: "vertical",
            outline: "none",
          }}
        />
      </div>
    </div>
  );
}

/** Compact status chip shown on a preset card that already has a slot. */
function PresetStatusBadge({ status }: { status: SlotStatus }) {
  const cfg = {
    queued: { label: "Queued", color: "rgba(255,255,255,0.55)", bg: "rgba(255,255,255,0.08)" },
    generating: { label: "…", color: "rgba(255,255,255,0.7)", bg: "rgba(255,255,255,0.08)" },
    success: { label: "Generated", color: "rgba(110, 231, 183, 0.95)", bg: "rgba(16, 185, 129, 0.15)" },
    error: { label: "Failed", color: "rgba(252, 165, 165, 0.95)", bg: "rgba(239, 68, 68, 0.18)" },
  }[status];
  return (
    <span
      style={{
        fontSize: 9,
        color: cfg.color,
        background: cfg.bg,
        padding: "1px 6px",
        letterSpacing: 0.3,
        marginLeft: "auto",
        textTransform: "uppercase",
        fontWeight: 600,
      }}
    >
      {cfg.label}
    </span>
  );
}

/* ━━━ Results subpanel ━━━ */
function ResultsPanel({
  slots,
  applyingFromUrl,
  onApplyResult,
  onReroll,
  onDiscard,
}: {
  slots: Record<string, VariationSlot>;
  applyingFromUrl: string | null;
  onApplyResult: (url: string) => void;
  onReroll: (presetId: string) => void;
  onDiscard: (presetId: string) => void;
}) {
  const ordered = CAMERA_PRESETS.filter((p) => slots[p.id]);

  if (ordered.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(255,255,255,0.5)",
          fontSize: 12,
        }}
      >
        All variations discarded. Go back to pick more presets.
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        padding: 16,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
        gap: 12,
        alignContent: "start",
      }}
    >
      {ordered.map((preset) => {
        const slot = slots[preset.id]!;
        return (
          <ResultCard
            key={preset.id}
            preset={preset}
            slot={slot}
            disabled={!!applyingFromUrl}
            applying={applyingFromUrl !== null && applyingFromUrl === slot.url}
            onApply={() => slot.url && onApplyResult(slot.url)}
            onReroll={() => onReroll(preset.id)}
            onDiscard={() => onDiscard(preset.id)}
          />
        );
      })}
    </div>
  );
}

function ResultCard({
  preset,
  slot,
  disabled,
  applying,
  onApply,
  onReroll,
  onDiscard,
}: {
  preset: CameraPreset;
  slot: VariationSlot;
  disabled: boolean;
  applying: boolean;
  onApply: () => void;
  onReroll: () => void;
  onDiscard: () => void;
}) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: "8px 10px",
          fontSize: 11,
          fontWeight: 600,
          color: "rgba(255,255,255,0.9)",
          display: "flex",
          alignItems: "center",
          gap: 6,
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        {preset.label}
        <span style={{ marginLeft: "auto", fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
          {slot.status === "queued" && "Queued"}
          {slot.status === "generating" && "Generating…"}
          {slot.status === "success" && "Ready"}
          {slot.status === "error" && "Failed"}
        </span>
      </div>
      <div
        style={{
          aspectRatio: "1 / 1",
          background: "#0a0a0a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {slot.status === "success" && slot.url ? (
          <img
            src={slot.url}
            alt={preset.label}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
          />
        ) : slot.status === "error" ? (
          <div
            style={{
              color: "rgba(255,120,120,0.9)",
              fontSize: 11,
              padding: 14,
              textAlign: "center",
              lineHeight: 1.4,
            }}
          >
            {slot.error ?? "Unknown error"}
          </div>
        ) : (
          <Loader2
            className="w-5 h-5"
            style={{
              color: "rgba(255,255,255,0.5)",
              animation: "spin 1s linear infinite",
            }}
          />
        )}
      </div>
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: 6,
          borderTop: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <button
          onClick={onApply}
          disabled={disabled || slot.status !== "success"}
          style={{
            flex: 1,
            padding: "6px 8px",
            fontSize: 11,
            fontWeight: 600,
            background: slot.status === "success" && !disabled ? "#fff" : "rgba(255,255,255,0.06)",
            color: slot.status === "success" && !disabled ? "#000" : "rgba(255,255,255,0.35)",
            border: "none",
            cursor: slot.status === "success" && !disabled ? "pointer" : "not-allowed",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
          }}
          title="Replace scene image with this variation"
        >
          {applying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          Apply
        </button>
        <IconBtn
          title="Generate again"
          onClick={onReroll}
          disabled={disabled || slot.status === "generating" || slot.status === "queued"}
        >
          <RotateCcw className="w-3 h-3" />
        </IconBtn>
        <IconBtn
          title="Remove"
          onClick={onDiscard}
          disabled={disabled || slot.status === "generating"}
        >
          <Trash2 className="w-3 h-3" />
        </IconBtn>
      </div>
    </div>
  );
}

/* ━━━ tiny presentational helpers ━━━ */
function QuickBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "transparent",
        border: "1px solid rgba(255,255,255,0.12)",
        color: "rgba(255,255,255,0.7)",
        padding: "3px 8px",
        fontSize: 10.5,
        cursor: "pointer",
        letterSpacing: 0.2,
      }}
    >
      {label}
    </button>
  );
}

function IconBtn({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 28,
        padding: 0,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.1)",
        color: disabled ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.75)",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </button>
  );
}

function summarizeSlots(slots: Record<string, VariationSlot>): string {
  const vals = Object.values(slots);
  if (vals.length === 0) return "No variations";
  const done = vals.filter((s) => s.status === "success").length;
  const failed = vals.filter((s) => s.status === "error").length;
  const active = vals.filter((s) => s.status === "generating" || s.status === "queued").length;
  const parts: string[] = [];
  if (active > 0) parts.push(`${active} in progress`);
  if (done > 0) parts.push(`${done} ready`);
  if (failed > 0) parts.push(`${failed} failed`);
  return parts.join(" · ");
}

/** Footer status text for the setup phase — reflects skip-done semantics. */
function summarizeSetup(
  selected: Set<string>,
  slots: Record<string, VariationSlot>,
  toGenerateCount: number,
): string {
  if (selected.size === 0) return "Pick at least one preset";
  const alreadyDone = Array.from(selected).filter((id) => slots[id]?.status === "success").length;
  if (toGenerateCount === 0 && alreadyDone > 0) {
    return `All ${alreadyDone} selected already generated — Reroll in Results to refresh`;
  }
  const pieces: string[] = [
    `${toGenerateCount} new variation${toGenerateCount === 1 ? "" : "s"} will be generated`,
  ];
  if (alreadyDone > 0) pieces.push(`${alreadyDone} already done`);
  return pieces.join(" · ");
}
