import { app, BrowserWindow, protocol } from "electron";
import path from "path";
import fs from "fs";
import { initDatabase, closeDb } from "./db";
import { startLocalServer } from "./local-server";
import { getLocalServerAuthToken, getLocalServerPort } from "./constants";
import { sweepOrphanFiles } from "./orphanSweep";

const profile = process.env.PREFLOW_PROFILE?.trim();
if (profile) {
  const profileName = `preflow-${profile}`;
  app.setName(profileName);
  app.setPath("userData", path.join(app.getPath("appData"), profileName));
  console.log(`[profile] Using isolated userData: ${app.getPath("userData")}`);
} else if (process.env.VITE_DEV_SERVER_URL) {
  console.warn("[profile] PREFLOW_PROFILE is not set. Development is using production userData.");
}

// Chromium의 native UI(달력 피커, context menu 등) 언어를 영문으로 강제.
// app.whenReady() 이전에 호출되어야 적용됨.
app.commandLine.appendSwitch("lang", "en-US");

// ── Single-instance lock ──────────────────────────────────────────
// 두 번째 실행 시 새 Electron 프로세스를 띄우지 않고, 기존 창에 포커스를
// 주는 것으로 교체. 이 작업이 없으면 두 번째 인스턴스가 19876 포트 바인딩
// 에서 EADDRINUSE 로 크래시한다.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

const DIST = path.join(__dirname, "../dist");

function resolveStorageFilePath(rawUrl: string): string {
  const raw = rawUrl.replace(/^local-file:\/\//i, "");
  const noQuery = raw.split(/[?#]/)[0];
  const decoded = decodeURIComponent(noQuery);
  const cleaned = decoded.replace(/^\/+/, "");
  const filePath = path.resolve(path.normalize(cleaned));
  const storageRoot = path.resolve(app.getPath("userData"), "storage");
  const rel = path.relative(storageRoot, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Blocked local-file outside storage: ${filePath}`);
  }
  return filePath;
}

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

  // 렌더러가 local-server 의 실제 포트를 알 수 있도록 URL query 로 주입.
  // startLocalServer() 가 19876 이 아닌 다른 포트로 fallback 했을 때도
  // 렌더러가 올바른 URL 로 통신하게 된다.
  const port = getLocalServerPort();
  const portQuery = `preflowPort=${port}&preflowToken=${encodeURIComponent(getLocalServerAuthToken())}`;

  if (process.env.VITE_DEV_SERVER_URL) {
    const devUrl = new URL(process.env.VITE_DEV_SERVER_URL);
    devUrl.searchParams.set("preflowPort", String(port));
    mainWindow.loadURL(devUrl.toString());
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(DIST, "index.html"), {
      search: portQuery,
    });
  }
}

app.whenReady().then(async () => {
  protocol.handle("local-file", async (request) => {
    // local-file://C:/path/to/file.png?t=12345 → 디스크에서 직접 읽어 Response로 반환
    try {
      const filePath = resolveStorageFilePath(request.url);
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
        ext === ".mov" ? "video/quicktime" :
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
  await startLocalServer();
  createWindow();

  // 앱 시작 시 orphan sweep 을 한 번 돌려 DB 에서 더 이상 참조되지 않는
  // 파일(과거 누수된 에셋 이미지, inpaint 중간 파일 등) 을 청소한다.
  // 윈도우 뜨는 것보다 나중에 시작해 UI 렌더에 영향을 주지 않도록 지연.
  // 실패해도 앱 기능에 영향 없음 — 다음 부팅에서 다시 시도.
  setTimeout(() => {
    try {
      sweepOrphanFiles();
    } catch (err) {
      console.error("[orphanSweep] unexpected failure:", err);
    }
  }, 3000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Single-instance lock 2 nd 이벤트 — 두 번째 실행 시 기존 창을 전면으로.
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  closeDb();
});
