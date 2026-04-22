import http from "http";
import { getSettings, setSettings } from "./settings";
import { getStorageBasePath } from "./paths";
import {
  handleClaudeProxy,
  handleEnhanceInpaintPrompt,
  handleTranslateAnalysis,
  handleAnalyzeReferenceImages,
  handleOpenaiImage,
} from "./api-handlers";
import {
  dbSelect,
  dbInsert,
  dbUpdate,
  dbDelete,
  dbUpsert,
} from "./db-utils";
import path from "path";
import fs from "fs";

import { LOCAL_SERVER_PORT } from "./constants";
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

export function startLocalServer(): Promise<number> {
  return new Promise((resolve) => {
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
