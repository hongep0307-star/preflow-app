import { LOCAL_SERVER_AUTH_HEADERS, LOCAL_SERVER_BASE_URL } from "@shared/constants";

export interface StorageUsage {
  total_bytes: number;
  by_bucket: Record<string, number>;
  file_count: number;
}

export interface OrphanCleanupPreview {
  total_files: number;
  orphan_files: number;
  bytes_reclaimable: number;
  skipped_recent: number;
  sample: Array<{ key: string; size: number; mtimeMs: number }>;
}

export interface OrphanCleanupResult {
  filesDeleted: number;
  bytesFreed: number;
  skippedRecent: number;
  durationMs: number;
}

async function maintenancePost<T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
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

export function getStorageUsage(): Promise<StorageUsage> {
  return maintenancePost<StorageUsage>("/storage/usage");
}

export function previewOrphanCleanup(): Promise<OrphanCleanupPreview> {
  return maintenancePost<OrphanCleanupPreview>("/storage/orphans/preview", { includeReferences: true });
}

export function runOrphanCleanup(): Promise<OrphanCleanupResult> {
  return maintenancePost<OrphanCleanupResult>("/storage/orphans/cleanup", { includeReferences: true });
}
