#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const staging = mkdtempSync(join(root, ".dist-build-"));
const tsc = spawnSync(
  process.execPath,
  [join(root, "node_modules", "typescript", "bin", "tsc"), "--outDir", staging],
  { cwd: root, stdio: "inherit" },
);

if (tsc.error || tsc.status !== 0) {
  rmSync(staging, { recursive: true, force: true });
  if (tsc.error) throw tsc.error;
  if (tsc.signal) process.kill(process.pid, tsc.signal);
  process.exit(tsc.status ?? 1);
}

if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
renameSync(staging, dist);
if (process.platform !== "win32") {
  chmodSync(join(dist, "bin", "linear-sdk-axi.js"), 0o755);
}
