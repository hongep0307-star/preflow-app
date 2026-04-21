import { getDb } from "./db";

export interface AppSettings {
  anthropic_api_key?: string;
  openai_api_key?: string;
  google_service_account_key?: string;
  google_cloud_project_id?: string;
}

export function getSettings(): AppSettings {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const settings: any = {};
  for (const row of rows) settings[row.key] = row.value;
  return settings;
}

export function setSettings(settings: Partial<AppSettings>) {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  );
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined) continue;
    stmt.run(key, value);
  }
}
