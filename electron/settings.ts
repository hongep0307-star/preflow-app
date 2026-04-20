import { ipcMain } from "electron";
import { getDb, saveDb } from "./db";

export interface AppSettings {
  anthropic_api_key?: string;
  openai_api_key?: string;
  google_service_account_key?: string;
  google_cloud_project_id?: string;
}

export function getSettings(): AppSettings {
  const db = getDb();
  const stmt = db.prepare("SELECT key, value FROM settings");
  const settings: any = {};
  while (stmt.step()) {
    const row = stmt.getAsObject() as { key: string; value: string };
    settings[row.key] = row.value;
  }
  stmt.free();
  return settings;
}

export function setSettings(settings: Partial<AppSettings>) {
  const db = getDb();
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined) continue;
    const stmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
    stmt.run([key, value]);
    stmt.free();
  }
  saveDb();
}

export function registerSettingsHandlers() {
  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:set", (_e, settings: Partial<AppSettings>) => {
    setSettings(settings);
    return getSettings();
  });
}
