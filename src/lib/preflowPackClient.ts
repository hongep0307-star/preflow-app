import { LOCAL_SERVER_AUTH_HEADERS, LOCAL_SERVER_BASE_URL } from "@shared/constants";
import type {
  PackExportResult,
  PackImportResult,
  PackImportStrategy,
  PackPreview,
  PackScope,
} from "./preflowPack";

async function packPost<T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
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

export function exportPack(opts: {
  scope: PackScope;
  ids?: string[];
  folderTag?: string;
  projectId?: string | null;
  includeFiles: boolean;
  includeSubfolders?: boolean;
  suggestedName?: string;
}): Promise<PackExportResult> {
  return packPost<PackExportResult>("/pack/export", opts);
}

export function previewPack(): Promise<PackPreview & { canceled?: boolean }> {
  return packPost<PackPreview & { canceled?: boolean }>("/pack/preview");
}

export function applyPack(opts: {
  tempPath: string;
  strategy: PackImportStrategy;
  mountProjectId?: string | null;
}): Promise<PackImportResult> {
  return packPost<PackImportResult>("/pack/import", opts);
}
