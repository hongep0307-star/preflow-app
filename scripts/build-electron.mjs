import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node18",
  external: ["electron", "better-sqlite3"],
  format: "cjs",
  outdir: "dist-electron",
  sourcemap: true,
};

async function run() {
  await build({ ...common, entryPoints: ["electron/main.ts"] });
  console.log("[electron-build] Build done.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
