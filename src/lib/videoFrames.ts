/**
 * 클라이언트 사이드 영상 프레임 샘플링.
 *
 * 의존성 0 (브라우저 <video> + <canvas> 만 사용). 분석 대상 영상을 GPT-5.x 의
 * 멀티모달 입력 (image_url 데이터 URI) 로 변환하기 위함이다.
 *
 * 동작:
 *   1. 추가 즉시: 첫 프레임 1장만 추출 (poster) — UI 칩에 즉시 썸네일 표시
 *   2. 분석 직전: N (8 또는 16) 프레임을 균등 시점으로 추출
 *
 * 다운스케일: 가로 768px (GPT vision detail=auto 권장 영역). 세로는 비율 유지.
 *
 * 한도: 200MB / 5분 — 그 이상은 호출자가 사전 검증하고 throw.
 */

export interface ExtractedFrame {
  /** 영상 내 시점 (초) */
  t: number;
  /** "image/png" — 항상 PNG 로 통일 */
  mediaType: string;
  /** Base64 (no data: prefix) */
  base64: string;
}

export interface VideoMeta {
  durationSec: number;
  widthPx: number;
  heightPx: number;
}

const MAX_BYTES = 200 * 1024 * 1024;
const MAX_DURATION_SEC = 5 * 60;
const TARGET_WIDTH = 768;

export function validateVideoFile(file: File): { ok: true } | { ok: false; reason: string } {
  if (!file.type.startsWith("video/")) return { ok: false, reason: "비디오 파일이 아닙니다." };
  if (file.size > MAX_BYTES) return { ok: false, reason: "200MB 이하 영상만 지원합니다." };
  return { ok: true };
}

/**
 * 비디오 메타 + 첫 프레임 1장 추출. 칩 즉시 렌더링용.
 * 동일 video element 를 후속 N 프레임 추출에서 재사용하지 않고,
 * (오류 격리/메모리 정리 단순화 목적) 매번 새 element 를 만든다.
 */
export async function extractFirstFrame(file: File): Promise<{ meta: VideoMeta; poster: ExtractedFrame }> {
  const url = URL.createObjectURL(file);
  try {
    const { meta, frames } = await sampleFromObjectUrl(url, [0.1]);
    return { meta, poster: frames[0] };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * N 프레임 균등 샘플링. `count` 가 1 이면 중간 프레임 1장.
 *
 * `range` 가 주어지면 해당 구간 `[startSec..endSec]` 안에서 균등 추출한다.
 * 구간이 영상 길이를 벗어나거나 폭이 0.2s 미만이면 전체 구간으로 폴백.
 */
export async function sampleFrames(
  file: File,
  count: number,
  range?: { startSec: number; endSec: number },
): Promise<{ meta: VideoMeta; frames: ExtractedFrame[] }> {
  const url = URL.createObjectURL(file);
  try {
    const meta = await probeVideoMeta(url);
    if (meta.durationSec > MAX_DURATION_SEC) {
      throw new Error(`5분(${MAX_DURATION_SEC}s) 이하 영상만 지원합니다. (현재 ${Math.round(meta.durationSec)}s)`);
    }
    const times = computeUniformTimes(meta.durationSec, Math.max(1, count), range);
    return await sampleFromObjectUrl(url, times);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function computeUniformTimes(
  durationSec: number,
  count: number,
  range?: { startSec: number; endSec: number },
): number[] {
  // 유효 구간 계산. range 가 비정상이면 전체 사용.
  let lo = 0.1;
  let hi = Math.max(0.1, durationSec - 0.05);
  if (range) {
    const s = Math.max(0, Math.min(range.startSec, durationSec));
    const e = Math.max(0, Math.min(range.endSec, durationSec));
    if (e - s >= 0.2) {
      lo = Math.max(0.05, s);
      hi = Math.min(durationSec - 0.01, e);
    }
  }
  if (count === 1) return [(lo + hi) / 2];
  const span = Math.max(0.1, hi - lo);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = lo + (span * i) / (count - 1);
    out.push(Math.min(hi, Math.max(lo, t)));
  }
  return out;
}

function probeVideoMeta(objectUrl: string): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
    };
    video.onloadedmetadata = () => {
      const meta: VideoMeta = {
        durationSec: Number.isFinite(video.duration) ? video.duration : 0,
        widthPx: video.videoWidth,
        heightPx: video.videoHeight,
      };
      cleanup();
      resolve(meta);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("영상 메타데이터 로드 실패"));
    };
    video.src = objectUrl;
  });
}

async function sampleFromObjectUrl(objectUrl: string, times: number[]): Promise<{ meta: VideoMeta; frames: ExtractedFrame[] }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";

    const frames: ExtractedFrame[] = [];
    let metaResult: VideoMeta | null = null;
    let queue: number[] = [];

    const cleanup = () => {
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        /* noop */
      }
    };

    const fail = (err: Error) => {
      cleanup();
      reject(err);
    };

    const drainNext = () => {
      if (queue.length === 0) {
        cleanup();
        if (!metaResult) return reject(new Error("메타데이터 누락"));
        return resolve({ meta: metaResult, frames });
      }
      const t = queue.shift()!;
      // 시점이 duration 을 살짝 넘으면 클램프
      const safeT = Math.min(t, Math.max(0, (metaResult?.durationSec ?? 0) - 0.05));
      try {
        video.currentTime = safeT;
      } catch (e) {
        return fail(new Error(`seek 실패 t=${safeT}: ${(e as Error).message}`));
      }
    };

    video.onloadedmetadata = () => {
      metaResult = {
        durationSec: Number.isFinite(video.duration) ? video.duration : 0,
        widthPx: video.videoWidth,
        heightPx: video.videoHeight,
      };
      queue = [...times];
      drainNext();
    };

    video.onseeked = () => {
      try {
        const meta = metaResult!;
        const ratio = meta.widthPx > 0 ? TARGET_WIDTH / meta.widthPx : 1;
        const w = Math.min(TARGET_WIDTH, meta.widthPx);
        const h = Math.round(meta.heightPx * Math.min(ratio, 1));
        const canvas = document.createElement("canvas");
        canvas.width = w || TARGET_WIDTH;
        canvas.height = h || Math.round((TARGET_WIDTH * 9) / 16);
        const ctx = canvas.getContext("2d");
        if (!ctx) return fail(new Error("canvas 2d context 획득 실패"));
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/png");
        const base64 = dataUrl.split(",")[1] ?? "";
        frames.push({ t: video.currentTime, mediaType: "image/png", base64 });
        drainNext();
      } catch (e) {
        fail(new Error(`프레임 추출 실패: ${(e as Error).message}`));
      }
    };

    video.onerror = () => fail(new Error("영상 디코딩 실패"));
    video.src = objectUrl;
  });
}
