import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RYUGI_VERSION = "1.108.1";
export const RYUGI_WORKFLOW_COMMIT = "6f5b4cc70c0493f4848a8ec1fa090258389eff08";
const repository = "https://github.com/Innei/ryugi.git";

export function setupRuntime({
  runtimeDir = process.env.PASEO_RYUGI_RUNTIME_DIR || path.join(os.homedir(), ".paseo", "ryugi-runtime", RYUGI_VERSION),
  run = (command, args) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }),
} = {}) {
  runtimeDir = path.resolve(runtimeDir);
  fs.mkdirSync(runtimeDir, { recursive: true });
  const packageDir = path.join(runtimeDir, "node_modules", "ryugi-artifacts");
  const cliPath = path.join(packageDir, "dist", "cli.cjs");
  const packageReady = () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8")).version === RYUGI_VERSION && fs.statSync(cliPath).isFile();
    } catch { return false; }
  };
  if (!packageReady()) {
    run("npm", ["install", "--prefix", runtimeDir, "--ignore-scripts", "--no-audit", "--no-fund", `ryugi-artifacts@${RYUGI_VERSION}`]);
  }
  if (!packageReady()) throw new Error("Ryugi artifacts 安装结果不完整或版本不匹配");
  const workflowDir = path.join(runtimeDir, "workflow");
  const git = (...args) => run("git", ["-c", "core.hooksPath=/dev/null", "-C", workflowDir, ...args]);
  fs.mkdirSync(workflowDir, { recursive: true });
  if (!fs.existsSync(path.join(workflowDir, ".git"))) git("init");
  let commit;
  try { commit = String(git("rev-parse", "HEAD")).trim(); } catch {}
  if (commit !== RYUGI_WORKFLOW_COMMIT) {
    git("fetch", "--depth", "1", repository, RYUGI_WORKFLOW_COMMIT);
    git("checkout", "--detach", "FETCH_HEAD");
    commit = String(git("rev-parse", "HEAD")).trim();
  }
  if (commit !== RYUGI_WORKFLOW_COMMIT) throw new Error(`Ryugi workflow commit 不匹配：${commit}`);
  for (const name of ["using-ryugi", "brainstorming", "artifacts", "executing-specs"]) {
    const skill = path.join(workflowDir, "skills", name, "SKILL.md");
    if (!fs.existsSync(skill) || !fs.statSync(skill).isFile()) throw new Error(`Ryugi workflow 缺少 ${name} skill`);
  }
  fs.writeFileSync(path.join(runtimeDir, "runtime.json"), `${JSON.stringify({ version: RYUGI_VERSION, workflowCommit: RYUGI_WORKFLOW_COMMIT }, null, 2)}\n`);
  return runtimeDir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Ryugi 插件专用运行时已就绪：${setupRuntime()}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
