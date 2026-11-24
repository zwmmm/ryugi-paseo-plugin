import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { defineAgentTool } from "@getpaseo/plugin/server";
import { z } from "zod";
import type { getPrivateRuntime } from "./privateRuntime.js";

const exec = promisify(execFile);
type Runtime = ReturnType<typeof getPrivateRuntime>;
const commands = new Set(["start", "check", "get", "comment", "changes", "scene", "modules", "report", "storyboard", "publish", "pull"]);

export function ryugiInstructions(runtime: Runtime, projectDir: string, cwd: string) {
  const skills = fs.readdirSync(runtime.skillsDir).filter((name) => fs.existsSync(path.join(runtime.skillsDir, name, "SKILL.md")));
  return [
    "Ryugi is built into this Paseo session. It is a local artifact tool, not an external MCP service. Use the ryugi tool supplied in this session for artifact CLI operations.",
    "At the start of each conversation, read using-ryugi/SKILL.md and follow its task routing, then read the stage skills it selects. The user does not need to mention Ryugi: new requirements, design, implementation and debugging enter the appropriate workflow automatically. Plain questions and read-only checks need no workflow skill, as defined upstream. The full workflow is available at the absolute paths below; read files directly instead of relying on a globally installed Skill tool. Resolve referenced files relative to each skill directory.",
    ...skills.map((name) => `ryugi:${name}: ${path.join(runtime.skillsDir, name, "SKILL.md")}`),
    `Source workspace: ${cwd}. Inspect its reusable components, layouts and design rules there. Private Ryugi project: ${projectDir}. Artifacts must be written only to the paths returned by the tool; do not put them in the source workspace's .ryugi directory.`,
    "Paseo adaptation overrides upstream host setup: replace ryugi / node app/ryugi.cjs commands with this session's ryugi tool and the same args. The tool selects the private CLI, environment and project directory. Do not invoke a system Ryugi, launcher, install/update, daemon, hook installer, or modify global agent skills/configuration/PATH. Do not install upstream harness integrations.",
    "Never open, inspect or automate Ryugi in a browser and never invoke a browser automation skill for Ryugi. Return the actual local URL from start for the user to open. Report browser-only verification as pending; do not claim it passed. Do not publish to the cloud unless the user explicitly requests it.",
    "Paseo monitor forwards submitted comments, choices, answers and withdrawals to this session so you can continue the task. Read complete feedback with the ryugi tool; acknowledge receipts only after applying their evidence. Do not fabricate user choices or acceptance. User instructions and existing project rules take priority.",
  ].join("\n");
}

export function createRyugiTool(runtime: Runtime, projectDir: string, onStart: (output: string) => Promise<void>) {
  return defineAgentTool({
    name: "ryugi",
    title: "Ryugi",
    description: "Operate the isolated local Ryugi artifacts CLI. Pass command arguments, e.g. start --artifact document/design. Uses this workspace's private project, never opens a browser. Read the injected full Ryugi skills for workflow instructions.",
    input: z.object({ args: z.array(z.string()).min(1) }),
    async execute({ args }, { signal }) {
      if (!commands.has(args[0])) return { text: "不支持该命令；此工具仅运行工件 CLI，不安装 launcher、hook 或更新全局配置。", isError: true };
      const normalized: string[] = [];
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--project-dir" || arg.startsWith("--project-dir=")) {
          const value = arg === "--project-dir" ? args[++i] : arg.slice("--project-dir=".length);
          if (!value || path.resolve(value) !== projectDir) return { text: `请使用插件私有工件目录：${projectDir}`, isError: true };
        } else {
          if (/^--(?:foreground|open|port|host)(?:=|$)/.test(arg)) return { text: "不支持覆盖专用服务或自动打开浏览器。", isError: true };
          normalized.push(arg);
        }
      }
      normalized.push("--project-dir", projectDir);
      if (args[0] === "start") normalized.push("--background", "--no-open");
      if (!args.includes("--json") && !args.some((arg) => arg === "--format" || arg.startsWith("--format="))) normalized.push("--json");
      let output: string;
      let isError = false;
      try {
        const result = await exec("node", [runtime.cliPath, ...normalized], { cwd: projectDir, env: runtime.env, signal, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
        output = result.stdout || result.stderr;
      } catch (error) {
        const failure = error as Error & { stdout?: string; stderr?: string; code?: number | string };
        output = failure.stdout || failure.stderr || failure.message;
        // The CLI uses these exit codes for actionable/pending workflow outcomes.
        isError = ![2, 3, 4].includes(Number(failure.code));
      }
      if (args[0] === "start" && !isError && !signal.aborted) await onStart(output);
      return { text: output, isError };
    },
  });
}
