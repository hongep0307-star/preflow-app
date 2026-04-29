import http from "http";
import { dialog, shell } from "electron";
import { getSettings, setSettings } from "./settings";
import { getStorageBasePath } from "./paths";
import {
  handleClaudeProxy,
  handleEnhanceInpaintPrompt,
  handleTranslateAnalysis,
  handleAnalyzeReferenceImages,
  handleOpenaiImage,
  handleOpenAIResponses,
} from "./api-handlers";
import { handleYoutubeIngest } from "./youtube-handler";
import { importEagleLibrary, previewEagleLibrary } from "./eagle-import";
import { exportLibraryPack } from "./packExport";
import { applyPack, previewPackFromDisk } from "./packImport";
import { cleanupOrphanFiles, previewOrphanFiles } from "./orphanSweep";
import { getStorageUsage } from "./storageMaintenance";
import {
  dbSelect,
  dbInsert,
  dbUpdate,
  dbDelete,
  dbUpsert,
} from "./db-utils";
import path from "path";
import fs from "fs";

import { getLocalServerAuthToken, getLocalServerBaseUrl, LOCAL_SERVER_PORT, setLocalServerPort } from "./constants";
import { REFERENCE_UPLOAD_MAX_BYTES, REFERENCE_UPLOAD_MAX_LABEL } from "../shared/constants";
export { LOCAL_SERVER_PORT };

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type JsonBody = Record<string, unknown>;

function asJsonBody(value: unknown): JsonBody {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonBody) : {};
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function errorStatus(err: unknown): number {
  return typeof err === "object" && err !== null && "status" in err && typeof (err as { status?: unknown }).status === "number"
    ? (err as { status: number }).status
    : 500;
}

// JSON body 한도는 base64 팽창(약 4/3 배) + form/manifest 오버헤드를 감안해
// 업로드 상한보다 여유를 두지만, 디스크에 떨어지는 실제 파일 크기는 항상
// `REFERENCE_UPLOAD_MAX_BYTES` 로 제한한다.
const MAX_JSON_BODY_BYTES = Math.ceil(REFERENCE_UPLOAD_MAX_BYTES * 1.5);

function parseBody(req: http.IncomingMessage, maxBytes = MAX_JSON_BODY_BYTES): Promise<JsonBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > maxBytes) {
        reject(new HttpError(413, `Request body too large. Limit is ${Math.round(maxBytes / 1024 / 1024)}MB.`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString();
        resolve(asJsonBody(raw.trim() ? JSON.parse(raw) : {}));
      } catch {
        reject(new HttpError(400, "Malformed JSON request body."));
      }
    });
    req.on("error", reject);
  });
}

const STORAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

// Storage layout is: <userData>/storage/<bucket>/<projectId|...>/<file>
// The renderer must not be allowed to choose arbitrary buckets — that would
// let a malicious script overwrite app config files etc.
const ALLOWED_BUCKETS = new Set(["assets", "contis", "briefs", "style-presets", "mood", "references"]);

function resolveBucketPath(bucket: string, sub: string): string {
  if (!ALLOWED_BUCKETS.has(bucket)) {
    throw new Error(`Disallowed bucket: ${bucket}`);
  }
  const base = getStorageBasePath();
  const target = path.resolve(base, bucket, sub);
  // Defense-in-depth: even if `sub` is "../../escape", the resolved path must
  // remain inside <base>/<bucket>/.
  const bucketRoot = path.resolve(base, bucket);
  if (target !== bucketRoot && !target.startsWith(bucketRoot + path.sep)) {
    throw new Error(`Path traversal detected: ${bucket}/${sub}`);
  }
  return target;
}

function resolveStorageReadPath(relative: string): string {
  const base = path.resolve(getStorageBasePath());
  const target = path.resolve(base, relative);
  const rel = path.relative(base, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path traversal detected: ${relative}`);
  }
  return target;
}

function resolveStorageUrlToPath(rawUrl: unknown): string {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new HttpError(400, "Missing file URL.");
  }
  const storageBase = path.resolve(getStorageBasePath());
  let target: string;

  if (rawUrl.startsWith("local-file://")) {
    let rawPath = decodeURIComponent(rawUrl.slice("local-file://".length).split(/[?#]/)[0]).replace(/\//g, path.sep);
    if (/^\\[A-Za-z]:/.test(rawPath)) rawPath = rawPath.slice(1);
    target = path.resolve(rawPath);
  } else {
    const match = rawUrl.match(/^https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/storage\/file\/(.+)$/i);
    if (!match?.[1]) throw new HttpError(400, "URL is not a local storage file.");
    target = resolveStorageReadPath(decodeURIComponent(match[1].split(/[?#]/)[0]));
  }

  const rel = path.relative(storageBase, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new HttpError(403, "File is outside app storage.");
  }
  return target;
}

function sanitizeCopyName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "reference";
}

async function copyReferenceStorageFile(rawUrl: unknown, targetId: unknown, label: unknown): Promise<{ publicUrl: string; filePath: string }> {
  if (typeof targetId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(targetId)) {
    throw new HttpError(400, "Invalid target reference id.");
  }
  const sourcePath = resolveStorageUrlToPath(rawUrl);
  await fs.promises.access(sourcePath);
  const ext = path.extname(sourcePath) || ".bin";
  const sourceBase = path.basename(sourcePath, ext);
  const safeLabel = typeof label === "string" && label.trim() ? label.trim() : sourceBase;
  const yyyyMm = new Date().toISOString().slice(0, 7);
  const relative = `${yyyyMm}/${targetId}/${sanitizeCopyName(safeLabel)}${ext}`;
  const targetPath = resolveBucketPath("references", relative);
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.copyFile(sourcePath, targetPath);
  return {
    publicUrl: `${getLocalServerBaseUrl()}/storage/file/references/${relative}`,
    filePath: relative,
  };
}

function decodeUploadPayload(dataB64: unknown): Buffer {
  if (typeof dataB64 !== "string" || !dataB64) {
    throw new HttpError(400, "Missing upload data.");
  }
  const approxBytes = Math.floor((dataB64.length * 3) / 4);
  const tooLargeMsg = `Reference uploads must be ${REFERENCE_UPLOAD_MAX_LABEL} or smaller.`;
  if (approxBytes > REFERENCE_UPLOAD_MAX_BYTES) {
    throw new HttpError(413, tooLargeMsg);
  }
  const buffer = Buffer.from(dataB64, "base64");
  if (buffer.byteLength > REFERENCE_UPLOAD_MAX_BYTES) {
    throw new HttpError(413, tooLargeMsg);
  }
  return buffer;
}

function isAuthorized(req: http.IncomingMessage): boolean {
  if (req.headers["x-preflow-token"] === getLocalServerAuthToken()) return true;
  // In dev the renderer is served from Vite and can be reloaded directly
  // without Electron's query token. Keep production strict while allowing
  // the known dev origin to talk to the local server.
  const devOrigin = process.env.VITE_DEV_SERVER_URL;
  if (devOrigin) {
    const allowed = new URL(devOrigin).origin;
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    if (origin === allowed || (typeof referer === "string" && referer.startsWith(allowed))) {
      return true;
    }
  }
  return false;
}

/** 실제로 한 번 listen 시도. 실패하면 Error(code 포함) 을 reject. */
function listenOnce(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      const actual = (server.address() as { port: number } | null)?.port ?? port;
      resolve(actual);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function startLocalServer(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Preflow-Token");

      if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }

      const url = req.url || "";

      if (req.method === "GET" && url.startsWith("/storage/file/")) {
        // ?t=cacheBuster 같은 쿼리스트링이 붙어 들어와도 파일 lookup이 깨지지 않도록 strip
        const rawRelative = url.slice("/storage/file/".length).split(/[?#]/)[0];
        const relative = decodeURIComponent(rawRelative);
        let fullPath: string;
        try {
          fullPath = resolveStorageReadPath(relative);
        } catch {
          res.writeHead(403);
          res.end();
          return;
        }
        try {
          await fs.promises.access(fullPath);
        } catch {
          console.warn("[local-server] 404:", url, "→", fullPath);
          res.writeHead(404);
          res.end();
          return;
        }
        const ext = path.extname(fullPath).toLowerCase();
        const stat = await fs.promises.stat(fullPath);
        const contentType = STORAGE_MIME[ext] || "application/octet-stream";
        const range = req.headers.range;
        if (range) {
          const match = range.match(/^bytes=(\d*)-(\d*)$/);
          if (!match) {
            res.writeHead(416, {
              "Content-Range": `bytes */${stat.size}`,
              "Accept-Ranges": "bytes",
            });
            res.end();
            return;
          }
          const start = match[1] ? Number(match[1]) : 0;
          const end = match[2] ? Number(match[2]) : stat.size - 1;
          if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start < 0 || end >= stat.size) {
            res.writeHead(416, {
              "Content-Range": `bytes */${stat.size}`,
              "Accept-Ranges": "bytes",
            });
            res.end();
            return;
          }
          res.writeHead(206, {
            "Content-Type": contentType,
            "Content-Length": end - start + 1,
            "Content-Range": `bytes ${start}-${end}/${stat.size}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-cache",
          });
          fs.createReadStream(fullPath, { start, end }).pipe(res);
          return;
        }
        res.writeHead(200, {
          "Content-Type": contentType,
          "Content-Length": stat.size,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-cache",
        });
        fs.createReadStream(fullPath).pipe(res);
        return;
      }

      if (req.method !== "POST") {
        res.writeHead(405);
        res.end();
        return;
      }

      if (!isAuthorized(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      try {
        const body = await parseBody(req);
        let result: unknown;

        if (url === "/db/select") {
          const { table, where, options } = body;
          result = dbSelect(table, where, options);
        } else if (url === "/db/insert") {
          const { table, data } = body;
          result = dbInsert(table, data);
        } else if (url === "/db/update") {
          const { table, data, where } = body;
          result = dbUpdate(table, data, where);
        } else if (url === "/db/delete") {
          const { table, where } = body;
          result = dbDelete(table, where);
        } else if (url === "/db/upsert") {
          const { table, data, conflictKeys } = body;
          result = dbUpsert(table, data, conflictKeys);
        } else if (url === "/storage/upload") {
          const { bucket, filePath: fp, data: dataB64 } = body;
          const fullPath = resolveBucketPath(bucket, fp);
          const uploadBuffer = decodeUploadPayload(dataB64);
          await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.promises.writeFile(fullPath, uploadBuffer);
          result = { error: null };
        } else if (url === "/storage/getPublicUrl") {
          const { bucket, filePath: fp } = body;
          const fullPath = resolveBucketPath(bucket, fp);
          result = { data: { publicUrl: `local-file://${fullPath.replace(/\\/g, "/")}` } };
        } else if (url === "/storage/copy-reference-file") {
          result = await copyReferenceStorageFile(body?.url, body?.targetId, body?.label);
        } else if (url === "/storage/remove") {
          const { bucket, filePaths } = body;
          await Promise.all(
            (filePaths as string[]).map(async (fp) => {
              try {
                await fs.promises.unlink(resolveBucketPath(bucket, fp));
              } catch {
                /* ignore missing files / disallowed paths */
              }
            }),
          );
          result = { error: null };
        } else if (url === "/storage/list") {
          const { bucket, folder, options } = body;
          try {
            const dir = resolveBucketPath(bucket, folder ?? "");
            const files = await fs.promises.readdir(dir);
            const limit = options?.limit ?? 1000;
            const offset = options?.offset ?? 0;
            result = {
              data: files.slice(offset, offset + limit).map((name: string) => ({ name })),
              error: null,
            };
          } catch {
            result = { data: [], error: null };
          }
        } else if (url === "/storage/usage") {
          result = getStorageUsage();
        } else if (url === "/storage/orphans/preview") {
          result = previewOrphanFiles({ includeReferences: Boolean(body?.includeReferences) });
        } else if (url === "/storage/orphans/cleanup") {
          result = cleanupOrphanFiles({ includeReferences: Boolean(body?.includeReferences) });
        } else if (url === "/eagle/select-library") {
          const picked = await dialog.showOpenDialog({
            title: "Select Eagle Library",
            properties: ["openDirectory"],
          });
          if (picked.canceled || picked.filePaths.length === 0) {
            result = { canceled: true, rootPath: null, preview: null };
          } else {
            const rootPath = picked.filePaths[0];
            result = { canceled: false, rootPath, preview: await previewEagleLibrary(rootPath) };
          }
        } else if (url === "/eagle/preview") {
          const { rootPath } = body;
          result = await previewEagleLibrary(String(rootPath ?? ""));
        } else if (url === "/eagle/import") {
          const { rootPath } = body;
          result = await importEagleLibrary(String(rootPath ?? ""));
        } else if (url === "/pack/export") {
          result = await exportLibraryPack(body);
        } else if (url === "/pack/preview") {
          result = await previewPackFromDisk();
        } else if (url === "/pack/import") {
          result = await applyPack(body);
        } else if (url === "/shell/resolve-path") {
          const filePath = resolveStorageUrlToPath(body?.url);
          result = { filePath };
        } else if (url === "/shell/open-path") {
          const filePath = resolveStorageUrlToPath(body?.url);
          const error = await shell.openPath(filePath);
          if (error) throw new HttpError(500, error);
          result = { ok: true };
        } else if (url === "/shell/show-item") {
          const filePath = resolveStorageUrlToPath(body?.url);
          shell.showItemInFolder(filePath);
          result = { ok: true };
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
        } else if (url === "/api/openai-chat") {
          result = await handleOpenAIResponses(body);
        } else if (url === "/api/youtube-ingest") {
          result = await handleYoutubeIngest(body);
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err: unknown) {
        console.error(`[local-server] ${url} error:`, err);
        res.writeHead(errorStatus(err), { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: errorMessage(err) }));
      }
    });

    void (async () => {
    // ── 포트 바인딩 전략 ─────────────────────────────────────────────
    // 1. 선호 포트 19876 을 3 회까지 재시도 (TIME_WAIT / zombie 해제 대기).
    // 2. 그래도 EADDRINUSE 면 port=0 으로 OS 가 할당해 주는 랜덤 포트 사용.
    // 3. 실제 bind 된 포트를 setLocalServerPort() 로 기록해서 main/renderer
    //    양쪽이 올바른 URL 을 쓰도록 한다.
    const maxRetries = 3;
    let lastErr: NodeJS.ErrnoException | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const port = await listenOnce(server, LOCAL_SERVER_PORT);
        setLocalServerPort(port);
        console.log(`[local-server] Running on port ${port}`);
        resolve(port);
        return;
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code !== "EADDRINUSE") {
          reject(e);
          return;
        }
        lastErr = e;
        if (attempt < maxRetries - 1) {
          console.warn(
            `[local-server] Port ${LOCAL_SERVER_PORT} busy, retry ${attempt + 1}/${maxRetries - 1} in ${500 * (attempt + 1)}ms`,
          );
          await sleep(500 * (attempt + 1));
        }
      }
    }

    // Fallback: OS 가 할당하는 랜덤 포트로 시도.
    console.warn(
      `[local-server] Preferred port ${LOCAL_SERVER_PORT} unavailable after retries (${lastErr?.message}). Falling back to a random port.`,
    );
    try {
      const port = await listenOnce(server, 0);
      setLocalServerPort(port);
      console.log(`[local-server] Running on fallback port ${port}`);
      resolve(port);
    } catch (err) {
      reject(err);
    }
    })();
  });
}
