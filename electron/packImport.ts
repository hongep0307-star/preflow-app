import { app, dialog } from "electron";
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import { getStorageBasePath } from "./paths";
import { getLocalServerBaseUrl } from "./constants";
import { dbInsert, dbUpdate, deserializeRow, generateId, runQuery } from "./db-utils";

type PackImportStrategy = "skip" | "keepBoth" | "mergeMetadata";

interface PackReferenceRow {
  id: string;
  kind: string;
  title: string;
  file_relpath?: string | null;
  thumbnail_relpath?: string | null;
  tags?: string[] | string | null;
  notes?: string | null;
  color_palette?: unknown;
  timestamp_notes?: unknown;
  content_hash?: string | null;
  [key: string]: unknown;
}

interface PackManifest {
  version: 1;
  kind: "preflowlib" | "preflowpack";
  library_id?: string | null;
  total_size_bytes?: number | null;
  project?: { name?: string | null } | null;
}

interface ProjectLinkRow {
  reference_source_id?: string | null;
  reference_id?: string | null;
  target?: string | null;
  annotation?: string | null;
  time_range?: unknown;
}

type ExistingReference = Record<string, unknown> & {
  id: string;
  title?: string;
  content_hash?: string | null;
  tags?: unknown;
  notes?: string | null;
  color_palette?: unknown;
  timestamp_notes?: unknown;
};

const REFERENCE_COLUMNS = new Set([
  "kind", "title", "file_url", "thumbnail_url", "mime_type", "file_size",
  "content_hash", "duration_sec", "width", "height", "tags", "notes", "rating",
  "is_favorite", "source_url", "cover_at_sec", "timestamp_notes", "color_palette",
  "ai_suggestions", "classification_status", "classified_at", "origin_project_id",
  "source_app", "source_library", "source_id", "imported_at", "pinned_at",
  "deleted_at", "last_used_at",
]);

function parseJson<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sanitizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "reference";
}

function packTempPath(): string {
  return path.join(app.getPath("userData"), "tmp", `pack-${generateId()}.zip`);
}

function assertTempPath(tempPath: string): string {
  const tmpRoot = path.resolve(app.getPath("userData"), "tmp");
  const resolved = path.resolve(tempPath);
  const rel = path.relative(tmpRoot, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel) || !resolved.endsWith(".zip")) {
    throw new Error("Invalid pack temp path.");
  }
  return resolved;
}

function existingBySource(sourceLibrary: string, sourceId: string): ExistingReference | null {
  const row = runQuery(
    `SELECT * FROM reference_items
     WHERE source_app = ? AND source_library = ? AND source_id = ?
     ORDER BY created_at ASC LIMIT 1`,
    ["preflow-pack", sourceLibrary, sourceId],
  )[0];
  return row ? deserializeRow(row) as ExistingReference : null;
}

async function readPack(tempPath: string) {
  const buffer = await fs.promises.readFile(tempPath);
  const zip = await JSZip.loadAsync(buffer);
  const manifest = parseJson<PackManifest | null>(await zip.file("manifest.json")?.async("string"), null);
  const references = parseJson<PackReferenceRow[]>(await zip.file("references.json")?.async("string"), []);
  const projectLinks = parseJson<{ links: ProjectLinkRow[] }>(await zip.file("project_links.json")?.async("string"), { links: [] });
  if (!manifest || manifest.version !== 1 || (manifest.kind !== "preflowlib" && manifest.kind !== "preflowpack")) {
    throw new Error("Invalid Pre-Flow pack.");
  }
  return { zip, manifest, references, projectLinks };
}

export async function previewPackFromDisk() {
  const picked = await dialog.showOpenDialog({
    title: "Import Pre-Flow Reference Pack",
    properties: ["openFile"],
    filters: [{ name: "Pre-Flow Packs", extensions: ["preflowlib", "preflowpack"] }],
  });
  if (picked.canceled || picked.filePaths.length === 0) {
    return { canceled: true };
  }
  const tempPath = packTempPath();
  await fs.promises.mkdir(path.dirname(tempPath), { recursive: true });
  await fs.promises.copyFile(picked.filePaths[0], tempPath);
  const { zip, manifest, references } = await readPack(tempPath);
  const sourceLibrary = manifest.library_id || "main";
  const duplicates = references.flatMap((ref) => {
    const existing = existingBySource(sourceLibrary, ref.id);
    return existing ? [{
      source_id: ref.id,
      existing_reference_id: existing.id,
      title: existing.title,
      content_hash: existing.content_hash ?? null,
    }] : [];
  });
  const kindDistribution: Record<string, number> = {};
  const missingFiles: string[] = [];
  for (const ref of references) {
    kindDistribution[ref.kind] = (kindDistribution[ref.kind] ?? 0) + 1;
    for (const rel of [ref.file_relpath, ref.thumbnail_relpath]) {
      if (rel && !zip.file(rel)) missingFiles.push(rel);
    }
  }
  return {
    tempPath,
    manifest,
    item_count: references.length,
    kind_distribution: kindDistribution,
    total_size_bytes: manifest.total_size_bytes ?? 0,
    duplicates,
    missing_files: missingFiles,
  };
}

async function copyZipEntry(zip: JSZip, relPath: string | null | undefined, referenceId: string): Promise<string | null> {
  if (!relPath) return null;
  const entry = zip.file(relPath);
  if (!entry) return null;
  const ext = path.extname(relPath) || ".bin";
  const relative = `${new Date().toISOString().slice(0, 7)}/${referenceId}/${sanitizeName(path.basename(relPath, ext))}${ext}`;
  const target = path.join(getStorageBasePath(), "references", relative);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, await entry.async("nodebuffer"));
  return `${getLocalServerBaseUrl()}/storage/file/references/${relative.replace(/\\/g, "/")}`;
}

function importRow(ref: PackReferenceRow, sourceLibrary: string, id: string, urls: { fileUrl: string | null; thumbnailUrl: string | null }) {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ref)) {
    if (REFERENCE_COLUMNS.has(key)) row[key] = value;
  }
  row.id = id;
  row.file_url = urls.fileUrl ?? null;
  row.thumbnail_url = urls.thumbnailUrl ?? urls.fileUrl ?? null;
  row.source_app = "preflow-pack";
  row.source_library = sourceLibrary;
  row.source_id = ref.id;
  row.imported_at = new Date().toISOString();
  row.created_at = new Date().toISOString();
  row.updated_at = new Date().toISOString();
  delete row.promoted_asset_ids;
  return row;
}

function mergeMetadata(existing: ExistingReference, ref: PackReferenceRow) {
  const tags = [...new Set([...normalizeArray(existing.tags).map(String), ...normalizeArray(ref.tags).map(String)])];
  const notes = [existing.notes, ref.notes].filter((value) => typeof value === "string" && value.trim()).join("\n\n");
  dbUpdate("reference_items", {
    tags,
    notes: notes || null,
    color_palette: normalizeArray(existing.color_palette).length ? existing.color_palette : normalizeArray(ref.color_palette),
    timestamp_notes: [...normalizeArray(existing.timestamp_notes), ...normalizeArray(ref.timestamp_notes)],
    updated_at: new Date().toISOString(),
  }, { id: existing.id });
}

function ensureImportedProject(manifest: PackManifest, mountProjectId?: string | null): string | null {
  if (mountProjectId) return mountProjectId;
  if (manifest.kind !== "preflowpack") return null;
  const id = generateId();
  dbInsert("projects", {
    id,
    user_id: "local",
    title: manifest.project?.name ? `${manifest.project.name} (Imported)` : "Imported Reference Pack",
    status: "draft",
    created_at: new Date().toISOString(),
  });
  return id;
}

export async function applyPack(input: { tempPath: string; strategy: PackImportStrategy; mountProjectId?: string | null }) {
  const tempPath = assertTempPath(input.tempPath);
  const { zip, manifest, references, projectLinks } = await readPack(tempPath);
  const sourceLibrary = manifest.library_id || "main";
  const sourceToNewId = new Map<string, string>();
  const missingFiles: string[] = [];
  let inserted = 0;
  let skipped = 0;
  let merged = 0;
  let copiedFiles = 0;

  for (const ref of references) {
    const existing = existingBySource(sourceLibrary, ref.id);
    if (existing && input.strategy === "skip") {
      sourceToNewId.set(ref.id, existing.id);
      skipped += 1;
      continue;
    }
    if (existing && input.strategy === "mergeMetadata") {
      mergeMetadata(existing, ref);
      sourceToNewId.set(ref.id, existing.id);
      merged += 1;
      continue;
    }
    const nextId = generateId();
    const fileUrl = await copyZipEntry(zip, ref.file_relpath, nextId);
    const thumbnailUrl = await copyZipEntry(zip, ref.thumbnail_relpath, nextId);
    if (ref.file_relpath && !fileUrl) missingFiles.push(ref.file_relpath);
    if (ref.thumbnail_relpath && !thumbnailUrl) missingFiles.push(ref.thumbnail_relpath);
    if (fileUrl) copiedFiles += 1;
    if (thumbnailUrl && thumbnailUrl !== fileUrl) copiedFiles += 1;
    dbInsert("reference_items", importRow(ref, sourceLibrary, nextId, { fileUrl, thumbnailUrl }));
    sourceToNewId.set(ref.id, nextId);
    inserted += 1;
  }

  const projectId = ensureImportedProject(manifest, input.mountProjectId);
  if (projectId) {
    for (const link of projectLinks.links ?? []) {
      const sourceId = String(link.reference_source_id ?? link.reference_id ?? "");
      const referenceId = sourceToNewId.get(sourceId);
      if (!referenceId) continue;
      dbInsert("project_reference_links", {
        id: generateId(),
        project_id: projectId,
        reference_id: referenceId,
        target: link.target ?? "brief",
        annotation: link.annotation ?? null,
        time_range: link.time_range ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }

  try {
    await fs.promises.unlink(tempPath);
  } catch {
    /* best effort */
  }
  return { inserted, skipped, merged, copied_files: copiedFiles, missing_files: missingFiles };
}
