import type { ReferenceKind } from "./referenceLibrary";

export type PackKind = "preflowlib" | "preflowpack";
export type PackScope = "folder" | "selected" | "filtered" | "all" | "projectLinked";
export type PackImportStrategy = "skip" | "keepBoth" | "mergeMetadata";

export interface PackManifest {
  version: 1;
  kind: PackKind;
  created_at: string;
  app_version: string;
  library_id: string;
  item_count: number;
  total_size_bytes: number;
  include_files: boolean;
  scope: PackScope;
  scope_label?: string | null;
  project?: { id: string; name?: string | null } | null;
}

export interface PackPreview {
  manifest: PackManifest;
  tempPath: string;
  item_count: number;
  kind_distribution: Partial<Record<ReferenceKind, number>>;
  total_size_bytes: number;
  duplicates: Array<{
    source_id: string;
    existing_reference_id: string;
    title: string;
    content_hash?: string | null;
  }>;
  missing_files: string[];
}

export interface PackImportResult {
  inserted: number;
  skipped: number;
  merged: number;
  copied_files: number;
  missing_files: string[];
}

export interface PackExportResult {
  canceled?: boolean;
  saved_path?: string;
  item_count: number;
  total_size_bytes: number;
  skipped: string[];
}

export function validateManifest(value: unknown): asserts value is PackManifest {
  const manifest = value as Partial<PackManifest> | null;
  if (!manifest || typeof manifest !== "object") throw new Error("Invalid pack manifest.");
  if (manifest.version !== 1) throw new Error("Unsupported pack version.");
  if (manifest.kind !== "preflowlib" && manifest.kind !== "preflowpack") {
    throw new Error("Invalid pack kind.");
  }
  if (!["folder", "selected", "filtered", "all", "projectLinked"].includes(String(manifest.scope))) {
    throw new Error("Invalid pack scope.");
  }
}
