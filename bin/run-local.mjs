#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const build = spawnSync(
  process.execPath,
  [join(root, "bin", "build.mjs")],
  { cwd: root, stdio: "inherit" },
);

if (build.error) throw build.error;
if (build.status !== 0) {
  if (build.signal) process.kill(process.pid, build.signal);
  process.exit(build.status ?? 1);
}

const cli = spawnSync(
  process.execPath,
  [join(root, "dist", "bin", "linear-sdk-axi.js"), ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (cli.error) throw cli.error;
if (cli.signal) process.kill(process.pid, cli.signal);
process.exit(cli.status ?? 1);
