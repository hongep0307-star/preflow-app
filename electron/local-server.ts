import http from "http";
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
import {
  dbSelect,
  dbInsert,
  dbUpdate,
  dbDelete,
  dbUpsert,
} from "./db-utils";
import path from "path";
import fs from "fs";

import { LOCAL_SERVER_PORT, setLocalServerPort } from "./constants";
export { LOCAL_SERVER_PORT };

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve({});
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
};

// Storage layout is: <userData>/storage/<bucket>/<projectId|...>/<file>
// The renderer must not be allowed to choose arbitrary buckets — that would
// let a malicious script overwrite app config files etc.
const ALLOWED_BUCKETS = new Set(["assets", "contis", "briefs", "style-presets", "mood"]);

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
  return new Promise<number>(async (resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

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
        const base = getStorageBasePath();
        const fullPath = path.join(base, relative);
        if (!fullPath.startsWith(base)) {
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
        res.writeHead(200, {
          "Content-Type": STORAGE_MIME[ext] || "application/octet-stream",
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

      try {
        const body = await parseBody(req);
        let result: any;

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
          await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.promises.writeFile(fullPath, Buffer.from(dataB64, "base64"));
          result = { error: null };
        } else if (url === "/storage/getPublicUrl") {
          const { bucket, filePath: fp } = body;
          const fullPath = resolveBucketPath(bucket, fp);
          result = { data: { publicUrl: `local-file://${fullPath.replace(/\\/g, "/")}` } };
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
      } catch (err: any) {
        console.error(`[local-server] ${url} error:`, err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });

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
  });
}
