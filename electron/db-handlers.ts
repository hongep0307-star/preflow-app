import { ipcMain } from "electron";
import { getDb } from "./db";
import crypto from "crypto";

const JSON_COLUMNS = new Set([
  "analysis", "analysis_en", "mood_image_urls", "mood_bookmarks",
  "image_urls", "tagged_assets", "conti_image_history", "conti_image_crop",
  "photo_crop", "scenes", "reference_image_urls",
]);

function serializeValue(key: string, value: any): any {
  if (JSON_COLUMNS.has(key) && value !== null && value !== undefined && typeof value !== "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  // better-sqlite3 rejects `undefined`; coerce to null.
  if (typeof value === "undefined") return null;
  return value;
}

function deserializeRow(row: Record<string, any>): any {
  if (!row) return row;
  const result = { ...row };
  for (const key of Object.keys(result)) {
    if (JSON_COLUMNS.has(key) && typeof result[key] === "string") {
      try { result[key] = JSON.parse(result[key]); } catch { /* keep as string */ }
    }
    if (key === "is_transition" || key === "is_active" || key === "is_default") {
      result[key] = !!result[key];
    }
  }
  return result;
}

function generateId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function runQuery(sql: string, params: any[] = []): Record<string, any>[] {
  const db = getDb();
  const stmt = db.prepare(sql);
  return stmt.all(...params) as Record<string, any>[];
}

function runExec(sql: string, params: any[] = []): { changes: number; lastInsertRowid: number | bigint } {
  const db = getDb();
  const stmt = db.prepare(sql);
  const info = stmt.run(...params);
  return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
}

export function registerDbHandlers() {
  ipcMain.handle("db:run", (_e, sql: string, params?: any[]) => {
    const info = runExec(sql, params ?? []);
    return { changes: info.changes };
  });

  ipcMain.handle("db:get", (_e, sql: string, params?: any[]) => {
    const rows = runQuery(sql, params ?? []);
    return rows.length > 0 ? deserializeRow(rows[0]) : null;
  });

  ipcMain.handle("db:all", (_e, sql: string, params?: any[]) => {
    return runQuery(sql, params ?? []).map(deserializeRow);
  });

  // High-level SELECT
  ipcMain.handle("db:select", (_e, table: string, where?: Record<string, any>, options?: any) => {
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
      sql += ` LIMIT ${options.limit}`;
    }

    return runQuery(sql, params).map(deserializeRow);
  });

  // High-level INSERT
  ipcMain.handle("db:insert", (_e, table: string, data: Record<string, any>) => {
    if (!data.id) data.id = generateId();
    if (!data.created_at) data.created_at = new Date().toISOString();
    const keys = Object.keys(data);
    const values = keys.map(k => serializeValue(k, data[k]));
    const placeholders = keys.map(() => "?").join(", ");
    const sql = `INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(", ")}) VALUES (${placeholders})`;
    runExec(sql, values);

    // Return inserted row
    const rows = runQuery(`SELECT * FROM "${table}" WHERE id = ?`, [data.id]);
    return rows.length > 0 ? deserializeRow(rows[0]) : data;
  });

  // High-level UPDATE
  ipcMain.handle("db:update", (_e, table: string, data: Record<string, any>, where: Record<string, any>) => {
    const setClauses = Object.keys(data).map(k => `"${k}" = ?`);
    const setValues = Object.keys(data).map(k => serializeValue(k, data[k]));
    const whereClauses = Object.keys(where).map(k => `"${k}" = ?`);
    const whereValues = Object.values(where);

    const sql = `UPDATE "${table}" SET ${setClauses.join(", ")} WHERE ${whereClauses.join(" AND ")}`;
    runExec(sql, [...setValues, ...whereValues]);

    const selectSql = `SELECT * FROM "${table}" WHERE ${whereClauses.join(" AND ")}`;
    return runQuery(selectSql, whereValues).map(deserializeRow);
  });

  // High-level DELETE
  ipcMain.handle("db:delete", (_e, table: string, where: Record<string, any>) => {
    const clauses = Object.keys(where).map(k => `"${k}" = ?`);
    const values = Object.values(where);
    const sql = `DELETE FROM "${table}" WHERE ${clauses.join(" AND ")}`;
    const info = runExec(sql, values);
    return { changes: info.changes };
  });

  // High-level UPSERT
  ipcMain.handle("db:upsert", (_e, table: string, data: Record<string, any>, conflictKeys: string[]) => {
    if (!data.id) data.id = generateId();
    if (!data.created_at) data.created_at = new Date().toISOString();
    const keys = Object.keys(data);
    const values = keys.map(k => serializeValue(k, data[k]));
    const placeholders = keys.map(() => "?").join(", ");
    const updateClauses = keys
      .filter(k => !conflictKeys.includes(k))
      .map(k => `"${k}" = excluded."${k}"`);

    const sql = `INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(", ")}) VALUES (${placeholders})
      ON CONFLICT (${conflictKeys.map(k => `"${k}"`).join(", ")}) DO UPDATE SET ${updateClauses.join(", ")}`;
    runExec(sql, values);

    const rows = runQuery(`SELECT * FROM "${table}" WHERE id = ?`, [data.id]);
    return rows.length > 0 ? deserializeRow(rows[0]) : data;
  });
}
