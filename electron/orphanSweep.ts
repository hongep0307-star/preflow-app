/* Orphan-file sweep — 한 번의 동기 파일시스템 워킹으로 "DB 어디에서도
 * 참조되지 않는 PNG" 를 찾아 삭제한다.
 *
 * 왜 필요한가:
 *   - 에셋/무드/히스토리 개별 삭제에서 `storage.remove` 호출을 뒤늦게
 *     추가했지만, 이미 구버전에서 누수된 파일이 디스크에 남아있다.
 *   - Inpaint 파이프라인이 mask / overlay / preflight-source 같은 중간
 *     파일을 일회성으로 업로드하는데, 모두 정확하게 추적해 delete 하는
 *     건 코드 복잡도가 크다. Orphan sweep 이 최종 safety net.
 *   - 스타일 트랜스퍼, 인페인트 재시도 중 실패한 중간 업로드 잔존.
 *
 * 안전 원칙:
 *   1. DB 참조 URL 을 먼저 다 긁은 뒤, 디스크 워크를 시작. 순서가 뒤집히면
 *      아직 DB에 반영 안 된 새 업로드가 orphan 으로 오인될 수 있음.
 *   2. 버킷 / projectId 폴더 구조를 강제 — `.` 으로 시작하거나 이상한
 *      경로는 절대 건드리지 않음.
 *   3. `style_presets` 버킷은 "모든 행" 의 URL 을 그대로 참조 집합에
 *      넣음 (project 스코프 없음).
 *   4. 최근 5분 이내 생성된 파일은 건드리지 않음 — 이 순간 진행 중인
 *      생성 파이프라인이 DB commit 전이라도 건너뛰기.
 */

import fs from "fs";
import path from "path";
import { getDb } from "./db";
import { getStorageBasePath } from "./paths";
import { LOCAL_SERVER_BASE_URL } from "../shared/constants";

const BUCKETS = ["contis", "assets", "briefs", "mood", "style-presets"] as const;
type Bucket = (typeof BUCKETS)[number];

/** 최근 N 초 이내 수정/생성된 파일은 orphan sweep 대상에서 제외. */
const RECENT_FILE_GRACE_MS = 5 * 60 * 1000;

/** URL → { bucket, filePath } 역파싱. Public URL 포맷:
 *    ${LOCAL_SERVER_BASE_URL}/storage/file/<bucket>/<filePath...>
 *  (`?t=...` 같은 cache-buster 쿼리스트링이 섞여있을 수 있음) */
function parseStorageUrl(url: string): { bucket: string; filePath: string } | null {
  if (!url || typeof url !== "string") return null;
  const prefix = `${LOCAL_SERVER_BASE_URL}/storage/file/`;
  if (!url.startsWith(prefix)) return null;
  let rest = url.slice(prefix.length);
  const qIdx = rest.search(/[?#]/);
  if (qIdx >= 0) rest = rest.slice(0, qIdx);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const bucket = rest.slice(0, slash);
  let filePath: string;
  try {
    filePath = decodeURIComponent(rest.slice(slash + 1));
  } catch {
    return null;
  }
  if (!bucket || !filePath) return null;
  return { bucket, filePath };
}

/** JSON TEXT 컬럼에서 URL 후보를 재귀적으로 뽑아냄.
 *  중요: 특정 키(`url`, `image_url` ...)만 본다면 `scene_versions.scenes`
 *  처럼 `conti_image_url`, `conti_image_history` 같이 임의 필드명으로 URL을
 *  품고 있는 레코드를 놓칠 수 있다. 그래서 "모든 문자열은 URL 후보" 로
 *  간주하고 오브젝트/배열의 모든 값에 재귀한다. `parseStorageUrl` 이
 *  LOCAL_SERVER_BASE_URL 프리픽스로 자연스럽게 필터한다. */
function collectUrlsFromJson(value: unknown, sink: Set<string>) {
  if (value == null) return;
  if (typeof value === "string") {
    sink.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectUrlsFromJson(v, sink);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectUrlsFromJson(v, sink);
    }
  }
}

function safeJsonParse(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** DB 에서 참조되고 있는 모든 storage URL 을 수집해서,
 *  "<bucket>/<filePath>" 형태의 Set 으로 반환. */
function collectReferencedKeys(): Set<string> {
  const db = getDb();
  const urls = new Set<string>();
  const addUrl = (u: string | null | undefined) => {
    if (u) urls.add(u);
  };

  // projects.thumbnail_url
  for (const row of db.prepare(`SELECT thumbnail_url FROM projects`).all() as { thumbnail_url: string | null }[]) {
    addUrl(row.thumbnail_url);
  }

  // briefs.mood_image_urls, briefs.image_urls (both JSON arrays)
  for (const row of db
    .prepare(`SELECT mood_image_urls, image_urls FROM briefs`)
    .all() as { mood_image_urls: string | null; image_urls: string | null }[]) {
    collectUrlsFromJson(safeJsonParse(row.mood_image_urls), urls);
    collectUrlsFromJson(safeJsonParse(row.image_urls), urls);
  }

  // scenes.conti_image_url + scenes.conti_image_history
  for (const row of db
    .prepare(`SELECT conti_image_url, conti_image_history FROM scenes`)
    .all() as { conti_image_url: string | null; conti_image_history: string | null }[]) {
    addUrl(row.conti_image_url);
    collectUrlsFromJson(safeJsonParse(row.conti_image_history), urls);
  }

  // assets.photo_url + assets.photo_variations
  for (const row of db
    .prepare(`SELECT photo_url, photo_variations FROM assets`)
    .all() as { photo_url: string | null; photo_variations: string | null }[]) {
    addUrl(row.photo_url);
    collectUrlsFromJson(safeJsonParse(row.photo_variations), urls);
  }

  // scene_versions.scenes — 각 요소는 scene 객체이고 그 안에 conti_image_url /
  // conti_image_history 가 들어있음. JSON 재귀로 다 긁어냄.
  for (const row of db.prepare(`SELECT scenes FROM scene_versions`).all() as { scenes: string | null }[]) {
    collectUrlsFromJson(safeJsonParse(row.scenes), urls);
  }

  // style_presets.thumbnail_url + style_presets.reference_image_urls
  for (const row of db
    .prepare(`SELECT thumbnail_url, reference_image_urls FROM style_presets`)
    .all() as { thumbnail_url: string | null; reference_image_urls: string | null }[]) {
    addUrl(row.thumbnail_url);
    collectUrlsFromJson(safeJsonParse(row.reference_image_urls), urls);
  }

  // URL 을 <bucket>/<filePath> 키로 정규화.
  const keys = new Set<string>();
  for (const u of urls) {
    const parsed = parseStorageUrl(u);
    if (!parsed) continue;
    keys.add(`${parsed.bucket}/${parsed.filePath}`);
  }
  return keys;
}

/** 한 버킷 디렉터리를 재귀 워킹하며 모든 파일의 (key, absPath, size, mtimeMs) 수집.
 *  key = `<bucket>/<relPath>` — collectReferencedKeys() 와 같은 포맷. */
function listBucketFiles(
  bucket: Bucket,
  storageBase: string,
): Array<{ key: string; absPath: string; size: number; mtimeMs: number }> {
  const bucketDir = path.join(storageBase, bucket);
  if (!fs.existsSync(bucketDir)) return [];
  const out: Array<{ key: string; absPath: string; size: number; mtimeMs: number }> = [];

  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      // `.DS_Store` 등 dot-file 은 건드리지 않음.
      if (ent.name.startsWith(".")) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile()) {
        try {
          const st = fs.statSync(full);
          // POSIX separators 로 통일해 DB 참조 키와 비교 가능하게.
          const rel = path.relative(bucketDir, full).split(path.sep).join("/");
          out.push({
            key: `${bucket}/${rel}`,
            absPath: full,
            size: st.size,
            mtimeMs: st.mtimeMs,
          });
        } catch {
          /* ignore stat errors */
        }
      }
    }
  };
  walk(bucketDir);
  return out;
}

/** 실제 sweep. App 시작 시 한 번 호출한다.
 *  - 디스크 파일 목록 - DB 참조 목록 = 지울 대상
 *  - 하지만 최근 N분 내 수정된 파일은 건드리지 않음 (race 방지). */
export function sweepOrphanFiles(): {
  filesDeleted: number;
  bytesFreed: number;
  skippedRecent: number;
  durationMs: number;
} {
  const startedAt = Date.now();
  const storageBase = getStorageBasePath();

  let referenced: Set<string>;
  try {
    referenced = collectReferencedKeys();
  } catch (err) {
    // DB 쿼리 실패 시에는 절대 sweep 하지 않는다 — 참조 없음으로 오인돼
    // 전체를 날릴 수 있음.
    console.error("[orphanSweep] aborted: collectReferencedKeys failed:", err);
    return { filesDeleted: 0, bytesFreed: 0, skippedRecent: 0, durationMs: Date.now() - startedAt };
  }

  // 디스크 워킹은 DB 스냅샷을 뜬 뒤에 수행 — 새로 들어올 가능성이 있는
  // 파일은 grace window 로 방어하지만, 반대로 "방금 업로드 + DB 기록 완료"
  // 된 파일이 디스크에 아직 안 나타날 가능성은 없으므로 순서는 이쪽이 맞다.

  // 전체 on-disk 파일 대비 orphan 후보 수집 먼저 — 실제 unlink 는 나중에.
  let totalFiles = 0;
  const candidates: Array<{ key: string; absPath: string; size: number; mtimeMs: number; bucket: Bucket }> = [];
  let skippedRecent = 0;
  const now = Date.now();

  for (const bucket of BUCKETS) {
    const files = listBucketFiles(bucket, storageBase);
    totalFiles += files.length;
    for (const f of files) {
      if (referenced.has(f.key)) continue;
      if (now - f.mtimeMs < RECENT_FILE_GRACE_MS) {
        skippedRecent++;
        continue;
      }
      candidates.push({ ...f, bucket });
    }
  }

  // 안전장치: DB 참조가 비어있다면 (새 프로필 / 빈 DB) 디스크도 비어있어야
  // 자연스럽다. 참조가 0 이면서 삭제 후보가 있다면 뭔가 잘못된 상태 →
  // 경고만 남기고 sweep 스킵.
  if (referenced.size === 0 && candidates.length > 0) {
    console.warn(
      `[orphanSweep] aborted: 0 DB references but ${candidates.length} candidates — refusing to delete as a safety measure`,
    );
    return { filesDeleted: 0, bytesFreed: 0, skippedRecent, durationMs: Date.now() - startedAt };
  }

  // 추가 안전장치: 한 번의 sweep 에서 전체 파일의 50% 이상을 날리려 하면
  // 경고를 남기고 스킵. 실제 이런 상황이면 DB 가 손상되었거나 참조 수집
  // 에 버그가 있을 가능성이 훨씬 높다.
  if (totalFiles > 20 && candidates.length > totalFiles * 0.5) {
    console.warn(
      `[orphanSweep] aborted: would delete ${candidates.length}/${totalFiles} files (>50%). Sample:`,
      candidates.slice(0, 10).map((c) => c.key),
    );
    return { filesDeleted: 0, bytesFreed: 0, skippedRecent, durationMs: Date.now() - startedAt };
  }

  let filesDeleted = 0;
  let bytesFreed = 0;
  for (const f of candidates) {
    try {
      fs.unlinkSync(f.absPath);
      filesDeleted++;
      bytesFreed += f.size;
    } catch (err) {
      console.warn("[orphanSweep] unlink failed", f.absPath, (err as Error).message);
    }
  }

  // 빈 projectId 폴더는 자진 정리 (대부분 프로젝트 삭제 후 잔존).
  for (const bucket of BUCKETS) {
    const bucketDir = path.join(storageBase, bucket);
    if (!fs.existsSync(bucketDir)) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(bucketDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const sub = path.join(bucketDir, ent.name);
      try {
        const inner = fs.readdirSync(sub);
        if (inner.length === 0) fs.rmdirSync(sub);
      } catch {
        /* ignore */
      }
    }
  }

  const durationMs = Date.now() - startedAt;
  console.log(
    `[orphanSweep] done — deleted ${filesDeleted} orphan file(s), freed ${(bytesFreed / 1024 / 1024).toFixed(2)} MB, skipped ${skippedRecent} recent file(s) in ${durationMs}ms`,
  );
  return { filesDeleted, bytesFreed, skippedRecent, durationMs };
}
