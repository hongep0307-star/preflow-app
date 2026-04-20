import http from "http";
import { getDb } from "./db";
import { getSettings, setSettings } from "./settings";
import { getStorageBasePath } from "./storage";
import { handleClaudeProxy, handleEnhanceInpaintPrompt, handleTranslateAnalysis, handleAnalyzeReferenceImages, handleOpenaiImage } from "./api-handlers";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const JSON_COLUMNS = new Set([
  "analysis", "analysis_en", "mood_image_urls", "mood_bookmarks", "image_urls",
  "tagged_assets", "conti_image_history", "conti_image_crop", "photo_crop",
  "scenes", "reference_image_urls", "thumbnail_crop",
]);

function serializeValue(key: string, value: any) {
  if (JSON_COLUMNS.has(key) && value !== null && value !== undefined && typeof value !== "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

function deserializeRow(row: any) {
  if (!row) return row;
  const result = { ...row };
  for (const key of Object.keys(result)) {
    if (JSON_COLUMNS.has(key) && typeof result[key] === "string") {
      try { result[key] = JSON.parse(result[key]); } catch {}
    }
    if (key === "is_transition" || key === "is_active" || key === "is_default") {
      result[key] = !!result[key];
    }
  }
  return result;
}

function generateId() {
  return crypto.randomUUID().replace(/-/g, "");
}

function runQuery(sql: string, params: any[] = []) {
  const db = getDb();
  return db.prepare(sql).all(...params) as any[];
}

function runExec(sql: string, params: any[] = []) {
  const db = getDb();
  db.prepare(sql).run(...params);
}

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve({}); }
    });
    req.on("error", reject);
  });
}

import { LOCAL_SERVER_PORT } from "./constants";
export { LOCAL_SERVER_PORT };

export function startLocalServer(): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

      const url = req.url || "";

      if (req.method === "GET" && url.startsWith("/storage/file/")) {
        // ?t=cacheBuster 같은 쿼리스트링이 붙어 들어와도 파일 lookup이 깨지지 않도록 strip
        const rawRelative = url.slice("/storage/file/".length).split(/[?#]/)[0];
        const relative = decodeURIComponent(rawRelative);
        const base = getStorageBasePath();
        const fullPath = path.join(base, relative);
        if (!fullPath.startsWith(base)) { res.writeHead(403); res.end(); return; }
        if (!fs.existsSync(fullPath)) {
          console.warn("[local-server] 404:", url, "→", fullPath);
          res.writeHead(404); res.end(); return;
        }
        const ext = path.extname(fullPath).toLowerCase();
        const mimeMap: Record<string, string> = {
          ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
          ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
          ".mp4": "video/mp4", ".webm": "video/webm",
        };
        res.writeHead(200, {
          "Content-Type": mimeMap[ext] || "application/octet-stream",
          "Cache-Control": "no-cache",
        });
        fs.createReadStream(fullPath).pipe(res);
        return;
      }

      if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
      try {
        const body = await parseBody(req);
        let result: any;

        if (url === "/db/select") {
          const { table, where, options } = body;
          let sql = `SELECT * FROM "${table}"`;
          const params: any[] = [];
          if (where && Object.keys(where).length > 0) {
            const clauses = Object.entries(where).map(([k, v]) => { params.push(v); return `"${k}" = ?`; });
            sql += ` WHERE ${clauses.join(" AND ")}`;
          }
          if (options?.orderBy) sql += ` ORDER BY "${options.orderBy}" ${options.ascending === false ? "DESC" : "ASC"}`;
          if (options?.limit) sql += ` LIMIT ${options.limit}`;
          result = runQuery(sql, params).map(deserializeRow);

        } else if (url === "/db/insert") {
          const { table, data } = body;
          if (!data.id) data.id = generateId();
          if (!data.created_at) data.created_at = new Date().toISOString();
          const keys = Object.keys(data);
          const values = keys.map(k => serializeValue(k, data[k]));
          const placeholders = keys.map(() => "?").join(", ");
          runExec(`INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(", ")}) VALUES (${placeholders})`, values);
          const rows = runQuery(`SELECT * FROM "${table}" WHERE id = ?`, [data.id]);
          result = rows.length > 0 ? deserializeRow(rows[0]) : data;

        } else if (url === "/db/update") {
          const { table, data, where } = body;
          const setClauses = Object.keys(data).map(k => `"${k}" = ?`);
          const setValues = Object.keys(data).map(k => serializeValue(k, data[k]));
          const whereClauses = Object.keys(where).map(k => `"${k}" = ?`);
          const whereValues = Object.values(where);
          runExec(`UPDATE "${table}" SET ${setClauses.join(", ")} WHERE ${whereClauses.join(" AND ")}`, [...setValues, ...whereValues]);
          result = runQuery(`SELECT * FROM "${table}" WHERE ${whereClauses.join(" AND ")}`, whereValues).map(deserializeRow);

        } else if (url === "/db/delete") {
          const { table, where } = body;
          const clauses = Object.keys(where).map(k => `"${k}" = ?`);
          const values = Object.values(where);
          runExec(`DELETE FROM "${table}" WHERE ${clauses.join(" AND ")}`, values);
          result = { changes: 1 };

        } else if (url === "/db/upsert") {
          const { table, data, conflictKeys } = body;
          if (!data.id) data.id = generateId();
          if (!data.created_at) data.created_at = new Date().toISOString();
          const keys = Object.keys(data);
          const values = keys.map(k => serializeValue(k, data[k]));
          const placeholders = keys.map(() => "?").join(", ");
          const updateClauses = keys.filter(k => !conflictKeys.includes(k)).map(k => `"${k}" = excluded."${k}"`);
          runExec(`INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(", ")}) VALUES (${placeholders})
            ON CONFLICT (${conflictKeys.map((k: string) => `"${k}"`).join(", ")}) DO UPDATE SET ${updateClauses.join(", ")}`, values);
          const rows = runQuery(`SELECT * FROM "${table}" WHERE id = ?`, [data.id]);
          result = rows.length > 0 ? deserializeRow(rows[0]) : data;

        } else if (url === "/storage/upload") {
          const { bucket, filePath: fp, data: dataB64, contentType } = body;
          const base = getStorageBasePath();
          const fullPath = path.join(base, bucket, fp);
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, Buffer.from(dataB64, "base64"));
          result = { error: null };

        } else if (url === "/storage/getPublicUrl") {
          const { bucket, filePath: fp } = body;
          const base = getStorageBasePath();
          const fullPath = path.join(base, bucket, fp);
          result = { data: { publicUrl: `local-file://${fullPath.replace(/\\/g, "/")}` } };

        } else if (url === "/storage/remove") {
          const { bucket, filePaths } = body;
          const base = getStorageBasePath();
          for (const fp of filePaths) { try { fs.unlinkSync(path.join(base, bucket, fp)); } catch {} }
          result = { error: null };

        } else if (url === "/storage/list") {
          const { bucket, folder, options } = body;
          const base = getStorageBasePath();
          try {
            const files = fs.readdirSync(path.join(base, bucket, folder));
            const limit = options?.limit ?? 1000;
            const offset = options?.offset ?? 0;
            result = { data: files.slice(offset, offset + limit).map((name: string) => ({ name })), error: null };
          } catch { result = { data: [], error: null }; }

        } else if (url === "/settings/get") {
          result = getSettings();

        } else if (url === "/settings/set") {
          setSettings(body);
          result = getSettings();

        } else if (url === "/api/claude-proxy") {
          result = await handleClaudeProxy(body);
        } else if (url === "/api/enhance-inpaint-prompt") {
          result = await handleEnhanceInpaintPrompt(body);
        } else if (url === "/api/translate-analysis") {
          result = await handleTranslateAnalysis(body);
        } else if (url === "/api/analyze-reference-images") {
          result = await handleAnalyzeReferenceImages(body);
        } else if (url === "/api/openai-image") {
          result = await handleOpenaiImage(body);

        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err: any) {
        console.error(`[local-server] ${url} error:`, err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });

    server.listen(LOCAL_SERVER_PORT, "127.0.0.1", () => {
      const port = (server.address() as any).port;
      console.log(`[local-server] Running on port ${port}`);
      resolve(port);
    });
  });
}
