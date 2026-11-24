import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { URL } from "node:url";

import { getPrivateRuntime } from "./privateRuntime.js";

const execFileAsync = promisify(execFile);

type Workspace = { id: string; name: string; projectDir: string };
type Artifact = { artifact: string; url: string };
type Thread = {
  id: string;
  anchor?: unknown;
  status: string;
  waitingOn?: string;
  draft?: boolean;
  messages: Array<{ author: string; name?: string; text: string; at: string }>;
};

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
      if (!artifact.startsWith("document/") && !artifact.startsWith("artboard/")) continue;
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

  async searchComments(query: string, workspaces: Workspace[], selected?: readonly string[] | readonly Artifact[], waitingOnly = false) {
    const items: Array<{ id: string; identifier: string; title: string; subtitle: string; url: string; text: string; resourceType: string }> = [];
    const needle = query.trim().toLowerCase();
    for (const workspace of workspaces) {
      if (!fs.existsSync(path.join(workspace.projectDir, ".ryugi", "artifacts"))) continue;
      const resolved = selected?.every((item) => typeof item === "object");
      const artifacts: readonly { artifact: string; url?: string }[] = resolved
        ? selected
        : (await this.run(["get", "--project-dir", workspace.projectDir, "--json"])).data.items;
      for (const { artifact, url: existingUrl } of artifacts) {
        if (!artifact.startsWith("document/") && !artifact.startsWith("artboard/")) continue;
        if (!resolved && selected && !selected.some((item) => item === artifact)) continue;
        const url: string = existingUrl ?? (await this.run(["start", "--background", "--no-open", "--project-dir", workspace.projectDir, "--artifact", artifact, "--json"])).data.url;
        let cursor: string | undefined;
        let snapshot: string | undefined;
        do {
          const args = ["comment", "list", "--artifact", artifact, "--sections", "threads", "--detail", "--all", "--limit", "100", "--project-dir", workspace.projectDir, "--json"];
          if (cursor) args.push("--cursor", cursor);
          if (snapshot) args.push("--snapshot", snapshot);
          const { data: result, page: envelopePage } = await this.run(args);
          const section = result.sections?.threads || result;
          for (const thread of (section.items || []) as Thread[]) {
            if (waitingOnly && (thread.status !== "open" || thread.waitingOn !== "agent" || thread.draft)) continue;
            const messages = thread.messages.map((message) => `${message.name || message.author} (${message.at}): ${message.text}`).join("\n");
            const anchor = JSON.stringify(thread.anchor || {});
            const searchable = `${workspace.name} ${workspace.projectDir} ${artifact} ${thread.id} ${anchor} ${messages}`.toLowerCase();
            if (needle && !searchable.includes(needle)) continue;
            const id = createHash("sha256").update(JSON.stringify([workspace.id, artifact, thread.id])).digest("hex");
            items.push({
              id,
              identifier: `Ryugi #${thread.id}`,
              title: (thread.messages[0]?.text || "评论").slice(0, 100),
              subtitle: `${workspace.name} · ${artifact} · ${thread.status}`,
              url,
              text: `Ryugi 评论\n工作区: ${workspace.name}\n目录: ${workspace.projectDir}\n工件: ${artifact}\n地址: ${url}\n线程: ${thread.id}\n状态: ${thread.status}\n锚点: ${anchor}\n评论和回复:\n${messages}`,
              resourceType: "ryugi-comment",
            });
          }
          const page = envelopePage ?? section.page;
          cursor = page?.hasMore ? page.nextCursor || undefined : undefined;
          snapshot = section.snapshot || page?.snapshot || snapshot;
        } while (cursor);
      }
    }
    return { items };
  }
}

export const realRyugiBridge = new RealRyugiBridge();
