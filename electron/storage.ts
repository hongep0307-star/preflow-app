import { ipcMain, app } from "electron";
import path from "path";
import fs from "fs";

let storageBase = "";

export function getStorageBasePath() {
  if (!storageBase) {
    storageBase = path.join(app.getPath("userData"), "storage");
    fs.mkdirSync(storageBase, { recursive: true });
  }
  return storageBase;
}

export function registerStorageHandlers() {
  // Upload file
  ipcMain.handle("storage:upload", async (_e, bucket: string, filePath: string, data: ArrayBuffer, _contentType?: string) => {
    const base = getStorageBasePath();
    const fullPath = path.join(base, bucket, filePath);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, Buffer.from(data));
    return { error: null };
  });

  // Get "public URL" — returns local-file:// protocol URL
  ipcMain.handle("storage:getPublicUrl", (_e, bucket: string, filePath: string) => {
    const base = getStorageBasePath();
    const fullPath = path.join(base, bucket, filePath);
    const url = `local-file://${fullPath.replace(/\\/g, "/")}`;
    return { data: { publicUrl: url } };
  });

  // Remove files
  ipcMain.handle("storage:remove", async (_e, bucket: string, filePaths: string[]) => {
    const base = getStorageBasePath();
    for (const fp of filePaths) {
      const fullPath = path.join(base, bucket, fp);
      try { fs.unlinkSync(fullPath); } catch { /* ignore missing files */ }
    }
    return { error: null };
  });

  // List files in folder
  ipcMain.handle("storage:list", async (_e, bucket: string, folder: string, options?: any) => {
    const base = getStorageBasePath();
    const dirPath = path.join(base, bucket, folder);
    try {
      const files = fs.readdirSync(dirPath);
      const limit = options?.limit ?? 1000;
      const offset = options?.offset ?? 0;
      const sliced = files.slice(offset, offset + limit);
      return {
        data: sliced.map(name => ({ name })),
        error: null,
      };
    } catch {
      return { data: [], error: null };
    }
  });
}
