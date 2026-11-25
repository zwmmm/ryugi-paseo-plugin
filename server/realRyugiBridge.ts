import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { URL } from "node:url";

import { getPrivateRuntime } from "./privateRuntime.js";
import { artifactTypes } from "../shared/artifacts.js";

const execFileAsync = promisify(execFile);

type Artifact = { artifact: string; url: string };
export class RealRyugiBridge {
  constructor(private readonly cli?: string) {}

  private async run(args: string[]) {
    const runtime = this.cli ? undefined : getPrivateRuntime();
    const cli = this.cli || runtime!.cliPath;
    const options = { maxBuffer: 8 * 1024 * 1024, env: runtime?.env };
    const result = cli.endsWith(".js") || cli.endsWith(".cjs")
      ? await execFileAsync("node", [cli, ...args], options)
      : await execFileAsync(cli, args, options);
    const parsed = JSON.parse(result.stdout);
    if (parsed.outcome !== "success") throw new Error(parsed.error?.message || "Ryugi 命令失败");
    return parsed;
  }

  async sessionArtifacts(projectDir: string, texts: string[]) {
    if (!fs.existsSync(path.join(projectDir, ".ryugi", "artifacts"))) return [];
    const { data } = await this.run(["get", "--project-dir", projectDir, "--json"]);
    const paths = new Set<string>();
    for (const text of texts) {
      for (const match of text.matchAll(/\bhttp:\/\/(?:\[[\da-f:]+\]|[^\s/()[\]<>"'`（）【】“”‘’，。；！？]+)[^\s()[\]<>"'`（）【】“”‘’，。；！？]*/gi)) {
        const url = URL.parse(match[0]);
        if (url && !url.username && !url.password && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
          paths.add(url.pathname);
        }
      }
    }
    const artifacts: Artifact[] = [];
    for (const { artifact } of data.items as Array<{ artifact: string }>) {
      if (!artifactTypes.some((type) => artifact.startsWith(`${type}/`))) continue;
      const idFile = path.join(projectDir, ".ryugi", "artifacts", artifact, ".artifact-id");
      if (!fs.existsSync(idFile)) continue;
      const id = fs.readFileSync(idFile, "utf8").trim();
      const type = artifact.split("/")[0];
      if (!id || !paths.has(`/${type}/${id}`)) continue;
      const { data } = await this.run(["start", "--background", "--no-open", "--project-dir", projectDir, "--artifact", artifact, "--json"]);
      artifacts.push({ artifact, url: data.url });
    }
    return artifacts;
  }

}

export const realRyugiBridge = new RealRyugiBridge();
