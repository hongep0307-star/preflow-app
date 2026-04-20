import { app, BrowserWindow, protocol, ipcMain } from "electron";
import path from "path";
import fs from "fs";
import { initDatabase, closeDb } from "./db";
import { registerApiHandlers } from "./api-handlers";
import { registerStorageHandlers, getStorageBasePath } from "./storage";
import { registerDbHandlers } from "./db-handlers";
import { startLocalServer } from "./local-server";

// Chromium의 native UI(달력 피커, context menu 등) 언어를 영문으로 강제.
// app.whenReady() 이전에 호출되어야 적용됨.
app.commandLine.appendSwitch("lang", "en-US");

let mainWindow: BrowserWindow | null = null;

const DIST = path.join(__dirname, "../dist");

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Pre-Flow",
    backgroundColor: "#0a0a0a",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(DIST, "index.html"));
  }
}

app.whenReady().then(async () => {
  protocol.handle("local-file", async (request) => {
    // local-file://C:/path/to/file.png?t=12345 → 디스크에서 직접 읽어 Response로 반환
    try {
      const raw = request.url.replace(/^local-file:\/\//i, "");
      const noQuery = raw.split(/[?#]/)[0];
      const decoded = decodeURIComponent(noQuery);
      // Windows: 선행 슬래시 제거 (e.g. "/C:/foo" → "C:/foo"). path.normalize로 슬래시 정규화.
      const cleaned = decoded.replace(/^\/+/, "");
      const filePath = path.normalize(cleaned);
      const data = await fs.promises.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime =
        ext === ".png" ? "image/png" :
        ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
        ext === ".webp" ? "image/webp" :
        ext === ".gif" ? "image/gif" :
        ext === ".svg" ? "image/svg+xml" :
        ext === ".mp4" ? "video/mp4" :
        ext === ".webm" ? "video/webm" :
        "application/octet-stream";
      return new Response(data, {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Cache-Control": "no-cache",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (err) {
      console.error("[local-file] failed:", request.url, err);
      return new Response("Not Found: " + request.url, { status: 404 });
    }
  });

  await initDatabase();
  registerDbHandlers();
  registerStorageHandlers();
  registerApiHandlers();

  await startLocalServer();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  closeDb();
});
