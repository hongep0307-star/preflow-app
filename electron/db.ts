import Database from "better-sqlite3";
import path from "path";
import { app } from "electron";

let db: Database.Database | null = null;
let dbPath = "";

export function getDb(): Database.Database {
  if (!db) throw new Error("Database not initialized");
  return db;
}

// Kept as a no-op for backwards compatibility with call sites that used to
// flush the in-memory sql.js database. better-sqlite3 persists every write
// synchronously, so there is nothing to do here.
export function saveDb(): void {
  // intentionally empty
}

export function closeDb(): void {
  if (!db) return;
  try {
    db.close();
  } catch (err) {
    console.error("[DB] close failed:", err);
  }
  db = null;
}

export async function initDatabase(): Promise<void> {
  const userDataPath = app.getPath("userData");
  dbPath = path.join(userDataPath, "preflow.db");
  console.log("[DB] Path:", dbPath);

  db = new Database(dbPath);
  // WAL gives us crash-safe durability while keeping writes fast.
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  createTables();
  console.log("[DB] Initialized successfully (better-sqlite3)");
}

function createTables() {
  const d = getDb();

  d.exec(`
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
    d.exec(`ALTER TABLE projects ADD COLUMN thumbnail_crop TEXT`);
  } catch (_) { /* column already exists */ }

  d.exec(`
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
    d.exec(`ALTER TABLE briefs ADD COLUMN raw_text TEXT`);
  } catch (_) { /* column already exists */ }

  d.exec(`
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
      is_final INTEGER DEFAULT 0,
      is_highlight INTEGER DEFAULT 0,
      highlight_kind TEXT,
      highlight_reason TEXT,
      transition_type TEXT,
      sketches TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  // sketches: per-scene composition candidates generated in ContiStudio's Sketches tab.
  // JSON array of { id, url, model, createdAt, liked? }. Tied to the scene row's
  // lifecycle via FK cascade — delete the scene, the sketches go with it.
  // Idempotent ALTER for legacy DBs created before this column existed.
  try {
    d.exec(`ALTER TABLE scenes ADD COLUMN sketches TEXT DEFAULT '[]'`);
  } catch (_) { /* column already exists */ }

  // is_final: user-confirmed completion marker for dashboard progress and
  // automatic project status sync. Legacy local DBs need this migration.
  try {
    d.exec(`ALTER TABLE scenes ADD COLUMN is_final INTEGER DEFAULT 0`);
  } catch (_) { /* column already exists */ }

  // Highlight: soft key-visual marker used by prompt generation. Optional
  // fields so legacy scenes keep rendering even before the user marks any.
  try {
    d.exec(`ALTER TABLE scenes ADD COLUMN is_highlight INTEGER DEFAULT 0`);
  } catch (_) { /* column already exists */ }
  try {
    d.exec(`ALTER TABLE scenes ADD COLUMN highlight_kind TEXT`);
  } catch (_) { /* column already exists */ }
  try {
    d.exec(`ALTER TABLE scenes ADD COLUMN highlight_reason TEXT`);
  } catch (_) { /* column already exists */ }

  d.exec(`
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
    d.exec(`ALTER TABLE assets ADD COLUMN source_type TEXT DEFAULT 'upload'`);
  } catch (_) { /* column already exists */ }

  // photo_crop was added later for the FocalEditor (profile-image drag + zoom).
  // Existing DBs created before that addition don't have the column, so UPDATEs
  // silently fail and any saved focal point vanishes on reload. Idempotent
  // ALTER for those legacy DBs; no-op otherwise.
  try {
    d.exec(`ALTER TABLE assets ADD COLUMN photo_crop TEXT`);
  } catch (_) { /* column already exists */ }

  // photo_variations: stores per-framing alternate views for `background` assets
  // (wide / medium / close / detail / alt). Generated on-demand from the
  // primary photo_url via the background_variations IPC, then used at scene
  // gen time to select the framing-matched reference image instead of always
  // forcing the same wide composition into close-up scenes. JSON-encoded
  // array of { url, framing, caption?, generated_at }. Optional column —
  // backgrounds without variations fall back to photo_url as before.
  try {
    d.exec(`ALTER TABLE assets ADD COLUMN photo_variations TEXT`);
  } catch (_) { /* column already exists */ }

  d.exec(`
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

  d.exec(`
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

  d.exec(`
    CREATE TABLE IF NOT EXISTS chat_logs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      user_id TEXT DEFAULT 'local',
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Indexes — every read path filters by project_id; chat history orders by
  // created_at; scenes are sorted by scene_number per project. Keeping the
  // indexes here is idempotent (CREATE INDEX IF NOT EXISTS).
  d.exec(`
    CREATE INDEX IF NOT EXISTS idx_briefs_project_id        ON briefs(project_id);
    CREATE INDEX IF NOT EXISTS idx_scenes_project_number    ON scenes(project_id, scene_number);
    CREATE INDEX IF NOT EXISTS idx_assets_project_id        ON assets(project_id);
    CREATE INDEX IF NOT EXISTS idx_scene_versions_project   ON scene_versions(project_id);
    CREATE INDEX IF NOT EXISTS idx_chat_logs_project_time   ON chat_logs(project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_projects_folder_id       ON projects(folder_id);
  `);
}
