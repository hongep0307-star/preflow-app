import { spawn } from "child_process";
import http from "http";

const DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:8080";
const MAX_WAIT = 30000;
const POLL = 500;

function checkServer() {
  return new Promise((resolve) => {
    http
      .get(DEV_URL, (res) => resolve(res.statusCode === 200))
      .on("error", () => resolve(false));
  });
}

async function waitForVite() {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT) {
    if (await checkServer()) return true;
    await new Promise((r) => setTimeout(r, POLL));
  }
  return false;
}

async function main() {
  console.log("[wait-and-electron] Waiting for Vite dev server...");
  const ready = await waitForVite();
  if (!ready) {
    console.error("[wait-and-electron] Vite dev server did not start in time.");
    process.exit(1);
  }
  console.log("[wait-and-electron] Vite ready, launching Electron...");

  const electron = await import("electron");
  const electronPath = electron.default || electron;
  const child = spawn(String(electronPath), ["."], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, VITE_DEV_SERVER_URL: DEV_URL },
  });

  child.on("close", (code) => {
    process.exit(code ?? 0);
  });
}

main();
