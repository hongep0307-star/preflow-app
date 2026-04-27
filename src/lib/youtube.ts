/**
 * YouTube 메타/자막 ingest 의 프런트 헬퍼.
 *
 * BriefTab 의 Reference 패널에서 사용자가 URL 을 붙여넣으면 즉시 호출.
 * 핸들러 호출 자체는 빠르지만 oEmbed/timedtext 가 막힐 수 있으므로
 * 실패 시 fallback 결과 (videoId + 썸네일 추정 URL) 를 반환해 UI 가
 * 항상 칩을 그릴 수 있게 한다.
 */
import { LOCAL_SERVER_AUTH_HEADERS, LOCAL_SERVER_BASE_URL } from "@shared/constants";

export interface YoutubeIngestResult {
  videoId: string;
  url: string;
  title?: string;
  channel?: string;
  thumbnailUrl?: string;
  durationSec?: number;
  transcript?: string;
  transcriptWarning?: string;
}

export const YOUTUBE_URL_REGEX =
  /^(?:https?:\/\/)?(?:(?:www|m)\.)?(?:youtube\.com\/(?:watch\?[^#]*?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

export function isYoutubeUrl(input: string): boolean {
  return YOUTUBE_URL_REGEX.test(input.trim());
}

export async function ingestYoutube(url: string): Promise<YoutubeIngestResult> {
  const res = await fetch(`${LOCAL_SERVER_BASE_URL}/api/youtube-ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...LOCAL_SERVER_AUTH_HEADERS },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error ?? `YouTube ingest HTTP ${res.status}`);
  }
  const data = (await res.json()) as YoutubeIngestResult & { error?: string };
  if (data.error) throw new Error(data.error);
  return data;
}
