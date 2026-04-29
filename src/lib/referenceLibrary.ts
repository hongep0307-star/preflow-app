import {
  LOCAL_SERVER_AUTH_HEADERS,
  LOCAL_SERVER_BASE_URL,
  REFERENCE_UPLOAD_MAX_BYTES,
  REFERENCE_UPLOAD_MAX_LABEL,
} from "@shared/constants";
import { supabase } from "./supabase";
import { deleteStoredFiles, parseStorageUrl } from "./storageUtils";
import { extractFirstFrame, validateVideoFile, validateVideoMeta } from "./videoFrames";
import { ingestYoutube, isYoutubeUrl, YOUTUBE_URL_REGEX } from "./youtube";
import type { RefAnnotation, RefImageItem, RefItem, RefVideoItem, RefYoutubeItem } from "./refItems";

const REFERENCES_BUCKET = "references";

export type ReferenceKind = "image" | "webp" | "gif" | "video" | "youtube" | "link";
export type ClassificationStatus = "unclassified" | "pending" | "ready" | "failed" | "skipped";

export interface TimestampNote {
  id: string;
  atSec?: number;
  rangeText?: string;
  text: string;
}

export interface ColorSwatch {
  color: string;
  ratio?: number;
}

export interface ReferenceItem {
  id: string;
  kind: ReferenceKind;
  title: string;
  file_url?: string | null;
  thumbnail_url?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  content_hash?: string | null;
  duration_sec?: number | null;
  width?: number | null;
  height?: number | null;
  tags: string[];
  notes?: string | null;
  rating?: number | null;
  is_favorite?: boolean;
  source_url?: string | null;
  cover_at_sec?: number | null;
  timestamp_notes: TimestampNote[];
  color_palette: ColorSwatch[];
  ai_suggestions?: Record<string, unknown> | null;
  classification_status?: ClassificationStatus | string | null;
  classified_at?: string | null;
  origin_project_id?: string | null;
  source_app?: string | null;
  source_library?: string | null;
  source_id?: string | null;
  imported_at?: string | null;
  pinned_at?: string | null;
  deleted_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_used_at?: string | null;
  /** Promote-to-Asset 으로 만들어진 asset id 목록. reference 본체는 절대
   *  자동 삭제되지 않고, "이 자료에서 만든 asset 이 있다" 메타로 남는다. */
  promoted_asset_ids?: string[];
}

export interface ProjectReferenceLink {
  id: string;
  project_id: string;
  reference_id: string;
  target: "brief" | "agent" | "conti" | "asset" | string;
  annotation?: string | null;
  time_range?: RefAnnotation | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface SavedFilter {
  id: string;
  name: string;
  query: Record<string, unknown>;
  source_app?: string | null;
  source_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ReferenceListOptions {
  kind?: ReferenceKind;
  tag?: string;
  query?: string;
  limit?: number;
  sortBy?: "created_at" | "updated_at" | "last_used_at" | "title" | "rating" | "file_size";
  ascending?: boolean;
  /** 기본 false — Trash(소프트 삭제) 행을 결과에서 제외한다. true 로 줘야
   *  Trash 가상 폴더처럼 의도적으로 trashed 만 보고 싶을 때 포함시킬 수 있다. */
  includeTrashed?: boolean;
  /** Trash 만 보고 싶을 때 사용. true 면 `deleted_at IS NOT NULL` 만. */
  trashedOnly?: boolean;
}

export interface CreateReferenceInput {
  id?: string;
  kind: ReferenceKind;
  title: string;
  file_url?: string | null;
  thumbnail_url?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  content_hash?: string | null;
  duration_sec?: number | null;
  width?: number | null;
  height?: number | null;
  tags?: string[];
  notes?: string | null;
  rating?: number | null;
  is_favorite?: boolean;
  source_url?: string | null;
  cover_at_sec?: number | null;
  timestamp_notes?: TimestampNote[];
  color_palette?: ColorSwatch[];
  ai_suggestions?: Record<string, unknown> | null;
  classification_status?: ClassificationStatus;
  classified_at?: string | null;
  origin_project_id?: string | null;
  source_app?: string | null;
  source_library?: string | null;
  source_id?: string | null;
  imported_at?: string | null;
  pinned_at?: string | null;
  deleted_at?: string | null;
  promoted_asset_ids?: string[];
}

export interface UploadReferenceOptions {
  title?: string;
  tags?: string[];
  notes?: string;
  originProjectId?: string;
  sourceUrl?: string;
}

type ReferenceRow = Omit<
  ReferenceItem,
  "tags" | "timestamp_notes" | "color_palette" | "is_favorite" | "promoted_asset_ids"
> & {
  tags?: string[] | string | null;
  timestamp_notes?: TimestampNote[] | string | null;
  color_palette?: ColorSwatch[] | string | null;
  is_favorite?: boolean | number | null;
  promoted_asset_ids?: string[] | string | null;
};

type SavedFilterRow = Omit<SavedFilter, "query"> & {
  query?: Record<string, unknown> | string | null;
};

/** local-server 가 fallback 포트로 떠있던 이전 세션에서 저장된 URL이
 *  `http://127.0.0.1:<old-port>/storage/file/...` 형태로 박혀 있을 수 있다.
 *  새로 부팅된 세션의 base URL 이 다르면 `<img src>` / fetch 가 깨지므로,
 *  read 시점에 현재 base URL 로 재조립한다. parse 실패 (외부 URL · YouTube
 *  thumbnail · data: 등) 는 원본 그대로 통과. */
function rewriteStorageUrl(url: string | null | undefined): string | null | undefined {
  if (!url) return url;
  const parsed = parseStorageUrl(url);
  if (!parsed) return url;
  const encodedPath = parsed.filePath.split("/").map(encodeURIComponent).join("/");
  return `${LOCAL_SERVER_BASE_URL}/storage/file/${encodeURIComponent(parsed.bucket)}/${encodedPath}`;
}

function fileExtensionFromUrl(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const pathname = new URL(url).pathname;
    return pathname.match(/\.[^./?#]+$/)?.[0]?.toLowerCase() ?? "";
  } catch {
    return url.split(/[?#]/, 1)[0].match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? "";
  }
}

function normalizeReferenceKind(row: ReferenceRow, fileUrl: string | null | undefined): ReferenceKind {
  const kind = row.kind as ReferenceKind;
  if (kind !== "image") return kind;
  const mime = row.mime_type?.toLowerCase() ?? "";
  const ext = fileExtensionFromUrl(fileUrl);
  if (mime === "image/gif" || ext === ".gif") return "gif";
  if (mime === "image/webp" || ext === ".webp") return "webp";
  return "image";
}

function normalizeReference(row: ReferenceRow): ReferenceItem {
  const fileUrl = rewriteStorageUrl(row.file_url);
  const thumbnailUrl = rewriteStorageUrl(row.thumbnail_url);
  return {
    ...row,
    kind: normalizeReferenceKind(row, fileUrl),
    file_url: fileUrl,
    thumbnail_url: thumbnailUrl,
    tags: parseArray<string>(row.tags),
    timestamp_notes: parseArray<TimestampNote>(row.timestamp_notes),
    color_palette: parseArray<ColorSwatch>(row.color_palette),
    is_favorite: Boolean(row.is_favorite),
    promoted_asset_ids: parseArray<string>(row.promoted_asset_ids),
  };
}

function parseArray<T>(value: T[] | string | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseRecord(value: Record<string, unknown> | string | null | undefined): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function makeId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function sanitizeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "reference";
}

function fileExtension(file: File): string {
  const fromName = file.name.match(/\.[^.]+$/)?.[0]?.toLowerCase();
  if (fromName) return fromName;
  if (file.type === "image/png") return ".png";
  if (file.type === "image/jpeg") return ".jpg";
  if (file.type === "image/webp") return ".webp";
  if (file.type === "image/gif") return ".gif";
  if (file.type === "video/mp4") return ".mp4";
  if (file.type === "video/webm") return ".webm";
  if (file.type === "video/quicktime") return ".mov";
  return "";
}

export function detectReferenceKind(file: File): ReferenceKind {
  const ext = fileExtension(file);
  if (file.type === "image/gif" || ext === ".gif") return "gif";
  if (ext === ".apng") return "gif";
  if (file.type === "image/webp" || ext === ".webp") return "webp";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/") || [".mp4", ".mov", ".webm"].includes(ext)) return "video";
  throw new Error(`Unsupported reference file type: ${file.type || ext || file.name}`);
}

/**
 * Inspect file magic bytes to detect animated WebP / APNG. Some animated
 * raster images get classified as `kind: "image"` purely from extension
 * (.webp, .png), which then auto-animates when rendered as <img>. Calling
 * this lets the upload pipeline upgrade them to `kind: "gif"` so downstream
 * UI (Conti card, Studio Compare) can route them through the same
 * thumbnail-static + hover-animated treatment as videos.
 */
export async function detectAnimatedRasterKind(file: File): Promise<"gif" | null> {
  const ext = fileExtension(file);
  if (ext !== ".webp" && ext !== ".png") return null;
  const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
  if (ext === ".webp") {
    if (head.length < 12) return null;
    // RIFF....WEBP
    if (head[0] !== 0x52 || head[1] !== 0x49 || head[2] !== 0x46 || head[3] !== 0x46) return null;
    if (head[8] !== 0x57 || head[9] !== 0x45 || head[10] !== 0x42 || head[11] !== 0x50) return null;
    // ANIM chunk (extended WebP) signals an animated frame stream.
    for (let i = 12; i < head.length - 4; i++) {
      if (head[i] === 0x41 && head[i + 1] === 0x4e && head[i + 2] === 0x49 && head[i + 3] === 0x4d) return "gif";
    }
    return null;
  }
  // PNG signature
  if (head.length < 16) return null;
  if (head[0] !== 0x89 || head[1] !== 0x50 || head[2] !== 0x4e || head[3] !== 0x47) return null;
  // acTL chunk before IDAT signals APNG.
  for (let i = 8; i < head.length - 4; i++) {
    const c0 = head[i];
    const c1 = head[i + 1];
    const c2 = head[i + 2];
    const c3 = head[i + 3];
    if (c0 === 0x61 && c1 === 0x63 && c2 === 0x54 && c3 === 0x4c) return "gif"; // acTL
    if (c0 === 0x49 && c1 === 0x44 && c2 === 0x41 && c3 === 0x54) return null; // IDAT first → not animated
  }
  return null;
}

/**
 * Render the first frame of an image (gif / animated webp / apng / static)
 * to a PNG blob. Used to manufacture a static thumbnail so the Conti card
 * stays still until the user hovers it.
 */
async function extractStaticPosterFromImageFile(file: File): Promise<Blob | null> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Failed to load image for poster extraction."));
      el.src = objectUrl;
    });
    const w = img.naturalWidth || img.width || 1280;
    const h = img.naturalHeight || img.height || 720;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return await canvasToBlob(canvas, "image/png");
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function sha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function blobToBase64(blob: Blob): Promise<{ base64: string; mediaType: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
  const [meta, base64 = ""] = dataUrl.split(",");
  const mediaType = meta.match(/^data:(.*?);base64$/)?.[1] || blob.type || "application/octet-stream";
  return { base64, mediaType };
}

async function urlToBase64(url: string): Promise<{ base64: string; mediaType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to read reference media: HTTP ${res.status}`);
  return blobToBase64(await res.blob());
}

function storagePath(id: string, fileName: string): string {
  const yyyyMm = new Date().toISOString().slice(0, 7);
  return `${yyyyMm}/${id}/${sanitizeFileName(fileName)}`;
}

async function uploadToReferences(path: string, data: File | Blob): Promise<string> {
  const { error } = await supabase.storage.from(REFERENCES_BUCKET).upload(path, data, {
    contentType: data.type || undefined,
    upsert: true,
  });
  if (error) throw new Error(error.message);
  return supabase.storage.from(REFERENCES_BUCKET).getPublicUrl(path).data.publicUrl;
}

async function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob) throw new Error("Failed to capture frame.");
  return blob;
}

function drawVideoFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to create frame canvas.");
  ctx.drawImage(video, 0, 0, width, height);
  return canvas;
}

function requireSuccess<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (data === null) throw new Error("Expected data but received null");
  return data;
}

async function localShellPost<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${LOCAL_SERVER_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...LOCAL_SERVER_AUTH_HEADERS },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function getStoredTranscript(item: ReferenceItem): string | undefined {
  const transcript = item.ai_suggestions?.transcript;
  return typeof transcript === "string" && transcript.trim() ? transcript : undefined;
}

export async function listReferences(options: ReferenceListOptions = {}): Promise<ReferenceItem[]> {
  const { data, error } = await supabase
    .from("reference_items")
    .select("*")
    .order(options.sortBy ?? "created_at", { ascending: options.ascending ?? false })
    .limit(options.limit ?? 500);
  const rows = requireSuccess<ReferenceRow[]>(data as ReferenceRow[] | null, error);
  let items = rows.map(normalizeReference);

  // Trash 필터: 기본은 활성(=deleted_at NULL) 행만. trashedOnly 면 반대로.
  // 명시적으로 includeTrashed:true 로 옵트인하지 않는 한 다른 모든 호출자는
  // 자동으로 trash 가 빠진 결과를 받는다 — 매 호출부에서 client-side filter
  // 하다가 빠뜨리는 사고를 막기 위함.
  if (options.trashedOnly) {
    items = items.filter((item) => Boolean(item.deleted_at));
  } else if (!options.includeTrashed) {
    items = items.filter((item) => !item.deleted_at);
  }

  if (options.kind) items = items.filter((item) => item.kind === options.kind);
  if (options.tag) items = items.filter((item) => item.tags.includes(options.tag!));
  if (options.query?.trim()) {
    const q = options.query.trim().toLowerCase();
    items = items.filter((item) => {
      const haystack = [
        item.title,
        item.notes,
        item.source_url,
        ...item.tags,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }
  if (!options.sortBy) {
    items = [...items].sort((a, b) => {
      const pinA = a.pinned_at ? 1 : 0;
      const pinB = b.pinned_at ? 1 : 0;
      if (pinA !== pinB) return pinB - pinA;
      return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
    });
  }
  return items;
}

export async function listSavedFilters(): Promise<SavedFilter[]> {
  const { data, error } = await supabase
    .from("saved_filters")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = requireSuccess<SavedFilterRow[]>(data as SavedFilterRow[] | null, error);
  return rows.map((row) => ({
    ...row,
    query: parseRecord(row.query),
  }));
}

export async function getReference(id: string): Promise<ReferenceItem | null> {
  const { data, error } = await supabase
    .from("reference_items")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? normalizeReference(data as ReferenceRow) : null;
}

export async function listReferencesByIds(ids: string[]): Promise<ReferenceItem[]> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) return [];
  const { data, error } = await supabase
    .from("reference_items")
    .select("*")
    .in("id", uniqueIds);
  const rows = requireSuccess<ReferenceRow[]>(data as ReferenceRow[] | null, error);
  const byId = new Map(rows.map((row) => [row.id, normalizeReference(row)]));
  return uniqueIds.map((id) => byId.get(id)).filter((item): item is ReferenceItem => Boolean(item));
}

export function getReferencePreviewImageUrl(item: ReferenceItem): string | null {
  // For animated raster references (gif / animated webp / apng) prefer the
  // extracted static poster so callers can render a still preview and keep
  // the moving original for hover-only playback. Falls back to the original
  // file when no poster is available (legacy uploads).
  if (item.kind === "gif") return item.thumbnail_url || item.file_url || null;
  if (item.kind === "image" || item.kind === "webp") return item.file_url || item.thumbnail_url || null;
  if (item.kind === "video" || item.kind === "youtube") return item.thumbnail_url || null;
  return null;
}

export async function createReference(input: CreateReferenceInput): Promise<ReferenceItem> {
  const now = new Date().toISOString();
  const row = {
    id: input.id ?? makeId(),
    title: input.title.trim() || "Untitled Reference",
    kind: input.kind,
    file_url: input.file_url ?? null,
    thumbnail_url: input.thumbnail_url ?? null,
    mime_type: input.mime_type ?? null,
    file_size: input.file_size ?? null,
    content_hash: input.content_hash ?? null,
    duration_sec: input.duration_sec ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    tags: input.tags ?? [],
    notes: input.notes ?? null,
    rating: input.rating ?? null,
    is_favorite: input.is_favorite ?? false,
    source_url: input.source_url ?? null,
    cover_at_sec: input.cover_at_sec ?? null,
    timestamp_notes: input.timestamp_notes ?? [],
    color_palette: input.color_palette ?? [],
    ai_suggestions: input.ai_suggestions ?? null,
    classification_status: input.classification_status ?? "unclassified",
    classified_at: input.classified_at ?? null,
    origin_project_id: input.origin_project_id ?? null,
    source_app: input.source_app ?? null,
    source_library: input.source_library ?? null,
    source_id: input.source_id ?? null,
    imported_at: input.imported_at ?? null,
    pinned_at: input.pinned_at ?? null,
    deleted_at: input.deleted_at ?? null,
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await supabase.from("reference_items").insert(row).select().single();
  return normalizeReference(requireSuccess<ReferenceRow>(data as ReferenceRow | null, error));
}

export async function updateReference(id: string, patch: Partial<CreateReferenceInput>): Promise<ReferenceItem> {
  const { data, error } = await supabase
    .from("reference_items")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  return normalizeReference(requireSuccess<ReferenceRow>(data as ReferenceRow | null, error));
}

export function normalizeFolderPath(path: string): string {
  return path
    .replace(/^folder:/, "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

export function folderTag(path: string): string {
  const normalized = normalizeFolderPath(path);
  if (!normalized) throw new Error("Folder name is required.");
  return `folder:${normalized}`;
}

export async function getReferencesForFolderTag(tagOrPath: string, opts: { recursive?: boolean } = {}): Promise<ReferenceItem[]> {
  const tag = tagOrPath.startsWith("folder:") ? tagOrPath : folderTag(tagOrPath);
  const rows = await listReferences({ limit: 10_000 });
  return rows.filter((item) => item.tags.some((candidate) => (
    opts.recursive
      ? candidate === tag || candidate.startsWith(`${tag}/`)
      : candidate === tag
  )));
}

export async function listFolderPaths(): Promise<string[]> {
  const rows = await listReferences({ limit: 10_000 });
  const paths = new Set<string>();
  for (const item of rows) {
    for (const tag of item.tags) {
      if (tag.startsWith("folder:")) paths.add(normalizeFolderPath(tag));
    }
  }
  return [...paths].sort((a, b) => a.localeCompare(b));
}

async function updateReferenceTags(id: string, makeTags: (item: ReferenceItem) => string[]): Promise<ReferenceItem> {
  const item = await getReference(id);
  if (!item) throw new Error("Reference not found.");
  return updateReference(id, { tags: makeTags(item) });
}

export async function addReferencesToFolder(referenceIds: string[], path: string): Promise<ReferenceItem[]> {
  const tag = folderTag(path);
  const ids = [...new Set(referenceIds.filter(Boolean))];
  const updated: ReferenceItem[] = [];
  for (const id of ids) {
    updated.push(await updateReferenceTags(id, (item) => [...new Set([...item.tags, tag])]));
  }
  return updated;
}

export async function removeReferencesFromFolder(referenceIds: string[], path: string): Promise<ReferenceItem[]> {
  const tag = folderTag(path);
  const ids = [...new Set(referenceIds.filter(Boolean))];
  const updated: ReferenceItem[] = [];
  for (const id of ids) {
    updated.push(await updateReferenceTags(id, (item) => item.tags.filter((candidate) => candidate !== tag)));
  }
  return updated;
}

export async function moveReferencesToFolder(referenceIds: string[], path: string): Promise<ReferenceItem[]> {
  const tag = folderTag(path);
  const ids = [...new Set(referenceIds.filter(Boolean))];
  const updated: ReferenceItem[] = [];
  for (const id of ids) {
    updated.push(await updateReferenceTags(id, (item) => [
      ...item.tags.filter((candidate) => !candidate.startsWith("folder:")),
      tag,
    ]));
  }
  return updated;
}

export async function renameFolder(oldPath: string, newPath: string): Promise<{ updated: number; items: ReferenceItem[] }> {
  const oldTag = folderTag(oldPath);
  const newTag = folderTag(newPath);
  if (oldTag === newTag) return { updated: 0, items: [] };
  const rows = await listReferences({ limit: 10_000, includeTrashed: true });
  const changed = rows.filter((item) => item.tags.some((tag) => tag === oldTag || tag.startsWith(`${oldTag}/`)));
  const items: ReferenceItem[] = [];
  for (const item of changed) {
    items.push(await updateReference(item.id, {
      tags: item.tags.map((tag) => {
        if (tag === oldTag) return newTag;
        if (tag.startsWith(`${oldTag}/`)) return `${newTag}/${tag.slice(oldTag.length + 1)}`;
        return tag;
      }),
    }));
  }
  return { updated: items.length, items };
}

export async function deleteFolder(
  path: string,
  opts: { mode: "removeTagOnly" | "trashItems"; recursive?: boolean },
): Promise<{ affected: number; items: ReferenceItem[] }> {
  const tag = folderTag(path);
  const rows = await listReferences({ limit: 10_000, includeTrashed: true });
  const matches = rows.filter((item) => item.tags.some((candidate) => (
    opts.recursive
      ? candidate === tag || candidate.startsWith(`${tag}/`)
      : candidate === tag
  )));
  const items: ReferenceItem[] = [];
  for (const item of matches) {
    if (opts.mode === "trashItems") {
      items.push(await moveReferenceToTrash(item.id));
    } else {
      items.push(await updateReference(item.id, {
        tags: item.tags.filter((candidate) => (
          opts.recursive
            ? candidate !== tag && !candidate.startsWith(`${tag}/`)
            : candidate !== tag
        )),
      }));
    }
  }
  return { affected: items.length, items };
}

export async function toggleReferencePin(item: ReferenceItem): Promise<ReferenceItem> {
  return updateReference(item.id, {
    pinned_at: item.pinned_at ? null : new Date().toISOString(),
  });
}

export async function moveReferenceToTrash(id: string): Promise<ReferenceItem> {
  return updateReference(id, { deleted_at: new Date().toISOString() });
}

export async function restoreReference(id: string): Promise<ReferenceItem> {
  return updateReference(id, { deleted_at: null });
}

export async function resolveReferenceFilePath(item: ReferenceItem): Promise<string> {
  const url = item.file_url || item.thumbnail_url;
  if (!url) throw new Error("This reference has no local file.");
  const result = await localShellPost<{ filePath: string }>("/shell/resolve-path", { url });
  return result.filePath;
}

export async function openReferenceWithDefaultApp(item: ReferenceItem): Promise<void> {
  const url = item.file_url || item.thumbnail_url;
  if (!url) throw new Error("This reference has no local file.");
  await localShellPost<{ ok: true }>("/shell/open-path", { url });
}

export async function showReferenceInFolder(item: ReferenceItem): Promise<void> {
  const url = item.file_url || item.thumbnail_url;
  if (!url) throw new Error("This reference has no local file.");
  await localShellPost<{ ok: true }>("/shell/show-item", { url });
}

async function copyReferenceFileUrl(url: string | null | undefined, targetId: string, label: string): Promise<string | null> {
  if (!url) return null;
  const result = await localShellPost<{ publicUrl: string }>("/storage/copy-reference-file", { url, targetId, label });
  return result.publicUrl;
}

export async function duplicateReference(item: ReferenceItem): Promise<ReferenceItem> {
  const id = makeId();
  let fileUrl: string | null = null;
  let thumbnailUrl: string | null = null;
  if (item.file_url) {
    fileUrl = await copyReferenceFileUrl(item.file_url, id, "original");
  }
  if (item.thumbnail_url) {
    thumbnailUrl = item.thumbnail_url === item.file_url
      ? fileUrl
      : await copyReferenceFileUrl(item.thumbnail_url, id, "thumbnail");
  }
  return createReference({
    id,
    kind: item.kind,
    title: `${item.title} copy`,
    file_url: fileUrl,
    thumbnail_url: thumbnailUrl,
    mime_type: item.mime_type,
    file_size: item.file_size,
    content_hash: item.content_hash,
    duration_sec: item.duration_sec,
    width: item.width,
    height: item.height,
    tags: item.tags,
    notes: item.notes,
    rating: item.rating,
    is_favorite: item.is_favorite,
    source_url: item.source_url,
    cover_at_sec: item.cover_at_sec,
    timestamp_notes: item.timestamp_notes,
    color_palette: item.color_palette,
    ai_suggestions: item.ai_suggestions,
    classification_status: item.classification_status as ClassificationStatus,
    classified_at: item.classified_at,
    origin_project_id: item.origin_project_id,
    source_app: item.source_app ?? "preflow",
    source_library: item.source_library ?? "reference-library",
    source_id: item.source_id ?? item.id,
  });
}

export async function setReferenceCoverFromVideo(item: ReferenceItem, video: HTMLVideoElement): Promise<ReferenceItem> {
  if (item.kind !== "video") throw new Error("Only video references can set a video frame as cover.");
  const canvas = drawVideoFrame(video);
  const blob = await canvasToBlob(canvas, "image/png");
  const thumbnailUrl = await uploadToReferences(storagePath(item.id, `cover_${Math.round(video.currentTime * 1000)}.png`), blob);
  return updateReference(item.id, {
    thumbnail_url: thumbnailUrl,
    cover_at_sec: Number.isFinite(video.currentTime) ? video.currentTime : null,
    width: canvas.width,
    height: canvas.height,
  });
}

export async function saveVideoFrameAsReference(item: ReferenceItem, video: HTMLVideoElement): Promise<ReferenceItem> {
  if (item.kind !== "video") throw new Error("Only video references can save frames.");
  const canvas = drawVideoFrame(video);
  const blob = await canvasToBlob(canvas, "image/png");
  const frameId = makeId();
  const frameUrl = await uploadToReferences(storagePath(frameId, `${sanitizeFileName(item.title)}_frame.png`), blob);
  const timestamp = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  return createReference({
    id: frameId,
    kind: "image",
    title: `${item.title} frame ${formatSeconds(timestamp)}`,
    file_url: frameUrl,
    thumbnail_url: frameUrl,
    mime_type: "image/png",
    tags: [...new Set([...item.tags, "frame", "source:video-frame"])],
    notes: item.notes,
    source_url: item.file_url ?? item.source_url ?? null,
    source_app: "preflow",
    source_library: "reference-library",
    source_id: item.id,
  });
}

function loadVideoElement(src: string, seekSec: number): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    video.src = src;
    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onseeked = null;
      video.onerror = null;
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("Failed to load video for thumbnail regeneration."));
    };
    video.onloadedmetadata = () => {
      const target = Math.max(0, Math.min(seekSec, Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.1) : seekSec));
      video.currentTime = target || 0.1;
    };
    video.onseeked = () => {
      cleanup();
      resolve(video);
    };
  });
}

export async function regenerateReferenceThumbnail(item: ReferenceItem): Promise<ReferenceItem> {
  if (item.kind === "image" || item.kind === "webp" || item.kind === "gif") {
    if (!item.file_url) throw new Error("This reference has no stored image file.");
    return updateReference(item.id, { thumbnail_url: item.file_url });
  }
  if (item.kind === "youtube") {
    if (!item.source_url) throw new Error("This YouTube reference has no source URL.");
    const ingested = await ingestYoutube(item.source_url).catch(() => null);
    const videoId = item.source_url?.match(YOUTUBE_URL_REGEX)?.[1];
    return updateReference(item.id, {
      thumbnail_url: ingested?.thumbnailUrl ?? (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : item.thumbnail_url ?? null),
      duration_sec: ingested?.durationSec ?? item.duration_sec ?? null,
      ai_suggestions: ingested?.transcript ? { ...(item.ai_suggestions ?? {}), transcript: ingested.transcript } : item.ai_suggestions ?? null,
    });
  }
  if (item.kind === "video") {
    if (!item.file_url) throw new Error("This video reference has no stored file.");
    const video = await loadVideoElement(item.file_url, item.cover_at_sec ?? 0.1);
    const canvas = drawVideoFrame(video);
    const blob = await canvasToBlob(canvas, "image/png");
    const thumbnailUrl = await uploadToReferences(storagePath(item.id, `poster_regen_${Date.now()}.png`), blob);
    return updateReference(item.id, {
      thumbnail_url: thumbnailUrl,
      width: canvas.width,
      height: canvas.height,
    });
  }
  throw new Error("Thumbnail regeneration is not available for link references.");
}

export async function mergeReferences(keepId: string, mergeIds: string[]): Promise<{ keep: ReferenceItem; trashed: ReferenceItem[] }> {
  const keep = await getReference(keepId);
  if (!keep) throw new Error("Reference to keep was not found.");
  const mergeItems = await listReferencesByIds(mergeIds.filter((id) => id !== keepId));
  if (mergeItems.length === 0) return { keep, trashed: [] };
  const mergedTags = [...new Set([...keep.tags, ...mergeItems.flatMap((item) => item.tags)])];
  const mergedNotes = [keep.notes, ...mergeItems.map((item) => item.notes)]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .join("\n\n");
  const mergedTimestampNotes = [...keep.timestamp_notes, ...mergeItems.flatMap((item) => item.timestamp_notes)];
  const mergedPalette = keep.color_palette.length > 0 ? keep.color_palette : mergeItems.find((item) => item.color_palette.length > 0)?.color_palette ?? [];
  const nextKeep = await updateReference(keep.id, {
    tags: mergedTags,
    notes: mergedNotes || null,
    timestamp_notes: mergedTimestampNotes,
    color_palette: mergedPalette,
    rating: Math.max(keep.rating ?? 0, ...mergeItems.map((item) => item.rating ?? 0)) || null,
  });
  const trashed: ReferenceItem[] = [];
  for (const item of mergeItems) {
    trashed.push(await moveReferenceToTrash(item.id));
  }
  return { keep: nextKeep, trashed };
}

function formatSeconds(value: number): string {
  const safe = Math.max(0, Math.floor(value));
  const mm = Math.floor(safe / 60).toString().padStart(2, "0");
  const ss = (safe % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export async function deleteReference(id: string): Promise<void> {
  const item = await getReference(id);
  if (!item) return;
  const { error } = await supabase.from("reference_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await deleteStoredFiles([item.file_url, item.thumbnail_url]);
}

export async function uploadReferenceFile(file: File, options: UploadReferenceOptions = {}): Promise<ReferenceItem> {
  if (file.size > REFERENCE_UPLOAD_MAX_BYTES) {
    throw new Error(`${REFERENCE_UPLOAD_MAX_LABEL} 이하 파일만 Reference Library에 저장할 수 있습니다.`);
  }
  let kind = detectReferenceKind(file);
  if (kind === "image" || kind === "webp") {
    // Promote animated WebP / APNG up to `gif` so the rest of the pipeline
    // (Conti hover preview, Studio Compare placeholder) can treat them as
    // playable media instead of rendering them through a plain <img>.
    const animatedKind = await detectAnimatedRasterKind(file);
    if (animatedKind) kind = animatedKind;
  }
  if (kind === "video") {
    const validation = validateVideoFile(file);
    if (validation.ok !== true) throw new Error(validation.reason);
  }

  const id = makeId();
  const baseTitle = options.title?.trim() || file.name.replace(/\.[^.]+$/, "") || "Untitled Reference";

  if (kind === "video") {
    const { meta, poster } = await extractFirstFrame(file);
    const metaValidation = validateVideoMeta(meta);
    if (metaValidation.ok !== true) throw new Error(metaValidation.reason);
    const hash = await sha256(file);
    const originalPath = storagePath(id, file.name || `reference${fileExtension(file)}`);
    const fileUrl = await uploadToReferences(originalPath, file);
    const posterBlob = await (await fetch(`data:${poster.mediaType};base64,${poster.base64}`)).blob();
    const thumbnailUrl = await uploadToReferences(storagePath(id, "poster.png"), posterBlob);
    return createReference({
      id,
      kind,
      title: baseTitle,
      file_url: fileUrl,
      thumbnail_url: thumbnailUrl,
      mime_type: file.type || "video/*",
      file_size: file.size,
      content_hash: hash,
      duration_sec: meta.durationSec,
      width: meta.widthPx,
      height: meta.heightPx,
      tags: options.tags,
      notes: options.notes,
      source_url: options.sourceUrl,
      origin_project_id: options.originProjectId,
    });
  }

  const hash = await sha256(file);
  const originalPath = storagePath(id, file.name || `reference${fileExtension(file)}`);
  const fileUrl = await uploadToReferences(originalPath, file);
  // For animated raster images (gif / animated webp / apng) extract a static
  // first-frame poster.png so consumers can show a still thumbnail and only
  // animate on hover, matching the video reference contract. If extraction
  // fails (some browsers refuse to decode the first frame), we transparently
  // fall back to using the original file as its own thumbnail.
  let thumbnailUrl = fileUrl;
  if (kind === "gif") {
    const posterBlob = await extractStaticPosterFromImageFile(file);
    if (posterBlob) {
      thumbnailUrl = await uploadToReferences(storagePath(id, "poster.png"), posterBlob);
    }
  }
  return createReference({
    id,
    kind,
    title: baseTitle,
    file_url: fileUrl,
    thumbnail_url: thumbnailUrl,
    mime_type: file.type || (kind === "gif" ? "image/gif" : kind === "webp" ? "image/webp" : "image/*"),
    file_size: file.size,
    content_hash: hash,
    tags: options.tags,
    notes: options.notes,
    source_url: options.sourceUrl,
    origin_project_id: options.originProjectId,
  });
}

export async function createYoutubeReference(url: string, options: UploadReferenceOptions = {}): Promise<ReferenceItem> {
  const trimmed = url.trim();
  if (!isYoutubeUrl(trimmed)) throw new Error("YouTube URL이 아닙니다.");
  try {
    const ingested = await ingestYoutube(trimmed);
    return createReference({
      kind: "youtube",
      title: options.title?.trim() || ingested.title || "YouTube Reference",
      thumbnail_url: ingested.thumbnailUrl,
      duration_sec: ingested.durationSec,
      tags: options.tags,
      notes: options.notes,
      source_url: ingested.url,
      origin_project_id: options.originProjectId,
      ai_suggestions: ingested.transcript ? { transcript: ingested.transcript } : null,
    });
  } catch {
    const videoId = trimmed.match(YOUTUBE_URL_REGEX)?.[1];
    return createReference({
      kind: "youtube",
      title: options.title?.trim() || "YouTube Reference",
      thumbnail_url: videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null,
      tags: options.tags,
      notes: options.notes,
      source_url: trimmed,
      origin_project_id: options.originProjectId,
      classification_status: "skipped",
    });
  }
}

export async function createLinkReference(url: string, options: UploadReferenceOptions = {}): Promise<ReferenceItem> {
  const trimmed = url.trim();
  if (isYoutubeUrl(trimmed)) return createYoutubeReference(trimmed, options);
  return createReference({
    kind: "link",
    title: options.title?.trim() || trimmed,
    tags: options.tags,
    notes: options.notes,
    source_url: trimmed,
    origin_project_id: options.originProjectId,
    classification_status: "skipped",
  });
}

export async function linkReferenceToProject(input: {
  projectId: string;
  referenceId: string;
  target: ProjectReferenceLink["target"];
  annotation?: string;
  timeRange?: RefAnnotation;
}): Promise<ProjectReferenceLink> {
  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await supabase
    .from("project_reference_links")
    .select("*")
    .eq("project_id", input.projectId)
    .eq("reference_id", input.referenceId)
    .eq("target", input.target)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  if (existing) {
    await supabase.from("reference_items").update({ last_used_at: now, updated_at: now }).eq("id", input.referenceId);
    return existing as ProjectReferenceLink;
  }

  const row = {
    id: makeId(),
    project_id: input.projectId,
    reference_id: input.referenceId,
    target: input.target,
    annotation: input.annotation ?? null,
    time_range: input.timeRange ?? null,
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await supabase.from("project_reference_links").insert(row).select().single();
  if (error) throw new Error(error.message);
  await supabase.from("reference_items").update({ last_used_at: now, updated_at: now }).eq("id", input.referenceId);
  return data as ProjectReferenceLink;
}

/**
 * 각 reference 가 몇 개의 (프로젝트, target) 쌍에 연결돼 있는지 집계.
 *
 * 같은 reference 가 한 프로젝트의 brief / agent / conti 세 곳에 동시에 붙어
 * 있을 수 있으므로 "사용된 프로젝트 수" 보다 "사용된 (프로젝트,target) 수" 가
 * Inspector/Grid 의 "이 자료는 어디서 쓰이고 있나요?" 질문에 더 충실하다.
 *
 * 빈 배열이 들어오면 빈 record 반환 — 호출부에서 `?? 0` 로 안전하게 사용.
 */
export async function getReferenceUsageCounts(referenceIds: string[]): Promise<Record<string, number>> {
  const ids = [...new Set(referenceIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from("project_reference_links")
    .select("reference_id, project_id, target")
    .in("reference_id", ids);
  if (error) throw new Error(error.message);
  const seen = new Set<string>();
  const counts: Record<string, number> = {};
  for (const row of (data as Array<{ reference_id: string; project_id: string; target: string }> | null) ?? []) {
    const key = `${row.reference_id}:${row.project_id}:${row.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts[row.reference_id] = (counts[row.reference_id] ?? 0) + 1;
  }
  return counts;
}

export async function listProjectReferenceLinks(input: {
  projectId: string;
  target?: ProjectReferenceLink["target"];
}): Promise<ProjectReferenceLink[]> {
  let query = supabase
    .from("project_reference_links")
    .select("*")
    .eq("project_id", input.projectId)
    .order("created_at", { ascending: true });
  if (input.target) query = query.eq("target", input.target);
  const { data, error } = await query;
  const rows = requireSuccess<ProjectReferenceLink[]>(data as ProjectReferenceLink[] | null, error);
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.project_id}:${row.reference_id}:${row.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function getReferencesForProject(projectId: string, target?: ProjectReferenceLink["target"]): Promise<ReferenceItem[]> {
  const links = await listProjectReferenceLinks({ projectId, target });
  return listReferencesByIds(links.map((link) => link.reference_id));
}

export async function unlinkReferenceFromProject(input: {
  projectId: string;
  referenceId: string;
  target: ProjectReferenceLink["target"];
}): Promise<void> {
  const { error } = await supabase
    .from("project_reference_links")
    .delete()
    .eq("project_id", input.projectId)
    .eq("reference_id", input.referenceId)
    .eq("target", input.target);
  if (error) throw new Error(error.message);
}

export async function referenceToRefItem(item: ReferenceItem, annotation?: RefAnnotation): Promise<RefItem> {
  const addedAt = item.created_at ?? new Date().toISOString();
  if (item.kind === "youtube") {
    const videoId = item.source_url?.match(YOUTUBE_URL_REGEX)?.[1] ?? "";
    const ref: RefYoutubeItem = {
      kind: "youtube",
      id: `library_${item.id}`,
      addedAt,
      url: item.source_url ?? "",
      videoId,
      title: item.title,
      thumbnailUrl: item.thumbnail_url ?? undefined,
      durationSec: item.duration_sec ?? undefined,
      transcript: getStoredTranscript(item),
      status: videoId ? "ready" : "error",
      errorMsg: videoId ? undefined : "Missing YouTube video id",
      annotation,
    };
    return ref;
  }

  if (item.kind === "video") {
    if (!item.thumbnail_url) throw new Error("Video reference is missing a thumbnail.");
    const poster = await urlToBase64(item.thumbnail_url);
    const ref: RefVideoItem = {
      kind: "video",
      id: `library_${item.id}`,
      addedAt,
      fileName: item.title,
      fileSize: item.file_size ?? 0,
      durationSec: item.duration_sec ?? 0,
      posterBase64: poster.base64,
      status: "ready",
      // Library-sourced video has no original `File` handle — but the local
      // server can stream the stored file via `file_url`. BriefTab/Conti use
      // `remote_url` to do real frame sampling instead of falling back to
      // poster-only when `file` is missing.
      remoteUrl: item.file_url ?? undefined,
      annotation,
    };
    return ref;
  }

  if (item.kind === "image" || item.kind === "webp" || item.kind === "gif") {
    if (!item.file_url) throw new Error("Image reference is missing a file URL.");
    const image = await urlToBase64(item.file_url);
    const ref: RefImageItem = {
      kind: "image",
      id: `library_${item.id}`,
      addedAt,
      base64: image.base64,
      mediaType: image.mediaType,
      preview: item.file_url,
      annotation,
    };
    return ref;
  }

  throw new Error(`Reference kind "${item.kind}" cannot be converted to a Brief RefItem.`);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Promote to Asset
 *
 * 라이브러리의 image/gif 자료를 프로젝트 asset(캐릭터/배경/아이템)으로 승격.
 * - 새 asset 행을 생성하면서 `photo_url` 은 원본 file_url 그대로 참조
 *   (별도 파일 복제 없음 — 같은 storage URL 을 가리킨다).
 * - reference 본체는 절대 삭제하지 않고, `promoted_asset_ids` 메타에
 *   생성된 asset id 만 추가한다 ("이 자료에서 만든 자산이 있다" 표시).
 * - asset 측에는 `source_reference_id` 를 남겨 역참조 가능.
 *
 * video / youtube / link 는 정적 asset 으로 적합하지 않으므로 호출부에서
 * disable 한다 (UI 가드). 함수 자체도 안전하게 throw 한다.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export type PromoteAssetType = "character" | "item" | "background";

export interface PromoteToAssetInput {
  reference: ReferenceItem;
  projectId: string;
  assetType: PromoteAssetType;
  /** asset 의 `tag_name`. 사용자가 비워두면 reference.title 에서 파생. */
  tagName?: string;
  /** 선택. asset 의 `space_description` (background) 또는 `outfit_description` 등.
   *  지금은 단일 문자열을 받고 호출부가 적절한 컬럼으로 분기. */
  description?: string;
}

export async function promoteReferenceToAsset(input: PromoteToAssetInput): Promise<{ assetId: string; reference: ReferenceItem }> {
  const { reference, projectId, assetType } = input;
  if (reference.kind !== "image" && reference.kind !== "webp" && reference.kind !== "gif") {
    throw new Error("Only image / webp / gif references can be promoted to an asset right now.");
  }
  if (!reference.file_url) {
    throw new Error("This reference has no stored file to use as the asset photo.");
  }
  const tagName = (input.tagName?.trim() || reference.title.trim() || "asset").replace(/^@/, "");
  const id = makeId();
  const desc = input.description?.trim() || null;
  const record = {
    id,
    project_id: projectId,
    asset_type: assetType,
    tag_name: tagName,
    photo_url: reference.file_url,
    source_type: "library",
    source_reference_id: reference.id,
    ai_description: assetType === "character" ? null : assetType === "item" ? desc : null,
    outfit_description: null,
    role_description: null,
    signature_items: null,
    space_description: assetType === "background" ? desc : null,
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("assets").insert(record);
  if (error) throw new Error(error.message);

  const nextPromoted = [...new Set([...(reference.promoted_asset_ids ?? []), id])];
  const updated = await updateReference(reference.id, { promoted_asset_ids: nextPromoted });
  return { assetId: id, reference: updated };
}
