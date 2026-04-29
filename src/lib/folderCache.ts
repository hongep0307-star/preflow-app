const USER_FOLDERS_KEY = "preflow.library.userFolders";

function normalizeFolderPath(path: string): string {
  return path
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

function readPaths(): string[] {
  try {
    const raw = localStorage.getItem(USER_FOLDERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((value) => normalizeFolderPath(String(value))).filter(Boolean))].sort();
  } catch {
    return [];
  }
}

function writePaths(paths: string[]): void {
  const next = [...new Set(paths.map(normalizeFolderPath).filter(Boolean))].sort();
  localStorage.setItem(USER_FOLDERS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("preflow-library-folders-changed"));
}

export function getUserFolderPaths(): string[] {
  return readPaths();
}

export function addUserFolderPath(path: string): void {
  const normalized = normalizeFolderPath(path);
  if (!normalized) return;
  writePaths([...readPaths(), normalized]);
}

export function removeUserFolderPath(path: string): void {
  const normalized = normalizeFolderPath(path);
  writePaths(readPaths().filter((existing) => existing !== normalized && !existing.startsWith(`${normalized}/`)));
}

export function renameUserFolderPath(oldPath: string, newPath: string): void {
  const oldNormalized = normalizeFolderPath(oldPath);
  const newNormalized = normalizeFolderPath(newPath);
  if (!oldNormalized || !newNormalized) return;
  writePaths(readPaths().map((existing) => {
    if (existing === oldNormalized) return newNormalized;
    if (existing.startsWith(`${oldNormalized}/`)) {
      return `${newNormalized}/${existing.slice(oldNormalized.length + 1)}`;
    }
    return existing;
  }));
}

export function normalizeLibraryFolderPath(path: string): string {
  return normalizeFolderPath(path);
}
