import { LOCAL_SERVER_AUTH_HEADERS, LOCAL_SERVER_BASE_URL } from "@shared/constants";

export interface EaglePreview {
  rootPath: string;
  libraryName: string;
  totalItems: number;
  totalBytes: number;
  kinds: Record<string, number>;
  folders: number;
  smartFolders: number;
  tags: number;
  duplicateCandidates: number;
  missingFiles: Array<{ id: string; name: string; reason: string }>;
}

export interface EagleImportResult extends EaglePreview {
  imported: number;
  skipped: number;
  metadataOnly: number;
  failed: Array<{ id: string; name: string; reason: string }>;
}

export interface EagleSelectResult {
  canceled: boolean;
  rootPath: string | null;
  preview: EaglePreview | null;
}

async function localPost<T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
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

export function selectEagleLibrary(): Promise<EagleSelectResult> {
  return localPost<EagleSelectResult>("/eagle/select-library");
}

export function previewEagleLibrary(rootPath: string): Promise<EaglePreview> {
  return localPost<EaglePreview>("/eagle/preview", { rootPath });
}

export function importEagleLibrary(rootPath: string): Promise<EagleImportResult> {
  return localPost<EagleImportResult>("/eagle/import", { rootPath });
}
