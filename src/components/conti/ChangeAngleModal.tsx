/**
 * ChangeAngleModal — Interactive camera-angle change controls.
 *
 * 기술적 제약:
 *   NB2(Vertex gemini-3.1-flash-image-preview) 는 숫자 파라미터(pitch/yaw/zoom) 를 직접 받지 못하고
 *   텍스트 프롬프트만 받는다. 그래서 구면 좌표와 슬라이더 값들을 자연어 서술자로 매핑(yaw/pitch/zoom
 *   descriptors)해서 프롬프트에 주입하는 방식으로 카메라 각도/거리를 제어한다.
 *
 *   중요: 극단 각도(뒤통수/바닥/천장)는 원본에 없는 영역을 모델이 상상해 채우므로 정체성이 흔들릴 수 있다.
 *         → 재롤(Apply 를 다시 눌러 새 이미지 얻기) 을 전제로 UX 를 설계.
 *
 * 컨트롤:
 *   - Sphere pad (yaw + pitch): 구면 위 점을 드래그로 돌림.
 *       • yaw:   -180 ~ +180 (좌/우, ±180 = 뒤)
 *       • pitch: -90  ~ +90  (−: low-angle 올려다봄 / +: high-angle 내려다봄)
 *       • 점이 앞 반구(z≥0) 면 solid, 뒤 반구(z<0) 면 점선 링.
 *   - Zoom 슬라이더: -100 ~ +100. 음수 = pull back(dolly-out), 양수 = push in(dolly-in).
 *       프롬프트는 "crop zoom" 이 아니라 "physical camera dolly" 로 명시해 배경까지 함께 reframe 되게 한다.
 *   - Additional notes: 자유 텍스트.
 *
 * 파이프라인: RelightModal 과 동일한 NB2 경로 재사용 (mask 없음).
 *   supabase.functions.invoke("openai-image", {
 *     mode: "inpaint",
 *     useNanoBanana: true,
 *     sourceImageUrl, referenceImageUrls: [],
 *     prompt, projectId, sceneNumber, imageSize,
 *   })
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Move3d, RotateCcw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Scene, Asset } from "./contiTypes";
import { IMAGE_SIZE_MAP } from "@/lib/conti";
import {
  buildAdvancedChainPrompt,
  EMOTION_CHIPS,
  getEmotion,
  type EmotionChip,
} from "@/lib/cameraLibrary";
import { buildSubjectDescriptor } from "@/lib/subjectDescriptor";

type VideoFormat = keyof typeof IMAGE_SIZE_MAP;

/* ━━━ Types ━━━ */
interface ChangeAngleConfig {
  /** -180 ~ +180. 음수 = 왼쪽, 양수 = 오른쪽. 0 = 원본 유지. */
  yaw: number;
  /** -90 ~ +90. 음수 = 아래→위(low-angle, uplook), 양수 = 위→아래(high-angle, downlook). */
  pitch: number;
  /** -100 ~ +100. 음수 = dolly-out, 양수 = dolly-in. */
  zoom: number;
  /** 프롬프트에 이어붙일 추가 설명 (optional) */
  customText: string;
}

const DEFAULT_CONFIG: ChangeAngleConfig = {
  yaw: 0,
  pitch: 0,
  zoom: 0,
  customText: "",
};

/* ━━━ Safe range ━━━
 *
 * NB2(Gemini 3.1 Flash Image)는 reference 이미지로부터 진짜 3D 카메라 이동을 재구성하는
 * 능력이 없다. 극단 각도(±90° yaw, ±90° pitch, 대형 dolly)에서는 배경은 그대로 둔 채
 * 피사체만 2D 회전시키는 safe-fallback 으로 빠지는 빈도가 압도적으로 높다.
 *
 * 그래서 UI 레벨에서 "이 모델이 실제로 잘 해내는 범위" 로 clamp 한다. 이 범위 내에서는
 * NB2 가 꽤 납득할 만한 reframing 을 해준다:
 *   - yaw:    ±60°  (front, slight off, three-quarter 까지)
 *   - pitch:  ±45°  (slight ~ moderate high/low angle)
 *   - zoom:   ±60%  (moderate push-in / pull-back)
 *
 * Back / Top / Bottom / 극단 orbit 은 fal.ai Qwen Multi-Angle LoRA 경로가 붙기 전까지
 * 숨긴다. 플랜 문서의 P1-C fallback 경로.
 */
const YAW_MAX = 60;
const PITCH_MAX = 45;
const ZOOM_MAX = 60;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/* Orbit preset chips — sphere 드래그로 가기 번거로운 각도를 원클릭 스냅.
 * 클릭 시 yaw, pitch 를 한 번에 설정(zoom 은 건드리지 않음).
 * 모든 preset 은 위 safe range 안쪽. */
interface OrbitPreset {
  id: string;
  label: string;
  yaw: number;
  pitch: number;
}
const ORBIT_PRESETS: OrbitPreset[] = [
  { id: "front", label: "Front", yaw: 0, pitch: 0 },
  { id: "l45", label: "L 45°", yaw: -45, pitch: 0 },
  { id: "r45", label: "R 45°", yaw: 45, pitch: 0 },
  { id: "slight_high", label: "Slight High", yaw: 0, pitch: 25 },
  { id: "slight_low", label: "Slight Low", yaw: 0, pitch: -25 },
  { id: "high_3q_l", label: "L 3/4 High", yaw: -35, pitch: 20 },
  { id: "high_3q_r", label: "R 3/4 High", yaw: 35, pitch: 20 },
];

/* ━━━ Prompt Construction ━━━
 *
 * 전략 (Gemini 3.1 Flash Image / NB2 기준, v3):
 *
 *   1) NB2 는 Gemini 계열이라 Stable Diffusion 식 (keyword:weight) 문법을 네이티브로 인식하지
 *      않는다. 잘못된 정보였고 앞 버전에서 빼버린다.
 *
 *   2) Gemini 는 "명령문이 맨 앞" + "짧고 구조적" 일 때 가장 안정적. RelightModal 이 잘 되는 이유도
 *      첫 문장이 "Re-light the input image while strictly preserving ..." 처럼 동사+대상+제약 순
 *      이기 때문. Change Angle 도 동일 패턴을 따르자:
 *
 *          "Re-photograph the EXACT SAME scene as the reference image from a different
 *           camera position. <한 줄 camera position 설명>. Do not regenerate the background,
 *           do not change clothing or identity — only the camera has moved."
 *
 *   3) 사용자가 피드백한 실패 모드 두 가지를 동시에 방어:
 *        (a) "앵글이 반영 안됨" → camera position 문장을 짧고 선명하게, 한 줄에 모아서 맨 앞에.
 *        (b) "원본이 유지되지 않음(배경 재창작)" → 지난 버전의 "invent newly visible details",
 *            "extend environment outward" 같은 creative instruction 제거. 대신
 *            "same subject / same location / same lighting" 을 짧은 불릿으로 명시.
 *
 *   4) "Back view" 같은 극단 각도만 별도 문장으로 명시적 시각 지시 추가 (모델이 얼굴을 자꾸
 *      보여주려고 하는 보정 bias 를 누르기 위함).
 */

/** yaw → 짧고 선명한 camera position 구절. null = "변화 없음".
 *  Safe range 로 clamp 되므로 |yaw| <= 60° 범위만 커버. */
const yawPhrase = (yaw: number): string | null => {
  const a = Math.round(clamp(yaw, -YAW_MAX, YAW_MAX));
  if (Math.abs(a) < 8) return null;
  const abs = Math.abs(a);
  const dir = a > 0 ? "right" : "left";
  const mirror = a > 0 ? "left" : "right";
  if (abs <= 22)
    return `orbited ${abs}° to the ${dir} around the subject — subject seen slightly from the ${dir} of center, still mostly facing the camera`;
  if (abs <= 45)
    return `orbited ${abs}° to the ${dir} around the subject — three-quarter view, the subject's ${dir} side is clearly more visible, the ${mirror} side is partly hidden`;
  return `orbited ${abs}° to the ${dir} around the subject — strong three-quarter-to-side view, most of the subject's ${dir} side is visible, only a sliver of the ${mirror} side shows`;
};

/** pitch → camera position 구절. |pitch| <= 45° 범위만 커버. */
const pitchPhrase = (pitch: number): string | null => {
  const a = Math.round(clamp(pitch, -PITCH_MAX, PITCH_MAX));
  if (Math.abs(a) < 6) return null;
  if (a > 0) {
    if (a <= 20) return "slightly above eye level (mild high-angle shot, camera tilted slightly down at the subject)";
    return "clearly above the subject (moderate high-angle shot, camera tilted down at the subject)";
  }
  const abs = -a;
  if (abs <= 20) return "slightly below eye level (mild low-angle shot, camera tilted slightly up at the subject)";
  return "clearly below the subject (moderate low-angle shot, camera tilted up at the subject)";
};

/** zoom → camera position 구절. |zoom| <= 60 범위만 커버. */
const zoomPhrase = (zoom: number): string | null => {
  const a = Math.round(clamp(zoom, -ZOOM_MAX, ZOOM_MAX));
  if (Math.abs(a) < 6) return null;
  if (a > 0) {
    if (a <= 25) return "dollied slightly closer to the subject (push-in, medium-close framing)";
    return "dollied noticeably closer to the subject (close-up framing, subject takes up more of the frame)";
  }
  const abs = -a;
  if (abs <= 25) return "dollied slightly back from the subject (pull-back, slightly wider framing)";
  return "dollied noticeably back from the subject (wide shot, subject is smaller in frame and more of the surrounding environment is visible)";
};

/** 슬라이더 옆 요약 라벨(짧게). */
const summarizeYaw = (yaw: number): string => {
  const a = Math.round(yaw);
  if (Math.abs(a) < 8) return "same";
  return `${a > 0 ? "R" : "L"} ${Math.abs(a)}°`;
};
const summarizePitch = (pitch: number): string => {
  const a = Math.round(pitch);
  if (Math.abs(a) < 6) return "same";
  return a > 0 ? `down ${a}°` : `up ${-a}°`;
};
const summarizeZoom = (zoom: number): string => {
  const a = Math.round(zoom);
  if (Math.abs(a) < 6) return "same";
  if (a > 0) return `in ${a}%`;
  return `out ${-a}%`;
};

/* Prompt construction delegates to buildAdvancedChainPrompt in the shared
 * camera library. The "A, then B" chain pattern (yaw+zoom as one clause,
 * pitch as a second step) has measurably better NB2 adherence than the
 * older stacked-adjective run — NB2 would routinely collapse
 * "pulled back, and 30° right orbit, and tilted up" into just the first
 * clause. Routing both to the library also means any future prompt
 * tuning happens in one place, not three.
 *
 * Mapping from sliders → clauses:
 *   distanceClause = zoom + yaw   (framing bucket: "wider and orbited 30° right")
 *   angleClause    = pitch        ("tilted slightly up at the subject")
 *
 * Why group yaw with zoom: yaw without a distance change reads as a pure
 * orbit, and that's a framing adjustment; keeping it in the first chain
 * step lets the second step be a clean viewpoint tilt. */
const buildChangeAnglePrompt = (
  cfg: ChangeAngleConfig,
  subject: string,
  emotion: EmotionChip | null,
): string => {
  const y = yawPhrase(cfg.yaw);
  const p = pitchPhrase(cfg.pitch);
  const z = zoomPhrase(cfg.zoom);

  // Combine zoom + yaw into a single distance/framing sentence. If only
  // one of them is set, use that; if both, join with "and". Empty = no move.
  const distanceParts = [z, y].filter((s): s is string => !!s);
  const distanceClause = distanceParts.length > 0 ? distanceParts.join(" and ") : null;
  const angleClause = p ?? null;

  return buildAdvancedChainPrompt({
    subject,
    distanceClause,
    angleClause,
    emotion,
    extraNotes: cfg.customText,
  });
};

/* ━━━ Sphere Control ━━━
 * SVG 기반 의사(pseudo) 3D sphere.
 * 내부적으로는 yaw/pitch 를 구면 좌표로 가지고, 카메라 위치(사용자가 보는 점)를
 * 원점(피사체) 기준 단위 구 위의 한 점으로 놓고 정사영(orthographic projection) 한다.
 *   x3 = sin(yaw) * cos(pitch)
 *   y3 = sin(pitch)              // pitch > 0: 카메라가 위 → high angle → 화면 y 위쪽
 *   z3 = cos(yaw) * cos(pitch)   // z>=0: 앞 반구 / z<0: 뒤 반구
 * 화면 좌표: (x3 * R, -y3 * R). 앞 반구면 solid dot, 뒤 반구면 dashed ring.
 *
 * 드래그 방식 — 포지셔널 매핑 (1:1 커서 매칭):
 *   pointer down 시점의 hemisphere(앞/뒤 반구)와 (커서 ↔ 도트) 오프셋을 기억한 뒤,
 *   move 마다 "커서 위치 - 오프셋" 을 도트의 새 화면 위치로 설정, 이를 구 표면으로
 *   역투영해서 새 (yaw, pitch) 를 구한다. 구 경계 밖으로 나가면 경계로 clamp.
 *   → 드래그가 커서와 1:1 로 따라오고, back 반구(z<0) 에서도 방향이 뒤집히지 않는다.
 *   → 반대편 hemisphere 로 넘어가려면 경계에서 release 후 다시 드래그하거나 preset 사용. */
const SPHERE_SIZE = 208;
const SPHERE_RADIUS = 84;

interface SphereControlProps {
  yaw: number;
  pitch: number;
  onChange: (v: { yaw: number; pitch: number }) => void;
  disabled?: boolean;
}

const SphereControl = ({ yaw, pitch, onChange, disabled }: SphereControlProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  /** hemi: 1 = 앞 반구(z>=0), -1 = 뒤 반구(z<0).
   *  offsetX/Y: 포인터 다운 시점의 (커서 ↔ 도트) 화면 오프셋.
   *    move 마다 (커서 - 오프셋) 을 도트 화면 위치로 간주 → 구 표면으로 역투영.
   *  cx/cy: 포인터 다운 시점의 svg 화면 중심(BoundingClientRect 캐시). */
  const dragRef = useRef<{ hemi: 1 | -1; offsetX: number; offsetY: number; screenCx: number; screenCy: number } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);

  const yawRad = (yaw * Math.PI) / 180;
  const pitchRad = (pitch * Math.PI) / 180;
  const x3 = Math.sin(yawRad) * Math.cos(pitchRad);
  const y3 = Math.sin(pitchRad);
  const z3 = Math.cos(yawRad) * Math.cos(pitchRad);
  const inFront = z3 >= 0;

  const cx = SPHERE_SIZE / 2;
  const cy = SPHERE_SIZE / 2;
  const dotX = cx + x3 * SPHERE_RADIUS;
  const dotY = cy - y3 * SPHERE_RADIUS;

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (disabled) return;
    const svg = svgRef.current;
    if (!svg) return;
    (e.currentTarget as unknown as Element).setPointerCapture?.(e.pointerId);
    const rect = svg.getBoundingClientRect();
    const screenCx = rect.left + cx;
    const screenCy = rect.top + cy;
    const dotScreenX = screenCx + x3 * SPHERE_RADIUS;
    const dotScreenY = screenCy - y3 * SPHERE_RADIUS;
    dragRef.current = {
      hemi: z3 >= 0 ? 1 : -1,
      offsetX: e.clientX - dotScreenX,
      offsetY: e.clientY - dotScreenY,
      screenCx,
      screenCy,
    };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    // 목표 도트 화면 좌표 = 커서 - (클릭 당시 커서-도트 오프셋)
    const targetDotX = e.clientX - d.offsetX;
    const targetDotY = e.clientY - d.offsetY;
    let u = targetDotX - d.screenCx;
    let v = targetDotY - d.screenCy;
    // 구 경계 밖이면 경계로 clamp — 이때 z=0 (edge).
    const r = Math.hypot(u, v);
    if (r > SPHERE_RADIUS) {
      u = (u / r) * SPHERE_RADIUS;
      v = (v / r) * SPHERE_RADIUS;
    }
    // 화면 좌표 → 단위 구 좌표
    const xn = u / SPHERE_RADIUS;
    const yn = -v / SPHERE_RADIUS;
    const r2 = xn * xn + yn * yn;
    const zn = d.hemi * Math.sqrt(Math.max(0, 1 - r2));
    // 역변환: y3 = sin(pitch), (x3, z3) = (sin(yaw)cos(pitch), cos(yaw)cos(pitch))
    const newPitchRad = Math.asin(Math.max(-1, Math.min(1, yn)));
    const newYawRad = Math.atan2(xn, zn);
    const newPitch = (newPitchRad * 180) / Math.PI;
    let newYaw = (newYawRad * 180) / Math.PI;
    // 안전: -180..180 범위 보장
    if (newYaw > 180) newYaw -= 360;
    if (newYaw < -180) newYaw += 360;
    onChange({ yaw: newYaw, pitch: newPitch });
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    try {
      (e.currentTarget as unknown as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    dragRef.current = null;
    setDragging(false);
  };
  const onDoubleClick = () => {
    if (disabled) return;
    onChange({ yaw: 0, pitch: 0 });
  };

  const labelStyle: React.CSSProperties = {
    userSelect: "none",
    WebkitUserSelect: "none",
    pointerEvents: "none",
  };

  // 경도선(meridians) — 정면 정사영에서 타원 (rx = |sin(λ)|·R, ry = R)
  const meridianAngles = [30, 60, 90, 120, 150];
  // 위도선(latitudes) — 정면 정사영에서 y=sin(φ)·R 위치의 수평선. 길이는 cos(φ)·R·2.
  const latitudes = [-60, -30, 30, 60];

  return (
    <svg
      ref={svgRef}
      width={SPHERE_SIZE}
      height={SPHERE_SIZE}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      style={{
        touchAction: "none",
        cursor: disabled ? "default" : dragging ? "grabbing" : "grab",
        opacity: disabled ? 0.5 : 1,
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      <defs>
        <radialGradient id="changeAngleSphereGrad" cx="32%" cy="28%" r="78%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.14)" />
          <stop offset="55%" stopColor="rgba(255,255,255,0.04)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.55)" />
        </radialGradient>
      </defs>
      {/* sphere body */}
      <circle
        cx={cx}
        cy={cy}
        r={SPHERE_RADIUS}
        fill="url(#changeAngleSphereGrad)"
        stroke="rgba(255,255,255,0.2)"
        strokeWidth={1}
      />
      {/* latitudes */}
      {latitudes.map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const ly = cy - Math.sin(rad) * SPHERE_RADIUS;
        const halfLen = Math.cos(rad) * SPHERE_RADIUS;
        return (
          <line
            key={`lat-${deg}`}
            x1={cx - halfLen}
            y1={ly}
            x2={cx + halfLen}
            y2={ly}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={1}
            strokeDasharray="2 3"
          />
        );
      })}
      {/* meridians */}
      {meridianAngles.map((deg) => {
        const rx = Math.abs(Math.sin((deg * Math.PI) / 180)) * SPHERE_RADIUS;
        return (
          <ellipse
            key={`lon-${deg}`}
            cx={cx}
            cy={cy}
            rx={rx}
            ry={SPHERE_RADIUS}
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth={1}
            strokeDasharray="2 3"
          />
        );
      })}
      {/* equator (horizontal mid-line) */}
      <line
        x1={cx - SPHERE_RADIUS}
        y1={cy}
        x2={cx + SPHERE_RADIUS}
        y2={cy}
        stroke="rgba(255,255,255,0.15)"
        strokeWidth={1}
      />
      {/* vertical prime meridian */}
      <line
        x1={cx}
        y1={cy - SPHERE_RADIUS}
        x2={cx}
        y2={cy + SPHERE_RADIUS}
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={1}
      />
      {/* safe-zone boundary — rectangle showing the reachable (yaw, pitch) range
           on the projected sphere surface. Dashed amber tint to read as "soft limit". */}
      {(() => {
        const rx = Math.sin((YAW_MAX * Math.PI) / 180) * SPHERE_RADIUS;
        const ry = Math.sin((PITCH_MAX * Math.PI) / 180) * SPHERE_RADIUS;
        return (
          <rect
            x={cx - rx}
            y={cy - ry}
            width={rx * 2}
            height={ry * 2}
            fill="rgba(249, 194, 90, 0.03)"
            stroke="rgba(249, 194, 90, 0.35)"
            strokeWidth={1}
            strokeDasharray="3 3"
            rx={4}
            ry={4}
          />
        );
      })()}
      {/* center marker: original viewpoint */}
      <circle cx={cx} cy={cy} r={2} fill="rgba(255,255,255,0.38)" />
      {/* cardinal labels */}
      <text x={cx} y={cy - SPHERE_RADIUS - 8} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize={9} style={labelStyle}>
        Top
      </text>
      <text x={cx} y={cy + SPHERE_RADIUS + 14} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize={9} style={labelStyle}>
        Bottom
      </text>
      <text x={cx - SPHERE_RADIUS - 6} y={cy + 3} textAnchor="end" fill="rgba(255,255,255,0.55)" fontSize={9} style={labelStyle}>
        L
      </text>
      <text x={cx + SPHERE_RADIUS + 6} y={cy + 3} textAnchor="start" fill="rgba(255,255,255,0.55)" fontSize={9} style={labelStyle}>
        R
      </text>
      {/* draggable viewpoint dot */}
      {inFront ? (
        <circle cx={dotX} cy={dotY} r={7} fill="#f9423a" stroke="#fff" strokeWidth={1.5} />
      ) : (
        <g>
          <circle cx={dotX} cy={dotY} r={7} fill="none" stroke="#f9423a" strokeWidth={2} strokeDasharray="3 2" />
          <circle cx={dotX} cy={dotY} r={2} fill="#f9423a" />
        </g>
      )}
    </svg>
  );
};

/* ━━━ Small labeled slider (bi-polar: 중앙 = 0) ━━━ */
interface BiSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  endLabels: [string, string];
  onChange: (v: number) => void;
  disabled?: boolean;
  summary: string;
}
const BiSlider = ({
  label,
  value,
  min,
  max,
  step = 1,
  endLabels,
  onChange,
  disabled,
  summary,
}: BiSliderProps) => (
  <div>
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        fontSize: 11,
        color: "rgba(255,255,255,0.62)",
        marginBottom: 6,
        userSelect: "none",
      }}
    >
      <span>{label}</span>
      <span style={{ color: "rgba(255,255,255,0.42)", fontVariantNumeric: "tabular-nums" }}>{summary}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      onDoubleClick={() => onChange(0)}
      disabled={disabled}
      style={{ width: "100%", accentColor: "#f9423a", cursor: disabled ? "default" : "pointer" }}
      title="Double-click to reset to 0"
    />
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: 9,
        color: "rgba(255,255,255,0.32)",
        marginTop: 2,
        userSelect: "none",
      }}
    >
      <span>{endLabels[0]}</span>
      <span>{endLabels[1]}</span>
    </div>
  </div>
);

/* ━━━ Section wrapper ━━━ */
interface SectionProps {
  label: string;
  meta?: React.ReactNode;
  icon?: React.ReactNode;
  first?: boolean;
  children: React.ReactNode;
}
const Section = ({ label, meta, icon, first, children }: SectionProps) => (
  <div
    style={{
      paddingTop: first ? 0 : 14,
      paddingBottom: 14,
      borderTop: first ? "none" : "1px solid rgba(255,255,255,0.06)",
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 10,
        userSelect: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          fontWeight: 600,
          color: "rgba(255,255,255,0.82)",
          letterSpacing: 0.1,
        }}
      >
        {icon}
        {label}
      </div>
      {meta !== undefined && meta !== null && (
        <div
          style={{
            fontSize: 10,
            color: "rgba(255,255,255,0.42)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {meta}
        </div>
      )}
    </div>
    {children}
  </div>
);

/* ━━━ Main modal ━━━ */
export interface ChangeAngleModalProps {
  scene: Scene;
  /** Asset library — threaded into the subject descriptor so NB2 gets
   *  a written identity anchor to complement the visual reference. */
  assets?: Asset[];
  projectId: string;
  videoFormat: VideoFormat;
  onClose: () => void;
  onApplied: (newUrl: string, previousUrl: string | null) => void | Promise<void>;
}

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
  width: "min(960px, 100%)",
  height: "min(92vh, 780px)",
  display: "grid",
  gridTemplateColumns: "minmax(280px, 380px) 1fr",
  gridTemplateRows: "1fr",
  overflow: "hidden",
};

export function ChangeAngleModal({
  scene,
  assets = [],
  projectId,
  videoFormat,
  onClose,
  onApplied,
}: ChangeAngleModalProps) {
  const sourceUrl = scene.conti_image_url;
  const [cfg, setCfg] = useState<ChangeAngleConfig>(DEFAULT_CONFIG);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** null = auto-generated from cfg, string = user-edited override. */
  const [promptOverride, setPromptOverride] = useState<string | null>(null);
  /** Mood/Intent chip. Biases framing and expression without overwriting
   *  identity. See src/lib/cameraLibrary.ts → EMOTION_CHIPS. */
  const [emotionId, setEmotionId] = useState<string>("neutral");
  const emotion = useMemo<EmotionChip | null>(
    () => getEmotion(emotionId) ?? null,
    [emotionId],
  );

  const subject = useMemo(
    () => buildSubjectDescriptor(scene, assets),
    [scene, assets],
  );

  const generatedPrompt = useMemo(
    () => buildChangeAnglePrompt(cfg, subject, emotion),
    [cfg, subject, emotion],
  );
  const prompt = promptOverride ?? generatedPrompt;
  const usingOverride = promptOverride !== null;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !applying) onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [applying, onClose]);

  const resetAll = () => {
    setCfg(DEFAULT_CONFIG);
    setPromptOverride(null);
    setError(null);
    setEmotionId("neutral");
  };

  const handleApply = async () => {
    if (!sourceUrl || applying) return;
    setError(null);
    setApplying(true);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke("openai-image", {
        body: {
          mode: "inpaint",
          useNanoBanana: true,
          sourceImageUrl: sourceUrl,
          referenceImageUrls: [],
          prompt,
          projectId,
          sceneNumber: scene.scene_number,
          imageSize: IMAGE_SIZE_MAP[videoFormat],
        },
      });
      if (invokeErr) throw invokeErr;
      const d = data as { publicUrl?: string; url?: string } | null;
      const newUrl = d?.publicUrl ?? d?.url ?? null;
      if (!newUrl) throw new Error("Change Angle returned no image URL");
      await onApplied(newUrl, sourceUrl);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  if (!sourceUrl) {
    return (
      <div style={BACKDROP_STYLE} onClick={onClose}>
        <div
          style={{ ...PANEL_STYLE, gridTemplateColumns: "1fr", padding: 24 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 13 }}>No source image for this scene.</div>
        </div>
      </div>
    );
  }

  const nonZero = cfg.yaw !== 0 || cfg.pitch !== 0 || cfg.zoom !== 0;

  return (
    <div style={BACKDROP_STYLE} onClick={onClose}>
      <div style={PANEL_STYLE} onClick={(e) => e.stopPropagation()}>
        {/* Preview */}
        <div
          style={{
            background: "#0a0a0a",
            borderRight: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            minHeight: 320,
          }}
        >
          <img
            src={sourceUrl}
            alt={`Scene ${scene.scene_number}`}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
          />
        </div>

        {/* Controls */}
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "14px 20px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              userSelect: "none",
              flexShrink: 0,
            }}
          >
            <Move3d className="w-4 h-4" style={{ color: "rgba(255,255,255,0.78)" }} />
            <div
              style={{
                color: "rgba(255,255,255,0.95)",
                fontSize: 14,
                fontWeight: 600,
                flex: 1,
                letterSpacing: 0.1,
              }}
            >
              Change Angle
            </div>
            <button
              onClick={resetAll}
              disabled={applying || !nonZero}
              className="text-white/60 hover:text-white/90 disabled:opacity-30"
              style={{
                background: "transparent",
                border: "none",
                cursor: applying || !nonZero ? "default" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                padding: "2px 6px",
              }}
              title="Reset all controls to 0"
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
            <button
              onClick={onClose}
              disabled={applying}
              className="text-white/60 hover:text-white/90 disabled:opacity-40"
              style={{ background: "transparent", border: "none", cursor: "pointer", display: "flex" }}
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Mood / Intent chip row — biases framing and expression without
              overwriting identity. Same set CameraVariationsModal uses,
              so a user's aesthetic preference carries across modals. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 20px",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              flexShrink: 0,
              background: "#0c0c0c",
            }}
          >
            <div
              style={{
                color: "rgba(255,255,255,0.55)",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                marginRight: 4,
                whiteSpace: "nowrap",
              }}
            >
              Mood
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {EMOTION_CHIPS.map((chip) => {
                const active = emotionId === chip.id;
                return (
                  <button
                    key={chip.id}
                    onClick={() => !applying && setEmotionId(chip.id)}
                    disabled={applying}
                    style={{
                      padding: "3px 10px",
                      fontSize: 10.5,
                      letterSpacing: 0.2,
                      background: active ? "rgba(249,66,58,0.14)" : "transparent",
                      border: `1px solid ${active ? "rgba(249,66,58,0.55)" : "rgba(255,255,255,0.12)"}`,
                      color: active ? "#fca5a5" : "rgba(255,255,255,0.7)",
                      cursor: applying ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: "4px 20px 6px", overflow: "auto", flex: 1, minHeight: 0 }}>
            {/* Orbit (yaw + pitch via sphere) */}
            <Section
              label="Orbit camera"
              first
              meta={
                <span>
                  Yaw <b style={{ color: "rgba(255,255,255,0.7)" }}>{summarizeYaw(cfg.yaw)}</b>
                  <span style={{ opacity: 0.35, margin: "0 5px" }}>·</span>
                  Pitch <b style={{ color: "rgba(255,255,255,0.7)" }}>{summarizePitch(cfg.pitch)}</b>
                </span>
              }
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `${SPHERE_SIZE}px 1fr`,
                  gap: 18,
                  alignItems: "center",
                }}
              >
                <SphereControl
                  yaw={cfg.yaw}
                  pitch={cfg.pitch}
                  onChange={({ yaw, pitch }) =>
                    setCfg((p) => ({
                      ...p,
                      yaw: clamp(yaw, -YAW_MAX, YAW_MAX),
                      pitch: clamp(pitch, -PITCH_MAX, PITCH_MAX),
                    }))
                  }
                  disabled={applying}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", lineHeight: 1.55 }}>
                    Drag the dot, use the sliders, or pick a preset — they all stay in sync.
                    Angle is constrained to ±{YAW_MAX}° horizontal, ±{PITCH_MAX}° vertical.
                  </div>
                  <BiSlider
                    label="Yaw (horizontal orbit)"
                    value={cfg.yaw}
                    min={-YAW_MAX}
                    max={YAW_MAX}
                    endLabels={[`L ${YAW_MAX}°`, `R ${YAW_MAX}°`]}
                    onChange={(v) => setCfg((p) => ({ ...p, yaw: clamp(v, -YAW_MAX, YAW_MAX) }))}
                    disabled={applying}
                    summary={summarizeYaw(cfg.yaw)}
                  />
                  <BiSlider
                    label="Pitch (vertical tilt)"
                    value={cfg.pitch}
                    min={-PITCH_MAX}
                    max={PITCH_MAX}
                    endLabels={[`Low-angle ${PITCH_MAX}°`, `High-angle ${PITCH_MAX}°`]}
                    onChange={(v) => setCfg((p) => ({ ...p, pitch: clamp(v, -PITCH_MAX, PITCH_MAX) }))}
                    disabled={applying}
                    summary={summarizePitch(cfg.pitch)}
                  />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {ORBIT_PRESETS.map((preset) => {
                      const active =
                        Math.abs(cfg.yaw - preset.yaw) < 1 && Math.abs(cfg.pitch - preset.pitch) < 1;
                      return (
                        <button
                          key={preset.id}
                          onClick={() => setCfg((p) => ({ ...p, yaw: preset.yaw, pitch: preset.pitch }))}
                          disabled={applying}
                          title={`${preset.label} (yaw ${preset.yaw}°, pitch ${preset.pitch}°)`}
                          className="hover:bg-white/[0.08] disabled:opacity-50"
                          style={{
                            padding: "4px 8px",
                            fontSize: 10,
                            background: active ? "rgba(249,66,58,0.2)" : "rgba(255,255,255,0.04)",
                            border: `1px solid ${active ? "rgba(249,66,58,0.55)" : "rgba(255,255,255,0.1)"}`,
                            color: active ? "#fca5a5" : "rgba(255,255,255,0.82)",
                            cursor: applying ? "default" : "pointer",
                            transition: "background 120ms ease, border-color 120ms ease",
                            fontFamily: "inherit",
                          }}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 10, lineHeight: 1.5 }}>
                    Center = original viewpoint. Double-click the sphere to reset.
                    Extreme angles (back view, top-down, worm's-eye) are not available — the model
                    cannot reliably do true 3D camera moves on an arbitrary reference image.
                  </div>
                </div>
              </div>
            </Section>

            {/* Zoom */}
            <Section
              label="Zoom (physical dolly)"
              meta={
                <span>
                  <b style={{ color: "rgba(255,255,255,0.7)" }}>{summarizeZoom(cfg.zoom)}</b>
                </span>
              }
            >
              <BiSlider
                label="Dolly in ↔ Dolly out"
                value={cfg.zoom}
                min={-ZOOM_MAX}
                max={ZOOM_MAX}
                endLabels={["Pull back (wider)", "Push in (closer)"]}
                onChange={(v) => setCfg((p) => ({ ...p, zoom: clamp(v, -ZOOM_MAX, ZOOM_MAX) }))}
                disabled={applying}
                summary={summarizeZoom(cfg.zoom)}
              />
              <div
                style={{
                  marginTop: 10,
                  padding: "6px 8px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  color: "rgba(255,255,255,0.45)",
                  fontSize: 10,
                  lineHeight: 1.5,
                }}
              >
                Zoom is sent to the model as a <b>physical camera dolly</b> — the subject and the
                background reframe together. Range capped to ±{ZOOM_MAX}% because larger dollies
                cause the model to break identity. Re-Apply to reroll.
              </div>
            </Section>

            {/* Additional notes */}
            <Section label="Additional notes" meta="Optional">
              <textarea
                value={cfg.customText}
                onChange={(e) => setCfg((p) => ({ ...p, customText: e.target.value }))}
                disabled={applying}
                rows={2}
                placeholder="e.g. keep the wide-lens distortion, emphasise a subtle dolly motion, handheld feel..."
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  background: "#181818",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "rgba(255,255,255,0.88)",
                  fontSize: 11,
                  fontFamily: "inherit",
                  lineHeight: 1.55,
                  resize: "vertical",
                  outline: "none",
                }}
              />
            </Section>

            {/* Prompt preview + editable override — experiment freely.
                 값이 null 이면 cfg 에서 자동 생성, 아니면 override 사용. */}
            <Section
              label="Prompt sent to model"
              meta={
                usingOverride ? (
                  <button
                    onClick={() => setPromptOverride(null)}
                    disabled={applying}
                    className="hover:text-white/80"
                    style={{
                      background: "transparent",
                      border: "1px solid rgba(255,255,255,0.18)",
                      color: "rgba(255,255,255,0.7)",
                      fontSize: 10,
                      padding: "2px 6px",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                    title="Discard your edits, reset to auto-generated prompt"
                  >
                    Reset to auto
                  </button>
                ) : (
                  <span style={{ color: "rgba(255,255,255,0.38)", fontSize: 10 }}>Auto</span>
                )
              }
            >
              <textarea
                value={prompt}
                onChange={(e) => setPromptOverride(e.target.value)}
                disabled={applying}
                rows={5}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  background: "#0a0a0a",
                  border: `1px solid ${usingOverride ? "rgba(249,194,90,0.35)" : "rgba(255,255,255,0.08)"}`,
                  color: "rgba(255,255,255,0.82)",
                  fontSize: 11,
                  lineHeight: 1.55,
                  resize: "vertical",
                  outline: "none",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                }}
              />
              <div style={{ marginTop: 6, color: "rgba(255,255,255,0.38)", fontSize: 10, lineHeight: 1.5 }}>
                This is the exact text sent to Nano Banana 2 along with the reference image.
                Edit it freely to experiment — changes to the sliders/presets/notes above will overwrite your edits.
              </div>
            </Section>

            {error && (
              <div
                style={{
                  marginTop: 4,
                  marginBottom: 10,
                  padding: "8px 10px",
                  background: "rgba(220,38,38,0.1)",
                  border: "1px solid rgba(220,38,38,0.25)",
                  color: "#fca5a5",
                  fontSize: 11,
                }}
              >
                {error}
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              padding: "12px 20px",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              background: "#0f0f0f",
              flexShrink: 0,
            }}
          >
            <button
              onClick={onClose}
              disabled={applying}
              style={{
                padding: "7px 14px",
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "rgba(255,255,255,0.78)",
                cursor: applying ? "default" : "pointer",
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={applying}
              style={{
                padding: "7px 16px",
                background: "#f9423a",
                border: "none",
                color: "#fff",
                cursor: applying ? "default" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                minWidth: 92,
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 600,
                opacity: applying ? 0.6 : 1,
              }}
            >
              {applying ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Rendering
                </>
              ) : (
                "Apply"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
