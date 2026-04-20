import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import path from "path";
import { app } from "electron";
import fs from "fs";

let db: SqlJsDatabase | null = null;
let dbPath = "";

export function getDb(): SqlJsDatabase {
  if (!db) throw new Error("Database not initialized");
  return db;
}

export function saveDb() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

export async function initDatabase() {
  const userDataPath = app.getPath("userData");
  dbPath = path.join(userDataPath, "preflow.db");
  console.log("[DB] Path:", dbPath);

  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  createTables();
  saveDb();
  console.log("[DB] Initialized successfully");

  // Auto-save every 5 seconds
  setInterval(() => saveDb(), 5000);
}

function createTables() {
  const d = getDb();

  d.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT DEFAULT 'local',
      title TEXT NOT NULL DEFAULT '',
      client TEXT,
      deadline TEXT,
      status TEXT DEFAULT 'active',
      video_format TEXT DEFAULT 'vertical',
      active_version_id TEXT,
      folder_id TEXT,
      conti_style_id TEXT,
      thumbnail_url TEXT,
      thumbnail_crop TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  try {
    d.run(`ALTER TABLE projects ADD COLUMN thumbnail_crop TEXT`);
  } catch (_) { /* column already exists */ }

  d.run(`
    CREATE TABLE IF NOT EXISTS briefs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      raw_text TEXT,
      analysis TEXT,
      analysis_en TEXT,
      mood_image_urls TEXT,
      mood_bookmarks TEXT,
      lang TEXT DEFAULT 'ko',
      source_type TEXT,
      image_urls TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  try {
    d.run(`ALTER TABLE briefs ADD COLUMN raw_text TEXT`);
  } catch (_) { /* column already exists */ }

  d.run(`
    CREATE TABLE IF NOT EXISTS scenes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      scene_number INTEGER NOT NULL,
      title TEXT,
      description TEXT,
      camera_angle TEXT,
      location TEXT,
      mood TEXT,
      duration_sec REAL,
      tagged_assets TEXT DEFAULT '[]',
      conti_image_url TEXT,
      conti_image_history TEXT DEFAULT '[]',
      source TEXT DEFAULT 'agent',
      conti_image_crop TEXT,
      is_transition INTEGER DEFAULT 0,
      transition_type TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  d.run(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      asset_type TEXT DEFAULT 'character',
      tag_name TEXT NOT NULL,
      photo_url TEXT,
      ai_description TEXT,
      outfit_description TEXT,
      role_description TEXT,
      space_description TEXT,
      signature_items TEXT,
      photo_crop TEXT,
      source_type TEXT DEFAULT 'upload',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  try {
    d.run(`ALTER TABLE assets ADD COLUMN source_type TEXT DEFAULT 'upload'`);
  } catch (_) { /* column already exists */ }

  d.run(`
    CREATE TABLE IF NOT EXISTS scene_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      version_name TEXT,
      scenes TEXT DEFAULT '[]',
      display_order INTEGER,
      is_active INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  d.run(`
    CREATE TABLE IF NOT EXISTS style_presets (
      id TEXT PRIMARY KEY,
      user_id TEXT DEFAULT 'local',
      name TEXT NOT NULL,
      description TEXT,
      reference_image_urls TEXT,
      style_prompt TEXT,
      thumbnail_url TEXT,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  d.run(`
    CREATE TABLE IF NOT EXISTS chat_logs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  d.run(`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      user_id TEXT DEFAULT 'local',
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  d.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
}
