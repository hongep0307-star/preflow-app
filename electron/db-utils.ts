import crypto from "crypto";
import { getDb } from "./db";

// ── Schema whitelist ──────────────────────────────────────────────
// The local server runs on 127.0.0.1 and is only consumed by the renderer,
// but the renderer hosts external content (markdown, AI output, user uploads).
// We treat the renderer as semi-trusted and require every (table, column)
// pair to be on an explicit allow-list before it ever reaches a SQL string.
// This blocks:
//   - SQL identifier injection via crafted table/column names
//   - Reading/writing tables that the UI was never supposed to touch (e.g.
//     someone trying to dump `settings` rows containing API keys)
const TABLE_COLUMNS: Record<string, ReadonlySet<string>> = {
  projects: new Set([
    "id", "user_id", "title", "client", "deadline", "status", "video_format",
    "active_version_id", "folder_id", "conti_style_id", "thumbnail_url",
    "thumbnail_crop", "created_at",
  ]),
  briefs: new Set([
    "id", "project_id", "raw_text", "analysis", "analysis_en", "mood_image_urls",
    "mood_bookmarks", "lang", "source_type", "image_urls", "created_at",
  ]),
  scenes: new Set([
    "id", "project_id", "scene_number", "title", "description", "camera_angle",
    "location", "mood", "duration_sec", "tagged_assets", "conti_image_url",
    "conti_image_history", "source", "conti_image_crop", "is_transition",
    "transition_type", "created_at",
  ]),
  assets: new Set([
    "id", "project_id", "asset_type", "tag_name", "photo_url", "ai_description",
    "outfit_description", "role_description", "space_description",
    "signature_items", "photo_crop", "source_type", "created_at",
  ]),
  scene_versions: new Set([
    "id", "project_id", "version_number", "version_name", "scenes",
    "display_order", "is_active", "created_at",
  ]),
  style_presets: new Set([
    "id", "user_id", "name", "description", "reference_image_urls",
    "style_prompt", "thumbnail_url", "is_default", "created_at",
  ]),
  chat_logs: new Set(["id", "project_id", "role", "content", "created_at"]),
  folders: new Set(["id", "user_id", "name", "created_at"]),
};

function assertTable(table: string): asserts table is keyof typeof TABLE_COLUMNS {
  if (!Object.prototype.hasOwnProperty.call(TABLE_COLUMNS, table)) {
    throw new Error(`Disallowed table: ${table}`);
  }
}

function assertColumns(table: string, cols: Iterable<string>) {
  const allowed = TABLE_COLUMNS[table];
  for (const c of cols) {
    if (!allowed.has(c)) {
      throw new Error(`Disallowed column "${c}" on table "${table}"`);
    }
  }
}

// 단일 진실원: JSON으로 직렬화/역직렬화해야 하는 컬럼 목록.
// (이전에는 db-handlers.ts와 local-server.ts에 각각 정의되어 thumbnail_crop이 한쪽에만 있었음.)
export const JSON_COLUMNS = new Set<string>([
  "analysis",
  "analysis_en",
  "mood_image_urls",
  "mood_bookmarks",
  "image_urls",
  "tagged_assets",
  "conti_image_history",
  "conti_image_crop",
  "photo_crop",
  "scenes",
  "reference_image_urls",
  "thumbnail_crop",
]);

const BOOLEAN_COLUMNS = new Set<string>(["is_transition", "is_active", "is_default"]);

export function serializeValue(key: string, value: unknown): unknown {
  if (
    JSON_COLUMNS.has(key) &&
    value !== null &&
    value !== undefined &&
    typeof value !== "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  // better-sqlite3는 undefined 바인딩을 거부하므로 null로 강제.
  if (typeof value === "undefined") return null;
  return value;
}

export function deserializeRow<T extends Record<string, any> = Record<string, any>>(
  row: T | null | undefined,
): T | null | undefined {
  if (!row) return row;
  const result: Record<string, any> = { ...row };
  for (const key of Object.keys(result)) {
    if (JSON_COLUMNS.has(key) && typeof result[key] === "string") {
      try {
        result[key] = JSON.parse(result[key]);
      } catch {
        /* keep as string */
      }
    }
    if (BOOLEAN_COLUMNS.has(key)) {
      result[key] = !!result[key];
    }
  }
  return result as T;
}

export function generateId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function runQuery(sql: string, params: any[] = []): Record<string, any>[] {
  return getDb().prepare(sql).all(...params) as Record<string, any>[];
}

export function runExec(
  sql: string,
  params: any[] = [],
): { changes: number; lastInsertRowid: number | bigint } {
  const info = getDb().prepare(sql).run(...params);
  return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
}

// ── 고수준 CRUD ──
export interface SelectOptions {
  orderBy?: string;
  ascending?: boolean;
  limit?: number;
}

export function dbSelect(
  table: string,
  where?: Record<string, any>,
  options?: SelectOptions,
): Record<string, any>[] {
  assertTable(table);
  if (where) assertColumns(table, Object.keys(where));
  if (options?.orderBy) assertColumns(table, [options.orderBy]);

  let sql = `SELECT * FROM "${table}"`;
  const params: any[] = [];

  if (where && Object.keys(where).length > 0) {
    const clauses = Object.entries(where).map(([k, v]) => {
      params.push(v);
      return `"${k}" = ?`;
    });
    sql += ` WHERE ${clauses.join(" AND ")}`;
  }

  if (options?.orderBy) {
    const dir = options.ascending === false ? "DESC" : "ASC";
    sql += ` ORDER BY "${options.orderBy}" ${dir}`;
  }
  if (options?.limit) {
    const lim = Math.min(Math.max(0, Math.floor(Number(options.limit))), 10_000);
    sql += ` LIMIT ${lim}`;
  }

  return runQuery(sql, params).map((r) => deserializeRow(r)!);
}

export function dbInsert(table: string, data: Record<string, any>): Record<string, any> {
  assertTable(table);
  const row = { ...data };
  if (!row.id) row.id = generateId();
  if (!row.created_at) row.created_at = new Date().toISOString();
  const keys = Object.keys(row);
  assertColumns(table, keys);
  const values = keys.map((k) => serializeValue(k, row[k]));
  const placeholders = keys.map(() => "?").join(", ");
  runExec(
    `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${placeholders})`,
    values,
  );
  const rows = runQuery(`SELECT * FROM "${table}" WHERE id = ?`, [row.id]);
  return rows.length > 0 ? deserializeRow(rows[0])! : row;
}

export function dbUpdate(
  table: string,
  data: Record<string, any>,
  where: Record<string, any>,
): Record<string, any>[] {
  assertTable(table);
  assertColumns(table, Object.keys(data));
  assertColumns(table, Object.keys(where));
  const setClauses = Object.keys(data).map((k) => `"${k}" = ?`);
  const setValues = Object.keys(data).map((k) => serializeValue(k, data[k]));
  const whereClauses = Object.keys(where).map((k) => `"${k}" = ?`);
  const whereValues = Object.values(where);

  runExec(
    `UPDATE "${table}" SET ${setClauses.join(", ")} WHERE ${whereClauses.join(" AND ")}`,
    [...setValues, ...whereValues],
  );

  return runQuery(
    `SELECT * FROM "${table}" WHERE ${whereClauses.join(" AND ")}`,
    whereValues,
  ).map((r) => deserializeRow(r)!);
}

export function dbDelete(table: string, where: Record<string, any>): { changes: number } {
  assertTable(table);
  assertColumns(table, Object.keys(where));
  if (Object.keys(where).length === 0) {
    // Refuse mass deletes: every UI delete should target at least one column.
    throw new Error(`Refusing DELETE on "${table}" without a WHERE clause`);
  }
  const clauses = Object.keys(where).map((k) => `"${k}" = ?`);
  const values = Object.values(where);
  const info = runExec(`DELETE FROM "${table}" WHERE ${clauses.join(" AND ")}`, values);
  return { changes: info.changes };
}

export function dbUpsert(
  table: string,
  data: Record<string, any>,
  conflictKeys: string[],
): Record<string, any> {
  assertTable(table);
  const row = { ...data };
  if (!row.id) row.id = generateId();
  if (!row.created_at) row.created_at = new Date().toISOString();
  const keys = Object.keys(row);
  assertColumns(table, keys);
  assertColumns(table, conflictKeys);
  const values = keys.map((k) => serializeValue(k, row[k]));
  const placeholders = keys.map(() => "?").join(", ");
  const updateClauses = keys
    .filter((k) => !conflictKeys.includes(k))
    .map((k) => `"${k}" = excluded."${k}"`);

  runExec(
    `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${placeholders})
     ON CONFLICT (${conflictKeys.map((k) => `"${k}"`).join(", ")}) DO UPDATE SET ${updateClauses.join(", ")}`,
    values,
  );

  const rows = runQuery(`SELECT * FROM "${table}" WHERE id = ?`, [row.id]);
  return rows.length > 0 ? deserializeRow(rows[0])! : row;
}
