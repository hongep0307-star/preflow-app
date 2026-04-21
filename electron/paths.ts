import { app } from "electron";
import path from "path";
import fs from "fs";

let storageBase = "";

export function getStorageBasePath(): string {
  if (!storageBase) {
    storageBase = path.join(app.getPath("userData"), "storage");
    fs.mkdirSync(storageBase, { recursive: true });
  }
  return storageBase;
}
