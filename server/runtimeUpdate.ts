import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { runtimeUpdateStatus, startRuntimeUpdate, type RuntimeUpdateStatus } from "../shared/runtimeUpdate.js";
import { compareVersions, getRuntimeRelease, readRuntimeRelease, stableVersion } from "./privateRuntime.js";

const exec = promisify(execFile);
const registry = "--registry=https://registry.npmjs.org/";
const repository = "https://github.com/Innei/ryugi.git";

export async function updatePrivateRuntime(
  runtimeDir: string,
  signal: AbortSignal,
  run = async (command: string, args: string[], cwd: string) => {
    const { stdout } = await exec(command, args, { cwd, signal, timeout: 120_000 });
    return stdout;
  },
) {
  const version: unknown = JSON.parse(await run("npm", ["view", "ryugi-artifacts@latest", "version", "--json", registry], runtimeDir));
  if (typeof version !== "string" || !stableVersion.test(version)) throw new Error("Invalid Ryugi release version");
  if (compareVersions(version, getRuntimeRelease(runtimeDir).version) <= 0) return "current";

  const releasesDir = path.join(runtimeDir, "releases");
  fs.mkdirSync(releasesDir, { recursive: true });
  const staged = fs.mkdtempSync(path.join(releasesDir, ".install-"));
  try {
    fs.writeFileSync(path.join(staged, "package.json"), JSON.stringify({ private: true }));
    await run("npm", ["install", `ryugi-artifacts@${version}`, "--save-exact", "--ignore-scripts", "--no-audit", "--no-fund", registry], staged);
    const workflowDir = path.join(staged, "workflow");
    fs.mkdirSync(workflowDir, { recursive: true });
    const git = (...args: string[]) => run("git", ["-c", "core.hooksPath=/dev/null", ...args], workflowDir);
    await git("init");
    await git("fetch", "--depth", "1", repository, `refs/tags/v${version}`);
    await git("checkout", "--detach", "FETCH_HEAD");
    readRuntimeRelease(staged, version);
    if (signal.aborted) throw new Error("Ryugi update was cancelled");
    if (compareVersions(version, getRuntimeRelease(runtimeDir).version) <= 0) return "current";
    try {
      fs.renameSync(staged, path.join(releasesDir, version));
    } catch (error) {
      if (compareVersions(version, getRuntimeRelease(runtimeDir).version) > 0) throw error;
      return "current";
    }
    return "updated";
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
  }
}

export function registerRuntimeUpdates(server: PluginServerContext, runtimeDir: string) {
  const lifetime = new AbortController();
  let phase: RuntimeUpdateStatus["phase"] = "idle";
  const listeners = new Set<(status: RuntimeUpdateStatus) => void>();
  const snapshot = () => ({ version: getRuntimeRelease(runtimeDir).version, phase });
  const setPhase = (next: RuntimeUpdateStatus["phase"]) => {
    phase = next;
    if (listeners.size === 0) return;
    const status = snapshot();
    for (const listener of listeners) listener(status);
  };

  server.handle(runtimeUpdateStatus, async (_input, { push, signal }) => {
    if (signal.aborted) return;
    const listener = (status: RuntimeUpdateStatus) => {
      void push(status).catch((error) => {
        if (!signal.aborted) console.error("[Ryugi] 更新状态推送失败", error);
      });
    };
    listeners.add(listener);
    try {
      await push(snapshot());
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
    } finally {
      listeners.delete(listener);
    }
  });

  server.handle(startRuntimeUpdate, () => {
    if (phase === "updating") return {};
    setPhase("updating");
    void updatePrivateRuntime(runtimeDir, lifetime.signal).then(
      (result) => { if (!lifetime.signal.aborted) setPhase(result); },
      (error) => {
        if (lifetime.signal.aborted) return;
        console.error("[Ryugi] 运行时更新失败", error);
        setPhase("failed");
      },
    );
    return {};
  });

  return () => { lifetime.abort(); listeners.clear(); };
}
