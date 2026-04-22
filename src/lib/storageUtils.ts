import { LOCAL_SERVER_BASE_URL } from "@shared/constants";
import { supabase } from "./supabase";

/** Storage URL → { bucket, filePath } 파싱.
 *
 *  로컬 스토리지의 public URL 은 다음 형태다:
 *    ${LOCAL_SERVER_BASE_URL}/storage/file/<bucket>/<filePath...>
 *
 *  - `filePath` 는 projectId 폴더 + 파일명 (예: "abc-123/scene_1_xxx.png")
 *  - `?t=...` 같은 cache-buster 쿼리스트링은 제거한다.
 *  - 포맷과 다른 URL (http, data:, blob: 등) 이면 null 반환. */
export function parseStorageUrl(url: string | null | undefined): { bucket: string; filePath: string } | null {
  if (!url || typeof url !== "string") return null;

  const prefix = `${LOCAL_SERVER_BASE_URL}/storage/file/`;
  if (!url.startsWith(prefix)) return null;

  // strip query string / hash (cache-busters like `?t=12345` 이 붙어있음)
  let rest = url.slice(prefix.length);
  const qIdx = rest.search(/[?#]/);
  if (qIdx >= 0) rest = rest.slice(0, qIdx);

  const slash = rest.indexOf("/");
  if (slash <= 0) return null;

  const bucket = rest.slice(0, slash);
  const filePath = decodeURIComponent(rest.slice(slash + 1));
  if (!bucket || !filePath) return null;

  return { bucket, filePath };
}

/** 주어진 public URL 이 우리 로컬 스토리지에 있는 파일이면 지운다.
 *  외부/데이터 URL 이거나 파싱 실패 시 조용히 no-op — 호출부에서 URL 의
 *  출처를 알 필요 없이 안전하게 쓸 수 있도록.
 *
 *  실패는 warn 만 찍고 삼킨다. "DB 에는 지웠는데 파일 삭제 실패" 때문에
 *  UX 가 꼬이는 건 원치 않고, 남은 고아 파일은 앱 시작시 orphan sweep 이
 *  주워가기 때문. */
export async function deleteStoredFile(url: string | null | undefined): Promise<void> {
  const parsed = parseStorageUrl(url);
  if (!parsed) return;
  try {
    const res = await supabase.storage.from(parsed.bucket).remove([parsed.filePath]);
    if (res?.error) console.warn("[storage] delete failed", parsed, res.error);
  } catch (e) {
    console.warn("[storage] delete threw", parsed, e);
  }
}

/** 여러 URL 을 한 번에 삭제. 버킷별로 묶어서 배치 remove 호출 하므로
 *  많은 파일을 한꺼번에 지울 때 왕복 호출 수가 줄어든다. */
export async function deleteStoredFiles(urls: Array<string | null | undefined>): Promise<void> {
  const byBucket = new Map<string, string[]>();
  for (const u of urls) {
    const parsed = parseStorageUrl(u);
    if (!parsed) continue;
    const arr = byBucket.get(parsed.bucket) ?? [];
    arr.push(parsed.filePath);
    byBucket.set(parsed.bucket, arr);
  }
  if (byBucket.size === 0) return;
  await Promise.all(
    [...byBucket.entries()].map(async ([bucket, paths]) => {
      try {
        const res = await supabase.storage.from(bucket).remove(paths);
        if (res?.error) console.warn("[storage] batch delete failed", bucket, paths, res.error);
      } catch (e) {
        console.warn("[storage] batch delete threw", bucket, paths, e);
      }
    }),
  );
}
