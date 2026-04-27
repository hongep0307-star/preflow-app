import { getDb } from "./db";

export interface AppSettings {
  anthropic_api_key?: string;
  openai_api_key?: string;
  google_service_account_key?: string;
  google_cloud_project_id?: string;
  /**
   * "true" / "false" — GPT-5.5 API 가 출시된 직후 사용자가 즉시 활성화할 수
   * 있도록 한 플래그. 시드 카탈로그의 `released: false` 모델을 강제 활성화한다.
   * 5.5 가 GA 되면 카탈로그 시드 자체에서 released 를 true 로 올려 이 플래그를
   * 사실상 deprecate.
   */
  gpt_5_5_api_enabled?: string;
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
