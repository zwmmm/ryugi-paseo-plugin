import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setupCloudflared } from "./setup-cloudflared.mjs";

export const ARTIDECK_PACKAGE = "artideck";
export const ARTIDECK_REPOSITORY = "https://github.com/Innei/artideck.git";
const npmRegistry = "--registry=https://registry.npmjs.org/";
const stableVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const entrySkills = ["using-adeck", "using-ryugi"];
const stageSkills = ["brainstorming", "artifacts", "executing-specs"];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function readInstalledVersion(runtimeDir) {
  const packageDir = path.join(runtimeDir, "node_modules", ARTIDECK_PACKAGE);
  const cliPath = path.join(packageDir, "dist", "cli.cjs");
  const pkg = readJson(path.join(packageDir, "package.json"));
  if (!pkg || typeof pkg.version !== "string" || !stableVersion.test(pkg.version)) return undefined;
  try {
    if (!fs.statSync(cliPath).isFile()) return undefined;
  } catch { return undefined; }
  return pkg.version;
}

export function setupRuntime({
  runtimeDir = process.env.PASEO_ARTIDECK_RUNTIME_DIR || process.env.PASEO_RYUGI_RUNTIME_DIR || path.join(os.homedir(), ".paseo", "artideck-runtime"),
  run = (command, args) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }),
} = {}) {
  runtimeDir = path.resolve(runtimeDir);
  fs.mkdirSync(runtimeDir, { recursive: true });
  const manifest = readJson(path.join(runtimeDir, "runtime.json"));
  const installedVersion = readInstalledVersion(runtimeDir);
  const manifestValid = manifest
    && typeof manifest.version === "string"
    && stableVersion.test(manifest.version)
    && typeof manifest.workflowCommit === "string"
    && manifest.workflowCommit.length > 0
    && installedVersion === manifest.version;

  let version;
  let expectedCommit;
  if (manifestValid) {
    version = manifest.version;
    expectedCommit = manifest.workflowCommit;
  } else {
    const latest = JSON.parse(String(run("npm", ["view", `${ARTIDECK_PACKAGE}@latest`, "version", "--json", npmRegistry])).trim());
    if (typeof latest !== "string" || !stableVersion.test(latest)) {
      throw new Error(`Artideck 最新版本号无效：${latest}`);
    }
    version = latest;
    if (installedVersion !== version) {
      fs.writeFileSync(path.join(runtimeDir, "package.json"), `${JSON.stringify({ name: "artideck-paseo-runtime", private: true }, null, 2)}\n`);
      run("npm", ["install", `${ARTIDECK_PACKAGE}@${version}`, "--prefix", runtimeDir, "--save-exact", "--ignore-scripts", "--no-audit", "--no-fund", npmRegistry]);
    }
    if (readInstalledVersion(runtimeDir) !== version) {
      throw new Error("Artideck 安装结果不完整或版本不匹配");
    }
  }

  const workflowDir = path.join(runtimeDir, "workflow");
  const git = (...args) => run("git", ["-c", "core.hooksPath=/dev/null", "-C", workflowDir, ...args]);
  fs.mkdirSync(workflowDir, { recursive: true });
  if (!fs.existsSync(path.join(workflowDir, ".git"))) git("init");
  let commit;
  try { commit = String(git("rev-parse", "HEAD")).trim(); } catch {}
  if (!expectedCommit || commit !== expectedCommit) {
    git("fetch", "--depth", "1", ARTIDECK_REPOSITORY, `refs/tags/v${version}`);
    git("checkout", "--detach", "FETCH_HEAD");
    commit = String(git("rev-parse", "HEAD")).trim();
  }
  if (!commit || (expectedCommit && commit !== expectedCommit)) {
    throw new Error(`Artideck workflow commit 不匹配：${commit}`);
  }
  const hasEntry = entrySkills.some((name) => {
    const skill = path.join(workflowDir, "skills", name, "SKILL.md");
    return fs.existsSync(skill) && fs.statSync(skill).isFile();
  });
  if (!hasEntry) throw new Error("Artideck workflow 缺少 using-adeck skill");
  for (const name of stageSkills) {
    const skill = path.join(workflowDir, "skills", name, "SKILL.md");
    if (!fs.existsSync(skill) || !fs.statSync(skill).isFile()) throw new Error(`Artideck workflow 缺少 ${name} skill`);
  }
  fs.writeFileSync(path.join(runtimeDir, "runtime.json"), `${JSON.stringify({ package: ARTIDECK_PACKAGE, version, workflowCommit: commit }, null, 2)}\n`);
  return runtimeDir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const runtimeDir = setupRuntime();
    await setupCloudflared(runtimeDir);
    console.log(`Artideck 插件专用运行时已就绪：${runtimeDir}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
