import fs from "fs";
import path from "path";
import { getStorageBasePath } from "./paths";

export interface StorageUsage {
  total_bytes: number;
  by_bucket: Record<string, number>;
  file_count: number;
}

function walkFiles(root: string, visit: (filePath: string, stat: fs.Stats) => void): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, visit);
    } else if (entry.isFile()) {
      try {
        visit(full, fs.statSync(full));
      } catch {
        /* ignore files that disappear during the walk */
      }
    }
  }
}

export function getStorageUsage(): StorageUsage {
  const base = getStorageBasePath();
  const usage: StorageUsage = { total_bytes: 0, by_bucket: {}, file_count: 0 };
  let buckets: fs.Dirent[];
  try {
    buckets = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return usage;
  }
  for (const bucket of buckets) {
    if (!bucket.isDirectory() || bucket.name.startsWith(".")) continue;
    const bucketRoot = path.join(base, bucket.name);
    let bucketBytes = 0;
    walkFiles(bucketRoot, (_filePath, stat) => {
      bucketBytes += stat.size;
      usage.file_count += 1;
    });
    usage.by_bucket[bucket.name] = bucketBytes;
    usage.total_bytes += bucketBytes;
  }
  return usage;
}
