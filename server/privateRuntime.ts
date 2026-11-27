import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const runtimePackages = ["artideck", "ryugi-artifacts"] as const;
const entrySkills = ["using-adeck", "using-ryugi"] as const;
const stageSkills = ["brainstorming", "artifacts", "executing-specs"] as const;
export const stableVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
export const compareVersions = new Intl.Collator("en", { numeric: true }).compare;

export function readRuntimeRelease(dir: string, version: string) {
  const skillsDir = path.join(dir, "workflow", "skills");
  for (const pkgName of runtimePackages) {
    const packageDir = path.join(dir, "node_modules", pkgName);
    const cliPath = path.join(packageDir, "dist", "cli.cjs");
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
      if (pkg.version !== version || !fs.statSync(cliPath).isFile()) continue;
      const hasEntry = entrySkills.some((skill) => {
        try { return fs.statSync(path.join(skillsDir, skill, "SKILL.md")).isFile(); } catch { return false; }
      });
      if (!hasEntry || !stageSkills.every((skill) => fs.statSync(path.join(skillsDir, skill, "SKILL.md")).isFile())) {
        continue;
      }
      return { version, cliPath, skillsDir };
    } catch {}
  }
  throw new Error("Artideck release is incomplete or has a version mismatch");
}

export function getRuntimeRelease(runtimeDir: string) {
  let base: ReturnType<typeof readRuntimeRelease> | undefined;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(runtimeDir, "runtime.json"), "utf8"));
    if (typeof manifest?.version === "string" && stableVersion.test(manifest.version)
      && typeof manifest?.workflowCommit === "string" && manifest.workflowCommit.length > 0) {
      base = readRuntimeRelease(runtimeDir, manifest.version);
    }
  } catch {}
  const releasesDir = path.join(runtimeDir, "releases");
  const releases = fs.existsSync(releasesDir) ? fs.readdirSync(releasesDir, { withFileTypes: true }) : [];
  const versions = releases.filter((entry) => entry.isDirectory() && stableVersion.test(entry.name)
    && (!base || compareVersions(entry.name, base.version) > 0)).map((entry) => entry.name).sort(compareVersions);
  for (const version of versions.reverse()) {
    try { return readRuntimeRelease(path.join(runtimeDir, "releases", version), version); } catch {}
  }
  if (base) return base;
  throw new Error(`Artideck 插件专用运行时未就绪：${runtimeDir}。请运行 npm run setup:runtime。`);
}

function privateRuntimeDir() {
  return path.resolve(process.env.PASEO_ARTIDECK_RUNTIME_DIR || process.env.PASEO_RYUGI_RUNTIME_DIR || path.join(os.homedir(), ".paseo", "artideck-runtime"));
}

function projectDirFor(runtimeDir: string, workspaceDir: string) {
  const projectDir = path.join(runtimeDir, "projects", createHash("sha256").update(path.resolve(workspaceDir)).digest("hex").slice(0, 16));
  fs.mkdirSync(projectDir, { recursive: true, mode: 0o700 });
  return projectDir;
}

export function getProjectDir(workspaceDir: string) {
  return projectDirFor(privateRuntimeDir(), workspaceDir);
}

export function getPrivateRuntime() {
  const runtimeDir = privateRuntimeDir();
  const release = getRuntimeRelease(runtimeDir);
  const serverHome = path.join(runtimeDir, "state", "server");
  const runtimeHash = createHash("sha256").update(runtimeDir).digest("hex").slice(0, 16);
  const socketName = `hub-${createHash("sha256").update(serverHome).digest("hex").slice(0, 12)}.sock`;
  let socketDir = path.join(os.tmpdir(), `paseo-ryugi-${runtimeHash}`);
  if (Buffer.byteLength(path.join(socketDir, socketName)) >= 104) {
    socketDir = path.join("/tmp", `paseo-ryugi-${process.getuid?.() ?? 0}-${runtimeHash}`);
  }
  const socketPath = path.join(socketDir, socketName);
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("RYUGI_")));
  Object.assign(env, {
    RYUGI_SERVER_HOME: serverHome,
    RYUGI_RUNTIME_DIR: socketDir,
    RYUGI_HUB_SOCKET: socketPath,
    RYUGI_CLI_PATH: release.cliPath,
    RYUGI_ARTIFACTS_PORTS: "27419,27420,27421",
    RYUGI_ARTIFACTS_BOARD_PORTS: "27429,27430,27431",
  });
  fs.mkdirSync(serverHome, { recursive: true, mode: 0o700 });
  fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
  return {
    ...release,
    runtimeDir,
    socketPath,
    getProjectDir: (workspaceDir: string) => projectDirFor(runtimeDir, workspaceDir),
    serverHome,
    env,
  };
}
